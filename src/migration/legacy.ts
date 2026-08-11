import {
  BackupServerRecord,
  CollectionState,
  Dictionary,
  DownloadTarget,
  DownloaderRecord,
  MigrationWarning,
  MV3State,
  SiteDownloadProfile,
  SiteRecord,
  createEmptyState,
  emptyDownloadTarget,
} from "../model/schema";
import { LEGACY_STORAGE_KEYS } from "../storage/keys";

export interface LegacyStorageSnapshot {
  [key: string]: any;
}

export interface LegacyMigrationResult {
  state: MV3State;
  migratedCounts: Dictionary<number>;
}

function deepClone(value: any): any {
  if (Array.isArray(value)) {
    return value.map(deepClone);
  }
  if (value && typeof value === "object") {
    const result: Dictionary<any> = {};
    Object.keys(value).forEach((key) => {
      result[key] = deepClone(value[key]);
    });
    return result;
  }
  return value;
}

// IDs and aliases are intentionally aligned with PT-depiler's typed site
// definitions. Unknown/custom sites still receive a deterministic local ID.
const PTD_SITE_IDS_BY_HOST: Dictionary<string> = {
  "audiences.me": "audiences",
  "azusa.wiki": "azusa",
  "hdkyl.in": "hdkylin",
  "na.hdkylin.com": "hdkylin",
  "cf.hdkylin.com": "hdkylin",
  "hdsky.me": "hdsky",
  "hdtime.org": "hdtime",
  "kamept.com": "kamept",
  "kp.m-team.cc": "mteam",
  "zp.m-team.io": "mteam",
  "ob.m-team.cc": "mteam",
  "api.m-team.cc": "mteam",
  "m-team.cc": "mteam",
  "h5.m-team.cc": "mteam",
  "xp.m-team.io": "mteam",
  "pt.m-team.cc": "mteam",
  "tp.m-team.cc": "mteam",
  "xp.m-team.cc": "mteam",
  "ap.m-team.cc": "mteam",
  "next.m-team.cc": "mteam",
  "pttime.org": "pttime",
  "skyey2.com": "skyeysnow",
  "skyeysnow.com": "skyeysnow",
  "u2.dmhy.org": "u2",
};

const PTD_SITE_IDS_BY_NAME: Dictionary<string> = {
  audiences: "audiences",
  azusa: "azusa",
  hdkylin: "hdkylin",
  hdsky: "hdsky",
  hdtime: "hdtime",
  kamept: "kamept",
  "m-team": "mteam",
  "m-team-tp": "mteam",
  mteam: "mteam",
  pttime: "pttime",
  skyeysnow: "skyeysnow",
  u2: "u2",
};

function parsed(value: any): any {
  if (typeof value !== "string") {
    return deepClone(value);
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function objectValue(value: any): Dictionary<any> {
  const result = parsed(value);
  return result && typeof result === "object" && !Array.isArray(result) ? result : {};
}

function arrayValue(value: any): any[] {
  const result = parsed(value);
  return Array.isArray(result) ? result.slice() : [];
}

function nestedItems(value: any): any[] {
  const result = parsed(value);
  if (Array.isArray(result)) {
    return result.slice();
  }
  return result && Array.isArray(result.items) ? result.items.slice() : [];
}

function cloneObject(value: any): Dictionary<any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.assign({}, value);
}

function pickFields(value: any, fields: string[]): Dictionary<any> {
  const source = cloneObject(value);
  const result: Dictionary<any> = {};
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field];
    }
  });
  return result;
}

const SAFE_SITE_LEGACY_FIELDS = [
  "id",
  "name",
  "url",
  "activeURL",
  "cdn",
  "icon",
  "tags",
  "passkey",
  "value",
  "description",
  "host",
  "defaultClientId",
  "allowSearch",
  "securityKeys",
  "priority",
  "path",
  "formerHosts",
  "offline",
  "isCustom",
  "timezoneOffset",
  "disableMessageCount",
  "upLoadLimit",
];

const SAFE_SEARCH_ENTRY_FIELDS = [
  "id",
  "name",
  "enabled",
  "categories",
  "appendToSearchKeyString",
  "appendQueryString",
  "page",
  "entry",
  "resultType",
  "keepOriginKey",
  "requestDataType",
  "queryString",
  "headers",
  "skipIMDbId",
  "requestMethod",
  "requestData",
];

function safeSiteLegacyConfig(site: any): Dictionary<any> {
  const result = pickFields(site, SAFE_SITE_LEGACY_FIELDS);
  if (Array.isArray(site && site.searchEntry)) {
    result.searchEntry = site.searchEntry.map((entry: any) => pickFields(entry, SAFE_SEARCH_ENTRY_FIELDS));
  }
  return result;
}

function hasExecutableSiteConfig(site: any): boolean {
  if (!site || site.script || site.scripts || site.plugins || site.parser || site.checker) {
    return !!site;
  }
  return (
    Array.isArray(site.searchEntry) &&
    site.searchEntry.some(
      (entry: any) => entry && (entry.parseScript || entry.parseScriptFile || entry.asyncParse || entry.beforeSearch),
    )
  );
}

const SAFE_DOWNLOADER_LEGACY_FIELDS = [
  "id",
  "name",
  "address",
  "loginName",
  "loginPwd",
  "paths",
  "autoStart",
  "tagIMDb",
  "tags",
  "type",
  "value",
];

const SAFE_BACKUP_SERVER_LEGACY_FIELDS = [
  "id",
  "type",
  "address",
  "name",
  "lastBackupTime",
  "loginName",
  "loginPwd",
  "authCode",
  "digest",
];

function normalizeHost(value: any): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

function slug(value: any, fallback: string): string {
  const result = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result || fallback;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result += (result << 1) + (result << 4) + (result << 7) + (result << 8) + (result << 24);
  }
  return (result >>> 0).toString(36);
}

function uniqueStrings(values: any[]): string[] {
  const result: string[] = [];
  values.forEach((value) => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = value.trim();
    if (normalized && result.indexOf(normalized) === -1) {
      result.push(normalized);
    }
  });
  return result;
}

function mergeStrings(first: string[], second: string[]): string[] {
  return uniqueStrings(first.concat(second));
}

function targetFromLegacy(value: any, tags?: any): DownloadTarget {
  let candidates: any[] = [];
  if (Array.isArray(value)) {
    candidates = value;
  } else if (typeof value === "string") {
    candidates = [value];
  }

  const directories: string[] = [];
  candidates.forEach((candidate) => {
    if (typeof candidate === "string") {
      directories.push(candidate);
    } else if (candidate && typeof candidate.path === "string") {
      directories.push(candidate.path);
    } else if (candidate && typeof candidate.value === "string") {
      directories.push(candidate.value);
    }
  });

  return {
    directories: uniqueStrings(directories),
    tags: uniqueStrings(Array.isArray(tags) ? tags : tags ? [tags] : []),
  };
}

function mergeTarget(first: DownloadTarget, second: DownloadTarget): DownloadTarget {
  return {
    directories: mergeStrings(first.directories, second.directories),
    tags: mergeStrings(first.tags, second.tags),
    defaultDirectory: first.defaultDirectory || second.defaultDirectory,
    autoStart: typeof first.autoStart === "boolean" ? first.autoStart : second.autoStart,
  };
}

function warning(warnings: MigrationWarning[], code: string, sourceKey?: string) {
  warnings.push({ code, sourceKey });
}

function allocateSiteId(site: any, index: number): string {
  const host = normalizeHost(site && (site.host || site.url));
  const canonicalId = PTD_SITE_IDS_BY_HOST[host] || PTD_SITE_IDS_BY_NAME[slug(site && site.name, "")];
  if (canonicalId) {
    return canonicalId;
  }
  if (site && typeof site.id === "string" && site.id.trim()) {
    return "site:" + slug(site.id, "legacy-" + index);
  }
  const name = slug(site && site.name, "legacy-site");
  return "site:" + name + ":" + hash(host || name + ":" + index);
}

function allocateDownloaderId(client: any, index: number): string {
  if (client && typeof client.id === "string" && client.id.trim()) {
    return client.id;
  }
  const name = slug(client && (client.name || client.type), "downloader");
  return "downloader:" + name + ":" + hash(name + ":" + index);
}

function addHostAlias(state: MV3State, rawHost: any, siteId: string, warnings: MigrationWarning[]) {
  const host = normalizeHost(rawHost);
  if (!host) {
    return;
  }
  const existing = state.hostToSiteId[host];
  if (existing && existing !== siteId) {
    warning(warnings, "site-host-alias-conflict", LEGACY_STORAGE_KEYS.config);
    return;
  }
  state.hostToSiteId[host] = siteId;
}

function ensureSiteForHost(state: MV3State, rawHost: any, warnings: MigrationWarning[]): string | undefined {
  const host = normalizeHost(rawHost);
  if (!host || host === "__allsite__") {
    return undefined;
  }
  if (state.hostToSiteId[host]) {
    return state.hostToSiteId[host];
  }

  const siteId = PTD_SITE_IDS_BY_HOST[host] || "site:legacy-host:" + hash(host);
  const existing = state.sites[siteId];
  if (existing) {
    existing.hosts = mergeStrings(existing.hosts, [host]);
    state.hostToSiteId[host] = siteId;
    warning(warnings, "known-site-host-alias-added", LEGACY_STORAGE_KEYS.config);
    return siteId;
  }
  state.sites[siteId] = {
    siteId,
    name: host,
    activeHost: host,
    hosts: [host],
    enabled: true,
    custom: true,
    legacyConfig: { host },
  };
  state.hostToSiteId[host] = siteId;
  warning(warnings, "synthetic-site-created", LEGACY_STORAGE_KEYS.config);
  return siteId;
}

function migrateSites(state: MV3State, options: Dictionary<any>) {
  const sites = Array.isArray(options.sites) ? options.sites : [];
  sites.forEach((legacySite: any, index: number) => {
    const site = legacySite || {};
    let siteId = allocateSiteId(site, index);
    const activeHost = normalizeHost(site.host || site.activeURL || site.url);
    const formerHosts = Array.isArray(site.formerHosts) ? site.formerHosts : [];
    const cdnHosts = Array.isArray(site.cdn) ? site.cdn : [];
    const hosts = uniqueStrings(
      [activeHost, normalizeHost(site.activeURL), normalizeHost(site.url)]
        .concat(cdnHosts.map(normalizeHost))
        .concat(formerHosts.map(normalizeHost))
        .filter((item: string) => !!item),
    );
    if (state.sites[siteId]) {
      if (siteId.indexOf("site:") !== 0) {
        const existing = state.sites[siteId];
        const aliasConfig = safeSiteLegacyConfig(site);
        existing.hosts = mergeStrings(existing.hosts, hosts);
        if (!existing.activeHost && activeHost) {
          existing.activeHost = activeHost;
        }
        if (!existing.defaultDownloaderId && site.defaultClientId) {
          existing.defaultDownloaderId = site.defaultClientId;
        }
        const existingProfile = state.siteDownloadProfiles[siteId];
        if (existingProfile && !existingProfile.defaultDownloaderId && site.defaultClientId) {
          existingProfile.defaultDownloaderId = site.defaultClientId;
        }
        if (JSON.stringify(existing.legacyConfig) !== JSON.stringify(aliasConfig)) {
          if (!existing.legacyAliasConfigs) {
            existing.legacyAliasConfigs = [];
          }
          if (!existing.legacyAliasConfigs.some((item) => JSON.stringify(item) === JSON.stringify(aliasConfig))) {
            existing.legacyAliasConfigs.push(aliasConfig);
          }
        }
        if (hasExecutableSiteConfig(site)) {
          warning(
            state.metadata.warnings,
            "legacy-site-executable-config-left-in-mv2-storage",
            LEGACY_STORAGE_KEYS.config,
          );
        }
        hosts.forEach((host) => addHostAlias(state, host, siteId, state.metadata.warnings));
        warning(state.metadata.warnings, "ptd-site-alias-records-merged", LEGACY_STORAGE_KEYS.config);
        return;
      }
      siteId += ":" + index;
      warning(state.metadata.warnings, "duplicate-site-id", LEGACY_STORAGE_KEYS.config);
    }
    const record: SiteRecord = {
      siteId,
      name: String(site.name || activeHost || siteId),
      activeHost: activeHost || undefined,
      hosts,
      enabled: site.value !== false && site.offline !== true,
      defaultDownloaderId: typeof site.defaultClientId === "string" ? site.defaultClientId : undefined,
      custom: site.isCustom === true,
      legacyConfig: safeSiteLegacyConfig(site),
    };
    state.sites[siteId] = record;
    if (hasExecutableSiteConfig(site)) {
      warning(state.metadata.warnings, "legacy-site-executable-config-left-in-mv2-storage", LEGACY_STORAGE_KEYS.config);
    }
    state.siteDownloadProfiles[siteId] = {
      siteId,
      defaultDownloaderId: record.defaultDownloaderId,
      byDownloader: {},
    };
    hosts.forEach((host) => addHostAlias(state, host, siteId, state.metadata.warnings));
  });
}

function migrateDownloaders(state: MV3State, options: Dictionary<any>) {
  const clients = Array.isArray(options.clients) ? options.clients : [];
  clients.forEach((legacyClient: any, index: number) => {
    const client = legacyClient || {};
    let downloaderId = allocateDownloaderId(client, index);
    if (state.downloaders[downloaderId]) {
      downloaderId += ":" + index;
      warning(state.metadata.warnings, "duplicate-downloader-id", LEGACY_STORAGE_KEYS.config);
    }

    const paths = objectValue(client.paths);
    const globalTarget = targetFromLegacy(paths.__allSite__ || paths.__allsite__, client.tags);
    globalTarget.defaultDirectory = globalTarget.directories[0];
    globalTarget.autoStart = typeof client.autoStart === "boolean" ? client.autoStart : undefined;

    const record: DownloaderRecord = {
      downloaderId,
      name: String(client.name || client.type || downloaderId),
      type: String(client.type || "unknown"),
      address: typeof client.address === "string" ? client.address : undefined,
      username: typeof client.loginName === "string" ? client.loginName : undefined,
      password: typeof client.loginPwd === "string" ? client.loginPwd : undefined,
      enabled: client.value !== false,
      defaultTarget: globalTarget,
      legacyConfig: pickFields(client, SAFE_DOWNLOADER_LEGACY_FIELDS),
    };
    state.downloaders[downloaderId] = record;
    if (client.script || client.scripts) {
      warning(
        state.metadata.warnings,
        "legacy-downloader-executable-config-left-in-mv2-storage",
        LEGACY_STORAGE_KEYS.config,
      );
    }

    Object.keys(paths).forEach((rawHost) => {
      if (rawHost.toLowerCase() === "__allsite__") {
        return;
      }
      const siteId = ensureSiteForHost(state, rawHost, state.metadata.warnings);
      if (!siteId) {
        return;
      }
      const profile: SiteDownloadProfile = state.siteDownloadProfiles[siteId] || {
        siteId,
        defaultDownloaderId: state.sites[siteId].defaultDownloaderId,
        byDownloader: {},
      };
      const target = targetFromLegacy(paths[rawHost], client.tags);
      target.defaultDirectory = target.directories[0];
      target.autoStart = record.defaultTarget.autoStart;
      if (profile.byDownloader[downloaderId]) {
        profile.byDownloader[downloaderId] = mergeTarget(profile.byDownloader[downloaderId], target);
        warning(state.metadata.warnings, "site-path-alias-merged", LEGACY_STORAGE_KEYS.config);
      } else {
        profile.byDownloader[downloaderId] = target;
      }
      state.siteDownloadProfiles[siteId] = profile;
    });
  });
}

function migrateBackupServers(state: MV3State, options: Dictionary<any>) {
  const servers = Array.isArray(options.backupServers) ? options.backupServers : [];
  servers.forEach((legacyServer: any, index: number) => {
    const server = legacyServer || {};
    let id =
      typeof server.id === "string" && server.id
        ? server.id
        : "backup:" + slug(server.name || server.type, "server") + ":" + index;
    if (state.backupServers[id]) {
      id += ":" + index;
    }
    const record: BackupServerRecord = {
      backupServerId: id,
      type: String(server.type || "unknown"),
      name: String(server.name || server.type || id),
      address: typeof server.address === "string" ? server.address : "",
      username: typeof server.loginName === "string" ? server.loginName : undefined,
      password: typeof server.loginPwd === "string" ? server.loginPwd : undefined,
      authCode: typeof server.authCode === "string" ? server.authCode : undefined,
      digest: typeof server.digest === "boolean" ? server.digest : undefined,
      lastBackupTime: typeof server.lastBackupTime === "number" ? server.lastBackupTime : undefined,
      legacyConfig: pickFields(server, SAFE_BACKUP_SERVER_LEGACY_FIELDS),
    };
    state.backupServers[id] = record;
  });
}

function remapHostData(state: MV3State, source: Dictionary<any>, sourceKey: string): Dictionary<any> {
  const result: Dictionary<any> = {};
  Object.keys(source).forEach((rawHost) => {
    const siteId = ensureSiteForHost(state, rawHost, state.metadata.warnings);
    if (!siteId) {
      return;
    }
    const incoming = objectValue(source[rawHost]);
    if (!result[siteId]) {
      result[siteId] = incoming;
      return;
    }

    const existing = result[siteId];
    Object.keys(incoming).forEach((dataKey) => {
      if (!Object.prototype.hasOwnProperty.call(existing, dataKey)) {
        existing[dataKey] = incoming[dataKey];
        return;
      }
      if (JSON.stringify(existing[dataKey]) === JSON.stringify(incoming[dataKey])) {
        return;
      }
      let conflictKey = "__conflict__:" + hash(normalizeHost(rawHost)) + ":" + dataKey;
      let suffix = 1;
      while (Object.prototype.hasOwnProperty.call(existing, conflictKey)) {
        conflictKey = "__conflict__:" + hash(normalizeHost(rawHost)) + ":" + dataKey + ":" + suffix++;
      }
      existing[conflictKey] = incoming[dataKey];
      warning(state.metadata.warnings, "host-data-conflict-preserved", sourceKey);
    });
    warning(state.metadata.warnings, "host-data-merged", sourceKey);
  });
  return result;
}

function annotateDownloadHistory(state: MV3State, items: any[]): any[] {
  return items.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const copy = Object.assign({}, item);
    const siteId = ensureSiteForHost(state, item.host, state.metadata.warnings);
    if (siteId) {
      copy.siteId = siteId;
    }
    if (typeof item.clientId === "string") {
      copy.downloaderId = item.clientId;
    }
    return copy;
  });
}

function annotateEmbeddedSite(state: MV3State, item: any): any {
  if (!item || typeof item !== "object") {
    return item;
  }
  const copy = Object.assign({}, item);
  const rawHost = item.host || (item.site && item.site.host);
  const siteId = ensureSiteForHost(state, rawHost, state.metadata.warnings);
  if (siteId) {
    copy.siteId = siteId;
  }
  return copy;
}

function migrateCollections(value: any, defaultGroupId?: string): CollectionState {
  const parsedValue = parsed(value);
  const data = Array.isArray(parsedValue) ? { groups: [], items: parsedValue } : objectValue(parsedValue);
  const groups = Array.isArray(data.groups) ? data.groups.map((group: any) => Object.assign({}, group)) : [];
  const items = Array.isArray(data.items) ? data.items.slice() : [];
  groups.forEach((group: any) => {
    if (!group || !group.id) {
      return;
    }
    group.count = items.filter(
      (item: any) => item && Array.isArray(item.groups) && item.groups.indexOf(group.id) !== -1,
    ).length;
  });
  return {
    groups,
    items,
    ...(defaultGroupId && groups.some((group: any) => group?.id === defaultGroupId) ? { defaultGroupId } : {}),
  };
}

function legacyOptionsWithoutStructuredData(options: Dictionary<any>) {
  const result = Object.assign({}, options);
  delete result.sites;
  delete result.clients;
  delete result.backupServers;
  delete result.system;
  return result;
}

export function migrateLegacyStorage(legacy: LegacyStorageSnapshot, now: number): LegacyMigrationResult {
  const state = createEmptyState(now);
  const options = objectValue(legacy[LEGACY_STORAGE_KEYS.config]);
  migrateSites(state, options);
  migrateDownloaders(state, options);
  migrateBackupServers(state, options);

  state.settings.locale = typeof options.locale === "string" ? options.locale : undefined;
  state.settings.defaultDownloaderId =
    typeof options.defaultClientId === "string" ? options.defaultClientId : undefined;
  state.settings.userRefresh = {
    enabled: options.autoRefreshUserData === true,
    intervalMinutes: Math.max(
      1,
      Number(options.autoRefreshUserDataHours || 0) * 60 + Number(options.autoRefreshUserDataMinutes || 0) || 24 * 60,
    ),
    nextRunAt:
      typeof options.autoRefreshUserDataNextTime === "number" ? options.autoRefreshUserDataNextTime : undefined,
    retryCount:
      typeof options.autoRefreshUserDataFailedRetryCount === "number"
        ? options.autoRefreshUserDataFailedRetryCount
        : undefined,
    retryIntervalMinutes:
      typeof options.autoRefreshUserDataFailedRetryInterval === "number"
        ? options.autoRefreshUserDataFailedRetryInterval
        : undefined,
  };
  state.settings.legacyOptions = legacyOptionsWithoutStructuredData(options);

  state.userHistory = remapHostData(
    state,
    objectValue(legacy[LEGACY_STORAGE_KEYS.userHistory]),
    LEGACY_STORAGE_KEYS.userHistory,
  );
  state.downloadHistory = annotateDownloadHistory(state, arrayValue(legacy[LEGACY_STORAGE_KEYS.downloadHistory]));
  state.collections = migrateCollections(
    legacy[LEGACY_STORAGE_KEYS.collections],
    typeof options.defaultCollectionGroupId === "string" ? options.defaultCollectionGroupId : undefined,
  );
  state.collections.items = state.collections.items.map((item) => annotateEmbeddedSite(state, item));

  state.searchSnapshots = nestedItems(legacy[LEGACY_STORAGE_KEYS.searchSnapshots]).map((snapshot) => {
    if (!snapshot || !Array.isArray(snapshot.result)) {
      return snapshot;
    }
    return Object.assign({}, snapshot, {
      result: snapshot.result.map((item: any) => annotateEmbeddedSite(state, item)),
    });
  });

  state.keepUploadTasks = nestedItems(legacy[LEGACY_STORAGE_KEYS.keepUploadTasks]).map((task) => {
    if (!task || typeof task !== "object") {
      return task;
    }
    const copy = Object.assign({}, task);
    if (Array.isArray(task.items)) {
      copy.items = task.items.map((item: any) => annotateEmbeddedSite(state, item));
    }
    if (task.downloadOptions && typeof task.downloadOptions === "object") {
      copy.downloadOptions = Object.assign({}, task.downloadOptions);
      if (typeof task.downloadOptions.clientId === "string") {
        copy.downloadOptions.downloaderId = task.downloadOptions.clientId;
      }
    }
    return copy;
  });

  state.uiOptions = objectValue(legacy[LEGACY_STORAGE_KEYS.uiOptions]);
  state.systemLogs = arrayValue(legacy[LEGACY_STORAGE_KEYS.systemLogs]);

  state.metadata.legacyImportedAt = now;
  state.metadata.legacySourceKeys = Object.keys(legacy).filter((key) => typeof legacy[key] !== "undefined");
  state.metadata.updatedAt = now;

  return {
    state,
    migratedCounts: {
      sites: Object.keys(state.sites).length,
      downloaders: Object.keys(state.downloaders).length,
      siteDownloadProfiles: Object.keys(state.siteDownloadProfiles).length,
      backupServers: Object.keys(state.backupServers).length,
      userHistorySites: Object.keys(state.userHistory).length,
      downloadHistory: state.downloadHistory.length,
      collectionGroups: state.collections.groups.length,
      collections: state.collections.items.length,
      searchSnapshots: state.searchSnapshots.length,
      keepUploadTasks: state.keepUploadTasks.length,
    },
  };
}
