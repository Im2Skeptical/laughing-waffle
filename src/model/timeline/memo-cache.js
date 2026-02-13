// src/model/timeline/memo-cache.js
// Memo cache helpers extracted from timeline.js to keep timeline orchestration focused.

export const DEFAULT_MEMO_MAX_BYTES = 24 * 1024 * 1024;
export const DEFAULT_STATE_DATA_ESTIMATE_BYTES = 32 * 1024;

function memoKey(_tl, sec) {
  return Math.max(0, Math.floor(sec));
}

export function ensureMemo(tl) {
  if (!tl.memoStateBySec) tl.memoStateBySec = new Map();
  if (!tl.memoFifo) tl.memoFifo = [];
  if (!tl.memoBytesByKey) tl.memoBytesByKey = new Map();
  if (!Number.isFinite(tl.memoBytesTotal) || tl.memoBytesTotal < 0) {
    tl.memoBytesTotal = 0;
  }
  if (!Number.isFinite(tl.memoMaxBytes) || tl.memoMaxBytes <= 0) {
    tl.memoMaxBytes = DEFAULT_MEMO_MAX_BYTES;
  } else {
    tl.memoMaxBytes = Math.floor(tl.memoMaxBytes);
  }
}

export function memoGetStateData(tl, sec) {
  if (!tl.memoStateBySec) return null;
  return tl.memoStateBySec.get(memoKey(tl, sec)) ?? null;
}

export function findNearestMemoStateDataAtOrBefore(tl, targetSec) {
  if (!tl?.memoStateBySec || tl.memoStateBySec.size === 0) return null;
  const target = Math.max(0, Math.floor(targetSec ?? 0));
  let bestSec = -1;
  let bestStateData = null;

  for (const [key, stateData] of tl.memoStateBySec.entries()) {
    const normalizedSec = Math.max(0, Math.floor(key ?? -1));
    if (!Number.isFinite(normalizedSec)) continue;
    if (normalizedSec > target) continue;
    if (normalizedSec < bestSec) continue;
    bestSec = normalizedSec;
    bestStateData = stateData;
  }

  if (bestSec < 0 || bestStateData == null) return null;
  return { checkpointSec: bestSec, stateData: bestStateData };
}

export function pruneMemoAtOrAfter(tl, startSec) {
  if (!tl?.memoStateBySec || tl.memoStateBySec.size === 0) return;
  const cutoff = Math.max(0, Math.floor(startSec ?? 0));

  for (const key of tl.memoStateBySec.keys()) {
    const sec = Math.max(0, Math.floor(key ?? -1));
    if (!Number.isFinite(sec) || sec < cutoff) continue;
    const removedBytes = tl.memoBytesByKey?.get?.(key) ?? 0;
    tl.memoStateBySec.delete(key);
    tl.memoBytesByKey?.delete?.(key);
    tl.memoBytesTotal = Math.max(0, (tl.memoBytesTotal ?? 0) - removedBytes);
  }

  if (Array.isArray(tl.memoFifo)) {
    tl.memoFifo = tl.memoFifo.filter((key) => {
      const sec = Math.max(0, Math.floor(key ?? -1));
      return Number.isFinite(sec) && sec < cutoff;
    });
  }
}

export function estimateStateDataBytes(tl, stateData) {
  if (!tl || stateData == null) return DEFAULT_STATE_DATA_ESTIMATE_BYTES;

  const samplesTaken = Math.floor(tl._stateDataSizeSamples ?? 0);
  const shouldSample = samplesTaken < 8 || samplesTaken % 8 === 0;

  const avg = Number.isFinite(tl._stateDataAvgBytes)
    ? Math.max(512, Math.floor(tl._stateDataAvgBytes))
    : DEFAULT_STATE_DATA_ESTIMATE_BYTES;

  if (!shouldSample) {
    tl._stateDataSizeSamples = samplesTaken + 1;
    return avg;
  }

  let bytes = avg;
  try {
    bytes = Math.max(512, JSON.stringify(stateData).length);
  } catch (_) {
    bytes = avg;
  }

  tl._stateDataSizeSamples = samplesTaken + 1;
  tl._stateDataAvgBytes = Number.isFinite(tl._stateDataAvgBytes)
    ? Math.floor(tl._stateDataAvgBytes * 0.75 + bytes * 0.25)
    : bytes;

  return bytes;
}

export function memoPutStateData(tl, sec, stateData) {
  ensureMemo(tl);
  const key = memoKey(tl, sec);
  const bytes = estimateStateDataBytes(tl, stateData);
  const existingBytes = tl.memoBytesByKey.get(key) ?? 0;

  if (!tl.memoStateBySec.has(key)) {
    tl.memoFifo.push(key);
  }
  tl.memoStateBySec.set(key, stateData);
  tl.memoBytesByKey.set(key, bytes);
  tl.memoBytesTotal += bytes - existingBytes;

  const maxBytes = tl.memoMaxBytes ?? DEFAULT_MEMO_MAX_BYTES;
  while (tl.memoBytesTotal > maxBytes && tl.memoFifo.length > 0) {
    const oldest = tl.memoFifo.shift();
    if (oldest == null) continue;
    const removedBytes = tl.memoBytesByKey.get(oldest) ?? 0;
    tl.memoStateBySec.delete(oldest);
    tl.memoBytesByKey.delete(oldest);
    tl.memoBytesTotal = Math.max(0, tl.memoBytesTotal - removedBytes);
  }
}
