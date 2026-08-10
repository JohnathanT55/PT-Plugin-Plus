import { resolveDownloadPolicy, type DownloadPolicyResolution, type DownloadPolicyTarget } from "./downloadPolicy";
import { AppSettings, Dictionary, DownloadTarget, DownloaderRecord, SiteDownloadProfile } from "./schema";

export type DownloadTargetSource = DownloadPolicyResolution["source"];

export interface DownloadTargetResolution {
  downloaderId?: string;
  target: DownloadTarget;
  source: DownloadTargetSource;
  requiresSelection: boolean;
}

function toPolicyTarget(target?: DownloadTarget): DownloadPolicyTarget {
  return target ?? { directories: [], tags: [] };
}

export function resolveDownloadTarget(
  siteId: string | undefined,
  requestedDownloaderId: string | undefined,
  profiles: Dictionary<SiteDownloadProfile>,
  downloaders: Dictionary<DownloaderRecord>,
  settings: AppSettings,
): DownloadTargetResolution {
  const resolution = resolveDownloadPolicy({
    siteId,
    requestedDownloaderId,
    profile: siteId ? profiles[siteId] : undefined,
    downloaders: Object.fromEntries(
      Object.entries(downloaders).map(([downloaderId, downloader]) => [
        downloaderId,
        {
          available: downloader.enabled,
          defaultTarget: toPolicyTarget(downloader.defaultTarget),
          autoStart: downloader.defaultTarget.autoStart,
        },
      ]),
    ),
    globalDefault: {
      downloaderId: settings.defaultDownloaderId,
      target: toPolicyTarget(settings.globalDownloadTarget),
    },
  });

  return {
    downloaderId: resolution.downloaderId,
    target: {
      directories: resolution.directoryCandidates,
      tags: resolution.tagCandidates,
      defaultDirectory: resolution.directory || undefined,
      defaultTag: resolution.tag || undefined,
      autoStart: resolution.autoStart,
    },
    source: resolution.source,
    requiresSelection: resolution.requiresSelection,
  };
}
