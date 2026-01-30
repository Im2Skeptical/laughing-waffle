// src/model/timegraph-controller.js
// Logic controller for time-series projections (e.g. gold graph).
// Owns the cache, invalidation policies, and incremental updates.
// No Pixi imports.

import {
  buildProjectionStateStepWindowFromTimeline,
  buildProjectionStateStepWindowFromStateData,
  buildProjectionStateWindowFromStateData,
  getStateAtSecond,
} from "./projection.js";

import { GRAPH_METRICS } from "./graph-metrics.js";
import { serializeGameState, deserializeGameState } from "./state.js";
import { canonicalizeSnapshot } from "./canonicalize.js";
import { BASE_PROJECTION_HORIZON_SEC } from "../defs/gamesettings/gamerules-defs.js";

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

function computeValuesFromStateData(stateData, series, subject, resolverFactory) {
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

  let resolver = null;
  if (typeof resolverFactory === "function") {
    resolver = resolverFactory(raw, subject);
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
      values[s.id] = safeNumber(s.getValueFromSnapshot(raw, subject, resolver));
    } else {
      values[s.id] = safeNumber(s.getValue(state, subject, resolver));
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

function collectHistorySampleSeconds(historyEndSec, strideSec) {
  const end = clampSec(historyEndSec);
  const stride = Math.max(1, Math.floor(strideSec ?? 1));
  const secs = [];
  for (let sec = 0; sec <= end; sec += stride) {
    secs.push(sec);
  }
  if (!secs.length || secs[secs.length - 1] !== end) {
    secs.push(end);
  }
  return secs;
}

function collectActionSecondsInRange(tl, startSec, endSec) {
  const start = clampSec(startSec);
  const end = clampSec(endSec);
  if (end < start) return [];

  const actionsBySec = tl?.actionsBySec;
  if (actionsBySec && typeof actionsBySec.keys === "function") {
    const secs = [];
    for (const key of actionsBySec.keys()) {
      const sec = clampSec(key);
      if (sec < start || sec > end) continue;
      secs.push(sec);
    }
    if (!secs.length) return [];
    return secs.sort((a, b) => a - b);
  }

  const acts = Array.isArray(tl?.actions) ? tl.actions : [];
  if (!acts.length) return [];
  const seen = new Set();
  for (const action of acts) {
    const sec = clampSec(action?.tSec ?? 0);
    if (sec < start || sec > end) continue;
    seen.add(sec);
  }
  if (!seen.size) return [];
  return Array.from(seen.values()).sort((a, b) => a - b);
}

function collectHistorySampleSecondsInRange(tl, startSec, endSec, strideSec) {
  const start = clampSec(startSec);
  const end = clampSec(endSec);
  if (end < start) return [];
  const stride = Math.max(1, Math.floor(strideSec ?? 1));
  const secs = [];
  for (let sec = start; sec <= end; sec += stride) {
    secs.push(sec);
  }
  if (!secs.length || secs[secs.length - 1] !== end) {
    secs.push(end);
  }
  const actionSecs = collectActionSecondsInRange(tl, start, end);
  if (!actionSecs.length) return secs;
  const merged = new Set(secs);
  for (const sec of actionSecs) merged.add(sec);
  merged.add(end);
  return Array.from(merged.values()).sort((a, b) => a - b);
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
  let windowDirty = true;
  let seriesDirty = true;
  let valuesDirty = true;
  let cacheVersion = 0;
  let valuesRevision = 0;

  const SUBJECT_VALUE_CACHE_MAX = 5000;
  const subjectValueCache = new Map();

  // Config (mutable locals; never assign to function parameters)
  let historyStrideSecCur = historyStrideSec;
  let forecastStepSecCur = forecastStepSec;
  let horizonSecCur = horizonSec;

  // Change detection
  let lastKnownHistoryEndSec = 0;

  const projection = projectionCache || getSharedProjectionCache();

  let seriesOverride = null;
  let labelOverride = null;

  function resolveActiveSeries(cursorState) {
    if (Array.isArray(seriesOverride) && seriesOverride.length) {
      return seriesOverride;
    }
    return resolveSeries(metricDef, subject, cursorState);
  }

  function resolveActiveLabel(cursorState) {
    if (typeof labelOverride === "string" && labelOverride.length) {
      return labelOverride;
    }
    return resolveLabel(metricDef, subject, cursorState);
  }

  function getResolverFactory() {
    return typeof metricDef?.createSnapshotResolver === "function"
      ? metricDef.createSnapshotResolver
      : null;
  }

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
      windowDirty = true;
      seriesDirty = true;
      valuesDirty = true;
      return { ok: false, reason: "no state" };
    }

    projection.ensureSignature(tl);
    historyStrideSecCur = clampStride(historyStrideSecCur, 5);
    forecastStepSecCur = clampStride(forecastStepSecCur, 5);
    horizonSecCur = clampStride(horizonSecCur, 1200);

    activeSeries = resolveActiveSeries(cs);
    metricLabel = resolveActiveLabel(cs);

    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
    historyStrideSecCur = Math.max(
      historyStrideSecCur,
      resolveHistoryStride(historyEndSec)
    );
    const resolverFactory =
      typeof metricDef?.createSnapshotResolver === "function"
        ? metricDef.createSnapshotResolver
        : null;

    const historySecs = collectHistorySampleSeconds(
      historyEndSec,
      historyStrideSecCur
    );
    const actionSecs = collectActionSecondsInRange(tl, 0, historyEndSec);
    const historySecSet = new Set(historySecs);
    for (const sec of actionSecs) historySecSet.add(sec);
    historySecSet.add(historyEndSec);
    const historySecList = Array.from(historySecSet.values()).sort(
      (a, b) => a - b
    );

    const history = [];
    const stateDataByBoundary = new Map();

    for (const sec of historySecList) {
      const res = projection.ensureStateAtSecond(
        tl,
        sec,
        undefined,
        forecastStepSecCur
      );
      if (!res.ok) return res;
      if (res.stateData != null) {
        stateDataByBoundary.set(sec, res.stateData);
      }
      history.push({
        tSec: sec,
        values: computeValuesFromStateData(
          res.stateData,
          activeSeries,
          subject,
          resolverFactory
        ),
      });
    }

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
        values: computeValuesFromStateData(
          res.stateData,
          activeSeries,
          subject,
          resolverFactory
        ),
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
    windowDirty = false;
    seriesDirty = false;
    valuesDirty = false;
    return { ok: true };
  }

  function rebuildSeriesValues() {
    const tl = getTimeline?.();
    const cs = getCursorState?.();
    if (!tl || !cs) {
      graphCache = null;
      stateDirty = true;
      windowDirty = true;
      seriesDirty = true;
      valuesDirty = true;
      return { ok: false, reason: "no state" };
    }

    activeSeries = resolveActiveSeries(cs);
    metricLabel = resolveActiveLabel(cs);

    if (!graphCache) {
      return rebuildGraphCache();
    }

    graphCache.series = activeSeries;
    graphCache.metricLabel = metricLabel;
    graphCache.metric = metricDef;
    graphCache.subjectKey = subjectKey;
    graphCache.version = ++cacheVersion;

    invalidateSubjectValues();
    seriesDirty = false;
    valuesDirty = false;
    return { ok: true };
  }

  function patchHistoryFromSecond(tl, startSec, endSec) {
    if (!graphCache || !tl) return false;

    const start = clampSec(startSec);
    const end = clampSec(endSec);
    if (end < start) return false;

    const history = Array.isArray(graphCache.history) ? graphCache.history : [];
    const stateDataByBoundary = graphCache.stateDataByBoundary;
    const resolverFactory = getResolverFactory();

    const existingIndex = new Map();
    for (let i = 0; i < history.length; i++) {
      existingIndex.set(clampSec(history[i]?.tSec ?? 0), i);
    }

    const sampleSecs = collectHistorySampleSecondsInRange(
      tl,
      start,
      end,
      historyStrideSecCur
    );

    let inserted = false;
    for (const sec of sampleSecs) {
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
        subject,
        resolverFactory
      );
      const idx = existingIndex.get(sec);
      if (idx != null) {
        history[idx].values = values;
      } else {
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
    const existingSecs = new Set(
      history.map((p) => clampSec(p?.tSec ?? 0))
    );

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
              values: computeValuesFromStateData(
                sd,
                activeSeries,
                subject,
                getResolverFactory()
              ),
            });
            existingSecs.add(sec);
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
            subject,
            getResolverFactory()
          ),
        });
        existingSecs.add(sec);
      }
    }

    const actionSecs = collectActionSecondsInRange(tl, oldMax + 1, target);
    let insertedExtra = false;
    for (const sec of actionSecs) {
      if (existingSecs.has(sec)) continue;
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
          subject,
          getResolverFactory()
        ),
      });
      existingSecs.add(sec);
      insertedExtra = true;
    }

    // Ensure the frontier point is sampled even when not stride-aligned.
    if (!existingSecs.has(target)) {
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
          subject,
          getResolverFactory()
        ),
      });
      existingSecs.add(target);
      insertedExtra = true;
    }

    if (insertedExtra) {
      history.sort((a, b) => (a.tSec ?? 0) - (b.tSec ?? 0));
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
            subject,
            getResolverFactory()
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
            subject,
            getResolverFactory()
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
            subject,
            getResolverFactory()
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
      windowDirty = true;
      seriesDirty = true;
      valuesDirty = true;
      return { ok: false, reason: "no state" };
    }

  if (!isActive && reason !== "open" && reason !== "active") {
      // Defer rebuilds while inactive, but ensure a full refresh on next open.
      stateDirty = true;
      windowDirty = true;
      valuesDirty = true;
      seriesDirty = true;
      return { ok: true, reason: "deferred" };
    }

    const sigRes = projection.ensureSignature(tl);
    const signatureChanged = !!sigRes?.changed;

    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
    const mutationSec = clampSec(tl._lastMutationSec ?? historyEndSec);

    if (
      !signatureChanged &&
      historyEndSec === lastKnownHistoryEndSec &&
      !stateDirty &&
      !windowDirty &&
      !seriesDirty &&
      !valuesDirty &&
      reason !== "open" &&
      reason !== "active"
    ) {
      return { ok: true, reason: "noChange" };
    }

    if (graphCache && !stateDirty && !windowDirty && reason && reason !== "active") {
      if (historyEndSec < lastKnownHistoryEndSec) {
        pruneHistoryAfterSec(historyEndSec);
        rebuildForecastAtFrontier({ forceRebuild: true });
        lastKnownHistoryEndSec = historyEndSec;
        return { ok: true, reason: "truncatePatch" };
      }

      const okHistory = patchHistoryFromSecond(tl, mutationSec, historyEndSec);
      if (okHistory) {
        const okForecast = rebuildForecastAtFrontier({ forceRebuild: true });
        if (!okForecast) return rebuildGraphCache();
        lastKnownHistoryEndSec = historyEndSec;
        stateDirty = false;
        windowDirty = false;
        seriesDirty = false;
        valuesDirty = false;
        return { ok: true, reason: "mutationPatch" };
      }
    }

    if (stateDirty || windowDirty || !graphCache) {
      return rebuildGraphCache();
    }

    if (seriesDirty) {
      return rebuildSeriesValues();
    }

    if (valuesDirty) {
      invalidateSubjectValues();
      valuesDirty = false;
      if (graphCache) {
        graphCache.subjectKey = subjectKey;
        graphCache.metricLabel = metricLabel;
        graphCache.version = ++cacheVersion;
      }
    }

    return { ok: true };
  }

  function update() {
    if (!isActive) return;
    if (stateDirty || windowDirty || seriesDirty || valuesDirty) {
      handleInvalidate("active");
      return;
    }

    const tl = getTimeline?.();
    if (!tl) return;

    const sigRes = projection.ensureSignature(tl);
    if (sigRes?.changed) {
      stateDirty = true;
      windowDirty = true;
      valuesDirty = true;
      handleInvalidate("active");
      return;
    }

    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
    if (historyEndSec < lastKnownHistoryEndSec) {
      pruneHistoryAfterSec(historyEndSec);
      rebuildForecastAtFrontier({ forceRebuild: true });
      lastKnownHistoryEndSec = historyEndSec;
      if (graphCache) graphCache.version = ++cacheVersion;
      return;
    }
    if (historyEndSec > lastKnownHistoryEndSec) {
      const requiredStride = resolveHistoryStride(historyEndSec);
      if (requiredStride > historyStrideSecCur) {
        historyStrideSecCur = requiredStride;
        windowDirty = true;
        handleInvalidate("active");
        return;
      }
      const okHistory = extendHistoryTo(historyEndSec);
      if (!okHistory) {
        stateDirty = true;
        handleInvalidate("active");
        return;
      }

      const okForecast = rebuildForecastAtFrontier({ invalidateValues: false });
      if (!okForecast) {
        stateDirty = true;
        handleInvalidate("active");
        return;
      }

      lastKnownHistoryEndSec = historyEndSec;
    }
  }

  function ensureCache() {
    if (!graphCache || stateDirty || windowDirty || seriesDirty) {
      if (stateDirty || windowDirty) return rebuildGraphCache();
      if (seriesDirty) return rebuildSeriesValues();
    }
    if (valuesDirty) {
      invalidateSubjectValues();
      valuesDirty = false;
      if (graphCache) {
        graphCache.subjectKey = subjectKey;
        graphCache.metricLabel = metricLabel;
        graphCache.version = ++cacheVersion;
      }
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
        subject,
        getResolverFactory()
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
    seriesOverride = null;
    labelOverride = null;
    subjectKey = resolveSubjectKey(metricDef, subject, subjectKey);
    seriesDirty = true;
    valuesDirty = true;
  }

  function setSubject(nextSubject, nextKey) {
    subject = nextSubject ?? null;
    const resolved = resolveSubjectKey(metricDef, subject, nextKey);
    if (resolved === subjectKey) return;
    subjectKey = resolved;
    const cs = getCursorState?.() ?? null;
    metricLabel = resolveActiveLabel(cs);
    valuesDirty = true;
  }

  function setSeries(nextSeries, nextLabel) {
    const normalized = ensureSeriesArray(nextSeries);
    const nextSig = getSeriesSignature(normalized);
    const curSig = getSeriesSignature(
      Array.isArray(seriesOverride) && seriesOverride.length
        ? seriesOverride
        : activeSeries
    );
    const label = typeof nextLabel === "string" ? nextLabel : null;

    if (nextSig === curSig && label === labelOverride) return;

    seriesOverride = normalized;
    labelOverride = label;
    activeSeries = normalized;
    if (label) metricLabel = label;
    seriesDirty = true;
    valuesDirty = true;
  }

  function invalidateSeries() {
    seriesDirty = true;
    valuesDirty = true;
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
    setSeries,
    invalidateSeries,
    setSubject,
    setActive: (active) => {
      const next = !!active;
      if (next === isActive) return;
      isActive = next;
      if (isActive && (stateDirty || windowDirty || seriesDirty || valuesDirty)) {
        handleInvalidate("active");
      }
    },
  };
}
