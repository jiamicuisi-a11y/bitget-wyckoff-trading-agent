// 主服务（多策略 + 多数据源版）：HTTP API + 定时自动扫描循环。
// Node 24 原生 http + 静态文件，零 npm 依赖。
//
// 定时循环：每 SCAN_INTERVAL_SEC 秒，对每个用到的数据源各拉一次全市场行情，
// 再对每个策略（按它的 source 取对应行情）：算开仓候选 -> 盯仓平仓 -> 自动开仓 -> 存权益/扫描记录。
// OI 快照按「source:symbol」命名空间存储，避免不同所的同名币（如 BTCUSDT）互相覆盖。
//
// API:
//   GET /api/health                  健康检查
//   GET /api/strategies              策略列表（含各自最新绩效摘要）
//   GET /api/state?strategy=anomaly  某策略综合状态（stats+持仓+最近平仓+配置）
//   GET /api/equity?strategy=anomaly 某策略权益曲线
//   GET /api/closed?strategy=&limit= 某策略已平仓列表
//   GET /api/scan/latest?strategy=   某策略最新一轮命中榜
//   GET /api/klines?strategy=&symbol=&granularity=&limit=  K线代理（按策略数据源路由）
//   GET /api/options-arb?currency=BTC  期权套利雷达（Deribit Box/Parity）
//   POST /api/agent/run             Track A Agent Tool Layer（只读感知 + Paper plan）
//   POST /api/paper/reset           重置指定策略的本地 Paper 账本（不触碰真钱）

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import {
  db,
  ensureAccount,
  INITIAL_CAPITAL,
  getAgentRun,
  listAgentRuns,
  persistAgentRun,
  appendOiHistory,
  getOiHistorySince,
  getIntelligenceSourceState,
  listIntelligenceItems,
  setIntelligenceSourceState,
  upsertIntelligenceItems,
} from "./db.mjs";
import { SOURCES, getSource } from "./sources.mjs";
import { STRATEGIES, getStrategy, listStrategies } from "./strategies.mjs";
import {
  openFromCandidates,
  managePositions,
  snapshotEquity,
  recordScan,
} from "./paper.mjs";
import {
  getStats,
  getOpenPositions,
  getClosedPositions,
  getClosedCount,
  getEquityCurve,
} from "./stats.mjs";
import { fetchOptionChain, scanBoxSpreads, scanParity } from "./arb-options.mjs";
import { createMcpRuntime } from "./mcp-runtime.mjs";
import { runAgentChat } from "./agent-chat.mjs";
import { rankOpenInterestLeaders } from "./oi-analysis.mjs";
import { createIntelligenceService, INTELLIGENCE_SOURCES } from "./intelligence.mjs";
import { resetPaperState } from "./paper-reset.mjs";

const PORT = Number(process.env.QUANT_PORT || 8800);
const SCAN_INTERVAL_SEC = Number(process.env.QUANT_SCAN_INTERVAL_SEC || 120);
const PUBLIC_DIR = new URL("../public", import.meta.url).pathname;

// ---- OI 快照读写（持久化在 SQLite）。key 用 `source:symbol` 命名空间，跨所不撞车 ----
const loadOiStmt = db.prepare("SELECT symbol, oi FROM oi_snapshot");
const upsertOiStmt = db.prepare(
  "INSERT INTO oi_snapshot(symbol, oi, ts) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET oi=excluded.oi, ts=excluded.ts"
);
function loadOiSnapshot() {
  const map = {};
  for (const r of loadOiStmt.all()) map[r.symbol] = r.oi;
  return map;
}
function saveOiSnapshot(snapshot, now) {
  db.exec("BEGIN");
  try {
    for (const symbol of Object.keys(snapshot)) {
      upsertOiStmt.run(symbol, snapshot[symbol], now);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// 用到的数据源（去重）= 各策略 source 的集合
const USED_SOURCE_KEYS = [...new Set(STRATEGIES.map((s) => s.source))];

// 各策略最新一轮榜单缓存（内存）；各源最新价格表（盯仓 + 浮动盈亏用，按源隔离）
const latestScanByStrategy = {};
const latestPriceBySource = {}; // { sourceKey: { symbol: price } }
const latestMarketBySource = {}; // { sourceKey: normalized ticker rows }
let lastCycleAt = null;
let scanStatus = "starting";
let scanStartedAt = null;

let scanning = false;
const resettingStrategies = new Set();

const intelligence = createIntelligenceService({
  listItems: listIntelligenceItems,
  saveItems: upsertIntelligenceItems,
  getSourceState: getIntelligenceSourceState,
  setSourceState: setIntelligenceSourceState,
  getMarketData: () => {
    const candidatesByStrategy = Object.fromEntries(
      STRATEGIES
        .filter((strategy) => strategy.source === "binance")
        .map((strategy) => [strategy.key, latestScanByStrategy[strategy.key]?.allCandidates || []])
    );
    const oiBySymbol = {};
    for (const candidate of latestScanByStrategy["anomaly-binance"]?.allCandidates || []) {
      oiBySymbol[candidate.symbol] = { changePct: candidate.oiChangePct ?? null };
    }
    const positionsByStrategy = Object.fromEntries(
      STRATEGIES
        .filter((strategy) => strategy.source === "binance")
        .map((strategy) => [strategy.key, getOpenPositions(strategy.key, latestPriceBySource.binance || [])])
    );
    return { tickers: latestMarketBySource.binance || [], candidatesByStrategy, positionsByStrategy, oiBySymbol };
  },
});

function getBinanceScannerStrategy() {
  return STRATEGIES.find((strategy) => strategy.source === "binance" && strategy.kind === "scanner")
    || STRATEGIES.find((strategy) => strategy.source === "binance")
    || null;
}

async function runScanCycle() {
  if (scanning) return;
  scanning = true;
  const now = Date.now();
  scanStatus = "scanning";
  scanStartedAt = new Date(now).toISOString();
  try {
    // 1) 每个用到的源各拉一次全市场行情（并发）
    const marketBySource = {};
    await Promise.all(
      USED_SOURCE_KEYS.map(async (srcKey) => {
        const src = getSource(srcKey);
        if (!src) return;
        try {
          marketBySource[srcKey] = await src.fetchMarket();
          latestMarketBySource[srcKey] = marketBySource[srcKey];
        } catch (e) {
          console.error(`[source ${srcKey}] fetch error: ${e?.message || e}`);
        }
      })
    );

    // 2) 全量 OI 快照（上一轮），按 source:symbol 命名空间
    const prevOiAll = loadOiSnapshot();
    const newOiAll = {};

    // 3) 为每个源构造 priceMap + 分源 prevOi 视图
    const ctxBySource = {};
    for (const srcKey of USED_SOURCE_KEYS) {
      const tickers = marketBySource[srcKey];
      if (!Array.isArray(tickers)) continue;
      const priceMap = {};
      const prevOi = {};
      for (const t of tickers) {
        const p = parseFloat(t.lastPr);
        if (Number.isFinite(p)) priceMap[t.symbol] = p;
        const nsKey = `${srcKey}:${t.symbol}`;
        if (prevOiAll[nsKey] !== undefined) prevOi[t.symbol] = prevOiAll[nsKey];
        const oi = parseFloat(t.holdingAmount);
        if (Number.isFinite(oi)) newOiAll[nsKey] = oi;
      }
      latestPriceBySource[srcKey] = priceMap;
      ctxBySource[srcKey] = {
        tickers,
        prevOi,
        priceMap,
        // K 线型策略（如双均线）按本源拉历史 K 线
        fetchKlines: (symbol, granularity, limit) =>
          getSource(srcKey).fetchKlines(symbol, granularity, limit),
      };
    }

    // 4) 每个策略各跑各的（用它自己数据源的 ctx）
    for (const strat of STRATEGIES) {
      if (resettingStrategies.has(strat.key)) {
        console.log(`[${strat.key}] Paper 重置进行中，跳过本轮写账`);
        continue;
      }
      const ctx = ctxBySource[strat.source];
      if (!ctx) {
        console.error(`[${strat.key}] 数据源 ${strat.source} 本轮无数据，跳过`);
        continue;
      }
      ensureAccount(strat.key);
      const cfg = strat.paper;
      const priceMap = ctx.priceMap;
      let candidates = [];
      ctx.scanDiagnostics = null;
      try {
        candidates = (await strat.candidates(ctx)) || [];
      } catch (e) {
        console.error(`[${strat.key}] candidates error: ${e?.message || e}`);
      }
      if (resettingStrategies.has(strat.key)) {
        console.log(`[${strat.key}] Paper 重置发生在扫描等待期间，跳过本轮写账`);
        continue;
      }
      // 先盯仓平仓，再开新仓（都用本源价格表）
      const manageFn = strat.manage || managePositions;
      const closed = manageFn(strat.key, priceMap, now, cfg);
      const opened = openFromCandidates(strat.key, candidates, now, cfg);
      snapshotEquity(strat.key, now, priceMap);
      recordScan(strat.key, now, ctx.tickers.length, candidates.length, opened);

      const scanDiagnostics = ctx.scanDiagnostics;
      const coverage = scanDiagnostics?.coverage || {
        scannedCount: ctx.tickers.length,
        oiAvailableCount: null,
        oiEligibleCount: null,
        scoredCount: null,
        thresholdCount: candidates.length,
        signalCount: candidates.length,
        missingOiCount: null,
      };

      latestScanByStrategy[strat.key] = {
        strategy: strat.key,
        source: strat.source,
        hits: candidates.slice(0, 5),
        allCandidates: candidates,
        topCount: Math.min(candidates.length, 5),
        coverage,
        scannedCount: ctx.tickers.length,
        candidateCount: candidates.length,
        openedCount: opened,
        closedCount: closed,
        scannedAt: new Date(now).toISOString(),
      };
      console.log(
        `[${strat.key}/${strat.source} ${new Date(now).toISOString()}] 扫描 ${ctx.tickers.length} 命中 ${candidates.length} 开仓 ${opened} 平仓 ${closed}`
      );
    }

    // 5) 落库 OI 快照（命名空间版）
    saveOiSnapshot(newOiAll, now);
    appendOiHistory(newOiAll, now);
    lastCycleAt = new Date(now).toISOString();
  } catch (e) {
    console.error(`[scan error] ${e?.message || e}`);
  } finally {
    scanning = false;
    scanStatus = "idle";
  }
}

// ---- K线代理（给前端画图，按策略数据源路由）----
async function fetchKlinesForStrategy(strategyKey, symbol, granularity, limit) {
  const strat = getStrategy(strategyKey);
  const srcKey = strat?.source || "bitget";
  const src = getSource(srcKey);
  if (!src) throw new Error(`未知数据源 ${srcKey}`);
  return src.fetchKlines(symbol, granularity, limit);
}

function strategyPriceMap(strategyKey) {
  const strat = getStrategy(strategyKey);
  return latestPriceBySource[strat?.source || "binance"] || {};
}

function createAgentContext() {
  return {
    async getMarketSnapshot({ limit = 8 } = {}) {
      const tickers = Array.isArray(latestMarketBySource.binance) ? latestMarketBySource.binance : [];
      const scannerStrategy = getBinanceScannerStrategy();
      const latest = scannerStrategy ? latestScanByStrategy[scannerStrategy.key] : null;
      const topVolume = tickers
        .slice()
        .sort((a, b) => parseFloat(b.usdtVolume || 0) - parseFloat(a.usdtVolume || 0))
        .slice(0, Math.min(Number(limit) || 8, 20))
        .map((ticker) => ({
          symbol: ticker.symbol,
          lastPrice: Number(ticker.lastPr || 0),
          change24hPct: Number(ticker.changeUtc24h || 0) * 100,
          volumeUsd: Number(ticker.usdtVolume || 0),
          fundingRate: Number(ticker.fundingRate || 0),
        }));
      return {
        source: "binance",
        asOf: lastCycleAt,
        scannedCount: tickers.length,
        oiAvailableCount: latest?.coverage?.oiAvailableCount ?? null,
        topVolume,
      };
    },

    async getKlines({ strategy, symbol, granularity, limit = 120 }) {
      const candles = await fetchKlinesForStrategy(strategy, symbol.toUpperCase(), granularity, Math.min(Number(limit) || 120, 500));
      return { strategy, symbol: symbol.toUpperCase(), granularity, candles, asOf: new Date().toISOString() };
    },

    async getOpenInterest({ symbol }) {
      const normalized = symbol.toUpperCase();
      const ticker = (latestMarketBySource.binance || []).find((row) => row.symbol === normalized);
      const scannerStrategy = getBinanceScannerStrategy();
      const latestCandidate = (scannerStrategy ? latestScanByStrategy[scannerStrategy.key]?.allCandidates : [])
        ?.find((row) => row.symbol === normalized);
      const previous = loadOiSnapshot()[`binance:${normalized}`];
      const current = Number(ticker?.holdingAmount || latestCandidate?.oiUsd || 0);
      const previousNumber = Number(previous || 0);
      return {
        symbol: normalized,
        openInterest: current,
        previousOpenInterest: previousNumber || null,
        changePct: latestCandidate?.oiChangePct ?? (previousNumber > 0 ? ((current - previousNumber) / previousNumber) * 100 : null),
        asOf: lastCycleAt,
      };
    },

    async getOpenInterestLeaders({ windowMinutes = 15, limit = 10 } = {}) {
      const now = Date.now();
      const requestedMinutes = Math.max(1, Math.min(Number(windowMinutes) || 15, 1440));
      const currentRows = Array.isArray(latestMarketBySource.binance) ? latestMarketBySource.binance : [];
      const history = getOiHistorySince(now - Math.max(requestedMinutes, 60) * 60 * 1000)
        .filter((point) => String(point.symbol).startsWith("binance:"));
      return rankOpenInterestLeaders({ currentRows, history, now, windowMinutes: requestedMinutes, limit });
    },

    async evaluateStrategy({ strategy }) {
      const latest = latestScanByStrategy[strategy];
      return {
        strategy,
        source: "binance",
        asOf: latest?.scannedAt || lastCycleAt,
        scannedCount: latest?.scannedCount || 0,
        candidateCount: latest?.candidateCount || 0,
        coverage: latest?.coverage || null,
        candidates: (latest?.allCandidates || latest?.hits || []).slice(0, 12),
      };
    },

    async checkRisk({ strategy, symbol }) {
      const strat = getStrategy(strategy);
      const cfg = strat?.paper || {};
      const positions = getOpenPositions(strategy, strategyPriceMap(strategy));
      const current = symbol ? positions.find((position) => position.symbol === symbol.toUpperCase()) : null;
      const checks = {
        paperMode: true,
        broadcast: false,
        stopLossPct: cfg.stopPct ?? 3,
        leverage: cfg.leverage ?? 1,
        concurrent: `${positions.length}/${cfg.maxConcurrent ?? 0}`,
        concurrencyAvailable: positions.length < Number(cfg.maxConcurrent ?? 0),
        selectedPosition: current ? current.symbol : null,
      };
      return {
        strategy,
        pass: checks.concurrencyAvailable,
        summary: checks.concurrencyAvailable ? "Paper 风险边界通过，仍需人工确认。" : "已达到最大并发，暂不建议新增 Paper 仓位。",
        checks,
        asOf: new Date().toISOString(),
      };
    },

    async getPaperState({ strategy }) {
      const strat = getStrategy(strategy);
      const priceMap = strategyPriceMap(strategy);
      return {
        strategy,
        source: strat?.source || "binance",
        asOf: new Date().toISOString(),
        stats: getStats(strategy, priceMap),
        positions: getOpenPositions(strategy, priceMap),
        recentClosed: getClosedPositions(strategy, 10),
        latestScan: latestScanByStrategy[strategy] || null,
        config: { paper: strat?.paper || {}, scanIntervalSec: SCAN_INTERVAL_SEC },
      };
    },

    async getAuditRun({ runId }) {
      return { runId, run: getAgentRun(runId), asOf: new Date().toISOString() };
    },

    async getIntelligenceFeed(filters) {
      return intelligence.getFeed(filters);
    },

    async getBinanceActivities(filters) {
      return intelligence.getActivities(filters);
    },

    async getEventMarketContext({ id }) {
      const item = await intelligence.getEvent(id);
      if (!item) throw new Error("事件不存在或数据源暂不可用");
      return { item, asOf: new Date().toISOString() };
    },
  };
}

let mcpRuntimePromise = null;
function getMcpRuntime() {
  if (!mcpRuntimePromise) mcpRuntimePromise = createMcpRuntime(createAgentContext());
  return mcpRuntimePromise;
}

// ---- HTTP ----
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, maxBytes = 16_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("请求体不是有效 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function buildAgentRun(strategyKey, intent, candidateInput = null) {
  const strat = getStrategy(strategyKey);
  if (!strat || strat.source !== "binance") {
    const error = new Error("Agent Tool Layer 当前只开放 Binance Track A 策略");
    error.statusCode = 400;
    throw error;
  }

  ensureAccount(strategyKey);
  const runId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const scan = latestScanByStrategy[strategyKey] || {
    strategy: strategyKey,
    source: strat.source,
    hits: [],
    scannedCount: 0,
    candidateCount: 0,
    scannedAt: null,
  };
  const priceMap = latestPriceBySource[strat.source] || {};
  const paper = strat.paper || {};
  const allCandidates = Array.isArray(scan.allCandidates) ? scan.allCandidates : (Array.isArray(scan.hits) ? scan.hits : []);
  const candidates = allCandidates;
  const threshold = Number(paper.minScoreToOpen ?? 0);
  const eligible = candidates.filter((candidate) => Number(candidate.score) >= threshold);
  const maxPlans = Math.max(0, Number(paper.maxOpenPerCycle ?? 2));
  const requestedSymbol = String(candidateInput?.symbol || "").toUpperCase();
  const requestedDirection = candidateInput?.direction === "short" ? "short" : "long";
  const requested = requestedSymbol
    ? eligible.find((candidate) => candidate.symbol === requestedSymbol && candidate.direction === requestedDirection)
    : null;
  const selected = requested ? [requested] : eligible.slice(0, maxPlans);
  const stopPct = Number(paper.stopPct ?? 3);
  const targetPct = stopPct * Number(paper.targetR ?? 2);

  const paperPlan = selected.map((candidate) => {
    const entry = Number(candidate.lastPrice || priceMap[candidate.symbol] || 0);
    const long = candidate.direction === "long";
    return {
      symbol: candidate.symbol,
      direction: candidate.direction,
      score: candidate.score,
      reason: candidate.tag,
      entryPrice: entry,
      stopPrice: entry > 0 ? entry * (long ? 1 - stopPct / 100 : 1 + stopPct / 100) : null,
      targetPrice: entry > 0 ? entry * (long ? 1 + targetPct / 100 : 1 - targetPct / 100) : null,
      leverage: Number(paper.leverage ?? 1),
      status: "awaiting_human_confirmation",
      broadcast: false,
    };
  });

  const decision = {
    liveCandidateCount: candidates.length,
    eligibleCandidateCount: eligible.length,
    selectedPlanCount: paperPlan.length,
    pass: paperPlan.length > 0,
    authorized: false,
    requiresHumanConfirmation: true,
    broadcast: false,
    reasons: [
      `每笔风险上限 ${Number(paper.riskPerTradePct ?? 0)}%`,
      `杠杆上限 ${Number(paper.leverage ?? 1)}x`,
      `最大并发 ${Number(paper.maxConcurrent ?? 0)}`,
      ...(paperPlan.length ? [] : [`没有候选达到开仓分数阈值 ${threshold}`]),
      "人工确认前不发送任何订单",
    ],
  };

  const events = [
    { phase: "01 · 感知行情", detail: `market.snapshot 读取 Binance Futures 公开行情，扫描 ${scan.scannedCount || 0} 个合约；OI 可用 ${scan.coverage?.oiAvailableCount ?? "—"} 个` },
    { phase: "02 · 策略判断", detail: `strategy.evaluate 调用「${strat.name}」，完成评分 ${scan.coverage?.scoredCount ?? "—"} 个，达到阈值 ${scan.coverage?.thresholdCount ?? candidates.length} 个` },
    { phase: "03 · 风险闸门", detail: `risk.apply_gate 检查 ${eligible.length} 个达标候选；${decision.reasons.join("；")}` },
    { phase: "04 · Paper 执行", detail: paperPlan.length ? `paper.prepare 生成 ${paperPlan.length} 个待确认计划；broadcast=false` : "paper.prepare 未生成订单，当前没有达到阈值的实时候选" },
    { phase: "05 · 审计记录", detail: `audit.append 记录 ${runId}；工具链完成，等待人工确认` },
  ].map((event, index) => ({
    id: startedAt + index,
    ...event,
    status: "done",
    demo: false,
    ts: startedAt + index,
  }));

  const result = {
    ok: true,
    runId,
    strategy: strategyKey,
    source: strat.source,
    intent,
    mode: "paper",
    tools: [
      { name: "market.snapshot", status: "ok", result: { source: "binance", scannedCount: scan.scannedCount || 0, coverage: scan.coverage || null, scannedAt: scan.scannedAt } },
      { name: "strategy.evaluate", status: "ok", result: { strategy: strategyKey, candidateCount: candidates.length, threshold, topCount: scan.topCount || Math.min(candidates.length, 5) } },
      { name: "risk.apply_gate", status: "ok", result: decision },
      { name: "paper.prepare", status: "ok", result: { planCount: paperPlan.length, broadcast: false } },
      { name: "audit.append", status: "ok", result: { runId, eventCount: events.length, persisted: true } },
    ],
    decision,
    paperPlan,
    events,
    completedAt: new Date().toISOString(),
  };

  persistAgentRun(result);

  return result;
}

/**
 * 把用户在 Agent 工作台明确确认的单个候选写入本地 Paper 账本。
 * 这是唯一一个会改变本地模拟仓状态的 Agent HTTP 动作；它不会调用真实交易接口。
 */
function confirmPaperCandidate(strategyKey, candidateInput) {
  const strat = getStrategy(strategyKey);
  if (!strat || strat.source !== "binance") {
    const error = new Error("Agent Paper 确认只开放 Binance 策略");
    error.statusCode = 400;
    throw error;
  }

  const scan = latestScanByStrategy[strategyKey];
  const candidates = Array.isArray(scan?.allCandidates) ? scan.allCandidates : (scan?.hits || []);
  const symbol = String(candidateInput?.symbol || "").toUpperCase();
  const direction = candidateInput?.direction === "short" ? "short" : "long";
  const candidate = candidates.find((item) => item.symbol === symbol && item.direction === direction);
  if (!candidate) {
    const error = new Error("候选已不在最新扫描结果中，请重新扫描后再确认");
    error.statusCode = 409;
    throw error;
  }

  ensureAccount(strategyKey);
  const cfg = strat.paper || {};
  const priceMap = latestPriceBySource[strat.source] || {};
  const before = getOpenPositions(strategyKey, priceMap);
  const maxConcurrent = Number(cfg.maxConcurrent ?? 0);
  const now = Date.now();
  const runId = `agent-confirm-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const stopPct = Number(cfg.stopPct ?? 3);
  const targetPct = stopPct * Number(cfg.targetR ?? 2);
  const long = direction === "long";
  const entryPrice = Number(candidate.lastPrice || priceMap[symbol] || 0);
  const plan = {
    symbol,
    direction,
    score: candidate.score,
    reason: candidate.tag || candidate.reason || "策略条件满足",
    entryPrice,
    stopPrice: entryPrice > 0 ? entryPrice * (long ? 1 - stopPct / 100 : 1 + stopPct / 100) : null,
    targetPrice: entryPrice > 0 ? entryPrice * (long ? 1 + targetPct / 100 : 1 - targetPct / 100) : null,
    leverage: Number(cfg.leverage ?? 1),
    broadcast: false,
  };

  const riskReasons = [
    `止损距离 ${stopPct}%`,
    `杠杆上限 ${Number(cfg.leverage ?? 1)}x`,
    `并发上限 ${before.length}/${maxConcurrent}`,
    "Paper only · broadcast=false",
  ];
  const riskBlocked = before.length >= maxConcurrent;
  const opened = riskBlocked ? 0 : openFromCandidates(strategyKey, [candidate], now, cfg);
  snapshotEquity(strategyKey, now, priceMap);
  const after = getOpenPositions(strategyKey, priceMap);
  const actuallyOpened = opened > 0 && after.length > before.length;
  const status = riskBlocked ? "blocked_by_risk_gate" : (actuallyOpened ? "opened" : "not_opened");
  const detail = riskBlocked
    ? `Risk Gate 拒绝：当前并发 ${before.length}/${maxConcurrent}，未写入 Paper 账本`
    : actuallyOpened
      ? `${symbol} 已加入本地 Paper 账本；仅模拟，不广播`
      : `${symbol} 未新增 Paper 仓位（可能已持仓、处于冷却期或未达到开仓阈值）`;
  const events = [
    { phase: "01 · 候选确认", detail: `用户确认 ${symbol} ${direction === "long" ? "做多" : "做空"}，评分 ${candidate.score}`, status: "done" },
    { phase: "02 · 风险闸门", detail: `${riskBlocked ? "未通过" : "通过"}；${riskReasons.join("；")}`, status: riskBlocked ? "blocked" : "done" },
    { phase: "03 · Paper 执行", detail, status: actuallyOpened ? "done" : "skipped" },
    { phase: "04 · 审计记录", detail: `audit.append 记录 ${runId}`, status: "done" },
  ].map((event, index) => ({ id: now + index, ...event, demo: false, ts: now + index }));

  const result = {
    ok: true,
    runId,
    strategy: strategyKey,
    source: strat.source,
    intent: `确认 ${symbol} 加入 Paper`,
    mode: "paper",
    broadcast: false,
    decision: {
      authorized: actuallyOpened,
      requiresHumanConfirmation: false,
      broadcast: false,
      liveCandidateCount: candidates.length,
      selectedPlanCount: actuallyOpened ? 1 : 0,
      pass: !riskBlocked,
      reasons: riskReasons,
    },
    paperPlan: [plan],
    paperExecution: {
      status,
      symbol,
      direction,
      openedCount: opened,
      message: detail,
      positions: after,
    },
    tools: [
      { name: "strategy.evaluate", status: "ok", result: { strategy: strategyKey, candidateCount: candidates.length } },
      { name: "risk.apply_gate", status: riskBlocked ? "blocked" : "ok", result: { pass: !riskBlocked, reasons: riskReasons } },
      { name: "paper.commit", status: actuallyOpened ? "ok" : "skipped", result: { openedCount: opened, broadcast: false } },
      { name: "audit.append", status: "ok", result: { runId, persisted: true } },
    ],
    events,
    completedAt: new Date().toISOString(),
  };
  persistAgentRun(result);
  return result;
}

async function serveStatic(res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  rel = rel.replace(/\.\.+/g, "");
  const file = join(PUBLIC_DIR, rel);
  if (!existsSync(file)) {
    const idx = join(PUBLIC_DIR, "index.html");
    if (existsSync(idx)) {
      const html = await readFile(idx);
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  const data = await readFile(file);
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  res.end(data);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const strategy = url.searchParams.get("strategy") || "anomaly";

    if (path === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        scanIntervalSec: SCAN_INTERVAL_SEC,
        lastCycleAt,
        scanStatus,
        scanStartedAt,
        strategies: STRATEGIES.map((s) => s.key),
        sources: USED_SOURCE_KEYS,
        ts: new Date().toISOString(),
      });
    }

    if (path === "/api/strategies") {
      const list = listStrategies().map((s) => {
        const st = getStats(s.key, latestPriceBySource[s.source] || {});
        return {
          ...s,
          summary: {
            equity: st.equity,
            totalReturnPct: st.totalReturnPct,
            avgDailyPnl: st.avgDailyPnl,
            winRate: st.winRate,
            tradeCount: st.tradeCount,
            openCount: st.openCount,
          },
          latestScan: latestScanByStrategy[s.key] || null,
        };
      });
      return sendJson(res, 200, { strategies: list, scanIntervalSec: SCAN_INTERVAL_SEC });
    }

    if (path === "/api/intelligence/feed" && req.method === "GET") {
      const source = url.searchParams.get("source") || "all";
      const type = url.searchParams.get("type") || "all";
      const asset = url.searchParams.get("asset") || "";
      if (source !== "all" && !INTELLIGENCE_SOURCES.some((item) => item.key === source)) {
        return sendJson(res, 400, { error: "不支持的数据源" });
      }
      if (!new Set(["all", "activity", "announcement", "news"]).has(type)) {
        return sendJson(res, 400, { error: "不支持的事件类型" });
      }
      return sendJson(res, 200, await intelligence.getFeed({ source, type, asset, limit: url.searchParams.get("limit") || 60 }));
    }

    if (path === "/api/intelligence/activities" && req.method === "GET") {
      return sendJson(res, 200, await intelligence.getActivities({
        asset: url.searchParams.get("asset") || "",
        limit: url.searchParams.get("limit") || 30,
      }));
    }

    if (path === "/api/intelligence/event" && req.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return sendJson(res, 400, { error: "缺少事件 ID" });
      const item = await intelligence.getEvent(id);
      if (!item) return sendJson(res, 404, { error: "事件不存在或数据源暂不可用" });
      return sendJson(res, 200, { item });
    }

    if (path === "/api/agent/run" && req.method === "POST") {
      try {
        const input = await readJsonBody(req);
        const strategyKey = String(input.strategy || "anomaly-binance");
        const intent = String(input.intent || "运行一次 Binance 策略扫描").trim().slice(0, 500);
        return sendJson(res, 200, buildAgentRun(strategyKey, intent, input.candidate || null));
      } catch (e) {
        return sendJson(res, Number(e?.statusCode || 500), { ok: false, error: e?.message || "Agent Tool Layer 执行失败" });
      }
    }

    if (path === "/api/agent/confirm" && req.method === "POST") {
      try {
        const input = await readJsonBody(req, 20_000);
        const strategyKey = String(input.strategy || "anomaly-binance");
        return sendJson(res, 200, confirmPaperCandidate(strategyKey, input.candidate));
      } catch (e) {
        return sendJson(res, Number(e?.statusCode || 500), { ok: false, error: e?.message || "Paper 确认失败", broadcast: false });
      }
    }

    if (path === "/api/agent/capabilities" && req.method === "GET") {
      const capabilities = await (await getMcpRuntime()).getCapabilities();
      return sendJson(res, 200, capabilities);
    }

    if (path === "/api/agent/chat" && req.method === "POST") {
      try {
        const input = await readJsonBody(req, 20_000);
        const message = String(input.message || "").trim();
        const mcp = await getMcpRuntime();
        const capabilities = await mcp.getCapabilities();
        const strategyKey = input.strategy ? String(input.strategy) : capabilities.strategies[0]?.key;
        if (!message || message.length > 500) {
          return sendJson(res, 400, { ok: false, error: "问题不能为空且不能超过 500 个字符", toolTrace: [], broadcast: false });
        }
        if (strategyKey && !capabilities.strategies.some((item) => item.key === strategyKey)) {
          return sendJson(res, 400, { ok: false, error: "未知的 Binance 策略，请先查看 MCP 能力清单。", toolTrace: [], broadcast: false });
        }
        const result = await runAgentChat({ message, strategy: strategyKey, mcp });
        return sendJson(res, result.ok ? 200 : 502, result);
      } catch (e) {
        return sendJson(res, 502, { ok: false, error: e?.message || "Agent MCP 对话失败", toolTrace: [], broadcast: false });
      }
    }

    if (path === "/api/paper/reset" && req.method === "POST") {
      try {
        const input = await readJsonBody(req, 4_000);
        const strategyKey = String(input.strategy || "").trim();
        const strat = getStrategy(strategyKey);
        if (!strat) return sendJson(res, 404, { ok: false, error: "未知策略" });

        resettingStrategies.add(strategyKey);
        try {
          const reset = resetPaperState(db, strategyKey, INITIAL_CAPITAL);
          delete latestScanByStrategy[strategyKey];
          const priceMap = latestPriceBySource[strat.source] || {};
          return sendJson(res, 200, {
            ok: true,
            ...reset,
            source: strat.source,
            broadcast: false,
            message: `${strat.name} 已重置为 ${INITIAL_CAPITAL} U；仅清理本地 Paper 账本。`,
            stats: getStats(strategyKey, priceMap),
            positions: [],
            recentClosed: [],
          });
        } finally {
          resettingStrategies.delete(strategyKey);
        }
      } catch (e) {
        return sendJson(res, Number(e?.statusCode || 500), { ok: false, error: e?.message || "Paper 账本重置失败", broadcast: false });
      }
    }

    if (path === "/api/runs") {
      const runId = url.searchParams.get("id");
      if (runId) {
        const run = getAgentRun(runId);
        if (!run) return sendJson(res, 404, { error: "运行记录不存在" });
        return sendJson(res, 200, run);
      }
      return sendJson(res, 200, { runs: listAgentRuns(url.searchParams.get("limit") || 50) });
    }

    if (path === "/api/state") {
      const strat = getStrategy(strategy);
      if (!strat) return sendJson(res, 404, { error: "未知策略" });
      const priceMap = latestPriceBySource[strat.source] || {};
      return sendJson(res, 200, {
        strategy,
        source: strat.source,
        scanStatus,
        scanStartedAt,
        stats: getStats(strategy, priceMap),
        positions: getOpenPositions(strategy, priceMap),
        recentClosed: getClosedPositions(strategy, 20),
        latestScan: latestScanByStrategy[strategy] || null,
        config: { paper: strat.paper, scanIntervalSec: SCAN_INTERVAL_SEC },
      });
    }

    if (path === "/api/equity") {
      return sendJson(res, 200, { strategy, curve: getEquityCurve(strategy, 500) });
    }

    if (path === "/api/closed") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);
      const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
      return sendJson(res, 200, {
        strategy,
        closed: getClosedPositions(strategy, limit, offset),
        total: getClosedCount(strategy),
        limit,
        offset,
      });
    }

    if (path === "/api/scan/latest") {
      return sendJson(res, 200, latestScanByStrategy[strategy] || { hits: [] });
    }

    if (path === "/api/klines") {
      const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
      const gran = url.searchParams.get("granularity") || "1H";
      const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);
      try {
        const candles = await fetchKlinesForStrategy(strategy, symbol, gran, limit);
        return sendJson(res, 200, { symbol, strategy, granularity: gran, candles });
      } catch (e) {
        return sendJson(res, 502, { error: e?.message || "K线拉取失败" });
      }
    }

    if (path === "/api/options-arb") {
      const currency = (url.searchParams.get("currency") || "BTC").toUpperCase();
      const minBoxEdgePct = Number(url.searchParams.get("minBoxEdgePct") || 0.05);
      const minParityEdgePct = Number(url.searchParams.get("minParityEdgePct") || 0.1);
      const r = Number(url.searchParams.get("r") || 0.05);
      try {
        const chain = await fetchOptionChain(currency);
        const boxes = scanBoxSpreads(chain, { r, minNetEdgePct: minBoxEdgePct }).slice(0, 20);
        const parity = scanParity(chain, { r, minEdgePct: minParityEdgePct }).slice(0, 20);
        const quoted = chain.options.filter((o) => o.bidUsd && o.askUsd).length;
        return sendJson(res, 200, {
          source: "deribit",
          currency,
          spot: chain.spot,
          optionCount: chain.options.length,
          quotedCount: quoted,
          r,
          thresholds: { minBoxEdgePct, minParityEdgePct },
          boxes,
          parity,
          ts: new Date().toISOString(),
          note: "仅做机会雷达；使用可成交 bid/ask 与手续费估算，不代表真实可无滑点成交。",
        });
      } catch (e) {
        return sendJson(res, 502, { error: e?.message || "期权链拉取失败" });
      }
    }

    if (path.startsWith("/api/")) {
      return sendJson(res, 404, { error: "未知接口" });
    }

    await serveStatic(res, path);
  } catch (e) {
    sendJson(res, 500, { error: e?.message || "服务器错误" });
  }
});

server.listen(PORT, () => {
  console.log(`量化模拟盘服务（多策略+多源）启动：http://127.0.0.1:${PORT}`);
  console.log(
    `策略：${STRATEGIES.map((s) => `${s.key}@${s.source}`).join(", ")} · 数据源：${USED_SOURCE_KEYS.join(
      ", "
    )} · 扫描间隔：${SCAN_INTERVAL_SEC}s`
  );
  runScanCycle();
  setInterval(runScanCycle, SCAN_INTERVAL_SEC * 1000);
});
