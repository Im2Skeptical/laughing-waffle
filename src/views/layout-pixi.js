// layout-pixi.js (VIEW-ONLY)
// Shared layout constants/helpers for the env + hub rows.

export const BOARD_COLS = 12;
export const BOARD_COL_WIDTH = 100;
export const BOARD_COL_GAP = 6;

export const HUB_COLS = 10;
export const HUB_COL_WIDTH = 112;
export const HUB_COL_GAP = 8;

export const TILE_WIDTH = 100;
export const TILE_HEIGHT = 150;
export const EVENT_WIDTH = 100;
export const EVENT_HEIGHT = 150;
export const HUB_STRUCTURE_WIDTH = 112;
export const HUB_STRUCTURE_HEIGHT = 168;

export const GAMEPIECE_HOVER_SCALE = 2.0;
export const GAMEPIECE_SHADOW_COLOR = 0x000000;
export const GAMEPIECE_SHADOW_ALPHA = 0.25;
export const GAMEPIECE_SHADOW_OFFSET_X = 6;
export const GAMEPIECE_SHADOW_OFFSET_Y = 6;

export const TILE_ROW_Y = 400;
export const EVENT_ROW_Y = TILE_ROW_Y + TILE_HEIGHT + 20;
export const HUB_ROW_Y = EVENT_ROW_Y + EVENT_HEIGHT + 60;
export const HUB_STRUCTURE_ROW_Y = HUB_ROW_Y;
export const CHARACTER_ROW_OFFSET_Y = 15;

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
