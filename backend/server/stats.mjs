// 统计模块（多策略版）：按 strategy 计算模拟盘绩效指标。

import { db, getCash, getInitialCapital } from "./db.mjs";
import { floatingEquity, openCount } from "./paper.mjs";

const closedStmt = db.prepare(
  "SELECT * FROM positions WHERE strategy=? AND status='closed' ORDER BY exit_time ASC"
);
const openStmt = db.prepare(
  "SELECT * FROM positions WHERE strategy=? AND status='open' ORDER BY open_time DESC"
);
const closedCountStmt = db.prepare(
  "SELECT COUNT(*) AS count FROM positions WHERE strategy=? AND status='closed'"
);
const equitySeriesStmt = db.prepare(
  "SELECT ts, equity, cash, open_count FROM equity_points WHERE strategy=? ORDER BY ts ASC"
);
const firstEquityStmt = db.prepare(
  "SELECT MIN(ts) AS first FROM equity_points WHERE strategy=?"
);

/** 汇总某策略绩效。 */
export function getStats(strategy, priceMap = {}) {
  const now = Date.now();
  const initial = getInitialCapital(strategy);
  const cash = getCash(strategy);
  const { floating } = floatingEquity(strategy, now, priceMap);
  const equity = cash + floating;

  const closed = closedStmt.all(strategy);
  const wins = closed.filter((t) => t.pnl_usd > 0);
  const losses = closed.filter((t) => t.pnl_usd <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl_usd, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl_usd, 0));
  const realizedPnl = closed.reduce((a, t) => a + t.pnl_usd, 0);

  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  const firstRow = firstEquityStmt.get(strategy);
  const firstTs = firstRow?.first || now;
  const days = Math.max((now - firstTs) / (24 * 3600 * 1000), 1 / 24);
  const totalReturnPct = ((equity - initial) / initial) * 100;
  const avgDailyPnl = realizedPnl / days;
  const avgDailyReturnPct = totalReturnPct / days;

  const series = equitySeriesStmt.all(strategy);
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of series) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) {
      const dd = ((peak - p.equity) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }

  return {
    initialCapital: initial,
    equity: round(equity),
    cash: round(cash),
    floating: round(floating),
    realizedPnl: round(realizedPnl),
    totalReturnPct: round(totalReturnPct),
    avgDailyPnl: round(avgDailyPnl),
    avgDailyReturnPct: round(avgDailyReturnPct),
    runningDays: round(days),
    tradeCount: closed.length,
    openCount: openCount(strategy),
    wins: wins.length,
    losses: losses.length,
    winRate: round(winRate),
    profitFactor: round(profitFactor),
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    maxDrawdownPct: round(maxDd),
  };
}

/** 某策略当前持仓列表（带浮动盈亏）。 */
export function getOpenPositions(strategy, priceMap = {}) {
  return openStmt.all(strategy).map((p) => {
    const price = priceMap[p.symbol] || p.entry_price;
    const dir = p.direction === "long" ? 1 : -1;
    const priceRet = (dir * (price - p.entry_price)) / p.entry_price;
    const floatPnl = priceRet * p.notional;
    return {
      ...p,
      currentPrice: price,
      floatPnlUsd: round(floatPnl),
      floatPnlPct: round((floatPnl / p.margin) * 100),
    };
  });
}

/** 某策略已平仓记录，按退出时间倒序分页。 */
export function getClosedPositions(strategy, limit = 50, offset = 0) {
  const stmt = db.prepare(
    "SELECT * FROM positions WHERE strategy=? AND status='closed' ORDER BY exit_time DESC LIMIT ? OFFSET ?"
  );
  return stmt.all(strategy, Math.max(1, Number(limit) || 50), Math.max(0, Number(offset) || 0));
}

/** 某策略全部已平仓记录数量，用于前端分页。 */
export function getClosedCount(strategy) {
  return Number(closedCountStmt.get(strategy)?.count || 0);
}

/** 某策略权益曲线（最多 N 点，等间隔抽样）。 */
export function getEquityCurve(strategy, maxPoints = 500) {
  const series = equitySeriesStmt.all(strategy);
  if (series.length <= maxPoints) return series;
  const step = Math.ceil(series.length / maxPoints);
  return series.filter((_, i) => i % step === 0 || i === series.length - 1);
}

function round(n) {
  return Math.round(n * 100) / 100;
}
