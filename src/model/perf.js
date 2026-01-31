// src/model/perf.js
// DEV-only perf counters and snapshot helpers (no UI imports).

const DEV =
  (typeof globalThis !== "undefined" && globalThis.__DEV__ === true) ||
  (typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV !== "production");

function nowMs() {
  if (!DEV) return 0;
  if (typeof performance !== "undefined" && performance.now) {
    return performance.now();
  }
  return Date.now();
}

const perf = {
  timeline: {
    rebuild: {
      count: 0,
      memoHits: 0,
      memoMisses: 0,
      lastMs: 0,
    },
    checkpoints: {
      count: 0,
      lastMs: 0,
    },
  },
  projection: {
    history: { lastMs: 0, lastPoints: 0 },
    forecast: { lastMs: 0, lastPoints: 0 },
    stateWindow: { lastMs: 0, lastPoints: 0 },
  },
  timegraph: {
    cacheHits: 0,
    cacheMisses: 0,
  },
  view: {
    lastMs: 0,
    lastPoints: 0,
    lastMetric: null,
  },
};

export function perfEnabled() {
  return DEV;
}

export function perfNowMs() {
  return nowMs();
}

export function recordTimelineRebuild({ ms, memoHit }) {
  if (!DEV) return;
  perf.timeline.rebuild.count += 1;
  if (memoHit) perf.timeline.rebuild.memoHits += 1;
  else perf.timeline.rebuild.memoMisses += 1;
  perf.timeline.rebuild.lastMs = Number.isFinite(ms) ? ms : 0;
}

export function recordCheckpointMaintenance(ms) {
  if (!DEV) return;
  perf.timeline.checkpoints.count += 1;
  perf.timeline.checkpoints.lastMs = Number.isFinite(ms) ? ms : 0;
}

export function recordProjectionHistoryBuild({ ms, points }) {
  if (!DEV) return;
  perf.projection.history.lastMs = Number.isFinite(ms) ? ms : 0;
  perf.projection.history.lastPoints = Number.isFinite(points) ? points : 0;
}

export function recordProjectionForecastBuild({ ms, points }) {
  if (!DEV) return;
  perf.projection.forecast.lastMs = Number.isFinite(ms) ? ms : 0;
  perf.projection.forecast.lastPoints = Number.isFinite(points) ? points : 0;
}

export function recordProjectionStateWindowBuild({ ms, points }) {
  if (!DEV) return;
  perf.projection.stateWindow.lastMs = Number.isFinite(ms) ? ms : 0;
  perf.projection.stateWindow.lastPoints = Number.isFinite(points)
    ? points
    : 0;
}

export function recordTimegraphCacheHit() {
  if (!DEV) return;
  perf.timegraph.cacheHits += 1;
}

export function recordTimegraphCacheMiss() {
  if (!DEV) return;
  perf.timegraph.cacheMisses += 1;
}

export function recordGraphRender({ ms, points, metric }) {
  if (!DEV) return;
  perf.view.lastMs = Number.isFinite(ms) ? ms : 0;
  perf.view.lastPoints = Number.isFinite(points) ? points : 0;
  perf.view.lastMetric = metric ?? null;
}

export function getPerfCounters() {
  return perf;
}

export function getPerfSnapshot({ timeline, controllers } = {}) {
  if (!DEV) return { ok: false, reason: "devOnly" };

  const tl = timeline ?? null;
  const actionsCount = Array.isArray(tl?.actions) ? tl.actions.length : 0;
  const checkpointsCount = Array.isArray(tl?.checkpoints)
    ? tl.checkpoints.length
    : 0;
  const memoSize =
    tl?.memoStateBySec && typeof tl.memoStateBySec.size === "number"
      ? tl.memoStateBySec.size
      : 0;
  const actionsBySecSize =
    tl?.actionsBySec && typeof tl.actionsBySec.size === "number"
      ? tl.actionsBySec.size
      : 0;

  const controllerData = Array.isArray(controllers)
    ? controllers
        .map((c) => (typeof c?.getData === "function" ? c.getData() : null))
        .filter(Boolean)
    : [];

  const maxForecastCache = controllerData.reduce((acc, d) => {
    const size = Number.isFinite(d?.projectionCacheSize)
      ? d.projectionCacheSize
      : 0;
    return Math.max(acc, size);
  }, 0);

  const maxForecastCap = controllerData.reduce((acc, d) => {
    const cap = Number.isFinite(d?.projectionCacheCap)
      ? d.projectionCacheCap
      : 0;
    return Math.max(acc, cap);
  }, 0);

  return {
    ok: true,
    timeline: {
      revision: Math.floor(tl?.revision ?? 0),
      actions: actionsCount,
      checkpoints: checkpointsCount,
      memoSize,
      actionsBySecSize,
    },
    graphs: {
      forecastCacheSize: maxForecastCache,
      forecastCacheCap: maxForecastCap,
      lastHistoryBuildMs: perf.projection.history.lastMs,
      lastForecastBuildMs: perf.projection.forecast.lastMs,
      lastHistoryPoints: perf.projection.history.lastPoints,
      lastForecastPoints: perf.projection.forecast.lastPoints,
      timegraphCacheHits: perf.timegraph.cacheHits,
      timegraphCacheMisses: perf.timegraph.cacheMisses,
      lastRenderMs: perf.view.lastMs,
      lastRenderPoints: perf.view.lastPoints,
      lastRenderMetric: perf.view.lastMetric,
    },
  };
}

