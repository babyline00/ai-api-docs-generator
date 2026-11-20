/**
 * Auto changelog — structural diff between two versions of the same API.
 *
 * Endpoints are keyed by `${METHOD} ${path}`. The diff produces:
 *   - "added"   — endpoint present in the new spec but not the old.
 *   - "removed" — endpoint present in the old spec but not the new.
 *   - "modified" — endpoint exists in both but a tracked field changed:
 *       * response 200/2xx schema field count differs
 *       * parameter count differs (or a required flag flipped)
 *       * request body required-ness changed
 * Unchanged endpoints produce no entry.
 */

import type { ChangelogEntryData, Endpoint, ParsedSpec } from "@/lib/types";

function keyOf(e: Endpoint): string {
  return `${e.method.toUpperCase()} ${e.path}`;
}

/** Count top-level properties of the 200/2xx JSON schema (0 when no schema). */
function responseFieldCount(e: Endpoint): number {
  const ok =
    e.responses["200"] ??
    e.responses["201"] ??
    e.responses["202"] ??
    e.responses["default"];
  const schema = ok?.content?.["application/json"]?.schema;
  if (!schema) return 0;
  if (schema.properties && typeof schema.properties === "object") {
    return Object.keys(schema.properties).length;
  }
  if (schema.items?.properties && typeof schema.items.properties === "object") {
    // Array response — count item properties
    return Object.keys(schema.items.properties).length;
  }
  return 0;
}

function paramFingerprint(e: Endpoint): { count: number; requiredCount: number } {
  const required = e.parameters.filter((p) => p.required).length;
  return { count: e.parameters.length, requiredCount: required };
}

function requestBodyPresent(e: Endpoint): boolean {
  return Boolean(e.requestBody && Object.keys(e.requestBody.content ?? {}).length > 0);
}

function describeModified(old: Endpoint, next: Endpoint): string | null {
  const reasons: string[] = [];
  const oldFields = responseFieldCount(old);
  const newFields = responseFieldCount(next);
  if (oldFields !== newFields) {
    reasons.push(`response 200 schema (${oldFields} -> ${newFields} fields)`);
  }
  const oldParams = paramFingerprint(old);
  const newParams = paramFingerprint(next);
  if (oldParams.count !== newParams.count) {
    reasons.push(`parameters (${oldParams.count} -> ${newParams.count})`);
  }
  if (oldParams.requiredCount !== newParams.requiredCount) {
    reasons.push(`required parameters (${oldParams.requiredCount} -> ${newParams.requiredCount})`);
  }
  if (requestBodyPresent(old) !== requestBodyPresent(next)) {
    reasons.push(`request body presence`);
  }
  return reasons.length ? reasons.join("; ") : null;
}

export function diffSpecs(
  oldSpec: { endpoints: Endpoint[]; info?: { version?: string } } | ParsedSpec,
  newSpec: { endpoints: Endpoint[]; info?: { version?: string } } | ParsedSpec,
): ChangelogEntryData[] {
  const oldMap = new Map<string, Endpoint>();
  for (const e of oldSpec.endpoints ?? []) oldMap.set(keyOf(e), e);
  const newMap = new Map<string, Endpoint>();
  for (const e of newSpec.endpoints ?? []) newMap.set(keyOf(e), e);

  const fromVersion = (oldSpec as any)?.info?.version ?? null;
  const toVersion = (newSpec as any)?.info?.version ?? null;

  const entries: ChangelogEntryData[] = [];

  // Added + modified (iterate over new)
  for (const [key, next] of newMap.entries()) {
    const old = oldMap.get(key);
    if (!old) {
      entries.push({
        changeType: "added",
        method: next.method,
        path: next.path,
        description: `Added: ${next.method} ${next.path}`,
        fromVersion,
        toVersion,
      });
      continue;
    }
    const reason = describeModified(old, next);
    if (reason) {
      entries.push({
        changeType: "modified",
        method: next.method,
        path: next.path,
        description: `Modified: ${next.method} ${next.path} — ${reason}`,
        fromVersion,
        toVersion,
      });
    }
  }

  // Removed
  for (const [key, old] of oldMap.entries()) {
    if (!newMap.has(key)) {
      entries.push({
        changeType: "removed",
        method: old.method,
        path: old.path,
        description: `Removed: ${old.method} ${old.path}`,
        fromVersion,
        toVersion,
      });
    }
  }

  return entries;
}
