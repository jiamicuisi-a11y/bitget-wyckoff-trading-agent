import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 模拟盘数据代理。
 *
 * 真正跑模拟盘的是同机的「量化 worker」（多策略 Node 进程，默认 127.0.0.1:8810），
 * 它负责定时扫描全市场、按各策略自动模拟开/平仓、把数据写进 SQLite。本路由只是把
 * worker 的状态读出来转发给前端，避免浏览器直连 worker 带来的跨域/暴露问题。
 *
 * worker 地址用环境变量 QUANT_WORKER_URL 覆盖，默认 http://127.0.0.1:8810。
 *
 * view 参数决定读哪个 worker 接口：
 *   strategies          -> /api/strategies（策略列表 + 各自摘要）
 *   state&strategy=x     -> /api/state?strategy=x
 *   equity&strategy=x    -> /api/equity?strategy=x
 *   closed&strategy=x    -> /api/closed?strategy=x&limit=
 *   klines&symbol=x      -> /api/klines?symbol=x&granularity=&limit=
 *   options-arb          -> /api/options-arb?currency=&minBoxEdgePct=&minParityEdgePct=&r=
 */
const WORKER = process.env.QUANT_WORKER_URL || "http://127.0.0.1:8810";
const TIMEOUT_MS = 8000;

async function pass(path: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER}${path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `worker HTTP ${res.status}`, workerOffline: true },
        { status: 502 }
      );
    }
    const json = await res.json();
    return NextResponse.json(json);
  } catch (e: any) {
    const offline = e?.name === "AbortError" || e?.code === "ECONNREFUSED";
    return NextResponse.json(
      {
        error: offline ? "模拟盘 worker 未运行或无响应" : e?.message || "未知错误",
        workerOffline: true,
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "state";
  const strategy = encodeURIComponent(url.searchParams.get("strategy") || "anomaly");

  if (view === "strategies") return pass("/api/strategies");
  if (view === "equity") return pass(`/api/equity?strategy=${strategy}`);
  if (view === "closed") {
    const limit = url.searchParams.get("limit") || "50";
    const offset = url.searchParams.get("offset") || "0";
    return pass(`/api/closed?strategy=${strategy}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`);
  }
  if (view === "klines") {
    const symbol = encodeURIComponent(url.searchParams.get("symbol") || "BTCUSDT");
    const gran = encodeURIComponent(url.searchParams.get("granularity") || "1H");
    const limit = encodeURIComponent(url.searchParams.get("limit") || "200");
    return pass(`/api/klines?strategy=${strategy}&symbol=${symbol}&granularity=${gran}&limit=${limit}`);
  }
  if (view === "options-arb") {
    const currency = encodeURIComponent(url.searchParams.get("currency") || "BTC");
    const minBoxEdgePct = encodeURIComponent(url.searchParams.get("minBoxEdgePct") || "0.05");
    const minParityEdgePct = encodeURIComponent(url.searchParams.get("minParityEdgePct") || "0.1");
    const r = encodeURIComponent(url.searchParams.get("r") || "0.05");
    return pass(`/api/options-arb?currency=${currency}&minBoxEdgePct=${minBoxEdgePct}&minParityEdgePct=${minParityEdgePct}&r=${r}`);
  }
  return pass(`/api/state?strategy=${strategy}`);
}
