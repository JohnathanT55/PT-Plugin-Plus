import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const artifactDir = process.argv[3] ?? join(tmpdir(), "ptpp-movie-info-cdp");
const expectedManifest = JSON.parse(readFileSync(resolve("dist-chrome/manifest.json"), "utf8"));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
  throw new Error(`Movie information CDP audit failed: ${message}${suffix}`);
}

function sanitizeNetworkWarning(warning) {
  let url = warning.url;
  try {
    const parsed = new URL(url);
    url = `${parsed.origin}${parsed.pathname}`;
  } catch {
    url = "unparseable-url";
  }
  return { label: warning.label, type: warning.type, source: warning.source, text: warning.text, url };
}

class CdpSession {
  constructor(target, label) {
    this.target = target;
    this.label = label;
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.runtimeErrors = [];
    this.networkWarnings = [];
    this.expectedNetworkWarnings = [];
    this.expectNetworkWarnings = false;
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
          (this.expectNetworkWarnings ? this.expectedNetworkWarnings : this.networkWarnings).push(error);
        } else {
          this.runtimeErrors.push(error);
        }
      }
    });
    await this.call("Runtime.enable");
    await this.call("Log.enable");
    await this.call("Log.clear");
    this.runtimeErrors = [];
    this.networkWarnings = [];
    this.expectedNetworkWarnings = [];
    return this;
  }

  call(method, params = {}, timeout = 30_000) {
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

async function evaluate(session, expression, timeout = 30_000) {
  const result = await session.call(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    timeout,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(session, expression, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(session, expression);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

let targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const optionsTarget = targets.find(
  (target) =>
    target.type === "page" &&
    target.url.startsWith("chrome-extension://") &&
    target.url.includes("/src/entries/options/index.html"),
);
const offscreenTarget = targets.find(
  (target) => target.url.startsWith("chrome-extension://") && target.url.includes("/offscreen/offscreen.html"),
);
assert(optionsTarget?.webSocketDebuggerUrl, `no PT-Plugin-Plus options target at ${endpoint}`);
assert(offscreenTarget?.webSocketDebuggerUrl, `no PT-Plugin-Plus offscreen target at ${endpoint}`);

const page = await new CdpSession(optionsTarget, "options").open();
const offscreen = await new CdpSession(offscreenTarget, "offscreen").open();
await page.call("Page.enable");
await page.call("Page.bringToFront");
await page.call("Emulation.setDeviceMetricsOverride", {
  width: 1365,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false,
});
await waitFor(page, `document.querySelector('#ptpp') && document.readyState === 'complete'`, "options application");
const runningManifest = await evaluate(
  page,
  `(() => { const manifest = chrome.runtime.getManifest(); return {
    id: chrome.runtime.id,
    name: manifest.name,
    version: manifest.version,
    versionName: manifest.version_name,
    manifestVersion: manifest.manifest_version,
  }; })()`,
);
assert(runningManifest.name === "PT-Plugin-Plus", "unexpected running extension name", runningManifest);
assert(runningManifest.version === expectedManifest.version, "running extension version differs from dist", {
  runningManifest,
  expectedVersion: expectedManifest.version,
});
assert(runningManifest.versionName === expectedManifest.version_name, "running extension build differs from dist", {
  runningManifest,
  expectedVersionName: expectedManifest.version_name,
});
assert(runningManifest.manifestVersion === 3, "running extension is not Manifest V3", runningManifest);

await evaluate(
  page,
  `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((item) => /欢迎使用|Welcome/i.test(item.innerText));
    const button = dialog && [...dialog.querySelectorAll('button')].find((item) => /开始使用|Get started/i.test(item.innerText));
    button?.click();
    return true;
  })()`,
);

const originalState = await evaluate(
  page,
  `Promise.all([
    chrome.storage.local.get(['config', 'metadata', 'searchResultSnapshot']),
    Promise.resolve(sessionStorage.getItem('__ptd_runtime_store')),
    new Promise((resolve, reject) => {
      const request = indexedDB.open('ptd');
      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        const db = request.result;
        const stores = ['movie_entity', 'movie_alias', 'social_information'];
        try {
          const result = {};
          for (const storeName of stores) {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const [keys, values] = await Promise.all([
              new Promise((res, rej) => { const r = store.getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
              new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
            ]);
            result[storeName] = keys.map((key, index) => [key, values[index]]);
          }
          resolve(result);
        } catch (error) { reject(error); }
      };
    }),
    Promise.resolve(location.hash),
  ]).then(([storage, runtime, database, hash]) => ({ storage, runtime, database, hash }))`,
);

const dbExpression = `new Promise((resolve, reject) => {
  const request = indexedDB.open('ptd');
  request.onerror = () => reject(request.error);
  request.onsuccess = async () => {
    const db = request.result;
    const result = {};
    try {
      for (const storeName of ['movie_entity', 'movie_alias', 'social_information']) {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const [keys, values] = await Promise.all([
          new Promise((res, rej) => { const r = store.getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
          new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
        ]);
        result[storeName] = keys.map((key, index) => [key, values[index]]);
      }
      resolve(result);
    } catch (error) { reject(error); }
  };
})`;

async function database() {
  return evaluate(page, dbExpression);
}

async function clearMovieStores() {
  return evaluate(
    page,
    `new Promise((resolve, reject) => {
      const request = indexedDB.open('ptd');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['movie_entity', 'movie_alias', 'social_information'], 'readwrite');
        for (const storeName of ['movie_entity', 'movie_alias', 'social_information']) tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      };
    })`,
  );
}

async function configure(partial) {
  return evaluate(
    page,
    `(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('config');
      const patch = ${JSON.stringify(partial)};
      if (patch.theme) store.theme = patch.theme;
      if (patch.searchEntity) Object.assign(store.searchEntity, patch.searchEntity);
      if (patch.socialSiteInformation) {
        const { movieEntityCache, socialSite, ...root } = patch.socialSiteInformation;
        Object.assign(store.socialSiteInformation, root);
        if (movieEntityCache) {
          Object.assign(store.socialSiteInformation.movieEntityCache, movieEntityCache);
        }
        if (socialSite) {
          for (const [provider, value] of Object.entries(socialSite)) {
            Object.assign(store.socialSiteInformation.socialSite[provider], value);
          }
        }
      }
      return store.$save().then(() => true);
    })()`,
  );
}

async function navigate(route) {
  await evaluate(page, `location.hash = ${JSON.stringify(`#${route}`)}; true`);
  await waitFor(
    page,
    `location.hash.startsWith(${JSON.stringify(`#${route}`)}) && document.querySelector('#ptpp-main')`,
    route,
  );
  await sleep(150);
}

async function setSearchInput(value, submit = false) {
  await evaluate(
    page,
    `(() => {
      const input = document.querySelector('#ptpp-topbar input[type="search"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (${submit}) input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      return true;
    })()`,
  );
}

async function applyRuntimeMovie(identity, searchKey = identity.boundSearchTerm) {
  await evaluate(
    page,
    `(() => {
      const runtime = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime');
      runtime.search = {
        isSearching: false,
        startAt: Date.now() - 1000,
        endAt: Date.now(),
        searchKey: ${JSON.stringify(searchKey)},
        searchPlanKey: 'default',
        searchPlan: {},
        searchResult: [],
        movieIdentity: ${JSON.stringify(identity)},
      };
      return true;
    })()`,
  );
}

async function setRuntimeMovie(identity, searchKey = identity.boundSearchTerm) {
  await navigate("/my-data");
  await applyRuntimeMovie(identity, searchKey);
  await navigate("/search-entity");
}

async function waitForCard(timeout = 35_000) {
  await waitFor(page, `document.querySelector('.ptpp-movie-card')`, "movie information card", timeout);
  await waitFor(page, `!document.querySelector('.movie-card-body .v-skeleton-loader')`, "settled movie card", timeout);
  return evaluate(page, `document.querySelector('.ptpp-movie-card').innerText`);
}

function movieIdentity({ imdb, title, mediaType = "movie", searchTerm = `imdb|${imdb}`, selectedAt = Date.now() }) {
  return {
    schemaVersion: 1,
    canonicalKey: `imdb:${imdb}`,
    ids: { imdb },
    title,
    aliases: [],
    mediaType,
    binding: "direct-id",
    boundSearchTerm: searchTerm,
    selectedAt,
  };
}

async function seedEntity(identity, options = {}) {
  const now = Date.now();
  const record = {
    identity: {
      schemaVersion: 1,
      canonicalKey: identity.canonicalKey,
      ids: identity.ids,
      title: identity.title,
      aliases: identity.aliases ?? [],
      mediaType: identity.mediaType,
    },
    entity: {
      schemaVersion: 1,
      canonicalKey: identity.canonicalKey,
      ids: identity.ids,
      mediaType: { value: identity.mediaType ?? "movie", source: "imdb", updatedAt: now },
      title: { value: identity.title, source: "imdb", updatedAt: now },
      originalTitle: { value: options.originalTitle ?? identity.title, source: "imdb", updatedAt: now },
      summary: {
        value: options.summary ?? "Chrome CDP isolated-profile movie cache fixture",
        source: "imdb",
        updatedAt: now,
      },
      ratings: {
        imdb: {
          source: "imdb",
          score: 8.8,
          scale: 10,
          updatedAt: now,
          url: `https://www.imdb.com/title/${identity.ids.imdb}/`,
        },
      },
      updatedAt: now,
    },
    providers: options.providers ?? { imdb: { provider: "imdb", state: "success", updatedAt: now } },
    metadataExpiresAt: options.metadataExpiresAt ?? now + 86_400_000,
    ratingsExpiresAt: options.ratingsExpiresAt ?? now + 86_400_000,
    lastAccessedAt: options.lastAccessedAt ?? now,
  };
  await evaluate(
    page,
    `new Promise((resolve, reject) => {
      const request = indexedDB.open('ptd'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction(['movie_entity', 'movie_alias'], 'readwrite');
        tx.objectStore('movie_entity').put(${JSON.stringify(record)}, ${JSON.stringify(identity.canonicalKey)});
        tx.objectStore('movie_alias').put(${JSON.stringify(identity.canonicalKey)}, ${JSON.stringify(`imdb:${identity.ids.imdb}`)});
        tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error);
      };
    })`,
  );
}

let worker;
let result;
try {
  await configure({
    theme: "light",
    searchEntity: { movieSuggestionEnabled: true, movieInfoCardEnabled: true, movieSuggestionCount: 5 },
    socialSiteInformation: {
      timeout: 10_000,
      movieEntityCache: { enabled: true, metadataDays: 7, ratingHours: 24, retentionDays: 30, maxEntries: 200 },
      socialSite: { tmdb: { apikey: "" }, omdb: { apikey: "" } },
    },
  });
  await clearMovieStores();
  await navigate("/search-entity");

  await setSearchInput("无间道");
  const suggestions = await waitFor(
    page,
    `(() => {
      const rows = [...document.querySelectorAll('.ptpp-movie-suggestion')];
      return rows.length >= 2 && rows.every((row) => row.innerText.trim())
        ? rows.map((row) => row.innerText.trim()) : false;
    })()`,
    "ambiguous Douban movie suggestions",
    20_000,
  );
  assert(new Set(suggestions).size === suggestions.length, "candidate rows are distinct", suggestions);
  assert(
    suggestions.some((text) => /\(20\d{2}\)/.test(text)),
    "candidate rows expose disambiguating years",
    suggestions,
  );

  await setSearchInput("肖申克的救赎");
  await waitFor(
    page,
    `(() => [...document.querySelectorAll('.ptpp-movie-suggestion')]
      .some((row) => /肖申克的救赎|Shawshank/i.test(row.innerText)))()`,
    "uniquely identifiable plain-text candidate",
    20_000,
  );
  await setSearchInput("肖申克的救赎", true);
  const inferredIdentity = await waitFor(
    page,
    `(() => {
      const identity = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
        .get('runtime').search.movieIdentity;
      return identity?.binding === 'unambiguous-candidate' ? JSON.parse(JSON.stringify(identity)) : false;
    })()`,
    "unambiguous plain-text movie identity",
    20_000,
  );
  assert(
    /肖申克|Shawshank/i.test(inferredIdentity.title),
    "plain-text identity did not preserve the uniquely matched title",
    inferredIdentity,
  );
  await navigate("/my-data");
  await navigate("/search-entity");
  assert(
    await evaluate(page, `!!document.querySelector('.ptpp-movie-card')`),
    "page-memory identity was lost on navigation",
  );
  await page.call("Page.reload", { ignoreCache: true });
  await sleep(1_500);
  await waitFor(
    page,
    `document.querySelector('#ptpp') && document.readyState === 'complete'`,
    "reloaded options application",
  );
  const reloadedOrdinarySearch = await evaluate(
    page,
    `(() => {
      const runtime = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime');
      return {
        identity: runtime.search.movieIdentity,
        searchKey: runtime.search.searchKey,
        card: !!document.querySelector('.ptpp-movie-card'),
        persistedRuntime: sessionStorage.getItem('__ptd_runtime_store'),
      };
    })()`,
  );
  assert(
    !reloadedOrdinarySearch.identity && !reloadedOrdinarySearch.searchKey && !reloadedOrdinarySearch.card,
    "ordinary search survived a page refresh",
    reloadedOrdinarySearch,
  );
  assert(reloadedOrdinarySearch.persistedRuntime === null, "ordinary search runtime returned after refresh");

  targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
  const workerTarget = targets.find(
    (target) => target.type === "service_worker" && target.url.startsWith("chrome-extension://"),
  );
  assert(workerTarget?.webSocketDebuggerUrl, "MV3 service worker did not wake during real candidate lookup");
  worker = await new CdpSession(workerTarget, "service-worker").open();

  await clearMovieStores();
  await navigate("/my-data");
  await setSearchInput("privacy-probe-ordinary", true);
  await waitFor(
    page,
    `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
      .get('runtime').search.searchKey === 'privacy-probe-ordinary'`,
    "ordinary torrent search state",
  );
  await waitFor(page, `!location.href.includes('privacy-probe-ordinary')`, "redacted ordinary search URL");
  await sleep(700);
  const ordinary = await evaluate(
    page,
    `(() => {
      const runtime = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime');
      return {
        card: !!document.querySelector('.ptpp-movie-card'),
        identity: runtime.search.movieIdentity,
        persistedRuntime: sessionStorage.getItem('__ptd_runtime_store'),
        url: location.href,
      };
    })()`,
  );
  assert(!ordinary.card && !ordinary.identity, "ordinary text search must not silently bind a movie", ordinary);
  assert(ordinary.persistedRuntime === null, "ordinary search state reached sessionStorage", ordinary);
  assert(
    !ordinary.url.includes("privacy-probe-ordinary"),
    "ordinary search term remained in browser history URL",
    ordinary,
  );
  const ordinaryLogs = await evaluate(offscreen, `sessionStorage.getItem('logger') ?? ''`);
  assert(!ordinaryLogs.includes("privacy-probe-ordinary"), "ordinary search term reached diagnostic logs");
  assert(
    !JSON.stringify(await database()).includes("privacy-probe-ordinary"),
    "ordinary search term reached IndexedDB",
  );

  await navigate("/my-data");
  await setSearchInput("imdb|tt0111161", true);
  const directCard = await waitForCard(45_000);
  const directIdentity = await evaluate(
    page,
    `JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime').search.movieIdentity)`,
  );
  assert(
    directIdentity.includes("imdb:tt0111161"),
    "direct IMDb search did not bind its canonical identity",
    directIdentity,
  );
  assert(/Shawshank|肖申克|IMDb/i.test(directCard), "live IMDb card lacks recognizable movie data", directCard);

  const cachedAfterDirect = await database();
  assert(cachedAfterDirect.movie_entity.length >= 1, "direct IMDb lookup did not persist a reusable entity");
  assert(cachedAfterDirect.movie_alias.length >= 1, "external ID aliases were not persisted");
  const longLivedJson = JSON.stringify(cachedAfterDirect);
  assert(!longLivedJson.includes("boundSearchTerm"), "raw bound search term leaked into long-lived cache");
  assert(!longLivedJson.includes("searchResult"), "torrent results leaked into movie cache");

  await evaluate(
    page,
    `(() => {
      const app = document.querySelector('#app').__vue_app__;
      const runtime = app.config.globalProperties.$pinia._s.get('runtime');
      const metadata = app.config.globalProperties.$pinia._s.get('metadata');
      runtime.search.isSearching = false;
      return metadata.saveSearchSnapshotData('9.4 CDP identity snapshot').then(() => true);
    })()`,
  );
  const snapshot = await evaluate(
    page,
    `chrome.storage.local.get(['metadata', 'searchResultSnapshot']).then(({ metadata, searchResultSnapshot }) => {
      const entry = Object.values(metadata.snapshots).find((item) => item.name === '9.4 CDP identity snapshot');
      return { id: entry?.id, data: entry?.id ? searchResultSnapshot[entry.id] : undefined };
    })`,
  );
  assert(
    snapshot.id && snapshot.data?.movieIdentity?.canonicalKey === "imdb:tt0111161",
    "snapshot lost movie identity",
    snapshot,
  );
  await evaluate(
    page,
    `(() => {
      document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime').$reset();
      return true;
    })()`,
  );
  await navigate(`/search-entity?snapshot=${snapshot.id}`);
  await waitFor(
    page,
    `(() => {
      const search = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime').search;
      return search.snapshot === ${JSON.stringify(snapshot.id)} && search.movieIdentity?.canonicalKey === 'imdb:tt0111161';
    })()`,
    "explicit snapshot movie identity restoration",
  );
  await waitForCard();
  const snapshotLogs = await evaluate(offscreen, `sessionStorage.getItem('logger') ?? ''`);
  assert(!snapshotLogs.includes("9.4 CDP identity snapshot"), "snapshot contents were duplicated into diagnostics");
  assert(!snapshotLogs.includes('"searchResult"'), "snapshot torrent results were duplicated into diagnostics");
  await evaluate(
    page,
    `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('metadata')
      .removeSearchSnapshotData(${JSON.stringify(snapshot.id)}).then(() => true)`,
  );

  await navigate("/my-data");
  const offlineIdentity = movieIdentity({ imdb: "tt0137523", title: "Fight Club" });
  await seedEntity(offlineIdentity, {
    metadataExpiresAt: 1,
    ratingsExpiresAt: 1,
    summary: "Expired entity retained for isolated offline-cache validation.",
  });
  await evaluate(
    page,
    `new Promise((resolve, reject) => {
      const request = indexedDB.open('ptd'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('social_information', 'readwrite');
        tx.objectStore('social_information').clear();
        tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error);
      };
    })`,
  );
  await offscreen.call("Network.enable");
  const offlineSessions = [page, offscreen, worker].filter(Boolean);
  for (const session of offlineSessions) session.expectNetworkWarnings = true;
  try {
    await offscreen.call("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await applyRuntimeMovie(offlineIdentity);
    await navigate("/search-entity");
    await waitFor(page, `document.querySelector('.ptpp-movie-card')`, "cached movie card while offline", 12_000);
    await sleep(1_500);
    const staleCard = await evaluate(page, `document.querySelector('.ptpp-movie-card')?.innerText ?? ''`);
    assert(
      /缓存已过期|Updating expired cache/i.test(staleCard),
      "expired cache was not identified while offline",
      staleCard,
    );
    assert(/Fight Club|IMDb/i.test(staleCard), "offline stale cache lost the last successful entity", staleCard);
  } finally {
    await offscreen.call("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await sleep(500);
    for (const session of offlineSessions) session.expectNetworkWarnings = false;
  }

  const tvIdentity = movieIdentity({
    imdb: "tt0944947",
    title: "Game of Thrones",
    mediaType: "tv",
    searchTerm: "imdb|tt0944947",
  });
  await setRuntimeMovie(tvIdentity);
  const tvCard = await waitForCard(45_000);
  assert(/Game of Thrones|权力的游戏|IMDb/i.test(tvCard), "TV identity did not render a usable card", tvCard);

  await clearMovieStores();
  const retryIdentity = movieIdentity({ imdb: "tt4154796", title: "Avengers: Endgame" });
  await seedEntity(retryIdentity, {
    providers: {
      imdb: { provider: "imdb", state: "success", updatedAt: Date.now() },
      omdb: {
        provider: "omdb",
        state: "failed",
        updatedAt: Date.now(),
        retryAfter: Date.now() + 60_000,
        errorCode: "ProviderError",
        errorMessage: "isolated provider failure",
      },
    },
  });
  await setRuntimeMovie(retryIdentity);
  await waitFor(page, `document.querySelector('.provider-failure-row button')`, "provider retry control");
  await evaluate(page, `document.querySelector('.provider-failure-row button').click(); true`);
  await waitFor(
    page,
    `!document.querySelector('.provider-failure-row')`,
    "independent provider retry completion",
    20_000,
  );

  await configure({ socialSiteInformation: { movieEntityCache: { enabled: false } } });
  await clearMovieStores();
  const disabledIdentity = movieIdentity({ imdb: "tt0133093", title: "The Matrix" });
  await setRuntimeMovie(disabledIdentity);
  await waitForCard(45_000);
  const disabledCache = await database();
  assert(disabledCache.movie_entity.length === 0, "disabled aggregate cache still wrote an entity", disabledCache);
  assert(
    disabledCache.social_information.length === 0,
    "disabled provider cache still wrote a fragment",
    disabledCache,
  );

  await configure({ socialSiteInformation: { movieEntityCache: { enabled: true, retentionDays: 1 } } });
  await clearMovieStores();
  const oldIdentity = movieIdentity({ imdb: "tt0000001", title: "Expired privacy fixture" });
  await seedEntity(oldIdentity, { lastAccessedAt: Date.now() - 3 * 86_400_000 });
  await evaluate(
    page,
    `new Promise((resolve, reject) => {
      const request = indexedDB.open('ptd'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('social_information', 'readwrite');
        tx.objectStore('social_information').put({ id: 'tt0000001', title: 'Expired', poster: '', createAt: Date.now() - 3 * 86400000 }, 'imdb:tt0000001');
        tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error);
      };
    })`,
  );
  await navigate("/set-base/movie-information");
  await waitFor(
    page,
    `document.body.innerText.includes('当前聚合缓存') || document.body.innerText.includes('Aggregated cache')`,
    "movie cache settings",
  );
  await waitFor(
    page,
    `(${dbExpression}).then((db) => db.movie_entity.length === 0 && db.movie_alias.length === 0 && db.social_information.length === 0)`,
    "hard retention cleanup",
    15_000,
  );

  const visualIdentity = movieIdentity({ imdb: "tt1375666", title: "Inception" });
  await seedEntity(visualIdentity, {
    originalTitle: "Inception",
    summary: "A layered dream heist used for isolated Chrome layout validation.",
  });
  await configure({ theme: "light" });
  await setRuntimeMovie(visualIdentity);
  await waitForCard();
  const lightLayout = await evaluate(
    page,
    `(() => { const card = document.querySelector('.ptpp-movie-card'); const rect = card.getBoundingClientRect(); return {
      theme: document.querySelector('#ptpp').className,
      rect: rect.toJSON(),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      background: getComputedStyle(card).backgroundColor,
    }; })()`,
  );
  assert(
    !lightLayout.overflow && lightLayout.rect.width > 500,
    "desktop light card overflowed or collapsed",
    lightLayout,
  );

  await configure({ theme: "dark" });
  await sleep(200);
  const darkLayout = await evaluate(
    page,
    `(() => { const card = document.querySelector('.ptpp-movie-card'); return {
      theme: document.querySelector('#ptpp').className,
      background: getComputedStyle(card).backgroundColor,
      color: getComputedStyle(card).color,
    }; })()`,
  );
  assert(
    /dark/i.test(darkLayout.theme) && darkLayout.background !== lightLayout.background,
    "dark theme did not reach card",
    {
      lightLayout,
      darkLayout,
    },
  );

  await page.call("Emulation.setDeviceMetricsOverride", {
    width: 720,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(250);
  const narrowLayout = await evaluate(
    page,
    `(() => { const card = document.querySelector('.ptpp-movie-card'); const body = card.querySelector('.movie-card-body'); const rect = card.getBoundingClientRect(); return {
      rect: rect.toJSON(),
      display: getComputedStyle(body).display,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      viewport: document.documentElement.clientWidth,
    }; })()`,
  );
  assert(!narrowLayout.overflow && narrowLayout.display === "block", "narrow card is not responsive", narrowLayout);

  mkdirSync(artifactDir, { recursive: true });
  const screenshot = await page.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = join(artifactDir, "movie-card-dark-narrow.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await navigate("/set-base/movie-information");
  await waitFor(
    page,
    `document.body.innerText.includes('清空影片资料缓存') || document.body.innerText.includes('Clear movie information cache')`,
    "cache clear button",
  );
  await evaluate(
    page,
    `(() => { const button = [...document.querySelectorAll('button')].find((item) => /清空影片资料缓存|Clear movie information cache/i.test(item.innerText)); button.click(); return true; })()`,
  );
  await waitFor(page, `document.querySelector('[role="dialog"]')`, "cache clear confirmation");
  await evaluate(
    page,
    `(() => { const dialog = document.querySelector('[role="dialog"]'); const button = [...dialog.querySelectorAll('button')].find((item) => /确定|Confirm/i.test(item.innerText)); button.click(); return true; })()`,
  );
  await waitFor(
    page,
    `(${dbExpression}).then((db) => db.movie_entity.length === 0 && db.movie_alias.length === 0 && db.social_information.length === 0)`,
    "explicit cache clearing",
  );

  await sleep(300);
  const sessions = [page, offscreen, worker].filter(Boolean);
  const runtimeErrors = sessions.flatMap((session) => session.runtimeErrors);
  assert(runtimeErrors.length === 0, "runtime errors were captured", runtimeErrors);
  const networkWarningDetails = sessions.flatMap((session) => session.networkWarnings);
  assert(
    networkWarningDetails.length === 0,
    "unexpected network warnings were captured",
    networkWarningDetails.map(sanitizeNetworkWarning),
  );
  const expectedOfflineNetworkFailures = sessions.reduce(
    (total, session) => total + session.expectedNetworkWarnings.length,
    0,
  );

  result = {
    result: "passed",
    extensionId: runningManifest.id,
    manifest: {
      name: runningManifest.name,
      version: runningManifest.version,
      versionName: runningManifest.versionName,
      mv: runningManifest.manifestVersion,
    },
    suggestions: suggestions.length,
    unambiguousPlainTextIdentity: true,
    ordinaryRefreshClears: true,
    directIdentity: "imdb:tt0111161",
    movieAndTv: true,
    snapshotIdentity: true,
    offlineStaleCache: true,
    providerRetry: true,
    cacheDisabled: true,
    hardRetention: true,
    explicitClear: true,
    themes: ["light", "dark"],
    viewports: ["1365x820", "720x900"],
    screenshotPath,
    runtimeErrors: 0,
    networkWarnings: 0,
    expectedOfflineNetworkFailures,
  };
} finally {
  await offscreen
    .call("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
    .catch(() => undefined);
  await page
    .call("Emulation.setDeviceMetricsOverride", {
      width: 1365,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    })
    .catch(() => undefined);
  await evaluate(
    page,
    `Promise.all([
      chrome.storage.local.set(${JSON.stringify(originalState.storage)}),
      new Promise((resolve, reject) => {
        const snapshot = ${JSON.stringify(originalState.database)};
        const request = indexedDB.open('ptd'); request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result; const stores = ['movie_entity', 'movie_alias', 'social_information'];
          const tx = db.transaction(stores, 'readwrite');
          for (const storeName of stores) {
            const store = tx.objectStore(storeName); store.clear();
            for (const [key, value] of snapshot[storeName] ?? []) store.put(value, key);
          }
          tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        };
      }),
      Promise.resolve().then(() => {
        const runtime = ${JSON.stringify(originalState.runtime)};
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runtime');
        if (runtime === null) { store.$reset(); sessionStorage.removeItem('__ptd_runtime_store'); }
        else { store.$patch(JSON.parse(runtime)); sessionStorage.setItem('__ptd_runtime_store', runtime); }
      }),
    ]).then(() => { location.hash = ${JSON.stringify(originalState.hash)}; return true; })`,
  ).catch((error) => console.error("Movie CDP audit state restoration failed", error));
  page.close();
  offscreen.close();
  worker?.close();
}

console.log(JSON.stringify(result));
