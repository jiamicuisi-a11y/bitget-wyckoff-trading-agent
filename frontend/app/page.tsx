"use client";

import { useState } from "react";
import WyckoffChart from "./WyckoffChart";
import PaperDashboard from "./PaperDashboard";
import OptionsArbDashboard from "./OptionsArbDashboard";
import type {
  AnalyzeResponse,
  PhaseSegment,
  StructurePoint,
  TradeSignal,
  ClosedTrade,
  MatrixRow,
  SentimentSnapshot,
  SentimentSignalRead,
} from "../lib/types";

type FullResponse = AnalyzeResponse & { currentPhase: string };

const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
];
const GRANS = [
  { v: "1day", label: "日线 1D" },
  { v: "4h", label: "4小时" },
  { v: "1h", label: "1小时" },
  { v: "1week", label: "周线 1W" },
];

const STRATEGIES = [
  {
    v: "wyckoff",
    name: "威科夫",
    title: "威科夫交易 Agent",
    tagline:
      "基于威科夫方法的确定性规则引擎：识别市场阶段与关键结构，自动生成信号并回测验证。",
    btn: "运行威科夫分析",
  },
  {
    v: "anomaly",
    name: "A档异动盘",
    title: "A档 · 异动模拟盘",
    tagline:
      "后台 24 小时自动扫描 Bitget 全市场永续合约，异动达标自动模拟开仓（1 万 U 初始资金），实时盯仓止盈止损，沉淀日均利润与胜率。纯模拟，不碰真钱。",
    btn: "刷新看板",
  },
  {
    v: "dualma",
    name: "双均线交易系统",
    title: "B档 · 双均线交易系统",
    tagline:
      "后台用雷达持续扫描 OKX 全市场永续，EMA 快慢线金叉自动做多、死叉自动做空，自动止盈止损。同时跑 1 小时与 4 小时两档，各自独立 1 万 U，点卡切换横向对比哪个周期利润更大。纯模拟，不碰真钱。",
    btn: "刷新看板",
  },
  {
    v: "options-arb",
    name: "期权套利雷达",
    title: "C档 · 期权无风险套利雷达",
    tagline:
      "实时扫描 Deribit 期权链，检测 Put-Call Parity 与 Box Spread 定价偏差，按可成交 bid/ask 与手续费估算净 edge。只做机会雷达，不自动下单。",
    btn: "刷新雷达",
  },
];

// 走 PaperDashboard 看板（雷达模拟盘）的策略；其余走威科夫分析视图
const PAPER_STRATEGIES = new Set(["anomaly", "dualma", "options-arb"]);

const PHASE_CN: Record<string, string> = {
  Accumulation: "吸筹 Accumulation",
  Markup: "拉升 Markup",
  Distribution: "派发 Distribution",
  Markdown: "下跌 Markdown",
  Undefined: "观望 Undefined",
};

const PHASE_CLASS: Record<string, string> = {
  Accumulation: "badge-accum",
  Markup: "badge-markup",
  Distribution: "badge-dist",
  Markdown: "badge-markdown",
  Undefined: "badge-undef",
};

function fmt(n: number, d = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

export default function Home() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [granularity, setGranularity] = useState("1day");
  const [strategy, setStrategy] = useState("wyckoff");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FullResponse | null>(null);
  const [matrix, setMatrix] = useState<MatrixRow[] | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  async function loadMatrix() {
    setMatrixLoading(true);
    setMatrixError(null);
    try {
      const res = await fetch(`/quant/api/matrix?strategy=${strategy}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `请求失败 (${res.status})`);
      }
      setMatrix(json.rows as MatrixRow[]);
    } catch (e: any) {
      setMatrixError(e?.message || "网络错误");
      setMatrix(null);
    } finally {
      setMatrixLoading(false);
    }
  }

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/quant/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, granularity, strategy, limit: 300 }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `请求失败 (${res.status})`);
      }
      setData(json as FullResponse);
    } catch (e: any) {
      setError(e?.message || "网络错误");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const curStrat = STRATEGIES.find((s) => s.v === strategy) || STRATEGIES[0];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <div className="brand-name">Trading Agent</div>
            <div className="brand-sub">多策略交易智能体</div>
          </div>
        </div>

        <div className="control-group">
          <label className="control-label">策略</label>
          <div className="seg seg-col">
            {STRATEGIES.map((s) => (
              <button
                key={s.v}
                className={`seg-item ${strategy === s.v ? "active" : ""}`}
                onClick={() => {
                  setStrategy(s.v);
                  setData(null);
                  setMatrix(null);
                  setError(null);
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {!PAPER_STRATEGIES.has(strategy) && (
          <>
            <div className="control-group">
              <label className="control-label">交易对</label>
              <div className="seg">
                {SYMBOLS.map((s) => (
                  <button
                    key={s}
                    className={`seg-item ${symbol === s ? "active" : ""}`}
                    onClick={() => setSymbol(s)}
                  >
                    {s.replace("USDT", "")}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <label className="control-label">周期</label>
              <div className="seg seg-col">
                {GRANS.map((g) => (
                  <button
                    key={g.v}
                    className={`seg-item ${granularity === g.v ? "active" : ""}`}
                    onClick={() => setGranularity(g.v)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn-primary" onClick={analyze} disabled={loading}>
              {loading ? "分析中…" : curStrat.btn}
            </button>
          </>
        )}

        <div className="sidebar-foot">
          <p>感知 → 决策 → 执行 → 风控 全闭环</p>
          <p className="muted">数据源：Bitget 公开现货行情</p>
        </div>
      </aside>

      <main className="main">
        <section className="hero">
          <div className="hero-head">
            <div>
              <h1 className="hero-title">{curStrat.title}</h1>
              <p className="hero-tagline">{curStrat.tagline}</p>
            </div>
            {!PAPER_STRATEGIES.has(strategy) && data && (
              <div className={`phase-badge ${PHASE_CLASS[data.currentPhase] || "badge-undef"}`}>
                <span className="phase-badge-label">当前阶段</span>
                <span className="phase-badge-value">
                  {PHASE_CN[data.currentPhase] || data.currentPhase}
                </span>
              </div>
            )}
          </div>
        </section>

        {strategy === "anomaly" && (
          <PaperDashboard allowedStrategies={["anomaly", "anomaly-okx", "anomaly-trend"]} switcherTitle="A档策略中心 · 固定2R vs 趋势追踪" />
        )}
        {strategy === "dualma" && (
          <PaperDashboard allowedStrategies={["dualma1h", "dualma4h"]} switcherTitle="双均线 · 1H vs 4H" />
        )}
        {strategy === "options-arb" && (
          <>
            <section className="card">
              <div className="card-head">
                <h2>套利逻辑说明</h2>
                <span className="muted">先看懂逻辑，再看模拟收益</span>
              </div>
              <div className="grid-2">
                <div>
                  <p style={{ marginTop: 0 }}>
                    这页做的是 <b>期权套利模拟盘</b>。它扫描 Deribit 期权链里的 <b>Box Spread（盒式套利）</b> 和
                    <b> Put-Call Parity 偏差</b>，如果市场报价偏离理论价，并且扣掉手续费后还有净 edge，就自动记一笔模拟套利成交。
                  </p>
                  <p>
                    <b>Box Spread</b> 的本质是四条腿锁定到期收益：买低执行价 Call、卖高执行价 Call、买高执行价 Put、卖低执行价 Put。
                    到期后不管 BTC/ETH 涨跌，理论上都收回两个行权价的差额，所以它更像一张“合成债券”。
                  </p>
                </div>
                <div>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                    <li>市场报价偏离理论折现值 → 可能有套利空间。</li>
                    <li>买腿按 ask、卖腿按 bid 估算，先扣手续费，再看净 edge。</li>
                    <li>净 edge 大于阈值时，系统自动记一笔“Box套利完成单”。</li>
                    <li>收益不是赌方向，而是吃四腿组合报价偏差；最近平仓就是已入账的模拟收益。</li>
                  </ul>
                </div>
              </div>
            </section>
            <PaperDashboard allowedStrategies={["options-arb"]} />
            <OptionsArbDashboard />
          </>
        )}

        {!PAPER_STRATEGIES.has(strategy) && error && <div className="alert-error">⚠ {error}</div>}

        {!PAPER_STRATEGIES.has(strategy) && !data && !loading && !error && (
          <div className="empty-state">
            <p>选择交易对与周期，点击「运行威科夫分析」开始。</p>
          </div>
        )}

        {!PAPER_STRATEGIES.has(strategy) && loading && (
          <div className="empty-state">
            <div className="spinner" />
            <p>正在拉取行情并运行{curStrat.name}识别与回测…</p>
          </div>
        )}

        {!PAPER_STRATEGIES.has(strategy) && data && (
          <>
            <section className="card">
              <div className="card-head">
                <h2>{strategy === "anomaly" ? "K线 · 异动信号（威科夫阶段背景）" : "K线 · 威科夫阶段与结构"}</h2>
                <span className="muted">
                  {data.symbol} · {data.granularity} · {data.candles.length} 根
                </span>
              </div>
              <WyckoffChart
                candles={data.candles}
                phases={data.phases}
                structurePoints={data.structurePoints}
              />
              {strategy === "anomaly" ? (
                <div className="legend">
                  <span>背景色块为威科夫阶段，A档信号基于多因子异动打分触发（见下方信号卡）。</span>
                </div>
              ) : (
                <div className="legend">
                  <span><i className="dot dot-spring" />Spring 弹簧</span>
                  <span><i className="dot dot-sos" />SOS 强势</span>
                  <span><i className="dot dot-lps" />LPS 支撑</span>
                  <span><i className="dot dot-utad" />UTAD 诱多</span>
                  <span><i className="dot dot-sow" />SOW 弱势</span>
                </div>
              )}
            </section>

            <SentimentCard
              sentiment={data.sentiment}
              read={data.sentimentRead}
              currentPhase={PHASE_CN[data.currentPhase] || data.currentPhase}
              symbol={data.symbol}
            />

            <div className="grid-2">
              <section className="card">
                <div className="card-head">
                  <h2>交易信号</h2>
                  <span className="muted">{data.signals.length} 个</span>
                </div>
                {data.signals.length === 0 ? (
                  <p className="muted">当前数据未触发交易信号。</p>
                ) : (
                  <div className="signal-list">
                    {data.signals.slice(-8).reverse().map((s: TradeSignal, i) => (
                      <div key={i} className="signal-card">
                        <div className="signal-top">
                          <span className={`tag ${s.direction === "long" ? "tag-long" : "tag-short"}`}>
                            {s.direction === "long" ? "做多 LONG" : "做空 SHORT"}
                          </span>
                          <span className="signal-src">{strategy === "anomaly" ? "异动" : s.sourceStructure}</span>
                          <span className="signal-date">{fmtDate(s.time)}</span>
                        </div>
                        <div className="signal-grid">
                          <div><label>入场</label><b>{fmt(s.entry)}</b></div>
                          <div><label>止损</label><b className="neg">{fmt(s.stop)}</b></div>
                          <div><label>目标</label><b className="pos">{fmt(s.target)}</b></div>
                          <div><label>仓位</label><b>{fmt(s.positionPct * 100, 1)}%</b></div>
                          <div><label>R:R</label><b>{fmt(s.riskReward, 2)}</b></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>回测结果</h2>
                  <span className="muted">vs Buy & Hold</span>
                </div>
                <div className="metric-grid">
                  <Metric label="策略总收益" value={`${fmt(data.backtest.totalReturnPct)}%`} positive={data.backtest.totalReturnPct >= 0} big />
                  <Metric label="Buy&Hold" value={`${fmt(data.backtest.buyHoldReturnPct)}%`} positive={data.backtest.buyHoldReturnPct >= 0} big />
                  <Metric label="胜率" value={`${fmt(data.backtest.winRate, 1)}%`} />
                  <Metric label="盈亏比" value={fmt(data.backtest.profitFactor, 2)} />
                  <Metric label="最大回撤" value={`${fmt(data.backtest.maxDrawdownPct)}%`} negative />
                  <Metric label="夏普" value={fmt(data.backtest.sharpe, 2)} />
                  <Metric label="交易次数" value={String(data.backtest.tradeCount)} />
                  <Metric label="盈/亏单" value={`${data.backtest.wins}/${data.backtest.losses}`} />
                </div>
                <EquityChart curve={data.backtest.equityCurve} />
              </section>
            </div>

            {data.backtest.trades.length > 0 && (
              <section className="card">
                <div className="card-head">
                  <h2>交易明细</h2>
                  <span className="muted">{data.backtest.trades.length} 笔</span>
                </div>
                <div className="table-wrap">
                  <table className="trades">
                    <thead>
                      <tr>
                        <th>方向</th><th>入场日期</th><th>入场价</th>
                        <th>出场日期</th><th>出场价</th><th>出场原因</th><th>结果</th>
                        <th>收益%</th><th>R</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.backtest.trades.map((t: ClosedTrade, i) => (
                        <tr key={i}>
                          <td><span className={`tag-mini ${t.direction === "long" ? "tag-long" : "tag-short"}`}>{t.direction === "long" ? "多" : "空"}</span></td>
                          <td>{fmtDate(t.entryTime)}</td>
                          <td>{fmt(t.entryPrice)}</td>
                          <td>{fmtDate(t.exitTime)}</td>
                          <td>{fmt(t.exitPrice)}</td>
                          <td>{t.exitReason}</td>
                          <td className={t.outcome === "win" ? "pos" : "neg"}>{t.outcome === "win" ? "盈利" : "亏损"}</td>
                          <td className={t.pnlPct >= 0 ? "pos" : "neg"}>{fmt(t.pnlPct)}</td>
                          <td className={t.rMultiple >= 0 ? "pos" : "neg"}>{fmt(t.rMultiple, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="card">
              <div className="card-head">
                <h2>多市场回测矩阵</h2>
                <span className="muted">10 大主流币 × 日线 · 证明非单币过拟合</span>
              </div>
              <p className="muted" style={{ marginTop: 0 }}>
                同一套{curStrat.name}规则跨 10 个主流币种（日线）串行运行，已计入手续费 0.06% + 滑点 0.02%（单边约
                0.08%），入场价采用信号确认后下一根开盘价（无前视偏差）。矩阵默认只跑日线一档以控制耗时与限流。
              </p>
              <button
                className="btn-primary"
                onClick={loadMatrix}
                disabled={matrixLoading}
                style={{ maxWidth: 240 }}
              >
                {matrixLoading ? "回测中（串行拉取6组）…" : "运行多市场回测矩阵"}
              </button>
              {matrixError && <div className="alert-error">⚠ {matrixError}</div>}
              {matrix && matrix.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 16 }}>
                  <table className="trades">
                    <thead>
                      <tr>
                        <th>币种</th><th>周期</th><th>策略收益%</th>
                        <th>Buy&Hold%</th><th>胜率%</th><th>盈亏比</th>
                        <th>最大回撤%</th><th>夏普</th><th>交易数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.map((r: MatrixRow, i) => (
                        <tr key={i}>
                          <td><b>{r.symbol.replace("USDT", "")}</b></td>
                          <td>{r.granularity}</td>
                          {r.error ? (
                            <td colSpan={7} className="neg">{r.error}</td>
                          ) : (
                            <>
                              <td className={r.totalReturnPct >= 0 ? "pos" : "neg"}>{fmt(r.totalReturnPct)}</td>
                              <td className={r.buyHoldReturnPct >= 0 ? "pos" : "neg"}>{fmt(r.buyHoldReturnPct)}</td>
                              <td>{fmt(r.winRate, 1)}</td>
                              <td>{fmt(r.profitFactor, 2)}</td>
                              <td className="neg">{fmt(r.maxDrawdownPct)}</td>
                              <td>{fmt(r.sharpe, 2)}</td>
                              <td>{r.tradeCount}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="disclaimer">
              ⚠ 本工具仅用于研究与教育目的，所有信号与回测均为历史模拟，不构成任何投资建议。加密资产风险极高，请勿据此进行真实交易。
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SentimentCard({
  sentiment,
  read,
  currentPhase,
  symbol,
}: {
  sentiment: SentimentSnapshot | null;
  read: SentimentSignalRead | null;
  currentPhase: string;
  symbol: string;
}) {
  const toneClass: Record<string, string> = {
    bullish: "senti-bullish",
    bearish: "senti-bearish",
    neutral: "senti-neutral",
  };
  const toneLabel: Record<string, string> = {
    bullish: "偏多 Bullish",
    bearish: "偏空 Bearish",
    neutral: "中性 Neutral",
  };
  const alignClass: Record<string, string> = {
    resonance: "tag-long",
    divergence: "tag-short",
    neutral: "tag-neutral",
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Bitget 合约情绪</h2>
        <span className="muted">
          {sentiment
            ? `${symbol} 永续 · usdt-futures 实时快照`
            : "合约接口暂不可用"}
        </span>
      </div>

      {!sentiment ? (
        <p className="muted">
          Bitget 合约公开接口本次未返回数据（已做容错，不影响上方威科夫分析）。
        </p>
      ) : (
        <>
          <div className="senti-grid">
            <div className="senti-cell">
              <span className="senti-label">资金费率 Funding</span>
              <span
                className={`senti-value ${
                  sentiment.fundingRate > 0
                    ? "neg"
                    : sentiment.fundingRate < 0
                    ? "pos"
                    : ""
                }`}
              >
                {(sentiment.fundingRate * 100).toFixed(4)}%
              </span>
              <span className="senti-note">
                {sentiment.fundingRate > 0
                  ? "正值：多头付费，情绪偏热"
                  : sentiment.fundingRate < 0
                  ? "负值：空头付费，多头偏弱/超卖"
                  : "接近中性"}
                {sentiment.fundingRateInterval
                  ? ` · 每 ${sentiment.fundingRateInterval}h 结算`
                  : ""}
              </span>
            </div>

            <div className="senti-cell">
              <span className="senti-label">持仓量 OI</span>
              <span className="senti-value">
                {sentiment.openInterest.toLocaleString("en-US", {
                  maximumFractionDigits: 0,
                })}
              </span>
              <span className="senti-note">未平仓合约总量（张/币）</span>
            </div>

            <div className="senti-cell">
              <span className="senti-label">账户多空比 L/S</span>
              <span className="senti-value">
                {sentiment.longShortRatio.toFixed(3)}
              </span>
              <span className="senti-note">
                多 {(sentiment.longAccountRatio * 100).toFixed(1)}% / 空{" "}
                {(sentiment.shortAccountRatio * 100).toFixed(1)}%
              </span>
            </div>

            <div className="senti-cell">
              <span className="senti-label">情绪基调 Tone</span>
              <span
                className={`senti-badge ${toneClass[sentiment.tone] || "senti-neutral"}`}
              >
                {toneLabel[sentiment.tone] || sentiment.tone}
              </span>
            </div>
          </div>

          <div className="senti-bar-wrap">
            <div className="senti-bar">
              <div
                className="senti-bar-long"
                style={{ width: `${sentiment.longAccountRatio * 100}%` }}
              >
                多 {(sentiment.longAccountRatio * 100).toFixed(1)}%
              </div>
              <div
                className="senti-bar-short"
                style={{ width: `${sentiment.shortAccountRatio * 100}%` }}
              >
                空 {(sentiment.shortAccountRatio * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="senti-read">
            <p className="senti-read-line">
              <b>对当前「{currentPhase}」阶段的解读：</b>
              {sentiment.reading}
            </p>
            {read && (
              <div className="senti-signal">
                <span className={`tag ${alignClass[read.alignment] || "tag-neutral"}`}>
                  {read.label}
                </span>
                <span className="senti-signal-detail">{read.detail}</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  positive,
  negative,
  big,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
  big?: boolean;
}) {
  const cls = positive ? "pos" : negative ? "neg" : "";
  return (
    <div className={`metric ${big ? "metric-big" : ""}`}>
      <span className="metric-label">{label}</span>
      <span className={`metric-value ${cls}`}>{value}</span>
    </div>
  );
}

function EquityChart({ curve }: { curve: { time: number; equity: number; benchmark: number }[] }) {
  if (!curve.length) return null;
  const W = 520;
  const H = 120;
  const pad = 4;
  const eqs = curve.map((p) => p.equity);
  const bms = curve.map((p) => p.benchmark);
  const min = Math.min(...eqs, ...bms);
  const max = Math.max(...eqs, ...bms);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (curve.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - 2 * pad);
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <div className="equity">
      <div className="equity-head">
        <span><i className="dot dot-eq" />策略权益</span>
        <span><i className="dot dot-bm" />Buy & Hold</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="equity-svg" preserveAspectRatio="none">
        <path d={path(bms)} className="line-bm" fill="none" />
        <path d={path(eqs)} className="line-eq" fill="none" />
      </svg>
    </div>
  );
}
