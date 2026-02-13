// src/model/timeline.js
// serializable action timeline + deterministic rebuild/replay
// scrub memo cache (second-keyed) + defensive invalidation guard
// persistent actionsBySec indexing (derived, non-serialized)

import { deserializeGameState, serializeGameState } from "./state.js";
import { canonicalizeSnapshot } from "./canonicalize.js";
import { applyAction } from "./actions.js";
import { updateGame } from "./game-model.js";
import {
  perfEnabled,
  perfNowMs,
  recordTimelineRebuild,
  recordCheckpointMaintenance,
} from "./perf.js";

const TICKS_PER_SEC = 60;
const MICROSTEP_DT = 1 / TICKS_PER_SEC;

// Checkpoint Strategy Constants
const CP_STRIDE_SEC = 2;
const CP_WINDOW_BACK = 900;
const CP_WINDOW_FWD = 300;
const CP_COLD_STRIDE_SEC = 120;
const CP_MAINTENANCE_CADENCE_SEC = 5;
const DEFAULT_CHECKPOINT_MAX_BYTES = 24 * 1024 * 1024;
const ACTION_SECONDS_RANGE_CACHE_MAX = 256;

// Memo cache defaults (non-serialized derived fields stored on timeline object)
const DEFAULT_MEMO_MAX_BYTES = 24 * 1024 * 1024;
const DEFAULT_STATE_DATA_ESTIMATE_BYTES = 32 * 1024;

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

function ensureMemo(tl) {
  if (!tl.memoStateBySec) tl.memoStateBySec = new Map();
  if (!tl.memoFifo) tl.memoFifo = [];
  if (!tl.memoBytesByKey) tl.memoBytesByKey = new Map();
  if (!Number.isFinite(tl.memoBytesTotal) || tl.memoBytesTotal < 0) {
    tl.memoBytesTotal = 0;
  }
  if (!Number.isFinite(tl.memoMaxBytes) || tl.memoMaxBytes <= 0) {
    tl.memoMaxBytes = DEFAULT_MEMO_MAX_BYTES;
  } else {
    tl.memoMaxBytes = Math.floor(tl.memoMaxBytes);
  }
}

function memoKey(_tl, sec) {
  return Math.max(0, Math.floor(sec));
}

function memoGetStateData(tl, sec) {
  if (!tl.memoStateBySec) return null;
  return tl.memoStateBySec.get(memoKey(tl, sec)) ?? null;
}

function findNearestMemoStateDataAtOrBefore(tl, targetSec) {
  if (!tl?.memoStateBySec || tl.memoStateBySec.size === 0) return null;
  const target = Math.max(0, Math.floor(targetSec ?? 0));
  let bestSec = -1;
  let bestStateData = null;

  for (const [key, stateData] of tl.memoStateBySec.entries()) {
    const normalizedSec = Math.max(0, Math.floor(key ?? -1));
    if (!Number.isFinite(normalizedSec)) continue;
    if (normalizedSec > target) continue;
    if (normalizedSec < bestSec) continue;
    bestSec = normalizedSec;
    bestStateData = stateData;
  }

  if (bestSec < 0 || bestStateData == null) return null;
  return { checkpointSec: bestSec, stateData: bestStateData };
}

function pruneMemoAtOrAfter(tl, startSec) {
  if (!tl?.memoStateBySec || tl.memoStateBySec.size === 0) return;
  const cutoff = Math.max(0, Math.floor(startSec ?? 0));

  for (const key of tl.memoStateBySec.keys()) {
    const sec = Math.max(0, Math.floor(key ?? -1));
    if (!Number.isFinite(sec) || sec < cutoff) continue;
    const removedBytes = tl.memoBytesByKey?.get?.(key) ?? 0;
    tl.memoStateBySec.delete(key);
    tl.memoBytesByKey?.delete?.(key);
    tl.memoBytesTotal = Math.max(0, (tl.memoBytesTotal ?? 0) - removedBytes);
  }

  if (Array.isArray(tl.memoFifo)) {
    tl.memoFifo = tl.memoFifo.filter((key) => {
      const sec = Math.max(0, Math.floor(key ?? -1));
      return Number.isFinite(sec) && sec < cutoff;
    });
  }
}

function estimateStateDataBytes(tl, stateData) {
  if (!tl || stateData == null) return DEFAULT_STATE_DATA_ESTIMATE_BYTES;

  const samplesTaken = Math.floor(tl._stateDataSizeSamples ?? 0);
  const shouldSample = samplesTaken < 8 || samplesTaken % 8 === 0;

  const avg = Number.isFinite(tl._stateDataAvgBytes)
    ? Math.max(512, Math.floor(tl._stateDataAvgBytes))
    : DEFAULT_STATE_DATA_ESTIMATE_BYTES;

  if (!shouldSample) {
    tl._stateDataSizeSamples = samplesTaken + 1;
    return avg;
  }

  let bytes = avg;
  try {
    bytes = Math.max(512, JSON.stringify(stateData).length);
  } catch (_) {
    bytes = avg;
  }

  tl._stateDataSizeSamples = samplesTaken + 1;
  tl._stateDataAvgBytes = Number.isFinite(tl._stateDataAvgBytes)
    ? Math.floor(tl._stateDataAvgBytes * 0.75 + bytes * 0.25)
    : bytes;

  return bytes;
}

function memoPutStateData(tl, sec, stateData) {
  ensureMemo(tl);
  const key = memoKey(tl, sec);
  const bytes = estimateStateDataBytes(tl, stateData);
  const existingBytes = tl.memoBytesByKey.get(key) ?? 0;

  if (!tl.memoStateBySec.has(key)) {
    tl.memoFifo.push(key);
  }
  tl.memoStateBySec.set(key, stateData);
  tl.memoBytesByKey.set(key, bytes);
  tl.memoBytesTotal += bytes - existingBytes;

  const maxBytes = tl.memoMaxBytes ?? DEFAULT_MEMO_MAX_BYTES;
  while (tl.memoBytesTotal > maxBytes && tl.memoFifo.length > 0) {
    const oldest = tl.memoFifo.shift();
    if (oldest == null) continue;
    const removedBytes = tl.memoBytesByKey.get(oldest) ?? 0;
    tl.memoStateBySec.delete(oldest);
    tl.memoBytesByKey.delete(oldest);
    tl.memoBytesTotal = Math.max(0, tl.memoBytesTotal - removedBytes);
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
  const bySec = indexActionsBySecond(tl.actions);
  tl.actionsBySec = bySec;
  tl._actionSecondsSorted = Array.from(bySec.keys())
    .map((secRaw) => Math.max(0, Math.floor(secRaw)))
    .sort((a, b) => a - b);
  markActionSecondsChanged(tl);
  tl._actionsBySecSig = computeActionsMutationSig(tl);
}

function ensureActionsBySecFresh(tl) {
  const cur = computeActionsMutationSig(tl);
  if (!actionsSigEquals(cur, tl._actionsBySecSig) || !tl.actionsBySec) {
    rebuildActionsBySecIndex(tl);
  }
}

function ensureActionSecondsRangeCache(tl) {
  const actionSecondsVersion = ensureActionSecondsVersion(tl);
  const cache = tl._actionSecondsRangeCache;
  if (
    !cache ||
    cache.actionSecondsVersion !== actionSecondsVersion ||
    !cache.map ||
    !Number.isFinite(cache.max)
  ) {
    tl._actionSecondsRangeCache = {
      actionSecondsVersion,
      map: new Map(),
      max: ACTION_SECONDS_RANGE_CACHE_MAX,
    };
  }
  return tl._actionSecondsRangeCache;
}

function ensureActionSecondsVersion(tl) {
  if (!Number.isFinite(tl?._actionSecondsVersion)) {
    tl._actionSecondsVersion = 0;
  }
  tl._actionSecondsVersion = Math.max(0, Math.floor(tl._actionSecondsVersion));
  return tl._actionSecondsVersion;
}

function markActionSecondsChanged(tl) {
  tl._actionSecondsVersion = ensureActionSecondsVersion(tl) + 1;
  if (tl._actionSecondsRangeCache) {
    tl._actionSecondsRangeCache = null;
  }
  if (tl._actionSecondsIndexCache) {
    tl._actionSecondsIndexCache = null;
  }
  return tl._actionSecondsVersion;
}

function ensureActionSecondsIndex(tl) {
  const sorted = tl._actionSecondsSorted;
  if (Array.isArray(sorted)) {
    return sorted;
  }
  const secs = Array.from(tl.actionsBySec?.keys?.() ?? [])
    .map((secRaw) => Math.max(0, Math.floor(secRaw)))
    .sort((a, b) => a - b);
  tl._actionSecondsSorted = secs;
  return secs;
}

function lowerBoundSorted(list, target) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundSorted(list, target) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function putActionSecondsRangeCache(cache, key, secs) {
  if (!cache || !cache.map || key == null) return;
  cache.map.delete(key);
  cache.map.set(key, secs);
  while (cache.map.size > cache.max) {
    const oldest = cache.map.keys().next().value;
    if (oldest == null) break;
    cache.map.delete(oldest);
  }
}

function insertSortedSecond(list, sec) {
  if (!Array.isArray(list)) return false;
  const s = Math.max(0, Math.floor(sec ?? 0));
  const idx = lowerBoundSorted(list, s);
  if (list[idx] === s) return false;
  list.splice(idx, 0, s);
  return true;
}

function removeSortedSecond(list, sec) {
  if (!Array.isArray(list)) return false;
  const s = Math.max(0, Math.floor(sec ?? 0));
  const idx = lowerBoundSorted(list, s);
  if (list[idx] !== s) return false;
  list.splice(idx, 1);
  return true;
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

// -----------------------------------------------------------------------------
// Defensive invalidation guard (Stage 3 exit requirement)
// -----------------------------------------------------------------------------

function computeTimelineMutationSig(tl) {
  const acts = Array.isArray(tl.actions) ? tl.actions : [];

  const aLen = acts.length;

  const aLast = aLen ? acts[aLen - 1] : null;

  const baseRef = tl.baseStateData;
  const aRef = tl.actions;

  const aLastRef = aLast;

  const aLastSec = aLast ? Math.floor(aLast.tSec ?? 0) : 0;

  return {
    baseRef,
    aRef,
    aLen,
    aLastRef,
    aLastSec,
  };
}

function mutationSigEquals(a, b) {
  if (!a || !b) return false;
  return (
    a.baseRef === b.baseRef &&
    a.aRef === b.aRef &&
    a.aLen === b.aLen &&
    a.aLastRef === b.aLastRef &&
    a.aLastSec === b.aLastSec
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

  const t = Math.floor(state?.tSec ?? tl.cursorSec ?? 0);
  bumpRevision(tl, { clearMemo: false });
  // Actions at tSec affect this second and all future seconds.
  pruneMemoAtOrAfter(tl, t);
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
  memoPutStateData(tl, target, stateData);
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

  const cpData = {
    checkpointSec: sec,
    appliedThroughSec: sec,
    stateData,
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
      fallbackStateData: stateData,
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

  // Exact checkpoint fast-path.
  const checkpointIndex = ensureCheckpointIndex(tl);
  const exact = checkpointIndex.bySec.get(target);
  if (exact?.stateData != null) {
    memoPutStateData(tl, target, exact.stateData);
    return { ok: true, stateData: exact.stateData, source: "checkpoint" };
  }

  // Memo fast-path.
  const memoStateData = memoGetStateData(tl, target);
  if (memoStateData != null) {
    return { ok: true, stateData: memoStateData, source: "memo" };
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

