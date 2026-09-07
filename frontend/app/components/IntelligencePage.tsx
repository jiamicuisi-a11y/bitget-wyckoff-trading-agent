"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "./AppShell";
import { formatTime, loadIntelligenceFeed, percentage } from "../lib/data";
import type { IntelligenceFeed, IntelligenceItem } from "../lib/strategy-types";

const sourceLabels: Record<string, string> = {
  all: "全部来源",
  binance_activity: "Binance 活动",
  binance_announcement: "Binance 公告",
  binance_listing: "上币公告",
  coindesk: "CoinDesk",
};

const strategyLabels: Record<string, string> = {
  "anomaly-binance": "A档候选",
  "dualma4h-binance": "双均线候选",
  "box-breakout30m-binance": "箱体候选",
};

function sourceLabel(source: string) {
  return sourceLabels[source] || source;
}

function EventCard({ item }: { item: IntelligenceItem }) {
  const contexts = item.marketContext?.assets || [];
  return <article className="intelligence-card">
    <div className="intelligence-card-top"><span className={`intelligence-type ${item.type}`}>{item.type === "activity" ? "官方活动" : item.type === "announcement" ? "Binance 公告" : "行业资讯"}</span><span>{formatTime(item.publishedAt)}</span></div>
    <h3>{item.title}</h3>
    {item.summary ? <p>{item.summary}</p> : <p className="intelligence-empty-copy">此公开条目暂未提供摘要，请打开原文查看规则与完整内容。</p>}
    <div className="intelligence-tags">{item.assets.length ? item.assets.map((asset) => <span key={asset}>{asset}</span>) : <span className="muted">未识别关联币种</span>}</div>
    {contexts.length ? <div className="market-context-list">{contexts.map((context) => <div key={context.asset} className="market-context-row"><strong>{context.asset}</strong><span className={Number(context.change24hPct) < 0 ? "negative" : "positive"}>{context.change24hPct === null ? "行情未匹配" : `${percentage(context.change24hPct)}`}</span>{context.oiChangePct !== null ? <small>OI {percentage(context.oiChangePct)}</small> : null}{context.candidateStrategies.map((strategy) => <b key={strategy}>{strategyLabels[strategy] || strategy}</b>)}</div>)}</div> : null}
    <div className="intelligence-card-foot"><span>{sourceLabel(item.source)}{item.stale ? " · 缓存数据" : ""}</span><a href={item.url} target="_blank" rel="noreferrer">查看原文 <span aria-hidden="true">↗</span></a></div>
  </article>;
}

export default function IntelligencePage() {
  const [feed, setFeed] = useState<IntelligenceFeed | null>(null);
  const [source, setSource] = useState("all");
  const [asset, setAsset] = useState("");
  const [draftAsset, setDraftAsset] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFeed(await loadIntelligenceFeed({ source, asset }));
      setError("");
    } catch (cause: any) {
      setError(cause?.message || "市场情报暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [source, asset]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const items = feed?.items || [];
  const activities = useMemo(() => items.filter((item) => item.type === "activity"), [items]);
  const events = useMemo(() => items.filter((item) => item.type !== "activity"), [items]);
  const linked = useMemo(() => items.filter((item) => item.marketContext?.assets.some((context) => context.candidateStrategies.length)).length, [items]);
  const staleSources = Object.values(feed?.sources || {}).filter((state) => state.stale);

  return <AppShell title="市场情报" eyebrow="EVENT INTELLIGENCE">
    <section className="intelligence-hero">
      <div><span className="page-eyebrow">PUBLIC SOURCES · MARKET CONTEXT</span><h2>看见事件，<em>再看市场反应。</em></h2><p>Binance 官方活动、公告与行业资讯在同一处呈现；每条记录都有来源、时间和原文入口，并与公开行情和当前策略候选做只读关联。</p></div>
      <div className="intelligence-hero-mark"><span>LIVE</span><strong>{loading ? "SYNC" : "READY"}</strong><small>public data only</small></div>
    </section>

    <section className="intelligence-kpis">
      <div><span>当前事件</span><strong>{items.length}</strong><small>已加载公开资料</small></div>
      <div><span>官方活动</span><strong>{activities.length}</strong><small>规则入口可直接查看</small></div>
      <div><span>策略关联</span><strong>{linked}</strong><small>与当前候选同币种</small></div>
      <div><span>最后同步</span><strong>{feed?.fetchedAt ? formatTime(feed.fetchedAt) : "—"}</strong><small>{staleSources.length ? `${staleSources.length} 个源使用缓存` : "全部来源正常"}</small></div>
    </section>

    <section className="intelligence-toolbar" aria-label="市场情报筛选">
      <div className="intelligence-filter-group"><span>来源</span><select value={source} onChange={(event) => setSource(event.target.value)}>{Object.entries(sourceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <form className="intelligence-asset-search" onSubmit={(event) => { event.preventDefault(); setAsset(draftAsset.trim().toUpperCase()); }}><label htmlFor="intelligence-asset">币种</label><input id="intelligence-asset" value={draftAsset} onChange={(event) => setDraftAsset(event.target.value)} placeholder="BTC / ETH / SOL" maxLength={12} /><button type="submit">筛选</button>{asset ? <button type="button" className="quiet-button" onClick={() => { setAsset(""); setDraftAsset(""); }}>清除</button> : null}</form>
      <button type="button" className="icon-action" aria-label="刷新市场情报" title="刷新市场情报" onClick={() => void load()} disabled={loading}>↻</button>
    </section>

    {error ? <div className="intelligence-error"><strong>暂时无法刷新</strong><span>{error}</span><button type="button" onClick={() => void load()}>重试</button></div> : null}
    {staleSources.length ? <div className="intelligence-stale">部分来源暂时不可用，页面正在显示最近一次成功读取的缓存数据：{staleSources.map((state) => sourceLabel(state.source)).join("、")}。</div> : null}

    <section className="intelligence-layout">
      <div className="intelligence-stream-panel"><div className="section-title"><div><span className="table-kicker">MARKET EVENTS</span><h2>市场资讯与公告</h2></div><small>{events.length} 条</small></div><div className="intelligence-scroll">{events.length ? events.map((item) => <EventCard key={item.id} item={item} />) : <div className="empty-state">当前筛选条件下没有资讯；可切换来源或清除币种筛选。</div>}</div></div>
      <aside className="intelligence-activity-panel"><div className="section-title"><div><span className="table-kicker">BINANCE ACTIVITIES</span><h2>官方活动入口</h2></div><small>{activities.length} 个</small></div><p className="activity-panel-note">打开规则前请核对地区、资格、截止时间和资金要求。页面只提供公开信息，不会替你报名。</p><div className="intelligence-scroll activity-list">{activities.length ? activities.map((item) => <EventCard key={item.id} item={item} />) : <div className="empty-state">当前筛选条件下没有官方活动。</div>}</div></aside>
    </section>

    <section className="intelligence-source-status"><div><span className="table-kicker">SOURCE STATUS</span><h2>数据来源状态</h2></div><div>{Object.values(feed?.sources || {}).map((state) => <span key={state.source} className={state.stale ? "stale" : "live"}><i />{sourceLabel(state.source)} · {state.stale ? "缓存" : "已同步"}</span>)}</div></section>
  </AppShell>;
}
