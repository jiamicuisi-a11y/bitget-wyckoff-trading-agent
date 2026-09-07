import { listStrategies as listRegisteredStrategies } from "./strategies.mjs";

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

function defaultCapabilities() {
  return {
    strategies: listRegisteredStrategies()
      .filter((strategy) => strategy.source === "binance")
      .map(({ key, name, desc, kind, source }) => ({ key, name, desc, kind, source })),
    tools: [],
  };
}

function normalizeCapabilities(capabilities = {}) {
  const fallback = defaultCapabilities();
  return {
    strategies: Array.isArray(capabilities.strategies) && capabilities.strategies.length
      ? capabilities.strategies
      : fallback.strategies,
    tools: Array.isArray(capabilities.tools) ? capabilities.tools : fallback.tools,
  };
}

function strategyLabel(strategyKey, capabilities) {
  return normalizeCapabilities(capabilities).strategies.find((item) => item.key === strategyKey)?.name || strategyKey || "当前策略";
}

function strategyAliases(strategy) {
  const generic = new Set(["binance", "bitget", "okx", "scanner", "kline", "custom"]);
  const aliases = [];
  for (const value of [strategy.key, strategy.name, strategy.desc].filter(Boolean)) {
    const normalized = String(value).toLowerCase();
    aliases.push(normalized);
    aliases.push(...normalized.split(/[\s·|/（）()：:,]+/));
  }
  if (String(strategy.key).includes("box-breakout")) aliases.push("箱体", "箱体突破", "30分钟", "30m", "突破");
  return [...new Set(aliases)].filter((value) => value.length >= 2 && !generic.has(value));
}

function chooseStrategy(text, capabilities, fallbackStrategy) {
  const strategies = normalizeCapabilities(capabilities).strategies;
  const matches = strategies.flatMap((strategy) => strategyAliases(strategy)
    .filter((alias) => text.includes(alias))
    .map((alias) => ({ strategy, alias })));
  matches.sort((a, b) => b.alias.length - a.alias.length);
  if (matches[0]) return matches[0].strategy.key;
  if (strategies.some((strategy) => strategy.key === fallbackStrategy)) return fallbackStrategy;
  return strategies[0]?.key || fallbackStrategy || null;
}

function extractSymbol(text) {
  const match = text.match(/(?:^|[^a-z0-9])([a-z0-9]{3,20}usdt)(?:[^a-z0-9]|$)/i);
  return match?.[1]?.toUpperCase() || null;
}

function extractRunId(text) {
  return text.match(/\b(?:agent|run)-[a-z0-9_-]+\b/i)?.[0] || null;
}

function inferGranularity(text) {
  if (text.includes("30m") || text.includes("30分钟") || text.includes("30 分钟")) return "30m";
  if (text.includes("1h")) return "1H";
  if (text.includes("1d") || text.includes("日线")) return "1D";
  if (text.includes("1w") || text.includes("周线")) return "1W";
  return "4H";
}

function extractWindowMinutes(text) {
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|小時|h)/i);
  if (hourMatch) return Math.max(1, Math.min(Math.round(Number(hourMatch[1]) * 60), 1440));
  const minuteMatch = text.match(/(\d+)\s*(?:分钟|分鐘|分|min|m)/i);
  if (minuteMatch) return Math.max(1, Math.min(Number(minuteMatch[1]), 1440));
  return 15;
}

function extractLimit(text) {
  const match = text.match(/(?:前|top|排名前|取前)\s*(\d{1,2})/i) || text.match(/(\d{1,2})\s*(?:个|只)\s*(?:代币|合约)/);
  if (!match) return 10;
  return Math.max(1, Math.min(Number(match[1]), 50));
}

function toolIsAvailable(name, capabilities) {
  const tools = normalizeCapabilities(capabilities).tools;
  return tools.length === 0 || tools.some((tool) => tool.name === name);
}

function addTool(plan, name, args, capabilities) {
  if (!toolIsAvailable(name, capabilities) || plan.toolNames.includes(name)) return;
  plan.toolNames.push(name);
  plan.toolArgs[name] = args;
}

export function routeIntent(message, fallbackStrategy, capabilities = {}) {
  const text = String(message || "").toLowerCase();
  const normalized = normalizeCapabilities(capabilities);
  const strategy = chooseStrategy(text, normalized, fallbackStrategy);
  const symbol = extractSymbol(text);
  const plan = { strategy, intent: "overview", toolNames: [], toolArgs: {}, needsInput: false, prompt: null };
  const strategyMatched = normalized.strategies.some((item) => item.key === strategy && strategyAliases(item).some((alias) => text.includes(alias)));
  const wantsCapabilities = hasAny(text, ["能做什么", "可以做什么", "支持什么", "有哪些工具", "mcp能力", "mcp 工具", "工具清单"]);
  const wantsKlines = hasAny(text, ["k线", "k 线", "蜡烛", "走势图", "历史价格"]);
  const wantsOi = hasAny(text, ["oi", "持仓量", "未平仓", "open interest"]);
  const wantsOiLeaders = wantsOi && !symbol && (
    /\d+\s*(?:分钟|分鐘|分|min|m|小时|小時|h)/i.test(text)
      || hasAny(text, ["哪些", "哪几个", "哪幾個", "上升", "增加", "排名", "排行", "全市场", "全市場", "涨幅"])
  );
  const wantsAudit = hasAny(text, ["运行记录", "审计", "run id", "run-id", "agent-"]);
  const wantsRisk = hasAny(text, ["风险", "风控", "止损", "止盈", "杠杆", "风险闸门"]);
  const wantsPosition = hasAny(text, ["持仓", "仓位", "开仓", "交易理由", "为什么"]);
  const wantsPerformance = hasAny(text, ["收益", "权益", "回撤", "胜率", "表现", "绩效", "盈亏"]);
  const wantsMarket = hasAny(text, ["异动", "市场", "扫描", "行情", "机会", "候选", "合约", "成交量", "快照", "signal", "market"]);
  const wantsSignal = hasAny(text, ["策略", "信号", "金叉", "死叉", "均线", "ema", "套利", "箱体", "突破"]);

  if (wantsCapabilities) return { ...plan, intent: "capabilities" };

  if (wantsAudit) {
    const runId = extractRunId(text);
    if (!runId) return { ...plan, intent: "clarify", needsInput: true, prompt: "请提供运行记录 ID，例如 agent-1234567890-ab12，我再通过 MCP 读取这条审计记录。" };
    addTool(plan, "audit_get_run", { runId }, normalized);
    return { ...plan, intent: "audit" };
  }

  if (wantsOiLeaders) {
    addTool(plan, "binance_open_interest_leaders", {
      windowMinutes: extractWindowMinutes(text),
      limit: extractLimit(text),
    }, normalized);
    return { ...plan, intent: "open_interest_leaders" };
  }

  if (wantsKlines || wantsOi) {
    if (!symbol) return { ...plan, intent: "clarify", needsInput: true, prompt: "请告诉我要查询哪个 Binance 合约，例如 BTCUSDT。" };
    if (wantsKlines) addTool(plan, "binance_get_klines", { strategy, symbol, granularity: inferGranularity(text), limit: 120 }, normalized);
    if (wantsOi) addTool(plan, "binance_get_open_interest", { symbol }, normalized);
    return { ...plan, intent: wantsKlines ? "klines" : "open_interest" };
  }

  if (wantsPosition || wantsRisk) {
    plan.intent = "position";
    addTool(plan, "paper_get_state", { strategy }, normalized);
    addTool(plan, "strategy_evaluate", { strategy }, normalized);
    addTool(plan, "risk_check_paper_plan", { strategy, ...(symbol ? { symbol } : {}) }, normalized);
    return plan;
  }

  if (wantsPerformance) {
    addTool(plan, "paper_get_state", { strategy }, normalized);
    return { ...plan, intent: "performance" };
  }

  if (strategyMatched || wantsSignal) {
    addTool(plan, "strategy_evaluate", { strategy }, normalized);
    if (hasAny(text, ["金叉", "死叉", "现在怎么样", "当前状态"])) addTool(plan, "paper_get_state", { strategy }, normalized);
    return { ...plan, intent: "market" };
  }

  if (wantsMarket) {
    addTool(plan, "binance_market_snapshot", { limit: 8 }, normalized);
    addTool(plan, "strategy_evaluate", { strategy }, normalized);
    return { ...plan, intent: "market" };
  }

  addTool(plan, "binance_market_snapshot", { limit: 8 }, normalized);
  addTool(plan, "paper_get_state", { strategy }, normalized);
  return plan;
}

function compactNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "—";
}

function resultSummary(name, result) {
  const value = result && typeof result === "object" ? result : {};
  if (name === "binance_market_snapshot") return `扫描 ${value.scannedCount ?? "—"} 个合约，数据时间 ${value.asOf || "—"}`;
  if (name === "strategy_evaluate") return `${value.strategy || "策略"}：${value.candidateCount ?? value.candidates?.length ?? 0} 个候选`;
  if (name === "paper_get_state") return `权益 $${compactNumber(value.stats?.equity ?? value.equity, 2)}，持仓 ${value.positions?.length ?? 0}`;
  if (name === "risk_check_paper_plan") return value.pass === false ? "风险检查未通过" : "Paper 风险边界已检查";
  if (name === "binance_get_klines") return `${value.symbol || "合约"} 返回 ${value.candles?.length ?? 0} 根 K 线`;
  if (name === "binance_get_open_interest") return `${value.symbol || "合约"} OI 已读取`;
  if (name === "binance_open_interest_leaders") {
    const window = value.requestedWindowMinutes ?? "—";
    const count = value.leaders?.length ?? 0;
    return value.ready === false
      ? `OI ${window} 分钟历史未准备好，已积累 ${value.observedMinutes ?? 0} 分钟`
      : `OI ${window} 分钟排名返回 ${count} 个合约`;
  }
  if (name === "audit_get_run") return value.runId ? `已读取运行记录 ${value.runId}` : "未找到运行记录";
  return "工具调用完成";
}

function firstResult(toolResults, name) {
  return toolResults.find((item) => item.name === name)?.result || null;
}

function candidateLines(strategyResult) {
  const candidates = strategyResult?.candidates || strategyResult?.hits || [];
  if (!candidates.length) return "当前没有可展示的达标候选。";
  return candidates.slice(0, 5).map((candidate, index) => {
    const symbol = candidate.symbol || "未知合约";
    const direction = candidate.direction === "short" ? "做空" : "做多";
    const reason = candidate.tag || candidate.reason || "策略条件满足";
    return `${index + 1}. ${symbol} · ${direction} · 评分 ${candidate.score ?? "—"} · ${reason}`;
  }).join("\n");
}

function buildOpportunityPlans(strategyResult) {
  const candidates = strategyResult?.candidates || strategyResult?.hits || [];
  return candidates.slice(0, 8).map((candidate) => {
    const entry = Number(candidate.lastPrice || 0);
    const boxBreakout = String(strategyResult?.strategy || "").includes("box-breakout");
    const stopPct = boxBreakout ? 5 : 3;
    const targetPct = boxBreakout ? 10 : 6;
    const long = candidate.direction !== "short";
    return {
      symbol: candidate.symbol,
      direction: candidate.direction,
      score: candidate.score,
      reason: candidate.tag || candidate.reason || "策略条件满足",
      entryPrice: entry,
      stopPrice: entry > 0 ? entry * (long ? 1 - stopPct / 100 : 1 + stopPct / 100) : null,
      targetPrice: entry > 0 ? entry * (long ? 1 + targetPct / 100 : 1 - targetPct / 100) : null,
      status: "ready_for_paper_plan",
      broadcast: false,
    };
  });
}

export function formatAgentResponse({ strategy, intent = "overview", toolResults = [], capabilities = {} }) {
  const normalized = normalizeCapabilities(capabilities);
  const market = firstResult(toolResults, "binance_market_snapshot");
  const strategyResult = firstResult(toolResults, "strategy_evaluate");
  const paper = firstResult(toolResults, "paper_get_state");
  const risk = firstResult(toolResults, "risk_check_paper_plan");
  const klines = firstResult(toolResults, "binance_get_klines");
  const oi = firstResult(toolResults, "binance_get_open_interest");
  const oiLeaders = firstResult(toolResults, "binance_open_interest_leaders");
  const audit = firstResult(toolResults, "audit_get_run");
  const label = strategyLabel(strategy, normalized);
  const stats = paper?.stats || {};
  const scannedCount = market?.scannedCount ?? strategyResult?.scannedCount ?? "—";
  const dataAsOf = market?.asOf || strategyResult?.asOf || paper?.asOf || klines?.asOf || oi?.asOf || oiLeaders?.asOf || null;
  const opportunities = buildOpportunityPlans(strategyResult);
  let reply = `这是 ${label} 的 Binance Futures 公开数据分析，当前只在 Paper 模式运行。`;

  if (intent === "capabilities") {
    const strategies = normalized.strategies.map((item) => `- ${item.name || item.key}：${item.desc || "可由 Agent 调用"}`).join("\n");
    const tools = normalized.tools.length
      ? normalized.tools.map((tool) => `- ${tool.name}：${tool.title || tool.description || "MCP 工具"}`).join("\n")
      : "当前 MCP 工具清单暂不可用。";
    reply = `当前 Binance MCP Agent 可用能力：\n\n策略：\n${strategies || "暂无已注册策略"}\n\n工具：\n${tools}`;
  } else if (intent === "klines") {
    reply += `\n\n${klines?.symbol || "指定合约"} 的 ${klines?.granularity || "4H"} K 线已读取，共 ${klines?.candles?.length ?? 0} 根。数据时间：${dataAsOf || "—"}。`;
  } else if (intent === "open_interest") {
    reply += `\n\n${oi?.symbol || "指定合约"} 当前 OI：${compactNumber(oi?.openInterest, 2)}；相对上一快照变化：${compactNumber(oi?.changePct, 2)}%。`;
  } else if (intent === "open_interest_leaders") {
    const window = oiLeaders?.requestedWindowMinutes ?? 15;
    const observed = oiLeaders?.observedMinutes ?? 0;
    const coverage = oiLeaders?.coverage || {};
    if (oiLeaders?.ready === false) {
      reply += `\n\n全市场 OI 上升排名的 ${window} 分钟历史窗口还未准备好，当前只积累了 ${observed} 分钟数据。已扫描 ${coverage.scannedCount ?? "—"} 个合约，继续运行扫描后才会给出真实排名。`;
    } else {
      const leaders = oiLeaders?.leaders || [];
      const lines = leaders.length
        ? leaders.map((leader, index) => `${index + 1}. ${leader.symbol} · OI 上升 ${compactNumber(leader.changePct, 2)}% · 当前 OI ${compactNumber(leader.currentOi, 2)}`).join("\n")
        : "当前窗口内没有 OI 上升的合约。";
      reply += `\n\n过去 ${window} 分钟 OI 上升排名（覆盖 ${coverage.scannedCount ?? "—"} 个合约）：\n${lines}`;
    }
  } else if (intent === "audit") {
    reply += `\n\n已读取运行记录 ${audit?.runId || "—"}，记录${audit?.run ? "存在" : "未找到"}。`;
  } else if (intent === "market") {
    reply += `\n\n本轮数据覆盖 ${scannedCount} 个 USDT 永续合约，数据时间：${dataAsOf || "等待下一轮扫描"}。`;
    reply += `\n\n候选摘要：\n${candidateLines(strategyResult)}`;
  } else if (intent === "position") {
    const positions = paper?.positions || [];
    reply += `\n\n当前权益：$${compactNumber(stats.equity ?? paper?.equity, 2)}；持仓 ${positions.length} 个。`;
    reply += `\n\n策略候选：\n${candidateLines(strategyResult)}`;
    reply += `\n\n风险结论：${risk?.summary || (risk?.pass === false ? "存在未通过项，请查看风险闸门。" : "止损、杠杆、并发和 Paper 边界已检查。")}`;
  } else if (intent === "performance") {
    reply += `\n\n当前权益：$${compactNumber(stats.equity ?? paper?.equity, 2)}；累计收益：${compactNumber(stats.totalReturnPct ?? paper?.totalReturnPct, 2)}%；胜率：${compactNumber(stats.winRate, 2)}%；最大回撤：${compactNumber(stats.maxDrawdownPct, 2)}%。`;
  } else if (intent === "clarify") {
    reply = "为了安全调用对应的 Binance MCP 工具，我还需要一个参数。";
  } else {
    reply += `\n\n我可以帮你查看 Binance 市场、已注册策略、K 线、OI、Paper 持仓、绩效、风险和审计记录。当前权益：$${compactNumber(stats.equity ?? paper?.equity, 2)}。`;
  }

  reply += "\n\n以上均为公开行情与本地模拟数据，不构成真实交易建议。";
  return {
    reply,
    evidence: {
      source: "binance-public-data",
      asOf: dataAsOf,
      candidateCount: strategyResult?.candidateCount ?? strategyResult?.candidates?.length ?? strategyResult?.hits?.length ?? oiLeaders?.leaders?.length ?? 0,
      positionCount: paper?.positions?.length ?? 0,
    },
    decision: risk || { requiresHumanConfirmation: true },
    opportunities,
    riskGate: risk || null,
    mode: "paper",
    broadcast: false,
  };
}

async function resolveCapabilities(mcp) {
  if (typeof mcp?.getCapabilities === "function") return mcp.getCapabilities();
  const capabilities = defaultCapabilities();
  if (typeof mcp?.listTools === "function") capabilities.tools = await mcp.listTools();
  return capabilities;
}

export async function runAgentChat({ message, strategy, mcp }) {
  const capabilities = await resolveCapabilities(mcp);
  const routed = routeIntent(message, strategy, capabilities);
  if (routed.needsInput) {
    return {
      ok: true,
      strategy: routed.strategy,
      intent: routed.intent,
      toolTrace: [],
      ...formatAgentResponse({ strategy: routed.strategy, intent: "clarify", capabilities }),
      reply: `${routed.prompt}\n\n当前仍保持 Paper 模式，未发送任何真实订单。`,
    };
  }

  const toolTrace = [];
  const toolResults = [];
  for (const name of routed.toolNames) {
    const args = routed.toolArgs[name] || {};
    try {
      const result = await mcp.callTool(name, args);
      toolResults.push({ name, result });
      toolTrace.push({ name, status: "ok", args, resultSummary: resultSummary(name, result), asOf: result?.asOf || null });
    } catch (error) {
      toolTrace.push({ name, status: "error", args, resultSummary: error?.message || "工具调用失败", asOf: null });
      return {
        ok: false,
        reply: `Agent 暂时无法完成这次分析：${error?.message || "MCP 工具调用失败"}。请稍后重试。\n\n当前仍保持 Paper 模式，未发送任何真实订单。`,
        strategy: routed.strategy,
        intent: routed.intent,
        mode: "paper",
        toolTrace,
        evidence: { partial: true },
        decision: { requiresHumanConfirmation: true },
        broadcast: false,
      };
    }
  }

  const formatted = formatAgentResponse({ strategy: routed.strategy, intent: routed.intent, toolResults, capabilities });
  return { ok: true, strategy: routed.strategy, intent: routed.intent, toolTrace, ...formatted };
}
