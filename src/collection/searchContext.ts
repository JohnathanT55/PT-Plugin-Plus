export interface CollectionSearchMovieIds {
  imdbId?: string;
  doubanId?: string;
}

interface TorrentMovieIds {
  ext_imdb?: unknown;
  ext_douban?: unknown;
}

/**
 * Recover the movie identifier carried by archived PTPP search routes. The
 * MV3 UI also accepts PTD's explicit `site|id` form and a plain IMDb ID.
 */
export function parseCollectionSearchMovieIds(value: unknown): CollectionSearchMovieIds {
  if (typeof value !== "string") return {};
  const keyword = value.trim();

  const imdbMatch = keyword.match(/^(?:imdb\|)?(tt\d+)(?:\||$)/i);
  if (imdbMatch) return { imdbId: imdbMatch[1].toLocaleLowerCase() };

  const doubanMatch = keyword.match(/^douban(?:\|)?(\d+)(?:\||$)/i);
  if (doubanMatch) return { doubanId: doubanMatch[1] };

  return {};
}

/**
 * Match archived PTPP's collection behavior: a movie-ID search contributes
 * its ID to every favorite, but a tracker-provided ID always wins.
 */
export function inheritCollectionSearchMovieIds<T extends object>(
  torrent: T,
  keyword: unknown,
): T & { ext_imdb?: string; ext_douban?: string } {
  const ids = parseCollectionSearchMovieIds(keyword);
  const movieIds = torrent as T & TorrentMovieIds;
  if ((!ids.imdbId || movieIds.ext_imdb) && (!ids.doubanId || movieIds.ext_douban)) {
    return torrent as T & { ext_imdb?: string; ext_douban?: string };
  }

  return {
    ...torrent,
    ...(!movieIds.ext_imdb && ids.imdbId ? { ext_imdb: ids.imdbId } : {}),
    ...(!movieIds.ext_douban && ids.doubanId ? { ext_douban: ids.doubanId } : {}),
  };
}
