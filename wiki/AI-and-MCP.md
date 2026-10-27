# AI 助手与 MCP

AI 助手是可选功能，PTPP 本身不保存 LLM API Key。需要单独运行并配置本机的 [`PT-Plugin-Plus-MCP`](https://github.com/JohnathanT55/PT-Plugin-Plus-MCP) 服务，然后在 PTPP 的 AI 设置中填写 bridge 地址和令牌。

## 使用方式

1. 启动本机 MCP 服务并配置 OpenAI-compatible API。
2. 在 PTPP 设置中启用 MCP，点击“测试连接”。
3. 连接成功后，右下角会出现 AI 入口。
4. AI 会根据当前页面提供建议问题，也可以直接输入自己的问题。

## 可以询问什么

- 分析当前站点的用户数据和升级缺口；
- 解释搜索结果并给出筛选建议；
- 查询下载器状态；
- 发起明确的资源搜索。

## 不会做什么

AI 不会读取原始 Cookies、密码、下载器凭据或完整 DOM，也不会直接删除备份、恢复备份或推送下载。MCP 未连接时，所有 AI 入口都会隐藏。

对话和草稿只在当前标签页短期保存，不进入 PTPP 备份。不要在问题中粘贴密码、令牌或备份内容。
