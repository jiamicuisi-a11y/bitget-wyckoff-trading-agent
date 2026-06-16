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

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import { db, ensureAccount } from "./db.mjs";
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
  getEquityCurve,
} from "./stats.mjs";
import { fetchOptionChain, scanBoxSpreads, scanParity } from "./arb-options.mjs";

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
let lastCycleAt = null;

let scanning = false;
async function runScanCycle() {
  if (scanning) return;
  scanning = true;
  const now = Date.now();
  try {
    // 1) 每个用到的源各拉一次全市场行情（并发）
    const marketBySource = {};
    await Promise.all(
      USED_SOURCE_KEYS.map(async (srcKey) => {
        const src = getSource(srcKey);
        if (!src) return;
        try {
          marketBySource[srcKey] = await src.fetchMarket();
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
      const ctx = ctxBySource[strat.source];
      if (!ctx) {
        console.error(`[${strat.key}] 数据源 ${strat.source} 本轮无数据，跳过`);
        continue;
      }
      ensureAccount(strat.key);
      const cfg = strat.paper;
      const priceMap = ctx.priceMap;
      let candidates = [];
      try {
        candidates = (await strat.candidates(ctx)) || [];
      } catch (e) {
        console.error(`[${strat.key}] candidates error: ${e?.message || e}`);
      }
      // 先盯仓平仓，再开新仓（都用本源价格表）
      const manageFn = strat.manage || managePositions;
      const closed = manageFn(strat.key, priceMap, now, cfg);
      const opened = openFromCandidates(strat.key, candidates, now, cfg);
      snapshotEquity(strat.key, now, priceMap);
      recordScan(strat.key, now, ctx.tickers.length, candidates.length, opened);

      latestScanByStrategy[strat.key] = {
        strategy: strat.key,
        source: strat.source,
        hits: candidates.slice(0, 5),
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
    lastCycleAt = new Date(now).toISOString();
  } catch (e) {
    console.error(`[scan error] ${e?.message || e}`);
  } finally {
    scanning = false;
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

    if (path === "/api/state") {
      const strat = getStrategy(strategy);
      if (!strat) return sendJson(res, 404, { error: "未知策略" });
      const priceMap = latestPriceBySource[strat.source] || {};
      return sendJson(res, 200, {
        strategy,
        source: strat.source,
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
      const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
      return sendJson(res, 200, { strategy, closed: getClosedPositions(strategy, limit) });
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
