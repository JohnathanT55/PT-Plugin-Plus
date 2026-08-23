# Responsive Primary Columns and Settings Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用主列/次列/action 列契约替代全局界面缩放，保证固定操作区完全不透明，并修复重复点击“常规设置”后内容空白。

**Architecture:** 先以安全反向变更撤回 `4512a718`，随后只为搜索结果页重建共享表格、顶部滚动条和角色映射。表格工具层负责不可变表头归一化，组件层负责滚动同步，主题 CSS 负责 action 隔离；其他页面保持原生 `v-data-table`。设置导航通过默认子路由解析和合法 Tab 归一化消除父路由空状态。

**范围修正（2026-08-23）:** 初次执行曾将角色映射扩展到全部表格页，实机反馈证明普通页面因此失去原有展示优势。最终产品范围收窄为仅 `/search-entity` 使用 `ResponsiveDataTable`；Task 4 的全页面迁移步骤已被本修正取代，CDP 审计同时验证其他表格路由不存在共享响应式外壳。

**Tech Stack:** Vue 3、TypeScript、Pinia、Vue Router 4、Vuetify 3、SCSS、tsx tests、Chrome Extension CDP、Manifest V3。

**Spec:** `docs/superpowers/specs/2026-08-23-responsive-primary-columns-settings-navigation-design.md`

## Global Constraints

- 不重写已推送历史，不使用 `git reset --hard` 或 force-push。
- 不增加依赖、Chrome 权限或 host permission。
- 删除 PTPP 应用级缩放；100% 浏览器缩放必须正常可用。
- action 列固定右侧且所有状态完全不透明；primary/secondary 不固定。
- 不改写用户的列、排序、分页、选择或现有业务数据。
- UI 延续老板版 PTPP 主题，不引入 PTD 产品外壳。

---

### Task 1: 安全撤回 `4512a718` 并保留执行文档

**Files:**

- Revert source: commit `4512a7183d01656fa60d6c773a085c7c88fbc803`
- Keep: `docs/superpowers/specs/2026-08-23-responsive-primary-columns-settings-navigation-design.md`
- Keep: `docs/superpowers/plans/2026-08-23-responsive-primary-columns-settings-navigation.md`

**Interfaces:**

- Consumes: 干净的 `master`，HEAD 为 `4512a718` 或其无冲突后继。
- Produces: 未提交的反向变更；旧缩放系统已移除，下一任务可重建表格能力。

- [ ] **Step 1: 核对基线与远端**

Run:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/master
```

Expected: 工作区除本计划/规格外无产品代码修改；本地与远端提交一致。

- [ ] **Step 2: 生成不提交的安全回滚**

Run:

```powershell
git revert --no-commit 4512a7183d01656fa60d6c773a085c7c88fbc803
```

Expected: 无冲突；`UiScaleControl.vue`、`uiScale.ts`、缩放测试和旧缩放计划进入删除状态。

- [ ] **Step 3: 确认缩放实现已经退出产品代码**

Run:

```powershell
rg -n "UiScaleControl|uiScale|ptpp-ui-scaled|--ptpp-ui-scale" app/src tests/mv3 package.json
```

Expected: 产品代码无命中；旧备份兼容字段 `ignoreWrongPixelRatio` 可以保留，但 UI 不再显示 DPR 警告。

- [ ] **Step 4: 保持回滚未提交，进入共享表格重建**

Run:

```powershell
git status --short
```

Expected: 所有反向变更仍在同一个最终替代提交中，未产生中间 commit。

---

### Task 2: 以测试定义主列/次列/action 列契约

**Files:**

- Create: `app/src/entries/options/utils/responsiveTable.ts`
- Create: `tests/mv3/responsive-table.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `ResponsiveColumnRole`, `ResponsiveTableHeader`, `ResponsiveHeaderOptions`, `normalizeResponsiveHeaders()` 和 `measureHorizontalOverflow()`。

- [ ] **Step 1: 写失败测试**

Add assertions equivalent to:

```ts
const headers = [
  { key: "title", title: "Title", minWidth: "18rem" },
  { key: "size", title: "Size" },
  { key: "action", title: "Action", width: 120 },
];
const normalized = normalizeResponsiveHeaders(headers, {
  primaryKeys: ["title"],
  actionKey: "action",
  actionWidth: "11rem",
  secondaryMinWidth: "7rem",
});
assert.equal(normalized[0].ptppRole, "primary");
assert.equal(normalized[0].fixed, undefined);
assert.equal(normalized[1].ptppRole, "secondary");
assert.equal(normalized[1].minWidth, "7rem");
assert.equal(normalized[2].ptppRole, "action");
assert.equal(normalized[2].fixed, "end");
assert.equal(normalized[2].minWidth, "11rem");
assert.deepEqual(headers, originalHeaders);
```

Also cover legacy `value: "action"`, multiple action keys, existing explicit `minWidth`, clamped scroll offsets and no-overflow measurements.

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
pnpm tsx tests/mv3/responsive-table.ts
```

Expected: FAIL because role-aware utility does not exist after the revert.

- [ ] **Step 3: 实现纯函数契约**

Implement:

```ts
export type ResponsiveColumnRole = "primary" | "secondary" | "action";

export interface ResponsiveHeaderOptions {
  primaryKeys?: readonly string[];
  actionKey?: string | readonly string[];
  actionWidth?: number | string;
  secondaryMinWidth?: number | string;
}

export function normalizeResponsiveHeaders<T extends ResponsiveTableHeader>(
  headers: readonly T[],
  options: ResponsiveHeaderOptions = {},
): T[];
```

Rules: clone every header; action gets `fixed: "end"`, non-sortable, explicit width and action classes; primary gets only primary classes; remaining columns get secondary classes and a default minimum width only when the header has neither `width` nor `minWidth`.

- [ ] **Step 4: 注册并运行测试**

Run:

```powershell
pnpm tsx tests/mv3/responsive-table.ts
pnpm test
```

Expected: responsive domain test PASS；完整测试仍 PASS。

---

### Task 3: 重建共享滚动组件与不透明固定区

**Files:**

- Create: `app/src/entries/options/components/ResponsiveDataTable.vue`
- Modify: `app/src/entries/options/main.scss`
- Modify: `tests/mv3/responsive-table.ts`

**Interfaces:**

- Consumes: `normalizeResponsiveHeaders()` from Task 2.
- Produces: `<ResponsiveDataTable :primary-keys :action-key :action-width :secondary-min-width>`。

- [ ] **Step 1: 扩充失败测试检查固定区样式契约**

Assert the source contains stable role classes and rejects the previous transparent expression:

```ts
assert.match(mainScss, /--ptpp-table-hover-solid:/);
assert.match(mainScss, /\.ptpp-responsive-action-column[\s\S]*z-index:/);
assert.doesNotMatch(mainScss, /var\(--ptpp-hover\) 100%/);
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
pnpm tsx tests/mv3/responsive-table.ts
```

Expected: FAIL because the reverted tree has no shared wrapper or opaque action contract.

- [ ] **Step 3: 实现共享组件**

Component props:

```ts
headers: readonly DataTableHeader[];
primaryKeys?: readonly string[];
actionKey?: string | readonly string[];
actionWidth?: number | string;
secondaryMinWidth?: number | string;
topScrollbarLabel?: string;
```

Use one `ResizeObserver`, one `MutationObserver`, synchronized top/native `scrollLeft`, keyboard-focusable top scrollbar, and unconditional observer cleanup before reconnecting the same Vuetify wrapper.

- [ ] **Step 4: 实现实色主题状态**

Define opaque tokens for both themes:

```scss
--ptpp-table-hover-solid: #f5f5f5;
--ptpp-table-selected-hover-solid: #a8ddf5;
```

Dark equivalents must also be solid hex/rgb colors. Apply the same solid row state to ordinary cells and `.ptpp-responsive-action-column`; give action body cells stable `z-index: 3`, action headers `z-index: 4`, `isolation: isolate`, an opaque `background-color`, and the existing left divider shadow.

- [ ] **Step 5: 运行组件契约测试**

Run:

```powershell
pnpm tsx tests/mv3/responsive-table.ts
pnpm typecheck
```

Expected: PASS。

---

### Task 4: 将全部现有表格映射为主列、次列和 action 列（历史步骤，已被范围修正取代）

**Files:**

- Modify: `app/src/entries/options/views/About/Logger.vue`
- Modify: `app/src/entries/options/views/Overview/DownloadHistory/Index.vue`
- Modify: `app/src/entries/options/views/Overview/KeepUploadTask/Index.vue`
- Modify: `app/src/entries/options/views/Overview/MyClient/Index.vue`
- Modify: `app/src/entries/options/views/Overview/MyCollection/Index.vue`
- Modify: `app/src/entries/options/views/Overview/MyData/HistoryDataViewDialog.vue`
- Modify: `app/src/entries/options/views/Overview/MyData/Index.vue`
- Modify: `app/src/entries/options/views/Overview/SearchEntity/Index.vue`
- Modify: `app/src/entries/options/views/Overview/SearchResultSnapshot/Index.vue`
- Modify: `app/src/entries/options/views/Settings/SetBackup/HistoryDialog.vue`
- Modify: `app/src/entries/options/views/Settings/SetBackup/Index.vue`
- Modify: `app/src/entries/options/views/Settings/SetDownloader/Index.vue`
- Modify: `app/src/entries/options/views/Settings/SetDownloadPaths/Index.vue`
- Modify: `app/src/entries/options/views/Settings/SetSearchSolution/Index.vue`
- Modify: `app/src/entries/options/views/Settings/SetSite/Index.vue`
- Modify: `tests/mv3/search-layout.ts`

**Interfaces:**

- Consumes: Task 3 component props.
- Produces: spec “页面角色约定”表中的 exact role mapping。

- [ ] **Step 1: 恢复上一提交中仅与页面迁移有关的改造**

Use `git restore --source=4512a718 --staged --worktree --` only for the 15 table view files listed above and `tests/mv3/search-layout.ts`. Do not restore Task 2–3 已经重写的 component/utility/test，也不要恢复 `App.vue`, `UiScaleControl.vue`, `uiScale.ts`, config/locales scale changes, `main.scss`, scale tests, or the old scale plan.

- [ ] **Step 2: 为每页声明 primary keys**

Examples:

```vue
<ResponsiveDataTable :primary-keys="['site', 'title']" action-key="action" action-width="11rem" />
<ResponsiveDataTable :primary-keys="['siteId', 'title']" action-key="action" />
<ResponsiveDataTable :primary-keys="['name']" action-key="action" />
```

Apply every mapping from the spec. Tables without action columns omit `action-key`; they still receive top scrolling and secondary minimum widths.

- [ ] **Step 3: 保持页面特有宽度**

Keep search/download title `clamp()` widths, KeepUpload action width `14rem`, existing snapshot/history widths, and user column settings. Do not add breakpoint code that mutates `tableBehavior.*.columns`.

- [ ] **Step 4: 更新搜索布局契约测试**

Assert search uses shared wrapper, primary keys `site/title`, action key `action`, no page-local duplicate observer, and supported page sizes remain 10/25/50.

- [ ] **Step 5: 运行表格测试和类型检查**

Run:

```powershell
pnpm test
pnpm typecheck
```

Expected: PASS。

---

### Task 5: 修复“常规设置”重复点击的父路由空状态

**Files:**

- Create: `app/src/entries/options/utils/navigation.ts`
- Modify: `app/src/entries/options/views/Layout/Navigation.vue`
- Modify: `app/src/entries/options/views/Settings/SetBase/Index.vue`
- Create: `tests/mv3/settings-navigation.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `getNavigationTargetName(route)` and `DEFAULT_SET_BASE_ROUTE_NAME = "SetBaseGeneral"`。

- [ ] **Step 1: 写失败测试**

```ts
assert.equal(
  getNavigationTargetName({ name: "SetBase", children: [{ path: "", name: "SetBaseGeneral" }] }),
  "SetBaseGeneral",
);
assert.equal(getNavigationTargetName({ name: "SetSite" }), "SetSite");
```

Also assert `SetBase/Index.vue` normalizes an invalid/parent route name to `SetBaseGeneral` and no longer uses an unpaired `v-window` without `v-window-item` children.

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
pnpm tsx tests/mv3/settings-navigation.ts
```

Expected: FAIL because the helper and fallback do not exist.

- [ ] **Step 3: 实现菜单默认子路由解析**

```ts
export const DEFAULT_SET_BASE_ROUTE_NAME = "SetBaseGeneral" as const;

export function getNavigationTargetName(route: NavigationRouteLike) {
  return route.children?.find((child) => child.path === "")?.name ?? route.name;
}
```

`Navigation.vue` builds each `nav.name` with this helper, so “常规设置” always targets `SetBaseGeneral` rather than `SetBase`。

- [ ] **Step 4: 归一化设置 Tab**

In `SetBase/Index.vue`, derive a `Set` of legal child route names. Getter returns the current child name or `SetBaseGeneral`; setter ignores empty/current values and pushes only legal child names. Add an immediate route watcher that replaces `SetBase` with `SetBaseGeneral`. Replace the unpaired `<v-window>` wrapper with a normal content container because routing, not a Vuetify window group, owns the active page.

- [ ] **Step 5: 运行设置导航测试**

Run:

```powershell
pnpm tsx tests/mv3/settings-navigation.ts
pnpm test
pnpm typecheck
```

Expected: PASS。

---

### Task 6: Chrome Extension CDP 真实回归

**Files:**

- Create: `tests/mv3/responsive-table-cdp-audit.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: final `dist-chrome` and isolated loopback CDP target.
- Produces: deterministic JSON pass/fail report with runtime errors and network warnings.

- [ ] **Step 1: 构建并验证扩展身份**

Run:

```powershell
pnpm build
node <chrome-extension-cdp-skill>/scripts/inspect-extension.mjs http://127.0.0.1:9222 PT-Plugin-Plus 2.0.0
```

Expected: Manifest V3、名称、版本、service worker 和 options target 全部匹配。

- [ ] **Step 2: 编写 action 穿透回归**

Use 29 synthetic search rows. For light/dark and normal/stripe/hover/selected/selected-hover, assert:

```js
getComputedStyle(actionCell).backgroundColor; // parsed alpha === 1
getComputedStyle(actionCell).position === "sticky";
actionCell.getBoundingClientRect().right === scroller.getBoundingClientRect().right;
```

Scroll top and native bars from 0 to max; action rect must remain within 2px while secondary rects move. Move the real pointer over each action button, show tooltip, and require `elementsFromPoint()` to hit the action/button before any underlying secondary cell.

- [ ] **Step 3: 编写全页面矩阵**

Cover 1280×720、1536×864、1920×1080, Chrome 80%/100%/125%, navigation open/closed, both themes and zh_CN/en. Visit every registered table route and assert no document-level horizontal overflow, top scroll visibility matches actual overflow, action columns remain clickable, and runtime exceptions are zero.

- [ ] **Step 4: 编写设置重复点击回归**

Navigate away, click left “常规设置” three times, then click the active top Tab twice. After every action assert route name is `SetBaseGeneral`, “界面与交互” is selected, `.settings-content` contains controls, and the save bar remains visible.

- [ ] **Step 5: 运行 CDP audit 并恢复隔离状态**

Run:

```powershell
node tests/mv3/responsive-table-cdp-audit.mjs http://127.0.0.1:9222
```

Expected: `result: passed`, `runtimeErrors: 0`, `externalNetworkWarnings: 0`; finally restore 1280×720、100% Chrome zoom、浅色中文和原始 synthetic/search state。

---

### Task 7: 发布门禁、清单与替代提交

**Files:**

- Modify: `MV3_UPGRADE_CHECKLIST.md`
- Include: all files from Tasks 1–6 and this spec/plan

**Interfaces:**

- Produces: one auditable replacement commit; no force-push.

- [ ] **Step 1: 重写 9.5 验收口径**

Remove completed global-scale claims. Record the three-role table model, opaque fixed action guarantee, settings repeated-click fix, PTD reference commit `15f9c4db`, and exact CDP matrix result.

- [ ] **Step 2: 运行完整发布门禁**

Run:

```powershell
pnpm verify
git diff --check
```

Expected: typecheck、foundation typecheck、all tests、build、MV3 validation、Chrome Web Store audit 和 worker runtime PASS；diff check 无错误。

- [ ] **Step 3: 审查回滚边界**

Run:

```powershell
rg -n "UiScaleControl|uiScale|ptpp-ui-scaled|--ptpp-ui-scale" app/src tests/mv3 package.json
git status --short
git diff --stat
```

Expected: 无缩放产品代码；只有本规格明确的表格、导航、测试、文档和清单变更。

- [ ] **Step 4: 创建带 extended description 的替代提交**

Commit subject:

```text
fix: replace global zoom with stable responsive tables
```

Body must describe: safe semantic revert of `4512a718`; primary/secondary/action roles; fully opaque fixed actions; settings default-child routing fix; automated and CDP matrix results.

- [ ] **Step 5: 经用户授权后推送**

Run:

```powershell
git push origin master
```

Expected: fast-forward push；local HEAD equals `origin/master` and worktree is clean。
