import { test, expect, describe } from "bun:test";
import { parseOpenApi3, pickServerUrl, looksLikeOpenApi, SpecParseError } from "@/lib/spec-parser";

const standardSpec: any = {
  openapi: "3.0.0",
  info: { title: "User Service", version: "1.2.0", description: "User mgmt API" },
  servers: [{ url: "https://api.example.com", description: "prod" }],
  paths: {
    "/v1/users": {
      get: {
        summary: "List users",
        tags: ["Users"],
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          { name: "page", in: "query", required: false, schema: { type: "integer", example: 1 } },
        ],
        responses: {
          "200": {
            description: "A page of users",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { id: { type: "string" }, name: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Create user",
        tags: ["Users"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } },
        },
        responses: { "201": { description: "Created" } },
      },
    },
    "/v1/users/{userId}": {
      get: {
        summary: "Get a user",
        tags: ["Users"],
        parameters: [
          { name: "userId", in: "path", required: true, schema: { type: "string", example: "user_123" } },
        ],
        responses: { "200": { description: "A user" } },
      },
    },
  },
};

describe("parseOpenApi3", () => {
  test("standard spec parses info + servers + endpoints", () => {
    const parsed = parseOpenApi3(standardSpec);
    expect(parsed.info.title).toBe("User Service");
    expect(parsed.info.version).toBe("1.2.0");
    expect(parsed.servers[0].url).toBe("https://api.example.com");
    expect(parsed.endpoints).toHaveLength(3);
  });

  test("endpoint method/path/tags are normalised", () => {
    const parsed = parseOpenApi3(standardSpec);
    const list = parsed.endpoints.find((e) => e.method === "GET" && e.path === "/v1/users");
    expect(list).toBeTruthy();
    expect(list!.tags).toContain("Users");
    expect(list!.parameters).toHaveLength(2);
  });

  test("path parameters keep their required flag", () => {
    const parsed = parseOpenApi3(standardSpec);
    const getOne = parsed.endpoints.find((e) => e.path === "/v1/users/{userId}")!;
    expect(getOne.parameters[0].in).toBe("path");
    expect(getOne.parameters[0].required).toBe(true);
  });

  test("spec with $ref inlines the reference", () => {
    const spec: any = {
      openapi: "3.0.0",
      info: { title: "Ref API", version: "1.0.0" },
      paths: {
        "/widgets/{id}": {
          get: {
            parameters: [{ $ref: "#/components/parameters/WidgetId" }],
            responses: {
              "200": {
                description: "ok",
                content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" } } },
              },
            },
          },
        },
      },
      components: {
        parameters: {
          WidgetId: { name: "id", in: "path", required: true, schema: { type: "string" } },
        },
        schemas: {
          Widget: {
            type: "object",
            properties: { id: { type: "string" }, size: { type: "integer" } },
          },
        },
      },
    };
    const parsed = parseOpenApi3(spec);
    const ep = parsed.endpoints[0];
    expect(ep.parameters[0].name).toBe("id");
    expect(ep.parameters[0].required).toBe(true);
    const schema = ep.responses["200"]?.content?.["application/json"]?.schema;
    expect(schema?.type).toBe("object");
    expect(schema?.properties?.id).toBeTruthy();
  });

  test("spec with no servers defaults to '/'", () => {
    const spec: any = {
      openapi: "3.0.0",
      info: { title: "No servers", version: "1.0.0" },
      paths: { "/ping": { get: { responses: { "200": { description: "pong" } } } } },
    };
    const parsed = parseOpenApi3(spec);
    expect(parsed.servers).toEqual([{ url: "/" }]);
  });

  test("malformed spec throws SpecParseError", () => {
    expect(() => parseOpenApi3({ foo: "bar" })).toThrow(SpecParseError);
    expect(() => parseOpenApi3(null)).toThrow();
  });

  test("looksLikeOpenApi detects openapi vs non-openapi", () => {
    expect(looksLikeOpenApi(standardSpec)).toBe(true);
    expect(looksLikeOpenApi({ info: { name: "x" }, item: [] })).toBe(false);
  });

  test("pickServerUrl prefers the first absolute URL", () => {
    expect(pickServerUrl([{ url: "/api" }])).toBe("/api");
    expect(pickServerUrl([{ url: "/rel" }, { url: "https://abs.example.com" }])).toBe("https://abs.example.com");
    expect(pickServerUrl([])).toBe(null);
  });
});
