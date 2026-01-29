// src/model/timegraph-controller.js
// Logic controller for time-series projections (e.g. gold graph).
// Owns the cache, invalidation policies, and incremental updates.
// No Pixi imports.

import {
  buildProjectionStateWindowFromTimeline,
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
  const state = deserializeGameState(stateData);
  canonicalizeSnapshot(state);

  const values = {};
  for (const s of series) {
    if (!s || typeof s.getValue !== "function") continue;
    values[s.id] = safeNumber(s.getValue(state, subject));
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
  const stateDataBySecond = new Map();

  const limit = Number.isFinite(maxEntries)
    ? Math.max(256, Math.floor(maxEntries))
    : DEFAULT_PROJECTION_CACHE_MAX_SECS;

  function reset(nextSignature) {
    signature = nextSignature || null;
    forecastBaseSec = 0;
    forecastEndSec = 0;
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

  function ensureForecastWindow(tl, targetEndSec, dtStep) {
    if (!tl) return { ok: false, reason: "noTimeline" };
    ensureSignature(tl);

    const baseSec = clampSec(tl.maxReachedSec ?? 0);
    const target = clampSec(targetEndSec);

    if (target <= baseSec) {
      forecastBaseSec = baseSec;
      forecastEndSec = baseSec;
      return { ok: true };
    }

    if (
      forecastBaseSec === baseSec &&
      forecastEndSec >= target &&
      stateDataBySecond.size > 0
    ) {
      return { ok: true };
    }

    const horizonSec = Math.max(0, target - baseSec);
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

    if (forecastBaseSec === baseSec && forecastEndSec < target) {
      const tailData = stateDataBySecond.get(forecastEndSec);
      if (tailData != null) {
        const extend = buildProjectionStateWindowFromStateData(
          tailData,
          forecastEndSec,
          { horizonSec: target - forecastEndSec, dtStep }
        );
        if (!extend.ok) return extend;
        for (const [sec, sd] of extend.stateDataBySecond.entries()) {
          set(sec, sd);
        }
        forecastEndSec = extend.window.endSec;
        return { ok: true };
      }
    }

    if (
      baseSec > forecastBaseSec &&
      baseSec <= forecastEndSec &&
      stateDataBySecond.has(baseSec)
    ) {
      // Shift the window forward: reuse existing points, extend only the tail.
      forecastBaseSec = baseSec;
      if (forecastEndSec < target) {
        const tailData = stateDataBySecond.get(forecastEndSec);
        if (tailData != null) {
          const extend = buildProjectionStateWindowFromStateData(
            tailData,
            forecastEndSec,
            { horizonSec: target - forecastEndSec, dtStep }
          );
          if (!extend.ok) return extend;
          for (const [sec, sd] of extend.stateDataBySecond.entries()) {
            set(sec, sd);
          }
          forecastEndSec = extend.window.endSec;
        }
      }
      if (forecastEndSec < target) {
        // Tail missing; fall back to rebuild.
        forecastBaseSec = baseSec;
        forecastEndSec = baseSec;
      } else {
        return { ok: true };
      }
    }

    const winRes = buildProjectionStateWindowFromTimeline(tl, baseSec, {
      horizonSec,
      dtStep,
    });
    if (!winRes.ok) return winRes;

    for (const [sec, sd] of winRes.stateDataBySecond.entries()) {
      set(sec, sd);
    }

    forecastBaseSec = baseSec;
    forecastEndSec = winRes.window.endSec;

    return { ok: true };
  }

  function ensureStateAtSecond(tl, sec, dtStep) {
    if (!tl) return { ok: false, reason: "noTimeline" };

    ensureSignature(tl);

    const t = clampSec(sec);
    const cached = touch(t);
    if (cached != null) return { ok: true, stateData: cached };

    const maxReached = clampSec(tl.maxReachedSec ?? 0);

    if (t <= maxReached) {
      const rebuilt = getStateAtSecond(tl, t);
      if (!rebuilt.ok) {
        return { ok: false, reason: rebuilt.reason || "rebuildFailed" };
      }
      const sd = serializeGameState(rebuilt.state);
      set(t, sd);
      return { ok: true, stateData: sd };
    }

    const forecastRes = ensureForecastWindow(tl, t, dtStep);
    if (!forecastRes.ok) return forecastRes;

    const forecastData = touch(t);
    if (forecastData != null) return { ok: true, stateData: forecastData };

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
  let dirty = true;

  // Config (mutable locals; never assign to function parameters)
  let historyStrideSecCur = historyStrideSec;
  let forecastStepSecCur = forecastStepSec;
  let horizonSecCur = horizonSec;

  // Change detection
  let lastKnownMaxReachedSec = 0;

  const projection = projectionCache || getSharedProjectionCache();

  function clampStride(v, fallback) {
    const n = Math.floor(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function rebuildGraphCache() {
    const tl = getTimeline?.();
    const cs = getCursorState?.();
    if (!tl || !cs) {
      graphCache = null;
      dirty = true;
      return { ok: false, reason: "no state" };
    }

    const sigRes = projection.ensureSignature(tl);

    historyStrideSecCur = clampStride(historyStrideSecCur, 5);
    forecastStepSecCur = clampStride(forecastStepSecCur, 5);
    horizonSecCur = clampStride(horizonSecCur, 1200);

    activeSeries = resolveSeries(metricDef, subject, cs);
    metricLabel = resolveLabel(metricDef, subject, cs);

    const maxReachedSec = clampSec(tl.maxReachedSec ?? 0);
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

    const baseSec = maxReachedSec;
    const endSec = baseSec + horizonSecCur;

    if (horizonSecCur > 0) {
      const forecastRes = projection.ensureForecastWindow(tl, endSec);
      if (!forecastRes.ok) return forecastRes;
    }

    const forecast = [];
    const steps = Math.floor(horizonSecCur / forecastStepSecCur);
    for (let i = 0; i <= steps; i++) {
      const sec = baseSec + i * forecastStepSecCur;
      const res = projection.ensureStateAtSecond(tl, sec);
      if (!res.ok) return res;
      forecast.push({
        tSec: sec,
        values: computeValuesFromStateData(res.stateData, activeSeries, subject),
      });
    }

    graphCache = {
      history,
      maxReachedSec,
      window: {
        baseSec,
        endSec,
        horizonSec: horizonSecCur,
        stepSec: forecastStepSecCur,
        forecast,
      },
      series: activeSeries,
      metricLabel,
      metric: metricDef,
      subjectKey,
    };

    lastKnownMaxReachedSec = maxReachedSec;

    dirty = false;
    return { ok: true };
  }

  function extendHistoryTo(newMaxReachedSec) {
    const tl = getTimeline?.();
    if (!graphCache || !tl) return false;

    const oldMax = clampSec(graphCache.maxReachedSec ?? 0);
    const target = clampSec(newMaxReachedSec ?? 0);
    if (target <= oldMax) return true;

    for (let sec = oldMax + 1; sec <= target; sec++) {
      if (!shouldSampleHistory(sec, target, historyStrideSecCur)) continue;
      const res = projection.ensureStateAtSecond(tl, sec);
      if (!res.ok) return false;
      graphCache.history.push({
        tSec: sec,
        values: computeValuesFromStateData(res.stateData, activeSeries, subject),
      });
    }

    graphCache.maxReachedSec = target;
    return true;
  }

  function rebuildForecastAtFrontier() {
    const tl = getTimeline?.();
    if (!graphCache || !tl) return false;

    const baseSec = clampSec(tl.maxReachedSec ?? 0);
    const endSec = baseSec + horizonSecCur;
    const steps = Math.floor(horizonSecCur / forecastStepSecCur);
    const lastForecastSec = baseSec + steps * forecastStepSecCur;

    if (horizonSecCur > 0) {
      const forecastRes = projection.ensureForecastWindow(tl, endSec);
      if (!forecastRes.ok) return false;
    }

    let forecast = [];
    const prevWindow = graphCache.window;
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

    if (!forecast.length) {
      for (let i = 0; i <= steps; i++) {
        const sec = baseSec + i * forecastStepSecCur;
        const res = projection.ensureStateAtSecond(tl, sec);
        if (!res.ok) return false;
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
        const res = projection.ensureStateAtSecond(tl, baseSec);
        if (!res.ok) return false;
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
        const res = projection.ensureStateAtSecond(tl, sec);
        if (!res.ok) return false;
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

    return true;
  }

  function handleInvalidate(reason) {
    const tl = getTimeline?.();
    const cs = getCursorState?.();
    if (!tl || !cs) {
      graphCache = null;
      dirty = true;
      return { ok: false, reason: "no state" };
    }

    if (!isActive && reason !== "open" && reason !== "active") {
      dirty = true;
      return { ok: true, reason: "deferred" };
    }

    const sigRes = projection.ensureSignature(tl);
    if (sigRes?.changed) {
      dirty = true;
    }

    if (dirty || !graphCache) {
      return rebuildGraphCache();
    }

    const maxReachedSec = clampSec(tl.maxReachedSec ?? 0);

    if (maxReachedSec < lastKnownMaxReachedSec) {
      dirty = true;
      return rebuildGraphCache();
    }

    if (maxReachedSec > lastKnownMaxReachedSec) {
      const okHistory = extendHistoryTo(maxReachedSec);
      if (!okHistory) return rebuildGraphCache();

      const okForecast = rebuildForecastAtFrontier();
      if (!okForecast) return rebuildGraphCache();

      lastKnownMaxReachedSec = maxReachedSec;
    }

    return { ok: true };
  }

  function update() {
    if (!isActive) return;
    if (dirty) {
      handleInvalidate("active");
      return;
    }

    const tl = getTimeline?.();
    if (!tl) return;

    const sigRes = projection.ensureSignature(tl);
    if (sigRes?.changed) {
      dirty = true;
      handleInvalidate("active");
      return;
    }

    const maxReachedSec = clampSec(tl.maxReachedSec ?? 0);
    if (maxReachedSec > lastKnownMaxReachedSec) {
      const okHistory = extendHistoryTo(maxReachedSec);
      if (!okHistory) {
        dirty = true;
        handleInvalidate("active");
        return;
      }

      const okForecast = rebuildForecastAtFrontier();
      if (!okForecast) {
        dirty = true;
        handleInvalidate("active");
        return;
      }

      lastKnownMaxReachedSec = maxReachedSec;
    }
  }

  function ensureCache() {
    if (!graphCache || dirty) return rebuildGraphCache();
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
      projectionCacheSize: projection.getSize?.(),
      projectionCacheCap: projection.maxEntries,
    };
  }

  function getStateDataAt(tSec) {
    const tl = getTimeline?.();
    if (!tl) return null;
    const res = projection.ensureStateAtSecond(tl, tSec);
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
    metricDef = resolveMetricDef(nextMetric);
    subjectKey = resolveSubjectKey(metricDef, subject, subjectKey);
    dirty = true;
  }

  function setSubject(nextSubject, nextKey) {
    subject = nextSubject ?? null;
    subjectKey = resolveSubjectKey(metricDef, subject, nextKey);
    dirty = true;
  }

  return {
    ensureCache,
    handleInvalidate,
    update,
    getData,
    getStateDataAt,
    getStateAt,
    setMetric,
    setSubject,
    setActive: (active) => {
      const next = !!active;
      if (next === isActive) return;
      isActive = next;
      if (isActive && dirty) handleInvalidate("active");
    },
  };
}
