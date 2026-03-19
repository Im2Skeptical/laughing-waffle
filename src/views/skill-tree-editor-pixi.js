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
import {
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
  VIEW_LAYOUT,
} from "./layout-pixi.js";

const DEFAULT_VIEWPORT_X = 20;
const DEFAULT_VIEWPORT_Y = 20;
const DEFAULT_VIEWPORT_WIDTH = 1410;
const DEFAULT_VIEWPORT_HEIGHT = 1040;
const DEFAULT_PANEL_X = 1450;
const DEFAULT_PANEL_WIDTH = 430;
const DEFAULT_PANEL_ROW_GAP = 40;
const DEFAULT_PANEL_SECTION_GAP = 10;
const DEFAULT_PANEL_TEXT_GAP = 8;
const DEFAULT_PANEL_HEADER_WIDTH = 408;
const DEFAULT_PANEL_COL_B_OFFSET = 212;
const VIEWPORT_BORDER_DEFAULT = 0x2b3b5f;
const VIEWPORT_BORDER_ADD = 0x3ca46d;
const VIEWPORT_BORDER_REMOVE = 0xb04b5f;
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
const LAYOUT_DEFAULT_WEDGE_CENTERS = {
  Blue: 135,
  Green: 45,
  Red: -45,
  Black: -135,
  BlueGreen: 90,
  GreenRed: 0,
  RedBlack: -90,
  BlackBlue: 180,
};
const LAYOUT_DEFAULT_WEDGE_SPANS = {
  Blue: 70,
  Green: 70,
  Red: 70,
  Black: 70,
  BlueGreen: 46,
  GreenRed: 46,
  RedBlack: 46,
  BlackBlue: 46,
};
const LAYOUT_EDITOR_MODE_ORDER = "order";
const LAYOUT_EDITOR_MODE_RADII = "radii";
const LAYOUT_EDITOR_MODE_CENTER = "center";
const LAYOUT_EDITOR_MODE_SPAN = "span";
const LAYOUT_EDITOR_MODE_SOLVER = "solver";
const LAYOUT_EDITOR_MODE_RADIAL = "radial";
const NODE_EDITOR_FIELDS = [
  { key: "id", label: "ID", placeholder: "node_id", selectedHint: (node) => node?.id || "" },
  { key: "name", label: "Name", placeholder: "Display name", selectedHint: (node) => node?.name || "" },
  { key: "desc", label: "Desc", placeholder: "Description", selectedHint: (node) => node?.desc || "" },
  {
    key: "tags",
    label: "Tags",
    placeholder: "Tag1, Tag2",
    selectedHint: (node) => (Array.isArray(node?.tags) ? node.tags.join(", ") : ""),
  },
  { key: "ringId", label: "Ring", placeholder: "ring_01 (blank clears)", selectedHint: (node) => node?.ringId || "" },
  {
    key: "cost",
    label: "Cost",
    placeholder: "0",
    selectedHint: (node) => String(Number.isFinite(node?.cost) ? node.cost : 1),
  },
  { key: "editorNotes", label: "Notes", placeholder: "Editor notes", selectedHint: (node) => node?.editorNotes || "" },
];
const LAYOUT_SOLVER_FIELDS = [
  {
    key: "barycenterIterations",
    label: "Barycenter iterations",
    integer: true,
    min: 1,
    defaultValue: 6,
    stepSmall: 1,
    stepLarge: 3,
  },
  {
    key: "localSwapIterations",
    label: "Local swap iterations",
    integer: true,
    min: 0,
    defaultValue: 2,
    stepSmall: 1,
    stepLarge: 3,
  },
  {
    key: "overlapIterations",
    label: "Overlap iterations",
    integer: true,
    min: 0,
    defaultValue: 3,
    stepSmall: 1,
    stepLarge: 3,
  },
  {
    key: "overlapPaddingPx",
    label: "Overlap padding px",
    integer: false,
    min: 0,
    defaultValue: 10,
    stepSmall: 1,
    stepLarge: 5,
  },
  {
    key: "componentBandGapDeg",
    label: "Component band gap deg",
    integer: false,
    min: 0,
    defaultValue: 8,
    stepSmall: 1,
    stepLarge: 5,
  },
  {
    key: "angleSwapIterations",
    label: "Angle swap iterations",
    integer: true,
    min: 0,
    defaultValue: 3,
    stepSmall: 1,
    stepLarge: 3,
  },
  {
    key: "angleSwapAdjacentRingWeight",
    label: "Swap adj ring weight",
    integer: false,
    min: 0,
    defaultValue: 2.1,
    stepSmall: 0.1,
    stepLarge: 0.5,
  },
  {
    key: "angleSwapSameRingWeight",
    label: "Swap same ring weight",
    integer: false,
    min: 0,
    defaultValue: 0.5,
    stepSmall: 0.1,
    stepLarge: 0.5,
  },
  {
    key: "angleSwapFarRingWeight",
    label: "Swap far ring weight",
    integer: false,
    min: 0,
    defaultValue: 1.2,
    stepSmall: 0.1,
    stepLarge: 0.5,
  },
  {
    key: "angleSwapTeleportWeight",
    label: "Teleport link penalty",
    integer: false,
    min: 0,
    defaultValue: 2.4,
    stepSmall: 0.1,
    stepLarge: 0.5,
  },
  {
    key: "angleSwapTeleportRingDeltaStart",
    label: "Teleport ring delta start",
    integer: true,
    min: 1,
    defaultValue: 2,
    stepSmall: 1,
    stepLarge: 1,
  },
  {
    key: "angleSwapTeleportAngleDeg",
    label: "Teleport angle start deg",
    integer: false,
    min: 0,
    defaultValue: 38,
    stepSmall: 1,
    stepLarge: 5,
  },
];
const LAYOUT_RADIAL_FIELDS = [
  {
    key: "radialNudgeIterations",
    label: "Radial nudge iterations",
    integer: true,
    min: 0,
    defaultValue: 4,
    stepSmall: 1,
    stepLarge: 3,
  },
  {
    key: "radialNudgeMaxPx",
    label: "Radial nudge max px",
    integer: false,
    min: 0,
    defaultValue: 36,
    stepSmall: 1,
    stepLarge: 8,
  },
  {
    key: "radialNudgePaddingPx",
    label: "Radial nudge padding px",
    integer: false,
    min: 0,
    defaultValue: 12,
    stepSmall: 1,
    stepLarge: 5,
  },
  {
    key: "radialNudgeSpring",
    label: "Radial nudge spring",
    integer: false,
    min: 0,
    defaultValue: 0.12,
    stepSmall: 0.02,
    stepLarge: 0.08,
  },
  {
    key: "coreSpread",
    label: "Core spread",
    integer: false,
    min: 0,
    defaultValue: 48,
    stepSmall: 2,
    stepLarge: 8,
  },
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

export function createSkillTreeEditorView({ app, layer, layout = null } = {}) {
  const editorLayout =
    layout && typeof layout === "object" ? layout : VIEW_LAYOUT.skillTreeEditor;
  const viewportLayout = editorLayout?.viewport ?? {};
  const panelLayout = editorLayout?.panel ?? {};

  const VIEWPORT_X = Number.isFinite(viewportLayout?.x)
    ? Math.floor(viewportLayout.x)
    : DEFAULT_VIEWPORT_X;
  const VIEWPORT_Y = Number.isFinite(viewportLayout?.y)
    ? Math.floor(viewportLayout.y)
    : DEFAULT_VIEWPORT_Y;
  const VIEWPORT_WIDTH = Number.isFinite(viewportLayout?.width)
    ? Math.floor(viewportLayout.width)
    : DEFAULT_VIEWPORT_WIDTH;
  const VIEWPORT_HEIGHT = Number.isFinite(viewportLayout?.height)
    ? Math.floor(viewportLayout.height)
    : DEFAULT_VIEWPORT_HEIGHT;
  const PANEL_X = Number.isFinite(panelLayout?.x)
    ? Math.floor(panelLayout.x)
    : DEFAULT_PANEL_X;
  const PANEL_WIDTH = Number.isFinite(panelLayout?.width)
    ? Math.floor(panelLayout.width)
    : DEFAULT_PANEL_WIDTH;
  const PANEL_ROW_GAP = Number.isFinite(panelLayout?.rowGap)
    ? Math.floor(panelLayout.rowGap)
    : DEFAULT_PANEL_ROW_GAP;
  const PANEL_SECTION_GAP = Number.isFinite(panelLayout?.sectionGap)
    ? Math.floor(panelLayout.sectionGap)
    : DEFAULT_PANEL_SECTION_GAP;
  const PANEL_TEXT_GAP = Number.isFinite(panelLayout?.textGap)
    ? Math.floor(panelLayout.textGap)
    : DEFAULT_PANEL_TEXT_GAP;
  const PANEL_HEADER_WIDTH = Number.isFinite(panelLayout?.headerWidth)
    ? Math.floor(panelLayout.headerWidth)
    : DEFAULT_PANEL_HEADER_WIDTH;
  const PANEL_COL_B_X = Number.isFinite(panelLayout?.colBX)
    ? Math.floor(panelLayout.colBX)
    : PANEL_X + DEFAULT_PANEL_COL_B_OFFSET;

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

  const layoutEditorText = new PIXI.Text("", {
    fill: 0xbfd5f7,
    fontSize: 11,
    lineHeight: 15,
    wordWrap: true,
    wordWrapWidth: PANEL_WIDTH - 12,
  });
  root.addChild(layoutEditorText);

  const nodeEditorText = new PIXI.Text("", {
    fill: 0xbfd5f7,
    fontSize: 11,
    lineHeight: 15,
    wordWrap: true,
    wordWrapWidth: PANEL_WIDTH - 12,
  });
  root.addChild(nodeEditorText);

  const helpText = new PIXI.Text(
    "Canvas: drag nodes to move, wheel to zoom, drag empty space to pan.\nHotkeys: A auto layout, E add edge, R remove edge, Esc exits edge mode.\nViewport border: green=add edge, red=remove edge.",
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
  const pinch = {
    active: false,
    startScale: 1,
    startDistance: 0,
    anchorWorldX: 0,
    anchorWorldY: 0,
    moved: false,
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
  const layoutEditorState = {
    open: false,
    mode: LAYOUT_EDITOR_MODE_RADII,
    ringIndex: 0,
    wedgeIndex: 0,
    solverIndex: 0,
    radialIndex: 0,
  };
  const nodeEditorState = {
    fieldKey: "name",
  };
  const sectionExpanded = {
    session: true,
    graph: true,
    quick: true,
    io: false,
    inspect: true,
  };
  const layoutValueInput = globalThis?.document?.createElement?.("input") || null;
  const layoutValueInputState = {
    visible: false,
    stageX: 0,
    stageY: 0,
    stageWidth: 0,
    stageHeight: 0,
  };

  if (layoutValueInput) {
    layoutValueInput.type = "text";
    layoutValueInput.autocomplete = "off";
    layoutValueInput.spellcheck = false;
    layoutValueInput.placeholder = "Value";
    layoutValueInput.setAttribute("aria-label", "Layout editor value");
    layoutValueInput.style.position = "fixed";
    layoutValueInput.style.display = "none";
    layoutValueInput.style.zIndex = "20";
    layoutValueInput.style.border = "1px solid #47669a";
    layoutValueInput.style.borderRadius = "6px";
    layoutValueInput.style.background = "#11213f";
    layoutValueInput.style.color = "#e7f0ff";
    layoutValueInput.style.boxSizing = "border-box";
    layoutValueInput.style.padding = "6px 8px";
    layoutValueInput.style.fontSize = "12px";
    layoutValueInput.style.fontFamily = "monospace";
    (app?.view?.parentElement || globalThis?.document?.body)?.appendChild?.(
      layoutValueInput
    );
    layoutValueInput.addEventListener("keydown", (ev) => {
      if ((ev.key || "").toLowerCase() === "enter") {
        ev.preventDefault();
        applyLayoutEditorInputValue();
      }
    });
  }

  const nodeValueInput = globalThis?.document?.createElement?.("input") || null;
  const nodeValueInputState = {
    visible: false,
    stageX: 0,
    stageY: 0,
    stageWidth: 0,
    stageHeight: 0,
  };

  if (nodeValueInput) {
    nodeValueInput.type = "text";
    nodeValueInput.autocomplete = "off";
    nodeValueInput.spellcheck = false;
    nodeValueInput.placeholder = "Node value";
    nodeValueInput.setAttribute("aria-label", "Node editor value");
    nodeValueInput.style.position = "fixed";
    nodeValueInput.style.display = "none";
    nodeValueInput.style.zIndex = "20";
    nodeValueInput.style.border = "1px solid #47669a";
    nodeValueInput.style.borderRadius = "6px";
    nodeValueInput.style.background = "#11213f";
    nodeValueInput.style.color = "#e7f0ff";
    nodeValueInput.style.boxSizing = "border-box";
    nodeValueInput.style.padding = "6px 8px";
    nodeValueInput.style.fontSize = "12px";
    nodeValueInput.style.fontFamily = "monospace";
    (app?.view?.parentElement || globalThis?.document?.body)?.appendChild?.(nodeValueInput);
    nodeValueInput.addEventListener("keydown", (ev) => {
      if ((ev.key || "").toLowerCase() === "enter") {
        ev.preventDefault();
        applyNodeEditorInputValue();
      }
    });
  }

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

  function getNodeEditorFieldDef(fieldKey = nodeEditorState.fieldKey) {
    return (
      NODE_EDITOR_FIELDS.find((entry) => entry.key === fieldKey) ||
      NODE_EDITOR_FIELDS[0]
    );
  }

  function setNodeEditorField(fieldKey) {
    const field = getNodeEditorFieldDef(fieldKey);
    nodeEditorState.fieldKey = field.key;
    updateNodeEditorUi();
    layoutSidebar();
  }

  function updateNodeEditorUi() {
    const field = getNodeEditorFieldDef();
    const node = getSelectedNode();
    uiButtons.editId?.setLabel?.(field.key === "id" ? "[ID]" : "Edit ID");
    uiButtons.editName?.setLabel?.(field.key === "name" ? "[Name]" : "Edit Name");
    uiButtons.editDesc?.setLabel?.(field.key === "desc" ? "[Desc]" : "Edit Desc");
    uiButtons.editTags?.setLabel?.(field.key === "tags" ? "[Tags]" : "Edit Tags");
    uiButtons.editRing?.setLabel?.(field.key === "ringId" ? "[Ring]" : "Edit Ring");
    uiButtons.editCost?.setLabel?.(field.key === "cost" ? "[Cost]" : "Edit Cost");
    uiButtons.editNotes?.setLabel?.(
      field.key === "editorNotes" ? "[Notes]" : "Edit Notes"
    );
    const currentValue = node ? field.selectedHint(node) : "";
    nodeEditorText.text = [
      "Node Field Editor",
      `Field: ${field.label}`,
      `Selected Node: ${node?.id || "(none)"}`,
      `Current: ${currentValue || "(empty)"}`,
      "Enter value and press Apply.",
    ].join("\n");
    if (!nodeValueInput) return;
    const isFocused = globalThis?.document?.activeElement === nodeValueInput;
    if (!isFocused) {
      nodeValueInput.value = currentValue || "";
    }
    nodeValueInput.placeholder = field.placeholder;
  }

  function applyNodeEditorInputValue() {
    const node = getSelectedNode();
    if (!node) {
      setError("Select a node first.");
      return;
    }
    const field = getNodeEditorFieldDef();
    const raw = String(nodeValueInput?.value ?? "").trim();
    if (field.key === "id") {
      if (!raw.length) {
        setError("Node id cannot be empty.");
        return;
      }
      if (raw === node.id) return;
      const rename = renameNodeId(node.id, raw);
      if (!rename.ok) {
        setError(`Rename failed: ${rename.reason || "unknown"}`);
        return;
      }
      recalcAndRender({ save: true });
      return;
    }
    if (field.key === "name") {
      node.name = raw;
      recalcAndRender({ save: true });
      return;
    }
    if (field.key === "desc") {
      node.desc = raw;
      recalcAndRender({ save: true });
      return;
    }
    if (field.key === "tags") {
      node.tags = parseTagList(raw);
      recalcAndRender({ save: true });
      return;
    }
    if (field.key === "ringId") {
      node.ringId = raw.length ? raw : null;
      recalcAndRender({ save: true });
      return;
    }
    if (field.key === "cost") {
      const next = Math.max(0, Math.floor(Number(raw)));
      if (!Number.isFinite(next)) {
        setError("Cost must be numeric.");
        return;
      }
      node.cost = next;
      recalcAndRender({ save: true });
      return;
    }
    if (field.key === "editorNotes") {
      node.editorNotes = raw;
      recalcAndRender({ save: true });
    }
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

  function isPointInsideViewport(stageX, stageY) {
    const local = viewport.toLocal({ x: stageX, y: stageY });
    return (
      local.x >= 0 &&
      local.y >= 0 &&
      local.x <= VIEWPORT_WIDTH &&
      local.y <= VIEWPORT_HEIGHT
    );
  }

  function resetPinchState() {
    pinch.active = false;
    pinch.startScale = camera.scale;
    pinch.startDistance = 0;
    pinch.anchorWorldX = 0;
    pinch.anchorWorldY = 0;
    if (pinch.moved) {
      pan.lastMoved = true;
    }
    pinch.moved = false;
  }

  function primePinchFromTouches(touchA, touchB) {
    const stageA = toStageCoordsFromClient(touchA?.clientX, touchA?.clientY);
    const stageB = toStageCoordsFromClient(touchB?.clientX, touchB?.clientY);
    if (!stageA || !stageB) return false;

    const centerX = (stageA.x + stageB.x) * 0.5;
    const centerY = (stageA.y + stageB.y) * 0.5;
    if (!isPointInsideViewport(centerX, centerY)) return false;

    const distance = Math.hypot(stageA.x - stageB.x, stageA.y - stageB.y);
    if (!Number.isFinite(distance) || distance < 8) return false;

    const localCenter = viewport.toLocal({ x: centerX, y: centerY });
    pinch.active = true;
    pinch.startScale = camera.scale;
    pinch.startDistance = distance;
    pinch.anchorWorldX = (localCenter.x - camera.x) / camera.scale;
    pinch.anchorWorldY = (localCenter.y - camera.y) / camera.scale;
    pinch.moved = false;
    pan.lastMoved = true;
    return true;
  }

  function updatePinchFromTouches(touchA, touchB) {
    if (!pinch.active) return;
    const stageA = toStageCoordsFromClient(touchA?.clientX, touchA?.clientY);
    const stageB = toStageCoordsFromClient(touchB?.clientX, touchB?.clientY);
    if (!stageA || !stageB) return;

    const centerX = (stageA.x + stageB.x) * 0.5;
    const centerY = (stageA.y + stageB.y) * 0.5;
    if (!isPointInsideViewport(centerX, centerY)) return;

    const distance = Math.hypot(stageA.x - stageB.x, stageA.y - stageB.y);
    if (!Number.isFinite(distance) || distance < 4) return;

    const factor = distance / Math.max(1, pinch.startDistance);
    const nextScale = clamp(pinch.startScale * factor, MIN_ZOOM, MAX_ZOOM);
    const localCenter = viewport.toLocal({ x: centerX, y: centerY });
    const nextX = localCenter.x - pinch.anchorWorldX * nextScale;
    const nextY = localCenter.y - pinch.anchorWorldY * nextScale;
    if (
      Math.abs(nextScale - camera.scale) > 0.0001 ||
      Math.abs(nextX - camera.x) > 0.5 ||
      Math.abs(nextY - camera.y) > 0.5
    ) {
      pinch.moved = true;
    }
    setCamera(nextScale, nextX, nextY);
  }

  function onTouchStart(ev) {
    if (!root.visible) return;
    const touches = ev?.touches;
    if (!touches || touches.length < 2) return;
    onNodeDragEnd();
    if (pan.active) endPan();
    if (!pinch.active && primePinchFromTouches(touches[0], touches[1])) {
      ev.preventDefault();
    }
  }

  function onTouchMove(ev) {
    if (!root.visible) return;
    const touches = ev?.touches;
    if (!touches) return;
    if (touches.length < 2) {
      if (pinch.active) resetPinchState();
      return;
    }
    if (!pinch.active) {
      onNodeDragEnd();
      if (pan.active) endPan();
      if (!primePinchFromTouches(touches[0], touches[1])) return;
    }
    updatePinchFromTouches(touches[0], touches[1]);
    ev.preventDefault();
  }

  function onTouchEnd(ev) {
    if (!pinch.active) return;
    const touches = ev?.touches;
    if (touches && touches.length >= 2) {
      if (!primePinchFromTouches(touches[0], touches[1])) {
        resetPinchState();
      }
      if (ev?.cancelable) ev.preventDefault();
      return;
    }
    resetPinchState();
  }

  function toClientRectFromStageRect(stageX, stageY, stageWidth, stageHeight) {
    const view = app?.view;
    const screen = app?.screen;
    if (!view || !screen) return null;
    const rect = view.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x = rect.left + (stageX / screen.width) * rect.width;
    const y = rect.top + (stageY / screen.height) * rect.height;
    const width = (stageWidth / screen.width) * rect.width;
    const height = (stageHeight / screen.height) * rect.height;
    return { x, y, width, height };
  }

  function hideLayoutValueInput() {
    layoutValueInputState.visible = false;
    if (!layoutValueInput) return;
    layoutValueInput.style.display = "none";
  }

  function placeLayoutValueInput(stageX, stageY, stageWidth, stageHeight) {
    layoutValueInputState.visible = true;
    layoutValueInputState.stageX = stageX;
    layoutValueInputState.stageY = stageY;
    layoutValueInputState.stageWidth = stageWidth;
    layoutValueInputState.stageHeight = stageHeight;
    if (!layoutValueInput) return;
    const clientRect = toClientRectFromStageRect(stageX, stageY, stageWidth, stageHeight);
    if (!clientRect || !root.visible || layoutEditorState.open !== true) {
      layoutValueInput.style.display = "none";
      return;
    }
    layoutValueInput.style.display = "block";
    layoutValueInput.style.left = `${Math.round(clientRect.x)}px`;
    layoutValueInput.style.top = `${Math.round(clientRect.y)}px`;
    layoutValueInput.style.width = `${Math.max(30, Math.round(clientRect.width))}px`;
    layoutValueInput.style.height = `${Math.max(24, Math.round(clientRect.height))}px`;
  }

  function hideNodeValueInput() {
    nodeValueInputState.visible = false;
    if (!nodeValueInput) return;
    nodeValueInput.style.display = "none";
  }

  function placeNodeValueInput(stageX, stageY, stageWidth, stageHeight) {
    nodeValueInputState.visible = true;
    nodeValueInputState.stageX = stageX;
    nodeValueInputState.stageY = stageY;
    nodeValueInputState.stageWidth = stageWidth;
    nodeValueInputState.stageHeight = stageHeight;
    if (!nodeValueInput) return;
    const clientRect = toClientRectFromStageRect(stageX, stageY, stageWidth, stageHeight);
    if (!clientRect || !root.visible) {
      nodeValueInput.style.display = "none";
      return;
    }
    nodeValueInput.style.display = "block";
    nodeValueInput.style.left = `${Math.round(clientRect.x)}px`;
    nodeValueInput.style.top = `${Math.round(clientRect.y)}px`;
    nodeValueInput.style.width = `${Math.max(30, Math.round(clientRect.width))}px`;
    nodeValueInput.style.height = `${Math.max(24, Math.round(clientRect.height))}px`;
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
    redrawViewportFrame();
  }

  function getViewportBorderColor() {
    if (edgeEditMode === EDGE_EDIT_MODE_ADD) return VIEWPORT_BORDER_ADD;
    if (edgeEditMode === EDGE_EDIT_MODE_REMOVE) return VIEWPORT_BORDER_REMOVE;
    return VIEWPORT_BORDER_DEFAULT;
  }

  function redrawViewportFrame() {
    viewportBg.clear();
    viewportBg.beginFill(0x101b34, 1);
    viewportBg.lineStyle(edgeEditMode === EDGE_EDIT_MODE_NONE ? 2 : 3, getViewportBorderColor(), 0.95);
    viewportBg.drawRoundedRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 12);
    viewportBg.endFill();
    viewportBg.hitArea = new PIXI.Rectangle(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  }

  function recalcAndRender({ save = true } = {}) {
    validation = validateEditorGraph(graph);
    rebuildQuickRingOptions();
    updateStatusText();
    updateSelectedText();
    updateValidationText();
    updateLayoutEditorUi();
    updateNodeEditorUi();
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
    if (!pan.active || pinch.active) return;
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
    if (!root.visible || nodeDrag.active || pinch.active) return;
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

  function nextDefaultNodeId(prefix = "new_node") {
    const nodeIds = new Set(getNodeIds(graph));
    if (!nodeIds.has(prefix)) return prefix;
    for (let index = 1; index < 10000; index++) {
      const candidate = `${prefix}_${String(index).padStart(2, "0")}`;
      if (!nodeIds.has(candidate)) return candidate;
    }
    return null;
  }

  function addNodeAtCenter(requestedId = null) {
    if (!graph) return;
    const trimmedInput = typeof requestedId === "string" ? requestedId.trim() : "";
    const nodeId = trimmedInput.length ? trimmedInput : nextDefaultNodeId("new_node");
    if (!nodeId) {
      setError("Unable to generate node id.");
      return;
    }
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

  function getLayoutEditorRingIds(draft = getLayoutDraft()) {
    const ringSet = new Set(["core", ...collectRingIdsFromGraph()]);
    for (const ringId of Object.keys(draft?.radii || {})) ringSet.add(ringId);
    for (const ringId of Array.isArray(draft?.ringOrder) ? draft.ringOrder : []) {
      if (typeof ringId === "string" && ringId.length > 0) ringSet.add(ringId);
    }
    return sortRingIds(Array.from(ringSet));
  }

  function normalizeRingOrder(orderRaw, ringIds) {
    const order = parseOrderedIdList(Array.isArray(orderRaw) ? orderRaw.join(",") : "");
    const seen = new Set(order);
    for (const ringId of ringIds) {
      if (seen.has(ringId)) continue;
      seen.add(ringId);
      order.push(ringId);
    }
    return order;
  }

  function ensureLayoutEditorIndexes(draft = getLayoutDraft()) {
    const ringCount = Math.max(1, getLayoutEditorRingIds(draft).length);
    const wedgeCount = Math.max(1, LAYOUT_WEDGE_IDS.length);
    const solverCount = Math.max(1, LAYOUT_SOLVER_FIELDS.length);
    const radialCount = Math.max(1, LAYOUT_RADIAL_FIELDS.length);
    layoutEditorState.ringIndex = ((layoutEditorState.ringIndex % ringCount) + ringCount) % ringCount;
    layoutEditorState.wedgeIndex =
      ((layoutEditorState.wedgeIndex % wedgeCount) + wedgeCount) % wedgeCount;
    layoutEditorState.solverIndex =
      ((layoutEditorState.solverIndex % solverCount) + solverCount) % solverCount;
    layoutEditorState.radialIndex =
      ((layoutEditorState.radialIndex % radialCount) + radialCount) % radialCount;
  }

  function getCurrentLayoutEditorMode() {
    const valid = new Set([
      LAYOUT_EDITOR_MODE_ORDER,
      LAYOUT_EDITOR_MODE_RADII,
      LAYOUT_EDITOR_MODE_CENTER,
      LAYOUT_EDITOR_MODE_SPAN,
      LAYOUT_EDITOR_MODE_SOLVER,
      LAYOUT_EDITOR_MODE_RADIAL,
    ]);
    if (!valid.has(layoutEditorState.mode)) layoutEditorState.mode = LAYOUT_EDITOR_MODE_RADII;
    return layoutEditorState.mode;
  }

  function getLayoutEditorTargetInfo(draft = getLayoutDraft()) {
    ensureLayoutEditorIndexes(draft);
    const mode = getCurrentLayoutEditorMode();
    const ringIds = getLayoutEditorRingIds(draft);

    if (mode === LAYOUT_EDITOR_MODE_ORDER) {
      const ringId = ringIds[layoutEditorState.ringIndex] || "core";
      const order = normalizeRingOrder(draft.ringOrder, ringIds);
      const orderIndex = Math.max(0, order.indexOf(ringId));
      return {
        mode,
        targetKey: ringId,
        targetLabel: `Ring ${ringId}`,
        value: `${orderIndex + 1} / ${order.length}`,
        isOverride: Array.isArray(draft.ringOrder) && draft.ringOrder.length > 0,
      };
    }

    if (mode === LAYOUT_EDITOR_MODE_RADII) {
      const ringId = ringIds[layoutEditorState.ringIndex] || "core";
      const hasOverride = Number.isFinite(draft?.radii?.[ringId]);
      return {
        mode,
        targetKey: ringId,
        targetLabel: `Radius ${ringId}`,
        value: hasOverride ? Math.floor(draft.radii[ringId]) : "(auto)",
        isOverride: hasOverride,
      };
    }

    if (mode === LAYOUT_EDITOR_MODE_CENTER || mode === LAYOUT_EDITOR_MODE_SPAN) {
      const wedgeId = LAYOUT_WEDGE_IDS[layoutEditorState.wedgeIndex] || "Blue";
      const mapKey = mode === LAYOUT_EDITOR_MODE_CENTER ? "wedgeCentersDeg" : "wedgeSpansDeg";
      const defaults =
        mode === LAYOUT_EDITOR_MODE_CENTER
          ? LAYOUT_DEFAULT_WEDGE_CENTERS
          : LAYOUT_DEFAULT_WEDGE_SPANS;
      const hasOverride = Number.isFinite(draft?.[mapKey]?.[wedgeId]);
      return {
        mode,
        targetKey: wedgeId,
        targetLabel:
          mode === LAYOUT_EDITOR_MODE_CENTER
            ? `Center ${wedgeId}`
            : `Span ${wedgeId}`,
        value: hasOverride ? draft[mapKey][wedgeId] : defaults[wedgeId],
        isOverride: hasOverride,
      };
    }

    if (mode === LAYOUT_EDITOR_MODE_SOLVER || mode === LAYOUT_EDITOR_MODE_RADIAL) {
      const fieldList =
        mode === LAYOUT_EDITOR_MODE_SOLVER ? LAYOUT_SOLVER_FIELDS : LAYOUT_RADIAL_FIELDS;
      const field =
        fieldList[
          mode === LAYOUT_EDITOR_MODE_SOLVER
            ? layoutEditorState.solverIndex
            : layoutEditorState.radialIndex
        ] || fieldList[0];
      const hasOverride = Number.isFinite(draft?.[field.key]);
      return {
        mode,
        targetKey: field.key,
        targetLabel: field.label,
        value: hasOverride ? draft[field.key] : field.defaultValue,
        isOverride: hasOverride,
      };
    }

    return {
      mode,
      targetKey: "",
      targetLabel: "(none)",
      value: "-",
      isOverride: false,
    };
  }

  function getLayoutEditorInputDescriptor(draft = getLayoutDraft()) {
    const mode = getCurrentLayoutEditorMode();
    ensureLayoutEditorIndexes(draft);

    if (mode === LAYOUT_EDITOR_MODE_ORDER) {
      const ringIds = getLayoutEditorRingIds(draft);
      const ringId = ringIds[layoutEditorState.ringIndex] || "core";
      const order = normalizeRingOrder(draft.ringOrder, ringIds);
      const orderIndex = Math.max(0, order.indexOf(ringId));
      return {
        mode,
        value: String(orderIndex + 1),
        placeholder: `1-${Math.max(1, order.length)}`,
      };
    }

    if (mode === LAYOUT_EDITOR_MODE_RADII) {
      const ringId = getLayoutEditorRingIds(draft)[layoutEditorState.ringIndex] || "core";
      const hasOverride = Number.isFinite(draft?.radii?.[ringId]);
      return {
        mode,
        value: hasOverride ? String(Math.floor(draft.radii[ringId])) : "",
        placeholder: "auto",
      };
    }

    if (mode === LAYOUT_EDITOR_MODE_CENTER || mode === LAYOUT_EDITOR_MODE_SPAN) {
      const wedgeId = LAYOUT_WEDGE_IDS[layoutEditorState.wedgeIndex] || "Blue";
      const mapKey = mode === LAYOUT_EDITOR_MODE_CENTER ? "wedgeCentersDeg" : "wedgeSpansDeg";
      const defaults =
        mode === LAYOUT_EDITOR_MODE_CENTER
          ? LAYOUT_DEFAULT_WEDGE_CENTERS
          : LAYOUT_DEFAULT_WEDGE_SPANS;
      const hasOverride = Number.isFinite(draft?.[mapKey]?.[wedgeId]);
      return {
        mode,
        value: hasOverride ? String(draft[mapKey][wedgeId]) : "",
        placeholder: String(defaults[wedgeId]),
      };
    }

    const list =
      mode === LAYOUT_EDITOR_MODE_SOLVER ? LAYOUT_SOLVER_FIELDS : LAYOUT_RADIAL_FIELDS;
    const field =
      list[
        mode === LAYOUT_EDITOR_MODE_SOLVER
          ? layoutEditorState.solverIndex
          : layoutEditorState.radialIndex
      ] || list[0];
    const hasOverride = Number.isFinite(draft?.[field.key]);
    return {
      mode,
      value: hasOverride ? String(draft[field.key]) : "",
      placeholder: String(field.defaultValue),
    };
  }

  function syncLayoutValueInput(descriptor) {
    if (!layoutValueInput) return;
    const isFocused = globalThis?.document?.activeElement === layoutValueInput;
    if (!isFocused) {
      layoutValueInput.value = descriptor?.value ?? "";
    }
    layoutValueInput.placeholder = descriptor?.placeholder ?? "";
  }

  function updateLayoutEditorUi() {
    const mode = getCurrentLayoutEditorMode();
    uiButtons.editLayout?.setLabel?.(
      layoutEditorState.open ? "Edit Layout: On" : "Edit Layout: Off"
    );
    uiButtons.layoutModeOrder?.setLabel?.(
      mode === LAYOUT_EDITOR_MODE_ORDER ? "[Order]" : "Order"
    );
    uiButtons.layoutModeRadii?.setLabel?.(
      mode === LAYOUT_EDITOR_MODE_RADII ? "[Radii]" : "Radii"
    );
    uiButtons.layoutModeCenter?.setLabel?.(
      mode === LAYOUT_EDITOR_MODE_CENTER ? "[Centers]" : "Centers"
    );
    uiButtons.layoutModeSpan?.setLabel?.(
      mode === LAYOUT_EDITOR_MODE_SPAN ? "[Spans]" : "Spans"
    );
    uiButtons.layoutModeSolver?.setLabel?.(
      mode === LAYOUT_EDITOR_MODE_SOLVER ? "[Solver]" : "Solver"
    );
    uiButtons.layoutModeRadial?.setLabel?.(
      mode === LAYOUT_EDITOR_MODE_RADIAL ? "[Radial]" : "Radial"
    );

    if (!layoutEditorState.open) {
      layoutEditorText.text = "";
      hideLayoutValueInput();
      return;
    }
    const draft = getLayoutDraft();
    const info = getLayoutEditorTargetInfo(draft);
    const descriptor = getLayoutEditorInputDescriptor(draft);
    syncLayoutValueInput(descriptor);
    const modeLabel = {
      [LAYOUT_EDITOR_MODE_ORDER]: "Ring Order",
      [LAYOUT_EDITOR_MODE_RADII]: "Ring Radii",
      [LAYOUT_EDITOR_MODE_CENTER]: "Wedge Centers",
      [LAYOUT_EDITOR_MODE_SPAN]: "Wedge Spans",
      [LAYOUT_EDITOR_MODE_SOLVER]: "Solver Tuning",
      [LAYOUT_EDITOR_MODE_RADIAL]: "Radial Tuning",
    }[mode] || mode;
    const overrideText = info.isOverride ? "custom" : "default";
    layoutEditorText.text = [
      `Layout UI Editor`,
      `Mode: ${modeLabel}`,
      `Target: ${info.targetLabel}`,
      `Value: ${info.value} (${overrideText})`,
      `Enter value in field and press Apply.`,
    ].join("\n");
  }

  function setLayoutEditorMode(mode) {
    layoutEditorState.mode = mode;
    updateLayoutEditorUi();
    layoutSidebar();
  }

  function toggleLayoutEditorPanel() {
    layoutEditorState.open = layoutEditorState.open !== true;
    updateLayoutEditorUi();
    layoutSidebar();
  }

  function cycleLayoutEditorTarget(direction) {
    const dir = direction >= 0 ? 1 : -1;
    const mode = getCurrentLayoutEditorMode();
    const draft = getLayoutDraft();
    ensureLayoutEditorIndexes(draft);
    if (mode === LAYOUT_EDITOR_MODE_ORDER || mode === LAYOUT_EDITOR_MODE_RADII) {
      const ringCount = Math.max(1, getLayoutEditorRingIds(draft).length);
      layoutEditorState.ringIndex =
        (layoutEditorState.ringIndex + dir + ringCount) % ringCount;
    } else if (mode === LAYOUT_EDITOR_MODE_CENTER || mode === LAYOUT_EDITOR_MODE_SPAN) {
      const wedgeCount = Math.max(1, LAYOUT_WEDGE_IDS.length);
      layoutEditorState.wedgeIndex =
        (layoutEditorState.wedgeIndex + dir + wedgeCount) % wedgeCount;
    } else if (mode === LAYOUT_EDITOR_MODE_SOLVER) {
      const fieldCount = Math.max(1, LAYOUT_SOLVER_FIELDS.length);
      layoutEditorState.solverIndex =
        (layoutEditorState.solverIndex + dir + fieldCount) % fieldCount;
    } else if (mode === LAYOUT_EDITOR_MODE_RADIAL) {
      const fieldCount = Math.max(1, LAYOUT_RADIAL_FIELDS.length);
      layoutEditorState.radialIndex =
        (layoutEditorState.radialIndex + dir + fieldCount) % fieldCount;
    }
    updateLayoutEditorUi();
    layoutSidebar();
  }

  function setLayoutEditorRingOrderIndex(targetIndex) {
    const draft = getLayoutDraft();
    const ringIds = getLayoutEditorRingIds(draft);
    const ringId = ringIds[layoutEditorState.ringIndex] || "core";
    const order = normalizeRingOrder(draft.ringOrder, ringIds);
    const currentIndex = order.indexOf(ringId);
    if (currentIndex < 0) return;
    const nextIndex = clamp(targetIndex, 0, order.length - 1);
    if (nextIndex === currentIndex) return;
    order.splice(currentIndex, 1);
    order.splice(nextIndex, 0, ringId);
    draft.ringOrder = order;
    applyLayoutDraft(draft, "Ring order updated.");
  }

  function applyLayoutEditorInputValue() {
    if (!layoutEditorState.open || !graph) return;
    const inputRaw = String(layoutValueInput?.value ?? "").trim();
    const mode = getCurrentLayoutEditorMode();
    if (!graph) return;

    const draft = getLayoutDraft();
    ensureLayoutEditorIndexes(draft);

    if (mode === LAYOUT_EDITOR_MODE_ORDER) {
      const ringIds = getLayoutEditorRingIds(draft);
      const ringId = ringIds[layoutEditorState.ringIndex] || "core";
      const order = normalizeRingOrder(draft.ringOrder, ringIds);
      const currentIndex = Math.max(0, order.indexOf(ringId));
      const inputValue = inputRaw.length ? Number(inputRaw) : currentIndex + 1;
      if (!Number.isFinite(inputValue)) {
        setError("Ring order position must be numeric.");
        return;
      }
      setLayoutEditorRingOrderIndex(Math.floor(inputValue) - 1);
      return;
    }

    if (mode === LAYOUT_EDITOR_MODE_RADII) {
      if (!inputRaw.length) {
        resetLayoutEditorTarget();
        return;
      }
      const ringId = getLayoutEditorRingIds(draft)[layoutEditorState.ringIndex] || "core";
      const parsed = inputRaw.length ? Number(inputRaw) : null;
      if (!Number.isFinite(parsed)) {
        setError("Ring radius must be numeric.");
        return;
      }
      const next = Math.max(0, Math.floor(parsed));
      if (!draft.radii || typeof draft.radii !== "object") draft.radii = {};
      draft.radii[ringId] = next;
      applyLayoutDraft(draft, "Ring radius updated.");
      return;
    }

    if (mode === LAYOUT_EDITOR_MODE_CENTER || mode === LAYOUT_EDITOR_MODE_SPAN) {
      if (!inputRaw.length) {
        resetLayoutEditorTarget();
        return;
      }
      const wedgeId = LAYOUT_WEDGE_IDS[layoutEditorState.wedgeIndex] || "Blue";
      const mapKey = mode === LAYOUT_EDITOR_MODE_CENTER ? "wedgeCentersDeg" : "wedgeSpansDeg";
      let next = Number(inputRaw);
      if (!Number.isFinite(next)) {
        setError("Wedge value must be numeric.");
        return;
      }
      if (mode === LAYOUT_EDITOR_MODE_SPAN) next = Math.max(0, next);
      if (!draft[mapKey] || typeof draft[mapKey] !== "object") draft[mapKey] = {};
      draft[mapKey][wedgeId] = next;
      applyLayoutDraft(
        draft,
        mode === LAYOUT_EDITOR_MODE_CENTER ? "Wedge center updated." : "Wedge span updated."
      );
      return;
    }

    if (mode === LAYOUT_EDITOR_MODE_SOLVER || mode === LAYOUT_EDITOR_MODE_RADIAL) {
      if (!inputRaw.length) {
        resetLayoutEditorTarget();
        return;
      }
      const list =
        mode === LAYOUT_EDITOR_MODE_SOLVER ? LAYOUT_SOLVER_FIELDS : LAYOUT_RADIAL_FIELDS;
      const field =
        list[
          mode === LAYOUT_EDITOR_MODE_SOLVER
            ? layoutEditorState.solverIndex
            : layoutEditorState.radialIndex
        ] || list[0];
      let next = Number(inputRaw);
      if (!Number.isFinite(next)) {
        setError("Tuning value must be numeric.");
        return;
      }
      if (Number.isFinite(field.min)) next = Math.max(field.min, next);
      if (field.integer) next = Math.floor(next);
      draft[field.key] = next;
      applyLayoutDraft(draft, `${field.label} updated.`);
    }
  }

  function resetLayoutEditorTarget() {
    if (!graph) return;
    const draft = getLayoutDraft();
    const mode = getCurrentLayoutEditorMode();
    ensureLayoutEditorIndexes(draft);
    if (mode === LAYOUT_EDITOR_MODE_ORDER) {
      delete draft.ringOrder;
      applyLayoutDraft(draft, "Custom ring order cleared.");
      return;
    }
    if (mode === LAYOUT_EDITOR_MODE_RADII) {
      const ringId = getLayoutEditorRingIds(draft)[layoutEditorState.ringIndex] || "core";
      if (draft.radii && typeof draft.radii === "object") {
        delete draft.radii[ringId];
        if (!Object.keys(draft.radii).length) delete draft.radii;
      }
      applyLayoutDraft(draft, `Radius override cleared for ${ringId}.`);
      return;
    }
    if (mode === LAYOUT_EDITOR_MODE_CENTER || mode === LAYOUT_EDITOR_MODE_SPAN) {
      const wedgeId = LAYOUT_WEDGE_IDS[layoutEditorState.wedgeIndex] || "Blue";
      const mapKey = mode === LAYOUT_EDITOR_MODE_CENTER ? "wedgeCentersDeg" : "wedgeSpansDeg";
      if (draft[mapKey] && typeof draft[mapKey] === "object") {
        delete draft[mapKey][wedgeId];
        if (!Object.keys(draft[mapKey]).length) delete draft[mapKey];
      }
      applyLayoutDraft(
        draft,
        mode === LAYOUT_EDITOR_MODE_CENTER
          ? `Center override cleared for ${wedgeId}.`
          : `Span override cleared for ${wedgeId}.`
      );
      return;
    }
    const list =
      mode === LAYOUT_EDITOR_MODE_SOLVER ? LAYOUT_SOLVER_FIELDS : LAYOUT_RADIAL_FIELDS;
    const field =
      list[
        mode === LAYOUT_EDITOR_MODE_SOLVER
          ? layoutEditorState.solverIndex
          : layoutEditorState.radialIndex
      ] || list[0];
    delete draft[field.key];
    applyLayoutDraft(draft, `${field.label} override cleared.`);
  }

  function resetLayoutEditorAll() {
    applyLayoutDraft({}, "All layout overrides cleared.");
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
      "layoutModeOrder",
      "layoutModeRadii",
      "layoutModeCenter",
      "layoutModeSpan",
      "layoutModeSolver",
      "layoutModeRadial",
      "layoutTargetPrev",
      "layoutTargetNext",
      "layoutApplyValue",
      "layoutResetTarget",
      "layoutResetAll",
      "applyNodeValue",
    ];
    for (const id of allControlButtons) setButtonVisible(id, false);
    statusText.visible = false;
    layoutEditorText.visible = false;
    nodeEditorText.visible = false;
    hideLayoutValueInput();
    hideNodeValueInput();
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
      if (layoutEditorState.open) {
        layoutEditorText.visible = true;
        layoutEditorText.x = PANEL_X + 4;
        layoutEditorText.y = rowY;
        rowY += layoutEditorText.height + PANEL_TEXT_GAP;
        placeRow("layoutModeOrder", "layoutModeRadii");
        placeRow("layoutModeCenter", "layoutModeSpan");
        placeRow("layoutModeSolver", "layoutModeRadial");
        placeRow("layoutTargetPrev", "layoutTargetNext");
        placeLayoutValueInput(PANEL_X + 4, rowY + 4, 196, 30);
        placeRow(null, "layoutApplyValue");
        placeRow("layoutResetTarget", "layoutResetAll");
      }
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
      nodeEditorText.visible = true;
      nodeEditorText.x = PANEL_X + 4;
      nodeEditorText.y = rowY;
      rowY += nodeEditorText.height + PANEL_TEXT_GAP;
      placeNodeValueInput(PANEL_X + 4, rowY + 4, 196, 30);
      placeRow(null, "applyNodeValue");
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
    if (key === "a") {
      ev.preventDefault();
      applyAutoLayout();
      return;
    }
    if (key === "q") {
      ev.preventDefault();
      createQuickNodeFromPanel();
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
  addButton("editLayout", "Edit Layout: Off", 196, () => toggleLayoutEditorPanel());
  addButton("layoutModeOrder", "Order", 196, () => setLayoutEditorMode(LAYOUT_EDITOR_MODE_ORDER));
  addButton("layoutModeRadii", "Radii", 196, () => setLayoutEditorMode(LAYOUT_EDITOR_MODE_RADII));
  addButton("layoutModeCenter", "Centers", 196, () =>
    setLayoutEditorMode(LAYOUT_EDITOR_MODE_CENTER)
  );
  addButton("layoutModeSpan", "Spans", 196, () => setLayoutEditorMode(LAYOUT_EDITOR_MODE_SPAN));
  addButton("layoutModeSolver", "Solver", 196, () =>
    setLayoutEditorMode(LAYOUT_EDITOR_MODE_SOLVER)
  );
  addButton("layoutModeRadial", "Radial", 196, () =>
    setLayoutEditorMode(LAYOUT_EDITOR_MODE_RADIAL)
  );
  addButton("layoutTargetPrev", "< Target", 196, () => cycleLayoutEditorTarget(-1));
  addButton("layoutTargetNext", "Target >", 196, () => cycleLayoutEditorTarget(1));
  addButton("layoutApplyValue", "Apply Value", 196, () => applyLayoutEditorInputValue());
  addButton("layoutResetTarget", "Reset Target", 196, () => resetLayoutEditorTarget());
  addButton("layoutResetAll", "Reset All", 196, () => resetLayoutEditorAll());
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
  addButton("addNode", "Add Node", 196, () => {
    const requestedId = String(nodeValueInput?.value ?? "");
    addNodeAtCenter(requestedId);
  });
  addButton("deleteNode", "Delete Node", 196, () => deleteSelectedNode());

  addButton("editId", "Edit ID", 196, () => setNodeEditorField("id"));
  addButton("editName", "Edit Name", 196, () => setNodeEditorField("name"));
  addButton("editDesc", "Edit Desc", 196, () => setNodeEditorField("desc"));
  addButton("editTags", "Edit Tags", 196, () => setNodeEditorField("tags"));
  addButton("editRing", "Edit Ring", 196, () => setNodeEditorField("ringId"));
  addButton("editCost", "Edit Cost", 196, () => setNodeEditorField("cost"));
  addButton("editNotes", "Edit Notes", 196, () => setNodeEditorField("editorNotes"));
  addButton("applyNodeValue", "Apply Field", 196, () => applyNodeEditorInputValue());
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
  updateLayoutEditorUi();
  updateNodeEditorUi();
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
  app?.view?.addEventListener?.("touchstart", onTouchStart, { passive: false });
  app?.view?.addEventListener?.("touchmove", onTouchMove, { passive: false });
  app?.view?.addEventListener?.("touchend", onTouchEnd, { passive: false });
  app?.view?.addEventListener?.("touchcancel", onTouchEnd, { passive: false });

  function resize() {
    const width = Number.isFinite(app?.screen?.width)
      ? app.screen.width
      : VIEWPORT_DESIGN_WIDTH;
    const height = Number.isFinite(app?.screen?.height)
      ? app.screen.height
      : VIEWPORT_DESIGN_HEIGHT;
    bg.clear();
    bg.beginFill(0x081224, 1);
    bg.drawRect(0, 0, width, height);
    bg.endFill();

    const panelHeight = Math.max(240, height - 24);
    panelBg.clear();
    panelBg.beginFill(0x0c172f, 1);
    panelBg.lineStyle(2, 0x273f6d, 1);
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

    redrawViewportFrame();
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
    layoutEditorState.open = false;
    if (layoutValueInput) layoutValueInput.value = "";
    if (nodeValueInput) nodeValueInput.value = "";
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
    resetPinchState();
    destroyContainerChildren(treeWorld);
    graph = null;
    baseGraph = null;
    validation = { ok: true, errors: [], warnings: [] };
    selectedNodeId = null;
    hoverNodeId = null;
    connectSourceId = null;
    layoutEditorState.open = false;
    hideLayoutValueInput();
    hideNodeValueInput();
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
    getScreenRect: () =>
      !root.visible
        ? null
        : {
            x: 0,
            y: 0,
            width: Number.isFinite(app?.screen?.width)
              ? app.screen.width
              : VIEWPORT_DESIGN_WIDTH,
            height: Number.isFinite(app?.screen?.height)
              ? app.screen.height
              : VIEWPORT_DESIGN_HEIGHT,
          },
  };
}
