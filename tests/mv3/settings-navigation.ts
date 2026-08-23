import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

import {
  DEFAULT_SET_BASE_ROUTE_NAME,
  getNavigationTargetName,
} from "../../app/src/entries/options/utils/navigation.ts";

assert.equal(DEFAULT_SET_BASE_ROUTE_NAME, "SetBaseGeneral");
assert.equal(
  getNavigationTargetName({
    name: "SetBase",
    children: [
      { path: "toolbar", name: "SetBaseToolbar" },
      { path: "", name: "SetBaseGeneral" },
    ],
  }),
  "SetBaseGeneral",
  "a parent menu entry must target its default child",
);
assert.equal(getNavigationTargetName({ name: "SetSite" }), "SetSite");
assert.equal(getNavigationTargetName({ name: "NoDefault", children: [{ path: "child", name: "Child" }] }), "NoDefault");

const navigationSource = readFileSync("app/src/entries/options/views/Layout/Navigation.vue", "utf8");
assert.match(navigationSource, /getNavigationTargetName\(childrenRoute\)/);

const setBaseSource = readFileSync("app/src/entries/options/views/Settings/SetBase/Index.vue", "utf8");
assert.match(setBaseSource, /legalSetBaseRouteNames/, "settings tabs must validate child route names");
assert.match(setBaseSource, /router\.replace\(\{ name: DEFAULT_SET_BASE_ROUTE_NAME \}\)/);
assert.match(setBaseSource, /watch\(/, "the parent route needs immediate normalization");
assert.doesNotMatch(setBaseSource, /<v-window\b/, "router-view must not be wrapped in an unpaired Vuetify window");
assert.match(setBaseSource, /class="settings-content/, "settings content shell must remain visible");

console.log("Settings navigation default-child contract passed.");
