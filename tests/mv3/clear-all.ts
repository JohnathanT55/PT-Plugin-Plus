import { clearSearchSnapshotsWithRollback } from "../../src/storage/clearSnapshots";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Clear-all test failed: ${message}`);
}

interface TestMetadata {
  snapshots: Record<string, { name: string }>;
  untouched: string;
}

let snapshotData: Record<string, { values: number[] }> = {
  first: { values: [1] },
  second: { values: [2] },
};
let metadata: TestMetadata = {
  snapshots: { first: { name: "First" }, second: { name: "Second" } },
  untouched: "preserved",
};

const count = await clearSearchSnapshotsWithRollback({
  async loadSnapshotData() {
    return structuredClone(snapshotData);
  },
  async loadMetadata() {
    return structuredClone(metadata);
  },
  async saveSnapshotData(value) {
    snapshotData = structuredClone(value);
  },
  async saveMetadata(value) {
    metadata = structuredClone(value);
  },
  emptySnapshotData: () => ({}),
});

assert(count === 2, "successful clear reports the number of snapshots");
assert(Object.keys(snapshotData).length === 0, "successful clear removes snapshot contents");
assert(Object.keys(metadata.snapshots).length === 0, "successful clear removes snapshot metadata");
assert(metadata.untouched === "preserved", "successful clear preserves unrelated metadata");

snapshotData = { rollback: { values: [3] } };
metadata = { snapshots: { rollback: { name: "Rollback" } }, untouched: "preserved" };
let failMetadataOnce = true;
let rejected = false;
try {
  await clearSearchSnapshotsWithRollback({
    async loadSnapshotData() {
      return structuredClone(snapshotData);
    },
    async loadMetadata() {
      return structuredClone(metadata);
    },
    async saveSnapshotData(value) {
      snapshotData = structuredClone(value);
    },
    async saveMetadata(value) {
      if (failMetadataOnce) {
        failMetadataOnce = false;
        throw new Error("fixture metadata write failed");
      }
      metadata = structuredClone(value);
    },
    emptySnapshotData: () => ({}),
  });
} catch {
  rejected = true;
}

assert(rejected, "a partial clear failure is reported to the caller");
assert(snapshotData.rollback.values[0] === 3, "a partial clear restores snapshot contents");
assert(metadata.snapshots.rollback.name === "Rollback", "a partial clear restores snapshot metadata");

console.log("Search snapshot clear-all success and rollback behavior passed.");
