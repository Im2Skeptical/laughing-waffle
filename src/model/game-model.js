// game-model.js — facade re-export, stable API for views
// NOTE: Model APIs require explicit `state`.
// `gameState` remains exported for app-edge wiring only.

import { hubStructureDefs } from "../defs/gamepieces/gamepieces-defs.js";

import {
  gameState,
  createEmptyState,
  makeHubStructureInstance,
  initializeInstanceFromDef,
  getCurrentSeasonKey,
  getCurrentSeasonData,
  serializeGameState,
  deserializeGameState,
  loadIntoGameState,
} from "./state.js";

import { initGameState, createInitialState } from "./init.js";

import { runEffect } from "./effects.js";
import { runBehaviorsOnInstance } from "./behaviors.js";
import {
  cmdAdvanceSeason,
  cmdTickSimulation,
  cmdMoveItemBetweenOwners,
  cmdSplitStackAndPlace,
  cmdPlaceCharacter,
  cmdSetPaused,
  cmdSetTileTagOrder,
  cmdSetTileCropSelection,
  canOwnerAcceptItem,
} from "./commands.js";

// =============================================================================
// UPDATE LOOP (orchestration)
// =============================================================================

export function updateGame(dt, state) {
  const s = state; // explicit state threading

  // 1. Master Clock Tick
  const tick = cmdTickSimulation(s, dt);
  if (!tick?.ok) return;

  // 2. Pause Gate
  if (s.paused) return;

  // hub structures: updateGame stays generic; behaviors decide via preconditions
  const hubSlots = Array.isArray(s.hub?.slots) ? s.hub.slots : [];
  for (let i = 0; i < hubSlots.length; i++) {
    const slot = hubSlots[i];
    const structure = slot.structure;
    if (!structure) continue;

    const def = hubStructureDefs[structure.defId];

    const ops =
      runBehaviorsOnInstance(structure, def, dt, s, {
        kind: "hub",
        hubCol: i,
      }) || [];

    for (const op of ops) {
      runEffect(s, op, { kind: "game", state: s, source: structure });
    }
  }

}

// =============================================================================
// Facade command helpers — explicit state required
// =============================================================================


export function advanceSeason(state) {
  return cmdAdvanceSeason(state);
}

export function tryMoveItemBetweenOwners(state, args) {
  return cmdMoveItemBetweenOwners(state, args);
}

export function placeCharacter(state, args) {
  return cmdPlaceCharacter(state, args);
}

export function splitStackAndPlace(state, args) {
  return cmdSplitStackAndPlace(
    state,
    args.ownerId,
    args.itemId,
    args.amount,
    args.targetGX,
    args.targetGY
  );
}

export function setPaused(state, paused) {
  return cmdSetPaused(state, paused);
}

// =============================================================================
// RE-EXPORTS (public API)
// =============================================================================

export {
  // app-edge singleton only
  gameState,

  // core state ops
  createEmptyState,
  serializeGameState,
  deserializeGameState,
  loadIntoGameState,

  // init helpers
  initGameState,
  createInitialState,

  // constructors / helpers (explicit state required by their own signatures)
  makeHubStructureInstance,
  initializeInstanceFromDef,
  getCurrentSeasonKey,
  getCurrentSeasonData,

  // commands
  cmdAdvanceSeason,
  cmdTickSimulation,
  cmdMoveItemBetweenOwners,
  cmdSplitStackAndPlace,
  cmdPlaceCharacter,
  cmdSetPaused,
  cmdSetTileTagOrder,
  cmdSetTileCropSelection,
  canOwnerAcceptItem,
};

