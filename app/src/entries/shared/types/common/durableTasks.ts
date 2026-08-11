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

export type TDurableTaskPayload = IDurableDownloadTaskPayload | IDurableUserInfoRetryTaskPayload;
export type TDurableTaskStorageSchema = IDurableTaskStore<TDurableTaskPayload>;
