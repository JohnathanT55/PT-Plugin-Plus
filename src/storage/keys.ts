export const LEGACY_STORAGE_KEYS = {
  config: "PT-Plugin-Plus-Config",
  downloadHistory: "PT-Plugin-Plus-downloadHistory",
  systemLogs: "PT-Plugin-Plus-systemLogs",
  uiOptions: "PT-Plugin-Plus-uiOptions",
  cache: "PT-Plugin-Plus-Cache-Contents",
  userHistory: "PT-Plugin-Plus-User-Datas",
  collections: "PT-Plugin-Plus-Collection",
  searchSnapshots: "PT-Plugin-Plus-SearchResultSnapshot",
  keepUploadTasks: "PT-Plugin-Plus-KeepUploadTask"
};

export const MV3_STORAGE_KEYS = {
  metadata: "ptpp.mv3.metadata",
  settings: "ptpp.mv3.settings",
  sites: "ptpp.mv3.sites",
  hostToSiteId: "ptpp.mv3.hostToSiteId",
  downloaders: "ptpp.mv3.downloaders",
  siteDownloadProfiles: "ptpp.mv3.siteDownloadProfiles",
  backupServers: "ptpp.mv3.backupServers",
  userHistory: "ptpp.mv3.userHistory",
  downloadHistory: "ptpp.mv3.downloadHistory",
  collections: "ptpp.mv3.collections",
  searchSnapshots: "ptpp.mv3.searchSnapshots",
  keepUploadTasks: "ptpp.mv3.keepUploadTasks",
  uiOptions: "ptpp.mv3.uiOptions",
  systemLogs: "ptpp.mv3.systemLogs"
};

export const MV3_DATA_STORAGE_KEYS: string[] = [
  MV3_STORAGE_KEYS.settings,
  MV3_STORAGE_KEYS.sites,
  MV3_STORAGE_KEYS.hostToSiteId,
  MV3_STORAGE_KEYS.downloaders,
  MV3_STORAGE_KEYS.siteDownloadProfiles,
  MV3_STORAGE_KEYS.backupServers,
  MV3_STORAGE_KEYS.userHistory,
  MV3_STORAGE_KEYS.downloadHistory,
  MV3_STORAGE_KEYS.collections,
  MV3_STORAGE_KEYS.searchSnapshots,
  MV3_STORAGE_KEYS.keepUploadTasks,
  MV3_STORAGE_KEYS.uiOptions,
  MV3_STORAGE_KEYS.systemLogs
];

export function revisionedStorageKey(baseKey: string, revision: string): string {
  return baseKey + "@" + revision;
}

export const LEGACY_IMPORT_KEYS: string[] = [
  LEGACY_STORAGE_KEYS.config,
  LEGACY_STORAGE_KEYS.downloadHistory,
  LEGACY_STORAGE_KEYS.systemLogs,
  LEGACY_STORAGE_KEYS.uiOptions,
  LEGACY_STORAGE_KEYS.userHistory,
  LEGACY_STORAGE_KEYS.collections,
  LEGACY_STORAGE_KEYS.searchSnapshots,
  LEGACY_STORAGE_KEYS.keepUploadTasks
];
