// skills.js
// Deterministic skill tree selectors, validation wrappers, and modifier aggregation.

import {
  skillTrees,
  skillNodes,
  skillProgressionDefs,
} from "../defs/gamepieces/skill-tree-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { skillFeatureUnlockDefs } from "../defs/gamesettings/skill-feature-unlocks-defs.js";
import { validateSkillDefs as validateSkillDefsRegistry } from "../defs/validate-skill-defs.js";
import {
  isObject,
  sortStrings,
  toSafeInt,
  uniqueSortedStrings,
} from "./skills/helpers.js";
import {
  computeSkillTreeLayout,
} from "./skills/layout-engine.js";

const PAWN_SKILL_MOD_KEYS = Object.freeze([
  "forageTierBonus",
  "forageStaminaCostDelta",
  "farmingStaminaCostDelta",
  "restStaminaBonusFlat",
  "restStaminaBonusMult",
]);
const PAWN_SKILL_MOD_KEY_SET = new Set(PAWN_SKILL_MOD_KEYS);

const PAWN_SKILL_MULTIPLIER_KEYS = new Set(["restStaminaBonusMult"]);

const GLOBAL_SKILL_MOD_KEYS = Object.freeze([
  "apCapBonus",
  "editableHistoryWindowBonusSec",
  "projectionHorizonBonusSec",
  "populationFoodMult",
]);
const GLOBAL_SKILL_MOD_KEY_SET = new Set(GLOBAL_SKILL_MOD_KEYS);

const GLOBAL_SKILL_MULTIPLIER_KEYS = new Set(["populationFoodMult"]);

const PAWN_SKILL_MOD_DEFAULTS = Object.freeze({
  forageTierBonus: 0,
  forageStaminaCostDelta: 0,
  farmingStaminaCostDelta: 0,
  restStaminaBonusFlat: 0,
  restStaminaBonusMult: 1,
});

const GLOBAL_SKILL_MOD_DEFAULTS = Object.freeze({
  apCapBonus: 0,
  editableHistoryWindowBonusSec: 0,
  projectionHorizonBonusSec: 0,
  populationFoodMult: 1,
});

function normalizeModifierEntry(raw, keys, defaultMap) {
  const entry = {};
  for (const key of keys) {
    const value = raw?.[key];
    if (Number.isFinite(value)) {
      entry[key] = value;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(defaultMap, key)) {
      entry[key] = defaultMap[key];
    }
  }
  return entry;
}

function normalizePawnModifierMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [pawnId, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    out[pawnId] = normalizeModifierEntry(
      entry,
      PAWN_SKILL_MOD_KEYS,
      PAWN_SKILL_MOD_DEFAULTS
    );
  }
  return out;
}

function normalizeStringUnlockList(raw, knownIds) {
  const out = [];
  const seen = new Set();
  const ids = Array.isArray(raw) ? raw : [];
  for (const id of ids) {
    if (typeof id !== "string" || !id.length) continue;
    if (knownIds && !knownIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function normalizeSkillRuntimeShape(runtime, defsInput = null) {
  const safe = runtime && typeof runtime === "object" ? runtime : {};
  const safeModifiers =
    safe.modifiers && typeof safe.modifiers === "object"
      ? safe.modifiers
      : {};
  const safeUnlocks =
    safe.unlocks && typeof safe.unlocks === "object" ? safe.unlocks : {};

  const knownRecipeIds = new Set(Object.keys(defsInput?.recipeDefs ?? recipeDefs ?? {}));
  const knownHubIds = new Set(
    Object.keys(defsInput?.hubStructureDefs ?? hubStructureDefs ?? {})
  );
  const knownEnvTagIds = new Set(Object.keys(defsInput?.envTagDefs ?? envTagDefs ?? {}));
  const knownHubTagIds = new Set(Object.keys(defsInput?.hubTagDefs ?? hubTagDefs ?? {}));
  const knownFeatureUnlockIds = new Set(
    Object.keys(defsInput?.skillFeatureUnlockDefs ?? skillFeatureUnlockDefs ?? {})
  );
  const knownItemTagIds = new Set(Object.keys(defsInput?.itemTagDefs ?? itemTagDefs ?? {}));

  return {
    modifiers: {
      global: normalizeModifierEntry(
        safeModifiers.global,
        GLOBAL_SKILL_MOD_KEYS,
        GLOBAL_SKILL_MOD_DEFAULTS
      ),
      pawnById: normalizePawnModifierMap(safeModifiers.pawnById),
    },
    unlocks: {
      recipes: normalizeStringUnlockList(safeUnlocks.recipes, knownRecipeIds),
      hubStructures: normalizeStringUnlockList(
        safeUnlocks.hubStructures,
        knownHubIds
      ),
      envTags: normalizeStringUnlockList(safeUnlocks.envTags, knownEnvTagIds),
      hubTags: normalizeStringUnlockList(safeUnlocks.hubTags, knownHubTagIds),
      features: normalizeStringUnlockList(
        safeUnlocks.features,
        knownFeatureUnlockIds
      ),
      itemTags: normalizeStringUnlockList(safeUnlocks.itemTags, knownItemTagIds),
    },
  };
}

function getPawnRuntimeKey(pawnId) {
  if (pawnId == null) return null;
  const asNum = Number(pawnId);
  if (Number.isFinite(asNum)) return String(Math.floor(asNum));
  return String(pawnId);
}

function getRuntimeModifierDefault(scope, key) {
  if (scope === "global") {
    if (Object.prototype.hasOwnProperty.call(GLOBAL_SKILL_MOD_DEFAULTS, key)) {
      return GLOBAL_SKILL_MOD_DEFAULTS[key];
    }
    return 0;
  }
  if (Object.prototype.hasOwnProperty.call(PAWN_SKILL_MOD_DEFAULTS, key)) {
    return PAWN_SKILL_MOD_DEFAULTS[key];
  }
  return 0;
}

function getRuntimeMultiplierFallback(scope, key) {
  if (scope === "global") {
    if (GLOBAL_SKILL_MULTIPLIER_KEYS.has(key)) {
      return getRuntimeModifierDefault("global", key);
    }
    return 1;
  }
  if (PAWN_SKILL_MULTIPLIER_KEYS.has(key)) {
    return getRuntimeModifierDefault("pawn", key);
  }
  return 1;
}

function normalizeEquippedEffectList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((entry) => entry && typeof entry === "object");
  }
  if (typeof raw === "object") return [raw];
  return [];
}

function getEquippedItemEffects(item) {
  const kind = typeof item?.kind === "string" ? item.kind : null;
  if (!kind) return [];
  const itemDef = itemDefs?.[kind];
  if (!itemDef || typeof itemDef !== "object") return [];
  return normalizeEquippedEffectList(itemDef.equippedEffects);
}

function applyDerivedModifierEffect(entry, effect, scope, keySet) {
  const op = effect?.op;
  const key = typeof effect?.key === "string" ? effect.key : null;
  if (!key || !keySet.has(key)) return false;

  if (op === "AddModifier") {
    const amount = Number.isFinite(effect?.amount)
      ? effect.amount
      : Number.isFinite(effect?.delta)
        ? effect.delta
        : null;
    if (!Number.isFinite(amount)) return false;
    const current = Number.isFinite(entry?.[key])
      ? entry[key]
      : getRuntimeModifierDefault(scope, key);
    entry[key] = current + amount;
    return true;
  }

  if (op === "MulModifier") {
    const factor = Number.isFinite(effect?.factor)
      ? effect.factor
      : Number.isFinite(effect?.multiplier)
        ? effect.multiplier
        : Number.isFinite(effect?.amount)
          ? effect.amount
          : null;
    if (!Number.isFinite(factor)) return false;
    const current = Number.isFinite(entry?.[key])
      ? entry[key]
      : getRuntimeMultiplierFallback(scope, key);
    entry[key] = current * factor;
    return true;
  }

  return false;
}

function forEachEquippedItemEffect(state, visit) {
  if (typeof visit !== "function") return;
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    const equipment =
      pawn?.equipment && typeof pawn.equipment === "object" ? pawn.equipment : null;
    if (!equipment) continue;
    for (const item of Object.values(equipment)) {
      if (!item || typeof item !== "object") continue;
      const effects = getEquippedItemEffects(item);
      if (!effects.length) continue;
      for (const effect of effects) {
        visit(effect, pawn, item);
      }
    }
  }
}

function getPawnById(state, pawnId) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const idNum = Number.isFinite(pawnId) ? Math.floor(pawnId) : null;
  for (const pawn of pawns) {
    if (!pawn) continue;
    if (idNum != null && Number.isFinite(pawn.id) && Math.floor(pawn.id) === idNum) {
      return pawn;
    }
    if (String(pawn.id) === String(pawnId)) return pawn;
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
  const overrides = defsInput?.skillProgressionDefs;
  if (!isObject(overrides)) return skillProgressionDefs;

  const baseByPawn = isObject(skillProgressionDefs?.startingSkillPointsByPawnDefId)
    ? skillProgressionDefs.startingSkillPointsByPawnDefId
    : {};
  const overrideByPawn = isObject(overrides?.startingSkillPointsByPawnDefId)
    ? overrides.startingSkillPointsByPawnDefId
    : null;

  return {
    ...skillProgressionDefs,
    ...overrides,
    startingSkillPointsByPawnDefId: overrideByPawn
      ? { ...baseByPawn, ...overrideByPawn }
      : { ...baseByPawn },
  };
}

function getStateSkillDefsInput(state) {
  const progression = state?.skillProgressionDefs;
  if (!isObject(progression)) return null;
  return { skillProgressionDefs: progression };
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

function getDefaultUnlockedEnvTags(defsInput) {
  const progression = getProgressionDefs(defsInput);
  const defaults = uniqueSortedStrings(progression?.defaultUnlockedEnvTags);
  if (defaults.length > 0) return defaults.filter((id) => !!envTagDefs[id]);
  return sortStrings(Object.keys(envTagDefs || {}));
}

function getDefaultUnlockedHubTags(defsInput) {
  const progression = getProgressionDefs(defsInput);
  const defaults = uniqueSortedStrings(progression?.defaultUnlockedHubTags);
  if (defaults.length > 0) return defaults.filter((id) => !!hubTagDefs[id]);
  return sortStrings(Object.keys(hubTagDefs || {}));
}

function getDefaultUnlockedItemTags(defsInput) {
  const progression = getProgressionDefs(defsInput);
  const defaults = uniqueSortedStrings(progression?.defaultUnlockedItemTags);
  if (defaults.length > 0) return defaults.filter((id) => !!itemTagDefs[id]);
  return sortStrings(Object.keys(itemTagDefs || {}));
}

function getDefaultUnlockedFeatures(defsInput) {
  const progression = getProgressionDefs(defsInput);
  const defs = defsInput?.skillFeatureUnlockDefs ?? skillFeatureUnlockDefs ?? {};
  const defaults = uniqueSortedStrings(progression?.defaultUnlockedFeatures);
  if (defaults.length > 0) return defaults.filter((id) => !!defs[id]);
  return [];
}

function normalizeSkillEffectSpecList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((entry) => entry && typeof entry === "object");
  if (typeof raw === "object") return [raw];
  return [];
}

export function getSkillNodeUnlockEffects(nodeDef) {
  return normalizeSkillEffectSpecList(nodeDef?.onUnlock);
}

function withRuntimeSkillState(state, defsInput = null) {
  if (!state || typeof state !== "object") {
    return normalizeSkillRuntimeShape(null, defsInput);
  }
  const normalized = normalizeSkillRuntimeShape(state.skillRuntime, defsInput);
  state.skillRuntime = normalized;
  return normalized;
}

function getRuntimePawnModifierEntry(runtime, pawnId, create = false) {
  if (!runtime || typeof runtime !== "object") return null;
  if (!runtime.modifiers || typeof runtime.modifiers !== "object") {
    if (!create) return null;
    runtime.modifiers = {
      global: normalizeModifierEntry(
        null,
        GLOBAL_SKILL_MOD_KEYS,
        GLOBAL_SKILL_MOD_DEFAULTS
      ),
      pawnById: {},
    };
  }
  if (!runtime.modifiers.pawnById || typeof runtime.modifiers.pawnById !== "object") {
    if (!create) return null;
    runtime.modifiers.pawnById = {};
  }
  const pawnKey = getPawnRuntimeKey(pawnId);
  if (!pawnKey) return null;
  if (!runtime.modifiers.pawnById[pawnKey]) {
    if (!create) return null;
    runtime.modifiers.pawnById[pawnKey] = normalizeModifierEntry(
      null,
      PAWN_SKILL_MOD_KEYS,
      PAWN_SKILL_MOD_DEFAULTS
    );
  }
  return runtime.modifiers.pawnById[pawnKey];
}

export function ensureSkillRuntimeState(state, defsInput = null) {
  return withRuntimeSkillState(state, defsInput);
}

export function addGlobalSkillModifier(state, key, amount) {
  if (typeof key !== "string" || !Number.isFinite(amount)) return false;
  const runtime = withRuntimeSkillState(state);
  const current = Number.isFinite(runtime.modifiers.global?.[key])
    ? runtime.modifiers.global[key]
    : getRuntimeModifierDefault("global", key);
  const next = current + amount;
  runtime.modifiers.global[key] = next;
  return next !== current;
}

export function multiplyGlobalSkillModifier(state, key, factor) {
  if (typeof key !== "string" || !Number.isFinite(factor)) return false;
  const runtime = withRuntimeSkillState(state);
  const current = Number.isFinite(runtime.modifiers.global?.[key])
    ? runtime.modifiers.global[key]
    : getRuntimeMultiplierFallback("global", key);
  const next = current * factor;
  runtime.modifiers.global[key] = next;
  return next !== current;
}

export function addPawnSkillModifier(state, pawnId, key, amount) {
  if (typeof key !== "string" || !Number.isFinite(amount)) return false;
  const runtime = withRuntimeSkillState(state);
  const entry = getRuntimePawnModifierEntry(runtime, pawnId, true);
  if (!entry) return false;
  const current = Number.isFinite(entry[key])
    ? entry[key]
    : getRuntimeModifierDefault("pawn", key);
  const next = current + amount;
  entry[key] = next;
  return next !== current;
}

export function multiplyPawnSkillModifier(state, pawnId, key, factor) {
  if (typeof key !== "string" || !Number.isFinite(factor)) return false;
  const runtime = withRuntimeSkillState(state);
  const entry = getRuntimePawnModifierEntry(runtime, pawnId, true);
  if (!entry) return false;
  const current = Number.isFinite(entry[key])
    ? entry[key]
    : getRuntimeMultiplierFallback("pawn", key);
  const next = current * factor;
  entry[key] = next;
  return next !== current;
}

export function grantSkillRecipeUnlock(state, recipeId) {
  if (typeof recipeId !== "string" || !recipeDefs[recipeId]) return false;
  const runtime = withRuntimeSkillState(state);
  const recipes = Array.isArray(runtime.unlocks?.recipes) ? runtime.unlocks.recipes : [];
  if (recipes.includes(recipeId)) return false;
  recipes.push(recipeId);
  recipes.sort((a, b) => a.localeCompare(b));
  runtime.unlocks.recipes = recipes;
  return true;
}

export function revokeSkillRecipeUnlock(state, recipeId) {
  if (typeof recipeId !== "string") return false;
  const runtime = withRuntimeSkillState(state);
  const recipes = Array.isArray(runtime.unlocks?.recipes) ? runtime.unlocks.recipes : [];
  const next = recipes.filter((id) => id !== recipeId);
  if (next.length === recipes.length) return false;
  runtime.unlocks.recipes = next;
  return true;
}

export function grantSkillHubStructureUnlock(state, hubStructureId) {
  if (typeof hubStructureId !== "string" || !hubStructureDefs[hubStructureId]) {
    return false;
  }
  const runtime = withRuntimeSkillState(state);
  const hubs = Array.isArray(runtime.unlocks?.hubStructures)
    ? runtime.unlocks.hubStructures
    : [];
  if (hubs.includes(hubStructureId)) return false;
  hubs.push(hubStructureId);
  hubs.sort((a, b) => a.localeCompare(b));
  runtime.unlocks.hubStructures = hubs;
  return true;
}

export function revokeSkillHubStructureUnlock(state, hubStructureId) {
  if (typeof hubStructureId !== "string") return false;
  const runtime = withRuntimeSkillState(state);
  const hubs = Array.isArray(runtime.unlocks?.hubStructures)
    ? runtime.unlocks.hubStructures
    : [];
  const next = hubs.filter((id) => id !== hubStructureId);
  if (next.length === hubs.length) return false;
  runtime.unlocks.hubStructures = next;
  return true;
}

function grantSkillTagUnlock(state, tagId, unlockKey, defs) {
  if (typeof tagId !== "string" || !defs[tagId]) return false;
  const runtime = withRuntimeSkillState(state);
  const unlocked = Array.isArray(runtime.unlocks?.[unlockKey]) ? runtime.unlocks[unlockKey] : [];
  if (unlocked.includes(tagId)) return false;
  unlocked.push(tagId);
  unlocked.sort((a, b) => a.localeCompare(b));
  runtime.unlocks[unlockKey] = unlocked;
  return true;
}

function revokeSkillTagUnlock(state, tagId, unlockKey) {
  if (typeof tagId !== "string") return false;
  const runtime = withRuntimeSkillState(state);
  const unlocked = Array.isArray(runtime.unlocks?.[unlockKey]) ? runtime.unlocks[unlockKey] : [];
  const next = unlocked.filter((id) => id !== tagId);
  if (next.length === unlocked.length) return false;
  runtime.unlocks[unlockKey] = next;
  return true;
}

export function grantSkillEnvTagUnlock(state, tagId) {
  return grantSkillTagUnlock(state, tagId, "envTags", envTagDefs);
}

export function revokeSkillEnvTagUnlock(state, tagId) {
  return revokeSkillTagUnlock(state, tagId, "envTags");
}

export function grantSkillHubTagUnlock(state, tagId) {
  return grantSkillTagUnlock(state, tagId, "hubTags", hubTagDefs);
}

export function revokeSkillHubTagUnlock(state, tagId) {
  return revokeSkillTagUnlock(state, tagId, "hubTags");
}

export function grantSkillItemTagUnlock(state, tagId) {
  return grantSkillTagUnlock(state, tagId, "itemTags", itemTagDefs);
}

export function revokeSkillItemTagUnlock(state, tagId) {
  return revokeSkillTagUnlock(state, tagId, "itemTags");
}

export function grantSkillFeatureUnlock(state, featureId) {
  if (
    typeof featureId !== "string" ||
    !featureId.length ||
    !skillFeatureUnlockDefs[featureId]
  ) {
    return false;
  }
  const runtime = withRuntimeSkillState(state);
  const unlocked = Array.isArray(runtime.unlocks?.features)
    ? runtime.unlocks.features
    : [];
  if (unlocked.includes(featureId)) return false;
  unlocked.push(featureId);
  unlocked.sort((a, b) => a.localeCompare(b));
  runtime.unlocks.features = unlocked;
  return true;
}

export function revokeSkillFeatureUnlock(state, featureId) {
  if (typeof featureId !== "string") return false;
  const runtime = withRuntimeSkillState(state);
  const unlocked = Array.isArray(runtime.unlocks?.features)
    ? runtime.unlocks.features
    : [];
  const next = unlocked.filter((id) => id !== featureId);
  if (next.length === unlocked.length) return false;
  runtime.unlocks.features = next;
  return true;
}

export function getGlobalSkillModifier(state, key, fallback = 0) {
  const value = computeGlobalSkillMods(state)?.[key];
  if (Number.isFinite(value)) return value;
  if (Object.prototype.hasOwnProperty.call(GLOBAL_SKILL_MOD_DEFAULTS, key)) {
    return GLOBAL_SKILL_MOD_DEFAULTS[key];
  }
  return fallback;
}

export function getPawnSkillModifier(state, pawnId, key, fallback = 0) {
  const value = computePawnSkillMods(state, pawnId)?.[key];
  if (Number.isFinite(value)) return value;
  if (Object.prototype.hasOwnProperty.call(PAWN_SKILL_MOD_DEFAULTS, key)) {
    return PAWN_SKILL_MOD_DEFAULTS[key];
  }
  return fallback;
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

export function getUnlockedSkillSet(state, pawnId) {
  const pawn = getPawnById(state, pawnId);
  if (!pawn) return new Set();
  return new Set(uniqueSortedStrings(pawn.unlockedSkillNodeIds));
}

export function hasUnlockedSkillNode(state, pawnId, nodeId) {
  if (typeof nodeId !== "string" || !nodeId.length) return false;
  const unlockedSet = getUnlockedSkillSet(state, pawnId);
  return unlockedSet.has(nodeId);
}

export function getLeaderInventorySectionCapabilities(state, leaderPawnId) {
  const leaderPawn = getPawnById(state, leaderPawnId);
  if (!leaderPawn || leaderPawn.role !== "leader") {
    return {
      equipment: false,
      systems: false,
      prestige: false,
      workers: false,
      skills: false,
      build: false,
    };
  }

  const availability = computeAvailableRecipesAndBuildings(state);
  return {
    equipment: true,
    systems: true,
    prestige: hasSkillFeatureUnlock(state, "ui.inventory.prestige"),
    workers: hasSkillFeatureUnlock(state, "ui.inventory.prestige"),
    skills: hasSkillFeatureUnlock(state, "ui.inventory.skills"),
    build: availability.hubStructureIds.size > 0,
  };
}

export function evaluateSkillNodeUnlock(state, pawnId, nodeId, opts = {}) {
  const pawn = getPawnById(state, pawnId);
  if (!pawn) return { ok: false, reason: "noPawn" };

  const nodeDef = getSkillNodeDef(null, nodeId);
  if (!nodeDef) return { ok: false, reason: "unknownNode" };

  const treeDef = getSkillTreeDef(nodeDef.treeId);
  if (!treeDef) return { ok: false, reason: "unknownTree" };

  const unlockedSet =
    opts.unlockedSet instanceof Set
      ? new Set(opts.unlockedSet)
      : getUnlockedSkillSet(state, pawnId);

  if (unlockedSet.has(nodeDef.id)) {
    return { ok: false, reason: "alreadyUnlocked", nodeDef, treeDef };
  }

  const cost = getNodeCost(nodeDef);
  const points = Number.isFinite(opts.skillPoints)
    ? Math.max(0, Math.floor(opts.skillPoints))
    : Math.max(0, toSafeInt(pawn.skillPoints, 0));

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

export function getUnlockableSkillNodes(state, pawnId, treeId = null) {
  const trees = getSkillTrees();
  const treeIds = treeId ? [treeId] : sortStrings(Object.keys(trees || {}));

  const unlockable = [];
  for (const id of treeIds) {
    const nodes = getTreeNodes(id);
    for (const node of nodes) {
      const check = evaluateSkillNodeUnlock(state, pawnId, node.id);
      if (check.ok) unlockable.push(node.id);
    }
  }
  return sortStrings(unlockable);
}

export function computePawnSkillMods(state, pawnId) {
  const out = {
    forageTierBonus: 0,
    forageStaminaCostDelta: 0,
    farmingStaminaCostDelta: 0,
    restStaminaBonusFlat: 0,
    restStaminaBonusMult: 1,
  };

  const runtime = withRuntimeSkillState(state);
  const runtimeEntry = getRuntimePawnModifierEntry(runtime, pawnId, false);
  if (runtimeEntry) {
    if (Number.isFinite(runtimeEntry.forageTierBonus)) {
      out.forageTierBonus += Math.floor(runtimeEntry.forageTierBonus);
    }
    if (Number.isFinite(runtimeEntry.forageStaminaCostDelta)) {
      out.forageStaminaCostDelta += Math.floor(runtimeEntry.forageStaminaCostDelta);
    }
    if (Number.isFinite(runtimeEntry.farmingStaminaCostDelta)) {
      out.farmingStaminaCostDelta += Math.floor(runtimeEntry.farmingStaminaCostDelta);
    }
    if (Number.isFinite(runtimeEntry.restStaminaBonusFlat)) {
      out.restStaminaBonusFlat += Math.floor(runtimeEntry.restStaminaBonusFlat);
    }
    if (Number.isFinite(runtimeEntry.restStaminaBonusMult)) {
      out.restStaminaBonusMult *= runtimeEntry.restStaminaBonusMult;
    }
  }

  const targetPawn = getPawnById(state, pawnId);
  const equipment =
    targetPawn?.equipment && typeof targetPawn.equipment === "object"
      ? targetPawn.equipment
      : null;
  if (equipment) {
    for (const item of Object.values(equipment)) {
      if (!item || typeof item !== "object") continue;
      const effects = getEquippedItemEffects(item);
      for (const effect of effects) {
        if (effect?.scope !== "pawn") continue;
        applyDerivedModifierEffect(out, effect, "pawn", PAWN_SKILL_MOD_KEY_SET);
      }
    }
  }

  out.restStaminaBonusMult = Math.max(0, out.restStaminaBonusMult);
  return out;
}

export function computeGlobalSkillMods(state) {
  const runtime = withRuntimeSkillState(state);
  const defsInput = getStateSkillDefsInput(state);

  const out = {
    apCapBonus: 0,
    editableHistoryWindowBonusSec: 0,
    projectionHorizonBonusSec: 0,
    populationFoodMult: 1,
    unlockedRecipes: new Set(getDefaultUnlockedRecipes(defsInput)),
    unlockedHubStructures: new Set(getDefaultUnlockedHubStructures(defsInput)),
    unlockedEnvTags: new Set(getDefaultUnlockedEnvTags(defsInput)),
    unlockedHubTags: new Set(getDefaultUnlockedHubTags(defsInput)),
    unlockedFeatures: new Set(getDefaultUnlockedFeatures(defsInput)),
    unlockedItemTags: new Set(getDefaultUnlockedItemTags(defsInput)),
  };

  const runtimeGlobal = runtime?.modifiers?.global ?? null;
  if (runtimeGlobal) {
    if (Number.isFinite(runtimeGlobal.apCapBonus)) {
      out.apCapBonus += Math.floor(runtimeGlobal.apCapBonus);
    }
    if (Number.isFinite(runtimeGlobal.editableHistoryWindowBonusSec)) {
      out.editableHistoryWindowBonusSec += Math.floor(
        runtimeGlobal.editableHistoryWindowBonusSec
      );
    }
    if (Number.isFinite(runtimeGlobal.projectionHorizonBonusSec)) {
      out.projectionHorizonBonusSec += Math.floor(runtimeGlobal.projectionHorizonBonusSec);
    }
    if (Number.isFinite(runtimeGlobal.populationFoodMult)) {
      out.populationFoodMult *= runtimeGlobal.populationFoodMult;
    }
  }

  const runtimeUnlocks = runtime?.unlocks ?? null;
  if (runtimeUnlocks) {
    for (const recipeId of runtimeUnlocks.recipes || []) {
      if (recipeDefs[recipeId]) out.unlockedRecipes.add(recipeId);
    }
    for (const hubId of runtimeUnlocks.hubStructures || []) {
      if (hubStructureDefs[hubId]) out.unlockedHubStructures.add(hubId);
    }
    for (const tagId of runtimeUnlocks.envTags || []) {
      if (envTagDefs[tagId]) out.unlockedEnvTags.add(tagId);
    }
    for (const tagId of runtimeUnlocks.hubTags || []) {
      if (hubTagDefs[tagId]) out.unlockedHubTags.add(tagId);
    }
    for (const featureId of runtimeUnlocks.features || []) {
      if (skillFeatureUnlockDefs[featureId]) out.unlockedFeatures.add(featureId);
    }
    for (const tagId of runtimeUnlocks.itemTags || []) {
      if (itemTagDefs[tagId]) out.unlockedItemTags.add(tagId);
    }
  }

  forEachEquippedItemEffect(state, (effect) => {
    if (effect?.scope === "pawn") return;
    applyDerivedModifierEffect(out, effect, "global", GLOBAL_SKILL_MOD_KEY_SET);
  });

  out.editableHistoryWindowBonusSec = Math.max(
    0,
    Math.floor(out.editableHistoryWindowBonusSec)
  );
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

export function hasEnvTagUnlock(state, tagId) {
  if (typeof tagId !== "string" || !tagId.length || !envTagDefs[tagId]) return false;
  const globalMods = computeGlobalSkillMods(state);
  return globalMods.unlockedEnvTags.has(tagId);
}

export function hasHubTagUnlock(state, tagId) {
  if (typeof tagId !== "string" || !tagId.length || !hubTagDefs[tagId]) return false;
  const globalMods = computeGlobalSkillMods(state);
  return globalMods.unlockedHubTags.has(tagId);
}

export function hasItemTagUnlock(state, tagId) {
  if (typeof tagId !== "string" || !tagId.length || !itemTagDefs[tagId]) return false;
  const globalMods = computeGlobalSkillMods(state);
  return globalMods.unlockedItemTags.has(tagId);
}

export function hasSkillFeatureUnlock(state, featureId) {
  if (
    typeof featureId !== "string" ||
    !featureId.length ||
    !skillFeatureUnlockDefs[featureId]
  ) {
    return false;
  }
  const globalMods = computeGlobalSkillMods(state);
  return globalMods.unlockedFeatures.has(featureId);
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

function computeTreeDepthByNodeId(treeId, defsInput = null) {
  const treeDef = getSkillTreeDef(treeId, defsInput);
  if (!treeDef) return {};

  const nodes = getTreeNodes(treeId, defsInput);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const depthByNodeId = {};
  if (!nodeById.has(treeDef.startNodeId)) return depthByNodeId;

  const queue = [treeDef.startNodeId];
  depthByNodeId[treeDef.startNodeId] = 0;
  while (queue.length > 0) {
    const nodeId = queue.shift();
    const nodeDef = nodeById.get(nodeId);
    if (!nodeDef) continue;
    const depth = toSafeInt(depthByNodeId[nodeId], 0);
    for (const adjId of getAdjacentNodeIds(nodeDef)) {
      if (!nodeById.has(adjId)) continue;
      if (Object.prototype.hasOwnProperty.call(depthByNodeId, adjId)) continue;
      depthByNodeId[adjId] = depth + 1;
      queue.push(adjId);
    }
  }

  let maxDepth = -1;
  for (const value of Object.values(depthByNodeId)) {
    const depth = toSafeInt(value, -1);
    if (depth > maxDepth) maxDepth = depth;
  }
  const disconnectedDepth = maxDepth + 1;
  for (const nodeId of nodeById.keys()) {
    if (Object.prototype.hasOwnProperty.call(depthByNodeId, nodeId)) continue;
    depthByNodeId[nodeId] = disconnectedDepth;
  }

  return depthByNodeId;
}

export function getDeterministicSkillCommitOrder(treeId, nodeIds, defsInput = null) {
  const list = uniqueSortedStrings(nodeIds);
  const depthByNodeId = computeTreeDepthByNodeId(treeId, defsInput);
  return list.sort((a, b) => {
    const da = toSafeInt(depthByNodeId?.[a], 9999);
    const db = toSafeInt(depthByNodeId?.[b], 9999);
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });
}

export function validateSkillDefs(defsInput = null) {
  const trees = defsInput?.skillTrees ?? skillTrees;
  const nodes = defsInput?.skillNodes ?? skillNodes;
  const recipes = defsInput?.recipeDefs ?? recipeDefs;
  const hubs = defsInput?.hubStructureDefs ?? hubStructureDefs;
  const envTags = defsInput?.envTagDefs ?? envTagDefs;
  const hubTags = defsInput?.hubTagDefs ?? hubTagDefs;
  const featureUnlocks = defsInput?.skillFeatureUnlockDefs ?? skillFeatureUnlockDefs;
  const itemTags = defsInput?.itemTagDefs ?? itemTagDefs;
  return validateSkillDefsRegistry({
    skillTrees: trees,
    skillNodes: nodes,
    recipeDefs: recipes,
    hubStructureDefs: hubs,
    envTagDefs: envTags,
    hubTagDefs: hubTags,
    skillFeatureUnlockDefs: featureUnlocks,
    itemTagDefs: itemTags,
  });
}
