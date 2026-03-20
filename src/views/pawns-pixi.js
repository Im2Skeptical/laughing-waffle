// pawns-pixi.js
//
// Responsible for rendering pawns and wiring their UI behaviour
// (hover tooltip, hover inventory, click-to-toggle inventory, dragging).
//
// VIEW-ONLY: does NOT depend on model slot.x/slot.y. Positions are derived
// from the same layout math used by board-pixi.js.
//
// Wiring:
// - opts { getPawns, getHubSlots, interaction, tooltipView, inventoryView, onPawnDropped, paintStyleController? }

import {
  BOARD_COLS,
  BOARD_COL_WIDTH,
  BOARD_COL_GAP,
  HUB_COLS,
  HUB_COL_WIDTH,
  HUB_COL_GAP,
  HUB_STRUCTURE_WIDTH,
  HUB_STRUCTURE_HEIGHT,
  HUB_STRUCTURE_ROW_Y,
  TILE_HEIGHT,
  TILE_WIDTH,
  TILE_ROW_Y,
  CHARACTER_ROW_OFFSET_Y,
  VIEW_LAYOUT,
  GAMEPIECE_HOVER_SCALE,
  GAMEPIECE_HOVER_ZOOM_IN_TWEEN_SEC,
  GAMEPIECE_HOVER_ZOOM_OUT_TWEEN_SEC,
  GAMEPIECE_SHADOW_COLOR,
  GAMEPIECE_SHADOW_ALPHA,
  GAMEPIECE_SHADOW_OFFSET_X,
  GAMEPIECE_SHADOW_OFFSET_Y,
} from "./layout-pixi.js";
import { bindTouchLongPress } from "./ui-helpers/touch-long-press.js";
import { applyTextResolution } from "./ui-helpers/text-resolution.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { getVisibleEnvColCount, isEnvColRevealed, isHubVisible } from "../model/state.js";
import { makePawnTooltipSpec } from "./pawn-tooltip-spec.js";

export function createPawnsView(opts) {
  const {
    app,
    layer,
    hoverLayer,
    getPawns,
    getHubSlots,
    interaction,
    tooltipView,
    inventoryView,
    onPawnDropped,
    onPawnClicked,
    requestPauseForAction,
    getPawnMoveAffordability,
    setDragGhost,
    resolveDragGhost,
    paintStyleController,
    getGameState,
    getFocusIntent,
    getExternalFocus,
    getPreviewHubCol,
    getPreviewPlacement,
    canStartHoverZoomIn,
    screenToWorld,
    worldToScreen,
  } = opts;

  const viewsById = new Map();
  const DRAG_THRESHOLD_PX = 3;
  const DRAG_GHOST_REFRESH_MS = 50;
  const FAN_SPACING = 40;
  const RADIUS = 20;
  const PAWN_HOVER_ZINDEX = 30;
  const LEADER_DIAMOND_SCALE = 1.15;
  const INVENTORY_DRAG_VALID_OUTLINE = 0x58c7ff;
  const INVENTORY_DRAG_FULL_OUTLINE = 0xffa24f;
  const INVENTORY_DRAG_HOVER_OUTLINE = 0x6bd37b;
  const INVENTORY_DRAG_GLOW_ALPHA = 0.24;
  let focusGhost = null;
  let focusedPawnId = null;
  let followerOrdinalByPawnIdCache = new Map();
  let followerOrdinalSignature = "";
  let dragGhostCache = {
    pawnId: null,
    targetKey: "",
    lastUpdatedMs: -1,
  };
  const inventoryDragAffordanceByOwnerId = new Map();

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  function nowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function dimColor(color, factor = 0.35) {
    const rgb = Number.isFinite(color) ? color : 0;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    const nextR = Math.max(0, Math.min(255, Math.round(r * factor)));
    const nextG = Math.max(0, Math.min(255, Math.round(g * factor)));
    const nextB = Math.max(0, Math.min(255, Math.round(b * factor)));
    return (nextR << 16) | (nextG << 8) | nextB;
  }

  function getInventoryDragOutlineColor(level) {
    if (level === "hover") return INVENTORY_DRAG_HOVER_OUTLINE;
    if (level === "full") return INVENTORY_DRAG_FULL_OUTLINE;
    if (level === "valid") return INVENTORY_DRAG_VALID_OUTLINE;
    return null;
  }

  function redrawPawnFocusOutline(view, color) {
    if (!view?.focusOutline || !Number.isFinite(view?.shapeRadius)) return;
    view.focusOutline.clear();
    if (color == null) return;
    view.focusOutline.lineStyle(2, color, 1);
    drawPawnShape(view.focusOutline, {
      isLeader: view.isLeader === true,
      radius: view.shapeRadius + 5,
    });
  }

  function applyPawnAffordanceVisual(view, isFocused) {
    if (!view) return;
    const dragColor = getInventoryDragOutlineColor(view.inventoryDragAffordance);
    redrawPawnFocusOutline(view, dragColor);
    if (view.focusOutline) {
      view.focusOutline.visible = dragColor != null;
    }
    view.outline.tint = dragColor == null && isFocused ? 0xffff66 : 0x000000;
    if (view.dragGlow) {
      view.dragGlow.visible = dragColor != null;
      view.dragGlow.tint = dragColor ?? 0xffffff;
    }
  }

  function normalizeInventoryDragOwnerId(ownerId) {
    return ownerId == null ? null : String(ownerId);
  }

  function getStaminaRatio(pawn) {
    const stamina = pawn?.systemState?.stamina;
    const cur = Number.isFinite(stamina?.cur) ? stamina.cur : null;
    const max = Number.isFinite(stamina?.max) ? stamina.max : null;
    if (max != null && max <= 0) return 0;
    if (cur == null && max == null) return 1;
    if (max == null) return cur > 0 ? 1 : 0;
    return clamp01(cur / max);
  }

  if (layer) layer.sortableChildren = true;
  if (hoverLayer) hoverLayer.sortableChildren = true;

  // ---------------------------------------------------------------------------
  // Safe adapters (so missing wiring doesn't crash)
  // ---------------------------------------------------------------------------

  const interactionSafe = interaction || {
    canShowHoverUI: () => true,
    isDragging: () => false,
    canDragPawn: () => true,
    startDrag: () => {},
    endDrag: () => {},
    getDragged: () => null,
    getHovered: () => null,
    getHoveredPawn: () => null,
    setHovered: () => {},
    setHoveredPawn: () => {},
    clearHovered: () => {},
    clearHoveredPawn: () => {},
  };

  function getStateSafe() {
    return typeof getGameState === "function" ? getGameState() : null;
  }

  function getPawnsSafe() {
    if (typeof getPawns === "function") return getPawns() || [];
    const s = getStateSafe();
    // Support likely state shapes
    return s?.pawns || s?.party || [];
  }

  function getEnvColsSafe() {
    const s = getStateSafe();
    return getVisibleEnvColCount(s) || 0;
  }

  function getHubColsSafe() {
    const s = getStateSafe();
    if (!isHubVisible(s)) return 0;
    if (typeof getHubSlots === "function") {
      const slots = getHubSlots() || [];
      if (Array.isArray(slots) && slots.length > 0) return slots.length;
    }
    const slots = s?.hub?.slots;
    if (Array.isArray(slots) && slots.length > 0) return slots.length;
    return HUB_COLS;
  }

  function getInvSafe() {
    // Inventory hover/pin is optional; guard all calls.
    return inventoryView || null;
  }

  function getTooltipSafe() {
    return tooltipView || null;
  }

  function canShowGamepieceHoverUiNow() {
    if (typeof interactionSafe.canShowWorldHoverUI === "function") {
      return interactionSafe.canShowWorldHoverUI() !== false;
    }
    return !interactionSafe.canShowHoverUI || interactionSafe.canShowHoverUI();
  }

  function registerPaintContainer(container) {
    paintStyleController?.registerPaintContainer?.(container);
  }

  function unregisterPaintContainer(container) {
    paintStyleController?.unregisterPaintContainer?.(container);
  }

  function emitDropped(payload) {
    const cb = onPawnDropped || null;
    if (typeof cb === "function") return cb(payload);
    return { ok: false, reason: "noDropHandler" };
  }

  function getHoverInfoForSlot(row, col) {
    const hover =
      typeof interactionSafe.getHovered === "function"
        ? interactionSafe.getHovered()
        : null;
    if (!hover || typeof hover !== "object") return null;
    const span =
      Number.isFinite(hover.span) && hover.span > 0
        ? Math.floor(hover.span)
        : 1;
    if (
      row === "env" &&
      (hover.kind === "tile" || hover.kind === "envStructure") &&
      col >= hover.col &&
      col < hover.col + span
    ) {
      return hover;
    }
    if (
      row === "hub" &&
      hover.kind === "hub" &&
      col >= hover.col &&
      col < hover.col + span
    ) {
      return hover;
    }
    return null;
  }

  function applyHoverTransform(pos, hover) {
    if (!hover) return { x: pos.x, y: pos.y, scale: 1 };
    const scale = Number.isFinite(hover.scale) ? hover.scale : 1;
    const cx = Number.isFinite(hover.centerX) ? hover.centerX : pos.x;
    const cy = Number.isFinite(hover.centerY) ? hover.centerY : pos.y;
    const offsetY = Number.isFinite(hover.offsetY) ? hover.offsetY : 0;
    const adjustedY = pos.y + offsetY;
    return {
      x: cx + (pos.x - cx) * scale,
      y: cy + (adjustedY - cy) * scale,
      scale,
    };
  }

  function getEffectiveScale(view) {
    const attached = Number.isFinite(view.attachedScale) ? view.attachedScale : 1;
    const hover = Number.isFinite(view.selfHoverScaleApplied)
      ? view.selfHoverScaleApplied
      : 1;
    return Math.max(attached, hover);
  }

  function setPawnSelfHoverScale(view, scale) {
    if (!view) return;
    view.selfHoverScaleApplied = Number.isFinite(scale) ? scale : 1;
  }

  function isPawnHoverZoomExpanded(view) {
    if (!view) return false;
    const currentScale = Number.isFinite(view.selfHoverScaleApplied)
      ? view.selfHoverScaleApplied
      : 1;
    const targetScale = Number.isFinite(view.selfHoverScaleTarget)
      ? view.selfHoverScaleTarget
      : 1;
    const currentShadow = Number.isFinite(view.hoverShadowAlphaApplied)
      ? view.hoverShadowAlphaApplied
      : 0;
    const targetShadow = Number.isFinite(view.hoverShadowAlphaTarget)
      ? view.hoverShadowAlphaTarget
      : 0;
    return (
      currentScale > 1.001 ||
      targetScale > 1.001 ||
      currentShadow > 0.001 ||
      targetShadow > 0.001
    );
  }

  function animatePawnSelfHoverScale(view, dt) {
    if (!view) return false;
    const target = Number.isFinite(view.selfHoverScaleTarget)
      ? view.selfHoverScaleTarget
      : 1;
    const current = Number.isFinite(view.selfHoverScaleApplied)
      ? view.selfHoverScaleApplied
      : 1;
    const diff = target - current;
    if (Math.abs(diff) < 0.001) {
      if (Math.abs(current - target) < 1e-6) return false;
      setPawnSelfHoverScale(view, target);
      return true;
    }
    const stepDt = Number.isFinite(dt) ? Math.max(0, dt) : 1 / 60;
    const tweenSec = Math.max(
      0.0001,
      target < current
        ? GAMEPIECE_HOVER_ZOOM_OUT_TWEEN_SEC
        : GAMEPIECE_HOVER_ZOOM_IN_TWEEN_SEC
    );
    const t = Math.min(1, stepDt / tweenSec);
    setPawnSelfHoverScale(view, current + diff * t);
    return true;
  }

  function buildPawnHoverAnchor(view) {
    if (!view?.container || !tooltipView) return null;
    return {
      coordinateSpace: "parent",
      getAnchorRect: () =>
        tooltipView.getAnchorRectForDisplayObject?.(view.container, "parent") ?? null,
    };
  }

  function setPawnHoverShadowAlpha(view, alpha) {
    if (!view?.shadow) return;
    const nextAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    view.hoverShadowAlphaApplied = nextAlpha;
    view.shadow.alpha = nextAlpha;
    view.shadow.visible = nextAlpha > 0.001 && GAMEPIECE_SHADOW_ALPHA > 0;
  }

  function animatePawnHoverShadowAlpha(view, dt) {
    if (!view) return false;
    const target = Number.isFinite(view.hoverShadowAlphaTarget)
      ? view.hoverShadowAlphaTarget
      : 0;
    const current = Number.isFinite(view.hoverShadowAlphaApplied)
      ? view.hoverShadowAlphaApplied
      : 0;
    const diff = target - current;
    if (Math.abs(diff) < 0.001) {
      if (Math.abs(current - target) < 1e-6) return false;
      setPawnHoverShadowAlpha(view, target);
      return true;
    }
    const stepDt = Number.isFinite(dt) ? Math.max(0, dt) : 1 / 60;
    const tweenSec = Math.max(
      0.0001,
      target < current
        ? GAMEPIECE_HOVER_ZOOM_OUT_TWEEN_SEC
        : GAMEPIECE_HOVER_ZOOM_IN_TWEEN_SEC
    );
    const t = Math.min(1, stepDt / tweenSec);
    setPawnHoverShadowAlpha(view, current + diff * t);
    return true;
  }

  function shouldAllowPawnHoverZoomIn(view) {
    if (isPawnHoverZoomExpanded(view)) return true;
    return canStartHoverZoomIn?.() !== false;
  }

  function hasActiveHoverZoomDown() {
    for (const view of viewsById.values()) {
      if (view.selfHover) continue;
      const scalePending =
        Number.isFinite(view.selfHoverScaleTarget) &&
        Number.isFinite(view.selfHoverScaleApplied) &&
        Math.abs(view.selfHoverScaleTarget - view.selfHoverScaleApplied) > 0.001;
      const shadowPending =
        Number.isFinite(view.hoverShadowAlphaTarget) &&
        Number.isFinite(view.hoverShadowAlphaApplied) &&
        Math.abs(view.hoverShadowAlphaTarget - view.hoverShadowAlphaApplied) > 0.001;
      if (scalePending || shadowPending) return true;
    }
    return false;
  }

  function applyPawnScale(view) {
    const scale = getEffectiveScale(view);
    view.container.scale.set(scale);
    applyTextResolution(view.label, scale);
    view.container.zIndex =
      scale > 1 ||
      (Number.isFinite(view.hoverShadowAlphaApplied) && view.hoverShadowAlphaApplied > 0.001)
        ? PAWN_HOVER_ZINDEX
        : 0;
    if (
      view.selfHover ||
      scale > 1 ||
      (Number.isFinite(view.hoverShadowAlphaApplied) && view.hoverShadowAlphaApplied > 0.001)
    ) {
      elevateForHover(view);
    } else {
      restoreFromHover(view);
    }
  }

  function flashDragBlocked(view) {
    if (!view?.flashRing) return;
    if (view.flashTimeout) {
      clearTimeout(view.flashTimeout);
      view.flashTimeout = null;
    }
    view.flashRing.clear();
    view.flashRing
      .lineStyle(2, 0xff4f5e, 1)
      .beginFill(0x8a1f2a, 0.25)
      .drawCircle(0, 0, RADIUS + 4)
      .endFill();
    view.flashRing.visible = true;
    view.flashTimeout = setTimeout(() => {
      view.flashRing.visible = false;
      view.flashTimeout = null;
    }, 160);
  }

  function elevateForHover(view) {
    if (!hoverLayer || view.container.parent === hoverLayer) return;
    view.hoverParent = view.container.parent;
    view.hoverIndex =
      view.container.parent?.getChildIndex?.(view.container) ?? null;
    hoverLayer.addChild(view.container);
  }

  function restoreFromHover(view) {
    if (!hoverLayer || view.container.parent !== hoverLayer) return;
    const parent = view.hoverParent || layer;
    const index = Number.isFinite(view.hoverIndex)
      ? Math.min(parent?.children?.length ?? 0, view.hoverIndex)
      : null;
    if (parent) {
      if (index == null) {
        parent.addChild(view.container);
      } else {
        parent.addChildAt(view.container, index);
      }
    }
    view.hoverParent = null;
    view.hoverIndex = null;
  }

  function getScaledAnchorFromCenter(cx, cy, width, height, scale) {
    const s = Number.isFinite(scale) ? scale : 1;
    const scaledWidth = width * s;
    const scaledHeight = height * s;
    return {
      x: cx - scaledWidth / 2,
      y: cy - scaledHeight / 2,
      width: scaledWidth,
      height: scaledHeight,
      scale: s,
    };
  }

  function getHoverPlacementForPawn(pawn) {
    let placement = null;
    if (typeof getPreviewPlacement === "function") {
      placement = getPreviewPlacement(pawn.id);
    } else if (typeof getPreviewHubCol === "function") {
      const overrideIdx = getPreviewHubCol(pawn.id);
      if (overrideIdx != null) placement = { hubCol: overrideIdx };
    }

    const envCol = Number.isFinite(placement?.envCol)
      ? Math.floor(placement.envCol)
      : Number.isFinite(pawn.envCol)
      ? Math.floor(pawn.envCol)
      : null;
    const hubCol = Number.isFinite(placement?.hubCol)
      ? Math.floor(placement.hubCol)
      : Number.isFinite(pawn.hubCol)
      ? Math.floor(pawn.hubCol)
      : null;

    return { envCol, hubCol };
  }

  function resolveColumnStartX(screenWidth, totalWidth, anchorX, offsetX = 0) {
    const width = Math.max(1, Math.floor(screenWidth));
    const safeTotal = Math.max(0, Math.floor(totalWidth));
    const anchor = String(anchorX || "left").toLowerCase();
    if (anchor === "center" || anchor === "middle") {
      return Math.round(width * 0.5 - safeTotal * 0.5 + offsetX);
    }
    if (anchor === "right" || anchor === "end") {
      return Math.round(width - safeTotal + offsetX);
    }
    return Math.round(offsetX);
  }

  function getBoardColumnXForVisibleCols(screenWidth, col, cols) {
    const safeCols = Math.max(0, Number.isFinite(cols) ? Math.floor(cols) : 0);
    const totalWidth =
      safeCols <= 0 ? 0 : safeCols * BOARD_COL_WIDTH + (safeCols - 1) * BOARD_COL_GAP;
    return (
      resolveColumnStartX(
        screenWidth,
        totalWidth,
        VIEW_LAYOUT.playfield?.region?.anchorX || "center",
        Number(VIEW_LAYOUT.playfield?.region?.offsetX || 0)
      ) +
      Math.max(0, Math.floor(col)) * (BOARD_COL_WIDTH + BOARD_COL_GAP)
    );
  }

  function getHubColumnXForVisibleCols(screenWidth, col, cols) {
    const safeCols = Math.max(0, Number.isFinite(cols) ? Math.floor(cols) : 0);
    const totalWidth =
      safeCols <= 0 ? 0 : safeCols * HUB_COL_WIDTH + (safeCols - 1) * HUB_COL_GAP;
    return (
      resolveColumnStartX(
        screenWidth,
        totalWidth,
        VIEW_LAYOUT.playfield?.hub?.anchorX || "center",
        Number(VIEW_LAYOUT.playfield?.hub?.offsetX || 0)
      ) +
      Math.max(0, Math.floor(col)) * (HUB_COL_WIDTH + HUB_COL_GAP)
    );
  }

  function formatTileName(envCol, state) {
    const col = Math.floor(envCol);
    const tile = state?.board?.occ?.tile?.[col];
    if (!isEnvColRevealed(state, col)) return "???";
    const def = tile ? envTileDefs[tile.defId] : null;
    return def?.name || tile?.defId || `Tile ${col}`;
  }

  function formatHubName(hubCol, state) {
    const col = Math.floor(hubCol);
    const slot = state?.hub?.slots?.[col];
    const structure = slot?.structure;
    if (structure) {
      const def = hubStructureDefs[structure.defId];
      return def?.name || def?.id || `Hub ${col}`;
    }
    return `Hub ${col}`;
  }

  function getDropTargetCenterXs(envCols, hubCols) {
    const screenWidth = Math.max(1, Math.floor(app?.screen?.width ?? 1));
    const envCenters = new Array(Math.max(0, envCols));
    for (let col = 0; col < envCenters.length; col += 1) {
      envCenters[col] = getBoardColumnXForVisibleCols(screenWidth, col, envCols) + TILE_WIDTH / 2;
    }
    const hubCenters = new Array(Math.max(0, hubCols));
    for (let col = 0; col < hubCenters.length; col += 1) {
      hubCenters[col] =
        getHubColumnXForVisibleCols(screenWidth, col, hubCols) + HUB_STRUCTURE_WIDTH / 2;
    }
    return {
      envCenters,
      hubCenters,
    };
  }

  function toWorldPoint(globalPos) {
    if (!globalPos) return null;
    if (typeof screenToWorld === "function") {
      const world = screenToWorld(globalPos);
      if (world && Number.isFinite(world.x) && Number.isFinite(world.y)) {
        return world;
      }
    }
    return {
      x: Number(globalPos.x) || 0,
      y: Number(globalPos.y) || 0,
    };
  }

  function toContainerParentLocal(container, globalPos) {
    if (!container?.parent || !globalPos) return null;
    if (typeof container.parent.toLocal === "function") {
      return container.parent.toLocal(globalPos);
    }
    return {
      x: Number(globalPos.x) || 0,
      y: Number(globalPos.y) || 0,
    };
  }

  function getDropTargetFromPos(globalPos) {
    const state = getStateSafe();
    const worldPos = toWorldPoint(globalPos);
    if (!worldPos || !state) return null;
    const envCols = getEnvColsSafe();
    const hubCols = getHubColsSafe();

    const tileCenterY = TILE_ROW_Y + TILE_HEIGHT / 2;
    const hubCenterY = HUB_STRUCTURE_ROW_Y + HUB_STRUCTURE_HEIGHT / 2;
    const distToTile = Math.abs(worldPos.y - tileCenterY);
    const distToHub = Math.abs(worldPos.y - hubCenterY);
    const targetRow = distToTile <= distToHub ? "env" : "hub";

    const colCount = targetRow === "env" ? envCols : hubCols;
    const centerXs = getDropTargetCenterXs(envCols, hubCols);
    const targetCenters = targetRow === "env" ? centerXs.envCenters : centerXs.hubCenters;

    let bestIndex = null;
    let bestDist2 = Infinity;
    for (let col = 0; col < colCount; col++) {
      const cx = targetCenters[col];
      const dx = worldPos.x - cx;
      const d2 = dx * dx;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestIndex = col;
      }
    }
    if (bestIndex == null) return null;
    return { row: targetRow, col: bestIndex };
  }

  function resetDragGhostCache() {
    dragGhostCache = {
      pawnId: null,
      targetKey: "",
      lastUpdatedMs: -1,
    };
  }

  function buildPawnDragGhostSpec(pawn, target = null) {
    if (!pawn) return null;
    const state = getStateSafe();
    const pawnName = pawn?.name || `Pawn ${pawn?.id ?? ""}`.trim() || "Pawn";
    const intentId = pawn?.id != null ? `pawn:${pawn.id}` : null;
    if (!target || !state) {
      return { description: pawnName, cost: 0, intentId };
    }

    const targetLabel =
      target.row === "env"
        ? formatTileName(target.col, state)
        : formatHubName(target.col, state);

    let cost = 0;
    if (typeof getPawnMoveAffordability === "function") {
      const aff =
        target.row === "env"
          ? getPawnMoveAffordability({ pawnId: pawn.id, toEnvCol: target.col })
          : getPawnMoveAffordability({ pawnId: pawn.id, toHubCol: target.col });
      if (Number.isFinite(aff?.cost)) cost = Math.floor(aff.cost);
    }

    return { description: `${pawnName} > ${targetLabel}`, cost, intentId };
  }

  function updatePawnDragGhost(pawn, globalPos) {
    if (typeof setDragGhost !== "function") return;
    const target = getDropTargetFromPos(globalPos);
    const pawnId = pawn?.id ?? null;
    const targetKey = target ? `${target.row}:${target.col}` : "none";
    const elapsedMs = nowMs() - (dragGhostCache.lastUpdatedMs ?? -1);
    if (
      dragGhostCache.pawnId === pawnId &&
      dragGhostCache.targetKey === targetKey &&
      elapsedMs < DRAG_GHOST_REFRESH_MS
    ) {
      return;
    }

    const spec = buildPawnDragGhostSpec(pawn, target);
    if (!spec) return;
    setDragGhost(spec);
    dragGhostCache = {
      pawnId,
      targetKey,
      lastUpdatedMs: nowMs(),
    };
  }

  // ---------------------------------------------------------------------------
  // Positioning
  // ---------------------------------------------------------------------------

  // Centre above a hub structure card at hubCol
  function getBasePosForHubCol(hubCol) {
    const cols = getHubColsSafe();

    if (!cols || hubCol == null || hubCol < 0 || hubCol >= cols) {
      return { x: 200 + (hubCol ?? 0) * 220, y: 380 };
    }

    const x = getHubColumnXForVisibleCols(app.screen.width, hubCol, cols);
    const centerX = x + HUB_STRUCTURE_WIDTH / 2;
    const topY = HUB_STRUCTURE_ROW_Y;
    return { x: centerX, y: topY - CHARACTER_ROW_OFFSET_Y };
  }

  // Centre above an env tile at envCol
  function getBasePosForEnvCol(envCol) {
    const cols = getEnvColsSafe();
    if (!cols || envCol == null || envCol < 0 || envCol >= cols) {
      return { x: 200 + (envCol ?? 0) * 220, y: 220 };
    }
    const x = getBoardColumnXForVisibleCols(app.screen.width, envCol, cols);
    const centerX = x + TILE_WIDTH / 2;
    const topY = TILE_ROW_Y;
    return { x: centerX, y: topY - CHARACTER_ROW_OFFSET_Y };
  }

  function hashIdentityValue(value) {
    if (Number.isFinite(value)) {
      return (Math.floor(value) >>> 0) || 1;
    }
    const text = String(value ?? "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function computeFollowerOrdinalSignature(pawns) {
    let count = 0;
    let hash = 2166136261;
    for (const pawn of pawns || []) {
      if (!pawn || pawn.role !== "follower" || pawn.id == null) continue;
      count += 1;
      const order = Number.isFinite(pawn?.followerCreationOrderIndex)
        ? Math.floor(pawn.followerCreationOrderIndex)
        : 0;
      const idHash = hashIdentityValue(pawn.id);
      const leaderHash = hashIdentityValue(pawn.leaderId ?? 0);
      hash ^= idHash;
      hash = Math.imul(hash, 16777619);
      hash ^= leaderHash;
      hash = Math.imul(hash, 16777619);
      hash ^= (order >>> 0);
      hash = Math.imul(hash, 16777619);
    }
    return `${count}:${hash >>> 0}`;
  }

  function buildFollowerOrdinalByPawnId(pawns) {
    const byLeader = new Map();
    for (const pawn of pawns || []) {
      if (!pawn || pawn.role !== "follower" || pawn.id == null) continue;
      const leaderId = pawn.leaderId ?? null;
      if (!byLeader.has(leaderId)) byLeader.set(leaderId, []);
      byLeader.get(leaderId).push(pawn);
    }

    const out = new Map();
    for (const followers of byLeader.values()) {
      followers.sort((a, b) => {
        const ai = Number.isFinite(a?.followerCreationOrderIndex)
          ? a.followerCreationOrderIndex
          : 0;
        const bi = Number.isFinite(b?.followerCreationOrderIndex)
          ? b.followerCreationOrderIndex
          : 0;
        if (ai !== bi) return ai - bi;
        return (a?.id ?? 0) - (b?.id ?? 0);
      });
      for (let i = 0; i < followers.length; i++) {
        const followerId = followers[i]?.id;
        if (followerId != null) out.set(followerId, i + 1);
      }
    }
    return out;
  }

  function getFollowerOrdinalByPawnId(pawns) {
    const signature = computeFollowerOrdinalSignature(pawns);
    if (signature !== followerOrdinalSignature) {
      followerOrdinalByPawnIdCache = buildFollowerOrdinalByPawnId(pawns);
      followerOrdinalSignature = signature;
    }
    return followerOrdinalByPawnIdCache;
  }

  function getLabelForPawn(pawn, followerOrdinalByPawnId = null) {
    if (pawn?.role === "follower") {
      const ordinal =
        followerOrdinalByPawnId instanceof Map
          ? followerOrdinalByPawnId.get(pawn.id)
          : null;
      return ordinal != null ? `F${ordinal}` : "F";
    }
    return pawn?.name || "";
  }

  function drawPawnShape(gfx, { isLeader, radius }) {
    if (isLeader) {
      gfx.drawPolygon([0, -radius, radius, 0, 0, radius, -radius, 0]);
      return;
    }
    gfx.drawCircle(0, 0, radius);
  }

  function updateStaminaVisual(view, pawn) {
    if (!view?.staminaMask || !Number.isFinite(view?.shapeRadius)) return;
    const ratio = getStaminaRatio(pawn);
    if (view.staminaRatio === ratio) {
      view.redGlow.visible = ratio <= 0;
      return;
    }

    const radius = view.shapeRadius;
    const diameter = radius * 2;
    const filledHeight = diameter * ratio;
    const yTop = radius - filledHeight;

    view.staminaMask.clear();
    if (filledHeight > 0.0001) {
      view.staminaMask.beginFill(0xffffff, 1);
      view.staminaMask.drawRect(-radius - 2, yTop, diameter + 4, filledHeight + 1);
      view.staminaMask.endFill();
    }

    view.redGlow.visible = ratio <= 0;
    view.staminaRatio = ratio;
  }

  // ---------------------------------------------------------------------------
  // Layout helper: fan pawns when multiple occupy a slot
  // ---------------------------------------------------------------------------
  function layoutAllPawns(pawnsInput = null) {
    const pawns = Array.isArray(pawnsInput) ? pawnsInput : getPawnsSafe();

    const draggedPayload = interactionSafe.getDragged
      ? interactionSafe.getDragged()
      : null;

    const draggedId =
      draggedPayload && draggedPayload.type === "pawn"
        ? draggedPayload.id
        : null;

    /** @type {Map<string, { row: string, col: number, list: Array<any> }>} */
    const slotsToPawns = new Map();

    for (const pawn of pawns) {
      let placement = null;
      if (typeof getPreviewPlacement === "function") {
        placement = getPreviewPlacement(pawn.id);
      } else if (typeof getPreviewHubCol === "function") {
        const overrideIdx = getPreviewHubCol(pawn.id);
        if (overrideIdx != null) placement = { hubCol: overrideIdx };
      }

      const envCol = placement
        ? Number.isFinite(placement.envCol)
          ? placement.envCol
          : null
        : Number.isFinite(pawn.envCol)
        ? pawn.envCol
        : null;
      const hubCol = placement
        ? Number.isFinite(placement.hubCol)
          ? placement.hubCol
          : null
        : Number.isFinite(pawn.hubCol)
        ? pawn.hubCol
        : null;

      const row = Number.isFinite(envCol)
        ? "env"
        : Number.isFinite(hubCol)
        ? "hub"
        : null;
      const col = Number.isFinite(envCol) ? envCol : hubCol;
      if (row == null || col == null) continue;

      const key = `${row}:${col}`;
      let entry = slotsToPawns.get(key);
      if (!entry) {
        entry = { row, col, list: [] };
        slotsToPawns.set(key, entry);
      }
      entry.list.push(pawn);
    }

    for (const entry of slotsToPawns.values()) {
      const base =
        entry.row === "env"
          ? getBasePosForEnvCol(entry.col)
          : getBasePosForHubCol(entry.col);
      const hoverInfo = getHoverInfoForSlot(entry.row, entry.col);
      const n = entry.list.length;
      if (n === 0) continue;

      const startOffset = -((n - 1) * FAN_SPACING) / 2;

      entry.list.forEach((pawn, i) => {
        if (draggedId != null && draggedId === pawn.id) return;

        const view = viewsById.get(pawn.id);
        if (!view) return;
        const rawPos = {
          x: base.x + startOffset + i * FAN_SPACING,
          y: base.y,
        };
        const scaledPos = applyHoverTransform(rawPos, hoverInfo);
        view.container.x = scaledPos.x;
        view.container.y = scaledPos.y;
        view.attachedScale = scaledPos.scale;
        applyPawnScale(view);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Create a single pawn view
  // ---------------------------------------------------------------------------
  function createPawnView(pawn, followerOrdinalByPawnId = null) {
    const container = new PIXI.Container();
    const shadowLayer = new PIXI.Container();
    const paintLayer = new PIXI.Container();
    const inkLayer = new PIXI.Container();

    const pos = Number.isFinite(pawn.envCol)
      ? getBasePosForEnvCol(pawn.envCol)
      : getBasePosForHubCol(pawn.hubCol);
    container.x = pos.x;
    container.y = pos.y;

    container.eventMode = "static";
    container.cursor = "pointer";
    container.addChild(shadowLayer, paintLayer, inkLayer);

    const fillColor = typeof pawn.color === "number" ? pawn.color : 0xaa66ff;
    const isLeader = pawn?.role === "leader";
    const leaderRadius = Math.round(RADIUS * LEADER_DIAMOND_SCALE);
    const shapeRadius = isLeader ? leaderRadius : RADIUS;

    const shadow = new PIXI.Graphics().beginFill(
      GAMEPIECE_SHADOW_COLOR,
      GAMEPIECE_SHADOW_ALPHA
    );
    if (isLeader) {
      const r = leaderRadius + 2;
      shadow.drawPolygon([
        GAMEPIECE_SHADOW_OFFSET_X,
        -r + GAMEPIECE_SHADOW_OFFSET_Y,
        r + GAMEPIECE_SHADOW_OFFSET_X,
        GAMEPIECE_SHADOW_OFFSET_Y,
        GAMEPIECE_SHADOW_OFFSET_X,
        r + GAMEPIECE_SHADOW_OFFSET_Y,
        -r + GAMEPIECE_SHADOW_OFFSET_X,
        GAMEPIECE_SHADOW_OFFSET_Y,
      ]);
    } else {
      shadow.drawCircle(
        GAMEPIECE_SHADOW_OFFSET_X,
        GAMEPIECE_SHADOW_OFFSET_Y,
        RADIUS + 2
      );
    }
    shadow.endFill();
    shadow.alpha = 0;
    shadow.visible = false;
    shadowLayer.addChild(shadow);

    const redGlow = new PIXI.Graphics().beginFill(0xff2f3a, 0.28);
    drawPawnShape(redGlow, { isLeader, radius: shapeRadius + 6 });
    redGlow.endFill();
    redGlow.visible = false;
    paintLayer.addChild(redGlow);

    const dragGlow = new PIXI.Graphics().beginFill(
      INVENTORY_DRAG_VALID_OUTLINE,
      INVENTORY_DRAG_GLOW_ALPHA
    );
    drawPawnShape(dragGlow, { isLeader, radius: shapeRadius + 4 });
    dragGlow.endFill();
    dragGlow.visible = false;
    paintLayer.addChild(dragGlow);

    const dimBg = new PIXI.Graphics().beginFill(dimColor(fillColor), 1);
    drawPawnShape(dimBg, { isLeader, radius: shapeRadius });
    dimBg.endFill();
    paintLayer.addChild(dimBg);

    const staminaFill = new PIXI.Graphics().beginFill(fillColor, 1);
    drawPawnShape(staminaFill, { isLeader, radius: shapeRadius });
    staminaFill.endFill();
    paintLayer.addChild(staminaFill);

    const staminaMask = new PIXI.Graphics();
    paintLayer.addChild(staminaMask);
    staminaFill.mask = staminaMask;

    const focusOutline = new PIXI.Graphics();
    focusOutline.visible = false;
    inkLayer.addChild(focusOutline);

    const outline = new PIXI.Graphics().lineStyle(2, 0x000000, 1);
    drawPawnShape(outline, { isLeader, radius: shapeRadius + 1 });
    inkLayer.addChild(outline);

    const label = new PIXI.Text(getLabelForPawn(pawn, followerOrdinalByPawnId), {
      fill: 0xffffff,
      fontSize: 16,
      fontWeight: "bold",
    });
    applyTextResolution(label, 1);
    label.anchor.set(0.5);
    inkLayer.addChild(label);

    const flashRing = new PIXI.Graphics();
    flashRing.visible = false;
    inkLayer.addChild(flashRing);

    const workerBadge = new PIXI.Container();
    workerBadge.visible = false;
    workerBadge.x = shapeRadius - 4;
    workerBadge.y = -shapeRadius + 4;
    inkLayer.addChild(workerBadge);

    const workerBadgeBg = new PIXI.Graphics();
    workerBadge.addChild(workerBadgeBg);

    const workerBadgeText = new PIXI.Text("0", {
      fill: 0xffffff,
      fontSize: 10,
      fontWeight: "bold",
    });
    applyTextResolution(workerBadgeText, 1);
    workerBadgeText.anchor.set(0.5);
    workerBadge.addChild(workerBadgeText);

    layer.addChild(container);
    registerPaintContainer(paintLayer);

    // -----------------------------------------------------------------------
    const view = {
      container,
      pawn,
      isLeader,
      focusOutline,
      outline,
      shadow,
      redGlow,
      dragGlow,
      flashRing,
      workerBadge,
      workerBadgeBg,
      workerBadgeText,
      flashTimeout: null,
      selfHover: false,
      selfHoverScaleApplied: 1,
      selfHoverScaleTarget: 1,
      hoverShadowAlphaApplied: 0,
      hoverShadowAlphaTarget: 0,
      attachedScale: 1,
      hoverParent: null,
      hoverIndex: null,
      label,
      staminaMask,
      shapeRadius,
      staminaRatio: null,
      paintLayer,
      clearHover: null,
      cancelLongPress: null,
      inventoryDragAffordance:
        inventoryDragAffordanceByOwnerId.get(normalizeInventoryDragOwnerId(pawn.id)) ?? null,
    };

    // -----------------------------------------------------------------------
    // Hover UI
    // -----------------------------------------------------------------------
    function showHover() {
      const pawnData = view.pawn || pawn;
      if (!canShowGamepieceHoverUiNow()) return;
      view.selfHover = true;
      const canZoomIn = shouldAllowPawnHoverZoomIn(view);
      view.selfHoverScaleTarget = canZoomIn ? GAMEPIECE_HOVER_SCALE : 1;
      view.hoverShadowAlphaTarget = canZoomIn ? 1 : 0;
      applyPawnScale(view);

      const tt = getTooltipSafe();
      const scale = getEffectiveScale(view);
      const anchor = buildPawnHoverAnchor(view);
      tt?.show?.({ ...makePawnTooltipSpec(pawnData, getStateSafe()), scale }, anchor);

      const inv = getInvSafe();
      inv?.showOnHover?.(pawnData.id, anchor);

      const placement = getHoverPlacementForPawn(pawnData);
      interactionSafe.setHoveredPawn?.({
        kind: "pawn",
        id: pawnData.id,
        envCol: placement.envCol,
        hubCol: placement.hubCol,
        centerX: container.x,
        centerY: container.y,
        scale,
      });
    }

    function hideHover() {
      view.selfHover = false;
      view.selfHoverScaleTarget = 1;
      view.hoverShadowAlphaTarget = 0;
      const inv = getInvSafe();
      inv?.hideOnHoverOut?.(pawn.id);

      const tt = getTooltipSafe();
      tt?.hide?.();
      interactionSafe.clearHoveredPawn?.();
    }

    container.on("pointerover", () => {
      if (interactionSafe.isDragging && interactionSafe.isDragging()) return;
      showHover();
    });

    container.on("pointerout", () => {
      if (interactionSafe.isDragging && interactionSafe.isDragging()) return;
      hideHover();
    });

    const pawnLongPress = bindTouchLongPress({
      app,
      target: container,
      shouldStart: () => {
        if (interactionSafe.isDragging && interactionSafe.isDragging()) {
          return false;
        }
        return canShowGamepieceHoverUiNow();
      },
      onLongPress: () => {
        if (interactionSafe.isDragging && interactionSafe.isDragging()) return;
        showHover();
      },
      onEnd: () => {
        if (interactionSafe.isDragging && interactionSafe.isDragging()) return;
        hideHover();
      },
    });
    view.clearHover = hideHover;
    view.cancelLongPress = () => {
      pawnLongPress.cancel?.();
    };

    // -----------------------------------------------------------------------
    // Dragging logic
    // -----------------------------------------------------------------------
    let pointerDownPos = null;
    let dragging = false;
    let dragOffset = null;

    container.on("pointerdown", (ev) => {
      if (
        interactionSafe.canDragPawn &&
        !interactionSafe.canDragPawn()
      ) {
        flashDragBlocked(view);
        return;
      }

      const g = ev.data.global;
      pointerDownPos = { x: g.x, y: g.y };
      const local = toContainerParentLocal(container, g);
      if (!local) return;
      dragOffset = { x: container.x - local.x, y: container.y - local.y };

      app.stage.on("pointermove", onMove);
      app.stage.on("pointerup", onUp);
      app.stage.on("pointerupoutside", onUp);
    });

    function tryStartDrag() {
      const pawnData = view.pawn || pawn;
      dragging = true;
      resetDragGhostCache();
      interactionSafe.startDrag?.({ type: "pawn", id: pawnData.id });
      requestPauseForAction?.();
      view.selfHover = false;
      view.selfHoverScaleTarget = 1;
      view.selfHoverScaleApplied = 1;
      view.hoverShadowAlphaTarget = 0;
      setPawnHoverShadowAlpha(view, 0);
      view.attachedScale = 1;
      applyPawnScale(view);
      hideHover();
      if (pointerDownPos) {
        updatePawnDragGhost(pawnData, pointerDownPos);
      }
    }

    function onMove(ev) {
      const pawnData = view.pawn || pawn;
      if (!pointerDownPos) return;

      const g = ev.data.global;
      const dx = g.x - pointerDownPos.x;
      const dy = g.y - pointerDownPos.y;

      if (
        !dragging &&
        dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
      ) {
        tryStartDrag();
      }

      if (!dragging) return;

      const local = toContainerParentLocal(container, g);
      if (!local) return;
      container.x = local.x + dragOffset.x;
      container.y = local.y + dragOffset.y;
      updatePawnDragGhost(pawnData, g);
    }

    function onUp(ev) {
      if (!pointerDownPos) return;

      app.stage.off("pointermove", onMove);
      app.stage.off("pointerup", onUp);
      app.stage.off("pointerupoutside", onUp);

      const wasDragging = dragging;
      dragging = false;

      pointerDownPos = null;

      interactionSafe.endDrag?.();

      const g = ev.data.global;
      resetDragGhostCache();

      if (pawnLongPress.consumeTap()) {
        hideHover();
        if (typeof setDragGhost === "function") {
          setDragGhost(null);
        }
        return;
      }

      if (!wasDragging) {
        const pawnData = view.pawn || pawn;
        onPawnClicked?.({ pawnId: pawnData.id });
        // click -> toggle pinned inventory (optional)
        const inv = getInvSafe();
        inv?.togglePinned?.(pawnData.id);
        if (typeof setDragGhost === "function") {
          setDragGhost(null);
        }
        return;
      }

      const pawnData = view.pawn || pawn;
      const dropResult = emitDropped({
        pawnId: pawnData.id,
        dropPos: { x: g.x, y: g.y },
      });

      // If no handler, restore layout.
      if (!onPawnDropped) {
        layoutAllPawns();
        if (typeof setDragGhost === "function") {
          setDragGhost(null);
        }
        return;
      }

      // For insufficient AP, give the same blocked-drag feedback.
      if (
        dropResult &&
        dropResult.ok === false &&
        dropResult.reason === "insufficientAP"
      ) {
        flashDragBlocked(view);
        layoutAllPawns();
        resolveDragGhost?.("fail");
        return;
      }

      if (dropResult && dropResult.ok === false) {
        resolveDragGhost?.("fail");
      } else if (dropResult && (dropResult.ok === true || dropResult.queued)) {
        resolveDragGhost?.("success");
      } else if (typeof setDragGhost === "function") {
        setDragGhost(null);
      }
    }

    applyPawnScale(view);
    updateStaminaVisual(view, pawn);
    viewsById.set(pawn.id, view);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function removePawnView(pawnId) {
    const view = viewsById.get(pawnId);
    if (!view) return;
    if (view.selfHover) {
      view.clearHover?.();
    }
    view.cancelLongPress?.();
    if (view.flashTimeout) {
      clearTimeout(view.flashTimeout);
      view.flashTimeout = null;
    }
    if (view.container?.parent) {
      view.container.parent.removeChild(view.container);
    }
    unregisterPaintContainer(view.paintLayer);
    view.container?.removeAllListeners?.();
    view.container?.destroy?.({ children: true });
    viewsById.delete(pawnId);
  }

  function syncPawnViews(pawns, followerOrdinalByPawnId = null) {
    const liveIds = new Set();
    for (const pawn of pawns || []) {
      const pawnId = pawn?.id;
      if (pawnId == null) continue;
      liveIds.add(pawnId);
      const existing = viewsById.get(pawnId);
      if (existing) {
        existing.pawn = pawn;
      } else {
        createPawnView(pawn, followerOrdinalByPawnId);
      }
    }

    const stale = [];
    for (const [pawnId] of viewsById.entries()) {
      if (!liveIds.has(pawnId)) stale.push(pawnId);
    }
    for (const pawnId of stale) {
      removePawnView(pawnId);
    }
  }

  function rebuildAll() {
    const existingIds = Array.from(viewsById.keys());
    for (const pawnId of existingIds) {
      removePawnView(pawnId);
    }

    const pawns = getPawnsSafe();
    const followerOrdinalByPawnId = getFollowerOrdinalByPawnId(pawns);
    for (const pawn of pawns) {
      createPawnView(pawn, followerOrdinalByPawnId);
    }

    if (focusGhost && focusGhost.parent) {
      focusGhost.parent.removeChild(focusGhost);
    }
    focusGhost = null;

    layoutAllPawns(pawns);
  }

  function updatePositionsFromModel() {
    const pawns = getPawnsSafe();
    const followerOrdinalByPawnId = getFollowerOrdinalByPawnId(pawns);
    syncPawnViews(pawns, followerOrdinalByPawnId);
    layoutAllPawns(pawns);
  }

  function init() {}

  function updateFocus() {
    const intent =
      typeof getFocusIntent === "function" ? getFocusIntent() : null;
    const external =
      typeof getExternalFocus === "function" ? getExternalFocus() : null;
    const externalFocused =
      external?.kind === "pawn" && Number.isFinite(external?.pawnId)
        ? Math.floor(external.pawnId)
        : null;
    const nextFocused =
      intent && intent.kind === "pawnMove" ? intent.pawnId : null;
    const resolvedFocused = nextFocused ?? externalFocused;
    if (focusedPawnId !== resolvedFocused) {
      focusedPawnId = resolvedFocused;
    }

    for (const [id, view] of viewsById.entries()) {
      const isFocused = focusedPawnId != null && id === focusedPawnId;
      applyPawnAffordanceVisual(view, isFocused);
    }

    if (intent && intent.kind === "pawnMove") {
      const fromHub = intent.fromPlacement?.hubCol;
      const fromEnv = intent.fromPlacement?.envCol;
      if (fromHub != null || fromEnv != null) {
        const pos =
          fromEnv != null
            ? getBasePosForEnvCol(fromEnv)
            : getBasePosForHubCol(fromHub);
        if (!focusGhost) {
          focusGhost = new PIXI.Graphics();
          focusGhost.lineStyle(2, 0x7fd0ff, 1);
          focusGhost.beginFill(0xffffff, 0.2);
          focusGhost.drawCircle(0, 0, RADIUS);
          focusGhost.endFill();
          focusGhost.zIndex = 1;
          layer.addChild(focusGhost);
        }
        focusGhost.visible = true;
        focusGhost.x = pos.x;
        focusGhost.y = pos.y;
      } else if (focusGhost) {
        focusGhost.visible = false;
      }
    } else if (focusGhost) {
      focusGhost.visible = false;
    }
  }

  function update(dt) {
    const pawns = getPawnsSafe();
    const followerOrdinalByPawnId = getFollowerOrdinalByPawnId(pawns);
    syncPawnViews(pawns, followerOrdinalByPawnId);
    layoutAllPawns(pawns);
    for (const view of viewsById.values()) {
      const nextLabel = getLabelForPawn(view.pawn, followerOrdinalByPawnId);
      if (view.label && view.label.text !== nextLabel) {
        view.label.text = nextLabel;
      }
      if (animatePawnSelfHoverScale(view, dt)) {
        applyPawnScale(view);
      }
      if (animatePawnHoverShadowAlpha(view, dt)) {
        applyPawnScale(view);
      }
      if (view.selfHover) {
        if (!canShowGamepieceHoverUiNow()) {
          view.clearHover?.();
          continue;
        }
        const canZoomIn = shouldAllowPawnHoverZoomIn(view);
        view.selfHoverScaleTarget = canZoomIn ? GAMEPIECE_HOVER_SCALE : 1;
        view.hoverShadowAlphaTarget = canZoomIn ? 1 : 0;
      }
      if (view.selfHover) {
        const scale = getEffectiveScale(view);
        const anchor = buildPawnHoverAnchor(view);
        const pawnData = view.pawn;
        getTooltipSafe()?.show?.({
          ...makePawnTooltipSpec(pawnData, getStateSafe()),
          scale,
        }, anchor);
        getInvSafe()?.showOnHover?.(pawnData?.id, anchor);
        const placement = getHoverPlacementForPawn(pawnData);
        interactionSafe.setHoveredPawn?.({
          kind: "pawn",
          id: pawnData?.id,
          envCol: placement.envCol,
          hubCol: placement.hubCol,
          centerX: view.container.x,
          centerY: view.container.y,
          scale,
        });
      }
      if (view.workerBadge && view.workerBadgeBg && view.workerBadgeText) {
        const workerCount = Number.isFinite(view?.pawn?.workerCount)
          ? Math.max(0, Math.floor(view.pawn.workerCount))
          : 0;
        view.workerBadge.visible = view?.pawn?.role === "leader" && workerCount > 0;
        if (view.workerBadge.visible) {
          view.workerBadgeText.text = String(workerCount);
          const radius = Math.max(8, Math.ceil(view.workerBadgeText.width / 2) + 4);
          view.workerBadgeBg.clear();
          view.workerBadgeBg.beginFill(0x232323, 0.95);
          view.workerBadgeBg.lineStyle(1.5, 0xf2d16b, 1);
          view.workerBadgeBg.drawCircle(0, 0, radius);
          view.workerBadgeBg.endFill();
          view.workerBadgeText.x = 0;
          view.workerBadgeText.y = 0;
        }
      }
      updateStaminaVisual(view, view.pawn);
    }
    updateFocus();
  }

  function setInventoryDragAffordances(nextAffordances = null) {
    inventoryDragAffordanceByOwnerId.clear();
    if (nextAffordances instanceof Map) {
      for (const [ownerId, level] of nextAffordances.entries()) {
        if (ownerId == null || level == null) continue;
        inventoryDragAffordanceByOwnerId.set(normalizeInventoryDragOwnerId(ownerId), level);
      }
    }
    for (const [ownerId, view] of viewsById.entries()) {
      view.inventoryDragAffordance =
        inventoryDragAffordanceByOwnerId.get(normalizeInventoryDragOwnerId(ownerId)) ?? null;
    }
    updateFocus();
  }

  function getInventoryOwnerAtGlobalPos(globalPos) {
    if (!globalPos) return null;
    const state = getStateSafe();
    const inventories = state?.ownerInventories || null;
    if (!inventories) return null;

    for (const view of viewsById.values()) {
      if (!view?.container?.visible) continue;
      const ownerId = view?.pawn?.id ?? null;
      if (ownerId == null) continue;
      if (!inventories[ownerId]) continue;
      const bounds = view.container.getBounds();
      if (
        globalPos.x >= bounds.x &&
        globalPos.x <= bounds.x + bounds.width &&
        globalPos.y >= bounds.y &&
        globalPos.y <= bounds.y + bounds.height
      ) {
        return {
          ownerId,
          anchor: {
            coordinateSpace: "screen",
            getAnchorRect: () => view.container?.getBounds?.() ?? null,
          },
        };
      }
    }

    return null;
  }

  return {
    init,
    rebuildAll,
    update,
    updatePositionsFromModel,
    hasActiveHoverZoomDown,
    getViewForId: (id) => viewsById.get(id) || null,
    setInventoryDragAffordances,
    getInventoryOwnerAtGlobalPos,
  };
}


