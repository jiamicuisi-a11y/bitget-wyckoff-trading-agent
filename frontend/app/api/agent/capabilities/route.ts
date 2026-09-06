import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKER = process.env.QUANT_WORKER_URL || "http://127.0.0.1:8810";

export async function GET() {
  try {
    const response = await fetch(`${WORKER}/api/agent/capabilities`, { cache: "no-store" });
    const json = await response.json();
    return NextResponse.json(json, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error?.message || "MCP 能力清单暂时不可用",
      strategies: [],
      tools: [],
    }, { status: 502 });
  }
}
