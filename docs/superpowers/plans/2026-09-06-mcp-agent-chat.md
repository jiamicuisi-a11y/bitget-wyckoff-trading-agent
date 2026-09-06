# Binance MCP Agent Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real MCP Client/Server tool path and a usable Chinese Agent chat page on top of the existing Binance public-data and Paper systems.

**Architecture:** Keep the existing Binance adapter and Paper worker as the source of truth. Add an in-process MCP Server/Client pair using the official MCP SDK, expose injected worker state through read-only tools, and route `POST /api/agent/chat` through a deterministic local Agent orchestrator that returns a Chinese answer plus tool trace. Add a separate Next.js chat page without changing the existing strategy pages or Paper accounting.

**Tech Stack:** Node 24+ ESM backend, `@modelcontextprotocol/sdk`, Zod schemas, Node built-in test runner, Next.js 14, React 18, existing CSS design system, Browser/IAB validation.

**Spec:** `docs/superpowers/specs/2026-09-06-mcp-agent-chat-design.md`

## Global Constraints

- Paper only: no API key, no real account, no signing, no broadcast, no withdrawal.
- Binance public endpoints remain the market-data source of truth.
- Existing A档, 双均线, automatic Paper worker, SQLite data, and `/api/agent/run` behavior remain compatible.
- Every chat response includes `mode: "paper"` and `broadcast: false`.
- Tool failures return understandable errors and preserve completed trace entries.
- Do not write secrets, screenshots, traces, or temporary scripts into the repository.

## File Map

- Create `backend/server/mcp-runtime.mjs`: MCP Server registration, in-memory transport, MCP Client connection, and tool-call helper.
- Create `backend/server/agent-chat.mjs`: local intent routing, MCP tool orchestration, answer formatting, and trace normalization.
- Create `backend/server/agent-chat.test.mjs`: tests for intent routing, tool ordering, response safety fields, and failure trace behavior.
- Modify `backend/package.json`: add the MCP SDK and Zod dependencies.
- Modify `backend/server/index.mjs`: retain latest Binance market snapshot, expose safe context functions, initialize MCP runtime lazily, and add `POST /api/agent/chat`.
- Create `frontend/app/api/agent/chat/route.ts`: Next.js proxy to the worker chat endpoint.
- Create `frontend/app/agent/page.tsx`: route entry.
- Create `frontend/app/components/AgentChatPage.tsx`: chat UI, strategy context selector, presets, messages, and tool trace.
- Modify `frontend/app/components/AppShell.tsx`: add the Agent 对话 navigation entry.
- Modify `frontend/app/globals.css`: chat layout, messages, tool trace, loading, error, and mobile styles.

### Task 1: Lock the Agent contract with failing tests

**Files:**
- Create: `backend/server/agent-chat.test.mjs`
- Create: `backend/server/mcp-runtime.test.mjs`

**Interfaces:**
- `routeIntent(message, fallbackStrategy) -> { intent, strategy, toolNames }`
- `formatAgentResponse(input) -> { reply, evidence, decision, mode, broadcast }`
- `createMcpRuntime(context) -> Promise<{ listTools(), callTool(name, args), close() }>`

- [ ] **Step 1: Write the failing tests**

```js
test("routes a market question through snapshot and strategy tools", () => {
  const routed = routeIntent("现在 Binance 市场有什么异动？", "anomaly-binance");
  assert.deepEqual(routed.toolNames, ["binance_market_snapshot", "strategy_evaluate"]);
  assert.equal(routed.strategy, "anomaly-binance");
});

test("routes dual-ma questions to the Binance 4H strategy", () => {
  const routed = routeIntent("双均线现在有没有金叉？", "anomaly-binance");
  assert.equal(routed.strategy, "dualma4h-binance");
  assert.deepEqual(routed.toolNames, ["strategy_evaluate", "paper_get_state"]);
});

test("response format always keeps the Paper safety boundary", () => {
  const response = formatAgentResponse({ strategy: "anomaly-binance", toolResults: [] });
  assert.equal(response.mode, "paper");
  assert.equal(response.broadcast, false);
  assert.match(response.reply, /Paper/);
});

test("MCP runtime discovers the read-only tool set", async () => {
  const runtime = await createMcpRuntime({
    getMarketSnapshot: async () => ({ source: "binance" }),
    getKlines: async () => [],
    getOpenInterest: async () => ({ symbol: "BTCUSDT" }),
    evaluateStrategy: async () => ({ strategy: "anomaly-binance" }),
    checkRisk: async () => ({ broadcast: false }),
    getPaperState: async () => ({ strategy: "anomaly-binance" }),
    getAuditRun: async () => null,
  });
  const tools = await runtime.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "binance_market_snapshot",
    "binance_get_klines",
    "binance_get_open_interest",
    "strategy_evaluate",
    "risk_check_paper_plan",
    "paper_get_state",
    "audit_get_run",
  ]);
  await runtime.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test backend/server/agent-chat.test.mjs backend/server/mcp-runtime.test.mjs`

Expected: FAIL because the new modules and MCP runtime do not exist yet.

### Task 2: Add the real MCP runtime

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Create: `backend/server/mcp-runtime.mjs`
- Modify: `backend/server/mcp-runtime.test.mjs`

**Interfaces:**
- `createMcpRuntime(context)` creates an `McpServer` and `Client`, connects them through `InMemoryTransport.createLinkedPair()`, and returns the client-facing helper.
- Tools use Zod input schemas and return JSON text plus structured JSON where supported.
- Tool names and inputs are fixed: `binance_market_snapshot({limit?})`, `binance_get_klines({strategy,symbol,granularity,limit?})`, `binance_get_open_interest({symbol})`, `strategy_evaluate({strategy})`, `risk_check_paper_plan({strategy,symbol?})`, `paper_get_state({strategy})`, `audit_get_run({runId})`.

- [ ] **Step 1: Add the MCP SDK dependency**

Run from `backend`: `npm install @modelcontextprotocol/sdk zod`

Expected: `backend/package.json` and `backend/package-lock.json` contain the two runtime dependencies without changing frontend dependencies.

- [ ] **Step 2: Implement the MCP Server registrations**

Register each tool with a description that states public-data/Paper-only boundaries. Each handler calls only the injected context function and returns a JSON-safe payload containing `source`, `asOf`, `mode`, and `broadcast` where relevant.

- [ ] **Step 3: Connect an MCP Client over the linked transport**

Return `listTools`, `callTool`, and `close` wrappers. `callTool` must throw an actionable error when the MCP server reports a tool failure, while leaving the caller responsible for trace persistence.

- [ ] **Step 4: Run the MCP tests to verify they pass**

Run: `node --test backend/server/mcp-runtime.test.mjs`

Expected: PASS with all seven tool names discovered.

### Task 3: Build the local Agent orchestrator

**Files:**
- Create: `backend/server/agent-chat.mjs`
- Modify: `backend/server/agent-chat.test.mjs`

**Interfaces:**
- `routeIntent(message, fallbackStrategy)` chooses one of `anomaly-binance` or `dualma4h-binance` and an ordered read-only tool list.
- `runAgentChat({ message, strategy, mcp })` calls tools sequentially, records `{name,status,args,resultSummary,asOf}`, and returns `{ok,reply,strategy,mode,toolTrace,evidence,decision,broadcast}`.
- No model API call is made in this first version; the module is deliberately provider-independent so a model adapter can later select the same MCP tools.

- [ ] **Step 1: Implement intent routing and response formatting**

Use explicit Chinese keyword groups: market/anomaly/异动/扫描 → snapshot + strategy; dual-ma/双均线/金叉/死叉 → dual-ma strategy + Paper state; position/持仓/开仓/止损/止盈/为什么 → Paper state + strategy evaluation + risk check; performance/收益/权益/回撤 → Paper state. Unknown questions use snapshot + Paper state and explain the supported scope.

- [ ] **Step 2: Implement sequential MCP calls with safe trace summaries**

Do not put full market arrays into the UI trace. Keep structured results in `evidence`, summarize counts/symbols/status for `toolTrace`, and preserve partial trace entries when a later tool fails.

- [ ] **Step 3: Add focused assertions for answers and failure handling**

Test that a market question calls both tools in order, a position question includes risk, every response is Paper-only, and a rejected tool produces `ok: false` with the failed tool name in the trace.

- [ ] **Step 4: Run the full backend unit tests**

Run: `node --test backend/server/*.test.mjs`

Expected: PASS, including the existing dual-MA explanation test.

### Task 4: Wire the worker context and chat HTTP endpoint

**Files:**
- Modify: `backend/server/index.mjs`
- Create: `frontend/app/api/agent/chat/route.ts`

**Interfaces:**
- `POST /api/agent/chat` accepts `{message: string, strategy?: "anomaly-binance"|"dualma4h-binance"}`.
- Success response is the `runAgentChat` result; error response is `{ok:false,error,toolTrace,broadcast:false}` with HTTP 400 for invalid input and 502 for worker/runtime failure.

- [ ] **Step 1: Retain the latest Binance market snapshot**

Add `latestMarketBySource.binance` after each successful `fetchMarket()` call. The MCP snapshot context returns only summary fields plus a bounded top-volume list, while the existing scanner still receives the complete rows.

- [ ] **Step 2: Add safe context functions in `index.mjs`**

Provide closures for market snapshot, K-lines, OI lookup from the latest rows/snapshot, strategy evaluation from `latestScanByStrategy`, Paper state from existing stats functions, risk checks using existing Paper config, and audit lookup using `getAgentRun`.

- [ ] **Step 3: Lazily initialize the MCP runtime**

Create one runtime promise after the worker context is available. Reuse it for requests and close it in the existing SIGINT/SIGTERM shutdown path.

- [ ] **Step 4: Add `POST /api/agent/chat`**

Validate message length (1–500 characters), restrict the strategy key to the two Binance strategies, invoke `runAgentChat`, and return JSON with `Cache-Control: no-store` through the existing `sendJson` helper.

- [ ] **Step 5: Add the Next.js proxy route**

Forward JSON to `${WORKER}/api/agent/chat` with the same timeout/error pattern as `frontend/app/api/agent/route.ts`; never accept or forward credentials.

- [ ] **Step 6: Smoke-test the endpoint**

Run: `curl -sS -X POST http://127.0.0.1:8810/api/agent/chat -H 'content-type: application/json' --data '{"message":"现在 Binance 市场有什么异动？","strategy":"anomaly-binance"}'`

Expected: JSON includes `ok:true`, a non-empty `reply`, at least two `toolTrace` entries, `mode:"paper"`, and `broadcast:false`.

### Task 5: Add the Agent chat page

**Files:**
- Create: `frontend/app/agent/page.tsx`
- Create: `frontend/app/components/AgentChatPage.tsx`
- Modify: `frontend/app/components/AppShell.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- The page sends only `{message,strategy}` to `/api/agent/chat`.
- Each assistant message renders `reply`, optional evidence highlights, and the MCP trace.
- The page exposes preset questions and a strategy selector, with disabled/loading/error states.

- [ ] **Step 1: Add the route and navigation link**

Use `/agent` and label it `Agent 对话`; place it in the Workspace navigation above the strategy workspaces.

- [ ] **Step 2: Implement the chat state machine**

Start with a welcome assistant message, keep local message history in React state, disable submit for empty/loading input, show a loading row while awaiting the proxy, append the response or a clear error, and allow Enter to send while Shift+Enter inserts a newline.

- [ ] **Step 3: Implement evidence and MCP Trace rendering**

Show tool name, status, compact result summary, and data time; show `Paper only · broadcast=false` in every assistant response. Avoid rendering raw JSON blobs or full 714-symbol arrays.

- [ ] **Step 4: Add responsive styles**

Use the existing graphite/yellow/cream design tokens. Desktop uses a two-column chat + context rail; mobile collapses to one column, keeps the composer reachable, and allows trace cards to wrap without horizontal overflow.

### Task 6: Verify the integrated experience

**Files:**
- Modify only files required by failing verification findings.

- [ ] **Step 1: Run backend tests and TypeScript/build checks**

Run: `node --test backend/server/*.test.mjs`

Run: `npm run build` from `frontend`

Expected: both commands pass without new warnings or type errors.

- [ ] **Step 2: Verify the target browser flow**

The flow under test is: `/agent` loads → choose A档 or 双均线 → click preset question or type a question → assistant answer renders → MCP tool trace and Paper safety state are visible.

Use the Browser/IAB path: page URL/title, DOM snapshot, console error/warn scan, screenshot, send-message interaction, and post-submit DOM state.

- [ ] **Step 3: Verify existing pages remain healthy**

Check `/radar/anomaly`, `/radar/dualma`, and `/connections` load with HTTP 200 and no browser console errors. Confirm the Paper worker health endpoint remains HTTP 200.

- [ ] **Step 4: Review the diff and report remaining limits**

Confirm no database reset, no credential files, no live-execution code, and no temporary QA artifact was added. Report that this first version uses a deterministic local Agent orchestrator; a future LLM adapter can reuse the MCP tool contract.
