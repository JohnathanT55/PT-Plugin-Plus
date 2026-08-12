import {
  CURRENT_BACKUP_FIELDS_VERSION,
  createBackupRetryPlan,
  getEffectiveBackupEncryptionKey,
  getNextIntervalBackupAt,
  normalizeBackupFields,
  prepareConfigForBackup,
  shouldUploadAfterUserRefresh,
} from "../../src/backup/policy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Backup policy test failed: ${message}`);
}

const now = 1_000_000;
assert(getNextIntervalBackupAt({ intervalHours: 0 }, now) === undefined, "zero interval disables scheduling");
assert(getNextIntervalBackupAt({ intervalHours: 2 }, now) === now, "a never-backed-up server is due immediately");
assert(
  getNextIntervalBackupAt({ intervalHours: 2, lastBackupAt: now }, now) === now + 2 * 60 * 60 * 1000,
  "the last successful backup anchors the next interval",
);
assert(
  getNextIntervalBackupAt({ intervalHours: 2, lastBackupAt: now, nextBackupAt: now + 5000 }, now) === now + 5000,
  "an explicit schedule survives a service-worker restart",
);

assert(!shouldUploadAfterUserRefresh(2, 0, 3), "an intermediate failed refresh does not upload");
assert(!shouldUploadAfterUserRefresh(2, 2, 3), "a refresh with retries remaining does not upload");
assert(shouldUploadAfterUserRefresh(0, 0, 3), "a successful refresh uploads once");
assert(shouldUploadAfterUserRefresh(2, 3, 3), "the final failed retry uploads the settled full data once");

const firstRetry = createBackupRetryPlan(0, 3, 5, now);
assert(firstRetry?.retryIndex === 1, "the first backup retry is numbered one");
assert(firstRetry?.runAt === now + 5 * 60 * 1000, "the configured retry interval is preserved");
assert(createBackupRetryPlan(3, 3, 5, now) === undefined, "retry planning stops at the configured maximum");

const supportedFields = ["config", "metadata", "collection"];
const migratedFields = normalizeBackupFields(["config", "metadata"], undefined, supportedFields);
assert(migratedFields.changed, "pre-versioned server fields require a one-time migration");
assert(migratedFields.fields.includes("collection"), "the one-time migration adds favorites and groups");
assert(
  migratedFields.version === CURRENT_BACKUP_FIELDS_VERSION,
  "the one-time migration records the current field format",
);
const explicitSelection = normalizeBackupFields(["config", "metadata"], CURRENT_BACKUP_FIELDS_VERSION, supportedFields);
assert(!explicitSelection.fields.includes("collection"), "a current explicit exclusion of collections is preserved");

assert(getEffectiveBackupEncryptionKey(false, "fixture-secret") === "", "the explicit switch disables encryption");
assert(
  getEffectiveBackupEncryptionKey(true, "fixture-secret") === "fixture-secret",
  "the explicit switch enables encryption with a non-empty key",
);
assert(getEffectiveBackupEncryptionKey(true, "   ") === "", "a blank key cannot enable encryption");
const safeConfig = prepareConfigForBackup({
  backup: { encryptionEnabled: true, encryptionKey: "fixture-secret" },
  marker: "retained",
});
assert(!("encryptionKey" in safeConfig.backup!), "the local encryption secret never enters backup config data");
assert(safeConfig.marker === "retained", "redacting the secret preserves other configuration");

console.log("Backup scheduling, retry, and legacy auto-upload policy passed.");
