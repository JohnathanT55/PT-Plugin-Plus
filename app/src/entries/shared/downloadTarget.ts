import type { IDownloaderMetadata, IMetadataPiniaStorageSchema, ISiteDownloadTarget, TDownloaderKey } from "./types.ts";

export type DownloadTargetSource = "site-profile" | "global-default" | "downloader-default" | "selection-required";

export interface ResolvedSiteDownloadTarget {
  siteId?: string;
  downloaderId?: TDownloaderKey;
  downloader?: IDownloaderMetadata;
  savePath: string;
  label: string;
  directoryCandidates: string[];
  tagCandidates: string[];
  autoStart: boolean;
  source: DownloadTargetSource;
  requiresSelection: boolean;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function resolvedFromTarget(
  siteId: string | undefined,
  downloaderId: string | undefined,
  downloader: IDownloaderMetadata | undefined,
  target: ISiteDownloadTarget,
  source: DownloadTargetSource,
): ResolvedSiteDownloadTarget {
  const directoryCandidates = unique(target.directories);
  const tagCandidates = unique(target.tags);
  const savePath =
    target.defaultDirectory && directoryCandidates.includes(target.defaultDirectory)
      ? target.defaultDirectory
      : directoryCandidates.length === 1
        ? directoryCandidates[0]
        : "";
  const label =
    target.defaultTag && tagCandidates.includes(target.defaultTag)
      ? target.defaultTag
      : tagCandidates.length === 1
        ? tagCandidates[0]
        : "";

  return {
    siteId,
    downloaderId,
    downloader,
    savePath,
    label,
    directoryCandidates,
    tagCandidates,
    autoStart: target.autoStart ?? downloader?.feature?.DefaultAutoStart ?? true,
    source,
    requiresSelection:
      !downloader ||
      !downloader.enabled ||
      (directoryCandidates.length > 1 && savePath === "") ||
      (tagCandidates.length > 1 && label === ""),
  };
}

export function resolveSiteDownloadTarget(
  metadata: Pick<IMetadataPiniaStorageSchema, "defaultDownloader" | "downloaders" | "siteDownloadProfiles">,
  siteId?: string,
  requestedDownloaderId?: TDownloaderKey,
): ResolvedSiteDownloadTarget {
  const profile = siteId ? metadata.siteDownloadProfiles?.[siteId] : undefined;
  const downloaderId = requestedDownloaderId || profile?.defaultDownloaderId || metadata.defaultDownloader?.id;
  const downloader = downloaderId ? metadata.downloaders[downloaderId] : undefined;
  const siteTarget = downloaderId ? profile?.byDownloader?.[downloaderId] : undefined;

  if (siteTarget) {
    return resolvedFromTarget(siteId, downloaderId, downloader, siteTarget, "site-profile");
  }

  if (downloaderId && downloaderId === metadata.defaultDownloader?.id) {
    return resolvedFromTarget(
      siteId,
      downloaderId,
      downloader,
      {
        directories: unique([metadata.defaultDownloader.folder]),
        tags: unique([metadata.defaultDownloader.tags]),
        defaultDirectory: metadata.defaultDownloader.folder || undefined,
        defaultTag: metadata.defaultDownloader.tags || undefined,
      },
      "global-default",
    );
  }

  if (downloader) {
    return resolvedFromTarget(
      siteId,
      downloaderId,
      downloader,
      {
        directories: [],
        tags: [],
      },
      "downloader-default",
    );
  }

  return {
    siteId,
    downloaderId,
    downloader,
    savePath: "",
    label: "",
    directoryCandidates: [],
    tagCandidates: [],
    autoStart: true,
    source: "selection-required",
    requiresSelection: true,
  };
}

export function canDirectSendToSite(
  metadata: Pick<IMetadataPiniaStorageSchema, "defaultDownloader" | "downloaders" | "siteDownloadProfiles">,
  siteId?: string,
): boolean {
  return !resolveSiteDownloadTarget(metadata, siteId).requiresSelection;
}
