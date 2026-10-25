import type { IAiAssistantConfig } from "./types/storages/config.ts";

export type { IAiAssistantConfig } from "./types/storages/config.ts";

export interface IAiAssistRequest {
  mode: "assist" | "test";
  prompt?: string;
  context?: {
    searchKey?: string;
    torrentTitles?: string[];
  };
}

export interface IAiAssistResponse {
  text: string;
  model?: string;
}

const CHAT_COMPLETIONS_SUFFIX = "/chat/completions";

export function normalizeAiEndpoint(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("AI endpoint 不能为空");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AI endpoint 不是有效的 URL");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new Error("AI endpoint 只允许 HTTP 或 HTTPS");
  }
  if (url.username || url.password) throw new Error("AI endpoint 不允许内嵌用户名或密码");
  for (const key of url.searchParams.keys()) {
    if (/^(api[_-]?key|token|password|secret)$/i.test(key)) {
      throw new Error("AI endpoint 不允许在查询参数中携带凭据");
    }
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith(CHAT_COMPLETIONS_SUFFIX)) {
    url.pathname = path.endsWith("/v1") ? `${path}${CHAT_COMPLETIONS_SUFFIX}` : `${path}/v1${CHAT_COMPLETIONS_SUFFIX}`;
  }
  return url.toString();
}

export function normalizeAiTimeout(value: unknown): number {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) return 30_000;
  return Math.min(60_000, Math.max(1_000, Math.round(timeout)));
}

export function sanitizeAiContext(context?: IAiAssistRequest["context"]): IAiAssistRequest["context"] | undefined {
  if (!context) return undefined;
  const searchKey = typeof context.searchKey === "string" ? context.searchKey.trim().slice(0, 240) : "";
  const torrentTitles = Array.isArray(context.torrentTitles)
    ? context.torrentTitles
        .filter((title): title is string => typeof title === "string")
        .map((title) => title.trim().slice(0, 180))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  if (!searchKey && torrentTitles.length === 0) return undefined;
  return {
    ...(searchKey ? { searchKey } : {}),
    ...(torrentTitles.length > 0 ? { torrentTitles } : {}),
  };
}

export function extractAiText(payload: unknown): IAiAssistResponse {
  if (!payload || typeof payload !== "object") throw new Error("AI 响应不是有效 JSON");
  const data = payload as { choices?: unknown; model?: unknown };
  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  const message = choice && typeof choice === "object" ? (choice as { message?: unknown }).message : undefined;
  const content = message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;
  const text = Array.isArray(content)
    ? content
        .flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const value = (part as { text?: unknown }).text;
          return typeof value === "string" ? [value] : [];
        })
        .join("")
    : typeof content === "string"
      ? content
      : "";
  if (!text.trim()) throw new Error("AI 响应没有可显示的内容");
  return {
    text: text.trim().slice(0, 12_000),
    model: typeof data.model === "string" ? data.model : undefined,
  };
}

export function buildAiUserMessage(prompt: string, context?: IAiAssistRequest["context"]): string {
  const normalizedPrompt = prompt.trim().slice(0, 4_000);
  if (!normalizedPrompt) throw new Error("请输入想让 AI 帮助处理的内容");
  const safeContext = sanitizeAiContext(context);
  return safeContext
    ? `${normalizedPrompt}\n\n仅将以下用户主动选择的搜索上下文作为参考，不要尝试访问或推断其他数据：\n${JSON.stringify(safeContext)}`
    : normalizedPrompt;
}
