import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

import {
  measureHorizontalOverflow,
  normalizeResponsiveHeaders,
} from "../../app/src/entries/options/utils/responsiveTable.ts";

const headers = [
  { key: "title", title: "Title", minWidth: "18rem" },
  { key: "size", title: "Size" },
  { key: "action", title: "Action", sortable: true, width: 120 },
];
const originalHeaders = structuredClone(headers);
const normalized = normalizeResponsiveHeaders(headers, {
  primaryKeys: ["title"],
  actionKey: "action",
  actionWidth: "11rem",
  secondaryMinWidth: "7rem",
});

assert.notEqual(normalized, headers, "header collection must be cloned");
assert.notEqual(normalized[0], headers[0], "every caller-owned header must be cloned");
assert.deepEqual(headers, originalHeaders, "normalization must not mutate caller-owned headers");
assert.equal(normalized[0].ptppRole, "primary");
assert.equal(normalized[0].fixed, undefined, "primary columns must scroll normally");
assert.match(String(normalized[0].headerProps?.class), /ptpp-responsive-primary-column/);
assert.equal(normalized[1].ptppRole, "secondary");
assert.equal(normalized[1].minWidth, "7rem");
assert.match(String(normalized[1].cellProps?.class), /ptpp-responsive-secondary-column/);
assert.equal(normalized[2].ptppRole, "action");
assert.equal(normalized[2].fixed, "end");
assert.equal(normalized[2].sortable, false);
assert.equal(normalized[2].width, "11rem");
assert.equal(normalized[2].minWidth, "11rem");
assert.match(String(normalized[2].cellProps?.class), /ptpp-responsive-action-column/);

const legacy = normalizeResponsiveHeaders(
  [
    { value: "name", title: "Name" },
    { value: "buttons", title: "Buttons" },
    { value: "menu", title: "Menu" },
  ],
  { primaryKeys: ["name"], actionKey: ["buttons", "menu"], actionWidth: 144 },
);
assert.equal(legacy[0].ptppRole, "primary", "legacy value-based primary keys must be supported");
assert.equal(legacy[1].fixed, "end", "the first legacy action key must be fixed");
assert.equal(legacy[2].fixed, "end", "multiple action keys must be supported");
assert.equal(legacy[2].minWidth, 144);

const explicitSecondaryWidth = normalizeResponsiveHeaders(
  [
    { key: "category", width: "9rem" },
    { key: "size", minWidth: "12rem" },
  ],
  { secondaryMinWidth: "7rem" },
);
assert.equal(explicitSecondaryWidth[0].minWidth, undefined, "explicit width must not gain a default minWidth");
assert.equal(explicitSecondaryWidth[1].minWidth, "12rem", "explicit secondary minWidth must be preserved");

assert.deepEqual(measureHorizontalOverflow(800, 800, 20), {
  hasOverflow: false,
  scrollWidth: 800,
  maxScrollLeft: 0,
  scrollLeft: 0,
});
assert.deepEqual(measureHorizontalOverflow(1400, 800, 900), {
  hasOverflow: true,
  scrollWidth: 1400,
  maxScrollLeft: 600,
  scrollLeft: 600,
});
assert.equal(measureHorizontalOverflow(-20, -10, -5).scrollLeft, 0);

const mainScss = readFileSync("app/src/entries/options/main.scss", "utf8");
const appSource = readFileSync("app/src/entries/options/App.vue", "utf8");
const responsiveTableSource = readFileSync(
  "app/src/entries/options/components/ResponsiveDataTable.vue",
  "utf8",
);
assert.doesNotMatch(
  appSource,
  /useDevicePixelRatio|wrongPixelRatioNotice|<v-system-bar/,
  "browser zoom must not be blocked by an app-level warning",
);
assert.match(mainScss, /--ptpp-table-hover-solid:/, "solid hover token is required");
assert.match(
  mainScss,
  /\.ptpp-responsive-action-column[\s\S]*?z-index:/,
  "the fixed action region needs an explicit stacking layer",
);
assert.doesNotMatch(
  mainScss,
  /var\(--ptpp-hover\)\s+100%/,
  "transparent color-mix must not be used for table hover backgrounds",
);
assert.match(
  responsiveTableSource,
  /watch\(\s*host,/,
  "the internal Vuetify scroller must reconnect when the component root ref becomes available",
);
assert.match(
  responsiveTableSource,
  /onUpdated\(connectScroller\)/,
  "async table rendering must get another scroller connection opportunity",
);
assert.doesNotMatch(
  responsiveTableSource,
  /nextTick/,
  "scroller discovery must not be deferred behind a potentially starved update queue",
);
assert.match(
  responsiveTableSource,
  /queueMicrotask\(/,
  "overflow metrics must still update when Chrome throttles background requestAnimationFrame callbacks",
);

console.log("Responsive table role and isolation contract passed.");
