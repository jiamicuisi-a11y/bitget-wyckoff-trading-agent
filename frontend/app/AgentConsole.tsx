"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Summary = {
  key: string;
  name: string;
  desc: string;
  source: string;
  paper: { minScoreToOpen?: number; leverage?: number; stopPct?: number; targetR?: number };
  summary: {
    initialCapital?: number;
    equity: number;
    cash?: number;
    floating?: number;
    totalReturnPct: number;
    avgDailyPnl: number;
    winRate: number;
    tradeCount: number;
    openCount: number;
    maxDrawdownPct?: number;
  };
};

type Hit = {
  symbol: string;
  score: number;
  direction: "long" | "short";
  tag: string;
  lastPrice: number;
  change24hPct?: number;
  oiChangePct?: number | null;
  fundingRate?: number;
};

type Position = {
  id: number;
  symbol: string;
  direction: "long" | "short";
  tag: string;
  entry_price: number;
  currentPrice: number;
  floatPnlUsd: number;
  floatPnlPct: number;
  open_time: number;
};

type ClosedTrade = {
  id: number;
  symbol: string;
  direction: "long" | "short";
  tag: string;
  exit_reason: string;
  pnl_usd: number;
  pnl_pct: number;
  exit_time: number;
};

type AgentState = {
  strategy: string;
  stats: {
    initialCapital: number;
    equity: number;
    cash: number;
    floating: number;
    realizedPnl: number;
    totalReturnPct: number;
    avgDailyPnl: number;
    runningDays: number;
    tradeCount: number;
    openCount: number;
    wins: number;
    losses: number;
    winRate: number;
    maxDrawdownPct: number;
  };
  positions: Position[];
  recentClosed: ClosedTrade[];
  latestScan: {
    hits: Hit[];
    scannedCount: number;
    candidateCount?: number;
    openedCount?: number;
    scannedAt: string | null;
  };
  config: { scanIntervalSec: number };
};

type EquityPoint = { ts: number; equity: number; cash: number; open_count: number };

type WorkflowEvent = {
  id: number;
  phase: string;
  detail: string;
  status: "queued" | "active" | "done";
  demo?: boolean;
  ts: number;
};

type AgentRunResponse = {
  ok: boolean;
  runId: string;
  strategy: string;
  source: string;
  intent: string;
  mode: "paper";
  tools: Array<{ name: string; status: string }>;
  decision: {
    liveCandidateCount: number;
    eligibleCandidateCount: number;
    selectedPlanCount: number;
    authorized: boolean;
    requiresHumanConfirmation: boolean;
    broadcast: boolean;
  };
  paperPlan: Array<{ symbol: string; direction: string; status: string; broadcast: boolean }>;
  events: WorkflowEvent[];
};

type NavSection = "overview" | "market-radar" | "strategy-lab" | "risk-gate" | "run-records" | "permissions";
type ChartPeriod = "24H" | "7D" | "30D";

const SEED_SUMMARIES: Summary[] = [
  {
    key: "anomaly-binance",
    name: "A档异动扫描",
    desc: "OI、成交额、盘口与资金费率的多因子异动雷达",
    source: "Binance Futures",
    paper: { minScoreToOpen: 48, leverage: 3, stopPct: 3, targetR: 2 },
    summary: { equity: 10386.2, totalReturnPct: 3.86, avgDailyPnl: 42.4, winRate: 61.5, tradeCount: 26, openCount: 2 },
  },
  {
    key: "dualma4h-binance",
    name: "双均线 · 4H",
    desc: "EMA(10/30) 交叉捕捉 Binance 永续趋势段",
    source: "Binance Futures",
    paper: { minScoreToOpen: 50, leverage: 3, stopPct: 3, targetR: 2 },
    summary: { equity: 10872.6, totalReturnPct: 8.73, avgDailyPnl: 61.9, winRate: 58.3, tradeCount: 19, openCount: 1 },
  },
];

const SEED_HITS: Hit[] = [
  { symbol: "ETHUSDT", score: 82, direction: "long", tag: "多头共振", lastPrice: 4318.2, change24hPct: 4.82, oiChangePct: 6.4, fundingRate: 0.0008 },
  { symbol: "SOLUSDT", score: 71, direction: "long", tag: "主动买领先多", lastPrice: 218.46, change24hPct: 2.18, oiChangePct: 3.1, fundingRate: 0.0004 },
  { symbol: "XRPUSDT", score: 64, direction: "short", tag: "大户领先做空", lastPrice: 2.841, change24hPct: -1.12, oiChangePct: 4.7, fundingRate: -0.0002 },
  { symbol: "BNBUSDT", score: 58, direction: "long", tag: "主动买领先多", lastPrice: 704.12, change24hPct: 1.46, oiChangePct: 1.8, fundingRate: 0.0001 },
];

const DEMO_POSITIONS: Position[] = [
  { id: 9001, symbol: "ETHUSDT", direction: "long", tag: "多头共振 · DEMO", entry_price: 4208, currentPrice: 4318.2, floatPnlUsd: 48.2, floatPnlPct: 2.61, open_time: Date.now() - 7200_000 },
  { id: 9002, symbol: "SOLUSDT", direction: "long", tag: "EMA 金叉 · DEMO", entry_price: 214.3, currentPrice: 218.46, floatPnlUsd: 31.4, floatPnlPct: 1.94, open_time: Date.now() - 14400_000 },
];

const DEMO_DUALMA_HITS: Hit[] = [
  { symbol: "ETHUSDT", score: 60, direction: "long", tag: "EMA 金叉", lastPrice: 4318.2, change24hPct: 4.82 },
  { symbol: "SOLUSDT", score: 60, direction: "long", tag: "EMA 金叉", lastPrice: 218.46, change24hPct: 2.18 },
  { symbol: "XRPUSDT", score: 60, direction: "short", tag: "EMA 死叉", lastPrice: 2.841, change24hPct: -1.12 },
  { symbol: "BNBUSDT", score: 60, direction: "long", tag: "EMA 金叉", lastPrice: 704.12, change24hPct: 1.46 },
];

const DEMO_DUALMA_POSITIONS: Position[] = DEMO_POSITIONS.map((position) => ({
  ...position,
  tag: position.symbol === "SOLUSDT" ? "EMA 金叉 · DEMO" : "EMA 趋势段 · DEMO",
}));

const SEED_EQUITY: EquityPoint[] = Array.from({ length: 24 }, (_, i) => ({
  ts: Date.now() - (23 - i) * 3600_000,
  equity: 10000 + i * 16 + Math.sin(i * 0.8) * 34 + (i > 15 ? (i - 15) * 9 : 0),
  cash: 10000 + i * 11,
  open_count: i % 7 === 2 ? 2 : i % 5 === 0 ? 1 : 0,
}));

function money(value: number, digits = 2) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function pct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function timeLabel(value: number | string | null) {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value : value);
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function Icon({ name }: { name: "grid" | "radar" | "chart" | "shield" | "book" | "settings" | "arrow" | "spark" }) {
  const paths: Record<string, string> = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    radar: "M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l6-6",
    chart: "M4 19V5M4 19h16M7 15l3-4 3 2 5-7",
    shield: "M12 3l7 3v5c0 4.5-2.8 7.7-7 10-4.2-2.3-7-5.5-7-10V6l7-3zM9 12l2 2 4-4",
    book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM8 20V7a3 3 0 0 1 3-3",
    settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v3m0 8v3m0 5v-3M3 12h3m8 0h3m5 0h-3M5.6 5.6l2.1 2.1m6.6 6.6l2.1 2.1m0-10.8l-2.1 2.1m-6.6 6.6l-2.1 2.1",
    arrow: "M5 12h13m-5-5 5 5-5 5",
    spark: "M12 3l1.3 5.7L19 10l-5.7 1.3L12 17l-1.3-5.7L5 10l5.7-1.3L12 3z",
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export default function AgentConsole() {
  const [summaries, setSummaries] = useState<Summary[]>(SEED_SUMMARIES);
  const [active, setActive] = useState("anomaly-binance");
  const [state, setState] = useState<AgentState | null>(null);
  const [equity, setEquity] = useState<EquityPoint[]>(SEED_EQUITY);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [prompt, setPrompt] = useState("扫描 Binance 永续市场，找出风险收益比最好的机会");
  const [agentNote, setAgentNote] = useState("Agent 已完成上一次扫描，等待你的下一条指令。");
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [demoRun, setDemoRun] = useState(false);
  const [lastAgentRun, setLastAgentRun] = useState<AgentRunResponse | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>("overview");
  const [showAllOpportunities, setShowAllOpportunities] = useState(false);
  const [period, setPeriod] = useState<ChartPeriod>("24H");
  const [paperConfirmed, setPaperConfirmed] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showConnectionInfo, setShowConnectionInfo] = useState(false);
  const runToken = useRef(0);

  const navItems: Array<{ id: NavSection; label: string; icon: "grid" | "radar" | "chart" | "shield" | "book" | "settings" }> = [
    { id: "overview", label: "总览", icon: "grid" },
    { id: "market-radar", label: "市场雷达", icon: "radar" },
    { id: "strategy-lab", label: "策略实验室", icon: "chart" },
    { id: "risk-gate", label: "风险闸门", icon: "shield" },
    { id: "run-records", label: "运行记录", icon: "book" },
    { id: "permissions", label: "权限与连接", icon: "settings" },
  ];

  function goToSection(section: NavSection) {
    setActiveSection(section);
    document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const loadData = useCallback(async (strategy = active) => {
    setLoading(true);
    try {
      const summaryRes = await fetch("/api/paper?view=strategies", { cache: "no-store" });
      const summaryJson = await summaryRes.json();
      if (summaryRes.ok && Array.isArray(summaryJson.strategies)) {
        const next = (summaryJson.strategies as Summary[]).filter((s) => s.source === "binance" || s.key.includes("binance"));
        if (next.length > 0) setSummaries(next);
      }
      const [stateRes, equityRes] = await Promise.all([
        fetch(`/api/paper?view=state&strategy=${strategy}`, { cache: "no-store" }),
        fetch(`/api/paper?view=equity&strategy=${strategy}`, { cache: "no-store" }),
      ]);
      const nextState = await stateRes.json();
      const nextEquity = await equityRes.json();
      if (stateRes.ok && !nextState.workerOffline) {
        setState(nextState as AgentState);
        setLive(true);
      }
      if (equityRes.ok && Array.isArray(nextEquity.curve) && nextEquity.curve.length > 1) {
        setEquity(nextEquity.curve as EquityPoint[]);
      }
    } catch {
      setLive(false);
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    loadData();
    const timer = window.setInterval(() => loadData(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const current = useMemo(() => summaries.find((s) => s.key === active) || summaries[0], [active, summaries]);
  const activeState = state?.strategy === active ? state : null;
  const liveHits = activeState?.latestScan?.hits || [];
  const demoVisible = demoRun && liveHits.length === 0;
  const demoHits = active === "dualma4h-binance" ? DEMO_DUALMA_HITS : SEED_HITS;
  const hits = activeState ? (demoVisible || liveHits.length === 0 ? demoHits : liveHits) : demoHits;
  const stats = activeState?.stats || current.summary;
  const positions = activeState?.positions || [];
  const recentClosed = activeState?.recentClosed || [];
  const demoPositions = active === "dualma4h-binance" ? DEMO_DUALMA_POSITIONS : DEMO_POSITIONS;
  const displayPositions = demoVisible ? demoPositions : activeState ? positions : demoPositions;
  const displayClosed = activeState && !demoVisible ? recentClosed : [{ id: 1, symbol: "AGENT-RUN", direction: "long", tag: "Paper workflow", exit_reason: "等待人工确认", pnl_usd: 0, pnl_pct: 0, exit_time: Date.now() } as ClosedTrade];
  const scannedCount = activeState ? (activeState.latestScan?.scannedCount ?? 0) : 482;
  const candidateCount = activeState ? (demoVisible || liveHits.length === 0 ? demoHits.length : activeState.latestScan?.candidateCount ?? 0) : demoHits.length;
  const sourceLabel = activeState ? (demoVisible || liveHits.length === 0 ? "Binance Futures · live data + local demo" : "Binance Futures · live public data") : "Binance Futures · demo snapshot";

  async function runAgent() {
    if (agentRunning) return;
    const token = runToken.current + 1;
    runToken.current = token;
    setAgentRunning(true);
    setDemoRun(false);
    setPaperConfirmed(false);
    setAgentNote(`已接收指令：${prompt || "运行默认扫描"}。Agent 正在执行五步工作流。`);
    setWorkflowEvents([]);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategy: active, intent: prompt || "运行默认扫描" }),
        cache: "no-store",
      });
      const result = await response.json() as AgentRunResponse & { error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Agent Tool Layer 执行失败");
      if (runToken.current !== token) return;
      setLastAgentRun(result);
      setDemoRun(result.decision.liveCandidateCount === 0);
      const events: WorkflowEvent[] = result.events.map((event, index) => ({ ...event, status: (index === 0 ? "active" : "queued") as WorkflowEvent["status"] }));
      setWorkflowEvents(events);
      events.forEach((_, index) => {
        window.setTimeout(() => {
          if (runToken.current !== token) return;
          setWorkflowEvents((currentEvents) => currentEvents.map((event, eventIndex) => ({ ...event, status: eventIndex < index ? "done" : eventIndex === index ? "active" : "queued" })));
          if (index === events.length - 1) {
            setWorkflowEvents((currentEvents) => currentEvents.map((event) => ({ ...event, status: "done" })));
            setAgentRunning(false);
            setAgentNote(`工具层执行完成：${result.decision.liveCandidateCount ? `保留 ${result.decision.liveCandidateCount} 个实时候选` : "当前无达标实时信号，页面展示本地演示候选"}。Risk Gate 要求人工确认，broadcast=false。`);
            loadData(active);
          }
        }, 360 * (index + 1));
      });
    } catch (error: any) {
      if (runToken.current !== token) return;
      setAgentRunning(false);
      setAgentNote(`Agent Tool Layer 调用失败：${error?.message || "未知错误"}。请检查 Paper worker。`);
      setWorkflowEvents([{ id: Date.now(), phase: "ERROR · Tool Layer", detail: error?.message || "Agent Tool Layer 执行失败", status: "done", ts: Date.now() }]);
    }
  }

  const curveSource = equity.length > 1 ? equity : SEED_EQUITY;
  const curve = period === "24H" ? curveSource.slice(-24) : period === "7D" ? curveSource.slice(-168) : curveSource;
  const curveMin = Math.min(...curve.map((p) => p.equity));
  const curveMax = Math.max(...curve.map((p) => p.equity));
  const curveRange = curveMax - curveMin || 1;
  const curvePath = curve.map((point, index) => {
    const x = (index / (curve.length - 1)) * 100;
    const y = 92 - ((point.equity - curveMin) / curveRange) * 72;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");

  return (
    <div className="agent-shell">
      <aside className="agent-sidebar">
        <div className="agent-brand">
          <div className="brand-glyph"><Icon name="spark" /></div>
          <div><strong>Agent OS</strong><span>Strategy Copilot</span></div>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="agent-nav">
          {navItems.slice(0, 5).map((item) => (
            <button key={item.id} className={`nav-item ${activeSection === item.id ? "active" : ""}`} onClick={() => goToSection(item.id)}>
              <Icon name={item.icon} />{item.label}{item.id === "overview" && activeSection === "overview" ? <span className="nav-dot" /> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-section-label">SYSTEM</div>
        <nav className="agent-nav">
          <button className={`nav-item ${activeSection === "permissions" ? "active" : ""}`} onClick={() => goToSection("permissions")}>
            <Icon name="settings" />权限与连接
          </button>
        </nav>

        <div className="sidebar-bottom">
          <button className="connection-card connection-card-button" onClick={() => { setShowConnectionInfo((current) => !current); goToSection("permissions"); }}>
            <div className="connection-top"><span className="status-pulse" />{live ? "数据连接正常" : "演示数据模式"}</div>
            <span>Binance public market data</span>
          </button>
          <div className="paper-lock"><span>⟐</span><div><strong>PAPER MODE</strong><small>模拟盘已锁定，永不触碰真钱</small></div></div>
        </div>
      </aside>

      <main className="agent-main">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><Icon name="arrow" /><strong>Agent command center</strong></div>
          <div className="topbar-actions"><span className="data-source"><span className="status-pulse" />{sourceLabel}</span><button className="avatar" aria-label="打开权限摘要" onClick={() => setShowProfile((current) => !current)}>J</button>{showProfile ? <div className="profile-popover"><strong>当前运行边界</strong><span>Binance public market data</span><span>Paper execution only</span><span>broadcast=false · 无提现权限</span></div> : null}</div>
        </header>

        <div className="content-wrap">
          <section id="overview" className="agent-hero">
            <div className="hero-copy">
              <div className="eyebrow"><span className="live-dot" />AGENT ONLINE <span className="divider" /> PAPER WORKFLOW</div>
              <h1>让策略思考，<br /><em>让你确认。</em></h1>
              <p>一个面向 Binance Agent OS 的交易智能体。它把市场感知、策略信号与风险闸门串成一条可解释、可审计的执行链。</p>
              <div className="hero-actions"><button className="primary-action" onClick={runAgent} disabled={agentRunning}><Icon name="spark" />{agentRunning ? "Agent 执行中…" : "运行一次 Agent 扫描"}</button><button className="secondary-action" onClick={() => loadData(active)} disabled={agentRunning}>刷新数据 <Icon name="arrow" /></button></div>
            </div>
            <div className="agent-orbit" aria-hidden="true"><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="orbit-core"><Icon name="spark" /><span>OS</span></div><span className="orbit-label label-market">MARKET<br /><b>感知</b></span><span className="orbit-label label-strategy">STRATEGY<br /><b>决策</b></span><span className="orbit-label label-risk">RISK GATE<br /><b>确认</b></span></div>
          </section>

          <section className={`command-bar ${agentRunning ? "is-running" : ""}`}>
            <div className="command-icon"><Icon name="spark" /></div><div className="command-copy"><span>ASK THE AGENT · TOOL LAYER ONLINE</span><strong>{agentNote}</strong></div><div className="command-input"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !agentRunning && runAgent()} disabled={agentRunning} /><button onClick={runAgent} disabled={agentRunning}><Icon name="arrow" /></button></div>
          </section>

          <div id="strategy-lab" className="section-heading"><div><span className="section-kicker">STRATEGY LAB</span><h2>两套策略，一个 Agent 工作流</h2></div><span className="updated">{loading ? "同步中…" : `最近同步 ${timeLabel(state?.latestScan?.scannedAt || null)}`}</span></div>
          <section className="strategy-grid">
            {summaries.slice(0, 2).map((strategy, index) => {
              const isActive = active === strategy.key;
              return <button key={strategy.key} className={`strategy-tile ${isActive ? "selected" : ""}`} onClick={() => { setActive(strategy.key); setState(null); setPaperConfirmed(false); }}>
                <div className="tile-head"><span className={`strategy-index ${index === 0 ? "gold" : "blue"}`}>0{index + 1}</span><span className="tile-source">{strategy.source}</span><span className={`tile-state ${isActive ? "on" : ""}`}>{isActive ? "ACTIVE" : "READY"}</span></div>
                <div className="tile-title-row"><div><h3>{strategy.name}</h3><p>{strategy.desc}</p></div><span className={`tile-arrow ${isActive ? "rotate" : ""}`}><Icon name="arrow" /></span></div>
                <div className="tile-metrics"><div><span>总收益</span><strong className={strategy.summary.totalReturnPct >= 0 ? "positive" : "negative"}>{pct(strategy.summary.totalReturnPct)}</strong></div><div><span>胜率</span><strong>{strategy.summary.winRate.toFixed(1)}%</strong></div><div><span>交易数</span><strong>{strategy.summary.tradeCount}</strong></div><div className="tile-sparkline"><span /><span /><span /><span /><span /><span /><span /></div></div>
              </button>;
            })}
          </section>

          <section className="dashboard-grid">
            <div className="panel performance-panel"><div className="panel-head"><div><span className="panel-kicker">PAPER PERFORMANCE</span><h3>{current?.name || "策略表现"}</h3></div><div className="panel-head-right"><span className="data-badge"><span className="status-pulse" />{current?.source || "Binance"}</span><label className="period-control"><span className="sr-only">权益曲线周期</span><select className="period-select" value={period} onChange={(event) => setPeriod(event.target.value as ChartPeriod)}><option value="24H">24H</option><option value="7D">7D</option><option value="30D">30D</option></select></label></div></div><div className="performance-total"><strong>{money(stats.equity || 0)}</strong><span className="positive">{pct(stats.totalReturnPct || 0)} <small>vs initial capital</small></span></div><div className="chart-area"><div className="chart-y-labels"><span>{money(curveMax, 0)}</span><span>{money((curveMax + curveMin) / 2, 0)}</span><span>{money(curveMin, 0)}</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="equity-chart"><defs><linearGradient id="equityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#f0b90b" stopOpacity=".28" /><stop offset="100%" stopColor="#f0b90b" stopOpacity="0" /></linearGradient></defs><path d={`${curvePath} L100 100 L0 100 Z`} fill="url(#equityFill)" /><path d={curvePath} fill="none" stroke="#f0b90b" strokeWidth="1.8" vectorEffect="non-scaling-stroke" /></svg></div><div className="chart-footer"><span>初始 {money(stats.initialCapital || 10000, 0)}</span><span>现金 {money(stats.cash || 0)}</span><span>浮动 {money(stats.floating || 0)}</span><span>最大回撤 <b className="negative">{(stats.maxDrawdownPct || 0).toFixed(2)}%</b></span></div></div>

            <div id="risk-gate" className="panel risk-panel"><div className="panel-head"><div><span className="panel-kicker">CONTROL PLANE</span><h3>风险闸门</h3></div><span className="guard-icon"><Icon name="shield" /></span></div><div className="risk-status"><span className="status-pulse" />所有系统正常 <small>· 最后检查刚刚</small></div><div className="risk-flow"><div className="risk-step done"><span>01</span><div><strong>感知行情</strong><small>{scannedCount} 个合约已扫描</small></div><b>✓</b></div><div className="risk-line done" /><div className="risk-step done"><span>02</span><div><strong>策略判断</strong><small>{candidateCount} 个候选进入队列</small></div><b>✓</b></div><div className="risk-line active" /><div className={`risk-step ${paperConfirmed ? "done" : "waiting"}`}><span>03</span><div><strong>人工确认</strong><small>{paperConfirmed ? "Paper Plan 已确认，不发送真实订单" : "未确认，不发送任何订单"}</small></div><b>{paperConfirmed ? "✓" : "→"}</b></div></div><div className="risk-footer"><span>权限范围</span><strong>Market data · Paper execution</strong><button className="confirm-paper" onClick={() => { setPaperConfirmed(true); setAgentNote("Paper Plan 已确认：仅记录模拟执行，broadcast=false。"); }}> {paperConfirmed ? "已确认 Paper Plan" : "确认 Paper Plan"}</button><span className="lock-label">NO WITHDRAWAL</span></div></div>
          </section>

          <section className="lower-grid"><div id="market-radar" className="panel opportunities-panel"><div className="panel-head"><div><span className="panel-kicker">OPPORTUNITY STREAM</span><h3>Agent 发现的机会</h3></div><button className="text-action" onClick={() => setShowAllOpportunities((current) => !current)} disabled={agentRunning}>{showAllOpportunities ? "收起" : "查看全部"} <Icon name="arrow" /></button></div><div className="opportunity-list">{hits.length ? hits.slice(0, showAllOpportunities ? hits.length : 4).map((hit) => <div className="opportunity-row" key={`${hit.symbol}-${hit.tag}`}><div className="coin-mark">{hit.symbol.slice(0, 1)}</div><div className="opportunity-name"><strong>{hit.symbol.replace("USDT", "")}/USDT</strong><span>{hit.tag} · score {hit.score}{demoVisible ? " · 本地演示" : ""}</span></div><div className="opportunity-price"><strong>{hit.lastPrice?.toLocaleString("en-US", { maximumFractionDigits: 4 })}</strong><span className={hit.change24hPct && hit.change24hPct < 0 ? "negative" : "positive"}>{pct(hit.change24hPct || 0)}</span></div><span className={`direction ${hit.direction}`}>{hit.direction === "long" ? "LONG" : "SHORT"}</span><span className="row-arrow"><Icon name="arrow" /></span></div>) : <div className="empty-feed">当前扫描未发现达到阈值的机会，Risk Gate 保持空闲。</div>}</div></div>
            <div id="run-records" className="panel activity-panel"><div className="panel-head"><div><span className="panel-kicker">AUDIT TRAIL</span><h3>{workflowEvents.length ? "Agent 事件链" : "最近运行"}</h3></div><span className="activity-count">{workflowEvents.length ? `${workflowEvents.length} EVENTS` : `${activeState ? activeState.stats.tradeCount : 26} EVENTS`}{lastAgentRun ? " · 5 TOOLS" : ""}</span></div><div className="activity-list">{workflowEvents.length ? workflowEvents.slice().reverse().slice(0, 5).map((event) => <div className="activity-row" key={event.id}><span className={`activity-icon ${event.status}`}>{event.status === "done" ? "✓" : event.status === "active" ? "•" : "·"}</span><div><strong>{event.phase}</strong><span>{event.detail}{event.demo ? " · local demo" : ""}</span></div><div className="activity-result"><strong className={event.status === "done" ? "positive" : "neutral-text"}>{event.status === "done" ? "完成" : event.status === "active" ? "执行中" : "排队"}</strong><span>{timeLabel(event.ts)}</span></div></div>) : displayClosed.slice(0, 4).map((trade) => <div className="activity-row" key={trade.id}><span className={`activity-icon ${trade.pnl_usd > 0 ? "profit" : trade.pnl_usd < 0 ? "loss" : "neutral"}`}>{trade.pnl_usd > 0 ? "↗" : trade.pnl_usd < 0 ? "↘" : "·"}</span><div><strong>{trade.symbol.replace("USDT", "/USDT")}</strong><span>{trade.tag || "Strategy event"} · {trade.exit_reason}</span></div><div className="activity-result"><strong className={trade.pnl_usd >= 0 ? "positive" : "negative"}>{trade.pnl_usd === 0 ? "待确认" : money(trade.pnl_usd)}</strong><span>{timeLabel(trade.exit_time)}</span></div></div>)}</div></div></section>

          <section id="permissions" className="positions-strip"><div className="position-strip-head"><div><span className="panel-kicker">PAPER POSITIONS</span><h3>当前持仓</h3></div><span>{displayPositions.length} 个 active positions{demoVisible ? " · local demo" : ""}</span></div><div className="position-cells">{displayPositions.slice(0, 3).map((position) => <div className="position-cell" key={position.id}><span className={`position-side ${position.direction}`}>{position.direction === "long" ? "L" : "S"}</span><div><strong>{position.symbol.replace("USDT", "/USDT")}</strong><span>{position.tag}</span></div><div className="position-last"><span>Last {position.currentPrice?.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span><strong className={position.floatPnlUsd >= 0 ? "positive" : "negative"}>{money(position.floatPnlUsd)} <small>({pct(position.floatPnlPct)})</small></strong></div></div>)}</div>{showConnectionInfo ? <div className="permission-note"><strong>权限与连接</strong><span>当前仅使用 Binance Futures 公共行情。</span><span>执行层为本地 SQLite Paper worker。</span><span>不读取 API key、不签名、不广播、不真实下单。</span></div> : null}</section>

          <footer className="agent-footer"><span>Agent OS Strategy Copilot · Hackathon Track A prototype</span><span>All results are paper simulations · not financial advice</span></footer>
        </div>
      </main>
    </div>
  );
}
