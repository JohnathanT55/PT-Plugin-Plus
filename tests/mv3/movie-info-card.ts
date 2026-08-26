import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const searchPage = readFileSync("app/src/entries/options/views/Overview/SearchEntity/Index.vue", "utf8");
const movieCard = readFileSync("app/src/entries/options/views/Overview/SearchEntity/MovieInfoCard.vue", "utf8");
const searchSettings = readFileSync("app/src/entries/options/views/Settings/SetBase/SearchEntityWindow.vue", "utf8");
const movieSettings = readFileSync(
  "app/src/entries/options/views/Settings/SetBase/SocialInformationWindow.vue",
  "utf8",
);
const socialCache = readFileSync("app/src/entries/offscreen/utils/socialInformation.ts", "utf8");
const backupSource = readFileSync("app/src/entries/offscreen/utils/backup.ts", "utf8");
const configSource = readFileSync("app/src/entries/options/stores/config.ts", "utf8");
const movieService = readFileSync("app/src/entries/offscreen/utils/movieEntity.ts", "utf8");
const snapshotStore = readFileSync("app/src/entries/options/stores/metadata.ts", "utf8");
const runtimeTypes = readFileSync("app/src/entries/shared/types/storages/runtime.ts", "utf8");

assert(searchPage.includes("<MovieInfoCard"), "search results render the movie card component");
assert(
  searchPage.indexOf("<MovieInfoCard") < searchPage.indexOf('<v-alert class="ptpp-search-status"'),
  "the movie card stays above the search status and result table",
);
assert(searchPage.includes(':identity="runtimeStore.search.movieIdentity"'));
assert(searchPage.includes(':enabled="configStore.searchEntity.movieInfoCardEnabled"'));

assert(movieCard.includes("allowStale: true"), "stale cached data is displayed immediately");
assert(movieCard.includes("allowStale: false"), "expired cached data is refreshed in the background");
assert(movieCard.includes("forceProviders: [provider]"), "failed providers can be retried independently");
assert(movieCard.includes("requestGeneration === generation"), "old provider responses cannot replace a newer search");
assert(
  movieCard.includes('v-if="enabled && identity?.canonicalKey"'),
  "the real runtime identity directly controls movie-card visibility",
);
assert(movieCard.includes('aria-live="polite"'), "cache and refresh status is announced accessibly");
assert(movieCard.includes("posterFailed"), "poster failures have an explicit placeholder path");
assert(movieCard.includes("failedProviders"), "partial provider failure remains visible without hiding good data");
assert(movieCard.includes("MovieInfoCard.updatedAt"), "cached movie information exposes its update time");
assert(movieCard.includes('locale.value.replace("_", "-")'), "Vue locale IDs are normalized for the Intl API");
assert(movieCard.includes("@media (max-width: 760px)"), "the archived-style card has a narrow layout");
assert(!movieCard.includes("v-html"), "provider summaries are rendered as text, never unsafe HTML");

assert(searchSettings.includes("movieSuggestionEnabled"));
assert(searchSettings.includes("movieInfoCardEnabled"));
assert.notEqual(
  searchSettings.indexOf("movieSuggestionEnabled"),
  searchSettings.indexOf("movieInfoCardEnabled"),
  "candidate and result-card controls remain independent",
);
assert(movieSettings.includes("getMovieEntityCacheStats"), "normal settings expose cache size and count");
assert(movieSettings.includes("clearMovieEntityCache"), "normal settings expose explicit cache clearing");
assert(movieSettings.includes("clearSocialInformationCache"), "clearing removes provider fragments as well");
assert(movieSettings.includes("movieCache.retentionDays"), "normal settings expose hard local retention");
assert(movieSettings.includes("socialSite!.tmdb.apikey"));
assert(movieSettings.includes("socialSite!.omdb.apikey"));
assert(configSource.includes("movieInfoCardEnabled: true"), "movie information is default-on");
assert(
  configSource.includes("tmdb: {}") && configSource.includes("omdb: {}"),
  "no shared optional-provider key is built in",
);

assert(socialCache.includes("persistentCacheEnabled"), "cache disable applies to lower-level provider fragments");
assert(!backupSource.includes('"movie_entity"'));
assert(!backupSource.includes('"movie_alias"'));
assert(movieService.includes("Promise.allSettled"), "providers settle independently");
assert(movieService.includes("createMovieEntityRequestDeduper"), "the service uses the tested request deduper");
assert(movieService.includes("withMovieProviderTimeout"), "every provider job uses the tested timeout boundary");
assert(movieService.includes("pruneMovieEntityCache"), "cached entities are automatically deleted after retention");
assert(runtimeTypes.includes("movieIdentity?: IMovieSearchIdentity"));
assert(snapshotStore.includes("data: searchSnapshotData"), "the full search identity is saved with explicit snapshots");

console.log("Movie information card, cache controls, and privacy UI contract passed.");
