# Agent OS Track A · Live Demo

## Story

`Strategy Copilot` 将两个已验证的模拟策略放进一个 Agent OS 控制面：

1. **感知**：从 Binance Futures 公开接口读取 USDT 永续行情、资金费率、K线与高流动性标的 OI。
2. **决策**：A档异动扫描与双均线 4H 各自运行，并把候选机会进入统一工作流。
3. **风控**：Risk Gate 展示扫描数量、候选数量、权限边界和人工确认状态。
4. **执行**：当前只做 Paper execution，订单不会离开本地模拟账本。
5. **审计**：展示机会流、权益曲线、当前持仓和最近运行事件。

## Run

```bash
node scripts/local-service.mjs start
```

打开 `http://localhost:4180`，进入「Agent 对话」或「A档异动扫描」。后台会自动扫描、开平 Paper 仓；在「Agent 对话」中输入问题，页面会展示中文回答和真实 MCP Tool Trace。切换页面即可查看两套独立账户、候选、持仓和权益曲线。

## Submission assets

- GitHub repository: this project
- Demo surface: `frontend/app/AgentConsole.tsx`
- Binance adapter: `backend/server/sources.mjs`
- MCP Agent runtime: `backend/server/mcp-runtime.mjs` + `backend/server/agent-chat.mjs`
- Strategy registry: `backend/server/strategies.mjs`
- Paper safety boundary: `backend/server/paper.mjs`

## Claim boundary

页面中的收益、权益、持仓和候选均为 Paper/演示数据；不得在提交材料中表述为真实账户收益或实盘交易结果。
