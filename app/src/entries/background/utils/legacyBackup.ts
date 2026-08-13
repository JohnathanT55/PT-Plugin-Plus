import { extendCookieExpiration } from "@foundation/backup/restore";
import { migrateLegacyStorage } from "@foundation/migration/legacy";
import { LEGACY_STORAGE_KEYS } from "@foundation/storage/keys";
import { MV3Repository } from "@foundation/storage/repository";

import {
  mergePtppStateIntoRuntimeConfig,
  mergePtppStateIntoRuntimeStores,
  persistPtppRuntimeMigration,
} from "@/integration/ptppMigration.ts";
import { onMessage } from "@/messages.ts";
import { getPtdIndexDb } from "@/shared/indexdb.ts";
import type {
  IConfigPiniaStorageSchema,
  IMetadataPiniaStorageSchema,
  IPtppLegacyBackupImportPayload,
  IPtppLegacyBackupImportResult,
  TKeepUploadTaskStorageSchema,
  TSearchResultSnapshotStorageSchema,
  TUserInfoStorageSchema,
} from "@/shared/types.ts";

function selectLegacyImportData(data: IPtppLegacyBackupImportPayload): Record<string, unknown> {
  const selected = new Set(data.fields);
  const source = data.legacy;
  const result: Record<string, unknown> = {};

  // options.json is also needed to map legacy hosts to stable PTD site IDs.
  if (source[LEGACY_STORAGE_KEYS.config]) result[LEGACY_STORAGE_KEYS.config] = source[LEGACY_STORAGE_KEYS.config];
  if (selected.has("userInfo") && source[LEGACY_STORAGE_KEYS.userHistory]) {
    result[LEGACY_STORAGE_KEYS.userHistory] = source[LEGACY_STORAGE_KEYS.userHistory];
  }
  if (selected.has("collection") && source[LEGACY_STORAGE_KEYS.collections]) {
    result[LEGACY_STORAGE_KEYS.collections] = source[LEGACY_STORAGE_KEYS.collections];
  }
  if (selected.has("searchResultSnapshot") && source[LEGACY_STORAGE_KEYS.searchSnapshots]) {
    result[LEGACY_STORAGE_KEYS.searchSnapshots] = source[LEGACY_STORAGE_KEYS.searchSnapshots];
  }
  if (selected.has("keepUploadTask") && source[LEGACY_STORAGE_KEYS.keepUploadTasks]) {
    result[LEGACY_STORAGE_KEYS.keepUploadTasks] = source[LEGACY_STORAGE_KEYS.keepUploadTasks];
  }
  if (selected.has("downloadHistory") && source[LEGACY_STORAGE_KEYS.downloadHistory]) {
    result[LEGACY_STORAGE_KEYS.downloadHistory] = source[LEGACY_STORAGE_KEYS.downloadHistory];
  }
  return result;
}

async function restorePtppCookies(
  data: IPtppLegacyBackupImportPayload,
): Promise<{ restoredCookies: number; failedCookies: number }> {
  if (!data.fields.includes("cookies")) return { restoredCookies: 0, failedCookies: 0 };
  const allowedKeys = ["name", "value", "domain", "path", "secure", "httpOnly", "expirationDate"] as const;
  const now = Date.now() / 1000;
  const jobs: Promise<unknown>[] = [];

  for (const group of data.cookies) {
    for (const sourceCookie of group.cookies) {
      const cookie = { url: group.url } as chrome.cookies.SetDetails;
      for (const key of allowedKeys) {
        // Chrome identifies a host-only cookie by the absence of `domain` in
        // SetDetails. Copying the serialized domain would turn it into a
        // domain cookie and overwrite a same-name cookie that legitimately
        // coexists in old PTPP backups.
        if (key === "domain" && sourceCookie.hostOnly === true) continue;
        if (typeof sourceCookie[key] !== "undefined") {
          (cookie as unknown as Record<string, unknown>)[key] = sourceCookie[key];
        }
      }
      if (!cookie.name || typeof cookie.value !== "string") continue;
      cookie.expirationDate = extendCookieExpiration(cookie.expirationDate, data.expandCookieMinutes ?? 0, now);
      jobs.push(chrome.cookies.set(cookie));
    }
  }

  const results = await Promise.allSettled(jobs);
  const restoredCookies = results.filter((result) => result.status === "fulfilled").length;
  return { restoredCookies, failedCookies: results.length - restoredCookies };
}

export async function importPtppLegacyBackup(
  data: IPtppLegacyBackupImportPayload,
): Promise<IPtppLegacyBackupImportResult> {
  const now = Date.now();
  const migrated = migrateLegacyStorage(selectLegacyImportData(data), now);

  const repository = new MV3Repository();
  const compatibilityState = structuredClone(await repository.reload());
  const selected = new Set(data.fields);
  if (selected.has("metadata")) {
    compatibilityState.settings = migrated.state.settings;
    compatibilityState.sites = migrated.state.sites;
    compatibilityState.hostToSiteId = migrated.state.hostToSiteId;
    compatibilityState.downloaders = migrated.state.downloaders;
    compatibilityState.siteDownloadProfiles = migrated.state.siteDownloadProfiles;
    compatibilityState.backupServers = migrated.state.backupServers;
  }
  if (selected.has("userInfo")) compatibilityState.userHistory = migrated.state.userHistory;
  if (selected.has("downloadHistory")) compatibilityState.downloadHistory = migrated.state.downloadHistory;
  if (selected.has("collection")) compatibilityState.collections = migrated.state.collections;
  if (selected.has("searchResultSnapshot")) compatibilityState.searchSnapshots = migrated.state.searchSnapshots;
  if (selected.has("keepUploadTask")) compatibilityState.keepUploadTasks = migrated.state.keepUploadTasks;
  compatibilityState.metadata.warnings = migrated.state.metadata.warnings;
  compatibilityState.metadata.migratedCounts = migrated.migratedCounts;
  await repository.writeState(compatibilityState);

  const runtimeState = JSON.parse(JSON.stringify(migrated.state)) as typeof migrated.state;
  runtimeState.metadata.storageRevision = data.sourceRevision;
  if (!data.fields.includes("metadata")) {
    runtimeState.sites = {};
    runtimeState.downloaders = {};
    runtimeState.siteDownloadProfiles = {};
    runtimeState.backupServers = {};
  }

  const current = await chrome.storage.local.get([
    "config",
    "metadata",
    "userInfo",
    "searchResultSnapshot",
    "keepUploadTask",
  ]);
  const database = await getPtdIndexDb();
  const currentHistory = await database.getAll("download_history");
  const runtimeMetadata = structuredClone(current.metadata as IMetadataPiniaStorageSchema | undefined);
  if (selected.has("userInfo") && data.keepExistUserInfo === false && runtimeMetadata?.lastUserInfo) {
    runtimeMetadata.lastUserInfo = {};
  }
  const result = mergePtppStateIntoRuntimeStores(runtimeState, {
    metadata: runtimeMetadata,
    userInfo: data.keepExistUserInfo === false ? {} : (current.userInfo as TUserInfoStorageSchema | undefined),
    searchResultSnapshot: current.searchResultSnapshot as TSearchResultSnapshotStorageSchema | undefined,
    keepUploadTask: current.keepUploadTask as TKeepUploadTaskStorageSchema | undefined,
    downloadHistory: currentHistory,
  });
  await persistPtppRuntimeMigration(result, {
    setStorage: async (values) => await chrome.storage.local.set(values),
    addDownloadHistory: async (items) => {
      if (items.length === 0) return;
      const transaction = database.transaction("download_history", "readwrite");
      for (const item of items) await transaction.store.add(item);
      await transaction.done;
    },
  });

  if (data.fields.includes("config")) {
    const configMerge = mergePtppStateIntoRuntimeConfig(
      migrated.state,
      current.config as Partial<IConfigPiniaStorageSchema> | undefined,
      true,
    );
    if (configMerge.changed) await chrome.storage.local.set({ config: configMerge.config });
  }

  const cookieResult = await restorePtppCookies(data);
  return {
    importedCounts: { ...migrated.migratedCounts, ...result.report.importedCounts },
    warningCount: result.report.warningCount,
    skippedSiteIds: result.report.skippedSiteIds,
    skippedDownloaderIds: result.report.skippedDownloaderIds,
    ...cookieResult,
  };
}

onMessage("importPtppLegacyBackup", async ({ data }) => await importPtppLegacyBackup(data));
