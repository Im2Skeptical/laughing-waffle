// layout-pixi.js (VIEW-ONLY)
// Shared layout constants/helpers for the permanent row.

export const PERM_WIDTH = 260;
export const PERM_HEIGHT = 170;
export const PERM_GAP = 60;
export const PERM_ROW_Y = 430;

/**
 * Returns the top-left position of the permanent slot card at index i.
 * @param {number} screenWidth
 * @param {number} i
 * @param {number} count
 */
export function layoutPermPos(screenWidth, i, count) {
  const totalWidth = count * PERM_WIDTH + (count - 1) * PERM_GAP;
  const startX = (screenWidth - totalWidth) / 2;
  return {
    x: startX + i * (PERM_WIDTH + PERM_GAP),
    y: PERM_ROW_Y,
  };
}
