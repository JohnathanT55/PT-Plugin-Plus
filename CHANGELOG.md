# Changelog

本文件记录 PT-Plugin-Plus Manifest V3 延续版本的主要变化。

## Unreleased — Chrome MV3 发布候选

### 新增与恢复

- 将 background、options、content script 和 DOM 能力升级到 Manifest V3 service worker/offscreen 架构。
- 恢复 10 个首发站点的搜索、用户数据、列表/详情工具栏和下载入口。
- 恢复 PTPP 的站点独立下载器、目录和标签优先级，并支持 qBittorrent 与 Transmission。
- 恢复下载历史、搜索快照、收藏/分组、辅种、影片候选和用户数据统计。
- 支持本地与 WebDAV 备份、AES 加密、备份历史、失败重试、Cookies 延期以及用户数据合并/覆盖恢复。
- 支持普通恢复入口直接导入归档版 PTPP ZIP，并迁移敏感凭据、Cookies 与全部首发数据域。
- 站点工具栏增加全局左/右停靠设置、相对视窗位置、旧绝对坐标迁移和双向菜单。

### 界面与范围

- 以归档版 PTPP 的导航、宽屏表格、固定操作栏和常驻站点工具栏为界面基准。
- 常规设置拆分为界面、站点工具栏、浏览器集成、用户数据、搜索、下载、备份七个职责单一的标签。
- 移除生产导航中的 PTD 独有媒体服务器、下载器任务总览、原生通信桥和调试器入口。
- 修正当前版本、归档文档和迁移 FAQ 的仓库链接；产品界面不直接展示个人仓库 slug。

### 安全与验证

- 移除未使用的 `activeTab` 权限。
- 禁止动态远端代码、`unsafe-eval`、`eval()` 和 `new Function()` 进入生产构建。
- 增加版本化存储、幂等迁移、持久任务恢复、凭据脱敏和构建产物验证。
- 使用隔离 Chrome for Testing 完成真实 MV3 扩展页、service worker、站点登录、下载器、WebDAV 和主要 UI 闭环。
