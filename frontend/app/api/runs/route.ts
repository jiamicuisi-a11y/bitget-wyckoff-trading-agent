import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKER = process.env.QUANT_WORKER_URL || "http://127.0.0.1:8810";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = url.searchParams.get("id")
    ? `?id=${encodeURIComponent(url.searchParams.get("id") || "")}`
    : `?limit=${encodeURIComponent(url.searchParams.get("limit") || "50")}`;
  try {
    const response = await fetch(`${WORKER}/api/runs${query}`, { cache: "no-store" });
    const json = await response.json();
    return NextResponse.json(json, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "运行记录服务不可用", workerOffline: true }, { status: 502 });
  }
}
