import { createSearchRunGuard } from "../../src/search/runGuard";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Search run test failed: ${message}`);
}

const guard = createSearchRunGuard();
assert(guard.current() === 0, "a new guard starts at generation zero");

const firstRun = guard.begin();
assert(guard.isCurrent(firstRun), "the first search run is current");

const secondRun = guard.begin();
assert(!guard.isCurrent(firstRun), "starting a new search invalidates an in-flight old search");
assert(guard.isCurrent(secondRun), "the replacement search is current");

const committedResults: string[] = [];
if (guard.isCurrent(firstRun)) committedResults.push("stale");
if (guard.isCurrent(secondRun)) committedResults.push("current");
assert(
  committedResults.length === 1 && committedResults[0] === "current",
  "only the current search may commit results",
);

const cancelledRun = guard.begin();
assert(!guard.isCurrent(secondRun), "cancellation can invalidate the active request generation");
assert(guard.isCurrent(cancelledRun), "the cancellation generation becomes the active boundary");

console.log("Search generation isolation passed.");
