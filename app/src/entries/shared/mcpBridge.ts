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
