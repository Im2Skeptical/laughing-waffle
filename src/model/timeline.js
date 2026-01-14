// src/model/timeline.js
// serializable action timeline + deterministic rebuild/replay
// STAGE 3: Authoritative tSec replay logic + scrub memo cache (revision-keyed)
// Fix: defensive invalidation guard in rebuildStateAtSecond to handle out-of-band mutations.

import { deserializeGameState, serializeGameState } from "./state.js";
import { canonicalizePlanningBoundaryState } from "./canonicalize.js";
import { applyAction } from "./actions.js";
import { updateGame } from "./game-model.js";

const TICKS_PER_SEC = 60;
const MICROSTEP_DT = 1 / TICKS_PER_SEC;

// Checkpoint Strategy Constants
const CP_STRIDE_SEC = 1;
const CP_WINDOW_BACK = 120000;
const CP_WINDOW_FWD = 1;

// Memo cache defaults (non-serialized derived fields stored on timeline object)
const DEFAULT_MEMO_CAP = 512;

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
    // Integer Second Cursor
    cursorSec: 0,
    maxReachedSec: 0,
    checkpoints: [],
    // Stage 3 perf: revision invalidates memo caches
    revision: 0,
    // Derived (non-serialized): memo + mutation guard are lazy-created
  };
}

export function createTimelineFromInitialState(initialState) {
  return createEmptyTimelineFromBase(initialState);
}

// -----------------------------------------------------------------------------
// Internal helpers: revision + memo cache
// -----------------------------------------------------------------------------

function ensureRevision(tl) {
  if (!Number.isFinite(tl.revision)) tl.revision = 0;
  tl.revision = Math.max(0, Math.floor(tl.revision));
  return tl.revision;
}

function bumpRevision(tl) {
  const r = ensureRevision(tl);
  tl.revision = r + 1;
  // Clear memo eagerly to prevent growth; revision-keying also invalidates hits.
  if (tl.memoStateBySec) tl.memoStateBySec.clear();
  if (tl.memoFifo) tl.memoFifo.length = 0;
  return tl.revision;
}

function ensureMemo(tl) {
  if (!tl.memoStateBySec) tl.memoStateBySec = new Map();
  if (!tl.memoFifo) tl.memoFifo = [];
  if (!Number.isFinite(tl.memoCap) || tl.memoCap <= 0) {
    tl.memoCap = DEFAULT_MEMO_CAP;
  } else {
    tl.memoCap = Math.floor(tl.memoCap);
  }
}

function memoKey(tl, sec) {
  const r = ensureRevision(tl);
  return `${r}:${Math.max(0, Math.floor(sec))}`;
}

function memoGetStateData(tl, sec) {
  if (!tl.memoStateBySec) return null;
  return tl.memoStateBySec.get(memoKey(tl, sec)) ?? null;
}

function memoPutStateData(tl, sec, stateData) {
  ensureMemo(tl);
  const key = memoKey(tl, sec);

  if (!tl.memoStateBySec.has(key)) {
    tl.memoFifo.push(key);
  }
  tl.memoStateBySec.set(key, stateData);

  const cap = tl.memoCap ?? DEFAULT_MEMO_CAP;
  while (tl.memoFifo.length > cap) {
    const oldest = tl.memoFifo.shift();
    if (oldest != null) tl.memoStateBySec.delete(oldest);
  }
}

// -----------------------------------------------------------------------------
// Defensive invalidation guard (Stage 3 exit requirement)
// -----------------------------------------------------------------------------
//
// Many call sites may still mutate tl.actions / tl.checkpoints directly or via
// pure helpers without bumping revision. To guarantee correctness, we detect
// structural changes and bump revision (clearing memo) before using memo hits.
//
// This guard is intentionally cheap and focuses on mutation patterns that matter:
// - array replacement (new ref)
// - truncation/appends (length changes)
// - head/tail changes (last element identity / tSec / checkpointSec)
//
// In-place mutation of existing action objects without changing any of these
// signals is discouraged; if it exists, it should be refactored to create new
// objects (or explicitly bump revision at the call site).

function computeTimelineMutationSig(tl) {
  const acts = Array.isArray(tl.actions) ? tl.actions : [];
  const cps = Array.isArray(tl.checkpoints) ? tl.checkpoints : [];

  const aLen = acts.length;
  const cLen = cps.length;

  const aLast = aLen ? acts[aLen - 1] : null;
  const cLast = cLen ? cps[cLen - 1] : null;

  // Include refs so that pure helper usage (returning new arrays) is detected.
  // Weak structural info so we don’t scan entire arrays.
  const baseRef = tl.baseStateData;
  const aRef = tl.actions;
  const cRef = tl.checkpoints;

  const aLastRef = aLast;
  const cLastRef = cLast;

  const aLastSec = aLast ? Math.floor(aLast.tSec ?? 0) : 0;
  const cLastSec = cLast ? Math.floor(cLast.checkpointSec ?? 0) : 0;

  // Return a tuple-like object; compare by fields.
  return {
    baseRef,
    aRef,
    aLen,
    aLastRef,
    aLastSec,
    cRef,
    cLen,
    cLastRef,
    cLastSec,
  };
}

function mutationSigEquals(a, b) {
  if (!a || !b) return false;
  return (
    a.baseRef === b.baseRef &&
    a.aRef === b.aRef &&
    a.aLen === b.aLen &&
    a.aLastRef === b.aLastRef &&
    a.aLastSec === b.aLastSec &&
    a.cRef === b.cRef &&
    a.cLen === b.cLen &&
    a.cLastRef === b.cLastRef &&
    a.cLastSec === b.cLastSec
  );
}

function ensureRevisionFreshAgainstOutOfBandMutations(tl) {
  const cur = computeTimelineMutationSig(tl);
  const prev = tl._memoGuardSig;

  if (!mutationSigEquals(cur, prev)) {
    // Any structural change => invalidate memo.
    bumpRevision(tl);
    tl._memoGuardSig = cur;
    return { bumped: true };
  }

  return { bumped: false };
}

// -----------------------------------------------------------------------------
// Timeline Mutation (Dual-Write)
// -----------------------------------------------------------------------------

export function appendActionAtCursor(tl, action, state) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  if (!action || typeof action !== "object")
    return { ok: false, reason: "badAction" };

  bumpRevision(tl);

  const t = Math.floor(state?.tSec ?? tl.cursorSec ?? 0);
  const b = Math.floor(tl.cursorBoundaryIndex ?? 0);

  tl.actions = Array.isArray(tl.actions) ? tl.actions : [];

  tl.actions.push({
    ...action,
    tSec: t,
    boundaryIndex: b,
  });

  // Keep guard signature aligned after mutation
  tl._memoGuardSig = computeTimelineMutationSig(tl);

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

  const isStride = currentSec > 0 && currentSec % CP_STRIDE_SEC === 0;

  let checkpointsChanged = false;

  const existingIndex = tl.checkpoints.findIndex(
    (c) => c.checkpointSec === currentSec
  );

  if (isStride || existingIndex !== -1) {
    const cpData = {
      checkpointSec: currentSec,
      boundaryIndex: currentB,
      stateData: serializeGameState(state),
    };

    if (existingIndex !== -1) {
      // Treat update as mutation (stateData changes)
      tl.checkpoints[existingIndex] = cpData;
      checkpointsChanged = true;
    } else {
      tl.checkpoints.push(cpData);
      tl.checkpoints.sort(
        (a, b) => (a.checkpointSec ?? 0) - (b.checkpointSec ?? 0)
      );
      checkpointsChanged = true;
    }
  }

  const beforeLen = tl.checkpoints.length;

  tl.checkpoints = tl.checkpoints.filter((cp) => {
    const s = cp.checkpointSec ?? 0;
    if (s === 0) return true;
    if (s % CP_STRIDE_SEC === 0) return true;
    if (s >= currentSec - CP_WINDOW_BACK && s <= currentSec + CP_WINDOW_FWD)
      return true;
    if (s === tl.maxReachedSec) return true;
    return false;
  });

  if (tl.checkpoints.length !== beforeLen) checkpointsChanged = true;

  // If checkpoints changed, bump revision so memo cannot reuse states that assumed
  // a different checkpoint set (even though revision-keying already protects).
  if (checkpointsChanged) {
    bumpRevision(tl);
    tl._memoGuardSig = computeTimelineMutationSig(tl);
  }
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

  // Stage 3 safety: invalidate memo if timeline mutated out-of-band
  ensureRevisionFreshAgainstOutOfBandMutations(tl);

  const target = Math.floor(targetSec);

  // Memo fast-path
  const memoStateData = memoGetStateData(tl, target);
  if (memoStateData != null) {
    const state = deserializeGameState(memoStateData);
    canonicalizePlanningBoundaryState(state, state.planningIndex ?? 0);
    return { ok: true, state, memoHit: true };
  }

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

  state.tSec = startSec;
  state.simStepIndex = startSec * TICKS_PER_SEC;

  canonicalizePlanningBoundaryState(state, state.planningIndex ?? 0);

  // 2. Index actions
  const actionsBySec = indexActionsBySecond(tl.actions);

  // 3. Replay Loop: s = startSec ... target
  for (let s = startSec; s <= target; s++) {
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

    if (s < target) {
      for (let i = 0; i < TICKS_PER_SEC; i++) {
        updateGame(MICROSTEP_DT, state);
      }
    }
  }

  memoPutStateData(tl, target, serializeGameState(state));
  tl._memoGuardSig = computeTimelineMutationSig(tl);

  return { ok: true, state, memoHit: false };
}

// -----------------------------------------------------------------------------
// Pure truncation helpers (still exported)
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
// Timeline Truncation (timeline-level mutators)
// -----------------------------------------------------------------------------

export function truncateTimelineAfterSecond(tl, tSec) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  const t = Math.max(0, Math.floor(tSec));

  bumpRevision(tl);

  tl.actions = truncateActionsAfterSecond(tl.actions, t);
  tl.checkpoints = truncateCheckpointsAfterSecond(tl.checkpoints, t);

  tl.maxReachedSec = Math.min(Math.floor(tl.maxReachedSec ?? 0), t);
  tl.cursorSec = Math.min(Math.floor(tl.cursorSec ?? 0), t);

  tl.maxReachedBoundaryIndex = tl.maxReachedSec;
  tl.cursorBoundaryIndex = tl.cursorSec;

  tl._memoGuardSig = computeTimelineMutationSig(tl);

  return { ok: true };
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

export function truncateTimelineAfterBoundary(tl, boundaryIndex) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  const b = Math.max(0, Math.floor(boundaryIndex));

  bumpRevision(tl);

  tl.actions = truncateActionsAfterBoundary(tl.actions, b);
  tl.checkpoints = truncateCheckpointsAfterBoundary(tl.checkpoints, b);

  tl.maxReachedBoundaryIndex = Math.min(
    Math.floor(tl.maxReachedBoundaryIndex ?? 0),
    b
  );
  tl.cursorBoundaryIndex = Math.min(Math.floor(tl.cursorBoundaryIndex ?? 0), b);

  tl.maxReachedSec = tl.maxReachedBoundaryIndex;
  tl.cursorSec = tl.cursorBoundaryIndex;

  tl._memoGuardSig = computeTimelineMutationSig(tl);

  return { ok: true };
}

export function rebuildStateAtBoundary(tl, boundaryIndex) {
  return rebuildStateAtSecond(tl, boundaryIndex);
}
