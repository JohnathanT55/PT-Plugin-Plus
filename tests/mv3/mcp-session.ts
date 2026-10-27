import assert from "node:assert/strict";
import {
  McpSessionManager,
  executeBoundedCapability,
  jsonUtf8Bytes,
} from "../../app/src/entries/offscreen/utils/mcpSession.ts";
import type {
  IMcpSessionOpenResponse,
  IMcpToolRequest,
  IMcpToolResult,
} from "../../app/src/entries/shared/mcpBridge.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const session = (id: string): IMcpSessionOpenResponse => ({
  ok: true,
  protocol: 1,
  sessionId: id,
  expiresAt: Date.now() + 100_000,
  capabilities: [],
});
const request = (id: string): IMcpToolRequest => ({ requestId: id, capability: "ptpp.extension_info", input: {} });
const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++) await sleep(2);
  assert(check(), "asynchronous condition completed");
}

function makeTransport() {
  const opens: { config: string; signal: AbortSignal }[] = [];
  const polls: {
    config: string;
    id: string;
    signal: AbortSignal;
    reply: ReturnType<typeof deferred<IMcpToolRequest | null>>;
  }[] = [];
  const responses: { config: string; id: string; result: IMcpToolResult }[] = [];
  const closes: { config: string; id: string }[] = [];
  const executions: string[] = [];
  const transport = {
    async open(config: string, signal: AbortSignal) {
      opens.push({ config, signal });
      return session(`${config}-${opens.length}`);
    },
    poll(config: string, id: string, signal: AbortSignal) {
      const reply = deferred<IMcpToolRequest | null>();
      polls.push({ config, id, signal, reply });
      return reply.promise;
    },
    async respond(config: string, id: string, result: IMcpToolResult) {
      responses.push({ config, id, result });
    },
    async close(config: string, id: string) {
      closes.push({ config, id });
    },
    async execute(value: IMcpToolRequest) {
      executions.push(value.requestId);
      return { requestId: value.requestId, ok: true, result: {} };
    },
    isSessionGone(error: unknown) {
      return error === "gone";
    },
    retryDelayMs: 1,
  };
  return { transport, opens, polls, responses, closes, executions };
}

{
  const test = makeTransport();
  const manager = new McpSessionManager(test.transport);
  await manager.configure("old", "old");
  await manager.configure("old", "old");
  assert.equal(test.opens.length, 1, "repeated status/config checks do not replace a healthy session");
  await manager.configure("new", "new");
  assert(test.polls[0].signal.aborted, "replacement immediately aborts the old poll");
  assert.deepEqual(test.closes, [{ config: "old", id: "old-1" }], "old session closes with its own credentials/config");
  test.polls[0].reply.resolve(request("late-old"));
  test.polls[1].reply.resolve(request("current"));
  await until(() => test.responses.length === 1);
  assert.deepEqual(test.executions, ["current"], "late old polls are not executed");
  assert.equal(test.responses[0].id, "new-2");
  await manager.configure(undefined);
  const lastPoll = test.polls.at(-1)!;
  assert(lastPoll.signal.aborted, "disable immediately cancels the active poll");
  lastPoll.reply.resolve(request("after-disable"));
  await sleep();
  assert.deepEqual(test.executions, ["current"], "no dispatch after disable");
}

{
  const test = makeTransport();
  const handler = deferred<IMcpToolResult>();
  const manager = new McpSessionManager({ ...test.transport, execute: () => handler.promise });
  await manager.configure("first", "first");
  test.polls[0].reply.resolve(request("slow"));
  await sleep();
  await manager.configure("replacement", "replacement");
  handler.resolve({ requestId: "slow", ok: true, result: {} });
  await sleep();
  assert.equal(test.responses.length, 0, "old in-flight results cannot be posted to the replacement session");
  manager.stop();
}

{
  const test = makeTransport();
  const opening = deferred<IMcpSessionOpenResponse>();
  const manager = new McpSessionManager({ ...test.transport, open: () => opening.promise });
  const ready = manager.configure("late", "late");
  manager.stop();
  await assert.rejects(ready, /会话已停止/);
  opening.resolve(session("late-open"));
  await until(() => test.closes.length === 1);
  assert.equal(test.polls.length, 0, "a late open after stop is closed without polling");
  assert.equal(test.closes[0].id, "late-open");
}

{
  const test = makeTransport();
  const manager = new McpSessionManager(test.transport);
  await manager.configure("restart", "restart");
  test.polls[0].reply.reject("gone");
  await until(() => test.opens.length === 2 && test.polls.length === 2);
  const latest = await manager.configure("restart", "restart");
  assert.equal(latest?.sessionId, "restart-2", "expired/restarted server sessions reopen automatically");
  test.polls[1].reply.resolve(request("after-restart"));
  await until(() => test.responses.length === 1);
  assert.equal(test.responses[0].id, "restart-2");
  manager.stop();
}

{
  const test = makeTransport();
  const manager = new McpSessionManager({
    ...test.transport,
    respond: async () => {
      throw "gone";
    },
  });
  await manager.configure("timeout", "timeout");
  test.polls[0].reply.resolve(request("expired-request"));
  await until(() => test.polls.length === 2);
  assert.equal(test.opens.length, 1, "expired requests do not recreate the whole session");
  manager.stop();
}

{
  const test = makeTransport();
  let attempts = 0;
  const manager = new McpSessionManager({
    ...test.transport,
    open: async (config, signal) => {
      attempts++;
      if (attempts === 1) throw new Error("temporarily offline");
      return test.transport.open(config, signal);
    },
  });
  await assert.rejects(manager.configure("recovery", "recovery"), /自动重连/);
  await until(() => test.polls.length === 1);
  assert.equal(
    (await manager.configure("recovery", "recovery"))?.sessionId,
    "recovery-1",
    "failed initial open recovers without manual reconnection",
  );
  manager.stop();
}

{
  assert.equal(jsonUtf8Bytes("中文"), 8, "size checks use UTF-8 bytes, not UTF-16 character count");
  assert.equal(
    (await executeBoundedCapability(request("small"), async () => "中文", 7)).error?.code,
    "result_too_large",
  );
  assert.equal((await executeBoundedCapability(request("fits"), async () => "中文", 8)).ok, true);
  const circular: any = {};
  circular.self = circular;
  assert.equal(
    (await executeBoundedCapability(request("circular"), async () => circular, 100)).error?.code,
    "result_too_large",
  );
  assert.equal(
    (await executeBoundedCapability(request("unknown"), undefined, 100)).error?.code,
    "unsupported_capability",
  );
  const failed = await executeBoundedCapability(
    request("private-error"),
    async () => {
      throw new Error("Authorization: private-value https://private.example");
    },
    100,
  );
  assert(
    !JSON.stringify(failed).includes("private-value") && !JSON.stringify(failed).includes("private.example"),
    "raw handler errors never leave the extension",
  );
}

console.log("MCP session lifecycle, cancellation, recovery, and byte-boundary tests passed.");
