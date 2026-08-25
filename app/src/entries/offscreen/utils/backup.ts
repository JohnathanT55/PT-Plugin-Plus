import { intersection } from "es-toolkit";
import { formatDate } from "date-fns";
import { getBackupServer, IBackupData } from "@ptd/backupServer";
import { backupDataToJSZipBlob } from "@ptd/backupServer/utils.ts";
import AbstractBackupServer from "@ptd/backupServer/AbstractBackupServer.ts";

import { onMessage, sendMessage } from "@/messages.ts";
import type { IExtensionStorageSchema, TExtensionStorageKey } from "@/storage.ts";
import type {
  IRestoreOptions,
  IMetadataPiniaStorageSchema,
  IBackupCleanupJournal,
  IBackupCleanupSummary,
  TBackupFields,
  TBackupServerKey,
  IConfigPiniaStorageSchema,
  TUserInfoStorageSchema,
  TSearchResultSnapshotStorageSchema,
  TKeepUploadTaskStorageSchema,
} from "@/shared/types.ts";

import { logger } from "./logger.ts";
import { ptdIndexDb } from "../adapter/indexdb.ts";
import {
  getEffectiveBackupEncryptionKey,
  normalizeBackupFields,
  prepareConfigForBackup,
} from "@foundation/backup/policy";
import { extendCookieExpiration, latestRecordsFromHistory, mergeRestoredRecords } from "@foundation/backup/restore";
import { BackupFields } from "@/shared/types.ts";
import { sanitizeDownloadErrorMessage } from "@/shared/downloadError.ts";
import {
  createBackupCleanupPreview,
  createBackupFilename,
  createBackupScopeFingerprint,
  createBackupVerificationKey,
  executeBackupCleanupItems,
  normalizeBackupRetentionPolicy,
  normalizeBackupVerificationKey,
  normalizeUuid,
  parseBackupFilename,
  sameRemoteFile,
  type IBackupCleanupPreview,
  type IBackupCleanupRequest,
  type IBackupCleanupResult,
  type IBackupExportResult,
  type IBackupIdentity,
  type IClassifiedBackupFile,
  type IRemoteBackupFile,
} from "@foundation/backup/retention";

export const storageKey = [
  "config",
  "metadata",
  "userInfo",
  "searchResultSnapshot",
  "keepUploadTask",
] as TExtensionStorageKey[];

function prepareMetadataForBackup(metadata: IMetadataPiniaStorageSchema): IMetadataPiniaStorageSchema {
  const prepared = structuredClone(metadata);
  for (const server of Object.values(prepared.backupServers ?? {})) {
    // These values authorize or describe local cleanup work. They are bound to
    // the current browser and remote inventory, so they must never enter a ZIP.
    delete server.backupVerificationKey;
    delete server.pendingCleanup;
    delete server.activeRestorePaths;
  }
  return prepared;
}

export async function createBackupData(backupFields: TBackupFields[] = []): Promise<IBackupData> {
  const metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;

  const backupData: IBackupData = {};

  // 备份已添加站点的Cookie
  if (backupFields.includes("cookies")) {
    const cookies = {} as Required<IBackupData>["cookies"];
    for (const siteHost in metadataStore.siteHostMap) {
      const siteHostCookies = await sendMessage("getAllCookies", { domain: siteHost });
      if (siteHostCookies.length > 0) {
        cookies[siteHost] = siteHostCookies;
      }
    }
    backupData.cookies = cookies;
  }

  // 处理直接从 chrome.storage.local 读取的字段
  for (const field of storageKey) {
    if (backupFields.includes(field as TBackupFields)) {
      const fieldData = await sendMessage("getExtStorage", field);
      backupData[field] =
        field === "config"
          ? prepareConfigForBackup(fieldData as IConfigPiniaStorageSchema)
          : field === "metadata"
            ? prepareMetadataForBackup(fieldData as IMetadataPiniaStorageSchema)
            : fieldData;
    }
  }

  // 备份下载历史
  if (backupFields.includes("downloadHistory")) {
    backupData["downloadHistory"] = await (await ptdIndexDb).getAll("download_history");
  }

  // 收藏使用版本化兼容仓库，由 service worker 负责读写。
  if (backupFields.includes("collection")) {
    backupData["collection"] = await sendMessage("getPtppCollectionState", undefined);
  }

  backupData.manifest = {
    time: new Date().getTime(),
    version: `PT-Plugin-Plus MV3 (${__EXT_VERSION__})`,
  };

  logger({
    msg: `A Backup data created at ${formatDate(backupData.manifest.time!, "yyyy-MM-dd HH:mm:ss")}`,
    data: Object.keys(backupData),
  });
  return backupData;
}

export async function getBackupServerInstance(backupServerId: TBackupServerKey): Promise<AbstractBackupServer<any>> {
  logger({ msg: `Get backup server instance for ID: ${backupServerId}` });
  const metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  const backupServerConfig = metadataStore.backupServers[backupServerId];
  return await getBackupServer(backupServerConfig);
}

async function patchBackupServer(
  backupServerId: string,
  patch: (server: IMetadataPiniaStorageSchema["backupServers"][string]) => void,
): Promise<IMetadataPiniaStorageSchema["backupServers"][string]> {
  const metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  const server = metadataStore.backupServers[backupServerId];
  if (!server) throw new Error("Backup server no longer exists.");
  patch(server);
  await sendMessage("setExtStorage", { key: "metadata", value: metadataStore });
  return server;
}

async function getNormalizedBackupServer(backupServerId: string) {
  let metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  let server = metadataStore.backupServers[backupServerId];
  if (!server) throw new Error("Backup server no longer exists.");
  const namespaceValid = normalizeUuid(server.backupNamespaceId ?? "");
  const verificationKeyValid = normalizeBackupVerificationKey(server.backupVerificationKey ?? "");
  const retentionPolicy = normalizeBackupRetentionPolicy(server.retentionPolicy);
  if (
    !namespaceValid ||
    !verificationKeyValid ||
    JSON.stringify(retentionPolicy) !== JSON.stringify(server.retentionPolicy)
  ) {
    server = await patchBackupServer(backupServerId, (current) => {
      if (!normalizeUuid(current.backupNamespaceId ?? "")) current.backupNamespaceId = crypto.randomUUID();
      if (!normalizeBackupVerificationKey(current.backupVerificationKey ?? "")) {
        current.backupVerificationKey = createBackupVerificationKey();
      }
      current.retentionPolicy = normalizeBackupRetentionPolicy(current.retentionPolicy);
    });
    metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  }
  return { metadataStore, server };
}

function isFullBackup(fields: readonly TBackupFields[]): boolean {
  return BackupFields.length === new Set(fields).size && BackupFields.every((field) => fields.includes(field));
}

export async function exportBackupData(
  backupServerId: string | "local",
  backupFields: TBackupFields[] = [],
  trigger: "manual" | "interval" | "userDataRefresh" = "manual",
): Promise<IBackupExportResult> {
  const createdAt = Date.now();
  const backupId = crypto.randomUUID();
  const normalizedServer =
    backupServerId === "local" ? undefined : (await getNormalizedBackupServer(backupServerId)).server;
  const namespaceId = normalizedServer?.backupNamespaceId ?? crypto.randomUUID();
  const verificationKey = normalizedServer?.backupVerificationKey ?? createBackupVerificationKey();

  const configStore = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;
  const encryptionKey = getEffectiveBackupEncryptionKey(
    configStore?.backup?.encryptionEnabled,
    configStore?.backup?.encryptionKey,
  );
  const identityBase: Omit<IBackupIdentity, "filename" | "schemaVersion" | "verificationSignature"> = {
    backupId,
    namespaceId,
    serverId: backupServerId,
    createdAt,
    trigger,
    scope: {
      kind: isFullBackup(backupFields) ? "full" : "selected",
      fields: [...new Set(backupFields)].sort(),
      fingerprint: createBackupScopeFingerprint(backupFields),
    },
    encryption: encryptionKey ? "encrypted" : "plain",
  };
  const backupFilename = createBackupFilename(identityBase, verificationKey);
  const verificationSignature = parseBackupFilename(backupFilename)?.verificationSignature;
  if (!verificationSignature) throw new Error("Generated backup filename could not be verified.");
  const identity: IBackupIdentity = {
    ...identityBase,
    schemaVersion: 1,
    filename: backupFilename,
    verificationSignature,
  };
  const backupData = await createBackupData(backupFields);
  backupData.manifest = {
    ...backupData.manifest,
    time: createdAt,
    backupIdentity: identity,
  };

  logger({
    msg: `Exporting backup data to ${backupServerId}`,
    data: { backupFields, backupFilename, trigger, scopeFingerprint: identity.scope.fingerprint },
  });
  if (backupServerId === "local") {
    const jsZipBlob = await backupDataToJSZipBlob(backupData, encryptionKey);
    const blobUrl = URL.createObjectURL(jsZipBlob);
    await sendMessage("downloadFile", { url: blobUrl, filename: backupFilename, conflictAction: "uniquify" });
    return { ok: true, local: true, filename: backupFilename, identity };
  } else {
    const backupServerInstance = await getBackupServerInstance(backupServerId);
    backupServerInstance.setEncryptionKey(encryptionKey);
    const uploaded = await backupServerInstance.addFile(backupFilename, backupData);
    if (!uploaded) return { ok: false, local: false, filename: backupFilename, identity, verifiedRemote: false };

    // A successful PUT is not enough for retention. Re-list and verify the exact
    // strict identity before any automatic cleanup can be considered.
    const listed = await backupServerInstance.list();
    const remote = listed.find((file) => file.filename === backupFilename);
    const parsed = parseBackupFilename(remote?.filename ?? "");
    if (
      !remote ||
      !parsed ||
      parsed.backupId !== backupId ||
      parsed.namespaceId !== namespaceId ||
      parsed.verificationSignature !== verificationSignature
    ) {
      throw new Error("Uploaded backup could not be verified in the remote listing.");
    }
    return {
      ok: true,
      local: false,
      filename: backupFilename,
      path: remote.path,
      identity,
      verifiedRemote: true,
    };
  }
}

onMessage("exportBackupData", async ({ data: { backupServerId, backupFields, trigger = "manual" } }) => {
  return await exportBackupData(backupServerId, backupFields, trigger);
});

export async function restoreBackupData(
  restoreData: IBackupData, // 已经解密了的数据
  restoreOptions: IRestoreOptions = {},
): Promise<boolean> {
  const { fields = [], expandCookieMinutes = -1, keepExistUserInfo = true } = restoreOptions;

  const restoreDataExistFields = Object.keys(restoreData.manifest?.files ?? {});
  const restoreFields = intersection(fields, restoreDataExistFields);

  // 恢复下载历史
  if (restoreFields.includes("downloadHistory")) {
    const db = await ptdIndexDb;
    await db.clear("download_history");
    for (const downloadHistoryElement of restoreData.downloadHistory) {
      await db.put("download_history", downloadHistoryElement);
    }
  }

  if (restoreFields.includes("collection") && restoreData.collection) {
    await sendMessage("replacePtppCollectionState", restoreData.collection);
  }

  // 恢复直接从 chrome.storage.local 读取的字段
  for (const field of storageKey.toReversed()) {
    if (restoreFields.includes(field as TBackupFields)) {
      let fieldData = restoreData[field] as IExtensionStorageSchema[typeof field];
      if (fieldData) {
        if (field === "config") {
          const configData = fieldData as IConfigPiniaStorageSchema;
          const currentConfig = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema | undefined;
          configData.backup ??= {
            encryptionKey: "",
            encryptionEnabled: false,
            enabledAutoBackup: false,
            autoUploadUserData: { enabled: false, serverId: "" },
            retry: { max: 3, interval: 5 },
          };
          // The key is a local recovery secret and is intentionally not part of backups.
          // Restoring configuration must therefore keep the current browser's encryption settings.
          configData.backup.encryptionKey = currentConfig?.backup?.encryptionKey ?? "";
          configData.backup.encryptionEnabled = currentConfig?.backup?.encryptionEnabled ?? false;
          configData.backup.autoUploadUserData ??= { enabled: false, serverId: "" };
          configData.backup.retry ??= { max: 3, interval: 5 };
        }
        if (field === "metadata") {
          const metadataData = fieldData as IMetadataPiniaStorageSchema;
          for (const server of Object.values(metadataData.backupServers ?? {})) {
            const normalized = normalizeBackupFields(server.backupFields, server.backupFieldsVersion, BackupFields);
            server.backupFields = normalized.fields as typeof server.backupFields;
            server.backupFieldsVersion = normalized.version;
            // Restored metadata cannot authorize deletion in this browser. A
            // fresh namespace and key make every pre-existing remote file safe
            // by default, even if an older backup happened to contain a key.
            server.backupNamespaceId = crypto.randomUUID();
            server.backupVerificationKey = createBackupVerificationKey();
            server.retentionPolicy = normalizeBackupRetentionPolicy(server.retentionPolicy);
            // A cleanup journal belongs to the browser session and remote inventory
            // that created it. It is never imported from a backup.
            delete server.pendingCleanup;
            delete server.activeRestorePaths;
          }
        }
        if (field === "userInfo" && keepExistUserInfo) {
          const userInfoStore = ((await sendMessage("getExtStorage", "userInfo")) ?? {}) as TUserInfoStorageSchema;
          fieldData = mergeRestoredRecords(
            fieldData as unknown as Record<string, unknown>,
            userInfoStore as unknown as Record<string, unknown>,
            true,
          ) as TUserInfoStorageSchema;
        }

        await sendMessage("setExtStorage", { key: field, value: fieldData });
        if (field === "userInfo" && !keepExistUserInfo && !restoreFields.includes("metadata")) {
          const metadataData = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
          metadataData.lastUserInfo = latestRecordsFromHistory(fieldData as TUserInfoStorageSchema);
          await sendMessage("setExtStorage", { key: "metadata", value: metadataData });
        }
      }
    }
  }

  // 恢复已添加站点的Cookie
  if (restoreFields.includes("cookies")) {
    const now = new Date().getTime() / 1000;

    for (const cookieData of Object.values(restoreData.cookies!)) {
      for (const cookie of cookieData) {
        // 延长 cookie 过期时间
        cookie.expirationDate = extendCookieExpiration(cookie.expirationDate, expandCookieMinutes, now);

        await sendMessage("setCookie", cookie as unknown as chrome.cookies.SetDetails);
      }
    }
  }

  return true;
}

onMessage("restoreBackupData", async ({ data: { restoreData, restoreOptions = {} } }) => {
  return await restoreBackupData(restoreData, restoreOptions);
});

const ACTIVE_RESTORE_LEASE_MS = 30 * 60 * 1000;

function activeRestorePaths(server: IMetadataPiniaStorageSchema["backupServers"][string], now = Date.now()): string[] {
  return Object.entries(server.activeRestorePaths ?? {})
    .filter(([, startedAt]) => Number.isFinite(startedAt) && now - startedAt < ACTIVE_RESTORE_LEASE_MS)
    .map(([path]) => path);
}

async function buildBackupCleanupPreview(
  backupServerId: string,
  options: { includeLegacyOnce?: boolean; protectedPaths?: string[]; forcePolicy?: boolean } = {},
): Promise<IBackupCleanupPreview> {
  const { server } = await getNormalizedBackupServer(backupServerId);
  const backupServerInstance = await getBackupServerInstance(backupServerId);
  const files = (await backupServerInstance.list()) as IRemoteBackupFile[];
  return createBackupCleanupPreview({
    files,
    namespaceId: server.backupNamespaceId!,
    verificationKey: server.backupVerificationKey!,
    policy: server.retentionPolicy,
    protectedPaths: [...new Set([...(options.protectedPaths ?? []), ...activeRestorePaths(server)])],
    includeLegacyOnce: options.includeLegacyOnce,
    forcePolicy: options.forcePolicy,
  });
}

export async function getBackupHistory(backupServerId: string): Promise<IClassifiedBackupFile[]> {
  return (await buildBackupCleanupPreview(backupServerId)).files;
}

onMessage("getBackupHistory", async ({ data: backupServerId }) => {
  return await getBackupHistory(backupServerId);
});

onMessage("previewBackupCleanup", async ({ data }) => {
  // This is an explicit user preview, so it remains available even when the
  // per-server automatic switch is disabled. No deletion happens here.
  return await buildBackupCleanupPreview(data.backupServerId, {
    includeLegacyOnce: data.includeLegacyOnce,
    protectedPaths: data.protectedPaths,
    forcePolicy: true,
  });
});

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return [...new Set(left)].sort().join("\u001f") === [...new Set(right)].sort().join("\u001f");
}

async function prepareBackupCleanup(request: IBackupCleanupRequest, mode: "automatic" | "manual"): Promise<string> {
  const protectedPaths = [...new Set(request.protectedPaths ?? [])];
  const { server } = await getNormalizedBackupServer(request.backupServerId);
  if (mode === "automatic" && !server.retentionPolicy?.enabled) {
    throw new Error("Automatic cleanup is disabled for this backup server.");
  }
  if (mode === "automatic" && request.includeLegacyOnce) {
    throw new Error("Legacy backups can only be included in an explicit manual cleanup.");
  }
  if (server.pendingCleanup) {
    const pendingPaths = server.pendingCleanup.items.map((item) => item.path);
    if (
      server.pendingCleanup.previewToken === request.previewToken &&
      server.pendingCleanup.includeLegacyOnce === (request.includeLegacyOnce === true) &&
      sameStringSet(pendingPaths, request.paths) &&
      sameStringSet(server.pendingCleanup.protectedPaths, protectedPaths)
    ) {
      return server.pendingCleanup.id;
    }
    throw new Error("A cleanup run is already pending for this backup server.");
  }

  const preview = await buildBackupCleanupPreview(request.backupServerId, {
    includeLegacyOnce: request.includeLegacyOnce,
    protectedPaths,
    forcePolicy: mode === "manual",
  });
  if (preview.token !== request.previewToken) {
    throw new Error("The remote backup list or cleanup policy changed. Create a new preview before deleting.");
  }
  const candidateByPath = new Map(
    preview.files
      .filter((file) => file.disposition === "candidate" && (mode === "manual" || file.classification === "automatic"))
      .map((file) => [file.path, file]),
  );
  const selectedPaths = [...new Set(request.paths)];
  if (selectedPaths.some((path) => !candidateByPath.has(path))) {
    throw new Error("The cleanup request contains a file that is not a current candidate.");
  }
  if (selectedPaths.length === 0) return "";

  const now = Date.now();
  const journal: IBackupCleanupJournal = {
    id: crypto.randomUUID(),
    mode,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    previewToken: preview.token,
    includeLegacyOnce: request.includeLegacyOnce === true,
    protectedPaths,
    items: selectedPaths.map((path) => ({
      ...candidateByPath.get(path)!,
      status: "pending",
      attempts: 0,
    })),
    results: [],
  };
  await patchBackupServer(request.backupServerId, (current) => {
    if (current.pendingCleanup) throw new Error("A cleanup run is already pending for this backup server.");
    current.pendingCleanup = journal;
  });
  return journal.id;
}

function upsertCleanupResult(journal: IBackupCleanupJournal, result: IBackupCleanupJournal["results"][number]) {
  const index = journal.results.findIndex((item) => item.path === result.path);
  if (index >= 0) journal.results[index] = result;
  else journal.results.push(result);
}

function cleanupResultFromJournal(journal: IBackupCleanupJournal, error?: string): IBackupCleanupResult {
  const pendingWithError = journal.items.filter((item) => item.status === "pending" && item.error);
  const deleted = journal.results.filter((item) => item.status === "deleted");
  const missing = journal.results.filter((item) => item.status === "missing");
  const skipped = journal.results.filter((item) => item.status === "skipped");
  const failed = journal.results.filter((item) => item.status === "failed");
  const pending = journal.items.filter((item) => item.status === "pending");
  return {
    runId: journal.id,
    status:
      pending.length === 0 ? "completed" : deleted.length || missing.length || skipped.length ? "partial" : "failed",
    requestedCount: journal.items.length,
    deletedCount: deleted.length,
    missingCount: missing.length,
    skippedCount: skipped.length,
    failedCount: Math.max(failed.length, pendingWithError.length),
    releasedBytes: journal.items
      .filter((item) => journal.results.some((result) => result.path === item.path && result.status === "deleted"))
      .reduce((total, item) => total + (typeof item.size === "number" ? item.size : 0), 0),
    results: [...journal.results],
    ...(error ? { error } : {}),
  };
}

async function persistCleanupJournal(backupServerId: string, journal: IBackupCleanupJournal): Promise<void> {
  journal.updatedAt = Date.now();
  await patchBackupServer(backupServerId, (server) => {
    if (server.pendingCleanup?.id !== journal.id) throw new Error("Cleanup journal changed during execution.");
    server.pendingCleanup = structuredClone(journal);
  });
}

function toCleanupSummary(journal: IBackupCleanupJournal, result: IBackupCleanupResult): IBackupCleanupSummary {
  return {
    runId: result.runId,
    status: result.status,
    startedAt: journal.createdAt,
    finishedAt: Date.now(),
    requestedCount: result.requestedCount,
    deletedCount: result.deletedCount,
    missingCount: result.missingCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    releasedBytes: result.releasedBytes,
    error: result.error,
  };
}

async function resumeBackupCleanup(backupServerId: string, runId: string): Promise<IBackupCleanupResult> {
  const { server } = await getNormalizedBackupServer(backupServerId);
  if (!server.pendingCleanup || server.pendingCleanup.id !== runId) {
    if (server.lastCleanup?.runId === runId) {
      return {
        runId,
        status: server.lastCleanup.status,
        requestedCount: server.lastCleanup.requestedCount,
        deletedCount: server.lastCleanup.deletedCount,
        missingCount: server.lastCleanup.missingCount,
        skippedCount: server.lastCleanup.skippedCount,
        failedCount: server.lastCleanup.failedCount,
        releasedBytes: server.lastCleanup.releasedBytes,
        results: [],
        error: server.lastCleanup.error,
      };
    }
    throw new Error("Cleanup journal is not available.");
  }

  const journal = structuredClone(server.pendingCleanup);
  journal.status = "running";
  await persistCleanupJournal(backupServerId, journal);
  const backupServerInstance = await getBackupServerInstance(backupServerId);
  let runError = "";
  await executeBackupCleanupItems({
    items: journal.items,
    list: async () => (await backupServerInstance.list()) as IRemoteBackupFile[],
    remove: async (path) => await backupServerInstance.deleteFile(path),
    validate: async (item, current, currentFiles) => {
      const currentServer = (await getNormalizedBackupServer(backupServerId)).server;
      if (journal.mode === "automatic" && !currentServer.retentionPolicy?.enabled) {
        return "Automatic cleanup was disabled after the preview.";
      }
      const preview = createBackupCleanupPreview({
        files: currentFiles,
        namespaceId: currentServer.backupNamespaceId!,
        verificationKey: currentServer.backupVerificationKey!,
        policy: currentServer.retentionPolicy,
        protectedPaths: [...new Set([...journal.protectedPaths, ...activeRestorePaths(currentServer)])],
        includeLegacyOnce: journal.includeLegacyOnce,
        forcePolicy: journal.mode === "manual",
      });
      return sameRemoteFile(item, current) && preview.candidatePaths.includes(item.path)
        ? true
        : "Remote metadata or retention eligibility changed after preview.";
    },
    sanitizeError: sanitizeDownloadErrorMessage,
    persist: async (_item, result) => {
      if (result.status === "failed") runError ||= result.error ?? "Cleanup failed.";
      upsertCleanupResult(journal, result);
      await persistCleanupJournal(backupServerId, journal);
    },
  });

  const result = cleanupResultFromJournal(journal, runError || undefined);
  journal.status = result.status === "completed" ? "running" : "partial";
  const summary = toCleanupSummary(journal, result);
  await patchBackupServer(backupServerId, (current) => {
    if (current.pendingCleanup?.id !== journal.id) throw new Error("Cleanup journal changed before completion.");
    current.lastCleanup = summary;
    if (result.status === "completed") delete current.pendingCleanup;
    else current.pendingCleanup = structuredClone(journal);
  });
  return result;
}

onMessage("prepareBackupCleanup", async ({ data }) => {
  return await prepareBackupCleanup(data, data.mode);
});

onMessage("resumeBackupCleanup", async ({ data }) => {
  return await resumeBackupCleanup(data.backupServerId, data.runId);
});

export async function deleteBackupHistory(backupServerId: string, path: string): Promise<boolean> {
  const backupServerInstance = await getBackupServerInstance(backupServerId);
  return await backupServerInstance.deleteFile(path);
}

onMessage("deleteBackupHistory", async ({ data: { backupServerId, path } }) => {
  return await deleteBackupHistory(backupServerId, path);
});

export async function getRemoteBackupData(
  backupServerId: string,
  path: string,
  decryptKey: string = "",
): Promise<IBackupData> {
  await patchBackupServer(backupServerId, (server) => {
    server.activeRestorePaths ??= {};
    server.activeRestorePaths[path] = Date.now();
  });
  try {
    const backupServerInstance = await getBackupServerInstance(backupServerId);
    backupServerInstance.setEncryptionKey(decryptKey);
    return await backupServerInstance.getFile(path);
  } finally {
    await patchBackupServer(backupServerId, (server) => {
      if (server.activeRestorePaths) delete server.activeRestorePaths[path];
    }).catch(() => undefined);
  }
}

onMessage("getRemoteBackupData", async ({ data: { backupServerId, path, decryptKey = "" } }) => {
  return await getRemoteBackupData(backupServerId, path, decryptKey);
});
