import { MV3Repository } from "@foundation/storage/repository";
import type {
  BackupServerRecord,
  DownloadTarget,
  DownloaderRecord,
  MV3State,
  SiteRecord,
} from "@foundation/model/schema";

import type {
  IBackupServerMetadata,
  IDownloaderMetadata,
  IMetadataPiniaStorageSchema,
  IPtppMigrationMetadata,
  ISiteDownloadProfile,
  ISiteDownloadTarget,
} from "@/shared/types.ts";

export interface PtppRuntimeMergeResult {
  metadata: IMetadataPiniaStorageSchema;
  report: IPtppMigrationMetadata;
  changed: boolean;
}

export const SUPPORTED_PTD_SITE_IDS = [
  "audiences",
  "azusa",
  "hdkylin",
  "hdsky",
  "hdtime",
  "kamept",
  "mteam",
  "pttime",
  "skyeysnow",
  "u2",
];

export const SUPPORTED_PTD_DOWNLOADER_TYPES = [
  "qBittorrent",
  "Transmission",
  "Deluge",
  "Flood",
  "Aria2",
  "ruTorrent",
  "uTorrent",
  "synologyDownloadStation",
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function unique(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function createEmptyMetadata(): IMetadataPiniaStorageSchema {
  return {
    sites: {},
    solutions: {},
    snapshots: {},
    downloaders: {},
    mediaServers: {},
    backupServers: {},
    defaultSolutionId: "default",
    defaultDownloader: {},
    siteDownloadProfiles: {},
    lastSearchFilter: "",
    lastUserInfo: {},
    lastDownloader: {},
    lastKeepUpload: {},
    lastUserInfoAutoFlushAt: 0,
    siteHostMap: {},
    siteNameMap: {},
  };
}

function normalizedDownloaderType(type: string, supportedTypes: string[]): string | undefined {
  const aliases: Record<string, string> = {
    qbittorrent: "qBittorrent",
    transmission: "Transmission",
    deluge: "Deluge",
    flood: "Flood",
    aria2: "Aria2",
    rutorrent: "ruTorrent",
    utorrent: "uTorrent",
    synologydownloadstation: "synologyDownloadStation",
  };
  const key = type.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const preferred = aliases[key];
  return (
    supportedTypes.find((candidate) => candidate === preferred) ??
    supportedTypes.find((candidate) => candidate.replace(/[^a-z0-9]/gi, "").toLowerCase() === key)
  );
}

function targetToRuntime(target: DownloadTarget): ISiteDownloadTarget {
  const directories = unique(target.directories ?? []);
  const tags = unique(target.tags ?? []);
  return {
    directories,
    tags,
    defaultDirectory:
      target.defaultDirectory && directories.includes(target.defaultDirectory)
        ? target.defaultDirectory
        : directories[0],
    defaultTag: tags[0],
    autoStart: target.autoStart,
  };
}

function siteToRuntime(site: SiteRecord): Record<string, any> {
  const legacy = site.legacyConfig ?? {};
  const rawUrl = legacy.activeURL || legacy.url;
  const url =
    typeof rawUrl === "string" && rawUrl ? rawUrl : site.activeHost ? `https://${site.activeHost}/` : undefined;
  return {
    inputSetting: {},
    ...(url ? { url } : {}),
    merge: { name: site.name },
    groups: Array.isArray(legacy.tags) ? unique(legacy.tags) : [],
    sortIndex: typeof legacy.priority === "number" ? legacy.priority : 100,
    isOffline: legacy.offline === true || !site.enabled,
    allowSearch: legacy.allowSearch !== false,
    allowQueryUserInfo: true,
    showMessageCount: legacy.disableMessageCount !== true,
  };
}

function downloaderToRuntime(downloader: DownloaderRecord, supportedTypes: string[]): IDownloaderMetadata | undefined {
  const type = normalizedDownloaderType(downloader.type, supportedTypes);
  if (!type) return undefined;
  const legacy = downloader.legacyConfig ?? {};
  return {
    id: downloader.downloaderId,
    type,
    name: downloader.name,
    address: downloader.address ?? "",
    username: downloader.username ?? "",
    password: downloader.password ?? "",
    timeout: typeof legacy.timeout === "number" ? legacy.timeout : 30_000,
    enabled: downloader.enabled,
    suggestFolders: unique(downloader.defaultTarget.directories ?? []),
    suggestTags: unique(downloader.defaultTarget.tags ?? []),
    feature: { DefaultAutoStart: downloader.defaultTarget.autoStart ?? true },
    advanceAddTorrentOptions: {},
    sortIndex: typeof legacy.sortIndex === "number" ? legacy.sortIndex : 100,
  };
}

function backupServerToRuntime(server: BackupServerRecord): IBackupServerMetadata | undefined {
  if (server.type.toLowerCase() !== "webdav") return undefined;
  return {
    id: server.backupServerId,
    type: "WebDAV",
    name: server.name,
    enabled: true,
    backupFields: [
      "cookies",
      "config",
      "metadata",
      "userInfo",
      "searchResultSnapshot",
      "keepUploadTask",
      "downloadHistory",
    ],
    lastBackupAt: server.lastBackupTime,
    config: {
      address: server.address,
      loginName: server.username ?? "",
      loginPwd: server.password ?? "",
      digest: server.digest ?? false,
    },
  };
}

function mergeProfile(migrated: ISiteDownloadProfile, current?: ISiteDownloadProfile): ISiteDownloadProfile {
  if (!current) return migrated;
  return {
    siteId: migrated.siteId,
    defaultDownloaderId: current.defaultDownloaderId || migrated.defaultDownloaderId,
    byDownloader: { ...migrated.byDownloader, ...current.byDownloader },
  };
}

export function mergePtppStateIntoRuntimeMetadata(
  state: MV3State,
  existingMetadata: Partial<IMetadataPiniaStorageSchema> | undefined,
  supportedSiteIds: string[] = SUPPORTED_PTD_SITE_IDS,
  supportedDownloaderTypes: string[] = SUPPORTED_PTD_DOWNLOADER_TYPES,
  now: number = Date.now(),
): PtppRuntimeMergeResult {
  const metadata = Object.assign(createEmptyMetadata(), clone(existingMetadata ?? {}));
  metadata.siteDownloadProfiles ??= {};
  const sourceRevision = state.metadata.storageRevision;

  const existingMarker = metadata.ptppMigration;
  if (existingMarker && existingMarker.sourceRevision === sourceRevision) {
    return { metadata, report: existingMarker, changed: false };
  }

  const skippedSiteIds: string[] = [];
  const skippedDownloaderIds: string[] = [];
  let importedSites = 0;
  let importedDownloaders = 0;
  let importedBackupServers = 0;

  for (const [siteId, site] of Object.entries(state.sites)) {
    if (!supportedSiteIds.includes(siteId)) {
      skippedSiteIds.push(siteId);
      continue;
    }
    if (!metadata.sites[siteId]) {
      metadata.sites[siteId] = siteToRuntime(site);
      importedSites++;
    }
    for (const host of site.hosts) {
      metadata.siteHostMap[host] ??= siteId;
    }
    metadata.siteNameMap[siteId] ??= site.name;
  }

  for (const [downloaderId, downloader] of Object.entries(state.downloaders)) {
    if (metadata.downloaders[downloaderId]) continue;
    const runtimeDownloader = downloaderToRuntime(downloader, supportedDownloaderTypes);
    if (!runtimeDownloader) {
      skippedDownloaderIds.push(downloaderId);
      continue;
    }
    metadata.downloaders[downloaderId] = runtimeDownloader;
    importedDownloaders++;
  }

  for (const [siteId, profile] of Object.entries(state.siteDownloadProfiles)) {
    const migratedProfile: ISiteDownloadProfile = {
      siteId,
      defaultDownloaderId: profile.defaultDownloaderId,
      byDownloader: Object.fromEntries(
        Object.entries(profile.byDownloader).map(([downloaderId, target]) => [downloaderId, targetToRuntime(target)]),
      ),
    };
    metadata.siteDownloadProfiles[siteId] = mergeProfile(migratedProfile, metadata.siteDownloadProfiles[siteId]);
  }

  for (const [serverId, server] of Object.entries(state.backupServers)) {
    if (metadata.backupServers[serverId]) continue;
    const runtimeServer = backupServerToRuntime(server);
    if (runtimeServer) {
      metadata.backupServers[serverId] = runtimeServer;
      importedBackupServers++;
    }
  }

  if (!metadata.defaultDownloader?.id && state.settings.defaultDownloaderId) {
    const downloader = metadata.downloaders[state.settings.defaultDownloaderId];
    const sourceDownloader = state.downloaders[state.settings.defaultDownloaderId];
    if (downloader && sourceDownloader) {
      metadata.defaultDownloader = {
        id: state.settings.defaultDownloaderId,
        folder: sourceDownloader.defaultTarget.defaultDirectory ?? sourceDownloader.defaultTarget.directories[0] ?? "",
        tags: sourceDownloader.defaultTarget.tags[0] ?? "",
      };
    }
  }

  const report: IPtppMigrationMetadata = {
    schemaVersion: state.metadata.schemaVersion,
    sourceRevision,
    migratedAt: now,
    warningCount: state.metadata.warnings.length,
    importedCounts: {
      sites: importedSites,
      downloaders: importedDownloaders,
      siteDownloadProfiles: Object.keys(state.siteDownloadProfiles).length,
      backupServers: importedBackupServers,
    },
    skippedSiteIds,
    skippedDownloaderIds,
  };
  metadata.ptppMigration = report;
  return { metadata, report, changed: true };
}

export async function initializePtppRuntimeMigration(): Promise<IPtppMigrationMetadata> {
  const repository = new MV3Repository();
  const state = await repository.initialize();
  const current = await chrome.storage.local.get("metadata");
  const result = mergePtppStateIntoRuntimeMetadata(
    state,
    current.metadata as Partial<IMetadataPiniaStorageSchema> | undefined,
  );
  if (result.changed) {
    await chrome.storage.local.set({ metadata: result.metadata });
  }
  return result.report;
}
