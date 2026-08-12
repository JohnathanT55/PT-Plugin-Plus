import {
  extendCookieExpiration,
  latestRecordsFromHistory,
  mergeRestoredRecords,
  prependLimitedHistory,
} from "../../src/backup/restore";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Backup restore policy test failed: ${message}`);
}

const backupUserInfo = {
  siteA: {
    latest: { uploaded: 100, name: "from-backup" },
    "2026-08-01": { uploaded: 80 },
  },
  siteB: { latest: { uploaded: 50 } },
};
const existingUserInfo = {
  siteA: {
    latest: { uploaded: 200, ratio: 3 },
    "2026-08-12": { uploaded: 200 },
  },
};

const merged = mergeRestoredRecords(backupUserInfo, existingUserInfo, true);
assert(merged.siteA.latest.uploaded === 200, "existing values win when preserving user data");
assert(merged.siteA.latest.name === "from-backup", "missing nested values are filled from the backup");
assert(merged.siteA["2026-08-01"].uploaded === 80, "older backup history remains available after a merge");
assert(merged.siteA["2026-08-12"].uploaded === 200, "newer local history is retained after a merge");
assert(merged.siteB.latest.uploaded === 50, "sites missing locally are restored");

const replaced = mergeRestoredRecords(backupUserInfo, existingUserInfo, false);
assert(replaced.siteA.latest.uploaded === 100, "replace mode uses the backup value");
assert(!("2026-08-12" in replaced.siteA), "replace mode discards local-only history");

const now = 1_000_000;
assert(extendCookieExpiration(undefined, 30, now) === now + 1800, "session cookies become persistent when extended");
assert(extendCookieExpiration(now - 100, 30, now) === now + 1800, "expired cookies extend from now");
assert(extendCookieExpiration(now + 100, 30, now) === now + 1900, "valid cookies extend from their current expiry");
assert(extendCookieExpiration(now + 100, 0, now) === now + 100, "zero preserves the original cookie expiry");

const limited = prependLimitedHistory([2, 1], 3, 2);
assert(limited.length === 2 && limited[0] === 3 && limited[1] === 2, "backup history is newest-first and bounded");

const latest = latestRecordsFromHistory({
  siteA: { "2026-08-11": { uploaded: 100 }, "2026-08-12": { uploaded: 200 } },
  siteB: { "2026-08-10": { uploaded: 50 } },
});
assert(latest.siteA.uploaded === 200 && latest.siteB.uploaded === 50, "replace mode rebuilds latest-user caches");

console.log("Backup restore, cookie lifetime, and history policy passed.");
