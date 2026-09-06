# Strategy Copilot 多页面策略控制台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单页 Agent 控制台改造成包含独立 A 档、双均线、风险、运行记录和连接页面的可解释 Paper Trading 产品。

**Architecture:** 保留 Next.js App Router 和现有 Node Paper worker。新增共享数据类型、共享 App Shell 与独立工作台组件；后端补充双均线解释字段和持久化 Agent Run/事件接口，前端按真实路径渲染对应页面。

**Tech Stack:** Next.js 14 App Router、React 18、TypeScript、原生 CSS、Node 24 `node:sqlite`、现有 Binance public market data adapter。

**Spec:** `docs/superpowers/specs/2026-09-05-strategy-copilot-multi-page-design.md`

## Global Constraints

- 仅展示 Binance Futures 公共行情，保留 PAPER MODE。
- 不读取 API key，不签名，不广播，不真实下单，不执行提现或资金操作。
- Paper worker 自动操作模拟账户；前端不提供真实交易入口。
- A 档与双均线必须使用独立页面和独立解释字段。
- 本目录没有 Git 元数据，不执行伪造提交。

### Task 1: 持久化 Agent Run 与事件 API

**Files:**
- Modify: `backend/server/db.mjs`
- Modify: `backend/server/index.mjs`
- Create: `frontend/app/api/runs/route.ts`

**Interfaces:**
- Produces `POST /api/agent/run` persisted rows, `GET /api/runs`, and `GET /api/runs?id=<runId>`.
- Each run stores `runId`, `strategy`, `intent`, `startedAt`, `completedAt`, `scannedCount`, `candidateCount`, `planCount`, `status`, `broadcast`; each event stores `runId`, `phase`, `detail`, `status`, `ts`.

- [ ] Add `agent_runs` and `agent_events` tables with indexes and a `persistAgentRun` helper.
- [ ] Call the helper at the end of `buildAgentRun` before returning the result, while keeping `broadcast=false`.
- [ ] Add worker GET handlers for run list and one run detail.
- [ ] Add the Next.js proxy route for both list and detail queries.
- [ ] Run `node --check backend/server/index.mjs` and query both endpoints with curl.

### Task 2: Enrich strategy candidates

**Files:**
- Modify: `backend/server/strategies.mjs`
- Modify: `backend/server/index.mjs`

**Interfaces:**
- Dual-ma candidate includes `fastEma`, `slowEma`, `signal`, `signalCandleTime`, `volumeRank`, `granularity`, and `reason`.
- Latest scan preserves all candidate metadata in `/api/scan/latest` and `/api/state`.

- [ ] Add a small EMA helper or reuse the indicator module to calculate the latest fast and slow values from the same candle close array.
- [ ] Add volume rank from the TopN universe and ISO timestamp from the signal candle.
- [ ] Build bilingual-safe Chinese reasons for golden/death cross without changing the strategy decision.
- [ ] Return the enriched fields and run a live or fixture-level node check against `makeDualmaCandidates` output.

### Task 3: Shared frontend shell and data contracts

**Files:**
- Create: `frontend/app/lib/strategy-types.ts`
- Create: `frontend/app/lib/data.ts`
- Create: `frontend/app/components/AppShell.tsx`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- `StrategyKey = "anomaly-binance" | "dualma4h-binance"`.
- `loadStrategyState(strategyKey)` returns `{ strategy, source, stats, positions, recentClosed, latestScan, config }`.
- `AppShell` accepts `children`, current pathname, connection state, and navigation links.

- [ ] Move reusable strategy/state/scan/position types out of `AgentConsole.tsx`.
- [ ] Implement route links for `/overview`, `/radar/anomaly`, `/radar/dualma`, `/risk`, `/runs`, and `/connections`.
- [ ] Keep sidebar responsive and add active route styling.
- [ ] Add shared panel, table, badge, drawer, timeline, empty/error, and Paper safety styles.
- [ ] Run `npm run build` to validate the shared shell before page composition.

### Task 4: A-tier anomaly workspace

**Files:**
- Create: `frontend/app/radar/anomaly/page.tsx`
- Create: `frontend/app/components/AnomalyWorkspace.tsx`
- Modify: `frontend/app/api/paper/route.ts` only if a missing proxy query is required

**Interfaces:**
- Uses `loadStrategyState("anomaly-binance")`.
- Displays candidate rows with `score`, `factors`, `oiChangePct`, `change24hPct`, `volumeUsd`, `fundingRate`, `bidAskImbalance`, and Paper status.

- [ ] Build the scan summary and parameter rail.
- [ ] Build sortable/filterable candidate table with long/short and observed/Paper-open/closed states.
- [ ] Add a candidate detail drawer showing weighted factors, plain-language reason, and Paper entry/stop/target plan.
- [ ] Add automatic Paper positions and recent closed trades; expose no manual order action.
- [ ] Add loading, worker offline, empty scan, and `local demo` states.
- [ ] Verify a candidate row opens and closes its detail drawer in the browser.

### Task 5: Dual-ma workspace and chart

**Files:**
- Create: `frontend/app/radar/dualma/page.tsx`
- Create: `frontend/app/components/DualMaWorkspace.tsx`
- Modify: `frontend/app/TradeChart.tsx` or create `frontend/app/components/DualMaChart.tsx`

**Interfaces:**
- Uses `loadStrategyState("dualma4h-binance")` and `/api/paper?view=klines&strategy=dualma4h-binance&symbol=<symbol>&granularity=4H`.
- Renders `fastEma`, `slowEma`, `signal`, `signalCandleTime`, `volumeRank`, `reason`, and Paper state.

- [ ] Build Top30 universe/signal table with EMA and volume-rank columns.
- [ ] Add selected-symbol state and load its 4H candles from the existing proxy.
- [ ] Render candlesticks with EMA10/EMA30 overlays and signal markers using the existing chart dependency or a focused SVG fallback.
- [ ] Add signal detail panel and independent Paper position/history section.
- [ ] Ensure the page copy distinguishes “score 60 = valid crossover” from A-tier weighted score.
- [ ] Verify selecting a signal changes the chart and detail panel.

### Task 6: Overview, risk, runs, and connections pages

**Files:**
- Create: `frontend/app/overview/page.tsx`
- Create: `frontend/app/risk/page.tsx`
- Create: `frontend/app/runs/page.tsx`
- Create: `frontend/app/connections/page.tsx`
- Create: `frontend/app/components/OverviewPage.tsx`
- Create: `frontend/app/components/RiskPage.tsx`
- Create: `frontend/app/components/RunsPage.tsx`
- Create: `frontend/app/components/ConnectionsPage.tsx`

**Interfaces:**
- All pages use `AppShell`; runs use `/api/runs` and `/api/runs?id=<runId>`.
- Risk page shows plans and safety checks but only confirms local Paper plans.

- [ ] Build overview with two strategy summaries and latest Agent run.
- [ ] Build risk timeline with threshold, stop/target, concurrency, cooldown, confirmation, and `broadcast=false` states.
- [ ] Build run list and expandable five-tool event timeline.
- [ ] Build connections page with Binance public data, Paper worker, and Tool Layer capabilities.
- [ ] Add explicit offline and no-run states.

### Task 7: Replace the old monolithic entry and remove dead UI

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify or remove: `frontend/app/AgentConsole.tsx`
- Modify: `frontend/app/globals.css`

- [ ] Make `/` redirect or render `/overview` through a small App Router entry.
- [ ] Remove the old single-page-only sections and demo-only navigation behavior once all new pages use the shared shell.
- [ ] Keep the existing Agent Tool Layer request path and Paper safety copy.
- [ ] Run full `npm run build`.

### Task 8: Browser QA and acceptance

**Files:**
- No committed test artifact; screenshots stay outside the repository.

- [ ] Load `/overview` and verify page identity, meaningful content, no framework overlay, and no console errors.
- [ ] Navigate to `/radar/anomaly`, open a candidate, verify factor detail and Paper state.
- [ ] Navigate to `/radar/dualma`, select a signal, verify EMA data and chart change.
- [ ] Trigger Agent Run, verify five-tool timeline and persistence after reload.
- [ ] Verify `/risk` and `/connections` visibly preserve `PAPER MODE` and `broadcast=false`.
- [ ] Check desktop and mobile-sized layouts for overflow and unreadable tables.
- [ ] Record remaining limitations: Binance public fetch can be unavailable, and no real execution is intentionally supported.
