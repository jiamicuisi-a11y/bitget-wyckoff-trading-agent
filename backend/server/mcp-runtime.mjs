import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listStrategies as listRegisteredStrategies } from "./strategies.mjs";

export const OFFICIAL_BINANCE_MCP = {
  name: "Binance MCP Server",
  endpoint: "https://agent.binance.com/mcp/agentic",
  docsUrl: "https://developers.binance.com/en/docs/agent-native/mcp-server/agentic",
  status: "auth_required",
  scopes: ["Market data", "Account", "Trade"],
  note: "需要在官方 Agent OS 客户端完成授权；本地 Demo 默认不保存凭证、不执行真实交易。",
};

function defaultBinanceStrategies() {
  return listRegisteredStrategies().filter((strategy) => strategy.source === "binance");
}

function jsonResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function guardedTool(context, name, handler) {
  return async (args) => {
    try {
      const result = await handler(args || {});
      return jsonResult(result);
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: `${name} 失败：${error?.message || "未知错误"}` }) }],
      };
    }
  };
}

function withSafety(payload, extra = {}) {
  return {
    ...payload,
    ...extra,
    mode: "paper",
    broadcast: false,
  };
}

export async function createMcpRuntime(context, options = {}) {
  const strategyCatalog = (options.strategies || defaultBinanceStrategies())
    .filter((strategy) => strategy?.source === "binance")
    .map((strategy) => ({
      key: strategy.key,
      name: strategy.name,
      desc: strategy.desc,
      kind: strategy.kind,
      source: strategy.source,
    }));
  if (!strategyCatalog.length) throw new Error("MCP 没有可用的 Binance 策略");
  const strategyKeys = strategyCatalog.map((strategy) => strategy.key);
  const strategyEnum = z.enum(strategyKeys);
  const server = new McpServer({ name: "binance-strategy-agent", version: "1.0.0" });

  server.registerTool(
    "binance_market_snapshot",
    {
      title: "Binance Futures 市场快照",
      description: "读取 Binance Futures USDT 永续公开行情摘要，只读，不需要 API key。",
      inputSchema: { limit: z.number().int().min(1).max(20).optional() },
    },
    guardedTool(context, "binance_market_snapshot", async ({ limit = 10 }) => withSafety(await context.getMarketSnapshot({ limit }), { source: "binance" }))
  );

  server.registerTool(
    "binance_get_klines",
    {
      title: "Binance K线",
      description: "读取指定 Binance Futures 合约的历史 K 线，只读。",
      inputSchema: {
        strategy: strategyEnum,
        symbol: z.string().min(3).max(20),
        granularity: z.enum(["30m", "30M", "1H", "4H", "1D", "1W"]),
        limit: z.number().int().min(20).max(500).optional(),
      },
    },
    guardedTool(context, "binance_get_klines", async (args) => withSafety(await context.getKlines(args), { source: "binance" }))
  );

  server.registerTool(
    "binance_get_open_interest",
    {
      title: "Binance 持仓量",
      description: "读取指定 Binance Futures 合约最新 OI 和快照变化，只读。",
      inputSchema: { symbol: z.string().min(3).max(20) },
    },
    guardedTool(context, "binance_get_open_interest", async ({ symbol }) => withSafety(await context.getOpenInterest({ symbol }), { source: "binance" }))
  );

  server.registerTool(
    "binance_open_interest_leaders",
    {
      title: "Binance 全市场 OI 排名",
      description: "读取 Binance USDT 永续全市场在指定时间窗口内 OI 上升的合约排名，只读；需要本地历史快照达到窗口后才会返回结果。",
      inputSchema: {
        windowMinutes: z.number().int().min(1).max(1440).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    guardedTool(context, "binance_open_interest_leaders", async (args) => withSafety(await context.getOpenInterestLeaders(args), { source: "binance" }))
  );

  server.registerTool(
    "market_intelligence_feed",
    {
      title: "市场资讯与公告",
      description: "读取 Binance 中文站和中文行业资讯源的公开活动、公告与资讯，保留来源与原文链接；不使用账户数据。",
      inputSchema: {
        source: z.enum(["all", "binance_activity", "binance_announcement", "binance_listing", "panews"]).optional(),
        type: z.enum(["all", "activity", "announcement", "news"]).optional(),
        asset: z.string().min(2).max(12).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    guardedTool(context, "market_intelligence_feed", async (args) => withSafety(await context.getIntelligenceFeed(args), { source: "public-intelligence" }))
  );

  server.registerTool(
    "binance_activity_list",
    {
      title: "Binance 官方活动",
      description: "读取公开 Binance 活动和原始规则链接；不代表报名资格，也不会执行报名。",
      inputSchema: { asset: z.string().min(2).max(12).optional(), limit: z.number().int().min(1).max(30).optional() },
    },
    guardedTool(context, "binance_activity_list", async (args) => withSafety(await context.getBinanceActivities(args), { source: "binance-public-cms" }))
  );

  server.registerTool(
    "event_market_context",
    {
      title: "事件市场关联",
      description: "读取公开事件关联的 Binance Futures 行情和策略候选，不推断事件与价格的因果关系。",
      inputSchema: { id: z.string().min(3).max(240) },
    },
    guardedTool(context, "event_market_context", async ({ id }) => withSafety(await context.getEventMarketContext({ id }), { source: "public-intelligence" }))
  );

  server.registerTool(
    "strategy_evaluate",
    {
      title: "策略评估",
      description: "读取已注册的 Binance 策略候选、评分和解释，只生成研究结果。",
      inputSchema: { strategy: strategyEnum },
    },
    guardedTool(context, "strategy_evaluate", async ({ strategy }) => withSafety(await context.evaluateStrategy({ strategy }), { source: "binance" }))
  );

  server.registerTool(
    "risk_check_paper_plan",
    {
      title: "Paper 风险检查",
      description: "按照本地 Paper 参数检查风险边界，不会产生真实订单。",
      inputSchema: { strategy: strategyEnum, symbol: z.string().min(3).max(20).optional() },
    },
    guardedTool(context, "risk_check_paper_plan", async (args) => withSafety(await context.checkRisk(args), { source: "local-paper" }))
  );

  server.registerTool(
    "paper_get_state",
    {
      title: "Paper 模拟盘状态",
      description: "读取指定策略的本地权益、持仓、已平仓交易和最新扫描，只读。",
      inputSchema: { strategy: strategyEnum },
    },
    guardedTool(context, "paper_get_state", async ({ strategy }) => withSafety(await context.getPaperState({ strategy }), { source: "local-paper" }))
  );

  server.registerTool(
    "audit_get_run",
    {
      title: "审计运行记录",
      description: "读取已有 Agent 运行记录，只读。",
      inputSchema: { runId: z.string().min(1).max(120) },
    },
    guardedTool(context, "audit_get_run", async ({ runId }) => withSafety(await context.getAuditRun({ runId }), { source: "local-paper" }))
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "binance-strategy-agent-client", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    async listTools() {
      const result = await client.listTools();
      return result.tools || [];
    },
    async getCapabilities() {
      return {
        server: { name: "binance-strategy-agent", version: "1.0.0" },
        officialMcp: OFFICIAL_BINANCE_MCP,
        strategies: strategyCatalog,
        tools: await this.listTools(),
      };
    },
    async callTool(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        const errorText = result.content?.find((item) => item.type === "text")?.text || `${name} 调用失败`;
        let parsed;
        try { parsed = JSON.parse(errorText); } catch { parsed = null; }
        throw new Error(parsed?.error || errorText);
      }
      const text = result.content?.find((item) => item.type === "text")?.text;
      if (!text) return {};
      try { return JSON.parse(text); } catch { return { text }; }
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
