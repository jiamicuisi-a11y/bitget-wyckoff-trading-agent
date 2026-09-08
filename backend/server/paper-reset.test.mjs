import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { resetPaperState } from "./paper-reset.mjs";

function createDb() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL,
      pnl_usd REAL
    );
    CREATE TABLE equity_points (
      id INTEGER PRIMARY KEY,
      strategy TEXT NOT NULL,
      ts INTEGER NOT NULL,
      equity REAL NOT NULL,
      cash REAL NOT NULL,
      open_count INTEGER NOT NULL
    );
    CREATE TABLE scans (
      id INTEGER PRIMARY KEY,
      strategy TEXT NOT NULL,
      ts INTEGER NOT NULL,
      scanned_count INTEGER NOT NULL,
      hit_count INTEGER NOT NULL,
      opened_count INTEGER NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return database;
}

test("resetPaperState clears only the selected strategy and restores its paper account", () => {
  const database = createDb();
  database.exec(`
    INSERT INTO positions VALUES
      (1, 'anomaly-binance', 'open', NULL),
      (2, 'anomaly-binance', 'closed', -125.5),
      (3, 'dualma4h-binance', 'open', NULL);
    INSERT INTO equity_points VALUES
      (1, 'anomaly-binance', 100, 8700, 1, 0),
      (2, 'dualma4h-binance', 100, 10100, 10100, 0);
    INSERT INTO scans VALUES
      (1, 'anomaly-binance', 100, 700, 12, 1),
      (2, 'dualma4h-binance', 100, 30, 1, 1);
    INSERT INTO meta VALUES
      ('initial_capital:anomaly-binance', '10000'),
      ('cash:anomaly-binance', '8700'),
      ('initial_capital:dualma4h-binance', '10000'),
      ('cash:dualma4h-binance', '10100');
  `);

  const result = resetPaperState(database, "anomaly-binance", 10000, 200);

  assert.deepEqual(result, {
    strategy: "anomaly-binance",
    initialCapital: 10000,
    cash: 10000,
    resetAt: 200,
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM positions WHERE strategy='anomaly-binance'").get().n, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM equity_points WHERE strategy='anomaly-binance'").get().n, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM scans WHERE strategy='anomaly-binance'").get().n, 0);
  assert.deepEqual(
    { ...database.prepare("SELECT ts, equity, cash, open_count FROM equity_points WHERE strategy='anomaly-binance'").get() },
    { ts: 200, equity: 10000, cash: 10000, open_count: 0 },
  );
  assert.equal(Number(database.prepare("SELECT value FROM meta WHERE key='cash:anomaly-binance'").get().value), 10000);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM positions WHERE strategy='dualma4h-binance'").get().n, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM scans WHERE strategy='dualma4h-binance'").get().n, 1);
});
