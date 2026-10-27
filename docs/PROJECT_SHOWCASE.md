# PT-Plugin-Plus Manifest V3：项目案例说明

> 面向项目评审、AI 产品内测申请和技术交流的精简案例页。

## 一句话介绍

我将已经停止维护、受 Chrome Manifest V2 淘汰影响的 PT-Plugin-Plus，升级为可在当前 Chrome 中运行的 Manifest V3 浏览器扩展；在保留老用户核心工作流和数据迁移能力的同时，补齐了现代化构建、自动化测试、隐私边界和可复现发布流程。

## 为什么做这个项目

PT-Plugin-Plus 原项目已经归档，但许多用户仍依赖它的多站聚合搜索、按站点选择下载器与保存目录、收藏、辅种和备份等工作流。简单换用另一套产品无法完整保留这些习惯，直接修改旧代码又会遇到 Manifest V3 对后台生命周期、远程代码、DOM 能力和权限模型的系统性限制。

这个项目的目标不是做一个静态原型，而是交付一个能够安装、升级、迁移旧数据并在真实浏览器生命周期中稳定工作的产品版本。整个升级分成两个层次：`2.0.0` 先完成从归档 MV2 到可发布 MV3 的产品迁移，`2.1.0` 再在这条稳定主线上融合新能力并做体验收口。

## 我完成了什么

- 将 background、options、content script 和 DOM 相关能力迁移到 Manifest V3 service worker 与幂等 offscreen document 架构。
- 以 PT-depiler 的 MV3 应用框架、站点定义和下载器适配器为底层，恢复 PTPP 的产品界面和差异化工作流。
- 保留“站点 + 下载器 + 保存目录 + 标签”的绑定规则，并让搜索结果、站点页面、批量操作、右键菜单和历史重新推送共用同一套目标解析逻辑。
- 恢复聚合搜索、影片候选与资料头卡、收藏分组、用户数据统计、下载历史、辅种任务和站点常驻工具栏。
- 实现本地 ZIP、WebDAV、AES 加密、定时备份、旧版 ZIP 恢复和按备份流隔离的安全保留策略。
- 完成归档版 PTPP 的站点、Cookies、下载器、目录、历史、快照、收藏、辅种和 WebDAV 数据迁移。
- 从零搭建 Chrome DevTools Protocol 验收工具链：自动发现 options、offscreen document、service worker 和浏览器页面 target，通过 WebSocket/CDP 直接操作扩展、读取运行时状态、检查可访问性、验证发布包并在结束后恢复隔离 profile。
- 建立隐私审计、Chrome Web Store 静态审计、可复现 ZIP/SHA-256 打包及真实 Chrome/CDP 验收流程。

## 2.0 → 2.1 的产品主线

### 2.0.0：先完成一次真正的 MV3 产品迁移

2.0 不是把旧扩展的 manifest 文件改个版本号，而是重新建立了运行时、存储和发布边界：

- 以 PT-depiler 的 MV3 service worker、offscreen、站点定义和下载器适配器为底层，同时以归档版 PTPP 的导航、术语、表格、常驻工具栏和目标解析规则作为产品基准。
- 将 PTPP 的 background、options、content script、DOM 能力和消息链路拆分到 MV3 可接受的执行上下文，并用版本化 storage envelope、迁移注册表和可重试提交避免半迁移状态。
- 把 PTD 中有价值的新底层能力重新包装进 PTPP 工作流：当前导入的多站点定义、统一搜索/用户数据接口、qBittorrent/Transmission 适配器、持久任务和影片资料缓存，而不是直接把 PTD 的产品外壳照搬进来。
- 恢复 PTPP 的聚合搜索、搜索快照、用户数据/历史/时间线/统计、收藏分组、辅种、下载历史、站点工具栏和 WebDAV/本地备份，并让旧版站点、下载器、目录、Cookies、历史、快照、收藏、辅种和 WebDAV 配置可以从真实 MV2 ZIP 导入。
- 明确删去不适合首发或不属于 PTPP 的内容：远程/动态站点脚本、PTD 媒体服务器、原生通信桥、Ask AI、调试器等，避免迁移过程中产品边界失控。

### 2.1.0：在迁移基础上融合新功能并收口体验

2.1 不是另起炉灶，而是针对 2.0 已稳定的底层能力做第二批产品化：

- 把已有下载器查询、状态和控制能力正式做成 PTPP 风格的“我的下载器”页面，同时继续遵守站点绑定的下载器/目录/标签优先级。
- 把原先无法安全区分来源的 WebDAV 备份升级为带来源、备份流和范围指纹的自动保留与清理体系。
- 恢复 PTPP 搜索结果影片聚合头卡，并把影片身份、多来源字段、评分、有限缓存、失败回退和搜索隐私边界整合成新的 MV3 闭环。
- 针对真实使用反馈收口站点工具栏、搜索结果响应式表格、辅种和下载历史布局，而不是用全局缩放等方式掩盖局部交互问题。

## AI 工作流：AI 承包实现，人负责取舍和最终复查

这个项目不是“我写代码、AI 给建议”的模式。在我给出产品目标、保留/删除边界和最终验收标准后，AI 编程代理承包了几乎全部工程工作：

1. **仓库考古与方案设计**：AI 对照归档版 PTPP、PT-depiler、MV3 约束和历史数据格式，追踪跨仓库的数据模型、消息协议、存储键、路由和 UI 依赖，拆出 2.0 首发范围与 2.1 第二批范围。
2. **代码实施与迁移**：AI 完成 MV3 service worker/offscreen 拆分、版本化存储、幂等迁移、下载目标解析、站点工具栏、搜索/影片资料、收藏、辅种、下载历史、备份恢复和新功能融合；同时把不属于 PTPP 的 PTD 入口排除在生产导航外。
3. **测试与故障闭环**：AI 编写和维护类型检查、业务模型测试、迁移/备份/下载/搜索隐私测试、商店静态审计、运行时 smoke test，并根据失败日志定位竞态、生命周期、布局和数据边界问题，反复修复后再跑全套验证。
4. **Chrome/CDP 验收工具链**：AI 自行搭建基于 Chrome DevTools Protocol 的验收 harness，而不是只看单元测试。它会发现扩展页面、offscreen document 和 service worker 的 WebSocket target，通过 `Runtime.evaluate`、页面事件和浏览器协议直接点击/填写/导航/切换主题/检查 DOM 与可访问性；还会操作隔离 profile 中的 qBittorrent、Transmission、WebDAV、影片缓存、旧版 ZIP 导入和响应式表格场景，并捕获截图、检查运行时错误、清理测试数据。
5. **发布级复查**：AI 构建并验证最终 `dist-chrome` 和发布 ZIP，而不是只验工作目录；检查 manifest、权限、动态代码、远程脚本、图标、本地化、SHA-256，以及 Chrome 重启、service worker 回收和 Windows 休眠唤醒后的状态。
6. **文档与证据同步**：AI 将实现结果回写到 CHANGELOG、MV3 升级清单、隐私说明、验收脚本和项目案例页，保证“代码—测试—发布说明”一致。

我主要负责三件事：确定 PTPP 应保留什么、哪些 PTD 新能力值得融合、哪些边界不能突破；提供真实环境和敏感配置的安全范围；对 AI 产出的实现、测试结果和最终发布包做产品级复查与放行。

### 已搭建的 CDP 验收覆盖

仓库中的 CDP 工具覆盖：最终发布包与入口/弹窗、旧版 MV2 ZIP 导入、service worker/offscreen 生命周期、站点常驻工具栏、响应式搜索表格、“我的下载器”、WebDAV 备份保留、影片聚合头卡和睡眠/唤醒任务恢复。它们能直接操作可访问的 Chrome 扩展页面，而不是仅通过源码断言“应该如此”。对应实现包括 [`release-cdp-audit.mjs`](../tests/mv3/release-cdp-audit.mjs)、[`legacy-import-cdp.mjs`](../scripts/legacy-import-cdp.mjs)、[`client-dashboard-cdp-audit.mjs`](../tests/mv3/client-dashboard-cdp-audit.mjs)、[`backup-retention-cdp-audit.mjs`](../tests/mv3/backup-retention-cdp-audit.mjs) 和 [`sleep-lifecycle-cdp.mjs`](../scripts/sleep-lifecycle-cdp.mjs) 等。

## 最难的问题

### 1. 既要迁移 PTPP，又要融合新底层能力而不丢产品身份

最难的不是“能不能编译”，而是确定哪些能力应该进入 PTPP。PT-depiler 提供了可复用的 MV3 基础设施、站点定义、下载器适配器和部分数据能力；我需要逐项对照归档版 PTPP，保留 PTPP 用户熟悉的产品边界，同时把多站点定义、持久任务、下载器状态、影片资料缓存等新能力放回原有搜索、下载、备份和站点工具栏流程中。媒体服务器、原生通信桥和 Ask AI 等 PTD 独有入口则明确不进入生产界面。

### 2. MV3 后台会休眠，任务不能依赖常驻内存

我为一次性持久任务加入跨执行上下文互斥、领取状态校验、超时租约和唤醒恢复，并验证浏览器休眠/恢复边界不会重复执行任务。

### 3. 旧数据必须完整迁移，又不能破坏敏感配置

迁移需要同时处理版本差异、Cookies、下载器凭据、WebDAV 配置和多个业务数据域。我把迁移做成幂等流程，并针对合并/覆盖恢复、较新版本警告、失败回滚和旧 ZIP 兼容建立测试。

### 4. 自动清理备份必须“宁可不删，也不能误删”

保留策略只处理能够验证来源和备份流身份的自动备份；手动备份、旧版未分类文件、其他应用文件、无法验证的文件和正在恢复的备份都受到保护。界面同时提供清理预览和二次确认。

## 可验证成果

- 已形成 `2.0.0` 和 `2.1.0` 两个带 Git 标签的 Chrome MV3 版本。
- 当前 `pnpm verify` 会执行仓库隐私审计、Vue/TypeScript 类型检查、23 个业务测试入口、生产构建、MV3 产物检查、商店审计和运行时 smoke test。
- 2026-09-09 的本地验证结果：953 个仓库文件通过隐私审计；755 个 MV3 构建产物通过校验；Chrome Web Store 静态审计覆盖 10 项已说明权限、427 个可执行资源和 4 个图标；完整命令退出码为 0。
- 发布流程能够生成 Chrome Web Store 可上传的 ZIP 以及对应 SHA-256 文件。
- 生产构建不包含 `unsafe-eval`、动态执行的远程脚本或旧版自定义站点 JavaScript。

## 评审入口

- [项目 README](../README.md)
- [版本记录](../CHANGELOG.md)
- [Manifest V3 升级与验收清单](../MV3_UPGRADE_CHECKLIST.md)
- [隐私说明](../PRIVACY.md)
- [GitHub 仓库](https://github.com/JohnathanT55/PT-Plugin-Plus)
- [2.1.0 源码标签](https://github.com/JohnathanT55/PT-Plugin-Plus/tree/v2.1.0)

## 90 秒演示顺序

1. 打开扩展首页，展示站点管理和用户数据概览。
2. 发起一次多站聚合搜索，展示影片资料头卡、结果筛选和固定操作列。
3. 从搜索结果选择按站点配置的下载器、保存目录和标签，说明目标解析规则。
4. 打开“我的下载器”，展示任务汇总、筛选、暂停/继续和批量管理。
5. 打开 WebDAV 备份设置与清理预览，强调严格分类和误删保护。
6. 展示旧版 ZIP 恢复入口、`pnpm verify` 成功输出、`v2.1.0` 标签和发布 ZIP/SHA-256。

演示时应使用脱敏或测试数据，避免出现 PT 站 Cookies、Passkey、下载器地址、WebDAV 凭据和个人目录。

## MiMo Desktop 内测申请：第 5 题推荐文案

以下版本可直接粘贴到“描述一个你用 AI 做过、或最想用 MiMo Desktop 完成的项目 / 任务”：

> 我使用 AI 编程代理完成了 PT-Plugin-Plus 的 Manifest V3 升级版。第一阶段 2.0.0 面对的是一次完整产品迁移：原项目因 Chrome 淘汰 MV2 而归档，我以 Vue 3、TypeScript、Vite 和 PT-depiler 的 MV3 底层为基础，重建 service worker、offscreen、版本化存储和发布流程，同时迁移旧版站点、下载器、目录、Cookies、历史、快照、收藏、辅种和 WebDAV 配置。迁移过程中还把 PT-depiler 的站点定义、qBittorrent/Transmission 适配器、持久任务和影片资料能力融合回 PTPP 的搜索、下载和站点工具栏，而没有照搬 PTD 独有产品入口。第二阶段 2.1.0 再新增“我的下载器”、安全备份保留、影片聚合头卡和响应式交互收口。除了业务代码，AI 还从零搭建了 Chrome DevTools Protocol 验收工具链：直接发现并操作 options、offscreen、service worker 和浏览器页面 target，在隔离 Chrome profile 中执行旧版导入、下载器、备份、布局、可访问性和生命周期验收，捕获截图、检查运行时错误并恢复测试状态。我主要负责产品取舍、风险边界和最终复查；仓库分析、架构设计、代码实现、测试、CDP 自动化、故障修复、发布打包和文档同步均由 AI 承包。项目已发布 2.0.0、2.1.0 两个版本；完整验证覆盖类型检查、23 个业务测试入口、755 个 MV3 构建产物、Chrome Web Store 静态审计和运行时 smoke test。项目链接：https://github.com/JohnathanT55/PT-Plugin-Plus

如果不希望声称项目已经使用过 AI，可改用未来计划版：

> 我希望用 MiMo Desktop 持续维护 PT-Plugin-Plus Manifest V3 升级版。这个项目需要同时理解归档版 PTPP、PT-depiler 和当前仓库，在真实 Chrome 扩展环境中完成跨文件开发与调试。我希望 MiMo 能读取本地仓库和历史文档，协助站点兼容性维护、失败日志归因、回归测试生成、Chrome DevTools 验收与版本发布，并把测试结果同步为变更记录。现有版本已完成 MV3 架构、旧数据迁移、聚合搜索、下载器管理和安全备份闭环，后续最适合检验桌面级 AI 在长任务、本地文件、浏览器自动化和工程上下文保持方面的能力。项目链接：https://github.com/JohnathanT55/PT-Plugin-Plus

## MiMo Desktop 内测申请：第 6 题建议

建议选择：

1. **代码开发与调试**：这是项目主体。
2. **浏览器与工作流自动化**：需要安装扩展、操作真实 Chrome 页面、查看 service worker/offscreen 状态并执行 CDP 验收。
3. **本地文件 / 知识库处理**：需要同时理解旧版源码、PT-depiler、新版仓库、迁移清单、测试和发布文档。

相比“网页 / 应用原型生成”，第三项选择“本地文件 / 知识库处理”更贴合这个项目：它已经是可发布产品，不是原型；真正有区分度的是跨仓库、长上下文和本地工程资料的持续处理能力。

## 推荐附件

优先上传一张经过脱敏的项目拼图，包含：聚合搜索与影片头卡、“我的下载器”、WebDAV 保留策略预览、`pnpm verify` 成功结尾。若只能上传一项，优先选择 90 秒以内的操作录屏；若只能上传静态文件，使用本案例页的 PDF 导出并附 GitHub 链接。
