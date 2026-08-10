import {
  AppSettings,
  Dictionary,
  DownloadTarget,
  DownloaderRecord,
  SiteDownloadProfile
} from "./schema";

export type DownloadTargetSource =
  | "site-profile"
  | "downloader-default"
  | "global-default"
  | "selection-required";

export interface DownloadTargetResolution {
  downloaderId?: string;
  target: DownloadTarget;
  source: DownloadTargetSource;
  requiresSelection: boolean;
}

function hasTarget(target?: DownloadTarget): target is DownloadTarget {
  return !!target && (target.directories.length > 0 || target.tags.length > 0);
}

function requiresSelection(
  target: DownloadTarget,
  downloaderAvailable: boolean
): boolean {
  return (
    !downloaderAvailable ||
    (target.directories.length > 1 &&
      (!target.defaultDirectory ||
        target.directories.indexOf(target.defaultDirectory) === -1))
  );
}

function selectedDownloaderId(
  requestedDownloaderId: string | undefined,
  profile: SiteDownloadProfile | undefined,
  settings: AppSettings
): string | undefined {
  return (
    requestedDownloaderId ||
    (profile && profile.defaultDownloaderId) ||
    settings.defaultDownloaderId
  );
}

export function resolveDownloadTarget(
  siteId: string | undefined,
  requestedDownloaderId: string | undefined,
  profiles: Dictionary<SiteDownloadProfile>,
  downloaders: Dictionary<DownloaderRecord>,
  settings: AppSettings
): DownloadTargetResolution {
  const profile = siteId ? profiles[siteId] : undefined;
  const downloaderId = selectedDownloaderId(
    requestedDownloaderId,
    profile,
    settings
  );
  const downloaderAvailable = !!downloaderId && !!downloaders[downloaderId];
  const siteTarget =
    profile && downloaderId ? profile.byDownloader[downloaderId] : undefined;

  if (hasTarget(siteTarget)) {
    return {
      downloaderId,
      target: siteTarget,
      source: "site-profile",
      requiresSelection: requiresSelection(siteTarget, downloaderAvailable)
    };
  }

  const downloader = downloaderId ? downloaders[downloaderId] : undefined;
  if (downloader && hasTarget(downloader.defaultTarget)) {
    return {
      downloaderId,
      target: downloader.defaultTarget,
      source: "downloader-default",
      requiresSelection: requiresSelection(downloader.defaultTarget, true)
    };
  }

  if (hasTarget(settings.globalDownloadTarget)) {
    return {
      downloaderId,
      target: settings.globalDownloadTarget,
      source: "global-default",
      requiresSelection: requiresSelection(
        settings.globalDownloadTarget,
        downloaderAvailable
      )
    };
  }

  return {
    downloaderId,
    target: { directories: [], tags: [] },
    source: "selection-required",
    requiresSelection: true
  };
}
