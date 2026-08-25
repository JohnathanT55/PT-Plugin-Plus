import type { IDurableTaskStore } from "@foundation/tasks/durable";
import type { IDownloadTorrentOption, TTorrentDownloadKey } from "./download.ts";
import type { TBackupTrigger } from "../storages/metadata.ts";

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

export interface IDurableBackupRetryTaskPayload {
  type: "backupRetry";
  serverId: string;
  trigger: Exclude<TBackupTrigger, "manual">;
  retryIndex: number;
}

export interface IDurableBackupCleanupTaskPayload {
  type: "backupCleanup";
  serverId: string;
  runId: string;
}

export type TDurableTaskPayload =
  | IDurableDownloadTaskPayload
  | IDurableUserInfoRetryTaskPayload
  | IDurableDownloadBatchTaskPayload
  | IDurableBackupRetryTaskPayload
  | IDurableBackupCleanupTaskPayload;
export type TDurableTaskStorageSchema = IDurableTaskStore<TDurableTaskPayload>;
