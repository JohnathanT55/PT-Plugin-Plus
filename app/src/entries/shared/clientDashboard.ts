import type { IDownloaderMetadata, IClientOperationResult, TClientOperation } from "./types.ts";
import { sanitizeDownloadErrorMessage } from "./downloadError.ts";

export const SUPPORTED_CLIENT_DOWNLOADER_TYPES = ["qBittorrent", "Transmission"] as const;
const supportedClientDownloaderTypes = new Set<string>(SUPPORTED_CLIENT_DOWNLOADER_TYPES);

export function isSupportedClientDownloader(
  downloader: Pick<IDownloaderMetadata, "enabled" | "type"> | undefined,
): downloader is Pick<IDownloaderMetadata, "enabled" | "type"> & { type: "qBittorrent" | "Transmission" } {
  return Boolean(downloader?.enabled && supportedClientDownloaderTypes.has(downloader.type));
}

export function filterSupportedClientDownloaders<T extends Pick<IDownloaderMetadata, "enabled" | "type">>(
  downloaders: T[],
): T[] {
  return downloaders.filter(isSupportedClientDownloader);
}

export function normalizeClientRefreshInterval(value: unknown): number {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return 30;
  return Math.min(3600, Math.max(5, Math.round(interval)));
}

export interface IClientOperationDownloaderSummary {
  downloaderId: string;
  successCount: number;
  failedCount: number;
  errors: string[];
}

export interface IClientOperationSummary {
  action: TClientOperation;
  successCount: number;
  failedCount: number;
  downloaders: IClientOperationDownloaderSummary[];
}

export function summarizeClientOperationResults(
  action: TClientOperation,
  results: IClientOperationResult<unknown>[],
): IClientOperationSummary {
  const byDownloader = new Map<string, IClientOperationDownloaderSummary>();
  let successCount = 0;
  let failedCount = 0;

  for (const result of results) {
    const summary = byDownloader.get(result.downloaderId) ?? {
      downloaderId: result.downloaderId,
      successCount: 0,
      failedCount: 0,
      errors: [],
    };
    if (result.success) {
      successCount += 1;
      summary.successCount += 1;
    } else {
      failedCount += 1;
      summary.failedCount += 1;
      const error = sanitizeDownloadErrorMessage(result.error || "");
      if (error && !summary.errors.includes(error)) summary.errors.push(error);
    }
    byDownloader.set(result.downloaderId, summary);
  }

  return { action, successCount, failedCount, downloaders: [...byDownloader.values()] };
}
