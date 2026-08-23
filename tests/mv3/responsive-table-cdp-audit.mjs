const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const syntheticCount = Number(process.argv[3] ?? 29);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
  throw new Error(`Responsive table CDP audit failed: ${message}${suffix}`);
}

function colorAlpha(color) {
  if (!color) return 0;
  const slashAlpha = color.match(/\/\s*([\d.]+)\s*\)$/)?.[1];
  if (slashAlpha !== undefined) return Number(slashAlpha);
  const rgbaAlpha = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/)?.[1];
  return rgbaAlpha === undefined ? 1 : Number(rgbaAlpha);
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
        if (message.error) request.reject(new Error(`${this.label}: ${request.method}: ${message.error.message}`));
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
        reject(new Error(`${this.label}: ${method} timed out`));
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
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function configure(partial) {
  await evaluate(`chrome.storage.local.get("config").then(({ config }) => {
    Object.assign(config, ${JSON.stringify(partial)});
    config.tableBehavior.SearchEntity.itemsPerPage = 10;
    config.searchEntifyControl.showSocialInformation = false;
    config.searchEntifyControl.showTorrentTag = false;
    return chrome.storage.local.set({ config });
  }).then(() => true)`);
}

async function reload() {
  await session.call("Page.reload", { ignoreCache: true });
  await waitFor(`document.querySelector('#ptpp') && document.readyState === 'complete'`, "options application");
  await sleep(160);
}

async function setViewport(width, height) {
  await session.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(80);
}

async function setBrowserZoom(zoom) {
  await evaluate(`chrome.tabs.setZoom(${zoom}).then(() => true)`);
  await sleep(120);
}

async function navigate(route) {
  session.label = `route:${route}`;
  await evaluate(`location.hash = ${JSON.stringify(`#${route}`)}; true`);
  await waitFor(
    `location.hash.startsWith(${JSON.stringify(`#${route}`)}) && document.querySelector('#ptpp-main')`,
    route,
  );
  await waitFor(`document.querySelector('.ptpp-responsive-data-table')`, `${route} responsive table`);
  await waitFor(
    `[...document.querySelectorAll('.ptpp-responsive-data-table')].every((host) => {
      const scroller = host.querySelector('.v-table__wrapper');
      const top = host.querySelector('.ptpp-responsive-table-scrollbar');
      if (!scroller || !top) return false;
      const overflows = scroller.scrollWidth > scroller.clientWidth + 1;
      return (getComputedStyle(top).display !== 'none') === overflows;
    })`,
    `${route} stable table metrics`,
  );
  await sleep(40);
}

async function pageAndTables() {
  return evaluate(`(() => ({
    hash: location.hash,
    document: {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    },
    systemBars: document.querySelectorAll('.v-system-bar').length,
    tables: [...document.querySelectorAll('.ptpp-responsive-data-table')].map((host) => {
      const scroller = host.querySelector('.v-table__wrapper');
      const top = host.querySelector('.ptpp-responsive-table-scrollbar');
      const action = host.querySelector('th.ptpp-responsive-action-column,td.ptpp-responsive-action-column');
      const rect = (element) => element?.getBoundingClientRect().toJSON();
      return {
        scroller: rect(scroller),
        scrollWidth: scroller?.scrollWidth ?? 0,
        clientWidth: scroller?.clientWidth ?? 0,
        topDisplay: top ? getComputedStyle(top).display : '',
        topTabIndex: top?.getAttribute('tabindex'),
        action: rect(action),
        actionPosition: action ? getComputedStyle(action).position : '',
        actionBackground: action ? getComputedStyle(action).backgroundColor : '',
      };
    }),
  }))()`);
}

const originalState = await evaluate(`Promise.all([
  chrome.storage.local.get("config").then(({ config }) => config),
  Promise.resolve(sessionStorage.getItem("__ptd_runtime_store")),
]).then(([config, runtime]) => ({ config, runtime }))`);

const sites = ["u2", "audiences", "mteam", "skyeysnow", "hdsky"];
const now = Date.now();
const syntheticRows = Array.from({ length: syntheticCount }, (_, index) => {
  const site = sites[index % sites.length];
  return {
    id: `responsive-${index + 1}`,
    uniqueId: `${site}-responsive-${index + 1}`,
    solutionId: "default",
    solutionKey: `${site}|$|default`,
    site,
    title: `Responsive table regression item ${index + 1} with a deliberately long release title`,
    subTitle: "Synthetic isolated-profile row used only by the Chrome CDP audit",
    url: `https://example.invalid/torrent/${index + 1}`,
    link: `https://example.invalid/torrent/${index + 1}`,
    category: index % 2 ? "TV" : "Movie",
    size: 10_737_418_240 + index * 1_048_576,
    seeders: 100 + index,
    leechers: 10 + index,
    completed: 1000 + index,
    comments: index,
    time: now - index * 3_600_000,
    status: "unknown",
    tags: [{ name: index % 2 ? "Free" : "50%", color: index % 2 ? "blue" : "amber-darken-2" }],
  };
});

try {
  session.label = "baseline-configuration";
  await configure({ showReleaseNoteOnVersionChange: false, lang: "zh_CN", theme: "light", isNavBarOpen: true });
  await setViewport(1280, 720);
  await setBrowserZoom(1);
  await reload();
  session.label = "synthetic-search-injection";
  await evaluate(`(() => {
    const runtimeStore = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime');
    runtimeStore.search = {
      isSearching: false,
      startAt: ${now - 5_000},
      endAt: ${now},
      searchKey: "responsive-cdp-audit",
      searchPlanKey: "default",
      searchPlan: {},
      searchResult: ${JSON.stringify(syntheticRows.slice(0, 10))},
    };
    return true;
  })()`);
  await navigate("/search-entity");

  await waitFor(
    `document.querySelectorAll('#ptpp-search-entity-table tbody tr.v-data-table__tr').length >= 10`,
    "synthetic search rows",
  );
  for (let offset = 10; offset < syntheticRows.length; offset += 5) {
    const batch = syntheticRows.slice(offset, offset + 5);
    await evaluate(`(() => {
      const runtimeStore = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime');
      runtimeStore.search.searchResult.push(...${JSON.stringify(batch)});
      return runtimeStore.search.searchResult.length;
    })()`);
    await sleep(80);
  }
  await waitFor(
    `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime').search.searchResult.length === ${syntheticRows.length}`,
    "complete synthetic search result set",
  );
  await waitFor(
    `(() => {
    const table = document.querySelector('#ptpp-search-entity-table');
    const host = table?.closest('.ptpp-responsive-data-table');
    const scroller = table?.querySelector('.v-table__wrapper');
    const top = host?.querySelector('.ptpp-responsive-table-scrollbar');
    return scroller && top && scroller.scrollWidth > scroller.clientWidth + 1 && getComputedStyle(top).display !== 'none';
  })()`,
    "stable top scrollbar visibility",
  );
  const initial = await evaluate(`(() => {
    const table = document.querySelector('#ptpp-search-entity-table');
    const host = table.closest('.ptpp-responsive-data-table');
    const scroller = table.querySelector('.v-table__wrapper');
    const rows = [...document.querySelectorAll('#ptpp-search-entity-table tbody tr.v-data-table__tr')];
    const action = (row) => row.querySelector('td.ptpp-responsive-action-column');
    const secondary = rows[0]?.querySelector('td.ptpp-responsive-secondary-column');
    const top = host.querySelector('.ptpp-responsive-table-scrollbar');
    return {
      count: rows.length,
      scroller: scroller?.getBoundingClientRect().toJSON(),
      scrollWidth: scroller?.scrollWidth,
      clientWidth: scroller?.clientWidth,
      topDisplay: top ? getComputedStyle(top).display : '',
      normal: action(rows[0]) ? getComputedStyle(action(rows[0])).backgroundColor : '',
      stripe: action(rows[1]) ? getComputedStyle(action(rows[1])).backgroundColor : '',
      actionRect: action(rows[0])?.getBoundingClientRect().toJSON(),
      actionPosition: action(rows[0]) ? getComputedStyle(action(rows[0])).position : '',
      secondaryLeft: secondary?.getBoundingClientRect().left,
    };
  })()`);
  assert(initial.count >= 10, "synthetic rows did not render", initial);
  assert(initial.scrollWidth > initial.clientWidth + 1, "search table did not produce controlled overflow", initial);
  assert(initial.topDisplay !== "none", "top scrollbar is hidden while the search table overflows", initial);
  assert(initial.actionPosition === "sticky", "search action column is not sticky", initial);
  assert(
    Math.abs(initial.actionRect.right - initial.scroller.right) <= 2,
    "action column is not pinned to the right",
    initial,
  );
  assert(
    colorAlpha(initial.normal) === 1 && colorAlpha(initial.stripe) === 1,
    "normal or striped action cell is transparent",
    initial,
  );

  const hoverPoint = {
    x: (initial.actionRect.left + initial.actionRect.right) / 2,
    y: (initial.actionRect.top + initial.actionRect.bottom) / 2,
  };
  await session.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverPoint });
  await sleep(160);
  const hoverColor = await evaluate(
    `getComputedStyle(document.querySelector('#ptpp-search-entity-table tbody tr.v-data-table__tr td.ptpp-responsive-action-column')).backgroundColor`,
  );
  assert(colorAlpha(hoverColor) === 1, "hovered action cell is transparent", hoverColor);

  await evaluate(
    `document.querySelector('#ptpp-search-entity-table tbody tr.v-data-table__tr input[type="checkbox"]')?.click(); true`,
  );
  await waitFor(
    `document.querySelector('#ptpp-search-entity-table tbody tr.ptpp-selected-row')`,
    "selected search row",
  );
  await session.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverPoint });
  await sleep(120);
  const selectedStates = await evaluate(`(() => {
    const row = document.querySelector('#ptpp-search-entity-table tbody tr.ptpp-selected-row');
    const action = row?.querySelector('td.ptpp-responsive-action-column');
    return { selected: action ? getComputedStyle(action).backgroundColor : '', hovered: row?.matches(':hover') };
  })()`);
  assert(
    colorAlpha(selectedStates.selected) === 1,
    "selected/selected-hover action cell is transparent",
    selectedStates,
  );

  session.label = "scroll-synchronization";
  const scrollBefore = await evaluate(`(() => {
    const table = document.querySelector('#ptpp-search-entity-table');
    const scroller = table.querySelector('.v-table__wrapper');
    const action = table.querySelector('tbody td.ptpp-responsive-action-column');
    const secondary = table.querySelector('tbody td.ptpp-responsive-secondary-column');
    const before = { actionRight: action.getBoundingClientRect().right, secondaryLeft: secondary.getBoundingClientRect().left };
    scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
    scroller.dispatchEvent(new Event('scroll'));
    return before;
  })()`);
  await sleep(120);
  const scrollAfterNative = await evaluate(`(() => {
    const table = document.querySelector('#ptpp-search-entity-table');
    const host = table.closest('.ptpp-responsive-data-table');
    const scroller = table.querySelector('.v-table__wrapper');
    const top = host.querySelector('.ptpp-responsive-table-scrollbar');
    const action = table.querySelector('tbody td.ptpp-responsive-action-column');
    const secondary = table.querySelector('tbody td.ptpp-responsive-secondary-column');
    return {
      actionRight: action.getBoundingClientRect().right,
      secondaryLeft: secondary.getBoundingClientRect().left,
      tableLeft: scroller.scrollLeft,
      topLeft: top.scrollLeft,
    };
  })()`);
  await evaluate(`(() => {
    const host = document.querySelector('#ptpp-search-entity-table').closest('.ptpp-responsive-data-table');
    const top = host.querySelector('.ptpp-responsive-table-scrollbar');
    top.scrollLeft = 0;
    top.dispatchEvent(new Event('scroll'));
    return true;
  })()`);
  await sleep(120);
  const scrollAfterTop = await evaluate(`(() => {
    const host = document.querySelector('#ptpp-search-entity-table').closest('.ptpp-responsive-data-table');
    return {
      tableLeft: host.querySelector('.v-table__wrapper').scrollLeft,
      topLeft: host.querySelector('.ptpp-responsive-table-scrollbar').scrollLeft,
    };
  })()`);
  const scrollContract = { before: scrollBefore, afterNative: scrollAfterNative, afterTop: scrollAfterTop };
  assert(
    Math.abs(scrollContract.before.actionRight - scrollContract.afterNative.actionRight) <= 2,
    "action column moved with secondary columns",
    scrollContract,
  );
  assert(
    Math.abs(scrollContract.before.secondaryLeft - scrollContract.afterNative.secondaryLeft) > 20,
    "secondary columns did not scroll",
    scrollContract,
  );
  assert(
    scrollContract.afterNative.tableLeft === scrollContract.afterNative.topLeft,
    "native scroll did not synchronize upward",
    scrollContract,
  );
  assert(
    scrollContract.afterTop.tableLeft === 0 && scrollContract.afterTop.topLeft === 0,
    "top scroll did not synchronize downward",
    scrollContract,
  );

  const hitTargets = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('#ptpp-search-entity-table tbody tr:first-child td.ptpp-responsive-action-column button')];
    return buttons.slice(0, 5).map((button) => {
      const rect = button.getBoundingClientRect();
      const x = (rect.left + rect.right) / 2;
      const y = (rect.top + rect.bottom) / 2;
      const stack = document.elementsFromPoint(x, y);
      const buttonIndex = stack.findIndex((element) => element === button || button.contains(element));
      const actionIndex = stack.findIndex((element) => element.classList?.contains('ptpp-responsive-action-column'));
      const secondaryIndex = stack.findIndex((element) => element.classList?.contains('ptpp-responsive-secondary-column'));
      return { buttonIndex, actionIndex, secondaryIndex, title: button.title, rect: rect.toJSON() };
    });
  })()`);
  assert(hitTargets.length >= 3, "search row did not expose its expected action buttons", hitTargets);
  for (const target of hitTargets) {
    assert(target.buttonIndex >= 0 && target.actionIndex >= 0, "an action button is not the pointer target", target);
    assert(
      target.secondaryIndex < 0 || target.actionIndex < target.secondaryIndex,
      "secondary content pierced the action layer",
      target,
    );
  }

  session.label = "full-route-matrix";
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
  const matrix = [];
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1536, height: 864 },
    { width: 1920, height: 1080 },
  ]) {
    for (const zoom of [0.8, 1, 1.25]) {
      for (const isNavBarOpen of [true, false]) {
        for (const appearance of [
          { theme: "light", lang: "zh_CN" },
          { theme: "dark", lang: "en" },
        ]) {
          session.label = `matrix:${viewport.width}x${viewport.height}:${zoom}:${isNavBarOpen}:${appearance.theme}:${appearance.lang}`;
          await configure({ ...appearance, isNavBarOpen });
          await setViewport(viewport.width, viewport.height);
          await setBrowserZoom(zoom);
          await reload();
          for (const route of tableRoutes) {
            await navigate(route);
            const result = await pageAndTables();
            assert(result.systemBars === 0, "browser zoom rendered an application warning bar", {
              viewport,
              zoom,
              route,
              result,
            });
            assert(
              result.document.scrollWidth <= result.document.clientWidth + 1,
              "route caused document-level horizontal overflow",
              { viewport, zoom, route, result },
            );
            assert(result.tables.length > 0, "route did not render the shared table", {
              viewport,
              zoom,
              route,
              result,
            });
            for (const table of result.tables) {
              const overflows = table.scrollWidth > table.clientWidth + 1;
              assert(
                (table.topDisplay !== "none") === overflows,
                "top scrollbar visibility does not match actual overflow",
                { viewport, zoom, route, table },
              );
              if (overflows)
                assert(table.topTabIndex === "0", "top scrollbar is not keyboard focusable", { route, table });
              if (table.action) {
                assert(table.actionPosition === "sticky", "action header is not sticky", { route, table });
                assert(colorAlpha(table.actionBackground) === 1, "action header is transparent", { route, table });
                assert(table.action.right <= table.scroller.right + 2, "action header escaped the table viewport", {
                  route,
                  table,
                });
              }
            }
          }
          matrix.push({ ...viewport, zoom, isNavBarOpen, ...appearance });
          console.log(JSON.stringify({ matrixCase: matrix.at(-1), routes: tableRoutes.length }));
        }
      }
    }
  }

  await configure({ lang: "zh_CN", theme: "light", isNavBarOpen: true });
  await setViewport(1280, 720);
  await setBrowserZoom(1);
  await reload();
  await evaluate(`location.hash = '#/download-history'; true`);
  await waitFor(`location.hash === '#/download-history'`, "download history before settings navigation");
  const settingsResult = await evaluate(`new Promise((resolve) => {
    const clickSettings = () => document.querySelector('a[href="#/set-base"]')?.click();
    const samples = [];
    const record = () => samples.push({
      hash: location.hash,
      selected: document.querySelector('.ptpp-settings-shell .v-tab--selected')?.textContent.trim(),
      contentText: document.querySelector('.settings-content')?.textContent.trim().length ?? 0,
      saveVisible: !!document.querySelector('.settings-save-bar'),
    });
    const next = (index) => {
      if (index === 3) {
        const activeTab = document.querySelector('.ptpp-settings-shell .v-tab--selected');
        activeTab?.click();
        activeTab?.click();
        return setTimeout(() => { record(); resolve(samples); }, 180);
      }
      clickSettings();
      setTimeout(() => { record(); next(index + 1); }, 180);
    };
    next(0);
  })`);
  assert(settingsResult.length === 4, "settings repeat-click audit did not finish", settingsResult);
  for (const sample of settingsResult) {
    assert(sample.hash === "#/set-base", "settings click left the default child route", sample);
    assert(sample.selected?.includes("界面与交互"), "default settings tab is not selected", sample);
    assert(sample.contentText > 0, "settings content became blank", sample);
    assert(sample.saveVisible, "settings save bar disappeared", sample);
  }

  assert(session.runtimeErrors.length === 0, "runtime errors were captured", session.runtimeErrors);
  assert(
    session.externalNetworkWarnings.length === 0,
    "external network warnings were captured",
    session.externalNetworkWarnings,
  );
  console.log(
    JSON.stringify({
      result: "passed",
      extensionId: optionsTarget.url.split("/")[2],
      syntheticRows: syntheticRows.length,
      matrixCases: matrix.length,
      routeChecks: matrix.length * tableRoutes.length,
      runtimeErrors: session.runtimeErrors.length,
      externalNetworkWarnings: session.externalNetworkWarnings.length,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ runtimeErrors: session.runtimeErrors, externalNetworkWarnings: session.externalNetworkWarnings }),
  );
  throw error;
} finally {
  session.label = "restore-isolated-profile";
  await evaluate(`Promise.all([
    chrome.storage.local.set({ config: ${JSON.stringify(originalState.config)} }),
    Promise.resolve().then(() => {
      const runtime = ${JSON.stringify(originalState.runtime)};
      const runtimeStore = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime');
      if (runtime === null) {
        runtimeStore.$reset();
        sessionStorage.removeItem("__ptd_runtime_store");
      } else {
        runtimeStore.$patch(JSON.parse(runtime));
        sessionStorage.setItem("__ptd_runtime_store", runtime);
      }
    }),
  ]).then(() => true)`);
  await setBrowserZoom(1);
  await setViewport(1280, 720);
  await reload();
  session.close();
}
