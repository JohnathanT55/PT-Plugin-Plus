import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtimeStore = readFileSync("app/src/entries/options/stores/runtime.ts", "utf8");
const runtimeTypes = readFileSync("app/src/entries/shared/types/storages/runtime.ts", "utf8");
const offscreenSearch = readFileSync("app/src/entries/offscreen/utils/search.ts", "utf8");
const movieSuggestions = readFileSync("app/src/entries/offscreen/utils/movieSuggestions.ts", "utf8");
const searchPage = readFileSync("app/src/entries/options/views/Overview/SearchEntity/Index.vue", "utf8");
const searchRunner = readFileSync("app/src/entries/options/views/Overview/SearchEntity/utils/search.ts", "utf8");

assert(!runtimeStore.includes("storage: sessionStorage"), "ordinary search state must not use sessionStorage");
assert(
  runtimeStore.includes('sessionStorage.removeItem("__ptd_runtime_store")'),
  "upgrades must remove PTD's previously serialized ordinary search",
);
assert(!runtimeStore.includes("sessionStorage.setItem"), "the legacy PTD runtime-storage key must never be written");
assert(runtimeStore.includes("persistWebExt: false"), "runtime state must remain outside extension storage");
assert(runtimeTypes.includes("page-memory-only"), "the runtime data contract must state its privacy boundary");

assert(!offscreenSearch.includes("with keyword:"), "search logs must not contain raw keywords");
assert(!offscreenSearch.includes("data: { siteId, keyword, searchEntry }"), "search logs must not attach raw request data");
assert(
  offscreenSearch.includes("data: { snapshotId, recordCount:"),
  "snapshot logs must retain diagnostics without duplicating snapshot contents",
);
assert(
  !offscreenSearch.includes("Snapshot will be add at: ${snapshotId}`, data"),
  "snapshot logs must not contain the full torrent result payload",
);
assert(movieSuggestions.includes("sanitizeMovieProviderError(error)"));
assert(!movieSuggestions.includes("error instanceof Error ? error.message"));
assert(!movieSuggestions.includes("String(error)"), "candidate errors must not retain a query-bearing request URL");

assert(searchPage.includes('void router.replace({ name: "SearchEntity" })'));
assert(
  searchPage.indexOf('void router.replace({ name: "SearchEntity" })') < searchPage.indexOf("void doSearch(searchKey"),
  "the raw search URL must be scrubbed as part of the one-time in-memory handoff",
);
assert(!searchRunner.includes('console.log("Start search with: "'), "console output must not reveal raw search terms");
assert(!searchRunner.includes("searchStatusMsg ??"), "console output must not duplicate provider response messages");

console.log("Ordinary search memory boundary and redacted diagnostics passed.");
