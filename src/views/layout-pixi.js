// layout-pixi.js (VIEW-ONLY)
// Shared layout constants/helpers for the 12-column board.

export const BOARD_COLS = 12;
export const BOARD_COL_WIDTH = 150;
export const BOARD_COL_GAP = 6;

export const TILE_WIDTH = 140;
export const TILE_HEIGHT = 120;
export const EVENT_WIDTH = 140;
export const EVENT_HEIGHT = 70;
export const PERM_WIDTH = 150;
export const PERM_HEIGHT = 160;

export const TILE_ROW_Y = 80;
export const EVENT_ROW_Y = TILE_ROW_Y + TILE_HEIGHT + 20;
export const PERM_ROW_Y = EVENT_ROW_Y + EVENT_HEIGHT + 60;

function getBoardTotalWidth() {
  return BOARD_COLS * BOARD_COL_WIDTH + (BOARD_COLS - 1) * BOARD_COL_GAP;
}

export function getBoardColumnX(screenWidth, col) {
  const totalWidth = getBoardTotalWidth();
  const startX = (screenWidth - totalWidth) / 2;
  return startX + col * (BOARD_COL_WIDTH + BOARD_COL_GAP);
}

export function getBoardColumnCenterX(screenWidth, col) {
  return getBoardColumnX(screenWidth, col) + BOARD_COL_WIDTH / 2;
}

export function layoutBoardColPos(screenWidth, col, width, rowY) {
  const colX = getBoardColumnX(screenWidth, col);
  const w = width ?? BOARD_COL_WIDTH;
  return {
    x: colX + (BOARD_COL_WIDTH - w) / 2,
    y: rowY,
  };
}

/**
 * Returns the top-left position of the permanent slot card at index i.
 * @param {number} screenWidth
 * @param {number} i
 */
export function layoutPermPos(screenWidth, i) {
  return layoutBoardColPos(screenWidth, i, PERM_WIDTH, PERM_ROW_Y);
}
