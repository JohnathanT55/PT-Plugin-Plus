import {
  coordinatesToPlacement,
  migrateLegacyToolbarPosition,
  normalizeToolbarPlacement,
  placementToCoordinates,
} from "../../app/src/entries/shared/toolbarPosition";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Toolbar position test failed: ${message}`);
}

const toolbar = { width: 80, height: 320 };
const wideViewport = { width: 1920, height: 1080 };

const defaultCoordinates = placementToCoordinates(undefined, wideViewport, toolbar);
assert(defaultCoordinates.x === 1824, "the default position is 16 px from the right edge");
assert(defaultCoordinates.y === 380, "the default position is vertically centered");

const leftCoordinates = placementToCoordinates(
  { dockSide: "left", edgeOffset: 24, verticalRatio: 0.25 },
  wideViewport,
  toolbar,
);
assert(leftCoordinates.x === 24, "left docking measures the offset from the left edge");
assert(leftCoordinates.y === 190, "vertical placement is relative to available viewport height");

const draggedLeft = coordinatesToPlacement({ x: 30, y: 190 }, wideViewport, toolbar);
assert(
  draggedLeft.dockSide === "left" && draggedLeft.edgeOffset === 30,
  "dragging near the left edge changes the global dock side",
);

const draggedRight = coordinatesToPlacement({ x: 1800, y: 570 }, wideViewport, toolbar);
assert(
  draggedRight.dockSide === "right" && draggedRight.edgeOffset === 40,
  "dragging near the right edge records a right-edge offset",
);

const resizedCoordinates = placementToCoordinates(draggedRight, { width: 1280, height: 800 }, toolbar);
assert(resizedCoordinates.x === 1160, "a narrower viewport preserves the selected right edge");
assert(resizedCoordinates.y === 360, "a shorter viewport preserves the vertical ratio");

const migrated = migrateLegacyToolbarPosition({ x: 120, y: 200 }, wideViewport, toolbar);
assert(migrated.dockSide === "right", "legacy absolute X never creates a site-specific left-side exception");
assert(migrated.edgeOffset === 16, "legacy coordinates migrate to the default edge offset");
assert(migrated.verticalRatio === 200 / 760, "a valid legacy Y position is preserved proportionally");

const normalized = normalizeToolbarPlacement({ dockSide: "right", edgeOffset: -1, verticalRatio: 2 });
assert(normalized.edgeOffset === 0 && normalized.verticalRatio === 1, "invalid persisted placement values are clamped");

const zeroViewport = placementToCoordinates(
  { dockSide: "right", edgeOffset: 16, verticalRatio: 0.5 },
  { width: 0, height: 0 },
  toolbar,
);
assert(zeroViewport.x === 0 && zeroViewport.y === 0, "a not-yet-laid-out background tab remains in bounds");

const recoveredViewport = placementToCoordinates(
  { dockSide: "right", edgeOffset: 16, verticalRatio: 0.5 },
  wideViewport,
  toolbar,
);
assert(
  recoveredViewport.x === wideViewport.width - toolbar.width - 16,
  "recalculating after a background tab gains a viewport restores the configured right dock",
);

const narrowViewport = { width: 640, height: 800 };
const oversizedRightOffset = placementToCoordinates(
  { dockSide: "right", edgeOffset: 1600, verticalRatio: 0.5 },
  narrowViewport,
  toolbar,
);
assert(
  oversizedRightOffset.x === (narrowViewport.width - toolbar.width) / 2,
  "a historical edge offset cannot move a right-docked toolbar into the left half after resize",
);
const oversizedLeftOffset = placementToCoordinates(
  { dockSide: "left", edgeOffset: 1600, verticalRatio: 0.5 },
  narrowViewport,
  toolbar,
);
assert(
  oversizedLeftOffset.x === (narrowViewport.width - toolbar.width) / 2,
  "a historical edge offset cannot move a left-docked toolbar into the right half after resize",
);

console.log("Toolbar position tests passed.");
