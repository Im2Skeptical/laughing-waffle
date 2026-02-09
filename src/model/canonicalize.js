// src/model/canonicalize.js
// Single source of truth for "planning boundary" state normalization.
// Used by timeline replay, projection, and view caching to ensure consistent snapshots.

import {
  rebuildBoardOccupancy,
  syncPhaseToPaused,
  ensurePawnSkillFields,
} from "./state.js";

export function canonicalizeSnapshot(state) {
  if (!state) return;

  // Ensure monotonic simTime is a number, but do not reset it (preserves history).
  state.simTime = typeof state.simTime === "number" ? state.simTime : 0;

  rebuildBoardOccupancy(state);
  const chars = Array.isArray(state.characters) ? state.characters : [];
  for (const pawn of chars) {
    ensurePawnSkillFields(pawn);
  }
  syncPhaseToPaused(state);
}
