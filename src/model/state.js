// state.js — core GameState shape + RNG helpers + season decks + serialize/deserialize
// Model-only. No view imports.

import { SEASONS, SEASON_DURATION_SEC } from "../defs/gamesettings/gamerules-defs.js";
import { envCardDefs, permanentDefs } from "../defs/gamepieces/gamepieces-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { attachRngHelpers } from "./rng.js";
import { getActionPointCapAtSecond } from "./moon.js";

const BOARD_COLS = 12;
const BOARD_LAYERS = ["tile", "event", "permanent"];

function createBoardState(cols = BOARD_COLS) {
  return {
    cols,
    layers: {
      tile: { anchors: [] },
      event: { anchors: [] },
      permanent: { anchors: [] },
    },
    occ: {
      tile: new Array(cols).fill(null),
      event: new Array(cols).fill(null),
      permanent: new Array(cols).fill(null),
    },
  };
}

function ensureBoardState(state) {
  if (!state.board || typeof state.board !== "object") {
    state.board = createBoardState();
    return;
  }

  const board = state.board;
  const cols =
    typeof board.cols === "number" && board.cols > 0 ? board.cols : BOARD_COLS;
  board.cols = cols;

  if (!board.layers || typeof board.layers !== "object") {
    board.layers = {};
  }

  for (const layer of BOARD_LAYERS) {
    if (!board.layers[layer] || typeof board.layers[layer] !== "object") {
      board.layers[layer] = { anchors: [] };
    }
    if (!Array.isArray(board.layers[layer].anchors)) {
      board.layers[layer].anchors = [];
    }
  }

  if (!board.occ || typeof board.occ !== "object") {
    board.occ = {};
  }

  for (const layer of BOARD_LAYERS) {
    if (!Array.isArray(board.occ[layer]) || board.occ[layer].length !== cols) {
      board.occ[layer] = new Array(cols).fill(null);
    }
  }
}

function ensureTilePawnsByCol(state) {
  if (!state) return;
  const cols = state.board?.cols ?? BOARD_COLS;
  if (!Array.isArray(state.tilePawnsByCol) || state.tilePawnsByCol.length !== cols) {
    const next = new Array(cols).fill(false);
    if (Array.isArray(state.tilePawnsByCol)) {
      const copyLen = Math.min(cols, state.tilePawnsByCol.length);
      for (let i = 0; i < copyLen; i++) {
        next[i] = !!state.tilePawnsByCol[i];
      }
    }
    state.tilePawnsByCol = next;
    return;
  }

  for (let i = 0; i < state.tilePawnsByCol.length; i++) {
    state.tilePawnsByCol[i] = !!state.tilePawnsByCol[i];
  }
}

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
    year: 1,

    // Time Axis (Integer-based)
    // simStepIndex: Master clock, increments +1 per fixed tick (1/60s).
    // tSec: Derived integer seconds = floor(simStepIndex / 60).
    simStepIndex: 0,
    tSec: 0,

    // Stage 5: renamed remaining clock (legacy field kept until full migration)
    seasonTimeRemaining: 0,
    seasonDurationSec: SEASON_DURATION_SEC,

    simTime: 0, // Accumulator for floating point calculations if needed

    // Season clock accumulator (decoupled from planning/boundary indices).
    seasonClockSec: 0,

    paused: false,

    // Action Points (Skeleton)
    actionPoints: 100,
    actionPointCap: 100,
    apCapOverride: null,

    resources: { gold: 0, food: 0, population: 0 },

    board: createBoardState(),
    tilePawnsByCol: new Array(BOARD_COLS).fill(false),

    permanentSlots: [],
    nextPermanentInstanceId: 1,

    envSlots: [],
    envSlotsEnabled: false,
    currentSeasonDeck: null,
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

export function makeEnvTileInstance(defId, state, col, span = 1) {
  const def = envTileDefs[defId];
  const baseTags = Array.isArray(def?.baseTags) ? def.baseTags : [];
  const tags = [];
  const seen = new Set();
  for (const tag of baseTags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }

  return {
    instanceId: state.nextEnvInstanceId++,
    defId,
    col,
    span,
    tags,
    systemTiers: {},
  };
}

export function makeEnvEventInstance(defId, state, col, span, tSec) {
  const def = envEventDefs[defId];
  const safeSpan = typeof span === "number" && span > 0 ? span : 1;
  const inst = {
    instanceId: state.nextEnvInstanceId++,
    defId,
    col,
    span: safeSpan,
    createdSec: tSec,
  };
  if (def?.durationSec != null) {
    inst.expiresSec = tSec + def.durationSec;
  }
  return inst;
}

export function rebuildBoardOccupancy(state) {
  if (!state) return;
  ensureBoardState(state);

  const board = state.board;
  for (const layer of BOARD_LAYERS) {
    board.occ[layer].fill(null);
  }

  for (const layer of BOARD_LAYERS) {
    const anchors = board.layers[layer].anchors;
    for (const anchor of anchors) {
      if (!anchor) continue;
      const col = typeof anchor.col === "number" ? anchor.col : 0;
      const span = typeof anchor.span === "number" ? anchor.span : 1;
      for (let offset = 0; offset < span; offset++) {
        const occupiedCol = col + offset;
        if (occupiedCol < 0 || occupiedCol >= board.cols) continue;
        if (
          board.occ[layer][occupiedCol] &&
          board.occ[layer][occupiedCol] !== anchor
        ) {
          console.warn(
            `[board] occupancy collision on ${layer} col ${occupiedCol}; overwriting.`
          );
        }
        board.occ[layer][occupiedCol] = anchor;
      }
    }
  }
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
// SEASON EVENT DECKS (tile-driven)
// =============================================================================

function pickWeightedDefId(state, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (typeof state?.rngNextFloat !== "function") return null;

  let total = 0;
  const weights = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const weight = Number.isFinite(entries[i]?.weight)
      ? Math.max(0, entries[i].weight)
      : 0;
    weights[i] = weight;
    total += weight;
  }

  if (total <= 0) return null;

  const roll = state.rngNextFloat() * total;
  let acc = 0;
  for (let i = 0; i < entries.length; i++) {
    acc += weights[i];
    if (roll < acc) return entries[i]?.defId ?? null;
  }

  return entries[entries.length - 1]?.defId ?? null;
}

function getOrderedTileAnchors(state) {
  const anchors = Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
  const ordered = anchors.map((anchor, index) => ({
    anchor,
    index,
    col: Number.isFinite(anchor?.col) ? Math.floor(anchor.col) : 0,
  }));
  ordered.sort((a, b) => (a.col - b.col) || (a.index - b.index));
  return ordered.map((entry) => entry.anchor);
}

export function buildSeasonDeckForCurrentSeason(state) {
  if (!state) return null;
  const seasonKey = getCurrentSeasonKey(state);
  const deck = [];

  for (const anchor of getOrderedTileAnchors(state)) {
    if (!anchor) continue;
    const def = envTileDefs[anchor.defId];
    const table = def?.seasonTables?.[seasonKey];
    if (!Array.isArray(table) || table.length === 0) continue;

    const defId = pickWeightedDefId(state, table);
    if (!defId) continue;

    const col = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : 0;
    deck.push({ defId, col });
  }

  state.currentSeasonDeck = { seasonKey, deck };
  return state.currentSeasonDeck;
}

export function getCurrentSeasonKey(state) {
  return state.seasons[state.currentSeasonIndex];
}

export function getCurrentSeasonData(state) {
  const seasonKey = getCurrentSeasonKey(state);
  const deck = state.currentSeasonDeck;
  if (deck && deck.seasonKey === seasonKey) return deck;
  return { seasonKey, deck: [] };
}

export function drawSeasonDeckEntry(state) {
  const seasonKey = getCurrentSeasonKey(state);
  const deck = state.currentSeasonDeck;
  if (!deck || deck.seasonKey !== seasonKey) return null;
  if (!Array.isArray(deck.deck) || deck.deck.length === 0) return null;
  return deck.deck.shift();
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
  if (clean.board && clean.board.occ) delete clean.board.occ;

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
  if (state.envSlotsEnabled == null) state.envSlotsEnabled = false;
  if (!state.permanentSlots) state.permanentSlots = [];
  if (!state.characters) state.characters = [];
  if (!state.seasons) state.seasons = SEASONS;
  if (!state.ownerInventories) state.ownerInventories = {};
  if (
    state.currentSeasonDeck != null &&
    typeof state.currentSeasonDeck !== "object"
  ) {
    state.currentSeasonDeck = null;
  } else if (state.currentSeasonDeck) {
    if (!Array.isArray(state.currentSeasonDeck.deck)) {
      state.currentSeasonDeck.deck = [];
    }
    if (Object.prototype.hasOwnProperty.call(state.currentSeasonDeck, "discard")) {
      delete state.currentSeasonDeck.discard;
    }
    if (typeof state.currentSeasonDeck.seasonKey !== "string") {
      state.currentSeasonDeck.seasonKey = getCurrentSeasonKey(state);
    }
  }
  ensureBoardState(state);
  ensureTilePawnsByCol(state);
  state._boardDirty = false;
  state._seasonChanged = false;

  // New integer time defaults if missing from save
  if (state.simStepIndex == null) state.simStepIndex = 0;
  if (state.tSec == null) state.tSec = 0;
  if (state.year == null) state.year = 1;
  if (state.actionPoints == null) state.actionPoints = 100;
  if (state.actionPointCap == null) state.actionPointCap = 100;
  if (!state.apCapOverride || typeof state.apCapOverride !== "object") {
    state.apCapOverride = null;
  } else if (state.apCapOverride.enabled === false) {
    state.apCapOverride = null;
  }

  // Season clock defaults
  if (state.seasonClockSec == null) state.seasonClockSec = 0;

  // Stage 5 defaults / legacy bridging
  if (state.seasonDurationSec == null)
    state.seasonDurationSec = SEASON_DURATION_SEC;

  if (state.paused == null) state.paused = false;

  // Stage 5: normalize phase policy after paused is known.
  syncPhaseToPaused(state);

  if (state.apCapOverride) {
    const overrideCap =
      typeof state.apCapOverride.cap === "number"
        ? Math.max(0, Math.floor(state.apCapOverride.cap))
        : state.actionPointCap;
    const overridePoints =
      typeof state.apCapOverride.points === "number"
        ? Math.floor(state.apCapOverride.points)
        : state.actionPoints;

    state.apCapOverride.enabled = true;
    state.apCapOverride.cap = overrideCap;
    state.apCapOverride.points = overridePoints;

    state.actionPointCap = overrideCap;
    state.actionPoints = Math.min(
      state.actionPointCap,
      Math.max(0, overridePoints)
    );
  } else {
    state.actionPointCap = getActionPointCapAtSecond(state.tSec ?? 0);
    // Enforce Cap Clamp immediately on load (in case save data is over-cap)
    state.actionPoints = Math.min(state.actionPoints, state.actionPointCap);
  }

  stripTransientFromEnvSlots(state.envSlots);
  stripLegacyTransientFromInventories(state.ownerInventories);

  // Rebuild derived inventory indices after JSON clone / replay.
  for (const inv of Object.values(state.ownerInventories)) {
    rebuildInventoryDerived(inv);
  }

  rebuildBoardOccupancy(state);
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

