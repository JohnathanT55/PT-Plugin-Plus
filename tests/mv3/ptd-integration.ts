import { migrateLegacyStorage } from "../../src/migration/legacy";
import { LEGACY_STORAGE_KEYS } from "../../src/storage/keys";
import {
  mergePtppStateIntoRuntimeStores,
  persistPtppRuntimeMigration,
} from "../../app/src/entries/integration/ptppMigration";
import { resolveSiteDownloadTarget } from "../../app/src/entries/shared/downloadTarget";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PTD integration test failed: ${message}`);
}

const migrated = migrateLegacyStorage(
  {
    [LEGACY_STORAGE_KEYS.config]: {
      defaultClientId: "qb-fixture",
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

console.log("PTPP migration bridge and site download target resolution tests passed.");
