import type { ISocialInformation, ISocialMovieSuggestion, ISocialMovieSuggestionResult } from "@ptd/social";
import { fetchMovieSuggestions } from "@ptd/social";

import { onMessage, sendMessage } from "@/messages.ts";
import type { IConfigPiniaStorageSchema } from "@/shared/types.ts";

import { logger } from "./logger.ts";
import { getSocialInformation } from "./socialInformation.ts";
import { fetchPosterDataUrl } from "./socialRecommendations.ts";

interface IMovieSuggestionCacheEntry {
  createAt: number;
  items: ISocialMovieSuggestion[];
}

const suggestionCache = new Map<string, IMovieSuggestionCacheEntry>();
const suggestionRequests = new Map<string, Promise<ISocialMovieSuggestionResult>>();

function clampSuggestionCount(count?: number) {
  return Math.min(10, Math.max(1, Number.isFinite(count) ? Math.round(count!) : 5));
}

function mergeSocialInformation(
  item: ISocialMovieSuggestion,
  information?: ISocialInformation,
): ISocialMovieSuggestion {
  if (!information) return item;

  return {
    ...item,
    title: information.title?.split(" / ")[0]?.trim() || item.title,
    originalTitle:
      information.title
        ?.split(" / ")
        .slice(1)
        .map((title) => title.trim())
        .filter(Boolean)
        .join(" / ") || item.originalTitle,
    poster: information.poster || item.poster,
    year: information.releaseYear || item.year,
    ratingScore: information.ratingScore || item.ratingScore,
    ratingCount: information.ratingCount || item.ratingCount,
  };
}

export async function queryMovieSuggestions(
  query: string,
  count?: number,
  flush = false,
): Promise<ISocialMovieSuggestionResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { items: [], failed: false };

  const config = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;
  const limit = clampSuggestionCount(count);
  const cacheDays = Math.max(1, config.socialSiteInformation?.cacheDay ?? 7);
  const timeout = Math.max(1_000, config.socialSiteInformation?.timeout ?? 10_000);
  const cacheKey = `${normalizedQuery.toLocaleLowerCase()}:${limit}`;
  const cached = suggestionCache.get(cacheKey);

  if (!flush && cached && cached.createAt > Date.now() - cacheDays * 86_400_000) {
    return { items: cached.items, failed: false, fromCache: true };
  }

  const existingRequest = suggestionRequests.get(cacheKey);
  if (existingRequest) return existingRequest;

  const request = (async (): Promise<ISocialMovieSuggestionResult> => {
    try {
      const items = await fetchMovieSuggestions(normalizedQuery, limit, timeout);
      suggestionCache.set(cacheKey, { createAt: Date.now(), items });
      return { items, failed: false };
    } catch (error) {
      await logger({
        msg: "Movie suggestion lookup failed; direct torrent search remains available",
        level: "warn",
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      return { items: [], failed: true };
    } finally {
      suggestionRequests.delete(cacheKey);
    }
  })();

  suggestionRequests.set(cacheKey, request);
  return request;
}

export async function enrichMovieSuggestion(item: ISocialMovieSuggestion): Promise<ISocialMovieSuggestion> {
  try {
    const information = await getSocialInformation(item.site, item.id, {
      requireMetadata: true,
    });
    const enriched = mergeSocialInformation(item, information);
    const poster = await fetchPosterDataUrl("visible", item.poster, information?.poster);
    return {
      ...enriched,
      poster: poster || (/doubanio\.com/.test(enriched.poster ?? "") ? undefined : enriched.poster),
    };
  } catch (error) {
    // Candidate selection must never depend on metadata providers. Keep the
    // fast Douban suggestion if PtGen/Douban/IMDb enrichment is unavailable.
    return item;
  }
}

onMessage("queryMovieSuggestions", async ({ data }) => queryMovieSuggestions(data.query, data.count, data.flush));

onMessage("getMovieSuggestionDetails", async ({ data }) => ({
  item: await enrichMovieSuggestion(data.item),
}));
