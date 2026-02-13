// src/model/projection.js
// Time-based metric history + cursor-anchored windowed forecast projection.
//
// Projection must never mutate authoritative/cursor state.

import { serializeGameState, deserializeGameState } from "./state.js";
import { GRAPH_METRICS } from "./graph-metrics.js";
import {
  rebuildStateAtSecond,
  getStateDataAtSecond,
  isValidTimeline,
} from "./timeline/index.js";
import { canonicalizeSnapshot } from "./canonicalize.js";
import { updateGame } from "./game-model.js";
import { applyAction } from "./actions.js";
import {
  perfEnabled,
  perfNowMs,
  recordProjectionHistoryBuild,
  recordProjectionForecastBuild,
  recordProjectionStateWindowBuild,
} from "./perf.js";

const TICKS_PER_SEC = 60;
const DEFAULT_DT_STEP = 1 / TICKS_PER_SEC;

function clampSec(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

function resolveDtStepStrict(dtStep) {
  if (dtStep == null) return { ok: true, dt: DEFAULT_DT_STEP };
  if (!Number.isFinite(dtStep)) {
    return { ok: false, reason: "unsupportedDtStep" };
  }
  if (dtStep !== DEFAULT_DT_STEP) {
    return { ok: false, reason: "unsupportedDtStep" };
  }
  return { ok: true, dt: DEFAULT_DT_STEP };
}

function cloneState(state) {
  // serializeGameState strips derived fields; deserializeGameState rebuilds them.
  return deserializeGameState(serializeGameState(state));
}

function normalizeSeries(series) {
  if (Array.isArray(series) && series.length) return series;
  return GRAPH_METRICS.gold.series;
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function collectSeriesValues(series, state) {
  const values = {};
  for (const s of series) {
    if (!s || typeof s.getValue !== "function") continue;
    values[s.id] = safeNumber(s.getValue(state));
  }
  return values;
}

function collectSeriesValuesForGraph(series, state, subject, resolverFactory) {
  const list = Array.isArray(series) ? series : [];
  const values = {};
  let resolver = null;
  if (typeof resolverFactory === "function") {
    resolver = resolverFactory(state, subject);
  }
  for (const s of list) {
    if (!s) continue;
    if (typeof s.getValueFromSnapshot === "function") {
      values[s.id] = safeNumber(s.getValueFromSnapshot(state, subject, resolver));
      continue;
    }
    if (typeof s.getValue === "function") {
      values[s.id] = safeNumber(s.getValue(state, subject, resolver));
    }
  }
  return values;
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

export function getStateAtSecond(tl, tSec) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };
  const s = clampSec(tSec);

  const sdRes = getStateDataAtSecond(tl, s);
  if (!sdRes.ok) return sdRes;
  const st = deserializeGameState(sdRes.stateData);
  canonicalizeSnapshot(st);
  return { ok: true, state: st, stateData: sdRes.stateData };
}

// -----------------------------------------------------------------------------
// Projection simulation (PURE): returns a NEW state, never mutates the input.
// -----------------------------------------------------------------------------

function simulateForwardSecondsInPlace(state, seconds, dtStep) {
  const dtRes = resolveDtStepStrict(dtStep);
  if (!dtRes.ok) return dtRes;
  const dt = dtRes.dt;

  const totalSec = Math.max(0, clampSec(seconds));

  canonicalizeSnapshot(state);
  state.paused = false;

  // Default semantics: fixed-step 60 ticks per second when dt=1/60.
  const steps = totalSec * TICKS_PER_SEC;

  for (let i = 0; i < steps; i++) {
    updateGame(dt, state);
  }

  return { ok: true };
}

function simulateForwardSecondsPure(startState, seconds, dtStep) {
  const state = cloneState(startState);
  const res = simulateForwardSecondsInPlace(state, seconds, dtStep);
  if (!res.ok) return res;
  return { ok: true, state };
}

function normalizeStateForProjection(state, baseSec) {
  canonicalizeSnapshot(state);
  state.paused = false;
  if (Number.isFinite(baseSec)) {
    const sec = clampSec(baseSec);
    state.tSec = sec;
    state.simStepIndex = sec * TICKS_PER_SEC;
  }
}

// Optional mode: simulate until the next season event (season index changes).
// If paused, projection cannot advance time, so return a clean failure.
function simulateUntilNextSeasonEventPure(
  startState,
  dtStep,
  stepCapSec = 600
) {
  const dtRes = resolveDtStepStrict(dtStep);
  if (!dtRes.ok) return dtRes;
  const dt = dtRes.dt;

  const state = cloneState(startState);
  canonicalizeSnapshot(state);
  state.paused = false;

  const startSeason = state.currentSeasonIndex ?? 0;
  const maxSteps = Math.max(1, Math.floor(stepCapSec) * TICKS_PER_SEC);

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
// Metric graph cache builders
// -----------------------------------------------------------------------------

export function buildMetricGraphHistoryCacheFromTimeline(tl, opts = null) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const perfStart = perfEnabled() ? perfNowMs() : 0;

  const series = normalizeSeries(opts?.series);
  const historyEndSec = clampSec(tl.historyEndSec ?? 0);

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
  workingState.paused = false;

  // Ensure clock alignment with checkpoint second (replay invariant)
  workingState.tSec = startCheckpointSec;
  workingState.simStepIndex = startCheckpointSec * TICKS_PER_SEC;

  for (let sec = startCheckpointSec; sec <= historyEndSec; sec++) {
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

      const values = collectSeriesValues(series, workingState);
      history.push({ tSec: sec, values });
      stateDataByBoundary.set(sec, serializeGameState(workingState));
    }

    // Advance exactly 1 second (60 microsteps), unless at frontier
    if (sec < historyEndSec) {
      for (let i = 0; i < TICKS_PER_SEC; i++) {
        updateGame(DEFAULT_DT_STEP, workingState);
      }
    }
  }

  if (perfEnabled()) {
    recordProjectionHistoryBuild({
      ms: perfNowMs() - perfStart,
      points: history.length,
    });
  }
  if (perfEnabled()) {
    recordProjectionStateWindowBuild({
      ms: perfNowMs() - perfStart,
      points: stateDataByBoundary.size,
    });
  }
  return {
    ok: true,
    history,
    historyEndSec,
    stateDataByBoundary,
  };
}

export function buildMetricGraphWindowFromTimeline(
  tl,
  baseBoundary,
  opts = null
) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const perfStart = perfEnabled() ? perfNowMs() : 0;

  const series = normalizeSeries(opts?.series);
  const dtRes = resolveDtStepStrict(opts?.dtStep);
  if (!dtRes.ok) return dtRes;
  const dtStep = dtRes.dt;

  const horizonSec =
    typeof opts?.horizonSec === "number" && opts.horizonSec >= 0
      ? Math.floor(opts.horizonSec)
      : 120;

  const stepSec =
    typeof opts?.stepSec === "number" && opts.stepSec > 0
      ? Math.floor(opts.stepSec)
      : 1;

  const storeStateBySecond = opts?.storeStateBySecond !== false;

  const mode = opts?.mode === "seasonEvent" ? "seasonEvent" : "timeWindow";

  const baseSec = clampSec(
    typeof opts?.baseSec === "number" ? opts.baseSec : baseBoundary
  );

  const baseRes = getStateAtSecond(tl, baseSec);
  if (!baseRes.ok)
    return { ok: false, reason: baseRes.reason || "baseStateFailed" };

  let s = cloneState(baseRes.state);
  canonicalizeSnapshot(s);
  s.paused = false;

  const stateDataByBoundary = new Map();
  const forecast = [];

  // Stage 2 guarantee:
  // stateDataByBoundary stores ONLY baseSec + each plotted forecast point.
  // It does NOT store intermediate simulation-only seconds when stepSec > 1.
  stateDataByBoundary.set(baseSec, serializeGameState(s));
  const baseValues = collectSeriesValues(series, s);
  forecast.push({
    tSec: baseSec,
    values: baseValues,
  });

  let curSec = baseSec;
  const steps = Math.floor(horizonSec / stepSec);

  if (mode === "seasonEvent") {
    for (let i = 1; i <= steps; i++) {
      const sim = simulateUntilNextSeasonEventPure(
        s,
        dtStep,
        Math.max(1, horizonSec)
      );
      curSec = baseSec + i * stepSec;

      if (!sim.ok) break;
      s = sim.state;

      canonicalizeSnapshot(s);

      stateDataByBoundary.set(curSec, serializeGameState(s));
      forecast.push({
        tSec: curSec,
        values: collectSeriesValues(series, s),
      });
    }
  } else if (storeStateBySecond) {
    const totalSecs = steps * stepSec;
    for (let i = 1; i <= totalSecs; i++) {
      const sim = simulateForwardSecondsInPlace(s, 1, dtStep);
      if (!sim.ok) break;

      curSec = baseSec + i;
      canonicalizeSnapshot(s);
      stateDataByBoundary.set(curSec, serializeGameState(s));

      if (i % stepSec === 0) {
        forecast.push({
          tSec: curSec,
          values: collectSeriesValues(series, s),
        });
      }
    }
  } else {
    for (let i = 1; i <= steps; i++) {
      const sim = simulateForwardSecondsInPlace(s, stepSec, dtStep);
      curSec = baseSec + i * stepSec;

      if (!sim.ok) break;

      canonicalizeSnapshot(s);
      stateDataByBoundary.set(curSec, serializeGameState(s));
      forecast.push({
        tSec: curSec,
        values: collectSeriesValues(series, s),
      });
    }
  }

  if (perfEnabled()) {
    recordProjectionForecastBuild({
      ms: perfNowMs() - perfStart,
      points: forecast.length,
    });
  }
  return {
    ok: true,
    window: {
      baseSec,
      endSec: baseSec + horizonSec,
      horizonSec,
      stepSec,
      dtStep,
      mode,
      horizon: steps,
      forecast,
    },
    stateDataByBoundary,
  };
}

export function buildProjectionStateWindowFromTimeline(
  tl,
  baseBoundary,
  opts = null
) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const perfStart = perfEnabled() ? perfNowMs() : 0;

  const dtRes = resolveDtStepStrict(opts?.dtStep);
  if (!dtRes.ok) return dtRes;
  const dtStep = dtRes.dt;

  const horizonSec =
    typeof opts?.horizonSec === "number" && opts.horizonSec >= 0
      ? Math.floor(opts.horizonSec)
      : 120;

  const baseSec = clampSec(
    typeof opts?.baseSec === "number" ? opts.baseSec : baseBoundary
  );

  const baseRes = getStateAtSecond(tl, baseSec);
  if (!baseRes.ok)
    return { ok: false, reason: baseRes.reason || "baseStateFailed" };

  let s = cloneState(baseRes.state);
  normalizeStateForProjection(s, baseSec);

  const stateDataBySecond = new Map();
  stateDataBySecond.set(baseSec, serializeGameState(s));

  let curSec = baseSec;
  for (let i = 1; i <= horizonSec; i++) {
    const sim = simulateForwardSecondsInPlace(s, 1, dtStep);
    if (!sim.ok) break;

    curSec = baseSec + i;
    canonicalizeSnapshot(s);
    stateDataBySecond.set(curSec, serializeGameState(s));
  }

  return {
    ok: true,
    window: {
      baseSec,
      endSec: baseSec + horizonSec,
      horizonSec,
      dtStep,
      mode: "stateWindow",
    },
    stateDataBySecond,
  };
}

export function buildProjectionStateStepWindowFromTimeline(
  tl,
  baseBoundary,
  opts = null
) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const perfStart = perfEnabled() ? perfNowMs() : 0;

  const dtRes = resolveDtStepStrict(opts?.dtStep);
  if (!dtRes.ok) return dtRes;
  const dtStep = dtRes.dt;

  const horizonSec =
    typeof opts?.horizonSec === "number" && opts.horizonSec >= 0
      ? Math.floor(opts.horizonSec)
      : 0;

  const stepSec =
    typeof opts?.stepSec === "number" && opts.stepSec > 0
      ? Math.floor(opts.stepSec)
      : 1;

  const baseSec = clampSec(
    typeof opts?.baseSec === "number" ? opts.baseSec : baseBoundary
  );

  const baseRes = getStateAtSecond(tl, baseSec);
  if (!baseRes.ok)
    return { ok: false, reason: baseRes.reason || "baseStateFailed" };

  let s = cloneState(baseRes.state);
  normalizeStateForProjection(s, baseSec);

  const stateDataBySecond = new Map();
  stateDataBySecond.set(baseSec, serializeGameState(s));

  const steps = Math.floor(horizonSec / stepSec);
  let curSec = baseSec;
  for (let i = 1; i <= steps; i++) {
    const sim = simulateForwardSecondsInPlace(s, stepSec, dtStep);
    if (!sim.ok) break;

    curSec = baseSec + i * stepSec;
    canonicalizeSnapshot(s);
    stateDataBySecond.set(curSec, serializeGameState(s));
  }

  if (perfEnabled()) {
    recordProjectionStateWindowBuild({
      ms: perfNowMs() - perfStart,
      points: stateDataBySecond.size,
    });
  }
  return {
    ok: true,
    window: {
      baseSec,
      endSec: baseSec + horizonSec,
      horizonSec,
      stepSec,
      dtStep,
      mode: "stateStepWindow",
      horizon: steps,
    },
    stateDataBySecond,
  };
}

// Lightweight projection window for graph rendering.
// Stores computed series values only (no per-point full-state snapshots).
export function buildProjectionSeriesStepWindowFromTimeline(
  tl,
  baseBoundary,
  opts = null
) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const dtRes = resolveDtStepStrict(opts?.dtStep);
  if (!dtRes.ok) return dtRes;
  const dtStep = dtRes.dt;

  const horizonSec =
    typeof opts?.horizonSec === "number" && opts.horizonSec >= 0
      ? Math.floor(opts.horizonSec)
      : 0;

  const stepSec =
    typeof opts?.stepSec === "number" && opts.stepSec > 0
      ? Math.floor(opts.stepSec)
      : 1;

  const series = normalizeSeries(opts?.series);
  const subject = opts?.subject ?? null;
  const resolverFactory =
    typeof opts?.resolverFactory === "function" ? opts.resolverFactory : null;

  const baseSec = clampSec(
    typeof opts?.baseSec === "number" ? opts.baseSec : baseBoundary
  );

  const baseRes = getStateAtSecond(tl, baseSec);
  if (!baseRes.ok)
    return { ok: false, reason: baseRes.reason || "baseStateFailed" };

  const s = baseRes.state;
  normalizeStateForProjection(s, baseSec);

  const valuesBySecond = new Map();
  valuesBySecond.set(
    baseSec,
    collectSeriesValuesForGraph(series, s, subject, resolverFactory)
  );

  const steps = Math.floor(horizonSec / stepSec);
  let curSec = baseSec;
  for (let i = 1; i <= steps; i++) {
    const sim = simulateForwardSecondsInPlace(s, stepSec, dtStep);
    if (!sim.ok) break;

    curSec = baseSec + i * stepSec;
    canonicalizeSnapshot(s);
    valuesBySecond.set(
      curSec,
      collectSeriesValuesForGraph(series, s, subject, resolverFactory)
    );
  }

  return {
    ok: true,
    window: {
      baseSec,
      endSec: baseSec + horizonSec,
      horizonSec,
      stepSec,
      dtStep,
      mode: "seriesStepWindow",
      horizon: steps,
    },
    valuesBySecond,
  };
}

export function buildProjectionStateStepWindowFromStateData(
  baseStateData,
  baseBoundary,
  opts = null
) {
  if (baseStateData == null) return { ok: false, reason: "noBaseStateData" };

  const perfStart = perfEnabled() ? perfNowMs() : 0;

  const dtRes = resolveDtStepStrict(opts?.dtStep);
  if (!dtRes.ok) return dtRes;
  const dtStep = dtRes.dt;

  const horizonSec =
    typeof opts?.horizonSec === "number" && opts.horizonSec >= 0
      ? Math.floor(opts.horizonSec)
      : 0;

  const stepSec =
    typeof opts?.stepSec === "number" && opts.stepSec > 0
      ? Math.floor(opts.stepSec)
      : 1;

  const baseSec = clampSec(
    typeof opts?.baseSec === "number" ? opts.baseSec : baseBoundary
  );

  const s = deserializeGameState(baseStateData);
  normalizeStateForProjection(s, baseSec);

  const stateDataBySecond = new Map();
  stateDataBySecond.set(baseSec, serializeGameState(s));

  const steps = Math.floor(horizonSec / stepSec);
  let curSec = baseSec;
  for (let i = 1; i <= steps; i++) {
    const sim = simulateForwardSecondsInPlace(s, stepSec, dtStep);
    if (!sim.ok) break;

    curSec = baseSec + i * stepSec;
    canonicalizeSnapshot(s);
    stateDataBySecond.set(curSec, serializeGameState(s));
  }

  if (perfEnabled()) {
    recordProjectionStateWindowBuild({
      ms: perfNowMs() - perfStart,
      points: stateDataBySecond.size,
    });
  }
  return {
    ok: true,
    window: {
      baseSec,
      endSec: baseSec + horizonSec,
      horizonSec,
      stepSec,
      dtStep,
      mode: "stateStepWindow",
      horizon: steps,
    },
    stateDataBySecond,
  };
}

export function buildProjectionStateWindowFromStateData(
  baseStateData,
  baseBoundary,
  opts = null
) {
  if (baseStateData == null) return { ok: false, reason: "noBaseStateData" };

  const perfStart = perfEnabled() ? perfNowMs() : 0;

  const dtRes = resolveDtStepStrict(opts?.dtStep);
  if (!dtRes.ok) return dtRes;
  const dtStep = dtRes.dt;

  const horizonSec =
    typeof opts?.horizonSec === "number" && opts.horizonSec >= 0
      ? Math.floor(opts.horizonSec)
      : 0;

  const baseSec = clampSec(
    typeof opts?.baseSec === "number" ? opts.baseSec : baseBoundary
  );

  const s = deserializeGameState(baseStateData);
  normalizeStateForProjection(s, baseSec);

  const stateDataBySecond = new Map();
  stateDataBySecond.set(baseSec, serializeGameState(s));

  let curSec = baseSec;
  for (let i = 1; i <= horizonSec; i++) {
    const sim = simulateForwardSecondsInPlace(s, 1, dtStep);
    if (!sim.ok) break;

    curSec = baseSec + i;
    canonicalizeSnapshot(s);
    stateDataBySecond.set(curSec, serializeGameState(s));
  }

  if (perfEnabled()) {
    recordProjectionStateWindowBuild({
      ms: perfNowMs() - perfStart,
      points: stateDataBySecond.size,
    });
  }
  return {
    ok: true,
    window: {
      baseSec,
      endSec: baseSec + horizonSec,
      horizonSec,
      dtStep,
      mode: "stateWindow",
    },
    stateDataBySecond,
  };
}

// Convenience builder for a full cache: realized history + cursor-anchored window.
export function buildMetricGraphCacheFromTimeline(tl, opts = null) {
  if (!isValidTimeline(tl)) return { ok: false, reason: "badTimeline" };

  const baseSec = clampSec(
    typeof opts?.baseSec === "number"
      ? opts.baseSec
      : tl.cursorSec ?? 0
  );

  const historyRes = buildMetricGraphHistoryCacheFromTimeline(tl, opts);
  if (!historyRes.ok) return historyRes;

  const windowRes = buildMetricGraphWindowFromTimeline(tl, baseSec, opts);
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
      historyEndSec: historyRes.historyEndSec,
      stateDataByBoundary,
      window: windowRes.window,
    },
  };
}

export function getStateAtBoundaryFromGraphCache(cache, tl, boundaryIndex) {
  if (!cache || !isValidTimeline(tl)) return null;
  const s = clampSec(boundaryIndex);

  const sd = cache.stateDataByBoundary?.get?.(s);
  if (sd != null) {
    const st = deserializeGameState(sd);
    canonicalizeSnapshot(st);
    return st;
  }

  const win = cache.window;
  if (win && cache.stateDataByBoundary && s >= win.baseSec && s <= win.endSec) {
    const baseSec = clampSec(win.baseSec ?? 0);
    const stepSec = Math.max(1, Math.floor(win.stepSec ?? 1));
    const offset = s - baseSec;
    if (offset >= 0) {
      const anchorSec = baseSec + Math.floor(offset / stepSec) * stepSec;
      const anchorData = cache.stateDataByBoundary.get(anchorSec);
      if (anchorData != null) {
        const st = deserializeGameState(anchorData);
        canonicalizeSnapshot(st);
        st.paused = false;

        const deltaSec = s - anchorSec;
        if (deltaSec > 0) {
          const sim = simulateForwardSecondsInPlace(
            st,
            deltaSec,
            win.dtStep
          );
          if (!sim.ok) return null;
        }

        canonicalizeSnapshot(st);
        cache.stateDataByBoundary.set(s, serializeGameState(st));
        return st;
      }
    }
  }

  const rebuilt = rebuildStateAtSecond(tl, s);
  if (!rebuilt.ok) return null;

  canonicalizeSnapshot(rebuilt.state);
  return rebuilt.state;
}
