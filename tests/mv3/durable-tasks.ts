import {
  createDurableTaskCoordinator,
  createEmptyDurableTaskStore,
  durableAlarmName,
  durableTaskIdFromAlarm,
  type IDurableTask,
  type IDurableTaskStore,
} from "../../src/tasks/durable";

interface TestPayload {
  type: "download" | "userInfoRetry";
  value: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Durable task test failed: ${message}`);
}

let now = 1_000_000;
let store: IDurableTaskStore<TestPayload> = createEmptyDurableTaskStore<TestPayload>();
const alarms = new Map<string, number>();
const executions: Array<IDurableTask<TestPayload>> = [];
let executeHook: ((task: IDurableTask<TestPayload>) => Promise<void>) | undefined;

function cloneStore(): IDurableTaskStore<TestPayload> {
  return structuredClone(store);
}

function createCoordinator() {
  return createDurableTaskCoordinator<TestPayload>({
    async load() {
      return cloneStore();
    },
    async save(nextStore) {
      store = structuredClone(nextStore);
    },
    createAlarm(name, when) {
      alarms.set(name, when);
    },
    clearAlarm(name) {
      alarms.delete(name);
    },
    async execute(task) {
      executions.push(structuredClone(task));
      await executeHook?.(task);
    },
    now: () => now,
  });
}

const firstWorker = createCoordinator();
for (const delay of [5_000, 30_000, 60_000]) {
  const id = `download-${delay}`;
  await firstWorker.schedule({ id, runAt: now + delay, payload: { type: "download", value: delay } });
  assert(alarms.get(durableAlarmName(id)) === now + delay, `${delay}ms delay keeps its exact due time`);
}

assert(durableTaskIdFromAlarm(durableAlarmName("download:42")) === "download:42", "alarm IDs round-trip safely");
assert(durableTaskIdFromAlarm("unrelated") === undefined, "unrelated alarms are ignored");

// A new coordinator has no in-memory callback state. It represents a newly-created service worker.
const restartedWorker = createCoordinator();
alarms.clear();
assert((await restartedWorker.restore()) === 3, "worker restart restores every persisted task");
assert(alarms.size === 3, "worker restart recreates each Chrome alarm");

now += 5_000;
const fiveSecondAlarm = durableAlarmName("download-5000");
assert(await restartedWorker.handleAlarm(fiveSecondAlarm), "restored alarm is handled after restart");
assert(
  executions.length === 1 && executions[0].payload.value === 5_000,
  "restored task executes the persisted payload",
);
assert(!store.tasks["download-5000"], "completed task is removed from durable storage");
assert(!alarms.has(fiveSecondAlarm), "completed task clears its alarm");

const earlyAlarm = durableAlarmName("download-30000");
await restartedWorker.handleAlarm(earlyAlarm);
assert(executions.length === 1, "an early alarm never executes the task");
assert(alarms.get(earlyAlarm) === 1_030_000, "an early alarm is restored to the original due time");

now = 1_100_000;
await restartedWorker.handleAlarm(earlyAlarm);
await restartedWorker.handleAlarm(earlyAlarm);
assert(
  executions.filter((task) => task.id === "download-30000").length === 1,
  "a task removed after success cannot execute twice",
);

await firstWorker.schedule({
  id: "overdue-retry",
  runAt: now - 60_000,
  payload: { type: "userInfoRetry", value: 2 },
});
alarms.clear();
const secondRestart = createCoordinator();
await secondRestart.restore();
assert(
  alarms.get(durableAlarmName("overdue-retry")) === now,
  "an overdue task is scheduled immediately after browser wake or worker restart",
);

executeHook = async (task) => {
  if (task.id === "rescheduled-during-run") {
    await secondRestart.schedule({
      id: task.id,
      runAt: now + 45_000,
      payload: { type: "download", value: 2 },
    });
  }
};
await secondRestart.schedule({
  id: "rescheduled-during-run",
  runAt: now,
  payload: { type: "download", value: 1 },
});
await secondRestart.handleAlarm(durableAlarmName("rescheduled-during-run"));
const replacement = store.tasks["rescheduled-during-run"];
assert(replacement?.generation === 2, "a replacement task receives a new generation");
assert(replacement?.payload.value === 2, "finishing an old generation does not delete its replacement");
assert(
  alarms.get(durableAlarmName("rescheduled-during-run")) === now + 45_000,
  "finishing an old generation preserves the replacement alarm",
);

let staleClaimStore: IDurableTaskStore<TestPayload> = {
  version: 1,
  tasks: {
    "replaced-before-claim": {
      id: "replaced-before-claim",
      generation: 1,
      runAt: now,
      state: "scheduled",
      payload: { type: "download", value: 1 },
    },
  },
};
let staleClaimLoads = 0;
let staleClaimExecutions = 0;
const staleClaimCoordinator = createDurableTaskCoordinator<TestPayload>({
  async load() {
    staleClaimLoads += 1;
    if (staleClaimLoads === 2) {
      staleClaimStore.tasks["replaced-before-claim"] = {
        id: "replaced-before-claim",
        generation: 2,
        runAt: now + 90_000,
        state: "scheduled",
        payload: { type: "download", value: 2 },
      };
    }
    return structuredClone(staleClaimStore);
  },
  async save(nextStore) {
    staleClaimStore = structuredClone(nextStore);
  },
  createAlarm() {},
  clearAlarm() {},
  async execute() {
    staleClaimExecutions += 1;
  },
  now: () => now,
});
await staleClaimCoordinator.handleAlarm(durableAlarmName("replaced-before-claim"));
assert(staleClaimExecutions === 0, "a task replaced before its claim never executes the stale generation");
assert(
  staleClaimStore.tasks["replaced-before-claim"]?.generation === 2,
  "a task replaced before its claim remains scheduled",
);

let failedAlarmStore = createEmptyDurableTaskStore<TestPayload>();
const failedAlarmCoordinator = createDurableTaskCoordinator<TestPayload>({
  async load() {
    return structuredClone(failedAlarmStore);
  },
  async save(nextStore) {
    failedAlarmStore = structuredClone(nextStore);
  },
  createAlarm() {
    throw new Error("fixture alarm creation failed");
  },
  clearAlarm() {},
  async execute() {},
  now: () => now,
});
let alarmFailureRejected = false;
try {
  await failedAlarmCoordinator.schedule({
    id: "alarm-failure",
    runAt: now + 10_000,
    payload: { type: "download", value: 3 },
  });
} catch {
  alarmFailureRejected = true;
}
assert(alarmFailureRejected, "alarm creation failure is reported to the caller");
assert(!failedAlarmStore.tasks["alarm-failure"], "alarm creation failure removes the unusable persisted task");

await secondRestart.schedule({
  id: "cancelled-backup-retry",
  runAt: now + 60_000,
  payload: { type: "userInfoRetry", value: 4 },
});
assert(await secondRestart.cancel("cancelled-backup-retry"), "a pending task can be cancelled after recovery");
assert(!store.tasks["cancelled-backup-retry"], "cancelling removes the persisted task");
assert(!alarms.has(durableAlarmName("cancelled-backup-retry")), "cancelling clears the Chrome alarm");

console.log("Durable MV3 one-shot task scheduling and worker-restart recovery passed.");
