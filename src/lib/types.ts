/**
 * Shared types for the unified internal spec shape produced by both the
 * OpenAPI 3.x parser and the Postman Collection v2.1 parser. Persisting
 * the serialised `ParsedSpec` (minus the endpoints which become their own
 * rows) keeps the import path loss-less regardless of source format.
 */

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

export type ParameterLocation = "path" | "query" | "header" | "cookie";

export interface Schema {
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  enum?: any[];
  example?: any;
  $ref?: string;
  additionalProperties?: boolean | Schema;
  nullable?: boolean;
}

export interface Parameter {
  name: string;
  in: ParameterLocation;
  required: boolean;
  description?: string;
  schema?: Schema;
  example?: any;
  deprecated?: boolean;
}

export interface MediaTypeObject {
  schema?: Schema;
  example?: any;
  examples?: Record<string, { value: any }>;
}

export interface RequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, MediaTypeObject>;
}

export interface ResponseObject {
  statusCode: string;
  description?: string;
  content?: Record<string, MediaTypeObject>;
}

export interface Endpoint {
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags: string[];
  parameters: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, { description?: string; content?: Record<string, MediaTypeObject> }>;
}

export interface ServerObject {
  url: string;
  description?: string;
  variables?: Record<string, { default: string; enum?: string[]; description?: string }>;
}

export interface ApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface ParsedSpec {
  info: ApiInfo;
  servers: ServerObject[];
  endpoints: Endpoint[];
}

/** An AI-generated example request persisted on the Endpoint row. */
export interface ExampleRequest {
  label?: string;
  params: Record<string, any>;
  headers: Record<string, string>;
  body?: any;
}

export interface ChangelogEntryData {
  changeType: "added" | "removed" | "modified";
  method?: string;
  path?: string;
  description: string;
  fromVersion?: string | null;
  toVersion?: string | null;
}

export type CodeLanguage =
  | "curl"
  | "javascript"
  | "typescript"
  | "python"
  | "go"
  | "rust";

export const CODE_LANGUAGES: { id: CodeLanguage; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
];

export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900 dark:bg-emerald-950",
  POST: "text-amber-600 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-900 dark:bg-amber-950",
  PUT: "text-sky-600 border-sky-200 bg-sky-50 dark:text-sky-400 dark:border-sky-900 dark:bg-sky-950",
  PATCH: "text-violet-600 border-violet-200 bg-violet-50 dark:text-violet-400 dark:border-violet-900 dark:bg-violet-950",
  DELETE: "text-rose-600 border-rose-200 bg-rose-50 dark:text-rose-400 dark:border-rose-900 dark:bg-rose-950",
  HEAD: "text-slate-600 border-slate-200 bg-slate-50 dark:text-slate-400 dark:border-slate-800 dark:bg-slate-900",
  OPTIONS: "text-slate-600 border-slate-200 bg-slate-50 dark:text-slate-400 dark:border-slate-800 dark:bg-slate-900",
};
