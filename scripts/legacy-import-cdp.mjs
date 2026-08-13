import process from "node:process";

const [endpoint = "http://127.0.0.1:9223", backupPath, action = "inspect"] = process.argv.slice(2);

if (!backupPath) {
  console.error("Usage: node scripts/legacy-import-cdp.mjs <endpoint> <backup.zip> [inspect|restore]");
  process.exit(2);
}

const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find(
  (item) =>
    item.type === "page" &&
    item.url?.startsWith("chrome-extension://") &&
    item.url.includes("/src/entries/options/index.html"),
);

if (!target?.webSocketDebuggerUrl) {
  throw new Error("No PT-Plugin-Plus options target was found.");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("Unable to connect to the options CDP target.")), {
    once: true,
  });
});

let commandId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`));
  else resolve(message.result);
});

function call(method, params = {}) {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await call("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  return result.result.value;
}

async function waitFor(expression, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

const baseline = await evaluate(
  `chrome.storage.local.get(null).then((data) => ({
    keys: Object.keys(data).sort(),
    sites: Object.keys(data.metadata?.sites ?? {}).length,
    downloaders: Object.keys(data.metadata?.downloaders ?? {}).length,
    userInfoSites: Object.keys(data.userInfo ?? {}).length,
    keepUploadTasks: Array.isArray(data.keepUploadTask) ? data.keepUploadTask.length : Object.keys(data.keepUploadTask ?? {}).length,
  }))`,
  true,
);

await evaluate(`(() => {
  if (document.querySelector('input[type="file"]')) return true;
  const button = [...document.querySelectorAll('button')].find((item) => item.innerText.includes('本地导入'));
  if (!button) throw new Error('Local import button was not found.');
  button.click();
  return true;
})()`);
await waitFor(`Boolean(document.querySelector('input[type="file"]'))`);

const inputResult = await call("Runtime.evaluate", {
  expression: `document.querySelector('input[type="file"]')`,
});
const inputObjectId = inputResult.result.objectId;
if (!inputObjectId) throw new Error("The backup file input could not be resolved.");

await call("DOM.setFileInputFiles", { files: [backupPath], objectId: inputObjectId });
const restoreDialogMatcher = `/已识别为旧版|恢复选项|Restore options|Restore Options/.test(item.innerText)`;
await waitFor(`[...document.querySelectorAll('[role="dialog"]')].some((item) => ${restoreDialogMatcher})`);

const restoreDialog = await evaluate(`(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')]
    .find((item) => ${restoreDialogMatcher});
  return {
    text: dialog?.innerText ?? '',
    controls: [...(dialog?.querySelectorAll('input') ?? [])].map((input) => ({
      type: input.type,
      checked: input.checked,
      disabled: input.disabled,
      label: input.closest('.v-input')?.innerText?.trim() ?? '',
    })),
    buttons: [...(dialog?.querySelectorAll('button') ?? [])].map((button) => ({
      text: button.innerText.trim(),
      disabled: button.disabled,
    })),
  };
})()`);

let restoreResult;
if (action === "restore") {
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((item) => ${restoreDialogMatcher});
    const button = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((item) => /^(完成|确定|Finish|OK)$/i.test(item.innerText.trim()));
    if (!button) throw new Error('Restore confirmation button was not found.');
    button.click();
    return true;
  })()`);
  await waitFor(`![...document.querySelectorAll('[role="dialog"]')].some((item) => ${restoreDialogMatcher})`, 120000);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  restoreResult = await evaluate(
    `chrome.storage.local.get(null).then((data) => ({
    sites: Object.keys(data.metadata?.sites ?? {}).length,
    downloaders: Object.keys(data.metadata?.downloaders ?? {}).length,
    backupServers: Object.keys(data.metadata?.backupServers ?? {}).length,
    userInfoSites: Object.keys(data.userInfo ?? {}).length,
    latestUserInfoSites: Object.keys(data.metadata?.lastUserInfo ?? {}).length,
    searchSnapshots: Array.isArray(data.searchResultSnapshot) ? data.searchResultSnapshot.length : Object.keys(data.searchResultSnapshot ?? {}).length,
    keepUploadTasks: Array.isArray(data.keepUploadTask) ? data.keepUploadTask.length : Object.keys(data.keepUploadTask ?? {}).length,
    collectionItems: Array.isArray(data.collection?.items) ? data.collection.items.length : null,
    collectionGroups: Array.isArray(data.collection?.groups) ? data.collection.groups.length : null,
    bridgeVersion: data.ptppRuntimeMigration?.bridgeVersion ?? data['ptpp.runtime.migration']?.bridgeVersion ?? null,
    visibleNotices: [...document.querySelectorAll('.v-snackbar')].filter((item) => getComputedStyle(item).display !== 'none').map((item) => item.innerText.trim()),
  }))`,
    true,
  );
}

console.log(
  JSON.stringify({ target: { id: target.id, url: target.url }, baseline, restoreDialog, restoreResult }, null, 2),
);
socket.close();
