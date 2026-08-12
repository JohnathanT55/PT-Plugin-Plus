import { format } from "date-fns";
import { defineJobScheduler } from "@webext-core/job-scheduler";
import { EResultParseStatus, type TSiteID } from "@ptd/site/types/base.ts";

import { extStorage } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import { sanitizeDownloadErrorMessage } from "@/shared/downloadError.ts";
import {
  IDownloadTorrentOption,
  IMetadataPiniaStorageSchema,
  type IDownloadBatchRecord,
  type IDownloadBatchStorageSchema,
  type IDownloadTorrentResult,
} from "@/shared/types.ts";
import type { TDurableTaskPayload } from "@/shared/types.ts";
import {
  createDurableTaskCoordinator,
  createEmptyDurableTaskStore,
  durableTaskIdFromAlarm,
  type IDurableTask,
} from "@foundation/tasks/durable";

import { setupOffscreenDocument } from "./offscreen.ts";
export enum EJobType {
  FlushUserInfo = "flushUserInfo",
  AutoBackup = "autoBackup",
}

const DOWNLOAD_TASK_PREFIX = "download:";
const DOWNLOAD_BATCH_TASK_PREFIX = "download-batch:";
const USER_INFO_RETRY_TASK_ID = "user-info-retry";
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

/**
 * 自动备份：检查所有已启用且设置了备份间隔的备份服务器，在满足条件时触发备份
 */
function autoBackup() {
  return async () => {
    await setupOffscreenDocument();

    const metadataStore = (await extStorage.getItem("metadata")) as IMetadataPiniaStorageSchema | undefined;
    if (!metadataStore?.backupServers) {
      return;
    }

    const now = Date.now();

    for (const [serverId, serverConfig] of Object.entries(metadataStore.backupServers)) {
      // 仅处理已启用且有备份间隔的服务器
      if (!serverConfig.enabled || !serverConfig.backupInterval || serverConfig.backupInterval <= 0) {
        continue;
      }

      const intervalMs = serverConfig.backupInterval * 60 * 60 * 1000;
      const lastBackup = serverConfig.lastBackupAt ?? 0;

      if (now - lastBackup >= intervalMs) {
        sendMessage("logger", {
          msg: `Auto-backup triggered for [${serverConfig.name}] (interval: ${serverConfig.backupInterval}h)`,
        }).catch();

        try {
          const backupFields = serverConfig.backupFields ?? [];
          const ok = await sendMessage("exportBackupData", {
            backupServerId: serverId,
            backupFields,
          });

          if (!ok) {
            sendMessage("logger", {
              msg: `Auto-backup failed for [${serverConfig.name}] (returned false)`,
            }).catch();
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          sendMessage("logger", {
            msg: `Auto-backup failed for [${serverConfig.name}]: ${errMsg}`,
          }).catch();
        }
      }
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
  durableTasks.handleAlarm(alarm.name).catch(() => {
    sendMessage("logger", { msg: `A durable one-shot task failed; see its download history status.` }).catch();
  });
});

durableTasks.restore().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  sendMessage("logger", { msg: `Restoring durable one-shot tasks failed: ${errorMessage}` }).catch();
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
