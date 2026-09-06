# Track A · 提交文案

> 本文是参赛材料草稿。官方活动页面显示：赛道一奖励使用 Binance Agent OS 构建的 AI Agent；提交需要视频或 Demo、GitHub（如适用）、公告互动和问卷。最终提交前请以官方页面最新规则为准。

## Project title

**Strategy Copilot — Explainable Paper Trading Agent for Binance Agent OS**

## One-line pitch

把 A 档异动扫描和 4H 双均线策略，编排成一条“行情感知 → 策略判断 → 风险闸门 → 人工确认 → Paper 执行 → 审计”的可解释 Agent 工作流。

## Description

Strategy Copilot 是一个面向 Binance Futures 公开市场数据的交易研究 Agent。它继承此前 Bitget Hackathon 项目的两套 Paper 策略：A 档异动扫描综合 OI、价格、成交额、盘口和资金费率筛选机会；双均线策略在成交额 Top30 永续合约上计算 4H EMA(10/30) 交叉信号。

Agent 不把信号直接变成真实订单，而是先生成带理由和风险参数的 Paper plan，经过 Risk Gate 后停在人工确认前。每次运行都留下事件链，便于演示、回放和审计。

## What is built

- Binance Futures 公共行情适配：24h ticker、资金费率、OI、K 线。
- 两套 Binance 策略注册：A 档异动扫描、4H 双均线。
- Agent command center：自然语言意图输入、策略切换、机会流、权益曲线、风险闸门、Paper 持仓和审计事件链。
- 本地 SQLite Paper 账本，默认不读取账户密钥、不签名、不广播。
- 当实时行情没有命中时，使用明确标注的 `local demo` 事件帮助评委完整理解工作流。

## Safety and claim boundary

本项目的行情扫描使用公开市场数据；所有权益、持仓、候选和运行结果均属于 Paper simulation 或 local demo。项目不声称真实账户收益，不发送真实订单，不执行充值、提现、签名或资金操作。

## Demo links

- Local preview: `http://localhost:4180`
- Demo flow: `docs/DEMO-SCRIPT.md`
- Architecture: `docs/ARCHITECTURE.md`
- Official MCP connection boundary: `docs/BINANCE-MCP.md`

## Submission checklist

- [ ] 将当前项目同步到公开 GitHub 仓库，并确认 README、启动命令和目录结构可复现。
- [ ] 录制 2–3 分钟 Demo：总览 → A 档 → 双均线 → Agent 对话 → MCP Tool Trace → Paper / Risk Gate。
- [ ] 关注并转发官方 Binance 活动公告。
- [ ] 在官方公告下回复或引用转发，附 Demo/GitHub 链接。
- [ ] 完成官方问卷。
- [ ] 提交材料中明确写出：公开行情、Paper simulation、`broadcast=false`，不声称真实收益。
