# Agent OS · Strategy Copilot

Binance Agent OS Mini Hackathon Track A prototype：一个面向交易研究与模拟执行的 AI Agent 控制台。

它复用了此前 Bitget Hackathon 项目中的两套 Paper 策略：

- **A档异动扫描**：综合 OI、24h 价格、成交额、盘口和资金费率，筛选异动机会。
- **双均线 4H**：对 Binance USDT 永续成交额 Top30 计算 EMA(10/30)，捕捉金叉/死叉趋势段。

当前版本将两套策略接入 Binance Futures 公开行情，并用 Agent OS 风格的工作流呈现：

```text
自然语言扫描 → 候选卡片 → K 线解释 → 风险闸门 → Paper 确认 → 审计记录
```

## Local preview

需要 Node.js 24+（Paper worker 使用 Node 原生 SQLite）：

```bash
node scripts/local-service.mjs start
```

这会先构建正式页面，再在后台稳定运行前端和 Paper worker；关闭启动终端不会让站点下线。录屏前可检查：

```bash
node scripts/local-service.mjs status
```

需要停止时：

```bash
node scripts/local-service.mjs stop
```

- Frontend: http://localhost:4180
- Paper worker: http://localhost:8810

页面默认展示 Binance 版 A档异动扫描和双均线 4H。旧的 Bitget/OKX 策略仍注册在 worker 中，便于横向对照。

## Binance Agent OS / MCP

项目包含一个基于官方 MCP SDK 的本地 Client ↔ Server 工具层，供网页 Agent 对话调用公开行情、策略评估、Paper 状态、风控和审计工具。页面同时明确展示官方 Binance MCP Server 的正式端点：

```text
https://agent.binance.com/mcp/agentic
```

官方 MCP 的账户授权必须在 Binance Agent OS 支持的客户端中由用户完成；本项目不会保存凭证，也不会把本地 Paper Demo 伪装成已授权的官方账户连接。官方连接文档见 [`docs/BINANCE-MCP.md`](docs/BINANCE-MCP.md)。

## 市场情报

侧边栏的“市场情报”汇集 Binance 中文站的官方活动、公告和上币公告。每条内容保留来源、发布时间和中文原文链接，并只读关联当前公开行情及策略候选。数据请求设有超时与本地缓存回退，单一资讯源不可用不会影响模拟盘服务。

这里的 Binance 活动和公告来自公开 CMS，不是 Binance MCP 授权结果；页面不读取账户、不判断资格、不替用户报名。官方 Binance MCP 仍仅通过用户在受支持客户端中完成的授权连接使用。

## Safety boundary

- 所有策略仍为 PAPER MODE，仅使用公开行情和本地 SQLite 模拟账本。
- 当前不连接账户、不读取 API key、不签名、不广播、不充值提现、不发送真实订单。
- 策略 worker 会自动按周期扫描并管理 Paper 持仓；页面不需要“运行一次”或“刷新扫描”。Agent Tool Layer 仍保留为可审计的只读编排入口。

## Track A demo story

Demo 建议按 2–3 分钟讲清楚：先在“市场情报”筛选 Binance 官方活动、展示原文规则链接与当前市场关联；再输入“扫描全市场” → Agent 读取 Binance 行情并返回结构化候选 → 点击候选查看 K 线、计划入场/止损/止盈 → 生成 Paper plan → Risk Gate 解释边界 → 确认后写入本地 Paper 账本并打开运行记录。

- 录屏脚本：`docs/DEMO-SCRIPT.md`
- 提交文案：`docs/SUBMISSION.md`
- 架构说明：`docs/ARCHITECTURE.md`
- 比赛准备清单：`docs/COMPETITION-READINESS.md`
- 官方 MCP 接入说明：`docs/BINANCE-MCP.md`

## Project layout

- `frontend/app/components/AgentChatPage.tsx`：自然语言 Agent 对话、结构化候选、K 线检查器、Paper 确认与 MCP Tool Trace
- `frontend/app/api/agent/route.ts`：页面到 Agent Tool Layer 的安全代理
- `frontend/app/globals.css`：Agent OS 控制台视觉系统
- `backend/server/sources.mjs`：Bitget、OKX、Binance Futures 统一数据源适配
- `backend/server/strategies.mjs`：A档和双均线策略注册表
- `backend/server/index.mjs`：扫描 worker、`/api/agent/run` Paper 计划入口与 `/api/agent/confirm` 本地 Paper 确认入口
- `data/quant.db`：本地 Paper 账本
