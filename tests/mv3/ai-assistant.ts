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
assert(storage.includes("aiAssistantSecret"), "AI secret has a dedicated local storage key");
assert(!backup.includes("aiAssistantSecret"), "AI secret is excluded from backup storage keys");
assert(aiHandler.includes('credentials: "omit"'), "AI requests omit site cookies");
assert(aiHandler.includes("max_tokens: 700"), "AI output has a bounded token budget");
assert(!aiHandler.includes("logger("), "AI prompts and responses are not written to logs");

console.log("AI assistant endpoint, privacy, and response parsing tests passed.");
