"use client";

import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
import AppShell from "./AppShell";

type StrategyKey = string;
type StrategyOption = { key: StrategyKey; name: string; desc?: string; kind?: string; source?: string };
type ToolOption = { name: string; title?: string; description?: string };
type OfficialMcp = { name: string; endpoint: string; docsUrl: string; status: string; scopes: string[]; note: string };
type Capabilities = { server?: { name: string; version: string }; officialMcp?: OfficialMcp; strategies: StrategyOption[]; tools: ToolOption[] };
type Trace = { name: string; status: "ok" | "error"; resultSummary?: string; asOf?: string | null };
type Evidence = { source?: string; asOf?: string | null; candidateCount?: number; positionCount?: number };
type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  trace?: Trace[];
  evidence?: Evidence;
  error?: boolean;
};

const GENERIC_PRESETS = [
  "Binance MCP 目前能做什么？",
  "15分钟内OI上升的代币有哪些？",
  "查看 BTCUSDT 的 K线和 OI",
  "当前 Paper 持仓和风险怎么样？",
];

function formatTime(value?: string | null) {
  if (!value) return "等待最新数据";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AgentChatPage() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [strategy, setStrategy] = useState<StrategyKey>("");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: "assistant",
      text: "你好，我是 Binance MCP Strategy Agent。你可以直接询问市场、策略、K线、OI、Paper、风险和审计能力；每次回答都会展示实际调用的 MCP 工具。",
      trace: [],
    },
  ]);

  useEffect(() => {
    let active = true;
    fetch("/api/agent/capabilities", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || result.ok === false) throw new Error(result.error || "MCP 能力清单暂时不可用");
        if (active) setCapabilities(result);
      })
      .catch((error) => {
        if (active) setCapabilityError(error?.message || "MCP 能力清单暂时不可用");
      });
    return () => { active = false; };
  }, []);

  const selectedStrategy = strategy || capabilities?.strategies[0]?.key || "";
  const toolLabels = Object.fromEntries((capabilities?.tools || []).map((tool) => [tool.name, tool.title || tool.name]));
  const presets = [...new Set([
    ...GENERIC_PRESETS,
    ...(capabilities?.strategies || []).map((item) => `${item.name}有哪些候选？`),
  ])];

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || pending) return;
    const userMessage: Message = { id: Date.now(), role: "user", text: message };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setPending(true);
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, strategy: selectedStrategy || undefined }),
        cache: "no-store",
      });
      const result = await response.json();
      setMessages((current) => [...current, {
        id: Date.now() + 1,
        role: "assistant",
        text: result.reply || result.error || "Agent 没有返回可显示的结果。",
        trace: result.toolTrace || [],
        evidence: result.evidence,
        error: !response.ok || result.ok === false,
      }]);
    } catch (error: any) {
      setMessages((current) => [...current, {
        id: Date.now() + 1,
        role: "assistant",
        text: `Agent 请求失败：${error?.message || "请检查本地 worker 是否运行"}`,
        trace: [],
        error: true,
      }]);
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <AppShell title="Agent 对话" eyebrow="MCP AGENT CONTROL">
      <div className="agent-chat-layout">
        <section className="agent-chat-card">
          <div className="agent-chat-head">
            <div>
              <span className="page-eyebrow">REAL TOOL CALLING</span>
              <h2>让 Agent 调用整个 Binance MCP</h2>
              <p>Agent 会先读取 MCP 能力清单，再根据你的问题选择策略和工具。</p>
            </div>
            <div className="mcp-live-mark"><span className="status-dot" />{capabilities ? "LOCAL MCP CONNECTED" : "MCP LOADING"}</div>
          </div>

          <div className="chat-message-list" aria-live="polite">
            {messages.map((message) => (
              <article key={message.id} className={`chat-message ${message.role} ${message.error ? "has-error" : ""}`}>
                <div className="chat-avatar">{message.role === "assistant" ? "✦" : "你"}</div>
                <div className="chat-message-content">
                  <div className="chat-message-meta">{message.role === "assistant" ? "BINANCE MCP AGENT" : "YOU"}</div>
                  <div className="chat-bubble">{message.text}</div>
                  {message.role === "assistant" && message.evidence ? (
                    <div className="chat-evidence">
                      <span><b>{message.evidence.candidateCount ?? "—"}</b> 候选</span>
                      <span><b>{message.evidence.positionCount ?? "—"}</b> 持仓</span>
                      <span>数据 {formatTime(message.evidence.asOf)}</span>
                    </div>
                  ) : null}
                  {message.role === "assistant" && message.trace?.length ? (
                    <div className="mcp-trace">
                      <div className="mcp-trace-title"><span>真实 MCP TOOL TRACE</span><small>{message.trace.length} tools</small></div>
                      {message.trace.map((trace) => (
                        <div className="mcp-trace-row" key={`${message.id}-${trace.name}`}>
                          <span className={`trace-status ${trace.status}`} />
                          <strong>{toolLabels[trace.name] || trace.name}</strong>
                          <span>{trace.resultSummary || "调用完成"}</span>
                          <small>{formatTime(trace.asOf)}</small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
            {pending ? <div className="chat-loading"><span className="loading-dots"><i /><i /><i /></span>Agent 正在调用 MCP 工具…</div> : null}
          </div>

          <form className="agent-composer" onSubmit={sendMessage}>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="问 Agent：15分钟内 OI 上升的合约有哪些？" rows={2} disabled={pending} />
            <button type="submit" disabled={pending || !input.trim()} aria-label="发送消息">{pending ? "…" : "↑"}</button>
          </form>
          <div className="composer-note">Enter 发送 · Shift + Enter 换行　|　只读行情 · Paper 模拟执行 · broadcast=false</div>
        </section>

        <aside className="agent-chat-rail">
          <section className="chat-rail-panel">
            <div className="rail-kicker">STRATEGY CONTEXT</div>
            <h3>当前分析策略</h3>
            <div className="strategy-switcher">
              {capabilities?.strategies.map((item, index) => (
                <button key={item.key} type="button" className={selectedStrategy === item.key ? "selected" : ""} onClick={() => setStrategy(item.key)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>{item.name}<b>{selectedStrategy === item.key ? "✓" : ""}</b>
                </button>
              ))}
              {!capabilities ? <div className="capability-loading">{capabilityError || "正在读取 MCP 策略清单…"}</div> : null}
            </div>
          </section>

          <section className="chat-rail-panel">
            <div className="rail-kicker">MCP CAPABILITIES</div>
            <h3>Agent 可调用能力</h3>
            <div className="capability-list">
              {(capabilities?.tools || []).map((tool) => <span key={tool.name}><b>{tool.title || tool.name}</b><small>{tool.name}</small></span>)}
              {!capabilities ? <div className="capability-loading">能力清单加载中…</div> : null}
            </div>
          </section>

          {capabilities?.officialMcp ? (
            <section className="chat-rail-panel official-mcp-panel">
              <div className="rail-kicker">OFFICIAL BINANCE MCP</div>
              <h3>{capabilities.officialMcp.name}</h3>
              <div className="official-mcp-status"><span className="status-dot" />AUTH REQUIRED</div>
              <p>官方服务端点</p>
              <code>{capabilities.officialMcp.endpoint}</code>
              <small>{capabilities.officialMcp.note}</small>
              <a href={capabilities.officialMcp.docsUrl} target="_blank" rel="noreferrer">查看官方连接文档 ↗</a>
            </section>
          ) : null}

          <section className="chat-rail-panel">
            <div className="rail-kicker">TRY ASKING</div>
            <h3>快速开始</h3>
            <div className="preset-list">
              {presets.map((preset) => <button type="button" key={preset} onClick={() => setInput(preset)}>{preset}<span>↗</span></button>)}
            </div>
          </section>

          <section className="chat-safety-panel">
            <div className="safety-lock">▣</div>
            <div><strong>PAPER ONLY</strong><p>Agent 可以调用 Binance MCP 的只读研究工具和本地 Paper 工具，不会连接真实账户。</p></div>
            <div className="safety-facts"><span>✓ Dynamic MCP tools</span><span>✓ Tool trace</span><span>✓ broadcast=false</span></div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
