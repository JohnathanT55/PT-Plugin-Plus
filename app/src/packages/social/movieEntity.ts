import type { ISocialMovieSuggestion } from "./movieSuggestions.ts";

export const movieEntitySchemaVersion = 1 as const;

export const movieProviderNames = ["douban", "imdb", "tmdb", "tvmaze", "omdb"] as const;
export type TMovieProviderName = (typeof movieProviderNames)[number];
export const movieRatingSources = [...movieProviderNames, "rottentomatoes", "metacritic"] as const;
export type TMovieRatingSource = (typeof movieRatingSources)[number];

export type TMovieMediaType = "movie" | "tv";
export type TMovieIdentityBinding = "explicit-candidate" | "direct-id" | "unambiguous-candidate";

export interface IMovieExternalIds {
  imdb?: string;
  douban?: string;
  tmdb?: string;
  tvmaze?: string;
}

/**
 * A movie identity belongs to one search run. It contains no torrent results
 * and no search history. The runtime store keeps it in page memory; it is only
 * persisted when the user explicitly saves a search snapshot.
 */
export interface IMovieSearchIdentity {
  schemaVersion: typeof movieEntitySchemaVersion;
  canonicalKey: string;
  ids: IMovieExternalIds;
  title: string;
  originalTitle?: string;
  aliases?: string[];
  year?: string;
  mediaType?: TMovieMediaType;
  binding: TMovieIdentityBinding;
  boundSearchTerm: string;
  selectedAt: number;
}

/**
 * Long-lived cache identity. Search binding details intentionally stay out of
 * IndexedDB because they can contain an ordinary user-entered query.
 */
export type IMovieCachedIdentity = Omit<IMovieSearchIdentity, "binding" | "boundSearchTerm" | "selectedAt">;

export interface IMovieField<T> {
  value: T;
  source: TMovieProviderName;
  updatedAt: number;
}

export interface IMovieRating {
  source: TMovieRatingSource;
  score: number;
  scale: number;
  count?: number;
  url?: string;
  updatedAt: number;
}

export interface IMovieEntity {
  schemaVersion: typeof movieEntitySchemaVersion;
  canonicalKey: string;
  ids: IMovieExternalIds;
  mediaType?: IMovieField<TMovieMediaType>;
  title?: IMovieField<string>;
  originalTitle?: IMovieField<string>;
  aliases?: IMovieField<string[]>;
  year?: IMovieField<string>;
  regions?: IMovieField<string[]>;
  genres?: IMovieField<string[]>;
  directors?: IMovieField<string[]>;
  writers?: IMovieField<string[]>;
  cast?: IMovieField<string[]>;
  releaseDates?: IMovieField<string[]>;
  runtimes?: IMovieField<string[]>;
  summary?: IMovieField<string>;
  poster?: IMovieField<string>;
  ratings: Partial<Record<TMovieRatingSource, IMovieRating>>;
  updatedAt: number;
}

export type TMovieProviderState = "success" | "failed" | "skipped";

export interface IMovieProviderStatus {
  provider: TMovieProviderName;
  state: TMovieProviderState;
  updatedAt: number;
  errorCode?: string;
  errorMessage?: string;
  retryAfter?: number;
}

export interface IMovieEntityCacheRecord {
  identity: IMovieCachedIdentity;
  entity: IMovieEntity;
  providers: Partial<Record<TMovieProviderName, IMovieProviderStatus>>;
  metadataExpiresAt: number;
  ratingsExpiresAt: number;
  lastAccessedAt: number;
}

export interface IMovieEntityResponse {
  identity: IMovieSearchIdentity;
  entity?: IMovieEntity;
  providers: Partial<Record<TMovieProviderName, IMovieProviderStatus>>;
  fromCache: boolean;
  stale: boolean;
}

export interface IMovieEntityCacheStats {
  count: number;
  approximateBytes: number;
}

export interface IMovieEntityRequest {
  identity: IMovieSearchIdentity;
  allowStale?: boolean;
  forceProviders?: TMovieProviderName[];
}

export interface IMovieEntityFragment {
  provider: TMovieProviderName;
  updatedAt: number;
  ids?: IMovieExternalIds;
  mediaType?: TMovieMediaType;
  title?: string;
  originalTitle?: string;
  aliases?: string[];
  year?: string;
  regions?: string[];
  genres?: string[];
  directors?: string[];
  writers?: string[];
  cast?: string[];
  releaseDates?: string[];
  runtimes?: string[];
  summary?: string;
  poster?: string;
  rating?: Omit<IMovieRating, "source" | "updatedAt"> & { source?: TMovieRatingSource };
  ratings?: Array<Omit<IMovieRating, "updatedAt">>;
}

export interface IMovieEntityCachePolicyInput {
  enabled?: boolean;
  metadataDays?: number;
  ratingHours?: number;
  negativeMinutes?: number;
  retentionDays?: number;
  maxEntries?: number;
}

export interface IMovieEntityCachePolicy {
  enabled: boolean;
  metadataMs: number;
  ratingMs: number;
  negativeMs: number;
  retentionMs: number;
  maxEntries: number;
}

function normalizedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function normalizeMovieExternalIds(ids: IMovieExternalIds = {}): IMovieExternalIds {
  const imdb = normalizedString(ids.imdb)
    ?.match(/tt\d{7,10}/i)?.[0]
    ?.toLowerCase();
  const douban = normalizedString(ids.douban)?.match(/\d{5,12}/)?.[0];
  const tmdbValue = normalizedString(ids.tmdb);
  const tmdb = tmdbValue?.match(/^(?:movie|tv)\/\d+$/)?.[0];
  const tvmaze = normalizedString(ids.tvmaze)?.match(/\d+/)?.[0];

  return {
    ...(imdb && { imdb }),
    ...(douban && { douban }),
    ...(tmdb && { tmdb }),
    ...(tvmaze && { tvmaze }),
  };
}

export function getMovieCanonicalKey(ids: IMovieExternalIds): string {
  const normalized = normalizeMovieExternalIds(ids);
  if (normalized.imdb) return `imdb:${normalized.imdb}`;
  if (normalized.douban) return `douban:${normalized.douban}`;
  if (normalized.tmdb) return `tmdb:${normalized.tmdb}`;
  if (normalized.tvmaze) return `tvmaze:${normalized.tvmaze}`;
  return "";
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(normalizedString).filter((value): value is string => !!value)));
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

export function normalizeMovieEntityCachePolicy(input: IMovieEntityCachePolicyInput = {}): IMovieEntityCachePolicy {
  return {
    enabled: input.enabled !== false,
    metadataMs: boundedNumber(input.metadataDays, 7, 1, 365) * 86_400_000,
    ratingMs: boundedNumber(input.ratingHours, 24, 1, 24 * 30) * 3_600_000,
    negativeMs: boundedNumber(input.negativeMinutes, 15, 1, 24 * 60) * 60_000,
    retentionMs: boundedNumber(input.retentionDays, 30, 1, 365) * 86_400_000,
    maxEntries: Math.round(boundedNumber(input.maxEntries, 200, 20, 2_000)),
  };
}

export function toMovieCachedIdentity(identity: IMovieSearchIdentity): IMovieCachedIdentity {
  const { binding: _binding, boundSearchTerm: _boundSearchTerm, selectedAt: _selectedAt, ...cached } = identity;
  return cached;
}

export function restoreMovieSearchIdentity(
  cached: IMovieCachedIdentity,
  request: IMovieSearchIdentity,
): IMovieSearchIdentity {
  return {
    ...cached,
    binding: request.binding,
    boundSearchTerm: request.boundSearchTerm,
    selectedAt: request.selectedAt,
  };
}

export function createMovieIdentityFromSuggestion(
  item: ISocialMovieSuggestion,
  boundSearchTerm: string,
  binding: TMovieIdentityBinding = "explicit-candidate",
  selectedAt = Date.now(),
): IMovieSearchIdentity {
  const ids = normalizeMovieExternalIds({
    imdb: item.imdbId,
    douban: item.site === "douban" ? item.id : undefined,
  });
  if (item.site === "imdb") ids.imdb = normalizeMovieExternalIds({ imdb: item.id }).imdb;

  return {
    schemaVersion: movieEntitySchemaVersion,
    canonicalKey: getMovieCanonicalKey(ids),
    ids,
    title: item.title.trim(),
    originalTitle: normalizedString(item.originalTitle),
    aliases: uniqueStrings([item.title, item.originalTitle]),
    year: normalizedString(item.year),
    binding,
    boundSearchTerm: boundSearchTerm.trim(),
    selectedAt,
  };
}

export function parseDirectMovieIdentity(query: string, selectedAt = Date.now()): IMovieSearchIdentity | undefined {
  const normalized = query.trim();
  const imdb = normalized.match(/(?:imdb\|)?(tt\d{7,10})/i)?.[1]?.toLowerCase();
  const douban = normalized.match(/(?:douban\|?|movie\.douban\.com\/subject\/)(\d{5,12})/i)?.[1];
  const ids = normalizeMovieExternalIds({ imdb, douban: imdb ? undefined : douban });
  const canonicalKey = getMovieCanonicalKey(ids);
  if (!canonicalKey) return undefined;

  return {
    schemaVersion: movieEntitySchemaVersion,
    canonicalKey,
    ids,
    title: ids.imdb ?? ids.douban ?? normalized,
    aliases: [],
    binding: "direct-id",
    boundSearchTerm: normalized,
    selectedAt,
  };
}

export function movieIdentityMatchesSearch(identity: IMovieSearchIdentity | undefined, searchTerm: string): boolean {
  if (!identity?.canonicalKey) return false;
  return identity.boundSearchTerm.trim() === searchTerm.trim();
}

export function mergeMovieExternalIds(...sources: Array<IMovieExternalIds | undefined>): IMovieExternalIds {
  return normalizeMovieExternalIds(Object.assign({}, ...sources.filter(Boolean)));
}

export function rekeyMovieEntity(entity: IMovieEntity, ids: IMovieExternalIds): IMovieEntity {
  const mergedIds = mergeMovieExternalIds(entity.ids, ids);
  return {
    ...entity,
    canonicalKey: getMovieCanonicalKey(mergedIds) || entity.canonicalKey,
    ids: mergedIds,
  };
}

const movieFieldPriority: Record<Exclude<TMovieProviderName, "omdb"> | "omdb", number> = {
  douban: 50,
  tmdb: 40,
  tvmaze: 30,
  omdb: 20,
  imdb: 10,
};

function meaningful(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && typeof value !== "undefined";
}

function chooseMovieField<T>(
  current: IMovieField<T> | undefined,
  value: T | undefined,
  source: TMovieProviderName,
  updatedAt: number,
): IMovieField<T> | undefined {
  if (!meaningful(value)) return current;
  if (!current || movieFieldPriority[source] > movieFieldPriority[current.source]) {
    return { value: value as T, source, updatedAt };
  }
  if (movieFieldPriority[source] === movieFieldPriority[current.source] && updatedAt >= current.updatedAt) {
    return { value: value as T, source, updatedAt };
  }
  return current;
}

/** Merge provider fragments field-by-field; ratings always remain separate. */
export function mergeMovieEntityFragments(
  identity: IMovieSearchIdentity,
  fragments: IMovieEntityFragment[],
  previous?: IMovieEntity,
): IMovieEntity {
  let entity: IMovieEntity = previous
    ? { ...previous, ids: { ...previous.ids }, ratings: { ...previous.ratings } }
    : {
        schemaVersion: movieEntitySchemaVersion,
        canonicalKey: identity.canonicalKey,
        ids: { ...identity.ids },
        ratings: {},
        updatedAt: identity.selectedAt,
      };

  for (const fragment of fragments) {
    const { provider, updatedAt } = fragment;
    entity.ids = mergeMovieExternalIds(entity.ids, fragment.ids);
    entity.mediaType = chooseMovieField(entity.mediaType, fragment.mediaType, provider, updatedAt);
    entity.title = chooseMovieField(entity.title, fragment.title, provider, updatedAt);
    entity.originalTitle = chooseMovieField(entity.originalTitle, fragment.originalTitle, provider, updatedAt);
    entity.aliases = chooseMovieField(entity.aliases, uniqueStrings(fragment.aliases ?? []), provider, updatedAt);
    entity.year = chooseMovieField(entity.year, fragment.year, provider, updatedAt);
    entity.regions = chooseMovieField(entity.regions, uniqueStrings(fragment.regions ?? []), provider, updatedAt);
    entity.genres = chooseMovieField(entity.genres, uniqueStrings(fragment.genres ?? []), provider, updatedAt);
    entity.directors = chooseMovieField(entity.directors, uniqueStrings(fragment.directors ?? []), provider, updatedAt);
    entity.writers = chooseMovieField(entity.writers, uniqueStrings(fragment.writers ?? []), provider, updatedAt);
    entity.cast = chooseMovieField(entity.cast, uniqueStrings(fragment.cast ?? []), provider, updatedAt);
    entity.releaseDates = chooseMovieField(
      entity.releaseDates,
      uniqueStrings(fragment.releaseDates ?? []),
      provider,
      updatedAt,
    );
    entity.runtimes = chooseMovieField(entity.runtimes, uniqueStrings(fragment.runtimes ?? []), provider, updatedAt);
    entity.summary = chooseMovieField(entity.summary, fragment.summary, provider, updatedAt);
    entity.poster = chooseMovieField(entity.poster, fragment.poster, provider, updatedAt);
    const ratings = [...(fragment.ratings ?? []), ...(fragment.rating ? [fragment.rating] : [])];
    for (const rating of ratings) {
      if (!Number.isFinite(rating.score) || rating.score <= 0) continue;
      const ratingSource = rating.source ?? provider;
      entity.ratings[ratingSource] = { ...rating, source: ratingSource, updatedAt };
    }
    entity.updatedAt = Math.max(entity.updatedAt, updatedAt);
  }

  entity.canonicalKey = getMovieCanonicalKey(entity.ids) || entity.canonicalKey;
  if (!entity.title && identity.title) {
    entity.title = {
      value: identity.title,
      source: identity.ids.douban ? "douban" : "imdb",
      updatedAt: identity.selectedAt,
    };
  }
  if (!entity.originalTitle && identity.originalTitle) {
    entity.originalTitle = {
      value: identity.originalTitle,
      source: identity.ids.douban ? "douban" : "imdb",
      updatedAt: identity.selectedAt,
    };
  }
  if (!entity.year && identity.year) {
    entity.year = {
      value: identity.year,
      source: identity.ids.douban ? "douban" : "imdb",
      updatedAt: identity.selectedAt,
    };
  }
  return entity;
}

export function getMovieCacheFreshness(record: IMovieEntityCacheRecord, now = Date.now()) {
  return {
    metadataFresh: record.metadataExpiresAt > now,
    ratingsFresh: record.ratingsExpiresAt > now,
    stale: record.metadataExpiresAt <= now || record.ratingsExpiresAt <= now,
  };
}

export function isMovieProviderRetryBlocked(status: IMovieProviderStatus | undefined, now = Date.now()) {
  return status?.state === "failed" && (status.retryAfter ?? 0) > now;
}

export function selectMovieCachePruneKeys(
  records: Array<{ key: string; lastAccessedAt: number }>,
  maxEntries: number,
): string[] {
  const overflow = Math.max(0, records.length - Math.max(0, Math.floor(maxEntries)));
  return records
    .toSorted((left, right) => left.lastAccessedAt - right.lastAccessedAt)
    .slice(0, overflow)
    .map((item) => item.key);
}

/**
 * Freshness TTL controls when providers refresh a record; it is not a privacy
 * retention boundary. This separate selector enforces hard deletion based on
 * the last time a cached movie was used.
 */
export function selectExpiredMovieCacheKeys(
  records: Array<{ key: string; lastAccessedAt: number }>,
  retentionMs: number,
  now = Date.now(),
): string[] {
  const cutoff = now - Math.max(0, retentionMs);
  return records
    .filter((item) => !Number.isFinite(item.lastAccessedAt) || item.lastAccessedAt <= cutoff)
    .map((item) => item.key);
}

export function getMovieEntityRequestKey(request: IMovieEntityRequest) {
  return `${request.identity.canonicalKey}:${[...(request.forceProviders ?? [])].sort().join(",")}`;
}

export function createMovieEntityRequestDeduper<T>() {
  const requests = new Map<string, Promise<T>>();
  return {
    run(key: string, loader: () => Promise<T>): Promise<T> {
      const existing = requests.get(key);
      if (existing) return existing;
      const request = loader().finally(() => requests.delete(key));
      requests.set(key, request);
      return request;
    },
    get size() {
      return requests.size;
    },
  };
}

export async function withMovieProviderTimeout<T>(promise: Promise<T>, timeout: number, provider: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${provider} request timed out`)), timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function sanitizeMovieProviderError(error: unknown): Pick<IMovieProviderStatus, "errorCode" | "errorMessage"> {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown provider error");
  const withoutUrls = raw
    .replace(/https?:\/\/[^\s)]+/gi, "[remote service]")
    .replace(/\b(api[_-]?key|token|authorization|bearer|password|secret)=?\s*[^\s,;]+/gi, "$1=[redacted]");
  return {
    errorCode: error instanceof Error ? error.name : "ProviderError",
    errorMessage: withoutUrls.slice(0, 240),
  };
}
