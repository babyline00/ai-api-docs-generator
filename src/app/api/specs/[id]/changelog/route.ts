import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const entries = await db.changelogEntry.findMany({
      where: { specId: id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      entries: entries.map((c) => ({
        id: c.id,
        changeType: c.changeType,
        method: c.method,
        path: c.path,
        description: c.description,
        fromVersion: c.fromVersion,
        toVersion: c.toVersion,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
