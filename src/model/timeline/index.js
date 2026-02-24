// src/model/timeline/index.js
// serializable action timeline + deterministic rebuild/replay
// scrub memo cache (second-keyed) + defensive invalidation guard
// persistent actionsBySec indexing (derived, non-serialized)

import { deserializeGameState, serializeGameState } from "../state.js";
import { canonicalizeSnapshot } from "../canonicalize.js";
import { applyAction } from "../actions.js";
import { updateGame } from "../game-model.js";
import {
  clonePersistentKnowledge,
  ensurePersistentKnowledgeState,
  mergePersistentKnowledge,
} from "../persistent-memory.js";
import {
  perfEnabled,
  perfNowMs,
  recordTimelineRebuild,
  recordCheckpointMaintenance,
} from "../perf.js";
import {
  computeActionsMutationSig,
  ensureActionSecondsIndex,
  ensureActionSecondsRangeCache,
  ensureActionSecondsVersion,
  ensureActionsBySecFresh,
  indexActionsBySecond,
  insertSortedSecond,
  lowerBoundSorted,
  markActionSecondsChanged,
  putActionSecondsRangeCache,
  rebuildActionsBySecIndex,
  removeSortedSecond,
  upperBoundSorted,
} from "./action-index.js";
import {
  DEFAULT_STATE_DATA_ESTIMATE_BYTES,
  estimateStateDataBytes,
  findNearestMemoStateDataAtOrBefore,
  memoGetStateData,
  memoPutStateData,
  pruneMemoAtOrAfter,
} from "./memo-cache.js";
import {
  computeTimelineMutationSig,
  mutationSigEquals,
} from "./mutation-signature.js";

// Note: memo-cache, action-index, and mutation-signature helpers are split
// into dedicated modules to keep this file focused on timeline orchestration.

const TICKS_PER_SEC = 60;
const MICROSTEP_DT = 1 / TICKS_PER_SEC;

// Checkpoint Strategy Constants
const CP_STRIDE_SEC = 2;
const CP_WINDOW_BACK = 900;
const CP_WINDOW_FWD = 300;
const CP_COLD_STRIDE_SEC = 120;
const CP_MAINTENANCE_CADENCE_SEC = 5;
const DEFAULT_CHECKPOINT_MAX_BYTES = 24 * 1024 * 1024;

export function isValidTimeline(tl) {
  if (!tl || typeof tl !== "object") return false;
  if (tl.baseStateData == null) return false;
  if (!Array.isArray(tl.actions)) return false;
  return true;
}

export function createEmptyTimelineFromBase(baseState) {
  const baseStateData = serializeGameState(baseState);
  const tl = {
    baseStateData,
    persistentKnowledge: clonePersistentKnowledge(baseState),
    actions: [],
    // Integer Second Cursor
    cursorSec: 0,
    // End of realized history for the current branch.
    // Projection/forecasting starts from this second.
    historyEndSec: 0,
    checkpoints: [],
    // Stage 3 perf: revision invalidates memo caches.
    // NOTE: revision bumps for *any* timeline mutation (including checkpoint
    // maintenance), so it is broader than "actions changed".
    revision: 0,
    // Derived (non-serialized): memo + mutation guard + actionsBySec are lazy-created
  };
  // Keep a hot empty index so append paths remain O(1) from boot.
  tl.actionsBySec = new Map();
  tl._actionSecondsSorted = [];
  tl._actionSecondsVersion = 0;
  tl._lastMutationChangedActionSeconds = false;
  tl._actionsBySecSig = computeActionsMutationSig(tl);
  tl._memoGuardSig = computeTimelineMutationSig(tl);
  return tl;
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

function bumpRevision(tl, opts = {}) {
  const r = ensureRevision(tl);
  tl.revision = r + 1;
  const clearMemo = opts.clearMemo !== false;
  if (clearMemo) {
    if (tl.memoStateBySec) tl.memoStateBySec.clear();
    if (tl.memoFifo) tl.memoFifo.length = 0;
    if (tl.memoBytesByKey) tl.memoBytesByKey.clear();
    tl.memoBytesTotal = 0;
  }
  if (tl._checkpointIndexCache) {
    tl._checkpointIndexCache = null;
  }
  return tl.revision;
}

function ensureCheckpointIndex(tl) {
  const rev = ensureRevision(tl);
  const cache = tl._checkpointIndexCache;
  if (
    cache &&
    cache.revision === rev &&
    cache.bySec &&
    Array.isArray(cache.secs)
  ) {
    return cache;
  }

  const bySec = new Map();
  const secs = [];
  const cps = Array.isArray(tl.checkpoints) ? tl.checkpoints : [];
  for (const cp of cps) {
    const sec = Math.floor(cp?.checkpointSec ?? -1);
    if (!Number.isFinite(sec) || sec < 0) continue;
    if (cp?.stateData == null) continue;
    if (!bySec.has(sec)) secs.push(sec);
    bySec.set(sec, cp);
  }
  if (secs.length > 1) secs.sort((a, b) => a - b);

  const next = { revision: rev, bySec, secs };
  tl._checkpointIndexCache = next;
  return next;
}

function findNearestCheckpointAtOrBefore(index, targetSec) {
  const target = Math.max(0, Math.floor(targetSec ?? 0));
  const secs = Array.isArray(index?.secs) ? index.secs : [];
  if (!secs.length) return null;

  let lo = 0;
  let hi = secs.length - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const sec = secs[mid];
    if (sec <= target) {
      best = sec;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best < 0) return null;
  return index.bySec.get(best) ?? null;
}

function findCheckpointIndexBySec(checkpoints, checkpointSec) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) return -1;
  const sec = Math.max(0, Math.floor(checkpointSec ?? 0));

  const lastIdx = checkpoints.length - 1;
  const lastSec = Math.floor(checkpoints[lastIdx]?.checkpointSec ?? -1);
  if (lastSec === sec) return lastIdx;

  let lo = 0;
  let hi = lastIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midSec = Math.floor(checkpoints[mid]?.checkpointSec ?? -1);
    if (midSec === sec) return mid;
    if (midSec < sec) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function upsertCheckpointSorted(checkpoints, cpData) {
  if (!Array.isArray(checkpoints) || !cpData) return false;
  const sec = Math.max(0, Math.floor(cpData.checkpointSec ?? 0));
  cpData.checkpointSec = sec;
  cpData.appliedThroughSec = sec;

  if (checkpoints.length === 0) {
    checkpoints.push(cpData);
    return true;
  }

  const lastIdx = checkpoints.length - 1;
  const lastSec = Math.floor(checkpoints[lastIdx]?.checkpointSec ?? -1);
  if (lastSec === sec) {
    checkpoints[lastIdx] = cpData;
    return true;
  }
  if (lastSec < sec) {
    checkpoints.push(cpData);
    return true;
  }

  let lo = 0;
  let hi = lastIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midSec = Math.floor(checkpoints[mid]?.checkpointSec ?? -1);
    if (midSec === sec) {
      checkpoints[mid] = cpData;
      return true;
    }
    if (midSec < sec) lo = mid + 1;
    else hi = mid - 1;
  }

  checkpoints.splice(lo, 0, cpData);
  return true;
}

function estimateCheckpointBytes(tl, cp) {
  if (!cp || cp.stateData == null) return DEFAULT_STATE_DATA_ESTIMATE_BYTES;
  return estimateStateDataBytes(tl, cp.stateData);
}

function checkpointMaxCountByBudget(tl, fallbackStateData) {
  const maxBytes = Number.isFinite(tl?.checkpointMaxBytes)
    ? Math.max(1024 * 1024, Math.floor(tl.checkpointMaxBytes))
    : DEFAULT_CHECKPOINT_MAX_BYTES;
  const avgBytes = Number.isFinite(tl?._checkpointAvgBytes)
    ? Math.max(1024, Math.floor(tl._checkpointAvgBytes))
    : Math.max(1024, estimateStateDataBytes(tl, fallbackStateData));
  return Math.max(16, Math.floor(maxBytes / avgBytes));
}

function trimCheckpointsToBudget(
  tl,
  checkpoints,
  {
    currentSec,
    historyEndSec,
    hotMin,
    hotMax,
    fallbackStateData,
  } = {}
) {
  if (!Array.isArray(checkpoints) || checkpoints.length <= 1) return false;

  const maxCount = checkpointMaxCountByBudget(tl, fallbackStateData);
  if (checkpoints.length <= maxCount) return false;

  const protectedSecs = new Set([
    0,
    Math.max(0, Math.floor(currentSec ?? 0)),
    Math.max(0, Math.floor(historyEndSec ?? 0)),
  ]);
  const hotStart = Math.max(0, Math.floor(hotMin ?? 0));
  const hotEnd = Math.max(0, Math.floor(hotMax ?? 0));
  const isHot = (sec) => sec >= hotStart && sec <= hotEnd;
  const isProtected = (sec) => protectedSecs.has(sec);

  let changed = false;
  while (checkpoints.length > maxCount) {
    let removeIdx = -1;

    // First choice: oldest non-protected checkpoint outside hot window.
    for (let i = 0; i < checkpoints.length; i++) {
      const sec = Math.floor(checkpoints[i]?.checkpointSec ?? -1);
      if (sec < 0) continue;
      if (isProtected(sec)) continue;
      if (!isHot(sec)) {
        removeIdx = i;
        break;
      }
    }

    // Fallback: oldest non-protected checkpoint.
    if (removeIdx < 0) {
      for (let i = 0; i < checkpoints.length; i++) {
        const sec = Math.floor(checkpoints[i]?.checkpointSec ?? -1);
        if (sec < 0) continue;
        if (isProtected(sec)) continue;
        removeIdx = i;
        break;
      }
    }

    if (removeIdx < 0) break;
    checkpoints.splice(removeIdx, 1);
    changed = true;
  }

  return changed;
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

export function absorbTimelinePersistentKnowledge(tl, sourceLike) {
  if (!tl || typeof tl !== "object") return { changed: false };
  ensurePersistentKnowledgeState(tl);
  const changed = mergePersistentKnowledge(tl, sourceLike);
  if (!changed) return { changed: false };
  // Swap reference so cache signatures can detect knowledge-only mutations.
  tl.persistentKnowledge = clonePersistentKnowledge(tl);
  tl._memoGuardSig = computeTimelineMutationSig(tl);
  return { changed: true };
}

function applyTimelinePersistentKnowledgeToState(tl, state) {
  if (!state || typeof state !== "object") return false;
  ensurePersistentKnowledgeState(state);
  if (!tl || typeof tl !== "object") return false;
  ensurePersistentKnowledgeState(tl);
  return mergePersistentKnowledge(state, tl);
}

function enrichStateDataWithTimelinePersistentKnowledge(tl, stateData) {
  if (stateData == null) return stateData;
  if (!tl || typeof tl !== "object") return stateData;
  ensurePersistentKnowledgeState(tl);
  const state = deserializeGameState(stateData);
  const changed = applyTimelinePersistentKnowledgeToState(tl, state);
  if (!changed) return stateData;
  return serializeGameState(state);
}

// -----------------------------------------------------------------------------
// Timeline Mutation (Dual-Write)
// -----------------------------------------------------------------------------

export function appendActionAtCursor(tl, action, state) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  if (!action || typeof action !== "object")
    return { ok: false, reason: "badAction" };

  const t = Math.floor(state?.tSec ?? tl.cursorSec ?? 0);
  bumpRevision(tl, { clearMemo: false });
  // Actions at tSec affect this second and all future seconds.
  pruneMemoAtOrAfter(tl, t);
  // A checkpoint anchored at tSec may now be stale (actions at tSec changed).
  // Keep only checkpoints strictly before the mutation second.
  tl.checkpoints = truncateCheckpointsAfterSecond(tl.checkpoints, t - 1);
  tl._checkpointIndexCache = null;
  tl.actions = Array.isArray(tl.actions) ? tl.actions : [];

  const entry = {
    ...action,
    tSec: t,
  };

  tl.actions.push(entry);
  tl._lastMutationKind = "appendAction";
  tl._lastMutationSec = t;
  tl._lastMutationChangedActionSeconds = false;

  // Keep actionsBySec hot for controller/planner lookups.
  if (!tl.actionsBySec || typeof tl.actionsBySec.get !== "function") {
    rebuildActionsBySecIndex(tl);
    tl._lastMutationChangedActionSeconds = true;
  } else {
    const sec = Math.max(0, Math.floor(entry.tSec ?? 0));
    let arr = tl.actionsBySec.get(sec);
    if (!arr) {
      arr = [];
      tl.actionsBySec.set(sec, arr);
      if (insertSortedSecond(tl._actionSecondsSorted, sec)) {
        markActionSecondsChanged(tl);
        tl._lastMutationChangedActionSeconds = true;
      }
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
  const replacements = Array.isArray(actionsAtSec) ? actionsAtSec : [];
  const normalized = replacements.map((action) => ({
    ...action,
    tSec: t,
  }));

  bumpRevision(tl, { clearMemo: false });
  // Replacing actions at tSec invalidates this second and all future snapshots.
  pruneMemoAtOrAfter(tl, t);
  // Same as append: checkpoints at/after tSec can no longer be trusted.
  tl.checkpoints = truncateCheckpointsAfterSecond(tl.checkpoints, t - 1);
  tl._checkpointIndexCache = null;
  const acts = Array.isArray(tl.actions) ? tl.actions : [];

  // Hot path: replacing at/after frontier while truncating future.
  // This is the dominant planner-edit path and should avoid full history scans.
  if (truncateFuture && acts.length > 0) {
    const lastSec = Math.floor(acts[acts.length - 1]?.tSec ?? 0);
    if (t >= lastSec) {
      let changedActionSeconds = false;
      if (t > lastSec) {
        if (normalized.length) {
          for (const action of normalized) acts.push(action);
          changedActionSeconds =
            insertSortedSecond(tl._actionSecondsSorted, t) ||
            changedActionSeconds;
        }
        tl.actions = acts;
      } else {
        let keepLen = acts.length;
        while (keepLen > 0) {
          const sec = Math.floor(acts[keepLen - 1]?.tSec ?? 0);
          if (sec !== t) break;
          keepLen -= 1;
        }
        if (keepLen !== acts.length) {
          acts.length = keepLen;
        }
        if (normalized.length) {
          for (const action of normalized) acts.push(action);
        }
        tl.actions = acts;
      }

      tl._lastMutationKind = "replaceActionsAtSec";
      tl._lastMutationSec = t;

      if (!tl.actionsBySec || typeof tl.actionsBySec.get !== "function") {
        rebuildActionsBySecIndex(tl);
        changedActionSeconds = true;
      } else {
        if (t > lastSec) {
          if (normalized.length) {
            tl.actionsBySec.set(t, normalized);
          }
        } else {
          if (normalized.length) {
            tl.actionsBySec.set(t, normalized);
            changedActionSeconds =
              insertSortedSecond(tl._actionSecondsSorted, t) ||
              changedActionSeconds;
          } else {
            tl.actionsBySec.delete(t);
            changedActionSeconds =
              removeSortedSecond(tl._actionSecondsSorted, t) ||
              changedActionSeconds;
          }
        }
        if (changedActionSeconds) {
          markActionSecondsChanged(tl);
        }
        tl._actionsBySecSig = computeActionsMutationSig(tl);
      }
      tl._lastMutationChangedActionSeconds = changedActionSeconds;
      tl._memoGuardSig = computeTimelineMutationSig(tl);
      return { ok: true };
    }
  }

  const before = [];
  const after = [];
  for (const action of acts) {
    const sec = Math.floor(action.tSec ?? 0);
    if (sec < t) before.push(action);
    else if (sec > t) after.push(action);
  }

  tl.actions = truncateFuture
    ? [...before, ...normalized]
    : [...before, ...normalized, ...after];

  tl._lastMutationKind = "replaceActionsAtSec";
  tl._lastMutationSec = t;
  tl._lastMutationChangedActionSeconds = true;

  rebuildActionsBySecIndex(tl);
  tl._memoGuardSig = computeTimelineMutationSig(tl);

  return { ok: true };
}

// -----------------------------------------------------------------------------
// Checkpoint Management
// -----------------------------------------------------------------------------

export function maintainCheckpoints(tl, state, opts = {}) {
  if (!tl || !state) return;
  const writeMemo = opts.writeMemo !== false;
  const captureCheckpoint = opts.captureCheckpoint !== false;
  const allowPrune = opts.prune !== false;

  const perfStart = perfEnabled() ? perfNowMs() : 0;

  const currentSec = Math.floor(state.tSec ?? 0);
  let currentStateData = null;
  const ensureCurrentStateData = () => {
    if (currentStateData == null) {
      currentStateData = serializeGameState(state);
    }
    return currentStateData;
  };

  absorbTimelinePersistentKnowledge(tl, state);

  // Keep a hot, revision-keyed snapshot for direct scrub reads.
  if (writeMemo) {
    memoPutStateData(tl, currentSec, ensureCurrentStateData());
  }

  tl.cursorSec = currentSec;
  // Cursor is the current playback/inspection point; historyEndSec is the
  // farthest realized second on this branch (future is truncated on edits).
  tl.historyEndSec = Math.max(tl.historyEndSec ?? 0, currentSec);

  const isStride =
    captureCheckpoint &&
    currentSec > 0 &&
    currentSec % CP_STRIDE_SEC === 0;

  let checkpointsChanged = false;

  tl.checkpoints = Array.isArray(tl.checkpoints) ? tl.checkpoints : [];
  const existingIndex = captureCheckpoint
    ? findCheckpointIndexBySec(tl.checkpoints, currentSec)
    : -1;

  if (captureCheckpoint && (isStride || existingIndex >= 0)) {
    const cpData = {
      checkpointSec: currentSec,
      appliedThroughSec: currentSec,
      stateData: ensureCurrentStateData(),
    };
    const cpBytes = estimateCheckpointBytes(tl, cpData);
    tl._checkpointAvgBytes = Number.isFinite(tl._checkpointAvgBytes)
      ? Math.floor(tl._checkpointAvgBytes * 0.8 + cpBytes * 0.2)
      : cpBytes;

    checkpointsChanged = upsertCheckpointSorted(tl.checkpoints, cpData) || checkpointsChanged;
  }

  const shouldPruneNow =
    allowPrune &&
    (checkpointsChanged || currentSec % CP_MAINTENANCE_CADENCE_SEC === 0);
  if (shouldPruneNow) {
    const beforeLen = tl.checkpoints.length;
    const hotMin = currentSec - CP_WINDOW_BACK;
    const hotMax = currentSec + CP_WINDOW_FWD;
    const historyEndSec = Math.floor(tl.historyEndSec ?? currentSec);

    tl.checkpoints = tl.checkpoints.filter((cp) => {
      const s = Math.floor(cp?.checkpointSec ?? -1);
      if (s < 0) return false;
      if (s === 0) return true;
      if (s === currentSec) return true;
      if (s === historyEndSec) return true;
      if (s >= hotMin && s <= hotMax) return true;
      if (s % CP_COLD_STRIDE_SEC === 0) return true;
      return false;
    });

    const budgetTrimmed = trimCheckpointsToBudget(tl, tl.checkpoints, {
      currentSec,
      historyEndSec,
      hotMin,
      hotMax,
      fallbackStateData: currentStateData,
    });

    if (tl.checkpoints.length !== beforeLen || budgetTrimmed) checkpointsChanged = true;
  }

  if (checkpointsChanged) {
    // Checkpoint churn should not invalidate memoized history snapshots.
    tl._checkpointIndexCache = null;
    tl._memoGuardSig = computeTimelineMutationSig(tl);
  }

  if (perfEnabled()) {
    recordCheckpointMaintenance(perfNowMs() - perfStart);
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

  const perfStart = perfEnabled() ? perfNowMs() : 0;

  // Invalidate memo if timeline mutated out-of-band, and keep actionsBySec index fresh.
  ensureRevisionFreshAgainstOutOfBandMutations(tl);

  const target = Math.floor(targetSec);

  // Memo fast-path
  const memoStateData = memoGetStateData(tl, target);
  if (memoStateData != null) {
    const state = deserializeGameState(memoStateData);
    canonicalizeSnapshot(state);
    const merged = applyTimelinePersistentKnowledgeToState(tl, state);
    if (merged) {
      memoPutStateData(tl, target, serializeGameState(state));
    }
    if (perfEnabled()) {
      recordTimelineRebuild({
        ms: perfNowMs() - perfStart,
        memoHit: true,
      });
    }
    return { ok: true, state, memoHit: true };
  }

  // 1) Find nearest checkpoint <= target
  const checkpointIndex = ensureCheckpointIndex(tl);
  const checkpointCp = findNearestCheckpointAtOrBefore(checkpointIndex, target);
  const memoCp = findNearestMemoStateDataAtOrBefore(tl, target);
  const bestCp =
    memoCp && (checkpointCp == null || memoCp.checkpointSec >= checkpointCp.checkpointSec)
      ? memoCp
      : checkpointCp;

  const startSec = bestCp ? bestCp.checkpointSec ?? 0 : 0;
  const startStateData = bestCp ? bestCp.stateData : tl.baseStateData;
  const skipActionsAtStartSec =
    bestCp &&
    (bestCp === memoCp ||
      (Number.isFinite(bestCp.appliedThroughSec) &&
        bestCp.appliedThroughSec >= startSec));

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

  applyTimelinePersistentKnowledgeToState(tl, state);
  memoPutStateData(tl, target, serializeGameState(state));
  tl._memoGuardSig = computeTimelineMutationSig(tl);

  // Keep actionsBySec fresh in case callers rely on it post-rebuild.
  ensureActionsBySecFresh(tl);

  if (perfEnabled()) {
    recordTimelineRebuild({
      ms: perfNowMs() - perfStart,
      memoHit: false,
    });
  }
  return { ok: true, state, memoHit: false };
}

// -----------------------------------------------------------------------------
// StateData Snapshot Service (timeline-owned)
// -----------------------------------------------------------------------------

export function seedMemoStateDataAtSecond(tl, targetSec, stateData) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  if (!Number.isFinite(targetSec) || targetSec < 0) {
    return { ok: false, reason: "badTargetSec" };
  }
  if (stateData == null) return { ok: false, reason: "badStateData" };

  // Keep revision/mutation guards consistent before memo writes.
  ensureRevisionFreshAgainstOutOfBandMutations(tl);

  const target = Math.floor(targetSec);
  const enrichedStateData = enrichStateDataWithTimelinePersistentKnowledge(
    tl,
    stateData
  );
  memoPutStateData(tl, target, enrichedStateData);
  return { ok: true };
}

export function seedCheckpointStateDataAtSecond(
  tl,
  targetSec,
  stateData,
  opts = {}
) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  if (!Number.isFinite(targetSec) || targetSec < 0) {
    return { ok: false, reason: "badTargetSec" };
  }
  if (stateData == null) return { ok: false, reason: "badStateData" };

  ensureRevisionFreshAgainstOutOfBandMutations(tl);

  const sec = Math.max(0, Math.floor(targetSec));
  tl.checkpoints = Array.isArray(tl.checkpoints) ? tl.checkpoints : [];

  const enrichedStateData = enrichStateDataWithTimelinePersistentKnowledge(
    tl,
    stateData
  );

  const cpData = {
    checkpointSec: sec,
    appliedThroughSec: sec,
    stateData: enrichedStateData,
  };
  const cpBytes = estimateCheckpointBytes(tl, cpData);
  tl._checkpointAvgBytes = Number.isFinite(tl._checkpointAvgBytes)
    ? Math.floor(tl._checkpointAvgBytes * 0.8 + cpBytes * 0.2)
    : cpBytes;

  let changed = upsertCheckpointSorted(tl.checkpoints, cpData);

  const shouldPrune = opts.prune !== false;
  if (shouldPrune) {
    const beforeLen = tl.checkpoints.length;
    const historyEndSec = Math.max(
      Math.floor(tl.historyEndSec ?? 0),
      sec
    );
    const hotMin = sec - CP_WINDOW_BACK;
    const hotMax = sec + CP_WINDOW_FWD;

    tl.checkpoints = tl.checkpoints.filter((cp) => {
      const s = Math.floor(cp?.checkpointSec ?? -1);
      if (s < 0) return false;
      if (s === 0) return true;
      if (s === sec) return true;
      if (s === historyEndSec) return true;
      if (s >= hotMin && s <= hotMax) return true;
      if (s % CP_COLD_STRIDE_SEC === 0) return true;
      return false;
    });

    const budgetTrimmed = trimCheckpointsToBudget(tl, tl.checkpoints, {
      currentSec: sec,
      historyEndSec,
      hotMin,
      hotMax,
      fallbackStateData: enrichedStateData,
    });
    if (tl.checkpoints.length !== beforeLen || budgetTrimmed) changed = true;
  }

  if (changed) {
    // Checkpoint churn does not invalidate action/memo mutation signatures.
    tl._checkpointIndexCache = null;
    tl._memoGuardSig = computeTimelineMutationSig(tl);
  }

  return { ok: true, changed };
}

export function getStateDataAtSecond(tl, targetSec) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  if (!Number.isFinite(targetSec) || targetSec < 0) {
    return { ok: false, reason: "badTargetSec" };
  }

  // Invalidate memo if timeline mutated out-of-band, and keep actionsBySec index fresh.
  ensureRevisionFreshAgainstOutOfBandMutations(tl);

  const target = Math.floor(targetSec);
  const actionsAtTarget =
    tl.actionsBySec && typeof tl.actionsBySec.get === "function"
      ? tl.actionsBySec.get(target)
      : null;
  const hasActionsAtTarget =
    Array.isArray(actionsAtTarget) && actionsAtTarget.length > 0;

  // Exact checkpoint fast-path.
  const checkpointIndex = ensureCheckpointIndex(tl);
  const exact = checkpointIndex.bySec.get(target);
  // Safety: if there are actions at targetSec, an exact checkpoint at the
  // same second might predate those actions and return stale state.
  if (exact?.stateData != null && !hasActionsAtTarget) {
    const enrichedStateData = enrichStateDataWithTimelinePersistentKnowledge(
      tl,
      exact.stateData
    );
    memoPutStateData(tl, target, enrichedStateData);
    return { ok: true, stateData: enrichedStateData, source: "checkpoint" };
  }

  // Memo fast-path.
  const memoStateData = memoGetStateData(tl, target);
  if (memoStateData != null) {
    const enrichedStateData = enrichStateDataWithTimelinePersistentKnowledge(
      tl,
      memoStateData
    );
    if (enrichedStateData !== memoStateData) {
      memoPutStateData(tl, target, enrichedStateData);
    }
    return { ok: true, stateData: enrichedStateData, source: "memo" };
  }

  // Rebuild path (writes memo).
  const rebuilt = rebuildStateAtSecond(tl, target);
  if (!rebuilt.ok) return rebuilt;

  const fromMemo = memoGetStateData(tl, target);
  if (fromMemo != null) {
    return { ok: true, stateData: fromMemo, source: "rebuild" };
  }

  const stateData = serializeGameState(rebuilt.state);
  memoPutStateData(tl, target, stateData);
  return { ok: true, stateData, source: "rebuild" };
}

// -----------------------------------------------------------------------------
// Action seconds range query (cached per action-second-set version)
// -----------------------------------------------------------------------------

export function getActionSecondsInRange(tl, startSec, endSec, opts = {}) {
  if (!isValidTimeline(tl)) return [];
  const start = Math.max(0, Math.floor(startSec ?? 0));
  const end = Math.max(0, Math.floor(endSec ?? 0));
  if (end < start) return [];
  const copy = opts?.copy !== false;

  // Ensure actionsBySec is fresh and revision cache is valid.
  ensureRevisionFreshAgainstOutOfBandMutations(tl);

  const cache = ensureActionSecondsRangeCache(tl);
  const cacheMap = cache.map;
  const key = `${start}:${end}`;
  const cached = cacheMap.get(key);
  if (cached) return copy ? cached.slice() : cached;

  const actionsBySec = tl.actionsBySec;
  if (!actionsBySec || typeof actionsBySec.keys !== "function") {
    putActionSecondsRangeCache(cache, key, []);
    return [];
  }

  const allSecs = ensureActionSecondsIndex(tl);
  if (!allSecs.length) {
    putActionSecondsRangeCache(cache, key, []);
    return [];
  }

  const startIdx = lowerBoundSorted(allSecs, start);
  const endIdxExcl = upperBoundSorted(allSecs, end);
  const secs =
    startIdx < endIdxExcl
      ? allSecs.slice(startIdx, endIdxExcl)
      : [];

  putActionSecondsRangeCache(cache, key, secs);
  return copy ? secs.slice() : secs;
}

export function getActionSecondsInRangeSampled(
  tl,
  startSec,
  endSec,
  maxCount,
  opts = {}
) {
  if (!isValidTimeline(tl)) return [];
  const start = Math.max(0, Math.floor(startSec ?? 0));
  const end = Math.max(0, Math.floor(endSec ?? 0));
  const cap = Math.max(0, Math.floor(maxCount ?? 0));
  if (end < start || cap <= 0) return [];
  const copy = opts?.copy !== false;

  ensureRevisionFreshAgainstOutOfBandMutations(tl);

  const allSecs = ensureActionSecondsIndex(tl);
  if (!allSecs.length) return [];

  const startIdx = lowerBoundSorted(allSecs, start);
  const endIdxExcl = upperBoundSorted(allSecs, end);
  const count = endIdxExcl - startIdx;
  if (count <= 0) return [];

  if (count <= cap) {
    const full = allSecs.slice(startIdx, endIdxExcl);
    return copy ? full.slice() : full;
  }

  // Stable, time-bucketed sampling. This avoids index-based reshuffling where
  // appending one action can move most sampled indices in long histories.
  const sampled = [];
  const span = Math.max(1, end - start + 1);
  const bucketSpan = Math.max(1, Math.ceil(span / cap));
  let lastAdded = null;
  for (
    let bucketStart = start;
    bucketStart <= end && sampled.length < cap;
    bucketStart += bucketSpan
  ) {
    const bucketEnd = Math.min(end, bucketStart + bucketSpan - 1);
    const bucketTailIdx = upperBoundSorted(allSecs, bucketEnd) - 1;
    if (bucketTailIdx < startIdx) continue;
    const sec = allSecs[bucketTailIdx];
    if (sec < bucketStart || sec > bucketEnd) continue;
    if (sec === lastAdded) continue;
    sampled.push(sec);
    lastAdded = sec;
  }

  const head = allSecs[startIdx];
  if (sampled[0] !== head) {
    sampled.unshift(head);
  }
  const tail = allSecs[endIdxExcl - 1];
  if (sampled[sampled.length - 1] !== tail) {
    sampled.push(tail);
  }

  if (sampled.length > cap) {
    const trimmed = [];
    const denom = Math.max(1, cap - 1);
    for (let i = 0; i < cap; i++) {
      const idx = Math.floor((i * (sampled.length - 1)) / denom);
      const sec = sampled[idx];
      if (trimmed[trimmed.length - 1] === sec) continue;
      trimmed.push(sec);
    }
    const lastTrimmed = trimmed[trimmed.length - 1];
    if (lastTrimmed !== tail) trimmed.push(tail);
    return copy ? trimmed.slice() : trimmed;
  }

  return copy ? sampled.slice() : sampled;
}

export function getActionSecondsVersion(tl) {
  if (!isValidTimeline(tl)) return 0;
  ensureRevisionFreshAgainstOutOfBandMutations(tl);
  return ensureActionSecondsVersion(tl);
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

  bumpRevision(tl, { clearMemo: false });
  // Truncation removes only future history; keep memo at/before tSec.
  pruneMemoAtOrAfter(tl, t + 1);

  tl.actions = truncateActionsAfterSecond(tl.actions, t);
  tl.checkpoints = truncateCheckpointsAfterSecond(tl.checkpoints, t);

  tl._lastMutationKind = "truncateTimelineAfterSec";
  tl._lastMutationSec = t;
  tl._lastMutationChangedActionSeconds = true;

  tl.historyEndSec = Math.min(Math.floor(tl.historyEndSec ?? 0), t);
  tl.cursorSec = Math.min(Math.floor(tl.cursorSec ?? 0), t);

  tl._memoGuardSig = computeTimelineMutationSig(tl);

  // Rebuild index after truncation
  rebuildActionsBySecIndex(tl);

  return { ok: true };
}

