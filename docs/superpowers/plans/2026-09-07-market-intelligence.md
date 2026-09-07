# Market Intelligence Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a resilient market-news and Binance-activity intelligence center that the local MCP Agent can query.

**Architecture:** A worker-owned intelligence service fetches three public sources behind strict timeouts, normalizes and caches records in SQLite, and returns the most recent successful snapshot if a source fails. The Next UI reads only same-origin proxy routes; the standalone page and Agent tools consume the same feed and preserve source attribution and original links.

**Tech Stack:** Node.js 24 native fetch and node:sqlite; Binance public CMS JSON; CoinDesk RSS XML parsed without a new dependency; Next.js 14, React, TypeScript, and the Node built-in test runner.

**Spec:** docs/superpowers/specs/2026-09-07-market-intelligence-design.md

## Global Constraints

- Public read-only data only: no credentials, cookies, wallet connections, signing, account reads, order placement, or enrollment actions.
- Each external request has an 8-second timeout; source failure cannot stop the scan loop, Paper worker, existing routes, or page rendering.
- Cache snapshots for 10 minutes in memory and persist only public normalized records plus source refresh state in SQLite.
- Every record shows its source, published time, original link, and stale/cache status.
- Public CMS/RSS results must never be labeled Binance MCP.
- Preserve Paper-only and broadcast=false boundaries.

---

### Task 1: Normalize public intelligence sources

**Files:**
- Create: backend/server/intelligence.mjs
- Create: backend/test/intelligence.test.mjs
- Modify: backend/package.json

**Interfaces:**
- Produces extractAssets(text), parseBinanceCatalog(payload, source, type), and parseRssFeed(xml).
- IntelligenceItem shape is id, externalId, title, source, type, publishedAt, url, summary, assets, rawAvailable.
- Produces createIntelligenceService(options) with getFeed(filters), getActivities(filters), and getEvent(id).

- [ ] **Step 1: Write the failing parser tests.**

    import test from "node:test";
    import assert from "node:assert/strict";
    import { extractAssets, parseBinanceCatalog } from "../server/intelligence.mjs";

    test("extractAssets only emits known futures bases", () => {
      assert.deepEqual(extractAssets("BTC, ETH and PONSUSDT will be listed"), ["BTC", "ETH", "PONS"]);
    });

    test("Binance parser retains title, release time and official URL", () => {
      const input = { data: { catalogs: [{ articles: [{ code: "abc", title: "Binance Launchpool: SOL", releaseDate: 1788674111414 }] }] } };
      const item = parseBinanceCatalog(input, "binance_activity", "activity")[0];
      assert.equal(item.url, "https://www.binance.com/en/support/announcement/abc");
      assert.deepEqual(item.assets, ["SOL"]);
    });

- [ ] **Step 2: Run the parser test.**

    cd backend && node --test test/intelligence.test.mjs

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the pure parsers without network access.**

    export function extractAssets(text) {
      const known = String(text || "").toUpperCase()
        .match(/\b[A-Z0-9]{2,12}(?=USDT\b)|\b(?:BTC|ETH|SOL|BNB|XRP|DOGE|ADA|AVAX|LINK)\b/g) || [];
      return [...new Set(known.map((symbol) => symbol.replace(/USDT$/, "")))];
    }

Binance records use source plus article code as their id. RSS records use a stable hash of source link or GUID. Missing dates or descriptions remain null or empty rather than invented.

- [ ] **Step 4: Add the test script and verify.**

    "test:intelligence": "node --test test/intelligence.test.mjs"

    cd backend && npm run test:intelligence

Expected: PASS.

- [ ] **Step 5: Commit the parser layer.**

    git add backend/server/intelligence.mjs backend/test/intelligence.test.mjs backend/package.json
    git commit -m "feat: add intelligence source parsers"

### Task 2: Persist cache and isolate failing sources

**Files:**
- Modify: backend/server/db.mjs
- Modify: backend/server/intelligence.mjs
- Modify: backend/test/intelligence.test.mjs

**Interfaces:**
- Produces upsertIntelligenceItems(items, fetchedAt), listIntelligenceItems(filters), getIntelligenceSourceState(source), and setIntelligenceSourceState(source, state).
- getFeed(filters) returns items, sources, stale, and fetchedAt. A source state includes source, lastSuccessAt, stale, and optional error.

- [ ] **Step 1: Write the failing stale-cache test.**

    test("failed refresh returns cached activity with stale source state", async () => {
      const service = createIntelligenceService({
        fetchImpl: async () => { throw new DOMException("timeout", "AbortError"); },
        cache: cacheWithOneActivity,
        now: () => 2000,
      });
      const result = await service.getActivities();
      assert.equal(result.sources.binance_activity.stale, true);
      assert.equal(result.items[0].id, "binance_activity:abc");
    });

- [ ] **Step 2: Run the test.**

    cd backend && node --test test/intelligence.test.mjs

Expected: FAIL because stale fallback is not implemented.

- [ ] **Step 3: Add SQLite schema and helpers.**

    CREATE TABLE IF NOT EXISTS intelligence_items (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
      published_at INTEGER, url TEXT NOT NULL, summary TEXT, assets_json TEXT NOT NULL,
      raw_available INTEGER NOT NULL DEFAULT 0, fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS intelligence_sources (
      source TEXT PRIMARY KEY, last_success_at INTEGER, last_attempt_at INTEGER,
      last_error TEXT, updated_at INTEGER NOT NULL
    );

- [ ] **Step 4: Implement exact public source definitions.**

    const SOURCES = [
      { key: "binance_activity", type: "activity", catalogId: 93, parse: parseBinanceCatalog },
      { key: "binance_announcement", type: "announcement", catalogId: 49, parse: parseBinanceCatalog },
      { key: "binance_listing", type: "announcement", catalogId: 48, parse: parseBinanceCatalog },
      { key: "coindesk", type: "news", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", parse: parseRssFeed },
    ];

Each call uses AbortSignal.timeout(8000). Successful results refresh the memory cache for 600000 milliseconds and update SQLite. On failure, return the cached records and stale=true; never throw from a combined feed request.

- [ ] **Step 5: Run tests.**

    cd backend && npm run test:intelligence

Expected: PASS.

- [ ] **Step 6: Commit cache resilience.**

    git add backend/server/db.mjs backend/server/intelligence.mjs backend/test/intelligence.test.mjs
    git commit -m "feat: cache market intelligence sources"

### Task 3: Add worker routes and market context

**Files:**
- Modify: backend/server/index.mjs
- Modify: backend/server/intelligence.mjs
- Modify: backend/test/intelligence.test.mjs

**Interfaces:**
- createIntelligenceService receives getMarketSnapshot and getStrategyCandidates callbacks, not scanner imports.
- Worker routes are GET /api/intelligence/feed, GET /api/intelligence/activities, and GET /api/intelligence/event?id=value.
- marketContext.assets contains asset, futuresSymbol, change24hPct, volumeUsd, fundingRate, oiChangePct, and candidateStrategies.

- [ ] **Step 1: Write a failing correlation test.**

    test("SOL event context reports current strategy candidate", () => {
      const context = buildMarketContext(itemWithAssets(["SOL"]), {
        tickers: [{ symbol: "SOLUSDT", changeUtc24h: "0.08", usdtVolume: "500000" }],
        candidatesByStrategy: { "anomaly-binance": [{ symbol: "SOLUSDT" }] },
      });
      assert.deepEqual(context.assets[0].candidateStrategies, ["anomaly-binance"]);
    });

- [ ] **Step 2: Implement buildMarketContext and route validation.**

    if (path === "/api/intelligence/feed" && req.method === "GET") {
      return sendJson(res, 200, await intelligence.getFeed(Object.fromEntries(url.searchParams)));
    }

The event route validates a non-empty id and returns a 404 JSON object for unknown records.

- [ ] **Step 3: Verify route behavior.**

    curl -sS "http://127.0.0.1:8810/api/intelligence/feed?source=binance_activity"
    curl -i -sS "http://127.0.0.1:8810/api/intelligence/event?id=unknown"

Expected: feed includes items and source state; unknown id returns JSON 404 without worker exit.

- [ ] **Step 4: Commit worker routes.**

    git add backend/server/index.mjs backend/server/intelligence.mjs backend/test/intelligence.test.mjs
    git commit -m "feat: expose intelligence worker API"

### Task 4: Add local MCP intelligence tools and Agent routing

**Files:**
- Modify: backend/server/mcp-runtime.mjs
- Modify: backend/server/agent-chat.mjs
- Modify: backend/server/index.mjs
- Create: backend/test/agent-chat.test.mjs

**Interfaces:**
- Context adds getIntelligenceFeed(filters), getBinanceActivities(filters), and getEventMarketContext({ id }).
- MCP tools are exactly market_intelligence_feed, binance_activity_list, and event_market_context.
- routeIntent maps news, 资讯, and 公告 to market_intelligence_feed; 活动, 报名, launchpool, and 空投 map to binance_activity_list.

- [ ] **Step 1: Write a failing Chinese intent test.**

    test("routes activity query to activity tool", () => {
      const plan = routeIntent("Binance 最近有哪些活动可以参与？", "anomaly-binance", capabilities);
      assert.deepEqual(plan.toolNames, ["binance_activity_list"]);
    });

- [ ] **Step 2: Register read-only MCP tools.**

    server.registerTool("binance_activity_list", {
      title: "Binance 官方活动",
      description: "读取公开活动和原始规则链接；不代表报名资格，不执行报名。",
      inputSchema: { asset: z.string().optional(), limit: z.number().int().min(1).max(30).optional() },
    }, guardedTool(context, "binance_activity_list", (args) => context.getBinanceActivities(args)));

- [ ] **Step 3: Format replies with source, time, direct link, and stale notice.**

    cd backend && node --test test/agent-chat.test.mjs

Expected: PASS.

- [ ] **Step 4: Exercise the real agent endpoint.**

    curl -sS -X POST http://127.0.0.1:8810/api/agent/chat -H "content-type: application/json" --data "{\"message\":\"Binance 最近有哪些活动可以参与？\",\"strategy\":\"anomaly-binance\"}"

Expected: toolTrace contains binance_activity_list; output contains public links and no enrollment/account claim.

- [ ] **Step 5: Commit Agent support.**

    git add backend/server/mcp-runtime.mjs backend/server/agent-chat.mjs backend/server/index.mjs backend/test/agent-chat.test.mjs
    git commit -m "feat: add market intelligence MCP tools"

### Task 5: Build the standalone page and proxy

**Files:**
- Create: frontend/app/intelligence/page.tsx
- Create: frontend/app/components/IntelligencePage.tsx
- Create: frontend/app/api/intelligence/route.ts
- Modify: frontend/app/components/AppShell.tsx
- Modify: frontend/app/lib/data.ts
- Modify: frontend/app/lib/strategy-types.ts
- Modify: frontend/app/globals.css

**Interfaces:**
- loadIntelligenceFeed(filters) calls only /api/intelligence.
- The proxy validates source, type, asset, limit, and id then forwards to worker routes using the established 8-second timeout pattern.
- IntelligencePage shows source state, filters, original external links, and marketContext.

- [ ] **Step 1: Add front-end types and proxy validation.**

    export type IntelligenceItem = {
      id: string; title: string; source: string; type: "activity" | "announcement" | "news";
      publishedAt: string | null; url: string; assets: string[]; summary: string; stale?: boolean;
      marketContext?: { assets: Array<{ asset: string; change24hPct?: number; candidateStrategies: string[] }> };
    };

    const allowedSources = new Set(["all", "binance_activity", "binance_announcement", "binance_listing", "coindesk"]);
    if (!allowedSources.has(source)) return NextResponse.json({ error: "不支持的数据源" }, { status: 400 });

- [ ] **Step 2: Implement source-filtered cards and a separate official activity rail.**

    <a href={item.url} target="_blank" rel="noreferrer" className="intelligence-source-link">
      查看原文 <span aria-hidden="true">↗</span>
    </a>

The desktop layout is a summary strip followed by a two-column event and activity grid. Mobile collapses to one column. Scroll is contained within lists; text must wrap and never overlap.

- [ ] **Step 3: Add the route directly after Agent 对话 in AppShell.**

    { href: "/intelligence", label: "市场情报", icon: "◌" }

- [ ] **Step 4: Build and smoke-test the page.**

    cd frontend && npm run build
    curl -i -sS "http://localhost:4180/api/intelligence?source=invalid"

Expected: build PASS; invalid source is JSON 400; /intelligence shows source cards, filters, stale status, and external links without console errors.

- [ ] **Step 5: Commit the standalone page.**

    git add frontend/app/intelligence frontend/app/components/IntelligencePage.tsx frontend/app/api/intelligence frontend/app/components/AppShell.tsx frontend/app/lib frontend/app/globals.css
    git commit -m "feat: add market intelligence page"

### Task 6: Finish documentation and regression validation

**Files:**
- Modify: README.md
- Modify: docs/DEMO-SCRIPT.md
- Modify: docs/SUBMISSION.md

**Interfaces:**
- Documentation calls the feature 市场情报 and differentiates public Binance CMS/RSS sources from official Binance MCP authorization.

- [ ] **Step 1: Add this demo sequence.**

    打开市场情报，筛选 Binance 官方活动并展示规则链接和时间；打开关联 BTC 的事件，展示当前 24 小时行情和策略候选关系；回到 Agent 询问“最近有哪些 Binance 活动可以参与？”，展示 Tool Trace 与来源链接。

- [ ] **Step 2: Run focused backend tests without concurrent test processes.**

    cd backend && npm run test:intelligence && node --test test/agent-chat.test.mjs

Expected: PASS. Do not run a second worker against the live SQLite database.

- [ ] **Step 3: Run production and page checks.**

    cd frontend && npm run build
    node scripts/local-service.mjs status
    curl -sS http://127.0.0.1:8810/api/health

Expected: build PASS; frontend and worker normal; health JSON has ok=true.

- [ ] **Step 4: Validate diff and commit documentation.**

    git diff --check
    git add README.md docs/DEMO-SCRIPT.md docs/SUBMISSION.md
    git commit -m "docs: add intelligence demo flow"
