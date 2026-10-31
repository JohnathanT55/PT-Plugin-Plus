import assert from "node:assert/strict";

import { projectRegistrationProgress, projectLevelStats } from "../../app/src/entries/shared/mcpRedaction.ts";

const week = 7 * 24 * 60 * 60 * 1_000;
const now = Date.now();

const pending = projectRegistrationProgress("P80W", now - 77 * week, "P3W");
assert.equal(pending.registrationStatus, "incomplete", "a future registration threshold is marked incomplete");
assert.equal(pending.intervalRequirement, "P80W");
assert.equal(pending.intervalRemaining, "P3W");
assert(
  typeof pending.expectedAt === "number" && pending.expectedAt > now,
  "expectedAt is retained as a future timestamp",
);

const pendingFromSeconds = projectRegistrationProgress("P80W", Math.floor((now - 77 * week) / 1_000), "P3W");
assert.equal(pendingFromSeconds.registrationStatus, "incomplete", "legacy Unix-second join dates are normalized");
assert(typeof pendingFromSeconds.expectedAt === "number" && pendingFromSeconds.expectedAt > now);

const sampleJoin = new Date(2024, 0, 1, 12);
const sampleExpected = new Date(sampleJoin);
sampleExpected.setDate(sampleExpected.getDate() + 80 * 7);
const sample = projectRegistrationProgress("P80W", sampleJoin.getTime());
assert.equal(sample.expectedAt, sampleExpected.getTime(), "80 calendar weeks preserve local time across DST");

const unavailable = projectRegistrationProgress("P80W", undefined, "P3W");
assert.equal(unavailable.registrationStatus, "unavailable");
assert.equal(unavailable.intervalRequirement, "P80W");
assert.equal(unavailable.intervalRemaining, undefined, "missing join time must not reuse a guessed gap");
assert(
  !Object.prototype.hasOwnProperty.call(unavailable, "expectedAt"),
  "missing join date never produces a guessed date",
);

const met = projectRegistrationProgress("P80W", now - 81 * week, undefined);
assert.equal(met.registrationStatus, "met", "an elapsed registration threshold is marked met");
assert(typeof met.expectedAt === "number" && met.expectedAt < now);

assert.deepEqual(projectRegistrationProgress(undefined, now), { registrationStatus: "not_required" });
assert.deepEqual(projectRegistrationProgress("P", now), { registrationStatus: "not_required" });
assert.deepEqual(projectRegistrationProgress("PT", now), { registrationStatus: "not_required" });
assert.deepEqual(
  projectLevelStats({
    registrationStatus: "incomplete",
    intervalRequirement: "P80W",
    expectedAt: met.expectedAt,
    secret: "omit",
  }),
  { registrationStatus: "incomplete", intervalRequirement: "P80W", expectedAt: met.expectedAt },
);

console.log("MCP user-data registration projection tests passed.");
