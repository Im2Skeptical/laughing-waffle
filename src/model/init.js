// init.js — scenario/setup assembly (NO core exports here besides init/createInitialState)

import { permanentDefs } from "../defs/gamepieces/gamepieces-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { setupDefs } from "../defs/gamesettings/scenarios-defs.js";

import {
  createEmptyState,
  makeEnvInstance,
  makeEnvTileInstance,
  makePermanentInstance,
  buildSeasonDeckForCurrentSeason,
  rebuildBoardOccupancy,
} from "./state.js";

import { Inventory, initializeItemFromDef } from "./inventory-model.js";

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
  state.nextPermanentInstanceId = 1;
  state.nextEnvInstanceId = 1;
  state.nextItemId = 1;
  state.nextCharacterId = 101;

  const boardCols = getBoardColsFromSetup(setup, state);
  ensureBoardCols(state, boardCols);

  // permanents
  state.permanentSlots = buildPermanentSlots(setup, boardCols, state);

  // env slots
  state.envSlots = (setup.envSlots || []).map((envDefId) => ({
    env: envDefId ? makeEnvInstance(envDefId, state) : null,
  }));

  state.board.layers.tile.anchors = buildTileAnchors(setup, boardCols, state);

  // characters
  state.characters = (setup.characters || []).map((c, index) => {
    const wantsEnvRow = c?.row === "env" || Number.isFinite(c?.envCol);
    const envCol = wantsEnvRow
      ? getColIndex({ envCol: c.envCol }, index, boardCols)
      : null;
    const hubCol = wantsEnvRow
      ? null
      : getColIndex({ hubCol: c.hubCol }, index, boardCols);
    return {
      id: state.nextCharacterId++,
      name: c.name,
      color: c.color,
      hubCol,
      envCol,
      props: {},
    };
  });

  // inventories
  state.ownerInventories = {};

  // permanent inventories
  for (const slot of state.permanentSlots) {
    const perm = slot.permanent;
    if (!perm) continue;
    const def = permanentDefs[perm.defId];
    const hasInventory = def?.tags?.includes("hasInventory") && def.inventory;
    if (!hasInventory) continue;

    const cols = def.inventory.cols ?? 10;
    const rows = def.inventory.rows ?? 10;
    const inv = Inventory.create(cols, rows);
    Inventory.init(inv);
    inv.version = 0;
    state.ownerInventories[perm.instanceId] = inv;
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

  const permIdsInOrder = state.permanentSlots.map(
    (s) => s?.permanent?.instanceId ?? null
  );
  const charIdsInOrder = state.characters.map((c) => c.id);

  for (const spec of invSpecs) {
    const owner = spec.owner;
    if (!owner) continue;

    let ownerId = null;

    if (owner.type === "permanent") {
      const idx =
        Number.isFinite(owner.hubCol)
          ? getColIndex(owner, owner.index ?? 0, permIdsInOrder.length)
          : owner.index;
      ownerId = permIdsInOrder[idx];
    } else if (owner.type === "permanentSlot") {
      ownerId = permIdsInOrder[getColIndex(owner, owner.index ?? 0, permIdsInOrder.length)];
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

      if (item) initializeItemFromDef(state, item);
    }

    inv.version = (inv.version ?? 0) + 1;
  }
}

function getBoardColsFromSetup(setup, state) {
  const candidate = setup?.board?.cols;
  if (Number.isFinite(candidate)) return Math.max(1, Math.floor(candidate));
  return Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 12;
}

function ensureBoardCols(state, cols) {
  if (!state?.board) return;
  if (state.board.cols === cols) return;
  state.board.cols = cols;
  if (!state.board.layers) {
    state.board.layers = { tile: { anchors: [] }, event: { anchors: [] }, permanent: { anchors: [] } };
  }
  if (!state.board.occ) {
    state.board.occ = { tile: [], event: [], permanent: [] };
  }
  for (const layer of ["tile", "event", "permanent"]) {
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

function buildPermanentSlots(setup, boardCols, state) {
  const slots = new Array(boardCols).fill(null).map(() => ({ permanent: null }));
  const occupiedBy = new Array(boardCols).fill(null);
  const specs = Array.isArray(setup.permanents) ? setup.permanents : [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (!spec?.defId) continue;
    const def = permanentDefs[spec.defId];
    const span =
      Number.isFinite(spec.span) && spec.span > 0
        ? Math.floor(spec.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
          ? Math.floor(def.defaultSpan)
          : 1;
    if (span > boardCols) continue;
    let hubCol = getColIndex(spec, i, boardCols);
    if (hubCol < 0 || hubCol >= boardCols) continue;
    if (hubCol + span > boardCols) hubCol = boardCols - span;

    let blocked = false;
    for (let offset = 0; offset < span; offset++) {
      if (occupiedBy[hubCol + offset] != null) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const permanent = makePermanentInstance(spec.defId, state);
    slots[hubCol] = {
      x: spec.x,
      y: spec.y,
      permanent,
    };
    for (let offset = 0; offset < span; offset++) {
      occupiedBy[hubCol + offset] = permanent.instanceId;
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

