import {
  createBackupCleanupPreview as createPreview,
  createBackupFilename,
  createBackupScopeFingerprint,
  executeBackupCleanupItems,
  normalizeBackupRetentionPolicy,
  parseBackupFilename,
  parseLegacyBackupTime,
  sameRemoteFile,
  type IBackupIdentity,
  type IBackupCleanupWorkItem,
  type IRemoteBackupFile,
} from "../../src/backup/retention.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const namespace = "11111111-2222-4333-8444-555555555555";
const otherNamespace = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const verificationKey = "01".repeat(32);
const allFields = ["cookies", "config", "metadata", "userInfo"];

function createBackupCleanupPreview(input: Omit<Parameters<typeof createPreview>[0], "verificationKey">) {
  return createPreview({ ...input, verificationKey });
}

function backupFile(input: {
  index: number;
  createdAt: number;
  trigger?: IBackupIdentity["trigger"];
  fields?: string[];
  namespaceId?: string;
  encryption?: IBackupIdentity["encryption"];
  remoteTime?: number;
  size?: number | "N/A";
}): IRemoteBackupFile {
  const fields = input.fields ?? allFields;
  const identity = {
    backupId: `${input.index.toString(16).padStart(32, "0")}`,
    namespaceId: input.namespaceId ?? namespace,
    serverId: "server-test",
    createdAt: input.createdAt,
    trigger: input.trigger ?? "interval",
    scope: {
      kind:
        fields.length === allFields.length && fields.every((field) => allFields.includes(field)) ? "full" : "selected",
      fields,
      fingerprint: createBackupScopeFingerprint(fields),
    },
    encryption: input.encryption ?? "plain",
  } satisfies Omit<IBackupIdentity, "filename" | "schemaVersion" | "verificationSignature">;
  const filename = createBackupFilename(identity, verificationKey);
  return {
    filename,
    path: `/${filename}`,
    time: input.remoteTime ?? input.createdAt + 1000,
    size: input.size ?? 1024 + input.index,
  };
}

const identityFile = backupFile({
  index: 1,
  createdAt: Date.UTC(2026, 7, 25, 12, 34, 56, 789),
  encryption: "encrypted",
});
const parsedIdentity = parseBackupFilename(identityFile.filename);
assert(parsedIdentity?.namespaceId === namespace, "strict filename restores the server namespace");
assert(parsedIdentity?.backupId === "00000000-0000-0000-0000-000000000001", "strict filename restores backupId");
assert(parsedIdentity?.encryption === "encrypted", "strict filename exposes a known encryption state");
assert(parsedIdentity?.scopeKind === "full", "strict filename exposes the scope kind");
assert(parsedIdentity.createdAt === Date.UTC(2026, 7, 25, 12, 34, 56, 789), "UTC milliseconds round-trip");
assert(
  parsedIdentity.verificationSignature === "2fa5dc6f0449881d",
  "filename verification uses the expected truncated HMAC-SHA-256 vector",
);

const productionFields = [
  "cookies",
  "config",
  "metadata",
  "userInfo",
  "searchResultSnapshot",
  "keepUploadTask",
  "downloadHistory",
  "collection",
];
const allScopeFingerprints = new Set(
  Array.from({ length: 2 ** productionFields.length }, (_, mask) =>
    createBackupScopeFingerprint(productionFields.filter((_, index) => mask & (1 << index))),
  ),
);
assert(
  allScopeFingerprints.size === 2 ** productionFields.length,
  "every supported field subset has a unique scope fingerprint",
);

assert(parseLegacyBackupTime("PTPP_backup_20260825T123456789.zip") !== undefined, "strict legacy name parses");
assert(parseLegacyBackupTime("PTPP_backup_20260825T123456.zip") === undefined, "short legacy lookalike is rejected");
assert(
  parseBackupFilename(identityFile.filename.replace("_e_", "_x_")) === undefined,
  "unknown encryption is rejected",
);
assert(
  parseBackupFilename(identityFile.filename.replace(".zip", ".zip.tmp")) === undefined,
  "temporary suffix is rejected",
);

const day = 86400000;
const now = Date.UTC(2026, 7, 25, 12);
const ageFiles = [0, 1, 10, 20, 40].map((days, index) =>
  backupFile({ index: 10 + index, createdAt: now - days * day }),
);
const agePreview = createBackupCleanupPreview({
  files: ageFiles,
  namespaceId: namespace,
  now,
  policy: { enabled: true, strategy: "age", maxAgeDays: 7, minKeep: 3 },
});
assert(agePreview.candidateCount === 2, "age policy deletes only old files beyond the per-stream minimum");
assert(
  agePreview.files.filter((file) => file.reason === "minimum").length === 3,
  "age policy protects the newest minimum",
);

const countPreview = createBackupCleanupPreview({
  files: ageFiles,
  namespaceId: namespace,
  now,
  policy: { enabled: true, strategy: "count", keepLatest: 2, minKeep: 3 },
});
assert(countPreview.candidateCount === 2, "count policy never undercuts the larger minimum");

const separateStreams = [
  ...[0, 1, 2, 3].map((days, index) => backupFile({ index: 30 + index, createdAt: now - days * day })),
  ...[0, 1, 2, 3].map((days, index) =>
    backupFile({ index: 40 + index, createdAt: now - days * day, trigger: "userDataRefresh" }),
  ),
  ...[0, 1, 2, 3].map((days, index) =>
    backupFile({ index: 50 + index, createdAt: now - days * day, fields: ["cookies", "metadata"] }),
  ),
];
const streamsPreview = createBackupCleanupPreview({
  files: separateStreams,
  namespaceId: namespace,
  now,
  policy: { enabled: true, strategy: "count", keepLatest: 3, minKeep: 3 },
});
assert(streamsPreview.candidateCount === 3, "trigger and selected-field fingerprint form independent streams");
assert(
  new Set(streamsPreview.files.filter((file) => file.classification === "automatic").map((file) => file.streamKey))
    .size === 3,
  "three independent stream keys are retained",
);

const protectedNewest = ageFiles[0].path;
const protectPreview = createBackupCleanupPreview({
  files: ageFiles,
  namespaceId: namespace,
  now,
  protectedPaths: [protectedNewest],
  policy: { enabled: true, strategy: "count", keepLatest: 1, minKeep: 1 },
});
assert(
  protectPreview.files.find((file) => file.path === protectedNewest)?.disposition === "protected",
  "the just-uploaded or actively-restored file is immutable",
);

const manual = backupFile({ index: 70, createdAt: now - 100 * day, trigger: "manual" });
const other = backupFile({ index: 71, createdAt: now - 100 * day, namespaceId: otherNamespace });
const legacyName = "PTPP_backup_20250101T010203004.zip";
const legacy: IRemoteBackupFile = { filename: legacyName, path: `/${legacyName}`, time: now - 500 * day, size: 2048 };
const lookalike: IRemoteBackupFile = {
  filename: identityFile.filename.replace("PTPP_mv3_v1", "PTPP_mv3_v01"),
  path: "/lookalike.zip",
  time: now - 500 * day,
  size: 2048,
};
const forgedFilename = identityFile.filename.replace(
  /_([0-9a-f])([0-9a-f]{15})\.zip$/,
  (_all, first, rest) => `_${first === "0" ? "1" : "0"}${rest}.zip`,
);
const forged: IRemoteBackupFile = {
  filename: forgedFilename,
  path: `/${forgedFilename}`,
  time: now - 500 * day,
  size: 2048,
};
const temporary: IRemoteBackupFile = { filename: "PTPP_mv3_upload.zip.part", path: "/upload.part", time: now, size: 3 };
const unsafePreview = createBackupCleanupPreview({
  files: [manual, other, legacy, lookalike, forged, temporary],
  namespaceId: namespace,
  now,
  forcePolicy: true,
  policy: { enabled: true, strategy: "age", maxAgeDays: 1, minKeep: 1 },
});
assert(unsafePreview.candidateCount === 0, "manual, other namespace, legacy, lookalike, and temp files are protected");
assert(unsafePreview.files.find((file) => file.path === manual.path)?.classification === "manual", "manual is labeled");
assert(
  unsafePreview.files.find((file) => file.path === other.path)?.classification === "otherServer",
  "other stream is labeled",
);
assert(unsafePreview.files.find((file) => file.path === legacy.path)?.classification === "legacy", "legacy is labeled");
assert(
  unsafePreview.files.find((file) => file.path === forged.path)?.classification === "unverified",
  "a strict current-namespace filename with a forged signature is protected",
);
assert(
  unsafePreview.files.find((file) => file.path === temporary.path)?.classification === "temporary",
  "temp is labeled",
);

const legacyFiles = [0, 5, 10, 20].map((days, index) => {
  const timestamp = new Date(now - days * day).toISOString().replace(/[-:.]/g, "").slice(0, -1);
  const filename = `PTPP_backup_${timestamp}.zip`;
  return { filename, path: `/${filename}`, time: now - days * day, size: 1000 + index };
});
const legacyOneTime = createBackupCleanupPreview({
  files: legacyFiles,
  namespaceId: namespace,
  now,
  includeLegacyOnce: true,
  forcePolicy: true,
  policy: { enabled: false, strategy: "count", keepLatest: 2, minKeep: 2 },
});
assert(legacyOneTime.candidateCount === 2, "legacy files are eligible only in an explicit one-time forced preview");
const legacyDefault = createBackupCleanupPreview({
  files: legacyFiles,
  namespaceId: namespace,
  now,
  policy: { enabled: true, strategy: "count", keepLatest: 2, minKeep: 2 },
});
assert(legacyDefault.candidateCount === 0, "legacy files never enter automatic cleanup");

const disabledPreview = createBackupCleanupPreview({
  files: ageFiles,
  namespaceId: namespace,
  now,
  policy: { enabled: false, strategy: "count", keepLatest: 1, minKeep: 1 },
});
assert(disabledPreview.candidateCount === 0, "disabled per-server policy has no candidates");

const unreliable = backupFile({ index: 80, createdAt: now - 200 * day, remoteTime: Number.NaN });
const traversal = { ...backupFile({ index: 81, createdAt: now - 200 * day }), path: "/safe/%2e%2e/target.zip" };
const unreliablePreview = createBackupCleanupPreview({
  files: [unreliable, traversal, ...ageFiles],
  namespaceId: namespace,
  now,
  forcePolicy: true,
  policy: { enabled: true, strategy: "count", keepLatest: 1, minKeep: 1 },
});
assert(
  unreliablePreview.files.find((file) => file.path === unreliable.path)?.classification === "unverified",
  "unparseable remote time is never deleted",
);
assert(
  unreliablePreview.files.find((file) => file.path === traversal.path)?.classification === "unverified",
  "a strict-looking name with an unsafe or mismatched remote path is never deleted",
);

const duplicateTime = [90, 91, 92, 93].map((index) => backupFile({ index, createdAt: now - 50 * day }));
const duplicatePreview = createBackupCleanupPreview({
  files: duplicateTime,
  namespaceId: namespace,
  now,
  forcePolicy: true,
  policy: { enabled: true, strategy: "count", keepLatest: 2, minKeep: 2 },
});
assert(duplicatePreview.candidateCount === 2, "duplicate timestamps use deterministic filename/path tie breakers");
assert(
  duplicatePreview.candidatePaths.join("|") ===
    createBackupCleanupPreview({
      files: [...duplicateTime].reverse(),
      namespaceId: namespace,
      now,
      forcePolicy: true,
      policy: { enabled: true, strategy: "count", keepLatest: 2, minKeep: 2 },
    }).candidatePaths.join("|"),
  "duplicate timestamp results do not depend on remote listing order",
);

const tierFiles = Array.from({ length: 70 }, (_, index) =>
  backupFile({ index: 100 + index, createdAt: Date.UTC(2026, 2, 15) - index * day }),
);
const tierPolicy = normalizeBackupRetentionPolicy({
  enabled: true,
  strategy: "count",
  keepLatest: 1,
  minKeep: 1,
  tiered: { enabled: true, recentCount: 2, weeklyCount: 4, monthlyCount: 3, timeZone: "America/New_York" },
});
assert(
  normalizeBackupRetentionPolicy({ tiered: { timeZone: "Not/AZone" } }).tiered.timeZone === "UTC",
  "invalid calendar time zones safely normalize to UTC",
);
const tierPreview = createBackupCleanupPreview({
  files: tierFiles,
  namespaceId: namespace,
  now: Date.UTC(2026, 2, 15),
  policy: tierPolicy,
});
assert(
  tierPreview.files.filter((file) => file.reason === "tiered").length >= 5,
  "weekly/monthly tiers protect representatives",
);
assert(tierPreview.candidateCount < 69, "tier protection is applied on top of the base count strategy");

const dstFiles = [
  Date.UTC(2026, 9, 31, 5),
  Date.UTC(2026, 10, 1, 5),
  Date.UTC(2026, 10, 2, 5),
  Date.UTC(2026, 10, 8, 5),
].map((createdAt, index) => backupFile({ index: 200 + index, createdAt }));
const dstPreview = createBackupCleanupPreview({
  files: dstFiles,
  namespaceId: namespace,
  now: Date.UTC(2026, 10, 10),
  policy: {
    enabled: true,
    strategy: "count",
    keepLatest: 1,
    minKeep: 1,
    tiered: { enabled: true, recentCount: 0, weeklyCount: 3, monthlyCount: 2, timeZone: "America/New_York" },
  },
});
assert(
  dstPreview.files.some((file) => file.reason === "tiered"),
  "DST/week/month boundaries produce stable tier buckets",
);

const changedInventory = createBackupCleanupPreview({
  files: [...ageFiles, backupFile({ index: 250, createdAt: now + 1 })],
  namespaceId: namespace,
  now,
  policy: { enabled: true, strategy: "age", maxAgeDays: 7, minKeep: 3 },
});
assert(changedInventory.token !== agePreview.token, "preview token changes when the remote inventory changes");
const changedPolicy = createBackupCleanupPreview({
  files: ageFiles,
  namespaceId: namespace,
  now,
  policy: { enabled: true, strategy: "age", maxAgeDays: 8, minKeep: 3 },
});
assert(changedPolicy.token !== agePreview.token, "preview token changes when policy changes");

const executorSource = [
  backupFile({ index: 270, createdAt: now - 30 * day }),
  backupFile({ index: 271, createdAt: now - 31 * day }),
  backupFile({ index: 272, createdAt: now - 32 * day }),
];
let executorInventory = [...executorSource];
let transientListFailure = true;
const workItems: IBackupCleanupWorkItem[] = executorSource.map((file) => ({
  ...file,
  status: "pending",
  attempts: 0,
}));
const persisted: string[] = [];
const firstExecution = await executeBackupCleanupItems({
  items: workItems,
  list: async () => {
    if (transientListFailure) {
      transientListFailure = false;
      throw new Error("list unavailable with password=secret");
    }
    return [...executorInventory];
  },
  remove: async (path) => {
    if (path === executorSource[2].path) throw new Error("delete unavailable");
    executorInventory = executorInventory.filter((file) => file.path !== path);
    return true;
  },
  validate: (item, current) => (sameRemoteFile(item, current) ? true : "changed"),
  sanitizeError: (error) => String(error).replace(/password=[^\s]+/, "password=[REDACTED]"),
  persist: async (item, result) => persisted.push(`${item.path}:${result.status}`),
});
assert(firstExecution[0].status === "failed", "list uncertainty causes no deletion for that item");
assert(firstExecution[1].status === "deleted", "a later item can succeed after an earlier list failure");
assert(firstExecution[2].status === "failed", "a per-file delete failure is recorded independently");
assert(
  executorInventory.some((file) => file.path === executorSource[0].path),
  "list failure leaves its file untouched",
);
assert(
  !executorInventory.some((file) => file.path === executorSource[1].path),
  "successful deletion is not rolled back",
);
assert(workItems[0].status === "pending" && workItems[2].status === "pending", "failed items remain retryable");
assert(persisted.length === 3, "every attempted file is persisted separately");
assert(!JSON.stringify(firstExecution).includes("secret"), "cleanup errors are sanitized before persistence");

let removeCalls = 0;
const retryExecution = await executeBackupCleanupItems({
  items: workItems,
  list: async () => [...executorInventory],
  remove: async (path) => {
    removeCalls += 1;
    executorInventory = executorInventory.filter((file) => file.path !== path);
    return true;
  },
  validate: (item, current) => (sameRemoteFile(item, current) ? true : "changed"),
  persist: () => undefined,
});
assert(
  retryExecution.every((result) => result.status === "deleted"),
  "pending failures safely retry later",
);
assert(removeCalls === 2, "completed items are never deleted twice");

const uncertainFile = backupFile({ index: 280, createdAt: now - 40 * day });
const uncertainItem: IBackupCleanupWorkItem = { ...uncertainFile, status: "pending", attempts: 0 };
let uncertainInventory = [uncertainFile];
let failVerification = true;
let uncertainRemoveCalls = 0;
const uncertainFirst = await executeBackupCleanupItems({
  items: [uncertainItem],
  list: async () => {
    if (failVerification && uncertainInventory.length === 0) {
      failVerification = false;
      throw new Error("connection closed after DELETE");
    }
    return [...uncertainInventory];
  },
  remove: async () => {
    uncertainRemoveCalls += 1;
    uncertainInventory = [];
    return true;
  },
  validate: () => true,
  persist: () => undefined,
});
assert(uncertainFirst[0].status === "failed", "uncertain post-delete verification remains pending");
const uncertainRetry = await executeBackupCleanupItems({
  items: [uncertainItem],
  list: async () => [],
  remove: async () => {
    uncertainRemoveCalls += 1;
    return true;
  },
  validate: () => true,
  persist: () => undefined,
});
assert(uncertainRetry[0].status === "missing", "restart treats an already absent file as idempotent success");
assert(uncertainRemoveCalls === 1, "restart never repeats a deletion whose remote effect already happened");

console.log("Backup identity, strict classification, retention streams, tiers, and safety boundaries passed.");
