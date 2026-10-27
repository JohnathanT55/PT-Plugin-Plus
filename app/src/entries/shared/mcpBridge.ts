import type { IAiAssistRequest, IAiAssistResponse } from "./aiAssistant.ts";

export interface IMcpBridgeConfig {
  enabled: boolean;
  bridgeUrl: string;
  bridgeToken: string;
  timeoutMs: number;
}

export interface IMcpBridgeStatus {
  enabled: boolean;
  connected: boolean;
  status: "ready" | "degraded" | "disabled" | "error";
  protocol?: number;
  serverVersion?: string;
  capabilities: string[];
  lastError?: string;
}

/**
 * Capabilities are deliberately named business contracts rather than DOM
 * actions.  The registry is shared by the extension bridge and future MCP
 * tool adapters so a tool can request useful fields without receiving raw
 * storage records.
 */
export type TMcpCapabilityName = "ptpp.extension_info" | "ptpp.page_context" | "ptpp.sites.list" | "ptpp.user_data.get" | "ptpp.user_data.refresh" | "ptpp.downloaders.list" | "ptpp.downloaders.status" | "ptpp.search.start" | "ptpp.search.status" | "ptpp.search.results" | "ptpp.signin.status" | "ptpp.signin.run" | "ptpp.backups.list" | "ptpp.backups.history";

export type TMcpCapabilityKind = "query" | "action";
export type TMcpCapabilitySensitivity = "public" | "account" | "private";

export interface IMcpCapabilityDescriptor {
  id: TMcpCapabilityName;
  version: 1;
  kind: TMcpCapabilityKind;
  sensitivity: TMcpCapabilitySensitivity;
  description: string;
  confirmation: "none" | "required";
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  maxResultBytes: number;
}

export interface IMcpPageContextRequest {
  page?: "search" | "my-data";
  include?: Array<"searchKey" | "torrentTitles" | "torrentResults" | "siteSummary" | "failures">;
  maxItems?: number;
}

export interface IMcpToolRequest {
  requestId: string;
  capability: TMcpCapabilityName;
  input?: unknown;
}

export interface IMcpToolResult {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface IMcpSessionPollResponse {
  ok: true;
  request: IMcpToolRequest | null;
}

export interface IMcpSessionOpenRequest {
  protocol: 1;
  extensionId: string;
  extensionVersion: string;
  browser: string;
  capabilities: IMcpCapabilityDescriptor[];
}

export interface IMcpSessionOpenResponse {
  ok: true;
  protocol: 1;
  sessionId: string;
  expiresAt: number;
  capabilities: IMcpCapabilityDescriptor[];
}

export interface IMcpBridgeHandshakeRequest {
  protocol: 1;
  extensionId: string;
  extensionVersion: string;
  browser: string;
  requestedCapabilities: string[];
}

export interface IMcpBridgeHandshakeResponse {
  ok: true;
  protocol: 1;
  serverVersion: string;
  status: "ready" | "degraded";
  capabilities: string[];
}

export interface IMcpBridgeAssistantResponse extends IAiAssistResponse {
  ok: true;
}

export type { IAiAssistRequest, IAiAssistResponse };
