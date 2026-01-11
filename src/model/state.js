// state.js — core GameState shape + RNG helpers + env decks + serialize/deserialize
// Model-only. No view imports.

import {
  SEASONS,
  envCardDefs,
  permanentDefs,
  SEASON_DURATION_SEC,
} from "../defs/defs.js";
import { attachRngHelpers } from "./rng.js";

// =============================================================================
// PHASE / PAUSE POLICY (Stage 5)
// =============================================================================

// Single source of truth for pause → phase semantics.
// POLICY ONLY: phase remains non-authoritative.
export function syncPhaseToPaused(state) {
  if (!state) return;
  state.phase = state.paused ? "planning" : "simulation";
}

// =============================================================================
// CORE STATE
// =============================================================================

export function createEmptyState(seed = 123456789) {
  const state = {
    phase: "simulation",
    turn: 0,
    seasons: SEASONS,
    currentSeasonIndex: 0,

    // Time Axis (Integer-based)
    // simStepIndex: Master clock, increments +1 per fixed tick (1/60s).
    // tSec: Derived integer seconds = floor(simStepIndex / 60).
    simStepIndex: 0,
    tSec: 0,

    // Legacy Float Time (kept for compatibility, driven by simStepIndex in commands)
    simTimeRemaining: 0,

    // Stage 5: renamed remaining clock (legacy field kept until full migration)
    seasonTimeRemaining: 0,
    seasonDurationSec: SEASON_DURATION_SEC,

    simTime: 0, // Accumulator for floating point calculations if needed

    // Season clock accumulator (decoupled from planning/boundary indices).
    // Counts SIMULATION time only (dt * timeScale while phase === "simulation").
    seasonClockSec: 0,

    timeScale: 1,
    paused: false,

    // Action Points (Skeleton)
    actionPoints: 100,
    actionPointCap: 100,

    resources: { gold: 0, food: 0, population: 0 },

    permanentSlots: [],
    nextPermanentInstanceId: 1,

    envSlots: [],
    envSeasons: {},
    nextEnvInstanceId: 1,

    ownerInventories: {},

    nextItemId: 1,

    characters: [],
    nextCharacterId: 101,

    rng: { seed },
  };

  attachRngHelpers(state);
  return state;
}

// Singleton used by the running game (kept for compatibility at the app edge only)
export const gameState = createEmptyState();

// =============================================================================
// INSTANCE CREATION (core; used by init + effects)
// =============================================================================

export function makePermanentInstance(defId, state) {
  const def = permanentDefs[defId];
  const inst = {
    instanceId: state.nextPermanentInstanceId++,
    defId,
    props: {},
  };
  initializeInstanceFromDef(inst, def);
  return inst;
}

export function makeEnvInstance(defId, state) {
  const def = envCardDefs[defId];
  const inst = { instanceId: state.nextEnvInstanceId++, defId, props: {} };
  initializeInstanceFromDef(inst, def);
  return inst;
}

export function initializeInstanceFromDef(instance, def) {
  const props = instance.props;
  for (const beh of def?.behaviors || []) {
    const bprops = beh.props || {};
    switch (beh.kind) {
      case "TimedTrigger":
        if (
          bprops.timerKey &&
          bprops.periodKey &&
          bprops.defaultPeriod != null
        ) {
          props[bprops.timerKey] = bprops.defaultPeriod;
          props[bprops.periodKey] = bprops.defaultPeriod;
        }
        break;

      case "HasPool":
        if (bprops.poolKey && bprops.defaultPool != null) {
          props[bprops.poolKey] = bprops.defaultPool;
          props[`_${bprops.poolKey}Max`] = bprops.defaultPool;
        }
        break;

      case "TimedLife":
        if (bprops.timerKey && bprops.defaultLife != null) {
          props[bprops.timerKey] = bprops.defaultLife;
        }
        break;

      case "TimedTransform":
        if (bprops.timerKey && bprops.defaultTime != null) {
          props[bprops.timerKey] = bprops.defaultTime;
        }
        break;

      default:
        break;
    }
  }
}

// =============================================================================
// ENV DECKS + DRAW
// =============================================================================

function shuffleArray(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = state.rngNextInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function buildInitialEnvDecks(state) {
  state.envSeasons = {};

  for (const season of state.seasons) {
    const seasonData = { deck: [], discard: [] };

    if (season === "autumn") {
      for (let i = 0; i < 10; i++) seasonData.deck.push("barren_autumn");
      for (let i = 0; i < 10; i++) seasonData.deck.push("flood_autumn");
    } else {
      let barrenId;
      switch (season) {
        case "spring":
          barrenId = "barren_spring";
          break;
        case "summer":
          barrenId = "barren_summer";
          break;
        case "winter":
          barrenId = "barren_winter";
          break;
        default:
          barrenId = "barren_spring";
          break;
      }
      for (let i = 0; i < 10; i++) seasonData.deck.push(barrenId);
    }

    for (let i = 0; i < 5; i++) seasonData.deck.push("rock");

    shuffleArray(state, seasonData.deck);
    state.envSeasons[season] = seasonData;
  }
}

export function getCurrentSeasonKey(state) {
  return state.seasons[state.currentSeasonIndex];
}

export function getCurrentSeasonData(state) {
  return state.envSeasons[getCurrentSeasonKey(state)];
}

export function drawEnvDefId(state) {
  const seasonData = getCurrentSeasonData(state);
  const deck = seasonData.deck;
  const discard = seasonData.discard;

  if (deck.length === 0) {
    if (discard.length === 0) return null;
    while (discard.length > 0) deck.push(discard.pop());
    shuffleArray(state, deck);
  }

  return deck.pop();
}

export function refillEnvSlots(state) {
  for (const slot of state.envSlots) {
    if (slot.env) continue;
    const defId = drawEnvDefId(state);
    if (!defId) break;
    slot.env = makeEnvInstance(defId, state);
  }
}

// =============================================================================
// SERIALIZATION (core-only)
// =============================================================================

function stripTransientFromEnvSlots(envSlots) {
  for (const slot of envSlots || []) {
    const env = slot?.env;
    if (!env) continue;
    delete env._emitEffect;
    delete env._emitEffects;
  }
}

function stripLegacyTransientFromInventories(ownerInventories) {
  for (const inv of Object.values(ownerInventories || {})) {
    for (const item of inv?.items || []) delete item._needsUiRefresh;
  }
}

function rebuildInventoryDerived(inv) {
  if (!inv) return;

  // Ensure structural fields exist
  inv.items = Array.isArray(inv.items) ? inv.items : [];
  inv.cols = typeof inv.cols === "number" ? inv.cols : 0;
  inv.rows = typeof inv.rows === "number" ? inv.rows : 0;

  // Rebuild itemsById to reference the SAME objects as inv.items
  const itemsById = {};
  for (const it of inv.items) {
    if (!it || it.id == null) continue;
    itemsById[it.id] = it;
  }
  inv.itemsById = itemsById;

  // Rebuild grid defensively from items (ids only)
  const cellCount = Math.max(0, inv.cols * inv.rows);
  const grid = new Array(cellCount).fill(null);

  for (const it of inv.items) {
    if (!it) continue;
    const w = typeof it.width === "number" ? it.width : 1;
    const h = typeof it.height === "number" ? it.height : 1;
    const gx = typeof it.gridX === "number" ? it.gridX : 0;
    const gy = typeof it.gridY === "number" ? it.gridY : 0;

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = gx + dx;
        const y = gy + dy;
        if (x < 0 || y < 0 || x >= inv.cols || y >= inv.rows) continue;
        const idx = y * inv.cols + x;
        grid[idx] = it.id;
      }
    }
  }

  inv.grid = grid;
  inv.version = inv.version ?? 0;
}

function deepCloneSerializable(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (_) {
    // ignore
  }
  return JSON.parse(JSON.stringify(value));
}

export function serializeGameState(state) {
  const clean = JSON.parse(JSON.stringify(state));

  delete clean.rngNextFloat;
  delete clean.rngNextInt;

  // Inventories contain derived indices that cannot survive JSON cloning.
  if (clean.ownerInventories) {
    for (const inv of Object.values(clean.ownerInventories)) {
      if (!inv) continue;
      delete inv.itemsById;
      delete inv.grid;
    }
  }

  return clean;
}

export function deserializeGameState(data) {
  const raw = typeof data === "string" ? JSON.parse(data) : data;

  // CRITICAL: deep clone to avoid mutating stored snapshots (timeline/checkpoints).
  const state = deepCloneSerializable(raw);

  // Ensure defaults
  if (!state.rng) state.rng = { seed: 123456789 };
  if (!state.resources) state.resources = { gold: 0, food: 0, population: 0 };
  if (!state.envSlots) state.envSlots = [];
  if (!state.envSeasons) state.envSeasons = {};
  if (!state.permanentSlots) state.permanentSlots = [];
  if (!state.characters) state.characters = [];
  if (!state.seasons) state.seasons = SEASONS;
  if (!state.ownerInventories) state.ownerInventories = {};

  // New integer time defaults if missing from save
  if (state.simStepIndex == null) state.simStepIndex = 0;
  if (state.tSec == null) state.tSec = 0;
  if (state.actionPoints == null) state.actionPoints = 100;
  if (state.actionPointCap == null) state.actionPointCap = 100;

  // Season clock defaults
  if (state.seasonClockSec == null) state.seasonClockSec = 0;

  // Stage 5 defaults / legacy bridging
  if (state.seasonDurationSec == null)
    state.seasonDurationSec = SEASON_DURATION_SEC;

  // Legacy: simTimeRemaining renamed to seasonTimeRemaining. Keep both for compatibility during migration.
  if (state.seasonTimeRemaining == null) {
    state.seasonTimeRemaining =
      state.simTimeRemaining != null ? state.simTimeRemaining : 0;
  }
  if (state.simTimeRemaining == null)
    state.simTimeRemaining = state.seasonTimeRemaining;

  // Legacy: timeScale is being removed; default to 1 for older saves.
  if (state.timeScale == null) state.timeScale = 1;

  if (state.paused == null) state.paused = false;

  // Stage 5: normalize phase policy after paused is known.
  syncPhaseToPaused(state);

  // Enforce Cap Clamp immediately on load (in case save data is over-cap)
  state.actionPoints = Math.min(state.actionPoints, state.actionPointCap);

  stripTransientFromEnvSlots(state.envSlots);
  stripLegacyTransientFromInventories(state.ownerInventories);

  // Rebuild derived inventory indices after JSON clone / replay.
  for (const inv of Object.values(state.ownerInventories)) {
    rebuildInventoryDerived(inv);
  }

  attachRngHelpers(state);
  return state;
}

// App-edge only: explicitly mutates the singleton.
export function loadIntoGameState(data) {
  const loaded = deserializeGameState(data);
  Object.keys(gameState).forEach((k) => delete gameState[k]);
  Object.assign(gameState, loaded);
  attachRngHelpers(gameState);
}
