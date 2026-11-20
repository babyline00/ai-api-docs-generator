import { test, expect, describe } from "bun:test";
import { diffSpecs } from "@/lib/changelog-diff";
import type { Endpoint, ParsedSpec } from "@/lib/types";

function ep(method: string, path: string, opts: Partial<Endpoint> = {}): Endpoint {
  return {
    method: method as any,
    path,
    tags: [],
    parameters: opts.parameters ?? [],
    responses: opts.responses ?? {},
    ...opts,
  };
}

function spec(endpoints: Endpoint[], version = "1.0.0"): ParsedSpec {
  return { info: { title: "x", version }, servers: [], endpoints };
}

describe("diffSpecs", () => {
  test("added endpoint", () => {
    const old = spec([ep("GET", "/a")]);
    const next = spec([ep("GET", "/a"), ep("POST", "/b")], "1.1.0");
    const diffs = diffSpecs(old, next);
    const added = diffs.find((d) => d.changeType === "added");
    expect(added).toBeTruthy();
    expect(added!.method).toBe("POST");
    expect(added!.path).toBe("/b");
    expect(added!.toVersion).toBe("1.1.0");
    expect(added!.description).toContain("Added: POST /b");
  });

  test("removed endpoint", () => {
    const old = spec([ep("GET", "/a"), ep("DELETE", "/c")]);
    const next = spec([ep("GET", "/a")], "2.0.0");
    const diffs = diffSpecs(old, next);
    const removed = diffs.find((d) => d.changeType === "removed");
    expect(removed).toBeTruthy();
    expect(removed!.method).toBe("DELETE");
    expect(removed!.path).toBe("/c");
    expect(removed!.fromVersion).toBe("1.0.0");
  });

  test("modified response schema (different field count)", () => {
    const old200 = {
      description: "ok",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" } },
          },
        },
      },
    };
    const new200 = {
      description: "ok",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string" } },
          },
        },
      },
    };
    const old = spec([ep("GET", "/users", { responses: { "200": old200 } })]);
    const next = spec([ep("GET", "/users", { responses: { "200": new200 } })], "1.1.0");
    const diffs = diffSpecs(old, next);
    const modified = diffs.find((d) => d.changeType === "modified");
    expect(modified).toBeTruthy();
    expect(modified!.description).toContain("response 200 schema");
    expect(modified!.description).toContain("2 -> 3");
  });

  test("unchanged endpoint produces no entry", () => {
    const old200 = {
      description: "ok",
      content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } },
    };
    const e = ep("GET", "/a", { responses: { "200": old200 } });
    const old = spec([e]);
    const next = spec([e]);
    const diffs = diffSpecs(old, next);
    expect(diffs).toHaveLength(0);
  });

  test("parameter count change is detected as modified", () => {
    const old = spec([ep("GET", "/a", { parameters: [{ name: "x", in: "query", required: false }] })]);
    const next = spec([ep("GET", "/a", { parameters: [{ name: "x", in: "query", required: false }, { name: "y", in: "query", required: false }] })]);
    const diffs = diffSpecs(old, next);
    expect(diffs.find((d) => d.changeType === "modified")?.description).toContain("parameters");
  });

  test("multiple changes at once", () => {
    const old = spec([ep("GET", "/a"), ep("DELETE", "/old")]);
    const next = spec([ep("GET", "/a"), ep("POST", "/new")]);
    const diffs = diffSpecs(old, next);
    expect(diffs).toHaveLength(2);
    expect(diffs.some((d) => d.changeType === "added")).toBe(true);
    expect(diffs.some((d) => d.changeType === "removed")).toBe(true);
  });
});
