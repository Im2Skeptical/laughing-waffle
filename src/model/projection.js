// src/model/projection.js
// Time-based gold history + cursor-anchored windowed forecast projection.
//
// Projection must never mutate authoritative/cursor state.

import { serializeGameState, deserializeGameState } from "./state.js";
import { rebuildStateAtSecond, isValidTimeline } from "./timeline.js";
import { canonicalizePlanningBoundaryState } from "./canonicalize.js";
import { cmdStartNextTurn } from "./commands.js";
import { updateGame } from "./game-model.js";

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
    canonicalizePlanningBoundaryState(st, st.planningIndex ?? 0);
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

  // Ensure clean snapshot flags; does NOT derive season/turn.
  canonicalizePlanningBoundaryState(state, state.planningIndex ?? 0);

  // Deterministic stepping: by default 60 microsteps per second (matches replay).
  const steps = Math.max(0, Math.floor((totalSec * 1) / dt));
  const maxSteps = totalSec * TICKS_PER_SEC + 10; // safety if dt is 1/60

  const cappedSteps = Math.min(steps, maxSteps);

  for (let i = 0; i < cappedSteps; i++) {
    updateGame(dt, state);
  }

  return { ok: true, state };
}

// Optional mode: simulate until the next season event (season index changes).
function simulateUntilNextSeasonEventPure(
  startState,
  dtStep,
  stepCapSec = 600
) {
  const dt =
    typeof dtStep === "number" && dtStep > 0 ? dtStep : DEFAULT_DT_STEP;

  const state = cloneState(startState);
  canonicalizePlanningBoundaryState(state, state.planningIndex ?? 0);

  const startSeason = state.currentSeasonIndex ?? 0;

  // If we are at planning, begin a simulation run (legacy behavior).
  if (state.phase === "planning") {
    const start = cmdStartNextTurn(state);
    if (!start?.ok)
      return { ok: false, reason: start?.reason || "startFailed" };
  }

  const maxSteps = Math.max(1, Math.floor(stepCapSec / dt));

  for (let i = 0; i < maxSteps; i++) {
    updateGame(dt, state);
    if ((state.currentSeasonIndex ?? 0) !== startSeason) {
      canonicalizePlanningBoundaryState(state, state.planningIndex ?? 0);
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

  for (let s = 0; s <= maxReachedSec; s += historyStrideSec) {
    const rebuilt = getStateAtSecond(tl, s);
    if (!rebuilt.ok)
      return { ok: false, reason: rebuilt.reason || "rebuildFailed" };

    canonicalizePlanningBoundaryState(
      rebuilt.state,
      rebuilt.state.planningIndex ?? 0
    );

    const gold = rebuilt.state.resources?.gold ?? rebuilt.state.gold ?? 0;

    // Keep legacy field names for downstream graph code:
    // boundaryIndex is now an alias for tSec.
    history.push({ tSec: s, boundaryIndex: s, gold });

    stateDataByBoundary.set(s, serializeGameState(rebuilt.state));
  }

  return {
    ok: true,
    history,
    maxReachedBoundaryIndex: maxReachedSec, // legacy alias
    maxReachedSec,
    stateDataByBoundary,
  };
}

export function buildGoldGraphWindowFromTimeline(
  tl,
  baseBoundary,
  opts = null
) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const dtStep =
    typeof opts?.dtStep === "number" && opts.dtStep > 0
      ? opts.dtStep
      : DEFAULT_DT_STEP;

  // Time-window mode by default
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

  // Work from an isolated copy.
  let s = cloneState(baseRes.state);
  canonicalizePlanningBoundaryState(s, s.planningIndex ?? 0);

  const stateDataByBoundary = new Map();
  const forecast = [];

  // Include base point
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
      // In seasonEvent mode, we do not assume a fixed sec delta; we just advance an x-index.
      // Still, keep boundaryIndex as a monotonically increasing index for graphing.
      curSec = baseSec + i * stepSec;
    } else {
      sim = simulateForwardSecondsPure(s, stepSec, dtStep);
      curSec = baseSec + i * stepSec;
    }

    if (!sim.ok) break;
    s = sim.state;

    canonicalizePlanningBoundaryState(s, s.planningIndex ?? 0);

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
      // Legacy aliases
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
    canonicalizePlanningBoundaryState(st, st.planningIndex ?? 0);
    return st;
  }

  const rebuilt = rebuildStateAtSecond(tl, s);
  if (!rebuilt.ok) return null;

  canonicalizePlanningBoundaryState(
    rebuilt.state,
    rebuilt.state.planningIndex ?? 0
  );
  return rebuilt.state;
}
