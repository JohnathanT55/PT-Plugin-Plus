# PT-Plugin-Plus Manifest V3

PT-Plugin-Plus 的 Chrome Manifest V3 延续版本。仓库根目录保存新版代码，归档时的 Manifest V2 源码完整保存在 [`legacy-mv2/`](./legacy-mv2/) 中，作为功能、交互和数据迁移基准。

当前版本以归档版 PT-Plugin-Plus 为产品模板。PT-depiler 提供与 PTPP 功能重合的 MV3 底层、站点定义和下载器适配器；媒体服务器、原生通信桥和 Ask AI 等 PTD 独有功能不进入生产界面。“我的下载器”只使用本项目已经支持的下载服务，不开放其他 PTD 产品入口。

## 当前状态

Chrome MV3 `2.0.0` 已完成并具备独立发布条件，包含：

- 当前构建导入的 PTD 站点定义均可添加；搜索、用户信息和页面增强能力以各站点定义声明为准；
- 聚合与单站搜索、搜索方案、影片候选、搜索快照和批量操作；
- 用户数据刷新、历史、时间线、统计图和批量打开；
- qBittorrent、Transmission、下载历史和持久化批量任务；
- 收藏与分组、辅种任务、站点页面常驻工具栏；
- 本地 ZIP、WebDAV、AES 加密、定时备份、刷新后上传和旧版 ZIP 恢复；
- 归档版 PTPP 的站点、下载器、目录、历史、快照、收藏、辅种、Cookies 和 WebDAV 数据迁移。

当前 `master` 在 2.0.0 上继续开发第二批更新，已经完成“我的下载器”、自动备份保留、站点工具栏放宽、搜索结果响应式表格及辅种/下载历史布局收口；目前只剩搜索结果影片信息聚合头卡。生产构建使用 Manifest V3 service worker 和幂等 offscreen document，不包含 `unsafe-eval`、动态执行的远端脚本或旧版自定义站点 JavaScript。详细状态见 [`MV3_UPGRADE_CHECKLIST.md`](./MV3_UPGRADE_CHECKLIST.md)。

## 默认下载器与站点目录

本版本支持全局默认下载器，也保留 PTPP 的核心差异能力：按站点绑定下载服务器、保存目录和标签。

目标解析优先级为：

1. 站点显式默认目标；
2. 该站点唯一的下载器与目录绑定；
3. 全局默认下载器及其默认行为；
4. 无法唯一判断时显示“推送到……”菜单。

“站点 + 下载器 + 保存目录”是不可拆分的目标。站点目录不会被静默交给另一个全局默认下载器；搜索结果、站点列表/详情、批量操作、右键菜单和历史重新推送共用同一套解析规则。

PT-depiler 在 [issue #454](https://github.com/pt-plugins/PT-depiler/issues/454) 中明确不计划实现这项设计，本项目将其作为必须保留的功能继续维护。

## 站点工具栏

站点页面使用 PTPP 原版常驻纵向工具栏，并支持：

- 首页、普通页、种子列表和种子详情页统一停靠；
- 全局左侧/右侧选择，默认右侧；
- 拖动位置、拖到另一侧后同步更新全局设置、双击黄色区域复位；
- 一键推送、推送到其他目标、复制、收藏、快捷搜索和批量操作；
- 菜单始终向页面内部展开。

## 备份保留与清理

每个 WebDAV/OpenList 备份服务可独立启用自动清理，默认关闭。新自动备份使用可验证的来源与备份流标识，固定间隔、用户数据刷新和不同字段范围分别计算保留名额。

扩展只会自动清理能够确认由当前备份服务创建、且符合当前保留策略的自动备份。手动备份、旧版未分类备份、其他应用文件、无法验证的文件和正在恢复的备份不会被自动删除。备份历史提供分类、清理预览、候选取消选择和二次确认；年龄、数量及分层保留策略始终遵守每个备份流的最低保留数量。

## 安装与验证

要求 Node.js 24 或更高版本、pnpm 11.16 或更高版本：

```bash
pnpm install
pnpm verify
pnpm package:chrome
```

Chrome 生产构建输出到 `dist-chrome/`。在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，然后选择该目录。

`pnpm verify` 会依次运行：

- Vue 与底层模型类型检查；
- 数据迁移、备份恢复、下载策略、收藏、搜索和持久任务测试；
- Chrome 生产构建与 MV3 产物验证；
- Chrome Web Store 权限、图标、本地化、动态代码和远端脚本静态审计；
- service worker、offscreen、路由和生产入口 smoke test。

`pnpm package:chrome` 会在验证 `dist-chrome/` 后生成可复现的
`releases/PT-Plugin-Plus-v2.0.0-chrome.zip` 和对应 `.sha256` 文件。ZIP 根目录直接包含
`manifest.json`，可直接用于 Chrome Web Store 上传；`releases/` 是本地发布产物，不提交到 Git。

版本号以 `package.json` 为唯一来源。Chrome manifest 使用商店版本 `2.0.0`，开发者模式中可见的
`version_name` 额外包含构建提交短哈希，便于定位具体源码而不改变商店升级顺序。

真实扩展页面、站点工具栏、下载器、备份服务及浏览器重启必须在加载 `dist-chrome/` 后验证；普通网页预览不具备扩展 API，不能替代实机测试。当前发布目标是 Chrome，Edge 与 Firefox 兼容性单独安排。发布 ZIP 还应解压到临时目录后重新加载，确认测试对象是最终包而不是工作目录构建。

## 数据与隐私

配置、站点 Cookies、用户统计、下载记录和备份凭据保存在用户浏览器中，只会发送到用户主动访问或配置的站点、下载器、WebDAV/备份服务和影片资料服务。本项目不提供遥测、广告或项目方服务器。

权限用途、数据保留和第三方服务说明见 [`PRIVACY.md`](./PRIVACY.md)。版本变化见 [`CHANGELOG.md`](./CHANGELOG.md)。

## 目录

- `app/`：Vue/Vite options、content script、background/offscreen、站点和下载器模块；
- `src/`：版本化存储、迁移、下载目标模型和底层 MV3 逻辑；
- `tests/`：业务模型、迁移和扩展运行时测试；
- `scripts/`：MV3/商店审计、可复现发布打包和实机生命周期验收；
- `dist-chrome/`：Chrome Manifest V3 生产产物；
- `legacy-mv2/`：归档的原始 Manifest V2 项目；
- `MV3_UPGRADE_CHECKLIST.md`：功能范围与发布验收清单。

## License

[MIT](./LICENSE)
