// src/model/commands.js
// public mutation APIs (cmd*) + move rules

import { permanentDefs, itemDefs } from "../defs/gamepieces/gamepieces-defs.js";
import {
  SEASON_DURATION_SEC,
  AP_INCOME_PER_SEC,
  AP_INCOME_MULT_WAXING,
  AP_INCOME_MULT_WANING,
} from "../defs/gamesettings/gamerules-defs.js";

import {
  getCurrentSeasonKey,
  refillEnvSlots,
  drawEnvDefId,
  makeEnvInstance,
} from "./state.js";

import {
  runEffect,
  applySeasonEndForEnvCard,
  processSeasonChangeForItems,
  processSecondChangeForItems,
} from "./effects.js";

import { stepEnvSecond } from "./env-exec.js";

import { resetTimedTriggersOnPermanents } from "./behaviors.js";
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

  // Defensive: ensure season deck/discard containers exist (older saves / test harnesses).
  if (!state.envSeasons) state.envSeasons = {};
  const oldSeasonData =
    state.envSeasons[oldSeasonKey] ||
    (state.envSeasons[oldSeasonKey] = { deck: [], discard: [] });
  if (!Array.isArray(oldSeasonData.deck)) oldSeasonData.deck = [];
  if (!Array.isArray(oldSeasonData.discard)) oldSeasonData.discard = [];

  // 1) env cards -> discard / recycle
  // Make sure any season-end cleanup runs before we swap the season.
  if (state.envSlots && state.envSlots.length > 0) {
    for (let i = 0; i < state.envSlots.length; i++) {
      const slot = state.envSlots[i];
      if (slot?.env) {
        // NOTE: applySeasonEndForEnvCard expects the slot object + the old season's deck/discard container.
        applySeasonEndForEnvCard(state, slot, oldSeasonData);
      }
    }
  }

  // 2) advance season index deterministically
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

  // 3) draw next season decks / ensure env season data exists
  if (!state.envSeasons) state.envSeasons = {};
  if (!state.envSeasons[newSeasonKey]) {
    // IMPORTANT: must match state.js expectations (deck/discard), not legacy envDeck/envDiscard
    state.envSeasons[newSeasonKey] = { deck: [], discard: [] };
  }

  // Refill env slots as needed (preserve prior semantics)
  refillEnvSlots(state);

  // 4) process item/permanent seasonal effects
  processSeasonChangeForItems(state);

  // 5) reset season-scoped triggers
  resetTimedTriggersOnPermanents(state);

  return { ok: true, oldSeasonKey, newSeasonKey: getCurrentSeasonKey(state) };
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

    // Legacy alias: planningIndex is treated as tSec for boundary/checkpoint consumers.
    state.planningIndex = state.tSec;

    processSecondChangeForItems(state);
  }

  let advancedSeasonCount = 0;

  // 2. Advance Game Simulation
  const scaledDt = dt;

  // Legacy float axis
  state.simTime = (state.simTime ?? 0) + scaledDt;

  // Season progression: time-based, not boundary-based.
  advancedSeasonCount = maybeAdvanceSeasonBySimTime(state, scaledDt);

  // Legacy remaining-time fields (HUD/debug). Keep them deterministic.
  const dur =
    typeof state.seasonDurationSec === "number" && state.seasonDurationSec > 0
      ? state.seasonDurationSec
      : DEFAULT_SEASON_DURATION_SEC;
  state.seasonTimeRemaining = Math.max(0, dur - (state.seasonClockSec ?? 0));

  state._seasonChanged =
    state._seasonChanged === true || advancedSeasonCount > 0;

  if (didAdvanceSecond) {
    stepEnvSecond(state, state.tSec);
    if (state._seasonChanged) state._seasonChanged = false;
  }

  return {
    ok: true,
    advancedSeason: advancedSeasonCount > 0,
    advancedSeasonCount,
  };
}

// Refill a specific env slot if empty (preserves prior per-slot refill timing semantics).
export function cmdRefillEnvSlot(state, envSlotIndex) {
  if (typeof envSlotIndex !== "number" || !Number.isFinite(envSlotIndex)) {
    return { ok: false, reason: "badEnvSlotIndex" };
  }

  const slot = state.envSlots?.[envSlotIndex];
  if (!slot) return { ok: false, reason: "noEnvSlot" };

  if (slot.env) return { ok: true, filled: false };

  const nextDefId = drawEnvDefId(state);
  if (!nextDefId) return { ok: true, filled: false, exhausted: true };

  slot.env = makeEnvInstance(nextDefId, state);
  return { ok: true, filled: true, defId: nextDefId };
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

export function cmdSetTileTagOrder(state, { tileCol, tagIds }) {
  if (!Number.isFinite(tileCol)) return { ok: false, reason: "badTileCol" };
  if (!Array.isArray(tagIds)) return { ok: false, reason: "badTagIds" };

  const col = Math.floor(tileCol);
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
  return { ok: true, result: "tagOrderSet", tileCol: col };
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

export function cmdPlaceCharacterInSlot(state, { charId, slotIndex }) {
  const ch = state.characters.find((c) => c.id === charId);
  if (!ch) return { ok: false, reason: "noCharacter" };

  if (typeof slotIndex !== "number" || !Number.isFinite(slotIndex)) {
    return { ok: false, reason: "badSlotIndex" };
  }

  const slot = state.permanentSlots?.[slotIndex];
  if (!slot) return { ok: false, reason: "noSlot" };
  if (!slot.permanent) return { ok: false, reason: "noPermanent" };

  ch.slotIndex = slotIndex;
  return { ok: true, result: "placed", charId, slotIndex };
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

export function cmdDebugToggleTilePawn(state, { tileCol } = {}) {
  if (!Number.isFinite(tileCol)) return { ok: false, reason: "badTileCol" };
  const col = Math.floor(tileCol);
  const cols = state.board?.cols ?? 12;
  if (col < 0 || col >= cols) return { ok: false, reason: "badTileCol" };

  if (
    !Array.isArray(state.tilePawnsByCol) ||
    state.tilePawnsByCol.length !== cols
  ) {
    state.tilePawnsByCol = new Array(cols).fill(false);
  }

  state.tilePawnsByCol[col] = !state.tilePawnsByCol[col];
  return { ok: true, tileCol: col, present: state.tilePawnsByCol[col] };
}

// =============================================================================
// OWNER/INVENTORY ACCEPTANCE RULES
// =============================================================================

function getOwnerKindAndDef(state, ownerId) {
  for (const slot of state.permanentSlots) {
    if (slot.permanent && slot.permanent.instanceId === ownerId) {
      const def = permanentDefs[slot.permanent.defId];
      return { kind: "permanent", def };
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

  if (kind === "permanent" && def) {
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

