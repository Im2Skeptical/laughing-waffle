// src/model/perf.js
// Perf counters and snapshot helpers (no UI imports).

const DEV =
  (typeof globalThis !== "undefined" && globalThis.__DEV__ === true) ||
  (typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV !== "production");
const MAX_VIEW_UPDATE_IDS = 64;

function nowMs() {
  if (typeof performance !== "undefined" && performance.now) {
    return performance.now();
  }
  return Date.now();
}

function isPerfActive() {
  const forcedOn =
    typeof globalThis !== "undefined" && globalThis.__PERF_ENABLED__ === true;
  return forcedOn || DEV;
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
  runtime: {
    scrub: {
      commitCalls: 0,
      commitMoved: 0,
      commitFailed: 0,
      commitLastMs: 0,
      browseCalls: 0,
      browseMoved: 0,
      browseFailed: 0,
      browseLastMs: 0,
    },
    planner: {
      commitCalls: 0,
      commitFailed: 0,
      commitLastMs: 0,
      commitMaxMs: 0,
      committedActionsLast: 0,
    },
    actionDispatch: {
      calls: 0,
      failed: 0,
      lastMs: 0,
      maxMs: 0,
    },
    frame: {
      count: 0,
      lastMs: 0,
      maxMs: 0,
    },
    viewUpdates: new Map(),
  },
};

export function perfEnabled() {
  return isPerfActive();
}

export function perfNowMs() {
  return nowMs();
}

export function recordTimelineRebuild({ ms, memoHit }) {
  if (!isPerfActive()) return;
  perf.timeline.rebuild.count += 1;
  if (memoHit) perf.timeline.rebuild.memoHits += 1;
  else perf.timeline.rebuild.memoMisses += 1;
  perf.timeline.rebuild.lastMs = Number.isFinite(ms) ? ms : 0;
}

export function recordCheckpointMaintenance(ms) {
  if (!isPerfActive()) return;
  perf.timeline.checkpoints.count += 1;
  perf.timeline.checkpoints.lastMs = Number.isFinite(ms) ? ms : 0;
}

export function recordProjectionHistoryBuild({ ms, points }) {
  if (!isPerfActive()) return;
  perf.projection.history.lastMs = Number.isFinite(ms) ? ms : 0;
  perf.projection.history.lastPoints = Number.isFinite(points) ? points : 0;
}

export function recordProjectionForecastBuild({ ms, points }) {
  if (!isPerfActive()) return;
  perf.projection.forecast.lastMs = Number.isFinite(ms) ? ms : 0;
  perf.projection.forecast.lastPoints = Number.isFinite(points) ? points : 0;
}

export function recordProjectionStateWindowBuild({ ms, points }) {
  if (!isPerfActive()) return;
  perf.projection.stateWindow.lastMs = Number.isFinite(ms) ? ms : 0;
  perf.projection.stateWindow.lastPoints = Number.isFinite(points)
    ? points
    : 0;
}

export function recordTimegraphCacheHit() {
  if (!isPerfActive()) return;
  perf.timegraph.cacheHits += 1;
}

export function recordTimegraphCacheMiss() {
  if (!isPerfActive()) return;
  perf.timegraph.cacheMisses += 1;
}

export function recordGraphRender({ ms, points, metric }) {
  if (!isPerfActive()) return;
  perf.view.lastMs = Number.isFinite(ms) ? ms : 0;
  perf.view.lastPoints = Number.isFinite(points) ? points : 0;
  perf.view.lastMetric = metric ?? null;
}

function ensureViewUpdateStat(id) {
  if (typeof id !== "string" || id.length === 0) return null;
  let stat = perf.runtime.viewUpdates.get(id);
  if (!stat) {
    if (perf.runtime.viewUpdates.size >= MAX_VIEW_UPDATE_IDS) return null;
    stat = {
      count: 0,
      totalMs: 0,
      lastMs: 0,
      maxMs: 0,
    };
    perf.runtime.viewUpdates.set(id, stat);
  }
  return stat;
}

export function recordViewUpdate(id, ms) {
  if (!isPerfActive()) return;
  const stat = ensureViewUpdateStat(id);
  if (!stat) return;
  const value = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  stat.count += 1;
  stat.totalMs += value;
  stat.lastMs = value;
  if (value > stat.maxMs) stat.maxMs = value;
}

export function recordViewFrame(ms) {
  if (!isPerfActive()) return;
  const value = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  perf.runtime.frame.count += 1;
  perf.runtime.frame.lastMs = value;
  if (value > perf.runtime.frame.maxMs) perf.runtime.frame.maxMs = value;
}

export function recordScrubCommit({ moved = false, ok = true, ms = 0 } = {}) {
  if (!isPerfActive()) return;
  perf.runtime.scrub.commitCalls += 1;
  if (moved) perf.runtime.scrub.commitMoved += 1;
  if (!ok) perf.runtime.scrub.commitFailed += 1;
  perf.runtime.scrub.commitLastMs =
    Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

export function recordScrubBrowse({ moved = false, ok = true, ms = 0 } = {}) {
  if (!isPerfActive()) return;
  perf.runtime.scrub.browseCalls += 1;
  if (moved) perf.runtime.scrub.browseMoved += 1;
  if (!ok) perf.runtime.scrub.browseFailed += 1;
  perf.runtime.scrub.browseLastMs =
    Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

export function recordPlannerCommit({ ok = true, ms = 0, committed = 0 } = {}) {
  if (!isPerfActive()) return;
  const elapsed = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  perf.runtime.planner.commitCalls += 1;
  if (!ok) perf.runtime.planner.commitFailed += 1;
  perf.runtime.planner.commitLastMs = elapsed;
  if (elapsed > perf.runtime.planner.commitMaxMs) {
    perf.runtime.planner.commitMaxMs = elapsed;
  }
  perf.runtime.planner.committedActionsLast = Number.isFinite(committed)
    ? Math.max(0, Math.floor(committed))
    : 0;
}

export function recordActionDispatch({ ok = true, ms = 0 } = {}) {
  if (!isPerfActive()) return;
  const elapsed = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  perf.runtime.actionDispatch.calls += 1;
  if (!ok) perf.runtime.actionDispatch.failed += 1;
  perf.runtime.actionDispatch.lastMs = elapsed;
  if (elapsed > perf.runtime.actionDispatch.maxMs) {
    perf.runtime.actionDispatch.maxMs = elapsed;
  }
}

export function resetPerfCounters() {
  perf.timeline.rebuild.count = 0;
  perf.timeline.rebuild.memoHits = 0;
  perf.timeline.rebuild.memoMisses = 0;
  perf.timeline.rebuild.lastMs = 0;

  perf.timeline.checkpoints.count = 0;
  perf.timeline.checkpoints.lastMs = 0;

  perf.projection.history.lastMs = 0;
  perf.projection.history.lastPoints = 0;
  perf.projection.forecast.lastMs = 0;
  perf.projection.forecast.lastPoints = 0;
  perf.projection.stateWindow.lastMs = 0;
  perf.projection.stateWindow.lastPoints = 0;

  perf.timegraph.cacheHits = 0;
  perf.timegraph.cacheMisses = 0;

  perf.view.lastMs = 0;
  perf.view.lastPoints = 0;
  perf.view.lastMetric = null;

  perf.runtime.scrub.commitCalls = 0;
  perf.runtime.scrub.commitMoved = 0;
  perf.runtime.scrub.commitFailed = 0;
  perf.runtime.scrub.commitLastMs = 0;
  perf.runtime.scrub.browseCalls = 0;
  perf.runtime.scrub.browseMoved = 0;
  perf.runtime.scrub.browseFailed = 0;
  perf.runtime.scrub.browseLastMs = 0;

  perf.runtime.planner.commitCalls = 0;
  perf.runtime.planner.commitFailed = 0;
  perf.runtime.planner.commitLastMs = 0;
  perf.runtime.planner.commitMaxMs = 0;
  perf.runtime.planner.committedActionsLast = 0;

  perf.runtime.actionDispatch.calls = 0;
  perf.runtime.actionDispatch.failed = 0;
  perf.runtime.actionDispatch.lastMs = 0;
  perf.runtime.actionDispatch.maxMs = 0;

  perf.runtime.frame.count = 0;
  perf.runtime.frame.lastMs = 0;
  perf.runtime.frame.maxMs = 0;

  perf.runtime.viewUpdates.clear();
}

export function getTopViewUpdates(limit = 10, metric = "avgMs") {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.floor(limit))
    : 10;
  const key = metric === "maxMs" ? "maxMs" : "avgMs";
  const rows = [];
  for (const [id, stat] of perf.runtime.viewUpdates.entries()) {
    const count = Math.max(0, Math.floor(stat?.count ?? 0));
    const totalMs = Number.isFinite(stat?.totalMs) ? stat.totalMs : 0;
    const avgMs = count > 0 ? totalMs / count : 0;
    const maxMs = Number.isFinite(stat?.maxMs) ? stat.maxMs : 0;
    rows.push({
      id,
      count,
      avgMs,
      maxMs,
      lastMs: Number.isFinite(stat?.lastMs) ? stat.lastMs : 0,
    });
  }
  rows.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
  return rows.slice(0, safeLimit);
}

export function getPerfCounters() {
  return perf;
}

export function getPerfSnapshot({ timeline, controllers } = {}) {
  if (!isPerfActive()) return { ok: false, reason: "perfDisabled" };

  const tl = timeline ?? null;
  const actionsCount = Array.isArray(tl?.actions) ? tl.actions.length : 0;
  const checkpointsCount = Array.isArray(tl?.checkpoints)
    ? tl.checkpoints.length
    : 0;
  const memoSize =
    tl?.memoStateBySec && typeof tl.memoStateBySec.size === "number"
      ? tl.memoStateBySec.size
      : 0;
  const memoBytes = Number.isFinite(tl?.memoBytesTotal)
    ? Math.max(0, Math.floor(tl.memoBytesTotal))
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
  const maxForecastBytes = controllerData.reduce((acc, d) => {
    const bytes = Number.isFinite(d?.projectionCacheApproxBytes)
      ? d.projectionCacheApproxBytes
      : 0;
    return Math.max(acc, bytes);
  }, 0);
  const maxForecastMaxBytes = controllerData.reduce((acc, d) => {
    const bytes = Number.isFinite(d?.projectionCacheMaxBytes)
      ? d.projectionCacheMaxBytes
      : 0;
    return Math.max(acc, bytes);
  }, 0);
  const viewUpdates = {};
  for (const [id, stat] of perf.runtime.viewUpdates.entries()) {
    const count = Math.max(0, Math.floor(stat?.count ?? 0));
    const totalMs = Number.isFinite(stat?.totalMs) ? stat.totalMs : 0;
    viewUpdates[id] = {
      count,
      avgMs: count > 0 ? totalMs / count : 0,
      lastMs: Number.isFinite(stat?.lastMs) ? stat.lastMs : 0,
      maxMs: Number.isFinite(stat?.maxMs) ? stat.maxMs : 0,
    };
  }

  return {
    ok: true,
    timeline: {
      revision: Math.floor(tl?.revision ?? 0),
      actions: actionsCount,
      checkpoints: checkpointsCount,
      memoSize,
      memoBytes,
      actionsBySecSize,
    },
    graphs: {
      forecastCacheSize: maxForecastCache,
      forecastCacheCap: maxForecastCap,
      forecastCacheBytes: maxForecastBytes,
      forecastCacheMaxBytes: maxForecastMaxBytes,
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
    runtime: {
      frameCount: perf.runtime.frame.count,
      frameLastMs: perf.runtime.frame.lastMs,
      frameMaxMs: perf.runtime.frame.maxMs,
      scrubCommitCalls: perf.runtime.scrub.commitCalls,
      scrubCommitMoved: perf.runtime.scrub.commitMoved,
      scrubCommitFailed: perf.runtime.scrub.commitFailed,
      scrubCommitLastMs: perf.runtime.scrub.commitLastMs,
      scrubBrowseCalls: perf.runtime.scrub.browseCalls,
      scrubBrowseMoved: perf.runtime.scrub.browseMoved,
      scrubBrowseFailed: perf.runtime.scrub.browseFailed,
      scrubBrowseLastMs: perf.runtime.scrub.browseLastMs,
      plannerCommitCalls: perf.runtime.planner.commitCalls,
      plannerCommitFailed: perf.runtime.planner.commitFailed,
      plannerCommitLastMs: perf.runtime.planner.commitLastMs,
      plannerCommitMaxMs: perf.runtime.planner.commitMaxMs,
      plannerCommittedActionsLast: perf.runtime.planner.committedActionsLast,
      actionDispatchCalls: perf.runtime.actionDispatch.calls,
      actionDispatchFailed: perf.runtime.actionDispatch.failed,
      actionDispatchLastMs: perf.runtime.actionDispatch.lastMs,
      actionDispatchMaxMs: perf.runtime.actionDispatch.maxMs,
      viewUpdates,
    },
  };
}

