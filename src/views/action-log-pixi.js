// src/views/action-log-pixi.js
// Minimal current-second action log UI (planner intents only).

import { createActionLogController } from "../controllers/actionmanagers/action-log-controller.js";

const PANEL_WIDTH = 280;
const PANEL_HEIGHT = 720;
const HEADER_HEIGHT = 64;
const ROW_HEIGHT = 54;
const ROW_GAP = 8;
const PADDING = 16;

export function createActionLogView({
  app,
  layer,
  getPlanner,
  getTimeline,
  getCursorState,
  isPreviewing,
  onJumpToSecond,
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

  let lastVersion = -1;
  let lastPreviewing = null;
  let lastPreviewSec = null;

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

  function update() {
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
  }

  function init() {}

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

  return { init, update, container };
}
