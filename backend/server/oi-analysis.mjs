function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function symbolFromHistory(value) {
  return String(value || "").replace(/^binance:/, "");
}

export function rankOpenInterestLeaders({ currentRows = [], history = [], now = Date.now(), windowMinutes = 15, limit = 10 } = {}) {
  const requestedMinutes = Math.max(1, Math.min(Number(windowMinutes) || 15, 1440));
  const cutoff = now - requestedMinutes * 60 * 1000;
  const historyBySymbol = new Map();
  for (const point of history) {
    const symbol = symbolFromHistory(point.symbol);
    if (!symbol || !Number.isFinite(Number(point.ts)) || number(point.oi) <= 0) continue;
    const points = historyBySymbol.get(symbol) || [];
    points.push({ oi: number(point.oi), ts: Number(point.ts) });
    historyBySymbol.set(symbol, points);
  }
  for (const points of historyBySymbol.values()) points.sort((a, b) => a.ts - b.ts);

  const leaders = [];
  let baselineCount = 0;
  let missingBaselineCount = 0;
  let observedMinutes = 0;
  for (const row of currentRows) {
    const symbol = String(row.symbol || "").toUpperCase();
    const currentOi = number(row.holdingAmount);
    if (!symbol || currentOi <= 0) continue;
    const points = historyBySymbol.get(symbol) || [];
    if (points.length) observedMinutes = Math.max(observedMinutes, Math.max(0, Math.round((now - points[0].ts) / 60000)));
    const baseline = points.filter((point) => point.ts <= cutoff).at(-1);
    if (!baseline) {
      missingBaselineCount += 1;
      continue;
    }
    baselineCount += 1;
    const elapsedMinutes = Math.max(0, Math.round((now - baseline.ts) / 60000));
    observedMinutes = Math.max(observedMinutes, elapsedMinutes);
    const changePct = ((currentOi - baseline.oi) / baseline.oi) * 100;
    if (changePct <= 0) continue;
    leaders.push({
      symbol,
      currentOi,
      baselineOi: baseline.oi,
      changePct: Math.round(changePct * 100) / 100,
      observedMinutes: elapsedMinutes,
      lastPrice: number(row.lastPr),
      volumeUsd: number(row.usdtVolume),
    });
  }

  leaders.sort((a, b) => b.changePct - a.changePct);
  const ready = observedMinutes >= requestedMinutes;
  return {
    direction: "up",
    requestedWindowMinutes: requestedMinutes,
    observedMinutes,
    ready,
    asOf: new Date(now).toISOString(),
    leaders: ready ? leaders.slice(0, Math.max(1, Math.min(Number(limit) || 10, 50))) : [],
    coverage: {
      scannedCount: currentRows.length,
      baselineCount,
      missingBaselineCount,
      positiveCount: leaders.length,
      observedMinutes,
    },
  };
}
