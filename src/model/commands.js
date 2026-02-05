// src/model/commands.js
// public mutation APIs (cmd*) + move rules

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../defs/gamesystems/env-systems-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { validateHubConstructionPlacement } from "./build-helpers.js";
import {
  SEASON_DURATION_SEC,
  AP_INCOME_PER_SEC,
  AP_INCOME_MULT_WAXING,
  AP_INCOME_MULT_WANING,
} from "../defs/gamesettings/gamerules-defs.js";

import {
  getCurrentSeasonKey,
  buildSeasonDeckForCurrentSeason,
  makeHubStructureInstance,
  ensureHubState,
  rebuildHubOccupancy,
} from "./state.js";

import {
  runEffect,
  processSecondChangeForItems,
} from "./effects.js";

import { Inventory } from "./inventory-model.js";
import { bumpInvVersion } from "./effects/core/inventory-version.js";
import { stepPawnSecond } from "./pawn-exec.js";
import { stepEnvSecond } from "./env-exec.js";
import { stepHubSecond } from "./hub-exec.js";
import { getActionPointCapAtSecond, isMoonWaxingAtSecond } from "./moon.js";
import { adjustFollowerCount, enforcePrestigeFollowerCap } from "./prestige-system.js";

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
  return getActionPointCapAtSecond(tSec);
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

function normalizeBuildRequirements(def) {
  const raw = Array.isArray(def?.build?.requirements) ? def.build.requirements : [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const amountRaw = entry.amount;
    const amount = Number.isFinite(amountRaw) ? Math.max(0, Math.floor(amountRaw)) : 0;
    if (amount <= 0) continue;

    const kind =
      typeof entry.kind === "string" && entry.kind.length
        ? entry.kind
        : null;
    const itemId =
      typeof entry.itemId === "string" && entry.itemId.length
        ? entry.itemId
        : null;
    const tag =
      typeof entry.tag === "string" && entry.tag.length
        ? entry.tag
        : typeof entry.itemTag === "string" && entry.itemTag.length
        ? entry.itemTag
        : null;
    const resource =
      typeof entry.resource === "string" && entry.resource.length
        ? entry.resource
        : null;

    if (kind === "item" || (!kind && itemId)) {
      if (!itemId) continue;
      out.push({ kind: "item", itemId, amount });
      continue;
    }
    if (kind === "tag" || (!kind && tag)) {
      if (!tag) continue;
      out.push({ kind: "tag", tag, amount });
      continue;
    }
    if (kind === "resource" || (!kind && resource)) {
      if (!resource) continue;
      out.push({ kind: "resource", resource, amount });
      continue;
    }
  }
  return out;
}

function createConstructionState(def, tSec) {
  const laborRaw = def?.build?.laborSec ?? def?.build?.labor ?? 0;
  const laborRequiredSec = Number.isFinite(laborRaw)
    ? Math.max(0, Math.floor(laborRaw))
    : 0;
  const requirements = normalizeBuildRequirements(def).map((req) => ({
    ...req,
    progress: 0,
  }));
  return {
    status: "underConstruction",
    startedSec: Number.isFinite(tSec) ? Math.floor(tSec) : 0,
    laborRequiredSec,
    laborProgress: 0,
    requirements,
  };
}

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
  const structure = makeHubStructureInstance(defId, state);
  structure.build = createConstructionState(def, state?.tSec ?? 0);

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
  if (structure?.build?.status !== "underConstruction") {
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
    stepPawnSecond(state, state.tSec);
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

function setTagDisabled(target, tagId, disabled) {
  if (!target || !tagId) return { changed: false, disabled: false };
  const entry =
    target.tagStates && typeof target.tagStates === "object"
      ? target.tagStates[tagId]
      : null;
  const wasDisabled = entry?.disabled === true;
  const nextDisabled = disabled === true;

  if (nextDisabled) {
    if (wasDisabled) return { changed: false, disabled: true };
    if (!target.tagStates || typeof target.tagStates !== "object") {
      target.tagStates = {};
    }
    if (entry && typeof entry === "object") {
      entry.disabled = true;
    } else {
      target.tagStates[tagId] = { disabled: true };
    }
    return { changed: true, disabled: true };
  }

  if (!entry) return { changed: false, disabled: false };
  if (entry && typeof entry === "object") {
    if (entry.disabled) delete entry.disabled;
    if (Object.keys(entry).length === 0) {
      delete target.tagStates[tagId];
    }
  } else {
    delete target.tagStates[tagId];
  }
  if (
    target.tagStates &&
    typeof target.tagStates === "object" &&
    Object.keys(target.tagStates).length === 0
  ) {
    delete target.tagStates;
  }
  return { changed: wasDisabled, disabled: false };
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

  const currentDisabled = tile?.tagStates?.[tagId]?.disabled === true;
  const nextDisabled =
    typeof disabled === "boolean" ? disabled : !currentDisabled;
  const result = setTagDisabled(tile, tagId, nextDisabled);

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

  const currentDisabled = structure?.tagStates?.[tagId]?.disabled === true;
  const nextDisabled =
    typeof disabled === "boolean" ? disabled : !currentDisabled;
  const result = setTagDisabled(structure, tagId, nextDisabled);

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
// INVENTORY COMMANDS
// =============================================================================

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
    state.actionPointCap = getActionPointCapAtSecond(state.tSec ?? 0);
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
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    if (slot.structure && slot.structure.instanceId === ownerId) {
      const def = hubStructureDefs[slot.structure.defId];
      return { kind: "hubStructure", def, structure: slot.structure };
    }
  }

  const ch = state.characters.find((c) => c.id === ownerId);
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

  if (kind === "hubStructure" && def) {
    if (structure?.build?.status === "underConstruction") return true;
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

