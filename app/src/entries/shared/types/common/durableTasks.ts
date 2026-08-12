import type { IDurableTaskStore } from "@foundation/tasks/durable";
import type { IDownloadTorrentOption, TTorrentDownloadKey } from "./download.ts";

export interface IDurableDownloadTaskPayload {
  type: "download";
  downloadId: TTorrentDownloadKey;
  downloadOption: IDownloadTorrentOption;
}

export interface IDurableUserInfoRetryTaskPayload {
  type: "userInfoRetry";
  retryIndex: number;
}

export interface IDurableDownloadBatchTaskPayload {
  type: "downloadBatch";
  batchId: string;
}

export type TDurableTaskPayload =
  IDurableDownloadTaskPayload | IDurableUserInfoRetryTaskPayload | IDurableDownloadBatchTaskPayload;
export type TDurableTaskStorageSchema = IDurableTaskStore<TDurableTaskPayload>;
