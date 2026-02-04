// src/views/action-log-pixi.js
// Minimal current-second action log UI (planner intents only).

import { createActionLogController } from "../controllers/actionmanagers/action-log-controller.js";

const PANEL_WIDTH = 280;
const PANEL_HEIGHT = 720;
const HEADER_HEIGHT = 64;
const ROW_HEIGHT = 54;
const ROW_GAP = 8;
const PADDING = 16;
const AP_HOVER_OVERLAY_ALPHA = 0.45;
const AP_HOVER_FADE_IN = 14;
const AP_HOVER_FADE_OUT = 8;
const GHOST_ROW_ALPHA = 0.55;
const GHOST_FLASH_MS = 220;

export function createActionLogView({
  app,
  layer,
  getPlanner,
  getTimeline,
  getCursorState,
  isPreviewing,
  onJumpToSecond,
  onClearActions,
  getOwnerLabel,
  getState,
  position = { x: 1620, y: 180 },
}) {
  const container = new PIXI.Container();
  container.x = position.x;
  container.y = position.y;
  container.zIndex = 100;
  layer.addChild(container);

  const logController = createActionLogController({
    getPlanner,
    getTimeline,
    getState,
    getCursorState,
    getOwnerLabel,
  });

  const bg = new PIXI.Graphics();
  bg.beginFill(0x151a2a, 0.95);
  bg.drawRoundedRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 16);
  bg.endFill();
  container.addChild(bg);

  const header = new PIXI.Container();
  header.x = 0;
  header.y = 0;
  container.addChild(header);

  const title = new PIXI.Text("Action Log", {
    fill: 0xffffff,
    fontSize: 24,
    fontWeight: "bold",
  });
  title.x = PADDING + 80;
  title.y = 16;
  header.addChild(title);

  const prevBtn = new PIXI.Text("<", {
    fill: 0x9aa0b5,
    fontSize: 20,
    fontWeight: "bold",
  });
  prevBtn.x = PANEL_WIDTH - 48;
  prevBtn.y = 20;
  prevBtn.eventMode = "static";
  prevBtn.cursor = "pointer";
  header.addChild(prevBtn);

  const nextBtn = new PIXI.Text(">", {
    fill: 0x9aa0b5,
    fontSize: 20,
    fontWeight: "bold",
  });
  nextBtn.x = PANEL_WIDTH - 22;
  nextBtn.y = 20;
  nextBtn.eventMode = "static";
  nextBtn.cursor = "pointer";
  header.addChild(nextBtn);

  const apPanel = new PIXI.Graphics();
  apPanel.beginFill(0x1f263d, 1);
  apPanel.drawRoundedRect(PADDING, 12, 64, 44, 12);
  apPanel.endFill();
  header.addChild(apPanel);

  const apHoverOverlay = new PIXI.Graphics();
  apHoverOverlay
    .beginFill(0x8a1f2a, 0.5)
    .lineStyle(2, 0xff4f5e, 1)
    .drawRoundedRect(PADDING, 12, 64, 44, 12)
    .endFill();
  apHoverOverlay.alpha = 0;
  apHoverOverlay.visible = false;
  apHoverOverlay.eventMode = "none";
  header.addChild(apHoverOverlay);

  const apFlash = new PIXI.Graphics();
  apFlash.visible = false;
  header.addChild(apFlash);

  const apLabel = new PIXI.Text("AP", {
    fill: 0xffffff,
    fontSize: 12,
    fontWeight: "bold",
  });
  apLabel.x = PADDING + 18;
  apLabel.y = 16;
  header.addChild(apLabel);

  const apValue = new PIXI.Text("--/--", {
    fill: 0x7fd0ff,
    fontSize: 14,
    fontWeight: "bold",
  });
  apValue.x = PADDING + 10;
  apValue.y = 32;
  header.addChild(apValue);

  const rows = new PIXI.Container();
  rows.x = PADDING;
  rows.y = HEADER_HEIGHT;
  container.addChild(rows);

  const ghostLayer = new PIXI.Container();
  ghostLayer.x = rows.x;
  ghostLayer.y = rows.y;
  ghostLayer.zIndex = rows.zIndex + 1;
  container.addChild(ghostLayer);

  const resetBtn = new PIXI.Container();
  resetBtn.x = PADDING;
  resetBtn.y = PANEL_HEIGHT - 44;
  resetBtn.eventMode = "static";
  resetBtn.cursor = "pointer";
  container.addChild(resetBtn);

  const resetBg = new PIXI.Graphics();
  resetBg.beginFill(0x1f263d, 1);
  resetBg.drawRoundedRect(0, 0, PANEL_WIDTH - PADDING * 2, 30, 10);
  resetBg.endFill();
  resetBtn.addChild(resetBg);

  const resetText = new PIXI.Text("Clear Log", {
    fill: 0xffffff,
    fontSize: 12,
    fontWeight: "bold",
  });
  resetText.x = 12;
  resetText.y = 7;
  resetBtn.addChild(resetText);

  const resetTip = new PIXI.Text("Clear log (Z)", {
    fill: 0x9aa0b5,
    fontSize: 10,
  });
  resetTip.x = PADDING;
  resetTip.y = PANEL_HEIGHT - 62;
  resetTip.visible = false;
  container.addChild(resetTip);

  const flashOverlay = new PIXI.Graphics();
  flashOverlay.visible = false;
  container.addChild(flashOverlay);

  let flashTimeout = null;
  let apFlashTimeout = null;
  let apHoverTarget = 0;
  let apHoverAlpha = 0;

  let lastVersion = -1;
  let lastPreviewing = null;
  let lastPreviewSec = null;

  const ghostEntries = new Map();
  let ghostOrder = [];
  let nextGhostId = 1;
  let dragGhostId = null;

  function applyGhostSpec(entry, spec) {
    if (!entry || !spec) return;
    entry.spec = spec;
    entry.costText.text = String(spec.cost ?? 0);
    entry.descText.text = spec.description || "";
  }

  function layoutGhostRows() {
    let y = 0;
    for (const id of ghostOrder) {
      const entry = ghostEntries.get(id);
      if (!entry) continue;
      entry.container.y = y;
      y += ROW_HEIGHT + ROW_GAP;
    }
  }

  function removeGhost(id) {
    const entry = ghostEntries.get(id);
    if (!entry) return;
    if (entry.timeout) {
      clearTimeout(entry.timeout);
      entry.timeout = null;
    }
    if (entry.container?.parent) {
      entry.container.parent.removeChild(entry.container);
    }
    ghostEntries.delete(id);
    ghostOrder = ghostOrder.filter((gid) => gid !== id);
    if (dragGhostId === id) dragGhostId = null;
    layoutGhostRows();
  }

  function resolveGhost(id, status) {
    const entry = ghostEntries.get(id);
    if (!entry) return;
    entry.status = status;
    entry.container.alpha = 1;

    const overlay = entry.overlay;
    overlay.clear();
    if (status === "success") {
      overlay
        .beginFill(0x1f6a32, 0.3)
        .lineStyle(2, 0x7dff9e, 1)
        .drawRoundedRect(0, 0, PANEL_WIDTH - PADDING * 2, ROW_HEIGHT, 12)
        .endFill();
    } else {
      overlay
        .beginFill(0x8a1f2a, 0.3)
        .lineStyle(2, 0xff4f5e, 1)
        .drawRoundedRect(0, 0, PANEL_WIDTH - PADDING * 2, ROW_HEIGHT, 12)
        .endFill();
    }
    overlay.visible = true;

    if (entry.timeout) clearTimeout(entry.timeout);
    entry.timeout = setTimeout(() => {
      removeGhost(id);
    }, GHOST_FLASH_MS);
  }

  function createGhostEntry(spec, { isDrag } = {}) {
    const row = new PIXI.Container();
    row.x = 0;
    row.y = 0;
    row.eventMode = "none";
    row.alpha = GHOST_ROW_ALPHA;

    const rowWidth = PANEL_WIDTH - PADDING * 2;
    const rowBg = new PIXI.Graphics();
    rowBg.beginFill(0x2a2f42, 0.8);
    rowBg.drawRoundedRect(0, 0, rowWidth, ROW_HEIGHT, 12);
    rowBg.endFill();
    row.addChild(rowBg);

    const costText = new PIXI.Text(String(spec?.cost ?? 0), {
      fill: 0x7fd0ff,
      fontSize: 16,
      fontWeight: "bold",
    });
    costText.x = 16;
    costText.y = 16;
    row.addChild(costText);

    const descText = new PIXI.Text(spec?.description || "", {
      fill: 0xffffff,
      fontSize: 16,
    });
    descText.x = 72;
    descText.y = 16;
    row.addChild(descText);

    const overlay = new PIXI.Graphics();
    overlay.visible = false;
    row.addChild(overlay);

    const id = nextGhostId++;
    const entry = {
      id,
      isDrag: !!isDrag,
      status: "pending",
      container: row,
      bg: rowBg,
      costText,
      descText,
      overlay,
      spec: spec || {},
      timeout: null,
    };

    ghostEntries.set(id, entry);
    if (entry.isDrag) {
      dragGhostId = id;
      ghostOrder = [id, ...ghostOrder.filter((gid) => gid !== id)];
    } else {
      ghostOrder.push(id);
    }
    ghostLayer.addChild(row);
    applyGhostSpec(entry, spec || {});
    layoutGhostRows();
    return entry;
  }

  function setDragGhost(spec) {
    if (!spec) {
      if (dragGhostId != null) removeGhost(dragGhostId);
      return;
    }

    if (dragGhostId != null && ghostEntries.has(dragGhostId)) {
      const entry = ghostEntries.get(dragGhostId);
      if (entry) applyGhostSpec(entry, spec);
      layoutGhostRows();
      return;
    }

    createGhostEntry(spec, { isDrag: true });
  }

  function resolveDragGhost(status) {
    if (dragGhostId == null) return;
    resolveGhost(dragGhostId, status);
  }

  function flashGhost(spec, status = "success") {
    if (!spec) return;
    const entry = createGhostEntry(spec, { isDrag: false });
    resolveGhost(entry.id, status);
  }

  function buildRows(rowSpecs, planner) {
    rows.removeChildren();
    let y = 0;

    for (const spec of rowSpecs) {
      const row = new PIXI.Container();
      row.x = 0;
      row.y = y;
      const rowWidth = PANEL_WIDTH - PADDING * 2;

      const rowBg = new PIXI.Graphics();
      rowBg.beginFill(spec.isFocused ? 0x2b3350 : 0x2a2f42, 1);
      rowBg.drawRoundedRect(0, 0, rowWidth, ROW_HEIGHT, 12);
      rowBg.endFill();
      row.addChild(rowBg);

      const costText = new PIXI.Text(String(spec.cost ?? 0), {
        fill: 0x7fd0ff,
        fontSize: 16,
        fontWeight: "bold",
      });
      costText.x = 16;
      costText.y = 16;
      row.addChild(costText);

      const descText = new PIXI.Text(spec.description || "", {
        fill: 0xffffff,
        fontSize: 16,
      });
      descText.x = 72;
      descText.y = 16;
      row.addChild(descText);

      const undoText = new PIXI.Text("x", {
        fill: 0x9aa0b5,
        fontSize: 16,
      });
      undoText.x = PANEL_WIDTH - PADDING * 2 - 24;
      undoText.y = 16;

      if (spec.isUndoable && planner) {
        undoText.eventMode = "static";
        undoText.cursor = "pointer";
        undoText.on("pointertap", () => {
          for (const intentId of spec.intentIds || []) {
            planner.removeIntent?.(intentId);
          }
        });
      } else {
        undoText.alpha = 0.3;
      }

      row.addChild(undoText);

      if (spec.focusIntentId && planner?.toggleFocus) {
        row.eventMode = "static";
        row.cursor = "pointer";
        row.on("pointertap", () => {
          planner.toggleFocus?.(spec.focusIntentId);
        });
      }

      rows.addChild(row);
      y += ROW_HEIGHT + ROW_GAP;
    }
  }

  function rebuildFromIntents() {
    const planner = typeof getPlanner === "function" ? getPlanner() : null;
    if (!planner) return;
    const rowSpecs = logController.getIntentRowSpecs();
    buildRows(rowSpecs, planner);
  }

  function rebuildFromTimeline() {
    const rowSpecs = logController.getActionRowSpecsForCurrentSec();
    buildRows(rowSpecs, null);
  }

  function update(dt) {
    const planner = typeof getPlanner === "function" ? getPlanner() : null;
    if (!planner) return;

    const previewing =
      typeof isPreviewing === "function" ? isPreviewing() : false;
    const previewSec = logController.getPreviewSec();

    if (previewing !== lastPreviewing || previewSec !== lastPreviewSec) {
      lastPreviewing = previewing;
      lastPreviewSec = previewSec;
      if (previewing) {
        rebuildFromTimeline();
      } else {
        lastVersion = -1;
      }
    }

    const version = planner.getVersion?.() ?? 0;
    if (!previewing && version !== lastVersion) {
      lastVersion = version;
      rebuildFromIntents();
    }

    const { prev, next } = logController.getPrevNextForCursor();

    prevBtn.alpha = prev == null ? 0.3 : 1;
    prevBtn.cursor = prev == null ? "default" : "pointer";
    nextBtn.alpha = next == null ? 0.3 : 1;
    nextBtn.cursor = next == null ? "default" : "pointer";

    apValue.text = logController.getApText(previewing);

    const frameDt = Number.isFinite(dt) ? dt : 1 / 60;
    const fadeSpeed =
      apHoverTarget > apHoverAlpha ? AP_HOVER_FADE_IN : AP_HOVER_FADE_OUT;
    const step = fadeSpeed * frameDt;
    if (apHoverAlpha < apHoverTarget) {
      apHoverAlpha = Math.min(apHoverTarget, apHoverAlpha + step);
    } else if (apHoverAlpha > apHoverTarget) {
      apHoverAlpha = Math.max(apHoverTarget, apHoverAlpha - step);
    }
    apHoverOverlay.alpha = apHoverAlpha;
    apHoverOverlay.visible = apHoverAlpha > 0.01;
  }

  function init() {}

  function flashInsufficientAp() {
    if (flashTimeout) {
      clearTimeout(flashTimeout);
      flashTimeout = null;
    }
    if (apFlashTimeout) {
      clearTimeout(apFlashTimeout);
      apFlashTimeout = null;
    }

    flashOverlay.clear();
    flashOverlay
      .beginFill(0x8a1f2a, 0.25)
      .lineStyle(2, 0xff4f5e, 1)
      .drawRoundedRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 16)
      .endFill();
    flashOverlay.visible = true;

    apFlash.clear();
    apFlash
      .beginFill(0x8a1f2a, 0.35)
      .lineStyle(2, 0xff4f5e, 1)
      .drawRoundedRect(PADDING, 12, 64, 44, 12)
      .endFill();
    apFlash.visible = true;

    flashTimeout = setTimeout(() => {
      flashOverlay.visible = false;
      flashTimeout = null;
    }, 160);

    apFlashTimeout = setTimeout(() => {
      apFlash.visible = false;
      apFlashTimeout = null;
    }, 260);
  }

  function setApDragWarning(active) {
    apHoverTarget = active ? AP_HOVER_OVERLAY_ALPHA : 0;
    if (apHoverTarget > 0) {
      apHoverOverlay.visible = true;
    }
  }

  prevBtn.on("pointertap", () => {
    const { prev } = logController.getPrevNextForCursor();
    if (prev == null) return;
    onJumpToSecond?.(prev);
  });

  nextBtn.on("pointertap", () => {
    const { next } = logController.getPrevNextForCursor();
    if (next == null) return;
    onJumpToSecond?.(next);
  });

  resetBtn.on("pointerover", () => {
    resetTip.visible = true;
  });

  resetBtn.on("pointerout", () => {
    resetTip.visible = false;
  });

  resetBtn.on("pointertap", () => {
    onClearActions?.();
  });

  return {
    init,
    update,
    container,
    flashInsufficientAp,
    setApDragWarning,
    setDragGhost,
    resolveDragGhost,
    flashGhost,
  };
}
