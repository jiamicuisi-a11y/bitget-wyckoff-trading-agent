// 策略注册表。
//
// 每个策略实现统一接口，引擎对所有注册策略一视同仁地跑：
//   - key:        唯一标识（落库的 strategy 字段）
//   - name:       中文名
//   - desc:       一句话说明
//   - kind:       'scanner'（全市场扫描型）| 'symbol'（定标的型，未来用）
//   - source:     数据源 key（见 sources.mjs：'bitget' | 'okx'）
//   - paper:      该策略的模拟盘参数（风险/止损/止盈/杠杆/冷却/上限）
//   - candidates(ctx): 返回本轮开仓候选数组 [{symbol, direction, score, tag, lastPrice, ...}]
//
// ctx 由引擎按「该策略的数据源」构造（多源隔离）：
//   ctx.tickers   — 该源全市场 tickers（已对齐统一字段）
//   ctx.prevOi    — 该源上一轮 OI 快照 { symbol: oiBase }
//   ctx.priceMap  — 该源 { symbol: lastPrice }
//
// 加新策略：在 STRATEGIES 里再注册一个即可。
// 同一套异动逻辑、不同数据源 = 两张独立卡（如 anomaly=Bitget、anomaly-okx=OKX），各自独立 1 万 U。
// 引擎、数据库、前端都不用改结构。

import { scanTickers, SCAN_CONFIG } from "./scanner.mjs";
import { ema, latestClosedSignal } from "./indicators.mjs";
import { managePositionsAsym } from "./paper.mjs";
import { fetchOptionChain, scanBoxSpreads } from "./arb-options.mjs";

/** A档 · 异动扫描模拟盘参数（两个源共用同一套，保证可横向对比）。 */
export const ANOMALY_PAPER = {
  riskPerTradePct: 1.5,
  stopPct: 3,
  targetR: 2,
  leverage: 3,
  cooldownMin: 90,
  maxHoldHours: 48,
  takerFeePct: 0.06,
  maxConcurrent: 4,
  minScoreToOpen: 48,
  maxOpenPerCycle: 2,
};

function anomalyCandidates(ctx) {
  const scan = scanTickers(ctx.tickers, ctx.prevOi, SCAN_CONFIG);
  // 供运行引擎把“扫描覆盖率”和“命中候选”一起写入最新扫描记录；
  // candidates 仍保持纯数组，Paper engine 不需要感知诊断元数据。
  ctx.scanDiagnostics = scan;
  const { allCandidates } = scan;
  return allCandidates;
}

/**
 * A档·趋势版参数：选币完全复用异动打分，只换平仓性格（多空不对称）。
 * 与 A 档同口径的风险/止损/杠杆，方便和 A 档并排对照「固定2R vs 趋势追踪」。
 *   - 空单：沿用固定止损 + 固定止盈（targetR=2），快进快出。
 *   - 多单：固定止损保命；冲过 trailArmPct 后启用追踪止盈，从峰值回撤 trailGivebackPct 才平。
 *   - 多单放宽超时（longMaxHoldHours），给单边趋势更多生长时间。
 */
export const ANOMALY_TREND_PAPER = {
  riskPerTradePct: 1.5,
  stopPct: 3,
  targetR: 2, // 空单止盈用
  leverage: 3,
  cooldownMin: 90,
  maxHoldHours: 48, // 空单/兜底超时
  longMaxHoldHours: 240, // 多单放宽到 ~10 天，给趋势长出来
  takerFeePct: 0.06,
  maxConcurrent: 4,
  minScoreToOpen: 48,
  maxOpenPerCycle: 2,
  // 多单追踪止盈
  trailArmPct: 6, // 多单先冲到 +6%（一个2R距离）才激活追踪
  trailGivebackPct: 4, // 激活后从峰值回撤 4% 平多单
};

/** C档 · 期权套利模拟盘参数：扫到扣费后 Box edge 就自动记一笔套利完成单。 */
export const OPTIONS_ARB_PAPER = {
  instantClose: true,
  tradeCapitalUsd: 1000,
  cooldownMin: 1440, // 同一 box 每天最多记一次，避免 120 秒循环重复刷收益
  maxConcurrent: 999,
  minScoreToOpen: 1,
  maxOpenPerCycle: 3,
  minBoxEdgePct: 0.5,
  currency: "BTC",
};

/**
 * B档 · 双均线策略参数（两档，便于横向对比哪个周期利润大）。
 * 风险/止损/止盈/杠杆与异动卡同口径，只差周期与快慢线：
 *   - 1H 档：EMA12/26（回测约11天 +38.01%、回撤33.07%）
 *   - 4H 档：EMA10/30（回测约44天 +75.63%、回撤31.52%）
 */
const DUALMA_BASE = {
  riskPerTradePct: 1.5,
  stopPct: 3,
  targetR: 2,
  leverage: 3,
  takerFeePct: 0.06,
  maxConcurrent: 4,
  minScoreToOpen: 50,
  maxOpenPerCycle: 2,
  maType: "ema",
  topN: 30, // 取成交额 Top30 永续作标的池
  klineLimit: 120, // 每标的拉多少根算均线
};

export const DUALMA_1H_PAPER = {
  ...DUALMA_BASE,
  cooldownMin: 60, // 1H 周期，冷却 1 根 K 线，避免同一交叉反复进
  maxHoldHours: 48, // ≈48 根 1H
  fast: 12,
  slow: 26,
  granularity: "1H",
};

export const DUALMA_4H_PAPER = {
  ...DUALMA_BASE,
  cooldownMin: 240, // 4H 周期，冷却 1 根 K 线
  maxHoldHours: 192, // ≈48 根 4H
  fast: 10,
  slow: 30,
  granularity: "4H",
};

/**
 * 双均线实盘候选：对成交额 TopN 标的各拉一段 K 线，
 * 最近一根「已收盘」K 线上出现金叉=做多 / 死叉=做空。
 * latestClosedSignal 只在交叉发生的那根返回信号，之后为 null，不会持续重复触发；
 * 再叠加 paper 的冷却与最大并发，避免同一交叉反复开仓。
 */
function makeDualmaCandidates(params) {
  return async function dualmaCandidates(ctx) {
    const { fast, slow, maType, granularity, topN, klineLimit } = params;
    // 1) 选标的池：本源 tickers 按成交额排序取 TopN
    const universe = [...ctx.tickers]
      .map((t) => ({ symbol: t.symbol, vol: parseFloat(t.usdtVolume) || 0 }))
      .filter((t) => t.vol > 0)
      .sort((a, b) => b.vol - a.vol)
      .slice(0, topN)
      .map((t, index) => ({ ...t, volumeRank: index + 1 }));

    // 2) 并发拉 K 线，限批避免限频
    const candidates = [];
    const BATCH = 6;
    for (let i = 0; i < universe.length; i += BATCH) {
      const batch = universe.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async ({ symbol, volumeRank }) => {
          const candles = await ctx.fetchKlines(symbol, granularity, klineLimit);
          return { symbol, volumeRank, candles };
        })
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { symbol: sym, volumeRank, candles } = r.value;
        if (!Array.isArray(candles) || candles.length < slow + 5) continue;
        const closes = candles.map((c) => c.close);
        const sig = latestClosedSignal(closes, fast, slow, maType);
        if (sig !== "golden" && sig !== "death") continue;
        const lastPrice = ctx.priceMap[sym];
        if (!(lastPrice > 0)) continue;
        const direction = sig === "golden" ? "long" : "short";
        const signalIndex = candles.length - 2;
        const fastValues = maType === "ema" ? ema(closes, fast) : [];
        const slowValues = maType === "ema" ? ema(closes, slow) : [];
        candidates.push(enrichDualMaSignal({
          symbol: sym,
          direction,
          score: 60, // 信号触发即给固定分（>minScoreToOpen）
          tag: sig === "golden" ? "金叉做多" : "死叉做空",
          lastPrice,
          signal: sig,
          fastEma: fastValues[signalIndex],
          slowEma: slowValues[signalIndex],
          fastPeriod: fast,
          slowPeriod: slow,
          signalCandleTime: candles[signalIndex]?.time ?? null,
          volumeRank,
          granularity,
        }));
      }
    }
    return candidates;
  };
}

export function enrichDualMaSignal(signal) {
  const line = signal.signal === "golden" ? "上穿" : "下穿";
  const fastLabel = `EMA${signal.fastPeriod ?? "快线"}`;
  const slowLabel = `EMA${signal.slowPeriod ?? "慢线"}`;
  const reason = `${fastLabel} ${line} ${slowLabel}，在 ${signal.granularity || "4H"} 已收盘 K 线上确认${signal.signal === "golden" ? "多头趋势启动" : "空头趋势启动"}；成交额排名 #${signal.volumeRank ?? "—"}。`;
  return { ...signal, reason };
}

function makeOptionsArbCandidates(params) {
  return async function optionsArbCandidates() {
    const chain = await fetchOptionChain(params.currency || "BTC");
    const boxes = scanBoxSpreads(chain, { minNetEdgePct: params.minBoxEdgePct ?? 0.5 }).slice(0, params.maxOpenPerCycle || 3);
    return boxes.map((b) => ({
      symbol: `BOX-${b.expiry}-${b.kLo}-${b.kHi}`,
      direction: "long",
      score: Math.max(1, Math.round(b.netEdgePct * 100)),
      tag: `${b.side === "long" ? "Long" : "Short"} Box ${b.expiry} ${b.kLo}/${b.kHi}`,
      lastPrice: 1,
      netEdgePct: b.netEdgePct,
      exitReason: "Box套利完成",
      meta: b,
    }));
  };
}

export const STRATEGIES = [
  {
    key: "anomaly",
    name: "A档 · 异动扫描（Bitget）",
    desc:
      "全市场永续合约多因子异动打分（OI/主动买卖/价格/成交额/资金费率），异动达标自动模拟开仓。数据源：Bitget。",
    kind: "scanner",
    source: "bitget",
    paper: ANOMALY_PAPER,
    candidates: anomalyCandidates,
  },
  {
    key: "anomaly-okx",
    name: "A档 · 异动扫描（OKX）",
    desc:
      "与 Bitget 卡完全相同的异动打分策略，数据源换成 OKX（币种更多）。独立 1 万 U 账户，可与 Bitget 横向对比。",
    kind: "scanner",
    source: "okx",
    paper: ANOMALY_PAPER,
    candidates: anomalyCandidates,
  },
  {
    key: "anomaly-trend",
    name: "A档·趋势版（OKX 多单追踪）",
    desc:
      "与 A档 完全相同的异动选币（OKX），只换平仓性格：空单维持固定2R快进快出；多单固定止损保命+追踪止盈（冲过+6%激活，从峰值回撤4%才平），搏单边大行情。数据源：OKX。独立 1 万 U，与 A档 对照「固定2R vs 趋势追踪」。",
    kind: "scanner",
    source: "okx",
    paper: ANOMALY_TREND_PAPER,
    candidates: anomalyCandidates,
    manage: managePositionsAsym,
  },
  {
    key: "options-arb",
    name: "C档 · 期权套利模拟盘（Deribit）",
    desc:
      "实时扫描 Deribit BTC 期权 Box Spread，扣费后净 edge 达标即自动模拟套利成交并入账；按机会雷达口径做模拟盘，不连接真实账户。",
    kind: "options-arb",
    source: "okx",
    paper: OPTIONS_ARB_PAPER,
    candidates: makeOptionsArbCandidates(OPTIONS_ARB_PAPER),
  },
  {
    key: "dualma1h",
    name: "B档 · 双均线（OKX 1H）",
    desc:
      "成交额 Top30 永续，1H K 线 EMA(12/26) 金叉做多/死叉做空，止损3%、止盈2R、超时平。回测约11天 +38.01%（回撤33.07%）。数据源：OKX。独立 1 万 U。",
    kind: "kline",
    source: "okx",
    paper: DUALMA_1H_PAPER,
    candidates: makeDualmaCandidates(DUALMA_1H_PAPER),
  },
  {
    key: "dualma4h",
    name: "B档 · 双均线（OKX 4H）",
    desc:
      "成交额 Top30 永续，4H K 线 EMA(10/30) 金叉做多/死叉做空，止损3%、止盈2R、超时平。回测约44天 +75.63%（回撤31.52%）。数据源：OKX。独立 1 万 U。",
    kind: "kline",
    source: "okx",
    paper: DUALMA_4H_PAPER,
    candidates: makeDualmaCandidates(DUALMA_4H_PAPER),
  },
  {
    key: "anomaly-binance",
    name: "A档 · 异动扫描（Binance）",
    desc:
      "Binance USDT 永续公开行情上的多因子异动 Agent：综合 OI、价格、成交额、盘口与资金费率，命中后进入 Paper 风控流程。",
    kind: "scanner",
    source: "binance",
    paper: ANOMALY_PAPER,
    candidates: anomalyCandidates,
  },
  {
    key: "dualma4h-binance",
    name: "双均线 · Binance 4H",
    desc:
      "Binance USDT 永续成交额 Top30，4H EMA(10/30) 金叉做多、死叉做空，进入统一 Paper 账户和审计流。",
    kind: "kline",
    source: "binance",
    paper: DUALMA_4H_PAPER,
    candidates: makeDualmaCandidates(DUALMA_4H_PAPER),
  },
];

export function getStrategy(key) {
  return STRATEGIES.find((s) => s.key === key) || null;
}
export function listStrategies() {
  return STRATEGIES.map((s) => ({
    key: s.key,
    name: s.name,
    desc: s.desc,
    kind: s.kind,
    source: s.source,
    paper: s.paper,
  }));
}
