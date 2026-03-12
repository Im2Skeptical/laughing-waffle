// game-model.js — facade re-export, stable API for views
// NOTE: Model APIs require explicit `state`.
// `gameState` remains exported for app-edge wiring only.

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
  loadStateObjectIntoGameState,
} from "./state.js";

import { initGameState, createInitialState } from "./init.js";

import {
  cmdAdvanceSeason,
  cmdTickSimulation,
  cmdMoveItemBetweenOwners,
  cmdSplitStackAndPlace,
  cmdPlacePawn,
  cmdSetPaused,
  cmdSetTileTagOrder,
  cmdSetTileCropSelection,
  cmdBuildDesignate,
  cmdCancelBuild,
  canOwnerAcceptItem,
  cmdAdjustFollowerCount,
  cmdAdjustWorkerCount,
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

export function placePawn(state, args) {
  return cmdPlacePawn(state, args);
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
  loadStateObjectIntoGameState,

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
  cmdPlacePawn,
  cmdSetPaused,
  cmdSetTileTagOrder,
  cmdSetTileCropSelection,
  cmdBuildDesignate,
  cmdCancelBuild,
  cmdAdjustFollowerCount,
  cmdAdjustWorkerCount,
  canOwnerAcceptItem,
};

