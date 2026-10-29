import type { IConfigPiniaStorageSchema } from "../../shared/types.ts";
import type { IMcpCapabilityDescriptor, TMcpCapabilityName } from "../../shared/mcpBridge.ts";
import type { IMetadataPiniaStorageSchema } from "../../shared/types.ts";
import type { IMcpBusinessRegistry, TMcpMessage } from "./mcpBusinessCapabilities.ts";
import { McpConfirmationStore } from "./mcpConfirmation.ts";

type JsonObject = Record<string, unknown>;
type Change = { path: string; value: unknown };

interface SettingsOptions {
  confirmationStore?: McpConfirmationStore;
}

const GROUPS: Record<string, { label: string; description: string; paths: string[] }> = {
  interface: { label: "界面与交互", description: "主题、导航栏和表格行为", paths: ["lang", "theme", "isNavBarOpen", "saveTableBehavior", "enableTableMultiSort"] },
  toolbar: { label: "站点工具栏", description: "站点页面工具栏的停靠位置和交互", paths: ["contentScript"] },
  browser: { label: "浏览器集成", description: "右键菜单和浏览器页面集成", paths: ["contextMenus"] },
  userData: { label: "用户数据", description: "用户数据刷新、重试和概览显示", paths: ["userInfo"] },
  search: { label: "搜索", description: "搜索并发、影片资料和筛选行为", paths: ["searchEntity", "mediaServerEntity"] },
  download: { label: "下载", description: "下载历史、客户端刷新和下载确认", paths: ["download"] },
  backup: { label: "备份与恢复", description: "加密、自动上传、重试和 Cookie 恢复", paths: ["backup", "autoExtendCookies"] },
  signIn: { label: "站点签到", description: "签到计划和暂停状态", paths: ["signIn"] },
  mcp: { label: "AI 与 MCP", description: "本机桥接开关和响应超时（令牌不会返回）", paths: ["mcp"] },
};

const SECRET_PATH = /(?:token|secret|password|passwd|cookie|cookies|apiKey|api[_-]?key|encryptionKey|authorization|username|email)/i;
const URL_PATH = /(?:url|endpoint|address|baseUrl|host)/i;
const allowedPaths = new Map<string, { kind: "boolean" | "number" | "string"; min?: number; max?: number; values?: string[] }>();
const add = (path: string, kind: "boolean" | "number" | "string", options: Omit<Parameters<typeof allowedPaths.set>[1], "kind"> = {}) => allowedPaths.set(path, { kind, ...options });

for (const path of ["isNavBarOpen", "saveTableBehavior", "enableTableMultiSort"]) add(path, "boolean");
for (const path of ["contentScript.enabled", "contentScript.enabledAtSocialSite", "contentScript.allowExceptionSites", "contentScript.applyTheme", "contentScript.defaultOpenSpeedDial", "contentScript.stackedButtons", "contentScript.fadeEnterStyle", "contentScript.doubleConfirmAction", "contentScript.dragLinkOnSpeedDial"]) add(path, "boolean");
add("contentScript.dockSide", "string", { values: ["left", "right"] }); add("contentScript.edgeOffset", "number", { min: 0, max: 500 }); add("contentScript.verticalRatio", "number", { min: 0, max: 1 }); add("contentScript.socialSiteSearchBy", "string", { values: ["id", "title", "imdb", "chosen"] });
for (const path of ["contextMenus.enabled", "contextMenus.allowSelectionTextSearch", "contextMenus.allowSocialLinkSearch", "contextMenus.allowLinkDownloadPush"]) add(path, "boolean");
add("userInfo.queueConcurrency", "number", { min: 1, max: 20 }); add("userInfo.alwaysPickLastUserInfo", "boolean"); add("userInfo.showDeadSiteInOverview", "boolean"); add("userInfo.showPassedSiteInOverview", "boolean"); add("userInfo.autoReflush.enabled", "boolean"); add("userInfo.autoReflush.interval", "number", { min: 1, max: 24 }); add("userInfo.autoReflush.retry.max", "number", { min: 0, max: 10 }); add("userInfo.autoReflush.retry.interval", "number", { min: 1, max: 60 });
for (const path of ["searchEntity.allowSingleSiteSearch", "searchEntity.treatTTQueryAsImdbSearch", "searchEntity.saveLastFilter", "searchEntity.forceImdbIdMatchFilter", "searchEntity.autoDetectOfficialGroupFromTitle", "searchEntity.quickSiteFilter", "searchEntity.showHotRecommendations", "searchEntity.movieSuggestionEnabled", "searchEntity.movieInfoCardEnabled"]) add(path, "boolean"); add("searchEntity.queueConcurrency", "number", { min: 1, max: 20 }); add("searchEntity.movieSuggestionCount", "number", { min: 1, max: 10 }); add("searchEntity.movieSuggestionSearchMode", "string", { values: ["id", "title"] });
for (const path of ["download.saveDownloadHistory", "download.allowDownloaderFilterForSite", "download.ignoreSiteDownloadIntervalWhenLocalDownload", "download.initDownloaderTorrentOnEnter", "download.saveLastDownloader", "download.allowDirectSendToClient", "download.useQuickSendToClient", "download.downloadFailedRetry", "download.enableBackgroundDownload", "download.needConfirmWhenExceedSize"]) add(path, "boolean"); add("download.clientAutoRefreshInterval", "number", { min: 5, max: 3600 }); add("download.downloadFailedFailedRetryCount", "number", { min: 0, max: 20 }); add("download.downloadFailedFailedRetryInterval", "number", { min: 1, max: 120 }); add("download.batchDownloadInterval", "number", { min: 0, max: 3600 }); add("download.exceedSize", "number", { min: 0, max: 1_000_000 }); add("download.exceedSizeUnit", "string", { values: ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB"] });
for (const path of ["backup.encryptionEnabled", "backup.enabledAutoBackup", "backup.autoUploadUserData.enabled", "autoExtendCookies.enabled"]) add(path, "boolean"); add("backup.retry.max", "number", { min: 0, max: 20 }); add("backup.retry.interval", "number", { min: 1, max: 1440 }); add("autoExtendCookies.triggerThreshold", "number", { min: 0, max: 52 }); add("autoExtendCookies.extensionDuration", "number", { min: 1, max: 60 });
for (const path of ["signIn.enabled", "signIn.paused"]) add(path, "boolean"); add("signIn.intervalHours", "number", { min: 6, max: 168 });
add("mcp.enabled", "boolean"); add("mcp.timeoutMs", "number", { min: 1000, max: 60000 });
add("lang", "string"); add("theme", "string", { values: ["auto", "light", "dark"] });

function getAt(value: unknown, path: string): unknown {
  return path.split(".").reduce((current, key) => current && typeof current === "object" ? (current as JsonObject)[key] : undefined, value);
}
function setAt(value: JsonObject, path: string, next: unknown): void {
  const segments = path.split("."); let current = value;
  for (const key of segments.slice(0, -1)) { if (!current[key] || typeof current[key] !== "object" || Array.isArray(current[key])) current[key] = {}; current = current[key] as JsonObject; }
  current[segments.at(-1)!] = next;
}
function clone<T>(value: T): T { return structuredClone(value); }
function redactValue(path: string, value: unknown): unknown {
  if (SECRET_PATH.test(path)) return value === undefined || value === "" ? "[未配置]" : "[已配置]";
  if (URL_PATH.test(path) && typeof value === "string") return value ? "[已配置]" : "[未配置]";
  return value;
}
function normalizeChanges(input: unknown): Change[] {
  if (!input || typeof input !== "object") throw new Error("patch must be an object");
  const value = input as JsonObject;
  const raw = Array.isArray(value.changes) ? value.changes : value.patch && typeof value.patch === "object" ? Object.entries(value.patch).map(([path, next]) => ({ path, value: next })) : [];
  if (!raw.length || raw.length > 30) throw new Error("patch must contain 1-30 changes");
  return raw.map((item) => {
    const object = item as unknown as JsonObject;
    if (!item || typeof item !== "object" || typeof object.path !== "string" || !object.path.trim()) throw new Error("Invalid patch item");
    return { path: object.path.trim(), value: object.value };
  });
}
function validateChanges(config: IConfigPiniaStorageSchema, changes: Change[]) {
  const next = clone(config) as unknown as JsonObject;
  const diff: Array<{ path: string; before: unknown; after: unknown }> = [];
  const errors: Array<{ path: string; message: string }> = [];
  for (const change of changes) {
    const rule = allowedPaths.get(change.path);
    if (!rule || SECRET_PATH.test(change.path) || URL_PATH.test(change.path)) { errors.push({ path: change.path, message: "该字段不允许由 AI 直接修改" }); continue; }
    const current = getAt(config, change.path); const candidate = change.value;
    if (rule.kind === "boolean" && typeof candidate !== "boolean") errors.push({ path: change.path, message: "必须是布尔值" });
    else if (rule.kind === "number" && (typeof candidate !== "number" || !Number.isFinite(candidate) || (rule.min !== undefined && candidate < rule.min) || (rule.max !== undefined && candidate > rule.max))) errors.push({ path: change.path, message: `数值范围必须为 ${rule.min ?? "-∞"} 到 ${rule.max ?? "∞"}` });
    else if (rule.kind === "string" && (typeof candidate !== "string" || (rule.values && !rule.values.includes(candidate)))) errors.push({ path: change.path, message: rule.values ? `只能是 ${rule.values.join(", ")}` : "必须是文本" });
    else if (JSON.stringify(current) !== JSON.stringify(candidate)) { setAt(next, change.path, candidate); diff.push({ path: change.path, before: redactValue(change.path, current), after: redactValue(change.path, candidate) }); }
  }
  return { next, diff, errors };
}
function projectConfig(config: IConfigPiniaStorageSchema): JsonObject {
  const settings: JsonObject = {};
  for (const path of allowedPaths.keys()) { const value = getAt(config, path); if (value !== undefined) settings[path] = redactValue(path, value); }
  return settings;
}
function grouped(settings: JsonObject) {
  return Object.fromEntries(Object.entries(GROUPS).map(([id, group]) => [id, { id, label: group.label, description: group.description, settings: Object.fromEntries(group.paths.flatMap((prefix) => Object.entries(settings).filter(([path]) => path === prefix || path.startsWith(`${prefix}.`)))) }]));
}

const settingsChangeSchema = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 120, description: "可修改的设置路径，例如 searchEntity.queueConcurrency" },
    value: {},
  },
  required: ["path", "value"],
  additionalProperties: false,
};
const settingsPatchSchema = {
  type: "object",
  properties: {
    changes: { type: "array", items: settingsChangeSchema, minItems: 1, maxItems: 30 },
    patch: { type: "object", additionalProperties: true, description: "设置路径到新值的映射；与 changes 二选一" },
  },
  additionalProperties: false,
};

export function createMcpSettingsCapabilities(sendMessage: TMcpMessage, options: SettingsOptions = {}): IMcpBusinessRegistry {
  const descriptors = ( [
    ["ptpp.settings.get", "query", "读取按分组整理的 PTPP 设置语义；敏感凭据只返回是否已配置。", { type: "object", properties: { groups: { type: "array", items: { type: "string" }, maxItems: 20 } }, additionalProperties: false }],
    ["ptpp.settings.validate", "query", "校验设置修改草稿并返回结构化差异，不会保存。用 changes 数组（每项含 path 和 value）或 patch 映射。", settingsPatchSchema],
    ["ptpp.settings.propose_patch", "query", "生成设置修改方案和影响说明，不会保存，需用户确认。用 changes 数组（每项含 path 和 value）或 patch 映射。", settingsPatchSchema],
    ["ptpp.settings.apply_patch", "action", "在用户明确确认后应用已校验的设置修改。用 changes 数组（每项含 path 和 value）或 patch 映射；必须先取得用户确认令牌。", settingsPatchSchema],
  ] as const).map(([id, kind, description, inputSchema]) => ({ id: id as TMcpCapabilityName, version: 1 as const, kind, sensitivity: "private" as const, description, confirmation: id.endsWith("apply_patch") ? "required" as const : "none" as const, inputSchema, outputSchema: { type: "object" }, maxResultBytes: 65_536 }));
  const handlers = new Map<TMcpCapabilityName, (input: unknown, request?: import("@/shared/mcpBridge.ts").IMcpToolRequest) => Promise<unknown>>();
  const confirmations = options.confirmationStore ?? new McpConfirmationStore();
  const readConfig = async () => (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;
  const readMetadata = async () => (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  handlers.set("ptpp.settings.get", async (input) => {
    const value = input && typeof input === "object" ? input as JsonObject : {};
    const requested = Array.isArray(value.groups) ? new Set(value.groups.filter((item): item is string => typeof item === "string")) : undefined;
    const config = await readConfig(); const settings = projectConfig(config);
    const metadata = await readMetadata();
    const relations = {
      defaultDownloader: metadata.defaultDownloader?.id ? { id: metadata.defaultDownloader.id, name: metadata.downloaders?.[metadata.defaultDownloader.id]?.name } : undefined,
      downloaders: Object.values(metadata.downloaders ?? {}).map((downloader: any) => ({ id: downloader.id, name: downloader.name, type: downloader.type, enabled: downloader.enabled })),
      siteDownloadProfiles: Object.entries(metadata.siteDownloadProfiles ?? {}).map(([siteId, profile]: [string, any]) => ({
        siteId,
        downloaderId: profile.downloaderId,
        folder: typeof profile.folder === "string" ? profile.folder : undefined,
        enabled: profile.enabled !== false,
      })),
      searchPlan: { id: metadata.defaultSolutionId, name: metadata.solutions?.[metadata.defaultSolutionId]?.name },
      backupServers: Object.values(metadata.backupServers ?? {}).map((server: any) => ({ id: server.id, name: server.name, type: server.type, enabled: server.enabled })),
    };
    const result: JsonObject = { groups: requested ? Object.fromEntries(Object.entries(grouped(settings)).filter(([id]) => requested.has(id))) : grouped(settings), settings, relations, semantics: { defaultDownloaderConfigured: Boolean(metadata.defaultDownloader?.id), credentialsExcluded: true } };
    return result;
  });
  const draft = async (input: unknown) => { const changes = normalizeChanges(input); const config = await readConfig(); const result = validateChanges(config, changes); return { valid: !result.errors.length, errors: result.errors, changes: result.diff, requiresConfirmation: result.diff.length > 0, current: projectConfig(config), next: result.errors.length ? undefined : projectConfig(result.next as unknown as IConfigPiniaStorageSchema) }; };
  handlers.set("ptpp.settings.validate", draft);
  handlers.set("ptpp.settings.propose_patch", async (input) => {
    const proposal = await draft(input);
    if (!proposal.valid || !proposal.changes.length) return { ...proposal, status: "no_change" };
    const request = confirmations.create(
      "ptpp.settings.apply_patch",
      { changes: normalizeChanges(input) },
      "应用已确认的 PTPP 设置修改",
      proposal.changes,
    );
    return { ...proposal, status: "proposal", confirmationId: request.confirmationId, expiresAt: request.expiresAt, summary: request.summary };
  });
  handlers.set("ptpp.settings.apply_patch", async (input: unknown, request) => {
    const value = input && typeof input === "object" ? input as JsonObject : {};
    const proposal = await draft(input); const token = typeof request?.confirmationToken === "string" ? request.confirmationToken : "";
    if (!proposal.valid) return { status: "invalid", ...proposal };
    const changes = normalizeChanges(input);
    const approved = token ? confirmations.consume(token, "ptpp.settings.apply_patch", { changes }) : undefined;
    if (!approved) {
      const request = confirmations.create("ptpp.settings.apply_patch", { changes }, "应用已确认的 PTPP 设置修改", proposal.changes);
      return { status: "confirmation_required", confirmationId: request.confirmationId, expiresAt: request.expiresAt, summary: request.summary, changes: proposal.changes, requiresConfirmation: true };
    }
    const config = await readConfig(); const applied = validateChanges(config, changes); if (applied.errors.length) return { status: "conflict", ...applied };
    await sendMessage("setExtStorage", { key: "config", value: applied.next });
    return { status: "applied", changes: applied.diff, settings: projectConfig(applied.next as unknown as IConfigPiniaStorageSchema) };
  });
  return { descriptors, handlers };
}
