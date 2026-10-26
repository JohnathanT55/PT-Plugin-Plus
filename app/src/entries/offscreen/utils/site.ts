import { uniq } from "es-toolkit";
import { isEmpty } from "es-toolkit/compat";
import {
  getDefinedSiteMetadata,
  getFavicon,
  getFaviconMetadata,
  getSite as createSiteInstance,
  NO_IMAGE,
  type ISiteUserConfig,
  type TSiteID,
  checkSiteMetadataAllow,
  captureNavigationDocument,
} from "@ptd/site";

import { onMessage, sendMessage } from "@/messages.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";
import {
  classifySignInError,
  classifySignInResponse,
  normalizeSignInDefinition,
  updateSiteSignInState,
  type ISiteSignInResult,
} from "@/shared/siteSignIn.ts";

import { logger } from "./logger.ts";
import { ptdIndexDb } from "../adapter/indexdb.ts";

export async function getSiteUserConfig(siteId: TSiteID, flush = false) {
  const metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  const storedSiteUserConfig = metadataStore?.sites?.[siteId] ?? {};

  const siteMetaData = await getDefinedSiteMetadata(siteId);

  if (flush || isEmpty(storedSiteUserConfig)) {
    const isDeadSite = siteMetaData.isDead ?? false;
    storedSiteUserConfig.isOffline ??= isDeadSite;
    storedSiteUserConfig.sortIndex ??= 100;
    storedSiteUserConfig.allowSearch ??= !isDeadSite && checkSiteMetadataAllow(siteMetaData, "search");
    storedSiteUserConfig.allowQueryUserInfo ??= !isDeadSite && checkSiteMetadataAllow(siteMetaData, "userInfo");
    if (siteMetaData.signIn) storedSiteUserConfig.signInEnabled ??= false;
    storedSiteUserConfig.timeout ??= 30e3;

    const inputSetting = {} as Record<string, string>;
    if (siteMetaData.userInputSettingMeta) {
      for (const userInputMeta of siteMetaData.userInputSettingMeta) {
        inputSetting[userInputMeta.name] = "";
      }
    }
    storedSiteUserConfig.inputSetting ??= inputSetting;

    storedSiteUserConfig.groups ??= siteMetaData.tags ?? [];
    storedSiteUserConfig.downloadInterval ??= siteMetaData?.download?.interval ?? 0;
    storedSiteUserConfig.uploadSpeedLimit ??= 0;
    storedSiteUserConfig.allowContentScript ??= true;
    storedSiteUserConfig.downloadLinkAppendix ??= "";
    storedSiteUserConfig.merge ??= {};
  }

  logger({ msg: `getSiteUserConfig for ${siteId}`, data: storedSiteUserConfig });
  return storedSiteUserConfig;
}

onMessage("getSiteUserConfig", async ({ data: { siteId, flush } }) => await getSiteUserConfig(siteId, flush));

onMessage("getSiteList", async () => {
  const metadata = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  const sites = metadata?.sites ?? {};
  const nameMap = metadata?.siteNameMap ?? {};
  return Promise.all(
    Object.entries(sites).map(async ([id, config]) => {
      const siteMetaData = await getDefinedSiteMetadata(id as TSiteID);
      const isDead = siteMetaData.isDead ?? false;
      return {
        id,
        name: nameMap[id] ?? config.merge?.name ?? id,
        url: config.url ?? "",
        offline: (isDead || config.isOffline) ?? false,
      };
    }),
  );
});

export async function getSiteInstance<TYPE extends "private" | "public">(
  siteId: TSiteID,
  options: { mergeUserConfig?: boolean } = {},
) {
  const { mergeUserConfig = true } = options;
  let storedSiteUserConfig: ISiteUserConfig = {};
  if (mergeUserConfig) {
    storedSiteUserConfig = await getSiteUserConfig(siteId);
  }

  logger({ msg: `getSiteInstance for ${siteId}`, data: storedSiteUserConfig });
  return await createSiteInstance<TYPE>(siteId, storedSiteUserConfig);
}

export async function getSiteFavicon(site: TSiteID | getFaviconMetadata, flush: boolean = false): Promise<string> {
  const siteId = typeof site === "string" ? site : site.id;
  let siteFavicon = (await (await ptdIndexDb).get("favicon", siteId)) ?? false;
  if (flush || !siteFavicon) {
    const siteInstance = await getSiteInstance(siteId);
    if (siteInstance) {
      siteFavicon = await getFavicon({
        id: siteId,
        urls: uniq([siteInstance.url, ...siteInstance.metadata.urls].filter(Boolean)),
        favicon: siteInstance.metadata.favicon,
      });

      await (await ptdIndexDb).put("favicon", siteFavicon, siteId);
    }
  }

  if (!siteFavicon) {
    siteFavicon = NO_IMAGE;
    logger({ msg: `getSiteFavicon for ${siteId} failed, use default NO_IMAGE.`, level: "warn" });
  }

  return siteFavicon;
}

onMessage("getSiteFavicon", async ({ data: { site, flush } }) => (await getSiteFavicon(site, flush))!);

export async function clearSiteFaviconCache() {
  logger({ msg: `clearSiteFaviconCache` });
  return await (await ptdIndexDb).clear("favicon");
}

async function saveSignInState(siteId: TSiteID, state: ISiteSignInResult) {
  const metadata = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  metadata.siteSignIns ??= {};
  metadata.siteSignIns[siteId] = state;
  await sendMessage("setExtStorage", { key: "metadata", value: metadata });
}

function signInDocument(data: unknown): Document | undefined {
  if (typeof Document !== "undefined" && data instanceof Document) return data;
  if (typeof data !== "string" || typeof DOMParser === "undefined") return undefined;
  return new DOMParser().parseFromString(data, "text/html");
}

function buildSignInFormData(definition: NonNullable<ReturnType<typeof normalizeSignInDefinition>>, data: unknown) {
  const formDefinition = definition.form;
  if (!formDefinition) return undefined;
  const document = signInDocument(data);
  const form = document?.querySelector("form");
  if (!form) return undefined;

  const values: Record<string, string | number | boolean> = { ...(formDefinition.extraData ?? {}) };
  for (const name of formDefinition.hiddenFieldNames) {
    const input = [...form.querySelectorAll("input")].find((item) => item.getAttribute("name") === name);
    const value = input?.getAttribute("value");
    if (!value) return undefined;
    values[name] = value;
  }

  const selector = formDefinition.submitSelector ?? 'input[type="submit"]';
  let submitOptions: Element[];
  try {
    submitOptions = [...form.querySelectorAll(selector)];
  } catch {
    return undefined;
  }
  if (!submitOptions.length) return undefined;
  const submitOption = formDefinition.randomSubmitOption
    ? submitOptions[Math.floor(Math.random() * submitOptions.length)]
    : submitOptions[0];
  const submitName = submitOption.getAttribute("name");
  const submitValue = submitOption.getAttribute("value");
  if (!submitName || submitValue === null) return undefined;
  values[submitName] = submitValue;
  return values;
}

export async function runSiteSignIn(siteId: TSiteID): Promise<ISiteSignInResult> {
  const metadata = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  const config = metadata?.sites?.[siteId];
  const previous = metadata?.siteSignIns?.[siteId];
  const now = Date.now();
  let definition: ReturnType<typeof normalizeSignInDefinition>;
  if (config) {
    try {
      definition = normalizeSignInDefinition((await getDefinedSiteMetadata(siteId)).signIn);
    } catch {
      definition = undefined;
    }
  }
  const emptyResult = (status: ISiteSignInResult["status"], error?: string): ISiteSignInResult => ({
    siteId,
    ...updateSiteSignInState(previous, status, now, definition?.cooldownMinutes ?? 24 * 60, error),
  });
  // A manual-only or expired-session result is actionable: the user may have
  // just passed a browser challenge or refreshed the site's cookies. Do not
  // let the old cooldown record from a previous definition revision mask a
  // newly available rule (this is also important when a generic NexusPHP
  // fallback is added after an earlier run).
  if (
    previous?.nextRunAt &&
    previous.nextRunAt > now &&
    previous.status !== "needsManual" &&
    previous.status !== "notLoggedIn"
  ) {
    return {
      siteId,
      ...previous,
      error: `签到冷却中，预计 ${new Date(previous.nextRunAt).toLocaleString()} 后可再次尝试。`,
    };
  }
  // `isOffline` is a search/user-info display preference, not a session
  // guarantee. MoviePilot still attempts a selected site's attendance URL
  // when its indexer is marked offline, so an explicitly enabled sign-in must
  // not be blocked by that unrelated flag.
  if (!config || !definition || config.signInEnabled !== true) {
    const result = emptyResult("needsManual", "该站点未声明可安全执行的签到能力，需手动完成。");
    await saveSignInState(siteId, result);
    return result;
  }
  let site: Awaited<ReturnType<typeof getSiteInstance<"private">>>;
  try {
    site = await getSiteInstance<"private">(siteId);
  } catch (error) {
    const result = emptyResult("failed", classifySignInError(error).error);
    await saveSignInState(siteId, result);
    return result;
  }
  if (definition.requiresPageSession || definition.requiresJavaScript) {
    const result = emptyResult("needsManual", "该站点需要真实页面会话或 JavaScript，需手动完成。");
    await saveSignInState(siteId, result);
    return result;
  }

  let status: ISiteSignInResult["status"] = "failed";
  let errorMessage: string | undefined;
  try {
    const response = await site.request(
      {
        url: definition.path,
        method: definition.method,
        responseType: definition.responseType,
        params: definition.params,
        data: definition.data,
      },
      false,
    );
    status = classifySignInResponse(definition, { status: response.status, data: response.data });
    if (status === "failed" && definition.form) {
      const data = buildSignInFormData(definition, response.data);
      if (!data) {
        errorMessage = "签到页面未找到可提交的动态表单。";
      } else {
        const formResponse = await site.request(
          {
            url: definition.form.submitPath,
            method: "post",
            responseType: definition.responseType,
            data,
          },
          false,
        );
        status = classifySignInResponse(definition, { status: formResponse.status, data: formResponse.data });
      }
    }
  } catch (error) {
    const classified = classifySignInError(error);
    status = classified.status;
    errorMessage = classified.error;
  }

  // MoviePilot's generic handler can render the attendance URL in a browser
  // session when an XHR is challenged.  Reuse the extension's existing
  // navigation capture so the user's Chrome cookies/UA/Cloudflare clearance
  // are used without uploading them or running remote scripts.  This fallback
  // is only enabled by an explicit site definition or the NexusPHP generic
  // rule, and a challenge page is never considered a successful sign-in.
  if (definition.browserNavigation && status !== "success" && status !== "alreadySigned") {
    try {
      const navigationUrl = new URL(definition.path, site.url).href;
      const captured = await captureNavigationDocument(navigationUrl);
      if (!captured?.html) {
        status = "failed";
        errorMessage = "浏览器签到页面没有返回内容。";
      } else {
        status = classifySignInResponse(definition, { status: 200, data: captured.html });
        errorMessage = status === "failed" ? "签到响应未匹配成功或已签到标记。" : undefined;
      }
    } catch (error) {
      const classified = classifySignInError(error);
      status = classified.status;
      errorMessage = classified.error;
    }
  }

  const result = emptyResult(
    status,
    errorMessage ?? (status === "failed" ? "签到响应未匹配成功或已签到标记。" : undefined),
  );
  await saveSignInState(siteId, result);
  return result;
}

onMessage("clearSiteFaviconCache", async () => await clearSiteFaviconCache());

onMessage("runSiteSignIn", async ({ data: siteId }) => await runSiteSignIn(siteId));
