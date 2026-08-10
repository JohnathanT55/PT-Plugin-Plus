import { MV3Repository } from "@foundation/storage/repository";
import type { CollectionItemRecord, MV3State } from "@foundation/model/schema";
import type { ITorrent } from "@ptd/site";

import { onMessage } from "@/messages.ts";

// Offscreen documents expose chrome.runtime but not chrome.storage. Keep this
// compatibility store in the service worker, which owns extension storage.
const repository = new MV3Repository();
let mutationQueue: Promise<void> = Promise.resolve();

function normalizeCollectionLink(link: string): string {
  if (!link) return "";
  try {
    const url = new URL(link);
    for (const key of ["hit", "cmtpage", "page"]) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return link.replace(/([?&])(hit|cmtpage|page)=[^&]*&?/gi, "$1").replace(/[?&]$/, "");
  }
}

function collectionItemLink(item: CollectionItemRecord): string {
  return normalizeCollectionLink(String(item.link ?? ""));
}

function updateGroupCounts(state: MV3State) {
  for (const group of state.collections.groups) {
    group.count = state.collections.items.filter(
      (item) => group.id && Array.isArray(item.groups) && item.groups.includes(group.id),
    ).length;
  }
}

function buildCollectionItem(torrent: ITorrent, detailUrl?: string): CollectionItemRecord {
  const link = normalizeCollectionLink(detailUrl || torrent.url || "");
  let host = "";
  try {
    host = new URL(link).host;
  } catch {
    // Keep an empty host for non-HTTP tracker links.
  }
  const imdbId = typeof torrent.ext_imdb === "string" ? torrent.ext_imdb : undefined;
  const doubanId = typeof torrent.ext_douban === "string" ? torrent.ext_douban : undefined;
  return {
    siteId: torrent.site,
    host,
    title: torrent.title,
    subTitle: torrent.subTitle,
    url: torrent.link,
    link,
    size: torrent.size,
    time: Date.now(),
    ...(imdbId ? { imdbId } : {}),
    ...(imdbId || doubanId
      ? {
          movieInfo: {
            ...(imdbId ? { imdbId } : {}),
            ...(doubanId ? { doubanId } : {}),
          },
        }
      : {}),
    groups: [],
  };
}

async function readCollectionState(): Promise<MV3State> {
  await mutationQueue;
  return await repository.reload();
}

function enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(mutation, mutation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

onMessage("getPtppCollectionItem", async ({ data: link }) => {
  const normalizedLink = normalizeCollectionLink(link);
  if (!normalizedLink) return null;
  const state = await readCollectionState();
  return state.collections.items.find((item) => collectionItemLink(item) === normalizedLink) ?? null;
});

onMessage("togglePtppCollection", async ({ data: { torrent, detailUrl } }) =>
  enqueueMutation(async () => {
    const state = await repository.reload();
    const item = buildCollectionItem(torrent, detailUrl);
    const normalizedLink = collectionItemLink(item);
    if (!normalizedLink) throw new Error("Cannot favorite a torrent without a detail-page link");

    const index = state.collections.items.findIndex((candidate) => collectionItemLink(candidate) === normalizedLink);
    if (index >= 0) {
      state.collections.items.splice(index, 1);
      updateGroupCounts(state);
      await repository.writeState(state);
      return { collected: false };
    }

    state.collections.items.push(item);
    updateGroupCounts(state);
    await repository.writeState(state);
    return { collected: true, item };
  }),
);
