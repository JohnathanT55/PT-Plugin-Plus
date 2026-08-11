import type { CollectionItemRecord } from "../model/schema";

export type CollectionMovieLookupSite = "douban" | "imdb";

export interface CollectionMovieLookup {
  site: CollectionMovieLookupSite;
  sid: string;
}

export interface CollectionSocialInformation {
  id?: string;
  title?: string;
  poster?: string;
  releaseYear?: string | number;
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function normalizeCollectionImdbId(value: unknown): string {
  const match = stringValue(value).match(/^(tt\d+)$/i);
  return match ? match[1].toLocaleLowerCase() : "";
}

export function normalizeCollectionDoubanId(value: unknown): string {
  const valueString = stringValue(value);
  return /^\d+$/.test(valueString) ? valueString : "";
}

export function getCollectionMovieLookup(item: Pick<CollectionItemRecord, "imdbId" | "movieInfo">) {
  const movieInfo = item.movieInfo ?? {};
  const doubanId = normalizeCollectionDoubanId(movieInfo.doubanId);
  if (doubanId) return { site: "douban", sid: doubanId } satisfies CollectionMovieLookup;

  const imdbId = normalizeCollectionImdbId(item.imdbId || movieInfo.imdbId);
  if (imdbId) return { site: "imdb", sid: imdbId } satisfies CollectionMovieLookup;
  return null;
}

function movieUrl({ site, sid }: CollectionMovieLookup): string {
  return site === "douban" ? `https://movie.douban.com/subject/${sid}/` : `https://www.imdb.com/title/${sid}/`;
}

/**
 * Convert PTD's typed social-information result back to the compact movieInfo
 * record used by archived PTPP favorites. Empty lookup fields never erase
 * richer legacy metadata, so a temporary network failure remains lossless.
 */
export function applyCollectionMovieInformation(
  item: CollectionItemRecord,
  lookup: CollectionMovieLookup,
  information: CollectionSocialInformation | null | undefined,
): CollectionItemRecord {
  const result: CollectionItemRecord = JSON.parse(JSON.stringify(item));
  const movieInfo: Record<string, unknown> = { ...(result.movieInfo ?? {}) };

  const imdbId = normalizeCollectionImdbId(result.imdbId || movieInfo.imdbId);
  const doubanId = normalizeCollectionDoubanId(movieInfo.doubanId);
  if (imdbId) {
    result.imdbId = imdbId;
    movieInfo.imdbId = imdbId;
  }
  if (doubanId) movieInfo.doubanId = doubanId;

  const titleParts = stringValue(information?.title)
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (titleParts.length) {
    movieInfo.title = titleParts[0];
    if (titleParts.length > 1) movieInfo.alt_title = titleParts.slice(1).join(" / ");
  }

  const poster = stringValue(information?.poster);
  if (poster) movieInfo.image = poster;
  const year = stringValue(information?.releaseYear);
  if (year) movieInfo.year = year;

  movieInfo.link = movieUrl(lookup);
  if (lookup.site === "douban") movieInfo.doubanId = normalizeCollectionDoubanId(information?.id) || lookup.sid;
  else {
    const resolvedImdbId = normalizeCollectionImdbId(information?.id) || lookup.sid;
    result.imdbId = resolvedImdbId;
    movieInfo.imdbId = resolvedImdbId;
  }

  result.movieInfo = movieInfo;
  return result;
}
