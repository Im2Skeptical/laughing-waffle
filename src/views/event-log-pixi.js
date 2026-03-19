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
import { VIEW_LAYOUT } from "./layout-pixi.js";
import { MUCHA_UI_COLORS } from "./ui-helpers/mucha-ui-palette.js";
import { installSolidUiHitArea } from "./ui-helpers/solid-ui-hit-area.js";

const HOLD_SEC = 5;
const FADE_SEC = 10;

const DRAWER_COLLAPSED_WIDTH = 76;
const DRAWER_ANIM_SEC = 0.15;
const DRAWER_HANDLE_WIDTH = 18;
const DRAWER_HANDLE_HEIGHT = 72;
const COLLAPSED_MARKER_TEXT = "EL";
const COLLAPSED_ICON_HEIGHT = Math.max(28, LOG_ROW_HEIGHT - 10);
const COLLAPSED_ICON_RADIUS = 10;

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
  const seasonIndex =
    ((totalSeasonIndex % seasonCount) + seasonCount) % seasonCount;
  const year = 1 + Math.floor(totalSeasonIndex / seasonCount);
  const secInSeason = (totalSec % seasonDuration) + 1;
  const seasonName = formatSeasonName(seasons[seasonIndex]);

  return `Year ${year}, ${seasonName}, Sec ${secInSeason}`;
}

function buildRowsSignature(
  rowSpecs,
  selectedId,
  state,
  isYearEndPerformanceOpen
) {
  const seasonDuration = Number.isFinite(state?.seasonDurationSec)
    ? Math.max(1, Math.floor(state.seasonDurationSec))
    : 32;
  const seasons = Array.isArray(state?.seasons) ? state.seasons.join(",") : "";

  const parts = [String(selectedId ?? "none"), String(seasonDuration), seasons];
  for (const row of rowSpecs) {
    const hasReport = hasYearEndPerformanceData(row);
    const reportOpen =
      hasReport && typeof isYearEndPerformanceOpen === "function"
        ? isYearEndPerformanceOpen(row.id) === true
        : false;
    parts.push(
      `${row.id}:${row.tSec}:${Math.round((row.alpha ?? 1) * 100)}:${row.type}:${row.text}:${hasReport ? 1 : 0}:${reportOpen ? 1 : 0}:${row?.pinned === true ? 1 : 0}:${row?.pinKind || "none"}`
    );
  }
  return parts.join("|");
}

function hasYearEndPerformanceData(row) {
  return !!(
    row?.data &&
    typeof row.data === "object" &&
    row.data.yearEndPerformance &&
    typeof row.data.yearEndPerformance === "object"
  );
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

function resolveEventGlyph(typeDef, spec) {
  const explicitGlyph =
    typeof typeDef?.glyph === "string" ? typeDef.glyph.trim() : "";
  if (explicitGlyph.length > 0) return explicitGlyph.slice(0, 2).toUpperCase();

  const source = String(typeDef?.label || spec?.type || "Event").trim();
  const tokens = source.match(/[A-Za-z0-9]+/g) || [];
  if (tokens.length >= 2) {
    return `${tokens[0][0] || ""}${tokens[1][0] || ""}`.toUpperCase();
  }
  if (tokens.length === 1) {
    const token = tokens[0].toUpperCase();
    if (token.length >= 2) return token.slice(0, 2);
    if (token.length === 1) return token;
  }
  return "?";
}

function getPanelWidth(progress) {
  const t = clamp01(progress);
  return DRAWER_COLLAPSED_WIDTH + (PANEL_WIDTH - DRAWER_COLLAPSED_WIDTH) * t;
}

export function createEventLogView({
  layer,
  getState,
  isVisible = null,
  onSelectEntry,
  onToggleYearEndPerformance,
  isYearEndPerformanceOpen,
  position = VIEW_LAYOUT.logs.event,
}) {
  const container = new PIXI.Container();
  container.x = position.x;
  container.y = position.y;
  container.zIndex = 99;
  layer.addChild(container);
  const solidHitArea = installSolidUiHitArea(container, () => {
    const bounds = container.getLocalBounds?.() ?? null;
    return {
      x: 0,
      y: 0,
      width: bounds?.width ?? 0,
      height: bounds?.height ?? 0,
    };
  });

  const controller = createEventLogController({ getState });

  const bg = new PIXI.Graphics();
  container.addChild(bg);

  const title = new PIXI.Text("Event Log", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: 24,
    fontWeight: "bold",
  });
  title.x = PADDING;
  title.y = 16;
  container.addChild(title);

  const tip = new PIXI.Text("Recent world + pawn events", {
    fill: MUCHA_UI_COLORS.ink.muted,
    fontSize: 11,
  });
  tip.x = PADDING;
  tip.y = 44;
  container.addChild(tip);

  const collapsedMarker = new PIXI.Text(COLLAPSED_MARKER_TEXT, {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: 36,
    fontWeight: "bold",
  });
  collapsedMarker.y = 12;
  container.addChild(collapsedMarker);

  const rowsClip = new PIXI.Container();
  rowsClip.x = PADDING;
  rowsClip.y = HEADER_HEIGHT;
  container.addChild(rowsClip);

  const rowsExpanded = new PIXI.Container();
  rowsClip.addChild(rowsExpanded);

  const rowsExpandedMask = new PIXI.Graphics();
  rowsClip.addChild(rowsExpandedMask);
  rowsExpanded.mask = rowsExpandedMask;

  const rowsCollapsed = new PIXI.Container();
  rowsCollapsed.x = PADDING;
  rowsCollapsed.y = HEADER_HEIGHT;
  container.addChild(rowsCollapsed);

  const drawerHandle = new PIXI.Container();
  drawerHandle.eventMode = "static";
  drawerHandle.cursor = "pointer";
  container.addChild(drawerHandle);

  const drawerHandleBg = new PIXI.Graphics();
  drawerHandle.addChild(drawerHandleBg);

  const drawerHandleArrow = new PIXI.Text("<", {
    fill: MUCHA_UI_COLORS.ink.contrast,
    fontSize: 16,
    fontWeight: "bold",
  });
  drawerHandleArrow.anchor.set(0.5);
  drawerHandle.addChild(drawerHandleArrow);

  let selectedEntryId = null;
  let lastSignature = null;
  let wasVisible = true;
  let isExpandedTarget = true;
  let drawerProgress = 1;
  let lastLayoutSignature = null;

  const expandedRowEntries = [];
  const collapsedRowEntries = [];

  function clearSelection() {
    if (selectedEntryId == null) return;
    selectedEntryId = null;
    onSelectEntry?.(null);
    lastSignature = null;
  }

  function setExpandedTarget(nextExpanded) {
    isExpandedTarget = nextExpanded !== false;
  }

  function setExpandedRowInteractivity(enabled) {
    for (const rowEntry of expandedRowEntries) {
      if (!rowEntry?.row) continue;
      rowEntry.row.eventMode = enabled ? "static" : "none";
      rowEntry.row.cursor = enabled ? "pointer" : "default";
      if (rowEntry.chip) {
        rowEntry.chip.eventMode = enabled ? "static" : "none";
        rowEntry.chip.cursor = enabled ? "pointer" : "default";
      }
    }
  }

  function setCollapsedRowInteractivity(enabled) {
    for (const iconRow of collapsedRowEntries) {
      if (!iconRow) continue;
      iconRow.eventMode = enabled ? "static" : "none";
      iconRow.cursor = enabled ? "pointer" : "default";
    }
  }

  function drawExpandedRow(spec, state, rowY) {
    const typeDef = getEventLogTypeDef(spec.type);
    const typeColor = Number.isFinite(typeDef?.color)
      ? typeDef.color
      : MUCHA_UI_COLORS.ink.muted;
    const typeLabel = typeDef?.label || spec.type || "Event";

    const row = new PIXI.Container();
    row.x = 0;
    row.y = rowY;
    row.alpha = Number.isFinite(spec.alpha) ? spec.alpha : 1;

    const rowWidth = PANEL_WIDTH - PADDING * 2;
    const rowBg = new PIXI.Graphics();
    const baseFill = selectedEntryId === spec.id ? LOG_ROW_FOCUSED_FILL : LOG_ROW_FILL;
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
      fill: MUCHA_UI_COLORS.ink.primary,
      fontSize: 14,
      wordWrap: true,
      wordWrapWidth: rowWidth - (hasYearEndPerformanceData(spec) ? 132 : 48),
    });
    text.x = 12;
    text.y = 10;
    row.addChild(text);

    const ageLabel = spec?.pinned === true ? "PIN" : `${Math.max(0, spec.ageSec ?? 0)}s`;
    const age = new PIXI.Text(ageLabel, {
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

    const timestampLabel =
      spec?.pinned === true
        ? "Live state"
        : formatCalendarTimestamp(spec.tSec, state);
    const timestamp = new PIXI.Text(timestampLabel, {
      fill: MUCHA_UI_COLORS.ink.muted,
      fontSize: 10,
    });
    timestamp.anchor.set(1, 1);
    timestamp.x = rowWidth - 8;
    timestamp.y = LOG_ROW_HEIGHT - 6;
    row.addChild(timestamp);

    let reportChip = null;
    if (hasYearEndPerformanceData(spec)) {
      reportChip = new PIXI.Container();
      reportChip.eventMode = "static";
      reportChip.cursor = "pointer";

      const chipBg = new PIXI.Graphics();
      reportChip.addChild(chipBg);

      const open = isYearEndPerformanceOpen?.(spec.id) === true;
      const chipText = new PIXI.Text(open ? "Report: Open" : "Report", {
        fill: open ? MUCHA_UI_COLORS.ink.contrast : MUCHA_UI_COLORS.ink.primary,
        fontSize: 9,
        fontWeight: "bold",
      });
      reportChip.addChild(chipText);

      const chipW = Math.ceil(chipText.width) + 10;
      const chipH = 16;
      chipBg.clear();
      chipBg.beginFill(
        open ? MUCHA_UI_COLORS.accents.cream : MUCHA_UI_COLORS.surfaces.panelSoft,
        0.96
      );
      chipBg.lineStyle(
        1,
        open ? MUCHA_UI_COLORS.surfaces.border : MUCHA_UI_COLORS.surfaces.borderSoft,
        0.95
      );
      chipBg.drawRoundedRect(0, 0, chipW, chipH, 7);
      chipBg.endFill();

      chipText.x = Math.floor((chipW - chipText.width) / 2);
      chipText.y = Math.floor((chipH - chipText.height) / 2) - 1;

      reportChip.x = rowWidth - chipW - 8;
      reportChip.y = LOG_ROW_HEIGHT - chipH - 5;
      reportChip.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        onToggleYearEndPerformance?.(spec);
      });
      row.addChild(reportChip);
    }

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

    return { row, chip: reportChip };
  }

  function drawCollapsedRow(spec, rowY) {
    const typeDef = getEventLogTypeDef(spec.type);
    const typeColor = Number.isFinite(typeDef?.color)
      ? typeDef.color
      : MUCHA_UI_COLORS.ink.muted;
    const glyph = resolveEventGlyph(typeDef, spec);
    const iconWidth = Math.max(24, DRAWER_COLLAPSED_WIDTH - PADDING * 2);
    const iconY = Math.floor((LOG_ROW_HEIGHT - COLLAPSED_ICON_HEIGHT) / 2);
    const selected = selectedEntryId === spec.id;

    const row = new PIXI.Container();
    row.x = 0;
    row.y = rowY;
    row.alpha = Number.isFinite(spec.alpha) ? spec.alpha : 1;

    const iconBg = new PIXI.Graphics();
    const baseFill = selected ? LOG_ROW_FOCUSED_FILL : LOG_ROW_FILL;
    const iconFill = blendHexColor(baseFill, typeColor, selected ? 0.34 : 0.22);
    drawLogRoundedRect(iconBg, {
      x: 0,
      y: iconY,
      width: iconWidth,
      height: COLLAPSED_ICON_HEIGHT,
      radius: COLLAPSED_ICON_RADIUS,
      fill: iconFill,
      strokeColor: typeColor,
      strokeAlpha: selected ? 1 : 0.82,
      strokeWidth: selected ? 2 : 1,
    });
    row.addChild(iconBg);

    const glyphText = new PIXI.Text(glyph, {
      fill: MUCHA_UI_COLORS.ink.primary,
      fontSize: 16,
      fontWeight: "bold",
    });
    glyphText.anchor.set(0.5);
    glyphText.x = Math.floor(iconWidth / 2);
    glyphText.y = Math.floor(iconY + COLLAPSED_ICON_HEIGHT / 2) - 4;
    row.addChild(glyphText);

    const ageLabel = spec?.pinned === true ? "PIN" : `${Math.max(0, spec.ageSec ?? 0)}s`;
    const ageText = new PIXI.Text(ageLabel, {
      fill: typeColor,
      fontSize: 9,
    });
    ageText.anchor.set(1, 1);
    ageText.x = iconWidth - 4;
    ageText.y = iconY + COLLAPSED_ICON_HEIGHT - 3;
    row.addChild(ageText);

    if (hasYearEndPerformanceData(spec)) {
      const reportOpen = isYearEndPerformanceOpen?.(spec.id) === true;
      const reportDot = new PIXI.Graphics();
      reportDot.beginFill(
        reportOpen ? MUCHA_UI_COLORS.accents.gold : MUCHA_UI_COLORS.accents.cream,
        1
      );
      reportDot.lineStyle(
        1,
        reportOpen ? MUCHA_UI_COLORS.ink.primary : MUCHA_UI_COLORS.surfaces.border,
        1
      );
      reportDot.drawCircle(0, 0, 4);
      reportDot.endFill();
      reportDot.x = iconWidth - 6;
      reportDot.y = iconY + 7;
      row.addChild(reportDot);
    }

    row.eventMode = "none";
    row.cursor = "default";
    row.on("pointertap", () => {
      selectedEntryId = spec.id;
      onSelectEntry?.(spec);
      setExpandedTarget(true);
      lastSignature = null;
    });

    return row;
  }

  function buildRows(rowSpecs, state) {
    rowsExpanded.removeChildren();
    rowsCollapsed.removeChildren();
    expandedRowEntries.length = 0;
    collapsedRowEntries.length = 0;

    let y = 0;
    for (const spec of rowSpecs) {
      const expandedRowEntry = drawExpandedRow(spec, state, y);
      rowsExpanded.addChild(expandedRowEntry.row);
      expandedRowEntries.push(expandedRowEntry);

      const collapsedRow = drawCollapsedRow(spec, y);
      rowsCollapsed.addChild(collapsedRow);
      collapsedRowEntries.push(collapsedRow);

      y += LOG_ROW_HEIGHT + LOG_ROW_GAP;
    }
  }

  function animateDrawer(frameDt) {
    const target = isExpandedTarget ? 1 : 0;
    if (Math.abs(target - drawerProgress) <= 0.001) {
      drawerProgress = target;
      return false;
    }

    const dtRaw = Number.isFinite(frameDt) ? Number(frameDt) : 1 / 60;
    const dt = Math.max(0, dtRaw);
    const step = clamp01((dt > 0 ? dt : 1 / 60) / DRAWER_ANIM_SEC);
    drawerProgress += (target - drawerProgress) * step;
    if (Math.abs(target - drawerProgress) <= 0.001) {
      drawerProgress = target;
    }
    return true;
  }

  function updateLayout(force = false) {
    const panelWidth = getPanelWidth(drawerProgress);
    const expandedAlpha = clamp01(drawerProgress);
    const collapsedAlpha = clamp01(1 - drawerProgress);
    const expandedInteractive = drawerProgress >= 0.6;
    const collapsedInteractive = drawerProgress <= 0.4;

    const layoutSignature = [
      Math.round(panelWidth * 100) / 100,
      Math.round(expandedAlpha * 1000) / 1000,
      expandedInteractive ? 1 : 0,
      collapsedInteractive ? 1 : 0,
    ].join(":");
    if (!force && layoutSignature === lastLayoutSignature) return;
    lastLayoutSignature = layoutSignature;

    drawLogRoundedRect(bg, {
      width: panelWidth,
      height: PANEL_HEIGHT,
      radius: LOG_PANEL_RADIUS,
      fill: LOG_BG_FILL,
      fillAlpha: LOG_BG_ALPHA,
    });

    const expandedMaskWidth = Math.max(0, panelWidth - PADDING * 2);
    const expandedMaskHeight = PANEL_HEIGHT - HEADER_HEIGHT - PADDING;
    rowsExpandedMask.clear();
    rowsExpandedMask.beginFill(0xffffff, 1);
    rowsExpandedMask.drawRect(0, 0, expandedMaskWidth, expandedMaskHeight);
    rowsExpandedMask.endFill();

    title.alpha = expandedAlpha;
    tip.alpha = expandedAlpha;
    collapsedMarker.alpha = collapsedAlpha;
    collapsedMarker.x = Math.floor((DRAWER_COLLAPSED_WIDTH - collapsedMarker.width) / 2);

    rowsExpanded.alpha = expandedAlpha;
    rowsExpanded.visible = expandedAlpha > 0.01;

    rowsCollapsed.alpha = collapsedAlpha;
    rowsCollapsed.visible = collapsedAlpha > 0.01;

    setExpandedRowInteractivity(expandedInteractive);
    setCollapsedRowInteractivity(collapsedInteractive);

    drawerHandle.x = panelWidth;
    drawerHandle.y = Math.floor((PANEL_HEIGHT - DRAWER_HANDLE_HEIGHT) / 2);
    drawerHandleBg.clear();
    drawerHandleBg.beginFill(MUCHA_UI_COLORS.accents.cream, 0.96);
    drawerHandleBg.lineStyle(1, MUCHA_UI_COLORS.surfaces.border, 0.95);
    drawerHandleBg.drawRoundedRect(
      -DRAWER_HANDLE_WIDTH / 2,
      0,
      DRAWER_HANDLE_WIDTH,
      DRAWER_HANDLE_HEIGHT,
      9
    );
    drawerHandleBg.endFill();

    drawerHandleArrow.text = drawerProgress >= 0.5 ? "<" : ">";
    drawerHandleArrow.x = 0;
    drawerHandleArrow.y = Math.floor(DRAWER_HANDLE_HEIGHT / 2) - 1;
    solidHitArea.refresh();
  }

  function init() {
    drawerHandle.on("pointertap", () => {
      setExpandedTarget(!isExpandedTarget);
    });
    updateLayout(true);
  }

  function update(frameDt = 0) {
    const visible = typeof isVisible === "function" ? isVisible() !== false : true;
    const becameVisible = visible && !wasVisible;
    wasVisible = visible;

    container.visible = visible;
    if (!visible) {
      clearSelection();
      return;
    }

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

    const signature = buildRowsSignature(
      rowSpecs,
      selectedEntryId,
      state,
      isYearEndPerformanceOpen
    );
    const rowsChanged = signature !== lastSignature;
    if (rowsChanged) {
      lastSignature = signature;
      buildRows(rowSpecs, state);
    }

    const drawerChanged = animateDrawer(frameDt);
    updateLayout(becameVisible || rowsChanged || drawerChanged);
  }

  return {
    init,
    update,
    container,
    clearSelection,
    getScreenRect() {
      if (!container.visible) return null;
      const bounds = container.getBounds?.();
      if (!bounds) return null;
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    },
  };
}
