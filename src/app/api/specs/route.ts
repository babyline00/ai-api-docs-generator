import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const specs = await db.apiSpec.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        version: true,
        sourceType: true,
        createdAt: true,
        _count: { select: { endpoints: true } },
      },
    });
    return NextResponse.json({
      specs: specs.map((s) => ({
        id: s.id,
        name: s.name,
        version: s.version,
        sourceType: s.sourceType,
        endpointCount: s._count.endpoints,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return NextResponse.json({ specs: [], error: (e as Error).message }, { status: 500 });
  }
}
