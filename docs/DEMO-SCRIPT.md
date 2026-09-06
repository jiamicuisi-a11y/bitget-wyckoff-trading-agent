# Agent OS Track A · 2 分钟 Demo 脚本

## 0:00–0:15 · 先讲清楚产品

“这是 Strategy Copilot。它把我原来 Bitget 项目里最稳定的两套 Paper 策略——A 档异动扫描和 4H 双均线——放进一个 Agent OS 工作流。Agent 会感知 Binance 永续市场、解释策略判断、经过 Risk Gate，再停在人工确认之前。”

指向左下角：`PAPER MODE`。补一句：

“今天展示的是公开行情和本地模拟账本，不连接账户，也不会发送真实订单。”

## 0:15–0:45 · 展示两套策略

依次点击：

1. `A档 · 异动扫描（Binance）`
2. `双均线 · Binance 4H`

解释：

“A 档把 OI、价格、成交额、盘口和资金费率合成一个机会分数；双均线只看成交额 Top30 的 4H EMA(10/30) 金叉或死叉。两套策略共享同一条 Agent 工作流，但各自保持独立参数和 Paper 账本。”

## 0:45–1:20 · 观察自动 Paper 流程

等待页面顶部出现「最近一轮已完成」，再进入 `运行记录` 查看后台扫描留下的状态。策略 worker 会自动完成以下阶段：

1. 感知行情：读取 Binance Futures 公开行情。
2. 策略判断：把候选送入 A 档或双均线。
3. 风险闸门：检查止损、杠杆、并发上限。
4. Paper 执行：只生成本地 Paper 计划。
5. 审计记录：记录本次 Agent run。

策略页会显示完整扫描覆盖、候选分数、Paper 持仓、权益曲线和交易检查器。点击候选或 Paper 记录，可以解释「为什么选它」以及入场/止损/止盈相对 K 线的位置。Agent Tool Layer 的 `/api/agent/run` 仍是独立的只读审计入口，不代替后台自动 Paper worker。

## 1:20–1:45 · 解释 Risk Gate

指向风险闸门：

“关键点是 Agent 不会直接从行情跳到下单。它必须先经过风控，并且人工确认仍然是最后一道门。当前权限只有 `Market data · Paper execution`，明确没有提现权限。”

## 1:45–2:00 · 收尾

“所以这个 Agent 的价值不是一个黑盒信号，而是一条可解释、可审计、默认安全的策略执行链。把原来分散的策略研究和模拟盘，变成一个可以被自然语言驱动的 Binance Agent OS 控制面。”

## 录制前检查

- 启动：`node scripts/preview-recovered.mjs`
- 页面：`http://localhost:4180`
- 确认左下角显示 `PAPER MODE`
- 确认顶部显示 `Binance Futures`
- 确认至少有一轮后台扫描完成；A 档首轮可能只建立 OI 基线，下一轮才出现 OI 变化分
- 录屏中不要展示任何 API key、Cookie、钱包或真实订单页面
