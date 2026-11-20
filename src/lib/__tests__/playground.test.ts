import { test, expect, describe, mock } from "bun:test";
import { buildProxyRequest, executeProxyRequest } from "@/lib/playground";
import type { Endpoint } from "@/lib/types";

const endpoint: Endpoint = {
  method: "GET",
  path: "/users/{userId}",
  tags: [],
  parameters: [
    { name: "userId", in: "path", required: true, schema: { type: "string" } },
    { name: "limit", in: "query", required: false, schema: { type: "integer" } },
    { name: "X-Trace", in: "header", required: false, schema: { type: "string" } },
  ],
  responses: { "200": { description: "ok" } },
};

describe("buildProxyRequest", () => {
  test("fills path params and builds query string", () => {
    const req = buildProxyRequest(
      endpoint,
      { userId: "user_123", limit: 25 },
      undefined,
      {},
      "https://api.example.com",
    );
    expect(req.url).toBe("https://api.example.com/users/user_123?limit=25");
    expect(req.method).toBe("GET");
  });

  test("merges endpoint header params + explicit headers", () => {
    const req = buildProxyRequest(
      endpoint,
      { userId: "u1", "X-Trace": "abc" },
      undefined,
      { Authorization: "Bearer t" },
      "https://api.example.com",
    );
    expect(req.headers["X-Trace"]).toBe("abc");
    expect(req.headers.Authorization).toBe("Bearer t");
  });

  test("serialises object body and sets Content-Type", () => {
    const ep: Endpoint = {
      method: "POST",
      path: "/users",
      tags: [],
      parameters: [],
      responses: { "201": { description: "created" } },
    };
    const req = buildProxyRequest(ep, {}, { name: "Alice" }, {}, "https://api.example.com");
    expect(req.body).toBe(JSON.stringify({ name: "Alice" }));
    expect(req.headers["Content-Type"]).toBe("application/json");
  });

  test("accepts a raw string body without re-encoding", () => {
    const ep: Endpoint = { method: "POST", path: "/echo", tags: [], parameters: [], responses: {} };
    const req = buildProxyRequest(ep, {}, "hello world", {}, "https://api.example.com");
    expect(req.body).toBe("hello world");
  });

  test("uses a relative URL when no server URL is supplied", () => {
    const req = buildProxyRequest(endpoint, { userId: "u1" }, undefined, {}, "");
    expect(req.url).toBe("/users/u1");
  });

  test("undeclared params flow into the query string", () => {
    const req = buildProxyRequest(
      endpoint,
      { userId: "u1", extra: "x" },
      undefined,
      {},
      "https://api.example.com",
    );
    expect(req.url).toContain("extra=x");
  });
});

describe("executeProxyRequest", () => {
  test("returns status, headers, body and a non-negative durationMs", async () => {
    const fakeHeaders = new Map([
      ["content-type", "application/json"],
      ["x-request-id", "abc"],
    ]);
    const fakeHeadersObj: any = {
      forEach: (cb: (v: string, k: string) => void) => fakeHeaders.forEach((v, k) => cb(v, k)),
    };
    const mockFetch = mock(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: fakeHeadersObj,
        text: () => Promise.resolve('{"id":"u1"}'),
      }),
    ) as unknown as typeof fetch;

    const req = buildProxyRequest(endpoint, { userId: "u1" }, undefined, {}, "https://api.example.com");
    const result = await executeProxyRequest(req, mockFetch);
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("application/json");
    expect(result.body).toBe('{"id":"u1"}');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("propagates upstream error status", async () => {
    const fakeHeadersObj: any = { forEach: () => {} };
    const mockFetch = mock(() =>
      Promise.resolve({
        status: 503,
        statusText: "Service Unavailable",
        headers: fakeHeadersObj,
        text: () => Promise.resolve("unavailable"),
      }),
    ) as unknown as typeof fetch;
    const req = buildProxyRequest(endpoint, { userId: "u1" }, undefined, {}, "https://api.example.com");
    const result = await executeProxyRequest(req, mockFetch);
    expect(result.status).toBe(503);
    expect(result.body).toBe("unavailable");
  });
});
