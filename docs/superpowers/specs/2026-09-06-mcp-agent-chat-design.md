# Binance MCP Agent 对话层设计

## 目标

在现有 Binance Futures 公共行情 + 自动 Paper worker 之上，增加一个真实的 Model Context Protocol（MCP）工具层和网页 Agent 对话入口。用户可以用自然语言询问行情、策略、风险和模拟盘状态；Agent 的回答必须能够展示实际调用过的工具和关键结果。

本次范围仍然是 Track A / Paper only：不读取 API key，不连接真实账户，不签名，不广播，不下单，不提现。

## 当前基线

- `backend/server/sources.mjs` 直接读取 Binance Futures public REST API：ticker、premiumIndex、openInterest、klines。
- `backend/server/index.mjs` 每 120 秒运行策略扫描、自动 Paper 开平仓，并提供本地 HTTP API。
- `frontend/app/api/paper/route.ts` 是前端到 Paper worker 的只读代理。
- 现有 `/api/agent/run` 是固定五阶段的本地 Tool Layer，尚不是 MCP Client/Server。
- A 档和双均线 Binance 策略、SQLite Paper 账本和历史记录必须保持兼容。

## 方案

### 1. MCP Server

新增本地 MCP Server，使用官方 MCP SDK 和标准 MCP JSON-RPC 的进程内 linked transport，由本机 Agent runtime 建立 Client/Server 连接并调用。工具只允许读取公开数据、读取本地 Paper 状态和生成不可广播的分析计划。

首批工具：

- `binance_market_snapshot`：返回 Binance USDT 永续全市场摘要、覆盖率、数据时间。
- `binance_get_klines`：返回指定合约和周期的 K 线。
- `binance_get_open_interest`：返回指定合约 OI 和最近快照信息。
- `strategy_evaluate`：运行/读取 A 档或双均线的候选、评分和因子拆解。
- `risk_check_paper_plan`：按现有 Paper 参数检查止损、止盈、杠杆、并发和冷却。
- `paper_get_state`：返回权益、持仓、已平仓交易和最新扫描。
- `audit_get_run`：读取既有 Agent 运行记录。

工具返回结构化 JSON，并带 `source`、`asOf`、`mode` 和 `broadcast` 字段，方便页面展示证据边界。

### 2. Agent Runtime / MCP Client

新增本地 Agent runtime：

- 解析用户意图并选择工具调用顺序。
- 通过 MCP Client 调用上述 MCP Server，而不是绕过 MCP 直接访问数据层。
- 汇总工具结果，生成中文结构化回答：结论、证据、风险、Paper 计划和下一步。
- 默认使用本地确定性编排，不依赖模型 API key；保留可插拔的模型适配边界，后续可接入大模型而不改变 MCP 工具契约。
- 所有回答都标记为 Paper/公开数据，不将模拟结果描述为真实收益。

### 3. Chat API

新增本地接口 `POST /api/agent/chat`，请求：

```json
{
  "message": "现在 A 档为什么选择这个币？",
  "strategy": "anomaly-binance"
}
```

响应：

```json
{
  "ok": true,
  "reply": "...",
  "strategy": "anomaly-binance",
  "mode": "paper",
  "toolTrace": [],
  "evidence": {},
  "decision": {},
  "broadcast": false
}
```

错误时返回可理解的错误信息和已完成的工具调用，不泄露内部密钥或完整异常上下文。

### 4. 网页入口

新增独立的「Agent 对话」页面，并在主导航中加入入口。页面包含：

- 对话消息区和输入框。
- 预设问题按钮，便于黑客松演示。
- 当前策略上下文选择。
- 每次回答下方的 MCP Tool Trace：工具名、状态、关键参数摘要、数据时间和结果摘要。
- Paper only / broadcast=false 安全提示。
- 失败、无数据、过期数据和无候选状态。

聊天页面不替代 A 档和双均线工作台；工作台负责持续运行和可视化，聊天页负责主动询问、解释和审计。

## 数据流

```text
浏览器 Chat UI
  -> Next.js /api/agent/chat
  -> 本地 Agent runtime
  -> MCP Client (linked JSON-RPC transport)
  -> MCP Server
  -> Binance adapter / Paper ledger / strategy engine
  -> toolTrace + structured reply
  -> 浏览器展示回答与证据
```

## 安全与边界

- MCP Server 不暴露真实交易工具。
- 不读取、保存或转发 API key、Cookie、私钥、助记词。
- MCP 工具只允许公开行情、已有本地 Paper 数据和不可广播计划。
- 对外部 Binance 请求设置超时和错误降级；单一合约 OI 失败不阻断全市场扫描。
- 对话回答中的收益、权益和交易均明确标识为 Paper/模拟数据。

## 验收标准

1. MCP Server 能被本地 MCP Client 启动并完成工具发现。
2. 输入一个自然语言问题后，页面收到回答且显示至少一个真实 MCP 工具调用。
3. “现在市场有什么异动”能返回 Binance 数据时间、扫描数量和候选摘要。
4. “这笔交易为什么开仓”能读取策略因子、方向、入场、止损和止盈信息。
5. 工具失败时页面显示可理解的降级状态，不出现空白页或框架错误。
6. 现有 A 档、双均线、自动 Paper worker 和原有 `/api/agent/run` 行为不被破坏。
7. 浏览器验证：页面身份、内容渲染、控制台无相关错误、发送消息后状态发生变化。

## 不在本次范围

- 真实账户连接、真实下单、撤单、签名、提现。
- 强制接入某一家大模型或新增模型费用。
- 重写已有策略逻辑或清空 Paper 数据。
- 生产部署和公开发布。
