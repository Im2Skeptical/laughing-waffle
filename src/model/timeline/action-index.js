// src/model/timeline/action-index.js
// Action-second index and sampling caches extracted from timeline.js.

export const ACTION_SECONDS_RANGE_CACHE_MAX = 256;

export function indexActionsBySecond(actions) {
  const map = new Map();
  for (const a of actions || []) {
    const s = Math.max(0, Math.floor(a.tSec ?? 0));
    if (!map.has(s)) map.set(s, []);
    map.get(s).push(a);
  }
  return map;
}

export function computeActionsMutationSig(tl) {
  const acts = Array.isArray(tl.actions) ? tl.actions : [];
  const aLen = acts.length;
  const aLast = aLen ? acts[aLen - 1] : null;
  return {
    aRef: tl.actions,
    aLen,
    aLastRef: aLast,
    aLastSec: aLast ? Math.floor(aLast.tSec ?? 0) : 0,
  };
}

export function actionsSigEquals(a, b) {
  if (!a || !b) return false;
  return (
    a.aRef === b.aRef &&
    a.aLen === b.aLen &&
    a.aLastRef === b.aLastRef &&
    a.aLastSec === b.aLastSec
  );
}

export function ensureActionSecondsVersion(tl) {
  if (!Number.isFinite(tl?._actionSecondsVersion)) {
    tl._actionSecondsVersion = 0;
  }
  tl._actionSecondsVersion = Math.max(0, Math.floor(tl._actionSecondsVersion));
  return tl._actionSecondsVersion;
}

export function markActionSecondsChanged(tl) {
  tl._actionSecondsVersion = ensureActionSecondsVersion(tl) + 1;
  if (tl._actionSecondsRangeCache) {
    tl._actionSecondsRangeCache = null;
  }
  if (tl._actionSecondsIndexCache) {
    tl._actionSecondsIndexCache = null;
  }
  return tl._actionSecondsVersion;
}

export function lowerBoundSorted(list, target) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function upperBoundSorted(list, target) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function putActionSecondsRangeCache(cache, key, secs) {
  if (!cache || !cache.map || key == null) return;
  cache.map.delete(key);
  cache.map.set(key, secs);
  while (cache.map.size > cache.max) {
    const oldest = cache.map.keys().next().value;
    if (oldest == null) break;
    cache.map.delete(oldest);
  }
}

export function insertSortedSecond(list, sec) {
  if (!Array.isArray(list)) return false;
  const s = Math.max(0, Math.floor(sec ?? 0));
  const idx = lowerBoundSorted(list, s);
  if (list[idx] === s) return false;
  list.splice(idx, 0, s);
  return true;
}

export function removeSortedSecond(list, sec) {
  if (!Array.isArray(list)) return false;
  const s = Math.max(0, Math.floor(sec ?? 0));
  const idx = lowerBoundSorted(list, s);
  if (list[idx] !== s) return false;
  list.splice(idx, 1);
  return true;
}

export function ensureActionSecondsIndex(tl) {
  const sorted = tl._actionSecondsSorted;
  if (Array.isArray(sorted)) {
    return sorted;
  }
  const secs = Array.from(tl.actionsBySec?.keys?.() ?? [])
    .map((secRaw) => Math.max(0, Math.floor(secRaw)))
    .sort((a, b) => a - b);
  tl._actionSecondsSorted = secs;
  return secs;
}

export function ensureActionSecondsRangeCache(tl) {
  const actionSecondsVersion = ensureActionSecondsVersion(tl);
  const cache = tl._actionSecondsRangeCache;
  if (
    !cache ||
    cache.actionSecondsVersion !== actionSecondsVersion ||
    !cache.map ||
    !Number.isFinite(cache.max)
  ) {
    tl._actionSecondsRangeCache = {
      actionSecondsVersion,
      map: new Map(),
      max: ACTION_SECONDS_RANGE_CACHE_MAX,
    };
  }
  return tl._actionSecondsRangeCache;
}

export function rebuildActionsBySecIndex(tl) {
  const bySec = indexActionsBySecond(tl.actions);
  tl.actionsBySec = bySec;
  tl._actionSecondsSorted = Array.from(bySec.keys())
    .map((secRaw) => Math.max(0, Math.floor(secRaw)))
    .sort((a, b) => a - b);
  markActionSecondsChanged(tl);
  tl._actionsBySecSig = computeActionsMutationSig(tl);
}

export function ensureActionsBySecFresh(tl) {
  const cur = computeActionsMutationSig(tl);
  if (!actionsSigEquals(cur, tl._actionsBySecSig) || !tl.actionsBySec) {
    rebuildActionsBySecIndex(tl);
  }
}
