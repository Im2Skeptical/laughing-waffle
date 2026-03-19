// src/model/timegraph/projection-cache.js

import {
  buildProjectionStateStepWindowFromTimeline,
  buildProjectionStateStepWindowFromStateData,
  buildProjectionStateWindowFromStateData,
} from "../projection.js";
import {
  absorbTimelinePersistentKnowledge,
  getStateDataAtSecond,
} from "../timeline/index.js";
import {
  DEFAULT_PROJECTION_CACHE_MAX_BYTES,
  DEFAULT_STATE_DATA_ESTIMATE_BYTES,
} from "./constants.js";
import { clampSec } from "./utils.js";

function computeTimelineSignature(tl) {
  // Projection cache should only reset when replay-relevant data changes.
  // We intentionally ignore checkpoint churn (revision bumps) here.
  const actions = Array.isArray(tl?.actions) ? tl.actions : [];
  const len = actions.length;
  const last = len ? actions[len - 1] : null;
  const persistentKnowledgeRef = tl?.persistentKnowledge ?? null;
  return {
    baseRef: tl?.baseStateData ?? null,
    actionsRef: actions,
    actionsLen: len,
    lastRef: last,
    lastSec: last ? Math.floor(last.tSec ?? 0) : 0,
    persistentKnowledgeRef,
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
    a.persistentKnowledgeRef === b.persistentKnowledgeRef
  );
}

export function createProjectionCache({
  maxBytes = DEFAULT_PROJECTION_CACHE_MAX_BYTES,
  maxEntries = null,
} = {}) {
  let signature = null;
  let signatureVersion = 0;
  let forecastBaseSec = 0;
  let forecastEndSec = 0;
  let forecastStepSec = 1;
  let forecastDtStep = null;
  let forecastAsyncBaseSec = 0;
  let forecastAsyncEndSec = 0;
  let forecastAsyncStepSec = 1;
  let forecastAsyncToken = null;
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
    signatureVersion += 1;
    forecastBaseSec = 0;
    forecastEndSec = 0;
    forecastStepSec = 1;
    forecastDtStep = null;
    forecastAsyncBaseSec = 0;
    forecastAsyncEndSec = 0;
    forecastAsyncStepSec = 1;
    forecastAsyncToken = null;
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
    return { changed, signature, signatureVersion };
  }

  function getTimelineToken(tl) {
    ensureSignature(tl);
    return `sig:${signatureVersion}`;
  }

  function shouldAbsorbPersistentKnowledge(opts = {}) {
    return opts?.absorbPersistentKnowledge !== false;
  }

  function ensureForecastWindow(tl, targetEndSec, dtStep, stepSec, opts = {}) {
    if (!tl) return { ok: false, reason: "noTimeline" };
    ensureSignature(tl);
    const absorbKnowledge = shouldAbsorbPersistentKnowledge(opts);

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
      const knownSec = Math.min(forecastEndSec, targetBoundaryEnd);
      const knownData = stateDataBySecond.get(knownSec);
      if (absorbKnowledge && knownData != null) {
        absorbTimelinePersistentKnowledge(tl, knownData);
      }
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
        const knownSec = Math.min(forecastEndSec, targetBoundaryEnd);
        const knownData = stateDataBySecond.get(knownSec);
        if (absorbKnowledge && knownData != null) {
          absorbTimelinePersistentKnowledge(tl, knownData);
        }
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
        const knownSec = Math.min(forecastEndSec, targetBoundaryEnd);
        const knownData = stateDataBySecond.get(knownSec);
        if (absorbKnowledge && knownData != null) {
          absorbTimelinePersistentKnowledge(tl, knownData);
        }
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
    const knownData = stateDataBySecond.get(forecastEndSec);
    if (absorbKnowledge && knownData != null) {
      absorbTimelinePersistentKnowledge(tl, knownData);
    }

    return { ok: true };
  }

  function ensureStateAtSecond(tl, sec, dtStep, stepSec, opts = {}) {
    if (!tl) return { ok: false, reason: "noTimeline" };

    ensureSignature(tl);
    const absorbKnowledge = shouldAbsorbPersistentKnowledge(opts);

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
    if (cached != null) {
      if (absorbKnowledge) {
        absorbTimelinePersistentKnowledge(tl, cached);
      }
      return { ok: true, stateData: cached };
    }

    const step =
      typeof stepSec === "number" && stepSec > 0 ? Math.floor(stepSec) : 1;

    const forecastRes = ensureForecastWindow(tl, t, dtStep, step, opts);
    if (!forecastRes.ok) return forecastRes;

    const forecastData = touch(t);
    if (forecastData != null) {
      if (absorbKnowledge) {
        absorbTimelinePersistentKnowledge(tl, forecastData);
      }
      return { ok: true, stateData: forecastData };
    }

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
              if (absorbKnowledge) {
                absorbTimelinePersistentKnowledge(tl, sd);
              }
              return { ok: true, stateData: sd };
            }
          }
        } else if (delta === 0) {
          setForecastState(t, historyEnd, anchorData);
          if (absorbKnowledge) {
            absorbTimelinePersistentKnowledge(tl, anchorData);
          }
          return { ok: true, stateData: anchorData };
        }
      }
    }

    return { ok: false, reason: "forecastMissing" };
  }

  function mergeForecastChunk(tl, chunk = {}) {
    if (!tl) return { ok: false, reason: "noTimeline" };

    const token = typeof chunk?.timelineToken === "string"
      ? chunk.timelineToken
      : null;
    if (!token) return { ok: false, reason: "missingTimelineToken" };

    const chunkHistoryEndSec = clampSec(chunk?.historyEndSec ?? tl.historyEndSec ?? 0);
    const currentHistoryEndSec = clampSec(tl?.historyEndSec ?? chunkHistoryEndSec);
    const baseSec = clampSec(chunk?.baseSec ?? chunkHistoryEndSec);
    const endSec = clampSec(chunk?.endSec ?? baseSec);
    const stepSec = Math.max(1, Math.floor(chunk?.stepSec ?? 1));
    const currentToken = getTimelineToken(tl);
    if (currentToken !== token) {
      return { ok: false, reason: "staleTimelineToken" };
    }
    purgePastForecastIfNeeded(currentHistoryEndSec);

    if (
      forecastAsyncToken !== token ||
      forecastAsyncStepSec !== stepSec
    ) {
      forecastAsyncToken = token;
      forecastAsyncBaseSec = baseSec;
      forecastAsyncEndSec = Math.max(baseSec, currentHistoryEndSec);
      forecastAsyncStepSec = stepSec;
    }
    if (baseSec < forecastAsyncBaseSec || baseSec > forecastAsyncEndSec) {
      return { ok: false, reason: "staleBaseSec" };
    }

    const entries = Array.isArray(chunk?.stateDataBySecond)
      ? chunk.stateDataBySecond
      : chunk?.stateDataBySecond instanceof Map
        ? Array.from(chunk.stateDataBySecond.entries())
        : [];
    for (const entry of entries) {
      const sec = Array.isArray(entry) ? entry[0] : entry?.sec;
      const stateData = Array.isArray(entry) ? entry[1] : entry?.stateData;
      if (stateData == null) continue;
      setForecastState(sec, currentHistoryEndSec, stateData);
    }

    if (chunk?.lastStateData != null) {
      setForecastState(endSec, currentHistoryEndSec, chunk.lastStateData);
      absorbTimelinePersistentKnowledge(tl, chunk.lastStateData);
    }

    forecastAsyncEndSec = Math.max(forecastAsyncEndSec, endSec);
    return {
      ok: true,
      forecastAsyncEndSec,
    };
  }

  return {
    ensureSignature,
    getTimelineToken,
    ensureStateAtSecond,
    ensureForecastWindow,
    mergeForecastChunk,
    getForecastAsyncMeta: () => ({
      forecastAsyncBaseSec,
      forecastAsyncEndSec,
      forecastAsyncStepSec,
      forecastAsyncToken,
    }),
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
