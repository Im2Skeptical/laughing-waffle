// src/views/event-log-pixi.js
// Transient gameplay event log panel.

import { createEventLogController } from "../controllers/eventmanagers/event-log-controller.js";
import { getEventLogTypeDef } from "../defs/gamesettings/event-log-types-defs.js";
import {
  LOG_BG_ALPHA,
  LOG_BG_FILL,
  LOG_PANEL_HEADER_HEIGHT as HEADER_HEIGHT,
  LOG_PANEL_HEIGHT as PANEL_HEIGHT,
  LOG_PANEL_PADDING as PADDING,
  LOG_PANEL_RADIUS,
  LOG_PANEL_WIDTH as PANEL_WIDTH,
  LOG_ROW_FILL,
  LOG_ROW_FOCUSED_FILL,
  LOG_ROW_GAP,
  LOG_ROW_HEIGHT,
} from "./ui-helpers/log-panel-theme.js";
import { drawLogRoundedRect } from "./ui-helpers/log-row-pixi.js";

const HOLD_SEC = 5;
const FADE_SEC = 10;

function formatSeasonName(raw) {
  if (typeof raw !== "string" || raw.length === 0) return "Unknown";
  return raw[0].toUpperCase() + raw.slice(1);
}

function formatCalendarTimestamp(tSec, state) {
  const totalSec = Math.max(0, Math.floor(tSec ?? 0));
  const seasonDuration = Number.isFinite(state?.seasonDurationSec)
    ? Math.max(1, Math.floor(state.seasonDurationSec))
    : 32;
  const seasons =
    Array.isArray(state?.seasons) && state.seasons.length > 0
      ? state.seasons
      : ["spring", "summer", "autumn", "winter"];
  const seasonCount = Math.max(1, seasons.length);

  const totalSeasonIndex = Math.floor(totalSec / seasonDuration);
  const seasonIndex = ((totalSeasonIndex % seasonCount) + seasonCount) % seasonCount;
  const year = 1 + Math.floor(totalSeasonIndex / seasonCount);
  const secInSeason = (totalSec % seasonDuration) + 1;
  const seasonName = formatSeasonName(seasons[seasonIndex]);

  return `Year ${year}, ${seasonName}, Sec ${secInSeason}`;
}

function buildRowsSignature(rowSpecs, selectedId, state) {
  const seasonDuration = Number.isFinite(state?.seasonDurationSec)
    ? Math.max(1, Math.floor(state.seasonDurationSec))
    : 32;
  const seasons = Array.isArray(state?.seasons) ? state.seasons.join(",") : "";

  const parts = [String(selectedId ?? "none"), String(seasonDuration), seasons];
  for (const row of rowSpecs) {
    parts.push(
      `${row.id}:${row.tSec}:${Math.round((row.alpha ?? 1) * 100)}:${row.type}:${row.text}`
    );
  }
  return parts.join("|");
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function blendHexColor(baseColor, tintColor, mix = 0.15) {
  const t = clamp01(mix);
  const br = (baseColor >> 16) & 0xff;
  const bg = (baseColor >> 8) & 0xff;
  const bb = baseColor & 0xff;
  const tr = (tintColor >> 16) & 0xff;
  const tg = (tintColor >> 8) & 0xff;
  const tb = tintColor & 0xff;

  const rr = Math.round(br + (tr - br) * t);
  const rg = Math.round(bg + (tg - bg) * t);
  const rb = Math.round(bb + (tb - bb) * t);

  return ((rr & 0xff) << 16) | ((rg & 0xff) << 8) | (rb & 0xff);
}

function getRowsCapacity() {
  const contentHeight = PANEL_HEIGHT - HEADER_HEIGHT - PADDING;
  const rowStep = LOG_ROW_HEIGHT + LOG_ROW_GAP;
  return Math.max(1, Math.floor(contentHeight / rowStep));
}

export function createEventLogView({
  layer,
  getState,
  onSelectEntry,
  position = { x: 20, y: 180 },
}) {
  const container = new PIXI.Container();
  container.x = position.x;
  container.y = position.y;
  container.zIndex = 99;
  layer.addChild(container);

  const controller = createEventLogController({ getState });

  const bg = new PIXI.Graphics();
  drawLogRoundedRect(bg, {
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    radius: LOG_PANEL_RADIUS,
    fill: LOG_BG_FILL,
    fillAlpha: LOG_BG_ALPHA,
  });
  container.addChild(bg);

  const title = new PIXI.Text("Event Log", {
    fill: 0xffffff,
    fontSize: 24,
    fontWeight: "bold",
  });
  title.x = PADDING;
  title.y = 16;
  container.addChild(title);

  const tip = new PIXI.Text("Recent world + pawn events", {
    fill: 0x9aa0b5,
    fontSize: 11,
  });
  tip.x = PADDING;
  tip.y = 44;
  container.addChild(tip);

  const rows = new PIXI.Container();
  rows.x = PADDING;
  rows.y = HEADER_HEIGHT;
  container.addChild(rows);

  let selectedEntryId = null;
  let lastSignature = null;

  function clearSelection() {
    if (selectedEntryId == null) return;
    selectedEntryId = null;
    onSelectEntry?.(null);
    lastSignature = null;
  }

  function buildRows(rowSpecs, state) {
    rows.removeChildren();
    let y = 0;
    for (const spec of rowSpecs) {
      const typeDef = getEventLogTypeDef(spec.type);
      const typeColor = Number.isFinite(typeDef?.color) ? typeDef.color : 0x9aa0b5;
      const typeLabel = typeDef?.label || spec.type || "Event";

      const row = new PIXI.Container();
      row.x = 0;
      row.y = y;
      row.alpha = Number.isFinite(spec.alpha) ? spec.alpha : 1;

      const rowWidth = PANEL_WIDTH - PADDING * 2;
      const rowBg = new PIXI.Graphics();
      const baseFill =
        selectedEntryId === spec.id ? LOG_ROW_FOCUSED_FILL : LOG_ROW_FILL;
      const rowFill = blendHexColor(
        baseFill,
        typeColor,
        selectedEntryId === spec.id ? 0.26 : 0.16
      );
      drawLogRoundedRect(rowBg, {
        width: rowWidth,
        height: LOG_ROW_HEIGHT,
        fill: rowFill,
        strokeColor: typeColor,
        strokeAlpha: selectedEntryId === spec.id ? 1 : 0.75,
        strokeWidth: selectedEntryId === spec.id ? 2 : 1,
      });
      row.addChild(rowBg);

      const text = new PIXI.Text(spec.text || "", {
        fill: 0xffffff,
        fontSize: 14,
        wordWrap: true,
        wordWrapWidth: rowWidth - 48,
      });
      text.x = 12;
      text.y = 10;
      row.addChild(text);

      const age = new PIXI.Text(`${Math.max(0, spec.ageSec ?? 0)}s`, {
        fill: typeColor,
        fontSize: 11,
      });
      age.anchor.set(1, 0);
      age.x = rowWidth - 8;
      age.y = 8;
      row.addChild(age);

      const typeText = new PIXI.Text(typeLabel, {
        fill: typeColor,
        fontSize: 10,
        fontWeight: "bold",
      });
      typeText.x = 12;
      typeText.y = LOG_ROW_HEIGHT - typeText.height - 4;
      row.addChild(typeText);

      const timestamp = new PIXI.Text(formatCalendarTimestamp(spec.tSec, state), {
        fill: 0x9aa0b5,
        fontSize: 10,
      });
      timestamp.anchor.set(1, 1);
      timestamp.x = rowWidth - 8;
      timestamp.y = LOG_ROW_HEIGHT - 6;
      row.addChild(timestamp);

      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointertap", () => {
        if (selectedEntryId === spec.id) {
          selectedEntryId = null;
          onSelectEntry?.(null);
        } else {
          selectedEntryId = spec.id;
          onSelectEntry?.(spec);
        }
        lastSignature = null;
      });

      rows.addChild(row);
      y += LOG_ROW_HEIGHT + LOG_ROW_GAP;
    }
  }

  function init() {}

  function update() {
    const state = typeof getState === "function" ? getState() : null;
    const rowSpecs = controller.getVisibleRows({
      holdSec: HOLD_SEC,
      fadeSec: FADE_SEC,
      maxRows: getRowsCapacity(),
    });

    if (
      selectedEntryId != null &&
      !rowSpecs.some((entry) => entry.id === selectedEntryId)
    ) {
      selectedEntryId = null;
      onSelectEntry?.(null);
    }

    const signature = buildRowsSignature(rowSpecs, selectedEntryId, state);
    if (signature === lastSignature) return;
    lastSignature = signature;
    buildRows(rowSpecs, state);
  }

  return {
    init,
    update,
    container,
    clearSelection,
  };
}
