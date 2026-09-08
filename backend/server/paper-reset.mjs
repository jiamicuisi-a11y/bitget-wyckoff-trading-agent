/**
 * Reset one paper account without touching any other strategy namespace.
 * The caller owns the database connection so this helper can be tested with
 * an in-memory database and used by the live service safely.
 */
export function resetPaperState(database, strategy, initialCapital, resetAt = Date.now()) {
  const key = String(strategy || "").trim();
  const capital = Number(initialCapital);
  const ts = Number(resetAt);
  if (!key) throw new Error("缺少模拟盘策略");
  if (!Number.isFinite(capital) || capital <= 0) throw new Error("初始资金必须是正数");
  if (!Number.isFinite(ts)) throw new Error("重置时间无效");

  const setMeta = database.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM positions WHERE strategy=?").run(key);
    database.prepare("DELETE FROM equity_points WHERE strategy=?").run(key);
    database.prepare("DELETE FROM scans WHERE strategy=?").run(key);
    setMeta.run(`initial_capital:${key}`, capital);
    setMeta.run(`cash:${key}`, capital);
    database
      .prepare(
        "INSERT INTO equity_points (strategy, ts, equity, cash, open_count) VALUES (?, ?, ?, ?, ?)",
      )
      .run(key, ts, capital, capital, 0);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return { strategy: key, initialCapital: capital, cash: capital, resetAt: ts };
}
