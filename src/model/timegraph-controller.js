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
import { canonicalizePlanningBoundaryState } from "./canonicalize.js";

export function createTimeGraphController({ getTimeline, getCursorState }) {
  const HORIZON_SEC = 1024;

  // Cache shape mirrors projection.js output:
  // {
  //   history: [{ tSec, boundaryIndex, gold }, ...],
  //   maxReachedBoundaryIndex: <alias of maxReachedSec>,
  //   maxReachedSec,
  //   stateDataByBoundary: Map<tSec, serializedState>,
  //   window: { baseSec, endSec, horizonSec, stepSec, forecast:[{tSec,boundaryIndex,gold}] }
  // }
  let cache = null;
  let goldByBoundary = new Map();

  // Change detection
  let lastKnownActionsLen = 0;
  let lastKnownMaxReachedSec = 0;
  let lastKnownForecastBaseSec = 0;

  function clampSec(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.floor(v));
  }

  function rebuildGoldMapFromCache() {
    goldByBoundary = new Map();
    if (!cache) return;

    if (Array.isArray(cache.history)) {
      for (const p of cache.history) {
        const x = clampSec(p.tSec ?? p.boundaryIndex ?? 0);
        goldByBoundary.set(x, p.gold ?? 0);
      }
    }

    const wf = cache.window?.forecast;
    if (Array.isArray(wf)) {
      for (const p of wf) {
        const x = clampSec(p.tSec ?? p.boundaryIndex ?? 0);
        goldByBoundary.set(x, p.gold ?? 0);
      }
    }
  }

  function ensureForecastFromFrontier() {
    const tl = getTimeline?.();
    if (!cache || !tl) return { ok: false, reason: "noTimeline" };

    const frontierSec = clampSec(tl.maxReachedSec ?? 0);

    // If the frontier hasn't moved and we already have a forecast, keep it.
    if (
      frontierSec === lastKnownForecastBaseSec &&
      cache.window?.forecast?.length
    ) {
      return { ok: true };
    }

    const winRes = buildGoldGraphWindowFromTimeline(tl, frontierSec, {
      baseSec: frontierSec,
      horizonSec: HORIZON_SEC,
      stepSec: 1,
      // mode defaults to timeWindow; do not use seasonEvent for time graphs
    });

    if (!winRes.ok) return winRes;

    cache.window = winRes.window;
    lastKnownForecastBaseSec = frontierSec;

    // Merge projected states into lookup map
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

    const oldMax = clampSec(cache.maxReachedSec ?? cache.maxReachedBoundaryIndex ?? 0);
    const target = clampSec(newMaxReachedSec ?? 0);
    if (target <= oldMax) return true;

    if (!Array.isArray(cache.history)) cache.history = [];
    if (!cache.stateDataByBoundary) cache.stateDataByBoundary = new Map();

    for (let sec = oldMax + 1; sec <= target; sec++) {
      // Prefer cache (fast path) if present; otherwise rebuild from timeline.
      const s = getStateAtBoundaryFromGoldGraphCache(cache, tl, sec);
      if (!s) return false;

      canonicalizePlanningBoundaryState(s, sec);

      const gold = s.resources?.gold ?? s.gold ?? 0;

      // IMPORTANT: view plots by tSec; keep boundaryIndex as legacy alias.
      cache.history.push({ tSec: sec, boundaryIndex: sec, gold });
      goldByBoundary.set(sec, gold);

      cache.stateDataByBoundary.set(sec, serializeGameState(s));
    }

    cache.maxReachedSec = target;
    cache.maxReachedBoundaryIndex = target; // legacy alias still used elsewhere
    return true;
  }

  function trimHistoryTo(targetMaxSec) {
    if (!cache || !Array.isArray(cache.history)) return;

    const t = clampSec(targetMaxSec ?? 0);

    cache.history = cache.history.filter((p) => {
      const sec = clampSec(p.tSec ?? p.boundaryIndex ?? 0);
      return sec <= t;
    });

    cache.maxReachedSec = t;
    cache.maxReachedBoundaryIndex = t;

    for (const k of goldByBoundary.keys()) {
      if (k > t) goldByBoundary.delete(k);
    }

    // NOTE: we do not purge stateDataByBoundary here; it can remain as a
    // performance cache. Scrub preview is authoritative (see getStateAt()).
  }

  function patchHistoryAtSecond(sec) {
    const tl = getTimeline?.();
    if (!cache || !tl) return false;

    const t = clampSec(sec);

    const rebuilt = getStateAtBoundary(tl, t);
    if (!rebuilt?.ok) return false;

    const s = rebuilt.state;
    canonicalizePlanningBoundaryState(s, t);

    const gold = s.resources?.gold ?? s.gold ?? 0;

    if (!Array.isArray(cache.history)) cache.history = [];

    let replaced = false;
    for (let i = 0; i < cache.history.length; i++) {
      const existingSec = clampSec(
        cache.history[i].tSec ?? cache.history[i].boundaryIndex ?? 0
      );
      if (existingSec === t) {
        cache.history[i] = { tSec: t, boundaryIndex: t, gold };
        replaced = true;
        break;
      }
    }
    if (!replaced) cache.history.push({ tSec: t, boundaryIndex: t, gold });

    cache.history.sort(
      (a, b) =>
        clampSec(a.tSec ?? a.boundaryIndex ?? 0) -
        clampSec(b.tSec ?? b.boundaryIndex ?? 0)
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

    const frontierSec = clampSec(tl.maxReachedSec ?? 0);

    const res = buildGoldGraphCacheFromTimeline(tl, {
      baseSec: frontierSec,
      horizonSec: HORIZON_SEC,
      stepSec: 1,
    });

    if (!res.ok) {
      cache = null;
      goldByBoundary = new Map();
      return res;
    }

    cache = res.cache;

    // Ensure we keep both names consistent for any remaining legacy callers.
    cache.maxReachedSec = clampSec(cache.maxReachedSec ?? frontierSec);
    cache.maxReachedBoundaryIndex = clampSec(
      cache.maxReachedBoundaryIndex ?? cache.maxReachedSec
    );

    lastKnownActionsLen = Array.isArray(tl.actions) ? tl.actions.length : 0;
    lastKnownMaxReachedSec = frontierSec;
    lastKnownForecastBaseSec = frontierSec;

    rebuildGoldMapFromCache();
    return { ok: true };
  }

  // Public API

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

    if (!cache) return buildFullCache();

    // 1) Normal extension: no structural change, frontier advanced
    if (actionsLen === lastKnownActionsLen && maxReachedSec >= lastKnownMaxReachedSec) {
      const ok = extendHistoryTo(maxReachedSec);
      if (!ok) return buildFullCache();

      lastKnownMaxReachedSec = maxReachedSec;

      // Rebuild forecast if frontier moved
      ensureForecastFromFrontier();
      return { ok: true };
    }

    // 2) Branching/Edit: action list length changed (truncate/append)
    if (actionsLen !== lastKnownActionsLen) {
      // By design, the timeline has already truncated future actions when editing in the past.
      // We only keep history up to the current frontier.
      trimHistoryTo(maxReachedSec);

      // Patch the point at the cursor second (useful for immediate graph correctness).
      // (We do not attempt to patch all seconds; full rebuild is the fallback if needed.)
      const okPatch = patchHistoryAtSecond(cursorSec);
      if (!okPatch) return buildFullCache();

      lastKnownActionsLen = actionsLen;
      lastKnownMaxReachedSec = maxReachedSec;

      // Force forecast rebuild from the new frontier
      lastKnownForecastBaseSec = -1;
      if (cache?.window) cache.window = null;
      ensureForecastFromFrontier();

      rebuildGoldMapFromCache();
      return { ok: true };
    }

    // 3) Scrubbing commit: structure didn't change (cursor moved), cache remains valid
    if (reason === "scrubCommit") {
      return { ok: true };
    }

    return buildFullCache();
  }

  function update() {
    if (!cache) ensureCache();
    ensureForecastFromFrontier();
  }

  function getData() {
    return {
      cache,
      goldByBoundary,
      HORIZON: HORIZON_SEC,
    };
  }

  // IMPORTANT: scrubbing preview must reflect the *current timeline*, even after edits.
  // So we rebuild from timeline first (authoritative), and only fall back to cache.
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
