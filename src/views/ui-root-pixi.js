// src/views/ui-root-pixi.js
import { getCurrentSeasonData } from "../model/game-model.js";
import { permanentDefs } from "../defs/gamepieces/gamepieces-defs.js";
import { ActionKinds } from "../model/actions.js";
import { createSimRunner } from "../controllers/sim-runner.js";
import { createTimeGraphController } from "../model/timegraph-controller.js";
import { GRAPH_METRICS } from "../model/graph-metrics.js";
import { runDeterminismSuite } from "../model/tests/determinism.js";
import { createInteractionController } from "./interaction-controler-pixi.js";
import { createTooltipView } from "./tooltip-pixi.js";
import { createInventoryView } from "./inventory-pixi.js";
import { createCharactersView } from "./characters-pixi.js";
import { createBoardView } from "./board-pixi.js";
import { createChromeView } from "./chrome-pixi.js";
import { createMetricGraphView } from "./timegraphs-pixi.js";
import {
  BOARD_COLS,
  HUB_COLS,
  PERM_HEIGHT,
  PERM_ROW_Y,
  TILE_HEIGHT,
  TILE_ROW_Y,
  getBoardColumnCenterX,
  getHubColumnCenterX,
} from "./layout-pixi.js";
import { createDebugOverlay } from "./debug-overlay-pixi.js";
import { createActionLogView } from "./action-log-pixi.js";
import {
  createSunAndMoonDisksView,
  SUN_AND_MOON_DISKS_LAYOUT,
} from "./sunandmoon-disks-pixi.js";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

export const app = new PIXI.Application({
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  backgroundColor: 0x57514b,
  antialias: true,
});

document.body.appendChild(app.view);

const runner = createSimRunner({
  onInvalidate: (reason) => {
    timeGraphController.handleInvalidate(reason);
    if (goldGraphView?.isOpen()) goldGraphView.render();
    if (foodGraphView?.isOpen()) foodGraphView.render();
    if (apGraphView?.isOpen()) apGraphView.render();
    // Force a check on inventory UI in case state changed
    inventoryView?.update?.();
  },
  onRebuildViews: () => {
    tooltipView?.hide?.();
    refreshOpenInventoryWindows();
    boardView.rebuildAll();
    charactersView.rebuildAll();
    chromeView.refresh?.();
  },
});

const actionPlanner = runner.getActionPlanner?.();

const timeGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.all,
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
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const uiLayers = {
  tileLayer: new PIXI.Container(),
  eventLayer: new PIXI.Container(),
  permanentsLayer: new PIXI.Container(),
  characterLayer: new PIXI.Container(),
  controlsLayer: new PIXI.Container(),
  hoverLayer: new PIXI.Container(),
  inventoryLayer: new PIXI.Container(),
  tooltipLayer: new PIXI.Container(),
  dragLayer: new PIXI.Container(),
  debugLayer: new PIXI.Container(),
};

app.stage.eventMode = "static";
app.stage.hitArea = app.screen;
app.stage.addChild(
  uiLayers.tileLayer,
  uiLayers.eventLayer,
  uiLayers.permanentsLayer,
  uiLayers.characterLayer,
  uiLayers.controlsLayer,
  uiLayers.hoverLayer,
  uiLayers.inventoryLayer,
  uiLayers.tooltipLayer,
  uiLayers.dragLayer,
  uiLayers.debugLayer
);

function refreshOpenInventoryWindows() {
  if (!inventoryView?.windows || !inventoryView?.rebuildWindow) return;
  for (const ownerId of inventoryView.windows.keys()) {
    inventoryView.rebuildWindow(ownerId);
  }
}

const interactionController = createInteractionController({
  // Phase is derived from paused by policy.
  getPhase: () => runner.getCursorState().phase,
});

const tooltipView = createTooltipView({
  layer: uiLayers.tooltipLayer,
  interaction: interactionController,
});

const inventoryView = createInventoryView({
  layer: uiLayers.inventoryLayer,
  dragLayer: uiLayers.dragLayer,
  tooltipView,
  getOwnerLabel(ownerId) {
    const state = runner.getState();
    const permSlot = state.permanentSlots.find(
      (s) => s.permanent && s.permanent.instanceId === ownerId
    );
    if (permSlot) {
      const perm = permSlot.permanent;
      const def = permanentDefs[perm.defId];
      return def?.name || def?.id || `Permanent ${ownerId}`;
    }
    const ch = state.characters.find((c) => c.id === ownerId);
    if (ch) return ch.name || `Char ${ownerId}`;
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
  getFocusIntent: () =>
    runner.isPreviewing?.() ? null : actionPlanner?.getFocusIntent?.() ?? null,
  onGhostClick: (intentId) => actionPlanner?.toggleFocus?.(intentId),
  hasItemTransferIntent: (itemId) =>
    actionPlanner?.hasItemTransferIntent?.(itemId) ?? false,
  moveItemBetweenOwners: (spec) => {
    if (spec.fromOwnerId === spec.toOwnerId) {
      return runner.dispatchAction(
        ActionKinds.INVENTORY_MOVE,
        spec,
        { apCost: 0 }
      );
    }
    return actionPlanner?.setItemTransferIntent?.(spec) || {
      ok: false,
      reason: "noPlanner",
    };
  },
  cancelItemTransfer: ({ itemId }) => {
    if (itemId == null) return { ok: false, reason: "noItemId" };
    const key = `item:${itemId}`;
    const res = actionPlanner?.removeIntent?.(key);
    return res || { ok: false, reason: "noPlanner" };
  },
  splitStackAndPlace: ({ ownerId, itemId, amount, targetGX, targetGY }) =>
    runner.dispatchAction(
      ActionKinds.INVENTORY_SPLIT,
      { ownerId, itemId, amount, targetGX, targetGY },
      { apCost: 0 }
    ),
});

const boardView = createBoardView({
  app,
  tileLayer: uiLayers.tileLayer,
  eventLayer: uiLayers.eventLayer,
  permanentsLayer: uiLayers.permanentsLayer,
  hoverLayer: uiLayers.hoverLayer,
  getGameState: () => runner.getState(),
  interaction: interactionController,
  actionPlanner,
  tooltipView,
  inventoryView,
  dispatchAction: (kind, payload, opts) =>
    runner.dispatchAction(kind, payload, opts),
});

const charactersView = createCharactersView({
  app,
  layer: uiLayers.characterLayer,
  hoverLayer: uiLayers.hoverLayer,
  getCharacters: () => runner.getState().characters,
  getPermanentSlots: () => runner.getState().permanentSlots,
  getGameState: () => runner.getState(),
  interaction: interactionController,
  tooltipView,
  inventoryView,
  getFocusIntent: () =>
    runner.isPreviewing?.() ? null : actionPlanner?.getFocusIntent?.() ?? null,
  getPreviewHubCol: (charId) =>
    runner.isPreviewing?.()
      ? null
      : actionPlanner?.getCharacterOverrideHubCol?.(charId) ?? null,
  getPreviewPlacement: (charId) =>
    runner.isPreviewing?.()
      ? null
      : actionPlanner?.getCharacterOverridePlacement?.(charId) ?? null,
  onCharacterDropped({ charId, dropPos }) {
    const state = runner.getState();
    const envCols = Number.isFinite(state?.board?.cols)
      ? Math.floor(state.board.cols)
      : BOARD_COLS;
    const hubCols = Array.isArray(state?.permanentSlots)
      ? state.permanentSlots.length
      : HUB_COLS;

    const tileCenterY = TILE_ROW_Y + TILE_HEIGHT / 2;
    const permCenterY = PERM_ROW_Y + PERM_HEIGHT / 2;
    const distToTile = Math.abs(dropPos.y - tileCenterY);
    const distToPerm = Math.abs(dropPos.y - permCenterY);
    const targetRow = distToTile <= distToPerm ? "env" : "hub";

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
      actionPlanner?.setPawnMoveIntent?.({
        charId,
        toEnvCol: bestIndex,
      });
      return;
    }

    actionPlanner?.setPawnMoveIntent?.({
      charId,
      toHubCol: bestIndex,
    });
  },
});

let goldGraphView = createMetricGraphView({
  app,
  layer: uiLayers.controlsLayer,
  controller: timeGraphController,
  metric: GRAPH_METRICS.gold,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  setPreviewState: (s) => runner.setPreviewState(s),
  clearPreviewState: () => runner.clearPreviewState(),
  // STAGE 3: Use commitCursorSecond
  commitSecond: (t, stateData) => runner.commitCursorSecond(t, stateData),
  openPosition: { x: 350, y: 280 },
});

let foodGraphView = createMetricGraphView({
  app,
  layer: uiLayers.controlsLayer,
  controller: timeGraphController,
  metric: GRAPH_METRICS.food,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  setPreviewState: (s) => runner.setPreviewState(s),
  clearPreviewState: () => runner.clearPreviewState(),
  commitSecond: (t, stateData) => runner.commitCursorSecond(t, stateData),
  openPosition: { x: 350, y: 460 },
});

let apGraphView = createMetricGraphView({
  app,
  layer: uiLayers.controlsLayer,
  controller: timeGraphController,
  metric: GRAPH_METRICS.ap,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  getSeriesValueOverride: (tSec, seriesId) => {
    if (seriesId !== "ap") return null;
    const state = runner.getCursorState();
    const currentSec = Math.floor(state?.tSec ?? 0);
    if (tSec !== currentSec) return null;
    const preview = actionPlanner?.getApPreview?.();
    return preview ? preview.remaining : null;
  },
  setPreviewState: (s) => runner.setPreviewState(s),
  clearPreviewState: () => runner.clearPreviewState(),
  commitSecond: (t, stateData) => runner.commitCursorSecond(t, stateData),
  openPosition: { x: 350 },
});

const chromeView = createChromeView({
  app,
  layer: uiLayers.controlsLayer,
  getGameState: () => runner.getState(),
  getCurrentSeasonData,
  getApPreview: () => actionPlanner?.getApPreview?.() ?? null,
  togglePause: () => {
    const paused = runner.getCursorState().paused;
    if (paused) {
      runner.setTimeScaleTarget?.(1, { unpause: true });
      runner.setPaused(false);
    } else {
      runner.setTimeScaleTarget?.(0, { requestPause: true });
      runner.setPaused(true);
    }
  },
  isPausePending: () => runner.isPausePending?.() ?? false,
  onGoldClick: () => {
    runner.clearPreviewState();
    if (!goldGraphView.isOpen()) goldGraphView.open();
    else goldGraphView.close();
  },
  onFoodClick: () => {
    runner.clearPreviewState();
    if (!foodGraphView.isOpen()) foodGraphView.open();
    else foodGraphView.close();
  },
  onApClick: () => {
    runner.clearPreviewState();
    if (!apGraphView.isOpen()) apGraphView.open();
    else apGraphView.close();
  },
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
});

const actionLogView = createActionLogView({
  app,
  layer: uiLayers.controlsLayer,
  getPlanner: () => actionPlanner,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  isPreviewing: () => runner.isPreviewing?.() ?? false,
  onJumpToSecond: (tSec) => runner.browseCursorSecond?.(tSec),
  getOwnerLabel(ownerId) {
    const state = runner.getState();
    const permSlot = state.permanentSlots.find(
      (s) => s.permanent && s.permanent.instanceId === ownerId
    );
    if (permSlot) {
      const perm = permSlot.permanent;
      const def = permanentDefs[perm.defId];
      return def?.name || def?.id || `Permanent ${ownerId}`;
    }
    const ch = state.characters.find((c) => c.id === ownerId);
    if (ch) return ch.name || `Char ${ownerId}`;
    return `Owner ${ownerId}`;
  },
  getState: () => runner.getState(),
});

runner.init();
interactionController.init();
tooltipView.init();
inventoryView.init();
boardView.init();
charactersView.init();
chromeView.init();
sunMoonDisksView.init(); // NEW
actionLogView.init();
apGraphView.open();

app.ticker.add((delta) => {
  const frameDt = delta / 60;
  runner.update(frameDt);
  interactionController.update(frameDt);
  boardView.update(frameDt);
  charactersView.update(frameDt);
  tooltipView.update(frameDt);
  inventoryView.update(frameDt);
  chromeView.update(frameDt);
  sunMoonDisksView.update(frameDt); // NEW
  actionLogView.update(frameDt);
  debugView.update();

  const anyGraphOpen =
    goldGraphView.isOpen() ||
    foodGraphView.isOpen() ||
    apGraphView.isOpen();
  timeGraphController.setActive?.(anyGraphOpen);
  if (anyGraphOpen) {
    timeGraphController.update();
    if (goldGraphView.isOpen()) goldGraphView.render();
    if (foodGraphView.isOpen()) foodGraphView.render();
    if (apGraphView.isOpen()) apGraphView.render();
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
  test: runDeterminismSuite,
};

