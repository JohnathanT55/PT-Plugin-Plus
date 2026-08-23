import { readFileSync } from "node:fs";

import {
  resolveOpenSiteIds,
  resolveRefreshSiteIds,
} from "../../app/src/entries/options/views/Overview/MyData/utils/siteActions";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`My Data site actions test failed: ${message}`);
}

const items = [
  { site: "audiences", selectable: true, refreshable: true },
  { site: "no-user-info", selectable: true, refreshable: false },
  { site: "offline", selectable: false, refreshable: false },
] as any[];

assert(
  resolveOpenSiteIds([], items).join(",") === "audiences,no-user-info",
  "batch open uses every available site when no row is selected",
);
assert(
  resolveOpenSiteIds(["no-user-info" as any], items).join(",") === "no-user-info",
  "batch open uses only selected available sites",
);
assert(
  resolveRefreshSiteIds([], items).join(",") === "audiences",
  "refresh-all excludes sites whose definitions do not expose user-info retrieval",
);
assert(
  resolveRefreshSiteIds(["no-user-info" as any], items).length === 0,
  "a selected site without a user-info definition is not scheduled for refresh",
);

const configSource = readFileSync("app/src/entries/options/stores/config.ts", "utf8");
assert(
  configSource.includes("showNextLevelInTable: true") && configSource.includes("showIntervalAsDate: true"),
  "next-level requirements and their date presentation are enabled by default",
);

console.log("My Data site actions tests passed.");
