// src/model/commands.js
// public mutation APIs (cmd*) + move rules

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../defs/gamesystems/env-systems-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import {
  LEADER_EQUIPMENT_SLOT_ORDER,
} from "../defs/gamesystems/equipment-slot-defs.js";
import {
  canItemEquipInSlot,
  createEmptyLeaderEquipment,
  isLeaderEquipmentSlotId,
} from "./equipment-rules.js";
import {
  buildRequirementProgress,
  isStructureUnderConstruction,
  validateHubConstructionPlacement,
} from "./build-helpers.js";
import {
  SEASON_DURATION_SEC,
  AP_INCOME_PER_SEC,
  AP_INCOME_MULT_WAXING,
  AP_INCOME_MULT_WANING,
  PAWN_AI_SUPPRESS_AFTER_PLAYER_MOVE_SEC,
} from "../defs/gamesettings/gamerules-defs.js";

import {
  getCurrentSeasonKey,
  buildSeasonDeckForCurrentSeason,
  makeHubStructureInstance,
  ensureHubState,
  ensurePawnAI,
  rebuildHubOccupancy,
} from "./state.js";

import {
  runEffect,
  processSecondChangeForItems,
} from "./effects.js";

import {
  Inventory,
  initializeItemFromDef,
  getItemMaxStack,
  canStackItems,
  mergeItemSystemStateForStacking,
} from "./inventory-model.js";
import { bumpInvVersion } from "./effects/core/inventory-version.js";
import { stepPawnSecond } from "./pawn-exec.js";
import { stepEnvSecond } from "./env-exec.js";
import { stepHubSecond } from "./hub-exec.js";
import {
  findEquippedPoolProviderEntry,
  itemProvidesPool,
} from "./item-def-rules.js";
import { getActionPointCapAtSecond, isMoonWaxingAtSecond } from "./moon.js";
import { TIER_ASC } from "./effects/core/tiers.js";
import { adjustFollowerCount, enforcePrestigeFollowerCap } from "./prestige-system.js";
import {
  getProcessDefForInstance,
  ensureProcessRoutingState,
  getDropEndpointId,
  isDropEndpoint,
  ensureSystemRoutingTemplate,
  syncRoutingTemplateFromProcess,
  getTemplateProcessForSystem,
  listCandidateEndpoints,
} from "./process-framework.js";
import {
  computeAvailableRecipesAndBuildings,
  computeGlobalSkillMods,
  evaluateSkillNodeUnlock,
} from "./skills.js";

const TICKS_PER_SEC = 60;

// Season progression is time-based (decoupled from planning boundaries).
// Default duration comes from defs (SEASON_DURATION_SEC).
const DEFAULT_SEASON_DURATION_SEC = SEASON_DURATION_SEC;

function normalizeApState(state) {
  if (typeof state.actionPoints !== "number") state.actionPoints = 0;
  if (typeof state.actionPointCap !== "number") state.actionPointCap = 0;
}

function getApCapForSecond(state, tSec) {
  const override = state.apCapOverride;
  if (override && override.enabled) {
    const cap =
      typeof override.cap === "number"
        ? Math.max(0, Math.floor(override.cap))
        : Math.max(0, Math.floor(state.actionPointCap ?? 0));
    return cap;
  }
  const baseCap = getActionPointCapAtSecond(tSec);
  const globalMods = computeGlobalSkillMods(state);
  const bonus = Number.isFinite(globalMods?.apCapBonus)
    ? Math.floor(globalMods.apCapBonus)
    : 0;
  return Math.max(0, baseCap + bonus);
}

function getApIncomePerSecond(state, tSec) {
  const income = Number.isFinite(AP_INCOME_PER_SEC) ? AP_INCOME_PER_SEC : 1;
  const base = Math.max(0, income);

  if (state?.apCapOverride?.enabled) return base;

  const mult = isMoonWaxingAtSecond(tSec)
    ? AP_INCOME_MULT_WAXING
    : AP_INCOME_MULT_WANING;
  const multSafe = Number.isFinite(mult) ? Math.max(0, mult) : 1;

  return base * multSafe;
}


export function cmdAdvanceSeason(state) {
  const oldSeasonKey = getCurrentSeasonKey(state);

  // 1) advance season index deterministically
  const seasons = state.seasons || [];
  if (!seasons.length) return { ok: false, reason: "noSeasons" };

  const nextSeasonIndex =
    ((state.currentSeasonIndex || 0) + 1) % seasons.length;
  state.currentSeasonIndex = nextSeasonIndex;

  if (nextSeasonIndex === 0) {
    const currentYear = Number.isFinite(state.year)
      ? Math.floor(state.year)
      : 0;
    state.year = Math.max(1, currentYear + 1);
  }

  const newSeasonKey = getCurrentSeasonKey(state);

  // 2) build new season deck (tile-driven)
  state.currentSeasonDeck = null;
  buildSeasonDeckForCurrentSeason(state);

  // 3) flag season change for timing-based passives
  state._seasonChanged = true;

  return { ok: true, oldSeasonKey, newSeasonKey };
}

function maybeAdvanceSeasonBySimTime(state, dt) {
  const dur =
    typeof state.seasonDurationSec === "number" && state.seasonDurationSec > 0
      ? state.seasonDurationSec
      : DEFAULT_SEASON_DURATION_SEC;

  state.seasonClockSec =
    typeof state.seasonClockSec === "number" ? state.seasonClockSec : 0;

  state.seasonClockSec += dt;

  // In case stepping causes us to skip past multiple season events.
  let advanced = 0;
  while (state.seasonClockSec >= dur) {
    state.seasonClockSec -= dur;
    const res = cmdAdvanceSeason(state);
    if (res?.ok) advanced += 1;
    else break;
  }

  return advanced;
}

// =============================================================================
// HUB CONSTRUCTION
// =============================================================================

export function cmdBuildDesignate(state, payload = {}) {
  const defId = payload.defId ?? null;
  const target = payload.target ?? {};
  const hubCol =
    payload.hubCol ??
    target.hubCol ??
    target.col ??
    null;

  const validity = validateHubConstructionPlacement(state, defId, hubCol);
  if (!validity?.ok) return validity || { ok: false, reason: "badPlacement" };

  const def = validity.def;
  const col = validity.hubCol;
  const tier = typeof payload.tier === "string" ? payload.tier : null;
  const structure = makeHubStructureInstance(defId, state, { tier });
  structure.tags = ["build"];
  if (structure.tagStates) delete structure.tagStates;

  const laborRaw = def?.build?.laborSec ?? def?.build?.labor ?? 0;
  const laborSec = Number.isFinite(laborRaw)
    ? Math.max(0, Math.floor(laborRaw))
    : 0;
  const durationSec = Math.max(1, laborSec);
  const requirements = buildRequirementProgress(def);

  runEffect(
    state,
    {
      op: "CreateWorkProcess",
      system: "build",
      queueKey: "processes",
      processType: "build",
      mode: "work",
      durationSec,
      uniqueType: true,
      completionPolicy: "build",
      requirements,
      processMeta: { buildKind: "hubStructure", buildDefId: defId },
    },
    {
      kind: "build",
      state,
      source: structure,
      tSec: state?.tSec ?? 0,
      ownerId: structure.instanceId,
      owner: structure,
    }
  );

  const slot = state.hub.slots[col];
  if (slot && typeof slot === "object") {
    slot.structure = structure;
  } else {
    state.hub.slots[col] = { structure };
  }

  ensureHubState(state);
  rebuildHubOccupancy(state);

  return {
    ok: true,
    result: "buildDesignated",
    defId,
    hubCol: col,
    structureId: structure.instanceId,
  };
}

export function cmdCancelBuild(state, payload = {}) {
  if (!state?.hub || !Array.isArray(state.hub.slots)) {
    return { ok: false, reason: "noHub" };
  }
  const target = payload.target ?? {};
  const hubCol =
    payload.hubCol ??
    target.hubCol ??
    target.col ??
    null;
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  const col = Math.floor(hubCol);

  const structure =
    state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };
  if (!isStructureUnderConstruction(structure)) {
    return { ok: false, reason: "notUnderConstruction" };
  }

  const anchorCol = Number.isFinite(structure.col)
    ? Math.floor(structure.col)
    : col;

  const slot = state.hub.slots[anchorCol];
  if (slot?.structure?.instanceId === structure.instanceId) {
    slot.structure = null;
  } else {
    for (const s of state.hub.slots) {
      if (s?.structure?.instanceId === structure.instanceId) {
        s.structure = null;
        break;
      }
    }
  }

  if (state.ownerInventories) {
    delete state.ownerInventories[structure.instanceId];
  }

  rebuildHubOccupancy(state);

  return {
    ok: true,
    result: "buildCancelled",
    defId: structure.defId,
    hubCol: anchorCol,
    structureId: structure.instanceId,
  };
}

// =============================================================================
// SIM TICK ORCHESTRATION
// =============================================================================

// cmdTickSimulation is the sole authority for advancing simulation time
// (simStepIndex / tSec) and time-driven season progression (seasonClockSec → cmdAdvanceSeason).
//
// Authority gate:
// - Time and season progression advance ONLY when state.paused === false.
// - state.phase is a normalized UI semantic label derived from paused and is NOT used to gate
//   time, season progression, replay, or projection.
export function cmdTickSimulation(state, dt) {
  // Global hard-pause check (user explicit pause)
  if (state.paused) return { ok: false };

  // 1. Advance Master Clock (Continuous Axis)
  // This happens whenever the runner calls this function (which is only when !paused).
  state.simStepIndex = (state.simStepIndex || 0) + 1;

  const prevTSec = state.tSec || 0;
  const newTSec = Math.floor(state.simStepIndex / TICKS_PER_SEC);

  const didAdvanceSecond = newTSec > prevTSec;
  if (didAdvanceSecond) {
    state.tSec = newTSec;

    normalizeApState(state);
    state.actionPointCap = getApCapForSecond(state, state.tSec);

    // Income Rule: +1 AP per second whenever the clock advances.
    // (Phase is irrelevant; only Pause stops income, which is handled by the runner).
    state.actionPoints += getApIncomePerSecond(state, state.tSec);
    state.actionPoints = Math.min(state.actionPoints, state.actionPointCap);

  }

  let advancedSeasonCount = 0;

  // 2. Advance Game Simulation
  const scaledDt = dt;

  // Float axis accumulator
  state.simTime = (state.simTime ?? 0) + scaledDt;

  // Season progression: time-based, not boundary-based.
  advancedSeasonCount = maybeAdvanceSeasonBySimTime(state, scaledDt);

  // Remaining-time fields (HUD/debug). Keep them deterministic.
  const dur =
    typeof state.seasonDurationSec === "number" && state.seasonDurationSec > 0
      ? state.seasonDurationSec
      : DEFAULT_SEASON_DURATION_SEC;
  state.seasonTimeRemaining = Math.max(0, dur - (state.seasonClockSec ?? 0));

  state._seasonChanged =
    state._seasonChanged === true || advancedSeasonCount > 0;

  if (didAdvanceSecond) {
    processSecondChangeForItems(state);
    stepPawnSecond(state, state.tSec, { placeCharacter: cmdPlaceCharacter });
    stepEnvSecond(state, state.tSec);
    stepHubSecond(state, state.tSec);
    enforcePrestigeFollowerCap(state);
    if (state._seasonChanged) state._seasonChanged = false;
  }

  return {
    ok: true,
    advancedSeason: advancedSeasonCount > 0,
    advancedSeasonCount,
  };
}

// =============================================================================
// SIM CONTROL COMMANDS
// =============================================================================

export function cmdSetPaused(state, paused) {
  if (typeof paused !== "boolean") return { ok: false, reason: "badPaused" };
  state.paused = paused;
  return { ok: true, paused };
}

// =============================================================================
// TILE TAG ORDERING
// =============================================================================

export function cmdSetTileTagOrder(state, { envCol, tagIds }) {
  if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
  if (!Array.isArray(tagIds)) return { ok: false, reason: "badTagIds" };

  const col = Math.floor(envCol);
  const tile = state.board?.occ?.tile?.[col];
  if (!tile) return { ok: false, reason: "noTile" };

  const unique = new Set();
  const ordered = [];
  for (const tag of tagIds) {
    if (typeof tag !== "string") return { ok: false, reason: "badTagId" };
    if (unique.has(tag)) return { ok: false, reason: "duplicateTag" };
    unique.add(tag);
    ordered.push(tag);
  }

  const existingTags = Array.isArray(tile.tags) ? tile.tags : [];
  const existingSet = new Set(existingTags);

  if (existingSet.size !== unique.size) {
    return { ok: false, reason: "tagSetMismatch" };
  }
  for (const tag of unique) {
    if (!existingSet.has(tag)) return { ok: false, reason: "tagSetMismatch" };
  }

  tile.tags = ordered;
  return { ok: true, result: "tagOrderSet", envCol: col };
}

// =============================================================================
// HUB TAG ORDERING
// =============================================================================

export function cmdSetHubTagOrder(state, { hubCol, tagIds }) {
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  if (!Array.isArray(tagIds)) return { ok: false, reason: "badTagIds" };

  const col = Math.floor(hubCol);
  const structure =
    state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };

  const unique = new Set();
  const ordered = [];
  for (const tag of tagIds) {
    if (typeof tag !== "string") return { ok: false, reason: "badTagId" };
    if (unique.has(tag)) return { ok: false, reason: "duplicateTag" };
    unique.add(tag);
    ordered.push(tag);
  }

  const existingTags = Array.isArray(structure.tags) ? structure.tags : [];
  const existingSet = new Set(existingTags);

  if (existingSet.size !== unique.size) {
    return { ok: false, reason: "tagSetMismatch" };
  }
  for (const tag of unique) {
    if (!existingSet.has(tag)) return { ok: false, reason: "tagSetMismatch" };
  }

  structure.tags = ordered;
  const anchorCol = Number.isFinite(structure.col) ? structure.col : col;
  return { ok: true, result: "hubTagOrderSet", hubCol: anchorCol };
}

// =============================================================================
// TAG TOGGLES
// =============================================================================

function readTagDisableState(entry, source = "player") {
  const isObj = entry && typeof entry === "object";
  const disabledBy = isObj && entry.disabledBy && typeof entry.disabledBy === "object"
    ? entry.disabledBy
    : null;

  let playerDisabled = disabledBy?.player === true;
  let eventDisabledCount = Number.isFinite(disabledBy?.eventCount)
    ? Math.max(0, Math.floor(disabledBy.eventCount))
    : 0;

  // Legacy migration: old saves only had `disabled: true` with no source metadata.
  if (!disabledBy && isObj && entry.disabled === true) {
    if (source === "event") eventDisabledCount = 1;
    else playerDisabled = true;
  }

  const disabled = playerDisabled || eventDisabledCount > 0;
  return { playerDisabled, eventDisabledCount, disabled };
}

function setTagDisabled(target, tagId, disabled, source = "player") {
  if (!target || !tagId) {
    return {
      changed: false,
      disabled: false,
      lockedByEvent: false,
      playerDisabled: false,
      eventDisabledCount: 0,
    };
  }

  const hasStates =
    target.tagStates && typeof target.tagStates === "object";
  const entry = hasStates ? target.tagStates[tagId] : null;
  const prev = readTagDisableState(entry, source);

  let playerDisabled = prev.playerDisabled;
  let eventDisabledCount = prev.eventDisabledCount;
  const nextDisabledFlag = disabled === true;

  if (source === "event") {
    if (nextDisabledFlag) {
      eventDisabledCount += 1;
    } else {
      eventDisabledCount = Math.max(0, eventDisabledCount - 1);
    }
  } else {
    playerDisabled = nextDisabledFlag;
  }

  const nextDisabled = playerDisabled || eventDisabledCount > 0;
  const mutatedMeta =
    playerDisabled !== prev.playerDisabled ||
    eventDisabledCount !== prev.eventDisabledCount;
  const changed = mutatedMeta || nextDisabled !== prev.disabled;

  if (nextDisabled) {
    if (!target.tagStates || typeof target.tagStates !== "object") {
      target.tagStates = {};
    }
    const nextEntry =
      entry && typeof entry === "object" ? entry : {};
    nextEntry.disabledBy = {
      player: playerDisabled === true,
      eventCount: eventDisabledCount,
    };
    nextEntry.disabled = true;
    target.tagStates[tagId] = nextEntry;
  } else if (entry && typeof entry === "object") {
    if (entry.disabled) delete entry.disabled;
    if (entry.disabledBy) delete entry.disabledBy;
    if (Object.keys(entry).length === 0) {
      delete target.tagStates[tagId];
    } else if (target.tagStates && typeof target.tagStates === "object") {
      target.tagStates[tagId] = entry;
    }
  } else if (target.tagStates && typeof target.tagStates === "object") {
    delete target.tagStates[tagId];
  }

  if (
    target.tagStates &&
    typeof target.tagStates === "object" &&
    Object.keys(target.tagStates).length === 0
  ) {
    delete target.tagStates;
  }

  return {
    changed,
    disabled: nextDisabled,
    lockedByEvent: eventDisabledCount > 0,
    playerDisabled: playerDisabled === true,
    eventDisabledCount,
  };
}

export function cmdToggleTileTag(state, { envCol, tagId, disabled } = {}) {
  if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
  if (typeof tagId !== "string" || !tagId.length) {
    return { ok: false, reason: "badTagId" };
  }

  const col = Math.floor(envCol);
  const tile = state.board?.occ?.tile?.[col];
  if (!tile) return { ok: false, reason: "noTile" };
  const tags = Array.isArray(tile.tags) ? tile.tags : [];
  if (!tags.includes(tagId)) return { ok: false, reason: "tagNotOnTile" };

  const currentState = readTagDisableState(tile?.tagStates?.[tagId], "player");
  const currentDisabled = currentState.disabled === true;
  const nextDisabled =
    typeof disabled === "boolean" ? disabled : !currentDisabled;
  if (!nextDisabled && currentState.eventDisabledCount > 0) {
    return {
      ok: false,
      reason: "tagLockedByEvent",
      envCol: col,
      tagId,
      disabled: true,
    };
  }
  const result = setTagDisabled(tile, tagId, nextDisabled, "player");

  return {
    ok: true,
    result: result.changed ? "tagToggled" : "tagUnchanged",
    envCol: col,
    tagId,
    disabled: result.disabled,
  };
}

export function cmdToggleHubTag(state, { hubCol, tagId, disabled } = {}) {
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  if (typeof tagId !== "string" || !tagId.length) {
    return { ok: false, reason: "badTagId" };
  }

  const col = Math.floor(hubCol);
  const structure =
    state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };
  const tags = Array.isArray(structure.tags) ? structure.tags : [];
  if (!tags.includes(tagId)) return { ok: false, reason: "tagNotOnHub" };

  const currentState = readTagDisableState(
    structure?.tagStates?.[tagId],
    "player"
  );
  const currentDisabled = currentState.disabled === true;
  const nextDisabled =
    typeof disabled === "boolean" ? disabled : !currentDisabled;
  if (!nextDisabled && currentState.eventDisabledCount > 0) {
    return {
      ok: false,
      reason: "tagLockedByEvent",
      hubCol: col,
      tagId,
      disabled: true,
    };
  }
  const result = setTagDisabled(structure, tagId, nextDisabled, "player");

  const anchorCol = Number.isFinite(structure.col) ? structure.col : col;
  return {
    ok: true,
    result: result.changed ? "hubTagToggled" : "hubTagUnchanged",
    hubCol: anchorCol,
    tagId,
    disabled: result.disabled,
  };
}

// =============================================================================
// TILE CROP SELECTION
// =============================================================================

function ensureTileSystemState(tile) {
  if (!tile.systemState || typeof tile.systemState !== "object") {
    tile.systemState = {};
  }
  return tile.systemState;
}

function cloneSerializable(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function ensureSystemState(tile, systemId) {
  const systemState = ensureTileSystemState(tile);
  if (!systemState[systemId] || typeof systemState[systemId] !== "object") {
    const defaults = envSystemDefs[systemId]?.stateDefaults ?? {};
    systemState[systemId] = cloneSerializable(defaults);
  }
  return systemState[systemId];
}

function ensureGrowthState(tile) {
  const growth = ensureSystemState(tile, "growth");
  if (!Object.prototype.hasOwnProperty.call(growth, "selectedCropId")) {
    growth.selectedCropId = null;
  }
  if (!Array.isArray(growth.processes)) growth.processes = [];
  if (!growth.maturedPool || typeof growth.maturedPool !== "object") {
    growth.maturedPool = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
  }
  return growth;
}

function ensureHydrationState(tile) {
  return ensureSystemState(tile, "hydration");
}

export function cmdSetTileCropSelection(state, { envCol, cropId } = {}) {
  if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
  const col = Math.floor(envCol);
  const tile = state.board?.occ?.tile?.[col];
  if (!tile) return { ok: false, reason: "noTile" };
  const tags = Array.isArray(tile.tags) ? tile.tags : [];
  if (!tags.includes("farmable")) {
    return { ok: false, reason: "notFarmable" };
  }

  const nextCropId =
    cropId == null || cropId === "" ? null : String(cropId);
  if (nextCropId && !cropDefs[nextCropId]) {
    return { ok: false, reason: "badCropId" };
  }

  const growth = ensureGrowthState(tile);
  if (growth.selectedCropId === nextCropId) {
    return { ok: true, result: "cropUnchanged", envCol: col };
  }

  growth.selectedCropId = nextCropId;
  if (nextCropId) {
    ensureHydrationState(tile);
  }

  return {
    ok: true,
    result: "cropSelected",
    envCol: col,
    cropId: nextCropId,
  };
}

// =============================================================================
// HUB RECIPE SELECTION
// =============================================================================

function getRecipeKindForHubSystem(systemId) {
  if (systemId === "fireplace") return "cook";
  if (systemId === "workspace") return "craft";
  return null;
}

function ensureHubSystemState(structure, systemId) {
  if (!structure.systemState || typeof structure.systemState !== "object") {
    structure.systemState = {};
  }
  if (!structure.systemState[systemId] || typeof structure.systemState[systemId] !== "object") {
    const defaults = hubSystemDefs[systemId]?.stateDefaults ?? {};
    structure.systemState[systemId] = cloneSerializable(defaults);
  }
  return structure.systemState[systemId];
}

export function cmdSetHubRecipeSelection(
  state,
  { hubCol, systemId, recipeId } = {}
) {
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  if (!systemId || typeof systemId !== "string") {
    return { ok: false, reason: "badSystemId" };
  }

  const col = Math.floor(hubCol);
  const structure =
    state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };

  const hasSystem =
    structure.systemState?.[systemId] ||
    Object.prototype.hasOwnProperty.call(structure.systemTiers || {}, systemId);
  if (!hasSystem) return { ok: false, reason: "missingSystem" };

  const nextRecipeId =
    recipeId == null || recipeId === "" ? null : String(recipeId);
  if (nextRecipeId) {
    const def = recipeDefs[nextRecipeId];
    if (!def) return { ok: false, reason: "badRecipeId" };
    const availability = computeAvailableRecipesAndBuildings(state);
    if (!availability.recipeIds?.has(nextRecipeId)) {
      return { ok: false, reason: "recipeLocked" };
    }
    const expectedKind = getRecipeKindForHubSystem(systemId);
    if (expectedKind && def.kind !== expectedKind) {
      return { ok: false, reason: "badRecipeKind" };
    }
  }

  const systemState = ensureHubSystemState(structure, systemId);
  if (!Object.prototype.hasOwnProperty.call(systemState, "selectedRecipeId")) {
    systemState.selectedRecipeId = null;
  }
  if (systemState.selectedRecipeId === nextRecipeId) {
    return {
      ok: true,
      result: "recipeUnchanged",
      hubCol: col,
      systemId,
      recipeId: nextRecipeId,
    };
  }

  systemState.selectedRecipeId = nextRecipeId;
  return {
    ok: true,
    result: "recipeSelected",
    hubCol: col,
    systemId,
    recipeId: nextRecipeId,
  };
}

// =============================================================================
// HUB POOL WITHDRAWAL
// =============================================================================

function isTierBucket(pool) {
  if (!pool || typeof pool !== "object") return false;
  for (const tier of TIER_ASC) {
    if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
  }
  return false;
}

function ensureInventoryForHubStructure(state, structure) {
  if (!state || !structure) return null;
  if (!state.ownerInventories || typeof state.ownerInventories !== "object") {
    state.ownerInventories = {};
  }
  const ownerId = structure.instanceId;
  if (ownerId == null) return null;
  if (!state.ownerInventories[ownerId]) {
    const def = hubStructureDefs?.[structure.defId] || null;
    const invSpec = def?.inventory ?? {};
    const cols = Number.isFinite(invSpec.cols) ? Math.floor(invSpec.cols) : 5;
    const rows = Number.isFinite(invSpec.rows) ? Math.floor(invSpec.rows) : 10;
    const inv = Inventory.create(cols, rows);
    Inventory.init(inv);
    inv.version = 0;
    state.ownerInventories[ownerId] = inv;
  }
  return state.ownerInventories[ownerId] || null;
}

function addItemUnitsToInventoryWithTags(
  state,
  inv,
  itemId,
  tier,
  qty,
  extraTags = []
) {
  if (!state || !inv || !itemId) return { added: 0, firstItemId: null };
  const targetQty = Math.max(0, Math.floor(qty ?? 0));
  if (targetQty <= 0) return { added: 0, firstItemId: null };

  const def = itemDefs?.[itemId] || null;
  const dummy = {
    kind: itemId,
    tier: tier ?? def?.defaultTier ?? "bronze",
    seasonsToExpire: null,
    tags: Array.isArray(extraTags) ? extraTags.slice() : [],
    systemTiers: {},
    systemState: {},
  };
  initializeItemFromDef(state, dummy, { reset: true });
  if (Array.isArray(extraTags) && extraTags.length > 0) {
    const merged = new Set(Array.isArray(dummy.tags) ? dummy.tags : []);
    for (const tag of extraTags) {
      if (typeof tag !== "string" || !tag.length) continue;
      merged.add(tag);
    }
    dummy.tags = Array.from(merged);
  }

  const maxStack = Math.max(1, Math.floor(getItemMaxStack(dummy) || 1));
  let remaining = targetQty;
  let added = 0;
  let firstItemId = null;

  for (const stack of inv.items || []) {
    if (remaining <= 0) break;
    if (!canStackItems(stack, dummy)) continue;
    const current = Math.max(0, Math.floor(stack.quantity ?? 0));
    const space = Math.max(0, maxStack - current);
    if (space <= 0) continue;
    const moved = Math.min(space, remaining);
    if (moved <= 0) continue;
    stack.quantity = current + moved;
    mergeItemSystemStateForStacking(stack, dummy, current, moved);
    if (firstItemId == null) firstItemId = stack.id;
    remaining -= moved;
    added += moved;
  }

  while (remaining > 0) {
    const moved = Math.min(remaining, maxStack);
    const created = Inventory.addNewItem(state, inv, {
      kind: itemId,
      quantity: moved,
      width: def?.defaultWidth ?? 1,
      height: def?.defaultHeight ?? 1,
      tier: dummy.tier,
      seasonsToExpire: dummy.seasonsToExpire ?? null,
      tags: cloneSerializable(dummy.tags ?? []),
      systemTiers: cloneSerializable(dummy.systemTiers ?? {}),
      systemState: cloneSerializable(dummy.systemState ?? {}),
    });
    if (!created) break;
    if (firstItemId == null) firstItemId = created.id;
    remaining -= moved;
    added += moved;
  }

  return { added, firstItemId };
}

function itemHasBaseTag(itemId, tag) {
  if (!itemId || !tag) return false;
  const tags = Array.isArray(itemDefs?.[itemId]?.baseTags)
    ? itemDefs[itemId].baseTags
    : [];
  return tags.includes(tag);
}

export function cmdWithdrawHubPoolItem(
  state,
  { hubCol, itemId, amount, systemId, poolKey } = {}
) {
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  if (typeof itemId !== "string" || itemId.length === 0) {
    return { ok: false, reason: "badItemId" };
  }
  const requested = Math.max(1, Math.floor(amount ?? 1));
  if (requested <= 0) return { ok: false, reason: "badAmount" };

  const col = Math.floor(hubCol);
  const structure =
    state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };

  const def = structure?.defId ? hubStructureDefs?.[structure.defId] : null;
  const deposit = def?.deposit;
  if (!deposit || typeof deposit !== "object") {
    return { ok: false, reason: "noDepositPool" };
  }

  const resolvedSystemId =
    typeof deposit.systemId === "string" ? deposit.systemId : null;
  if (!resolvedSystemId) return { ok: false, reason: "badPoolSystem" };
  const resolvedPoolKey =
    typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
      ? deposit.poolKey
      : "byKindTier";

  if (
    typeof systemId === "string" &&
    systemId.length > 0 &&
    systemId !== resolvedSystemId
  ) {
    return { ok: false, reason: "mismatchedSystemId" };
  }
  if (
    typeof poolKey === "string" &&
    poolKey.length > 0 &&
    poolKey !== resolvedPoolKey
  ) {
    return { ok: false, reason: "mismatchedPoolKey" };
  }

  // First implementation scope: withdraw only from granary/storehouse pools.
  if (
    resolvedSystemId !== "granaryStore" &&
    resolvedSystemId !== "storehouseStore"
  ) {
    return { ok: false, reason: "unsupportedPool" };
  }

  const sysState = ensureHubSystemState(structure, resolvedSystemId);
  if (!sysState || typeof sysState !== "object") {
    return { ok: false, reason: "noSystemState" };
  }
  const pool = sysState?.[resolvedPoolKey];
  if (!pool || typeof pool !== "object") return { ok: false, reason: "noPool" };
  if (isTierBucket(pool)) return { ok: false, reason: "unsupportedPoolShape" };

  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") {
    return { ok: false, reason: "missingItemPool" };
  }

  const inv = ensureInventoryForHubStructure(state, structure);
  if (!inv) return { ok: false, reason: "noInventory" };

  let remaining = requested;
  let moved = 0;
  let spawnItemId = null;
  const applyPrestigedTag = itemHasBaseTag(itemId, "grain");
  const extraTags = applyPrestigedTag ? ["prestiged"] : [];

  for (const tier of TIER_ASC) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
    if (available <= 0) continue;
    const want = Math.min(remaining, available);
    const addRes = addItemUnitsToInventoryWithTags(
      state,
      inv,
      itemId,
      tier,
      want,
      extraTags
    );
    const added = Math.max(0, Math.floor(addRes?.added ?? 0));
    if (added <= 0) break;

    bucket[tier] = available - added;
    if (sysState.totalByTier && typeof sysState.totalByTier === "object") {
      const total = Math.max(0, Math.floor(sysState.totalByTier[tier] ?? 0));
      sysState.totalByTier[tier] = Math.max(0, total - added);
    }
    if (spawnItemId == null && addRes?.firstItemId != null) {
      spawnItemId = addRes.firstItemId;
    }

    moved += added;
    remaining -= added;
    if (added < want) break;
  }

  if (moved <= 0) {
    return { ok: false, reason: "noSpaceForWithdraw" };
  }

  const empty = TIER_ASC.every((tier) => Math.max(0, Math.floor(bucket[tier] ?? 0)) <= 0);
  if (empty) delete pool[itemId];

  bumpInvVersion(inv);

  const anchorCol = Number.isFinite(structure.col) ? Math.floor(structure.col) : col;
  return {
    ok: true,
    result: "poolWithdrawn",
    hubCol: anchorCol,
    ownerId: structure.instanceId,
    itemKind: itemId,
    requested,
    moved,
    spawnItemId,
    taggedPrestiged: applyPrestigedTag,
  };
}

// =============================================================================
// PROCESS ROUTING COMMANDS
// =============================================================================

function normalizeSlotKind(value) {
  return value === "outputs" ? "outputs" : "inputs";
}

function findProcessInTarget(target, processId) {
  if (!target?.systemState || !processId) return null;
  const systems = target.systemState;
  for (const [systemId, sysState] of Object.entries(systems)) {
    const list = Array.isArray(sysState?.processes) ? sysState.processes : [];
    if (!list.length) continue;
    for (const proc of list) {
      if (proc?.id === processId) {
        return { process: proc, systemId, processList: list };
      }
    }
  }
  return null;
}

function findProcessById(state, processId) {
  if (!state || !processId) return null;
  const hubAnchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  for (const anchor of hubAnchors) {
    if (!anchor) continue;
    const res = findProcessInTarget(anchor, processId);
    if (res) return { ...res, target: anchor, targetKind: "hub" };
  }
  const hubSlots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of hubSlots) {
    const structure = slot?.structure;
    if (!structure) continue;
    const res = findProcessInTarget(structure, processId);
    if (res) return { ...res, target: structure, targetKind: "hub" };
  }
  const tileAnchors = Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
  for (const anchor of tileAnchors) {
    if (!anchor) continue;
    const res = findProcessInTarget(anchor, processId);
    if (res) return { ...res, target: anchor, targetKind: "env" };
  }
  return null;
}

function findTargetByRef(state, targetRef) {
  if (!state || !targetRef) return null;
  const kind = targetRef.kind;
  const id = targetRef.id ?? targetRef.instanceId ?? null;
  if (id == null) return null;
  if (kind === "hub") {
    const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
    for (const slot of slots) {
      const structure = slot?.structure;
      if (!structure) continue;
      if (String(structure.instanceId) === String(id)) return structure;
    }
    return null;
  }
  if (kind === "env") {
    const anchors = Array.isArray(state?.board?.layers?.tile?.anchors)
      ? state.board.layers.tile.anchors
      : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    return null;
  }
  return null;
}

function resolveRoutingSlotDef(processDef, slotKind, slotId) {
  const kind = normalizeSlotKind(slotKind);
  const slots = processDef?.routingSlots?.[kind] || [];
  if (!Array.isArray(slots) || slots.length === 0) return null;
  if (slotId) {
    const match = slots.find((slot) => slot?.slotId === slotId);
    if (match) return match;
  }
  return null;
}

function applyRoutingPatchToSlot(slotState, patch) {
  if (!slotState || typeof slotState !== "object" || !patch) return false;
  let changed = false;
  if (Array.isArray(patch.ordered)) {
    slotState.ordered = patch.ordered.filter(
      (entry) => typeof entry === "string" && entry.length
    );
    changed = true;
  }
  if (patch.enabled && typeof patch.enabled === "object") {
    for (const [endpointId, enabled] of Object.entries(patch.enabled)) {
      slotState.enabled[endpointId] = enabled === true;
      changed = true;
    }
  }
  return changed;
}

function enforceDropslotPriority(process, processDef) {
  if (!processDef?.supportsDropslot) return false;
  const dropId = getDropEndpointId(process?.id);
  if (!dropId) return false;
  let changed = false;
  const inputSlots = process?.routing?.inputs || {};
  for (const slotState of Object.values(inputSlots)) {
    if (!slotState || !Array.isArray(slotState.ordered)) continue;
    const idx = slotState.ordered.indexOf(dropId);
    if (idx === 0) {
      slotState.enabled[dropId] = true;
      continue;
    }
    if (idx > 0) {
      slotState.ordered.splice(idx, 1);
      slotState.ordered.unshift(dropId);
      slotState.enabled[dropId] = true;
      changed = true;
      continue;
    }
    slotState.ordered.unshift(dropId);
    slotState.enabled[dropId] = true;
    changed = true;
  }
  return changed;
}

export function cmdSetProcessRouting(state, { processId, routingPatch } = {}) {
  if (!processId || typeof processId !== "string") {
    return { ok: false, reason: "badProcessId" };
  }
  const found = findProcessById(state, processId);
  if (!found?.process) return { ok: false, reason: "noProcess" };
  const context = {
    target: found.target,
    systemId: found.systemId,
    leaderId: found.process?.leaderId ?? null,
  };
  const processDef = getProcessDefForInstance(found.process, found.target, context);
  if (!processDef) return { ok: false, reason: "noProcessDef" };
  ensureProcessRoutingState(found.process, processDef, context);

  const patch = routingPatch && typeof routingPatch === "object" ? routingPatch : {};
  let changed = false;

  for (const kind of ["inputs", "outputs"]) {
    const groupPatch = patch[kind];
    if (!groupPatch || typeof groupPatch !== "object") continue;
    const slots = found.process.routing?.[kind] || {};
    for (const [slotId, slotPatch] of Object.entries(groupPatch)) {
      if (!slots[slotId]) slots[slotId] = { ordered: [], enabled: {} };
      if (applyRoutingPatchToSlot(slots[slotId], slotPatch)) changed = true;
    }
  }

  if (enforceDropslotPriority(found.process, processDef)) changed = true;
  if (syncRoutingTemplateFromProcess(found.process, found.target, found.systemId, processDef)) {
    changed = true;
  }

  return { ok: true, changed };
}

export function cmdReorderProcessRoutingEndpoint(
  state,
  { processId, slotKind, slotId, fromIndex, toIndex } = {}
) {
  if (!processId || typeof processId !== "string") {
    return { ok: false, reason: "badProcessId" };
  }
  const found = findProcessById(state, processId);
  if (!found?.process) return { ok: false, reason: "noProcess" };
  const context = {
    target: found.target,
    systemId: found.systemId,
    leaderId: found.process?.leaderId ?? null,
  };
  const processDef = getProcessDefForInstance(found.process, found.target, context);
  if (!processDef) return { ok: false, reason: "noProcessDef" };
  ensureProcessRoutingState(found.process, processDef, context);

  const kind = normalizeSlotKind(slotKind);
  const slotState = found.process.routing?.[kind]?.[slotId];
  if (!slotState || !Array.isArray(slotState.ordered)) {
    return { ok: false, reason: "noSlot" };
  }

  const max = slotState.ordered.length - 1;
  const from = Number.isFinite(fromIndex) ? Math.floor(fromIndex) : -1;
  const to = Number.isFinite(toIndex) ? Math.floor(toIndex) : -1;
  if (from < 0 || from > max || to < 0 || to > max) {
    return { ok: false, reason: "badIndex" };
  }

  const dropId = processDef.supportsDropslot ? getDropEndpointId(processId) : null;
  const moving = slotState.ordered[from];
  if (dropId && moving === dropId) {
    return { ok: false, reason: "dropLocked" };
  }
  if (dropId && to === 0 && slotState.ordered[0] === dropId) {
    return { ok: false, reason: "dropLocked" };
  }

  const [moved] = slotState.ordered.splice(from, 1);
  slotState.ordered.splice(to, 0, moved);

  enforceDropslotPriority(found.process, processDef);
  syncRoutingTemplateFromProcess(found.process, found.target, found.systemId, processDef);

  return { ok: true, result: "reordered" };
}

export function cmdToggleProcessRoutingEndpoint(
  state,
  { processId, slotKind, slotId, endpointId, enabled } = {}
) {
  if (!processId || typeof processId !== "string") {
    return { ok: false, reason: "badProcessId" };
  }
  if (!endpointId || typeof endpointId !== "string") {
    return { ok: false, reason: "badEndpoint" };
  }
  const found = findProcessById(state, processId);
  if (!found?.process) return { ok: false, reason: "noProcess" };
  const context = {
    target: found.target,
    systemId: found.systemId,
    leaderId: found.process?.leaderId ?? null,
  };
  const processDef = getProcessDefForInstance(found.process, found.target, context);
  if (!processDef) return { ok: false, reason: "noProcessDef" };
  ensureProcessRoutingState(found.process, processDef, context);

  if (processDef.supportsDropslot && isDropEndpoint(endpointId)) {
    return { ok: false, reason: "dropLocked" };
  }

  const kind = normalizeSlotKind(slotKind);
  const slotState = found.process.routing?.[kind]?.[slotId];
  if (!slotState || typeof slotState !== "object") {
    return { ok: false, reason: "noSlot" };
  }
  if (!slotState.enabled || typeof slotState.enabled !== "object") {
    slotState.enabled = {};
  }
  slotState.enabled[endpointId] = enabled === true;
  syncRoutingTemplateFromProcess(found.process, found.target, found.systemId, processDef);
  return { ok: true, result: "toggled" };
}

// =============================================================================
// ROUTING TEMPLATE COMMANDS
// =============================================================================

function ensureTemplateSlotState(template, kind, slotId) {
  if (!template) return null;
  if (!template[kind] || typeof template[kind] !== "object") {
    template[kind] = {};
  }
  if (!template[kind][slotId] || typeof template[kind][slotId] !== "object") {
    template[kind][slotId] = { ordered: [], enabled: {} };
  }
  const slotState = template[kind][slotId];
  if (!Array.isArray(slotState.ordered)) slotState.ordered = [];
  if (!slotState.enabled || typeof slotState.enabled !== "object") {
    slotState.enabled = {};
  }
  return slotState;
}

function seedTemplateSlotWithCandidates(slotState, candidates) {
  if (!slotState) return false;
  const ordered = Array.isArray(slotState.ordered) ? slotState.ordered : [];
  const list = Array.isArray(candidates) ? candidates : [];
  let changed = false;
  if (ordered.length === 0 && list.length > 0) {
    slotState.ordered = list.slice();
    changed = true;
  }
  for (const endpointId of slotState.ordered) {
    if (slotState.enabled[endpointId] === undefined) {
      slotState.enabled[endpointId] = true;
      changed = true;
    }
  }
  return changed;
}

export function cmdSetRoutingTemplate(
  state,
  { targetRef, systemId, routingPatch } = {}
) {
  if (!targetRef || !systemId) {
    return { ok: false, reason: "badTarget" };
  }
  const target = findTargetByRef(state, targetRef);
  if (!target) return { ok: false, reason: "noTarget" };

  const process = getTemplateProcessForSystem(target, systemId, { state });
  if (!process) return { ok: false, reason: "noTemplateProcess" };
  const processDef = getProcessDefForInstance(process, target, {});
  if (!processDef) return { ok: false, reason: "noProcessDef" };

  const template = ensureSystemRoutingTemplate(target, systemId, processDef);
  if (!template) return { ok: false, reason: "noTemplate" };

  const patch = routingPatch && typeof routingPatch === "object" ? routingPatch : {};
  let changed = false;

  for (const kind of ["inputs", "outputs"]) {
    const groupPatch = patch[kind];
    if (!groupPatch || typeof groupPatch !== "object") continue;
    for (const [slotId, slotPatch] of Object.entries(groupPatch)) {
      const slotDef = resolveRoutingSlotDef(processDef, kind, slotId);
      if (!slotDef) return { ok: false, reason: "noSlot" };
      if (slotDef.locked) return { ok: false, reason: "slotLocked" };
      const slotState = ensureTemplateSlotState(template, kind, slotId);
      if (applyRoutingPatchToSlot(slotState, slotPatch)) changed = true;
      slotState.ordered = slotState.ordered.filter(
        (endpointId) => !isDropEndpoint(endpointId)
      );
      for (const key of Object.keys(slotState.enabled)) {
        if (isDropEndpoint(key)) delete slotState.enabled[key];
      }
    }
  }

  return { ok: true, changed };
}

export function cmdReorderRoutingTemplateEndpoint(
  state,
  { targetRef, systemId, slotKind, slotId, fromIndex, toIndex } = {}
) {
  if (!targetRef || !systemId) return { ok: false, reason: "badTarget" };
  const target = findTargetByRef(state, targetRef);
  if (!target) return { ok: false, reason: "noTarget" };

  const process = getTemplateProcessForSystem(target, systemId, { state });
  if (!process) return { ok: false, reason: "noTemplateProcess" };
  const processDef = getProcessDefForInstance(process, target, {});
  if (!processDef) return { ok: false, reason: "noProcessDef" };

  const slotDef = resolveRoutingSlotDef(processDef, slotKind, slotId);
  if (!slotDef) return { ok: false, reason: "noSlot" };
  if (slotDef.locked) return { ok: false, reason: "slotLocked" };

  const template = ensureSystemRoutingTemplate(target, systemId, processDef);
  if (!template) return { ok: false, reason: "noTemplate" };
  const kind = normalizeSlotKind(slotKind);
  const slotState = ensureTemplateSlotState(template, kind, slotId);

  if (slotState.ordered.length === 0) {
    const candidates = listCandidateEndpoints(
      state,
      process,
      slotDef,
      target,
      {}
    );
    seedTemplateSlotWithCandidates(slotState, candidates);
  }

  const max = slotState.ordered.length - 1;
  const from = Number.isFinite(fromIndex) ? Math.floor(fromIndex) : -1;
  const to = Number.isFinite(toIndex) ? Math.floor(toIndex) : -1;
  if (from < 0 || from > max || to < 0 || to > max) {
    return { ok: false, reason: "badIndex" };
  }

  const [moved] = slotState.ordered.splice(from, 1);
  slotState.ordered.splice(to, 0, moved);

  return { ok: true, result: "reordered" };
}

export function cmdToggleRoutingTemplateEndpoint(
  state,
  { targetRef, systemId, slotKind, slotId, endpointId, enabled } = {}
) {
  if (!targetRef || !systemId) return { ok: false, reason: "badTarget" };
  if (!endpointId || typeof endpointId !== "string") {
    return { ok: false, reason: "badEndpoint" };
  }
  const target = findTargetByRef(state, targetRef);
  if (!target) return { ok: false, reason: "noTarget" };

  const process = getTemplateProcessForSystem(target, systemId, { state });
  if (!process) return { ok: false, reason: "noTemplateProcess" };
  const processDef = getProcessDefForInstance(process, target, {});
  if (!processDef) return { ok: false, reason: "noProcessDef" };

  const slotDef = resolveRoutingSlotDef(processDef, slotKind, slotId);
  if (!slotDef) return { ok: false, reason: "noSlot" };
  if (slotDef.locked) return { ok: false, reason: "slotLocked" };

  const template = ensureSystemRoutingTemplate(target, systemId, processDef);
  if (!template) return { ok: false, reason: "noTemplate" };
  const kind = normalizeSlotKind(slotKind);
  const slotState = ensureTemplateSlotState(template, kind, slotId);

  if (slotState.ordered.length === 0) {
    const candidates = listCandidateEndpoints(
      state,
      process,
      slotDef,
      target,
      {}
    );
    seedTemplateSlotWithCandidates(slotState, candidates);
  }

  if (!slotState.enabled || typeof slotState.enabled !== "object") {
    slotState.enabled = {};
  }
  if (!isDropEndpoint(endpointId)) {
    slotState.enabled[endpointId] = enabled === true;
  }
  return { ok: true, result: "toggled" };
}

export function cmdMoveProcessBufferItem(
  state,
  { fromOwnerId, toOwnerId, itemId, targetGX, targetGY } = {}
) {
  if (fromOwnerId == null || toOwnerId == null) {
    return { ok: false, reason: "badOwner" };
  }
  const isProcessOwner = (ownerId) =>
    typeof ownerId === "string" && ownerId.startsWith("inv:process:");
  if (!isProcessOwner(fromOwnerId) && !isProcessOwner(toOwnerId)) {
    return { ok: false, reason: "notProcessBuffer" };
  }
  return cmdMoveItemBetweenOwners(state, {
    fromOwnerId,
    toOwnerId,
    itemId,
    targetGX,
    targetGY,
  });
}

// =============================================================================
// INVENTORY COMMANDS
// =============================================================================

function resolveCharacterOwnerId(ownerId) {
  if (typeof ownerId === "number") return ownerId;
  if (typeof ownerId === "string" && !ownerId.startsWith("inv:process:")) {
    const asNum = Number(ownerId);
    if (Number.isFinite(asNum)) return asNum;
  }
  return ownerId;
}

function getLeaderByOwnerId(state, ownerId) {
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  const normalized = resolveCharacterOwnerId(ownerId);
  const pawn = chars.find((ch) => ch && ch.id === normalized);
  if (!pawn || pawn.role !== "leader") return null;
  return pawn;
}

function getCharacterById(state, ownerId) {
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  const normalized = resolveCharacterOwnerId(ownerId);
  return chars.find((ch) => ch && ch.id === normalized) || null;
}

function ensureLeaderEquipment(leader) {
  if (!leader || leader.role !== "leader") return;
  if (!leader.equipment || typeof leader.equipment !== "object") {
    leader.equipment = createEmptyLeaderEquipment();
    return;
  }
  for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(leader.equipment, slotId)) {
      leader.equipment[slotId] = null;
    }
  }
}

function ensurePortableStorageState(owner, storageItem) {
  if (!storageItem || typeof storageItem !== "object") return null;
  if (!storageItem.systemState || typeof storageItem.systemState !== "object") {
    storageItem.systemState = {};
  }
  if (
    !storageItem.systemState.storage ||
    typeof storageItem.systemState.storage !== "object"
  ) {
    storageItem.systemState.storage = {};
  }
  const store = storageItem.systemState.storage;
  if (!store.byKindTier || typeof store.byKindTier !== "object") {
    store.byKindTier = {};
  }
  if (!store.totalByTier || typeof store.totalByTier !== "object") {
    store.totalByTier = {};
  }
  for (const tier of TIER_ASC) {
    if (!Number.isFinite(store.totalByTier[tier])) {
      store.totalByTier[tier] = 0;
    }
  }
  // Legacy save migration: move old leader-level basket store into item storage.
  const legacy =
    owner?.systemState?.basketStore && typeof owner.systemState.basketStore === "object"
      ? owner.systemState.basketStore
      : null;
  if (legacy && typeof legacy.byKindTier === "object") {
    const isStoreEmpty = Object.keys(store.byKindTier).length === 0;
    if (isStoreEmpty) {
      for (const [kind, rawBucket] of Object.entries(legacy.byKindTier)) {
        if (!rawBucket || typeof rawBucket !== "object") continue;
        if (!store.byKindTier[kind] || typeof store.byKindTier[kind] !== "object") {
          store.byKindTier[kind] = {};
        }
        const bucket = store.byKindTier[kind];
        for (const tier of TIER_ASC) {
          const qty = Math.max(0, Math.floor(rawBucket[tier] ?? 0));
          bucket[tier] = qty;
          store.totalByTier[tier] = Math.max(0, Math.floor(store.totalByTier[tier] ?? 0)) + qty;
        }
      }
    }
    delete owner.systemState.basketStore;
  }
  return store;
}

function getEquippedBasketEntry(leader, preferredSlotId = null) {
  if (!leader || leader.role !== "leader") return null;
  ensureLeaderEquipment(leader);
  return findEquippedPoolProviderEntry(
    leader,
    "storage",
    "byKindTier",
    preferredSlotId
  );
}

export function cmdDepositItemToEquippedBasket(
  state,
  { fromOwnerId, toOwnerId, itemId, slotId } = {}
) {
  if (fromOwnerId == null) return { ok: false, reason: "badFromOwner" };
  if (toOwnerId == null) return { ok: false, reason: "badToOwner" };
  if (itemId == null) return { ok: false, reason: "badItemId" };

  const fromInv = state?.ownerInventories?.[fromOwnerId];
  if (!fromInv) return { ok: false, reason: "noInventory" };

  const leader = getLeaderByOwnerId(state, toOwnerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  const basketEntry = getEquippedBasketEntry(leader, slotId);
  if (!basketEntry?.item) return { ok: false, reason: "noEquippedBasket" };

  const item =
    fromInv.itemsById?.[itemId] || fromInv.items?.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };
  if (
    item.id === basketEntry.item.id ||
    itemProvidesPool(item, "storage", "byKindTier")
  ) {
    return { ok: false, reason: "cannotDepositBasket" };
  }

  const qty = Math.max(0, Math.floor(item.quantity ?? 0));
  if (qty <= 0) return { ok: false, reason: "emptyStack" };

  const store = ensurePortableStorageState(leader, basketEntry.item);
  if (!store) return { ok: false, reason: "noBasketStore" };
  const pool = store.byKindTier;
  if (!pool || typeof pool !== "object") return { ok: false, reason: "noPool" };

  if (!pool[item.kind] || typeof pool[item.kind] !== "object") {
    pool[item.kind] = {};
  }
  const bucket = pool[item.kind];
  for (const tier of TIER_ASC) {
    if (!Number.isFinite(bucket[tier])) bucket[tier] = 0;
  }

  const tierRaw =
    typeof item.tier === "string" && item.tier.length > 0
      ? item.tier
      : itemDefs?.[item.kind]?.defaultTier || "bronze";
  const tier = TIER_ASC.includes(tierRaw) ? tierRaw : "bronze";
  bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + qty;
  store.totalByTier[tier] =
    Math.max(0, Math.floor(store.totalByTier[tier] ?? 0)) + qty;

  Inventory.removeItem(fromInv, item.id);
  Inventory.rebuildDerived(fromInv);
  bumpInvVersion(fromInv);

  return {
    ok: true,
    result: "basketDeposited",
    fromOwnerId,
    toOwnerId: leader.id,
    itemKind: item.kind,
    moved: qty,
    basketSlotId: basketEntry.slotId,
  };
}

export function cmdWithdrawPawnBasketPoolItem(
  state,
  { ownerId, itemId, amount, slotId } = {}
) {
  if (ownerId == null) return { ok: false, reason: "badOwner" };
  if (typeof itemId !== "string" || itemId.length === 0) {
    return { ok: false, reason: "badItemId" };
  }
  const requested = Math.max(1, Math.floor(amount ?? 1));
  if (requested <= 0) return { ok: false, reason: "badAmount" };

  const leader = getLeaderByOwnerId(state, ownerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  const basketEntry = getEquippedBasketEntry(leader, slotId);
  if (!basketEntry?.item) return { ok: false, reason: "noEquippedBasket" };

  const store = ensurePortableStorageState(leader, basketEntry.item);
  if (!store) return { ok: false, reason: "noBasketStore" };
  const pool = store.byKindTier;
  if (!pool || typeof pool !== "object") return { ok: false, reason: "noPool" };
  if (isTierBucket(pool)) return { ok: false, reason: "unsupportedPoolShape" };

  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") {
    return { ok: false, reason: "missingItemPool" };
  }

  const inv = state?.ownerInventories?.[leader.id];
  if (!inv) return { ok: false, reason: "noInventory" };

  let remaining = requested;
  let moved = 0;
  let spawnItemId = null;
  for (const tier of TIER_ASC) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
    if (available <= 0) continue;
    const want = Math.min(remaining, available);
    const addRes = addItemUnitsToInventoryWithTags(
      state,
      inv,
      itemId,
      tier,
      want,
      []
    );
    const added = Math.max(0, Math.floor(addRes?.added ?? 0));
    if (added <= 0) break;

    bucket[tier] = available - added;
    const total = Math.max(0, Math.floor(store.totalByTier[tier] ?? 0));
    store.totalByTier[tier] = Math.max(0, total - added);
    if (spawnItemId == null && addRes?.firstItemId != null) {
      spawnItemId = addRes.firstItemId;
    }
    moved += added;
    remaining -= added;
    if (added < want) break;
  }

  if (moved <= 0) {
    return { ok: false, reason: "noSpaceForWithdraw" };
  }

  const empty = TIER_ASC.every(
    (tier) => Math.max(0, Math.floor(bucket[tier] ?? 0)) <= 0
  );
  if (empty) delete pool[itemId];

  bumpInvVersion(inv);

  return {
    ok: true,
    result: "basketPoolWithdrawn",
    ownerId: leader.id,
    itemKind: itemId,
    requested,
    moved,
    spawnItemId,
    basketSlotId: basketEntry.slotId,
  };
}

export function cmdMoveItemBetweenOwners(
  state,
  { fromOwnerId, toOwnerId, itemId, targetGX, targetGY }
) {
  const fromInv = state.ownerInventories[fromOwnerId];
  const toInv = state.ownerInventories[toOwnerId];
  if (!fromInv || !toInv) return { ok: false, reason: "noInventory" };

  const item =
    fromInv.itemsById[itemId] || fromInv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  const ctx = { kind: "inventoryMove", state, events: [], out: null };

  runEffect(
    state,
    {
      op: "moveItem",
      fromOwnerId,
      toOwnerId,
      itemId,
      targetGX,
      targetGY,
    },
    ctx
  );

  return ctx.out || { ok: false, reason: "effectFailed" };
}

export function cmdEquipItemToLeaderSlot(
  state,
  { fromOwnerId, toOwnerId, itemId, slotId } = {}
) {
  if (!isLeaderEquipmentSlotId(slotId)) {
    return { ok: false, reason: "badSlot" };
  }

  const fromInv = state?.ownerInventories?.[fromOwnerId];
  if (!fromInv) return { ok: false, reason: "noInventory" };

  const leader = getLeaderByOwnerId(state, toOwnerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  ensureLeaderEquipment(leader);

  const item =
    fromInv.itemsById?.[itemId] || fromInv.items?.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };
  if (!canItemEquipInSlot(item, slotId)) {
    return { ok: false, reason: "slotMismatch" };
  }
  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  const current = leader.equipment[slotId] ?? null;
  if (current) return { ok: false, reason: "slotOccupied" };

  Inventory.removeItem(fromInv, item.id);
  Inventory.rebuildDerived(fromInv);
  bumpInvVersion(fromInv);

  leader.equipment[slotId] = item;
  if (itemProvidesPool(item, "storage", "byKindTier")) {
    ensurePortableStorageState(leader, item);
  }

  return {
    ok: true,
    result: "equipped",
    fromOwnerId,
    toOwnerId,
    itemId: item.id,
    slotId,
  };
}

export function cmdMoveLeaderEquipmentToInventory(
  state,
  { fromOwnerId, toOwnerId, slotId, targetGX, targetGY } = {}
) {
  if (!isLeaderEquipmentSlotId(slotId)) {
    return { ok: false, reason: "badSlot" };
  }

  const leader = getLeaderByOwnerId(state, fromOwnerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  ensureLeaderEquipment(leader);

  const item = leader.equipment[slotId] ?? null;
  if (!item) return { ok: false, reason: "emptySlot" };

  const toInv = state?.ownerInventories?.[toOwnerId];
  if (!toInv) return { ok: false, reason: "noInventory" };
  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  let gx = Number.isFinite(targetGX) ? Math.floor(targetGX) : null;
  let gy = Number.isFinite(targetGY) ? Math.floor(targetGY) : null;

  if (gx == null || gy == null) {
    let found = null;
    outer: for (let y = 0; y <= toInv.rows - item.height; y++) {
      for (let x = 0; x <= toInv.cols - item.width; x++) {
        if (Inventory.canPlaceItemAt(toInv, item, x, y)) {
          found = { gx: x, gy: y };
          break outer;
        }
      }
    }
    if (!found) return { ok: false, reason: "noSpace" };
    gx = found.gx;
    gy = found.gy;
  }

  const canPlace = Inventory.canPlaceItemAt(toInv, item, gx, gy);
  if (!canPlace) return { ok: false, reason: "blocked" };

  leader.equipment[slotId] = null;
  const attached = Inventory.attachExistingItem(toInv, item, gx, gy);
  if (!attached) {
    leader.equipment[slotId] = item;
    return { ok: false, reason: "attachFailed" };
  }

  Inventory.rebuildDerived(toInv);
  bumpInvVersion(toInv);

  return {
    ok: true,
    result: "unequipped",
    fromOwnerId,
    toOwnerId,
    itemId: item.id,
    slotId,
    gx,
    gy,
  };
}

export function cmdMoveLeaderEquipmentToSlot(
  state,
  { fromOwnerId, toOwnerId, fromSlotId, toSlotId } = {}
) {
  if (!isLeaderEquipmentSlotId(fromSlotId) || !isLeaderEquipmentSlotId(toSlotId)) {
    return { ok: false, reason: "badSlot" };
  }

  const fromLeader = getLeaderByOwnerId(state, fromOwnerId);
  const toLeader = getLeaderByOwnerId(state, toOwnerId);
  if (!fromLeader || !toLeader) return { ok: false, reason: "noLeader" };
  ensureLeaderEquipment(fromLeader);
  ensureLeaderEquipment(toLeader);

  if (fromOwnerId === toOwnerId && fromSlotId === toSlotId) {
    return { ok: true, result: "noChange" };
  }

  const item = fromLeader.equipment[fromSlotId] ?? null;
  if (!item) return { ok: false, reason: "emptySlot" };
  if (!canItemEquipInSlot(item, toSlotId)) {
    return { ok: false, reason: "slotMismatch" };
  }
  if (toLeader.equipment[toSlotId] != null) {
    return { ok: false, reason: "slotOccupied" };
  }
  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  fromLeader.equipment[fromSlotId] = null;
  toLeader.equipment[toSlotId] = item;
  if (itemProvidesPool(item, "storage", "byKindTier")) {
    ensurePortableStorageState(toLeader, item);
  }

  return {
    ok: true,
    result: "equippedMoved",
    fromOwnerId,
    toOwnerId,
    fromSlotId,
    toSlotId,
    itemId: item.id,
  };
}

export function cmdSplitStackAndPlace(
  state,
  ownerId,
  itemId,
  amount,
  targetGX,
  targetGY
) {
  const inv = state.ownerInventories[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  const item =
    inv.itemsById[itemId] || inv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  const splitAmount = Math.floor(amount);
  if (splitAmount <= 0 || splitAmount >= item.quantity) {
    return { ok: false, reason: "badAmount" };
  }

  const ctx = { kind: "inventorySplit", state, events: [], out: null };

  runEffect(
    state,
    {
      op: "splitStack",
      ownerId,
      itemId,
      amount: splitAmount,
      targetGX,
      targetGY,
    },
    ctx
  );

  return ctx.out || { ok: false, reason: "effectFailed" };
}

export function cmdStackItemsInOwner(
  state,
  { ownerId, sourceItemId, targetItemId, amount }
) {
  const inv = state.ownerInventories[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  const ctx = { kind: "inventoryStack", state, events: [], out: null };

  runEffect(
    state,
    {
      op: "stackItem",
      ownerId,
      sourceItemId,
      targetItemId,
      amount,
    },
    ctx
  );

  return ctx.out || { ok: false, reason: "effectFailed" };
}

export function cmdDiscardItemFromOwner(state, { ownerId, itemId } = {}) {
  if (ownerId == null) return { ok: false, reason: "badOwner" };
  if (itemId == null) return { ok: false, reason: "badItem" };

  const inv = state?.ownerInventories?.[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  Inventory.rebuildDerived(inv);
  const item =
    inv.itemsById[itemId] || inv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  Inventory.removeItem(inv, item.id);
  Inventory.rebuildDerived(inv);
  bumpInvVersion(inv);

  return { ok: true, result: "discarded", ownerId, itemId };
}

// =============================================================================
// SKILL TREE
// =============================================================================

export function cmdUnlockSkillNode(
  state,
  { characterId, pawnId, nodeId } = {}
) {
  const resolvedCharacterId =
    characterId != null ? characterId : pawnId != null ? pawnId : null;
  if (resolvedCharacterId == null) {
    return { ok: false, reason: "badCharacterId" };
  }
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return { ok: false, reason: "badNodeId" };
  }

  const character = getCharacterById(state, resolvedCharacterId);
  if (!character) return { ok: false, reason: "noCharacter" };

  const evaluation = evaluateSkillNodeUnlock(state, character.id, nodeId);
  if (!evaluation?.ok) {
    return { ok: false, reason: evaluation?.reason || "notUnlockable" };
  }

  const cost = Number.isFinite(evaluation.cost)
    ? Math.max(0, Math.floor(evaluation.cost))
    : 0;
  const currentPoints = Number.isFinite(character.skillPoints)
    ? Math.max(0, Math.floor(character.skillPoints))
    : 0;
  if (currentPoints < cost) {
    return { ok: false, reason: "insufficientSkillPoints" };
  }

  const nextUnlocked = Array.isArray(character.unlockedSkillNodeIds)
    ? character.unlockedSkillNodeIds.slice()
    : [];
  if (!nextUnlocked.includes(nodeId)) {
    nextUnlocked.push(nodeId);
  }
  nextUnlocked.sort((a, b) => String(a).localeCompare(String(b)));

  character.skillPoints = currentPoints - cost;
  character.unlockedSkillNodeIds = nextUnlocked;

  const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
  state.actionPointCap = getApCapForSecond(state, nowSec);
  state.actionPoints = Math.min(
    Math.max(0, Math.floor(state.actionPoints ?? 0)),
    state.actionPointCap
  );

  return {
    ok: true,
    result: "skillNodeUnlocked",
    characterId: character.id,
    nodeId,
    spent: cost,
    remainingSkillPoints: character.skillPoints,
  };
}

// =============================================================================
// FOLLOWER COMMANDS
// =============================================================================

export function cmdAdjustFollowerCount(state, payload = {}) {
  const leaderId = Number.isFinite(payload.leaderId)
    ? Math.floor(payload.leaderId)
    : null;
  if (leaderId == null) return { ok: false, reason: "badLeaderId" };

  const delta = Number.isFinite(payload.delta) ? Math.trunc(payload.delta) : 0;
  if (delta === 0) return { ok: true, result: "noChange", leaderId };

  return adjustFollowerCount(state, leaderId, delta);
}

// =============================================================================
// CHARACTER PLACEMENT
// =============================================================================

export function cmdPlaceCharacter(state, payload = {}) {
  const { charId, hubCol } = payload;
  const ch = state.characters.find((c) => c.id === charId);
  if (!ch) return { ok: false, reason: "noCharacter" };

  const toPlacement =
    payload.toPlacement ||
    (Number.isFinite(payload.toEnvCol) || Number.isFinite(payload.envCol)
      ? {
          envCol: Number.isFinite(payload.toEnvCol)
            ? payload.toEnvCol
            : payload.envCol,
        }
      : Number.isFinite(payload.toHubCol) || Number.isFinite(hubCol)
      ? {
          hubCol: Number.isFinite(payload.toHubCol)
            ? payload.toHubCol
            : hubCol,
        }
      : null);

  if (!toPlacement) {
    return { ok: false, reason: "badPlacement" };
  }

  const isEnvTarget = Number.isFinite(toPlacement.envCol);
  const rawCol = isEnvTarget ? toPlacement.envCol : toPlacement.hubCol;
  if (!Number.isFinite(rawCol)) {
    return { ok: false, reason: "badHubCol" };
  }
  const col = Math.floor(rawCol);
  const envCols = Number.isFinite(state?.board?.cols)
    ? Math.floor(state.board.cols)
    : 0;
  const hubCols = Array.isArray(state?.hub?.slots)
    ? state.hub.slots.length
    : 0;
  const cols = isEnvTarget ? envCols : hubCols;

  if (col < 0 || col >= cols) {
    return { ok: false, reason: isEnvTarget ? "badEnvCol" : "badHubCol" };
  }

  let nextEnvCol = null;
  let nextHubCol = null;

  if (isEnvTarget) {
    const tile = state?.board?.occ?.tile?.[col] ?? null;
    if (!tile) return { ok: false, reason: "noTile" };
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    for (const tag of tags) {
      const def = envTagDefs[tag];
      const aff = Array.isArray(def?.affordances) ? def.affordances : [];
      if (aff.includes("noOccupy")) {
        return { ok: false, reason: "tileBlocked" };
      }
    }
    nextEnvCol = col;
  } else {
    let hubTargetCol = col;
    const hubOcc = state?.hub?.occ;
    if (Array.isArray(hubOcc)) {
      const anchor = hubOcc[col];
      if (anchor && Number.isFinite(anchor.col)) {
        hubTargetCol = Math.floor(anchor.col);
      }
    }
    if (hubTargetCol < 0 || hubTargetCol >= hubCols) {
      return { ok: false, reason: "badHubCol" };
    }
    nextHubCol = hubTargetCol;
  }

  ch.hubCol = nextHubCol;
  ch.envCol = nextEnvCol;
  ensurePawnAI(ch);
  if (payload.skipAutoSuppress !== true) {
    const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
    ch.ai.mode = null;
    ch.ai.suppressAutoUntilSec =
      nowSec + PAWN_AI_SUPPRESS_AFTER_PLAYER_MOVE_SEC;
  }

  maybeAutoFollowLeader(state, ch);

  return {
    ok: true,
    result: "placed",
    charId,
    envCol: nextEnvCol,
    hubCol: nextHubCol,
  };
}

function shouldFollowersAutoFollow(leader) {
  const flag = leader?.systemState?.leadership?.followersAutoFollow;
  return typeof flag === "boolean" ? flag : true;
}

function getFollowersForLeaderSorted(state, leaderId) {
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  const followers = chars.filter(
    (c) => c && c.role === "follower" && c.leaderId === leaderId
  );
  followers.sort((a, b) => {
    const ai = Number.isFinite(a?.followerCreationOrderIndex)
      ? a.followerCreationOrderIndex
      : 0;
    const bi = Number.isFinite(b?.followerCreationOrderIndex)
      ? b.followerCreationOrderIndex
      : 0;
    if (ai !== bi) return ai - bi;
    return (a?.id ?? 0) - (b?.id ?? 0);
  });
  return followers;
}

function maybeAutoFollowLeader(state, leader) {
  if (!leader || leader.role !== "leader") return;
  if (!shouldFollowersAutoFollow(leader)) return;

  const followers = getFollowersForLeaderSorted(state, leader.id);
  if (!followers.length) return;

  const hubCol = Number.isFinite(leader.hubCol) ? Math.floor(leader.hubCol) : null;
  const envCol = Number.isFinite(leader.envCol) ? Math.floor(leader.envCol) : null;

  for (const follower of followers) {
    if (!follower) continue;
    if (hubCol != null) {
      follower.hubCol = hubCol;
      follower.envCol = null;
    } else if (envCol != null) {
      follower.envCol = envCol;
      follower.hubCol = null;
    }
  }
}

// =============================================================================
// DEBUG / CHEATS
// =============================================================================

export function cmdDebugSetCap(state, { cap, points, enabled } = {}) {
  normalizeApState(state);

  const enableOverride =
    typeof enabled === "boolean"
      ? enabled
      : typeof cap === "number" || typeof points === "number";

  if (enableOverride) {
    const overrideCap =
      typeof cap === "number"
        ? Math.max(0, Math.floor(cap))
        : Math.max(0, Math.floor(state.actionPointCap ?? 0));
    const overridePoints =
      typeof points === "number" ? Math.floor(points) : overrideCap;

    state.apCapOverride = {
      enabled: true,
      cap: overrideCap,
      points: overridePoints,
    };

    state.actionPointCap = overrideCap;
    state.actionPoints = Math.min(
      state.actionPointCap,
      Math.max(0, overridePoints)
    );
  } else {
    state.apCapOverride = null;
    state.actionPointCap = getApCapForSecond(state, state.tSec ?? 0);
    state.actionPoints = Math.min(state.actionPoints, state.actionPointCap);
  }

  return {
    ok: true,
    actionPointCap: state.actionPointCap,
    actionPoints: state.actionPoints,
    apCapOverride: state.apCapOverride,
  };
}

export function cmdDebugQueueEnvEvent(state, { defId } = {}) {
  if (!defId || typeof defId !== "string") {
    return { ok: false, reason: "badDefId" };
  }
  if (!envEventDefs[defId]) {
    return { ok: false, reason: "unknownEvent" };
  }

  const seasonKey = getCurrentSeasonKey(state);
  if (
    !state.currentSeasonDeck ||
    state.currentSeasonDeck.seasonKey !== seasonKey
  ) {
    buildSeasonDeckForCurrentSeason(state);
  }
  if (!state.currentSeasonDeck || !Array.isArray(state.currentSeasonDeck.deck)) {
    state.currentSeasonDeck = { seasonKey, deck: [] };
  }

  state.currentSeasonDeck.deck.unshift({ defId });
  return { ok: true, result: "eventQueued", defId };
}

// =============================================================================
// OWNER/INVENTORY ACCEPTANCE RULES
// =============================================================================

function getOwnerKindAndDef(state, ownerId) {
  const normalizedOwnerId =
    typeof ownerId === "string" && !ownerId.startsWith("inv:process:")
      ? Number.isFinite(Number(ownerId))
        ? Number(ownerId)
        : ownerId
      : ownerId;
  if (typeof ownerId === "string" && ownerId.startsWith("inv:process:")) {
    return { kind: "processBuffer", def: null };
  }
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    if (slot.structure && slot.structure.instanceId === normalizedOwnerId) {
      const def = hubStructureDefs[slot.structure.defId];
      return { kind: "hubStructure", def, structure: slot.structure };
    }
  }

  const ch = state.characters.find((c) => c.id === normalizedOwnerId);
  if (ch) return { kind: "character", def: null };

  return { kind: null, def: null };
}

function itemHasAnyTag(item, tags) {
  if (!tags || tags.length === 0) return false;
  const itemTags = Array.isArray(item?.tags) ? item.tags : [];
  return tags.some((t) => itemTags.includes(t));
}

export function canOwnerAcceptItem(state, ownerId, item) {
  const { kind, def, structure } = getOwnerKindAndDef(state, ownerId);

  if (kind === "character") {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    if (tags.includes("waste")) return false;
    return true;
  }

  if (kind === "processBuffer") {
    return true;
  }

  if (kind === "hubStructure" && def) {
    if (isStructureUnderConstruction(structure)) return true;
    const rules = def.inventoryRules;
    if (!rules) return true;
    if (rules.allowedAll) return true;

    if (rules.allowedItemTags && rules.allowedItemTags.length > 0) {
      if (!itemHasAnyTag(item, rules.allowedItemTags)) return false;
    }

    return true;
  }

  return false;
}

