// Import the datetime utility directly.  The @ptd/site barrel also initializes
// Vite's dynamic site-definition registry, which is unavailable in Node-based
// projection tests and is unnecessary at this export boundary.
import { convertIsoDurationToDate, type isoDuration } from "@ptd/site/utils/datetime.ts";

/** Export boundary only: preserve useful values; never summarize business data here. */
export function redactMcpText(value: string, maxLength: number): string {
  return value
    .replace(/\b(?:cookie|set-cookie|authorization)\s*[:=][^\r\n]*/gi, "[credential omitted]")
    .replace(/https?:\/\/[^\s<>"'\)]+/gi, "[URL omitted]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_\-.]+/gi, "[credential omitted]")
    .replace(
      /\b(cookie|authorization|passkey|password|secret|token|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[redacted]",
    )
    .trim()
    .slice(0, maxLength);
}

const LEVEL_FIELDS = new Set([
  "levelName",
  "interval",
  "totalTraffic",
  "uploaded",
  "downloaded",
  "trueUploaded",
  "trueDownloaded",
  "ratio",
  "trueRatio",
  "seeding",
  "seedingSize",
  "specialSeedingSize",
  "seedingTime",
  "averageSeedingTime",
  "bonus",
  "bonusPerHour",
  "seedingBonus",
  "seedingBonusPerHour",
  "uploads",
  "leeching",
  "snatches",
  "posts",
  "perfectFlacs",
  "groups",
  "hnrUnsatisfied",
  "bonusNeededInterval",
  "seedingBonusNeededInterval",
  "uploadedNeeded",
  "downloadedNeeded",
  "registrationStatus",
  "intervalRequirement",
  "intervalRemaining",
  "expectedAt",
  "remainingDays",
]);

const isoDurationPattern = /^P(?:(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:(?:\d+H)?(?:\d+M)?(?:\d+S)?))?)$/;

function validIsoDuration(value: unknown): value is isoDuration {
  if (typeof value !== "string" || !isoDurationPattern.test(value)) return false;
  // Bare P/PT values are not useful durations and are commonly produced by a
  // parser when no date/time unit remains.  The date helper treats either as
  // a no-op, so do not expose the join date as a false expectedAt.
  return value !== "P" && value !== "PT";
}

export function normalizeJoinTime(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  // Stored user info uses milliseconds. Accept a Unix-seconds value as a
  // compatibility fallback for imported legacy records.
  const timestamp = value < 100_000_000_000 ? value * 1000 : value;
  return Number.isFinite(new Date(timestamp).getTime()) ? timestamp : undefined;
}

/**
 * Preserve registration-time requirements in the AI/MCP projection.
 *
 * `getNextLevelUnMet` reports the remaining interval, while the level
 * definition carries the original requirement (for example P80W). Keeping
 * both lets a consumer explain a missing registration date without guessing.
 */
export function projectRegistrationProgress(
  interval: unknown,
  joinTime: unknown,
  remaining?: unknown,
): Record<string, string | number> {
  if (!validIsoDuration(interval)) return { registrationStatus: "not_required" };

  const intervalRemaining = validIsoDuration(remaining) ? remaining : undefined;
  const base: Record<string, string | number> = {
    registrationStatus: "unavailable",
    intervalRequirement: interval,
  };
  const normalizedJoinTime = normalizeJoinTime(joinTime);
  if (normalizedJoinTime === undefined) return base;

  const expectedAt = convertIsoDurationToDate(interval, normalizedJoinTime);
  if (!Number.isFinite(expectedAt)) return base;
  return {
    ...base,
    expectedAt,
    ...(intervalRemaining ? { intervalRemaining } : {}),
    remainingDays: Math.max(0, Math.ceil((expectedAt - Date.now()) / 86_400_000)),
    registrationStatus: expectedAt > Date.now() ? "incomplete" : "met",
  };
}

export function projectLevelStats(value: unknown): Record<string, string | number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!LEVEL_FIELDS.has(key)) continue;
    if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
    else if (typeof item === "string" && item.trim()) result[key] = redactMcpText(item, 120);
  }
  return Object.keys(result).length ? result : undefined;
}
