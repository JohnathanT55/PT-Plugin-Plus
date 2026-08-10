import { resolveDownloadTarget } from "../../src/model/downloadTarget";
import { migrateLegacyStorage } from "../../src/migration/legacy";
import { LEGACY_STORAGE_KEYS } from "../../src/storage/keys";
import { MV3_DATA_STORAGE_KEYS, MV3_STORAGE_KEYS, revisionedStorageKey } from "../../src/storage/keys";
import { ChromeStorageAdapter, StorageAreaLike } from "../../src/storage/adapter";
import { MV3Repository } from "../../src/storage/repository";
import { validateMV3State } from "../../src/model/validate";

function assert(condition: any, message: string) {
  if (!condition) {
    throw new Error("MV3 test failed: " + message);
  }
}

const legacy = {
  [LEGACY_STORAGE_KEYS.config]: {
    defaultClientId: "qb-fixture",
    autoRefreshUserData: true,
    autoRefreshUserDataHours: 6,
    sites: [
      {
        id: "fixture-site",
        name: "Fixture Tracker",
        host: "tracker.example.invalid",
        formerHosts: ["old-tracker.example.invalid"],
        defaultClientId: "qb-fixture",
        value: true,
        script: "fixture dynamic code that must never enter MV3 state",
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
          "old-tracker.example.invalid": ["/fixture/site-b", "/fixture/site-c"],
        },
      },
      {
        id: "tr-fixture",
        name: "Transmission Fixture",
        type: "transmission",
        address: "https://transmission.example.invalid",
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
      "2026-01-01": { uploaded: 100 },
      latest: { uploaded: 100 },
    },
    "old-tracker.example.invalid": {
      "2026-01-01": { uploaded: 50 },
      latest: { uploaded: 50 },
    },
  },
  [LEGACY_STORAGE_KEYS.downloadHistory]: [
    {
      host: "tracker.example.invalid",
      clientId: "qb-fixture",
      time: 1,
      success: true,
      data: { url: "https://tracker.example.invalid/download/1" },
    },
    {
      host: "tracker.example.invalid",
      clientId: "qb-fixture",
      time: 2,
      success: false,
      data: { url: "https://tracker.example.invalid/download/1" },
    },
  ],
  [LEGACY_STORAGE_KEYS.collections]: {
    groups: [{ id: "group-a", name: "Fixture Group", count: 99 }],
    items: [
      {
        host: "tracker.example.invalid",
        title: "Fixture Torrent",
        link: "https://tracker.example.invalid/details/1",
        groups: ["group-a"],
      },
    ],
  },
  [LEGACY_STORAGE_KEYS.searchSnapshots]: {
    items: [
      {
        id: "snapshot-a",
        key: "fixture",
        time: 1,
        result: [{ host: "tracker.example.invalid", title: "Result" }],
      },
    ],
  },
  [LEGACY_STORAGE_KEYS.keepUploadTasks]: [
    {
      id: "task-a",
      time: 1,
      title: "Fixture Task",
      downloadOptions: {
        clientId: "qb-fixture",
        savePath: "/fixture/keep-upload",
      },
      items: [{ host: "tracker.example.invalid" }],
    },
  ],
};

const first = migrateLegacyStorage(legacy, 1000);
const second = migrateLegacyStorage(legacy, 1000);
const state = first.state;
const siteId = state.hostToSiteId["tracker.example.invalid"];

assert(!!siteId, "canonical host receives a stable siteId");
assert(state.hostToSiteId["old-tracker.example.invalid"] === siteId, "former host maps to the same siteId");
assert(
  JSON.stringify(first) === JSON.stringify(second),
  "pure migration is deterministic for the same input and clock",
);
first.state.sites[siteId].legacyConfig.name = "Changed only in migrated state";
assert(
  (legacy as any)[LEGACY_STORAGE_KEYS.config].sites[0].name === "Fixture Tracker",
  "migration output does not share mutable objects with legacy input",
);
assert(
  validateMV3State(state).filter((item) => item.severity === "error").length === 0,
  "migrated state passes structural validation",
);
assert(
  validateMV3State({ metadata: { schemaVersion: 1 } } as any).some((item) => item.severity === "error"),
  "state validation reports damaged partitions without throwing",
);
assert(
  state.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].directories.join("|") ===
    "/fixture/site-a|/fixture/site-b|/fixture/site-c",
  "site/downloader folders are merged without losing order",
);
assert(
  Object.keys(state.userHistory[siteId]).some((key) => key.indexOf("__conflict__:") === 0),
  "former-host user history conflicts are preserved instead of overwritten",
);
assert(
  state.downloaders["qb-fixture"].defaultTarget.directories.length === 2,
  "per-downloader fallback folders are retained",
);
assert(
  state.downloaders["qb-fixture"].address === "https://downloader.example.invalid",
  "download server address is retained",
);
assert(
  !Object.prototype.hasOwnProperty.call(state.sites[siteId].legacyConfig, "script"),
  "legacy executable site fields remain only in untouched MV2 storage",
);
assert(state.backupServers["webdav-fixture"].type === "WebDAV", "WebDAV configuration is retained");
assert(
  JSON.stringify(state.metadata.warnings).indexOf("fixture-password") === -1 &&
    JSON.stringify(state.metadata.warnings).indexOf("downloader.example.invalid") === -1,
  "migration diagnostics never contain credentials or private endpoints",
);
assert(state.downloadHistory.length === 2, "download failures are not deduplicated");
assert(state.collections.groups[0].count === 1, "collection counts are recalculated");
assert(state.searchSnapshots[0].result![0].siteId === siteId, "search snapshot results receive siteId annotations");
assert(
  state.keepUploadTasks[0].downloadOptions!.downloaderId === "qb-fixture",
  "keep-upload task downloader mapping is retained",
);

const resolution = resolveDownloadTarget(
  siteId,
  undefined,
  state.siteDownloadProfiles,
  state.downloaders,
  state.settings,
);
assert(resolution.source === "site-profile", "site profile has first priority");
assert(
  resolution.target.defaultDirectory === "/fixture/site-a" && !resolution.requiresSelection,
  "legacy first folder remains the direct-push default while all folders are retained",
);

delete state.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].defaultDirectory;
const ambiguousResolution = resolveDownloadTarget(
  siteId,
  undefined,
  state.siteDownloadProfiles,
  state.downloaders,
  state.settings,
);
assert(
  ambiguousResolution.requiresSelection,
  "multiple folders without an explicit default require advanced selection",
);

state.siteDownloadProfiles[siteId].byDownloader["qb-fixture"].directories = ["/fixture/site-a"];
const directResolution = resolveDownloadTarget(
  siteId,
  undefined,
  state.siteDownloadProfiles,
  state.downloaders,
  state.settings,
);
assert(!directResolution.requiresSelection, "one folder permits direct push");

const noDownloaderSettings = Object.assign({}, state.settings, {
  defaultDownloaderId: undefined,
  globalDownloadTarget: { directories: ["/fixture/global-only"], tags: [] },
});
const incompleteResolution = resolveDownloadTarget(undefined, undefined, {}, state.downloaders, noDownloaderSettings);
assert(
  incompleteResolution.requiresSelection,
  "a folder alone is not direct-push safe without an unambiguous downloader",
);

const knownSite = migrateLegacyStorage(
  {
    [LEGACY_STORAGE_KEYS.config]: {
      sites: [{ name: "Audiences", host: "audiences.me" }],
    },
  },
  1000,
);
assert(
  knownSite.state.hostToSiteId["audiences.me"] === "audiences",
  "known sites use PT-depiler compatible siteId values",
);

const knownSiteAlias = migrateLegacyStorage(
  {
    [LEGACY_STORAGE_KEYS.config]: {
      sites: [
        {
          name: "HDKylin",
          host: "hdkyl.in",
          passkey: "fixture-passkey",
          defaultClientId: "qb-alias",
        },
        {
          name: "HDKylin Alias",
          host: "na.hdkylin.com",
          passkey: "fixture-alias-passkey",
          defaultClientId: "tr-alias",
        },
      ],
      clients: [
        {
          id: "qb-alias",
          name: "Alias qBittorrent",
          type: "qbittorrent",
          paths: { "na.hdkylin.com": ["/fixture/hdkylin"] },
        },
      ],
    },
  },
  1000,
);
assert(
  knownSiteAlias.state.sites.hdkylin.activeHost === "hdkyl.in" &&
    knownSiteAlias.state.sites.hdkylin.legacyConfig.passkey === "fixture-passkey",
  "an official host alias never overwrites the canonical site record",
);
assert(
  knownSiteAlias.state.sites.hdkylin.legacyAliasConfigs![0].passkey === "fixture-alias-passkey" &&
    knownSiteAlias.state.siteDownloadProfiles.hdkylin.defaultDownloaderId === "qb-alias",
  "conflicting sanitized alias configuration is retained without changing the primary default",
);
assert(
  knownSiteAlias.state.sites.hdkylin.hosts.indexOf("na.hdkylin.com") !== -1 &&
    knownSiteAlias.state.hostToSiteId["na.hdkylin.com"] === "hdkylin",
  "official host aliases are merged bidirectionally",
);
assert(
  validateMV3State(knownSiteAlias.state).filter((item) => item.severity === "error").length === 0,
  "known host alias migration satisfies state invariants",
);

const siteDefaultWithoutPath = migrateLegacyStorage(
  {
    [LEGACY_STORAGE_KEYS.config]: {
      defaultClientId: "qb-global",
      sites: [
        {
          name: "Audiences",
          host: "audiences.me",
          defaultClientId: "tr-site",
        },
      ],
      clients: [
        {
          id: "qb-global",
          name: "Global qBittorrent",
          type: "qbittorrent",
          paths: { __allSite__: ["/fixture/qb-global"] },
        },
        {
          id: "tr-site",
          name: "Site Transmission",
          type: "transmission",
          paths: { __allSite__: ["/fixture/tr-site"] },
        },
      ],
    },
  },
  1000,
).state;
const siteDefaultResolution = resolveDownloadTarget(
  "audiences",
  undefined,
  siteDefaultWithoutPath.siteDownloadProfiles,
  siteDefaultWithoutPath.downloaders,
  siteDefaultWithoutPath.settings,
);
assert(
  siteDefaultResolution.downloaderId === "tr-site" &&
    siteDefaultResolution.target.defaultDirectory === "/fixture/tr-site",
  "site default downloader applies even without a site-specific path",
);

[
  "h5.m-team.cc",
  "zp.m-team.io",
  "ob.m-team.cc",
  "xp.m-team.io",
  "pt.m-team.cc",
  "tp.m-team.cc",
  "xp.m-team.cc",
  "ap.m-team.cc",
  "next.m-team.cc",
].forEach((host) => {
  const migrated = migrateLegacyStorage(
    {
      [LEGACY_STORAGE_KEYS.config]: {
        sites: [{ name: "M-Team", host }],
      },
    },
    1000,
  );
  assert(migrated.state.hostToSiteId[host] === "mteam", `M-Team alias ${host} uses the PT-depiler siteId`);
});

class MemoryStorageArea implements StorageAreaLike {
  public values: { [key: string]: any };

  constructor(initial: { [key: string]: any }) {
    this.values = JSON.parse(JSON.stringify(initial));
  }

  public get(keys: string | string[] | null, callback: (items: { [key: string]: any }) => void) {
    if (keys === null) {
      callback(JSON.parse(JSON.stringify(this.values)));
      return;
    }
    const requested = Array.isArray(keys) ? keys : [keys];
    const result: { [key: string]: any } = {};
    requested.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(this.values, key)) {
        result[key] = JSON.parse(JSON.stringify(this.values[key]));
      }
    });
    callback(result);
  }

  public set(items: { [key: string]: any }, callback?: () => void) {
    Object.keys(items).forEach((key) => {
      this.values[key] = JSON.parse(JSON.stringify(items[key]));
    });
    if (callback) {
      callback();
    }
  }

  public remove(keys: string | string[], callback?: () => void) {
    (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete this.values[key]);
    if (callback) {
      callback();
    }
  }
}

async function verifyRepositoryMigration() {
  const memory = new MemoryStorageArea(legacy);
  const repository = new MV3Repository(new ChromeStorageAdapter(memory), () => 1000);
  const migratedState = await repository.initialize();
  assert(migratedState.metadata.schemaVersion === 1, "repository initializes the current schema");
  assert(!!memory.values[MV3_STORAGE_KEYS.metadata], "repository commits the migration marker");
  const revision = memory.values[MV3_STORAGE_KEYS.metadata].storageRevision;
  assert(
    MV3_DATA_STORAGE_KEYS.every((key) => !!memory.values[revisionedStorageKey(key, revision)]),
    "repository commits a complete immutable storage revision",
  );
  assert(!!memory.values[LEGACY_STORAGE_KEYS.config], "repository leaves legacy keys untouched");

  const reloaded = await new MV3Repository(new ChromeStorageAdapter(memory), () => 1001).initialize();
  assert(reloaded.metadata.storageRevision === revision, "repository reloads the exact committed revision");

  const incomplete = new MemoryStorageArea(memory.values);
  delete incomplete.values[revisionedStorageKey(MV3_STORAGE_KEYS.sites, revision)];
  let incompleteRejected = false;
  try {
    await new MV3Repository(new ChromeStorageAdapter(incomplete), () => 1002).initialize();
  } catch (error) {
    incompleteRejected = String(error).indexOf("partition") !== -1;
  }
  assert(incompleteRejected, "missing committed partitions fail closed instead of becoming empty data");

  const olderSchema = new MemoryStorageArea(memory.values);
  olderSchema.values[MV3_STORAGE_KEYS.metadata].schemaVersion = 0;
  olderSchema.values[MV3_STORAGE_KEYS.metadata].data.schemaVersion = 0;
  MV3_DATA_STORAGE_KEYS.forEach((key) => {
    olderSchema.values[revisionedStorageKey(key, revision)].schemaVersion = 0;
  });
  let olderSchemaRejected = false;
  try {
    await new MV3Repository(new ChromeStorageAdapter(olderSchema), () => 1003).initialize();
  } catch (error) {
    olderSchemaRejected = String(error).indexOf("No MV3 state migration registered") !== -1;
  }
  assert(
    olderSchemaRejected && olderSchema.values[MV3_STORAGE_KEYS.metadata].schemaVersion === 0,
    "unknown MV3 schema never falls back to and overwrites data from MV2",
  );

  const revisionTwoRepository = new MV3Repository(new ChromeStorageAdapter(memory), () => 2000);
  const revisionTwoState = await revisionTwoRepository.initialize();
  await revisionTwoRepository.writeState(revisionTwoState);
  const revisionTwo = memory.values[MV3_STORAGE_KEYS.metadata].storageRevision;
  await revisionTwoRepository.writeState(revisionTwoState);
  const revisionThree = memory.values[MV3_STORAGE_KEYS.metadata].storageRevision;
  assert(
    !memory.values[revisionedStorageKey(MV3_STORAGE_KEYS.sites, revision)] &&
      !!memory.values[revisionedStorageKey(MV3_STORAGE_KEYS.sites, revisionTwo)] &&
      !!memory.values[revisionedStorageKey(MV3_STORAGE_KEYS.sites, revisionThree)],
    "repository retains one rollback generation and cleans older generations",
  );
}

verifyRepositoryMigration().catch((error) => {
  throw error;
});
