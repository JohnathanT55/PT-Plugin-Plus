import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { ISiteSignInDefinition } from "../../app/src/packages/site/types/site.ts";
import {
  canRunSiteSignIn,
  classifySignInError,
  classifySignInResponse,
  normalizeSignInDefinition,
  updateSiteSignInState,
} from "../../app/src/entries/shared/siteSignIn.ts";

const definition: ISiteSignInDefinition = {
  enabled: true,
  path: "/attendance",
  method: "post",
  cooldownMinutes: 1,
  success: { responseTextIncludes: ["签到成功"] },
  alreadySigned: { responseTextIncludes: ["今日已签到"] },
  notLoggedIn: { statusCodes: [401] },
};
const normalized = normalizeSignInDefinition(definition)!;
assert.equal(normalized.path, "/attendance");
assert.equal(normalized.cooldownMinutes, 360, "sign-in cooldown has a six-hour safety floor");
assert.equal(normalizeSignInDefinition({ ...definition, path: "https://private.example/attendance" }), undefined);
assert.equal(normalizeSignInDefinition({ ...definition, path: "//private.example/attendance" }), undefined);
assert.equal(normalizeSignInDefinition({ ...definition, data: { passkey: "secret" } }), undefined);
assert.equal(classifySignInResponse(definition, { status: 200, data: "签到成功" }), "success");
assert.equal(classifySignInResponse(definition, { status: 200, data: "今日已签到" }), "alreadySigned");
assert.equal(classifySignInResponse(definition, { status: 401, data: "login" }), "notLoggedIn");
assert.equal(classifySignInResponse(definition, { status: 200, data: "unknown" }), "failed");
assert.equal(
  classifySignInResponse(definition, { status: 200, data: "cf-chl-captcha challenge-platform" }),
  "needsManual",
);
assert.equal(
  classifySignInResponse(
    { ...definition, success: { statusCodes: [200], responseTextExcludes: ["每日签到"] } },
    { status: 200, data: "签到完成" },
  ),
  "success",
);
assert.equal(
  classifySignInResponse(
    { ...definition, success: { statusCodes: [200], responseTextExcludes: ["每日签到"] } },
    { status: 200, data: "每日签到" },
  ),
  "failed",
  "an excluded marker must prevent status-only success classification",
);
const genericDefinition = {
  ...definition,
  source: "generic" as const,
  success: { statusCodes: [200], responseTextExcludes: ["login.php"] },
  alreadySigned: { responseTextIncludes: ["已签到"] },
};
assert.equal(
  classifySignInResponse(genericDefinition, { status: 200, data: "<a>签到</a>" }),
  "needsManual",
  "generic HTTP 200 pages without attendance evidence require manual confirmation",
);
assert.equal(
  classifySignInResponse(genericDefinition, { status: 200, data: "签到成功，获得 10 魔力" }),
  "success",
  "generic attendance evidence is accepted",
);

const ptTimeDefinition = readFileSync("app/src/packages/site/definitions/pttime.ts", "utf8");
assert(ptTimeDefinition.includes('path: "/attendance.php"'), "PTTime declares the MoviePilot attendance endpoint");
assert(ptTimeDefinition.includes('responseTextIncludes: ["签到成功"]'), "PTTime success marker is declared");
assert(ptTimeDefinition.includes('responseTextIncludes: ["login.php"]'), "PTTime login expiry marker is declared");

const u2Definition = readFileSync("app/src/packages/site/definitions/u2.ts", "utf8");
assert(u2Definition.includes('submitPath: "/showup.php?action=show"'), "U2 declares its dynamic form submit path");
assert(u2Definition.includes('hiddenFieldNames: ["req", "hash", "form"]'), "U2 declares bounded hidden form fields");
assert(u2Definition.includes("randomSubmitOption: true"), "U2 selects one declared submit option");
assert.equal(
  normalizeSignInDefinition({ ...definition, form: { submitPath: "https://evil.example", hiddenFieldNames: ["x"] } }),
  undefined,
  "dynamic sign-in forms must keep their submit path relative",
);
const siteIndex = readFileSync("app/src/packages/site/index.ts", "utf8");
assert(siteIndex.includes('source: "generic"'), "ordinary NexusPHP sites expose an explicitly labelled generic rule");
assert(siteIndex.includes("browserNavigation: true"), "the generic NexusPHP rule can fall back to a browser session");
assert(
  siteIndex.includes('path: "/attendance.php"'),
  "the generic NexusPHP rule uses the conventional attendance endpoint",
);
for (const [file, marker] of [
  ["btschool.ts", 'path: "/index.php?action=addbonus"'],
  ["hares.ts", 'path: "/attendance.php?action=sign"'],
  ["hdarea.ts", 'path: "/sign_in.php"'],
  ["hdcity.ts", 'path: "/sign"'],
  ["nexushd.ts", 'path: "/signin.php"'],
  ["pter.ts", 'path: "/attendance-ajax.php"'],
  ["yemapt.ts", 'path: "/api/consumer/checkIn"'],
] as const) {
  assert(
    readFileSync(`app/src/packages/site/definitions/${file}`, "utf8").includes(marker),
    `${file} declares a MoviePilot attendance endpoint`,
  );
}

const now = 1_000_000;
const success = updateSiteSignInState(undefined, "success", now, 360);
assert.equal(success.nextRunAt, now + 360 * 60_000);
assert(!canRunSiteSignIn(success, { now: now + 1, cooldownMinutes: 360, enabled: true, paused: false }));
assert(!canRunSiteSignIn(undefined, { now, cooldownMinutes: 360, enabled: false, paused: false }));
assert(!canRunSiteSignIn(undefined, { now, cooldownMinutes: 360, enabled: true, paused: true }));
assert(canRunSiteSignIn(undefined, { now, cooldownMinutes: 360, enabled: true, paused: false }));

const failed = updateSiteSignInState(undefined, "failed", now, 360, "Request failed: passkey=secret-token");
assert.equal(failed.failureCount, 1);
assert(!failed.error?.includes("secret-token"));
assert.equal(classifySignInError(new Error("Cloudflare challenge")).status, "needsManual");

console.log("Site sign-in capability, status, cooldown, and redaction tests passed.");
