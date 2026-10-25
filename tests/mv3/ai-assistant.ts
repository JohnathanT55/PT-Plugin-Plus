import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildAiUserMessage,
  extractAiText,
  normalizeAiEndpoint,
  normalizeAiTimeout,
  sanitizeAiContext,
} from "../../app/src/entries/shared/aiAssistant.ts";

assert.equal(normalizeAiEndpoint("https://example.test"), "https://example.test/v1/chat/completions");
assert.equal(normalizeAiEndpoint("https://example.test/v1/"), "https://example.test/v1/chat/completions");
assert.equal(
  normalizeAiEndpoint("https://example.test/v1/chat/completions"),
  "https://example.test/v1/chat/completions",
);
assert.throws(() => normalizeAiEndpoint("file:///tmp/ai"), /HTTP 或 HTTPS/);
assert.throws(() => normalizeAiEndpoint("https://example.test/v1?api_key=secret"), /查询参数/);
assert.equal(normalizeAiTimeout(900), 1_000);
assert.equal(normalizeAiTimeout(80_000), 60_000);

const context = sanitizeAiContext({
  searchKey: "  一部电影 ".repeat(100),
  torrentTitles: ["保留标题", "", "x".repeat(400)],
});
assert(context?.searchKey && context.searchKey.length <= 240, "search context is bounded");
assert.deepEqual(context?.torrentTitles, ["保留标题", "x".repeat(180)]);
assert(buildAiUserMessage("整理关键词", context).includes("整理关键词"));
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
assert(buildAiUserMessage("生成搜索草稿", projected, "search-draft").includes("search-draft") === false);
assert(buildAiUserMessage("生成搜索草稿", projected, "search-draft").includes("JSON"));
assert(buildAiUserMessage("分析结果", projected, "result-advice").includes("不要执行下载"));
assert(buildAiUserMessage("总结站点", projected, "site-summary").includes("下一等级"));
assert.throws(() => buildAiUserMessage("   "), /请输入想让 AI/);

assert.deepEqual(extractAiText({ choices: [{ message: { content: "建议关键词" } }], model: "local-model" }), {
  text: "建议关键词",
  model: "local-model",
});
assert.equal(
  extractAiText({ choices: [{ message: { content: [{ type: "text", text: "第一段" }, { text: "第二段" }] } }] }).text,
  "第一段第二段",
);
assert.throws(() => extractAiText({ choices: [] }), /没有可显示/);

const storage = readFileSync("app/src/entries/storage.ts", "utf8");
const backup = readFileSync("app/src/entries/offscreen/utils/backup.ts", "utf8");
const aiHandler = readFileSync("app/src/entries/offscreen/utils/aiAssistant.ts", "utf8");
const myDataView = readFileSync("app/src/entries/options/views/Overview/MyData/Index.vue", "utf8");
assert(storage.includes("aiAssistantSecret"), "AI secret has a dedicated local storage key");
assert(!backup.includes("aiAssistantSecret"), "AI secret is excluded from backup storage keys");
assert(aiHandler.includes('credentials: "omit"'), "AI requests omit site cookies");
assert(aiHandler.includes("max_tokens: 700"), "AI output has a bounded token budget");
assert(!aiHandler.includes("logger("), "AI prompts and responses are not written to logs");
assert(aiHandler.includes('data.mode !== "test"'), "all user-triggered AI modes require opt-in");
assert(
  aiHandler.includes('buildAiUserMessage(data.prompt ?? "", data.context, data.mode)'),
  "AI mode instructions are explicit",
);
assert(myDataView.includes("aiSiteSummaries"), "My Data uses a dedicated redacted summary projection");
const summaryProjection = myDataView.match(/const aiSiteSummaries[\s\S]*?async function initPtppTable/)?.[0] ?? "";
assert(
  !/item\.(name|id|avatar|siteUserConfig)/.test(summaryProjection),
  "My Data projection excludes identity and site config",
);
assert(myDataView.includes('initial-mode="site-summary"'), "My Data summary uses the explicit site-summary mode");

console.log("AI assistant endpoint, privacy, and response parsing tests passed.");
