/**
 * OpenAPI 3.x parser — normalises a raw OpenAPI document into the unified
 * `ParsedSpec` shape (`{ info, servers, endpoints }`).
 *
 * Notable behaviour:
 *  - Inline `$ref` resolution. Only local refs (`#/components/...`) are
 *    supported — remote/URL refs are left untouched and treated as opaque.
 *  - A defensive `deepClone` is used while resolving so the original document
 *    is never mutated and circular refs cannot loop forever.
 *  - Missing `servers` defaults to `[{ url: '/' }]` so the playground always
 *    has a base URL to proxy against.
 *  - Malformed input (no `openapi`/`swagger` and no `paths`) throws a typed
 *    error so the import route handler can surface a 400.
 */

import type {
  Endpoint,
  HttpMethod,
  Parameter,
  ParsedSpec,
  RequestBody,
  ResponseObject,
  ServerObject,
} from "@/lib/types";
import { HTTP_METHODS } from "@/lib/types";

export class SpecParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecParseError";
  }
}

/** Resolve a JSON pointer `#/components/schemas/Foo` against `doc`. */
function resolveRef(doc: any, ref: string): any {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let node: any = doc;
  for (const part of parts) {
    if (node == null) return undefined;
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    node = node[key];
  }
  return node;
}

function resolveNode(node: any, doc: any, seen: WeakSet<object>): any {
  if (node === null || typeof node !== "object") return node;
  if (seen.has(node)) return node; // cycle — stop
  seen.add(node);
  if (Array.isArray(node)) {
    return node.map((item) => resolveNode(item, doc, seen));
  }
  if (typeof node.$ref === "string") {
    const target = resolveRef(doc, node.$ref);
    if (target === undefined) return { $ref: node.$ref };
    return resolveNode(deepClone(target), doc, seen);
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = resolveNode(v, doc, seen);
  }
  return out;
}

/** Recursively inline `$ref`s. Uses a fresh cycle-guard per call so reusing
 *  the same source document across multiple `parseOpenApi3` calls is safe. */
export function resolveRefs(node: any, doc: any): any {
  return resolveNode(node, doc, new WeakSet<object>());
}

function deepClone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function normalizeMethod(method: string): HttpMethod | undefined {
  const upper = method.toUpperCase();
  return (HTTP_METHODS as string[]).includes(upper) ? (upper as HttpMethod) : undefined;
}

function mapParameter(raw: any, doc: any): Parameter {
  const resolved = typeof raw?.$ref === "string" ? resolveRefs(raw, doc) : raw;
  return {
    name: resolved?.name ?? "",
    in: resolved?.in ?? "query",
    required: Boolean(resolved?.required ?? resolved?.in === "path"),
    description: resolved?.description,
    schema: resolved?.schema,
    example: resolved?.example,
    deprecated: resolved?.deprecated,
  };
}

function mapRequestBody(raw: any, doc: any): RequestBody | undefined {
  if (!raw) return undefined;
  const resolved = typeof raw.$ref === "string" ? resolveRefs(raw, doc) : raw;
  return {
    description: resolved?.description,
    required: Boolean(resolved?.required),
    content: resolved?.content ?? {},
  };
}

function mapResponses(raw: any): Record<string, ResponseObject> {
  const out: Record<string, ResponseObject> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [code, resp] of Object.entries(raw)) {
    const r = resp as any;
    out[code] = {
      statusCode: code,
      description: r?.description,
      content: r?.content ?? {},
    };
  }
  return out;
}

function mapEndpoint(method: HttpMethod, path: string, op: any, doc: any): Endpoint {
  const parameters = (op?.parameters ?? []).map((p: any) => mapParameter(p, doc));
  const tags: string[] = Array.isArray(op?.tags) ? op.tags : [];
  return {
    method,
    path,
    summary: op?.summary,
    description: op?.description,
    operationId: op?.operationId,
    tags: tags.map(String),
    parameters,
    requestBody: mapRequestBody(op?.requestBody, doc),
    responses: mapResponses(op?.responses),
  };
}

function normalizeServers(raw: any): ServerObject[] {
  if (!Array.isArray(raw) || raw.length === 0) return [{ url: "/" }];
  return raw
    .filter((s) => s && typeof s.url === "string")
    .map((s) => ({
      url: s.url,
      description: s.description,
      variables: s.variables,
    }));
}

/** Pick a sensible server URL for the playground (first absolute URL, else first). */
export function pickServerUrl(servers: ServerObject[]): string | null {
  if (!servers.length) return null;
  const absolute = servers.find((s) => /^https?:\/\//i.test(s.url));
  return (absolute ?? servers[0]).url;
}

/**
 * Parse an OpenAPI 3.x document into the unified `ParsedSpec` shape.
 * Throws `SpecParseError` on malformed input.
 */
export function parseOpenApi3(input: any): ParsedSpec {
  if (input == null || typeof input !== "object") {
    throw new SpecParseError("OpenAPI document must be a JSON object.");
  }
  const isOas =
    typeof input.openapi === "string" ||
    typeof input.swagger === "string" ||
    (input.paths && typeof input.paths === "object");
  if (!isOas) {
    throw new SpecParseError(
      "Not an OpenAPI document: missing `openapi`/`swagger` and `paths`.",
    );
  }
  const doc = deepClone(input);
  const endpoints: Endpoint[] = [];
  const paths = doc.paths ?? {};
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    if (!pathItemRaw || typeof pathItemRaw !== "object") continue;
    // Inline $refs for this path-item (parameters, request body, response
    // schemas) so every downstream field is a plain object.
    const pathItem = resolveRefs(pathItemRaw, doc);
    // Shared parameters at the path-item level apply to every operation.
    const sharedParams = Array.isArray((pathItem as any).parameters)
      ? (pathItem as any).parameters
      : [];
    for (const [method, op] of Object.entries(pathItem as Record<string, any>)) {
      if (method === "parameters" || method === "$ref" || method === "summary" || method === "description" || method === "servers") {
        continue;
      }
      const httpMethod = normalizeMethod(method);
      if (!httpMethod) continue;
      if (!op || typeof op !== "object") continue;
      const merged = { ...op, parameters: [...sharedParams, ...(op.parameters ?? [])] };
      endpoints.push(mapEndpoint(httpMethod, path, merged, doc));
    }
  }

  return {
    info: {
      title: doc.info?.title ?? "Untitled API",
      version: String(doc.info?.version ?? "1.0.0"),
      description: doc.info?.description,
    },
    servers: normalizeServers(doc.servers),
    endpoints,
  };
}

/**
 * Detect whether a raw spec string is OpenAPI. Returns 'openapi' for
 * OpenAPI 3.x / Swagger 2 documents with a `paths` object, otherwise `null`.
 * Used by the import router to pick the right parser.
 */
export function looksLikeOpenApi(doc: any): boolean {
  if (!doc || typeof doc !== "object") return false;
  return Boolean(
    typeof doc.openapi === "string" ||
      typeof doc.swagger === "string" ||
      (doc.paths && typeof doc.paths === "object"),
  );
}
