import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { endpointRowToEndpoint } from "@/lib/serialize";
import { buildProxyRequest, executeProxyRequest } from "@/lib/playground";

interface PlaygroundBody {
  params: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
  serverUrl?: string;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: PlaygroundBody;
  try {
    body = (await req.json()) as PlaygroundBody;
  } catch (e) {
    return NextResponse.json({ error: `Invalid JSON body: ${(e as Error).message}` }, { status: 400 });
  }

  try {
    const row = await db.endpoint.findUnique({
      where: { id },
      include: { spec: { select: { serverUrl: true } } },
    });
    if (!row) return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });

    const endpoint = endpointRowToEndpoint(row);
    const serverUrl = body.serverUrl ?? row.spec.serverUrl ?? "";

    if (!serverUrl || !/^https?:\/\//i.test(serverUrl)) {
      return NextResponse.json(
        {
          error:
            "No absolute server URL configured. Set a server URL on the spec or override it in the playground.",
          status: 0,
          statusText: "No server",
          headers: {},
          body: "",
          durationMs: 0,
        },
        { status: 400 },
      );
    }

    const proxyReq = buildProxyRequest(
      endpoint,
      body.params ?? {},
      body.body,
      body.headers ?? {},
      serverUrl,
    );

    const result = await executeProxyRequest(proxyReq, fetch);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        status: 0,
        statusText: "Proxy error",
        headers: {},
        body: (e as Error).message,
        durationMs: 0,
      },
      { status: 500 },
    );
  }
}
