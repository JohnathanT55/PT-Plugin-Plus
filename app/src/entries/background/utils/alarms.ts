import { format } from "date-fns";
import { defineJobScheduler } from "@webext-core/job-scheduler";
import { EResultParseStatus, type TSiteID } from "@ptd/site/types/base.ts";

import { extStorage } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import { sanitizeDownloadErrorMessage } from "@/shared/downloadError.ts";
import {
  BackupFields,
  IConfigPiniaStorageSchema,
  IDownloadTorrentOption,
  IMetadataPiniaStorageSchema,
  type IBackupCleanupSummary,
  type IDownloadBatchRecord,
  type IDownloadBatchStorageSchema,
  type IDownloadTorrentResult,
  type TBackupFields,
  type TBackupTrigger,
} from "@/shared/types.ts";
import type { TDurableTaskPayload } from "@/shared/types.ts";
import {
  createDurableTaskCoordinator,
  createEmptyDurableTaskStore,
  durableTaskIdFromAlarm,
  type IDurableTask,
} from "@foundation/tasks/durable";
import {
  createBackupRetryPlan,
  DEFAULT_BACKUP_RETRY_INTERVAL_MINUTES,
  DEFAULT_BACKUP_RETRY_MAX,
  getBackupIntervalMs,
  getNextIntervalBackupAt,
  normalizeBackupFields,
  shouldUploadAfterUserRefresh,
} from "@foundation/backup/policy";
import { prependLimitedHistory } from "@foundation/backup/restore";
import {
  normalizeBackupRetentionPolicy,
  type IBackupCleanupRequest,
  type IBackupCleanupResult,
  type IBackupExportResult,
} from "@foundation/backup/retention";

import { setupOffscreenDocument } from "./offscreen.ts";
export enum EJobType {
  FlushUserInfo = "flushUserInfo",
  AutoBackup = "autoBackup",
}

const DOWNLOAD_TASK_PREFIX = "download:";
const DOWNLOAD_BATCH_TASK_PREFIX = "download-batch:";
const USER_INFO_RETRY_TASK_ID = "user-info-retry";
const BACKUP_RETRY_TASK_PREFIX = "backup-retry:";
const BACKUP_CLEANUP_TASK_PREFIX = "backup-cleanup:";
const DOWNLOAD_BATCH_STORAGE_VERSION = 1 as const;
const MAX_RETAINED_DOWNLOAD_BATCHES = 20;

const jobs = defineJobScheduler();

function autoFlushUserInfo(retryIndex: number = 0) {
  return async () => {
    await setupOffscreenDocument();

    const configStore = (await extStorage.getItem("config"))!;

    // 获取自动刷新参数
    const {
      enabled = false,
      interval = 1,
      afterTime = "00:00",
      retry: { max: retryMax = 0, interval: retryInterval = 5 } = {},
    } = configStore?.userInfo?.autoReflush ?? {};

    // 如果未启用自动刷新，则直接返回
    if (!enabled) {
      return;
    }

    const curDate = new Date();
    const curDateFormat = format(curDate, "yyyy-MM-dd");
    let metadataStore = (await extStorage.getItem("metadata"))!;

    // 如果不是重试，则要检查是否满足刷新条件
    if (retryIndex === 0) {
      // 检查当前时间是否在允许的刷新时间之后
      const [afterHour, afterMinute] = afterTime.split(":").map((v) => parseInt(v));
      if (curDate.getHours() < afterHour || (curDate.getHours() === afterHour && curDate.getMinutes() < afterMinute)) {
        sendMessage("logger", {
          msg: `Auto-refreshing user information paused since current time is before the allowed refresh time.`,
        }).catch();
        return;
      }

      metadataStore = (await extStorage.getItem("metadata"))!;
      const lastFlushDateFormat = format(metadataStore.lastUserInfoAutoFlushAt, "yyyy-MM-dd");

      // 如果不是同一天，则不检查距离上次刷新时间是否超过了设定的间隔，这样能保证至少每天刷新一次（即启动浏览器后第一次检查）
      if (curDateFormat === lastFlushDateFormat) {
        const nextFlushTime = metadataStore.lastUserInfoAutoFlushAt + interval * 60 * 60 * 1000; // interval in hours
        // 确保距离上次刷新时间已经超过了设定的间隔
        if (curDate.getTime() < nextFlushTime) {
          sendMessage("logger", {
            msg: `Auto-refreshing user information paused since refresh interval not reached.`,
          }).catch();
          return;
        }
      }
    }

    sendMessage("logger", {
      msg: `Auto-refreshing user information at ${curDateFormat}${retryIndex > 0 ? `(Retry #${retryIndex})` : ""}`,
    }).catch();

    let processedSiteCount = 0;
    const failFlushSites: TSiteID[] = [];

    /**
     * 由于是后台任务，所以我们不使用 promise 来并行处理，以确保 flushQueue 中永远只有一个任务在运行，
     * 防止用户设置的并发数过大而被浏览器block
     */
    metadataStore = (await extStorage.getItem("metadata"))!; // 遍历 metadataStore 中添加的站点
    for (const [siteId, siteConfig] of Object.entries(metadataStore.sites)) {
      if (!siteConfig.isOffline && siteConfig.allowQueryUserInfo) {
        try {
          // 检查当天的记录是否存在
          const thisSiteUserInfo = (await sendMessage("getSiteUserInfo", siteId)) ?? {};
          if (typeof thisSiteUserInfo[curDateFormat] === "undefined") {
            const userInfoResult = await sendMessage("getSiteUserInfoResult", siteId);
            if (userInfoResult.status !== EResultParseStatus.success) {
              failFlushSites.push(siteId);
            }
            processedSiteCount += 1;
          }
        } catch (e) {
          failFlushSites.push(siteId);
        }
      }
    }

    sendMessage("logger", {
      msg: `Auto-refreshing user information finished, ${processedSiteCount} sites processed, ${failFlushSites.length} failed.`,
      data: { failFlushSites },
    }).catch();

    // 将刷新时间存入 metadataStore
    metadataStore = (await extStorage.getItem("metadata"))!;
    metadataStore.lastUserInfoAutoFlushAt = new Date().getTime(); // 刷新时间应该是实际完成时间
    await extStorage.setItem("metadata", metadataStore);

    // 如果本次有失败的刷新操作，则设置重试
    if (failFlushSites.length > 0 && retryIndex < retryMax) {
      sendMessage("logger", {
        msg: `Retrying auto-refresh for ${failFlushSites.length} failed sites in ${retryInterval} minutes (Retry #${retryIndex + 1})`,
      }).catch();
      const runAt = +curDate + retryInterval * 60 * 1000;
      await durableTasks.schedule({
        id: `${USER_INFO_RETRY_TASK_ID}:${retryIndex + 1}:${runAt}`,
        runAt,
        payload: {
          type: "userInfoRetry",
          retryIndex: retryIndex + 1,
        },
      });
    }

    // 原版 PT-Plugin-Plus 语义：整轮自动刷新成功，或刷新重试已经耗尽后，
    // 将一次全量备份上传到用户指定的服务器。
    if (shouldUploadAfterUserRefresh(failFlushSites.length, retryIndex, retryMax)) {
      const latestConfig = (await extStorage.getItem("config")) as IConfigPiniaStorageSchema | undefined;
      const autoUpload = latestConfig?.backup?.autoUploadUserData;
      if (autoUpload?.enabled) {
        if (autoUpload.serverId) {
          await runBackupWithRetry(autoUpload.serverId, "userDataRefresh", 0);
        } else {
          sendMessage("logger", {
            level: "error",
            msg: "Automatic user-data upload is enabled, but no backup server is selected.",
          }).catch();
        }
      }
    }
  };
}

// noinspection JSIgnoredPromiseFromCall
jobs.scheduleJob({
  id: EJobType.FlushUserInfo,
  type: "interval",
  duration: 1000 * 60 * 10, // check every 10 minutes
  immediate: true,
  execute: autoFlushUserInfo(),
});

const activeBackupRuns = new Map<string, Promise<unknown>>();

function backupRetryTaskId(serverId: string): string {
  return `${BACKUP_RETRY_TASK_PREFIX}${serverId}`;
}

function backupCleanupTaskId(serverId: string): string {
  return `${BACKUP_CLEANUP_TASK_PREFIX}${serverId}`;
}

async function serializeBackupServerOperation<T>(serverId: string, operation: () => Promise<T>): Promise<T> {
  while (activeBackupRuns.has(serverId)) {
    try {
      await activeBackupRuns.get(serverId);
    } catch {
      // The queued operation revalidates all remote state after acquiring the slot.
    }
  }
  const run = operation();
  activeBackupRuns.set(serverId, run);
  try {
    return await run;
  } finally {
    if (activeBackupRuns.get(serverId) === run) activeBackupRuns.delete(serverId);
  }
}

async function patchBackupServer(
  serverId: string,
  patch: (server: IMetadataPiniaStorageSchema["backupServers"][string]) => void,
): Promise<boolean> {
  const metadataStore = (await extStorage.getItem("metadata")) as IMetadataPiniaStorageSchema | undefined;
  const server = metadataStore?.backupServers?.[serverId];
  if (!metadataStore || !server) return false;
  patch(server);
  await extStorage.setItem("metadata", metadataStore);
  return true;
}

async function recordBackupSuccess(
  serverId: string,
  trigger: TBackupTrigger,
  startedAt: number,
  finishedAt: number,
  retryIndex: number,
  fields: TBackupFields[],
  exported: IBackupExportResult,
  cleanup?: IBackupCleanupSummary,
): Promise<void> {
  await patchBackupServer(serverId, (server) => {
    server.lastBackupAt = finishedAt;
    server.lastBackupAttemptAt = finishedAt;
    server.lastBackupTrigger = trigger;
    const intervalMs = getBackupIntervalMs(server.backupInterval);
    server.nextBackupAt = intervalMs ? finishedAt + intervalMs : undefined;
    server.backupHistory = prependLimitedHistory(server.backupHistory, {
      id: crypto.randomUUID(),
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      status: "success",
      trigger,
      retryIndex,
      fields: [...fields],
      backup: exported.identity,
      cleanup,
    });
    delete server.lastBackupFailureAt;
    delete server.lastBackupError;
    delete server.backupRetryAt;
    delete server.backupRetryCount;
  });
  await durableTasks.cancel(backupRetryTaskId(serverId));
}

async function recordBackupFailure(
  serverId: string,
  trigger: TBackupTrigger,
  error: unknown,
  retryIndex: number,
  startedAt: number,
  fields: TBackupFields[],
): Promise<void> {
  const now = Date.now();
  let message = sanitizeDownloadErrorMessage(error || "Backup server returned a failure result.");
  const configStore = (await extStorage.getItem("config")) as IConfigPiniaStorageSchema | undefined;
  const retryMax = configStore?.backup?.retry?.max ?? DEFAULT_BACKUP_RETRY_MAX;
  const retryInterval = configStore?.backup?.retry?.interval ?? DEFAULT_BACKUP_RETRY_INTERVAL_MINUTES;
  const retryTrigger = trigger === "manual" ? undefined : trigger;
  let retryPlan = retryTrigger ? createBackupRetryPlan(retryIndex, retryMax, retryInterval, now) : undefined;

  if (retryPlan) {
    try {
      await durableTasks.schedule({
        id: backupRetryTaskId(serverId),
        runAt: retryPlan.runAt,
        payload: {
          type: "backupRetry",
          serverId,
          trigger: retryTrigger!,
          retryIndex: retryPlan.retryIndex,
        },
      });
    } catch (scheduleError) {
      message = sanitizeDownloadErrorMessage(
        `${message}; retry scheduling failed: ${sanitizeDownloadErrorMessage(scheduleError)}`,
      );
      retryPlan = undefined;
    }
  }

  await patchBackupServer(serverId, (server) => {
    server.lastBackupAttemptAt = now;
    server.lastBackupFailureAt = now;
    server.lastBackupError = message;
    server.lastBackupTrigger = trigger;
    server.backupHistory = prependLimitedHistory(server.backupHistory, {
      id: crypto.randomUUID(),
      startedAt,
      finishedAt: now,
      durationMs: Math.max(0, now - startedAt),
      status: "failed",
      trigger,
      retryIndex,
      fields: [...fields],
      error: message,
    });
    if (trigger !== "manual") {
      server.backupRetryAt = retryPlan?.runAt;
      server.backupRetryCount = retryPlan?.retryIndex;
    }
    if (!retryPlan && trigger === "interval") {
      const intervalMs = getBackupIntervalMs(server.backupInterval);
      server.nextBackupAt = intervalMs ? now + intervalMs : undefined;
    }
  });

  sendMessage("logger", {
    level: "error",
    msg: `Backup failed for [${serverId}]: ${message}`,
    data: retryPlan ? { retryIndex: retryPlan.retryIndex, retryAt: retryPlan.runAt } : undefined,
  }).catch();
}

function cleanupSummary(result: IBackupCleanupResult, startedAt: number): IBackupCleanupSummary {
  return {
    runId: result.runId,
    status: result.status,
    startedAt,
    finishedAt: Date.now(),
    requestedCount: result.requestedCount,
    deletedCount: result.deletedCount,
    missingCount: result.missingCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    releasedBytes: result.releasedBytes,
    error: result.error ? sanitizeDownloadErrorMessage(result.error) : undefined,
  };
}

function emptyCleanupResult(): IBackupCleanupResult {
  return {
    runId: "",
    status: "nothingToDo",
    requestedCount: 0,
    deletedCount: 0,
    missingCount: 0,
    skippedCount: 0,
    failedCount: 0,
    releasedBytes: 0,
    results: [],
  };
}

async function resumePreparedCleanup(serverId: string, runId: string): Promise<IBackupCleanupResult> {
  if (!runId) return emptyCleanupResult();
  await durableTasks.schedule({
    id: backupCleanupTaskId(serverId),
    runAt: Date.now() + 60_000,
    payload: { type: "backupCleanup", serverId, runId },
  });
  const result = await sendMessage("resumeBackupCleanup", { backupServerId: serverId, runId });
  if (result.status === "completed" || result.status === "nothingToDo") {
    await durableTasks.cancel(backupCleanupTaskId(serverId));
  } else {
    const retryDelay = await getCleanupRetryDelay(serverId);
    await durableTasks.schedule({
      id: backupCleanupTaskId(serverId),
      runAt: Date.now() + retryDelay,
      payload: { type: "backupCleanup", serverId, runId },
    });
  }
  return result;
}

async function getCleanupRetryDelay(serverId: string): Promise<number> {
  const metadataStore = (await extStorage.getItem("metadata")) as IMetadataPiniaStorageSchema | undefined;
  const maxAttempts = Math.max(
    1,
    ...(metadataStore?.backupServers?.[serverId]?.pendingCleanup?.items
      .filter((item) => item.status === "pending")
      .map((item) => item.attempts) ?? [1]),
  );
  return Math.min(12 * 60 * 60_000, 5 * 60_000 * 2 ** Math.min(7, Math.max(0, maxAttempts - 1)));
}

async function prepareAndRunCleanup(
  request: IBackupCleanupRequest,
  mode: "automatic" | "manual",
): Promise<IBackupCleanupResult> {
  await setupOffscreenDocument();
  const runId = await sendMessage("prepareBackupCleanup", { ...request, mode });
  return await resumePreparedCleanup(request.backupServerId, runId);
}

async function runBackupWithRetry(serverId: string, trigger: TBackupTrigger, retryIndex: number = 0): Promise<boolean> {
  return await serializeBackupServerOperation(serverId, async () => {
    await setupOffscreenDocument();
    const [metadataStore, configStore] = await Promise.all([
      extStorage.getItem("metadata") as Promise<IMetadataPiniaStorageSchema | undefined>,
      extStorage.getItem("config") as Promise<IConfigPiniaStorageSchema | undefined>,
    ]);
    const server = metadataStore?.backupServers?.[serverId];
    if (!server) return false;
    if (trigger === "interval" && (!server.enabled || !getBackupIntervalMs(server.backupInterval))) return false;
    if (
      trigger === "userDataRefresh" &&
      (!configStore?.backup?.autoUploadUserData?.enabled || configStore.backup.autoUploadUserData.serverId !== serverId)
    ) {
      return false;
    }

    const normalizedFields = normalizeBackupFields(server.backupFields, server.backupFieldsVersion, BackupFields);
    if (normalizedFields.changed) {
      await patchBackupServer(serverId, (current) => {
        current.backupFields = normalizedFields.fields as typeof current.backupFields;
        current.backupFieldsVersion = normalizedFields.version;
      });
    }

    const startedAt = Date.now();
    await patchBackupServer(serverId, (current) => {
      current.lastBackupAttemptAt = startedAt;
      current.lastBackupTrigger = trigger;
    });

    try {
      const backupFields =
        trigger === "userDataRefresh" ? [...BackupFields] : (normalizedFields.fields as typeof server.backupFields);
      const exported = await sendMessage("exportBackupData", {
        backupServerId: serverId,
        backupFields,
        trigger,
      });
      if (!exported.ok || !exported.verifiedRemote || !exported.path) {
        throw new Error("Backup upload was not verified in the remote listing.");
      }

      let cleanup: IBackupCleanupSummary | undefined;
      const retentionPolicy = normalizeBackupRetentionPolicy(server.retentionPolicy);
      if (trigger !== "manual" && retentionPolicy.enabled) {
        const cleanupStartedAt = Date.now();
        try {
          const preview = await sendMessage("previewBackupCleanup", {
            backupServerId: serverId,
            protectedPaths: [exported.path],
          });
          const result = await prepareAndRunCleanup(
            {
              backupServerId: serverId,
              previewToken: preview.token,
              paths: preview.candidatePaths,
              protectedPaths: [exported.path],
            },
            "automatic",
          );
          cleanup = cleanupSummary(result, cleanupStartedAt);
        } catch (cleanupError) {
          // Cleanup uncertainty never changes a verified upload into a failure and
          // never falls back to deleting without a freshly verified preview.
          cleanup = {
            runId: "",
            status: "failed",
            startedAt: cleanupStartedAt,
            finishedAt: Date.now(),
            requestedCount: 0,
            deletedCount: 0,
            missingCount: 0,
            skippedCount: 0,
            failedCount: 0,
            releasedBytes: 0,
            error: sanitizeDownloadErrorMessage(cleanupError),
          };
        }
      }
      await recordBackupSuccess(serverId, trigger, startedAt, Date.now(), retryIndex, backupFields, exported, cleanup);
      sendMessage("logger", { msg: `Backup completed for [${serverId}] (${trigger}).` }).catch();
      return true;
    } catch (error) {
      const backupFields =
        trigger === "userDataRefresh" ? [...BackupFields] : (normalizedFields.fields as typeof server.backupFields);
      await recordBackupFailure(serverId, trigger, error, retryIndex, startedAt, backupFields);
      return false;
    }
  });
}

/** 检查每个服务器独立的固定间隔计划；定时刷新后上传走上面的独立入口。 */
function autoBackup() {
  return async () => {
    const metadataStore = (await extStorage.getItem("metadata")) as IMetadataPiniaStorageSchema | undefined;
    if (!metadataStore?.backupServers) return;
    const now = Date.now();

    for (const [serverId, server] of Object.entries(metadataStore.backupServers)) {
      if (!server.enabled || !getBackupIntervalMs(server.backupInterval)) continue;
      if (server.backupRetryAt) continue;
      const dueAt = getNextIntervalBackupAt(
        {
          intervalHours: server.backupInterval,
          lastBackupAt: server.lastBackupAt,
          nextBackupAt: server.nextBackupAt,
        },
        now,
      );
      if (!dueAt) continue;
      if (server.nextBackupAt !== dueAt) {
        await patchBackupServer(serverId, (current) => {
          current.nextBackupAt = dueAt;
        });
      }
      if (dueAt <= now) await runBackupWithRetry(serverId, "interval", 0);
    }
  };
}

// noinspection JSIgnoredPromiseFromCall
jobs.scheduleJob({
  id: EJobType.AutoBackup,
  type: "interval",
  duration: 1000 * 60 * 10, // check every 10 minutes
  immediate: true,
  execute: autoBackup(),
});

function createEmptyDownloadBatchStore(): IDownloadBatchStorageSchema {
  return { version: DOWNLOAD_BATCH_STORAGE_VERSION, batches: {} };
}

async function loadDownloadBatchStore(): Promise<IDownloadBatchStorageSchema> {
  const stored = await extStorage.getItem("downloadBatchResults");
  if (stored?.version !== DOWNLOAD_BATCH_STORAGE_VERSION || !stored.batches) {
    return createEmptyDownloadBatchStore();
  }
  return stored;
}

async function saveDownloadBatchStore(store: IDownloadBatchStorageSchema): Promise<void> {
  await extStorage.setItem("downloadBatchResults", store);
}

function pruneCompletedDownloadBatches(store: IDownloadBatchStorageSchema): void {
  const completed = Object.values(store.batches)
    .filter((batch) => batch.status === "completed")
    .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt));
  for (const batch of completed.slice(MAX_RETAINED_DOWNLOAD_BATCHES)) delete store.batches[batch.id];
}

async function showDownloadBatchNotification(batch: IDownloadBatchRecord): Promise<void> {
  await chrome.notifications.create(`ptpp-download-batch:${batch.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/logo/128.png"),
    title: "PT-Plugin-Plus",
    message: `批量下载完成：成功 ${batch.successCount}，失败 ${batch.failedCount}，共 ${batch.totalCount} 项。`,
    requireInteraction: true,
  });
}

async function executeDownloadBatch(batchId: string): Promise<void> {
  await setupOffscreenDocument();
  let store = await loadDownloadBatchStore();
  let batch = store.batches[batchId];
  if (!batch || batch.status === "completed") return;

  const index = batch.currentIndex;
  const queuedOption = batch.items[index];
  if (!queuedOption) {
    batch.status = "completed";
    batch.completedAt = Date.now();
    batch.items = [];
    pruneCompletedDownloadBatches(store);
    await saveDownloadBatchStore(store);
    await showDownloadBatchNotification(batch);
    return;
  }

  let result: IDownloadTorrentResult;
  try {
    const existingHistory = queuedOption.downloadId
      ? await sendMessage("getDownloadHistoryById", queuedOption.downloadId).catch(() => undefined)
      : undefined;
    result =
      existingHistory?.downloadStatus === "completed"
        ? { downloadId: queuedOption.downloadId!, downloadStatus: "completed" }
        : await sendMessage("downloadTorrent", {
            ...queuedOption,
            backgroundBatchId: batchId,
            leftInterval: 0,
          });
  } catch (error) {
    result = {
      downloadId: queuedOption.downloadId ?? 0,
      downloadStatus: "failed",
      errorMessage: sanitizeDownloadErrorMessage(error),
    };
  }

  // A site interval or a configured retry has already rescheduled this same
  // durable batch task through reDownloadTorrent. Keep the cursor in place.
  if (result.downloadStatus === "pending") {
    store = await loadDownloadBatchStore();
    batch = store.batches[batchId];
    if (batch?.items[index]) {
      batch.items[index] = { ...batch.items[index], downloadId: result.downloadId, backgroundBatchId: batchId };
      await saveDownloadBatchStore(store);
    }
    return;
  }

  store = await loadDownloadBatchStore();
  batch = store.batches[batchId];
  if (!batch || batch.status === "completed" || batch.currentIndex !== index) return;
  batch.results[index] = {
    index,
    downloadId: result.downloadId,
    downloadStatus: result.downloadStatus,
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
  };
  if (result.downloadStatus === "completed") batch.successCount += 1;
  else batch.failedCount += 1;
  batch.currentIndex += 1;

  if (batch.currentIndex >= batch.totalCount) {
    batch.status = "completed";
    batch.completedAt = Date.now();
    batch.items = [];
    pruneCompletedDownloadBatches(store);
    await saveDownloadBatchStore(store);
    await showDownloadBatchNotification(batch);
    return;
  }

  await saveDownloadBatchStore(store);
  await durableTasks.schedule({
    id: `${DOWNLOAD_BATCH_TASK_PREFIX}${batchId}`,
    runAt: Date.now() + Math.max(0, batch.intervalSeconds) * 1000,
    payload: { type: "downloadBatch", batchId },
  });
}

async function executeDurableTask(task: IDurableTask<TDurableTaskPayload>): Promise<void> {
  if (task.payload.type === "userInfoRetry") {
    await autoFlushUserInfo(task.payload.retryIndex)();
    return;
  }

  if (task.payload.type === "backupRetry") {
    await runBackupWithRetry(task.payload.serverId, task.payload.trigger, task.payload.retryIndex);
    return;
  }

  if (task.payload.type === "backupCleanup") {
    const cleanupTask = task.payload;
    await serializeBackupServerOperation(cleanupTask.serverId, async () => {
      await setupOffscreenDocument();
      const result = await sendMessage("resumeBackupCleanup", {
        backupServerId: cleanupTask.serverId,
        runId: cleanupTask.runId,
      });
      if (result.status !== "completed" && result.status !== "nothingToDo") {
        const retryDelay = await getCleanupRetryDelay(cleanupTask.serverId);
        await durableTasks.schedule({
          id: backupCleanupTaskId(cleanupTask.serverId),
          runAt: Date.now() + retryDelay,
          payload: cleanupTask,
        });
      }
    });
    return;
  }

  if (task.payload.type === "downloadBatch") {
    await executeDownloadBatch(task.payload.batchId);
    return;
  }

  await setupOffscreenDocument();
  const { downloadId, downloadOption } = task.payload;
  const history = await sendMessage("getDownloadHistoryById", downloadId).catch(() => undefined);
  if (history?.downloadStatus === "completed") {
    return;
  }

  try {
    const result = await sendMessage("downloadTorrent", {
      ...downloadOption,
      downloadId,
      leftInterval: 0,
    });
    if (result.downloadStatus === "failed") {
      throw new Error(result.errorMessage || "Delayed download failed");
    }
  } catch (error) {
    await sendMessage("setDownloadHistoryStatus", { downloadId, status: "failed" }).catch(() => undefined);
    throw error;
  }
}

const durableTasks = createDurableTaskCoordinator<TDurableTaskPayload>({
  async load() {
    return (await extStorage.getItem("pendingOneShotTasks")) ?? createEmptyDurableTaskStore<TDurableTaskPayload>();
  },
  async save(store) {
    await extStorage.setItem("pendingOneShotTasks", store);
  },
  async createAlarm(name, when) {
    await chrome.alarms.create(name, { when });
  },
  async clearAlarm(name) {
    await chrome.alarms.clear(name);
  },
  execute: executeDurableTask,
  now: () => Date.now(),
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!durableTaskIdFromAlarm(alarm.name)) return;
  const handle = () => durableTasks.handleAlarm(alarm.name);
  const handled = navigator.locks ? navigator.locks.request(`ptpp-durable-task:${alarm.name}`, handle) : handle();
  handled.catch(() => {
    sendMessage("logger", { msg: `A durable one-shot task failed; see its download history status.` }).catch();
  });
});

durableTasks.restore().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  sendMessage("logger", { msg: `Restoring durable one-shot tasks failed: ${errorMessage}` }).catch();
});

async function restorePendingBackupCleanups(): Promise<void> {
  const metadataStore = (await extStorage.getItem("metadata")) as IMetadataPiniaStorageSchema | undefined;
  for (const [serverId, server] of Object.entries(metadataStore?.backupServers ?? {})) {
    if (!server.pendingCleanup?.id) continue;
    const taskId = backupCleanupTaskId(serverId);
    if (await durableTasks.getTask(taskId)) continue;
    await durableTasks.schedule({
      id: taskId,
      runAt: Date.now(),
      payload: { type: "backupCleanup", serverId, runId: server.pendingCleanup.id },
    });
  }
}

restorePendingBackupCleanups().catch((error) => {
  sendMessage("logger", {
    level: "error",
    msg: `Restoring pending backup cleanup failed: ${sanitizeDownloadErrorMessage(error)}`,
  }).catch();
});

onMessage("runBackup", async ({ data }) => {
  return await runBackupWithRetry(data.backupServerId, data.trigger ?? "manual", 0);
});

onMessage("executeBackupCleanup", async ({ data }) => {
  return await serializeBackupServerOperation(data.backupServerId, async () => {
    return await prepareAndRunCleanup(data, "manual");
  });
});

onMessage("cancelBackupRetry", async ({ data: serverId }) => {
  const cancelled = await durableTasks.cancel(backupRetryTaskId(serverId));
  await patchBackupServer(serverId, (server) => {
    delete server.backupRetryAt;
    delete server.backupRetryCount;
  });
  return cancelled;
});

onMessage("reDownloadTorrent", async ({ data }) => {
  const runAt = Date.now() + Math.max(0, data.leftInterval);
  if (data.backgroundBatchId) {
    const store = await loadDownloadBatchStore();
    const batch = store.batches[data.backgroundBatchId];
    if (batch && batch.status === "pending" && batch.items[batch.currentIndex]) {
      batch.items[batch.currentIndex] = { ...data, leftInterval: 0 };
      await saveDownloadBatchStore(store);
      await durableTasks.schedule({
        id: `${DOWNLOAD_BATCH_TASK_PREFIX}${data.backgroundBatchId}`,
        runAt,
        payload: { type: "downloadBatch", batchId: data.backgroundBatchId },
      });
    }
    return;
  }
  const taskKey = data.downloadId > 0 ? String(data.downloadId) : crypto.randomUUID();
  try {
    await durableTasks.schedule({
      id: `${DOWNLOAD_TASK_PREFIX}${taskKey}`,
      runAt,
      payload: {
        type: "download",
        downloadId: data.downloadId,
        downloadOption: { ...data, leftInterval: 0 },
      },
    });
  } catch (error) {
    await sendMessage("setDownloadHistoryStatus", { downloadId: data.downloadId, status: "failed" }).catch(
      () => undefined,
    );
    throw error;
  }
});

onMessage("queueDownloadBatch", async ({ data }) => {
  const batchId = crypto.randomUUID();
  const intervalSeconds = Number.isFinite(data.intervalSeconds) ? Math.max(0, data.intervalSeconds) : 0;
  await setupOffscreenDocument();
  const items = [] as IDownloadTorrentOption[];
  for (const item of data.items) {
    const downloadId = item.downloadId ?? (await sendMessage("createDownloadHistory", item));
    items.push({ ...item, downloadId, retryIndex: 0, backgroundBatchId: batchId });
  }
  const store = await loadDownloadBatchStore();
  store.batches[batchId] = {
    id: batchId,
    createdAt: Date.now(),
    intervalSeconds,
    currentIndex: 0,
    items,
    results: {},
    totalCount: data.items.length,
    successCount: 0,
    failedCount: 0,
    status: "pending",
  };
  pruneCompletedDownloadBatches(store);
  await saveDownloadBatchStore(store);

  if (data.items.length > 0) {
    try {
      await durableTasks.schedule({
        id: `${DOWNLOAD_BATCH_TASK_PREFIX}${batchId}`,
        runAt: Date.now(),
        payload: { type: "downloadBatch", batchId },
      });
    } catch (error) {
      const rollbackStore = await loadDownloadBatchStore();
      delete rollbackStore.batches[batchId];
      await saveDownloadBatchStore(rollbackStore);
      throw error;
    }
  }

  return { batchId, totalCount: data.items.length };
});
