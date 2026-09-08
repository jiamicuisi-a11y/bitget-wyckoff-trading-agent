"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "./AppShell";
import { formatTime, loadIntelligenceActivities, loadIntelligenceFeed, percentage } from "../lib/data";
import type { ActivityDetails, IntelligenceFeed, IntelligenceItem } from "../lib/strategy-types";

const FAVORITES_KEY = "strategy-copilot:intelligence:favorites";
const REMINDERS_KEY = "strategy-copilot:intelligence:reminders";

const sourceLabels: Record<string, string> = {
  all: "全部来源",
  binance_activity: "币安活动",
  binance_announcement: "币安公告",
  binance_listing: "上币公告",
  panews: "PANews 中文资讯",
};

const typeLabels: Record<string, string> = {
  all: "全部类型",
  activity: "官方活动",
  announcement: "公告与上币",
  news: "行业资讯",
};

const strategyLabels: Record<string, string> = {
  "anomaly-binance": "A档候选",
  "dualma4h-binance": "双均线候选",
  "box-breakout30m-binance": "箱体候选",
};

type Reminder = { dueAt: string; fired: boolean };

function sourceLabel(source: string) {
  return sourceLabels[source] || source;
}

function typeLabel(item: IntelligenceItem) {
  if (item.type === "activity") return "官方活动";
  if (item.type === "announcement") return item.source === "binance_listing" ? "上币公告" : "币安公告";
  return "行业资讯";
}

function getReminderDueAt(item: IntelligenceItem) {
  const endAt = item.activityDetails?.endsAt ? Date.parse(item.activityDetails.endsAt) : NaN;
  const preferred = Number.isFinite(endAt) && endAt > Date.now() ? endAt - 24 * 60 * 60 * 1000 : Date.now() + 24 * 60 * 60 * 1000;
  return new Date(Math.max(preferred, Date.now() + 60 * 1000)).toISOString();
}

function ActivityBrief({ details }: { details: ActivityDetails }) {
  return <div className="activity-brief">
    <div className="activity-brief-grid">
      <span><small>活动类型</small><strong>{details.category}</strong></span>
      <span><small>状态</small><strong className={`activity-status ${details.status}`}>{details.statusLabel}</strong></span>
      <span><small>活动时间</small><strong>{details.startsAt ? formatTime(details.startsAt) : "官方规则未明确"}{details.endsAt ? ` - ${formatTime(details.endsAt)}` : ""}</strong></span>
      <span><small>奖励摘要</small><strong>{details.reward}</strong></span>
    </div>
    <p><b>参与提示</b>{details.qualification}</p>
  </div>;
}

function EventCard({
  item,
  favorite,
  reminded,
  onFavorite,
  onReminder,
  onDetails,
}: {
  item: IntelligenceItem;
  favorite: boolean;
  reminded: boolean;
  onFavorite: () => void;
  onReminder: () => void;
  onDetails: () => void;
}) {
  const contexts = item.marketContext?.assets || [];
  return <article className={`intelligence-card ${favorite ? "is-favorite" : ""}`}>
    <div className="intelligence-card-top">
      <span className={`intelligence-type ${item.type}`}>{typeLabel(item)}</span>
      <span>{formatTime(item.publishedAt)}</span>
    </div>
    <div className="intelligence-card-title-row"><h3>{item.title}</h3><button type="button" className="card-star" aria-label={favorite ? "取消收藏" : "收藏这条情报"} aria-pressed={favorite} onClick={onFavorite}>{favorite ? "★" : "☆"}</button></div>
    {item.summary ? <p>{item.summary}</p> : <p className="intelligence-empty-copy">此公开条目暂未提供摘要，请打开原文查看完整规则。</p>}
    <div className="intelligence-tags">{item.assets.length ? item.assets.map((asset) => <span key={asset}>{asset}</span>) : <span className="muted">未识别关联币种</span>}</div>
    {item.activityDetails ? <ActivityBrief details={item.activityDetails} /> : null}
    {contexts.length ? <div className="market-context-list"><span className="market-context-heading">公开市场关联</span>{contexts.map((context) => {
      const matches = context.candidateMatches || [];
      const positions = context.positionMatches || [];
      return <div key={context.asset} className="market-context-row">
        <strong>{context.asset}</strong>
        <span className={Number(context.change24hPct) < 0 ? "negative" : "positive"}>{context.change24hPct === null ? "行情未匹配" : percentage(context.change24hPct)}</span>
        {context.oiChangePct !== null ? <small>OI {percentage(context.oiChangePct)}</small> : null}
        {matches.length ? matches.map((match) => <b key={`${match.strategy}-${match.score}`}>{strategyLabels[match.strategy] || match.strategy} · {match.score ?? "—"}分 · {match.reason}</b>) : <small className="market-no-match">当前未进入策略候选</small>}
        {positions.map((position) => <b className="position-match" key={`position-${position.strategy}`}>{strategyLabels[position.strategy] || position.strategy} · 当前持仓</b>)}
      </div>;
    })}</div> : null}
    <div className="intelligence-card-foot">
      <span>{sourceLabel(item.source)}{item.stale ? " · 缓存数据" : ""}</span>
      <div className="intelligence-card-actions">
        {item.activityDetails ? <button type="button" className="card-text-action" onClick={onDetails}>查看详情</button> : null}
        {item.type === "activity" ? <button type="button" className={`card-text-action ${reminded ? "active" : ""}`} onClick={onReminder}>{reminded ? "已提醒" : "提醒我"}</button> : null}
        <a href={item.url} target="_blank" rel="noreferrer">查看原文 <span aria-hidden="true">↗</span></a>
      </div>
    </div>
  </article>;
}

function ActivityDetailDrawer({ item, onClose, favorite, reminded, onFavorite, onReminder }: {
  item: IntelligenceItem;
  onClose: () => void;
  favorite: boolean;
  reminded: boolean;
  onFavorite: () => void;
  onReminder: () => void;
}) {
  const details = item.activityDetails;
  if (!details) return null;
  return <div className="intelligence-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="intelligence-drawer" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title">
      <div className="drawer-head"><div><span className="table-kicker">官方活动详情</span><h2 id="activity-detail-title">{item.title}</h2></div><button type="button" className="drawer-close" aria-label="关闭详情" onClick={onClose}>×</button></div>
      <div className="drawer-status-row"><span className={`activity-status ${details.status}`}>{details.statusLabel}</span><span>{details.category}</span><span>{sourceLabel(item.source)}</span></div>
      <div className="drawer-detail-grid"><div><small>活动时间</small><strong>{details.startsAt ? formatTime(details.startsAt) : "未明确"}</strong><span>{details.endsAt ? `结束于 ${formatTime(details.endsAt)}` : "请以原文为准"}</span></div><div><small>奖励摘要</small><strong>{details.reward}</strong></div></div>
      <section className="drawer-section"><h3>参与资格与方式</h3><p>{details.qualification}</p><p>{details.participation}</p></section>
      <section className="drawer-section"><h3>与当前策略的关系</h3>{item.marketContext?.assets?.length ? item.marketContext.assets.map((context) => <div className="drawer-market-row" key={context.asset}><strong>{context.asset}</strong><span>{context.change24hPct === null ? "当前无匹配行情" : `24h ${percentage(context.change24hPct)}`}</span>{context.candidateMatches?.length ? <small>{context.candidateMatches.map((match) => `${strategyLabels[match.strategy] || match.strategy} ${match.score ?? "—"}分`).join("、")}</small> : <small>当前未进入策略候选</small>}</div>) : <p>这条活动没有识别到可关联的合约币种，不能据此推断交易机会。</p>}</section>
      <div className="drawer-actions"><button type="button" className="drawer-secondary" onClick={onFavorite}>{favorite ? "★ 已收藏" : "☆ 收藏活动"}</button><button type="button" className="drawer-secondary" onClick={onReminder}>{reminded ? "已设置本地提醒" : "设置本地提醒"}</button><a className="drawer-primary" href={item.url} target="_blank" rel="noreferrer">打开官方规则 ↗</a></div>
      <p className="drawer-warning">资格、地区限制和最终截止时间以官方原文为准。本地提醒只保存在当前浏览器，页面关闭时不会替你完成报名。</p>
    </aside>
  </div>;
}

export default function IntelligencePage() {
  const [feed, setFeed] = useState<IntelligenceFeed | null>(null);
  const [activityFeed, setActivityFeed] = useState<IntelligenceFeed | null>(null);
  const [source, setSource] = useState("all");
  const [type, setType] = useState("all");
  const [asset, setAsset] = useState("");
  const [draftAsset, setDraftAsset] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [reminders, setReminders] = useState<Record<string, Reminder>>({});
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedItem, setSelectedItem] = useState<IntelligenceItem | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const storedFavorites = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || "[]");
      const storedReminders = JSON.parse(window.localStorage.getItem(REMINDERS_KEY) || "{}");
      if (Array.isArray(storedFavorites)) setFavoriteIds(storedFavorites.filter((value): value is string => typeof value === "string"));
      if (storedReminders && typeof storedReminders === "object") setReminders(storedReminders);
    } catch { /* local storage may be disabled */ }
    setStorageReady(true);
  }, []);

  useEffect(() => { if (storageReady) window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds)); }, [favoriteIds, storageReady]);
  useEffect(() => { if (storageReady) window.localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders)); }, [reminders, storageReady]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setReminders((current) => {
        let changed = false;
        const next = { ...current };
        Object.entries(current).forEach(([id, reminder]) => {
          if (!reminder.fired && Date.parse(reminder.dueAt) <= Date.now()) {
            changed = true;
            next[id] = { ...reminder, fired: true };
            if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("市场情报提醒", { body: "你关注的币安活动到了提醒时间，请打开官方规则核对资格。" });
          }
        });
        return changed ? next : current;
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextFeed, nextActivityFeed] = await Promise.all([
        loadIntelligenceFeed({ source, type, asset }),
        loadIntelligenceActivities({ asset }),
      ]);
      setFeed(nextFeed);
      setActivityFeed(nextActivityFeed);
      setError("");
    } catch (cause: any) {
      setError(cause?.message || "市场情报暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [source, type, asset]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const allItems = feed?.items || [];
  const allActivities = activityFeed?.items || allItems.filter((item) => item.type === "activity");
  const items = useMemo(() => favoriteOnly ? allItems.filter((item) => favoriteIds.includes(item.id)) : allItems, [allItems, favoriteIds, favoriteOnly]);
  const activities = useMemo(() => favoriteOnly ? allActivities.filter((item) => favoriteIds.includes(item.id)) : allActivities, [allActivities, favoriteIds, favoriteOnly]);
  const events = useMemo(() => items.filter((item) => item.type !== "activity"), [items]);
  const linked = useMemo(() => allItems.filter((item) => item.marketContext?.assets.some((context) => (context.candidateMatches || []).length > 0)).length, [allItems]);
  const staleSources = Object.values({ ...(feed?.sources || {}), ...(activityFeed?.sources || {}) }).filter((state, index, states) => state.stale && states.findIndex((candidate) => candidate.source === state.source) === index);

  function toggleFavorite(id: string) {
    setFavoriteIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleReminder(item: IntelligenceItem) {
    setReminders((current) => {
      if (current[item.id]) {
        const next = { ...current };
        delete next[item.id];
        return next;
      }
      return { ...current, [item.id]: { dueAt: getReminderDueAt(item), fired: false } };
    });
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
  }

  return <AppShell title="市场情报" eyebrow="事件情报">
    <section className="intelligence-hero">
      <div><span className="page-eyebrow">公开来源 · 市场关联</span><h2>看见事件，<em>再看市场反应。</em></h2><p>币安中文站、中文行业资讯和官方活动在同一处呈现；每条记录都有来源、时间和原文入口，并与公开行情和当前策略候选做只读关联。</p></div>
      <div className="intelligence-hero-mark"><span>同步状态</span><strong>{loading ? "同步中" : "已就绪"}</strong><small>公开数据 · 本地关注</small></div>
    </section>

    <section className="intelligence-kpis">
      <div><span>当前事件</span><strong>{allItems.length}</strong><small>已加载公开资料</small></div>
      <div><span>官方活动</span><strong>{allActivities.length}</strong><small>可展开资格与奖励</small></div>
      <div><span>策略关联</span><strong>{linked}</strong><small>与当前候选同币种</small></div>
      <div><span>我的关注</span><strong>{favoriteIds.length}</strong><small>{Object.keys(reminders).length} 个本地提醒</small></div>
    </section>

    <section className="intelligence-toolbar" aria-label="市场情报筛选">
      <div className="intelligence-filter-group"><span>来源</span><select value={source} onChange={(event) => setSource(event.target.value)}>{Object.entries(sourceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <div className="intelligence-filter-group"><span>类型</span><select value={type} onChange={(event) => setType(event.target.value)}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <form className="intelligence-asset-search" onSubmit={(event) => { event.preventDefault(); setAsset(draftAsset.trim().toUpperCase()); }}><label htmlFor="intelligence-asset">币种</label><input id="intelligence-asset" value={draftAsset} onChange={(event) => setDraftAsset(event.target.value)} placeholder="BTC / ETH / SOL" maxLength={12} /><button type="submit">筛选</button>{asset ? <button type="button" className="quiet-button" onClick={() => { setAsset(""); setDraftAsset(""); }}>清除</button> : null}</form>
      <label className="favorite-filter"><input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />只看收藏</label>
      <button type="button" className="icon-action" aria-label="刷新市场情报" title="刷新市场情报" onClick={() => void load()} disabled={loading}>↻</button>
    </section>

    <div className="intelligence-personal-bar"><span><b>本地关注</b> 收藏与提醒只保存在这台浏览器，不连接账户权限。</span><span>{favoriteIds.length} 收藏 · {Object.keys(reminders).length} 提醒{Object.values(reminders).some((item) => !item.fired) ? " · 有待触发提醒" : ""}</span></div>
    {error ? <div className="intelligence-error"><strong>暂时无法刷新</strong><span>{error}</span><button type="button" onClick={() => void load()}>重试</button></div> : null}
    {staleSources.length ? <div className="intelligence-stale">部分来源暂时不可用，页面正在显示最近一次成功读取的缓存数据：{staleSources.map((state) => sourceLabel(state.source)).join("、")}。</div> : null}

    <section className="intelligence-layout">
      <div className="intelligence-stream-panel"><div className="section-title"><div><span className="table-kicker">中文市场事件</span><h2>市场资讯与公告</h2></div><small>{events.length} 条</small></div><div className="intelligence-scroll">{events.length ? events.map((item) => <EventCard key={item.id} item={item} favorite={favoriteIds.includes(item.id)} reminded={Boolean(reminders[item.id])} onFavorite={() => toggleFavorite(item.id)} onReminder={() => toggleReminder(item)} onDetails={() => setSelectedItem(item)} />) : <div className="empty-state">{favoriteOnly ? "还没有收藏的情报。" : "当前筛选条件下没有资讯；可切换来源或清除币种筛选。"}</div>}</div></div>
      <aside className="intelligence-activity-panel"><div className="section-title"><div><span className="table-kicker">币安官方活动</span><h2>官方活动入口</h2></div><small>{activities.length} 个</small></div><p className="activity-panel-note">每条活动会先显示类别、时间、奖励和资格摘要；打开官方规则前仍请核对地区、资格、截止时间和资金要求。</p><div className="intelligence-scroll activity-list">{activities.length ? activities.map((item) => <EventCard key={item.id} item={item} favorite={favoriteIds.includes(item.id)} reminded={Boolean(reminders[item.id])} onFavorite={() => toggleFavorite(item.id)} onReminder={() => toggleReminder(item)} onDetails={() => setSelectedItem(item)} />) : <div className="empty-state">当前筛选条件下没有官方活动。</div>}</div></aside>
    </section>

    <section className="intelligence-source-status"><div><span className="table-kicker">数据来源状态</span><h2>中文源与官方源状态</h2></div><div>{Object.values(feed?.sources || {}).map((state) => <span key={state.source} className={state.stale ? "stale" : "live"}><i />{sourceLabel(state.source)} · {state.stale ? "缓存" : "已同步"}</span>)}</div></section>
    {selectedItem ? <ActivityDetailDrawer item={selectedItem} onClose={() => setSelectedItem(null)} favorite={favoriteIds.includes(selectedItem.id)} reminded={Boolean(reminders[selectedItem.id])} onFavorite={() => toggleFavorite(selectedItem.id)} onReminder={() => toggleReminder(selectedItem)} /> : null}
  </AppShell>;
}
