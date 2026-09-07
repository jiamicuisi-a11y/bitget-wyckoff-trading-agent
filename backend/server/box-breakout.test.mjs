import test from "node:test";
import assert from "node:assert/strict";

import { detectBox, detectBreakout, scanBoxBreakouts } from "./box-breakout.mjs";

const INTERVAL_MS = 30 * 60 * 1000;
const NOW = 100 * INTERVAL_MS;

function candle(index, { open = 100, high = 101, low = 99, close = 100, volume = 100 } = {}) {
  return { time: index * 30 * 60, open, high, low, close, volume };
}

function baseCandles() {
  return Array.from({ length: 50 }, (_, index) => candle(index, {
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 100,
  }));
}

test("箱体内震荡不会生成突破信号", () => {
  const candles = baseCandles();
  candles[49] = candle(49, { high: 100.8, low: 99.2, close: 100.4, volume: 220 });

  assert.equal(scanBoxBreakouts(candles, { now: NOW, boxLookback: 48 }), null);
});

test("只有最高价刺破箱体、收盘没有站上沿时不会生成信号", () => {
  const candles = baseCandles();
  candles[49] = candle(49, { high: 103, low: 99.5, close: 100.5, volume: 220 });

  assert.equal(scanBoxBreakouts(candles, { now: NOW, boxLookback: 48, breakoutPct: 0.3 }), null);
});

test("收盘突破但成交量不足时不会生成信号", () => {
  const candles = baseCandles();
  candles[49] = candle(49, { high: 103, low: 100.2, close: 102, volume: 110 });

  assert.equal(scanBoxBreakouts(candles, {
    now: NOW,
    boxLookback: 48,
    breakoutPct: 0.3,
    volumeMultiplier: 1.5,
  }), null);
});

test("已收盘、有效收盘突破并放量时生成唯一做多候选", () => {
  const candles = baseCandles();
  candles[49] = candle(49, { high: 103, low: 100.2, close: 102, volume: 180 });
  const result = scanBoxBreakouts(candles, {
    symbol: "BTCUSDT",
    now: NOW,
    boxLookback: 48,
    breakoutPct: 0.3,
    volumeMultiplier: 1.5,
  });

  assert.equal(result.direction, "long");
  assert.equal(result.symbol, "BTCUSDT");
  assert.equal(result.boxHigh, 101);
  assert.equal(result.boxLow, 99);
  assert.equal(result.breakoutCandleTime, candles[49].time);
  assert.equal(result.volumeRatio, 1.8);
  assert.match(result.reason, /30m/);
});

test("最新未收盘 K 线不会被当成突破信号", () => {
  const candles = baseCandles();
  candles[49] = candle(49, { high: 103, low: 100.2, close: 102, volume: 180 });

  assert.equal(scanBoxBreakouts(candles, {
    symbol: "ETHUSDT",
    now: 89_999,
    boxLookback: 48,
  }), null);
});

test("数据不足或缺少成交量时安全返回空结果", () => {
  assert.equal(detectBox(baseCandles().slice(0, 10), { boxLookback: 48 }), null);
  assert.equal(detectBreakout(baseCandles().slice(0, 2), null), null);
});
