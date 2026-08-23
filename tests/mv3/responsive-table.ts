import {
  measureHorizontalOverflow,
  normalizeResponsiveHeaders,
} from "../../app/src/entries/options/utils/responsiveTable.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Responsive table test failed: ${message}`);
}

const source = [
  { title: "Title", key: "title", minWidth: "30rem" },
  { title: "Action", key: "action", sortable: true, width: "5rem" },
];
const normalized = normalizeResponsiveHeaders(source);

assert(normalized !== source, "header collection must be cloned");
assert(normalized[0] !== source[0], "header objects must be cloned");
assert(source[1].sortable === true, "caller-owned action header must not be mutated");
assert(normalized[0].key === "title", "ordinary headers must keep their identity");
assert(normalized[1].fixed === "end", "action column must be fixed at the end");
assert(normalized[1].sortable === false, "action column must not be sortable");
assert(normalized[1].width === "11rem", "action column must have a stable default width");
assert(normalized[1].headerProps?.class.includes("ptpp-responsive-action-column"), "action header class missing");
assert(normalized[1].cellProps?.class.includes("ptpp-responsive-action-column"), "action cell class missing");

const custom = normalizeResponsiveHeaders(source, { actionWidth: "14rem" });
assert(custom[1].width === "14rem" && custom[1].minWidth === "14rem", "custom action width ignored");

const noOverflow = measureHorizontalOverflow(800, 800, 20);
assert(!noOverflow.hasOverflow && noOverflow.scrollWidth === 800, "equal dimensions must not overflow");
assert(noOverflow.scrollLeft === 0, "scrollLeft must clamp when there is no overflow");

const overflow = measureHorizontalOverflow(1400, 800, 900);
assert(overflow.hasOverflow, "wide tables must report overflow");
assert(overflow.scrollWidth === 1400, "scroll width must be preserved");
assert(overflow.maxScrollLeft === 600, "maximum scroll offset is incorrect");
assert(overflow.scrollLeft === 600, "scroll offset must clamp to the maximum");

console.log("Responsive table domain contract passed.");
