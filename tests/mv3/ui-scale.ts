import {
  DEFAULT_UI_SCALE,
  UI_SCALE_STEPS,
  getUiScaleStep,
  normalizeUiScale,
  resetUiScale,
  uiScaleDiagnostics,
} from "../../app/src/entries/shared/uiScale.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`UI scale test failed: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string) {
  assert(Object.is(actual, expected), `${message}; expected ${String(expected)}, got ${String(actual)}`);
}

assert(JSON.stringify(UI_SCALE_STEPS) === JSON.stringify([80, 90, 100, 110, 125]), "supported steps changed");
equal(DEFAULT_UI_SCALE, 100, "default scale");

equal(normalizeUiScale(undefined), 100, "missing values migrate to default");
equal(normalizeUiScale(null), 100, "null values migrate to default");
equal(normalizeUiScale("90"), 90, "numeric backup values migrate");
equal(normalizeUiScale(87), 90, "legacy free-form values use the nearest safe step");
equal(normalizeUiScale(10), 80, "values below the lower bound clamp");
equal(normalizeUiScale(999), 125, "values above the upper bound clamp");
equal(normalizeUiScale(Number.NaN), 100, "non-finite values migrate to default");

equal(getUiScaleStep(80, -1), 80, "decrease clamps at lower bound");
equal(getUiScaleStep(80, 1), 90, "increase advances one supported step");
equal(getUiScaleStep(100, -1), 90, "decrease uses adjacent step");
equal(getUiScaleStep(110, 1), 125, "increase handles non-uniform final step");
equal(getUiScaleStep(125, 1), 125, "increase clamps at upper bound");
equal(resetUiScale(), 100, "reset returns the documented default");

const diagnostics = uiScaleDiagnostics(90, 1.5);
equal(diagnostics.internalScalePercent, 90, "diagnostics preserve internal scale");
equal(diagnostics.devicePixelRatio, 1.5, "diagnostics preserve combined DPR");
assert(!("browserZoom" in diagnostics), "DPR must not be reported as browser zoom");
assert(!("systemScale" in diagnostics), "DPR must not be reported as Windows scale");

console.log("UI scale domain contract passed.");
