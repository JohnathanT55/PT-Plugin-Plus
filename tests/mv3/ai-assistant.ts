import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  sanitizeAiContext,
} from "../../app/src/entries/shared/aiAssistant.ts";

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

const storage = readFileSync("app/src/entries/storage.ts", "utf8");
const backup = readFileSync("app/src/entries/offscreen/utils/backup.ts", "utf8");
const bridgeHandler = readFileSync("app/src/entries/offscreen/utils/mcpBridge.ts", "utf8");
const myDataView = readFileSync("app/src/entries/options/views/Overview/MyData/Index.vue", "utf8");
const aiDialog = readFileSync("app/src/entries/options/views/Overview/SearchEntity/AiAssistantDialog.vue", "utf8");
assert(!storage.includes("aiAssistantSecret"), "AI secret storage key was removed from the extension schema");
assert(!backup.includes("aiAssistantSecret"), "AI secret is excluded from backup storage keys");
assert(bridgeHandler.includes('credentials: "omit"'), "MCP bridge requests omit site cookies");
assert(bridgeHandler.includes("/v1/assistant"), "AI requests are sent through the MCP bridge");
assert(!bridgeHandler.includes("aiAssistantSecret"), "MCP bridge never reads the old extension-local AI secret");
assert(!bridgeHandler.includes("logger("), "AI prompts and responses are not written to logs");
assert(
  bridgeHandler.includes("sanitizeAiContext(data.context)"),
  "AI context is sanitized before it reaches the MCP bridge",
);
assert(myDataView.includes("aiSiteSummaries"), "My Data uses a dedicated redacted summary projection");
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
