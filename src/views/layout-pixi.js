// layout-pixi.js (VIEW-ONLY)
// Shared layout constants/helpers for the env + hub rows.

// Canonical design-space dimensions for the Pixi stage.
export const VIEWPORT_DESIGN_WIDTH = 2424;
export const VIEWPORT_DESIGN_HEIGHT = 1080;

function resolveAnchorFactor(axis, rawAnchor) {
  const anchor = String(rawAnchor || "").toLowerCase();
  if (axis === "x") {
    if (anchor === "center" || anchor === "middle") return 0.5;
    if (anchor === "right" || anchor === "end") return 1;
    return 0;
  }
  if (anchor === "center" || anchor === "middle") return 0.5;
  if (anchor === "bottom" || anchor === "end") return 1;
  return 0;
}

export function resolveAnchoredPoint({
  screenWidth,
  screenHeight,
  anchorX = "left",
  anchorY = "top",
  offsetX = 0,
  offsetY = 0,
} = {}) {
  const width = Number.isFinite(screenWidth)
    ? Math.max(1, Math.floor(screenWidth))
    : VIEWPORT_DESIGN_WIDTH;
  const height = Number.isFinite(screenHeight)
    ? Math.max(1, Math.floor(screenHeight))
    : VIEWPORT_DESIGN_HEIGHT;
  const xFactor = resolveAnchorFactor("x", anchorX);
  const yFactor = resolveAnchorFactor("y", anchorY);
  return {
    x: width * xFactor + Number(offsetX || 0),
    y: height * yFactor + Number(offsetY || 0),
  };
}

export function resolveAnchoredRect({
  screenWidth,
  screenHeight,
  width = 0,
  height = 0,
  anchorX = "left",
  anchorY = "top",
  offsetX = 0,
  offsetY = 0,
} = {}) {
  const w = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const h = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0;
  const xFactor = resolveAnchorFactor("x", anchorX);
  const yFactor = resolveAnchorFactor("y", anchorY);
  const anchor = resolveAnchoredPoint({
    screenWidth,
    screenHeight,
    anchorX,
    anchorY,
    offsetX,
    offsetY,
  });
  return {
    x: anchor.x - w * xFactor,
    y: anchor.y - h * yFactor,
    width: w,
    height: h,
  };
}

// Centralized top-level module placement/layout contract.
export const VIEW_LAYOUT = {
  tooltip: {
    margin: 10,
  },
  debugOverlay: {
    anchorX: "right",
    anchorY: "top",
    offsetX: -24,
    offsetY: 10,
  },
  logs: {
    action: { x: 1620, y: 180 },
    event: { x: 20, y: 180 },
  },
  processWidget: {
    position: { x: 1180, y: 640 },
  },
  graphs: {
    gold: { x: 350, y: 280 },
    grain: { x: 350, y: 370 },
    food: { x: 350, y: 460 },
    system: { x: 350, y: 220 },
    ap: { x: 350, y: 80 },
    population: { x: 350, y: 640 },
  },
  skillTree: {
    viewport: { x: 0, y: 0, width: 2424, height: 1080 },
    panel: { x: 1910 },
    sideText: { width: 390 },
    buttons: {
      saveExitX: 1910,
      cancelX: 2090,
      editorX: 2200,
      zoomInX: 1910,
      zoomOutX: 2010,
      zoomTextX: 2110,
      edgeModeX: 1910,
    },
    layoutBounds: {
      x: 90,
      y: 70,
      width: 1280,
      height: 900,
      columnSpacing: 220,
      rowSpacing: 110,
      leftPad: 120,
    },
  },
  skillTreeEditor: {
    viewport: { x: 20, y: 20, width: 1900, height: 1040 },
    panel: {
      x: 1960,
      width: 430,
      rowGap: 40,
      sectionGap: 10,
      textGap: 8,
      headerWidth: 408,
      colBX: 2170,
    },
  },
  sunMoonDisks: {
    enabled: true,
    zIndex: 0,
    moon: {
      x: 2000,
      y: 400,
      scale: 0.5,
      alpha: 1.0,
      rotationOffsetRad: 0,
      playheadOffsetRad: -1.55,
      clockwise: true,
      texturePath: "images/MoonDisk_01.png",
    },
    season: {
      x: 2000,
      y: 400,
      scale: 0.75,
      alpha: 1.0,
      rotationOffsetRad: 3,
      playheadOffsetRad: -0.7,
      clockwise: true,
      texturePath: "images/SeasonDisk_01.png",
      quadrants: 4,
    },
  },
  envEventDeck: {
    enabled: true,
    zIndex: 1,
    width: 72,
    height: 98,
    maxCatchupFlights: 16,
    cacheSeconds: 512,
    interFlightDelaySec: 0.045,
    placementStaggerSec: 0.04,
    placedDurationSec: 0.72,
    returnedDurationSec: 0.5,
    consumedDurationSec: 0.58,
    overflowBadgeHoldSec: 1.25,
  },
};

export const BOARD_COLS = 12;
export const BOARD_COL_WIDTH = 80;
export const BOARD_COL_GAP = 6;

export const HUB_COLS = 10;
export const HUB_COL_WIDTH = 112;
export const HUB_COL_GAP = 8;

export const TILE_WIDTH = 80;
export const TILE_HEIGHT = 128;
export const EVENT_WIDTH = 80;
export const EVENT_HEIGHT = 74;
export const ENV_STRUCTURE_WIDTH = 80;
export const ENV_STRUCTURE_HEIGHT = 74;
export const HUB_STRUCTURE_WIDTH = 112;
export const HUB_STRUCTURE_HEIGHT = 168;

export const GAMEPIECE_HOVER_SCALE = 2.0;
export const GAMEPIECE_SHADOW_COLOR = 0x000000;
export const GAMEPIECE_SHADOW_ALPHA = 0.25;
export const GAMEPIECE_SHADOW_OFFSET_X = 6;
export const GAMEPIECE_SHADOW_OFFSET_Y = 6;

export const EVENT_ROW_Y = 300;
export const ENV_STRUCTURE_ROW_Y = EVENT_ROW_Y + EVENT_HEIGHT + 14;
export const TILE_ROW_Y = ENV_STRUCTURE_ROW_Y + ENV_STRUCTURE_HEIGHT + 14;
export const HUB_ROW_Y = TILE_ROW_Y + TILE_HEIGHT + 60;
export const HUB_STRUCTURE_ROW_Y = HUB_ROW_Y;
export const CHARACTER_ROW_OFFSET_Y = 15;

// Shared UI colors for communicating time-state zones.
export const TIME_STATE_COLORS = Object.freeze({
  fixedHistory: 0x701313, // brown #701313
  editableHistory: 0xd18a3a, // orange
  forecast: 0x89c2ff, // light blue
});
export const TIME_STATE_GRAPH_BG_ALPHA = 0.2;
export const TIME_STATE_FILTER_ALPHA = 0.12;

function getBoardTotalWidth() {
  return BOARD_COLS * BOARD_COL_WIDTH + (BOARD_COLS - 1) * BOARD_COL_GAP;
}

function getHubTotalWidth() {
  return HUB_COLS * HUB_COL_WIDTH + (HUB_COLS - 1) * HUB_COL_GAP;
}

export function getBoardColumnX(screenWidth, col) {
  const totalWidth = getBoardTotalWidth();
  const startX = (screenWidth - totalWidth) / 2;
  return startX + col * (BOARD_COL_WIDTH + BOARD_COL_GAP);
}

export function getHubColumnX(screenWidth, col) {
  const totalWidth = getHubTotalWidth();
  const startX = (screenWidth - totalWidth) / 2;
  return startX + col * (HUB_COL_WIDTH + HUB_COL_GAP);
}

export function getBoardColumnCenterX(screenWidth, col) {
  return getBoardColumnX(screenWidth, col) + BOARD_COL_WIDTH / 2;
}

export function getHubColumnCenterX(screenWidth, col) {
  return getHubColumnX(screenWidth, col) + HUB_COL_WIDTH / 2;
}

export function layoutBoardColPos(screenWidth, col, width, rowY) {
  const colX = getBoardColumnX(screenWidth, col);
  const w = width ?? BOARD_COL_WIDTH;
  return {
    x: colX + (BOARD_COL_WIDTH - w) / 2,
    y: rowY,
  };
}

export function layoutHubColPos(screenWidth, col, width, rowY) {
  const colX = getHubColumnX(screenWidth, col);
  const w = width ?? HUB_COL_WIDTH;
  return {
    x: colX + (HUB_COL_WIDTH - w) / 2,
    y: rowY,
  };
}

/**
 * Returns the top-left position of the hub structure card at index i.
 * @param {number} screenWidth
 * @param {number} i
 */
export function layoutHubStructurePos(screenWidth, i) {
  return layoutHubColPos(
    screenWidth,
    i,
    HUB_STRUCTURE_WIDTH,
    HUB_STRUCTURE_ROW_Y
  );
}
