import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { endpointRowToView, type SpecFullView } from "@/lib/serialize";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const spec = await db.apiSpec.findUnique({
      where: { id },
      include: {
        endpoints: { orderBy: { path: "asc" } },
        changelogs: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!spec) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let info = { title: spec.name, version: spec.version };
    try {
      const parsed = JSON.parse(spec.parsedSpec);
      if (parsed?.info?.title) info = { ...info, ...parsed.info };
    } catch {
      /* ignore */
    }

    const view: SpecFullView = {
      id: spec.id,
      name: spec.name,
      version: spec.version,
      sourceType: spec.sourceType,
      serverUrl: spec.serverUrl,
      info: { title: info.title, version: info.version, description: info.description },
      endpoints: spec.endpoints.map(endpointRowToView),
      changelog: spec.changelogs.map((c) => ({
        id: c.id,
        changeType: c.changeType,
        method: c.method,
        path: c.path,
        description: c.description,
        fromVersion: c.fromVersion,
        toVersion: c.toVersion,
        createdAt: c.createdAt.toISOString(),
      })),
    };
    return NextResponse.json({ spec: view });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await db.apiSpec.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
