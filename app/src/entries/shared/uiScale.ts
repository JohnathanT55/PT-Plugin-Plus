export const UI_SCALE_STEPS = [80, 90, 100, 110, 125] as const;
export type UiScalePercent = (typeof UI_SCALE_STEPS)[number];
export const DEFAULT_UI_SCALE: UiScalePercent = 100;

export function normalizeUiScale(value: unknown): UiScalePercent {
  const numericValue = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) return DEFAULT_UI_SCALE;

  return UI_SCALE_STEPS.reduce((nearest, candidate) =>
    Math.abs(candidate - numericValue) < Math.abs(nearest - numericValue) ? candidate : nearest,
  );
}

export function getUiScaleStep(value: unknown, direction: -1 | 1): UiScalePercent {
  const current = normalizeUiScale(value);
  const currentIndex = UI_SCALE_STEPS.indexOf(current);
  const nextIndex = Math.min(UI_SCALE_STEPS.length - 1, Math.max(0, currentIndex + direction));
  return UI_SCALE_STEPS[nextIndex];
}

export function resetUiScale(): UiScalePercent {
  return DEFAULT_UI_SCALE;
}

export function uiScaleDiagnostics(internalScale: unknown, devicePixelRatio: unknown) {
  const normalizedRatio =
    typeof devicePixelRatio === "number" && Number.isFinite(devicePixelRatio)
      ? Math.round(devicePixelRatio * 100) / 100
      : 1;
  return {
    internalScalePercent: normalizeUiScale(internalScale),
    devicePixelRatio: normalizedRatio,
  } as const;
}
