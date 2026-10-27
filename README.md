# PT-Plugin-Plus

PT-Plugin-Plus（PTPP）是面向 PT 用户的 Chrome 扩展：把多个站点的搜索、用户数据、下载、收藏、辅种、备份和站点页面工具集中到一个界面中。

这是归档版 PT-Plugin-Plus 的 Manifest V3 独立延续版。旧版代码完整保存在 [`legacy-mv2/`](./legacy-mv2/) 中，方便迁移旧数据和核对旧功能。

> [!NOTE]
> PTPP 与 [PT-depiler](https://github.com/pt-plugins/PT-depiler) 使用了部分相同的 MV3 底层和站点定义，但产品定位不同。PT-depiler 不计划实现“站点绑定下载器与下载目录”的设计（见 [issue #454](https://github.com/pt-plugins/PT-depiler/issues/454)），而这是 PTPP 必须保留的核心功能。因此 PTPP 继续作为独立项目维护，在保留 PTPP 交互和下载规则的同时，选择性吸收 PT-depiler 的底层改进。

## 主要功能

- 聚合搜索和单站搜索：按站点、分类、大小、做种数等条件筛选结果。
- 用户数据：查看等级、分享率、上传/下载量、做种和积分，并支持刷新、历史、图表和批量打开站点。
- 下载管理：支持 qBittorrent、Transmission 等下载器，支持全局默认下载器，也支持为单个站点绑定专用下载器和目录。
- 站点工具栏：在站点首页、种子列表和详情页快速推送、复制、收藏和搜索。
- 收藏、分组、辅种任务和下载历史：保留 PTPP 原版的常用工作流。
- 备份与恢复：支持本地 ZIP、WebDAV、加密备份、旧版 PTPP 数据迁移和可选的自动备份清理。
- 可选 AI 助手：连接独立的本机 MCP 服务后，在右下角提供页面相关的问答和搜索辅助；未连接时不会显示 AI 入口。

## 安装

1. 从 [Releases](https://github.com/JohnathanT55/PT-Plugin-Plus/releases) 下载 Chrome ZIP，并解压到一个固定目录。
2. 在 Chrome 地址栏打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后的目录。
4. 打开 PTPP 设置，先添加站点，再配置下载器和默认下载目录。

升级时可以直接替换旧的解压目录并在扩展管理页点击“重新加载”。升级前建议先导出一份备份。

## 下载规则

下载目标按以下顺序选择：

1. 站点绑定的下载器和目录；
2. 站点唯一的下载器/目录绑定；
3. 全局默认下载器；
4. 无法唯一判断时，显示“推送到……”供用户选择。

因此，一个站点配置了独立目录后，不会被全局默认下载器悄悄改写。

## 常用帮助

- [快速开始](./wiki/Quick-Start.md)
- [站点、下载器和目录设置](./wiki/Sites-and-Downloaders.md)
- [备份与恢复](./wiki/Backup-and-Restore.md)
- [签到助手](./wiki/Sign-in.md)
- [搜索、收藏和辅种](./wiki/Search-and-Tasks.md)
- [AI 助手与 MCP](./wiki/AI-and-MCP.md)
- [常见问题](./wiki/FAQ.md)

## 隐私与数据

站点配置、Cookies、下载器凭据和历史数据默认保存在当前浏览器中。扩展不会向项目维护者提供遥测或用户数据；只有在用户主动使用搜索、下载器、备份服务、影片资料或 MCP 时，才会连接对应服务。

详细说明见 [`PRIVACY.md`](./PRIVACY.md)。备份可能包含敏感凭据，请只保存到自己信任的位置。

## 从源码构建

普通用户不需要执行这一步。开发者可以使用 Node.js 24+ 和 pnpm 11+：

```bash
pnpm install
pnpm build
```

构建结果位于 `dist-chrome/`。项目变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)，完整升级清单见 [`MV3_UPGRADE_CHECKLIST.md`](./MV3_UPGRADE_CHECKLIST.md)。

## 产品介绍

项目定位、功能边界和与 PT-depiler 的关系见 [`docs/PRODUCT_INTRODUCTION.md`](./docs/PRODUCT_INTRODUCTION.md)。

## License

[MIT](./LICENSE)
