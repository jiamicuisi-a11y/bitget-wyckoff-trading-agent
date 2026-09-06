# Binance Agent OS Mini Hackathon · Competition Readiness

## 当前定位

本项目按 Track A 准备：一个面向 Binance Futures 公共行情的可解释 Paper Trading Agent。它把 A 档异动扫描和双均线 4H 放进同一条 Agent OS 风格工作流，并通过本地 MCP 工具层展示可追踪的工具调用。

## 官方要求映射

| 官方要求 | 当前状态 | 证据 |
| --- | --- | --- |
| 使用 Agent OS 构建 AI Agent | 已准备 Demo；官方 MCP 授权仍需用户在官方客户端完成 | `docs/BINANCE-MCP.md`、页面官方端点卡片 |
| 视频或可访问 Demo | 已有本地 Demo | `http://localhost:4180`、`docs/DEMO-SCRIPT.md` |
| GitHub 仓库 | 需要将当前目录同步到公开仓库 | 发布前检查项 |
| 公告回复/引用转发 | 需要用户完成 | 外部社交平台动作 |
| 官方问卷 | 需要用户完成 | 外部表单动作 |
| 真实交易 | Track A 不要求；当前明确关闭 | `Paper only`、`broadcast=false` |

## 提交前必须完成

- [ ] 创建或确认公开 GitHub 仓库，并把当前代码同步进去。
- [ ] 在干净 Node.js 24+ 环境执行 `node scripts/preview-recovered.mjs`。
- [ ] 录制完整 Demo，展示两套策略、Agent 对话、MCP Tool Trace、Paper 账本和 Risk Gate。
- [ ] 说明本项目使用 Binance public data，不把模拟收益写成实盘收益。
- [ ] 按官方要求完成公告互动和问卷。
- [ ] 提交前再核对活动截止时间、地区资格和最新规则。

## 当前明确不做的事

- 不保存 Binance API key、OAuth token、Cookie、私钥或助记词。
- 不从本地网页发起真实下单、转账或提现。
- 不把本地 MCP 连接状态写成官方账户已授权状态。
- 不用历史 Paper 数据冒充真实账户表现。

## 奖励档位（以官方页面为准）

官方说明的 Track A 奖金池为 20,000 USDC：第 1 名 2,000 USDC、第 2 名 1,500 USDC、第 3 名 1,000 USDC，后续 50 名各 300 USDC。未获奖不产生奖金；这是获奖档位，不是报名保证金或参与保证金。
