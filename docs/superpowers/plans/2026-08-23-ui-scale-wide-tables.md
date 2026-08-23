# PTPP UI Scale and Wide Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user requested one final commit after all verification, so do not create intermediate commits.

**Goal:** Complete `MV3_UPGRADE_CHECKLIST.md` section 9.5 by adding persisted PTPP-internal UI scaling and making every in-scope wide table operable at ordinary viewport sizes.

**Architecture:** Keep Chrome tab zoom untouched. Scale the `#ptpp` application root with CSS `zoom`, propagate the same scale to each teleported Vuetify overlay's content without scaling the overlay positioning container, and store an allowed percentage in the existing config store. A shared responsive data-table wrapper owns the discoverable top horizontal scrollbar and action-column normalization so individual pages do not duplicate SearchEntity's implementation.

**Tech Stack:** Vue 3, Vuetify 3, Pinia, TypeScript, Sass, tsx behavior tests, Chrome Extension CDP against the built `dist-chrome` extension.

**Spec:** `MV3_UPGRADE_CHECKLIST.md` §9.5 “后续阶段：全局界面缩放与其余宽表格”.

## Global constraints

- Preserve the archived PTPP visual language and all existing page behavior.
- Never call `chrome.tabs.setZoom`, request a new browser permission, or overwrite Chrome zoom.
- Never infer browser zoom from `devicePixelRatio`; label it only as the combined device pixel ratio.
- Scaling must not refresh the route, rerun a search, mutate table column preferences, clear selections, or close open dialogs.
- A teleported menu/dialog must stay anchored and usable at every supported scale.
- Destructive downloader operations are outside this batch.

### Task 1: Add failing scale-domain and table-domain behavior tests

**Files:**

- Create: `tests/mv3/ui-scale.ts`
- Create: `tests/mv3/responsive-table.ts`
- Modify: `package.json`

**Steps:**

1. Test the exact allowed scale steps (`80, 90, 100, 110, 125`), normalization of missing/invalid/legacy values, increment/decrement clamping, and reset.
2. Test presentation metadata for internal scale and combined device pixel ratio without claiming a browser-zoom value.
3. Test action-column normalization and overflow measurement without mutating the caller's header array.
4. Register both scripts in `pnpm test` and run them once to confirm they fail because the production modules do not exist.

### Task 2: Implement persisted internal scale and controls

**Files:**

- Create: `app/src/entries/shared/uiScale.ts`
- Create: `app/src/entries/options/components/UiScaleControl.vue`
- Modify: `app/src/entries/shared/types/storages/config.ts`
- Modify: `app/src/entries/options/stores/config.ts`
- Modify: `app/src/entries/options/App.vue`
- Modify: `app/src/entries/options/views/Layout/Topbar.vue`
- Modify: `app/src/entries/options/views/Settings/SetBase/UiWindow.vue`
- Modify: locale files under `app/src/entries/options/locales/`
- Modify: `app/src/entries/options/main.scss`

**Steps:**

1. Implement pure scale normalization/stepping helpers and make the domain tests pass.
2. Add `uiScale` to the config schema with default `100`; normalize it during restore so old backups/configs migrate safely.
3. Expose compact decrease/current/increase/reset controls in the top bar and a labeled setting in the appearance section. Disable boundary actions and persist changes through the existing config store.
4. Apply the scale as a document CSS variable and CSS `zoom` on `#ptpp`. Apply the same `zoom` to direct overlay content children, while leaving `.v-overlay-container` unscaled so Vuetify's connected-location calculations remain in viewport coordinates.
5. Replace the current `devicePixelRatio` warning with neutral display diagnostics. Internal scale and combined device pixel ratio are separate; no value is auto-corrected.
6. Verify menu, dialog, Snackbar and loading-overlay alignment before proceeding.

### Task 3: Extract the reusable responsive table wrapper

**Files:**

- Create: `app/src/entries/options/components/ResponsiveDataTable.vue`
- Create: `app/src/entries/options/utils/responsiveTable.ts`
- Modify: `app/src/entries/options/main.scss`
- Modify: `app/src/entries/options/views/Overview/SearchEntity.vue`

**Steps:**

1. Implement immutable header normalization with a stable end-fixed action column and pure overflow measurement.
2. Wrap `v-data-table` with transparent attribute/event/slot forwarding.
3. Add a keyboard-focusable top horizontal scrollbar synchronized bidirectionally with the table's native scroller. Show it only when overflow exists.
4. Use `ResizeObserver`, route/view updates and scale changes to remeasure; clean every listener and observer during unmount.
5. Refactor SearchEntity to the wrapper, preserving selection, pagination, sorting, fixed action controls and the completed phase-one behavior.

### Task 4: Migrate and audit all in-scope wide tables

**Files:**

- Modify tables in `Overview/DownloadHistory`, `Overview/MyCollection`, `Overview/KeepUploadTask`, `Overview/MyData`, `Overview/MyClient`, and `Overview/SearchResultSnapshot`
- Modify tables in `Settings/SetDownloader`, `Settings/SetSite`, `Settings/SetSearchSolution`, `Settings/SetDownloadPaths`, and `Settings/SetBackup` including backup history dialogs
- Modify tables in `About/Logger`

**Steps:**

1. Replace direct data tables with the wrapper, retaining each page's slots and v-model semantics.
2. Give title/description columns bounded flexible widths; keep user-selected data columns scrollable.
3. Normalize right-side operation columns and sticky backgrounds across light/dark, hover, stripe and selected states.
4. Verify top toolbars, pagination and column-setting controls remain reachable at 1280×720 and 100% internal scale.

### Task 5: Automated verification and release build

**Commands:**

- `pnpm typecheck`
- `pnpm typecheck:foundation`
- `pnpm test`
- `pnpm build`
- `pnpm validate`
- `pnpm audit:chrome-store`
- `pnpm test:runtime`

Fix any failure at its root and rerun the affected command, then run the complete gate once.

### Task 6: Chrome Extension CDP acceptance matrix

**Runtime:** isolated Chrome for Testing and `dist-chrome` only.

1. Verify extension ID, name, version and Manifest V3 after every final rebuild/reload.
2. Cover 1280×720, 1536×864 and 1920×1080; internal 80/90/100/110/125; Chrome zoom 80/100/125; emulated DPR combinations representative of Windows 100/125/150 where CDP supports it.
3. At each representative combination, verify navigation toggle, fixed top bar/navigation, route changes, no document-level horizontal overflow, and reachable table action/pagination controls.
4. Open a select menu, a dialog, a Snackbar/loading state if safely triggerable, and verify bounding-box alignment plus click targets.
5. Test light/dark and Chinese/English; make sure selected/striped/fixed action backgrounds remain legible.
6. Change scale with an open route/table state and confirm route, selection, pagination and search results do not reset.
7. Collect runtime errors/unhandled rejections; final result must be clean apart from explicitly documented third-party/network failures.

### Task 7: Checklist, commit and push

**Files:**

- Modify: `MV3_UPGRADE_CHECKLIST.md`

**Steps:**

1. Mark only requirements proven by automated and CDP evidence as complete and add concise verification notes.
2. Confirm `git diff --check`, review the complete diff and ensure unrelated user files are not included.
3. Create one conventional commit with an extended description covering architecture, migrated pages, tests and CDP matrix.
4. Push the current branch to its configured remote and report the exact commit hash.
