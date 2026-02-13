// src/model/timegraph-controller.js
// Logic controller for time-series projections (e.g. gold graph).
// Owns the cache, invalidation policies, and incremental updates.
// No Pixi imports.

import {
  buildProjectionStateStepWindowFromTimeline,
  buildProjectionStateStepWindowFromStateData,
  buildProjectionStateWindowFromStateData,
} from "./projection.js";

import { GRAPH_METRICS } from "./graph-metrics.js";
import { deserializeGameState } from "./state.js";
import { canonicalizeSnapshot } from "./canonicalize.js";
import { BASE_PROJECTION_HORIZON_SEC } from "../defs/gamesettings/gamerules-defs.js";
import {
  getActionSecondsInRange,
  getActionSecondsInRangeSampled,
  getStateDataAtSecond,
} from "./timeline.js";
import {
  perfEnabled,
  perfNowMs,
  recordProjectionHistoryBuild,
  recordProjectionForecastBuild,
  recordTimegraphCacheHit,
  recordTimegraphCacheMiss,
} from "./perf.js";
import { computeGlobalSkillMods } from "./skills.js";

const DEFAULT_PROJECTION_CACHE_MAX_BYTES = 48 * 1024 * 1024;
const DEFAULT_STATE_DATA_ESTIMATE_BYTES = 32 * 1024;
const DEFAULT_FORECAST_STEP_SEC = 5;
const MAX_HISTORY_POINTS = 2000;
const NORMAL_SAMPLE_TARGET = 320;
const NORMAL_SAMPLE_MIN = 250;
const NORMAL_SAMPLE_MAX = 400;
const FOCUS_SAMPLE_TARGET = 1200;
const FOCUS_SAMPLE_MIN = 900;
const FOCUS_SAMPLE_MAX = 1400;
const FOCUS_NEAR_CURSOR_HALFSPAN_SEC = 60;
const SAMPLING_BUCKET_SEC = 60;
const SAMPLE_CACHE_MAX = 256;
const NORMAL_ACTION_SAMPLE_MAX = 96;
const FOCUS_ACTION_SAMPLE_MAX = 320;

function clampSec(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function getSamplingModeSignature(focus, windowSec) {
  const span = Math.max(1, Math.floor(windowSec ?? 0));
  const bucket = Math.max(1, Math.round(span / SAMPLING_BUCKET_SEC));
  return `${focus ? "focus" : "normal"}:${bucket}`;
}

function resolveSampleTarget(focus) {
  if (focus) {
    return Math.max(
      FOCUS_SAMPLE_MIN,
      Math.min(FOCUS_SAMPLE_MAX, FOCUS_SAMPLE_TARGET)
    );
  }
  return Math.max(
    NORMAL_SAMPLE_MIN,
    Math.min(NORMAL_SAMPLE_MAX, NORMAL_SAMPLE_TARGET)
  );
}

function addFillerSamples(sampleSet, startSec, endSec, count) {
  const start = clampSec(startSec);
  const end = clampSec(endSec);
  if (count <= 0 || end <= start) return;
  const span = end - start;
  const step = span / (count + 1);
  for (let i = 1; i <= count; i++) {
    const sec = Math.round(start + step * i);
    if (sec > start && sec < end) {
      sampleSet.add(sec);
    }
  }
}

function addGridSamples(sampleSet, startSec, endSec, targetCount) {
  const start = clampSec(startSec);
  const end = clampSec(endSec);
  const target = Math.max(2, Math.floor(targetCount ?? 0));
  if (end <= start) return;

  const span = end - start;
  const rough = span / Math.max(1, target - 1);
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  const candidates = [1, 2, 5, 10];
  let stride = candidates[candidates.length - 1] * pow10;
  for (const c of candidates) {
    const s = c * pow10;
    if (s >= rough) {
      stride = s;
      break;
    }
  }
  stride = Math.max(1, Math.floor(stride));

  // Anchor the grid to absolute timeline multiples so samples remain stable as
  // history grows (critical for t=0 anchored full-history views).
  const first = Math.ceil(start / stride) * stride;
  for (let sec = first; sec <= end; sec += stride) {
    sampleSet.add(sec);
  }
  sampleSet.add(end);
}

function pickActionSecondsForSampling(
  actionSecs,
  { focus, cursorSec, startSec, endSec } = {}
) {
  const list = Array.isArray(actionSecs) ? actionSecs : [];
  if (!list.length) return [];

  const maxActions = focus ? FOCUS_ACTION_SAMPLE_MAX : NORMAL_ACTION_SAMPLE_MAX;
  if (list.length <= maxActions) return list.slice();

  const start = clampSec(startSec);
  const end = clampSec(endSec);
  const selected = new Set();

  // Stable coarse selection: bucket by absolute timeline range, so appending
  // actions near the frontier does not reshuffle historical selections.
  const span = Math.max(1, end - start + 1);
  const bucketSpan = Math.max(1, Math.ceil(span / maxActions));
  let idx = 0;
  for (
    let bucketStart = start;
    bucketStart <= end && selected.size < maxActions;
    bucketStart += bucketSpan
  ) {
    const bucketEnd = bucketStart + bucketSpan - 1;
    while (idx < list.length && list[idx] < bucketStart) idx++;
    let picked = -1;
    while (idx < list.length && list[idx] <= bucketEnd) {
      picked = list[idx];
      idx++;
    }
    if (picked >= 0) {
      selected.add(picked);
    }
  }

  selected.add(list[0]);
  selected.add(list[list.length - 1]);
  const cursor = Number.isFinite(cursorSec) ? clampSec(cursorSec) : null;
  const nearRadius = focus ? FOCUS_NEAR_CURSOR_HALFSPAN_SEC : 20;

  if (cursor != null) {
    for (let i = list.length - 1; i >= 0; i--) {
      const sec = list[i];
      if (Math.abs(sec - cursor) <= nearRadius) {
        selected.add(sec);
      }
    }
  }

  while (selected.size > maxActions) {
    // Keep boundaries; trim newest-to-oldest extras deterministically.
    const arr = Array.from(selected.values()).sort((a, b) => a - b);
    const candidate = arr[arr.length - 2];
    if (candidate == null || candidate === list[0]) break;
    selected.delete(candidate);
  }

  return Array.from(selected.values()).sort((a, b) => a - b);
}

function buildSampleSeconds({
  startSec,
  endSec,
  historyEndSec,
  cursorSec,
  actionSecs,
  focus,
}) {
  const start = clampSec(startSec);
  const end = clampSec(endSec);
  if (end < start) return [];

  const samples = new Set([start, end]);
  const historyEnd = clampSec(historyEndSec ?? 0);
  if (historyEnd >= start && historyEnd <= end) samples.add(historyEnd);
  if (Number.isFinite(cursorSec)) {
    const cursor = clampSec(cursorSec);
    if (cursor >= start && cursor <= end) samples.add(cursor);
  }

  const sampledActionSecs = pickActionSecondsForSampling(actionSecs, {
    focus: !!focus,
    cursorSec,
    startSec: start,
    endSec: end,
  });

  for (const sec of sampledActionSecs) {
    const t = clampSec(sec);
    if (t >= start && t <= end) samples.add(t);
  }

  const target = resolveSampleTarget(!!focus);
  if (samples.size >= target) {
    return Array.from(samples.values()).sort((a, b) => a - b);
  }

  let remaining = target - samples.size;

  if (!focus) {
    addGridSamples(samples, start, end, target);
    // Keep non-focus sampling stable over time. In full-history mode, filler
    // redistribution causes sample-second churn every frontier advance, which
    // defeats value-cache reuse and scales render cost with large tSec.
    return Array.from(samples.values()).sort((a, b) => a - b);
  }

  if (focus && Number.isFinite(cursorSec)) {
    const cursor = clampSec(cursorSec);
    const focusStart = Math.max(start, cursor - FOCUS_NEAR_CURSOR_HALFSPAN_SEC);
    const focusEnd = Math.min(end, cursor + FOCUS_NEAR_CURSOR_HALFSPAN_SEC);
    if (focusEnd > focusStart) {
      const focusFill = Math.min(
        remaining,
        Math.max(0, Math.floor(target * 0.4))
      );
      addFillerSamples(samples, focusStart, focusEnd, focusFill);
      remaining = target - samples.size;
    }
  }

  if (remaining > 0) {
    addFillerSamples(samples, start, end, remaining);
  }

  return Array.from(samples.values()).sort((a, b) => a - b);
}

function alignForecastSampleSeconds(seconds, historyEndSec, stepSec, endSec) {
  const step = Math.max(1, Math.floor(stepSec ?? 1));
  if (step <= 1) {
    return Array.isArray(seconds)
      ? Array.from(new Set(seconds.map((sec) => clampSec(sec)).values())).sort(
          (a, b) => a - b
        )
      : [];
  }

  const historyEnd = clampSec(historyEndSec);
  const end = clampSec(endSec);
  const aligned = new Set();

  for (const secRaw of seconds || []) {
    const sec = clampSec(secRaw);
    if (sec <= historyEnd) {
      aligned.add(sec);
      continue;
    }

    let snapped = Math.floor(sec / step) * step;
    if (snapped <= historyEnd) {
      snapped = Math.ceil((historyEnd + 1) / step) * step;
    }
    if (snapped > end) {
      snapped = end;
    }
    aligned.add(snapped);
  }

  return Array.from(aligned.values()).sort((a, b) => a - b);
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

  const allFastSeries = list.every(
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

  const unresolvedFastSubject =
    resolver &&
    typeof resolver === "object" &&
    ((resolver.kind === "pawn" && !resolver.pawn) ||
      (resolver.kind === "tile" && !resolver.tile) ||
      (resolver.kind === "hub" && !resolver.hubStructure));

  const useFastSnapshotPath = allFastSeries && !unresolvedFastSubject;

  let state = null;
  if (!useFastSnapshotPath) {
    state = deserializeGameState(stateData);
    canonicalizeSnapshot(state);
  }

  const values = {};
  for (const s of list) {
    if (!s || typeof s.getValue !== "function") continue;
    if (useFastSnapshotPath && typeof s.getValueFromSnapshot === "function") {
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
  return getActionSecondsInRange(tl, startSec, endSec, { copy: false });
}

function collectActionSecondsForSampling(
  tl,
  startSec,
  endSec,
  { focus = false, cursorSec = null } = {}
) {
  const baseCap =
    (focus ? FOCUS_ACTION_SAMPLE_MAX : NORMAL_ACTION_SAMPLE_MAX) * 6;
  const sampled = getActionSecondsInRangeSampled(tl, startSec, endSec, baseCap, {
    copy: false,
  });

  if (!Number.isFinite(cursorSec)) return sampled;

  const radiusSec = focus ? FOCUS_NEAR_CURSOR_HALFSPAN_SEC * 2 : 30;
  const near = getActionSecondsInRange(
    tl,
    cursorSec - radiusSec,
    cursorSec + radiusSec,
    { copy: false }
  );
  if (!near.length) return sampled;

  const merged = new Set(sampled);
  for (const sec of near) merged.add(sec);
  return Array.from(merged.values()).sort((a, b) => a - b);
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

function shouldCacheForecastSec(sec, historyEndSec) {
  return clampSec(sec) > clampSec(historyEndSec);
}

function cacheForecastStateData(stateDataByBoundary, sec, historyEndSec, stateData) {
  // Forecast state snapshots are owned by the shared projection cache.
  // Controllers should not duplicate serialized state data.
  return;
}

function purgePastStateData(stateDataByBoundary, historyEndSec) {
  return;
}

function cacheSampleSeconds(sampleCache, key, secs) {
  if (!sampleCache || key == null) return;
  sampleCache.delete(key);
  sampleCache.set(key, secs);
  while (sampleCache.size > SAMPLE_CACHE_MAX) {
    const oldest = sampleCache.keys().next().value;
    if (oldest == null) break;
    sampleCache.delete(oldest);
  }
}

function computeTimelineSignature(tl) {
  // Projection cache should only reset when replay-relevant data changes.
  // We intentionally ignore checkpoint churn (revision bumps) here.
  const actions = Array.isArray(tl?.actions) ? tl.actions : [];
  const len = actions.length;
  const last = len ? actions[len - 1] : null;
  const revision = Number.isFinite(tl?.revision)
    ? Math.floor(tl.revision)
    : 0;
  return {
    baseRef: tl?.baseStateData ?? null,
    actionsRef: actions,
    actionsLen: len,
    lastRef: last,
    lastSec: last ? Math.floor(last.tSec ?? 0) : 0,
    revision,
  };
}

function signatureEquals(a, b) {
  if (!a || !b) return false;
  return (
    a.baseRef === b.baseRef &&
    a.actionsRef === b.actionsRef &&
    a.actionsLen === b.actionsLen &&
    a.lastRef === b.lastRef &&
    a.lastSec === b.lastSec &&
    a.revision === b.revision
  );
}

function createProjectionCache({
  maxBytes = DEFAULT_PROJECTION_CACHE_MAX_BYTES,
  maxEntries = null,
} = {}) {
  let signature = null;
  let forecastBaseSec = 0;
  let forecastEndSec = 0;
  let forecastStepSec = 1;
  let forecastDtStep = null;
  const stateDataBySecond = new Map();
  const bytesBySecond = new Map();
  let stateDataSizeSamples = 0;
  let lastPurgedHistoryEndSec = -1;

  const maxBytesBudget = Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.max(1024 * 1024, Math.floor(maxBytes))
    : DEFAULT_PROJECTION_CACHE_MAX_BYTES;
  const maxEntriesBudget = Number.isFinite(maxEntries) && maxEntries > 0
    ? Math.max(256, Math.floor(maxEntries))
    : Number.POSITIVE_INFINITY;

  let approxBytesTotal = 0;
  let avgStateDataBytes = DEFAULT_STATE_DATA_ESTIMATE_BYTES;

  function reset(nextSignature) {
    signature = nextSignature || null;
    forecastBaseSec = 0;
    forecastEndSec = 0;
    forecastStepSec = 1;
    forecastDtStep = null;
    stateDataBySecond.clear();
    bytesBySecond.clear();
    approxBytesTotal = 0;
    stateDataSizeSamples = 0;
    lastPurgedHistoryEndSec = -1;
  }

  function touch(sec) {
    if (!stateDataBySecond.has(sec)) return null;
    const data = stateDataBySecond.get(sec);
    stateDataBySecond.delete(sec);
    stateDataBySecond.set(sec, data);
    return data;
  }

  function estimateBytes(stateData) {
    const avg = Math.max(512, Math.floor(avgStateDataBytes));
    const sampleCount = Math.floor(stateDataSizeSamples ?? 0);
    const shouldSample = sampleCount < 8 || sampleCount % 8 === 0;
    stateDataSizeSamples = sampleCount + 1;
    if (!shouldSample) return avg;

    let bytes = avg;
    if (typeof stateData === "string") {
      bytes = Math.max(512, stateData.length);
    } else {
      try {
        bytes = Math.max(512, JSON.stringify(stateData).length);
      } catch (_) {
        bytes = avg;
      }
    }
    avgStateDataBytes = Math.floor(avgStateDataBytes * 0.75 + bytes * 0.25);
    return bytes;
  }

  function removeSec(sec) {
    if (!stateDataBySecond.has(sec)) return;
    const removedBytes = bytesBySecond.get(sec) ?? 0;
    stateDataBySecond.delete(sec);
    bytesBySecond.delete(sec);
    approxBytesTotal = Math.max(0, approxBytesTotal - removedBytes);
  }

  function set(sec, data) {
    const t = clampSec(sec);
    const prevBytes = bytesBySecond.get(t) ?? 0;
    const nextBytes = estimateBytes(data);
    stateDataBySecond.delete(t);
    stateDataBySecond.set(t, data);
    bytesBySecond.set(t, nextBytes);
    approxBytesTotal += nextBytes - prevBytes;

    while (
      stateDataBySecond.size > maxEntriesBudget ||
      approxBytesTotal > maxBytesBudget
    ) {
      const oldest = stateDataBySecond.keys().next().value;
      if (oldest == null) break;
      removeSec(oldest);
    }
  }

  function purgePastForecast(historyEndSec) {
    const cutoff = clampSec(historyEndSec);
    for (const sec of stateDataBySecond.keys()) {
      if (clampSec(sec) <= cutoff) {
        removeSec(sec);
      }
    }
    lastPurgedHistoryEndSec = Math.max(lastPurgedHistoryEndSec, cutoff);
  }

  function purgePastForecastIfNeeded(historyEndSec) {
    const cutoff = clampSec(historyEndSec);
    if (cutoff <= lastPurgedHistoryEndSec) return;
    purgePastForecast(cutoff);
  }

  function setForecastState(sec, historyEndSec, data) {
    const t = clampSec(sec);
    const historyEnd = clampSec(historyEndSec);
    if (t <= historyEnd) return;
    set(t, data);
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
    const historyEndSec = clampSec(tl.historyEndSec ?? 0);
    // Correctness: forecast must start at realized frontier.
    // Aligning base backwards to a step boundary can skip actions between
    // that boundary and historyEndSec (e.g. action at t=1, step=5).
    const baseSec = historyEndSec;
    const target = clampSec(targetEndSec);
    const horizonSec = Math.max(0, target - baseSec);
    const targetBoundaryEnd =
      baseSec + Math.floor(horizonSec / step) * step;

    purgePastForecast(historyEndSec);

    if (
      forecastStepSec !== step ||
      (forecastDtStep != null && dtStep != null && forecastDtStep !== dtStep)
    ) {
      reset(signature);
    }

    if (targetBoundaryEnd <= historyEndSec) {
      forecastBaseSec = baseSec;
      forecastEndSec = historyEndSec;
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
        const baseRes = getStateDataAtSecond(tl, baseSec);
        if (!baseRes.ok) return null;
        return baseRes.stateData;
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
          setForecastState(sec, historyEndSec, sd);
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
            setForecastState(sec, historyEndSec, sd);
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
      setForecastState(sec, historyEndSec, sd);
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
    const historyEnd = clampSec(tl.historyEndSec ?? 0);
    // Forecast cache entries are only valid strictly beyond history frontier.
    // Once history advances, past forecast entries must never be served.
    purgePastForecastIfNeeded(historyEnd);

    if (t <= historyEnd) {
      const sdRes = getStateDataAtSecond(tl, t);
      if (!sdRes.ok) {
        return { ok: false, reason: sdRes.reason || "rebuildFailed" };
      }
      return { ok: true, stateData: sdRes.stateData };
    }

    const cached = touch(t);
    if (cached != null) return { ok: true, stateData: cached };

    const step =
      typeof stepSec === "number" && stepSec > 0 ? Math.floor(stepSec) : 1;

    const forecastRes = ensureForecastWindow(tl, t, dtStep, step);
    if (!forecastRes.ok) return forecastRes;

    const forecastData = touch(t);
    if (forecastData != null) return { ok: true, stateData: forecastData };

    if (t >= forecastBaseSec && step > 0) {
      const offset = t - forecastBaseSec;
      const anchorSec =
        forecastBaseSec + Math.floor(offset / step) * step;
      let anchorData = stateDataBySecond.get(anchorSec);
      if (anchorData == null && anchorSec <= historyEnd) {
        const baseRes = getStateDataAtSecond(tl, anchorSec);
        if (baseRes.ok) anchorData = baseRes.stateData;
      }
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
              setForecastState(t, historyEnd, sd);
              return { ok: true, stateData: sd };
            }
          }
        } else if (delta === 0) {
          setForecastState(t, historyEnd, anchorData);
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
    getApproxBytes: () => approxBytesTotal,
    maxBytes: maxBytesBudget,
    maxEntries: Number.isFinite(maxEntriesBudget) ? maxEntriesBudget : null,
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
  forecastStepSec = DEFAULT_FORECAST_STEP_SEC,
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
  const SUBJECT_VALUE_CACHE_COMPACT_THRESHOLD = 1024;
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
    const base = clampStride(horizonSec, 1200);
    const state = getCursorState?.() ?? null;
    const globalMods = computeGlobalSkillMods(state);
    const bonus = Number.isFinite(globalMods?.projectionHorizonBonusSec)
      ? Math.floor(globalMods.projectionHorizonBonusSec)
      : 0;
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
      const res = projection.ensureStateAtSecond(
        tl,
        sec,
        undefined,
        forecastStepSecCur
      );
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
        const res = projection.ensureStateAtSecond(
          tl,
          sec,
          undefined,
          forecastStepSecCur
        );
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
      const res = projection.ensureStateAtSecond(
        tl,
        sec,
        undefined,
        forecastStepSecCur
      );
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
      const res = projection.ensureStateAtSecond(
        tl,
        target,
        undefined,
        forecastStepSecCur
      );
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
        const res = projection.ensureStateAtSecond(
          tl,
          baseSec,
          undefined,
          forecastStepSecCur
        );
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
        const res = projection.ensureStateAtSecond(
          tl,
          sec,
          undefined,
          forecastStepSecCur
        );
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

    if (isPlannerReplacePatch) {
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
      return { ok: true, reason: "replaceActionPatch" };
    }

    if (signatureChanged) {
      const isActionAppendPatch =
        reason === "actionDispatched" &&
        mutationKind === "appendAction" &&
        mutationSec >= Math.max(0, historyEndSec - 1) &&
        graphCache;
      if (isActionAppendPatch || isPlannerReplacePatch) {
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
          reason: isPlannerReplacePatch
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
        getSeriesValuesForSeconds(historySecs, { focus: !!focus }) ?? new Map();
      recordProjectionHistoryBuild({
        ms: perfNowMs() - historyStart,
        points: historySecs.length,
      });

      const forecastStart = perfNowMs();
      const forecastValues =
        getSeriesValuesForSeconds(forecastSecs, { focus: !!focus }) ?? new Map();
      recordProjectionForecastBuild({
        ms: perfNowMs() - forecastStart,
        points: forecastSecs.length,
      });

      valuesBySec = new Map([...historyValues, ...forecastValues]);
    } else {
      valuesBySec =
        getSeriesValuesForSeconds(sampleSecs, { focus: !!focus }) ?? new Map();
    }

    const points = sampleSecs.map((sec) => ({
      tSec: sec,
      values: valuesBySec.get(sec) ?? {},
    }));

    return { ok: true, points, seconds: sampleSecs, samplingSig };
  }

  function ensureGraphForecastValues(
    tl,
    seconds,
    historyEndSec,
    seriesSig,
    focus
  ) {
    if (focus) return null;
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
    const stepSec = Math.max(1, Math.floor(forecastStepSecCur ?? 1));
    const maxSec = requested[requested.length - 1];
    const resolverFactory = getResolverFactory();
    const key = subjectKey ?? "__global__";
    const meta = graphCache.window.forecastValuesMeta;

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
      const forecastRes = projection.ensureForecastWindow(
        tl,
        maxSec,
        undefined,
        stepSec
      );
      if (!forecastRes?.ok) {
        graphCache.window.forecastValuesBySec = new Map();
        graphCache.window.forecastValuesMeta = null;
        return null;
      }
      graphCache.window.forecastValuesBySec = new Map();
      graphCache.window.forecastValuesMeta = {
        baseSec,
        historyEndSec: baseSec,
        endSec: maxSec,
        stepSec,
        seriesSig,
        subjectKey: key,
        valuesRevision,
      };
    }

    const valuesBySec = graphCache.window.forecastValuesBySec;
    for (const sec of requested) {
      if (valuesBySec.has(sec)) continue;
      const stateRes = projection.ensureStateAtSecond(
        tl,
        sec,
        undefined,
        stepSec
      );
      if (!stateRes?.ok) continue;
      const values = computeValuesFromStateData(
        stateRes.stateData,
        activeSeries,
        subject,
        resolverFactory
      );
      valuesBySec.set(sec, values);
    }
    if (graphCache.window.forecastValuesMeta) {
      graphCache.window.forecastValuesMeta.endSec = Math.max(
        graphCache.window.forecastValuesMeta.endSec ?? 0,
        maxSec
      );
    }

    return graphCache.window.forecastValuesBySec;
  }

  function getSeriesValuesForSeconds(seconds, { focus = false } = {}) {
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
      seriesSig,
      !!focus
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
        const res = projection.ensureStateAtSecond(
          tl,
          sec,
          undefined,
          forecastStepSecCur
        );
        if (!res?.ok) {
          valuesBySec.set(sec, {});
          pushSubjectValueSec(entry, sec, valuesBySec);
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
    }
    const res = projection.ensureStateAtSecond(
      tl,
      sec,
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
    getSamplesForWindow,
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
