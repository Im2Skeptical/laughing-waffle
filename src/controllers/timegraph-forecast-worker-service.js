import { buildProjectionChunkFromStateData } from "../model/projection-chunk.js";

export const TIMEGRAPH_FORECAST_CHUNK_SIZE_SEC = 200;
export const TIMEGRAPH_FORECAST_REQUEST_CADENCE_MS = 2000;

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function clampSec(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeActionsBySecond(actionsBySecond, baseSec, endSec) {
  const out = [];
  const minSec = clampSec(baseSec) + 1;
  const maxSec = clampSec(endSec);
  if (maxSec < minSec) return out;

  const pushEntry = (secRaw, actionsRaw) => {
    const sec = clampSec(secRaw);
    if (sec < minSec || sec > maxSec) return;
    const actions = Array.isArray(actionsRaw) ? actionsRaw : [];
    if (!actions.length) return;
    out.push({
      tSec: sec,
      actions: actions.map((action) => ({ ...action, tSec: sec })),
    });
  };

  if (actionsBySecond instanceof Map) {
    for (const [sec, actions] of actionsBySecond.entries()) {
      pushEntry(sec, actions);
    }
  } else if (Array.isArray(actionsBySecond)) {
    for (const entry of actionsBySecond) {
      pushEntry(entry?.tSec ?? entry?.sec ?? entry?.second ?? 0, entry?.actions);
    }
  } else if (actionsBySecond && typeof actionsBySecond === "object") {
    for (const [sec, actions] of Object.entries(actionsBySecond)) {
      pushEntry(Number(sec), actions);
    }
  }

  out.sort((left, right) => left.tSec - right.tSec);
  return out;
}

function normalizeChunkEntries(entries) {
  if (entries instanceof Map) return Array.from(entries.entries());
  return Array.isArray(entries) ? entries : [];
}

export function createTimegraphForecastWorkerService({
  createWorker = null,
  timeNowMs = nowMs,
  chunkSizeSec = TIMEGRAPH_FORECAST_CHUNK_SIZE_SEC,
  requestCadenceMs = TIMEGRAPH_FORECAST_REQUEST_CADENCE_MS,
} = {}) {
  let worker = null;
  let nextRequestId = 1;
  const requestsById = new Map();
  const requestsByKey = new Map();

  function ensureWorker() {
    if (worker) return worker;
    if (typeof createWorker === "function") {
      worker = createWorker();
    } else if (typeof Worker === "function") {
      worker = new Worker(
        new URL("./timegraph-forecast-worker.js", import.meta.url),
        { type: "module" }
      );
    } else {
      return null;
    }
    if (worker && typeof worker.addEventListener === "function") {
      worker.addEventListener("message", handleWorkerMessage);
    } else if (worker) {
      worker.onmessage = handleWorkerMessage;
    }
    return worker;
  }

  function releaseRequest(requestId) {
    const request = requestsById.get(requestId);
    if (!request) return null;
    requestsById.delete(requestId);
    const entry = requestsByKey.get(request.requestKey);
    if (entry?.inFlight?.requestId === requestId) {
      entry.inFlight = null;
    }
    return request;
  }

  function handleWorkerMessage(event) {
    const message = event?.data ?? null;
    if (!message || message.kind !== "chunkResult") return;

    const request = releaseRequest(message.requestId);
    if (!request) return;

    const entry = requestsByKey.get(request.requestKey);
    const projectionCache = request.projectionCache;
    const timeline = request.timeline;
    if (!projectionCache || !timeline) return;

    const merged = projectionCache.mergeForecastChunk?.(timeline, {
      timelineToken: message.timelineToken,
      historyEndSec: message.historyEndSec,
      baseSec: message.baseSec,
      endSec: message.endSec,
      stepSec: message.stepSec,
      stateDataBySecond: normalizeChunkEntries(message.result?.stateDataBySecond),
      lastStateData: message.result?.lastStateData ?? null,
    });

    if (!entry) return;
    if (merged?.ok === true && message.result?.ok === true) {
      entry.coverageEndSec = Math.max(
        clampSec(entry.coverageEndSec),
        clampSec(message.endSec)
      );
    }
  }

  function getCoverageMeta(projectionCache, timelineToken, historyEndSec, stepSec) {
    const meta = projectionCache?.getForecastAsyncMeta?.() ?? null;
    const baseSec = clampSec(historyEndSec);
    const step = Math.max(1, Math.floor(stepSec ?? 1));
    if (
      meta &&
      meta.forecastAsyncToken === timelineToken &&
      clampSec(meta.forecastAsyncStepSec) === step
    ) {
      return {
        coverageEndSec: Math.max(baseSec, clampSec(meta.forecastAsyncEndSec)),
      };
    }
    return {
      coverageEndSec: baseSec,
    };
  }

  function requestCoverage({
    projectionCache,
    timeline,
    timelineToken,
    historyEndSec,
    stepSec,
    desiredEndSec,
    boundaryStateData,
    scheduledActionsBySecond,
  } = {}) {
    if (!projectionCache || !timeline) {
      return {
        ok: false,
        reason: "missingDependencies",
        coverageEndSec: clampSec(historyEndSec),
        pending: false,
        requestedEndSec: clampSec(historyEndSec),
      };
    }

    const workerInstance = ensureWorker();
    const baseSec = clampSec(historyEndSec);
    const requestedEndSec = Math.max(baseSec, clampSec(desiredEndSec));
    const normalizedStepSec = Math.max(1, Math.floor(stepSec ?? 1));
    const requestKey = `${timelineToken}|${normalizedStepSec}`;

    let entry = requestsByKey.get(requestKey);
    if (!entry) {
      const coverage = getCoverageMeta(
        projectionCache,
        timelineToken,
        baseSec,
        normalizedStepSec
      );
      entry = {
        requestKey,
        timelineToken,
        historyEndSec: baseSec,
        stepSec: normalizedStepSec,
        requestedEndSec,
        coverageEndSec: coverage.coverageEndSec,
        lastDispatchMs: -Infinity,
        inFlight: null,
        primedInitialChunk: false,
      };
      requestsByKey.set(requestKey, entry);
    } else {
      entry.requestedEndSec = Math.max(
        clampSec(entry.requestedEndSec),
        requestedEndSec
      );
      const coverage = getCoverageMeta(
        projectionCache,
        timelineToken,
        baseSec,
        normalizedStepSec
      );
      entry.coverageEndSec = coverage.coverageEndSec;
    }

    if (!workerInstance) {
      return {
        ok: false,
        reason: "workerUnavailable",
        coverageEndSec: entry.coverageEndSec,
        pending: false,
        requestedEndSec: entry.requestedEndSec,
      };
    }

    const pending = entry.requestedEndSec > entry.coverageEndSec;
    if (!pending) {
      return {
        ok: true,
        coverageEndSec: entry.coverageEndSec,
        pending: false,
        requestedEndSec: entry.requestedEndSec,
      };
    }

    if (!entry.primedInitialChunk && entry.coverageEndSec === baseSec) {
      const primeEndSec = Math.min(
        entry.requestedEndSec,
        baseSec + Math.max(1, Math.floor(chunkSizeSec))
      );
      if (primeEndSec > baseSec && boundaryStateData != null) {
        const primeActions = normalizeActionsBySecond(
          scheduledActionsBySecond,
          baseSec,
          primeEndSec
        );
        const primeRes = buildProjectionChunkFromStateData(
          boundaryStateData,
          baseSec,
          primeEndSec,
          {
            stepSec: normalizedStepSec,
            actionsBySecond: primeActions,
          }
        );
        if (primeRes?.ok === true) {
          const merged = projectionCache.mergeForecastChunk?.(timeline, {
            timelineToken,
            historyEndSec: baseSec,
            baseSec,
            endSec: primeEndSec,
            stepSec: normalizedStepSec,
            stateDataBySecond: Array.from(primeRes.stateDataBySecond.entries()),
            lastStateData: primeRes.lastStateData,
          });
          if (merged?.ok === true) {
            entry.coverageEndSec = Math.max(
              entry.coverageEndSec,
              clampSec(primeEndSec)
            );
          }
        }
      }
      entry.primedInitialChunk = true;
    }

    const pendingAfterPrime = entry.requestedEndSec > entry.coverageEndSec;
    if (!pendingAfterPrime) {
      return {
        ok: true,
        coverageEndSec: entry.coverageEndSec,
        pending: false,
        requestedEndSec: entry.requestedEndSec,
      };
    }

    const currentMs = timeNowMs();
    if (entry.inFlight || currentMs - entry.lastDispatchMs < requestCadenceMs) {
      return {
        ok: true,
        coverageEndSec: entry.coverageEndSec,
        pending: true,
        requestedEndSec: entry.requestedEndSec,
      };
    }

    const chunkBaseSec = entry.coverageEndSec;
    const chunkEndSec = Math.min(
      entry.requestedEndSec,
      chunkBaseSec + Math.max(1, Math.floor(chunkSizeSec))
    );
    if (chunkEndSec <= chunkBaseSec) {
      return {
        ok: true,
        coverageEndSec: entry.coverageEndSec,
        pending: false,
        requestedEndSec: entry.requestedEndSec,
      };
    }

    const chunkBoundaryStateData =
      chunkBaseSec === baseSec
        ? boundaryStateData
        : projectionCache.getStateData?.(chunkBaseSec) ?? null;
    if (chunkBoundaryStateData == null) {
      return {
        ok: false,
        reason: "missingChunkBoundaryStateData",
        coverageEndSec: entry.coverageEndSec,
        pending: true,
        requestedEndSec: entry.requestedEndSec,
      };
    }

    const requestId = nextRequestId++;
    entry.lastDispatchMs = currentMs;
    entry.inFlight = {
      requestId,
      baseSec: chunkBaseSec,
      endSec: chunkEndSec,
    };

    const request = {
      requestId,
      requestKey,
      projectionCache,
      timeline,
    };
    requestsById.set(requestId, request);

    const chunkActions = normalizeActionsBySecond(
      scheduledActionsBySecond,
      chunkBaseSec,
      chunkEndSec
    );

    workerInstance.postMessage({
      kind: "buildChunk",
      requestId,
      requestKey,
      timelineToken,
      historyEndSec: baseSec,
      baseSec: chunkBaseSec,
      endSec: chunkEndSec,
      stepSec: normalizedStepSec,
      boundaryStateData: chunkBoundaryStateData,
      scheduledActionsBySecond: chunkActions,
    });

    return {
      ok: true,
      coverageEndSec: entry.coverageEndSec,
      pending: true,
      requestedEndSec: entry.requestedEndSec,
    };
  }

  function handleTimelineInvalidation(_reason = "invalidate") {
    requestsById.clear();
    requestsByKey.clear();
  }

  function dispose() {
    requestsById.clear();
    requestsByKey.clear();
    if (!worker) return;
    if (typeof worker.removeEventListener === "function") {
      worker.removeEventListener("message", handleWorkerMessage);
    }
    worker.terminate?.();
    worker = null;
  }

  return {
    requestCoverage,
    handleTimelineInvalidation,
    dispose,
  };
}
