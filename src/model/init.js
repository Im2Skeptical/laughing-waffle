// init.js — scenario/setup assembly (NO core exports here besides init/createInitialState)

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { setupDefs } from "../defs/gamesettings/scenarios-defs.js";
import { createEmptyLeaderEquipment } from "../defs/gamesystems/equipment-slot-defs.js";

import {
  createEmptyState,
  makeEnvTileInstance,
  makeHubStructureInstance,
  buildSeasonDeckForCurrentSeason,
  rebuildBoardOccupancy,
  buildPawnSystemDefaults,
} from "./state.js";

import { Inventory } from "./inventory-model.js";

const HUB_COLS = 10;

// Create a fully-initialized GameState snapshot
// - scenario can be a setupId string OR a raw setup object (from scenarios-defs style)
export function createInitialState(scenario = "testing", seed = null) {
  const setup = typeof scenario === "string" ? setupDefs[scenario] : scenario;

  if (!setup) {
    throw new Error(
      typeof scenario === "string"
        ? `Unknown setupId: ${scenario}`
        : "Invalid scenario object"
    );
  }

  const state = createEmptyState(seed ?? setup.rngSeed ?? 123456789);

  // baseline sim fields
  state.phase = "simulation";
  state.turn = 0;
  state.currentSeasonIndex = 0;
  state.year = 1;
  state.seasonTimeRemaining = 0;
  state.paused = false;

  // resources
  state.resources = {
    gold: 0,
    food: 0,
    population: 0,
    ...(setup.resources || {}),
  };

  // reset ids for deterministic scenario creation
  state.nextHubStructureInstanceId = 1;
  state.nextEnvInstanceId = 1;
  state.nextItemId = 1;
  state.nextCharacterId = 101;
  state.nextFollowerCreationOrderIndex = 1;

  const boardCols = getBoardColsFromSetup(setup, state);
  const hubCols = getHubColsFromSetup(setup);
  ensureBoardCols(state, boardCols);
  if (!state.hub || typeof state.hub !== "object") {
    state.hub = { cols: hubCols, slots: [] };
  }
  state.hub.cols = hubCols;

  // hub structures
  state.hub.slots = buildHubSlots(setup, hubCols, state);

  state.board.layers.tile.anchors = buildTileAnchors(setup, boardCols, state);

  // characters
  const charSpecs = setup.characters || [];
  const created = [];
  for (let index = 0; index < charSpecs.length; index++) {
    const c = charSpecs[index];
    const wantsEnvRow = c?.row === "env" || Number.isFinite(c?.envCol);
    const envCol = wantsEnvRow
      ? getColIndex({ envCol: c.envCol }, index, boardCols)
      : null;
    const hubCol = wantsEnvRow
      ? null
      : getColIndex({ hubCol: c.hubCol }, index, hubCols);
    const { systemTiers, systemState } = buildPawnSystemDefaults();
    const role = c?.role === "follower" ? "follower" : "leader";
    const pawn = {
      id: state.nextCharacterId++,
      pawnDefId: typeof c?.pawnDefId === "string" ? c.pawnDefId : "default",
      name: c.name,
      color: c.color,
      hubCol,
      envCol,
      systemTiers,
      systemState,
      props: {},
      role,
      leaderId: null,
    };
    if (role === "follower") {
      pawn.followerCreationOrderIndex = state.nextFollowerCreationOrderIndex++;
      pawn._leaderIndex = Number.isFinite(c?.leaderIndex)
        ? Math.floor(c.leaderIndex)
        : null;
      pawn._leaderId = Number.isFinite(c?.leaderId) ? Math.floor(c.leaderId) : null;
    } else {
      pawn.totalDepositedAmountByTier = {};
      pawn.prestigeCapBase = 0;
      pawn.prestigeCapDebt = 0;
      pawn.prestigeCapEffective = 0;
      pawn.prestigeDebtByFollowerId = {};
      pawn.equipment = createEmptyLeaderEquipment();
    }
    created.push(pawn);
  }

  for (const pawn of created) {
    if (pawn.role !== "follower") continue;
    const leaderId =
      Number.isFinite(pawn._leaderIndex) && created[pawn._leaderIndex]
        ? created[pawn._leaderIndex].id
        : Number.isFinite(pawn._leaderId)
        ? pawn._leaderId
        : null;
    pawn.leaderId = leaderId;
    delete pawn._leaderIndex;
    delete pawn._leaderId;
  }

  state.characters = created;

  // inventories
  state.ownerInventories = {};

  // hub structure inventories
  for (const slot of state.hub.slots) {
    const structure = slot.structure;
    if (!structure) continue;
    const def = hubStructureDefs[structure.defId];
    if (!def) continue;

    const invSpec = def.inventory ?? {};
    const cols = Number.isFinite(invSpec.cols) ? invSpec.cols : 5;
    const rows = Number.isFinite(invSpec.rows) ? invSpec.rows : 10;
    const inv = Inventory.create(cols, rows);
    Inventory.init(inv);
    inv.version = 0;
    state.ownerInventories[structure.instanceId] = inv;
  }

  // character inventories
  for (const ch of state.characters) {
    const inv = Inventory.create(5, 3);
    Inventory.init(inv);
    inv.version = 0;
    state.ownerInventories[ch.id] = inv;
  }

  // scenario-defined inventory items
  applySetupInventories(state, setup);

  // season deck (tile-driven)
  buildSeasonDeckForCurrentSeason(state);

  rebuildBoardOccupancy(state);

  return state;
}

// Mutate an existing state object in-place (views call initGameState(gameState, "testing")).
export function initGameState(state, setupId = "testing") {
  const fresh = createInitialState(setupId, null);
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, fresh);
  return state;
}

// ----- internal helpers -----

function applySetupInventories(state, setup) {
  const invSpecs = setup.inventories || [];
  if (invSpecs.length === 0) return;

  const hubStructureIdsInOrder = state.hub.slots.map(
    (s) => s?.structure?.instanceId ?? null
  );
  const charIdsInOrder = state.characters.map((c) => c.id);

  for (const spec of invSpecs) {
    const owner = spec.owner;
    if (!owner) continue;

    let ownerId = null;

    if (owner.type === "hubStructure") {
      const idx =
        Number.isFinite(owner.hubCol)
          ? getColIndex(owner, owner.index ?? 0, hubStructureIdsInOrder.length)
          : owner.index;
      ownerId = hubStructureIdsInOrder[idx];
    } else if (owner.type === "hubSlot") {
      ownerId =
        hubStructureIdsInOrder[
          getColIndex(owner, owner.index ?? 0, hubStructureIdsInOrder.length)
        ];
    } else if (owner.type === "character") {
      ownerId = charIdsInOrder[owner.index];
    }

    if (!ownerId) continue;

    const inv = state.ownerInventories[ownerId];
    if (!inv) continue;

    for (const it of spec.items || []) {
      const item = Inventory.addNewItem(state, inv, {
        kind: it.kind,
        width: it.width ?? 1,
        height: it.height ?? 1,
        quantity: it.quantity ?? 1,
        gridX: it.gridX ?? 0,
        gridY: it.gridY ?? 0,
      });

    }

    inv.version = (inv.version ?? 0) + 1;
  }
}

function getBoardColsFromSetup(setup, state) {
  const candidate = setup?.board?.cols;
  if (Number.isFinite(candidate)) return Math.max(1, Math.floor(candidate));
  return Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 12;
}

function getHubColsFromSetup(setup) {
  const candidate = setup?.hub?.cols;
  if (Number.isFinite(candidate)) return Math.max(1, Math.floor(candidate));
  return HUB_COLS;
}

function ensureBoardCols(state, cols) {
  if (!state?.board) return;
  if (state.board.cols === cols) return;
  state.board.cols = cols;
  if (!state.board.layers) {
    state.board.layers = { tile: { anchors: [] }, event: { anchors: [] } };
  }
  if (!state.board.occ) {
    state.board.occ = { tile: [], event: [] };
  }
  for (const layer of ["tile", "event"]) {
    state.board.occ[layer] = new Array(cols).fill(null);
    if (!state.board.layers[layer]) state.board.layers[layer] = { anchors: [] };
    if (!Array.isArray(state.board.layers[layer].anchors)) {
      state.board.layers[layer].anchors = [];
    }
  }
}

function getColIndex(spec, fallback, maxCols) {
  const raw = Number.isFinite(spec?.hubCol)
    ? spec.hubCol
    : Number.isFinite(spec?.envCol)
    ? spec.envCol
    : Number.isFinite(spec?.col)
    ? spec.col
    : fallback;
  const col = Number.isFinite(raw) ? Math.floor(raw) : 0;
  if (Number.isFinite(maxCols) && maxCols > 0) {
    return Math.max(0, Math.min(maxCols - 1, col));
  }
  return Math.max(0, col);
}

function buildHubSlots(setup, hubCols, state) {
  const slots = new Array(hubCols).fill(null).map(() => ({ structure: null }));
  const occupiedBy = new Array(hubCols).fill(null);
  const specs = Array.isArray(setup?.hub?.structures)
    ? setup.hub.structures
    : [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (!spec?.defId) continue;
    const def = hubStructureDefs[spec.defId];
    const span =
      Number.isFinite(spec.span) && spec.span > 0
        ? Math.floor(spec.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
          ? Math.floor(def.defaultSpan)
          : 1;
    if (span > hubCols) continue;
    let hubCol = getColIndex(spec, i, hubCols);
    if (hubCol < 0 || hubCol >= hubCols) continue;
    if (hubCol + span > hubCols) hubCol = hubCols - span;

    let blocked = false;
    for (let offset = 0; offset < span; offset++) {
      if (occupiedBy[hubCol + offset] != null) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

      const structure = makeHubStructureInstance(spec.defId, state, {
        tier: typeof spec.tier === "string" ? spec.tier : null,
      });
    slots[hubCol] = {
      x: spec.x,
      y: spec.y,
      structure,
    };
    for (let offset = 0; offset < span; offset++) {
      occupiedBy[hubCol + offset] = structure.instanceId;
    }
  }
  return slots;
}

function buildTileAnchors(setup, boardCols, state) {
  const tileSpecs = setup?.board?.tiles ?? setup?.tiles ?? null;
  const anchors = [];

  if (Array.isArray(tileSpecs) && tileSpecs.length > 0) {
    if (typeof tileSpecs[0] === "string") {
      for (let col = 0; col < boardCols; col++) {
        const defId = tileSpecs[col % tileSpecs.length];
        if (!defId || !envTileDefs[defId]) continue;
        anchors.push(makeEnvTileInstance(defId, state, col, 1));
      }
      return anchors;
    }

    for (let i = 0; i < tileSpecs.length; i++) {
      const spec = tileSpecs[i];
      if (!spec?.defId || !envTileDefs[spec.defId]) continue;
      const col = getColIndex(spec, i, boardCols);
      const span =
        Number.isFinite(spec.span) && spec.span > 0 ? Math.floor(spec.span) : 1;
      anchors.push(makeEnvTileInstance(spec.defId, state, col, span));
    }
    return anchors;
  }

  const tileDefIds = Object.keys(envTileDefs);
  const orderedTileDefIds =
    tileDefIds.length > 0 ? tileDefIds.slice().sort() : ["tile_floodplains"];
  for (let col = 0; col < boardCols; col++) {
    const defId = orderedTileDefIds[col % orderedTileDefIds.length];
    anchors.push(makeEnvTileInstance(defId, state, col, 1));
  }
  return anchors;
}

