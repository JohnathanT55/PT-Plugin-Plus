import type { CollectionState } from "../model/schema";

export const COLLECTION_ALL_GROUP_ID = "__all__";
export const COLLECTION_NO_GROUP_ID = "__no_group__";

/**
 * Match the archived PTPP collection-page group strip:
 * - do not render a redundant strip when every item is simply ungrouped;
 * - expose the synthetic "ungrouped" card only when it is distinct from "all";
 * - render the strip as soon as at least one custom group exists.
 */
export function visibleCollectionGroupIds(state: CollectionState): string[] {
  const customGroupIds = (state.groups ?? [])
    .map((group) => group.id)
    .filter((groupId): groupId is string => Boolean(groupId));
  const ungroupedCount = (state.items ?? []).filter((item) => !item.groups?.length).length;
  const ids = [COLLECTION_ALL_GROUP_ID];

  if (ungroupedCount > 0 && ungroupedCount < (state.items ?? []).length) {
    ids.push(COLLECTION_NO_GROUP_ID);
  }
  ids.push(...customGroupIds);

  return ids.length > 1 ? ids : [];
}
