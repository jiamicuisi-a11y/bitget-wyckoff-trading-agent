import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKER = process.env.QUANT_WORKER_URL || "http://127.0.0.1:8810";
const TIMEOUT_MS = 12_000;

export async function POST(req: Request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const input = await req.json();
    const response = await fetch(`${WORKER}/api/agent/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), cache: "no-store", signal: controller.signal });
    const json = await response.json();
    return NextResponse.json(json, { status: response.status });
  } catch (error: any) {
    const offline = error?.name === "AbortError" || error?.code === "ECONNREFUSED";
    return NextResponse.json({ ok: false, error: offline ? "Agent Tool Layer worker 未运行或无响应" : error?.message || "Agent Tool Layer 请求失败", workerOffline: offline, broadcast: false }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
