// editor-graph.js
// Skill tree editor graph utilities: parse/serialize, layout application, validation, export.

import { skillTrees, skillNodes } from "../../defs/gamepieces/skill-tree-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { hubTagDefs } from "../../defs/gamesystems/hub-tag-defs.js";
import { itemTagDefs } from "../../defs/gamesystems/item-tag-defs.js";
import { skillFeatureUnlockDefs } from "../../defs/gamesettings/skill-feature-unlocks-defs.js";
import { validateSkillDefs } from "../../defs/validate-skill-defs.js";
import { computeSkillTreeLayout } from "./layout-engine.js";
import {
  isObject,
  sortStrings,
  toArray,
  toSafeInt,
  uniqueSortedStrings,
} from "./helpers.js";

const EDITOR_GRAPH_VERSION = 1;
const EDITOR_STORAGE_PREFIX = "skillTreeEditor";

function deepClone(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (_) {
    // ignore and fall through
  }
  return JSON.parse(JSON.stringify(value));
}

function toEditorNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeEffectSpecList(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((entry) => isObject(entry)).map((entry) => deepClone(entry));
  }
  if (isObject(raw)) return [deepClone(raw)];
  return [];
}

function edgeKey(a, b) {
  if (String(a) <= String(b)) return `${a}|${b}`;
  return `${b}|${a}`;
}

function parseEdgeKey(key) {
  const parts = String(key || "").split("|");
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!a || !b) return null;
  return { a, b };
}

function canonicalizeEdgeList(edgesRaw, nodeIds) {
  const nodeIdSet = new Set(nodeIds);
  const seen = new Set();
  const out = [];
  for (const edge of toArray(edgesRaw)) {
    const a = typeof edge?.a === "string" ? edge.a : null;
    const b = typeof edge?.b === "string" ? edge.b : null;
    if (!a || !b || a === b) continue;
    if (!nodeIdSet.has(a) || !nodeIdSet.has(b)) continue;
    const key = edgeKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parseEdgeKey(key));
  }
  out.sort((left, right) => {
    if (left.a !== right.a) return left.a.localeCompare(right.a);
    return left.b.localeCompare(right.b);
  });
  return out;
}

function buildEdgesFromNodes(treeNodeIds, nodesRegistry) {
  const seen = new Set();
  const out = [];
  for (const nodeId of treeNodeIds) {
    const nodeDef = nodesRegistry[nodeId];
    const adjacent = uniqueSortedStrings(nodeDef?.adjacent);
    for (const adjId of adjacent) {
      if (!treeNodeIds.includes(adjId)) continue;
      if (adjId === nodeId) continue;
      const key = edgeKey(nodeId, adjId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parseEdgeKey(key));
    }
  }
  out.sort((left, right) => {
    if (left.a !== right.a) return left.a.localeCompare(right.a);
    return left.b.localeCompare(right.b);
  });
  return out;
}

function buildAdjacencyFromEdges(nodeIds, edges) {
  const byId = {};
  for (const nodeId of nodeIds) {
    byId[nodeId] = [];
  }
  for (const edge of edges) {
    if (!byId[edge.a] || !byId[edge.b]) continue;
    byId[edge.a].push(edge.b);
    byId[edge.b].push(edge.a);
  }
  for (const nodeId of nodeIds) {
    byId[nodeId] = sortStrings(byId[nodeId]);
  }
  return byId;
}

function pickTreeId(treesRegistry, preferredTreeId = null) {
  const treeIds = sortStrings(Object.keys(treesRegistry || {}));
  if (!treeIds.length) return null;
  if (preferredTreeId && treeIds.includes(preferredTreeId)) return preferredTreeId;
  return treeIds[0];
}

function normalizeNodeRecord(raw, treeId, fallbackPos = null) {
  const id = typeof raw?.id === "string" ? raw.id : null;
  if (!id) return null;
  const out = {
    id,
    treeId,
    name: typeof raw.name === "string" ? raw.name : id,
    desc: typeof raw.desc === "string" ? raw.desc : "",
    cost: Number.isFinite(raw.cost) ? Math.max(0, Math.floor(raw.cost)) : 1,
    tags: uniqueSortedStrings(raw.tags),
    ringId: typeof raw.ringId === "string" && raw.ringId.length ? raw.ringId : null,
    requirements: isObject(raw.requirements) ? deepClone(raw.requirements) : null,
    onUnlock: normalizeEffectSpecList(raw.onUnlock),
    uiNodeRadius: Number.isFinite(raw.uiNodeRadius) ? raw.uiNodeRadius : null,
    editorPos: {
      x: toEditorNumber(raw.editorPos?.x, toEditorNumber(raw.uiPos?.x, fallbackPos?.x ?? 0)),
      y: toEditorNumber(raw.editorPos?.y, toEditorNumber(raw.uiPos?.y, fallbackPos?.y ?? 0)),
    },
    editorPinned: raw.editorPinned === true,
    editorNotes: typeof raw.editorNotes === "string" ? raw.editorNotes : "",
  };
  return out;
}

function getLegacyRingIdFromTags(node) {
  const tags = uniqueSortedStrings(node?.tags);
  if (tags.includes("Core")) return "core";
  if (tags.includes("Early")) return "early";
  if (tags.includes("Mid")) return "mid";
  if (tags.includes("Late")) return "late";
  return null;
}

function getNodeRingIdForLayout(node) {
  if (typeof node?.ringId === "string" && node.ringId.length > 0) {
    return node.ringId;
  }
  return getLegacyRingIdFromTags(node);
}

function hasRingLayoutWedgeTags(node) {
  const tags = new Set(uniqueSortedStrings(node?.tags));
  if (tags.has("Core")) return true;
  const colors = ["Blue", "Green", "Red", "Black"];
  return colors.some((color) => tags.has(color));
}

function shouldPreserveUiPosForMissingRingLayoutInfo(node) {
  const ringId = getNodeRingIdForLayout(node);
  if (typeof ringId !== "string" || !ringId.length) return true;
  if (ringId === "core") return false;
  return !hasRingLayoutWedgeTags(node);
}

function buildNodeRegistryForLayout(graph, { pinnedOnly = false } = {}) {
  const nodesOut = {};
  const nodeIds = sortStrings(Object.keys(graph?.nodesById || {}));
  const adjacencyByNodeId = buildAdjacencyFromEdges(nodeIds, graph.edges || []);
  for (const nodeId of nodeIds) {
    const node = graph.nodesById[nodeId];
    if (!node) continue;
    const out = {
      id: node.id,
      treeId: graph.treeId,
      name: node.name,
      desc: node.desc,
      cost: Number.isFinite(node.cost) ? Math.max(0, Math.floor(node.cost)) : 1,
      tags: uniqueSortedStrings(node.tags),
      adjacent: adjacencyByNodeId[nodeId] || [],
      onUnlock: normalizeEffectSpecList(node.onUnlock),
    };
    if (node.ringId) out.ringId = node.ringId;
    if (node.requirements) out.requirements = deepClone(node.requirements);
    if (Number.isFinite(node.uiNodeRadius)) out.uiNodeRadius = node.uiNodeRadius;
    const preservePosition =
      node.editorPinned === true ||
      !pinnedOnly ||
      shouldPreserveUiPosForMissingRingLayoutInfo(node);
    if (preservePosition) {
      out.uiPos = {
        x: toEditorNumber(node.editorPos?.x, 0),
        y: toEditorNumber(node.editorPos?.y, 0),
      };
    }
    nodesOut[nodeId] = out;
  }
  return nodesOut;
}

function sanitizeTreeMeta(treeId, treeRaw, layoutRaw = null) {
  const source = isObject(treeRaw) ? deepClone(treeRaw) : {};
  source.id = treeId;
  if (typeof source.name !== "string" || !source.name.length) source.name = treeId;
  if (typeof source.startNodeId !== "string") source.startNodeId = "";
  if (!isObject(source.ui)) source.ui = {};
  if (layoutRaw && isObject(layoutRaw)) {
    source.ui.ringLayout = deepClone(layoutRaw);
  } else if (isObject(source.ui.ringLayout)) {
    source.ui.ringLayout = deepClone(source.ui.ringLayout);
  } else {
    delete source.ui.ringLayout;
  }
  return source;
}

function canonicalizeGraphShape(graph) {
  if (!isObject(graph)) return null;
  const treeId = typeof graph.treeId === "string" ? graph.treeId : null;
  if (!treeId) return null;

  const nodesById = {};
  const rawNodesById = isObject(graph.nodesById) ? graph.nodesById : null;
  const rawNodesList = Array.isArray(graph.nodes) ? graph.nodes : null;
  const candidateIds = rawNodesById
    ? sortStrings(Object.keys(rawNodesById))
    : rawNodesList
      ? sortStrings(
          rawNodesList
            .map((node) => (typeof node?.id === "string" ? node.id : null))
            .filter((id) => !!id)
        )
      : [];

  for (const nodeId of candidateIds) {
    const rawNode = rawNodesById
      ? rawNodesById[nodeId]
      : rawNodesList.find((node) => node?.id === nodeId);
    const normalized = normalizeNodeRecord(rawNode, treeId, null);
    if (!normalized) continue;
    nodesById[nodeId] = normalized;
  }
  const cleanNodeIds = sortStrings(Object.keys(nodesById));
  if (!cleanNodeIds.length) return null;

  const edges = canonicalizeEdgeList(graph.edges, cleanNodeIds);
  const layout = isObject(graph.layout) ? deepClone(graph.layout) : null;
  const tree = sanitizeTreeMeta(treeId, graph.tree, layout);
  if (!cleanNodeIds.includes(tree.startNodeId)) {
    tree.startNodeId = cleanNodeIds[0];
  }

  return {
    version: EDITOR_GRAPH_VERSION,
    treeId,
    tree,
    layout,
    nodesById,
    edges,
    meta: isObject(graph.meta) ? deepClone(graph.meta) : {},
  };
}

export function getSkillTreeEditorStorageKey(treeId) {
  const id = typeof treeId === "string" ? treeId : "default";
  return `${EDITOR_STORAGE_PREFIX}:${id}`;
}

export function buildEditorGraphFromDefs({ defsInput = null, treeId = null } = {}) {
  const treesRegistry = defsInput?.skillTrees ?? skillTrees;
  const nodesRegistry = defsInput?.skillNodes ?? skillNodes;
  const resolvedTreeId = pickTreeId(treesRegistry, treeId);
  if (!resolvedTreeId) return null;
  const treeDef = treesRegistry[resolvedTreeId];
  if (!treeDef) return null;

  const treeNodeIds = sortStrings(
    Object.keys(nodesRegistry || {}).filter((id) => nodesRegistry[id]?.treeId === resolvedTreeId)
  );
  if (!treeNodeIds.length) return null;

  const layout = computeSkillTreeLayout(
    treeDef,
    nodesRegistry,
    {
      x: 80,
      y: 80,
      width: 1240,
      height: 900,
      columnSpacing: 180,
      rowSpacing: 92,
      leftPad: 80,
    }
  );
  const positionsByNodeId = isObject(layout?.positionsByNodeId)
    ? layout.positionsByNodeId
    : {};

  const nodesById = {};
  for (const nodeId of treeNodeIds) {
    const nodeDef = nodesRegistry[nodeId];
    const fallbackPos = positionsByNodeId[nodeId] || { x: 0, y: 0 };
    const normalized = normalizeNodeRecord(nodeDef, resolvedTreeId, fallbackPos);
    if (!normalized) continue;
    nodesById[nodeId] = normalized;
  }

  const edges = buildEdgesFromNodes(treeNodeIds, nodesRegistry);
  const graph = {
    version: EDITOR_GRAPH_VERSION,
    treeId: resolvedTreeId,
    tree: sanitizeTreeMeta(
      resolvedTreeId,
      treeDef,
      isObject(treeDef?.ui?.ringLayout) ? treeDef.ui.ringLayout : null
    ),
    layout: isObject(treeDef?.ui?.ringLayout) ? deepClone(treeDef.ui.ringLayout) : null,
    nodesById,
    edges,
    meta: {
      createdAtIso: new Date().toISOString(),
      source: "defs",
    },
  };
  return canonicalizeGraphShape(graph);
}

export function cloneEditorGraph(graph) {
  return canonicalizeGraphShape(deepClone(graph));
}

export function parseEditorGraphJson(input) {
  if (typeof input !== "string" || !input.trim().length) {
    return { ok: false, reason: "emptyInput" };
  }
  try {
    const parsed = JSON.parse(input);
    const graph = canonicalizeGraphShape(parsed);
    if (!graph) return { ok: false, reason: "invalidGraph" };
    return { ok: true, graph };
  } catch (_) {
    return { ok: false, reason: "invalidJson" };
  }
}

export function serializeEditorGraph(graph) {
  const canonical = canonicalizeGraphShape(graph);
  if (!canonical) return null;
  const nodeIds = sortStrings(Object.keys(canonical.nodesById));
  const orderedNodes = nodeIds.map((nodeId) => canonical.nodesById[nodeId]);
  const output = {
    version: EDITOR_GRAPH_VERSION,
    treeId: canonical.treeId,
    tree: canonical.tree,
    layout: canonical.layout,
    nodes: orderedNodes,
    edges: canonical.edges,
    meta: {
      ...canonical.meta,
      savedAtIso: new Date().toISOString(),
    },
  };
  return JSON.stringify(output, null, 2);
}

export function applyAutoLayoutToEditorGraph(graph, opts = {}) {
  const canonical = canonicalizeGraphShape(graph);
  if (!canonical) return { ok: false, reason: "invalidGraph" };

  const treeForLayout = deepClone(canonical.tree);
  if (!isObject(treeForLayout.ui)) treeForLayout.ui = {};
  if (isObject(canonical.layout)) {
    treeForLayout.ui.ringLayout = deepClone(canonical.layout);
  }

  const nodesRegistry = buildNodeRegistryForLayout(canonical, { pinnedOnly: true });
  const layout = computeSkillTreeLayout(treeForLayout, nodesRegistry, {
    x: 80,
    y: 80,
    width: Number.isFinite(opts.width) ? opts.width : 1240,
    height: Number.isFinite(opts.height) ? opts.height : 900,
    columnSpacing: 180,
    rowSpacing: 92,
    leftPad: 80,
  });

  const positionsByNodeId = isObject(layout?.positionsByNodeId)
    ? layout.positionsByNodeId
    : {};

  for (const nodeId of Object.keys(canonical.nodesById)) {
    const node = canonical.nodesById[nodeId];
    if (!node || node.editorPinned) continue;
    const pos = positionsByNodeId[nodeId];
    if (!pos) continue;
    node.editorPos = {
      x: toSafeInt(pos.x, 0),
      y: toSafeInt(pos.y, 0),
    };
  }

  return { ok: true, graph: canonical };
}

function toRuntimeExports(graph) {
  const canonical = canonicalizeGraphShape(graph);
  if (!canonical) return null;
  const nodeIds = sortStrings(Object.keys(canonical.nodesById));
  const adjacencyByNodeId = buildAdjacencyFromEdges(nodeIds, canonical.edges);

  const runtimeTree = deepClone(canonical.tree);
  runtimeTree.id = canonical.treeId;
  runtimeTree.startNodeId = runtimeTree.startNodeId || nodeIds[0];
  if (!isObject(runtimeTree.ui)) runtimeTree.ui = {};

  const runtimeNodes = {};
  for (const nodeId of nodeIds) {
    const node = canonical.nodesById[nodeId];
    const out = {
      id: node.id,
      treeId: canonical.treeId,
      name: node.name || node.id,
      desc: typeof node.desc === "string" ? node.desc : "",
      cost: Number.isFinite(node.cost) ? Math.max(0, Math.floor(node.cost)) : 1,
      tags: uniqueSortedStrings(node.tags),
      adjacent: adjacencyByNodeId[nodeId] || [],
      onUnlock: normalizeEffectSpecList(node.onUnlock),
      uiPos: {
        x: toSafeInt(node.editorPos?.x, 0),
        y: toSafeInt(node.editorPos?.y, 0),
      },
    };
    if (node.ringId) out.ringId = node.ringId;
    if (isObject(node.requirements)) out.requirements = deepClone(node.requirements);
    if (Number.isFinite(node.uiNodeRadius)) out.uiNodeRadius = node.uiNodeRadius;
    runtimeNodes[nodeId] = out;
  }

  return {
    skillTrees: {
      [canonical.treeId]: runtimeTree,
    },
    skillNodes: runtimeNodes,
  };
}

export function exportRuntimeSkillDefsFromEditorGraph(graph) {
  const runtime = toRuntimeExports(graph);
  if (!runtime) return { ok: false, reason: "invalidGraph" };

  const validation = validateSkillDefs({
    skillTrees: runtime.skillTrees,
    skillNodes: runtime.skillNodes,
    recipeDefs,
    hubStructureDefs,
    envTagDefs,
    hubTagDefs,
    skillFeatureUnlockDefs,
    itemTagDefs,
  });

  return {
    ok: validation.ok === true,
    runtimeDefs: runtime,
    validation,
  };
}

export function exportLayoutPatchFromEditorGraph(graph) {
  const canonical = canonicalizeGraphShape(graph);
  if (!canonical) return { ok: false, reason: "invalidGraph" };
  const nodeIds = sortStrings(Object.keys(canonical.nodesById));
  const nodes = {};
  for (const nodeId of nodeIds) {
    const node = canonical.nodesById[nodeId];
    nodes[nodeId] = {
      uiPos: {
        x: toSafeInt(node.editorPos?.x, 0),
        y: toSafeInt(node.editorPos?.y, 0),
      },
    };
    if (Number.isFinite(node.uiNodeRadius)) {
      nodes[nodeId].uiNodeRadius = node.uiNodeRadius;
    }
  }
  return {
    ok: true,
    patch: {
      treeId: canonical.treeId,
      nodes,
    },
  };
}

export function validateEditorGraph(graph) {
  const canonical = canonicalizeGraphShape(graph);
  if (!canonical) {
    return {
      ok: false,
      errors: ["Editor graph is invalid or empty."],
      warnings: [],
    };
  }

  const errors = [];
  const warnings = [];
  const nodeIds = sortStrings(Object.keys(canonical.nodesById));
  const nodeIdSet = new Set(nodeIds);

  if (!nodeIds.length) errors.push("No nodes present.");
  if (!nodeIdSet.has(canonical.tree.startNodeId)) {
    errors.push(`Start node "${canonical.tree.startNodeId}" not found.`);
  }

  for (const edge of canonical.edges) {
    if (!nodeIdSet.has(edge.a) || !nodeIdSet.has(edge.b)) {
      errors.push(`Invalid edge "${edge.a}" <-> "${edge.b}" references missing node.`);
    }
  }

  const adjacency = buildAdjacencyFromEdges(nodeIds, canonical.edges);
  const isolated = nodeIds.filter((id) => (adjacency[id] || []).length === 0);
  if (isolated.length > 0) {
    warnings.push(`Isolated nodes: ${isolated.join(", ")}`);
  }

  const exportCheck = exportRuntimeSkillDefsFromEditorGraph(canonical);
  if (!exportCheck.ok) {
    for (const msg of exportCheck.validation?.errors || []) errors.push(msg);
  }
  for (const msg of exportCheck.validation?.warnings || []) warnings.push(msg);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
