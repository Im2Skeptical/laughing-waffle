// src/model/canonicalize.js
// Single source of truth for "planning boundary" state normalization.
// Used by timeline replay, projection, and view caching to ensure consistent snapshots.
//
// IMPORTANT (Season/Turn Decoupling):
// - Planning boundaries are a UI/snapshot concept.
// - Season + turn identity must NOT be derived from boundaryIndex arithmetic.

import { syncPhaseToPaused } from "./state.js";

export function canonicalizePlanningBoundaryState(state, boundaryIndex) {
  if (!state) return;

  // Ensure monotonic simTime is a number, but do not reset it (preserves history).
  state.simTime = typeof state.simTime === "number" ? state.simTime : 0;

  // Legacy/UI-only: boundary marker. Safe to set only if missing.
  // Do NOT derive turn/season from boundary indices.
  const b = Math.max(0, Math.floor(boundaryIndex ?? 0));
  state.planningIndex = b;

  // Stage 5 policy: phase is a normalized semantic label derived from paused.
  syncPhaseToPaused(state);
}
