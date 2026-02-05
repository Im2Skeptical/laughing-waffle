// process-widget-pixi.js
// Minimal process inspector with routing editor.

import { ActionKinds } from "../model/actions.js";
import {
  getProcessDefForInstance,
  isDropEndpoint,
  listCandidateEndpoints,
  resolveFixedEndpointId,
} from "../model/process-framework.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { createPillDragController } from "./pill-drag-controller.js";

const PANEL_WIDTH = 360;
const HEADER_HEIGHT = 28;
const TAB_HEIGHT = 24;
const PADDING = 12;
const SECTION_GAP = 10;
const ROW_GAP = 6;

const PILL_HEIGHT = 20;
const PILL_RADIUS = 10;
const PILL_GAP = 6;
const PILL_PAD_X = 10;
const TOGGLE_SIZE = 10;
const TOGGLE_PAD = 6;

const COLORS = {
  panel: 0x1a1f2f,
  panelBorder: 0x30384f,
  headerText: 0xffffff,
  subText: 0x9aa0b5,
  tabActive: 0x2a3958,
  tabInactive: 0x1f263d,
  tabText: 0xffffff,
  slotText: 0xe6eef9,
  pillEnabled: 0x2a3958,
  pillDisabled: 0x2a2f3d,
  pillInvalid: 0x4b252c,
  pillLocked: 0x232a3d,
  pillText: 0xe6eef9,
  pillTextDisabled: 0x99a2b5,
  pillTextInvalid: 0xf2b0b0,
  progressBg: 0x2a2f45,
  progressFill: 0x7ccf6b,
};

const TAB_IDS = ["transform", "inputs", "outputs"];

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
  const container = new PIXI.Container();
  container.x = position.x;
  container.y = position.y;
  container.zIndex = 120;
  container.visible = false;
  layer.addChild(container);

  const bg = new PIXI.Graphics();
  container.addChild(bg);

  const content = new PIXI.Container();
  container.addChild(content);

  const dropTargets = [];

  let activeTab = "inputs";
  let lastSignature = null;
  let activeTargetKey = null;
  let selectedProcessId = null;
  const expandedSlots = new Set();

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

  function buildProcessSignature(targetKey, process, processDef) {
    if (!process || !processDef) return null;
    const routingSig = process.routing ? JSON.stringify(process.routing) : "";
    const reqSig = Array.isArray(process.requirements)
      ? process.requirements
          .map((r) => `${r.kind}:${r.itemId || r.tag || r.resource}:${r.progress ?? 0}:${r.amount ?? 0}`)
          .join("|")
      : "";
    const outSig = Array.isArray(process.outputs)
      ? process.outputs
          .map((o) => `${o.kind}:${o.itemId || o.resource || o.system || ""}:${o.qty ?? o.amount ?? 0}`)
          .join("|")
      : "";
    const progress = Number.isFinite(process.progress) ? Math.floor(process.progress) : 0;
    return `${targetKey}|${process.id}|${activeTab}|${progress}|${routingSig}|${reqSig}|${outSig}`;
  }

  function clearContent() {
    content.removeChildren();
    dropTargets.length = 0;
  }

  function drawPanel(height) {
    bg.clear();
    bg.lineStyle(2, COLORS.panelBorder, 0.9);
    bg.beginFill(COLORS.panel, 0.95);
    bg.drawRoundedRect(0, 0, PANEL_WIDTH, height, 14);
    bg.endFill();
  }

  function addHeader(targetLabel, processName, processIndex, processCount) {
    const header = new PIXI.Container();
    header.x = PADDING;
    header.y = PADDING;
    content.addChild(header);

    const title = new PIXI.Text(`${targetLabel} - ${processName}`, {
      fill: COLORS.headerText,
      fontSize: 14,
      fontWeight: "bold",
    });
    title.x = 0;
    title.y = 0;
    header.addChild(title);

    if (processCount > 1) {
      const navText = new PIXI.Text(`${processIndex + 1}/${processCount}`, {
        fill: COLORS.subText,
        fontSize: 10,
      });
      navText.x = PANEL_WIDTH - PADDING * 2 - 38;
      navText.y = 4;
      header.addChild(navText);

      const prevBtn = new PIXI.Text("<", {
        fill: COLORS.subText,
        fontSize: 12,
        fontWeight: "bold",
      });
      prevBtn.x = PANEL_WIDTH - PADDING * 2 - 70;
      prevBtn.y = 3;
      prevBtn.eventMode = "static";
      prevBtn.cursor = "pointer";
      prevBtn.on("pointertap", () => cycleProcess(-1));
      header.addChild(prevBtn);

      const nextBtn = new PIXI.Text(">", {
        fill: COLORS.subText,
        fontSize: 12,
        fontWeight: "bold",
      });
      nextBtn.x = PANEL_WIDTH - PADDING * 2 - 18;
      nextBtn.y = 3;
      nextBtn.eventMode = "static";
      nextBtn.cursor = "pointer";
      nextBtn.on("pointertap", () => cycleProcess(1));
      header.addChild(nextBtn);
    }

    return HEADER_HEIGHT;
  }

  function addTabs(yStart) {
    const tabBar = new PIXI.Container();
    tabBar.x = PADDING;
    tabBar.y = yStart;
    content.addChild(tabBar);

    const tabWidth = Math.floor((PANEL_WIDTH - PADDING * 2 - 8) / TAB_IDS.length);
    let x = 0;
    for (const tabId of TAB_IDS) {
      const active = tabId === activeTab;
      const tabBg = new PIXI.Graphics();
      tabBg.beginFill(active ? COLORS.tabActive : COLORS.tabInactive, 1);
      tabBg.drawRoundedRect(0, 0, tabWidth, TAB_HEIGHT, 6);
      tabBg.endFill();
      tabBg.x = x;
      tabBar.addChild(tabBg);

      const tabText = new PIXI.Text(tabId[0].toUpperCase() + tabId.slice(1), {
        fill: COLORS.tabText,
        fontSize: 11,
        fontWeight: active ? "bold" : "normal",
      });
      tabText.x = x + 8;
      tabText.y = 5;
      tabBar.addChild(tabText);

      tabBg.eventMode = "static";
      tabBg.cursor = "pointer";
      tabBg.on("pointertap", () => {
        if (activeTab === tabId) return;
        activeTab = tabId;
        lastSignature = null;
      });

      x += tabWidth + 4;
    }

    return TAB_HEIGHT + 8;
  }

  function addProgressBar(yStart, processDef, process) {
    const bar = new PIXI.Container();
    bar.x = PADDING;
    bar.y = yStart;
    content.addChild(bar);

    const label = processDef?.transform?.mode === "work" ? "Progress: Work" : "Progress: Time";
    const labelText = new PIXI.Text(label, {
      fill: COLORS.subText,
      fontSize: 10,
    });
    labelText.x = 0;
    labelText.y = 0;
    bar.addChild(labelText);

    const width = PANEL_WIDTH - PADDING * 2;
    const height = 10;
    const y = 14;
    const bgRect = new PIXI.Graphics();
    bgRect.beginFill(COLORS.progressBg, 1);
    bgRect.drawRoundedRect(0, y, width, height, 4);
    bgRect.endFill();
    bar.addChild(bgRect);

    const duration = Math.max(1, Math.floor(processDef?.transform?.durationSec ?? 1));
    const progress = Math.max(0, Math.floor(process?.progress ?? 0));
    const ratio = Math.min(1, progress / duration);
    const fill = new PIXI.Graphics();
    if (ratio > 0) {
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(0, y, Math.max(2, width * ratio), height, 4);
      fill.endFill();
    }
    bar.addChild(fill);

    const timeText = new PIXI.Text(`${progress}/${duration}s`, {
      fill: COLORS.subText,
      fontSize: 10,
    });
    timeText.x = width - timeText.width;
    timeText.y = 0;
    bar.addChild(timeText);

    return y + height + 6;
  }

  function addTransformTab(yStart, processDef, process) {
    let y = yStart;
    const transform = processDef?.transform || {};

    y += addProgressBar(y, processDef, process);

    const reqs = Array.isArray(transform.requirements) ? transform.requirements : [];
    const outputs = Array.isArray(transform.outputs) ? transform.outputs : [];

    const reqTitle = new PIXI.Text("Requirements", {
      fill: COLORS.slotText,
      fontSize: 11,
      fontWeight: "bold",
    });
    reqTitle.x = PADDING;
    reqTitle.y = y;
    content.addChild(reqTitle);
    y += 16;

    if (!reqs.length) {
      const none = new PIXI.Text("None", {
        fill: COLORS.subText,
        fontSize: 10,
      });
      none.x = PADDING;
      none.y = y;
      content.addChild(none);
      y += 14 + ROW_GAP;
    } else {
      for (const req of reqs) {
        const label = formatRequirementLabel(req);
        const required = Math.max(0, Math.floor(req.amount ?? 0));
        const progress = Math.max(0, Math.floor(req.progress ?? 0));
        const line = new PIXI.Text(`${label}: ${progress}/${required}`, {
          fill: COLORS.subText,
          fontSize: 10,
        });
        line.x = PADDING;
        line.y = y;
        content.addChild(line);
        y += 14 + ROW_GAP;
      }
    }

    y += 4;
    const outTitle = new PIXI.Text("Outputs", {
      fill: COLORS.slotText,
      fontSize: 11,
      fontWeight: "bold",
    });
    outTitle.x = PADDING;
    outTitle.y = y;
    content.addChild(outTitle);
    y += 16;

    if (!outputs.length) {
      const none = new PIXI.Text("None", {
        fill: COLORS.subText,
        fontSize: 10,
      });
      none.x = PADDING;
      none.y = y;
      content.addChild(none);
      y += 14 + ROW_GAP;
    } else {
      for (const out of outputs) {
        const label = formatOutputLabel(out);
        const qty = Math.max(0, Math.floor(out.qty ?? out.amount ?? 0));
        const line = new PIXI.Text(`${label}: ${qty}`, {
          fill: COLORS.subText,
          fontSize: 10,
        });
        line.x = PADDING;
        line.y = y;
        content.addChild(line);
        y += 14 + ROW_GAP;
      }
    }

    return y;
  }

  function ensureSlotExpanded(slotKey, locked) {
    if (locked) return true;
    if (!expandedSlots.has(slotKey)) {
      expandedSlots.add(slotKey);
    }
    return expandedSlots.has(slotKey);
  }

  function layoutPillEntries(slotView) {
    const entries = slotView.pillEntries || [];
    let y = 0;
    for (const entry of entries) {
      entry.container.x = 0;
      entry.container.y = y;
      y += PILL_HEIGHT + PILL_GAP;
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
      width: PANEL_WIDTH - PADDING * 2 - 12,
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
      if (entry.locked) {
        if (entry.resolvedId && entry.resolvedId.startsWith("inv:process:")) {
          inventoryView?.revealWindow?.(entry.resolvedId, { pinned: true });
        }
        return;
      }
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

  function addRoutingSlots(yStart, slotKind, state, target, process, processDef) {
    let y = yStart;
    const slots = processDef?.routingSlots?.[slotKind] || [];
    const context = { leaderId: process?.leaderId ?? null };

    for (const slotDef of slots) {
      if (!slotDef) continue;
      const slotKey = `${slotKind}:${slotDef.slotId}`;
      const locked = slotDef.locked === true;
      const expanded = ensureSlotExpanded(slotKey, locked);

      const slotLabel = new PIXI.Text(slotDef.label || slotDef.slotId, {
        fill: COLORS.slotText,
        fontSize: 11,
        fontWeight: "bold",
      });
      slotLabel.x = PADDING;
      slotLabel.y = y;
      content.addChild(slotLabel);

      if (!locked) {
        const arrow = new PIXI.Text(expanded ? "v" : ">", {
          fill: COLORS.subText,
          fontSize: 12,
        });
        arrow.x = PANEL_WIDTH - PADDING - 10;
        arrow.y = y - 1;
        arrow.eventMode = "static";
        arrow.cursor = "pointer";
        arrow.on("pointertap", () => {
          if (expandedSlots.has(slotKey)) {
            expandedSlots.delete(slotKey);
          } else {
            expandedSlots.add(slotKey);
          }
          lastSignature = null;
        });
        content.addChild(arrow);
      }

      y += 16;

      if (!expanded && !locked) {
        y += SECTION_GAP;
        continue;
      }

      const slotState =
        process?.routing?.[slotKind]?.[slotDef.slotId] || {
          ordered: [],
          enabled: {},
        };
      const ordered = Array.isArray(slotState.ordered) ? slotState.ordered : [];
      if (ordered.length === 0) {
        const none = new PIXI.Text("None", {
          fill: COLORS.subText,
          fontSize: 10,
        });
        none.x = PADDING;
        none.y = y;
        content.addChild(none);
        y += 14 + SECTION_GAP;
        continue;
      }
      const candidates = listCandidateEndpoints(state, process, slotDef, target, context);

      const pillContainer = new PIXI.Container();
      pillContainer.x = PADDING;
      pillContainer.y = y;
      content.addChild(pillContainer);

      const slotView = {
        processId: process.id,
        slotKind,
        slotId: slotDef.slotId,
        slotLocked: locked,
        pillContainer,
        pillEntries: [],
        ignoreNextTap: false,
      };

      for (const rawEndpointId of ordered) {
        const resolvedId =
          resolveFixedEndpointId(rawEndpointId, process, context) || rawEndpointId;
        const isDrop = isDropEndpoint(resolvedId) && processDef.supportsDropslot;
        const enabled = slotState.enabled?.[rawEndpointId] !== false;
        const valid = isDrop || candidates.includes(resolvedId);
        const entry = buildPillEntry(state, slotView, rawEndpointId, resolvedId, {
          enabled,
          invalid: !valid,
          locked: locked || isDrop,
          draggable: !locked && !isDrop,
        });
        pillContainer.addChild(entry.container);
        slotView.pillEntries.push(entry);

        if (isDrop) {
          dropTargets.push({
            ownerId: resolvedId,
            getBounds: () => entry.container.getBounds(),
          });
        }
      }

      layoutPillEntries(slotView);
      y += slotView.pillHeight + SECTION_GAP;
    }

    return y;
  }

  function cycleProcess(delta) {
    const state = getStateSafe();
    const target = getHoverTarget(state);
    if (!target) return;
    const list = collectProcesses(target);
    if (list.length <= 1) return;
    const idx = list.findIndex((entry) => entry.process.id === selectedProcessId);
    const current = idx >= 0 ? idx : 0;
    const next = (current + delta + list.length) % list.length;
    selectedProcessId = list[next].process.id;
    lastSignature = null;
  }

  function rebuildWidget(state, target, processEntry, processDef, processIndex, processCount) {
    clearContent();

    const targetLabel = getTargetLabel(target);
    const processName = processDef?.displayName || processEntry?.process?.type || "Process";

    let y = 0;
    y += addHeader(targetLabel, processName, processIndex, processCount);
    y += addTabs(y + 4);

    const bodyStart = y + PADDING / 2;
    if (activeTab === "transform") {
      y = addTransformTab(bodyStart, processDef, processEntry.process);
    } else if (activeTab === "inputs") {
      y = addRoutingSlots(bodyStart, "inputs", state, target, processEntry.process, processDef);
    } else {
      y = addRoutingSlots(bodyStart, "outputs", state, target, processEntry.process, processDef);
    }

    const totalHeight = Math.max(HEADER_HEIGHT + TAB_HEIGHT + PADDING * 2, y + PADDING);
    drawPanel(totalHeight);
  }

  function update() {
    const state = getStateSafe();
    if (!state) {
      container.visible = false;
      return;
    }
    const target = getHoverTarget(state);
    if (!target) {
      container.visible = false;
      return;
    }

    const targetKey = getTargetKey(target);
    const processes = collectProcesses(target);
    if (processes.length === 0) {
      container.visible = false;
      return;
    }

    if (activeTargetKey !== targetKey) {
      activeTargetKey = targetKey;
      selectedProcessId = processes[0]?.process?.id ?? null;
      lastSignature = null;
    }

    const foundIndex = processes.findIndex(
      (entry) => entry.process.id === selectedProcessId
    );
    const processIndex = foundIndex >= 0 ? foundIndex : 0;
    const processEntry = processes[processIndex] || processes[0];
    if (!processEntry) {
      container.visible = false;
      return;
    }

    selectedProcessId = processEntry.process.id;

    const processDef = getProcessDefForInstance(
      processEntry.process,
      target,
      { leaderId: processEntry.process?.leaderId ?? null }
    );
    if (!processDef) {
      container.visible = false;
      return;
    }

    const signature = buildProcessSignature(targetKey, processEntry.process, processDef);
    if (signature !== lastSignature) {
      lastSignature = signature;
      rebuildWidget(state, target, processEntry, processDef, processIndex, processes.length);
    }

    container.visible = true;
  }

  function getDropTargetOwnerAtGlobalPos(globalPos) {
    if (!container.visible || !globalPos) return null;
    for (const target of dropTargets) {
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
    return null;
  }

  function init() {}

  return {
    init,
    update,
    getDropTargetOwnerAtGlobalPos,
  };
}
