import assert from "node:assert/strict";
import { createMcpSearchCapabilities } from "../../app/src/entries/offscreen/utils/mcpSearchCapabilities.ts";
import { resolveSearchSolution } from "../../app/src/entries/shared/searchPlan.ts";
import { EResultParseStatus } from "../../app/src/packages/site/types/base.ts";

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  for (let i = 0; i < 150 && !check(); i++) await sleep(2);
  assert(check(), "asynchronous work completes");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}
const metadata = () => ({
  sites: { alpha: { allowSearch: true }, beta: { allowSearch: true }, offline: { isOffline: true }, disabled: { allowSearch: false }, dead: {} },
  solutions: {
    movies: { id: "movies", name: "Movies", enabled: true, solutions: [{ id: "default", siteId: "alpha", searchEntries: {} }] },
    disabledPlan: { id: "disabledPlan", enabled: false, name: "Disabled", solutions: [] },
    custom: { id: "custom", enabled: true, name: "Custom", solutions: [{ id: "category", siteId: "alpha", searchEntries: { category: { requestConfig: { params: { cat: 100 } } } } }] },
  },
  defaultSolutionId: "movies",
});
const readSite = async (id: string): Promise<any> => ({ id, name: id, isDead: id === "dead", searchEntry: { default: {}, inactive: { enabled: false } } });
const fixture = (id: number, title: string, seeders: number, size = 5 * 2 ** 30) => ({
  id, title, seeders, size, site: "alpha", tags: [{ name: "中字" }], subTitle: "S01 2020", time: id * 1000,
  url: "https://fixture.invalid/details/1", link: "https://fixture.invalid/download?passkey=do-not-export", username: "do-not-export",
});

function createHarness(options: Record<string, unknown> = {}, search?: (input: any) => Promise<unknown>) {
  const calls: Array<{ type: string; data: any }> = [];
  const stored = metadata();
  let clock = 100;
  let id = 0;
  const registry = createMcpSearchCapabilities(async (type, data) => {
    calls.push({ type, data });
    if (type === "getExtStorage") return data === "metadata" ? stored : { searchEntity: { queueConcurrency: 1, treatTTQueryAsImdbSearch: true, forceImdbIdMatchFilter: true } };
    if (type === "getSiteSearchResult") return search ? search(data) : { status: EResultParseStatus.success, data: [fixture(1, "Film BluRay 1080p", 5), fixture(2, "Film BluRay 2160p", 10), fixture(3, "Film WEB-DL 1080p", 15)] };
    if (type === "queryMovieSuggestions") return { items: [
      { site: "douban", id: "1234567", title: "Same Title", year: "2020", searchTerm: "douban|1234567", sourceUrl: "https://fixture.invalid/secret" },
      { site: "douban", id: "1234568", title: "Same Title", year: "2022", searchTerm: "douban|1234568" },
    ], failed: false };
    if (type === "getMovieSuggestionDetails") return { item: { ...(data as any).item, imdbId: "tt1234567", searchTerm: "imdb|tt1234567" } };
    if (type === "getMovieEntity") return { entity: { ids: { imdb: "tt1234567", douban: "1234567" }, title: { value: "Same Title", source: "douban" }, ratings: { imdb: { source: "imdb", score: 8, scale: 10, url: "https://fixture.invalid/secret" } }, poster: { value: "https://fixture.invalid/poster" } }, providers: { imdb: { provider: "imdb", state: "success", errorMessage: "cookie=secret" } } };
    throw new Error(`Unexpected message ${type}`);
  }, { now: () => clock, createId: () => `fixture-job-${++id}`, readSite, ...options });
  return {
    calls, stored, registry, advance: (ms: number) => { clock += ms; },
    async call(name: string, input: any = {}): Promise<any> {
      const handler = registry.handlers.get(name as any);
      assert(handler, `registered ${name}`);
      return handler(input);
    },
  };
}

{
  const stored = metadata() as any;
  const definition = { searchEntry: { default: { enabled: true, requestConfigTransformer: () => ({}) } } } as any;
  stored.sites.alpha.merge = { searchEntry: { default: { enabled: false } } };
  const plan = await resolveSearchSolution(stored, async () => definition, "default");
  assert.equal(plan?.id, "movies");
  assert.deepEqual(plan?.solutions[0].searchEntries.default, { id: "default", enabled: false });
  assert.equal(definition.searchEntry.default.enabled, true, "plan expansion never mutates static site definitions");
  assert.equal(typeof definition.searchEntry.default.requestConfigTransformer, "function");
  assert.deepEqual(stored.solutions.movies.solutions[0].searchEntries, {}, "saved plan stays unchanged");
  assert.equal(await resolveSearchSolution(stored, readSite, "missing"), undefined);
  const all = await resolveSearchSolution(stored, readSite, "all");
  assert.deepEqual(all?.solutions.map((item) => item.siteId), ["alpha", "beta"]);
}

{
  const h = createHarness();
  const started = await h.call("ptpp.search.start", { keyword: "Film" });
  assert.equal(started.solutionId, "movies", "search uses configured default plan, not all sites");
  let status: any;
  await until(() => h.calls.some((call) => call.type === "getSiteSearchResult"));
  await sleep();
  status = await h.call("ptpp.search.status", { jobId: started.jobId });
  assert.equal(status.status, "completed");
  assert.equal(status.totalEntries, 1, "disabled search entries are skipped");
  assert.equal(status.completedEntries, 1);
  assert.equal(h.calls.filter((call) => call.type === "getSiteSearchResult").length, 1);
  const first = await h.call("ptpp.search.results", { jobId: started.jobId, limit: 1 });
  assert.equal(first.items[0].seeders, 15);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.total, 3);
  assert(!JSON.stringify(first).includes("fixture.invalid"));
  assert(!JSON.stringify(first).includes("do-not-export"));
  assert.deepEqual(first.items[0].tags, ["中字"], "tag names retain useful semantics without arbitrary nested data");
  const selected = await h.call("ptpp.search.results", { jobId: started.jobId, filters: { source: "蓝光", resolution: "1080p" } });
  assert.equal(selected.items.length, 1);
  assert.equal(selected.items[0].id, 1);
  const repeated = await h.call("ptpp.search.results", { jobId: started.jobId });
  assert.deepEqual(repeated.items, selected.items, "follow-up reads preserve filters and result references");
  const reset = await h.call("ptpp.search.results", { jobId: started.jobId, filters: {}, sort: { field: "size", direction: "asc" } });
  assert.equal(reset.total, 3);
  assert.equal(h.calls.filter((call) => call.type === "getSiteSearchResult").length, 1, "filter/sort/pages never requery trackers");
  await assert.rejects(h.call("ptpp.search.results", { jobId: started.jobId, limit: 100 }), /range/);
  await assert.rejects(h.call("ptpp.search.start", { keyword: "Film", arbitraryScript: "ignored?" }), /Unsupported/);
  await assert.rejects(h.call("ptpp.search.start", { keyword: "Film", siteIds: ["not-configured"] }), /not configured/);
  await assert.rejects(h.call("ptpp.search.start", { keyword: "Film", solutionId: "disabledPlan" }), /disabled/);
  await assert.rejects(h.call("ptpp.search.start", { keyword: "Film", siteIds: ["offline"] }), /No enabled/);
}

{
  const pending = deferred<any>();
  const h = createHarness({}, async (input) => input.siteId === "alpha" ? pending.promise : { status: EResultParseStatus.needLogin, data: [] });
  const started = await h.call("ptpp.search.start", { keyword: "Film", solutionId: "all" });
  await sleep();
  assert.equal(h.calls.filter((call) => call.type === "getSiteSearchResult").length, 1, "respects configured concurrency");
  pending.resolve({ status: EResultParseStatus.success, data: [fixture(1, "Film", 3)] });
  await sleep();
  const result = await h.call("ptpp.search.results", { jobId: started.jobId });
  assert.equal(result.status, "partial");
  assert.equal(result.failureCount, 1);
  assert.equal(result.failures[0].status, "needLogin", "parse failures are not misreported as empty success");
  assert.equal(result.total, 1);
}

{
  const pending = deferred<any>();
  const h = createHarness({}, () => pending.promise);
  const first = await h.call("ptpp.search.start", { keyword: "First" });
  const second = await h.call("ptpp.search.start", { keyword: "Second" });
  await sleep();
  assert.equal(h.calls.filter((call) => call.type === "getSiteSearchResult").length, 1, "concurrency limit is shared by multiple jobs");
  await h.call("ptpp.search.cancel", { jobId: second.jobId });
  pending.resolve({ status: EResultParseStatus.noResults, data: [] });
  await sleep();
  assert.equal((await h.call("ptpp.search.status", { jobId: first.jobId })).status, "completed");
  assert.equal(h.calls.filter((call) => call.type === "getSiteSearchResult").length, 1, "cancelled job waiting on the shared queue does not contact its site");
}

{
  const pending = deferred<any>();
  const h = createHarness({}, async () => pending.promise);
  const started = await h.call("ptpp.search.start", { keyword: "Film", solutionId: "all" });
  await sleep();
  const cancelled = await h.call("ptpp.search.cancel", { jobId: started.jobId });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.inFlightMayComplete, true);
  pending.resolve({ status: EResultParseStatus.success, data: [fixture(1, "Late result", 20)] });
  await sleep();
  assert.equal(h.calls.filter((call) => call.type === "getSiteSearchResult").length, 1, "cancel prevents queued sites from starting");
  assert.equal((await h.call("ptpp.search.results", { jobId: started.jobId })).total, 0, "late in-flight results are discarded");
}

{
  const pending = deferred<any>();
  const h = createHarness({ requestTimeoutMs: 5 }, () => pending.promise);
  const started = await h.call("ptpp.search.start", { keyword: "Film" });
  await sleep(15);
  const result = await h.call("ptpp.search.results", { jobId: started.jobId });
  assert.equal(result.status, "failed");
  assert.equal(result.failures[0].status, "timeout");
  pending.resolve({ status: EResultParseStatus.success, data: [fixture(1, "Late result", 10)] });
  await sleep();
  assert.equal((await h.call("ptpp.search.results", { jobId: started.jobId })).total, 0);
}

{
  const h = createHarness({ ttlMs: 100, maxJobs: 1, maxResults: 1 });
  const first = await h.call("ptpp.search.start", { keyword: "Film" });
  await sleep();
  const result = await h.call("ptpp.search.results", { jobId: first.jobId });
  assert.equal(result.total, 1);
  assert.equal(result.truncated, true, "bounded result storage reports truncation explicitly");
  const second = await h.call("ptpp.search.start", { keyword: "Different film" });
  await sleep();
  await assert.rejects(h.call("ptpp.search.status", { jobId: first.jobId }), /expired/);
  h.advance(101);
  await assert.rejects(h.call("ptpp.search.status", { jobId: second.jobId }), /expired/);
}

{
  const h = createHarness({}, async () => ({ status: EResultParseStatus.success, data: [
    { ...fixture(1, "Matched Film", 5), ext_imdb: "tt1234567" }, { ...fixture(2, "Other Film", 5), ext_imdb: "tt7654321" },
    { ...fixture(1, "Duplicate", 10), ext_imdb: "tt1234567" },
  ] }));
  const started = await h.call("ptpp.search.start", { keyword: "tt1234567", solutionId: "custom" });
  await sleep();
  const call = h.calls.find((item) => item.type === "getSiteSearchResult")!;
  assert.equal(call.data.keyword, "imdb|tt1234567");
  assert.deepEqual(call.data.searchEntry.requestConfig.params, { cat: 100 }, "saved search categories reuse the native search entry");
  assert.equal((await h.call("ptpp.search.results", { jobId: started.jobId })).total, 1, "deduplicates and honors IMDb match setting");
}

{
  const h = createHarness({ ttlMs: 100 });
  const plans = await h.call("ptpp.search.plans");
  assert.equal(plans.items[0].siteCount, 1, "default plan reports its actual scope");
  assert.equal(plans.items[1].siteCount, 2, "all excludes offline/disabled/dead sites");
  assert(!plans.items.some((item: any) => item.id === "disabledPlan"));
  const result = await h.call("ptpp.movies.search", { query: "Same Title" });
  assert.equal(result.ambiguous, true);
  assert.equal(result.items[0].year, "2020");
  assert(!JSON.stringify(result).includes("fixture.invalid"));
  const details = await h.call("ptpp.movies.get", { candidateRef: result.items[0].candidateRef });
  assert.equal(details.ids.imdb, "tt1234567");
  assert.equal(details.details.title.value, "Same Title");
  assert.equal(details.ratings[0].score, 8);
  assert(!JSON.stringify(details).includes("secret"));
  assert(!JSON.stringify(details).includes("fixture.invalid"));
  await assert.rejects(h.call("ptpp.movies.get", { imdbId: "tt1234567", doubanId: "1234567" }), /Choose/);
  await assert.rejects(h.call("ptpp.movies.get", { imdbId: "anything" }), /Invalid/);
  h.advance(101);
  await assert.rejects(h.call("ptpp.movies.get", { candidateRef: result.items[0].candidateRef }), /expired/);
}

console.log("MCP search workflow tests passed: shared plans, movie identity, bounded async jobs, filtering, failures, cancellation and privacy.");
