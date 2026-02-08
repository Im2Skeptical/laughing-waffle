// src/views/ui-root-pixi.js
import { getCurrentSeasonData } from "../model/game-model.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { ActionKinds } from "../model/actions.js";
import { createSimRunner } from "../controllers/sim-runner.js";
import { createTimeGraphController } from "../model/timegraph-controller.js";
import { GRAPH_METRICS } from "../model/graph-metrics.js";
import { envSystemDefs } from "../defs/gamesystems/env-systems-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { pawnSystemDefs } from "../defs/gamesystems/pawn-systems-defs.js";
import { runDeterminismSuite } from "../model/tests/determinism.js";
import { createInteractionController } from "./interaction-controler-pixi.js";
import { createTooltipView } from "./tooltip-pixi.js";
import { createInventoryView } from "./inventory-pixi.js";
import { createCharactersView } from "./characters-pixi.js";
import { createBoardView } from "./board-pixi.js";
import { createChromeView } from "./chrome-pixi.js";
import { createMetricGraphView } from "./timegraphs-pixi.js";
import { createProcessWidgetView } from "./process-widget-pixi.js";
import {
  BOARD_COLS,
  HUB_COLS,
  HUB_STRUCTURE_HEIGHT,
  HUB_STRUCTURE_ROW_Y,
  TILE_HEIGHT,
  TILE_ROW_Y,
  getBoardColumnCenterX,
  getHubColumnCenterX,
} from "./layout-pixi.js";
import { createDebugOverlay } from "./debug-overlay-pixi.js";
import { createActionLogView } from "./action-log-pixi.js";
import { createEventLogView } from "./event-log-pixi.js";
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

let flashActionLogAp = null;
let actionLogView = null;
let eventLogView = null;
let externalUiFocus = null;

const runner = createSimRunner({
  onInvalidate: (reason) => {
    goldGraphController.handleInvalidate(reason);
    foodGraphController.handleInvalidate(reason);
    apGraphController.handleInvalidate(reason);
    popGraphController.handleInvalidate(reason);
    systemGraphController.handleInvalidate(reason);
    if (goldGraphView?.isOpen()) goldGraphView.render();
    if (foodGraphView?.isOpen()) foodGraphView.render();
    if (apGraphView?.isOpen()) apGraphView.render();
    if (popGraphView?.isOpen()) popGraphView.render();
    if (systemGraphView?.isOpen()) systemGraphView.render();
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
  onPlannerApReject: () => {
    flashActionLogAp?.();
  },
});

const actionPlanner = runner.getActionPlanner?.();

const queuedActions = [];

function requestPauseForAction() {
  const state = runner.getCursorState?.();
  if (!state || state.paused) return;
  runner.setTimeScaleTarget?.(0, { requestPause: true });
  runner.setPaused(true);
}

function queueActionWhenPaused(actionFn) {
  const state = runner.getCursorState?.();
  if (state?.paused) {
    return actionFn();
  }
  requestPauseForAction();
  queuedActions.push(actionFn);
  return { ok: true, queued: true };
}

function flushQueuedActions() {
  if (!queuedActions.length) return;
  const state = runner.getCursorState?.();
  if (!state?.paused) return;
  if (runner.isPreviewing?.()) return;

  const pending = queuedActions.splice(0, queuedActions.length);
  for (const fn of pending) {
    const res = fn();
    if (res?.ok === false && res.reason === "mustBePaused") {
      queuedActions.push(fn);
    }
  }
}

const goldGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: GRAPH_METRICS.gold,
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
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const uiLayers = {
  tileLayer: new PIXI.Container(),
  eventLayer: new PIXI.Container(),
  hubStructuresLayer: new PIXI.Container(),
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
  uiLayers.hubStructuresLayer,
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

const interactionController = createInteractionController({
  // Phase is derived from paused by policy.
  getPhase: () => runner.getCursorState().phase,
});

const SYSTEM_GRAPH_COLORS = [
  0x7fd0ff,
  0xffaa66,
  0x7ccf6b,
  0xff6699,
  0xb07a4f,
  0x9aa0b5,
  0x8f6fff,
];

function getSystemGraphTarget() {
  const hover =
    interactionController.getHoveredPawn?.() ??
    interactionController.getHovered?.() ??
    interactionController.getLastHovered?.();
  if (!hover) return null;
  if (hover.kind === "tile") {
    return { kind: "tile", col: hover.col };
  }
  if (hover.kind === "hub") {
    return { kind: "hub", col: hover.col };
  }
  if (hover.kind === "pawn") {
    return { kind: "pawn", id: hover.id };
  }
  return null;
}

function getSystemGraphTargetKey(target) {
  if (!target) return null;
  if (target.kind === "tile") {
    return `tile:${Math.floor(target.col ?? 0)}`;
  }
  if (target.kind === "hub") {
    return `hub:${Math.floor(target.col ?? 0)}`;
  }
  if (target.kind === "pawn") {
    return `pawn:${target.id ?? ""}`;
  }
  return null;
}

const systemGraphMetric = {
  id: "systemTarget",
  label: "Systems",
  series: [],
  getSubjectKey: (subject) => getSystemGraphTargetKey(subject),
  createSnapshotResolver: (snapshot, subject) =>
    buildSystemSnapshotResolver(snapshot, subject),
  useSubjectValues: true,
};

const systemGraphController = createTimeGraphController({
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  metric: systemGraphMetric,
});

function getTierValue(defs, systemId, tier) {
  const def = defs?.[systemId];
  const value = def?.tierMap?.[tier];
  return Number.isFinite(value) ? value : 0;
}

function sumMaturedPool(pool) {
  return (
    (pool?.bronze ?? 0) +
    (pool?.silver ?? 0) +
    (pool?.gold ?? 0) +
    (pool?.diamond ?? 0)
  );
}

function findTileAnchorAtCol(snapshot, col) {
  const anchors = snapshot?.board?.layers?.tile?.anchors;
  if (!Array.isArray(anchors)) return null;
  const targetCol = Number.isFinite(col) ? Math.floor(col) : null;
  if (targetCol == null) return null;
  for (const anchor of anchors) {
    if (!anchor) continue;
    const base = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : 0;
    const span = Number.isFinite(anchor.span) ? Math.floor(anchor.span) : 1;
    if (targetCol >= base && targetCol < base + Math.max(1, span)) {
      return anchor;
    }
  }
  return null;
}

function findHubStructureAtCol(snapshot, col) {
  const slots = snapshot?.hub?.slots;
  if (!Array.isArray(slots)) return null;
  const targetCol = Number.isFinite(col) ? Math.floor(col) : null;
  if (targetCol == null) return null;
  for (let i = 0; i < slots.length; i++) {
    const structure = slots[i]?.structure;
    if (!structure) continue;
    const def = hubStructureDefs[structure.defId];
    const span =
      Number.isFinite(structure.span) && structure.span > 0
        ? Math.floor(structure.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
          ? Math.floor(def.defaultSpan)
          : 1;
    const base = i;
    if (targetCol >= base && targetCol < base + Math.max(1, span)) {
      return structure;
    }
  }
  return null;
}

function findPawnById(snapshot, id) {
  const chars = snapshot?.characters;
  if (!Array.isArray(chars)) return null;
  for (const ch of chars) {
    if (ch?.id === id) return ch;
  }
  return null;
}

function buildSystemSnapshotResolver(snapshot, target) {
  if (!snapshot || !target) return null;
  if (target.kind === "tile") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    const occTile =
      col != null && Array.isArray(snapshot?.board?.occ?.tile)
        ? snapshot.board.occ.tile[col] ?? null
        : null;
    return {
      kind: "tile",
      col,
      tile:
        occTile ??
        (col != null ? findTileAnchorAtCol(snapshot, col) : null),
    };
  }
  if (target.kind === "hub") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    return {
      kind: "hub",
      col,
      hubStructure: col != null ? findHubStructureAtCol(snapshot, col) : null,
    };
  }
  if (target.kind === "pawn") {
    const id = target.id;
    return {
      kind: "pawn",
      id,
      pawn: id != null ? findPawnById(snapshot, id) : null,
    };
  }
  return null;
}

function buildSystemSeriesForTarget(target, state) {
  if (!target || !state) {
    return {
      label: "Systems",
      series: [
        {
          id: "systems:empty",
          label: "No target",
          color: SYSTEM_GRAPH_COLORS[0],
          getValue: () => 0,
        },
      ],
    };
  }
  const series = [];
  let label = "Systems";
  let targetKey = "";

  if (target.kind === "tile") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    const tile = col != null ? state?.board?.occ?.tile?.[col] : null;
    const tileDef = tile ? envTileDefs[tile.defId] : null;
    label = tileDef?.name || tile?.defId || `Tile ${col}`;
    targetKey = `tile:${col}`;

    const ids = new Set();
    const tags = new Set();
    const baseTags = Array.isArray(tileDef?.baseTags) ? tileDef.baseTags : [];
    for (const tag of baseTags) tags.add(tag);
    for (const tag of tile?.tags || []) tags.add(tag);
    for (const tag of tags) {
      const tagDef = envTagDefs?.[tag];
      const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
      for (const systemId of systems) {
        ids.add(systemId);
      }
    }
    for (const systemId of Object.keys(tile?.systemState || {})) {
      ids.add(systemId);
    }
    for (const systemId of Object.keys(tile?.systemTiers || {})) {
      ids.add(systemId);
    }
    for (const systemId of ids.values()) {
      if (systemId === "growth") {
        series.push({
          id: `${targetKey}:matured`,
          label: "Matured",
          color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
          getValue: (snap) => {
            const t = snap?.board?.occ?.tile?.[col];
            const pool = t?.systemState?.growth?.maturedPool;
            return sumMaturedPool(pool);
          },
          getValueFromSnapshot: (snapshot, _subject, resolved) => {
            const t =
              (resolved?.kind === "tile" ? resolved.tile : null) ??
              findTileAnchorAtCol(snapshot, col);
            const pool = t?.systemState?.growth?.maturedPool;
            return sumMaturedPool(pool);
          },
        });
        continue;
      }
      const def = envSystemDefs[systemId];
      const sysLabel = def?.ui?.name || systemId;
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        getValue: (snap) => {
          const t = snap?.board?.occ?.tile?.[col];
          const sysState = t?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            t?.systemTiers?.[systemId] ?? envSystemDefs[systemId]?.defaultTier;
          return getTierValue(envSystemDefs, systemId, tier);
        },
        getValueFromSnapshot: (snapshot, _subject, resolved) => {
          const t =
            (resolved?.kind === "tile" ? resolved.tile : null) ??
            findTileAnchorAtCol(snapshot, col);
          const sysState = t?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            t?.systemTiers?.[systemId] ?? envSystemDefs[systemId]?.defaultTier;
          return getTierValue(envSystemDefs, systemId, tier);
        },
      });
    }
  } else if (target.kind === "hub") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    const structure =
      col != null ? state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure : null;
    const def = structure ? hubStructureDefs[structure.defId] : null;
    label = def?.name || structure?.defId || `Hub ${col}`;
    targetKey = `hub:${col}`;

    const ids = new Set([
      ...Object.keys(structure?.systemState || {}),
      ...Object.keys(structure?.systemTiers || {}),
    ]);
    for (const systemId of ids.values()) {
      const defSys = hubSystemDefs[systemId];
      const sysLabel = defSys?.ui?.name || systemId;
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        getValue: (snap) => {
          const s =
            col != null
              ? snap?.hub?.occ?.[col] ?? snap?.hub?.slots?.[col]?.structure
              : null;
          const sysState = s?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            s?.systemTiers?.[systemId] ?? hubSystemDefs[systemId]?.defaultTier;
          return getTierValue(hubSystemDefs, systemId, tier);
        },
        getValueFromSnapshot: (snapshot, _subject, resolved) => {
          const s =
            (resolved?.kind === "hub" ? resolved.hubStructure : null) ??
            (col != null ? findHubStructureAtCol(snapshot, col) : null);
          const sysState = s?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            s?.systemTiers?.[systemId] ?? hubSystemDefs[systemId]?.defaultTier;
          return getTierValue(hubSystemDefs, systemId, tier);
        },
      });
    }
  } else if (target.kind === "pawn") {
    const id = target.id;
    const pawn = state?.characters?.find((c) => c.id === id);
    label = pawn?.name || `Pawn ${id}`;
    targetKey = `pawn:${id}`;

    const ids = new Set([
      ...Object.keys(pawn?.systemState || {}),
      ...Object.keys(pawn?.systemTiers || {}),
    ]);
    for (const systemId of ids.values()) {
      const defSys = pawnSystemDefs[systemId];
      const sysLabel = defSys?.ui?.name || systemId;
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        getValue: (snap) => {
          const p = snap?.characters?.find((c) => c.id === id);
          const sysState = p?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            p?.systemTiers?.[systemId] ?? pawnSystemDefs[systemId]?.defaultTier;
          return getTierValue(pawnSystemDefs, systemId, tier);
        },
        getValueFromSnapshot: (snapshot, _subject, resolved) => {
          const p =
            (resolved?.kind === "pawn" ? resolved.pawn : null) ??
            findPawnById(snapshot, id);
          const sysState = p?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            p?.systemTiers?.[systemId] ?? pawnSystemDefs[systemId]?.defaultTier;
          return getTierValue(pawnSystemDefs, systemId, tier);
        },
      });
    }
  }

  if (!series.length) {
    series.push({
      id: `${targetKey || "systems"}:empty`,
      label: "No systems",
      color: SYSTEM_GRAPH_COLORS[0],
      getValue: () => 0,
      getValueFromSnapshot: () => 0,
    });
  }

  return {
    label: `${label} Systems`,
    series,
  };
}

const tooltipView = createTooltipView({
  layer: uiLayers.tooltipLayer,
  interaction: interactionController,
});

let inventoryView = null;
let processWidgetView = null;
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
  actionPlanner,
  getItemTransferAffordability: (spec) =>
    actionPlanner?.getItemTransferAffordability?.(spec) ?? {
      ok: true,
      affordable: true,
    },
  getDropTargetOwnerAt: (pos) =>
    charactersView?.getInventoryOwnerAtGlobalPos?.(pos) ??
    processWidgetView?.getDropTargetOwnerAtGlobalPos?.(pos) ??
    boardView?.getInventoryOwnerAtGlobalPos?.(pos) ??
    null,
  setDragGhost: (spec) => actionLogView?.setDragGhost?.(spec),
  resolveDragGhost: (status) => actionLogView?.resolveDragGhost?.(status),
  getFocusIntent: () =>
    runner.isPreviewing?.() ? null : actionPlanner?.getFocusIntent?.() ?? null,
  getExternalFocusOwners: () => getExternalFocusOwners(),
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
      const isProcessBuffer = (ownerId) =>
        typeof ownerId === "string" && ownerId.startsWith("inv:process:");
      if (
        (isProcessBuffer(spec.fromOwnerId) || isProcessBuffer(spec.toOwnerId)) &&
        spec.fromOwnerId !== spec.toOwnerId
      ) {
        return runner.dispatchAction(
          ActionKinds.PROCESS_BUFFER_MOVE,
          spec,
          { apCost: 0 }
        );
      }
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
  queuedActions.length = 0;
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

const charactersView = createCharactersView({
  app,
  layer: uiLayers.characterLayer,
  hoverLayer: uiLayers.hoverLayer,
  getCharacters: () => runner.getState().characters,
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
            charId,
            toEnvCol: bestIndex,
          }) || { ok: false, reason: "noPlanner" }
      );
    }

    return queueActionWhenPaused(
      () =>
        actionPlanner?.setPawnMoveIntent?.({
          charId,
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
  commitSecond: (t, stateData) => runner.commitCursorSecond(t, stateData),
  openPosition: { x: 350, y: 280 },
});

let foodGraphView = createMetricGraphView({
  app,
  layer: uiLayers.controlsLayer,
  controller: foodGraphController,
  metric: GRAPH_METRICS.food,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  setPreviewState: (s) => runner.setPreviewState(s),
  clearPreviewState: () => runner.clearPreviewState(),
  commitSecond: (t, stateData) => runner.commitCursorSecond(t, stateData),
  openPosition: { x: 350, y: 460 },
});

let systemGraphView = createMetricGraphView({
  app,
  layer: uiLayers.controlsLayer,
  controller: systemGraphController,
  getMetricDef: () => systemGraphController.getData().metric,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  setPreviewState: (s) => runner.setPreviewState(s),
  clearPreviewState: () => runner.clearPreviewState(),
  commitSecond: (t, stateData) => runner.commitCursorSecond(t, stateData),
  openPosition: { x: 350, y: 220 },
});

let apGraphView = createMetricGraphView({
  app,
  layer: uiLayers.controlsLayer,
  controller: apGraphController,
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
  openPosition: { x: 350, y: 80 },
});

let popGraphView = createMetricGraphView({
  app,
  layer: uiLayers.controlsLayer,
  controller: popGraphController,
  metric: GRAPH_METRICS.population,
  getTimeline: () => runner.getTimeline(),
  getCursorState: () => runner.getCursorState(),
  setPreviewState: (s) => runner.setPreviewState(s),
  clearPreviewState: () => runner.clearPreviewState(),
  commitSecond: (t, stateData) => runner.commitCursorSecond(t, stateData),
  openPosition: { x: 350, y: 640 },
});

let lastSystemGraphTargetKey = null;

function updateSystemGraphTarget() {
  const target = getSystemGraphTarget();
  const nextKey = getSystemGraphTargetKey(target);
  if (nextKey === lastSystemGraphTargetKey) return false;
  lastSystemGraphTargetKey = nextKey;
  const state = runner.getCursorState?.();
  const resolved = buildSystemSeriesForTarget(target, state);
  systemGraphController.setSeries?.(resolved.series, resolved.label);
  systemGraphController.setSubject?.(target, nextKey);
  return true;
}

function openSystemGraphForHover() {
  if (systemGraphView.isOpen()) {
    systemGraphView.close();
    return { ok: true, closed: true };
  }
  updateSystemGraphTarget();
  runner.clearPreviewState();
  systemGraphView.open();
  return { ok: true, opened: true };
}

const chromeView = createChromeView({
  app,
  layer: uiLayers.controlsLayer,
  getGameState: () => runner.getState(),
  getCurrentSeasonData,
  getApPreview: () => actionPlanner?.getApPreview?.() ?? null,
  togglePause,
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
  onPopClick: () => {
    runner.clearPreviewState();
    if (!popGraphView.isOpen()) popGraphView.open();
    else popGraphView.close();
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
  onOpenSystemGraph: () => openSystemGraphForHover(),
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
    const ch = state.characters.find((c) => c.id === ownerId);
    if (ch) return ch.name || `Char ${ownerId}`;
    return `Owner ${ownerId}`;
  },
  getState: () => runner.getState(),
});

eventLogView = createEventLogView({
  layer: uiLayers.controlsLayer,
  getState: () => runner.getState(),
  onSelectEntry: (entry) => handleEventLogSelection(entry),
  position: { x: 20, y: 180 },
});

flashActionLogAp = () => actionLogView.flashInsufficientAp?.();

runner.init();
interactionController.init();
tooltipView.init();
inventoryView.init();
boardView.init();
charactersView.init();
processWidgetView.init();
chromeView.init();
sunMoonDisksView.init(); // NEW
actionLogView.init();
eventLogView.init();
apGraphView.open();
systemGraphView.open();

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
  const frameDt = delta / 60;
  runner.update(frameDt);
  flushQueuedActions();
  interactionController.update(frameDt);
  boardView.update(frameDt);
  charactersView.update(frameDt);
  tooltipView.update(frameDt);
  inventoryView.update(frameDt);
  processWidgetView.update(frameDt);
  chromeView.update(frameDt);
  sunMoonDisksView.update(frameDt); // NEW
  actionLogView.update(frameDt);
  eventLogView.update(frameDt);
  debugView.update();

  const anyMetricGraphOpen =
    goldGraphView.isOpen() ||
    foodGraphView.isOpen() ||
    apGraphView.isOpen() ||
    popGraphView.isOpen();
  goldGraphController.setActive?.(goldGraphView.isOpen());
  foodGraphController.setActive?.(foodGraphView.isOpen());
  apGraphController.setActive?.(apGraphView.isOpen());
  popGraphController.setActive?.(popGraphView.isOpen());
  if (anyMetricGraphOpen) {
    if (goldGraphView.isOpen()) {
      goldGraphController.update();
      goldGraphView.render();
    }
    if (foodGraphView.isOpen()) {
      foodGraphController.update();
      foodGraphView.render();
    }
    if (apGraphView.isOpen()) {
      apGraphController.update();
      apGraphView.render();
    }
    if (popGraphView.isOpen()) {
      popGraphController.update();
      popGraphView.render();
    }
  }

  const systemGraphOpen = systemGraphView.isOpen();
  systemGraphController.setActive?.(systemGraphOpen);
  if (systemGraphOpen) {
    if (updateSystemGraphTarget()) {
      runner.clearPreviewState();
    }
    systemGraphController.update();
    systemGraphView.render();
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
