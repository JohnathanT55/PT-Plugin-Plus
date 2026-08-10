const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`MV3 worker runtime test failed: ${message}`);
  }
}

class FakeEvent {
  constructor() {
    this.listeners = [];
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  emit(...args) {
    return this.listeners.map(listener => listener(...args));
  }
}

class FakeStorageArea {
  constructor(initial) {
    this.values = { ...initial };
  }

  get(keys, callback) {
    const requested = keys === null ? Object.keys(this.values) : Array.isArray(keys) ? keys : [keys];
    const result = {};
    requested.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(this.values, key)) {
        result[key] = this.values[key];
      }
    });
    queueMicrotask(() => callback(result));
  }

  set(items, callback) {
    Object.assign(this.values, items);
    queueMicrotask(() => callback && callback());
  }

  remove(keys, callback) {
    (Array.isArray(keys) ? keys : [keys]).forEach(key => delete this.values[key]);
    queueMicrotask(() => callback && callback());
  }
}

function waitFor(predicate, message, timeoutMs = 2000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${message}`));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
}

async function main() {
  const workerPath = path.join(__dirname, "../../dist/js/background.js");
  assert(fs.existsSync(workerPath), "background bundle must be built first");

  const storage = new FakeStorageArea({
    "PT-Plugin-Plus-Config": {
      defaultClientId: "qb-runtime",
      autoRefreshUserData: true,
      autoRefreshUserDataHours: 6,
      sites: [
        {
          name: "Audiences",
          host: "audiences.me",
          defaultClientId: "qb-runtime"
        }
      ],
      clients: [
        {
          id: "qb-runtime",
          name: "Runtime qBittorrent",
          type: "qbittorrent",
          address: "https://downloader.example.invalid",
          paths: {
            "audiences.me": ["/runtime/audiences"]
          }
        }
      ]
    }
  });

  const events = {
    installed: new FakeEvent(),
    startup: new FakeEvent(),
    message: new FakeEvent(),
    alarm: new FakeEvent(),
    action: new FakeEvent()
  };
  const createdAlarms = {};
  const capturedErrors = [];
  let offscreenCreated = false;

  const chrome = {
    runtime: {
      id: "fixture-extension-id",
      lastError: undefined,
      onInstalled: events.installed,
      onStartup: events.startup,
      onMessage: events.message,
      getURL: file => `chrome-extension://fixture-extension-id/${file}`,
      getContexts: async () =>
        offscreenCreated
          ? [
              {
                contextType: "OFFSCREEN_DOCUMENT",
                documentUrl:
                  "chrome-extension://fixture-extension-id/offscreen.html"
              }
            ]
          : [],
      sendMessage(request, callback) {
        queueMicrotask(() => {
          if (request.type === "ptpp.offscreen.ping") {
            callback({ ok: true, data: { alive: true } });
            return;
          }
          callback({ ok: false, error: { code: "unexpected", message: request.type } });
        });
      }
    },
    storage: { local: storage },
    alarms: {
      onAlarm: events.alarm,
      create(name, alarmInfo) {
        createdAlarms[name] = alarmInfo;
      },
      clear(name) {
        delete createdAlarms[name];
        return true;
      }
    },
    action: { onClicked: events.action },
    offscreen: {
      async createDocument() {
        offscreenCreated = true;
      },
      async hasDocument() {
        return offscreenCreated;
      }
    }
  };

  const workerConsole = {
    info() {},
    log() {},
    warn() {},
    error(...args) {
      capturedErrors.push(args.map(String).join(" "));
    }
  };
  const source = fs.readFileSync(workerPath, "utf8");
  vm.runInNewContext(source, {
    chrome,
    console: workerConsole,
    Promise,
    setTimeout,
    clearTimeout
  });

  assert(events.installed.listeners.length === 1, "onInstalled listener is registered synchronously");
  assert(events.startup.listeners.length === 1, "onStartup listener is registered synchronously");
  assert(events.message.listeners.length === 1, "message router is registered synchronously");
  assert(events.alarm.listeners.length === 1, "alarm listener is registered synchronously");

  await waitFor(
    () => !!storage.values["ptpp.mv3.metadata"],
    "initial storage migration"
  );
  assert(
    storage.values["PT-Plugin-Plus-Config"],
    "legacy configuration remains after worker migration"
  );

  const sendBackgroundMessage = request =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`No response for ${request.type}`)),
        1000
      );
      const keepChannelOpen = events.message.listeners[0](
        request,
        { id: chrome.runtime.id },
        response => {
          clearTimeout(timer);
          resolve({ response, keepChannelOpen });
        }
      );
      assert(keepChannelOpen === true, `${request.type} keeps the response channel open`);
    });

  const status = await sendBackgroundMessage({ type: "ptpp.runtime.status" });
  assert(status.response.ok, "runtime status request succeeds");
  assert(status.response.data.schemaVersion === 1, "runtime status reports schema v1");

  const target = await sendBackgroundMessage({
    type: "ptpp.download-target.resolve",
    siteId: "audiences"
  });
  assert(target.response.ok, "download target request succeeds");
  assert(target.response.data.source === "site-profile", "site profile wins resolution");
  assert(target.response.data.downloaderId === "qb-runtime", "site downloader is resolved");
  assert(!target.response.data.requiresSelection, "single directory is direct-push safe");

  events.installed.emit({ reason: "install" });
  await waitFor(
    () => !!createdAlarms["ptpp.mv3.user-refresh"],
    "persistent user refresh alarm"
  );
  assert(
    createdAlarms["ptpp.mv3.user-refresh"].periodInMinutes === 360,
    "legacy refresh interval is converted to a persistent alarm"
  );

  events.alarm.emit({ name: "ptpp.mv3.user-refresh" });
  await waitFor(() => offscreenCreated, "offscreen document creation from alarm");
  assert(capturedErrors.length === 0, `worker emitted errors: ${capturedErrors.join("; ")}`);

  await verifyOffscreenBundle();
}

async function verifyOffscreenBundle() {
  const offscreenPath = path.join(__dirname, "../../dist/js/offscreen.js");
  assert(fs.existsSync(offscreenPath), "offscreen bundle must be built first");
  const messageEvent = new FakeEvent();
  let clipboardText = "";
  const chrome = {
    runtime: {
      onMessage: messageEvent
    }
  };
  class FakeDOMParser {
    parseFromString() {
      return {
        title: "Parsed Fixture",
        body: { textContent: "Fixture body" }
      };
    }
  }
  const navigator = {
    clipboard: {
      async writeText(text) {
        clipboardText = text;
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(offscreenPath, "utf8"), {
    chrome,
    console,
    DOMParser: FakeDOMParser,
    navigator,
    Promise
  });
  assert(
    messageEvent.listeners.length === 1,
    "offscreen message listener is registered synchronously"
  );

  const send = request =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`No offscreen response for ${request.type}`)),
        1000
      );
      const keepChannelOpen = messageEvent.listeners[0](
        request,
        { id: "fixture-extension-id" },
        response => {
          clearTimeout(timer);
          resolve(response);
        }
      );
      assert(keepChannelOpen === true, `${request.type} keeps the offscreen channel open`);
    });

  const ping = await send({ type: "ptpp.offscreen.ping" });
  assert(ping.ok && ping.data.alive, "offscreen ping succeeds");
  const parsed = await send({
    type: "ptpp.offscreen.parse-html",
    html: "<title>Fixture</title><body>Body</body>"
  });
  assert(parsed.ok && parsed.data.title === "Parsed Fixture", "offscreen DOM parsing succeeds");
  const clipboard = await send({
    type: "ptpp.offscreen.clipboard-write",
    text: "fixture clipboard"
  });
  assert(clipboard.ok && clipboardText === "fixture clipboard", "offscreen clipboard write succeeds");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
