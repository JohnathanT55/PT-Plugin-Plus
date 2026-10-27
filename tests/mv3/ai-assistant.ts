import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sanitizeAiContext } from "../../app/src/entries/shared/aiAssistant.ts";
import { projectLevelStats, redactMcpText } from "../../app/src/entries/shared/mcpRedaction.ts";

const context = sanitizeAiContext({
  searchKey: "  一部电影 ".repeat(100),
  torrentTitles: ["保留标题", "", "x".repeat(400)],
});
assert(context?.searchKey && context.searchKey.length <= 240, "search context is bounded");
assert.deepEqual(context?.torrentTitles, ["保留标题", "x".repeat(180)]);
const projected = sanitizeAiContext({
  torrentResults: [
    {
      site: "站点 A",
      title: "电影标题",
      subTitle: "4K HDR",
      size: 1024,
      seeders: 12,
      tags: ["中字"],
      url: "https://private.example/detail/1",
      link: "https://private.example/download/1",
    } as any,
  ],
  siteSummary: [
    {
      site: "站点 A",
      ratio: 2.1,
      uploaded: 1024,
      nextLevel: { uploadedNeeded: 512 },
      username: "must-not-leak",
    } as any,
  ],
  failures: [{ site: "站点 A", status: "timeout", message: "请求超时" }],
});
assert.equal(projected?.torrentResults?.[0].title, "电影标题");
assert(!JSON.stringify(projected).includes("private.example"), "AI projections never include URLs");
assert(!JSON.stringify(projected).includes("must-not-leak"), "AI projections never include unknown private fields");

const nextLevel = {
  levelName: "PowerUser",
  uploaded: 2 ** 40,
  uploadedNeeded: 2 ** 39,
  downloaded: 2 ** 38,
  ratio: 2.5,
  uploads: 10,
  seeding: 25,
  seedingSize: 2 ** 39,
  bonus: 1_000,
  bonusNeededInterval: 12,
  interval: 28,
};
const credentialBoundary = sanitizeAiContext({
  torrentResults: [
    {
      title: "Useful title https://fixture.example/download?passkey=fixture-url-secret",
      subTitle: "Cookie: session=fixture-cookie; csrf=fixture-csrf\n1080p",
      tags: ["中字", "Authorization: Bearer fixture-header-secret"],
      size: 4 * 2 ** 30,
      seeders: 12,
      leechers: 0,
      cookie: "fixture-hidden-cookie",
    } as any,
  ],
  siteSummary: [
    {
      site: "Fixture site",
      uploaded: 2 ** 39,
      ratio: 0,
      seeding: 25,
      nextLevel: {
        ...nextLevel,
        username: "fixture-private-user",
        nested: { cookie: "fixture-nested-cookie" },
        password: "fixture-password",
      },
      username: "fixture-user",
      config: { token: "fixture-config-token" },
    } as any,
  ],
  failures: [{ site: "Fixture site", message: "timeout https://fixture.example/api?token=fixture-query-secret" }],
});
const boundaryText = JSON.stringify(credentialBoundary);
for (const privateText of [
  "fixture.example",
  "fixture-url-secret",
  "fixture-cookie",
  "fixture-csrf",
  "fixture-header-secret",
  "fixture-hidden-cookie",
  "fixture-private-user",
  "fixture-nested-cookie",
  "fixture-password",
  "fixture-user",
  "fixture-config-token",
  "fixture-query-secret",
]) {
  assert(!boundaryText.includes(privateText), `export boundary removes ${privateText}`);
}
assert.deepEqual(
  credentialBoundary?.siteSummary?.[0].nextLevel,
  nextLevel,
  "next-level thresholds, traffic deficits, publication counts and time requirements remain usable",
);
assert.equal(credentialBoundary?.siteSummary?.[0].uploaded, 2 ** 39);
assert.equal(credentialBoundary?.siteSummary?.[0].ratio, 0, "zero is not treated as missing");
assert.equal(credentialBoundary?.torrentResults?.[0].size, 4 * 2 ** 30);
assert.equal(credentialBoundary?.torrentResults?.[0].leechers, 0);
assert(
  credentialBoundary?.torrentResults?.[0].subTitle?.includes("1080p"),
  "unrelated free-text remains available after redaction",
);
assert.deepEqual(
  projectLevelStats({ ratio: Infinity, uploaded: NaN, downloaded: 0 }),
  { downloaded: 0 },
  "non-finite values do not corrupt exported JSON",
);
assert.equal(redactMcpText("蓝光 1080p HDR 10bit", 120), "蓝光 1080p HDR 10bit", "ordinary search terms are unchanged");

const storage = readFileSync("app/src/entries/storage.ts", "utf8");
const backup = readFileSync("app/src/entries/offscreen/utils/backup.ts", "utf8");
const bridgeHandler = readFileSync("app/src/entries/offscreen/utils/mcpBridge.ts", "utf8");
const bridgeTypes = readFileSync("app/src/entries/shared/mcpBridge.ts", "utf8");
const pageContextPublisher = readFileSync("app/src/entries/options/utils/aiContext.ts", "utf8");
const myDataView = readFileSync("app/src/entries/options/views/Overview/MyData/Index.vue", "utf8");
const aiDialog = readFileSync("app/src/entries/options/views/Overview/SearchEntity/AiAssistantDialog.vue", "utf8");
assert(!storage.includes("aiAssistantSecret"), "AI secret storage key was removed from the extension schema");
assert(!backup.includes("aiAssistantSecret"), "AI secret is excluded from backup storage keys");
assert(bridgeHandler.includes('credentials: "omit"'), "MCP bridge requests omit site cookies");
assert(bridgeHandler.includes("/v1/assistant"), "AI requests are sent through the MCP bridge");
assert(
  bridgeHandler.includes('path === "/v1/assistant" ? 180_000'),
  "multi-round AI turns have a separate budget from connection polling",
);
assert(bridgeHandler.includes("/v1/session/open"), "PTPP opens a capability session with the MCP bridge");
assert(bridgeHandler.includes("/v1/session/") && bridgeHandler.includes("/poll"), "PTPP polls capability requests");
assert(bridgeHandler.includes("/response"), "PTPP returns capability results to the MCP bridge");
assert(
  !bridgeHandler.includes("chrome.runtime.getManifest()"),
  "offscreen bridge does not rely on optional getManifest API",
);
assert(
  bridgeTypes.includes('"ptpp.extension_info"') && bridgeTypes.includes('"ptpp.page_context"'),
  "MCP capability names are explicit and allowlisted",
);
assert(
  pageContextPublisher.includes('"setMcpPageContext"'),
  "page context is published through the MCP message boundary",
);
assert(!bridgeHandler.includes("aiAssistantSecret"), "MCP bridge never reads the old extension-local AI secret");
assert(!bridgeHandler.includes("logger("), "AI prompts and responses are not written to logs");
assert(
  bridgeHandler.includes("sanitizeAiContext(data.context)"),
  "AI context is sanitized before it reaches the MCP bridge",
);
assert(myDataView.includes("aiSiteSummaries"), "My Data uses a dedicated redacted summary projection");
assert(
  myDataView.includes("nextLevel"),
  "My Data context retains next-level requirements needed for useful AI analysis",
);
assert(aiDialog.includes("MarkdownContent"), "AI responses use the Markdown renderer");
assert(aiDialog.includes("promptForMode"), "AI dialog restores a default prompt when opened");
assert(!aiDialog.includes("v-html"), "AI responses are not inserted as raw HTML");
const summaryProjection = myDataView.match(/const aiSiteSummaries[\s\S]*?async function initPtppTable/)?.[0] ?? "";
assert(
  !/item\.(name|id|avatar|siteUserConfig)/.test(summaryProjection),
  "My Data projection excludes identity and site config",
);
assert(myDataView.includes('initial-mode="site-summary"'), "My Data summary uses the explicit site-summary mode");

console.log("AI assistant endpoint, privacy, and response parsing tests passed.");
