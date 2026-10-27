import { getDefinedSiteMetadata, getNextLevelUnMet, type IUserInfo, type ILevelRequirement } from "@ptd/site";

import type { IMcpCapabilityDescriptor, TMcpCapabilityName } from "@/shared/mcpBridge.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";

/**
 * Business-facing MCP projections.  This module intentionally does not expose
 * storage records, cookies, usernames, downloader addresses or backup paths.
 * The bridge supplies the message function so this registry remains easy to
 * test without a browser or CDP.
 */
export type TMcpMessage = (type: string, data?: unknown) => Promise<any>;

export interface IMcpBusinessRegistry {
  descriptors: IMcpCapabilityDescriptor[];
  handlers: Map<TMcpCapabilityName, (input: unknown) => Promise<unknown>>;
}

type TPage = { offset: number; limit: number };

type TJsonSchema = Record<string, unknown>;

const paginationProperties: TJsonSchema = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
};

const objectSchema = (properties: TJsonSchema, required: string[] = []): TJsonSchema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const businessSchemas: Partial<Record<TMcpCapabilityName, { inputSchema: TJsonSchema; outputSchema: TJsonSchema }>> = {
  "ptpp.sites.list": {
    inputSchema: objectSchema(paginationProperties),
    outputSchema: objectSchema({
      items: { type: "array", items: { type: "object" } },
      total: { type: "integer" },
      offset: { type: "integer" },
      limit: { type: "integer" },
      nextOffset: { type: "integer" },
    }),
  },
  "ptpp.user_data.get": {
    inputSchema: objectSchema({ siteIds: { type: "array", items: { type: "string" }, maxItems: 50 }, ...paginationProperties }),
    outputSchema: objectSchema({ items: { type: "array", items: { type: "object" } }, total: { type: "integer" }, offset: { type: "integer" }, limit: { type: "integer" }, nextOffset: { type: "integer" } }),
  },
  "ptpp.user_data.refresh": {
    inputSchema: objectSchema({ siteId: { type: "string", minLength: 1 } }, ["siteId"]),
    outputSchema: { type: "object" },
  },
  "ptpp.downloaders.list": {
    inputSchema: objectSchema(paginationProperties),
    outputSchema: objectSchema({ items: { type: "array", items: { type: "object" } }, total: { type: "integer" }, offset: { type: "integer" }, limit: { type: "integer" }, nextOffset: { type: "integer" } }),
  },
  "ptpp.downloaders.status": {
    inputSchema: objectSchema({ downloaderId: { type: "string", minLength: 1 } }, ["downloaderId"]),
    outputSchema: { type: "object" },
  },
  "ptpp.search.start": {
    inputSchema: objectSchema({ keyword: { type: "string", minLength: 1, maxLength: 240 }, siteIds: { type: "array", items: { type: "string" }, maxItems: 50 } }, ["keyword"]),
    outputSchema: objectSchema({ jobId: { type: "string" }, status: { type: "string" }, createdAt: { type: "integer" } }),
  },
  "ptpp.search.status": {
    inputSchema: objectSchema({ jobId: { type: "string", minLength: 1 } }, ["jobId"]),
    outputSchema: { type: "object" },
  },
  "ptpp.search.results": {
    inputSchema: objectSchema({ jobId: { type: "string", minLength: 1 }, ...paginationProperties }, ["jobId"]),
    outputSchema: { type: "object" },
  },
  "ptpp.signin.status": {
    inputSchema: objectSchema({ siteIds: { type: "array", items: { type: "string" }, maxItems: 50 }, ...paginationProperties }),
    outputSchema: objectSchema({ items: { type: "array", items: { type: "object" } }, total: { type: "integer" }, offset: { type: "integer" }, limit: { type: "integer" }, nextOffset: { type: "integer" } }),
  },
  "ptpp.signin.run": {
    inputSchema: objectSchema({ siteId: { type: "string", minLength: 1 } }, ["siteId"]),
    outputSchema: { type: "object" },
  },
  "ptpp.backups.list": {
    inputSchema: objectSchema(paginationProperties),
    outputSchema: objectSchema({ items: { type: "array", items: { type: "object" } }, total: { type: "integer" }, offset: { type: "integer" }, limit: { type: "integer" }, nextOffset: { type: "integer" } }),
  },
  "ptpp.backups.history": {
    inputSchema: objectSchema({ backupServerId: { type: "string", minLength: 1 }, ...paginationProperties }, ["backupServerId"]),
    outputSchema: objectSchema({ items: { type: "array", items: { type: "object" } }, total: { type: "integer" }, offset: { type: "integer" }, limit: { type: "integer" }, nextOffset: { type: "integer" } }),
  },
};

function page(input: unknown, defaultLimit = 25): TPage {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawOffset = Number(value.offset);
  const rawLimit = Number(value.limit);
  return {
    offset: Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0,
    limit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : defaultLimit,
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

const numericUserFields = [
  "totalTraffic",
  "downloaded",
  "trueDownloaded",
  "uploaded",
  "trueUploaded",
  "ratio",
  "trueRatio",
  "seeding",
  "seedingSize",
  "seedingTime",
  "averageSeedingTime",
  "bonus",
  "seedingBonus",
  "bonusPerHour",
  "seedingBonusPerHour",
  "uploads",
  "leeching",
  "snatches",
  "posts",
  "adoptions",
  "hnrUnsatisfied",
  "hnrPreWarning",
] as const;

function numericProjection(value: Record<string, unknown>) {
  const output: Record<string, number> = {};
  for (const key of numericUserFields) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) output[key] = candidate;
  }
  return output;
}

function requirementProjection(requirement: ILevelRequirement | undefined): Record<string, unknown> | undefined {
  if (!requirement) return undefined;
  const output: Record<string, unknown> = { name: requirement.name };
  for (const key of numericUserFields) {
    const value = requirement[key];
    if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "string" && value.length <= 64) output[key] = value;
    else if (Array.isArray(value) && value.length <= 2 && value.every((item) => typeof item === "number")) output[key] = value;
  }
  if (requirement.interval && typeof requirement.interval === "string") output.interval = requirement.interval;
  return output;
}

async function projectUser(siteId: string, userInfo: IUserInfo | undefined): Promise<Record<string, unknown>> {
  if (!userInfo || typeof userInfo !== "object") return { siteId, available: false };
  const metadata = await getDefinedSiteMetadata(siteId);
  const levelRequirements = (metadata.levelRequirements ?? []) as ILevelRequirement[];
  const cloned = { ...userInfo };
  const unmet = getNextLevelUnMet(cloned, levelRequirements);
  const nextLevel = unmet.level as ILevelRequirement | undefined;
  const { level, levelName, status, updateAt, joinTime } = userInfo as Record<string, unknown>;
  const next = nextLevel
    ? {
        status: Object.keys(unmet).filter((key) => key !== "level").length ? "incomplete" : "met",
        requirements: requirementProjection(nextLevel),
        unmet: numericProjection(unmet as Record<string, unknown>),
      }
    : { status: "max-or-unknown" };
  return {
    siteId,
    available: true,
    status,
    updatedAt: typeof updateAt === "number" ? updateAt : undefined,
    joinedAt: typeof joinTime === "number" ? joinTime : undefined,
    statistics: { level: levelName ?? level, ...numericProjection(userInfo as Record<string, unknown>) },
    nextLevel: next,
  };
}

function torrentProjection(item: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const key of ["site", "id", "title", "subTitle", "time", "size", "seeders", "leechers", "completed", "comments", "category", "tags"]) {
    const value = item[key];
    if (typeof value === "string" || typeof value === "number" || (key === "tags" && Array.isArray(value))) output[key] = value;
  }
  return output;
}

interface ISearchJob {
  status: "running" | "completed" | "failed";
  createdAt: number;
  results: Record<string, unknown>[];
  failures: Record<string, unknown>[];
  error?: string;
}

export function createMcpBusinessCapabilities(sendMessage: TMcpMessage): IMcpBusinessRegistry {
  const jobs = new Map<string, ISearchJob>();
  const descriptors = ( [
    ["ptpp.sites.list", "query", "读取已配置站点的非敏感摘要。"],
    ["ptpp.user_data.get", "query", "读取站点统计、等级要求与下一等级差额。"],
    ["ptpp.user_data.refresh", "action", "刷新单个站点用户数据。"],
    ["ptpp.downloaders.list", "query", "读取下载器的非敏感配置摘要。"],
    ["ptpp.downloaders.status", "query", "读取下载器实时状态。"],
    ["ptpp.search.start", "action", "在指定站点启动一次搜索任务。"],
    ["ptpp.search.status", "query", "读取搜索任务状态。"],
    ["ptpp.search.results", "query", "分页读取搜索任务结果。"],
    ["ptpp.signin.status", "query", "读取签到状态摘要。"],
    ["ptpp.signin.run", "action", "手动执行单站点签到。"],
    ["ptpp.backups.list", "query", "读取备份服务器摘要。"],
    ["ptpp.backups.history", "query", "读取备份历史摘要，不返回路径或配置。"],
  ] as const).map(([id, kind, description]) => ({
    id: id as TMcpCapabilityName,
    version: 1 as const,
    kind,
    sensitivity: "account" as const,
    description,
    confirmation: "none" as const,
    inputSchema: businessSchemas[id as TMcpCapabilityName]?.inputSchema,
    outputSchema: businessSchemas[id as TMcpCapabilityName]?.outputSchema,
    maxResultBytes: 262_144,
  }));

  const handlers = new Map<TMcpCapabilityName, (input: unknown) => Promise<unknown>>();
  handlers.set("ptpp.sites.list", async (input) => {
    const sites = (await sendMessage("getSiteList")) as Array<{ id: string; name: string; offline: boolean }>;
    return paginate(sites.map(({ id, name, offline }) => ({ id, name, offline })), input);
  });
  handlers.set("ptpp.user_data.get", async (input) => {
    const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const requested = Array.isArray(value.siteIds) ? value.siteIds.filter((site): site is string => typeof site === "string") : [];
    const metadata = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
    const siteIds = requested.length ? requested : Object.keys(metadata?.lastUserInfo ?? {});
    const items = await Promise.all(siteIds.map((siteId) => projectUser(siteId, metadata?.lastUserInfo?.[siteId])));
    return paginate(items, input);
  });
  handlers.set("ptpp.user_data.refresh", async (input) => {
    const siteId = input && typeof input === "object" && typeof (input as any).siteId === "string" ? (input as any).siteId : "";
    if (!siteId) throw new Error("siteId is required");
    const result = await sendMessage("getSiteUserInfoResult", siteId);
    return await projectUser(siteId, result);
  });
  handlers.set("ptpp.downloaders.list", async (input) => {
    const list = (await sendMessage("getDownloaderList")) as Array<{ id: string; name: string; type: string; enabled: boolean }>;
    return paginate(list.map(({ id, name, type, enabled }) => ({ id, name, type, enabled })), input);
  });
  handlers.set("ptpp.downloaders.status", async (input) => {
    const id = input && typeof input === "object" && typeof (input as any).downloaderId === "string" ? (input as any).downloaderId : "";
    if (!id) throw new Error("downloaderId is required");
    return { downloaderId: id, status: await sendMessage("getDownloaderStatus", id) };
  });
  handlers.set("ptpp.search.start", async (input) => {
    const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const keyword = typeof value.keyword === "string" ? value.keyword.trim().slice(0, 240) : "";
    if (!keyword) throw new Error("keyword is required");
    const siteIds = Array.isArray(value.siteIds) ? value.siteIds.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const job: ISearchJob = { status: "running", createdAt: Date.now(), results: [], failures: [] };
    jobs.set(jobId, job);
    void (async () => {
      const sites = siteIds.length ? siteIds : Object.keys(((await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema)?.sites ?? {});
      await Promise.all(sites.map(async (siteId: string) => {
        try {
          const result = await sendMessage("getSiteSearchResult", { siteId, keyword });
          for (const item of result?.data ?? []) job.results.push(torrentProjection(item));
        } catch (error) {
          job.failures.push({ siteId, status: "failed", message: error instanceof Error ? error.message.slice(0, 160) : "search failed" });
        }
      }));
      job.status = "completed";
    })().catch((error) => { job.status = "failed"; job.error = error instanceof Error ? error.message.slice(0, 160) : "search failed"; });
    return { jobId, status: job.status, createdAt: job.createdAt };
  });
  handlers.set("ptpp.search.status", async (input) => {
    const id = input && typeof input === "object" && typeof (input as any).jobId === "string" ? (input as any).jobId : "";
    const job = jobs.get(id);
    if (!job) throw new Error("unknown search job");
    return { jobId: id, status: job.status, resultCount: job.results.length, failureCount: job.failures.length, error: job.error };
  });
  handlers.set("ptpp.search.results", async (input) => {
    const id = input && typeof input === "object" && typeof (input as any).jobId === "string" ? (input as any).jobId : "";
    const job = jobs.get(id);
    if (!job) throw new Error("unknown search job");
    return { jobId: id, status: job.status, ...paginate(job.results, input), failures: job.failures };
  });
  handlers.set("ptpp.signin.status", async (input) => {
    const metadata = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
    const ids = input && typeof input === "object" && Array.isArray((input as any).siteIds) ? (input as any).siteIds.filter((id: unknown): id is string => typeof id === "string") : Object.keys(metadata?.siteSignIns ?? {});
    return paginate(ids.map((siteId: string) => ({ siteId, ...(metadata?.siteSignIns?.[siteId] ?? { status: "unknown" }) })), input);
  });
  handlers.set("ptpp.signin.run", async (input) => {
    const siteId = input && typeof input === "object" && typeof (input as any).siteId === "string" ? (input as any).siteId : "";
    if (!siteId) throw new Error("siteId is required");
    return await sendMessage("runSiteSignIn", siteId);
  });
  handlers.set("ptpp.backups.list", async (input) => {
    const metadata = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
    const list = Object.values(metadata?.backupServers ?? {}).map((server: any) => ({ id: server.id, name: server.name, type: server.type, enabled: server.enabled, backupFields: server.backupFields }));
    return paginate(list, input);
  });
  handlers.set("ptpp.backups.history", async (input) => {
    const id = input && typeof input === "object" && typeof (input as any).backupServerId === "string" ? (input as any).backupServerId : "";
    if (!id) throw new Error("backupServerId is required");
    const metadata = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
    const history = metadata?.backupServers?.[id]?.backupHistory ?? [];
    return paginate(history.map((item: any) => ({ id: item.id, startedAt: item.startedAt, finishedAt: item.finishedAt, durationMs: item.durationMs, status: item.status, trigger: item.trigger, retryIndex: item.retryIndex, fields: item.fields, cleanup: item.cleanup, error: item.error })), input);
  });
  return { descriptors, handlers };
}
