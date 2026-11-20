/**
 * Pluggable AI layer used for example-request generation. Unlike the parent
 * project's streaming ChatProvider, this one exposes a single non-streaming
 * `complete()` call because example generation is a one-shot structured task
 * (we want the whole JSON back, not a token stream).
 *
 * `ZaiProvider` wraps the z-ai-web-dev-sdk chat completion endpoint with
 * `stream:false`. `MockProvider` returns deterministic example JSON so the
 * app (and the test suite) stays demoable offline.
 */

import type { Endpoint, ExampleRequest } from "@/lib/types";

export interface ChatProvider {
  /** Non-streaming completion. Returns the full assistant message text. */
  complete(args: {
    systemPrompt: string;
    messages: { role: "user" | "assistant" | "system"; content: string }[];
  }): Promise<string>;
}

let cachedProvider: ChatProvider | null = null;

class ZaiProvider implements ChatProvider {
  async complete(args: {
    systemPrompt: string;
    messages: { role: "user" | "assistant" | "system"; content: string }[];
  }): Promise<string> {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const messages = [
      { role: "system" as const, content: args.systemPrompt },
      ...args.messages,
    ];
    const completion: any = await zai.chat.completions.create({
      messages,
      stream: false,
      thinking: { type: "disabled" },
    });
    // Non-streaming completion object — extract the single message.
    if (typeof completion === "string") return completion;
    const content =
      completion?.choices?.[0]?.message?.content ??
      completion?.choices?.[0]?.text ??
      (typeof completion === "string" ? completion : "");
    return typeof content === "string" ? content : JSON.stringify(content ?? "");
  }
}

/**
 * Deterministic mock used by tests and when the SDK config is unavailable.
 * When the prompt looks like an example-generation request it returns a
 * plausible JSON array of example requests derived from the endpoint shape
 * embedded in the prompt; otherwise it echoes a short acknowledgement.
 */
class MockProvider implements ChatProvider {
  async complete(args: {
    systemPrompt: string;
    messages: { role: "user" | "assistant" | "system"; content: string }[];
  }): Promise<string> {
    const lastUser = [...args.messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.content ?? "";
    if (/example request|examples as json|generate.*example/i.test(text)) {
      const examples = mockExamplesFromPrompt(text);
      return JSON.stringify(examples);
    }
    return `**[mock assistant]** ${text.slice(0, 120)}`;
  }
}

/** Build deterministic example requests from the endpoint JSON embedded in the prompt. */
function mockExamplesFromPrompt(promptText: string): ExampleRequest[] {
  let endpoint: Endpoint | undefined;
  // The prompt embeds the endpoint as a fenced JSON block. Pull it out.
  const fence = promptText.match(/```json\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : promptText;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      endpoint = JSON.parse(raw.slice(start, end + 1));
    } catch {
      endpoint = undefined;
    }
  }
  const params: Record<string, any> = {};
  const headers: Record<string, string> = {};
  let body: any = undefined;
  if (endpoint) {
    for (const p of endpoint.parameters ?? []) {
      if (p.example != null) params[p.name] = p.example;
      else if (p.schema?.example != null) params[p.name] = p.schema.example;
      else params[p.name] = guessValueFor(p.name, p.schema);
    }
    if (endpoint.requestBody?.content?.["application/json"]?.example) {
      body = endpoint.requestBody.content["application/json"].example;
    } else if (endpoint.requestBody?.content?.["application/json"]?.schema) {
      body = sampleFromSchema(endpoint.requestBody.content["application/json"].schema);
    }
  }
  const ex: ExampleRequest = {
    label: "Default example",
    params,
    headers,
    ...(body != null ? { body } : {}),
  };
  return [ex];
}

function guessValueFor(name: string, schema?: any): any {
  const n = (name || "").toLowerCase();
  if (/id$/.test(n)) return `user_123`;
  if (/email/.test(n)) return "alice@example.com";
  if (/page|limit|size|count/.test(n)) return 20;
  if (/sort|order/.test(n)) return "asc";
  if (/name/.test(n)) return "Alice";
  if (schema?.type === "integer" || schema?.type === "number") return 1;
  if (schema?.type === "boolean") return true;
  if (schema?.enum?.length) return schema.enum[0];
  return "sample";
}

function sampleFromSchema(schema: any): any {
  if (!schema) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.$ref) return {};
  switch (schema.type) {
    case "object": {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        out[k] = sampleFromSchema(v);
      }
      return out;
    }
    case "array":
      return [sampleFromSchema(schema.items)];
    case "integer":
    case "number":
      return schema.enum?.[0] ?? 0;
    case "boolean":
      return false;
    case "string":
      return schema.enum?.[0] ?? guessValueFor(schema.format ? `_${schema.format}` : "");
    default:
      return null;
  }
}

export function getChatProvider(): ChatProvider {
  if (cachedProvider) return cachedProvider;
  if (process.env.PKC_DISABLE_LLM === "1") {
    cachedProvider = new MockProvider();
    return cachedProvider;
  }
  try {
    cachedProvider = new ZaiProvider();
  } catch (e) {
    console.warn("[ai] ZaiProvider unavailable, using MockProvider:", (e as Error).message);
    cachedProvider = new MockProvider();
  }
  return cachedProvider;
}

/** Test-only. */
export function __setChatProviderForTest(p: ChatProvider | null) {
  cachedProvider = p;
}

export { MockProvider, ZaiProvider };
