// src/model/projection.js
// Time-based gold history + cursor-anchored windowed forecast projection.
//
// Projection must never mutate authoritative/cursor state.

import { serializeGameState, deserializeGameState } from "./state.js";
import { rebuildStateAtSecond, isValidTimeline } from "./timeline.js";
import { canonicalizeSnapshot } from "./canonicalize.js";
import { updateGame } from "./game-model.js";
import { applyAction } from "./actions.js";

const TICKS_PER_SEC = 60;
const DEFAULT_DT_STEP = 1 / TICKS_PER_SEC;

function clampSec(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

function cloneState(state) {
  // serializeGameState strips derived fields; deserializeGameState rebuilds them.
  return deserializeGameState(serializeGameState(state));
}

function checkpointMapBySecFromTimeline(tl) {
  const m = new Map();
  const cps = Array.isArray(tl?.checkpoints) ? tl.checkpoints : [];
  for (const cp of cps) {
    const s = clampSec(cp?.checkpointSec ?? -1);
    if (cp?.stateData == null) continue;
    m.set(s, cp.stateData);
  }
  return m;
}

function actionsBySecFromTimeline(tl) {
  // key = floor(action.tSec)
  // value = action[] preserving original order
  const map = new Map();
  const acts = Array.isArray(tl?.actions) ? tl.actions : [];
  for (const a of acts) {
    const s = clampSec(a?.tSec ?? 0);
    let arr = map.get(s);
    if (!arr) {
      arr = [];
      map.set(s, arr);
    }
    arr.push(a);
  }
  return map;
}

function findNearestCheckpointSec(cpMap, atOrBeforeSec) {
  const target = clampSec(atOrBeforeSec);
  let best = -1;
  for (const s of cpMap.keys()) {
    if (s <= target && s > best) best = s;
  }
  return best >= 0 ? best : 0;
}

// Legacy export name kept for compatibility, but boundaryIndex is treated as tSec.
export function getStateAtBoundary(tl, boundaryIndex) {
  return getStateAtSecond(tl, boundaryIndex);
}

export function getStateAtSecond(tl, tSec) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  const s = clampSec(tSec);

  // Fast path if there's an exact checkpoint at s.
  const cpMap = checkpointMapBySecFromTimeline(tl);
  const sd = cpMap.get(s);
  if (sd != null) {
    const st = deserializeGameState(sd);
    canonicalizeSnapshot(st);
    return { ok: true, state: st };
  }

  return rebuildStateAtSecond(tl, s);
}

// -----------------------------------------------------------------------------
// Projection simulation (PURE): returns a NEW state, never mutates the input.
// -----------------------------------------------------------------------------

function simulateForwardSecondsPure(startState, seconds, dtStep) {
  const dt =
    typeof dtStep === "number" && dtStep > 0 ? dtStep : DEFAULT_DT_STEP;

  const totalSec = Math.max(0, clampSec(seconds));
  const state = cloneState(startState);

  canonicalizeSnapshot(state);

  // Default semantics: fixed-step 60 ticks per second when dt=1/60.
  // If dt differs, we approximate by stepping floor(totalSec/dt).
  const steps =
    dt === DEFAULT_DT_STEP
      ? totalSec * TICKS_PER_SEC
      : Math.max(0, Math.floor(totalSec / dt));

  for (let i = 0; i < steps; i++) {
    updateGame(dt, state);
  }

  return { ok: true, state };
}

// Optional mode: simulate until the next season event (season index changes).
// If paused, projection cannot advance time, so return a clean failure.
function simulateUntilNextSeasonEventPure(
  startState,
  dtStep,
  stepCapSec = 600
) {
  const dt =
    typeof dtStep === "number" && dtStep > 0 ? dtStep : DEFAULT_DT_STEP;

  const state = cloneState(startState);
  canonicalizeSnapshot(state);

  if (state.paused) return { ok: false, reason: "paused" };

  const startSeason = state.currentSeasonIndex ?? 0;
  const maxSteps =
    dt === DEFAULT_DT_STEP
      ? Math.max(1, Math.floor(stepCapSec) * TICKS_PER_SEC)
      : Math.max(1, Math.floor(stepCapSec / dt));

  for (let i = 0; i < maxSteps; i++) {
    updateGame(dt, state);
    if ((state.currentSeasonIndex ?? 0) !== startSeason) {
      canonicalizeSnapshot(state);
      return { ok: true, state };
    }
  }

  return { ok: false, reason: "seasonEventSimExceededStepCap" };
}

// -----------------------------------------------------------------------------
// Gold graph cache builders
// -----------------------------------------------------------------------------

export function buildGoldGraphHistoryCacheFromTimeline(tl, opts = null) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const maxReachedSec = clampSec(tl.maxReachedSec ?? 0);

  const historyStrideSec =
    typeof opts?.historyStrideSec === "number" && opts.historyStrideSec > 0
      ? Math.floor(opts.historyStrideSec)
      : 1;

  const stateDataByBoundary = new Map();
  const history = [];

  // Stage 1: linear forward-pass from a checkpoint
  const actionsBySec = actionsBySecFromTimeline(tl);
  const cpMap = checkpointMapBySecFromTimeline(tl);

  const startSec = 0;
  const startCheckpointSec = findNearestCheckpointSec(cpMap, startSec);

  const startStateData = cpMap.get(startCheckpointSec) ?? tl.baseStateData;
  if (startStateData == null) return { ok: false, reason: "noBaseStateData" };

  const workingState = deserializeGameState(startStateData);

  // Ensure clock alignment with checkpoint second (replay invariant)
  workingState.tSec = startCheckpointSec;
  workingState.simStepIndex = startCheckpointSec * TICKS_PER_SEC;

  for (let sec = startCheckpointSec; sec <= maxReachedSec; sec++) {
    // Apply actions scheduled at this second (timeline order preserved)
    const acts = actionsBySec.get(sec);
    if (acts && acts.length) {
      for (const a of acts) {
        const res = applyAction(workingState, a, { isReplay: true });
        if (res && res.ok === false) {
          console.warn(`History replay action failed at t=${sec}`, res, a);
          return { ok: false, reason: "actionFailed", detail: res };
        }
      }
    }

    // Sample/serialize only on stride seconds
    if (sec % historyStrideSec === 0) {
      canonicalizeSnapshot(workingState, sec);

      const gold = workingState.resources?.gold ?? workingState.gold ?? 0;

      history.push({ tSec: sec, boundaryIndex: sec, gold });
      stateDataByBoundary.set(sec, serializeGameState(workingState));
    }

    // Advance exactly 1 second (60 microsteps), unless at frontier
    if (sec < maxReachedSec) {
      for (let i = 0; i < TICKS_PER_SEC; i++) {
        updateGame(DEFAULT_DT_STEP, workingState);
      }
    }
  }

  return {
    ok: true,
    history,
    maxReachedBoundaryIndex: maxReachedSec, // legacy alias
    maxReachedSec,
    stateDataByBoundary,
  };
}

export function buildGoldGraphWindowFromTimeline(tl, baseBoundary, opts = null) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const dtStep =
    typeof opts?.dtStep === "number" && opts.dtStep > 0
      ? opts.dtStep
      : DEFAULT_DT_STEP;

  const horizonSec =
    typeof opts?.horizonSec === "number" && opts.horizonSec >= 0
      ? Math.floor(opts.horizonSec)
      : 120;

  const stepSec =
    typeof opts?.stepSec === "number" && opts.stepSec > 0
      ? Math.floor(opts.stepSec)
      : 1;

  const mode = opts?.mode === "seasonEvent" ? "seasonEvent" : "timeWindow";

  const baseSec = clampSec(
    typeof opts?.baseSec === "number" ? opts.baseSec : baseBoundary
  );

  const baseRes = getStateAtSecond(tl, baseSec);
  if (!baseRes.ok)
    return { ok: false, reason: baseRes.reason || "baseStateFailed" };

  let s = cloneState(baseRes.state);
  canonicalizeSnapshot(s);

  const stateDataByBoundary = new Map();
  const forecast = [];

  // Stage 2 guarantee:
  // stateDataByBoundary stores ONLY baseSec + each plotted forecast point.
  // It does NOT store intermediate simulation-only seconds when stepSec > 1.
  stateDataByBoundary.set(baseSec, serializeGameState(s));
  forecast.push({
    tSec: baseSec,
    boundaryIndex: baseSec,
    gold: s.resources?.gold ?? s.gold ?? 0,
  });

  let curSec = baseSec;
  const steps = Math.floor(horizonSec / stepSec);

  for (let i = 1; i <= steps; i++) {
    let sim;
    if (mode === "seasonEvent") {
      sim = simulateUntilNextSeasonEventPure(
        s,
        dtStep,
        Math.max(1, horizonSec)
      );
      curSec = baseSec + i * stepSec;
    } else {
      sim = simulateForwardSecondsPure(s, stepSec, dtStep);
      curSec = baseSec + i * stepSec;
    }

    if (!sim.ok) break;
    s = sim.state;

    canonicalizeSnapshot(s);

    // Only serialize the plotted point
    stateDataByBoundary.set(curSec, serializeGameState(s));
    forecast.push({
      tSec: curSec,
      boundaryIndex: curSec,
      gold: s.resources?.gold ?? s.gold ?? 0,
    });
  }

  return {
    ok: true,
    window: {
      baseSec,
      endSec: baseSec + horizonSec,
      horizonSec,
      stepSec,
      mode,
      baseBoundaryIndex: baseSec,
      endBoundaryIndex: baseSec + horizonSec,
      horizon: steps,
      forecast,
    },
    stateDataByBoundary,
  };
}

// Convenience builder for a full cache: realized history + cursor-anchored window.
export function buildGoldGraphCacheFromTimeline(tl, opts = null) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const baseSec = clampSec(
    typeof opts?.baseSec === "number"
      ? opts.baseSec
      : tl.cursorSec ?? tl.cursorBoundaryIndex ?? 0
  );

  const historyRes = buildGoldGraphHistoryCacheFromTimeline(tl, opts);
  if (!historyRes.ok) return historyRes;

  const windowRes = buildGoldGraphWindowFromTimeline(tl, baseSec, opts);
  if (!windowRes.ok) return windowRes;

  // Merge stateData maps (window overwrites same key if present)
  const stateDataByBoundary = historyRes.stateDataByBoundary;
  for (const [k, sd] of windowRes.stateDataByBoundary.entries()) {
    stateDataByBoundary.set(k, sd);
  }

  return {
    ok: true,
    cache: {
      history: historyRes.history,
      maxReachedBoundaryIndex: historyRes.maxReachedBoundaryIndex, // alias
      maxReachedSec: historyRes.maxReachedSec,
      stateDataByBoundary,
      window: windowRes.window,
    },
  };
}

export function getStateAtBoundaryFromGoldGraphCache(cache, tl, boundaryIndex) {
  if (!cache || !isValidTimeline(tl)) return null;
  const s = clampSec(boundaryIndex);

  const sd = cache.stateDataByBoundary?.get?.(s);
  if (sd != null) {
    const st = deserializeGameState(sd);
    canonicalizeSnapshot(st);
    return st;
  }

  const rebuilt = rebuildStateAtSecond(tl, s);
  if (!rebuilt.ok) return null;

  canonicalizeSnapshot(
    rebuilt.state,
    rebuilt.state.planningIndex ?? 0
  );
  return rebuilt.state;
}
