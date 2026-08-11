import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist-chrome");

function assert(condition, message) {
  if (!condition) throw new Error(`MV3 application smoke test failed: ${message}`);
}

function read(relativePath) {
  const absolute = path.join(output, relativePath);
  assert(fs.existsSync(absolute), `${relativePath} exists`);
  return fs.readFileSync(absolute, "utf8");
}

const manifest = JSON.parse(read("manifest.json"));
const worker = read(manifest.background.service_worker);
const contentScript = read(manifest.content_scripts[0].js[0]);
const optionsHtml = read(manifest.options_ui.page);
const offscreenHtml = read("src/entries/offscreen/offscreen.html");
const offscreenModuleReference = offscreenHtml.match(/<script[^>]+src="([^"]+)"/)?.[1];
assert(offscreenModuleReference, "offscreen page references its module entry");
const offscreenModule = read(
  offscreenModuleReference.startsWith("/")
    ? offscreenModuleReference.slice(1)
    : path
        .relative(output, path.resolve(output, "src/entries/offscreen", offscreenModuleReference))
        .replaceAll("\\", "/"),
);

assert(worker.includes("openOptionsPage"), "action worker contains options-page behavior");
assert(worker.includes("onMessage"), "service worker contains message listeners");
assert(worker.includes("Runtime migration ready"), "service worker bundles the PTPP-to-PTD migration bridge");
assert(worker.includes("siteDownloadProfiles"), "service worker bundles site-specific download profiles");
assert(worker.includes("ptppMigrationKey"), "service worker bundles idempotent PTPP download-history migration");
assert(worker.includes("userHistorySites"), "service worker bundles PTPP user-history runtime migration");
assert(worker.includes("togglePtppCollection"), "service worker owns the PTPP favorites mutation handler");
assert(worker.includes("getPtppCollectionItem"), "service worker owns the PTPP favorites lookup handler");
assert(worker.includes("getPtppCollectionState"), "service worker exposes complete PTPP favorites state");
assert(worker.includes("createPtppCollectionGroup"), "service worker exposes favorite-group CRUD");
assert(worker.includes("setPtppCollectionItemGroup"), "service worker exposes favorite-group assignment");
assert(!worker.includes("com.ptd.native"), "service worker excludes the PTD-only native messaging bridge");
assert(
  !offscreenModule.includes("togglePtppCollection"),
  "offscreen module does not construct the favorites repository",
);
assert(
  !offscreenModule.includes("getMediaServerSearchResult"),
  "offscreen module excludes PTD-only media-server search",
);
assert(contentScript.includes("pt-plugin-plus-mv3.css"), "content script loads the generated shadow-DOM stylesheet");
assert(optionsHtml.includes('type="module"'), "options page loads its module entry");
assert(offscreenHtml.includes('type="module"'), "offscreen page loads its module entry");

for (const html of [optionsHtml, offscreenHtml]) {
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (reference.startsWith("data:") || reference.startsWith("http")) continue;
    const base = reference.startsWith("/") ? output : path.dirname(path.join(output, manifest.options_ui.page));
    const target = reference.startsWith("/") ? path.join(base, reference.slice(1)) : path.resolve(base, reference);
    assert(fs.existsSync(target), `HTML asset exists: ${reference}`);
  }
}

const requiredSourceModules = [
  "app/src/entries/options/main.ts",
  "app/src/entries/options/main.scss",
  "app/src/entries/options/views/Layout/Navigation.vue",
  "app/src/entries/options/views/Layout/Topbar.vue",
  "app/src/entries/background/main.ts",
  "app/src/entries/background/utils/collection.ts",
  "app/src/entries/options/views/Overview/MyCollection/Index.vue",
  "app/src/entries/options/views/Overview/MyCollection/GroupCard.vue",
  "app/src/entries/content-script/index.ts",
  "app/src/entries/content-script/app/components/DownloadTargetMenu.vue",
  "app/src/entries/options/components/DownloadTargetMenu.vue",
  "app/src/entries/offscreen/offscreen.ts",
  "app/src/packages/downloader/entity/qBittorrent.ts",
  "app/src/packages/downloader/entity/Transmission.ts",
];
for (const sourceModule of requiredSourceModules) {
  assert(fs.existsSync(path.join(root, sourceModule)), `imported framework module exists: ${sourceModule}`);
}

const downloadMenuSource = fs.readFileSync(
  path.join(root, "app/src/entries/content-script/app/components/DownloadTargetMenu.vue"),
  "utf8",
);
const optionsDownloadMenuSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/components/DownloadTargetMenu.vue"),
  "utf8",
);
const contentAppSource = fs.readFileSync(path.join(root, "app/src/entries/content-script/app/App.vue"), "utf8");
const optionsRouterSource = fs.readFileSync(path.join(root, "app/src/entries/options/plugins/router.ts"), "utf8");
const searchActionSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/views/Overview/SearchEntity/ActionTd.vue"),
  "utf8",
);
const advancedListSource = fs.readFileSync(
  path.join(root, "app/src/entries/content-script/app/components/AdvanceListModuleDialog.vue"),
  "utf8",
);
const downloaderDialogSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/components/SentToDownloaderDialog/Index.vue"),
  "utf8",
);
const downloadHistorySource = fs.readFileSync(
  path.join(root, "app/src/entries/options/views/Overview/DownloadHistory/Index.vue"),
  "utf8",
);
const reDownloadSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/views/Overview/DownloadHistory/ReDownloadSelectDialog.vue"),
  "utf8",
);
const contextLinkPushSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/views/ContextMenuLinkPush.vue"),
  "utf8",
);
const siteDownloadProfileEditorSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/views/Settings/SetSite/SiteDownloadProfileEditor.vue"),
  "utf8",
);
const setDownloaderSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/views/Settings/SetDownloader/Index.vue"),
  "utf8",
);
const optionsShellStyleSource = fs.readFileSync(path.join(root, "app/src/entries/options/main.scss"), "utf8");
const optionsNavigationSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/views/Layout/Navigation.vue"),
  "utf8",
);
const optionsTopbarSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/views/Layout/Topbar.vue"),
  "utf8",
);
const collectionSource = fs.readFileSync(
  path.join(root, "app/src/entries/options/views/Overview/MyCollection/Index.vue"),
  "utf8",
);
const backupSource = fs.readFileSync(path.join(root, "app/src/entries/offscreen/utils/backup.ts"), "utf8");
assert(
  optionsTopbarSource.includes('rounded="circle"') && optionsTopbarSource.includes('@click.stop="toggleNavigation"'),
  "options navigation toggle has an explicit circular shape and isolated click handler",
);
assert(
  optionsNavigationSource.includes(':model-value="configStore.isNavBarOpen"') &&
    !optionsNavigationSource.includes('v-model="drawerOpen"'),
  "options drawer follows the persisted navigation state without an internal model write-back",
);
assert(
  optionsShellStyleSource.includes("clip-path: circle(50% at 50% 50%)") &&
    optionsShellStyleSource.includes("border-radius: 50% !important"),
  "options navigation toggle clips its pressed feedback to a circle",
);
assert(!downloadMenuSource.includes("<v-menu"), "download-to uses the PTPP anchored menu instead of a PTD overlay");
assert(downloadMenuSource.includes('role="menu"'), "download-to anchored menu preserves menu semantics");
assert(
  downloadMenuSource.includes('window.addEventListener("keydown"') &&
    downloadMenuSource.includes('document.addEventListener("pointerdown"'),
  "download-to menu closes across the shadow-root boundary",
);
assert(!optionsDownloadMenuSource.includes("<v-menu"), "options download-to uses an anchored PTPP menu");
assert(optionsDownloadMenuSource.includes('role="menu"'), "options download-to preserves menu semantics");
assert(
  siteDownloadProfileEditorSource.includes("ptpp-site-download-profile-row") &&
    !siteDownloadProfileEditorSource.includes("<v-expansion-panel"),
  "site download bindings use the always-visible PTPP row layout instead of PTD accordions",
);
for (const ptdOnlyRoute of ["MediaServerEntity", "MyClient", "SetMediaServer", "Debugger"]) {
  assert(!optionsRouterSource.includes(ptdOnlyRoute), `options router excludes PTD-only route: ${ptdOnlyRoute}`);
}
assert(optionsRouterSource.includes('name: "MyCollection"'), "options router exposes the PTPP favorites page");
assert(
  collectionSource.includes("ptpp-collection-groups") && collectionSource.includes("getPtppCollectionState"),
  "favorites use the PTPP group-card and full-width table layout",
);
assert(
  collectionSource.includes("visibleCollectionGroupIds") && collectionSource.includes("movie_placeholder.png"),
  "favorites hide redundant group cards and restore the PTPP cover-title row layout",
);
assert(
  collectionSource.includes("ActionTd") && collectionSource.includes("setPtppCollectionItemGroup"),
  "favorites support downloader actions and group assignment",
);
assert(
  backupSource.includes('backupFields.includes("collection")') &&
    backupSource.includes('restoreFields.includes("collection")'),
  "favorites participate in current local and WebDAV backup round trips",
);
assert(
  ["general", "search", "download", "advanced"].every((tabKey) => optionsRouterSource.includes(`tabKey: "${tabKey}"`)),
  "general settings expose the four PTPP tab groups",
);
assert(
  searchActionSource.includes("sendToDefaultDownloader") && searchActionSource.includes("sendTorrentAssignments"),
  "search-result default push sends resolved assignments directly",
);
assert(
  searchActionSource.includes("DownloadTargetMenu") && !searchActionSource.includes("<SentToDownloaderDialog"),
  "search-result manual push uses the PTPP anchored target menu",
);
assert(
  advancedListSource.includes("handleDefaultRemoteDownloadMulti") &&
    advancedListSource.includes("sendTorrentAssignments"),
  "advanced-list default push sends resolved assignments directly",
);
assert(
  advancedListSource.includes("DownloadTargetMenu") && !advancedListSource.includes("<SentToDownloaderDialog"),
  "advanced-list manual push uses the PTPP anchored target menu",
);
assert(
  contentAppSource.includes("DownloadTargetMenu") && !contentAppSource.includes("<SentToDownloaderDialog"),
  "content-script drag fallback uses the PTPP target menu instead of the PTD dialog",
);
assert(
  reDownloadSource.includes("DownloadTargetMenu") && !reDownloadSource.includes("<SentToDownloaderDialog"),
  "download-history manual resend uses the PTPP target menu",
);
assert(
  contextLinkPushSource.includes("DownloadTargetMenu") && !contextLinkPushSource.includes("<SentToDownloaderDialog"),
  "context-menu link push uses the PTPP target menu",
);
assert(
  !searchActionSource.includes("is-default-send") &&
    !advancedListSource.includes("isDefaultSend") &&
    !downloaderDialogSource.includes("isDefaultSend"),
  "default push no longer mounts the PTD centered downloader dialog",
);
assert(
  downloadHistorySource.includes("safeDownloadDetail") &&
    !downloadHistorySource.includes("JSON.stringify(downloadDetail, null, 2)"),
  "download-history details never render raw request URLs, headers, or credentials",
);
assert(
  setDownloaderSource.includes("deleteAffectedSiteNames") &&
    setDownloaderSource.includes("SetDownloader.index.deleteAffectedSites"),
  "deleting a downloader warns about site bindings before the confirmed cascade",
);

console.log("MV3 application manifest, entries, and imported framework modules passed smoke checks.");
