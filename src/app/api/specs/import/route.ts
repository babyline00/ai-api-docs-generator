import { NextResponse } from "next/server";
import yaml from "js-yaml";

import { db } from "@/lib/db";
import { parseOpenApi3, looksLikeOpenApi, pickServerUrl } from "@/lib/spec-parser";
import { parsePostmanV21, looksLikePostman } from "@/lib/postman-parser";
import { generateExamplesForEndpoint } from "@/lib/example-generator";
import { getChatProvider } from "@/lib/ai";
import { diffSpecs } from "@/lib/changelog-diff";
import { parseStoredSpec } from "@/lib/serialize";
import type { ParsedSpec } from "@/lib/types";

interface ImportBody {
  rawSpec: string;
  sourceType?: string;
  name?: string;
}

/** Parse a raw spec string (JSON or YAML) into a plain object. */
function parseRawDocument(raw: string): any {
  const trimmed = raw.trim();
  // Try JSON first (handles compact JSON specs).
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to YAML */
  }
  try {
    return yaml.load(trimmed);
  } catch (e) {
    throw new Error(`Spec is neither valid JSON nor YAML: ${(e as Error).message}`);
  }
}

/** Auto-detect the source format from the document shape. */
function detectSourceType(doc: any, requested: string): "openapi" | "postman" {
  if (requested === "openapi") return "openapi";
  if (requested === "postman") return "postman";
  if (looksLikePostman(doc)) return "postman";
  if (looksLikeOpenApi(doc)) return "openapi";
  // Default to OpenAPI — most common case.
  return "openapi";
}

export async function POST(req: Request) {
  let rawSpec = "";
  let sourceType = "auto";
  let name = "Imported spec";

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file");
      if (file instanceof File) {
        rawSpec = await file.text();
        name = (fd.get("name") as string) || file.name.replace(/\.(json|yaml|yml)$/i, "");
        sourceType = (fd.get("sourceType") as string) || "auto";
      } else {
        rawSpec = (fd.get("rawSpec") as string) ?? "";
        name = (fd.get("name") as string) || "Imported spec";
        sourceType = (fd.get("sourceType") as string) || "auto";
      }
    } else {
      const body = (await req.json()) as ImportBody;
      rawSpec = body.rawSpec ?? "";
      sourceType = body.sourceType ?? "auto";
      name = body.name || "Imported spec";
    }
  } catch (e) {
    return NextResponse.json({ error: `Failed to read request: ${(e as Error).message}` }, { status: 400 });
  }

  if (!rawSpec.trim()) {
    return NextResponse.json({ error: "Empty spec." }, { status: 400 });
  }

  // Parse the document.
  let doc: any;
  try {
    doc = parseRawDocument(rawSpec);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Parse into the unified shape.
  const resolvedSourceType = detectSourceType(doc, sourceType);
  let parsed: ParsedSpec;
  try {
    parsed = resolvedSourceType === "postman" ? parsePostmanV21(doc) : parseOpenApi3(doc);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const serverUrl = pickServerUrl(parsed.servers);

  // Find the previous version of this spec (same name) to diff against.
  let previousSpec: Awaited<ReturnType<typeof db.apiSpec.findFirst>> = null;
  try {
    previousSpec = await db.apiSpec.findFirst({
      where: { name },
      orderBy: { createdAt: "desc" },
    });
  } catch (e) {
    console.warn("[import] previous-spec lookup failed:", (e as Error).message);
  }

  // Generate examples for every endpoint via the AI provider (falls back to a
  // deterministic heuristic when the LLM is unavailable).
  const provider = getChatProvider();
  const endpointsWithExamples = await Promise.all(
    parsed.endpoints.map(async (ep) => {
      let examples: any[] = [];
      try {
        examples = await generateExamplesForEndpoint(ep, provider);
      } catch (e) {
        console.warn("[import] example generation failed for", ep.path, (e as Error).message);
        examples = [];
      }
      return { ep, examples };
    }),
  );

  // Persist the ApiSpec + Endpoints.
  let createdSpec: Awaited<ReturnType<typeof db.apiSpec.create>>;
  try {
    createdSpec = await db.apiSpec.create({
      data: {
        name,
        version: parsed.info.version,
        sourceType: resolvedSourceType,
        rawSpec,
        parsedSpec: JSON.stringify(parsed),
        serverUrl,
        endpoints: {
          create: endpointsWithExamples.map(({ ep, examples }) => ({
            method: ep.method,
            path: ep.path,
            summary: ep.summary ?? null,
            description: ep.description ?? null,
            parameters: JSON.stringify(ep.parameters ?? []),
            requestBody: ep.requestBody ? JSON.stringify(ep.requestBody) : null,
            responses: JSON.stringify(ep.responses ?? {}),
            examples: JSON.stringify(examples ?? []),
            tags: JSON.stringify(ep.tags ?? []),
          })),
        },
      },
      include: { endpoints: true },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Persist failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  // Compute changelog against the previous version, if any.
  let changelogCount = 0;
  if (previousSpec) {
    const prevParsed = parseStoredSpec(previousSpec.parsedSpec);
    if (prevParsed) {
      const diffs = diffSpecs(prevParsed, parsed);
      if (diffs.length) {
        try {
          await db.changelogEntry.createMany({
            data: diffs.map((d) => ({
              specId: createdSpec.id,
              changeType: d.changeType,
              method: d.method ?? null,
              path: d.path ?? null,
              description: d.description,
              fromVersion: d.fromVersion ?? null,
              toVersion: d.toVersion ?? null,
            })),
          });
          changelogCount = diffs.length;
        } catch (e) {
          console.warn("[import] changelog persist failed:", (e as Error).message);
        }
      }
    }
  }

  return NextResponse.json({
    spec: {
      id: createdSpec.id,
      name: createdSpec.name,
      version: createdSpec.version,
      sourceType: createdSpec.sourceType,
      endpointCount: createdSpec.endpoints.length,
      createdAt: createdSpec.createdAt.toISOString(),
      changelogCount,
    },
  });
}
