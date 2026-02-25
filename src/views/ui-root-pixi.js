// src/views/ui-root-pixi.js


// Scenario Selector - Options for boot are in scenario-defs.js

//const BOOT_SETUP_ID = "devGym01";
const BOOT_SETUP_ID = "devPlaytesting01";

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { ActionKinds } from "../model/actions.js";
import { setupDefs } from "../defs/gamesettings/scenarios-defs.js";
import { normalizeVariantFlags } from "../defs/gamesettings/variant-flags-defs.js";
import { createSimRunner } from "../controllers/sim-runner.js";
import { createTimeGraphController } from "../model/timegraph-controller.js";
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
  getBoardColumnCenterX,
  getHubColumnCenterX,
} from "./layout-pixi.js";
import { createDebugOverlay } from "./debug-overlay-pixi.js";
import { createActionLogView } from "./action-log-pixi.js";
import { createEventLogView } from "./event-log-pixi.js";
import { createYearEndPerformanceView } from "./year-end-performance-pixi.js";
import { createRunCompleteView } from "./run-complete-pixi.js";
import { createPlayfieldMuchaStyle } from "./playfield-mucha-style.js";
import { createBackdropView } from "./backdrop-pixi.js";
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
  perfEnabled,
  perfNowMs,
  recordViewFrame,
  recordViewUpdate,
} from "../model/perf.js";
import { hasAnyLeaderUnlockedSkillNode } from "../model/skills.js";
import { createProjectionParityProbe } from "./ui-root/projection-parity.js";
import { createPausedActionQueue } from "./ui-root/paused-action-queue.js";
import { createSystemGraphModel } from "./ui-root/system-graph-model.js";
import { createRunnerMetricGraph } from "./ui-root/graph-view-builders.js";
import { createScrollGraphOrchestrator } from "./ui-root/scroll-graph-orchestrator.js";
import { installGlobalTextStylePolicy } from "./ui-helpers/text-style-policy.js";

const BOOT_VARIANT_FLAGS = normalizeVariantFlags(
  setupDefs?.[BOOT_SETUP_ID]?.variantFlags
);

function isBootVariantFlagEnabled(flagId) {
  return BOOT_VARIANT_FLAGS?.[flagId] !== false;
}


if (
  typeof globalThis !== "undefined" &&
  globalThis.__PERF_ENABLED__ == null
) {
  globalThis.__PERF_ENABLED__ = true;
}

export const app = new PIXI.Application({
  width: VIEWPORT_DESIGN_WIDTH,
  height: VIEWPORT_DESIGN_HEIGHT,
  backgroundColor: 0x57514b,
  antialias: true,
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

let flashActionLogAp = null;
let actionLogView = null;
let eventLogView = null;
let yearEndPerformanceView = null;
let runCompleteView = null;
let backdropView = null;
let externalUiFocus = null;
let skillTreeView = null;
let skillTreeEditorView = null;
let mainUiHiddenBySkillTree = false;
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
const liveSeenYearEndEventIds = new Set();
const liveSeenRunCompleteEventIds = new Set();
const FULL_VIEW_REBUILD_REASONS = new Set([
  "init",
  "saveLoad",
  "plannerClear",
]);
const NOOP_ACTION_LOG_VIEW = {
  init() {},
  update() {},
  flashInsufficientAp() {},
  setApDragWarning() {},
  setDragGhost() {},
  resolveDragGhost() {},
  flashGhost() {},
};

const runner = createSimRunner({
  setupId: BOOT_SETUP_ID,
  onInvalidate: (reason) => {
    const cursorOnlyReason =
      reason === "scrubBrowse" || reason === "scrubCommit";
    // Keep cursor-only browse/commit lean; all other mutation reasons should
    // invalidate controllers immediately (including planner:* edits).
    if (cursorOnlyReason) return;
    goldGraphController.handleInvalidate(reason);
    grainGraphController.handleInvalidate(reason);
    foodGraphController.handleInvalidate(reason);
    apGraphController.handleInvalidate(reason);
    popGraphController.handleInvalidate(reason);
    systemGraphController.handleInvalidate(reason);
  },
  onRebuildViews: (reason = "unknown") => {
    tooltipView?.hide?.();
    if (reason === "scrubCommit") {
      refreshOpenInventoryWindows();
    }
    if (FULL_VIEW_REBUILD_REASONS.has(reason)) {
      refreshOpenInventoryWindows();
      boardView.rebuildAll();
      pawnsView.rebuildAll();
    }
    backdropView?.refresh?.();
    chromeView.refresh?.();
    timeControlsView.refresh?.();
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

const goldGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.gold,
});

const grainGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.grain,
});

const foodGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.food,
});

const apGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.ap,
});

const popGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.population,
});

function resizeCanvas() {
  fitCanvasToViewport(app.view);
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
  backgroundLayer: new PIXI.Container(),
  tileLayer: new PIXI.Container(),
  eventLayer: new PIXI.Container(),
  envStructuresLayer: new PIXI.Container(),
  hubStructuresLayer: new PIXI.Container(),
  pawnLayer: new PIXI.Container(),
  stateTintLayer: new PIXI.Container(),
  controlsLayer: new PIXI.Container(),
  hoverLayer: new PIXI.Container(),
  inventoryLayer: new PIXI.Container(),
  tooltipLayer: new PIXI.Container(),
  dragLayer: new PIXI.Container(),
  debugLayer: new PIXI.Container(),
  skillTreeLayer: new PIXI.Container(),
};

app.stage.eventMode = "static";
app.stage.hitArea = app.screen;
app.stage.addChild(
  uiLayers.backgroundLayer,
  uiLayers.tileLayer,
  uiLayers.eventLayer,
  uiLayers.envStructuresLayer,
  uiLayers.hubStructuresLayer,
  uiLayers.pawnLayer,
  uiLayers.stateTintLayer,
  uiLayers.controlsLayer,
  uiLayers.hoverLayer,
  uiLayers.inventoryLayer,
  uiLayers.tooltipLayer,
  uiLayers.dragLayer,
  uiLayers.debugLayer,
  uiLayers.skillTreeLayer
);

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

function resolveTimeStateKey() {
  const timeline = runner.getTimeline?.();
  const cursorState = runner.getCursorState?.();
  const preview = runner.getPreviewStatus?.();
  if (preview?.isForecastPreview) return "forecast";

  const historyEndSec = Math.max(0, Math.floor(timeline?.historyEndSec ?? 0));
  const cursorSec = Math.max(0, Math.floor(cursorState?.tSec ?? 0));
  const sec =
    preview?.active && Number.isFinite(preview?.previewSec)
      ? Math.max(0, Math.floor(preview.previewSec))
      : cursorSec;

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
      stateTintTargetR = rgb.r;
      stateTintTargetG = rgb.g;
      stateTintTargetB = rgb.b;
      stateTintTargetAlpha = TIME_STATE_FILTER_ALPHA;
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
  return externalUiFocus;
}

function getExternalFocusOwners() {
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
  uiLayers.backgroundLayer.visible = visible;
  uiLayers.tileLayer.visible = visible;
  uiLayers.eventLayer.visible = visible;
  uiLayers.envStructuresLayer.visible = visible;
  uiLayers.hubStructuresLayer.visible = visible;
  uiLayers.pawnLayer.visible = visible;
  uiLayers.controlsLayer.visible = visible;
  uiLayers.hoverLayer.visible = visible;
  uiLayers.inventoryLayer.visible = visible;
  uiLayers.tooltipLayer.visible = visible;
  uiLayers.dragLayer.visible = visible;
  uiLayers.debugLayer.visible = visible;
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

function openSkillTreeForLeaderPawn(leaderPawnId) {
  if (!skillTreeView) return { ok: false, reason: "noSkillTreeView" };
  if (skillTreeView.isOpen?.()) return { ok: false, reason: "alreadyOpen" };
  if (skillTreeEditorView?.isOpen?.()) return { ok: false, reason: "editorOpen" };
  if (!Number.isFinite(leaderPawnId)) {
    return { ok: false, reason: "badLeaderPawnId" };
  }

  requestPauseForAction();
  const openRes = skillTreeView.open({
    leaderPawnId: Math.floor(leaderPawnId),
    pawnId: Math.floor(leaderPawnId),
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
    inventoryView?.revealWindow?.(ownerId, { pinned: true });
    inventoryView?.rebuildWindow?.(ownerId);
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

function normalizeEventLogFocus(entry) {
  const data = entry?.data;
  if (!data || typeof data !== "object") return null;
  const focusKind = data.focusKind;

  if (focusKind === "pawn") {
    const pawnId = Number.isFinite(data.pawnId) ? Math.floor(data.pawnId) : null;
    if (pawnId == null) return null;
    return {
      kind: "pawn",
      pawnId,
      ownerIds: [pawnId],
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

function getLatestRunCompleteEventAtSecond(state, tSec) {
  const targetSec = Math.max(0, Math.floor(tSec ?? 0));
  const feed = Array.isArray(state?.gameEventFeed) ? state.gameEventFeed : [];
  for (let i = feed.length - 1; i >= 0; i--) {
    const entry = feed[i];
    if (!hasRunCompleteData(entry)) continue;
    const entrySec = Number.isFinite(entry.tSec) ? Math.floor(entry.tSec) : -1;
    if (entrySec !== targetSec) continue;
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
  const runCompleteEntry = getLatestRunCompleteEventAtSecond(state, tSec);

  if (previewing) {
    if (runCompleteView?.isOpen?.()) {
      runCompleteView.close("scrub");
    }
    return;
  }

  if (!runCompleteEntry || !Number.isFinite(runCompleteEntry.id)) return;
  if (liveSeenRunCompleteEventIds.has(runCompleteEntry.id)) return;
  liveSeenRunCompleteEventIds.add(runCompleteEntry.id);
  runCompleteView?.openForEntry?.(runCompleteEntry, { source: "live" });
}

const interactionController = createInteractionController({
  // Phase is derived from paused by policy.
  getPhase: () => runner.getCursorState().phase,
});

const systemGraphModel = createSystemGraphModel({
  interactionController,
  runner,
  createController: createTimeGraphController,
});
const systemGraphController = systemGraphModel.controller;

const tooltipView = createTooltipView({
  app,
  layer: uiLayers.tooltipLayer,
  interaction: interactionController,
  layout: VIEW_LAYOUT.tooltip,
});

let inventoryView = null;
let processWidgetView = null;
let scrollGraphOrchestrator = null;
const setApDragWarning = (active) => {
  actionLogView?.setApDragWarning?.(active);
};
inventoryView = createInventoryView({
  layer: uiLayers.inventoryLayer,
  dragLayer: uiLayers.dragLayer,
  layout: VIEW_LAYOUT.inventory,
  tooltipView,
  getOwnerLabel(ownerId) {
    if (typeof ownerId === "string" && ownerId.startsWith("inv:process:")) {
      const procId = ownerId.slice("inv:process:".length);
      return procId ? `Process ${procId}` : "Process Buffer";
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
    const pawn = state.pawns.find((candidatePawn) => candidatePawn.id === ownerId);
    if (pawn) return pawn.name || `Pawn ${ownerId}`;
    return `Owner ${ownerId}`;
  },
  getInventoryForOwner(ownerId) {
    return runner.getState().ownerInventories[ownerId] || null;
  },
  canShowHoverUI: () => interactionController.canShowHoverUI(),
  getState: () => runner.getState(),
  getPreviewVersion: () =>
    runner.isPreviewing?.() ? 0 : actionPlanner?.getVersion?.() ?? 0,
  getInventoryPreview: (ownerId) =>
    runner.isPreviewing?.()
      ? null
      : actionPlanner?.getInventoryPreview?.(ownerId) ?? null,
  actionPlanner,
  getItemTransferAffordability: (spec) =>
    actionPlanner?.getItemTransferAffordability?.(spec) ?? {
      ok: true,
      affordable: true,
    },
  getDropTargetOwnerAt: (pos) =>
    pawnsView?.getInventoryOwnerAtGlobalPos?.(pos) ??
    processWidgetView?.getDropTargetOwnerAtGlobalPos?.(pos) ??
    boardView?.getInventoryOwnerAtGlobalPos?.(pos) ??
    null,
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
      runner.dispatchAction(
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
      runner.dispatchAction(
        ActionKinds.UNEQUIP_ITEM,
        { fromOwnerId, toOwnerId, slotId, targetGX, targetGY },
        { apCost: 0 }
      )
    ),
  moveEquippedItemToSlot: ({ fromOwnerId, toOwnerId, fromSlotId, toSlotId }) =>
    queueActionWhenPaused(() =>
      runner.dispatchAction(
        ActionKinds.MOVE_EQUIPPED_ITEM,
        { fromOwnerId, toOwnerId, fromSlotId, toSlotId },
        { apCost: 0 }
      )
    ),
  depositItemToBasket: ({ fromOwnerId, toOwnerId, itemId, slotId }) =>
    queueActionWhenPaused(() =>
      runner.dispatchAction(
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
      const isProcessBuffer = (ownerId) =>
        typeof ownerId === "string" &&
        (ownerId.startsWith("inv:process:") || ownerId.startsWith("inv:dropbox:"));
      if (
        (isProcessBuffer(payload.fromOwnerId) || isProcessBuffer(payload.toOwnerId)) &&
        payload.fromOwnerId !== payload.toOwnerId
      ) {
        return runner.dispatchAction(
          ActionKinds.PROCESS_BUFFER_MOVE,
          {
            ...payload,
            viaProcessDropbox: spec?.viaProcessDropbox === true,
          },
          { apCost: 0 }
        );
      }
      if (payload.fromOwnerId === payload.toOwnerId) {
        return runner.dispatchAction(
          ActionKinds.INVENTORY_MOVE,
          payload,
          { apCost: 0 }
        );
      }
      if (!isBootVariantFlagEnabled("inventoryTransferPlannerEnabled")) {
        return runner.dispatchAction(
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
      runner.dispatchAction(
        ActionKinds.INVENTORY_DISCARD,
        { ownerId, itemId },
        { apCost: 0 }
      )
    ),
  splitStackAndPlace: ({ ownerId, itemId, amount, targetGX, targetGY }) =>
    queueActionWhenPaused(() =>
      runner.dispatchAction(
        ActionKinds.INVENTORY_SPLIT,
        { ownerId, itemId, amount, targetGX, targetGY },
        { apCost: 0 }
      )
    ),
  queueActionWhenPaused,
  adjustFollowerCount: ({ leaderId, delta }) =>
    queueActionWhenPaused(() => {
      const res = runner.dispatchAction(
        ActionKinds.ADJUST_FOLLOWER_COUNT,
        { leaderId, delta },
        { apCost: 0 }
      );
      if (res?.result === "followerDespawnBlocked" && res.followerId != null) {
        inventoryView.revealWindow?.(res.followerId, { pinned: true });
        inventoryView.flashWindowError?.(res.followerId);
        inventoryView.rebuildWindow?.(res.followerId);
      }
      if (leaderId != null) {
        inventoryView.rebuildWindow?.(leaderId);
      }
      return res;
    }),
  requestPauseForAction,
  setApDragWarning,
  flashActionGhost: (spec, status) =>
    actionLogView?.flashGhost?.(spec, status),
  setBuildPlacementPreview: (preview) =>
    boardView?.setDistributorBuildPreview?.(preview),
  onUseItem: (spec) => {
    const scrollUseResult = scrollGraphOrchestrator?.handleUseItem?.(spec);
    if (scrollUseResult?.handled === true) {
      return scrollUseResult;
    }

    const useResult = queueActionWhenPaused(() =>
      runner.dispatchAction(
        ActionKinds.INVENTORY_USE_ITEM,
        {
          ownerId: spec?.ownerId,
          itemId: spec?.itemId,
          sourceEquipmentSlotId: spec?.sourceEquipmentSlotId ?? null,
        },
        { apCost: 0 }
      )
    );

    if (
      useResult?.ok === true &&
      (useResult?.queued === true || useResult?.result === "itemUsed")
    ) {
      return { handled: true, result: useResult.result ?? "queued" };
    }
    if (useResult?.ok === false && useResult.reason === "noUsableEffect") {
      return { handled: false, reason: "noUsableEffect" };
    }
    return {
      handled: false,
      reason: useResult?.reason || scrollUseResult?.reason || "itemUseFailed",
    };
  },
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

const playfieldShader = createPlayfieldMuchaStyle({
  layout: VIEW_LAYOUT.playfieldShader,
  getState: () => runner.getState(),
  getTimeline: () => runner.getTimeline(),
  getPreviewStatus: () => runner.getPreviewStatus?.(),
  getViewportSize: () => ({
    width: app.screen.width,
    height: app.screen.height,
  }),
});

backdropView = createBackdropView({
  app,
  layer: uiLayers.backgroundLayer,
  paintStyleController: playfieldShader,
});

const boardView = createBoardView({
  app,
  tileLayer: uiLayers.tileLayer,
  eventLayer: uiLayers.eventLayer,
  envStructuresLayer: uiLayers.envStructuresLayer,
  hubStructuresLayer: uiLayers.hubStructuresLayer,
  hoverLayer: uiLayers.hoverLayer,
  inspectorLayer: uiLayers.controlsLayer,
  getGameState: () => runner.getState(),
  interaction: interactionController,
  actionPlanner,
  tooltipView,
  inventoryView,
  queueActionWhenPaused,
  requestPauseForAction,
  paintStyleController: playfieldShader,
  setApDragWarning,
  flashActionGhost: (spec, status) =>
    actionLogView?.flashGhost?.(spec, status),
  dispatchAction: (kind, payload, opts) =>
    runner.dispatchAction(kind, payload, opts),
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
  getExternalFocus: () => getExternalUiFocus(),
});

const pawnsView = createPawnsView({
  app,
  layer: uiLayers.pawnLayer,
  hoverLayer: uiLayers.hoverLayer,
  paintStyleController: playfieldShader,
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
    runner.isPreviewing?.()
      ? null
      : actionPlanner?.getPawnOverrideHubCol?.(pawnId) ?? null,
  getPreviewPlacement: (pawnId) =>
    runner.isPreviewing?.()
      ? null
      : actionPlanner?.getPawnOverridePlacement?.(pawnId) ?? null,
  onPawnDropped({ pawnId, dropPos }) {
    if (pawnId == null) return { ok: false, reason: "noPawnId" };
    const state = runner.getState();
    const envCols = Number.isFinite(state?.board?.cols)
      ? Math.floor(state.board.cols)
      : BOARD_COLS;
    const hubCols = Array.isArray(state?.hub?.slots)
      ? state.hub.slots.length
      : HUB_COLS;

    const tileCenterY = TILE_ROW_Y + TILE_HEIGHT / 2;
    const hubCenterY = HUB_STRUCTURE_ROW_Y + HUB_STRUCTURE_HEIGHT / 2;
    const distToTile = Math.abs(dropPos.y - tileCenterY);
    const distToHub = Math.abs(dropPos.y - hubCenterY);
    const targetRow = distToTile <= distToHub ? "env" : "hub";

    const colCount = targetRow === "env" ? envCols : hubCols;
    const getCenterX =
      targetRow === "env" ? getBoardColumnCenterX : getHubColumnCenterX;

    let bestIndex = null;
    let bestDist2 = Infinity;
    for (let col = 0; col < colCount; col++) {
      const cx = getCenterX(app.screen.width, col);
      const dx = dropPos.x - cx;
      const d2 = dx * dx;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestIndex = col;
      }
    }
    if (bestIndex == null) return;

    if (targetRow === "env") {
      return queueActionWhenPaused(
        () =>
          actionPlanner?.setPawnMoveIntent?.({
            pawnId,
            toEnvCol: bestIndex,
          }) || { ok: false, reason: "noPlanner" }
      );
    }

    return queueActionWhenPaused(
      () =>
        actionPlanner?.setPawnMoveIntent?.({
          pawnId,
          toHubCol: bestIndex,
        }) || { ok: false, reason: "noPlanner" }
    );
  },
});

processWidgetView = createProcessWidgetView({
  app,
  layer: uiLayers.controlsLayer,
  layout: VIEW_LAYOUT.processWidget,
  getGameState: () => runner.getState(),
  interaction: interactionController,
  actionPlanner,
  dispatchAction: (kind, payload, opts) =>
    runner.dispatchAction(kind, payload, opts),
  queueActionWhenPaused,
  requestPauseForAction,
  inventoryView,
  flashActionGhost: (spec, status) =>
    actionLogView?.flashGhost?.(spec, status),
  position: VIEW_LAYOUT.processWidget.position,
});

let goldGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.controlsLayer,
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
  layer: uiLayers.controlsLayer,
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
  layer: uiLayers.controlsLayer,
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
  layer: uiLayers.controlsLayer,
  controller: systemGraphController,
  runner,
  interaction: interactionController,
  tooltipView,
  getMetricDef: () => systemGraphController.getData().metric,
  openPosition: VIEW_LAYOUT.graphs.system,
  historyWindowSec: 600,
});

let apGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.controlsLayer,
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
  layer: uiLayers.controlsLayer,
  controller: popGraphController,
  runner,
  interaction: interactionController,
  tooltipView,
  metric: GRAPH_METRICS.population,
  openPosition: VIEW_LAYOUT.graphs.population,
});

function openSystemGraphForHover() {
  return systemGraphModel.toggleGraphForHover(systemGraphView);
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
  metricViewsBySubject: {
    population: popGraphView,
    grain: grainGraphView,
    food: foodGraphView,
  },
  metricControllersBySubject: {
    population: popGraphController,
    grain: grainGraphController,
    food: foodGraphController,
  },
  systemGraphView,
  systemGraphController,
  toggleSystemGraph: () => openSystemGraphForHover(),
});

const chromeView = createChromeView({
  app,
  layer: uiLayers.controlsLayer,
  getGameState: () => runner.getState(),
  paintStyleController: playfieldShader,
});

// NEW: Sun/Moon rotating disks HUD view
const sunMoonDisksView = createSunAndMoonDisksView({
  app,
  layer: uiLayers.controlsLayer,
  getState: () => runner.getState(),
  getTimeline: () => runner.getTimeline(),
  getEditableHistoryBounds: () => runner.getEditableHistoryBounds?.(),
  browseCursorSecond: (tSec) => runner.browseCursorSecond?.(tSec),
  commitCursorSecond: (tSec) => runner.commitCursorSecond?.(tSec),
  layout: SUN_AND_MOON_DISKS_LAYOUT,
});

const timeControlsView = createTimeControlsView({
  app,
  layer: uiLayers.controlsLayer,
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
  layer: uiLayers.controlsLayer,
  getState: () => runner.getState(),
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
  layer: uiLayers.debugLayer,
  layout: VIEW_LAYOUT.debugOverlay,
  runner,
  onLoadScenario: (setupId) => {
    pausedActionQueue.clearQueuedActions();
    const res = runner.resetToSetup?.(setupId);
    if (!res?.ok) return res;
    externalUiFocus = null;
    applyScenarioDevUiBootstrap();
    return res;
  },
  onOpenSystemGraph: () => openSystemGraphForHover(),
  onToggleApGraph: () => toggleApGraph(),
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
});

if (isBootVariantFlagEnabled("actionLogEnabled")) {
  actionLogView = createActionLogView({
    app,
    layer: uiLayers.controlsLayer,
    getPlanner: () => actionPlanner,
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
  });
} else {
  actionLogView = NOOP_ACTION_LOG_VIEW;
}

eventLogView = createEventLogView({
  layer: uiLayers.controlsLayer,
  getState: () => runner.getState(),
  isVisible: () =>
    hasAnyLeaderUnlockedSkillNode(runner.getState?.(), "Memory"),
  onSelectEntry: (entry) => handleEventLogSelection(entry),
  onToggleYearEndPerformance: (entry) =>
    toggleYearEndPerformanceFromEventLog(entry),
  isYearEndPerformanceOpen: (entryId) =>
    isYearEndPerformanceOpenForEntry(entryId),
  position: VIEW_LAYOUT.logs.event,
});

yearEndPerformanceView = createYearEndPerformanceView({
  app,
  layer: uiLayers.controlsLayer,
  onClose: handleYearEndPerformanceClose,
});

runCompleteView = createRunCompleteView({
  app,
  layer: uiLayers.controlsLayer,
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

flashActionLogAp = () => actionLogView.flashInsufficientAp?.();

runner.init();
interactionController.init();
tooltipView.init();
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
  runTimed("playfieldShader.update", () => playfieldShader.update());
  runTimed("backdrop.update", () => backdropView.update(frameDt));
  runTimed("stateTint.update", () => updateStateTintOverlay(frameDt));
  runTimed("queuedActions.flush", () => flushQueuedActions());
  runTimed("interaction.update", () => interactionController.update(frameDt));
  runTimed("envEventDeck.update", () => envEventDeckView.update(frameDt));
  runTimed("board.update", () => boardView.update(frameDt));
  runTimed("pawns.update", () => pawnsView.update(frameDt));
  runTimed("tooltip.update", () => tooltipView.update(frameDt));
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
  test: runDeterminismSuite,
};

