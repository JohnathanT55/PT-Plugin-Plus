# PT-Plugin-Plus MV3

这是 PT-Plugin-Plus 的 Manifest V3 延续版本。仓库根目录现在直接保存 MV3 代码；原项目归档时的 Manifest V2 源码完整保存在 [`legacy-mv2/`](./legacy-mv2/) 中，便于查阅、功能对照和后续迁移。

## 当前阶段

当前版本已经接入 PT-depiler 的 Vite、Vue 3、Vuetify、Pinia 应用框架以及 options、content script、service worker、offscreen 等 MV3 入口，并导入其站点、搜索、下载器、备份和影片信息模块。仓库同时保留了 PTPP 配置迁移、版本化存储和“站点默认下载器/目录”数据模型。

自动化验证已经覆盖类型检查、迁移与模型测试、生产构建、MV3 manifest/入口检查、动态代码扫描以及 service worker/offscreen 冒烟测试。真实站点登录、下载器连接和浏览器加载扩展仍需按 [`MV3_UPGRADE_CHECKLIST.md`](./MV3_UPGRADE_CHECKLIST.md) 逐项实机验收，因此当前构建还不能称为旧版 PTPP 的完整替代品。

站点设置和完整搜索以 PT-depiler 的数据模型与交互为基线，同时继续实现 PTPP 的差异功能。导入基线和许可说明见 [`PTD_UPSTREAM.md`](./PTD_UPSTREAM.md)。

## 默认下载器与下载目录

本版本保留 PT-depiler 的全局默认下载器，并新增按站点设置默认下载器的模型；下载服务器地址、认证信息、目录和标签均在迁移范围内。数据模型支持：

- `站点 → 默认下载器` 绑定；
- `站点 + 下载器 → 默认目录/多个候选目录/标签`；
- 全局默认下载器与全局目录作为回退；
- 目录唯一时直接推送，存在多个候选目录时要求用户选择。

PT-depiler 在 [issue #454](https://github.com/pt-plugins/PT-depiler/issues/454) 中说明不会实现“按站点绑定下载器及下载目录”的设计；本项目将该能力作为必须保留的核心功能继续维护。

## 开发与验证

需要 Node.js 24 或更高版本以及 pnpm 11.16 或更高版本：

```bash
pnpm install
pnpm verify
```

`pnpm verify` 会依次执行类型检查、数据迁移与模型测试、生产构建、构建产物校验，以及 service worker/offscreen 运行时测试。Chrome 构建输出位于 `dist-chrome/`，可在 Chrome 或 Edge 的扩展程序页面启用开发者模式后，通过“加载已解压的扩展程序”载入。

首次实机验收至少应确认：设置页可打开、站点页面工具栏可注入、service worker 控制台无启动错误。普通 `http://localhost` 预览不具备扩展 API，不能替代加载已解压扩展测试。

## 目录

- `app/`：基于 PT-depiler 的 Vue/Vite 应用、options、content script、background/offscreen、站点、搜索与下载器模块；
- `src/`：PTPP 配置迁移、站点默认下载器模型、版本化存储和底层 MV3 验证代码；
- `vite.config.ts`：Chrome/Firefox 扩展入口和 MV3 manifest 构建配置；
- `tests/`：数据模型、迁移与扩展运行时测试；
- `legacy-mv2/`：归档的原始 MV2 项目；
- `MV3_UPGRADE_CHECKLIST.md`：功能范围、迁移策略和验收清单。

## License

[MIT](./LICENSE)
