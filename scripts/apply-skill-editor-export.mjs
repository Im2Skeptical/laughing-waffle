#!/usr/bin/env node
// apply-skill-editor-export.mjs
// Applies exported skill editor payloads into src/defs/gamepieces/skill-tree-defs.js.
//
// Stage modes:
// - basic (default): update existing nodes only; preserve existing unlock hooks.
// - robust: optional create/rename/delete controls; preserve existing unlock hooks on existing nodes.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_DEFS_PATH = path.resolve(
  ROOT_DIR,
  "src/defs/gamepieces/skill-tree-defs.js"
);

function parseArgs(argv) {
  const args = {
    input: null,
    defs: DEFAULT_DEFS_PATH,
    stage: "basic",
    write: false,
    backup: true,
    allowCreate: false,
    deleteMissing: false,
    treeId: null,
    renameMap: null,
    keepComments: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" && argv[i + 1]) {
      args.input = path.resolve(process.cwd(), argv[++i]);
      continue;
    }
    if (a === "--defs" && argv[i + 1]) {
      args.defs = path.resolve(process.cwd(), argv[++i]);
      continue;
    }
    if (a === "--stage" && argv[i + 1]) {
      args.stage = String(argv[++i] || "").toLowerCase();
      continue;
    }
    if (a === "--tree-id" && argv[i + 1]) {
      args.treeId = String(argv[++i] || "");
      continue;
    }
    if (a === "--rename-map" && argv[i + 1]) {
      args.renameMap = path.resolve(process.cwd(), argv[++i]);
      continue;
    }
    if (a === "--write") {
      args.write = true;
      continue;
    }
    if (a === "--no-backup") {
      args.backup = false;
      continue;
    }
    if (a === "--allow-create") {
      args.allowCreate = true;
      continue;
    }
    if (a === "--delete-missing") {
      args.deleteMissing = true;
      continue;
    }
    if (a === "--keep-comments") {
      args.keepComments = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    }
    throw new Error(`Unknown argument: ${a}`);
  }

  if (!args.input) {
    throw new Error("Missing required --input <file.json>");
  }
  if (args.stage !== "basic" && args.stage !== "robust") {
    throw new Error(`Invalid --stage "${args.stage}". Expected basic|robust.`);
  }
  return args;
}

function printHelpAndExit(code = 0) {
  const lines = [
    "Usage:",
    "  node scripts/apply-skill-editor-export.mjs --input <file.json> [options]",
    "",
    "Options:",
    "  --defs <path>           Target defs file (default src/defs/gamepieces/skill-tree-defs.js)",
    "  --stage <basic|robust>  Apply mode (default basic)",
    "  --tree-id <id>          Override target tree id",
    "  --rename-map <file>     JSON map of oldId->newId (robust mode)",
    "  --allow-create          Allow creating missing nodes (robust mode)",
    "  --delete-missing        Delete target-tree nodes missing from incoming payload (robust mode)",
    "  --write                 Persist changes to defs file",
    "  --no-backup             Disable .bak timestamp backup when writing",
    "  --help                  Show help",
    "",
    "Input payloads supported:",
    "  - Layout export: { treeId, nodes: { nodeId: { uiPos, uiNodeRadius? } } }",
    "  - Runtime export wrapper: { runtimeDefs: { skillTrees, skillNodes } }",
    "  - Runtime defs: { skillTrees, skillNodes }",
    "  - Editor export: { treeId, tree, nodes: [...], edges: [...] }",
    "",
    "Notes:",
    "  - Existing node onUnlock/onLock hooks are preserved by default.",
    "  - By default this script runs dry-run (no file writes). Use --write to persist.",
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
  process.exit(code);
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function sortStrings(values) {
  return values.slice().sort((a, b) => String(a).localeCompare(String(b)));
}

function uniqueSortedStrings(values) {
  const out = [];
  const seen = new Set();
  for (const raw of toArray(values)) {
    if (typeof raw !== "string" || !raw.length) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function edgeKey(a, b) {
  if (String(a) <= String(b)) return `${a}|${b}`;
  return `${b}|${a}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneEffectSpec(value) {
  if (Array.isArray(value) || isObject(value)) return deepClone(value);
  return null;
}

function cleanNodeInput(raw) {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;
  const out = { id };
  if (typeof raw.treeId === "string" && raw.treeId.length) out.treeId = raw.treeId;
  if (typeof raw.name === "string") out.name = raw.name;
  if (typeof raw.desc === "string") out.desc = raw.desc;
  if (Number.isFinite(raw.cost)) out.cost = Math.max(0, Math.floor(raw.cost));
  if (raw.tags != null) out.tags = uniqueSortedStrings(raw.tags);
  if (typeof raw.ringId === "string" && raw.ringId.length) out.ringId = raw.ringId;
  if (raw.ringId === null || raw.ringId === "") out.ringId = null;
  if (raw.uiPos && Number.isFinite(raw.uiPos.x) && Number.isFinite(raw.uiPos.y)) {
    out.uiPos = {
      x: Math.round(raw.uiPos.x),
      y: Math.round(raw.uiPos.y),
    };
  }
  if (Number.isFinite(raw.uiNodeRadius)) out.uiNodeRadius = raw.uiNodeRadius;
  if (typeof raw.editorNotes === "string") out.editorNotes = raw.editorNotes;
  if (typeof raw.notes === "string" && out.editorNotes == null) out.editorNotes = raw.notes;
  if (isObject(raw.requirements)) out.requirements = deepClone(raw.requirements);
  if (toArray(raw.adjacent).length > 0) out.adjacent = uniqueSortedStrings(raw.adjacent);
  if (typeof raw.previousId === "string" && raw.previousId.length) out.previousId = raw.previousId;
  const onUnlock = cloneEffectSpec(raw.onUnlock);
  if (onUnlock != null) out.onUnlock = onUnlock;
  const onLock = cloneEffectSpec(raw.onLock);
  if (onLock != null) out.onLock = onLock;
  const legacyEffects = cloneEffectSpec(raw.effects);
  if (legacyEffects != null && out.onUnlock == null) out.onUnlock = legacyEffects;
  return out;
}

function normalizeIncomingPayload(payloadRaw, explicitTreeId = null) {
  let payload = payloadRaw;
  if (isObject(payload?.runtimeDefs)) payload = payload.runtimeDefs;

  if (isObject(payload) && isObject(payload.skillTrees) && isObject(payload.skillNodes)) {
    const treeIds = sortStrings(Object.keys(payload.skillTrees));
    const treeId =
      explicitTreeId && treeIds.includes(explicitTreeId)
        ? explicitTreeId
        : treeIds[0] || explicitTreeId;
    const tree = treeId ? deepClone(payload.skillTrees[treeId]) : null;
    const nodesById = {};
    for (const [nodeId, rawNode] of Object.entries(payload.skillNodes)) {
      if (!isObject(rawNode)) continue;
      if (treeId && rawNode.treeId !== treeId) continue;
      const cleaned = cleanNodeInput({ ...rawNode, id: rawNode.id || nodeId });
      if (!cleaned) continue;
      nodesById[cleaned.id] = cleaned;
    }
    return { kind: "runtime", treeId, tree, nodesById };
  }

  if (isObject(payload) && typeof payload.treeId === "string" && isObject(payload.nodes)) {
    const treeId = explicitTreeId || payload.treeId;
    const nodesById = {};
    for (const [nodeId, patch] of Object.entries(payload.nodes)) {
      if (!isObject(patch)) continue;
      const cleaned = cleanNodeInput({ id: nodeId, ...patch, treeId });
      if (!cleaned) continue;
      nodesById[nodeId] = cleaned;
    }
    return { kind: "layout", treeId, tree: null, nodesById };
  }

  if (isObject(payload) && typeof payload.treeId === "string" && Array.isArray(payload.nodes)) {
    const treeId = explicitTreeId || payload.treeId;
    const nodesById = {};
    for (const rawNode of payload.nodes) {
      const cleaned = cleanNodeInput({ ...rawNode, treeId });
      if (!cleaned) continue;
      nodesById[cleaned.id] = cleaned;
    }
    const allIds = new Set(Object.keys(nodesById));
    const edgeSet = new Set();
    for (const edge of toArray(payload.edges)) {
      const a = typeof edge?.a === "string" ? edge.a : null;
      const b = typeof edge?.b === "string" ? edge.b : null;
      if (!a || !b || a === b) continue;
      if (!allIds.has(a) || !allIds.has(b)) continue;
      edgeSet.add(edgeKey(a, b));
    }
    for (const key of edgeSet.values()) {
      const [a, b] = key.split("|");
      nodesById[a].adjacent = uniqueSortedStrings([...(nodesById[a].adjacent || []), b]);
      nodesById[b].adjacent = uniqueSortedStrings([...(nodesById[b].adjacent || []), a]);
    }
    const tree = isObject(payload.tree) ? deepClone(payload.tree) : { id: treeId };
    tree.id = treeId;
    return { kind: "editor", treeId, tree, nodesById };
  }

  throw new Error("Unsupported input payload format.");
}

function normalizeNodeForOutput(node) {
  const normalized = deepClone(node);
  if (
    !Object.prototype.hasOwnProperty.call(normalized, "onUnlock") &&
    Object.prototype.hasOwnProperty.call(normalized, "effects")
  ) {
    const migrated = cloneEffectSpec(normalized.effects);
    if (migrated != null) normalized.onUnlock = migrated;
  }
  delete normalized.effects;

  const preferredOrder = [
    "id",
    "ringId",
    "treeId",
    "name",
    "desc",
    "cost",
    "tags",
    "adjacent",
    "uiPos",
    "uiNodeRadius",
    "editorNotes",
    "requirements",
    "onUnlock",
    "onLock",
  ];
  const out = {};
  for (const key of preferredOrder) {
    if (Object.prototype.hasOwnProperty.call(normalized, key) && normalized[key] != null) {
      out[key] = normalized[key];
    }
  }
  const remaining = Object.keys(normalized).filter(
    (key) => !Object.prototype.hasOwnProperty.call(out, key)
  );
  remaining.sort((a, b) => a.localeCompare(b));
  for (const key of remaining) {
    if (normalized[key] == null) continue;
    out[key] = normalized[key];
  }
  return out;
}

function normalizeAdjacencySymmetry(nodesById, treeId) {
  const nodeIds = sortStrings(
    Object.keys(nodesById).filter((id) => nodesById[id]?.treeId === treeId)
  );
  const nodeIdSet = new Set(nodeIds);
  const edgeSet = new Set();

  for (const nodeId of nodeIds) {
    const node = nodesById[nodeId];
    const adjacent = uniqueSortedStrings(node.adjacent);
    for (const adjId of adjacent) {
      if (!nodeIdSet.has(adjId) || adjId === nodeId) continue;
      edgeSet.add(edgeKey(nodeId, adjId));
    }
  }

  const nextAdj = {};
  for (const nodeId of nodeIds) nextAdj[nodeId] = [];
  for (const key of edgeSet.values()) {
    const [a, b] = key.split("|");
    nextAdj[a].push(b);
    nextAdj[b].push(a);
  }
  for (const nodeId of nodeIds) {
    nodesById[nodeId].adjacent = sortStrings(nextAdj[nodeId]);
  }
}

function applyLayoutPatch({ currentTrees, currentNodes, incoming, treeId, summary }) {
  for (const [nodeId, patch] of Object.entries(incoming.nodesById)) {
    const existing = currentNodes[nodeId];
    if (!existing || existing.treeId !== treeId) {
      summary.skippedUnknown.push(nodeId);
      continue;
    }
    if (patch.uiPos) {
      existing.uiPos = { x: patch.uiPos.x, y: patch.uiPos.y };
      summary.updatedUiPos += 1;
    }
    if (Number.isFinite(patch.uiNodeRadius)) {
      existing.uiNodeRadius = patch.uiNodeRadius;
      summary.updatedNodeRadius += 1;
    }
  }
  void currentTrees;
}

function applyBasicPatch({ currentTrees, currentNodes, incoming, treeId, summary }) {
  if (incoming.tree && incoming.treeId === treeId) {
    const tree = currentTrees[treeId];
    if (tree) {
      if (typeof incoming.tree.name === "string") tree.name = incoming.tree.name;
      if (typeof incoming.tree.startNodeId === "string" && incoming.tree.startNodeId.length) {
        tree.startNodeId = incoming.tree.startNodeId;
      }
      if (isObject(incoming.tree.ui)) {
        tree.ui = { ...(isObject(tree.ui) ? tree.ui : {}), ...deepClone(incoming.tree.ui) };
      }
      summary.updatedTree = true;
    }
  }

  for (const [nodeId, patch] of Object.entries(incoming.nodesById)) {
    const existing = currentNodes[nodeId];
    if (!existing || existing.treeId !== treeId) {
      summary.skippedUnknown.push(nodeId);
      continue;
    }
    if (typeof patch.name === "string") existing.name = patch.name;
    if (typeof patch.desc === "string") existing.desc = patch.desc;
    if (Number.isFinite(patch.cost)) existing.cost = Math.max(0, Math.floor(patch.cost));
    if (patch.tags) existing.tags = uniqueSortedStrings(patch.tags);
    if (Object.prototype.hasOwnProperty.call(patch, "ringId")) existing.ringId = patch.ringId || undefined;
    if (patch.uiPos) existing.uiPos = { x: patch.uiPos.x, y: patch.uiPos.y };
    if (Number.isFinite(patch.uiNodeRadius)) existing.uiNodeRadius = patch.uiNodeRadius;
    if (typeof patch.editorNotes === "string") existing.editorNotes = patch.editorNotes;
    if (patch.adjacent) existing.adjacent = uniqueSortedStrings(patch.adjacent);
    summary.updatedNodes += 1;
  }

  normalizeAdjacencySymmetry(currentNodes, treeId);
}

function loadRenameMap(renameMapPath) {
  if (!renameMapPath) return {};
  return fs
    .readFile(renameMapPath, "utf8")
    .then((raw) => JSON.parse(raw))
    .then((obj) => {
      if (!isObject(obj)) throw new Error("rename-map must be a JSON object");
      const out = {};
      for (const [oldId, nextId] of Object.entries(obj)) {
        if (typeof oldId !== "string" || !oldId.length) continue;
        if (typeof nextId !== "string" || !nextId.length) continue;
        if (oldId === nextId) continue;
        out[oldId] = nextId;
      }
      return out;
    });
}

function applyRobustPatch({
  currentTrees,
  currentNodes,
  incoming,
  treeId,
  summary,
  allowCreate,
  deleteMissing,
  renameMap,
}) {
  if (incoming.tree && incoming.treeId === treeId) {
    const tree = currentTrees[treeId];
    if (tree) {
      if (typeof incoming.tree.name === "string") tree.name = incoming.tree.name;
      if (typeof incoming.tree.startNodeId === "string" && incoming.tree.startNodeId.length) {
        tree.startNodeId = incoming.tree.startNodeId;
      }
      if (isObject(incoming.tree.ui)) {
        tree.ui = { ...(isObject(tree.ui) ? tree.ui : {}), ...deepClone(incoming.tree.ui) };
      }
      summary.updatedTree = true;
    }
  }

  const treeNodeIds = sortStrings(
    Object.keys(currentNodes).filter((id) => currentNodes[id]?.treeId === treeId)
  );
  const incomingNodeIds = sortStrings(Object.keys(incoming.nodesById));
  const incomingIdSet = new Set(incomingNodeIds);

  // Rename pass (explicit map + previousId hints).
  const effectiveRename = { ...renameMap };
  for (const nextId of incomingNodeIds) {
    const patch = incoming.nodesById[nextId];
    if (!patch?.previousId || patch.previousId === nextId) continue;
    if (!effectiveRename[patch.previousId]) effectiveRename[patch.previousId] = nextId;
  }

  for (const [oldId, nextId] of Object.entries(effectiveRename)) {
    const existing = currentNodes[oldId];
    if (!existing || existing.treeId !== treeId) continue;
    if (currentNodes[nextId]) {
      summary.renameConflicts.push(`${oldId}->${nextId}`);
      continue;
    }
    delete currentNodes[oldId];
    existing.id = nextId;
    currentNodes[nextId] = existing;
    for (const node of Object.values(currentNodes)) {
      if (!Array.isArray(node?.adjacent)) continue;
      node.adjacent = node.adjacent.map((id) => (id === oldId ? nextId : id));
    }
    if (currentTrees[treeId]?.startNodeId === oldId) {
      currentTrees[treeId].startNodeId = nextId;
    }
    summary.renamed += 1;
  }

  for (const nodeId of incomingNodeIds) {
    const patch = incoming.nodesById[nodeId];
    const existing = currentNodes[nodeId];
    if (!existing || existing.treeId !== treeId) {
      if (!allowCreate) {
        summary.skippedUnknown.push(nodeId);
        continue;
      }
      const created = {
        id: nodeId,
        treeId,
        name: typeof patch.name === "string" ? patch.name : nodeId,
        desc: typeof patch.desc === "string" ? patch.desc : "",
        cost: Number.isFinite(patch.cost) ? Math.max(0, Math.floor(patch.cost)) : 1,
        tags: patch.tags ? uniqueSortedStrings(patch.tags) : [],
        adjacent: patch.adjacent ? uniqueSortedStrings(patch.adjacent) : [],
        onUnlock: [],
      };
      if (patch.ringId) created.ringId = patch.ringId;
      if (patch.uiPos) created.uiPos = { x: patch.uiPos.x, y: patch.uiPos.y };
      if (Number.isFinite(patch.uiNodeRadius)) created.uiNodeRadius = patch.uiNodeRadius;
      if (typeof patch.editorNotes === "string") created.editorNotes = patch.editorNotes;
      currentNodes[nodeId] = created;
      summary.created += 1;
      continue;
    }

    if (typeof patch.name === "string") existing.name = patch.name;
    if (typeof patch.desc === "string") existing.desc = patch.desc;
    if (Number.isFinite(patch.cost)) existing.cost = Math.max(0, Math.floor(patch.cost));
    if (patch.tags) existing.tags = uniqueSortedStrings(patch.tags);
    if (Object.prototype.hasOwnProperty.call(patch, "ringId")) {
      if (patch.ringId) existing.ringId = patch.ringId;
      else delete existing.ringId;
    }
    if (patch.uiPos) existing.uiPos = { x: patch.uiPos.x, y: patch.uiPos.y };
    if (Number.isFinite(patch.uiNodeRadius)) existing.uiNodeRadius = patch.uiNodeRadius;
    if (typeof patch.editorNotes === "string") existing.editorNotes = patch.editorNotes;
    if (patch.adjacent) existing.adjacent = uniqueSortedStrings(patch.adjacent);
    summary.updatedNodes += 1;
  }

  if (deleteMissing) {
    for (const nodeId of treeNodeIds) {
      if (incomingIdSet.has(nodeId)) continue;
      delete currentNodes[nodeId];
      for (const node of Object.values(currentNodes)) {
        if (!Array.isArray(node?.adjacent)) continue;
        node.adjacent = node.adjacent.filter((id) => id !== nodeId);
      }
      summary.deleted += 1;
    }
  }

  normalizeAdjacencySymmetry(currentNodes, treeId);
}

function toJsNumber(value) {
  if (Number.isInteger(value)) return String(value);
  if (!Number.isFinite(value)) return "0";
  return String(value);
}

function shouldQuoteKey(key) {
  return !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function serializeJsValue(value, indent = 0) {
  const pad = "  ".repeat(indent);
  const nextPad = "  ".repeat(indent + 1);
  if (value == null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return toJsNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const parts = value.map((item) => `${nextPad}${serializeJsValue(item, indent + 1)}`);
    return `[\n${parts.join(",\n")}\n${pad}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return "{}";
    const parts = keys.map((key) => {
      const keyOut = shouldQuoteKey(key) ? JSON.stringify(key) : key;
      return `${nextPad}${keyOut}: ${serializeJsValue(value[key], indent + 1)}`;
    });
    return `{\n${parts.join(",\n")}\n${pad}}`;
  }
  return "null";
}

function buildOutputContent({ skillProgressionDefs, skillTreesOut, skillNodesOut }) {
  const lines = [];
  lines.push("// skill-tree-defs.js");
  lines.push("// Auto-generated by scripts/apply-skill-editor-export.mjs.");
  lines.push("// Note: this generator rewrites the file and removes manual comments.");
  lines.push("");
  lines.push(`export const skillProgressionDefs = ${serializeJsValue(skillProgressionDefs, 0)};`);
  lines.push("");
  lines.push(`export const skillTrees = ${serializeJsValue(skillTreesOut, 0)};`);
  lines.push("");
  lines.push(`export const skillNodes = ${serializeJsValue(skillNodesOut, 0)};`);
  lines.push("");
  return lines.join("\n");
}

function sortNodeRegistryForWrite(nodesRegistry) {
  const out = {};
  const ids = sortStrings(Object.keys(nodesRegistry || {}));
  for (const nodeId of ids) {
    const node = nodesRegistry[nodeId];
    if (!isObject(node)) continue;
    const next = deepClone(node);
    if (Array.isArray(next.tags)) next.tags = uniqueSortedStrings(next.tags);
    if (Array.isArray(next.adjacent)) next.adjacent = uniqueSortedStrings(next.adjacent);
    out[nodeId] = normalizeNodeForOutput(next);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const rawInput = await fs.readFile(args.input, "utf8");
  const payload = JSON.parse(rawInput);
  const incoming = normalizeIncomingPayload(payload, args.treeId || null);
  if (!incoming.treeId || !incoming.treeId.length) {
    throw new Error("Unable to resolve target treeId from input. Use --tree-id.");
  }
  const treeId = incoming.treeId;

  const defsUrl = pathToFileURL(args.defs).href + `?ts=${Date.now()}`;
  const defsMod = await import(defsUrl);
  const currentTrees = deepClone(defsMod.skillTrees || {});
  const currentNodes = deepClone(defsMod.skillNodes || {});
  const skillProgressionDefs = deepClone(defsMod.skillProgressionDefs || {});

  if (!currentTrees[treeId]) {
    throw new Error(`Target tree "${treeId}" not found in defs.`);
  }

  const summary = {
    stage: args.stage,
    treeId,
    inputKind: incoming.kind,
    updatedTree: false,
    updatedNodes: 0,
    updatedUiPos: 0,
    updatedNodeRadius: 0,
    renamed: 0,
    created: 0,
    deleted: 0,
    skippedUnknown: [],
    renameConflicts: [],
  };

  if (incoming.kind === "layout") {
    applyLayoutPatch({ currentTrees, currentNodes, incoming, treeId, summary });
  } else if (args.stage === "basic") {
    applyBasicPatch({ currentTrees, currentNodes, incoming, treeId, summary });
  } else {
    const renameMap = await loadRenameMap(args.renameMap);
    applyRobustPatch({
      currentTrees,
      currentNodes,
      incoming,
      treeId,
      summary,
      allowCreate: args.allowCreate,
      deleteMissing: args.deleteMissing,
      renameMap,
    });
  }

  const skillTreesOut = {};
  for (const id of sortStrings(Object.keys(currentTrees))) {
    skillTreesOut[id] = currentTrees[id];
  }
  const skillNodesOut = sortNodeRegistryForWrite(currentNodes);

  const content = buildOutputContent({
    skillProgressionDefs,
    skillTreesOut,
    skillNodesOut,
  });

  // eslint-disable-next-line no-console
  console.log("[skill-patch] Summary:");
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ...summary,
        skippedUnknownCount: summary.skippedUnknown.length,
        renameConflictCount: summary.renameConflicts.length,
      },
      null,
      2
    )
  );
  if (summary.skippedUnknown.length) {
    // eslint-disable-next-line no-console
    console.log(`[skill-patch] Skipped unknown node ids: ${summary.skippedUnknown.join(", ")}`);
  }
  if (summary.renameConflicts.length) {
    // eslint-disable-next-line no-console
    console.log(`[skill-patch] Rename conflicts: ${summary.renameConflicts.join(", ")}`);
  }

  if (!args.write) {
    // eslint-disable-next-line no-console
    console.log("[skill-patch] Dry-run complete. No file written. Use --write to persist.");
    return;
  }

  if (args.backup) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${args.defs}.${stamp}.bak`;
    const existingRaw = await fs.readFile(args.defs, "utf8");
    await fs.writeFile(backupPath, existingRaw, "utf8");
    // eslint-disable-next-line no-console
    console.log(`[skill-patch] Backup written: ${backupPath}`);
  }

  await fs.writeFile(args.defs, content, "utf8");
  // eslint-disable-next-line no-console
  console.log(`[skill-patch] Wrote updated defs: ${args.defs}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[skill-patch] Failed:", err?.message || err);
  process.exit(1);
});
