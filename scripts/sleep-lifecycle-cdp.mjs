import process from "node:process";

const [endpoint = "http://127.0.0.1:9222", action = "prepare"] = process.argv.slice(2);
const taskId = "system-sleep-lifecycle-probe";
const alarmName = `ptpp-once:${encodeURIComponent(taskId)}`;
const probeKey = "ptppSleepLifecycleProbe";

if (!["prepare", "verify", "abort"].includes(action)) {
  console.error("Usage: node scripts/sleep-lifecycle-cdp.mjs <endpoint> <prepare|verify|abort>");
  process.exit(2);
}

const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const optionsTarget = targets.find(
  (target) =>
    target.type === "page" &&
    target.url?.startsWith("chrome-extension://") &&
    target.url.includes("/src/entries/options/index.html"),
);
const offscreenTarget = targets.find(
  (target) =>
    ["background_page", "page"].includes(target.type) && target.url?.includes("/src/entries/offscreen/offscreen.html"),
);

if (!optionsTarget?.webSocketDebuggerUrl || !offscreenTarget?.webSocketDebuggerUrl) {
  throw new Error("PT-Plugin-Plus options and offscreen targets must both be open before the sleep test.");
}

class CdpSession {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.nextId = 0;
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    return this;
  }

  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

const options = await new CdpSession(optionsTarget.webSocketDebuggerUrl).open();
const offscreen = await new CdpSession(offscreenTarget.webSocketDebuggerUrl).open();

async function restoreProbe(probe) {
  await options.evaluate(`(async () => {
    const probe = ${JSON.stringify(probe)};
    const current = await chrome.storage.local.get(["pendingOneShotTasks"]);
    const pending = current.pendingOneShotTasks ?? { version: 1, tasks: {} };
    delete pending.tasks[${JSON.stringify(taskId)}];
    await chrome.storage.local.set({
      config: probe.originalConfig,
      metadata: probe.originalMetadata,
      pendingOneShotTasks: pending,
    });
    await chrome.storage.local.remove(${JSON.stringify(probeKey)});
    await chrome.alarms.clear(${JSON.stringify(alarmName)});
  })()`);
}

try {
  if (action === "prepare") {
    const existing = await options.evaluate(
      `chrome.storage.local.get(${JSON.stringify(probeKey)}).then((data) => data[${JSON.stringify(probeKey)}])`,
    );
    if (existing) throw new Error("A sleep lifecycle probe is already prepared. Verify or abort it first.");

    const preparedAt = Date.now();
    const runAt = preparedAt + 90_000;
    const prepared = await options.evaluate(`(async () => {
      const data = await chrome.storage.local.get(["config", "metadata", "pendingOneShotTasks"]);
      const originalConfig = data.config ?? {};
      const originalMetadata = data.metadata ?? {};
      const config = structuredClone(originalConfig);
      const metadata = structuredClone(originalMetadata);
      config.userInfo ??= {};
      config.userInfo.autoReflush = {
        ...(config.userInfo.autoReflush ?? {}),
        enabled: true,
        afterTime: "00:00",
        retry: { max: 0, interval: 5 },
      };
      config.backup ??= {};
      config.backup.autoUploadUserData = {
        ...(config.backup.autoUploadUserData ?? {}),
        enabled: false,
      };
      metadata.sites = {};
      // A restarted MV3 worker immediately evaluates the normal ten-minute
      // refresh job. Keep that independent job inside its interval so the
      // probe measures only the injected retry task after wake.
      metadata.lastUserInfoAutoFlushAt = ${preparedAt};
      const pending = data.pendingOneShotTasks ?? { version: 1, tasks: {} };
      pending.tasks[${JSON.stringify(taskId)}] = {
        id: ${JSON.stringify(taskId)},
        generation: (pending.tasks[${JSON.stringify(taskId)}]?.generation ?? 0) + 1,
        runAt: ${runAt},
        state: "scheduled",
        payload: { type: "userInfoRetry", retryIndex: 1 },
      };
      const probe = {
        version: 1,
        preparedAt: ${preparedAt},
        runAt: ${runAt},
        originalConfig,
        originalMetadata,
      };
      await chrome.storage.local.set({ config, metadata, pendingOneShotTasks: pending, ${probeKey}: probe });
      chrome.alarms.create(${JSON.stringify(alarmName)}, { when: ${runAt} });
      return { preparedAt: probe.preparedAt, runAt: probe.runAt, alarm: await chrome.alarms.get(${JSON.stringify(alarmName)}) };
    })()`);
    await offscreen.evaluate(`sessionStorage.setItem("logger", "[]")`);
    console.log(
      JSON.stringify(
        {
          action,
          endpoint,
          ...prepared,
          preparedAtIso: new Date(prepared.preparedAt).toISOString(),
          runAtIso: new Date(prepared.runAt).toISOString(),
        },
        null,
        2,
      ),
    );
  } else {
    const probe = await options.evaluate(
      `chrome.storage.local.get(${JSON.stringify(probeKey)}).then((data) => data[${JSON.stringify(probeKey)}])`,
    );
    if (!probe) throw new Error("No prepared sleep lifecycle probe was found.");

    if (action === "abort") {
      await restoreProbe(probe);
      console.log(JSON.stringify({ action, restored: true }, null, 2));
    } else {
      const state = await options.evaluate(`(async () => {
        const data = await chrome.storage.local.get(["metadata", "pendingOneShotTasks"]);
        return {
          checkedAt: Date.now(),
          task: data.pendingOneShotTasks?.tasks?.[${JSON.stringify(taskId)}] ?? null,
          alarm: (await chrome.alarms.get(${JSON.stringify(alarmName)})) ?? null,
          lastUserInfoAutoFlushAt: data.metadata?.lastUserInfoAutoFlushAt ?? 0,
        };
      })()`);
      const logs = await offscreen.evaluate(
        `JSON.parse(sessionStorage.getItem("logger") ?? "[]").filter((item) => item.time >= ${probe.preparedAt})`,
      );
      const startLogs = logs.filter((item) => item.msg?.startsWith("Auto-refreshing user information at"));
      const finishLogs = logs.filter((item) => item.msg?.startsWith("Auto-refreshing user information finished"));
      const checks = {
        deadlinePassed: state.checkedAt >= probe.runAt,
        taskRemoved: state.task === null,
        alarmRemoved: state.alarm === null,
        ranAfterDeadline: state.lastUserInfoAutoFlushAt >= probe.runAt,
        startLoggedOnce: startLogs.length === 1,
        finishLoggedOnce: finishLogs.length === 1,
        noSitesAccessed: finishLogs[0]?.msg?.includes("0 sites processed, 0 failed") === true,
      };
      await restoreProbe(probe);
      const passed = Object.values(checks).every(Boolean);
      console.log(
        JSON.stringify(
          {
            action,
            passed,
            probe: { preparedAt: probe.preparedAt, runAt: probe.runAt },
            state,
            checks,
            logs,
            restored: true,
          },
          null,
          2,
        ),
      );
      if (!passed) process.exitCode = 1;
    }
  }
} finally {
  options.close();
  offscreen.close();
}
