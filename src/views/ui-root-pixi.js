// src/views/ui-root-pixi.js
import { getCurrentSeasonData } from "../model/game-model.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { ActionKinds } from "../model/actions.js";
import { setupDefs } from "../defs/gamesettings/scenarios-defs.js";
import { createSimRunner } from "../controllers/sim-runner.js";
import { createTimeGraphController } from "../model/timegraph-controller.js";
import { GRAPH_METRICS } from "../model/graph-metrics.js";
import { runDeterminismSuite } from "../model/tests/determinism.js";
import { createInteractionController } from "./interaction-controler-pixi.js";
import { createTooltipView } from "./tooltip-pixi.js";
import { createInventoryView } from "./inventory-pixi.js";
import { createPawnsView } from "./pawns-pixi.js";
import { createBoardView } from "./board-pixi.js";
import { createChromeView } from "./chrome-pixi.js";
import { createMetricGraphView } from "./timegraphs-pixi.js";
import { createProcessWidgetView } from "./process-widget-pixi.js";
import { createSkillTreeView } from "./skill-tree-pixi.js";
import { createSkillTreeEditorView } from "./skill-tree-editor-pixi.js";
import {
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
import {
  createSunAndMoonDisksView,
  SUN_AND_MOON_DISKS_LAYOUT,
} from "./sunandmoon-disks-pixi.js";
import {
  getPerfSnapshot,
  perfEnabled,
  perfNowMs,
  recordViewFrame,
  recordViewUpdate,
} from "../model/perf.js";
import { createProjectionParityProbe } from "./ui-root/projection-parity.js";
import { createPausedActionQueue } from "./ui-root/paused-action-queue.js";
import { createSystemGraphModel } from "./ui-root/system-graph-model.js";
import { createRunnerMetricGraph } from "./ui-root/graph-view-builders.js";
import { createScrollGraphOrchestrator } from "./ui-root/scroll-graph-orchestrator.js";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const BOOT_SETUP_ID = "testing";
if (
  typeof globalThis !== "undefined" &&
  globalThis.__PERF_ENABLED__ == null
) {
  globalThis.__PERF_ENABLED__ = true;
}

export const app = new PIXI.Application({
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  backgroundColor: 0x57514b,
  antialias: true,
});

document.body.appendChild(app.view);

let flashActionLogAp = null;
let actionLogView = null;
let eventLogView = null;
let yearEndPerformanceView = null;
let externalUiFocus = null;
let skillTreeView = null;
let skillTreeEditorView = null;
let mainUiHiddenBySkillTree = false;
let stateTintOverlay = null;
let lastStateTintKey = "__init__";
const liveSeenYearEndEventIds = new Set();
const FULL_VIEW_REBUILD_REASONS = new Set([
  "init",
  "saveLoad",
  "plannerClear",
]);

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
    chromeView.refresh?.();
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
  const scale = Math.min(
    window.innerWidth / DESIGN_WIDTH,
    window.innerHeight / DESIGN_HEIGHT
  );
  const cssWidth = DESIGN_WIDTH * scale;
  const cssHeight = DESIGN_HEIGHT * scale;
  const left = (window.innerWidth - cssWidth) / 2;
  const top = (window.innerHeight - cssHeight) / 2;
  const view = app.view;
  view.style.width = `${cssWidth}px`;
  view.style.height = `${cssHeight}px`;
  view.style.position = "absolute";
  view.style.left = `${left}px`;
  view.style.top = `${top}px`;
  document.body.style.backgroundColor = "black";
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.documentElement.style.backgroundColor = "black";
  document.documentElement.style.height = "100%";
  skillTreeView?.resize?.();
  skillTreeEditorView?.resize?.();
  yearEndPerformanceView?.resize?.();
  if (stateTintOverlay) {
    redrawStateTintOverlayBounds();
  }
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const uiLayers = {
  tileLayer: new PIXI.Container(),
  eventLayer: new PIXI.Container(),
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
  uiLayers.tileLayer,
  uiLayers.eventLayer,
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

  // Live frontier is un-tinted.
  if (sec >= historyEndSec) return null;

  const bounds = runner.getEditableHistoryBounds?.();
  const minEditableSec = Number.isFinite(bounds?.minEditableSec)
    ? Math.max(0, Math.floor(bounds.minEditableSec))
    : 0;
  if (sec < minEditableSec) return "fixedHistory";
  return "editableHistory";
}

function updateStateTintOverlay() {
  const key = resolveTimeStateKey();
  if (key === lastStateTintKey) return;
  lastStateTintKey = key;
  if (!key) {
    stateTintOverlay.visible = false;
    return;
  }
  const color = TIME_STATE_COLORS[key];
  stateTintOverlay.visible = true;
  stateTintOverlay.tint = Number.isFinite(color) ? color : 0xffffff;
  stateTintOverlay.alpha = TIME_STATE_FILTER_ALPHA;
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
  uiLayers.tileLayer.visible = visible;
  uiLayers.eventLayer.visible = visible;
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
  layer: uiLayers.tooltipLayer,
  interaction: interactionController,
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
  onUseItem: (spec) =>
    scrollGraphOrchestrator?.handleUseItem?.(spec) ?? {
      handled: false,
      reason: "noScrollGraphOrchestrator",
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

const boardView = createBoardView({
  app,
  tileLayer: uiLayers.tileLayer,
  eventLayer: uiLayers.eventLayer,
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
});

let goldGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.controlsLayer,
  controller: goldGraphController,
  runner,
  metric: GRAPH_METRICS.gold,
  openPosition: { x: 350, y: 280 },
});

let grainGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.controlsLayer,
  controller: grainGraphController,
  runner,
  metric: GRAPH_METRICS.grain,
  openPosition: { x: 350, y: 370 },
});

let foodGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.controlsLayer,
  controller: foodGraphController,
  runner,
  metric: GRAPH_METRICS.food,
  openPosition: { x: 350, y: 460 },
});

let systemGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.controlsLayer,
  controller: systemGraphController,
  runner,
  getMetricDef: () => systemGraphController.getData().metric,
  openPosition: { x: 350, y: 220 },
  historyWindowSec: 600,
});

let apGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.controlsLayer,
  controller: apGraphController,
  runner,
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
  openPosition: { x: 350, y: 80 },
});

let popGraphView = createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer: uiLayers.controlsLayer,
  controller: popGraphController,
  runner,
  metric: GRAPH_METRICS.population,
  openPosition: { x: 350, y: 640 },
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
  getCurrentSeasonData,
  getApPreview: () => actionPlanner?.getApPreview?.() ?? null,
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
  getTimeScale: () => runner.getTimeScale?.(),
  setTimeScaleTarget: (speed, opts) => runner.setTimeScaleTarget?.(speed, opts),
});

// NEW: Sun/Moon rotating disks HUD view
const sunMoonDisksView = createSunAndMoonDisksView({
  layer: uiLayers.controlsLayer,
  getState: () => runner.getState(), 
  layout: SUN_AND_MOON_DISKS_LAYOUT,
});

const debugView = createDebugOverlay({
  layer: uiLayers.debugLayer,
  runner,
  onOpenSystemGraph: () => openSystemGraphForHover(),
  onToggleApGraph: () => toggleApGraph(),
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

actionLogView = createActionLogView({
  app,
  layer: uiLayers.controlsLayer,
  getPlanner: () => actionPlanner,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  isPreviewing: () => runner.isPreviewing?.() ?? false,
  onJumpToSecond: (tSec) => runner.browseCursorSecond?.(tSec),
  onClearActions: () => clearActionLogAndReset(),
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

eventLogView = createEventLogView({
  layer: uiLayers.controlsLayer,
  getState: () => runner.getState(),
  onSelectEntry: (entry) => handleEventLogSelection(entry),
  onToggleYearEndPerformance: (entry) =>
    toggleYearEndPerformanceFromEventLog(entry),
  isYearEndPerformanceOpen: (entryId) =>
    isYearEndPerformanceOpenForEntry(entryId),
  position: { x: 20, y: 180 },
});

yearEndPerformanceView = createYearEndPerformanceView({
  app,
  layer: uiLayers.controlsLayer,
  onClose: handleYearEndPerformanceClose,
});

skillTreeView = createSkillTreeView({
  app,
  layer: uiLayers.skillTreeLayer,
  runner,
  onOpenEditor: ({ treeId, defsInput }) => openSkillTreeEditorForTree({ treeId, defsInput }),
});

skillTreeEditorView = createSkillTreeEditorView({
  app,
  layer: uiLayers.skillTreeLayer,
});

flashActionLogAp = () => actionLogView.flashInsufficientAp?.();

runner.init();
interactionController.init();
tooltipView.init();
inventoryView.init();
boardView.init();
pawnsView.init();
processWidgetView.init();
chromeView.init();
sunMoonDisksView.init(); // NEW
actionLogView.init();
eventLogView.init();
yearEndPerformanceView.init();
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
    return;
  }
  if (code === "KeyZ" || key.toLowerCase() === "z") {
    ev.preventDefault();
    clearActionLogAndReset();
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
  runTimed("stateTint.update", () => updateStateTintOverlay());
  runTimed("queuedActions.flush", () => flushQueuedActions());
  runTimed("interaction.update", () => interactionController.update(frameDt));
  runTimed("board.update", () => boardView.update(frameDt));
  runTimed("pawns.update", () => pawnsView.update(frameDt));
  runTimed("tooltip.update", () => tooltipView.update(frameDt));
  runTimed("inventory.update", () => inventoryView.update(frameDt));
  runTimed("processWidget.update", () => processWidgetView.update(frameDt));
  runTimed("chrome.update", () => chromeView.update(frameDt));
  runTimed("sunMoon.update", () => sunMoonDisksView.update(frameDt)); // NEW
  runTimed("actionLog.update", () => actionLogView.update(frameDt));
  runTimed("yearEnd.sync", () => syncYearEndPerformancePopup());
  runTimed("eventLog.update", () => eventLogView.update(frameDt));
  runTimed("yearEnd.update", () => yearEndPerformanceView.update(frameDt));
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

