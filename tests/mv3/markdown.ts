import assert from "node:assert/strict";

import {
  parseMarkdown,
  parseMarkdownInline,
} from "../../app/src/entries/options/views/Overview/SearchEntity/utils/markdown.ts";

const blocks = parseMarkdown(
  "## audiences 站点统计摘要\n\n**分享率**\n- 当前分享率：**5.187**\n- 表现良好\n\n| 指标 | 数值 |\n|---|---|\n| 分享率 | 5.187 |\n\n> 仅供参考\n\n```text\nraw <script>alert(1)</script>\n```",
);
assert.equal(blocks[0].type, "heading");
assert.equal(blocks[1].type, "paragraph");
assert.equal(blocks[2].type, "unordered-list");
assert.equal(blocks[3].type, "table");
assert.equal(blocks[4].type, "blockquote");
assert.equal(blocks[5].type, "code");
assert.equal((blocks[5] as { value: string }).value, "raw <script>alert(1)</script>");

const escapedTable = parseMarkdown("\\| 指标 | 数值 |\\\n\\|---|---|\\\n\\| 分享率 | 5.187 |\\");
assert.equal(escapedTable[0].type, "table");

const inline = parseMarkdownInline("**粗体**、`代码`、[安全链接](https://example.test) 和 [不安全](javascript:alert(1))");
assert(inline.some((node) => node.type === "strong"), "bold markdown is parsed");
assert(inline.some((node) => node.type === "code"), "inline code is parsed");
assert(inline.some((node) => node.type === "link" && node.href === "https://example.test"), "http links are allowed");
assert(!inline.some((node) => node.type === "link" && node.href.startsWith("javascript:")), "unsafe links are never emitted");

console.log("AI Markdown rendering parser tests passed.");
