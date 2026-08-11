import {
  addCollectionItem,
  clearCollection,
  createCollectionGroup,
  deleteCollectionGroup,
  normalizeCollectionLink,
  reconcileCollectionState,
  removeCollectionItems,
  setCollectionItemGroup,
  setDefaultCollectionGroup,
  updateCollectionGroup,
  updateCollectionItem,
} from "../../src/collection/model";
import { COLLECTION_ALL_GROUP_ID, COLLECTION_NO_GROUP_ID, visibleCollectionGroupIds } from "../../src/collection/view";
import type { CollectionState } from "../../src/model/schema";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("PTPP collection test failed: " + message);
}

const state: CollectionState = { groups: [], items: [] };
const groupA = createCollectionGroup(state, { name: "Movies", color: "blue" }, 1_000);
const groupB = createCollectionGroup(state, { name: "TV", color: "green" }, 2_000);
assert(groupA.id !== groupB.id, "new groups receive stable unique IDs");

let duplicateNameRejected = false;
try {
  createCollectionGroup(state, { name: " movies " }, 3_000);
} catch {
  duplicateNameRejected = true;
}
assert(duplicateNameRejected, "duplicate group names are rejected case-insensitively");

setDefaultCollectionGroup(state, groupA.id);
assert(
  addCollectionItem(state, {
    siteId: "audiences",
    title: "Fixture Movie",
    link: "https://audiences.me/details.php?id=42&hit=1#comments",
    url: "https://audiences.me/download.php?id=42&passkey=fixture",
  }),
  "a favorite is added",
);
assert(state.items[0].groups?.[0] === groupA.id, "new favorites inherit the default group");
assert(groupA.id && state.groups.find((group) => group.id === groupA.id)?.count === 1, "group count is recalculated");
assert(
  !addCollectionItem(state, {
    siteId: "audiences",
    title: "Duplicate Movie",
    link: "https://audiences.me/details.php?id=42&page=2",
  }),
  "tracking parameters cannot create duplicate favorites",
);
assert(
  normalizeCollectionLink("https://audiences.me/details.php?id=42&cmtpage=3") ===
    "https://audiences.me/details.php?id=42",
  "legacy comment-page parameters are removed from favorite identity",
);

setCollectionItemGroup(state, state.items[0].link!, groupB.id!, true);
assert(state.items[0].groups?.includes(groupB.id!), "favorites can be assigned to another group");
assert(state.groups.find((group) => group.id === groupB.id)?.count === 1, "assignment updates group counts");

updateCollectionItem(state, state.items[0].link!, {
  title: "Edited Movie",
  subTitle: "Edited subtitle",
  imdbId: "tt1234567",
  movieInfo: { imdbId: "tt1234567" },
});
assert(
  state.items[0].title === "Edited Movie" && state.items[0].imdbId === "tt1234567",
  "favorite metadata is editable",
);

updateCollectionGroup(state, groupB.id!, { name: "Series", color: "purple" }, 4_000);
const editedGroup = state.groups.find((group) => group.id === groupB.id);
assert(
  editedGroup?.name === "Series" && editedGroup.color === "purple" && editedGroup.update === 4_000,
  "groups are editable",
);

assert(deleteCollectionGroup(state, groupA.id!), "groups can be deleted");
assert(!state.items[0].groups?.includes(groupA.id!), "group deletion removes references from favorites");
assert(!state.defaultGroupId, "deleting the default group clears the default selection");

assert(
  visibleCollectionGroupIds({ groups: [], items: [{ link: "https://tracker.invalid/details/1" }] }).length === 0,
  "the group strip is hidden when all favorites are redundantly ungrouped",
);

const archiveGroup = { id: "archive", name: "Archive", count: 0 };
const repaired = reconcileCollectionState({
  groups: [groupB, { ...groupB, name: "Duplicate ID" }, archiveGroup],
  items: [
    {
      title: "Primary item",
      link: "https://tracker.invalid/details.php?id=42&hit=1",
      groups: [groupB.id!],
      time: 2_000,
    },
    {
      subTitle: "Metadata from duplicate",
      url: "https://tracker.invalid/download.php?id=42&token=fixture",
      link: "https://tracker.invalid/details.php?id=42&page=2",
      groups: [archiveGroup.id],
      time: 1_000,
      movieInfo: { imdbId: "tt1234567", title: "Fixture Movie" },
    },
    { title: "Missing detail URL" },
  ],
  defaultGroupId: "missing-group",
});
assert(repaired.groups.length === 2 && repaired.items.length === 1, "damaged duplicate collection state is reconciled");
assert(
  repaired.items[0].title === "Primary item" &&
    repaired.items[0].subTitle === "Metadata from duplicate" &&
    repaired.items[0].movieInfo?.imdbId === "tt1234567" &&
    repaired.items[0].time === 1_000,
  "normalized duplicate favorites retain the richest metadata and earliest favorite time",
);
assert(
  repaired.items[0].groups?.includes(groupB.id!) && repaired.items[0].groups?.includes(archiveGroup.id),
  "normalized duplicate favorites merge group membership without data loss",
);
assert(!repaired.defaultGroupId, "invalid default group references are removed");
assert(
  JSON.stringify(visibleCollectionGroupIds(repaired)) ===
    JSON.stringify([COLLECTION_ALL_GROUP_ID, groupB.id, archiveGroup.id]),
  "custom groups keep the PTPP group strip while omitting an empty synthetic ungrouped card",
);

const mixedGroups = visibleCollectionGroupIds({
  groups: [archiveGroup],
  items: [
    { link: "https://tracker.invalid/details/1", groups: [archiveGroup.id] },
    { link: "https://tracker.invalid/details/2", groups: [] },
  ],
});
assert(
  mixedGroups.includes(COLLECTION_NO_GROUP_ID),
  "the synthetic ungrouped card appears only when it represents a distinct subset",
);

assert(removeCollectionItems(state, [state.items[0].link!]) === 1, "batch removal reports removed favorites");
assert(state.items.length === 0 && state.groups[0].count === 0, "batch removal updates state and counts");

clearCollection(state);
assert(state.items.length === 0 && state.groups.length === 0, "clear removes favorites and groups like legacy PTPP");

console.log("PTPP collection model tests passed");
