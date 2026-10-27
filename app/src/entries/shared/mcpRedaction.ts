/** Export boundary only: preserve useful values; never summarize business data here. */
export function redactMcpText(value: string, maxLength: number): string {
  return value
    .replace(/\b(?:cookie|set-cookie|authorization)\s*[:=][^\r\n]*/gi, "[credential omitted]")
    .replace(/https?:\/\/[^\s<>"'\)]+/gi, "[URL omitted]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_\-.]+/gi, "[credential omitted]")
    .replace(/\b(cookie|authorization|passkey|password|secret|token|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[redacted]")
    .trim()
    .slice(0, maxLength);
}

const LEVEL_FIELDS = new Set([
  "levelName", "interval", "totalTraffic", "uploaded", "downloaded", "trueUploaded", "trueDownloaded",
  "ratio", "trueRatio", "seeding", "seedingSize", "specialSeedingSize", "seedingTime", "averageSeedingTime",
  "bonus", "bonusPerHour", "seedingBonus", "seedingBonusPerHour", "uploads", "leeching", "snatches", "posts",
  "perfectFlacs", "groups", "hnrUnsatisfied", "bonusNeededInterval", "seedingBonusNeededInterval",
  "uploadedNeeded", "downloadedNeeded",
]);

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
