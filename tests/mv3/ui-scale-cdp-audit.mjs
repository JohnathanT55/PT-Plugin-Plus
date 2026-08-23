const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
  throw new Error(`UI scale CDP audit failed: ${message}${suffix}`);
}

class CdpSession {
  constructor(webSocketDebuggerUrl) {
    this.socket = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.runtimeErrors = [];
    this.externalNetworkWarnings = [];
    this.label = "startup";
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
        else request.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        this.runtimeErrors.push({
          label: this.label,
          type: "exception",
          text: details.exception?.description ?? details.text,
          url: details.url,
          lineNumber: details.lineNumber,
        });
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        const error = { label: this.label, type: "log", source: entry.source, text: entry.text, url: entry.url };
        if (entry.source === "network" && entry.url && !entry.url.startsWith("chrome-extension://")) {
          this.externalNetworkWarnings.push(error);
        } else {
          this.runtimeErrors.push(error);
        }
      }
    });
    return this;
  }

  call(method, params = {}, timeout = 20_000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const optionsTarget = targets.find(
  (target) =>
    target.type === "page" &&
    target.url.startsWith("chrome-extension://") &&
    target.url.includes("/src/entries/options/index.html"),
);
assert(optionsTarget?.webSocketDebuggerUrl, `no PT-Plugin-Plus options target at ${endpoint}`);

const session = await new CdpSession(optionsTarget.webSocketDebuggerUrl).open();
await session.call("Page.bringToFront");
await session.call("Runtime.enable");
await session.call("Log.enable");

async function evaluate(expression) {
  const result = await session.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function configure(partial) {
  await evaluate(`chrome.storage.local.get("config").then(({ config }) => {
    Object.assign(config, ${JSON.stringify(partial)});
    return chrome.storage.local.set({ config });
  }).then(() => true)`);
}

async function reload() {
  await session.call("Page.reload", { ignoreCache: true });
  await waitFor(`document.querySelector('#ptpp') && document.readyState === 'complete'`, "options application");
  await sleep(350);
}

async function setViewport(width, height, deviceScaleFactor = 1) {
  await session.call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
  });
  await sleep(200);
}

async function navigate(route) {
  session.label = `route:${route}`;
  await evaluate(`location.hash = ${JSON.stringify(`#${route}`)}; true`);
  await waitFor(`location.hash === ${JSON.stringify(`#${route}`)} && document.querySelector('#ptpp-main')`, route);
  await sleep(500);
}

async function pageGeometry() {
  return evaluate(`(() => {
    const rect = (element) => element?.getBoundingClientRect().toJSON();
    const app = document.querySelector('#ptpp');
    const topbar = document.querySelector('#ptpp-topbar');
    const navigation = document.querySelector('#ptpp-navigation');
    return {
      hash: location.hash,
      appStyle: app?.getAttribute('style') ?? '',
      app: rect(app),
      topbar: rect(topbar),
      navigation: rect(navigation),
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      dpr: window.devicePixelRatio,
      scaleText: [...document.querySelectorAll('button[aria-label="调整界面缩放"],button[aria-label="Adjust interface scale"]')][0]?.textContent.trim(),
      systemBars: document.querySelectorAll('.v-system-bar').length,
    };
  })()`);
}

async function tableGeometry() {
  return evaluate(`(() => {
    const wrappers = [...document.querySelectorAll('.ptpp-responsive-data-table')];
    return wrappers.map((wrapper) => {
      const scroller = wrapper.querySelector('.v-table__wrapper');
      const top = wrapper.querySelector('.ptpp-responsive-table-scrollbar');
      const action = wrapper.querySelector('.ptpp-responsive-action-column');
      const rect = (element) => element?.getBoundingClientRect().toJSON();
      return {
        scroller: rect(scroller),
        scrollWidth: scroller?.scrollWidth ?? 0,
        clientWidth: scroller?.clientWidth ?? 0,
        top: rect(top),
        topDisplay: top ? getComputedStyle(top).display : '',
        topTabIndex: top?.getAttribute('tabindex'),
        action: rect(action),
        actionPosition: action ? getComputedStyle(action).position : '',
      };
    });
  })()`);
}

await configure({ showReleaseNoteOnVersionChange: false, uiScale: 100, lang: "zh_CN", theme: "light" });
await setViewport(1280, 720, 1.5);
await reload();

// Exercise every supported step through the actual UI while the menu remains open.
session.label = "interactive-scale-control";
const interactive = await evaluate(`new Promise((resolve) => {
  const button = document.querySelector('button[aria-label="调整界面缩放"]');
  const before = { hash: location.hash, selected: document.querySelectorAll('[aria-selected="true"]').length };
  button.click();
  const samples = [];
  const click = (title) => document.querySelector('button[title="' + title + '"]')?.click();
  const record = () => {
    const overlay = document.getElementById(button.getAttribute('aria-controls'))?.querySelector('.v-overlay__content');
    const child = overlay?.firstElementChild;
    const a = button.getBoundingClientRect();
    const o = overlay?.getBoundingClientRect();
    samples.push({
      value: button.textContent.trim(),
      hash: location.hash,
      selected: document.querySelectorAll('[aria-selected="true"]').length,
      appStyle: document.querySelector('#ptpp').getAttribute('style') ?? '',
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      anchorRight: a.right,
      overlayRight: o?.right,
      anchorBottom: a.bottom,
      overlayTop: o?.top,
      childZoom: child ? getComputedStyle(child).zoom : '',
    });
  };
  const actions = [
    ['缩小界面', 90], ['缩小界面', 80], ['放大界面', 90], ['放大界面', 100],
    ['放大界面', 110], ['放大界面', 125],
  ];
  const next = (index) => {
    if (index >= actions.length) {
      record();
      document.querySelector('.ptpp-ui-scale-menu button:not([title])')?.click();
      return setTimeout(() => resolve({ before, after: { hash: location.hash, selected: document.querySelectorAll('[aria-selected="true"]').length }, samples }), 350);
    }
    click(actions[index][0]);
    setTimeout(() => { record(); next(index + 1); }, 180);
  };
  setTimeout(() => { record(); next(0); }, 180);
})`);

const expectedScaleSamples = ["100%", "90%", "80%", "90%", "100%", "110%", "125%", "125%"];
assert(
  JSON.stringify(interactive.samples.map((sample) => sample.value)) === JSON.stringify(expectedScaleSamples),
  "UI controls did not visit all supported scale steps",
  interactive,
);
assert(interactive.before.hash === interactive.after.hash, "changing scale changed the current route", interactive);
assert(interactive.before.selected === interactive.after.selected, "changing scale cleared table selection", interactive);
for (const sample of interactive.samples) {
  assert(!sample.overflowX, `${sample.value} caused document horizontal overflow`, sample);
  assert(Math.abs(sample.anchorRight - sample.overlayRight) <= 2, `${sample.value} menu right edge drifted`, sample);
  assert(Math.abs(sample.anchorBottom - sample.overlayTop) <= 2, `${sample.value} menu top drifted`, sample);
}

// Reset through the menu and verify persistence without an inline zoom:1 formatting context.
await evaluate(`(() => {
  const menu = document.querySelector('.ptpp-ui-scale-menu');
  const reset = menu && [...menu.querySelectorAll('button')].find((item) => /恢复 100%|Reset to 100%/.test(item.textContent));
  reset?.click();
  return true;
})()`);
await sleep(250);
let geometry = await pageGeometry();
assert(geometry.scaleText === "100%", "reset did not restore 100%", geometry);
assert(geometry.appStyle === "", "100% must not leave a CSS zoom formatting context", geometry);
await reload();
geometry = await pageGeometry();
assert(geometry.scaleText === "100%" && geometry.appStyle === "", "100% did not persist across reload", geometry);

// Every active product table must use the shared wrapper and remain document-overflow free.
const tableRoutes = [
  "/search-entity",
  "/download-history",
  "/my-collection",
  "/keep-upload-task",
  "/my-data",
  "/search-result-snapshot",
  "/set-downloader",
  "/set-site",
  "/set-download-paths",
  "/set-search-solution",
  "/set-backup",
  "/logger",
];

for (const route of tableRoutes) {
  await navigate(route);
  const page = await pageGeometry();
  const tables = await tableGeometry();
  assert(tables.length > 0, `${route} did not render the shared responsive table`, { page, tables });
  assert(page.scrollWidth <= page.clientWidth + 1, `${route} caused document horizontal overflow`, page);
  for (const table of tables) {
    if (table.scrollWidth > table.clientWidth + 1) {
      assert(table.topDisplay !== "none", `${route} hid its top scrollbar while overflowing`, table);
      assert(table.topTabIndex === "0", `${route} top scrollbar is not keyboard focusable`, table);
    }
    if (table.action) {
      assert(table.actionPosition === "sticky", `${route} action column is not sticky`, table);
      assert(table.action.right <= table.scroller.right + 2, `${route} action column escaped the table viewport`, table);
    }
  }
  console.log(JSON.stringify({ route, page, tables }));
}

// Prove the synchronized scrollbar contract on the first naturally overflowing table.
await navigate("/set-site");
const synchronization = await evaluate(`new Promise((resolve) => {
  const host = [...document.querySelectorAll('.ptpp-responsive-data-table')]
    .find((item) => {
      const scroller = item.querySelector('.v-table__wrapper');
      return scroller && scroller.scrollWidth > scroller.clientWidth + 1;
    });
  if (!host) return resolve({ available: false });
  const top = host.querySelector('.ptpp-responsive-table-scrollbar');
  const table = host.querySelector('.v-table__wrapper');
  top.scrollLeft = Math.min(240, table.scrollWidth - table.clientWidth);
  top.dispatchEvent(new Event('scroll'));
  setTimeout(() => {
    const fromTop = { top: top.scrollLeft, table: table.scrollLeft };
    table.scrollLeft = 0;
    table.dispatchEvent(new Event('scroll'));
    setTimeout(() => resolve({ available: true, fromTop, fromTable: { top: top.scrollLeft, table: table.scrollLeft } }), 80);
  }, 80);
})`);
assert(synchronization.available, "no overflowing table was available for synchronization test", synchronization);
assert(synchronization.fromTop.top === synchronization.fromTop.table, "top scrollbar did not drive table", synchronization);
assert(synchronization.fromTable.top === 0 && synchronization.fromTable.table === 0, "table did not drive top scrollbar", synchronization);

// Representative viewport/internal-scale matrix.
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
]) {
  for (const uiScale of [80, 100, 125]) {
    session.label = `viewport:${viewport.width}x${viewport.height}:ui:${uiScale}`;
    await configure({ uiScale });
    await setViewport(viewport.width, viewport.height, 1);
    await reload();
    const page = await pageGeometry();
    assert(page.scaleText === `${uiScale}%`, "stored scale did not render", { viewport, uiScale, page });
    assert(page.scrollWidth <= page.clientWidth + 1, "viewport/scale matrix overflowed horizontally", {
      viewport,
      uiScale,
      page,
    });
    assert(Math.abs(page.topbar.height - 64 * (uiScale / 100)) <= 1.5, "top bar scale is incorrect", {
      viewport,
      uiScale,
      page,
    });
    assert(page.app.bottom >= page.clientHeight - 1, "scaled app no longer covers the viewport", {
      viewport,
      uiScale,
      page,
    });
    console.log(JSON.stringify({ viewport, uiScale, page }));
  }
}

// Dialogs use the same scale around their viewport center without changing form state.
for (const uiScale of [80, 125]) {
  session.label = `dialog-scale:${uiScale}`;
  await configure({ uiScale, lang: "zh_CN", theme: "light" });
  await setViewport(1280, 720, 1);
  await reload();
  await navigate("/set-site");
  const dialog = await evaluate(`new Promise((resolve) => {
    const add = [...document.querySelectorAll('button')].find((item) => item.title === '增加');
    add?.click();
    setTimeout(() => {
      const overlay = document.querySelector('.v-dialog.v-overlay--active .v-overlay__content');
      const child = overlay?.firstElementChild;
      const rect = overlay?.getBoundingClientRect();
      resolve({
        found: !!overlay,
        rect: rect?.toJSON(),
        scale: overlay ? getComputedStyle(overlay).scale : '',
        childZoom: child ? getComputedStyle(child).zoom : '',
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      });
    }, 350);
  })`);
  assert(dialog.found, "site add dialog did not open", { uiScale, dialog });
  assert(dialog.scale === String(uiScale / 100), "dialog did not inherit the internal scale", { uiScale, dialog });
  assert(
    Math.abs((dialog.rect.left + dialog.rect.right) / 2 - dialog.viewport.width / 2) <= 3,
    "scaled dialog is not horizontally centered",
    { uiScale, dialog },
  );
  assert(
    Math.abs((dialog.rect.top + dialog.rect.bottom) / 2 - dialog.viewport.height / 2) <= 3,
    "scaled dialog is not vertically centered",
    { uiScale, dialog },
  );
  await evaluate(`(() => {
    const dialog = document.querySelector('.v-dialog.v-overlay--active');
    const cancel = dialog && [...dialog.querySelectorAll('button')].find((item) => /取消|Cancel/.test(item.textContent));
    cancel?.click();
    return true;
  })()`);
  await sleep(200);
}

// Browser zoom and Windows-like DPR are observed, never overwritten or misreported as a warning.
await configure({ uiScale: 100 });
await setViewport(1536, 864, 1.5);
await reload();
for (const browserZoom of [0.8, 1, 1.25]) {
  session.label = `browser-zoom:${browserZoom}`;
  await evaluate(`chrome.tabs.setZoom(${browserZoom}).then(() => true)`);
  await sleep(350);
  const page = await pageGeometry();
  assert(page.systemBars === 0, "DPR/browser zoom produced the removed warning bar", { browserZoom, page });
  assert(page.scrollWidth <= page.clientWidth + 1, "browser zoom produced document horizontal overflow", {
    browserZoom,
    page,
  });
}
await evaluate(`chrome.tabs.setZoom(1).then(() => true)`);

// Theme and locale must not change scale/table geometry or fixed-action contrast.
for (const appearance of [
  { theme: "light", lang: "zh_CN", marker: "站点设置" },
  { theme: "dark", lang: "en", marker: "One-Click Import Sites" },
]) {
  session.label = `appearance:${appearance.theme}:${appearance.lang}`;
  await configure({ ...appearance, uiScale: 90 });
  await setViewport(1280, 720, 1);
  await reload();
  await navigate("/set-site");
  const result = await evaluate(`(() => {
    const action = document.querySelector('.ptpp-responsive-action-column');
    return {
      themeClass: document.querySelector('#ptpp')?.className,
      markerVisible: document.body.innerText.includes(${JSON.stringify(appearance.marker)}),
      actionBackground: action ? getComputedStyle(action).backgroundColor : '',
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`);
  assert(result.themeClass.includes(`v-theme--${appearance.theme}`), "theme did not apply", { appearance, result });
  assert(result.markerVisible, "locale did not apply", { appearance, result });
  assert(result.actionBackground && result.actionBackground !== "rgba(0, 0, 0, 0)", "action column is transparent", {
    appearance,
    result,
  });
  assert(!result.overflowX, "appearance matrix overflowed horizontally", { appearance, result });
}

await configure({ uiScale: 100, theme: "light", lang: "zh_CN" });
await setViewport(1280, 720, 1);
await reload();
await navigate("/set-base");

session.close();
assert(session.runtimeErrors.length === 0, "runtime errors were captured", session.runtimeErrors);
console.log(
  JSON.stringify({
    result: "passed",
    extensionId: optionsTarget.url.split("/")[2],
    runtimeErrors: session.runtimeErrors.length,
    externalNetworkWarnings: session.externalNetworkWarnings.length,
  }),
);
