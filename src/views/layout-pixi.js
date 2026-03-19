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
    offsetX: -10,
    offsetY: 4,
  },
  logs: {
    action: { x: 1620, y: 180 },
    event: { x: 20, y: 180 },
  },
  processWidget: {
    position: { x: 1180, y: 640 },
    mobileBreakpointPx: 900,
    mobileScale: 1,
    recipeManual: {
      widthPx: 1560,
      heightPx: 900,
      marginPx: 32,
      zIndex: 80,
    },
  },
  inventory: {
    mobileBreakpointPx: 900,
    mobileScale: 1,
    buildingManager: {
      widthPx: 1560,
      heightPx: 900,
      marginPx: 32,
      zIndex: 120,
    },
  },
  performance: {
    mobile: {
      breakpointPx: 980,
      disablePlayfieldShader: true,
      shaderQuality: "low",
      maxTextResolution: 2,
      disableAntialias: true,
    },
  },
  graphs: {
    gold: { x: 350, y: 280 },
    grain: { x: 350, y: 370 },
    food: { x: 350, y: 460 },
    system: { x: 350, y: 220 },
    systemScrollBase: { x: 1212, y: 120 },
    ap: { x: 350, y: 80 },
    population: { x: 350, y: 640 },
  },
  skillTree: {
    viewport: { x: 0, y: 0, width: 2424, height: 1080 },
    panel: { x: 1910 },
    sideText: { width: 390 },
    buttons: {
      saveX: 1910,
      cancelX: 2032,
      exitX: 2154,
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
      x: 2050,
      y: 400,
      scale: 0.5,
      alpha: 1.0,
      rotationOffsetRad: 0,
      playheadOffsetRad: -1.55,
      clockwise: true,
      texturePath: "images/MoonDisk_01.png",
    },
    season: {
      x: 2050,
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
  playfieldShader: {
    enabled: true,
    quality: "medium",
    timeReactive: true,
    driftWindowSec: 120,
    forecastBoost: 0.35,
    historyBoost: 0.18,
    profiles: {
      playfield: {
        intensity: 1,
        mottling: 0.2,
        warmth: 0.7,
        vintageAmount: 0.7,
        grain: 0.65,
        misregister: 0.2,
        misregisterMode: 1,
        wobbleAmount: 0.05,
        wobbleScale: 15.5,
        wobbleSpeed: 0.05,
        vignetteStrength: 0.5,
        vignetteInner: 0.36,
        vignetteOuter: 0.92,
        alwaysAnimated: false,
      },
      backdrop: {
        intensity: 0.86,
        mottling: 0.1,
        warmth: 0.82,
        vintageAmount: 0.9,
        grain: 0.45,
        misregister: 0.24,
        misregisterMode: 1,
        wobbleAmount: 0.1,
        wobbleScale: 10.8,
        wobbleSpeed: 0.01,
        vignetteStrength: 0.8,
        vignetteInner: 0.24,
        vignetteOuter: 0.9,
        alwaysAnimated: true,
      },
      topbar: {
        intensity: 0.72,
        mottling: 0.36,
        warmth: 0.76,
        vintageAmount: 0.86,
        grain: 0.24,
        misregister: 0.16,
        misregisterMode: 1,
        wobbleAmount: 0.18,
        wobbleScale: 2.2,
        wobbleSpeed: 0.05,
        vignetteStrength: 0.12,
        vignetteInner: 0.18,
        vignetteOuter: 0.88,
        alwaysAnimated: true,
      },
    },
  },
  // Centralized playfield layout controls.
  // Region/hub anchors move the gameplay lanes (slots, pieces, pawns, deck pathing).
  // Chrome offsets move the decorative backplates + name headers independently.
  playfield: {
    region: {
      anchorX: "center",
      offsetX: 0,
      anchorY: "top",
      offsetY: 300,
      cols: 12,
      colWidth: 90,
      colGap: 6,
      eventWidth: 90,
      eventHeight: 74,
      envStructureWidth: 90,
      envStructureHeight: 74,
      tileWidth: 90,
      tileHeight: 150,
      eventToEnvGap: 14,
      envToTileGap: 14,
    },
    hub: {
      anchorX: "center",
      offsetX: 0,
      anchorY: "top",
      offsetY: 690,
      cols: 10,
      colWidth: 112,
      colGap: 8,
      structureWidth: 112,
      structureHeight: 140,
      structureOffsetY: 0,
      characterRowOffsetY: 15,
    },
    chrome: {
      regionBoard: {
        offsetX: 0,
        offsetY: 0,
        padX: 26,
        padTop: 24,
        padBottom: 24,
      },
      hubBoard: {
        offsetX: 0,
        offsetY: 0,
        padX: 26,
        padTop: 24,
        padBottom: 24,
      },
      regionHeader: {
        offsetX: 0,
        offsetY: 0,
        height: 54,
        widthRatio: 0.38,
        minWidth: 160,
        maxWidth: 260,
      },
      hubHeader: {
        offsetX: -400,
        offsetY: 0,
        height: 54,
        widthRatio: 0.34,
        minWidth: 160,
        maxWidth: 260,
      },
    },
  },
  playfieldCamera: {
    enabled: true,
    minZoom: 0.75,
    maxZoom: 1.8,
    defaultZoom: 1,
    wheelStep: 1.1,
    dragThresholdPx: 3,
    pinchMinDistancePx: 8,
    panBounds: {
      width: VIEWPORT_DESIGN_WIDTH * 1.5,
      height: VIEWPORT_DESIGN_HEIGHT * 1.5,
      centerX: VIEWPORT_DESIGN_WIDTH * 0.5,
      centerY: VIEWPORT_DESIGN_HEIGHT * 0.5,
    },
    resetOnScenarioLoad: true,
    membership: {
      backdrop: true,
      board: true,
      pawns: true,
      hover: true,
      inventory: true,
      inventoryHover: true,
      tooltip: true,
      processWidget: true,
      actionLog: true,
      sunMoonDisks: true,
      timeControls: true,
      envEventDeck: true,
      eventLog: false,
      headerBar: false,
      debugOverlay: false,
    },
  },
};

const PLAYFIELD_LAYOUT = VIEW_LAYOUT.playfield || {};
const REGION_LAYOUT = PLAYFIELD_LAYOUT.region || {};
const HUB_LAYOUT = PLAYFIELD_LAYOUT.hub || {};

function toPositiveInt(value, fallback) {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, n);
}

function toNumber(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function resolveDesignY(anchorY, offsetY) {
  const pt = resolveAnchoredPoint({
    screenWidth: VIEWPORT_DESIGN_WIDTH,
    screenHeight: VIEWPORT_DESIGN_HEIGHT,
    anchorX: "left",
    anchorY,
    offsetX: 0,
    offsetY,
  });
  return Math.round(pt.y);
}

export const BOARD_COLS = toPositiveInt(REGION_LAYOUT.cols, 12);
export const BOARD_COL_WIDTH = toPositiveInt(REGION_LAYOUT.colWidth, 80);
export const BOARD_COL_GAP = Math.max(0, Math.floor(toNumber(REGION_LAYOUT.colGap, 6)));

export const HUB_COLS = toPositiveInt(HUB_LAYOUT.cols, 10);
export const HUB_COL_WIDTH = toPositiveInt(HUB_LAYOUT.colWidth, 112);
export const HUB_COL_GAP = Math.max(0, Math.floor(toNumber(HUB_LAYOUT.colGap, 8)));

export const TILE_WIDTH = toPositiveInt(REGION_LAYOUT.tileWidth, 80);
export const TILE_HEIGHT = toPositiveInt(REGION_LAYOUT.tileHeight, 128);
export const EVENT_WIDTH = toPositiveInt(REGION_LAYOUT.eventWidth, 80);
export const EVENT_HEIGHT = toPositiveInt(REGION_LAYOUT.eventHeight, 74);
export const ENV_STRUCTURE_WIDTH = toPositiveInt(REGION_LAYOUT.envStructureWidth, 80);
export const ENV_STRUCTURE_HEIGHT = toPositiveInt(REGION_LAYOUT.envStructureHeight, 74);
export const HUB_STRUCTURE_WIDTH = toPositiveInt(HUB_LAYOUT.structureWidth, 112);
export const HUB_STRUCTURE_HEIGHT = toPositiveInt(HUB_LAYOUT.structureHeight, 168);

export const GAMEPIECE_HOVER_SCALE = 1.8;
export const GAMEPIECE_HOVER_ZOOM_IN_TWEEN_SEC = 0.08;
export const GAMEPIECE_HOVER_ZOOM_OUT_TWEEN_SEC = 0.01;
export const GAMEPIECE_SHADOW_COLOR = 0x000000;
export const GAMEPIECE_SHADOW_ALPHA = 0.25;
export const GAMEPIECE_SHADOW_OFFSET_X = 6;
export const GAMEPIECE_SHADOW_OFFSET_Y = 6;

const REGION_EVENT_TO_ENV_GAP = Math.max(
  0,
  Math.floor(toNumber(REGION_LAYOUT.eventToEnvGap, 14))
);
const REGION_ENV_TO_TILE_GAP = Math.max(
  0,
  Math.floor(toNumber(REGION_LAYOUT.envToTileGap, 14))
);

export const EVENT_ROW_Y = resolveDesignY(
  REGION_LAYOUT.anchorY || "top",
  toNumber(REGION_LAYOUT.offsetY, 300)
);
export const ENV_STRUCTURE_ROW_Y =
  EVENT_ROW_Y + EVENT_HEIGHT + REGION_EVENT_TO_ENV_GAP;
export const TILE_ROW_Y = ENV_STRUCTURE_ROW_Y + ENV_STRUCTURE_HEIGHT + REGION_ENV_TO_TILE_GAP;
export const HUB_ROW_Y = resolveDesignY(
  HUB_LAYOUT.anchorY || "top",
  toNumber(HUB_LAYOUT.offsetY, 664)
);
export const HUB_STRUCTURE_ROW_Y =
  HUB_ROW_Y + Math.floor(toNumber(HUB_LAYOUT.structureOffsetY, 0));
export const CHARACTER_ROW_OFFSET_Y = Math.floor(
  toNumber(HUB_LAYOUT.characterRowOffsetY, 15)
);

// Shared UI colors for communicating time-state zones.
export const TIME_STATE_COLORS = Object.freeze({
  fixedHistory: 0x6a3f2b, // umber
  editableHistory: 0xb48a57, // ochre
  forecast: 0x7f9879, // muted sage
  paused: 0xb9a780, // muted parchment amber
  itemUnavailable: 0x141414, // dark gray
  runLost: 0x141414, // dark gray
});
export const TIME_STATE_GRAPH_BG_ALPHA = 0.2;
export const TIME_STATE_FILTER_ALPHA = 0.12;

function getBoardTotalWidth() {
  return BOARD_COLS * BOARD_COL_WIDTH + (BOARD_COLS - 1) * BOARD_COL_GAP;
}

function getHubTotalWidth() {
  return HUB_COLS * HUB_COL_WIDTH + (HUB_COLS - 1) * HUB_COL_GAP;
}

const boardColumnCenterCache = new Map();
const hubColumnCenterCache = new Map();
const COLUMN_CENTER_CACHE_LIMIT = 16;

function getCenterCacheKey(screenWidth, cols, pieceWidth) {
  const width = Number.isFinite(screenWidth) ? Math.floor(screenWidth) : 0;
  const count = Number.isFinite(cols) ? Math.floor(cols) : 0;
  const piece = Number.isFinite(pieceWidth) ? Math.floor(pieceWidth) : 0;
  return `${width}|${count}|${piece}`;
}

function putCenterCache(cache, key, values) {
  if (cache.size >= COLUMN_CENTER_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, values);
}

export function getBoardColumnX(screenWidth, col) {
  const totalWidth = getBoardTotalWidth();
  const rect = resolveAnchoredRect({
    screenWidth,
    screenHeight: VIEWPORT_DESIGN_HEIGHT,
    width: totalWidth,
    height: 0,
    anchorX: REGION_LAYOUT.anchorX || "center",
    anchorY: "top",
    offsetX: toNumber(REGION_LAYOUT.offsetX, 0),
    offsetY: 0,
  });
  const startX = rect.x;
  return startX + col * (BOARD_COL_WIDTH + BOARD_COL_GAP);
}

export function getHubColumnX(screenWidth, col) {
  const totalWidth = getHubTotalWidth();
  const rect = resolveAnchoredRect({
    screenWidth,
    screenHeight: VIEWPORT_DESIGN_HEIGHT,
    width: totalWidth,
    height: 0,
    anchorX: HUB_LAYOUT.anchorX || "center",
    anchorY: "top",
    offsetX: toNumber(HUB_LAYOUT.offsetX, 0),
    offsetY: 0,
  });
  const startX = rect.x;
  return startX + col * (HUB_COL_WIDTH + HUB_COL_GAP);
}

export function getBoardColumnCenterX(screenWidth, col) {
  return getBoardColumnX(screenWidth, col) + BOARD_COL_WIDTH / 2;
}

export function getHubColumnCenterX(screenWidth, col) {
  return getHubColumnX(screenWidth, col) + HUB_COL_WIDTH / 2;
}

export function getBoardColumnXForVisibleCols(screenWidth, col, cols = BOARD_COLS) {
  const count = Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : BOARD_COLS;
  const totalWidth =
    count <= 0 ? 0 : count * BOARD_COL_WIDTH + (count - 1) * BOARD_COL_GAP;
  const rect = resolveAnchoredRect({
    screenWidth,
    screenHeight: VIEWPORT_DESIGN_HEIGHT,
    width: totalWidth,
    height: 0,
    anchorX: REGION_LAYOUT.anchorX || "center",
    anchorY: "top",
    offsetX: toNumber(REGION_LAYOUT.offsetX, 0),
    offsetY: 0,
  });
  return rect.x + Math.max(0, Math.floor(col)) * (BOARD_COL_WIDTH + BOARD_COL_GAP);
}

export function getHubColumnXForVisibleCols(screenWidth, col, cols = HUB_COLS) {
  const count = Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : HUB_COLS;
  const totalWidth =
    count <= 0 ? 0 : count * HUB_COL_WIDTH + (count - 1) * HUB_COL_GAP;
  const rect = resolveAnchoredRect({
    screenWidth,
    screenHeight: VIEWPORT_DESIGN_HEIGHT,
    width: totalWidth,
    height: 0,
    anchorX: HUB_LAYOUT.anchorX || "center",
    anchorY: "top",
    offsetX: toNumber(HUB_LAYOUT.offsetX, 0),
    offsetY: 0,
  });
  return rect.x + Math.max(0, Math.floor(col)) * (HUB_COL_WIDTH + HUB_COL_GAP);
}

export function getBoardColumnCenterXForVisibleCols(
  screenWidth,
  col,
  cols = BOARD_COLS,
  pieceWidth = BOARD_COL_WIDTH
) {
  const width = Number.isFinite(pieceWidth)
    ? Math.max(1, Math.floor(pieceWidth))
    : BOARD_COL_WIDTH;
  return getBoardColumnXForVisibleCols(screenWidth, col, cols) + width * 0.5;
}

export function getHubColumnCenterXForVisibleCols(
  screenWidth,
  col,
  cols = HUB_COLS,
  pieceWidth = HUB_COL_WIDTH
) {
  const width = Number.isFinite(pieceWidth)
    ? Math.max(1, Math.floor(pieceWidth))
    : HUB_COL_WIDTH;
  return getHubColumnXForVisibleCols(screenWidth, col, cols) + width * 0.5;
}

export function getBoardColumnCenterXs(
  screenWidth,
  cols = BOARD_COLS,
  pieceWidth = BOARD_COL_WIDTH
) {
  const count = Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : BOARD_COLS;
  const width = Number.isFinite(pieceWidth)
    ? Math.max(1, Math.floor(pieceWidth))
    : BOARD_COL_WIDTH;
  const key = getCenterCacheKey(screenWidth, count, width);
  if (boardColumnCenterCache.has(key)) {
    return boardColumnCenterCache.get(key);
  }
  const values = new Array(count);
  for (let col = 0; col < count; col++) {
    values[col] = getBoardColumnX(screenWidth, col) + width * 0.5;
  }
  putCenterCache(boardColumnCenterCache, key, values);
  return values;
}

export function getHubColumnCenterXs(
  screenWidth,
  cols = HUB_COLS,
  pieceWidth = HUB_COL_WIDTH
) {
  const count = Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : HUB_COLS;
  const width = Number.isFinite(pieceWidth)
    ? Math.max(1, Math.floor(pieceWidth))
    : HUB_COL_WIDTH;
  const key = getCenterCacheKey(screenWidth, count, width);
  if (hubColumnCenterCache.has(key)) {
    return hubColumnCenterCache.get(key);
  }
  const values = new Array(count);
  for (let col = 0; col < count; col++) {
    values[col] = getHubColumnX(screenWidth, col) + width * 0.5;
  }
  putCenterCache(hubColumnCenterCache, key, values);
  return values;
}

export function getBoardColumnCenterXsForVisibleCols(
  screenWidth,
  cols = BOARD_COLS,
  pieceWidth = BOARD_COL_WIDTH
) {
  const count = Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : BOARD_COLS;
  const width = Number.isFinite(pieceWidth)
    ? Math.max(1, Math.floor(pieceWidth))
    : BOARD_COL_WIDTH;
  const values = new Array(count);
  for (let col = 0; col < count; col++) {
    values[col] = getBoardColumnCenterXForVisibleCols(screenWidth, col, count, width);
  }
  return values;
}

export function getHubColumnCenterXsForVisibleCols(
  screenWidth,
  cols = HUB_COLS,
  pieceWidth = HUB_COL_WIDTH
) {
  const count = Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : HUB_COLS;
  const width = Number.isFinite(pieceWidth)
    ? Math.max(1, Math.floor(pieceWidth))
    : HUB_COL_WIDTH;
  const values = new Array(count);
  for (let col = 0; col < count; col++) {
    values[col] = getHubColumnCenterXForVisibleCols(screenWidth, col, count, width);
  }
  return values;
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

export function layoutBoardColPosForVisibleCols(screenWidth, col, width, rowY, cols = BOARD_COLS) {
  const colX = getBoardColumnXForVisibleCols(screenWidth, col, cols);
  const w = width ?? BOARD_COL_WIDTH;
  return {
    x: colX + (BOARD_COL_WIDTH - w) / 2,
    y: rowY,
  };
}

export function layoutHubColPosForVisibleCols(screenWidth, col, width, rowY, cols = HUB_COLS) {
  const colX = getHubColumnXForVisibleCols(screenWidth, col, cols);
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
