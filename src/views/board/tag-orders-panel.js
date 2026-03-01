// tag-orders-panel.js
// Shared Orders popover for env tiles + hub structures.

import { envTileDefs } from "../../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { hubTagDefs } from "../../defs/gamesystems/hub-tag-defs.js";
import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { applyTextResolution } from "../ui-helpers/text-resolution.js";

const PANEL_WIDTH = 440;
const PANEL_PAD = 16;
const ROW_HEIGHT = 48;
const ROW_GAP = 8;
const HEADER_HEIGHT = 44;
const PANEL_RADIUS = 16;
const TOGGLE_WIDTH = 92;
const TOGGLE_HEIGHT = 32;
const EDGE_MARGIN = 16;
const POPUP_GAP = 12;

function clamp(value, minValue, maxValue) {
  if (!Number.isFinite(value)) return minValue;
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

function toSafeInt(value, fallback = 0) {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function buildSignature(model) {
  if (!model) return "none";
  const rowSig = model.rows
    .map((row) => `${row.tagId}:${row.disabled ? 1 : 0}`)
    .join("|");
  return `${model.kind}:${model.col}:${model.title}:${rowSig}`;
}

function copyAnchorRect(anchorRect, app) {
  if (!anchorRect || typeof anchorRect !== "object") {
    const width = Math.max(1, toSafeInt(app?.renderer?.width, 1920));
    const height = Math.max(1, toSafeInt(app?.renderer?.height, 1080));
    return {
      x: Math.floor(width * 0.5),
      y: Math.floor(height * 0.5),
      width: 0,
      height: 0,
    };
  }
  return {
    x: Number.isFinite(anchorRect.x) ? anchorRect.x : 0,
    y: Number.isFinite(anchorRect.y) ? anchorRect.y : 0,
    width: Number.isFinite(anchorRect.width) ? anchorRect.width : 0,
    height: Number.isFinite(anchorRect.height) ? anchorRect.height : 0,
  };
}

function resolveEnvTarget(state, col) {
  const envCol = toSafeInt(col, -1);
  if (envCol < 0) return null;
  const tile = state?.board?.occ?.tile?.[envCol] || null;
  if (!tile) return null;
  const def = envTileDefs?.[tile?.defId];
  const title = def?.name || tile?.defId || `Tile ${envCol}`;
  return { target: tile, col: envCol, title };
}

function resolveHubTarget(state, col) {
  const hubCol = toSafeInt(col, -1);
  if (hubCol < 0) return null;
  const structure =
    state?.hub?.occ?.[hubCol] ?? state?.hub?.slots?.[hubCol]?.structure ?? null;
  if (!structure) return null;
  const def = hubStructureDefs?.[structure?.defId];
  const title = def?.name || structure?.defId || `Structure ${hubCol}`;
  return { target: structure, col: hubCol, title };
}

export function createTagOrdersPanel(opts = {}) {
  const {
    app,
    layer,
    getGameState,
    isEnvTagVisible,
    isHubTagVisible,
    onToggleTileTag,
    onToggleHubTag,
    requestPauseForAction,
  } = opts;

  if (!layer || !app?.stage) {
    return {
      openForTarget: () => {},
      toggleForTarget: () => {},
      close: () => {},
      update: () => {},
      isOpen: () => false,
    };
  }

  const root = new PIXI.Container();
  root.visible = false;
  root.zIndex = 95;
  root.eventMode = "none";
  root.sortableChildren = false;
  layer.sortableChildren = true;
  layer.addChild(root);

  const panel = new PIXI.Container();
  panel.eventMode = "static";
  panel.on("pointerdown", (ev) => ev?.stopPropagation?.());
  panel.on("pointertap", (ev) => ev?.stopPropagation?.());
  root.addChild(panel);

  const panelBg = new PIXI.Graphics();
  panel.addChild(panelBg);
  const headerBg = new PIXI.Graphics();
  panel.addChild(headerBg);
  const titleText = new PIXI.Text("Orders", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: 20,
    fontWeight: "bold",
  });
  panel.addChild(titleText);

  const rows = new PIXI.Container();
  rows.y = HEADER_HEIGHT + PANEL_PAD;
  panel.addChild(rows);

  const emptyText = new PIXI.Text("No unlocked tags.", {
    fill: MUCHA_UI_COLORS.ink.secondary,
    fontSize: 18,
  });
  rows.addChild(emptyText);

  let openContext = null;
  let anchorRect = null;
  let modelSignature = "";
  let outsideHandler = null;

  function setOpenVisible(open) {
    root.visible = !!open;
    root.eventMode = open ? "static" : "none";
  }

  function isOpen() {
    return !!openContext;
  }

  function isSameTarget(a, b) {
    if (!a || !b) return false;
    return a.kind === b.kind && a.col === b.col;
  }

  function resolveModel(state, context) {
    if (!state || !context) return null;
    const kind = context.kind === "hub" ? "hub" : "env";
    const col = toSafeInt(context.col, -1);
    if (col < 0) return null;

    const resolved =
      kind === "hub" ? resolveHubTarget(state, col) : resolveEnvTarget(state, col);
    if (!resolved?.target) return null;
    const target = resolved.target;
    const tags = Array.isArray(target?.tags) ? target.tags : [];
    const defs = kind === "hub" ? hubTagDefs : envTagDefs;
    const isUnlocked = kind === "hub" ? isHubTagVisible : isEnvTagVisible;

    const rowsModel = [];
    for (const tagId of tags) {
      if (typeof tagId !== "string" || tagId.length <= 0) continue;
      if (isUnlocked?.(tagId) !== true) continue;
      const tagName = defs?.[tagId]?.ui?.name || tagId;
      const disabled = target?.tagStates?.[tagId]?.disabled === true;
      rowsModel.push({ tagId, tagName, disabled });
    }

    return {
      kind,
      col,
      title: `${resolved.title} - Orders`,
      rows: rowsModel,
    };
  }

  function layoutPanel(model) {
    const screenW = Math.max(1, toSafeInt(app?.renderer?.width, 1920));
    const screenH = Math.max(1, toSafeInt(app?.renderer?.height, 1080));
    const rowsCount = Math.max(1, model?.rows?.length ?? 0);
    const rowsHeight =
      rowsCount > 0 ? rowsCount * ROW_HEIGHT + (rowsCount - 1) * ROW_GAP : ROW_HEIGHT;
    const panelHeight = HEADER_HEIGHT + PANEL_PAD * 2 + rowsHeight;

    const anchor = copyAnchorRect(anchorRect, app);
    const anchorCenterX = anchor.x + anchor.width * 0.5;
    let x = Math.floor(anchorCenterX - PANEL_WIDTH * 0.5);
    x = clamp(x, EDGE_MARGIN, Math.max(EDGE_MARGIN, screenW - PANEL_WIDTH - EDGE_MARGIN));

    let y = Math.floor(anchor.y - panelHeight - POPUP_GAP);
    if (y < EDGE_MARGIN) {
      y = Math.floor(anchor.y + anchor.height + POPUP_GAP);
      y = clamp(y, EDGE_MARGIN, Math.max(EDGE_MARGIN, screenH - panelHeight - EDGE_MARGIN));
    }

    panel.x = x;
    panel.y = y;
    panel.hitArea = new PIXI.Rectangle(0, 0, PANEL_WIDTH, panelHeight);

    panelBg.clear();
    panelBg
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.95)
      .beginFill(MUCHA_UI_COLORS.surfaces.panelDeep, 0.97)
      .drawRoundedRect(0, 0, PANEL_WIDTH, panelHeight, PANEL_RADIUS)
      .endFill();

    headerBg.clear();
    headerBg
      .beginFill(MUCHA_UI_COLORS.surfaces.header, 0.98)
      .drawRoundedRect(0, 0, PANEL_WIDTH, HEADER_HEIGHT, PANEL_RADIUS)
      .endFill();

    titleText.text = model?.title || "Orders";
    applyTextResolution(titleText, 2);
    titleText.x = PANEL_PAD;
    titleText.y = Math.floor((HEADER_HEIGHT - titleText.height) * 0.5);
  }

  function drawRowToggleButton(bg, textNode, disabled) {
    const isOff = disabled === true;
    const fill = isOff ? 0x5a2a31 : 0x2e5c3f;
    const stroke = isOff ? 0xf2b0b0 : 0xcff5d6;
    const textColor = isOff ? 0xf2b0b0 : 0xd7ffe0;
    bg.clear();
    bg
      .lineStyle(1, stroke, 0.95)
      .beginFill(fill, 0.98)
      .drawRoundedRect(0, 0, TOGGLE_WIDTH, TOGGLE_HEIGHT, 6)
      .endFill();
    textNode.style.fill = textColor;
    textNode.text = isOff ? "OFF" : "ON";
    applyTextResolution(textNode, 2);
    textNode.x = Math.floor((TOGGLE_WIDTH - textNode.width) * 0.5);
    textNode.y = Math.floor((TOGGLE_HEIGHT - textNode.height) * 0.5);
  }

  function requestToggle(model, row) {
    if (!model || !row) return;
    requestPauseForAction?.();
    const nextDisabled = row.disabled !== true;
    if (model.kind === "hub") {
      onToggleHubTag?.({
        hubCol: model.col,
        tagId: row.tagId,
        disabled: nextDisabled,
      });
      return;
    }
    onToggleTileTag?.({
      envCol: model.col,
      tagId: row.tagId,
      disabled: nextDisabled,
    });
  }

  function rebuildRows(model) {
    rows.removeChildren();
    const list = Array.isArray(model?.rows) ? model.rows : [];
    if (list.length <= 0) {
      emptyText.text = "No unlocked tags.";
      applyTextResolution(emptyText, 2);
      emptyText.x = PANEL_PAD;
      emptyText.y = Math.floor((ROW_HEIGHT - emptyText.height) * 0.5);
      rows.addChild(emptyText);
      return;
    }

    let y = 0;
    for (const row of list) {
      const rowRoot = new PIXI.Container();
      rowRoot.x = PANEL_PAD;
      rowRoot.y = y;
      rowRoot.eventMode = "static";
      rowRoot.on("pointerdown", (ev) => ev?.stopPropagation?.());
      rowRoot.on("pointertap", (ev) => ev?.stopPropagation?.());
      rows.addChild(rowRoot);

      const rowWidth = PANEL_WIDTH - PANEL_PAD * 2;
      const rowBg = new PIXI.Graphics();
      rowBg
        .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.9)
        .beginFill(MUCHA_UI_COLORS.surfaces.panel, 0.95)
        .drawRoundedRect(0, 0, rowWidth, ROW_HEIGHT, 6)
        .endFill();
      rowRoot.addChild(rowBg);

      const tagText = new PIXI.Text(row.tagName, {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: 18,
      });
      applyTextResolution(tagText, 2);
      tagText.x = 8;
      tagText.y = Math.floor((ROW_HEIGHT - tagText.height) * 0.5);
      rowRoot.addChild(tagText);

      const toggle = new PIXI.Container();
      toggle.eventMode = "static";
      toggle.cursor = "pointer";
      toggle.x = rowWidth - TOGGLE_WIDTH - 6;
      toggle.y = Math.floor((ROW_HEIGHT - TOGGLE_HEIGHT) * 0.5);
      toggle.on("pointerdown", (ev) => ev?.stopPropagation?.());
      toggle.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        requestToggle(model, row);
      });
      rowRoot.addChild(toggle);

      const toggleBg = new PIXI.Graphics();
      const toggleText = new PIXI.Text("", {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: 16,
        fontWeight: "bold",
      });
      toggle.addChild(toggleBg, toggleText);
      drawRowToggleButton(toggleBg, toggleText, row.disabled);

      y += ROW_HEIGHT + ROW_GAP;
    }
  }

  function syncFromState(state) {
    if (!isOpen()) return;
    const model = resolveModel(state, openContext);
    if (!model) {
      close();
      return;
    }

    const nextSignature = buildSignature(model);
    if (nextSignature !== modelSignature) {
      modelSignature = nextSignature;
      rebuildRows(model);
    }
    layoutPanel(model);
  }

  function bindOutsideHandler() {
    if (outsideHandler) {
      app.stage.off("pointerdown", outsideHandler);
      outsideHandler = null;
    }
    outsideHandler = (ev) => {
      if (!isOpen()) return;
      const p = ev?.data?.global;
      if (!p) return;
      const bounds = panel.getBounds();
      const inside =
        p.x >= bounds.x &&
        p.x <= bounds.x + bounds.width &&
        p.y >= bounds.y &&
        p.y <= bounds.y + bounds.height;
      if (!inside) close();
    };
    app.stage.on("pointerdown", outsideHandler);
  }

  function openForTarget({ kind, col, anchorRect: nextAnchor } = {}) {
    const normalized = {
      kind: kind === "hub" ? "hub" : "env",
      col: toSafeInt(col, -1),
    };
    if (normalized.col < 0) return;
    openContext = normalized;
    anchorRect = copyAnchorRect(nextAnchor, app);
    modelSignature = "";
    setOpenVisible(true);
    bindOutsideHandler();
    syncFromState(getGameState?.());
  }

  function toggleForTarget({ kind, col, anchorRect: nextAnchor } = {}) {
    const normalized = {
      kind: kind === "hub" ? "hub" : "env",
      col: toSafeInt(col, -1),
    };
    if (normalized.col < 0) return;
    if (isOpen() && isSameTarget(openContext, normalized)) {
      close();
      return;
    }
    openForTarget({ ...normalized, anchorRect: nextAnchor });
  }

  function close() {
    openContext = null;
    anchorRect = null;
    modelSignature = "";
    rows.removeChildren();
    if (outsideHandler) {
      app.stage.off("pointerdown", outsideHandler);
      outsideHandler = null;
    }
    setOpenVisible(false);
  }

  function update(state) {
    if (!isOpen()) return;
    syncFromState(state);
  }

  return {
    openForTarget,
    toggleForTarget,
    close,
    update,
    isOpen,
  };
}
