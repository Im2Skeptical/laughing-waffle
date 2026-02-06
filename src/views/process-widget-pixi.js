// process-widget-pixi.js
// Process Widget v2: modular layout + routing drawers.

import { ActionKinds } from "../model/actions.js";
import {
  getProcessDefForInstance,
  getDropEndpointId,
  isDropEndpoint,
  listCandidateEndpoints,
  resolveEndpointTarget,
  resolveFixedEndpointId,
} from "../model/process-framework.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { createPillDragController } from "./ui-helpers/pill-drag-controller.js";
import { createWindowHeader } from "./ui-helpers/window-header.js";

const CORE_WIDTH = 280;
const CARD_RADIUS = 12;
const CARD_GAP = 10;
const HEADER_HEIGHT = 22;
const HEADER_PAD_X = 10;
const HEADER_PAD_Y = 6;
const BODY_PAD = 8;
const SEGMENT_GAP = 6;

const DRAWER_COLLAPSED = 22;
const DRAWER_EXPANDED = 126;
const BUFFER_SIZE = 44;

const MODULE_GAP = 8;
const MODULE_PAD = 6;
const MODULE_RADIUS = 8;

const PILL_HEIGHT = 18;
const PILL_RADIUS = 9;
const PILL_GAP = 6;
const PILL_PAD_X = 8;
const TOGGLE_SIZE = 10;
const TOGGLE_PAD = 6;

const GROUP_SYSTEM_IDS = new Set(["growth"]);

const COLORS = {
  panel: 0x151a2a,
  panelBorder: 0x2a3146,
  headerBg: 0x303048,
  headerText: 0xffffff,
  headerSub: 0xa0a7bb,
  moduleBg: 0x1e2438,
  moduleBorder: 0x2b334a,
  moduleText: 0xe6eef9,
  moduleSub: 0x9aa0b5,
  drawerBg: 0x1a2034,
  drawerBorder: 0x2a3146,
  pillEnabled: 0x2a3958,
  pillDisabled: 0x2a2f3d,
  pillInvalid: 0x4b252c,
  pillLocked: 0x232a3d,
  pillText: 0xe6eef9,
  pillTextDisabled: 0x99a2b5,
  pillTextInvalid: 0xf2b0b0,
  progressBg: 0x2a2f45,
  progressFill: 0x7ccf6b,
  bufferBg: 0x1b2136,
  bufferBorder: 0x323b56,
};

export function createProcessWidgetView({
  app,
  layer,
  getGameState,
  interaction,
  dispatchAction,
  queueActionWhenPaused,
  inventoryView,
  position = { x: 1180, y: 640 },
}) {
  const windows = new Map();
  const drawerExpanded = {
    inputs: new Set(),
    outputs: new Set(),
  };

  let hoverContext = null;

  const routingDragController = createPillDragController({
    app,
    dragStateKey: "dragState",
    dragScale: 1.04,
    dragAlpha: 0.95,
    dragZIndex: 10,
    dragCursor: "grabbing",
    idleCursor: "grab",
    getEntries: (view) => view.pillEntries || [],
    getContainer: (view) => view.pillContainer,
    getRowHeight: () => PILL_HEIGHT,
    getRowStep: () => PILL_HEIGHT + PILL_GAP,
    layoutEntries: (view) => layoutPillEntries(view),
    onCommit: (view, fromIndex, toIndex) => {
      if (!view || view.slotLocked) return;
      const processId = view.processId;
      const slotKind = view.slotKind;
      const slotId = view.slotId;
      if (!processId || !slotId) return;
      const payload = {
        processId,
        slotKind,
        slotId,
        fromIndex,
        toIndex,
      };
      queueActionWhenPaused?.(() =>
        dispatchAction?.(ActionKinds.REORDER_PROCESS_ROUTING_ENDPOINT, payload, {
          apCost: 0,
        })
      );
    },
    onDragEnd: (view, drag) => {
      view.ignoreNextTap = !!drag?.moved;
      layoutPillEntries(view);
    },
  });

  function getStateSafe() {
    return typeof getGameState === "function" ? getGameState() : null;
  }

  function getHoverTarget(state) {
    const hover =
      interaction?.getHovered?.() ?? interaction?.getLastHovered?.();
    if (!hover) return null;
    if (hover.kind === "tile") {
      const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
      if (col == null) return null;
      return state?.board?.occ?.tile?.[col] ?? null;
    }
    if (hover.kind === "hub") {
      const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
      if (col == null) return null;
      return (
        state?.hub?.occ?.[col] ??
        state?.hub?.slots?.[col]?.structure ??
        null
      );
    }
    return null;
  }

  function getTargetKey(target) {
    if (!target) return null;
    const id = target.instanceId ?? target.id ?? null;
    if (id == null) return null;
    const isHub = !!hubStructureDefs[target.defId];
    const prefix = isHub ? "hub" : "tile";
    return `${prefix}:${id}`;
  }

  function collectProcesses(target) {
    if (!target || !target.systemState) return [];
    const list = [];
    const entries = Object.entries(target.systemState);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [systemId, sysState] of entries) {
      const processes = Array.isArray(sysState?.processes) ? sysState.processes : [];
      for (const proc of processes) {
        if (!proc || !proc.id) continue;
        list.push({ process: proc, systemId });
      }
    }
    list.sort((a, b) => {
      const aStart = Number.isFinite(a.process?.startSec)
        ? a.process.startSec
        : 0;
      const bStart = Number.isFinite(b.process?.startSec)
        ? b.process.startSec
        : 0;
      if (aStart !== bStart) return aStart - bStart;
      const aId = String(a.process?.id ?? "");
      const bId = String(b.process?.id ?? "");
      return aId.localeCompare(bId);
    });
    return list;
  }

  function getTargetLabel(target) {
    if (!target) return "Process";
    if (hubStructureDefs[target.defId]) {
      const def = hubStructureDefs[target.defId];
      return def?.name || target.defId || "Structure";
    }
    const tileDef = envTileDefs[target.defId];
    return tileDef?.name || target.defId || "Tile";
  }

  function isGroupedSystem(systemId) {
    return systemId && GROUP_SYSTEM_IDS.has(systemId);
  }
  function getProcessVariant(process, processDef) {
    if (!processDef) return "generic";
    const kind = processDef.processKind;
    if (kind === "cropGrowth") return "growing";
    if (kind === "depositItems") return "depositing";
    if (kind === "build") return "building";
    const recipe = recipeDefs?.[process?.type] || null;
    if (recipe?.kind === "cook") return "cooking";
    if (recipe?.kind === "craft") return "crafting";
    return "generic";
  }

  function getCardTitle(targetLabel, process, processDef) {
    const variant = getProcessVariant(process, processDef);
    if (variant === "growing") return `${targetLabel} - Growing`;
    if (variant === "depositing") return `${targetLabel} - Depositing`;
    if (variant === "building") return `${targetLabel} - Building`;
    if (variant === "cooking") return `${targetLabel} - Cooking`;
    if (variant === "crafting") return `${targetLabel} - Crafting`;
    return `${targetLabel} - ${processDef?.displayName || "Process"}`;
  }

  function formatRequirementLabel(req) {
    if (!req) return "Requirement";
    if (req.kind === "item") {
      const def = itemDefs?.[req.itemId];
      return def?.name || req.itemId || "Item";
    }
    if (req.kind === "tag") {
      const def = itemTagDefs?.[req.tag];
      return def?.ui?.name || req.tag || "Tag";
    }
    if (req.kind === "resource") {
      const raw = String(req.resource || "Resource");
      return raw.length ? raw[0].toUpperCase() + raw.slice(1) : "Resource";
    }
    return "Requirement";
  }

  function formatOutputLabel(out) {
    if (!out) return "Output";
    if (out.kind === "item") {
      const def = itemDefs?.[out.itemId];
      return def?.name || out.itemId || "Item";
    }
    if (out.kind === "pool") {
      if (out.fromLedger) return "Deposit Pool";
      const def = itemDefs?.[out.itemId];
      const itemLabel = def?.name || out.itemId || "Item";
      return `${itemLabel} Pool`;
    }
    if (out.kind === "prestige") return "Prestige";
    if (out.kind === "resource") {
      const raw = String(out.resource || "Resource");
      return raw.length ? raw[0].toUpperCase() + raw.slice(1) : "Resource";
    }
    if (out.kind === "system") {
      return `${out.system || "System"}:${out.key || ""}`;
    }
    return "Output";
  }

  function getEndpointLabel(state, endpointId) {
    if (!endpointId || typeof endpointId !== "string") return "Endpoint";
    if (endpointId.startsWith("inv:process:")) return "Buffer";
    if (endpointId.startsWith("res:state")) return "Stockpile";
    if (endpointId.startsWith("spawn:tileOccupants")) return "Spawn";
    if (endpointId.startsWith("sys:pool:")) {
      const parsed = parsePoolEndpointId(endpointId);
      if (!parsed) return "Pool";
      const ownerLabel = getOwnerLabel(state, parsed.ownerKind, parsed.ownerId);
      const poolLabel = `${parsed.systemId}.${parsed.poolKey}`;
      return ownerLabel ? `${ownerLabel} ${poolLabel}` : `Pool ${poolLabel}`;
    }
    if (endpointId.startsWith("inv:hub:")) {
      const id = endpointId.slice("inv:hub:".length);
      const structure = findStructureById(state, id);
      const def = structure ? hubStructureDefs[structure.defId] : null;
      const name = def?.name || structure?.defId || id;
      return `${name} Inventory`;
    }
    if (endpointId.startsWith("inv:pawn:")) {
      const id = endpointId.slice("inv:pawn:".length);
      const pawn = findPawnById(state, id);
      const name = pawn?.name || `Pawn ${id}`;
      return `${name} Inventory`;
    }
    if (endpointId.startsWith("inv:")) {
      const id = endpointId.slice("inv:".length);
      const structure = findStructureById(state, id);
      if (structure) {
        const def = hubStructureDefs[structure.defId];
        const name = def?.name || structure.defId || id;
        return `${name} Inventory`;
      }
      const pawn = findPawnById(state, id);
      if (pawn) {
        const name = pawn.name || `Pawn ${id}`;
        return `${name} Inventory`;
      }
      return `Inventory ${id}`;
    }
    if (endpointId.startsWith("sys:hub:")) {
      const id = endpointId.slice("sys:hub:".length);
      const structure = findStructureById(state, id);
      const def = structure ? hubStructureDefs[structure.defId] : null;
      const name = def?.name || structure?.defId || id;
      return `${name} System`;
    }
    if (endpointId.startsWith("sys:pawn:")) {
      const id = endpointId.slice("sys:pawn:".length);
      const pawn = findPawnById(state, id);
      return pawn?.name || `Leader ${id}`;
    }
    return endpointId;
  }

  function parsePoolEndpointId(endpointId) {
    if (!endpointId || typeof endpointId !== "string") return null;
    if (!endpointId.startsWith("sys:pool:")) return null;
    const raw = endpointId.slice("sys:pool:".length);
    const parts = raw.split(":");
    if (parts.length < 4) return null;
    const [ownerKind, ownerId, systemId, poolKey] = parts;
    if (!ownerKind || !ownerId || !systemId || !poolKey) return null;
    return { ownerKind, ownerId, systemId, poolKey };
  }

  function getOwnerLabel(state, ownerKind, ownerId) {
    if (!state || !ownerKind || ownerId == null) return null;
    if (ownerKind === "hub") {
      const structure = findStructureById(state, ownerId);
      const def = structure ? hubStructureDefs[structure.defId] : null;
      return def?.name || structure?.defId || `Hub ${ownerId}`;
    }
    if (ownerKind === "env") {
      const tile = findTileById(state, ownerId);
      const def = tile ? envTileDefs[tile.defId] : null;
      return def?.name || tile?.defId || `Tile ${ownerId}`;
    }
    if (ownerKind === "pawn") {
      const pawn = findPawnById(state, ownerId);
      return pawn?.name || `Pawn ${ownerId}`;
    }
    return null;
  }

  function findStructureById(state, id) {
    const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    return null;
  }

  function findPawnById(state, id) {
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    for (const ch of chars) {
      if (!ch) continue;
      if (String(ch.id) === String(id)) return ch;
    }
    return null;
  }

  function findTileById(state, id) {
    const anchors = Array.isArray(state?.board?.layers?.tile?.anchors)
      ? state.board.layers.tile.anchors
      : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    return null;
  }

  function makeTargetRef(target) {
    if (!target) return null;
    const id = target.instanceId ?? target.id ?? null;
    if (id == null) return null;
    const isHub = !!hubStructureDefs[target.defId];
    const kind = isHub ? "hub" : "env";
    return { kind, id: String(id) };
  }

  function sameTargetRef(a, b) {
    if (!a || !b) return false;
    return a.kind === b.kind && String(a.id) === String(b.id);
  }

  function resolveTargetFromRef(state, ref) {
    if (!ref || !state) return null;
    if (ref.kind === "hub") return findStructureById(state, ref.id);
    if (ref.kind === "env") return findTileById(state, ref.id);
    return null;
  }

  function buildProcessSignature(targetKey, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const parts = [];
    for (const entry of entries) {
      const process = entry?.process;
      if (!process) continue;
      const routingSig = process.routing ? JSON.stringify(process.routing) : "";
      const reqSig = Array.isArray(process.requirements)
        ? process.requirements
            .map(
              (r) =>
                `${r.kind}:${r.itemId || r.tag || r.resource}:${r.progress ?? 0}:${r.amount ?? 0}`
            )
            .join("|")
        : "";
      const outSig = Array.isArray(process.outputs)
        ? process.outputs
            .map(
              (o) =>
                `${o.kind}:${o.itemId || o.resource || o.system || ""}:${o.qty ?? o.amount ?? 0}`
            )
            .join("|")
        : "";
      const progress = Number.isFinite(process.progress)
        ? Math.floor(process.progress)
        : 0;
      parts.push(`${process.id}|${progress}|${routingSig}|${reqSig}|${outSig}`);
    }
    return `${targetKey}|${parts.join("||")}`;
  }

  function clearContent(content, dropTargets) {
    if (content) content.removeChildren();
    if (Array.isArray(dropTargets)) dropTargets.length = 0;
  }

  function invalidateAllSignatures() {
    for (const win of windows.values()) {
      if (win) win.lastSignature = null;
    }
  }
  function drawCardBackground(bg, width, height) {
    bg.clear();
    bg.lineStyle(2, COLORS.panelBorder, 0.9);
    bg.beginFill(COLORS.panel, 0.96);
    bg.drawRoundedRect(0, 0, width, height, CARD_RADIUS);
    bg.endFill();
  }

  function drawModuleBox(bg, width, height) {
    bg.clear();
    bg.lineStyle(1, COLORS.moduleBorder, 0.9);
    bg.beginFill(COLORS.moduleBg, 0.95);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
  }

  function drawDrawerBox(bg, width, height) {
    bg.clear();
    bg.lineStyle(1, COLORS.drawerBorder, 0.9);
    bg.beginFill(COLORS.drawerBg, 0.95);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
  }

  function drawBufferBox(bg, width, height) {
    bg.clear();
    bg.lineStyle(1, COLORS.bufferBorder, 0.9);
    bg.beginFill(COLORS.bufferBg, 0.95);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
  }

  function layoutPillEntries(slotView) {
    const entries = slotView.pillEntries || [];
    let y = 0;
    for (const entry of entries) {
      entry.container.x = 0;
      entry.container.y = y;
      const rowHeight =
        entry.container?.height && entry.container.height > PILL_HEIGHT
          ? entry.container.height
          : PILL_HEIGHT;
      y += rowHeight + PILL_GAP;
    }
    if (entries.length > 0) y -= PILL_GAP;
    slotView.pillHeight = y;
  }

  function applyPillStyle(entry) {
    if (!entry) return;
    let bgColor = COLORS.pillEnabled;
    let textColor = COLORS.pillText;
    if (entry.locked) bgColor = COLORS.pillLocked;
    if (!entry.enabled) {
      bgColor = COLORS.pillDisabled;
      textColor = COLORS.pillTextDisabled;
    }
    if (entry.invalid) {
      bgColor = COLORS.pillInvalid;
      textColor = COLORS.pillTextInvalid;
    }

    entry.bg.clear();
    entry.bg.lineStyle(1, COLORS.panelBorder, 0.9);
    entry.bg.beginFill(bgColor, 0.95);
    entry.bg.drawRoundedRect(0, 0, entry.width, PILL_HEIGHT, PILL_RADIUS);
    entry.bg.endFill();

    entry.labelText.style.fill = textColor;
    entry.labelText.dirty = true;
  }

  function buildPillEntry(state, slotView, rawEndpointId, resolvedId, opts = {}) {
    const entryWidth = Math.max(60, slotView.entryWidth || 80);
    const entry = {
      endpointId: rawEndpointId,
      resolvedId,
      enabled: opts.enabled,
      invalid: opts.invalid,
      locked: opts.locked,
      draggable: opts.draggable,
      container: new PIXI.Container(),
      bg: new PIXI.Graphics(),
      labelText: null,
      width: entryWidth,
    };

    const row = entry.container;
    row.eventMode = "static";
    row.cursor = entry.draggable ? "grab" : entry.locked ? "default" : "pointer";

    row.addChild(entry.bg);

    const label = getEndpointLabel(state, resolvedId || rawEndpointId);
    const labelText = new PIXI.Text(label, {
      fill: COLORS.pillText,
      fontSize: 10,
    });
    labelText.x = PILL_PAD_X + TOGGLE_SIZE + TOGGLE_PAD;
    labelText.y = Math.round((PILL_HEIGHT - labelText.height) / 2);
    row.addChild(labelText);
    entry.labelText = labelText;

    const toggle = new PIXI.Graphics();
    toggle.x = PILL_PAD_X;
    toggle.y = Math.round((PILL_HEIGHT - TOGGLE_SIZE) / 2);
    row.addChild(toggle);

    toggle.clear();
    if (entry.locked) {
      toggle.lineStyle(1, COLORS.panelBorder, 0.9);
      toggle.drawRoundedRect(0, 0, TOGGLE_SIZE, TOGGLE_SIZE, 3);
    } else if (entry.enabled) {
      toggle.beginFill(0xd7ffe0, 1);
      toggle.drawCircle(TOGGLE_SIZE / 2, TOGGLE_SIZE / 2, 3);
      toggle.endFill();
    } else {
      toggle.lineStyle(2, 0xf2b0b0, 1);
      toggle.moveTo(2, 2);
      toggle.lineTo(TOGGLE_SIZE - 2, TOGGLE_SIZE - 2);
      toggle.moveTo(TOGGLE_SIZE - 2, 2);
      toggle.lineTo(2, TOGGLE_SIZE - 2);
    }

    applyPillStyle(entry);

    if (entry.draggable) {
      row.on("pointerdown", (ev) => {
        slotView.ignoreNextTap = false;
        routingDragController.startDrag(slotView, entry, ev);
      });
    }

    row.on("pointertap", () => {
      if (slotView.ignoreNextTap) {
        slotView.ignoreNextTap = false;
        return;
      }
      if (entry.locked) return;
      if (!entry.endpointId || !slotView.processId) return;
      const nextEnabled = !entry.enabled;
      queueActionWhenPaused?.(() =>
        dispatchAction?.(
          ActionKinds.TOGGLE_PROCESS_ROUTING_ENDPOINT,
          {
            processId: slotView.processId,
            slotKind: slotView.slotKind,
            slotId: slotView.slotId,
            endpointId: entry.endpointId,
            enabled: nextEnabled,
          },
          { apCost: 0 }
        )
      );
    });

    return entry;
  }

  function formatPoolSummary(poolTarget) {
    if (!poolTarget || poolTarget.kind !== "pool") return null;
    const pool = poolTarget.target;
    if (!pool || typeof pool !== "object") return null;
    const totals = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
    if (
      pool.bronze != null ||
      pool.silver != null ||
      pool.gold != null ||
      pool.diamond != null
    ) {
      totals.bronze = Math.max(0, Math.floor(pool.bronze ?? 0));
      totals.silver = Math.max(0, Math.floor(pool.silver ?? 0));
      totals.gold = Math.max(0, Math.floor(pool.gold ?? 0));
      totals.diamond = Math.max(0, Math.floor(pool.diamond ?? 0));
    } else {
      const keys = Object.keys(pool);
      for (const key of keys) {
        const bucket = pool[key];
        if (!bucket || typeof bucket !== "object") continue;
        totals.bronze += Math.max(0, Math.floor(bucket.bronze ?? 0));
        totals.silver += Math.max(0, Math.floor(bucket.silver ?? 0));
        totals.gold += Math.max(0, Math.floor(bucket.gold ?? 0));
        totals.diamond += Math.max(0, Math.floor(bucket.diamond ?? 0));
      }
    }
    return `B ${totals.bronze}  S ${totals.silver}  G ${totals.gold}  D ${totals.diamond}`;
  }

  function hasSelectableSlots(processDef, slotKind) {
    const slots = processDef?.routingSlots?.[slotKind] || [];
    return slots.some((slot) => slot && slot.locked !== true);
  }

  function getRequirementRows(reqs) {
    if (!Array.isArray(reqs) || reqs.length === 0) return [];
    if (reqs.length > 3) {
      let totalAmount = 0;
      let totalProgress = 0;
      for (const req of reqs) {
        totalAmount += Math.max(0, Math.floor(req.amount ?? 0));
        totalProgress += Math.max(0, Math.floor(req.progress ?? 0));
      }
      return [
        {
          label: "Items",
          progress: totalProgress,
          amount: totalAmount,
        },
      ];
    }
    return reqs.map((req) => ({
      label: formatRequirementLabel(req),
      progress: Math.max(0, Math.floor(req.progress ?? 0)),
      amount: Math.max(0, Math.floor(req.amount ?? 0)),
    }));
  }

  function getPrestigeTotals(process) {
    const totals = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
    const byKind = process?.consumedByKindTier || null;
    if (!byKind || typeof byKind !== "object") return totals;
    for (const bucket of Object.values(byKind)) {
      if (!bucket || typeof bucket !== "object") continue;
      totals.bronze += Math.max(0, Math.floor(bucket.bronze ?? 0));
      totals.silver += Math.max(0, Math.floor(bucket.silver ?? 0));
      totals.gold += Math.max(0, Math.floor(bucket.gold ?? 0));
      totals.diamond += Math.max(0, Math.floor(bucket.diamond ?? 0));
    }
    return totals;
  }

  function resolveLockedOutputEndpoint(process, processDef, output) {
    if (!processDef || !output) return null;
    const slots = processDef.routingSlots?.outputs || [];
    const slot =
      output.slotId && slots.find((s) => s?.slotId === output.slotId)
        ? slots.find((s) => s?.slotId === output.slotId)
        : slots[0] || null;
    if (!slot || !slot.locked) return null;
    const endpointId =
      resolveFixedEndpointId(slot.candidateRule?.endpointId, process, {
        leaderId: process?.leaderId ?? null,
      }) || (Array.isArray(slot.default?.ordered) ? slot.default.ordered[0] : null);
    return endpointId || null;
  }
  function buildProgressModule({
    container,
    width,
    process,
    processDef,
    vertical,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const labelText = new PIXI.Text(
      vertical ? "Progress: Time" : "Progress: Work",
      {
        fill: COLORS.moduleSub,
        fontSize: 10,
      }
    );
    labelText.x = MODULE_PAD;
    labelText.y = MODULE_PAD;
    container.addChild(labelText);

    const duration = Math.max(1, Math.floor(processDef?.transform?.durationSec ?? 1));
    const progress = Math.max(0, Math.floor(process?.progress ?? 0));
    const ratio = Math.min(1, progress / duration);

    if (vertical) {
      const barWidth = 14;
      const barHeight = 40;
      const barX = Math.floor((width - barWidth) / 2);
      const barY = labelText.y + 14;

      const barBg = new PIXI.Graphics();
      barBg.beginFill(COLORS.progressBg, 1);
      barBg.drawRoundedRect(barX, barY, barWidth, barHeight, 6);
      barBg.endFill();
      container.addChild(barBg);

      const fillHeight = Math.max(2, barHeight * ratio);
      const fill = new PIXI.Graphics();
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(
        barX,
        barY + (barHeight - fillHeight),
        barWidth,
        fillHeight,
        6
      );
      fill.endFill();
      container.addChild(fill);

      const remain = Math.max(0, duration - progress);
      const timeText = new PIXI.Text(`${remain}s`, {
        fill: COLORS.moduleSub,
        fontSize: 10,
      });
      timeText.x = Math.floor((width - timeText.width) / 2);
      timeText.y = barY + barHeight + 4;
      container.addChild(timeText);
    } else {
      const barWidth = width - MODULE_PAD * 2;
      const barHeight = 10;
      const barX = MODULE_PAD;
      const barY = labelText.y + 16;

      const barBg = new PIXI.Graphics();
      barBg.beginFill(COLORS.progressBg, 1);
      barBg.drawRoundedRect(barX, barY, barWidth, barHeight, 6);
      barBg.endFill();
      container.addChild(barBg);

      const fillWidth = Math.max(2, barWidth * ratio);
      const fill = new PIXI.Graphics();
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(barX, barY, fillWidth, barHeight, 6);
      fill.endFill();
      container.addChild(fill);

      const remain = Math.max(0, duration - progress);
      const timeText = new PIXI.Text(`${remain}s`, {
        fill: COLORS.moduleSub,
        fontSize: 10,
      });
      timeText.x = Math.floor((width - timeText.width) / 2);
      timeText.y = barY + barHeight + 6;
      container.addChild(timeText);
    }

    const height = Math.max(56, container.height + MODULE_PAD);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildGrowthProgressModule({ container, width, entries }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const labelText = new PIXI.Text("Progress: Time", {
      fill: COLORS.moduleSub,
      fontSize: 10,
    });
    labelText.x = MODULE_PAD;
    labelText.y = MODULE_PAD;
    container.addChild(labelText);

    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) {
      const none = new PIXI.Text("No crops growing", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = labelText.y + 16;
      container.addChild(none);

      const height = Math.max(56, none.y + 18);
      drawModuleBox(bg, width, height);
      return height;
    }

    const barHeight = 40;
    const barGap = 8;
    const barAreaWidth = width - MODULE_PAD * 2;
    const count = list.length;
    const maxBarWidth = 12;
    const barWidthRaw = Math.floor(
      (barAreaWidth - barGap * (count - 1)) / count
    );
    const barWidth = Math.max(6, Math.min(maxBarWidth, barWidthRaw));
    const totalBarsWidth =
      barWidth * count + barGap * Math.max(0, count - 1);
    const startX = Math.floor(MODULE_PAD + (barAreaWidth - totalBarsWidth) / 2);
    const barY = labelText.y + 16;

    list.forEach((entry, index) => {
      const process = entry?.process || null;
      const processDef = entry?.processDef || null;
      const duration = Math.max(
        1,
        Math.floor(
          processDef?.transform?.durationSec ?? process?.durationSec ?? 1
        )
      );
      const progress = Math.max(0, Math.floor(process?.progress ?? 0));
      const ratio = Math.min(1, progress / duration);
      const remain = Math.max(0, duration - progress);

      const x = startX + index * (barWidth + barGap);
      const barBg = new PIXI.Graphics();
      barBg.beginFill(COLORS.progressBg, 1);
      barBg.drawRoundedRect(x, barY, barWidth, barHeight, 6);
      barBg.endFill();
      container.addChild(barBg);

      const fillHeight = Math.max(2, barHeight * ratio);
      const fill = new PIXI.Graphics();
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(
        x,
        barY + (barHeight - fillHeight),
        barWidth,
        fillHeight,
        6
      );
      fill.endFill();
      container.addChild(fill);

      const timeText = new PIXI.Text(`${remain}s`, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      timeText.x = x + Math.max(0, Math.floor((barWidth - timeText.width) / 2));
      timeText.y = barY + barHeight + 4;
      container.addChild(timeText);
    });

    const height = Math.max(56, barY + barHeight + 18);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildRequirementsModule({ container, width, reqs }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Materials", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    let y = title.y + 14;
    const rows = getRequirementRows(reqs);
    if (rows.length === 0) {
      const none = new PIXI.Text("None", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = y;
      container.addChild(none);
      y += 12;
    } else {
      for (const row of rows) {
        const label = new PIXI.Text(
          `${row.label} ${row.progress}/${row.amount}`,
          {
            fill: COLORS.moduleSub,
            fontSize: 9,
          }
        );
        label.x = MODULE_PAD;
        label.y = y;
        container.addChild(label);

        const barWidth = width - MODULE_PAD * 2;
        const barHeight = 6;
        const barY = y + 10;
        const ratio = row.amount > 0 ? Math.min(1, row.progress / row.amount) : 0;

        const barBg = new PIXI.Graphics();
        barBg.beginFill(COLORS.progressBg, 1);
        barBg.drawRoundedRect(MODULE_PAD, barY, barWidth, barHeight, 4);
        barBg.endFill();
        container.addChild(barBg);

        const fill = new PIXI.Graphics();
        fill.beginFill(COLORS.progressFill, 1);
        fill.drawRoundedRect(
          MODULE_PAD,
          barY,
          Math.max(2, barWidth * ratio),
          barHeight,
          4
        );
        fill.endFill();
        container.addChild(fill);

        y += 18;
      }
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildOutputModule({ container, width, outputs, poolSummary }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Output", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    let y = title.y + 14;
    if (!Array.isArray(outputs) || outputs.length === 0) {
      const none = new PIXI.Text("None", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = y;
      container.addChild(none);
      y += 12;
    } else {
      const primary = outputs[0];
      const label = formatOutputLabel(primary);
      const qty = Math.max(0, Math.floor(primary.qty ?? primary.amount ?? 0));
      const lineText = primary.kind === "pool" && primary.fromLedger
        ? label
        : qty > 1
          ? `${label} x${qty}`
          : label;

      const line = new PIXI.Text(lineText, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      line.x = MODULE_PAD;
      line.y = y;
      container.addChild(line);
      y += 12;

      if (poolSummary) {
        const poolText = new PIXI.Text(poolSummary, {
          fill: COLORS.moduleSub,
          fontSize: 9,
        });
        poolText.x = MODULE_PAD;
        poolText.y = y;
        container.addChild(poolText);
        y += 12;
      }

      if (outputs.length > 1) {
        const more = new PIXI.Text(`+${outputs.length - 1} more`, {
          fill: COLORS.moduleSub,
          fontSize: 9,
        });
        more.x = MODULE_PAD;
        more.y = y;
        container.addChild(more);
        y += 12;
      }
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildGrowthOutputModule({ container, width, pool }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Matured Pool", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    let y = title.y + 14;
    const summary = formatPoolSummary({ kind: "pool", target: pool });
    if (!summary) {
      const none = new PIXI.Text("None", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = y;
      container.addChild(none);
      y += 12;
    } else {
      const poolText = new PIXI.Text(summary, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      poolText.x = MODULE_PAD;
      poolText.y = y;
      container.addChild(poolText);
      y += 12;
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildPrestigeModule({ container, width, process }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Prestige", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    const totals = getPrestigeTotals(process);
    const rows = [
      { key: "bronze", label: "B", value: totals.bronze },
      { key: "silver", label: "S", value: totals.silver },
      { key: "gold", label: "G", value: totals.gold },
      { key: "diamond", label: "D", value: totals.diamond },
    ];
    const max = Math.max(1, ...rows.map((r) => r.value));

    let y = title.y + 14;
    const barWidth = width - MODULE_PAD * 2 - 16;
    for (const row of rows) {
      const label = new PIXI.Text(row.label, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      label.x = MODULE_PAD;
      label.y = y;
      container.addChild(label);

      const ratio = Math.min(1, row.value / max);
      const barBg = new PIXI.Graphics();
      barBg.beginFill(COLORS.progressBg, 1);
      barBg.drawRoundedRect(MODULE_PAD + 12, y + 2, barWidth, 6, 4);
      barBg.endFill();
      container.addChild(barBg);

      const fill = new PIXI.Graphics();
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(
        MODULE_PAD + 12,
        y + 2,
        Math.max(2, barWidth * ratio),
        6,
        4
      );
      fill.endFill();
      container.addChild(fill);

      y += 12;
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildBufferModule({ container, width, height, process, dropTargets }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const size = Math.min(width, height);
    const slot = new PIXI.Graphics();
    slot.lineStyle(1, COLORS.bufferBorder, 0.9);
    slot.beginFill(0x1a2034, 0.95);
    slot.drawRoundedRect(0, 0, size, size, 8);
    slot.endFill();
    slot.x = Math.floor((width - size) / 2);
    slot.y = Math.floor((height - size) / 2) - 6;
    container.addChild(slot);

    const label = new PIXI.Text("Buffer", {
      fill: COLORS.moduleSub,
      fontSize: 9,
    });
    label.x = Math.floor((width - label.width) / 2);
    label.y = slot.y + size + 4;
    container.addChild(label);

    const dropId = getDropEndpointId(process?.id);
    if (dropId && Array.isArray(dropTargets)) {
      dropTargets.push({
        ownerId: dropId,
        getBounds: () => slot.getBounds(),
      });

      slot.eventMode = "static";
      slot.cursor = "pointer";
      slot.on("pointertap", () => {
        inventoryView?.revealWindow?.(dropId, { pinned: true });
      });
    }

    drawBufferBox(bg, width, height);
  }

  function buildRoutingDrawer({
    kind,
    width,
    height,
    process,
    processDef,
    target,
    state,
    hideDrop,
  }) {
    const container = new PIXI.Container();
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const key = `${process.id}:${kind}`;
    const expanded = drawerExpanded[kind].has(key);

    const arrow = new PIXI.Text(expanded ? (kind === "inputs" ? "<" : ">") : (kind === "inputs" ? ">" : "<"), {
      fill: COLORS.headerSub,
      fontSize: 12,
    });
    arrow.eventMode = "static";
    arrow.cursor = "pointer";
    arrow.x = Math.floor((width - arrow.width) / 2);
    arrow.y = 6;
    arrow.on("pointertap", () => {
      if (expanded) drawerExpanded[kind].delete(key);
      else drawerExpanded[kind].add(key);
      invalidateAllSignatures();
    });
    container.addChild(arrow);

    if (expanded) {
      let y = 22;
      const slots = processDef?.routingSlots?.[kind] || [];
      const context = { leaderId: process?.leaderId ?? null };
      for (const slotDef of slots) {
        if (!slotDef || slotDef.locked) continue;

        const label = new PIXI.Text(slotDef.label || slotDef.slotId, {
          fill: COLORS.moduleText,
          fontSize: 10,
          fontWeight: "bold",
        });
        label.x = MODULE_PAD;
        label.y = y;
        container.addChild(label);
        y += 14;

        const slotState =
          process?.routing?.[kind]?.[slotDef.slotId] || {
            ordered: [],
            enabled: {},
          };
        const orderedRaw = Array.isArray(slotState.ordered)
          ? slotState.ordered
          : [];

        const candidates = listCandidateEndpoints(state, process, slotDef, target, context);

        const pillContainer = new PIXI.Container();
        pillContainer.x = MODULE_PAD;
        pillContainer.y = y;
        container.addChild(pillContainer);

        const slotView = {
          processId: process.id,
          slotKind: kind,
          slotId: slotDef.slotId,
          slotLocked: false,
          pillContainer,
          pillEntries: [],
          ignoreNextTap: false,
          entryWidth: width - MODULE_PAD * 2,
        };

        for (const rawEndpointId of orderedRaw) {
          const resolvedId =
            resolveFixedEndpointId(rawEndpointId, process, context) || rawEndpointId;
          const isDrop = isDropEndpoint(resolvedId) && processDef.supportsDropslot;
          if (hideDrop && isDrop) continue;
          const enabled = slotState.enabled?.[rawEndpointId] !== false;
          const valid = isDrop || candidates.includes(resolvedId);
          const entry = buildPillEntry(state, slotView, rawEndpointId, resolvedId, {
            enabled,
            invalid: !valid,
            locked: isDrop,
            draggable: !isDrop,
          });
          pillContainer.addChild(entry.container);
          slotView.pillEntries.push(entry);
        }

        layoutPillEntries(slotView);
        y += slotView.pillHeight + MODULE_GAP;
      }
    }

    drawDrawerBox(bg, width, height);

    return { container };
  }
  function buildProcessCard(state, target, entry, index, count, opts = {}) {
    const process = entry.process;
    const processDef = entry.processDef;
    const targetLabel = getTargetLabel(target);
    const isGrowthGroup = opts.groupMode === "growth";
    const growthEntries = Array.isArray(opts.groupEntries)
      ? opts.groupEntries
      : null;

    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const showBuffer = !!processDef?.supportsDropslot;
    const inputDrawerVisible = hasSelectableSlots(processDef, "inputs");
    const outputDrawerVisible = hasSelectableSlots(processDef, "outputs");

    const leftDrawerWidth = inputDrawerVisible
      ? drawerExpanded.inputs.has(`${process.id}:inputs`)
        ? DRAWER_EXPANDED
        : DRAWER_COLLAPSED
      : 0;
    const rightDrawerWidth = outputDrawerVisible
      ? drawerExpanded.outputs.has(`${process.id}:outputs`)
        ? DRAWER_EXPANDED
        : DRAWER_COLLAPSED
      : 0;

    const bufferGap = showBuffer ? SEGMENT_GAP : 0;
    const centralWidth = Math.max(120, CORE_WIDTH - (showBuffer ? (BUFFER_SIZE + bufferGap) : 0));

    const segments = [];
    if (inputDrawerVisible) segments.push({ key: "left", width: leftDrawerWidth });
    if (showBuffer) segments.push({ key: "buffer", width: BUFFER_SIZE });
    segments.push({ key: "central", width: centralWidth });
    if (outputDrawerVisible) segments.push({ key: "right", width: rightDrawerWidth });

    let x = 0;
    for (let i = 0; i < segments.length; i++) {
      segments[i].x = x;
      x += segments[i].width;
      if (i < segments.length - 1) x += SEGMENT_GAP;
    }
    const totalWidth = x;

    const title = getCardTitle(targetLabel, process, processDef);
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(process, target),
      onClose: () => opts.onClose?.(process, target),
    });
    headerUi.setPinned(!!pinned);

    if (isGrowthGroup && growthEntries) {
      const batchText = new PIXI.Text(`${growthEntries.length} batches`, {
        fill: COLORS.headerSub,
        fontSize: 9,
      });
      batchText.x = headerUi.titleText.x + headerUi.titleText.width + 6;
      batchText.y = HEADER_PAD_Y + 1;
      headerUi.container.addChild(batchText);
    } else if (count > 1) {
      const idxText = new PIXI.Text(`${index + 1}/${count}`, {
        fill: COLORS.headerSub,
        fontSize: 9,
      });
      idxText.x = headerUi.titleText.x + headerUi.titleText.width + 6;
      idxText.y = HEADER_PAD_Y + 1;
      headerUi.container.addChild(idxText);
    }

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const bodyHeightTarget = 70;

    const central = new PIXI.Container();
    central.x = segments.find((s) => s.key === "central").x;
    central.y = BODY_PAD;
    body.addChild(central);

    const variant = getProcessVariant(process, processDef);
    const outputs = Array.isArray(processDef?.transform?.outputs)
      ? processDef.transform.outputs
      : [];
    const reqs = Array.isArray(processDef?.transform?.requirements)
      ? processDef.transform.requirements
      : [];

    const modules = [];
    if (variant === "growing") {
      modules.push("progress", "output");
    } else if (variant === "depositing") {
      modules.push("prestige", "output");
    } else if (variant === "building") {
      modules.push("requirements", "progress");
    } else if (variant === "cooking" || variant === "crafting") {
      modules.push("requirements", "progress", "output");
    } else {
      modules.push("requirements", "progress", "output");
    }

    const filteredModules = modules.filter((id) => {
      if (id === "requirements") return reqs.length > 0;
      if (id === "output") return isGrowthGroup ? true : outputs.length > 0;
      return true;
    });

    const moduleCount = filteredModules.length || 1;
    const moduleWidth = Math.floor((centralWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount);

    let moduleX = 0;
    let moduleMaxHeight = 0;

    for (const id of filteredModules) {
      const mod = new PIXI.Container();
      mod.x = moduleX;
      mod.y = 0;
      central.addChild(mod);

      let height = 0;
      if (id === "progress") {
        if (isGrowthGroup) {
          height = buildGrowthProgressModule({
            container: mod,
            width: moduleWidth,
            entries: growthEntries,
          });
        } else {
          const vertical = processDef?.transform?.mode !== "work";
          height = buildProgressModule({
            container: mod,
            width: moduleWidth,
            process,
            processDef,
            vertical,
          });
        }
      } else if (id === "requirements") {
        height = buildRequirementsModule({
          container: mod,
          width: moduleWidth,
          reqs,
        });
      } else if (id === "output") {
        if (isGrowthGroup) {
          const pool = target?.systemState?.growth?.maturedPool || null;
          height = buildGrowthOutputModule({
            container: mod,
            width: moduleWidth,
            pool,
          });
        } else {
          const primaryPool = outputs.find((out) => out?.kind === "pool");
          let poolSummary = null;
          if (primaryPool) {
            const endpointId = resolveLockedOutputEndpoint(
              process,
              processDef,
              primaryPool
            );
            if (endpointId) {
              const poolTarget = resolveEndpointTarget(state, endpointId);
              poolSummary = formatPoolSummary(poolTarget);
            }
          }
          height = buildOutputModule({
            container: mod,
            width: moduleWidth,
            outputs,
            poolSummary,
          });
        }
      } else if (id === "prestige") {
        height = buildPrestigeModule({
          container: mod,
          width: moduleWidth,
          process,
        });
      }

      moduleMaxHeight = Math.max(moduleMaxHeight, height);
      moduleX += moduleWidth + MODULE_GAP;
    }

    central.y = BODY_PAD;
    central.height = moduleMaxHeight;

    let leftDrawer = null;
    let rightDrawer = null;

    if (inputDrawerVisible) {
      leftDrawer = buildRoutingDrawer({
        kind: "inputs",
        width: leftDrawerWidth,
        height: bodyHeightTarget,
        process,
        processDef,
        target,
        state,
        hideDrop: showBuffer,
      });
      leftDrawer.container.x = segments.find((s) => s.key === "left").x;
      leftDrawer.container.y = BODY_PAD;
      body.addChild(leftDrawer.container);
    }

    let buffer = null;
    if (showBuffer) {
      buffer = new PIXI.Container();
      buffer.x = segments.find((s) => s.key === "buffer").x;
      buffer.y = BODY_PAD;
      body.addChild(buffer);
    }

    if (outputDrawerVisible) {
      rightDrawer = buildRoutingDrawer({
        kind: "outputs",
        width: rightDrawerWidth,
        height: bodyHeightTarget,
        process,
        processDef,
        target,
        state,
        hideDrop: false,
      });
      rightDrawer.container.x = segments.find((s) => s.key === "right").x;
      rightDrawer.container.y = BODY_PAD;
      body.addChild(rightDrawer.container);
    }

    const leftHeight = leftDrawer?.container?.height || 0;
    const rightHeight = rightDrawer?.container?.height || 0;
    const bufferHeight = showBuffer ? BUFFER_SIZE + 18 : 0;
    const bodyContentHeight = Math.max(
      moduleMaxHeight,
      leftHeight,
      rightHeight,
      bufferHeight,
      bodyHeightTarget
    );

    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    if (leftDrawer) {
      drawDrawerBox(leftDrawer.container.children[0], leftDrawerWidth, bodyContentHeight);
      leftDrawer.container.height = bodyContentHeight;
    }
    if (rightDrawer) {
      drawDrawerBox(rightDrawer.container.children[0], rightDrawerWidth, bodyContentHeight);
      rightDrawer.container.height = bodyContentHeight;
    }

    if (showBuffer && buffer) {
      buildBufferModule({
        container: buffer,
        width: BUFFER_SIZE,
        height: bodyContentHeight,
        process,
        dropTargets: opts.dropTargets,
      });
    }

    central.y = BODY_PAD;
    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, centralWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  function rebuildWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    let y = 0;
    const count = entries.length;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry?.process || !entry?.processDef) continue;
      const built = buildProcessCard(state, target, entry, i, count, cardOpts);
      built.card.y = y;
      content.addChild(built.card);
      y += built.height + CARD_GAP;
    }
  }

  function buildGrowthEmptyCard(state, target, opts = {}) {
    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const totalWidth = CORE_WIDTH;
    const title = `${getTargetLabel(target)} - Growing`;
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!pinned);

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const central = new PIXI.Container();
    central.x = 0;
    central.y = BODY_PAD;
    body.addChild(central);

    const moduleCount = 2;
    const moduleWidth = Math.floor(
      (totalWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount
    );

    let moduleX = 0;
    let moduleMaxHeight = 0;

    const progressMod = new PIXI.Container();
    progressMod.x = moduleX;
    progressMod.y = 0;
    central.addChild(progressMod);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildGrowthProgressModule({
        container: progressMod,
        width: moduleWidth,
        entries: [],
      })
    );
    moduleX += moduleWidth + MODULE_GAP;

    const outputMod = new PIXI.Container();
    outputMod.x = moduleX;
    outputMod.y = 0;
    central.addChild(outputMod);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildGrowthOutputModule({
        container: outputMod,
        width: moduleWidth,
        pool: target?.systemState?.growth?.maturedPool || null,
      })
    );

    central.height = moduleMaxHeight;

    const bodyContentHeight = Math.max(moduleMaxHeight, 70);
    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, totalWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  function buildGrowthSignature(targetKey, target, entries) {
    const growth = target?.systemState?.growth || {};
    const cropId = growth.selectedCropId || "";
    const pool = growth.maturedPool || {};
    const poolSig = `${
      pool.bronze ?? 0
    }:${pool.silver ?? 0}:${pool.gold ?? 0}:${pool.diamond ?? 0}`;
    const baseSig = buildProcessSignature(targetKey, entries) || "empty";
    return `growth:${targetKey}:${cropId}:${poolSig}:${baseSig}`;
  }

  function rebuildGrowthWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    if (!Array.isArray(entries) || entries.length === 0) {
      const built = buildGrowthEmptyCard(state, target, cardOpts);
      built.card.y = 0;
      content.addChild(built.card);
      return;
    }

    const primary = entries[0];
    const built = buildProcessCard(state, target, primary, 0, 1, {
      ...cardOpts,
      groupMode: "growth",
      groupEntries: entries,
    });
    built.card.y = 0;
    content.addChild(built.card);
  }

  function collectProcessEntries(state, target, systemIdFilter) {
    const processes = collectProcesses(target);
    const filtered = systemIdFilter
      ? processes.filter((entry) => entry.systemId === systemIdFilter)
      : processes;
    return filtered
      .map((entry) => {
        const processDef = getProcessDefForInstance(
          entry.process,
          target,
          { leaderId: entry.process?.leaderId ?? null }
        );
        return { ...entry, processDef };
      })
      .filter((entry) => entry.processDef);
  }

  function findProcessEntryById(target, processId) {
    if (!target || !processId) return null;
    const processes = collectProcesses(target);
    for (const entry of processes) {
      if (entry?.process?.id === processId) return entry;
    }
    return null;
  }

  function positionWindow(win, origin, offsetIndex, force = false) {
    if (!win || (!force && win.hasPosition)) return;
    const baseX = Number.isFinite(origin?.x) ? origin.x : position.x;
    const baseY = Number.isFinite(origin?.y) ? origin.y : position.y;
    const idx = Number.isFinite(offsetIndex) ? Math.max(0, Math.floor(offsetIndex)) : 0;
    const offset = 24 * idx;
    win.container.x = baseX + offset;
    win.container.y = baseY + offset;
    win.hasPosition = true;
  }

  function ensureWindow(windowId, target, systemId, origin, offsetIndex, opts = {}) {
    if (!windowId) return null;
    const targetRef = makeTargetRef(target);
    let win = windows.get(windowId);
    if (win) {
      if (targetRef) win.targetRef = targetRef;
      if (systemId != null) win.systemId = systemId;
      return win;
    }

    const container = new PIXI.Container();
    container.zIndex = 130;
    layer.addChild(container);

    const content = new PIXI.Container();
    container.addChild(content);

    win = {
      windowId,
      processId: opts.processId || null,
      group: opts.group === true,
      targetRef,
      systemId: systemId || null,
      container,
      content,
      dropTargets: [],
      lastSignature: null,
      pinned: false,
      hovered: false,
      hasPosition: false,
    };
    windows.set(windowId, win);
    positionWindow(win, origin, offsetIndex, true);
    return win;
  }

  function hideWindow(windowId) {
    const win = windows.get(windowId);
    if (!win) return;
    win.pinned = false;
    win.hovered = false;
    if (win.container) win.container.visible = false;
  }

  function destroyWindow(windowId) {
    const win = windows.get(windowId);
    if (!win) return;
    win.container?.parent?.removeChild?.(win.container);
    win.container?.destroy?.({ children: true });
    windows.delete(windowId);
  }

  function setWindowPinned(windowId, pinned) {
    const win = windows.get(windowId);
    if (!win) return;
    win.pinned = !!pinned;
    if (!win.pinned && !win.hovered) {
      win.container.visible = false;
    } else {
      win.container.visible = true;
    }
    win.lastSignature = null;
  }

  function togglePinnedWindow(windowId) {
    const win = windows.get(windowId);
    if (!win) return;
    setWindowPinned(windowId, !win.pinned);
  }

  function updateHoverWindows(state) {
    const hoverIds = new Set();
    if (hoverContext?.targetRef) {
      const target = resolveTargetFromRef(state, hoverContext.targetRef);
      if (target) {
        if (isGroupedSystem(hoverContext.systemId)) {
          const windowId = `group:${hoverContext.systemId}:${getTargetKey(target)}`;
          const win = ensureWindow(
            windowId,
            target,
            hoverContext.systemId,
            { x: position.x, y: position.y },
            0,
            { group: true }
          );
          win.hovered = true;
          hoverIds.add(windowId);
          if (!win.pinned) win.container.visible = true;
          if (!win.hasPosition) {
            positionWindow(win, { x: position.x, y: position.y }, 0, true);
          }
        } else {
          const entries = collectProcessEntries(state, target, hoverContext.systemId);
          let offsetIndex = 0;
          for (const entry of entries) {
            const processId = entry?.process?.id;
            if (!processId) continue;
            const win = ensureWindow(
              processId,
              target,
              hoverContext.systemId,
              { x: position.x, y: position.y },
              offsetIndex,
              { processId }
            );
            win.hovered = true;
            hoverIds.add(processId);
            if (!win.pinned) {
              win.container.visible = true;
            }
            if (!win.hasPosition) {
              positionWindow(
                win,
                { x: position.x, y: position.y },
                offsetIndex,
                true
              );
            }
            offsetIndex += 1;
          }
        }
      }
    }

    for (const [windowId, win] of windows.entries()) {
      if (!win.hovered) continue;
      if (hoverIds.has(windowId)) continue;
      win.hovered = false;
      if (!win.pinned) win.container.visible = false;
    }
  }

  function update() {
    const state = getStateSafe();
    if (!state) {
      for (const win of windows.values()) {
        if (win?.container) win.container.visible = false;
      }
      return;
    }

    updateHoverWindows(state);

    for (const [windowId, win] of windows.entries()) {
      const target = resolveTargetFromRef(state, win.targetRef);
      if (!target) {
        destroyWindow(windowId);
        continue;
      }
      if (win.group) {
        const entries = collectProcessEntries(state, target, win.systemId);
        const visible = win.pinned || win.hovered;
        if (!visible) {
          win.container.visible = false;
          continue;
        }
        const signatureKey = `${windowId}|${getTargetKey(target)}`;
        const signature = buildGrowthSignature(signatureKey, target, entries);
        if (signature !== win.lastSignature) {
          win.lastSignature = signature;
          rebuildGrowthWidget(state, target, entries, {
            content: win.content,
            dropTargets: win.dropTargets,
            cardOpts: {
              dragTarget: win.container,
              pinned: win.pinned,
              onPinToggle: () => togglePinnedWindow(windowId),
              onClose: () => hideWindow(windowId),
            },
          });
        }
        win.container.visible = true;
        continue;
      }

      const entry = findProcessEntryById(target, win.processId || windowId);
      if (!entry) {
        destroyWindow(windowId);
        continue;
      }
      const processDef = getProcessDefForInstance(
        entry.process,
        target,
        { leaderId: entry.process?.leaderId ?? null }
      );
      if (!processDef) {
        destroyWindow(windowId);
        continue;
      }

      const visible = win.pinned || win.hovered;
      if (!visible) {
        win.container.visible = false;
        continue;
      }

      const entries = [{ ...entry, processDef }];
      const signatureKey = `${windowId}|${getTargetKey(target)}`;
      const signature = buildProcessSignature(signatureKey, entries);
      if (signature !== win.lastSignature) {
        win.lastSignature = signature;
        rebuildWidget(state, target, entries, {
          content: win.content,
          dropTargets: win.dropTargets,
          cardOpts: {
            dragTarget: win.container,
            pinned: win.pinned,
            onPinToggle: () => togglePinnedWindow(windowId),
            onClose: () => hideWindow(windowId),
          },
        });
      }
      win.container.visible = true;
    }
  }

  function getDropTargetOwnerAtGlobalPos(globalPos) {
    if (!globalPos) return null;
    for (const win of windows.values()) {
      if (!win?.container?.visible) continue;
      for (const target of win.dropTargets || []) {
        if (!target || !target.getBounds) continue;
        const bounds = target.getBounds();
        if (
          globalPos.x >= bounds.x &&
          globalPos.x <= bounds.x + bounds.width &&
          globalPos.y >= bounds.y &&
          globalPos.y <= bounds.y + bounds.height
        ) {
          return target.ownerId;
        }
      }
    }
    return null;
  }

  function setHoverTarget(target, systemId) {
    hoverContext = target
      ? { targetRef: makeTargetRef(target), systemId: systemId || null }
      : null;
    invalidateAllSignatures();
  }

  function clearHoverTarget() {
    hoverContext = null;
    for (const win of windows.values()) {
      if (!win.hovered) continue;
      win.hovered = false;
      if (!win.pinned) win.container.visible = false;
    }
    invalidateAllSignatures();
  }

  function togglePinnedTarget(target, systemId) {
    const state = getStateSafe();
    if (!state || !target) return;
    if (isGroupedSystem(systemId)) {
      const windowId = `group:${systemId}:${getTargetKey(target)}`;
      const win = ensureWindow(
        windowId,
        target,
        systemId,
        { x: position.x, y: position.y },
        0,
        { group: true }
      );
      const nextPinned = !win?.pinned;
      setWindowPinned(windowId, nextPinned);
      return;
    }

    const entries = collectProcessEntries(state, target, systemId);
    if (entries.length === 0) return;
    const ids = entries
      .map((entry) => entry?.process?.id)
      .filter((id) => !!id);
    if (ids.length === 0) return;
    const anyUnpinned = ids.some((id) => !windows.get(id)?.pinned);
    let offsetIndex = 0;
    for (const entry of entries) {
      const processId = entry?.process?.id;
      if (!processId) continue;
      ensureWindow(
        processId,
        target,
        systemId,
        { x: position.x, y: position.y },
        offsetIndex,
        { processId }
      );
      if (anyUnpinned) {
        setWindowPinned(processId, true);
      } else {
        setWindowPinned(processId, false);
      }
      offsetIndex += 1;
    }
  }

  function init() {}

  return {
    init,
    update,
    getDropTargetOwnerAtGlobalPos,
    setHoverTarget,
    clearHoverTarget,
    togglePinnedTarget,
  };
}
