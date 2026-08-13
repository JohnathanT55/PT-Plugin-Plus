export const DURABLE_TASK_STORAGE_VERSION = 1 as const;
export const DURABLE_ALARM_PREFIX = "ptpp-once:";
export const DURABLE_TASK_RUNNING_LEASE_MS = 30 * 60 * 1000;

export type TDurableTaskState = "scheduled" | "running";

export interface IDurableTask<TPayload> {
  id: string;
  generation: number;
  runAt: number;
  state: TDurableTaskState;
  payload: TPayload;
  startedAt?: number;
}

export interface IDurableTaskStore<TPayload> {
  version: typeof DURABLE_TASK_STORAGE_VERSION;
  tasks: Record<string, IDurableTask<TPayload>>;
}

export interface IDurableTaskAdapter<TPayload> {
  load(): Promise<IDurableTaskStore<TPayload> | undefined>;
  save(store: IDurableTaskStore<TPayload>): Promise<void>;
  createAlarm(name: string, when: number): Promise<void> | void;
  clearAlarm(name: string): Promise<void> | void;
  execute(task: IDurableTask<TPayload>): Promise<void>;
  now(): number;
}

export function createEmptyDurableTaskStore<TPayload>(): IDurableTaskStore<TPayload> {
  return { version: DURABLE_TASK_STORAGE_VERSION, tasks: {} };
}

export function durableAlarmName(taskId: string): string {
  return `${DURABLE_ALARM_PREFIX}${encodeURIComponent(taskId)}`;
}

export function durableTaskIdFromAlarm(alarmName: string): string | undefined {
  if (!alarmName.startsWith(DURABLE_ALARM_PREFIX)) return undefined;
  try {
    return decodeURIComponent(alarmName.slice(DURABLE_ALARM_PREFIX.length));
  } catch {
    return undefined;
  }
}

function normalizeStore<TPayload>(store: IDurableTaskStore<TPayload> | undefined): IDurableTaskStore<TPayload> {
  if (store?.version !== DURABLE_TASK_STORAGE_VERSION || !store.tasks || typeof store.tasks !== "object") {
    return createEmptyDurableTaskStore<TPayload>();
  }
  return store;
}

export function createDurableTaskCoordinator<TPayload>(adapter: IDurableTaskAdapter<TPayload>) {
  let mutationQueue: Promise<void> = Promise.resolve();
  const runningTaskIds = new Set<string>();

  async function mutateStore<TResult>(
    mutation: (store: IDurableTaskStore<TPayload>) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    let result!: TResult;
    const operation = mutationQueue.then(async () => {
      const store = normalizeStore(await adapter.load());
      result = await mutation(store);
      await adapter.save(store);
    });
    mutationQueue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  async function schedule(input: { id: string; runAt: number; payload: TPayload }): Promise<IDurableTask<TPayload>> {
    const task = await mutateStore((store) => {
      const nextTask: IDurableTask<TPayload> = {
        ...input,
        generation: (store.tasks[input.id]?.generation ?? 0) + 1,
        state: "scheduled",
      };
      store.tasks[nextTask.id] = nextTask;
      return nextTask;
    });
    try {
      await adapter.createAlarm(durableAlarmName(task.id), task.runAt);
    } catch (error) {
      await mutateStore((store) => {
        if (store.tasks[task.id]?.generation === task.generation) {
          delete store.tasks[task.id];
        }
      });
      throw error;
    }
    return task;
  }

  async function restore(): Promise<number> {
    const store = normalizeStore(await adapter.load());
    const now = adapter.now();
    for (const task of Object.values(store.tasks)) {
      const retryAt =
        task.state === "running"
          ? Math.max(task.runAt, (task.startedAt ?? task.runAt) + DURABLE_TASK_RUNNING_LEASE_MS, now)
          : Math.max(task.runAt, now);
      await adapter.createAlarm(durableAlarmName(task.id), retryAt);
    }
    return Object.keys(store.tasks).length;
  }

  async function handleAlarm(alarmName: string): Promise<boolean> {
    const taskId = durableTaskIdFromAlarm(alarmName);
    if (!taskId) return false;
    if (runningTaskIds.has(taskId)) return true;

    const store = normalizeStore(await adapter.load());
    let task = store.tasks[taskId];
    if (!task) {
      await adapter.clearAlarm(alarmName);
      return true;
    }

    if (task.state === "running") {
      const retryAt = (task.startedAt ?? task.runAt) + DURABLE_TASK_RUNNING_LEASE_MS;
      if (retryAt > adapter.now()) {
        await adapter.createAlarm(alarmName, retryAt);
        return true;
      }
      const recoveredTask = await mutateStore((currentStore) => {
        const currentTask = currentStore.tasks[taskId];
        const currentRetryAt = currentTask
          ? (currentTask.startedAt ?? currentTask.runAt) + DURABLE_TASK_RUNNING_LEASE_MS
          : Number.POSITIVE_INFINITY;
        if (
          currentTask?.generation === task.generation &&
          currentTask.state === "running" &&
          currentRetryAt <= adapter.now()
        ) {
          const replacement: IDurableTask<TPayload> = {
            ...currentTask,
            generation: currentTask.generation + 1,
            state: "scheduled",
            runAt: adapter.now(),
          };
          delete replacement.startedAt;
          currentStore.tasks[taskId] = replacement;
          return replacement;
        }
        return undefined;
      });
      if (!recoveredTask) return true;
      task = recoveredTask;
    }

    if (task.runAt > adapter.now()) {
      await adapter.createAlarm(alarmName, task.runAt);
      return true;
    }

    runningTaskIds.add(taskId);
    let claimed = false;
    try {
      claimed = await mutateStore((currentStore) => {
        const currentTask = currentStore.tasks[taskId];
        if (currentTask?.generation === task.generation && currentTask.state === "scheduled") {
          currentTask.state = "running";
          currentTask.startedAt = adapter.now();
          return true;
        }
        return false;
      });
      if (!claimed) {
        if (!(await getTask(taskId))) {
          await adapter.clearAlarm(alarmName);
        }
        return true;
      }
      await adapter.execute(task);
      return true;
    } finally {
      try {
        if (claimed) {
          await mutateStore((currentStore) => {
            if (currentStore.tasks[taskId]?.generation === task.generation) {
              delete currentStore.tasks[taskId];
            }
          });
          if (!(await getTask(taskId))) {
            await adapter.clearAlarm(alarmName);
          }
        }
      } finally {
        runningTaskIds.delete(taskId);
      }
    }
  }

  async function getTask(taskId: string): Promise<IDurableTask<TPayload> | undefined> {
    const store = normalizeStore(await adapter.load());
    return store.tasks[taskId];
  }

  async function cancel(taskId: string): Promise<boolean> {
    const removed = await mutateStore((store) => {
      if (!store.tasks[taskId]) return false;
      delete store.tasks[taskId];
      return true;
    });
    await adapter.clearAlarm(durableAlarmName(taskId));
    return removed;
  }

  return { schedule, restore, handleAlarm, getTask, cancel };
}
