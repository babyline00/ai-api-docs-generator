/**
 * DB row <-> view-model serializers. The Endpoint table stores the structured
 * fields as JSON strings (SQLite has no native JSON type and Prisma can't
 * model object arrays as scalars), so every read round-trips through
 * JSON.parse. Centralising that here keeps the route handlers thin.
 */

import type {
  Endpoint,
  ExampleRequest,
  HttpMethod,
  Parameter,
  ParsedSpec,
  RequestBody,
  ServerObject,
} from "@/lib/types";
import { safeJsonParse } from "@/lib/utils";

export interface EndpointView extends Endpoint {
  id: string;
  examples: ExampleRequest[];
}

export interface SpecFullView {
  id: string;
  name: string;
  version: string;
  sourceType: string;
  serverUrl: string | null;
  info: { title: string; version: string; description?: string };
  endpoints: EndpointView[];
  changelog: {
    id: string;
    changeType: string;
    method: string | null;
    path: string | null;
    description: string;
    fromVersion: string | null;
    toVersion: string | null;
    createdAt: string;
  }[];
}

function parseArr<T>(value: string | null | undefined, fallback: T[] = []): T[] {
  const parsed = safeJsonParse(value ?? "");
  return Array.isArray(parsed) ? (parsed as T[]) : fallback;
}

function parseObj<T>(value: string | null | undefined, fallback: T): T {
  const parsed = safeJsonParse(value ?? "");
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : fallback;
}

export function endpointRowToView(row: {
  id: string;
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  parameters: string;
  requestBody: string | null;
  responses: string;
  examples: string | null;
  tags: string;
}): EndpointView {
  return {
    id: row.id,
    method: row.method as HttpMethod,
    path: row.path,
    summary: row.summary ?? undefined,
    description: row.description ?? undefined,
    tags: parseArr<string>(row.tags, []),
    parameters: parseArr<Parameter>(row.parameters, []),
    requestBody: parseObj<RequestBody | undefined>(row.requestBody, undefined),
    responses: parseObj<Endpoint["responses"]>(row.responses, {}),
    examples: parseArr<ExampleRequest>(row.examples, []),
  };
}

export function endpointRowToEndpoint(row: {
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  parameters: string;
  requestBody: string | null;
  responses: string;
  tags: string;
}): Endpoint {
  return {
    method: row.method as HttpMethod,
    path: row.path,
    summary: row.summary ?? undefined,
    description: row.description ?? undefined,
    tags: parseArr<string>(row.tags, []),
    parameters: parseArr<Parameter>(row.parameters, []),
    requestBody: parseObj<RequestBody | undefined>(row.requestBody, undefined),
    responses: parseObj<Endpoint["responses"]>(row.responses, {}),
  };
}

export function parseStoredSpec(parsedSpec: string): ParsedSpec | null {
  const p = safeJsonParse(parsedSpec);
  if (!p || typeof p !== "object") return null;
  return {
    info: p.info ?? { title: "Untitled", version: "1.0.0" },
    servers: Array.isArray(p.servers) ? (p.servers as ServerObject[]) : [],
    endpoints: Array.isArray(p.endpoints) ? (p.endpoints as Endpoint[]) : [],
  };
}
