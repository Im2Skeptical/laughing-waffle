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
const EDGE_EDIT_MODE_NONE = "none";
const EDGE_EDIT_MODE_ADD = "add";
const EDGE_EDIT_MODE_REMOVE = "remove";

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

export function createSkillTreeEditorView({ app, layer } = {}) {
  const root = new PIXI.Container();
  root.visible = false;
  root.eventMode = "static";
  layer.addChild(root);

  const bg = new PIXI.Graphics();
  root.addChild(bg);

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
    fontSize: 13,
    lineHeight: 18,
    wordWrap: true,
    wordWrapWidth: 440,
  });
  statusText.x = PANEL_X;
  statusText.y = 54;
  root.addChild(statusText);

  const errorText = new PIXI.Text("", {
    fill: 0xff9e9e,
    fontSize: 12,
    lineHeight: 16,
    wordWrap: true,
    wordWrapWidth: 440,
  });
  errorText.x = PANEL_X;
  errorText.y = 760;
  root.addChild(errorText);

  const selectedText = new PIXI.Text("", {
    fill: 0xe5edf9,
    fontSize: 12,
    lineHeight: 16,
    wordWrap: true,
    wordWrapWidth: 440,
  });
  selectedText.x = PANEL_X;
  selectedText.y = 522;
  root.addChild(selectedText);

  const validationText = new PIXI.Text("", {
    fill: 0xc6d8f2,
    fontSize: 12,
    lineHeight: 16,
    wordWrap: true,
    wordWrapWidth: 440,
  });
  validationText.x = PANEL_X;
  validationText.y = 845;
  root.addChild(validationText);

  const helpText = new PIXI.Text(
    "Canvas: drag nodes to move, wheel to zoom, drag empty space to pan.\nHotkeys: E add edge, R remove edge, Esc exits edge mode.",
    {
      fill: 0x91a7cc,
      fontSize: 11,
      lineHeight: 15,
      wordWrap: true,
      wordWrapWidth: 440,
    }
  );
  helpText.x = PANEL_X;
  helpText.y = 998;
  root.addChild(helpText);

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
  zoomText.x = PANEL_X + 308;
  zoomText.y = 122;
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
    const node =
      graph && selectedNodeId && graph.nodesById
        ? graph.nodesById[selectedNodeId] || null
        : null;
    if (!node) {
      selectedText.text = "Selected: none";
      uiButtons.togglePin?.setLabel?.("Pin");
      return;
    }
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
    edgeEditMode = mode;
    if (edgeEditMode === EDGE_EDIT_MODE_NONE) connectSourceId = null;
    updateEdgeModeButtons();
    updateStatusText();
  }

  function recalcAndRender({ save = true } = {}) {
    validation = validateEditorGraph(graph);
    updateStatusText();
    updateSelectedText();
    updateValidationText();
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

  function layoutButtons() {
    const colA = PANEL_X;
    const colB = PANEL_X + 212;
    let row = 102;
    const rowGap = 40;

    function place(id, col = "a") {
      const btn = uiButtons[id];
      if (!btn) return;
      btn.root.x = col === "a" ? colA : colB;
      btn.root.y = row;
      if (col === "b") row += rowGap;
    }

    place("exit", "a");
    place("saveSession", "b");
    place("loadSession", "a");
    place("resetDefs", "b");
    place("autoLayout", "a");
    place("editLayout", "b");
    place("addEdgeMode", "a");
    place("removeEdgeMode", "b");
    place("addNode", "a");
    place("deleteNode", "b");
    place("editId", "a");
    place("editName", "b");
    place("editDesc", "a");
    place("editTags", "b");
    place("editRing", "a");
    place("editCost", "b");
    place("editNotes", "a");
    place("togglePin", "b");
    place("exportRuntime", "a");
    place("exportLayout", "b");
    place("exportEditor", "a");
    place("importEditor", "b");
  }

  function handleGlobalKeyDown(ev) {
    if (!root.visible || !ev || ev.repeat) return;
    if (isTypingTarget(ev.target)) return;
    const key = typeof ev.key === "string" ? ev.key.toLowerCase() : "";
    if (key === "e") {
      ev.preventDefault();
      setEdgeEditMode(EDGE_EDIT_MODE_ADD);
      recalcAndRender({ save: false });
      return;
    }
    if (key === "r") {
      ev.preventDefault();
      setEdgeEditMode(EDGE_EDIT_MODE_REMOVE);
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

  addButton("exit", "Back", 196, () => {
    const exitCb = onExit;
    close();
    exitCb?.({ ok: true });
  });
  addButton("saveSession", "Save Session", 196, () => saveSession());
  addButton("loadSession", "Load Session", 196, () => loadSession());
  addButton("resetDefs", "Reset Defs", 196, () => resetFromDefs());
  addButton("autoLayout", "Auto Layout", 196, () => applyAutoLayout());
  addButton("editLayout", "Edit Layout", 196, () => {
    if (!graph) return;
    const currentText = JSON.stringify(graph.layout || {}, null, 2);
    const input = globalThis?.prompt?.("Edit ringLayout JSON:", currentText);
    if (input == null) return;
    try {
      const parsed = input.trim().length ? JSON.parse(input) : null;
      if (parsed != null && typeof parsed !== "object") {
        setError("Layout must be an object or empty.");
        return;
      }
      graph.layout = parsed && typeof parsed === "object" ? parsed : null;
      if (!graph.tree.ui || typeof graph.tree.ui !== "object") graph.tree.ui = {};
      if (graph.layout) {
        graph.tree.ui.ringLayout = deepClone(graph.layout);
      } else if (graph.tree.ui.ringLayout) {
        delete graph.tree.ui.ringLayout;
      }
      recalcAndRender({ save: true });
    } catch (_) {
      setError("Invalid layout JSON.");
    }
  });
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
    fitCameraToGraph();
    recalcAndRender({ save: true });
  });

  layoutButtons();

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
