// src/views/ui-root-pixi.js

//
// Scenario Selector - Options for boot are in scenario-defs.js
//

//const BOOT_SETUP_ID = "devGym01";
const BOOT_SETUP_ID = "devPlaytesting01";

//

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { envStructureDefs } from "../defs/gamepieces/env-structures-defs.js";
import { ActionKinds } from "../model/actions.js";
import {
  isAnyDropboxOwnerId,
  parseBasketDropboxOwnerId,
  parseProcessDropboxOwnerId,
} from "../model/owner-id-protocol.js";
import { evaluateProcessDropboxDragStatus } from "../model/commands/process-dropbox-logic.js";
import { setupDefs } from "../defs/gamesettings/scenarios-defs.js";
import { normalizeVariantFlags } from "../defs/gamesettings/variant-flags-defs.js";
import { createSimRunner } from "../controllers/sim-runner.js";
import { createTimegraphForecastWorkerService } from "../controllers/timegraph-forecast-worker-service.js";
import { createTimeGraphController } from "../model/timegraph-controller.js";
import { getInventoryOwnerVisibility } from "../model/inventory-owner-visibility.js";
import { getStateDataAtSecond } from "../model/timeline/index.js";
import { GRAPH_METRICS } from "../model/graph-metrics.js";
import { runDeterminismSuite } from "../model/tests/determinism.js";
import { createInteractionController } from "./interaction-controler-pixi.js";
import { createTooltipView } from "./tooltip-pixi.js";
import { createInventoryView } from "./inventory-pixi.js";
import { createPawnsView } from "./pawns-pixi.js";
import { createBoardView } from "./board-pixi.js";
import { createChromeView } from "./chrome-pixi.js";
import {
  createTimeControlsView,
  TIME_CONTROLS_LAYOUT,
} from "./time-controls-pixi.js";
import { createMetricGraphView } from "./timegraphs-pixi.js";
import { createProcessWidgetView } from "./process-widget-pixi.js";
import { createSkillTreeView } from "./skill-tree-pixi.js";
import { createSkillTreeEditorView } from "./skill-tree-editor-pixi.js";
import {
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
  VIEW_LAYOUT,
  BOARD_COLS,
  HUB_COLS,
  HUB_STRUCTURE_HEIGHT,
  HUB_STRUCTURE_ROW_Y,
  TIME_STATE_COLORS,
  TIME_STATE_FILTER_ALPHA,
  TILE_HEIGHT,
  TILE_ROW_Y,
  getBoardColumnCenterXForVisibleCols,
  getHubColumnCenterXForVisibleCols,
} from "./layout-pixi.js";
import { createDebugOverlay } from "./debug-overlay-pixi.js";
import { createDebugInspectorView } from "./debug-inspector-pixi.js";
import { createActionLogView } from "./action-log-pixi.js";
import { createEventLogView } from "./event-log-pixi.js";
import { createYearEndPerformanceView } from "./year-end-performance-pixi.js";
import { createRunCompleteView } from "./run-complete-pixi.js";
import { createPlayfieldMuchaStyle } from "./playfield-mucha-style.js";
import { createBackdropView } from "./backdrop-pixi.js";
import {
  createPlayfieldCamera,
  resolvePanBounds,
} from "./playfield-camera.js";
import {
  createSunAndMoonDisksView,
  SUN_AND_MOON_DISKS_LAYOUT,
} from "./sunandmoon-disks-pixi.js";
import {
  createEnvEventDeckView,
  ENV_EVENT_DECK_LAYOUT,
} from "./env-event-deck-pixi.js";
import {
  getPerfSnapshot,
  getTopViewUpdates,
  perfEnabled,
  perfNowMs,
  resetPerfCounters,
  recordViewFrame,
  recordViewUpdate,
} from "../model/perf.js";
import {
  hasSkillFeatureUnlock,
} from "../model/skills.js";
import { getVisibleEnvColCount, isHubVisible } from "../model/state.js";
import { createProjectionParityProbe } from "./ui-root/projection-parity.js";
import { createPausedActionQueue } from "./ui-root/paused-action-queue.js";
import { createLiveActionOptimism } from "./ui-root/live-action-optimism.js";
import { createSystemGraphModel } from "./ui-root/system-graph-model.js";
import { createRunnerMetricGraph } from "./ui-root/graph-view-builders.js";
import { createScrollGraphOrchestrator } from "./ui-root/scroll-graph-orchestrator.js";
import { createUiOcclusionManager } from "./ui-root/ui-occlusion-manager.js";
import { installGlobalTextStylePolicy } from "./ui-helpers/text-style-policy.js";

const BOOT_VARIANT_FLAGS = normalizeVariantFlags(
  setupDefs?.[BOOT_SETUP_ID]?.variantFlags
);

function isBootVariantFlagEnabled(flagId) {
  return BOOT_VARIANT_FLAGS?.[flagId] !== false;
}

const MOBILE_PERF_DEFAULTS = Object.freeze({
  breakpointPx: 980,
  disablePlayfieldShader: true,
  shaderQuality: "low",
  maxTextResolution: 2,
  disableAntialias: true,
});

function getMobilePerfConfig() {
  const raw =
    VIEW_LAYOUT?.performance?.mobile &&
    typeof VIEW_LAYOUT.performance.mobile === "object"
      ? VIEW_LAYOUT.performance.mobile
      : {};
  const breakpointPx = Number.isFinite(raw.breakpointPx)
    ? Math.max(320, Math.floor(raw.breakpointPx))
    : MOBILE_PERF_DEFAULTS.breakpointPx;
  const shaderQuality =
    typeof raw.shaderQuality === "string" && raw.shaderQuality.length > 0
      ? raw.shaderQuality
      : MOBILE_PERF_DEFAULTS.shaderQuality;
  const maxTextResolution = Number.isFinite(raw.maxTextResolution)
    ? Math.max(1, Math.floor(raw.maxTextResolution))
    : MOBILE_PERF_DEFAULTS.maxTextResolution;
  return {
    breakpointPx,
    shaderQuality,
    maxTextResolution,
    disablePlayfieldShader:
      raw.disablePlayfieldShader !== false &&
      MOBILE_PERF_DEFAULTS.disablePlayfieldShader,
    disableAntialias:
      raw.disableAntialias !== false && MOBILE_PERF_DEFAULTS.disableAntialias,
  };
}

const MOBILE_PERF_CONFIG = getMobilePerfConfig();

function getViewportWidthPxNow() {
  const vv = window.visualViewport;
  if (vv && Number.isFinite(vv.width) && vv.width > 0) {
    return Math.max(1, Math.floor(vv.width));
  }
  return Math.max(
    1,
    Math.floor(
      window.innerWidth ||
        document.documentElement.clientWidth ||
        VIEWPORT_DESIGN_WIDTH
    )
  );
}

function isMobilePerfViewportWidth(widthPx = getViewportWidthPxNow()) {
  return widthPx <= MOBILE_PERF_CONFIG.breakpointPx;
}

const MOBILE_PERF_AT_BOOT = isMobilePerfViewportWidth();

if (
  typeof globalThis !== "undefined" &&
  globalThis.__PERF_ENABLED__ == null
) {
  globalThis.__PERF_ENABLED__ = false;
}

if (typeof globalThis !== "undefined" && MOBILE_PERF_AT_BOOT) {
  globalThis.__MAX_TEXT_RESOLUTION__ = MOBILE_PERF_CONFIG.maxTextResolution;
}

export const app = new PIXI.Application({
  width: VIEWPORT_DESIGN_WIDTH,
  height: VIEWPORT_DESIGN_HEIGHT,
  backgroundColor: 0x57514b,
  antialias:
    MOBILE_PERF_AT_BOOT && MOBILE_PERF_CONFIG.disableAntialias ? false : true,
});

installGlobalTextStylePolicy(PIXI, {
  fontFamily: "Georgia",
  titleVariant: "small-caps",
});

document.body.appendChild(app.view);
app.view.style.touchAction = "none";
app.view.style.userSelect = "none";
app.view.style.webkitUserSelect = "none";
app.view.style.display = "block";

function getViewportSizePx() {
  const vv = window.visualViewport;
  if (
    vv &&
    Number.isFinite(vv.width) &&
    Number.isFinite(vv.height) &&
    vv.width > 0 &&
    vv.height > 0
  ) {
    return {
      width: Math.max(1, Math.floor(vv.width)),
      height: Math.max(1, Math.floor(vv.height)),
    };
  }
  return {
      width: Math.max(
      1,
      Math.floor(
        window.innerWidth ||
          document.documentElement.clientWidth ||
          VIEWPORT_DESIGN_WIDTH
      )
    ),
    height: Math.max(
      1,
      Math.floor(
        window.innerHeight ||
          document.documentElement.clientHeight ||
          VIEWPORT_DESIGN_HEIGHT
      )
    ),
  };
}

function fitCanvasToViewport(view) {
  const vp = getViewportSizePx();
  const scale = Math.min(
    vp.width / VIEWPORT_DESIGN_WIDTH,
    vp.height / VIEWPORT_DESIGN_HEIGHT
  );
  const cssWidth = Math.max(1, Math.floor(VIEWPORT_DESIGN_WIDTH * scale));
  const cssHeight = Math.max(1, Math.floor(VIEWPORT_DESIGN_HEIGHT * scale));
  const left = Math.floor((vp.width - cssWidth) * 0.5);
  const top = Math.floor((vp.height - cssHeight) * 0.5);
  view.style.width = `${cssWidth}px`;
  view.style.height = `${cssHeight}px`;
  view.style.position = "fixed";
  view.style.left = `${left}px`;
  view.style.top = `${top}px`;
}

// Apply fit immediately so even early boot/runtime errors do not leave a 1920x1080 corner view.
fitCanvasToViewport(app.view);
let mobilePerfActive = MOBILE_PERF_AT_BOOT;

function applyMobilePerformanceProfile() {
  const viewport = getViewportSizePx();
  const nextMobilePerfActive = isMobilePerfViewportWidth(viewport.width);

  if (typeof globalThis !== "undefined") {
    globalThis.__MAX_TEXT_RESOLUTION__ = nextMobilePerfActive
      ? MOBILE_PERF_CONFIG.maxTextResolution
      : null;
  }

  if (
    MOBILE_PERF_CONFIG.disableAntialias &&
    app?.renderer &&
    Object.prototype.hasOwnProperty.call(app.renderer, "multisample")
  ) {
    const msaa = globalThis?.PIXI?.MSAA_QUALITY;
    if (msaa) {
      app.renderer.multisample = nextMobilePerfActive
        ? msaa.NONE
        : msaa.HIGH ?? msaa.MEDIUM ?? msaa.LOW ?? app.renderer.multisample;
    }
  }

  if (playfieldShader?.setQuality) {
    const defaultQuality =
      typeof VIEW_LAYOUT?.playfieldShader?.quality === "string" &&
      VIEW_LAYOUT.playfieldShader.quality.length > 0
        ? VIEW_LAYOUT.playfieldShader.quality
        : "medium";
    playfieldShader.setQuality(
      nextMobilePerfActive ? MOBILE_PERF_CONFIG.shaderQuality : defaultQuality
    );
  }

  if (playfieldShader?.setEnabled) {
    const defaultEnabled = VIEW_LAYOUT?.playfieldShader?.enabled !== false;
    const nextEnabled =
      nextMobilePerfActive && MOBILE_PERF_CONFIG.disablePlayfieldShader
        ? false
        : defaultEnabled;
    playfieldShader.setEnabled(nextEnabled);
  }

  const changed = mobilePerfActive !== nextMobilePerfActive;
  mobilePerfActive = nextMobilePerfActive;
  return { changed, active: mobilePerfActive };
}

let flashActionLogAp = null;
let actionLogView = null;
let eventLogView = null;
let yearEndPerformanceView = null;
let runCompleteView = null;
let backdropView = null;
let externalUiFocus = null;
let processWidgetHoverFocusOwners = [];
let processWidgetHoverUiFocus = null;
let skillTreeView = null;
let skillTreeEditorView = null;
let debugInspectorView = null;
let mainUiHiddenBySkillTree = false;
let pendingSkillTreeOpenLeaderPawnId = null;
let playfieldShader = null;
let playfieldCamera = null;
let stateTintOverlay = null;
let lastStateTintKey = "__init__";
let stateTintCurrentR = 1;
let stateTintCurrentG = 1;
let stateTintCurrentB = 1;
let stateTintCurrentAlpha = 0;
let stateTintTargetR = 1;
let stateTintTargetG = 1;
let stateTintTargetB = 1;
let stateTintTargetAlpha = 0;
const STATE_TINT_TRANSITION_SEC = 0.28;
const RUN_LOST_TINT_ALPHA_MULTIPLIER = 5;
const liveSeenYearEndEventIds = new Set();
let lastRunCompletePopupCursorKey = "";
const FULL_VIEW_REBUILD_REASONS = new Set([
  "init",
  "saveLoad",
  "plannerClear",
]);
const PLAYFIELD_CAMERA_LAYOUT =
  VIEW_LAYOUT?.playfieldCamera &&
  typeof VIEW_LAYOUT.playfieldCamera === "object"
    ? VIEW_LAYOUT.playfieldCamera
    : {};
const PLAYFIELD_CAMERA_MEMBERSHIP =
  PLAYFIELD_CAMERA_LAYOUT?.membership &&
  typeof PLAYFIELD_CAMERA_LAYOUT.membership === "object"
    ? PLAYFIELD_CAMERA_LAYOUT.membership
    : {};
const NOOP_ACTION_LOG_VIEW = {
  init() {},
  update() {},
  flashInsufficientAp() {},
  setApDragWarning() {},
  setDragGhost() {},
  resolveDragGhost() {},
  flashGhost() {},
};
let scrollGraphOrchestrator = null;
let liveActionOptimism = null;
const forecastWorkerService = createTimegraphForecastWorkerService();

const runner = createSimRunner({
  setupId: BOOT_SETUP_ID,
  onInvalidate: (reason) => {
    liveActionOptimism?.handleInvalidate?.(reason);
    const cursorOnlyReason =
      reason === "scrubBrowse" || reason === "scrubCommit";
    // Keep cursor-only browse/commit lean; all other mutation reasons should
    // invalidate controllers immediately (including planner:* edits).
    if (!cursorOnlyReason) {
      forecastWorkerService.handleTimelineInvalidation?.(reason);
    }
    if (cursorOnlyReason) return;
    goldGraphController.handleInvalidate(reason);
    grainGraphController.handleInvalidate(reason);
    foodGraphController.handleInvalidate(reason);
    apGraphController.handleInvalidate(reason);
    popGraphController.handleInvalidate(reason);
    systemGraphController.handleInvalidate(reason);
    scrollGraphOrchestrator?.handleInvalidate?.(reason);
  },
  onRebuildViews: (reason = "unknown") => {
    liveActionOptimism?.handleInvalidate?.(reason);
    tooltipView?.hide?.();
    if (reason === "scrubCommit") {
      refreshOpenInventoryWindows();
    }
    if (FULL_VIEW_REBUILD_REASONS.has(reason)) {
      refreshOpenInventoryWindows();
      boardView.rebuildAll();
      pawnsView.rebuildAll();
    }
    if (
      PLAYFIELD_CAMERA_LAYOUT?.resetOnScenarioLoad !== false &&
      FULL_VIEW_REBUILD_REASONS.has(reason)
    ) {
      playfieldCamera?.reset?.();
    }
    backdropView?.refresh?.();
    chromeView.refresh?.();
    timeControlsView.refresh?.();
    playfieldCamera?.resize?.();
  },
  onPlannerApReject: () => {
    flashActionLogAp?.();
  },
});

const actionPlanner = runner.getActionPlanner?.();

const pausedActionQueue = createPausedActionQueue({ runner });
const requestPauseForAction = pausedActionQueue.requestPauseForAction;
const queueActionWhenPaused = pausedActionQueue.queueActionWhenPaused;
const flushQueuedActions = pausedActionQueue.flushQueuedActions;
const setAutoPauseOnPlayerAction =
  pausedActionQueue.setAutoPauseOnPlayerAction;
const isAutoPauseOnPlayerActionEnabled =
  pausedActionQueue.isAutoPauseOnPlayerActionEnabled;

function isLiveActionOptimismEnabled() {
  if (runner.isPreviewing?.()) return false;
  if (runner.getCursorState?.()?.paused === true) return false;
  return isAutoPauseOnPlayerActionEnabled?.() !== true;
}

liveActionOptimism = createLiveActionOptimism({
  getState: () => runner.getCursorState?.(),
  getPreviewBoundaryStateData: (tSec) =>
    runner.getPlannerBoundaryStateData?.(tSec) ?? {
      ok: false,
      reason: "noPlannerBoundary",
    },
  getTimeline: () => runner.getTimeline?.(),
  getOwnerLabel(ownerId) {
    const state = runner.getCursorState?.();
    const hubSlot = state?.hub?.slots?.find(
      (slot) => slot?.structure?.instanceId === ownerId
    );
    if (hubSlot?.structure) {
      const def = hubStructureDefs[hubSlot.structure.defId];
      return def?.name || def?.id || `Hub ${ownerId}`;
    }
    const pawn = state?.pawns?.find((candidatePawn) => candidatePawn.id === ownerId);
    if (pawn) return pawn.name || `Pawn ${ownerId}`;
    return `Owner ${ownerId}`;
  },
  isOptimismEnabled: () => isLiveActionOptimismEnabled(),
});

function recordOptimisticSchedule(result) {
  liveActionOptimism?.recordScheduledBatch?.(result);
  return result;
}

function dispatchPlayerAction(kind, payload, opts) {
  return recordOptimisticSchedule(runner.dispatchAction(kind, payload, opts));
}

function isActionPointCostsEnabled(state = runner.getState?.()) {
  return state?.variantFlags?.actionPointCostsEnabled !== false;
}

function isFreeLiveActionMode() {
  const cursor = runner.getCursorState?.();
  const state = runner.getState?.();
  return (
    cursor?.paused !== true &&
    isAutoPauseOnPlayerActionEnabled?.() !== true &&
    !isActionPointCostsEnabled(state)
  );
}

function dispatchPlayerEditAction(kind, payload, opts) {
  if (isFreeLiveActionMode()) {
    return runner.dispatchActionAtCurrentSecond?.(kind, payload, opts) ?? {
      ok: false,
      reason: "noRunner",
    };
  }
  return dispatchPlayerAction(kind, payload, opts);
}

function dispatchPlayerEditBatch(actions, opts) {
  if (isFreeLiveActionMode()) {
    return runner.dispatchActionsAtCurrentSecond?.(actions, opts) ?? {
      ok: false,
      reason: "noRunner",
    };
  }
  return schedulePlayerActionsAtNextSecond(actions, opts);
}

function schedulePlayerActionsAtNextSecond(actions, opts) {
  return recordOptimisticSchedule(
    runner.scheduleActionsAtNextSecond?.(actions, opts) ?? {
      ok: false,
      reason: "noRunner",
    }
  );
}

function schedulePlayerActionAtNextSecond(kind, payload, opts) {
  return recordOptimisticSchedule(
    runner.scheduleActionAtNextSecond?.(kind, payload, opts) ?? {
      ok: false,
      reason: "noRunner",
    }
  );
}

function pauseForDiskScrub() {
  const state = runner.getCursorState?.();
  if (!state || state.paused === true) return;
  runner.setTimeScaleTarget?.(0, { requestPause: true });
  runner.setPaused(true);
}

function commitPreviewInventoryTransferForUse(spec) {
  const item = spec?.item;
  const sourceOwnerId = item?.sourceOwnerId ?? null;
  const targetOwnerId = spec?.ownerId ?? null;
  const itemId = spec?.itemId ?? item?.id ?? null;
  if (sourceOwnerId == null || targetOwnerId == null || itemId == null) {
    return { ok: true, result: "noPreviewTransfer" };
  }
  if (sourceOwnerId === targetOwnerId) {
    return { ok: true, result: "noPreviewTransfer" };
  }

  const moveRes = dispatchPlayerEditAction(
    ActionKinds.INVENTORY_MOVE,
    {
      fromOwnerId: sourceOwnerId,
      toOwnerId: targetOwnerId,
      itemId,
      targetGX: item?.gridX ?? 0,
      targetGY: item?.gridY ?? 0,
    },
    { apCost: 0 }
  );
  if (moveRes?.ok !== true) return moveRes;

  actionPlanner?.removeIntent?.(`item:${itemId}`);
  return { ok: true, result: "previewTransferCommitted" };
}

function getMergedPreviewVersion() {
  if (runner.isPreviewing?.()) return 0;
  return `${actionPlanner?.getVersion?.() ?? 0}|${liveActionOptimism?.getVersion?.() ?? 0}`;
}

function getMergedTilePlanPreview(envCol) {
  if (runner.isPreviewing?.()) return null;
  if (isLiveActionOptimismEnabled()) {
    const optimistic = liveActionOptimism?.getTilePlanPreview?.(envCol) ?? null;
    if (optimistic) return optimistic;
  }
  return actionPlanner?.getTilePlanPreview?.(envCol) ?? null;
}

function getMergedHubPlanPreview(hubCol) {
  if (runner.isPreviewing?.()) return null;
  if (isLiveActionOptimismEnabled()) {
    const optimistic = liveActionOptimism?.getHubPlanPreview?.(hubCol) ?? null;
    if (optimistic) return optimistic;
  }
  return actionPlanner?.getHubPlanPreview?.(hubCol) ?? null;
}

function getMergedInventoryPreview(ownerId) {
  if (runner.isPreviewing?.()) return null;
  if (isLiveActionOptimismEnabled()) {
    return liveActionOptimism?.getInventoryPreview?.(ownerId) ?? null;
  }
  return actionPlanner?.getInventoryPreview?.(ownerId) ?? null;
}

function getMergedPawnOverridePlacement(pawnId) {
  if (runner.isPreviewing?.()) return null;
  if (isLiveActionOptimismEnabled()) {
    const optimistic =
      liveActionOptimism?.getPawnOverridePlacement?.(pawnId) ?? null;
    if (optimistic) return optimistic;
  }
  return actionPlanner?.getPawnOverridePlacement?.(pawnId) ?? null;
}

function getMergedTileTagTogglePreview({ envCol, tagId } = {}) {
  const preview = getMergedTilePlanPreview(envCol);
  if (
    preview?.tagDisabledById &&
    Object.prototype.hasOwnProperty.call(preview.tagDisabledById, tagId)
  ) {
    return preview.tagDisabledById[tagId] === true;
  }
  return actionPlanner?.getTileTagTogglePreview?.({ envCol, tagId }) ?? null;
}

function getMergedHubTagTogglePreview({ hubCol, tagId } = {}) {
  const preview = getMergedHubPlanPreview(hubCol);
  if (
    preview?.tagDisabledById &&
    Object.prototype.hasOwnProperty.call(preview.tagDisabledById, tagId)
  ) {
    return preview.tagDisabledById[tagId] === true;
  }
  return actionPlanner?.getHubTagTogglePreview?.({ hubCol, tagId }) ?? null;
}

const previewPlanner = {
  ...(actionPlanner || {}),
  getVersion: () => getMergedPreviewVersion(),
  getInventoryPreview: (ownerId) => getMergedInventoryPreview(ownerId),
  getPawnOverridePlacement: (pawnId) => getMergedPawnOverridePlacement(pawnId),
  getPawnOverrideHubCol: (pawnId) =>
    getMergedPawnOverridePlacement(pawnId)?.hubCol ?? null,
  getTilePlanPreview: (envCol) => getMergedTilePlanPreview(envCol),
  getHubPlanPreview: (hubCol) => getMergedHubPlanPreview(hubCol),
  getTileTagTogglePreview: (spec) => getMergedTileTagTogglePreview(spec),
  getHubTagTogglePreview: (spec) => getMergedHubTagTogglePreview(spec),
};

const goldGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.gold,
  forecastWorkerService,
});

const grainGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.grain,
  forecastWorkerService,
});

const foodGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.food,
  forecastWorkerService,
});

const apGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.ap,
  forecastWorkerService,
});

const popGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.population,
  forecastWorkerService,
});

function resizeCanvas() {
  fitCanvasToViewport(app.view);
  applyMobilePerformanceProfile();
  document.body.style.backgroundColor = "black";
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.documentElement.style.backgroundColor = "black";
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
  skillTreeView?.resize?.();
  skillTreeEditorView?.resize?.();
  yearEndPerformanceView?.resize?.();
  runCompleteView?.resize?.();
  backdropView?.refresh?.();
  playfieldCamera?.resize?.();
  if (stateTintOverlay) {
    redrawStateTintOverlayBounds();
  }
}
window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
window.visualViewport?.addEventListener("resize", resizeCanvas);
window.visualViewport?.addEventListener("scroll", resizeCanvas);
document?.addEventListener?.("fullscreenchange", resizeCanvas);
document?.addEventListener?.("webkitfullscreenchange", resizeCanvas);
resizeCanvas();

const uiLayers = {
  cameraRoot: new PIXI.Container(),
  fixedHudRoot: new PIXI.Container(),
  backgroundLayer: new PIXI.Container(),
  tileLayer: new PIXI.Container(),
  eventLayer: new PIXI.Container(),
  envStructuresLayer: new PIXI.Container(),
  hubStructuresLayer: new PIXI.Container(),
  pawnLayer: new PIXI.Container(),
  stateTintLayer: new PIXI.Container(),
  cameraControlsLayer: new PIXI.Container(),
  fixedControlsLayer: new PIXI.Container(),
  hoverLayer: new PIXI.Container(),
  inventoryLayer: new PIXI.Container(),
  inventoryHoverLayer: new PIXI.Container(),
  tooltipLayer: new PIXI.Container(),
  dragLayer: new PIXI.Container(),
  fixedDebugLayer: new PIXI.Container(),
  fixedModalLayer: new PIXI.Container(),
  skillTreeLayer: new PIXI.Container(),
};

uiLayers.cameraRoot.addChild(
  uiLayers.backgroundLayer,
  uiLayers.tileLayer,
  uiLayers.eventLayer,
  uiLayers.envStructuresLayer,
  uiLayers.hubStructuresLayer,
  uiLayers.pawnLayer,
  uiLayers.cameraControlsLayer,
  uiLayers.inventoryLayer,
  uiLayers.hoverLayer,
  uiLayers.inventoryHoverLayer,
  uiLayers.tooltipLayer
);
uiLayers.fixedHudRoot.addChild(
  uiLayers.fixedControlsLayer,
  uiLayers.fixedDebugLayer,
  uiLayers.dragLayer,
  uiLayers.fixedModalLayer
);

app.stage.eventMode = "static";
app.stage.hitArea = app.screen;
app.stage.addChild(
  uiLayers.cameraRoot,
  uiLayers.stateTintLayer,
  uiLayers.fixedHudRoot,
  uiLayers.skillTreeLayer
);
function captureStagePointerPosition(ev) {
  const global = ev?.data?.global;
  if (!global) return;
  interactionController?.setPointerStagePos?.({
    x: Number(global.x) || 0,
    y: Number(global.y) || 0,
  });
}
app.stage.on("pointermove", captureStagePointerPosition);
app.stage.on("pointerdown", captureStagePointerPosition);

stateTintOverlay = new PIXI.Graphics();
stateTintOverlay.eventMode = "none";
uiLayers.stateTintLayer.addChild(stateTintOverlay);
lastStateTintKey = "__init__";

function redrawStateTintOverlayBounds() {
  stateTintOverlay.clear();
  stateTintOverlay.beginFill(0xffffff, 1);
  stateTintOverlay.drawRect(0, 0, app.screen.width, app.screen.height);
  stateTintOverlay.endFill();
}

function toColorRgb01(color) {
  const value = Number.isFinite(color) ? Math.floor(color) >>> 0 : 0xffffff;
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return { r, g, b };
}

function toHexColor(r, g, b) {
  const rr = Math.max(0, Math.min(255, Math.round(r * 255)));
  const gg = Math.max(0, Math.min(255, Math.round(g * 255)));
  const bb = Math.max(0, Math.min(255, Math.round(b * 255)));
  return (rr << 16) | (gg << 8) | bb;
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function isCameraMember(memberKey, fallback = true) {
  if (!memberKey || typeof memberKey !== "string") return fallback;
  if (!Object.prototype.hasOwnProperty.call(PLAYFIELD_CAMERA_MEMBERSHIP, memberKey)) {
    return fallback;
  }
  return PLAYFIELD_CAMERA_MEMBERSHIP[memberKey] !== false;
}

function pickHudLayer(memberKey, fallbackCameraLayer, fallbackFixedLayer) {
  return isCameraMember(memberKey, true) ? fallbackCameraLayer : fallbackFixedLayer;
}

function resolveTimeStateKey() {
  const timeline = runner.getTimeline?.();
  const cursorState = runner.getCursorState?.();
  const viewState = runner.getState?.();
  const preview = runner.getPreviewStatus?.();
  const sec =
    preview?.active && Number.isFinite(preview?.previewSec)
      ? Math.max(0, Math.floor(preview.previewSec))
      : Math.max(0, Math.floor(cursorState?.tSec ?? 0));
  const runStatus =
    viewState?.runStatus && typeof viewState.runStatus === "object"
      ? viewState.runStatus
      : null;
  const runLostSec =
    runStatus?.complete === true && Number.isFinite(runStatus?.tSec)
      ? Math.max(0, Math.floor(runStatus.tSec))
      : null;
  if (runLostSec != null && sec >= runLostSec) {
    return "runLost";
  }
  if (preview?.isForecastPreview) return "forecast";

  const historyEndSec = Math.max(0, Math.floor(timeline?.historyEndSec ?? 0));
  const cursorSec = Math.max(0, Math.floor(cursorState?.tSec ?? 0));

  // Live frontier is un-tinted unless explicitly paused.
  if (sec >= historyEndSec) {
    if (cursorState?.paused === true) return "paused";
    return null;
  }

  const status = runner.getEditWindowStatusAtSecond?.(sec);
  if (status?.ok === true) return "editableHistory";
  if (status?.ok === false) return "fixedHistory";

  const bounds = runner.getEditableHistoryBounds?.();
  const minEditableSec = Number.isFinite(bounds?.minEditableSec)
    ? Math.max(0, Math.floor(bounds.minEditableSec))
    : 0;
  if (sec < minEditableSec) return "fixedHistory";
  return "editableHistory";
}

function updateStateTintOverlay(frameDt = 1 / 60) {
  const key = resolveTimeStateKey();
  if (key !== lastStateTintKey) {
    lastStateTintKey = key;
    if (!key) {
      stateTintTargetAlpha = 0;
    } else {
      const color = TIME_STATE_COLORS[key];
      const rgb = toColorRgb01(color);
      const alphaMultiplier =
        key === "runLost" ? RUN_LOST_TINT_ALPHA_MULTIPLIER : 1;
      stateTintTargetR = rgb.r;
      stateTintTargetG = rgb.g;
      stateTintTargetB = rgb.b;
      stateTintTargetAlpha = Math.min(
        1,
        TIME_STATE_FILTER_ALPHA * alphaMultiplier
      );
      if (stateTintCurrentAlpha <= 0.0001) {
        stateTintCurrentR = stateTintTargetR;
        stateTintCurrentG = stateTintTargetG;
        stateTintCurrentB = stateTintTargetB;
      }
    }
  }

  const dt = Number.isFinite(frameDt) ? Math.max(0, Number(frameDt)) : 1 / 60;
  const step = Math.min(1, dt / STATE_TINT_TRANSITION_SEC);
  stateTintCurrentR = lerp(stateTintCurrentR, stateTintTargetR, step);
  stateTintCurrentG = lerp(stateTintCurrentG, stateTintTargetG, step);
  stateTintCurrentB = lerp(stateTintCurrentB, stateTintTargetB, step);
  stateTintCurrentAlpha = lerp(stateTintCurrentAlpha, stateTintTargetAlpha, step);

  if (
    Math.abs(stateTintCurrentAlpha - stateTintTargetAlpha) < 0.0005 &&
    Math.abs(stateTintCurrentR - stateTintTargetR) < 0.001 &&
    Math.abs(stateTintCurrentG - stateTintTargetG) < 0.001 &&
    Math.abs(stateTintCurrentB - stateTintTargetB) < 0.001
  ) {
    stateTintCurrentR = stateTintTargetR;
    stateTintCurrentG = stateTintTargetG;
    stateTintCurrentB = stateTintTargetB;
    stateTintCurrentAlpha = stateTintTargetAlpha;
  }

  if (stateTintCurrentAlpha <= 0.0001 && stateTintTargetAlpha <= 0.0001) {
    stateTintOverlay.visible = false;
    return;
  }

  stateTintOverlay.visible = true;
  stateTintOverlay.tint = toHexColor(
    stateTintCurrentR,
    stateTintCurrentG,
    stateTintCurrentB
  );
  stateTintOverlay.alpha = Math.max(0, Math.min(1, stateTintCurrentAlpha));
}

redrawStateTintOverlayBounds();
updateStateTintOverlay();

function refreshOpenInventoryWindows() {
  if (!inventoryView?.windows || !inventoryView?.rebuildWindow) return;
  inventoryView.invalidateAllWindowVersions?.();
  for (const [ownerId, win] of inventoryView.windows.entries()) {
    if (!win?.container?.visible) continue;
    inventoryView.rebuildWindow(ownerId);
  }
}

function getExternalUiFocus() {
  return externalUiFocus || processWidgetHoverUiFocus;
}

function getFocusOwnersFromExternalUiFocus() {
  const focus = externalUiFocus;
  if (!focus) return [];
  if (Array.isArray(focus.ownerIds)) {
    return focus.ownerIds.filter((ownerId) => ownerId != null);
  }
  if (focus.kind === "pawn" && focus.pawnId != null) {
    return [focus.pawnId];
  }
  if (focus.kind === "hub" && focus.ownerId != null) {
    return [focus.ownerId];
  }
  return [];
}

function setProcessWidgetHoverFocusOwners(ownerIds) {
  processWidgetHoverFocusOwners = Array.isArray(ownerIds)
    ? ownerIds.filter((ownerId) => ownerId != null)
    : [];
}

function setProcessWidgetHoverUiFocus(focus) {
  processWidgetHoverUiFocus = focus && typeof focus === "object" ? focus : null;
}

function getExternalFocusOwners() {
  const merged = [];
  const seen = new Set();
  for (const ownerId of getFocusOwnersFromExternalUiFocus()) {
    const key = `${typeof ownerId}:${String(ownerId)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ownerId);
  }
  for (const ownerId of processWidgetHoverFocusOwners) {
    const key = `${typeof ownerId}:${String(ownerId)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ownerId);
  }
  return merged;
}

function resolveHubFocusTarget(state, focus) {
  if (!state || !focus || focus.kind !== "hub") return null;
  const ownerId = focus.ownerId ?? null;
  if (ownerId != null) {
    for (const slot of state?.hub?.slots || []) {
      const structure = slot?.structure;
      if (!structure) continue;
      if (String(structure.instanceId) === String(ownerId)) return structure;
    }
  }
  const hubCol = Number.isFinite(focus.hubCol) ? Math.floor(focus.hubCol) : null;
  if (hubCol == null) return null;
  return state?.hub?.occ?.[hubCol] ?? state?.hub?.slots?.[hubCol]?.structure ?? null;
}

function resolveTileFocusTarget(state, focus) {
  if (!state || !focus) return null;
  if (focus.kind !== "tile" && focus.kind !== "event") return null;
  const envCol = Number.isFinite(focus.envCol) ? Math.floor(focus.envCol) : null;
  if (envCol == null) return null;
  return state?.board?.occ?.tile?.[envCol] ?? null;
}

function applyExternalUiFocusToProcessWidgets() {
  if (!processWidgetView) return;
  const state = runner.getState?.();
  const focus = externalUiFocus;
  if (!state || !focus) {
    processWidgetView.clearExternalFocusTarget?.();
    return;
  }

  const hubTarget = resolveHubFocusTarget(state, focus);
  if (hubTarget) {
    processWidgetView.setExternalFocusTarget?.(
      hubTarget,
      focus.systemId || "build"
    );
    return;
  }

  const tileTarget = resolveTileFocusTarget(state, focus);
  if (tileTarget) {
    processWidgetView.setExternalFocusTarget?.(
      tileTarget,
      focus.systemId || null
    );
    return;
  }

  processWidgetView.clearExternalFocusTarget?.();
}

function setExternalUiFocus(nextFocus) {
  externalUiFocus = nextFocus || null;
  applyExternalUiFocusToProcessWidgets();
}

function clearExternalUiFocus() {
  if (!externalUiFocus) return;
  externalUiFocus = null;
  processWidgetView?.clearExternalFocusTarget?.();
}

function setMainUiVisible(visible) {
  uiLayers.cameraRoot.visible = visible;
  uiLayers.stateTintLayer.visible = visible;
  uiLayers.fixedHudRoot.visible = visible;
}

function restoreMainUiAfterSkillTree() {
  if (!mainUiHiddenBySkillTree) return;
  mainUiHiddenBySkillTree = false;
  setMainUiVisible(true);
  tooltipView?.hide?.();
}

function openSkillTreeEditorForTree({ treeId, defsInput = null } = {}) {
  if (!skillTreeEditorView) return { ok: false, reason: "noSkillTreeEditorView" };
  if (!treeId || typeof treeId !== "string") return { ok: false, reason: "badTreeId" };
  if (skillTreeEditorView.isOpen?.()) return { ok: false, reason: "alreadyOpen" };

  requestPauseForAction();
  const openRes = skillTreeEditorView.open({
    treeId,
    defsInput,
    onExit: () => {
      restoreMainUiAfterSkillTree();
    },
  });
  if (!openRes?.ok) return openRes;

  if (!mainUiHiddenBySkillTree) {
    mainUiHiddenBySkillTree = true;
    setMainUiVisible(false);
  }
  clearExternalUiFocus();
  tooltipView?.hide?.();
  return { ok: true };
}

function commitActivePreviewForSkillTree() {
  const preview = runner.getPreviewStatus?.();
  if (!preview?.active) return { ok: true, committed: false };
  if (preview.isForecastPreview) {
    const res = runner.commitPreviewToLive?.();
    return res?.ok === false ? res : { ok: true, committed: true };
  }
  const previewSec = Number.isFinite(preview.previewSec)
    ? Math.floor(preview.previewSec)
    : null;
  if (previewSec == null) {
    return { ok: false, reason: "badPreviewSec" };
  }
  const res = runner.commitCursorSecond?.(previewSec);
  return res?.ok === false ? res : { ok: true, committed: true };
}

function openSkillTreeForLeaderPawn(leaderPawnId) {
  if (!skillTreeView) return { ok: false, reason: "noSkillTreeView" };
  if (skillTreeView.isOpen?.()) return { ok: false, reason: "alreadyOpen" };
  if (skillTreeEditorView?.isOpen?.()) return { ok: false, reason: "editorOpen" };
  if (!Number.isFinite(leaderPawnId)) {
    return { ok: false, reason: "badLeaderPawnId" };
  }
  const resolvedLeaderPawnId = Math.floor(leaderPawnId);
  const previewCommitRes = commitActivePreviewForSkillTree();
  if (previewCommitRes?.ok === false) return previewCommitRes;
  const state = runner.getCursorState?.();
  if (!state?.paused) {
    pendingSkillTreeOpenLeaderPawnId = resolvedLeaderPawnId;
    runner.setTimeScaleTarget?.(0, { requestPause: true });
    runner.setPaused(true);
    return { ok: true, queued: true, reason: "waitingForPause" };
  }

  const openRes = skillTreeView.open({
    leaderPawnId: resolvedLeaderPawnId,
    pawnId: resolvedLeaderPawnId,
    onExit: (result) => {
      if (result?.openEditor && result?.treeId) {
        const editorRes = openSkillTreeEditorForTree({ treeId: result.treeId });
        if (!editorRes?.ok) {
          restoreMainUiAfterSkillTree();
        }
        return;
      }
      restoreMainUiAfterSkillTree();
    },
  });
  if (!openRes?.ok) return openRes;

  mainUiHiddenBySkillTree = true;
  setMainUiVisible(false);
  clearExternalUiFocus();
  tooltipView?.hide?.();
  return { ok: true };
}

function flushPendingSkillTreeOpen() {
  if (!Number.isFinite(pendingSkillTreeOpenLeaderPawnId)) return;
  if (skillTreeView?.isOpen?.() || skillTreeEditorView?.isOpen?.()) {
    pendingSkillTreeOpenLeaderPawnId = null;
    return;
  }
  const state = runner.getCursorState?.();
  if (!state?.paused) return;
  const leaderPawnId = pendingSkillTreeOpenLeaderPawnId;
  pendingSkillTreeOpenLeaderPawnId = null;
  openSkillTreeForLeaderPawn(leaderPawnId);
}

function toSafeIndex(raw, fallback = 0) {
  if (!Number.isFinite(raw)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(raw));
}

function toSafeNumericId(value) {
  if (Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

function resolveOwnerIdFromScenarioSelector(state, selector) {
  if (!state || selector == null) return null;

  const directNumeric = toSafeNumericId(selector);
  if (directNumeric != null) return directNumeric;
  if (typeof selector === "string" && selector.length > 0) return selector;
  if (typeof selector !== "object") return null;

  const type =
    typeof selector.type === "string" ? selector.type : typeof selector.kind === "string" ? selector.kind : null;
  if (type === "leaderPawn" || type === "pawn") {
    if (Number.isFinite(selector.id)) return Math.floor(selector.id);
    const pawns = Array.isArray(state.pawns) ? state.pawns : [];
    if (type === "leaderPawn") {
      const leaders = pawns.filter((pawn) => pawn?.role === "leader");
      const idx = toSafeIndex(selector.index ?? 0, 0);
      return leaders[idx]?.id ?? null;
    }
    const idx = toSafeIndex(selector.index ?? 0, 0);
    return pawns[idx]?.id ?? null;
  }

  if (type === "hubStructure" || type === "hubSlot") {
    const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
    const idx = Number.isFinite(selector.hubCol)
      ? toSafeIndex(selector.hubCol, 0)
      : Number.isFinite(selector.col)
        ? toSafeIndex(selector.col, 0)
        : toSafeIndex(selector.index ?? 0, 0);
    const structure = slots[idx]?.structure;
    return structure?.instanceId ?? null;
  }

  return null;
}

function resolveLeaderPawnIdFromScenarioSelector(state, selector) {
  if (!state || selector == null) return null;
  const direct = toSafeNumericId(selector);
  if (direct != null) return direct;
  if (typeof selector !== "object") return null;

  if (Number.isFinite(selector.id)) return Math.floor(selector.id);
  const pawns = Array.isArray(state.pawns) ? state.pawns : [];
  if (
    selector.type === "leaderPawn" ||
    selector.kind === "leaderPawn"
  ) {
    const leaders = pawns.filter((pawn) => pawn?.role === "leader");
    const idx = toSafeIndex(selector.index ?? 0, 0);
    return leaders[idx]?.id ?? null;
  }
  if (
    selector.type === "pawn" ||
    selector.kind === "pawn" ||
    Number.isFinite(selector.index)
  ) {
    const idx = toSafeIndex(selector.index ?? 0, 0);
    return pawns[idx]?.id ?? null;
  }
  return null;
}

function applyScenarioDevUiBootstrap() {
  const setupId = runner.getSetupId?.() ?? BOOT_SETUP_ID;
  const setup = setupDefs?.[setupId];
  const devUi =
    setup?.devUi && typeof setup.devUi === "object" ? setup.devUi : null;
  if (!devUi) return;

  const state = runner.getState?.();
  if (!state) return;

  const inventorySelectors = Array.isArray(devUi.openInventories)
    ? devUi.openInventories
    : Array.isArray(devUi.openInventoryOwners)
      ? devUi.openInventoryOwners
      : [];
  for (const selector of inventorySelectors) {
    const ownerId = resolveOwnerIdFromScenarioSelector(state, selector);
    if (ownerId == null) continue;
    queueInventoryWindowRevealNearOwner(ownerId);
  }

  const shouldOpenSkillTreeEditor =
    devUi.openSkillTreeEditor != null && devUi.openSkillTreeEditor !== false;

  if (!shouldOpenSkillTreeEditor && devUi.openSkillTree != null && devUi.openSkillTree !== false) {
    const selector =
      devUi.openSkillTree === true
        ? { type: "leaderPawn", index: 0 }
        : devUi.openSkillTree;
    const leaderPawnId = resolveLeaderPawnIdFromScenarioSelector(state, selector);
    if (leaderPawnId != null) {
      openSkillTreeForLeaderPawn(leaderPawnId);
    }
  }

  if (shouldOpenSkillTreeEditor) {
    const selector =
      typeof devUi.openSkillTreeEditor === "object" && devUi.openSkillTreeEditor
        ? devUi.openSkillTreeEditor
        : {};
    const treeId =
      typeof selector.treeId === "string" && selector.treeId.length
        ? selector.treeId
        : "systemColorMap";
    openSkillTreeEditorForTree({ treeId });
  }
}

function findFirstPawnOwnerId(state) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  return pawns[0]?.id ?? null;
}

function findHubStructureOwnerIdByDefId(state, defId) {
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    const structure = slot?.structure ?? null;
    if (!structure || structure.defId !== defId) continue;
    return structure.instanceId ?? null;
  }
  return null;
}

function resolveInventoryOwnerAnchor(ownerId) {
  if (ownerId == null) return null;
  const pawnAnchor = pawnsView?.getInventoryOwnerAnchor?.(ownerId) ?? null;
  if (pawnAnchor) return pawnAnchor;
  return boardView?.getInventoryOwnerAnchor?.(ownerId) ?? null;
}

const pendingInventoryAutoRevealOwnerIds = new Set();

function queueInventoryWindowRevealNearOwner(ownerId) {
  if (ownerId == null) return;
  pendingInventoryAutoRevealOwnerIds.add(ownerId);
}

function revealInventoryWindowNearOwner(ownerId, opts = {}) {
  if (ownerId == null) return { ok: false, reason: "badOwner" };
  const res = inventoryView?.revealWindow?.(ownerId, {
    pinned: opts.pinned !== false,
    anchor: resolveInventoryOwnerAnchor(ownerId),
  });
  inventoryView?.rebuildWindow?.(ownerId);
  return res ?? { ok: false, reason: "noInventoryView" };
}

function flushPendingInventoryWindowReveals() {
  if (pendingInventoryAutoRevealOwnerIds.size <= 0) return;
  const ownerIds = Array.from(pendingInventoryAutoRevealOwnerIds);
  pendingInventoryAutoRevealOwnerIds.clear();
  for (const ownerId of ownerIds) {
    revealInventoryWindowNearOwner(ownerId, { pinned: true });
  }
}

let lastMobileDelveHubVisible = null;
function syncMobileDelveInventoryAutoOpen() {
  const state = runner.getCursorState?.();
  const hubVisible = isHubVisible(state);
  const justRevealedHub = lastMobileDelveHubVisible === false && hubVisible === true;
  lastMobileDelveHubVisible = hubVisible;
  if (!justRevealedHub || mobilePerfActive !== true) return;

  const pawnOwnerId = findFirstPawnOwnerId(state);
  const templeOwnerId = findHubStructureOwnerIdByDefId(state, "templeRuins");
  for (const ownerId of [pawnOwnerId, templeOwnerId]) {
    if (ownerId == null) continue;
    queueInventoryWindowRevealNearOwner(ownerId);
  }
}

function normalizeEventLogFocus(entry) {
  const data = entry?.data;
  if (!data || typeof data !== "object") return null;
  const focusKind = data.focusKind;

  if (focusKind === "pawn") {
    const pawnId = Number.isFinite(data.pawnId) ? Math.floor(data.pawnId) : null;
    if (pawnId == null) return null;
    const leaderPawnId = Number.isFinite(data.leaderPawnId)
      ? Math.floor(data.leaderPawnId)
      : pawnId;
    return {
      kind: "pawn",
      pawnId,
      ownerIds: [pawnId],
      leaderPawnId,
      openSkillTree: data.openSkillTree === true,
    };
  }

  if (focusKind === "hub") {
    const ownerId = data.ownerId ?? null;
    const hubCol = Number.isFinite(data.hubCol) ? Math.floor(data.hubCol) : null;
    return {
      kind: "hub",
      ownerId,
      ownerIds: ownerId != null ? [ownerId] : [],
      hubCol,
      systemId: typeof data.systemId === "string" ? data.systemId : "build",
    };
  }

  if (focusKind === "tile") {
    const envCol = Number.isFinite(data.envCol) ? Math.floor(data.envCol) : null;
    if (envCol == null) return null;
    return {
      kind: "tile",
      envCol,
      systemId: typeof data.systemId === "string" ? data.systemId : null,
    };
  }

  return null;
}

function handleEventLogSelection(entry) {
  if (!entry) {
    clearExternalUiFocus();
    return;
  }
  const focus = normalizeEventLogFocus(entry);
  setExternalUiFocus(focus);
  if (focus?.openSkillTree === true) {
    openSkillTreeForLeaderPawn(focus.leaderPawnId ?? focus.pawnId ?? null);
  }
}

function hasYearEndPerformanceData(entry) {
  return !!(
    entry?.data &&
    typeof entry.data === "object" &&
    entry.data.yearEndPerformance &&
    typeof entry.data.yearEndPerformance === "object"
  );
}

function getLatestYearEndEventAtSecond(state, tSec) {
  const targetSec = Math.max(0, Math.floor(tSec ?? 0));
  const feed = Array.isArray(state?.gameEventFeed) ? state.gameEventFeed : [];
  for (let i = feed.length - 1; i >= 0; i--) {
    const entry = feed[i];
    if (!entry || entry.type !== "populationYearlyUpdate") continue;
    const entrySec = Number.isFinite(entry.tSec) ? Math.floor(entry.tSec) : -1;
    if (entrySec !== targetSec) continue;
    if (!hasYearEndPerformanceData(entry)) continue;
    return {
      id: Number.isFinite(entry.id) ? Math.floor(entry.id) : null,
      tSec: entrySec,
      type: entry.type,
      text: typeof entry.text === "string" ? entry.text : "",
      data: entry.data,
    };
  }
  return null;
}

function handleYearEndPerformanceClose() {}

function toggleYearEndPerformanceFromEventLog(entry) {
  if (!hasYearEndPerformanceData(entry)) return;
  if (yearEndPerformanceView?.isOpenForEvent?.(entry.id)) {
    yearEndPerformanceView.close("eventLogToggle");
    return;
  }
  yearEndPerformanceView?.openForEntry?.(entry, { source: "eventLog" });
}

function isYearEndPerformanceOpenForEntry(entryId) {
  return yearEndPerformanceView?.isOpenForEvent?.(entryId) === true;
}

function syncYearEndPerformancePopup() {
  const state = runner.getState?.();
  if (!state) return;

  const previewing = runner.isPreviewing?.() ?? false;
  const tSec = Number.isFinite(state.tSec) ? Math.floor(state.tSec) : 0;
  const yearEndEntry = getLatestYearEndEventAtSecond(state, tSec);

  if (previewing) {
    if (yearEndPerformanceView?.isOpen?.()) {
      yearEndPerformanceView.close("scrub");
    }
    return;
  }

  if (!yearEndEntry || !Number.isFinite(yearEndEntry.id)) return;
  if (liveSeenYearEndEventIds.has(yearEndEntry.id)) return;
  liveSeenYearEndEventIds.add(yearEndEntry.id);
  yearEndPerformanceView?.openForEntry?.(yearEndEntry, { source: "live" });
}

function hasRunCompleteData(entry) {
  return !!(
    entry &&
    entry.type === "runComplete" &&
    entry.data &&
    typeof entry.data === "object"
  );
}

function getLatestRunCompleteEventAtOrBeforeSecond(state, tSec) {
  const targetSec = Math.max(0, Math.floor(tSec ?? 0));
  const feed = Array.isArray(state?.gameEventFeed) ? state.gameEventFeed : [];
  for (let i = feed.length - 1; i >= 0; i--) {
    const entry = feed[i];
    if (!hasRunCompleteData(entry)) continue;
    const entrySec = Number.isFinite(entry.tSec) ? Math.floor(entry.tSec) : -1;
    if (entrySec > targetSec) continue;
    return {
      id: Number.isFinite(entry.id) ? Math.floor(entry.id) : null,
      tSec: entrySec,
      type: entry.type,
      text: typeof entry.text === "string" ? entry.text : "",
      data: entry.data,
    };
  }
  return null;
}

function handleRunCompleteClose() {}

function syncRunCompletePopup() {
  const state = runner.getState?.();
  if (!state) return;

  const previewing = runner.isPreviewing?.() ?? false;
  const tSec = Number.isFinite(state.tSec) ? Math.floor(state.tSec) : 0;
  const runCompleteEntry = getLatestRunCompleteEventAtOrBeforeSecond(state, tSec);

  if (previewing) {
    if (runCompleteView?.isOpen?.()) {
      runCompleteView.close("scrub");
    }
    lastRunCompletePopupCursorKey = "";
    return;
  }

  if (!runCompleteEntry || !Number.isFinite(runCompleteEntry.id)) {
    lastRunCompletePopupCursorKey = "";
    return;
  }
  const cursorKey = `${runCompleteEntry.id}|${tSec}`;
  if (lastRunCompletePopupCursorKey === cursorKey) return;
  lastRunCompletePopupCursorKey = cursorKey;
  runCompleteView?.openForEntry?.(runCompleteEntry, { source: "live" });
}

const interactionController = createInteractionController({
  // Phase is derived from paused by policy.
  getPhase: () => runner.getCursorState().phase,
});
const uiOcclusionManager = createUiOcclusionManager();
interactionController.setWorldUiOcclusionResolver((point) =>
  uiOcclusionManager.isOccluded(point)
);

const systemGraphModel = createSystemGraphModel({
  interactionController,
  runner,
  createController: createTimeGraphController,
  forecastWorkerService,
});
const systemGraphController = systemGraphModel.controller;

const tooltipView = createTooltipView({
  app,
  layer: uiLayers.tooltipLayer,
  interaction: interactionController,
  layout: VIEW_LAYOUT.tooltip,
});
debugInspectorView = createDebugInspectorView({
  layer: uiLayers.fixedDebugLayer,
});

let inventoryView = null;
let processWidgetView = null;
const setApDragWarning = (active) => {
  actionLogView?.setApDragWarning?.(active);
};
inventoryView = createInventoryView({
  layer: uiLayers.inventoryLayer,
  hoverLayer: uiLayers.inventoryHoverLayer,
  modalLayer: uiLayers.fixedModalLayer,
  dragLayer: uiLayers.dragLayer,
  stage: app.stage,
  inputElement: app.view,
  layout: VIEW_LAYOUT.inventory,
  tooltipView,
  getOwnerLabel(ownerId) {
    const procId = parseProcessDropboxOwnerId(ownerId);
    if (procId) {
      return procId ? `Process ${procId} Dropbox` : "Process Dropbox";
    }
    const basketDropbox = parseBasketDropboxOwnerId(ownerId);
    if (basketDropbox?.ownerId != null) {
      const state = runner.getState();
      const pawn = state?.pawns?.find(
        (candidatePawn) =>
          String(candidatePawn?.id) === String(basketDropbox.ownerId)
      );
      const ownerLabel =
        pawn?.name || `Pawn ${String(basketDropbox.ownerId)}`;
      return `${ownerLabel} Basket Dropbox`;
    }
    const state = runner.getState();
    const hubSlot = state.hub.slots.find(
      (s) => s.structure && s.structure.instanceId === ownerId
    );
    if (hubSlot) {
      const structure = hubSlot.structure;
      const def = hubStructureDefs[structure.defId];
      return def?.name || def?.id || `Hub ${ownerId}`;
    }
    const envStructure = state?.board?.occ?.envStructure?.find?.(
      (structure) => structure?.instanceId === ownerId
    );
    if (envStructure) {
      const def = envStructureDefs[envStructure.defId];
      return def?.name || def?.id || `Structure ${ownerId}`;
    }
    const pawn = state.pawns.find((candidatePawn) => candidatePawn.id === ownerId);
    if (pawn) return pawn.name || `Pawn ${ownerId}`;
    return `Owner ${ownerId}`;
  },
  getInventoryForOwner(ownerId) {
    return runner.getState().ownerInventories[ownerId] || null;
  },
  getOwnerVisibility(ownerId) {
    return getInventoryOwnerVisibility(runner.getState(), ownerId);
  },
  canShowHoverUI: () => interactionController.canShowHoverUI(),
  getState: () => runner.getState(),
  getPreviewVersion: () => getMergedPreviewVersion(),
  getInventoryPreview: (ownerId) => getMergedInventoryPreview(ownerId),
  actionPlanner: previewPlanner,
  getItemTransferAffordability: (spec) =>
    actionPlanner?.getItemTransferAffordability?.(spec) ?? {
      ok: true,
      affordable: true,
    },
  getDropTargetOwnerAt: (pos) =>
    processWidgetView?.getDropTargetOwnerAtGlobalPos?.(pos) ??
    pawnsView?.getInventoryOwnerAtGlobalPos?.(pos) ??
    boardView?.getInventoryOwnerAtGlobalPos?.(pos) ??
    null,
  getProcessDropboxDragStatus: (spec) =>
    evaluateProcessDropboxDragStatus(runner.getState(), spec),
  setProcessDropboxDragAffordance: (ownerId, level) =>
    processWidgetView?.setDropboxDragAffordance?.(ownerId, level),
  clearProcessDropboxDragAffordance: (ownerId) =>
    processWidgetView?.clearDropboxDragAffordance?.(ownerId),
  flashDropTargetError: (ownerId) =>
    processWidgetView?.flashDropTargetError?.(ownerId) ?? false,
  setDragGhost: (spec) => actionLogView?.setDragGhost?.(spec),
  resolveDragGhost: (status) => actionLogView?.resolveDragGhost?.(status),
  getFocusIntent: () =>
    runner.isPreviewing?.() ? null : actionPlanner?.getFocusIntent?.() ?? null,
  getExternalFocusOwners: () => getExternalFocusOwners(),
  openSkillTree: ({ leaderPawnId, pawnId }) =>
    openSkillTreeForLeaderPawn(leaderPawnId ?? pawnId ?? null),
  onGhostClick: (intentId) => actionPlanner?.toggleFocus?.(intentId),
  hasItemTransferIntent: (itemId) =>
    actionPlanner?.hasItemTransferIntent?.(itemId) ?? false,
  equipItemToSlot: ({ fromOwnerId, toOwnerId, itemId, slotId }) =>
    queueActionWhenPaused(() =>
      dispatchPlayerEditAction(
        ActionKinds.EQUIP_ITEM,
        { fromOwnerId, toOwnerId, itemId, slotId },
        { apCost: 0 }
      )
    ),
  moveEquippedItemToInventory: ({
    fromOwnerId,
    toOwnerId,
    slotId,
    targetGX,
    targetGY,
  }) =>
    queueActionWhenPaused(() =>
      dispatchPlayerEditAction(
        ActionKinds.UNEQUIP_ITEM,
        { fromOwnerId, toOwnerId, slotId, targetGX, targetGY },
        { apCost: 0 }
      )
    ),
  moveEquippedItemToSlot: ({ fromOwnerId, toOwnerId, fromSlotId, toSlotId }) =>
    queueActionWhenPaused(() =>
      dispatchPlayerEditAction(
        ActionKinds.MOVE_EQUIPPED_ITEM,
        { fromOwnerId, toOwnerId, fromSlotId, toSlotId },
        { apCost: 0 }
      )
    ),
  depositItemToBasket: ({ fromOwnerId, toOwnerId, itemId, slotId }) =>
    queueActionWhenPaused(() =>
      dispatchPlayerEditAction(
        ActionKinds.DEPOSIT_ITEM_TO_BASKET,
        { fromOwnerId, toOwnerId, itemId, slotId },
        { apCost: 0 }
      )
    ),
  openBasketWidget: ({ ownerId }) =>
    processWidgetView?.showBasketWidgetForOwner?.(ownerId) ?? {
      ok: false,
      reason: "noProcessWidget",
    },
  moveItemBetweenOwners: (spec) =>
    queueActionWhenPaused(() => {
      const payload = {
        fromOwnerId: spec?.fromOwnerId,
        toOwnerId: spec?.toOwnerId,
        itemId: spec?.itemId,
        targetGX: spec?.targetGX,
        targetGY: spec?.targetGY,
      };
      if (
        (isAnyDropboxOwnerId(payload.fromOwnerId) ||
          isAnyDropboxOwnerId(payload.toOwnerId)) &&
        payload.fromOwnerId !== payload.toOwnerId
      ) {
        return dispatchPlayerEditAction(
          ActionKinds.PROCESS_DROPBOX_MOVE,
          {
            ...payload,
            viaProcessDropbox: spec?.viaProcessDropbox === true,
          },
          { apCost: 0 }
        );
      }
      if (payload.fromOwnerId === payload.toOwnerId) {
        return dispatchPlayerEditAction(
          ActionKinds.INVENTORY_MOVE,
          payload,
          { apCost: 0 }
        );
      }
      const state = runner.getState?.();
      if (
        runner.getCursorState?.()?.paused !== true ||
        !isBootVariantFlagEnabled("inventoryTransferPlannerEnabled") ||
        !isActionPointCostsEnabled(state)
      ) {
        return dispatchPlayerEditAction(
          ActionKinds.INVENTORY_MOVE,
          payload,
          { apCost: 0 }
        );
      }
      return actionPlanner?.setItemTransferIntent?.(payload) || {
        ok: false,
        reason: "noPlanner",
      };
    }),
  cancelItemTransfer: ({ itemId }) => {
    if (itemId == null) return { ok: false, reason: "noItemId" };
    const key = `item:${itemId}`;
    const res = actionPlanner?.removeIntent?.(key);
    return res || { ok: false, reason: "noPlanner" };
  },
  discardItemFromOwner: ({ ownerId, itemId }) =>
    queueActionWhenPaused(() =>
      dispatchPlayerEditAction(
        ActionKinds.INVENTORY_DISCARD,
        { ownerId, itemId },
        { apCost: 0 }
      )
    ),
  splitStackAndPlace: ({ ownerId, itemId, amount, targetGX, targetGY }) =>
    queueActionWhenPaused(() =>
      dispatchPlayerEditAction(
        ActionKinds.INVENTORY_SPLIT,
        { ownerId, itemId, amount, targetGX, targetGY },
        { apCost: 0 }
      )
    ),
  queueActionWhenPaused,
  adjustFollowerCount: ({ leaderId, delta }) =>
    queueActionWhenPaused(() => {
      const res = dispatchPlayerEditAction(
        ActionKinds.ADJUST_FOLLOWER_COUNT,
        { leaderId, delta },
        { apCost: 0 }
      );
      if (res?.result === "followerDespawnBlocked" && res.followerId != null) {
        revealInventoryWindowNearOwner(res.followerId, { pinned: true });
        inventoryView.flashWindowError?.(res.followerId);
      }
      if (leaderId != null) {
        inventoryView.rebuildWindow?.(leaderId);
      }
      return res;
    }),
  adjustWorkerCount: ({ leaderId, delta }) =>
    queueActionWhenPaused(() => {
      const res = dispatchPlayerEditAction(
        ActionKinds.ADJUST_WORKER_COUNT,
        { leaderId, delta },
        { apCost: 0 }
      );
      if (leaderId != null) {
        inventoryView.rebuildWindow?.(leaderId);
      }
      return res;
    }),
  requestPauseForAction,
  dispatchPlayerEditAction: (kind, payload, opts) =>
    dispatchPlayerEditAction(kind, payload, opts),
  dispatchPlayerEditBatch: (actions, opts) =>
    dispatchPlayerEditBatch(actions, opts),
  scheduleActionsAtNextSecond: (actions, opts) =>
    schedulePlayerActionsAtNextSecond(actions, opts),
  setApDragWarning,
  flashActionGhost: (spec, status) =>
    actionLogView?.flashGhost?.(spec, status),
  setBuildPlacementPreview: (preview) =>
    boardView?.setDistributorBuildPreview?.(preview),
  getOwnerAnchor: (ownerId) => resolveInventoryOwnerAnchor(ownerId),
  getExternalEquipmentSlotAt: (pos) =>
    pawnsView?.getEquipmentSlotAtGlobalPos?.(pos) ?? null,
  setWorldInventoryDragAffordances: (ownerAffordances) => {
    boardView?.setInventoryDragAffordances?.(ownerAffordances);
    pawnsView?.setInventoryDragAffordances?.(ownerAffordances);
  },
  onUseItem: (spec) => {
    const previewTransferRes = commitPreviewInventoryTransferForUse(spec);
    if (previewTransferRes?.ok === false) {
      return {
        handled: false,
        reason: previewTransferRes.reason || "previewTransferCommitFailed",
      };
    }

    const useResult = queueActionWhenPaused(() =>
      dispatchPlayerEditAction(
        ActionKinds.INVENTORY_USE_ITEM,
        {
          ownerId: spec?.ownerId,
          itemId: spec?.itemId,
          sourceEquipmentSlotId: spec?.sourceEquipmentSlotId ?? null,
        },
        { apCost: 0 }
      )
    );

    const useHandled =
      useResult?.ok === true &&
      (useResult?.queued === true || useResult?.result === "itemUsed");
    if (useHandled) {
      if (useResult?.result === "itemUsed" && Number.isFinite(spec?.itemId)) {
        scrollGraphOrchestrator?.closeWindowForItemId?.(spec.itemId);
      }
      if (useResult?.queued === true) {
        const scrollUseResult = scrollGraphOrchestrator?.handleUseItem?.(spec);
        if (scrollUseResult?.handled === true) {
          return scrollUseResult;
        }
      }
      return { handled: true, result: useResult.result ?? "queued" };
    }

    const fallbackToScroll = useResult?.ok === false;
    if (fallbackToScroll) {
      const scrollUseResult = scrollGraphOrchestrator?.handleUseItem?.(spec);
      if (scrollUseResult?.handled === true) {
        return scrollUseResult;
      }
    }

    if (
      useResult?.ok === false &&
      useResult.reason === "noUsableEffect"
    ) {
      return { handled: false, reason: "noUsableEffect" };
    }
    return {
      handled: false,
      reason: useResult?.reason || "itemUseFailed",
    };
  },
  screenToWorld: (point) => playfieldCamera?.screenToWorld?.(point) ?? point,
});

function togglePause() {
  const paused = runner.getCursorState().paused;
  if (paused) {
    runner.setTimeScaleTarget?.(1, { unpause: true });
    runner.setPaused(false);
  } else {
    runner.setTimeScaleTarget?.(0, { requestPause: true });
    runner.setPaused(true);
  }
}

function clearActionLogAndReset() {
  pausedActionQueue.clearQueuedActions();
  return queueActionWhenPaused(
    () =>
      runner.clearPlannerActionsAtCursor?.() || {
        ok: false,
        reason: "noRunner",
      }
  );
}

playfieldShader = createPlayfieldMuchaStyle({
  layout: VIEW_LAYOUT.playfieldShader,
  getState: () => runner.getState(),
  getTimeline: () => runner.getTimeline(),
  getPreviewStatus: () => runner.getPreviewStatus?.(),
  getViewportSize: () => ({
    width: app.screen.width,
    height: app.screen.height,
  }),
  getPlayfieldCameraState: () => playfieldCamera?.getCameraState?.() ?? null,
  getPlayfieldWorldBounds: () => resolvePanBounds(PLAYFIELD_CAMERA_LAYOUT),
});
applyMobilePerformanceProfile();

backdropView = createBackdropView({
  app,
  layer: uiLayers.backgroundLayer,
  paintStyleController: playfieldShader,
});

let boardView = null;
let pawnsView = null;

function canStartGamepieceHoverZoomIn() {
  return (
    interactionController.canShowWorldHoverUI() &&
    !boardView?.hasActiveHoverZoomDown?.() &&
    !pawnsView?.hasActiveHoverZoomDown?.()
  );
}

boardView = createBoardView({
  app,
  tileLayer: uiLayers.tileLayer,
  eventLayer: uiLayers.eventLayer,
  envStructuresLayer: uiLayers.envStructuresLayer,
  hubStructuresLayer: uiLayers.hubStructuresLayer,
  hoverLayer: uiLayers.hoverLayer,
  inspectorLayer: uiLayers.cameraControlsLayer,
  getGameState: () => runner.getState(),
  interaction: interactionController,
  actionPlanner: previewPlanner,
  tooltipView,
  inventoryView,
  queueActionWhenPaused,
  requestPauseForAction,
  paintStyleController: playfieldShader,
  setApDragWarning,
  screenToWorld: (point) => playfieldCamera?.screenToWorld?.(point) ?? point,
  flashActionGhost: (spec, status) =>
    actionLogView?.flashGhost?.(spec, status),
  dispatchAction: (kind, payload, opts) =>
    dispatchPlayerEditAction(kind, payload, opts),
  onSystemIconHover: (view, systemId) => {
    const target = view?.structure ?? view?.tile ?? null;
    processWidgetView?.setHoverTarget?.(target, systemId);
  },
  onSystemIconOut: () => {
    processWidgetView?.clearHoverTarget?.();
  },
  onSystemIconClick: (view, systemId) => {
    const target = view?.structure ?? view?.tile ?? null;
    processWidgetView?.togglePinnedTarget?.(target, systemId);
  },
  onProcessCogClick: (view, systemId) => {
    const target = view?.structure ?? view?.tile ?? null;
    processWidgetView?.togglePinnedTarget?.(target, systemId);
  },
  onGamepieceTapForSystemFocus: (focus) => {
    focusSystemGraphFromGamepiece(focus);
  },
  getExternalFocus: () => getExternalUiFocus(),
  canStartHoverZoomIn: () => canStartGamepieceHoverZoomIn(),
});

pawnsView = createPawnsView({
  app,
  layer: uiLayers.pawnLayer,
  hoverLayer: uiLayers.hoverLayer,
  paintStyleController: playfieldShader,
  screenToWorld: (point) => playfieldCamera?.screenToWorld?.(point) ?? point,
  worldToScreen: (point) => playfieldCamera?.worldToScreen?.(point) ?? point,
  getPawns: () => runner.getState().pawns,
  getHubSlots: () => runner.getState().hub.slots,
  getGameState: () => runner.getState(),
  interaction: interactionController,
  tooltipView,
  inventoryView,
  requestPauseForAction,
  getFocusIntent: () =>
    runner.isPreviewing?.() ? null : actionPlanner?.getFocusIntent?.() ?? null,
  getExternalFocus: () => getExternalUiFocus(),
  getPawnMoveAffordability: (spec) =>
    actionPlanner?.getPawnMoveAffordability?.(spec) ?? {
      ok: true,
      affordable: true,
      cost: 0,
    },
  setDragGhost: (spec) => actionLogView?.setDragGhost?.(spec),
  resolveDragGhost: (status) => actionLogView?.resolveDragGhost?.(status),
  getPreviewHubCol: (pawnId) =>
    getMergedPawnOverridePlacement(pawnId)?.hubCol ?? null,
  getPreviewPlacement: (pawnId) => getMergedPawnOverridePlacement(pawnId),
  canStartHoverZoomIn: () => canStartGamepieceHoverZoomIn(),
  openSkillTree: ({ leaderPawnId, pawnId }) =>
    openSkillTreeForLeaderPawn(leaderPawnId ?? pawnId ?? null),
  onPawnDropped({ pawnId, dropPos }) {
    if (pawnId == null) return { ok: false, reason: "noPawnId" };
    const state = runner.getState();
    const worldDropPos = playfieldCamera?.screenToWorld?.(dropPos) ?? dropPos;
    const envCols = getVisibleEnvColCount(state);
    const hubCols = isHubVisible(state) && Array.isArray(state?.hub?.slots)
      ? state.hub.slots.length
      : 0;

    const tileCenterY = TILE_ROW_Y + TILE_HEIGHT / 2;
    const hubCenterY = HUB_STRUCTURE_ROW_Y + HUB_STRUCTURE_HEIGHT / 2;
    const distToTile = Math.abs(worldDropPos.y - tileCenterY);
    const distToHub = Math.abs(worldDropPos.y - hubCenterY);
    const targetRow = distToTile <= distToHub ? "env" : "hub";

    const colCount = targetRow === "env" ? envCols : hubCols;

    let bestIndex = null;
    let bestDist2 = Infinity;
    for (let col = 0; col < colCount; col++) {
      const cx =
        targetRow === "env"
          ? getBoardColumnCenterXForVisibleCols(app.screen.width, col, envCols)
          : getHubColumnCenterXForVisibleCols(app.screen.width, col, hubCols);
      const dx = worldDropPos.x - cx;
      const d2 = dx * dx;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestIndex = col;
      }
    }
    if (bestIndex == null) return;

    if (targetRow === "env") {
      return queueActionWhenPaused(
        {
          runWhenPaused: () =>
            actionPlanner?.setPawnMoveIntent?.({
              pawnId,
              toEnvCol: bestIndex,
            }) || { ok: false, reason: "noPlanner" },
          runWhenLive: () =>
            dispatchPlayerEditAction(
              ActionKinds.PLACE_PAWN,
              { pawnId, toEnvCol: bestIndex },
              { apCost: 0, reason: "pawnMoveLive" }
            ) || { ok: false, reason: "noRunner" },
        }
      );
    }

    return queueActionWhenPaused(
      {
        runWhenPaused: () =>
          actionPlanner?.setPawnMoveIntent?.({
            pawnId,
            toHubCol: bestIndex,
          }) || { ok: false, reason: "noPlanner" },
        runWhenLive: () =>
          dispatchPlayerEditAction(
            ActionKinds.PLACE_PAWN,
            { pawnId, toHubCol: bestIndex },
            { apCost: 0, reason: "pawnMoveLive" }
          ) || { ok: false, reason: "noRunner" },
      }
    );
  },
});

if (typeof globalThis !== "undefined") {
  globalThis.__UI_HOVER_DEBUG__ = {
    getTooltipState: () => tooltipView?.getDebugState?.() ?? null,
    getInventoryState: () => inventoryView?.getDebugState?.() ?? null,
    getPawnState: () => pawnsView?.getDebugState?.() ?? null,
  };
}

processWidgetView = createProcessWidgetView({
  app,
  layer: pickHudLayer(
    "processWidget",
    uiLayers.cameraControlsLayer,
    uiLayers.fixedControlsLayer
  ),
  manualLayer: uiLayers.fixedModalLayer,
  layout: VIEW_LAYOUT.processWidget,
  getGameState: () => runner.getState(),
  interaction: interactionController,
  tooltipView,
  canShowHoverUI: () => interactionController.canShowHoverUI(),
  setHoverInventoryFocusOwners: (ownerIds) =>
    setProcessWidgetHoverFocusOwners(ownerIds),
  setHoverOwnerFocus: (focus) => setProcessWidgetHoverUiFocus(focus),
  actionPlanner: previewPlanner,
  dispatchAction: (kind, payload, opts) =>
    dispatchPlayerEditAction(kind, payload, opts),
  queueActionWhenPaused,
  requestPauseForAction,
  inventoryView,
  flashActionGhost: (spec, status) =>
    actionLogView?.flashGhost?.(spec, status),
  position: VIEW_LAYOUT.processWidget.position,
});

let systemGraphTargetMode = "hover";

let goldGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.cameraControlsLayer,
  controller: goldGraphController,
  runner,
  interaction: interactionController,
  tooltipView,
  metric: GRAPH_METRICS.gold,
  openPosition: VIEW_LAYOUT.graphs.gold,
});

let grainGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.cameraControlsLayer,
  controller: grainGraphController,
  runner,
  interaction: interactionController,
  tooltipView,
  metric: GRAPH_METRICS.grain,
  openPosition: VIEW_LAYOUT.graphs.grain,
});

let foodGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.cameraControlsLayer,
  controller: foodGraphController,
  runner,
  interaction: interactionController,
  tooltipView,
  metric: GRAPH_METRICS.food,
  openPosition: VIEW_LAYOUT.graphs.food,
});

let systemGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.cameraControlsLayer,
  controller: systemGraphController,
  runner,
  interaction: interactionController,
  tooltipView,
  getMetricDef: () => systemGraphController.getData().metric,
  openPosition: VIEW_LAYOUT.graphs.system,
  historyWindowSec: 600,
  getSystemTargetModeLabel: () => getSystemGraphTargetModeLabel(),
  onToggleSystemTargetMode: () => toggleSystemGraphTargetMode(),
});

let apGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.cameraControlsLayer,
  controller: apGraphController,
  runner,
  interaction: interactionController,
  tooltipView,
  metric: GRAPH_METRICS.ap,
  getSeriesValueOverride: (tSec, seriesId, _point, cursorSecRaw) => {
    if (seriesId !== "ap") return null;
    const currentSec = Number.isFinite(cursorSecRaw)
      ? Math.floor(cursorSecRaw)
      : Math.floor(runner.getCursorState()?.tSec ?? 0);
    if (tSec !== currentSec) return null;
    const preview = actionPlanner?.getApPreview?.();
    return preview ? preview.remaining : null;
  },
  openPosition: VIEW_LAYOUT.graphs.ap,
});

let popGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.cameraControlsLayer,
  controller: popGraphController,
  runner,
  interaction: interactionController,
  tooltipView,
  metric: GRAPH_METRICS.population,
  openPosition: VIEW_LAYOUT.graphs.population,
});

function getSystemGraphTargetModeLabel() {
  return systemGraphTargetMode === "click" ? "Target: Click" : "Target: Hover";
}

function parseSystemGraphSubjectKey(rawKey) {
  const key = typeof rawKey === "string" ? rawKey : "";
  if (!key.length) return null;
  const parts = key.split(":");
  if (parts.length < 2) return null;
  const kind = parts[0];
  const value = parts.slice(1).join(":");
  if (kind === "tile") {
    const col = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : null;
    return col == null ? null : { kind: "tile", col };
  }
  if (kind === "hub") {
    const col = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : null;
    return col == null ? null : { kind: "hub", col };
  }
  if (kind === "envStructure") {
    const col = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : null;
    return col == null ? null : { kind: "envStructure", col };
  }
  if (kind === "pawn") {
    const id = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : null;
    return id == null ? null : { kind: "pawn", id };
  }
  return null;
}

function getCurrentHoverSystemTarget() {
  const hover =
    interactionController.getHoveredPawn?.() ??
    interactionController.getHovered?.() ??
    interactionController.getLastHovered?.();
  if (!hover) return null;
  if (hover.kind === "tile") {
    const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
    return col == null ? null : { kind: "tile", col };
  }
  if (hover.kind === "hub") {
    const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
    return col == null ? null : { kind: "hub", col };
  }
  if (hover.kind === "envStructure") {
    const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
    return col == null ? null : { kind: "envStructure", col };
  }
  if (hover.kind === "pawn") {
    const id = Number.isFinite(hover.id) ? Math.floor(hover.id) : null;
    return id == null ? null : { kind: "pawn", id };
  }
  return null;
}

function lockSystemGraphToTarget(target, { forceOpen = false } = {}) {
  if (!target) return { ok: false, reason: "noTarget" };
  return systemGraphModel.toggleGraphForTarget(systemGraphView, target, {
    forceOpen,
  });
}

function lockSystemGraphToCurrentTarget({ forceOpen = false } = {}) {
  const subjectKey = systemGraphController.getData?.()?.subjectKey ?? null;
  const fromSubject = parseSystemGraphSubjectKey(subjectKey);
  const target = fromSubject || getCurrentHoverSystemTarget();
  if (!target) return { ok: false, reason: "noTarget" };
  return lockSystemGraphToTarget(target, { forceOpen });
}

function toggleSystemGraphTargetMode() {
  systemGraphTargetMode = systemGraphTargetMode === "click" ? "hover" : "click";
  if (!systemGraphView.isOpen?.()) return;
  if (systemGraphTargetMode === "hover") {
    systemGraphModel.toggleGraphForHover(systemGraphView, { forceOpen: true });
  } else {
    lockSystemGraphToCurrentTarget({ forceOpen: true });
  }
}

function focusSystemGraphFromGamepiece(focus) {
  if (systemGraphTargetMode !== "click") return;
  if (!systemGraphView.isOpen?.()) return;
  if (!focus || typeof focus !== "object") return;
  const kind = focus.kind;
  if (
    kind !== "tile" &&
    kind !== "hub" &&
    kind !== "envStructure" &&
    kind !== "pawn"
  ) {
    return;
  }
  if (kind === "tile") {
    const col = Number.isFinite(focus.col) ? Math.floor(focus.col) : null;
    if (col == null) return;
    lockSystemGraphToTarget({ kind: "tile", col }, { forceOpen: true });
    return;
  }
  if (kind === "hub") {
    const col = Number.isFinite(focus.col) ? Math.floor(focus.col) : null;
    if (col == null) return;
    lockSystemGraphToTarget({ kind: "hub", col }, { forceOpen: true });
    return;
  }
  if (kind === "envStructure") {
    const col = Number.isFinite(focus.col) ? Math.floor(focus.col) : null;
    if (col == null) return;
    lockSystemGraphToTarget({ kind: "envStructure", col }, { forceOpen: true });
    return;
  }
  const id = Number.isFinite(focus.id) ? Math.floor(focus.id) : null;
  if (id == null) return;
  lockSystemGraphToTarget({ kind: "pawn", id }, { forceOpen: true });
}

function openSystemGraphForHover() {
  let result =
    systemGraphTargetMode === "click"
      ? lockSystemGraphToCurrentTarget()
      : systemGraphModel.toggleGraphForHover(systemGraphView);
  if (result?.ok === false && systemGraphTargetMode === "click") {
    result = systemGraphModel.toggleGraphForHover(systemGraphView);
  }
  if (debugSystemGraphFullHistoryEditActive) {
    setDebugSystemGraphFullHistoryEditActive(false);
  }
  return result;
}

let debugSystemGraphFullHistoryEditActive = false;

function setDebugSystemGraphFullHistoryEditActive(nextActive) {
  const enabled = nextActive === true;
  if (debugSystemGraphFullHistoryEditActive === enabled) return;
  debugSystemGraphFullHistoryEditActive = enabled;
  runner.setFullHistoryEditOverride?.(enabled);
}

function getDebugSystemGraphWindowSpec() {
  const timeline = runner.getTimeline?.();
  const cursorState = runner.getCursorState?.();
  const graphData = systemGraphController.getData?.() ?? {};
  const historyEndSec = Math.max(0, Math.floor(timeline?.historyEndSec ?? 0));
  const cursorSec = Math.max(0, Math.floor(cursorState?.tSec ?? historyEndSec));
  const horizonSec = Math.max(0, Math.floor(graphData?.horizonSec ?? 1200));
  return {
    minSec: 0,
    maxSec: Math.max(1, historyEndSec + horizonSec),
    scrubSec: cursorSec,
    forceScrubToCursor: false,
  };
}

function getDebugSystemGraphCommitDecision({
  scrubSec,
  historyEndSec,
} = {}) {
  const sec = Math.max(0, Math.floor(scrubSec ?? 0));
  const historyEnd = Math.max(0, Math.floor(historyEndSec ?? 0));
  if (sec > historyEnd) {
    return { allow: false, reason: "Forecast is preview-only" };
  }
  return { allow: true };
}

function getDebugSystemGraphHistoryZones({
  minSec,
  maxSec,
  historyEndSec,
} = {}) {
  const min = Math.max(0, Math.floor(minSec ?? 0));
  const max = Math.max(min, Math.floor(maxSec ?? min));
  const historyEnd = Math.max(0, Math.floor(historyEndSec ?? 0));
  const realizedEnd = Math.min(max, historyEnd);
  if (realizedEnd <= min) return [];
  return [{ kind: "editableHistory", startSec: min, endSec: realizedEnd }];
}

function applyDebugSystemGraphPolicy() {
  systemGraphView.setWindowSpecResolver?.(() => getDebugSystemGraphWindowSpec());
  systemGraphView.setCommitPolicyResolver?.((commitSpec) =>
    getDebugSystemGraphCommitDecision(commitSpec)
  );
  systemGraphView.setHistoryZoneResolver?.((zoneSpec) =>
    getDebugSystemGraphHistoryZones(zoneSpec)
  );
}

function openSystemGraphFromDebug() {
  applyDebugSystemGraphPolicy();
  let result =
    systemGraphTargetMode === "click"
      ? lockSystemGraphToCurrentTarget()
      : systemGraphModel.toggleGraphForHover(systemGraphView);
  if (result?.ok === false && systemGraphTargetMode === "click") {
    result = systemGraphModel.toggleGraphForHover(systemGraphView);
  }
  const opened = !!result?.opened && systemGraphView.isOpen?.() === true;
  setDebugSystemGraphFullHistoryEditActive(opened);
  return result;
}

function toggleApGraph() {
  if (apGraphView.isOpen()) {
    apGraphView.close();
    return { ok: true, closed: true };
  }
  apGraphView.open();
  return { ok: true, opened: true };
}

scrollGraphOrchestrator = createScrollGraphOrchestrator({
  runner,
  interactionController,
  createMetricController: createTimeGraphController,
  createSystemGraphModel,
  forecastWorkerService,
  buildGraphView: ({ controller, metric, getMetricDef, openPosition }) => {
    const spec = {
      createMetricGraphView,
      app,
      layer: uiLayers.cameraControlsLayer,
      controller,
      runner,
      interaction: interactionController,
      tooltipView,
      openPosition,
    };
    if (metric) spec.metric = metric;
    if (typeof getMetricDef === "function") {
      spec.getMetricDef = getMetricDef;
      spec.historyWindowSec = 600;
    }
    return createRunnerMetricGraph(spec);
  },
  scrollWindowBasePosition: VIEW_LAYOUT.graphs.systemScrollBase,
  onBeforeOpenGraphItem: ({ ownerId, itemId }) =>
    dispatchPlayerAction(ActionKinds.INVENTORY_OPEN_GRAPH_ITEM, {
      ownerId,
      itemId,
    }),
});

const chromeView = createChromeView({
  app,
  layer: pickHudLayer(
    "headerBar",
    uiLayers.cameraControlsLayer,
    uiLayers.fixedControlsLayer
  ),
  getGameState: () => runner.getState(),
  paintStyleController: playfieldShader,
  isVisible: (state) =>
    hasSkillFeatureUnlock(state, "ui.chrome.yearTracker"),
});

// NEW: Sun/Moon rotating disks HUD view
const sunMoonDisksView = createSunAndMoonDisksView({
  app,
  layer: pickHudLayer(
    "sunMoonDisks",
    uiLayers.cameraControlsLayer,
    uiLayers.fixedControlsLayer
  ),
  getState: () => runner.getState(),
  getDiskVisibility: (state) => ({
    moon: hasSkillFeatureUnlock(state, "ui.disk.moon"),
    season: hasSkillFeatureUnlock(state, "ui.disk.season"),
  }),
  getTimeline: () => runner.getTimeline(),
  getEditableHistoryBounds: () => runner.getEditableHistoryBounds?.(),
  browseCursorSecond: (tSec) => runner.browseCursorSecond?.(tSec),
  commitCursorSecond: (tSec) => runner.commitCursorSecond?.(tSec),
  requestPauseBeforeDrag: () => pauseForDiskScrub(),
  layout: SUN_AND_MOON_DISKS_LAYOUT,
});

const timeControlsView = createTimeControlsView({
  app,
  layer: pickHudLayer(
    "timeControls",
    uiLayers.cameraControlsLayer,
    uiLayers.fixedControlsLayer
  ),
  getGameState: () => runner.getState(),
  togglePause,
  isPausePending: () => runner.isPausePending?.() ?? false,
  getCommitPreviewState: () => {
    const preview = runner.getPreviewStatus?.();
    return {
      visible: !!preview?.isForecastPreview,
      enabled: !!preview?.isForecastPreview,
      targetSec: Number.isFinite(preview?.previewSec)
        ? Math.floor(preview.previewSec)
        : null,
    };
  },
  onCommitPreview: () => runner.commitPreviewToLive?.(),
  getReturnToPresentState: () => {
    const preview = runner.getPreviewStatus?.();
    if (preview?.isForecastPreview) {
      return { visible: false, enabled: false, targetSec: null };
    }

    const timeline = runner.getTimeline?.();
    const cursorState = runner.getCursorState?.();
    const bounds = runner.getEditableHistoryBounds?.();
    const historyEndSec = Math.max(
      0,
      Math.floor(timeline?.historyEndSec ?? 0)
    );
    const minEditableSec = Number.isFinite(bounds?.minEditableSec)
      ? Math.max(0, Math.floor(bounds.minEditableSec))
      : 0;
    const viewSec =
      preview?.active && Number.isFinite(preview?.previewSec)
        ? Math.max(0, Math.floor(preview.previewSec))
        : Math.max(0, Math.floor(cursorState?.tSec ?? 0));
    const visible = viewSec < minEditableSec && historyEndSec > viewSec;
    return {
      visible,
      enabled: visible,
      targetSec: historyEndSec,
    };
  },
  onReturnToPresent: (targetSec) => {
    const timeline = runner.getTimeline?.();
    const fallbackSec = Math.max(
      0,
      Math.floor(timeline?.historyEndSec ?? 0)
    );
    const resolvedSec = Number.isFinite(targetSec)
      ? Math.max(0, Math.floor(targetSec))
      : fallbackSec;
    return runner.commitCursorSecond?.(resolvedSec);
  },
  getTimeScale: () => runner.getTimeScale?.(),
  setTimeScaleTarget: (speed, opts) => runner.setTimeScaleTarget?.(speed, opts),
  layout: TIME_CONTROLS_LAYOUT,
  sunMoonLayout: SUN_AND_MOON_DISKS_LAYOUT,
});

const envEventDeckView = createEnvEventDeckView({
  app,
  layer: pickHudLayer(
    "envEventDeck",
    uiLayers.cameraControlsLayer,
    uiLayers.fixedControlsLayer
  ),
  getState: () => runner.getState(),
  getDeckVisibilityEnabled: (state) =>
    hasSkillFeatureUnlock(state, "ui.deck.event"),
  getSeasonalColoringEnabled: (state) =>
    hasSkillFeatureUnlock(state, "ui.deck.seasonalColors"),
  getTimeline: () => runner.getTimeline(),
  getStateDataAtSecond: (tSec) => {
    const tl = runner.getTimeline?.();
    if (!tl) return null;
    const res = getStateDataAtSecond(tl, tSec);
    return res?.ok ? res.stateData : null;
  },
  layout: ENV_EVENT_DECK_LAYOUT,
  sunMoonLayout: SUN_AND_MOON_DISKS_LAYOUT,
});

function getFullscreenElement() {
  return (
    document?.fullscreenElement ||
    document?.webkitFullscreenElement ||
    document?.msFullscreenElement ||
    null
  );
}

function isFullscreenActive() {
  return !!getFullscreenElement();
}

function isFullscreenSupported() {
  const rootEl = document?.documentElement;
  const canRequest = !!(
    rootEl?.requestFullscreen ||
    rootEl?.webkitRequestFullscreen ||
    rootEl?.msRequestFullscreen
  );
  const canExit = !!(
    document?.exitFullscreen ||
    document?.webkitExitFullscreen ||
    document?.msExitFullscreen
  );
  return canRequest && canExit;
}

async function toggleFullscreen() {
  const rootEl = document?.documentElement;
  if (!rootEl || !isFullscreenSupported()) return { ok: false, reason: "unsupported" };

  try {
    if (isFullscreenActive()) {
      const exitFn =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.msExitFullscreen;
      if (!exitFn) return { ok: false, reason: "unsupported" };
      await exitFn.call(document);
      return { ok: true, active: false };
    }

    const requestFn =
      rootEl.requestFullscreen ||
      rootEl.webkitRequestFullscreen ||
      rootEl.msRequestFullscreen;
    if (!requestFn) return { ok: false, reason: "unsupported" };

    try {
      await requestFn.call(rootEl, { navigationUI: "hide" });
    } catch (_) {
      await requestFn.call(rootEl);
    }
    return { ok: true, active: true };
  } catch (err) {
    return {
      ok: false,
      reason: typeof err?.message === "string" ? err.message : "failed",
    };
  }
}

const debugView = createDebugOverlay({
  app,
  layer: pickHudLayer(
    "debugOverlay",
    uiLayers.cameraControlsLayer,
    uiLayers.fixedDebugLayer
  ),
  layout: VIEW_LAYOUT.debugOverlay,
  runner,
  onLoadScenario: (setupId) => {
    pausedActionQueue.clearQueuedActions();
    const res = runner.resetToSetup?.(setupId);
    if (!res?.ok) return res;
    externalUiFocus = null;
    processWidgetHoverFocusOwners = [];
    processWidgetHoverUiFocus = null;
    applyScenarioDevUiBootstrap();
    return res;
  },
  onOpenSystemGraph: () => openSystemGraphFromDebug(),
  onToggleApGraph: () => toggleApGraph(),
  onToggleAutoPauseOnPlayerAction: () =>
    setAutoPauseOnPlayerAction(!isAutoPauseOnPlayerActionEnabled?.()),
  getAutoPauseOnPlayerActionEnabled: () =>
    isAutoPauseOnPlayerActionEnabled?.() === true,
  onToggleFullscreen: () => {
    void toggleFullscreen();
  },
  isFullscreenAvailable: () => isFullscreenSupported(),
  getIsFullscreen: () => isFullscreenActive(),
  onClearTimeline: () => clearActionLogAndReset(),
  getProjectionParity: createProjectionParityProbe({
    runner,
    controller: apGraphController,
  }),
  getPerfSnapshot: () =>
    getPerfSnapshot({
      timeline: runner.getTimeline(),
      controllers: [
        goldGraphController,
        grainGraphController,
        foodGraphController,
        apGraphController,
        systemGraphController,
      ],
    }),
  onToggleRawInspector: () =>
    debugInspectorView?.setEnabled?.(!(debugInspectorView?.isEnabled?.() === true)),
  getRawInspectorEnabled: () => debugInspectorView?.isEnabled?.() === true,
  getHoverDiagnostics: () => ({
    tooltip: tooltipView?.getDebugState?.() ?? null,
    inventory: inventoryView?.getDebugState?.() ?? null,
    pawns: pawnsView?.getDebugState?.() ?? null,
  }),
});

if (isBootVariantFlagEnabled("actionLogEnabled")) {
  actionLogView = createActionLogView({
    app,
    layer: pickHudLayer(
      "actionLog",
      uiLayers.cameraControlsLayer,
      uiLayers.fixedControlsLayer
    ),
    getPlanner: () => previewPlanner,
    getTimeline: () => runner.getTimeline(),
    getCursorState: () => runner.getCursorState(),
    isPreviewing: () => runner.isPreviewing?.() ?? false,
    onJumpToSecond: (tSec) => runner.browseCursorSecond?.(tSec),
    onClearActions: () => clearActionLogAndReset(),
    position: VIEW_LAYOUT.logs.action,
    getOwnerLabel(ownerId) {
      const state = runner.getState();
      const hubSlot = state.hub.slots.find(
        (s) => s.structure && s.structure.instanceId === ownerId
      );
      if (hubSlot) {
        const structure = hubSlot.structure;
        const def = hubStructureDefs[structure.defId];
        return def?.name || def?.id || `Hub ${ownerId}`;
      }
      const pawn = state.pawns.find((candidatePawn) => candidatePawn.id === ownerId);
      if (pawn) return pawn.name || `Pawn ${ownerId}`;
      return `Owner ${ownerId}`;
    },
    getState: () => runner.getState(),
    getPendingActionRowSpecs: () =>
      liveActionOptimism?.getPendingActionRowSpecs?.() ?? [],
  });
} else {
  actionLogView = NOOP_ACTION_LOG_VIEW;
}

eventLogView = createEventLogView({
  layer: pickHudLayer(
    "eventLog",
    uiLayers.cameraControlsLayer,
    uiLayers.fixedControlsLayer
  ),
  getState: () => runner.getState(),
  isVisible: () =>
    hasSkillFeatureUnlock(runner.getState?.(), "ui.log.event"),
  onSelectEntry: (entry) => handleEventLogSelection(entry),
  onToggleYearEndPerformance: (entry) =>
    toggleYearEndPerformanceFromEventLog(entry),
  isYearEndPerformanceOpen: (entryId) =>
    isYearEndPerformanceOpenForEntry(entryId),
  position: VIEW_LAYOUT.logs.event,
});

yearEndPerformanceView = createYearEndPerformanceView({
  app,
  layer: uiLayers.fixedControlsLayer,
  onClose: handleYearEndPerformanceClose,
});

runCompleteView = createRunCompleteView({
  app,
  layer: uiLayers.fixedControlsLayer,
  onClose: handleRunCompleteClose,
});

skillTreeView = createSkillTreeView({
  app,
  layer: uiLayers.skillTreeLayer,
  runner,
  layout: VIEW_LAYOUT.skillTree,
  onOpenEditor: ({ treeId, defsInput }) => openSkillTreeEditorForTree({ treeId, defsInput }),
});

skillTreeEditorView = createSkillTreeEditorView({
  app,
  layer: uiLayers.skillTreeLayer,
  layout: VIEW_LAYOUT.skillTreeEditor,
});

function asOccludingRects(view) {
  if (!view) return [];
  if (typeof view.getOccludingScreenRects === "function") {
    return view.getOccludingScreenRects() || [];
  }
  if (typeof view.getScreenRect === "function") {
    const rect = view.getScreenRect();
    return rect ? [rect] : [];
  }
  return [];
}

for (const getRects of [
  () => asOccludingRects(boardView),
  () => asOccludingRects(pawnsView),
  () => asOccludingRects(inventoryView),
  () => asOccludingRects(processWidgetView),
  () => asOccludingRects(scrollGraphOrchestrator),
  () => asOccludingRects(goldGraphView),
  () => asOccludingRects(grainGraphView),
  () => asOccludingRects(foodGraphView),
  () => asOccludingRects(systemGraphView),
  () => asOccludingRects(apGraphView),
  () => asOccludingRects(popGraphView),
  () => asOccludingRects(chromeView),
  () => asOccludingRects(eventLogView),
  () => asOccludingRects(debugView),
  () => asOccludingRects(debugInspectorView),
  () => asOccludingRects(timeControlsView),
  () => asOccludingRects(sunMoonDisksView),
  () => asOccludingRects(envEventDeckView),
  () => asOccludingRects(actionLogView),
  () => asOccludingRects(yearEndPerformanceView),
  () => asOccludingRects(runCompleteView),
  () => asOccludingRects(skillTreeView),
  () => asOccludingRects(skillTreeEditorView),
]) {
  uiOcclusionManager.registerProvider(getRects);
}

playfieldCamera = createPlayfieldCamera({
  app,
  root: uiLayers.cameraRoot,
  layout: PLAYFIELD_CAMERA_LAYOUT,
  getFixedUiRects: () => {
    const rects = [];
    if (!isCameraMember("headerBar", false)) {
      const rect = chromeView?.getScreenRect?.();
      if (rect) rects.push(rect);
    }
    if (!isCameraMember("eventLog", false)) {
      const rect = eventLogView?.getScreenRect?.();
      if (rect) rects.push(rect);
    }
    if (!isCameraMember("debugOverlay", false)) {
      const rect = debugView?.getScreenRect?.();
      if (rect) rects.push(rect);
    }
    return rects;
  },
  canStartPan: () =>
    !interactionController?.isDragging?.() &&
    !boardView?.hasActiveDrag?.() &&
    !sunMoonDisksView?.isDragging?.(),
  canInteract: () => !mainUiHiddenBySkillTree,
});

flashActionLogAp = () => actionLogView.flashInsufficientAp?.();

runner.init();
interactionController.init();
tooltipView.init();
debugInspectorView.setEnabled(false);
inventoryView.init();
backdropView.init();
boardView.init();
pawnsView.init();
processWidgetView.init();
chromeView.init();
timeControlsView.init();
envEventDeckView.init();
sunMoonDisksView.init(); // NEW
actionLogView.init();
eventLogView.init();
yearEndPerformanceView.init();
runCompleteView.init();
applyScenarioDevUiBootstrap();
// Default-off for scroll-first UX; set __DBG_AUTO_OPEN_GRAPHS__ = true to opt in.
const devAutoOpenGraphs = globalThis?.__DBG_AUTO_OPEN_GRAPHS__ === true;
if (devAutoOpenGraphs) {
  apGraphView.open();
  systemGraphView.open();
}

function isTypingTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    target.isContentEditable === true
  );
}

function handleGlobalKeyDown(ev) {
  if (!ev) return;
  if (ev.repeat) return;
  if (isTypingTarget(ev.target)) return;
  const code = ev.code || "";
  const key = ev.key || "";
  if (code === "Space" || key === " ") {
    ev.preventDefault();
    togglePause();
  }
}

window.addEventListener("keydown", handleGlobalKeyDown);

app.ticker.add((delta) => {
  const perfOn = perfEnabled();
  const perfFrameStart = perfOn ? perfNowMs() : 0;
  const runTimed = (id, fn) => {
    if (!perfOn) {
      fn();
      return;
    }
    const start = perfNowMs();
    fn();
    recordViewUpdate(id, perfNowMs() - start);
  };

  const frameDt = delta / 60;
  runTimed("runner.update", () => runner.update(frameDt));
  runTimed("mobileDelveInventory.sync", () => syncMobileDelveInventoryAutoOpen());
  runTimed("skillTree.pauseOpen", () => flushPendingSkillTreeOpen());
  runTimed("liveActionOptimism.update", () => liveActionOptimism?.update?.());
  runTimed("playfieldShader.update", () => playfieldShader.update());
  runTimed("backdrop.update", () => backdropView.update(frameDt));
  runTimed("stateTint.update", () => updateStateTintOverlay(frameDt));
  runTimed("queuedActions.flush", () => flushQueuedActions());
  runTimed("interaction.update", () => interactionController.update(frameDt));
  runTimed("envEventDeck.update", () => envEventDeckView.update(frameDt));
  runTimed("board.update", () => boardView.update(frameDt));
  runTimed("pawns.update", () => pawnsView.update(frameDt));
  runTimed("inventoryAutoReveal.flush", () => flushPendingInventoryWindowReveals());
  runTimed("tooltip.update", () => tooltipView.update(frameDt));
  runTimed("debugInspector.sync", () =>
    debugInspectorView?.updateFromTooltipSpec?.(tooltipView.getActiveSpec?.() ?? null)
  );
  runTimed("inventory.update", () => inventoryView.update(frameDt));
  runTimed("processWidget.update", () => processWidgetView.update(frameDt));
  runTimed("chrome.update", () => chromeView.update(frameDt));
  runTimed("timeControls.update", () => timeControlsView.update(frameDt));
  runTimed("sunMoon.update", () => sunMoonDisksView.update(frameDt)); // NEW
  runTimed("actionLog.update", () => actionLogView.update(frameDt));
  runTimed("yearEnd.sync", () => syncYearEndPerformancePopup());
  runTimed("runComplete.sync", () => syncRunCompletePopup());
  runTimed("eventLog.update", () => eventLogView.update(frameDt));
  runTimed("yearEnd.update", () => yearEndPerformanceView.update(frameDt));
  runTimed("runComplete.update", () => runCompleteView.update(frameDt));
  runTimed("skillTree.update", () => skillTreeView?.update?.(frameDt));
  runTimed("skillTreeEditor.update", () => skillTreeEditorView?.update?.(frameDt));
  runTimed("scrollGraph.update", () => scrollGraphOrchestrator?.update?.());
  runTimed("debug.update", () => debugView.update());
  runTimed("debugInspector.update", () => debugInspectorView?.update?.());

  const anyMetricGraphOpen =
    goldGraphView.isOpen() ||
    grainGraphView.isOpen() ||
    foodGraphView.isOpen() ||
    apGraphView.isOpen() ||
    popGraphView.isOpen();
  goldGraphController.setActive?.(goldGraphView.isOpen());
  grainGraphController.setActive?.(grainGraphView.isOpen());
  foodGraphController.setActive?.(foodGraphView.isOpen());
  apGraphController.setActive?.(apGraphView.isOpen());
  popGraphController.setActive?.(popGraphView.isOpen());
  if (anyMetricGraphOpen) {
    if (goldGraphView.isOpen()) {
      runTimed("graph.gold.controllerUpdate", () => goldGraphController.update());
      runTimed("graph.gold.render", () => goldGraphView.render());
    }
    if (grainGraphView.isOpen()) {
      runTimed("graph.grain.controllerUpdate", () => grainGraphController.update());
      runTimed("graph.grain.render", () => grainGraphView.render());
    }
    if (foodGraphView.isOpen()) {
      runTimed("graph.food.controllerUpdate", () => foodGraphController.update());
      runTimed("graph.food.render", () => foodGraphView.render());
    }
    if (apGraphView.isOpen()) {
      runTimed("graph.ap.controllerUpdate", () => apGraphController.update());
      runTimed("graph.ap.render", () => apGraphView.render());
    }
    if (popGraphView.isOpen()) {
      runTimed("graph.pop.controllerUpdate", () => popGraphController.update());
      runTimed("graph.pop.render", () => popGraphView.render());
    }
  }

  const systemGraphOpen = systemGraphView.isOpen();
  if (!systemGraphOpen && debugSystemGraphFullHistoryEditActive) {
    setDebugSystemGraphFullHistoryEditActive(false);
  }
  systemGraphController.setActive?.(systemGraphOpen);
  if (systemGraphOpen) {
    systemGraphModel.refreshTargetThrottled(performance.now());
    runTimed("graph.system.controllerUpdate", () => systemGraphController.update());
    runTimed("graph.system.render", () => systemGraphView.render());
  }

  if (perfOn) {
    recordViewFrame(perfNowMs() - perfFrameStart);
  }
});

window.__DBG__ = {
  getAutoPauseOnPlayerActionEnabled: () =>
    isAutoPauseOnPlayerActionEnabled?.() === true,
  isLiveActionOptimismEnabled: () => isLiveActionOptimismEnabled(),
  getLiveActionOptimismState: () => {
    const state = runner.getCursorState?.();
    const ownerInventories =
      state?.ownerInventories && typeof state.ownerInventories === "object"
        ? state.ownerInventories
        : {};
    const inventoryPreviews = [];
    for (const ownerIdRaw of Object.keys(ownerInventories)) {
      const ownerIdNum = Number(ownerIdRaw);
      const ownerId = Number.isFinite(ownerIdNum) ? ownerIdNum : ownerIdRaw;
      const preview = liveActionOptimism?.getInventoryPreview?.(ownerId);
      const hiddenItemIds = Array.from(preview?.hiddenItemIds || []);
      const overlayItems = Array.isArray(preview?.overlayItems)
        ? preview.overlayItems.map((item) => ({
            id: item?.id ?? null,
            ownerId: item?.ownerId ?? null,
            sourceOwnerId: item?.sourceOwnerId ?? null,
            gridX: item?.gridX ?? null,
            gridY: item?.gridY ?? null,
            isGhost: item?.isGhost === true,
          }))
        : [];
      const ghostItems = Array.isArray(preview?.ghostItems)
        ? preview.ghostItems.map((item) => ({
            id: item?.id ?? null,
            ownerId: item?.ownerId ?? null,
            gridX: item?.gridX ?? null,
            gridY: item?.gridY ?? null,
            isGhost: item?.isGhost === true,
          }))
        : [];
      if (hiddenItemIds.length || overlayItems.length || ghostItems.length) {
        inventoryPreviews.push({
          ownerId,
          hiddenItemIds,
          overlayItems,
          ghostItems,
        });
      }
    }

    const pawnOverrides = Array.isArray(state?.pawns)
      ? state.pawns
          .map((pawn) => {
            const placement =
              liveActionOptimism?.getPawnOverridePlacement?.(pawn?.id) ?? null;
            if (!placement) return null;
            return {
              pawnId: pawn.id,
              envCol:
                Number.isFinite(placement?.envCol) ? placement.envCol : null,
              hubCol:
                Number.isFinite(placement?.hubCol) ? placement.hubCol : null,
            };
          })
          .filter(Boolean)
      : [];

    return {
      autoPauseOnPlayerAction:
        isAutoPauseOnPlayerActionEnabled?.() === true,
      enabled: isLiveActionOptimismEnabled(),
      version: liveActionOptimism?.getVersion?.() ?? 0,
      debug: liveActionOptimism?.getDebugState?.() ?? null,
      pendingRows: liveActionOptimism?.getPendingActionRowSpecs?.() ?? [],
      inventoryPreviews,
      pawnOverrides,
      paused: state?.paused === true,
      tSec: Math.floor(state?.tSec ?? 0),
    };
  },
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  commit: (b) => runner.commitCursorSecond(b),
  preview: (s) => runner.setPreviewState(s),
  clearPreview: () => {
    runner.clearPreviewState();
    return { ok: true, previewing: runner.isPreviewing?.() ?? false };
  },
  dispatch: (kind, payload) => runner.dispatchAction(kind, payload),
  setPlayfieldShaderEnabled: (nextEnabled) =>
    playfieldShader.setEnabled(nextEnabled),
  setPlayfieldShaderQuality: (nextQuality) =>
    playfieldShader.setQuality(nextQuality),
  getPlayfieldShaderState: () => playfieldShader.getState(),
  getLastPlannerCommitError: () =>
    runner.getLastPlannerCommitError?.() ?? null,
  perf: () =>
    getPerfSnapshot({
      timeline: runner.getTimeline(),
      controllers: [
        goldGraphController,
        grainGraphController,
        foodGraphController,
        apGraphController,
        systemGraphController,
      ],
    }),
  perfReset: () => {
    resetPerfCounters();
    return { ok: true };
  },
  perfTop: (n = 10, metric = "avgMs") => getTopViewUpdates(n, metric),
  test: runDeterminismSuite,
};

