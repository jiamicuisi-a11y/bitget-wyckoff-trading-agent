import type { EquityPoint, IntelligenceFeed, Kline, StrategyKey, StrategyState, StrategySummary } from "./strategy-types";

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error || "")
      : "";
    throw new Error(detail || `请求失败：${response.status}`);
  }
  return payload as T;
}

export async function loadStrategies() {
  const data = await readJson<{ strategies: StrategySummary[] }>("/api/paper?view=strategies");
  return data.strategies.filter((strategy) => ["anomaly-binance", "dualma4h-binance", "box-breakout30m-binance"].includes(strategy.key));
}

export async function loadStrategyState(strategy: StrategyKey) {
  const [state, equity] = await Promise.all([
    readJson<StrategyState>(`/api/paper?view=state&strategy=${encodeURIComponent(strategy)}`),
    readJson<{ curve: EquityPoint[] }>(`/api/paper?view=equity&strategy=${encodeURIComponent(strategy)}`),
  ]);
  return { state, equity: equity.curve || [] };
}

export async function loadClosedTrades(strategy: StrategyKey, limit = 10, offset = 0) {
  return readJson<{ closed: import("./strategy-types").Position[]; total: number; limit: number; offset: number }>(
    `/api/paper?view=closed&strategy=${encodeURIComponent(strategy)}&limit=${limit}&offset=${offset}`
  );
}

export async function loadKlines(strategy: StrategyKey, symbol: string, granularity = "4H") {
  const path = `/api/paper?view=klines&strategy=${encodeURIComponent(strategy)}&symbol=${encodeURIComponent(symbol)}&granularity=${granularity}&limit=120`;
  let lastError: unknown;
  // 扫描 worker 正在高并发拉取全市场数据时，单次 K 线请求可能瞬时失败。
  // 这里仅对只读行情做短暂重试，不改变后台扫描和 Paper 交易节奏。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const data = await readJson<{ candles: Kline[] }>(path);
      if (!Array.isArray(data.candles) || data.candles.length === 0) {
        throw new Error(`${symbol} 暂无可用的 ${granularity} K 线`);
      }
      return data.candles;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 250 : 800));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("K 线读取失败");
}

export async function loadIntelligenceFeed(filters: { source?: string; type?: string; asset?: string } = {}) {
  const params = new URLSearchParams({ view: "feed" });
  if (filters.source && filters.source !== "all") params.set("source", filters.source);
  if (filters.type && filters.type !== "all") params.set("type", filters.type);
  if (filters.asset?.trim()) params.set("asset", filters.asset.trim().toUpperCase());
  return readJson<IntelligenceFeed>(`/api/intelligence?${params.toString()}`);
}

export function formatTime(value?: number | string | null) {
  if (!value) return "—";
  const timestamp = typeof value === "number" && Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function money(value = 0, digits = 2) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function percentage(value = 0, digits = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function shortSymbol(symbol: string) {
  return symbol.replace(/USDT$/, "");
}
