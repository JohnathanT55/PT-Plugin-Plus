import axios from "axios";

export type TMovieSuggestionSearchMode = "id" | "title";

export interface ISocialMovieSuggestion {
  site: "douban" | "imdb";
  id: string;
  imdbId?: string;
  title: string;
  originalTitle?: string;
  year?: string;
  poster?: string;
  ratingScore?: number;
  ratingCount?: number;
  sourceUrl: string;
  searchTerm: string;
}

function normalizeImdbId(value?: string) {
  return value
    ?.trim()
    .match(/tt\d{7,10}/i)?.[0]
    ?.toLowerCase();
}

export function preferMovieSuggestionImdb(
  item: ISocialMovieSuggestion,
  externalIds?: { imdb?: string },
): ISocialMovieSuggestion {
  const imdbId = normalizeImdbId(externalIds?.imdb ?? item.imdbId);
  if (!imdbId) return item;

  return {
    ...item,
    imdbId,
    searchTerm: `imdb|${imdbId}`,
  };
}

export function getMovieSuggestionSearchTerm(item: ISocialMovieSuggestion, mode: TMovieSuggestionSearchMode) {
  return mode === "title" ? item.title : preferMovieSuggestionImdb(item).searchTerm;
}

function normalizedComparableTitle(value?: string) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * Resolve a plain-text query only when the visible candidate set is safe to
 * bind without silently choosing between same-title releases. The caller can
 * still start the tracker search immediately; this helper never performs I/O.
 */
export function selectUnambiguousMovieSuggestion(
  query: string,
  suggestions: ISocialMovieSuggestion[],
): ISocialMovieSuggestion | undefined {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || parseMovieSuggestionIdentity(normalizedQuery) || suggestions.length === 0) return undefined;
  if (suggestions.length === 1) return suggestions[0];

  const queryYear = normalizedQuery.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/)?.[1];
  const queryTitle = normalizedComparableTitle(
    queryYear ? normalizedQuery.replace(new RegExp(`(?:^|\\s|[（(])${queryYear}(?:\\s|[）)]|$)`), " ") : normalizedQuery,
  );
  if (!queryTitle) return undefined;

  const exactTitleMatches = suggestions.filter((item) =>
    [item.title, item.originalTitle].some((title) => normalizedComparableTitle(title) === queryTitle),
  );
  const resolved = queryYear ? exactTitleMatches.filter((item) => item.year === queryYear) : exactTitleMatches;
  return resolved.length === 1 ? resolved[0] : undefined;
}

export interface ISocialMovieSuggestionResult {
  items: ISocialMovieSuggestion[];
  failed: boolean;
  fromCache?: boolean;
}

interface IDoubanSubjectSuggestion {
  id?: string;
  title?: string;
  sub_title?: string;
  year?: string;
  img?: string;
  url?: string;
  type?: string;
}

const imdbQueryPattern = /(?:imdb\|)?(tt\d{7,10})/i;
const doubanQueryPattern = /(?:douban\|?|movie\.douban\.com\/subject\/)(\d{5,12})/i;

function normalizePoster(url?: string) {
  return url?.replace(/img\d(?=\.doubanio\.com)/, "img1");
}

export function parseMovieSuggestionIdentity(query: string): { site: "douban" | "imdb"; id: string } | undefined {
  const normalized = query.trim();
  const imdbMatch = normalized.match(imdbQueryPattern);
  if (imdbMatch) {
    return { site: "imdb", id: imdbMatch[1].toLowerCase() };
  }

  const doubanMatch = normalized.match(doubanQueryPattern);
  if (doubanMatch) {
    return { site: "douban", id: doubanMatch[1] };
  }

  return undefined;
}

export function normalizeDoubanMovieSuggestions(
  data: IDoubanSubjectSuggestion[],
  limit: number,
): ISocialMovieSuggestion[] {
  const seen = new Set<string>();

  return data
    .map((item): ISocialMovieSuggestion | undefined => {
      const id = item.id?.trim();
      const title = item.title?.trim();
      // Match the archived PTPP behavior: the suggestion list only contains
      // films, even though Douban can return books, music and celebrities.
      if (!id || !title || (item.type && item.type !== "movie")) return undefined;
      if (seen.has(id)) return undefined;
      seen.add(id);

      return {
        site: "douban",
        id,
        title,
        originalTitle: item.sub_title?.trim() || undefined,
        year: item.year?.trim() || undefined,
        poster: normalizePoster(item.img),
        sourceUrl: item.url || `https://movie.douban.com/subject/${id}/`,
        searchTerm: `douban|${id}`,
      };
    })
    .filter((item): item is ISocialMovieSuggestion => !!item)
    .slice(0, Math.max(1, limit));
}

export async function fetchMovieSuggestions(
  query: string,
  limit = 5,
  timeout = 10_000,
): Promise<ISocialMovieSuggestion[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const identity = parseMovieSuggestionIdentity(normalizedQuery);
  if (identity) {
    return [
      {
        ...identity,
        title: identity.id,
        sourceUrl:
          identity.site === "imdb"
            ? `https://www.imdb.com/title/${identity.id}/`
            : `https://movie.douban.com/subject/${identity.id}/`,
        searchTerm: `${identity.site}|${identity.id}`,
      },
    ];
  }

  const { data } = await axios.get<IDoubanSubjectSuggestion[]>(
    `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(normalizedQuery)}`,
    {
      responseType: "json",
      timeout,
    },
  );

  return normalizeDoubanMovieSuggestions(Array.isArray(data) ? data : [], limit);
}
