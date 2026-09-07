"use client";

import { useEffect, useState } from "react";
import AppShell from "./AppShell";
import { formatTime } from "../lib/data";
import type { AgentRun } from "../lib/strategy-types";

export default function RunsPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]); const [selected, setSelected] = useState<AgentRun | null>(null);
  const reload = () => fetch("/api/runs?limit=50", { cache: "no-store" }).then((r) => r.json()).then((d) => setRuns(d.runs || [])).catch(() => undefined);
  useEffect(() => { reload(); const id = window.setInterval(reload, 30000); return () => window.clearInterval(id); }, []);
  const openRun = (runId: string) => fetch(`/api/runs?id=${encodeURIComponent(runId)}`).then((r) => r.json()).then(setSelected);
  const label = (strategy: string) => strategy === "anomaly-binance" ? "A档异动扫描" : strategy === "dualma4h-binance" ? "双均线 4H" : "30m 箱体突破";
  return <AppShell title="运行记录" eyebrow="AUDIT TRAIL"><div className="runs-header"><div><span className="page-eyebrow">PERSISTED TOOL LAYER EVENTS</span><h2>每一次运行，都可回放。</h2><p>后台 Paper 周期和 Agent Tool Layer 的审计事件都保留在本地，页面会自动同步。</p></div><button type="button" className="outline-button" onClick={reload}>↻ 刷新记录</button></div><div className="runs-layout"><section className="data-panel"><table className="data-table"><thead><tr><th>Run ID</th><th>策略</th><th>扫描</th><th>候选</th><th>计划</th><th>完成时间</th><th>状态</th></tr></thead><tbody>{runs.map((run) => <tr key={run.run_id} className="clickable-row" tabIndex={0} role="button" aria-label={`查看运行记录 ${run.run_id.slice(-16)}`} onClick={() => openRun(run.run_id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRun(run.run_id); } }}><td><strong>{run.run_id.slice(-16)}</strong><small>{run.intent}</small></td><td>{label(run.strategy)}</td><td>{run.scanned_count}</td><td>{run.candidate_count}</td><td>{run.plan_count}</td><td>{formatTime(run.completed_at)}</td><td><span className="status-chip live">COMPLETED</span></td></tr>)}</tbody></table>{!runs.length ? <div className="empty-state">当前暂无 Agent Tool Layer 记录；策略扫描和 Paper 交易不依赖手动运行。</div> : null}</section>{selected ? <aside className="run-detail"><button type="button" className="close-button" aria-label="关闭运行详情" onClick={() => setSelected(null)}>×</button><span className="table-kicker">RUN DETAIL</span><h2>{label(selected.strategy)}</h2><p>{selected.intent}</p><div className="timeline">{(selected.events || []).map((event) => <div key={event.id}><span className="timeline-dot">✓</span><div><strong>{event.phase}</strong><p>{event.detail}</p><small>{formatTime(event.ts)}</small></div></div>)}</div><div className="safety-note">Paper only · broadcast=false</div></aside> : null}</div></AppShell>;
}
