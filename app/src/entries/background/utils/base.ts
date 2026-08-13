import { stringify } from "urlencode";
import { onMessage } from "@/messages.ts";
import { extStorage } from "@/storage.ts";

const PAGE_CAPTURE_MESSAGE = "PTPP_CAPTURE_NAVIGATION_DOCUMENT";
let captureQueue = Promise.resolve();

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    };
    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(() => finish(new Error("页面导航等待超时")), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs
      .get(tabId)
      .then((tab) => tab.status === "complete" && finish())
      .catch((error) => finish(error));
  });
}

async function captureNavigationDocument(url: string, timeoutMs = 30_000) {
  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error("只允许捕获 HTTP(S) 页面");

  const tab = await chrome.tabs.create({ url: parsedUrl.href, active: false });
  if (typeof tab.id !== "number") throw new Error("无法创建页面导航标签");

  try {
    await waitForTabComplete(tab.id, Math.min(Math.max(timeoutMs, 5_000), 60_000));

    // document_idle content script normally exists before tab completion. A
    // short retry handles the narrow startup race without repeating navigation.
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await chrome.tabs.sendMessage(tab.id, { type: PAGE_CAPTURE_MESSAGE });
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

export function openOptionsPage(url?: string | { path: string; query?: Record<string, any> }) {
  if (url && typeof url !== "string") {
    url = url.path + (url.query ? "?" + stringify(url.query) : "");
  }
  url ??= "/";

  chrome.tabs.create({ url: "/src/entries/options/index.html#" + url }).catch();
}

onMessage("openOptionsPage", async ({ data: url }) => {
  openOptionsPage(url);
});

onMessage("openSiteTabs", async ({ data: urls }) => {
  const uniqueUrls = [...new Set(urls)].filter((url) => {
    try {
      return ["http:", "https:"].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  });
  const opened = await Promise.allSettled(uniqueUrls.map((url) => chrome.tabs.create({ url, active: false })));
  return opened.filter((result) => result.status === "fulfilled").length;
});

onMessage("captureNavigationDocument", async ({ data: { url, timeoutMs } }) => {
  // Some trackers accept normal browser navigation but intentionally reject
  // XHR/fetch. Serialize these exceptional navigations so one user search does
  // not create concurrent page loads.
  const task = captureQueue.then(() => captureNavigationDocument(url, timeoutMs));
  captureQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return await task;
});

onMessage("downloadFile", async ({ data: downloadOptions }) => {
  return await chrome.downloads.download(downloadOptions);
});

// @ts-ignore
onMessage("getExtStorage", async ({ data: key }) => {
  return await extStorage.getItem(key);
});

onMessage("setExtStorage", async ({ data: { key, value } }) => {
  await extStorage.setItem(key, value);
});
