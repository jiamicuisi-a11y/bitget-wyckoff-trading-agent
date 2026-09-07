import test from "node:test";
import assert from "node:assert/strict";
import { scanTickers } from "./scanner.mjs";

const baseTicker = {
  symbol: "BTCUSDT",
  lastPr: "100",
  holdingAmount: "20000",
  changeUtc24h: "0.02",
  fundingRate: "0.0001",
  usdtVolume: "100000000",
};

test("A-tier keeps the original order-book pressure input", () => {
  const result = scanTickers(
    [{ ...baseTicker, bidSz: "90", askSz: "10" }],
    { BTCUSDT: 19000 },
    { minScore: 35, minOiUsd: 1_000_000, maxHits: 5 }
  );

  assert.equal(result.coverage.oiAvailableCount, 1);
  assert.equal(result.allCandidates.length, 1);
  assert.equal(result.allCandidates[0].bidAskImbalance, 0.8);
  assert.equal(result.allCandidates[0].direction, "long");
});

test("missing order-book quantities do not masquerade as active pressure", () => {
  const result = scanTickers(
    [{ ...baseTicker, bidSz: "0", askSz: "0" }],
    { BTCUSDT: 19000 },
    { minScore: 35, minOiUsd: 1_000_000, maxHits: 5 }
  );

  assert.equal(result.allCandidates.length, 1);
  assert.equal(result.allCandidates[0].bidAskImbalance, 0);
  assert.equal(result.allCandidates[0].factors.activeBuy, 0);
  assert.notEqual(result.allCandidates[0].tag, "主动买领先多");
});
