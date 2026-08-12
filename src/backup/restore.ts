function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

/**
 * Merge restored records without destroying data that already exists locally.
 * Existing values win at every nested key; missing records are filled from the backup.
 */
export function mergeRestoredRecords<T extends Record<string, unknown>>(
  backup: T,
  existing: T,
  keepExisting: boolean,
): T {
  if (!keepExisting) return cloneValue(backup);

  const merge = (backupValue: unknown, existingValue: unknown): unknown => {
    if (isPlainRecord(backupValue) && isPlainRecord(existingValue)) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(backupValue), ...Object.keys(existingValue)])) {
        if (key in existingValue) {
          result[key] =
            key in backupValue ? merge(backupValue[key], existingValue[key]) : cloneValue(existingValue[key]);
        } else {
          result[key] = cloneValue(backupValue[key]);
        }
      }
      return result;
    }
    return cloneValue(existingValue);
  };

  return merge(backup, existing) as T;
}

/** Extend a persistent cookie from the later of its current expiry and now. */
export function extendCookieExpiration(
  expirationDate: number | undefined,
  expandMinutes: number,
  nowSeconds: number = Date.now() / 1000,
): number | undefined {
  if (!Number.isFinite(expandMinutes) || expandMinutes <= 0) return expirationDate;
  const currentExpiry = Number.isFinite(expirationDate) ? expirationDate! : nowSeconds;
  return Math.max(currentExpiry, nowSeconds) + expandMinutes * 60;
}

export function prependLimitedHistory<T>(history: readonly T[] | undefined, item: T, limit: number = 30): T[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 30;
  return [item, ...(history ?? [])].slice(0, safeLimit);
}

export function latestRecordsFromHistory<T>(history: Record<string, Record<string, T>>): Record<string, T> {
  const latest: Record<string, T> = {};
  for (const [siteId, siteHistory] of Object.entries(history)) {
    const latestKey = Object.keys(siteHistory).sort().at(-1);
    if (latestKey) latest[siteId] = cloneValue(siteHistory[latestKey]);
  }
  return latest;
}
