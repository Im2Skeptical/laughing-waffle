// skills.js
// Deterministic skill tree selectors, validation wrappers, and modifier aggregation.

import {
  skillTrees,
  skillNodes,
  skillProgressionDefs,
} from "../defs/gamepieces/skill-tree-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { validateSkillDefs as validateSkillDefsRegistry } from "../defs/validate-skill-defs.js";

function isObject(value) {
  return value && typeof value === "object";
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function sortStrings(list) {
  return list.slice().sort((a, b) => String(a).localeCompare(String(b)));
}

function toSafeInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.floor(value);
}

function uniqueSortedStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of toArray(values)) {
    if (typeof value !== "string" || !value.length) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function getCharacterById(state, characterId) {
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  const idNum = Number.isFinite(characterId) ? Math.floor(characterId) : null;
  for (const ch of chars) {
    if (!ch) continue;
    if (idNum != null && Number.isFinite(ch.id) && Math.floor(ch.id) === idNum) {
      return ch;
    }
    if (String(ch.id) === String(characterId)) return ch;
  }
  return null;
}

function getTreeNodes(treeId, defsInput) {
  const nodes = getSkillNodes(defsInput);
  const out = [];
  for (const node of Object.values(nodes || {})) {
    if (!isObject(node)) continue;
    if (node.treeId !== treeId) continue;
    out.push(node);
  }
  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

function getAdjacentNodeIds(nodeDef) {
  return uniqueSortedStrings(nodeDef?.adjacent);
}

function getNodeCost(nodeDef) {
  if (!Number.isFinite(nodeDef?.cost)) return 1;
  return Math.max(0, Math.floor(nodeDef.cost));
}

function requirementsPass(nodeDef, unlockedSet) {
  const requirements = isObject(nodeDef?.requirements) ? nodeDef.requirements : null;
  if (!requirements) return true;
  const requiredNodeIds = uniqueSortedStrings(requirements.requiredNodeIds);
  for (const reqId of requiredNodeIds) {
    if (!unlockedSet.has(reqId)) return false;
  }
  return true;
}

function hasAnyAdjacentUnlocked(nodeDef, unlockedSet) {
  const adjacent = getAdjacentNodeIds(nodeDef);
  for (const nodeId of adjacent) {
    if (unlockedSet.has(nodeId)) return true;
  }
  return false;
}

function getProgressionDefs(defsInput) {
  return defsInput?.skillProgressionDefs ?? skillProgressionDefs;
}

function getDefaultUnlockedRecipes(defsInput) {
  const progression = getProgressionDefs(defsInput);
  const defaults = uniqueSortedStrings(progression?.defaultUnlockedRecipes);
  if (defaults.length > 0) return defaults.filter((id) => !!recipeDefs[id]);
  return sortStrings(Object.keys(recipeDefs || {}));
}

function getDefaultUnlockedHubStructures(defsInput) {
  const progression = getProgressionDefs(defsInput);
  const defaults = uniqueSortedStrings(progression?.defaultUnlockedHubStructures);
  if (defaults.length > 0) return defaults.filter((id) => !!hubStructureDefs[id]);
  return sortStrings(Object.keys(hubStructureDefs || {}));
}

function getNodeDepthMap(treeDef, defsInput) {
  const nodes = getTreeNodes(treeDef.id, defsInput);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const depthByNodeId = new Map();

  if (!nodeById.has(treeDef.startNodeId)) {
    return { nodeById, depthByNodeId };
  }

  const queue = [treeDef.startNodeId];
  depthByNodeId.set(treeDef.startNodeId, 0);

  while (queue.length) {
    const nodeId = queue.shift();
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const depth = depthByNodeId.get(nodeId) ?? 0;
    const adjacent = getAdjacentNodeIds(node);
    for (const adjId of adjacent) {
      if (!nodeById.has(adjId)) continue;
      if (depthByNodeId.has(adjId)) continue;
      depthByNodeId.set(adjId, depth + 1);
      queue.push(adjId);
    }
  }

  let maxDepth = -1;
  for (const depth of depthByNodeId.values()) {
    if (depth > maxDepth) maxDepth = depth;
  }
  const disconnectedDepth = maxDepth + 1;
  for (const node of nodes) {
    if (depthByNodeId.has(node.id)) continue;
    depthByNodeId.set(node.id, disconnectedDepth);
  }

  return { nodeById, depthByNodeId };
}

function buildEdgeList(nodesById) {
  const seen = new Set();
  const edges = [];
  const nodeIds = sortStrings(Array.from(nodesById.keys()));

  for (const nodeId of nodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    const adjacent = getAdjacentNodeIds(node);
    for (const adjId of adjacent) {
      if (!nodesById.has(adjId)) continue;
      const a = nodeId < adjId ? nodeId : adjId;
      const b = nodeId < adjId ? adjId : nodeId;
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }

  edges.sort((left, right) => {
    if (left.a !== right.a) return left.a.localeCompare(right.a);
    return left.b.localeCompare(right.b);
  });
  return edges;
}

export function getSkillTrees(defsInput = null) {
  return defsInput?.skillTrees ?? skillTrees;
}

export function getSkillNodes(defsInput = null) {
  return defsInput?.skillNodes ?? skillNodes;
}

export function getSkillTreeDefs(defsInput = null) {
  return getSkillTrees(defsInput);
}

export function getSkillNodeDef(defsInput, nodeId) {
  if (typeof defsInput === "string" && nodeId == null) {
    return getSkillNodes(null)?.[defsInput] ?? null;
  }
  return getSkillNodes(defsInput)?.[nodeId] ?? null;
}

export function getSkillTreeDef(treeId, defsInput = null) {
  return getSkillTrees(defsInput)?.[treeId] ?? null;
}

export function getDefaultSkillPointsForPawnDefId(pawnDefId, defsInput = null) {
  const progression = getProgressionDefs(defsInput);
  const byPawn = isObject(progression?.startingSkillPointsByPawnDefId)
    ? progression.startingSkillPointsByPawnDefId
    : null;
  const key = typeof pawnDefId === "string" && pawnDefId.length ? pawnDefId : "default";
  const exact = byPawn && Number.isFinite(byPawn[key]) ? Math.floor(byPawn[key]) : null;
  if (exact != null) return Math.max(0, exact);
  const fallback = Number.isFinite(byPawn?.default)
    ? Math.floor(byPawn.default)
    : Number.isFinite(progression?.defaultStartingSkillPoints)
    ? Math.floor(progression.defaultStartingSkillPoints)
    : 0;
  return Math.max(0, fallback);
}

export function getUnlockedSkillSet(state, characterId) {
  const ch = getCharacterById(state, characterId);
  if (!ch) return new Set();
  return new Set(uniqueSortedStrings(ch.unlockedSkillNodeIds));
}

export function evaluateSkillNodeUnlock(state, characterId, nodeId, opts = {}) {
  const ch = getCharacterById(state, characterId);
  if (!ch) return { ok: false, reason: "noCharacter" };

  const nodeDef = getSkillNodeDef(null, nodeId);
  if (!nodeDef) return { ok: false, reason: "unknownNode" };

  const treeDef = getSkillTreeDef(nodeDef.treeId);
  if (!treeDef) return { ok: false, reason: "unknownTree" };

  const unlockedSet =
    opts.unlockedSet instanceof Set
      ? new Set(opts.unlockedSet)
      : getUnlockedSkillSet(state, characterId);

  if (unlockedSet.has(nodeDef.id)) {
    return { ok: false, reason: "alreadyUnlocked", nodeDef, treeDef };
  }

  const cost = getNodeCost(nodeDef);
  const points = Number.isFinite(opts.skillPoints)
    ? Math.max(0, Math.floor(opts.skillPoints))
    : Math.max(0, toSafeInt(ch.skillPoints, 0));

  if (points < cost) {
    return { ok: false, reason: "insufficientSkillPoints", nodeDef, treeDef, cost, points };
  }

  const isStart = treeDef.startNodeId === nodeDef.id;
  const adjacentUnlocked = hasAnyAdjacentUnlocked(nodeDef, unlockedSet);
  if (!isStart && !adjacentUnlocked) {
    return { ok: false, reason: "adjacencyLocked", nodeDef, treeDef, cost, points };
  }

  if (!requirementsPass(nodeDef, unlockedSet)) {
    return { ok: false, reason: "requirementsNotMet", nodeDef, treeDef, cost, points };
  }

  return {
    ok: true,
    nodeDef,
    treeDef,
    cost,
    points,
  };
}

export function getUnlockableSkillNodes(state, characterId, treeId = null) {
  const trees = getSkillTrees();
  const treeIds = treeId
    ? [treeId]
    : sortStrings(Object.keys(trees || {}));

  const unlockable = [];
  for (const id of treeIds) {
    const nodes = getTreeNodes(id);
    for (const node of nodes) {
      const check = evaluateSkillNodeUnlock(state, characterId, node.id);
      if (check.ok) unlockable.push(node.id);
    }
  }
  return sortStrings(unlockable);
}

export function computeCharacterSkillMods(state, characterId) {
  const out = {
    forageTierBonus: 0,
    forageStaminaCostDelta: 0,
    farmingStaminaCostDelta: 0,
    restStaminaBonusFlat: 0,
    restStaminaBonusMult: 1,
  };

  const unlocked = sortStrings(Array.from(getUnlockedSkillSet(state, characterId).values()));
  for (const nodeId of unlocked) {
    const node = getSkillNodeDef(null, nodeId);
    const mods = isObject(node?.effects?.characterMods) ? node.effects.characterMods : null;
    if (!mods) continue;

    if (Number.isFinite(mods.forageTierBonus)) {
      out.forageTierBonus += Math.floor(mods.forageTierBonus);
    }
    if (Number.isFinite(mods.forageStaminaCostDelta)) {
      out.forageStaminaCostDelta += Math.floor(mods.forageStaminaCostDelta);
    }
    if (Number.isFinite(mods.farmingStaminaCostDelta)) {
      out.farmingStaminaCostDelta += Math.floor(mods.farmingStaminaCostDelta);
    }
    if (Number.isFinite(mods.restStaminaBonusFlat)) {
      out.restStaminaBonusFlat += Math.floor(mods.restStaminaBonusFlat);
    }
    if (Number.isFinite(mods.restStaminaBonusMult)) {
      out.restStaminaBonusMult *= mods.restStaminaBonusMult;
    }
  }

  out.restStaminaBonusMult = Math.max(0, out.restStaminaBonusMult);
  return out;
}

export function computeGlobalSkillMods(state) {
  const out = {
    apCapBonus: 0,
    projectionHorizonBonusSec: 0,
    populationFoodMult: 1,
    unlockedRecipes: new Set(getDefaultUnlockedRecipes()),
    unlockedHubStructures: new Set(getDefaultUnlockedHubStructures()),
  };

  const chars = Array.isArray(state?.characters) ? state.characters.slice() : [];
  chars.sort((a, b) => {
    const aid = Number.isFinite(a?.id) ? Math.floor(a.id) : 0;
    const bid = Number.isFinite(b?.id) ? Math.floor(b.id) : 0;
    return aid - bid;
  });

  for (const ch of chars) {
    if (!ch || ch.id == null) continue;
    const unlocked = sortStrings(Array.from(getUnlockedSkillSet(state, ch.id).values()));
    for (const nodeId of unlocked) {
      const node = getSkillNodeDef(null, nodeId);
      if (!node) continue;

      const globalMods = isObject(node?.effects?.globalMods) ? node.effects.globalMods : null;
      if (globalMods) {
        if (Number.isFinite(globalMods.apCapBonus)) {
          out.apCapBonus += Math.floor(globalMods.apCapBonus);
        }
        if (Number.isFinite(globalMods.projectionHorizonBonusSec)) {
          out.projectionHorizonBonusSec += Math.floor(globalMods.projectionHorizonBonusSec);
        }
        if (Number.isFinite(globalMods.populationFoodMult)) {
          out.populationFoodMult *= globalMods.populationFoodMult;
        }
      }

      const unlocks = isObject(node?.effects?.unlocks) ? node.effects.unlocks : null;
      if (unlocks) {
        for (const recipeId of uniqueSortedStrings(unlocks.recipes)) {
          if (recipeDefs[recipeId]) out.unlockedRecipes.add(recipeId);
        }
        for (const hubId of uniqueSortedStrings(unlocks.hubStructures)) {
          if (hubStructureDefs[hubId]) out.unlockedHubStructures.add(hubId);
        }
      }
    }
  }

  out.populationFoodMult = Math.max(0, out.populationFoodMult);
  return out;
}

export function computeAvailableRecipesAndBuildings(state) {
  const globalMods = computeGlobalSkillMods(state);
  return {
    recipeIds: new Set(
      sortStrings(Array.from(globalMods.unlockedRecipes.values())).filter((id) => !!recipeDefs[id])
    ),
    hubStructureIds: new Set(
      sortStrings(Array.from(globalMods.unlockedHubStructures.values())).filter(
        (id) => !!hubStructureDefs[id]
      )
    ),
  };
}

const COLOR_TAG_ORDER = ["Blue", "Green", "Red", "Black"];
const DEFAULT_WEDGE_CENTER_DEG = {
  Blue: 135,
  Green: 45,
  Red: -45,
  Black: -135,
  BlueGreen: 90,
  GreenRed: 0,
  RedBlack: -90,
  BlackBlue: 180,
};
const DEFAULT_WEDGE_SPAN_DEG = {
  Blue: 70,
  Green: 70,
  Red: 70,
  Black: 70,
  BlueGreen: 46,
  GreenRed: 46,
  RedBlack: 46,
  BlackBlue: 46,
};
const DEFAULT_LAYOUT_NODE_RADIUS = 24;
const DEFAULT_LAYOUT_NOTABLE_RADIUS = 34;
const MIN_LAYOUT_NODE_RADIUS = 10;
const MAX_LAYOUT_NODE_RADIUS = 72;

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getLegacyRingIdFromTags(node) {
  const tags = toArray(node?.tags);
  if (tags.includes("Core")) return "core";
  if (tags.includes("Early")) return "early";
  if (tags.includes("Mid")) return "mid";
  if (tags.includes("Late")) return "late";
  return null;
}

function getNodeRingId(node) {
  if (typeof node?.ringId === "string" && node.ringId.length > 0) {
    return node.ringId;
  }
  return getLegacyRingIdFromTags(node);
}

function getRingIdSortKey(ringId) {
  const id = String(ringId || "");
  if (id === "core") return [0, 0, id];
  const match = /^ring[_-]?(\d+)$/i.exec(id);
  if (match) return [1, Number(match[1]), id];
  if (id === "early") return [2, 0, id];
  if (id === "mid") return [2, 1, id];
  if (id === "late") return [2, 2, id];
  return [3, 0, id];
}

function uniqueStringsInOrder(values) {
  const out = [];
  const seen = new Set();
  for (const value of toArray(values)) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
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

function buildRingOrder(layoutCfg, radiiCfg, ringIdsInUse = []) {
  const orderFromCfg = uniqueStringsInOrder(layoutCfg?.ringOrder);
  const ringIdsFromRadii = sortRingIds(Object.keys(radiiCfg || {}));
  const ringIdsUsed = sortRingIds(uniqueSortedStrings(ringIdsInUse));

  const order = [];
  const seen = new Set();
  function pushRing(id) {
    if (typeof id !== "string" || id.length === 0) return;
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  }

  pushRing("core");
  for (const ringId of orderFromCfg) pushRing(ringId);
  for (const ringId of ringIdsFromRadii) pushRing(ringId);
  for (const ringId of ringIdsUsed) pushRing(ringId);

  if (order.length <= 1) {
    pushRing("early");
    pushRing("mid");
    pushRing("late");
  }

  return order;
}

function applyNodeUiPosition(node, basePos) {
  const out = { ...basePos };
  if (isObject(node?.uiPos)) {
    out.x = Number.isFinite(node.uiPos.x) ? node.uiPos.x : out.x;
    out.y = Number.isFinite(node.uiPos.y) ? node.uiPos.y : out.y;
  }
  if (isObject(node?.uiPosNudge)) {
    out.x += Number.isFinite(node.uiPosNudge.x) ? node.uiPosNudge.x : 0;
    out.y += Number.isFinite(node.uiPosNudge.y) ? node.uiPosNudge.y : 0;
  }
  return out;
}

function normalizeColorPairWedgeId(colorA, colorB) {
  const pair = [colorA, colorB].sort().join("|");
  if (pair === "Blue|Green") return "BlueGreen";
  if (pair === "Green|Red") return "GreenRed";
  if (pair === "Black|Red") return "RedBlack";
  if (pair === "Black|Blue") return "BlackBlue";
  return `${colorA}${colorB}`;
}

function getWedgeIdFromTags(node) {
  const tags = new Set(toArray(node?.tags));
  const colors = COLOR_TAG_ORDER.filter((color) => tags.has(color));
  if (colors.length === 1) return colors[0];
  if (colors.length >= 2) {
    return normalizeColorPairWedgeId(colors[0], colors[1]);
  }
  return null;
}

function getRingLayoutConfig(treeDef, opts, ringIdsInUse = []) {
  const {
    x = 0,
    y = 0,
    width = 1600,
    height = 650,
  } = opts;
  const layoutCfg = isObject(treeDef?.ui?.ringLayout) ? treeDef.ui.ringLayout : {};
  const minDim = Math.min(width, height);
  const lateDefault = Math.max(120, Math.floor(minDim * 0.42));
  const radiiCfg = isObject(layoutCfg?.radii) ? layoutCfg.radii : {};
  const ringOrder = buildRingOrder(layoutCfg, radiiCfg, ringIdsInUse);
  const ringIndexById = {};
  for (let idx = 0; idx < ringOrder.length; idx++) {
    ringIndexById[ringOrder[idx]] = idx;
  }

  const radiiByRing = {};
  const nonCoreCount = Math.max(0, ringOrder.length - 1);
  for (let idx = 0; idx < ringOrder.length; idx++) {
    const ringId = ringOrder[idx];
    let radius = Number.isFinite(radiiCfg[ringId]) ? radiiCfg[ringId] : null;
    if (!Number.isFinite(radius)) {
      if (ringId === "core") {
        radius = Number.isFinite(radiiCfg.core) ? radiiCfg.core : 0;
      } else if (nonCoreCount > 0) {
        radius = Math.floor((lateDefault * idx) / nonCoreCount);
      } else {
        radius = 0;
      }
    }
    radiiByRing[idx] = Math.max(0, Math.floor(radius));
  }

  const centersCfg = isObject(layoutCfg?.wedgeCentersDeg)
    ? layoutCfg.wedgeCentersDeg
    : {};
  const spansCfg = isObject(layoutCfg?.wedgeSpansDeg) ? layoutCfg.wedgeSpansDeg : {};
  const wedgeCenterDeg = { ...DEFAULT_WEDGE_CENTER_DEG, ...centersCfg };
  const wedgeSpanDeg = { ...DEFAULT_WEDGE_SPAN_DEG, ...spansCfg };

  return {
    centerX: x + Math.floor(width / 2),
    centerY: y + Math.floor(height / 2),
    ringOrder,
    ringIndexById,
    radiiByRing,
    wedgeCenterDeg,
    wedgeSpanDeg,
    barycenterIterations: Number.isFinite(layoutCfg?.barycenterIterations)
      ? Math.max(1, Math.floor(layoutCfg.barycenterIterations))
      : 6,
    overlapIterations: Number.isFinite(layoutCfg?.overlapIterations)
      ? Math.max(0, Math.floor(layoutCfg.overlapIterations))
      : 3,
    overlapPaddingPx: Number.isFinite(layoutCfg?.overlapPaddingPx)
      ? Math.max(0, layoutCfg.overlapPaddingPx)
      : 10,
    coreSpread: Number.isFinite(layoutCfg?.coreSpread)
      ? Math.max(0, Math.floor(layoutCfg.coreSpread))
      : 48,
  };
}

function getLayoutNodeRadius(nodeDef, treeDef) {
  const tags = toArray(nodeDef?.tags);
  const nodeSizes = isObject(treeDef?.ui?.nodeSizes) ? treeDef.ui.nodeSizes : null;
  const defaultRadius = Number.isFinite(nodeSizes?.defaultRadius)
    ? nodeSizes.defaultRadius
    : DEFAULT_LAYOUT_NODE_RADIUS;
  const notableRadius = Number.isFinite(nodeSizes?.notableRadius)
    ? nodeSizes.notableRadius
    : DEFAULT_LAYOUT_NOTABLE_RADIUS;
  const fallback = tags.includes("Notable") ? notableRadius : defaultRadius;
  const radius = Number.isFinite(nodeDef?.uiNodeRadius) ? nodeDef.uiNodeRadius : fallback;
  return clampNumber(radius, MIN_LAYOUT_NODE_RADIUS, MAX_LAYOUT_NODE_RADIUS);
}

function resolveAngularOverlapsInWedge({
  ids,
  minTheta,
  maxTheta,
  ringRadius,
  thetaByNodeId,
  nodeById,
  treeDef,
  cfg,
}) {
  if (!Array.isArray(ids) || ids.length <= 1) return;
  if (!Number.isFinite(minTheta) || !Number.isFinite(maxTheta) || maxTheta <= minTheta) return;
  if (!Number.isFinite(ringRadius) || ringRadius <= 0) return;
  const iterations = Math.max(0, Math.floor(cfg?.overlapIterations || 0));
  if (iterations <= 0) return;

  const orderedIds = ids.slice();
  const paddingPx = Number.isFinite(cfg?.overlapPaddingPx) ? Math.max(0, cfg.overlapPaddingPx) : 10;
  const n = orderedIds.length;
  const angles = new Array(n);
  const radii = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = orderedIds[i];
    const fallbackTheta =
      n === 1 ? (minTheta + maxTheta) / 2 : minTheta + ((maxTheta - minTheta) * i) / (n - 1);
    angles[i] = Number.isFinite(thetaByNodeId[id]) ? thetaByNodeId[id] : fallbackTheta;
    radii[i] = getLayoutNodeRadius(nodeById.get(id), treeDef);
  }

  const gaps = new Array(Math.max(0, n - 1)).fill(0);
  const availableSpan = maxTheta - minTheta;
  const epsilon = 0.0001;

  function computeGaps() {
    let requiredSpan = 0;
    for (let i = 0; i < n - 1; i++) {
      const gap = (radii[i] + radii[i + 1] + paddingPx) / ringRadius;
      gaps[i] = Math.max(0, gap);
      requiredSpan += gaps[i];
    }
    return requiredSpan;
  }

  const requiredSpan = computeGaps();
  if (requiredSpan >= availableSpan - epsilon) {
    for (let i = 0; i < n; i++) {
      angles[i] = n === 1 ? (minTheta + maxTheta) / 2 : minTheta + (availableSpan * i) / (n - 1);
    }
    for (let i = 0; i < n; i++) {
      thetaByNodeId[orderedIds[i]] = angles[i];
    }
    return;
  }

  for (let pass = 0; pass < iterations; pass++) {
    for (let i = 1; i < n; i++) {
      const minAllowed = angles[i - 1] + gaps[i - 1];
      if (angles[i] < minAllowed) angles[i] = minAllowed;
    }

    const overflow = angles[n - 1] - maxTheta;
    if (overflow > 0) {
      for (let i = 0; i < n; i++) angles[i] -= overflow;
    }

    for (let i = n - 2; i >= 0; i--) {
      const maxAllowed = angles[i + 1] - gaps[i];
      if (angles[i] > maxAllowed) angles[i] = maxAllowed;
    }

    const underflow = minTheta - angles[0];
    if (underflow > 0) {
      for (let i = 0; i < n; i++) angles[i] += underflow;
    }
  }

  for (let i = 0; i < n; i++) {
    thetaByNodeId[orderedIds[i]] = clampNumber(angles[i], minTheta, maxTheta);
  }
}

function buildBfsLayout(treeDef, opts, defsInput) {
  const {
    x = 0,
    y = 0,
    width = 1600,
    height = 650,
    columnSpacing = 220,
    rowSpacing = 110,
    leftPad = 120,
  } = opts;
  const { nodeById, depthByNodeId } = getNodeDepthMap(treeDef, defsInput);
  const groups = new Map();
  for (const [nodeId, depth] of depthByNodeId.entries()) {
    if (!groups.has(depth)) groups.set(depth, []);
    groups.get(depth).push(nodeId);
  }

  const orderedDepths = Array.from(groups.keys()).sort((a, b) => a - b);
  const positionsByNodeId = {};
  const depthByNodeIdOut = {};

  for (const depth of orderedDepths) {
    const ids = sortStrings(groups.get(depth) || []);
    const count = ids.length;
    const totalHeight = Math.max(0, (count - 1) * rowSpacing);
    const startY = y + Math.floor(height / 2) - Math.floor(totalHeight / 2);

    for (let i = 0; i < ids.length; i++) {
      const nodeId = ids[i];
      const node = nodeById.get(nodeId);
      const defaultX = x + leftPad + depth * columnSpacing;
      const defaultY = startY + i * rowSpacing;
      const pos = applyNodeUiPosition(node, { x: defaultX, y: defaultY });
      positionsByNodeId[nodeId] = { ...pos, depth };
      depthByNodeIdOut[nodeId] = depth;
    }
  }

  return {
    positionsByNodeId,
    depthByNodeId: depthByNodeIdOut,
    orderedNodeIds: sortStrings(Array.from(nodeById.keys())),
    edges: buildEdgeList(nodeById),
  };
}

function buildRingLayout(treeDef, opts, defsInput) {
  const nodes = getTreeNodes(treeDef.id, defsInput);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeById.has(treeDef.startNodeId)) return null;

  const ringIdByNodeId = {};
  for (const node of nodes) {
    const ringId = getNodeRingId(node);
    if (typeof ringId !== "string" || ringId.length === 0) return null;
    ringIdByNodeId[node.id] = ringId;
  }

  const cfg = getRingLayoutConfig(treeDef, opts, Object.values(ringIdByNodeId));
  const ringByNodeId = {};
  const wedgeByNodeId = {};
  for (const node of nodes) {
    const ringId = ringIdByNodeId[node.id];
    const ring = cfg.ringIndexById[ringId];
    if (!Number.isFinite(ring)) return null;
    const wedge = ring === 0 ? "Core" : getWedgeIdFromTags(node);
    if (!wedge) return null;
    ringByNodeId[node.id] = ring;
    wedgeByNodeId[node.id] = wedge;
  }

  const wedgeIds = new Set();
  for (const node of nodes) {
    const ring = ringByNodeId[node.id];
    if (ring <= 0) continue;
    wedgeIds.add(wedgeByNodeId[node.id]);
  }

  const wedgeOrder = Array.from(wedgeIds.values()).sort((a, b) => {
    const da = Number.isFinite(cfg.wedgeCenterDeg[a]) ? cfg.wedgeCenterDeg[a] : 0;
    const db = Number.isFinite(cfg.wedgeCenterDeg[b]) ? cfg.wedgeCenterDeg[b] : 0;
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });

  const groupsByRing = new Map();
  const nodeIds = sortStrings(nodes.map((node) => node.id));
  for (const nodeId of nodeIds) {
    const ring = ringByNodeId[nodeId];
    const wedge = wedgeByNodeId[nodeId];
    if (!groupsByRing.has(ring)) groupsByRing.set(ring, new Map());
    const ringMap = groupsByRing.get(ring);
    if (!ringMap.has(wedge)) ringMap.set(wedge, []);
    ringMap.get(wedge).push(nodeId);
  }

  function getRingNodeIndexMap(ring) {
    const out = new Map();
    const ringMap = groupsByRing.get(ring);
    if (!ringMap) return out;
    let index = 0;
    const wedgeList = ring === 0 ? ["Core"] : wedgeOrder;
    for (const wedge of wedgeList) {
      const ids = ringMap.get(wedge) || [];
      for (const id of ids) {
        out.set(id, index++);
      }
    }
    return out;
  }

  const maxRing = Math.max(...Object.values(ringByNodeId), 0);
  const iterations = cfg.barycenterIterations;
  for (let pass = 0; pass < iterations; pass++) {
    for (let ring = 1; ring <= maxRing; ring++) {
      const prevIndexByNode = getRingNodeIndexMap(ring - 1);
      const ringMap = groupsByRing.get(ring);
      if (!ringMap) continue;
      for (const wedge of wedgeOrder) {
        const ids = ringMap.get(wedge);
        if (!ids || ids.length <= 1) continue;
        const currentIndex = new Map(ids.map((id, idx) => [id, idx]));
        ids.sort((a, b) => {
          const neighborsA = getAdjacentNodeIds(nodeById.get(a)).filter(
            (adjId) => ringByNodeId[adjId] === ring - 1 && prevIndexByNode.has(adjId)
          );
          const neighborsB = getAdjacentNodeIds(nodeById.get(b)).filter(
            (adjId) => ringByNodeId[adjId] === ring - 1 && prevIndexByNode.has(adjId)
          );
          const keyA = neighborsA.length
            ? neighborsA.reduce((sum, id) => sum + prevIndexByNode.get(id), 0) / neighborsA.length
            : Number.POSITIVE_INFINITY;
          const keyB = neighborsB.length
            ? neighborsB.reduce((sum, id) => sum + prevIndexByNode.get(id), 0) / neighborsB.length
            : Number.POSITIVE_INFINITY;
          if (keyA !== keyB) return keyA - keyB;
          const idxA = currentIndex.get(a) ?? 0;
          const idxB = currentIndex.get(b) ?? 0;
          if (idxA !== idxB) return idxA - idxB;
          return a.localeCompare(b);
        });
      }
    }

    for (let ring = maxRing - 1; ring >= 1; ring--) {
      const nextIndexByNode = getRingNodeIndexMap(ring + 1);
      const ringMap = groupsByRing.get(ring);
      if (!ringMap) continue;
      for (const wedge of wedgeOrder) {
        const ids = ringMap.get(wedge);
        if (!ids || ids.length <= 1) continue;
        const currentIndex = new Map(ids.map((id, idx) => [id, idx]));
        ids.sort((a, b) => {
          const neighborsA = getAdjacentNodeIds(nodeById.get(a)).filter(
            (adjId) => ringByNodeId[adjId] === ring + 1 && nextIndexByNode.has(adjId)
          );
          const neighborsB = getAdjacentNodeIds(nodeById.get(b)).filter(
            (adjId) => ringByNodeId[adjId] === ring + 1 && nextIndexByNode.has(adjId)
          );
          const keyA = neighborsA.length
            ? neighborsA.reduce((sum, id) => sum + nextIndexByNode.get(id), 0) / neighborsA.length
            : Number.POSITIVE_INFINITY;
          const keyB = neighborsB.length
            ? neighborsB.reduce((sum, id) => sum + nextIndexByNode.get(id), 0) / neighborsB.length
            : Number.POSITIVE_INFINITY;
          if (keyA !== keyB) return keyA - keyB;
          const idxA = currentIndex.get(a) ?? 0;
          const idxB = currentIndex.get(b) ?? 0;
          if (idxA !== idxB) return idxA - idxB;
          return a.localeCompare(b);
        });
      }
    }
  }

  const positionsByNodeId = {};
  const depthByNodeIdOut = {};
  const thetaByNodeId = {};
  const wedgeBoundsByRing = new Map();

  const coreNodes = (groupsByRing.get(0)?.get("Core") || []).slice();
  if (coreNodes.length === 1) {
    const nodeId = coreNodes[0];
    positionsByNodeId[nodeId] = { x: cfg.centerX, y: cfg.centerY, depth: 0 };
    depthByNodeIdOut[nodeId] = 0;
  } else if (coreNodes.length > 1) {
    for (let i = 0; i < coreNodes.length; i++) {
      const theta = (Math.PI * 2 * i) / coreNodes.length;
      const nodeId = coreNodes[i];
      positionsByNodeId[nodeId] = {
        x: Math.floor(cfg.centerX + cfg.coreSpread * Math.cos(theta)),
        y: Math.floor(cfg.centerY + cfg.coreSpread * Math.sin(theta)),
        depth: 0,
      };
      depthByNodeIdOut[nodeId] = 0;
    }
  }

  for (let ring = 1; ring <= maxRing; ring++) {
    const ringMap = groupsByRing.get(ring);
    if (!ringMap) continue;
    const radius = Number.isFinite(cfg.radiiByRing[ring]) ? cfg.radiiByRing[ring] : 0;
    if (!wedgeBoundsByRing.has(ring)) wedgeBoundsByRing.set(ring, new Map());
    const wedgeBounds = wedgeBoundsByRing.get(ring);
    for (const wedge of wedgeOrder) {
      const ids = ringMap.get(wedge);
      if (!ids || ids.length === 0) continue;
      const centerDeg = Number.isFinite(cfg.wedgeCenterDeg[wedge]) ? cfg.wedgeCenterDeg[wedge] : 0;
      const spanDeg = Number.isFinite(cfg.wedgeSpanDeg[wedge]) ? cfg.wedgeSpanDeg[wedge] : 40;
      const center = (centerDeg * Math.PI) / 180;
      const span = (spanDeg * Math.PI) / 180;
      wedgeBounds.set(wedge, {
        minTheta: center - span / 2,
        maxTheta: center + span / 2,
        radius,
      });
      for (let i = 0; i < ids.length; i++) {
        const nodeId = ids[i];
        const theta =
          ids.length === 1
            ? center
            : center - span / 2 + (span * i) / (ids.length - 1);
        thetaByNodeId[nodeId] = theta;
        depthByNodeIdOut[nodeId] = ring;
      }
    }
  }

  for (let ring = 1; ring <= maxRing; ring++) {
    const ringMap = groupsByRing.get(ring);
    const wedgeBounds = wedgeBoundsByRing.get(ring);
    if (!ringMap || !wedgeBounds) continue;
    for (const wedge of wedgeOrder) {
      const ids = ringMap.get(wedge);
      const bounds = wedgeBounds.get(wedge);
      if (!ids || !ids.length || !bounds) continue;
      resolveAngularOverlapsInWedge({
        ids,
        minTheta: bounds.minTheta,
        maxTheta: bounds.maxTheta,
        ringRadius: bounds.radius,
        thetaByNodeId,
        nodeById,
        treeDef,
        cfg,
      });
    }
  }

  for (let ring = 1; ring <= maxRing; ring++) {
    const ringMap = groupsByRing.get(ring);
    const wedgeBounds = wedgeBoundsByRing.get(ring);
    if (!ringMap || !wedgeBounds) continue;
    for (const wedge of wedgeOrder) {
      const ids = ringMap.get(wedge);
      const bounds = wedgeBounds.get(wedge);
      if (!ids || !ids.length || !bounds) continue;
      const centerTheta = (bounds.minTheta + bounds.maxTheta) / 2;
      for (const nodeId of ids) {
        const theta = Number.isFinite(thetaByNodeId[nodeId]) ? thetaByNodeId[nodeId] : centerTheta;
        positionsByNodeId[nodeId] = {
          x: Math.floor(cfg.centerX + bounds.radius * Math.cos(theta)),
          y: Math.floor(cfg.centerY + bounds.radius * Math.sin(theta)),
          depth: ring,
        };
        depthByNodeIdOut[nodeId] = ring;
      }
    }
  }

  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId);
    const basePos = positionsByNodeId[nodeId] ?? {
      x: cfg.centerX,
      y: cfg.centerY,
      depth: Number.isFinite(ringByNodeId[nodeId]) ? ringByNodeId[nodeId] : 0,
    };
    const pos = applyNodeUiPosition(node, basePos);
    positionsByNodeId[nodeId] = { ...pos, depth: basePos.depth };
    depthByNodeIdOut[nodeId] = basePos.depth;
  }

  return {
    positionsByNodeId,
    depthByNodeId: depthByNodeIdOut,
    orderedNodeIds: nodeIds,
    edges: buildEdgeList(nodeById),
  };
}

export function getSkillTreeLayout(treeId, opts = {}, defsInput = null) {
  const treeDef = getSkillTreeDef(treeId, defsInput);
  if (!treeDef) {
    return {
      treeId,
      positionsByNodeId: {},
      depthByNodeId: {},
      orderedNodeIds: [],
      edges: [],
    };
  }
  const mode =
    typeof opts?.layoutMode === "string"
      ? opts.layoutMode
      : treeDef?.ui?.layoutMode;
  if (mode === "ringByTags") {
    const ringLayout = buildRingLayout(treeDef, opts, defsInput);
    if (ringLayout) {
      return {
        treeId,
        positionsByNodeId: ringLayout.positionsByNodeId,
        depthByNodeId: ringLayout.depthByNodeId,
        orderedNodeIds: ringLayout.orderedNodeIds,
        edges: ringLayout.edges,
      };
    }
  }

  const bfsLayout = buildBfsLayout(treeDef, opts, defsInput);
  return {
    treeId,
    positionsByNodeId: bfsLayout.positionsByNodeId,
    depthByNodeId: bfsLayout.depthByNodeId,
    orderedNodeIds: bfsLayout.orderedNodeIds,
    edges: bfsLayout.edges,
  };
}

export function getDeterministicSkillCommitOrder(treeId, nodeIds, defsInput = null) {
  const layout = getSkillTreeLayout(treeId, {}, defsInput);
  const list = uniqueSortedStrings(nodeIds);
  return list.sort((a, b) => {
    const da = toSafeInt(layout.depthByNodeId?.[a], 9999);
    const db = toSafeInt(layout.depthByNodeId?.[b], 9999);
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });
}

export function validateSkillDefs(defsInput = null) {
  const trees = defsInput?.skillTrees ?? skillTrees;
  const nodes = defsInput?.skillNodes ?? skillNodes;
  const recipes = defsInput?.recipeDefs ?? recipeDefs;
  const hubs = defsInput?.hubStructureDefs ?? hubStructureDefs;
  return validateSkillDefsRegistry({
    skillTrees: trees,
    skillNodes: nodes,
    recipeDefs: recipes,
    hubStructureDefs: hubs,
  });
}
