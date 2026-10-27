import { onMessage, sendMessage } from "@/messages.ts";
import type { IConfigPiniaStorageSchema } from "@/shared/types.ts";
import {
  sanitizeAiContext,
  sanitizeAiHistory,
  type IAiAssistRequest,
  type IAiAssistResponse,
} from "@/shared/aiAssistant.ts";
import type {
  IMcpBridgeHandshakeRequest,
  IMcpBridgeHandshakeResponse,
  IMcpBridgeStatus,
} from "@/shared/mcpBridge.ts";

const PROTOCOL_VERSION = 1 as const;

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
  if (url.username || url.password || [...url.searchParams.keys()].some((key) => /token|secret|password|key/i.test(key))) {
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

async function requestBridge<T>(path: string, body: unknown, allowDisabled = false): Promise<T> {
  const config = await getConfig();
  if (!allowDisabled && !config.mcp?.enabled) throw safeError("MCP bridge 未启用");
  const baseUrl = normalizeBridgeUrl(config.mcp?.bridgeUrl ?? "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(config.mcp?.timeoutMs));
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(config.mcp?.bridgeToken?.trim() ? { Authorization: `Bearer ${config.mcp.bridgeToken.trim()}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => undefined)) as { ok?: boolean; error?: string } | undefined;
    if (!response.ok || payload?.ok === false) throw safeError(payload?.error || `MCP bridge 返回 HTTP ${response.status}`);
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw safeError("MCP bridge 请求超时");
    if (error instanceof Error && /^MCP bridge/.test(error.message)) throw error;
    throw safeError("MCP bridge 连接失败，请检查服务是否已启动");
  } finally {
    clearTimeout(timer);
  }
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
  if (!allowDisabled && !config.mcp?.enabled) return base;
  try {
    const result = await requestBridge<IMcpBridgeHandshakeResponse>(
      "/v1/handshake",
      {
        protocol: PROTOCOL_VERSION,
        extensionId: chrome.runtime.id,
        extensionVersion: chrome.runtime.getManifest().version,
        browser: __BROWSER__,
        requestedCapabilities: ["assistant.chat", "assistant.test"],
      } satisfies IMcpBridgeHandshakeRequest,
      true,
    );
    return {
      enabled: config.mcp?.enabled === true,
      connected: result.ok === true,
      status: result.status === "ready" ? "ready" : "degraded",
      protocol: result.protocol,
      serverVersion: result.serverVersion,
      capabilities: result.capabilities ?? [],
    };
  } catch (error) {
    return { ...base, lastError: error instanceof Error ? error.message : "MCP bridge 连接失败" };
  }
}

async function requestAiAssistant(data: IAiAssistRequest): Promise<IAiAssistResponse> {
  const response = await requestBridge<{ ok: true; text: string; model?: string }>("/v1/assistant", bridgeRequest(data));
  if (!response.text?.trim()) throw safeError("MCP bridge 没有返回可显示的内容");
  return { text: response.text.trim().slice(0, 12_000), model: response.model };
}

onMessage("runAiAssistant", async ({ data }) => requestAiAssistant(data));
onMessage("getMcpBridgeStatus", async () => handshake(false));
onMessage("testMcpBridge", async () => handshake(true));

export { sanitizeAiContext };
