# PT-Plugin-Plus Manifest V3

PT-Plugin-Plus 的 Chrome Manifest V3 延续版本。仓库根目录保存新版代码，归档时的 Manifest V2 源码完整保存在 [`legacy-mv2/`](./legacy-mv2/) 中，作为功能、交互和数据迁移基准。

当前版本以归档版 PT-Plugin-Plus 为产品模板。PT-depiler 只提供与 PTPP 原有功能重合的 MV3 底层、站点定义和下载器适配器；媒体服务器、下载器任务总览、原生通信桥和 Ask AI 等 PTD 独有功能不进入生产界面。

## 当前状态

Chrome MV3 `2.0.0` 发布候选已经完成主要业务闭环：

- 10 个首发站点：Audiences、Azusa/梓喵、HDKylin、HDSky、HDTime、KamePT、M-Team、PTTime、SkyeySnow、U2；
- 聚合与单站搜索、搜索方案、影片候选、搜索快照和批量操作；
- 用户数据刷新、历史、时间线、统计图和批量打开；
- qBittorrent、Transmission、下载历史和持久化批量任务；
- 收藏与分组、辅种任务、站点页面常驻工具栏；
- 本地 ZIP、WebDAV、AES 加密、定时备份、刷新后上传和旧版 ZIP 恢复；
- 归档版 PTPP 的站点、下载器、目录、历史、快照、收藏、辅种、Cookies 和 WebDAV 数据迁移。

生产构建使用 Manifest V3 service worker 和幂等 offscreen document，不包含 `unsafe-eval`、动态执行的远端脚本或旧版自定义站点 JavaScript。详细完成状态与剩余发布验收见 [`MV3_UPGRADE_CHECKLIST.md`](./MV3_UPGRADE_CHECKLIST.md)。

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

真实扩展页面和站点工具栏必须在加载 `dist-chrome/` 后验证；普通网页预览不具备扩展 API，不能替代实机测试。当前首发目标是 Chrome，Edge 与 Firefox 兼容性在 Chrome 首发后单独安排。

发布 ZIP 还应解压到临时目录后重新加载，并运行：

```bash
node tests/mv3/release-cdp-audit.mjs http://127.0.0.1:9222
node tests/mv3/toolbar-cdp-audit.mjs http://127.0.0.1:9222
```

Windows 休眠唤醒门禁使用隔离 Chrome profile，并且不会访问 PT 站点、推送下载或上传备份：

```bash
node scripts/sleep-lifecycle-cdp.mjs http://127.0.0.1:9222 prepare
# 让 Windows 真正进入睡眠/休眠至少两分钟，然后唤醒
node scripts/sleep-lifecycle-cdp.mjs http://127.0.0.1:9222 verify
powershell -File scripts/verify-windows-sleep.ps1 -PreparedAt <prepare 输出的 ISO 时间>
```

探针临时禁用站点访问和刷新后上传，只执行一个零站点持久任务；验证结束会恢复原配置。不能完成测试时用
`abort` 代替 `verify` 清理探针。Windows 电源事件和扩展的执行日志必须同时通过，普通等待或模拟 alarm 不算休眠验收。

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
