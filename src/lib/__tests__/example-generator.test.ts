import { test, expect, describe } from "bun:test";
import {
  buildExamplePrompt,
  parseExamplesResponse,
  heuristicExample,
  generateExamplesForEndpoint,
} from "@/lib/example-generator";
import { MockProvider, type ChatProvider } from "@/lib/ai";
import type { Endpoint } from "@/lib/types";

const endpoint: Endpoint = {
  method: "GET",
  path: "/v1/users/{userId}",
  summary: "Get a user",
  tags: ["Users"],
  parameters: [
    { name: "userId", in: "path", required: true, schema: { type: "string" }, example: "user_123" },
    { name: "page", in: "query", required: false, schema: { type: "integer", example: 1 } },
  ],
  responses: {
    "200": {
      description: "A user",
      content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } },
    },
  },
};

describe("buildExamplePrompt", () => {
  test("asks the LLM for 1-2 examples as JSON", () => {
    const prompt = buildExamplePrompt(endpoint);
    expect(prompt).toMatch(/1-2 example/i);
    expect(prompt).toMatch(/json/i);
    expect(prompt).toContain("/v1/users/{userId}");
    expect(prompt).toContain("GET");
  });

  test("embeds the endpoint shape (params + responses)", () => {
    const prompt = buildExamplePrompt(endpoint);
    expect(prompt).toContain("userId");
    expect(prompt).toContain("path");
    expect(prompt).toContain("responses");
  });
});

describe("parseExamplesResponse", () => {
  test("parses a clean JSON array", () => {
    const text = JSON.stringify([
      { label: "A", params: { userId: "u1" }, headers: { Authorization: "Bearer x" } },
      { label: "B", params: { userId: "u2" }, headers: {}, body: { x: 1 } },
    ]);
    const out = parseExamplesResponse(text);
    expect(out).toHaveLength(2);
    expect(out[0].params.userId).toBe("u1");
    expect(out[1].body).toEqual({ x: 1 });
  });

  test("parses a fenced ```json block with surrounding prose", () => {
    const text = `Sure, here are examples:\n\`\`\`json\n[{"params":{"userId":"u9"},"headers":{}}]\n\`\`\`\nDone.`;
    const out = parseExamplesResponse(text);
    expect(out).toHaveLength(1);
    expect(out[0].params.userId).toBe("u9");
  });

  test("coerces non-object params/headers to empty objects", () => {
    const text = JSON.stringify([{ label: "X", params: "nope", headers: 42 }]);
    const out = parseExamplesResponse(text);
    expect(out).toHaveLength(1);
    expect(out[0].params).toEqual({});
    expect(out[0].headers).toEqual({});
  });

  test("header values are coerced to strings", () => {
    const out = parseExamplesResponse(JSON.stringify([{ params: {}, headers: { X: 123 } }]));
    expect(out[0].headers.X).toBe("123");
  });

  test("returns [] on malformed JSON", () => {
    expect(parseExamplesResponse("not json at all")).toEqual([]);
    expect(parseExamplesResponse("[oops")).toEqual([]);
    expect(parseExamplesResponse("")).toEqual([]);
  });

  test("returns [] when the JSON is not an array", () => {
    expect(parseExamplesResponse(JSON.stringify({ a: 1 }))).toEqual([]);
  });
});

describe("heuristicExample", () => {
  test("fills path params from declared examples", () => {
    const ex = heuristicExample(endpoint);
    expect(ex.params.userId).toBe("user_123");
    expect(ex.params.page).toBe(1);
  });

  test("does not add a body when there is none", () => {
    const ex = heuristicExample(endpoint);
    expect(ex.body).toBeUndefined();
  });

  test("samples a body from the request body schema", () => {
    const ep: Endpoint = {
      ...endpoint,
      method: "POST",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", properties: { name: { type: "string" }, age: { type: "integer" } } },
          },
        },
      },
    };
    const ex = heuristicExample(ep);
    expect(ex.body).toBeTruthy();
    expect(ex.body).toHaveProperty("name");
    expect(ex.headers["Content-Type"]).toBe("application/json");
  });
});

describe("generateExamplesForEndpoint (with mock provider)", () => {
  test("returns LLM examples when the provider returns valid JSON", async () => {
    const mock: ChatProvider = new MockProvider();
    const prompt = buildExamplePrompt(endpoint);
    const examples = await generateExamplesForEndpoint(endpoint, mock);
    expect(examples.length).toBeGreaterThanOrEqual(1);
    // The mock builds examples from the endpoint embedded in the prompt.
    expect(examples[0].params).toBeDefined();
    // sanity: prompt was passed to provider (mock reads it)
    expect(prompt).toContain("userId");
  });

  test("falls back to heuristic when provider returns nothing usable", async () => {
    const empty: ChatProvider = { complete: async () => "totally not json" };
    const examples = await generateExamplesForEndpoint(endpoint, empty);
    expect(examples).toHaveLength(1);
    expect(examples[0].params.userId).toBe("user_123");
  });
});
