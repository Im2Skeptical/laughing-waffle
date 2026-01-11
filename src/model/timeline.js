// src/model/timeline.js
// serializable action timeline + deterministic rebuild/replay
// STAGE 3: Authoritative tSec replay logic

import { deserializeGameState, serializeGameState } from "./state.js";
import { canonicalizePlanningBoundaryState } from "./canonicalize.js";
import { applyAction } from "./actions.js";
import { updateGame } from "./game-model.js";

const TICKS_PER_SEC = 60;
const MICROSTEP_DT = 1 / TICKS_PER_SEC;

// Checkpoint Strategy Constants
const CP_STRIDE_SEC = 10;
const CP_WINDOW_BACK = 20;
const CP_WINDOW_FWD = 20;

export function isValidTimeline(tl) {
  if (!tl || typeof tl !== "object") return false;
  if (tl.baseStateData == null) return false;
  if (!Array.isArray(tl.actions)) return false;
  return true;
}

export function createEmptyTimelineFromBase(baseState) {
  const baseStateData = serializeGameState(baseState);
  return {
    baseStateData,
    actions: [],
    // Legacy Boundary Cursor (deprecated)
    cursorBoundaryIndex: 0,
    maxReachedBoundaryIndex: 0,
    // Stage 3 Integer Second Cursor
    cursorSec: 0,
    maxReachedSec: 0,
    checkpoints: [],
  };
}

export function createTimelineFromInitialState(initialState) {
  return createEmptyTimelineFromBase(initialState);
}

// -----------------------------------------------------------------------------
// Timeline Mutation (Dual-Write)
// -----------------------------------------------------------------------------

export function appendActionAtCursor(tl, action, state) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  if (!action || typeof action !== "object")
    return { ok: false, reason: "badAction" };

  // Current Authoritative Time
  const t = Math.floor(state?.tSec ?? tl.cursorSec ?? 0);

  // Legacy Boundary (kept for old saves/UI, but not authoritative for season/turn)
  const b = Math.floor(tl.cursorBoundaryIndex ?? 0);

  tl.actions = Array.isArray(tl.actions) ? tl.actions : [];

  tl.actions.push({
    ...action,
    // STAGE 3: Action must carry tSec
    tSec: t,
    // Legacy support
    boundaryIndex: b,
  });

  return { ok: true };
}

// -----------------------------------------------------------------------------
// Checkpoint Management
// -----------------------------------------------------------------------------

export function maintainCheckpoints(tl, state) {
  if (!tl || !state) return;

  const currentSec = Math.floor(state.tSec ?? 0);
  const currentB = Math.floor(state.planningIndex ?? 0);

  tl.cursorSec = currentSec;
  tl.maxReachedSec = Math.max(tl.maxReachedSec ?? 0, currentSec);

  // Strategy: Save every N seconds OR every legacy boundary
  const isStride = currentSec > 0 && currentSec % CP_STRIDE_SEC === 0;

  // Simple deduplication: Check if we already have a checkpoint for this tSec
  const existingIndex = tl.checkpoints.findIndex(
    (c) => c.checkpointSec === currentSec
  );

  if (isStride || existingIndex !== -1) {
    const cpData = {
      // Stage 3
      checkpointSec: currentSec,
      // Legacy/UI
      boundaryIndex: currentB,
      // Data
      stateData: serializeGameState(state),
    };

    if (existingIndex !== -1) {
      tl.checkpoints[existingIndex] = cpData;
    } else {
      tl.checkpoints.push(cpData);
      tl.checkpoints.sort(
        (a, b) => (a.checkpointSec ?? 0) - (b.checkpointSec ?? 0)
      );
    }
  }

  // Pruning (Keep some window around current time)
  tl.checkpoints = tl.checkpoints.filter((cp) => {
    const s = cp.checkpointSec ?? 0;
    if (s === 0) return true; // Keep Genesis
    if (s % CP_STRIDE_SEC === 0) return true; // Keep Strides
    if (s >= currentSec - CP_WINDOW_BACK && s <= currentSec + CP_WINDOW_FWD)
      return true;
    if (s === tl.maxReachedSec) return true; // Keep Head
    return false;
  });
}

// -----------------------------------------------------------------------------
// Time-Based Replay (tSec)
// -----------------------------------------------------------------------------

function indexActionsBySecond(actions) {
  const map = new Map();
  for (const a of actions || []) {
    const s = Math.max(0, Math.floor(a.tSec ?? 0));
    if (!map.has(s)) map.set(s, []);
    map.get(s).push(a);
  }
  return map;
}

export function rebuildStateAtSecond(tl, targetSec) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  if (!Number.isFinite(targetSec) || targetSec < 0) {
    return { ok: false, reason: "badTargetSec" };
  }

  const target = Math.floor(targetSec);

  // 1. Find nearest checkpoint <= target
  let bestCp = null;
  for (const cp of tl.checkpoints) {
    const s = cp.checkpointSec ?? -1;
    if (s >= 0 && s <= target) {
      if (!bestCp || s > (bestCp.checkpointSec ?? -1)) {
        bestCp = cp;
      }
    }
  }

  const startSec = bestCp ? bestCp.checkpointSec ?? 0 : 0;
  const startStateData = bestCp ? bestCp.stateData : tl.baseStateData;

  const state = deserializeGameState(startStateData);

  // Ensure restored state clock matches checkpoint expectation
  state.tSec = startSec;
  state.simStepIndex = startSec * TICKS_PER_SEC;

  // Optional: normalize snapshot flags for consistency (does NOT touch season/turn)
  canonicalizePlanningBoundaryState(state, state.planningIndex ?? 0);

  // 2. Index actions
  const actionsBySec = indexActionsBySecond(tl.actions);

  // 3. Replay Loop: s = startSec ... target
  for (let s = startSec; s <= target; s++) {
    // a) Apply actions for this second
    const acts = actionsBySec.get(s);
    if (acts && acts.length) {
      for (const a of acts) {
        const res = applyAction(state, a, { isReplay: true });
        if (!res?.ok) {
          console.warn(`Replay action failed at t=${s}: ${res.reason}`, a);
          return { ok: false, reason: "actionFailed", detail: res };
        }
      }
    }

    // b) Run exactly 60 microsteps IF we are not yet at target
    //    (If s == target, we have applied actions for 'target' and we STOP).
    if (s < target) {
      for (let i = 0; i < TICKS_PER_SEC; i++) {
        updateGame(MICROSTEP_DT, state);
      }
    }
  }

  return { ok: true, state };
}

// -----------------------------------------------------------------------------
// Timeline Truncation
// -----------------------------------------------------------------------------

export function truncateActionsAfterSecond(actions, tSec) {
  const t = Math.floor(tSec);
  return (actions || []).filter((a) => Math.floor(a.tSec ?? 0) <= t);
}

export function truncateCheckpointsAfterSecond(checkpoints, tSec) {
  const t = Math.floor(tSec);
  return (checkpoints || []).filter(
    (c) => Math.floor(c.checkpointSec ?? 0) <= t
  );
}

// -----------------------------------------------------------------------------
// Legacy Boundary Support (Preserved but deprecated)
// -----------------------------------------------------------------------------

export function truncateActionsAfterBoundary(actions, boundaryIndex) {
  const b = Math.floor(boundaryIndex);
  return (actions || []).filter((a) => Math.floor(a.boundaryIndex ?? 0) <= b);
}

export function truncateCheckpointsAfterBoundary(checkpoints, boundaryIndex) {
  const b = Math.floor(boundaryIndex);
  return (checkpoints || []).filter(
    (c) => Math.floor(c.boundaryIndex ?? 0) <= b
  );
}

// Legacy: treat boundaryIndex as a simple time index fallback.
// This is for old UI paths only; do not use boundaryIndex to derive season/turn.
export function rebuildStateAtBoundary(tl, boundaryIndex) {
  return rebuildStateAtSecond(tl, boundaryIndex);
}
