import assert from "node:assert/strict";
import { createMcpActionCapabilities } from "../../app/src/entries/offscreen/utils/mcpActionCapabilities.ts";
import { McpConfirmationStore } from "../../app/src/entries/offscreen/utils/mcpConfirmation.ts";

const calls: Array<{ type: string; data: unknown }> = [];
let storage: Record<string, unknown> = { snap1: { data: [{ title: "fixture" }] } };
const torrentMessages: Array<{ type: string; data: unknown }> = [];
const sendMessage = async (type: string, data?: unknown): Promise<any> => {
  calls.push({ type, data });
  if (type === "pauseClientTorrent" || type === "resumeClientTorrent") torrentMessages.push({ type, data });
  if (type === "getExtStorage") return storage;
  if (type === "removeSearchResultSnapshotData") {
    delete storage[String(data)];
    return undefined;
  }
  throw new Error(`unexpected message: ${type}`);
};

let now = 1_000;
let sequence = 0;
const confirmations = new McpConfirmationStore({ now: () => now, ttlMs: 60_000, createToken: () => `token-${++sequence}` });
const registry = createMcpActionCapabilities(sendMessage, { confirmationStore: confirmations });
const id = "ptpp.snapshots.delete";
assert.equal(registry.descriptors[0].id, id);
assert.equal(registry.descriptors[0].kind, "action");
assert.equal(registry.descriptors[0].confirmation, "required");

const handler = registry.handlers.get(id)!;
const pending: any = await handler({ snapshotId: "snap1" }, { requestId: "r1", capability: id, input: { snapshotId: "snap1" } });
assert.equal(pending.status, "confirmation_required");
assert.ok(pending.confirmationId);
assert.equal(storage.snap1 !== undefined, true);

const approvalToken = confirmations.approve(pending.confirmationId);
assert.ok(approvalToken);
const deleted: any = await handler(
  { snapshotId: "snap1" },
  { requestId: "r2", capability: id, input: { snapshotId: "snap1" }, confirmationToken: approvalToken },
);
assert.deepEqual(deleted, { status: "deleted", snapshotId: "snap1" });
assert.equal(storage.snap1, undefined);

// Reintroduce the fixture and attempt to reuse the consumed token. The
// resource exists again, so a replay must create a fresh confirmation instead
// of deleting it silently.
storage.snap1 = { data: [{ title: "fixture" }] };
const replay: any = await handler(
  { snapshotId: "snap1" },
  { requestId: "r3", capability: id, input: { snapshotId: "snap1" }, confirmationToken: approvalToken },
);
assert.equal(replay.status, "confirmation_required");
assert.notEqual(replay.confirmationId, pending.confirmationId);
assert.equal(storage.snap1 !== undefined, true);

const notFound: any = await handler({ snapshotId: "missing" }, { requestId: "r4", capability: id, input: { snapshotId: "missing" } });
assert.deepEqual(notFound, { status: "not_found", snapshotId: "missing" });
assert.ok(calls.some((call) => call.type === "removeSearchResultSnapshotData"));

// Downloader actions must inspect the live task list before asking for
// confirmation, and the approval must be bound to the exact downloader/task.
const originalSendMessage = sendMessage;
// The test transport returns a task list for downloader `qb`; all other IDs
// are deliberately treated as unknown.
const actionSendMessage = async (type: string, data?: unknown): Promise<any> => {
  if (type === "getClientTorrents") {
    return String(data) === "qb" ? { success: true, data: [{ id: "hash-1", name: "fixture" }] } : { success: true, data: [] };
  }
  if (type === "pauseClientTorrent" || type === "resumeClientTorrent") {
    torrentMessages.push({ type, data });
    return true;
  }
  return originalSendMessage(type, data);
};
const actionRegistry = createMcpActionCapabilities(actionSendMessage, { confirmationStore: confirmations });
for (const action of ["pause", "resume"] as const) {
  const actionId = `ptpp.downloaders.${action}`;
  const actionHandler = actionRegistry.handlers.get(actionId)!;
  const beforeRequired = torrentMessages.length;
  const required: any = await actionHandler(
    { downloaderId: "qb", torrentId: "hash-1" },
    { requestId: `${action}-1`, capability: actionId as any, input: { downloaderId: "qb", torrentId: "hash-1" } },
  );
  assert.equal(required.status, "confirmation_required");
  assert.equal(torrentMessages.length, beforeRequired, "missing approval must not mutate the downloader");
  const token = confirmations.approve(required.confirmationId);
  assert.ok(token);
  const executed: any = await actionHandler(
    { downloaderId: "qb", torrentId: "hash-1" },
    { requestId: `${action}-2`, capability: actionId as any, input: { downloaderId: "qb", torrentId: "hash-1" }, confirmationToken: token },
  );
  assert.equal(executed.status, "executed");
  assert.equal(torrentMessages.at(-1)?.type, action === "pause" ? "pauseClientTorrent" : "resumeClientTorrent");
  const beforeReplay = torrentMessages.length;
  const replayAction: any = await actionHandler(
    { downloaderId: "qb", torrentId: "hash-1" },
    { requestId: `${action}-3`, capability: actionId as any, input: { downloaderId: "qb", torrentId: "hash-1" }, confirmationToken: token },
  );
  assert.equal(replayAction.status, "confirmation_required", "a consumed token cannot be replayed");
  assert.equal(torrentMessages.length, beforeReplay);
  const wrongTorrent: any = await actionHandler(
    { downloaderId: "qb", torrentId: "missing" },
    { requestId: `${action}-4`, capability: actionId as any, input: { downloaderId: "qb", torrentId: "missing" } },
  );
  assert.deepEqual(wrongTorrent, { status: "not_found", downloaderId: "qb", torrentId: "missing" });
}
console.log("MCP action tests passed: snapshot deletion and downloader pause/resume are confirmation-bound and replay-safe.");
