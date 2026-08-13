const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const expectedSites = [
  {
    name: "Azusa",
    home: "https://azusa.wiki/",
    list: "https://azusa.wiki/torrents.php",
  },
  {
    name: "Audiences",
    home: "https://audiences.me/",
    list: "https://audiences.me/torrents.php",
  },
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`Toolbar CDP audit failed: ${message}${suffix}`);
  }
}

class CdpSession {
  constructor(webSocketDebuggerUrl) {
    this.socket = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 0;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
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

function attributesOf(node) {
  const attributes = {};
  for (let index = 0; index < (node.attributes?.length ?? 0); index += 2) {
    attributes[node.attributes[index]] = node.attributes[index + 1];
  }
  return attributes;
}

function hasClass(node, className) {
  return String(attributesOf(node).class ?? "")
    .split(/\s+/)
    .includes(className);
}

function rectFromModel(model) {
  const quad = model.border;
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { x: left, y: top, left, right, top, bottom, width: right - left, height: bottom - top };
}

async function evaluate(session, expression) {
  const result = await session.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(callback, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
}

async function flattenedNodes(session) {
  const { nodes } = await session.call("DOM.getFlattenedDocument", { depth: -1, pierce: true });
  return nodes;
}

async function findNode(session, predicate) {
  return (await flattenedNodes(session)).find(predicate);
}

async function nodeRect(session, node) {
  const { model } = await session.call("DOM.getBoxModel", { backendNodeId: node.backendNodeId });
  return rectFromModel(model);
}

async function measureToolbar(session) {
  return waitFor(async () => {
    const toolbar = await findNode(session, (node) => hasClass(node, "ptpp-toolbar"));
    if (!toolbar) return undefined;
    const rect = await nodeRect(session, toolbar);
    const viewport = await evaluate(
      session,
      `({ width: visualViewport?.width || innerWidth || document.documentElement.clientWidth, height: visualViewport?.height || innerHeight || document.documentElement.clientHeight, url: location.href, title: document.title })`,
    );
    const attributes = attributesOf(toolbar);
    // The closed shadow tree appears before its external stylesheet and Pinia
    // hydration finish. Do not mistake that transient full-width, off-screen
    // node for the final toolbar geometry.
    if (
      attributes.style?.includes("-100px") ||
      rect.width > 200 ||
      rect.height <= 0 ||
      rect.top < 0 ||
      rect.top >= viewport.height
    ) {
      return undefined;
    }
    return { node: toolbar, rect, viewport, attributes };
  }, "content toolbar");
}

async function assertDock(session, side, label, expectedOffset = 16) {
  const measurement = await measureToolbar(session);
  const actualSide = measurement.attributes["data-dock-side"];
  const edgeDistance = side === "right" ? measurement.viewport.width - measurement.rect.right : measurement.rect.left;
  const center = measurement.rect.left + measurement.rect.width / 2;
  const inSelectedHalf =
    side === "right" ? center >= measurement.viewport.width / 2 : center <= measurement.viewport.width / 2;
  assert(actualSide === side, `${label} reports ${side} docking`, measurement);
  assert(inSelectedHalf, `${label} remains in the selected viewport half`, measurement);
  assert(Math.abs(edgeDistance - expectedOffset) <= 3, `${label} stays ${expectedOffset}px from the ${side} edge`, {
    edgeDistance,
    measurement,
  });
  console.log(
    JSON.stringify({ check: label, side, edgeDistance, rect: measurement.rect, viewport: measurement.viewport }),
  );
  return measurement;
}

async function navigate(session, url) {
  await session.call("Page.navigate", { url });
  await waitFor(
    () =>
      evaluate(
        session,
        `document.readyState === "complete" && location.href.startsWith(${JSON.stringify(new URL(url).origin)}) ? location.href : ""`,
      ),
    `navigation to ${url}`,
    30_000,
  );
  await sleep(500);
}

async function firstDetailUrl(session) {
  return waitFor(
    () =>
      evaluate(
        session,
        `(() => { const link = [...document.querySelectorAll('a[href*="details.php?id="]')].find((item) => new URL(item.getAttribute("href"), location.href).pathname.endsWith("/details.php")); return link ? new URL(link.getAttribute("href"), location.href).href : ""; })()`,
      ),
    "a torrent detail link",
    20_000,
  );
}

async function clickShadowNode(session, node) {
  const { object } = await session.call("DOM.resolveNode", { backendNodeId: node.backendNodeId });
  assert(object.objectId, "shadow node can be resolved");
  await session.call("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: "function () { this.click(); }",
  });
  await session.call("Runtime.releaseObject", { objectId: object.objectId });
}

async function openDownloadMenuAndAssertDirection(session, side, label) {
  const button = await waitFor(async () => {
    const nodes = await flattenedNodes(session);
    return nodes.find((node) => {
      if (node.nodeName !== "BUTTON") return false;
      const attributes = attributesOf(node);
      const title = attributes.title ?? attributes["aria-label"] ?? "";
      return /推送到|下载到|Push to|Download to/i.test(title) && !/默认|default/i.test(title) && !attributes.disabled;
    });
  }, `${label} manual push button`);
  await clickShadowNode(session, button);
  const menu = await waitFor(
    () => findNode(session, (node) => hasClass(node, "ptpp-download-target-menu")),
    `${label} download target menu`,
  );
  const toolbar = await measureToolbar(session);
  const menuRect = await nodeRect(session, menu);
  const pointsInward =
    side === "right" ? menuRect.right <= toolbar.rect.left + 2 : menuRect.left >= toolbar.rect.right - 2;
  assert(pointsInward, `${label} menu expands inward from the ${side}`, { toolbar: toolbar.rect, menu: menuRect });
  console.log(JSON.stringify({ check: `${label} menu`, side, toolbar: toolbar.rect, menu: menuRect }));
  await clickShadowNode(session, button);
}

async function doubleClickResetAndAssert(session, side, label) {
  const dragHandle = await waitFor(
    () => findNode(session, (node) => hasClass(node, "ptpp-toolbar-drag-handle")),
    `${label} drag handle`,
  );
  const { object } = await session.call("DOM.resolveNode", { backendNodeId: dragHandle.backendNodeId });
  await session.call("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration:
      "function () { this.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true })); }",
  });
  await session.call("Runtime.releaseObject", { objectId: object.objectId });
  await sleep(400);
  const measurement = await assertDock(session, side, `${label} after double-click reset`);
  const availableHeight = measurement.viewport.height - measurement.rect.height;
  assert(
    Math.abs(measurement.rect.top - availableHeight / 2) <= 3,
    `${label} resets to the vertical midpoint`,
    measurement,
  );
}

async function setDockThroughOptions(optionsSession, side) {
  await optionsSession.call("Page.bringToFront");
  await evaluate(
    optionsSession,
    `location.hash = "#/set-base/toolbar"; new Promise((resolve) => setTimeout(resolve, 900))`,
  );
  const settingsState = await evaluate(
    optionsSession,
    `(() => ({
      tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim()),
      radios: [...document.querySelectorAll('input[type="radio"]')].map((radio) => ({ value: radio.value, disabled: radio.disabled, checked: radio.checked })),
      text: document.body.innerText
    }))()`,
  );
  assert(settingsState.tabs.length === 7, "general settings expose exactly seven tabs", settingsState.tabs);
  assert(
    settingsState.radios.some((radio) => radio.value === "left") &&
      settingsState.radios.some((radio) => radio.value === "right"),
    "toolbar settings visibly expose left and right radio controls",
    settingsState.radios,
  );
  assert(
    /站点工具栏|Site toolbar/i.test(settingsState.text) && /全局停靠位置|Global dock side/i.test(settingsState.text),
    "toolbar settings use visible PTPP product labels",
  );
  const clickResult = await evaluate(
    optionsSession,
    `(() => {
      const radio = [...document.querySelectorAll('input[type="radio"]')].find((input) => input.value === ${JSON.stringify(side)});
      if (!radio || radio.disabled) return { ok: false, reason: "radio missing or disabled" };
      radio.click();
      const save = [...document.querySelectorAll('button')].find((button) => /保存|Save/i.test(button.textContent));
      if (!save) return { ok: false, reason: "save button missing" };
      save.click();
      return { ok: true };
    })()`,
  );
  assert(clickResult.ok, `settings can save ${side} docking`, clickResult);
  await waitFor(
    () =>
      evaluate(
        optionsSession,
        `chrome.storage.local.get("config").then(({ config }) => config?.contentScript?.dockSide === ${JSON.stringify(side)})`,
      ),
    `${side} docking to persist`,
  );
  console.log(JSON.stringify({ check: "settings dock selection", side, tabs: settingsState.tabs }));
}

async function restoreDefaultPlacement(optionsSession) {
  await evaluate(
    optionsSession,
    `chrome.storage.local.get("config").then(({ config }) => {
      config.contentScript.toolbarPositionVersion = 2;
      config.contentScript.enabled = true;
      config.contentScript.dockSide = "right";
      config.contentScript.edgeOffset = 16;
      config.contentScript.verticalRatio = 0.5;
      return chrome.storage.local.set({ config });
    })`,
  );
  await sleep(300);
}

const initialTargets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const optionsTarget = initialTargets.find(
  (target) =>
    target.type === "page" &&
    target.url.startsWith("chrome-extension://") &&
    target.url.includes("/src/entries/options/index.html"),
);
assert(optionsTarget?.webSocketDebuggerUrl, `an options target exists at ${endpoint}`);

const browserVersion = await fetch(`${endpoint}/json/version`).then((response) => response.json());
const browserSession = await new CdpSession(browserVersion.webSocketDebuggerUrl).open();
const optionsSession = await new CdpSession(optionsTarget.webSocketDebuggerUrl).open();
const createdTargetIds = [];
const siteSessions = [];

try {
  await optionsSession.call("Runtime.enable");
  await optionsSession.call("Page.enable");
  await setDockThroughOptions(optionsSession, "right");
  await restoreDefaultPlacement(optionsSession);

  for (const site of expectedSites) {
    const { targetId } = await browserSession.call("Target.createTarget", { url: site.home, background: true });
    createdTargetIds.push(targetId);
    const target = await waitFor(async () => {
      const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
      return targets.find((item) => item.id === targetId && item.webSocketDebuggerUrl);
    }, `${site.name} target`);
    const session = await new CdpSession(target.webSocketDebuggerUrl).open();
    siteSessions.push(session);
    await session.call("Runtime.enable");
    await session.call("Page.enable");
    await session.call("DOM.enable");

    // The target was created in the background. Bringing it forward must
    // recover the first real viewport and place the toolbar on the saved side.
    await session.call("Page.bringToFront");
    await assertDock(session, "right", `${site.name} background home`);

    await navigate(session, site.list);
    await assertDock(session, "right", `${site.name} torrent list`);
    const detailUrl = await firstDetailUrl(session);
    await navigate(session, detailUrl);
    await assertDock(session, "right", `${site.name} torrent detail`);

    if (site === expectedSites[0]) {
      await openDownloadMenuAndAssertDirection(session, "right", `${site.name} detail`);
      await doubleClickResetAndAssert(session, "right", `${site.name} detail`);

      // Reproduce the historical wide-to-narrow failure. A huge saved offset
      // must stay in the configured half, then return to the normal edge after
      // the real viewport is restored and the position is reset.
      await evaluate(
        optionsSession,
        `chrome.storage.local.get("config").then(({ config }) => { config.contentScript.edgeOffset = 1600; return chrome.storage.local.set({ config }); })`,
      );
      await session.call("Emulation.setDeviceMetricsOverride", {
        width: 640,
        height: 700,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const narrow = await measureToolbar(session);
      const narrowCenter = narrow.rect.left + narrow.rect.width / 2;
      assert(
        narrowCenter >= narrow.viewport.width / 2 - 2,
        `${site.name} oversized right offset stays in the right half`,
        narrow,
      );
      await doubleClickResetAndAssert(session, "right", `${site.name} narrow viewport`);
      await session.call("Emulation.clearDeviceMetricsOverride");
      await sleep(400);
      await assertDock(session, "right", `${site.name} restored viewport`);
    }
  }

  await setDockThroughOptions(optionsSession, "left");
  for (const [index, session] of siteSessions.entries()) {
    await assertDock(session, "left", `${expectedSites[index].name} open detail after settings sync`);
  }
  await openDownloadMenuAndAssertDirection(siteSessions[0], "left", `${expectedSites[0].name} left detail`);
  await doubleClickResetAndAssert(siteSessions[0], "left", `${expectedSites[0].name} left detail`);

  // Leave the isolated profile in the product default state and prove all
  // already-open tracker pages update without a refresh.
  await setDockThroughOptions(optionsSession, "right");
  for (const [index, session] of siteSessions.entries()) {
    await assertDock(session, "right", `${expectedSites[index].name} open detail restored to default`);
  }

  // A legacy backup may carry an absolute X coordinate on the left. Close the
  // already-open tracker contexts before downgrading the shared config: only
  // one content script should own this one-time migration. Otherwise every
  // open page legitimately observes version 0 and races to persist its own
  // viewport-derived result, which tests storage contention instead of the
  // migration contract.
  for (const session of siteSessions.splice(0)) session.close();
  for (const targetId of createdTargetIds.splice(0)) {
    await browserSession.call("Target.closeTarget", { targetId }).catch(() => undefined);
  }

  // Version 0 must ignore the old left-side X as a site-specific exception,
  // preserve the useful Y and migrate once to the global right dock.
  await evaluate(
    optionsSession,
    `chrome.storage.local.get("config").then(({ config }) => {
      config.contentScript.toolbarPositionVersion = 0;
      config.contentScript.dockSide = "left";
      config.contentScript.edgeOffset = 1600;
      config.contentScript.position = { x: 16, y: 180 };
      return chrome.storage.local.set({ config });
    })`,
  );
  const { targetId: migrationTargetId } = await browserSession.call("Target.createTarget", {
    url: expectedSites[0].home,
    background: true,
  });
  createdTargetIds.push(migrationTargetId);
  const migrationTarget = await waitFor(async () => {
    const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
    return targets.find((item) => item.id === migrationTargetId && item.webSocketDebuggerUrl);
  }, "legacy migration target");
  const migrationSession = await new CdpSession(migrationTarget.webSocketDebuggerUrl).open();
  siteSessions.push(migrationSession);
  await migrationSession.call("Runtime.enable");
  await migrationSession.call("Page.enable");
  await migrationSession.call("DOM.enable");
  await migrationSession.call("Page.bringToFront");
  await assertDock(migrationSession, "right", "legacy absolute coordinate migration");
  const migratedConfig = await waitFor(
    () =>
      evaluate(
        optionsSession,
        `chrome.storage.local.get("config").then(({ config }) => config?.contentScript?.toolbarPositionVersion === 2 && config?.contentScript?.dockSide === "right" ? config.contentScript : null)`,
      ),
    "legacy toolbar placement to persist as v2",
  );
  assert(migratedConfig.edgeOffset === 16, "legacy migration restores the default right-edge distance", migratedConfig);
  await restoreDefaultPlacement(optionsSession);

  await evaluate(
    optionsSession,
    `chrome.storage.local.get("config").then(({ config }) => { config.contentScript.enabled = false; return chrome.storage.local.set({ config }); })`,
  );
  const disabledDockControls = await waitFor(async () => {
    const radios = await evaluate(
      optionsSession,
      `[...document.querySelectorAll('input[type="radio"]')].filter((radio) => radio.value === "left" || radio.value === "right").map((radio) => ({ value: radio.value, disabled: radio.disabled }))`,
    );
    return radios.length === 2 && radios.every((radio) => radio.disabled) ? radios : undefined;
  }, "visible disabled dock controls while the toolbar is off");
  assert(
    disabledDockControls
      .map((radio) => radio.value)
      .sort()
      .join(",") === "left,right",
    "left/right controls remain discoverable when the toolbar is disabled",
    disabledDockControls,
  );
  await evaluate(
    optionsSession,
    `chrome.storage.local.get("config").then(({ config }) => { config.contentScript.enabled = true; return chrome.storage.local.set({ config }); })`,
  );

  console.log("Toolbar settings, cross-site docking, background recovery, resize recovery and menu direction passed.");
} finally {
  await restoreDefaultPlacement(optionsSession).catch(() => undefined);
  for (const session of siteSessions) session.close();
  for (const targetId of createdTargetIds) {
    await browserSession.call("Target.closeTarget", { targetId }).catch(() => undefined);
  }
  optionsSession.close();
  browserSession.close();
}
