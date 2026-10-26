import type { ISiteSignInDefinition, TSiteSignInStatus } from "@ptd/site";

import { sanitizeDownloadErrorMessage } from "./downloadError.ts";

export interface ISiteSignInRecord {
  status: TSiteSignInStatus;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  nextRunAt?: number;
  failureCount?: number;
  error?: string;
}

export interface ISiteSignInResult extends ISiteSignInRecord {
  siteId: string;
}

export interface ISiteSignInResponse {
  status: number;
  data?: unknown;
}

const MIN_COOLDOWN_MINUTES = 360;
const MAX_COOLDOWN_MINUTES = 7 * 24 * 60;
const SENSITIVE_CONFIG_KEY = /cookie|passkey|token|password|authorization|secret|api[-_]?key/i;

function hasSensitiveConfigKey(value: Record<string, unknown> | undefined): boolean {
  return Object.keys(value ?? {}).some((key) => SENSITIVE_CONFIG_KEY.test(key));
}

export function normalizeSignInDefinition(definition?: ISiteSignInDefinition): ISiteSignInDefinition | undefined {
  if (!definition?.enabled) return undefined;
  if (!definition.path || !definition.path.startsWith("/") || definition.path.startsWith("//")) return undefined;
  if (definition.method && definition.method !== "get" && definition.method !== "post") return undefined;
  if (
    hasSensitiveConfigKey(definition.params) ||
    hasSensitiveConfigKey(definition.data) ||
    hasSensitiveConfigKey(definition.form?.extraData)
  ) {
    return undefined;
  }
  if (definition.form) {
    if (
      !definition.form.submitPath.startsWith("/") ||
      definition.form.submitPath.startsWith("//") ||
      !definition.form.hiddenFieldNames.length ||
      definition.form.hiddenFieldNames.some((name) => !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,80}$/.test(name)) ||
      (definition.form.submitSelector && definition.form.submitSelector.length > 160)
    ) {
      return undefined;
    }
  }
  const cooldownMinutes = Math.min(
    MAX_COOLDOWN_MINUTES,
    Math.max(MIN_COOLDOWN_MINUTES, Math.floor(definition.cooldownMinutes ?? 24 * 60)),
  );
  return { ...definition, method: definition.method ?? "get", cooldownMinutes };
}

function responseText(data: unknown): string {
  if (typeof data === "string") return data.slice(0, 100_000);
  if (typeof Document !== "undefined" && data instanceof Document) {
    return data.documentElement?.outerHTML?.slice(0, 100_000) ?? "";
  }
  try {
    return JSON.stringify(data).slice(0, 100_000);
  } catch {
    return "";
  }
}

const SIGN_IN_CHALLENGE_MARKERS = [
  "cf-chl-",
  "challenge-platform",
  "enable javascript and cookies to continue",
  "captcha",
  "turnstile",
];

/**
 * The generic NexusPHP fallback may receive any normal HTML page with HTTP
 * 200.  Require a visible attendance/reward phrase before treating that
 * response as a successful check-in; a status code alone is not evidence.
 */
function hasGenericSignInEvidence(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ");
  return (
    /(签到|check[ -]?in|attendance).{0,48}(成功|完成|已|奖励|获得|bonus|attended)/i.test(normalized) ||
    /(获得|奖励|bonus|points?).{0,48}(魔力|积分|point|bonus)/i.test(normalized)
  );
}

function matches(
  definition: { statusCodes?: number[]; responseTextIncludes?: string[]; responseTextExcludes?: string[] } | undefined,
  response: ISiteSignInResponse,
  text: string,
) {
  if (!definition) return false;
  const statusMatches = definition.statusCodes?.length ? definition.statusCodes.includes(response.status) : false;
  const textMatches = definition.responseTextIncludes?.length
    ? definition.responseTextIncludes.every((marker) => text.includes(marker))
    : false;
  const textExcludesMatch = definition.responseTextExcludes?.length
    ? text.length > 0 && definition.responseTextExcludes.every((marker) => !text.includes(marker))
    : true;
  return textExcludesMatch && (statusMatches || textMatches);
}

export function classifySignInResponse(
  definition: ISiteSignInDefinition,
  response: ISiteSignInResponse,
): TSiteSignInStatus {
  const text = responseText(response.data);
  const normalizedText = text.toLowerCase();
  if (SIGN_IN_CHALLENGE_MARKERS.some((marker) => normalizedText.includes(marker))) return "needsManual";
  if (matches(definition.notLoggedIn, response, text) || response.status === 401 || response.status === 403) {
    return "notLoggedIn";
  }
  if (matches(definition.alreadySigned, response, text)) return "alreadySigned";
  if (definition.source === "generic" && !hasGenericSignInEvidence(text)) return "needsManual";
  if (matches(definition.success, response, text)) return "success";
  return "failed";
}

export function canRunSiteSignIn(
  state: ISiteSignInRecord | undefined,
  options: { now?: number; cooldownMinutes: number; enabled: boolean; paused: boolean },
): boolean {
  if (!options.enabled || options.paused) return false;
  if (state?.nextRunAt && state.nextRunAt > (options.now ?? Date.now())) return false;
  return true;
}

export function updateSiteSignInState(
  previous: ISiteSignInRecord | undefined,
  status: TSiteSignInStatus,
  now: number,
  cooldownMinutes: number,
  error?: unknown,
): ISiteSignInRecord {
  const failed = status === "failed" || status === "notLoggedIn";
  return {
    status,
    lastAttemptAt: now,
    ...(status === "success" || status === "alreadySigned" ? { lastSuccessAt: now } : {}),
    nextRunAt: now + cooldownMinutes * 60_000,
    failureCount: failed ? (previous?.failureCount ?? 0) + 1 : 0,
    ...(error ? { error: sanitizeDownloadErrorMessage(error) } : {}),
  };
}

export function classifySignInError(error: unknown): { status: TSiteSignInStatus; error: string } {
  const message = sanitizeDownloadErrorMessage(error);
  const errorName =
    typeof error === "object" && error !== null && "constructor" in error
      ? String((error as { constructor?: { name?: string } }).constructor?.name ?? "")
      : "";
  if (errorName === "CFBlockedError") {
    return { status: "needsManual", error: "站点返回 Cloudflare 挑战，请先在浏览器中打开并完成验证。" };
  }
  if (/need.?login|not.?login|unauthori[sz]ed|\b401\b|\b403\b/i.test(message)) {
    return { status: "notLoggedIn", error: message };
  }
  if (/cloudflare|captcha|challenge|\b429\b/i.test(message)) {
    return { status: "needsManual", error: message };
  }
  return { status: "failed", error: message };
}
