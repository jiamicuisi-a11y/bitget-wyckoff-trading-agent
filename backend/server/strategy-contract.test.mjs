import test from "node:test";
import assert from "node:assert/strict";
import { enrichDualMaSignal } from "./strategies.mjs";

test("dual-ma signal exposes explanation fields", () => {
  const result = enrichDualMaSignal({
    symbol: "ETHUSDT",
    direction: "long",
    signal: "golden",
    lastPrice: 2500,
    fastEma: 2498,
    slowEma: 2480,
    fastPeriod: 10,
    slowPeriod: 30,
    signalCandleTime: 1710000000000,
    volumeRank: 3,
    granularity: "4H",
  });

  assert.equal(result.signal, "golden");
  assert.equal(result.volumeRank, 3);
  assert.match(result.reason, /EMA10/);
  assert.match(result.reason, /EMA30/);
});
