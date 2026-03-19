// src/model/timegraph/controller-core.js
// Logic controller for time-series projections (e.g. gold graph).
// Owns the cache, invalidation policies, and incremental updates.
// No Pixi imports.

import { GRAPH_METRICS } from "../graph-metrics.js";
import { buildProjectionStateStepWindowFromStateData } from "../projection.js";
import { deserializeGameState } from "../state.js";
import { canonicalizeSnapshot } from "../canonicalize.js";
import {
  getActionSecondsInRange,
  getStateDataAtSecond,
} from "../timeline/index.js";
import { BASE_PROJECTION_HORIZON_SEC } from "../../defs/gamesettings/gamerules-defs.js";
import {
  perfEnabled,
  perfNowMs,
  recordProjectionHistoryBuild,
  recordProjectionForecastBuild,
  recordTimegraphCacheHit,
  recordTimegraphCacheMiss,
} from "../perf.js";
import { getGlobalSkillModifier } from "../skills.js";
import { DEFAULT_FORECAST_STEP_SEC, MAX_HISTORY_POINTS } from "./constants.js";
import { clampSec } from "./utils.js";
import {
  alignForecastSampleSeconds,
  buildSampleSeconds,
  cacheSampleSeconds,
  collectActionSecondsForSampling,
  collectActionSecondsInRange,
  collectHistorySampleSeconds,
  collectHistorySampleSecondsInRange,
  getSamplingModeSignature,
  shouldCacheForecastSec,
} from "./sampling.js";
import {
  computeValuesFromStateData,
  ensureSeriesArray,
  getSeriesSignature,
  resolveLabel,
  resolveMetricDef,
  resolveSeries,
  resolveSubjectKey,
} from "./metric-helpers.js";
import { getSharedProjectionCache } from "./projection-cache.js";

function shouldSampleHistory(sec, frontierSec, strideSec) {
  if (sec === frontierSec) return true;
  return sec % strideSec === 0;
}

function cacheForecastStateData(stateDataByBoundary, sec, historyEndSec, stateData) {
  // Forecast state snapshots are owned by the shared projection cache.
  // Controllers should not duplicate serialized state data.
  return;
}

function purgePastStateData(stateDataByBoundary, historyEndSec) {
  return;
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function createTimeGraphController({
  getTimeline,
  getCursorState,
  metric = GRAPH_METRICS.gold,
  projectionCache,
  forecastWorkerService = null,

  // Stage 4: decouple plotting resolution from scrubbing resolution
  historyStrideSec = 1,
  forecastStepSec = DEFAULT_FORECAST_STEP_SEC,
  horizonSec = BASE_PROJECTION_HORIZON_SEC,
} = {}) {
  const ASYNC_FORECAST_STEP_SEC = 1;
  const ASYNC_FORECAST_REQUEST_POLL_MS = 250;
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
  const SUBJECT_VALUE_CACHE_COMPACT_THRESHOLD = 1024;
  const subjectValueCache = new Map();

  // Config (mutable locals; never assign to function parameters)
  let historyStrideSecCur = historyStrideSec;
  let forecastStepSecCur = forecastStepSec;
  let horizonSecCur = horizonSec;
  let horizonSecOverride = null;

  // Change detection
  let lastKnownHistoryEndSec = 0;

  const projection = projectionCache || getSharedProjectionCache();

  let seriesOverride = null;
  let labelOverride = null;
  let lastAsyncForecastPollMs = -Infinity;
  let lastAsyncForecastToken = null;
  let lastAsyncForecastHistoryEndSec = -1;
  let lastAsyncForecastDesiredEndSec = -1;
  let lastAsyncForecastCoverageEndSec = -1;

  function getTimelineToken(tl) {
    return projection.getTimelineToken?.(tl) ?? null;
  }

  function ensureProjectionStateAtSecond(tl, sec, dtStep, stepSec) {
    return projection.ensureStateAtSecond?.(tl, sec, dtStep, stepSec, {
      absorbPersistentKnowledge: false,
    }) ?? { ok: false, reason: "projectionUnavailable" };
  }

  function ensureProjectionForecastWindow(tl, targetEndSec, dtStep, stepSec) {
    return projection.ensureForecastWindow?.(tl, targetEndSec, dtStep, stepSec, {
      absorbPersistentKnowledge: false,
    }) ?? { ok: false, reason: "projectionUnavailable" };
  }

  function getAsyncForecastCoverageEndSec(tl) {
    const historyEndSec = clampSec(tl?.historyEndSec ?? 0);
    const meta = projection.getForecastAsyncMeta?.() ?? null;
    const timelineToken = getTimelineToken(tl);
    if (
      meta &&
      typeof timelineToken === "string" &&
      meta.forecastAsyncToken === timelineToken &&
      clampSec(meta.forecastAsyncStepSec) === ASYNC_FORECAST_STEP_SEC
    ) {
      return Math.max(historyEndSec, clampSec(meta.forecastAsyncEndSec));
    }
    return historyEndSec;
  }

  function buildScheduledActionsBySecond(tl, startSec, endSec) {
    const start = clampSec(startSec);
    const end = clampSec(endSec);
    if (!tl || end <= start) return [];
    const actionSecs = getActionSecondsInRange(tl, start + 1, end, {
      copy: false,
    });
    if (!Array.isArray(actionSecs) || !actionSecs.length) return [];

    const out = [];
    for (const sec of actionSecs) {
      const actions =
        tl.actionsBySec && typeof tl.actionsBySec.get === "function"
          ? tl.actionsBySec.get(sec)
          : null;
      if (!Array.isArray(actions) || !actions.length) continue;
      out.push({
        tSec: sec,
        actions: actions.map((action) => ({ ...action, tSec: sec })),
      });
    }
    return out;
  }

  function setForecastRuntimeState({
    coverageEndSec,
    pending,
    requestedEndSec,
  } = {}) {
    if (!graphCache?.window) return false;
    const nextCoverageEndSec = clampSec(coverageEndSec);
    const nextRequestedEndSec = clampSec(requestedEndSec);
    const nextPending = pending === true;
    const changed =
      clampSec(graphCache.window.forecastCoverageEndSec) !== nextCoverageEndSec ||
      clampSec(graphCache.window.forecastRequestedEndSec) !== nextRequestedEndSec ||
      graphCache.window.forecastPending !== nextPending;
    graphCache.window.forecastCoverageEndSec = nextCoverageEndSec;
    graphCache.window.forecastRequestedEndSec = nextRequestedEndSec;
    graphCache.window.forecastPending = nextPending;
    if (changed) {
      graphCache.version = ++cacheVersion;
      invalidateSubjectValues();
    }
    return changed;
  }

  function requestAsyncForecastCoverage(tl, { force = false } = {}) {
    if (!graphCache?.window || !forecastWorkerService) {
      setForecastRuntimeState({
        coverageEndSec: clampSec(tl?.historyEndSec ?? 0),
        requestedEndSec: clampSec(tl?.historyEndSec ?? 0),
        pending: false,
      });
      return null;
    }

    const historyEndSec = clampSec(tl?.historyEndSec ?? 0);
    const desiredEndSec = historyEndSec + clampSec(horizonSecCur ?? 0);
    const timelineToken = getTimelineToken(tl);
    if (typeof timelineToken !== "string") return null;
    const coverageEndSec = getAsyncForecastCoverageEndSec(tl);
    const requestedEndSec = Math.max(
      desiredEndSec,
      clampSec(graphCache.window.forecastRequestedEndSec ?? historyEndSec)
    );
    const pending = coverageEndSec < requestedEndSec;

    setForecastRuntimeState({
      coverageEndSec,
      requestedEndSec,
      pending,
    });
    if (!pending) {
      return {
        ok: true,
        coverageEndSec,
        requestedEndSec,
        pending: false,
      };
    }

    const currentMs = nowMs();
    const needsFreshPreparation =
      force ||
      timelineToken !== lastAsyncForecastToken ||
      historyEndSec !== lastAsyncForecastHistoryEndSec ||
      requestedEndSec !== lastAsyncForecastDesiredEndSec ||
      coverageEndSec !== lastAsyncForecastCoverageEndSec;
    if (
      !needsFreshPreparation &&
      currentMs - lastAsyncForecastPollMs < ASYNC_FORECAST_REQUEST_POLL_MS
    ) {
      return {
        ok: true,
        coverageEndSec,
        requestedEndSec,
        pending: true,
      };
    }
    lastAsyncForecastPollMs = currentMs;
    lastAsyncForecastToken = timelineToken;
    lastAsyncForecastHistoryEndSec = historyEndSec;
    lastAsyncForecastDesiredEndSec = requestedEndSec;
    lastAsyncForecastCoverageEndSec = coverageEndSec;

    const boundaryRes = getStateDataAtSecond(tl, historyEndSec);
    if (!boundaryRes?.ok || boundaryRes?.stateData == null) {
      return null;
    }

    const requestRes = forecastWorkerService.requestCoverage?.({
      projectionCache: projection,
      timeline: tl,
      timelineToken,
      historyEndSec,
      stepSec: ASYNC_FORECAST_STEP_SEC,
      desiredEndSec: requestedEndSec,
      boundaryStateData: boundaryRes.stateData,
      scheduledActionsBySecond: buildScheduledActionsBySecond(
        tl,
        historyEndSec,
        requestedEndSec
      ),
    });

    const nextCoverageEndSec =
      requestRes && Number.isFinite(requestRes.coverageEndSec)
        ? requestRes.coverageEndSec
        : getAsyncForecastCoverageEndSec(tl);
    const nextRequestedEndSec =
      requestRes && Number.isFinite(requestRes.requestedEndSec)
        ? requestRes.requestedEndSec
        : requestedEndSec;
    const nextPending = requestRes?.pending === true;

    setForecastRuntimeState({
      coverageEndSec: nextCoverageEndSec,
      requestedEndSec: nextRequestedEndSec,
      pending: nextPending,
    });
    return requestRes ?? null;
  }

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
    if (graphCache?.window) {
      graphCache.window.forecastValuesBySec = new Map();
      graphCache.window.forecastValuesMeta = null;
    }
  }

  function invalidateSubjectValuesFromSec(startSec) {
    const cutoff = clampSec(startSec);
    for (const entry of subjectValueCache.values()) {
      const valuesBySec = entry?.valuesBySec;
      const order = entry?.order;
      if (!(valuesBySec instanceof Map) || !Array.isArray(order)) continue;
      const rawHead = Number.isFinite(entry?.orderHead)
        ? Math.floor(entry.orderHead)
        : 0;
      const head = Math.max(0, Math.min(order.length, rawHead));
      for (const sec of valuesBySec.keys()) {
        if (clampSec(sec) >= cutoff) {
          valuesBySec.delete(sec);
        }
      }
      const nextOrder = [];
      for (let i = head; i < order.length; i++) {
        const sec = clampSec(order[i]);
        if (sec >= cutoff) continue;
        if (!valuesBySec.has(sec)) continue;
        nextOrder.push(sec);
      }
      entry.order = nextOrder;
      entry.orderHead = 0;
    }
  }

  function pushSubjectValueSec(entry, sec, valuesBySec) {
    if (!entry || !(valuesBySec instanceof Map)) return;
    if (!Array.isArray(entry.order)) entry.order = [];
    if (!Number.isFinite(entry.orderHead)) entry.orderHead = 0;

    let head = Math.max(0, Math.floor(entry.orderHead));
    if (head > entry.order.length) head = entry.order.length;
    entry.order.push(sec);

    while (entry.order.length - head > SUBJECT_VALUE_CACHE_MAX) {
      const oldest = entry.order[head];
      head += 1;
      if (oldest != null) valuesBySec.delete(oldest);
    }

    if (
      head >= SUBJECT_VALUE_CACHE_COMPACT_THRESHOLD &&
      head * 2 >= entry.order.length
    ) {
      entry.order = entry.order.slice(head);
      head = 0;
    }

    entry.orderHead = head;
  }

  function clampStride(v, fallback) {
    const n = Math.floor(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function resolveDynamicHorizonSec() {
    if (Number.isFinite(horizonSecOverride) && horizonSecOverride >= 0) {
      return Math.floor(horizonSecOverride);
    }
    const base = clampStride(horizonSec, 1200);
    const bonus = Math.floor(
      getGlobalSkillModifier(
        getCursorState?.() ?? null,
        "projectionHorizonBonusSec",
        0
      )
    );
    return clampStride(base + bonus, 1200);
  }

  function syncDynamicHorizon() {
    const next = resolveDynamicHorizonSec();
    if (next === horizonSecCur) return false;
    horizonSecCur = next;
    windowDirty = true;
    return true;
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
    syncDynamicHorizon();
    historyStrideSecCur = clampStride(historyStrideSecCur, 5);
    forecastStepSecCur = clampStride(forecastStepSecCur, 5);
    horizonSecCur = clampStride(horizonSecCur, 1200);

    activeSeries = resolveActiveSeries(cs);
    metricLabel = resolveActiveLabel(cs);

    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
    const baseSec = historyEndSec;
    const endSec = baseSec + horizonSecCur;

    graphCache = {
      history: [],
      historyEndSec,
      window: {
        baseSec,
        endSec,
        horizonSec: horizonSecCur,
        stepSec: forecastStepSecCur,
        forecast: [],
        forecastValuesBySec: new Map(),
        forecastValuesMeta: null,
        forecastCoverageEndSec: historyEndSec,
        forecastPending: false,
        forecastRequestedEndSec: historyEndSec,
      },
      stateDataByBoundary: new Map(),
      series: activeSeries,
      metricLabel,
      metric: metricDef,
      subjectKey,
      sampleCache: new Map(),
      version: ++cacheVersion,
    };
    invalidateSubjectValues();

    lastKnownHistoryEndSec = historyEndSec;

    stateDirty = false;
    windowDirty = false;
    seriesDirty = false;
    valuesDirty = false;
    requestAsyncForecastCoverage(tl, { force: true });
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
    if (graphCache.sampleCache) graphCache.sampleCache.clear();
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
    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
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
      const res = ensureProjectionStateAtSecond(tl, sec, undefined, forecastStepSecCur);
      if (!res.ok) return false;
      cacheForecastStateData(
        stateDataByBoundary,
        sec,
        historyEndSec,
        res.stateData
      );
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
      purgePastStateData(graphCache.stateDataByBoundary, limit);
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
      let startData = null;
      if (graphCache.stateDataByBoundary?.has?.(startSec)) {
        recordTimegraphCacheHit();
        startData = graphCache.stateDataByBoundary.get(startSec);
      } else {
        recordTimegraphCacheMiss();
      }
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
            cacheForecastStateData(
              graphCache.stateDataByBoundary,
              sec,
              target,
              sd
            );
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
        const res = ensureProjectionStateAtSecond(tl, sec, undefined, forecastStepSecCur);
        if (!res.ok) return false;
        cacheForecastStateData(
          graphCache.stateDataByBoundary,
          sec,
          target,
          res.stateData
        );
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
      const res = ensureProjectionStateAtSecond(tl, sec, undefined, forecastStepSecCur);
      if (!res.ok) return false;
      cacheForecastStateData(
        graphCache.stateDataByBoundary,
        sec,
        target,
        res.stateData
      );
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
      const res = ensureProjectionStateAtSecond(tl, target, undefined, forecastStepSecCur);
      if (!res.ok) return false;
      cacheForecastStateData(
        graphCache.stateDataByBoundary,
        target,
        target,
        res.stateData
      );
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
    purgePastStateData(graphCache.stateDataByBoundary, target);
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
    purgePastStateData(graphCache.stateDataByBoundary, baseSec);

    if (horizonSecCur > 0) {
      const forecastRes = ensureProjectionForecastWindow(
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
        const res = ensureProjectionStateAtSecond(tl, sec, undefined, forecastStepSecCur);
        if (!res.ok) return false;
        cacheForecastStateData(
          graphCache.stateDataByBoundary,
          sec,
          baseSec,
          res.stateData
        );
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
        const res = ensureProjectionStateAtSecond(tl, baseSec, undefined, forecastStepSecCur);
        if (!res.ok) return false;
        cacheForecastStateData(
          graphCache.stateDataByBoundary,
          baseSec,
          baseSec,
          res.stateData
        );
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
        const res = ensureProjectionStateAtSecond(tl, sec, undefined, forecastStepSecCur);
        if (!res.ok) return false;
        cacheForecastStateData(
          graphCache.stateDataByBoundary,
          sec,
          baseSec,
          res.stateData
        );
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
      forecastValuesBySec: new Map(),
      forecastValuesMeta: null,
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

    syncDynamicHorizon();

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
    const mutationSec = clampSec(tl?._lastMutationSec ?? historyEndSec);
    const mutationKind = tl?._lastMutationKind ?? null;
    const isPlannerCommitReason =
      typeof reason === "string" && reason.startsWith("plannerCommit");
    const isPlannerReplacePatch =
      isPlannerCommitReason &&
      mutationKind === "replaceActionsAtSec" &&
      mutationSec >= Math.max(0, historyEndSec - 1) &&
      graphCache;
    const isCurrentSecondReplacePatch =
      reason === "actionDispatchedCurrentSec" &&
      mutationKind === "replaceActionsAtSec" &&
      mutationSec >= Math.max(0, historyEndSec - 1) &&
      graphCache;

    if (
      !signatureChanged &&
      historyEndSec === lastKnownHistoryEndSec &&
      !stateDirty &&
      !windowDirty &&
      !seriesDirty &&
      !valuesDirty &&
      !isPlannerCommitReason &&
      reason !== "open" &&
      reason !== "active"
    ) {
      return { ok: true, reason: "noChange" };
    }

    if (isPlannerReplacePatch || isCurrentSecondReplacePatch) {
      // Defensive path: planner commits replace actions in-place at current sec.
      // Even if signature detection misses a corner case, force targeted cache
      // invalidation so scrub/preview reads cannot stay stale.
      invalidateSubjectValuesFromSec(mutationSec);
      graphCache.historyEndSec = historyEndSec;
      if (graphCache.window) {
        graphCache.window.baseSec = historyEndSec;
        graphCache.window.endSec = historyEndSec + horizonSecCur;
        graphCache.window.forecastValuesBySec = new Map();
        graphCache.window.forecastValuesMeta = null;
      }
      if (graphCache.stateDataByBoundary) {
        graphCache.stateDataByBoundary.clear();
      }
      if (graphCache.sampleCache && tl?._lastMutationChangedActionSeconds) {
        graphCache.sampleCache.clear();
      }
      graphCache.version = ++cacheVersion;
      lastKnownHistoryEndSec = historyEndSec;
      stateDirty = false;
      windowDirty = false;
      seriesDirty = false;
      valuesDirty = false;
      return {
        ok: true,
        reason: isCurrentSecondReplacePatch
          ? "currentSecondReplaceActionPatch"
          : "replaceActionPatch",
      };
    }

    if (signatureChanged) {
      const isActionAppendPatch =
        reason === "actionDispatched" &&
        mutationKind === "appendAction" &&
        mutationSec >= Math.max(0, historyEndSec - 1) &&
        graphCache;
      if (isActionAppendPatch || isPlannerReplacePatch || isCurrentSecondReplacePatch) {
        // Preserve most cached values; only invalidate from mutation frontier.
        invalidateSubjectValuesFromSec(mutationSec);
        graphCache.historyEndSec = historyEndSec;
        if (graphCache.window) {
          graphCache.window.baseSec = historyEndSec;
          graphCache.window.endSec = historyEndSec + horizonSecCur;
          graphCache.window.forecastValuesBySec = new Map();
          graphCache.window.forecastValuesMeta = null;
        }
        if (graphCache.stateDataByBoundary) {
          graphCache.stateDataByBoundary.clear();
        }
        if (graphCache.sampleCache && tl?._lastMutationChangedActionSeconds) {
          graphCache.sampleCache.clear();
        }
        graphCache.version = ++cacheVersion;
        lastKnownHistoryEndSec = historyEndSec;
        stateDirty = false;
        windowDirty = false;
        seriesDirty = false;
        valuesDirty = false;
        return {
          ok: true,
          reason: isCurrentSecondReplacePatch
            ? "currentSecondReplaceActionPatch"
            : isPlannerReplacePatch
            ? "replaceActionPatch"
            : "appendActionPatch",
        };
      }
      stateDirty = true;
      windowDirty = true;
    }
    if (!signatureChanged && historyEndSec !== lastKnownHistoryEndSec) {
      lastKnownHistoryEndSec = historyEndSec;
      if (graphCache) {
        graphCache.historyEndSec = historyEndSec;
        if (graphCache.window) {
          graphCache.window.baseSec = historyEndSec;
          graphCache.window.endSec = historyEndSec + horizonSecCur;
          graphCache.window.forecastValuesBySec = new Map();
          graphCache.window.forecastValuesMeta = null;
        }
      }
      return { ok: true, reason: "frontierAdvance" };
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
    syncDynamicHorizon();
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
    if (historyEndSec !== lastKnownHistoryEndSec) {
      lastKnownHistoryEndSec = historyEndSec;
      if (graphCache) {
        graphCache.historyEndSec = historyEndSec;
        if (graphCache.window) {
          graphCache.window.baseSec = historyEndSec;
          graphCache.window.endSec = historyEndSec + horizonSecCur;
        }
        graphCache.version = ++cacheVersion;
      }
    }
    requestAsyncForecastCoverage(tl);
  }

  function ensureCache() {
    syncDynamicHorizon();
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
    const tl = getTimeline?.();
    if (tl) {
      const coverageEndSec = getAsyncForecastCoverageEndSec(tl);
      setForecastRuntimeState({
        coverageEndSec,
        requestedEndSec:
          graphCache?.window?.forecastRequestedEndSec ?? clampSec(tl.historyEndSec ?? 0),
        pending: graphCache?.window?.forecastPending === true,
      });
    }
    return {
      cache: graphCache,
      metric: metricDef,
      series: activeSeries,
      label: metricLabel,
      subjectKey,
      horizonSec: horizonSecCur,
      historyStrideSec: historyStrideSecCur,
      forecastStepSec: forecastStepSecCur,
      forecastCoverageEndSec:
        graphCache?.window?.forecastCoverageEndSec ?? null,
      forecastPending: graphCache?.window?.forecastPending === true,
      forecastRequestedEndSec:
        graphCache?.window?.forecastRequestedEndSec ?? null,
      cacheVersion: graphCache?.version ?? cacheVersion,
      projectionCacheSize: projection.getSize?.(),
      projectionCacheCap: projection.maxEntries,
      projectionCacheApproxBytes: projection.getApproxBytes?.(),
      projectionCacheMaxBytes: projection.maxBytes,
    };
  }

  function getSamplesForWindow({
    startSec,
    endSec,
    focus = false,
    cursorSec = null,
  } = {}) {
    const tl = getTimeline?.();
    if (!tl) return { ok: false, reason: "noTimeline" };
    if (!graphCache || stateDirty || windowDirty || seriesDirty) {
      const res = ensureCache();
      if (!res?.ok) return res || { ok: false, reason: "cacheMissing" };
    }

    const start = clampSec(startSec);
    const end = clampSec(endSec);
    if (end < start) return { ok: true, points: [], seconds: [] };

    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
    const actionSecs = collectActionSecondsForSampling(tl, start, end, {
      focus: !!focus,
      cursorSec,
    });
    const actionSecondsVersion = Math.floor(tl?._actionSecondsVersion ?? 0);
    const samplingSig = getSamplingModeSignature(!!focus, end - start);
    const metricId = metricDef?.id ?? metricDef?.label ?? "metric";
    const subjectKeyTag = subjectKey ?? "__global__";
    const cacheKey =
      `${metricId}|${subjectKeyTag}|${samplingSig}|` +
      `${start}:${end}|${historyEndSec}|a${actionSecondsVersion}`;

    let sampleSecs = graphCache.sampleCache?.get(cacheKey) ?? null;
    if (!sampleSecs) {
      sampleSecs = buildSampleSeconds({
        startSec: start,
        endSec: end,
        historyEndSec,
        cursorSec,
        actionSecs,
        focus: !!focus,
      });
      if (!focus && forecastStepSecCur > 1) {
        sampleSecs = alignForecastSampleSeconds(
          sampleSecs,
          historyEndSec,
          forecastStepSecCur,
          end
        );
      }
      cacheSampleSeconds(graphCache.sampleCache, cacheKey, sampleSecs);
    }

    let valuesBySec = new Map();
    if (perfEnabled()) {
      const historySecs = sampleSecs.filter((sec) => sec <= historyEndSec);
      const forecastSecs = sampleSecs.filter((sec) => sec > historyEndSec);

      const historyStart = perfNowMs();
      const historyValues =
        getSeriesValuesForSeconds(historySecs, {
          focus: !!focus,
          allowSyncForecast: false,
        }) ?? new Map();
      recordProjectionHistoryBuild({
        ms: perfNowMs() - historyStart,
        points: historySecs.length,
      });

      const forecastStart = perfNowMs();
      const forecastValues =
        getSeriesValuesForSeconds(forecastSecs, {
          focus: !!focus,
          allowSyncForecast: false,
        }) ?? new Map();
      recordProjectionForecastBuild({
        ms: perfNowMs() - forecastStart,
        points: forecastSecs.length,
      });

      valuesBySec = new Map([...historyValues, ...forecastValues]);
    } else {
      valuesBySec =
        getSeriesValuesForSeconds(sampleSecs, {
          focus: !!focus,
          allowSyncForecast: false,
        }) ?? new Map();
    }

    const points = sampleSecs.map((sec) => ({
      tSec: sec,
      pending: sec > historyEndSec && !valuesBySec.has(sec),
      values: valuesBySec.get(sec) ?? null,
    }));

    return { ok: true, points, seconds: sampleSecs, samplingSig };
  }

  function ensureGraphForecastValues(
    tl,
    seconds,
    historyEndSec,
    seriesSig
  ) {
    if (!graphCache?.window) return null;

    const requested = Array.from(
      new Set(
        (seconds || [])
          .map((sec) => clampSec(sec))
          .filter((sec) => sec > historyEndSec)
      ).values()
    ).sort((a, b) => a - b);
    if (!requested.length) return null;

    const baseSec = clampSec(historyEndSec);
    const stepSec = ASYNC_FORECAST_STEP_SEC;
    const maxSec = requested[requested.length - 1];
    const resolverFactory = getResolverFactory();
    const key = subjectKey ?? "__global__";
    const meta = graphCache.window.forecastValuesMeta;
    const coverageEndSec = getAsyncForecastCoverageEndSec(tl);

    const canReuse =
      meta &&
      meta.baseSec === baseSec &&
      meta.historyEndSec === baseSec &&
      meta.stepSec === stepSec &&
      meta.seriesSig === seriesSig &&
      meta.subjectKey === key &&
      meta.valuesRevision === valuesRevision &&
      meta.endSec >= maxSec &&
      graphCache.window.forecastValuesBySec instanceof Map;

    if (!canReuse) {
      graphCache.window.forecastValuesBySec = new Map();
      graphCache.window.forecastValuesMeta = {
        baseSec,
        historyEndSec: baseSec,
        endSec: coverageEndSec,
        stepSec,
        seriesSig,
        subjectKey: key,
        valuesRevision,
      };
    }

    const valuesBySec = graphCache.window.forecastValuesBySec;
    for (const sec of requested) {
      if (sec > coverageEndSec) continue;
      if (valuesBySec.has(sec)) continue;
      const sigRes = projection.ensureSignature?.(tl);
      const stateData =
        sigRes?.changed === true ? null : projection.getStateData?.(sec) ?? null;
      if (stateData == null) continue;
      const values = computeValuesFromStateData(
        stateData,
        activeSeries,
        subject,
        resolverFactory
      );
      valuesBySec.set(sec, values);
    }
    if (graphCache.window.forecastValuesMeta) {
      graphCache.window.forecastValuesMeta.endSec = coverageEndSec;
    }

    return graphCache.window.forecastValuesBySec;
  }

  function getSeriesValuesForSeconds(
    seconds,
    { focus = false, allowSyncForecast = focus } = {}
  ) {
    const tl = getTimeline?.();
    if (!tl || !graphCache) return null;
    const historyEndSec = clampSec(tl.historyEndSec ?? 0);

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
        orderHead: 0,
      };
      subjectValueCache.set(cacheKey, entry);
    }

    const valuesBySec = entry.valuesBySec;
    const fastForecastValues = ensureGraphForecastValues(
      tl,
      seconds,
      historyEndSec,
      seriesSig
    );
    const resolverFactory = getResolverFactory();
    for (const secRaw of seconds || []) {
      const sec = clampSec(secRaw);
      if (valuesBySec.has(sec)) continue;

      if (
        sec > historyEndSec &&
        fastForecastValues instanceof Map &&
        fastForecastValues.has(sec)
      ) {
        valuesBySec.set(sec, fastForecastValues.get(sec) ?? {});
        pushSubjectValueSec(entry, sec, valuesBySec);
        continue;
      }

      let stateData = null;
      if (shouldCacheForecastSec(sec, historyEndSec)) {
        // Guard direct projection-cache reads behind signature refresh so
        // stale forecast snapshots cannot survive timeline edits.
        const sigRes = projection.ensureSignature?.(tl);
        const cachedProjectionData =
          sigRes?.changed === true ? null : projection.getStateData?.(sec) ?? null;
        if (cachedProjectionData != null) {
          recordTimegraphCacheHit();
          stateData = cachedProjectionData;
        } else {
          recordTimegraphCacheMiss();
        }
      }
      if (stateData == null) {
        if (sec > historyEndSec && allowSyncForecast !== true) {
          continue;
        }
        const res = ensureProjectionStateAtSecond(tl, sec, undefined, forecastStepSecCur);
        if (!res?.ok) {
          continue;
        }
        stateData = res.stateData ?? null;
      }

      const values = computeValuesFromStateData(
        stateData,
        activeSeries,
        subject,
        resolverFactory
      );
      valuesBySec.set(sec, values);
      pushSubjectValueSec(entry, sec, valuesBySec);
    }

    return valuesBySec;
  }

  function getStateDataAt(tSec) {
    const tl = getTimeline?.();
    if (!tl) return null;
    const sec = clampSec(tSec);
    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
    if (shouldCacheForecastSec(sec, historyEndSec)) {
      // Guard direct projection-cache reads behind signature refresh so
      // stale forecast snapshots cannot survive timeline edits.
      const sigRes = projection.ensureSignature?.(tl);
      const cachedProjectionData =
        sigRes?.changed === true ? null : projection.getStateData?.(sec) ?? null;
      if (cachedProjectionData != null) {
        recordTimegraphCacheHit();
        return cachedProjectionData;
      }
      recordTimegraphCacheMiss();
      const res = ensureProjectionStateAtSecond(
        tl,
        sec,
        undefined,
        forecastStepSecCur
      );
      if (!res.ok) return null;
      return res.stateData ?? null;
    }
    const res = ensureProjectionStateAtSecond(tl, sec, undefined, forecastStepSecCur);
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

  function setHorizonSecOverride(nextHorizonSec) {
    const normalized =
      Number.isFinite(nextHorizonSec) && nextHorizonSec >= 0
        ? Math.floor(nextHorizonSec)
        : null;
    if (normalized === horizonSecOverride) return;
    horizonSecOverride = normalized;
    const changed = syncDynamicHorizon();
    if (!changed) return;
    windowDirty = true;
    if (isActive) {
      handleInvalidate("active");
    }
  }

  return {
    ensureCache,
    handleInvalidate,
    update,
    getData,
    getSamplesForWindow,
    getSeriesValuesForSeconds,
    getStateDataAt,
    getStateAt,
    setMetric,
    setSeries,
    invalidateSeries,
    setSubject,
    setHorizonSecOverride,
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
