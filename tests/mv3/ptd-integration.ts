import { migrateLegacyStorage } from "../../src/migration/legacy";
import { LEGACY_STORAGE_KEYS } from "../../src/storage/keys";
import {
  mergePtppStateIntoRuntimeConfig,
  mergePtppStateIntoRuntimeStores,
  persistPtppRuntimeMigration,
} from "../../app/src/entries/integration/ptppMigration";
import {
  buildSiteDownloadMenuTargets,
  hasConfiguredSiteDownloadTarget,
  hasSiteDownloadDirectoryBinding,
  normalizeSiteDownloadTarget,
  resolveSiteDownloadTarget,
} from "../../app/src/entries/shared/downloadTarget";
import { executePreflightedBatch } from "../../app/src/entries/shared/batchPreflight";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PTD integration test failed: ${message}`);
}

const migrated = migrateLegacyStorage(
  {
    [LEGACY_STORAGE_KEYS.config]: {
      defaultClientId: "qb-fixture",
      autoBackupData: true,
      autoBackupDataServerId: "webdav-fixture",
      encryptBackupData: true,
      encryptSecretKey: "fixture-secret",
      sites: [
        {
          id: "fixture-site",
          name: "Fixture Tracker",
          host: "tracker.example.invalid",
          defaultClientId: "qb-fixture",
          value: true,
        },
      ],
      clients: [
        {
          id: "qb-fixture",
          name: "qBittorrent Fixture",
          type: "qbittorrent",
          address: "https://downloader.example.invalid",
          loginName: "fixture-user",
          loginPwd: "fixture-password",
          paths: {
            __allSite__: ["/fixture/global-a", "/fixture/global-b"],
            "tracker.example.invalid": ["/fixture/site-a", "/fixture/site-b"],
          },
          tags: ["fixture-tag"],
        },
      ],
      backupServers: [
        {
          id: "webdav-fixture",
          type: "WebDAV",
          name: "Fixture WebDAV",
          address: "https://backup.example.invalid/dav",
          loginName: "fixture-user",
          loginPwd: "fixture-password",
          digest: true,
        },
      ],
    },
    [LEGACY_STORAGE_KEYS.userHistory]: {
      "tracker.example.invalid": {
        "2026-01-01": {
          uploaded: "1 GiB",
          ratio: "2.5",
          seedingPoints: 42,
          lastUpdateTime: 1000,
          lastUpdateStatus: "success",
        },
        latest: {
          uploaded: "2 GiB",
          lastUpdateTime: 2000,
          lastUpdateStatus: "success",
        },
      },
    },
    [LEGACY_STORAGE_KEYS.searchSnapshots]: {
      items: [
        {
          id: "snapshot-fixture",
          key: "fixture search",
          time: 3000,
          result: [
            {
              host: "tracker.example.invalid",
              id: "torrent-1",
              title: "Fixture Result",
              url: "https://tracker.example.invalid/download/1",
              link: "https://tracker.example.invalid/details/1",
              size: "4 GiB",
              status: 2,
              imdbId: "tt1234567",
            },
          ],
        },
      ],
    },
    [LEGACY_STORAGE_KEYS.keepUploadTasks]: [
      {
        id: "task-fixture",
        time: 4000,
        title: "Fixture Task",
        downloadOptions: {
          clientId: "qb-fixture",
          savePath: "/fixture/keep-upload",
          autoStart: false,
        },
        items: [
          {
            host: "tracker.example.invalid",
            id: "torrent-2",
            title: "Fixture Keep Upload",
            url: "https://tracker.example.invalid/download/2",
            link: "https://tracker.example.invalid/details/2",
            size: 1234,
          },
        ],
      },
    ],
    [LEGACY_STORAGE_KEYS.downloadHistory]: [
      {
        host: "tracker.example.invalid",
        clientId: "qb-fixture",
        time: 5000,
        success: true,
        data: {
          title: "Fixture Download",
          url: "https://tracker.example.invalid/download/3",
          link: "https://tracker.example.invalid/details/3",
          savePath: "/fixture/history",
        },
      },
      {
        host: "tracker.example.invalid",
        clientId: "qb-fixture",
        time: 5000,
        success: true,
        data: {
          title: "Fixture Download",
          url: "https://tracker.example.invalid/download/3",
          link: "https://tracker.example.invalid/details/3",
          savePath: "/fixture/history",
        },
      },
    ],
  },
  1000,
);
const state = migrated.state;
state.metadata.storageRevision = "fixture-revision";
const siteId = state.hostToSiteId["tracker.example.invalid"];
assert(siteId, "legacy host receives a stable siteId");

const configMerge = mergePtppStateIntoRuntimeConfig(state, undefined);
assert(configMerge.changed, "legacy automatic upload settings create an MV3 backup configuration");
assert(
  configMerge.config.backup?.autoUploadUserData.enabled === true &&
    configMerge.config.backup.autoUploadUserData.serverId === "webdav-fixture",
  "legacy automatic user-data upload and its selected server are retained",
);
assert(
  configMerge.config.backup?.retry.max === 3 && configMerge.config.backup.retry.interval === 5,
  "backup retries receive durable defaults",
);
assert(
  configMerge.config.backup?.encryptionEnabled === true && configMerge.config.backup.encryptionKey === "fixture-secret",
  "legacy local encryption settings migrate to the explicit MV3 switch",
);
const currentConfigMerge = mergePtppStateIntoRuntimeConfig(state, {
  backup: { encryptionKey: "", enabledAutoBackup: false } as any,
});
assert(
  currentConfigMerge.config.backup?.autoUploadUserData.enabled === true,
  "legacy automatic upload is restored when an older MV3 config lacks the new nested field",
);

const runtimeMerge = mergePtppStateIntoRuntimeStores(state, {}, [siteId], ["qBittorrent", "Transmission"], 2000);
assert(runtimeMerge.changed, "first PTPP to PTD runtime merge changes metadata");
assert(
  runtimeMerge.metadata.sites[siteId]?.merge?.name === "Fixture Tracker",
  "legacy site configuration is exposed to the PTD runtime store",
);
assert(
  runtimeMerge.metadata.downloaders["qb-fixture"]?.type === "qBittorrent",
  "legacy qBittorrent type is normalized to the PTD static entity",
);
assert(
  runtimeMerge.metadata.downloaders["qb-fixture"]?.address === "https://downloader.example.invalid",
  "legacy downloader address is retained in the PTD runtime store",
);
assert(
  runtimeMerge.metadata.backupServers["webdav-fixture"]?.backupFields.includes("collection") === true,
  "migrated WebDAV servers include favorites and groups by default",
);
assert(
  runtimeMerge.metadata.defaultDownloader.id === "qb-fixture",
  "legacy global default downloader is retained in the PTD runtime store",
);
assert(
  runtimeMerge.metadata.backupServers["webdav-fixture"]?.type === "WebDAV",
  "legacy WebDAV server is retained in the PTD runtime store",
);

const resolvedRuntimeTarget = resolveSiteDownloadTarget(runtimeMerge.metadata, siteId);
assert(
  resolvedRuntimeTarget.downloaderId === "qb-fixture" &&
    resolvedRuntimeTarget.savePath === "/fixture/site-a" &&
    resolvedRuntimeTarget.label === "fixture-tag" &&
    !resolvedRuntimeTarget.requiresSelection,
  "site default downloader, directory, and tag resolve for direct push",
);
assert(runtimeMerge.report.bridgeVersion === 2, "runtime migration marker records the bridge version");
assert(
  runtimeMerge.userInfo[siteId]["2026-01-01"].uploaded === 1024 ** 3 &&
    runtimeMerge.userInfo[siteId]["2026-01-01"].ratio === 2.5 &&
    runtimeMerge.userInfo[siteId]["2026-01-01"].seedingBonus === 42 &&
    runtimeMerge.metadata.lastUserInfo[siteId].uploaded === 2 * 1024 ** 3,
  "PTPP user history is converted into PTD history and latest-user metadata",
);
assert(
  runtimeMerge.metadata.snapshots["snapshot-fixture"].recordCount === 1 &&
    runtimeMerge.searchResultSnapshot["snapshot-fixture"].searchResult[0].url ===
      "https://tracker.example.invalid/details/1" &&
    runtimeMerge.searchResultSnapshot["snapshot-fixture"].searchResult[0].link ===
      "https://tracker.example.invalid/download/1" &&
    runtimeMerge.searchResultSnapshot["snapshot-fixture"].searchResult[0].status === "seeding" &&
    runtimeMerge.searchResultSnapshot["snapshot-fixture"].searchResult[0].ext_imdb === "tt1234567",
  "search snapshot metadata and PTPP/PTD reversed URL semantics are migrated",
);
assert(
  runtimeMerge.keepUploadTask["task-fixture"].downloadOptions.downloaderId === "qb-fixture" &&
    runtimeMerge.keepUploadTask["task-fixture"].downloadOptions.addTorrentOptions?.addAtPaused === true &&
    runtimeMerge.keepUploadTask["task-fixture"].items[0].link === "https://tracker.example.invalid/details/2",
  "keep-upload tasks retain downloader, pause behavior, and converted links",
);
assert(
  runtimeMerge.downloadHistoryAdditions.length === 2 &&
    runtimeMerge.downloadHistoryAdditions[0].addTorrentOptions.savePath === "/fixture/history" &&
    runtimeMerge.downloadHistoryAdditions[0].ptppMigrationKey !==
      runtimeMerge.downloadHistoryAdditions[1].ptppMigrationKey,
  "download history preserves duplicate legacy records with stable distinct migration keys",
);

const persistenceEvents: Array<{ type: string; value: any }> = [];
await persistPtppRuntimeMigration(runtimeMerge, {
  setStorage: async (value) => {
    persistenceEvents.push({ type: "storage", value });
  },
  addDownloadHistory: async (value) => {
    persistenceEvents.push({ type: "history", value });
  },
});
assert(
  persistenceEvents.length === 3 &&
    !persistenceEvents[0].value.metadata.ptppMigration &&
    persistenceEvents[1].value.length === 2 &&
    persistenceEvents[2].value.metadata.ptppMigration.bridgeVersion === 2,
  "runtime persistence writes the completion marker only after all data domains",
);

const failedPersistenceEvents: Array<{ type: string; value: any }> = [];
let persistenceFailed = false;
try {
  await persistPtppRuntimeMigration(runtimeMerge, {
    setStorage: async (value) => {
      failedPersistenceEvents.push({ type: "storage", value });
    },
    addDownloadHistory: async () => {
      throw new Error("fixture database failure");
    },
  });
} catch {
  persistenceFailed = true;
}
assert(
  persistenceFailed && failedPersistenceEvents.length === 1 && !failedPersistenceEvents[0].value.metadata.ptppMigration,
  "a failed data-domain write cannot commit the completion marker",
);

const ambiguousRuntimeMetadata = JSON.parse(JSON.stringify(runtimeMerge.metadata));
delete ambiguousRuntimeMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].defaultDirectory;
assert(
  resolveSiteDownloadTarget(ambiguousRuntimeMetadata, siteId).requiresSelection,
  "multiple site directories without an explicit default require selection",
);

const siteBindingBeatsGlobalMetadata = JSON.parse(JSON.stringify(runtimeMerge.metadata));
siteBindingBeatsGlobalMetadata.downloaders["transmission-global"] = {
  ...siteBindingBeatsGlobalMetadata.downloaders["qb-fixture"],
  id: "transmission-global",
  name: "Global Transmission",
  type: "Transmission",
  address: "https://transmission.example.invalid",
};
siteBindingBeatsGlobalMetadata.defaultDownloader = {
  id: "transmission-global",
  folder: "/downloads",
};
delete siteBindingBeatsGlobalMetadata.siteDownloadProfiles[siteId].defaultDownloaderId;
const siteBindingBeatsGlobal = resolveSiteDownloadTarget(siteBindingBeatsGlobalMetadata, siteId);
assert(
  siteBindingBeatsGlobal.downloaderId === "qb-fixture" &&
    siteBindingBeatsGlobal.savePath === "/fixture/site-a" &&
    siteBindingBeatsGlobal.source === "site-profile" &&
    siteBindingBeatsGlobal.reason === "site-single-binding" &&
    !siteBindingBeatsGlobal.requiresSelection,
  "a sole site-bound qBittorrent directory beats a global Transmission root",
);

const downloaderOnlyPreferenceMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
downloaderOnlyPreferenceMetadata.siteDownloadProfiles[siteId].defaultDownloaderId = "transmission-global";
downloaderOnlyPreferenceMetadata.siteDownloadProfiles[siteId].byDownloader["transmission-global"] = {
  directories: [],
  tags: [],
};
const downloaderOnlyPreferenceTarget = resolveSiteDownloadTarget(downloaderOnlyPreferenceMetadata, siteId);
assert(
  downloaderOnlyPreferenceTarget.downloaderId === "qb-fixture" &&
    downloaderOnlyPreferenceTarget.savePath === "/fixture/site-a" &&
    downloaderOnlyPreferenceTarget.reason === "site-single-binding" &&
    !downloaderOnlyPreferenceTarget.requiresSelection,
  "a downloader-only site preference cannot override another downloader's sole directory binding",
);
const siteDownloadMenuTargets = buildSiteDownloadMenuTargets(siteBindingBeatsGlobalMetadata, siteId);
const firstGeneralMenuTargetIndex = siteDownloadMenuTargets.findIndex((target) => target.kind === "general");
assert(
  firstGeneralMenuTargetIndex > 0 &&
    siteDownloadMenuTargets.slice(0, firstGeneralMenuTargetIndex).every((target) => target.kind === "site") &&
    siteDownloadMenuTargets[0].downloaderId === "qb-fixture" &&
    siteDownloadMenuTargets[0].savePath === "/fixture/site-a" &&
    siteDownloadMenuTargets.some(
      (target) => target.kind === "general" && target.downloaderId === "transmission-global" && target.savePath === "",
    ) &&
    siteDownloadMenuTargets.some(
      (target) =>
        target.kind === "general" && target.downloaderId === "transmission-global" && target.savePath === "/downloads",
    ),
  "the manual menu lists site-bound paths first and keeps global-default plus downloader-root overrides",
);
assert(
  new Set(siteDownloadMenuTargets.map((target) => [target.downloaderId, target.savePath, target.label].join("\u0000")))
    .size === siteDownloadMenuTargets.length,
  "the manual menu removes duplicate downloader/path/tag targets without changing site-first ordering",
);
const mixedSiteDownloadMenuTargets = buildSiteDownloadMenuTargets(siteBindingBeatsGlobalMetadata);
assert(
  mixedSiteDownloadMenuTargets.length > 0 && mixedSiteDownloadMenuTargets.every((target) => target.kind === "general"),
  "a mixed-site manual batch exposes only common downloader/root targets",
);

const noSiteBindingMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
noSiteBindingMetadata.siteDownloadProfiles[siteId].byDownloader = {};
const noSiteBindingTarget = resolveSiteDownloadTarget(noSiteBindingMetadata, siteId);
assert(
  noSiteBindingTarget.downloaderId === "transmission-global" &&
    noSiteBindingTarget.savePath === "/downloads" &&
    noSiteBindingTarget.source === "global-default" &&
    noSiteBindingTarget.reason === "global-default" &&
    !noSiteBindingTarget.requiresSelection,
  "the global downloader is used only when the site has no bound directory",
);

const noSiteOrGlobalFolderMetadata = JSON.parse(JSON.stringify(noSiteBindingMetadata));
noSiteOrGlobalFolderMetadata.defaultDownloader.folder = "";
const noSiteOrGlobalFolderTarget = resolveSiteDownloadTarget(noSiteOrGlobalFolderMetadata, siteId);
assert(
  noSiteOrGlobalFolderTarget.downloaderId === "transmission-global" &&
    noSiteOrGlobalFolderTarget.savePath === "" &&
    !noSiteOrGlobalFolderTarget.requiresSelection,
  "a site with no independent directory may use the global downloader's root directory",
);

const downloaderOnlyWithoutBindingMetadata = JSON.parse(JSON.stringify(noSiteBindingMetadata));
downloaderOnlyWithoutBindingMetadata.siteDownloadProfiles[siteId].defaultDownloaderId = "qb-fixture";
downloaderOnlyWithoutBindingMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"] = {
  directories: [],
  tags: [],
};
const downloaderOnlyWithoutBindingTarget = resolveSiteDownloadTarget(downloaderOnlyWithoutBindingMetadata, siteId);
assert(
  downloaderOnlyWithoutBindingTarget.downloaderId === "transmission-global" &&
    downloaderOnlyWithoutBindingTarget.savePath === "/downloads" &&
    downloaderOnlyWithoutBindingTarget.source === "global-default" &&
    !downloaderOnlyWithoutBindingTarget.requiresSelection,
  "a downloader-only site preference falls back to the global downloader when no site directory exists",
);

const defaultDirectoryOnlyMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
defaultDirectoryOnlyMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"] = {
  directories: [],
  defaultDirectory: "/fixture/default-only",
  tags: [],
};
const defaultDirectoryOnlyTarget = resolveSiteDownloadTarget(defaultDirectoryOnlyMetadata, siteId);
assert(
  defaultDirectoryOnlyTarget.downloaderId === "qb-fixture" &&
    defaultDirectoryOnlyTarget.savePath === "/fixture/default-only" &&
    defaultDirectoryOnlyTarget.reason === "site-single-binding" &&
    !defaultDirectoryOnlyTarget.requiresSelection,
  "a site default directory remains an atomic binding even when it is not repeated in the candidate list",
);

const multipleSiteBindingsMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
multipleSiteBindingsMetadata.siteDownloadProfiles[siteId].byDownloader["transmission-global"] = {
  directories: ["/downloads/second-site-binding"],
  tags: [],
};
assert(
  resolveSiteDownloadTarget(multipleSiteBindingsMetadata, siteId).reason === "multiple-site-bindings",
  "multiple site bindings without an explicit site default require selection",
);
multipleSiteBindingsMetadata.siteDownloadProfiles[siteId].defaultDownloaderId = "transmission-global";
const explicitMultipleBindingTarget = resolveSiteDownloadTarget(multipleSiteBindingsMetadata, siteId);
assert(
  explicitMultipleBindingTarget.downloaderId === "transmission-global" &&
    explicitMultipleBindingTarget.savePath === "/downloads/second-site-binding" &&
    explicitMultipleBindingTarget.reason === "site-explicit-default" &&
    !explicitMultipleBindingTarget.requiresSelection,
  "an explicit site default resolves otherwise ambiguous site bindings",
);

const unavailableSiteBindingMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
unavailableSiteBindingMetadata.downloaders["qb-fixture"].enabled = false;
assert(
  resolveSiteDownloadTarget(unavailableSiteBindingMetadata, siteId).reason === "bound-downloader-unavailable",
  "an unavailable configured site binding never silently falls back to the global root",
);

const partiallyUnavailableBindingsMetadata = JSON.parse(JSON.stringify(multipleSiteBindingsMetadata));
delete partiallyUnavailableBindingsMetadata.siteDownloadProfiles[siteId].defaultDownloaderId;
partiallyUnavailableBindingsMetadata.downloaders["qb-fixture"].enabled = false;
assert(
  resolveSiteDownloadTarget(partiallyUnavailableBindingsMetadata, siteId).reason === "multiple-site-bindings",
  "one usable binding cannot silently win while another configured binding is unavailable",
);

const unavailableExplicitBindingMetadata = JSON.parse(JSON.stringify(multipleSiteBindingsMetadata));
unavailableExplicitBindingMetadata.siteDownloadProfiles[siteId].defaultDownloaderId = "qb-fixture";
unavailableExplicitBindingMetadata.downloaders["qb-fixture"].enabled = false;
assert(
  resolveSiteDownloadTarget(unavailableExplicitBindingMetadata, siteId).reason === "bound-downloader-unavailable",
  "an unavailable explicit site default cannot fall through to another valid site binding",
);

const excludedSiteBindingMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
excludedSiteBindingMetadata.downloaders["qb-fixture"].excludedSites = [siteId];
assert(
  resolveSiteDownloadTarget(excludedSiteBindingMetadata, siteId).reason === "bound-downloader-unavailable",
  "a downloader excluded for the site is not a valid automatic site binding",
);

const tagOnlySiteProfileMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
tagOnlySiteProfileMetadata.siteDownloadProfiles[siteId].byDownloader = {
  "qb-fixture": { directories: [], tags: ["tag-only"] },
};
tagOnlySiteProfileMetadata.siteDownloadProfiles[siteId].defaultDownloaderId = "qb-fixture";
assert(
  resolveSiteDownloadTarget(tagOnlySiteProfileMetadata, siteId).source === "global-default" &&
    resolveSiteDownloadTarget(tagOnlySiteProfileMetadata, siteId).downloaderId === "transmission-global",
  "a tag or downloader preference without a site directory does not override the global downloader",
);
assert(
  !hasConfiguredSiteDownloadTarget({ directories: [], tags: [], autoStart: true }) &&
    hasConfiguredSiteDownloadTarget({ directories: ["/fixture/visible"], tags: [], autoStart: true }) &&
    hasConfiguredSiteDownloadTarget({ directories: [], tags: ["visible-tag"], autoStart: false }),
  "auto-start alone does not create an empty download-path row, while real directories or tags remain visible",
);
const normalizedSiteTarget = normalizeSiteDownloadTarget({
  directories: [" /fixture/visible ", "", "/fixture/visible"],
  tags: [" visible-tag ", ""],
  defaultDirectory: " /fixture/default ",
  defaultTag: " visible-tag ",
  autoStart: false,
});
assert(
  normalizedSiteTarget.directories.join("|") === "/fixture/default|/fixture/visible" &&
    normalizedSiteTarget.tags.join("|") === "visible-tag" &&
    normalizedSiteTarget.defaultDirectory === "/fixture/default" &&
    normalizedSiteTarget.defaultTag === "visible-tag" &&
    normalizedSiteTarget.autoStart === false &&
    hasSiteDownloadDirectoryBinding(normalizedSiteTarget) &&
    !hasSiteDownloadDirectoryBinding({ directories: [], tags: ["tag-only"], autoStart: false }),
  "site targets are normalized while tags and auto-start alone never become directory bindings",
);

const multipleTagSuggestionsMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
multipleTagSuggestionsMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].tags = ["movies", "archive"];
delete multipleTagSuggestionsMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].defaultTag;
const multipleTagSuggestionsTarget = resolveSiteDownloadTarget(multipleTagSuggestionsMetadata, siteId);
assert(
  multipleTagSuggestionsTarget.downloaderId === "qb-fixture" &&
    multipleTagSuggestionsTarget.savePath === "/fixture/site-a" &&
    multipleTagSuggestionsTarget.label === "" &&
    !multipleTagSuggestionsTarget.requiresSelection,
  "multiple optional tag suggestions do not block an otherwise unambiguous site directory binding",
);
const multipleTagMenuTargets = buildSiteDownloadMenuTargets(multipleTagSuggestionsMetadata, siteId).filter(
  (target) => target.kind === "site" && target.downloaderId === "qb-fixture" && target.savePath === "/fixture/site-a",
);
assert(
  multipleTagMenuTargets.map((target) => target.label).join("|") === "|movies|archive",
  "the manual site menu keeps the automatic no-tag tuple first and exposes every optional tag",
);

const singleTagMenuMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
singleTagMenuMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].tags = ["single-tag"];
delete singleTagMenuMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].defaultTag;
const singleTagMenuTargets = buildSiteDownloadMenuTargets(singleTagMenuMetadata, siteId).filter(
  (target) => target.kind === "site" && target.downloaderId === "qb-fixture" && target.savePath === "/fixture/site-a",
);
assert(
  singleTagMenuTargets.map((target) => target.label).join("|") === "single-tag|",
  "the manual site menu presents the one-click single tag first and retains an explicit no-tag override",
);

const generalTagMenuMetadata = JSON.parse(JSON.stringify(siteBindingBeatsGlobalMetadata));
generalTagMenuMetadata.downloaders["transmission-global"].suggestTags = ["general-tag"];
const generalTagMenuTargets = buildSiteDownloadMenuTargets(generalTagMenuMetadata, siteId);
assert(
  generalTagMenuTargets.some(
    (target) =>
      target.kind === "general" &&
      target.downloaderId === "transmission-global" &&
      target.savePath === "" &&
      target.label === "general-tag",
  ),
  "the manual menu exposes downloader-level candidate tags without changing the automatic target",
);

const excludedGlobalDownloaderMetadata = JSON.parse(JSON.stringify(noSiteBindingMetadata));
excludedGlobalDownloaderMetadata.downloaders["transmission-global"].excludedSites = [siteId];
assert(
  resolveSiteDownloadTarget(excludedGlobalDownloaderMetadata, siteId).reason === "global-downloader-unavailable",
  "an excluded global downloader requires manual selection instead of a silent push",
);

const repeatedRuntimeMerge = mergePtppStateIntoRuntimeStores(
  state,
  {
    metadata: runtimeMerge.metadata,
    userInfo: runtimeMerge.userInfo,
    searchResultSnapshot: runtimeMerge.searchResultSnapshot,
    keepUploadTask: runtimeMerge.keepUploadTask,
    downloadHistory: runtimeMerge.downloadHistoryAdditions,
  },
  [siteId],
  ["qBittorrent", "Transmission"],
  3000,
);
assert(!repeatedRuntimeMerge.changed, "runtime merge is idempotent for the same source revision");
assert(repeatedRuntimeMerge.downloadHistoryAdditions.length === 0, "idempotent merge does not duplicate history");

const updatedState = JSON.parse(JSON.stringify(state));
updatedState.metadata.storageRevision = "fixture-revision-2";
const userConfiguredMetadata = JSON.parse(JSON.stringify(runtimeMerge.metadata));
userConfiguredMetadata.sites[siteId].merge.name = "User configured site";
userConfiguredMetadata.downloaders["qb-fixture"].address = "https://user-configured.example.invalid";
userConfiguredMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].defaultDirectory = "/user-configured";
userConfiguredMetadata.lastUserInfo[siteId].name = "User configured latest";
const userConfiguredUserInfo = JSON.parse(JSON.stringify(runtimeMerge.userInfo));
userConfiguredUserInfo[siteId]["2026-01-01"].uploaded = 999;
const userConfiguredSnapshots = JSON.parse(JSON.stringify(runtimeMerge.searchResultSnapshot));
userConfiguredSnapshots["snapshot-fixture"].searchKey = "User configured search";
const userConfiguredKeepUploadTasks = JSON.parse(JSON.stringify(runtimeMerge.keepUploadTask));
userConfiguredKeepUploadTasks["task-fixture"].title = "User configured task";
const updatedRuntimeMerge = mergePtppStateIntoRuntimeStores(
  updatedState,
  {
    metadata: userConfiguredMetadata,
    userInfo: userConfiguredUserInfo,
    searchResultSnapshot: userConfiguredSnapshots,
    keepUploadTask: userConfiguredKeepUploadTasks,
    downloadHistory: runtimeMerge.downloadHistoryAdditions,
  },
  [siteId],
  ["qBittorrent", "Transmission"],
  4000,
);
assert(updatedRuntimeMerge.changed, "a new source revision is merged");
assert(
  updatedRuntimeMerge.metadata.sites[siteId].merge.name === "User configured site" &&
    updatedRuntimeMerge.metadata.downloaders["qb-fixture"].address === "https://user-configured.example.invalid" &&
    updatedRuntimeMerge.metadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].defaultDirectory ===
      "/user-configured" &&
    updatedRuntimeMerge.metadata.lastUserInfo[siteId].name === "User configured latest" &&
    updatedRuntimeMerge.userInfo[siteId]["2026-01-01"].uploaded === 999 &&
    updatedRuntimeMerge.searchResultSnapshot["snapshot-fixture"].searchKey === "User configured search" &&
    updatedRuntimeMerge.keepUploadTask["task-fixture"].title === "User configured task" &&
    updatedRuntimeMerge.downloadHistoryAdditions.length === 0,
  "a later PTPP revision does not overwrite or duplicate user-configured PTD runtime data",
);

const preflightedSideEffects: number[] = [];
const failedBatchPreflight = await executePreflightedBatch(
  [1, 2, 3],
  async (value) => {
    if (value === 2) throw new Error("fixture preflight failure");
    return value * 10;
  },
  async (value) => {
    preflightedSideEffects.push(value);
    return value;
  },
);
assert(
  !failedBatchPreflight.preflight.ok &&
    failedBatchPreflight.preflight.failures.length === 1 &&
    failedBatchPreflight.preflight.failures[0].index === 1 &&
    failedBatchPreflight.results.length === 0 &&
    preflightedSideEffects.length === 0,
  "a failed batch preflight prevents every downstream side effect",
);

const successfulBatchPreflight = await executePreflightedBatch(
  [1, 2, 3],
  async (value) => value * 10,
  async (value) => value + 1,
);
assert(
  successfulBatchPreflight.preflight.ok && successfulBatchPreflight.results.join(",") === "11,21,31",
  "a successful full preflight executes every prepared assignment in order",
);

console.log("PTPP migration bridge and site download target resolution tests passed.");
