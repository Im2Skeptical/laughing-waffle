// board-pixi.js
// Renders tiles/events on a 12-column board, with a separate hub row layout.
// VIEW-ONLY: no direct state mutation.

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { ActionKinds } from "../model/actions.js";
import { createTagUi, TAG_LAYOUT } from "./board/board-tag-ui.js";
import { createHubTagUi, HUB_TAG_LAYOUT } from "./board/hub-tag-ui.js";
import { createTilePanels } from "./board/board-tile-panels.js";
import { createHubPanels } from "./board/hub-structure-panels.js";
import { INTENT_AP_COSTS } from "../defs/gamesettings/action-costs-defs.js";
import {
  BOARD_COLS,
  BOARD_COL_GAP,
  HUB_COLS,
  HUB_COL_GAP,
  TILE_WIDTH,
  TILE_HEIGHT,
  EVENT_WIDTH,
  EVENT_HEIGHT,
  HUB_STRUCTURE_WIDTH,
  HUB_STRUCTURE_HEIGHT,
  GAMEPIECE_HOVER_SCALE,
  GAMEPIECE_SHADOW_COLOR,
  GAMEPIECE_SHADOW_ALPHA,
  GAMEPIECE_SHADOW_OFFSET_X,
  GAMEPIECE_SHADOW_OFFSET_Y,
  TILE_ROW_Y,
  EVENT_ROW_Y,
  HUB_STRUCTURE_ROW_Y,
  getBoardColumnX,
  getHubColumnX,
  layoutBoardColPos,
  layoutHubColPos,
} from "./layout-pixi.js";

/**
 * opts:
 *  - app: PIXI.Application
 *  - tileLayer: PIXI.Container
 *  - eventLayer: PIXI.Container
 *  - hubStructuresLayer: PIXI.Container
 *  - hoverLayer?: PIXI.Container
 *  - inspectorLayer?: PIXI.Container
 *  - getGameState: () => gameState
 *  - interaction: interactionController
 *  - actionPlanner?: actionPlanner
 *  - tooltipView
 *  - inventoryView
 *  - dispatchAction: (kind, payload, opts?) => any
 *  - queueActionWhenPaused?: (fn) => any
 *  - requestPauseForAction?: () => void
 *  - setApDragWarning?: (active: boolean) => void
 */
export function createBoardView(opts) {
  const {
    app,
    tileLayer,
    eventLayer,
    hubStructuresLayer,
    hoverLayer,
    inspectorLayer,
    getGameState,
    interaction,
    actionPlanner,
    tooltipView,
    inventoryView,
    dispatchAction,
    queueActionWhenPaused,
    requestPauseForAction,
    setApDragWarning,
    flashActionGhost,
  } = opts;

  const tileViews = [];
  /** @type {Map<number, BoardEventView>} */
  const eventViews = new Map();
  const eventSlotViews = [];
  /** @type {Map<number, BoardHubStructureView>} */
  const hubStructureViews = new Map();
  const hubSlotViews = [];
  const hubExpandedTagById = new Map();

  if (tileLayer) tileLayer.sortableChildren = true;
  if (eventLayer) eventLayer.sortableChildren = true;
  if (hubStructuresLayer) hubStructuresLayer.sortableChildren = true;
  if (hoverLayer) hoverLayer.sortableChildren = true;

  const tileInspectorLayer = inspectorLayer || hoverLayer || tileLayer;

  const TAG_DRAG_SCALE = 1.06;
  const TAG_DRAG_BUMP = 6;
  const TAG_DRAG_RELEASE_PAD = 12;
  const AP_OVERLAY_ALPHA = 0.45;
  const AP_OVERLAY_FADE_IN = 14;
  const AP_OVERLAY_FADE_OUT = 8;
  const AP_OVERLAY_FILL = 0x8a1f2a;
  const AP_OVERLAY_STROKE = 0xff4f5e;
  const BASE_TEXT_RESOLUTION = Math.max(
    2,
    Math.floor(globalThis?.devicePixelRatio || 1)
  );
  const HOVER_TEXT_RESOLUTION = Math.max(
    BASE_TEXT_RESOLUTION,
    Math.ceil(BASE_TEXT_RESOLUTION * GAMEPIECE_HOVER_SCALE)
  );
  let activeTagDrag = null;
  let activeHubTagDrag = null;
  let activeHover = null;
  let focusedTileCol = null;
  let focusedHubCol = null;
  let apDragWarningActive = false;
  let lastPointerPos = null;
  let stagePointerMoveHandler = null;
  const tooltipLayer = tooltipView?.getContainer?.()?.parent;
  const cropDropdownLayer =
    tooltipLayer || hoverLayer || tileInspectorLayer || tileLayer;
  if (cropDropdownLayer) cropDropdownLayer.sortableChildren = true;
  const tilePanels = createTilePanels({
    app,
    interaction,
    actionPlanner,
    queueActionWhenPaused,
    dispatchAction,
    dropdownLayer: cropDropdownLayer,
    flashActionGhost,
  });
  const hubPanels = createHubPanels({
    app,
    actionPlanner,
    queueActionWhenPaused,
    dispatchAction,
    dropdownLayer: cropDropdownLayer,
    flashActionGhost,
  });
  let tagUi = null;

  function setTextResolution(textNodes, resolution) {
    if (!Array.isArray(textNodes)) return;
    if (!Number.isFinite(resolution)) return;
    for (const node of textNodes) {
      if (!node || typeof node !== "object") continue;
      if (node.resolution === resolution) continue;
      node.resolution = resolution;
      if (node.dirty != null) node.dirty = true;
    }
  }

  function createApOverlay(width, height, radius) {
    const overlay = new PIXI.Graphics();
    overlay
      .beginFill(AP_OVERLAY_FILL, 0.5)
      .lineStyle(2, AP_OVERLAY_STROKE, 1)
      .drawRoundedRect(1, 1, width - 2, height - 2, radius)
      .endFill();
    overlay.alpha = 0;
    overlay.visible = false;
    overlay.eventMode = "none";
    return overlay;
  }

  function updateApOverlay(view, dt) {
    if (!view?.apOverlay) return;
    const target = Number.isFinite(view.apOverlayTarget)
      ? view.apOverlayTarget
      : 0;
    const frameDt = Number.isFinite(dt) ? dt : 1 / 60;
    const fadeSpeed =
      target > view.apOverlayAlpha ? AP_OVERLAY_FADE_IN : AP_OVERLAY_FADE_OUT;
    const step = fadeSpeed * frameDt;
    if (view.apOverlayAlpha < target) {
      view.apOverlayAlpha = Math.min(target, view.apOverlayAlpha + step);
    } else if (view.apOverlayAlpha > target) {
      view.apOverlayAlpha = Math.max(target, view.apOverlayAlpha - step);
    }
    view.apOverlay.alpha = view.apOverlayAlpha;
    view.apOverlay.visible = view.apOverlayAlpha > 0.01;
  }

  tagUi = createTagUi({
    interaction,
    tooltipView,
    openCropDropdown: tilePanels?.openCropDropdown,
    getGameState,
    startTagDrag,
    setTextResolution,
    baseTextResolution: BASE_TEXT_RESOLUTION,
    hoverTextResolution: HOVER_TEXT_RESOLUTION,
    requestPauseForAction,
    toggleTag: dispatchTileTagToggle,
  });

  const hubTagUi = createHubTagUi({
    tooltipView,
    startTagDrag: startHubTagDrag,
    setTextResolution,
    baseTextResolution: BASE_TEXT_RESOLUTION,
    hoverTextResolution: HOVER_TEXT_RESOLUTION,
    requestPauseForAction,
    toggleTag: dispatchHubTagToggle,
    openRecipeDropdown: hubPanels?.openRecipeDropdown,
  });

  function attachHoverFx(
    container,
    width,
    height,
    radius = 8,
    getTextNodes = null
  ) {
    const content = new PIXI.Container();
    content.pivot.set(width / 2, height / 2);
    content.position.set(width / 2, height / 2);

    const shadow = new PIXI.Graphics()
      .beginFill(GAMEPIECE_SHADOW_COLOR, GAMEPIECE_SHADOW_ALPHA)
      .drawRoundedRect(
        GAMEPIECE_SHADOW_OFFSET_X,
        GAMEPIECE_SHADOW_OFFSET_Y,
        width,
        height,
        radius
      )
      .endFill();
    shadow.visible = false;
    content.addChild(shadow);

    container.addChild(content);

    function setActive(active) {
      const scale = active ? GAMEPIECE_HOVER_SCALE : 1;
      content.scale.set(scale);
      shadow.visible = active && GAMEPIECE_SHADOW_ALPHA > 0;
      container.zIndex = active ? 20 : 0;
      const textNodes =
        typeof getTextNodes === "function" ? getTextNodes() : getTextNodes;
      if (textNodes) {
        setTextResolution(
          textNodes,
          active ? HOVER_TEXT_RESOLUTION : BASE_TEXT_RESOLUTION
        );
      }
    }

    return { content, setActive };
  }

  function getScaledAnchorRect(container, width, height, scale) {
    const s = Number.isFinite(scale) ? scale : 1;
    const cx = container.x + width / 2;
    const cy = container.y + height / 2;
    const scaledWidth = width * s;
    const scaledHeight = height * s;
    return {
      x: cx - scaledWidth / 2,
      y: cy - scaledHeight / 2,
      width: scaledWidth,
      height: scaledHeight,
      scale: s,
      centerX: cx,
      centerY: cy,
    };
  }

  function elevateForHover(container) {
    if (!hoverLayer || container.parent === hoverLayer) return;
    container.__hoverParent = container.parent;
    container.__hoverIndex =
      container.parent?.getChildIndex?.(container) ?? null;
    hoverLayer.addChild(container);
  }

  function restoreFromHover(container) {
    if (!hoverLayer || container.parent !== hoverLayer) return;
    const parent = container.__hoverParent;
    const index = Number.isFinite(container.__hoverIndex)
      ? Math.min(parent?.children?.length ?? 0, container.__hoverIndex)
      : null;
    if (parent) {
      if (index == null) {
        parent.addChild(container);
      } else {
        parent.addChildAt(container, index);
      }
    }
    container.__hoverParent = null;
    container.__hoverIndex = null;
  }

  function setHoverContext(kind, col, span, anchor) {
    interaction?.setHovered?.({
      kind,
      col,
      span,
      centerX: anchor.centerX,
      centerY: anchor.centerY,
      scale: anchor.scale,
      anchor,
    });
  }

  function clearHoverContext() {
    interaction?.clearHovered?.();
  }

  function setApDragWarningSafe(active) {
    const next = !!active;
    if (apDragWarningActive === next) return;
    apDragWarningActive = next;
    if (typeof setApDragWarning === "function") {
      setApDragWarning(next);
    }
  }

  function trackPointerPos(ev) {
    const p = ev?.data?.global;
    if (!p) return;
    lastPointerPos = { x: p.x, y: p.y };
  }

  function setActiveHover(next) {
    if (!next?.view) return;
    if (activeHover?.view === next.view) return;
    activeHover?.clear?.();
    activeHover = next;
  }

  function clearActiveHover(view) {
    if (!activeHover) return;
    if (view && activeHover.view !== view) return;
    activeHover.clear?.();
    activeHover = null;
  }

  function isPointerInsideView(view, globalPos, pad = 0) {
    if (!view?.container || !globalPos) return false;
    const bounds = view.container.getBounds();
    const minX = bounds.x - pad;
    const minY = bounds.y - pad;
    const maxX = bounds.x + bounds.width + pad;
    const maxY = bounds.y + bounds.height + pad;
    return (
      globalPos.x >= minX &&
      globalPos.x <= maxX &&
      globalPos.y >= minY &&
      globalPos.y <= maxY
    );
  }

  function clearTileHover(view) {
    if (!view) return;
    if (view.hoverHoldMove) {
      app.stage.off("pointermove", view.hoverHoldMove);
      view.hoverHoldMove = null;
    }
    view.holdHover = false;
    view.holdHoverForOccupant = false;
    view.setHoverActive?.(false);
    restoreFromHover(view.container);
    view.isHovered = false;
    view.hoverAnchor = null;
    clearHoverContext();
    tooltipView?.hide?.();
    // Dropdown handles its own hide behavior.
  }

  function clearEventHover(view) {
    if (!view) return;
    view.setHoverActive?.(false);
    restoreFromHover(view.container);
    clearHoverContext();
    tooltipView?.hide?.();
  }

  function clearHubStructureHover(view) {
    if (!view) return;
    view.setHoverActive?.(false);
    restoreFromHover(view.container);
    view.holdHoverForOccupant = false;
    view.isHovered = false;
    clearHoverContext();
    tooltipView?.hide?.();
    if (inventoryView && view.structureHasInventory?.()) {
      inventoryView.hideOnHoverOut(view.structure.instanceId);
    }
  }

  function holdHoverAfterTagDrag(view) {
    if (!view) return;
    if (view.hoverHoldMove) {
      app.stage.off("pointermove", view.hoverHoldMove);
      view.hoverHoldMove = null;
    }
    view.holdHover = true;
    const onMove = (moveEv) => {
      view.holdHover = false;
      app.stage.off("pointermove", onMove);
      view.hoverHoldMove = null;
      if (
        !isPointerInsideView(
          view,
          moveEv?.data?.global,
          TAG_DRAG_RELEASE_PAD
        )
      ) {
        clearTileHover(view);
        if (activeHover?.view === view) activeHover = null;
      }
    };
    view.hoverHoldMove = onMove;
    app.stage.on("pointermove", onMove);
  }

  function isPawnHoveringForView(view, kind) {
    const hover = interaction?.getHoveredPawn?.();
    if (!hover || hover.kind !== "pawn") return false;
    if (kind === "tile") {
      const anchorCol = Number.isFinite(view?.tile?.col)
        ? Math.floor(view.tile.col)
        : Number.isFinite(view?.col)
        ? Math.floor(view.col)
        : null;
      if (anchorCol == null) return false;
      const span =
        Number.isFinite(view?.tile?.span) && view.tile.span > 0
          ? Math.floor(view.tile.span)
          : 1;
      const envCol = Number.isFinite(hover.envCol)
        ? Math.floor(hover.envCol)
        : null;
      return envCol != null && envCol >= anchorCol && envCol < anchorCol + span;
    }
    if (kind === "hub") {
      const anchorCol = Number.isFinite(view?.structure?.col)
        ? Math.floor(view.structure.col)
        : Number.isFinite(view?.col)
        ? Math.floor(view.col)
        : null;
      if (anchorCol == null) return false;
      const span =
        Number.isFinite(view?.structure?.span) && view.structure.span > 0
          ? Math.floor(view.structure.span)
          : 1;
      const hubCol = Number.isFinite(hover.hubCol)
        ? Math.floor(hover.hubCol)
        : null;
      return hubCol != null && hubCol >= anchorCol && hubCol < anchorCol + span;
    }
    return false;
  }

  function holdHoverForOccupantIfNeeded(view) {
    if (!view?.pawnCount || view.pawnCount <= 0) return false;
    view.holdHoverForOccupant = true;
    return true;
  }

  function applyTileHover(view) {
    if (!view?.container || !view?.tile) return;
    const { title, desc } = getTileUi(view.tile);
    view.setHoverActive?.(true);
    elevateForHover(view.container);
    const anchor = getScaledAnchorRect(
      view.container,
      TILE_WIDTH,
      TILE_HEIGHT,
      GAMEPIECE_HOVER_SCALE
    );
    const anchorCol = Number.isFinite(view.tile.col)
      ? Math.floor(view.tile.col)
      : view.col;
    const span =
      Number.isFinite(view.tile.span) && view.tile.span > 0
        ? Math.floor(view.tile.span)
        : 1;
    view.isHovered = true;
    view.hoverAnchor = anchor;
    setHoverContext("tile", anchorCol, span, anchor);
    tooltipView?.show?.(
      {
        title,
        lines: desc ? [desc] : [],
        scale: GAMEPIECE_HOVER_SCALE,
      },
      anchor
    );
  }

  function setTileFocus(view, active) {
    if (!view?.focusOutline) return;
    const next = !!active;
    if (view.isFocused === next) return;
    view.isFocused = next;
    view.focusOutline.visible = next;
  }

  function clearAllTileFocus() {
    for (const view of tileViews) {
      if (!view?.isFocused) continue;
      setTileFocus(view, false);
    }
    focusedTileCol = null;
  }

  function setHubFocus(view, active) {
    if (!view?.focusOutline) return;
    const next = !!active;
    if (view.isFocused === next) return;
    view.isFocused = next;
    view.focusOutline.visible = next;
  }

  function clearAllHubFocus() {
    for (const view of hubStructureViews.values()) {
      if (!view?.isFocused) continue;
      setHubFocus(view, false);
    }
    focusedHubCol = null;
  }

  function findHubViewByCol(hubCol) {
    const target = Number.isFinite(hubCol) ? Math.floor(hubCol) : null;
    if (target == null) return null;
    for (const view of hubStructureViews.values()) {
      const anchorCol = Number.isFinite(view?.structure?.col)
        ? Math.floor(view.structure.col)
        : Number.isFinite(view?.col)
        ? Math.floor(view.col)
        : null;
      if (anchorCol === target) return view;
    }
    return null;
  }

  function updatePlanFocus() {
    if (!actionPlanner?.getFocusIntent) {
      if (focusedTileCol != null) clearAllTileFocus();
      if (focusedHubCol != null) clearAllHubFocus();
      return;
    }
    const intent = actionPlanner.getFocusIntent?.();
    const isTilePlan =
      intent &&
      (intent.kind === "tileTagOrder" ||
        intent.kind === "tileTagToggle" ||
        intent.kind === "tileCropSelect");
    const isHubPlan =
      intent &&
      (intent.kind === "hubTagOrder" || intent.kind === "hubTagToggle");

    const nextTileCol =
      isTilePlan && Number.isFinite(intent.envCol)
        ? Math.floor(intent.envCol)
        : null;
    const nextHubCol =
      isHubPlan && Number.isFinite(intent.hubCol)
        ? Math.floor(intent.hubCol)
        : null;

    if (nextTileCol == null) {
      if (focusedTileCol != null) clearAllTileFocus();
    } else {
      if (focusedTileCol !== nextTileCol) {
        if (focusedTileCol != null) {
          const prev = tileViews[focusedTileCol];
          if (prev) setTileFocus(prev, false);
        }
        focusedTileCol = nextTileCol;
      }
      const view = tileViews[nextTileCol];
      if (view) setTileFocus(view, true);
    }

    if (nextHubCol == null) {
      if (focusedHubCol != null) clearAllHubFocus();
    } else {
      if (focusedHubCol !== nextHubCol) {
        if (focusedHubCol != null) {
          const prev = findHubViewByCol(focusedHubCol);
          if (prev) setHubFocus(prev, false);
        }
        focusedHubCol = nextHubCol;
      }
      const view = findHubViewByCol(nextHubCol);
      if (view) setHubFocus(view, true);
    }
  }

  function applyHubStructureHover(view) {
    if (!view?.container || !view?.structure) return;
    const { title, lines } = getHubStructureUi(view.structure);
    const def = hubStructureDefs[view.structure.defId];
    const span =
      Number.isFinite(view.structure?.span) && view.structure.span > 0
        ? Math.floor(view.structure.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const width = HUB_STRUCTURE_WIDTH * span + HUB_COL_GAP * (span - 1);
    const height = HUB_STRUCTURE_HEIGHT;
    view.setHoverActive?.(true);
    elevateForHover(view.container);
    const anchor = getScaledAnchorRect(
      view.container,
      width,
      height,
      GAMEPIECE_HOVER_SCALE
    );
    const anchorCol = Number.isFinite(view.structure?.col)
      ? Math.floor(view.structure.col)
      : Number.isFinite(view.col)
      ? Math.floor(view.col)
      : 0;
    view.isHovered = true;
    setHoverContext("hub", anchorCol, span, anchor);

    tooltipView?.show?.(
      { title, lines, scale: GAMEPIECE_HOVER_SCALE },
      anchor
    );

    if (inventoryView && view.structureHasInventory?.()) {
      inventoryView.showOnHover(view.structure.instanceId, {
        x: anchor.x,
        y: anchor.y,
        width: anchor.width,
        height: anchor.height,
      });
    }
  }

  function restoreHoverAfterRebuild(pendingHover, pointerPos) {
    if (!pendingHover || !pointerPos) return;
    if (!interaction?.canShowHoverUI?.()) return;
    if (pendingHover.kind === "tile") {
      const view = tileViews[pendingHover.col];
      if (!view) return;
      if (!isPointerInsideView(view, pointerPos, TAG_DRAG_RELEASE_PAD)) return;
      setActiveHover({
        view,
        kind: "tile",
        col: pendingHover.col,
        clear: () => clearTileHover(view),
      });
      applyTileHover(view);
      return;
    }
    if (pendingHover.kind === "hub") {
      const targetCol = Number.isFinite(pendingHover.col)
        ? Math.floor(pendingHover.col)
        : null;
      if (targetCol == null) return;
      let view = null;
      for (const candidate of hubStructureViews.values()) {
        const anchorCol = Number.isFinite(candidate?.structure?.col)
          ? Math.floor(candidate.structure.col)
          : Number.isFinite(candidate?.col)
          ? Math.floor(candidate.col)
          : null;
        if (anchorCol === targetCol) {
          view = candidate;
          break;
        }
      }
      if (!view) return;
      if (!isPointerInsideView(view, pointerPos, TAG_DRAG_RELEASE_PAD)) return;
      setActiveHover({
        view,
        kind: "hub",
        col: targetCol,
        clear: () => clearHubStructureHover(view),
      });
      applyHubStructureHover(view);
    }
  }

  function removeFromParent(container) {
    if (container?.parent) container.parent.removeChild(container);
  }

  function dispatchTagOrder(envCol, tagIds) {
    const run = () => {
      const tileName = getTileNameByCol(envCol);
      const ghostSpec = {
        description: `Tags > ${tileName} reorder`,
        cost: getTilePlanCost(),
      };
      if (actionPlanner?.setTileTagOrderIntent) {
        const res = actionPlanner.setTileTagOrderIntent({ envCol, tagIds });
        if (res?.ok === false && res?.reason === "insufficientAP") {
          flashTilePlanFailure(ghostSpec);
        }
        return res;
      }
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      const res = dispatchAction(
        ActionKinds.SET_TILE_TAG_ORDER,
        { envCol, tagIds },
        { apCost: 10 }
      );
      if (res?.ok === false && res?.reason === "insufficientAP") {
        flashTilePlanFailure(ghostSpec);
      }
      return res ?? { ok: true };
    };
    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused(run);
    }
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) {
      return { ok: false, reason: "mustBePaused" };
    }
    return run();
  }

  function dispatchTileTagToggle({ envCol, tagId, disabled } = {}) {
    const run = () => {
      const tileName = getTileNameByCol(envCol);
      const tagName = envTagDefs?.[tagId]?.ui?.name || tagId || "Tag";
      let nextDisabled = disabled;
      if (typeof nextDisabled !== "boolean") {
        if (actionPlanner?.getTileTagTogglePreview) {
          const cur = actionPlanner.getTileTagTogglePreview({ envCol, tagId });
          nextDisabled = cur == null ? true : !cur;
        } else {
          const state = getGameState?.();
          const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
          const tile = col != null ? state?.board?.occ?.tile?.[col] : null;
          const cur = tile?.tagStates?.[tagId]?.disabled === true;
          nextDisabled = !cur;
        }
      }
      if (actionPlanner?.setTileTagToggleIntent) {
        const res = actionPlanner.setTileTagToggleIntent({
          envCol,
          tagId,
          disabled: nextDisabled,
        });
        if (res?.ok === false && res?.reason === "insufficientAP") {
          flashTilePlanFailure({
            description: `Tag ${tagName} > ${tileName}: ${
              nextDisabled ? "Off" : "On"
            }`,
            cost: getTilePlanCost(),
          });
        }
        return res;
      }
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      const res = dispatchAction(
        ActionKinds.TOGGLE_TILE_TAG,
        { envCol, tagId, disabled: nextDisabled },
        { apCost: 5 }
      );
      if (res?.ok === false && res?.reason === "insufficientAP") {
        flashTilePlanFailure({
          description: `Tag ${tagName} > ${tileName}: ${
            nextDisabled ? "Off" : "On"
          }`,
          cost: getTilePlanCost(),
        });
      }
      return res ?? { ok: true };
    };
    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused(run);
    }
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) {
      return { ok: false, reason: "mustBePaused" };
    }
    return run();
  }
  // Tag + system UI helpers live in board/board-tag-ui.js.

  function endTagDrag(view, commit, globalPos = null) {
    const drag = view.tagDrag;
    if (!drag) return;

    drag.entry.container.scale.set(1);
    drag.entry.container.alpha = 1;
    drag.entry.container.zIndex = 0;
    drag.entry.container.cursor = "grab";

    if (commit && drag.targetIndex !== drag.startIndex) {
      const tags = Array.isArray(view.tile?.tags) ? view.tile.tags.slice() : [];
      if (tags.length === view.tagEntries.length) {
        const [moved] = tags.splice(drag.startIndex, 1);
        tags.splice(drag.targetIndex, 0, moved);
        dispatchTagOrder(view.col, tags);
      }
    }

    if (drag.stageMove) {
      app.stage.off("pointermove", drag.stageMove);
      app.stage.off("pointerup", drag.stageUp);
      app.stage.off("pointerupoutside", drag.stageUp);
    }

    view.tagDrag = null;
    view.ignoreNextTagTap = !!drag.moved;
    if (activeTagDrag === view) activeTagDrag = null;
    tagUi?.layoutTagEntries?.(view);

    if (globalPos) {
      const inside = isPointerInsideView(
        view,
        globalPos,
        TAG_DRAG_RELEASE_PAD
      );
      if (!inside) {
        clearTileHover(view);
        if (activeHover?.view === view) activeHover = null;
      } else {
        holdHoverAfterTagDrag(view);
      }
    }
  }

  function dispatchHubTagOrder(hubCol, tagIds) {
    const run = () => {
      if (actionPlanner?.setHubTagOrderIntent) {
        return actionPlanner.setHubTagOrderIntent({ hubCol, tagIds });
      }
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      dispatchAction(
        ActionKinds.SET_HUB_TAG_ORDER,
        { hubCol, tagIds },
        { apCost: 10 }
      );
      return { ok: true };
    };
    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused(run);
    }
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) {
      return { ok: false, reason: "mustBePaused" };
    }
    return run();
  }

  function dispatchHubTagToggle({ hubCol, tagId, disabled } = {}) {
    const run = () => {
      let nextDisabled = disabled;
      if (typeof nextDisabled !== "boolean") {
        if (actionPlanner?.getHubTagTogglePreview) {
          const cur = actionPlanner.getHubTagTogglePreview({ hubCol, tagId });
          nextDisabled = cur == null ? true : !cur;
        } else {
          const state = getGameState?.();
          const col = Number.isFinite(hubCol) ? Math.floor(hubCol) : null;
          const structure =
            col != null
              ? state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure
              : null;
          const cur = structure?.tagStates?.[tagId]?.disabled === true;
          nextDisabled = !cur;
        }
      }
      if (actionPlanner?.setHubTagToggleIntent) {
        return actionPlanner.setHubTagToggleIntent({
          hubCol,
          tagId,
          disabled: nextDisabled,
        });
      }
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      dispatchAction(
        ActionKinds.TOGGLE_HUB_TAG,
        { hubCol, tagId, disabled: nextDisabled },
        { apCost: 5 }
      );
      return { ok: true };
    };
    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused(run);
    }
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) {
      return { ok: false, reason: "mustBePaused" };
    }
    return run();
  }

  function endHubTagDrag(view, commit, globalPos = null) {
    const drag = view.tagDrag;
    if (!drag) return;

    drag.entry.container.scale.set(1);
    drag.entry.container.alpha = 1;
    drag.entry.container.zIndex = 0;
    drag.entry.container.cursor = "grab";

    if (commit && drag.targetIndex !== drag.startIndex) {
      const tags = Array.isArray(view.structure?.tags)
        ? view.structure.tags.slice()
        : [];
      if (tags.length === view.tagEntries.length) {
        const [moved] = tags.splice(drag.startIndex, 1);
        tags.splice(drag.targetIndex, 0, moved);
        dispatchHubTagOrder(view.col, tags);
      }
    }

    if (drag.stageMove) {
      app.stage.off("pointermove", drag.stageMove);
      app.stage.off("pointerup", drag.stageUp);
      app.stage.off("pointerupoutside", drag.stageUp);
    }

    view.tagDrag = null;
    view.ignoreNextTagTap = !!drag.moved;
    if (activeHubTagDrag === view) activeHubTagDrag = null;
    hubTagUi?.layoutTagEntries?.(view);

    if (globalPos) {
      const inside = isPointerInsideView(
        view,
        globalPos,
        TAG_DRAG_RELEASE_PAD
      );
      if (!inside) {
        clearHubStructureHover(view);
        if (activeHover?.view === view) activeHover = null;
      }
    }
  }

  function startHubTagDrag(view, entry, ev) {
    requestPauseForAction?.();
    if (!view.isHovered) return;

    if (activeHubTagDrag && activeHubTagDrag !== view) {
      endHubTagDrag(activeHubTagDrag, false);
    }

    ev?.stopPropagation?.();

    const entries = view.tagEntries || [];
    const startIndex = entries.indexOf(entry);
    if (startIndex < 0) return;

    const local = view.tagContainer.toLocal(ev.data.global);
    const offsetY = local.y - entry.container.y;

    const dragState = {
      entry,
      startIndex,
      targetIndex: startIndex,
      offsetY,
      startY: entry.container.y,
      moved: false,
      stageMove: null,
      stageUp: null,
    };

    view.tagDrag = dragState;
    activeHubTagDrag = view;

    entry.container.scale.set(TAG_DRAG_SCALE);
    entry.container.alpha = 0.95;
    entry.container.zIndex = 10;
    entry.container.cursor = "grabbing";

    const onMove = (moveEv) => {
      const drag = view.tagDrag;
      if (!drag) return;
      const localPos = view.tagContainer.toLocal(moveEv.data.global);
      const rowStep = HUB_TAG_LAYOUT.PILL_HEIGHT + HUB_TAG_LAYOUT.PILL_GAP;
      const maxY = Math.max(0, (entries.length - 1) * rowStep);
      const nextY = Math.max(0, Math.min(maxY, localPos.y - drag.offsetY));
      drag.entry.container.y = nextY;
      if (Math.abs(nextY - drag.startY) > 2) {
        drag.moved = true;
      }

      const centerY = nextY + HUB_TAG_LAYOUT.PILL_HEIGHT / 2;
      const nextIndex = Math.max(
        0,
        Math.min(entries.length - 1, Math.floor(centerY / rowStep))
      );

      if (nextIndex !== drag.targetIndex) {
        drag.targetIndex = nextIndex;
        drag.moved = true;
        hubTagUi?.layoutTagEntries?.(view);
      }
    };

    const onUp = (upEv) => {
      endHubTagDrag(view, true, upEv?.data?.global ?? null);
    };

    dragState.stageMove = onMove;
    dragState.stageUp = onUp;

    app.stage.on("pointermove", onMove);
    app.stage.on("pointerup", onUp);
    app.stage.on("pointerupoutside", onUp);

    hubTagUi?.layoutTagEntries?.(view);
  }

  function startTagDrag(view, entry, ev) {
    requestPauseForAction?.();
    if (!view.isHovered) return;

    if (activeTagDrag && activeTagDrag !== view) {
      endTagDrag(activeTagDrag, false);
    }

    ev?.stopPropagation?.();

    const entries = view.tagEntries || [];
    const startIndex = entries.indexOf(entry);
    if (startIndex < 0) return;

    const local = view.tagContainer.toLocal(ev.data.global);
    const offsetY = local.y - entry.container.y;

    const dragState = {
      entry,
      startIndex,
      targetIndex: startIndex,
      offsetY,
      startY: entry.container.y,
      moved: false,
      stageMove: null,
      stageUp: null,
    };

    view.tagDrag = dragState;
    activeTagDrag = view;

    entry.container.scale.set(TAG_DRAG_SCALE);
    entry.container.alpha = 0.95;
    entry.container.zIndex = 10;
    entry.container.cursor = "grabbing";

    const onMove = (moveEv) => {
      const drag = view.tagDrag;
      if (!drag) return;
      const localPos = view.tagContainer.toLocal(moveEv.data.global);
      const rowStep = TAG_LAYOUT.PILL_HEIGHT + TAG_LAYOUT.PILL_GAP;
      const maxY = Math.max(0, (entries.length - 1) * rowStep);
      const nextY = Math.max(0, Math.min(maxY, localPos.y - drag.offsetY));
      drag.entry.container.y = nextY;
      if (Math.abs(nextY - drag.startY) > 2) {
        drag.moved = true;
      }

      const centerY = nextY + TAG_LAYOUT.PILL_HEIGHT / 2;
      const nextIndex = Math.max(
        0,
        Math.min(entries.length - 1, Math.floor(centerY / rowStep))
      );

      if (nextIndex !== drag.targetIndex) {
        drag.targetIndex = nextIndex;
        drag.moved = true;
        tagUi?.layoutTagEntries?.(view);
      }
    };

    const onUp = (upEv) => {
      endTagDrag(view, true, upEv?.data?.global ?? null);
    };

    dragState.stageMove = onMove;
    dragState.stageUp = onUp;

    app.stage.on("pointermove", onMove);
    app.stage.on("pointerup", onUp);
    app.stage.on("pointerupoutside", onUp);

    tagUi?.layoutTagEntries?.(view);
  }

  // --------------------------------------------------------
  // UI helpers
  // --------------------------------------------------------

  function getTileUi(tileInst) {
    const def = envTileDefs[tileInst.defId];
    const title = def?.name || tileInst.defId || "Tile";
    const desc = def?.ui?.description || "";
    const uiColor = def?.ui?.color;
    const color = Number.isFinite(uiColor)
      ? uiColor
      : def?.color ?? 0x6f8a6f;
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    return { def, title, desc, color, tags };
  }

  function getTileNameByCol(envCol) {
    const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
    const state = getGameState?.();
    const tile = col != null ? state?.board?.occ?.tile?.[col] : null;
    if (tile) {
      const def = envTileDefs[tile.defId];
      return def?.name || tile.defId || `Tile ${col}`;
    }
    return col != null ? `Tile ${col}` : "Tile";
  }

  function getTilePlanCost() {
    return Math.max(
      0,
      Math.floor(
        INTENT_AP_COSTS?.tilePlan ?? INTENT_AP_COSTS?.tileTagOrder ?? 0
      )
    );
  }

  function flashTilePlanFailure(spec) {
    if (!spec || typeof flashActionGhost !== "function") return;
    flashActionGhost(spec, "fail");
  }


  function getEventUi(eventInst) {
    const def = envEventDefs[eventInst.defId];
    const title = def?.name || eventInst.defId || "Event";
    const desc = def?.ui?.description || "";
    const classKind = def?.class || "effect";
    const uiColor = def?.ui?.color;
    const defaultColor =
      classKind === "animal"
        ? 0x8f6f5f
        : classKind === "effect"
          ? 0x698f5f
          : 0x707070;
    const color = Number.isFinite(uiColor)
      ? uiColor
      : def?.color ?? defaultColor;
    return { def, title, desc, color };
  }

  function getBuildProcess(structureInst) {
    const processes = Array.isArray(structureInst?.systemState?.build?.processes)
      ? structureInst.systemState.build.processes
      : [];
    return processes.find((proc) => proc?.type === "build") ?? null;
  }

  function getHubStructureUi(structureInst) {
    const def = hubStructureDefs[structureInst.defId];
    const buildProcess = getBuildProcess(structureInst);
    if (buildProcess) {
      const name = def?.name || structureInst.defId || "Structure";
      return {
        def,
        title: `${name} (Construction)`,
        lines: ["Build in progress."],
        color: 0x6f6f6f,
        meters: [],
      };
    }
    const ui = def?.ui || {};
    const title =
      (typeof ui.title === "function"
        ? ui.title(structureInst, def)
        : ui.title) ||
      def?.name ||
      structureInst.defId;
    const lines = (ui.lines || [])
      .map((line) =>
        typeof line === "function" ? line(structureInst, def) : line
      )
      .filter(Boolean);
    const meters = Array.isArray(ui.meters) ? ui.meters : [];
    return { def, title, lines, color: def?.color ?? 0x336699, meters };
  }

  // --------------------------------------------------------
  // Meter helpers (hub structures only)
  // --------------------------------------------------------

  function createMeters(container, meters, inst, startY, maxWidth) {
    const meterHeight = 6;
    const meterWidth = maxWidth ?? 110;
    let y = startY;
    const meterViews = [];

    for (const meter of meters) {
      const labelText = new PIXI.Text("", {
        fill: 0x000000,
        fontSize: 11,
      });
      labelText.x = 8;
      labelText.y = y;
      container.addChild(labelText);

      const barBg = new PIXI.Graphics()
        .beginFill(0x444444)
        .drawRoundedRect(8, y + 14, meterWidth, meterHeight, 3)
        .endFill();
      container.addChild(barBg);

      const barFill = new PIXI.Graphics();
      container.addChild(barFill);

      meterViews.push({
        meter,
        labelText,
        barFill,
        width: meterWidth,
      });

      y += 26;
    }

    updateMeters(meterViews, inst);
    return { meterViews, nextY: y };
  }

  function updateMeters(meterViews, inst) {
    for (const mv of meterViews) {
      const { meter, labelText, barFill, width } = mv;
      let ratio = 0;
      let label = "";

      if (meter.kind === "timerProgress") {
        const timerKey = meter.timerKey || "timer";
        const periodKey = meter.periodKey || "timerPeriod";
        const timer = inst.props?.[timerKey] ?? 0;
        const period = inst.props?.[periodKey] ?? 1;
        const elapsed = period - timer;
        ratio = Math.max(0, Math.min(1, elapsed / Math.max(1, period)));
        label = `${meter.label}: ${elapsed.toFixed(1)}/${period.toFixed(1)}s`;
      } else {
        const prop = meter.prop;
        const value = inst.props?.[prop] ?? 0;
        const max = inst.props?.[`_${prop}Max`] ?? Math.max(1, value);
        ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
        label = `${meter.label}: ${value}/${max}`;
      }

      labelText.text = label;
      barFill.clear();
      barFill.beginFill(0x00cc66);
      barFill.drawRoundedRect(8, labelText.y + 14, width * ratio, 6, 3);
      barFill.endFill();
    }
  }

  function updateHubStructureViewUi(view, structureInst) {
    if (!view || !structureInst) return false;
    const ui = getHubStructureUi(structureInst);
    const buildActive = !!getBuildProcess(structureInst);
    const signature = `${ui.title}|${ui.lines.join("|")}|${ui.color}`;
    if (signature === view.uiSignature) {
      if (view.cancelButton) {
        view.cancelButton.visible = buildActive;
      }
      return false;
    }
    view.uiSignature = signature;

    if (view.cardFill && view.cardFillColor !== ui.color) {
      view.cardFill.clear();
      view.cardFill
        .beginFill(ui.color)
        .drawRoundedRect(3, 3, view.cardWidth - 6, view.cardHeight - 6, 8)
        .endFill();
      view.cardFillColor = ui.color;
    }

    if (view.titleText) {
      view.titleText.text = ui.title;
    }

    if (Array.isArray(view.lineTextNodes)) {
      for (const node of view.lineTextNodes) {
        if (node?.parent) node.parent.removeChild(node);
      }
      view.lineTextNodes.length = 0;
    } else {
      view.lineTextNodes = [];
    }

    let y = view.titleText.y + view.titleText.height + 2;
    const maxLineY = view.cardHeight - 40;
    for (const line of ui.lines) {
      const t = new PIXI.Text(line, {
        fill: 0x000000,
        fontSize: 10,
        wordWrap: true,
        wordWrapWidth: view.cardWidth - 12,
      });
      t.x = 6;
      t.y = y;
      view.content.addChild(t);
      view.lineTextNodes.push(t);
      y += t.height + 1;
      if (y > maxLineY) break;
    }

    if (Array.isArray(view.hoverTextBaseNodes)) {
      view.hoverTextBaseNodes.length = 0;
      view.hoverTextBaseNodes.push(view.titleText, ...view.lineTextNodes);
    }

    if (Array.isArray(view.hoverTextNodes)) {
      view.hoverTextNodes.length = 0;
      if (Array.isArray(view.hoverTextBaseNodes)) {
        view.hoverTextNodes.push(...view.hoverTextBaseNodes);
      }
      for (const meterView of view.meterViews || []) {
        if (meterView?.labelText) view.hoverTextNodes.push(meterView.labelText);
      }
      for (const entry of view.tagEntries || []) {
        if (entry?.labelText) view.hoverTextNodes.push(entry.labelText);
        if (entry?.expandText) view.hoverTextNodes.push(entry.expandText);
      }
      setTextResolution(
        view.hoverTextNodes,
        view.isHovered ? HOVER_TEXT_RESOLUTION : BASE_TEXT_RESOLUTION
      );
    }

    view.tagStartY = Math.min(y + 4, view.cardHeight - 12);
    view.tagContainer.y = view.tagStartY;
    view.tagMaxY = view.cardHeight - 6;
    hubTagUi?.layoutTagEntries?.(view);

    if (view.cancelButton) {
      view.cancelButton.visible = buildActive;
    }

    return true;
  }

  // --------------------------------------------------------
  // Tile view
  // --------------------------------------------------------

  function buildTileView(tileInst, col) {
    const { title, color } = getTileUi(tileInst);

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    const hoverTextNodes = [];
    const hoverTextBaseNodes = [];
    const { content, setActive: setHoverActive } = attachHoverFx(
      cont,
      TILE_WIDTH,
      TILE_HEIGHT,
      8,
      () => hoverTextNodes
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(0x3a3a3a)
        .drawRoundedRect(0, 0, TILE_WIDTH, TILE_HEIGHT, 8)
        .endFill()
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(color)
        .drawRoundedRect(3, 3, TILE_WIDTH - 6, TILE_HEIGHT - 6, 6)
        .endFill()
    );

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 12,
      wordWrap: true,
      wordWrapWidth: TILE_WIDTH - 12,
    });
    titleText.x = 6;
    titleText.y = 6;
    content.addChild(titleText);

    const tagContainer = new PIXI.Container();
    const tagStartY = titleText.y + titleText.height + 4;
    const tagMaxY = TILE_HEIGHT - 6;
    tagContainer.x = Math.max(
      0,
      Math.round((TILE_WIDTH - TAG_LAYOUT.PILL_WIDTH) / 2)
    );
    tagContainer.y = tagStartY;
    content.addChild(tagContainer);

    const pawnBadge = new PIXI.Container();
    const pawnBg = new PIXI.Graphics()
      .beginFill(0x222222)
      .drawCircle(0, 0, 8)
      .endFill();
    const pawnText = new PIXI.Text("", {
      fill: 0xffffff,
      fontSize: 9,
    });
    pawnText.anchor.set(0.5);
    pawnBadge.addChild(pawnBg, pawnText);
    pawnBadge.x = TILE_WIDTH - 12;
    pawnBadge.y = 0;
    pawnBadge.visible = false;
    content.addChild(pawnBadge);

    const apOverlay = createApOverlay(TILE_WIDTH, TILE_HEIGHT, 8);
    content.addChild(apOverlay);

    const focusOutline = new PIXI.Graphics();
    focusOutline.lineStyle(2, 0x7fd0ff, 1);
    focusOutline.drawRoundedRect(2, 2, TILE_WIDTH - 4, TILE_HEIGHT - 4, 6);
    focusOutline.visible = false;
    content.addChild(focusOutline);

    hoverTextBaseNodes.push(titleText, pawnText);
    hoverTextNodes.push(...hoverTextBaseNodes);

      cont.on("pointerenter", () => {
        if (!interaction?.canShowHoverUI?.()) return;
        if (activeTagDrag && activeTagDrag !== view) return;
        const anchorCol = Number.isFinite(view.tile?.col)
          ? Math.floor(view.tile.col)
          : col;
        setActiveHover({
          view,
          kind: "tile",
          col: anchorCol,
          clear: () => clearTileHover(view),
        });
        if (view.isHovered) return;
        applyTileHover(view);
      });

      cont.on("pointerleave", () => {
        if (view.tagDrag || view.holdHover) return;
        if (activeHover?.view && activeHover.view !== view) return;
        if (holdHoverForOccupantIfNeeded(view)) return;
        clearActiveHover(view);
      });

    const pos = layoutBoardColPos(app.screen.width, col, TILE_WIDTH, TILE_ROW_Y);
    cont.x = pos.x;
    cont.y = pos.y;

    tileLayer.addChild(cont);

      const view = {
        container: cont,
        tile: tileInst,
        col,
        setHoverActive,
      tagContainer,
      tagStartY,
      tagMaxY,
      tagSignature: "",
      tagEntries: [],
      expandedTagId: null,
      hasTagToggle: false,
      pawnCount: 0,
      ignoreNextTagTap: false,
      tagDrag: null,
        hoverTextNodes,
        hoverTextBaseNodes,
        titleText,
        isHovered: false,
        hoverAnchor: null,
        holdHover: false,
        hoverHoldMove: null,
        holdHoverForOccupant: false,
      pawnBadge,
      pawnText,
      apOverlay,
      apOverlayAlpha: 0,
      apOverlayTarget: 0,
      focusOutline,
      isFocused: false,
    };

    tagUi?.rebuildTileTags?.(view, tileInst);
    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    return view;
  }

  function updateTileView(view, tileInst, pawnCount) {
    view.tile = tileInst;
    view.pawnCount = pawnCount;
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    const signature = tags.join("|");
    if (signature !== view.tagSignature) {
      tagUi?.rebuildTileTags?.(view, tileInst);
    }
    tagUi?.updateTagEntries?.(view, tileInst);

    if (pawnCount > 0) {
      view.pawnBadge.visible = true;
      view.pawnText.text = pawnCount > 9 ? "9+" : String(pawnCount);
    } else {
      view.pawnBadge.visible = false;
    }
  }

  // --------------------------------------------------------
  // Event view
  // --------------------------------------------------------

  function buildEventView(eventInst, col) {
    const { title, desc, color } = getEventUi(eventInst);
    const span =
      Number.isFinite(eventInst.span) && eventInst.span > 0
        ? Math.floor(eventInst.span)
        : 1;

    const width = EVENT_WIDTH * span + BOARD_COL_GAP * (span - 1);

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    cont.zIndex = 5;
    const hoverTextNodes = [];
    const { content, setActive: setHoverActive } = attachHoverFx(
      cont,
      width,
      EVENT_HEIGHT,
      8,
      () => hoverTextNodes
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(0x2f2f2f)
        .drawRoundedRect(0, 0, width, EVENT_HEIGHT, 8)
        .endFill()
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(color)
        .drawRoundedRect(3, 3, width - 6, EVENT_HEIGHT - 6, 6)
        .endFill()
    );

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 11,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    titleText.x = 6;
    titleText.y = 4;
    content.addChild(titleText);

    const descText = new PIXI.Text(desc, {
      fill: 0x101010,
      fontSize: 9,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    descText.x = 6;
    descText.y = titleText.y + titleText.height + 1;
    content.addChild(descText);

    const remainingText = new PIXI.Text("", {
      fill: 0x101010,
      fontSize: 10,
    });
    remainingText.x = 6;
    remainingText.y = EVENT_HEIGHT - 16;
    content.addChild(remainingText);

    hoverTextNodes.push(titleText, descText, remainingText);

    const view = {
      container: cont,
      event: eventInst,
      remainingText,
      hoverTextNodes,
      setHoverActive,
    };

    cont.on("pointerenter", () => {
      if (!interaction?.canShowHoverUI?.()) return;
      if (activeTagDrag) return;
      setActiveHover({
        view,
        kind: "event",
        col,
        clear: () => clearEventHover(view),
      });
      setHoverActive(true);
      elevateForHover(cont);
      const anchor = getScaledAnchorRect(
        cont,
        width,
        EVENT_HEIGHT,
        GAMEPIECE_HOVER_SCALE
      );
      setHoverContext("event", col, span, anchor);
      tooltipView?.show?.(
        {
          title,
          lines: desc ? [desc] : [],
          scale: GAMEPIECE_HOVER_SCALE,
        },
        anchor
      );
    });

    cont.on("pointerleave", () => {
      if (activeHover?.view && activeHover.view !== view) return;
      clearActiveHover(view);
    });

    const startX =
      span > 1
        ? getBoardColumnX(app.screen.width, col)
        : layoutBoardColPos(app.screen.width, col, EVENT_WIDTH, EVENT_ROW_Y).x;
    cont.x = startX;
    cont.y = EVENT_ROW_Y;

    eventLayer.addChild(cont);

    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    return view;
  }

  function updateEventRemaining(view, state) {
    const expires = view.event?.expiresSec;
    if (expires == null) {
      view.remainingText.text = "";
      return;
    }
    const remaining = Math.max(0, (expires ?? 0) - (state?.tSec ?? 0));
    view.remainingText.text = `T-${remaining}s`;
  }

  // --------------------------------------------------------
  // Permanent view
  // --------------------------------------------------------

  function buildHubStructureView(structureInst, col, opts = {}) {
    const { title, lines, color, meters } =
      getHubStructureUi(structureInst);
    const span =
      Number.isFinite(structureInst.span) && structureInst.span > 0
        ? Math.floor(structureInst.span)
        : 1;
    const width = HUB_STRUCTURE_WIDTH * span + HUB_COL_GAP * (span - 1);
    const height = HUB_STRUCTURE_HEIGHT;

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    cont.zIndex = 1;
    const hoverTextNodes = [];
    const hoverTextBaseNodes = [];
    const { content, setActive: setHoverActive } = attachHoverFx(
      cont,
      width,
      height,
      10,
      () => hoverTextNodes
    );

    const baseBg = new PIXI.Graphics()
      .beginFill(0x3a3a3a)
      .drawRoundedRect(0, 0, width, height, 10)
      .endFill();
    content.addChild(baseBg);

    const cardFill = new PIXI.Graphics()
      .beginFill(color)
      .drawRoundedRect(3, 3, width - 6, height - 6, 8)
      .endFill();
    content.addChild(cardFill);

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 12,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    titleText.x = 6;
    titleText.y = 6;
    content.addChild(titleText);
    hoverTextBaseNodes.push(titleText);
    hoverTextNodes.push(titleText);

    let y = titleText.y + titleText.height + 2;
    const lineTextNodes = [];
    for (const line of lines) {
      const t = new PIXI.Text(line, {
        fill: 0x000000,
        fontSize: 10,
        wordWrap: true,
        wordWrapWidth: width - 12,
      });
      t.x = 6;
      t.y = y;
      content.addChild(t);
      lineTextNodes.push(t);
      hoverTextBaseNodes.push(t);
      hoverTextNodes.push(t);
      y += t.height + 1;
      if (y > height - 40) break;
    }

    let meterViews = [];
    if (meters.length > 0) {
      const meterResult = createMeters(
        content,
        meters,
        structureInst,
        y + 2,
        width - 14
      );
      meterViews = meterResult.meterViews;
      y = meterResult.nextY;
      for (const mv of meterViews) {
        if (mv?.labelText) hoverTextNodes.push(mv.labelText);
      }
    }

    const tagContainer = new PIXI.Container();
    const tagStartY = Math.min(y + 4, height - 12);
    const tagMaxY = height - 6;
    tagContainer.x = Math.max(
      0,
      Math.round((width - HUB_TAG_LAYOUT.PILL_WIDTH) / 2)
    );
    tagContainer.y = tagStartY;
    content.addChild(tagContainer);

    const apOverlay = createApOverlay(width, height, 10);
    content.addChild(apOverlay);

    const focusOutline = new PIXI.Graphics();
    focusOutline.lineStyle(2, 0x7fd0ff, 1);
    focusOutline.drawRoundedRect(2, 2, width - 4, height - 4, 8);
    focusOutline.visible = false;
    content.addChild(focusOutline);

    const cancelButton = new PIXI.Container();
    cancelButton.eventMode = "static";
    cancelButton.cursor = "pointer";
    cancelButton.x = Math.max(6, width - 58);
    cancelButton.y = 6;
    cancelButton.visible = !!getBuildProcess(structureInst);

    const cancelBg = new PIXI.Graphics()
      .beginFill(0x8a1f2a, 0.9)
      .drawRoundedRect(0, 0, 52, 16, 6)
      .endFill();
    cancelButton.addChild(cancelBg);

    const cancelText = new PIXI.Text("Cancel", {
      fill: 0xffffff,
      fontSize: 9,
      fontWeight: "bold",
    });
    cancelText.x = 6;
    cancelText.y = 2;
    cancelButton.addChild(cancelText);

    cancelButton.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      if (typeof queueActionWhenPaused !== "function" || !dispatchAction) return;
      const anchorCol = Number.isFinite(structureInst?.col)
        ? Math.floor(structureInst.col)
        : Number.isFinite(col)
        ? Math.floor(col)
        : 0;
      queueActionWhenPaused(() => {
        const state = getGameState?.();
        const nowSec = Math.floor(state?.tSec ?? 0);
        const buildProcess = getBuildProcess(structureInst);
        const startedSec = Number.isFinite(buildProcess?.startSec)
          ? Math.floor(buildProcess.startSec)
          : null;
        const isSameSec = startedSec != null && startedSec === nowSec;
        const buildKey = `hub:${anchorCol}`;

        if (isSameSec && actionPlanner?.removeIntent) {
          const removeRes = actionPlanner.removeIntent(`build:${buildKey}`);
          if (removeRes?.ok) return removeRes;
        }

        return dispatchAction(
          ActionKinds.BUILD_CANCEL,
          { hubCol: anchorCol, defId: structureInst.defId },
          { apCost: 0 }
        );
      });
    });

    content.addChild(cancelButton);

    function structureHasInventory() {
      const s = getGameState?.();
      return !!s?.ownerInventories?.[structureInst.instanceId];
    }

    const view = {
      container: cont,
      content,
      structure: structureInst,
      col,
      isHovered: false,
      pawnCount: 0,
      meterViews,
      lineTextNodes,
      titleText,
      hoverTextBaseNodes,
      tagContainer,
      tagStartY,
      tagMaxY,
      tagSignature: "",
      tagEntries: [],
      expandedTagId: null,
      hasTagToggle: false,
      ignoreNextTagTap: false,
      tagDrag: null,
      holdHoverForOccupant: false,
      hoverTextNodes,
      structureHasInventory,
      setHoverActive,
      cardFill,
      cardFillColor: color,
      cardWidth: width,
      cardHeight: height,
      uiSignature: null,
      apOverlay,
      apOverlayAlpha: 0,
      apOverlayTarget: 0,
      focusOutline,
      isFocused: false,
      cancelButton,
    };

    if (opts?.expandedTagId) {
      view.expandedTagId = opts.expandedTagId;
    }

    hubTagUi?.rebuildStructureTags?.(view, structureInst);

    cont.on("pointerenter", () => {
      if (!interaction?.canShowHoverUI?.()) return;
      if (activeTagDrag) return;
      setActiveHover({
        view,
        kind: "hub",
        col,
        clear: () => clearHubStructureHover(view),
      });
      if (view.isHovered) return;
      applyHubStructureHover(view);
    });

    cont.on("pointerleave", () => {
      if (activeHover?.view && activeHover.view !== view) return;
      if (holdHoverForOccupantIfNeeded(view)) return;
      clearActiveHover(view);
    });

    cont.on("pointertap", () => {
      if (inventoryView && structureHasInventory()) {
        inventoryView.togglePinned(structureInst.instanceId);
      }
    });

    const pos =
      span > 1
        ? { x: getHubColumnX(app.screen.width, col), y: HUB_STRUCTURE_ROW_Y }
        : layoutHubColPos(
            app.screen.width,
            col,
            HUB_STRUCTURE_WIDTH,
            HUB_STRUCTURE_ROW_Y
          );
    cont.x = pos.x;
    cont.y = pos.y;

    hubStructuresLayer.addChild(cont);

    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    return view;
  }

  // --------------------------------------------------------
  // sync helpers
  // --------------------------------------------------------

  function getPawnCountsByCol(state, cols) {
    const countLen = Number.isFinite(cols) ? Math.max(0, cols) : BOARD_COLS;
    const counts = new Array(countLen).fill(0);
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    for (const ch of chars) {
      const col = Number.isFinite(ch?.envCol)
        ? Math.floor(ch.envCol)
        : null;
      if (col == null || col < 0 || col >= counts.length) continue;
      counts[col] += 1;
    }
    return counts;
  }

  function getPawnCountsByHub(state, cols) {
    const countLen = Number.isFinite(cols) ? Math.max(0, cols) : HUB_COLS;
    const counts = new Array(countLen).fill(0);
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    for (const ch of chars) {
      const col = Number.isFinite(ch?.hubCol)
        ? Math.floor(ch.hubCol)
        : null;
      if (col == null || col < 0 || col >= counts.length) continue;
      counts[col] += 1;
    }
    return counts;
  }

  function syncTiles(state, cols) {
    const tileOcc = state?.board?.occ?.tile;
    const pawnCounts = getPawnCountsByCol(state, cols);

    for (let col = 0; col < cols; col++) {
      const tileInst = tileOcc?.[col] || null;
      const view = tileViews[col];

      if (!tileInst) {
        if (view) {
          if (activeHover?.view === view) clearActiveHover(view);
          removeFromParent(view.container);
          tileViews[col] = undefined;
        }
        continue;
      }

      if (!view || view.tile?.defId !== tileInst.defId) {
        if (view) {
          if (activeHover?.view === view) clearActiveHover(view);
          removeFromParent(view.container);
        }
        tileViews[col] = buildTileView(tileInst, col);
      }

      const activeView = tileViews[col];
      if (activeView) {
        updateTileView(activeView, tileInst, pawnCounts[col] || 0);
      }
    }
  }

  function syncEvents(state, cols) {
    const occ = state?.board?.occ?.event;
    const seen = new Set();

    syncEventSlots(cols);

    for (let col = 0; col < cols; col++) {
      const eventInst = occ?.[col] || null;
      if (!eventInst) continue;

      const anchorCol = Number.isFinite(eventInst.col)
        ? Math.floor(eventInst.col)
        : col;
      if (anchorCol !== col) continue;

      const id = eventInst.instanceId ?? col;
      seen.add(id);

        const existing = eventViews.get(id);
        if (!existing || existing.event.instanceId !== eventInst.instanceId) {
          if (existing) removeFromParent(existing.container);
          eventViews.set(id, buildEventView(eventInst, col));
        }

      const view = eventViews.get(id);
      if (view) updateEventRemaining(view, state);
    }

      for (const [id, view] of eventViews.entries()) {
        if (seen.has(id)) continue;
        if (activeHover?.view === view) clearActiveHover(view);
        removeFromParent(view.container);
        eventViews.delete(id);
      }
  }

  function buildEventSlotView(col) {
    const cont = new PIXI.Container();
    cont.eventMode = "none";
    cont.zIndex = 0;
    const bg = new PIXI.Graphics()
      .lineStyle(1, 0x2a2f3d, 0.6)
      .beginFill(0x1a1f2a, 0.2)
      .drawRoundedRect(0, 0, EVENT_WIDTH, EVENT_HEIGHT, 8)
      .endFill();
    cont.addChild(bg);

    const pos = layoutBoardColPos(
      app.screen.width,
      col,
      EVENT_WIDTH,
      EVENT_ROW_Y
    );
    cont.x = pos.x;
    cont.y = pos.y;

    eventLayer.addChild(cont);
    return cont;
  }

  function syncEventSlots(cols) {
    for (let col = 0; col < cols; col++) {
      let view = eventSlotViews[col];
      if (!view) {
        view = buildEventSlotView(col);
        eventSlotViews[col] = view;
      } else {
        const pos = layoutBoardColPos(
          app.screen.width,
          col,
          EVENT_WIDTH,
          EVENT_ROW_Y
        );
        view.x = pos.x;
        view.y = pos.y;
      }
    }

    for (let i = cols; i < eventSlotViews.length; i++) {
      removeFromParent(eventSlotViews[i]);
    }
    eventSlotViews.length = cols;
  }

  function buildHubSlotView(col) {
    const cont = new PIXI.Container();
    cont.eventMode = "none";
    cont.zIndex = 0;
    const bg = new PIXI.Graphics()
      .lineStyle(2, 0x2a2f3d, 0.85)
      .beginFill(0x1a1f2a, 0.35)
      .drawRoundedRect(
        0,
        0,
        HUB_STRUCTURE_WIDTH,
        HUB_STRUCTURE_HEIGHT,
        10
      )
      .endFill();
    cont.addChild(bg);

    const apOverlay = createApOverlay(
      HUB_STRUCTURE_WIDTH,
      HUB_STRUCTURE_HEIGHT,
      10
    );
    cont.addChild(apOverlay);

    const pos = layoutHubColPos(
      app.screen.width,
      col,
      HUB_STRUCTURE_WIDTH,
      HUB_STRUCTURE_ROW_Y
    );
    cont.x = pos.x;
    cont.y = pos.y;

    hubStructuresLayer.addChild(cont);
    return {
      container: cont,
      col,
      apOverlay,
      apOverlayAlpha: 0,
      apOverlayTarget: 0,
    };
  }

  function syncHubSlots(cols) {
    for (let col = 0; col < cols; col++) {
      let view = hubSlotViews[col];
      if (!view) {
        view = buildHubSlotView(col);
        hubSlotViews[col] = view;
      } else {
        const pos = layoutHubColPos(
          app.screen.width,
          col,
          HUB_STRUCTURE_WIDTH,
          HUB_STRUCTURE_ROW_Y
        );
        view.container.x = pos.x;
        view.container.y = pos.y;
      }
    }

    for (let i = cols; i < hubSlotViews.length; i++) {
      removeFromParent(hubSlotViews[i]?.container);
    }
    hubSlotViews.length = cols;
  }

  function syncHubStructures(state, cols) {
    const occ = state?.hub?.occ;
    const seen = new Set();
    const pawnCounts = getPawnCountsByHub(state, cols);

    syncHubSlots(cols);

    for (let col = 0; col < cols; col++) {
      const structureInst = occ?.[col] || null;
      if (!structureInst) continue;

      const anchorCol = Number.isFinite(structureInst.col)
        ? Math.floor(structureInst.col)
        : col;
      if (anchorCol !== col) continue;

      const id = structureInst.instanceId ?? col;
      seen.add(id);

        const existing = hubStructureViews.get(id);
        if (
          !existing ||
          existing.structure.instanceId !== structureInst.instanceId
        ) {
          if (existing) removeFromParent(existing.container);
          const expandedTagId = hubExpandedTagById.get(structureInst.instanceId) ?? null;
          hubStructureViews.set(
            id,
            buildHubStructureView(structureInst, col, { expandedTagId })
          );
        } else {
          existing.structure = structureInst;
          existing.col = anchorCol;
        }
    }

      for (const [id, view] of hubStructureViews.entries()) {
      if (seen.has(id)) continue;
      if (activeHover?.view === view) clearActiveHover(view);
      removeFromParent(view.container);
      hubStructureViews.delete(id);
      }

    for (const view of hubStructureViews.values()) {
      const col = Number.isFinite(view.col) ? view.col : 0;
      view.pawnCount = pawnCounts[col] || 0;
      updateHubStructureViewUi(view, view.structure);
      if (view.meterViews.length > 0) {
        updateMeters(view.meterViews, view.structure);
      }
      const tags = Array.isArray(view.structure?.tags)
        ? view.structure.tags
        : [];
      const signature = tags.join("|");
      if (signature !== view.tagSignature) {
        hubTagUi?.rebuildStructureTags?.(view, view.structure);
      } else {
        hubTagUi?.updateTagEntries?.(view, view.structure);
      }
    }
  }

  // --------------------------------------------------------
  // rebuildAll
  // --------------------------------------------------------

  function rebuildAll() {
    const pendingHover = activeHover
      ? { kind: activeHover.kind, col: activeHover.col }
      : null;
    const pendingPointer = lastPointerPos
      ? { x: lastPointerPos.x, y: lastPointerPos.y }
      : null;
    if (activeHover) clearActiveHover();

    hubExpandedTagById.clear();
    for (const view of hubStructureViews.values()) {
      const id = view?.structure?.instanceId;
      if (id == null) continue;
      if (view.expandedTagId) {
        hubExpandedTagById.set(id, view.expandedTagId);
      }
    }

    tileLayer.removeChildren();
    eventLayer.removeChildren();
    hubStructuresLayer.removeChildren();
    hoverLayer?.removeChildren?.();
    tileViews.length = 0;
    eventViews.clear();
    eventSlotViews.length = 0;
    hubStructureViews.clear();
    hubSlotViews.length = 0;

    const s = getGameState?.();
    if (!s?.board) return;

    const cols = Number.isFinite(s.board.cols) ? s.board.cols : BOARD_COLS;
    const hubCols = Array.isArray(s?.hub?.slots)
      ? s.hub.slots.length
      : HUB_COLS;
    syncTiles(s, cols);
    syncEvents(s, cols);
    syncHubStructures(s, hubCols);

    restoreHoverAfterRebuild(pendingHover, pendingPointer);
  }

  // --------------------------------------------------------
  // update
  // --------------------------------------------------------

  function updateApDragOverlays(dt) {
    const drag = interaction?.getDragged?.();
    const isCharDrag = drag?.type === "character" && drag?.id != null;
    const charId = isCharDrag ? drag.id : null;
    const state = getGameState?.();
    const envCols = Number.isFinite(state?.board?.cols)
      ? Math.floor(state.board.cols)
      : BOARD_COLS;
    const hubCols = Array.isArray(state?.hub?.slots)
      ? state.hub.slots.length
      : HUB_COLS;

    const invalidEnv = new Set();
    const invalidHub = new Set();

    if (isCharDrag && typeof actionPlanner?.getPawnMoveAffordability === "function") {
      for (let col = 0; col < envCols; col++) {
        const aff = actionPlanner.getPawnMoveAffordability({
          charId,
          toEnvCol: col,
        });
        if (aff?.ok && aff.affordable === false) invalidEnv.add(col);
      }
      for (let col = 0; col < hubCols; col++) {
        const aff = actionPlanner.getPawnMoveAffordability({
          charId,
          toHubCol: col,
        });
        if (aff?.ok && aff.affordable === false) invalidHub.add(col);
      }
    }

    for (const view of tileViews) {
      if (!view) continue;
      const col = Number.isFinite(view.col) ? Math.floor(view.col) : null;
      const isInvalid = isCharDrag && col != null && invalidEnv.has(col);
      view.apOverlayTarget = isInvalid ? AP_OVERLAY_ALPHA : 0;
      updateApOverlay(view, dt);
    }

    const coveredHubCols = new Set();
    for (const view of hubStructureViews.values()) {
      const structure = view.structure;
      const def = structure ? hubStructureDefs[structure.defId] : null;
      const base = Number.isFinite(structure?.col)
        ? Math.floor(structure.col)
        : Number.isFinite(view?.col)
        ? Math.floor(view.col)
        : 0;
      const span =
        Number.isFinite(structure?.span) && structure.span > 0
          ? Math.floor(structure.span)
          : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
          ? Math.floor(def.defaultSpan)
          : 1;
      let invalid = false;
      for (let c = base; c < base + span; c++) {
        coveredHubCols.add(c);
        if (isCharDrag && invalidHub.has(c)) invalid = true;
      }
      view.apOverlayTarget = invalid ? AP_OVERLAY_ALPHA : 0;
      updateApOverlay(view, dt);
    }

    for (const view of hubSlotViews) {
      if (!view) continue;
      const col = Number.isFinite(view.col) ? Math.floor(view.col) : null;
      const isInvalid =
        isCharDrag &&
        col != null &&
        !coveredHubCols.has(col) &&
        invalidHub.has(col);
      view.apOverlayTarget = isInvalid ? AP_OVERLAY_ALPHA : 0;
      updateApOverlay(view, dt);
    }

    let hoverInvalid = false;
    if (isCharDrag && lastPointerPos) {
      for (const view of tileViews) {
        if (!view) continue;
        const col = Number.isFinite(view.col) ? Math.floor(view.col) : null;
        if (col == null || !invalidEnv.has(col)) continue;
        if (isPointerInsideView(view, lastPointerPos)) {
          hoverInvalid = true;
          break;
        }
      }

      if (!hoverInvalid) {
        for (const view of hubStructureViews.values()) {
          if (!view?.apOverlayTarget) continue;
          if (isPointerInsideView(view, lastPointerPos)) {
            hoverInvalid = true;
            break;
          }
        }
      }

      if (!hoverInvalid) {
        for (const view of hubSlotViews) {
          if (!view) continue;
          const col = Number.isFinite(view.col) ? Math.floor(view.col) : null;
          if (col == null || coveredHubCols.has(col)) continue;
          if (!invalidHub.has(col)) continue;
          if (isPointerInsideView(view, lastPointerPos)) {
            hoverInvalid = true;
            break;
          }
        }
      }
    }

    setApDragWarningSafe(hoverInvalid);
  }

  function update(dt) {
    const s = getGameState?.();
    if (!s?.board) return;

    const cols = Number.isFinite(s.board.cols) ? s.board.cols : BOARD_COLS;
    const hubCols = Array.isArray(s?.hub?.slots)
      ? s.hub.slots.length
      : HUB_COLS;
    syncTiles(s, cols);
    syncEvents(s, cols);
    syncHubStructures(s, hubCols);
    updatePlanFocus();

    if (activeHover?.view?.holdHoverForOccupant) {
      const view = activeHover.view;
      const kind = activeHover.kind;
      const hoverMatches = isPawnHoveringForView(view, kind);
      if (!hoverMatches) {
        const pos = lastPointerPos;
        if (!pos || !isPointerInsideView(view, pos, TAG_DRAG_RELEASE_PAD)) {
          view.holdHoverForOccupant = false;
          clearActiveHover(view);
        }
      }
    }

    updateApDragOverlays(dt);
  }

  function init() {
    if (!stagePointerMoveHandler) {
      stagePointerMoveHandler = (ev) => trackPointerPos(ev);
      app.stage.on("pointermove", stagePointerMoveHandler);
    }
  }

  function getInventoryOwnerAtGlobalPos(globalPos) {
    if (!globalPos) return null;
    for (const view of hubStructureViews.values()) {
      if (!view?.container?.visible) continue;
      if (!view.structureHasInventory?.()) continue;
      const bounds = view.container.getBounds();
      if (
        globalPos.x >= bounds.x &&
        globalPos.x <= bounds.x + bounds.width &&
        globalPos.y >= bounds.y &&
        globalPos.y <= bounds.y + bounds.height
      ) {
        return view.structure?.instanceId ?? null;
      }
    }
    return null;
  }

  return { init, rebuildAll, update, getInventoryOwnerAtGlobalPos };
}

/**
 * @typedef {Object} BoardEventView
 * @property {PIXI.Container} container
 * @property {any} event
 * @property {PIXI.Text} remainingText
 *
 * @typedef {Object} BoardHubStructureView
 * @property {PIXI.Container} container
 * @property {any} structure
 * @property {Array<any>} meterViews
 */
