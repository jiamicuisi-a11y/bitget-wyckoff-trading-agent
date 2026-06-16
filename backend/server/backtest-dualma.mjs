// 双均线策略历史回测（拉真实 K 线，输出真实绩效）。
//
// 用法：
//   node server/backtest-dualma.mjs [source] [granularity] [fast] [slow] [maType] [topN]
//   例：node server/backtest-dualma.mjs okx 1H 10 30 ema 40
//
// 逻辑（与实盘卡同一套信号 indicators.mjs）：
//   - 选取该源成交额最高的 topN 个 USDT 永续作为标的池
//   - 对每个标的拉 limit 根历史 K 线
//   - 金叉开多 / 死叉开空（反手），止损 stopPct，止盈 targetR×止损，超时 maxHoldBars 平
//   - 每标的同一时刻只持一仓；按固定风险百分比 sizing（与异动卡同口径）
//   - 资金共用一个 1 万 U 账户（组合层面），输出总收益/胜率/最大回撤/交易数

import { getSource } from "./sources.mjs";
import { dualMaSignals } from "./indicators.mjs";

const SOURCE = process.argv[2] || "okx";
const GRAN = process.argv[3] || "1H";
const FAST = Number(process.argv[4] || 10);
const SLOW = Number(process.argv[5] || 30);
const MA_TYPE = process.argv[6] || "ema";
const TOP_N = Number(process.argv[7] || 40);
const LIMIT = Number(process.argv[8] || 1000); // 每标的拉多少根
const INITIAL = 10000;

// 回测用的模拟盘参数（与异动卡同口径，便于横向比较）
const CFG = {
  riskPerTradePct: 1.5,
  stopPct: 3,
  targetR: 2,
  leverage: 3,
  takerFeePct: 0.06,
  maxHoldBars: 48, // 最多持有多少根 K 线
};

function pctRank(arr, key) {
  return [...arr].sort((a, b) => b[key] - a[key]);
}

async function pickUniverse(src, topN) {
  const market = await src.fetchMarket();
  const withVol = market
    .map((t) => ({ symbol: t.symbol, vol: parseFloat(t.usdtVolume) || 0, last: parseFloat(t.lastPr) || 0 }))
    .filter((t) => t.vol > 0 && t.last > 0);
  return pctRank(withVol, "vol").slice(0, topN).map((t) => t.symbol);
}

// 单标的回测：返回这批 K 线上产生的成交记录（不含资金，资金在组合层结算）
function backtestSymbol(symbol, candles, cfg) {
  const closes = candles.map((c) => c.close);
  if (closes.length < SLOW + 5) return [];
  const signals = dualMaSignals(closes, FAST, SLOW, MA_TYPE);
  const trades = [];
  let pos = null; // {dir, entry, stop, target, entryIdx}

  for (let i = SLOW; i < candles.length; i++) {
    const price = closes[i];
    const high = candles[i].high;
    const low = candles[i].low;

    // 先看持仓是否触发止盈/止损/超时
    if (pos) {
      let exit = null, reason = null;
      if (pos.dir === "long") {
        if (low <= pos.stop) { exit = pos.stop; reason = "stop"; }
        else if (high >= pos.target) { exit = pos.target; reason = "target"; }
      } else {
        if (high >= pos.stop) { exit = pos.stop; reason = "stop"; }
        else if (low <= pos.target) { exit = pos.target; reason = "target"; }
      }
      if (!exit && i - pos.entryIdx >= cfg.maxHoldBars) { exit = price; reason = "timeout"; }
      // 反手信号也平
      const sig = signals[i];
      if (!exit && ((pos.dir === "long" && sig === "death") || (pos.dir === "short" && sig === "golden"))) {
        exit = price; reason = "reverse";
      }
      if (exit) {
        const retPct = pos.dir === "long" ? (exit - pos.entry) / pos.entry : (pos.entry - exit) / pos.entry;
        trades.push({ symbol, dir: pos.dir, entry: pos.entry, exit, retPct, reason, entryIdx: pos.entryIdx, exitIdx: i, exitTime: candles[i].time });
        pos = null;
      }
    }

    // 无仓时看信号开仓（次根收盘价当入场，这里用当根收盘近似）
    if (!pos) {
      const sig = signals[i];
      if (sig === "golden" || sig === "death") {
        const dir = sig === "golden" ? "long" : "short";
        const entry = price;
        const stopDist = entry * (cfg.stopPct / 100);
        const stop = dir === "long" ? entry - stopDist : entry + stopDist;
        const target = dir === "long" ? entry + stopDist * cfg.targetR : entry - stopDist * cfg.targetR;
        pos = { dir, entry, stop, target, entryIdx: i };
      }
    }
  }
  return trades;
}

function settlePortfolio(allTrades, cfg) {
  // 按平仓时间排序，逐笔结算到共用账户
  const sorted = allTrades.sort((a, b) => a.exitTime - b.exitTime);
  let equity = INITIAL;
  let peak = INITIAL;
  let maxDD = 0;
  let wins = 0;
  const curve = [];
  for (const t of sorted) {
    const riskUsd = (equity * cfg.riskPerTradePct) / 100;
    const notional = riskUsd / (cfg.stopPct / 100);
    const grossPnl = notional * t.retPct;
    const fee = notional * (cfg.takerFeePct / 100) * 2; // 开+平
    const net = grossPnl - fee;
    equity += net;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
    if (net > 0) wins++;
    t.netPnl = net;
    curve.push({ time: t.exitTime, equity });
  }
  return {
    trades: sorted.length,
    wins,
    winRate: sorted.length ? wins / sorted.length : 0,
    finalEquity: equity,
    totalReturnPct: ((equity - INITIAL) / INITIAL) * 100,
    maxDrawdownPct: maxDD * 100,
    curve,
  };
}

async function main() {
  const src = getSource(SOURCE);
  if (!src) throw new Error(`未知数据源 ${SOURCE}`);
  console.log(`回测：双均线 ${MA_TYPE.toUpperCase()}(${FAST}/${SLOW}) · 源=${SOURCE} · 周期=${GRAN} · TopN=${TOP_N} · 每标的${LIMIT}根`);

  const universe = await pickUniverse(src, TOP_N);
  console.log(`标的池（成交额 Top${TOP_N}）：${universe.slice(0, 10).join(", ")}${universe.length > 10 ? " ..." : ""}`);

  const allTrades = [];
  let ok = 0, fail = 0;
  // 控制并发，避免被限频
  const BATCH = 6;
  for (let i = 0; i < universe.length; i += BATCH) {
    const batch = universe.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (sym) => {
        const candles = await src.fetchKlines(sym, GRAN, LIMIT);
        return { sym, candles };
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value.candles) && r.value.candles.length) {
        const trades = backtestSymbol(r.value.sym, r.value.candles, CFG);
        allTrades.push(...trades);
        ok++;
      } else {
        fail++;
      }
    }
    process.stdout.write(`\r拉取进度 ${Math.min(i + BATCH, universe.length)}/${universe.length}  成功${ok} 失败${fail}   `);
  }
  console.log("");

  if (!allTrades.length) {
    console.log("没有产生任何交易。试试更短均线或更长历史。");
    return;
  }

  const res = settlePortfolio(allTrades, CFG);
  const firstTime = res.curve.length ? new Date(res.curve[0].time * 1000).toISOString().slice(0, 16) : "-";
  const lastTime = res.curve.length ? new Date(res.curve[res.curve.length - 1].time * 1000).toISOString().slice(0, 16) : "-";

  // 按平仓原因统计
  const byReason = {};
  for (const t of allTrades) byReason[t.reason] = (byReason[t.reason] || 0) + 1;

  console.log("\n========= 双均线回测结果 =========");
  console.log(`区间（按成交时间）：${firstTime} → ${lastTime} UTC`);
  console.log(`标的成功/失败：${ok}/${fail}`);
  console.log(`总交易数：${res.trades}  胜率：${(res.winRate * 100).toFixed(1)}%（${res.wins}胜 / ${res.trades - res.wins}负）`);
  console.log(`期初：${INITIAL.toFixed(2)} U  期末：${res.finalEquity.toFixed(2)} U`);
  console.log(`总收益：${res.totalReturnPct >= 0 ? "+" : ""}${res.totalReturnPct.toFixed(2)}%`);
  console.log(`最大回撤：${res.maxDrawdownPct.toFixed(2)}%`);
  console.log(`平仓原因分布：${Object.entries(byReason).map(([k, v]) => `${k}:${v}`).join("  ")}`);

  // 收益最好的前5笔 / 最差5笔
  const sortedByPnl = [...allTrades].sort((a, b) => (b.netPnl || 0) - (a.netPnl || 0));
  console.log("\n盈利 Top5：");
  for (const t of sortedByPnl.slice(0, 5)) {
    console.log(`  ${t.symbol} ${t.dir} ${(t.retPct * 100).toFixed(1)}% (${t.reason})  净${(t.netPnl || 0).toFixed(2)}U`);
  }
  console.log("亏损 Top5：");
  for (const t of sortedByPnl.slice(-5).reverse()) {
    console.log(`  ${t.symbol} ${t.dir} ${(t.retPct * 100).toFixed(1)}% (${t.reason})  净${(t.netPnl || 0).toFixed(2)}U`);
  }
}

main().catch((e) => {
  console.error("回测失败：", e?.message || e);
  process.exit(1);
});
