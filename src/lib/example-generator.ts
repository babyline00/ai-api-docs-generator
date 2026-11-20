/**
 * AI example-request generation.
 *
 * The flow is deliberately split into three pure-ish pieces so the tests can
 * exercise each independently:
 *
 *   1. `buildExamplePrompt(endpoint)`  — renders the prompt that asks the LLM
 *      for 1-2 example requests as JSON.
 *   2. `parseExamplesResponse(text)`    — extracts a JSON array from the LLM
 *      response and validates each entry's shape.
 *   3. `generateExamplesForEndpoint(endpoint, provider)` — orchestrates the
 *      LLM call + parse, and falls back to a deterministic heuristic when the
 *      LLM returns nothing usable (so the docs pane is never empty).
 */

import type { ChatProvider } from "@/lib/ai";
import type { Endpoint, ExampleRequest, Parameter, Schema } from "@/lib/types";

const SYSTEM_PROMPT = [
  "You are an API documentation assistant that generates realistic example",
  "requests for a single REST endpoint. Output ONLY a JSON array of 1-2 example",
  "request objects — no prose, no markdown fences. Each object MUST have:",
  "  - `label`: short human label (e.g. \"Happy path\", \"With pagination\")",
  "  - `params`: object keyed by parameter name (path/query/header) filled with",
  "    realistic values. Path params like `{userId}` should use plausible ids",
  "    (e.g. `user_123`). Use realistic emails, dates, slugs — never `string`.",
  "  - `headers`: object of header name -> value (include Content-Type only",
  "    when there is a request body)",
  "  - `body`: (only when the endpoint has a request body) a JSON object that",
  "    satisfies the schema with plausible field values.",
].join("\n");

/** Render the user-facing prompt for one endpoint. */
export function buildExamplePrompt(endpoint: Endpoint): string {
  const compact = {
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary,
    description: endpoint.description,
    parameters: endpoint.parameters.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      schema: p.schema,
      example: p.example,
    })),
    requestBody: endpoint.requestBody,
    responses: endpoint.responses,
  };
  return [
    `Generate 1-2 example requests as JSON for the following REST endpoint.`,
    `Endpoint JSON:`,
    "```json",
    JSON.stringify(compact, null, 2),
    "```",
  ].join("\n");
}

/** Strip ```json ... ``` fences and surrounding prose, return the inner text. */
function stripFences(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  return text.trim();
}

/** Find the first balanced JSON array boundary in `text`. */
function extractJsonArray(text: string): string | null {
  const stripped = stripFences(text);
  // Direct array start.
  const start = stripped.indexOf("[");
  if (start < 0) return null;
  // Walk brackets to find the matching close.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extract and validate an `ExampleRequest[]` from an LLM response.
 * Returns `[]` when no valid JSON array is found. Malformed entries are
 * coerced/filtered rather than throwing.
 */
export function parseExamplesResponse(text: string): ExampleRequest[] {
  if (!text || typeof text !== "string") return [];
  const arrayText = extractJsonArray(text);
  if (!arrayText) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ExampleRequest[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const params =
      entry.params && typeof entry.params === "object" && !Array.isArray(entry.params)
        ? (entry.params as Record<string, any>)
        : {};
    const headers =
      entry.headers && typeof entry.headers === "object" && !Array.isArray(entry.headers)
        ? Object.fromEntries(
            Object.entries(entry.headers).map(([k, v]) => [k, String(v)]),
          )
        : {};
    const label = typeof entry.label === "string" ? entry.label : undefined;
    const hasBody = entry.body !== undefined;
    out.push({
      ...(label ? { label } : {}),
      params,
      headers,
      ...(hasBody ? { body: entry.body } : {}),
    });
  }
  return out;
}

/**
 * Run example generation for a single endpoint via the given provider.
 * Falls back to a deterministic heuristic when the LLM returns nothing
 * usable (offline mode, malformed JSON, etc.).
 */
export async function generateExamplesForEndpoint(
  endpoint: Endpoint,
  provider: ChatProvider,
): Promise<ExampleRequest[]> {
  const userPrompt = buildExamplePrompt(endpoint);
  let raw = "";
  try {
    raw = await provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (e) {
    console.warn("[examples] LLM call failed, using heuristic:", (e as Error).message);
  }
  const parsed = parseExamplesResponse(raw);
  if (parsed.length) return parsed;
  return [heuristicExample(endpoint)];
}

/** Deterministic, schema-aware example used as the offline fallback. */
export function heuristicExample(endpoint: Endpoint): ExampleRequest {
  const params: Record<string, any> = {};
  const headers: Record<string, string> = {};
  let body: any = undefined;
  for (const p of endpoint.parameters) {
    if (p.example != null) params[p.name] = p.example;
    else if (p.schema?.example != null) params[p.name] = p.schema.example;
    else params[p.name] = guessValueFor(p.name, p.schema);
  }
  const jsonContent =
    endpoint.requestBody?.content?.["application/json"] ??
    endpoint.requestBody?.content?.[Object.keys(endpoint.requestBody?.content ?? {})[0]];
  if (jsonContent?.example != null) body = jsonContent.example;
  else if (jsonContent?.schema) body = sampleFromSchema(jsonContent.schema);
  if (body != null) headers["Content-Type"] = "application/json";
  return {
    label: "Default example",
    params,
    headers,
    ...(body != null ? { body } : {}),
  };
}

function guessValueFor(name: string, schema?: Schema): any {
  const n = (name || "").toLowerCase();
  if (/(^|_)id$|id$/.test(n)) return "user_123";
  if (/email/.test(n)) return "alice@example.com";
  if (/(page|limit|size|count|per_page)/.test(n)) return 20;
  if (/(sort|order)/.test(n)) return "asc";
  if (/name/.test(n)) return "Alice";
  if (schema?.type === "integer" || schema?.type === "number") return 1;
  if (schema?.type === "boolean") return true;
  if (schema?.enum?.length) return schema.enum[0];
  return "sample";
}

export function sampleFromSchema(schema: Schema | undefined, depth = 0): any {
  if (!schema || depth > 6) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.$ref) return {};
  switch (schema.type) {
    case "object": {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        out[k] = sampleFromSchema(v, depth + 1);
      }
      return out;
    }
    case "array":
      return [sampleFromSchema(schema.items, depth + 1)];
    case "integer":
    case "number":
      return schema.enum?.[0] ?? 0;
    case "boolean":
      return false;
    case "string":
      return schema.enum?.[0] ?? guessValueFor(schema.format ? `_${schema.format}` : "");
    default:
      return null;
  }
}

/** Convenience: ensure every endpoint has at least one example. */
export function ensureExamples(endpoint: Endpoint, existing?: ExampleRequest[]): ExampleRequest[] {
  if (existing && existing.length) return existing;
  return [heuristicExample(endpoint)];
}

export { guessValueFor as _guessValueFor };
export type { Parameter };
