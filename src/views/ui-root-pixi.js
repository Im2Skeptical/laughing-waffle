// src/views/ui-root-pixi.js
import { getCurrentSeasonData } from "../model/game-model.js";
import { permanentDefs } from "../defs/defs.js";
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
import { createMetricGraphView } from "./gold-graph-pixi.js";
import { PERM_WIDTH, PERM_HEIGHT, layoutPermPos } from "./layout-pixi.js";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

export const app = new PIXI.Application({
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  backgroundColor: 0x202030,
  antialias: true,
});

document.body.appendChild(app.view);

const runner = createSimRunner({
  onInvalidate: (reason) => {
    goldGraphController.handleInvalidate(reason);
    apGraphController.handleInvalidate(reason);
    if (goldGraphView?.isOpen()) goldGraphView.render();
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

const goldGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.gold,
});

const apGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.ap,
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
  envLayer: new PIXI.Container(),
  permanentsLayer: new PIXI.Container(),
  characterLayer: new PIXI.Container(),
  controlsLayer: new PIXI.Container(),
  inventoryLayer: new PIXI.Container(),
  tooltipLayer: new PIXI.Container(),
  dragLayer: new PIXI.Container(),
  debugLayer: new PIXI.Container(),
};

app.stage.eventMode = "static";
app.stage.hitArea = app.screen;
app.stage.addChild(
  uiLayers.envLayer,
  uiLayers.permanentsLayer,
  uiLayers.characterLayer,
  uiLayers.controlsLayer,
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
  // Stage 5: phase is a normalized semantic label derived from paused by policy.
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
  moveItemBetweenOwners: (spec) =>
    runner.dispatchAction(ActionKinds.INVENTORY_MOVE, spec),
  splitStackAndPlace: ({ ownerId, itemId, amount }) =>
    runner.dispatchAction(ActionKinds.INVENTORY_SPLIT, {
      ownerId,
      itemId,
      amount,
    }),
  stackItemsInOwner: (spec) =>
    runner.dispatchAction(ActionKinds.INVENTORY_STACK, spec),
});

const boardView = createBoardView({
  app,
  envLayer: uiLayers.envLayer,
  permanentsLayer: uiLayers.permanentsLayer,
  getGameState: () => runner.getState(),
  interaction: interactionController,
  tooltipView,
  inventoryView,
});

const charactersView = createCharactersView({
  app,
  layer: uiLayers.characterLayer,
  getCharacters: () => runner.getState().characters,
  getPermanentSlots: () => runner.getState().permanentSlots,
  interaction: interactionController,
  tooltipView,
  inventoryView,
  onCharacterDropped({ charId, dropPos }) {
    const slots = runner.getState().permanentSlots;
    const count = slots.length;
    let bestIndex = null;
    let bestDist2 = Infinity;
    for (let i = 0; i < count; i++) {
      const slot = slots[i];
      if (!slot.permanent) continue;
      const pos = layoutPermPos(app.screen.width, i, count);
      const cx = pos.x + PERM_WIDTH / 2;
      const cy = pos.y + PERM_HEIGHT / 2;
      const dx = dropPos.x - cx;
      const dy = dropPos.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestIndex = i;
      }
    }
    if (bestIndex != null) {
      runner.dispatchAction(ActionKinds.PLACE_CHARACTER, {
        charId,
        slotIndex: bestIndex,
      });
    }
  },
});

let goldGraphView = createMetricGraphView({
  app,
  layer: uiLayers.controlsLayer,
  controller: goldGraphController,
  metric: GRAPH_METRICS.gold,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  setPreviewState: (s) => runner.setPreviewState(s),
  clearPreviewState: () => runner.clearPreviewState(),
  // STAGE 3: Use commitCursorSecond
  commitSecond: (t) => runner.commitCursorSecond(t),
});

let apGraphView = createMetricGraphView({
  app,
  layer: uiLayers.controlsLayer,
  controller: apGraphController,
  metric: GRAPH_METRICS.ap,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  setPreviewState: (s) => runner.setPreviewState(s),
  clearPreviewState: () => runner.clearPreviewState(),
  commitSecond: (t) => runner.commitCursorSecond(t),
  openPosition: { x: 700 },
});

const chromeView = createChromeView({
  app,
  layer: uiLayers.controlsLayer,
  getGameState: () => runner.getState(),
  getCurrentSeasonData,
  togglePause: () => {
    const paused = runner.getCursorState().paused;
    runner.setPaused(!paused);
  },
  isPausePending: () => runner.isPausePending?.() ?? false,
  onGoldClick: () => {
    runner.clearPreviewState();
    if (!goldGraphView.isOpen()) goldGraphView.open();
    else goldGraphView.close();
  },
  onApClick: () => {
    runner.clearPreviewState();
    if (!apGraphView.isOpen()) apGraphView.open();
    else apGraphView.close();
  },
});

function createDebugOverlay() {
  const root = new PIXI.Container();
  root.x = DESIGN_WIDTH - 220;
  root.y = 10;
  uiLayers.debugLayer.addChild(root);
  const hudBg = new PIXI.Graphics();
  hudBg.beginFill(0x000000, 0.5);
  hudBg.drawRoundedRect(0, 0, 200, 40, 8);
  hudBg.endFill();
  root.addChild(hudBg);
  const apText = new PIXI.Text("AP: -- / --", {
    fontFamily: "Arial",
    fontSize: 18,
    fill: 0xffd700,
    fontWeight: "bold",
  });
  apText.x = 10;
  apText.y = 10;
  root.addChild(apText);
  const dbgBtn = new PIXI.Graphics();
  dbgBtn.beginFill(0x444444);
  dbgBtn.drawRoundedRect(160, 5, 30, 30, 4);
  dbgBtn.endFill();
  dbgBtn.eventMode = "static";
  dbgBtn.cursor = "pointer";
  root.addChild(dbgBtn);
  const dbgIcon = new PIXI.Text("D", { fontSize: 20, fill: 0xffffff });
  dbgIcon.x = 166;
  dbgIcon.y = 8;
  root.addChild(dbgIcon);
  const panel = new PIXI.Container();
  panel.y = 50;
  panel.visible = false;
  root.addChild(panel);
  const panelBg = new PIXI.Graphics();
  panelBg.beginFill(0x222222, 0.9);
  panelBg.drawRoundedRect(0, 0, 200, 100, 8);
  panelBg.endFill();
  panel.addChild(panelBg);
  const cheatBtn = new PIXI.Container();
  cheatBtn.x = 10;
  cheatBtn.y = 10;
  panel.addChild(cheatBtn);
  const cheatBg = new PIXI.Graphics();
  cheatBg.beginFill(0x555555);
  cheatBg.drawRect(0, 0, 180, 30);
  cheatBg.endFill();
  cheatBtn.addChild(cheatBg);
  const cheatText = new PIXI.Text("Toggle Cheat AP", {
    fontSize: 14,
    fill: 0xffffff,
  });
  cheatText.x = 10;
  cheatText.y = 6;
  cheatBtn.addChild(cheatText);
  let cheatsEnabled = false;
  dbgBtn.on("pointerdown", () => {
    panel.visible = !panel.visible;
  });
  cheatBtn.eventMode = "static";
  cheatBtn.cursor = "pointer";
  cheatBtn.on("pointerdown", () => {
    cheatsEnabled = !cheatsEnabled;
    const payload = cheatsEnabled
      ? { cap: 9999, points: 9999 }
      : { cap: 100, points: 100 };
    runner.dispatchAction(ActionKinds.DEBUG_SET_CAP, payload);
    cheatBg.clear();
    cheatBg.beginFill(cheatsEnabled ? 0x00aa00 : 0x555555);
    cheatBg.drawRect(0, 0, 180, 30);
    cheatBg.endFill();
  });
  return {
    update: () => {
      const state = runner.getState();
      if (state) {
        const cur = state.actionPoints ?? 0;
        const cap = state.actionPointCap ?? 100;
        apText.text = `AP: ${cur} / ${cap}`;
        apText.style.fill = cur < 20 ? 0xff5555 : 0xffd700;
      }
    },
  };
}

const debugView = createDebugOverlay();

runner.init();
interactionController.init();
tooltipView.init();
inventoryView.init();
boardView.init();
charactersView.init();
chromeView.init();

app.ticker.add((delta) => {
  const frameDt = delta / 60;
  runner.update(frameDt);
  interactionController.update(frameDt);
  boardView.update(frameDt);
  charactersView.update(frameDt);
  tooltipView.update(frameDt);
  inventoryView.update(frameDt);
  chromeView.update(frameDt);
  goldGraphController.update();
  apGraphController.update();
  debugView.update();
  if (goldGraphView.isOpen()) goldGraphView.render();
  if (apGraphView.isOpen()) apGraphView.render();
});

window.__DBG__ = {
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  commit: (b) => runner.commitCursorSecond(b),
  preview: (s) => runner.setPreviewState(s),
  clearPreview: () => runner.clearPreviewState(),
  dispatch: (kind, payload) => runner.dispatchAction(kind, payload),
  test: runDeterminismSuite,
};
