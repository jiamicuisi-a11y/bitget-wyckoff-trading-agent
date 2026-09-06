import test from "node:test";
import assert from "node:assert/strict";
import { rankOpenInterestLeaders } from "./oi-analysis.mjs";

const NOW = Date.parse("2026-09-06T03:15:00.000Z");

test("ranks market-wide OI increases over the requested window", () => {
  const result = rankOpenInterestLeaders({
    now: NOW,
    windowMinutes: 15,
    limit: 2,
    currentRows: [
      { symbol: "BTCUSDT", holdingAmount: "120", lastPr: "60000", usdtVolume: "1000000" },
      { symbol: "ETHUSDT", holdingAmount: "210", lastPr: "3000", usdtVolume: "900000" },
      { symbol: "SOLUSDT", holdingAmount: "90", lastPr: "140", usdtVolume: "500000" },
    ],
    history: [
      { symbol: "binance:BTCUSDT", oi: 100, ts: NOW - 15 * 60 * 1000 },
      { symbol: "binance:ETHUSDT", oi: 200, ts: NOW - 15 * 60 * 1000 },
      { symbol: "binance:SOLUSDT", oi: 100, ts: NOW - 15 * 60 * 1000 },
    ],
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.leaders.map((row) => row.symbol), ["BTCUSDT", "ETHUSDT"]);
  assert.equal(result.leaders[0].changePct, 20);
  assert.equal(result.coverage.scannedCount, 3);
});

test("reports when the requested OI history window is not ready", () => {
  const result = rankOpenInterestLeaders({
    now: NOW,
    windowMinutes: 15,
    currentRows: [{ symbol: "BTCUSDT", holdingAmount: "120", lastPr: "60000" }],
    history: [{ symbol: "binance:BTCUSDT", oi: 100, ts: NOW - 5 * 60 * 1000 }],
  });
  assert.equal(result.ready, false);
  assert.equal(result.leaders.length, 0);
  assert.equal(result.coverage.observedMinutes, 5);
});
