import assert from "node:assert/strict";

import {
  createMovieEntityRequestDeduper,
  createMovieIdentityFromSuggestion,
  getMovieCanonicalKey,
  getMovieCacheFreshness,
  getMovieEntityRequestKey,
  isMovieProviderRetryBlocked,
  mergeMovieExternalIds,
  mergeMovieEntityFragments,
  movieIdentityMatchesSearch,
  normalizeMovieExternalIds,
  normalizeMovieEntityCachePolicy,
  parseDirectMovieIdentity,
  rekeyMovieEntity,
  sanitizeMovieProviderError,
  selectExpiredMovieCacheKeys,
  selectMovieCachePruneKeys,
  toMovieCachedIdentity,
  withMovieProviderTimeout,
  type IMovieEntity,
} from "../../app/src/packages/social/movieEntity.ts";

const normalized = normalizeMovieExternalIds({
  imdb: "https://www.imdb.com/title/TT0111161/",
  douban: "douban|1292052",
  tmdb: "movie/278",
  tvmaze: "show/42",
});
assert.deepEqual(normalized, {
  imdb: "tt0111161",
  douban: "1292052",
  tmdb: "movie/278",
  tvmaze: "42",
});
assert.equal(getMovieCanonicalKey(normalized), "imdb:tt0111161", "IMDb is the canonical PT search identity");

const suggestionIdentity = createMovieIdentityFromSuggestion(
  {
    site: "douban",
    id: "1292052",
    imdbId: "tt0111161",
    title: "肖申克的救赎",
    originalTitle: "The Shawshank Redemption",
    year: "1994",
    sourceUrl: "https://movie.douban.com/subject/1292052/",
    searchTerm: "imdb|tt0111161",
  },
  "imdb|tt0111161",
  "explicit-candidate",
  123,
);
assert.equal(suggestionIdentity.canonicalKey, "imdb:tt0111161");
assert.deepEqual(suggestionIdentity.ids, { imdb: "tt0111161", douban: "1292052" });
assert.equal(suggestionIdentity.title, "肖申克的救赎");
assert.equal(suggestionIdentity.selectedAt, 123);
assert(movieIdentityMatchesSearch(suggestionIdentity, " imdb|tt0111161 "));
assert(!movieIdentityMatchesSearch(suggestionIdentity, "肖申克的救赎"));

assert.equal(parseDirectMovieIdentity("https://www.imdb.com/title/tt0111161/")?.canonicalKey, "imdb:tt0111161");
assert.equal(parseDirectMovieIdentity("douban|1292052")?.canonicalKey, "douban:1292052");
assert.equal(parseDirectMovieIdentity("普通文字搜索"), undefined, "plain searches must not silently bind a movie");

assert.deepEqual(mergeMovieExternalIds({ douban: "1292052" }, { imdb: "TT0111161" }), {
  imdb: "tt0111161",
  douban: "1292052",
});

const entity: IMovieEntity = {
  schemaVersion: 1,
  canonicalKey: "douban:1292052",
  ids: { douban: "1292052" },
  ratings: {},
  updatedAt: 1,
};
assert.equal(rekeyMovieEntity(entity, { imdb: "tt0111161" }).canonicalKey, "imdb:tt0111161");

const merged = mergeMovieEntityFragments(suggestionIdentity, [
  {
    provider: "imdb",
    updatedAt: 10,
    ids: { imdb: "tt0111161" },
    title: "The Shawshank Redemption",
    rating: { score: 9.3, scale: 10, count: 3_000_000 },
  },
  {
    provider: "tmdb",
    updatedAt: 20,
    ids: { tmdb: "movie/278", imdb: "tt0111161" },
    title: "肖申克的救赎（TMDb）",
    summary: "TMDb summary",
    poster: "https://image.invalid/tmdb.jpg",
  },
  {
    provider: "douban",
    updatedAt: 30,
    ids: { douban: "1292052", imdb: "tt0111161" },
    title: "肖申克的救赎",
    summary: "豆瓣中文简介",
    genres: ["剧情", "犯罪"],
    rating: { score: 9.7, scale: 10, count: 3_100_000 },
  },
  {
    provider: "omdb",
    updatedAt: 40,
    ratings: [
      { source: "rottentomatoes", score: 89, scale: 100 },
      { source: "metacritic", score: 82, scale: 100 },
    ],
  },
]);
assert.equal(merged.title?.value, "肖申克的救赎", "Douban wins Chinese display fields");
assert.equal(merged.summary?.value, "豆瓣中文简介", "fields merge independently by provider responsibility");
assert.equal(merged.poster?.value, "https://image.invalid/tmdb.jpg", "TMDb remains a poster fallback");
assert.equal(merged.ratings.imdb?.score, 9.3);
assert.equal(merged.ratings.douban?.score, 9.7);
assert.equal(merged.ratings.rottentomatoes?.score, 89);
assert.equal(merged.ratings.metacritic?.score, 82);
assert.deepEqual(merged.ids, { imdb: "tt0111161", douban: "1292052", tmdb: "movie/278" });

const freshnessRecord = {
  identity: toMovieCachedIdentity(suggestionIdentity),
  entity: merged,
  providers: {},
  metadataExpiresAt: 200,
  ratingsExpiresAt: 100,
  lastAccessedAt: 1,
};
assert.deepEqual(getMovieCacheFreshness(freshnessRecord, 150), {
  metadataFresh: true,
  ratingsFresh: false,
  stale: true,
});
assert.deepEqual(getMovieCacheFreshness({ ...freshnessRecord, ratingsExpiresAt: 200 }, 150), {
  metadataFresh: true,
  ratingsFresh: true,
  stale: false,
});

const sanitized = sanitizeMovieProviderError(
  new Error("GET https://api.example.invalid/item?apikey=secret-token failed"),
);
assert(!sanitized.errorMessage?.includes("secret-token"), "provider errors must not retain endpoint credentials");
assert(sanitized.errorMessage?.includes("[remote service]"));
const sanitizedWithoutUrl = sanitizeMovieProviderError(new Error("apikey=secret-token request rejected"));
assert(!sanitizedWithoutUrl.errorMessage?.includes("secret-token"));

const cachedIdentity = toMovieCachedIdentity(suggestionIdentity);
assert(!("boundSearchTerm" in cachedIdentity), "long-lived movie cache must not contain the raw search term");
assert(!("binding" in cachedIdentity), "long-lived movie cache must not contain the search binding mode");
assert(!("selectedAt" in cachedIdentity), "long-lived movie cache must not persist selection history");

assert.deepEqual(normalizeMovieEntityCachePolicy(), {
  enabled: true,
  metadataMs: 7 * 86_400_000,
  ratingMs: 24 * 3_600_000,
  negativeMs: 15 * 60_000,
  retentionMs: 30 * 86_400_000,
  maxEntries: 200,
});
assert.deepEqual(
  normalizeMovieEntityCachePolicy({ metadataDays: 0, ratingHours: 99999, retentionDays: 99999, maxEntries: 1 }),
  {
    enabled: true,
    metadataMs: 86_400_000,
    ratingMs: 30 * 24 * 3_600_000,
    negativeMs: 15 * 60_000,
    retentionMs: 365 * 86_400_000,
    maxEntries: 20,
  },
);

assert(isMovieProviderRetryBlocked({ provider: "omdb", state: "failed", updatedAt: 1, retryAfter: 100 }, 99));
assert(!isMovieProviderRetryBlocked({ provider: "omdb", state: "failed", updatedAt: 1, retryAfter: 100 }, 100));
assert.deepEqual(
  selectMovieCachePruneKeys(
    [
      { key: "new", lastAccessedAt: 30 },
      { key: "old", lastAccessedAt: 10 },
      { key: "middle", lastAccessedAt: 20 },
    ],
    2,
  ),
  ["old"],
);
assert.deepEqual(
  selectExpiredMovieCacheKeys(
    [
      { key: "recent", lastAccessedAt: 90 },
      { key: "boundary", lastAccessedAt: 80 },
      { key: "old", lastAccessedAt: 10 },
      { key: "invalid", lastAccessedAt: Number.NaN },
    ],
    20,
    100,
  ),
  ["boundary", "old", "invalid"],
  "hard privacy retention is independent from metadata freshness TTL",
);

assert.equal(
  getMovieEntityRequestKey({ identity: suggestionIdentity, forceProviders: ["tmdb", "douban"] }),
  "imdb:tt0111161:douban,tmdb",
  "deduplication key is stable regardless of provider order",
);
assert.equal(
  getMovieEntityRequestKey({ identity: suggestionIdentity, forceProviders: ["douban", "tmdb"] }),
  "imdb:tt0111161:douban,tmdb",
);

let dedupeLoads = 0;
let releaseRequest!: (value: string) => void;
const pendingRequest = new Promise<string>((resolve) => (releaseRequest = resolve));
const deduper = createMovieEntityRequestDeduper<string>();
const firstRequest = deduper.run("same", () => {
  dedupeLoads += 1;
  return pendingRequest;
});
const secondRequest = deduper.run("same", () => {
  dedupeLoads += 1;
  return Promise.resolve("wrong");
});
assert.strictEqual(firstRequest, secondRequest, "concurrent identical requests share the exact promise");
assert.equal(dedupeLoads, 1);
assert.equal(deduper.size, 1);
releaseRequest("done");
assert.equal(await secondRequest, "done");
await Promise.resolve();
assert.equal(deduper.size, 0, "settled requests leave the dedupe registry");

assert.equal(await withMovieProviderTimeout(Promise.resolve("fast"), 20, "imdb"), "fast");
await assert.rejects(
  withMovieProviderTimeout(new Promise<never>(() => undefined), 5, "tmdb"),
  /tmdb request timed out/,
  "a stalled provider is bounded without cancelling the rest of the card",
);

console.log("Movie identity and entity contract tests passed.");
