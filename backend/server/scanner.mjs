// Bitget 全市场永续合约实时数据拉取 + A档多因子异动打分（服务端版）。
// 数据来源：Bitget 公开合约接口 mix/market/tickers（免 key），一次返回全市场 600+ 永续合约。

const TICKERS_URL =
  "https://api.bitget.com/api/v2/mix/market/tickers?productType=usdt-futures";
const TIMEOUT_MS = 8000;

// ---- 打分配置（对齐 A档原版框架）----
export const SCAN_CONFIG = {
  minScore: 35,        // 综合分门槛
  minOiUsd: 1_000_000, // OI 折美元门槛
  maxHits: 5,          // 一次最多出榜数
};

const WEIGHTS = { oi: 0.3, activeBuy: 0.25, price: 0.2, volume: 0.15, funding: 0.1 };

const POSITIVE_TAGS = ["多头共振", "大户领先做多", "主动买领先多"];
const NEGATIVE_TAGS = ["大户领先做空", "主动买领先空"];

const num = (s) => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};

// ---- 各因子打分（0..100）----
function oiFactor(oiChangePct) {
  if (oiChangePct === null) return 0;
  return Math.min(Math.abs(oiChangePct) * 20, 100); // 1%->20, 5%封顶
}
function activeBuyFactor(imbalance) {
  return Math.min(Math.abs(imbalance) * 100, 100);
}
function priceFactor(change24hPct) {
  return Math.min(Math.abs(change24hPct) * 4, 100);
}
function volumeFactor(volumeUsd) {
  if (volumeUsd <= 10_000) return 0;
  return Math.min(Math.max(((Math.log10(volumeUsd) - 4) / 5) * 100, 0), 100);
}
function fundingFactor(fundingRate) {
  const absPct = Math.abs(fundingRate) * 100;
  if (absPct < 0.05) return 0;
  return Math.min(((absPct - 0.05) / 0.25) * 100, 100);
}

function classify(oiChangePct, change24hPct, imbalance) {
  const oiUp = oiChangePct !== null && oiChangePct > 0.5;
  const priceUp = change24hPct > 0;
  const buyPressure = imbalance > 0.1;
  const sellPressure = imbalance < -0.1;

  if (oiUp && priceUp && buyPressure) return { tag: "多头共振", direction: "long" };
  if (oiUp && (priceUp || buyPressure)) return { tag: "大户领先做多", direction: "long" };
  if (buyPressure && priceUp) return { tag: "主动买领先多", direction: "long" };
  if (oiUp && !priceUp && sellPressure) return { tag: "大户领先做空", direction: "short" };
  if (sellPressure && !priceUp) return { tag: "主动买领先空", direction: "short" };
  if (priceUp && buyPressure) return { tag: "主动买领先多", direction: "long" };
  if (!priceUp && sellPressure) return { tag: "主动买领先空", direction: "short" };
  return { tag: "无明显异动", direction: priceUp ? "long" : "short" };
}

function scoreFactors(f) {
  const s =
    f.oi * WEIGHTS.oi + f.activeBuy * WEIGHTS.activeBuy + f.price * WEIGHTS.price +
    f.volume * WEIGHTS.volume + f.funding * WEIGHTS.funding;
  return Math.round(Math.min(s, 100));
}

/** 拉取 Bitget 全市场永续合约 tickers。失败抛错。 */
export async function fetchTickers() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TICKERS_URL, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Bitget HTTP ${res.status}`);
    const json = await res.json();
    if (!json || json.code !== "00000" || !Array.isArray(json.data)) {
      throw new Error(`Bitget 返回异常：${json?.msg || "无数据"}`);
    }
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 对全市场 tickers 跑一次打分。
 * @param tickers Bitget data 数组
 * @param prevOi  上次 OI 快照 { symbol: oiBase }，用于算变化率
 * @returns { hits, allCandidates, coverage, oiSnapshot, scannedCount }
 */
export function scanTickers(tickers, prevOi, cfg = SCAN_CONFIG) {
  const now = Date.now();
  const oiSnapshot = {};
  const candidates = [];
  const coverage = {
    scannedCount: tickers.length,
    oiAvailableCount: 0,
    oiEligibleCount: 0,
    scoredCount: 0,
    thresholdCount: 0,
    signalCount: 0,
    missingOiCount: 0,
  };

  for (const t of tickers) {
    const symbol = t.symbol;
    const lastPrice = num(t.lastPr);
    const oiBase = num(t.holdingAmount);
    const oiUsd = oiBase * lastPrice;
    oiSnapshot[symbol] = oiBase;

    if (oiBase > 0) coverage.oiAvailableCount += 1;
    else coverage.missingOiCount += 1;
    if (oiUsd < cfg.minOiUsd) continue;
    coverage.oiEligibleCount += 1;

    const prev = prevOi[symbol];
    const oiChangePct = prev && prev > 0 ? ((oiBase - prev) / prev) * 100 : null;
    const change24hPct = num(t.changeUtc24h) * 100;
    const fundingRate = num(t.fundingRate);
    const volumeUsd = num(t.usdtVolume);
    const bidSz = num(t.bidSz);
    const askSz = num(t.askSz);
    const imbalance = bidSz + askSz > 0 ? (bidSz - askSz) / (bidSz + askSz) : 0;

    const factors = {
      oi: oiFactor(oiChangePct),
      activeBuy: activeBuyFactor(imbalance),
      price: priceFactor(change24hPct),
      volume: volumeFactor(volumeUsd),
      funding: fundingFactor(fundingRate),
    };
    const score = scoreFactors(factors);
    coverage.scoredCount += 1;
    if (score < cfg.minScore) continue;
    coverage.thresholdCount += 1;

    const { tag, direction } = classify(oiChangePct, change24hPct, imbalance);
    if (!POSITIVE_TAGS.includes(tag) && !NEGATIVE_TAGS.includes(tag)) continue;
    coverage.signalCount += 1;

    candidates.push({
      symbol, score, direction, tag, factors, lastPrice, oiUsd,
      oiChangePct: oiChangePct === null ? null : Math.round(oiChangePct * 100) / 100,
      change24hPct: Math.round(change24hPct * 100) / 100,
      fundingRate, volumeUsd,
      bidAskImbalance: Math.round(imbalance * 1000) / 1000,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    hits: candidates.slice(0, cfg.maxHits),
    allCandidates: candidates, // 全部命中（不止top5），供模拟盘开仓用
    coverage,
    oiSnapshot,
    scannedCount: tickers.length,
  };
}

export { POSITIVE_TAGS, NEGATIVE_TAGS };
