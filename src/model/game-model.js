// game-model.js — facade re-export, stable API for views
// NOTE: Model APIs require explicit `state`.
// `gameState` remains exported for app-edge wiring only.

import { envCardDefs, permanentDefs } from "../defs/gamepieces-defs.js";

import {
  gameState,
  createEmptyState,
  makeEnvInstance,
  makePermanentInstance,
  initializeInstanceFromDef,
  buildInitialEnvDecks,
  getCurrentSeasonKey,
  getCurrentSeasonData,
  refillEnvSlots,
  drawEnvDefId,
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
  cmdRefillEnvSlot,
  cmdMoveItemBetweenOwners,
  cmdSplitStackAndPlace,
  cmdPlaceCharacterInSlot,
  cmdSetPaused,
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

  // env season data (used for any env-targeted ops)
  const seasonData = getCurrentSeasonData(s);

  // permanents: updateGame stays generic; behaviors decide via preconditions
  for (let i = 0; i < s.permanentSlots.length; i++) {
    const slot = s.permanentSlots[i];
    const perm = slot.permanent;
    if (!perm) continue;

    const def = permanentDefs[perm.defId];

    const ops =
      runBehaviorsOnInstance(perm, def, dt, s, {
        kind: "permanent",
        slotIndex: i,
      }) || [];

    for (const op of ops) {
      // Explicit env targeting
      if (
        op &&
        (op.targetKind === "env" || typeof op.envSlotIndex === "number")
      ) {
        const idx = op.envSlotIndex;
        const envSlot = typeof idx === "number" ? s.envSlots?.[idx] : null;
        if (envSlot && envSlot.env) {
          runEffect(s, op, {
            kind: "env",
            slot: envSlot,
            state: s,
            seasonData,
          });
        }
        continue;
      }

      runEffect(s, op, { kind: "game", state: s });
    }
  }

  // env behaviors -> EffectOps -> runEffect
  for (let i = 0; i < s.envSlots.length; i++) {
    const slot = s.envSlots[i];
    const env = slot.env;

    if (env) {
      const def = envCardDefs[env.defId];

      const ops =
        runBehaviorsOnInstance(env, def, dt, s, { kind: "env" }) || [];

      for (const op of ops) {
        const targetSlot =
          op && typeof op.envSlotIndex === "number"
            ? s.envSlots?.[op.envSlotIndex] || slot
            : slot;

        runEffect(s, op, {
          kind: "env",
          slot: targetSlot,
          state: s,
          seasonData,
        });

        if (!slot.env) break;
      }
    }

    // Preserve prior semantics: refill immediately after processing this slot,
    // but route the mutation through a command instead of updateGame.
    cmdRefillEnvSlot(s, i);
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

export function placeCharacterInSlot(state, args) {
  return cmdPlaceCharacterInSlot(state, args);
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
  makeEnvInstance,
  makePermanentInstance,
  initializeInstanceFromDef,
  buildInitialEnvDecks,
  getCurrentSeasonKey,
  getCurrentSeasonData,
  refillEnvSlots,
  drawEnvDefId,

  // commands
  cmdAdvanceSeason,
  cmdTickSimulation,
  cmdRefillEnvSlot,
  cmdMoveItemBetweenOwners,
  cmdSplitStackAndPlace,
  cmdPlaceCharacterInSlot,
  cmdSetPaused,
  canOwnerAcceptItem,
};
