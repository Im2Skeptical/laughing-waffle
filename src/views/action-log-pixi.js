// src/views/action-log-pixi.js
// Minimal current-second action log UI (planner intents only).

import { itemDefs, permanentDefs } from "../defs/gamepieces-defs.js";

const PANEL_WIDTH = 300;
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
  position = { x: 1600, y: 180 },
}) {
  const container = new PIXI.Container();
  container.x = position.x;
  container.y = position.y;
  container.zIndex = 100;
  layer.addChild(container);

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
    fontSize: 28,
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
  let lastTimelineRevision = null;
  let actionSecs = [];
  let lastPreviewing = null;
  let lastPreviewSec = null;

  function isLogAction(action) {
    if (!action || typeof action !== "object") return false;
    const kind = action.kind;
    if (kind === "inventoryMove") {
      const payload = action.payload || {};
      const fromOwner = payload.fromOwnerId;
      const toOwner = payload.toOwnerId;
      return fromOwner != null && toOwner != null && fromOwner !== toOwner;
    }
    if (kind === "placeCharacter") return true;
    if (kind === "buildDesignate") return true;
    return false;
  }

  function rebuildActionSecs() {
    const tl = typeof getTimeline === "function" ? getTimeline() : null;
    const rev = Math.floor(tl?.revision ?? -1);
    if (rev === lastTimelineRevision) return;
    lastTimelineRevision = rev;

    const set = new Set();
    for (const action of tl?.actions || []) {
      if (!isLogAction(action)) continue;
      set.add(Math.max(0, Math.floor(action.tSec ?? 0)));
    }
    actionSecs = Array.from(set.values()).sort((a, b) => a - b);
  }

  function getPrevNextSecs(currentSec) {
    let prev = null;
    let next = null;
    for (const sec of actionSecs) {
      if (sec < currentSec) prev = sec;
      if (sec > currentSec) {
        next = sec;
        break;
      }
    }
    return { prev, next };
  }

  function formatItemName(intent) {
    const kind = intent?.item?.kind ?? null;
    if (kind && itemDefs[kind]) return itemDefs[kind].name || kind;
    return kind || `Item ${intent?.itemId ?? ""}`.trim();
  }

  function formatOwnerName(ownerId) {
    if (typeof getOwnerLabel === "function") return getOwnerLabel(ownerId);
    return `Owner ${ownerId}`;
  }

  function formatPawnName(charId, state) {
    const ch = state?.characters?.find((c) => c.id === charId);
    return ch?.name || `Char ${charId}`;
  }

  function formatSlotName(slotIndex, state) {
    const slots = state?.permanentSlots || [];
    const slot = slots[slotIndex];
    const perm = slot?.permanent;
    if (perm) {
      const def = permanentDefs[perm.defId];
      return def?.name || def?.id || `Slot ${slotIndex}`;
    }
    return `Slot ${slotIndex}`;
  }

  function describeIntent(intent, state) {
    if (!intent) return "";
    switch (intent.kind) {
      case "itemTransfer": {
        const itemName = formatItemName(intent);
        const dest = formatOwnerName(intent.toOwnerId);
        return `${itemName} > ${dest}`;
      }
      case "pawnMove": {
        const pawnName = formatPawnName(intent.charId, state);
        const dest = formatSlotName(intent.toPlacement?.slotIndex, state);
        return `${pawnName} > ${dest}`;
      }
      case "buildDesignate": {
        return `Build ${intent.defId || intent.buildKey || "Plan"}`;
      }
      default:
        return intent.kind || "Action";
    }
  }

  function rebuildFromIntents() {
    rows.removeChildren();
    const planner = typeof getPlanner === "function" ? getPlanner() : null;
    if (!planner) return;

    const state = typeof getState === "function" ? getState() : null;
    const intents = planner.getOrderedIntents?.() || [];
    const focus = planner.getFocusIntent?.();

    let y = 0;
    for (const intent of intents) {
      const row = new PIXI.Container();
      row.x = 0;
      row.y = y;

      const isFocused = focus && focus.id === intent.id;

      const rowBg = new PIXI.Graphics();
      rowBg.beginFill(isFocused ? 0x2b3350 : 0x2a2f42, 1);
      rowBg.drawRoundedRect(0, 0, PANEL_WIDTH - PADDING * 2, ROW_HEIGHT, 12);
      rowBg.endFill();
      row.addChild(rowBg);

      const cost = planner.getIntentCost?.(intent.id) ?? 0;
      const costText = new PIXI.Text(String(cost), {
        fill: 0x7fd0ff,
        fontSize: 16,
        fontWeight: "bold",
      });
      costText.x = 16;
      costText.y = 16;
      row.addChild(costText);

      const descText = new PIXI.Text(describeIntent(intent, state), {
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
      undoText.eventMode = "static";
      undoText.cursor = "pointer";
      undoText.on("pointertap", () => {
        planner.removeIntent?.(intent.id);
      });
      row.addChild(undoText);

      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointertap", () => {
        planner.toggleFocus?.(intent.id);
      });

      rows.addChild(row);
      y += ROW_HEIGHT + ROW_GAP;
    }
  }

  function buildActionRows(actions, state) {
    rows.removeChildren();
    let y = 0;
    for (const action of actions) {
      const kind = action.kind;
      const payload = action.payload || {};
      const apCost =
        Number.isFinite(action.apCost) || Number.isFinite(payload.apCost)
          ? Math.floor(action.apCost ?? payload.apCost ?? 0)
          : 0;

      let desc = "Action";
      if (kind === "inventoryMove") {
        const itemName = payload.item?.kind
          ? itemDefs[payload.item.kind]?.name || payload.item.kind
          : `Item ${payload.itemId ?? ""}`.trim();
        const dest = formatOwnerName(payload.toOwnerId);
        desc = `${itemName} > ${dest}`;
      } else if (kind === "placeCharacter") {
        const pawnName = formatPawnName(payload.charId, state);
        const dest = formatSlotName(payload.slotIndex, state);
        desc = `${pawnName} > ${dest}`;
      } else if (kind === "buildDesignate") {
        desc = `Build ${payload.defId || payload.buildKey || "Plan"}`;
      }

      const row = new PIXI.Container();
      row.x = 0;
      row.y = y;

      const rowBg = new PIXI.Graphics();
      rowBg.beginFill(0x2a2f42, 1);
      rowBg.drawRoundedRect(0, 0, PANEL_WIDTH - PADDING * 2, ROW_HEIGHT, 12);
      rowBg.endFill();
      row.addChild(rowBg);

      const costText = new PIXI.Text(String(apCost), {
        fill: 0x7fd0ff,
        fontSize: 16,
        fontWeight: "bold",
      });
      costText.x = 16;
      costText.y = 16;
      row.addChild(costText);

      const descText = new PIXI.Text(desc, {
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
      undoText.alpha = 0.3;
      row.addChild(undoText);

      rows.addChild(row);
      y += ROW_HEIGHT + ROW_GAP;
    }
  }

  function rebuildFromTimeline(state) {
    const tl = typeof getTimeline === "function" ? getTimeline() : null;
    const tSec = Math.floor(state?.tSec ?? 0);
    const actions = [];
    if (tl?.actionsBySec) {
      actions.push(...(tl.actionsBySec.get(tSec) || []));
    } else {
      for (const action of tl?.actions || []) {
        if (Math.floor(action.tSec ?? 0) === tSec) actions.push(action);
      }
    }
    const logActions = actions.filter(isLogAction);
    buildActionRows(logActions, state);
  }

  function update() {
    const planner = typeof getPlanner === "function" ? getPlanner() : null;
    if (!planner) return;

    const previewing =
      typeof isPreviewing === "function" ? isPreviewing() : false;
    const state = typeof getState === "function" ? getState() : null;
    const previewSec = Math.floor(state?.tSec ?? 0);

    if (previewing !== lastPreviewing || previewSec !== lastPreviewSec) {
      lastPreviewing = previewing;
      lastPreviewSec = previewSec;
      if (previewing) {
        rebuildFromTimeline(state);
      } else {
        lastVersion = -1;
      }
    }

    const version = planner.getVersion?.() ?? 0;
    if (!previewing && version !== lastVersion) {
      lastVersion = version;
      rebuildFromIntents();
    }

    rebuildActionSecs();
    const cursorState =
      typeof getCursorState === "function" ? getCursorState() : null;
    const currentSec = Math.floor(cursorState?.tSec ?? 0);
    const { prev, next } = getPrevNextSecs(currentSec);

    prevBtn.alpha = prev == null ? 0.3 : 1;
    prevBtn.cursor = prev == null ? "default" : "pointer";
    nextBtn.alpha = next == null ? 0.3 : 1;
    nextBtn.cursor = next == null ? "default" : "pointer";

    if (previewing && state) {
      const cur = Math.floor(state.actionPoints ?? 0);
      const cap = Math.floor(state.actionPointCap ?? 0);
      apValue.text = `${cur}/${cap}`;
    } else {
      const ap = planner.getApPreview?.();
      if (ap) {
        apValue.text = `${Math.floor(ap.remaining)}/${Math.floor(ap.base)}`;
      }
    }
  }

  function init() {}

  prevBtn.on("pointertap", () => {
    rebuildActionSecs();
    const cursorState =
      typeof getCursorState === "function" ? getCursorState() : null;
    const currentSec = Math.floor(cursorState?.tSec ?? 0);
    const { prev } = getPrevNextSecs(currentSec);
    if (prev == null) return;
    onJumpToSecond?.(prev);
  });

  nextBtn.on("pointertap", () => {
    rebuildActionSecs();
    const cursorState =
      typeof getCursorState === "function" ? getCursorState() : null;
    const currentSec = Math.floor(cursorState?.tSec ?? 0);
    const { next } = getPrevNextSecs(currentSec);
    if (next == null) return;
    onJumpToSecond?.(next);
  });

  return { init, update, container };
}
