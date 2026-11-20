import { test, expect, describe } from "bun:test";
import { parsePostmanV21, looksLikePostman } from "@/lib/postman-parser";
import { SpecParseError } from "@/lib/spec-parser";

const collection: any = {
  info: {
    name: "User Service Collection",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    version: "2.0.0",
  },
  variable: [{ key: "baseUrl", value: "https://api.example.com" }],
  item: [
    {
      name: "Users",
      item: [
        {
          name: "List users",
          request: {
            method: "GET",
            header: [{ key: "Authorization", value: "Bearer token" }],
            url: {
              raw: "{{baseUrl}}/v1/users?page=1&limit=20",
              host: ["{{baseUrl}}"],
              path: ["v1", "users"],
              query: [
                { key: "page", value: "1" },
                { key: "limit", value: "20" },
              ],
            },
          },
        },
        {
          name: "Create user",
          request: {
            method: "POST",
            header: [{ key: "Content-Type", value: "application/json" }],
            url: { raw: "{{baseUrl}}/v1/users", path: ["v1", "users"] },
            body: {
              mode: "raw",
              raw: '{"name": "Alice", "email": "alice@example.com"}',
              options: { raw: { language: "json" } },
            },
          },
        },
      ],
    },
    {
      name: "Get user by id",
      request: {
        method: "GET",
        url: {
          raw: "{{baseUrl}}/v1/users/:userId",
          path: ["v1", "users", ":userId"],
          variable: [{ key: "userId", value: "user_123" }],
        },
      },
    },
  ],
};

describe("parsePostmanV21", () => {
  test("parses info + servers + endpoints", () => {
    const parsed = parsePostmanV21(collection);
    expect(parsed.info.title).toBe("User Service Collection");
    expect(parsed.servers[0].url).toBe("https://api.example.com");
    expect(parsed.endpoints.length).toBe(3);
  });

  test("nested folders become tags", () => {
    const parsed = parsePostmanV21(collection);
    const list = parsed.endpoints.find((e) => e.summary === "List users")!;
    expect(list.tags).toContain("Users");
  });

  test("path variables become path params with the templated path", () => {
    const parsed = parsePostmanV21(collection);
    const getOne = parsed.endpoints.find((e) => e.method === "GET" && e.path.includes(":userId"))!;
    expect(getOne.path).toBe("/v1/users/:userId");
    const pathParam = getOne.parameters.find((p) => p.in === "path");
    expect(pathParam?.name).toBe("userId");
    expect(pathParam?.required).toBe(true);
  });

  test("query params + headers are captured", () => {
    const parsed = parsePostmanV21(collection);
    const list = parsed.endpoints.find((e) => e.summary === "List users")!;
    expect(list.parameters.some((p) => p.in === "query" && p.name === "page")).toBe(true);
    expect(list.parameters.some((p) => p.in === "header" && p.name === "Authorization")).toBe(true);
  });

  test("raw JSON body becomes a request body", () => {
    const parsed = parsePostmanV21(collection);
    const create = parsed.endpoints.find((e) => e.method === "POST")!;
    expect(create.requestBody).toBeTruthy();
    const json = create.requestBody!.content["application/json"];
    expect(json?.example).toEqual({ name: "Alice", email: "alice@example.com" });
  });

  test("malformed collection throws", () => {
    expect(() => parsePostmanV21({ info: { name: "x" } })).toThrow(SpecParseError);
    expect(() => parsePostmanV21(null)).toThrow();
  });

  test("looksLikePostman detects collection vs openapi", () => {
    expect(looksLikePostman(collection)).toBe(true);
    expect(looksLikePostman({ openapi: "3.0.0", paths: {} })).toBe(false);
  });
});
