const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";

const linkPushRoute = "/link-push?link=https%3A%2F%2Fazusa.wiki%2Fdownload.php%3Fid%3D22148";

const productionRoutes = [
  "/my-data",
  "/search-entity",
  "/search-result-snapshot",
  "/download-history",
  "/my-collection",
  "/keep-upload-task",
  "/set-downloader",
  "/set-base",
  "/set-base/toolbar",
  "/set-base/browser-integration",
  "/set-base/user-data",
  "/set-base/search",
  "/set-base/download",
  "/set-base/backup",
  "/set-site",
  "/set-download-paths",
  "/set-search-solution",
  "/set-backup",
  "/technology-stack",
  "/special-thank",
  "/logger",
  "/user-data-timeline",
  "/user-data-statistic",
  linkPushRoute,
];

const dialogCases = [
  { route: "/set-downloader", buttonTitles: ["增加", "Add"] },
  { route: "/set-downloader", buttonTitles: ["编辑", "Edit"] },
  { route: "/set-site", buttonTitles: ["增加", "Add"] },
  { route: "/set-site", buttonTitles: ["编辑", "Edit"] },
  { route: "/set-site", buttonTitles: ["一键导入站点", "One-click site import"] },
  { route: "/set-site", buttonTitles: ["重建站点映射", "Rebuild site mapping"] },
  { route: "/set-backup", buttonTitles: ["增加", "Add"] },
  { route: "/set-backup", buttonTitles: ["编辑", "Edit"] },
  { route: "/set-backup", buttonTitles: ["查看备份详情与历史", "View backup details and history"] },
  { route: "/set-backup", buttonTitles: ["本地导入", "Local import"] },
  { route: "/my-collection", buttonTitles: ["新建分组", "Add group"] },
  { route: "/my-collection", buttonTitles: ["编辑", "Edit"] },
  { route: "/download-history", buttonTitles: ["重新下载", "Re-download"] },
  { route: "/search-entity", buttonTitles: ["保存搜索快照", "Save search snapshot"] },
];

const namedControlRoles = new Set(["button", "checkbox", "combobox", "dialog", "link", "radio", "textbox"]);

const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const optionsTarget = targets.find(
  (target) =>
    target.type === "page" &&
    target.url.startsWith("chrome-extension://") &&
    target.url.includes("/src/entries/options/index.html"),
);
if (!optionsTarget?.webSocketDebuggerUrl) {
  throw new Error(`No PT-Plugin-Plus options target found at ${endpoint}`);
}

const socket = new WebSocket(optionsTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const runtimeErrors = [];
const externalNetworkWarnings = [];
const workerErrors = [];
let currentAuditLabel = "startup";

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
    return;
  }

  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails;
    runtimeErrors.push({
      audit: currentAuditLabel,
      type: "exception",
      text: details.exception?.description ?? details.text,
      stackTrace: details.stackTrace,
      url: details.url,
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber,
    });
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    const error = {
      audit: currentAuditLabel,
      type: "log",
      source: message.params.entry.source,
      text: message.params.entry.text,
      url: message.params.entry.url,
      lineNumber: message.params.entry.lineNumber,
    };
    if (error.source === "network" && error.url && !error.url.startsWith("chrome-extension://")) {
      externalNetworkWarnings.push(error);
    } else {
      runtimeErrors.push(error);
    }
  }
});

function call(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 15_000);
    pending.set(id, {
      method,
      resolve(value) {
        clearTimeout(timer);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await call("Page.bringToFront");
await call("Runtime.enable");
await call("Log.enable");
await call("Accessibility.enable");
// Vuetify leave transitions are throttled in a hidden background tab. Start
// every audit from a visible, clean document so one dialog cannot contaminate
// the remaining cases with a false "still open" result.
await call("Page.reload");
await new Promise((resolve) => setTimeout(resolve, 1_000));
await call("Runtime.evaluate", {
  expression: `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((item) => /欢迎使用|Welcome/i.test(item.innerText));
    const button = dialog && [...dialog.querySelectorAll('button')]
      .find((item) => /开始使用|Get started/i.test(item.innerText.trim()));
    if (!button) return false;
    button.click();
    return true;
  })()`,
  returnByValue: true,
});
await new Promise((resolve) => setTimeout(resolve, 300));

// An MV3 service worker is expected to disappear while idle. Wake it through the
// inspected extension page so the audit does not depend on a lucky lifecycle
// window, then attach quickly enough to collect any startup/runtime errors.
await call("Runtime.evaluate", {
  expression: `chrome.runtime.sendMessage({ type: "__ptpp_release_audit_wakeup__" }).catch(() => undefined)`,
  awaitPromise: true,
});

let serviceWorkerTarget;
for (let attempt = 0; attempt < 20 && !serviceWorkerTarget; attempt += 1) {
  const refreshedTargets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
  serviceWorkerTarget = refreshedTargets.find(
    (target) => target.type === "service_worker" && target.url.startsWith("chrome-extension://"),
  );
  if (!serviceWorkerTarget) await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!serviceWorkerTarget?.webSocketDebuggerUrl) {
  socket.close();
  throw new Error(`PT-Plugin-Plus service worker did not wake at ${endpoint}`);
}

const workerSocket = new WebSocket(serviceWorkerTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  workerSocket.addEventListener("open", resolve, { once: true });
  workerSocket.addEventListener("error", reject, { once: true });
});
let workerNextId = 0;
const workerPending = new Map();
workerSocket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id) {
    const request = workerPending.get(message.id);
    if (!request) return;
    workerPending.delete(message.id);
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails;
    workerErrors.push({
      audit: currentAuditLabel,
      type: "exception",
      text: details.exception?.description ?? details.text,
      stackTrace: details.stackTrace,
      url: details.url,
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber,
    });
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    const error = {
      audit: currentAuditLabel,
      type: "log",
      source: message.params.entry.source,
      text: message.params.entry.text,
      url: message.params.entry.url,
      lineNumber: message.params.entry.lineNumber,
    };
    if (error.source === "network" && error.url && !error.url.startsWith("chrome-extension://")) {
      externalNetworkWarnings.push(error);
    } else {
      workerErrors.push(error);
    }
  }
});
function workerCall(method, params = {}) {
  const id = ++workerNextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      workerPending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 15_000);
    workerPending.set(id, {
      method,
      resolve(value) {
        clearTimeout(timer);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
    workerSocket.send(JSON.stringify({ id, method, params }));
  });
}
await workerCall("Runtime.enable");
await workerCall("Log.enable");

const failures = [];
for (const route of productionRoutes) {
  currentAuditLabel = `route:${route}`;
  await call("Runtime.evaluate", {
    expression: `location.hash = ${JSON.stringify(`#${route}`)}; new Promise((resolve) => setTimeout(() => resolve(location.hash), 700))`,
    awaitPromise: true,
    returnByValue: true,
  });

  // Route components can insert their external links in the same rendering
  // turn that resolves the navigation wait. Give the root security observer a
  // browser task to attach rel=noopener before auditing the settled document,
  // matching the earliest point at which a real user input event can fire.
  await call("Runtime.evaluate", {
    expression: `new Promise((resolve) => setTimeout(resolve, 0))`,
    awaitPromise: true,
  });

  const { nodes } = await call("Accessibility.getFullAXTree");
  const unnamed = nodes.filter((node) => {
    const role = node.role?.value;
    const name = node.name?.value;
    if (node.ignored || !namedControlRoles.has(role) || (typeof name === "string" && name.trim())) return false;
    if (role === "combobox") {
      return node.properties?.some((property) => property.name === "focusable" && property.value?.value === true);
    }
    return true;
  });

  const details = [];
  for (const node of unnamed) {
    let outerHTML = "";
    if (node.backendDOMNodeId) {
      outerHTML =
        (await call("DOM.getOuterHTML", { backendNodeId: node.backendDOMNodeId }).catch(() => ({}))).outerHTML ?? "";
    }
    details.push({ role: node.role?.value, outerHTML: outerHTML.replace(/\s+/g, " ").slice(0, 300) });
  }

  const layout = await call("Runtime.evaluate", {
    expression: `(() => {
      const forbiddenRoutes = ['/media-server', '/my-client', '/set-media-server', '/native-bridge', '/debugger'];
      return {
        hash: location.hash,
        title: document.title,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        personalNameVisible: /JohnathanT55/i.test(document.body.innerText),
        forbiddenRouteLinks: [...document.querySelectorAll('a[href]')]
          .map((anchor) => anchor.getAttribute('href') ?? '')
          .filter((href) => forbiddenRoutes.some((route) => href.includes(route))),
        unsafeBlankLinks: [...document.querySelectorAll('a[target="_blank"]')]
          .filter((anchor) => !anchor.rel.split(/\\s+/).includes('noopener'))
          .map((anchor) => ({ text: anchor.innerText.trim(), href: anchor.getAttribute('href') })),
      };
    })()`,
    returnByValue: true,
  });

  if (details.length > 0) failures.push({ route, unnamed: details });
  if (layout.result.value.personalNameVisible) failures.push({ route, error: "personal GitHub name is visible" });
  if (layout.result.value.forbiddenRouteLinks.length > 0) {
    failures.push({ route, forbiddenRouteLinks: layout.result.value.forbiddenRouteLinks });
  }
  if (layout.result.value.unsafeBlankLinks.length > 0) {
    failures.push({ route, unsafeBlankLinks: layout.result.value.unsafeBlankLinks });
  }
  console.log(JSON.stringify({ route, ...layout.result.value, unnamedControls: details.length }));
}

currentAuditLabel = "theme:link-push:dark";
const originalTheme = await call("Runtime.evaluate", {
  expression: `chrome.storage.local.get("config").then(({ config }) => config.theme)`,
  awaitPromise: true,
  returnByValue: true,
});
await call("Runtime.evaluate", {
  expression: `chrome.storage.local.get("config").then(({ config }) => { config.theme = "dark"; return chrome.storage.local.set({ config }); })`,
  awaitPromise: true,
});
await call("Runtime.evaluate", {
  expression: `location.hash = ${JSON.stringify(`#${linkPushRoute}`)}; location.reload()`,
});
await new Promise((resolve) => setTimeout(resolve, 1_000));
const linkPushTheme = await call("Runtime.evaluate", {
  expression: `(() => {
    const root = document.querySelector('.ptpp-context-link-push');
    const title = root?.querySelector('h1');
    const description = root?.querySelector('p');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;background:rgb(var(--v-theme-surface));color:rgb(var(--v-theme-primary));border-color:rgba(var(--v-theme-on-surface),var(--v-medium-emphasis-opacity))';
    (root?.closest('.v-theme--dark') ?? document.body).append(probe);
    const expected = getComputedStyle(probe);
    const actualRoot = root ? getComputedStyle(root) : null;
    const result = {
      darkTheme: Boolean(document.querySelector('.v-theme--dark')),
      rootFound: Boolean(root),
      background: actualRoot?.backgroundColor,
      expectedBackground: expected.backgroundColor,
      titleColor: title ? getComputedStyle(title).color : null,
      expectedTitleColor: expected.color,
      descriptionColor: description ? getComputedStyle(description).color : null,
      expectedDescriptionColor: expected.borderColor,
    };
    probe.remove();
    return result;
  })()`,
  returnByValue: true,
});
const themeResult = linkPushTheme.result.value;
if (
  !themeResult.darkTheme ||
  !themeResult.rootFound ||
  themeResult.background !== themeResult.expectedBackground ||
  themeResult.titleColor !== themeResult.expectedTitleColor ||
  themeResult.descriptionColor !== themeResult.expectedDescriptionColor
) {
  failures.push({ route: linkPushRoute, error: "advanced push does not follow the dark theme", themeResult });
}
console.log(JSON.stringify({ route: linkPushRoute, theme: "dark", ...themeResult }));
await call("Runtime.evaluate", {
  expression: `chrome.storage.local.get("config").then(({ config }) => { config.theme = ${JSON.stringify(originalTheme.result.value)}; return chrome.storage.local.set({ config }); })`,
  awaitPromise: true,
});

for (const testCase of dialogCases) {
  currentAuditLabel = `dialog:${testCase.route}:${testCase.buttonTitles[0]}`;
  // A route component owns several lazily-mounted dialogs. Reload before each
  // case so a failed close cannot contaminate the next accessibility tree and
  // make its title appear to belong to an earlier dialog.
  await call("Page.bringToFront");
  await call("Runtime.evaluate", {
    expression: `location.hash = ${JSON.stringify(`#${testCase.route}`)}; location.reload()`,
  });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await call("Runtime.evaluate", {
    expression: `(() => {
      const style = document.createElement('style');
      style.id = '__ptpp_release_audit_motion__';
      style.textContent = '*, *::before, *::after { animation-duration: 0.001s !important; animation-delay: 0s !important; transition-duration: 0.001s !important; transition-delay: 0s !important; }';
      document.head.append(style);
    })()`,
  });
  const opened = await call("Runtime.evaluate", {
    expression: `new Promise((resolve) => setTimeout(() => {
      const titles = ${JSON.stringify(testCase.buttonTitles)};
      const candidates = [...document.querySelectorAll('button')].filter((candidate) =>
        candidate.offsetParent !== null && titles.includes(candidate.title)
      );
      const button = candidates.find((candidate) => !candidate.disabled) ?? candidates[0];
      if (button?.disabled) {
        button.disabled = false;
        button.removeAttribute('disabled');
      }
      button?.click();
      setTimeout(() => resolve(Boolean(button)), 350);
    }, 700))`,
    awaitPromise: true,
    returnByValue: true,
  });

  if (!opened.result.value) {
    failures.push({ route: testCase.route, dialog: testCase.buttonTitles[0], error: "trigger not found" });
    continue;
  }

  const openTree = await call("Accessibility.getFullAXTree");
  const openDialogs = openTree.nodes.filter((node) => !node.ignored && node.role?.value === "dialog");
  const dialogNames = openDialogs.map((node) => String(node.name?.value ?? "").trim());
  if (dialogNames.length !== 1 || dialogNames.some((name) => !name)) {
    failures.push({ route: testCase.route, dialog: testCase.buttonTitles[0], openDialogNames: dialogNames });
  }

  const closeTarget = await call("Runtime.evaluate", {
    expression: `(() => {
      const names = ['关闭', '取消', 'Close', 'Cancel'];
      const dialog = document.querySelector('[role="dialog"]');
      const closeButton = dialog && [...dialog.querySelectorAll('button')].find((button) =>
        names.includes(button.title) || names.includes(button.getAttribute('aria-label')) || names.includes(button.innerText.trim())
      );
      if (!closeButton) return null;
      const rect = closeButton.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
    returnByValue: true,
  });
  if (closeTarget.result.value) {
    const { x, y } = closeTarget.result.value;
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  } else {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  }
  await call("Runtime.evaluate", {
    expression: `new Promise((resolve) => setTimeout(resolve, 650))`,
    awaitPromise: true,
  });

  const closedTree = await call("Accessibility.getFullAXTree");
  const closedDialogs = closedTree.nodes.filter((node) => !node.ignored && node.role?.value === "dialog");
  const closedDom = await call("Runtime.evaluate", {
    expression: `document.querySelectorAll('[role="dialog"]').length`,
    returnByValue: true,
  });
  if (closedDialogs.length > 0 || closedDom.result.value > 0) {
    failures.push({
      route: testCase.route,
      dialog: testCase.buttonTitles[0],
      error: "dialog remained after close",
      axCount: closedDialogs.length,
      domCount: closedDom.result.value,
    });
  }
  console.log(JSON.stringify({ route: testCase.route, dialog: testCase.buttonTitles[0], name: dialogNames[0] }));
}

socket.close();
workerSocket.close();

if (externalNetworkWarnings.length > 0) {
  console.warn(
    "External network warnings:",
    JSON.stringify(
      [...new Map(externalNetworkWarnings.map((warning) => [JSON.stringify(warning), warning])).values()],
      null,
      2,
    ),
  );
}
if (runtimeErrors.length > 0) {
  console.error(
    "Runtime errors:",
    JSON.stringify([...new Map(runtimeErrors.map((error) => [JSON.stringify(error), error])).values()], null, 2),
  );
}
if (workerErrors.length > 0) {
  console.error(
    "Service worker errors:",
    JSON.stringify([...new Map(workerErrors.map((error) => [JSON.stringify(error), error])).values()], null, 2),
  );
}
if (failures.length > 0) {
  console.error("Unnamed controls:", JSON.stringify(failures, null, 2));
}
if (runtimeErrors.length > 0 || workerErrors.length > 0 || failures.length > 0) process.exitCode = 1;
