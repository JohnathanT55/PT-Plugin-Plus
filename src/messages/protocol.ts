import { DownloadTargetResolution } from "../model/downloadTarget";

export interface RuntimeStatusRequest {
  type: "ptpp.runtime.status";
}

export interface ResolveDownloadTargetRequest {
  type: "ptpp.download-target.resolve";
  siteId?: string;
  downloaderId?: string;
}

export interface OffscreenPingRequest {
  type: "ptpp.offscreen.ping";
}

export interface OffscreenParseHtmlRequest {
  type: "ptpp.offscreen.parse-html";
  html: string;
}

export interface OffscreenClipboardWriteRequest {
  type: "ptpp.offscreen.clipboard-write";
  text: string;
}

export type BackgroundRequest =
  | RuntimeStatusRequest
  | ResolveDownloadTargetRequest;

export type OffscreenRequest =
  | OffscreenPingRequest
  | OffscreenParseHtmlRequest
  | OffscreenClipboardWriteRequest;

export type MV3Request = BackgroundRequest | OffscreenRequest;

export interface RuntimeStatusData {
  schemaVersion: number;
  migratedAt?: number;
  warningCount: number;
}

export interface OffscreenHtmlResult {
  title: string;
  text: string;
}

export type MV3ResponseData =
  | RuntimeStatusData
  | DownloadTargetResolution
  | OffscreenHtmlResult
  | { alive: true }
  | { written: true };

export interface MV3SuccessResponse<T extends MV3ResponseData> {
  ok: true;
  data: T;
}

export interface MV3ErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type MV3Response<T extends MV3ResponseData = MV3ResponseData> =
  | MV3SuccessResponse<T>
  | MV3ErrorResponse;

export function errorResponse(code: string, error: any): MV3ErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error)
    }
  };
}
