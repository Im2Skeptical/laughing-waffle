// state.js — core GameState shape + RNG helpers + season decks + serialize/deserialize
// Model-only. No view imports.

import {
  SEASONS,
  SEASON_DURATION_SEC,
  INITIAL_POPULATION_DEFAULT,
} from "../defs/gamesettings/gamerules-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { pawnSystemDefs } from "../defs/gamesystems/pawn-systems-defs.js";
import {
  LEADER_EQUIPMENT_SLOT_ORDER,
} from "../defs/gamesystems/equipment-slot-defs.js";
import { createEmptyLeaderEquipment } from "./equipment-rules.js";
import { attachRngHelpers, createRng } from "./rng.js";
import { getActionPointCapAtSecond } from "./moon.js";
import { Inventory } from "./inventory-model.js";
import { computeGlobalSkillMods } from "./skills.js";

const BOARD_COLS = 12;
const BOARD_LAYERS = ["tile", "event"];
const HUB_COLS = 10;

// Board contract: layers.*.anchors are authoritative placements.
// board.occ.* is derived in rebuildBoardOccupancy and stripped on serialize.

const DEV =
  (typeof globalThis !== "undefined" && globalThis.__DEV__ === true) ||
  (typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV !== "production");

function createBoardState(cols = BOARD_COLS) {
  return {
    cols,
    layers: {
      tile: { anchors: [] },
      event: { anchors: [] },
    },
    occ: {
      tile: new Array(cols).fill(null),
      event: new Array(cols).fill(null),
    },
  };
}

function createHubState(cols = HUB_COLS) {
  const safeCols = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : HUB_COLS;
  return {
    cols: safeCols,
    slots: new Array(safeCols).fill(null).map(() => ({ structure: null })),
    anchors: [],
    occ: new Array(safeCols).fill(null),
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
  if (board.layers.permanent) delete board.layers.permanent;

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
  if (board.occ.permanent) delete board.occ.permanent;

  for (const layer of BOARD_LAYERS) {
    if (!Array.isArray(board.occ[layer]) || board.occ[layer].length !== cols) {
      board.occ[layer] = new Array(cols).fill(null);
    }
  }
}

function ensurePawnCollectionState(state) {
  if (!state || typeof state !== "object") return [];

  const pawnList = Array.isArray(state.pawns) ? state.pawns : null;
  const legacyList = Array.isArray(state.characters) ? state.characters : null;

  if (pawnList && legacyList) {
    const canonical = pawnList.length > 0 ? pawnList : legacyList;
    state.pawns = canonical;
    state.characters = canonical;
    return canonical;
  }

  if (pawnList) {
    state.characters = pawnList;
    return pawnList;
  }

  if (legacyList) {
    state.pawns = legacyList;
    state.characters = legacyList;
    return legacyList;
  }

  state.pawns = [];
  state.characters = state.pawns;
  return state.pawns;
}

export function getPawns(state) {
  return ensurePawnCollectionState(state);
}

export function ensureHubState(state) {
  if (!state.hub || typeof state.hub !== "object") {
    state.hub = createHubState();
    return;
  }

  const hub = state.hub;
  if (!Array.isArray(hub.slots)) hub.slots = [];

  const slotsLen = hub.slots.length;
  const colHint =
    Number.isFinite(hub.cols) && hub.cols > 0 ? Math.floor(hub.cols) : 0;
  const cols = slotsLen > 0 ? slotsLen : colHint > 0 ? colHint : HUB_COLS;

  if (slotsLen === 0) {
    hub.slots = new Array(cols).fill(null).map(() => ({ structure: null }));
  }

  hub.cols = Array.isArray(hub.slots) ? hub.slots.length : cols;

  for (let i = 0; i < hub.slots.length; i++) {
    const slot = hub.slots[i];
    if (!slot || typeof slot !== "object") {
      hub.slots[i] = { structure: null };
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(slot, "structure")) {
      slot.structure = null;
    }
    const structure = slot.structure;
    if (structure) {
      const def = hubStructureDefs[structure.defId];
      if (def) ensureHubStructureFields(structure, def);
    }
  }

  if (!Array.isArray(hub.anchors)) hub.anchors = [];
  if (!Array.isArray(hub.occ) || hub.occ.length !== hub.cols) {
    hub.occ = new Array(hub.cols).fill(null);
  }

  ensureHubInventories(state);
}

export function buildPawnSystemDefaults() {
  const systemTiers = {};
  const systemState = {};
  for (const [systemId, def] of Object.entries(pawnSystemDefs)) {
    if (!def || typeof def !== "object") continue;
    const defaultTier =
      typeof def.defaultTier === "string" ? def.defaultTier : "bronze";
    systemTiers[systemId] = defaultTier;
    systemState[systemId] = deepCloneSerializable(def.stateDefaults ?? {});
  }
  return { systemTiers, systemState };
}

export function ensurePawnSystems(pawn) {
  if (!pawn || typeof pawn !== "object") return;
  if (!pawn.systemTiers || typeof pawn.systemTiers !== "object") {
    pawn.systemTiers = {};
  }
  if (!pawn.systemState || typeof pawn.systemState !== "object") {
    pawn.systemState = {};
  }

  for (const [systemId, def] of Object.entries(pawnSystemDefs)) {
    if (!def || typeof def !== "object") continue;
    if (pawn.systemTiers[systemId] == null) {
      pawn.systemTiers[systemId] =
        typeof def.defaultTier === "string" ? def.defaultTier : "bronze";
    }
    const existing = pawn.systemState[systemId];
    if (!existing || typeof existing !== "object") {
      pawn.systemState[systemId] = deepCloneSerializable(def.stateDefaults ?? {});
    }
    if (systemId === "hunger") {
      const hunger = pawn.systemState[systemId];
      if (!Number.isFinite(hunger.belowThresholdSec)) {
        hunger.belowThresholdSec = 0;
      }
      if (!Number.isFinite(hunger.debtCadenceSec)) {
        hunger.debtCadenceSec = 0;
      }
    }
  }

  ensurePawnAI(pawn);
}

export function ensurePawnAI(pawn) {
  if (!pawn || typeof pawn !== "object") return;
  const raw = pawn.ai;
  const ai = raw && typeof raw === "object" ? raw : {};
  const mode = ai.mode === "eat" || ai.mode === "rest" ? ai.mode : null;
  const suppressAutoUntilSec = Number.isFinite(ai.suppressAutoUntilSec)
    ? Math.max(0, Math.floor(ai.suppressAutoUntilSec))
    : 0;
  ai.mode = mode;
  ai.suppressAutoUntilSec = suppressAutoUntilSec;
  pawn.ai = ai;
}

function normalizeSkillNodeIdList(value) {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function ensurePawnSkillFields(pawn) {
  if (!pawn || typeof pawn !== "object") return;
  pawn.skillPoints = Number.isFinite(pawn.skillPoints)
    ? Math.max(0, Math.floor(pawn.skillPoints))
    : 0;
  pawn.unlockedSkillNodeIds = normalizeSkillNodeIdList(
    pawn.unlockedSkillNodeIds
  );
}

function ensureLeaderPrestigeFields(pawn) {
  if (!pawn || pawn.role !== "leader") return;
  if (!pawn.totalDepositedAmountByTier || typeof pawn.totalDepositedAmountByTier !== "object") {
    pawn.totalDepositedAmountByTier = {};
  }
  if (!pawn.prestigeDebtByFollowerId || typeof pawn.prestigeDebtByFollowerId !== "object") {
    pawn.prestigeDebtByFollowerId = {};
  }
  if (!Number.isFinite(pawn.prestigeCapBase)) pawn.prestigeCapBase = 0;
  if (!Number.isFinite(pawn.prestigeCapDebt)) pawn.prestigeCapDebt = 0;
  const base = Math.max(0, Math.floor(pawn.prestigeCapBase ?? 0));
  const debt = Math.max(0, Math.floor(pawn.prestigeCapDebt ?? 0));
  pawn.prestigeCapBase = base;
  pawn.prestigeCapDebt = debt;
  pawn.prestigeCapEffective = Math.max(0, base - Math.min(debt, base));

  if (!pawn.equipment || typeof pawn.equipment !== "object") {
    pawn.equipment = createEmptyLeaderEquipment();
    return;
  }
  for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(pawn.equipment, slotId)) {
      pawn.equipment[slotId] = null;
    }
  }
}

function ensureFollowerFields(pawn, fallbackOrderIndex = null) {
  if (!pawn || pawn.role !== "follower") return;
  if (pawn.leaderId == null) pawn.leaderId = null;
  if (!Number.isFinite(pawn.followerCreationOrderIndex)) {
    pawn.followerCreationOrderIndex =
      Number.isFinite(fallbackOrderIndex) && fallbackOrderIndex >= 0
        ? Math.floor(fallbackOrderIndex)
        : 0;
  }
  const hunger = pawn.systemState?.hunger;
  if (hunger && typeof hunger === "object") {
    if (!Number.isFinite(hunger.belowThresholdSec)) hunger.belowThresholdSec = 0;
    if (!Number.isFinite(hunger.debtCadenceSec)) hunger.debtCadenceSec = 0;
  }
}

function ensurePawnRoleFields(state, pawn, fallbackFollowerOrderIndex = null) {
  if (!pawn || typeof pawn !== "object") return;
  ensurePawnSkillFields(pawn);
  if (pawn.role !== "leader" && pawn.role !== "follower") {
    pawn.role = "leader";
  }
  if (pawn.role === "leader") {
    ensureLeaderPrestigeFields(pawn);
    const leadership = pawn.systemState?.leadership;
    if (leadership && typeof leadership === "object") {
      if (typeof leadership.followersAutoFollow !== "boolean") {
        leadership.followersAutoFollow = true;
      }
    }
  } else if (pawn.role === "follower") {
    ensureFollowerFields(pawn, fallbackFollowerOrderIndex);
  }
}

// =============================================================================
// PHASE / PAUSE POLICY
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

    // Remaining seconds in the current season (derived from seasonClockSec).
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

    resources: {
      gold: 0,
      food: 0,
      population: INITIAL_POPULATION_DEFAULT,
    },

    board: createBoardState(),
    hub: createHubState(),
    nextHubStructureInstanceId: 1,

    currentSeasonDeck: null,
    nextEnvInstanceId: 1,

    ownerInventories: {},

    nextItemId: 1,

    pawns: [],
    nextPawnId: 101,
    // Legacy save alias.
    nextCharacterId: 101,
    nextFollowerCreationOrderIndex: 1,
    gameEventFeed: [],
    nextGameEventFeedId: 1,

    rng: { seed, baseSeed: seed },
  };

  state.characters = state.pawns;

  attachRngHelpers(state);
  return state;
}

// Singleton used by the running game at the app edge.
export const gameState = createEmptyState();

// =============================================================================
// INSTANCE CREATION (core; used by init + effects)
// =============================================================================

export function makeHubStructureInstance(defId, state, options = {}) {
  const def = hubStructureDefs[defId];
  const span =
    Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
      ? Math.floor(def.defaultSpan)
      : 1;
  const inst = {
    instanceId: state.nextHubStructureInstanceId++,
    defId,
    span,
    tier: typeof options?.tier === "string" ? options.tier : null,
    props: {},
    tags: [],
    systemTiers: {},
    systemState: {},
  };
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
    systemState: {},
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
  ensureHubState(state);
  if (state.permanentSlots) delete state.permanentSlots;
  if (state.nextPermanentInstanceId) delete state.nextPermanentInstanceId;

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

  rebuildHubOccupancy(state);
  maybeValidateState(state, "rebuildBoardOccupancy");
}

export function rebuildHubOccupancy(state) {
  if (!state) return;
  ensureHubState(state);

  const hub = state.hub;
  const slots = Array.isArray(hub.slots) ? hub.slots : [];
  hub.cols = slots.length;

  if (!Array.isArray(hub.anchors)) hub.anchors = [];
  hub.anchors.length = 0;

  if (!Array.isArray(hub.occ) || hub.occ.length !== hub.cols) {
    hub.occ = new Array(hub.cols).fill(null);
  } else {
    hub.occ.fill(null);
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot || typeof slot !== "object") {
      slots[i] = { structure: null };
      continue;
    }
    const structure = slot.structure;
    if (!structure) continue;

    const def = hubStructureDefs[structure.defId];
    if (def) ensureHubStructureFields(structure, def);
    const fallbackSpan =
      Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    if (!Number.isFinite(structure.span) || structure.span <= 0) {
      structure.span = fallbackSpan;
    }
    structure.col = i;
    hub.anchors.push(structure);
  }

  for (const anchor of hub.anchors) {
    if (!anchor) continue;
    const col = typeof anchor.col === "number" ? anchor.col : 0;
    const span = typeof anchor.span === "number" ? anchor.span : 1;
    for (let offset = 0; offset < span; offset++) {
      const occupiedCol = col + offset;
      if (occupiedCol < 0 || occupiedCol >= hub.cols) continue;
      if (hub.occ[occupiedCol] && hub.occ[occupiedCol] !== anchor) {
        if (DEV) {
          console.warn(
            `[hub] occupancy collision on col ${occupiedCol}; overwriting.`
          );
        }
      }
      hub.occ[occupiedCol] = anchor;
    }
  }
}

export function initializeInstanceFromDef(instance, def) {
  if (!instance || !def) return;
  ensureHubStructureFields(instance, def);
}

function ensureHubStructureFields(instance, def) {
  if (!instance || !def) return;

  if (!Array.isArray(instance.tags) || instance.tags.length === 0) {
    instance.tags = normalizeTagList(def.tags);
  }

  if (!instance.systemTiers || typeof instance.systemTiers !== "object") {
    instance.systemTiers = {};
  }
  if (!instance.systemState || typeof instance.systemState !== "object") {
    instance.systemState = {};
  }

  function ensureHubSystemState(systemId) {
    if (!systemId || typeof systemId !== "string") return;
    if (instance.systemTiers[systemId] == null) {
      const sysDef = hubSystemDefs[systemId];
      const instanceTier =
        typeof instance.tier === "string" ? instance.tier : null;
      if (instanceTier) {
        instance.systemTiers[systemId] = instanceTier;
      } else if (sysDef?.defaultTier != null) {
        instance.systemTiers[systemId] = sysDef.defaultTier;
      }
    }
    if (!instance.systemState[systemId]) {
      const sysDef = hubSystemDefs[systemId];
      if (sysDef?.stateDefaults) {
        instance.systemState[systemId] = deepCloneSerializable(
          sysDef.stateDefaults
        );
      }
    }
  }

  const tags = Array.isArray(instance.tags) ? instance.tags : [];
  for (const tagId of tags) {
    const tagDef = hubTagDefs[tagId];
    const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
    for (const systemId of systems) {
      ensureHubSystemState(systemId);
    }
  }

  const depositSystemId =
    typeof def?.deposit?.systemId === "string" ? def.deposit.systemId : null;
  if (depositSystemId) {
    ensureHubSystemState(depositSystemId);
  }
}

function ensureHubInventories(state) {
  if (!state || !state.ownerInventories) return;
  const invs = state.ownerInventories;
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    const structure = slot?.structure;
    if (!structure) continue;
    const ownerId = structure.instanceId;
    if (ownerId == null || invs[ownerId]) continue;
    const def = hubStructureDefs[structure.defId];
    if (!def) continue;
    const invSpec = def.inventory ?? {};
    const cols = Number.isFinite(invSpec.cols) ? invSpec.cols : 5;
    const rows = Number.isFinite(invSpec.rows) ? invSpec.rows : 10;
    const inv = Inventory.create(cols, rows);
    Inventory.init(inv);
    inv.version = 0;
    invs[ownerId] = inv;
  }
}

function normalizeTagList(tags) {
  const raw = Array.isArray(tags) ? tags : [];
  const seen = new Set();
  const out = [];
  for (const tag of raw) {
    if (typeof tag !== "string") continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

// =============================================================================
// SEASON EVENT DECKS (tile-driven)
// =============================================================================

function pickWeightedDefId(rng, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (!rng || typeof rng.nextFloat !== "function") return null;

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

  const roll = rng.nextFloat() * total;
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

function shuffleDeckInPlace(rng, deck) {
  if (!Array.isArray(deck) || deck.length < 2) return;
  if (!rng || typeof rng.nextInt !== "function") return;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    if (i === j) continue;
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
}

function deriveSeasonDeckSeed(state) {
  const baseSeed = Number.isFinite(state?.rng?.baseSeed)
    ? Math.floor(state.rng.baseSeed)
    : Number.isFinite(state?.rng?.seed)
      ? Math.floor(state.rng.seed)
      : 0;
  const year = Number.isFinite(state?.year) ? Math.floor(state.year) : 0;
  const seasonIndex = Number.isFinite(state?.currentSeasonIndex)
    ? Math.floor(state.currentSeasonIndex)
    : 0;
  let seed = baseSeed | 0;
  seed = Math.imul(seed ^ (year + 0x9e3779b9), 0x85ebca6b);
  seed = Math.imul(seed ^ (seasonIndex + 0x7f4a7c15), 0xc2b2ae35);
  return seed | 0;
}

export function buildSeasonDeckForCurrentSeason(state) {
  if (!state) return null;
  const seasonKey = getCurrentSeasonKey(state);
  const deck = [];
  const rng = createRng(deriveSeasonDeckSeed(state));

  for (const anchor of getOrderedTileAnchors(state)) {
    if (!anchor) continue;
    const def = envTileDefs[anchor.defId];
    const table = def?.seasonTables?.[seasonKey];
    if (!Array.isArray(table) || table.length === 0) continue;

    const defId = pickWeightedDefId(rng, table);
    if (!defId) continue;

    deck.push({ defId });
  }

  // Shuffle so draw order is not tied to tile columns.
  shuffleDeckInPlace(rng, deck);
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
  delete clean._boardDirty;
  delete clean._seasonChanged;
  if (clean.board && clean.board.occ) delete clean.board.occ;
  if (clean.hub) {
    delete clean.hub.occ;
    delete clean.hub.anchors;
  }
  if (clean.permanentSlots) delete clean.permanentSlots;
  if (clean.nextPermanentInstanceId) delete clean.nextPermanentInstanceId;
  if (clean.envSlots) delete clean.envSlots;
  if (clean.envSlotsEnabled != null) delete clean.envSlotsEnabled;

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
  if (!state.rng) state.rng = { seed: 123456789, baseSeed: 123456789 };
  if (!Number.isFinite(state.rng.seed)) {
    state.rng.seed = Number.isFinite(state.rng.baseSeed)
      ? Math.floor(state.rng.baseSeed)
      : 123456789;
  }
  if (!Number.isFinite(state.rng.baseSeed)) {
    state.rng.baseSeed = Math.floor(state.rng.seed ?? 123456789);
  }
  if (!state.resources) {
    state.resources = {
      gold: 0,
      food: 0,
      population: INITIAL_POPULATION_DEFAULT,
    };
  }
  if (!Number.isFinite(state.resources.gold)) state.resources.gold = 0;
  if (!Number.isFinite(state.resources.food)) state.resources.food = 0;
  if (!Number.isFinite(state.resources.population)) {
    state.resources.population = INITIAL_POPULATION_DEFAULT;
  }
  if (state.envSlots) delete state.envSlots;
  if (state.envSlotsEnabled != null) delete state.envSlotsEnabled;
  if (!state.hub || typeof state.hub !== "object") state.hub = createHubState();
  const pawns = ensurePawnCollectionState(state);
  if (!state.seasons) state.seasons = SEASONS;
  if (!state.ownerInventories) state.ownerInventories = {};
  if (!Array.isArray(state.gameEventFeed)) state.gameEventFeed = [];
  if (!Number.isFinite(state.nextGameEventFeedId)) {
    let maxEventId = 0;
    for (const entry of state.gameEventFeed) {
      const id = Number.isFinite(entry?.id) ? Math.floor(entry.id) : 0;
      if (id > maxEventId) maxEventId = id;
    }
    state.nextGameEventFeedId = Math.max(1, maxEventId + 1);
  }
  if (
    state.currentSeasonDeck != null &&
    typeof state.currentSeasonDeck !== "object"
  ) {
    state.currentSeasonDeck = null;
  } else if (state.currentSeasonDeck) {
    if (!Array.isArray(state.currentSeasonDeck.deck)) {
      state.currentSeasonDeck.deck = [];
    }
    if (typeof state.currentSeasonDeck.seasonKey !== "string") {
      state.currentSeasonDeck.seasonKey = getCurrentSeasonKey(state);
    }
  }
  ensureBoardState(state);
  ensureHubState(state);
  let nextFollowerIndex = Number.isFinite(state.nextFollowerCreationOrderIndex)
    ? Math.floor(state.nextFollowerCreationOrderIndex)
    : 1;
  let maxFollowerIndex = 0;

  for (const ch of pawns) {
    ensurePawnSystems(ch);
    if (ch?.role !== "leader" && ch?.role !== "follower") {
      ch.role = "leader";
    }
    if (ch?.role === "follower" && Number.isFinite(ch.followerCreationOrderIndex)) {
      maxFollowerIndex = Math.max(
        maxFollowerIndex,
        Math.floor(ch.followerCreationOrderIndex)
      );
    }
  }

  if (nextFollowerIndex <= maxFollowerIndex) {
    nextFollowerIndex = maxFollowerIndex + 1;
  }

  for (const ch of pawns) {
    if (ch?.role === "follower" && !Number.isFinite(ch.followerCreationOrderIndex)) {
      ensurePawnRoleFields(state, ch, nextFollowerIndex++);
      continue;
    }
    ensurePawnRoleFields(state, ch, null);
  }
  state.nextFollowerCreationOrderIndex = nextFollowerIndex;
  state._boardDirty = false;
  state._seasonChanged = false;

  // New integer time defaults if missing from save
  if (state.simStepIndex == null) state.simStepIndex = 0;
  if (state.tSec == null) state.tSec = 0;
  if (state.year == null) state.year = 1;
  if (state.actionPoints == null) state.actionPoints = 100;
  if (state.actionPointCap == null) state.actionPointCap = 100;
  if (state.nextHubStructureInstanceId == null) {
    state.nextHubStructureInstanceId = 1;
  }
  if (!Number.isFinite(state.nextPawnId)) {
    state.nextPawnId = Number.isFinite(state.nextCharacterId)
      ? Math.floor(state.nextCharacterId)
      : 101;
  }
  state.nextCharacterId = Math.floor(state.nextPawnId);
  if (!state.apCapOverride || typeof state.apCapOverride !== "object") {
    state.apCapOverride = null;
  } else if (state.apCapOverride.enabled === false) {
    state.apCapOverride = null;
  }

  // Season clock defaults
  if (state.seasonClockSec == null) state.seasonClockSec = 0;

  // Ensure defaults
  if (state.seasonDurationSec == null)
    state.seasonDurationSec = SEASON_DURATION_SEC;

  if (state.paused == null) state.paused = false;

  // Normalize phase after paused is known.
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
    const baseCap = getActionPointCapAtSecond(state.tSec ?? 0);
    const globalSkillMods = computeGlobalSkillMods(state);
    const skillCapBonus = Number.isFinite(globalSkillMods?.apCapBonus)
      ? Math.floor(globalSkillMods.apCapBonus)
      : 0;
    state.actionPointCap = Math.max(0, baseCap + skillCapBonus);
    // Enforce Cap Clamp immediately on load (in case save data is over-cap)
    state.actionPoints = Math.min(state.actionPoints, state.actionPointCap);
  }

  // Rebuild derived inventory indices after JSON clone / replay.
  for (const inv of Object.values(state.ownerInventories)) {
    rebuildInventoryDerived(inv);
  }

  rebuildBoardOccupancy(state);
  attachRngHelpers(state);
  return state;
}

export function validateState(state) {
  const errors = [];
  const warnings = [];

  if (!state || typeof state !== "object") {
    errors.push("state missing");
    return { ok: false, errors, warnings };
  }

  const board = state.board;
  if (!board || typeof board !== "object") {
    errors.push("board missing");
    return { ok: false, errors, warnings };
  }

  const cols = Number.isFinite(board.cols) ? Math.floor(board.cols) : null;
  if (!cols || cols <= 0) {
    errors.push("board.cols invalid");
    return { ok: false, errors, warnings };
  }
  const hub = state.hub;
  if (!hub || typeof hub !== "object") {
    errors.push("hub missing");
  }
  const hubCols = Array.isArray(hub?.slots) ? hub.slots.length : 0;

  const chars = getPawns(state);
  for (const ch of chars) {
    const hasHub = Number.isFinite(ch?.hubCol);
    const hasEnv = Number.isFinite(ch?.envCol);
    if (hasHub && hasEnv) {
      warnings.push(
        `pawn has both hubCol and envCol: ${ch.id ?? "unknown"}`
      );
    }
    if (hasHub) {
      const col = Math.floor(ch.hubCol);
      if (col < 0 || col >= hubCols) {
        errors.push(`pawn hubCol out of bounds: ${ch.id ?? "unknown"}`);
      }
    }
    if (hasEnv) {
      const col = Math.floor(ch.envCol);
      if (col < 0 || col >= cols) {
        errors.push(`pawn envCol out of bounds: ${ch.id ?? "unknown"}`);
      }
    }
  }

  const occ = board.occ || {};
  for (const layer of BOARD_LAYERS) {
    const anchors = Array.isArray(board.layers?.[layer]?.anchors)
      ? board.layers[layer].anchors
      : null;
    if (!anchors) {
      errors.push(`board.layers.${layer}.anchors missing`);
      continue;
    }

    const occLayer = occ[layer];
    if (!Array.isArray(occLayer) || occLayer.length !== cols) {
      errors.push(`board.occ.${layer} length mismatch`);
      continue;
    }

    const expected = new Array(cols).fill(null);
    for (const anchor of anchors) {
      if (!anchor) continue;
      const rawCol = anchor.col;
      if (!Number.isFinite(rawCol)) {
        errors.push(`anchor missing col in layer ${layer}`);
        continue;
      }
      const col = Math.floor(rawCol);
      const rawSpan = anchor.span;
      if (!Number.isFinite(rawSpan) || rawSpan <= 0) {
        errors.push(`anchor span invalid in layer ${layer}`);
        continue;
      }
      const span = Math.floor(rawSpan);
      for (let offset = 0; offset < span; offset++) {
        const occCol = col + offset;
        if (occCol < 0 || occCol >= cols) {
          errors.push(`anchor out of bounds in layer ${layer}`);
          continue;
        }
        expected[occCol] = anchor;
      }
    }

    for (let col = 0; col < cols; col++) {
      const actual = occLayer[col];
      const exp = expected[col];
      if (exp === actual) continue;
      if (exp?.instanceId != null && actual?.instanceId != null) {
        if (exp.instanceId === actual.instanceId) continue;
      }
      if (exp || actual) {
        errors.push(`board.occ.${layer}[${col}] mismatch`);
      }
    }
  }

  if (!hub || typeof hub !== "object") {
    return { ok: errors.length === 0, errors, warnings };
  }

  const hubAnchors = Array.isArray(hub.anchors) ? hub.anchors : null;
  if (!hubAnchors) {
    errors.push("hub.anchors missing");
  }

  if (!Array.isArray(hub.occ) || hub.occ.length !== hubCols) {
    errors.push("hub.occ length mismatch");
  } else if (hubAnchors) {
    const expected = new Array(hubCols).fill(null);
    for (const anchor of hubAnchors) {
      if (!anchor) continue;
      const rawCol = anchor.col;
      if (!Number.isFinite(rawCol)) {
        errors.push("hub anchor missing col");
        continue;
      }
      const col = Math.floor(rawCol);
      const rawSpan = anchor.span;
      if (!Number.isFinite(rawSpan) || rawSpan <= 0) {
        errors.push("hub anchor span invalid");
        continue;
      }
      const span = Math.floor(rawSpan);
      for (let offset = 0; offset < span; offset++) {
        const occCol = col + offset;
        if (occCol < 0 || occCol >= hubCols) {
          errors.push("hub anchor out of bounds");
          continue;
        }
        expected[occCol] = anchor;
      }
    }

    for (let col = 0; col < hubCols; col++) {
      const actual = hub.occ[col];
      const exp = expected[col];
      if (exp === actual) continue;
      if (exp?.instanceId != null && actual?.instanceId != null) {
        if (exp.instanceId === actual.instanceId) continue;
      }
      if (exp || actual) {
        errors.push(`hub.occ[${col}] mismatch`);
      }
    }
  }

  for (let col = 0; col < hubCols; col++) {
    const slot = hub.slots?.[col];
    const structure = slot?.structure;
    if (!structure) continue;
    if (!Number.isFinite(structure.col) || Math.floor(structure.col) !== col) {
      errors.push(`hub slot col mismatch at ${col}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function maybeValidateState(state, origin) {
  if (!DEV) return;
  const result = validateState(state);
  if (!result.ok) {
    console.warn(`[state] ${origin}: ${result.errors.join("; ")}`);
  }
  if (result.warnings.length > 0) {
    console.warn(`[state] ${origin}: ${result.warnings.join("; ")}`);
  }
}

// App-edge only: explicitly mutates the singleton.
export function loadIntoGameState(data) {
  const loaded = deserializeGameState(data);
  Object.keys(gameState).forEach((k) => delete gameState[k]);
  Object.assign(gameState, loaded);
  attachRngHelpers(gameState);
}

