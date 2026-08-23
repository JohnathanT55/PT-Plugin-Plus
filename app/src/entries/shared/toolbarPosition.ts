import type { ToolbarDockSide } from "./types/storages/config.ts";

export const TOOLBAR_POSITION_VERSION = 2;
export const DEFAULT_TOOLBAR_EDGE_OFFSET = 16;
export const TOOLBAR_DEFAULT_WIDTH = 96;
export const TOOLBAR_COMPACT_WIDTH = 84;
export const TOOLBAR_DEFAULT_BUTTON_HEIGHT = 60;
export const TOOLBAR_COMPACT_BUTTON_HEIGHT = 48;

export interface ToolbarPlacement {
  dockSide: ToolbarDockSide;
  edgeOffset: number;
  verticalRatio: number;
}

export interface ToolbarCoordinates {
  x: number;
  y: number;
}

export interface ToolbarSize {
  width: number;
  height: number;
}

export interface ToolbarViewport {
  width: number;
  height: number;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function normalizeToolbarPlacement(input?: Partial<ToolbarPlacement>): ToolbarPlacement {
  return {
    dockSide: input?.dockSide === "left" ? "left" : "right",
    edgeOffset: Math.max(0, finiteOr(input?.edgeOffset, DEFAULT_TOOLBAR_EDGE_OFFSET)),
    verticalRatio: clampNumber(finiteOr(input?.verticalRatio, 0.5), 0, 1),
  };
}

export function placementToCoordinates(
  placementInput: Partial<ToolbarPlacement> | undefined,
  viewport: ToolbarViewport,
  toolbar: ToolbarSize,
): ToolbarCoordinates {
  const placement = normalizeToolbarPlacement(placementInput);
  const maxX = Math.max(0, viewport.width - toolbar.width);
  const maxY = Math.max(0, viewport.height - toolbar.height);
  // A distance saved on a wider window must never make the selected dock side
  // cross the viewport midpoint after a resize. Without this semantic clamp,
  // a right-docked toolbar with a large historical offset could resolve to
  // x=0 on a narrow tracker page and look like a site-specific left dock.
  const edgeOffset = clampNumber(placement.edgeOffset, 0, maxX / 2);

  return {
    x: placement.dockSide === "left" ? edgeOffset : maxX - edgeOffset,
    y: clampNumber(placement.verticalRatio * maxY, 0, maxY),
  };
}

export function coordinatesToPlacement(
  coordinates: ToolbarCoordinates,
  viewport: ToolbarViewport,
  toolbar: ToolbarSize,
): ToolbarPlacement {
  const maxX = Math.max(0, viewport.width - toolbar.width);
  const maxY = Math.max(0, viewport.height - toolbar.height);
  const x = clampNumber(finiteOr(coordinates.x, 0), 0, maxX);
  const y = clampNumber(finiteOr(coordinates.y, 0), 0, maxY);
  const dockSide: ToolbarDockSide = x + toolbar.width / 2 <= viewport.width / 2 ? "left" : "right";

  return {
    dockSide,
    edgeOffset: dockSide === "left" ? x : maxX - x,
    verticalRatio: maxY > 0 ? y / maxY : 0.5,
  };
}

export function migrateLegacyToolbarPosition(
  legacyPosition: Partial<ToolbarCoordinates> | undefined,
  viewport: ToolbarViewport,
  toolbar: ToolbarSize,
): ToolbarPlacement {
  const maxY = Math.max(0, viewport.height - toolbar.height);
  const legacyY = finiteOr(legacyPosition?.y, Number.NaN);
  const hasUsefulLegacyY = Number.isFinite(legacyY) && legacyY > 0 && legacyY <= maxY;

  return {
    dockSide: "right",
    edgeOffset: DEFAULT_TOOLBAR_EDGE_OFFSET,
    verticalRatio: hasUsefulLegacyY && maxY > 0 ? clampNumber(legacyY / maxY, 0, 1) : 0.5,
  };
}
