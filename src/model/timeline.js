// src/model/timeline.js
// serializable action timeline + deterministic rebuild/replay
// scrub memo cache (revision-keyed) + defensive invalidation guard
// persistent actionsBySec indexing (derived, non-serialized)

import { deserializeGameState, serializeGameState } from "./state.js";
import { canonicalizeSnapshot } from "./canonicalize.js";
import { applyAction } from "./actions.js";
import { updateGame } from "./game-model.js";

const TICKS_PER_SEC = 60;
const MICROSTEP_DT = 1 / TICKS_PER_SEC;

// Checkpoint Strategy Constants
const CP_STRIDE_SEC = 2;
const CP_WINDOW_BACK = 1800;
const CP_WINDOW_FWD = 1500;

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
    // Integer Second Cursor
    cursorSec: 0,
    maxReachedSec: 0,
    checkpoints: [],
    // Stage 3 perf: revision invalidates memo caches
    revision: 0,
    // Derived (non-serialized): memo + mutation guard + actionsBySec are lazy-created
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
// STAGE 5: persistent actionsBySec index (derived, non-serialized)
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

function computeActionsMutationSig(tl) {
  const acts = Array.isArray(tl.actions) ? tl.actions : [];
  const aLen = acts.length;
  const aLast = aLen ? acts[aLen - 1] : null;
  return {
    aRef: tl.actions,
    aLen,
    aLastRef: aLast,
    aLastSec: aLast ? Math.floor(aLast.tSec ?? 0) : 0,
  };
}

function actionsSigEquals(a, b) {
  if (!a || !b) return false;
  return (
    a.aRef === b.aRef &&
    a.aLen === b.aLen &&
    a.aLastRef === b.aLastRef &&
    a.aLastSec === b.aLastSec
  );
}

function rebuildActionsBySecIndex(tl) {
  tl.actionsBySec = indexActionsBySecond(tl.actions);
  tl._actionsBySecSig = computeActionsMutationSig(tl);
}

function ensureActionsBySecFresh(tl) {
  const cur = computeActionsMutationSig(tl);
  if (!actionsSigEquals(cur, tl._actionsBySecSig) || !tl.actionsBySec) {
    rebuildActionsBySecIndex(tl);
  }
}

// -----------------------------------------------------------------------------
// Defensive invalidation guard (Stage 3 exit requirement)
// -----------------------------------------------------------------------------

function computeTimelineMutationSig(tl) {
  const acts = Array.isArray(tl.actions) ? tl.actions : [];
  const cps = Array.isArray(tl.checkpoints) ? tl.checkpoints : [];

  const aLen = acts.length;
  const cLen = cps.length;

  const aLast = aLen ? acts[aLen - 1] : null;
  const cLast = cLen ? cps[cLen - 1] : null;

  const baseRef = tl.baseStateData;
  const aRef = tl.actions;
  const cRef = tl.checkpoints;

  const aLastRef = aLast;
  const cLastRef = cLast;

  const aLastSec = aLast ? Math.floor(aLast.tSec ?? 0) : 0;
  const cLastSec = cLast ? Math.floor(cLast.checkpointSec ?? 0) : 0;

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
    bumpRevision(tl);
    tl._memoGuardSig = cur;

    // rebuild persistent actionsBySec index on mutation
    rebuildActionsBySecIndex(tl);

    return { bumped: true };
  }

  // Even if revision wasn't bumped, keep actionsBySec fresh (cheap)
  ensureActionsBySecFresh(tl);

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
  tl.actions = Array.isArray(tl.actions) ? tl.actions : [];

  const entry = {
    ...action,
    tSec: t,
  };

  tl.actions.push(entry);

  // Incrementally update actionsBySec if present; otherwise leave lazy.
  if (tl.actionsBySec) {
    const sec = Math.max(0, Math.floor(entry.tSec ?? 0));
    let arr = tl.actionsBySec.get(sec);
    if (!arr) {
      arr = [];
      tl.actionsBySec.set(sec, arr);
    }
    arr.push(entry);
    tl._actionsBySecSig = computeActionsMutationSig(tl);
  }

  tl._memoGuardSig = computeTimelineMutationSig(tl);

  return { ok: true };
}

export function replaceActionsAtSecond(tl, tSec, actionsAtSec, opts = {}) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  const t = Math.max(0, Math.floor(tSec));
  const truncateFuture = opts.truncateFuture !== false;

  bumpRevision(tl);

  const before = [];
  const after = [];
  const acts = Array.isArray(tl.actions) ? tl.actions : [];

  for (const action of acts) {
    const sec = Math.floor(action.tSec ?? 0);
    if (sec < t) before.push(action);
    else if (sec > t) after.push(action);
  }

  const replacements = Array.isArray(actionsAtSec) ? actionsAtSec : [];
  const normalized = replacements.map((action) => ({
    ...action,
    tSec: t,
  }));

  tl.actions = truncateFuture
    ? [...before, ...normalized]
    : [...before, ...normalized, ...after];

  rebuildActionsBySecIndex(tl);
  tl._memoGuardSig = computeTimelineMutationSig(tl);

  return { ok: true };
}

// -----------------------------------------------------------------------------
// Checkpoint Management
// -----------------------------------------------------------------------------

export function maintainCheckpoints(tl, state) {
  if (!tl || !state) return;

  const currentSec = Math.floor(state.tSec ?? 0);

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
      appliedThroughSec: currentSec,
      stateData: serializeGameState(state),
    };

    if (existingIndex !== -1) {
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

  if (checkpointsChanged) {
    bumpRevision(tl);
    tl._memoGuardSig = computeTimelineMutationSig(tl);
  }
}

// -----------------------------------------------------------------------------
// Time-Based Replay (tSec)
// -----------------------------------------------------------------------------

export function rebuildStateAtSecond(tl, targetSec) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  if (!Number.isFinite(targetSec) || targetSec < 0) {
    return { ok: false, reason: "badTargetSec" };
  }

  // Invalidate memo if timeline mutated out-of-band, and keep actionsBySec index fresh.
  ensureRevisionFreshAgainstOutOfBandMutations(tl);

  const target = Math.floor(targetSec);

  // Memo fast-path
  const memoStateData = memoGetStateData(tl, target);
  if (memoStateData != null) {
    const state = deserializeGameState(memoStateData);
    canonicalizeSnapshot(state);
    return { ok: true, state, memoHit: true };
  }

  // 1) Find nearest checkpoint <= target
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
  const skipActionsAtStartSec =
    bestCp &&
    Number.isFinite(bestCp.appliedThroughSec) &&
    bestCp.appliedThroughSec >= startSec;

  const state = deserializeGameState(startStateData);

  state.tSec = startSec;
  state.simStepIndex = startSec * TICKS_PER_SEC;

  // Replay ignores pause gating; timeline time only advances when unpaused.
  state.paused = false;
  canonicalizeSnapshot(state);

  // 2) Replay second-by-second
  // Prefer persistent index if present; fall back to local indexing otherwise.
  const actionsBySec = tl.actionsBySec ?? indexActionsBySecond(tl.actions);

  for (let s = startSec; s <= target; s++) {
    if (!(skipActionsAtStartSec && s === startSec)) {
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
    }

    if (s < target) {
      for (let i = 0; i < TICKS_PER_SEC; i++) {
        updateGame(MICROSTEP_DT, state);
      }
    }
  }

  memoPutStateData(tl, target, serializeGameState(state));
  tl._memoGuardSig = computeTimelineMutationSig(tl);

  // Keep actionsBySec fresh in case callers rely on it post-rebuild.
  ensureActionsBySecFresh(tl);

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

  tl._memoGuardSig = computeTimelineMutationSig(tl);

  // Rebuild index after truncation
  rebuildActionsBySecIndex(tl);

  return { ok: true };
}

// -----------------------------------------------------------------------------
// Legacy Boundary Support (Preserved but deprecated)
// -----------------------------------------------------------------------------

export function truncateActionsAfterBoundary(actions, boundaryIndex) {
  const b = Math.floor(boundaryIndex);
  return (actions || []).filter((a) => Math.floor(a.tSec ?? 0) <= b);
}

export function truncateCheckpointsAfterBoundary(checkpoints, boundaryIndex) {
  const b = Math.floor(boundaryIndex);
  return (checkpoints || []).filter(
    (c) => Math.floor(c.checkpointSec ?? 0) <= b
  );
}

export function truncateTimelineAfterBoundary(tl, boundaryIndex) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  const b = Math.max(0, Math.floor(boundaryIndex));

  bumpRevision(tl);

  tl.actions = truncateActionsAfterBoundary(tl.actions, b);
  tl.checkpoints = truncateCheckpointsAfterBoundary(tl.checkpoints, b);

  tl.maxReachedSec = Math.min(Math.floor(tl.maxReachedSec ?? 0), b);
  tl.cursorSec = Math.min(Math.floor(tl.cursorSec ?? 0), b);

  tl._memoGuardSig = computeTimelineMutationSig(tl);

  // Stage 5: rebuild index after truncation
  rebuildActionsBySecIndex(tl);

  return { ok: true };
}

export function rebuildStateAtBoundary(tl, boundaryIndex) {
  return rebuildStateAtSecond(tl, boundaryIndex);
}
