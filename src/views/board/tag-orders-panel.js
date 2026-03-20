// tag-orders-panel.js
// Shared Orders popover for env tiles + hub structures.

import { envTileDefs } from "../../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { hubTagDefs } from "../../defs/gamesystems/hub-tag-defs.js";
import { isDiscoveryAlwaysVisibleEnvTag } from "../../model/discovery.js";
import {
  getHubTagPlayerRole,
  normalizeVisibleHubTagOrder,
} from "../../model/hub-tags.js";
import { isEnvColRevealed, isHubVisible } from "../../model/state.js";
import { isTagHidden } from "../../model/tag-state.js";
import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { installSolidUiHitArea } from "../ui-helpers/solid-ui-hit-area.js";
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
const AUTO_CLOSE_OUTSIDE_PAD = 8;
const AUTO_CLOSE_OUTSIDE_MS = 140;
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
    .map(
      (row) =>
        `${row.tagId}:${row.disabled ? 1 : 0}:${row.playerRole || "none"}`
    )
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
  const title = isEnvColRevealed(state, envCol)
    ? def?.name || tile?.defId || `Tile ${envCol}`
    : "???";
  return { target: tile, col: envCol, title };
}

function resolveHubTarget(state, col) {
  if (!isHubVisible(state)) return null;
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
    getTilePlanPreview,
    getHubPlanPreview,
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
  const solidPanelHitArea = installSolidUiHitArea(panel, () => {
    const bounds = panel.getLocalBounds?.() ?? null;
    return {
      x: 0,
      y: 0,
      width: bounds?.width ?? PANEL_WIDTH,
      height: bounds?.height ?? HEADER_HEIGHT,
    };
  });
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
  let outsideMoveHandler = null;
  let outsideSinceMs = -1;

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
      if (
        kind === "env"
          ? isDiscoveryAlwaysVisibleEnvTag(tagId) !== true && isUnlocked?.(tagId) !== true
          : isUnlocked?.(tagId) !== true
      ) {
        continue;
      }
      if (kind === "env" && !isEnvColRevealed(state, col) && tagId !== "explore") continue;
      if (isTagHidden(target, tagId)) continue;
      const tagName = defs?.[tagId]?.ui?.name || tagId;
      const preview =
        kind === "hub"
          ? getHubPlanPreview?.(col) ?? null
          : getTilePlanPreview?.(col) ?? null;
      const disabled =
        preview?.tagDisabledById &&
        Object.prototype.hasOwnProperty.call(preview.tagDisabledById, tagId)
          ? preview.tagDisabledById[tagId] === true
          : target?.tagStates?.[tagId]?.disabled === true;
      rowsModel.push({
        tagId,
        tagName,
        disabled,
        playerRole: kind === "hub" ? getHubTagPlayerRole(tagId) : null,
      });
    }

    if (kind === "hub" && rowsModel.length > 1) {
      const rowByTagId = new Map(rowsModel.map((row) => [row.tagId, row]));
      const orderedTagIds = normalizeVisibleHubTagOrder(
        rowsModel.map((row) => row.tagId)
      );
      rowsModel.length = 0;
      for (const tagId of orderedTagIds) {
        const row = rowByTagId.get(tagId);
        if (row) rowsModel.push(row);
      }
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
    solidPanelHitArea.refresh();

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

  function getHubRoleVisual(playerRole) {
    if (playerRole === "active") {
      return {
        rowFill: MUCHA_UI_COLORS.surfaces.panelSoft,
        rowStroke: MUCHA_UI_COLORS.accents.gold,
        accent: MUCHA_UI_COLORS.accents.gold,
      };
    }
    return {
      rowFill: MUCHA_UI_COLORS.surfaces.panel,
      rowStroke: MUCHA_UI_COLORS.surfaces.border,
      accent: MUCHA_UI_COLORS.surfaces.border,
    };
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
      const roleVisual =
        model?.kind === "hub" ? getHubRoleVisual(row.playerRole) : null;
      rowBg
        .lineStyle(
          1,
          roleVisual?.rowStroke ?? MUCHA_UI_COLORS.surfaces.borderSoft,
          0.9
        )
        .beginFill(roleVisual?.rowFill ?? MUCHA_UI_COLORS.surfaces.panel, 0.95)
        .drawRoundedRect(0, 0, rowWidth, ROW_HEIGHT, 6)
        .endFill();
      rowRoot.addChild(rowBg);

      if (roleVisual) {
        const accent = new PIXI.Graphics();
        accent
          .beginFill(roleVisual.accent, 0.98)
          .drawRoundedRect(2, 3, 5, ROW_HEIGHT - 6, 2)
          .endFill();
        rowRoot.addChild(accent);
      }

      const tagText = new PIXI.Text(row.tagName, {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: 18,
      });
      applyTextResolution(tagText, 2);
      tagText.x = roleVisual ? 14 : 8;
      tagText.y = Math.floor((ROW_HEIGHT - tagText.height) * 0.5);
      rowRoot.addChild(tagText);
      const maxTextWidth = Math.max(80, rowWidth - TOGGLE_WIDTH - tagText.x - 18);
      if (tagText.width > maxTextWidth) {
        tagText.style.wordWrap = true;
        tagText.style.wordWrapWidth = maxTextWidth;
        tagText.style.breakWords = true;
        tagText.dirty = true;
        tagText.y = Math.floor((ROW_HEIGHT - tagText.height) * 0.5);
      }

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

  function isPointInsideRect(point, rect, pad = 0) {
    if (!point || !rect) return false;
    const safePad = Number.isFinite(pad) ? Math.max(0, pad) : 0;
    const x = Number.isFinite(point.x) ? point.x : NaN;
    const y = Number.isFinite(point.y) ? point.y : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const minX = (Number.isFinite(rect.x) ? rect.x : 0) - safePad;
    const minY = (Number.isFinite(rect.y) ? rect.y : 0) - safePad;
    const maxX =
      (Number.isFinite(rect.x) ? rect.x : 0) +
      (Number.isFinite(rect.width) ? rect.width : 0) +
      safePad;
    const maxY =
      (Number.isFinite(rect.y) ? rect.y : 0) +
      (Number.isFinite(rect.height) ? rect.height : 0) +
      safePad;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  function bindOutsideHandlers() {
    if (outsideHandler) {
      app.stage.off("pointerdown", outsideHandler);
      outsideHandler = null;
    }
    if (outsideMoveHandler) {
      app.stage.off("pointermove", outsideMoveHandler);
      outsideMoveHandler = null;
    }

    outsideHandler = (ev) => {
      if (!isOpen()) return;
      const p = ev?.data?.global;
      if (!p) return;
      const bounds = panel.getBounds();
      if (!isPointInsideRect(p, bounds)) close();
    };

    outsideMoveHandler = (ev) => {
      if (!isOpen()) return;
      const p = ev?.data?.global;
      if (!p) return;

      const bounds = panel.getBounds();
      const insidePanel = isPointInsideRect(p, bounds);
      const insideAnchor = isPointInsideRect(p, anchorRect, AUTO_CLOSE_OUTSIDE_PAD);
      if (insidePanel || insideAnchor) {
        outsideSinceMs = -1;
        return;
      }

      const now = Date.now();
      if (outsideSinceMs < 0) {
        outsideSinceMs = now;
        return;
      }
      if (now - outsideSinceMs >= AUTO_CLOSE_OUTSIDE_MS) {
        close();
      }
    };

    outsideSinceMs = -1;
    app.stage.on("pointerdown", outsideHandler);
    app.stage.on("pointermove", outsideMoveHandler);
  }

  function bindOutsideHandler() {
    bindOutsideHandlers();
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
    if (outsideMoveHandler) {
      app.stage.off("pointermove", outsideMoveHandler);
      outsideMoveHandler = null;
    }
    outsideSinceMs = -1;
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
    getOccludingScreenRects() {
      if (!root.visible || typeof panel.getBounds !== "function") return [];
      const bounds = panel.getBounds();
      return bounds ? [bounds] : [];
    },
  };
}
