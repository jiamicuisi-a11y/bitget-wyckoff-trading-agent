import test from "node:test";
import assert from "node:assert/strict";
import { createMcpRuntime } from "./mcp-runtime.mjs";

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
    "binance_open_interest_leaders",
    "strategy_evaluate",
    "risk_check_paper_plan",
    "paper_get_state",
    "audit_get_run",
  ]);
  await runtime.close();
});

test("MCP client calls an injected read-only tool", async () => {
  const runtime = await createMcpRuntime({
    getMarketSnapshot: async ({ limit }) => ({ source: "binance", limit }),
    getKlines: async () => [],
    getOpenInterest: async () => ({ symbol: "BTCUSDT" }),
    evaluateStrategy: async () => ({ strategy: "anomaly-binance" }),
    checkRisk: async () => ({ broadcast: false }),
    getPaperState: async () => ({ strategy: "anomaly-binance" }),
    getAuditRun: async () => null,
  });
  const result = await runtime.callTool("binance_market_snapshot", { limit: 5 });
  assert.equal(result.source, "binance");
  assert.equal(result.limit, 5);
  await runtime.close();
});

test("MCP runtime exposes injected strategy metadata instead of a fixed enum", async () => {
  const runtime = await createMcpRuntime({
    getMarketSnapshot: async () => ({ source: "binance" }),
    getKlines: async ({ strategy }) => ({ strategy, candles: [] }),
    getOpenInterest: async () => ({ symbol: "BTCUSDT" }),
    evaluateStrategy: async ({ strategy }) => ({ strategy, candidateCount: 1 }),
    checkRisk: async () => ({ broadcast: false }),
    getPaperState: async ({ strategy }) => ({ strategy }),
    getAuditRun: async () => null,
  }, {
    strategies: [
      { key: "anomaly-binance", name: "A档", desc: "异动", kind: "scanner", source: "binance" },
      { key: "custom-binance", name: "自定义策略", desc: "动态策略", kind: "custom", source: "binance" },
    ],
  });
  const capabilities = await runtime.getCapabilities();
  assert.deepEqual(capabilities.strategies.map((strategy) => strategy.key), ["anomaly-binance", "custom-binance"]);
  assert.equal(capabilities.officialMcp.endpoint, "https://agent.binance.com/mcp/agentic");
  assert.equal(capabilities.officialMcp.status, "auth_required");
  const result = await runtime.callTool("strategy_evaluate", { strategy: "custom-binance" });
  assert.equal(result.strategy, "custom-binance");
  await runtime.close();
});
