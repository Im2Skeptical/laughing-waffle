// skill-tree-editor-pixi.js
// Dev-focused in-game skill tree editor overlay.

import {
  applyAutoLayoutToEditorGraph,
  buildEditorGraphFromDefs,
  cloneEditorGraph,
  exportLayoutPatchFromEditorGraph,
  exportRuntimeSkillDefsFromEditorGraph,
  getSkillTreeEditorStorageKey,
  parseEditorGraphJson,
  serializeEditorGraph,
  validateEditorGraph,
} from "../model/skills/editor-graph.js";
import { makeButton } from "./skill-tree/button.js";
import { clamp, sortedStrings } from "./skill-tree/formatters.js";
import { MAX_ZOOM, MIN_ZOOM } from "./skill-tree/constants.js";

const VIEWPORT_X = 20;
const VIEWPORT_Y = 20;
const VIEWPORT_WIDTH = 1410;
const VIEWPORT_HEIGHT = 1040;
const PANEL_X = 1450;
const PANEL_WIDTH = 430;
const PANEL_ROW_GAP = 40;
const PANEL_SECTION_GAP = 10;
const PANEL_TEXT_GAP = 8;
const PANEL_HEADER_WIDTH = 408;
const PANEL_COL_B_X = PANEL_X + 212;
const EDGE_EDIT_MODE_NONE = "none";
const EDGE_EDIT_MODE_ADD = "add";
const EDGE_EDIT_MODE_REMOVE = "remove";
const QUICK_TAGS = [
  { id: "Black", activeFill: 0x232833, activeText: 0xf5f8ff, activeStroke: 0x808da6 },
  { id: "Green", activeFill: 0x1f5b43, activeText: 0xdfffea, activeStroke: 0x7fd8aa },
  { id: "Blue", activeFill: 0x204f7a, activeText: 0xe2f1ff, activeStroke: 0x87c7ff },
  { id: "Red", activeFill: 0x6f2a38, activeText: 0xffe6ea, activeStroke: 0xff9bac },
  { id: "Early", activeFill: 0x34506d, activeText: 0xdce9ff, activeStroke: 0x8fb6f2 },
  { id: "Mid", activeFill: 0x405a4f, activeText: 0xdff4e9, activeStroke: 0x98d6b5 },
  { id: "Late", activeFill: 0x5e4d2c, activeText: 0xfff1d4, activeStroke: 0xe5c27f },
  { id: "Hybrid", activeFill: 0x4f3f74, activeText: 0xf0e8ff, activeStroke: 0xc2a7ff },
  { id: "Notable", activeFill: 0x6b5b25, activeText: 0xfff8d8, activeStroke: 0xe8d184 },
];
const QUICK_TAG_SET = new Set(QUICK_TAGS.map((entry) => entry.id));
const QUICK_TAG_INACTIVE_FILL = 0x1d2a43;
const QUICK_TAG_INACTIVE_STROKE = 0x3a4c70;
const QUICK_TAG_INACTIVE_TEXT = 0x9db4d8;
const LAYOUT_WEDGE_IDS = [
  "Blue",
  "Green",
  "Red",
  "Black",
  "BlueGreen",
  "GreenRed",
  "RedBlack",
  "BlackBlue",
];
const LAYOUT_SOLVER_FIELDS = [
  { key: "barycenterIterations", label: "Barycenter iterations", integer: true, min: 1 },
  { key: "localSwapIterations", label: "Local swap iterations", integer: true, min: 0 },
  { key: "overlapIterations", label: "Overlap iterations", integer: true, min: 0 },
  { key: "overlapPaddingPx", label: "Overlap padding px", integer: false, min: 0 },
  { key: "componentBandGapDeg", label: "Component band gap deg", integer: false, min: 0 },
];
const LAYOUT_RADIAL_FIELDS = [
  { key: "radialNudgeIterations", label: "Radial nudge iterations", integer: true, min: 0 },
  { key: "radialNudgeMaxPx", label: "Radial nudge max px", integer: false, min: 0 },
  { key: "radialNudgePaddingPx", label: "Radial nudge padding px", integer: false, min: 0 },
  { key: "radialNudgeSpring", label: "Radial nudge spring", integer: false, min: 0 },
  { key: "coreSpread", label: "Core spread", integer: false, min: 0 },
];

const PANEL_SECTION_DEFS = [
  { id: "session", headerButtonId: "sectionSession", title: "Session & Layout" },
  { id: "graph", headerButtonId: "sectionGraph", title: "Graph Edit" },
  { id: "quick", headerButtonId: "sectionQuick", title: "Quick Tags & Ring" },
  { id: "io", headerButtonId: "sectionIO", title: "Import / Export" },
  { id: "inspect", headerButtonId: "sectionInspect", title: "Selection & Validation" },
];

function roundPos(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function deepClone(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (_) {
    // ignore and fallback
  }
  return JSON.parse(JSON.stringify(value));
}

function parseTagList(input) {
  if (typeof input !== "string" || !input.length) return [];
  const set = new Set();
  const out = [];
  for (const raw of input.split(",")) {
    const tag = raw.trim();
    if (!tag.length) continue;
    if (set.has(tag)) continue;
    set.add(tag);
    out.push(tag);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function parseOrderedIdList(input) {
  if (typeof input !== "string") return [];
  const out = [];
  const seen = new Set();
  const tokens = input.split(/[,\n;]/);
  for (const raw of tokens) {
    const value = raw.trim();
    if (!value.length || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function formatKeyNumberPairs(map, preferredOrder = []) {
  const source = map && typeof map === "object" ? map : {};
  const keys = [];
  const seen = new Set();
  for (const key of preferredOrder) {
    if (typeof key !== "string" || !key.length || seen.has(key)) continue;
    if (!Number.isFinite(source[key])) continue;
    seen.add(key);
    keys.push(key);
  }
  for (const key of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
    if (seen.has(key) || !Number.isFinite(source[key])) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys.map((key) => `${key}=${source[key]}`).join(", ");
}

function parseKeyNumberPairs(input, { allowedKeys = null, integer = false, min = null } = {}) {
  if (typeof input !== "string" || !input.trim().length) {
    return { ok: true, value: {} };
  }
  const allowedSet = Array.isArray(allowedKeys) ? new Set(allowedKeys) : null;
  const out = {};
  const entries = input.split(/[,\n;]/);
  for (const raw of entries) {
    const token = raw.trim();
    if (!token.length) continue;
    const splitAt = token.includes("=") ? token.indexOf("=") : token.indexOf(":");
    if (splitAt <= 0) {
      return { ok: false, reason: `Invalid entry "${token}". Use key=value.` };
    }
    const key = token.slice(0, splitAt).trim();
    const valueRaw = token.slice(splitAt + 1).trim();
    if (!key.length) return { ok: false, reason: `Invalid key in "${token}".` };
    if (allowedSet && !allowedSet.has(key)) {
      return { ok: false, reason: `Unknown key "${key}".` };
    }
    const parsed = Number(valueRaw);
    if (!Number.isFinite(parsed)) {
      return { ok: false, reason: `Value for "${key}" must be numeric.` };
    }
    let nextValue = integer ? Math.floor(parsed) : parsed;
    if (Number.isFinite(min)) {
      if (nextValue < min) {
        return { ok: false, reason: `Value for "${key}" must be >= ${min}.` };
      }
    }
    out[key] = nextValue;
  }
  return { ok: true, value: out };
}

function getNodeIds(graph) {
  return sortedStrings(Object.keys(graph?.nodesById || {}));
}

function getEdgeKey(a, b) {
  return String(a) <= String(b) ? `${a}|${b}` : `${b}|${a}`;
}

function edgeExists(graph, a, b) {
  if (!graph || !a || !b || a === b) return false;
  const key = getEdgeKey(a, b);
  return Array.isArray(graph.edges)
    ? graph.edges.some((edge) => getEdgeKey(edge.a, edge.b) === key)
    : false;
}

function toEditorNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function getRingIdSortKey(ringId) {
  const id = String(ringId || "");
  if (!id.length) return [4, 0, id];
  if (id === "core") return [0, 0, id];
  const match = /^ring[_-]?(\d+)$/i.exec(id);
  if (match) return [1, Number(match[1]), id];
  if (id === "early") return [2, 0, id];
  if (id === "mid") return [2, 1, id];
  if (id === "late") return [2, 2, id];
  return [3, 0, id];
}

function sortRingIds(ringIds) {
  return ringIds.slice().sort((left, right) => {
    const lk = getRingIdSortKey(left);
    const rk = getRingIdSortKey(right);
    if (lk[0] !== rk[0]) return lk[0] - rk[0];
    if (lk[1] !== rk[1]) return lk[1] - rk[1];
    return String(lk[2]).localeCompare(String(rk[2]));
  });
}

function makeToggleChip(label, width, height, onTap) {
  const root = new PIXI.Container();
  root.eventMode = "static";
  root.cursor = "pointer";

  const bg = new PIXI.Graphics();
  root.addChild(bg);

  const text = new PIXI.Text(label, {
    fill: QUICK_TAG_INACTIVE_TEXT,
    fontSize: 12,
    fontWeight: "bold",
  });
  text.anchor.set(0.5, 0.5);
  text.x = Math.floor(width / 2);
  text.y = Math.floor(height / 2);
  root.addChild(text);

  root.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    onTap?.();
  });

  function setActive(active, style = {}) {
    const fill = active ? style.activeFill ?? QUICK_TAG_INACTIVE_FILL : QUICK_TAG_INACTIVE_FILL;
    const stroke = active
      ? style.activeStroke ?? QUICK_TAG_INACTIVE_STROKE
      : QUICK_TAG_INACTIVE_STROKE;
    const textFill = active ? style.activeText ?? 0xffffff : QUICK_TAG_INACTIVE_TEXT;
    bg.clear();
    bg.lineStyle(2, stroke, 1);
    bg.beginFill(fill, 0.96);
    bg.drawRoundedRect(0, 0, width, height, 7);
    bg.endFill();
    text.style.fill = textFill;
    text.text = label;
    text.x = Math.floor(width / 2);
  }

  setActive(false);
  return { root, setActive };
}

export function createSkillTreeEditorView({ app, layer } = {}) {
  const root = new PIXI.Container();
  root.visible = false;
  root.eventMode = "static";
  layer.addChild(root);

  const bg = new PIXI.Graphics();
  root.addChild(bg);

  const panelBg = new PIXI.Graphics();
  root.addChild(panelBg);

  const title = new PIXI.Text("Skill Tree Editor", {
    fill: 0xffffff,
    fontSize: 28,
    fontWeight: "bold",
  });
  title.x = PANEL_X;
  title.y = 20;
  root.addChild(title);

  const statusText = new PIXI.Text("", {
    fill: 0xb7d6ff,
    fontSize: 12,
    lineHeight: 17,
    wordWrap: true,
    wordWrapWidth: PANEL_WIDTH - 12,
  });
  root.addChild(statusText);

  const errorText = new PIXI.Text("", {
    fill: 0xff9e9e,
    fontSize: 12,
    lineHeight: 16,
    wordWrap: true,
    wordWrapWidth: PANEL_WIDTH - 12,
  });
  root.addChild(errorText);

  const selectedText = new PIXI.Text("", {
    fill: 0xe5edf9,
    fontSize: 12,
    lineHeight: 16,
    wordWrap: true,
    wordWrapWidth: PANEL_WIDTH - 12,
  });
  root.addChild(selectedText);

  const validationText = new PIXI.Text("", {
    fill: 0xc6d8f2,
    fontSize: 12,
    lineHeight: 16,
    wordWrap: true,
    wordWrapWidth: PANEL_WIDTH - 12,
  });
  root.addChild(validationText);

  const helpText = new PIXI.Text(
    "Canvas: drag nodes to move, wheel to zoom, drag empty space to pan.\nHotkeys: E add edge, R remove edge, Esc exits edge mode.",
    {
      fill: 0x91a7cc,
      fontSize: 11,
      lineHeight: 15,
      wordWrap: true,
      wordWrapWidth: PANEL_WIDTH - 12,
    }
  );
  root.addChild(helpText);

  const quickPanelHintText = new PIXI.Text("", {
    fill: 0x93adcf,
    fontSize: 11,
    lineHeight: 15,
    wordWrap: true,
    wordWrapWidth: PANEL_WIDTH - 12,
  });
  root.addChild(quickPanelHintText);

  const quickRingLabelText = new PIXI.Text("Ring: (none)", {
    fill: 0xd5e4ff,
    fontSize: 12,
    fontWeight: "bold",
  });
  root.addChild(quickRingLabelText);

  const viewport = new PIXI.Container();
  viewport.x = VIEWPORT_X;
  viewport.y = VIEWPORT_Y;
  root.addChild(viewport);

  const viewportBg = new PIXI.Graphics();
  viewportBg.eventMode = "static";
  viewportBg.cursor = "grab";
  viewport.addChild(viewportBg);

  const treeWorld = new PIXI.Container();
  viewport.addChild(treeWorld);

  const viewportMask = new PIXI.Graphics();
  root.addChild(viewportMask);
  viewport.mask = viewportMask;

  const zoomText = new PIXI.Text("", {
    fill: 0xbfd2f0,
    fontSize: 12,
    fontWeight: "bold",
  });
  zoomText.x = PANEL_X + 332;
  zoomText.y = 24;
  root.addChild(zoomText);

  let graph = null;
  let baseGraph = null;
  let validation = { ok: true, errors: [], warnings: [] };
  let selectedNodeId = null;
  let hoverNodeId = null;
  let edgeEditMode = EDGE_EDIT_MODE_NONE;
  let connectSourceId = null;
  let activeTreeId = null;
  let activeDefs = null;
  let onExit = null;
  const camera = { scale: 1, x: 0, y: 0 };
  const pan = {
    active: false,
    startGlobalX: 0,
    startGlobalY: 0,
    startX: 0,
    startY: 0,
    moved: false,
    lastMoved: false,
  };
  const nodeDrag = {
    active: false,
    nodeId: null,
    offsetX: 0,
    offsetY: 0,
    moved: false,
  };
  const uiButtons = {};
  const quickTagButtons = {};
  let quickTagValues = {};
  let quickRingId = null;
  let quickRingOptions = [null];
  let quickTemplateSourceNodeId = null;
  const sectionExpanded = {
    session: true,
    graph: true,
    quick: true,
    io: false,
    inspect: true,
  };

  function destroyContainerChildren(container) {
    if (!container?.removeChildren) return;
    const removed = container.removeChildren();
    for (const child of removed) {
      child?.destroy?.({ children: true });
    }
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

  function edgeModeLabel(mode = edgeEditMode) {
    if (mode === EDGE_EDIT_MODE_ADD) return "Add Edge";
    if (mode === EDGE_EDIT_MODE_REMOVE) return "Remove Edge";
    return "Select/Move";
  }

  function setError(text) {
    errorText.text = typeof text === "string" ? text : "";
  }

  function getStorageKey() {
    return getSkillTreeEditorStorageKey(activeTreeId || "default");
  }

  function getSelectedNode() {
    if (!graph || !selectedNodeId) return null;
    return graph.nodesById?.[selectedNodeId] || null;
  }

  function collectRingIdsFromGraph() {
    const ringIdSet = new Set();
    for (const nodeId of getNodeIds(graph)) {
      const node = graph?.nodesById?.[nodeId];
      if (typeof node?.ringId === "string" && node.ringId.length > 0) {
        ringIdSet.add(node.ringId);
      }
    }
    for (const ringId of graph?.layout?.ringOrder || []) {
      if (typeof ringId === "string" && ringId.length > 0) ringIdSet.add(ringId);
    }
    for (const ringId of Object.keys(graph?.layout?.radii || {})) {
      if (typeof ringId === "string" && ringId.length > 0) ringIdSet.add(ringId);
    }
    return sortRingIds(Array.from(ringIdSet));
  }

  function rebuildQuickRingOptions() {
    const next = [null, ...collectRingIdsFromGraph()];
    quickRingOptions = next.length > 0 ? next : [null];
    if (!quickRingOptions.includes(quickRingId)) {
      quickRingId = null;
    }
  }

  function updateSectionHeaderLabels() {
    for (const section of PANEL_SECTION_DEFS) {
      const btn = uiButtons[section.headerButtonId];
      if (!btn) continue;
      const expanded = sectionExpanded[section.id] !== false;
      const prefix = expanded ? "[-]" : "[+]";
      btn.setLabel(`${prefix} ${section.title}`);
    }
  }

  function syncQuickValuesFromNode(node, { trackSource = true } = {}) {
    if (!node) return;
    const next = {};
    const tagSet = new Set(Array.isArray(node.tags) ? node.tags : []);
    for (const entry of QUICK_TAGS) {
      next[entry.id] = tagSet.has(entry.id);
    }
    quickTagValues = next;
    quickRingId =
      typeof node.ringId === "string" && node.ringId.length > 0 ? node.ringId : null;
    if (trackSource) quickTemplateSourceNodeId = node.id;
    rebuildQuickRingOptions();
  }

  function resetQuickTemplate() {
    quickTemplateSourceNodeId = null;
    quickRingId = null;
    const next = {};
    for (const entry of QUICK_TAGS) next[entry.id] = false;
    quickTagValues = next;
    rebuildQuickRingOptions();
    updateQuickPanelUi();
  }

  function updateQuickPanelUi() {
    for (const entry of QUICK_TAGS) {
      const btn = quickTagButtons[entry.id];
      if (!btn) continue;
      btn.setActive(quickTagValues[entry.id] === true, entry);
    }
    const ringLabel = quickRingId || "(none)";
    quickRingLabelText.text = `Ring: ${ringLabel}`;
    const sourceText = quickTemplateSourceNodeId
      ? `Template Source: ${quickTemplateSourceNodeId}`
      : "Template Source: (none)";
    quickPanelHintText.text = `${sourceText}\nQuickTag toggles update selected node, or act as a template when nothing is selected.`;
  }

  function setQuickRingValue(nextRingId, { applyToSelected = true } = {}) {
    const normalized =
      typeof nextRingId === "string" && nextRingId.trim().length > 0
        ? nextRingId.trim()
        : null;
    quickRingId = normalized;
    rebuildQuickRingOptions();
    updateQuickPanelUi();
    const selectedNode = getSelectedNode();
    if (!applyToSelected || !selectedNode) return;
    selectedNode.ringId = quickRingId;
    quickTemplateSourceNodeId = selectedNode.id;
    recalcAndRender({ save: true });
  }

  function stepQuickRing(direction) {
    rebuildQuickRingOptions();
    if (!quickRingOptions.length) return;
    const currentIndex = Math.max(0, quickRingOptions.indexOf(quickRingId));
    const delta = direction >= 0 ? 1 : -1;
    const nextIndex =
      (currentIndex + delta + quickRingOptions.length) % quickRingOptions.length;
    setQuickRingValue(quickRingOptions[nextIndex], { applyToSelected: true });
  }

  function applyQuickTagToggle(tagId) {
    if (!QUICK_TAG_SET.has(tagId)) return;
    const nextEnabled = quickTagValues[tagId] !== true;
    quickTagValues[tagId] = nextEnabled;
    const selectedNode = getSelectedNode();
    if (!selectedNode) {
      updateQuickPanelUi();
      return;
    }
    const tagSet = new Set(Array.isArray(selectedNode.tags) ? selectedNode.tags : []);
    if (nextEnabled) tagSet.add(tagId);
    else tagSet.delete(tagId);
    selectedNode.tags = sortedStrings(Array.from(tagSet));
    quickTemplateSourceNodeId = selectedNode.id;
    recalcAndRender({ save: true });
  }

  function getNextAvailableNodeIdFromSource(sourceId) {
    const nodeIdSet = new Set(getNodeIds(graph));
    const source = typeof sourceId === "string" ? sourceId.trim() : "";
    const match = /^(.*?)(\d+)$/.exec(source);
    let prefix = "";
    let width = 2;
    let start = 1;
    if (match) {
      prefix = match[1];
      width = Math.max(1, match[2].length);
      start = Number(match[2]) + 1;
    } else if (source.length > 0) {
      prefix = source.endsWith("_") ? source : `${source}_`;
    } else {
      prefix = "QuickNode_";
    }
    for (let index = start; index < start + 10000; index++) {
      const candidate = `${prefix}${String(index).padStart(width, "0")}`;
      if (!nodeIdSet.has(candidate)) return candidate;
    }
    return null;
  }

  function suggestQuickNodeId() {
    if (!graph) return null;
    const sourceNodeId = quickTemplateSourceNodeId || selectedNodeId || "QuickNode_00";
    return (
      getNextAvailableNodeIdFromSource(sourceNodeId) ||
      getNextAvailableNodeIdFromSource("QuickNode_00") ||
      null
    );
  }

  function createQuickNodeFromPanel() {
    if (!graph) return;
    const nodeId = suggestQuickNodeId();
    if (!nodeId) {
      setError("Unable to generate a unique QuickNode id.");
      return;
    }
    const worldX = roundPos((VIEWPORT_WIDTH / 2 - camera.x) / camera.scale);
    const worldY = roundPos((VIEWPORT_HEIGHT / 2 - camera.y) / camera.scale);
    const tags = QUICK_TAGS.filter((entry) => quickTagValues[entry.id] === true).map(
      (entry) => entry.id
    );
    graph.nodesById[nodeId] = {
      id: nodeId,
      treeId: graph.treeId,
      name: nodeId,
      desc: "",
      cost: 1,
      tags,
      ringId: quickRingId,
      requirements: null,
      effects: {},
      uiNodeRadius: null,
      editorPos: { x: worldX, y: worldY },
      editorPinned: false,
      editorNotes: "",
    };
    selectedNodeId = nodeId;
    quickTemplateSourceNodeId = nodeId;
    recalcAndRender({ save: true });
  }

  function applyCamera() {
    treeWorld.scale.set(camera.scale);
    treeWorld.position.set(Math.floor(camera.x), Math.floor(camera.y));
    zoomText.text = `${Math.round(camera.scale * 100)}%`;
  }

  function setCamera(scale, x, y) {
    camera.scale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    camera.x = x;
    camera.y = y;
    applyCamera();
  }

  function toStageCoordsFromClient(clientX, clientY) {
    const view = app?.view;
    const screen = app?.screen;
    if (!view || !screen) return null;
    const rect = view.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) * screen.width) / rect.width,
      y: ((clientY - rect.top) * screen.height) / rect.height,
    };
  }

  function globalToWorld(globalPoint) {
    return treeWorld.toLocal(globalPoint, app.stage);
  }

  function zoomAtGlobal(globalX, globalY, factor) {
    const local = viewport.toLocal({ x: globalX, y: globalY });
    if (
      local.x < 0 ||
      local.y < 0 ||
      local.x > VIEWPORT_WIDTH ||
      local.y > VIEWPORT_HEIGHT
    ) {
      return;
    }
    const prevScale = camera.scale;
    const nextScale = clamp(prevScale * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(nextScale - prevScale) < 0.0001) return;

    const worldX = (local.x - camera.x) / prevScale;
    const worldY = (local.y - camera.y) / prevScale;
    const nextX = local.x - worldX * nextScale;
    const nextY = local.y - worldY * nextScale;
    setCamera(nextScale, nextX, nextY);
  }

  function autosaveSession() {
    if (!root.visible || !graph) return;
    try {
      const payload = serializeEditorGraph(graph);
      if (!payload) return;
      globalThis?.localStorage?.setItem(getStorageKey(), payload);
    } catch (_) {
      // ignore storage failures
    }
  }

  function updateStatusText() {
    if (!graph) {
      statusText.text = "";
      return;
    }
    const nodeCount = getNodeIds(graph).length;
    const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
    const modeText = edgeModeLabel();
    const sourceText = connectSourceId ? ` | Edge source: ${connectSourceId}` : "";
    statusText.text = [
      `Tree: ${graph.treeId}`,
      `Nodes: ${nodeCount} | Edges: ${edgeCount}`,
      `Mode: ${modeText}${sourceText}`,
    ].join("\n");
  }

  function updateValidationText() {
    if (!validation) {
      validationText.text = "";
      return;
    }
    const lines = [];
    if (validation.ok) {
      lines.push("Validation: OK");
    } else {
      lines.push("Validation: Errors");
      for (const err of (validation.errors || []).slice(0, 4)) {
        lines.push(`- ${err}`);
      }
      if ((validation.errors || []).length > 4) {
        lines.push(`- ... ${validation.errors.length - 4} more`);
      }
    }
    if ((validation.warnings || []).length > 0) {
      lines.push("", "Warnings:");
      for (const warn of validation.warnings.slice(0, 3)) {
        lines.push(`- ${warn}`);
      }
      if (validation.warnings.length > 3) {
        lines.push(`- ... ${validation.warnings.length - 3} more`);
      }
    }
    validationText.text = lines.join("\n");
  }

  function updateSelectedText() {
    const node = getSelectedNode();
    if (!node) {
      selectedText.text = "Selected: none";
      uiButtons.togglePin?.setLabel?.("Pin");
      rebuildQuickRingOptions();
      updateQuickPanelUi();
      return;
    }
    syncQuickValuesFromNode(node, { trackSource: true });
    const lines = [
      `Selected: ${node.id}`,
      `Name: ${node.name || ""}`,
      `Cost: ${node.cost ?? 1}`,
      `Ring: ${node.ringId || "(none)"}`,
      `Tags: ${(node.tags || []).join(", ") || "(none)"}`,
      `Pinned: ${node.editorPinned ? "yes" : "no"}`,
      `Pos: (${roundPos(node.editorPos?.x)}, ${roundPos(node.editorPos?.y)})`,
      `Desc: ${node.desc || "(empty)"}`,
      `Notes: ${node.editorNotes || "(empty)"}`,
    ];
    selectedText.text = lines.join("\n");
    uiButtons.togglePin?.setLabel?.(node.editorPinned ? "Unpin" : "Pin");
    updateQuickPanelUi();
  }

  function updateEdgeModeButtons() {
    uiButtons.addEdgeMode?.setLabel?.(
      edgeEditMode === EDGE_EDIT_MODE_ADD ? "Add Edge: On" : "Add Edge: Off"
    );
    uiButtons.removeEdgeMode?.setLabel?.(
      edgeEditMode === EDGE_EDIT_MODE_REMOVE
        ? "Remove Edge: On"
        : "Remove Edge: Off"
    );
  }

  function setEdgeEditMode(mode) {
    if (
      mode !== EDGE_EDIT_MODE_ADD &&
      mode !== EDGE_EDIT_MODE_REMOVE &&
      mode !== EDGE_EDIT_MODE_NONE
    ) {
      mode = EDGE_EDIT_MODE_NONE;
    }
    const previousMode = edgeEditMode;
    edgeEditMode = mode;
    if (edgeEditMode === EDGE_EDIT_MODE_NONE) {
      connectSourceId = null;
      if (previousMode !== EDGE_EDIT_MODE_NONE) {
        selectedNodeId = null;
        hoverNodeId = null;
      }
    }
    updateEdgeModeButtons();
    updateStatusText();
  }

  function recalcAndRender({ save = true } = {}) {
    validation = validateEditorGraph(graph);
    rebuildQuickRingOptions();
    updateStatusText();
    updateSelectedText();
    updateValidationText();
    layoutSidebar();
    renderGraph();
    if (save) autosaveSession();
  }

  function fitCameraToGraph() {
    if (!graph) return;
    const nodeIds = getNodeIds(graph);
    if (!nodeIds.length) {
      setCamera(1, 0, 0);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const nodeId of nodeIds) {
      const node = graph.nodesById[nodeId];
      const x = toEditorNumber(node?.editorPos?.x, 0);
      const y = toEditorNumber(node?.editorPos?.y, 0);
      minX = Math.min(minX, x - 40);
      minY = Math.min(minY, y - 40);
      maxX = Math.max(maxX, x + 40);
      maxY = Math.max(maxY, y + 40);
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = clamp(
      Math.min(VIEWPORT_WIDTH / spanX, VIEWPORT_HEIGHT / spanY),
      MIN_ZOOM,
      1.25
    );
    const x = (VIEWPORT_WIDTH - spanX * scale) / 2 - minX * scale;
    const y = (VIEWPORT_HEIGHT - spanY * scale) / 2 - minY * scale;
    setCamera(scale, x, y);
  }

  function renderGraph() {
    destroyContainerChildren(treeWorld);
    if (!graph) return;

    const nodeIds = getNodeIds(graph);
    const nodesById = graph.nodesById || {};

    const edgeGfx = new PIXI.Graphics();
    for (const edge of graph.edges || []) {
      const a = nodesById[edge.a];
      const b = nodesById[edge.b];
      if (!a || !b) continue;
      const isConnectHighlight =
        connectSourceId && (edge.a === connectSourceId || edge.b === connectSourceId);
      edgeGfx.lineStyle(
        isConnectHighlight ? 2.8 : 1.8,
        isConnectHighlight ? 0x8dd3ff : 0x4c5977,
        isConnectHighlight ? 0.92 : 0.78
      );
      edgeGfx.moveTo(a.editorPos.x, a.editorPos.y);
      edgeGfx.lineTo(b.editorPos.x, b.editorPos.y);
    }
    treeWorld.addChild(edgeGfx);

    for (const nodeId of nodeIds) {
      const node = nodesById[nodeId];
      const radius = Number.isFinite(node?.uiNodeRadius)
        ? Math.max(10, Math.min(72, node.uiNodeRadius))
        : Array.isArray(node?.tags) && node.tags.includes("Notable")
          ? 20
          : 14;
      const container = new PIXI.Container();
      container.x = node.editorPos.x;
      container.y = node.editorPos.y;
      container.eventMode = "static";
      container.cursor =
        edgeEditMode === EDGE_EDIT_MODE_NONE ? "pointer" : "crosshair";

      const isSelected = selectedNodeId === nodeId;
      const isHovered = hoverNodeId === nodeId;
      const isSource = connectSourceId === nodeId;
      const fill = node.editorPinned ? 0x426f8f : 0x334155;
      const stroke = isSource
        ? 0x84f5a4
        : isSelected
          ? 0xffd166
          : isHovered
            ? 0xffffff
            : 0xcde3ff;

      const circle = new PIXI.Graphics();
      circle
        .lineStyle(isSelected || isHovered || isSource ? 3 : 2, stroke, 1)
        .beginFill(fill, 0.92)
        .drawCircle(0, 0, radius)
        .endFill();
      container.addChild(circle);

      const label = new PIXI.Text(nodeId, {
        fill: 0xf8fbff,
        fontSize: 10,
        fontWeight: isSelected ? "bold" : "normal",
      });
      label.anchor.set(0.5, 0.5);
      container.addChild(label);

      container.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        if (edgeEditMode !== EDGE_EDIT_MODE_NONE) return;
        const world = globalToWorld(ev?.data?.global || { x: 0, y: 0 });
        nodeDrag.active = true;
        nodeDrag.nodeId = nodeId;
        nodeDrag.offsetX = node.editorPos.x - world.x;
        nodeDrag.offsetY = node.editorPos.y - world.y;
        nodeDrag.moved = false;
        app?.stage?.on?.("pointermove", onNodeDragMove);
        app?.stage?.on?.("pointerup", onNodeDragEnd);
        app?.stage?.on?.("pointerupoutside", onNodeDragEnd);
      });

      container.on("pointerover", () => {
        hoverNodeId = nodeId;
        renderGraph();
      });
      container.on("pointerout", () => {
        if (hoverNodeId === nodeId) hoverNodeId = null;
        renderGraph();
      });

      container.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        if (nodeDrag.active || nodeDrag.moved) return;
        selectedNodeId = nodeId;
        setError("");
        if (edgeEditMode !== EDGE_EDIT_MODE_NONE) {
          if (!connectSourceId) {
            connectSourceId = nodeId;
          } else if (connectSourceId === nodeId) {
            connectSourceId = null;
          } else if (edgeEditMode === EDGE_EDIT_MODE_ADD) {
            const changed = addEdge(connectSourceId, nodeId);
            if (!changed) {
              setError(`Edge already exists: ${connectSourceId} <-> ${nodeId}`);
            }
            connectSourceId = nodeId;
          } else {
            const changed = removeEdge(connectSourceId, nodeId);
            if (!changed) {
              setError(`Edge not found: ${connectSourceId} <-> ${nodeId}`);
            }
            connectSourceId = nodeId;
          }
        }
        recalcAndRender({ save: true });
      });

      treeWorld.addChild(container);
    }
    applyCamera();
  }

  function onNodeDragMove(ev) {
    if (!nodeDrag.active || !graph || !nodeDrag.nodeId) return;
    const node = graph.nodesById?.[nodeDrag.nodeId];
    if (!node) return;
    const world = globalToWorld(ev?.data?.global || { x: 0, y: 0 });
    const nextX = world.x + nodeDrag.offsetX;
    const nextY = world.y + nodeDrag.offsetY;
    if (
      Math.abs(nextX - node.editorPos.x) > 0.2 ||
      Math.abs(nextY - node.editorPos.y) > 0.2
    ) {
      nodeDrag.moved = true;
      node.editorPos.x = roundPos(nextX);
      node.editorPos.y = roundPos(nextY);
      updateSelectedText();
      renderGraph();
    }
  }

  function onNodeDragEnd() {
    if (!nodeDrag.active) return;
    nodeDrag.active = false;
    app?.stage?.off?.("pointermove", onNodeDragMove);
    app?.stage?.off?.("pointerup", onNodeDragEnd);
    app?.stage?.off?.("pointerupoutside", onNodeDragEnd);
    const moved = nodeDrag.moved;
    nodeDrag.nodeId = null;
    nodeDrag.moved = false;
    if (moved) recalcAndRender({ save: true });
  }

  function onPanMove(ev) {
    if (!pan.active) return;
    const global = ev?.data?.global;
    if (!global) return;
    const dx = global.x - pan.startGlobalX;
    const dy = global.y - pan.startGlobalY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true;
    setCamera(camera.scale, pan.startX + dx, pan.startY + dy);
  }

  function endPan() {
    if (!pan.active) return;
    pan.lastMoved = pan.moved;
    pan.active = false;
    pan.moved = false;
    viewportBg.cursor = "grab";
    app?.stage?.off?.("pointermove", onPanMove);
    app?.stage?.off?.("pointerup", endPan);
    app?.stage?.off?.("pointerupoutside", endPan);
  }

  function startPan(ev) {
    if (!root.visible || nodeDrag.active) return;
    const global = ev?.data?.global;
    if (!global) return;
    pan.active = true;
    pan.startGlobalX = global.x;
    pan.startGlobalY = global.y;
    pan.startX = camera.x;
    pan.startY = camera.y;
    pan.moved = false;
    pan.lastMoved = false;
    viewportBg.cursor = "grabbing";
    app?.stage?.on?.("pointermove", onPanMove);
    app?.stage?.on?.("pointerup", endPan);
    app?.stage?.on?.("pointerupoutside", endPan);
    ev?.stopPropagation?.();
  }

  function onWheel(ev) {
    if (!root.visible) return;
    const stagePoint = toStageCoordsFromClient(ev.clientX, ev.clientY);
    if (!stagePoint) return;
    const local = viewport.toLocal(stagePoint);
    if (
      local.x < 0 ||
      local.y < 0 ||
      local.x > VIEWPORT_WIDTH ||
      local.y > VIEWPORT_HEIGHT
    ) {
      return;
    }
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAtGlobal(stagePoint.x, stagePoint.y, factor);
  }

  function addEdge(a, b) {
    if (!graph || !a || !b || a === b) return;
    if (!graph.nodesById?.[a] || !graph.nodesById?.[b]) return;
    if (!Array.isArray(graph.edges)) graph.edges = [];
    const exists = edgeExists(graph, a, b);
    if (exists) return false;
    graph.edges.push(
      String(a) <= String(b)
        ? { a: String(a), b: String(b) }
        : { a: String(b), b: String(a) }
    );
    graph.edges.sort((left, right) => {
      if (left.a !== right.a) return left.a.localeCompare(right.a);
      return left.b.localeCompare(right.b);
    });
    return true;
  }

  function removeEdge(a, b) {
    if (!graph || !a || !b || a === b) return false;
    if (!Array.isArray(graph.edges)) graph.edges = [];
    const key = getEdgeKey(a, b);
    const nextEdges = graph.edges.filter(
      (edge) => getEdgeKey(edge.a, edge.b) !== key
    );
    if (nextEdges.length === graph.edges.length) return false;
    graph.edges = nextEdges;
    graph.edges.sort((left, right) => {
      if (left.a !== right.a) return left.a.localeCompare(right.a);
      return left.b.localeCompare(right.b);
    });
    return true;
  }

  function renameNodeId(oldId, nextId) {
    if (!graph || !oldId || !nextId || oldId === nextId) return { ok: false };
    if (!graph.nodesById?.[oldId]) return { ok: false, reason: "missingOldId" };
    if (graph.nodesById[nextId]) return { ok: false, reason: "duplicateId" };
    const node = graph.nodesById[oldId];
    delete graph.nodesById[oldId];
    node.id = nextId;
    graph.nodesById[nextId] = node;

    const edges = [];
    for (const edge of graph.edges || []) {
      const a = edge.a === oldId ? nextId : edge.a;
      const b = edge.b === oldId ? nextId : edge.b;
      if (a === b) continue;
      edges.push(String(a) <= String(b) ? { a, b } : { a: b, b: a });
    }
    graph.edges = edges;
    if (graph.tree?.startNodeId === oldId) {
      graph.tree.startNodeId = nextId;
    }
    if (selectedNodeId === oldId) selectedNodeId = nextId;
    if (connectSourceId === oldId) connectSourceId = nextId;
    return { ok: true };
  }

  function deleteSelectedNode() {
    if (!graph || !selectedNodeId || !graph.nodesById?.[selectedNodeId]) return;
    delete graph.nodesById[selectedNodeId];
    graph.edges = (graph.edges || []).filter(
      (edge) => edge.a !== selectedNodeId && edge.b !== selectedNodeId
    );
    if (graph.tree?.startNodeId === selectedNodeId) {
      const nodeIds = getNodeIds(graph);
      graph.tree.startNodeId = nodeIds[0] || "";
    }
    if (connectSourceId === selectedNodeId) connectSourceId = null;
    selectedNodeId = null;
    recalcAndRender({ save: true });
  }

  function addNodeAtCenter() {
    if (!graph) return;
    const suggested = globalThis?.prompt?.("New node id:", "new_node");
    if (!suggested) return;
    const nodeId = suggested.trim();
    if (!nodeId.length) return;
    if (graph.nodesById[nodeId]) {
      setError(`Node "${nodeId}" already exists.`);
      return;
    }
    const worldX = roundPos((VIEWPORT_WIDTH / 2 - camera.x) / camera.scale);
    const worldY = roundPos((VIEWPORT_HEIGHT / 2 - camera.y) / camera.scale);
    graph.nodesById[nodeId] = {
      id: nodeId,
      treeId: graph.treeId,
      name: nodeId,
      desc: "",
      cost: 1,
      tags: [],
      ringId: null,
      requirements: null,
      effects: {},
      uiNodeRadius: null,
      editorPos: { x: worldX, y: worldY },
      editorPinned: false,
      editorNotes: "",
    };
    selectedNodeId = nodeId;
    recalcAndRender({ save: true });
  }

  function withSelectedNode(mutator) {
    const node = graph?.nodesById?.[selectedNodeId || ""];
    if (!node) {
      setError("Select a node first.");
      return false;
    }
    mutator(node);
    recalcAndRender({ save: true });
    return true;
  }

  async function copyTextOrPrompt(label, text) {
    if (typeof text !== "string" || !text.length) return;
    try {
      await globalThis?.navigator?.clipboard?.writeText?.(text);
      setError(`${label} copied to clipboard.`);
    } catch (_) {
      globalThis?.prompt?.(`${label} (copy manually)`, text);
    }
  }

  function saveSession() {
    if (!graph) return;
    const payload = serializeEditorGraph(graph);
    if (!payload) return;
    try {
      globalThis?.localStorage?.setItem(getStorageKey(), payload);
      setError("Session saved.");
    } catch (_) {
      setError("Failed to save session.");
    }
  }

  function loadSession() {
    if (!activeTreeId) return;
    try {
      const raw = globalThis?.localStorage?.getItem(getStorageKey());
      if (!raw) {
        setError("No saved session found.");
        return;
      }
      const parsed = parseEditorGraphJson(raw);
      if (!parsed.ok || !parsed.graph) {
        setError(`Saved session invalid: ${parsed.reason || "unknown"}`);
        return;
      }
      graph = parsed.graph;
      activeTreeId = parsed.graph.treeId;
      selectedNodeId = null;
      connectSourceId = null;
      resetQuickTemplate();
      setError("Session loaded.");
      fitCameraToGraph();
      recalcAndRender({ save: false });
    } catch (_) {
      setError("Failed to load session.");
    }
  }

  function resetFromDefs() {
    const next = buildEditorGraphFromDefs({ defsInput: activeDefs, treeId: activeTreeId });
    if (!next) {
      setError("Failed to rebuild from defs.");
      return;
    }
    graph = next;
    baseGraph = cloneEditorGraph(next);
    selectedNodeId = null;
    connectSourceId = null;
    resetQuickTemplate();
    fitCameraToGraph();
    recalcAndRender({ save: true });
    setError("Reset from defs complete.");
  }

  function applyAutoLayout() {
    if (!graph) return;
    const res = applyAutoLayoutToEditorGraph(graph, {
      width: VIEWPORT_WIDTH - 140,
      height: VIEWPORT_HEIGHT - 140,
    });
    if (!res.ok || !res.graph) {
      setError(`Auto layout failed: ${res.reason || "unknown"}`);
      return;
    }
    graph = res.graph;
    recalcAndRender({ save: true });
  }

  function getLayoutDraft() {
    if (!graph || !graph.layout || typeof graph.layout !== "object") return {};
    return deepClone(graph.layout);
  }

  function sanitizeLayoutDraft(draftRaw) {
    const draft = draftRaw && typeof draftRaw === "object" ? draftRaw : {};
    const cleaned = {};
    if (Array.isArray(draft.ringOrder) && draft.ringOrder.length > 0) {
      cleaned.ringOrder = parseOrderedIdList(draft.ringOrder.join(","));
    }
    if (draft.radii && typeof draft.radii === "object") {
      const radii = {};
      for (const [key, value] of Object.entries(draft.radii)) {
        if (!Number.isFinite(value)) continue;
        radii[key] = Math.max(0, Math.floor(value));
      }
      if (Object.keys(radii).length > 0) cleaned.radii = radii;
    }
    if (draft.wedgeCentersDeg && typeof draft.wedgeCentersDeg === "object") {
      const centers = {};
      for (const [key, value] of Object.entries(draft.wedgeCentersDeg)) {
        if (!Number.isFinite(value)) continue;
        centers[key] = value;
      }
      if (Object.keys(centers).length > 0) cleaned.wedgeCentersDeg = centers;
    }
    if (draft.wedgeSpansDeg && typeof draft.wedgeSpansDeg === "object") {
      const spans = {};
      for (const [key, value] of Object.entries(draft.wedgeSpansDeg)) {
        if (!Number.isFinite(value)) continue;
        spans[key] = Math.max(0, value);
      }
      if (Object.keys(spans).length > 0) cleaned.wedgeSpansDeg = spans;
    }
    for (const field of [...LAYOUT_SOLVER_FIELDS, ...LAYOUT_RADIAL_FIELDS]) {
      const value = draft[field.key];
      if (!Number.isFinite(value)) continue;
      const min = Number.isFinite(field.min) ? field.min : null;
      let nextValue = field.integer ? Math.floor(value) : value;
      if (Number.isFinite(min)) nextValue = Math.max(min, nextValue);
      cleaned[field.key] = nextValue;
    }
    return cleaned;
  }

  function applyLayoutDraft(nextDraftRaw, successText = "Layout updated.") {
    if (!graph) return;
    const nextDraft = sanitizeLayoutDraft(nextDraftRaw);
    graph.layout = Object.keys(nextDraft).length > 0 ? nextDraft : null;
    if (!graph.tree.ui || typeof graph.tree.ui !== "object") graph.tree.ui = {};
    if (graph.layout) graph.tree.ui.ringLayout = deepClone(graph.layout);
    else delete graph.tree.ui.ringLayout;
    recalcAndRender({ save: true });
    setError(successText);
  }

  function promptLayoutFieldPairs({
    title,
    currentMap = {},
    preferredKeys = [],
    allowedKeys = null,
    integer = false,
    min = null,
  }) {
    const defaultText = formatKeyNumberPairs(currentMap, preferredKeys);
    const input = globalThis?.prompt?.(title, defaultText);
    if (input == null) return { ok: false, cancelled: true };
    if (!input.trim().length) return { ok: true, cleared: true, value: {} };
    const parsed = parseKeyNumberPairs(input, { allowedKeys, integer, min });
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    return { ok: true, value: parsed.value };
  }

  function mergeNumericFieldUpdates(draft, fieldDefs, updates) {
    for (const field of fieldDefs) {
      if (!Object.prototype.hasOwnProperty.call(updates, field.key)) continue;
      draft[field.key] = updates[field.key];
    }
  }

  function clearNumericFields(draft, fieldDefs) {
    for (const field of fieldDefs) {
      delete draft[field.key];
    }
  }

  function openLayoutEditor() {
    if (!graph) return;
    const draft = getLayoutDraft();
    const ringIds = sortRingIds(
      Array.from(
        new Set([
          ...collectRingIdsFromGraph(),
          ...Object.keys(draft.radii || {}),
          ...(Array.isArray(draft.ringOrder) ? draft.ringOrder : []),
        ])
      )
    );
    const summary = [
      "Layout Editor",
      "1) Edit ring order",
      "2) Edit ring radii",
      "3) Edit wedge centers",
      "4) Edit wedge spans",
      "5) Edit solver tuning",
      "6) Edit radial tuning",
      "7) Reset all layout overrides",
      "8) Advanced JSON edit",
      "9) Cancel",
    ].join("\n");
    const choice = globalThis?.prompt?.(summary, "1");
    if (choice == null) return;
    const option = choice.trim();

    if (option === "1") {
      const defaultOrder = Array.isArray(draft.ringOrder) ? draft.ringOrder : ringIds;
      const input = globalThis?.prompt?.(
        "Ring order as comma-separated ids.\nExample: core, ring_01, ring_02, ring_03\nLeave blank to use automatic ring discovery order.",
        defaultOrder.join(", ")
      );
      if (input == null) return;
      if (!input.trim().length) delete draft.ringOrder;
      else draft.ringOrder = parseOrderedIdList(input);
      applyLayoutDraft(draft, "Ring order updated.");
      return;
    }

    if (option === "2") {
      const edited = promptLayoutFieldPairs({
        title:
          "Ring radii as key=value pairs.\nExample: core=0, ring_01=200, ring_02=320\nLeave blank to clear custom radii.",
        currentMap: draft.radii || {},
        preferredKeys: ringIds,
        allowedKeys: null,
        integer: true,
        min: 0,
      });
      if (edited.cancelled) return;
      if (!edited.ok) return setError(edited.reason || "Invalid radii input.");
      if (edited.cleared) delete draft.radii;
      else draft.radii = edited.value;
      applyLayoutDraft(draft, "Ring radii updated.");
      return;
    }

    if (option === "3") {
      const edited = promptLayoutFieldPairs({
        title:
          "Wedge center angles as key=value.\nAllowed keys: Blue, Green, Red, Black, BlueGreen, GreenRed, RedBlack, BlackBlue.\nLeave blank to clear custom wedge centers.",
        currentMap: draft.wedgeCentersDeg || {},
        preferredKeys: LAYOUT_WEDGE_IDS,
        allowedKeys: LAYOUT_WEDGE_IDS,
        integer: false,
      });
      if (edited.cancelled) return;
      if (!edited.ok) return setError(edited.reason || "Invalid wedge center input.");
      if (edited.cleared) delete draft.wedgeCentersDeg;
      else draft.wedgeCentersDeg = edited.value;
      applyLayoutDraft(draft, "Wedge centers updated.");
      return;
    }

    if (option === "4") {
      const edited = promptLayoutFieldPairs({
        title:
          "Wedge span angles as key=value.\nAllowed keys: Blue, Green, Red, Black, BlueGreen, GreenRed, RedBlack, BlackBlue.\nLeave blank to clear custom wedge spans.",
        currentMap: draft.wedgeSpansDeg || {},
        preferredKeys: LAYOUT_WEDGE_IDS,
        allowedKeys: LAYOUT_WEDGE_IDS,
        integer: false,
        min: 0,
      });
      if (edited.cancelled) return;
      if (!edited.ok) return setError(edited.reason || "Invalid wedge span input.");
      if (edited.cleared) delete draft.wedgeSpansDeg;
      else draft.wedgeSpansDeg = edited.value;
      applyLayoutDraft(draft, "Wedge spans updated.");
      return;
    }

    if (option === "5") {
      const current = {};
      for (const field of LAYOUT_SOLVER_FIELDS) {
        if (Number.isFinite(draft[field.key])) current[field.key] = draft[field.key];
      }
      const edited = promptLayoutFieldPairs({
        title:
          "Solver tuning key=value pairs.\nKeys: barycenterIterations, localSwapIterations, overlapIterations, overlapPaddingPx, componentBandGapDeg\nLeave blank to clear this tuning group.",
        currentMap: current,
        preferredKeys: LAYOUT_SOLVER_FIELDS.map((field) => field.key),
        allowedKeys: LAYOUT_SOLVER_FIELDS.map((field) => field.key),
      });
      if (edited.cancelled) return;
      if (!edited.ok) return setError(edited.reason || "Invalid solver tuning input.");
      if (edited.cleared) {
        clearNumericFields(draft, LAYOUT_SOLVER_FIELDS);
      } else {
        for (const field of LAYOUT_SOLVER_FIELDS) {
          if (!Object.prototype.hasOwnProperty.call(edited.value, field.key)) continue;
          let nextValue = edited.value[field.key];
          if (field.integer) nextValue = Math.floor(nextValue);
          if (Number.isFinite(field.min)) nextValue = Math.max(field.min, nextValue);
          edited.value[field.key] = nextValue;
        }
        mergeNumericFieldUpdates(draft, LAYOUT_SOLVER_FIELDS, edited.value);
      }
      applyLayoutDraft(draft, "Solver tuning updated.");
      return;
    }

    if (option === "6") {
      const current = {};
      for (const field of LAYOUT_RADIAL_FIELDS) {
        if (Number.isFinite(draft[field.key])) current[field.key] = draft[field.key];
      }
      const edited = promptLayoutFieldPairs({
        title:
          "Radial tuning key=value pairs.\nKeys: radialNudgeIterations, radialNudgeMaxPx, radialNudgePaddingPx, radialNudgeSpring, coreSpread\nLeave blank to clear this tuning group.",
        currentMap: current,
        preferredKeys: LAYOUT_RADIAL_FIELDS.map((field) => field.key),
        allowedKeys: LAYOUT_RADIAL_FIELDS.map((field) => field.key),
      });
      if (edited.cancelled) return;
      if (!edited.ok) return setError(edited.reason || "Invalid radial tuning input.");
      if (edited.cleared) {
        clearNumericFields(draft, LAYOUT_RADIAL_FIELDS);
      } else {
        for (const field of LAYOUT_RADIAL_FIELDS) {
          if (!Object.prototype.hasOwnProperty.call(edited.value, field.key)) continue;
          let nextValue = edited.value[field.key];
          if (field.integer) nextValue = Math.floor(nextValue);
          if (Number.isFinite(field.min)) nextValue = Math.max(field.min, nextValue);
          edited.value[field.key] = nextValue;
        }
        mergeNumericFieldUpdates(draft, LAYOUT_RADIAL_FIELDS, edited.value);
      }
      applyLayoutDraft(draft, "Radial tuning updated.");
      return;
    }

    if (option === "7") {
      const confirmation = globalThis?.prompt?.(
        "Type RESET to clear all custom ringLayout overrides.",
        ""
      );
      if (confirmation !== "RESET") return;
      applyLayoutDraft({}, "Layout overrides reset.");
      return;
    }

    if (option === "8") {
      const currentText = JSON.stringify(draft, null, 2);
      const input = globalThis?.prompt?.(
        "Advanced ringLayout JSON edit (blank clears all overrides):",
        currentText
      );
      if (input == null) return;
      try {
        const parsed = input.trim().length ? JSON.parse(input) : {};
        if (parsed != null && typeof parsed !== "object") {
          setError("Layout must be a JSON object or blank.");
          return;
        }
        applyLayoutDraft(parsed && typeof parsed === "object" ? parsed : {}, "Layout updated.");
      } catch (_) {
        setError("Invalid layout JSON.");
      }
      return;
    }

    if (option !== "9") {
      setError("Unknown layout editor option.");
    }
  }

  function addButton(id, label, width, onTap) {
    const btn = makeButton(label, width, onTap);
    uiButtons[id] = {
      ...btn,
      setLabel(nextLabel) {
        btn.text.text = nextLabel;
        btn.text.x = Math.floor((width - btn.text.width) / 2);
      },
    };
    root.addChild(btn.root);
    return uiButtons[id];
  }

  function setButtonVisible(id, visible) {
    const btn = uiButtons[id];
    if (!btn) return;
    btn.root.visible = visible;
  }

  function layoutSidebar() {
    const allControlButtons = [
      "exit",
      "saveSession",
      "loadSession",
      "resetDefs",
      "autoLayout",
      "editLayout",
      "addEdgeMode",
      "removeEdgeMode",
      "addNode",
      "deleteNode",
      "editId",
      "editName",
      "editDesc",
      "editTags",
      "editRing",
      "editCost",
      "editNotes",
      "togglePin",
      "quickRingPrev",
      "quickRingNext",
      "quickNode",
      "exportRuntime",
      "exportLayout",
      "exportEditor",
      "importEditor",
    ];
    for (const id of allControlButtons) setButtonVisible(id, false);
    statusText.visible = false;
    quickPanelHintText.visible = false;
    quickRingLabelText.visible = false;
    selectedText.visible = false;
    validationText.visible = false;
    helpText.visible = false;
    for (const entry of QUICK_TAGS) {
      if (quickTagButtons[entry.id]) quickTagButtons[entry.id].root.visible = false;
    }

    let rowY = 64;
    function placeHeader(sectionId) {
      const sectionDef = PANEL_SECTION_DEFS.find((entry) => entry.id === sectionId);
      if (!sectionDef) return;
      const btn = uiButtons[sectionDef.headerButtonId];
      if (!btn) return;
      btn.root.visible = true;
      btn.root.x = PANEL_X;
      btn.root.y = rowY;
      rowY += PANEL_ROW_GAP;
    }

    function placeRow(leftId, rightId) {
      if (leftId) {
        setButtonVisible(leftId, true);
        uiButtons[leftId].root.x = PANEL_X;
        uiButtons[leftId].root.y = rowY;
      }
      if (rightId) {
        setButtonVisible(rightId, true);
        uiButtons[rightId].root.x = PANEL_COL_B_X;
        uiButtons[rightId].root.y = rowY;
      }
      rowY += PANEL_ROW_GAP;
    }

    placeHeader("session");
    if (sectionExpanded.session) {
      statusText.visible = true;
      statusText.x = PANEL_X + 4;
      statusText.y = rowY;
      rowY += statusText.height + PANEL_TEXT_GAP;
      placeRow("exit", "saveSession");
      placeRow("loadSession", "resetDefs");
      placeRow("autoLayout", "editLayout");
      rowY += PANEL_SECTION_GAP;
    }

    placeHeader("graph");
    if (sectionExpanded.graph) {
      placeRow("addEdgeMode", "removeEdgeMode");
      placeRow("addNode", "deleteNode");
      placeRow("editId", "editName");
      placeRow("editTags", "editRing");
      placeRow("editDesc", "editCost");
      placeRow("editNotes", "togglePin");
      rowY += PANEL_SECTION_GAP;
    }

    placeHeader("quick");
    if (sectionExpanded.quick) {
      quickPanelHintText.visible = true;
      quickPanelHintText.x = PANEL_X + 4;
      quickPanelHintText.y = rowY;
      rowY += quickPanelHintText.height + PANEL_TEXT_GAP;

      for (let idx = 0; idx < QUICK_TAGS.length; idx++) {
        const entry = QUICK_TAGS[idx];
        const chip = quickTagButtons[entry.id];
        if (!chip) continue;
        const col = idx % 3;
        const chipRow = Math.floor(idx / 3);
        chip.root.visible = true;
        chip.root.x = PANEL_X + col * 138;
        chip.root.y = rowY + chipRow * 34;
      }
      rowY += Math.ceil(QUICK_TAGS.length / 3) * 34 + PANEL_TEXT_GAP;

      quickRingLabelText.visible = true;
      quickRingLabelText.x = PANEL_X + 4;
      quickRingLabelText.y = rowY;
      rowY += 20;
      placeRow("quickRingPrev", "quickRingNext");
      placeRow("quickNode", null);
      rowY += PANEL_SECTION_GAP;
    }

    placeHeader("io");
    if (sectionExpanded.io) {
      placeRow("exportRuntime", "exportLayout");
      placeRow("exportEditor", "importEditor");
      rowY += PANEL_SECTION_GAP;
    }

    placeHeader("inspect");
    if (sectionExpanded.inspect) {
      selectedText.visible = true;
      selectedText.x = PANEL_X + 4;
      selectedText.y = rowY;
      rowY += selectedText.height + PANEL_TEXT_GAP;

      validationText.visible = true;
      validationText.x = PANEL_X + 4;
      validationText.y = rowY;
      rowY += validationText.height + PANEL_TEXT_GAP;

      helpText.visible = true;
      helpText.x = PANEL_X + 4;
      helpText.y = rowY;
      rowY += helpText.height + PANEL_TEXT_GAP;
    }

    errorText.x = PANEL_X + 4;
    errorText.y = rowY + 2;
  }

  function handleGlobalKeyDown(ev) {
    if (!root.visible || !ev || ev.repeat) return;
    if (isTypingTarget(ev.target)) return;
    const key = typeof ev.key === "string" ? ev.key.toLowerCase() : "";
    if (key === "e") {
      ev.preventDefault();
      const nextMode =
        edgeEditMode === EDGE_EDIT_MODE_ADD
          ? EDGE_EDIT_MODE_NONE
          : EDGE_EDIT_MODE_ADD;
      setEdgeEditMode(nextMode);
      recalcAndRender({ save: false });
      return;
    }
    if (key === "r") {
      ev.preventDefault();
      const nextMode =
        edgeEditMode === EDGE_EDIT_MODE_REMOVE
          ? EDGE_EDIT_MODE_NONE
          : EDGE_EDIT_MODE_REMOVE;
      setEdgeEditMode(nextMode);
      recalcAndRender({ save: false });
      return;
    }
    if ((ev.code || "") === "Escape" || key === "escape") {
      if (edgeEditMode === EDGE_EDIT_MODE_NONE) return;
      ev.preventDefault();
      setEdgeEditMode(EDGE_EDIT_MODE_NONE);
      recalcAndRender({ save: false });
    }
  }

  window.addEventListener("keydown", handleGlobalKeyDown);

  for (const section of PANEL_SECTION_DEFS) {
    addButton(section.headerButtonId, section.title, PANEL_HEADER_WIDTH, () => {
      sectionExpanded[section.id] = sectionExpanded[section.id] !== true;
      updateSectionHeaderLabels();
      layoutSidebar();
    });
  }

  addButton("exit", "Back", 196, () => {
    const exitCb = onExit;
    close();
    exitCb?.({ ok: true });
  });
  addButton("saveSession", "Save Session", 196, () => saveSession());
  addButton("loadSession", "Load Session", 196, () => loadSession());
  addButton("resetDefs", "Reset Defs", 196, () => resetFromDefs());
  addButton("autoLayout", "Auto Layout", 196, () => applyAutoLayout());
  addButton("editLayout", "Edit Layout", 196, () => openLayoutEditor());
  addButton("addEdgeMode", "Add Edge: Off", 196, () => {
    const nextMode =
      edgeEditMode === EDGE_EDIT_MODE_ADD
        ? EDGE_EDIT_MODE_NONE
        : EDGE_EDIT_MODE_ADD;
    setEdgeEditMode(nextMode);
    recalcAndRender({ save: false });
  });
  addButton("removeEdgeMode", "Remove Edge: Off", 196, () => {
    const nextMode =
      edgeEditMode === EDGE_EDIT_MODE_REMOVE
        ? EDGE_EDIT_MODE_NONE
        : EDGE_EDIT_MODE_REMOVE;
    setEdgeEditMode(nextMode);
    recalcAndRender({ save: false });
  });
  addButton("addNode", "Add Node", 196, () => addNodeAtCenter());
  addButton("deleteNode", "Delete Node", 196, () => deleteSelectedNode());

  addButton("editId", "Edit ID", 196, () => {
    if (!selectedNodeId) return setError("Select a node first.");
    const node = graph?.nodesById?.[selectedNodeId];
    if (!node) return;
    const nextId = globalThis?.prompt?.("Node id:", node.id);
    if (!nextId) return;
    const trimmed = nextId.trim();
    if (!trimmed.length) return;
    if (trimmed === node.id) return;
    const rename = renameNodeId(node.id, trimmed);
    if (!rename.ok) {
      setError(`Rename failed: ${rename.reason || "unknown"}`);
      return;
    }
    recalcAndRender({ save: true });
  });
  addButton("editName", "Edit Name", 196, () =>
    withSelectedNode((node) => {
      const value = globalThis?.prompt?.("Name:", node.name || node.id);
      if (value == null) return;
      node.name = value;
    })
  );
  addButton("editDesc", "Edit Desc", 196, () =>
    withSelectedNode((node) => {
      const value = globalThis?.prompt?.("Description:", node.desc || "");
      if (value == null) return;
      node.desc = value;
    })
  );
  addButton("editTags", "Edit Tags", 196, () =>
    withSelectedNode((node) => {
      const value = globalThis?.prompt?.("Tags (comma separated):", (node.tags || []).join(", "));
      if (value == null) return;
      node.tags = parseTagList(value);
    })
  );
  addButton("editRing", "Edit Ring", 196, () =>
    withSelectedNode((node) => {
      const value = globalThis?.prompt?.("Ring id (blank to clear):", node.ringId || "");
      if (value == null) return;
      const next = value.trim();
      node.ringId = next.length ? next : null;
    })
  );
  addButton("editCost", "Edit Cost", 196, () =>
    withSelectedNode((node) => {
      const value = globalThis?.prompt?.("Cost:", String(node.cost ?? 1));
      if (value == null) return;
      const next = Math.max(0, Math.floor(Number(value)));
      if (!Number.isFinite(next)) {
        setError("Cost must be numeric.");
        return;
      }
      node.cost = next;
    })
  );
  addButton("editNotes", "Edit Notes", 196, () =>
    withSelectedNode((node) => {
      const value = globalThis?.prompt?.("Notes:", node.editorNotes || "");
      if (value == null) return;
      node.editorNotes = value;
    })
  );
  addButton("togglePin", "Pin", 196, () =>
    withSelectedNode((node) => {
      node.editorPinned = node.editorPinned !== true;
    })
  );
  addButton("quickRingPrev", "< Ring", 196, () => stepQuickRing(-1));
  addButton("quickRingNext", "Ring >", 196, () => stepQuickRing(1));
  addButton("quickNode", "QuickNode", 196, () => createQuickNodeFromPanel());

  addButton("exportRuntime", "Export Runtime", 196, async () => {
    if (!graph) return;
    const exported = exportRuntimeSkillDefsFromEditorGraph(graph);
    const text = JSON.stringify(
      {
        runtimeDefs: exported.runtimeDefs,
        validation: exported.validation,
      },
      null,
      2
    );
    await copyTextOrPrompt("Runtime export JSON", text);
  });
  addButton("exportLayout", "Export Layout", 196, async () => {
    if (!graph) return;
    const exported = exportLayoutPatchFromEditorGraph(graph);
    const text = JSON.stringify(exported.patch || {}, null, 2);
    await copyTextOrPrompt("Layout patch JSON", text);
  });
  addButton("exportEditor", "Export Editor", 196, async () => {
    if (!graph) return;
    const text = serializeEditorGraph(graph) || "";
    await copyTextOrPrompt("Editor graph JSON", text);
  });
  addButton("importEditor", "Import Editor", 196, () => {
    const raw = globalThis?.prompt?.("Paste editor graph JSON:");
    if (!raw) return;
    const parsed = parseEditorGraphJson(raw);
    if (!parsed.ok || !parsed.graph) {
      setError(`Import failed: ${parsed.reason || "unknown"}`);
      return;
    }
    graph = parsed.graph;
    activeTreeId = parsed.graph.treeId;
    selectedNodeId = null;
    connectSourceId = null;
    resetQuickTemplate();
    fitCameraToGraph();
    recalcAndRender({ save: true });
  });

  quickTagValues = {};
  for (const entry of QUICK_TAGS) {
    quickTagValues[entry.id] = false;
    const chip = makeToggleChip(entry.id, 132, 28, () => applyQuickTagToggle(entry.id));
    quickTagButtons[entry.id] = chip;
    root.addChild(chip.root);
  }
  updateSectionHeaderLabels();
  updateQuickPanelUi();
  layoutSidebar();

  viewportBg.on("pointerdown", startPan);
  viewportBg.on("pointertap", (ev) => {
    if (nodeDrag.active || pan.active || pan.lastMoved) {
      pan.lastMoved = false;
      return;
    }
    selectedNodeId = null;
    hoverNodeId = null;
    connectSourceId =
      edgeEditMode === EDGE_EDIT_MODE_NONE ? null : connectSourceId;
    setError("");
    updateSelectedText();
    renderGraph();
    ev?.stopPropagation?.();
  });
  app?.view?.addEventListener?.("wheel", onWheel, { passive: false });

  function resize() {
    const width = Number.isFinite(app?.screen?.width) ? app.screen.width : 1920;
    const height = Number.isFinite(app?.screen?.height) ? app.screen.height : 1080;
    bg.clear();
    bg.beginFill(0x081224, 0.98);
    bg.drawRect(0, 0, width, height);
    bg.endFill();

    const panelHeight = Math.max(240, height - 24);
    panelBg.clear();
    panelBg.beginFill(0x0c172f, 0.98);
    panelBg.lineStyle(2, 0x273f6d, 0.98);
    panelBg.drawRoundedRect(PANEL_X - 10, 12, PANEL_WIDTH, panelHeight, 12);
    panelBg.endFill();

    viewportMask.clear();
    viewportMask.beginFill(0xffffff, 1);
    viewportMask.drawRoundedRect(
      VIEWPORT_X,
      VIEWPORT_Y,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT,
      12
    );
    viewportMask.endFill();

    viewportBg.clear();
    viewportBg.beginFill(0x101b34, 0.22);
    viewportBg.lineStyle(2, 0x2b3b5f, 0.95);
    viewportBg.drawRoundedRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 12);
    viewportBg.endFill();
    viewportBg.hitArea = new PIXI.Rectangle(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    layoutSidebar();
  }

  function open({ treeId = null, defsInput = null, onExit: onExitCb = null } = {}) {
    const initialGraph = buildEditorGraphFromDefs({ defsInput, treeId });
    if (!initialGraph) return { ok: false, reason: "noTreeGraph" };

    activeTreeId = initialGraph.treeId;
    activeDefs = defsInput;
    onExit = typeof onExitCb === "function" ? onExitCb : null;
    baseGraph = cloneEditorGraph(initialGraph);
    graph = cloneEditorGraph(initialGraph);

    try {
      const raw = globalThis?.localStorage?.getItem(getStorageKey());
      if (raw) {
        const parsed = parseEditorGraphJson(raw);
        if (parsed.ok && parsed.graph && parsed.graph.treeId === activeTreeId) {
          graph = parsed.graph;
        }
      }
    } catch (_) {
      // ignore local storage failures
    }

    selectedNodeId = null;
    hoverNodeId = null;
    connectSourceId = null;
    resetQuickTemplate();
    setEdgeEditMode(EDGE_EDIT_MODE_NONE);
    setError("");
    root.visible = true;
    fitCameraToGraph();
    recalcAndRender({ save: false });
    return { ok: true };
  }

  function close() {
    root.visible = false;
    endPan();
    onNodeDragEnd();
    destroyContainerChildren(treeWorld);
    graph = null;
    baseGraph = null;
    validation = { ok: true, errors: [], warnings: [] };
    selectedNodeId = null;
    hoverNodeId = null;
    connectSourceId = null;
    resetQuickTemplate();
    setEdgeEditMode(EDGE_EDIT_MODE_NONE);
    activeTreeId = null;
    activeDefs = null;
    onExit = null;
    setCamera(1, 0, 0);
    setError("");
    statusText.text = "";
    selectedText.text = "";
    validationText.text = "";
  }

  resize();
  applyCamera();

  return {
    open,
    close,
    isOpen: () => root.visible,
    update: () => {},
    resize,
    getGraph: () => (graph ? deepClone(graph) : null),
    getBaseGraph: () => (baseGraph ? deepClone(baseGraph) : null),
  };
}
