"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TradeChart, { type KCandle, type TradeOverlay } from "./TradeChart";

/** 与 worker 接口对齐的类型。 */
interface Stats {
  initialCapital: number;
  equity: number;
  cash: number;
  floating: number;
  realizedPnl: number;
  totalReturnPct: number;
  avgDailyPnl: number;
  avgDailyReturnPct: number;
  runningDays: number;
  tradeCount: number;
  openCount: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdownPct: number;
}
interface Position {
  id: number;
  symbol: string;
  direction: "long" | "short";
  tag: string;
  score: number;
  entry_price: number;
  stop_price: number;
  target_price: number;
  notional: number;
  margin: number;
  leverage: number;
  open_time: number;
  currentPrice: number;
  floatPnlUsd: number;
  floatPnlPct: number;
}
interface ClosedTrade {
  id: number;
  symbol: string;
  direction: "long" | "short";
  tag: string;
  score: number;
  entry_price: number;
  stop_price: number;
  target_price: number;
  exit_price: number;
  open_time: number;
  exit_time: number;
  exit_reason: string;
  pnl_usd: number;
  pnl_pct: number;
}
interface LatestScan {
  hits: Array<{
    symbol: string;
    score: number;
    direction: "long" | "short";
    tag: string;
    lastPrice: number;
    oiChangePct: number | null;
    change24hPct: number;
    fundingRate: number;
  }>;
  scannedCount: number;
  scannedAt: string | null;
  openedCount?: number;
  candidateCount?: number;
}
interface StrategySummary {
  key: string;
  name: string;
  desc: string;
  kind: string;
  paper: {
    minScoreToOpen: number;
    leverage: number;
    stopPct: number;
    targetR: number;
    maxConcurrent: number;
  };
  summary: {
    equity: number;
    totalReturnPct: number;
    avgDailyPnl: number;
    winRate: number;
    tradeCount: number;
    openCount: number;
  };
}
interface StateResp {
  strategy: string;
  stats: Stats;
  positions: Position[];
  recentClosed: ClosedTrade[];
  latestScan: LatestScan;
  config: {
    scanIntervalSec: number;
    paper: {
      minScoreToOpen: number;
      leverage: number;
      stopPct: number;
      targetR: number;
      maxConcurrent: number;
    };
  };
  error?: string;
  workerOffline?: boolean;
}
interface EquityPoint {
  ts: number;
  equity: number;
  cash: number;
  open_count: number;
}



function fmt(n: number, d = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(ms);
  }
}
function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

export default function PaperDashboard({
  allowedStrategies,
  switcherTitle,
}: {
  // 只显示这些策略（按顺序）；不传则显示全部。第一个为默认选中。
  allowedStrategies?: string[];
  switcherTitle?: string;
} = {}) {
  const [strategies, setStrategies] = useState<StrategySummary[]>([]);
  const [active, setActive] = useState<string>(allowedStrategies?.[0] || "anomaly");
  const [state, setState] = useState<StateResp | null>(null);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  // 选中要看 K 线的标的（点持仓/平仓行触发）
  const [chartFor, setChartFor] = useState<{ symbol: string; trade: TradeOverlay } | null>(null);
  const [candles, setCandles] = useState<KCandle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 拉策略列表（只需一次 + 周期刷新摘要）
  const loadStrategies = useCallback(async () => {
    try {
      const res = await fetch("/api/paper?view=strategies", { cache: "no-store" });
      const json = await res.json();
      if (res.ok && Array.isArray(json.strategies)) {
        setStrategies(json.strategies as StrategySummary[]);
        setOffline(false);
      } else if (json.workerOffline) {
        setOffline(true);
        setError(json.error || "模拟盘 worker 未响应");
      }
    } catch (e: any) {
      setOffline(true);
      setError(e?.message || "网络错误");
    }
  }, []);

  // 拉选中策略的状态 + 权益曲线
  const loadState = useCallback(async (strategy: string) => {
    try {
      const [sRes, eRes] = await Promise.all([
        fetch(`/api/paper?view=state&strategy=${strategy}`, { cache: "no-store" }),
        fetch(`/api/paper?view=equity&strategy=${strategy}`, { cache: "no-store" }),
      ]);
      const sJson = await sRes.json();
      if (!sRes.ok || sJson.workerOffline) {
        setOffline(true);
        setError(sJson.error || "模拟盘 worker 未响应");
        setState(null);
      } else {
        setState(sJson as StateResp);
        setOffline(false);
        setError(null);
      }
      const eJson = await eRes.json();
      if (eRes.ok && Array.isArray(eJson.curve)) setEquity(eJson.curve as EquityPoint[]);
    } catch (e: any) {
      setError(e?.message || "网络错误");
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    loadStrategies();
    const id = setInterval(loadStrategies, 30000);
    return () => clearInterval(id);
  }, [loadStrategies]);

  // 受限模式：active 必须落在 allowedStrategies 内，否则回到第一个
  useEffect(() => {
    if (allowedStrategies && allowedStrategies.length > 0 && !allowedStrategies.includes(active)) {
      setActive(allowedStrategies[0]);
    }
  }, [allowedStrategies, active]);

  useEffect(() => {
    loadState(active);
    const id = setInterval(() => loadState(active), 30000);
    return () => clearInterval(id);
  }, [active, loadState]);

  // 拉某标的 K 线
  const openChart = useCallback(
    async (symbol: string, trade: TradeOverlay) => {
      setChartFor({ symbol, trade });
      setChartLoading(true);
      setCandles([]);
      try {
        const res = await fetch(
          `/api/paper?view=klines&strategy=${active}&symbol=${symbol}&granularity=1H&limit=200`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (res.ok && Array.isArray(json.candles)) setCandles(json.candles as KCandle[]);
      } catch {
        /* 忽略，UI 给空态 */
      } finally {
        setChartLoading(false);
      }
    },
    [active]
  );

  // 画权益曲线
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || equity.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = 240;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const eqs = equity.map((p) => p.equity);
    const initial = state?.stats.initialCapital || eqs[0] || 10000;
    const min = Math.min(...eqs, initial);
    const max = Math.max(...eqs, initial);
    const pad = (max - min) * 0.1 || 100;
    const lo = min - pad;
    const hi = max + pad;
    const padL = 8;
    const padR = 8;
    const padT = 12;
    const padB = 12;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const x = (i: number) => padL + (i / Math.max(equity.length - 1, 1)) * plotW;
    const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * plotH;

    ctx.strokeStyle = "rgba(138,147,166,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y(initial));
    ctx.lineTo(w - padR, y(initial));
    ctx.stroke();
    ctx.setLineDash([]);

    const last = eqs[eqs.length - 1];
    const up = last >= initial;
    const line = up ? "#138a5e" : "#c0392b";
    const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
    grad.addColorStop(0, up ? "rgba(19,138,94,0.18)" : "rgba(192,57,43,0.18)");
    grad.addColorStop(1, "rgba(255,255,255,0)");

    ctx.beginPath();
    equity.forEach((p, i) => {
      const px = x(i);
      const py = y(p.equity);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(x(equity.length - 1), h - padB);
    ctx.lineTo(x(0), h - padB);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    equity.forEach((p, i) => {
      const px = x(i);
      const py = y(p.equity);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [equity, state]);

  if (offline) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>量化模拟盘</h2>
        </div>
        <div className="empty-state">
          <p>⚠ {error || "模拟盘 worker 未运行"}</p>
          <p className="muted">
            后台模拟盘 worker（端口 8800）当前无响应。它负责定时扫描全市场并按各策略自动模拟开/平仓。
            请确认 worker 进程在运行。
          </p>
        </div>
      </section>
    );
  }

  // 受限模式下：只保留 allowedStrategies 内的卡，并按其顺序排列
  const switcherList =
    allowedStrategies && allowedStrategies.length > 0
      ? allowedStrategies
          .map((k) => strategies.find((s) => s.key === k))
          .filter((s): s is StrategySummary => Boolean(s))
      : strategies;

  return (
    <>
      {/* 策略切换器：每个策略一张摘要卡，点卡切换并横向对比 */}
      {switcherList.length > 1 && (
        <section className="card">
          <div className="card-head">
            <h2>{switcherTitle || "策略中心"}</h2>
            <span className="muted">点策略卡切换 · 每个策略独立 1 万 U 模拟账户</span>
          </div>
          <div className="strat-switch">
            {switcherList.map((st) => {
              const isActive = st.key === active;
              const up = st.summary.totalReturnPct >= 0;
              return (
                <button
                  key={st.key}
                  className={`strat-card ${isActive ? "active" : ""}`}
                  onClick={() => setActive(st.key)}
                >
                  <div className="strat-card-name">{st.name}</div>
                  <div className="strat-card-row">
                    <span className={`strat-card-ret ${up ? "pos" : "neg"}`}>
                      {up ? "+" : ""}
                      {fmt(st.summary.totalReturnPct)}%
                    </span>
                    <span className="strat-card-sub">
                      胜率 {fmt(st.summary.winRate, 0)}% · 持{st.summary.openCount}
                    </span>
                  </div>
                </button>
              );
            })}
            {strategies.length === 0 && <p className="muted">加载策略中…</p>}
          </div>
        </section>
      )}

      {!state ? (
        <div className="empty-state">
          <div className="spinner" />
          <p>正在读取策略数据…</p>
        </div>
      ) : (
        <StrategyView
          state={state}
          equity={equity}
          canvasRef={canvasRef}
          chartFor={chartFor}
          candles={candles}
          chartLoading={chartLoading}
          onPickSymbol={openChart}
          onCloseChart={() => setChartFor(null)}
        />
      )}
    </>
  );
}

function StrategyView({
  state,
  equity,
  canvasRef,
  chartFor,
  candles,
  chartLoading,
  onPickSymbol,
  onCloseChart,
}: {
  state: StateResp;
  equity: EquityPoint[];
  canvasRef: React.RefObject<HTMLCanvasElement>;
  chartFor: { symbol: string; trade: TradeOverlay } | null;
  candles: KCandle[];
  chartLoading: boolean;
  onPickSymbol: (symbol: string, trade: TradeOverlay) => void;
  onCloseChart: () => void;
}) {
  const s = state.stats;
  const positions = state.positions || [];
  const closed = state.recentClosed || [];
  const scan = state.latestScan;
  const isOptionsArb = state.strategy === "options-arb";
  const tradesPerDay = s.runningDays > 0 ? s.tradeCount / s.runningDays : 0;

  return (
    <>
      {/* 绩效指标 */}
      <section className="card">
        <div className="card-head">
          <h2>绩效 · 初始 ${fmt(s.initialCapital, 0)}</h2>
          <span className="muted">
            自动扫描 {state.config.scanIntervalSec}s/次 · 上次 {fmtClock(scan?.scannedAt)} · 运行 {fmt(s.runningDays, 1)} 天
          </span>
        </div>
        <div className="metric-grid">
          <Metric label="账户权益" value={`$${fmt(s.equity)}`} positive={s.equity >= s.initialCapital} big />
          <Metric label="总收益率" value={`${s.totalReturnPct >= 0 ? "+" : ""}${fmt(s.totalReturnPct)}%`} positive={s.totalReturnPct >= 0} big />
          <Metric label="日均利润" value={`$${fmt(s.avgDailyPnl)}`} positive={s.avgDailyPnl >= 0} big />
          <Metric label="胜率" value={`${fmt(s.winRate, 1)}%`} />
          <Metric label="盈亏比" value={fmt(s.profitFactor, 2)} />
          <Metric label="已实现盈亏" value={`$${fmt(s.realizedPnl)}`} positive={s.realizedPnl >= 0} />
          <Metric label="最大回撤" value={`${fmt(s.maxDrawdownPct)}%`} negative />
          <Metric label="交易/持仓" value={`${s.tradeCount}/${s.openCount}`} />
          <Metric label="日均交易" value={`${fmt(tradesPerDay, 1)} 笔/天`} />
        </div>
      </section>

      {/* 权益曲线 */}
      <section className="card">
        <div className="card-head">
          <h2>权益曲线</h2>
          <span className="muted">
            现金 ${fmt(s.cash)} · 浮动 ${fmt(s.floating)} · 盈/亏 {s.wins}/{s.losses}
          </span>
        </div>
        {equity.length < 2 ? (
          <p className="muted">权益曲线将在模拟盘累积数据后显示（至少 2 个采样点）。</p>
        ) : (
          <canvas ref={canvasRef} style={{ width: "100%", height: 240 }} />
        )}
      </section>

      {/* K线图（点持仓/平仓行后展开） */}
      {chartFor && (
        <section className="card">
          <div className="card-head">
            <h2>K线 · {chartFor.symbol.replace("USDT", "")}（1H · 入场/止损/止盈线）</h2>
            <button className="btn-ghost" onClick={onCloseChart}>收起</button>
          </div>
          {chartLoading ? (
            <div className="empty-state"><div className="spinner" /><p>加载 K 线…</p></div>
          ) : candles.length === 0 ? (
            <p className="muted">未能加载该标的 K 线。</p>
          ) : (
            <TradeChart candles={candles} trade={chartFor.trade} height={360} />
          )}
        </section>
      )}

      <div className="grid-2">
        {/* 当前持仓 */}
        <section className="card">
          <div className="card-head">
            <h2>当前持仓</h2>
            <span className="muted">{positions.length} / {state.config.paper.maxConcurrent} · 点行看K线</span>
          </div>
          {positions.length === 0 ? (
            <p className="muted">暂无持仓，等待异动信号开仓。</p>
          ) : (
            <div className="signal-list">
              {positions.map((p) => (
                <div
                  key={p.id}
                  className="signal-card clickable"
                  onClick={() =>
                    onPickSymbol(p.symbol, {
                      direction: p.direction,
                      entry: p.entry_price,
                      stop: p.stop_price,
                      target: p.target_price,
                      openTime: Math.floor(p.open_time / 1000),
                    })
                  }
                >
                  <div className="signal-top">
                    <span className={`tag ${p.direction === "long" ? "tag-long" : "tag-short"}`}>
                      {p.direction === "long" ? "做多" : "做空"}
                    </span>
                    <span className="signal-src">{p.symbol.replace("USDT", "")}</span>
                    <span className="signal-src" style={{ color: "var(--ink-faint)" }}>{p.tag}</span>
                    <span className={`signal-date ${p.floatPnlUsd >= 0 ? "pos" : "neg"}`}>
                      {p.floatPnlUsd >= 0 ? "+" : ""}{fmt(p.floatPnlUsd)} ({fmt(p.floatPnlPct, 1)}%)
                    </span>
                  </div>
                  <div className="signal-grid">
                    <div><label>入场</label><b>{fmtPrice(p.entry_price)}</b></div>
                    <div><label>现价</label><b>{fmtPrice(p.currentPrice)}</b></div>
                    <div><label>止损</label><b className="neg">{fmtPrice(p.stop_price)}</b></div>
                    <div><label>止盈</label><b className="pos">{fmtPrice(p.target_price)}</b></div>
                    <div><label>分</label><b>{p.score}</b></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 实时异动榜 */}
        <section className="card">
          <div className="card-head">
            <h2>{isOptionsArb ? "最新套利机会" : "实时异动榜"}</h2>
            <span className="muted">{isOptionsArb ? `本轮命中 ${scan?.candidateCount || 0} 个 Box 机会` : `全市场 ${scan?.scannedCount || 0} 合约`}</span>
          </div>
          {!scan?.hits || scan.hits.length === 0 ? (
            <p className="muted">当前无满足条件的异动标的。</p>
          ) : (
            <div className="signal-list">
              {scan.hits.map((h) => (
                <div key={h.symbol} className="signal-card">
                  <div className="signal-top">
                    <span className={`tag ${h.direction === "long" ? "tag-long" : "tag-short"}`}>
                      {h.direction === "long" ? "多" : "空"}
                    </span>
                    <span className="signal-src">{h.symbol.replace("USDT", "")}</span>
                    <span className="signal-src" style={{ color: "var(--ink-faint)" }}>{isOptionsArb ? "套利完成单" : h.tag}</span>
                    <span className="signal-date">分 {h.score}</span>
                  </div>
                  <div className="signal-grid">
                    <div><label>{isOptionsArb ? "模拟价格" : "现价"}</label><b>{fmtPrice(h.lastPrice)}</b></div>
                    <div><label>{isOptionsArb ? "净Edge" : "OI异动"}</label><b className="pos">{isOptionsArb ? `${fmt((h as any).netEdgePct || h.score / 100, 3)}%` : h.oiChangePct === null || h.oiChangePct === undefined ? "—" : `${h.oiChangePct >= 0 ? "+" : ""}${h.oiChangePct}%`}</b></div>
                    <div><label>{isOptionsArb ? "类型" : "24h"}</label><b>{isOptionsArb ? "Box" : h.change24hPct === undefined ? "—" : `${h.change24hPct >= 0 ? "+" : ""}${h.change24hPct}%`}</b></div>
                    <div><label>{isOptionsArb ? "状态" : "费率"}</label><b>{isOptionsArb ? "已入账" : h.fundingRate === undefined ? "—" : `${(h.fundingRate * 100).toFixed(3)}%`}</b></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 平仓记录 */}
      {closed.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>最近平仓</h2>
            <span className="muted">{closed.length} 笔 · 点行看K线</span>
          </div>
          <div className="table-wrap">
            <table className="trades">
              <thead>
                <tr>
                  <th>方向</th><th>币种</th><th>标签</th>
                  <th>入场</th><th>出场</th><th>出场原因</th>
                  <th>盈亏 $</th><th>盈亏 %</th><th>平仓时间</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((t) => (
                  <tr
                    key={t.id}
                    className="clickable"
                    onClick={() =>
                      onPickSymbol(t.symbol, {
                        direction: t.direction,
                        entry: t.entry_price,
                        stop: t.stop_price,
                        target: t.target_price,
                        openTime: Math.floor(t.open_time / 1000),
                        exitTime: Math.floor(t.exit_time / 1000),
                        exitPrice: t.exit_price,
                      })
                    }
                  >
                    <td><span className={`tag-mini ${t.direction === "long" ? "tag-long" : "tag-short"}`}>{t.direction === "long" ? "多" : "空"}</span></td>
                    <td><b>{t.symbol.replace("USDT", "")}</b></td>
                    <td className="muted">{t.tag}</td>
                    <td>{fmtPrice(t.entry_price)}</td>
                    <td>{fmtPrice(t.exit_price)}</td>
                    <td>{t.exit_reason}</td>
                    <td className={t.pnl_usd >= 0 ? "pos" : "neg"}>{t.pnl_usd >= 0 ? "+" : ""}{fmt(t.pnl_usd)}</td>
                    <td className={t.pnl_pct >= 0 ? "pos" : "neg"}>{fmt(t.pnl_pct, 1)}%</td>
                    <td className="muted">{fmtTime(t.exit_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="disclaimer" style={{ marginTop: 16 }}>
        ⚠ 纯模拟盘，所有交易均为程序按策略规则自动模拟（{state.config.paper.leverage}x 杠杆 · 止损{state.config.paper.stopPct}% · 盈亏比1:{state.config.paper.targetR} · 开仓门槛{state.config.paper.minScoreToOpen}分），不构成投资建议，不涉及真实资金。
      </div>
    </>
  );
}

function Metric({ label, value, positive, negative, big }: { label: string; value: string; positive?: boolean; negative?: boolean; big?: boolean }) {
  const cls = positive === true ? "pos" : positive === false || negative ? "neg" : "";
  return (
    <div className={`metric ${big ? "metric-big" : ""}`}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${cls}`}>{value}</div>
    </div>
  );
}
