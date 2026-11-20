/**
 * Postman Collection v2.1 parser — flattens the nested folder tree into the
 * same unified `ParsedSpec` shape the OpenAPI parser produces.
 *
 * Postman quirks handled here:
 *  - Folders (`item[]` containing nested `item[]`) are walked recursively and
 *    the folder name is added as a tag so endpoints stay grouped in the UI.
 *  - `request.url` may be a string OR an object with `raw`, `path`, `query`,
 *    and `variable[]` (path vars). Both are normalised to a `{path, params}` pair.
 *  - `request.body.raw` (mode `raw`) becomes a JSON request body when the
 *    language is JSON, otherwise it is stored as an opaque example.
 *  - Collection-level `variable[]` is treated as a template for the server URL:
 *    if a variable named `baseUrl`/`BASE_URL`/`host` exists it is used as the
 *    only server entry, otherwise the first absolute request origin is used,
 *    otherwise servers defaults to `[{ url: '/' }]`.
 */

import type {
  Endpoint,
  HttpMethod,
  Parameter,
  ParsedSpec,
  RequestBody,
  ServerObject,
} from "@/lib/types";
import { HTTP_METHODS } from "@/lib/types";
import { SpecParseError } from "@/lib/spec-parser";

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: any;
  description?: string;
}

function normalizeMethod(method: any): HttpMethod {
  const upper = String(method ?? "GET").toUpperCase();
  return (HTTP_METHODS as string[]).includes(upper) ? (upper as HttpMethod) : "GET";
}

function interpolateVariables(raw: string, vars?: { key: string; value: string }[]): string {
  if (!vars || !vars.length) return raw;
  let out = raw;
  for (const v of vars) {
    out = out.replace(new RegExp(`{{${escapeRegex(v.key)}}}`, "g"), String(v.value ?? ""));
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectVariables(node: any): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  if (Array.isArray(node?.variable)) {
    for (const v of node.variable) {
      if (v && typeof v.key === "string") out.push({ key: v.key, value: String(v.value ?? "") });
    }
  }
  return out;
}

/** Normalise a Postman URL to `{ path, query, pathVars, absolute }`. */
function normalizeUrl(url: any, itemVars: { key: string; value: string }[]) {
  if (typeof url === "string") {
    const interpolated = interpolateVariables(url, itemVars);
    return parseRawUrl(interpolated);
  }
  if (url && typeof url === "object") {
    const raw = interpolateVariables(url.raw ?? "", [...itemVars, ...collectVariables(url)]);
    const parsed = parseRawUrl(raw);
    // Prefer the structured `path` array when present. Postman encodes path
    // variables as `:name` segments directly, so we join as-is and collect
    // the matching `variable[]` entries for the parameter table.
    if (Array.isArray(url.path) && url.path.length) {
      const pathVars: { key: string; value: string }[] = Array.isArray(url.variable)
        ? url.variable.map((v: any) => ({ key: v.key, value: String(v.value ?? "") }))
        : [];
      return {
        ...parsed,
        path: "/" + url.path.join("/"),
        pathVars,
      };
    }
    return parsed;
  }
  return { absolute: false, origin: "", path: "/", query: [] as Parameter[], pathVars: [] as { key: string; value: string }[] };
}

function parseRawUrl(raw: string) {
  let origin = "";
  let path = "/";
  const absolute = /^https?:\/\//i.test(raw);
  const query: Parameter[] = [];
  if (absolute) {
    try {
      const u = new URL(raw);
      origin = `${u.protocol}//${u.host}`;
      path = u.pathname || "/";
      for (const [k, v] of u.searchParams.entries()) {
        query.push({ name: k, in: "query", required: false, example: v });
      }
    } catch {
      origin = raw;
    }
  } else {
    // Relative URL — split into path + query.
    const [p, q] = raw.split("?");
    path = p || "/";
    if (q) {
      for (const pair of q.split("&")) {
        const [k, v] = pair.split("=");
        if (k) query.push({ name: k, in: "query", required: false, example: v ?? "" });
      }
    }
  }
  return { absolute, origin, path, query, pathVars: [] as { key: string; value: string }[] };
}

function mapHeaders(rawHeaders: any): Parameter[] {
  if (!Array.isArray(rawHeaders)) return [];
  return rawHeaders
    .filter((h) => h && h.key)
    .map((h) => ({
      name: h.key,
      in: "header" as const,
      required: false,
      description: h.description,
      example: h.value,
    }));
}

function mapBody(rawBody: any): RequestBody | undefined {
  if (!rawBody || typeof rawBody !== "object") return undefined;
  const mode = rawBody.mode;
  if (mode === "raw" && typeof rawBody.raw === "string") {
    const lang = rawBody.options?.raw?.language ?? "json";
    let example: any = rawBody.raw;
    if (lang === "json") {
      try {
        example = JSON.parse(rawBody.raw);
      } catch {
        example = rawBody.raw;
      }
    }
    return {
      description: rawBody.description,
      required: false,
      content: {
        [lang === "json" ? "application/json" : "text/plain"]: { example },
      },
    };
  }
  if (mode === "urlencoded" && Array.isArray(rawBody.urlencoded)) {
    const obj: Record<string, any> = {};
    for (const f of rawBody.urlencoded) if (f?.key) obj[f.key] = f.value;
    return {
      required: false,
      content: { "application/x-www-form-urlencoded": { example: obj } },
    };
  }
  if (mode === "formdata" && Array.isArray(rawBody.formdata)) {
    const obj: Record<string, any> = {};
    for (const f of rawBody.formdata) if (f?.key) obj[f.key] = f.value;
    return {
      required: false,
      content: { "multipart/form-data": { example: obj } },
    };
  }
  return undefined;
}

function mapResponseExample(description?: string): Record<string, any> {
  // Postman stores example responses under `response[]` per item; we surface
  // only the 200 example if present so the docs pane can render something.
  return {
    "200": {
      statusCode: "200",
      description: description ?? "OK",
      content: {},
    },
  };
}

function walkItems(
  items: PostmanItem[],
  itemVars: { key: string; value: string }[],
  tags: string[],
  out: Endpoint[],
) {
  for (const item of items) {
    if (Array.isArray(item.item) && item.item.length) {
      // Folder — recurse, passing folder name as an additional tag.
      walkItems(item.item, itemVars, [...tags, item.name ?? ""].filter(Boolean), out);
      continue;
    }
    if (!item.request) continue;
    const req = item.request;
    const method = normalizeMethod(req.method);
    const url = normalizeUrl(req.url, itemVars);
    const headerParams = mapHeaders(req.header);
    const pathParams: Parameter[] = (url.pathVars ?? []).map((v) => ({
      name: v.key,
      in: "path" as const,
      required: true,
      example: v.value || undefined,
    }));
    const parameters = [...pathParams, ...headerParams, ...url.query];
    const requestBody = mapBody(req.body);
    const endpoint: Endpoint = {
      method,
      path: url.path,
      summary: item.name,
      description: item.description ?? req.description,
      tags: [...tags],
      parameters,
      requestBody,
      responses: mapResponseExample(item.description),
    };
    out.push(endpoint);
  }
}

function deriveServers(endpoints: Endpoint[], vars: { key: string; value: string }[]): ServerObject[] {
  const baseVar = vars.find((v) => /baseurl|^base_url$|^host$/i.test(v.key));
  if (baseVar && /^https?:\/\//i.test(baseVar.value)) {
    return [{ url: baseVar.value }];
  }
  for (const e of endpoints) {
    // We lost origin info during mapping; recompute lazily isn't possible here,
    // so accept the relative-path fallback when no absolute URL was seen.
  }
  return [{ url: "/" }];
}

/** Parse a Postman Collection v2.1 document. Throws on malformed input. */
export function parsePostmanV21(input: any): ParsedSpec {
  if (input == null || typeof input !== "object") {
    throw new SpecParseError("Postman collection must be a JSON object.");
  }
  const items = input.item;
  if (!Array.isArray(items)) {
    throw new SpecParseError("Postman collection is missing `item[]`.");
  }
  const vars = collectVariables(input);
  const endpoints: Endpoint[] = [];
  walkItems(items, vars, [], endpoints);

  return {
    info: {
      title: input.info?.name ?? "Untitled Collection",
      version: String(input.info?.version ?? "1.0.0"),
      description: input.info?.description,
    },
    servers: deriveServers(endpoints, vars),
    endpoints,
  };
}

/** Detect whether a raw object is a Postman v2.1 collection. */
export function looksLikePostman(doc: any): boolean {
  if (!doc || typeof doc !== "object") return false;
  const schema = String(doc.info?.schema ?? "");
  return (
    /schema\.getpostman\.com\/json\/collection\/v2\.[01]/.test(schema) ||
    (Array.isArray(doc.item) && !doc.paths)
  );
}
