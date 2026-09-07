"use client";

import { useEffect, useMemo, useState } from "react";
import TradeChart, { type TradeOverlay } from "../TradeChart";
import { formatTime, loadKlines, loadStrategyState, money, percentage, shortSymbol } from "../lib/data";
import type { Candidate, EquityPoint, Kline, Position, StrategyState } from "../lib/strategy-types";

const STRATEGY = "box-breakout30m-binance" as const;

function equityLine(points: EquityPoint[], initial: number) {
  const rows = points.length ? points : [{ ts: Date.now(), equity: initial, cash: initial, open_count: 0 }];
  const values = rows.map((row) => row.equity);
  const min = Math.min(...values, initial);
  const max = Math.max(...values, initial);
  const range = Math.max(max - min, 1);
  const x = (index: number) => 3 + (index / Math.max(rows.length - 1, 1)) * 94;
  const y = (value: number) => 92 - ((value - (min - range * .12)) / (range * 1.24)) * 82;
  return { path: rows.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(2)} ${y(row.equity).toFixed(2)}`).join(" "), latest: values.at(-1) || initial };
}

function PositionRow({ position, onSelect }: { position: Position; onSelect: () => void }) {
  return <tr className="clickable-row" tabIndex={0} role="button" onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}><td><strong>{shortSymbol(position.symbol)}/USDT</strong><small>{position.tag}</small></td><td><span className="direction-pill long">LONG</span></td><td>{money(position.entry_price, position.entry_price < 10 ? 4 : 2)}</td><td>{money(position.stop_price, position.stop_price < 10 ? 4 : 2)} / {money(position.target_price, position.target_price < 10 ? 4 : 2)}</td><td className={(position.floatPnlUsd ?? position.pnl_usd ?? 0) >= 0 ? "positive" : "negative"}>{money(position.floatPnlUsd ?? position.pnl_usd ?? 0)}</td><td><span className={`status-chip ${position.status === "open" ? "live" : "closed"}`}>{position.status === "open" ? "OPEN" : position.exit_reason || "CLOSED"}</span></td></tr>;
}

export default function BoxBreakoutWorkspace() {
  const [data, setData] = useState<{ state: StrategyState; equity: EquityPoint[] } | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [candles, setCandles] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("全部");

  useEffect(() => {
    let alive = true;
    const load = () => loadStrategyState(STRATEGY).then((result) => { if (alive) { setData(result); setError(""); } }).catch((reason) => { if (alive) setError(reason?.message || "数据加载失败"); });
    load();
    const id = window.setInterval(load, 10000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoading(true); setCandles([]);
    loadKlines(STRATEGY, selected.symbol, "30m").then((items) => { if (alive) setCandles(items); }).catch((reason) => { if (alive) setError(reason?.message || "K 线读取失败"); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [selected]);

  const state = data?.state;
  const positions = state?.positions || [];
  const candidates = state?.latestScan?.allCandidates || state?.latestScan?.hits || [];
  const displayed = useMemo(() => candidates.filter((candidate) => filter === "全部" || filter === "多头" && candidate.direction === "long" || filter === "Paper 已开仓" && positions.some((position) => position.symbol === candidate.symbol)), [candidates, filter, positions]);
  const stats = state?.stats;
  const initial = Number(stats?.initialCapital || 10000);
  const chart = equityLine(data?.equity || [], initial);
  const scan = state?.latestScan;
  const coverage = scan?.coverage;
  const selectedPaper = selected ? positions.find((position) => position.symbol === selected.symbol) : undefined;
  const entry = selectedPaper?.entry_price || selected?.lastPrice || 0;
  const overlay: TradeOverlay | undefined = selected ? { direction: "long", entry, stop: selectedPaper?.stop_price || entry * .95, target: selectedPaper?.target_price || entry * 1.1, openTime: selectedPaper?.open_time ? Math.floor(selectedPaper.open_time / 1000) : undefined, entryMarkerTime: selected.breakoutCandleTime || candles.at(-2)?.time, entryLabel: selectedPaper ? "实际开仓" : "突破计划", entryLineTitle: selectedPaper ? "实际入场" : "计划入场" } : undefined;

  return <div className="workspace-stack box-breakout-workspace">
    {error ? <div className="inline-alert">{error}</div> : null}
    <section className="box-strategy-hero"><div><span className="table-kicker">BREAKOUT PLAYBOOK / BINANCE FUTURES</span><h2>30 分钟箱体突破，只做确认后的多单。</h2><p>最近 48 根已收盘 30m K 线定义箱体。只有收盘价站上箱体上沿至少 0.3%，并且突破量达到箱体均量 1.5 倍，才进入 Paper 开仓流程。</p></div><div className="box-rule-stack"><div><span>方向</span><strong>LONG ONLY</strong></div><div><span>止损</span><strong>5%</strong></div><div><span>止盈</span><strong>2R / 约10%</strong></div></div></section>
    <div className="workspace-toolbar"><div className="toolbar-stats"><div><span>Paper 账户</span><strong>{money(initial, 0)}</strong><small>独立模拟资金</small></div><div><span>当前权益</span><strong>{money(stats?.equity || initial, 0)}</strong><small>{percentage(stats?.totalReturnPct || 0)}</small></div><div><span>市场覆盖</span><strong>{(coverage?.scannedCount || scan?.scannedCount || 0).toLocaleString("en-US")}</strong><small>Binance USDT 永续</small></div><div><span>候选突破</span><strong>{scan?.candidateCount || 0}</strong><small>已收盘 + 放量确认</small></div><div><span>Paper 持仓</span><strong>{positions.length}</strong><small>后台自动管理</small></div></div><div className="auto-run-status"><span className="status-dot" /><strong>自动运行中</strong><small>每 {state?.config.scanIntervalSec || 120} 秒扫描</small></div></div>
    <div className="run-message"><span className="status-dot" /><span>{scan?.scannedAt ? `最近一轮已完成：${formatTime(scan.scannedAt)} · 只判断已收盘 30m K 线，不需要手动刷新。` : "等待 Binance 首轮箱体扫描完成。"}</span></div>
    <section className="box-metrics-grid"><div><span>扫描标的池</span><strong>{(coverage?.oiEligibleCount || 60).toLocaleString("en-US")}</strong><small>按成交额排序</small></div><div><span>箱体回看</span><strong>48 根</strong><small>约 24 小时</small></div><div><span>有效突破门槛</span><strong>+0.3%</strong><small>收盘站上沿</small></div><div><span>放量门槛</span><strong>1.5×</strong><small>相对箱体均量</small></div></section>
    <section className="paper-performance"><div className="performance-head"><div><span className="table-kicker">PAPER PERFORMANCE</span><h2>箱体策略账户表现</h2><p>独立 $10,000 Paper 账本，后台自动开仓、止损、止盈和超时平仓。</p></div><span className="performance-source">30m breakout · Paper only</span></div><div className="performance-body"><div className="equity-panel"><div className="equity-title"><div><span>当前权益</span><strong>{money(stats?.equity || initial)}</strong></div><b className={(stats?.totalReturnPct || 0) >= 0 ? "positive" : "negative"}>{percentage(stats?.totalReturnPct || 0)}</b></div><div className="box-equity-chart"><svg className="equity-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="箱体策略 Paper 权益曲线"><path d={`${chart.path} L97 96 L3 96 Z`} className="equity-area up" /><path d={chart.path} className="equity-line up" /></svg></div><div className="equity-footer"><span>起始 {money(initial, 0)}</span><span>现金 {money(stats?.cash || initial)}</span><span>已平仓 {stats?.tradeCount || 0} 笔</span></div></div><div className="metric-grid"><div className="metric-card"><span>已实现盈亏</span><strong className={(stats?.realizedPnl || 0) >= 0 ? "positive" : "negative"}>{money(stats?.realizedPnl || 0)}</strong><small>已完成交易</small></div><div className="metric-card"><span>胜率</span><strong>{Number(stats?.winRate || 0).toFixed(2)}%</strong><small>{stats?.wins || 0} 胜 / {stats?.losses || 0} 负</small></div><div className="metric-card"><span>最大回撤</span><strong>{Number(stats?.maxDrawdownPct || 0).toFixed(2)}%</strong><small>权益曲线峰值回撤</small></div><div className="metric-card"><span>止损规则</span><strong>5.00%</strong><small>固定风险边界</small></div></div></div></section>
    <section className="data-panel candidate-panel"><div className="panel-toolbar"><div><span className="table-kicker">CONFIRMED 30M BREAKOUTS</span><h2>箱体突破候选</h2><p>每一行都已经通过收盘价、突破幅度和成交量三项确认；本策略不会生成空单。</p></div><div className="filter-group" role="group" aria-label="箱体候选筛选">{["全部", "多头", "Paper 已开仓"].map((item) => <button type="button" key={item} className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>合约</th><th>方向</th><th>箱体上沿</th><th>箱体下沿</th><th>突破幅度</th><th>量比</th><th>信号时间</th><th>状态</th></tr></thead><tbody>{displayed.map((candidate) => <tr key={candidate.symbol} className={`clickable-row ${selected?.symbol === candidate.symbol ? "row-selected" : ""}`} tabIndex={0} role="button" onClick={() => setSelected(candidate)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(candidate); } }}><td><strong>{shortSymbol(candidate.symbol)}/USDT</strong><small>参考价 {candidate.lastPrice?.toLocaleString("en-US", { maximumFractionDigits: 6 })}</small></td><td><span className="direction-pill long">LONG</span></td><td>{candidate.boxHigh?.toLocaleString("en-US", { maximumFractionDigits: 6 }) || "—"}</td><td>{candidate.boxLow?.toLocaleString("en-US", { maximumFractionDigits: 6 }) || "—"}</td><td className="positive">+{Number(candidate.breakoutPct || 0).toFixed(2)}%</td><td>{Number(candidate.volumeRatio || 0).toFixed(2)}×</td><td>{formatTime(candidate.breakoutCandleTime)}</td><td><span className={`status-chip ${positions.some((position) => position.symbol === candidate.symbol) ? "live" : "watch"}`}>{positions.some((position) => position.symbol === candidate.symbol) ? "Paper 已开仓" : "已确认"}</span></td></tr>)}</tbody></table></div>{!displayed.length ? <div className="empty-state">本轮没有满足“收盘突破 + 放量”的箱体候选；箱体内震荡不会进入列表。</div> : null}</section>
    {selected ? <section className="candidate-inspector-chart"><div className="candidate-chart-head"><div><strong>{selectedPaper ? "实际 Paper 开仓位置" : "突破计划入场位置"}</strong><span>30m K 线：箱体上沿、突破 K 线与计划止损</span></div><button type="button" className="close-button" aria-label="关闭候选详情" onClick={() => setSelected(null)}>×</button></div>{loading ? <div className="chart-loading">正在读取 {shortSymbol(selected.symbol)} 30m K 线…</div> : candles.length && overlay ? <TradeChart candles={candles} trade={overlay} height={320} /> : <div className="chart-loading">K 线暂时不可用。</div>}<div className="box-detail-grid"><div><span>箱体上沿</span><strong>{money(selected.boxHigh || 0)}</strong></div><div><span>箱体下沿</span><strong>{money(selected.boxLow || 0)}</strong></div><div><span>突破收盘</span><strong>{money(selected.signalClose || selected.lastPrice || 0)}</strong></div><div><span>突破量比</span><strong>{Number(selected.volumeRatio || 0).toFixed(2)}×</strong></div><div><span>止损 5%</span><strong>{money(selectedPaper?.stop_price || entry * .95)}</strong></div><div><span>止盈 2R</span><strong>{money(selectedPaper?.target_price || entry * 1.1)}</strong></div></div><p className="reason-copy">{selected.reason}</p></section> : null}
    <section className="paper-table-wrap"><div className="subsection-head"><div><span className="table-kicker">AUTOMATED PAPER LEDGER</span><h3>模拟仓活动</h3></div><span className="muted">只做多 · 止损5% · 止盈2R</span></div><div className="table-scroll"><table className="data-table compact"><thead><tr><th>合约</th><th>方向</th><th>入场</th><th>止损 / 止盈</th><th>结果</th><th>状态</th></tr></thead><tbody>{positions.map((position) => <PositionRow key={position.id} position={position} onSelect={() => setSelectedPosition(position)} />)}</tbody></table></div>{!positions.length ? <div className="empty-state">当前没有 Paper 持仓；策略会在确认突破并通过风控后自动记录。</div> : null}</section>
    {selectedPosition ? <section className="trade-inspector"><div className="trade-inspector-head"><div><span className="table-kicker">TRADE INSPECTOR</span><h2>{shortSymbol(selectedPosition.symbol)}/USDT · 多头</h2><p>{selectedPosition.tag} · {selectedPosition.status === "open" ? "后台正在盯仓" : selectedPosition.exit_reason || "已平仓"}</p></div><button type="button" className="close-button" aria-label="关闭交易详情" onClick={() => setSelectedPosition(null)}>×</button></div><div className="trade-inspector-meta"><div><span>入场</span><strong>{money(selectedPosition.entry_price)}</strong></div><div><span>止损</span><strong>{money(selectedPosition.stop_price)}</strong></div><div><span>止盈</span><strong>{money(selectedPosition.target_price)}</strong></div><div><span>当前结果</span><strong className={(selectedPosition.floatPnlUsd ?? selectedPosition.pnl_usd ?? 0) >= 0 ? "positive" : "negative"}>{money(selectedPosition.floatPnlUsd ?? selectedPosition.pnl_usd ?? 0)}</strong></div></div></section> : null}
  </div>;
}
