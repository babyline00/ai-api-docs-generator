/**
 * Playground request builder.
 *
 * `buildProxyRequest(endpoint, params, body, headers, serverUrl?)` turns the
 * raw form values the user typed in the playground into a fetch-shaped object
 * (`{ url, method, headers, body }`). The API route handler then passes that
 * straight to `fetch()` and returns the raw upstream response.
 *
 * Keeping this pure (no I/O) means the test suite can mock `fetch` and assert
 * the exact request the playground would have made.
 */

import type { Endpoint, HttpMethod } from "@/lib/types";

const DEFAULT_SERVER = "https://api.example.com";

export interface ProxyRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
}

export interface PlaygroundParams {
  /** param name -> value (path, query, header params the user filled) */
  [name: string]: any;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildProxyRequest(
  endpoint: Endpoint,
  params: PlaygroundParams,
  body?: any,
  headers: Record<string, string> = {},
  serverUrl: string = DEFAULT_SERVER,
): ProxyRequest {
  let path = endpoint.path;
  const query: Record<string, string> = {};
  const finalHeaders: Record<string, string> = { ...headers };

  for (const p of endpoint.parameters) {
    const value = params?.[p.name];
    if (value === undefined || value === null || value === "") continue;
    if (p.in === "path") {
      path = path.replace(
        new RegExp(`{${escapeRegex(p.name)}}`, "g"),
        encodeURIComponent(String(value)),
      );
    } else if (p.in === "query") {
      query[p.name] = String(value);
    } else if (p.in === "header") {
      if (finalHeaders[p.name] === undefined) finalHeaders[p.name] = String(value);
    }
  }

  // Any param the user typed that isn't declared on the endpoint still goes
  // to the query string (lets the playground send vendor-specific params).
  for (const [k, v] of Object.entries(params ?? {})) {
    const declared = endpoint.parameters.find((p) => p.name === k);
    if (declared) continue;
    if (v === undefined || v === null || v === "") continue;
    query[k] = String(v);
  }

  const qs = Object.keys(query).length
    ? "?" + Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";

  const base = (serverUrl || "").replace(/\/$/, "");
  const out: ProxyRequest = {
    url: `${base}${path}${qs}`,
    method: endpoint.method,
    headers: finalHeaders,
  };

  if (body !== undefined && body !== null && body !== "") {
    let bodyStr: string;
    if (typeof body === "string") {
      bodyStr = body;
    } else {
      try {
        bodyStr = JSON.stringify(body);
      } catch {
        bodyStr = String(body);
      }
    }
    out.body = bodyStr;
    if (finalHeaders["Content-Type"] === undefined) {
      finalHeaders["Content-Type"] = "application/json";
    }
  }

  return out;
}

/**
 * Execute the proxy request via the given fetch implementation. Exposed so
 * tests can inject a mock fetch and assert call args.
 */
export async function executeProxyRequest(
  req: ProxyRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; durationMs: number }> {
  const start = Date.now();
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
  };
  if (req.body !== undefined && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    init.body = req.body;
  }
  const res = await fetchImpl(req.url, init);
  const elapsed = Date.now() - start;
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    respHeaders[key] = value;
  });
  const text = await res.text();
  return {
    status: res.status,
    statusText: res.statusText,
    headers: respHeaders,
    body: text,
    durationMs: elapsed,
  };
}
