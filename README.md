# PT-Plugin-Plus MV3

这是 PT-Plugin-Plus 的 Manifest V3 延续版本。仓库根目录现在直接保存 MV3 代码；原项目归档时的 Manifest V2 源码完整保存在 [`legacy-mv2/`](./legacy-mv2/) 中，便于查阅、功能对照和后续迁移。

## 当前阶段

当前提交建立了可构建、可测试的 MV3 基础架构，包括 Chrome service worker、offscreen document、类型化消息、alarms、版本化数据模型、不可变 storage revision，以及从旧 PTPP 配置迁移的基础能力。旧版 UI、搜索、站点适配和下载业务仍会按 [`MV3_UPGRADE_CHECKLIST.md`](./MV3_UPGRADE_CHECKLIST.md) 逐步接入，因此当前构建还不是旧版 PTPP 的完整替代品。

站点设置和完整搜索计划优先采用 PT-depiler 的数据模型与交互，同时保留 PTPP 的差异功能。

## 默认下载器与下载目录

本版本明确支持为站点设置默认下载器，并保留下载服务器地址、认证信息、目录和标签。数据模型支持：

- `站点 → 默认下载器` 绑定；
- `站点 + 下载器 → 默认目录/多个候选目录/标签`；
- 全局默认下载器与全局目录作为回退；
- 目录唯一时直接推送，存在多个候选目录时要求用户选择。

PT-depiler 在 [issue #454](https://github.com/pt-plugins/PT-depiler/issues/454) 中说明不会实现“按站点绑定下载器及下载目录”的设计；本项目将该能力作为必须保留的核心功能继续维护。

## 开发与验证

需要 Node.js 20 或更高版本以及 pnpm：

```bash
pnpm install
pnpm verify
```

`pnpm verify` 会依次执行类型检查、数据迁移与模型测试、构建产物校验，以及 service worker/offscreen 运行时测试。构建输出位于 `dist/`，可在 Chrome 的扩展程序页面启用开发者模式后，通过“加载已解压的扩展程序”载入。

## 目录

- `src/`：MV3 service worker、offscreen、消息、迁移、模型与存储代码；
- `public/`：MV3 manifest、offscreen 页面、本地化和图标；
- `tests/`：数据模型、迁移与扩展运行时测试；
- `legacy-mv2/`：归档的原始 MV2 项目；
- `MV3_UPGRADE_CHECKLIST.md`：功能范围、迁移策略和验收清单。

## License

[MIT](./LICENSE)
