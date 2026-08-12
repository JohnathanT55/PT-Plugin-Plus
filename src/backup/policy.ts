export const DEFAULT_BACKUP_RETRY_MAX = 3;
export const DEFAULT_BACKUP_RETRY_INTERVAL_MINUTES = 5;
export const CURRENT_BACKUP_FIELDS_VERSION = 1;

export interface BackupRetryPlan {
  retryIndex: number;
  runAt: number;
}

export interface NormalizedBackupFields {
  fields: string[];
  version: number;
  changed: boolean;
}

/**
 * `collection` was added after the first MV3 WebDAV configuration format.
 * Add it exactly once to pre-versioned servers. Once a server carries the
 * current version, an explicit user choice to exclude it is preserved.
 */
export function normalizeBackupFields(
  fields: readonly string[] | undefined,
  version: number | undefined,
  supportedFields: readonly string[],
): NormalizedBackupFields {
  const supported = new Set(supportedFields);
  const normalized = fields
    ? [...new Set(fields.filter((field): field is string => typeof field === "string" && supported.has(field)))]
    : [...supportedFields];
  const oldVersion = Number.isFinite(version) ? Math.max(0, Math.floor(version!)) : 0;
  if (oldVersion < CURRENT_BACKUP_FIELDS_VERSION && supported.has("collection") && !normalized.includes("collection")) {
    normalized.push("collection");
  }
  return {
    fields: normalized,
    version: CURRENT_BACKUP_FIELDS_VERSION,
    changed:
      oldVersion !== CURRENT_BACKUP_FIELDS_VERSION ||
      !fields ||
      normalized.length !== fields.length ||
      normalized.some((field, index) => field !== fields[index]),
  };
}

export function getEffectiveBackupEncryptionKey(
  enabled: boolean | undefined,
  encryptionKey: string | undefined,
): string {
  if (!enabled || !encryptionKey?.trim()) return "";
  return encryptionKey;
}

/** Keep the locally held secret out of every local and remote backup. */
export function prepareConfigForBackup<T extends { backup?: { encryptionKey?: string; [key: string]: unknown } }>(
  config: T,
): T {
  const output = JSON.parse(JSON.stringify(config)) as T;
  if (output.backup) delete output.backup.encryptionKey;
  return output;
}

export function getBackupIntervalMs(intervalHours: number | undefined): number | undefined {
  if (!Number.isFinite(intervalHours) || intervalHours === undefined || intervalHours <= 0) return undefined;
  return intervalHours * 60 * 60 * 1000;
}

export function getNextIntervalBackupAt(
  input: { intervalHours?: number; lastBackupAt?: number; nextBackupAt?: number },
  now: number,
): number | undefined {
  const intervalMs = getBackupIntervalMs(input.intervalHours);
  if (!intervalMs) return undefined;
  if (Number.isFinite(input.nextBackupAt) && input.nextBackupAt! > 0) return input.nextBackupAt;
  if (Number.isFinite(input.lastBackupAt) && input.lastBackupAt! > 0) return input.lastBackupAt! + intervalMs;
  return now;
}

export function createBackupRetryPlan(
  retryIndex: number,
  retryMax: number,
  retryIntervalMinutes: number,
  now: number,
): BackupRetryPlan | undefined {
  const normalizedRetryIndex = Math.max(0, Math.floor(retryIndex));
  const normalizedRetryMax = Math.max(0, Math.floor(retryMax));
  if (normalizedRetryIndex >= normalizedRetryMax) return undefined;
  const intervalMinutes = Number.isFinite(retryIntervalMinutes)
    ? Math.max(1, retryIntervalMinutes)
    : DEFAULT_BACKUP_RETRY_INTERVAL_MINUTES;
  return {
    retryIndex: normalizedRetryIndex + 1,
    runAt: now + intervalMinutes * 60 * 1000,
  };
}

/**
 * PTPP v1 uploads once after the whole automatic refresh has either
 * succeeded or exhausted its configured refresh retries.
 */
export function shouldUploadAfterUserRefresh(failedSiteCount: number, retryIndex: number, retryMax: number): boolean {
  return failedSiteCount === 0 || retryIndex >= Math.max(0, retryMax);
}
