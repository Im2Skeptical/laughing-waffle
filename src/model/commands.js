// src/model/commands.js
// public mutation APIs (cmd*) + move rules

import { hubStructureDefs}  from "../defs/gamepieces/hub-structures-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../defs/gamesystems/env-systems-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import {
  SEASON_DURATION_SEC,
  AP_INCOME_PER_SEC,
  AP_INCOME_MULT_WAXING,
  AP_INCOME_MULT_WANING,
} from "../defs/gamesettings/gamerules-defs.js";

import {
  getCurrentSeasonKey,
  buildSeasonDeckForCurrentSeason,
} from "./state.js";

import {
  runEffect,
  processSeasonChangeForItems,
  processSecondChangeForItems,
} from "./effects.js";

import { stepPawnSecond } from "./pawn-exec.js";
import { stepEnvSecond } from "./env-exec.js";

import { resetTimedTriggersOnHubStructures } from "./behaviors.js";
import { getActionPointCapAtSecond, isMoonWaxingAtSecond } from "./moon.js";

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

  // 3) process item/hub-structure seasonal effects
  processSeasonChangeForItems(state);

  // 4) reset season-scoped triggers
  resetTimedTriggersOnHubStructures(state);

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

    // Contract: item decay/expiry runs only on integer second boundaries.
    processSecondChangeForItems(state);
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
    stepPawnSecond(state, state.tSec);
    stepEnvSecond(state, state.tSec);
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
    ch.envCol = col;
    ch.hubCol = null;
    return { ok: true, result: "placed", charId, envCol: col };
  }

  ch.hubCol = col;
  ch.envCol = null;
  return { ok: true, result: "placed", charId, hubCol: col };
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

// =============================================================================
// OWNER/INVENTORY ACCEPTANCE RULES
// =============================================================================

function getOwnerKindAndDef(state, ownerId) {
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    if (slot.structure && slot.structure.instanceId === ownerId) {
      const def = hubStructureDefs[slot.structure.defId];
      return { kind: "hubStructure", def };
    }
  }

  const ch = state.characters.find((c) => c.id === ownerId);
  if (ch) return { kind: "character", def: null };

  return { kind: null, def: null };
}

function itemHasAnyTag(item, tags) {
  if (!tags || tags.length === 0) return false;
  const def = itemDefs[item.kind];
  const itemTags = def?.tags || [];
  return tags.some((t) => itemTags.includes(t));
}

export function canOwnerAcceptItem(state, ownerId, item) {
  const { kind, def } = getOwnerKindAndDef(state, ownerId);

  if (kind === "character") {
    const idef = itemDefs[item.kind];
    const tags = idef?.tags || [];
    if (tags.includes("waste")) return false;
    return true;
  }

  if (kind === "hubStructure" && def) {
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

