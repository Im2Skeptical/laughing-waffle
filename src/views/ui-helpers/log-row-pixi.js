// src/views/ui-helpers/log-row-pixi.js
// Shared row/overlay drawing helpers for log panels.

import { LOG_ROW_RADIUS } from "./log-panel-theme.js";

export function drawLogRoundedRect(
  graphics,
  {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    radius = LOG_ROW_RADIUS,
    fill = 0x2a2f42,
    fillAlpha = 1,
    strokeColor = null,
    strokeAlpha = 1,
    strokeWidth = 0,
  } = {}
) {
  if (!graphics) return;
  graphics.clear();
  if (Number.isFinite(strokeWidth) && strokeWidth > 0 && strokeColor != null) {
    graphics.lineStyle(strokeWidth, strokeColor, strokeAlpha);
  } else {
    graphics.lineStyle(0, 0, 0);
  }
  graphics.beginFill(fill, fillAlpha);
  graphics.drawRoundedRect(x, y, width, height, radius);
  graphics.endFill();
}

export function drawLogStatusOverlay(graphics, width, height, status) {
  if (!graphics) return;
  const isSuccess = status === "success";
  const fill = isSuccess ? 0x1f6a32 : 0x8a1f2a;
  const stroke = isSuccess ? 0x7dff9e : 0xff4f5e;
  drawLogRoundedRect(graphics, {
    width,
    height,
    fill,
    fillAlpha: 0.3,
    strokeColor: stroke,
    strokeAlpha: 1,
    strokeWidth: 2,
  });
}

