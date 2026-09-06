# Strategy Copilot 多页面策略控制台设计

## 目标

将当前单页 Agent 控制台重构为可独立浏览、可解释、可录制演示的多页面产品。A 档异动扫描与双均线 4H 必须拥有各自的策略页面、候选解释、信号数据和 Paper 结果；Paper worker 在后台自动运行，前端只展示状态和理由，不提供真实交易入口。

## 当前仓库事实

- `backend/server/scanner.mjs` 已输出 A 档候选的 `factors`、`score`、`tag`、`direction`、`oiChangePct`、`change24hPct`、`fundingRate`、`volumeUsd`、`bidAskImbalance`。
- `backend/server/paper.mjs` 和 SQLite `positions` 表已保存 `score`、`entry_price`、`stop_price`、`target_price`、`open_reason`、`open_time`、`exit_reason`、`pnl_usd`、`pnl_pct`。
- `backend/server/index.mjs` 已提供 `/api/strategies`、`/api/state`、`/api/equity`、`/api/closed`、`/api/scan/latest`、`/api/klines` 和 `/api/agent/run`。
- 双均线候选当前只有基本字段，需要补充 EMA、信号 K 线时间、成交额排名和解释字段。
- 当前 Agent 事件链主要由一次请求返回，运行记录需要本地持久化。
- 当前目录没有 Git 元数据，因此本次不执行提交，也不把提交作为验收条件。

## 产品结构

使用 Next.js App Router 的真实路径和共享 App Shell：

```text
/overview
/radar/anomaly
/radar/dualma
/strategies/anomaly
/strategies/dualma
/risk
/runs
/connections
```

导航页面分成三类：

1. 总览：展示系统状态、两套策略摘要、最近 Agent Run。
2. 策略工作台：A 档和双均线分别展示自己的扫描池、候选、解释、图表和 Paper 记录。
3. 控制与审计：风险闸门、运行记录、权限连接独立展示。

侧边栏切换页面时使用真实路由，刷新页面后仍能回到当前视图。旧的 Bitget/OKX 策略继续保留在 worker 注册表，但参赛 UI 只展示 Binance 两套策略。

## A 档异动扫描页面

路径：`/radar/anomaly`。

页面必须展示：

- 扫描状态：最近扫描时间、扫描合约数量、命中数量、Paper 开仓数量。
- 策略配置：最低分数、单笔风险、止损、目标 R、杠杆、最大并发。
- 候选表格：合约、方向、总分、标签、OI、主动买卖压力、价格变化、成交额、资金费率、当前状态。
- 候选详情抽屉：分因子评分、自然语言买入/做空理由、风险提醒、入场/止损/止盈 Paper 计划。
- Paper 活动区：自动开仓的候选、当前价格、浮盈、平仓原因和时间。

分数展示保持后端真实数值；因子解释映射如下：OI 30%、主动买卖 25%、价格 20%、成交额 15%、资金费率 10%。如果数据来自本地演示，必须明确标注 `local demo`。

## 双均线页面

路径：`/radar/dualma` 或 `/strategies/dualma`，两者指向同一个独立工作台视图。

页面必须展示：

- Binance 成交额 Top30 标的池及排名。
- 4H K 线和 EMA10/EMA30 叠加图。
- 金叉/死叉信号列表，含信号时间、EMA 值、成交额排名、策略评分和状态。
- 点击信号查看信号形成原因、入场价、止损价、止盈价和 Paper 结果。
- 独立的双均线 Paper 持仓与历史记录。

双均线候选接口新增字段：

```text
fastEma, slowEma, signal, signalCandleTime,
volumeRank, granularity, reason, score
```

当前策略评分 60 代表检测到有效交叉，不把它伪装成与 A 档相同的多因子评分。

## 风险与 Paper 边界

Paper worker 继续自动操作模拟账户：扫描、开仓、盯仓、止盈、止损、超时平仓均由后台完成。前端不提供真实下单、提现、签名或 API key 输入。

Risk 页面显示每个计划的：

- 策略阈值检查；
- 止损与目标检查；
- 并发和冷却检查；
- 计划状态；
- `broadcast=false` 和 `Paper execution only`。

“确认”按钮如果保留，只能确认本地 Paper 计划并写审计事件，不得调用真实交易接口。

## 运行记录

新增 SQLite 表 `agent_runs` 和 `agent_events`。每次 `/api/agent/run` 保存：run id、策略、自然语言意图、开始/结束时间、扫描数、候选数、计划数、状态和安全边界；每个 Tool Layer 阶段保存名称、详情、状态和时间戳。`/api/runs` 提供列表，`/api/runs/:id` 提供详情。

## 视觉与交互

- 保留现有黑石墨、米白、Binance 黄的视觉基调，但从“营销 Hero + 卡片”改为产品工作台。
- 桌面端为固定侧边栏 + 页面内容区；移动端侧边栏变成横向导航。
- 数据密集页面优先使用表格、时间线、抽屉和图表，不使用大量装饰卡片替代表格。
- 所有主要按钮、表格行、筛选器、周期选择器和详情抽屉都必须有真实状态变化。
- 加载、无数据、行情源失败和本地演示状态必须可见。

## 验收标准

1. 从导航进入 A 档页面时，只看到 A 档数据和解释；进入双均线页面时，只看到双均线数据和解释。
2. A 档候选能看到总分、分因子和“为什么选择”。
3. 双均线候选能看到 EMA10、EMA30、金叉/死叉和信号时间。
4. 两套策略都能看到哪些候选已经 Paper 开仓、哪些仍在观察。
5. Agent Run 后运行记录可刷新后保留。
6. 构建通过，浏览器无运行时错误，核心页面在桌面和移动宽度不溢出。
7. 全程保持 Paper Mode、`broadcast=false`，不读取密钥、不签名、不真实下单。
