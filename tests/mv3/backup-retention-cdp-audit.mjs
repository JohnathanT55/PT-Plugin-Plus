const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const phase = process.argv[3] ?? "setup";
const desiredWebDavRoot = (process.argv[4] ?? process.env.PTPP_RETENTION_WEBDAV_ROOT ?? "").replace(/\/+$/, "");
const auditStorageKey = "ptppBackupRetentionAudit";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

if (!/^https?:\/\/[^/]+(?:\/.*)?$/i.test(desiredWebDavRoot)) {
  throw new Error(
    "Set PTPP_RETENTION_WEBDAV_ROOT or pass the WebDAV root as argument 4; no private endpoint is stored in the repository.",
  );
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`Backup retention CDP audit failed: ${message}${suffix}`);
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
        this.runtimeErrors.push(
          message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text,
        );
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        if (entry.source !== "network" || entry.url?.startsWith("chrome-extension://")) {
          this.runtimeErrors.push(entry.text);
        }
      }
    });
    await this.call("Runtime.enable");
    await this.call("Log.enable").catch(() => undefined);
    return this;
  }

  call(method, params = {}, timeout = 180_000) {
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

async function evaluate(session, expression, timeout = 180_000) {
  const result = await session.call(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    timeout,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(callback, description, timeout = 60_000) {
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

async function getTargets() {
  return await fetch(`${endpoint}/json/list`).then((response) => response.json());
}

async function getExtensionSessions() {
  const targets = await getTargets();
  const optionsTarget = targets.find(
    (target) =>
      target.type === "page" &&
      target.url?.startsWith("chrome-extension://") &&
      target.url.includes("/src/entries/options/index.html"),
  );
  const extensionId = optionsTarget?.url?.match(/^chrome-extension:\/\/([^/]+)/)?.[1];
  assert(extensionId, "the running options page identifies the extension under test", optionsTarget);
  const extensionTargets = targets.filter((target) =>
    target.url?.startsWith(`chrome-extension://${extensionId}/`),
  );
  assert(extensionTargets.length >= 2, "extension page and background targets are present", extensionTargets);
  const pageTarget = extensionTargets.find((target) => target.type === "page");
  assert(pageTarget, "options page target is present", extensionTargets);
  const sessions = [];
  for (const target of extensionTargets) {
    const session = await new CdpSession(target.webSocketDebuggerUrl).open();
    sessions.push({ target, session });
  }
  return { extensionId, page: sessions.find(({ target }) => target.id === pageTarget.id).session, sessions };
}

const sendMessageHelper = `
  const send = async (type, data) => {
    const response = await chrome.runtime.sendMessage({
      id: Math.floor(Math.random() * 1e9), type, data, timestamp: Date.now()
    });
    if (response?.err) throw new Error(response.err.message || JSON.stringify(response.err));
    return response?.res;
  };
`;

async function navigateToBackupPage(page, extensionId) {
  const url = `chrome-extension://${extensionId}/src/entries/options/index.html#/set-backup`;
  await page.call("Page.enable");
  await page.call("Page.navigate", { url });
  await waitFor(
    async () =>
      await evaluate(page, `document.readyState === "complete" && document.body.innerText.includes("参数备份与恢复")`),
    "backup settings page",
  );
}

async function clickVisibleText(page, text, description) {
  const clicked = await evaluate(
    page,
    `(() => {
      const elements = [...document.querySelectorAll('button,[role="button"]')];
      const element = elements.find((item) => {
        const rect = item.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && item.innerText.trim().includes(${JSON.stringify(text)});
      });
      if (!element) return false;
      element.click();
      return true;
    })()`,
  );
  assert(clicked, description);
}

async function setupPhase(page) {
  const result = await evaluate(
    page,
    `(async()=>{
      ${sendMessageHelper}
      const stored = await chrome.storage.local.get(["metadata", "config", ${JSON.stringify(auditStorageKey)}]);
      if (stored[${JSON.stringify(auditStorageKey)}]) throw new Error("A prior retention audit state still exists.");
      let metadata = stored.metadata;
      let config = stored.config;
      const server = Object.values(metadata?.backupServers ?? {}).find((item) => item.type === "WebDAV");
      if (!server) throw new Error("No WebDAV server is configured.");
      const address = String(server.config?.address ?? "");
      if (!address.startsWith(${JSON.stringify(`${desiredWebDavRoot}/ptpp-cdp-retention-`)})) {
        throw new Error("Refusing to test outside the dedicated retention directory.");
      }
      const snapshot = {
        serverId: server.id,
        address,
        desiredRoot: ${JSON.stringify(desiredWebDavRoot)},
        backupFields: structuredClone(server.backupFields ?? []),
        enabled: server.enabled,
        backupInterval: server.backupInterval,
        nextBackupAt: server.nextBackupAt,
        lastBackupAt: server.lastBackupAt,
        lastBackupAttemptAt: server.lastBackupAttemptAt,
        lastBackupFailureAt: server.lastBackupFailureAt,
        lastBackupError: server.lastBackupError,
        lastBackupTrigger: server.lastBackupTrigger,
        backupRetryAt: server.backupRetryAt,
        backupRetryCount: server.backupRetryCount,
        backupHistory: structuredClone(server.backupHistory ?? []),
        lastCleanup: structuredClone(server.lastCleanup),
        retentionPolicy: structuredClone(server.retentionPolicy),
        autoUploadUserData: structuredClone(config?.backup?.autoUploadUserData),
      };
      await chrome.storage.local.set({ [${JSON.stringify(auditStorageKey)}]: snapshot });

      const initial = await send("getBackupHistory", server.id);
      if (initial.length !== 0) throw new Error("Dedicated directory is not empty.");

      server.enabled = true;
      server.backupInterval = 1;
      server.backupFields = ["config"];
      server.retentionPolicy = {
        enabled: false, strategy: "count", maxAgeDays: 30, minKeep: 3, keepLatest: 3,
        tiered: { enabled: false, recentCount: 3, weeklyCount: 4, monthlyCount: 6, timeZone: "America/New_York" }
      };
      delete server.pendingCleanup;
      delete server.activeRestorePaths;
      await chrome.storage.local.set({ metadata });

      for (let index = 0; index < 5; index++) {
        if (!await send("runBackup", { backupServerId: server.id, trigger: "interval" })) {
          throw new Error("First selected-field interval backup failed.");
        }
      }
      metadata = (await chrome.storage.local.get("metadata")).metadata;
      metadata.backupServers[server.id].backupFields = ["config", "collection"];
      await chrome.storage.local.set({ metadata });
      for (let index = 0; index < 4; index++) {
        if (!await send("runBackup", { backupServerId: server.id, trigger: "interval" })) {
          throw new Error("Changed-scope interval backup failed.");
        }
      }

      config = (await chrome.storage.local.get("config")).config;
      config.backup.autoUploadUserData = { enabled: true, serverId: server.id };
      await chrome.storage.local.set({ config });
      for (let index = 0; index < 4; index++) {
        if (!await send("runBackup", { backupServerId: server.id, trigger: "userDataRefresh" })) {
          throw new Error("Full post-refresh backup failed.");
        }
      }
      metadata = (await chrome.storage.local.get("metadata")).metadata;
      metadata.backupServers[server.id].backupFields = ["metadata"];
      await chrome.storage.local.set({ metadata });
      if (!await send("runBackup", { backupServerId: server.id, trigger: "manual" })) {
        throw new Error("Manual backup failed.");
      }

      metadata = (await chrome.storage.local.get("metadata")).metadata;
      const currentServer = metadata.backupServers[server.id];
      currentServer.backupFields = ["config", "collection"];
      await chrome.storage.local.set({ metadata });
      const auth = "Basic " + btoa(unescape(encodeURIComponent(
        String(currentServer.config.loginName ?? "") + ":" + String(currentServer.config.loginPwd ?? "")
      )));
      const put = async (name, content = "ptpp-cdp-fixture") => {
        const response = await fetch(address + "/" + name, {
          method: "PUT", headers: { Authorization: auth, "Content-Type": "application/octet-stream" }, body: content
        });
        if (!response.ok) throw new Error("Fixture PUT failed: " + response.status);
      };
      const generated = await send("getBackupHistory", server.id);
      const automatic = generated.filter((file) => file.classification === "automatic");
      const manual = generated.find((file) => file.classification === "manual");
      if (automatic.length !== 13 || !manual) throw new Error("Generated backup streams are incomplete.");
      const restoredManual = await send("getRemoteBackupData", {
        backupServerId: server.id,
        path: manual.path,
        decryptKey: config.backup.encryptionEnabled ? config.backup.encryptionKey : "",
      });
      const backedUpServer = restoredManual.metadata?.backupServers?.[server.id];
      if (!backedUpServer || backedUpServer.backupVerificationKey || backedUpServer.pendingCleanup
        || backedUpServer.activeRestorePaths) {
        throw new Error("Browser-local cleanup state leaked into the metadata backup.");
      }
      const sample = automatic[0].filename;
      const foreign = sample.replace(/^PTPP_mv3_v1_[0-9a-f]{32}_/, "PTPP_mv3_v1_ffffffffffffffffffffffffffffffff_");
      const forged = sample.replace(/_([0-9a-f])([0-9a-f]{15})\\.zip$/, (_all, first, rest) =>
        "_" + (first === "0" ? "1" : "0") + rest + ".zip"
      );
      const legacy = "PTPP_backup_20200101T000000000.zip";
      const other = "other-application-backup.zip";
      const similar = "PTPP_mv3_v1_similar-name.zip";
      const temporary = "PTPP_mv3_upload.zip.part";
      for (const name of [foreign, forged, legacy, other, similar, temporary]) await put(name);

      currentServer.retentionPolicy.enabled = true;
      currentServer.retentionPolicy.strategy = "count";
      currentServer.retentionPolicy.keepLatest = 3;
      currentServer.retentionPolicy.minKeep = 3;
      await chrome.storage.local.set({ metadata });

      currentServer.config.address = "http://127.0.0.1:9/ptpp-cdp-list-failure";
      await chrome.storage.local.set({ metadata });
      let listFailed = false;
      try { await send("previewBackupCleanup", { backupServerId: server.id }); }
      catch { listFailed = true; }
      if (!listFailed) throw new Error("Unreachable listing did not fail closed.");
      currentServer.config.address = address;
      await chrome.storage.local.set({ metadata });

      const preview = await send("previewBackupCleanup", { backupServerId: server.id });
      if (preview.candidateCount !== 4) throw new Error("Expected four independent-stream candidates.");
      const protectedNames = [manual.filename, foreign, forged, legacy, other, similar, temporary];
      const classified = await send("getBackupHistory", server.id);
      if (classified.some((file) => protectedNames.includes(file.filename) && file.disposition === "candidate")) {
        throw new Error("A protected fixture entered cleanup candidates.");
      }

      metadata = (await chrome.storage.local.get("metadata")).metadata;
      metadata.backupServers[server.id].activeRestorePaths = { [preview.candidatePaths[0]]: Date.now() };
      await chrome.storage.local.set({ metadata });
      const restoreProtected = await send("previewBackupCleanup", { backupServerId: server.id });
      if (restoreProtected.candidateCount !== 3) throw new Error("Active restore path was not protected.");
      metadata = (await chrome.storage.local.get("metadata")).metadata;
      delete metadata.backupServers[server.id].activeRestorePaths;
      await chrome.storage.local.set({ metadata });

      await chrome.storage.local.set({
        [${JSON.stringify(auditStorageKey)}]: {
          ...snapshot,
          manualFilename: manual.filename,
          protectedNames,
          initialCandidateCount: preview.candidateCount,
          baselineRemoteZipCount: classified.length,
        }
      });
      return {
        serverId: server.id,
        address,
        automaticCount: automatic.length,
        manualCount: 1,
        candidateCount: preview.candidateCount,
        protectedCount: protectedNames.length,
        baselineRemoteZipCount: classified.length,
      };
    })()`,
    240_000,
  );
  assert(result.candidateCount === 4, "three backup streams retain separate minimums", result);
  return result;
}

async function auditPreviewUi(page, extensionId, serverId, expectedCandidateCount, baselineRemoteZipCount) {
  await navigateToBackupPage(page, extensionId);
  const historyClicked = await evaluate(
    page,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((item) =>
        item.title === "查看备份详情与历史" && item.getBoundingClientRect().width > 0
      );
      if (!button) return false;
      button.click(); return true;
    })()`,
  );
  assert(historyClicked, "backup history opens from the real settings page");
  await waitFor(
    async () =>
      await evaluate(
        page,
        `document.body.innerText.includes("自动备份") && document.body.innerText.includes("旧版未分类") && document.body.innerText.includes("无法验证")`,
      ),
    "classified backup history",
  );
  await clickVisibleText(page, "清理预览", "cleanup preview button is visible");
  await waitFor(
    async () =>
      await evaluate(
        page,
        `document.body.innerText.includes("旧备份安全清理预览")
          && document.body.innerText.includes("本次预览纳入严格旧版文件")
          && document.body.innerText.includes(${JSON.stringify(`待清理 ${expectedCandidateCount} 份`)})
          && document.body.innerText.includes(${JSON.stringify(`立即清理 ${expectedCandidateCount} 份`)})`,
      ),
    "loaded cleanup preview dialog",
  );
  const previewText = await evaluate(
    page,
    `([...document.querySelectorAll('.v-overlay--active')].at(-1)?.innerText ?? "")`,
  );
  assert(
    previewText.includes(`待清理 ${expectedCandidateCount} 份`),
    "preview shows the exact candidate count",
    previewText,
  );
  assert(previewText.includes("安全保护"), "preview visibly distinguishes protected files", previewText);
  await clickVisibleText(page, `立即清理 ${expectedCandidateCount} 份`, "cleanup action is available after preview");
  await waitFor(
    async () => await evaluate(page, `document.body.innerText.includes("二次确认远端清理")`),
    "second confirmation dialog",
  );
  const cancelled = await evaluate(
    page,
    `(() => {
      const overlay = [...document.querySelectorAll('.v-overlay--active')].at(-1);
      const button = [...(overlay?.querySelectorAll('button') ?? [])].find((item) => item.innerText.trim() === "取消");
      if (!button) return false;
      button.click(); return true;
    })()`,
  );
  assert(cancelled, "second confirmation can be cancelled");
  const countAfterCancel = await evaluate(
    page,
    `(async()=>{${sendMessageHelper} return (await send("getBackupHistory", ${JSON.stringify(serverId)})).length})()`,
  );
  assert(countAfterCancel === baselineRemoteZipCount, "cancelling confirmation deletes nothing", { countAfterCancel });
}

async function cleanupSubsetAndPrepareRestart(page) {
  return await evaluate(
    page,
    `(async()=>{
      ${sendMessageHelper}
      const stored = await chrome.storage.local.get(${JSON.stringify(auditStorageKey)});
      const audit = stored[${JSON.stringify(auditStorageKey)}];
      const preview = await send("previewBackupCleanup", { backupServerId: audit.serverId });
      const selected = preview.candidatePaths.slice(0, -1);
      const result = await send("executeBackupCleanup", {
        backupServerId: audit.serverId,
        previewToken: preview.token,
        paths: selected,
      });
      if (result.deletedCount !== selected.length || result.failedCount !== 0) {
        throw new Error("Subset cleanup did not finish cleanly.");
      }
      const remaining = await send("previewBackupCleanup", { backupServerId: audit.serverId });
      if (remaining.candidateCount !== 1) throw new Error("Deselected candidate was not retained.");
      const runId = await send("prepareBackupCleanup", {
        backupServerId: audit.serverId,
        previewToken: remaining.token,
        paths: remaining.candidatePaths,
        mode: "manual",
      });
      const metadata = (await chrome.storage.local.get("metadata")).metadata;
      if (metadata.backupServers[audit.serverId].pendingCleanup?.id !== runId) {
        throw new Error("Cleanup journal was not persisted before restart.");
      }
      audit.restartRunId = runId;
      audit.restartPendingPath = remaining.candidatePaths[0];
      audit.subsetDeletedCount = result.deletedCount;
      await chrome.storage.local.set({ [${JSON.stringify(auditStorageKey)}]: audit });
      return { runId, pendingPath: audit.restartPendingPath, subsetDeletedCount: result.deletedCount };
    })()`,
  );
}

async function verifyRestartAndFinish(page) {
  const recovery = await waitFor(
    async () =>
      await evaluate(
        page,
        `(async()=>{
          const stored=await chrome.storage.local.get(["metadata",${JSON.stringify(auditStorageKey)}]);
          const audit=stored[${JSON.stringify(auditStorageKey)}];
          if(!audit) return false;
          const server=stored.metadata?.backupServers?.[audit.serverId];
          return !server?.pendingCleanup && server?.lastCleanup?.runId===audit.restartRunId
            ? { status:server.lastCleanup.status, deleted:server.lastCleanup.deletedCount, failed:server.lastCleanup.failedCount }
            : false;
        })()`,
      ),
    "durable cleanup recovery after browser restart",
    90_000,
  );
  assert(recovery.status === "completed" && recovery.failed === 0, "restart recovery completes the journal", recovery);

  return await evaluate(
    page,
    `(async()=>{
      ${sendMessageHelper}
      const stored=await chrome.storage.local.get(["metadata","config",${JSON.stringify(auditStorageKey)},"pendingOneShotTasks"]);
      const audit=stored[${JSON.stringify(auditStorageKey)}];
      if(!audit) throw new Error("Audit state is missing after restart.");
      let metadata=stored.metadata;
      let server=metadata.backupServers[audit.serverId];
      let before=await send("getBackupHistory",audit.serverId);
      if(before.some(file=>file.path===audit.restartPendingPath)) throw new Error("Restart candidate still exists.");
      if(audit.protectedNames.filter(name=>name.endsWith(".zip")).some(name=>!before.some(file=>file.filename===name))) {
        throw new Error("A protected ZIP was removed during restart recovery.");
      }
      if(!await send("runBackup",{backupServerId:audit.serverId,trigger:"interval"})) {
        throw new Error("Automatic post-upload cleanup backup failed.");
      }
      const after=await send("getBackupHistory",audit.serverId);
      const automatic=after.filter(file=>file.classification==="automatic");
      const streamCounts={};
      for(const file of automatic) streamCounts[file.streamKey]=(streamCounts[file.streamKey]??0)+1;
      if(Object.values(streamCounts).some(count=>count!==3)) throw new Error("Per-stream minimum changed after automatic cleanup.");
      if(after.some(file=>file.disposition==="candidate")) throw new Error("Automatic cleanup left an eligible candidate.");
      metadata=(await chrome.storage.local.get("metadata")).metadata;
      server=metadata.backupServers[audit.serverId];
      const latestRun=server.backupHistory?.[0];
      if(latestRun?.status!=="success" || latestRun?.cleanup?.deletedCount!==1 || latestRun?.cleanup?.failedCount!==0) {
        throw new Error("Automatic cleanup details are missing from backup history.");
      }

      const auth="Basic "+btoa(unescape(encodeURIComponent(
        String(server.config.loginName??"")+":"+String(server.config.loginPwd??"")
      )));
      const listing=await fetch(audit.address,{method:"PROPFIND",headers:{Authorization:auth,Depth:"1"}});
      const listingText=await listing.text();
      if(!listing.ok&&listing.status!==207) throw new Error("Final dedicated listing failed: "+listing.status);
      for(const name of audit.protectedNames) {
        if(!listingText.includes(name)) throw new Error("Protected fixture missing: "+name);
      }
      if(!audit.address.startsWith(audit.desiredRoot+"/ptpp-cdp-retention-")) {
        throw new Error("Refusing to remove a non-dedicated directory.");
      }
      const removed=await fetch(audit.address,{method:"DELETE",headers:{Authorization:auth}});
      if(!removed.ok&&removed.status!==204) throw new Error("Dedicated directory cleanup failed: "+removed.status);

      server.config.address=audit.desiredRoot;
      server.backupFields=audit.backupFields;
      server.enabled=audit.enabled;
      server.backupInterval=audit.backupInterval;
      server.nextBackupAt=audit.nextBackupAt;
      server.lastBackupAt=audit.lastBackupAt;
      server.lastBackupAttemptAt=audit.lastBackupAttemptAt;
      server.lastBackupFailureAt=audit.lastBackupFailureAt;
      server.lastBackupError=audit.lastBackupError;
      server.lastBackupTrigger=audit.lastBackupTrigger;
      server.backupRetryAt=audit.backupRetryAt;
      server.backupRetryCount=audit.backupRetryCount;
      server.backupHistory=audit.backupHistory;
      server.retentionPolicy=audit.retentionPolicy;
      server.lastCleanup=audit.lastCleanup;
      delete server.pendingCleanup;
      delete server.activeRestorePaths;
      const config=stored.config;
      config.backup.autoUploadUserData=audit.autoUploadUserData;
      await chrome.storage.local.set({metadata,config});
      await chrome.storage.local.remove(${JSON.stringify(auditStorageKey)});
      const remainingTasks=(await chrome.storage.local.get("pendingOneShotTasks")).pendingOneShotTasks;
      const cleanupTasks=Object.keys(remainingTasks?.tasks??{}).filter(id=>id.startsWith("backup-cleanup:"));
      if(cleanupTasks.length) throw new Error("Completed cleanup left a durable task behind.");
      return {
        recoveredRunId:audit.restartRunId,
        subsetDeletedCount:audit.subsetDeletedCount,
        automaticDeletedCount:latestRun.cleanup.deletedCount,
        automaticStreams:Object.keys(streamCounts).length,
        protectedFixtures:audit.protectedNames.length,
        finalWebDavAddress:server.config.address,
        dedicatedDirectoryRemoved:true,
      };
    })()`,
    180_000,
  );
}

const { extensionId, page, sessions } = await getExtensionSessions();
try {
  const manifest = await evaluate(page, `chrome.runtime.getManifest()`);
  assert(manifest.manifest_version === 3 && manifest.version === "2.0.0", "runtime identity is MV3 2.0.0", manifest);
  if (phase === "setup") {
    const setup = await setupPhase(page);
    await auditPreviewUi(page, extensionId, setup.serverId, setup.candidateCount, setup.baselineRemoteZipCount);
    const prepared = await cleanupSubsetAndPrepareRestart(page);
    console.log(
      JSON.stringify(
        { phase, setup, prepared, runtimeErrors: sessions.flatMap(({ session }) => session.runtimeErrors) },
        null,
        2,
      ),
    );
  } else if (phase === "verify-restart") {
    const result = await verifyRestartAndFinish(page);
    const runtimeErrors = sessions.flatMap(({ session }) => session.runtimeErrors);
    assert(runtimeErrors.length === 0, "extension targets have no runtime errors", runtimeErrors);
    console.log(JSON.stringify({ phase, result, runtimeErrors }, null, 2));
  } else {
    throw new Error(`Unknown audit phase: ${phase}`);
  }
} finally {
  for (const { session } of sessions) session.close();
}
