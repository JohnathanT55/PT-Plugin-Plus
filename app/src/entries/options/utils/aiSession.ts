import { getCurrentScope, onScopeDispose, ref, watch } from "vue";

export const AI_SESSION_KEY = "ptpp-ai-assistant-session";
export const AI_SESSION_TTL_MS = 30 * 60 * 1000;
export const AI_SESSION_MAX_MESSAGES = 40;
export const AI_SESSION_MAX_PROMPT = 4000;
export const AI_SESSION_MAX_MESSAGE = 12000;

export interface AiSessionMessage {
  role: "user" | "assistant";
  content: string;
}

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface SessionOptions {
  storage?: SessionStorage | null;
  legacyStorage?: Pick<Storage, "removeItem"> | null;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
}

function browserStorage(key: "sessionStorage" | "localStorage"): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window[key];
  } catch {
    return undefined;
  }
}

function normalizeMessages(value: unknown): AiSessionMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is AiSessionMessage =>
        !!item &&
        typeof item === "object" &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string",
    )
    .slice(-AI_SESSION_MAX_MESSAGES)
    .map(({ role, content }) => ({ role, content: content.slice(0, AI_SESSION_MAX_MESSAGE) }));
}

/** Tab-local, idle-expiring conversation state; no extension backup storage is used. */
export function useAiSession(options: SessionOptions = {}) {
  const storage = options.storage === undefined ? browserStorage("sessionStorage") : options.storage;
  const legacyStorage = options.legacyStorage === undefined ? browserStorage("localStorage") : options.legacyStorage;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const prompt = ref("");
  const messages = ref<AiSessionMessage[]>([]);
  const revision = ref(0);
  let updatedAt: number | undefined;
  let timer: unknown;
  let updating = false;
  let disposed = false;

  function removeStored() {
    try {
      storage?.removeItem(AI_SESSION_KEY);
    } catch {
      // Blocked storage must never prevent the in-memory assistant from working.
    }
  }

  // Remove only this feature's pre-release localStorage key; no other storage is touched.
  try {
    legacyStorage?.removeItem(AI_SESSION_KEY);
  } catch {
    // Storage may be unavailable even when reading the property succeeded.
  }

  function cancelExpiry() {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  }

  function clear() {
    updating = true;
    revision.value += 1;
    prompt.value = "";
    messages.value = [];
    updatedAt = undefined;
    updating = false;
    cancelExpiry();
    removeStored();
  }

  function expireIfNeeded(): boolean {
    if (updatedAt !== undefined && (now() - updatedAt >= AI_SESSION_TTL_MS || now() < updatedAt)) {
      clear();
      return true;
    }
    return false;
  }

  function scheduleExpiry() {
    cancelExpiry();
    if (disposed || updatedAt === undefined) return;
    timer = schedule(
      () => {
        timer = undefined;
        if (!expireIfNeeded()) scheduleExpiry();
      },
      Math.max(1, updatedAt + AI_SESSION_TTL_MS - now()),
    );
  }

  try {
    const raw = storage?.getItem(AI_SESSION_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (
        !saved ||
        saved.version !== 1 ||
        typeof saved.updatedAt !== "number" ||
        !Number.isFinite(saved.updatedAt) ||
        saved.updatedAt > now() ||
        now() - saved.updatedAt >= AI_SESSION_TTL_MS
      ) {
        removeStored();
      } else {
        updatedAt = saved.updatedAt;
        prompt.value = typeof saved.prompt === "string" ? saved.prompt.slice(0, AI_SESSION_MAX_PROMPT) : "";
        messages.value = normalizeMessages(saved.messages);
        scheduleExpiry();
      }
    }
  } catch {
    removeStored();
  }

  const stop = watch(
    [prompt, messages],
    () => {
      if (updating || disposed) return;
      updating = true;
      // A throttled timer may not have fired yet. New typing starts a new session,
      // preserving the newly entered draft but not reviving the old conversation.
      if (updatedAt !== undefined && (now() - updatedAt >= AI_SESSION_TTL_MS || now() < updatedAt)) {
        revision.value += 1;
        messages.value = [];
      }
      prompt.value = prompt.value.slice(0, AI_SESSION_MAX_PROMPT);
      messages.value = normalizeMessages(messages.value);
      updating = false;
      if (!prompt.value && !messages.value.length) {
        updatedAt = undefined;
        cancelExpiry();
        removeStored();
        return;
      }
      updatedAt = now();
      try {
        storage?.setItem(
          AI_SESSION_KEY,
          JSON.stringify({ version: 1, updatedAt, prompt: prompt.value, messages: messages.value }),
        );
      } catch {
        // An unavailable or full storage only disables reload persistence.
      }
      scheduleExpiry();
    },
    { deep: true, flush: "sync" },
  );

  function beginTurn(): number {
    expireIfNeeded();
    // Sending is user activity even if the draft was typed much earlier.
    if (prompt.value || messages.value.length) {
      updatedAt = now();
      try {
        storage?.setItem(
          AI_SESSION_KEY,
          JSON.stringify({ version: 1, updatedAt, prompt: prompt.value, messages: messages.value }),
        );
      } catch {
        // Keep the in-memory idle deadline when storage is unavailable.
      }
      scheduleExpiry();
    }
    return revision.value;
  }

  function completeTurn(token: number, userPrompt: string, reply: string): boolean {
    expireIfNeeded();
    if (disposed || token !== revision.value) return false;
    messages.value = [...messages.value, { role: "user", content: userPrompt }, { role: "assistant", content: reply }];
    // Keep text entered while a request was running; clear only the sent draft.
    if (prompt.value.trim() === userPrompt.trim()) prompt.value = "";
    return true;
  }

  function dispose() {
    disposed = true;
    cancelExpiry();
    stop();
  }
  if (getCurrentScope()) onScopeDispose(dispose);
  return { prompt, messages, revision, clear, expireIfNeeded, beginTurn, completeTurn, dispose };
}
