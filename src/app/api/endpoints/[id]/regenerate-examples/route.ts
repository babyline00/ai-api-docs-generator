import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { endpointRowToEndpoint } from "@/lib/serialize";
import { generateExamplesForEndpoint } from "@/lib/example-generator";
import { getChatProvider } from "@/lib/ai";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const row = await db.endpoint.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const endpoint = endpointRowToEndpoint(row);
    const provider = getChatProvider();
    const examples = await generateExamplesForEndpoint(endpoint, provider);
    await db.endpoint.update({
      where: { id },
      data: { examples: JSON.stringify(examples) },
    });
    return NextResponse.json({ examples });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
