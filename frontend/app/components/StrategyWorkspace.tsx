"use client";

import { useEffect, useMemo, useState } from "react";
import TradeChart, { type TradeOverlay } from "../TradeChart";
import { loadKlines, loadStrategyState, formatTime, money, percentage, shortSymbol } from "../lib/data";
import type { AnomalyFactors, Candidate, EquityPoint, Kline, Position, StrategyKey, StrategyState } from "../lib/strategy-types";

function statusFor(candidate: Candidate, positions: Position[]) {
  return positions.some((position) => position.symbol === candidate.symbol && position.direction === candidate.direction) ? "Paper 已开仓" : "观察中";
}

function FactorBars({ candidate }: { candidate: Candidate }) {
  const factors: Partial<AnomalyFactors> = candidate.factors || {};
  const rows = [["OI 变化", factors.oi || 0], ["主动买压力", factors.activeBuy || 0], ["价格动量", factors.price || 0], ["成交额", factors.volume || 0], ["资金费率", factors.funding || 0]];
  return <div className="factor-bars">{rows.map(([label, value]) => <div className="factor-row" key={label as string}><span>{label}</span><div><i style={{ width: `${Math.min(Number(value), 100)}%` }} /></div><b>{Number(value).toFixed(0)}</b></div>)}</div>;
}

function EquityChart({ points, stats }: { points: EquityPoint[]; stats: Record<string, number> | undefined }) {
  const initial = Number(stats?.initialCapital || 10000);
  const data = points.length ? points : [{ ts: Date.now(), equity: initial, cash: initial, open_count: 0 }];
  const values = data.map((point) => point.equity);
  const min = Math.min(initial, ...values);
  const max = Math.max(initial, ...values);
  const range = Math.max(max - min, 1);
  const low = min - range * 0.12;
  const high = max + range * 0.12;
  const x = (index: number) => 3 + (index / Math.max(data.length - 1, 1)) * 94;
  const y = (value: number) => 93 - ((value - low) / (high - low)) * 82;
  const path = data.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(2)} ${y(point.equity).toFixed(2)}`).join(" ");
  const baseline = y(initial);
  const area = `${path} L${x(data.length - 1).toFixed(2)} 96 L${x(0).toFixed(2)} 96 Z`;
  const latest = values[values.length - 1] ?? initial;
  const up = latest >= initial;
  return <div className="equity-chart-wrap"><div className="equity-axis"><span>{money(high, 0)}</span><span>{money((high + low) / 2, 0)}</span><span>{money(low, 0)}</span></div><svg className="equity-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Paper 账户权益曲线"><line x1="3" x2="97" y1={baseline} y2={baseline} className="equity-baseline" /><path d={area} className={`equity-area ${up ? "up" : "down"}`} /><path d={path} className={`equity-line ${up ? "up" : "down"}`} /></svg></div>;
}

function PaperPerformance({ state, equity }: { state: StrategyState | undefined; equity: EquityPoint[] }) {
  const stats = state?.stats;
  const metricRows = [["已实现盈亏", stats?.realizedPnl, "pnl"], ["浮动盈亏", stats?.floating, "pnl"], ["胜率", stats?.winRate, "rate"], ["已平仓交易", stats?.tradeCount, "count"], ["最大回撤", stats?.maxDrawdownPct, "rate"]] as const;
  return <section className="paper-performance"><div className="performance-head"><div><span className="table-kicker">PAPER PERFORMANCE</span><h2>这套策略的账户表现</h2><p>权益曲线来自本地 SQLite Paper 账本；每套策略各自从 $10,000 起算。</p></div><span className="performance-source">Binance 行情 · Paper only</span></div><div className="performance-body"><div className="equity-panel"><div className="equity-title"><div><span>当前权益</span><strong>{money(stats?.equity || stats?.initialCapital || 10000)}</strong></div><b className={(stats?.totalReturnPct || 0) >= 0 ? "positive" : "negative"}>{percentage(stats?.totalReturnPct || 0)}</b></div><EquityChart points={equity} stats={stats} /><div className="equity-footer"><span>起始 {money(stats?.initialCapital || 10000, 0)}</span><span>现金 {money(stats?.cash || 0)}</span><span>持仓浮盈 {money(stats?.floating || 0)}</span></div></div><div className="metric-grid">{metricRows.map(([label, value, kind]) => <div className="metric-card" key={label}><span>{label}</span><strong className={kind === "pnl" ? (Number(value || 0) >= 0 ? "positive" : "negative") : ""}>{kind === "rate" ? `${Number(value || 0).toFixed(2)}%` : kind === "count" ? Number(value || 0).toLocaleString("zh-CN") : money(Number(value || 0))}</strong><small>{label === "已实现盈亏" ? "已完成交易" : label === "浮动盈亏" ? "当前持仓" : label === "胜率" ? `${stats?.wins || 0} 胜 / ${stats?.losses || 0} 负` : label === "已平仓交易" ? "不含当前持仓" : "权益曲线峰值回撤"}</small></div>)}</div></div></section>;
}

function positionLabel(position: Position) {
  return `${shortSymbol(position.symbol)}/USDT ${position.direction === "long" ? "多" : "空"} ${position.status === "open" ? "持仓" : "已平仓"}`;
}

function PaperTable({ positions, closed, onSelect, selectedId }: { positions: Position[]; closed: Position[]; onSelect: (position: Position) => void; selectedId?: number }) {
  const rows = [...positions, ...closed.slice(0, 6)];
  return <div className="paper-table-wrap"><div className="subsection-head"><div><span className="table-kicker">AUTOMATED PAPER LEDGER</span><h3>模拟仓活动</h3></div><span className="muted">后台自动开仓 · 盯仓 · 平仓</span></div><div className="paper-table-note">点击持仓或已平仓记录，可查看该笔交易的入场、止损、止盈和 K 线位置。</div><div className="table-scroll"><table className="data-table compact"><thead><tr><th>合约</th><th>方向</th><th>入场</th><th>止损 / 止盈</th><th>当前结果</th><th>状态</th></tr></thead><tbody>{rows.map((position) => <tr key={position.id} className={`clickable-row ${selectedId === position.id ? "paper-row-selected" : ""}`} tabIndex={0} role="button" aria-label={`查看${positionLabel(position)}`} onClick={() => onSelect(position)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(position); } }}><td><strong>{shortSymbol(position.symbol)}/USDT</strong><small>{position.tag}</small></td><td><span className={`direction-pill ${position.direction}`}>{position.direction === "long" ? "LONG" : "SHORT"}</span></td><td>{money(position.entry_price, position.entry_price < 10 ? 4 : 2)}</td><td>{money(position.stop_price, position.stop_price < 10 ? 4 : 2)} / {money(position.target_price, position.target_price < 10 ? 4 : 2)}</td><td className={(position.floatPnlUsd ?? position.pnl_usd ?? 0) >= 0 ? "positive" : "negative"}>{money(position.floatPnlUsd ?? position.pnl_usd ?? 0)}<small>{position.floatPnlPct != null ? ` ${percentage(position.floatPnlPct)}` : position.pnl_pct != null ? ` ${percentage(position.pnl_pct)}` : ""}</small></td><td><span className={`status-chip ${position.status === "open" ? "live" : "closed"}`}>{position.status === "open" ? "OPEN" : position.exit_reason || "CLOSED"}</span></td></tr>)}</tbody></table></div>{!rows.length ? <div className="empty-state">当前没有 Paper 交易；worker 会在策略命中并通过风险规则后自动处理。</div> : null}</div>;
}

function TradeInspector({ position, candles, loading, error, onClose }: { position: Position; candles: Kline[]; loading: boolean; error?: string; onClose: () => void }) {
  const overlay: TradeOverlay = { direction: position.direction, entry: position.entry_price, stop: position.stop_price, target: position.target_price, entryMarkerTime: position.open_time ? Math.floor(position.open_time / 1000) : undefined, exitTime: position.exit_time ? Math.floor(position.exit_time / 1000) : undefined, exitPrice: position.exit_price };
  return <section className="trade-inspector"><div className="trade-inspector-head"><div><span className="table-kicker">TRADE INSPECTOR</span><h2>{shortSymbol(position.symbol)}/USDT · {position.direction === "long" ? "多头" : "空头"}</h2><p>{position.tag} · {position.status === "open" ? "后台正在盯仓" : `已平仓：${position.exit_reason || "完成"}`}</p></div><button type="button" className="close-button" aria-label="关闭交易详情" onClick={onClose}>×</button></div><div className="trade-inspector-meta"><div><span>入场</span><strong>{money(position.entry_price)}</strong></div><div><span>止损</span><strong>{money(position.stop_price)}</strong></div><div><span>止盈</span><strong>{money(position.target_price)}</strong></div><div><span>{position.status === "open" ? "浮动盈亏" : "已实现盈亏"}</span><strong className={(position.floatPnlUsd ?? position.pnl_usd ?? 0) >= 0 ? "positive" : "negative"}>{money(position.floatPnlUsd ?? position.pnl_usd ?? 0)}</strong></div></div>{loading ? <div className="chart-loading">正在读取 {shortSymbol(position.symbol)} K 线…</div> : candles.length ? <TradeChart candles={candles} trade={overlay} height={330} /> : <div className="chart-loading">K 线暂时不可用，但 Paper 成交记录已保留。{error ? `（${error}）` : ""}</div>}</section>;
}

function CandidateInspector({ candidate, position, candles, loading, error, mode }: { candidate: Candidate; position?: Position; candles: Kline[]; loading: boolean; error?: string; mode: "anomaly" | "dualma" }) {
  const entry = position?.entry_price || candidate.lastPrice;
  const stop = position?.stop_price || candidate.lastPrice * (candidate.direction === "long" ? 0.97 : 1.03);
  const target = position?.target_price || candidate.lastPrice * (candidate.direction === "long" ? 1.06 : 0.94);
  const markerTime = position?.open_time ? Math.floor(position.open_time / 1000) : candidate.signalCandleTime || candles[candles.length - 2]?.time || candles[candles.length - 1]?.time;
  const overlay: TradeOverlay = { direction: candidate.direction, entry, stop, target, openTime: position?.open_time ? Math.floor(position.open_time / 1000) : undefined, entryMarkerTime: markerTime, entryLabel: position ? "实际开仓" : mode === "dualma" ? "信号/计划" : "计划入场", entryLineTitle: position ? "实际入场" : "计划入场" };
  return <div className="candidate-inspector-chart"><div className="candidate-chart-head"><div><strong>{position ? "实际 Paper 开仓位置" : "策略计划入场位置"}</strong><span>{mode === "dualma" ? "标记在已收盘交叉 K 线" : "标记在最近一根可用 K 线"}</span></div><span className="chart-key"><i className="chart-key-entry" />{position ? "实际入场" : "计划入场"}</span></div>{loading ? <div className="chart-loading">正在读取 {shortSymbol(candidate.symbol)} K 线…</div> : candles.length ? <TradeChart candles={candles} trade={overlay} height={270} /> : <div className="chart-loading">K 线暂时不可用，但候选数据已保留。{error ? `（${error}）` : ""}</div>}</div>;
}

function ScanCoverage({ scan, positions }: { scan: StrategyState["latestScan"]; positions: Position[] }) {
  const coverage = scan?.coverage;
  const value = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("en-US");
  const rows = [["全市场扫描", value(coverage?.scannedCount ?? scan?.scannedCount), "Binance USDT 永续"], ["OI 可用", value(coverage?.oiAvailableCount), "成功拿到持仓量"], ["完成评分", value(coverage?.scoredCount), "通过 OI 条件后计算五因子"], ["达到评分阈值", value(coverage?.thresholdCount ?? scan?.candidateCount), "综合分 ≥ 35"], ["有效信号", value(coverage?.signalCount ?? scan?.candidateCount), "通过方向分类"], ["Paper 开仓", value(scan?.openedCount ?? positions.length), "后台自动管理"]];
  return <section className="scan-coverage"><div className="coverage-heading"><div><span className="table-kicker">FULL-MARKET COVERAGE</span><h2>本轮扫描到底看了什么</h2><p>全市场数量、数据覆盖、评分和 Paper 开仓分别统计，Top 5 只是榜单，不是扫描总量。</p></div><span className="coverage-live">{scan?.scannedAt ? "LIVE SCAN" : "WAITING FOR SCAN"}</span></div><div className="coverage-grid">{rows.map(([label, valueText, note]) => <div key={label}><span>{label}</span><strong>{valueText}</strong><small>{note}</small></div>)}</div>{coverage?.missingOiCount ? <div className="coverage-note">有 {coverage.missingOiCount.toLocaleString("en-US")} 个合约暂时没有 OI 返回，已保留在扫描总量中，但不会进入评分候选。</div> : null}</section>;
}

function TopOpportunities({ candidates, positions, onSelect }: { candidates: Candidate[]; positions: Position[]; onSelect: (candidate: Candidate) => void }) {
  return <section className="top-opportunities"><div className="subsection-head"><div><span className="table-kicker">TOP 5 OPPORTUNITIES</span><h3>最高分机会榜</h3></div><span className="muted">从全部达标候选中排序</span></div>{candidates.length ? <div className="top-opportunity-list">{candidates.slice(0, 5).map((candidate, index) => <button type="button" key={`${candidate.symbol}-${candidate.direction}`} onClick={() => onSelect(candidate)}><span className="rank">0{index + 1}</span><span className="opportunity-symbol"><strong>{shortSymbol(candidate.symbol)}/USDT</strong><small>{candidate.tag}</small></span><span className={`direction-pill ${candidate.direction}`}>{candidate.direction === "long" ? "LONG" : "SHORT"}</span><span className="opportunity-score"><b>{candidate.score}</b><small>综合分</small></span><span className={`status-chip ${positions.some((position) => position.symbol === candidate.symbol && position.direction === candidate.direction) ? "live" : "watch"}`}>{statusFor(candidate, positions)}</span></button>)}</div> : <div className="empty-state">本轮没有达到策略评分阈值的实时候选。扫描总量仍会在上方保留。</div>}</section>;
}

export default function StrategyWorkspace({ mode }: { mode: "anomaly" | "dualma" }) {
  const strategy: StrategyKey = mode === "anomaly" ? "anomaly-binance" : "dualma4h-binance";
  const [data, setData] = useState<{ state: StrategyState; equity: EquityPoint[] } | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [paperSelection, setPaperSelection] = useState<Position | null>(null);
  const [paperCandles, setPaperCandles] = useState<Kline[]>([]);
  const [paperLoading, setPaperLoading] = useState(false);
  const [paperKlineError, setPaperKlineError] = useState("");
  const [candidateCandles, setCandidateCandles] = useState<Kline[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateKlineError, setCandidateKlineError] = useState("");
  const [filter, setFilter] = useState("全部");
  const [sort, setSort] = useState("score");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () => loadStrategyState(strategy).then((result) => {
      if (alive) { setData(result); setError(""); }
    }).catch((reason) => {
      if (alive) setError(reason?.message || "数据加载失败");
    });
    load();
    const id = window.setInterval(load, 10000);
    return () => { alive = false; window.clearInterval(id); };
  }, [strategy]);

  const state = data?.state;
  const positions = state?.positions || [];
  const closed = state?.recentClosed || [];
  const liveCandidates = state?.latestScan?.hits || [];
  const allCandidates = state?.latestScan?.allCandidates || [];
  const candidates = mode === "anomaly" ? allCandidates : liveCandidates;
  const hasLiveAnomalyScan = mode === "anomaly" && Boolean(state?.latestScan?.scannedAt);
  const displayed = useMemo(() => candidates.filter((candidate) => filter === "全部" || (filter === "多头" ? candidate.direction === "long" : filter === "空头" ? candidate.direction === "short" : statusFor(candidate, positions) === "Paper 已开仓")).sort((a, b) => sort === "score" ? b.score - a.score : (a.volumeRank || 99) - (b.volumeRank || 99)), [candidates, filter, positions, sort]);
  const scanned = state?.latestScan?.coverage?.scannedCount || state?.latestScan?.scannedCount || 0;
  const candidateCount = state?.latestScan?.candidateCount ?? candidates.length;
  const selectedPosition = selected ? positions.find((position) => position.symbol === selected.symbol && position.direction === selected.direction) : undefined;

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setCandidateLoading(true);
    setCandidateKlineError("");
    setCandidateCandles([]);
    loadKlines(strategy, selected.symbol, mode === "anomaly" ? "1H" : "4H").then((items) => { if (alive) setCandidateCandles(items); }).catch((reason) => { if (alive) { setCandidateCandles([]); setCandidateKlineError(reason?.message || "K 线读取失败"); } }).finally(() => { if (alive) setCandidateLoading(false); });
    return () => { alive = false; };
  }, [mode, selected, strategy]);

  useEffect(() => {
    if (!paperSelection) return;
    let alive = true;
    setPaperLoading(true);
    setPaperKlineError("");
    setPaperCandles([]);
    loadKlines(strategy, paperSelection.symbol, mode === "anomaly" ? "1H" : "4H").then((items) => { if (alive) setPaperCandles(items); }).catch((reason) => { if (alive) { setPaperCandles([]); setPaperKlineError(reason?.message || "K 线读取失败"); } }).finally(() => { if (alive) setPaperLoading(false); });
    return () => { alive = false; };
  }, [mode, paperSelection, strategy]);

  return <div className="workspace-stack">
    {error ? <div className="inline-alert">{error} · 当前不显示演示候选。</div> : null}
    <div className="workspace-toolbar"><div className="toolbar-stats"><div><span>Paper 账户</span><strong>{money(state?.stats.initialCapital || 10000, 0)}</strong><small>每套策略独立资金</small></div><div><span>当前权益</span><strong>{money(state?.stats.equity || state?.stats.initialCapital || 10000, 0)}</strong><small>{state?.stats.totalReturnPct != null ? percentage(state.stats.totalReturnPct) : "等待首轮"}</small></div><div><span>扫描范围</span><strong>{scanned.toLocaleString("en-US")}</strong><small>Binance USDT 永续</small></div><div><span>{mode === "anomaly" ? "达标候选" : "本轮信号"}</span><strong>{candidateCount}</strong><small>{mode === "anomaly" ? "评分 ≥ 35" : "收盘交叉信号"}</small></div><div><span>Paper 持仓</span><strong>{positions.length}</strong><small>后台自动管理</small></div></div><div className={`auto-run-status ${state?.scanStatus === "scanning" ? "is-scanning" : ""}`}><span className="status-dot" /><strong>{state?.scanStatus === "scanning" ? "正在扫描" : "自动运行中"}</strong><small>每 {state?.config.scanIntervalSec || 120} 秒扫描 · 自动开平仓</small></div></div>
    {state?.scanStatus === "scanning" ? <div className="run-message scanning-message"><span className="status-dot" /><span>后台正在扫描 Binance 市场（开始于 {formatTime(state.scanStartedAt)}），完成后会自动更新候选和 Paper 交易。</span></div> : state?.latestScan ? <div className="run-message"><span className="status-dot" /><span>最近一轮已完成：{formatTime(state.latestScan.scannedAt)} · 后台会自动等待下一轮，不需要手动刷新。</span></div> : <div className="run-message"><span className="status-dot" /><span>后台正在进行首次扫描，完成后会自动显示候选和 Paper 交易。</span></div>}
    <PaperPerformance state={state} equity={data?.equity || []} />
    {mode === "anomaly" ? <ScanCoverage scan={state?.latestScan || null} positions={positions} /> : null}
    {mode === "anomaly" && !allCandidates.length ? <div className={`inline-alert ${hasLiveAnomalyScan ? "neutral-alert" : ""}`}>{hasLiveAnomalyScan ? "本轮实时扫描完成，但没有候选达到评分阈值；首轮通常还会建立 OI 基线，下一轮才更容易出现 OI 变化分。" : "正在等待 Binance 全市场扫描结果，暂不显示演示候选。"}</div> : null}
    <div className="workspace-grid"><section className="data-panel candidate-panel"><div className="panel-toolbar"><div><span className="table-kicker">{mode === "anomaly" ? "ALL QUALIFIED CANDIDATES" : "CROSSOVER SIGNALS"}</span><h2>{mode === "anomaly" ? "全部达标候选" : "双均线信号"}</h2><p>{mode === "anomaly" ? "完整展示本轮通过评分与方向分类的候选；点击任一行查看因子拆解。" : "只使用已收盘 4H K 线确认的 EMA10 / EMA30 交叉。"}</p></div><div className="filter-group" role="group" aria-label="候选筛选">{["全部", "多头", "空头", "Paper 已开仓"].map((item) => <button type="button" key={item} className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}<select aria-label="候选排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="score">按评分</option><option value="volume">按成交额排名</option></select></div></div><div className="table-scroll"><table className="data-table"><thead><tr>{mode === "anomaly" ? <><th>合约</th><th>方向</th><th>评分</th><th>异动标签</th><th>OI 变化</th><th>价格 24H</th><th>成交额</th><th>资金费率</th><th>状态</th></> : <><th>合约</th><th>信号</th><th>评分</th><th>EMA10</th><th>EMA30</th><th>成交额排名</th><th>信号时间</th><th>状态</th></>}</tr></thead><tbody>{displayed.map((candidate) => <tr key={`${candidate.symbol}-${candidate.direction}`} tabIndex={0} role="button" aria-label={`查看${shortSymbol(candidate.symbol)}候选详情`} onClick={() => setSelected(candidate)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(candidate); } }} className={`clickable-row ${selected?.symbol === candidate.symbol && selected.direction === candidate.direction ? "row-selected" : ""}`}><td><strong>{shortSymbol(candidate.symbol)}/USDT</strong><small>{candidate.lastPrice?.toLocaleString("en-US", { maximumFractionDigits: 6 })}</small></td>{mode === "anomaly" ? <><td><span className={`direction-pill ${candidate.direction}`}>{candidate.direction === "long" ? "LONG" : "SHORT"}</span></td><td><span className="score-number">{candidate.score}</span><div className="score-track"><i style={{ width: `${candidate.score}%` }} /></div></td><td>{candidate.tag}</td><td className="positive">{candidate.oiChangePct == null ? "—" : percentage(candidate.oiChangePct)}</td><td className={candidate.change24hPct && candidate.change24hPct < 0 ? "negative" : "positive"}>{percentage(candidate.change24hPct || 0)}</td><td>{candidate.volumeUsd ? `${(candidate.volumeUsd / 1e6).toFixed(0)}M` : "—"}</td><td>{candidate.fundingRate == null ? "—" : `${(candidate.fundingRate * 100).toFixed(3)}%`}</td><td><span className={`status-chip ${positions.some((position) => position.symbol === candidate.symbol && position.direction === candidate.direction) ? "live" : "watch"}`}>{statusFor(candidate, positions)}</span></td></> : <><td><span className={`signal-pill ${candidate.signal}`}>{candidate.signal === "golden" ? "↗ 金叉" : "↘ 死叉"}</span></td><td><span className="score-number">{candidate.score}</span></td><td>{candidate.fastEma?.toFixed(2) || "—"}</td><td>{candidate.slowEma?.toFixed(2) || "—"}</td><td>#{candidate.volumeRank || "—"}</td><td>{formatTime(candidate.signalCandleTime)}</td><td><span className={`status-chip ${positions.some((position) => position.symbol === candidate.symbol) ? "live" : "watch"}`}>{statusFor(candidate, positions)}</span></td></>}</tr>)}</tbody></table></div>{!displayed.length ? <div className="empty-state">{mode === "anomaly" && hasLiveAnomalyScan ? "本轮没有实时达标候选。" : "当前筛选条件没有候选。"}</div> : null}</section><aside className="detail-panel">{selected ? <><div className="detail-head"><div><span className={`direction-pill ${selected.direction}`}>{selected.direction === "long" ? "LONG" : "SHORT"}</span><h2>{shortSymbol(selected.symbol)}/USDT</h2><p>{selected.tag} · score {selected.score}</p></div><button type="button" className="close-button" aria-label="关闭候选详情" onClick={() => setSelected(null)}>×</button></div><h3>为什么选择它</h3>{mode === "anomaly" ? <><p className="reason-copy">{selected.tag}：OI、价格方向与盘口压力形成{selected.direction === "long" ? "向上" : "向下"}共振，综合评分达到策略阈值。</p><FactorBars candidate={selected} /></> : <><p className="reason-copy">{selected.reason}</p><div className="ema-summary"><div><span>EMA10</span><strong>{selected.fastEma?.toFixed(2) || "—"}</strong></div><div><span>EMA30</span><strong>{selected.slowEma?.toFixed(2) || "—"}</strong></div><div><span>信号 K 线</span><strong>{formatTime(selected.signalCandleTime)}</strong></div></div></>}<div className="plan-box"><span className="table-kicker">PAPER PLAN</span><div><span>参考入场</span><strong>{money(selected.lastPrice, selected.lastPrice < 10 ? 4 : 2)}</strong></div><div><span>止损</span><strong>{money(selected.lastPrice * (selected.direction === "long" ? .97 : 1.03), selected.lastPrice < 10 ? 4 : 2)}</strong></div><div><span>止盈</span><strong>{money(selected.lastPrice * (selected.direction === "long" ? 1.06 : .94), selected.lastPrice < 10 ? 4 : 2)}</strong></div><small>模拟仓由后台 worker 自动处理 · broadcast=false</small></div></> : <div className="detail-empty"><span>↖</span><h3>选择一个候选</h3><p>点击或用键盘聚焦左侧任意一行，查看 Agent 的判断理由、评分拆解和 Paper 计划。</p></div>}</aside></div>
    {selected ? <CandidateInspector candidate={selected} position={selectedPosition} candles={candidateCandles} loading={candidateLoading} error={candidateKlineError} mode={mode} /> : null}
    {mode === "anomaly" ? <TopOpportunities candidates={allCandidates} positions={positions} onSelect={setSelected} /> : null}
    {mode === "anomaly" ? <div className="explain-strip"><div><strong>评分口径</strong><span>OI 30% · 主动买卖 25% · 价格 20% · 成交额 15% · 资金费率 10%</span></div><div><strong>Paper 开仓</strong><span>扫描分 ≥ 35 后，还需满足 Paper 分数 ≥ 48、冷却、并发和止损检查</span></div></div> : <div className="explain-strip"><div><strong>双均线口径</strong><span>EMA10 / EMA30 在已收盘 4H K 线上确认交叉</span></div><div><strong>评分说明</strong><span>score 60 代表有效交叉，不等同于 A 档多因子综合分</span></div></div>}
    <PaperTable positions={positions} closed={closed} onSelect={setPaperSelection} selectedId={paperSelection?.id} />
    {paperSelection ? <TradeInspector position={paperSelection} candles={paperCandles} loading={paperLoading} error={paperKlineError} onClose={() => setPaperSelection(null)} /> : null}
  </div>;
}
