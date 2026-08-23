import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Search layout test failed: ${message}`);
}

const searchPageSource = readFileSync("app/src/entries/options/views/Overview/SearchEntity/Index.vue", "utf8");

assert(
  !searchPageSource.includes('minWidth: "30rem"'),
  "the title column must not keep the archived fixed 30rem minimum width",
);
assert(searchPageSource.includes('minWidth: "clamp('), "the title column must use a bounded responsive minimum width");
assert(searchPageSource.includes('fixed: "end"'), "the per-row action column must remain fixed at the right edge");
assert(
  searchPageSource.includes("<ResponsiveDataTable"),
  "search results must use the shared responsive table contract",
);
assert(
  searchPageSource.includes(":top-scrollbar-label="),
  "the shared top horizontal scrollbar must have an accessible label",
);
assert(
  !/\.ptpp-search-card\s*\{[^}]*overflow:\s*hidden;/s.test(searchPageSource),
  "the outer search card must not silently clip wide table content",
);

console.log("Search layout accessibility contract passed.");
