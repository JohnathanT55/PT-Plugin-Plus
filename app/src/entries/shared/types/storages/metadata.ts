import type {
  ISearchCategories,
  ISearchEntryRequestConfig,
  ISiteUserConfig,
  IUserInfo,
  TSiteHost,
  TSiteID as TSiteKey,
} from "@ptd/site";
import type { TSelectSearchCategoryValue } from "@ptd/site";
import type { CAddTorrentOptions, DownloaderBaseConfig } from "@ptd/downloader";
import type { IMediaServerBaseConfig } from "@ptd/mediaServer";
import type { IBackupConfig } from "@ptd/backupServer";

export interface ISearchSolution {
  id: string;
  siteId: TSiteKey;
  /**
   * 如何展示该站点搜索配置名称，
   * 在 #457 之前使用 selectedCategories 自动生成，在 #457 之后改为可选的 name 字段，其中 name 优先级更高
   */
  name?: string; // 方案名称，默认为空
  selectedCategories?: Record<ISearchCategories["key"], TSelectSearchCategoryValue>;
  searchEntries: Record<string, ISearchEntryRequestConfig>;
}

export type TSolutionKey = string;
export interface ISearchSolutionMetadata {
  id: TSolutionKey;
  name: string;
  sort: number;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  solutions: ISearchSolution[];
}

export type TSearchSnapshotKey = string;
export interface ISearchSnapshotMetadata {
  id: TSearchSnapshotKey;
  name: string; // [搜索方案] 搜索词 (搜索时间)
  createdAt: number;
  recordCount: number; // 记录数
}

export interface IStoredUserInfo extends IUserInfo {}

export type TDownloaderKey = string;

export interface IDownloaderMetadata extends DownloaderBaseConfig {
  id: TDownloaderKey;
  enabled: boolean;

  suggestFolders?: string[];
  suggestTags?: string[];

  sortIndex?: number; // 排序索引，默认值取 100
  excludedSites?: string[]; // 排除的站点列表，在该列表中的站点不会显示该下载器
  autoFlushStatus?: number; // 自动刷新状态，0: 关闭，其他数值表示刷新间隔的秒数

  [key: string]: any; // 其他配置项
}

export interface IDefaultDownloaderConfig {
  id?: TDownloaderKey;
  folder?: string;
  tags?: string;
}

export interface ISiteDownloadTarget {
  directories: string[];
  tags: string[];
  defaultDirectory?: string;
  defaultTag?: string;
  autoStart?: boolean;
}

export interface ISiteDownloadProfile {
  siteId: TSiteKey;
  defaultDownloaderId?: TDownloaderKey;
  byDownloader: Record<TDownloaderKey, ISiteDownloadTarget>;
}

export interface IPtppMigrationMetadata {
  bridgeVersion: number;
  schemaVersion: number;
  sourceRevision?: string;
  migratedAt: number;
  warningCount: number;
  importedCounts: Record<string, number>;
  skippedSiteIds: string[];
  skippedDownloaderIds: string[];
}

export type TMediaServerKey = string;
export interface IMediaServerMetadata extends IMediaServerBaseConfig {
  id: TMediaServerKey;
  enabled: boolean;
  [key: string]: any; // 其他配置项
}

export const BackupFields = [
  "cookies", // 备份已添加站点的Cookie
  "config", // 备份插件基本配置
  "metadata", // 备份插件元数据（站点、搜索方案、下载器、媒体服务器等配置）
  "userInfo", // 备份插件历史获取的用户信息
  "searchResultSnapshot", // 备份搜索结果快照
  "keepUploadTask", // 备份辅种任务
  "downloadHistory", // 备份下载历史
  "collection", // 备份收藏和收藏分组
] as const;
export type TBackupFields = (typeof BackupFields)[number];

export type TBackupServerKey = string;
export type TBackupTrigger = "manual" | "interval" | "userDataRefresh";
export interface IBackupHistoryEvent {
  id: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: "success" | "failed";
  trigger: TBackupTrigger;
  retryIndex: number;
  fields: TBackupFields[];
  error?: string;
}
export interface IBackupServerMetadata extends IBackupConfig {
  id: TBackupServerKey;
  enabled: boolean; // 此处仅影响自动备份
  backupFields: TBackupFields[]; // 备份的字段
  backupFieldsVersion?: number; // 字段选择格式版本，用于只迁移一次后来新增的字段

  lastBackupAt?: number; // 上次备份时间
  backupInterval?: number; // 自动备份间隔（小时），不设置或为 0 表示不自动备份
  nextBackupAt?: number; // 下次固定间隔备份时间
  lastBackupAttemptAt?: number; // 最近一次尝试时间（成功或失败）
  lastBackupFailureAt?: number; // 最近一次失败时间
  lastBackupError?: string; // 已脱敏的最近一次失败原因
  lastBackupTrigger?: TBackupTrigger; // 最近一次尝试的触发来源
  backupRetryAt?: number; // 持久化失败重试的计划时间
  backupRetryCount?: number; // 当前连续失败后的重试序号
  backupHistory?: IBackupHistoryEvent[]; // 最近的备份运行记录，最新在前
}

export interface IMetadataPiniaStorageSchema {
  // 站点配置(用户配置)
  sites: Record<TSiteKey, ISiteUserConfig>;

  // 搜索方案配置
  solutions: Record<TSolutionKey, ISearchSolutionMetadata>;

  /**
   * 搜索快照配置（元信息）
   * 具体快照内容需要通过 getSearchResultSnapshotData() 方法获取
   */
  snapshots: Record<TSearchSnapshotKey, ISearchSnapshotMetadata>;

  // 下载器配置
  downloaders: Record<TDownloaderKey, IDownloaderMetadata>;

  // 媒体服务器配置
  mediaServers: Record<TMediaServerKey, IMediaServerMetadata>;

  // 备份服务器配置
  backupServers: Record<TBackupServerKey, IBackupServerMetadata>;

  // 默认搜索方案
  defaultSolutionId: TSolutionKey | "default";

  // 默认下载器配置
  defaultDownloader: IDefaultDownloaderConfig;

  // PTPP 差异能力：每个站点在不同下载器下使用独立目录和标签
  siteDownloadProfiles: Record<TSiteKey, ISiteDownloadProfile>;

  // 从旧版 PTPP storage 合并到 PTD 运行时存储的幂等标记
  ptppMigration?: IPtppMigrationMetadata;

  // 上一次搜索时在结果页面的筛选词，需要启用 configStore.searchEntity.saveLastFilter
  lastSearchFilter?: string;

  /**
   * 此处仅存储站点最近一次的记录，如果需要获取历史记录，需要使用 storage 方法获取
   */
  lastUserInfo: Record<TSiteKey, IStoredUserInfo>;

  lastDownloader?: {
    id?: TDownloaderKey;
    options?: Omit<CAddTorrentOptions, "localDownloadOption">;
  };

  // 上一次创建辅种任务时使用的下载设置（受 saveLastDownloader 配置控制）
  lastKeepUpload?: {
    downloaderId?: TDownloaderKey;
    savePath?: string;
    label?: string;
  };

  // 上一次自动刷新的时间戳
  lastUserInfoAutoFlushAt: number;

  // 站点 host 映射表
  siteHostMap: Record<TSiteHost, TSiteKey>;

  // 站点 ID 到站点名称的映射表
  siteNameMap: Record<TSiteKey, string>;
}
