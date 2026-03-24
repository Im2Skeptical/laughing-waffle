// hub-exec.js
// Per-second hub structure execution (passives + intents).

import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import {
  ensureRecipePriorityState,
  getEnabledRecipeIds,
  isRecipeSystem,
} from "./recipe-priority.js";
import {
  INITIAL_POPULATION_DEFAULT,
  POPULATION_ATTRACTION_PER_VACANCY_PER_YEAR,
  POPULATION_GROWTH_FULL_FEED_RATE,
  POPULATION_COLLAPSE_ALL_FAIL_MULTIPLIER,
  YEAR_END_SKILL_POINTS_NO_POPULATION_CHANGE,
  YEAR_END_SKILL_POINTS_POPULATION_CHANGE,
  YEAR_END_SKILL_POINTS_POPULATION_HALVING,
  FAITH_STARTING_TIER,
  FAITH_GROWTH_STREAK_FOR_UPGRADE,
  SEASON_DISPLAY,
} from "../defs/gamesettings/gamerules-defs.js";
import {
  getCurrentSeasonKey,
  ensurePawnSystems,
  syncPhaseToPaused,
} from "./state.js";
import { runEffect } from "./effects/index.js";
import { resolveCosts, canAffordCosts, applyCosts } from "./costs.js";
import {
  PAWN_ROLE_LEADER,
  getLeaderById,
  getPawnEffectiveWorkUnits,
} from "./prestige-system.js";
import { pushGameEvent } from "./event-feed.js";
import { TIER_ASC } from "./effects/core/tiers.js";
import {
  getProcessDefForInstance,
  getTemplateProcessForSystem,
  ensureProcessRoutingState,
  ensureSystemRoutingTemplate,
  listCandidateEndpoints,
  resolveEndpointTarget,
  resolveFixedEndpointId,
  canConsumeRequirementUnit,
  consumeRequirementUnit,
  isDropEndpoint,
} from "./process-framework.js";
import { canOwnerAcceptItem } from "./commands.js";
import { computeGlobalSkillMods, getGlobalSkillModifier } from "./skills.js";
import { passiveTimingPasses } from "./passive-timing.js";

function hasProcess(structure, systemId, type) {
  const sys = structure?.systemState?.[systemId];
  const processes = Array.isArray(sys?.processes) ? sys.processes : [];
  if (!type) return processes.length > 0;
  return processes.some((p) => p && p.type === type);
}

function resolveProcessTypesFromPriorityState(structure, systemId, key) {
  if (!structure || !systemId || !key) return [];
  const systemState = structure?.systemState?.[systemId];
  if (!systemState || typeof systemState !== "object") return [];
  const raw = systemState[key];
  if (!raw || typeof raw !== "object") return [];
  if (isRecipeSystem(systemId) && key === "recipePriority") {
    const priority = ensureRecipePriorityState(systemState, {
      systemId,
      state: null,
      includeLocked: true,
    });
    return getEnabledRecipeIds(priority);
  }
  const ordered = Array.isArray(raw.ordered) ? raw.ordered : [];
  const enabled =
    raw.enabled && typeof raw.enabled === "object" ? raw.enabled : {};
  const out = [];
  for (const entry of ordered) {
    const processType =
      typeof entry === "string" && entry.length > 0 ? entry : null;
    if (!processType) continue;
    if (enabled[processType] === false) continue;
    if (out.includes(processType)) continue;
    out.push(processType);
  }
  return out;
}

function requirementsPass(requires, seasonKey, structure, hasPawn, isTagUnlocked = null) {
  if (!requires || typeof requires !== "object") return true;

  if (Array.isArray(requires.season) && requires.season.length > 0) {
    if (!seasonKey || !requires.season.includes(seasonKey)) return false;
  }

  if (typeof requires.hasPawn === "boolean") {
    if (requires.hasPawn !== hasPawn) return false;
  }

  if (typeof requires.hasSelectedCrop === "boolean") {
    const selectedCropId = structure?.systemState?.growth?.selectedCropId;
    const hasSelected =
      typeof selectedCropId === "string" && selectedCropId.length > 0;
    if (requires.hasSelectedCrop !== hasSelected) return false;
  }

  if (Array.isArray(requires.selectedCropIdIn)) {
    const selectedCropId = structure?.systemState?.growth?.selectedCropId;
    if (
      requires.selectedCropIdIn.length > 0 &&
      (typeof selectedCropId !== "string" ||
        !requires.selectedCropIdIn.includes(selectedCropId))
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(requires, "hasEquipment")) {
    return false;
  }

  if (typeof requires.hasMaturedPool === "boolean") {
    const pool = structure?.systemState?.growth?.maturedPool;
    const selectedCropId = structure?.systemState?.growth?.selectedCropId ?? null;
    const hasPool = hasMaturedPoolForCrop(pool, selectedCropId);
    if (requires.hasMaturedPool !== hasPool) return false;
  }

  const processSystem =
    typeof requires.processSystem === "string" ? requires.processSystem : null;
  const processTypePriorityKey =
    typeof requires.processTypeFromSystemPriorityKey === "string"
      ? requires.processTypeFromSystemPriorityKey
      : null;
  const processTypeKey =
    typeof requires.processTypeFromSystemKey === "string"
      ? requires.processTypeFromSystemKey
      : "selectedRecipeId";
  const selectedProcessTypes = processTypePriorityKey
    ? resolveProcessTypesFromPriorityState(
        structure,
        processSystem,
        processTypePriorityKey
      )
    : [];
  const selectedProcessType =
    selectedProcessTypes.length > 0
      ? selectedProcessTypes[0]
      : processSystem && structure?.systemState?.[processSystem]
        ? structure.systemState[processSystem][processTypeKey]
        : null;
  const hasSelectedRecipe =
    typeof selectedProcessType === "string" && selectedProcessType.length > 0;

  if (typeof requires.hasSelectedRecipe === "boolean") {
    if (requires.hasSelectedRecipe !== hasSelectedRecipe) return false;
  }

  if (requires.hasSelectedProcessType === true) {
    if (!hasSelectedRecipe) return false;
    if (selectedProcessTypes.length > 0) {
      let hasAny = false;
      for (const type of selectedProcessTypes) {
        if (hasProcess(structure, processSystem, type)) {
          hasAny = true;
          break;
        }
      }
      if (!hasAny) return false;
    } else if (!hasProcess(structure, processSystem, selectedProcessType)) {
      return false;
    }
  }

  if (requires.noSelectedProcessType === true) {
    if (selectedProcessTypes.length > 0) {
      for (const type of selectedProcessTypes) {
        if (hasProcess(structure, processSystem, type)) return false;
      }
    } else if (
      hasSelectedRecipe &&
      hasProcess(structure, processSystem, selectedProcessType)
    ) {
      return false;
    }
  }

  const tagReq = requires.hasTag;
  if (tagReq != null) {
    const structureTags = Array.isArray(structure?.tags) ? structure.tags : [];
    const requiredTags = Array.isArray(tagReq)
      ? tagReq
      : typeof tagReq === "string"
        ? [tagReq]
        : [];

    for (const tag of requiredTags) {
      if (!structureTags.includes(tag)) return false;
      if (isTagUnlocked && !isTagUnlocked(tag)) return false;
    }
  }

  // processSystem already derived above for recipe checks.
  if (processSystem) {
    if (requires.hasProcessType) {
      const types = Array.isArray(requires.hasProcessType)
        ? requires.hasProcessType
        : [requires.hasProcessType];
      for (const type of types) {
        if (!hasProcess(structure, processSystem, type)) return false;
      }
    }
    if (requires.noProcessType) {
      const types = Array.isArray(requires.noProcessType)
        ? requires.noProcessType
        : [requires.noProcessType];
      for (const type of types) {
        if (hasProcess(structure, processSystem, type)) return false;
      }
    }
  }

  return true;
}

function hasTieredUnits(pool) {
  if (!pool || typeof pool !== "object") return false;
  return (
    (pool.bronze ?? 0) > 0 ||
    (pool.silver ?? 0) > 0 ||
    (pool.gold ?? 0) > 0 ||
    (pool.diamond ?? 0) > 0
  );
}

function resolveMaturedPoolBucket(pool, cropId) {
  if (!pool || typeof pool !== "object") return null;
  const hasTierKeys =
    Object.prototype.hasOwnProperty.call(pool, "bronze") ||
    Object.prototype.hasOwnProperty.call(pool, "silver") ||
    Object.prototype.hasOwnProperty.call(pool, "gold") ||
    Object.prototype.hasOwnProperty.call(pool, "diamond");
  if (hasTierKeys) return pool;
  if (typeof cropId !== "string" || cropId.length <= 0) return null;
  const bucket = pool[cropId];
  return bucket && typeof bucket === "object" ? bucket : null;
}

function hasMaturedPoolForCrop(pool, cropId) {
  const bucket = resolveMaturedPoolBucket(pool, cropId);
  if (bucket) return hasTieredUnits(bucket);
  if (!pool || typeof pool !== "object") return false;
  for (const value of Object.values(pool)) {
    if (!value || typeof value !== "object") continue;
    if (hasTieredUnits(value)) return true;
  }
  return false;
}

function isTagDisabled(structure, tagId, isTagUnlocked = null) {
  if (!structure || !tagId) return false;
  if (isTagUnlocked && !isTagUnlocked(tagId)) return true;
  const entry = structure.tagStates?.[tagId];
  return entry?.disabled === true;
}

function buildHubPassiveKey(structure, tagId, passive, passiveIndex) {
  const passiveId =
    typeof passive?.id === "string" && passive.id.length > 0
      ? passive.id
      : `idx${passiveIndex}`;
  const ownerId =
    Number.isFinite(structure?.instanceId) || typeof structure?.instanceId === "string"
      ? structure.instanceId
      : "unknown";
  return `hub:${ownerId}:tag:${tagId}:passive:${passiveId}`;
}

function getPawnsOnHubAnchor(state, anchor) {
  const out = [];
  if (!anchor) return out;
  const col = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : null;
  const span =
    Number.isFinite(anchor.span) && anchor.span > 0
      ? Math.floor(anchor.span)
      : 1;
  if (col == null) return out;
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const maxCol = col + span - 1;
  for (const pawn of pawns) {
    if (!pawn) continue;
    if (Number.isFinite(pawn.envCol)) continue;
    const pawnCol = Number.isFinite(pawn.hubCol) ? Math.floor(pawn.hubCol) : null;
    if (pawnCol == null) continue;
    if (pawnCol < col || pawnCol > maxCol) continue;
    out.push(pawn);
  }
  return out;
}

function getContributingPawns(state, structure) {
  const pawns = getPawnsOnHubAnchor(state, structure);
  const contributors = [];
  for (const pawn of pawns) {
    if (!pawn) continue;
    ensurePawnSystems(pawn);
    const stamina = pawn.systemState?.stamina;
    const cur = Number.isFinite(stamina?.cur) ? Math.floor(stamina.cur) : 0;
    if (cur <= 0) continue;
    contributors.push(pawn);
  }
  return contributors;
}

function normalizeDepositConfig(structure) {
  if (!structure || !structure.defId) return null;
  const def = hubStructureDefs?.[structure.defId];
  const deposit = def?.deposit;
  if (!deposit || typeof deposit !== "object") return null;
  const systemId =
    typeof deposit.systemId === "string" ? deposit.systemId : null;
  if (!systemId) return null;
  const poolKey =
    typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
      ? deposit.poolKey
      : "byKindTier";
  const allowedTags = Array.isArray(deposit.allowedTags)
    ? deposit.allowedTags.filter((tag) => typeof tag === "string" && tag.length > 0)
    : [];
  const allowedItemIds = Array.isArray(deposit.allowedItemIds)
    ? deposit.allowedItemIds.filter(
        (id) => typeof id === "string" && id.length > 0
      )
    : [];
  const allowAny = deposit.allowAny === true;
  const storeDeposits = deposit.storeDeposits !== false;
  const prestigeCurveMultiplier =
    Number.isFinite(deposit.prestigeCurveMultiplier) &&
    deposit.prestigeCurveMultiplier > 0
      ? deposit.prestigeCurveMultiplier
      : 1;
  return {
    systemId,
    poolKey,
    allowedTags,
    allowedItemIds,
    allowAny,
    storeDeposits,
    prestigeCurveMultiplier,
  };
}

function ensureHubSystemState(structure, systemId) {
  if (!structure || !systemId) return null;
  if (!structure.systemState || typeof structure.systemState !== "object") {
    structure.systemState = {};
  }
  if (!structure.systemTiers || typeof structure.systemTiers !== "object") {
    structure.systemTiers = {};
  }
  if (structure.systemTiers[systemId] == null) {
    const def = hubSystemDefs?.[systemId];
    const structureTier =
      typeof structure.tier === "string" ? structure.tier : null;
    if (structureTier) {
      structure.systemTiers[systemId] = structureTier;
    } else if (def?.defaultTier != null) {
      structure.systemTiers[systemId] = def.defaultTier;
    }
  }
  if (!structure.systemState[systemId]) {
    const def = hubSystemDefs?.[systemId];
    if (def?.stateDefaults) {
      structure.systemState[systemId] = JSON.parse(
        JSON.stringify(def.stateDefaults)
      );
    } else {
      structure.systemState[systemId] = {};
    }
  }
  return structure.systemState[systemId];
}

function ensureDepositQueue(structure) {
  const depositState = ensureHubSystemState(structure, "deposit");
  if (!depositState) return [];
  if (!Array.isArray(depositState.processes)) {
    depositState.processes = [];
  }
  return depositState.processes;
}

function itemMatchesDepositFilter(item, depositConfig) {
  if (!item || !depositConfig) return false;
  const qty = Math.max(0, Math.floor(item.quantity ?? 0));
  if (qty <= 0) return false;
  const allowAny = depositConfig.allowAny === true;
  const allowedItemIds = depositConfig.allowedItemIds || [];
  const allowedTags = depositConfig.allowedTags || [];
  if (allowAny && allowedItemIds.length === 0 && allowedTags.length === 0) {
    return true;
  }
  if (allowedItemIds.length > 0 && allowedItemIds.includes(item.kind)) {
    return true;
  }
  if (allowedTags.length > 0) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    for (const tag of allowedTags) {
      if (tags.includes(tag)) return true;
    }
  }
  return allowAny;
}

function countDepositableByKind(inv, depositConfig) {
  if (!inv || !Array.isArray(inv.items) || !depositConfig) return {};
  const totals = {};
  for (const item of inv.items) {
    if (!itemMatchesDepositFilter(item, depositConfig)) continue;
    const qty = Math.max(0, Math.floor(item.quantity ?? 0));
    if (qty <= 0) continue;
    const kind = item.kind;
    if (!kind) continue;
    totals[kind] = Math.max(0, Math.floor(totals[kind] ?? 0)) + qty;
  }
  return totals;
}

function buildDepositRequirements(kindTotals) {
  const kinds = Object.keys(kindTotals || {});
  kinds.sort((a, b) => a.localeCompare(b));
  const reqs = [];
  for (const kind of kinds) {
    const qty = Math.max(0, Math.floor(kindTotals[kind] ?? 0));
    if (qty <= 0) continue;
    reqs.push({
      kind: "item",
      itemId: kind,
      amount: qty,
      progress: 0,
      consume: true,
      slotId: "items",
    });
  }
  return reqs;
}

function ensureDepositProcesses(state, structure, pawns, tSec, isTagUnlocked = null) {
  if (!state || !structure || !Array.isArray(pawns) || pawns.length === 0) {
    return false;
  }
  const depositConfig = normalizeDepositConfig(structure);
  if (!depositConfig) return false;

  ensureHubSystemState(structure, depositConfig.systemId);

  const processes = ensureDepositQueue(structure);
  let changed = false;

  for (const pawn of pawns) {
    if (!pawn) continue;
    const pawnInv = state?.ownerInventories?.[pawn.id] ?? null;
    if (!pawnInv) continue;

    const kindTotals = countDepositableByKind(pawnInv, depositConfig);
    const totalUnits = Object.values(kindTotals).reduce(
      (sum, value) => sum + Math.max(0, Math.floor(value ?? 0)),
      0
    );
    if (totalUnits <= 0) continue;

    const hasExisting = processes.some(
      (proc) => proc?.type === "depositItems" && proc?.ownerId === pawn.id
    );
    if (hasExisting) continue;

    const leader =
      pawn.role === PAWN_ROLE_LEADER
        ? pawn
        : pawn.leaderId != null
        ? getLeaderById(state, pawn.leaderId)
        : null;
    const hasLeader = leader && leader.role === PAWN_ROLE_LEADER;
    const communal =
      Array.isArray(structure.tags) &&
      structure.tags.includes("communal") &&
      !isTagDisabled(structure, "communal", isTagUnlocked);

    const requirements = buildDepositRequirements(kindTotals);
    if (requirements.length === 0) continue;

    const outputs = [];
    if (depositConfig.storeDeposits) {
      outputs.push({
        kind: "pool",
        system: depositConfig.systemId,
        poolKey: depositConfig.poolKey,
        fromLedger: true,
        slotId: "pool",
      });
    }

    if (communal && hasLeader) {
      outputs.push({
        kind: "prestige",
        qty: totalUnits,
        slotId: "prestige",
        curveMultiplier: depositConfig.prestigeCurveMultiplier,
      });
    }

    runEffect(
      state,
      {
        op: "CreateWorkProcess",
        system: "deposit",
        queueKey: "processes",
        processType: "depositItems",
        mode: "time",
        durationSec: 1,
        requirements,
        outputs,
        processMeta: {
          ownerKind: "pawn",
          leaderId: hasLeader ? leader.id : null,
        },
      },
      {
        kind: "game",
        state,
        source: structure,
        tSec,
        ownerId: pawn.id,
        leaderId: hasLeader ? leader.id : null,
      }
    );

    changed = true;
  }

  return changed;
}

const DEFAULT_INPUT_SLOT_ID = "materials";
const DEFAULT_OUTPUT_SLOT_ID = "output";

function buildDummyItemForAcceptance(itemId, tier) {
  const def = itemDefs?.[itemId] || null;
  const tags = Array.isArray(def?.baseTags) ? def.baseTags.slice() : [];
  return {
    kind: itemId,
    tier: tier ?? def?.defaultTier ?? "bronze",
    tags,
  };
}

function resolveSlotDef(processDef, slotKind, slotId) {
  const kind = slotKind === "outputs" ? "outputs" : "inputs";
  const slots = processDef?.routingSlots?.[kind] ?? [];
  if (!Array.isArray(slots) || slots.length === 0) return null;
  if (slotId) {
    const match = slots.find((slot) => slot?.slotId === slotId);
    if (match) return match;
  }
  const fallbackId = kind === "outputs" ? DEFAULT_OUTPUT_SLOT_ID : DEFAULT_INPUT_SLOT_ID;
  const fallback = slots.find((slot) => slot?.slotId === fallbackId);
  return fallback || slots[0] || null;
}

function resolveSlotState(process, slotKind, slotDef) {
  if (!process?.routing || !slotDef) return null;
  const kind = slotKind === "outputs" ? "outputs" : "inputs";
  const container = process.routing[kind];
  if (!container || typeof container !== "object") return null;
  const state = container[slotDef.slotId];
  if (!state || typeof state !== "object") return null;
  if (!Array.isArray(state.ordered)) state.ordered = [];
  if (!state.enabled || typeof state.enabled !== "object") state.enabled = {};
  return state;
}

function resolveEndpointIdForRouting(endpointId, process, context) {
  if (!endpointId || typeof endpointId !== "string") return null;
  const resolved = resolveFixedEndpointId(endpointId, process, context);
  return resolved || endpointId;
}

function isEndpointValidForSlot(endpointId, candidates, processDef) {
  if (!endpointId) return false;
  if (isDropEndpoint(endpointId) && processDef?.supportsDropslot) return true;
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  return candidates.includes(endpointId);
}

function parseLeaderIdFromEndpoint(endpointId) {
  if (!endpointId || typeof endpointId !== "string") return null;
  if (!endpointId.startsWith("sys:pawn:")) return null;
  const raw = endpointId.slice("sys:pawn:".length);
  return raw.length ? raw : null;
}

function canOutputUseEndpoint(state, output, endpoint) {
  if (!output || !endpoint) return false;
  if (output.kind === "pool") {
    return endpoint.kind === "pool";
  }
  if (output.kind === "item") {
    if (endpoint.kind === "spawn") return true;
    if (endpoint.kind !== "inventory") return false;
    const dummy = buildDummyItemForAcceptance(output.itemId, output.tier);
    return canOwnerAcceptItem(state, endpoint.ownerId, dummy);
  }
  if (output.kind === "resource") {
    return endpoint.kind === "resource";
  }
  if (output.kind === "system") {
    return endpoint.kind === "system";
  }
  return false;
}

function canProcessOutputsProceed(state, structure, process, systemId) {
  if (!state || !structure || !process) return true;
  const processDef = getProcessDefForInstance(process, structure, {
    leaderId: process?.leaderId ?? null,
  });
  if (!processDef) return true;
  const policy =
    process?.completionPolicy ||
    processDef?.transform?.completionPolicy ||
    "none";
  if (policy !== "none") return true;
  const outputs = Array.isArray(processDef?.transform?.outputs)
    ? processDef.transform.outputs
    : [];
  if (!outputs.length) return true;

  ensureProcessRoutingState(process, processDef, {
    leaderId: process?.leaderId ?? null,
    target: structure,
    systemId,
  });

  for (const output of outputs) {
    if (!output || typeof output !== "object") continue;
    const slotDef = resolveSlotDef(processDef, "outputs", output.slotId);
    if (!slotDef) return false;
    const slotState = resolveSlotState(process, "outputs", slotDef);
    if (!slotState) return false;
    const candidates = listCandidateEndpoints(state, process, slotDef, structure, {
      leaderId: process?.leaderId ?? null,
    });
    const orderedList =
      slotState.ordered.length > 0 ? slotState.ordered : candidates;

    let canRoute = false;
    for (const endpointRaw of orderedList || []) {
      const enabled = slotState.enabled?.[endpointRaw];
      if (enabled === false) continue;
      const endpointId = resolveEndpointIdForRouting(endpointRaw, process, {
        leaderId: process?.leaderId ?? null,
      });
      if (!endpointId) continue;
      if (!isEndpointValidForSlot(endpointId, candidates, processDef)) continue;
      if (output.kind === "prestige") {
        const leaderId = parseLeaderIdFromEndpoint(endpointId);
        if (leaderId != null) {
          canRoute = true;
          break;
        }
        continue;
      }
      const endpoint = resolveEndpointTarget(state, endpointId);
      if (!endpoint) continue;
      if (canOutputUseEndpoint(state, output, endpoint)) {
        canRoute = true;
        break;
      }
    }

    if (!canRoute) return false;
  }

  return true;
}

function normalizePopulationCount(value, fallback = 0) {
  if (!Number.isFinite(value)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(value));
}

function getPopulationCount(state) {
  return normalizePopulationCount(
    state?.resources?.population,
    INITIAL_POPULATION_DEFAULT
  );
}

function setPopulationCount(state, population) {
  if (!state || typeof state !== "object") return;
  if (!state.resources || typeof state.resources !== "object") {
    state.resources = { gold: 0, grain: 0, food: 0, population: 0 };
  }
  state.resources.population = normalizePopulationCount(population, 0);
}

function ensurePopulationTrackerState(state) {
  if (!state || typeof state !== "object") return null;
  const currentYear = Number.isFinite(state.year)
    ? Math.max(1, Math.floor(state.year))
    : 1;
  if (
    !state.populationTracker ||
    typeof state.populationTracker !== "object"
  ) {
    state.populationTracker = {
      year: currentYear,
      mealAttempts: 0,
      mealSuccesses: 0,
      faithGrowthStreak: 0,
      attractionProgress: 0,
    };
  }
  const tracker = state.populationTracker;
  tracker.year = Number.isFinite(tracker.year)
    ? Math.max(1, Math.floor(tracker.year))
    : currentYear;
  tracker.mealAttempts = normalizePopulationCount(tracker.mealAttempts, 0);
  tracker.mealSuccesses = normalizePopulationCount(tracker.mealSuccesses, 0);
  tracker.faithGrowthStreak = normalizePopulationCount(
    tracker.faithGrowthStreak,
    0
  );
  tracker.attractionProgress = Number.isFinite(tracker.attractionProgress)
    ? Math.max(0, tracker.attractionProgress)
    : 0;
  if (tracker.mealSuccesses > tracker.mealAttempts) {
    tracker.mealSuccesses = tracker.mealAttempts;
  }
  return tracker;
}

function getStructureLabel(structure) {
  if (!structure) return "Housing";
  const def = hubStructureDefs?.[structure.defId];
  return def?.name || structure.defId || "Housing";
}

function getHousingCapacityForStructure(structure) {
  if (!structure) return 0;
  const def = hubStructureDefs?.[structure.defId];
  return normalizePopulationCount(def?.housing?.vacancy, 0);
}

function listActiveHousingStructures(anchors, isTagUnlocked = null) {
  const list = Array.isArray(anchors) ? anchors : [];
  const out = [];
  for (const structure of list) {
    if (!structure) continue;
    const tags = Array.isArray(structure.tags) ? structure.tags : [];
    if (!tags.includes("canHouse")) continue;
    if (isTagDisabled(structure, "canHouse", isTagUnlocked)) continue;
    out.push(structure);
  }
  return out;
}

function computeHousingStats(
  anchors,
  isTagUnlocked = null,
  population = 0
) {
  const activeHousingStructures = listActiveHousingStructures(
    anchors,
    isTagUnlocked
  );
  let housingCapacity = 0;
  for (const structure of activeHousingStructures) {
    housingCapacity += getHousingCapacityForStructure(structure);
  }
  const safePopulation = normalizePopulationCount(population, 0);
  return {
    activeHousingStructures,
    housingCapacity: normalizePopulationCount(housingCapacity, 0),
    housingVacancy: Math.max(0, housingCapacity - safePopulation),
    population: safePopulation,
  };
}

function syncHousingResidentsReport(
  anchors,
  isTagUnlocked = null,
  population = 0
) {
  const stats = computeHousingStats(anchors, isTagUnlocked, population);
  const list = Array.isArray(anchors) ? anchors : [];
  for (const structure of list) {
    if (!structure) continue;
    const tags = Array.isArray(structure.tags) ? structure.tags : [];
    if (!tags.includes("canHouse")) continue;
    const isActive = !isTagDisabled(structure, "canHouse", isTagUnlocked);
    const residents = ensureHubSystemState(structure, "residents");
    if (!residents) continue;
    residents.population = stats.population;
    residents.housingCapacity = stats.housingCapacity;
    residents.housingVacancy = stats.housingVacancy;
    residents.structureHousingCapacity = isActive
      ? getHousingCapacityForStructure(structure)
      : 0;
  }
  return stats;
}

function applyYearlyHousingAttraction(tracker, housingVacancy) {
  if (!tracker || typeof tracker !== "object") {
    return { attracted: 0, attractionProgress: 0 };
  }
  const vacancy = normalizePopulationCount(housingVacancy, 0);
  const attractionRate = Number.isFinite(POPULATION_ATTRACTION_PER_VACANCY_PER_YEAR)
    ? Math.max(0, POPULATION_ATTRACTION_PER_VACANCY_PER_YEAR)
    : 0;

  if (vacancy <= 0 || attractionRate <= 0) {
    tracker.attractionProgress = 0;
    return { attracted: 0, attractionProgress: tracker.attractionProgress };
  }

  const existingProgress = Number.isFinite(tracker.attractionProgress)
    ? Math.max(0, tracker.attractionProgress)
    : 0;
  const progressWithVacancy = existingProgress + vacancy * attractionRate;
  const attracted = Math.min(vacancy, Math.floor(progressWithVacancy));
  tracker.attractionProgress = Math.max(0, progressWithVacancy - attracted);

  return {
    attracted: normalizePopulationCount(attracted, 0),
    attractionProgress: tracker.attractionProgress,
  };
}

function getResidentsHousingStructure(anchors, isTagUnlocked = null) {
  return listActiveHousingStructures(anchors, isTagUnlocked)[0] ?? null;
}

function normalizeTierId(value, fallback = "bronze") {
  const defaultTier = TIER_ASC.includes(fallback)
    ? fallback
    : TIER_ASC[0] || "bronze";
  if (typeof value !== "string") return defaultTier;
  return TIER_ASC.includes(value) ? value : defaultTier;
}

function getFaithStartingTier() {
  return normalizeTierId(FAITH_STARTING_TIER, "gold");
}

function getFaithGrowthStreakThreshold() {
  const raw = Number.isFinite(FAITH_GROWTH_STREAK_FOR_UPGRADE)
    ? Math.floor(FAITH_GROWTH_STREAK_FOR_UPGRADE)
    : 3;
  return Math.max(1, raw);
}

function shiftTier(tier, delta = 0) {
  const normalized = normalizeTierId(tier, TIER_ASC[0] || "bronze");
  const idx = TIER_ASC.indexOf(normalized);
  const nextIdx = Math.max(
    0,
    Math.min(TIER_ASC.length - 1, idx + Math.floor(delta))
  );
  return TIER_ASC[nextIdx] || normalized;
}

function getFaithTier(structure) {
  if (!structure) return getFaithStartingTier();
  ensureHubSystemState(structure, "faith");
  return normalizeTierId(structure?.systemTiers?.faith, getFaithStartingTier());
}

function setFaithTier(structure, tier) {
  if (!structure) return;
  ensureHubSystemState(structure, "faith");
  structure.systemTiers.faith = normalizeTierId(tier, getFaithStartingTier());
}

function ensureRoutingTemplateSlotWithCandidates(slotState, candidates) {
  if (!slotState || typeof slotState !== "object") return;
  if (!Array.isArray(slotState.ordered)) slotState.ordered = [];
  if (!slotState.enabled || typeof slotState.enabled !== "object") {
    slotState.enabled = {};
  }
  if (Array.isArray(candidates) && candidates.length > 0) {
    if (slotState.ordered.length === 0) {
      slotState.ordered = candidates.slice();
    } else {
      for (const endpointId of candidates) {
        if (!endpointId || typeof endpointId !== "string") continue;
        if (slotState.ordered.includes(endpointId)) continue;
        slotState.ordered.push(endpointId);
      }
    }
  }
  for (const endpointId of slotState.ordered) {
    if (!endpointId || typeof endpointId !== "string") continue;
    if (slotState.enabled[endpointId] === undefined) {
      slotState.enabled[endpointId] = true;
    }
  }
}

function itemKindHasTag(kind, tagId) {
  if (!kind || !tagId) return false;
  const tags = Array.isArray(itemDefs?.[kind]?.baseTags)
    ? itemDefs[kind].baseTags
    : [];
  return tags.includes(tagId);
}

function itemHasTag(item, tagId) {
  if (!item || !tagId) return false;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (tags.includes(tagId)) return true;
  return itemKindHasTag(item.kind, tagId);
}

function countInventoryItemsByTag(state, tagId) {
  if (!state?.ownerInventories || !tagId) return 0;
  let total = 0;
  for (const inv of Object.values(state.ownerInventories)) {
    const items = Array.isArray(inv?.items) ? inv.items : [];
    for (const item of items) {
      if (!itemHasTag(item, tagId)) continue;
      total += Math.max(0, Math.floor(item.quantity ?? 0));
    }
  }
  return total;
}

function countByKindTierPoolForTag(byKindTier, tagId) {
  if (!byKindTier || typeof byKindTier !== "object" || !tagId) return 0;
  let total = 0;
  for (const [kind, tierBucket] of Object.entries(byKindTier)) {
    if (!itemKindHasTag(kind, tagId)) continue;
    if (!tierBucket || typeof tierBucket !== "object") continue;
    for (const qty of Object.values(tierBucket)) {
      total += Math.max(0, Math.floor(qty ?? 0));
    }
  }
  return total;
}

function countPooledItemsByTag(state, tagId) {
  if (!state || !tagId) return 0;
  const structures = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  let total = 0;
  for (const structure of structures) {
    if (!structure || typeof structure !== "object") continue;
    const systems = structure.systemState;
    if (!systems || typeof systems !== "object") continue;
    for (const systemState of Object.values(systems)) {
      const byKindTier = systemState?.byKindTier;
      total += countByKindTierPoolForTag(byKindTier, tagId);
    }
  }
  return total;
}

function computeYearEndFoodTotals(state) {
  const grainTotal =
    countInventoryItemsByTag(state, "grain") + countPooledItemsByTag(state, "grain");
  const edibleTotal =
    countInventoryItemsByTag(state, "edible") + countPooledItemsByTag(state, "edible");
  return {
    grainTotal: Math.max(0, Math.floor(grainTotal)),
    edibleTotal: Math.max(0, Math.floor(edibleTotal)),
  };
}

function getYearEndSkillPointsAward(outcomeKind) {
  const noChange = Number.isFinite(YEAR_END_SKILL_POINTS_NO_POPULATION_CHANGE)
    ? Math.max(0, Math.floor(YEAR_END_SKILL_POINTS_NO_POPULATION_CHANGE))
    : 0;
  const changed = Number.isFinite(YEAR_END_SKILL_POINTS_POPULATION_CHANGE)
    ? Math.max(0, Math.floor(YEAR_END_SKILL_POINTS_POPULATION_CHANGE))
    : noChange;
  const halving = Number.isFinite(YEAR_END_SKILL_POINTS_POPULATION_HALVING)
    ? Math.max(0, Math.floor(YEAR_END_SKILL_POINTS_POPULATION_HALVING))
    : noChange;
  if (outcomeKind === "populationHalved") return halving;
  if (outcomeKind === "populationChanged") return changed;
  return noChange;
}

function getFaithTierSkillPointsBonus(tier) {
  const normalizedTier = normalizeTierId(tier, null);
  if (normalizedTier === "diamond") return 3;
  if (normalizedTier === "gold") return 2;
  if (normalizedTier === "silver") return 1;
  return 0;
}

function getLeaderFaithSkillPointsBonus(leader) {
  if (!leader || leader.role !== PAWN_ROLE_LEADER) return 0;
  return getFaithTierSkillPointsBonus(leader?.leaderFaith?.tier ?? null);
}

function getPoolTierQuantity(bucket, tier) {
  if (!bucket || typeof bucket !== "object") return 0;
  return Math.max(0, Math.floor(bucket[tier] ?? 0));
}

function consumeOneFromTierBucket(bucket, totalByTier = null) {
  if (!bucket || typeof bucket !== "object") return false;
  for (const tier of TIER_ASC) {
    const qty = getPoolTierQuantity(bucket, tier);
    if (qty <= 0) continue;
    bucket[tier] = qty - 1;
    if (totalByTier && typeof totalByTier === "object") {
      const total = Math.max(0, Math.floor(totalByTier[tier] ?? 0));
      totalByTier[tier] = Math.max(0, total - 1);
    }
    return true;
  }
  return false;
}

function getPoolTotalsByTier(endpoint) {
  const owner = endpoint?.owner;
  const systemId = endpoint?.systemId;
  if (!owner || !systemId) return null;
  const totals = owner?.systemState?.[systemId]?.totalByTier;
  if (!totals || typeof totals !== "object") return null;
  return totals;
}

function poolKindMatchesRequirement(kind, requirement) {
  if (!kind || !requirement || typeof requirement !== "object") return false;
  if (requirement.kind === "item" && requirement.itemId) {
    return kind === requirement.itemId;
  }
  if (requirement.kind === "tag" && requirement.tag) {
    return itemKindHasTag(kind, requirement.tag);
  }
  return false;
}

function consumeRequirementUnitFromPool(endpoint, requirement) {
  if (!endpoint || endpoint.kind !== "pool") return false;
  const pool = endpoint.target;
  if (!pool || typeof pool !== "object") return false;

  const totalByTier = getPoolTotalsByTier(endpoint);
  const endpointItemId =
    typeof endpoint.itemId === "string" && endpoint.itemId.length > 0
      ? endpoint.itemId
      : null;

  if (endpointItemId) {
    if (!poolKindMatchesRequirement(endpointItemId, requirement)) return false;
    return consumeOneFromTierBucket(pool, totalByTier);
  }

  const kinds = Object.keys(pool).sort((a, b) => a.localeCompare(b));
  for (const kind of kinds) {
    if (!poolKindMatchesRequirement(kind, requirement)) continue;
    const bucket = pool[kind];
    if (!bucket || typeof bucket !== "object") continue;
    if (consumeOneFromTierBucket(bucket, totalByTier)) return true;
  }

  return false;
}

function tryConsumeResidentMeal(endpoint) {
  const requirement = {
    kind: "tag",
    tag: "edible",
    consume: true,
  };
  if (!endpoint) return false;
  if (endpoint.kind === "inventory") {
    if (!canConsumeRequirementUnit(endpoint.target, requirement)) return false;
    const consumed = consumeRequirementUnit(endpoint.target, requirement);
    return !!consumed;
  }
  if (endpoint.kind === "pool") {
    return consumeRequirementUnitFromPool(endpoint, requirement);
  }
  return false;
}

function consumeResidentsMealsOnSeasonChange(state, structure) {
  const population = getPopulationCount(state);
  const populationFoodMult = Math.max(
    0,
    getGlobalSkillModifier(state, "populationFoodMult", 1)
  );
  const attempts = normalizePopulationCount(
    Math.floor(population * populationFoodMult),
    population
  );
  if (!structure || attempts <= 0) {
    return { attempts, successes: 0, misses: attempts };
  }

  const process = getTemplateProcessForSystem(structure, "residents", { state });
  if (!process) {
    return { attempts, successes: 0, misses: attempts };
  }
  const context = { target: structure, systemId: "residents" };
  const processDef = getProcessDefForInstance(process, structure, context);
  if (!processDef) {
    return { attempts, successes: 0, misses: attempts };
  }

  ensureProcessRoutingState(process, processDef, context);
  const template = ensureSystemRoutingTemplate(structure, "residents", processDef);
  if (!template) {
    return { attempts, successes: 0, misses: attempts };
  }

  const slotDef = resolveSlotDef(processDef, "inputs", "food");
  if (!slotDef) {
    return { attempts, successes: 0, misses: attempts };
  }
  if (!template.inputs || typeof template.inputs !== "object") {
    template.inputs = {};
  }
  if (!template.inputs[slotDef.slotId] || typeof template.inputs[slotDef.slotId] !== "object") {
    template.inputs[slotDef.slotId] = { ordered: [], enabled: {} };
  }
  const slotState = template.inputs[slotDef.slotId];

  const candidates = listCandidateEndpoints(
    state,
    process,
    slotDef,
    structure,
    context
  );
  ensureRoutingTemplateSlotWithCandidates(slotState, candidates);

  const ordered =
    Array.isArray(slotState.ordered) && slotState.ordered.length > 0
      ? slotState.ordered
      : candidates;
  let successes = 0;

  for (let i = 0; i < attempts; i++) {
    let consumed = false;
    for (const endpointRaw of ordered) {
      if (!endpointRaw || typeof endpointRaw !== "string") continue;
      if (slotState.enabled?.[endpointRaw] === false) continue;
      const endpointId = resolveEndpointIdForRouting(endpointRaw, process, context);
      if (!endpointId) continue;
      if (!isEndpointValidForSlot(endpointId, candidates, processDef)) continue;
      const endpoint = resolveEndpointTarget(state, endpointId);
      if (!endpoint) continue;
      if (!tryConsumeResidentMeal(endpoint)) continue;
      consumed = true;
      successes += 1;
      break;
    }
    if (!consumed) continue;
  }

  const misses = Math.max(0, attempts - successes);
  return { attempts, successes, misses };
}

function maybeApplyYearlyPopulationChange(state, tSec, anchors = [], isTagUnlocked = null) {
  const tracker = ensurePopulationTrackerState(state);
  if (!tracker) return false;

  const currentYear = Number.isFinite(state?.year)
    ? Math.max(1, Math.floor(state.year))
    : 1;
  if (tracker.year >= currentYear) return false;

  const previousPopulation = getPopulationCount(state);
  const attempts = normalizePopulationCount(tracker.mealAttempts, 0);
  const successes = normalizePopulationCount(tracker.mealSuccesses, 0);
  const misses = Math.max(0, attempts - successes);
  const populationSystemsActive = previousPopulation > 0;

  let populationAfterMeals = previousPopulation;
  let outcomeText = "population held steady";
  let outcomeKind = "populationUnchanged";
  if (populationSystemsActive) {
    if (attempts > 0 && misses === 0) {
      const growthRate = Number.isFinite(POPULATION_GROWTH_FULL_FEED_RATE)
        ? Math.max(0, POPULATION_GROWTH_FULL_FEED_RATE)
        : 0;
      const growth = Math.max(1, Math.floor(previousPopulation * growthRate));
      populationAfterMeals = previousPopulation + growth;
      outcomeText = `full feeding growth (+${growth})`;
      outcomeKind = "populationChanged";
    } else if (attempts > 0 && successes === 0) {
      const collapseMultiplier = Number.isFinite(POPULATION_COLLAPSE_ALL_FAIL_MULTIPLIER)
        ? Math.max(0, POPULATION_COLLAPSE_ALL_FAIL_MULTIPLIER)
        : 0.5;
      populationAfterMeals = Math.floor(previousPopulation * collapseMultiplier);
      outcomeText = "complete starvation collapse";
      outcomeKind = "populationHalved";
    } else if (attempts === 0) {
      outcomeText = "no seasonal meal attempts";
    } else {
      outcomeText = "partial feeding";
    }
  } else {
    const housingBefore = computeHousingStats(
      anchors,
      isTagUnlocked,
      previousPopulation
    );
    outcomeKind = "populationDormant";
    outcomeText =
      housingBefore.housingCapacity > 0
        ? "housing available but no residents yet"
        : "no active housing capacity";
  }
  populationAfterMeals = normalizePopulationCount(
    populationAfterMeals,
    previousPopulation
  );

  const housingAfterMeals = computeHousingStats(
    anchors,
    isTagUnlocked,
    populationAfterMeals
  );
  const attraction = applyYearlyHousingAttraction(
    tracker,
    housingAfterMeals.housingVacancy
  );
  const attractedPopulation = Math.min(
    normalizePopulationCount(attraction.attracted, 0),
    housingAfterMeals.housingVacancy
  );
  let nextPopulation = normalizePopulationCount(
    populationAfterMeals + attractedPopulation,
    populationAfterMeals
  );
  if (!populationSystemsActive && attractedPopulation > 0) {
    outcomeKind = "populationAttracted";
    outcomeText = `vacancy attraction (+${attractedPopulation})`;
  }

  setPopulationCount(state, nextPopulation);
  const housingAfterAttraction = syncHousingResidentsReport(
    anchors,
    isTagUnlocked,
    nextPopulation
  );

  const housingStructure = getResidentsHousingStructure(anchors, isTagUnlocked);
  const hasFaithHousing = !!housingStructure;
  const faithThreshold = getFaithGrowthStreakThreshold();
  let faithGrowthStreak = normalizePopulationCount(tracker.faithGrowthStreak, 0);
  const previousFaithTier = hasFaithHousing ? getFaithTier(housingStructure) : null;
  let nextFaithTier = previousFaithTier;
  let faithOutcome = hasFaithHousing ? "faithUnchanged" : "faithUnavailable";
  let runCompleted = false;

  if (hasFaithHousing && populationSystemsActive) {
    if (outcomeKind === "populationChanged") {
      faithGrowthStreak += 1;
      if (faithGrowthStreak >= faithThreshold) {
        nextFaithTier = shiftTier(previousFaithTier, 1);
        faithOutcome =
          nextFaithTier === previousFaithTier ? "faithAlreadyMax" : "faithUpgraded";
        faithGrowthStreak = 0;
      }
    } else if (outcomeKind === "populationHalved") {
      faithGrowthStreak = 0;
      if (previousFaithTier === "bronze") {
        runCompleted = true;
        faithOutcome = "faithCollapsed";
      } else {
        nextFaithTier = shiftTier(previousFaithTier, -1);
        faithOutcome = "faithDegraded";
      }
    } else {
      faithGrowthStreak = 0;
    }
    setFaithTier(housingStructure, nextFaithTier);
  } else {
    faithGrowthStreak = 0;
    if (hasFaithHousing) {
      faithOutcome = "faithDormant";
      setFaithTier(housingStructure, nextFaithTier);
    }
  }
  tracker.faithGrowthStreak = faithGrowthStreak;

  const populationSkillPointsPerLeader = populationSystemsActive
    ? getYearEndSkillPointsAward(outcomeKind)
    : 0;
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  let leaderCount = 0;
  let faithSkillPointsAwardedTotal = 0;
  let firstLeaderFaithSkillPoints = null;
  let hasUniformFaithSkillPointsPerLeader = true;
  let skillPointsPerLeader = null;
  for (const pawn of pawns) {
    if (!pawn || pawn.role !== PAWN_ROLE_LEADER) continue;
    const leaderFaithSkillPoints = getLeaderFaithSkillPointsBonus(pawn);
    if (leaderCount === 0) {
      firstLeaderFaithSkillPoints = leaderFaithSkillPoints;
    } else if (firstLeaderFaithSkillPoints !== leaderFaithSkillPoints) {
      hasUniformFaithSkillPointsPerLeader = false;
    }
    faithSkillPointsAwardedTotal += leaderFaithSkillPoints;
    const leaderSkillPointsAward =
      populationSkillPointsPerLeader + leaderFaithSkillPoints;
    const current = Number.isFinite(pawn.skillPoints)
      ? Math.max(0, Math.floor(pawn.skillPoints))
      : 0;
    pawn.skillPoints = current + leaderSkillPointsAward;
    leaderCount += 1;
  }
  const uniformFaithSkillPointsPerLeader =
    leaderCount > 0 && hasUniformFaithSkillPointsPerLeader
      ? firstLeaderFaithSkillPoints
      : null;
  if (leaderCount > 0 && uniformFaithSkillPointsPerLeader != null) {
    skillPointsPerLeader =
      populationSkillPointsPerLeader + uniformFaithSkillPointsPerLeader;
  }
  const populationSkillPointsAwardedTotal =
    leaderCount * populationSkillPointsPerLeader;
  const totalSkillPointsAwarded =
    populationSkillPointsAwardedTotal + faithSkillPointsAwardedTotal;
  const foodTotals = computeYearEndFoodTotals(state);

  const priorYear = Math.max(1, currentYear - 1);
  const faithSummaryText =
    populationSystemsActive && hasFaithHousing && previousFaithTier && nextFaithTier
      ? `, faith ${previousFaithTier} -> ${nextFaithTier}`
      : "";
  const attractionSummaryText =
    populationSystemsActive && attractedPopulation > 0
      ? `, +${attractedPopulation} attracted`
      : "";
  const skillPointSummaryText =
    leaderCount > 0 && skillPointsPerLeader != null
      ? `+${skillPointsPerLeader} skill points to each leader (${populationSkillPointsPerLeader} population + ${uniformFaithSkillPointsPerLeader} faith)`
      : `+${totalSkillPointsAwarded} total skill points across ${leaderCount} leaders (${populationSkillPointsAwardedTotal} population + ${faithSkillPointsAwardedTotal} faith)`;
  const yearlyEntry = pushGameEvent(state, {
    type: "populationYearlyUpdate",
    tSec,
    text: `Year ${priorYear} population update: ${previousPopulation} -> ${nextPopulation} (${outcomeText})${attractionSummaryText}${faithSummaryText}, ${skillPointSummaryText}`,
    data: {
      year: priorYear,
      previousPopulation,
      nextPopulation,
      mealAttempts: attempts,
      mealSuccesses: successes,
      mealMisses: misses,
      populationOutcome: outcomeKind,
      attractedPopulation,
      housingCapacity: housingAfterAttraction.housingCapacity,
      housingVacancy: housingAfterAttraction.housingVacancy,
      attractionProgress: tracker.attractionProgress,
      populationSkillPointsPerLeader,
      faithSkillPointsPerLeader: uniformFaithSkillPointsPerLeader,
      skillPointsPerLeader,
      leaderCount,
      populationSkillPointsAwardedTotal,
      faithSkillPointsAwardedTotal,
      totalSkillPointsAwarded,
      grainTotal: foodTotals.grainTotal,
      edibleTotal: foodTotals.edibleTotal,
      faith: {
        structureId: housingStructure?.instanceId ?? null,
        previousTier: previousFaithTier,
        nextTier: nextFaithTier,
        outcome: faithOutcome,
        growthStreak: faithGrowthStreak,
        growthThreshold: faithThreshold,
        active: populationSystemsActive,
        runCompleted,
      },
      yearEndPerformance: {
        year: priorYear,
        previousPopulation,
        nextPopulation,
        populationDelta: nextPopulation - previousPopulation,
        populationOutcome: outcomeKind,
        attractedPopulation,
        housingCapacity: housingAfterAttraction.housingCapacity,
        housingVacancy: housingAfterAttraction.housingVacancy,
        attractionProgress: tracker.attractionProgress,
        mealAttempts: attempts,
        mealSuccesses: successes,
        mealMisses: misses,
        grainTotal: foodTotals.grainTotal,
        edibleTotal: foodTotals.edibleTotal,
        populationSkillPointsPerLeader,
        faithSkillPointsPerLeader: uniformFaithSkillPointsPerLeader,
        skillPointsPerLeader,
        leaderCount,
        populationSkillPointsAwardedTotal,
        faithSkillPointsAwardedTotal,
        totalSkillPointsAwarded,
        faithPreviousTier: previousFaithTier,
        faithNextTier: nextFaithTier,
        faithOutcome,
        faithGrowthStreak: faithGrowthStreak,
        faithGrowthThreshold: faithThreshold,
        runCompleted,
      },
    },
  });

  if (populationSystemsActive && runCompleted && state?.runStatus?.complete !== true) {
    state.runStatus = {
      complete: true,
      reason: "faithCollapsedAtBronze",
      year: priorYear,
      tSec: Math.max(0, Math.floor(tSec ?? state?.tSec ?? 0)),
      triggerEventId: Number.isFinite(yearlyEntry?.id)
        ? Math.floor(yearlyEntry.id)
        : null,
    };
    state.paused = true;
    syncPhaseToPaused(state);
    pushGameEvent(state, {
      type: "runComplete",
      tSec,
      text: `Run complete: civilization lasted until Year ${priorYear}.`,
      data: {
        runComplete: true,
        year: priorYear,
        reason: "faithCollapsedAtBronze",
        triggerEventId: state.runStatus.triggerEventId,
      },
    });
  }

  tracker.year = currentYear;
  tracker.mealAttempts = 0;
  tracker.mealSuccesses = 0;
  return true;
}

function runPopulationSeasonTick(state, tSec, anchors, isTagUnlocked = null) {
  if (!state || state._seasonChanged !== true) return false;

  maybeApplyYearlyPopulationChange(state, tSec, anchors, isTagUnlocked);
  if (state?.runStatus?.complete === true) return true;

  const tracker = ensurePopulationTrackerState(state);
  if (!tracker) return false;

  const structure = getResidentsHousingStructure(anchors, isTagUnlocked);
  const result = consumeResidentsMealsOnSeasonChange(state, structure);
  const attempts = normalizePopulationCount(result.attempts, 0);
  const successes = normalizePopulationCount(result.successes, 0);
  const misses = Math.max(0, attempts - successes);

  tracker.mealAttempts += attempts;
  tracker.mealSuccesses += successes;

  if (attempts <= 0) return true;

  const seasonKey = getCurrentSeasonKey(state);
  const seasonLabel = SEASON_DISPLAY?.[seasonKey] || seasonKey || "Season";
  const structureLabel = structure ? getStructureLabel(structure) : "Housing";
  const text = structure
    ? `${structureLabel} residents consumed ${successes}/${attempts} meals in ${seasonLabel}`
    : `Residents consumed ${successes}/${attempts} meals in ${seasonLabel} (no active housing)`;
  pushGameEvent(state, {
    type: "populationSeasonMeal",
    tSec,
    text,
    data: {
      focusKind: "hubStructure",
      hubStructureId: structure?.instanceId ?? null,
      mealAttempts: attempts,
      mealSuccesses: successes,
      mealMisses: misses,
      seasonKey,
    },
  });
  return true;
}

function resolveProcessTypeFromSystem(structure, effect) {
  if (!effect || typeof effect !== "object") return null;
  const systemId = typeof effect.system === "string" ? effect.system : null;
  const key =
    typeof effect.processTypeFromSystemKey === "string"
      ? effect.processTypeFromSystemKey
      : "selectedRecipeId";
  if (!systemId) return null;
  const selected = structure?.systemState?.[systemId]?.[key];
  return typeof selected === "string" && selected.length > 0 ? selected : null;
}

function resolveProcessTypeListFromSystem(structure, effect) {
  if (!effect || typeof effect !== "object") return [];
  const systemId = typeof effect.system === "string" ? effect.system : null;
  if (!systemId) return [];
  const key =
    typeof effect.processTypeFromSystemPriorityKey === "string"
      ? effect.processTypeFromSystemPriorityKey
      : "recipePriority";
  return resolveProcessTypesFromPriorityState(structure, systemId, key);
}

function resolveIntentEffect(effect, structure) {
  if (!effect) return null;
  if (Array.isArray(effect)) {
    const resolved = effect
      .map((entry) => resolveIntentEffect(entry, structure))
      .filter(Boolean);
    return resolved.length ? resolved : null;
  }
  if (typeof effect !== "object") return effect;

  const hasPrioritySource = !!effect.processTypeFromSystemPriorityKey;
  const hasSingleSource = !!effect.processTypeFromSystemKey;
  if (!hasPrioritySource && !hasSingleSource) return effect;

  const resolved = { ...effect };
  if (hasPrioritySource) {
    const processTypeList = resolveProcessTypeListFromSystem(structure, effect);
    if (processTypeList.length === 0) return null;
    resolved.processTypeList = processTypeList;
    if (resolved.op === "CreateWorkProcess") {
      const systemId = typeof resolved.system === "string" ? resolved.system : null;
      const queueKey = resolved.queueKey || "processes";
      const existingProcesses = Array.isArray(
        structure?.systemState?.[systemId]?.[queueKey]
      )
        ? structure.systemState[systemId][queueKey]
        : [];
      const existingTypes = new Set(
        existingProcesses
          .map((proc) =>
            typeof proc?.type === "string" && proc.type.length > 0
              ? proc.type
              : null
          )
          .filter(Boolean)
      );
      const chosen =
        resolved.uniqueType === true
          ? processTypeList.find((type) => !existingTypes.has(type)) || null
          : processTypeList[0] || null;
      if (!chosen) return null;
      resolved.processType = chosen;
    }
  }

  if (!resolved.processType && hasSingleSource) {
    const processType = resolveProcessTypeFromSystem(structure, effect);
    if (!processType) return null;
    resolved.processType = processType;
  }

  if (resolved.op === "CreateWorkProcess") {
    const processType =
      typeof resolved.processType === "string" ? resolved.processType : null;
    const durationMissing = !Number.isFinite(resolved.durationSec);
    if (durationMissing && processType) {
      const recipe = recipeDefs?.[processType] || null;
      if (recipe && Number.isFinite(recipe.durationSec)) {
        resolved.durationSec = recipe.durationSec;
      }
    }
  }

  return resolved;
}

function canAdvanceWorkEffect(state, structure, effect) {
  if (!state || !structure || !effect) return true;
  if (effect.op !== "AdvanceWorkProcess") return true;
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return true;
  const queueKey = effect.queueKey || "processes";
  const processes = Array.isArray(structure?.systemState?.[systemId]?.[queueKey])
    ? structure.systemState[systemId][queueKey]
    : [];
  if (processes.length === 0) return true;
  const processTypeList = Array.isArray(effect.processTypeList)
    ? effect.processTypeList
        .filter((type) => typeof type === "string" && type.length > 0)
        .filter((type, idx, arr) => arr.indexOf(type) === idx)
    : [];
  const matches = processTypeList.length > 0
    ? processTypeList
        .map((type) => processes.find((proc) => proc?.type === type))
        .filter(Boolean)
    : effect.processType
      ? processes.filter((proc) => proc?.type === effect.processType)
      : processes.slice();
  if (matches.length === 0) return true;
  for (const proc of matches) {
    if (canProcessOutputsProceed(state, structure, proc, systemId)) return true;
  }
  return false;
}

function canExecuteIntentEffect(state, structure, effect) {
  if (!effect) return true;
  if (Array.isArray(effect)) {
    for (const eff of effect) {
      if (!canExecuteIntentEffect(state, structure, eff)) return false;
    }
    return true;
  }
  if (effect.op === "AdvanceWorkProcess") {
    return canAdvanceWorkEffect(state, structure, effect);
  }
  return true;
}

export function stepHubSecond(state, tSec) {
  if (!state || !state.hub) return;

  const anchors = Array.isArray(state.hub.anchors) ? state.hub.anchors : [];
  const unlockedHubTags = computeGlobalSkillMods(state).unlockedHubTags;
  const isTagUnlocked = (tagId) =>
    typeof tagId === "string" && unlockedHubTags.has(tagId);

  syncHousingResidentsReport(anchors, isTagUnlocked, getPopulationCount(state));
  runPopulationSeasonTick(state, tSec, anchors, isTagUnlocked);
  syncHousingResidentsReport(anchors, isTagUnlocked, getPopulationCount(state));
  if (!anchors.length) return;

  const seasonKey = getCurrentSeasonKey(state);

  for (const structure of anchors) {
    if (!structure) continue;
    const hubCol = Number.isFinite(structure.col)
      ? Math.floor(structure.col)
      : 0;

    const tags = Array.isArray(structure.tags) ? structure.tags : [];
    if (!tags.length) continue;

    const pawns = getPawnsOnHubAnchor(state, structure);
    const contributingPawns = getContributingPawns(state, structure);
    const hasPawn = pawns.length > 0;

    if (
      hasPawn &&
      tags.includes("depositable") &&
      !isTagDisabled(structure, "depositable", isTagUnlocked)
    ) {
      ensureDepositProcesses(state, structure, pawns, tSec, isTagUnlocked);
    }

    const baseContext = {
      kind: "game",
      state,
      source: structure,
      tSec,
      hubCol,
      ownerId: structure.instanceId,
      hubWorkers: contributingPawns,
    };

    for (const tagId of tags) {
      const tagDef = hubTagDefs[tagId];
      if (!tagDef) continue;
      const tagDisabled = isTagDisabled(structure, tagId, isTagUnlocked);
      const passives = Array.isArray(tagDef.passives) ? tagDef.passives : [];
      for (let passiveIndex = 0; passiveIndex < passives.length; passiveIndex++) {
        const passive = passives[passiveIndex];
        if (!passive || typeof passive !== "object") continue;
        const passiveKey = buildHubPassiveKey(
          structure,
          tagId,
          passive,
          passiveIndex
        );
        if (tagDisabled) {
          passiveTimingPasses(passive.timing, state, tSec, {
            passiveKey,
            isActive: false,
          });
          continue;
        }
        const requirementsOk =
          !passive.requires ||
          requirementsPass(passive.requires, seasonKey, structure, hasPawn, isTagUnlocked);
        if (!requirementsOk) {
          passiveTimingPasses(passive.timing, state, tSec, {
            passiveKey,
            isActive: false,
          });
          continue;
        }
        if (
          !passiveTimingPasses(passive.timing, state, tSec, {
            passiveKey,
            isActive: true,
          })
        ) {
          continue;
        }
        if (passive.effect) {
          runEffect(state, passive.effect, { ...baseContext });
        }
      }
    }

    if (!hasPawn) continue;

    for (const pawn of pawns) {
      if (!pawn) continue;
      ensurePawnSystems(pawn);
      const pawnInv = state?.ownerInventories?.[pawn.id] ?? null;

      const repeatLimit = Math.max(1, getPawnEffectiveWorkUnits(state, pawn));
      for (let iteration = 0; iteration < repeatLimit; iteration++) {
        const pawnContext = {
          ...baseContext,
          pawnId: pawn.id,
          ownerId: pawn.id,
          pawn,
          pawnInv,
        };

        let executed = false;
        for (const tagId of tags) {
          if (isTagDisabled(structure, tagId, isTagUnlocked)) continue;
          const tagDef = hubTagDefs[tagId];
          if (!tagDef) continue;
          const intents = Array.isArray(tagDef.intents) ? tagDef.intents : [];
          for (const intent of intents) {
            if (!intent || typeof intent !== "object") continue;
            if (iteration > 0 && intent.repeatByActorWorkUnits !== true) continue;
            if (
              intent.requires &&
              !requirementsPass(intent.requires, seasonKey, structure, true, isTagUnlocked)
            ) {
              continue;
            }
            const resolvedEffect = resolveIntentEffect(intent.effect, structure);
            if (!resolvedEffect) continue;
            if (!canExecuteIntentEffect(state, structure, resolvedEffect)) {
              continue;
            }
            let resolvedIntentCost = null;
            let intentContext = null;
            if (intent.cost) {
              intentContext = {
                ...pawnContext,
                intentId: intent.id ?? null,
              };
              const resolved = resolveCosts(intent.cost, intentContext);
              if (!resolved) continue;
              if (!canAffordCosts(resolved, intentContext)) continue;
              resolvedIntentCost = resolved;
            }
            let effectSucceeded = true;
            if (resolvedEffect) {
              effectSucceeded = runEffect(state, resolvedEffect, { ...pawnContext });
            }
            if (!effectSucceeded) {
              continue;
            }
            if (resolvedIntentCost && intentContext) {
              applyCosts(resolvedIntentCost, intentContext);
            }
            executed = true;
            break;
          }
          if (executed) break;
        }

        if (!executed) break;
      }
    }
  }
}
