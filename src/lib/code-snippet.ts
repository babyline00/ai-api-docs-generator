/**
 * Pure-function code-snippet generator. `generateCodeSnippet(endpoint, example, lang)`
 * renders a copy-pasteable request in one of six languages using the values
 * from an AI-generated `ExampleRequest`.
 *
 * Path parameters (`{userId}`) are substituted from `example.params`; any
 * remaining `in: query` params become the query string and any remaining
 * `in: header` params become request headers (merged with `example.headers`).
 * The request body is serialised from `example.body` when present.
 */

import type { CodeLanguage, Endpoint, ExampleRequest } from "@/lib/types";

const DEFAULT_SERVER = "https://api.example.com";

export interface SnippetOptions {
  serverUrl?: string;
}

/** Build the full URL: server + path-with-path-params-filled + query string. */
export function buildUrl(
  endpoint: Endpoint,
  example: ExampleRequest,
  serverUrl: string = DEFAULT_SERVER,
): { url: string; path: string; query: Record<string, any> } {
  let path = endpoint.path;
  const remaining: Record<string, any> = {};
  const query: Record<string, any> = {};
  for (const p of endpoint.parameters) {
    const value = example.params?.[p.name] ?? p.example;
    if (p.in === "path") {
      path = path.replace(new RegExp(`{${escapeRegex(p.name)}}`, "g"), encodeURIComponent(String(value ?? "")));
    } else if (p.in === "query") {
      if (value !== undefined && value !== "") query[p.name] = value;
    } else {
      // header / cookie — handled in buildHeaders, skip here
    }
  }
  // Any example.params not declared in the endpoint still go to the query.
  for (const [k, v] of Object.entries(example.params ?? {})) {
    const declared = endpoint.parameters.find((p) => p.name === k);
    if (!declared && v !== undefined && v !== "") query[k] = v;
    if (declared && declared.in !== "path" && declared.in !== "query" && declared.in !== "header") {
      remaining[k] = v;
    }
  }
  const qs = Object.keys(query).length
    ? "?" + Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const base = (serverUrl || "").replace(/\/$/, "");
  return { url: `${base}${path}${qs}`, path, query };
}

export function buildHeaders(
  endpoint: Endpoint,
  example: ExampleRequest,
): Record<string, string> {
  const headers: Record<string, string> = { ...(example.headers ?? {}) };
  for (const p of endpoint.parameters) {
    if (p.in !== "header") continue;
    const value = example.params?.[p.name] ?? p.example;
    if (value !== undefined && value !== "" && headers[p.name] === undefined) {
      headers[p.name] = String(value);
    }
  }
  if (example.body != null && headers["Content-Type"] === undefined) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export function buildBody(example: ExampleRequest): string | null {
  if (example.body == null) return null;
  try {
    return JSON.stringify(example.body, null, 2);
  } catch {
    return String(example.body);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function generateCodeSnippet(
  endpoint: Endpoint,
  example: ExampleRequest,
  lang: CodeLanguage,
  options: SnippetOptions = {},
): string {
  const serverUrl = options.serverUrl ?? DEFAULT_SERVER;
  const { url } = buildUrl(endpoint, example, serverUrl);
  const headers = buildHeaders(endpoint, example);
  const body = buildBody(example);
  switch (lang) {
    case "curl":
      return curlSnippet(endpoint.method, url, headers, body);
    case "javascript":
      return jsSnippet(endpoint.method, url, headers, body);
    case "typescript":
      return tsSnippet(endpoint, example, endpoint.method, url, headers, body);
    case "python":
      return pythonSnippet(endpoint.method, url, headers, body);
    case "go":
      return goSnippet(endpoint.method, url, headers, body);
    case "rust":
      return rustSnippet(endpoint.method, url, headers, body);
    default:
      return "";
  }
}

function headerEntries(headers: Record<string, string>): [string, string][] {
  return Object.entries(headers);
}

function curlSnippet(method: string, url: string, headers: Record<string, string>, body: string | null): string {
  const lines = [`curl -X ${method} '${url}'`];
  for (const [k, v] of headerEntries(headers)) lines.push(`  -H '${k}: ${v}'`);
  if (body) lines.push(`  -d '${body.replace(/'/g, "'\\''")}'`);
  return lines.join(" \\\n");
}

function jsSnippet(method: string, url: string, headers: Record<string, string>, body: string | null): string {
  const opts: string[] = [`  method: '${method}',`];
  if (headerEntries(headers).length) {
    opts.push("  headers: {");
    for (const [k, v] of headerEntries(headers)) opts.push(`    '${k}': '${v}',`);
    opts.push("  },");
  }
  if (body) opts.push(`  body: JSON.stringify(${body}),`);
  const optsStr = opts.join("\n");
  return [
    `const res = await fetch('${url}', {`,
    optsStr,
    `});`,
    `const data = await res.json();`,
    `console.log(data);`,
  ].join("\n");
}

function tsSnippet(endpoint: Endpoint, example: ExampleRequest, method: string, url: string, headers: Record<string, string>, body: string | null): string {
  const bodyType = inferBodyType(endpoint, example);
  const respType = inferResponseType(endpoint);
  const lines: string[] = [];
  if (bodyType) lines.push(`interface RequestBody ${bodyType}`, "");
  lines.push(`interface ResponseBody ${respType}`, "");
  lines.push(`const res = await fetch('${url}', {`);
  lines.push(`  method: '${method}',`);
  if (headerEntries(headers).length) {
    lines.push("  headers: {");
    for (const [k, v] of headerEntries(headers)) lines.push(`    '${k}': '${v}',`);
    lines.push("  } as Record<string, string>,");
  }
  if (body) lines.push(`  body: JSON.stringify(${body} as RequestBody),`);
  lines.push(`});`);
  lines.push(`const data: ResponseBody = await res.json();`);
  lines.push(`console.log(data);`);
  return lines.join("\n");
}

function inferBodyType(endpoint: Endpoint, example: ExampleRequest): string {
  if (example.body == null || typeof example.body !== "object") return "";
  const props = Object.keys(example.body as object);
  if (!props.length) return "{}";
  return `{\n${props.map((k) => `  ${k}: ${tsType((example.body as any)[k])};`).join("\n")}\n}`;
}

function tsType(v: any): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? `${tsType(v[0])}[]` : "unknown[]";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "object") return "Record<string, unknown>";
  return "unknown";
}

function inferResponseType(endpoint: Endpoint): string {
  const ok = endpoint.responses["200"] ?? endpoint.responses["201"] ?? endpoint.responses["default"];
  const schema = ok?.content?.["application/json"]?.schema;
  if (schema?.properties) {
    const props = Object.keys(schema.properties);
    return `{\n${props.map((p) => `  ${p}: ${tsTypeForSchema(schema.properties[p])};`).join("\n")}\n}`;
  }
  return "{ [key: string]: unknown }";
}

function tsTypeForSchema(s: any): string {
  if (!s) return "unknown";
  if (s.type === "integer" || s.type === "number") return "number";
  if (s.type === "boolean") return "boolean";
  if (s.type === "array") return `${tsTypeForSchema(s.items)}[]`;
  if (s.type === "object") return "Record<string, unknown>";
  return "string";
}

function pythonSnippet(method: string, url: string, headers: Record<string, string>, body: string | null): string {
  const lower = method.toLowerCase();
  const fn =
    lower === "get" ? "get" :
    lower === "post" ? "post" :
    lower === "put" ? "put" :
    lower === "patch" ? "patch" :
    lower === "delete" ? "delete" : "request";
  const lines: string[] = ["import requests", ""];
  const kwargs: string[] = [];
  if (headerEntries(headers).length) {
    const inner = headerEntries(headers).map(([k, v]) => `'${k}': '${v}'`).join(", ");
    kwargs.push(`headers={${inner}}`);
  }
  if (body) kwargs.push(`json=${body}`);
  const call =
    fn === "request"
      ? `res = requests.request('${method}', '${url}'${kwargs.length ? ", " + kwargs.join(", ") : ""})`
      : `res = requests.${fn}('${url}'${kwargs.length ? ", " + kwargs.join(", ") : ""})`;
  lines.push(call);
  lines.push("print(res.json())");
  return lines.join("\n");
}

function goSnippet(method: string, url: string, headers: Record<string, string>, body: string | null): string {
  const lines: string[] = ["package main", "", "import ("];
  const imports = ["\t\"net/http\"", "\t\"io\"", "\t\"fmt\""];
  if (body) imports.splice(1, 0, "\t\"bytes\"");
  lines.push(...imports, ")", "");
  const bodyArg = body ? `bytes.NewBufferString(\`${body.replace(/`/g, "\\`")}\`)` : "nil";
  lines.push(`req, err := http.NewRequest("${method}", "${url}", ${bodyArg})`);
  lines.push("if err != nil { panic(err) }");
  for (const [k, v] of headerEntries(headers)) {
    lines.push(`req.Header.Set("${k}", "${v.replace(/"/g, "\\\"")}")`);
  }
  lines.push("res, err := http.DefaultClient.Do(req)");
  lines.push("if err != nil { panic(err) }");
  lines.push("defer res.Body.Close()");
  lines.push("body, _ := io.ReadAll(res.Body)");
  lines.push("fmt.Println(string(body))");
  return lines.join("\n");
}

function rustSnippet(method: string, url: string, headers: Record<string, string>, body: string | null): string {
  const lines: string[] = ["use reqwest;", "", "#[tokio::main]", "async fn main() -> Result<(), Box<dyn std::error::Error>> {"];
  lines.push("    let client = reqwest::Client::new();");
  const verb = method.toLowerCase();
  const chain: string[] = [`        let res = client`];
  chain.push(`            .${verb}("${url}")`);
  for (const [k, v] of headerEntries(headers)) {
    chain.push(`            .header("${k}", "${v.replace(/"/g, "\\\"")}")`);
  }
  if (body) chain.push(`            .body(r#"${body.replace(/"#/g, "\\\"#")}"#)`);
  chain.push("            .send()");
  chain.push("            .await?;");
  lines.push(chain.join("\n"));
  lines.push("    let body = res.text().await?;");
  lines.push("    println!(\"{}\", body);");
  lines.push("    Ok(())");
  lines.push("}");
  return lines.join("\n");
}

export const CODE_SNIPPET_LANGUAGES: CodeLanguage[] = ["curl", "javascript", "typescript", "python", "go", "rust"];
