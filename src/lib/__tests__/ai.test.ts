import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  MockProvider,
  getChatProvider,
  __setChatProviderForTest,
  type ChatProvider,
} from "@/lib/ai";
import { generateExamplesForEndpoint } from "@/lib/example-generator";
import type { Endpoint } from "@/lib/types";

const endpoint: Endpoint = {
  method: "POST",
  path: "/v1/users",
  summary: "Create user",
  tags: ["Users"],
  parameters: [
    { name: "userId", in: "path", required: true, schema: { type: "string" } },
    { name: "limit", in: "query", required: false, schema: { type: "integer", example: 1 } },
  ],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: { name: { type: "string" }, email: { type: "string" } },
        },
      },
    },
  },
  responses: { "201": { description: "created" } },
};

describe("MockProvider", () => {
  test("returns deterministic examples for an example-generation prompt", async () => {
    const provider: ChatProvider = new MockProvider();
    const { buildExamplePrompt } = await import("@/lib/example-generator");
    const prompt = buildExamplePrompt(endpoint);
    const raw = await provider.complete({
      systemPrompt: "sys",
      messages: [{ role: "user", content: prompt }],
    });
    expect(raw).toMatch(/^\s*\[/);
    const arr = JSON.parse(raw);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThanOrEqual(1);
    expect(arr[0].params).toBeDefined();
  });

  test("echoes short text for non-example prompts", async () => {
    const provider: ChatProvider = new MockProvider();
    const raw = await provider.complete({
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hello there" }],
    });
    expect(raw).toContain("hello there");
  });
});

describe("generateExamplesForEndpoint (mock integration)", () => {
  test("mock provider yields examples whose params include path + query params", async () => {
    const provider: ChatProvider = new MockProvider();
    const examples = await generateExamplesForEndpoint(endpoint, provider);
    expect(examples.length).toBeGreaterThanOrEqual(1);
    expect(examples[0].params).toHaveProperty("userId");
    expect(examples[0].params).toHaveProperty("limit");
    // the mock samples a body from the request body schema
    expect(examples[0].body).toBeTruthy();
    expect(examples[0].body).toHaveProperty("name");
  });
});

describe("getChatProvider caching", () => {
  beforeEach(() => __setChatProviderForTest(null));
  afterEach(() => __setChatProviderForTest(null));

  test("returns the same instance on repeated calls", () => {
    const a = getChatProvider();
    const b = getChatProvider();
    expect(a).toBe(b);
  });

  test("explicitly injected provider wins", () => {
    const fake: ChatProvider = { complete: async () => "injected" };
    __setChatProviderForTest(fake);
    expect(getChatProvider()).toBe(fake);
    expect(getChatProvider()).toBe(fake);
  });
});
