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
import {
  getPawnBubbleSpecs,
  makePawnInfocardSpec,
} from "./pawn-tooltip-spec.js";
import {
  LEADER_EQUIPMENT_SLOT_LABELS,
  LEADER_EQUIPMENT_SLOT_ORDER,
} from "../defs/gamesystems/equipment-slot-defs.js";
import { getLeaderInventorySectionCapabilities } from "../model/skills.js";
import { MUCHA_UI_COLORS } from "./ui-helpers/mucha-ui-palette.js";

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
    openSkillTree,
  } = opts;

  const viewsById = new Map();
  const DRAG_THRESHOLD_PX = 3;
  const DRAG_GHOST_REFRESH_MS = 50;
  const FAN_SPACING = 40;
  const RADIUS = 20;
  const PAWN_HOVER_ZINDEX = 40;
  const LEADER_DIAMOND_SCALE = 1.15;
  const INVENTORY_DRAG_VALID_OUTLINE = 0x58c7ff;
  const INVENTORY_DRAG_FULL_OUTLINE = 0xffa24f;
  const INVENTORY_DRAG_HOVER_OUTLINE = 0x6bd37b;
  const INVENTORY_DRAG_GLOW_ALPHA = 0.24;
  const PAWN_UI_LAYOUT = Object.freeze({
    dropdownWidth: 216,
    dropdownOffsetX: -108,
    dropdownOffsetY: 10,
    tooltipGap: 18,
    inventoryGap: 18,
    bubbleRadius: 20,
    bubbleTopY: -30,
    bubbleSideX: 50,
    bubbleSideY: 0,
    dropdownHideDelayMs: 260,
    inventoryAnchorInternalOffset: 10,
    tooltipAnchorInternalOffset: 14,
  });
  const DROPDOWN_HIDE_DELAY_MS = PAWN_UI_LAYOUT.dropdownHideDelayMs;
  const BUBBLE_RADIUS = PAWN_UI_LAYOUT.bubbleRadius;
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

  function getPawnDropdownSectionCapabilities(state, pawnData) {
    if (!pawnData || pawnData.role !== "leader" || !Number.isFinite(pawnData.id)) {
      return {
        systems: false,
        equipment: false,
        skills: false,
        prestige: false,
        build: false,
      };
    }
    const leaderCaps = getLeaderInventorySectionCapabilities(state, Math.floor(pawnData.id));
    return {
      systems: leaderCaps.systems === true,
      equipment: leaderCaps.equipment === true,
      skills: leaderCaps.skills === true,
      prestige:
        leaderCaps.prestige === true || leaderCaps.workers === true,
      build: leaderCaps.build === true,
    };
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
    if (!view || !tooltipView) return null;
    return {
      coordinateSpace: "parent",
      getAnchorRect: () => getPawnAnchorRect(view, "parent"),
    };
  }

  function buildPawnScreenAnchor(view) {
    if (!view || !tooltipView) return null;
    return {
      coordinateSpace: "screen",
      getAnchorRect: () => getPawnAnchorRect(view, "screen"),
    };
  }

  function getPawnAnchorRect(view, coordinateSpace = "screen") {
    const container = view?.container;
    if (!container) return null;
    if (coordinateSpace === "screen") {
      const global =
        typeof container.getGlobalPosition === "function"
          ? container.getGlobalPosition(new PIXI.Point())
          : typeof container.parent?.toGlobal === "function"
            ? container.parent.toGlobal(container.position)
            : null;
      if (!global) return null;
      return {
        x: global.x,
        y: global.y,
        width: 0,
        height: 0,
        coordinateSpace: "screen",
      };
    }
    return {
      x: Number(container.x) || 0,
      y: Number(container.y) || 0,
      width: 0,
      height: 0,
      coordinateSpace: "parent",
    };
  }

  function buildPawnInventoryAnchor(view) {
    const baseAnchor = buildPawnHoverAnchor(view);
    if (!baseAnchor || typeof baseAnchor.getAnchorRect !== "function") return null;
    return {
      coordinateSpace: "parent",
      getAnchorRect: () => {
        const rect = baseAnchor.getAnchorRect?.();
        if (!rect) return null;
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const menuLeft = centerX + PAWN_UI_LAYOUT.dropdownOffsetX;
        const menuTop = centerY + PAWN_UI_LAYOUT.dropdownOffsetY;
        const desiredInventoryX =
          menuLeft + PAWN_UI_LAYOUT.dropdownWidth + PAWN_UI_LAYOUT.inventoryGap;
        return {
          x: desiredInventoryX - PAWN_UI_LAYOUT.inventoryAnchorInternalOffset,
          y: menuTop,
          width: 0,
          height: 0,
          coordinateSpace: "parent",
        };
      },
    };
  }

  function buildPawnTooltipAnchor(view) {
    const baseAnchor = buildPawnHoverAnchor(view);
    if (!baseAnchor || typeof baseAnchor.getAnchorRect !== "function") return null;
    return {
      coordinateSpace: "parent",
      side: "left",
      alignY: "top",
      getAnchorRect: () => {
        const rect = baseAnchor.getAnchorRect?.();
        if (!rect) return null;
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const menuLeft = centerX + PAWN_UI_LAYOUT.dropdownOffsetX;
        const menuTop = centerY + PAWN_UI_LAYOUT.dropdownOffsetY;
        return {
          x: menuLeft - PAWN_UI_LAYOUT.tooltipGap + PAWN_UI_LAYOUT.tooltipAnchorInternalOffset,
          y: menuTop,
          width: 0,
          height: 0,
          coordinateSpace: "parent",
          side: "left",
          alignY: "top",
        };
      },
    };
  }

  function summarizeAnchor(anchor) {
    if (!anchor || typeof anchor.getAnchorRect !== "function") return null;
    const rect = anchor.getAnchorRect?.();
    if (!rect) return null;
    return {
      x: Number(rect.x) || 0,
      y: Number(rect.y) || 0,
      width: Number(rect.width) || 0,
      height: Number(rect.height) || 0,
      coordinateSpace:
        rect.coordinateSpace === "screen" ? "screen" : "parent",
      side: rect.side === "right" ? "right" : "left",
      alignY: rect.alignY === "top" ? "top" : "center",
    };
  }

  function isPointInsideBounds(bounds, point, pad = 0) {
    if (!bounds || !point) return false;
    return (
      point.x >= bounds.x - pad &&
      point.x <= bounds.x + bounds.width + pad &&
      point.y >= bounds.y - pad &&
      point.y <= bounds.y + bounds.height + pad
    );
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
    const attachedScale = Number.isFinite(view?.attachedScale)
      ? view.attachedScale
      : 1;
    if (attachedScale > 1.001) return false;
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
    view.interactionLayer?.scale?.set?.(scale);
    view.shadowLayer?.scale?.set?.(scale);
    view.paintLayer?.scale?.set?.(scale);
    view.inkLayer?.scale?.set?.(scale);
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
    if (view.hoverHideTimeout) {
      clearTimeout(view.hoverHideTimeout);
      view.hoverHideTimeout = null;
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

  function getLiveHoverInfoForPawn(pawn) {
    const placement = getHoverPlacementForPawn(pawn);
    if (Number.isFinite(placement?.envCol)) {
      return getHoverInfoForSlot("env", placement.envCol);
    }
    if (Number.isFinite(placement?.hubCol)) {
      return getHoverInfoForSlot("hub", placement.hubCol);
    }
    return null;
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

  function formatPlacementLabel(placement, state) {
    const envCol = Number.isFinite(placement?.envCol) ? Math.floor(placement.envCol) : null;
    const hubCol = Number.isFinite(placement?.hubCol) ? Math.floor(placement.hubCol) : null;
    if (envCol != null) return formatTileName(envCol, state);
    if (hubCol != null) return formatHubName(hubCol, state);
    return "Unassigned";
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
        view.uiAnchorLocalX = rawPos.x;
        view.uiAnchorLocalY = rawPos.y;
        const lockedHoverInfo = view.selfHover ? view.lockedHoverInfo : null;
        const effectiveHoverInfo = lockedHoverInfo || hoverInfo;
        const scaledPos = applyHoverTransform(rawPos, effectiveHoverInfo);
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
  function countFollowersForLeader(leaderId) {
    const pawns = getPawnsSafe();
    let count = 0;
    for (const pawn of pawns) {
      if (pawn?.role === "follower" && String(pawn?.leaderId) === String(leaderId)) {
        count += 1;
      }
    }
    return count;
  }

  function stopPointerBubble(ev) {
    ev?.stopPropagation?.();
  }

  function getBubbleFillRatio(bubbleSpec) {
    return Number.isFinite(bubbleSpec?.fillRatio) ? clamp01(bubbleSpec.fillRatio) : 1;
  }

  function drawBubbleMeter(bubble, bubbleSpec) {
    if (!bubble) return;
    const color = Number.isFinite(bubbleSpec?.color) ? bubbleSpec.color : 0x8f7c60;
    const fillRatio = getBubbleFillRatio(bubbleSpec);
    const diameter = BUBBLE_RADIUS * 2;
    const fillHeight = Math.round(diameter * fillRatio);
    const fillTop = BUBBLE_RADIUS - fillHeight;

    bubble.bgGraphics.clear();
    bubble.bgGraphics.beginFill(dimColor(color, 0.34), 0.94);
    bubble.bgGraphics.drawCircle(0, 0, BUBBLE_RADIUS);
    bubble.bgGraphics.endFill();

    bubble.fillGraphics.clear();
    if (fillHeight > 0) {
      bubble.fillGraphics.beginFill(color, 0.98);
      bubble.fillGraphics.drawCircle(0, 0, BUBBLE_RADIUS);
      bubble.fillGraphics.endFill();
    }

    bubble.fillMask.clear();
    if (fillHeight > 0) {
      bubble.fillMask.beginFill(0xffffff, 1);
      bubble.fillMask.drawRect(
        -BUBBLE_RADIUS - 2,
        fillTop - 1,
        diameter + 4,
        fillHeight + 2
      );
      bubble.fillMask.endFill();
    }

    bubble.fillEdge.clear();
    if (fillRatio > 0 && fillRatio < 1) {
      bubble.fillEdge.lineStyle(1, 0xf8f0d6, 0.35);
      bubble.fillEdge.moveTo(-BUBBLE_RADIUS + 5, fillTop);
      bubble.fillEdge.lineTo(BUBBLE_RADIUS - 5, fillTop);
    }

    bubble.outlineGraphics.clear();
    bubble.outlineGraphics.lineStyle(2, 0x2d1a12, 1);
    bubble.outlineGraphics.drawCircle(0, 0, BUBBLE_RADIUS);
  }

  function redrawBubbleValueBadge(bubble, text) {
    if (!bubble?.valueBadgeBg || !bubble?.valueBadgeText) return;
    bubble.valueBadgeText.text = typeof text === "string" ? text : "";
    bubble.valueBadgeBg.clear();
    if (!bubble.valueBadgeText.text.length) return;
    const width = Math.max(28, Math.ceil(bubble.valueBadgeText.width) + 10);
    bubble.valueBadgeBg.beginFill(0x24160f, 0.96);
    bubble.valueBadgeBg.lineStyle(1, 0xf0d9a8, 0.65);
    bubble.valueBadgeBg.drawRoundedRect(0, 0, width, 16, 6);
    bubble.valueBadgeBg.endFill();
    bubble.valueBadgeText.x = Math.floor(width / 2);
    bubble.valueBadgeText.y = 8;
    bubble.valueBadge.x = -Math.floor(width / 2);
    bubble.valueBadge.y = -BUBBLE_RADIUS - 10;
  }

  function buildDropdownEquipmentLayout() {
    return {
      head: { x: 86, y: 14, w: 36, h: 30 },
      chest: { x: 80, y: 52, w: 48, h: 40 },
      mainHand: { x: 26, y: 56, w: 44, h: 36 },
      offHand: { x: 138, y: 56, w: 44, h: 36 },
      ring1: { x: 46, y: 102, w: 24, h: 20 },
      ring2: { x: 138, y: 102, w: 24, h: 20 },
      amulet: { x: 100, y: 100, w: 20, h: 20 },
    };
  }

  function createDropdownButton(label, onTap) {
    const button = new PIXI.Container();
    button.eventMode = "static";
    button.cursor = "pointer";
    button.on("pointerdown", stopPointerBubble);
    button.on("pointertap", (ev) => {
      stopPointerBubble(ev);
      onTap?.();
    });
    const bg = new PIXI.Graphics();
    button.addChild(bg);
    const text = new PIXI.Text(label, {
      fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
      fontSize: 10,
      fontWeight: "bold",
    });
    applyTextResolution(text, 1);
    text.x = 8;
    text.y = 4;
    button.addChild(text);
    button.redraw = (nextLabel = label) => {
      text.text = nextLabel;
      bg.clear();
      bg.beginFill(MUCHA_UI_COLORS?.surfaces?.header ?? 0x6a5a48, 0.98);
      bg.lineStyle(1, MUCHA_UI_COLORS?.surfaces?.borderSoft ?? 0xb59f78, 1);
      bg.drawRoundedRect(0, 0, Math.max(112, text.width + 16), 22, 6);
      bg.endFill();
    };
    button.redraw(label);
    return button;
  }

  function createPawnView(pawn, followerOrdinalByPawnId = null) {
    const container = new PIXI.Container();
    container.sortableChildren = true;
    const interactionLayer = new PIXI.Container();
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
    container.addChild(interactionLayer, shadowLayer, paintLayer, inkLayer);

    const fillColor = typeof pawn.color === "number" ? pawn.color : 0xaa66ff;
    const isLeader = pawn?.role === "leader";
    const leaderRadius = Math.round(RADIUS * LEADER_DIAMOND_SCALE);
    const shapeRadius = isLeader ? leaderRadius : RADIUS;
    const hoverPad = 12;
    const anchorTarget = new PIXI.Graphics();
    anchorTarget.eventMode = "static";
    anchorTarget.cursor = "pointer";
    anchorTarget.beginFill(0xffffff, 0.001);
    drawPawnShape(anchorTarget, { isLeader, radius: shapeRadius + hoverPad });
    anchorTarget.endFill();
    interactionLayer.addChild(anchorTarget);

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

    const bubbleLayer = new PIXI.Container();
    bubbleLayer.eventMode = "passive";
    bubbleLayer.y = -shapeRadius - 10;
    bubbleLayer.zIndex = 30;
    container.addChild(bubbleLayer);

    const dropdown = new PIXI.Container();
    dropdown.visible = false;
    dropdown.eventMode = "static";
    dropdown.cursor = "default";
    dropdown.x = PAWN_UI_LAYOUT.dropdownOffsetX;
    dropdown.y = PAWN_UI_LAYOUT.dropdownOffsetY;
    dropdown.zIndex = -20;
    dropdown.on("pointerdown", stopPointerBubble);
    dropdown.on("pointerenter", () => {
      if (view?.hoverHideTimeout) {
        clearTimeout(view.hoverHideTimeout);
        view.hoverHideTimeout = null;
      }
    });
    dropdown.on("pointerleave", () => {
      scheduleHoverHide();
    });
    container.addChild(dropdown);

    interactionLayer.zIndex = 5;
    shadowLayer.zIndex = 10;
    paintLayer.zIndex = 15;
    inkLayer.zIndex = 20;

    const dropdownBg = new PIXI.Graphics();
    dropdown.addChild(dropdownBg);

    const dropdownContent = new PIXI.Container();
    dropdown.addChild(dropdownContent);

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
      uiAnchorLocalX: pos.x,
      uiAnchorLocalY: pos.y,
      hoverParent: null,
      hoverIndex: null,
      lockedHoverInfo: null,
      label,
      staminaMask,
      shapeRadius,
      staminaRatio: null,
      paintLayer,
      interactionLayer,
      shadowLayer,
      inkLayer,
      anchorTarget,
      bubbleLayer,
      bubbleViews: new Map(),
      visibleBubbleIds: [],
      hoveredBubbleId: null,
      dropdown,
      dropdownBg,
      dropdownContent,
      dropdownSignature: "",
      bubbleSignature: "",
      hoverTooltipSignature: "",
      dropdownSectionState: isLeader
        ? { systems: false, equipment: false, skills: false, prestige: false, build: false }
        : { systems: false, assignment: false },
      equipmentSlotTargets: [],
      hoverHideTimeout: null,
      clearHover: null,
      cancelLongPress: null,
      renderDropdown: null,
      updateBubbleViews: null,
      refreshHoverUi: null,
      inventoryDragAffordance:
        inventoryDragAffordanceByOwnerId.get(normalizeInventoryDragOwnerId(pawn.id)) ?? null,
    };

    function drawDropdownBackground(width, height) {
      view.dropdownBg.clear();
      view.dropdownBg.beginFill(MUCHA_UI_COLORS?.surfaces?.panelDeep ?? 0x3b352d, 0.97);
      view.dropdownBg.lineStyle(2, MUCHA_UI_COLORS?.surfaces?.border ?? 0xb59f78, 1);
      view.dropdownBg.drawRoundedRect(0, 0, width, height, 10);
      view.dropdownBg.endFill();
    }

    function renderDropdownSectionHeader(parent, key, label, x, y, width) {
      const row = new PIXI.Container();
      row.x = x;
      row.y = y;
      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointerdown", stopPointerBubble);
      row.on("pointertap", (ev) => {
        stopPointerBubble(ev);
        view.dropdownSectionState[key] = view.dropdownSectionState[key] !== true;
        renderDropdown();
      });
      const bg = new PIXI.Graphics();
      bg.beginFill(MUCHA_UI_COLORS?.surfaces?.header ?? 0x6a5a48, 0.96);
      bg.lineStyle(1, MUCHA_UI_COLORS?.surfaces?.borderSoft ?? 0xb59f78, 1);
      bg.drawRoundedRect(0, 0, width, 22, 6);
      bg.endFill();
      row.addChild(bg);
      const arrow = new PIXI.Text(view.dropdownSectionState[key] === true ? "v" : ">", {
        fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
        fontSize: 10,
        fontWeight: "bold",
      });
      applyTextResolution(arrow, 1);
      arrow.x = 8;
      arrow.y = 4;
      row.addChild(arrow);
      const text = new PIXI.Text(label, {
        fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
        fontSize: 10,
        fontWeight: "bold",
      });
      applyTextResolution(text, 1);
      text.x = 22;
      text.y = 4;
      row.addChild(text);
      parent.addChild(row);
      return row;
    }

    function renderDropdown() {
      const pawnData = view.pawn || pawn;
      const state = getStateSafe();
      const sectionCaps =
        pawnData?.role === "leader"
          ? getPawnDropdownSectionCapabilities(state, pawnData)
          : null;
      if (sectionCaps) {
        if (!sectionCaps.systems) view.dropdownSectionState.systems = false;
        if (!sectionCaps.equipment) view.dropdownSectionState.equipment = false;
        if (!sectionCaps.skills) view.dropdownSectionState.skills = false;
        if (!sectionCaps.prestige) view.dropdownSectionState.prestige = false;
        if (!sectionCaps.build) view.dropdownSectionState.build = false;
      }
      const dropdownSignature = JSON.stringify({
        hover: view.selfHover === true,
        pawnId: pawnData?.id ?? null,
        name: pawnData?.name ?? "",
        role: pawnData?.role ?? "",
        mode: pawnData?.ai?.mode ?? "",
        returnState: pawnData?.ai?.returnState ?? "",
        assignedPlacement: pawnData?.ai?.assignedPlacement ?? null,
        systems: getPawnBubbleSpecs(pawnData, state, { hoverActive: true }).map((bubble) => ({
          id: bubble.systemId,
          shortLabel: bubble.shortLabel,
          label: bubble.label,
          value:
            bubble.systemId === "leaderFaith"
              ? pawnData?.leaderFaith?.tier ?? "gold"
              : `${Math.round(pawnData?.systemState?.[bubble.systemId]?.cur ?? 0)}/${Math.round(
                  pawnData?.systemState?.[bubble.systemId]?.max ?? 0
                )}`,
        })),
        equipment: LEADER_EQUIPMENT_SLOT_ORDER.map((slotId) => ({
          slotId,
          itemId: pawnData?.equipment?.[slotId]?.id ?? null,
          itemKind: pawnData?.equipment?.[slotId]?.kind ?? null,
        })),
        skillPoints: pawnData?.skillPoints ?? 0,
        unlockedSkillNodeIds: Array.isArray(pawnData?.unlockedSkillNodeIds)
          ? pawnData.unlockedSkillNodeIds.slice(0, 5)
          : [],
        workerCount: pawnData?.workerCount ?? 0,
        faithTier: pawnData?.leaderFaith?.tier ?? "gold",
        sectionState: view.dropdownSectionState,
        followerCount: pawnData?.role === "leader" ? countFollowersForLeader(pawnData.id) : 0,
        sectionCaps,
      });
      if (view.dropdownSignature === dropdownSignature) {
        view.dropdown.visible = view.selfHover === true;
        return;
      }
      view.dropdownSignature = dropdownSignature;
      view.dropdownContent.removeChildren();
      view.equipmentSlotTargets = [];
      let cursorY = 10;
      const width = PAWN_UI_LAYOUT.dropdownWidth;
      const innerWidth = width - 16;
      view.dropdown.x = PAWN_UI_LAYOUT.dropdownOffsetX;
      view.dropdown.y = PAWN_UI_LAYOUT.dropdownOffsetY;

      const title = new PIXI.Text(pawnData?.name || `Pawn ${pawnData?.id ?? ""}`, {
        fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
        fontSize: 15,
        fontWeight: "bold",
      });
      applyTextResolution(title, 1);
      title.x = 8;
      title.y = cursorY;
      view.dropdownContent.addChild(title);
      cursorY += title.height + 8;

      const showLeaderSection = (key) =>
        pawnData?.role === "leader" && sectionCaps?.[key] === true;

      if (pawnData?.role !== "leader" || showLeaderSection("systems")) {
        renderDropdownSectionHeader(view.dropdownContent, "systems", "Systems", 8, cursorY, innerWidth);
        cursorY += 26;
        if (view.dropdownSectionState.systems === true) {
          for (const bubble of getPawnBubbleSpecs(pawnData, state, { hoverActive: true })) {
            const line = new PIXI.Text(
              `${bubble.label}: ${
                bubble.systemId === "leaderFaith"
                  ? pawnData?.leaderFaith?.tier ?? "gold"
                  : `${Math.round(pawnData?.systemState?.[bubble.systemId]?.cur ?? 0)}/${Math.round(
                      pawnData?.systemState?.[bubble.systemId]?.max ?? 0
                    )}`
              }`,
              {
                fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
                fontSize: 10,
              }
            );
            applyTextResolution(line, 1);
            line.x = 14;
            line.y = cursorY;
            view.dropdownContent.addChild(line);
            cursorY += line.height + 3;
          }
          cursorY += 4;
        }
      }

      if (pawnData?.role === "leader") {
        if (showLeaderSection("equipment")) {
          renderDropdownSectionHeader(view.dropdownContent, "equipment", "Equipment", 8, cursorY, innerWidth);
          cursorY += 26;
        }
        if (showLeaderSection("equipment") && view.dropdownSectionState.equipment === true) {
          const equipContainer = new PIXI.Container();
          equipContainer.x = 12;
          equipContainer.y = cursorY;
          view.dropdownContent.addChild(equipContainer);
          const equipment = pawnData?.equipment && typeof pawnData.equipment === "object" ? pawnData.equipment : {};
          const layout = buildDropdownEquipmentLayout();
          for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
            const slotLayout = layout[slotId];
            if (!slotLayout) continue;
            const slot = new PIXI.Container();
            slot.x = slotLayout.x;
            slot.y = slotLayout.y;
            slot.eventMode = "static";
            slot.cursor = "default";
            slot.on("pointerdown", stopPointerBubble);
            equipContainer.addChild(slot);
            const slotBg = new PIXI.Graphics();
            slotBg.lineStyle(1, MUCHA_UI_COLORS?.surfaces?.borderSoft ?? 0xb59f78, 1);
            slotBg.beginFill(MUCHA_UI_COLORS?.surfaces?.panel ?? 0x53493f, 0.92);
            slotBg.drawRoundedRect(0, 0, slotLayout.w, slotLayout.h, 6);
            slotBg.endFill();
            slot.addChild(slotBg);
            const slotLabel = new PIXI.Text(LEADER_EQUIPMENT_SLOT_LABELS[slotId] || slotId, {
              fill: MUCHA_UI_COLORS?.ink?.muted ?? 0xc9bba5,
              fontSize: 8,
            });
            applyTextResolution(slotLabel, 1);
            slotLabel.x = 2;
            slotLabel.y = slotLayout.h + 1;
            slot.addChild(slotLabel);
            const item = equipment?.[slotId] ?? null;
            if (item) {
              const itemView = new PIXI.Container();
              itemView.ownerId = pawnData.id;
              itemView.sourceEquipmentSlotId = slotId;
              itemView.itemData = item;
              itemView.eventMode = "static";
              itemView.cursor = "pointer";
              itemView.on("pointerdown", (ev) => {
                stopPointerBubble(ev);
                const g = ev?.data?.global;
                if (!g) return;
                getInvSafe()?.beginDragExternalEquippedItem?.({
                  ownerId: pawnData.id,
                  item,
                  sourceEquipmentSlotId: slotId,
                  view: itemView,
                  globalPos: g,
                  pointerType: ev?.data?.pointerType ?? null,
                });
              });
              itemView.on("pointerover", () => {
                const spec = getInvSafe()?.getItemTooltipSpec?.(item, pawnData.id) ?? null;
                if (!spec) return;
                getTooltipSafe()?.show?.(
                  spec,
                  {
                    coordinateSpace: "parent",
                    getAnchorRect: () =>
                      tooltipView.getAnchorRectForDisplayObject?.(itemView, "parent") ?? null,
                  }
                );
              });
              itemView.on("pointerout", () => {
                if (!view.hoveredBubbleId) {
                  getTooltipSafe()?.show?.(makePawnInfocardSpec(pawnData, state), buildPawnTooltipAnchor(view));
                }
              });
              const itemBg = new PIXI.Graphics();
              itemBg.beginFill(item?.color ?? 0x8f7c60, 0.98);
              itemBg.drawRoundedRect(2, 2, slotLayout.w - 4, slotLayout.h - 4, 5);
              itemBg.endFill();
              itemView.addChild(itemBg);
              const glyph = new PIXI.Text(String(item?.kind ?? "?").slice(0, 2), {
                fill: 0xffffff,
                fontSize: 12,
                fontWeight: "bold",
              });
              applyTextResolution(glyph, 1);
              glyph.anchor.set(0.5);
              glyph.x = Math.floor(slotLayout.w / 2);
              glyph.y = Math.floor(slotLayout.h / 2) - 1;
              itemView.addChild(glyph);
              slot.addChild(itemView);
            }
            view.equipmentSlotTargets.push({
              ownerId: pawnData.id,
              slotId,
              displayObject: slot,
            });
          }
          cursorY += 134;
        }

        if (showLeaderSection("skills")) {
          renderDropdownSectionHeader(view.dropdownContent, "skills", "Skills", 8, cursorY, innerWidth);
          cursorY += 26;
        }
        if (showLeaderSection("skills") && view.dropdownSectionState.skills === true) {
          const skillPoints = Number.isFinite(pawnData?.skillPoints)
            ? Math.max(0, Math.floor(pawnData.skillPoints))
            : 0;
          const text = new PIXI.Text(`Skill Points: ${skillPoints}`, {
            fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
            fontSize: 10,
          });
          applyTextResolution(text, 1);
          text.x = 14;
          text.y = cursorY;
          view.dropdownContent.addChild(text);
          cursorY += text.height + 4;
          const unlocked = Array.isArray(pawnData?.unlockedSkillNodeIds)
            ? pawnData.unlockedSkillNodeIds.slice(0, 5)
            : [];
          const unlockedText = new PIXI.Text(
            unlocked.length ? unlocked.map((id) => `- ${id}`).join("\n") : "(none)",
            {
              fill: MUCHA_UI_COLORS?.ink?.muted ?? 0xc9bba5,
              fontSize: 9,
            }
          );
          applyTextResolution(unlockedText, 1);
          unlockedText.x = 14;
          unlockedText.y = cursorY;
          view.dropdownContent.addChild(unlockedText);
          cursorY += unlockedText.height + 6;
          const button = createDropdownButton("Open Skill Tree", () =>
            openSkillTree?.({ leaderPawnId: pawnData.id, pawnId: pawnData.id })
          );
          button.x = 14;
          button.y = cursorY;
          view.dropdownContent.addChild(button);
          cursorY += 30;
        }

        if (showLeaderSection("prestige")) {
          renderDropdownSectionHeader(view.dropdownContent, "prestige", "Prestige / Workers", 8, cursorY, innerWidth);
          cursorY += 26;
        }
        if (showLeaderSection("prestige") && view.dropdownSectionState.prestige === true) {
          const lines = [
            `Followers: ${countFollowersForLeader(pawnData.id)}`,
            `Workers: ${Math.max(0, Math.floor(pawnData?.workerCount ?? 0))}`,
            `Faith: ${pawnData?.leaderFaith?.tier ?? "gold"}`,
          ];
          for (const value of lines) {
            const line = new PIXI.Text(value, {
              fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
              fontSize: 10,
            });
            applyTextResolution(line, 1);
            line.x = 14;
            line.y = cursorY;
            view.dropdownContent.addChild(line);
            cursorY += line.height + 3;
          }
          cursorY += 4;
        }

        if (showLeaderSection("build")) {
          renderDropdownSectionHeader(view.dropdownContent, "build", "Build", 8, cursorY, innerWidth);
          cursorY += 26;
        }
        if (showLeaderSection("build") && view.dropdownSectionState.build === true) {
          const button = createDropdownButton("Open Building Manager", () =>
            getInvSafe()?.openBuildingManagerForOwner?.(pawnData.id)
          );
          button.x = 14;
          button.y = cursorY;
          view.dropdownContent.addChild(button);
          cursorY += 30;
        }
      } else {
        renderDropdownSectionHeader(view.dropdownContent, "assignment", "Assignment / Automata", 8, cursorY, innerWidth);
        cursorY += 26;
        if (view.dropdownSectionState.assignment === true) {
          const assigned = pawnData?.ai?.assignedPlacement ?? null;
          const lines = [
            `Assigned: ${formatPlacementLabel(assigned, getStateSafe())}`,
            `Mode: ${pawnData?.ai?.mode ?? "none"}`,
            `Return: ${pawnData?.ai?.returnState ?? "none"}`,
          ];
          for (const value of lines) {
            const line = new PIXI.Text(value, {
              fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
              fontSize: 10,
            });
            applyTextResolution(line, 1);
            line.x = 14;
            line.y = cursorY;
            view.dropdownContent.addChild(line);
            cursorY += line.height + 3;
          }
        }
      }

      drawDropdownBackground(width, cursorY + 8);
      view.dropdown.visible = view.selfHover === true;
    }

    function ensureBubbleView(bubbleSpec) {
      if (view.bubbleViews.has(bubbleSpec.systemId)) return view.bubbleViews.get(bubbleSpec.systemId);
      const bubble = new PIXI.Container();
      bubble.eventMode = "static";
      bubble.cursor = "pointer";
      bubble.on("pointerdown", stopPointerBubble);
      bubble.on("pointerover", () => {
        view.hoveredBubbleId = bubbleSpec.systemId;
        const activeSpec = bubble.currentSpec ?? bubbleSpec;
        bubble.valueBadge.visible =
          typeof activeSpec?.hoverText === "string" && activeSpec.hoverText.length > 0;
        getTooltipSafe()?.show?.(
          activeSpec?.tooltipSpec ?? bubbleSpec.tooltipSpec,
          {
            coordinateSpace: "parent",
            getAnchorRect: () =>
              tooltipView.getAnchorRectForDisplayObject?.(bubble, "parent") ?? null,
          }
        );
      });
      bubble.on("pointerout", () => {
        view.hoveredBubbleId = null;
        bubble.valueBadge.visible = false;
        if (view.selfHover) {
          getTooltipSafe()?.show?.(makePawnInfocardSpec(view.pawn, getStateSafe()), buildPawnTooltipAnchor(view));
        } else {
          getTooltipSafe()?.hide?.();
        }
      });
      const bgGraphics = new PIXI.Graphics();
      bubble.addChild(bgGraphics);
      const fillGraphics = new PIXI.Graphics();
      bubble.addChild(fillGraphics);
      const fillMask = new PIXI.Graphics();
      bubble.addChild(fillMask);
      fillGraphics.mask = fillMask;
      const fillEdge = new PIXI.Graphics();
      bubble.addChild(fillEdge);
      const outlineGraphics = new PIXI.Graphics();
      bubble.addChild(outlineGraphics);
      const text = new PIXI.Text(bubbleSpec.shortLabel, {
        fill: 0xffffff,
        fontSize: 18,
        fontWeight: "bold",
      });
      applyTextResolution(text, 1);
      text.anchor.set(0.5);
      bubble.addChild(text);
      const valueBadge = new PIXI.Container();
      valueBadge.visible = false;
      bubble.addChild(valueBadge);
      const valueBadgeBg = new PIXI.Graphics();
      valueBadge.addChild(valueBadgeBg);
      const valueBadgeText = new PIXI.Text("", {
        fill: 0xffffff,
        fontSize: 8,
        fontWeight: "bold",
      });
      applyTextResolution(valueBadgeText, 1);
      valueBadgeText.anchor.set(0.5);
      valueBadge.addChild(valueBadgeText);
      bubble.bgGraphics = bgGraphics;
      bubble.fillGraphics = fillGraphics;
      bubble.fillMask = fillMask;
      bubble.fillEdge = fillEdge;
      bubble.outlineGraphics = outlineGraphics;
      bubble.labelText = text;
      bubble.valueBadge = valueBadge;
      bubble.valueBadgeBg = valueBadgeBg;
      bubble.valueBadgeText = valueBadgeText;
      bubble.currentSpec = bubbleSpec;
      bubbleLayer.addChild(bubble);
      view.bubbleViews.set(bubbleSpec.systemId, bubble);
      return bubble;
    }

    function updateBubbleViews() {
      const pawnData = view.pawn || pawn;
      const bubbleSpecs = getPawnBubbleSpecs(pawnData, getStateSafe(), {
        hoverActive: view.selfHover === true,
      });
      const bubbleSignature = JSON.stringify(
        bubbleSpecs.map((bubble) => ({
          id: bubble.systemId,
          label: bubble.shortLabel,
          color: bubble.color,
          fillRatio: bubble.fillRatio,
          hoverText: bubble.hoverText,
        }))
      );
      view.bubbleSignature = bubbleSignature;
      const positions = {
        skillPoints: { x: PAWN_UI_LAYOUT.bubbleSideX, y: PAWN_UI_LAYOUT.bubbleTopY },
        leaderFaith: { x: 0, y: PAWN_UI_LAYOUT.bubbleTopY },
        hunger: { x: -PAWN_UI_LAYOUT.bubbleSideX, y: PAWN_UI_LAYOUT.bubbleSideY },
        stamina: { x: PAWN_UI_LAYOUT.bubbleSideX, y: PAWN_UI_LAYOUT.bubbleSideY },
      };
      view.visibleBubbleIds = bubbleSpecs.map((entry) => entry.systemId);
      for (const bubbleSpec of bubbleSpecs) {
        const bubble = ensureBubbleView(bubbleSpec);
        const pos = positions[bubbleSpec.systemId] ?? { x: 0, y: 0 };
        bubble.visible = true;
        bubble.x = pos.x;
        bubble.y = pos.y;
        bubble.currentSpec = bubbleSpec;
        drawBubbleMeter(bubble, bubbleSpec);
        bubble.labelText.text = bubbleSpec.shortLabel;
        bubble.labelText.x = 0;
        bubble.labelText.y = 0;
        redrawBubbleValueBadge(bubble, bubbleSpec.hoverText);
        bubble.valueBadge.visible =
          view.hoveredBubbleId === bubbleSpec.systemId &&
          typeof bubbleSpec.hoverText === "string" &&
          bubbleSpec.hoverText.length > 0;
      }
      for (const [systemId, bubble] of view.bubbleViews.entries()) {
        if (!view.visibleBubbleIds.includes(systemId)) {
          bubble.visible = false;
          bubble.valueBadge.visible = false;
        }
      }
    }

    function scheduleHoverHide() {
      if (view.hoverHideTimeout) clearTimeout(view.hoverHideTimeout);
      view.hoverHideTimeout = setTimeout(() => {
        const pointerPos = interactionSafe.getPointerStagePos?.() ?? null;
        const anchorBounds = view.anchorTarget?.getBounds?.() ?? null;
        const dropdownBounds = view.dropdown?.visible ? view.dropdown.getBounds?.() ?? null : null;
        if (
          isPointInsideBounds(anchorBounds, pointerPos, 10) ||
          isPointInsideBounds(dropdownBounds, pointerPos, 12)
        ) {
          view.hoverHideTimeout = null;
          return;
        }
        hideHover();
      }, DROPDOWN_HIDE_DELAY_MS);
    }

    function refreshHoverUi() {
      const pawnData = view.pawn || pawn;
      const anchor = buildPawnTooltipAnchor(view);
      const hoverTooltipSignature = JSON.stringify({
        pawnId: pawnData?.id ?? null,
        name: pawnData?.name ?? "",
        role: pawnData?.role ?? "",
        mode: pawnData?.ai?.mode ?? "",
        returnState: pawnData?.ai?.returnState ?? "",
        assignedPlacement: pawnData?.ai?.assignedPlacement ?? null,
        envCol: pawnData?.envCol ?? null,
        hubCol: pawnData?.hubCol ?? null,
        hunger: pawnData?.systemState?.hunger ?? null,
        stamina: pawnData?.systemState?.stamina ?? null,
        failedEatWarnActive: pawnData?.leaderFaith?.failedEatWarnActive === true,
        leaderFaithTier: pawnData?.leaderFaith?.tier ?? null,
        workerCount: pawnData?.workerCount ?? 0,
        hoveredBubbleId: view.hoveredBubbleId ?? null,
      });
      if (!view.hoveredBubbleId && view.hoverTooltipSignature !== hoverTooltipSignature) {
        view.hoverTooltipSignature = hoverTooltipSignature;
        getTooltipSafe()?.show?.(makePawnInfocardSpec(pawnData, getStateSafe()), anchor);
      }
      renderDropdown();
      updateBubbleViews();
    }

    view.renderDropdown = renderDropdown;
    view.updateBubbleViews = updateBubbleViews;
    view.refreshHoverUi = refreshHoverUi;

    // -----------------------------------------------------------------------
    // Hover UI
    // -----------------------------------------------------------------------
    function showHover() {
      const pawnData = view.pawn || pawn;
      if (!canShowGamepieceHoverUiNow()) return;
      view.selfHover = true;
      view.lockedHoverInfo = getLiveHoverInfoForPawn(pawnData);
      const canZoomIn = shouldAllowPawnHoverZoomIn(view);
      view.selfHoverScaleTarget = canZoomIn ? GAMEPIECE_HOVER_SCALE : 1;
      view.hoverShadowAlphaTarget = canZoomIn ? 1 : 0;
      applyPawnScale(view);
      if (view.hoverHideTimeout) {
        clearTimeout(view.hoverHideTimeout);
        view.hoverHideTimeout = null;
      }
      getInvSafe()?.showOnHover?.(pawnData.id, buildPawnInventoryAnchor(view));
      refreshHoverUi();
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
      const pawnData = view.pawn || pawn;
      view.selfHover = false;
      view.lockedHoverInfo = null;
      view.selfHoverScaleTarget = 1;
      view.hoverShadowAlphaTarget = 0;
      view.hoveredBubbleId = null;
      view.dropdown.visible = false;
      view.hoverTooltipSignature = "";
      updateBubbleViews();
      getInvSafe()?.hideOnHoverOut?.(pawnData?.id);
      const tt = getTooltipSafe();
      tt?.hide?.();
      interactionSafe.clearHoveredPawn?.();
    }

    anchorTarget.on("pointerenter", () => {
      if (interactionSafe.isDragging && interactionSafe.isDragging()) return;
      showHover();
    });

    anchorTarget.on("pointerleave", () => {
      if (interactionSafe.isDragging && interactionSafe.isDragging()) return;
      scheduleHoverHide();
    });

    const pawnLongPress = bindTouchLongPress({
      app,
      target: anchorTarget,
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
      view.lockedHoverInfo = null;
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
    renderDropdown();
    updateBubbleViews();
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
        const canZoomIn = shouldAllowPawnHoverZoomIn(view);
        view.selfHoverScaleTarget = canZoomIn ? GAMEPIECE_HOVER_SCALE : 1;
        view.hoverShadowAlphaTarget = canZoomIn ? 1 : 0;
      }
      if (view.selfHover) {
        const scale = getEffectiveScale(view);
        const pawnData = view.pawn;
        if (!view.hoveredBubbleId) {
          view.refreshHoverUi?.();
        } else {
          view.renderDropdown?.();
          view.updateBubbleViews?.();
        }
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
      } else {
        view.dropdown.visible = false;
        view.updateBubbleViews?.();
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
      const bounds = view.anchorTarget?.getBounds?.() ?? view.container.getBounds();
      if (
        globalPos.x >= bounds.x &&
        globalPos.x <= bounds.x + bounds.width &&
        globalPos.y >= bounds.y &&
        globalPos.y <= bounds.y + bounds.height
      ) {
        return {
          ownerId,
          anchor: buildPawnInventoryAnchor(view),
        };
      }
    }

    return null;
  }

  function getInventoryOwnerAnchor(ownerId) {
    const view = viewsById.get(ownerId) || null;
    if (!view) return null;
    return buildPawnInventoryAnchor(view);
  }

  function getEquipmentSlotAtGlobalPos(globalPos) {
    if (!globalPos) return null;
    for (const view of viewsById.values()) {
      if (!view?.dropdown?.visible) continue;
      for (const target of view.equipmentSlotTargets || []) {
        const bounds = target?.displayObject?.getBounds?.();
        if (!bounds) continue;
        if (
          globalPos.x >= bounds.x &&
          globalPos.x <= bounds.x + bounds.width &&
          globalPos.y >= bounds.y &&
          globalPos.y <= bounds.y + bounds.height
        ) {
          return {
            ownerId: target.ownerId,
            slotId: target.slotId,
            displayObject: target.displayObject,
          };
        }
      }
    }
    return null;
  }

  function getOccludingScreenRects() {
    const rects = [];
    for (const view of viewsById.values()) {
      if (view?.dropdown?.visible) {
        const bounds = view.dropdown.getBounds?.();
        if (bounds) rects.push(bounds);
      }
      for (const bubble of view?.bubbleViews?.values?.() || []) {
        if (!bubble?.visible) continue;
        const bounds = bubble.getBounds?.();
        if (bounds) rects.push(bounds);
      }
    }
    return rects;
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
    getInventoryOwnerAnchor,
    getEquipmentSlotAtGlobalPos,
    getDebugState: () => {
      const hoveredPawns = [];
      for (const view of viewsById.values()) {
        if (!view?.selfHover && !view?.dropdown?.visible) continue;
        hoveredPawns.push({
          pawnId: view?.pawn?.id ?? null,
          name: view?.pawn?.name ?? "",
          x: Number(view?.container?.x) || 0,
          y: Number(view?.container?.y) || 0,
          attachedScale: Number.isFinite(view?.attachedScale) ? view.attachedScale : 1,
          selfHoverScaleApplied: Number.isFinite(view?.selfHoverScaleApplied)
            ? view.selfHoverScaleApplied
            : 1,
          selfHoverScaleTarget: Number.isFinite(view?.selfHoverScaleTarget)
            ? view.selfHoverScaleTarget
            : 1,
          uiAnchorLocalX: Number(view?.uiAnchorLocalX) || 0,
          uiAnchorLocalY: Number(view?.uiAnchorLocalY) || 0,
          lockedHoverInfo:
            view?.lockedHoverInfo && typeof view.lockedHoverInfo === "object"
              ? {
                  centerX: Number(view.lockedHoverInfo.centerX) || 0,
                  centerY: Number(view.lockedHoverInfo.centerY) || 0,
                  offsetY: Number(view.lockedHoverInfo.offsetY) || 0,
                  scale: Number(view.lockedHoverInfo.scale) || 1,
                }
              : null,
          tooltipAnchor: summarizeAnchor(buildPawnTooltipAnchor(view)),
          inventoryAnchor: summarizeAnchor(buildPawnInventoryAnchor(view)),
          bodyAnchor: summarizeAnchor(buildPawnHoverAnchor(view)),
        });
      }
      hoveredPawns.sort((a, b) => String(a.pawnId).localeCompare(String(b.pawnId)));
      return { hoveredPawns };
    },
    getOccludingScreenRects,
  };
}


