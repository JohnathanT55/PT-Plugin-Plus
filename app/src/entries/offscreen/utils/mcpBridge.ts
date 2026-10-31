import { onMessage, sendMessage } from "@/messages.ts";
import type { IConfigPiniaStorageSchema } from "@/shared/types.ts";
import {
  sanitizeAiContext,
  sanitizeAiHistory,
  type IAiAssistRequest,
  type IAiAssistResponse,
} from "@/shared/aiAssistant.ts";
import type {
  IMcpBridgeConfig,
  IMcpCapabilityDescriptor,
  IMcpBridgeHandshakeRequest,
  IMcpBridgeHandshakeResponse,
  IMcpBridgeStatus,
  IMcpPageContextRequest,
  IMcpSessionOpenRequest,
  IMcpSessionOpenResponse,
  IMcpSessionPollResponse,
  TMcpCapabilityName,
} from "@/shared/mcpBridge.ts";
import { executeBoundedCapability, McpSessionManager } from "./mcpSession.ts";
import { createMcpBusinessCapabilities } from "./mcpBusinessCapabilities.ts";
import { createMcpSearchCapabilities } from "./mcpSearchCapabilities.ts";
import { createMcpSettingsCapabilities } from "./mcpSettingsCapabilities.ts";
import { createMcpReadCapabilities } from "./mcpReadCapabilities.ts";
import { createMcpActionCapabilities } from "./mcpActionCapabilities.ts";
import { McpConfirmationStore } from "./mcpConfirmation.ts";

const PROTOCOL_VERSION = 1 as const;

// Offscreen documents expose only a subset of the Chrome runtime API in some
// MV3 builds (notably `getManifest` may be absent).  The build already embeds
// the exact extension version used by the manifest, so use that stable value
// for bridge identification instead of probing the runtime API.
const EXTENSION_VERSION = __EXT_VERSION__.replace(/^v/, "");

const PAGE_CONTEXT_FIELDS = ["searchKey", "torrentTitles", "torrentResults", "siteSummary", "failures"] as const;
type TPageContext = NonNullable<IAiAssistRequest["context"]>;
type TPageName = "search" | "my-data";

const pageContexts = new Map<TPageName, TPageContext>();

const capabilityDescriptors: IMcpCapabilityDescriptor[] = [
  {
    id: "ptpp.extension_info",
    version: 1,
    kind: "query",
    sensitivity: "public",
    description: "读取 PTPP 扩展版本、浏览器和当前已注册 capability 列表。",
    confirmation: "none",
    outputSchema: { type: "object" },
    maxResultBytes: 8_192,
  },
  {
    id: "ptpp.page_context",
    version: 1,
    kind: "query",
    sensitivity: "account",
    description: "读取用户当前搜索页或我的数据页中已主动展示的、脱敏后的上下文。",
    confirmation: "none",
    inputSchema: {
      type: "object",
      properties: {
        page: { enum: ["search", "my-data"] },
        include: { type: "array", items: { enum: PAGE_CONTEXT_FIELDS } },
        maxItems: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
    outputSchema: { type: "object" },
    maxResultBytes: 32_768,
  },
];
const mcpBusiness = createMcpBusinessCapabilities((type, data) => sendMessage(type as any, data as any));
const mcpSearch = createMcpSearchCapabilities((type, data) => sendMessage(type as any, data as any));
const confirmationStore = new McpConfirmationStore();
const mcpSettings = createMcpSettingsCapabilities((type, data) => sendMessage(type as any, data as any), { confirmationStore });
const mcpRead = createMcpReadCapabilities((type, data) => sendMessage(type as any, data as any));
const mcpActions = createMcpActionCapabilities((type, data) => sendMessage(type as any, data as any), { confirmationStore });
const replacedCapabilities = new Set(["ptpp.search.start", "ptpp.search.status", "ptpp.search.results"]);
capabilityDescriptors.push(...mcpBusiness.descriptors.filter((descriptor) => !replacedCapabilities.has(descriptor.id)));
capabilityDescriptors.push(...mcpSearch.descriptors, ...mcpSettings.descriptors);
capabilityDescriptors.push(...mcpRead.descriptors);
capabilityDescriptors.push(...mcpActions.descriptors);

const capabilityHandlers = new Map<TMcpCapabilityName, (input: unknown, request?: import("@/shared/mcpBridge.ts").IMcpToolRequest) => Promise<unknown>>();
mcpBusiness.handlers.forEach((handler, id) => capabilityHandlers.set(id, handler));
mcpSearch.handlers.forEach((handler, id) => capabilityHandlers.set(id, handler));
mcpSettings.handlers.forEach((handler, id) => capabilityHandlers.set(id, handler));
mcpRead.handlers.forEach((handler, id) => capabilityHandlers.set(id, handler));
mcpActions.handlers.forEach((handler, id) => capabilityHandlers.set(id, handler));


function parsePageContextInput(input: unknown): IMcpPageContextRequest {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const page = value.page === "my-data" || value.page === "search" ? value.page : undefined;
  const include = Array.isArray(value.include)
    ? value.include.filter(
        (item): item is (typeof PAGE_CONTEXT_FIELDS)[number] =>
          typeof item === "string" && (PAGE_CONTEXT_FIELDS as readonly string[]).includes(item),
      )
    : undefined;
  const parsedMaxItems = Number(value.maxItems);
  const maxItems = Number.isFinite(parsedMaxItems) ? Math.min(50, Math.max(1, Math.round(parsedMaxItems))) : 30;
  return { page, include: include?.length ? [...new Set(include)] : undefined, maxItems };
}

function limitPageContext(
  context: TPageContext | undefined,
  request: IMcpPageContextRequest,
): TPageContext | undefined {
  if (!context) return undefined;
  const include = new Set(request.include ?? PAGE_CONTEXT_FIELDS);
  const maxItems = request.maxItems ?? 30;
  const bounded = sanitizeAiContext(context);
  if (!bounded) return undefined;
  const result: TPageContext = {};
  if (include.has("searchKey") && bounded.searchKey) result.searchKey = bounded.searchKey;
  if (include.has("torrentTitles") && bounded.torrentTitles)
    result.torrentTitles = bounded.torrentTitles.slice(0, maxItems);
  if (include.has("torrentResults") && bounded.torrentResults)
    result.torrentResults = bounded.torrentResults.slice(0, maxItems);
  if (include.has("siteSummary") && bounded.siteSummary) result.siteSummary = bounded.siteSummary.slice(0, maxItems);
  if (include.has("failures") && bounded.failures) result.failures = bounded.failures.slice(0, maxItems);
  return Object.keys(result).length ? result : undefined;
}

function registerCapability(id: TMcpCapabilityName, handler: (input: unknown) => Promise<unknown>) {
  capabilityHandlers.set(id, handler);
}

registerCapability("ptpp.extension_info", async () => ({
  extensionId: chrome.runtime.id,
  extensionVersion: EXTENSION_VERSION,
  browser: __BROWSER__,
  capabilities: capabilityDescriptors.map((item) => item.id),
}));
registerCapability("ptpp.page_context", async (input) => {
  const request = parsePageContextInput(input);
  const page = request.page ?? "search";
  return {
    page,
    available: Boolean(pageContexts.get(page)),
    context: limitPageContext(pageContexts.get(page), request),
  };
});

function safeError(message: string): Error {
  return new Error(message);
}

function normalizeBridgeUrl(input: string): string {
  const value = input.trim();
  if (!value) throw safeError("请先配置 MCP bridge 地址");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw safeError("MCP bridge 地址不是有效的 URL");
  }
  if (!(url.protocol === "http:" || url.protocol === "https:")) {
    throw safeError("MCP bridge 只允许 HTTP 或 HTTPS");
  }
  if (
    url.username ||
    url.password ||
    [...url.searchParams.keys()].some((key) => /token|secret|password|key/i.test(key))
  ) {
    throw safeError("MCP bridge 地址不能内嵌凭据");
  }
  return url.toString().replace(/\/$/, "");
}

function timeoutMs(value: unknown): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.min(60_000, Math.max(1_000, Math.round(normalized))) : 30_000;
}

function defaultStatus(config: IConfigPiniaStorageSchema): IMcpBridgeStatus {
  return {
    enabled: config.mcp?.enabled === true,
    connected: false,
    status: config.mcp?.enabled === true ? "error" : "disabled",
    capabilities: [],
  };
}

async function getConfig(): Promise<IConfigPiniaStorageSchema> {
  return (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;
}

class BridgeHttpError extends Error {
  constructor(readonly status: number) {
    super(`MCP bridge 返回 HTTP ${status}`);
  }
}

async function requestWithConfig<T>(
  config: IMcpBridgeConfig,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const baseUrl = normalizeBridgeUrl(config.bridgeUrl);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  // An assistant turn may include several local capability calls followed by
  // another model request. Keep that turn budget separate from the short
  // connection/poll timeout; otherwise useful multi-step answers are cut off.
  const requestBudget = path === "/v1/assistant" ? 180_000 : timeoutMs(config.timeoutMs);
  const timer = setTimeout(() => controller.abort(), requestBudget);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(config.bridgeToken.trim() ? { Authorization: `Bearer ${config.bridgeToken.trim()}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => undefined)) as { ok?: boolean; error?: string } | undefined;
    // Never echo a remote error body; it may contain submitted credentials or
    // a private provider URL. A structured status is sufficient for retry.
    if (!response.ok) throw new BridgeHttpError(response.status);
    if (payload?.ok !== true) throw safeError("MCP bridge 返回了无效响应");
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw safeError("MCP bridge 请求超时");
    if (error instanceof Error && /^MCP bridge/.test(error.message)) throw error;
    throw safeError("MCP bridge 连接失败，请检查服务是否已启动");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

const sessionManager = new McpSessionManager<IMcpBridgeConfig>({
  open: async (config, signal) => {
    const result = await requestWithConfig<IMcpSessionOpenResponse>(
      config,
      "/v1/session/open",
      {
        protocol: PROTOCOL_VERSION,
        extensionId: chrome.runtime.id,
        extensionVersion: EXTENSION_VERSION,
        browser: __BROWSER__,
        capabilities: capabilityDescriptors,
      } satisfies IMcpSessionOpenRequest,
      signal,
    );
    if (
      result.protocol !== PROTOCOL_VERSION ||
      typeof result.sessionId !== "string" ||
      !result.sessionId ||
      !Array.isArray(result.capabilities)
    ) {
      throw safeError("MCP bridge 返回了无效会话");
    }
    return result;
  },
  poll: async (config, id, signal) => {
    const result = await requestWithConfig<IMcpSessionPollResponse>(
      config,
      `/v1/session/${encodeURIComponent(id)}/poll`,
      // Keep the server's long poll shorter than the configured HTTP timeout.
      { timeoutMs: Math.min(25_000, Math.max(0, timeoutMs(config.timeoutMs) - 500)) },
      signal,
    );
    return result.request;
  },
  respond: async (config, id, result, signal) => {
    await requestWithConfig(config, `/v1/session/${encodeURIComponent(id)}/response`, result, signal);
  },
  close: async (config, id) => {
    await requestWithConfig({ ...config, timeoutMs: 1_000 }, `/v1/session/${encodeURIComponent(id)}/close`, {});
  },
  execute: (request) =>
    executeBoundedCapability(
      request,
      capabilityHandlers.get(request.capability),
      capabilityDescriptors.find((item) => item.id === request.capability)?.maxResultBytes,
    ),
  isSessionGone: (error) => error instanceof BridgeHttpError && [404, 410].includes(error.status),
});

let configRevision = 0;

async function syncSessionConfig(): Promise<IMcpSessionOpenResponse | undefined> {
  const revision = ++configRevision;
  const config = await getConfig();
  // Two storage reads can complete out of order; only the newest one wins.
  if (revision !== configRevision) return undefined;
  if (!config.mcp?.enabled) return sessionManager.configure(undefined);
  try {
    const snapshot = { ...config.mcp, bridgeUrl: normalizeBridgeUrl(config.mcp.bridgeUrl) };
    return sessionManager.configure(snapshot, JSON.stringify(snapshot));
  } catch (error) {
    sessionManager.stop();
    throw error;
  }
}

async function requestBridge<T>(path: string, body: unknown): Promise<T> {
  const config = await getConfig();
  if (!config.mcp?.enabled) throw safeError("MCP bridge 未启用");
  return requestWithConfig(config.mcp, path, body);
}

function bridgeRequest(data: IAiAssistRequest): IAiAssistRequest {
  return {
    mode: data.mode,
    ...(typeof data.prompt === "string" ? { prompt: data.prompt.trim().slice(0, 4_000) } : {}),
    ...(sanitizeAiHistory(data.history).length ? { history: sanitizeAiHistory(data.history) } : {}),
    ...(data.context ? { context: sanitizeAiContext(data.context) } : {}),
  };
}

async function handshake(allowDisabled = false): Promise<IMcpBridgeStatus> {
  const config = await getConfig();
  const base = defaultStatus(config);
  if (!allowDisabled && !config.mcp?.enabled) {
    sessionManager.stop();
    return base;
  }
  try {
    const result = await requestWithConfig<IMcpBridgeHandshakeResponse>(config.mcp, "/v1/handshake", {
      protocol: PROTOCOL_VERSION,
      extensionId: chrome.runtime.id,
      extensionVersion: EXTENSION_VERSION,
      browser: __BROWSER__,
      requestedCapabilities: ["assistant.chat", "assistant.test"],
    } satisfies IMcpBridgeHandshakeRequest);
    // Testing an unchecked configuration verifies connectivity only. It must
    // not leave an active data-export session behind while MCP is disabled.
    const session = await syncSessionConfig();
    return {
      enabled: config.mcp?.enabled === true,
      connected: result.ok === true,
      status: result.status === "ready" ? "ready" : "degraded",
      protocol: result.protocol,
      serverVersion: result.serverVersion,
      capabilities: session?.capabilities?.map((item) => item.id) ?? result.capabilities ?? [],
    };
  } catch (error) {
    return { ...base, lastError: error instanceof Error ? error.message : "MCP bridge 连接失败" };
  }
}

async function requestAiAssistant(data: IAiAssistRequest): Promise<IAiAssistResponse> {
  const session = await syncSessionConfig();
  if (!session) throw safeError("MCP bridge 会话暂不可用，请检查连接后重试");
  const response = await requestBridge<{ ok: true; text: string; model?: string; pendingConfirmations?: unknown }>("/v1/assistant", {
    ...bridgeRequest(data),
    sessionId: session.sessionId,
  });
  if (!response.text?.trim()) throw safeError("MCP bridge 没有返回可显示的内容");
  const pendingConfirmations = Array.isArray(response.pendingConfirmations)
    ? response.pendingConfirmations
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .slice(0, 5)
        .map((item) => ({
          confirmationId: typeof item.confirmationId === "string" ? item.confirmationId.slice(0, 200) : "",
          capability: typeof item.capability === "string" ? item.capability.slice(0, 100) : "",
          input: item.input && typeof item.input === "object" && !Array.isArray(item.input) ? item.input as Record<string, unknown> : {},
          summary: typeof item.summary === "string" ? item.summary.slice(0, 500) : "",
          diff: item.diff,
          expiresAt: typeof item.expiresAt === "number" ? item.expiresAt : 0,
        }))
        .filter((item) => item.confirmationId && item.capability && (!item.expiresAt || item.expiresAt > Date.now()))
    : undefined;
  return { text: response.text.trim().slice(0, 12_000), model: response.model, ...(pendingConfirmations?.length ? { pendingConfirmations } : {}) };
}

onMessage("runAiAssistant", async ({ data }) => requestAiAssistant(data));
onMessage("confirmMcpAction", async ({ data }) => {
  try {
    const token = confirmationStore.approve(data.confirmationId);
    if (!token) return { ok: false, error: "确认请求已过期、已取消或不再匹配" };
    const session = await syncSessionConfig();
    if (!session) return { ok: false, error: "MCP bridge 会话暂不可用" };
    const response = await requestBridge<{ ok?: boolean; result?: unknown; error?: { message?: string } }>(
      `/v1/session/${encodeURIComponent(session.sessionId)}/request`,
      { capability: data.capability, input: data.input, confirmationToken: token },
    );
    return { ok: response.ok === true, result: response.result, ...(response.error?.message ? { error: response.error.message } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "确认操作失败" };
  }
});
onMessage("cancelMcpAction", async ({ data }) => confirmationStore.revoke(data.confirmationId));
onMessage("getMcpBridgeStatus", async () => handshake(false));
onMessage("testMcpBridge", async () => handshake(true));
onMessage("syncMcpBridgeConfig", async () => {
  await syncSessionConfig();
});
onMessage("setMcpPageContext", async ({ data }) => {
  if (data.context) {
    const sanitized = sanitizeAiContext(data.context);
    if (sanitized) pageContexts.set(data.page, sanitized);
    else pageContexts.delete(data.page);
  } else {
    pageContexts.delete(data.page);
  }
});
onMessage("consumeMcpSearchPresentation", async ({ data }) => {
  if (!mcpSearch.consumePresentation) return { status: "expired" as const };
  return await mcpSearch.consumePresentation(data);
});

// The background storage-change notification is immediate. A low-frequency
// local check also recovers when the service worker/offscreen is recreated or
// a storage notification was missed; it does not query any PT site.
void syncSessionConfig().catch(() => undefined);
setInterval(() => {
  void syncSessionConfig().catch(() => undefined);
}, 5_000);

export { sanitizeAiContext };
