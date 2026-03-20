// board-pixi.js
// Renders tiles/events on a 12-column board, with a separate hub row layout.
// VIEW-ONLY: no direct state mutation.

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envStructureDefs } from "../defs/gamepieces/env-structures-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { ActionKinds } from "../model/actions.js";
import { validateHubConstructionPlacement } from "../model/build-helpers.js";
import { isDiscoveryAlwaysVisibleEnvTag } from "../model/discovery.js";
import { normalizeVisibleHubTagOrder } from "../model/hub-tags.js";
import {
  getVisibleEnvColCount,
  isEnvColExposed,
  isEnvColRevealed,
  isHubRenameUnlocked,
  isHubVisible,
} from "../model/state.js";
import { hasEnvTagUnlock, hasHubTagUnlock } from "../model/skills.js";
import { isTagHidden } from "../model/tag-state.js";
import { createTagUi, TAG_LAYOUT } from "./board/board-tag-ui.js";
import { createHubTagUi, HUB_TAG_LAYOUT } from "./board/hub-tag-ui.js";
import { createPillDragController } from "./ui-helpers/pill-drag-controller.js";
import {
  getLiveUiTimeSec,
  shouldSnapProgressAnimation,
} from "./ui-helpers/progress-animation.js";
import { bindTouchLongPress } from "./ui-helpers/touch-long-press.js";
import { createTilePanels } from "./board/board-tile-panels.js";
import { createHubPanels } from "./board/hub-structure-panels.js";
import { createTagOrdersPanel } from "./board/tag-orders-panel.js";
import {
  getEventRevealLockRemainingSec,
} from "./env-event-deck-pixi.js";
import { INTENT_AP_COSTS } from "../defs/gamesettings/action-costs-defs.js";
import {
  VIEW_LAYOUT,
  BOARD_COLS,
  BOARD_COL_WIDTH,
  BOARD_COL_GAP,
  HUB_COLS,
  HUB_COL_WIDTH,
  HUB_COL_GAP,
  TILE_WIDTH,
  TILE_HEIGHT,
  EVENT_WIDTH,
  EVENT_HEIGHT,
  ENV_STRUCTURE_WIDTH,
  ENV_STRUCTURE_HEIGHT,
  HUB_STRUCTURE_WIDTH,
  HUB_STRUCTURE_HEIGHT,
  GAMEPIECE_HOVER_SCALE,
  GAMEPIECE_HOVER_ZOOM_IN_TWEEN_SEC,
  GAMEPIECE_HOVER_ZOOM_OUT_TWEEN_SEC,
  GAMEPIECE_SHADOW_COLOR,
  GAMEPIECE_SHADOW_ALPHA,
  GAMEPIECE_SHADOW_OFFSET_X,
  GAMEPIECE_SHADOW_OFFSET_Y,
  TILE_ROW_Y,
  EVENT_ROW_Y,
  ENV_STRUCTURE_ROW_Y,
  HUB_STRUCTURE_ROW_Y,
} from "./layout-pixi.js";

/**
 * opts:
 *  - app: PIXI.Application
 *  - tileLayer: PIXI.Container
 *  - eventLayer: PIXI.Container
 *  - envStructuresLayer: PIXI.Container
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
 *  - paintStyleController?: { registerPaintContainer?: fn, unregisterPaintContainer?: fn }
 *  - setApDragWarning?: (active: boolean) => void
 *  - screenToWorld?: (point) => { x, y }
 */
export function createBoardView(opts) {
  const {
    app,
    tileLayer,
    eventLayer,
    envStructuresLayer,
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
    paintStyleController,
    setApDragWarning,
    screenToWorld,
    flashActionGhost,
    onSystemIconHover,
    onSystemIconOut,
    onSystemIconClick,
    onProcessCogClick,
    onGamepieceTapForSystemFocus,
    getExternalFocus,
    canStartHoverZoomIn,
  } = opts;

  const tileViews = [];
  /** @type {Map<number, BoardEventView>} */
  const eventViews = new Map();
  const eventSlotViews = [];
  /** @type {Map<number, BoardEnvStructureView>} */
  const envStructureViews = new Map();
  const envStructureSlotViews = [];
  /** @type {Map<number, BoardHubStructureView>} */
  const hubStructureViews = new Map();
  const hubSlotViews = [];
  const hubExpandedTagById = new Map();

  if (tileLayer) tileLayer.sortableChildren = true;
  if (eventLayer) eventLayer.sortableChildren = true;
  if (envStructuresLayer) envStructuresLayer.sortableChildren = true;
  if (hubStructuresLayer) hubStructuresLayer.sortableChildren = true;
  if (hoverLayer) hoverLayer.sortableChildren = true;

  const tileInspectorLayer = inspectorLayer || hoverLayer || tileLayer;

  function canShowGamepieceHoverUiNow() {
    if (typeof interaction?.canShowWorldHoverUI === "function") {
      return interaction.canShowWorldHoverUI() !== false;
    }
    return interaction?.canShowHoverUI?.() !== false;
  }

  const TAG_DRAG_SCALE = 1.06;
  const TAG_DRAG_RELEASE_PAD = 12;
  const AP_OVERLAY_ALPHA = 0.45;
  const AP_OVERLAY_FADE_IN = 14;
  const AP_OVERLAY_FADE_OUT = 8;
  const AP_OVERLAY_FILL = 0x8a1f2a;
  const AP_OVERLAY_STROKE = 0xff4f5e;
  const PAWN_LANDING_OVERLAY_FILL = 0x2d7daa;
  const PAWN_LANDING_OVERLAY_STROKE = 0xd5f3ff;
  const BUILD_PREVIEW_VALID_FILL = 0x2f7a4d;
  const BUILD_PREVIEW_VALID_STROKE = 0x9de3ba;
  const BUILD_PREVIEW_INVALID_FILL = 0x8a2630;
  const BUILD_PREVIEW_INVALID_STROKE = 0xff8d98;
  const OCCUPANT_HOVER_GRACE_SEC = 0.16;
  const DISTRIBUTOR_RANGE_OVERLAY_FILL = 0x2d6b95;
  const DISTRIBUTOR_RANGE_OVERLAY_STROKE = 0x84cbff;
  const DISTRIBUTOR_BASE_RANGE = 1;
  const FEEDBACK_MISS_THROTTLE_SEC = 1;
  const FEEDBACK_MISS_DURATION_SEC = 0.8;
  const FEEDBACK_HIT_DURATION_SEC = 1.05;
  const FEEDBACK_FLOAT_RISE_PX = 30;
  const FEEDBACK_STACK_STEP_PX = 14;
  const FEEDBACK_MAX_STACK = 4;
  const AP_AFFORDABILITY_REFRESH_MS = 100;
  const EVENT_EXPIRY_FX_DURATION_SEC = 0.42;
  const EVENT_EXPIRY_FX_MAX_ACTIVE = 64;
  const EVENT_EXPIRY_FLASH_FILL = 0xd73846;
  const EVENT_EXPIRY_GLOW_STROKE = 0xff8791;
  const EVENT_EXPIRY_TINT_STRENGTH = 0.22;
  const EVENT_EXPIRY_FLOAT_PX = 12;
  const EVENT_EXPIRY_SCALE = 0.07;
  const INVENTORY_DRAG_VALID_OUTLINE = 0x58c7ff;
  const INVENTORY_DRAG_FULL_OUTLINE = 0xffa24f;
  const INVENTORY_DRAG_HOVER_OUTLINE = 0x6bd37b;
  const ACTIVITY_FADE_SPEED = 8;
  const ACTIVITY_BASE_ALPHA = 0.2;
  const ACTIVITY_PULSE_FREQ_HZ = 1.4;
  const ACTIVITY_FORAGE_COLOR = 0x56b67b;
  const ACTIVITY_FISH_COLOR = 0x4d9fdb;
  const ORDERS_BUTTON_WIDTH = 30;
  const ORDERS_BUTTON_HEIGHT = 16;
  const ORDERS_BUTTON_RADIUS = 6;
  const ORDERS_BUTTON_BOTTOM_PAD = 10;
  const ORDERS_BUTTON_TAG_GAP = 4;
  const ORDERS_BUTTON_BG = 0xa7afb8;
  const ORDERS_BUTTON_BG_HOVER = 0xb7bfc8;
  const ORDERS_BUTTON_STROKE = 0xdbe2e8;
  const ORDERS_BUTTON_ICON = 0x4f5862;
  const HOVER_VIEW_SCREEN_PAD = 8;
  const CARD_HEIGHT_TWEEN_SEC = 0.14;
  const HOVER_SCALE_MIN = 0.55;
  const CARD_BOTTOM_PAD = 10;
  const PROCESS_WIDGET_SYSTEM_IDS = new Set([
    "growth",
    "build",
    "cook",
    "craft",
    "residents",
    "deposit",
  ]);
  const BASE_TEXT_RESOLUTION = Math.max(
    2,
    Math.floor(globalThis?.devicePixelRatio || 1)
  );
  const HOVER_TEXT_RESOLUTION = Math.max(
    BASE_TEXT_RESOLUTION,
    Math.ceil(BASE_TEXT_RESOLUTION * GAMEPIECE_HOVER_SCALE)
  );
  const PLAYFIELD_CHROME_LAYOUT = VIEW_LAYOUT.playfield?.chrome || {};
  const REGION_BOARD_LAYOUT = PLAYFIELD_CHROME_LAYOUT.regionBoard || {};
  const HUB_BOARD_LAYOUT = PLAYFIELD_CHROME_LAYOUT.hubBoard || {};
  const REGION_HEADER_LAYOUT = PLAYFIELD_CHROME_LAYOUT.regionHeader || {};
  const HUB_HEADER_LAYOUT = PLAYFIELD_CHROME_LAYOUT.hubHeader || {};

  const REGION_BOARD_PAD_X = Math.max(
    0,
    Number.isFinite(REGION_BOARD_LAYOUT.padX) ? REGION_BOARD_LAYOUT.padX : 34
  );
  const REGION_BOARD_PAD_TOP = Math.max(
    0,
    Number.isFinite(REGION_BOARD_LAYOUT.padTop) ? REGION_BOARD_LAYOUT.padTop : 12
  );
  const REGION_BOARD_PAD_BOTTOM = Math.max(
    0,
    Number.isFinite(REGION_BOARD_LAYOUT.padBottom)
      ? REGION_BOARD_LAYOUT.padBottom
      : 14
  );
  const REGION_BOARD_OFFSET_X = Number.isFinite(REGION_BOARD_LAYOUT.offsetX)
    ? REGION_BOARD_LAYOUT.offsetX
    : 0;
  const REGION_BOARD_OFFSET_Y = Number.isFinite(REGION_BOARD_LAYOUT.offsetY)
    ? REGION_BOARD_LAYOUT.offsetY
    : 0;

  const HUB_BOARD_PAD_X = Math.max(
    0,
    Number.isFinite(HUB_BOARD_LAYOUT.padX) ? HUB_BOARD_LAYOUT.padX : 26
  );
  const HUB_BOARD_PAD_TOP = Math.max(
    0,
    Number.isFinite(HUB_BOARD_LAYOUT.padTop) ? HUB_BOARD_LAYOUT.padTop : 24
  );
  const HUB_BOARD_PAD_BOTTOM = Math.max(
    0,
    Number.isFinite(HUB_BOARD_LAYOUT.padBottom) ? HUB_BOARD_LAYOUT.padBottom : 24
  );
  const HUB_BOARD_OFFSET_X = Number.isFinite(HUB_BOARD_LAYOUT.offsetX)
    ? HUB_BOARD_LAYOUT.offsetX
    : 0;
  const HUB_BOARD_OFFSET_Y = Number.isFinite(HUB_BOARD_LAYOUT.offsetY)
    ? HUB_BOARD_LAYOUT.offsetY
    : 0;

  const REGION_HEADER_HEIGHT = Math.max(
    36,
    Number.isFinite(REGION_HEADER_LAYOUT.height) ? REGION_HEADER_LAYOUT.height : 54
  );
  const REGION_HEADER_WIDTH_RATIO = Number.isFinite(REGION_HEADER_LAYOUT.widthRatio)
    ? REGION_HEADER_LAYOUT.widthRatio
    : 0.38;
  const REGION_HEADER_MIN_WIDTH = Math.max(
    120,
    Number.isFinite(REGION_HEADER_LAYOUT.minWidth)
      ? REGION_HEADER_LAYOUT.minWidth
      : 260
  );
  const REGION_HEADER_MAX_WIDTH = Math.max(
    REGION_HEADER_MIN_WIDTH,
    Number.isFinite(REGION_HEADER_LAYOUT.maxWidth)
      ? REGION_HEADER_LAYOUT.maxWidth
      : 460
  );
  const REGION_HEADER_OFFSET_X = Number.isFinite(REGION_HEADER_LAYOUT.offsetX)
    ? REGION_HEADER_LAYOUT.offsetX
    : 0;
  const REGION_HEADER_OFFSET_Y = Number.isFinite(REGION_HEADER_LAYOUT.offsetY)
    ? REGION_HEADER_LAYOUT.offsetY
    : 0;

  const HUB_HEADER_HEIGHT = Math.max(
    36,
    Number.isFinite(HUB_HEADER_LAYOUT.height) ? HUB_HEADER_LAYOUT.height : 54
  );
  const HUB_HEADER_WIDTH_RATIO = Number.isFinite(HUB_HEADER_LAYOUT.widthRatio)
    ? HUB_HEADER_LAYOUT.widthRatio
    : 0.34;
  const HUB_HEADER_MIN_WIDTH = Math.max(
    120,
    Number.isFinite(HUB_HEADER_LAYOUT.minWidth) ? HUB_HEADER_LAYOUT.minWidth : 260
  );
  const HUB_HEADER_MAX_WIDTH = Math.max(
    HUB_HEADER_MIN_WIDTH,
    Number.isFinite(HUB_HEADER_LAYOUT.maxWidth) ? HUB_HEADER_LAYOUT.maxWidth : 460
  );
  const HUB_HEADER_OFFSET_X = Number.isFinite(HUB_HEADER_LAYOUT.offsetX)
    ? HUB_HEADER_LAYOUT.offsetX
    : 0;
  const HUB_HEADER_OFFSET_Y = Number.isFinite(HUB_HEADER_LAYOUT.offsetY)
    ? HUB_HEADER_LAYOUT.offsetY
    : 0;
  const AREA_NAME_FALLBACKS = Object.freeze({
    region: "Region",
    hub: "Hub",
  });
  let activeTagDrag = null;
  let activeHubTagDrag = null;
  let activeHover = null;
  let focusedTileCol = null;
  let focusedHubCol = null;
  let apDragWarningActive = false;
  let buildDistributorRangePreview = null;
  let buildPlacementPreview = null;
  let iconDistributorRangePreview = null;
  let lastPointerPos = null;
  let stagePointerMoveHandler = null;
  let lastProcessedGameEventId = 0;
  let lastSeenEventSec = null;
  const inventoryDragAffordanceByOwnerId = new Map();
  let eventSlotsLayoutKey = "";
  let envStructureSlotsLayoutKey = "";
  let hubSlotsLayoutKey = "";
  let apAffordabilityCache = {
    signature: "",
    computedAtMs: -1,
    invalidEnv: new Set(),
    invalidHub: new Set(),
  };
  const tileRollFxByCol = new Map();
  const missThrottleByColSec = new Map();
  const activeEventExpiryFx = [];
  let eventSnapshotsById = new Map();
  let areaChrome = null;
  let prevProgressAnimationTimeSec = null;
  const eventExpiryFxLayer = eventLayer ? new PIXI.Container() : null;
  if (eventExpiryFxLayer) {
    eventExpiryFxLayer.sortableChildren = true;
    eventExpiryFxLayer.zIndex = 25;
    eventLayer.addChild(eventExpiryFxLayer);
  }
  const tooltipLayer = tooltipView?.getContainer?.()?.parent;
  const cropDropdownLayer =
    tooltipLayer || hoverLayer || tileInspectorLayer || tileLayer;
  if (cropDropdownLayer) cropDropdownLayer.sortableChildren = true;
  const tilePanels = createTilePanels({
    app,
    interaction,
    actionPlanner,
    getTilePlanPreview: (envCol) => actionPlanner?.getTilePlanPreview?.(envCol) ?? null,
    queueActionWhenPaused,
    dispatchAction,
    dropdownLayer: cropDropdownLayer,
    flashActionGhost,
  });
  const hubPanels = createHubPanels({
    app,
    actionPlanner,
    getHubPlanPreview: (hubCol) => actionPlanner?.getHubPlanPreview?.(hubCol) ?? null,
    queueActionWhenPaused,
    dispatchAction,
    dropdownLayer: cropDropdownLayer,
    flashActionGhost,
    getGameState,
    onOpenRecipeWidget: (view, systemId) => handleSystemIconClick(view, systemId),
  });
  const tagOrdersPanel = createTagOrdersPanel({
    app,
    layer: cropDropdownLayer,
    getGameState,
    getTilePlanPreview: (envCol) => actionPlanner?.getTilePlanPreview?.(envCol) ?? null,
    getHubPlanPreview: (hubCol) => actionPlanner?.getHubPlanPreview?.(hubCol) ?? null,
    isEnvTagVisible,
    isHubTagVisible,
    onToggleTileTag: (payload) => dispatchTileTagToggle(payload),
    onToggleHubTag: (payload) => dispatchHubTagToggle(payload),
    requestPauseForAction,
  });
  let tagUi = null;
  let tileTagDragController = null;
  let hubTagDragController = null;

  function isEnvTagVisible(tagId) {
    if (typeof tagId !== "string" || !tagId.length) return false;
    if (isDiscoveryAlwaysVisibleEnvTag(tagId)) return true;
    const state = getGameState?.();
    if (!state) return true;
    return hasEnvTagUnlock(state, tagId);
  }

  function isHubTagVisible(tagId) {
    if (typeof tagId !== "string" || !tagId.length) return false;
    const state = getGameState?.();
    if (!state) return true;
    return hasHubTagUnlock(state, tagId);
  }

  function getVisibleBoardCols(state = getGameState?.()) {
    const visible = getVisibleEnvColCount(state);
    return Math.max(0, Math.min(Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : BOARD_COLS, visible));
  }

  function getVisibleHubCols(state = getGameState?.()) {
    if (!isHubVisible(state)) return 0;
    return Array.isArray(state?.hub?.slots) ? state.hub.slots.length : HUB_COLS;
  }

  function isTileRevealed(tileInst, state = getGameState?.()) {
    const col = Number.isFinite(tileInst?.col) ? Math.floor(tileInst.col) : null;
    if (state == null || col == null) return true;
    return isEnvColRevealed(state, col);
  }

  function isTileTagRenderable(tileInst, tagId, state = getGameState?.()) {
    if (!isEnvTagVisible(tagId)) return false;
    if (isTagHidden(tileInst, tagId)) return false;
    if (!isTileRevealed(tileInst, state) && tagId !== "explore") return false;
    return true;
  }

  function isHubTagRenderable(structureInst, tagId) {
    if (!isHubTagVisible(tagId)) return false;
    if (isTagHidden(structureInst, tagId)) return false;
    return true;
  }

  function getTileAtCol(state, envCol) {
    const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
    if (col == null || col < 0) return null;
    return state?.board?.occ?.tile?.[col] || null;
  }

  function getHubStructureAtCol(state, hubCol) {
    const col = Number.isFinite(hubCol) ? Math.floor(hubCol) : null;
    if (col == null || col < 0) return null;
    return state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure ?? null;
  }

  function isTagStatePlayerDisabled(entry) {
    if (!entry || typeof entry !== "object") return false;
    const disabledBy =
      entry.disabledBy && typeof entry.disabledBy === "object"
        ? entry.disabledBy
        : null;
    if (disabledBy) return disabledBy.player === true;
    return entry.disabled === true;
  }

  function getTilePlanPreview(envCol) {
    return actionPlanner?.getTilePlanPreview?.(envCol) ?? null;
  }

  function getHubPlanPreview(hubCol) {
    return actionPlanner?.getHubPlanPreview?.(hubCol) ?? null;
  }

  function getEffectiveTileTags(tileInst) {
    const envCol = Number.isFinite(tileInst?.col) ? Math.floor(tileInst.col) : null;
    const preview = envCol != null ? getTilePlanPreview(envCol) : null;
    return Array.isArray(preview?.tagIds)
      ? preview.tagIds
      : Array.isArray(tileInst?.tags)
      ? tileInst.tags
      : [];
  }

  function getEffectiveHubTags(structureInst) {
    const hubCol = Number.isFinite(structureInst?.col)
      ? Math.floor(structureInst.col)
      : null;
    const preview = hubCol != null ? getHubPlanPreview(hubCol) : null;
    return Array.isArray(preview?.tagIds)
      ? preview.tagIds
      : Array.isArray(structureInst?.tags)
      ? structureInst.tags
      : [];
  }

  function isVisibleEnabledTileTag(tileInst, tagId) {
    if (!isTileTagRenderable(tileInst, tagId)) return false;
    const envCol = Number.isFinite(tileInst?.col) ? Math.floor(tileInst.col) : null;
    const preview = envCol != null ? getTilePlanPreview(envCol) : null;
    if (
      preview?.tagDisabledById &&
      Object.prototype.hasOwnProperty.call(preview.tagDisabledById, tagId)
    ) {
      return preview.tagDisabledById[tagId] !== true;
    }
    return !isTagStatePlayerDisabled(tileInst?.tagStates?.[tagId]);
  }

  function isVisibleEnabledHubTag(structureInst, tagId) {
    if (!isHubTagRenderable(structureInst, tagId)) return false;
    const hubCol = Number.isFinite(structureInst?.col)
      ? Math.floor(structureInst.col)
      : null;
    const preview = hubCol != null ? getHubPlanPreview(hubCol) : null;
    if (
      preview?.tagDisabledById &&
      Object.prototype.hasOwnProperty.call(preview.tagDisabledById, tagId)
    ) {
      return preview.tagDisabledById[tagId] !== true;
    }
    return !isTagStatePlayerDisabled(structureInst?.tagStates?.[tagId]);
  }

  function buildTagOrderFromVisible(fullTags, reorderedVisible, isVisibleTag) {
    const base = Array.isArray(fullTags) ? fullTags : [];
    const visible = Array.isArray(reorderedVisible) ? reorderedVisible : [];
    const next = [];
    let visibleIndex = 0;
    for (const tagId of base) {
      if (isVisibleTag(tagId)) {
        const replacement = visible[visibleIndex];
        if (replacement == null) return null;
        next.push(replacement);
        visibleIndex += 1;
      } else {
        next.push(tagId);
      }
    }
    if (visibleIndex !== visible.length) return null;
    return next;
  }

  function getVisibleTileTagSignature(tileInst) {
    const tags = getEffectiveTileTags(tileInst);
    return tags.filter((tagId) => isVisibleEnabledTileTag(tileInst, tagId)).join("|");
  }

  function getVisibleHubTagSignature(structureInst) {
    const tags = getEffectiveHubTags(structureInst);
    return normalizeVisibleHubTagOrder(
      tags.filter((tagId) => isVisibleEnabledHubTag(structureInst, tagId))
    ).join("|");
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function easeOutCubic(value) {
    const t = clamp01(value);
    return 1 - (1 - t) ** 3;
  }

  function mixHexColor(a, b, t) {
    const blend = clamp01(t);
    const ar = (a >> 16) & 0xff;
    const ag = (a >> 8) & 0xff;
    const ab = a & 0xff;
    const br = (b >> 16) & 0xff;
    const bg = (b >> 8) & 0xff;
    const bb = b & 0xff;
    const rr = Math.round(ar + (br - ar) * blend);
    const rg = Math.round(ag + (bg - ag) * blend);
    const rb = Math.round(ab + (bb - ab) * blend);
    return ((rr & 0xff) << 16) | ((rg & 0xff) << 8) | (rb & 0xff);
  }

  function nowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function buildProgressAnimationFrameContext(state, dt) {
    const liveTimeSec = getLiveUiTimeSec(state);
    const snap = shouldSnapProgressAnimation(prevProgressAnimationTimeSec, state);
    prevProgressAnimationTimeSec = liveTimeSec;
    return {
      dtSec: Number.isFinite(dt) ? Math.max(0, dt) : 0,
      liveTimeSec,
      snap,
    };
  }

  function getStructureSpan(structure, fallbackCol = null) {
    const def = hubStructureDefs?.[structure?.defId];
    const span =
      Number.isFinite(structure?.span) && structure.span > 0
        ? Math.floor(structure.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const col = Number.isFinite(structure?.col)
      ? Math.floor(structure.col)
      : Number.isFinite(fallbackCol)
      ? Math.floor(fallbackCol)
      : null;
    return { col, span };
  }

  function spanDistance(aCol, aSpan, bCol, bSpan) {
    const aStart = Number.isFinite(aCol) ? Math.floor(aCol) : 0;
    const bStart = Number.isFinite(bCol) ? Math.floor(bCol) : 0;
    const aLen = Number.isFinite(aSpan) ? Math.max(1, Math.floor(aSpan)) : 1;
    const bLen = Number.isFinite(bSpan) ? Math.max(1, Math.floor(bSpan)) : 1;
    const aEnd = aStart + aLen - 1;
    const bEnd = bStart + bLen - 1;
    if (bStart > aEnd) return bStart - aEnd;
    if (aStart > bEnd) return aStart - bEnd;
    return 0;
  }

  function resolveDistributionRangeByTier(tier, baseRange = DISTRIBUTOR_BASE_RANGE) {
    const base = Number.isFinite(baseRange)
      ? Math.max(0, Math.floor(baseRange))
      : 0;
    const def = hubSystemDefs?.distribution;
    const resolvedTier =
      (typeof tier === "string" && tier.length > 0 ? tier : null) ||
      def?.defaultTier ||
      "bronze";
    const raw = def?.rangeByTier?.[resolvedTier];
    let tierRange = null;
    if (raw === "global") {
      tierRange = Number.POSITIVE_INFINITY;
    } else if (Number.isFinite(raw)) {
      tierRange = Math.max(0, Math.floor(raw));
    } else if (typeof raw === "string") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        tierRange = Math.max(0, Math.floor(parsed));
      }
    }
    if (tierRange == null) tierRange = base;
    return Math.max(base, tierRange);
  }

  function hasDistributorTag(defId) {
    const tags = Array.isArray(hubStructureDefs?.[defId]?.tags)
      ? hubStructureDefs[defId].tags
      : [];
    return tags.includes("distributor");
  }

  function normalizeDistributorRangePreview(preview) {
    const col = Number.isFinite(preview?.hubCol) ? Math.floor(preview.hubCol) : null;
    if (col == null) return null;
    const span =
      Number.isFinite(preview?.span) && preview.span > 0
        ? Math.floor(preview.span)
        : 1;
    const range =
      preview?.range === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Number.isFinite(preview?.range)
        ? Math.max(0, Math.floor(preview.range))
        : null;
    if (range == null) return null;
    return { hubCol: col, span, range };
  }

  function sameDistributorRangePreview(a, b) {
    if (a == null && b == null) return true;
    if (!a || !b) return false;
    return a.hubCol === b.hubCol && a.span === b.span && a.range === b.range;
  }

  function buildDistributorRangePreviewFromSpec(spec) {
    const defId = typeof spec?.defId === "string" ? spec.defId : null;
    if (!defId || !hasDistributorTag(defId)) return null;
    const hubCol = Number.isFinite(spec?.hubCol) ? Math.floor(spec.hubCol) : null;
    if (hubCol == null) return null;
    const def = hubStructureDefs?.[defId];
    const span =
      Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const range = resolveDistributionRangeByTier(
      hubSystemDefs?.distribution?.defaultTier,
      DISTRIBUTOR_BASE_RANGE
    );
    return normalizeDistributorRangePreview({ hubCol, span, range });
  }

  function buildDistributorRangePreviewFromView(view) {
    const structure = view?.structure;
    if (!structure || !hasDistributorTag(structure.defId)) return null;
    const spanInfo = getStructureSpan(structure, view?.col);
    if (spanInfo.col == null) return null;
    const range = resolveDistributionRangeByTier(
      structure?.systemTiers?.distribution,
      DISTRIBUTOR_BASE_RANGE
    );
    return normalizeDistributorRangePreview({
      hubCol: spanInfo.col,
      span: spanInfo.span,
      range,
    });
  }

  function normalizeBuildPlacementPreview(spec) {
    const defId = typeof spec?.defId === "string" ? spec.defId : null;
    if (!defId) return null;
    const placementMode = spec?.placementMode === "upgrade" ? "upgrade" : "new";
    const hubCol = Number.isFinite(spec?.hubCol) ? Math.floor(spec.hubCol) : null;
    const upgradeFromDefIds = Array.isArray(spec?.upgradeFromDefIds)
      ? spec.upgradeFromDefIds.filter((id) => typeof id === "string" && id.length > 0)
      : [];
    return { defId, placementMode, hubCol, upgradeFromDefIds };
  }

  function sameBuildPlacementPreview(left, right) {
    if (left == null && right == null) return true;
    if (!left || !right) return false;
    if (left.defId !== right.defId) return false;
    if (left.placementMode !== right.placementMode) return false;
    if (left.hubCol !== right.hubCol) return false;
    const leftIds = Array.isArray(left.upgradeFromDefIds) ? left.upgradeFromDefIds : [];
    const rightIds = Array.isArray(right.upgradeFromDefIds) ? right.upgradeFromDefIds : [];
    if (leftIds.length !== rightIds.length) return false;
    for (let i = 0; i < leftIds.length; i += 1) {
      if (leftIds[i] !== rightIds[i]) return false;
    }
    return true;
  }

  function getMaxEventFeedId(feed) {
    const list = Array.isArray(feed) ? feed : [];
    let maxId = 0;
    for (const entry of list) {
      const id = Number.isFinite(entry?.id) ? Math.floor(entry.id) : 0;
      if (id > maxId) maxId = id;
    }
    return maxId;
  }

  function clearTileRollFxList(list) {
    if (!Array.isArray(list)) return;
    for (const fx of list) {
      removeFromParent(fx?.container);
    }
    list.length = 0;
  }

  function clearTileRollFxForCol(col) {
    if (!Number.isFinite(col)) return;
    const key = Math.floor(col);
    const list = tileRollFxByCol.get(key);
    clearTileRollFxList(list);
    tileRollFxByCol.delete(key);
    missThrottleByColSec.delete(key);
  }

  function clearTileFeedbackRuntime() {
    for (const list of tileRollFxByCol.values()) {
      clearTileRollFxList(list);
    }
    tileRollFxByCol.clear();
    missThrottleByColSec.clear();
  }

  function ensureEventExpiryFxLayerAttached() {
    if (!eventLayer || !eventExpiryFxLayer) return;
    if (eventExpiryFxLayer.parent === eventLayer) return;
    eventLayer.addChild(eventExpiryFxLayer);
  }

  function clearEventExpiryFxRuntime() {
    for (const fx of activeEventExpiryFx) {
      removeFromParent(fx?.container);
    }
    activeEventExpiryFx.length = 0;
  }

  function collectEventSnapshots(state, cols) {
    const snapshots = new Map();
    const occ = state?.board?.occ?.event;
    for (let col = 0; col < cols; col++) {
      const eventInst = occ?.[col] || null;
      if (!eventInst) continue;
      const anchorCol = Number.isFinite(eventInst.col)
        ? Math.floor(eventInst.col)
        : col;
      if (anchorCol !== col) continue;

      const id = eventInst.instanceId ?? col;
      const span =
        Number.isFinite(eventInst.span) && eventInst.span > 0
          ? Math.floor(eventInst.span)
          : 1;
      const expiresSec = Number.isFinite(eventInst.expiresSec)
        ? Math.floor(eventInst.expiresSec)
        : null;
      const { color } = getEventUi(eventInst);

      snapshots.set(id, {
        id,
        defId: eventInst.defId ?? null,
        col: anchorCol,
        span,
        color,
        expiresSec,
        expiresOnSeasonChange:
          eventInst?.expiresOnSeasonChange === true ||
          envEventDefs?.[eventInst?.defId]?.expiresOnSeasonChange === true,
      });
    }
    return snapshots;
  }

  function getEventSnapshotMetrics(snapshot) {
    const col = Number.isFinite(snapshot?.col) ? Math.floor(snapshot.col) : 0;
    const span =
      Number.isFinite(snapshot?.span) && snapshot.span > 0
        ? Math.floor(snapshot.span)
        : 1;
    const width = EVENT_WIDTH * span + BOARD_COL_GAP * (span - 1);
    const x =
      span > 1
        ? getBoardColumnXForVisibleCols(app.screen.width, col)
        : layoutBoardColPosForVisibleCols(
            app.screen.width,
            col,
            EVENT_WIDTH,
            EVENT_ROW_Y
          ).x;
    return {
      x,
      y: EVENT_ROW_Y,
      width,
      height: EVENT_HEIGHT,
      centerX: x + width * 0.5,
      centerY: EVENT_ROW_Y + EVENT_HEIGHT * 0.5,
    };
  }

  function pushEventExpiryFx(snapshot, direction) {
    if (!snapshot || !eventExpiryFxLayer) return;
    ensureEventExpiryFxLayerAttached();
    const metrics = getEventSnapshotMetrics(snapshot);
    const radius = 8;
    const container = new PIXI.Container();
    container.eventMode = "none";
    container.x = metrics.centerX;
    container.y = metrics.centerY;
    container.zIndex = 30;

    const flash = new PIXI.Graphics()
      .beginFill(EVENT_EXPIRY_FLASH_FILL, 1)
      .drawRoundedRect(
        -metrics.width * 0.5,
        -metrics.height * 0.5,
        metrics.width,
        metrics.height,
        radius
      )
      .endFill();

    const tint = new PIXI.Graphics()
      .beginFill(snapshot.color ?? 0xffffff, 1)
      .drawRoundedRect(
        -metrics.width * 0.5,
        -metrics.height * 0.5,
        metrics.width,
        metrics.height,
        radius
      )
      .endFill();

    const glow = new PIXI.Graphics()
      .lineStyle(2, EVENT_EXPIRY_GLOW_STROKE, 1)
      .drawRoundedRect(
        -metrics.width * 0.5,
        -metrics.height * 0.5,
        metrics.width,
        metrics.height,
        radius
      );
    container.addChild(flash, tint, glow);
    eventExpiryFxLayer.addChild(container);

    flash.blendMode = PIXI.BLEND_MODES.ADD;
    glow.blendMode = PIXI.BLEND_MODES.ADD;
    flash.alpha = 0;
    tint.alpha = 0;
    glow.alpha = 0;

    activeEventExpiryFx.push({
      container,
      flash,
      tint,
      glow,
      direction: direction === "reverse" ? "reverse" : "forward",
      elapsedSec: 0,
      durationSec: EVENT_EXPIRY_FX_DURATION_SEC,
      baseY: metrics.centerY,
    });

    while (activeEventExpiryFx.length > EVENT_EXPIRY_FX_MAX_ACTIVE) {
      const oldest = activeEventExpiryFx.shift();
      removeFromParent(oldest?.container);
    }
  }

  function updateEventExpiryFx(dt) {
    if (!eventExpiryFxLayer) return;
    ensureEventExpiryFxLayerAttached();
    const frameDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    for (let i = activeEventExpiryFx.length - 1; i >= 0; i--) {
      const fx = activeEventExpiryFx[i];
      if (!fx?.container) {
        activeEventExpiryFx.splice(i, 1);
        continue;
      }
      fx.elapsedSec += frameDt;
      const progress = clamp01(fx.elapsedSec / (fx.durationSec || 0.0001));
      const playback =
        fx.direction === "reverse" ? 1 - progress : progress;

      const flashPeakSec = 0.18;
      const flashRamp =
        playback <= flashPeakSec
          ? playback / flashPeakSec
          : 1 - (playback - flashPeakSec) / (1 - flashPeakSec);
      const flashAlpha = Math.max(0, flashRamp) * 0.64;
      const drift = EVENT_EXPIRY_FLOAT_PX * easeOutCubic(playback);
      const scale = 1 + EVENT_EXPIRY_SCALE * easeOutCubic(playback);
      const glowAlpha = (1 - Math.abs(playback - flashPeakSec) / 0.6) * 0.45;
      const tintAlpha = EVENT_EXPIRY_TINT_STRENGTH * (1 - playback);

      fx.container.y = fx.baseY - drift;
      fx.container.scale.set(scale);
      fx.flash.alpha = flashAlpha;
      fx.tint.alpha = Math.max(0, tintAlpha);
      fx.glow.alpha = Math.max(0, glowAlpha);

      if (progress >= 1) {
        removeFromParent(fx.container);
        activeEventExpiryFx.splice(i, 1);
      }
    }
  }

  function syncEventExpiryFxFromTimelineState(state, cols) {
    const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : null;
    const currentSnapshots = collectEventSnapshots(state, cols);

    if (nowSec == null || lastSeenEventSec == null) {
      lastSeenEventSec = nowSec;
      eventSnapshotsById = currentSnapshots;
      return;
    }

    if (nowSec > lastSeenEventSec) {
      for (const [id, previousSnapshot] of eventSnapshotsById.entries()) {
        if (currentSnapshots.has(id)) continue;
        const expiresSec = previousSnapshot?.expiresSec;
        const expiredByTime =
          Number.isFinite(expiresSec) &&
          expiresSec > lastSeenEventSec &&
          expiresSec <= nowSec;
        const expiredBySeason =
          state?._seasonChanged === true && previousSnapshot?.expiresOnSeasonChange === true;
        if (expiredByTime || expiredBySeason) {
          pushEventExpiryFx(previousSnapshot, "forward");
        }
      }
    } else if (nowSec < lastSeenEventSec) {
      for (const [id, currentSnapshot] of currentSnapshots.entries()) {
        if (eventSnapshotsById.has(id)) continue;
        const expiresSec = currentSnapshot?.expiresSec;
        if (!Number.isFinite(expiresSec)) continue;
        if (expiresSec > nowSec && expiresSec <= lastSeenEventSec) {
          pushEventExpiryFx(currentSnapshot, "reverse");
        }
      }
    }

    lastSeenEventSec = nowSec;
    eventSnapshotsById = currentSnapshots;
  }

  function getEventRevealRemainingSec(eventInst) {
    const eventId = Number.isFinite(eventInst?.instanceId)
      ? Math.floor(eventInst.instanceId)
      : null;
    if (eventId == null) return 0;
    return getEventRevealLockRemainingSec(eventId);
  }

  function isTileTagDisabled(tileInst, tagId) {
    return tileInst?.tagStates?.[tagId]?.disabled === true;
  }

  function getActiveTileTagIds(tileInst, pawnCount) {
    const tags = Array.isArray(tileInst?.tags) ? tileInst.tags : [];
    const enabled = [];
    for (const tagId of tags) {
      if (!isEnvTagVisible(tagId)) continue;
      if (isTileTagDisabled(tileInst, tagId)) continue;
      enabled.push(tagId);
    }
    const count =
      Number.isFinite(pawnCount) && pawnCount > 0 ? Math.floor(pawnCount) : 0;
    return new Set(count > 0 ? enabled.slice(0, count) : []);
  }

  function drawCardOuterBg(graphic, width, height, radius, color = 0x3a3a3a) {
    if (!graphic) return;
    graphic.clear();
    graphic.beginFill(color);
    graphic.drawRoundedRect(0, 0, Math.max(1, width), Math.max(1, height), radius);
    graphic.endFill();
  }

  function drawCardInnerFill(graphic, width, height, radius, color) {
    if (!graphic) return;
    graphic.clear();
    graphic.beginFill(color);
    graphic.drawRoundedRect(
      3,
      3,
      Math.max(0, width - 6),
      Math.max(0, height - 6),
      Math.max(0, radius - 2)
    );
    graphic.endFill();
  }

  function drawTileActivityOverlay(graphic, width, height, color) {
    if (!graphic) return;
    graphic.clear();
    graphic.beginFill(color, 1);
    graphic.drawRoundedRect(3, 3, Math.max(0, width - 6), Math.max(0, height - 6), 6);
    graphic.endFill();
  }

  function createTileActivityOverlay(width, height, color) {
    const overlay = new PIXI.Graphics();
    drawTileActivityOverlay(overlay, width, height, color);
    overlay.alpha = 0;
    overlay.visible = false;
    overlay.eventMode = "none";
    return overlay;
  }

  function updateTileActivityOverlays(dt) {
    const frameDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    for (const view of tileViews) {
      if (!view) continue;
      view.activityClockSec = (view.activityClockSec ?? 0) + frameDt;
      const pulse =
        0.7 +
        0.3 *
          Math.sin(
            (view.activityClockSec + (view.col ?? 0) * 0.21) *
              ACTIVITY_PULSE_FREQ_HZ *
              Math.PI *
              2
          );
      const step = Math.min(1, frameDt * ACTIVITY_FADE_SPEED);
      view.forageActivityAlpha =
        (view.forageActivityAlpha ?? 0) +
        ((view.forageActivityTarget ?? 0) - (view.forageActivityAlpha ?? 0)) *
          step;
      view.fishActivityAlpha =
        (view.fishActivityAlpha ?? 0) +
        ((view.fishActivityTarget ?? 0) - (view.fishActivityAlpha ?? 0)) * step;

      const forageAlpha =
        clamp01(view.forageActivityAlpha) * ACTIVITY_BASE_ALPHA * pulse;
      const fishAlpha =
        clamp01(view.fishActivityAlpha) * ACTIVITY_BASE_ALPHA * pulse;

      if (view.forageActivityOverlay) {
        view.forageActivityOverlay.alpha = forageAlpha;
        view.forageActivityOverlay.visible = forageAlpha > 0.01;
      }
      if (view.fishActivityOverlay) {
        view.fishActivityOverlay.alpha = fishAlpha;
        view.fishActivityOverlay.visible = fishAlpha > 0.01;
      }
    }
  }

  function normalizeRarity(value) {
    if (typeof value !== "string") return "bronze";
    const key = value.trim().toLowerCase();
    if (
      key === "bronze" ||
      key === "silver" ||
      key === "gold" ||
      key === "diamond"
    ) {
      return key;
    }
    return "bronze";
  }

  function formatKindLabel(kind) {
    if (typeof kind !== "string" || !kind.length) return "Item";
    const words = kind
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1));
    return words.length ? words.join(" ") : kind;
  }

  function getRollFeedbackSpec(entry) {
    const data = entry?.data && typeof entry.data === "object" ? entry.data : null;
    const outcome = typeof data?.outcome === "string" ? data.outcome : "hit";
    if (outcome === "miss") {
      return {
        headline: "MISS",
        detail: "",
        fill: 0x4c5365,
        stroke: 0x8f9bb3,
        headlineColor: 0xe4ebf6,
        detailColor: 0xb9c3d8,
        durationSec: FEEDBACK_MISS_DURATION_SEC,
      };
    }

    const rarity = normalizeRarity(data?.rarity);
    const qty = Number.isFinite(data?.quantity)
      ? Math.max(0, Math.floor(data.quantity))
      : 0;
    const itemKind =
      typeof data?.itemKind === "string" && data.itemKind.length > 0
        ? data.itemKind
        : null;
    const itemName =
      itemKind && itemDefs[itemKind]?.name
        ? itemDefs[itemKind].name
        : formatKindLabel(itemKind || "");
    const detail = qty > 0 ? `+${qty} ${itemName}` : itemName;

    if (outcome === "blocked") {
      if (data?.blockReason === "tooLarge") {
        return {
          headline: "TOO LARGE",
          detail: `${itemName} won't fit`,
          fill: 0x6a2f2f,
          stroke: 0xffb2b2,
          headlineColor: 0xffeaea,
          detailColor: 0xffcccc,
          durationSec: FEEDBACK_HIT_DURATION_SEC,
        };
      }
      if (data?.blockReason === "noSpace") {
        return {
          headline: "NO SPACE",
          detail: `${itemName} has no room`,
          fill: 0x5e3f1c,
          stroke: 0xf5c27a,
          headlineColor: 0xffeed4,
          detailColor: 0xffdeb3,
          durationSec: FEEDBACK_HIT_DURATION_SEC,
        };
      }
      return {
        headline: "BLOCKED",
        detail: itemName,
        fill: 0x5e3f1c,
        stroke: 0xf5c27a,
        headlineColor: 0xffeed4,
        detailColor: 0xffdeb3,
        durationSec: FEEDBACK_HIT_DURATION_SEC,
      };
    }

    if (rarity === "diamond") {
      return {
        headline: "DIAMOND",
        detail,
        fill: 0x1f6175,
        stroke: 0x8de7ff,
        headlineColor: 0xf1fbff,
        detailColor: 0xd3f3ff,
        durationSec: FEEDBACK_HIT_DURATION_SEC,
      };
    }
    if (rarity === "gold") {
      return {
        headline: "RARE",
        detail,
        fill: 0x6d4f1d,
        stroke: 0xf9d071,
        headlineColor: 0xfff1c7,
        detailColor: 0xffe6a4,
        durationSec: FEEDBACK_HIT_DURATION_SEC,
      };
    }
    if (rarity === "silver") {
      return {
        headline: "UNCOMMON",
        detail,
        fill: 0x3e4f62,
        stroke: 0xbcd3e8,
        headlineColor: 0xe7f0fb,
        detailColor: 0xcddbea,
        durationSec: FEEDBACK_HIT_DURATION_SEC,
      };
    }

    return {
      headline: "COMMON",
      detail,
      fill: 0x2f5f40,
      stroke: 0xa7e3b8,
      headlineColor: 0xe5f8eb,
      detailColor: 0xc4e7cf,
      durationSec: FEEDBACK_HIT_DURATION_SEC,
    };
  }

  function spawnTileRollFeedbackFx(view, entry, col) {
    if (!view?.feedbackLayer || !Number.isFinite(col)) return;
    const list = tileRollFxByCol.get(col) || [];
    const stackIndex = Math.min(FEEDBACK_MAX_STACK, list.length);
    const spec = getRollFeedbackSpec(entry);
    const boxPadX = 6;
    const boxPadY = 4;

    const popup = new PIXI.Container();
    popup.eventMode = "none";
    popup.zIndex = 2;

    const headlineText = new PIXI.Text(spec.headline, {
      fill: spec.headlineColor,
      fontSize: 11,
      fontWeight: "bold",
      align: "center",
    });
    headlineText.anchor.set(0.5, 0);
    headlineText.x = 0;
    headlineText.y = 0;
    popup.addChild(headlineText);

    let detailText = null;
    if (spec.detail) {
      detailText = new PIXI.Text(spec.detail, {
        fill: spec.detailColor,
        fontSize: 9,
        align: "center",
      });
      detailText.anchor.set(0.5, 0);
      detailText.x = 0;
      detailText.y = headlineText.height + 1;
      popup.addChild(detailText);
    }

    const width = Math.max(
      28,
      Math.ceil(
        Math.max(headlineText.width, detailText?.width ?? 0) + boxPadX * 2
      )
    );
    const height = Math.ceil(
      headlineText.height + (detailText ? detailText.height + 1 : 0) + boxPadY * 2
    );
    const bg = new PIXI.Graphics();
    bg
      .lineStyle(1, spec.stroke, 1)
      .beginFill(spec.fill, 0.95)
      .drawRoundedRect(-width / 2, 0, width, height, 6)
      .endFill();
    popup.addChildAt(bg, 0);

    headlineText.y = boxPadY - 1;
    if (detailText) {
      detailText.y = headlineText.y + headlineText.height + 1;
    }

    popup.x = Math.floor(TILE_WIDTH / 2);
    popup.y = TILE_HEIGHT - 26;
    popup.alpha = 0;
    popup.scale.set(0.88);
    view.feedbackLayer.addChild(popup);

    list.push({
      container: popup,
      ageSec: 0,
      durationSec: Math.max(0.25, spec.durationSec ?? FEEDBACK_HIT_DURATION_SEC),
      baseY: TILE_HEIGHT - 26,
      stackOffset: stackIndex * FEEDBACK_STACK_STEP_PX,
      risePx: FEEDBACK_FLOAT_RISE_PX,
    });
    tileRollFxByCol.set(col, list);
  }

  function updateTileRollFeedbackFx(dt) {
    const frameDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    for (const [col, list] of tileRollFxByCol.entries()) {
      if (!Array.isArray(list) || list.length === 0) {
        tileRollFxByCol.delete(col);
        continue;
      }
      const nextList = [];
      for (const fx of list) {
        if (!fx?.container) continue;
        fx.ageSec = (fx.ageSec ?? 0) + frameDt;
        const progress = clamp01(fx.ageSec / Math.max(0.01, fx.durationSec ?? 1));
        if (progress >= 1) {
          removeFromParent(fx.container);
          continue;
        }
        const rise = (fx.risePx ?? FEEDBACK_FLOAT_RISE_PX) * easeOutCubic(progress);
        fx.container.y = (fx.baseY ?? TILE_HEIGHT - 26) - (fx.stackOffset ?? 0) - rise;
        const fade = progress <= 0.35 ? 1 : clamp01(1 - (progress - 0.35) / 0.65);
        fx.container.alpha = fade;
        const punch = progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) * 0.08;
        const scale = 0.88 + Math.max(0, punch) * 0.18;
        fx.container.scale.set(scale);
        nextList.push(fx);
      }
      if (nextList.length > 0) {
        tileRollFxByCol.set(col, nextList);
      } else {
        tileRollFxByCol.delete(col);
      }
    }
  }

  function processTileRollFeedbackEvents(state) {
    const feed = Array.isArray(state?.gameEventFeed) ? state.gameEventFeed : [];
    if (!feed.length) return;
    let maxProcessed = lastProcessedGameEventId;
    for (const entry of feed) {
      const id = Number.isFinite(entry?.id) ? Math.floor(entry.id) : null;
      if (id == null) continue;
      if (id <= lastProcessedGameEventId) {
        if (id > maxProcessed) maxProcessed = id;
        continue;
      }
      if (id > maxProcessed) maxProcessed = id;

      const type = typeof entry.type === "string" ? entry.type : "";
      if (type !== "forageRoll" && type !== "fishingRoll") continue;
      const data = entry?.data && typeof entry.data === "object" ? entry.data : null;
      const envCol = Number.isFinite(data?.envCol) ? Math.floor(data.envCol) : null;
      if (envCol == null) continue;

      const outcome = data?.outcome === "miss" ? "miss" : "hit";
      if (outcome === "miss") {
        const eventSec = Number.isFinite(entry?.tSec) ? Math.floor(entry.tSec) : null;
        if (eventSec != null) {
          const throttleSec = missThrottleByColSec.get(envCol);
          if (throttleSec != null && eventSec - throttleSec < FEEDBACK_MISS_THROTTLE_SEC) {
            continue;
          }
          missThrottleByColSec.set(envCol, eventSec);
        }
      }

      const view = tileViews[envCol];
      if (!view) continue;
      const spec = getRollFeedbackSpec(entry);
      spawnTileRollFeedbackFx(view, entry, envCol);
      tagUi?.notifyTransientTagFeedback?.(
        view,
        type === "forageRoll" ? "forageable" : "fishable",
        spec
      );
    }

    if (maxProcessed > lastProcessedGameEventId) {
      lastProcessedGameEventId = maxProcessed;
    }
  }

  function setTextResolution(textNodes, resolution) {
    if (!Array.isArray(textNodes)) return;
    if (!Number.isFinite(resolution)) return;
    const globalCapRaw = Number(globalThis?.__MAX_TEXT_RESOLUTION__);
    const globalCap =
      Number.isFinite(globalCapRaw) && globalCapRaw > 0
        ? Math.max(1, Math.floor(globalCapRaw))
        : null;
    const nextResolution =
      globalCap == null
        ? resolution
        : Math.max(1, Math.min(Math.floor(resolution), globalCap));
    for (const node of textNodes) {
      if (!node || typeof node !== "object") continue;
      if (node.resolution === nextResolution) continue;
      node.resolution = nextResolution;
      if (node.dirty != null) node.dirty = true;
    }
  }

  function registerPaintContainer(container) {
    paintStyleController?.registerPaintContainer?.(container);
  }

  function unregisterPaintContainer(container) {
    paintStyleController?.unregisterPaintContainer?.(container);
  }

  function drawApOverlay(overlay, width, height, radius) {
    if (!overlay) return;
    overlay.clear();
    overlay
      .beginFill(AP_OVERLAY_FILL, 0.5)
      .lineStyle(2, AP_OVERLAY_STROKE, 1)
      .drawRoundedRect(1, 1, Math.max(0, width - 2), Math.max(0, height - 2), radius)
      .endFill();
  }

  function createApOverlay(width, height, radius) {
    const overlay = new PIXI.Graphics();
    drawApOverlay(overlay, width, height, radius);
    overlay.alpha = 0;
    overlay.visible = false;
    overlay.eventMode = "none";
    return overlay;
  }

  function drawDistributorRangeOverlay(overlay, width, height, radius) {
    if (!overlay) return;
    overlay.clear();
    overlay
      .lineStyle(2, DISTRIBUTOR_RANGE_OVERLAY_STROKE, 0.9)
      .beginFill(DISTRIBUTOR_RANGE_OVERLAY_FILL, 0.26)
      .drawRoundedRect(2, 2, Math.max(0, width - 4), Math.max(0, height - 4), radius)
      .endFill();
  }

  function createDistributorRangeOverlay(width, height, radius) {
    const overlay = new PIXI.Graphics();
    drawDistributorRangeOverlay(overlay, width, height, radius);
    overlay.visible = false;
    overlay.eventMode = "none";
    return overlay;
  }

  function drawBuildPlacementOverlay(overlay, width, height, radius, kind) {
    if (!overlay) return;
    overlay.clear();
    if (kind !== "valid" && kind !== "invalid") {
      overlay.visible = false;
      return;
    }
    const fill = kind === "valid" ? BUILD_PREVIEW_VALID_FILL : BUILD_PREVIEW_INVALID_FILL;
    const stroke =
      kind === "valid" ? BUILD_PREVIEW_VALID_STROKE : BUILD_PREVIEW_INVALID_STROKE;
    overlay
      .lineStyle(2, stroke, 0.95)
      .beginFill(fill, 0.3)
      .drawRoundedRect(2, 2, Math.max(0, width - 4), Math.max(0, height - 4), radius)
      .endFill();
    overlay.visible = true;
  }

  function createBuildPlacementOverlay(width, height, radius) {
    const overlay = new PIXI.Graphics();
    drawBuildPlacementOverlay(overlay, width, height, radius, null);
    overlay.eventMode = "none";
    return overlay;
  }

  function drawPawnLandingOverlay(overlay, width, height, radius) {
    if (!overlay) return;
    overlay.clear();
    overlay
      .lineStyle(2, PAWN_LANDING_OVERLAY_STROKE, 0.95)
      .beginFill(PAWN_LANDING_OVERLAY_FILL, 0.3)
      .drawRoundedRect(2, 2, Math.max(0, width - 4), Math.max(0, height - 4), radius)
      .endFill();
  }

  function createPawnLandingOverlay(width, height, radius) {
    const overlay = new PIXI.Graphics();
    drawPawnLandingOverlay(overlay, width, height, radius);
    overlay.visible = false;
    overlay.eventMode = "none";
    return overlay;
  }

  function getInventoryDragOutlineColor(level) {
    if (level === "hover") return INVENTORY_DRAG_HOVER_OUTLINE;
    if (level === "full") return INVENTORY_DRAG_FULL_OUTLINE;
    if (level === "valid") return INVENTORY_DRAG_VALID_OUTLINE;
    return 0x7fd0ff;
  }

  function normalizeInventoryDragOwnerId(ownerId) {
    return ownerId == null ? null : String(ownerId);
  }

  function drawFocusOutline(graphic, width, height, radius = 6, color = 0x7fd0ff) {
    if (!graphic) return;
    graphic.clear();
    graphic.lineStyle(2, color, 1);
    graphic.drawRoundedRect(2, 2, Math.max(0, width - 4), Math.max(0, height - 4), radius);
  }

  function setPawnLandingOverlayVisible(view, active) {
    const overlay = view?.pawnLandingOverlay;
    if (!overlay) return;
    overlay.visible = !!active;
  }

  function getScreenWidthInt() {
    return Math.max(1, Math.floor(app?.screen?.width ?? 1));
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

  function getBoardColumnXForVisibleCols(screenWidth, col, cols = getVisibleBoardCols()) {
    const safeCols = Math.max(0, Number.isFinite(cols) ? Math.floor(cols) : 0);
    const index = Math.max(0, Number.isFinite(col) ? Math.floor(col) : 0);
    const totalWidth =
      safeCols <= 0 ? 0 : safeCols * BOARD_COL_WIDTH + (safeCols - 1) * BOARD_COL_GAP;
    return (
      resolveColumnStartX(
        screenWidth,
        totalWidth,
        VIEW_LAYOUT.playfield?.region?.anchorX || "center",
        Number(VIEW_LAYOUT.playfield?.region?.offsetX || 0)
      ) +
      index * (BOARD_COL_WIDTH + BOARD_COL_GAP)
    );
  }

  function getHubColumnXForVisibleCols(screenWidth, col, cols = getVisibleHubCols()) {
    const safeCols = Math.max(0, Number.isFinite(cols) ? Math.floor(cols) : 0);
    const index = Math.max(0, Number.isFinite(col) ? Math.floor(col) : 0);
    const totalWidth =
      safeCols <= 0 ? 0 : safeCols * HUB_COL_WIDTH + (safeCols - 1) * HUB_COL_GAP;
    return (
      resolveColumnStartX(
        screenWidth,
        totalWidth,
        VIEW_LAYOUT.playfield?.hub?.anchorX || "center",
        Number(VIEW_LAYOUT.playfield?.hub?.offsetX || 0)
      ) +
      index * (HUB_COL_WIDTH + HUB_COL_GAP)
    );
  }

  function getBoardColumnCenterXsForVisibleCols(
    screenWidth,
    cols = getVisibleBoardCols(),
    pieceWidth = TILE_WIDTH
  ) {
    const safeCols = Math.max(0, Number.isFinite(cols) ? Math.floor(cols) : 0);
    const width = Math.max(1, Number.isFinite(pieceWidth) ? Math.floor(pieceWidth) : TILE_WIDTH);
    const values = new Array(safeCols);
    for (let col = 0; col < safeCols; col += 1) {
      values[col] = getBoardColumnXForVisibleCols(screenWidth, col, safeCols) + width * 0.5;
    }
    return values;
  }

  function getHubColumnCenterXsForVisibleCols(
    screenWidth,
    cols = getVisibleHubCols(),
    pieceWidth = HUB_STRUCTURE_WIDTH
  ) {
    const safeCols = Math.max(0, Number.isFinite(cols) ? Math.floor(cols) : 0);
    const width = Math.max(
      1,
      Number.isFinite(pieceWidth) ? Math.floor(pieceWidth) : HUB_STRUCTURE_WIDTH
    );
    const values = new Array(safeCols);
    for (let col = 0; col < safeCols; col += 1) {
      values[col] = getHubColumnXForVisibleCols(screenWidth, col, safeCols) + width * 0.5;
    }
    return values;
  }

  function layoutBoardColPosForVisibleCols(
    screenWidth,
    col,
    width,
    rowY,
    cols = getVisibleBoardCols()
  ) {
    const safeWidth = Number.isFinite(width) ? width : BOARD_COL_WIDTH;
    return {
      x: getBoardColumnXForVisibleCols(screenWidth, col, cols) + (BOARD_COL_WIDTH - safeWidth) / 2,
      y: rowY,
    };
  }

  function layoutHubColPosForVisibleCols(
    screenWidth,
    col,
    width,
    rowY,
    cols = getVisibleHubCols()
  ) {
    const safeWidth = Number.isFinite(width) ? width : HUB_COL_WIDTH;
    return {
      x: getHubColumnXForVisibleCols(screenWidth, col, cols) + (HUB_COL_WIDTH - safeWidth) / 2,
      y: rowY,
    };
  }

  function getDropTargetCenterXs(envCols, hubCols) {
    const screenWidth = getScreenWidthInt();
    const safeEnvCols = Number.isFinite(envCols) ? Math.max(0, Math.floor(envCols)) : 0;
    const safeHubCols = Number.isFinite(hubCols) ? Math.max(0, Math.floor(hubCols)) : 0;
    return {
      envCenters: getBoardColumnCenterXsForVisibleCols(screenWidth, safeEnvCols, TILE_WIDTH),
      hubCenters: getHubColumnCenterXsForVisibleCols(
        screenWidth,
        safeHubCols,
        HUB_STRUCTURE_WIDTH
      ),
    };
  }

  function resolvePawnDropTargetFromPos(globalPos, envCols, hubCols) {
    if (!globalPos) return null;
    const worldPos =
      typeof screenToWorld === "function" ? screenToWorld(globalPos) ?? globalPos : globalPos;
    const envLen = Number.isFinite(envCols) ? Math.max(0, envCols) : BOARD_COLS;
    const hubLen = Number.isFinite(hubCols) ? Math.max(0, hubCols) : HUB_COLS;
    if (envLen <= 0 && hubLen <= 0) return null;

    const tileCenterY = TILE_ROW_Y + TILE_HEIGHT * 0.5;
    const hubCenterY = HUB_STRUCTURE_ROW_Y + HUB_STRUCTURE_HEIGHT * 0.5;
    const distToTile = Math.abs(worldPos.y - tileCenterY);
    const distToHub = Math.abs(worldPos.y - hubCenterY);
    const targetRow = distToTile <= distToHub ? "env" : "hub";
    const targetCols = targetRow === "env" ? envLen : hubLen;
    if (targetCols <= 0) return null;

    const centers = getDropTargetCenterXs(envLen, hubLen);
    const centerXs = targetRow === "env" ? centers.envCenters : centers.hubCenters;
    let bestCol = null;
    let bestDist2 = Infinity;
    for (let col = 0; col < targetCols; col++) {
      const cx = centerXs[col];
      const dx = worldPos.x - cx;
      const d2 = dx * dx;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestCol = col;
      }
    }
    return bestCol == null ? null : { row: targetRow, col: bestCol };
  }

  function setDistributorRangeOverlayVisible(view, active) {
    const overlay = view?.distributorRangeOverlay;
    if (!overlay) return;
    overlay.visible = !!active;
  }

  function setBuildPlacementOverlayState(view, kind) {
    const overlay = view?.buildPlacementOverlay;
    if (!overlay) return;
    if (view.buildPlacementOverlayState === kind) return;
    view.buildPlacementOverlayState = kind;
    drawBuildPlacementOverlay(
      overlay,
      view.cardWidth ?? HUB_STRUCTURE_WIDTH,
      view.cardHeight ?? HUB_STRUCTURE_HEIGHT,
      10,
      kind
    );
  }

  function getActiveDistributorRangePreview() {
    return iconDistributorRangePreview || buildDistributorRangePreview;
  }

  function updateDistributorRangeOverlays() {
    const preview = getActiveDistributorRangePreview();
    if (!preview) {
      for (const view of hubStructureViews.values()) {
        setDistributorRangeOverlayVisible(view, false);
      }
      for (const view of hubSlotViews) {
        setDistributorRangeOverlayVisible(view, false);
      }
      return;
    }

    const coveredHubCols = new Set();
    for (const view of hubStructureViews.values()) {
      const spanInfo = getStructureSpan(view?.structure, view?.col);
      if (spanInfo.col == null) {
        setDistributorRangeOverlayVisible(view, false);
        continue;
      }
      for (let c = spanInfo.col; c < spanInfo.col + spanInfo.span; c++) {
        coveredHubCols.add(c);
      }
      const dist = spanDistance(
        preview.hubCol,
        preview.span,
        spanInfo.col,
        spanInfo.span
      );
      setDistributorRangeOverlayVisible(view, dist <= preview.range);
    }

    for (const view of hubSlotViews) {
      const col = Number.isFinite(view?.col) ? Math.floor(view.col) : null;
      if (col == null || coveredHubCols.has(col)) {
        setDistributorRangeOverlayVisible(view, false);
        continue;
      }
      const dist = spanDistance(preview.hubCol, preview.span, col, 1);
      setDistributorRangeOverlayVisible(view, dist <= preview.range);
    }
  }

  function updateBuildPlacementOverlays() {
    const preview = buildPlacementPreview;
    const isUpgradePreview = preview?.placementMode === "upgrade";
    if (!isUpgradePreview) {
      for (const view of hubStructureViews.values()) {
        setBuildPlacementOverlayState(view, null);
      }
      for (const view of hubSlotViews) {
        setBuildPlacementOverlayState(view, null);
      }
      return;
    }

    const state = getGameState?.();
    if (!state) {
      for (const view of hubStructureViews.values()) {
        setBuildPlacementOverlayState(view, null);
      }
      return;
    }

    for (const view of hubStructureViews.values()) {
      const structureCol = Number.isFinite(view?.structure?.col)
        ? Math.floor(view.structure.col)
        : Number.isFinite(view?.col)
          ? Math.floor(view.col)
          : null;
      if (structureCol == null) {
        setBuildPlacementOverlayState(view, null);
        continue;
      }
      const check = validateHubConstructionPlacement(
        state,
        preview.defId,
        structureCol
      );
      setBuildPlacementOverlayState(view, check?.ok ? "valid" : "invalid");
    }
    for (const view of hubSlotViews) {
      setBuildPlacementOverlayState(view, null);
    }
  }

  function setBuildDistributorRangePreview(spec) {
    const next = buildDistributorRangePreviewFromSpec(spec);
    if (sameDistributorRangePreview(buildDistributorRangePreview, next)) return;
    buildDistributorRangePreview = next;
  }

  function clearBuildDistributorRangePreview() {
    if (buildDistributorRangePreview == null) return;
    buildDistributorRangePreview = null;
  }

  function setBuildPlacementPreviewSpec(spec) {
    const next = normalizeBuildPlacementPreview(spec);
    if (sameBuildPlacementPreview(buildPlacementPreview, next)) return;
    buildPlacementPreview = next;
  }

  function clearBuildPlacementPreviewSpec() {
    if (buildPlacementPreview == null) return;
    buildPlacementPreview = null;
  }

  function setIconDistributorRangePreview(view, systemId) {
    if (systemId !== "distribution") {
      iconDistributorRangePreview = null;
      return;
    }
    iconDistributorRangePreview = buildDistributorRangePreviewFromView(view);
  }

  function clearIconDistributorRangePreview(systemId = null) {
    if (systemId != null && systemId !== "distribution") return;
    iconDistributorRangePreview = null;
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

  function handleSystemIconHover(view, systemId) {
    setIconDistributorRangePreview(view, systemId);
    onSystemIconHover?.(view, systemId);
  }

  function handleSystemIconOut(view, systemId) {
    clearIconDistributorRangePreview(systemId);
    onSystemIconOut?.(view, systemId);
  }

  function handleSystemIconClick(view, systemId) {
    onSystemIconClick?.(view, systemId);
  }

  function isProcessWidgetSystemId(systemId) {
    return PROCESS_WIDGET_SYSTEM_IDS.has(systemId);
  }

  function handleProcessCogClick(view, systemId) {
    onProcessCogClick?.(view, systemId);
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
    getTilePlanPreview,
    isProcessWidgetSystem: isProcessWidgetSystemId,
    onProcessCogClick: handleProcessCogClick,
    onSystemIconHover: handleSystemIconHover,
    onSystemIconOut: handleSystemIconOut,
    onSystemIconClick: handleSystemIconClick,
  });

  const hubTagUi = createHubTagUi({
    tooltipView,
    getGameState,
    startTagDrag: startHubTagDrag,
    setTextResolution,
    baseTextResolution: BASE_TEXT_RESOLUTION,
    hoverTextResolution: HOVER_TEXT_RESOLUTION,
    requestPauseForAction,
    toggleTag: dispatchHubTagToggle,
    getHubPlanPreview,
    openRecipeDropdown: hubPanels?.openRecipeDropdown,
    isProcessWidgetSystem: isProcessWidgetSystemId,
    onProcessCogClick: handleProcessCogClick,
    onSystemIconHover: handleSystemIconHover,
    onSystemIconOut: handleSystemIconOut,
    onSystemIconClick: handleSystemIconClick,
  });

  tileTagDragController = createPillDragController({
    app,
    dragStateKey: "tagDrag",
    dragScale: TAG_DRAG_SCALE,
    dragAlpha: 0.95,
    dragZIndex: 10,
    dragCursor: "grabbing",
    idleCursor: "grab",
    getEntries: (view) => view.tagEntries || [],
    getContainer: (view) => view.tagContainer,
    getRowHeight: () => TAG_LAYOUT.PILL_HEIGHT,
    getRowStep: () => TAG_LAYOUT.PILL_HEIGHT + TAG_LAYOUT.PILL_GAP,
    layoutEntries: (view) => tagUi?.layoutTagEntries?.(view),
    onCommit: (view, fromIndex, toIndex) => {
      const fullTags = Array.isArray(view.tile?.tags) ? view.tile.tags.slice() : [];
      const visibleTags = fullTags.filter((tagId) =>
        isVisibleEnabledTileTag(view.tile, tagId)
      );
      if (visibleTags.length !== view.tagEntries.length) return;
      if (fromIndex < 0 || fromIndex >= visibleTags.length) return;
      if (toIndex < 0 || toIndex >= visibleTags.length) return;
      const reorderedVisible = visibleTags.slice();
      const [moved] = reorderedVisible.splice(fromIndex, 1);
      reorderedVisible.splice(toIndex, 0, moved);
      const nextFull = buildTagOrderFromVisible(
        fullTags,
        reorderedVisible,
        (tagId) => isVisibleEnabledTileTag(view.tile, tagId)
      );
      if (!nextFull) return;
      dispatchTagOrder(view.col, nextFull);
    },
    onDragStart: (view) => {
      activeTagDrag = view;
      view.suppressAutoExpandedTag = true;
      view.tagDragRestoreExpandedTagId = view.expandedTagId ?? null;
      view.expandedTagId = null;
      for (const entry of view.tagEntries || []) {
        entry?.setExpanded?.(false);
      }
      tagUi?.layoutTagEntries?.(view);
    },
    onDragEnd: (view, drag, globalPos) => {
      view.ignoreNextTagTap = !!drag?.moved;
      if (activeTagDrag === view) activeTagDrag = null;
      view.suppressAutoExpandedTag = false;
      const restoreExpandedTagId =
        typeof view.tagDragRestoreExpandedTagId === "string"
          ? view.tagDragRestoreExpandedTagId
          : null;
      if (
        restoreExpandedTagId &&
        Array.isArray(view.tagEntries) &&
        view.tagEntries.some((entry) => entry?.tagId === restoreExpandedTagId)
      ) {
        view.expandedTagId = restoreExpandedTagId;
      }
      for (const entry of view.tagEntries || []) {
        entry?.setExpanded?.(entry?.tagId === view.expandedTagId);
      }
      view.tagDragRestoreExpandedTagId = null;
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
    },
  });

  hubTagDragController = createPillDragController({
    app,
    dragStateKey: "tagDrag",
    dragScale: TAG_DRAG_SCALE,
    dragAlpha: 0.95,
    dragZIndex: 10,
    dragCursor: "grabbing",
    idleCursor: "grab",
    getEntries: (view) => view.tagEntries || [],
    getContainer: (view) => view.tagContainer,
    getRowHeight: () => HUB_TAG_LAYOUT.PILL_HEIGHT,
    getRowStep: () => HUB_TAG_LAYOUT.PILL_HEIGHT + HUB_TAG_LAYOUT.PILL_GAP,
    layoutEntries: (view) => hubTagUi?.layoutTagEntries?.(view),
    onCommit: (view, fromIndex, toIndex) => {
      const fullTags = Array.isArray(view.structure?.tags)
        ? view.structure.tags.slice()
        : [];
      const visibleTags = normalizeVisibleHubTagOrder(
        fullTags.filter((tagId) => isVisibleEnabledHubTag(view.structure, tagId))
      );
      if (visibleTags.length !== view.tagEntries.length) return;
      if (fromIndex < 0 || fromIndex >= visibleTags.length) return;
      if (toIndex < 0 || toIndex >= visibleTags.length) return;
      const reorderedVisible = visibleTags.slice();
      const [moved] = reorderedVisible.splice(fromIndex, 1);
      reorderedVisible.splice(toIndex, 0, moved);
      const normalizedVisible = normalizeVisibleHubTagOrder(reorderedVisible);
      const nextFull = buildTagOrderFromVisible(
        fullTags,
        normalizedVisible,
        (tagId) => isVisibleEnabledHubTag(view.structure, tagId)
      );
      if (!nextFull) return;
      dispatchHubTagOrder(view.col, nextFull);
    },
    onDragStart: (view) => {
      activeHubTagDrag = view;
      view.suppressAutoExpandedTag = true;
      view.tagDragRestoreExpandedTagId = view.expandedTagId ?? null;
      view.expandedTagId = null;
      for (const entry of view.tagEntries || []) {
        entry?.setExpanded?.(false);
      }
      hubTagUi?.layoutTagEntries?.(view);
    },
    onDragEnd: (view, drag, globalPos) => {
      view.ignoreNextTagTap = !!drag?.moved;
      if (activeHubTagDrag === view) activeHubTagDrag = null;
      view.suppressAutoExpandedTag = false;
      const restoreExpandedTagId =
        typeof view.tagDragRestoreExpandedTagId === "string"
          ? view.tagDragRestoreExpandedTagId
          : null;
      if (
        restoreExpandedTagId &&
        Array.isArray(view.tagEntries) &&
        view.tagEntries.some((entry) => entry?.tagId === restoreExpandedTagId)
      ) {
        view.expandedTagId = restoreExpandedTagId;
      }
      for (const entry of view.tagEntries || []) {
        entry?.setExpanded?.(entry?.tagId === view.expandedTagId);
      }
      view.tagDragRestoreExpandedTagId = null;
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
    },
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
    const contentShadow = new PIXI.Container();
    const contentPaint = new PIXI.Container();
    const contentInk = new PIXI.Container();
    content.addChild(contentShadow, contentPaint, contentInk);

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
    contentShadow.addChild(shadow);

    container.addChild(content);
    let hoverActive = false;

    function setActive(active) {
      hoverActive = !!active;
    }

    function syncHoverZIndex() {
      container.zIndex =
        hoverActive || content.scale?.x > 1.001 || shadow.alpha > 0.001 ? 20 : 0;
    }

    function setScale(scale) {
      const nextScale = Number.isFinite(scale) ? scale : 1;
      content.scale.set(nextScale);
      syncHoverZIndex();
    }

    function setShadowAlpha(alpha) {
      const nextAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
      shadow.alpha = nextAlpha;
      shadow.visible = nextAlpha > 0.001 && GAMEPIECE_SHADOW_ALPHA > 0;
      syncHoverZIndex();
    }

    return { content, contentPaint, contentInk, setActive, setScale, setShadowAlpha };
  }

  function getScaledAnchorRect(container, width, height, scale, baseY = null) {
    const s = Number.isFinite(scale) ? scale : 1;
    const cx = container.x + width / 2;
    const cy = container.y + height / 2;
    const anchorBaseY = Number.isFinite(baseY) ? baseY : container.y;
    const offsetY = container.y - anchorBaseY;
    const scaledWidth = width * s;
    const scaledHeight = height * s;
    return {
      coordinateSpace: "parent",
      x: cx - scaledWidth / 2,
      y: cy - scaledHeight / 2,
      width: scaledWidth,
      height: scaledHeight,
      scale: s,
      centerX: cx,
      centerY: cy,
      offsetY,
    };
  }

  function getScaledAnchorRectAtPosition(
    x,
    y,
    width,
    height,
    scale,
    baseY = null
  ) {
    const s = Number.isFinite(scale) ? scale : 1;
    const safeX = Number.isFinite(x) ? x : 0;
    const safeY = Number.isFinite(y) ? y : 0;
    const cx = safeX + width / 2;
    const cy = safeY + height / 2;
    const anchorBaseY = Number.isFinite(baseY) ? baseY : safeY;
    const offsetY = safeY - anchorBaseY;
    const scaledWidth = width * s;
    const scaledHeight = height * s;
    return {
      coordinateSpace: "parent",
      x: cx - scaledWidth / 2,
      y: cy - scaledHeight / 2,
      width: scaledWidth,
      height: scaledHeight,
      scale: s,
      centerX: cx,
      centerY: cy,
      offsetY,
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
      offsetY: Number.isFinite(anchor?.offsetY) ? anchor.offsetY : 0,
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

  function isPointerInsideAnchor(anchor, globalPos, pad = 0) {
    if (!anchor || !globalPos) return false;
    const minX = anchor.x - pad;
    const minY = anchor.y - pad;
    const maxX = anchor.x + anchor.width + pad;
    const maxY = anchor.y + anchor.height + pad;
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
    view.occupantHoverHoldSec = 0;
    view.childTooltipHoverActive = false;
    view.isHovered = false;
    view.hoverCleanupPending = true;
    view.setHoverActive?.(false);
    setHoverScaleTarget(view, 1);
    updateTileTagLayoutForHoverState(view);
    clearHoverContext();
    tooltipView?.hide?.();
    // Dropdown handles its own hide behavior.
  }

  function clearEventHover(view) {
    if (!view) return;
    view.isHovered = false;
    view.hoverCleanupPending = true;
    view.setHoverActive?.(false);
    setHoverScaleTarget(view, 1);
    clearHoverContext();
    tooltipView?.hide?.();
  }

  function clearEnvStructureHover(view) {
    if (!view) return;
    view.holdHoverForOccupant = false;
    view.occupantHoverHoldSec = 0;
    view.childTooltipHoverActive = false;
    view.isHovered = false;
    view.hoverCleanupPending = true;
    view.setHoverActive?.(false);
    setHoverScaleTarget(view, 1);
    if (view.descText) {
      view.descText.visible = false;
    }
    clearHoverContext();
    tooltipView?.hide?.();
  }

  function clearHubStructureHover(view) {
    if (!view) return;
    view.holdHoverForOccupant = false;
    view.occupantHoverHoldSec = 0;
    view.childTooltipHoverActive = false;
    view.isHovered = false;
    view.hoverCleanupPending = true;
    view.setHoverActive?.(false);
    setHoverScaleTarget(view, 1);
    updateHubStructureViewUi(view, view.structure, { force: true });
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
    if (kind === "envStructure") {
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
      const envCol = Number.isFinite(hover.envCol)
        ? Math.floor(hover.envCol)
        : null;
      return envCol != null && envCol >= anchorCol && envCol < anchorCol + span;
    }
    return false;
  }

  function holdHoverForOccupantIfNeeded(view) {
    if (!view?.pawnCount || view.pawnCount <= 0) return false;
    view.holdHoverForOccupant = true;
    view.occupantHoverHoldSec = OCCUPANT_HOVER_GRACE_SEC;
    return true;
  }

  function shouldKeepActiveHoverForHoveredOccupant() {
    if (!activeHover?.view || !activeHover?.kind) return false;
    if (activeHover.view.holdHoverForOccupant === true) return true;
    return isPawnHoveringForView(activeHover.view, activeHover.kind);
  }

  function resolveViewBaseY(view) {
    if (Number.isFinite(view?.baseY)) return Math.floor(view.baseY);
    if (Number.isFinite(view?.container?.y)) return Math.floor(view.container.y);
    return 0;
  }

  function resetHoverViewY(view) {
    if (!view?.container) return;
    view.container.y = resolveViewBaseY(view);
  }

  function fitHoverViewY(view, baseHeight, bottomExtent = null, hoverScale = null) {
    if (!view?.container) return;
    view.container.y = resolveFittedHoverViewY(
      resolveViewBaseY(view),
      baseHeight,
      bottomExtent,
      hoverScale
    );
  }

  function resolveFittedHoverViewY(baseY, baseHeight, bottomExtent = null, hoverScale = null) {
    const safeBaseHeight = Number.isFinite(baseHeight)
      ? Math.max(1, Math.floor(baseHeight))
      : 1;
    const safeBottomExtent = Number.isFinite(bottomExtent)
      ? Math.max(safeBaseHeight, bottomExtent)
      : safeBaseHeight;
    const screenHeight = Math.max(1, Math.floor(app?.screen?.height ?? 1));
    const scale = Number.isFinite(hoverScale)
      ? hoverScale
      : Number.isFinite(GAMEPIECE_HOVER_SCALE)
      ? GAMEPIECE_HOVER_SCALE
      : 1;
    const halfBase = safeBaseHeight * 0.5;
    const topOffset = (safeBaseHeight * scale - safeBaseHeight) * 0.5;
    const scaledBottomOffset = (safeBottomExtent - halfBase) * scale;
    const minY = HOVER_VIEW_SCREEN_PAD + topOffset;
    const maxY =
      screenHeight - HOVER_VIEW_SCREEN_PAD - halfBase - scaledBottomOffset;
    const preferredY = baseY;
    const nextY =
      minY <= maxY
        ? Math.max(minY, Math.min(maxY, preferredY))
        : baseY;
    return Math.round(nextY);
  }

  function getProjectedHoverUiAnchor(view, width, baseHeight, bottomExtent = null) {
    if (!view?.container) return null;
    const resolvedBaseY = resolveViewBaseY(view);
    const projectedHeight = Number.isFinite(view.cardHeightTarget)
      ? Math.max(1, view.cardHeightTarget)
      : Number.isFinite(view.cardHeightCurrent)
      ? Math.max(1, view.cardHeightCurrent)
      : Math.max(1, baseHeight);
    const projectedBottom = Number.isFinite(bottomExtent)
      ? Math.max(projectedHeight, bottomExtent)
      : projectedHeight;
    const projectedScale = resolveAdaptiveHoverScale(projectedHeight);
    const projectedY = resolveFittedHoverViewY(
      resolvedBaseY,
      projectedHeight,
      projectedBottom,
      projectedScale
    );
    return getScaledAnchorRectAtPosition(
      view.container.x,
      projectedY,
      width,
      Math.max(1, baseHeight),
      projectedScale,
      resolvedBaseY
    );
  }

  function resolveAdaptiveHoverScale(heightPx) {
    const baseScale = Number.isFinite(GAMEPIECE_HOVER_SCALE) ? GAMEPIECE_HOVER_SCALE : 1;
    const h = Number.isFinite(heightPx) ? Math.max(1, heightPx) : 1;
    const viewportHeight = Math.max(
      1,
      Math.floor(app?.screen?.height ?? VIEW_LAYOUT.skillTree?.viewport?.height ?? 1080)
    );
    const available = Math.max(1, viewportHeight - HOVER_VIEW_SCREEN_PAD * 2);
    const fitScale = available / h;
    return Math.max(HOVER_SCALE_MIN, Math.min(baseScale, fitScale));
  }

  function applyHoverScaleToView(view, scale) {
    if (!view?.content) return;
    const nextScale = Number.isFinite(scale) ? scale : 1;
    if (view.hoverScaleApplied === nextScale && view.content.scale?.x === nextScale) return;
    view.hoverScaleApplied = nextScale;
    view.setHoverScale?.(nextScale);
    const textNodes = Array.isArray(view.hoverTextNodes) ? view.hoverTextNodes : null;
    if (textNodes) {
      const targetResolution = nextScale > 1.001
        ? Math.max(BASE_TEXT_RESOLUTION, Math.ceil(BASE_TEXT_RESOLUTION * nextScale))
        : BASE_TEXT_RESOLUTION;
      setTextResolution(textNodes, targetResolution);
    }
  }

  function isHoverZoomExpanded(view) {
    if (!view) return false;
    const currentScale = Number.isFinite(view.hoverScaleApplied) ? view.hoverScaleApplied : 1;
    const targetScale = Number.isFinite(view.hoverScaleTarget) ? view.hoverScaleTarget : 1;
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

  function setHoverScaleTarget(view, scale) {
    if (!view) return;
    view.hoverScaleTarget = Number.isFinite(scale) ? scale : 1;
  }

  function hasPendingHoverScaleAnimation(view) {
    if (!view) return false;
    const current = Number.isFinite(view.hoverScaleApplied) ? view.hoverScaleApplied : 1;
    const target = Number.isFinite(view.hoverScaleTarget) ? view.hoverScaleTarget : 1;
    return Math.abs(target - current) > 0.001;
  }

  function hasPendingCardHeightAnimation(view) {
    if (!view) return false;
    const current = Number.isFinite(view.cardHeightCurrent)
      ? Math.max(1, view.cardHeightCurrent)
      : null;
    const target = Number.isFinite(view.cardHeightTarget)
      ? Math.max(1, view.cardHeightTarget)
      : Number.isFinite(view.baseCardHeight)
      ? Math.max(1, view.baseCardHeight)
      : null;
    if (current == null || target == null) return false;
    return Math.abs(target - current) > 0.5;
  }

  function setHoverShadowAlphaTarget(view, alpha) {
    if (!view) return;
    view.hoverShadowAlphaTarget = Number.isFinite(alpha) ? alpha : 0;
  }

  function hasPendingHoverShadowAnimation(view) {
    if (!view) return false;
    const current = Number.isFinite(view.hoverShadowAlphaApplied)
      ? view.hoverShadowAlphaApplied
      : 0;
    const target = Number.isFinite(view.hoverShadowAlphaTarget)
      ? view.hoverShadowAlphaTarget
      : 0;
    return Math.abs(target - current) > 0.001;
  }

  function applyHoverShadowAlphaToView(view, alpha) {
    if (!view) return;
    const nextAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    if (view.hoverShadowAlphaApplied === nextAlpha) return;
    view.hoverShadowAlphaApplied = nextAlpha;
    view.setHoverShadowAlpha?.(nextAlpha);
  }

  function animateHoverShadowAlpha(view, dt) {
    if (!view) return false;
    const target = Number.isFinite(view.hoverShadowAlphaTarget)
      ? view.hoverShadowAlphaTarget
      : 0;
    if (!Number.isFinite(view.hoverShadowAlphaApplied)) {
      applyHoverShadowAlphaToView(view, target);
      return true;
    }
    const current = view.hoverShadowAlphaApplied;
    const diff = target - current;
    if (Math.abs(diff) < 0.001) {
      if (Math.abs(current - target) < 1e-6) return false;
      applyHoverShadowAlphaToView(view, target);
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
    applyHoverShadowAlphaToView(view, current + diff * t);
    return true;
  }

  function animateHoverScale(view, dt) {
    if (!view) return false;
    const target = Number.isFinite(view.hoverScaleTarget) ? view.hoverScaleTarget : 1;
    if (!Number.isFinite(view.hoverScaleApplied)) {
      applyHoverScaleToView(view, target);
      return true;
    }
    const current = view.hoverScaleApplied;
    const diff = target - current;
    if (Math.abs(diff) < 0.001) {
      if (Math.abs(current - target) < 1e-6) return false;
      applyHoverScaleToView(view, target);
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
    applyHoverScaleToView(view, current + diff * t);
    return true;
  }

  function shouldAllowHoverZoomIn(view) {
    if (isHoverZoomExpanded(view)) return true;
    return canStartHoverZoomIn?.() !== false;
  }

  function isHoverZoomDownActive(view) {
    if (!view) return false;
    if (view.isHovered) return false;
    return hasPendingHoverScaleAnimation(view) || hasPendingHoverShadowAnimation(view);
  }

  function hasActiveHoverZoomDown() {
    for (const view of tileViews) {
      if (isHoverZoomDownActive(view)) return true;
    }
    for (const view of eventViews.values()) {
      if (isHoverZoomDownActive(view)) return true;
    }
    for (const view of envStructureViews.values()) {
      if (isHoverZoomDownActive(view)) return true;
    }
    for (const view of hubStructureViews.values()) {
      if (isHoverZoomDownActive(view)) return true;
    }
    return false;
  }

  function finalizeHoverExit(view, onFinalize = null) {
    if (!view?.hoverCleanupPending) return false;
    if (
      hasPendingCardHeightAnimation(view) ||
      hasPendingHoverScaleAnimation(view) ||
      hasPendingHoverShadowAnimation(view)
    ) {
      return false;
    }
    applyHoverScaleToView(view, 1);
    applyHoverShadowAlphaToView(view, 0);
    resetHoverViewY(view);
    restoreFromHover(view.container);
    view.hoverCleanupPending = false;
    onFinalize?.();
    return true;
  }

  function animateCardHeight(view, dt) {
    if (!view) return false;
    const target = Number.isFinite(view.cardHeightTarget)
      ? Math.max(1, view.cardHeightTarget)
      : Number.isFinite(view.baseCardHeight)
      ? Math.max(1, view.baseCardHeight)
      : null;
    if (target == null) return false;
    if (!Number.isFinite(view.cardHeightCurrent)) {
      view.cardHeightCurrent = target;
      return true;
    }
    const current = Math.max(1, view.cardHeightCurrent);
    const diff = target - current;
    if (Math.abs(diff) < 0.5) {
      const snapped = Math.round(target);
      if (Math.round(current) === snapped) return false;
      view.cardHeightCurrent = snapped;
      return true;
    }
    const stepDt = Number.isFinite(dt) ? Math.max(0, dt) : 1 / 60;
    const t = Math.min(1, stepDt / CARD_HEIGHT_TWEEN_SEC);
    view.cardHeightCurrent = current + diff * t;
    return true;
  }

  function redrawTileCardVisuals(view) {
    if (!view) return;
    const height = Math.max(
      1,
      Math.round(
        Number.isFinite(view.cardHeightCurrent)
          ? view.cardHeightCurrent
          : view.baseCardHeight ?? TILE_HEIGHT
      )
    );
    drawCardOuterBg(view.baseBg, TILE_WIDTH, height, 8, 0x3a3a3a);
    drawCardInnerFill(view.cardFill, TILE_WIDTH, height, 8, view.cardFillColor ?? 0x6f8a6f);
    drawTileActivityOverlay(view.forageActivityOverlay, TILE_WIDTH, height, ACTIVITY_FORAGE_COLOR);
    drawTileActivityOverlay(view.fishActivityOverlay, TILE_WIDTH, height, ACTIVITY_FISH_COLOR);
    drawApOverlay(view.apOverlay, TILE_WIDTH, height, 8);
    drawPawnLandingOverlay(view.pawnLandingOverlay, TILE_WIDTH, height, 8);
    drawFocusOutline(view.focusOutline, TILE_WIDTH, height, 6);
    view.cardHeight = height;
  }

  function updateTileTagLayoutForHoverState(view) {
    if (!view) return { totalContentHeight: 0, expandedContentBottomY: 0 };
    const baseStartY = Number.isFinite(view.tagStartYBase)
      ? view.tagStartYBase
      : Number.isFinite(view.tagStartY)
      ? view.tagStartY
      : 0;
    view.tagStartY = baseStartY;
    view.tagContainer.y = view.tagStartY;
    const metrics = tagUi?.layoutTagEntries?.(view) || {};
    const totalContentHeight = Math.max(
      0,
      Number.isFinite(metrics.totalContentHeight)
        ? metrics.totalContentHeight
        : Number.isFinite(view.totalContentHeight)
        ? view.totalContentHeight
        : 0
    );
    const tagsBottom = view.tagStartY + totalContentHeight;
    if (view.ordersButton) {
      view.ordersButton.visible = !!view.isHovered;
      view.ordersButton.y = tagsBottom + 4;
    }
    const ordersBottom =
      view.ordersButton?.visible && Number.isFinite(view.ordersButton?.y)
        ? view.ordersButton.y + ORDERS_BUTTON_HEIGHT
        : tagsBottom;
    const requiredBottom = Math.max(tagsBottom, ordersBottom + CARD_BOTTOM_PAD);
    view.hoverInfoBottomY = Math.max(view.baseCardHeight ?? TILE_HEIGHT, requiredBottom);
    view.cardHeightTarget = Math.max(
      view.baseCardHeight ?? TILE_HEIGHT,
      Math.ceil(requiredBottom)
    );
    return metrics;
  }

  function refreshTileHoverPresentation(view, dt = 0, { updateHoverContext = true } = {}) {
    if (!view) return null;
    const currentScale = Number.isFinite(view.hoverScaleApplied) ? view.hoverScaleApplied : 1;
    if (
      !view.isHovered &&
      !view.hoverCleanupPending &&
      !hasPendingCardHeightAnimation(view) &&
      !hasPendingHoverShadowAnimation(view)
    ) {
      if (Math.abs(currentScale - 1) <= 0.001) return null;
    }
    updateTileTagLayoutForHoverState(view);
    const heightChanged = animateCardHeight(view, dt);
    if (heightChanged) {
      redrawTileCardVisuals(view);
      updateTileTagLayoutForHoverState(view);
    }
    const wantsHoverZoom = view.isHovered && shouldAllowHoverZoomIn(view);
    const targetScale = wantsHoverZoom ? resolveAdaptiveHoverScale(view.cardHeightCurrent) : 1;
    setHoverScaleTarget(view, targetScale);
    setHoverShadowAlphaTarget(view, wantsHoverZoom ? 1 : 0);
    animateHoverScale(view, dt);
    animateHoverShadowAlpha(view, dt);
    if (!view.isHovered) {
      finalizeHoverExit(view, () => {
        view.hoverAnchor = null;
        view.hoverUiAnchor = null;
      });
      return null;
    }
    const hoverScale = Number.isFinite(view.hoverScaleApplied) ? view.hoverScaleApplied : 1;
    fitHoverViewY(view, view.cardHeightCurrent, view.hoverInfoBottomY, hoverScale);
    const anchor = getScaledAnchorRect(
      view.container,
      TILE_WIDTH,
      view.cardHeightCurrent,
      hoverScale,
      resolveViewBaseY(view)
    );
    const uiAnchor = getScaledAnchorRect(
      view.container,
      TILE_WIDTH,
      Math.max(1, view.baseCardHeight ?? TILE_HEIGHT),
      hoverScale,
      resolveViewBaseY(view)
    );
    view.hoverAnchor = anchor;
    view.hoverUiAnchor = uiAnchor;
    if (updateHoverContext) {
      const anchorCol = Number.isFinite(view.tile?.col)
        ? Math.floor(view.tile.col)
        : Number.isFinite(view.col)
        ? Math.floor(view.col)
        : 0;
      const span =
        Number.isFinite(view.tile?.span) && view.tile.span > 0
          ? Math.floor(view.tile.span)
          : 1;
      setHoverContext("tile", anchorCol, span, uiAnchor);
    }
    return getProjectedHoverUiAnchor(
      view,
      TILE_WIDTH,
      Math.max(1, view.baseCardHeight ?? TILE_HEIGHT),
      view.hoverInfoBottomY
    );
  }

  function applyTileHover(view) {
    if (!view?.container || !view?.tile) return;
    const { title, desc } = getTileUi(view.tile, getGameState?.());
    view.setHoverActive?.(true);
    elevateForHover(view.container);
    view.isHovered = true;
    view.hoverCleanupPending = false;
    const anchor = refreshTileHoverPresentation(view, 0, { updateHoverContext: true });
    tooltipView?.show?.(
      {
        title,
        lines: desc ? [desc] : [],
        scale: view.hoverScaleApplied ?? GAMEPIECE_HOVER_SCALE,
      },
      anchor || view.hoverUiAnchor || view.hoverAnchor
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
    view.focusOutline.visible = next || view.inventoryDragAffordance != null;
    if (view.focusOutline.visible) {
      drawFocusOutline(
        view.focusOutline,
        Math.max(1, Math.floor(view.cardWidth ?? HUB_STRUCTURE_WIDTH)),
        Math.max(1, Math.floor(view.cardHeightCurrent ?? view.baseCardHeight ?? HUB_STRUCTURE_HEIGHT)),
        8,
        getInventoryDragOutlineColor(view.inventoryDragAffordance)
      );
    }
  }

  function clearAllHubFocus() {
    for (const view of hubStructureViews.values()) {
      if (!view?.isFocused) continue;
      setHubFocus(view, false);
    }
    focusedHubCol = null;
  }

  function setInventoryDragAffordances(nextAffordances = null) {
    inventoryDragAffordanceByOwnerId.clear();
    if (nextAffordances instanceof Map) {
      for (const [ownerId, level] of nextAffordances.entries()) {
        if (ownerId == null || level == null) continue;
        inventoryDragAffordanceByOwnerId.set(normalizeInventoryDragOwnerId(ownerId), level);
      }
    }

    for (const view of envStructureViews.values()) {
      if (!view?.focusOutline) continue;
      const ownerId = view.structure?.instanceId ?? null;
      const nextLevel =
        ownerId != null && view.structureHasInventory?.()
          ? inventoryDragAffordanceByOwnerId.get(normalizeInventoryDragOwnerId(ownerId)) ?? null
          : null;
      if (view.inventoryDragAffordance === nextLevel) continue;
      view.inventoryDragAffordance = nextLevel;
      redrawEnvStructureCard(view);
      view.focusOutline.visible = nextLevel != null;
    }

    for (const view of hubStructureViews.values()) {
      if (!view?.focusOutline) continue;
      const ownerId = view.structure?.instanceId ?? null;
      const nextLevel =
        ownerId != null && view.structureHasInventory?.()
          ? inventoryDragAffordanceByOwnerId.get(normalizeInventoryDragOwnerId(ownerId)) ?? null
          : null;
      if (view.inventoryDragAffordance === nextLevel) {
        view.focusOutline.visible = view.isFocused || nextLevel != null;
        continue;
      }
      view.inventoryDragAffordance = nextLevel;
      updateHubStructureViewUi(view, view.structure, { force: true });
      view.focusOutline.visible = view.isFocused || nextLevel != null;
    }
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
    const externalFocus =
      typeof getExternalFocus === "function" ? getExternalFocus() : null;
    const externalTileCol =
      Number.isFinite(externalFocus?.envCol) &&
      (externalFocus?.kind === "tile" || externalFocus?.kind === "event")
        ? Math.floor(externalFocus.envCol)
        : null;
    const externalHubCol =
      Number.isFinite(externalFocus?.hubCol) && externalFocus?.kind === "hub"
        ? Math.floor(externalFocus.hubCol)
        : null;
    const resolvedTileCol = nextTileCol ?? externalTileCol;
    const resolvedHubCol = nextHubCol ?? externalHubCol;

    if (resolvedTileCol == null) {
      if (focusedTileCol != null) clearAllTileFocus();
    } else {
      if (focusedTileCol !== resolvedTileCol) {
        if (focusedTileCol != null) {
          const prev = tileViews[focusedTileCol];
          if (prev) setTileFocus(prev, false);
        }
        focusedTileCol = resolvedTileCol;
      }
      const view = tileViews[resolvedTileCol];
      if (view) setTileFocus(view, true);
    }

    if (resolvedHubCol == null) {
      if (focusedHubCol != null) clearAllHubFocus();
    } else {
      if (focusedHubCol !== resolvedHubCol) {
        if (focusedHubCol != null) {
          const prev = findHubViewByCol(focusedHubCol);
          if (prev) setHubFocus(prev, false);
        }
        focusedHubCol = resolvedHubCol;
      }
      const view = findHubViewByCol(resolvedHubCol);
      if (view) setHubFocus(view, true);
    }
  }

  function refreshHubHoverPresentation(
    view,
    width,
    span,
    anchorCol,
    dt = 0,
    { updateHoverContext = true } = {}
  ) {
    if (!view) return null;
    const baseHeight = Math.max(1, view.baseCardHeight ?? HUB_STRUCTURE_HEIGHT);
    const hasPendingHeight = hasPendingCardHeightAnimation(view);
    const hasPendingScale = hasPendingHoverScaleAnimation(view);
    const hasPendingShadow = hasPendingHoverShadowAnimation(view);
    if (
      !view.isHovered &&
      !view.hoverCleanupPending &&
      !hasPendingHeight &&
      !hasPendingScale &&
      !hasPendingShadow
    ) {
      return null;
    }
    if (!view.isHovered) {
      updateHubStructureViewUi(view, view.structure, { force: true });
      const changed = animateCardHeight(view, dt);
      if (changed) {
        redrawHubCardVisuals(view);
        updateHubStructureViewUi(view, view.structure, { force: true });
      }
      setHoverScaleTarget(view, 1);
      setHoverShadowAlphaTarget(view, 0);
      animateHoverScale(view, dt);
      animateHoverShadowAlpha(view, dt);
      finalizeHoverExit(view, () => {
        view.hoverAnchor = null;
        view.hoverUiAnchor = null;
        updateHubStructureViewUi(view, view.structure, { force: true });
      });
      return null;
    }
    updateHubStructureViewUi(view, view.structure, { force: true });
    const heightChanged = animateCardHeight(view, dt);
    if (heightChanged) {
      redrawHubCardVisuals(view);
      updateHubStructureViewUi(view, view.structure, { force: true });
    }
    const wantsHoverZoom = shouldAllowHoverZoomIn(view);
    const hoverScaleTarget = wantsHoverZoom ? resolveAdaptiveHoverScale(view.cardHeightCurrent) : 1;
    setHoverScaleTarget(view, hoverScaleTarget);
    setHoverShadowAlphaTarget(view, wantsHoverZoom ? 1 : 0);
    animateHoverScale(view, dt);
    animateHoverShadowAlpha(view, dt);
    const hoverScale = Number.isFinite(view.hoverScaleApplied) ? view.hoverScaleApplied : 1;
    fitHoverViewY(view, view.cardHeightCurrent, view.hoverInfoBottomY, hoverScale);
    const anchor = getScaledAnchorRect(
      view.container,
      width,
      view.cardHeightCurrent,
      hoverScale,
      resolveViewBaseY(view)
    );
    const uiAnchor = getScaledAnchorRect(
      view.container,
      width,
      baseHeight,
      hoverScale,
      resolveViewBaseY(view)
    );
    view.hoverAnchor = anchor;
    view.hoverUiAnchor = uiAnchor;
    if (updateHoverContext) {
      setHoverContext("hub", anchorCol, span, uiAnchor);
    }
    return getProjectedHoverUiAnchor(view, width, baseHeight, view.hoverInfoBottomY);
  }

  function applyHubStructureHover(view) {
    if (!view?.container || !view?.structure) return;
    const { title, lines } = getHubStructureUi(view.structure, getGameState?.());
    const def = hubStructureDefs[view.structure.defId];
    const span =
      Number.isFinite(view.structure?.span) && view.structure.span > 0
        ? Math.floor(view.structure.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const width = HUB_STRUCTURE_WIDTH * span + HUB_COL_GAP * (span - 1);
    const anchorCol = Number.isFinite(view.structure?.col)
      ? Math.floor(view.structure.col)
      : Number.isFinite(view.col)
      ? Math.floor(view.col)
      : 0;
    view.setHoverActive?.(true);
    elevateForHover(view.container);
    view.isHovered = true;
    view.hoverCleanupPending = false;
    const anchor = refreshHubHoverPresentation(view, width, span, anchorCol, 0, {
      updateHoverContext: true,
    });

    tooltipView?.show?.(
      { title, lines, scale: view.hoverScaleApplied ?? GAMEPIECE_HOVER_SCALE },
      anchor || view.hoverUiAnchor || view.hoverAnchor
    );

    if (inventoryView && view.structureHasInventory?.()) {
      const bounds = anchor || view.hoverUiAnchor || view.hoverAnchor;
      if (bounds) {
        inventoryView.showOnHover(view.structure.instanceId, {
          coordinateSpace: bounds.coordinateSpace ?? "parent",
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
      }
    }
  }

  function getHubHoverGeometry(view) {
    const structure = view?.structure;
    const def = structure?.defId ? hubStructureDefs[structure.defId] : null;
    const span =
      Number.isFinite(structure?.span) && structure.span > 0
        ? Math.floor(structure.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const width = HUB_STRUCTURE_WIDTH * span + HUB_COL_GAP * (span - 1);
    const anchorCol = Number.isFinite(structure?.col)
      ? Math.floor(structure.col)
      : Number.isFinite(view?.col)
      ? Math.floor(view.col)
      : 0;
    return { width, span, anchorCol };
  }

  function getEnvStructureHoverGeometry(view) {
    const structure = view?.structure;
    const def = structure?.defId ? envStructureDefs[structure.defId] : null;
    const span =
      Number.isFinite(structure?.span) && structure.span > 0
        ? Math.floor(structure.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const width = ENV_STRUCTURE_WIDTH * span + BOARD_COL_GAP * (span - 1);
    const anchorCol = Number.isFinite(structure?.col)
      ? Math.floor(structure.col)
      : Number.isFinite(view?.col)
      ? Math.floor(view.col)
      : 0;
    return { width, span, anchorCol };
  }

  function updateDynamicCardLayouts(dt) {
    const hoverView = activeHover?.view ?? null;
    const hoverKind = activeHover?.kind ?? null;

    for (const view of tileViews) {
      if (!view) continue;
      const isHoverFocus = hoverKind === "tile" && hoverView === view;
      const anchor = refreshTileHoverPresentation(view, dt, {
        updateHoverContext: isHoverFocus,
      });
      if (!isHoverFocus || !anchor) continue;
      if (view.childTooltipHoverActive) continue;
      const { title, desc } = getTileUi(view.tile, getGameState?.());
      tooltipView?.show?.(
        {
          title,
          lines: desc ? [desc] : [],
          scale: view.hoverScaleApplied ?? GAMEPIECE_HOVER_SCALE,
        },
        anchor
      );
    }

    for (const view of hubStructureViews.values()) {
      if (!view) continue;
      const { width, span, anchorCol } = getHubHoverGeometry(view);
      const isHoverFocus = hoverKind === "hub" && hoverView === view;
      const anchor = refreshHubHoverPresentation(view, width, span, anchorCol, dt, {
        updateHoverContext: isHoverFocus,
      });
      if (!isHoverFocus || !anchor) continue;
      if (view.childTooltipHoverActive) continue;
      const { title, lines } = getHubStructureUi(view.structure, getGameState?.());
      tooltipView?.show?.(
        {
          title,
          lines,
          scale: view.hoverScaleApplied ?? GAMEPIECE_HOVER_SCALE,
        },
        anchor
      );
      if (inventoryView && view.structureHasInventory?.()) {
        inventoryView.showOnHover(view.structure.instanceId, {
          coordinateSpace: anchor.coordinateSpace ?? "parent",
          x: anchor.x,
          y: anchor.y,
          width: anchor.width,
          height: anchor.height,
        });
      }
    }

    for (const view of envStructureViews.values()) {
      if (!view) continue;
      const { width, span, anchorCol } = getEnvStructureHoverGeometry(view);
      const isHoverFocus = hoverKind === "envStructure" && hoverView === view;
      const anchor = refreshEnvStructureHoverPresentation(view, width, span, anchorCol, dt, {
        updateHoverContext: isHoverFocus,
      });
      if (!isHoverFocus || !anchor) continue;
      const { title, desc } = getEnvStructureUi(view.structure, getGameState?.());
      tooltipView?.show?.(
        {
          title,
          lines: desc ? [desc] : [],
          scale: view.hoverScaleApplied ?? GAMEPIECE_HOVER_SCALE,
        },
        anchor
      );
    }

    for (const view of eventViews.values()) {
      if (!view) continue;
      const eventCol = Number.isFinite(view.event?.col)
        ? Math.floor(view.event.col)
        : Number.isFinite(view.event?.envCol)
        ? Math.floor(view.event.envCol)
        : Number.isFinite(view.event?.hubCol)
        ? Math.floor(view.event.hubCol)
        : null;
      const fallbackCol = eventCol != null ? eventCol : 0;
      const span =
        Number.isFinite(view.event?.span) && view.event.span > 0
          ? Math.floor(view.event.span)
          : 1;
      const isHoverFocus = hoverKind === "event" && hoverView === view;
      const anchor = refreshEventHoverPresentation(view, fallbackCol, span, dt, {
        updateHoverContext: isHoverFocus,
      });
      if (!isHoverFocus || !anchor) continue;
      const { title, desc } = getEventUi(view.event);
      tooltipView?.show?.(
        {
          title,
          lines: desc ? [desc] : [],
          scale: view.hoverScaleApplied ?? GAMEPIECE_HOVER_SCALE,
        },
        anchor
      );
    }
  }

  function restoreHoverAfterRebuild(pendingHover, pointerPos) {
    if (!pendingHover || !pointerPos) return;
    if (!canShowGamepieceHoverUiNow()) return;
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
      return;
    }
    if (pendingHover.kind === "envStructure") {
      const targetCol = Number.isFinite(pendingHover.col)
        ? Math.floor(pendingHover.col)
        : null;
      if (targetCol == null) return;
      let view = null;
      for (const candidate of envStructureViews.values()) {
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
        kind: "envStructure",
        col: targetCol,
        clear: () => clearEnvStructureHover(view),
      });
      applyEnvStructureHover(view);
    }
  }

  function removeFromParent(container) {
    if (container?.parent) container.parent.removeChild(container);
  }

  function unregisterPaintForHoverView(view) {
    unregisterPaintContainer(view?.contentPaint);
  }

  function unregisterAreaChromePaint(chrome) {
    if (!chrome) return;
    unregisterPaintContainer(chrome.regionBoardPaintLayer);
    unregisterPaintContainer(chrome.hubBoardPaintLayer);
    unregisterPaintContainer(chrome.regionHeader?.paintLayer);
    unregisterPaintContainer(chrome.hubHeader?.paintLayer);
  }

  function getAreaDisplayName(state, areaKind) {
    const key = areaKind === "hub" ? "hub" : "region";
    const fallback = AREA_NAME_FALLBACKS[key];
    const raw = state?.locationNames?.[key];
    if (typeof raw !== "string") return fallback;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  function sanitizeAreaNameCandidate(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed.length) return null;
    return trimmed.slice(0, 32);
  }

  function dispatchAreaRename(areaKind, nextName) {
    const kind =
      areaKind === "hub" ? ActionKinds.SET_HUB_NAME : ActionKinds.SET_REGION_NAME;
    const run = () => {
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      return (
        dispatchAction(
          kind,
          { name: nextName },
          { apCost: 0 }
        ) ?? { ok: true }
      );
    };
    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused(run);
    }
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) {
      return { ok: false, reason: "mustBePaused" };
    }
    return run();
  }

  function promptForAreaRename(areaKind) {
    const state = getGameState?.();
    if (areaKind === "hub" && !isHubRenameUnlocked(state)) {
      return { ok: false, reason: "renameLocked" };
    }
    const promptFn = globalThis?.prompt;
    if (typeof promptFn !== "function") return { ok: false, reason: "noPrompt" };
    const currentName = getAreaDisplayName(state, areaKind);
    const promptLabel =
      areaKind === "hub" ? "Name this Hub..." : "Name this region ...";
    const proposed = promptFn(promptLabel, currentName);
    if (proposed == null) return { ok: false, reason: "cancelled" };
    const nextName = sanitizeAreaNameCandidate(proposed);
    if (!nextName) return { ok: false, reason: "emptyName" };
    if (nextName === currentName) return { ok: true, result: "nameUnchanged" };
    return dispatchAreaRename(areaKind, nextName);
  }

  function createAreaHeaderChrome(onRename) {
    const container = new PIXI.Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    container.headerEnabled = true;

    const paintLayer = new PIXI.Container();
    const inkLayer = new PIXI.Container();
    const paintBg = new PIXI.Graphics();
    const border = new PIXI.Graphics();
    const accents = new PIXI.Graphics();
    border.eventMode = "none";
    accents.eventMode = "none";
    const text = new PIXI.Text("", {
      fill: 0xf3efe4,
      fontFamily: "Trebuchet MS",
      fontSize: 20,
      fontWeight: "700",
    });
    text.anchor.set(0.5, 0.5);

    paintLayer.addChild(paintBg);
    inkLayer.addChild(border, accents, text);
    container.addChild(paintLayer, inkLayer);

    container.on("pointerover", () => {
      paintBg.alpha = 1;
      border.alpha = 1;
      accents.alpha = 1;
    });
    container.on("pointerout", () => {
      paintBg.alpha = 0.94;
      border.alpha = 0.92;
      accents.alpha = 0.86;
    });
    container.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      if (container.headerEnabled !== true) return;
      onRename?.();
    });
    paintBg.alpha = 0.94;
    border.alpha = 0.92;
    accents.alpha = 0.86;
    return {
      container,
      paintLayer,
      inkLayer,
      paintBg,
      border,
      accents,
      text,
    };
  }

  function drawAreaHeaderChrome(header, width, height) {
    if (!header) return;
    const w = Math.max(180, Math.floor(width));
    const h = Math.max(36, Math.floor(height));
    const r = Math.max(8, Math.floor(h * 0.25));
    header.paintBg.clear();
    header.paintBg.beginFill(0x565252, 0.98);
    header.paintBg.drawRoundedRect(0, 0, w, h, r);
    header.paintBg.endFill();

    header.border.clear();
    header.border.lineStyle(2, 0x73695f, 0.92);
    header.border.drawRoundedRect(0, 0, w, h, r);

    header.accents.clear();
    header.accents.lineStyle(3, 0xb69e45, 0.86);
    const midY = Math.round(h * 0.5);
    const leftStart = 30;
    const rightStart = w - 30;
    const accentLen = 40;
    header.accents.moveTo(leftStart, midY);
    header.accents.bezierCurveTo(
      leftStart - 9,
      midY - 11,
      leftStart - 22,
      midY + 10,
      leftStart - accentLen,
      midY
    );
    header.accents.moveTo(rightStart, midY);
    header.accents.bezierCurveTo(
      rightStart + 9,
      midY - 11,
      rightStart + 22,
      midY + 10,
      rightStart + accentLen,
      midY
    );

    header.text.position.set(Math.round(w * 0.5), Math.round(h * 0.5));
  }

  function ensureAreaChrome() {
    if (areaChrome) return areaChrome;
    const regionBoardContainer = new PIXI.Container();
    regionBoardContainer.eventMode = "none";
    regionBoardContainer.zIndex = -200;
    const regionBoardPaintLayer = new PIXI.Container();
    const regionBoardInkLayer = new PIXI.Container();
    const regionBoardFill = new PIXI.Graphics();
    const regionBoardFrame = new PIXI.Graphics();
    const regionBoardInner = new PIXI.Graphics();
    regionBoardPaintLayer.addChild(regionBoardFill);
    regionBoardInkLayer.addChild(regionBoardFrame, regionBoardInner);
    regionBoardContainer.addChild(regionBoardPaintLayer, regionBoardInkLayer);
    tileLayer?.addChild(regionBoardContainer);

    const hubBoardContainer = new PIXI.Container();
    hubBoardContainer.eventMode = "none";
    hubBoardContainer.zIndex = -200;
    const hubBoardPaintLayer = new PIXI.Container();
    const hubBoardInkLayer = new PIXI.Container();
    const hubBoardFill = new PIXI.Graphics();
    const hubBoardFrame = new PIXI.Graphics();
    const hubBoardInner = new PIXI.Graphics();
    hubBoardPaintLayer.addChild(hubBoardFill);
    hubBoardInkLayer.addChild(hubBoardFrame, hubBoardInner);
    hubBoardContainer.addChild(hubBoardPaintLayer, hubBoardInkLayer);
    tileLayer?.addChild(hubBoardContainer);

    const regionHeader = createAreaHeaderChrome(() => promptForAreaRename("region"));
    regionHeader.container.zIndex = -120;
    tileLayer?.addChild(regionHeader.container);

    const hubHeader = createAreaHeaderChrome(() => promptForAreaRename("hub"));
    hubHeader.container.zIndex = -120;
    tileLayer?.addChild(hubHeader.container);

    areaChrome = {
      regionBoardContainer,
      regionBoardPaintLayer,
      regionBoardFill,
      regionBoardFrame,
      regionBoardInner,
      hubBoardContainer,
      hubBoardPaintLayer,
      hubBoardFill,
      hubBoardFrame,
      hubBoardInner,
      regionHeader,
      hubHeader,
      regionBoardPaintRegistered: false,
      hubBoardPaintRegistered: false,
      regionHeaderPaintRegistered: false,
      hubHeaderPaintRegistered: false,
      layoutKey: "",
      regionName: "",
      hubName: "",
    };
    return areaChrome;
  }

  function syncAreaChrome(state, envCols, hubCols) {
    const chrome = ensureAreaChrome();
    if (!chrome || !app?.screen) return;
    const screenWidth = Math.max(1, Math.floor(app.screen.width));
    const safeEnvCols = Math.max(0, Number.isFinite(envCols) ? Math.floor(envCols) : BOARD_COLS);
    const safeHubCols = Math.max(0, Number.isFinite(hubCols) ? Math.floor(hubCols) : HUB_COLS);
    const hubShown = safeHubCols > 0;
    const hubRenameEnabled = isHubRenameUnlocked(state);

    const regionStartX = getBoardColumnXForVisibleCols(
      screenWidth,
      0,
      Math.max(1, safeEnvCols)
    );
    const regionEndX =
      safeEnvCols > 0
        ? getBoardColumnXForVisibleCols(screenWidth, safeEnvCols - 1, safeEnvCols) + TILE_WIDTH
        : regionStartX;
    const regionPanelX = Math.round(
      regionStartX - REGION_BOARD_PAD_X + REGION_BOARD_OFFSET_X
    );
    const regionPanelY = Math.round(
      EVENT_ROW_Y - REGION_BOARD_PAD_TOP + REGION_BOARD_OFFSET_Y
    );
    const regionPanelW = Math.round(
      Math.max(1, regionEndX - regionStartX) + REGION_BOARD_PAD_X * 2
    );
    const regionPanelH = Math.round(
      TILE_ROW_Y +
        TILE_HEIGHT -
        EVENT_ROW_Y +
        REGION_BOARD_PAD_TOP +
        REGION_BOARD_PAD_BOTTOM
    );

    const hubStartX = getHubColumnXForVisibleCols(screenWidth, 0, Math.max(1, safeHubCols));
    const hubEndX =
      safeHubCols > 0
        ? getHubColumnXForVisibleCols(screenWidth, safeHubCols - 1, safeHubCols) +
          HUB_STRUCTURE_WIDTH
        : hubStartX;
    const hubPanelX = Math.round(
      hubStartX - HUB_BOARD_PAD_X + HUB_BOARD_OFFSET_X
    );
    const hubPanelY = Math.round(
      HUB_STRUCTURE_ROW_Y - HUB_BOARD_PAD_TOP + HUB_BOARD_OFFSET_Y
    );
    const hubPanelW = Math.round(
      Math.max(1, hubEndX - hubStartX) + HUB_BOARD_PAD_X * 2
    );
    const hubPanelH = Math.round(
      HUB_STRUCTURE_HEIGHT + HUB_BOARD_PAD_TOP + HUB_BOARD_PAD_BOTTOM
    );

    const layoutKey = [
      regionPanelX,
      regionPanelY,
      regionPanelW,
      regionPanelH,
      hubPanelX,
      hubPanelY,
      hubPanelW,
      hubPanelH,
    ].join("|");

    if (layoutKey !== chrome.layoutKey) {
      chrome.regionBoardFill.clear();
      chrome.regionBoardFill.beginFill(0x5f5b56, 0.72);
      chrome.regionBoardFill.drawRoundedRect(
        regionPanelX,
        regionPanelY,
        regionPanelW,
        regionPanelH,
        20
      );
      chrome.regionBoardFill.endFill();

      chrome.regionBoardFrame.clear();
      chrome.regionBoardFrame.lineStyle(4, 0x777168, 0.9);
      chrome.regionBoardFrame.drawRoundedRect(
        regionPanelX,
        regionPanelY,
        regionPanelW,
        regionPanelH,
        20
      );

      chrome.regionBoardInner.clear();
      chrome.regionBoardInner.lineStyle(2, 0x8f867a, 0.24);
      chrome.regionBoardInner.drawRoundedRect(
        regionPanelX + 8,
        regionPanelY + 8,
        Math.max(1, regionPanelW - 16),
        Math.max(1, regionPanelH - 16),
        14
      );

      chrome.hubBoardFill.clear();
      chrome.hubBoardFill.beginFill(0x5f5b56, 0.72);
      chrome.hubBoardFill.drawRoundedRect(hubPanelX, hubPanelY, hubPanelW, hubPanelH, 20);
      chrome.hubBoardFill.endFill();

      chrome.hubBoardFrame.clear();
      chrome.hubBoardFrame.lineStyle(4, 0x777168, 0.9);
      chrome.hubBoardFrame.drawRoundedRect(hubPanelX, hubPanelY, hubPanelW, hubPanelH, 20);

      chrome.hubBoardInner.clear();
      chrome.hubBoardInner.lineStyle(2, 0x8f867a, 0.24);
      chrome.hubBoardInner.drawRoundedRect(
        hubPanelX + 8,
        hubPanelY + 8,
        Math.max(1, hubPanelW - 16),
        Math.max(1, hubPanelH - 16),
        14
      );

      const regionHeaderWidth = clamp(
        Math.round(regionPanelW * REGION_HEADER_WIDTH_RATIO),
        REGION_HEADER_MIN_WIDTH,
        REGION_HEADER_MAX_WIDTH
      );
      const hubHeaderWidth = clamp(
        Math.round(hubPanelW * HUB_HEADER_WIDTH_RATIO),
        HUB_HEADER_MIN_WIDTH,
        HUB_HEADER_MAX_WIDTH
      );
      drawAreaHeaderChrome(
        chrome.regionHeader,
        regionHeaderWidth,
        REGION_HEADER_HEIGHT
      );
      drawAreaHeaderChrome(chrome.hubHeader, hubHeaderWidth, HUB_HEADER_HEIGHT);

      chrome.regionHeader.container.x = Math.round(
        regionPanelX +
          regionPanelW * 0.5 -
          regionHeaderWidth * 0.5 +
          REGION_HEADER_OFFSET_X
      );
      chrome.regionHeader.container.y = Math.round(
        regionPanelY - REGION_HEADER_HEIGHT * 0.62 + REGION_HEADER_OFFSET_Y
      );
      chrome.hubHeader.container.x = Math.round(
        hubPanelX + hubPanelW * 0.5 - hubHeaderWidth * 0.5 + HUB_HEADER_OFFSET_X
      );
      chrome.hubHeader.container.y = Math.round(
        hubPanelY - HUB_HEADER_HEIGHT * 0.62 + HUB_HEADER_OFFSET_Y
      );
      chrome.layoutKey = layoutKey;
    }

    if (!chrome.regionBoardPaintRegistered) {
      registerPaintContainer(chrome.regionBoardPaintLayer);
      chrome.regionBoardPaintRegistered = true;
    }
    if (!chrome.hubBoardPaintRegistered) {
      registerPaintContainer(chrome.hubBoardPaintLayer);
      chrome.hubBoardPaintRegistered = true;
    }
    if (!chrome.regionHeaderPaintRegistered) {
      registerPaintContainer(chrome.regionHeader?.paintLayer);
      chrome.regionHeaderPaintRegistered = true;
    }
    if (!chrome.hubHeaderPaintRegistered) {
      registerPaintContainer(chrome.hubHeader?.paintLayer);
      chrome.hubHeaderPaintRegistered = true;
    }

    const regionName = getAreaDisplayName(state, "region");
    if (regionName !== chrome.regionName) {
      chrome.regionHeader.text.text = regionName;
      chrome.regionName = regionName;
    }
    const hubName = getAreaDisplayName(state, "hub");
    if (hubName !== chrome.hubName) {
      chrome.hubHeader.text.text = hubName;
      chrome.hubName = hubName;
    }

    chrome.hubBoardContainer.visible = hubShown;
    chrome.hubHeader.container.visible = hubShown;
    chrome.hubHeader.container.eventMode = hubShown ? "static" : "none";
    chrome.hubHeader.container.headerEnabled = hubRenameEnabled;
    chrome.hubHeader.container.cursor = hubRenameEnabled ? "pointer" : "default";
  }

  function dispatchTagOrder(envCol, tagIds) {
    const runWhenPaused = () => {
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
    const runWhenLive = () => {
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      return dispatchAction(
        ActionKinds.SET_TILE_TAG_ORDER,
        { envCol, tagIds },
        { apCost: getTilePlanCost() }
      );
    };
    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused({ runWhenPaused, runWhenLive });
    }
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) {
      return { ok: false, reason: "mustBePaused" };
    }
    return runWhenPaused();
  }

  function dispatchTileTagToggle({ envCol, tagId, disabled } = {}) {
    if (!isEnvTagVisible(tagId)) return { ok: false, reason: "tagLocked" };
    const resolveNextDisabled = () => {
      let nextDisabled = disabled;
      if (typeof nextDisabled === "boolean") return nextDisabled;
      if (actionPlanner?.getTileTagTogglePreview) {
        const cur = actionPlanner.getTileTagTogglePreview({ envCol, tagId });
        return cur == null ? true : !cur;
      }
      const state = getGameState?.();
      const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
      const tile = col != null ? state?.board?.occ?.tile?.[col] : null;
      const cur = tile?.tagStates?.[tagId]?.disabled === true;
      return !cur;
    };
    const runWhenPaused = () => {
      const tileName = getTileNameByCol(envCol);
      const tagName = envTagDefs?.[tagId]?.ui?.name || tagId || "Tag";
      const nextDisabled = resolveNextDisabled();
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
    const runWhenLive = () => {
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      return dispatchAction(
        ActionKinds.TOGGLE_TILE_TAG,
        { envCol, tagId, disabled: resolveNextDisabled() },
        { apCost: getTilePlanCost() }
      );
    };
    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused({ runWhenPaused, runWhenLive });
    }
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) {
      return { ok: false, reason: "mustBePaused" };
    }
    return runWhenPaused();
  }
  // Tag + system UI helpers live in board/board-tag-ui.js.

  function endTagDrag(view, commit, globalPos = null) {
    tileTagDragController?.endDrag?.(view, commit, globalPos);
  }

  function dispatchHubTagOrder(hubCol, tagIds) {
    const runWhenPaused = () => {
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
    const runWhenLive = () => {
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      return dispatchAction(
        ActionKinds.SET_HUB_TAG_ORDER,
        { hubCol, tagIds },
        { apCost: getHubPlanCost() }
      );
    };
    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused({ runWhenPaused, runWhenLive });
    }
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) {
      return { ok: false, reason: "mustBePaused" };
    }
    return runWhenPaused();
  }

  function dispatchHubTagToggle({ hubCol, tagId, disabled } = {}) {
    if (!isHubTagVisible(tagId)) return { ok: false, reason: "tagLocked" };
    const resolveNextDisabled = () => {
      let nextDisabled = disabled;
      if (typeof nextDisabled === "boolean") return nextDisabled;
      if (actionPlanner?.getHubTagTogglePreview) {
        const cur = actionPlanner.getHubTagTogglePreview({ hubCol, tagId });
        return cur == null ? true : !cur;
      }
      const state = getGameState?.();
      const col = Number.isFinite(hubCol) ? Math.floor(hubCol) : null;
      const structure =
        col != null
          ? state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure
          : null;
      const cur = structure?.tagStates?.[tagId]?.disabled === true;
      return !cur;
    };
    const runWhenPaused = () => {
      if (actionPlanner?.setHubTagToggleIntent) {
        return actionPlanner.setHubTagToggleIntent({
          hubCol,
          tagId,
          disabled: resolveNextDisabled(),
        });
      }
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      dispatchAction(
        ActionKinds.TOGGLE_HUB_TAG,
        { hubCol, tagId, disabled: resolveNextDisabled() },
        { apCost: 5 }
      );
      return { ok: true };
    };
    const runWhenLive = () => {
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      return dispatchAction(
        ActionKinds.TOGGLE_HUB_TAG,
        { hubCol, tagId, disabled: resolveNextDisabled() },
        { apCost: getHubPlanCost() }
      );
    };
    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused({ runWhenPaused, runWhenLive });
    }
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) {
      return { ok: false, reason: "mustBePaused" };
    }
    return runWhenPaused();
  }

  function endHubTagDrag(view, commit, globalPos = null) {
    hubTagDragController?.endDrag?.(view, commit, globalPos);
  }

  function startHubTagDrag(view, entry, ev) {
    if (entry?.dragEnabled !== true) return;
    requestPauseForAction?.();
    if (!view.isHovered) {
      applyHubStructureHover(view);
    }

    if (activeHubTagDrag && activeHubTagDrag !== view) {
      endHubTagDrag(activeHubTagDrag, false);
    }
    if (activeTagDrag && activeTagDrag !== view) {
      endTagDrag(activeTagDrag, false);
    }

    hubTagDragController?.startDrag?.(view, entry, ev);
  }

  function startTagDrag(view, entry, ev) {
    requestPauseForAction?.();
    if (!view.isHovered) {
      applyTileHover(view);
    }

    if (activeTagDrag && activeTagDrag !== view) {
      endTagDrag(activeTagDrag, false);
    }
    if (activeHubTagDrag && activeHubTagDrag !== view) {
      endHubTagDrag(activeHubTagDrag, false);
    }

    tileTagDragController?.startDrag?.(view, entry, ev);
  }

  // --------------------------------------------------------
  // UI helpers
  // --------------------------------------------------------

  function drawOrdersLauncherIcon(graphic, color, width, height) {
    if (!graphic) return;
    const lineColor = Number.isFinite(color) ? Math.floor(color) : 0x4f5862;
    const w = Math.max(20, Math.floor(width));
    const h = Math.max(12, Math.floor(height));
    const insetX = 9;
    const startY = Math.floor(h * 0.32);
    const rowGap = 4;
    const lineW = w - insetX * 2;
    graphic.clear();
    graphic.lineStyle(2, lineColor, 0.95);
    for (let i = 0; i < 3; i += 1) {
      const y = startY + i * rowGap;
      graphic.moveTo(insetX, y);
      graphic.lineTo(insetX + lineW, y);
    }
  }

  function createOrdersLauncher(width, onTap) {
    const button = new PIXI.Container();
    button.eventMode = "static";
    button.cursor = "pointer";

    const bg = new PIXI.Graphics();
    const icon = new PIXI.Graphics();
    button.addChild(bg, icon);

    let hovered = false;
    function redraw() {
      const fill = hovered ? ORDERS_BUTTON_BG_HOVER : ORDERS_BUTTON_BG;
      bg.clear();
      bg
        .lineStyle(1, ORDERS_BUTTON_STROKE, 0.95)
        .beginFill(fill, 0.98)
        .drawRoundedRect(0, 0, ORDERS_BUTTON_WIDTH, ORDERS_BUTTON_HEIGHT, ORDERS_BUTTON_RADIUS)
        .endFill();
      drawOrdersLauncherIcon(
        icon,
        ORDERS_BUTTON_ICON,
        ORDERS_BUTTON_WIDTH,
        ORDERS_BUTTON_HEIGHT
      );
    }

    button.x = Math.round((Math.max(1, width) - ORDERS_BUTTON_WIDTH) * 0.5);
    button.y = 0;
    button.hitArea = new PIXI.Rectangle(0, 0, ORDERS_BUTTON_WIDTH, ORDERS_BUTTON_HEIGHT);
    button.on("pointerdown", (ev) => ev?.stopPropagation?.());
    button.on("pointerover", () => {
      hovered = true;
      redraw();
    });
    button.on("pointerout", () => {
      hovered = false;
      redraw();
    });
    button.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      onTap?.();
    });

    redraw();
    return button;
  }

  function getOrdersAnchorRect(button) {
    const bounds = button?.getBounds?.();
    if (!bounds) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }

  function getTileUi(tileInst, state = getGameState?.()) {
    const def = envTileDefs[tileInst.defId];
    const revealed = isTileRevealed(tileInst, state);
    const title = revealed ? def?.name || tileInst.defId || "Tile" : "???";
    const desc = revealed ? def?.ui?.description || "" : "";
    const uiColor = def?.ui?.color;
    const color = revealed
      ? Number.isFinite(uiColor)
        ? uiColor
        : def?.color ?? 0x6f8a6f
      : 0x6a6863;
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    return { def, title, desc, color, tags };
  }

  function getTileNameByCol(envCol) {
    const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
    const state = getGameState?.();
    const tile = col != null ? state?.board?.occ?.tile?.[col] : null;
    if (tile) {
      if (!isEnvColRevealed(state, col)) return "???";
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

  function redrawEnvStructureCard(view) {
    if (!view) return;
    const width = Math.max(1, Math.floor(view.cardWidth ?? ENV_STRUCTURE_WIDTH));
    const height = Math.max(
      1,
      Math.floor(view.cardHeightCurrent ?? view.baseCardHeight ?? ENV_STRUCTURE_HEIGHT)
    );
    drawCardOuterBg(view.baseBg, width, height, 8, 0x2f2f2f);
    drawCardInnerFill(view.cardFill, width, height, 8, view.cardFillColor ?? 0x5f6a73);
    drawFocusOutline(
      view.focusOutline,
      width,
      height,
      8,
      getInventoryDragOutlineColor(view.inventoryDragAffordance)
    );
  }

  function refreshEnvStructureHoverPresentation(
    view,
    width,
    span,
    anchorCol,
    dt = 0,
    { updateHoverContext = true } = {}
  ) {
    if (!view) return null;
    const baseHeight = Math.max(1, view.baseCardHeight ?? ENV_STRUCTURE_HEIGHT);
    const hasPendingHeight = hasPendingCardHeightAnimation(view);
    const hasPendingScale = hasPendingHoverScaleAnimation(view);
    const hasPendingShadow = hasPendingHoverShadowAnimation(view);
    if (
      !view.isHovered &&
      !view.hoverCleanupPending &&
      !hasPendingHeight &&
      !hasPendingScale &&
      !hasPendingShadow
    ) {
      return null;
    }
    if (view.descText) {
      view.descText.visible = !!view.isHovered;
    }
    const descBottom =
      view.descText?.visible && Number.isFinite(view.descText?.y) && Number.isFinite(view.descText?.height)
        ? view.descText.y + view.descText.height
        : view.titleText.y + view.titleText.height;
    const requiredBottom = Math.max(baseHeight, descBottom + CARD_BOTTOM_PAD);
    view.hoverInfoBottomY = requiredBottom;
    view.cardHeightTarget = view.isHovered ? requiredBottom : baseHeight;
    const changed = animateCardHeight(view, dt);
    if (changed) {
      redrawEnvStructureCard(view);
    }
    const wantsHoverZoom = view.isHovered && shouldAllowHoverZoomIn(view);
    setHoverScaleTarget(
      view,
      wantsHoverZoom ? resolveAdaptiveHoverScale(view.cardHeightCurrent) : 1
    );
    setHoverShadowAlphaTarget(view, wantsHoverZoom ? 1 : 0);
    animateHoverScale(view, dt);
    animateHoverShadowAlpha(view, dt);
    if (!view.isHovered) {
      finalizeHoverExit(view, () => {
        view.hoverAnchor = null;
        view.hoverUiAnchor = null;
      });
      return null;
    }
    const hoverScale = Number.isFinite(view.hoverScaleApplied) ? view.hoverScaleApplied : 1;
    fitHoverViewY(view, view.cardHeightCurrent, view.hoverInfoBottomY, hoverScale);
    const anchor = getScaledAnchorRect(
      view.container,
      width,
      view.cardHeightCurrent,
      hoverScale,
      resolveViewBaseY(view)
    );
    const uiAnchor = getScaledAnchorRect(
      view.container,
      width,
      baseHeight,
      hoverScale,
      resolveViewBaseY(view)
    );
    view.hoverAnchor = anchor;
    view.hoverUiAnchor = uiAnchor;
    if (updateHoverContext) {
      setHoverContext("envStructure", anchorCol, span, uiAnchor);
    }
    return getProjectedHoverUiAnchor(view, width, baseHeight, view.hoverInfoBottomY);
  }

  function applyEnvStructureHover(view) {
    if (!view?.container || !view?.structure) return;
    const { title, desc } = getEnvStructureUi(view.structure, getGameState?.());
    const def = envStructureDefs[view.structure.defId];
    const span =
      Number.isFinite(view.structure?.span) && view.structure.span > 0
        ? Math.floor(view.structure.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const width = ENV_STRUCTURE_WIDTH * span + BOARD_COL_GAP * (span - 1);
    const anchorCol = Number.isFinite(view.structure?.col)
      ? Math.floor(view.structure.col)
      : Number.isFinite(view.col)
      ? Math.floor(view.col)
      : 0;
    view.setHoverActive?.(true);
    elevateForHover(view.container);
    view.isHovered = true;
    view.hoverCleanupPending = false;
    const anchor = refreshEnvStructureHoverPresentation(view, width, span, anchorCol, 0, {
      updateHoverContext: true,
    });
    tooltipView?.show?.(
      {
        title,
        lines: desc ? [desc] : [],
        scale: view.hoverScaleApplied ?? GAMEPIECE_HOVER_SCALE,
      },
      anchor
    );
  }

  function getEnvStructureUi(structureInst, state = getGameState?.()) {
    const def = envStructureDefs[structureInst.defId];
    const ui = def?.ui || {};
    const title =
      (typeof ui.title === "function"
        ? ui.title(structureInst, def, state)
        : ui.title) ||
      def?.name ||
      structureInst.defId ||
      "Structure";
    const desc =
      (typeof ui.description === "function"
        ? ui.description(structureInst, def, state)
        : ui.description) || "";
    const uiColor = ui?.color;
    const color = Number.isFinite(uiColor)
      ? uiColor
      : Number.isFinite(def?.color)
      ? def.color
      : 0x5f6a73;
    return { def, title, desc, color };
  }

  function getBuildProcess(structureInst) {
    const processes = Array.isArray(structureInst?.systemState?.build?.processes)
      ? structureInst.systemState.build.processes
      : [];
    return processes.find((proc) => proc?.type === "build") ?? null;
  }

  function getHubStructureUi(structureInst, state = getGameState?.()) {
    const def = hubStructureDefs[structureInst.defId];
    const buildProcess = getBuildProcess(structureInst);
    if (buildProcess) {
      const preserveStructureTitle = buildProcess?.preserveStructureTitle === true;
      const name = def?.name || structureInst.defId || "Structure";
      return {
        def,
        title: preserveStructureTitle ? name : `${name} (Construction)`,
        lines: [preserveStructureTitle ? "Rebuilding..." : "Build in progress."],
        color: 0x6f6f6f,
        meters: [],
      };
    }
    const ui = def?.ui || {};
    const title =
      (typeof ui.title === "function"
        ? ui.title(structureInst, def, state)
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

      const ratioClamped = Math.max(0, Math.min(1, ratio));
      const quantizedRatio = Math.round(ratioClamped * 1000);
      const renderKey = `${label}|${quantizedRatio}|${Math.floor(width)}`;
      if (mv.lastRenderKey === renderKey) {
        continue;
      }
      mv.lastRenderKey = renderKey;

      if (labelText.text !== label) {
        labelText.text = label;
      }
      barFill.clear();
      const fillWidth = width * ratioClamped;
      if (fillWidth > 0.001) {
        barFill.beginFill(0x00cc66);
        barFill.drawRoundedRect(8, labelText.y + 14, fillWidth, 6, 3);
        barFill.endFill();
      }
    }
  }

  function redrawHubCardVisuals(view) {
    if (!view) return;
    const width = Math.max(1, Math.floor(view.cardWidth ?? HUB_STRUCTURE_WIDTH));
    const height = Math.max(
      1,
      Math.floor(view.cardHeightCurrent ?? view.cardHeight ?? view.baseCardHeight ?? HUB_STRUCTURE_HEIGHT)
    );
    drawCardOuterBg(view.baseBg, width, height, 10, 0x3a3a3a);
    drawCardInnerFill(view.cardFill, width, height, 10, view.cardFillColor ?? 0x336699);
    drawApOverlay(view.apOverlay, width, height, 10);
    drawPawnLandingOverlay(view.pawnLandingOverlay, width, height, 10);
    drawDistributorRangeOverlay(view.distributorRangeOverlay, width, height, 10);
    drawBuildPlacementOverlay(
      view.buildPlacementOverlay,
      width,
      height,
      10,
      view.buildPlacementOverlayState ?? null
    );
    drawFocusOutline(
      view.focusOutline,
      width,
      height,
      8,
      getInventoryDragOutlineColor(view.inventoryDragAffordance)
    );
    view.cardHeight = height;
  }

  function updateHubStructureViewUi(view, structureInst, opts = null) {
    if (!view || !structureInst) return false;
    const force = opts?.force === true;
    const buildProcess = getBuildProcess(structureInst);
    const ui = getHubStructureUi(structureInst, getGameState?.());
    const buildActive = !!buildProcess;
    const visibleLines = view.isHovered ? ui.lines : [];
    const signature = `${ui.title}|${visibleLines.join("|")}|${ui.color}|${
      view.isHovered ? 1 : 0
    }`;
    if (!force && signature === view.uiSignature) {
      if (view.cancelButton) {
        view.cancelButton.visible = buildActive && buildProcess?.allowCancel !== false;
      }
      if (view.ordersButton) {
        view.ordersButton.visible = !!view.isHovered;
      }
      return false;
    }
    view.uiSignature = signature;

    if (view.cardFillColor !== ui.color) {
      view.cardFillColor = ui.color;
    }
    redrawHubCardVisuals(view);

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

    let detailsBottomY = view.titleText.y + view.titleText.height + 2;
    for (const meterView of view.meterViews || []) {
      if (!Number.isFinite(meterView?.labelText?.y)) continue;
      detailsBottomY = Math.max(detailsBottomY, meterView.labelText.y + 22);
    }

    view.tagStartY = detailsBottomY + 2;
    view.tagContainer.y = view.tagStartY;
    const tagMetrics = hubTagUi?.layoutTagEntries?.(view) || {};
    const totalTagHeight = Math.max(
      0,
      Number.isFinite(tagMetrics.totalContentHeight)
        ? tagMetrics.totalContentHeight
        : Number.isFinite(view.totalContentHeight)
        ? view.totalContentHeight
        : 0
    );
    const tagsBottom = view.tagStartY + totalTagHeight;

    if (view.ordersButton) {
      view.ordersButton.visible = !!view.isHovered;
      view.ordersButton.y = tagsBottom + 4;
    }
    const lineStartY =
      view.ordersButton?.visible && Number.isFinite(view.ordersButton?.y)
        ? view.ordersButton.y + ORDERS_BUTTON_HEIGHT + 2
        : tagsBottom + 2;
    let lineY = lineStartY;
    for (const line of visibleLines) {
      const t = new PIXI.Text(line, {
        fill: 0x000000,
        fontSize: 10,
        wordWrap: true,
        wordWrapWidth: view.cardWidth - 12,
      });
      t.x = 6;
      t.y = lineY;
      view.contentInk.addChild(t);
      view.lineTextNodes.push(t);
      lineY += t.height + 1;
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
      }
      setTextResolution(
        view.hoverTextNodes,
        view.isHovered ? HOVER_TEXT_RESOLUTION : BASE_TEXT_RESOLUTION
      );
    }

    const ordersBottom =
      view.ordersButton?.visible && Number.isFinite(view.ordersButton?.y)
        ? view.ordersButton.y + ORDERS_BUTTON_HEIGHT
        : tagsBottom;
    let lineBottom = lineStartY;
    for (const node of view.lineTextNodes || []) {
      if (!Number.isFinite(node?.y) || !Number.isFinite(node?.height)) continue;
      lineBottom = Math.max(lineBottom, node.y + node.height);
    }
    const requiredBottom = Math.max(tagsBottom, ordersBottom, lineBottom) + CARD_BOTTOM_PAD;
    view.hoverInfoBottomY = Math.max(view.baseCardHeight ?? HUB_STRUCTURE_HEIGHT, requiredBottom);
    view.cardHeightTarget = Math.max(
      view.baseCardHeight ?? HUB_STRUCTURE_HEIGHT,
      Math.ceil(requiredBottom)
    );

    if (view.cancelButton) {
      view.cancelButton.visible = buildActive && buildProcess?.allowCancel !== false;
    }

    return true;
  }

  // --------------------------------------------------------
  // Tile view
  // --------------------------------------------------------

  function buildTileView(tileInst, col) {
    const { title, color } = getTileUi(tileInst, getGameState?.());

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    const hoverTextNodes = [];
    const hoverTextBaseNodes = [];
    const {
      content,
      contentPaint,
      contentInk,
      setActive: setHoverActive,
      setScale: setHoverScale,
      setShadowAlpha: setHoverShadowAlpha,
    } = attachHoverFx(
      cont,
      TILE_WIDTH,
      TILE_HEIGHT,
      8,
      () => hoverTextNodes
    );

    const baseBg = new PIXI.Graphics();
    drawCardOuterBg(baseBg, TILE_WIDTH, TILE_HEIGHT, 8, 0x3a3a3a);
    contentPaint.addChild(baseBg);

    const cardFill = new PIXI.Graphics();
    drawCardInnerFill(cardFill, TILE_WIDTH, TILE_HEIGHT, 8, color);
    contentPaint.addChild(cardFill);

    const forageActivityOverlay = createTileActivityOverlay(
      TILE_WIDTH,
      TILE_HEIGHT,
      ACTIVITY_FORAGE_COLOR
    );
    const fishActivityOverlay = createTileActivityOverlay(
      TILE_WIDTH,
      TILE_HEIGHT,
      ACTIVITY_FISH_COLOR
    );
    contentPaint.addChild(forageActivityOverlay);
    contentPaint.addChild(fishActivityOverlay);

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 12,
      wordWrap: true,
      wordWrapWidth: TILE_WIDTH - 12,
    });
    titleText.x = 6;
    titleText.y = 6;
    contentInk.addChild(titleText);

    const tileOrdersCol = Number.isFinite(tileInst?.col) ? Math.floor(tileInst.col) : col;
    const ordersButton = createOrdersLauncher(TILE_WIDTH, () => {
      tagOrdersPanel.toggleForTarget({
        kind: "env",
        col: tileOrdersCol,
        anchorRect: getOrdersAnchorRect(ordersButton),
      });
    });
    ordersButton.visible = false;
    ordersButton.y = Math.max(
      titleText.y + titleText.height + 4,
      TILE_HEIGHT - ORDERS_BUTTON_BOTTOM_PAD - ORDERS_BUTTON_HEIGHT
    );
    contentInk.addChild(ordersButton);

    const tagContainer = new PIXI.Container();
    const tagStartY = titleText.y + titleText.height + 4;
    const tagMaxY = TILE_HEIGHT - 12;
    tagContainer.x = Math.max(
      0,
      Math.round((TILE_WIDTH - TAG_LAYOUT.PILL_WIDTH) / 2)
    );
    tagContainer.y = tagStartY;
    contentInk.addChild(tagContainer);

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
    contentInk.addChild(pawnBadge);

    const feedbackLayer = new PIXI.Container();
    feedbackLayer.eventMode = "none";
    feedbackLayer.zIndex = 1;
    contentInk.addChild(feedbackLayer);

    const apOverlay = createApOverlay(TILE_WIDTH, TILE_HEIGHT, 8);
    contentInk.addChild(apOverlay);

    const pawnLandingOverlay = createPawnLandingOverlay(
      TILE_WIDTH,
      TILE_HEIGHT,
      8
    );
    contentInk.addChild(pawnLandingOverlay);

    const focusOutline = new PIXI.Graphics();
    drawFocusOutline(focusOutline, TILE_WIDTH, TILE_HEIGHT, 6);
    focusOutline.visible = false;
    contentInk.addChild(focusOutline);

    hoverTextBaseNodes.push(titleText, pawnText);
    hoverTextNodes.push(...hoverTextBaseNodes);

    let tileLongPress = null;

    cont.on("pointerenter", () => {
        if (!canShowGamepieceHoverUiNow()) return;
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

    cont.on("pointertap", () => {
      if (tileLongPress?.consumeTap?.()) return;
      const focusCol = Number.isFinite(view.tile?.col)
        ? Math.floor(view.tile.col)
        : Number.isFinite(col)
        ? Math.floor(col)
        : null;
      if (focusCol == null) return;
      onGamepieceTapForSystemFocus?.({
        kind: "tile",
        col: focusCol,
        target: view.tile ?? null,
      });
    });

    const pos = layoutBoardColPosForVisibleCols(
      app.screen.width,
      col,
      TILE_WIDTH,
      TILE_ROW_Y
    );
    cont.x = pos.x;
    cont.y = pos.y;

    tileLayer.addChild(cont);

      const view = {
        container: cont,
        tile: tileInst,
        col,
        baseY: pos.y,
      setHoverActive,
      tagContainer,
      tagStartY,
      tagMaxY,
      tagStartYBase: tagStartY,
      ordersButton,
      tagSignature: "",
      tagEntries: [],
      expandedTagId: null,
      hasTagToggle: false,
      totalContentHeight: 0,
      expandedContentBottomY: 0,
      pawnCount: 0,
      ignoreNextTagTap: false,
      tagDrag: null,
        hoverTextNodes,
        hoverTextBaseNodes,
        titleText,
        isHovered: false,
        hoverAnchor: null,
        hoverUiAnchor: null,
        holdHover: false,
        hoverHoldMove: null,
        holdHoverForOccupant: false,
        occupantHoverHoldSec: 0,
        childTooltipHoverActive: false,
      contentPaint,
      contentInk,
      content,
      setHoverScale,
      setHoverShadowAlpha,
      baseBg,
      cardFill,
      cardFillColor: color,
      cardWidth: TILE_WIDTH,
      baseCardHeight: TILE_HEIGHT,
      cardHeight: TILE_HEIGHT,
      cardHeightCurrent: TILE_HEIGHT,
      cardHeightTarget: TILE_HEIGHT,
      hoverScaleApplied: 1,
      hoverScaleTarget: 1,
      hoverShadowAlphaApplied: 0,
      hoverShadowAlphaTarget: 0,
      hoverCleanupPending: false,
      hoverInfoBottomY: TILE_HEIGHT,
      pawnBadge,
      pawnText,
      feedbackLayer,
      forageActivityOverlay,
      fishActivityOverlay,
      forageActivityTarget: 0,
      fishActivityTarget: 0,
      forageActivityAlpha: 0,
      fishActivityAlpha: 0,
      activityClockSec: (Number.isFinite(col) ? col : 0) * 0.17,
      apOverlay,
      apOverlayAlpha: 0,
      apOverlayTarget: 0,
      pawnLandingOverlay,
      focusOutline,
      isFocused: false,
    };

    tagUi?.rebuildTileTags?.(view, tileInst);
    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    registerPaintContainer(contentPaint);
    tileLongPress = bindTouchLongPress({
      app,
      target: cont,
      shouldStart: () => {
        if (!canShowGamepieceHoverUiNow()) return false;
        if (activeTagDrag && activeTagDrag !== view) return false;
        return true;
      },
      onLongPress: () => {
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
      },
      onEnd: () => {
        if (activeHover?.view === view) {
          clearActiveHover(view);
        } else {
          clearTileHover(view);
        }
      },
    });
    return view;
  }

  function updateTileView(view, tileInst, pawnCount, frameCtx = null) {
    view.tile = tileInst;
    view.pawnCount = pawnCount;
    const ui = getTileUi(tileInst, getGameState?.());
    if (view.cardFill && view.cardFillColor !== ui.color) {
      view.cardFillColor = ui.color;
      redrawTileCardVisuals(view);
    }
    if (view.titleText && view.titleText.text !== ui.title) {
      view.titleText.text = ui.title;
    }
    const signature = getVisibleTileTagSignature(tileInst);
    if (signature !== view.tagSignature) {
      tagUi?.rebuildTileTags?.(view, tileInst, frameCtx);
    }
    tagUi?.updateTagEntries?.(view, tileInst, frameCtx);

    if (pawnCount > 0) {
      view.pawnBadge.visible = true;
      view.pawnText.text = pawnCount > 9 ? "9+" : String(pawnCount);
    } else {
      view.pawnBadge.visible = false;
    }

  }

  function redrawEventCard(view) {
    if (!view) return;
    const width = Math.max(1, Math.floor(view.cardWidth ?? view.width ?? EVENT_WIDTH));
    const height = Math.max(
      1,
      Math.floor(view.cardHeightCurrent ?? view.baseCardHeight ?? EVENT_HEIGHT)
    );
    drawCardOuterBg(view.baseBg, width, height, 8, 0x2f2f2f);
    drawCardInnerFill(view.cardFill, width, height, 8, view.cardFillColor ?? 0x707070);
    view.timerBorderBase?.clear?.();
    view.timerBorderBase
      ?.lineStyle?.(1, 0x111827, 0.85)
      ?.drawRoundedRect?.(1, 1, Math.max(0, width - 2), Math.max(0, height - 2), 8);
    view.timerDrainBorder?.clear?.();
    view.timerDrainBorder
      ?.lineStyle?.(3, view.timerDrainBorderColor ?? 0xffffff, 0.95)
      ?.drawRoundedRect?.(1.5, 1.5, Math.max(0, width - 3), Math.max(0, height - 3), 7);
    if (view.remainingText) {
      const descBottom =
        Number.isFinite(view.descText?.y) && Number.isFinite(view.descText?.height)
          ? view.descText.y + view.descText.height
          : 8;
      view.remainingText.y = Math.max(descBottom + 2, height - 16);
    }
  }

  function refreshEventHoverPresentation(
    view,
    col,
    span,
    dt = 0,
    { updateHoverContext = true } = {}
  ) {
    if (!view) return null;
    const baseHeight = Math.max(1, view.baseCardHeight ?? EVENT_HEIGHT);
    const hasPendingHeight = hasPendingCardHeightAnimation(view);
    const hasPendingScale = hasPendingHoverScaleAnimation(view);
    const hasPendingShadow = hasPendingHoverShadowAnimation(view);
    if (
      !view.isHovered &&
      !view.hoverCleanupPending &&
      !hasPendingHeight &&
      !hasPendingScale &&
      !hasPendingShadow
    ) {
      return null;
    }
    const descBottom =
      Number.isFinite(view.descText?.y) && Number.isFinite(view.descText?.height)
        ? view.descText.y + view.descText.height
        : 8;
    const remainingHeight = Number.isFinite(view.remainingText?.height)
      ? view.remainingText.height
      : 0;
    const remainingFlowBottom = descBottom + 2 + remainingHeight;
    const remainingBottom = Math.max(descBottom, remainingFlowBottom);
    const requiredBottom = Math.max(baseHeight, descBottom, remainingBottom) + CARD_BOTTOM_PAD;
    view.hoverInfoBottomY = requiredBottom;
    view.cardHeightTarget = view.isHovered ? requiredBottom : baseHeight;
    const changed = animateCardHeight(view, dt);
    if (changed) {
      redrawEventCard(view);
      updateEventRemaining(view, getGameState?.());
    }
    const wantsHoverZoom = view.isHovered && shouldAllowHoverZoomIn(view);
    setHoverScaleTarget(
      view,
      wantsHoverZoom ? resolveAdaptiveHoverScale(view.cardHeightCurrent) : 1
    );
    setHoverShadowAlphaTarget(view, wantsHoverZoom ? 1 : 0);
    animateHoverScale(view, dt);
    animateHoverShadowAlpha(view, dt);
    if (!view.isHovered) {
      finalizeHoverExit(view, () => {
        view.hoverUiAnchor = null;
      });
      return null;
    }
    const hoverScale = Number.isFinite(view.hoverScaleApplied) ? view.hoverScaleApplied : 1;
    fitHoverViewY(view, view.cardHeightCurrent, view.hoverInfoBottomY, hoverScale);
    const anchor = getScaledAnchorRect(
      view.container,
      view.cardWidth ?? view.width ?? EVENT_WIDTH,
      view.cardHeightCurrent,
      hoverScale,
      resolveViewBaseY(view)
    );
    const uiAnchor = getScaledAnchorRect(
      view.container,
      view.cardWidth ?? view.width ?? EVENT_WIDTH,
      baseHeight,
      hoverScale,
      resolveViewBaseY(view)
    );
    view.hoverUiAnchor = uiAnchor;
    if (updateHoverContext) {
      setHoverContext("event", col, span, uiAnchor);
    }
    return getProjectedHoverUiAnchor(
      view,
      view.cardWidth ?? view.width ?? EVENT_WIDTH,
      baseHeight,
      view.hoverInfoBottomY
    );
  }

  function applyEventHover(view, col, span) {
    if (!view?.container) return;
    const { title, desc } = getEventUi(view.event);
    view.setHoverActive?.(true);
    elevateForHover(view.container);
    view.isHovered = true;
    view.hoverCleanupPending = false;
    const anchor = refreshEventHoverPresentation(view, col, span, 0, {
      updateHoverContext: true,
    });
    tooltipView?.show?.(
      {
        title,
        lines: desc ? [desc] : [],
        scale: view.hoverScaleApplied ?? GAMEPIECE_HOVER_SCALE,
      },
      anchor
    );
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
    const {
      content,
      contentPaint,
      contentInk,
      setActive: setHoverActive,
      setScale: setHoverScale,
      setShadowAlpha: setHoverShadowAlpha,
    } = attachHoverFx(
      cont,
      width,
      EVENT_HEIGHT,
      8,
      () => hoverTextNodes
    );

    const baseBg = new PIXI.Graphics();
    drawCardOuterBg(baseBg, width, EVENT_HEIGHT, 8, 0x2f2f2f);
    contentPaint.addChild(baseBg);

    const cardFill = new PIXI.Graphics();
    drawCardInnerFill(cardFill, width, EVENT_HEIGHT, 8, color);
    contentPaint.addChild(cardFill);

    const timerBorderBase = new PIXI.Graphics();
    timerBorderBase
      .lineStyle(1, 0x111827, 0.85)
      .drawRoundedRect(1, 1, width - 2, EVENT_HEIGHT - 2, 8);
    contentInk.addChild(timerBorderBase);

    const drainBorderColor = mixHexColor(color, 0xffffff, 0.42);
    const timerDrainBorder = new PIXI.Graphics();
    timerDrainBorder
      .lineStyle(3, drainBorderColor, 0.95)
      .drawRoundedRect(1.5, 1.5, width - 3, EVENT_HEIGHT - 3, 7);
    contentInk.addChild(timerDrainBorder);

    const timerDrainMask = new PIXI.Graphics();
    timerDrainMask.eventMode = "none";
    contentInk.addChild(timerDrainMask);
    timerDrainBorder.mask = timerDrainMask;

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 11,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    titleText.x = 6;
    titleText.y = 4;
    contentInk.addChild(titleText);

    const descText = new PIXI.Text(desc, {
      fill: 0x101010,
      fontSize: 9,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    descText.x = 6;
    descText.y = titleText.y + titleText.height + 1;
    contentInk.addChild(descText);

    const remainingText = new PIXI.Text("", {
      fill: 0x101010,
      fontSize: 10,
    });
    remainingText.x = 6;
    remainingText.y = EVENT_HEIGHT - 16;
    contentInk.addChild(remainingText);

    hoverTextNodes.push(titleText, descText, remainingText);

    const view = {
      container: cont,
      content,
      event: eventInst,
      isHovered: false,
      width,
      cardWidth: width,
      baseCardHeight: EVENT_HEIGHT,
      cardHeightCurrent: EVENT_HEIGHT,
      cardHeightTarget: EVENT_HEIGHT,
      hoverScaleApplied: 1,
      hoverScaleTarget: 1,
      hoverShadowAlphaApplied: 0,
      hoverShadowAlphaTarget: 0,
      hoverCleanupPending: false,
      hoverInfoBottomY: EVENT_HEIGHT,
      baseBg,
      cardFill,
      cardFillColor: color,
      titleText,
      descText,
      timerBorderBase,
      timerDrainBorderColor: drainBorderColor,
      remainingText,
      timerDrainBorder,
      timerDrainMask,
      hoverTextNodes,
      setHoverActive,
      setHoverScale,
      setHoverShadowAlpha,
      contentPaint,
      baseY: EVENT_ROW_Y,
      hoverUiAnchor: null,
    };

    cont.on("pointerenter", () => {
      if (!canShowGamepieceHoverUiNow()) return;
      if (activeTagDrag) return;
      setActiveHover({
        view,
        kind: "event",
        col,
        clear: () => clearEventHover(view),
      });
      applyEventHover(view, col, span);
    });

    cont.on("pointerleave", () => {
      if (activeHover?.view && activeHover.view !== view) return;
      clearActiveHover(view);
    });

    const startX =
      span > 1
        ? getBoardColumnXForVisibleCols(app.screen.width, col)
        : layoutBoardColPosForVisibleCols(
            app.screen.width,
            col,
            EVENT_WIDTH,
            EVENT_ROW_Y
          ).x;
    cont.x = startX;
    cont.y = EVENT_ROW_Y;

    eventLayer.addChild(cont);

    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    registerPaintContainer(contentPaint);
    bindTouchLongPress({
      app,
      target: cont,
      shouldStart: () => canShowGamepieceHoverUiNow() && !activeTagDrag,
      onLongPress: () => {
        setActiveHover({
          view,
          kind: "event",
          col,
          clear: () => clearEventHover(view),
        });
        applyEventHover(view, col, span);
      },
      onEnd: () => {
        if (activeHover?.view === view) {
          clearActiveHover(view);
        } else {
          clearEventHover(view);
        }
      },
    });
    return view;
  }

  function updateEventRemaining(view, state) {
    const expires = Number.isFinite(view.event?.expiresSec)
      ? Math.floor(view.event.expiresSec)
      : null;
    const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
    const createdSec = Number.isFinite(view.event?.createdSec)
      ? Math.floor(view.event.createdSec)
      : null;
    const signature = `${expires ?? "none"}|${createdSec ?? "none"}|${nowSec}`;
    if (view.remainingSignature === signature) {
      return;
    }
    view.remainingSignature = signature;

    if (expires == null) {
      view.remainingText.text = "";
      view.timerDrainBorder.visible = false;
      view.timerDrainMask.clear();
      return;
    }
    const totalLifetimeSec =
      createdSec != null ? Math.max(0, expires - createdSec) : 0;
    const remaining = Math.max(0, expires - nowSec);
    view.remainingText.text = `T-${remaining}s`;

    if (totalLifetimeSec <= 0) {
      view.timerDrainBorder.visible = false;
      view.timerDrainMask.clear();
      return;
    }

    const ratio = clamp01(remaining / totalLifetimeSec);
    const cardHeight = Math.max(
      1,
      Math.floor(view.cardHeightCurrent ?? view.baseCardHeight ?? EVENT_HEIGHT)
    );
    const drainY = Math.floor((1 - ratio) * cardHeight);
    const maskHeight = Math.max(0, cardHeight - drainY);
    view.timerDrainBorder.visible = maskHeight > 0;
    view.timerDrainBorder.alpha = 0.7 + (1 - ratio) * 0.3;
    view.timerDrainMask.clear();
    if (maskHeight > 0) {
      view.timerDrainMask
        .beginFill(0xffffff, 1)
        .drawRect(0, drainY, view.cardWidth ?? view.width ?? EVENT_WIDTH, maskHeight)
        .endFill();
    }
  }

  // --------------------------------------------------------
  // Env Structure view
  // --------------------------------------------------------

  function buildEnvStructureView(structureInst, col) {
    const { def, title, desc, color } = getEnvStructureUi(structureInst, getGameState?.());
    const span =
      Number.isFinite(structureInst.span) && structureInst.span > 0
        ? Math.floor(structureInst.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const width = ENV_STRUCTURE_WIDTH * span + BOARD_COL_GAP * (span - 1);
    const height = ENV_STRUCTURE_HEIGHT;

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    cont.zIndex = 4;
    const hoverTextNodes = [];
    const {
      content,
      contentPaint,
      contentInk,
      setActive: setHoverActive,
      setScale: setHoverScale,
      setShadowAlpha: setHoverShadowAlpha,
    } = attachHoverFx(
      cont,
      width,
      height,
      8,
      () => hoverTextNodes
    );

    const baseBg = new PIXI.Graphics()
      .beginFill(0x2f2f2f)
      .drawRoundedRect(0, 0, width, height, 8)
      .endFill();
    contentPaint.addChild(baseBg);

    const cardFill = new PIXI.Graphics()
      .beginFill(color)
      .drawRoundedRect(3, 3, width - 6, height - 6, 6)
      .endFill();
    contentPaint.addChild(cardFill);

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 11,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    titleText.x = 6;
    titleText.y = 5;
    contentInk.addChild(titleText);

    const descText = new PIXI.Text(desc, {
      fill: 0x101010,
      fontSize: 9,
      wordWrap: true,
      wordWrapWidth: width - 12,
      maxLines: 2,
    });
    descText.x = 6;
    descText.y = titleText.y + titleText.height + 2;
    descText.visible = false;
    contentInk.addChild(descText);
    hoverTextNodes.push(titleText, descText);

    const focusOutline = new PIXI.Graphics();
    drawFocusOutline(focusOutline, width, height, 8);
    focusOutline.visible = false;
    contentInk.addChild(focusOutline);

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
      titleText,
      descText,
      baseBg,
      cardFill,
      cardFillColor: color,
      cardWidth: width,
      baseCardHeight: height,
      cardHeightCurrent: height,
      cardHeightTarget: height,
      hoverScaleApplied: 1,
      hoverScaleTarget: 1,
      hoverShadowAlphaApplied: 0,
      hoverShadowAlphaTarget: 0,
      hoverCleanupPending: false,
      hoverInfoBottomY: height,
      hoverAnchor: null,
      hoverUiAnchor: null,
      holdHoverForOccupant: false,
      occupantHoverHoldSec: 0,
      childTooltipHoverActive: false,
      pawnCount: 0,
      hoverTextNodes,
      focusOutline,
      inventoryDragAffordance: null,
      structureHasInventory,
      setHoverActive,
      setHoverScale,
      setHoverShadowAlpha,
      contentPaint,
    };
    view.inventoryDragAffordance = structureHasInventory()
      ? inventoryDragAffordanceByOwnerId.get(
          normalizeInventoryDragOwnerId(structureInst.instanceId)
        ) ?? null
      : null;
    focusOutline.visible = view.inventoryDragAffordance != null;
    redrawEnvStructureCard(view);

    cont.on("pointerenter", () => {
      if (!canShowGamepieceHoverUiNow()) return;
      if (activeTagDrag) return;
      setActiveHover({
        view,
        kind: "envStructure",
        col,
        clear: () => clearEnvStructureHover(view),
      });
      applyEnvStructureHover(view);
    });

    cont.on("pointerleave", () => {
      if (activeHover?.view && activeHover.view !== view) return;
      if (holdHoverForOccupantIfNeeded(view)) return;
      clearActiveHover(view);
    });

    const startX =
      span > 1
        ? getBoardColumnXForVisibleCols(app.screen.width, col)
        : layoutBoardColPosForVisibleCols(
            app.screen.width,
            col,
            ENV_STRUCTURE_WIDTH,
            ENV_STRUCTURE_ROW_Y
          ).x;
    cont.x = startX;
    cont.y = ENV_STRUCTURE_ROW_Y;
    view.baseY = cont.y;

    envStructuresLayer.addChild(cont);
    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    registerPaintContainer(contentPaint);
    bindTouchLongPress({
      app,
      target: cont,
      shouldStart: () => canShowGamepieceHoverUiNow() && !activeTagDrag,
      onLongPress: () => {
        setActiveHover({
          view,
          kind: "envStructure",
          col,
          clear: () => clearEnvStructureHover(view),
        });
        applyEnvStructureHover(view);
      },
      onEnd: () => {
        if (activeHover?.view === view) {
          clearActiveHover(view);
        } else {
          clearEnvStructureHover(view);
        }
      },
    });
    return view;
  }

  function updateEnvStructureView(view, structureInst) {
    if (!view || !structureInst) return;
    view.structure = structureInst;
    const { color, title, desc } = getEnvStructureUi(structureInst, getGameState?.());
    const def = envStructureDefs[structureInst.defId];
    const span =
      Number.isFinite(structureInst?.span) && structureInst.span > 0
        ? Math.floor(structureInst.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const width = ENV_STRUCTURE_WIDTH * span + BOARD_COL_GAP * (span - 1);
    view.cardWidth = width;
    if (view.cardFill && view.cardFillColor !== color) {
      view.cardFillColor = color;
      redrawEnvStructureCard(view);
    }
    if (view.titleText && view.titleText.text !== title) {
      view.titleText.text = title;
    }
    if (view.descText && view.descText.text !== desc) {
      view.descText.text = desc;
    }
  }

  // --------------------------------------------------------
  // Permanent view
  // --------------------------------------------------------

  function buildHubStructureView(structureInst, col, opts = {}) {
    const { title, lines, color, meters } =
      getHubStructureUi(structureInst, getGameState?.());
    const visibleLines = [];
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
    const {
      content,
      contentPaint,
      contentInk,
      setActive: setHoverActive,
      setScale: setHoverScale,
      setShadowAlpha: setHoverShadowAlpha,
    } = attachHoverFx(
      cont,
      width,
      height,
      10,
      () => hoverTextNodes
    );

    const baseBg = new PIXI.Graphics();
    drawCardOuterBg(baseBg, width, height, 10, 0x3a3a3a);
    contentPaint.addChild(baseBg);

    const cardFill = new PIXI.Graphics();
    drawCardInnerFill(cardFill, width, height, 10, color);
    contentPaint.addChild(cardFill);

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 12,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    titleText.x = 6;
    titleText.y = 6;
    contentInk.addChild(titleText);
    hoverTextBaseNodes.push(titleText);
    hoverTextNodes.push(titleText);

    let y = titleText.y + titleText.height + 2;
    const lineTextNodes = [];
    for (const line of visibleLines) {
      const t = new PIXI.Text(line, {
        fill: 0x000000,
        fontSize: 10,
        wordWrap: true,
        wordWrapWidth: width - 12,
      });
      t.x = 6;
      t.y = y;
      contentInk.addChild(t);
      lineTextNodes.push(t);
      hoverTextBaseNodes.push(t);
      hoverTextNodes.push(t);
      y += t.height + 1;
      if (y > height - 40) break;
    }

    let meterViews = [];
    if (meters.length > 0) {
      const meterResult = createMeters(
        contentInk,
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

    const hubOrdersCol = Number.isFinite(structureInst?.col)
      ? Math.floor(structureInst.col)
      : col;
    const ordersButton = createOrdersLauncher(width, () => {
      tagOrdersPanel.toggleForTarget({
        kind: "hub",
        col: hubOrdersCol,
        anchorRect: getOrdersAnchorRect(ordersButton),
      });
    });
    ordersButton.visible = false;
    ordersButton.y = Math.max(
      y + 4,
      height - ORDERS_BUTTON_BOTTOM_PAD - ORDERS_BUTTON_HEIGHT
    );
    contentInk.addChild(ordersButton);

    const tagContainer = new PIXI.Container();
    const tagStartY = Math.min(y + 4, height - 12);
    const tagMaxY = Math.max(tagStartY, ordersButton.y - ORDERS_BUTTON_TAG_GAP);
    tagContainer.x = Math.max(
      0,
      Math.round((width - HUB_TAG_LAYOUT.PILL_WIDTH) / 2)
    );
    tagContainer.y = tagStartY;
    contentInk.addChild(tagContainer);

    const apOverlay = createApOverlay(width, height, 10);
    contentInk.addChild(apOverlay);

    const pawnLandingOverlay = createPawnLandingOverlay(width, height, 10);
    contentInk.addChild(pawnLandingOverlay);

    const distributorRangeOverlay = createDistributorRangeOverlay(
      width,
      height,
      10
    );
    contentInk.addChild(distributorRangeOverlay);

    const buildPlacementOverlay = createBuildPlacementOverlay(width, height, 10);
    contentInk.addChild(buildPlacementOverlay);

    const focusOutline = new PIXI.Graphics();
    drawFocusOutline(focusOutline, width, height, 8);
    focusOutline.visible = false;
    contentInk.addChild(focusOutline);

    const cancelButton = new PIXI.Container();
    cancelButton.eventMode = "static";
    cancelButton.cursor = "pointer";
    cancelButton.x = Math.max(6, width - 58);
    cancelButton.y = 6;
    {
      const initialBuildProcess = getBuildProcess(structureInst);
      cancelButton.visible =
        !!initialBuildProcess && initialBuildProcess.allowCancel !== false;
    }

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

    contentInk.addChild(cancelButton);

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
      contentInk,
      contentPaint,
      hoverTextBaseNodes,
      tagContainer,
      tagStartY,
      tagMaxY,
      ordersButton,
      tagSignature: "",
      tagEntries: [],
      expandedTagId: null,
      hasTagToggle: false,
      totalContentHeight: 0,
      expandedContentBottomY: 0,
      ignoreNextTagTap: false,
      tagDrag: null,
      childTooltipHoverActive: false,
      holdHoverForOccupant: false,
      occupantHoverHoldSec: 0,
      hoverAnchor: null,
      hoverUiAnchor: null,
      hoverTextNodes,
      structureHasInventory,
      setHoverActive,
      setHoverScale,
      setHoverShadowAlpha,
      baseBg,
      cardFill,
      cardFillColor: color,
      cardWidth: width,
      baseCardHeight: height,
      cardHeight: height,
      cardHeightCurrent: height,
      cardHeightTarget: height,
      hoverScaleApplied: 1,
      hoverScaleTarget: 1,
      hoverShadowAlphaApplied: 0,
      hoverShadowAlphaTarget: 0,
      hoverCleanupPending: false,
      hoverInfoBottomY: height,
      uiSignature: null,
      apOverlay,
      apOverlayAlpha: 0,
      apOverlayTarget: 0,
      pawnLandingOverlay,
      distributorRangeOverlay,
      buildPlacementOverlay,
      buildPlacementOverlayState: null,
      focusOutline,
      isFocused: false,
      inventoryDragAffordance: null,
      cancelButton,
    };
    view.inventoryDragAffordance = structureHasInventory()
      ? inventoryDragAffordanceByOwnerId.get(
          normalizeInventoryDragOwnerId(structureInst.instanceId)
        ) ?? null
      : null;
    focusOutline.visible = view.isFocused || view.inventoryDragAffordance != null;
    updateHubStructureViewUi(view, structureInst, { force: true });

    if (opts?.expandedTagId) {
      view.expandedTagId = opts.expandedTagId;
    }

    hubTagUi?.rebuildStructureTags?.(view, structureInst);

    const hubLongPress = bindTouchLongPress({
      app,
      target: cont,
      shouldStart: () => canShowGamepieceHoverUiNow() && !activeTagDrag,
      onLongPress: () => {
        setActiveHover({
          view,
          kind: "hub",
          col,
          clear: () => clearHubStructureHover(view),
        });
        if (view.isHovered) return;
        applyHubStructureHover(view);
      },
      onEnd: () => {
        if (activeHover?.view === view) {
          clearActiveHover(view);
        } else {
          clearHubStructureHover(view);
        }
      },
    });

    cont.on("pointerenter", () => {
      if (!canShowGamepieceHoverUiNow()) return;
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
      if (hubLongPress.consumeTap()) return;
      const focusCol = Number.isFinite(structureInst?.col)
        ? Math.floor(structureInst.col)
        : Number.isFinite(col)
        ? Math.floor(col)
        : null;
      if (focusCol != null) {
        onGamepieceTapForSystemFocus?.({
          kind: "hub",
          col: focusCol,
          target: structureInst ?? null,
        });
      }
      if (inventoryView && structureHasInventory()) {
        inventoryView.togglePinned(structureInst.instanceId);
      }
    });

    const pos =
      span > 1
        ? { x: getHubColumnXForVisibleCols(app.screen.width, col), y: HUB_STRUCTURE_ROW_Y }
        : layoutHubColPosForVisibleCols(
            app.screen.width,
            col,
            HUB_STRUCTURE_WIDTH,
            HUB_STRUCTURE_ROW_Y
          );
    cont.x = pos.x;
    cont.y = pos.y;
    view.baseY = cont.y;

    hubStructuresLayer.addChild(cont);

    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    registerPaintContainer(contentPaint);
    return view;
  }

  // --------------------------------------------------------
  // sync helpers
  // --------------------------------------------------------

  function getPawnCounts(state, envCols, hubCols) {
    const envLen = Number.isFinite(envCols) ? Math.max(0, envCols) : BOARD_COLS;
    const hubLen = Number.isFinite(hubCols) ? Math.max(0, hubCols) : HUB_COLS;
    const envCounts = new Array(envLen).fill(0);
    const hubCounts = new Array(hubLen).fill(0);
    const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
    for (const pawn of pawns) {
      const envCol = Number.isFinite(pawn?.envCol)
        ? Math.floor(pawn.envCol)
        : null;
      if (envCol != null && envCol >= 0 && envCol < envCounts.length) {
        envCounts[envCol] += 1;
      }

      const hubCol = Number.isFinite(pawn?.hubCol)
        ? Math.floor(pawn.hubCol)
        : null;
      if (hubCol != null && hubCol >= 0 && hubCol < hubCounts.length) {
        hubCounts[hubCol] += 1;
      }
    }
    return { env: envCounts, hub: hubCounts };
  }

  function syncTiles(state, cols, pawnCountsByCol = null, frameCtx = null) {
    const tileOcc = state?.board?.occ?.tile;
    const pawnCounts = Array.isArray(pawnCountsByCol)
      ? pawnCountsByCol
      : getPawnCounts(state, cols, 0).env;
    const screenWidth = getScreenWidthInt();

    for (let col = 0; col < cols; col++) {
      const tileInst = tileOcc?.[col] || null;
      const view = tileViews[col];

      if (!tileInst) {
        if (view) {
          if (activeHover?.view === view) clearActiveHover(view);
          clearTileRollFxForCol(col);
          unregisterPaintForHoverView(view);
          removeFromParent(view.container);
          tileViews[col] = undefined;
        }
        continue;
      }

      if (!view || view.tile?.defId !== tileInst.defId) {
        if (view) {
          if (activeHover?.view === view) clearActiveHover(view);
          clearTileRollFxForCol(col);
          unregisterPaintForHoverView(view);
          removeFromParent(view.container);
        }
        tileViews[col] = buildTileView(tileInst, col);
      }

      const activeView = tileViews[col];
      if (activeView) {
        const pos = layoutBoardColPosForVisibleCols(
          screenWidth,
          col,
          TILE_WIDTH,
          TILE_ROW_Y,
          cols
        );
        activeView.container.x = pos.x;
        activeView.container.y = pos.y;
        activeView.baseY = pos.y;
        updateTileView(activeView, tileInst, pawnCounts[col] || 0, frameCtx);
      }
    }

    for (let col = cols; col < tileViews.length; col += 1) {
      const view = tileViews[col];
      if (!view) continue;
      if (activeHover?.view === view) clearActiveHover(view);
      clearTileRollFxForCol(col);
      unregisterPaintForHoverView(view);
      removeFromParent(view.container);
      tileViews[col] = undefined;
    }
    tileViews.length = cols;
  }

  function syncEvents(state, cols) {
    const occ = state?.board?.occ?.event;
    const seen = new Set();
    const screenWidth = getScreenWidthInt();

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
      const revealRemainingSec = getEventRevealRemainingSec(eventInst);
      if (revealRemainingSec > 0) {
        const hiddenView = eventViews.get(id);
        if (hiddenView) {
          if (activeHover?.view === hiddenView) clearActiveHover(hiddenView);
          unregisterPaintForHoverView(hiddenView);
          removeFromParent(hiddenView.container);
          eventViews.delete(id);
        }
        continue;
      }

        const existing = eventViews.get(id);
        if (!existing || existing.event.instanceId !== eventInst.instanceId) {
          if (existing) {
            unregisterPaintForHoverView(existing);
            removeFromParent(existing.container);
          }
          eventViews.set(id, buildEventView(eventInst, col));
        }

      const view = eventViews.get(id);
      if (view) {
        const span =
          Number.isFinite(eventInst?.span) && eventInst.span > 0
            ? Math.floor(eventInst.span)
            : 1;
        const startX =
          span > 1
            ? getBoardColumnXForVisibleCols(screenWidth, col, cols)
            : layoutBoardColPosForVisibleCols(
                screenWidth,
                col,
                EVENT_WIDTH,
                EVENT_ROW_Y,
                cols
              ).x;
        view.container.x = startX;
        view.container.y = EVENT_ROW_Y;
        view.baseY = EVENT_ROW_Y;
        view.event = eventInst;
        updateEventRemaining(view, state);
      }
    }

      for (const [id, view] of eventViews.entries()) {
        if (seen.has(id)) continue;
        if (activeHover?.view === view) clearActiveHover(view);
        unregisterPaintForHoverView(view);
        removeFromParent(view.container);
        eventViews.delete(id);
      }

  }

  function syncEnvStructures(state, cols, pawnCountsByEnv = null) {
    const occ = state?.board?.occ?.envStructure;
    const seen = new Set();
    const screenWidth = getScreenWidthInt();
    const pawnCounts = Array.isArray(pawnCountsByEnv) ? pawnCountsByEnv : [];

    syncEnvStructureSlots(cols);

    for (let col = 0; col < cols; col++) {
      const structureInst = occ?.[col] || null;
      if (!structureInst) continue;

      const anchorCol = Number.isFinite(structureInst.col)
        ? Math.floor(structureInst.col)
        : col;
      if (anchorCol !== col) continue;

      const id = structureInst.instanceId ?? col;
      seen.add(id);

      const existing = envStructureViews.get(id);
      if (
        !existing ||
        existing.structure.instanceId !== structureInst.instanceId
      ) {
        if (existing) {
          unregisterPaintForHoverView(existing);
          removeFromParent(existing.container);
        }
        envStructureViews.set(id, buildEnvStructureView(structureInst, col));
      }

      const view = envStructureViews.get(id);
      if (view) {
        const def = envStructureDefs[structureInst.defId];
        const span =
          Number.isFinite(structureInst?.span) && structureInst.span > 0
            ? Math.floor(structureInst.span)
            : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
            ? Math.floor(def.defaultSpan)
            : 1;
        const startX =
          span > 1
            ? getBoardColumnXForVisibleCols(screenWidth, col, cols)
            : layoutBoardColPosForVisibleCols(
                screenWidth,
                col,
                ENV_STRUCTURE_WIDTH,
                ENV_STRUCTURE_ROW_Y,
                cols
              ).x;
        view.container.x = startX;
        view.container.y = ENV_STRUCTURE_ROW_Y;
        view.baseY = ENV_STRUCTURE_ROW_Y;
        let pawnCount = 0;
        for (let offset = 0; offset < span; offset += 1) {
          pawnCount += pawnCounts[anchorCol + offset] || 0;
        }
        view.pawnCount = pawnCount;
        updateEnvStructureView(view, structureInst);
      }
    }

    for (const [id, view] of envStructureViews.entries()) {
      if (seen.has(id)) continue;
      if (activeHover?.view === view) clearActiveHover(view);
      unregisterPaintForHoverView(view);
      removeFromParent(view.container);
      envStructureViews.delete(id);
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

    const pos = layoutBoardColPosForVisibleCols(
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
    const screenWidth = getScreenWidthInt();
    const layoutKey = `${screenWidth}|${cols}`;
    if (eventSlotViews.length === cols && eventSlotsLayoutKey === layoutKey) {
      return;
    }
    for (let col = 0; col < cols; col++) {
      let view = eventSlotViews[col];
      if (!view) {
        view = buildEventSlotView(col);
        eventSlotViews[col] = view;
      } else {
        const pos = layoutBoardColPosForVisibleCols(
          screenWidth,
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
    eventSlotsLayoutKey = layoutKey;
  }

  function buildEnvStructureSlotView(col) {
    const cont = new PIXI.Container();
    cont.eventMode = "none";
    cont.zIndex = 0;
    const bg = new PIXI.Graphics()
      .lineStyle(1, 0x2a2f3d, 0.75)
      .beginFill(0x1a1f2a, 0.3)
      .drawRoundedRect(0, 0, ENV_STRUCTURE_WIDTH, ENV_STRUCTURE_HEIGHT, 8)
      .endFill();
    cont.addChild(bg);

    const pos = layoutBoardColPosForVisibleCols(
      app.screen.width,
      col,
      ENV_STRUCTURE_WIDTH,
      ENV_STRUCTURE_ROW_Y
    );
    cont.x = pos.x;
    cont.y = pos.y;

    envStructuresLayer.addChild(cont);
    return cont;
  }

  function syncEnvStructureSlots(cols) {
    const screenWidth = getScreenWidthInt();
    const layoutKey = `${screenWidth}|${cols}`;
    if (envStructureSlotViews.length === cols && envStructureSlotsLayoutKey === layoutKey) {
      return;
    }
    for (let col = 0; col < cols; col++) {
      let view = envStructureSlotViews[col];
      if (!view) {
        view = buildEnvStructureSlotView(col);
        envStructureSlotViews[col] = view;
      } else {
        const pos = layoutBoardColPosForVisibleCols(
          screenWidth,
          col,
          ENV_STRUCTURE_WIDTH,
          ENV_STRUCTURE_ROW_Y
        );
        view.x = pos.x;
        view.y = pos.y;
      }
    }

    for (let i = cols; i < envStructureSlotViews.length; i++) {
      removeFromParent(envStructureSlotViews[i]);
    }
    envStructureSlotViews.length = cols;
    envStructureSlotsLayoutKey = layoutKey;
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

    const pawnLandingOverlay = createPawnLandingOverlay(
      HUB_STRUCTURE_WIDTH,
      HUB_STRUCTURE_HEIGHT,
      10
    );
    cont.addChild(pawnLandingOverlay);

    const distributorRangeOverlay = createDistributorRangeOverlay(
      HUB_STRUCTURE_WIDTH,
      HUB_STRUCTURE_HEIGHT,
      10
    );
    cont.addChild(distributorRangeOverlay);

    const buildPlacementOverlay = createBuildPlacementOverlay(
      HUB_STRUCTURE_WIDTH,
      HUB_STRUCTURE_HEIGHT,
      10
    );
    cont.addChild(buildPlacementOverlay);

    const pos = layoutHubColPosForVisibleCols(
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
      pawnLandingOverlay,
      distributorRangeOverlay,
      buildPlacementOverlay,
      buildPlacementOverlayState: null,
      cardWidth: HUB_STRUCTURE_WIDTH,
      cardHeight: HUB_STRUCTURE_HEIGHT,
    };
  }

  function syncHubSlots(cols) {
    const screenWidth = getScreenWidthInt();
    const layoutKey = `${screenWidth}|${cols}`;
    if (hubSlotViews.length === cols && hubSlotsLayoutKey === layoutKey) {
      return;
    }
    for (let col = 0; col < cols; col++) {
      let view = hubSlotViews[col];
      if (!view) {
        view = buildHubSlotView(col);
        hubSlotViews[col] = view;
      } else {
        const pos = layoutHubColPosForVisibleCols(
          screenWidth,
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
    hubSlotsLayoutKey = layoutKey;
  }

  function syncHubStructures(state, cols, pawnCountsByHub = null, frameCtx = null) {
    const occ = state?.hub?.occ;
    const seen = new Set();
    const screenWidth = getScreenWidthInt();
    const pawnCounts = Array.isArray(pawnCountsByHub)
      ? pawnCountsByHub
      : getPawnCounts(state, 0, cols).hub;

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
          if (existing) {
            unregisterPaintForHoverView(existing);
            removeFromParent(existing.container);
          }
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
      unregisterPaintForHoverView(view);
      removeFromParent(view.container);
      hubStructureViews.delete(id);
      }

    for (const view of hubStructureViews.values()) {
      const col = Number.isFinite(view.col) ? view.col : 0;
      const structure = view.structure;
      const def = structure ? hubStructureDefs[structure.defId] : null;
      const span =
        Number.isFinite(structure?.span) && structure.span > 0
          ? Math.floor(structure.span)
          : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
          ? Math.floor(def.defaultSpan)
          : 1;
      const pos =
        span > 1
          ? {
              x: getHubColumnXForVisibleCols(screenWidth, col, cols),
              y: HUB_STRUCTURE_ROW_Y,
            }
          : layoutHubColPosForVisibleCols(
              screenWidth,
              col,
              HUB_STRUCTURE_WIDTH,
              HUB_STRUCTURE_ROW_Y,
              cols
            );
      view.container.x = pos.x;
      view.container.y = pos.y;
      view.baseY = pos.y;
      view.pawnCount = pawnCounts[col] || 0;
      updateHubStructureViewUi(view, view.structure);
      if (view.meterViews.length > 0) {
        updateMeters(view.meterViews, view.structure);
      }
      const signature = getVisibleHubTagSignature(view.structure);
      if (signature !== view.tagSignature) {
        hubTagUi?.rebuildStructureTags?.(view, view.structure, frameCtx);
      } else {
        hubTagUi?.updateTagEntries?.(view, view.structure, frameCtx);
      }
    }
  }

  function getPawnDragAffordability(state, pawnId, envCols, hubCols) {
    if (
      pawnId == null ||
      typeof actionPlanner?.getPawnMoveAffordability !== "function"
    ) {
      return {
        invalidEnv: new Set(),
        invalidHub: new Set(),
      };
    }

    const tSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
    const actionPoints = Number.isFinite(state?.actionPoints)
      ? Math.floor(state.actionPoints)
      : 0;
    const actionPointCap = Number.isFinite(state?.actionPointCap)
      ? Math.floor(state.actionPointCap)
      : 0;
    const signature = [
      pawnId,
      tSec,
      actionPoints,
      actionPointCap,
      envCols,
      hubCols,
    ].join("|");
    const elapsedMs = nowMs() - (apAffordabilityCache.computedAtMs ?? -1);
    const shouldRefresh =
      apAffordabilityCache.signature !== signature ||
      elapsedMs >= AP_AFFORDABILITY_REFRESH_MS;

    if (!shouldRefresh) {
      return {
        invalidEnv: apAffordabilityCache.invalidEnv,
        invalidHub: apAffordabilityCache.invalidHub,
      };
    }

    const invalidEnv = new Set();
    const invalidHub = new Set();

    for (let col = 0; col < envCols; col++) {
      const aff = actionPlanner.getPawnMoveAffordability({
        pawnId,
        toEnvCol: col,
      });
      if (aff?.ok && aff.affordable === false) invalidEnv.add(col);
    }
    for (let col = 0; col < hubCols; col++) {
      const aff = actionPlanner.getPawnMoveAffordability({
        pawnId,
        toHubCol: col,
      });
      if (aff?.ok && aff.affordable === false) invalidHub.add(col);
    }

    apAffordabilityCache = {
      signature,
      computedAtMs: nowMs(),
      invalidEnv,
      invalidHub,
    };

    return { invalidEnv, invalidHub };
  }

  // --------------------------------------------------------
  // rebuildAll
  // --------------------------------------------------------

  function rebuildAll() {
    tagOrdersPanel?.close?.();
    const pendingHover = activeHover
      ? { kind: activeHover.kind, col: activeHover.col }
      : null;
    const pendingPointer = lastPointerPos
      ? { x: lastPointerPos.x, y: lastPointerPos.y }
      : null;
    if (activeHover) clearActiveHover();
    clearIconDistributorRangePreview();

    hubExpandedTagById.clear();
    for (const view of hubStructureViews.values()) {
      const id = view?.structure?.instanceId;
      if (id == null) continue;
      if (view.expandedTagId) {
        hubExpandedTagById.set(id, view.expandedTagId);
      }
    }

    clearTileFeedbackRuntime();
    clearEventExpiryFxRuntime();
    eventSnapshotsById = new Map();
    lastSeenEventSec = null;
    for (const view of tileViews) unregisterPaintForHoverView(view);
    for (const view of eventViews.values()) unregisterPaintForHoverView(view);
    for (const view of envStructureViews.values()) unregisterPaintForHoverView(view);
    for (const view of hubStructureViews.values()) unregisterPaintForHoverView(view);
    unregisterAreaChromePaint(areaChrome);
    tileLayer.removeChildren();
    eventLayer.removeChildren();
    envStructuresLayer.removeChildren();
    hubStructuresLayer.removeChildren();
    areaChrome = null;
    hoverLayer?.removeChildren?.();
    tileViews.length = 0;
    eventViews.clear();
    eventSlotViews.length = 0;
    eventSlotsLayoutKey = "";
    envStructureViews.clear();
    envStructureSlotViews.length = 0;
    envStructureSlotsLayoutKey = "";
    hubStructureViews.clear();
    hubSlotViews.length = 0;
    hubSlotsLayoutKey = "";
    prevProgressAnimationTimeSec = null;

    const s = getGameState?.();
    lastProcessedGameEventId = getMaxEventFeedId(s?.gameEventFeed);
    if (!s?.board) return;

    const cols = getVisibleBoardCols(s);
    const hubCols = getVisibleHubCols(s);
    ensureEventExpiryFxLayerAttached();
    const pawnCounts = getPawnCounts(s, cols, hubCols);
    syncEvents(s, cols);
    syncEnvStructures(s, cols, pawnCounts.env);
    syncTiles(s, cols, pawnCounts.env);
    syncHubStructures(s, hubCols, pawnCounts.hub);
    syncAreaChrome(s, cols, hubCols);
    updateDistributorRangeOverlays();
    eventSnapshotsById = collectEventSnapshots(s, cols);
    lastSeenEventSec = Number.isFinite(s?.tSec) ? Math.floor(s.tSec) : null;

    restoreHoverAfterRebuild(pendingHover, pendingPointer);
  }

  // --------------------------------------------------------
  // update
  // --------------------------------------------------------

  function updateApDragOverlays(dt) {
    const drag = interaction?.getDragged?.();
    const isPawnDrag = drag?.type === "pawn" && drag?.id != null;
    const pawnId = isPawnDrag ? drag.id : null;
    const state = getGameState?.();
    const envCols = getVisibleBoardCols(state);
    const hubCols = getVisibleHubCols(state);

    if (!isPawnDrag) {
      apAffordabilityCache.signature = "";
      apAffordabilityCache.computedAtMs = -1;
    }

    const affordability = isPawnDrag
      ? getPawnDragAffordability(state, pawnId, envCols, hubCols)
      : { invalidEnv: new Set(), invalidHub: new Set() };
    const invalidEnv = affordability.invalidEnv;
    const invalidHub = affordability.invalidHub;

    const dropTarget =
      isPawnDrag && lastPointerPos
        ? resolvePawnDropTargetFromPos(lastPointerPos, envCols, hubCols)
        : null;

    for (const view of tileViews) {
      if (!view) continue;
      const col = Number.isFinite(view.col) ? Math.floor(view.col) : null;
      const isInvalid = isPawnDrag && col != null && invalidEnv.has(col);
      view.apOverlayTarget = isInvalid ? AP_OVERLAY_ALPHA : 0;
      updateApOverlay(view, dt);
      const isDropTarget =
        isPawnDrag &&
        dropTarget?.row === "env" &&
        col != null &&
        dropTarget.col === col;
      setPawnLandingOverlayVisible(view, isDropTarget);
    }

    const coveredHubCols = new Set();
    const invalidCoveredHubCols = new Set();
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
        if (isPawnDrag && invalidHub.has(c)) {
          invalid = true;
          invalidCoveredHubCols.add(c);
        }
      }
      view.apOverlayTarget = invalid ? AP_OVERLAY_ALPHA : 0;
      updateApOverlay(view, dt);
      const isDropTarget =
        isPawnDrag &&
        dropTarget?.row === "hub" &&
        dropTarget.col >= base &&
        dropTarget.col < base + span;
      setPawnLandingOverlayVisible(view, isDropTarget);
    }

    for (const view of hubSlotViews) {
      if (!view) continue;
      const col = Number.isFinite(view.col) ? Math.floor(view.col) : null;
      const isInvalid =
        isPawnDrag &&
        col != null &&
        !coveredHubCols.has(col) &&
        invalidHub.has(col);
      view.apOverlayTarget = isInvalid ? AP_OVERLAY_ALPHA : 0;
      updateApOverlay(view, dt);
      const isDropTarget =
        isPawnDrag &&
        dropTarget?.row === "hub" &&
        col != null &&
        !coveredHubCols.has(col) &&
        dropTarget.col === col;
      setPawnLandingOverlayVisible(view, isDropTarget);
    }

    let hoverInvalid = false;
    if (isPawnDrag && dropTarget) {
      if (dropTarget.row === "env") {
        hoverInvalid = invalidEnv.has(dropTarget.col);
      } else if (dropTarget.row === "hub") {
        if (invalidCoveredHubCols.has(dropTarget.col)) {
          hoverInvalid = true;
        } else if (!coveredHubCols.has(dropTarget.col)) {
          hoverInvalid = invalidHub.has(dropTarget.col);
        }
      }
    }

    setApDragWarningSafe(hoverInvalid);
  }

  function update(dt) {
    const s = getGameState?.();
    if (!s?.board) {
      prevProgressAnimationTimeSec = null;
      tagOrdersPanel?.close?.();
      return;
    }

    if (
      activeHover?.view &&
      !canShowGamepieceHoverUiNow() &&
      !shouldKeepActiveHoverForHoveredOccupant()
    ) {
      clearActiveHover(activeHover.view);
    }

    const progressFrameCtx = buildProgressAnimationFrameContext(s, dt);
    const cols = getVisibleBoardCols(s);
    const hubCols = getVisibleHubCols(s);
    syncEventExpiryFxFromTimelineState(s, cols);
    const pawnCounts = getPawnCounts(s, cols, hubCols);
    syncEvents(s, cols);
    syncEnvStructures(s, cols, pawnCounts.env);
    syncTiles(s, cols, pawnCounts.env, progressFrameCtx);
    syncHubStructures(s, hubCols, pawnCounts.hub, progressFrameCtx);
    syncAreaChrome(s, cols, hubCols);
    updateDistributorRangeOverlays();
    updateBuildPlacementOverlays();
    updatePlanFocus();
    updateDynamicCardLayouts(dt);
    processTileRollFeedbackEvents(s);
    updateTileRollFeedbackFx(dt);
    tagOrdersPanel?.update?.(s);

    if (activeHover?.view?.holdHoverForOccupant) {
      const view = activeHover.view;
      const kind = activeHover.kind;
      if (Number.isFinite(view.occupantHoverHoldSec) && view.occupantHoverHoldSec > 0) {
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        view.occupantHoverHoldSec = Math.max(0, view.occupantHoverHoldSec - step);
      }
      const hoverMatches = isPawnHoveringForView(view, kind);
      if (!hoverMatches) {
        if ((view.occupantHoverHoldSec ?? 0) <= 0) {
          const pos = lastPointerPos;
          const insideHoldBounds =
            pos &&
            (isPointerInsideAnchor(view.hoverAnchor, pos, TAG_DRAG_RELEASE_PAD) ||
              isPointerInsideView(view, pos, TAG_DRAG_RELEASE_PAD));
          if (!insideHoldBounds) {
            view.holdHoverForOccupant = false;
            view.occupantHoverHoldSec = 0;
            clearActiveHover(view);
          }
        }
      }
    }

    updateEventExpiryFx(dt);
    updateApDragOverlays(dt);
  }

  function init() {
    if (!stagePointerMoveHandler) {
      stagePointerMoveHandler = (ev) => trackPointerPos(ev);
      app.stage.on("pointermove", stagePointerMoveHandler);
    }
    ensureEventExpiryFxLayerAttached();
    const state = getGameState?.();
    if (state?.board) {
      const cols = getVisibleBoardCols(state);
      const hubCols = getVisibleHubCols(state);
      syncAreaChrome(state, cols, hubCols);
    }
    lastProcessedGameEventId = Math.max(
      lastProcessedGameEventId,
      getMaxEventFeedId(state?.gameEventFeed)
    );
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
        return {
          ownerId: view.structure?.instanceId ?? null,
          anchor: {
            coordinateSpace: "screen",
            getAnchorRect: () => view.container?.getBounds?.() ?? null,
          },
        };
      }
    }
    for (const view of envStructureViews.values()) {
      if (!view?.container?.visible) continue;
      if (!view.structureHasInventory?.()) continue;
      const bounds = view.container.getBounds();
      if (
        globalPos.x >= bounds.x &&
        globalPos.x <= bounds.x + bounds.width &&
        globalPos.y >= bounds.y &&
        globalPos.y <= bounds.y + bounds.height
      ) {
        return {
          ownerId: view.structure?.instanceId ?? null,
          anchor: {
            coordinateSpace: "screen",
            getAnchorRect: () => view.container?.getBounds?.() ?? null,
          },
        };
      }
    }
    return null;
  }

  function getOccludingScreenRects() {
    const rects = [];
    const tagOrdersRects = tagOrdersPanel?.getOccludingScreenRects?.() ?? [];
    for (const rect of tagOrdersRects) {
      if (rect) rects.push(rect);
    }
    const cropDropdownRect = tilePanels?.cropDropdown?.getScreenRect?.();
    if (cropDropdownRect) rects.push(cropDropdownRect);
    const recipeDropdownRect = hubPanels?.recipeDropdown?.getScreenRect?.();
    if (recipeDropdownRect) rects.push(recipeDropdownRect);
    return rects;
  }

  function getInventoryOwnerAnchor(ownerId) {
    if (ownerId == null) return null;
    for (const view of hubStructureViews.values()) {
      if (!view?.container?.visible) continue;
      if ((view.structure?.instanceId ?? null) !== ownerId) continue;
      return {
        coordinateSpace: "screen",
        getAnchorRect: () => view.container?.getBounds?.() ?? null,
      };
    }
    for (const view of envStructureViews.values()) {
      if (!view?.container?.visible) continue;
      if ((view.structure?.instanceId ?? null) !== ownerId) continue;
      return {
        coordinateSpace: "screen",
        getAnchorRect: () => view.container?.getBounds?.() ?? null,
      };
    }
    return null;
  }

  return {
    init,
    rebuildAll,
    update,
    hasActiveHoverZoomDown,
    hasActiveDrag() {
      return !!activeTagDrag || !!activeHubTagDrag;
    },
    setInventoryDragAffordances,
    getInventoryOwnerAtGlobalPos,
    getOccludingScreenRects,
    getInventoryOwnerAnchor,
    setDistributorBuildPreview(spec) {
      if (!spec) {
        clearBuildDistributorRangePreview();
        clearBuildPlacementPreviewSpec();
      } else {
        setBuildDistributorRangePreview(spec);
        setBuildPlacementPreviewSpec(spec);
      }
    },
  };
}

/**
 * @typedef {Object} BoardEventView
 * @property {PIXI.Container} container
 * @property {any} event
 * @property {PIXI.Text} remainingText
 *
 * @typedef {Object} BoardEnvStructureView
 * @property {PIXI.Container} container
 * @property {any} structure
 *
 * @typedef {Object} BoardHubStructureView
 * @property {PIXI.Container} container
 * @property {any} structure
 * @property {Array<any>} meterViews
 */
