import { test, expect, describe } from "bun:test";
import { generateCodeSnippet, buildUrl, buildHeaders } from "@/lib/code-snippet";
import type { Endpoint, ExampleRequest } from "@/lib/types";

const endpoint: Endpoint = {
  method: "GET",
  path: "/users/{userId}",
  tags: ["Users"],
  parameters: [
    { name: "userId", in: "path", required: true, schema: { type: "string" } },
    { name: "limit", in: "query", required: false, schema: { type: "integer" } },
  ],
  responses: {
    "200": {
      description: "ok",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" } },
          },
        },
      },
    },
  },
};

const example: ExampleRequest = {
  label: "Default",
  params: { userId: "user_123" },
  headers: { Authorization: "Bearer token" },
};

const postEndpoint: Endpoint = {
  method: "POST",
  path: "/users",
  tags: [],
  parameters: [],
  requestBody: {
    required: true,
    content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } },
  },
  responses: { "201": { description: "created" } },
};
const postExample: ExampleRequest = {
  params: {},
  headers: { "Content-Type": "application/json" },
  body: { name: "Alice" },
};

describe("generateCodeSnippet — curl", () => {
  test("contains the method, full URL, and header", () => {
    const snippet = generateCodeSnippet(endpoint, example, "curl");
    expect(snippet).toContain("curl -X GET 'https://api.example.com/users/user_123'");
    expect(snippet).toContain("-H 'Authorization: Bearer token'");
  });
  test("includes a -d body for POST", () => {
    const snippet = generateCodeSnippet(postEndpoint, postExample, "curl");
    expect(snippet).toContain("-X POST");
    expect(snippet).toContain("-d");
  });
});

describe("generateCodeSnippet — JavaScript fetch", () => {
  test("contains fetch('https://...') and method: 'GET'", () => {
    const snippet = generateCodeSnippet(endpoint, example, "javascript");
    expect(snippet).toContain("fetch('https://api.example.com/users/user_123'");
    expect(snippet).toContain("method: 'GET'");
    expect(snippet).toContain("await res.json()");
  });
});

describe("generateCodeSnippet — TypeScript", () => {
  test("includes type annotations (interface + typed const)", () => {
    const snippet = generateCodeSnippet(endpoint, example, "typescript");
    expect(snippet).toContain("interface");
    expect(snippet).toContain(": ResponseBody");
    expect(snippet).toContain("method: 'GET'");
  });
  test("generates a RequestBody interface when a body is present", () => {
    const snippet = generateCodeSnippet(postEndpoint, postExample, "typescript");
    expect(snippet).toContain("interface RequestBody");
    expect(snippet).toContain("name:");
  });
});

describe("generateCodeSnippet — Python", () => {
  test("contains requests.get('https://...')", () => {
    const snippet = generateCodeSnippet(endpoint, example, "python");
    expect(snippet).toContain("import requests");
    expect(snippet).toContain("requests.get('https://api.example.com/users/user_123'");
    expect(snippet).toContain("headers={'Authorization': 'Bearer token'}");
  });
  test("uses requests.post and json= for POST", () => {
    const snippet = generateCodeSnippet(postEndpoint, postExample, "python");
    expect(snippet).toContain("requests.post('https://api.example.com/users'");
    expect(snippet).toContain("json={");
  });
});

describe("generateCodeSnippet — Go", () => {
  test("contains http.NewRequest(...) and the URL", () => {
    const snippet = generateCodeSnippet(endpoint, example, "go");
    expect(snippet).toMatch(/http\.(NewRequest|Get)/);
    expect(snippet).toContain('"https://api.example.com/users/user_123"');
    expect(snippet).toContain('req.Header.Set("Authorization", "Bearer token")');
  });
});

describe("generateCodeSnippet — Rust", () => {
  test("contains reqwest::Client and the URL", () => {
    const snippet = generateCodeSnippet(endpoint, example, "rust");
    expect(snippet).toMatch(/reqwest::(Client|get)/);
    expect(snippet).toContain('"https://api.example.com/users/user_123"');
    expect(snippet).toContain(".header(\"Authorization\", \"Bearer token\")");
  });
});

describe("URL building helpers", () => {
  test("buildUrl fills path params and adds query string", () => {
    const ex: ExampleRequest = {
      params: { userId: "user_123", limit: 20 },
      headers: {},
    };
    const { url } = buildUrl(endpoint, ex, "https://api.example.com");
    expect(url).toBe("https://api.example.com/users/user_123?limit=20");
  });
  test("buildHeaders merges example headers + endpoint header params", () => {
    const ep: Endpoint = {
      ...endpoint,
      parameters: [
        ...endpoint.parameters,
        { name: "X-Trace", in: "header", required: false, example: "1" },
      ],
    };
    const ex: ExampleRequest = { params: { userId: "u1" }, headers: { Authorization: "Bearer t" } };
    const headers = buildHeaders(ep, ex);
    expect(headers.Authorization).toBe("Bearer t");
    expect(headers["X-Trace"]).toBe("1");
  });
});
