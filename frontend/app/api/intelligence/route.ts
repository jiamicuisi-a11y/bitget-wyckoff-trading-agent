import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKER = process.env.QUANT_WORKER_URL || "http://127.0.0.1:8810";
const TIMEOUT_MS = 8_000;
const SOURCES = new Set(["all", "binance_activity", "binance_announcement", "binance_listing"]);
const TYPES = new Set(["all", "activity", "announcement", "news"]);

async function pass(path: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${WORKER}${path}`, { cache: "no-store", signal: controller.signal });
    const json = await response.json();
    return NextResponse.json(json, { status: response.status });
  } catch (error: any) {
    const offline = error?.name === "AbortError" || error?.code === "ECONNREFUSED";
    return NextResponse.json({ error: offline ? "市场情报服务暂时无响应" : error?.message || "市场情报读取失败", workerOffline: offline }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "feed";
  const source = url.searchParams.get("source") || "all";
  const type = url.searchParams.get("type") || "all";
  const asset = (url.searchParams.get("asset") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 60), 1), 100);
  if (!SOURCES.has(source)) return NextResponse.json({ error: "不支持的数据源" }, { status: 400 });
  if (!TYPES.has(type)) return NextResponse.json({ error: "不支持的事件类型" }, { status: 400 });
  if (view === "event") {
    const id = url.searchParams.get("id");
    if (!id || id.length > 240) return NextResponse.json({ error: "缺少有效事件 ID" }, { status: 400 });
    return pass(`/api/intelligence/event?id=${encodeURIComponent(id)}`);
  }
  if (view === "activities") return pass(`/api/intelligence/activities?asset=${encodeURIComponent(asset)}&limit=${limit}`);
  return pass(`/api/intelligence/feed?source=${encodeURIComponent(source)}&type=${encodeURIComponent(type)}&asset=${encodeURIComponent(asset)}&limit=${limit}`);
}
