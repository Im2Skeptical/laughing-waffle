// src/model/timegraph-controller.js
// Logic controller for time-series projections (e.g. gold graph).
// Owns the cache, invalidation policies, and incremental updates.
// No Pixi imports.

import {
  buildMetricGraphCacheFromTimeline,
  buildMetricGraphWindowFromTimeline,
  getStateAtBoundaryFromGraphCache,
  getStateAtBoundary,
} from "./projection.js";

import { GRAPH_METRICS } from "./graph-metrics.js";
import { serializeGameState } from "./state.js";
import { canonicalizeSnapshot } from "./canonicalize.js";

export function createTimeGraphController({
  getTimeline,
  getCursorState,
  metric = GRAPH_METRICS.gold,

  // Stage 4: decouple plotting resolution from scrubbing resolution
  historyStrideSec = 3,
  forecastStepSec = 3,
  horizonSec = 1200,
} = {}) {
  let cache = null;
  const resolvedMetric =
    typeof metric === "string" ? GRAPH_METRICS[metric] : metric;
  const metricDef =
    resolvedMetric && typeof resolvedMetric === "object"
      ? resolvedMetric
      : GRAPH_METRICS.gold;
  const series = Array.isArray(metricDef.series)
    ? metricDef.series
    : GRAPH_METRICS.gold.series;
  let isActive = false;
  let dirty = true;

  // Config (mutable locals; never assign to function parameters)
  let historyStrideSecCur = historyStrideSec;
  let forecastStepSecCur = forecastStepSec;
  let horizonSecCur = horizonSec;

  // Change detection
  let lastKnownActionsLen = 0;
  let lastKnownMaxReachedSec = 0;
  let lastKnownForecastBaseSec = 0;
  let lastKnownRevision = 0;

  function clampSec(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.floor(v));
  }

  function clampStride(v, fallback) {
    const n = Math.floor(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function getTimelineRevision(tl) {
    const r = tl?.revision;
    return Number.isFinite(r) ? Math.floor(r) : 0;
  }

  function shouldSampleHistory(sec, frontierSec) {
    // Always include frontier so the line reaches "now"
    if (sec === frontierSec) return true;
    return sec % historyStrideSecCur === 0;
  }

  function collectSeriesValues(state) {
    const values = {};
    for (const s of series) {
      if (!s || typeof s.getValue !== "function") continue;
      const v = s.getValue(state);
      values[s.id] = Number.isFinite(v) ? v : 0;
    }
    return values;
  }

  function ensureForecastFromFrontier(force) {
    const tl = getTimeline?.();
    if (!cache || !tl) return { ok: false, reason: "noTimeline" };

    const frontierSec = clampSec(tl.maxReachedSec ?? 0);

    if (
      !force &&
      frontierSec === lastKnownForecastBaseSec &&
      cache.window?.forecast?.length
    ) {
      return { ok: true };
    }

    const winRes = buildMetricGraphWindowFromTimeline(tl, frontierSec, {
      baseSec: frontierSec,
      horizonSec: horizonSecCur,
      stepSec: forecastStepSecCur,
      storeStateBySecond: true,
      series,
      // mode defaults to timeWindow
    });

    if (!winRes.ok) return winRes;

    cache.window = winRes.window;
    lastKnownForecastBaseSec = frontierSec;

    if (!cache.stateDataByBoundary) cache.stateDataByBoundary = new Map();
    for (const [sec, sd] of winRes.stateDataByBoundary.entries()) {
      cache.stateDataByBoundary.set(sec, sd);
    }

    return { ok: true };
  }

  function extendHistoryTo(newMaxReachedSec) {
    const tl = getTimeline?.();
    if (!cache || !tl) return false;

    const oldMax = clampSec(cache.maxReachedSec ?? 0);
    const target = clampSec(newMaxReachedSec ?? 0);
    if (target <= oldMax) return true;

    if (!Array.isArray(cache.history)) cache.history = [];
    if (!cache.stateDataByBoundary) cache.stateDataByBoundary = new Map();

    for (let sec = oldMax + 1; sec <= target; sec++) {
      if (!shouldSampleHistory(sec, target)) continue;

      const s = getStateAtBoundaryFromGraphCache(cache, tl, sec);
      if (!s) return false;

      canonicalizeSnapshot(s, sec);

      const values = collectSeriesValues(s);
      cache.history.push({ tSec: sec, values });

      cache.stateDataByBoundary.set(sec, serializeGameState(s));
    }

    cache.maxReachedSec = target;
    return true;
  }

  function trimHistoryTo(targetMaxSec) {
    if (!cache || !Array.isArray(cache.history)) return;

    const t = clampSec(targetMaxSec ?? 0);

    cache.history = cache.history.filter((p) => {
      const sec = clampSec(p.tSec ?? 0);
      return sec <= t;
    });

    cache.maxReachedSec = t;
    // stateDataByBoundary is intentionally not purged; it's a perf cache only.
  }

  function patchHistoryAtSecond(sec) {
    const tl = getTimeline?.();
    if (!cache || !tl) return false;

    const t = clampSec(sec);

    const rebuilt = getStateAtBoundary(tl, t);
    if (!rebuilt?.ok) return false;

    const s = rebuilt.state;
    canonicalizeSnapshot(s, t);

    const values = collectSeriesValues(s);

    if (!Array.isArray(cache.history)) cache.history = [];

    let replaced = false;
    for (let i = 0; i < cache.history.length; i++) {
      const existingSec = clampSec(
        cache.history[i].tSec ?? 0
      );
      if (existingSec === t) {
        cache.history[i] = { tSec: t, values };
        replaced = true;
        break;
      }
    }
    if (!replaced) cache.history.push({ tSec: t, values });

    cache.history.sort(
      (a, b) =>
        clampSec(a.tSec ?? 0) - clampSec(b.tSec ?? 0)
    );

    if (!cache.stateDataByBoundary) cache.stateDataByBoundary = new Map();
    cache.stateDataByBoundary.set(t, serializeGameState(s));

    return true;
  }

  function buildFullCache() {
    const tl = getTimeline?.();
    if (!tl) {
      cache = null;
      return { ok: false, reason: "no timeline" };
    }

    // Normalize inputs into mutable locals
    historyStrideSecCur = clampStride(historyStrideSecCur, 5);
    forecastStepSecCur = clampStride(forecastStepSecCur, 5);
    horizonSecCur = clampStride(horizonSecCur, 1200);

    const frontierSec = clampSec(tl.maxReachedSec ?? 0);
    const tlRev = getTimelineRevision(tl);

    const res = buildMetricGraphCacheFromTimeline(tl, {
      baseSec: frontierSec,
      horizonSec: horizonSecCur,
      stepSec: forecastStepSecCur,
      historyStrideSec: historyStrideSecCur,
      storeStateBySecond: true,
      series,
    });

    if (!res.ok) {
      cache = null;
      return res;
    }

    cache = res.cache;

    cache.maxReachedSec = clampSec(cache.maxReachedSec ?? frontierSec);

    lastKnownActionsLen = Array.isArray(tl.actions) ? tl.actions.length : 0;
    lastKnownMaxReachedSec = frontierSec;
    lastKnownForecastBaseSec = frontierSec;
    lastKnownRevision = tlRev;

    return { ok: true };
  }

  function ensureCache() {
    if (!cache) return buildFullCache();
    return { ok: true };
  }

  function handleInvalidate(reason) {
    const tl = getTimeline?.();
    const cs = getCursorState?.();
    if (!tl || !cs) {
      cache = null;
      dirty = true;
      return { ok: false, reason: "no state" };
    }

    if (!isActive && reason !== "open" && reason !== "active") {
      dirty = true;
      return { ok: true, reason: "deferred" };
    }

    const actionsLen = Array.isArray(tl.actions) ? tl.actions.length : 0;
    const maxReachedSec = clampSec(tl.maxReachedSec ?? 0);
    const cursorSec = clampSec(cs.tSec ?? 0);
    const tlRev = getTimelineRevision(tl);

    if (!cache) {
      const res = buildFullCache();
      dirty = !res.ok;
      return res;
    }

    // 0) Authoritative invalidation: timeline revision changed (Stage 3 contract)
    if (tlRev !== lastKnownRevision) {
      // safest path: keep cache object but bring it back in sync
      const prevMax = clampSec(cache.maxReachedSec ?? 0);
      const trimTarget = Math.min(prevMax, maxReachedSec);
      trimHistoryTo(trimTarget);

      const okExtend = extendHistoryTo(maxReachedSec);
      if (!okExtend) return buildFullCache();

      const okPatch = patchHistoryAtSecond(cursorSec);
      if (!okPatch) return buildFullCache();

      lastKnownRevision = tlRev;
      lastKnownActionsLen = actionsLen;
      lastKnownMaxReachedSec = maxReachedSec;

      // Force forecast rebuild from new frontier
      lastKnownForecastBaseSec = -1;
      cache.window = null;
      ensureForecastFromFrontier(true);

      dirty = false;
      return { ok: true };
    }

    // 1) Normal extension: no structural change, frontier advanced
    if (
      actionsLen === lastKnownActionsLen &&
      maxReachedSec >= lastKnownMaxReachedSec
    ) {
      const ok = extendHistoryTo(maxReachedSec);
      if (!ok) return buildFullCache();

      lastKnownMaxReachedSec = maxReachedSec;

      ensureForecastFromFrontier(false);
      dirty = false;
      return { ok: true };
    }

    // 2) Branching/edit detected by action list length change (legacy fallback)
    if (actionsLen !== lastKnownActionsLen) {
      const prevMax = clampSec(cache.maxReachedSec ?? 0);
      const trimTarget = Math.min(prevMax, maxReachedSec);
      trimHistoryTo(trimTarget);

      const okExtend = extendHistoryTo(maxReachedSec);
      if (!okExtend) return buildFullCache();

      const okPatch = patchHistoryAtSecond(cursorSec);
      if (!okPatch) return buildFullCache();

      lastKnownActionsLen = actionsLen;
      lastKnownMaxReachedSec = maxReachedSec;

      lastKnownForecastBaseSec = -1;
      cache.window = null;
      ensureForecastFromFrontier(true);

      dirty = false;
      return { ok: true };
    }

    // 3) Cursor-only movement: cache remains valid
    if (reason === "scrubCommit") {
      dirty = false;
      return { ok: true };
    }

    const res = buildFullCache();
    dirty = !res.ok;
    return res;
  }

  function update() {
    if (!isActive) return;
    if (dirty) {
      handleInvalidate("active");
      return;
    }
    if (!cache) {
      const res = ensureCache();
      if (!res.ok) {
        dirty = true;
        return;
      }
    }
    const tl = getTimeline?.();
    if (cache && tl) {
      const maxReachedSec = clampSec(tl.maxReachedSec ?? 0);
      if (maxReachedSec > lastKnownMaxReachedSec) {
        const ok = extendHistoryTo(maxReachedSec);
        if (!ok) {
          const res = buildFullCache();
          dirty = !res.ok;
          return;
        }
        lastKnownMaxReachedSec = maxReachedSec;
      }
    }
    ensureForecastFromFrontier(false);
  }

  function getData() {
    return {
      cache,
      metric: metricDef,
      horizonSec: horizonSecCur,
      historyStrideSec: historyStrideSecCur,
      forecastStepSec: forecastStepSecCur,
    };
  }

  function getStateDataAt(tSec) {
    const sec = clampSec(tSec);
    return cache?.stateDataByBoundary?.get?.(sec) ?? null;
  }

  // Scrubbing preview is authoritative: rebuild from timeline first, then fall back.
  function getStateAt(tSec) {
    const tl = getTimeline?.();
    if (!tl) return null;

    const sec = clampSec(tSec);
    const maxReachedSec = clampSec(tl.maxReachedSec ?? 0);

    if (sec > maxReachedSec && cache) {
      const cached = getStateAtBoundaryFromGraphCache(cache, tl, sec);
      if (cached) return cached;
    }

    const rebuilt = getStateAtBoundary(tl, sec);
    if (rebuilt?.ok) return rebuilt.state;

    if (!cache) return null;
    return getStateAtBoundaryFromGraphCache(cache, tl, sec);
  }

  return {
    ensureCache,
    handleInvalidate,
    update,
    getData,
    getStateDataAt,
    getStateAt,
    setActive: (active) => {
      const next = !!active;
      if (next === isActive) return;
      isActive = next;
      if (isActive && dirty) handleInvalidate("active");
    },
  };
}
