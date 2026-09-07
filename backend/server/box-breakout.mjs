const BAR_MS = 30 * 60 * 1000;

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function timestampMs(value) {
  const number = finite(value);
  if (number == null) return null;
  return number < 100_000_000_000 ? number * 1000 : number;
}

export function normalizeCandles(candles) {
  if (!Array.isArray(candles)) return [];
  return candles
    .map((candle) => ({
      ...candle,
      time: finite(candle.time),
      open: finite(candle.open),
      high: finite(candle.high),
      low: finite(candle.low),
      close: finite(candle.close),
      volume: finite(candle.volume),
    }))
    .filter((candle) => candle.time != null && candle.high != null && candle.low != null && candle.close != null)
    .sort((a, b) => a.time - b.time);
}

export function detectBox(candles, options = {}) {
  const lookback = Math.max(2, Number(options.boxLookback ?? 48));
  const rows = normalizeCandles(candles);
  if (rows.length < lookback) return null;
  const window = rows.slice(-lookback);
  const high = Math.max(...window.map((row) => row.high));
  const low = Math.min(...window.map((row) => row.low));
  if (!(high > low)) return null;
  const widthPct = ((high - low) / low) * 100;
  const minWidthPct = Number(options.minBoxWidthPct ?? 1);
  const maxWidthPct = Number(options.maxBoxWidthPct ?? 20);
  if (widthPct < minWidthPct || widthPct > maxWidthPct) return null;
  const volumes = window.map((row) => row.volume).filter((volume) => volume != null && volume > 0);
  if (volumes.length < Math.ceil(lookback * 0.8)) return null;
  return {
    high,
    low,
    widthPct,
    averageVolume: volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length,
    startTime: window[0].time,
    endTime: window[window.length - 1].time,
    bars: window.length,
  };
}

export function detectBreakout(candle, box, options = {}) {
  if (!candle || !box || !(candle.close > 0) || !(box.high > 0)) return null;
  const breakoutPct = ((candle.close - box.high) / box.high) * 100;
  const minBreakoutPct = Number(options.breakoutPct ?? 0.3);
  const volumeMultiplier = Number(options.volumeMultiplier ?? 1.5);
  const volumeRatio = box.averageVolume > 0 && candle.volume > 0 ? candle.volume / box.averageVolume : null;
  if (breakoutPct < minBreakoutPct || volumeRatio == null || volumeRatio < volumeMultiplier) return null;
  return {
    direction: "long",
    breakoutPct,
    breakoutVolume: candle.volume,
    volumeRatio,
    breakoutCandleTime: candle.time,
  };
}

export function scanBoxBreakouts(candles, options = {}) {
  const rows = normalizeCandles(candles);
  const now = timestampMs(options.now ?? Date.now());
  if (!now) return null;
  const closed = rows.filter((row) => timestampMs(row.time) + BAR_MS <= now);
  if (closed.length < Number(options.boxLookback ?? 48) + 1) return null;
  const breakoutCandle = closed[closed.length - 1];
  const boxRows = closed.slice(0, -1);
  const box = detectBox(boxRows, options);
  const breakout = detectBreakout(breakoutCandle, box, options);
  if (!breakout) return null;
  const lastPrice = breakoutCandle.close;
  return {
    symbol: options.symbol || null,
    direction: "long",
    score: Math.min(100, Math.round(60 + Math.min(40, breakout.volumeRatio * 10))),
    tag: "30m 箱体向上突破",
    lastPrice,
    boxHigh: box.high,
    boxLow: box.low,
    boxWidthPct: box.widthPct,
    breakoutPct: breakout.breakoutPct,
    breakoutCandleTime: breakout.breakoutCandleTime,
    breakoutVolume: breakout.breakoutVolume,
    boxAverageVolume: box.averageVolume,
    volumeRatio: breakout.volumeRatio,
    reason: `30m 已收盘 K 线收盘价站上箱体上沿 ${breakout.breakoutPct.toFixed(2)}%，突破量为箱体均量 ${breakout.volumeRatio.toFixed(2)} 倍；只做多。`,
  };
}

export function scanBoxBreakoutUniverse(tickers, fetchKlines, options = {}) {
  const topN = Math.max(1, Number(options.topN ?? 100));
  const universe = [...(tickers || [])]
    .map((ticker) => ({ symbol: ticker.symbol, volume: Number(ticker.usdtVolume || 0) }))
    .filter((ticker) => ticker.symbol && ticker.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, topN);
  return universe;
}
