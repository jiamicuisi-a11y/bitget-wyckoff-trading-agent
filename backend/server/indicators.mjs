// 技术指标 + 双均线信号（纯函数，回测与实盘共用，零依赖）。
//
// 双均线（Dual Moving Average）：快线上穿慢线=金叉(做多)，快线下穿慢线=死叉(做空)。
// 这里产出「每根 K 线收盘后的信号」，由回测引擎或实盘引擎消费。

/** 简单移动均线。返回与输入等长数组，前 period-1 个为 null。 */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动均线。返回与输入等长数组，前 period-1 个为 null。 */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (prev === null) {
      // 第一个 EMA 用前 period 个的 SMA 作种子
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/**
 * 双均线信号序列。
 * @param closes 收盘价数组（按时间升序）
 * @param fast   快线周期
 * @param slow   慢线周期
 * @param maType "sma" | "ema"
 * @returns 与 closes 等长的信号数组：'golden'(金叉) | 'death'(死叉) | null
 *          金叉：上一根 fast<=slow 且当根 fast>slow；死叉反之。
 */
export function dualMaSignals(closes, fast = 10, slow = 30, maType = "ema") {
  const f = maType === "sma" ? sma(closes, fast) : ema(closes, fast);
  const s = maType === "sma" ? sma(closes, slow) : ema(closes, slow);
  const out = new Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) {
    const pf = f[i - 1], ps = s[i - 1], cf = f[i], cs = s[i];
    if (pf == null || ps == null || cf == null || cs == null) continue;
    if (pf <= ps && cf > cs) out[i] = "golden";
    else if (pf >= ps && cf < cs) out[i] = "death";
  }
  return out;
}

/** 当前是否多头排列（fast>slow），用于实盘判断「现在能不能进多」。 */
export function maState(closes, fast = 10, slow = 30, maType = "ema") {
  const f = maType === "sma" ? sma(closes, fast) : ema(closes, fast);
  const s = maType === "sma" ? sma(closes, slow) : ema(closes, slow);
  const i = closes.length - 1;
  if (f[i] == null || s[i] == null) return null;
  return { fast: f[i], slow: s[i], bull: f[i] > s[i] };
}

/** 取最近一根已收盘 K 线上的信号（倒数第 2 根，避免用未收盘的当根）。 */
export function latestClosedSignal(closes, fast = 10, slow = 30, maType = "ema") {
  const sig = dualMaSignals(closes, fast, slow, maType);
  // 最后一根可能未收盘，用倒数第二根作为「刚收盘确认」的信号
  const idx = closes.length - 2;
  return idx >= 0 ? sig[idx] : null;
}
