import { MV3Repository } from "@foundation/storage/repository";
import type { CollectionItemRecord, MV3State } from "@foundation/model/schema";
import {
  addCollectionItem,
  clearCollection,
  collectionItemKey,
  createCollectionGroup,
  deleteCollectionGroup,
  normalizeCollectionLink,
  reconcileCollectionState,
  removeCollectionItems,
  setCollectionItemGroup,
  setDefaultCollectionGroup,
  updateCollectionGroup,
  updateCollectionItem,
} from "@foundation/collection/model";
import { applyCollectionMovieInformation, getCollectionMovieLookup } from "@foundation/collection/movieInfo";
import type { ITorrent } from "@ptd/site";

import { onMessage, sendMessage } from "@/messages.ts";

// Offscreen documents expose chrome.runtime but not chrome.storage. Keep this
// compatibility store in the service worker, which owns extension storage.
const repository = new MV3Repository();
let mutationQueue: Promise<void> = Promise.resolve();

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

async function enrichCollectionItem(item: CollectionItemRecord): Promise<CollectionItemRecord> {
  const lookup = getCollectionMovieLookup(item);
  if (!lookup) return item;

  try {
    const information = await sendMessage("getSocialInformation", lookup);
    return applyCollectionMovieInformation(item, lookup, information);
  } catch {
    // Match archived PTPP: a failed movie lookup must never prevent a
    // favorite from being added or its manually entered IDs from being saved.
    return item;
  }
}

async function readCollectionState(): Promise<MV3State> {
  await mutationQueue;
  return await repository.reload();
}

async function mutateCollection<T>(
  mutation: (state: MV3State) => T | Promise<T>,
): Promise<{ state: MV3State; result: T }> {
  return await enqueueMutation(async () => {
    const state = await repository.reload();
    const result = await mutation(state);
    state.collections = reconcileCollectionState(state.collections);
    await repository.writeState(state);
    return { state, result };
  });
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
  return state.collections.items.find((item) => collectionItemKey(item) === normalizedLink) ?? null;
});

onMessage("getPtppCollectionState", async () => {
  const state = await readCollectionState();
  return reconcileCollectionState(state.collections);
});

onMessage("togglePtppCollection", async ({ data: { torrent, detailUrl } }) => {
  const baseItem = buildCollectionItem(torrent, detailUrl);
  const { result } = await mutateCollection<{
    collected: boolean;
    item?: CollectionItemRecord;
  }>(async (state) => {
    const normalizedLink = collectionItemKey(baseItem);
    const existing = state.collections.items.some((candidate) => collectionItemKey(candidate) === normalizedLink);
    if (existing) {
      removeCollectionItems(state.collections, [normalizedLink]);
      return { collected: false as const };
    }
    const collectionItem = await enrichCollectionItem(baseItem);
    addCollectionItem(state.collections, collectionItem);
    return { collected: true as const, item: collectionItem };
  });
  return result;
});

onMessage("replacePtppCollectionState", async ({ data }) => {
  const { state } = await mutateCollection((current) => {
    current.collections = reconcileCollectionState(data);
  });
  return state.collections;
});

onMessage("removePtppCollectionItems", async ({ data: { links } }) => {
  const { state } = await mutateCollection((current) => removeCollectionItems(current.collections, links));
  return state.collections;
});

onMessage("clearPtppCollection", async () => {
  const { state } = await mutateCollection((current) => clearCollection(current.collections));
  return state.collections;
});

onMessage("updatePtppCollectionItem", async ({ data: { link, patch } }) => {
  const { state } = await mutateCollection(async (current) => {
    const existing = current.collections.items.find(
      (item) => collectionItemKey(item) === normalizeCollectionLink(link),
    );
    if (!existing) throw new Error("Favorite item not found");

    const candidate: CollectionItemRecord = {
      ...existing,
      ...patch,
      movieInfo: patch.movieInfo ? JSON.parse(JSON.stringify(patch.movieInfo)) : existing.movieInfo,
    };
    const enriched = await enrichCollectionItem(candidate);
    return updateCollectionItem(current.collections, link, {
      title: enriched.title ?? "",
      subTitle: enriched.subTitle ?? "",
      imdbId: enriched.imdbId ?? "",
      movieInfo: enriched.movieInfo ?? {},
    });
  });
  return state.collections;
});

onMessage("createPtppCollectionGroup", async ({ data }) => {
  const { state } = await mutateCollection((current) => createCollectionGroup(current.collections, data));
  return state.collections;
});

onMessage("updatePtppCollectionGroup", async ({ data: { groupId, patch } }) => {
  const { state } = await mutateCollection((current) => updateCollectionGroup(current.collections, groupId, patch));
  return state.collections;
});

onMessage("deletePtppCollectionGroup", async ({ data: { groupId } }) => {
  const { state } = await mutateCollection((current) => deleteCollectionGroup(current.collections, groupId));
  return state.collections;
});

onMessage("setPtppCollectionItemGroup", async ({ data: { link, groupId, assigned } }) => {
  const { state } = await mutateCollection((current) =>
    setCollectionItemGroup(current.collections, link, groupId, assigned),
  );
  return state.collections;
});

onMessage("setPtppDefaultCollectionGroup", async ({ data: { groupId } }) => {
  const { state } = await mutateCollection((current) => setDefaultCollectionGroup(current.collections, groupId));
  return state.collections;
});
