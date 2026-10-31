import type { IMcpCapabilityDescriptor, TMcpCapabilityName, IMcpToolRequest } from "@/shared/mcpBridge.ts";
import type { IMcpBusinessRegistry, TMcpMessage } from "./mcpBusinessCapabilities.ts";
import { McpConfirmationStore } from "./mcpConfirmation.ts";

type JsonObject = Record<string, unknown>;

interface Options {
  confirmationStore: McpConfirmationStore;
}

const snapshotInputSchema = {
  type: "object",
  properties: {
    snapshotId: { type: "string", minLength: 1, maxLength: 200 },
  },
  required: ["snapshotId"],
  additionalProperties: false,
};

const downloaderTorrentInputSchema = {
  type: "object",
  properties: {
    downloaderId: { type: "string", minLength: 1, maxLength: 160 },
    torrentId: { type: "string", minLength: 1, maxLength: 200 },
  },
  required: ["downloaderId", "torrentId"],
  additionalProperties: false,
};

/**
 * Confirmation-protected actions that operate on local PTPP state.
 *
 * Actions deliberately live in a separate registry from read projections so
 * the standard MCP adapter can route them through `ptpp_action` and clients
 * can clearly distinguish a state change from a query.  The extension owns
 * the one-time token; the adapter never creates or guesses one.
 */
export function createMcpActionCapabilities(sendMessage: TMcpMessage, options: Options): IMcpBusinessRegistry {
  const actionDefinitions = [
    {
      id: "ptpp.snapshots.delete" as TMcpCapabilityName,
      description: "删除一个本地搜索快照；必须在 PTPP 中明确确认后执行。",
      inputSchema: snapshotInputSchema,
    },
    {
      id: "ptpp.downloaders.pause" as TMcpCapabilityName,
      description: "暂停下载器中的一个任务；必须在 PTPP 中明确确认后执行。",
      inputSchema: downloaderTorrentInputSchema,
    },
    {
      id: "ptpp.downloaders.resume" as TMcpCapabilityName,
      description: "继续下载器中的一个任务；必须在 PTPP 中明确确认后执行。",
      inputSchema: downloaderTorrentInputSchema,
    },
  ] as const;
  const descriptors: IMcpCapabilityDescriptor[] = actionDefinitions.map(({ id, description, inputSchema }) => ({
    id,
    version: 1 as const,
    kind: "action" as const,
    sensitivity: "private" as const,
    description,
    confirmation: "required" as const,
    inputSchema,
    outputSchema: { type: "object" },
    maxResultBytes: 16_384,
  }));

  const handlers = new Map<TMcpCapabilityName, (input: unknown, request?: IMcpToolRequest) => Promise<unknown>>();
  const snapshotDeleteId = "ptpp.snapshots.delete" as TMcpCapabilityName;
  handlers.set(snapshotDeleteId, async (input, request) => {
    const value = input && typeof input === "object" ? input as JsonObject : {};
    const snapshotId = typeof value.snapshotId === "string" ? value.snapshotId.trim().slice(0, 200) : "";
    if (!snapshotId) throw new Error("snapshotId is required");

    const storage = await sendMessage("getExtStorage", "searchResultSnapshot") as Record<string, unknown> | undefined;
    if (!storage || !Object.prototype.hasOwnProperty.call(storage, snapshotId)) {
      return { status: "not_found", snapshotId };
    }

    const token = typeof request?.confirmationToken === "string" ? request.confirmationToken : "";
    const approved = token ? options.confirmationStore.consume(token, snapshotDeleteId, { snapshotId }) : undefined;
    if (!approved) {
      const pending = options.confirmationStore.create(
        snapshotDeleteId,
        { snapshotId },
        "删除搜索快照",
        [{ path: "snapshotId", before: snapshotId, after: "删除" }],
      );
      return {
        status: "confirmation_required",
        confirmationId: pending.confirmationId,
        expiresAt: pending.expiresAt,
        summary: pending.summary,
        requiresConfirmation: true,
      };
    }

    await sendMessage("removeSearchResultSnapshotData", snapshotId);
    return { status: "deleted", snapshotId };
  });

  for (const action of ["pause", "resume"] as const) {
    const id = `ptpp.downloaders.${action}` as TMcpCapabilityName;
    handlers.set(id, async (input, request) => {
      const value = input && typeof input === "object" ? input as JsonObject : {};
      const downloaderId = typeof value.downloaderId === "string" ? value.downloaderId.trim().slice(0, 160) : "";
      const torrentId = typeof value.torrentId === "string" ? value.torrentId.trim().slice(0, 200) : "";
      if (!downloaderId) throw new Error("downloaderId is required");
      if (!torrentId) throw new Error("torrentId is required");

      const list = await sendMessage("getClientTorrents", downloaderId) as { data?: unknown } | undefined;
      const torrents = Array.isArray(list?.data) ? list.data : [];
      const exists = torrents.some((torrent) => {
        if (!torrent || typeof torrent !== "object") return false;
        const candidate = (torrent as JsonObject).id ?? (torrent as JsonObject).hash;
        return candidate !== undefined && String(candidate) === torrentId;
      });
      if (!exists) return { status: "not_found", downloaderId, torrentId };

      const operationInput = { downloaderId, torrentId };
      const token = typeof request?.confirmationToken === "string" ? request.confirmationToken : "";
      const approved = token ? options.confirmationStore.consume(token, id, operationInput) : undefined;
      if (!approved) {
        const pending = options.confirmationStore.create(
          id,
          operationInput,
          action === "pause" ? "暂停下载器任务" : "继续下载器任务",
          [
            { path: "downloaderId", before: downloaderId, after: downloaderId },
            { path: "torrentId", before: torrentId, after: action === "pause" ? "暂停" : "继续" },
          ],
        );
        return {
          status: "confirmation_required",
          confirmationId: pending.confirmationId,
          expiresAt: pending.expiresAt,
          summary: pending.summary,
          requiresConfirmation: true,
        };
      }

      const message = action === "pause" ? "pauseClientTorrent" : "resumeClientTorrent";
      const result = await sendMessage(message, { downloaderId, id: torrentId });
      return { status: "executed", action, downloaderId, torrentId, result: result === true ? "ok" : result };
    });
  }

  return { descriptors, handlers };
}
