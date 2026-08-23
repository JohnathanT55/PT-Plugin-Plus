import type { AxiosRequestConfig } from "axios";

import type { ITorrent, TSiteID as TSiteKey } from "@ptd/site";
import type { CAddTorrentOptions, CAddTorrentResult, CTorrent, TorrentClientStatus } from "@ptd/downloader";
import type { TDownloaderKey } from "@/shared/types/storages/metadata.ts";

export type TTorrentDownloadKey = number;
export type TTorrentDownloadStatus = "pending" | "downloading" | "completed" | "failed";

export const LocalDownloadMethod = [
  "web", // 和PTPP一样打开对应种子下载的链接页面，然后由浏览器自动拉起下载过程，只有 method='get' 的种子才能支持，其他情况会回落到 extension
  "browser", // （默认）由插件直接调用 chrome.downloads.download() 方法，支持 post, data, headers 参数（够用了），此时 filename 由浏览器自动猜测
  "extension", // （回落）插件调用 axios.requests() 方法，获取并解析种子，生成 Blob 后交由 chrome.downloads.download ，此时 filename 由插件直接控制，可能会出现错误，同时支持 axios 的高级参数
] as const;

export type TLocalDownloadMethod = (typeof LocalDownloadMethod)[number];

export const DownloadSizeUnits = ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB"] as const;
export type TDownloadSizeUnit = (typeof DownloadSizeUnits)[number];

export interface IDownloadTorrentOption {
  downloadId?: TTorrentDownloadKey;
  torrent: Partial<ITorrent>;
  downloaderId:
    | string // 下载到对应id的下载器中
    | "local"; // （默认）下载为本地文件

  // 是否忽略种子对应站点的下载
  ignoreSiteDownloadInterval?: boolean;

  // 剩余等待时间(估算)
  leftInterval?: number;

  // 当使用下载为本地文件时，可用下面配置项
  localDownloadMethod?: TLocalDownloadMethod; // 不存在时回落到 configStoreRaw?.download?.localDownloadMethod ?? "web"

  // 当下载到对应id的下载器中时
  addTorrentOptions?: CAddTorrentOptions;

  // Internal MV3 scheduling state. These fields are deliberately excluded
  // from backup UI and only travel with a pending download task.
  retryIndex?: number;
  backgroundBatchId?: string;
}

export interface IQueueDownloadBatchRequest {
  items: IDownloadTorrentOption[];
  intervalSeconds: number;
}

export interface IQueueDownloadBatchResult {
  batchId: string;
  totalCount: number;
}

export interface IDownloadBatchItemResult {
  index: number;
  downloadId?: TTorrentDownloadKey;
  downloadStatus: TTorrentDownloadStatus;
  errorMessage?: string;
}

export interface IDownloadBatchRecord {
  id: string;
  createdAt: number;
  completedAt?: number;
  intervalSeconds: number;
  currentIndex: number;
  items: IDownloadTorrentOption[];
  results: Record<number, IDownloadBatchItemResult>;
  totalCount: number;
  successCount: number;
  failedCount: number;
  status: "pending" | "completed";
}

export interface IDownloadBatchStorageSchema {
  version: 1;
  batches: Record<string, IDownloadBatchRecord>;
}

export interface ITorrentDownloadMetadata extends Pick<ITorrent, "title" | "subTitle" | "url" | "link"> {
  id?: TTorrentDownloadKey; // 每个下载任务生成的唯一id
  siteId: TSiteKey; // 站点id
  torrentId: ITorrent["id"]; // 种子id
  downloaderId: TDownloaderKey | "local"; // 下载器id，注意 local 是一个特殊的关键词，表示本地下载
  downloadAt: number; // 下载时间
  downloadStatus: TTorrentDownloadStatus; // 下载状态
  torrent: ITorrent; // 种子信息
  addTorrentOptions: Partial<CAddTorrentOptions>;

  downloadRequestConfig?: AxiosRequestConfig;
  addTorrentResult?: CAddTorrentResult;
  errorMessage?: string;

  // Stable content key used to make legacy PTPP history imports idempotent.
  ptppMigrationKey?: string;
}

export interface IDownloadTorrentResult {
  downloadId: TTorrentDownloadKey;
  downloadStatus: TTorrentDownloadStatus;
  errorMessage?: string;
}

export type TClientOperation = "list" | "version" | "status" | "pause" | "resume" | "delete";

/**
 * Stable result envelope used by the My Downloader page. Downloader errors
 * must stay isolated to one client and are sanitized before crossing the
 * offscreen/options boundary.
 */
export interface IClientOperationResult<T = undefined> {
  success: boolean;
  action: TClientOperation;
  downloaderId: TDownloaderKey;
  data?: T;
  error?: string;
}

export type IClientTorrentListResult = IClientOperationResult<CTorrent[]>;
export type IClientVersionResult = IClientOperationResult<string>;
export type IClientStatusResult = IClientOperationResult<TorrentClientStatus>;
