// 数据源适配层（多交易所）。
//
// 每个 source 把各交易所的原始字段「翻译」成统一格式，喂给同一套打分逻辑（scanner.mjs），
// 这样策略本身一个字都不用改，只是数据来源不同。
//
// 统一 ticker 字段（对齐 scanner.mjs 期望的 Bitget 字段名）：
//   symbol         统一符号，如 BTCUSDT（跨所一致，用于持仓/价格表 key）
//   lastPr         最新价
//   holdingAmount  持仓量（base 币计，OI 变化率用，源内自比）
//   changeUtc24h   24h 涨跌（小数，例 0.0123 = 1.23%）
//   fundingRate    资金费率（小数）
//   usdtVolume     24h 成交额（折 USDT，volume 因子用，log 尺度容错）
//   bidSz / askSz  买一/卖一量（盘口失衡用，比值，单位可抵消）
//
// 每个 source 还实现 fetchKlines(symbol, granularity, limit) 给前端画 K 线（统一成 {time,open,high,low,close}）。

import { fetchTickers as fetchBitgetTickers } from "./scanner.mjs";

const TIMEOUT_MS = 8000;
const num = (s) => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};

async function fetchJson(url, timeout = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ============ Bitget ============
// fetchTickers 返回的就是已对齐字段（scanner 本就按 Bitget 字段写的），直接用。
const BITGET_KLINES = "https://api.bitget.com/api/v2/mix/market/candles";

async function bitgetKlines(symbol, granularity, limit) {
  const url = `${BITGET_KLINES}?symbol=${encodeURIComponent(
    symbol
  )}&granularity=${encodeURIComponent(granularity)}&limit=${limit}&productType=usdt-futures`;
  const json = await fetchJson(url);
  if (!json || json.code !== "00000" || !Array.isArray(json.data)) {
    throw new Error(`Bitget K线异常：${json?.msg || "无数据"}`);
  }
  // [ts, open, high, low, close, baseVol, quoteVol]
  return json.data
    .map((r) => ({
      time: Math.floor(parseInt(r[0], 10) / 1000),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
    }))
    .sort((a, b) => a.time - b.time);
}

// ============ OKX ============
// tickers 不含 OI / 资金费率：OI 单独全市场拉一次合并；资金费率无批量接口，置 0（权重仅 0.10，多数币本就为 0）。
const OKX_TICKERS = "https://www.okx.com/api/v5/market/tickers?instType=SWAP";
const OKX_OI = "https://www.okx.com/api/v5/public/open-interest?instType=SWAP";
const OKX_KLINES = "https://www.okx.com/api/v5/market/candles";

// BTC-USDT-SWAP -> BTCUSDT
function okxInstToSymbol(instId) {
  const parts = instId.split("-"); // [BTC, USDT, SWAP]
  return parts[0] + "USDT";
}
// BTCUSDT -> BTC-USDT-SWAP
function okxSymbolToInst(symbol) {
  return symbol.replace(/USDT$/, "") + "-USDT-SWAP";
}

async function okxFetchMarket() {
  const [tk, oi] = await Promise.all([fetchJson(OKX_TICKERS), fetchJson(OKX_OI)]);
  if (!tk || tk.code !== "0" || !Array.isArray(tk.data)) {
    throw new Error(`OKX tickers 异常：${tk?.msg || "无数据"}`);
  }
  // OI 表：instId -> 持仓量(base 币, oiCcy)
  const oiMap = {};
  if (oi && oi.code === "0" && Array.isArray(oi.data)) {
    for (const r of oi.data) oiMap[r.instId] = num(r.oiCcy);
  }

  const out = [];
  for (const t of tk.data) {
    const instId = t.instId;
    if (!instId.endsWith("-USDT-SWAP")) continue; // 只要 USDT 本位永续
    const symbol = okxInstToSymbol(instId);
    const last = num(t.last);
    if (!(last > 0)) continue;
    const open24h = num(t.open24h);
    const change = open24h > 0 ? (last - open24h) / open24h : 0; // 小数
    const volCcy = num(t.volCcy24h); // base 币成交量
    const usdtVolume = volCcy * last; // 折 USDT（log 尺度容错）
    out.push({
      symbol,
      lastPr: String(last),
      holdingAmount: String(oiMap[instId] ?? 0),
      changeUtc24h: String(change),
      fundingRate: "0", // OKX 无批量资金费率接口，置 0
      usdtVolume: String(usdtVolume),
      bidSz: String(num(t.bidSz)),
      askSz: String(num(t.askSz)),
    });
  }
  return out;
}

async function okxKlines(symbol, granularity, limit) {
  const instId = okxSymbolToInst(symbol);
  // 前端传 1H/4H/1D/1W，与 OKX bar 同名，直接透传
  const url = `${OKX_KLINES}?instId=${encodeURIComponent(
    instId
  )}&bar=${encodeURIComponent(granularity)}&limit=${limit}`;
  const json = await fetchJson(url);
  if (!json || json.code !== "0" || !Array.isArray(json.data)) {
    throw new Error(`OKX K线异常：${json?.msg || "无数据"}`);
  }
  // [ts_ms, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
  return json.data
    .map((r) => ({
      time: Math.floor(parseInt(r[0], 10) / 1000),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
    }))
    .sort((a, b) => a.time - b.time);
}

// ============ Binance Futures ============
// Binance Agent OS 参赛版数据源：只读公开 USDT 永续行情，不需要 API key。
const BINANCE_FUTURES = "https://fapi.binance.com";
const BINANCE_TICKERS = `${BINANCE_FUTURES}/fapi/v1/ticker/24hr`;
const BINANCE_PREMIUM = `${BINANCE_FUTURES}/fapi/v1/premiumIndex`;
const BINANCE_OI = `${BINANCE_FUTURES}/fapi/v1/openInterest`;
const BINANCE_KLINES = `${BINANCE_FUTURES}/fapi/v1/klines`;

const BINANCE_INTERVALS = {
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
  "1W": "1w",
  "1h": "1h",
  "4h": "4h",
  "1day": "1d",
  "1week": "1w",
};

async function binanceOpenInterest(symbol) {
  const json = await fetchJson(`${BINANCE_OI}?symbol=${encodeURIComponent(symbol)}`);
  if (!json || !json.openInterest) return 0;
  return num(json.openInterest);
}

async function binanceFetchMarket() {
  const [tickerJson, premiumJson] = await Promise.all([
    fetchJson(BINANCE_TICKERS),
    fetchJson(BINANCE_PREMIUM),
  ]);
  if (!Array.isArray(tickerJson)) throw new Error("Binance tickers 返回异常");
  const premiumMap = new Map(
    (Array.isArray(premiumJson) ? premiumJson : []).map((r) => [r.symbol, r])
  );
  const rows = tickerJson
    .filter((t) => t.symbol.endsWith("USDT") && Number(t.lastPrice) > 0)
    .map((t) => ({
      symbol: t.symbol,
      lastPr: String(num(t.lastPrice)),
      holdingAmount: "0",
      changeUtc24h: String(num(t.priceChangePercent) / 100),
      fundingRate: String(num(premiumMap.get(t.symbol)?.lastFundingRate)),
      usdtVolume: String(num(t.quoteVolume)),
      bidSz: String(num(t.bidQty)),
      askSz: String(num(t.askQty)),
    }))
    .sort((a, b) => num(b.usdtVolume) - num(a.usdtVolume));

  // Binance 没有批量 OI 接口；A 档的“全市场扫描”必须对全量 USDT 永续尝试补齐 OI。
  // 通过有限并发控制频率，单个合约失败只记为 OI 缺失，不影响其余市场完成扫描。
  const oiRows = rows;
  const BATCH = 16;
  const oiMap = new Map();
  for (let i = 0; i < oiRows.length; i += BATCH) {
    const batch = oiRows.slice(i, i + BATCH);
    const result = await Promise.allSettled(batch.map((t) => binanceOpenInterest(t.symbol)));
    result.forEach((r, idx) => {
      if (r.status === "fulfilled") oiMap.set(batch[idx].symbol, r.value);
    });
  }
  return rows.map((t) => ({ ...t, holdingAmount: String(oiMap.get(t.symbol) || 0) }));
}

async function binanceKlines(symbol, granularity, limit) {
  const interval = BINANCE_INTERVALS[granularity] || "1h";
  const json = await fetchJson(
    `${BINANCE_KLINES}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`
  );
  if (!Array.isArray(json)) throw new Error("Binance K线返回异常");
  return json
    .map((r) => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: num(r[1]),
      high: num(r[2]),
      low: num(r[3]),
      close: num(r[4]),
    }))
    .filter((r) => r.close > 0)
    .sort((a, b) => a.time - b.time);
}

// ============ 注册表 ============
export const SOURCES = [
  {
    key: "bitget",
    name: "Bitget",
    fetchMarket: fetchBitgetTickers,
    fetchKlines: bitgetKlines,
  },
  {
    key: "okx",
    name: "OKX",
    fetchMarket: okxFetchMarket,
    fetchKlines: okxKlines,
  },
  {
    key: "binance",
    name: "Binance Futures",
    fetchMarket: binanceFetchMarket,
    fetchKlines: binanceKlines,
  },
];

export function getSource(key) {
  return SOURCES.find((s) => s.key === key) || null;
}
