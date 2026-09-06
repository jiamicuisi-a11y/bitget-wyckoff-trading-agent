// 模拟盘引擎（多策略版）：每个策略独立 1 万 U 账户，互不干扰。
// A档异动命中 -> 自动模拟开仓 -> 盯仓 -> 止盈/止损/超时平仓。永不碰真钱。
//
// 开仓模型（固定风险 + 杠杆）：
//   - 每笔风险 riskPerTrade（默认账户权益的 1.5%）
//   - 止损距离按入场价的 stopPct（默认 3%），止盈 = 止损距离 × targetR（默认 2）
//   - 名义价值 = 风险金额 / stopPct；保证金 = 名义 / 杠杆（默认 3x）
//   - 现金不足时跳过开仓
//
// 盯仓：每轮用最新价检查持仓是否触及止盈/止损；超过 maxHoldHours 强制超时平仓。
// 去重：同策略下 symbol+direction 已有 open 持仓时不重复开；平仓后 cooldownMin 内不再开。
//
// 所有读写都按 strategy 隔离，每个策略各算各的绩效。

import { db, getCash, setCash, ensureAccount } from "./db.mjs";

export const PAPER_CONFIG = {
  riskPerTradePct: 1.5, // 每笔风险占当前权益的百分比
  stopPct: 3, // 止损距离（入场价的百分比）
  targetR: 2, // 止盈 = 止损距离 × R
  leverage: 3, // 杠杆
  cooldownMin: 90, // 同标的同向平仓后冷却分钟
  maxHoldHours: 48, // 最大持仓时长，超时强平
  takerFeePct: 0.06, // 单边手续费百分比
  maxConcurrent: 4, // 最大同时持仓数
  minScoreToOpen: 48, // 开仓最低分（只开榜单最顶尖异动，真低频高质量）
  maxOpenPerCycle: 2, // 单个扫描周期最多新开仓数（防止一轮梭哈）
};

const insertPos = db.prepare(`
  INSERT INTO positions
    (strategy, symbol, direction, tag, score, entry_price, stop_price, target_price,
     qty, notional, margin, leverage, status, open_time, open_reason)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
`);

const closePosStmt = db.prepare(`
  UPDATE positions
     SET status='closed', exit_price=?, exit_time=?, exit_reason=?,
         pnl_usd=?, pnl_pct=?, fee_usd=?
   WHERE id=?
`);

const openPositionsStmt = db.prepare(
  "SELECT * FROM positions WHERE strategy=? AND status='open'"
);
const hasOpenStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM positions WHERE strategy=? AND symbol=? AND direction=? AND status='open'"
);
const recentClosedStmt = db.prepare(
  "SELECT MAX(exit_time) AS last FROM positions WHERE strategy=? AND symbol=? AND direction=? AND status='closed'"
);
const updatePeakStmt = db.prepare(
  "UPDATE positions SET peak_price=? WHERE id=?"
);
const insertEquity = db.prepare(
  "INSERT INTO equity_points (strategy, ts, equity, cash, open_count) VALUES (?, ?, ?, ?, ?)"
);
const insertScan = db.prepare(
  "INSERT INTO scans (strategy, ts, scanned_count, hit_count, opened_count) VALUES (?, ?, ?, ?, ?)"
);

/** 某策略当前未平仓持仓数。 */
function openCount(strategy) {
  return openPositionsStmt.all(strategy).length;
}

/** 判断是否允许对 symbol+direction 开仓（同策略内去重 + 冷却）。 */
function canOpen(strategy, symbol, direction, now, cfg) {
  const open = hasOpenStmt.get(strategy, symbol, direction).n;
  if (open > 0) return false;
  const last = recentClosedStmt.get(strategy, symbol, direction).last;
  if (last && now - last < cfg.cooldownMin * 60 * 1000) return false;
  return true;
}

/**
 * 处理一批扫描命中，决定该策略开哪些仓。
 * @param strategy   策略 id
 * @param candidates 来自策略的开仓候选（已按分降序）
 * @param now ms
 * @returns 开仓数
 */
export function openFromCandidates(strategy, candidates, now, cfg = PAPER_CONFIG) {
  ensureAccount(strategy);
  let opened = 0;
  const perCycleCap = cfg.maxOpenPerCycle ?? cfg.maxConcurrent;
  for (const c of candidates) {
    if (opened >= perCycleCap) break;
    if (openCount(strategy) >= cfg.maxConcurrent) break;
    if (c.score < cfg.minScoreToOpen) continue;
    if (!canOpen(strategy, c.symbol, c.direction, now, cfg)) continue;

    if (cfg.instantClose) {
      const cash = getCash(strategy);
      const margin = Math.min(cash, cfg.tradeCapitalUsd || cash);
      if (!(margin > 0)) continue;
      const pnlPct = Number(c.netEdgePct || 0);
      if (!(pnlPct > 0)) continue;
      const entry = 1;
      const exit = entry * (1 + pnlPct / 100);
      const info = insertPos.run(
        strategy,
        c.symbol,
        c.direction,
        c.tag,
        c.score,
        entry,
        0,
        exit,
        margin,
        margin,
        margin,
        1,
        now,
        `${c.tag}（净edge ${pnlPct.toFixed(3)}%）`
      );
      setCash(strategy, cash - margin);
      closePosition(strategy, { id: info.lastInsertRowid, direction: c.direction, entry_price: entry, notional: margin, margin }, exit, now, c.exitReason || "套利完成", { ...cfg, takerFeePct: 0 });
      opened++;
      continue;
    }

    const entry = c.lastPrice;
    if (!(entry > 0)) continue;

    const equity = getCash(strategy) + floatingEquity(strategy, now).floating;
    const riskUsd = (equity * cfg.riskPerTradePct) / 100;
    const stopDist = entry * (cfg.stopPct / 100);
    if (stopDist <= 0) continue;

    const notional = riskUsd / (cfg.stopPct / 100);
    const qty = notional / entry;
    const margin = notional / cfg.leverage;
    const openFee = notional * (cfg.takerFeePct / 100);

    const cash = getCash(strategy);
    if (margin + openFee > cash) continue;

    const stop =
      c.direction === "long" ? entry - stopDist : entry + stopDist;
    const target =
      c.direction === "long"
        ? entry + stopDist * cfg.targetR
        : entry - stopDist * cfg.targetR;

    insertPos.run(
      strategy,
      c.symbol,
      c.direction,
      c.tag,
      c.score,
      entry,
      stop,
      target,
      qty,
      notional,
      margin,
      cfg.leverage,
      now,
      `${c.tag}（分${c.score}）`
    );
    setCash(strategy, cash - margin - openFee);
    opened++;
  }
  return opened;
}

/**
 * 用最新价对某策略所有持仓盯仓，触及止盈/止损/超时则平仓。
 * @param strategy 策略 id
 * @param priceMap { symbol: lastPrice }
 * @param now ms
 * @returns 平仓数
 */
export function managePositions(strategy, priceMap, now, cfg = PAPER_CONFIG) {
  const positions = openPositionsStmt.all(strategy);
  let closed = 0;
  for (const p of positions) {
    const price = priceMap[p.symbol];
    if (!(price > 0)) continue;

    let exitPrice = null;
    let reason = null;
    const isLong = p.direction === "long";

    if (isLong) {
      if (price <= p.stop_price) {
        exitPrice = p.stop_price;
        reason = "止损";
      } else if (price >= p.target_price) {
        exitPrice = p.target_price;
        reason = "止盈";
      }
    } else {
      if (price >= p.stop_price) {
        exitPrice = p.stop_price;
        reason = "止损";
      } else if (price <= p.target_price) {
        exitPrice = p.target_price;
        reason = "止盈";
      }
    }

    if (exitPrice === null && now - p.open_time >= cfg.maxHoldHours * 3600 * 1000) {
      exitPrice = price;
      reason = "超时平仓";
    }

    if (exitPrice !== null) {
      closePosition(strategy, p, exitPrice, now, reason, cfg);
      closed++;
    }
  }
  return closed;
}

/**
 * 多空不对称平仓（趋势版）：
 *   - 空单：保持「快进快出」——固定止损 + 固定止盈（targetR），到价就走，吃一波落袋。
 *           理由：标的最多归零，下行空间有限，没必要久拿。
 *   - 多单：固定止损保命，但「不设固定止盈」，改用追踪止盈（trailing）：
 *           记录持仓期间最高价 peak，价格从 peak 回撤超过 trailGivebackPct 才平。
 *           理由：上行无天花板，给单边大行情留出生长空间，趋势没走完就一直拿。
 *           需先冲过 trailArmPct（默认 = 一个 targetR 的距离）才激活追踪，避免刚进场小波动就被甩。
 * 与 managePositions 同样支持 maxHoldHours 超时强平（多单可单独放宽 longMaxHoldHours）。
 * 完全独立函数，不影响 A 档原 managePositions。
 */
export function managePositionsAsym(strategy, priceMap, now, cfg = PAPER_CONFIG) {
  const positions = openPositionsStmt.all(strategy);
  let closed = 0;
  const stopFrac = cfg.stopPct / 100;
  const armFrac = (cfg.trailArmPct ?? cfg.stopPct * cfg.targetR) / 100; // 多单激活追踪的盈利门槛
  const givebackFrac = (cfg.trailGivebackPct ?? cfg.stopPct) / 100; // 从峰值回撤多少平多单
  for (const p of positions) {
    const price = priceMap[p.symbol];
    if (!(price > 0)) continue;

    let exitPrice = null;
    let reason = null;

    if (p.direction === "short") {
      // 空单：固定止损 + 固定止盈，快进快出
      if (price >= p.stop_price) {
        exitPrice = p.stop_price;
        reason = "止损";
      } else if (price <= p.target_price) {
        exitPrice = p.target_price;
        reason = "止盈";
      }
    } else {
      // 多单：固定止损保命 + 追踪止盈搏单边
      if (price <= p.stop_price) {
        exitPrice = p.stop_price;
        reason = "止损";
      } else {
        // 更新峰值价（持仓期间最高价）
        const peak = Math.max(p.peak_price ?? p.entry_price, price);
        if (peak !== p.peak_price) updatePeakStmt.run(peak, p.id);
        // 冲过激活门槛后才启用追踪：从峰值回撤超过 giveback 即平
        const armed = peak >= p.entry_price * (1 + armFrac);
        if (armed && price <= peak * (1 - givebackFrac)) {
          exitPrice = price;
          reason = "追踪止盈";
        }
      }
    }

    if (exitPrice === null) {
      const holdCap =
        p.direction === "long" && cfg.longMaxHoldHours
          ? cfg.longMaxHoldHours
          : cfg.maxHoldHours;
      if (now - p.open_time >= holdCap * 3600 * 1000) {
        exitPrice = price;
        reason = "超时平仓";
      }
    }

    if (exitPrice !== null) {
      closePosition(strategy, p, exitPrice, now, reason, cfg);
      closed++;
    }
  }
  return closed;
}

function closePosition(strategy, p, exitPrice, now, reason, cfg) {
  const dir = p.direction === "long" ? 1 : -1;
  const priceRet = (dir * (exitPrice - p.entry_price)) / p.entry_price;
  const grossPnl = priceRet * p.notional;
  const closeFee = p.notional * (cfg.takerFeePct / 100);
  const netPnl = grossPnl - closeFee;
  const pnlPct = (netPnl / p.margin) * 100;

  closePosStmt.run(
    exitPrice,
    now,
    reason,
    Math.round(netPnl * 100) / 100,
    Math.round(pnlPct * 100) / 100,
    Math.round(closeFee * 100) / 100,
    p.id
  );
  setCash(strategy, getCash(strategy) + p.margin + netPnl);
}

/** 计算某策略当前所有持仓的浮动权益（含保证金本身，不含现金）。 */
export function floatingEquity(strategy, now, priceMap = {}) {
  const positions = openPositionsStmt.all(strategy);
  let floating = 0;
  for (const p of positions) {
    const price = priceMap[p.symbol] || p.entry_price;
    const dir = p.direction === "long" ? 1 : -1;
    const priceRet = (dir * (price - p.entry_price)) / p.entry_price;
    floating += p.margin + priceRet * p.notional;
  }
  return { floating };
}

/** 记某策略一笔权益快照。 */
export function snapshotEquity(strategy, now, priceMap = {}) {
  const cash = getCash(strategy);
  const { floating } = floatingEquity(strategy, now, priceMap);
  const equity = cash + floating;
  insertEquity.run(
    strategy,
    now,
    Math.round(equity * 100) / 100,
    Math.round(cash * 100) / 100,
    openCount(strategy)
  );
  return { equity, cash, floating, openCount: openCount(strategy) };
}

/** 记某策略一次扫描元信息。 */
export function recordScan(strategy, now, scannedCount, hitCount, openedCount) {
  insertScan.run(strategy, now, scannedCount, hitCount, openedCount);
}

export { openCount };
