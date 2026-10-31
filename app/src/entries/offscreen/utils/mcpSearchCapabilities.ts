import PQueue from "p-queue";
import { EResultParseStatus } from "../../../packages/site/types/base.ts";
import { ETorrentStatus } from "../../../packages/site/types/torrent.ts";
import type { ISiteMetadata } from "@ptd/site";
import { createMovieIdentityFromSuggestion, normalizeMovieExternalIds, parseDirectMovieIdentity } from "../../../packages/social/movieEntity.ts";
import type { ISocialMovieSuggestion } from "../../../packages/social/movieSuggestions.ts";
import { redactMcpText } from "../../shared/mcpRedaction.ts";
import { resolveSearchSolution } from "../../shared/searchPlan.ts";
import type { IMcpCapabilityDescriptor, IMcpSearchPresentationPayload, TMcpCapabilityName } from "../../shared/mcpBridge.ts";
import type { IMetadataPiniaStorageSchema } from "../../shared/types.ts";
import type { IMcpBusinessRegistry, TMcpMessage } from "./mcpBusinessCapabilities.ts";

type JsonObject = Record<string, unknown>;
type SearchStatus = "running" | "completed" | "partial" | "failed" | "cancelled";
type SearchSort = { field: "seeders" | "size" | "time" | "title"; direction: "asc" | "desc" };
type SearchFilters = {
  text?: string; excludeText?: string; resolution?: string; source?: string; codec?: string; subtitle?: string;
  year?: string; season?: string; minSeeders?: number; minSize?: number; maxSize?: number; siteIds?: string[];
};
interface SearchJob {
  jobId: string; keyword: string; solutionId: string; status: SearchStatus;
  createdAt: number; expiresAt: number; completedEntries: number; totalEntries: number;
  results: JsonObject[]; internalResults: Array<{ raw: JsonObject; siteId: string; entryId: string }>;
  entries: Array<{ siteId: string; entryId: string; settings: JsonObject }>;
  failures: JsonObject[]; seen: Set<string>; filters: SearchFilters; sort: SearchSort;
  truncated: boolean; queue: PQueue; startedEntries: number;
}
interface SearchOptions {
  now?: () => number;
  createId?: () => string;
  readSite?: (id: string) => Promise<ISiteMetadata>;
  ttlMs?: number;
  maxJobs?: number;
  maxResults?: number;
  requestTimeoutMs?: number;
}

const objectSchema = (properties: JsonObject, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const stringSchema = { type: "string", minLength: 1, maxLength: 240 };
const siteIdsSchema = { type: "array", items: { type: "string", minLength: 1, maxLength: 120 }, maxItems: 50 };
const filtersSchema = objectSchema({
  ...Object.fromEntries(["text", "excludeText", "resolution", "source", "codec", "subtitle", "year", "season"].map((key) => [key, stringSchema])),
  minSeeders: { type: "number", minimum: 0 }, minSize: { type: "number", minimum: 0 }, maxSize: { type: "number", minimum: 0 }, siteIds: siteIdsSchema,
});
const sortSchema = objectSchema({ field: { type: "string", enum: ["seeders", "size", "time", "title"] }, direction: { type: "string", enum: ["asc", "desc"] } }, ["field", "direction"]);
const idSchema = { type: "string", minLength: 1, maxLength: 100 };

function record(input: unknown, keys: string[]): JsonObject {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an object");
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error("Unsupported input field");
  return input as JsonObject;
}
function text(value: unknown, max = 240, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid text value");
  return value.trim();
}
function sites(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) throw new Error("Invalid siteIds");
  return [...new Set(value.map((item) => text(item, 120, true)!))];
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error("Invalid numeric range");
  return value;
}
function filters(value: unknown): SearchFilters {
  const input = record(value, ["text", "excludeText", "resolution", "source", "codec", "subtitle", "year", "season", "minSeeders", "minSize", "maxSize", "siteIds"]);
  const result: SearchFilters = {};
  for (const key of ["text", "excludeText", "resolution", "source", "codec", "subtitle", "year", "season"] as const) {
    if (input[key] !== undefined) result[key] = text(input[key]);
  }
  for (const key of ["minSeeders", "minSize", "maxSize"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < 0) throw new Error("Invalid filter range");
      result[key] = input[key];
    }
  }
  if (result.minSize !== undefined && result.maxSize !== undefined && result.minSize > result.maxSize) throw new Error("Minimum size exceeds maximum size");
  if (input.siteIds !== undefined) result.siteIds = sites(input.siteIds);
  return result;
}
function sort(value: unknown): SearchSort {
  if (value === undefined) return { field: "seeders", direction: "desc" };
  const input = record(value, ["field", "direction"]);
  if (!["seeders", "size", "time", "title"].includes(String(input.field)) || !["asc", "desc"].includes(String(input.direction))) throw new Error("Invalid sort");
  return input as SearchSort;
}
const normalized = (value: string) => value.normalize("NFKC").toLowerCase();
function matches(item: JsonObject, filter: SearchFilters): boolean {
  const tags = Array.isArray(item.tags) ? item.tags.map((tag) => typeof tag === "string" ? tag : tag?.name) : [];
  const haystack = normalized([item.title, item.subTitle, item.category, ...tags].join(" "));
  const contains = (value: string) => normalized(value).split(/\s+/).every((word) => haystack.includes(word));
  if (filter.text && !contains(filter.text)) return false;
  if (filter.excludeText && normalized(filter.excludeText).split(/\s+/).some((word) => haystack.includes(word))) return false;
  if (filter.siteIds?.length && !filter.siteIds.includes(String(item.site))) return false;
  if (filter.resolution) {
    const value = normalized(filter.resolution);
    if (["4k", "2160p", "uhd"].includes(value) ? !/\b(?:4k|2160p|uhd)\b/.test(haystack) : !contains(value)) return false;
  }
  if (filter.source) {
    const value = normalized(filter.source);
    if (["bluray", "blu-ray", "蓝光", "bd"].includes(value) ? !/\b(?:blu[ ._-]?ray|bd(?:rip|remux)?|brrip|bdmv)\b|蓝光/.test(haystack) : !contains(value)) return false;
  }
  for (const key of ["codec", "subtitle", "year"] as const) if (filter[key] && !contains(filter[key]!)) return false;
  if (filter.season) {
    const value = filter.season.replace(/^s/i, "");
    if (/^\d{1,2}$/.test(value)) {
      const season = String(Number(value)).padStart(2, "0");
      if (!haystack.includes(`s${season}`) && !haystack.includes(`season ${Number(value)}`) && !haystack.includes(`第${Number(value)}季`)) return false;
    } else if (!contains(filter.season)) return false;
  }
  for (const [filterKey, field, compare] of [["minSeeders", "seeders", "min"], ["minSize", "size", "min"], ["maxSize", "size", "max"]] as const) {
    if (filter[filterKey] !== undefined && (typeof item[field] !== "number" || (compare === "min" ? item[field] < filter[filterKey]! : item[field] > filter[filterKey]!))) return false;
  }
  return true;
}
function publicTorrent(raw: JsonObject, siteId: string, resultRef: string): JsonObject {
  const result: JsonObject = { resultRef, site: siteId };
  for (const key of ["id", "title", "subTitle", "category", "status", "ext_imdb", "ext_douban"]) {
    if (typeof raw[key] === "string") result[key] = redactMcpText(raw[key], key === "title" || key === "subTitle" ? 500 : 120);
    else if (typeof raw[key] === "number" && Number.isFinite(raw[key])) result[key] = raw[key];
  }
  for (const key of ["time", "size", "seeders", "leechers", "completed", "comments", "progress"]) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) result[key] = raw[key];
  }
  if (Array.isArray(raw.tags)) result.tags = raw.tags.slice(0, 12).map((tag) => typeof tag === "string" ? tag : tag?.name).filter((tag): tag is string => typeof tag === "string").map((tag) => redactMcpText(tag, 60));
  return result;
}
function safeMovie(item: ISocialMovieSuggestion, candidateRef?: string): JsonObject {
  return {
    ...(candidateRef ? { candidateRef } : {}), site: item.site, id: item.id,
    title: redactMcpText(item.title, 500), originalTitle: item.originalTitle ? redactMcpText(item.originalTitle, 500) : undefined,
    year: item.year ? redactMcpText(item.year, 16) : undefined, imdbId: normalizeMovieExternalIds({ imdb: item.imdbId }).imdb,
    searchTerm: redactMcpText(item.searchTerm, 240),
    ratingScore: item.ratingScore, ratingCount: item.ratingCount,
  };
}

/** Structured search operations using the same plans, queue library and site message as the UI. */
export function createMcpSearchCapabilities(sendMessage: TMcpMessage, options: SearchOptions = {}): IMcpBusinessRegistry {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const readSite = options.readSite ?? (async (id: string) => (await import("@ptd/site")).getDefinedSiteMetadata(id));
  const jobs = new Map<string, SearchJob>();
  const candidates = new Map<string, { item: ISocialMovieSuggestion; expiresAt: number }>();
  const ttl = options.ttlMs ?? 30 * 60_000;
  const maxJobs = options.maxJobs ?? 8;
  const maxResults = options.maxResults ?? 2_000;
  const presentations = new Map<string, { jobId: string; filters: SearchFilters; sort: SearchSort; createdAt: number; expiresAt: number }>();
  // One request queue across all assistant jobs: starting another conversation
  // must not multiply the user's configured per-site request concurrency.
  const requestQueue = new PQueue({ concurrency: 3 });
  let expirationTimer: ReturnType<typeof setTimeout> | undefined;
  const handlers = new Map<TMcpCapabilityName, (input: unknown) => Promise<unknown>>();
  const descriptors: IMcpCapabilityDescriptor[] = [];
  const register = (id: string, kind: "query" | "action", description: string, inputSchema: JsonObject, handler: (input: unknown) => Promise<unknown>) => {
    descriptors.push({ id: id as TMcpCapabilityName, kind, description, version: 1, sensitivity: "account", confirmation: "none", inputSchema, outputSchema: { type: "object" }, maxResultBytes: 262_144 });
    handlers.set(id as TMcpCapabilityName, handler);
  };
  function prune() {
    for (const [id, job] of jobs) if (job.expiresAt <= now()) { job.status = "cancelled"; job.queue.clear(); jobs.delete(id); }
    for (const [id, candidate] of candidates) if (candidate.expiresAt <= now()) candidates.delete(id);
    for (const [id, presentation] of presentations) if (presentation.expiresAt <= now()) presentations.delete(id);
  }
  function scheduleExpiry() {
    if (expirationTimer) clearTimeout(expirationTimer);
    const expiryDates = [...jobs.values(), ...candidates.values(), ...presentations.values()].map((value) => value.expiresAt);
    if (!expiryDates.length) return;
    expirationTimer = setTimeout(() => { prune(); scheduleExpiry(); }, Math.max(1, Math.min(...expiryDates) - now()));
    // Browser timers need no special handling; deterministic Node tests should
    // not be held open merely by a cache-expiration timer.
    if (typeof expirationTimer === "object" && "unref" in expirationTimer) expirationTimer.unref();
  }
  function jobById(value: unknown) {
    prune();
    const id = text(value, 100, true)!;
    const job = jobs.get(id);
    if (!job) throw new Error("Search job expired or not found; start a new search");
    return job;
  }
  function summary(job: SearchJob) {
    return { jobId: job.jobId, keyword: job.keyword, solutionId: job.solutionId, status: job.status, createdAt: job.createdAt, expiresAt: job.expiresAt,
      resultCount: job.results.length, totalEntries: job.totalEntries, completedEntries: job.completedEntries, failureCount: job.failures.length,
      filters: job.filters, sort: job.sort, truncated: job.truncated };
  }
  const metadata = async () => (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;

  register("ptpp.movies.search", "query", "查询影片候选（片名、年份、IMDb/豆瓣 ID）。多个同名候选时请让用户选择，不猜测影片。", objectSchema({ query: stringSchema, count: { type: "integer", minimum: 1, maximum: 10 } }, ["query"]), async (input) => {
    prune();
    const value = record(input, ["query", "count"]);
    const query = text(value.query, 240, true)!;
    const count = integer(value.count, 5, 1, 10);
    const response = await sendMessage("queryMovieSuggestions", { query, count });
    const items = (Array.isArray(response?.items) ? response.items : []).slice(0, count).map((item: ISocialMovieSuggestion) => {
      const ref = createId();
      candidates.set(ref, { item, expiresAt: now() + ttl });
      return safeMovie(item, ref);
    });
    while (candidates.size > 100) candidates.delete(candidates.keys().next().value!);
    scheduleExpiry();
    return { items, failed: response?.failed === true, fromCache: response?.fromCache === true, ambiguous: items.length > 1 };
  });
  register("ptpp.movies.get", "query", "读取候选或明确 IMDb/豆瓣 ID 的资料与评分，复用插件影片资料来源。失败时仍可直接搜索关键词。", objectSchema({ candidateRef: idSchema, imdbId: { type: "string", pattern: "^tt[0-9]{7,10}$" }, doubanId: { type: "string", pattern: "^[0-9]{5,12}$" } }), async (input) => {
    prune();
    const value = record(input, ["candidateRef", "imdbId", "doubanId"]);
    const specified = [value.candidateRef, value.imdbId, value.doubanId].filter((item) => item !== undefined);
    if (specified.length !== 1) throw new Error("Choose a candidate or one external ID");
    let identity;
    if (value.candidateRef) {
      const candidate = candidates.get(text(value.candidateRef, 100, true)!);
      if (!candidate) throw new Error("Movie candidate expired");
      const enriched = await sendMessage("getMovieSuggestionDetails", { item: candidate.item });
      identity = createMovieIdentityFromSuggestion(enriched.item ?? candidate.item, (enriched.item ?? candidate.item).searchTerm);
    } else {
      const imdb = text(value.imdbId, 12);
      const douban = text(value.doubanId, 12);
      if (imdb && !/^tt\d{7,10}$/.test(imdb) || douban && !/^\d{5,12}$/.test(douban)) throw new Error("Invalid movie ID");
      identity = parseDirectMovieIdentity(imdb ? `imdb|${imdb}` : `douban|${douban}`);
    }
    if (!identity) throw new Error("Movie identity unavailable");
    const response = await sendMessage("getMovieEntity", { identity, allowStale: true });
    const entity = response?.entity ?? {};
    const details: JsonObject = {};
    for (const key of ["title", "originalTitle", "aliases", "year", "mediaType", "regions", "genres", "directors", "writers", "cast", "releaseDates", "runtimes", "summary"]) {
      const field = entity[key];
      if (typeof field?.value === "string") details[key] = { value: redactMcpText(field.value, key === "summary" ? 3_000 : 500), source: field.source };
      else if (Array.isArray(field?.value)) details[key] = { value: field.value.filter((item: unknown) => typeof item === "string").slice(0, 20).map((item: string) => redactMcpText(item, 160)), source: field.source };
    }
    return { ids: normalizeMovieExternalIds(entity.ids ?? identity.ids), title: redactMcpText(identity.title, 500), details,
      ratings: Object.values(entity.ratings ?? {}).map((rating: any) => ({ source: rating.source, score: rating.score, scale: rating.scale, count: rating.count })),
      providers: Object.values(response?.providers ?? {}).map((provider: any) => ({ provider: provider.provider, state: provider.state, errorCode: provider.errorCode })),
      fromCache: response?.fromCache === true, stale: response?.stale === true };
  });
  register("ptpp.search.plans", "query", "读取可用搜索方案和默认方案。按返回 ID 搜索，默认方案遵循用户当前配置。", objectSchema({}), async (input) => {
    record(input, []);
    const stored = await metadata();
    const defaultPlan = await resolveSearchSolution(stored, readSite, "default");
    const allPlan = await resolveSearchSolution(stored, readSite, "all");
    return { defaultSolutionId: stored.defaultSolutionId || "default", items: [
      { id: "default", name: "默认搜索方案", siteCount: new Set(defaultPlan?.solutions.map((entry) => entry.siteId)).size, default: true },
      { id: "all", name: "全部可搜索站点", siteCount: new Set(allPlan?.solutions.map((entry) => entry.siteId)).size, default: false },
      ...Object.values(stored.solutions ?? {}).filter((plan) => plan.enabled !== false).map((plan) => ({ id: plan.id, name: redactMcpText(plan.name, 160), siteCount: new Set(plan.solutions.map((item) => item.siteId)).size, default: plan.id === stored.defaultSolutionId })),
    ] };
  });
  register("ptpp.search.start", "action", "用户明确要求时启动资源搜索；返回 jobId。默认使用当前搜索方案，filters 是结果过滤条件；通过 status/results 继续查询，不重复发起同一搜索。", objectSchema({ keyword: stringSchema, siteIds: siteIdsSchema, solutionId: idSchema, filters: filtersSchema, sort: sortSchema }, ["keyword"]), async (input) => {
    prune();
    const value = record(input, ["keyword", "siteIds", "solutionId", "filters", "sort"]);
    let keyword = text(value.keyword, 240, true)!;
    const selectedSites = sites(value.siteIds);
    const solutionId = text(value.solutionId, 100) ?? (selectedSites?.length ? `site:${selectedSites.join(",")}` : "default");
    const initialFilters = filters(value.filters);
    const initialSort = sort(value.sort);
    const [stored, config] = await Promise.all([metadata(), sendMessage("getExtStorage", "config")]);
    for (const id of selectedSites ?? []) if (!Object.hasOwn(stored.sites ?? {}, id)) throw new Error("Requested site is not configured");
    if (!["default", "all"].includes(solutionId) && !solutionId.startsWith("site:") && stored.solutions?.[solutionId]?.enabled === false) throw new Error("Search plan is disabled");
    const plan = await resolveSearchSolution(stored, readSite, solutionId);
    if (!plan) throw new Error("Search plan not found");
    const entries = plan.solutions.filter((entry) => !selectedSites?.length || selectedSites.includes(entry.siteId)).flatMap((entry) =>
      Object.entries(entry.searchEntries).filter(([, settings]) => settings.enabled !== false).map(([entryId, settings]) => ({ siteId: entry.siteId, entryId, settings })),
    );
    if (!entries.length) throw new Error("No enabled search entries in this scope");
    if (config?.searchEntity?.treatTTQueryAsImdbSearch !== false && /^tt\d{7,10}$/.test(keyword)) keyword = `imdb|${keyword}`;
    while (jobs.size >= maxJobs) {
      const oldest = [...jobs.values()].find((job) => job.status !== "running");
      if (!oldest) throw new Error("Too many running searches; wait or cancel one");
      jobs.delete(oldest.jobId);
    }
    const concurrency = Math.max(1, Math.min(10, Math.floor(Number(config?.searchEntity?.queueConcurrency) || 3)));
    requestQueue.concurrency = concurrency;
    const queue = new PQueue({ concurrency });
    const jobId = createId();
    const job: SearchJob = { jobId, keyword, solutionId: plan.id, status: "running", createdAt: now(), expiresAt: now() + ttl,
      completedEntries: 0, startedEntries: 0, totalEntries: entries.length, results: [], internalResults: [],
      entries: entries.map(({ siteId, entryId, settings }) => ({ siteId, entryId, settings: settings as JsonObject })), failures: [], seen: new Set(), filters: initialFilters, sort: initialSort, truncated: false, queue };
    jobs.set(jobId, job);
    scheduleExpiry();
    for (const entry of entries) {
      void queue.add(async () => requestQueue.add(async () => {
        if (job.status !== "running" || job.expiresAt <= now()) return;
        job.startedEntries++;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const budget = options.requestTimeoutMs ?? Math.max(5_000, Math.min(120_000, Number(stored.sites[entry.siteId]?.timeout) || 30_000));
          const response = await Promise.race([
            sendMessage("getSiteSearchResult", { siteId: entry.siteId, keyword, searchEntry: entry.settings }),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("timeout")), budget + (options.requestTimeoutMs ? 0 : 1_000)); }),
          ]);
          if (job.status !== "running" || job.expiresAt <= now()) return;
          const status = response?.status;
          if (![EResultParseStatus.success, EResultParseStatus.noResults].includes(status)) {
            job.failures.push({ siteId: entry.siteId, entryId: entry.entryId, status: EResultParseStatus[status] ?? "unknownError", message: "站点搜索未成功；请检查该站点的登录状态或搜索入口。" });
            return;
          }
          for (const raw of Array.isArray(response.data) ? response.data : []) {
            if (!raw || typeof raw !== "object") continue;
            const key = `${entry.siteId}:${raw.id ?? raw.title}`;
            if (job.seen.has(key)) continue;
            const imdb = keyword.match(/^imdb\|(tt\d{7,10})$/)?.[1];
            if (imdb && config?.searchEntity?.forceImdbIdMatchFilter && raw.ext_imdb && String(raw.ext_imdb).match(/tt\d{7,10}/)?.[0] !== imdb) continue;
            if (job.results.length >= maxResults) { job.truncated = true; break; }
            job.seen.add(key);
            job.internalResults.push({ raw: raw as JsonObject, siteId: entry.siteId, entryId: entry.entryId });
            job.results.push(publicTorrent(raw, entry.siteId, `${jobId}:${job.results.length + 1}`));
          }
        } catch (error) {
          if (job.status === "running") job.failures.push({ siteId: entry.siteId, entryId: entry.entryId, status: error instanceof Error && error.message === "timeout" ? "timeout" : "failed", message: "站点搜索请求失败或超时；其他站点结果不受影响。" });
        } finally {
          if (timeout) clearTimeout(timeout);
          job.completedEntries++;
        }
      })).catch(() => undefined);
    }
    void queue.onIdle().then(() => {
      if (job.status === "running") job.status = job.failures.length === job.totalEntries ? "failed" : job.failures.length ? "partial" : "completed";
    });
    return summary(job);
  });
  register("ptpp.search.present", "action", "将已有搜索任务展示到 PTPP 搜索结果页；只在用户明确要求查看结果时调用，不会重新请求站点。", objectSchema({ jobId: idSchema, filters: filtersSchema, sort: sortSchema }, ["jobId"]), async (input) => {
    prune();
    const value = record(input, ["jobId", "filters", "sort"]);
    const job = jobById(value.jobId);
    const createdAt = now();
    const expiresAt = createdAt + Math.min(ttl, 5 * 60_000);
    const presentationId = createId();
    presentations.set(presentationId, {
      jobId: job.jobId,
      filters: value.filters === undefined ? job.filters : filters(value.filters),
      sort: value.sort === undefined ? job.sort : sort(value.sort),
      createdAt,
      expiresAt,
    });
    while (presentations.size > 16) presentations.delete(presentations.keys().next().value!);
    scheduleExpiry();
    try {
      await sendMessage("openOptionsPage", { path: "/search-entity", query: { mcpPresentation: presentationId } });
    } catch (error) {
      presentations.delete(presentationId);
      throw error;
    }
    return { status: job.status === "running" ? "staged" : "opened", presentationId, jobId: job.jobId, keyword: job.keyword, solutionId: job.solutionId, expiresAt, resultCount: job.results.length };
  });
  register("ptpp.search.status", "query", "读取搜索进度；running 表示仍在检索，不能将暂时无结果当作最终无结果。", objectSchema({ jobId: idSchema }, ["jobId"]), async (input) => {
    const value = record(input, ["jobId"]);
    return summary(jobById(value.jobId));
  });
  register("ptpp.search.results", "query", "分页读取并筛选已有搜索结果，不重新请求站点。默认保留该任务上次的筛选/排序；传 filters:{} 清除筛选。仅匹配标题/副标题/标签已提供的信息，不猜测缺失属性。", objectSchema({ jobId: idSchema, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 }, filters: filtersSchema, sort: sortSchema }, ["jobId"]), async (input) => {
    const value = record(input, ["jobId", "offset", "limit", "filters", "sort"]);
    const job = jobById(value.jobId);
    const offset = integer(value.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = integer(value.limit, 10, 1, 50);
    if (value.filters !== undefined) job.filters = filters(value.filters);
    if (value.sort !== undefined) job.sort = sort(value.sort);
    const items = job.results.filter((item) => matches(item, job.filters)).sort((a, b) => {
      const field = job.sort.field;
      if (a[field] === undefined) return b[field] === undefined ? 0 : 1;
      if (b[field] === undefined) return -1;
      const comparison = field === "title" ? String(a[field]).localeCompare(String(b[field])) : Number(a[field]) - Number(b[field]);
      return job.sort.direction === "asc" ? comparison : -comparison;
    });
    return { ...summary(job), items: items.slice(offset, offset + limit), total: items.length, unfilteredTotal: job.results.length, offset, limit,
      ...(offset + limit < items.length ? { nextOffset: offset + limit } : {}), failures: job.failures };
  });
  register("ptpp.search.cancel", "action", "取消已有搜索的排队任务并忽略迟到结果；已经发往站点的请求可能仍会完成，不执行下载。", objectSchema({ jobId: idSchema }, ["jobId"]), async (input) => {
    const value = record(input, ["jobId"]);
    const job = jobById(value.jobId);
    const inFlightMayComplete = job.status === "running" && job.queue.pending > 0;
    if (job.status === "running") { job.status = "cancelled"; job.queue.clear(); }
    return { ...summary(job), inFlightMayComplete };
  });
  const consumePresentation = async (token: string): Promise<IMcpSearchPresentationPayload | { status: "pending" | "expired" } | undefined> => {
    prune();
    const presentation = presentations.get(token);
    if (!presentation) return { status: "expired" };
    const job = jobs.get(presentation.jobId);
    if (!job) { presentations.delete(token); return { status: "expired" }; }
    if (job.status === "running") return { status: "pending" };
    presentations.delete(token);
    const filtered: JsonObject[] = job.internalResults
      .map((entry): JsonObject => ({
        ...entry.raw,
        site: entry.siteId,
        uniqueId: `${entry.siteId}-${entry.raw.id ?? entry.raw.title}`,
        solutionId: entry.entryId,
        solutionKey: `${entry.siteId}|$|${entry.entryId}`,
        status: entry.raw.status ?? ETorrentStatus.unknown,
      }))
      .filter((item) => matches(item, presentation.filters));
    const sorted = filtered.sort((a, b) => {
      const field = presentation.sort.field;
      if (a[field] === undefined) return b[field] === undefined ? 0 : 1;
      if (b[field] === undefined) return -1;
      const comparison = field === "title" ? String(a[field]).localeCompare(String(b[field])) : Number(a[field]) - Number(b[field]);
      return presentation.sort.direction === "asc" ? comparison : -comparison;
    });
    const searchPlan: Record<string, Record<string, unknown>> = {};
    for (const entry of job.entries) {
      const key = `${entry.siteId}|$|${entry.entryId}`;
      const hasResult = job.internalResults.some((item) => item.siteId === entry.siteId && item.entryId === entry.entryId);
      const failure = job.failures.find((item) => item.siteId === entry.siteId && item.entryId === entry.entryId);
      searchPlan[key] = {
        siteId: entry.siteId,
        searchEntryName: entry.entryId,
        searchEntry: entry.settings,
        status: failure ? (EResultParseStatus[failure.status as keyof typeof EResultParseStatus] ?? EResultParseStatus.unknownError) : hasResult ? EResultParseStatus.success : EResultParseStatus.noResults,
        count: job.internalResults.filter((item) => item.siteId === entry.siteId && item.entryId === entry.entryId).length,
        ...(failure?.message ? { statusMsg: failure.message } : {}),
      };
    }
    return {
      presentationId: token,
      jobId: job.jobId,
      keyword: job.keyword,
      solutionId: job.solutionId,
      createdAt: job.createdAt,
      filters: presentation.filters,
      sort: presentation.sort,
      searchResult: sorted.slice(0, maxResults),
      searchPlan,
      failures: job.failures,
    };
  };
  return { descriptors, handlers, consumePresentation };
}
