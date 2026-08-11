export const MV3_SCHEMA_VERSION = 1;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Dictionary<T> {
  [key: string]: T;
}

/** Serializable data retained from the MV2 model but not executed by MV3. */
export interface LegacyRecord {
  [key: string]: unknown;
}

export interface VersionedEnvelope<T> {
  schemaVersion: number;
  storageRevision: string;
  updatedAt: number;
  data: T;
}

export interface MigrationWarning {
  code: string;
  sourceKey?: string;
  detail?: string;
}

export interface MigrationMetadata {
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  storageRevision?: string;
  previousStorageRevision?: string;
  legacyImportedAt?: number;
  legacySourceKeys: string[];
  warnings: MigrationWarning[];
  migratedCounts?: Dictionary<number>;
}

export interface DownloadTarget {
  directories: string[];
  tags: string[];
  /** Preferred direct-push folder; all directories remain available in advanced selection. */
  defaultDirectory?: string;
  /** Preferred optional tag; all tags remain available in manual selection. */
  defaultTag?: string;
  autoStart?: boolean;
}

export interface SchedulerSettings {
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt?: number;
  retryCount?: number;
  retryIntervalMinutes?: number;
}

export interface AppSettings {
  locale?: string;
  defaultDownloaderId?: string;
  globalDownloadTarget: DownloadTarget;
  userRefresh: SchedulerSettings;
  webDavBackup: SchedulerSettings;
  legacyOptions: LegacyRecord;
}

export interface SiteRecord {
  siteId: string;
  name: string;
  activeHost?: string;
  hosts: string[];
  enabled: boolean;
  defaultDownloaderId?: string;
  custom: boolean;
  legacyConfig: LegacyRecord;
  /** Sanitized alternate records retained when multiple MV2 hosts collapse to one PTD siteId. */
  legacyAliasConfigs?: LegacyRecord[];
}

export interface DownloaderRecord {
  downloaderId: string;
  name: string;
  type: string;
  address?: string;
  username?: string;
  password?: string;
  enabled: boolean;
  defaultTarget: DownloadTarget;
  legacyConfig: LegacyRecord;
}

export interface SiteDownloadProfile {
  siteId: string;
  defaultDownloaderId?: string;
  byDownloader: Dictionary<DownloadTarget>;
}

export interface BackupServerRecord {
  backupServerId: string;
  type: string;
  name: string;
  address: string;
  username?: string;
  password?: string;
  authCode?: string;
  digest?: boolean;
  lastBackupTime?: number;
  legacyConfig: LegacyRecord;
}

export interface UserInfoRecord extends LegacyRecord {
  id?: string | number;
  name?: string;
  uploaded?: number;
  downloaded?: number;
  ratio?: number;
  seeding?: number;
  seedingSize?: number;
  bonus?: number;
  lastUpdateTime?: number;
}

/** Keys are ISO date strings plus the legacy `latest` pointer. */
export interface SiteUserHistoryRecord {
  [dateOrLatest: string]: UserInfoRecord;
}

export interface DownloadPayloadRecord extends LegacyRecord {
  url?: string;
  title?: string;
  savePath?: string;
  link?: string;
  imdbId?: string;
}

export interface DownloadHistoryRecord extends LegacyRecord {
  data?: DownloadPayloadRecord;
  siteId?: string;
  downloaderId?: string;
  host?: string;
  clientId?: string;
  success?: boolean;
  time?: number;
}

export interface CollectionGroupRecord extends LegacyRecord {
  id?: string;
  name?: string;
  count?: number;
  color?: string;
  description?: string;
  update?: number;
}

export interface CollectionItemRecord extends LegacyRecord {
  siteId?: string;
  host?: string;
  title?: string;
  subTitle?: string;
  url?: string;
  link?: string;
  size?: number;
  groups?: string[];
  time?: number;
  imdbId?: string;
  movieInfo?: Record<string, unknown>;
}

export interface CollectionState {
  groups: CollectionGroupRecord[];
  items: CollectionItemRecord[];
  defaultGroupId?: string;
}

export interface SearchResultRecord extends LegacyRecord {
  siteId?: string;
  host?: string;
  title?: string;
  url?: string;
  link?: string;
}

export interface SearchSnapshotRecord extends LegacyRecord {
  id?: string;
  key?: string;
  time?: number;
  result?: SearchResultRecord[];
}

export interface KeepUploadTaskRecord extends LegacyRecord {
  id?: string;
  time?: number;
  title?: string;
  downloadOptions?: DownloadPayloadRecord & {
    clientId?: string;
    downloaderId?: string;
  };
  items?: SearchResultRecord[];
}

export interface SystemLogRecord extends LegacyRecord {
  id?: string | number;
  time?: number;
  module?: string;
  event?: string;
  msg?: string;
}

export interface MV3State {
  metadata: MigrationMetadata;
  settings: AppSettings;
  sites: Dictionary<SiteRecord>;
  hostToSiteId: Dictionary<string>;
  downloaders: Dictionary<DownloaderRecord>;
  siteDownloadProfiles: Dictionary<SiteDownloadProfile>;
  backupServers: Dictionary<BackupServerRecord>;
  userHistory: Dictionary<SiteUserHistoryRecord>;
  downloadHistory: DownloadHistoryRecord[];
  collections: CollectionState;
  searchSnapshots: SearchSnapshotRecord[];
  keepUploadTasks: KeepUploadTaskRecord[];
  uiOptions: LegacyRecord;
  systemLogs: SystemLogRecord[];
}

export function emptyDownloadTarget(): DownloadTarget {
  return { directories: [], tags: [] };
}

export function createEmptyState(now: number): MV3State {
  return {
    metadata: {
      schemaVersion: MV3_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      legacySourceKeys: [],
      warnings: [],
    },
    settings: {
      globalDownloadTarget: emptyDownloadTarget(),
      userRefresh: { enabled: false, intervalMinutes: 24 * 60 },
      webDavBackup: { enabled: false, intervalMinutes: 24 * 60 },
      legacyOptions: {},
    },
    sites: {},
    hostToSiteId: {},
    downloaders: {},
    siteDownloadProfiles: {},
    backupServers: {},
    userHistory: {},
    downloadHistory: [],
    collections: { groups: [], items: [] },
    searchSnapshots: [],
    keepUploadTasks: [],
    uiOptions: {},
    systemLogs: [],
  };
}
