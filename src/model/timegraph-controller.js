// src/model/timegraph-controller.js
// Logic controller for time-series projections (e.g. gold graph).
// Owns the cache, invalidation policies, and incremental updates.
// No Pixi imports.

import {
  buildGoldGraphCacheFromTimeline,
  buildGoldGraphWindowFromTimeline,
  getStateAtBoundaryFromGoldGraphCache,
  getStateAtBoundary,
} from "./projection.js";

import { serializeGameState } from "./state.js";
import { canonicalizeSnapshot } from "./canonicalize.js";

export function createTimeGraphController({
  getTimeline,
  getCursorState,

  // Stage 4: decouple plotting resolution from scrubbing resolution
  historyStrideSec = 5,
  forecastStepSec = 5,
  horizonSec = 1200,
} = {}) {
  let cache = null;
  let goldByBoundary = new Map();

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

  function rebuildGoldMapFromCache() {
    goldByBoundary = new Map();
    if (!cache) return;

    if (Array.isArray(cache.history)) {
      for (const p of cache.history) {
        const x = clampSec(p.tSec ?? 0);
        goldByBoundary.set(x, p.gold ?? 0);
      }
    }

    const wf = cache.window?.forecast;
    if (Array.isArray(wf)) {
      for (const p of wf) {
        const x = clampSec(p.tSec ?? 0);
        goldByBoundary.set(x, p.gold ?? 0);
      }
    }
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

    const winRes = buildGoldGraphWindowFromTimeline(tl, frontierSec, {
      baseSec: frontierSec,
      horizonSec: horizonSecCur,
      stepSec: forecastStepSecCur,
      // mode defaults to timeWindow
    });

    if (!winRes.ok) return winRes;

    cache.window = winRes.window;
    lastKnownForecastBaseSec = frontierSec;

    if (!cache.stateDataByBoundary) cache.stateDataByBoundary = new Map();
    for (const [sec, sd] of winRes.stateDataByBoundary.entries()) {
      cache.stateDataByBoundary.set(sec, sd);
    }

    rebuildGoldMapFromCache();
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

      const s = getStateAtBoundaryFromGoldGraphCache(cache, tl, sec);
      if (!s) return false;

      canonicalizeSnapshot(s, sec);

      const gold = s.resources?.gold ?? s.gold ?? 0;

      cache.history.push({ tSec: sec, gold });
      goldByBoundary.set(sec, gold);

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

    for (const k of goldByBoundary.keys()) {
      if (k > t) goldByBoundary.delete(k);
    }
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

    const gold = s.resources?.gold ?? s.gold ?? 0;

    if (!Array.isArray(cache.history)) cache.history = [];

    let replaced = false;
    for (let i = 0; i < cache.history.length; i++) {
      const existingSec = clampSec(
        cache.history[i].tSec ?? 0
      );
      if (existingSec === t) {
        cache.history[i] = { tSec: t, gold };
        replaced = true;
        break;
      }
    }
    if (!replaced) cache.history.push({ tSec: t, gold });

    cache.history.sort(
      (a, b) =>
        clampSec(a.tSec ?? 0) - clampSec(b.tSec ?? 0)
    );

    goldByBoundary.set(t, gold);

    if (!cache.stateDataByBoundary) cache.stateDataByBoundary = new Map();
    cache.stateDataByBoundary.set(t, serializeGameState(s));

    return true;
  }

  function buildFullCache() {
    const tl = getTimeline?.();
    if (!tl) {
      cache = null;
      goldByBoundary = new Map();
      return { ok: false, reason: "no timeline" };
    }

    // Normalize inputs into mutable locals
    historyStrideSecCur = clampStride(historyStrideSecCur, 5);
    forecastStepSecCur = clampStride(forecastStepSecCur, 5);
    horizonSecCur = clampStride(horizonSecCur, 1200);

    const frontierSec = clampSec(tl.maxReachedSec ?? 0);
    const tlRev = getTimelineRevision(tl);

    const res = buildGoldGraphCacheFromTimeline(tl, {
      baseSec: frontierSec,
      horizonSec: horizonSecCur,
      stepSec: forecastStepSecCur,
      historyStrideSec: historyStrideSecCur,
    });

    if (!res.ok) {
      cache = null;
      goldByBoundary = new Map();
      return res;
    }

    cache = res.cache;

    cache.maxReachedSec = clampSec(cache.maxReachedSec ?? frontierSec);

    lastKnownActionsLen = Array.isArray(tl.actions) ? tl.actions.length : 0;
    lastKnownMaxReachedSec = frontierSec;
    lastKnownForecastBaseSec = frontierSec;
    lastKnownRevision = tlRev;

    rebuildGoldMapFromCache();
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
      goldByBoundary = new Map();
      return { ok: false, reason: "no state" };
    }

    const actionsLen = Array.isArray(tl.actions) ? tl.actions.length : 0;
    const maxReachedSec = clampSec(tl.maxReachedSec ?? 0);
    const cursorSec = clampSec(cs.tSec ?? 0);
    const tlRev = getTimelineRevision(tl);

    if (!cache) return buildFullCache();

    // 0) Authoritative invalidation: timeline revision changed (Stage 3 contract)
    if (tlRev !== lastKnownRevision) {
      // safest path: keep cache object but bring it back in sync
      trimHistoryTo(maxReachedSec);
      patchHistoryAtSecond(cursorSec);

      lastKnownRevision = tlRev;
      lastKnownActionsLen = actionsLen;
      lastKnownMaxReachedSec = maxReachedSec;

      // Force forecast rebuild from new frontier
      lastKnownForecastBaseSec = -1;
      cache.window = null;
      ensureForecastFromFrontier(true);

      rebuildGoldMapFromCache();
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
      return { ok: true };
    }

    // 2) Branching/edit detected by action list length change (legacy fallback)
    if (actionsLen !== lastKnownActionsLen) {
      trimHistoryTo(maxReachedSec);

      const okPatch = patchHistoryAtSecond(cursorSec);
      if (!okPatch) return buildFullCache();

      lastKnownActionsLen = actionsLen;
      lastKnownMaxReachedSec = maxReachedSec;

      lastKnownForecastBaseSec = -1;
      cache.window = null;
      ensureForecastFromFrontier(true);

      rebuildGoldMapFromCache();
      return { ok: true };
    }

    // 3) Cursor-only movement: cache remains valid
    if (reason === "scrubCommit") {
      return { ok: true };
    }

    return buildFullCache();
  }

  function update() {
    if (!cache) ensureCache();
    ensureForecastFromFrontier(false);
  }

  function getData() {
    return {
      cache,
      goldByBoundary,
      horizonSec: horizonSecCur,
      historyStrideSec: historyStrideSecCur,
      forecastStepSec: forecastStepSecCur,
    };
  }

  // Scrubbing preview is authoritative: rebuild from timeline first, then fall back.
  function getStateAt(tSec) {
    const tl = getTimeline?.();
    if (!tl) return null;

    const sec = clampSec(tSec);

    const rebuilt = getStateAtBoundary(tl, sec);
    if (rebuilt?.ok) return rebuilt.state;

    if (!cache) return null;
    return getStateAtBoundaryFromGoldGraphCache(cache, tl, sec);
  }

  return {
    ensureCache,
    handleInvalidate,
    update,
    getData,
    getStateAt,
  };
}
