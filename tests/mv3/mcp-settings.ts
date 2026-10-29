import assert from "node:assert/strict";
import { createMcpSettingsCapabilities } from "../../app/src/entries/offscreen/utils/mcpSettingsCapabilities.ts";
import { McpConfirmationStore } from "../../app/src/entries/offscreen/utils/mcpConfirmation.ts";

const config = {
  theme: "dark",
  lang: "zh_CN",
  isNavBarOpen: true,
  saveTableBehavior: true,
  enableTableMultiSort: false,
  contentScript: { enabled: true, dockSide: "right", edgeOffset: 20, verticalRatio: 0.5, applyTheme: true },
  contextMenus: { enabled: true, allowSelectionTextSearch: true, allowSocialLinkSearch: true, allowLinkDownloadPush: true },
  userInfo: { queueConcurrency: 3, alwaysPickLastUserInfo: true, autoReflush: { enabled: true, interval: 6, retry: { max: 2, interval: 5 } } },
  searchEntity: { queueConcurrency: 4, allowSingleSiteSearch: true, treatTTQueryAsImdbSearch: true, movieSuggestionEnabled: true, movieSuggestionCount: 5, movieSuggestionSearchMode: "id", movieInfoCardEnabled: true },
  download: { clientAutoRefreshInterval: 30, saveDownloadHistory: true, needConfirmWhenExceedSize: false, exceedSize: 10, exceedSizeUnit: "GiB" },
  backup: { encryptionEnabled: true, encryptionKey: "secret-key", retry: { max: 3, interval: 5 }, autoUploadUserData: { enabled: true, serverId: "webdav-1" } },
  autoExtendCookies: { enabled: false, triggerThreshold: 2, extensionDuration: 3 },
  signIn: { enabled: false, paused: false, intervalHours: 24 },
  mcp: { enabled: true, bridgeUrl: "http://127.0.0.1:19799", bridgeToken: "bridge-secret", timeoutMs: 30000 },
} as any;
const metadata = { defaultDownloader: { id: "transmission" }, downloaders: { transmission: { id: "transmission", name: "Transmission", type: "transmission", enabled: true } }, siteDownloadProfiles: { audiences: { downloaderId: "transmission", folder: "/downloads/audiences" } }, defaultSolutionId: "default", solutions: {}, backupServers: {} } as any;
let stored = structuredClone(config);
const writes: unknown[] = [];
const confirmationStore = new McpConfirmationStore({ createToken: (() => { let i = 0; return () => `token-${++i}`; })() });
const registry = createMcpSettingsCapabilities(async (type, data) => {
  if (type === "getExtStorage") return data === "config" ? stored : metadata;
  if (type === "setExtStorage") { stored = structuredClone((data as any).value); writes.push(data); return undefined; }
  throw new Error(`Unexpected message ${type}`);
}, { confirmationStore });
const call = async (name: string, input: unknown = {}) => {
  const handler = registry.handlers.get(name as any);
  assert(handler, `${name} is registered`);
  return handler(input);
};

const overview: any = await call("ptpp.settings.get");
assert.equal(overview.groups.interface.settings.theme, "dark");
assert.equal(overview.groups.backup.settings["backup.encryptionKey"], undefined, "raw encryption key is never returned");
assert.equal(overview.settings["mcp.bridgeToken"], undefined, "bridge token is never exposed");
assert.equal(overview.semantics.defaultDownloaderConfigured, true);
assert.equal(overview.relations.defaultDownloader.name, "Transmission");
assert.equal(overview.relations.siteDownloadProfiles[0].folder, "/downloads/audiences");

const before = JSON.stringify(stored);
const valid: any = await call("ptpp.settings.validate", { changes: [{ path: "theme", value: "light" }, { path: "searchEntity.queueConcurrency", value: 2 }] });
assert.equal(valid.valid, true);
assert.equal(valid.changes.length, 2);
assert.equal(JSON.stringify(stored), before, "validate never writes settings");

const proposal: any = await call("ptpp.settings.propose_patch", { patch: { theme: "light", "contentScript.dockSide": "left" } });
assert.equal(proposal.status, "proposal");
assert.equal(proposal.requiresConfirmation, true);
assert.equal(proposal.next.theme, "light");

const invalid: any = await call("ptpp.settings.validate", { changes: [{ path: "mcp.bridgeToken", value: "new-secret" }, { path: "searchEntity.queueConcurrency", value: 99 }] });
assert.equal(invalid.valid, false);
assert.equal(invalid.errors.length, 2);
assert.equal(writes.length, 0, "invalid proposal never writes settings");

const proposal2: any = await call("ptpp.settings.propose_patch", { changes: [{ path: "theme", value: "light" }] });
const pending: any = await call("ptpp.settings.apply_patch", { changes: [{ path: "theme", value: "light" }] });
assert.equal(pending.status, "confirmation_required");
assert.equal(writes.length, 0);
const token = confirmationStore.approve(proposal2.confirmationId)!;
const applied: any = await registry.handlers.get("ptpp.settings.apply_patch")!({ changes: [{ path: "theme", value: "light" }] }, { requestId: "test-request", capability: "ptpp.settings.apply_patch", input: {}, confirmationToken: token });
assert.equal(applied.status, "applied");
assert.equal(stored.theme, "light");
assert.equal(writes.length, 1);

console.log("MCP settings assistant tests passed: grouped read, semantic redaction, validation, diff preview, confirmation and apply.");
