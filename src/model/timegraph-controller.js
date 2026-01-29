// src/model/timegraph-controller.js
// Logic controller for time-series projections (e.g. gold graph).
// Owns the cache, invalidation policies, and incremental updates.
// No Pixi imports.

import {
  buildProjectionStateStepWindowFromTimeline,
  buildProjectionStateStepWindowFromStateData,
  buildProjectionStateWindowFromStateData,
  buildMetricGraphHistoryCacheFromTimeline,
  getStateAtSecond,
} from "./projection.js";

import { GRAPH_METRICS } from "./graph-metrics.js";
import { serializeGameState, deserializeGameState } from "./state.js";
import { canonicalizeSnapshot } from "./canonicalize.js";
import { BASE_PROJECTION_HORIZON_SEC } from "../defs/gamesettings/gamerules-defs.js";
import { updateGame } from "./game-model.js";
import { applyAction } from "./actions.js";

const DEFAULT_PROJECTION_CACHE_MAX_SECS = 4096;
const MAX_HISTORY_POINTS = 2000;

function clampSec(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function resolveMetricDef(metric) {
  const resolved = typeof metric === "string" ? GRAPH_METRICS[metric] : metric;
  if (resolved && typeof resolved === "object") return resolved;
  return GRAPH_METRICS.gold;
}

function ensureSeriesArray(series) {
  return Array.isArray(series) ? series : [];
}

function shouldSampleHistory(sec, frontierSec, strideSec) {
  if (sec === frontierSec) return true;
  return sec % strideSec === 0;
}

function computeValuesFromStateData(stateData, series, subject) {
  if (stateData == null) return {};
  const list = Array.isArray(series) ? series : [];
  if (!list.length) return {};

  const allFast = list.every(
    (s) => s && typeof s.getValueFromSnapshot === "function"
  );

  let raw = stateData;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (_) {
      raw = stateData;
    }
  }

  let state = null;
  if (!allFast) {
    state = deserializeGameState(stateData);
    canonicalizeSnapshot(state);
  }

  const values = {};
  for (const s of list) {
    if (!s || typeof s.getValue !== "function") continue;
    if (typeof s.getValueFromSnapshot === "function") {
      values[s.id] = safeNumber(s.getValueFromSnapshot(raw, subject));
    } else {
      values[s.id] = safeNumber(s.getValue(state, subject));
    }
  }
  return values;
}

function resolveSeries(metricDef, subject, cursorState) {
  if (typeof metricDef?.getSeries === "function") {
    return ensureSeriesArray(metricDef.getSeries(subject, cursorState));
  }
  return ensureSeriesArray(metricDef?.series);
}

function resolveLabel(metricDef, subject, cursorState) {
  if (typeof metricDef?.getLabel === "function") {
    const label = metricDef.getLabel(subject, cursorState);
    if (label) return label;
  }
  return metricDef?.label || "Metric";
}

function resolveSubjectKey(metricDef, subject, explicitKey) {
  if (explicitKey != null) return explicitKey;
  if (typeof metricDef?.getSubjectKey === "function") {
    const key = metricDef.getSubjectKey(subject);
    if (key != null) return key;
  }
  if (subject && typeof subject === "object") {
    if (subject.key != null) return subject.key;
    if (subject.id != null) return subject.id;
    if (subject.col != null) return subject.col;
  }
  return null;
}

function getSeriesSignature(series) {
  if (!Array.isArray(series) || !series.length) return "";
  return series.map((s) => s?.id ?? "").join("|");
}

function computeActionSig(tl) {
  const acts = Array.isArray(tl?.actions) ? tl.actions : [];
  const len = acts.length;
  const last = len ? acts[len - 1] : null;
  return {
    ref: acts,
    len,
    lastRef: last,
    lastSec: last ? Math.floor(last.tSec ?? 0) : 0,
  };
}

function actionSigEquals(a, b) {
  if (!a || !b) return false;
  return (
    a.ref === b.ref &&
    a.len === b.len &&
    a.lastRef === b.lastRef &&
    a.lastSec === b.lastSec
  );
}

function computeTimelineSignature(tl) {
  // Projection cache should only reset when replay-relevant data changes.
  // We intentionally ignore checkpoint churn (revision bumps) here.
  const actions = Array.isArray(tl?.actions) ? tl.actions : [];
  const len = actions.length;
  const last = len ? actions[len - 1] : null;
  return {
    baseRef: tl?.baseStateData ?? null,
    actionsRef: actions,
    actionsLen: len,
    lastRef: last,
    lastSec: last ? Math.floor(last.tSec ?? 0) : 0,
  };
}

function signatureEquals(a, b) {
  if (!a || !b) return false;
  return (
    a.baseRef === b.baseRef &&
    a.actionsRef === b.actionsRef &&
    a.actionsLen === b.actionsLen &&
    a.lastRef === b.lastRef &&
    a.lastSec === b.lastSec
  );
}

function createProjectionCache({ maxEntries = DEFAULT_PROJECTION_CACHE_MAX_SECS } = {}) {
  let signature = null;
  let forecastBaseSec = 0;
  let forecastEndSec = 0;
  let forecastStepSec = 1;
  let forecastDtStep = null;
  const stateDataBySecond = new Map();

  const limit = Number.isFinite(maxEntries)
    ? Math.max(256, Math.floor(maxEntries))
    : DEFAULT_PROJECTION_CACHE_MAX_SECS;

  function reset(nextSignature) {
    signature = nextSignature || null;
    forecastBaseSec = 0;
    forecastEndSec = 0;
    forecastStepSec = 1;
    forecastDtStep = null;
    stateDataBySecond.clear();
  }

  function touch(sec) {
    if (!stateDataBySecond.has(sec)) return null;
    const data = stateDataBySecond.get(sec);
    stateDataBySecond.delete(sec);
    stateDataBySecond.set(sec, data);
    return data;
  }

  function set(sec, data) {
    stateDataBySecond.delete(sec);
    stateDataBySecond.set(sec, data);

    while (stateDataBySecond.size > limit) {
      const oldest = stateDataBySecond.keys().next().value;
      stateDataBySecond.delete(oldest);
    }
  }

  function ensureSignature(tl) {
    const nextSig = computeTimelineSignature(tl);
    const changed = !signatureEquals(nextSig, signature);
    if (changed) reset(nextSig);
    return { changed, signature };
  }

  function ensureForecastWindow(tl, targetEndSec, dtStep, stepSec) {
    if (!tl) return { ok: false, reason: "noTimeline" };
    ensureSignature(tl);

    const step =
      typeof stepSec === "number" && stepSec > 0 ? Math.floor(stepSec) : 1;
    const baseSec = clampSec(tl.historyEndSec ?? 0);
    const target = clampSec(targetEndSec);
    const horizonSec = Math.max(0, target - baseSec);
    const targetBoundaryEnd =
      baseSec + Math.floor(horizonSec / step) * step;

    if (targetBoundaryEnd <= baseSec) {
      forecastBaseSec = baseSec;
      forecastEndSec = baseSec;
      forecastStepSec = step;
      forecastDtStep = dtStep;
      return { ok: true };
    }

    if (
      forecastBaseSec === baseSec &&
      forecastEndSec >= targetBoundaryEnd &&
      forecastStepSec === step &&
      stateDataBySecond.size > 0
    ) {
      return { ok: true };
    }

    const baseStateData =
      stateDataBySecond.get(baseSec) ??
      (() => {
        const baseRes = getStateAtSecond(tl, baseSec);
        if (!baseRes.ok) return null;
        const sd = serializeGameState(baseRes.state);
        set(baseSec, sd);
        return sd;
      })();

    if (baseStateData == null) {
      return { ok: false, reason: "baseStateMissing" };
    }

    if (
      forecastBaseSec === baseSec &&
      forecastEndSec < targetBoundaryEnd &&
      forecastStepSec === step
    ) {
      const tailData = stateDataBySecond.get(forecastEndSec);
      if (tailData != null) {
        const extend = buildProjectionStateStepWindowFromStateData(tailData, forecastEndSec, {
          horizonSec: targetBoundaryEnd - forecastEndSec,
          stepSec: step,
          dtStep,
        });
        if (!extend.ok) return extend;
        for (const [sec, sd] of extend.stateDataBySecond.entries()) {
          set(sec, sd);
        }
        forecastEndSec = extend.window.endSec;
        forecastStepSec = step;
        forecastDtStep = dtStep;
        return { ok: true };
      }
    }

    if (
      baseSec > forecastBaseSec &&
      baseSec <= forecastEndSec &&
      stateDataBySecond.has(baseSec) &&
      forecastStepSec === step &&
      (baseSec - forecastBaseSec) % step === 0
    ) {
      // Shift the window forward: reuse existing points, extend only the tail.
      forecastBaseSec = baseSec;
      if (forecastEndSec < targetBoundaryEnd) {
        const tailData = stateDataBySecond.get(forecastEndSec);
        if (tailData != null) {
          const extend = buildProjectionStateStepWindowFromStateData(tailData, forecastEndSec, {
            horizonSec: targetBoundaryEnd - forecastEndSec,
            stepSec: step,
            dtStep,
          });
          if (!extend.ok) return extend;
          for (const [sec, sd] of extend.stateDataBySecond.entries()) {
            set(sec, sd);
          }
          forecastEndSec = extend.window.endSec;
        }
      }
      if (forecastEndSec < targetBoundaryEnd) {
        // Tail missing; fall back to rebuild.
        forecastBaseSec = baseSec;
        forecastEndSec = baseSec;
      } else {
        forecastStepSec = step;
        forecastDtStep = dtStep;
        return { ok: true };
      }
    }

    const winRes = buildProjectionStateStepWindowFromTimeline(tl, baseSec, {
      horizonSec: targetBoundaryEnd - baseSec,
      stepSec: step,
      dtStep,
    });
    if (!winRes.ok) return winRes;

    for (const [sec, sd] of winRes.stateDataBySecond.entries()) {
      set(sec, sd);
    }

    forecastBaseSec = baseSec;
    forecastEndSec = winRes.window.endSec;
    forecastStepSec = step;
    forecastDtStep = dtStep;

    return { ok: true };
  }

  function ensureStateAtSecond(tl, sec, dtStep, stepSec) {
    if (!tl) return { ok: false, reason: "noTimeline" };

    ensureSignature(tl);

    const t = clampSec(sec);
    const cached = touch(t);
    if (cached != null) return { ok: true, stateData: cached };

    const historyEnd = clampSec(tl.historyEndSec ?? 0);

    if (t <= historyEnd) {
      const rebuilt = getStateAtSecond(tl, t);
      if (!rebuilt.ok) {
        return { ok: false, reason: rebuilt.reason || "rebuildFailed" };
      }
      const sd = serializeGameState(rebuilt.state);
      set(t, sd);
      return { ok: true, stateData: sd };
    }

    const step =
      typeof stepSec === "number" && stepSec > 0 ? Math.floor(stepSec) : 1;

    const forecastRes = ensureForecastWindow(tl, t, dtStep, step);
    if (!forecastRes.ok) return forecastRes;

    const forecastData = touch(t);
    if (forecastData != null) return { ok: true, stateData: forecastData };

    if (t >= forecastBaseSec && t <= forecastEndSec && step > 0) {
      const offset = t - forecastBaseSec;
      const anchorSec =
        forecastBaseSec + Math.floor(offset / step) * step;
      const anchorData = stateDataBySecond.get(anchorSec);
      if (anchorData != null) {
        const delta = t - anchorSec;
        if (delta > 0) {
          const win = buildProjectionStateWindowFromStateData(anchorData, anchorSec, {
            horizonSec: delta,
            dtStep: forecastDtStep ?? dtStep,
          });
          if (win.ok) {
            const sd = win.stateDataBySecond.get(t);
            if (sd != null) {
              set(t, sd);
              return { ok: true, stateData: sd };
            }
          }
        } else if (delta === 0) {
          set(t, anchorData);
          return { ok: true, stateData: anchorData };
        }
      }
    }

    return { ok: false, reason: "forecastMissing" };
  }

  return {
    ensureSignature,
    ensureStateAtSecond,
    ensureForecastWindow,
    getStateData: (sec) => touch(clampSec(sec)),
    setStateData: (sec, data) => {
      const t = clampSec(sec);
      set(t, data);
      return { ok: true };
    },
    clear: () => reset(-1),
    getSize: () => stateDataBySecond.size,
    maxEntries: limit,
  };
}

const sharedProjectionCache = createProjectionCache();

export function getSharedProjectionCache() {
  return sharedProjectionCache;
}

export function createTimeGraphController({
  getTimeline,
  getCursorState,
  metric = GRAPH_METRICS.gold,
  projectionCache,

  // Stage 4: decouple plotting resolution from scrubbing resolution
  historyStrideSec = 1,
  forecastStepSec = 1,
  horizonSec = BASE_PROJECTION_HORIZON_SEC,
} = {}) {
  let graphCache = null;
  let metricDef = resolveMetricDef(metric);
  let activeSeries = resolveSeries(metricDef, null, null);
  let metricLabel = resolveLabel(metricDef, null, null);

  let subject = null;
  let subjectKey = null;

  let isActive = false;
  let stateDirty = true;
  let seriesDirty = true;
  let cacheVersion = 0;
  let lastActionSig = null;
  let valuesRevision = 0;

  const MAX_TAIL_REBUILD_SEC = 240;
  const SUBJECT_VALUE_CACHE_MAX = 5000;
  const subjectValueCache = new Map();

  // Config (mutable locals; never assign to function parameters)
  let historyStrideSecCur = historyStrideSec;
  let forecastStepSecCur = forecastStepSec;
  let horizonSecCur = horizonSec;

  // Change detection
  let lastKnownHistoryEndSec = 0;

  const projection = projectionCache || getSharedProjectionCache();

  function invalidateSubjectValues() {
    valuesRevision += 1;
    subjectValueCache.clear();
  }

  function clampStride(v, fallback) {
    const n = Math.floor(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function resolveHistoryStride(historyEndSec) {
    const maxPts = Number.isFinite(MAX_HISTORY_POINTS)
      ? Math.max(256, Math.floor(MAX_HISTORY_POINTS))
      : 2000;
    const sec = clampSec(historyEndSec);
    if (sec <= 0) return 1;
    return Math.max(1, Math.ceil(sec / maxPts));
  }

  function rebuildGraphCache() {
    const tl = getTimeline?.();
    const cs = getCursorState?.();
    if (!tl || !cs) {
      graphCache = null;
      stateDirty = true;
      seriesDirty = true;
      return { ok: false, reason: "no state" };
    }

    const sigRes = projection.ensureSignature(tl);
    lastActionSig = computeActionSig(tl);

    historyStrideSecCur = clampStride(historyStrideSecCur, 5);
    forecastStepSecCur = clampStride(forecastStepSecCur, 5);
    horizonSecCur = clampStride(horizonSecCur, 1200);

    activeSeries = resolveSeries(metricDef, subject, cs);
    metricLabel = resolveLabel(metricDef, subject, cs);

    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
    historyStrideSecCur = Math.max(
      historyStrideSecCur,
      resolveHistoryStride(historyEndSec)
    );
    const boundSeries = activeSeries.map((s) => ({
      ...s,
      getValue: (st) => (typeof s.getValue === "function" ? s.getValue(st, subject) : 0),
    }));

    const histRes = buildMetricGraphHistoryCacheFromTimeline(tl, {
      series: boundSeries,
      historyStrideSec: historyStrideSecCur,
    });
    if (!histRes.ok) return histRes;

    // Seed projection cache with history checkpoints to avoid per-sec rebuilds later.
    for (const [sec, sd] of histRes.stateDataByBoundary.entries()) {
      projection.ensureSignature(tl);
      projection.setStateData?.(sec, sd);
    }

    const history = histRes.history.map((p) => ({
      tSec: p.tSec,
      values: p.values,
    }));

    const stateDataByBoundary = new Map(histRes.stateDataByBoundary);

    const baseSec = historyEndSec;
    const endSec = baseSec + horizonSecCur;
    const steps = Math.floor(horizonSecCur / forecastStepSecCur);
    const lastForecastSec = baseSec + steps * forecastStepSecCur;

    if (horizonSecCur > 0) {
      const forecastRes = projection.ensureForecastWindow(
        tl,
        lastForecastSec,
        undefined,
        forecastStepSecCur
      );
      if (!forecastRes.ok) return forecastRes;
    }

    const forecast = [];
    for (let i = 0; i <= steps; i++) {
      const sec = baseSec + i * forecastStepSecCur;
      const res = projection.ensureStateAtSecond(
        tl,
        sec,
        undefined,
        forecastStepSecCur
      );
      if (!res.ok) return res;
      if (res.stateData != null) stateDataByBoundary.set(sec, res.stateData);
      forecast.push({
        tSec: sec,
        values: computeValuesFromStateData(res.stateData, activeSeries, subject),
      });
    }

    graphCache = {
      history,
      historyEndSec,
      window: {
        baseSec,
        endSec,
        horizonSec: horizonSecCur,
        stepSec: forecastStepSecCur,
        forecast,
      },
      stateDataByBoundary,
      series: activeSeries,
      metricLabel,
      metric: metricDef,
      subjectKey,
      version: ++cacheVersion,
    };
    invalidateSubjectValues();

    lastKnownHistoryEndSec = historyEndSec;

    stateDirty = false;
    seriesDirty = false;
    return { ok: true };
  }

  function rebuildSeriesValues() {
    const tl = getTimeline?.();
    const cs = getCursorState?.();
    if (!tl || !cs) {
      graphCache = null;
      stateDirty = true;
      seriesDirty = true;
      return { ok: false, reason: "no state" };
    }

    activeSeries = resolveSeries(metricDef, subject, cs);
    metricLabel = resolveLabel(metricDef, subject, cs);

    if (!graphCache) {
      return rebuildGraphCache();
    }

    graphCache.series = activeSeries;
    graphCache.metricLabel = metricLabel;
    graphCache.metric = metricDef;
    graphCache.subjectKey = subjectKey;
    graphCache.version = ++cacheVersion;

    seriesDirty = false;
    return { ok: true };
  }

  function patchHistoryFromSecond(tl, startSec, endSec) {
    if (!graphCache) return false;
    const history = Array.isArray(graphCache.history) ? graphCache.history : [];
    const stateDataByBoundary = graphCache.stateDataByBoundary;
    let inserted = false;

    for (let sec = startSec; sec <= endSec; sec++) {
      if (!shouldSampleHistory(sec, endSec, historyStrideSecCur)) continue;
      const res = projection.ensureStateAtSecond(
        tl,
        sec,
        undefined,
        forecastStepSecCur
      );
      if (!res.ok) return false;
      if (res.stateData != null && stateDataByBoundary) {
        stateDataByBoundary.set(sec, res.stateData);
      }

      const values = computeValuesFromStateData(
        res.stateData,
        activeSeries,
        subject
      );

      let replaced = false;
      for (let i = 0; i < history.length; i++) {
        if (clampSec(history[i].tSec ?? 0) === sec) {
          history[i].values = values;
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        history.push({ tSec: sec, values });
        inserted = true;
      }
    }

    if (inserted) {
      history.sort((a, b) => (a.tSec ?? 0) - (b.tSec ?? 0));
    }

    graphCache.version = ++cacheVersion;
    invalidateSubjectValues();
    return true;
  }

  function pruneHistoryAfterSec(limitSec) {
    if (!graphCache) return;
    const limit = clampSec(limitSec);
    const history = Array.isArray(graphCache.history) ? graphCache.history : [];
    graphCache.history = history.filter(
      (p) => clampSec(p?.tSec ?? 0) <= limit
    );

    if (graphCache.stateDataByBoundary) {
      for (const sec of graphCache.stateDataByBoundary.keys()) {
        if (sec > limit) {
          graphCache.stateDataByBoundary.delete(sec);
        }
      }
    }

    if (graphCache.window) {
      graphCache.window.baseSec = limit;
      graphCache.window.forecast = [];
    }

    graphCache.historyEndSec = limit;
  }

  function tryHandleAppendMutation(tl, historyEndSec, opts = {}) {
    if (!graphCache || !tl) return false;

    const nextSig = computeActionSig(tl);
    const prevSig = lastActionSig;
    if (!prevSig || !nextSig) return false;

    const isAppend =
      prevSig.ref === nextSig.ref &&
      nextSig.len === prevSig.len + 1 &&
      nextSig.lastRef === nextSig.ref?.[nextSig.len - 1];

    if (!isAppend) return false;

    const actionSec = clampSec(nextSig.lastSec ?? 0);
    const frontier = clampSec(historyEndSec ?? 0);
    const span = Math.max(0, frontier - actionSec);

    if (span > MAX_TAIL_REBUILD_SEC) return false;

    const okHistory = patchHistoryFromSecond(tl, actionSec, frontier);
    if (!okHistory) return false;

    const okForecast = rebuildForecastAtFrontier({
      forceRebuild: !!opts.forceForecastRebuild,
    });
    if (!okForecast) return false;

    lastActionSig = nextSig;
    lastKnownHistoryEndSec = frontier;
    stateDirty = false;
    seriesDirty = false;
    return true;
  }

  function tryHandleMutationHint(tl, historyEndSec, opts = {}) {
    if (!graphCache || !tl) return false;
    const kind = tl._lastMutationKind;
    const sec = clampSec(tl._lastMutationSec ?? -1);
    if (sec < 0) return false;

    if (kind !== "replaceActionsAtSec" && kind !== "appendAction") {
      return false;
    }

    const frontier = clampSec(historyEndSec ?? 0);
    const span = Math.max(0, frontier - sec);
    if (span > MAX_TAIL_REBUILD_SEC) return false;

    const okHistory = patchHistoryFromSecond(tl, sec, frontier);
    if (!okHistory) return false;

    const okForecast = rebuildForecastAtFrontier({
      forceRebuild: !!opts.forceForecastRebuild,
    });
    if (!okForecast) return false;

    lastKnownHistoryEndSec = frontier;
    stateDirty = false;
    seriesDirty = false;
    return true;
  }

  function extendHistoryTo(newHistoryEndSec) {
    const tl = getTimeline?.();
    if (!graphCache || !tl) return false;

    const oldMax = clampSec(graphCache.historyEndSec ?? 0);
    const target = clampSec(newHistoryEndSec ?? 0);
    if (target <= oldMax) return true;

    const history = Array.isArray(graphCache.history) ? graphCache.history : [];
    const lastPoint = history.length ? history[history.length - 1] : null;
    const startSec = clampSec(lastPoint?.tSec ?? oldMax);
    const stride = Math.max(1, historyStrideSecCur);

    let streamed = false;
    if (startSec <= oldMax && target - startSec >= stride) {
      const startData = graphCache.stateDataByBoundary?.get?.(startSec) ?? null;
      if (startData != null) {
        const steps = Math.floor((target - startSec) / stride);
        const horizonSec = steps * stride;
        const win = buildProjectionStateStepWindowFromStateData(
          startData,
          startSec,
          { horizonSec, stepSec: stride }
        );
        if (win.ok) {
          for (const [sec, sd] of win.stateDataBySecond.entries()) {
            if (sec === startSec) continue;
            if (graphCache.stateDataByBoundary) {
              graphCache.stateDataByBoundary.set(sec, sd);
            }
            history.push({
              tSec: sec,
              values: computeValuesFromStateData(sd, activeSeries, subject),
            });
          }
          streamed = true;
        }
      }
    }

    if (!streamed) {
      for (let sec = oldMax + 1; sec <= target; sec++) {
        if (!shouldSampleHistory(sec, target, historyStrideSecCur)) continue;
        const res = projection.ensureStateAtSecond(
          tl,
          sec,
          undefined,
          forecastStepSecCur
        );
        if (!res.ok) return false;
        if (res.stateData != null && graphCache.stateDataByBoundary) {
          graphCache.stateDataByBoundary.set(sec, res.stateData);
        }
        history.push({
          tSec: sec,
          values: computeValuesFromStateData(
            res.stateData,
            activeSeries,
            subject
          ),
        });
      }
    }

    // Ensure the frontier point is sampled even when not stride-aligned.
    if (target % stride !== 0) {
      const exists = history.length && clampSec(history[history.length - 1]?.tSec ?? 0) === target;
      if (!exists) {
        const res = projection.ensureStateAtSecond(
          tl,
          target,
          undefined,
          forecastStepSecCur
        );
        if (!res.ok) return false;
        if (res.stateData != null && graphCache.stateDataByBoundary) {
          graphCache.stateDataByBoundary.set(target, res.stateData);
        }
        history.push({
          tSec: target,
          values: computeValuesFromStateData(
            res.stateData,
            activeSeries,
            subject
          ),
        });
      }
    }

    graphCache.historyEndSec = target;
    graphCache.version = ++cacheVersion;
    return true;
  }

  function rebuildForecastAtFrontier({
    invalidateValues = true,
    forceRebuild = false,
  } = {}) {
    const tl = getTimeline?.();
    if (!graphCache || !tl) return false;

    const baseSec = clampSec(tl.historyEndSec ?? 0);
    const endSec = baseSec + horizonSecCur;
    const steps = Math.floor(horizonSecCur / forecastStepSecCur);
    const lastForecastSec = baseSec + steps * forecastStepSecCur;

    if (horizonSecCur > 0) {
      const forecastRes = projection.ensureForecastWindow(
        tl,
        lastForecastSec,
        undefined,
        forecastStepSecCur
      );
      if (!forecastRes.ok) return false;
    }

    let forecast = [];
    const prevWindow = graphCache.window;
    if (!forceRebuild) {
      if (
        prevWindow &&
        prevWindow.stepSec === forecastStepSecCur &&
        prevWindow.horizonSec === horizonSecCur &&
        baseSec >= prevWindow.baseSec
      ) {
        forecast = Array.isArray(prevWindow.forecast)
          ? prevWindow.forecast.slice()
          : [];
        // Drop points that are now before the new base.
        forecast = forecast.filter((p) => (p?.tSec ?? -1) >= baseSec);
      }

      if (!forecast.length || forecast[0].tSec !== baseSec) {
        // If base isn't aligned to step, fall back to full rebuild.
        if (
          prevWindow &&
          (baseSec - prevWindow.baseSec) % forecastStepSecCur !== 0
        ) {
          forecast = [];
        }
      }
    }

    if (!forecast.length) {
      for (let i = 0; i <= steps; i++) {
        const sec = baseSec + i * forecastStepSecCur;
        const res = projection.ensureStateAtSecond(
          tl,
          sec,
          undefined,
          forecastStepSecCur
        );
        if (!res.ok) return false;
        if (res.stateData != null && graphCache.stateDataByBoundary) {
          graphCache.stateDataByBoundary.set(sec, res.stateData);
        }
        forecast.push({
          tSec: sec,
          values: computeValuesFromStateData(
            res.stateData,
            activeSeries,
            subject
          ),
        });
      }
    } else {
      // Ensure base point exists.
      if (forecast[0].tSec !== baseSec) {
        const res = projection.ensureStateAtSecond(
          tl,
          baseSec,
          undefined,
          forecastStepSecCur
        );
        if (!res.ok) return false;
        if (res.stateData != null && graphCache.stateDataByBoundary) {
          graphCache.stateDataByBoundary.set(baseSec, res.stateData);
        }
        forecast.unshift({
          tSec: baseSec,
          values: computeValuesFromStateData(
            res.stateData,
            activeSeries,
            subject
          ),
        });
      }

      let lastSec = forecast[forecast.length - 1]?.tSec ?? baseSec;
      if (lastSec < baseSec) lastSec = baseSec;

      for (
        let sec = lastSec + forecastStepSecCur;
        sec <= lastForecastSec;
        sec += forecastStepSecCur
      ) {
        const res = projection.ensureStateAtSecond(
          tl,
          sec,
          undefined,
          forecastStepSecCur
        );
        if (!res.ok) return false;
        if (res.stateData != null && graphCache.stateDataByBoundary) {
          graphCache.stateDataByBoundary.set(sec, res.stateData);
        }
        forecast.push({
          tSec: sec,
          values: computeValuesFromStateData(
            res.stateData,
            activeSeries,
            subject
          ),
        });
      }

      // Trim if horizon shrank.
      forecast = forecast.filter((p) => (p?.tSec ?? 0) <= lastForecastSec);
    }

    graphCache.window = {
      baseSec,
      endSec,
      horizonSec: horizonSecCur,
      stepSec: forecastStepSecCur,
      forecast,
    };
    graphCache.version = ++cacheVersion;
    if (invalidateValues) invalidateSubjectValues();

    return true;
  }

  function handleInvalidate(reason) {
    const tl = getTimeline?.();
    const cs = getCursorState?.();
    if (!tl || !cs) {
      graphCache = null;
      stateDirty = true;
      seriesDirty = true;
      return { ok: false, reason: "no state" };
    }

    if (!isActive && reason !== "open" && reason !== "active") {
      seriesDirty = true;
      return { ok: true, reason: "deferred" };
    }

    const sigRes = projection.ensureSignature(tl);
    if (sigRes?.changed) {
      const historyEndSec = clampSec(tl.historyEndSec ?? 0);
      const mutationSec = clampSec(tl._lastMutationSec ?? historyEndSec);
      invalidateSubjectValues();

      if (graphCache && mutationSec <= historyEndSec) {
        if (historyEndSec < lastKnownHistoryEndSec) {
          pruneHistoryAfterSec(historyEndSec);
        }

        const okHistory = patchHistoryFromSecond(
          tl,
          mutationSec,
          historyEndSec
        );
        if (okHistory) {
          const okForecast = rebuildForecastAtFrontier({
            forceRebuild: true,
          });
          if (okForecast) {
            lastKnownHistoryEndSec = historyEndSec;
            stateDirty = false;
            seriesDirty = false;
            return { ok: true, reason: "mutationPatch" };
          }
        }
      }

      if (
        tryHandleAppendMutation(tl, historyEndSec, {
          forceForecastRebuild: true,
        })
      ) {
        return { ok: true, reason: "appendPatch" };
      }
      if (
        tryHandleMutationHint(tl, historyEndSec, {
          forceForecastRebuild: true,
        })
      ) {
        return { ok: true, reason: "hintPatch" };
      }
      stateDirty = true;
      seriesDirty = true;
    }

    if (stateDirty || !graphCache) {
      return rebuildGraphCache();
    }

    if (seriesDirty) {
      return rebuildSeriesValues();
    }

    const historyEndSec = clampSec(tl.historyEndSec ?? 0);

    if (historyEndSec < lastKnownHistoryEndSec) {
      stateDirty = true;
      seriesDirty = true;
      return rebuildGraphCache();
    }

    if (historyEndSec > lastKnownHistoryEndSec) {
      const requiredStride = resolveHistoryStride(historyEndSec);
      if (requiredStride > historyStrideSecCur) {
        historyStrideSecCur = requiredStride;
        stateDirty = true;
        seriesDirty = true;
        return rebuildGraphCache();
      }
      const okHistory = extendHistoryTo(historyEndSec);
      if (!okHistory) return rebuildGraphCache();

      const okForecast = rebuildForecastAtFrontier({ invalidateValues: false });
      if (!okForecast) return rebuildGraphCache();

      lastKnownHistoryEndSec = historyEndSec;
    }

    return { ok: true };
  }

  function update() {
    if (!isActive) return;
    if (stateDirty || seriesDirty) {
      handleInvalidate("active");
      return;
    }

    const tl = getTimeline?.();
    if (!tl) return;

    const sigRes = projection.ensureSignature(tl);
    if (sigRes?.changed) {
      stateDirty = true;
      seriesDirty = true;
      invalidateSubjectValues();
      handleInvalidate("active");
      return;
    }

    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
    if (historyEndSec > lastKnownHistoryEndSec) {
      const requiredStride = resolveHistoryStride(historyEndSec);
      if (requiredStride > historyStrideSecCur) {
        historyStrideSecCur = requiredStride;
        stateDirty = true;
        seriesDirty = true;
        handleInvalidate("active");
        return;
      }
      const okHistory = extendHistoryTo(historyEndSec);
      if (!okHistory) {
        stateDirty = true;
        seriesDirty = true;
        handleInvalidate("active");
        return;
      }

      const okForecast = rebuildForecastAtFrontier({ invalidateValues: false });
      if (!okForecast) {
        stateDirty = true;
        seriesDirty = true;
        handleInvalidate("active");
        return;
      }

      lastKnownHistoryEndSec = historyEndSec;
    }
  }

  function ensureCache() {
    if (!graphCache || stateDirty || seriesDirty) {
      if (stateDirty) return rebuildGraphCache();
      if (seriesDirty) return rebuildSeriesValues();
    }
    return { ok: true };
  }

  function getData() {
    return {
      cache: graphCache,
      metric: metricDef,
      series: activeSeries,
      label: metricLabel,
      subjectKey,
      horizonSec: horizonSecCur,
      historyStrideSec: historyStrideSecCur,
      forecastStepSec: forecastStepSecCur,
      cacheVersion: graphCache?.version ?? cacheVersion,
      projectionCacheSize: projection.getSize?.(),
      projectionCacheCap: projection.maxEntries,
    };
  }

  function getSeriesValuesForSeconds(seconds) {
    const tl = getTimeline?.();
    if (!tl || !graphCache) return null;

    const seriesSig = getSeriesSignature(activeSeries);
    const cacheKey = subjectKey ?? "__global__";
    let entry = subjectValueCache.get(cacheKey);
    if (
      !entry ||
      entry.revision !== valuesRevision ||
      entry.seriesSig !== seriesSig
    ) {
      entry = {
        revision: valuesRevision,
        seriesSig,
        valuesBySec: new Map(),
        order: [],
      };
      subjectValueCache.set(cacheKey, entry);
    }

    const valuesBySec = entry.valuesBySec;
    const order = entry.order;
    for (const secRaw of seconds || []) {
      const sec = clampSec(secRaw);
      if (valuesBySec.has(sec)) continue;

      let stateData = graphCache.stateDataByBoundary?.get?.(sec);
      if (stateData == null) {
        const res = projection.ensureStateAtSecond(
          tl,
          sec,
          undefined,
          forecastStepSecCur
        );
        if (!res?.ok) {
          valuesBySec.set(sec, {});
          order.push(sec);
          continue;
        }
        stateData = res.stateData ?? null;
        if (stateData != null && graphCache.stateDataByBoundary) {
          graphCache.stateDataByBoundary.set(sec, stateData);
        }
      }

      const values = computeValuesFromStateData(
        stateData,
        activeSeries,
        subject
      );
      valuesBySec.set(sec, values);
      order.push(sec);
      if (order.length > SUBJECT_VALUE_CACHE_MAX) {
        const oldest = order.shift();
        if (oldest != null) valuesBySec.delete(oldest);
      }
    }

    return valuesBySec;
  }

  function getStateDataAt(tSec) {
    const tl = getTimeline?.();
    if (!tl) return null;
    const res = projection.ensureStateAtSecond(
      tl,
      tSec,
      undefined,
      forecastStepSecCur
    );
    if (!res.ok) return null;
    return res.stateData ?? null;
  }

  function getStateAt(tSec) {
    const stateData = getStateDataAt(tSec);
    if (stateData == null) return null;
    const state = deserializeGameState(stateData);
    canonicalizeSnapshot(state);
    return state;
  }

  function setMetric(nextMetric) {
    const nextDef = resolveMetricDef(nextMetric);
    if (nextDef === metricDef) return;
    metricDef = nextDef;
    subjectKey = resolveSubjectKey(metricDef, subject, subjectKey);
    seriesDirty = true;
  }

  function setSubject(nextSubject, nextKey) {
    subject = nextSubject ?? null;
    const resolved = resolveSubjectKey(metricDef, subject, nextKey);
    if (resolved === subjectKey) return;
    subjectKey = resolved;
    seriesDirty = true;
  }

  return {
    ensureCache,
    handleInvalidate,
    update,
    getData,
    getSeriesValuesForSeconds,
    getStateDataAt,
    getStateAt,
    setMetric,
    setSubject,
    setActive: (active) => {
      const next = !!active;
      if (next === isActive) return;
      isActive = next;
      if (isActive && (stateDirty || seriesDirty)) handleInvalidate("active");
    },
  };
}
