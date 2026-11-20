import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const [specs, endpoints, changelogs] = await Promise.all([
      db.apiSpec.count(),
      db.endpoint.count(),
      db.changelogEntry.count(),
    ]);
    return NextResponse.json({ specs, endpoints, changelogs });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, specs: 0, endpoints: 0, changelogs: 0 },
      { status: 500 },
    );
  }
}
