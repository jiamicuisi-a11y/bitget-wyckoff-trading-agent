// 数据层：Node 24 内置 SQLite（node:sqlite），零 npm 依赖。
//
// 多策略设计：每个策略（strategy）拥有独立的 1 万 U 模拟账户，
// 持仓 / 权益曲线 / 扫描记录都带 strategy 字段区分，绩效各算各的、可横向对比。
//
// 表：
//   positions     — 模拟持仓/已平仓记录（带 strategy）
//   equity_points — 各策略账户权益时间序列（带 strategy）
//   oi_snapshot   — 全市场 OI 快照（市场数据，全策略共享，不分 strategy）
//   scans         — 每次扫描元信息（带 strategy）
//   meta          — 键值表，账户现金/初始资金按 strategy 分键存储

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH =
  process.env.QUANT_DB_PATH ||
  new URL("./data/quant.db", import.meta.url).pathname;

const dir = dirname(DB_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS positions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy      TEXT NOT NULL DEFAULT 'anomaly',
    symbol        TEXT NOT NULL,
    direction     TEXT NOT NULL,
    tag           TEXT NOT NULL,
    score         REAL NOT NULL,
    entry_price   REAL NOT NULL,
    stop_price    REAL NOT NULL,
    target_price  REAL NOT NULL,
    qty           REAL NOT NULL,
    notional      REAL NOT NULL,
    margin        REAL NOT NULL,
    leverage      REAL NOT NULL DEFAULT 3,
    status        TEXT NOT NULL DEFAULT 'open',
    open_time     INTEGER NOT NULL,
    open_reason   TEXT,
    exit_price    REAL,
    exit_time     INTEGER,
    exit_reason   TEXT,
    pnl_usd       REAL,
    pnl_pct       REAL,
    fee_usd       REAL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_positions_strat_status ON positions(strategy, status);
  CREATE INDEX IF NOT EXISTS idx_positions_dedup ON positions(strategy, symbol, direction, status);

  CREATE TABLE IF NOT EXISTS equity_points (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy  TEXT NOT NULL DEFAULT 'anomaly',
    ts        INTEGER NOT NULL,
    equity    REAL NOT NULL,
    cash      REAL NOT NULL,
    open_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_equity_strat_ts ON equity_points(strategy, ts);

  CREATE TABLE IF NOT EXISTS oi_snapshot (
    symbol TEXT PRIMARY KEY,
    oi     REAL NOT NULL,
    ts     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oi_history (
    symbol TEXT NOT NULL,
    oi     REAL NOT NULL,
    ts     INTEGER NOT NULL,
    PRIMARY KEY(symbol, ts)
  );
  CREATE INDEX IF NOT EXISTS idx_oi_history_ts ON oi_history(ts);

  CREATE TABLE IF NOT EXISTS scans (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy      TEXT NOT NULL DEFAULT 'anomaly',
    ts            INTEGER NOT NULL,
    scanned_count INTEGER NOT NULL,
    hit_count     INTEGER NOT NULL,
    opened_count  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL UNIQUE,
    strategy        TEXT NOT NULL,
    intent          TEXT NOT NULL,
    started_at      INTEGER NOT NULL,
    completed_at    INTEGER NOT NULL,
    scanned_count   INTEGER NOT NULL DEFAULT 0,
    candidate_count INTEGER NOT NULL DEFAULT 0,
    plan_count      INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'completed',
    broadcast       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_completed ON agent_runs(completed_at DESC);

  CREATE TABLE IF NOT EXISTS agent_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id   TEXT NOT NULL,
    phase    TEXT NOT NULL,
    detail   TEXT NOT NULL,
    status   TEXT NOT NULL,
    demo     INTEGER NOT NULL DEFAULT 0,
    ts       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_events_run_ts ON agent_events(run_id, ts);

  CREATE TABLE IF NOT EXISTS intelligence_items (
    id            TEXT PRIMARY KEY,
    source        TEXT NOT NULL,
    type          TEXT NOT NULL,
    title         TEXT NOT NULL,
    published_at  INTEGER,
    url           TEXT NOT NULL,
    summary       TEXT,
    assets_json   TEXT NOT NULL,
    details_json  TEXT,
    raw_available INTEGER NOT NULL DEFAULT 0,
    fetched_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_intelligence_items_source_published ON intelligence_items(source, published_at DESC);

  CREATE TABLE IF NOT EXISTS intelligence_sources (
    source          TEXT PRIMARY KEY,
    last_success_at INTEGER,
    last_attempt_at INTEGER,
    last_error      TEXT,
    updated_at      INTEGER NOT NULL
  );
`);

// ---- 旧库迁移：若是单策略老表，补 strategy 列 ----
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("positions", "strategy", "strategy TEXT NOT NULL DEFAULT 'anomaly'");
ensureColumn("equity_points", "strategy", "strategy TEXT NOT NULL DEFAULT 'anomaly'");
ensureColumn("scans", "strategy", "strategy TEXT NOT NULL DEFAULT 'anomaly'");
ensureColumn("intelligence_items", "details_json", "details_json TEXT");
// 追踪止盈用：记录持仓期间最有利价（多单=最高价 / 空单=最低价）
ensureColumn("positions", "peak_price", "peak_price REAL");

const insertOiHistoryStmt = db.prepare("INSERT OR REPLACE INTO oi_history(symbol, oi, ts) VALUES(?, ?, ?)");
const listOiHistoryStmt = db.prepare("SELECT symbol, oi, ts FROM oi_history WHERE ts >= ? ORDER BY ts ASC");
const pruneOiHistoryStmt = db.prepare("DELETE FROM oi_history WHERE ts < ?");

export function appendOiHistory(snapshot, ts, retentionMs = 24 * 60 * 60 * 1000) {
  db.exec("BEGIN");
  try {
    for (const [symbol, oi] of Object.entries(snapshot || {})) {
      if (Number(oi) > 0) insertOiHistoryStmt.run(symbol, Number(oi), Number(ts));
    }
    pruneOiHistoryStmt.run(Number(ts) - retentionMs);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getOiHistorySince(since) {
  return listOiHistoryStmt.all(Number(since));
}

// ---- meta 读写 ----
const getMetaStmt = db.prepare("SELECT value FROM meta WHERE key = ?");
const setMetaStmt = db.prepare(
  "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

export function getMeta(key, fallback = null) {
  const row = getMetaStmt.get(key);
  return row ? row.value : fallback;
}
export function setMeta(key, value) {
  setMetaStmt.run(key, String(value));
}

export const INITIAL_CAPITAL = Number(process.env.QUANT_INITIAL_CAPITAL || 10000);

// ---- 按策略隔离的账户现金 ----
// 每个策略首次出现时，自动初始化 1 万 U 独立账户。
export function ensureAccount(strategy) {
  if (getMeta(`initial_capital:${strategy}`) === null) {
    setMeta(`initial_capital:${strategy}`, INITIAL_CAPITAL);
    setMeta(`cash:${strategy}`, INITIAL_CAPITAL);
  }
}
export function getCash(strategy) {
  return Number(getMeta(`cash:${strategy}`, INITIAL_CAPITAL));
}
export function setCash(strategy, v) {
  setMeta(`cash:${strategy}`, v);
}
export function getInitialCapital(strategy) {
  return Number(getMeta(`initial_capital:${strategy}`, INITIAL_CAPITAL));
}

const insertAgentRun = db.prepare(`
  INSERT INTO agent_runs
    (run_id, strategy, intent, started_at, completed_at, scanned_count, candidate_count, plan_count, status, broadcast)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertAgentEvent = db.prepare(`
  INSERT INTO agent_events (run_id, phase, detail, status, demo, ts)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const listAgentRunsStmt = db.prepare("SELECT * FROM agent_runs ORDER BY completed_at DESC LIMIT ?");
const getAgentRunStmt = db.prepare("SELECT * FROM agent_runs WHERE run_id = ?");
const getAgentEventsStmt = db.prepare("SELECT * FROM agent_events WHERE run_id = ? ORDER BY ts ASC, id ASC");

export function persistAgentRun(result) {
  const startedAt = Number(result.events?.[0]?.ts || Date.now());
  const completedAt = Date.parse(result.completedAt) || Date.now();
  db.exec("BEGIN");
  try {
    insertAgentRun.run(
      result.runId,
      result.strategy,
      result.intent,
      startedAt,
      completedAt,
      Number(result.tools?.[0]?.result?.scannedCount || 0),
      Number(result.decision?.liveCandidateCount || 0),
      Number(result.decision?.selectedPlanCount || 0),
      "completed",
      result.decision?.broadcast ? 1 : 0,
    );
    for (const event of result.events || []) {
      insertAgentEvent.run(result.runId, event.phase, event.detail, event.status, event.demo ? 1 : 0, event.ts || completedAt);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listAgentRuns(limit = 50) {
  return listAgentRunsStmt.all(Math.min(Math.max(Number(limit) || 50, 1), 200));
}

export function getAgentRun(runId) {
  const run = getAgentRunStmt.get(runId);
  if (!run) return null;
  return { ...run, broadcast: Boolean(run.broadcast), events: getAgentEventsStmt.all(runId).map((event) => ({ ...event, demo: Boolean(event.demo) })) };
}

const upsertIntelligenceItemStmt = db.prepare(`
  INSERT INTO intelligence_items
    (id, source, type, title, published_at, url, summary, assets_json, details_json, raw_available, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    source=excluded.source, type=excluded.type, title=excluded.title, published_at=excluded.published_at,
    url=excluded.url, summary=excluded.summary, assets_json=excluded.assets_json,
    details_json=excluded.details_json,
    raw_available=excluded.raw_available, fetched_at=excluded.fetched_at
`);
const getIntelligenceSourceStmt = db.prepare("SELECT * FROM intelligence_sources WHERE source = ?");
const upsertIntelligenceSourceStmt = db.prepare(`
  INSERT INTO intelligence_sources (source, last_success_at, last_attempt_at, last_error, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(source) DO UPDATE SET
    last_success_at=excluded.last_success_at, last_attempt_at=excluded.last_attempt_at,
    last_error=excluded.last_error, updated_at=excluded.updated_at
`);

function itemFromRow(row) {
  let assets = [];
  try { assets = JSON.parse(row.assets_json || "[]"); } catch { assets = []; }
  let activityDetails = null;
  try { activityDetails = row.details_json ? JSON.parse(row.details_json) : null; } catch { activityDetails = null; }
  return {
    id: row.id,
    externalId: String(row.id).split(":").slice(1).join(":"),
    title: row.title,
    source: row.source,
    type: row.type,
    publishedAt: row.published_at ? new Date(Number(row.published_at)).toISOString() : null,
    url: row.url,
    summary: row.summary || "",
    assets: Array.isArray(assets) ? assets : [],
    activityDetails,
    rawAvailable: Boolean(row.raw_available),
  };
}

export function upsertIntelligenceItems(items, fetchedAt = Date.now()) {
  if (!Array.isArray(items) || !items.length) return;
  db.exec("BEGIN");
  try {
    for (const item of items) {
      upsertIntelligenceItemStmt.run(
        item.id,
        item.source,
        item.type,
        item.title,
        item.publishedAt ? Date.parse(item.publishedAt) : null,
        item.url,
        item.summary || "",
        JSON.stringify(item.assets || []),
        item.activityDetails ? JSON.stringify(item.activityDetails) : null,
        item.rawAvailable ? 1 : 0,
        Number(fetchedAt)
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listIntelligenceItems({ source, type, limit = 100 } = {}) {
  const clauses = [];
  const args = [];
  if (source) { clauses.push("source = ?"); args.push(source); }
  if (type) { clauses.push("type = ?"); args.push(type); }
  args.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM intelligence_items ${where} ORDER BY published_at DESC LIMIT ?`).all(...args).map(itemFromRow);
}

export function getIntelligenceSourceState(source) {
  const row = getIntelligenceSourceStmt.get(source);
  if (!row) return null;
  return {
    source: row.source,
    lastSuccessAt: row.last_success_at || null,
    lastAttemptAt: row.last_attempt_at || null,
    stale: Boolean(row.last_error),
    error: row.last_error || null,
  };
}

export function setIntelligenceSourceState(source, state = {}) {
  upsertIntelligenceSourceStmt.run(
    source,
    state.lastSuccessAt || null,
    state.lastAttemptAt || null,
    state.error || null,
    Date.now()
  );
}
