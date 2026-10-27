import assert from "node:assert/strict";
import {
  AI_SESSION_KEY,
  AI_SESSION_MAX_MESSAGE,
  AI_SESSION_TTL_MS,
  useAiSession,
} from "../../app/src/entries/options/utils/aiSession.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

function fixture(storage = new MemoryStorage()) {
  let time = 1000;
  let serial = 0;
  const timers = new Map<number, { callback: () => void; due: number }>();
  const legacyStorage = new MemoryStorage();
  legacyStorage.setItem(AI_SESSION_KEY, "old transient draft");
  legacyStorage.setItem("unrelated", "keep");
  const options = {
    storage,
    legacyStorage,
    now: () => time,
    schedule(callback: () => void, delay: number) {
      const id = ++serial;
      timers.set(id, { callback, due: time + delay });
      return id;
    },
    cancel(id: unknown) {
      timers.delete(id as number);
    },
  };
  const session = useAiSession(options);
  return {
    session,
    storage,
    legacyStorage,
    timers,
    options,
    advance(ms: number, runTimers = true) {
      time += ms;
      if (runTimers)
        for (const [id, timer] of [...timers])
          if (timer.due <= time) {
            timers.delete(id);
            timer.callback();
          }
    },
  };
}

const f = fixture();
const sending = fixture();
sending.session.prompt.value = "Earlier draft";
sending.advance(AI_SESSION_TTL_MS - 1000);
const sendingToken = sending.session.beginTurn();
sending.advance(2000);
assert(sending.session.completeTurn(sendingToken, "Earlier draft", "Reply"), "sending renews the idle deadline");
sending.session.dispose();
assert.equal(f.legacyStorage.getItem(AI_SESSION_KEY), null);
assert.equal(f.legacyStorage.getItem("unrelated"), "keep");
f.session.prompt.value = "Please analyze selected sites";
const first = f.session.beginTurn();
assert(f.session.completeTurn(first, f.session.prompt.value, "Useful reply"));
f.session.prompt.value = "Unsent follow-up";
const restored = useAiSession(f.options);
assert.equal(restored.prompt.value, "Unsent follow-up");
assert.equal(restored.messages.value.length, 2);
restored.dispose();
f.advance(AI_SESSION_TTL_MS - 1);
assert.equal(f.session.messages.value.length, 2);
f.advance(1);
assert.equal(f.session.messages.value.length, 0, "idle state expires even without remount");
assert.equal(f.session.prompt.value, "");
assert.equal(f.storage.getItem(AI_SESSION_KEY), null);
assert(!f.session.completeTurn(first, "old", "late"), "late response cannot resurrect expired history");

f.session.prompt.value = "sent";
const token = f.session.beginTurn();
f.session.prompt.value = "new draft entered during request";
assert(f.session.completeTurn(token, "sent", "reply"));
assert.equal(f.session.prompt.value, "new draft entered during request");
f.session.clear();
assert(!f.session.completeTurn(token, "sent", "late"), "clear invalidates pending turns");
assert.equal(f.storage.getItem(AI_SESSION_KEY), null);

for (let i = 0; i < 30; i++) {
  f.session.prompt.value = `question ${i}`;
  f.session.completeTurn(f.session.beginTurn(), `question ${i}`, "x".repeat(AI_SESSION_MAX_MESSAGE + 100));
}
assert.equal(f.session.messages.value.length, 40);
assert.equal(f.session.messages.value[0].content, "question 10");
assert.equal(f.session.messages.value[1].content.length, AI_SESSION_MAX_MESSAGE);
f.session.prompt.value = "x".repeat(5000);
assert.equal(f.session.prompt.value.length, 4000);
f.advance(AI_SESSION_TTL_MS + 10, false);
f.session.prompt.value = "Fresh typing after a background timer was throttled";
assert.equal(f.session.messages.value.length, 0);
assert.equal(f.session.prompt.value, "Fresh typing after a background timer was throttled");

const boundedStore = new MemoryStorage();
boundedStore.setItem(
  AI_SESSION_KEY,
  JSON.stringify({
    version: 1,
    updatedAt: 1000,
    prompt: "x".repeat(5000),
    messages: [
      null,
      { role: "system", content: "not accepted" },
      { role: "user", content: "kept", extra: "discarded" },
    ],
  }),
);
const boundedRestore = fixture(boundedStore);
assert.equal(boundedRestore.session.prompt.value.length, 4000);
assert.deepEqual(boundedRestore.session.messages.value, [{ role: "user", content: "kept" }]);
boundedRestore.advance(AI_SESSION_TTL_MS);
assert.equal(boundedStore.getItem(AI_SESSION_KEY), null, "restore does not renew idle deadline");
boundedRestore.session.dispose();

for (const saved of [
  "bad json",
  "null",
  JSON.stringify({ version: 1, updatedAt: 5000 }),
  JSON.stringify({ version: 1, updatedAt: -AI_SESSION_TTL_MS }),
]) {
  const store = new MemoryStorage();
  store.setItem(AI_SESSION_KEY, saved);
  const broken = fixture(store);
  assert.equal(broken.session.messages.value.length, 0);
  assert.equal(store.getItem(AI_SESSION_KEY), null, "corrupt, expired or future session is removed");
  broken.session.dispose();
}

const failingStorage = {
  getItem() {
    throw new Error("disabled");
  },
  setItem() {
    throw new Error("full");
  },
  removeItem() {
    throw new Error("disabled");
  },
};
const noStorage = useAiSession({ storage: failingStorage, legacyStorage: failingStorage });
noStorage.prompt.value = "works in memory";
assert(noStorage.completeTurn(noStorage.beginTurn(), "works in memory", "reply"));
assert.equal(noStorage.messages.value.length, 2);
noStorage.clear();
noStorage.dispose();
f.session.dispose();
assert.equal(f.timers.size, 0, "disposed component releases expiry timer");
console.log("AI conversation idle expiry, bounded persistence, recovery and late-response isolation passed.");
