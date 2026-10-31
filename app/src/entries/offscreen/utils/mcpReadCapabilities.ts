import type { IMcpCapabilityDescriptor, TMcpCapabilityName } from "@/shared/mcpBridge.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";
import type { IMcpBusinessRegistry, TMcpMessage } from "./mcpBusinessCapabilities.ts";
import { redactMcpText } from "@/shared/mcpRedaction.ts";

type JsonObject = Record<string, unknown>;

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const pagination = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
};

function page(input: unknown, defaultLimit = 25) {
  const value = input && typeof input === "object" ? input as JsonObject : {};
  const offset = Number(value.offset);
  const limit = Number(value.limit);
  return {
    offset: Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0,
    limit: Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : defaultLimit,
  };
}

function paginate<T>(items: T[], input: unknown) {
  const { offset, limit } = page(input);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    limit,
    ...(offset + limit < items.length ? { nextOffset: offset + limit } : {}),
  };
}

function text(value: unknown, max = 240): string | undefined {
  return typeof value === "string" && value.trim() ? redactMcpText(value.trim(), max) : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeItemKey(item: JsonObject, index: number): string {
  // The stable key is intentionally opaque: links and URLs never cross the
  // extension boundary, while callers can still refer to an item in a report.
  const source = `${text(item.siteId) ?? "site"}|${text(item.title, 180) ?? "item"}|${number(item.time) ?? index}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `item-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function projectCollection(input: unknown) {
  const state = input && typeof input === "object" ? input as JsonObject : {};
  const groups = Array.isArray(state.groups)
    ? state.groups.map((group, index) => {
        const value = group && typeof group === "object" ? group as JsonObject : {};
        return {
          id: text(value.id) ?? `group-${index}`,
          name: text(value.name, 120) ?? "未命名分组",
          color: text(value.color, 32),
          description: text(value.description, 240),
          count: number(value.count),
        };
      })
    : [];
  const items = Array.isArray(state.items)
    ? state.items.map((item, index) => {
        const value = item && typeof item === "object" ? item as JsonObject : {};
        return {
          itemKey: safeItemKey(value, index),
          siteId: text(value.siteId),
          title: text(value.title, 240),
          subTitle: text(value.subTitle, 240),
          size: number(value.size),
          savedAt: number(value.time),
          groupIds: Array.isArray(value.groups) ? value.groups.filter((id): id is string => typeof id === "string").slice(0, 20) : [],
          imdbId: text(value.imdbId, 32),
        };
      })
    : [];
  return { groups, defaultGroupId: text(state.defaultGroupId, 120), ...paginate(items, undefined) };
}

function projectDownloadHistory(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  const items = values.map((entry, index) => {
    const value = entry && typeof entry === "object" ? entry as JsonObject : {};
    const torrent = value.torrent && typeof value.torrent === "object" ? value.torrent as JsonObject : {};
    return {
      id: text(value.id, 160) ?? `history-${index}`,
      siteId: text(value.siteId),
      title: text(value.title) ?? text(torrent.title),
      subTitle: text(value.subTitle) ?? text(torrent.subTitle),
      size: number(torrent.size) ?? number(value.size),
      downloaderId: text(value.downloaderId, 120),
      status: text(value.downloadStatus, 40),
      downloadedAt: number(value.downloadAt),
      error: text(value.errorMessage, 240),
    };
  });
  return paginate(items, undefined);
}

function projectKeepUploadTasks(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  const items = values.map((entry, index) => {
    const value = entry && typeof entry === "object" ? entry as JsonObject : {};
    const options = value.downloadOptions && typeof value.downloadOptions === "object" ? value.downloadOptions as JsonObject : {};
    const taskItems = Array.isArray(value.items) ? value.items : [];
    return {
      taskId: text(value.id, 160) ?? `task-${index}`,
      title: text(value.title, 240),
      size: number(value.size),
      createdAt: number(value.time),
      downloaderId: text(options.downloaderId, 120),
      itemCount: taskItems.length,
      sites: [...new Set(taskItems.map((item) => item && typeof item === "object" ? text((item as JsonObject).site) : undefined).filter((id): id is string => Boolean(id)))],
      items: taskItems.slice(0, 20).map((item) => {
        const child = item && typeof item === "object" ? item as JsonObject : {};
        return { siteId: text(child.site), title: text(child.title, 240), size: number(child.size) };
      }),
    };
  });
  return paginate(items, undefined);
}

function projectTorrentList(input: unknown, downloaderId: string) {
  const raw = input && typeof input === "object" ? input as JsonObject : {};
  const values = Array.isArray(raw.data) ? raw.data : [];
  const items = values.map((entry, index) => {
    const value = entry && typeof entry === "object" ? entry as JsonObject : {};
    return {
      id: text(value.id, 200) ?? `torrent-${index}`,
      name: text(value.name, 300),
      hash: text(value.hash, 160),
      status: text(value.status, 80),
      progress: number(value.progress),
      size: number(value.size),
      uploaded: number(value.uploaded),
      downloaded: number(value.downloaded),
      uploadSpeed: number(value.uploadSpeed),
      downloadSpeed: number(value.downloadSpeed),
      addedAt: number(value.addedAt),
      downloaderId,
    };
  });
  return { ...paginate(items, undefined), sourceStatus: text(raw.success === true ? "ok" : "error"), error: text(raw.error, 240) };
}

function projectSnapshot(input: unknown, id: string) {
  const value = input && typeof input === "object" ? input as JsonObject : {};
  // Persisted ISearchData stores the torrent list under `searchResult`.
  // Keep the older fixture aliases for migrated snapshots, but never pass
  // through the complete raw snapshot object.
  const results = Array.isArray(value.searchResult)
    ? value.searchResult
    : Array.isArray(value.data)
      ? value.data
      : Array.isArray(value.result)
        ? value.result
        : [];
  return {
    snapshotId: id,
    resultCount: results.length,
    items: results.slice(0, 50).map((entry, index) => {
      const item = entry && typeof entry === "object" ? entry as JsonObject : {};
      return { itemKey: safeItemKey(item, index), siteId: text(item.site), title: text(item.title, 300), subTitle: text(item.subTitle, 240), size: number(item.size), seeders: number(item.seeders), leechers: number(item.leechers) };
    }),
  };
}

export function createMcpReadCapabilities(sendMessage: TMcpMessage): IMcpBusinessRegistry {
  const descriptors: IMcpCapabilityDescriptor[] = ([
    ["ptpp.collections.list", "读取收藏项目与分组摘要，不返回详情链接。", objectSchema(pagination)],
    ["ptpp.download_history.list", "读取下载历史摘要，不返回下载链接、请求头或保存路径。", objectSchema(pagination)],
    ["ptpp.reseed.list", "读取辅种任务摘要，不返回磁链、下载链接或保存路径。", objectSchema(pagination)],
    ["ptpp.downloaders.torrents", "读取指定下载器的任务摘要，不返回地址、凭据或完整保存路径。", objectSchema({ downloaderId: { type: "string", minLength: 1 }, ...pagination }, ["downloaderId"])],
    ["ptpp.snapshots.list", "读取搜索快照的摘要和有限结果，不返回详情链接。", objectSchema(pagination)],
    ["ptpp.snapshots.get", "读取单个搜索快照的有限结果，不返回详情链接。", objectSchema({ snapshotId: { type: "string", minLength: 1 } }, ["snapshotId"])],
  ] as const).map(([id, description, inputSchema]) => ({
    id: id as TMcpCapabilityName,
    version: 1 as const,
    kind: "query" as const,
    sensitivity: "account" as const,
    description,
    confirmation: "none" as const,
    inputSchema,
    outputSchema: { type: "object" },
    maxResultBytes: 262_144,
  }));

  const handlers = new Map<TMcpCapabilityName, (input: unknown) => Promise<unknown>>();
  handlers.set("ptpp.collections.list", async (input) => {
    const state = await sendMessage("getPtppCollectionState");
    const projected = projectCollection(state);
    const pageResult = paginate(projected.items, input);
    return { groups: projected.groups, defaultGroupId: projected.defaultGroupId, ...pageResult };
  });
  handlers.set("ptpp.download_history.list", async (input) => {
    const history = await sendMessage("getDownloadHistory");
    const projected = projectDownloadHistory(history);
    return { ...paginate(projected.items, input), total: projected.items.length };
  });
  handlers.set("ptpp.reseed.list", async (input) => {
    const tasks = await sendMessage("getKeepUploadTasks");
    const projected = projectKeepUploadTasks(tasks);
    return { ...paginate(projected.items, input), total: projected.items.length };
  });
  handlers.set("ptpp.downloaders.torrents", async (input) => {
    const value = input && typeof input === "object" ? input as JsonObject : {};
    const downloaderId = text(value.downloaderId, 160);
    if (!downloaderId) throw new Error("downloaderId is required");
    const result = await sendMessage("getClientTorrents", downloaderId);
    const projected = projectTorrentList(result, downloaderId);
    return { ...paginate(projected.items, input), sourceStatus: projected.sourceStatus, error: projected.error };
  });
  handlers.set("ptpp.snapshots.list", async (input) => {
    const storage = await sendMessage("getExtStorage", "searchResultSnapshot") as Record<string, unknown> | undefined;
    const entries = Object.entries(storage ?? {}).map(([id, value]) => {
      const projected = projectSnapshot(value, id);
      return { snapshotId: id, resultCount: projected.resultCount, firstTitles: projected.items.slice(0, 5).map((item) => item.title).filter((title): title is string => Boolean(title)) };
    });
    return paginate(entries, input);
  });
  handlers.set("ptpp.snapshots.get", async (input) => {
    const value = input && typeof input === "object" ? input as JsonObject : {};
    const id = text(value.snapshotId, 200);
    if (!id) throw new Error("snapshotId is required");
    return projectSnapshot(await sendMessage("getSearchResultSnapshotData", id), id);
  });
  return { descriptors, handlers };
}
