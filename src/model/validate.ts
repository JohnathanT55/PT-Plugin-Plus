import {
  DownloadTarget,
  MV3_SCHEMA_VERSION,
  MV3State
} from "./schema";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  path: string;
}

function issue(
  issues: ValidationIssue[],
  severity: ValidationSeverity,
  code: string,
  path: string
) {
  issues.push({ severity, code, path });
}

function validateTarget(
  target: DownloadTarget,
  path: string,
  issues: ValidationIssue[]
) {
  if (!target || !Array.isArray(target.directories)) {
    issue(issues, "error", "invalid-download-directories", path + ".directories");
  }
  if (!target || !Array.isArray(target.tags)) {
    issue(issues, "error", "invalid-download-tags", path + ".tags");
  }
  if (
    target &&
    target.defaultDirectory &&
    Array.isArray(target.directories) &&
    target.directories.indexOf(target.defaultDirectory) === -1
  ) {
    issue(
      issues,
      "error",
      "default-directory-not-in-candidates",
      path + ".defaultDirectory"
    );
  }
}

function validateScheduler(value: any, path: string, issues: ValidationIssue[]) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.enabled !== "boolean" ||
    typeof value.intervalMinutes !== "number" ||
    !isFinite(value.intervalMinutes) ||
    value.intervalMinutes < 1
  ) {
    issue(issues, "error", "invalid-scheduler-settings", path);
  }
}

export function validateMV3State(state: MV3State): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const candidate = state as any;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    issue(issues, "error", "invalid-state-root", "state");
    return issues;
  }
  if (!candidate.metadata || typeof candidate.metadata !== "object") {
    issue(issues, "error", "missing-metadata", "metadata");
    return issues;
  }
  [
    "settings",
    "sites",
    "hostToSiteId",
    "downloaders",
    "siteDownloadProfiles",
    "backupServers",
    "userHistory",
    "collections",
    "uiOptions"
  ].forEach(field => {
    const value = candidate[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issue(issues, "error", "invalid-state-partition", field);
    }
  });
  [
    "downloadHistory",
    "searchSnapshots",
    "keepUploadTasks",
    "systemLogs"
  ].forEach(field => {
    if (!Array.isArray(candidate[field])) {
      issue(issues, "error", "invalid-state-partition", field);
    }
  });
  if (
    !candidate.collections ||
    !Array.isArray(candidate.collections.groups) ||
    !Array.isArray(candidate.collections.items)
  ) {
    issue(issues, "error", "invalid-collections-partition", "collections");
  }
  if (issues.some(item => item.severity === "error")) {
    return issues;
  }
  if (state.metadata.schemaVersion !== MV3_SCHEMA_VERSION) {
    issue(issues, "error", "schema-version-mismatch", "metadata.schemaVersion");
  }

  Object.keys(state.sites).forEach(siteId => {
    const site = state.sites[siteId];
    if (!site || typeof site !== "object" || !Array.isArray(site.hosts)) {
      issue(issues, "error", "invalid-site-record", "sites." + siteId);
      return;
    }
    if (site.siteId !== siteId) {
      issue(issues, "error", "site-key-mismatch", "sites." + siteId);
    }
    if (
      site.defaultDownloaderId &&
      (!state.siteDownloadProfiles[siteId] ||
        state.siteDownloadProfiles[siteId].defaultDownloaderId !==
          site.defaultDownloaderId)
    ) {
      issue(
        issues,
        "error",
        "site-default-downloader-profile-mismatch",
        "sites." + siteId + ".defaultDownloaderId"
      );
    }
    site.hosts.forEach(host => {
      if (state.hostToSiteId[host] !== siteId) {
        issue(
          issues,
          "error",
          "site-host-reverse-map-missing",
          "sites." + siteId + ".hosts"
        );
      }
    });
  });
  Object.keys(state.hostToSiteId).forEach(host => {
    const siteId = state.hostToSiteId[host];
    if (!state.sites[siteId]) {
      issue(issues, "error", "dangling-host-site", "hostToSiteId." + host);
    }
  });

  Object.keys(state.downloaders).forEach(downloaderId => {
    const downloader = state.downloaders[downloaderId];
    if (!downloader || typeof downloader !== "object") {
      issue(
        issues,
        "error",
        "invalid-downloader-record",
        "downloaders." + downloaderId
      );
      return;
    }
    if (downloader.downloaderId !== downloaderId) {
      issue(
        issues,
        "error",
        "downloader-key-mismatch",
        "downloaders." + downloaderId
      );
    }
    validateTarget(
      downloader.defaultTarget,
      "downloaders." + downloaderId + ".defaultTarget",
      issues
    );
  });

  if (
    state.settings.defaultDownloaderId &&
    !state.downloaders[state.settings.defaultDownloaderId]
  ) {
    issue(
      issues,
      "warning",
      "missing-default-downloader",
      "settings.defaultDownloaderId"
    );
  }
  validateTarget(
    state.settings.globalDownloadTarget,
    "settings.globalDownloadTarget",
    issues
  );
  validateScheduler(state.settings.userRefresh, "settings.userRefresh", issues);
  validateScheduler(
    state.settings.webDavBackup,
    "settings.webDavBackup",
    issues
  );

  Object.keys(state.siteDownloadProfiles).forEach(siteId => {
    const profile = state.siteDownloadProfiles[siteId];
    const path = "siteDownloadProfiles." + siteId;
    if (
      !profile ||
      typeof profile !== "object" ||
      !profile.byDownloader ||
      typeof profile.byDownloader !== "object" ||
      Array.isArray(profile.byDownloader)
    ) {
      issue(issues, "error", "invalid-site-download-profile", path);
      return;
    }
    if (!state.sites[siteId]) {
      issue(issues, "error", "profile-site-missing", path);
    }
    if (profile.siteId !== siteId) {
      issue(issues, "error", "profile-key-mismatch", path);
    }
    if (
      profile.defaultDownloaderId &&
      !state.downloaders[profile.defaultDownloaderId]
    ) {
      issue(issues, "warning", "profile-default-downloader-missing", path);
    }
    Object.keys(profile.byDownloader).forEach(downloaderId => {
      if (!state.downloaders[downloaderId]) {
        issue(
          issues,
          "warning",
          "profile-downloader-missing",
          path + ".byDownloader." + downloaderId
        );
      }
      validateTarget(
        profile.byDownloader[downloaderId],
        path + ".byDownloader." + downloaderId,
        issues
      );
    });
  });

  Object.keys(state.userHistory).forEach(siteId => {
    if (!state.sites[siteId]) {
      issue(issues, "error", "history-site-missing", "userHistory." + siteId);
    }
  });

  state.downloadHistory.forEach((record, index) => {
    if (!record || typeof record !== "object") {
      issue(
        issues,
        "warning",
        "invalid-download-history-record",
        "downloadHistory." + index
      );
      return;
    }
    if (record.siteId && !state.sites[record.siteId]) {
      issue(
        issues,
        "warning",
        "download-history-site-missing",
        "downloadHistory." + index + ".siteId"
      );
    }
    if (record.downloaderId && !state.downloaders[record.downloaderId]) {
      issue(
        issues,
        "warning",
        "download-history-downloader-missing",
        "downloadHistory." + index + ".downloaderId"
      );
    }
  });

  const groupIds: { [groupId: string]: true } = {};
  state.collections.groups.forEach((group, index) => {
    if (!group || typeof group !== "object") {
      issue(
        issues,
        "warning",
        "invalid-collection-group",
        "collections.groups." + index
      );
      return;
    }
    if (!group.id) {
      return;
    }
    if (groupIds[group.id]) {
      issue(
        issues,
        "warning",
        "duplicate-collection-group",
        "collections.groups." + index
      );
    }
    groupIds[group.id] = true;
  });
  state.collections.items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      issue(
        issues,
        "warning",
        "invalid-collection-item",
        "collections.items." + index
      );
      return;
    }
    (item.groups || []).forEach(groupId => {
      if (!groupIds[groupId]) {
        issue(
          issues,
          "warning",
          "collection-group-missing",
          "collections.items." + index + ".groups"
        );
      }
    });
  });

  return issues;
}

export function assertValidMV3State(state: MV3State): void {
  const errors = validateMV3State(state).filter(issue => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      "Invalid MV3 state: " + errors.map(error => error.code).join(", ")
    );
  }
}
