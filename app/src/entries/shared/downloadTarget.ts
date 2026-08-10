import type { IDownloaderMetadata, IMetadataPiniaStorageSchema, ISiteDownloadTarget, TDownloaderKey } from "./types.ts";
import {
  hasSiteDirectoryBinding,
  normalizeDownloadPolicyTarget,
  resolveDownloadPolicy,
  type DownloadPolicyInput,
  type DownloadPolicyReason,
  type DownloadPolicySource,
} from "@foundation/model/downloadPolicy.ts";

export type DownloadTargetSource = DownloadPolicySource;
export type DownloadTargetReason = DownloadPolicyReason;

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
  reason: DownloadTargetReason;
  requiresSelection: boolean;
}

export interface DownloadMenuTarget {
  kind: "site" | "general";
  downloaderId: TDownloaderKey;
  downloader: IDownloaderMetadata;
  savePath: string;
  label: string;
  autoStart: boolean;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

export function normalizeSiteDownloadTarget(target?: ISiteDownloadTarget): ISiteDownloadTarget {
  const normalized = normalizeDownloadPolicyTarget(target);
  return {
    directories: normalized.directories,
    tags: normalized.tags,
    ...(normalized.defaultDirectory ? { defaultDirectory: normalized.defaultDirectory } : {}),
    ...(normalized.defaultTag ? { defaultTag: normalized.defaultTag } : {}),
    ...(normalized.autoStart !== undefined ? { autoStart: normalized.autoStart } : {}),
  };
}

export function hasSiteDownloadDirectoryBinding(target?: ISiteDownloadTarget): target is ISiteDownloadTarget {
  return hasSiteDirectoryBinding(target);
}

/** Whether a site has visible directory/tag data for the download-path editor. */
export function hasConfiguredSiteDownloadTarget(target?: ISiteDownloadTarget): boolean {
  return (
    unique([target?.defaultDirectory, ...(target?.directories ?? [])]).length > 0 ||
    unique([target?.defaultTag, ...(target?.tags ?? [])]).length > 0
  );
}

function hasBoundDirectory(target?: ISiteDownloadTarget): target is ISiteDownloadTarget {
  return hasSiteDownloadDirectoryBinding(target);
}

function isDownloaderAvailable(downloader: IDownloaderMetadata | undefined, siteId?: string): boolean {
  return Boolean(downloader?.enabled && (!siteId || !(downloader.excludedSites ?? []).includes(siteId)));
}

function toPolicyInput(
  metadata: Pick<IMetadataPiniaStorageSchema, "defaultDownloader" | "downloaders" | "siteDownloadProfiles">,
  siteId?: string,
  requestedDownloaderId?: TDownloaderKey,
): DownloadPolicyInput {
  return {
    siteId,
    requestedDownloaderId,
    profile: siteId ? metadata.siteDownloadProfiles?.[siteId] : undefined,
    downloaders: Object.fromEntries(
      Object.entries(metadata.downloaders).map(([downloaderId, downloader]) => [
        downloaderId,
        {
          available: isDownloaderAvailable(downloader, siteId),
          // PTD suggestions are candidates, not a default. Without an exact
          // global or site folder the downloader's normal target is its root.
          defaultTarget: {},
          autoStart: downloader.feature?.DefaultAutoStart ?? true,
        },
      ]),
    ),
    globalDefault: {
      downloaderId: metadata.defaultDownloader?.id,
      target: {
        directories: unique([metadata.defaultDownloader?.folder]),
        tags: unique([metadata.defaultDownloader?.tags]),
        defaultDirectory: metadata.defaultDownloader?.folder?.trim() || undefined,
        defaultTag: metadata.defaultDownloader?.tags?.trim() || undefined,
      },
    },
  };
}

export function resolveSiteDownloadTarget(
  metadata: Pick<IMetadataPiniaStorageSchema, "defaultDownloader" | "downloaders" | "siteDownloadProfiles">,
  siteId?: string,
  requestedDownloaderId?: TDownloaderKey,
): ResolvedSiteDownloadTarget {
  const resolution = resolveDownloadPolicy(toPolicyInput(metadata, siteId, requestedDownloaderId));
  const downloaderId = resolution.downloaderId as TDownloaderKey | undefined;
  return {
    siteId: resolution.siteId,
    downloaderId,
    downloader: downloaderId ? metadata.downloaders[downloaderId] : undefined,
    savePath: resolution.directory,
    label: resolution.tag,
    directoryCandidates: resolution.directoryCandidates,
    tagCandidates: resolution.tagCandidates,
    autoStart: resolution.autoStart,
    source: resolution.source,
    reason: resolution.reason,
    requiresSelection: resolution.requiresSelection,
  };
}

export function canDirectSendToSite(
  metadata: Pick<IMetadataPiniaStorageSchema, "defaultDownloader" | "downloaders" | "siteDownloadProfiles">,
  siteId?: string,
): boolean {
  return !resolveSiteDownloadTarget(metadata, siteId).requiresSelection;
}

export function buildSiteDownloadMenuTargets(
  metadata: Pick<IMetadataPiniaStorageSchema, "defaultDownloader" | "downloaders" | "siteDownloadProfiles">,
  siteId?: string,
): DownloadMenuTarget[] {
  const profile = siteId ? metadata.siteDownloadProfiles?.[siteId] : undefined;
  const downloaders = Object.values(metadata.downloaders)
    .filter((downloader) => downloader.enabled && (!siteId || !(downloader.excludedSites ?? []).includes(siteId)))
    .sort((a, b) => (b.sortIndex ?? 0) - (a.sortIndex ?? 0));
  const siteTargets: DownloadMenuTarget[] = [];
  const generalTargets: DownloadMenuTarget[] = [];

  for (const downloader of downloaders) {
    const siteTarget = profile?.byDownloader?.[downloader.id];
    if (hasBoundDirectory(siteTarget)) {
      const folders = unique([siteTarget.defaultDirectory, ...siteTarget.directories]);
      const tags = unique([siteTarget.defaultTag, ...siteTarget.tags]);
      const resolvedTag = siteTarget.defaultTag?.trim() || (tags.length === 1 ? tags[0] : "");
      // Keep the tuple used by one-click download first, then expose an
      // explicit no-tag choice and every remaining candidate. This preserves
      // PTPP's direct menu while retaining PTD's optional tag capability.
      const tagChoices = [resolvedTag, "", ...tags.filter((tag) => tag !== resolvedTag)].filter(
        (tag, index, values) => values.indexOf(tag) === index,
      );
      for (const savePath of folders) {
        for (const label of tagChoices) {
          siteTargets.push({
            kind: "site",
            downloaderId: downloader.id,
            downloader,
            savePath,
            label,
            autoStart: siteTarget.autoStart ?? downloader.feature?.DefaultAutoStart ?? true,
          });
        }
      }
    }

    // The global default folder/tag is stored separately from the downloader's
    // suggestions. Keep it available as an explicit one-off override even when
    // the user never added it to suggestFolders/suggestTags.
    if (metadata.defaultDownloader?.id === downloader.id) {
      generalTargets.push({
        kind: "general",
        downloaderId: downloader.id,
        downloader,
        savePath: metadata.defaultDownloader.folder?.trim() ?? "",
        label: metadata.defaultDownloader.tags?.trim() ?? "",
        autoStart: downloader.feature?.DefaultAutoStart ?? true,
      });
    }

    const generalTags = ["", ...unique(downloader.suggestTags ?? [])];
    for (const savePath of ["", ...unique(downloader.suggestFolders ?? [])]) {
      for (const label of generalTags) {
        generalTargets.push({
          kind: "general",
          downloaderId: downloader.id,
          downloader,
          savePath,
          label,
          autoStart: downloader.feature?.DefaultAutoStart ?? true,
        });
      }
    }
  }

  const seen = new Set<string>();
  return [...siteTargets, ...generalTargets].filter((target) => {
    const key = [target.downloaderId, target.savePath, target.label].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
