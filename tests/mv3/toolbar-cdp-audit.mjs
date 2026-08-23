const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const expectedSiteDefinitions = [
  { id: "azusa", name: "Azusa", listPath: "/torrents.php", detailPath: "/details.php?id=1" },
  { id: "audiences", name: "Audiences", listPath: "/torrents.php", detailPath: "/details.php?id=1" },
  { id: "hdkylin", name: "HDKylin", listPath: "/torrents.php", detailPath: "/details.php?id=1" },
  { id: "hdsky", name: "HDSky", listPath: "/torrents.php", detailPath: "/details.php?id=1" },
  { id: "hdtime", name: "HDTime", listPath: "/torrents.php", detailPath: "/details.php?id=1" },
  { id: "kamept", name: "KamePT", listPath: "/torrents.php", detailPath: "/details.php?id=1" },
  { id: "mteam", name: "M-Team", listPath: "/browse", detailPath: "/detail/1" },
  { id: "pttime", name: "PTTime", listPath: "/torrents.php", detailPath: "/details.php?id=1" },
  {
    id: "skyeysnow",
    name: "SkyeySnow",
    listPath: "/forum.php?mod=torrents",
    detailPath: "/forum.php?mod=viewthread&tid=1",
  },
  { id: "u2", name: "U2", listPath: "/torrents.php", detailPath: "/details.php?id=1" },
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
    this.runtimeErrors = [];
    this.eventHandlers = new Map();
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
        const extensionFrame = details.stackTrace?.callFrames?.some((frame) =>
          frame.url?.startsWith("chrome-extension://"),
        );
        if (details.url?.startsWith("chrome-extension://") || extensionFrame) {
          this.runtimeErrors.push(details.exception?.description ?? details.text);
        }
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        if (entry.source !== "network" || entry.url?.startsWith("chrome-extension://")) {
          this.runtimeErrors.push(entry.text);
        }
      }
      const handler = this.eventHandlers.get(message.method);
      if (handler) {
        Promise.resolve(handler(message.params)).catch((error) => this.runtimeErrors.push(String(error)));
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

  onEvent(method, handler) {
    this.eventHandlers.set(method, handler);
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

async function inspectElement(session, node) {
  const { object } = await session.call("DOM.resolveNode", { backendNodeId: node.backendNodeId });
  assert(object.objectId, "shadow element can be resolved");
  try {
    const result = await session.call("Runtime.callFunctionOn", {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        const style = getComputedStyle(this);
        return {
          ariaLabel: this.getAttribute('aria-label') || '',
          title: this.getAttribute('title') || '',
          clientWidth: this.clientWidth,
          clientHeight: this.clientHeight,
          scrollWidth: this.scrollWidth,
          scrollHeight: this.scrollHeight,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity
        };
      }`,
    });
    return result.result.value;
  } finally {
    await session.call("Runtime.releaseObject", { objectId: object.objectId }).catch(() => undefined);
  }
}

async function assertToolbarLayout(session, label) {
  const measurement = await measureToolbar(session);
  const compact = measurement.viewport.compactMedia;
  const expectedWidth = compact ? 84 : 96;
  assert(
    Math.abs(measurement.rect.width - expectedWidth) <= 3,
    `${label} uses the ${compact ? "compact" : "default"} toolbar width`,
    measurement,
  );
  assert(
    measurement.rect.left >= -1 &&
      measurement.rect.right <= measurement.viewport.width + 1 &&
      measurement.rect.top >= -1 &&
      measurement.rect.bottom <= measurement.viewport.height + 1,
    `${label} remains fully inside the visual viewport`,
    measurement,
  );

  const nodes = await flattenedNodes(session);
  const actionButtons = nodes.filter((node) => node.nodeName === "BUTTON" && hasClass(node, "ptpp-toolbar-button"));
  const logo = nodes.find((node) => node.nodeName === "BUTTON" && hasClass(node, "ptpp-toolbar-logo"));
  assert(logo, `${label} keeps the PTPP logo entry`);

  const expectedButtonHeight = compact ? 48 : 60;
  for (const button of actionButtons) {
    const rect = await nodeRect(session, button);
    const info = await inspectElement(session, button);
    assert(
      Math.abs(rect.height - expectedButtonHeight) <= 2 && rect.height >= 44,
      `${label} action buttons keep the required click height`,
      { rect, info },
    );
    assert(info.title || info.ariaLabel, `${label} action buttons keep an accessible name`, info);
    assert(
      info.scrollWidth <= info.clientWidth + 1 && info.scrollHeight <= info.clientHeight + 1,
      `${label} action labels are not clipped`,
      info,
    );
  }

  const toolbarInfo = await inspectElement(session, measurement.node);
  assert(
    toolbarInfo.scrollWidth <= toolbarInfo.clientWidth + 1,
    `${label} has no toolbar-level horizontal overflow`,
    toolbarInfo,
  );
  assert(toolbarInfo.display !== "none" && toolbarInfo.visibility !== "hidden", `${label} stays visible`, toolbarInfo);
  return { ...measurement, actionCount: actionButtons.length, compact };
}

async function measureToolbar(session) {
  return waitFor(async () => {
    const toolbar = await findNode(session, (node) => hasClass(node, "ptpp-toolbar"));
    if (!toolbar) return undefined;
    const rect = await nodeRect(session, toolbar);
    const viewport = await evaluate(
      session,
      `({
        width: visualViewport?.width || innerWidth || document.documentElement.clientWidth,
        height: visualViewport?.height || innerHeight || document.documentElement.clientHeight,
        layoutWidth: innerWidth || document.documentElement.clientWidth,
        layoutHeight: innerHeight || document.documentElement.clientHeight,
        devicePixelRatio,
        hidden: document.hidden,
        compactMedia: matchMedia('(max-height: 700px), (max-width: 520px)').matches,
        url: location.href,
        title: document.title
      })`,
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
  let lastMeasurement;
  const measurement = await waitFor(async () => {
    const current = await measureToolbar(session);
    lastMeasurement = current;
    const currentSide = current.attributes["data-dock-side"];
    const currentEdgeDistance =
      side === "right" ? current.viewport.width - current.rect.right : current.rect.left;
    const currentCenter = current.rect.left + current.rect.width / 2;
    const currentInSelectedHalf =
      side === "right"
        ? currentCenter >= current.viewport.width / 2
        : currentCenter <= current.viewport.width / 2;
    return currentSide === side &&
      currentInSelectedHalf &&
      Math.abs(currentEdgeDistance - expectedOffset) <= 3
      ? current
      : undefined;
  }, `${label} dock geometry to stabilize`).catch((error) => {
    throw new Error(`${error.message}\nLast measurement: ${JSON.stringify(lastMeasurement, null, 2)}`);
  });
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
  const actualUrl = await evaluate(session, "location.href");
  const expectedUrl = new URL(url);
  const actual = new URL(actualUrl);
  const queryMatches = [...expectedUrl.searchParams].every(([key, value]) => actual.searchParams.get(key) === value);
  assert(
    actual.origin === expectedUrl.origin && actual.pathname === expectedUrl.pathname && queryMatches,
    `navigation remains on the intended ${expectedUrl.pathname} page`,
    { expected: expectedUrl.href, actual: actual.href },
  );
}

async function enableOriginPreservingFixture(session, site) {
  const origin = new URL(site.home).origin;
  session.onEvent("Fetch.requestPaused", async (params) => {
    if (params.resourceType !== "Document") {
      await session.call("Fetch.continueRequest", { requestId: params.requestId });
      return;
    }
    const requestUrl = new URL(params.request.url);
    if (requestUrl.origin !== origin) {
      await session.call("Fetch.continueRequest", { requestId: params.requestId });
      return;
    }
    const pageKind = requestUrl.pathname.includes("detail")
      ? "detail"
      : requestUrl.pathname.includes("browse")
        ? "list"
        : "home";
    const detailHref = new URL(site.detailPath, site.home).href;
    const body = `<!doctype html>
      <html lang="zh-CN">
        <head><meta charset="utf-8"><title>${site.name} ${pageKind} toolbar fixture</title></head>
        <body style="min-height:1200px;background:#fff">
          <main>
            <h1>${site.name} ${pageKind}</h1>
            ${pageKind === "list" ? `<a href="${detailHref}">PTPP toolbar fixture torrent</a>` : ""}
            ${pageKind === "detail" ? '<a href="/download.php?id=1">Download fixture torrent</a>' : ""}
          </main>
        </body>
      </html>`;
    await session.call("Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: "Content-Type", value: "text/html; charset=utf-8" },
        { name: "Cache-Control", value: "no-store" },
      ],
      body: Buffer.from(body).toString("base64"),
    });
  });
  await session.call("Fetch.enable", {
    patterns: [{ urlPattern: `${origin}/*`, resourceType: "Document", requestStage: "Request" }],
  });
}

async function firstDetailUrl(session, fallbackUrl) {
  try {
    return await waitFor(
      () =>
        evaluate(
          session,
          `(() => {
            const candidates = [...document.querySelectorAll('a[href]')];
            const link = candidates.find((item) => {
              const href = item.getAttribute('href') || '';
              return /details\.php\?(?:[^#]*&)?id=\d+|\/detail\/\d+|#\/torrent\/\d+|forum\.php\?[^#]*mod=viewthread/i.test(href);
            });
            return link ? new URL(link.getAttribute('href'), location.href).href : '';
          })()`,
        ),
      "a torrent detail link",
      5_000,
    );
  } catch {
    return fallbackUrl;
  }
}

async function setPageBackground(session, color) {
  await evaluate(
    session,
    `(() => {
      document.documentElement.style.background = ${JSON.stringify(color)};
      if (document.body) document.body.style.background = ${JSON.stringify(color)};
      return true;
    })()`,
  );
  await sleep(100);
}

async function setViewport(session, width, height, zoom = 1) {
  // Chrome page zoom changes the CSS viewport and devicePixelRatio. CDP's
  // setPageScaleFactor models pinch/visual-viewport zoom instead and does not
  // reliably dispatch the resize contract to an extension isolated world.
  // Model the browser's 100/125/150% page zoom explicitly so the content
  // script is exercised through the same layout-viewport resize path a user
  // gets from Chrome's zoom controls.
  const layoutWidth = Math.max(1, Math.round(width / zoom));
  const layoutHeight = Math.max(1, Math.round(height / zoom));
  await session.call("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await session.call("Emulation.setDeviceMetricsOverride", {
    width: layoutWidth,
    height: layoutHeight,
    deviceScaleFactor: zoom,
    mobile: false,
  });
  await sleep(100);
  const layout = await evaluate(session, `({ width: innerWidth, height: innerHeight })`);
  if (Math.abs(layout.width - layoutWidth) > 2 || Math.abs(layout.height - layoutHeight) > 2) {
    await session.call("Emulation.setDeviceMetricsOverride", {
      width: Math.max(1, Math.round((layoutWidth * layoutWidth) / layout.width)),
      height: Math.max(1, Math.round((layoutHeight * layoutHeight) / layout.height)),
      deviceScaleFactor: zoom,
      mobile: false,
    });
    await sleep(100);
  }
  await sleep(250);
}

async function clearViewport(session) {
  await session.call("Emulation.setPageScaleFactor", { pageScaleFactor: 1 }).catch(() => undefined);
  await session.call("Emulation.clearDeviceMetricsOverride");
  await sleep(250);
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
  assert(
    menuRect.left >= -1 &&
      menuRect.right <= toolbar.viewport.width + 1 &&
      menuRect.top >= -1 &&
      menuRect.bottom <= toolbar.viewport.height + 1,
    `${label} menu remains inside the visual viewport`,
    { toolbar: toolbar.rect, menu: menuRect, viewport: toolbar.viewport },
  );
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

async function setLanguage(optionsSession, language) {
  await evaluate(
    optionsSession,
    `chrome.storage.local.get('config').then(({ config }) => {
      config.lang = ${JSON.stringify(language)};
      return chrome.storage.local.set({ config });
    })`,
  );
  await sleep(250);
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

async function resolveExpectedSites(optionsSession) {
  const storedSites = await evaluate(
    optionsSession,
    `chrome.storage.local.get('metadata').then(({ metadata }) =>
      Object.fromEntries(Object.entries(metadata?.sites ?? {}).map(([id, site]) => [id, {
        name: site.name || id,
        url: site.url || '',
        enabled: site.enabled !== false
      }]))
    )`,
  );
  const resolvedSites = expectedSiteDefinitions.map((definition) => {
    const stored = storedSites[definition.id];
    assert(stored?.url, `${definition.name} has a configured URL in the isolated extension profile`, stored);
    const home = new URL(stored.url).href;
    return {
      ...definition,
      configuredName: stored.name,
      enabled: stored.enabled,
      home,
      list: new URL(definition.listPath, home).href,
      detailFallback: new URL(definition.detailPath, home).href,
    };
  });
  assert(resolvedSites.length === 10, "all ten launch sites are present in the toolbar matrix", resolvedSites);
  return resolvedSites;
}

const initialTargets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const browserVersion = await fetch(`${endpoint}/json/version`).then((response) => response.json());
const browserSession = await new CdpSession(browserVersion.webSocketDebuggerUrl).open();
let optionsTarget = initialTargets.find(
  (target) =>
    target.type === "page" &&
    target.url.startsWith("chrome-extension://") &&
    target.url.includes("/src/entries/options/index.html"),
);
if (!optionsTarget) {
  const extensionTarget = initialTargets.find((target) => target.url?.startsWith("chrome-extension://"));
  const extensionId = extensionTarget?.url?.match(/^chrome-extension:\/\/([^/]+)/)?.[1];
  assert(extensionId, "the running extension identity can create an options target");
  const { targetId } = await browserSession.call("Target.createTarget", {
    url: `chrome-extension://${extensionId}/src/entries/options/index.html#/set-base/toolbar`,
  });
  optionsTarget = await waitFor(async () => {
    const currentTargets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
    return currentTargets.find((target) => target.id === targetId && target.webSocketDebuggerUrl);
  }, "the toolbar options target");
}
assert(optionsTarget?.webSocketDebuggerUrl, `an options target exists at ${endpoint}`);

const optionsSession = await new CdpSession(optionsTarget.webSocketDebuggerUrl).open();
const createdTargetIds = [];
const siteSessions = [];
const completedRuntimeErrors = [];
let expectedSites = [];
const pageActionCounts = new Map();

try {
  await optionsSession.call("Runtime.enable");
  await optionsSession.call("Log.enable");
  await optionsSession.call("Page.enable");
  expectedSites = await resolveExpectedSites(optionsSession);
  await setDockThroughOptions(optionsSession, "right");
  await restoreDefaultPlacement(optionsSession);

  for (const site of expectedSites) {
    const usesOriginFixture = site.id === "mteam";
    const { targetId } = await browserSession.call("Target.createTarget", {
      url: usesOriginFixture ? "about:blank" : site.home,
      background: true,
    });
    createdTargetIds.push(targetId);
    const target = await waitFor(async () => {
      const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
      return targets.find((item) => item.id === targetId && item.webSocketDebuggerUrl);
    }, `${site.name} target`);
    const session = await new CdpSession(target.webSocketDebuggerUrl).open();
    siteSessions.push(session);
    await session.call("Runtime.enable");
    await session.call("Log.enable");
    await session.call("Page.enable");
    await session.call("DOM.enable");
    await setViewport(session, 1280, 800, 1);
    if (usesOriginFixture) {
      await enableOriginPreservingFixture(session, site);
      await navigate(session, site.home);
      console.log(JSON.stringify({ check: `${site.name} origin-preserving fixture`, reason: "isolated profile has no live web session" }));
    } else {
      await navigate(session, site.home);
    }

    // The target was created in the background. Bringing it forward must
    // recover the first real viewport and place the toolbar on the saved side.
    await session.call("Page.bringToFront");
    await assertDock(session, "right", `${site.name} background home`);
    await setPageBackground(session, "#ffffff");
    const homeLayout = await assertToolbarLayout(session, `${site.name} home on a light page`);
    pageActionCounts.set(`${site.id}:home`, homeLayout.actionCount);

    await navigate(session, site.list);
    await assertDock(session, "right", `${site.name} torrent list`);
    await setPageBackground(session, "#111111");
    const listLayout = await assertToolbarLayout(session, `${site.name} list on a dark page`);
    pageActionCounts.set(`${site.id}:list`, listLayout.actionCount);

    const detailUrl = await firstDetailUrl(session, site.detailFallback);
    await navigate(session, detailUrl);
    await assertDock(session, "right", `${site.name} torrent detail`);
    await setPageBackground(session, "#ffffff");
    const detailLayout = await assertToolbarLayout(session, `${site.name} detail on a light page`);
    pageActionCounts.set(`${site.id}:detail`, detailLayout.actionCount);

    for (const zoom of [1, 1.25, 1.5]) {
      await setViewport(session, 1280, 800, zoom);
      await assertDock(session, "right", `${site.name} detail at ${Math.round(zoom * 100)}%`);
      await assertToolbarLayout(session, `${site.name} detail at ${Math.round(zoom * 100)}%`);
    }
    await setViewport(session, 1280, 800, 1);

    if (site === expectedSites[0]) {
      await openDownloadMenuAndAssertDirection(session, "right", `${site.name} detail`);
      await doubleClickResetAndAssert(session, "right", `${site.name} detail`);

      await setViewport(session, 900, 700, 1);
      await assertDock(session, "right", `${site.name} 900x700 detail`);
      await assertToolbarLayout(session, `${site.name} 900x700 detail`);
      await openDownloadMenuAndAssertDirection(session, "right", `${site.name} 900x700 detail`);

      await setViewport(session, 480, 640, 1);
      await assertDock(session, "right", `${site.name} narrow compact detail`);
      const narrowLayout = await assertToolbarLayout(session, `${site.name} narrow compact detail`);
      assert(narrowLayout.compact, `${site.name} narrow viewport uses the compact fallback`, narrowLayout);

      // Reproduce the historical wide-to-narrow failure. A huge saved offset
      // must stay in the configured half, then return to the normal edge after
      // the real viewport is restored and the position is reset.
      await evaluate(
        optionsSession,
        `chrome.storage.local.get("config").then(({ config }) => { config.contentScript.edgeOffset = 1600; return chrome.storage.local.set({ config }); })`,
      );
      await setViewport(session, 640, 700, 1);
      let lastNarrowMeasurement;
      const narrow = await waitFor(async () => {
        const measurement = await measureToolbar(session);
        lastNarrowMeasurement = measurement;
        const center = measurement.rect.left + measurement.rect.width / 2;
        return center >= measurement.viewport.width / 2 - 2 ? measurement : undefined;
      }, `${site.name} oversized right offset to stay in the right half`).catch((error) => {
        throw new Error(`${error.message}\nLast measurement: ${JSON.stringify(lastNarrowMeasurement, null, 2)}`);
      });
      const narrowCenter = narrow.rect.left + narrow.rect.width / 2;
      assert(
        narrowCenter >= narrow.viewport.width / 2 - 2,
        `${site.name} oversized right offset stays in the right half`,
        narrow,
      );
      await doubleClickResetAndAssert(session, "right", `${site.name} narrow viewport`);
      await setViewport(session, 1280, 800, 1);
      await assertDock(session, "right", `${site.name} restored viewport`);
      await assertToolbarLayout(session, `${site.name} restored viewport`);
    }
  }

  assert(pageActionCounts.size === 30, "home/list/detail geometry is recorded for all ten launch sites", [
    ...pageActionCounts,
  ]);
  assert(
    new Set(pageActionCounts.values()).size >= 2,
    "the matrix covers more than one real toolbar button combination",
    [...pageActionCounts],
  );

  await setDockThroughOptions(optionsSession, "left");
  for (const [index, session] of siteSessions.entries()) {
    await assertDock(session, "left", `${expectedSites[index].name} open detail after settings sync`);
    await assertToolbarLayout(session, `${expectedSites[index].name} left-docked detail`);
  }
  await openDownloadMenuAndAssertDirection(siteSessions[0], "left", `${expectedSites[0].name} left detail`);
  await doubleClickResetAndAssert(siteSessions[0], "left", `${expectedSites[0].name} left detail`);

  // Leave the isolated profile in the product default state and prove all
  // already-open tracker pages update without a refresh.
  await setDockThroughOptions(optionsSession, "right");
  for (const [index, session] of siteSessions.entries()) {
    await assertDock(session, "right", `${expectedSites[index].name} open detail restored to default`);
    await assertToolbarLayout(session, `${expectedSites[index].name} restored right-docked detail`);
  }

  await setLanguage(optionsSession, "en");
  for (const [index, session] of siteSessions.entries()) {
    await assertToolbarLayout(session, `${expectedSites[index].name} English detail labels`);
  }
  await setLanguage(optionsSession, "zh_CN");
  for (const [index, session] of siteSessions.entries()) {
    await assertToolbarLayout(session, `${expectedSites[index].name} Chinese detail labels restored`);
  }

  // A legacy backup may carry an absolute X coordinate on the left. Close the
  // already-open tracker contexts before downgrading the shared config: only
  // one content script should own this one-time migration. Otherwise every
  // open page legitimately observes version 0 and races to persist its own
  // viewport-derived result, which tests storage contention instead of the
  // migration contract.
  for (const session of siteSessions.splice(0)) {
    completedRuntimeErrors.push(...session.runtimeErrors);
    session.close();
  }
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
  await migrationSession.call("Log.enable");
  await migrationSession.call("Page.enable");
  await migrationSession.call("DOM.enable");
  await migrationSession.call("Page.bringToFront");
  await assertDock(migrationSession, "right", "legacy absolute coordinate migration");
  await assertToolbarLayout(migrationSession, "legacy absolute coordinate migration");
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

  // The migration target starts on the tracker home page, which intentionally
  // contains only the logo entry. Move it to a real detail route before the
  // final locale assertion so action-label reachability is actually exercised.
  await navigate(migrationSession, expectedSites[0].detailFallback);
  await assertDock(migrationSession, "right", "post-migration detail route");
  await setLanguage(optionsSession, "en");
  const englishMigrationLayout = await assertToolbarLayout(migrationSession, "English toolbar labels");
  assert(englishMigrationLayout.actionCount > 0, "English locale keeps the real action labels reachable");
  await setLanguage(optionsSession, "zh_CN");
  await assertToolbarLayout(migrationSession, "Chinese toolbar labels restored");

  const runtimeErrors = [
    ...completedRuntimeErrors,
    ...siteSessions.flatMap((session) => session.runtimeErrors),
    ...optionsSession.runtimeErrors,
  ];
  assert(runtimeErrors.length === 0, "toolbar acceptance produced no extension runtime exceptions", runtimeErrors);

  console.log(
    JSON.stringify({
      check: "10-site toolbar acceptance",
      sites: expectedSites.map((site) => site.id),
      pageTypes: pageActionCounts.size,
      actionCombinations: [...new Set(pageActionCounts.values())].sort((a, b) => a - b),
      zooms: [100, 125, 150],
      viewports: ["1280x800", "900x700", "640x700", "480x640"],
      dockSides: ["right", "left"],
      backgrounds: ["light", "dark"],
      languages: ["zh_CN", "en"],
      runtimeErrors: 0,
    }),
  );
} finally {
  await restoreDefaultPlacement(optionsSession).catch(() => undefined);
  for (const session of siteSessions) session.close();
  for (const targetId of createdTargetIds) {
    await browserSession.call("Target.closeTarget", { targetId }).catch(() => undefined);
  }
  optionsSession.close();
  browserSession.close();
}
