import axios from "axios";
import type { ISocialInformation } from "@ptd/social";
import {
  createMovieEntityRequestDeduper,
  getMovieCacheFreshness,
  getMovieCanonicalKey,
  getMovieEntityRequestKey,
  isMovieProviderRetryBlocked,
  mergeMovieEntityFragments,
  mergeMovieExternalIds,
  normalizeMovieEntityCachePolicy,
  normalizeMovieExternalIds,
  restoreMovieSearchIdentity,
  sanitizeMovieProviderError,
  selectExpiredMovieCacheKeys,
  selectMovieCachePruneKeys,
  toMovieCachedIdentity,
  withMovieProviderTimeout,
  type IMovieEntityCacheRecord,
  type IMovieEntityCachePolicy,
  type IMovieEntityCacheStats,
  type IMovieEntityFragment,
  type IMovieEntityRequest,
  type IMovieEntityResponse,
  type IMovieExternalIds,
  type IMovieProviderStatus,
  type IMovieSearchIdentity,
  type TMovieProviderName,
} from "@ptd/social";

import { onMessage, sendMessage } from "@/messages.ts";
import type { IConfigPiniaStorageSchema } from "@/shared/types.ts";

import { ptdIndexDb } from "../adapter/indexdb.ts";
import { fetchPosterDataUrl } from "./socialRecommendations.ts";
import { getSocialInformation, pruneSocialInformationCache } from "./socialInformation.ts";

const movieEntityRequests = createMovieEntityRequestDeduper<IMovieEntityResponse>();

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function getMovieCachePolicy(config: IConfigPiniaStorageSchema) {
  const cache = normalizeMovieEntityCachePolicy(config.socialSiteInformation?.movieEntityCache);
  return {
    ...cache,
    timeout: boundedNumber(config.socialSiteInformation?.timeout, 10_000, 1_000, 30_000),
  };
}

function splitValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitValues);
  if (typeof value !== "string") return [];
  return value
    .split(/\s*\/\s*|\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function socialInformationToFragment(
  provider: "douban" | "imdb" | "tmdb" | "tvmaze",
  information: ISocialInformation | undefined,
): IMovieEntityFragment | undefined {
  if (!information || (!information.title && !information.poster && !information.ratingScore)) return undefined;
  const titles = splitValues(information.title);
  return {
    provider,
    updatedAt: information.createAt || Date.now(),
    ids: mergeMovieExternalIds(
      provider === "imdb"
        ? { imdb: information.id }
        : provider === "douban"
          ? { douban: information.id }
          : provider === "tmdb"
            ? { tmdb: information.id }
            : { tvmaze: information.id },
      information.external_ids as IMovieExternalIds,
    ),
    mediaType: information.mediaType,
    title: titles[0],
    originalTitle: information.originalTitle || titles[1],
    aliases: [...(information.aliases ?? []), ...titles.slice(1)],
    year: information.releaseYear,
    regions: splitValues(information.region),
    genres: information.genres,
    directors: information.directors,
    writers: information.writers,
    cast: information.cast,
    releaseDates: information.releaseDates,
    runtimes: information.runtimes,
    summary: information.summary,
    poster: information.poster,
    rating:
      information.ratingScore && information.ratingScore > 0
        ? {
            score: information.ratingScore,
            scale: 10,
            count: information.ratingCount,
            url:
              provider === "douban"
                ? `https://movie.douban.com/subject/${information.id}/`
                : provider === "imdb"
                  ? `https://www.imdb.com/title/${information.id}/`
                  : undefined,
          }
        : undefined,
  };
}

function credentialHeaders(value: string | undefined) {
  const credential = value?.trim();
  if (!credential) return { params: {}, headers: {} };
  return credential.startsWith("eyJ")
    ? { params: {}, headers: { Authorization: `Bearer ${credential}` } }
    : { params: { api_key: credential }, headers: {} };
}

async function fetchTmdbFragment(
  identity: IMovieSearchIdentity,
  config: IConfigPiniaStorageSchema,
  timeout: number,
): Promise<IMovieEntityFragment | undefined> {
  const credential = config.socialSiteInformation?.socialSite?.tmdb?.apikey as string | undefined;
  if (!credential?.trim()) return undefined;
  const auth = credentialHeaders(credential);
  let tmdbId = identity.ids.tmdb;
  let mediaType = identity.mediaType;

  if (!tmdbId && identity.ids.imdb) {
    const { data } = await axios.get(`https://api.themoviedb.org/3/find/${identity.ids.imdb}`, {
      ...auth,
      params: { ...auth.params, external_source: "imdb_id", language: "zh-CN" },
      timeout,
    });
    const result = data.movie_results?.[0] ?? data.tv_results?.[0];
    if (!result?.id) return undefined;
    mediaType = data.movie_results?.[0] ? "movie" : "tv";
    tmdbId = `${mediaType}/${result.id}`;
  }

  if (!tmdbId) return undefined;
  const [kind, id] = tmdbId.split("/");
  if (!id || !["movie", "tv"].includes(kind)) return undefined;
  const { data } = await axios.get(`https://api.themoviedb.org/3/${kind}/${id}`, {
    ...auth,
    params: { ...auth.params, language: "zh-CN", append_to_response: "credits,external_ids" },
    timeout,
  });
  const updatedAt = Date.now();
  return {
    provider: "tmdb",
    updatedAt,
    ids: normalizeMovieExternalIds({
      tmdb: `${kind}/${id}`,
      imdb: data.imdb_id ?? data.external_ids?.imdb_id ?? identity.ids.imdb,
    }),
    mediaType: kind === "tv" ? "tv" : "movie",
    title: data.title ?? data.name,
    originalTitle: data.original_title ?? data.original_name,
    year: String(data.release_date ?? data.first_air_date ?? "").slice(0, 4),
    regions: (data.production_countries ?? []).map((item: any) => item.name).filter(Boolean),
    genres: (data.genres ?? []).map((item: any) => item.name).filter(Boolean),
    directors: (data.credits?.crew ?? []).filter((item: any) => item.job === "Director").map((item: any) => item.name),
    writers: (data.credits?.crew ?? [])
      .filter((item: any) => ["Writer", "Screenplay", "Story"].includes(item.job))
      .map((item: any) => item.name),
    cast: (data.credits?.cast ?? []).slice(0, 15).map((item: any) => item.name),
    releaseDates: splitValues(data.release_date ?? data.first_air_date),
    runtimes: data.runtime
      ? [`${data.runtime} min`]
      : (data.episode_run_time ?? []).map((item: number) => `${item} min`),
    summary: data.overview,
    poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
  };
}

async function fetchOmdbFragment(
  identity: IMovieSearchIdentity,
  config: IConfigPiniaStorageSchema,
  timeout: number,
): Promise<IMovieEntityFragment | undefined> {
  const socialConfig = config.socialSiteInformation?.socialSite as Record<string, Record<string, any>> | undefined;
  const apiKey = socialConfig?.omdb?.apikey as string | undefined;
  if (!apiKey?.trim() || !identity.ids.imdb) return undefined;
  const { data } = await axios.get("https://www.omdbapi.com/", {
    params: { apikey: apiKey.trim(), i: identity.ids.imdb, plot: "full" },
    timeout,
  });
  if (!data || data.Response === "False") throw new Error(data?.Error || "OMDb returned no result");
  const ratings = Object.fromEntries((data.Ratings ?? []).map((item: any) => [item.Source, item.Value]));
  const updatedAt = Date.now();
  const normalizedRatings: NonNullable<IMovieEntityFragment["ratings"]> = [];
  const imdbScore = Number.parseFloat(data.imdbRating);
  if (Number.isFinite(imdbScore) && imdbScore > 0) {
    normalizedRatings.push({
      source: "imdb",
      score: imdbScore,
      scale: 10,
      count: Number.parseInt(String(data.imdbVotes ?? "").replace(/\D/g, ""), 10) || undefined,
      url: `https://www.imdb.com/title/${identity.ids.imdb}/`,
    });
  }
  const rottenScore = Number.parseFloat(ratings["Rotten Tomatoes"]);
  if (Number.isFinite(rottenScore) && rottenScore > 0) {
    normalizedRatings.push({
      source: "rottentomatoes",
      score: rottenScore,
      scale: 100,
      url: "https://www.rottentomatoes.com/",
    });
  }
  const metacriticScore = Number.parseFloat(data.Metascore);
  if (Number.isFinite(metacriticScore) && metacriticScore > 0) {
    normalizedRatings.push({
      source: "metacritic",
      score: metacriticScore,
      scale: 100,
      url: "https://www.metacritic.com/",
    });
  }
  return {
    provider: "omdb",
    updatedAt,
    ids: { imdb: identity.ids.imdb },
    mediaType: data.Type === "series" ? "tv" : "movie",
    title: data.Title,
    year: String(data.Year ?? "").match(/\d{4}/)?.[0],
    regions: splitValues(data.Country),
    genres: splitValues(data.Genre),
    directors: splitValues(data.Director),
    writers: splitValues(data.Writer),
    cast: splitValues(data.Actors),
    releaseDates: splitValues(data.Released),
    runtimes: splitValues(data.Runtime),
    summary: data.Plot,
    poster: data.Poster && data.Poster !== "N/A" ? data.Poster : undefined,
    ratings: normalizedRatings,
  };
}

async function fetchTvmazeFragment(
  identity: IMovieSearchIdentity,
  timeout: number,
): Promise<IMovieEntityFragment | undefined> {
  if (identity.mediaType !== "tv" && !identity.ids.tvmaze) return undefined;
  const url = identity.ids.tvmaze
    ? `https://api.tvmaze.com/shows/${identity.ids.tvmaze}`
    : `https://api.tvmaze.com/lookup/shows?imdb=${identity.ids.imdb}`;
  if (!identity.ids.tvmaze && !identity.ids.imdb) return undefined;
  const { data } = await axios.get(url, { timeout });
  return {
    provider: "tvmaze",
    updatedAt: Date.now(),
    ids: normalizeMovieExternalIds({ imdb: data.externals?.imdb, tvmaze: String(data.id) }),
    mediaType: "tv",
    title: data.name,
    year: String(data.premiered ?? "").slice(0, 4),
    genres: data.genres,
    releaseDates: splitValues(data.premiered),
    runtimes: data.runtime ? [`${data.runtime} min`] : [],
    summary: String(data.summary ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    poster: data.image?.original ?? data.image?.medium,
    rating: data.rating?.average ? { score: data.rating.average, scale: 10 } : undefined,
  };
}

async function resolveIdentity(
  identity: IMovieSearchIdentity,
  timeout: number,
  fetchPrimary = true,
): Promise<{ identity: IMovieSearchIdentity; primary?: IMovieEntityFragment }> {
  let ids = normalizeMovieExternalIds(identity.ids);
  let primary: IMovieEntityFragment | undefined;

  if (fetchPrimary && !ids.douban && ids.imdb) {
    try {
      const { data } = await axios.get<any[]>(
        `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(ids.imdb)}`,
        { timeout },
      );
      const exact = Array.isArray(data) ? data.find((item) => item?.id && item?.type === "movie") : undefined;
      if (exact?.id) ids = mergeMovieExternalIds(ids, { douban: String(exact.id) });
    } catch {}
  }

  if (fetchPrimary && ids.douban) {
    try {
      const info = await withMovieProviderTimeout(
        getSocialInformation("douban", ids.douban, { requireMetadata: true, requireExternalIds: true }),
        timeout,
        "douban",
      );
      primary = socialInformationToFragment("douban", info);
      ids = mergeMovieExternalIds(ids, primary?.ids);
    } catch {}
  }

  const canonicalKey = getMovieCanonicalKey(ids) || identity.canonicalKey;
  return {
    identity: {
      ...identity,
      ids,
      canonicalKey,
      title: primary?.title || identity.title,
      originalTitle: primary?.originalTitle || identity.originalTitle,
      aliases: Array.from(new Set([...(identity.aliases ?? []), ...(primary?.aliases ?? [])])),
      year: primary?.year || identity.year,
      mediaType: primary?.mediaType || identity.mediaType,
    },
    primary,
  };
}

function aliasKeys(ids: IMovieExternalIds): string[] {
  return Object.entries(normalizeMovieExternalIds(ids)).map(([provider, id]) => `${provider}:${id}`);
}

async function getCachedMovie(identity: IMovieSearchIdentity): Promise<IMovieEntityCacheRecord | undefined> {
  const db = await ptdIndexDb;
  const direct = await db.get("movie_entity", identity.canonicalKey);
  if (direct) return direct;
  for (const alias of aliasKeys(identity.ids)) {
    const canonical = await db.get("movie_alias", alias);
    if (!canonical) continue;
    const record = await db.get("movie_entity", canonical);
    if (record) return record;
  }
  return undefined;
}

async function deleteCachedMovie(key: string, record?: IMovieEntityCacheRecord): Promise<void> {
  const db = await ptdIndexDb;
  const cached = record ?? (await db.get("movie_entity", key));
  const tx = db.transaction(["movie_entity", "movie_alias"], "readwrite");
  await tx.objectStore("movie_entity").delete(key);
  for (const alias of aliasKeys(cached?.entity.ids ?? {})) {
    if ((await tx.objectStore("movie_alias").get(alias)) === key) {
      await tx.objectStore("movie_alias").delete(alias);
    }
  }
  await tx.done;
}

async function pruneMovieEntityCache(policy: IMovieEntityCachePolicy, now = Date.now()): Promise<number> {
  const db = await ptdIndexDb;
  const keys = await db.getAllKeys("movie_entity");
  const records = await Promise.all(keys.map(async (key) => ({ key, record: await db.get("movie_entity", key) })));
  const normalized = records.map(({ key, record }) => ({
    key: String(key),
    lastAccessedAt: record?.lastAccessedAt ?? Number.NaN,
  }));
  const expiredKeys = new Set(selectExpiredMovieCacheKeys(normalized, policy.retentionMs, now));
  const remaining = normalized.filter((item) => !expiredKeys.has(item.key));
  const overflowKeys = selectMovieCachePruneKeys(remaining, policy.maxEntries);
  const pruneKeys = new Set([...expiredKeys, ...overflowKeys]);
  for (const item of records.filter(({ key }) => pruneKeys.has(String(key)))) {
    await deleteCachedMovie(item.key, item.record);
  }
  return pruneKeys.size;
}

async function saveCachedMovie(
  record: IMovieEntityCacheRecord,
  previousKey: string | undefined,
  policy: IMovieEntityCachePolicy,
) {
  const db = await ptdIndexDb;
  const previousRecord = previousKey ? await db.get("movie_entity", previousKey) : undefined;
  const tx = db.transaction(["movie_entity", "movie_alias"], "readwrite");
  await tx.objectStore("movie_entity").put(record, record.entity.canonicalKey);
  for (const alias of aliasKeys(record.entity.ids)) {
    await tx.objectStore("movie_alias").put(record.entity.canonicalKey, alias);
  }
  if (previousKey && previousKey !== record.entity.canonicalKey) {
    await tx.objectStore("movie_entity").delete(previousKey);
    for (const alias of aliasKeys(previousRecord?.entity.ids ?? {})) {
      if ((await tx.objectStore("movie_alias").get(alias)) === previousKey) {
        await tx.objectStore("movie_alias").delete(alias);
      }
    }
  }
  await tx.done;
  await pruneMovieEntityCache(policy);
}

function providerBlocked(
  cached: IMovieEntityCacheRecord | undefined,
  provider: TMovieProviderName,
  forced: Set<TMovieProviderName>,
  now: number,
) {
  const status = cached?.providers[provider];
  return !forced.has(provider) && isMovieProviderRetryBlocked(status, now);
}

async function aggregateMovieEntity(request: IMovieEntityRequest, config: IConfigPiniaStorageSchema) {
  const policy = getMovieCachePolicy(config);
  const forced = new Set(request.forceProviders ?? []);
  const initiallyCached = await getCachedMovie(request.identity);
  const now = Date.now();
  const initialFreshness = initiallyCached ? getMovieCacheFreshness(initiallyCached, now) : undefined;
  const needsMetadata = !initialFreshness?.metadataFresh;
  const needsRatings = !initialFreshness?.ratingsFresh;
  const shouldRun = (provider: TMovieProviderName) => {
    if (forced.size > 0) return forced.has(provider);
    return provider === "tmdb" ? needsMetadata : needsMetadata || needsRatings;
  };
  const requestIdentity = initiallyCached
    ? restoreMovieSearchIdentity(initiallyCached.identity, request.identity)
    : request.identity;
  const resolved = await resolveIdentity(requestIdentity, policy.timeout, shouldRun("douban"));
  const cached = initiallyCached ?? (await getCachedMovie(resolved.identity));
  const fragments: IMovieEntityFragment[] = resolved.primary ? [resolved.primary] : [];
  const providers: Partial<Record<TMovieProviderName, IMovieProviderStatus>> = { ...(cached?.providers ?? {}) };

  const jobs: Array<[TMovieProviderName, () => Promise<IMovieEntityFragment | undefined>]> = [];
  if (resolved.identity.ids.douban && !resolved.primary && shouldRun("douban")) {
    jobs.push([
      "douban",
      async () =>
        socialInformationToFragment(
          "douban",
          await getSocialInformation("douban", resolved.identity.ids.douban!, {
            force: forced.has("douban"),
            requireMetadata: true,
            requireExternalIds: true,
          }),
        ),
    ]);
  }
  if (resolved.identity.ids.imdb && shouldRun("imdb")) {
    jobs.push([
      "imdb",
      async () =>
        socialInformationToFragment(
          "imdb",
          await getSocialInformation("imdb", resolved.identity.ids.imdb!, { force: forced.has("imdb") }),
        ),
    ]);
  }
  if (shouldRun("tmdb")) jobs.push(["tmdb", () => fetchTmdbFragment(resolved.identity, config, policy.timeout)]);
  if (shouldRun("omdb")) jobs.push(["omdb", () => fetchOmdbFragment(resolved.identity, config, policy.timeout)]);

  const runnable = jobs.filter(([provider]) => !providerBlocked(cached, provider, forced, now));
  const settled = await Promise.allSettled(
    runnable.map(async ([provider, loader]) => ({
      provider,
      fragment: await withMovieProviderTimeout(loader(), policy.timeout, provider),
    })),
  );
  for (let index = 0; index < settled.length; index++) {
    const provider = runnable[index][0];
    const result = settled[index];
    if (result.status === "fulfilled") {
      if (result.value.fragment) {
        fragments.push(result.value.fragment);
        providers[provider] = { provider, state: "success", updatedAt: now };
      } else {
        providers[provider] = { provider, state: "skipped", updatedAt: now };
      }
    } else {
      providers[provider] = {
        provider,
        state: "failed",
        updatedAt: now,
        retryAfter: now + policy.negativeMs,
        ...sanitizeMovieProviderError(result.reason),
      };
    }
  }
  if (resolved.primary) providers.douban = { provider: "douban", state: "success", updatedAt: now };

  let entity = mergeMovieEntityFragments(resolved.identity, fragments, cached?.entity);
  const resolvedMediaType = entity.mediaType?.value ?? resolved.identity.mediaType;
  if (resolvedMediaType === "tv" && shouldRun("tvmaze") && !providerBlocked(cached, "tvmaze", forced, now)) {
    try {
      const fragment = await withMovieProviderTimeout(
        fetchTvmazeFragment({ ...resolved.identity, mediaType: "tv", ids: entity.ids }, policy.timeout),
        policy.timeout,
        "tvmaze",
      );
      if (fragment) {
        entity = mergeMovieEntityFragments(resolved.identity, [fragment], entity);
        providers.tvmaze = { provider: "tvmaze", state: "success", updatedAt: now };
      } else {
        providers.tvmaze = { provider: "tvmaze", state: "skipped", updatedAt: now };
      }
    } catch (error) {
      providers.tvmaze = {
        provider: "tvmaze",
        state: "failed",
        updatedAt: now,
        retryAfter: now + policy.negativeMs,
        ...sanitizeMovieProviderError(error),
      };
    }
  }

  const poster = await fetchPosterDataUrl("all", entity.poster?.value);
  if (poster && entity.poster) entity.poster = { ...entity.poster, value: poster };
  const metadataRefreshed = fragments.some((fragment) =>
    [
      fragment.title,
      fragment.originalTitle,
      fragment.aliases,
      fragment.year,
      fragment.regions,
      fragment.genres,
      fragment.directors,
      fragment.writers,
      fragment.cast,
      fragment.releaseDates,
      fragment.runtimes,
      fragment.summary,
      fragment.poster,
    ].some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value))),
  );
  const ratingsRefreshed = fragments.some((fragment) => Boolean(fragment.rating) || Boolean(fragment.ratings?.length));
  const cachedIdentity = toMovieCachedIdentity({
    ...resolved.identity,
    ids: entity.ids,
    canonicalKey: entity.canonicalKey,
  });
  const record: IMovieEntityCacheRecord = {
    identity: cachedIdentity,
    entity,
    providers,
    metadataExpiresAt: metadataRefreshed ? now + policy.metadataMs : (cached?.metadataExpiresAt ?? now),
    ratingsExpiresAt: ratingsRefreshed ? now + policy.ratingMs : (cached?.ratingsExpiresAt ?? now),
    lastAccessedAt: now,
  };
  if (policy.enabled) await saveCachedMovie(record, cached?.entity.canonicalKey, policy);
  return {
    identity: restoreMovieSearchIdentity(cachedIdentity, request.identity),
    entity,
    providers,
    fromCache: false,
    stale: getMovieCacheFreshness(record, Date.now()).stale,
  } satisfies IMovieEntityResponse;
}

export async function getMovieEntity(request: IMovieEntityRequest): Promise<IMovieEntityResponse> {
  const config = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;
  const policy = getMovieCachePolicy(config);
  if (policy.enabled) {
    await Promise.all([pruneMovieEntityCache(policy), pruneSocialInformationCache(policy.retentionMs)]);
  }
  const cached = policy.enabled ? await getCachedMovie(request.identity) : undefined;
  const force = (request.forceProviders?.length ?? 0) > 0;
  if (cached && !force) {
    const freshness = getMovieCacheFreshness(cached);
    if (!freshness.stale || request.allowStale !== false) {
      cached.lastAccessedAt = Date.now();
      await (await ptdIndexDb).put("movie_entity", cached, cached.entity.canonicalKey);
      return {
        identity: restoreMovieSearchIdentity(cached.identity, request.identity),
        entity: cached.entity,
        providers: cached.providers,
        fromCache: true,
        stale: freshness.stale,
      };
    }
  }

  const key = getMovieEntityRequestKey(request);
  return movieEntityRequests.run(key, () => aggregateMovieEntity(request, config));
}

export async function clearMovieEntityCache() {
  const db = await ptdIndexDb;
  await Promise.all([db.clear("movie_entity"), db.clear("movie_alias")]);
}

export async function getMovieEntityCacheStats(): Promise<IMovieEntityCacheStats> {
  const config = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;
  const policy = getMovieCachePolicy(config);
  await Promise.all([pruneMovieEntityCache(policy), pruneSocialInformationCache(policy.retentionMs)]);
  const records = await (await ptdIndexDb).getAll("movie_entity");
  return {
    count: records.length,
    approximateBytes: records.reduce((total, record) => total + new Blob([JSON.stringify(record)]).size, 0),
  };
}

onMessage("getMovieEntity", async ({ data }) => getMovieEntity(data));
onMessage("clearMovieEntityCache", async () => clearMovieEntityCache());
onMessage("getMovieEntityCacheStats", async () => getMovieEntityCacheStats());
