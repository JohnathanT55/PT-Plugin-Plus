# PT-Plugin-Plus MV3

这是 PT-Plugin-Plus 的 Manifest V3 延续版本。仓库根目录现在直接保存 MV3 代码；原项目归档时的 Manifest V2 源码完整保存在 [`legacy-mv2/`](./legacy-mv2/) 中，便于查阅、功能对照和后续迁移。

## 当前阶段

当前版本以归档版 PT-Plugin-Plus 的功能、导航和主要界面为产品基准，使用 Vue 3、Vite、Vuetify、Pinia 重建 options、content script、service worker 和 offscreen 等 MV3 入口。PT-depiler 只作为 PTPP 已有同类功能的实现来源；媒体服务器、下载器任务总览、原生通信桥、额外备份服务和 Ask AI 等 PTD 独有功能不进入当前版本。PTPP 的版本化迁移结果现已接入新的运行时存储；站点及独立“下载目录设置”页面可以配置默认下载器、候选/默认目录、候选/默认标签和自动开始策略。

运行时迁移目前覆盖站点、下载器及地址/认证、站点下载配置、WebDAV、用户历史与最新数据、搜索快照、辅种任务和下载历史。下载历史写入 PTD IndexedDB；其他数据进入 PTD 对应的 `chrome.storage.local` 字段。迁移使用带版本号的完成标记并在所有数据域成功后才提交，重复启动不会覆盖已有 PTD 数据或重复导入下载历史。

自动化验证已经覆盖类型检查、跨存储迁移与失败恢复测试、生产构建、MV3 manifest/入口检查、动态代码扫描以及 service worker/offscreen 冒烟测试。真实站点登录、下载器连接和浏览器加载扩展仍需按 [`MV3_UPGRADE_CHECKLIST.md`](./MV3_UPGRADE_CHECKLIST.md) 逐项实机验收，因此当前构建还不能称为旧版 PTPP 的完整替代品。收藏/收藏分组以及部分旧设置仍只保存在底层迁移状态中，尚未接入 PTD 页面。

普通“从备份文件中恢复”入口现在会自动识别 MV3 备份和旧版 PT-Plugin-Plus ZIP。旧版 ZIP 可直接迁移站点、下载器及地址、默认下载器、站点目录映射、WebDAV、用户历史、搜索快照、辅种任务、下载历史和 Cookies，不再要求先手动添加站点；未受当前静态站点定义支持的项目会在导入结果中明确列为跳过。收藏及分组会先保存在兼容迁移层，待对应页面接入。

站点设置和完整搜索以 PT-depiler 的数据模型与交互为基线，同时继续实现 PTPP 的差异功能。导入基线和许可说明见 [`PTD_UPSTREAM.md`](./PTD_UPSTREAM.md)。

## 默认下载器与下载目录

本版本保留 PT-depiler 的全局默认下载器，并实现按站点设置默认下载器的界面和推送路径；下载服务器地址、认证信息、目录和标签均在迁移范围内。当前实现支持：

- `站点 + 下载器 + 非空保存目录` 组成不可拆分的站点绑定；
- 站点绑定优先于全局默认下载器，不能把绑定目录静默交给另一下载器；
- 只有站点没有独立目录绑定时，才回退到全局默认下载器及其目录或根目录；
- 单一站点绑定可直接推送；多下载器绑定或多目录未指定默认值时要求用户选择；
- 标签是目标的可选附属参数，单独设置标签或下载器不构成站点绑定；
- 搜索结果、站点列表/详情、高级批量选择和右键菜单共用同一目标解析器；
- 跨站批量推送时，每条种子按所属站点分别解析下载器、目录和标签。

PT-depiler 在 [issue #454](https://github.com/pt-plugins/PT-depiler/issues/454) 中说明不会实现“按站点绑定下载器及下载目录”的设计；本项目将该能力作为必须保留的核心功能继续维护。

## 开发与验证

需要 Node.js 24 或更高版本以及 pnpm 11.16 或更高版本：

```bash
pnpm install
pnpm verify
```

`pnpm verify` 会依次执行类型检查、数据迁移与模型测试、生产构建、构建产物校验，以及 service worker/offscreen 运行时测试。Chrome 构建输出位于 `dist-chrome/`，可在 Chrome 或 Edge 的扩展程序页面启用开发者模式后，通过“加载已解压的扩展程序”载入。

首次实机验收至少应确认：设置页可打开、站点编辑页显示“下载服务器与目录”、站点页面工具栏可注入、service worker 控制台无启动错误。随后应使用真实 qBittorrent/Transmission 验证单站和跨站批量推送的最终目录与标签。普通 `http://localhost` 预览不具备扩展 API，不能替代加载已解压扩展测试。

## 目录

- `app/`：基于 PT-depiler 的 Vue/Vite 应用、options、content script、background/offscreen、站点、搜索与下载器模块；
- `src/`：PTPP 配置迁移、站点默认下载器模型、版本化存储和底层 MV3 验证代码；
- `vite.config.ts`：Chrome/Firefox 扩展入口和 MV3 manifest 构建配置；
- `tests/`：数据模型、迁移与扩展运行时测试；
- `legacy-mv2/`：归档的原始 MV2 项目；
- `MV3_UPGRADE_CHECKLIST.md`：功能范围、迁移策略和验收清单。

## License

[MIT](./LICENSE)
