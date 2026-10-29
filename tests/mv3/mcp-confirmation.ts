import assert from "node:assert/strict";
import { McpConfirmationStore, confirmationFingerprint } from "../../app/src/entries/offscreen/utils/mcpConfirmation.ts";

let clock = 1_000;
let token = 0;
const store = new McpConfirmationStore({ now: () => clock, ttlMs: 10_000, maxPending: 2, createToken: () => `token-${++token}` });
const input = { patch: { searchEntity: { queueConcurrency: 3 } }, nested: { b: 2, a: 1 } };

assert.equal(confirmationFingerprint({ a: 1, b: 2 }), confirmationFingerprint({ b: 2, a: 1 }), "object key order is stable");
const pending = store.create("ptpp.settings.apply_patch", input, "调整搜索并发数", { before: 1, after: 3 });
assert.equal(pending.code, "confirmation_required");
assert.equal(store.list().length, 1);
assert.equal("confirmationToken" in pending, false, "pending tool response never grants approval");
assert.equal(store.consume(pending.confirmationId, "ptpp.settings.apply_patch", input), undefined, "knowing the pending id is not consent");
const approvedToken = store.approve(pending.confirmationId)!;
assert(approvedToken);
assert.equal(store.approve(pending.confirmationId), undefined, "cannot mint a second approval");
assert.equal(JSON.stringify(store.list()).includes(approvedToken), false, "public list hides bearer tokens");
assert.equal(store.consume(approvedToken, "ptpp.settings.apply_patch", { nested: { a: 1, b: 2 }, patch: { searchEntity: { queueConcurrency: 3 } } })?.summary, "调整搜索并发数");
assert.equal(store.consume(approvedToken, "ptpp.settings.apply_patch", input), undefined, "token is one-time");

const wrong = store.create("ptpp.settings.apply_patch", input, "same", {});
const wrongToken = store.approve(wrong.confirmationId)!;
assert.equal(store.consume(wrongToken, "ptpp.settings.get", input), undefined, "capability is bound");
assert.equal(store.consume(wrongToken, "ptpp.settings.apply_patch", { patch: { searchEntity: { queueConcurrency: 4 } } }), undefined, "input is bound");
clock += 10_001;
assert.equal(store.consume(wrongToken, "ptpp.settings.apply_patch", input), undefined, "expired tokens are rejected");

clock = 2_000;
const first = store.create("one", {}, "one", {});
store.create("two", {}, "two", {});
store.create("three", {}, "three", {});
assert.equal(store.list().length, 2, "oldest pending records are bounded");
assert.equal(store.list().some((item) => item.confirmationId === first.confirmationId), false);
store.clear();
assert.equal(store.list().length, 0);

const scoped = store.create("ptpp.settings.apply_patch", input, "scoped", {}, "session-1");
assert.equal(store.approve(scoped.confirmationId, "session-2"), undefined);
const scopedToken = store.approve(scoped.confirmationId, "session-1")!;
assert.equal(store.consume(scopedToken, "ptpp.settings.apply_patch", input, "session-2"), undefined);
assert.equal(store.consume(scopedToken, "ptpp.settings.apply_patch", input, "session-1")?.summary, "scoped");
assert.throws(() => confirmationFingerprint({ invalid: undefined }), /JSON/);

console.log("MCP confirmation tests passed: stable binding, expiry, replay protection and bounded storage.");
