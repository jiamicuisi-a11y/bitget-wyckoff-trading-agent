# Binance MCP 官方接入说明

## 官方端点

```text
https://agent.binance.com/mcp/agentic
```

官方开发文档：<https://developers.binance.com/en/docs/agent-native/mcp-server/agentic>

## 本项目的边界

本项目包含两层：

1. 本地 MCP Client ↔ Server：网页 Agent 当前实际调用的工具层，使用官方 MCP SDK，通过进程内 linked transport 访问 Binance 公共行情和本地 Paper 状态。
2. 官方 Binance MCP Server：用于 Binance Agent OS 客户端的正式远程连接入口，页面会展示端点和授权状态，但本地项目不会代替用户完成 OAuth/账户授权。

因此，页面中的 `LOCAL MCP CONNECTED` 表示本地工具链已连接；`AUTH REQUIRED` 表示官方 Binance MCP 需要在官方支持的客户端中由用户授权。这两个状态不能混写。

## 官方客户端连接

按照 Binance 官方文档，在支持的客户端中添加远程 MCP Server，并完成官方授权。授权范围应遵循最小权限原则：

- 只展示市场数据：只授予 Market data。
- 需要读取 Agentic 子账户：再授予 Account。
- 需要真实交易：才授予 Trade，并由用户逐笔确认。

本地 Demo 不需要 API key、私钥、Cookie 或真实资金。不要把 MCP URL 粘贴进聊天，也不要把任何凭证写入本项目、README、日志或截图。

## 参赛展示建议

赛道一展示本项目的 Paper 工作流即可：

```text
Binance public data → Agent intent → strategy evaluation → Risk Gate → Paper ledger → audit trace
```

如果展示官方 MCP 的实际连接，必须单独录制官方客户端中的授权状态，并隐藏 UID、余额以及其他敏感信息；不要把本地 Paper 结果表述为真实账户收益。
