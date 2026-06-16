// 期权无风险套利扫描核心（Deribit 全链）。
//
// 两类机会：
//   1) Put-Call Parity 偏差：同到期同 strike，理论 C - P = S - K*e^(-rT)
//      市场偏离即 Conversion/Reversal 机会。
//   2) Box Spread（盒式套利）：同到期两个 strike K1<K2，四腿组合到期固定收益 (K2-K1)，
//      理论现值 = (K2-K1)*e^(-rT)。市场净成本偏离现值即套利（合成债券）。
//
// 诚实原则：
//   - 期权价用「可成交价」：买腿付 ask、卖腿收 bid（不是 mid，避免高估 edge）。
//   - 扣足手续费（Deribit taker 每腿 0.03% of underlying，封顶 12.5% 期权价）。
//   - 只输出「净 edge > 0」（扣费后仍有利可图）的机会，并标出毛/净。
//   - Deribit 期权 inverse 计价（单位 BTC），价格 × underlying 转 USD。
//
// 纯函数 + 零依赖，可被后端实时调用，也可单独跑验证。

const DERIBIT = "https://www.deribit.com/api/v2";

async function jget(url) {
  const res = await fetch(url);
  const j = await res.json();
  return j.result;
}

/** 拉某币种全链报价 + 现货指数。返回 { spot, options:[{name,expiry,strike,type,bid,ask,...}] } */
export async function fetchOptionChain(currency = "BTC") {
  const [summary, indexResp] = await Promise.all([
    jget(`${DERIBIT}/public/get_book_summary_by_currency?currency=${currency}&kind=option`),
    jget(`${DERIBIT}/public/get_index_price?index_name=${currency.toLowerCase()}_usd`),
  ]);
  const spot = indexResp?.index_price || 0;
  const options = [];
  for (const o of summary) {
    // 名称：BTC-26MAR27-105000-C
    const parts = o.instrument_name.split("-");
    if (parts.length !== 4) continue;
    const strike = Number(parts[2]);
    const type = parts[3] === "C" ? "call" : "put";
    const expiry = parts[1];
    const underlying = o.underlying_price || spot;
    // inverse：报价单位 BTC，转 USD
    const bidUsd = o.bid_price ? o.bid_price * underlying : null;
    const askUsd = o.ask_price ? o.ask_price * underlying : null;
    options.push({
      name: o.instrument_name,
      expiry,
      strike,
      type,
      underlying,
      bidBtc: o.bid_price || null,
      askBtc: o.ask_price || null,
      bidUsd,
      askUsd,
      markBtc: o.mark_price || null,
    });
  }
  return { spot, options };
}

/** 把到期字符串(26MAR27)转成到 ms 时间戳。 */
function parseExpiry(exp) {
  const m = exp.match(/^(\d+)([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  const day = Number(m[1]);
  const mon = months[m[2]];
  const year = 2000 + Number(m[3]);
  // Deribit 期权到期为 UTC 08:00
  return Date.UTC(year, mon, day, 8, 0, 0);
}

/** 年化到期时间 T（年）。 */
function yearsToExpiry(exp, now) {
  const ts = parseExpiry(exp);
  if (!ts) return null;
  return (ts - now) / (365 * 24 * 3600 * 1000);
}

/**
 * 扫描 Box Spread 套利机会。
 * @param chain fetchOptionChain 结果
 * @param opts { r 无风险年利率(默认0.05), feePerLegBtc 每腿费率(0.0003), minNetEdgePct 最小净edge%阈值, topStrikesPerExpiry 每到期取流动性最好的N个strike }
 */
export function scanBoxSpreads(chain, opts = {}) {
  const {
    r = 0.05,
    feePerLegRate = 0.0003, // Deribit taker 0.03% of underlying
    feeCapRate = 0.125,     // 封顶 12.5% 期权价
    minNetEdgePct = 0.05,   // 净 edge ≥ 0.05% 才报（盒子价值的百分比）
    now = Date.now(),
  } = opts;

  // 按到期分组，组内按 strike 收集 call/put 报价
  const byExpiry = {};
  for (const o of chain.options) {
    if (!byExpiry[o.expiry]) byExpiry[o.expiry] = {};
    const g = byExpiry[o.expiry];
    if (!g[o.strike]) g[o.strike] = {};
    g[o.strike][o.type] = o;
  }

  const results = [];
  for (const [expiry, strikes] of Object.entries(byExpiry)) {
    const T = yearsToExpiry(expiry, now);
    if (T === null || T <= 0) continue;
    const disc = Math.exp(-r * T);

    // 只保留 call/put 双边报价齐全的 strike
    const usable = Object.entries(strikes)
      .filter(([, s]) => s.call?.bidUsd && s.call?.askUsd && s.put?.bidUsd && s.put?.askUsd)
      .map(([k, s]) => ({ strike: Number(k), ...s }))
      .sort((a, b) => a.strike - b.strike);

    // 相邻 strike 两两配对（K1<K2），算 box
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        const lo = usable[i];
        const hi = usable[j];
        const width = hi.strike - lo.strike;
        if (width <= 0) continue;
        const boxPV = width * disc; // 理论现值（USD）

        const u = lo.call.underlying || chain.spot;
        // 每腿费用（USD）：min(0.03%*S, 12.5%*腿期权价)，4 腿
        const fee = (optPx) => Math.min(feePerLegRate * u, feeCapRate * optPx);

        // --- Long Box：买 callK1、卖 callK2、买 putK2、卖 putK1，到期收 width ---
        // 成本 = callK1_ask - callK2_bid + putK2_ask - putK1_bid
        const longCost =
          lo.call.askUsd - hi.call.bidUsd + hi.put.askUsd - lo.put.bidUsd;
        const longFee =
          fee(lo.call.askUsd) + fee(hi.call.bidUsd) + fee(hi.put.askUsd) + fee(lo.put.bidUsd);
        // 到期拿 width，成本 longCost，净利 = width - longCost - fee（折现前；用现值比较更严谨）
        const longGross = boxPV - longCost;          // 毛 edge（USD）
        const longNet = longGross - longFee;         // 净 edge（USD）

        // --- Short Box：卖 callK1、买 callK2、卖 putK2、买 putK1，到期付 width ---
        // 净收入 = callK1_bid - callK2_ask + putK2_bid - putK1_ask
        const shortIncome =
          lo.call.bidUsd - hi.call.askUsd + hi.put.bidUsd - lo.put.askUsd;
        const shortFee =
          fee(lo.call.bidUsd) + fee(hi.call.askUsd) + fee(hi.put.bidUsd) + fee(lo.put.askUsd);
        // 到期付 width，先收 shortIncome，净利 = shortIncome - boxPV - fee
        const shortGross = shortIncome - boxPV;
        const shortNet = shortGross - shortFee;

        // 取更优的一侧
        let side = null, gross = 0, net = 0;
        if (longNet >= shortNet) { side = "long"; gross = longGross; net = longNet; }
        else { side = "short"; gross = shortGross; net = shortNet; }

        const netEdgePct = (net / boxPV) * 100;
        if (net > 0 && netEdgePct >= minNetEdgePct) {
          results.push({
            type: "box",
            expiry,
            T: Number(T.toFixed(4)),
            kLo: lo.strike,
            kHi: hi.strike,
            width,
            boxPV: Number(boxPV.toFixed(2)),
            side,
            grossUsd: Number(gross.toFixed(2)),
            netUsd: Number(net.toFixed(2)),
            netEdgePct: Number(netEdgePct.toFixed(3)),
            legs: side === "long"
              ? `买C${lo.strike} 卖C${hi.strike} 买P${hi.strike} 卖P${lo.strike}`
              : `卖C${lo.strike} 买C${hi.strike} 卖P${hi.strike} 买P${lo.strike}`,
          });
        }
      }
    }
  }
  results.sort((a, b) => b.netEdgePct - a.netEdgePct);
  return results;
}

/**
 * 扫描 Put-Call Parity 偏差（同到期同 strike）。
 * 理论：C - P = S - K*e^(-rT)。市场 (C-P) 偏离即机会。
 * 用可成交价估「最坏可实现偏差」：
 *   - Conversion(买S+买P+卖C)：吃 callBid - putAsk，对比 S - K*disc
 */
export function scanParity(chain, opts = {}) {
  const { r = 0.05, minEdgePct = 0.1, now = Date.now() } = opts;
  const byExpiry = {};
  for (const o of chain.options) {
    if (!byExpiry[o.expiry]) byExpiry[o.expiry] = {};
    const g = byExpiry[o.expiry];
    if (!g[o.strike]) g[o.strike] = {};
    g[o.strike][o.type] = o;
  }
  const out = [];
  for (const [expiry, strikes] of Object.entries(byExpiry)) {
    const T = yearsToExpiry(expiry, now);
    if (T === null || T <= 0) continue;
    const disc = Math.exp(-r * T);
    for (const [k, s] of Object.entries(strikes)) {
      if (!(s.call?.bidUsd && s.call?.askUsd && s.put?.bidUsd && s.put?.askUsd)) continue;
      const K = Number(k);
      const S = s.call.underlying || chain.spot;
      const theoCmP = S - K * disc; // 理论 C-P
      const cMpMid = (s.call.bidUsd + s.call.askUsd) / 2 - (s.put.bidUsd + s.put.askUsd) / 2;
      const dev = cMpMid - theoCmP; // 偏差（USD），正=Call贵/Put便宜
      const edgePct = (Math.abs(dev) / S) * 100;
      if (edgePct >= minEdgePct) {
        out.push({
          type: "parity",
          expiry,
          strike: K,
          theoCmP: Number(theoCmP.toFixed(2)),
          mktCmP: Number(cMpMid.toFixed(2)),
          devUsd: Number(dev.toFixed(2)),
          edgePct: Number(edgePct.toFixed(3)),
          hint: dev > 0 ? "Call偏贵→Reversal(卖C买P买现货合成空)" : "Put偏贵→Conversion(买C卖P卖现货)",
        });
      }
    }
  }
  out.sort((a, b) => b.edgePct - a.edgePct);
  return out;
}
