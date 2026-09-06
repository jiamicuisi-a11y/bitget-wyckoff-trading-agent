import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKER = process.env.QUANT_WORKER_URL || "http://127.0.0.1:8810";
const TIMEOUT_MS = 8000;

/**
 * Track A Agent Tool Layer 代理。
 *
 * 页面只把用户意图和当前策略交给同机 worker。worker 负责读取最新的
 * Binance 公共行情扫描结果，执行策略判断和 Risk Gate，并返回不可广播的
 * Paper Plan。这个路由不接收、不保存、不转发任何账户密钥。
 */
export async function POST(req: Request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const input = await req.json();
    const response = await fetch(`${WORKER}/api/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await response.json();
    return NextResponse.json(json, { status: response.status });
  } catch (error: any) {
    const offline = error?.name === "AbortError" || error?.code === "ECONNREFUSED";
    return NextResponse.json({
      ok: false,
      error: offline ? "Agent Tool Layer worker 未运行或无响应" : error?.message || "Agent Tool Layer 请求失败",
      workerOffline: offline,
    }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
