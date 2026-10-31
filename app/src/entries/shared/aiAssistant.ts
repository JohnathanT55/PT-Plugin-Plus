import type { IAiAssistantConfig } from "./types/storages/config.ts";
import { projectLevelStats, redactMcpText } from "./mcpRedaction.ts";

/** Legacy config type kept only for old backup parsing; runtime AI config now lives in MCP. */
export type { IAiAssistantConfig } from "./types/storages/config.ts";

export type TAiAssistMode = "assist" | "test" | "search-draft" | "result-advice" | "site-summary";

export interface IAiTorrentContext {
  site?: string;
  title?: string;
  subTitle?: string;
  category?: string | number;
  size?: number;
  seeders?: number;
  leechers?: number;
  completed?: number;
  comments?: number;
  tags?: string[];
}

export interface IAiSiteSummaryContext {
  site?: string;
  level?: string;
  /** Join date is a timestamp-derived ISO string, never a username or URL. */
  joinedAt?: string;
  joinedAtStatus?: "available" | "unavailable";
  ratio?: number;
  uploaded?: number;
  downloaded?: number;
  seeding?: number;
  seedingSize?: number;
  bonus?: number;
  hnr?: number;
  updatedAt?: string;
  nextLevel?: Record<string, string | number>;
}

export interface IAiFailureContext {
  site?: string;
  stage?: string;
  status?: string;
  message?: string;
}

export interface IAiAssistRequest {
  mode: TAiAssistMode;
  prompt?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  context?: {
    searchKey?: string;
    torrentTitles?: string[];
    torrentResults?: IAiTorrentContext[];
    siteSummary?: IAiSiteSummaryContext[];
    failures?: IAiFailureContext[];
  };
}

export interface IAiAssistResponse {
  text: string;
  model?: string;
  /** Human approval requests returned out-of-band from the model/tool history. */
  pendingConfirmations?: Array<{
    confirmationId: string;
    capability: string;
    input: Record<string, unknown>;
    summary: string;
    diff: unknown;
    expiresAt?: number;
  }>;
}

export function sanitizeAiHistory(history?: IAiAssistRequest["history"]): NonNullable<IAiAssistRequest["history"]> {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 4_000) }))
    .filter((item) => item.content)
    .slice(-8);
}

function clampString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = redactMcpText(value, maxLength);
  return normalized || undefined;
}

function clampNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function sanitizeTorrentResult(item: IAiTorrentContext): IAiTorrentContext | undefined {
  if (!item || typeof item !== "object") return undefined;
  const title = clampString(item.title, 180);
  if (!title) return undefined;
  const tags = Array.isArray(item.tags)
    ? item.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => redactMcpText(tag, 60)).filter(Boolean).slice(0, 12)
    : undefined;
  return {
    ...(clampString(item.site, 80) ? { site: clampString(item.site, 80) } : {}),
    title,
    ...(clampString(item.subTitle, 180) ? { subTitle: clampString(item.subTitle, 180) } : {}),
    ...(clampString(item.category, 80) ? { category: clampString(item.category, 80) } : {}),
    ...(clampNumber(item.size) !== undefined ? { size: clampNumber(item.size) } : {}),
    ...(clampNumber(item.seeders) !== undefined ? { seeders: clampNumber(item.seeders) } : {}),
    ...(clampNumber(item.leechers) !== undefined ? { leechers: clampNumber(item.leechers) } : {}),
    ...(clampNumber(item.completed) !== undefined ? { completed: clampNumber(item.completed) } : {}),
    ...(clampNumber(item.comments) !== undefined ? { comments: clampNumber(item.comments) } : {}),
    ...(tags?.length ? { tags } : {}),
  };
}

function sanitizeSiteSummary(item: IAiSiteSummaryContext): IAiSiteSummaryContext | undefined {
  if (!item || typeof item !== "object") return undefined;
  const site = clampString(item.site, 80);
  if (!site) return undefined;
  const nextLevel = projectLevelStats(item.nextLevel);
  const joinedAt = clampString(item.joinedAt, 48);
  const joinedAtStatus = item.joinedAtStatus === "available" || item.joinedAtStatus === "unavailable" ? item.joinedAtStatus : undefined;
  return {
    site,
    ...(clampString(item.level, 80) ? { level: clampString(item.level, 80) } : {}),
    ...(joinedAt ? { joinedAt } : {}),
    ...(joinedAtStatus ? { joinedAtStatus } : {}),
    ...(clampNumber(item.ratio) !== undefined ? { ratio: clampNumber(item.ratio) } : {}),
    ...(clampNumber(item.uploaded) !== undefined ? { uploaded: clampNumber(item.uploaded) } : {}),
    ...(clampNumber(item.downloaded) !== undefined ? { downloaded: clampNumber(item.downloaded) } : {}),
    ...(clampNumber(item.seeding) !== undefined ? { seeding: clampNumber(item.seeding) } : {}),
    ...(clampNumber(item.seedingSize) !== undefined ? { seedingSize: clampNumber(item.seedingSize) } : {}),
    ...(clampNumber(item.bonus) !== undefined ? { bonus: clampNumber(item.bonus) } : {}),
    ...(clampNumber(item.hnr) !== undefined ? { hnr: clampNumber(item.hnr) } : {}),
    ...(clampString(item.updatedAt, 48) ? { updatedAt: clampString(item.updatedAt, 48) } : {}),
    ...(nextLevel && Object.keys(nextLevel).length ? { nextLevel } : {}),
  };
}

function sanitizeFailure(item: IAiFailureContext): IAiFailureContext | undefined {
  if (!item || typeof item !== "object") return undefined;
  const message = clampString(item.message, 240);
  const site = clampString(item.site, 80);
  const stage = clampString(item.stage, 60);
  const status = clampString(item.status, 80);
  if (!message && !status) return undefined;
  return { ...(site ? { site } : {}), ...(stage ? { stage } : {}), ...(status ? { status } : {}), ...(message ? { message } : {}) };
}

export function sanitizeAiContext(context?: IAiAssistRequest["context"]): IAiAssistRequest["context"] | undefined {
  if (!context) return undefined;
  const searchKey = typeof context.searchKey === "string" ? redactMcpText(context.searchKey, 240) : "";
  const torrentTitles = Array.isArray(context.torrentTitles) ? context.torrentTitles.filter((value): value is string => typeof value === "string").map((value) => redactMcpText(value, 180)).filter(Boolean).slice(0, 20) : [];
  const torrentResults = Array.isArray(context.torrentResults) ? context.torrentResults.map(sanitizeTorrentResult).filter((item): item is IAiTorrentContext => Boolean(item)).slice(0, 30) : [];
  const siteSummary = Array.isArray(context.siteSummary) ? context.siteSummary.map(sanitizeSiteSummary).filter((item): item is IAiSiteSummaryContext => Boolean(item)).slice(0, 20) : [];
  const failures = Array.isArray(context.failures) ? context.failures.map(sanitizeFailure).filter((item): item is IAiFailureContext => Boolean(item)).slice(0, 30) : [];
  const sanitized = {
    ...(searchKey ? { searchKey } : {}),
    ...(torrentTitles.length ? { torrentTitles } : {}),
    ...(torrentResults.length ? { torrentResults } : {}),
    ...(siteSummary.length ? { siteSummary } : {}),
    ...(failures.length ? { failures } : {}),
  };
  if (!Object.keys(sanitized).length) return undefined;
  if (JSON.stringify(sanitized).length <= 32_000) return sanitized;
  return {
    ...(searchKey ? { searchKey } : {}),
    ...(torrentTitles.length ? { torrentTitles: torrentTitles.slice(0, 8) } : {}),
    ...(torrentResults.length ? { torrentResults: torrentResults.slice(0, 12) } : {}),
    ...(siteSummary.length ? { siteSummary: siteSummary.slice(0, 8) } : {}),
    ...(failures.length ? { failures: failures.slice(0, 12) } : {}),
  };
}
