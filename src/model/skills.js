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
import {
  isObject,
  sortStrings,
  toSafeInt,
  uniqueSortedStrings,
} from "./skills/helpers.js";
import {
  computeSkillTreeLayout,
  getDeterministicCommitOrder,
} from "./skills/layout-engine.js";

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
  const treeIds = treeId ? [treeId] : sortStrings(Object.keys(trees || {}));

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
  return computeSkillTreeLayout(treeDef, getSkillNodes(defsInput), opts);
}

export function getDeterministicSkillCommitOrder(treeId, nodeIds, defsInput = null) {
  const layout = getSkillTreeLayout(treeId, {}, defsInput);
  return getDeterministicCommitOrder(layout, nodeIds);
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
