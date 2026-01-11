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
  const HORIZON = 120;
  const BACK_CONTEXT = 20;

  let cache = null; // { history, maxReachedBoundaryIndex, stateDataByBoundary, window }
  let goldByBoundary = new Map();

  // Change detection
  let lastKnownActionsLen = 0;
  let lastKnownMaxReached = 0;
  let lastKnownForecastBase = 0;

  function rebuildGoldMapFromCache() {
    goldByBoundary = new Map();
    if (!cache) return;

    if (Array.isArray(cache.history)) {
      for (const p of cache.history)
        goldByBoundary.set(p.boundaryIndex, p.gold ?? 0);
    }
    const wf = cache.window?.forecast;
    if (Array.isArray(wf)) {
      for (const p of wf) goldByBoundary.set(p.boundaryIndex, p.gold ?? 0);
    }
  }

  function ensureForecastFromFrontier() {
    const tl = getTimeline?.();
    if (!cache || !tl) return { ok: false, reason: "noTimeline" };

    const frontierB = Math.max(0, Math.floor(tl.maxReachedBoundaryIndex ?? 0));
    if (frontierB === lastKnownForecastBase && cache.window?.forecast?.length) {
      return { ok: true };
    }

    const winRes = buildGoldGraphWindowFromTimeline(tl, frontierB, {
      horizon: HORIZON,
      backContext: BACK_CONTEXT,
    });

    if (!winRes.ok) return winRes;

    cache.window = winRes.window;
    lastKnownForecastBase = frontierB;

    if (!cache.stateDataByBoundary) cache.stateDataByBoundary = new Map();
    for (const [b, sd] of winRes.stateDataByBoundary.entries()) {
      cache.stateDataByBoundary.set(b, sd);
    }

    rebuildGoldMapFromCache();
    return { ok: true };
  }

  function extendHistoryTo(newMaxReached) {
    const tl = getTimeline?.();
    if (!cache || !tl) return false;

    const oldMax = Math.max(0, Math.floor(cache.maxReachedBoundaryIndex ?? 0));
    const target = Math.max(0, Math.floor(newMaxReached ?? 0));
    if (target <= oldMax) return true;

    if (!Array.isArray(cache.history)) cache.history = [];
    if (!cache.stateDataByBoundary) cache.stateDataByBoundary = new Map();

    for (let b = oldMax + 1; b <= target; b++) {
      const s = getStateAtBoundaryFromGoldGraphCache(cache, tl, b);
      if (!s) return false;

      canonicalizePlanningBoundaryState(s, b);

      const gold = s.resources?.gold ?? s.gold ?? 0;
      cache.history.push({ boundaryIndex: b, gold });
      goldByBoundary.set(b, gold);

      cache.stateDataByBoundary.set(b, serializeGameState(s));
    }

    cache.maxReachedBoundaryIndex = target;
    return true;
  }

  function trimHistoryTo(targetMax) {
    if (!cache || !Array.isArray(cache.history)) return;
    const t = Math.max(0, Math.floor(targetMax ?? 0));

    cache.history = cache.history.filter(
      (p) => Math.floor(p.boundaryIndex) <= t
    );
    cache.maxReachedBoundaryIndex = t;

    for (const k of goldByBoundary.keys()) {
      if (k > t) goldByBoundary.delete(k);
    }
  }

  function patchHistoryAtBoundary(b) {
    const tl = getTimeline?.();
    if (!cache || !tl) return false;

    const boundary = Math.max(0, Math.floor(b));
    const rebuilt = getStateAtBoundary(tl, boundary);
    if (!rebuilt?.ok) return false;

    const s = rebuilt.state;
    canonicalizePlanningBoundaryState(s, boundary);

    const gold = s.resources?.gold ?? s.gold ?? 0;

    let replaced = false;
    for (let i = 0; i < cache.history.length; i++) {
      if (Math.floor(cache.history[i].boundaryIndex) === boundary) {
        cache.history[i] = { boundaryIndex: boundary, gold };
        replaced = true;
        break;
      }
    }
    if (!replaced) cache.history.push({ boundaryIndex: boundary, gold });

    cache.history.sort(
      (a, b) => Math.floor(a.boundaryIndex) - Math.floor(b.boundaryIndex)
    );
    goldByBoundary.set(boundary, gold);

    if (!cache.stateDataByBoundary) cache.stateDataByBoundary = new Map();
    cache.stateDataByBoundary.set(boundary, serializeGameState(s));

    return true;
  }

  function buildFullCache() {
    const tl = getTimeline?.();
    if (!tl) {
      cache = null;
      goldByBoundary = new Map();
      return { ok: false, reason: "no timeline" };
    }

    const frontierB = Math.max(0, Math.floor(tl.maxReachedBoundaryIndex ?? 0));

    const res = buildGoldGraphCacheFromTimeline(tl, {
      baseBoundary: frontierB,
      horizon: HORIZON,
      backContext: BACK_CONTEXT,
    });

    if (!res.ok) {
      cache = null;
      goldByBoundary = new Map();
      return res;
    }

    cache = res.cache;
    lastKnownActionsLen = Array.isArray(tl.actions) ? tl.actions.length : 0;
    lastKnownMaxReached = frontierB;
    lastKnownForecastBase = frontierB;

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
    const maxReached = Math.max(0, Math.floor(tl.maxReachedBoundaryIndex ?? 0));
    const curB = Math.max(
      0,
      Math.floor(cs.planningIndex ?? tl.cursorBoundaryIndex ?? 0)
    );

    if (!cache) return buildFullCache();

    // 1) Normal extension
    if (
      actionsLen === lastKnownActionsLen &&
      maxReached >= lastKnownMaxReached
    ) {
      const ok = extendHistoryTo(maxReached);
      if (!ok) return buildFullCache();

      lastKnownMaxReached = maxReached;
      ensureForecastFromFrontier(); // Rebuild forecast if frontier moved
      return { ok: true };
    }

    // 2) Branching / Edit
    if (actionsLen !== lastKnownActionsLen) {
      trimHistoryTo(maxReached);
      const okPatch = patchHistoryAtBoundary(curB);
      if (!okPatch) return buildFullCache();

      lastKnownActionsLen = actionsLen;
      lastKnownMaxReached = maxReached;

      // Force forecast rebuild
      lastKnownForecastBase = -1;
      if (cache?.window) cache.window = null;
      ensureForecastFromFrontier();

      rebuildGoldMapFromCache();
      return { ok: true };
    }

    // 3) Scrubbing (no change to structure)
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
      HORIZON,
      BACK_CONTEXT,
    };
  }

  function getStateAt(boundaryIndex) {
    const tl = getTimeline?.();
    if (!cache || !tl) return null;
    return getStateAtBoundaryFromGoldGraphCache(cache, tl, boundaryIndex);
  }

  return {
    ensureCache,
    handleInvalidate,
    update,
    getData,
    getStateAt,
  };
}
