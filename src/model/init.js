// init.js — scenario/setup assembly (NO core exports here besides init/createInitialState)

import { permanentDefs } from "../defs/gamepieces-defs.js";
import { setupDefs } from "../defs/scenarios-defs.js";

import {
  createEmptyState,
  makeEnvInstance,
  makePermanentInstance,
  buildInitialEnvDecks,
  refillEnvSlots,
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

  // permanents
  state.permanentSlots = (setup.permanents || []).map((p) => ({
    x: p.x,
    y: p.y,
    permanent: makePermanentInstance(p.defId, state),
  }));

  // env slots
  state.envSlots = (setup.envSlots || []).map((envDefId) => ({
    env: envDefId ? makeEnvInstance(envDefId, state) : null,
  }));

  // characters
  state.characters = (setup.characters || []).map((c) => ({
    id: state.nextCharacterId++,
    name: c.name,
    color: c.color,
    slotIndex: c.slotIndex ?? 0,
    props: {},
  }));

  // inventories
  state.ownerInventories = {};

  // permanent inventories
  for (const slot of state.permanentSlots) {
    const perm = slot.permanent;
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

  // decks
  if (setup.envDecks) {
    state.envSeasons = JSON.parse(JSON.stringify(setup.envDecks));
  } else {
    buildInitialEnvDecks(state);
  }

  // fill empty env slots
  refillEnvSlots(state);

  return state;
}

// Back-compat: mutate an existing state object in-place (views call initGameState(gameState, "testing"))
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
    (s) => s.permanent.instanceId
  );
  const charIdsInOrder = state.characters.map((c) => c.id);

  for (const spec of invSpecs) {
    const owner = spec.owner;
    if (!owner) continue;

    let ownerId = null;

    if (owner.type === "permanent") {
      ownerId = permIdsInOrder[owner.index];
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
