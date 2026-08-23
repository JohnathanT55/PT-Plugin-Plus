import axios, { type AxiosRequestConfig } from "axios";
import { stringify } from "urlencode";
import { toMerged } from "es-toolkit";
import { isEmpty } from "es-toolkit/compat";

import {
  getDownloader,
  getRemoteTorrentFile,
  getParsedTorrentInfoForVerification,
  type CTorrent,
  type CAddTorrentOptions,
  type TorrentClientStatus,
} from "@ptd/downloader";
import type { ITorrent } from "@ptd/site";

import { onMessage, sendMessage } from "@/messages.ts";
import type {
  IConfigPiniaStorageSchema,
  ITorrentDownloadMetadata,
  TTorrentDownloadKey,
  IDownloaderMetadata,
  IMetadataPiniaStorageSchema,
  TTorrentDownloadStatus,
  IDownloadTorrentOption,
  IDownloadTorrentResult,
  IClientOperationResult,
  TClientOperation,
  AugmentedRequired,
} from "@/shared/types.ts";
import { sanitizeDownloadErrorMessage } from "@/shared/downloadError.ts";
import { toPlainSerializable } from "@/shared/serializable.ts";

import { logger } from "./logger.ts";
import { getSiteInstance } from "./site.ts";
import { ptdIndexDb } from "../adapter/indexdb.ts";

type TLocalDownloadOption = AugmentedRequired<IDownloadTorrentOption, "downloadId" | "localDownloadMethod">;
type TRemoteDownloadOption = AugmentedRequired<
  IDownloadTorrentOption,
  "downloadId" | "downloaderId" | "addTorrentOptions"
>;

export async function getDownloaderConfig(downloaderId: string) {
  const metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  return metadataStore?.downloaders?.[downloaderId] ?? ({} as IDownloaderMetadata);
}

type DownloaderInstance = Awaited<ReturnType<typeof getDownloader>>;

const downloaderInstanceCache = new Map<string, { configKey: string; instance: DownloaderInstance }>();

function getDownloaderConfigKey(config: IDownloaderMetadata): string {
  const { id, type, address, username, password, timeout } = config;
  return JSON.stringify({ id, type, address, username, password, timeout });
}

export async function getDownloaderInstance(downloaderId: string): Promise<DownloaderInstance | null> {
  const downloaderConfig = await getDownloaderConfig(downloaderId);
  if (!downloaderConfig.id) return null;

  const configKey = getDownloaderConfigKey(downloaderConfig);
  const cached = downloaderInstanceCache.get(downloaderId);
  if (cached && cached.configKey === configKey) {
    return cached.instance;
  }

  const instance = await getDownloader(downloaderConfig);
  downloaderInstanceCache.set(downloaderId, { configKey, instance });
  return instance;
}

onMessage("getDownloaderConfig", async ({ data: downloaderId }) => await getDownloaderConfig(downloaderId));

async function runClientOperation<T>(
  downloaderId: string,
  action: TClientOperation,
  operation: (downloader: NonNullable<DownloaderInstance>) => Promise<T>,
): Promise<IClientOperationResult<T>> {
  try {
    const downloaderInstance = await getDownloaderInstance(downloaderId);
    if (!downloaderInstance) {
      return {
        success: false,
        action,
        downloaderId,
        error: "下载器不存在、已停用或配置无效",
      };
    }
    return { success: true, action, downloaderId, data: await operation(downloaderInstance) };
  } catch (error) {
    return {
      success: false,
      action,
      downloaderId,
      error: sanitizeDownloadErrorMessage(error) || "下载器请求失败",
    };
  }
}

async function runClientBooleanOperation(
  downloaderId: string,
  action: Exclude<TClientOperation, "list" | "version" | "status">,
  operation: (downloader: NonNullable<DownloaderInstance>) => Promise<boolean>,
): Promise<IClientOperationResult> {
  const result = await runClientOperation(downloaderId, action, operation);
  if (!result.success || result.data) {
    return { success: result.success, action, downloaderId, error: result.error };
  }
  return { success: false, action, downloaderId, error: "下载器未确认该操作" };
}

onMessage("getDownloaderList", async () => {
  const metadata = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  const downloaders = metadata?.downloaders ?? {};
  return Object.entries(downloaders).map(([id, config]) => ({
    id,
    name: config.name ?? "",
    type: config.type ?? "",
    enabled: config.enabled ?? false,
    address: config.address ?? "",
  }));
});

onMessage("getDownloaderVersion", async ({ data: downloaderId }) => {
  return await runClientOperation(downloaderId, "version", (downloader) => downloader.getClientVersion());
});

onMessage("getDownloaderStatus", async ({ data: downloaderId }) => {
  return await runClientOperation(downloaderId, "status", (downloader) => downloader.getClientStatus());
});

onMessage("getDownloaderFreeSpace", async ({ data: downloaderId }) => {
  const downloaderInstance = await getDownloaderInstance(downloaderId);
  return downloaderInstance ? await downloaderInstance.getClientFreeSpace() : "N/A";
});

export async function getTorrentDownloadLink(torrent: ITorrent) {
  const site = await getSiteInstance<"public">(torrent.site);
  return await site.getTorrentDownloadLink(torrent);
}

onMessage("getTorrentDownloadLink", async ({ data: torrent }) => await getTorrentDownloadLink(torrent));

export async function getTorrentInfoForVerification(torrent: ITorrent) {
  const downloadUrl = await getTorrentDownloadLink(torrent);
  const siteInstance = await getSiteInstance<"public">(torrent.site);

  const downloadRequestConfig = await siteInstance.getTorrentDownloadRequestConfig(torrent);
  downloadRequestConfig.url = downloadUrl;
  downloadRequestConfig.responseType = "arraybuffer";

  const parsedTorrent = await getRemoteTorrentFile(downloadRequestConfig);

  return getParsedTorrentInfoForVerification(parsedTorrent);
}

onMessage("getTorrentInfoForVerification", async ({ data: torrent }) => await getTorrentInfoForVerification(torrent));

onMessage("getClientTorrents", async ({ data: downloaderId }) => {
  return await runClientOperation(downloaderId, "list", (downloader) => downloader.getAllTorrents());
});

onMessage("deleteClientTorrent", async ({ data: { downloaderId, id, removeData } }) => {
  return await runClientBooleanOperation(downloaderId, "delete", (downloader) =>
    downloader.removeTorrent(id, removeData ?? false),
  );
});

onMessage("pauseClientTorrent", async ({ data: { downloaderId, id } }) => {
  return await runClientBooleanOperation(downloaderId, "pause", (downloader) => downloader.pauseTorrent(id));
});

onMessage("resumeClientTorrent", async ({ data: { downloaderId, id } }) => {
  return await runClientBooleanOperation(downloaderId, "resume", (downloader) => downloader.resumeTorrent(id));
});

function buildDownloadHistory(downloadOption: IDownloadTorrentOption): ITorrentDownloadMetadata {
  const { torrent = {}, downloaderId = "local" } = downloadOption;
  return {
    ...downloadOption,
    siteId: torrent.site ?? "unknown",
    torrentId: torrent.id ?? "unknown",
    downloaderId,
    title: torrent.title ?? "unknown",
    subTitle: torrent.subTitle,
    url: torrent.url,
    link: torrent.link,
    downloadAt: +Date.now(),
    downloadStatus: "pending",
  } as ITorrentDownloadMetadata;
}

onMessage("createDownloadHistory", async ({ data }) => await setDownloadHistory(buildDownloadHistory(data)));

const lastSiteDownloadAt = new Map<string, number>();

async function isAllowedSaveDownloadHistory(): Promise<boolean> {
  const configStoreRaw = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;
  return configStoreRaw?.download?.saveDownloadHistory ?? true;
}

async function downloadTorrent(downloadOption: IDownloadTorrentOption) {
  const configStoreRaw = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;

  // 0. 解析传来的下载参数
  const { torrent, downloaderId = "local", addTorrentOptions = {} as CAddTorrentOptions } = downloadOption;
  const isDownloadToLocalFile: boolean = downloaderId === "local"; // 如果前端没有传入下载器的id，则认为下载为本地文件

  // 1. 生成下载历史
  let downloadId = downloadOption.downloadId!;
  if (typeof downloadOption.downloadId === "undefined") {
    const downloadHistory = buildDownloadHistory(downloadOption);
    downloadOption.downloadId = downloadId = await setDownloadHistory(downloadHistory);
  }
  logger({ msg: `generate download torrent task #${downloadOption.downloadId}`, data: downloadOption });
  let downloadStatus = await setDownloadStatus(downloadId!, "pending");
  let errorMessage: string | undefined;

  // 2. 构建下载链接的请求配置
  let downloadRequestConfig: AxiosRequestConfig = { url: torrent.link, method: "GET", timeout: 30e3 };
  let siteInstance: Awaited<ReturnType<typeof getSiteInstance<"public">>> | null = null;

  if (torrent.site) {
    // 生成站点，并检查站点下载间隔，如果触及到站点下载间隔，则将下载任务放入到 alarms 中等待
    siteInstance = await getSiteInstance<"public">(torrent.site);

    if (
      siteInstance.downloadInterval > 0 &&
      // 允许本地下载时忽略站点设置中的下载间隔
      !(isDownloadToLocalFile && configStoreRaw?.download?.ignoreSiteDownloadIntervalWhenLocalDownload)
    ) {
      const leftInterval =
        siteInstance.downloadInterval * 1000 - (new Date().getTime() - (lastSiteDownloadAt.get(torrent.site) ?? 0));

      if (leftInterval > 0) {
        logger({ msg: `Site ${torrent.site} download interval not reached, waiting...` });
        await sendMessage("reDownloadTorrent", { ...downloadOption, downloadId, leftInterval });
        return {
          downloadId,
          downloadStatus: await setDownloadStatus(downloadId, "pending"),
        } as IDownloadTorrentResult;
      }

      lastSiteDownloadAt.set(torrent.site, new Date().getTime());
    }

    // 添加站点配置的上传速度限制
    if (!isDownloadToLocalFile && (siteInstance.userConfig?.uploadSpeedLimit ?? 0) > 0) {
      addTorrentOptions.uploadSpeedLimit = siteInstance.userConfig.uploadSpeedLimit;
    }

    downloadRequestConfig = toMerged(
      downloadRequestConfig,
      await siteInstance.getTorrentDownloadRequestConfig(torrent as ITorrent),
    );
  }
  await patchDownloadHistory(downloadId!, { downloadRequestConfig }).catch(); // 存储下载请求配置，方便后续调试

  try {
    downloadStatus = await setDownloadStatus(downloadId, "downloading");
    if (isDownloadToLocalFile) {
      // 本地下载
      downloadOption.localDownloadMethod ??= configStoreRaw?.download?.localDownloadMethod ?? "web";
      downloadStatus = await downloadTorrentToLocalFile(downloadOption as TLocalDownloadOption, downloadRequestConfig);
    } else {
      // 远程推送
      addTorrentOptions.localDownload ??= true; // 默认开启本地中转选项（如果传递进来的没有 localDownload 值的话）
      if (!(configStoreRaw?.download?.allowDirectSendToClient ?? false)) {
        addTorrentOptions.localDownload = true; // 如果不允许直接发送到下载器，则将本地中转选项强行设置为 true
      }
      downloadOption.addTorrentOptions = addTorrentOptions;
      const remoteResult = await downloadTorrentToRemote(
        downloadOption as TRemoteDownloadOption,
        downloadRequestConfig,
      );
      downloadStatus = remoteResult.downloadStatus;
      errorMessage = remoteResult.errorMessage;
    }
  } catch (e) {
    downloadStatus = "failed";
    errorMessage = getErrorMessage(e);
  }

  // PTPP v1 retried failed remote pushes. In MV3 the wait must not live in
  // this offscreen document, so persist the next attempt through the
  // service-worker alarm coordinator instead of setTimeout/sleep.
  if (
    !isDownloadToLocalFile &&
    downloadStatus === "failed" &&
    (configStoreRaw?.download?.downloadFailedRetry ?? false)
  ) {
    const retryIndex = Math.max(0, downloadOption.retryIndex ?? 0);
    const retryMax = Math.max(0, Number(configStoreRaw.download.downloadFailedFailedRetryCount ?? 0));
    if (retryIndex < retryMax) {
      const retryIntervalSeconds = Math.max(0, Number(configStoreRaw.download.downloadFailedFailedRetryInterval ?? 0));
      logger({
        msg: `Download task #${downloadId} failed; scheduling retry #${retryIndex + 1}/${retryMax}.`,
      });
      await sendMessage("reDownloadTorrent", {
        ...downloadOption,
        downloadId,
        retryIndex: retryIndex + 1,
        leftInterval: retryIntervalSeconds * 1000,
      });
      downloadStatus = "pending";
    }
  }

  await patchDownloadHistory(downloadId, {
    downloadStatus,
    errorMessage: errorMessage ? sanitizeDownloadErrorMessage(errorMessage) : undefined,
  }).catch();
  return { downloadId, downloadStatus, errorMessage } as IDownloadTorrentResult;
}

onMessage("downloadTorrent", async ({ data: downloadOption }) => await downloadTorrent(downloadOption));

async function downloadTorrentToLocalFile(
  downloadOption: TLocalDownloadOption,
  downloadRequestConfig: AxiosRequestConfig,
): Promise<TTorrentDownloadStatus> {
  let { torrent, localDownloadMethod = "web", downloadId } = downloadOption;
  let downloadStatus: TTorrentDownloadStatus = "downloading";

  const downloadUri = axios.getUri(downloadRequestConfig); // 组装 baseURL, url, params
  const {
    method: downloadMethod = "GET",
    data: downloadData = {},
    headers: downloadHeaders = {} as Record<string, string>,
  } = downloadRequestConfig;

  // 如果设置为 web 方法，且没有 headers 的情况，直接使用 window.open 方法
  if (localDownloadMethod === "web") {
    if (downloadMethod.toUpperCase() === "GET" && isEmpty(downloadHeaders)) {
      logger({ msg: `Download torrent file with web method: ${downloadUri}` });
      window.open(downloadUri, "_blank");
      return await setDownloadStatus(downloadId, "completed");
    } else {
      localDownloadMethod = "extension"; // 如果是不能直接使用 window.open 方法的情况，直接使用 extension 方法
    }
  }

  // 如果设置为 extension，直接使用 chrome.downloads 方法
  if (localDownloadMethod === "browser" && ["GET", "POST"].includes(downloadMethod.toUpperCase())) {
    try {
      // 将 AxiosRequestConfig 转换为 chrome.downloads.DownloadOptions， 我们在这里只考虑 method, body, headers
      const downloadOptions: chrome.downloads.DownloadOptions = {
        url: downloadUri,
        conflictAction: "uniquify",
        method: downloadMethod.toUpperCase() as "GET" | "POST",
      };

      if (downloadMethod.toUpperCase() === "POST" && !isEmpty(downloadData ?? {})) {
        downloadOptions.body = stringify(downloadData);
      }

      if (!isEmpty(downloadHeaders)) {
        downloadOptions.headers = Object.entries(downloadHeaders).map(([name, value]) => ({ name, value }));
      }

      logger({ msg: `Download torrent file with browser method: ${downloadUri}`, data: downloadOptions });
      await sendMessage("downloadFile", downloadOptions);
      return await setDownloadStatus(downloadId, "completed");
    } catch (e) {
      localDownloadMethod = "extension"; // 如果下载失败，直接使用 extension 方法（怎么可能？）
    }
  } else {
    localDownloadMethod = "extension"; // 如果还是不能使用的情况（怎么可能？），则直接使用 extension 方法
  }

  // 如果设置为 extension，其次考虑使用 getRemoteTorrentFile 转为 Blob 再调用 chrome.downloads
  if (localDownloadMethod === "extension") {
    try {
      logger({ msg: `Download torrent file with extension method: ${downloadUri}`, data: downloadRequestConfig });

      const torrentInstance = await getRemoteTorrentFile(downloadRequestConfig);
      const torrentUrl = URL.createObjectURL(torrentInstance.metadata.blob());
      let filename = torrentInstance.name;
      if (filename === "1.torrent") {
        // 如果文件名是缺省的 1.torrent，那么使用种子属性中的站点名和标题作为文件名
        filename = `[${torrent.site}] ${torrent.title}.torrent`;
      }

      await sendMessage("downloadFile", { url: torrentUrl, filename, conflictAction: "uniquify" });
      downloadStatus = await setDownloadStatus(downloadId, "completed");
      URL.revokeObjectURL(torrentUrl);
    } catch (e) {
      downloadStatus = await setDownloadStatus(downloadId, "failed");
    }
  }

  return downloadStatus;
}

async function downloadTorrentToRemote(
  downloadOption: TRemoteDownloadOption,
  downloadRequestConfig: AxiosRequestConfig,
): Promise<Pick<IDownloadTorrentResult, "downloadStatus" | "errorMessage">> {
  const { torrent, downloaderId, addTorrentOptions, downloadId } = downloadOption;
  let downloadStatus: TTorrentDownloadStatus = "failed"; // 远程推送默认失败状态
  let errorMessage: string | undefined;

  const downloaderConfig = await getDownloaderConfig(downloaderId);
  if (downloaderConfig.id && downloaderConfig.enabled) {
    const downloaderInstance = await getDownloaderInstance(downloaderId);
    if (!downloaderInstance) {
      return { downloadStatus, errorMessage: `Downloader not found: ${downloaderId}` };
    }
    if (addTorrentOptions.localDownload) {
      addTorrentOptions.localDownloadOption = downloadRequestConfig;
    }

    const loggerData = { torrent, downloaderId, downloadRequestConfig, addTorrentOptions } as Record<string, any>;
    try {
      logger({ msg: "downloadTorrentToDownloader", data: loggerData });
      const addTorrentResult = await downloaderInstance.addTorrent(downloadRequestConfig.url!, addTorrentOptions);
      loggerData.addTorrentResult = addTorrentResult;
      if (addTorrentResult?.success === true) {
        logger({ msg: "Successfully added torrent to downloader", data: loggerData });
        downloadStatus = "completed";
      } else {
        logger({ msg: "Failed to add torrent to downloader", data: loggerData });
        errorMessage = getErrorMessage(addTorrentResult?.message || "Downloader rejected the torrent");
      }
      patchDownloadHistory(downloadId, { addTorrentResult }).catch(); // 存储添加种子结果，方便后续调试
    } catch (e) {
      logger({ msg: "Error adding torrent to downloader", data: loggerData });
      errorMessage = getErrorMessage(e);
    }
  } else {
    errorMessage = `Downloader is missing or disabled: ${downloaderId}`;
  }

  return { downloadStatus, errorMessage };
}

function getErrorMessage(error: unknown): string {
  return sanitizeDownloadErrorMessage(error);
}

export async function getDownloadHistory() {
  return await (await ptdIndexDb).getAll("download_history");
}

onMessage("getDownloadHistory", getDownloadHistory);

export async function getDownloadHistoryById(downloadId: TTorrentDownloadKey) {
  return await (await ptdIndexDb).get("download_history", downloadId);
}

onMessage("getDownloadHistoryById", async ({ data: downloadId }) => (await getDownloadHistoryById(downloadId))!);

export async function setDownloadHistory(data: ITorrentDownloadMetadata) {
  const allowedSave = await isAllowedSaveDownloadHistory();
  return allowedSave ? await (await ptdIndexDb).put("download_history", toPlainSerializable(data)) : 0;
}

export async function patchDownloadHistory(downloadId: TTorrentDownloadKey, data: Partial<ITorrentDownloadMetadata>) {
  const allowedSave = await isAllowedSaveDownloadHistory();
  const downloadHistory = await getDownloadHistoryById(downloadId);
  if (allowedSave && downloadHistory) {
    await setDownloadHistory({ ...downloadHistory, ...data });
  }
}

async function setDownloadStatus(
  downloadId: TTorrentDownloadKey,
  downloadStatus: TTorrentDownloadStatus,
): Promise<TTorrentDownloadStatus> {
  await patchDownloadHistory(downloadId, { downloadStatus }).catch();
  return downloadStatus;
}

export async function deleteDownloadHistoryById(downloadId: TTorrentDownloadKey) {
  return await (await ptdIndexDb).delete("download_history", downloadId);
}

onMessage("deleteDownloadHistoryById", async ({ data: downloadId }) => await deleteDownloadHistoryById(downloadId));

export async function clearDownloadHistory() {
  return await (await ptdIndexDb).clear("download_history");
}

onMessage("clearDownloadHistory", clearDownloadHistory);
