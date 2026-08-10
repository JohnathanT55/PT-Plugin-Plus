import { migrateLegacyStorage } from "../../src/migration/legacy";
import { LEGACY_STORAGE_KEYS } from "../../src/storage/keys";
import { mergePtppStateIntoRuntimeMetadata } from "../../app/src/entries/integration/ptppMigration";
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
  },
  1000,
);
const state = migrated.state;
state.metadata.storageRevision = "fixture-revision";
const siteId = state.hostToSiteId["tracker.example.invalid"];
assert(siteId, "legacy host receives a stable siteId");

const runtimeMerge = mergePtppStateIntoRuntimeMetadata(
  state,
  undefined,
  [siteId],
  ["qBittorrent", "Transmission"],
  2000,
);
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

const ambiguousRuntimeMetadata = JSON.parse(JSON.stringify(runtimeMerge.metadata));
delete ambiguousRuntimeMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].defaultDirectory;
assert(
  resolveSiteDownloadTarget(ambiguousRuntimeMetadata, siteId).requiresSelection,
  "multiple site directories without an explicit default require selection",
);

const repeatedRuntimeMerge = mergePtppStateIntoRuntimeMetadata(
  state,
  runtimeMerge.metadata,
  [siteId],
  ["qBittorrent", "Transmission"],
  3000,
);
assert(!repeatedRuntimeMerge.changed, "runtime merge is idempotent for the same source revision");

const updatedState = JSON.parse(JSON.stringify(state));
updatedState.metadata.storageRevision = "fixture-revision-2";
const userConfiguredMetadata = JSON.parse(JSON.stringify(runtimeMerge.metadata));
userConfiguredMetadata.sites[siteId].merge.name = "User configured site";
userConfiguredMetadata.downloaders["qb-fixture"].address = "https://user-configured.example.invalid";
userConfiguredMetadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].defaultDirectory = "/user-configured";
const updatedRuntimeMerge = mergePtppStateIntoRuntimeMetadata(
  updatedState,
  userConfiguredMetadata,
  [siteId],
  ["qBittorrent", "Transmission"],
  4000,
);
assert(updatedRuntimeMerge.changed, "a new source revision is merged");
assert(
  updatedRuntimeMerge.metadata.sites[siteId].merge.name === "User configured site" &&
    updatedRuntimeMerge.metadata.downloaders["qb-fixture"].address === "https://user-configured.example.invalid" &&
    updatedRuntimeMerge.metadata.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].defaultDirectory ===
      "/user-configured",
  "a later PTPP revision does not overwrite user-configured PTD metadata",
);

console.log("PTPP migration bridge and site download target resolution tests passed.");
