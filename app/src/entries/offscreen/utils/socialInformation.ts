import type { ISocialInformation, TSupportSocialSite$1 } from "@ptd/social";
import { getSocialSiteInformation, normalizeMovieEntityCachePolicy } from "@ptd/social";

import { onMessage, sendMessage } from "@/messages.ts";
import type { IConfigPiniaStorageSchema } from "@/shared/types.ts";

import { ptdIndexDb } from "../adapter/indexdb.ts";
import { logger } from "../utils/logger.ts";

interface IGetSocialInformationOptions {
  force?: boolean;
  requireSummary?: boolean;
  requireMetadata?: boolean;
  requireExternalIds?: boolean;
}

// 记录本次会话中已经因缺失字段联网重取过的 key，避免对源本身就不提供
// 简介/元数据的条目在每次调用时反复联网（绕过 cacheDay TTL）。
const enrichmentAttemptedKeys = new Set<string>();

export async function getSocialInformation(
  site: TSupportSocialSite$1,
  sid: string,
  options: IGetSocialInformationOptions = {},
): Promise<ISocialInformation> {
  const configStoreRaw = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;
  const socialInformationConfig = configStoreRaw.socialSiteInformation ?? {};
  const persistentCacheEnabled = socialInformationConfig.movieEntityCache?.enabled !== false;
  const movieCachePolicy = normalizeMovieEntityCachePolicy(socialInformationConfig.movieEntityCache);

  const key = `${site}:${sid}`;
  let stored = persistentCacheEnabled ? await (await ptdIndexDb).get("social_information", key) : undefined;
  const now = Date.now();
  if (stored && (!Number.isFinite(stored.createAt) || stored.createAt <= now - movieCachePolicy.retentionMs)) {
    await (await ptdIndexDb).delete("social_information", key);
    stored = undefined;
  }

  const cacheDays = socialInformationConfig.movieEntityCache?.metadataDays ?? socialInformationConfig.cacheDay ?? 7;
  const isExpired = stored && stored.createAt < now - 86400000 * cacheDays;
  // 仅在本会话尚未因缺失字段重取过该 key 时才允许补取，避免源本身无数据时反复联网。
  const canRetryForMissingFields = !enrichmentAttemptedKeys.has(key);
  const isMissingRequiredSummary = canRetryForMissingFields && options.requireSummary && stored && !stored.summary;
  const isMissingRequiredMetadata =
    canRetryForMissingFields &&
    options.requireMetadata &&
    stored &&
    (!stored.releaseYear || !stored.region || !stored.genres?.length);
  const isMissingRequiredExternalIds =
    canRetryForMissingFields && options.requireExternalIds && stored && !stored.external_ids?.imdb;

  const shouldMarkEnrichmentAttempted =
    isMissingRequiredSummary || isMissingRequiredMetadata || isMissingRequiredExternalIds;

  if (options.force || !stored || isExpired || shouldMarkEnrichmentAttempted) {
    stored = await getSocialSiteInformation(site, sid, socialInformationConfig);
    if (shouldMarkEnrichmentAttempted) {
      enrichmentAttemptedKeys.add(key);
    }
    if (persistentCacheEnabled && stored && (stored.title !== "" || stored.poster !== "")) {
      await setSocialInformation(site, sid, stored);
    }
    logger({ msg: `getSocialInformation for ${site} with sid: ${sid}`, data: stored });
  }

  return stored as ISocialInformation;
}

onMessage("getSocialInformation", async ({ data: { site, sid } }) => await getSocialInformation(site, sid));

export async function setSocialInformation(site: TSupportSocialSite$1, sid: string, val: ISocialInformation) {
  const key = `${site}:${sid}`;
  return await (await ptdIndexDb).put("social_information", val, key);
}

export async function deleteSocialInformation(site: TSupportSocialSite$1, sid: string) {
  const key = `${site}:${sid}`;
  return await (await ptdIndexDb).delete("social_information", key);
}

export async function clearSocialInformation() {
  return await (await ptdIndexDb).clear("social_information");
}

export async function pruneSocialInformationCache(retentionMs: number, now = Date.now()): Promise<number> {
  const db = await ptdIndexDb;
  const keys = await db.getAllKeys("social_information");
  const cutoff = now - Math.max(0, retentionMs);
  let removed = 0;
  for (const key of keys) {
    const record = await db.get("social_information", key);
    if (record && Number.isFinite(record.createAt) && record.createAt > cutoff) continue;
    await db.delete("social_information", key);
    removed += 1;
  }
  return removed;
}

onMessage("clearSocialInformationCache", async () => {
  await clearSocialInformation();
});
