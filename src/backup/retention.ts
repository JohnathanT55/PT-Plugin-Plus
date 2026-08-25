import Hex from "crypto-js/enc-hex";
import HmacSHA256 from "crypto-js/hmac-sha256";

export const BACKUP_FILENAME_SCHEMA_VERSION = 1 as const;
export const DEFAULT_BACKUP_RETENTION_POLICY = {
  enabled: false,
  strategy: "age",
  maxAgeDays: 30,
  minKeep: 3,
  keepLatest: 10,
  tiered: {
    enabled: false,
    recentCount: 3,
    weeklyCount: 4,
    monthlyCount: 6,
    timeZone: "UTC",
  },
} as const;

export type TBackupIdentityTrigger = "manual" | "interval" | "userDataRefresh";
export type TBackupScopeKind = "full" | "selected";
export type TBackupEncryptionMode = "encrypted" | "plain";
export type TBackupRetentionStrategy = "age" | "count";

export interface IBackupRetentionPolicy {
  enabled: boolean;
  strategy: TBackupRetentionStrategy;
  maxAgeDays: number;
  minKeep: number;
  keepLatest: number;
  tiered: {
    enabled: boolean;
    recentCount: number;
    weeklyCount: number;
    monthlyCount: number;
    timeZone: string;
  };
}

export interface IBackupIdentity {
  schemaVersion: typeof BACKUP_FILENAME_SCHEMA_VERSION;
  backupId: string;
  namespaceId: string;
  serverId: string;
  createdAt: number;
  trigger: TBackupIdentityTrigger;
  scope: {
    kind: TBackupScopeKind;
    fields: string[];
    fingerprint: string;
  };
  encryption: TBackupEncryptionMode;
  verificationSignature: string;
  filename: string;
}

export interface IRemoteBackupFile {
  filename: string;
  path: string;
  time: number;
  size: number | "N/A";
}

export type TBackupFileClassification = "automatic" | "manual" | "legacy" | "otherServer" | "temporary" | "unverified";
export type TBackupRetentionDisposition = "keep" | "candidate" | "protected";

export interface IClassifiedBackupFile extends IRemoteBackupFile {
  classification: TBackupFileClassification;
  disposition: TBackupRetentionDisposition;
  reason: string;
  identity?: Omit<IBackupIdentity, "serverId" | "scope" | "filename"> & {
    scopeKind: TBackupScopeKind;
    scopeFingerprint: string;
  };
  streamKey?: string;
}

export interface IBackupCleanupPreview {
  token: string;
  namespaceId: string;
  generatedAt: number;
  includeLegacyOnce: boolean;
  files: IClassifiedBackupFile[];
  candidatePaths: string[];
  keepCount: number;
  protectedCount: number;
  candidateCount: number;
  candidateBytes: number;
  unknownCandidateSizeCount: number;
  oldestCandidateAt?: number;
  newestCandidateAt?: number;
}

export interface IBackupCleanupRequest {
  backupServerId: string;
  previewToken: string;
  paths: string[];
  includeLegacyOnce?: boolean;
  protectedPaths?: string[];
}

export interface IBackupCleanupFileResult {
  path: string;
  status: "deleted" | "missing" | "skipped" | "failed";
  error?: string;
}

export interface IBackupCleanupWorkItem extends IRemoteBackupFile {
  status: "pending" | "deleted" | "missing" | "skipped";
  attempts: number;
  error?: string;
}

export interface IBackupCleanupResult {
  runId: string;
  status: "completed" | "partial" | "failed" | "nothingToDo";
  requestedCount: number;
  deletedCount: number;
  missingCount: number;
  skippedCount: number;
  failedCount: number;
  releasedBytes: number;
  results: IBackupCleanupFileResult[];
  error?: string;
}

export interface IBackupExportResult {
  ok: boolean;
  local: boolean;
  filename: string;
  path?: string;
  identity: IBackupIdentity;
  verifiedRemote?: boolean;
}

const STRICT_BACKUP_NAME =
  /^PTPP_mv3_v1_([0-9a-f]{32})_(m|i|u)_([as])-([0-9a-f]{16})_([pe])_(\d{8}T\d{9}Z)_([0-9a-f]{32})_([0-9a-f]{16})\.zip$/;
const LEGACY_BACKUP_NAME = /^PTPP_backup_(\d{8}T\d{9})(?:Z)?\.zip$/;
const TEMPORARY_FILE = /(?:\.tmp|\.temp|\.part|\.crdownload|\.upload)$/i;

function asInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value as number)));
}

export function normalizeBackupRetentionPolicy(value: unknown): IBackupRetentionPolicy {
  const policy = value && typeof value === "object" ? (value as Partial<IBackupRetentionPolicy>) : {};
  const tiered: Partial<IBackupRetentionPolicy["tiered"]> =
    policy.tiered && typeof policy.tiered === "object" ? policy.tiered : {};
  const timeZone = typeof tiered.timeZone === "string" && isValidTimeZone(tiered.timeZone) ? tiered.timeZone : "UTC";
  return {
    enabled: policy.enabled === true,
    strategy: policy.strategy === "count" ? "count" : "age",
    maxAgeDays: asInteger(policy.maxAgeDays, DEFAULT_BACKUP_RETENTION_POLICY.maxAgeDays, 1, 36500),
    minKeep: asInteger(policy.minKeep, DEFAULT_BACKUP_RETENTION_POLICY.minKeep, 1, 10000),
    keepLatest: asInteger(policy.keepLatest, DEFAULT_BACKUP_RETENTION_POLICY.keepLatest, 1, 10000),
    tiered: {
      enabled: tiered.enabled === true,
      recentCount: asInteger(tiered.recentCount, DEFAULT_BACKUP_RETENTION_POLICY.tiered.recentCount, 0, 10000),
      weeklyCount: asInteger(tiered.weeklyCount, DEFAULT_BACKUP_RETENTION_POLICY.tiered.weeklyCount, 0, 10000),
      monthlyCount: asInteger(tiered.monthlyCount, DEFAULT_BACKUP_RETENTION_POLICY.tiered.monthlyCount, 0, 10000),
      timeZone,
    },
  };
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeUuid(value: string): string | undefined {
  const compact = value.toLowerCase().replaceAll("-", "");
  return /^[0-9a-f]{32}$/.test(compact) ? compact : undefined;
}

export function normalizeBackupVerificationKey(value: string): string | undefined {
  const normalized = value.toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : undefined;
}

export function createBackupVerificationKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function expandUuid(value: string): string | undefined {
  const compact = normalizeUuid(value);
  if (!compact) return undefined;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

/** Stable, non-secret fingerprint for the exact selected field set. */
export function createBackupScopeFingerprint(fields: readonly string[]): string {
  const canonical = [...new Set(fields.filter((field) => typeof field === "string"))].sort().join("\u001f");
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function formatUtcTimestamp(createdAt: number): string {
  if (!Number.isFinite(createdAt)) throw new Error("Backup creation time is invalid.");
  return new Date(createdAt).toISOString().replace(/[-:.]/g, "");
}

function parseUtcTimestamp(value: string): number | undefined {
  if (!/^\d{8}T\d{9}Z$/.test(value)) return undefined;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}.${value.slice(15, 18)}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && formatUtcTimestamp(parsed) === value ? parsed : undefined;
}

function triggerCode(trigger: TBackupIdentityTrigger): "m" | "i" | "u" {
  return trigger === "manual" ? "m" : trigger === "interval" ? "i" : "u";
}

function triggerFromCode(value: string): TBackupIdentityTrigger {
  return value === "m" ? "manual" : value === "i" ? "interval" : "userDataRefresh";
}

function backupFilenameStem(input: Omit<IBackupIdentity, "filename" | "schemaVersion" | "verificationSignature">) {
  const namespace = normalizeUuid(input.namespaceId);
  const backupId = normalizeUuid(input.backupId);
  if (!namespace || !backupId) throw new Error("Backup identity UUID is invalid.");
  if (!/^[0-9a-f]{16}$/.test(input.scope.fingerprint)) throw new Error("Backup scope fingerprint is invalid.");
  const scopeCode = input.scope.kind === "full" ? "a" : "s";
  const encryptionCode = input.encryption === "encrypted" ? "e" : "p";
  return `PTPP_mv3_v1_${namespace}_${triggerCode(input.trigger)}_${scopeCode}-${input.scope.fingerprint}_${encryptionCode}_${formatUtcTimestamp(input.createdAt)}_${backupId}`;
}

function createBackupVerificationSignature(stem: string, verificationKey: string): string {
  const key = normalizeBackupVerificationKey(verificationKey);
  if (!key) throw new Error("Backup verification key is invalid.");
  return HmacSHA256(stem, Hex.parse(key)).toString(Hex).slice(0, 16);
}

export function createBackupFilename(
  input: Omit<IBackupIdentity, "filename" | "schemaVersion" | "verificationSignature">,
  verificationKey: string,
): string {
  const key = normalizeBackupVerificationKey(verificationKey);
  if (!key) throw new Error("Backup verification key is invalid.");
  const stem = backupFilenameStem(input);
  const signature = createBackupVerificationSignature(stem, key);
  return `${stem}_${signature}.zip`;
}

export function parseBackupFilename(filename: string): IClassifiedBackupFile["identity"] | undefined {
  const match = STRICT_BACKUP_NAME.exec(filename);
  if (!match) return undefined;
  const createdAt = parseUtcTimestamp(match[6]);
  const namespaceId = expandUuid(match[1]);
  const backupId = expandUuid(match[7]);
  if (createdAt === undefined || !namespaceId || !backupId) return undefined;
  return {
    schemaVersion: BACKUP_FILENAME_SCHEMA_VERSION,
    namespaceId,
    backupId,
    createdAt,
    trigger: triggerFromCode(match[2]),
    scopeKind: match[3] === "a" ? "full" : "selected",
    scopeFingerprint: match[4],
    encryption: match[5] === "e" ? "encrypted" : "plain",
    verificationSignature: match[8],
  };
}

function verifyBackupFilenameIdentity(
  identity: NonNullable<IClassifiedBackupFile["identity"]>,
  verificationKey: string,
): boolean {
  const key = normalizeBackupVerificationKey(verificationKey);
  if (!key) return false;
  const stem = backupFilenameStem({
    backupId: identity.backupId,
    namespaceId: identity.namespaceId,
    serverId: "",
    createdAt: identity.createdAt,
    trigger: identity.trigger,
    scope: {
      kind: identity.scopeKind,
      fields: [],
      fingerprint: identity.scopeFingerprint,
    },
    encryption: identity.encryption,
  });
  return identity.verificationSignature === createBackupVerificationSignature(stem, key);
}

export function parseLegacyBackupTime(filename: string): number | undefined {
  const match = LEGACY_BACKUP_NAME.exec(filename);
  if (!match) return undefined;
  return parseUtcTimestamp(`${match[1]}Z`);
}

function streamKey(identity: NonNullable<IClassifiedBackupFile["identity"]>): string {
  return [
    normalizeUuid(identity.namespaceId),
    identity.trigger,
    identity.scopeKind,
    identity.scopeFingerprint,
    identity.encryption,
  ].join(":");
}

function hasSafeRemotePath(file: IRemoteBackupFile): boolean {
  if (!file.path || file.path.includes("\\") || file.path.includes("\0") || /[?#]/.test(file.path)) return false;
  let decoded = file.path;
  try {
    decoded = decodeURIComponent(file.path);
  } catch {
    return false;
  }
  const segments = decoded.split("/").filter(Boolean);
  return (
    segments.length > 0 && !segments.includes("..") && !segments.includes(".") && segments.at(-1) === file.filename
  );
}

function hasReliableRemoteMetadata(file: IRemoteBackupFile): boolean {
  return (
    hasSafeRemotePath(file) && Number.isFinite(file.time) && file.time > 0 && (file.size === "N/A" || file.size >= 0)
  );
}

export function classifyBackupFile(
  file: IRemoteBackupFile,
  namespaceId: string,
  verificationKey: string,
): IClassifiedBackupFile {
  if (TEMPORARY_FILE.test(file.filename)) {
    return { ...file, classification: "temporary", disposition: "protected", reason: "temporary" };
  }
  const identity = parseBackupFilename(file.filename);
  if (identity) {
    if (normalizeUuid(identity.namespaceId) !== normalizeUuid(namespaceId)) {
      return { ...file, identity, classification: "otherServer", disposition: "protected", reason: "otherServer" };
    }
    if (!verifyBackupFilenameIdentity(identity, verificationKey)) {
      return { ...file, identity, classification: "unverified", disposition: "protected", reason: "signature" };
    }
    if (!hasReliableRemoteMetadata(file)) {
      return { ...file, identity, classification: "unverified", disposition: "protected", reason: "remoteMetadata" };
    }
    if (identity.trigger === "manual") {
      return { ...file, identity, classification: "manual", disposition: "protected", reason: "manual" };
    }
    return {
      ...file,
      identity,
      streamKey: streamKey(identity),
      classification: "automatic",
      disposition: "keep",
      reason: "policy",
    };
  }
  if (parseLegacyBackupTime(file.filename) !== undefined) {
    return { ...file, classification: "legacy", disposition: "protected", reason: "legacy" };
  }
  return { ...file, classification: "unverified", disposition: "protected", reason: "unverified" };
}

function calendarParts(timestamp: number, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function calendarBucket(timestamp: number, timeZone: string, mode: "week" | "month"): string {
  const { year, month, day } = calendarParts(timestamp, timeZone);
  if (mode === "month") return `${year}-${String(month).padStart(2, "0")}`;
  const daySerial = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondaySerial = daySerial - ((weekday + 6) % 7);
  return new Date(mondaySerial * 86400000).toISOString().slice(0, 10);
}

function compareNewest(a: IClassifiedBackupFile, b: IClassifiedBackupFile): number {
  const timeDiff =
    (b.identity?.createdAt ?? parseLegacyBackupTime(b.filename) ?? 0) -
    (a.identity?.createdAt ?? parseLegacyBackupTime(a.filename) ?? 0);
  return timeDiff || b.filename.localeCompare(a.filename) || b.path.localeCompare(a.path);
}

function tieredProtectedPaths(files: IClassifiedBackupFile[], policy: IBackupRetentionPolicy): Set<string> {
  const protectedPaths = new Set<string>();
  if (!policy.tiered.enabled) return protectedPaths;
  const sorted = [...files].sort(compareNewest);
  for (const file of sorted.slice(0, policy.tiered.recentCount)) protectedPaths.add(file.path);

  const weeklyBuckets = new Set<string>();
  for (const file of sorted) {
    if (protectedPaths.has(file.path) || weeklyBuckets.size >= policy.tiered.weeklyCount) continue;
    const timestamp = file.identity?.createdAt ?? parseLegacyBackupTime(file.filename);
    if (timestamp === undefined) continue;
    const bucket = calendarBucket(timestamp, policy.tiered.timeZone, "week");
    if (!weeklyBuckets.has(bucket)) {
      weeklyBuckets.add(bucket);
      protectedPaths.add(file.path);
    }
  }

  const monthlyBuckets = new Set<string>();
  for (const file of sorted) {
    if (protectedPaths.has(file.path) || monthlyBuckets.size >= policy.tiered.monthlyCount) continue;
    const timestamp = file.identity?.createdAt ?? parseLegacyBackupTime(file.filename);
    if (timestamp === undefined) continue;
    const bucket = calendarBucket(timestamp, policy.tiered.timeZone, "month");
    if (!monthlyBuckets.has(bucket)) {
      monthlyBuckets.add(bucket);
      protectedPaths.add(file.path);
    }
  }
  return protectedPaths;
}

function applyPolicyToGroup(
  group: IClassifiedBackupFile[],
  policy: IBackupRetentionPolicy,
  now: number,
  immutablePaths: Set<string>,
): void {
  const sorted = [...group].sort(compareNewest);
  const tiered = tieredProtectedPaths(sorted, policy);
  const minimum = Math.max(1, policy.minKeep);
  const keepByCount = Math.max(minimum, policy.keepLatest);
  const cutoff = now - policy.maxAgeDays * 86400000;
  sorted.forEach((file, index) => {
    const createdAt = file.identity?.createdAt ?? parseLegacyBackupTime(file.filename);
    if (immutablePaths.has(file.path)) {
      file.disposition = "protected";
      file.reason = "active";
    } else if (index < minimum) {
      file.disposition = "keep";
      file.reason = "minimum";
    } else if (tiered.has(file.path)) {
      file.disposition = "keep";
      file.reason = "tiered";
    } else if (policy.strategy === "count" ? index >= keepByCount : createdAt !== undefined && createdAt < cutoff) {
      file.disposition = "candidate";
      file.reason = policy.strategy;
    } else {
      file.disposition = "keep";
      file.reason = "policy";
    }
  });
}

function stableToken(input: string): string {
  return createBackupScopeFingerprint([input]);
}

export function createBackupCleanupPreview(input: {
  files: readonly IRemoteBackupFile[];
  namespaceId: string;
  verificationKey: string;
  policy: IBackupRetentionPolicy | unknown;
  now?: number;
  protectedPaths?: readonly string[];
  includeLegacyOnce?: boolean;
  forcePolicy?: boolean;
}): IBackupCleanupPreview {
  const policy = normalizeBackupRetentionPolicy(input.policy);
  const now = Number.isFinite(input.now) ? input.now! : Date.now();
  const immutablePaths = new Set(input.protectedPaths ?? []);
  const files = input.files.map((file) => classifyBackupFile(file, input.namespaceId, input.verificationKey));
  const byStream = new Map<string, IClassifiedBackupFile[]>();
  for (const file of files) {
    if (file.classification !== "automatic" || !file.streamKey) continue;
    const group = byStream.get(file.streamKey) ?? [];
    group.push(file);
    byStream.set(file.streamKey, group);
  }
  if (policy.enabled || input.forcePolicy) {
    for (const group of byStream.values()) applyPolicyToGroup(group, policy, now, immutablePaths);
  } else {
    for (const file of files) {
      if (file.classification === "automatic") file.reason = "disabled";
    }
  }

  if (input.includeLegacyOnce && (policy.enabled || input.forcePolicy)) {
    const legacy = files.filter(
      (file) => file.classification === "legacy" && hasReliableRemoteMetadata(file) && !immutablePaths.has(file.path),
    );
    applyPolicyToGroup(legacy, policy, now, immutablePaths);
  }

  const candidates = files.filter((file) => file.disposition === "candidate").sort(compareNewest);
  const candidateTimes = candidates
    .map((file) => file.identity?.createdAt ?? parseLegacyBackupTime(file.filename))
    .filter((value): value is number => value !== undefined);
  const canonicalInventory = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.path}\u001f${file.filename}\u001f${file.time}\u001f${file.size}\u001f${file.disposition}`)
    .join("\u001e");
  const policyToken = JSON.stringify(policy);
  return {
    token: stableToken(
      `${normalizeUuid(input.namespaceId)}\u001d${policyToken}\u001d${Boolean(input.includeLegacyOnce)}\u001d${canonicalInventory}`,
    ),
    namespaceId: input.namespaceId,
    generatedAt: now,
    includeLegacyOnce: input.includeLegacyOnce === true,
    files,
    candidatePaths: candidates.map((file) => file.path),
    keepCount: files.filter((file) => file.disposition === "keep").length,
    protectedCount: files.filter((file) => file.disposition === "protected").length,
    candidateCount: candidates.length,
    candidateBytes: candidates.reduce((total, file) => total + (typeof file.size === "number" ? file.size : 0), 0),
    unknownCandidateSizeCount: candidates.filter((file) => file.size === "N/A").length,
    oldestCandidateAt: candidateTimes.length ? Math.min(...candidateTimes) : undefined,
    newestCandidateAt: candidateTimes.length ? Math.max(...candidateTimes) : undefined,
  };
}

export function sameRemoteFile(a: IRemoteBackupFile, b: IRemoteBackupFile): boolean {
  return a.path === b.path && a.filename === b.filename && a.time === b.time && a.size === b.size;
}

/**
 * Run a cleanup journal one file at a time. A concurrency of one is an
 * intentionally bounded choice for remote backup deletion. Every file is
 * re-listed before deletion and deletion is verified by a second listing.
 * Failed items remain pending so a durable caller can safely retry them.
 */
export async function executeBackupCleanupItems(input: {
  items: IBackupCleanupWorkItem[];
  list: () => Promise<IRemoteBackupFile[]>;
  remove: (path: string) => Promise<boolean>;
  validate: (
    item: IBackupCleanupWorkItem,
    current: IRemoteBackupFile,
    files: IRemoteBackupFile[],
  ) => Promise<true | string> | true | string;
  persist: (item: IBackupCleanupWorkItem, result: IBackupCleanupFileResult) => Promise<void> | void;
  sanitizeError?: (error: unknown) => string;
}): Promise<IBackupCleanupFileResult[]> {
  const results: IBackupCleanupFileResult[] = [];
  const sanitize = input.sanitizeError ?? ((error) => (error instanceof Error ? error.message : String(error)));
  for (const item of input.items) {
    if (item.status !== "pending") continue;
    item.attempts += 1;
    let result: IBackupCleanupFileResult;
    try {
      const files = await input.list();
      const current = files.find((file) => file.path === item.path);
      if (!current) {
        item.status = "missing";
        delete item.error;
        result = { path: item.path, status: "missing" };
      } else {
        const validation = await input.validate(item, current, files);
        if (validation !== true) {
          item.status = "skipped";
          item.error = validation;
          result = { path: item.path, status: "skipped", error: validation };
        } else {
          const removed = await input.remove(item.path);
          if (!removed) throw new Error("Backup server returned a failure result while deleting a file.");
          const verified = await input.list();
          if (verified.some((file) => file.path === item.path)) {
            throw new Error("The deleted file is still present in the verified remote listing.");
          }
          item.status = "deleted";
          delete item.error;
          result = { path: item.path, status: "deleted" };
        }
      }
    } catch (error) {
      item.error = sanitize(error);
      result = { path: item.path, status: "failed", error: item.error };
    }
    results.push(result);
    await input.persist(item, result);
  }
  return results;
}
