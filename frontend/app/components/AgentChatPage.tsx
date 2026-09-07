"use client";

import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
import AppShell from "./AppShell";
import TradeChart, { type TradeOverlay } from "../TradeChart";
import { formatTime, loadKlines, money, shortSymbol } from "../lib/data";
import type { Kline, StrategyKey as RegisteredStrategyKey } from "../lib/strategy-types";

type StrategyKey = string;
type StrategyOption = { key: StrategyKey; name: string; desc?: string; kind?: string; source?: string };
type ToolOption = { name: string; title?: string; description?: string };
type OfficialMcp = { name: string; endpoint: string; docsUrl: string; status: string; scopes: string[]; note: string };
type Capabilities = { server?: { name: string; version: string }; officialMcp?: OfficialMcp; strategies: StrategyOption[]; tools: ToolOption[] };
type Trace = { name: string; status: "ok" | "error" | "blocked" | "skipped"; resultSummary?: string; asOf?: string | null };
type Evidence = { source?: string; asOf?: string | null; candidateCount?: number; positionCount?: number };
type PaperPlan = { symbol: string; direction: "long" | "short"; score?: number; reason?: string; entryPrice?: number | null; stopPrice?: number | null; targetPrice?: number | null; leverage?: number; broadcast?: boolean };
type PlanRun = { runId: string; paperPlan?: PaperPlan[]; decision?: { pass?: boolean; reasons?: string[]; selectedPlanCount?: number }; events?: Array<{ phase: string; detail: string; status: string }> };
type PaperExecution = { status: string; symbol: string; direction: "long" | "short"; openedCount: number; message: string };
type Message = { id: number; role: "user" | "assistant"; text: string; strategy?: string; trace?: Trace[]; evidence?: Evidence; opportunities?: PaperPlan[]; planRun?: PlanRun; execution?: PaperExecution; error?: boolean };
type WorkflowState = "idle" | "analyzing" | "scored" | "researching" | "risk" | "paper" | "audit";

const WORKFLOW_STAGES = [
  { key: "market", label: "行情分析", role: "Market Analyst", detail: "覆盖 Binance 全市场" },
  { key: "strategy", label: "策略判断", role: "Strategy Analyst", detail: "比较候选与理由" },
  { key: "risk", label: "风险检查", role: "Risk Officer", detail: "止损 / 杠杆 / 并发" },
  { key: "paper", label: "Paper 执行", role: "Paper Executor", detail: "只写入模拟账本" },
  { key: "audit", label: "审计记录", role: "Audit Trail", detail: "保留完整事件链" },
] as const;

const GENERIC_PRESETS = ["Binance MCP 目前能做什么？", "扫描全市场，告诉我现在最值得研究的机会", "查看 BTCUSDT 的 K线和 OI", "当前 Paper 持仓和风险怎么样？"];

function candidateKey(candidate: PaperPlan) { return `${candidate.symbol}-${candidate.direction}`; }

function planOverlay(candidate: PaperPlan, candles: Kline[]): TradeOverlay {
  const entry = Number(candidate.entryPrice || 0);
  const direction = candidate.direction || "long";
  return { direction, entry, stop: Number(candidate.stopPrice || (direction === "long" ? entry * 0.97 : entry * 1.03)), target: Number(candidate.targetPrice || (direction === "long" ? entry * 1.06 : entry * 0.94)), entryMarkerTime: candles[candles.length - 2]?.time || candles[candles.length - 1]?.time, entryLabel: "计划入场", entryLineTitle: "计划入场" };
}

export default function AgentChatPage() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [strategy, setStrategy] = useState<StrategyKey>("");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<{ key: string; candidate: PaperPlan; strategy: string } | null>(null);
  const [selectedCandles, setSelectedCandles] = useState<Kline[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState("");
  const [actionKey, setActionKey] = useState("");
  const [workflowState, setWorkflowState] = useState<WorkflowState>("idle");
  const [messages, setMessages] = useState<Message[]>([{ id: 1, role: "assistant", text: "你好，我是 Binance MCP Strategy Agent。你可以直接说“扫描全市场”或查询 K 线、OI、Paper、风险和审计；扫描结果会变成可点击的研究卡片。", trace: [] }]);

  useEffect(() => {
    let active = true;
    fetch("/api/agent/capabilities", { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || "MCP 能力清单暂时不可用");
      if (active) setCapabilities(result);
    }).catch((error) => { if (active) setCapabilityError(error?.message || "MCP 能力清单暂时不可用"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setChartLoading(true); setChartError("");
    loadKlines(selected.strategy as RegisteredStrategyKey, selected.candidate.symbol, selected.strategy.includes("dualma") ? "4H" : "1H").then((items) => { if (active) setSelectedCandles(items); }).catch((error) => { if (active) { setSelectedCandles([]); setChartError(error?.message || "K 线读取失败"); } }).finally(() => { if (active) setChartLoading(false); });
    return () => { active = false; };
  }, [selected]);

  const selectedStrategy = strategy || capabilities?.strategies[0]?.key || "";
  const toolLabels = Object.fromEntries((capabilities?.tools || []).map((tool) => [tool.name, tool.title || tool.name]));
  const presets = [...new Set([...GENERIC_PRESETS, ...(capabilities?.strategies || []).map((item) => `${item.name}有哪些候选？`)])];

  function updateMessage(id: number, patch: Partial<Message>) { setMessages((current) => current.map((message) => message.id === id ? { ...message, ...patch } : message)); }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || pending) return;
    setMessages((current) => [...current, { id: Date.now(), role: "user", text: message }]); setInput(""); setPending(true); setWorkflowState("analyzing");
    try {
      const response = await fetch("/api/agent/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, strategy: selectedStrategy || undefined }), cache: "no-store" });
      const result = await response.json();
      const opportunities = result.opportunities || [];
      setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", strategy: result.strategy || selectedStrategy, text: result.reply || result.error || "Agent 没有返回可显示的结果。", trace: result.toolTrace || [], evidence: result.evidence, opportunities, error: !response.ok || result.ok === false }]);
      setWorkflowState(opportunities.length ? "scored" : "scored");
    } catch (error: any) { setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", text: `Agent 请求失败：${error?.message || "请检查本地 worker 是否运行"}`, trace: [], error: true }]); setWorkflowState("idle"); }
    finally { setPending(false); }
  }

  async function preparePaper(messageId: number, strategyKey: string, candidate: PaperPlan) {
    const key = `${messageId}:${candidateKey(candidate)}:prepare`; setActionKey(key); setWorkflowState("risk");
    try {
      const response = await fetch("/api/agent/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ strategy: strategyKey, candidate, intent: `为 ${candidate.symbol} 生成 Paper 交易计划` }), cache: "no-store" });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || "Paper 计划生成失败");
      updateMessage(messageId, { planRun: { runId: result.runId, paperPlan: result.paperPlan, decision: result.decision, events: result.events } });
    } catch (error: any) { updateMessage(messageId, { planRun: { runId: "error", decision: { pass: false, reasons: [error?.message || "Paper 计划生成失败"] } } }); }
    finally { setActionKey(""); }
  }

  async function confirmPaper(messageId: number, strategyKey: string, candidate: PaperPlan) {
    const key = `${messageId}:${candidateKey(candidate)}:confirm`; setActionKey(key); setWorkflowState("paper");
    try {
      const response = await fetch("/api/agent/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ strategy: strategyKey, candidate }), cache: "no-store" });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || "Paper 确认失败");
      updateMessage(messageId, { execution: result.paperExecution }); setWorkflowState("audit");
    } catch (error: any) { updateMessage(messageId, { execution: { status: "error", symbol: candidate.symbol, direction: candidate.direction, openedCount: 0, message: error?.message || "Paper 确认失败" } }); setWorkflowState("risk"); }
    finally { setActionKey(""); }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }

  const activeStage = workflowState === "idle" || workflowState === "analyzing" ? 0 : workflowState === "scored" || workflowState === "researching" ? 1 : workflowState === "risk" ? 2 : workflowState === "paper" ? 3 : 4;
  const currentRole = WORKFLOW_STAGES[activeStage];

  return <AppShell title="Agent 对话" eyebrow="MCP AGENT CONTROL">
    <div className="agent-chat-layout">
      <section className="agent-chat-card">
        <div className="agent-chat-head"><div><span className="page-eyebrow">REAL TOOL CALLING</span><h2>从一句话到可审计的 Paper 决策</h2><p>Agent 会按角色协作：先读行情，再做策略判断，经过风险检查，最后才允许写入本地模拟账本。</p></div><div className="mcp-live-mark"><span className="status-dot" />{capabilities ? "LOCAL MCP CONNECTED" : "MCP LOADING"}</div></div>
        <div className="agent-workflow-strip" aria-label="Agent 工作流程">{WORKFLOW_STAGES.map((stage, index) => { const complete = index < activeStage; const active = index === activeStage; return <div className={`agent-workflow-step ${complete ? "complete" : ""} ${active ? "active" : ""}`} key={stage.key}><span className="workflow-step-index">{complete ? "✓" : String(index + 1).padStart(2, "0")}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div>{index < WORKFLOW_STAGES.length - 1 ? <i>→</i> : null}</div>; })}</div>
        <div className="chat-message-list" aria-live="polite">
          {messages.map((message) => <article key={message.id} className={`chat-message ${message.role} ${message.error ? "has-error" : ""}`}>
            <div className="chat-avatar">{message.role === "assistant" ? "✦" : "你"}</div><div className="chat-message-content"><div className="chat-message-meta">{message.role === "assistant" ? "BINANCE MCP AGENT" : "YOU"}</div><div className="chat-bubble">{message.text}</div>
              {message.role === "assistant" && message.evidence ? <div className="chat-evidence"><span><b>{message.evidence.candidateCount ?? "—"}</b> 候选</span><span><b>{message.evidence.positionCount ?? "—"}</b> 持仓</span><span>数据 {formatTime(message.evidence.asOf)}</span></div> : null}
              {message.role === "assistant" && message.opportunities?.length ? <div className="agent-opportunity-board"><div className="agent-board-head"><div><span className="table-kicker">STRUCTURED OPPORTUNITIES</span><strong>从扫描结果中选择研究对象</strong></div><small>{message.opportunities.length} 个可解释候选</small></div><div className="agent-opportunity-grid">{message.opportunities.map((candidate) => { const key = `${message.id}:${candidateKey(candidate)}`; const active = selected?.key === key; return <button type="button" className={`agent-opportunity-card ${active ? "selected" : ""}`} key={key} onClick={() => { setSelected({ key, candidate, strategy: message.strategy || selectedStrategy }); setWorkflowState("researching"); }}><span className="opportunity-card-top"><strong>{shortSymbol(candidate.symbol)}/USDT</strong><span className={`direction-pill ${candidate.direction}`}>{candidate.direction === "long" ? "LONG" : "SHORT"}</span></span><span className="opportunity-card-meta"><span>{candidate.reason || "策略条件满足"}</span><b>{candidate.score ?? "—"}<small> SCORE</small></b></span><span className="opportunity-card-price">参考价 {money(Number(candidate.entryPrice || 0), Number(candidate.entryPrice || 0) < 10 ? 4 : 2)} <i>点击看 K 线 →</i></span></button>; })}</div></div> : null}
              {selected && selected.key.startsWith(`${message.id}:`) ? <div className="agent-candidate-detail"><div className="agent-detail-heading"><div><span className="table-kicker">CANDIDATE INSPECTOR</span><strong>{shortSymbol(selected.candidate.symbol)}/USDT · {selected.candidate.direction === "long" ? "做多" : "做空"}</strong><small>{selected.candidate.reason} · 综合评分 {selected.candidate.score ?? "—"}</small></div><button type="button" className="close-button" onClick={() => setSelected(null)} aria-label="关闭候选详情">×</button></div>{chartLoading ? <div className="chart-loading">正在读取 {shortSymbol(selected.candidate.symbol)} K 线…</div> : selectedCandles.length ? <TradeChart candles={selectedCandles} trade={planOverlay(selected.candidate, selectedCandles)} height={250} /> : <div className="chart-loading">K 线暂时不可用。{chartError ? `（${chartError}）` : ""}</div>}<div className="agent-plan-metrics"><div><span>计划入场</span><strong>{money(Number(selected.candidate.entryPrice || 0), Number(selected.candidate.entryPrice || 0) < 10 ? 4 : 2)}</strong></div><div><span>止损</span><strong>{money(Number(selected.candidate.stopPrice || 0), Number(selected.candidate.stopPrice || 0) < 10 ? 4 : 2)}</strong></div><div><span>止盈</span><strong>{money(Number(selected.candidate.targetPrice || 0), Number(selected.candidate.targetPrice || 0) < 10 ? 4 : 2)}</strong></div></div><div className="agent-action-row"><button type="button" className="outline-button" disabled={actionKey !== ""} onClick={() => void preparePaper(message.id, message.strategy || selectedStrategy, selected.candidate)}>{actionKey.endsWith(":prepare") ? "生成中…" : "生成 Paper 计划"}</button>{message.planRun?.runId && message.planRun.runId !== "error" ? <button type="button" className="primary-button" disabled={actionKey !== "" || message.planRun.decision?.pass === false} onClick={() => void confirmPaper(message.id, message.strategy || selectedStrategy, selected.candidate)}>{actionKey.endsWith(":confirm") ? "写入中…" : "确认加入 Paper"}</button> : null}</div>{message.planRun ? <div className={`agent-gate-result ${message.planRun.decision?.pass === false ? "blocked" : "passed"}`}><strong>{message.planRun.decision?.pass === false ? "RISK GATE BLOCKED" : "RISK GATE PASS"}</strong><span>{message.planRun.decision?.reasons?.join(" · ") || `审计记录 ${message.planRun.runId}`}</span></div> : null}{message.execution ? <div className={`agent-execution-result ${message.execution.status === "opened" ? "opened" : "blocked"}`}><strong>{message.execution.status === "opened" ? "PAPER POSITION ADDED" : "PAPER ACTION RECORDED"}</strong><span>{message.execution.message}</span></div> : null}</div> : null}
              {message.planRun?.events?.length ? <div className="agent-role-timeline"><div className="mcp-trace-title"><span>AGENT ROLE HANDOFF</span><small>{message.planRun.events.length} stages</small></div>{message.planRun.events.map((event) => <div className="agent-role-event" key={`${message.id}-${event.phase}`}><span className={`role-event-dot ${event.status}`} /> <div><strong>{event.phase}</strong><p>{event.detail}</p></div></div>)}</div> : null}
              {message.role === "assistant" && message.trace?.length ? <div className="mcp-trace"><div className="mcp-trace-title"><span>真实 MCP TOOL TRACE</span><small>{message.trace.length} tools</small></div>{message.trace.map((trace) => <div className="mcp-trace-row" key={`${message.id}-${trace.name}`}><span className={`trace-status ${trace.status}`} /><strong>{toolLabels[trace.name] || trace.name}</strong><span>{trace.resultSummary || "调用完成"}</span><small>{formatTime(trace.asOf)}</small></div>)}</div> : null}
            </div>
          </article>)}
          {pending ? <div className="chat-loading"><span className="loading-dots"><i /><i /><i /></span>Agent 正在调用 MCP 工具…</div> : null}
        </div>
        <form className="agent-composer" onSubmit={sendMessage}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="问 Agent：扫描全市场，找出最值得研究的机会" rows={2} disabled={pending} /><button type="submit" disabled={pending || !input.trim()} aria-label="发送消息">{pending ? "…" : "↑"}</button></form><div className="composer-note">Enter 发送 · Shift + Enter 换行　|　只读行情 · Paper 模拟执行 · broadcast=false</div>
      </section>
      <aside className="agent-chat-rail">
        <section className="chat-rail-panel current-role-panel"><div className="rail-kicker">CURRENT AGENT ROLE</div><div className="current-role-icon">{activeStage + 1}</div><h3>{currentRole.role}</h3><p>{currentRole.label} · {currentRole.detail}</p><span className="role-state"><i />{workflowState === "idle" ? "等待你的任务" : workflowState === "analyzing" ? "正在调用工具" : workflowState === "audit" ? "流程已审计" : "工作流进行中"}</span></section>
        <section className="chat-rail-panel"><div className="rail-kicker">STRATEGY CONTEXT</div><h3>当前分析策略</h3><div className="strategy-switcher">{capabilities?.strategies.map((item, index) => <button key={item.key} type="button" className={selectedStrategy === item.key ? "selected" : ""} onClick={() => setStrategy(item.key)}><span>{String(index + 1).padStart(2, "0")}</span>{item.name}<b>{selectedStrategy === item.key ? "✓" : ""}</b></button>)}{!capabilities ? <div className="capability-loading">{capabilityError || "正在读取 MCP 策略清单…"}</div> : null}</div></section>
        <section className="chat-rail-panel"><div className="rail-kicker">MCP CAPABILITIES</div><h3>Agent 可调用能力</h3><div className="capability-list">{(capabilities?.tools || []).map((tool) => <span key={tool.name}><b>{tool.title || tool.name}</b><small>{tool.name}</small></span>)}{!capabilities ? <div className="capability-loading">能力清单加载中…</div> : null}</div></section>
        {capabilities?.officialMcp ? <section className="chat-rail-panel official-mcp-panel"><div className="rail-kicker">OFFICIAL BINANCE MCP</div><h3>{capabilities.officialMcp.name}</h3><div className="official-mcp-status"><span className="status-dot" />AUTH REQUIRED</div><p>官方服务端点</p><code>{capabilities.officialMcp.endpoint}</code><small>{capabilities.officialMcp.note}</small><a href={capabilities.officialMcp.docsUrl} target="_blank" rel="noreferrer">查看官方连接文档 ↗</a></section> : null}
        <section className="chat-rail-panel"><div className="rail-kicker">TRY ASKING</div><h3>快速开始</h3><div className="preset-list">{presets.map((preset) => <button type="button" key={preset} onClick={() => setInput(preset)}>{preset}<span>↗</span></button>)}</div></section>
        <section className="chat-safety-panel"><div className="safety-lock">▣</div><div><strong>PAPER ONLY</strong><p>Agent 只写入本地模拟账本，所有计划都带风险闸门和审计记录，不会发送真实订单。</p></div><div className="safety-facts"><span>✓ Dynamic MCP tools</span><span>✓ K-line inspector</span><span>✓ broadcast=false</span></div></section>
      </aside>
    </div>
  </AppShell>;
}
