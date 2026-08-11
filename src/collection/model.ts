import type { CollectionGroupRecord, CollectionItemRecord, CollectionState } from "../model/schema";

export interface CollectionItemPatch {
  title?: string;
  subTitle?: string;
  imdbId?: string;
  movieInfo?: Record<string, unknown>;
}

export interface CollectionGroupPatch {
  name?: string;
  color?: string;
  description?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeCollectionLink(link: string): string {
  if (!link) return "";
  try {
    const url = new URL(link);
    for (const key of ["hit", "cmtpage", "page"]) url.searchParams.delete(key);
    url.hash = "";
    return url.toString();
  } catch {
    return link
      .replace(/([?&])(hit|cmtpage|page)=[^&]*&?/gi, "$1")
      .replace(/[?&]$/, "")
      .replace(/#.*$/, "");
  }
}

export function collectionItemKey(item: Pick<CollectionItemRecord, "link">): string {
  return normalizeCollectionLink(String(item.link ?? ""));
}

function mergeDuplicateCollectionItem(
  current: CollectionItemRecord,
  duplicate: CollectionItemRecord,
): CollectionItemRecord {
  const merged = clone(current);
  const mergedRecord = merged as Record<string, unknown>;
  const duplicateRecord = duplicate as Record<string, unknown>;

  for (const key of ["siteId", "host", "title", "subTitle", "url", "size", "imdbId"] as const) {
    if (
      (mergedRecord[key] === undefined || mergedRecord[key] === null || mergedRecord[key] === "") &&
      duplicateRecord[key] !== undefined &&
      duplicateRecord[key] !== null &&
      duplicateRecord[key] !== ""
    ) {
      mergedRecord[key] = clone(duplicateRecord[key]);
    }
  }

  const times = [current.time, duplicate.time].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  if (times.length) merged.time = Math.min(...times);

  const movieInfo = {
    ...(duplicate.movieInfo ?? {}),
    ...(current.movieInfo ?? {}),
  };
  if (Object.keys(movieInfo).length) merged.movieInfo = movieInfo;
  merged.groups = [...new Set([...(current.groups ?? []), ...(duplicate.groups ?? [])])];
  return merged;
}

export function reconcileCollectionState(source: CollectionState): CollectionState {
  const state = clone(source);
  const groupIds = new Set<string>();
  state.groups = (state.groups ?? []).filter((group) => {
    if (!group?.id || groupIds.has(group.id)) return false;
    groupIds.add(group.id);
    return true;
  });

  const itemsByKey = new Map<string, CollectionItemRecord>();
  for (const item of state.items ?? []) {
    const key = collectionItemKey(item);
    if (!key) continue;
    item.link = key;
    const existing = itemsByKey.get(key);
    itemsByKey.set(key, existing ? mergeDuplicateCollectionItem(existing, item) : item);
  }
  state.items = [...itemsByKey.values()].map((item) => ({
    ...item,
    groups: [...new Set((item.groups ?? []).filter((groupId) => groupIds.has(groupId)))],
  }));

  for (const group of state.groups) {
    group.count = state.items.filter((item) => item.groups?.includes(group.id!)).length;
  }
  if (state.defaultGroupId && !groupIds.has(state.defaultGroupId)) delete state.defaultGroupId;
  return state;
}

export function addCollectionItem(state: CollectionState, source: CollectionItemRecord): boolean {
  const item = clone(source);
  const key = collectionItemKey(item);
  if (!key) throw new Error("Cannot favorite a torrent without a detail-page link");
  if (state.items.some((candidate) => collectionItemKey(candidate) === key)) return false;

  item.link = key;
  const validGroups = new Set(state.groups.map((group) => group.id).filter(Boolean) as string[]);
  const requestedGroups = item.groups?.length ? item.groups : state.defaultGroupId ? [state.defaultGroupId] : [];
  item.groups = [...new Set(requestedGroups.filter((groupId) => validGroups.has(groupId)))];
  state.items.push(item);
  Object.assign(state, reconcileCollectionState(state));
  return true;
}

export function removeCollectionItems(state: CollectionState, links: string[]): number {
  const keys = new Set(links.map(normalizeCollectionLink).filter(Boolean));
  const before = state.items.length;
  state.items = state.items.filter((item) => !keys.has(collectionItemKey(item)));
  Object.assign(state, reconcileCollectionState(state));
  return before - state.items.length;
}

export function clearCollection(state: CollectionState): void {
  state.items = [];
  state.groups = [];
  delete state.defaultGroupId;
}

export function updateCollectionItem(
  state: CollectionState,
  link: string,
  patch: CollectionItemPatch,
): CollectionItemRecord {
  const key = normalizeCollectionLink(link);
  const item = state.items.find((candidate) => collectionItemKey(candidate) === key);
  if (!item) throw new Error("Favorite item not found");
  if (typeof patch.title === "string") item.title = patch.title.trim();
  if (typeof patch.subTitle === "string") item.subTitle = patch.subTitle.trim();
  if (typeof patch.imdbId === "string") {
    const imdbId = patch.imdbId.trim();
    if (imdbId) item.imdbId = imdbId;
    else delete item.imdbId;
  }
  if (patch.movieInfo) item.movieInfo = clone(patch.movieInfo);
  return item;
}

function createGroupId(state: CollectionState, now: number): string {
  const seed = now.toString(36);
  let candidate = seed.slice(-8);
  let suffix = 0;
  const ids = new Set(state.groups.map((group) => group.id));
  while (ids.has(candidate)) candidate = `${seed.slice(-6)}${(++suffix).toString(36).padStart(2, "0")}`;
  return candidate;
}

export function createCollectionGroup(
  state: CollectionState,
  input: CollectionGroupPatch,
  now = Date.now(),
): CollectionGroupRecord {
  const name = input.name?.trim();
  if (!name) throw new Error("Favorite group name is required");
  if (state.groups.some((group) => group.name?.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error("Favorite group name already exists");
  }
  const group: CollectionGroupRecord = {
    id: createGroupId(state, now),
    name,
    color: input.color?.trim() || "blue",
    description: input.description?.trim() || "",
    count: 0,
    update: now,
  };
  state.groups.push(group);
  return group;
}

export function updateCollectionGroup(
  state: CollectionState,
  groupId: string,
  patch: CollectionGroupPatch,
  now = Date.now(),
): CollectionGroupRecord {
  const group = state.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error("Favorite group not found");
  if (typeof patch.name === "string") {
    const name = patch.name.trim();
    if (!name) throw new Error("Favorite group name is required");
    if (
      state.groups.some(
        (candidate) =>
          candidate.id !== groupId && candidate.name?.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      throw new Error("Favorite group name already exists");
    }
    group.name = name;
  }
  if (typeof patch.color === "string") group.color = patch.color.trim() || "blue";
  if (typeof patch.description === "string") group.description = patch.description.trim();
  group.update = now;
  return group;
}

export function deleteCollectionGroup(state: CollectionState, groupId: string): boolean {
  const before = state.groups.length;
  state.groups = state.groups.filter((group) => group.id !== groupId);
  if (state.groups.length === before) return false;
  for (const item of state.items) item.groups = item.groups?.filter((id) => id !== groupId) ?? [];
  if (state.defaultGroupId === groupId) delete state.defaultGroupId;
  Object.assign(state, reconcileCollectionState(state));
  return true;
}

export function setCollectionItemGroup(
  state: CollectionState,
  link: string,
  groupId: string,
  assigned: boolean,
): CollectionItemRecord {
  if (!state.groups.some((group) => group.id === groupId)) throw new Error("Favorite group not found");
  const key = normalizeCollectionLink(link);
  const item = state.items.find((candidate) => collectionItemKey(candidate) === key);
  if (!item) throw new Error("Favorite item not found");
  const groups = new Set(item.groups ?? []);
  assigned ? groups.add(groupId) : groups.delete(groupId);
  item.groups = [...groups];
  Object.assign(state, reconcileCollectionState(state));
  return state.items.find((candidate) => collectionItemKey(candidate) === key)!;
}

export function setDefaultCollectionGroup(state: CollectionState, groupId?: string): void {
  if (!groupId) {
    delete state.defaultGroupId;
    return;
  }
  if (!state.groups.some((group) => group.id === groupId)) throw new Error("Favorite group not found");
  state.defaultGroupId = groupId;
}
