import test from "node:test";
import assert from "node:assert/strict";
import { routeIntent, formatAgentResponse, runAgentChat } from "./agent-chat.mjs";

const capabilities = {
  strategies: [
    { key: "anomaly-binance", name: "A档 · 异动扫描（Binance）", desc: "公开行情异动" },
    { key: "dualma4h-binance", name: "双均线 · Binance 4H", desc: "4H EMA 趋势" },
    { key: "options-binance", name: "C档 · 期权套利（Binance）", desc: "期权机会研究" },
  ],
  tools: [
    { name: "binance_market_snapshot", title: "Binance Futures 市场快照" },
    { name: "binance_get_klines", title: "Binance K线" },
    { name: "binance_get_open_interest", title: "Binance 持仓量" },
    { name: "binance_open_interest_leaders", title: "Binance 全市场 OI 排名" },
    { name: "strategy_evaluate", title: "策略评估" },
    { name: "paper_get_state", title: "Paper 模拟盘状态" },
    { name: "risk_check_paper_plan", title: "Paper 风险检查" },
    { name: "audit_get_run", title: "审计运行记录" },
  ],
};

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

test("routes 30-minute box breakout questions to the box strategy", () => {
  const routed = routeIntent("现在有没有30分钟箱体突破？", "dualma4h-binance", {
    ...capabilities,
    strategies: [
      ...capabilities.strategies,
      { key: "box-breakout30m-binance", name: "30m 箱体突破（Binance）", desc: "30m 已收盘 K 线箱体突破" },
    ],
  });
  assert.equal(routed.strategy, "box-breakout30m-binance");
  assert.deepEqual(routed.toolNames, ["strategy_evaluate"]);
});

test("response format always keeps the Paper safety boundary", () => {
  const response = formatAgentResponse({ strategy: "anomaly-binance", toolResults: [] });
  assert.equal(response.mode, "paper");
  assert.equal(response.broadcast, false);
  assert.match(response.reply, /Paper/);
});

test("agent records the MCP tool order and returns evidence", async () => {
  const calls = [];
  const mcp = {
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === "binance_market_snapshot") {
        return { source: "binance", asOf: "2026-09-06T00:00:00.000Z", scannedCount: 714, topVolume: [] };
      }
      return { strategy: "anomaly-binance", candidateCount: 2, candidates: [{ symbol: "BTCUSDT", score: 61, direction: "long", tag: "多头共振" }] };
    },
  };
  const result = await runAgentChat({ message: "现在 Binance 市场有什么异动？", strategy: "anomaly-binance", mcp });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.name), ["binance_market_snapshot", "strategy_evaluate"]);
  assert.equal(result.broadcast, false);
  assert.equal(result.toolTrace.length, 2);
  assert.match(result.reply, /BTCUSDT/);
});

test("agent preserves a failed MCP tool in the trace", async () => {
  const mcp = {
    callTool: async (name) => {
      if (name === "binance_market_snapshot") throw new Error("Binance public API timeout");
      return {};
    },
  };
  const result = await runAgentChat({ message: "市场有什么异动？", strategy: "anomaly-binance", mcp });
  assert.equal(result.ok, false);
  assert.equal(result.broadcast, false);
  assert.equal(result.toolTrace[0].name, "binance_market_snapshot");
  assert.equal(result.toolTrace[0].status, "error");
  assert.match(result.reply, /失败|暂时/);
});

test("routes a capability question to the strategy discovered from MCP metadata", () => {
  const routed = routeIntent("C档期权套利有哪些机会？", "anomaly-binance", capabilities);
  assert.equal(routed.strategy, "options-binance");
  assert.deepEqual(routed.toolNames, ["strategy_evaluate"]);
});

test("routes K-line and open-interest questions without hardcoded strategy branches", () => {
  const routed = routeIntent("查看 BTCUSDT 的 K线和 OI", "anomaly-binance", capabilities);
  assert.deepEqual(routed.toolNames, ["binance_get_klines", "binance_get_open_interest"]);
  assert.deepEqual(routed.toolArgs.binance_get_klines, {
    strategy: "anomaly-binance",
    symbol: "BTCUSDT",
    granularity: "4H",
    limit: 120,
  });
  assert.deepEqual(routed.toolArgs.binance_get_open_interest, { symbol: "BTCUSDT" });
});

test("formats a dynamic MCP capability overview", () => {
  const response = formatAgentResponse({
    strategy: "options-binance",
    intent: "capabilities",
    capabilities,
    toolResults: [],
  });
  assert.match(response.reply, /C档 · 期权套利（Binance）/);
  assert.match(response.reply, /binance_get_klines/);
});

test("routes a market-wide OI window question to the OI leaders MCP tool", () => {
  const routed = routeIntent("15分钟内OI上升的代币有哪些？", "anomaly-binance", capabilities);
  assert.equal(routed.intent, "open_interest_leaders");
  assert.deepEqual(routed.toolNames, ["binance_open_interest_leaders"]);
  assert.deepEqual(routed.toolArgs.binance_open_interest_leaders, { windowMinutes: 15, limit: 10 });
  assert.equal(routed.needsInput, false);
});

test("formats an OI leaders response without pretending history is ready", () => {
  const response = formatAgentResponse({
    strategy: "anomaly-binance",
    intent: "open_interest_leaders",
    capabilities,
    toolResults: [{
      name: "binance_open_interest_leaders",
      result: {
        requestedWindowMinutes: 15,
        observedMinutes: 6,
        ready: false,
        coverage: { scannedCount: 714, baselineCount: 0, missingBaselineCount: 714 },
        leaders: [],
        asOf: "2026-09-06T00:06:00.000Z",
      },
    }],
  });
  assert.match(response.reply, /15 分钟/);
  assert.match(response.reply, /6 分钟/);
  assert.match(response.reply, /历史窗口|积累/);
  assert.doesNotMatch(response.reply, /请告诉我.*合约/);
});
