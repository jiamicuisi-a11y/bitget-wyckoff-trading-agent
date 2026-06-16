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
// 追踪止盈用：记录持仓期间最有利价（多单=最高价 / 空单=最低价）
ensureColumn("positions", "peak_price", "peak_price REAL");

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
