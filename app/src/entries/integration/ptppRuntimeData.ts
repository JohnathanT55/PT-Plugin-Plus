import type {
  DownloadHistoryRecord,
  KeepUploadTaskRecord,
  MV3State,
  SearchResultRecord,
  SearchSnapshotRecord,
  UserInfoRecord,
} from "@foundation/model/schema";
import type { ITorrent } from "@ptd/site";

import type {
  IKeepUploadTask,
  IKeepUploadTaskItem,
  IMetadataPiniaStorageSchema,
  ISearchData,
  ISearchResultTorrent,
  IStoredUserInfo,
  ITorrentDownloadMetadata,
  TKeepUploadTaskStorageSchema,
  TSearchResultSnapshotStorageSchema,
  TUserInfoStorageSchema,
} from "@/shared/types.ts";

export interface PtppRuntimeStores {
  metadata: IMetadataPiniaStorageSchema;
  userInfo: TUserInfoStorageSchema;
  searchResultSnapshot: TSearchResultSnapshotStorageSchema;
  keepUploadTask: TKeepUploadTaskStorageSchema;
  downloadHistory: ITorrentDownloadMetadata[];
}

export interface PtppRuntimeDataMergeResult extends PtppRuntimeStores {
  downloadHistoryAdditions: ITorrentDownloadMetadata[];
  importedCounts: Record<string, number>;
}

const PTPP_SEARCH_SOLUTION_ID = "ptpp-import";
const RESULT_STATUS_UNKNOWN_ERROR = 0;
const RESULT_STATUS_SUCCESS = 3;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replaceAll(",", "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function sizeValue(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;
  const normalized = value.replaceAll(",", "").trim();
  const direct = Number(normalized);
  if (Number.isFinite(direct)) return direct;
  const match = normalized.match(/^(-?[\d.]+)\s*([kmgtpe]?i?b)$/i);
  if (!match) return value;
  const unit = match[2].toLowerCase().replace("ib", "b");
  const power = ["b", "kb", "mb", "gb", "tb", "pb", "eb"].indexOf(unit);
  const amount = Number(match[1]);
  return power >= 0 && Number.isFinite(amount) ? amount * 1024 ** power : value;
}

function timeValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value.replace(" ", "T"));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function joinTimeValue(value: unknown): unknown {
  const parsed = timeValue(value, Number.NaN);
  if (!Number.isFinite(parsed)) return value;
  return parsed > 1e9 && parsed < 1e12 ? parsed * 1000 : parsed;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: unknown): string {
  const input = stableSerialize(value);
  let result = 2166136261;
  for (let index = 0; index < input.length; index++) {
    result ^= input.charCodeAt(index);
    result += (result << 1) + (result << 4) + (result << 7) + (result << 8) + (result << 24);
  }
  return (result >>> 0).toString(36);
}

const OMIT_USER_INFO_FIELDS = new Set([
  "bonusPage",
  "unsatisfiedsPage",
  "isLogged",
  "isLoading",
  "lastErrorMsg",
  "lastUpdateStatus",
  "lastUpdateTime",
]);

const USER_INFO_RENAMES: Record<string, string> = {
  seedingPoints: "seedingBonus",
  averageSeedtime: "averageSeedingTime",
  unsatisfieds: "hnrUnsatisfied",
  prewarn: "hnrPreWarning",
};

const USER_INFO_SIZE_FIELDS = new Set([
  "downloaded",
  "trueDownloaded",
  "totalTraffic",
  "uploaded",
  "trueUploaded",
  "seedingSize",
]);

const USER_INFO_NUMBER_FIELDS = new Set([
  "ratio",
  "trueRatio",
  "seeding",
  "leeching",
  "snatches",
  "uploads",
  "posts",
  "bonus",
  "seedingBonus",
  "bonusPerHour",
  "seedingBonusPerHour",
  "messageCount",
  "invites",
  "hnrUnsatisfied",
  "hnrPreWarning",
]);

export function convertPtppUserInfo(source: UserInfoRecord, siteId: string): IStoredUserInfo {
  const target: Record<string, any> = {};
  for (const [sourceKey, sourceValue] of Object.entries(record(source))) {
    if (OMIT_USER_INFO_FIELDS.has(sourceKey)) continue;
    const key = USER_INFO_RENAMES[sourceKey] ?? sourceKey;
    if (key === "joinTime") {
      target[key] = joinTimeValue(sourceValue);
    } else if (USER_INFO_SIZE_FIELDS.has(key)) {
      target[key] = sizeValue(sourceValue);
    } else if (USER_INFO_NUMBER_FIELDS.has(key)) {
      const parsed = numberValue(sourceValue, Number.NaN);
      target[key] = Number.isFinite(parsed) ? parsed : clone(sourceValue);
    } else {
      target[key] = clone(sourceValue);
    }
  }
  target.site = siteId;
  target.updateAt = timeValue(source.lastUpdateTime ?? target.updateAt, 0);
  if (typeof target.status !== "number") {
    target.status = source.lastUpdateStatus === "success" ? RESULT_STATUS_SUCCESS : RESULT_STATUS_UNKNOWN_ERROR;
  }
  return target as IStoredUserInfo;
}

function torrentStatus(value: unknown): string | undefined {
  if (["unknown", "downloading", "seeding", "inactive", "completed"].includes(stringValue(value))) {
    return stringValue(value);
  }
  return (
    {
      1: "downloading",
      2: "seeding",
      3: "inactive",
      255: "completed",
    } as Record<number, string>
  )[numberValue(value, -1)];
}

function normalizeTags(value: unknown): Array<{ name: string; color?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => {
      if (typeof tag === "string") return { name: tag };
      const source = record(tag);
      return source.name ? { name: stringValue(source.name), ...(source.color ? { color: source.color } : {}) } : null;
    })
    .filter((tag): tag is { name: string; color?: string } => Boolean(tag?.name));
}

function convertLegacyTorrent(sourceValue: SearchResultRecord, fallbackTitle: string): ITorrent {
  const source = record(sourceValue);
  const site = stringValue(source.siteId || source.site?.id, "unknown");
  const id = source.id ?? source.uid ?? `ptpp-${stableHash(source)}`;
  const category = record(source.category).name ?? source.category;
  const torrent: Record<string, any> = {
    ...clone(source),
    site,
    id,
    title: stringValue(source.title, fallbackTitle),
    url: source.link,
    link: source.url,
    time: timeValue(source.time, 0),
    size: numberValue(sizeValue(source.size), 0),
    seeders: numberValue(source.seeders, 0),
    leechers: numberValue(source.leechers, 0),
    completed: numberValue(source.completed, 0),
    comments: numberValue(source.comments, 0),
    category,
    tags: normalizeTags(source.tags),
  };
  const normalizedStatus = torrentStatus(source.status);
  if (normalizedStatus) torrent.status = normalizedStatus;
  if (source.imdbId && !source.ext_imdb) torrent.ext_imdb = source.imdbId;
  delete torrent.siteId;
  delete torrent.host;
  delete torrent.titleHTML;
  return torrent as ITorrent;
}

export function convertPtppSearchResult(source: SearchResultRecord): ISearchResultTorrent {
  const torrent = convertLegacyTorrent(source, "PTPP imported result");
  return {
    ...torrent,
    uniqueId: `${torrent.site}-${torrent.id}`,
    solutionId: PTPP_SEARCH_SOLUTION_ID,
    solutionKey: `${torrent.site}|$|${PTPP_SEARCH_SOLUTION_ID}`,
  };
}

function snapshotId(source: SearchSnapshotRecord): string {
  return stringValue(source.id, `ptpp-snapshot-${stableHash(source)}`);
}

function convertSnapshot(source: SearchSnapshotRecord): ISearchData {
  const createdAt = timeValue(source.time, 0);
  return {
    isSearching: false,
    startAt: createdAt,
    endAt: createdAt,
    searchKey: stringValue(source.key),
    searchPlanKey: PTPP_SEARCH_SOLUTION_ID,
    searchPlan: {},
    searchResult: (source.result ?? []).map(convertPtppSearchResult),
  };
}

function convertKeepUploadTask(sourceValue: KeepUploadTaskRecord): IKeepUploadTask {
  const source = record(sourceValue);
  const sourceDownloadOptions = record(source.downloadOptions);
  const downloaderId = stringValue(sourceDownloadOptions.downloaderId || sourceDownloadOptions.clientId, "local");
  const items = (Array.isArray(source.items) ? source.items : []).map((item) => {
    const torrent = convertLegacyTorrent(item, stringValue(source.title, "PTPP imported task"));
    return {
      ...torrent,
      link: torrent.url ?? "",
      url: torrent.link ?? "",
      size: torrent.size ?? 0,
    } as IKeepUploadTaskItem;
  });
  const addTorrentOptions = record(sourceDownloadOptions.addTorrentOptions);
  if (typeof sourceDownloadOptions.autoStart === "boolean") {
    addTorrentOptions.addAtPaused = !sourceDownloadOptions.autoStart;
  }
  const label = sourceDownloadOptions.label ?? sourceDownloadOptions.tag ?? sourceDownloadOptions.tags?.[0];
  if (label) addTorrentOptions.label = label;
  return {
    id: stringValue(source.id, `ptpp-task-${stableHash(source)}`),
    time: timeValue(source.time, 0),
    title: stringValue(source.title, items[0]?.title ?? "PTPP imported task"),
    size: numberValue(source.size, items[0]?.size ?? 0),
    downloadOptions: {
      downloaderId,
      savePath: stringValue(sourceDownloadOptions.savePath) || undefined,
      clientName: stringValue(sourceDownloadOptions.clientName, downloaderId),
      addTorrentOptions,
    },
    items,
  };
}

function downloadHistoryMigrationKeys(source: DownloadHistoryRecord[]): string[] {
  const occurrences = new Map<string, number>();
  return source.map((item) => {
    const fingerprint = stableHash(item);
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);
    return `ptpp:${fingerprint}:${occurrence}`;
  });
}

export function convertPtppDownloadHistory(
  source: DownloadHistoryRecord[],
  existing: ITorrentDownloadMetadata[],
): ITorrentDownloadMetadata[] {
  const existingKeys = new Set(existing.map((item) => item.ptppMigrationKey).filter(Boolean));
  const keys = downloadHistoryMigrationKeys(source);
  return source.flatMap((item, index) => {
    const migrationKey = keys[index];
    if (existingKeys.has(migrationKey)) return [];
    const data = record(item.data);
    const torrent = convertLegacyTorrent({ ...data, siteId: item.siteId }, "PTPP legacy download");
    const addTorrentOptions: Record<string, any> = {};
    if (data.savePath) addTorrentOptions.savePath = data.savePath;
    if (typeof data.autoStart === "boolean") addTorrentOptions.addAtPaused = !data.autoStart;
    const label = data.label ?? data.tag ?? data.tags?.[0];
    if (label) addTorrentOptions.label = label;
    return [
      {
        siteId: torrent.site,
        torrentId: torrent.id,
        downloaderId: stringValue(item.downloaderId || item.clientId, "local"),
        title: torrent.title,
        subTitle: torrent.subTitle,
        url: torrent.url,
        link: torrent.link,
        downloadAt: timeValue(item.time, 0),
        downloadStatus: item.success === false ? "failed" : "completed",
        torrent,
        addTorrentOptions,
        ptppMigrationKey: migrationKey,
      } as ITorrentDownloadMetadata,
    ];
  });
}

export function mergePtppRuntimeData(state: MV3State, input: PtppRuntimeStores): PtppRuntimeDataMergeResult {
  const metadata = clone(input.metadata);
  const userInfo = clone(input.userInfo ?? {});
  const searchResultSnapshot = clone(input.searchResultSnapshot ?? {});
  const keepUploadTask = clone(input.keepUploadTask ?? {});
  const downloadHistory = clone(input.downloadHistory ?? []);
  const supportedSiteIds = new Set(Object.keys(metadata.sites));
  let importedUserHistory = 0;
  let importedUserHistorySites = 0;
  let importedSearchSnapshots = 0;
  let importedKeepUploadTasks = 0;

  for (const [siteId, history] of Object.entries(state.userHistory)) {
    if (!supportedSiteIds.has(siteId)) continue;
    userInfo[siteId] ??= {};
    let siteImported = false;
    for (const [date, source] of Object.entries(history)) {
      if (date === "latest" || userInfo[siteId][date]) continue;
      userInfo[siteId][date] = convertPtppUserInfo(source, siteId);
      importedUserHistory++;
      siteImported = true;
    }
    if (!metadata.lastUserInfo[siteId]) {
      const dates = Object.keys(history)
        .filter((date) => date !== "latest")
        .sort();
      const latest = history.latest ?? history[dates.at(-1) ?? ""];
      if (latest) metadata.lastUserInfo[siteId] = convertPtppUserInfo(latest, siteId);
    }
    if (siteImported) importedUserHistorySites++;
  }

  for (const source of state.searchSnapshots) {
    const id = snapshotId(source);
    if (metadata.snapshots[id] || searchResultSnapshot[id]) continue;
    const data = convertSnapshot(source);
    searchResultSnapshot[id] = data;
    metadata.snapshots[id] = {
      id,
      name: `[PTPP] ${stringValue(source.key, "搜索快照")}`,
      createdAt: timeValue(source.time, 0),
      recordCount: data.searchResult.length,
    };
    importedSearchSnapshots++;
  }

  for (const source of state.keepUploadTasks) {
    const task = convertKeepUploadTask(source);
    if (keepUploadTask[task.id]) continue;
    keepUploadTask[task.id] = task;
    importedKeepUploadTasks++;
  }

  const downloadHistoryAdditions = convertPtppDownloadHistory(state.downloadHistory, downloadHistory);
  return {
    metadata,
    userInfo,
    searchResultSnapshot,
    keepUploadTask,
    downloadHistory,
    downloadHistoryAdditions,
    importedCounts: {
      userHistorySites: importedUserHistorySites,
      userHistory: importedUserHistory,
      searchSnapshots: importedSearchSnapshots,
      keepUploadTasks: importedKeepUploadTasks,
      downloadHistory: downloadHistoryAdditions.length,
    },
  };
}
