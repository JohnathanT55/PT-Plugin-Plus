import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const useConfiguredClients = process.argv.includes("--configured-clients");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function writeCors(response, request) {
  response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? "*");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Access-Control-Allow-Headers", "authorization,content-type,x-transmission-session-id");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function taskNameFromMagnet(magnet) {
  try {
    return new URL(magnet).searchParams.get("dn") || `ptpp-cdp-magnet-${Date.now()}`;
  } catch {
    return `ptpp-cdp-magnet-${Date.now()}`;
  }
}

function taskNameFromTorrentPayload(payload) {
  const text = payload.toString("latin1");
  const filename = text.match(/filename="([^"]+\.torrent)"/i)?.[1];
  if (filename) return path.basename(filename, ".torrent");
  const namePrefix = /4:name(\d+):/g;
  for (const match of text.matchAll(namePrefix)) {
    const length = Number(match[1]);
    const valueStart = (match.index ?? 0) + match[0].length;
    const name = text.slice(valueStart, valueStart + length);
    if (name.startsWith("ptpp-cdp-")) return name;
  }
  return `ptpp-cdp-file-${Date.now()}`;
}

async function listenLoopback(server, port) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

function createQbittorrentMock() {
  const torrents = new Map();
  const deletions = [];
  const requests = [];
  const server = http.createServer(async (request, response) => {
    writeCors(response, request);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url, "http://127.0.0.1");
    const route = url.pathname;
    requests.push(`${request.method} ${route}`);
    if (route.endsWith("/auth/login")) {
      response.writeHead(200, { "Content-Type": "text/plain" }).end("Ok.");
      return;
    }
    if (route.endsWith("/app/version")) {
      response.writeHead(200, { "Content-Type": "text/plain" }).end("v5.2.0");
      return;
    }
    if (route.endsWith("/app/webapiVersion")) {
      response.writeHead(200, { "Content-Type": "text/plain" }).end("2.11.0");
      return;
    }
    if (route.endsWith("/sync/maindata")) {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({
            rid: Date.now(),
            full_update: true,
            torrents: Object.fromEntries(torrents),
            server_state: {
              dl_info_speed: 2048,
              up_info_speed: 1024,
              dl_info_data: 5_242_880,
              up_info_data: 10_485_760,
              free_space_on_disk: 53_687_091_200,
            },
          }),
        );
      return;
    }
    if (route.endsWith("/torrents/add")) {
      const body = await readRequestBody(request);
      const bodyText = body.toString("latin1");
      const magnet = bodyText.match(/magnet:\?[^\r\n]+/)?.[0];
      const name = magnet ? taskNameFromMagnet(magnet) : taskNameFromTorrentPayload(body);
      const hash = crypto.createHash("sha1").update(name).digest("hex");
      torrents.set(hash, {
        name,
        hash,
        magnet_uri: magnet ?? "",
        added_on: Math.floor(Date.now() / 1000),
        size: 1,
        progress: 0,
        dlspeed: 2048,
        upspeed: 1024,
        ratio: 0.5,
        state: "downloading",
        downloaded: 0,
        uploaded: 0,
        save_path: "/downloads/mock-qbit",
        total_size: 1,
        category: "ptpp-cdp",
      });
      response.writeHead(200, { "Content-Type": "text/plain" }).end("Ok.");
      return;
    }
    if (/\/torrents\/(?:stop|pause|start|resume|delete)$/.test(route)) {
      const params = new URLSearchParams((await readRequestBody(request)).toString());
      const ids = (params.get("hashes") ?? "").split("|").filter(Boolean);
      if (route.endsWith("/delete")) {
        deletions.push(params.get("deleteFiles") === "true");
        for (const id of ids) torrents.delete(id);
      } else {
        const paused = route.endsWith("/stop") || route.endsWith("/pause");
        for (const id of ids) {
          const torrent = torrents.get(id);
          if (torrent) torrent.state = paused ? "pausedDL" : "downloading";
        }
      }
      response.writeHead(200, { "Content-Type": "text/plain" }).end("Ok.");
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  });
  return { server, torrents, deletions, requests };
}

function createTransmissionMock() {
  const torrents = new Map();
  const deletions = [];
  const requests = [];
  let nextId = 1;
  const server = http.createServer(async (request, response) => {
    writeCors(response, request);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (!request.url?.includes("/transmission/rpc")) {
      response.writeHead(404).end("Not found");
      return;
    }
    const payload = JSON.parse((await readRequestBody(request)).toString() || "{}");
    requests.push(payload.method ?? "unknown");
    const args = payload.arguments ?? {};
    let resultArguments = {};
    if (payload.method === "session-get") {
      resultArguments = {
        version: "4.0.6",
        "rpc-version": 17,
        "download-dir": "/downloads/mock-transmission",
        "download-dir-free-space": 53_687_091_200,
      };
    } else if (payload.method === "session-stats") {
      resultArguments = {
        downloadSpeed: 4096,
        uploadSpeed: 1024,
        torrentCount: torrents.size,
        "current-stats": { downloadedBytes: 5_242_880, uploadedBytes: 10_485_760 },
        "cumulative-stats": { downloadedBytes: 5_242_880, uploadedBytes: 10_485_760 },
      };
    } else if (payload.method === "torrent-get") {
      resultArguments = { torrents: [...torrents.values()] };
    } else if (payload.method === "torrent-add") {
      const name = args.filename
        ? taskNameFromMagnet(args.filename)
        : taskNameFromTorrentPayload(Buffer.from(args.metainfo ?? "", "base64"));
      requests.push({
        method: "torrent-add-payload",
        name,
        hasFilename: Boolean(args.filename),
        metainfoLength: String(args.metainfo ?? "").length,
        argumentKeys: Object.keys(args),
      });
      const id = nextId++;
      const hashString = crypto.createHash("sha1").update(name).digest("hex");
      torrents.set(id, {
        addedDate: Math.floor(Date.now() / 1000),
        id,
        hashString,
        isFinished: false,
        name,
        percentDone: 0,
        uploadRatio: 0.5,
        downloadDir: args["download-dir"] || "/downloads/mock-transmission",
        status: args.paused ? 0 : 4,
        totalSize: 1,
        leftUntilDone: 1,
        labels: args.labels ?? ["ptpp-cdp"],
        rateDownload: 4096,
        rateUpload: 1024,
        uploadedEver: 0,
        downloadedEver: 0,
        trackers: [],
      });
      resultArguments = { "torrent-added": { id, hashString, name } };
    } else if (["torrent-stop", "torrent-start"].includes(payload.method)) {
      for (const id of Array.isArray(args.ids) ? args.ids : [args.ids]) {
        const torrent = torrents.get(Number(id));
        if (torrent) torrent.status = payload.method === "torrent-stop" ? 0 : 4;
      }
    } else if (payload.method === "torrent-remove") {
      deletions.push(Boolean(args["delete-local-data"]));
      for (const id of Array.isArray(args.ids) ? args.ids : [args.ids]) torrents.delete(Number(id));
    }
    response.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({ arguments: resultArguments, result: "success" }),
    );
  });
  return { server, torrents, deletions, requests };
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`My Downloader CDP audit failed: ${message}${suffix}`);
  }
}

class CdpSession {
  constructor(webSocketDebuggerUrl) {
    this.socket = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.runtimeErrors = [];
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
        this.runtimeErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        if (entry.source !== "network" || entry.url?.startsWith("chrome-extension://")) {
          this.runtimeErrors.push(entry.text);
        }
      }
    });
    return this;
  }

  call(method, params = {}, timeout = 30_000) {
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

async function evaluate(session, expression) {
  const result = await session.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(callback, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
}

const visibleElementPredicate = `(element) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const overlay = element.closest('.v-overlay');
  return (!overlay || overlay.classList.contains('v-overlay--active')) &&
    style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}`;

async function clickMatching(session, selector, pattern, description) {
  const clicked = await evaluate(
    session,
    `(() => {
      const visible = ${visibleElementPredicate};
      const regex = new RegExp(${JSON.stringify(pattern)}, 'i');
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) =>
        visible(candidate) && [candidate.textContent, candidate.getAttribute('title'), candidate.getAttribute('aria-label')]
          .filter(Boolean)
          .some((value) => regex.test(value.trim()))
      );
      if (!element) return false;
      element.click();
      return true;
    })()`,
  );
  assert(clicked, description);
}

async function setNativeValue(session, selector, value) {
  return evaluate(
    session,
    `(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(${visibleElementPredicate});
      if (!element) return false;
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
      descriptor.set.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
}

async function setFileInput(session, filePath) {
  const { root } = await session.call("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await session.call("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: '[role="dialog"].v-overlay--active input[type="file"]',
  });
  assert(nodeId, "the .torrent upload input exists");
  await session.call("DOM.setFileInputFiles", { nodeId, files: [filePath] });
}

async function navigateToDashboard(session) {
  await evaluate(
    session,
    `location.hash = '#/my-data'; new Promise((resolve) => setTimeout(() => { location.hash = '#/my-client'; setTimeout(resolve, 900); }, 300))`,
  );
  await waitFor(
    () => evaluate(session, `/我的下载器|My Downloader/i.test(document.body.innerText) && location.hash === '#/my-client'`),
    "the My Downloader route",
  );
}

async function clickRefresh(session) {
  await clickMatching(session, "button", "^(刷新|Refresh)$", "the manual refresh button is available");
  await waitFor(
    () => evaluate(session, `![...document.querySelectorAll('button')].some((button) => button.disabled && /^(刷新|Refresh)$/.test(button.innerText.trim()))`),
    "manual refresh to finish",
    60_000,
  );
}

function createTorrentFile(name) {
  const announce = "http://127.0.0.1:9/announce";
  const pieces = "00000000000000000000";
  const payload = `d8:announce${Buffer.byteLength(announce)}:${announce}4:infod6:lengthi1e4:name${Buffer.byteLength(name)}:${name}12:piece lengthi16384e6:pieces20:${pieces}ee`;
  const filePath = path.join(os.tmpdir(), `${name}.torrent`);
  fs.writeFileSync(filePath, payload);
  return filePath;
}

async function ensureQuickTargetList(session) {
  const hasQuickTargets = await evaluate(
    session,
    `(() => { const visible = ${visibleElementPredicate}; return [...document.querySelectorAll('[role="dialog"].v-overlay--active .v-list-item')].some(visible); })()`,
  );
  if (hasQuickTargets) return;
  await clickMatching(session, '[role="dialog"] button', "更多选项|More options", "the download dialog exposes its quick-target toggle");
  await waitFor(
    () =>
      evaluate(
        session,
        `(() => { const visible = ${visibleElementPredicate}; return [...document.querySelectorAll('[role="dialog"].v-overlay--active .v-list-item')].some(visible); })()`,
      ),
    "quick downloader targets",
  );
}

async function waitForVisibleDialog(session, pattern, description) {
  return waitFor(
    () =>
      evaluate(
        session,
        `(() => {
          const visible = ${visibleElementPredicate};
          const regex = new RegExp(${JSON.stringify(pattern)}, 'i');
          return [...document.querySelectorAll('[role="dialog"].v-overlay--active')].some(
            (dialog) => visible(dialog) && regex.test(dialog.textContent),
          );
        })()`,
      ),
    description,
  );
}

async function submitFileToDownloader(session, downloaderName, taskName) {
  const filePath = createTorrentFile(taskName);
  try {
    await clickMatching(session, "button", "推送到下载器|Push to Downloader", "the PTPP push button is available");
    await waitForVisibleDialog(session, "推送到下载器|Push to Downloader", "push dialog");
    await clickMatching(session, "button", "^(种子文件|Torrent File)$", "the file upload mode is available");
    await waitFor(
      () => evaluate(session, `Boolean(document.querySelector('[role="dialog"].v-overlay--active input[type="file"]'))`),
      "the .torrent upload input",
    );
    await setFileInput(session, filePath);
    await clickMatching(session, '[role="dialog"] button', "^(确定|完成|OK|Complete)$", "the file upload can continue");
    await waitFor(
      () =>
        evaluate(
          session,
          `/为 .* 个种子选择下载器|Select downloader for/i.test(document.querySelector('[role="dialog"].v-overlay--active')?.textContent ?? '')`,
        ),
      "downloader target dialog",
    );
    await ensureQuickTargetList(session);
    await clickMatching(
      session,
      '[role="dialog"] .v-list-item',
      `^\\s*${downloaderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      `${downloaderName} is an allowed quick target`,
    );
    await waitFor(
      () => evaluate(session, `document.querySelectorAll('[role="dialog"].v-overlay--active').length === 0`),
      `${downloaderName} file push to finish`,
      60_000,
    );
    return await evaluate(
      session,
      `(() => ({ snackbars: [...document.querySelectorAll('.v-snackbar')].map((item) => item.innerText), bodyTail: document.body.innerText.slice(-400) }))()`,
    );
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

async function submitMagnetToDownloader(session, downloaderName, taskName) {
  const hash = crypto.createHash("sha1").update(taskName).digest("hex");
  const magnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(taskName)}`;
  await clickMatching(session, "button", "推送到下载器|Push to Downloader", "the PTPP push button is available");
  await waitForVisibleDialog(session, "推送到下载器|Push to Downloader", "push dialog");
  await clickMatching(session, '[role="dialog"] button', "链接 / 磁力|Link / Magnet", "the URL/magnet mode is available");
  await waitFor(
    () => evaluate(session, `Boolean(document.querySelector('[role="dialog"].v-overlay--active textarea'))`),
    "the URL/magnet input",
  );
  const inputSet = await setNativeValue(session, "textarea", magnet);
  assert(inputSet, "the URL/magnet input accepts a task");
  await clickMatching(session, '[role="dialog"] button', "^(确定|完成|OK|Complete)$", "the magnet input can continue");
  await waitFor(
    () =>
      evaluate(
        session,
        `/为 .* 个种子选择下载器|Select downloader for/i.test(document.querySelector('[role="dialog"].v-overlay--active')?.textContent ?? '')`,
      ),
    "downloader target dialog",
  );
  await ensureQuickTargetList(session);
  await clickMatching(
    session,
    '[role="dialog"] .v-list-item',
    `^\\s*${downloaderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    `${downloaderName} is an allowed quick target`,
  );
  await waitFor(
    () => evaluate(session, `document.querySelectorAll('[role="dialog"].v-overlay--active').length === 0`),
    `${downloaderName} magnet push to finish`,
    60_000,
  );
  return await evaluate(
    session,
    `(() => ({ snackbars: [...document.querySelectorAll('.v-snackbar')].map((item) => item.innerText), bodyTail: document.body.innerText.slice(-400) }))()`,
  );
}

async function waitForTask(session, taskName) {
  await clickRefresh(session);
  return waitFor(
    async () => {
      const found = await evaluate(
        session,
        `[...document.querySelectorAll('tbody tr')].some((row) => row.innerText.includes(${JSON.stringify(taskName)}))`,
      );
      if (!found) {
        await clickRefresh(session);
        return false;
      }
      return true;
    },
    `${taskName} to appear in the real downloader list`,
    60_000,
  );
}

async function selectTask(session, taskName) {
  const selected = await evaluate(
    session,
    `(() => {
      const row = [...document.querySelectorAll('tbody tr')].find((candidate) => candidate.innerText.includes(${JSON.stringify(taskName)}));
      const checkbox = row?.querySelector('input[type="checkbox"]');
      if (!checkbox) return false;
      if (!checkbox.checked) checkbox.click();
      return checkbox.checked;
    })()`,
  );
  assert(selected, `${taskName} can be selected without selecting another downloader's task`);
}

async function operateSelected(session, pattern, description) {
  await clickMatching(session, "button", pattern, description);
  await waitFor(
    () => evaluate(session, `document.querySelectorAll('tbody input[type="checkbox"]:checked').length === 0`),
    `${description} to finish`,
    60_000,
  );
}

async function deleteTask(session, taskName, removeData) {
  await selectTask(session, taskName);
  await clickMatching(session, "button", "^(删除|Delete)$", "selected tasks expose the PTPP delete action");
  await waitFor(() => evaluate(session, `document.querySelectorAll('[role="dialog"].v-overlay--active').length > 0`), "delete confirmation");
  const initialRemoveData = await evaluate(
    session,
    `document.querySelector('[role="dialog"].v-overlay--active input[type="checkbox"]')?.checked ?? null`,
  );
  assert(initialRemoveData === false, "remove-data is disabled by default");
  if (removeData) {
    const toggled = await evaluate(
      session,
      `(() => { const input = document.querySelector('[role="dialog"].v-overlay--active input[type="checkbox"]'); if (!input) return false; input.click(); return input.checked; })()`,
    );
    assert(toggled, "the destructive remove-data option can be explicitly enabled");
  }
  await clickMatching(session, '[role="dialog"] button', "^(确定|完成|OK|Complete)$", "delete confirmation can be submitted");
  await waitFor(
    () => evaluate(session, `![...document.querySelectorAll('tbody tr')].some((row) => row.innerText.includes(${JSON.stringify(taskName)}))`),
    `${taskName} to be removed and the stale selection to clear`,
    60_000,
  );
  const selectedCount = await evaluate(session, `document.querySelectorAll('tbody input[type="checkbox"]:checked').length`);
  assert(selectedCount === 0, "task deletion clears stale row selection");
}

async function assertSiteTargetPriority(session) {
  await clickMatching(session, "button", "推送到下载器|Push to Downloader", "the PTPP push button is available");
  await waitFor(() => evaluate(session, `document.querySelectorAll('[role="dialog"].v-overlay--active').length > 0`), "push dialog");
  await sleep(400);
  await clickMatching(session, '[role="dialog"] button', "链接 / 磁力|Link / Magnet", "the site URL mode is available");
  await waitFor(
    () => evaluate(session, `Boolean(document.querySelector('[role="dialog"].v-overlay--active textarea'))`),
    "the site URL input",
  );
  const inputSet = await setNativeValue(session, "[role=\"dialog\"].v-overlay--active textarea", "https://azusa.wiki/download.php?id=0");
  assert(inputSet, "a recognized site URL can be entered");
  await clickMatching(session, '[role="dialog"] button', "^(确定|完成|OK|Complete)$", "the site URL can continue");
  await waitFor(
    () =>
      evaluate(
        session,
        `/为 .* 个种子选择下载器|Select downloader for/i.test(document.querySelector('[role="dialog"].v-overlay--active')?.textContent ?? '')`,
      ),
    "site target dialog",
  );
  await ensureQuickTargetList(session);
  const targetState = await evaluate(
    session,
    `(() => ({
      siteTargets: [...document.querySelectorAll('[role="dialog"].v-overlay--active .v-list-item')].filter((item) => /站点专用|Site/.test(item.textContent)).length,
      text: [...document.querySelectorAll('[role="dialog"].v-overlay--active .v-list-item')].map((item) => item.textContent).join('\\n')
    }))()`,
  );
  assert(targetState.siteTargets > 0, "recognized site URLs keep site-bound downloader/directory targets ahead of general targets");
  await clickMatching(session, '[role="dialog"] button', "^(取消|Cancel)$", "the target dialog can be cancelled without a download");
  await waitFor(() => evaluate(session, `document.querySelectorAll('[role="dialog"].v-overlay--active').length === 0`), "site target dialog to close");
}

const qbittorrentMock = createQbittorrentMock();
const transmissionMock = createTransmissionMock();
await listenLoopback(qbittorrentMock.server, 0);
await listenLoopback(transmissionMock.server, 0);
const qbittorrentPort = qbittorrentMock.server.address().port;
const transmissionPort = transmissionMock.server.address().port;

const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
let optionsTarget = targets.find(
  (target) =>
    target.type === "page" &&
    target.url.startsWith("chrome-extension://") &&
    target.url.includes("/src/entries/options/index.html"),
);
if (!optionsTarget) {
  const extensionTarget = targets.find((target) => target.url?.startsWith("chrome-extension://"));
  const extensionId = extensionTarget?.url?.match(/^chrome-extension:\/\/([^/]+)/)?.[1];
  assert(extensionId, "the running extension identity can create an options target");
  const browserVersion = await fetch(`${endpoint}/json/version`).then((response) => response.json());
  const browserSession = await new CdpSession(browserVersion.webSocketDebuggerUrl).open();
  const { targetId } = await browserSession.call("Target.createTarget", {
    url: `chrome-extension://${extensionId}/src/entries/options/index.html#/my-client`,
  });
  browserSession.close();
  optionsTarget = await waitFor(async () => {
    const currentTargets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
    return currentTargets.find((target) => target.id === targetId && target.webSocketDebuggerUrl);
  }, "the My Downloader options target");
}
assert(optionsTarget?.webSocketDebuggerUrl, `an options target exists at ${endpoint}`);

const session = await new CdpSession(optionsTarget.webSocketDebuggerUrl).open();
let storageSnapshotReady = false;
const createdTaskNames = [];
const restoreAuditStateExpression = `(() => {
  const snapshot = globalThis.__ptppClientAuditSnapshot;
  if (!snapshot) return Promise.resolve();
  return Promise.all([
    chrome.storage.local.set({ metadata: snapshot.metadata, config: snapshot.config }),
    new Promise((resolve, reject) => {
      const request = indexedDB.open('ptd');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('download_history', 'readwrite');
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => resolve(true);
        const store = transaction.objectStore('download_history');
        store.clear();
        for (const row of snapshot.downloadHistory) store.put(row);
      };
    })
  ]);
})()`;

try {
  await session.call("Runtime.enable");
  await session.call("Log.enable");
  await session.call("Page.enable");
  await session.call("DOM.enable");
  await session.call("Page.bringToFront");

  const state = await evaluate(
    session,
    `Promise.all([
      chrome.storage.local.get(['metadata', 'config']),
      new Promise((resolve, reject) => {
        const request = indexedDB.open('ptd');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction('download_history', 'readonly');
          const rows = transaction.objectStore('download_history').getAll();
          rows.onerror = () => reject(rows.error);
          rows.onsuccess = () => resolve(rows.result);
        };
      })
    ]).then(([{ metadata, config }, downloadHistory]) => {
      globalThis.__ptppClientAuditSnapshot = {
        metadata: structuredClone(metadata),
        config: structuredClone(config),
        downloadHistory: structuredClone(downloadHistory)
      };
      return {
        downloaders: Object.values(metadata?.downloaders ?? {}).map(({ id, name, type, enabled, address }) => ({ id, name, type, enabled, hasAddress: Boolean(address) })),
        siteProfileCount: Object.keys(metadata?.siteDownloadProfiles ?? {}).length,
        interval: config?.download?.clientAutoRefreshInterval
      };
    })`,
  );
  storageSnapshotReady = true;
  const enabledSupported = state.downloaders.filter(
    (downloader) => downloader.enabled && ["qBittorrent", "Transmission"].includes(downloader.type),
  );
  assert(enabledSupported.length === 2, "the isolated profile has one enabled qBittorrent and one enabled Transmission", state);
  assert(
    enabledSupported.every((downloader) => downloader.hasAddress),
    "both supported clients retain configured addresses without exposing them in audit output",
  );
  assert(state.siteProfileCount > 0, "site download profiles are available for target-priority verification");

  if (!useConfiguredClients) {
    await evaluate(
      session,
      `chrome.storage.local.get('metadata').then(({ metadata }) => {
        for (const downloader of Object.values(metadata.downloaders ?? {})) {
          if (downloader.type === 'qBittorrent') {
            downloader.address = ${JSON.stringify(`http://127.0.0.1:${qbittorrentPort}`)};
            downloader.timeout = 5_000;
          } else if (downloader.type === 'Transmission') {
            downloader.address = ${JSON.stringify(`http://127.0.0.1:${transmissionPort}`)};
            downloader.timeout = 5_000;
          }
        }
        return chrome.storage.local.set({ metadata });
      })`,
    );
    await sleep(500);
  }

  await navigateToDashboard(session);
  const shell = await evaluate(
    session,
    `(() => ({
      navEntry: [...document.querySelectorAll('a[href]')].some((anchor) => anchor.getAttribute('href')?.includes('/my-client')),
      body: document.body.innerText,
      rawJsonEntry: /查看原始数据|View Raw|Raw JSON/i.test(document.body.innerText),
      unsupportedNames: ${JSON.stringify(state.downloaders.filter((d) => !["qBittorrent", "Transmission"].includes(d.type)).map((d) => d.name))}.filter((name) => document.body.innerText.includes(name)),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }))()`,
  );
  assert(shell.navEntry, "My Downloader is registered in the Overview navigation");
  assert(!shell.rawJsonEntry, "the page does not expose unsanitized raw JSON");
  assert(shell.unsupportedNames.length === 0, "PTD-only downloader types are not exposed", shell.unsupportedNames);
  assert(!shell.overflowX, "the PTPP downloader page has no page-level horizontal overflow");

  await clickRefresh(session);
  await clickMatching(session, "button", "全部下载器状态|All Downloaders Status", "the aggregate client-status button is available");
  await waitFor(() => evaluate(session, `document.querySelectorAll('[role="dialog"].v-overlay--active').length > 0`), "client status dialog");
  const statusDialog = await waitFor(
    () =>
      evaluate(
        session,
        `(() => { const text = document.querySelector('[role="dialog"].v-overlay--active')?.textContent ?? ''; return ${JSON.stringify(enabledSupported.map((d) => d.name))}.every((name) => text.includes(name)) ? { textLength: text.length, clientCount: ${enabledSupported.length} } : null; })()`,
      ),
    "both real client status rows",
    60_000,
  );
  assert(statusDialog.clientCount === 2, "status/version/speed aggregation covers both supported clients");
  await clickMatching(session, '[role="dialog"] button', "关闭|Close", "the status dialog can close");
  await waitFor(() => evaluate(session, `document.querySelectorAll('[role="dialog"].v-overlay--active').length === 0`), "status dialog to close");

  await assertSiteTargetPriority(session);

  for (const downloader of enabledSupported) {
    const safeType = downloader.type === "qBittorrent" ? "qbit" : "transmission";
    const fileTaskName = `ptpp-cdp-${safeType}-file-${Date.now()}`;
    createdTaskNames.push(fileTaskName);
    const filePushFeedback = await submitFileToDownloader(session, downloader.name, fileTaskName);
    const protocolMock = downloader.type === "qBittorrent" ? qbittorrentMock : transmissionMock;
    if (!useConfiguredClients) {
      await waitFor(
        () => [...protocolMock.torrents.values()].some((torrent) => torrent.name === fileTaskName),
        `${downloader.type} adapter to receive the uploaded .torrent`,
        10_000,
      ).catch(async (error) => {
        const uiState = await evaluate(
          session,
          `(() => ({ dialogs: [...document.querySelectorAll('[role="dialog"]')].map((item) => item.innerText), snackbars: [...document.querySelectorAll('.v-snackbar')].map((item) => item.innerText), text: document.body.innerText.slice(-1000) }))()`,
        );
        throw new Error(
          `${error.message}\nRequests: ${JSON.stringify(protocolMock.requests)}\nMock torrents: ${JSON.stringify([...protocolMock.torrents.values()].map((torrent) => ({ id: torrent.id ?? torrent.hash, name: torrent.name, savePath: torrent.downloadDir ?? torrent.save_path })))}\nPush feedback: ${JSON.stringify(filePushFeedback)}\nUI: ${JSON.stringify(uiState)}`,
        );
      });
    }
    await waitForTask(session, fileTaskName);
    await selectTask(session, fileTaskName);
    await operateSelected(session, "^(暂停|Pause)$", `${downloader.type} batch pause`);
    await selectTask(session, fileTaskName);
    await operateSelected(session, "^(开始|继续|Resume)$", `${downloader.type} batch resume`);
    await deleteTask(session, fileTaskName, false);

    const magnetTaskName = `ptpp-cdp-${safeType}-magnet-${Date.now()}`;
    createdTaskNames.push(magnetTaskName);
    const magnetPushFeedback = await submitMagnetToDownloader(session, downloader.name, magnetTaskName);
    if (!useConfiguredClients) {
      await waitFor(
        () => [...protocolMock.torrents.values()].some((torrent) => torrent.name === magnetTaskName),
        `${downloader.type} adapter to receive the magnet URL`,
        10_000,
      ).catch(async (error) => {
        const uiState = await evaluate(
          session,
          `(() => ({ dialogs: [...document.querySelectorAll('[role="dialog"]')].map((item) => item.innerText), snackbars: [...document.querySelectorAll('.v-snackbar')].map((item) => item.innerText) }))()`,
        );
        throw new Error(
          `${error.message}\nRequests: ${JSON.stringify(protocolMock.requests)}\nPush feedback: ${JSON.stringify(magnetPushFeedback)}\nUI: ${JSON.stringify(uiState)}`,
        );
      });
    }
    await waitForTask(session, magnetTaskName);
    await deleteTask(session, magnetTaskName, true);
  }

  if (!useConfiguredClients) {
    const disconnected = enabledSupported[0];
    const other = enabledSupported[1];
    const otherMock = other.type === "qBittorrent" ? qbittorrentMock : transmissionMock;
    const otherListRequestCount = () =>
      otherMock.requests.filter((request) =>
        typeof request === "string" &&
        (request.endsWith("/sync/maindata") || request === "torrent-get"),
      ).length;
    await evaluate(
      session,
      `chrome.storage.local.get(['metadata', 'config']).then(({ metadata, config }) => {
        metadata.downloaders[${JSON.stringify(disconnected.id)}].address = 'http://127.0.0.1:9';
        config.download.clientAutoRefreshInterval = 5;
        return chrome.storage.local.set({ metadata, config });
      })`,
    );
    await sleep(500);
    await clickRefresh(session);
    const connectedListRequestsBeforeAutoRefresh = otherListRequestCount();
    await clickMatching(session, "button", "自动刷新|Auto-Refresh", "the foreground auto-refresh menu is available");
    const initialAutoRefreshMenuState = await waitFor(
      () =>
        evaluate(
          session,
          `(() => {
            const visible = ${visibleElementPredicate};
          const texts = [...document.querySelectorAll('button')]
            .filter(visible)
            .map((button) => button.textContent.trim());
            if (texts.some((text) => /停止自动刷新|Stop auto-refresh/i.test(text))) return 'running';
            if (texts.some((text) => /开始自动刷新|Start auto-refresh/i.test(text))) return 'stopped';
            return '';
          })()`,
        ),
      "the foreground auto-refresh controls",
    );
    if (initialAutoRefreshMenuState === "running") {
      await clickMatching(session, "button", "停止自动刷新|Stop auto-refresh", "a previous audit timer can be stopped");
      await sleep(250);
      const startStillVisible = await evaluate(
        session,
        `(() => { const visible = ${visibleElementPredicate}; return [...document.querySelectorAll('button')].some((button) => visible(button) && /开始自动刷新|Start auto-refresh/i.test(button.textContent)); })()`,
      );
      if (!startStillVisible) {
        await clickMatching(session, "button", "自动刷新|Auto-Refresh", "the stopped auto-refresh menu can reopen");
      }
    }
    await waitFor(
      () =>
        evaluate(
          session,
          `(() => { const visible = ${visibleElementPredicate}; return [...document.querySelectorAll('button')].some((button) => visible(button) && /开始自动刷新|Start auto-refresh/i.test(button.textContent)); })()`,
        ),
      "the auto-refresh start control",
    );
    await clickMatching(session, "button", "开始自动刷新|Start auto-refresh", "foreground auto-refresh can start");
    await clickMatching(session, "button", "全部下载器状态|All Downloaders Status", "client isolation remains inspectable");
    await waitFor(() => evaluate(session, `document.querySelectorAll('[role="dialog"].v-overlay--active').length > 0`), "client status dialog");
    const suspension = await waitFor(
      () =>
        evaluate(
          session,
          `(() => {
            const dialog = document.querySelector('[role="dialog"].v-overlay--active');
            const text = dialog?.textContent ?? '';
            const resumeButton = [...(dialog?.querySelectorAll('button') ?? [])].find((button) =>
              /恢复该下载器的自动刷新|Resume auto-refresh/i.test(button.title)
            );
            const bothClientsVisible = ${JSON.stringify([disconnected.name, other.name])}.every((name) => text.includes(name));
            const hasSanitizedReason = /Network Error|Failed to fetch|ERR_|请求失败|网络|连接/i.test(text);
            return resumeButton && bothClientsVisible && hasSanitizedReason
              ? { suspended: true, bothClientsVisible, hasSanitizedReason, resumeTitle: resumeButton.title }
              : null;
          })()`,
        ),
      "one disconnected client to expose a persistent suspended state and sanitized reason",
      25_000,
    );
    assert(
      suspension.suspended && suspension.bothClientsVisible && suspension.hasSanitizedReason,
      "three failures suspend only the disconnected downloader and preserve its reason",
      suspension,
    );
    assert(
      otherListRequestCount() >= connectedListRequestsBeforeAutoRefresh + 2,
      "the connected downloader continues refreshing while the failed downloader is isolated",
      {
        before: connectedListRequestsBeforeAutoRefresh,
        after: otherListRequestCount(),
        requests: otherMock.requests,
      },
    );
    await clickMatching(session, '[role="dialog"] button', "关闭|Close", "the post-failure status dialog can close");
    await waitFor(() => evaluate(session, `document.querySelectorAll('[role="dialog"].v-overlay--active').length === 0`), "status dialog to close");
    await clickMatching(session, "button", "自动刷新|Auto-Refresh", "the auto-refresh menu can reopen");
    const stopPresent = await evaluate(
      session,
      `(() => { const visible = ${visibleElementPredicate}; return [...document.querySelectorAll('button')].some((button) => visible(button) && /停止自动刷新|Stop auto-refresh/i.test(button.textContent)); })()`,
    );
    if (stopPresent) await clickMatching(session, "button", "停止自动刷新|Stop auto-refresh", "auto-refresh can stop");
  }

  await evaluate(
    session,
    restoreAuditStateExpression,
  );
  await sleep(500);

  const selectedAfterOperations = await evaluate(session, `document.querySelectorAll('tbody input[type="checkbox"]:checked').length`);
  assert(selectedAfterOperations === 0, "all batch operations finish without stale selection");
  if (!useConfiguredClients) {
    assert(
      qbittorrentMock.deletions.includes(false) && qbittorrentMock.deletions.includes(true),
      "qBittorrent received both keep-data and remove-data delete requests",
      qbittorrentMock.deletions,
    );
    assert(
      transmissionMock.deletions.includes(false) && transmissionMock.deletions.includes(true),
      "Transmission received both keep-data and remove-data delete requests",
      transmissionMock.deletions,
    );
  }
  assert(session.runtimeErrors.length === 0, "My Downloader produced no runtime exceptions", session.runtimeErrors);

  console.log(
    JSON.stringify({
      check: useConfiguredClients
        ? "My Downloader configured-client acceptance"
        : "My Downloader loopback-protocol acceptance",
      browserEndpoint: endpoint,
      supportedTypes: enabledSupported.map((downloader) => downloader.type),
      tasksCreatedAndRemoved: createdTaskNames.length,
      siteTargetPriority: true,
      disconnectedIsolation: useConfiguredClients ? "covered by loopback protocol audit" : true,
      runtimeErrors: 0,
    }),
  );
} finally {
  if (storageSnapshotReady) {
    await evaluate(session, restoreAuditStateExpression).catch(() => undefined);
  }
  session.close();
  await Promise.all([
    new Promise((resolve) => qbittorrentMock.server.close(resolve)),
    new Promise((resolve) => transmissionMock.server.close(resolve)),
  ]);
}
