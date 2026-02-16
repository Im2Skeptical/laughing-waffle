// passive-timing.js
// Shared passive timing checks used by env/hub/item/pawn executors.

function normalizedCadenceSec(timing) {
  if (!timing || typeof timing !== "object") return null;
  if (!Number.isFinite(timing.cadenceSec)) return null;
  return Math.max(1, Math.floor(timing.cadenceSec));
}

function ensurePassiveTimingRuntimeState(state) {
  if (!state || typeof state !== "object") return null;
  if (!state.passiveTimingRuntime || typeof state.passiveTimingRuntime !== "object") {
    state.passiveTimingRuntime = { activeByKey: {} };
  }
  if (
    !state.passiveTimingRuntime.activeByKey ||
    typeof state.passiveTimingRuntime.activeByKey !== "object"
  ) {
    state.passiveTimingRuntime.activeByKey = {};
  }
  return state.passiveTimingRuntime.activeByKey;
}

function evaluatePassiveLifecycleTrigger(timing, state, options) {
  if (!timing || typeof timing !== "object") return null;
  if (timing.trigger !== "onFirstActive") return null;

  const passiveKey =
    typeof options?.passiveKey === "string" && options.passiveKey.length > 0
      ? options.passiveKey
      : null;
  const isActive = options?.isActive !== false;
  if (!passiveKey) return false;
  if (!isActive) return false;

  const activeByKey = ensurePassiveTimingRuntimeState(state);
  if (!activeByKey) return false;

  if (activeByKey[passiveKey] === true) return false;
  activeByKey[passiveKey] = true;
  return true;
}

export function passiveTimingPasses(timing, state, tSec, options = null) {
  if (!timing || typeof timing !== "object") return true;

  const lifecycleResult = evaluatePassiveLifecycleTrigger(timing, state, options);
  if (lifecycleResult != null) return lifecycleResult;

  const cadenceSec = normalizedCadenceSec(timing);
  const onSeasonChange = timing.onSeasonChange === true;

  if (!cadenceSec && !onSeasonChange) return true;

  const cadenceMatch =
    cadenceSec != null && Number.isFinite(tSec)
      ? tSec % cadenceSec === 0
      : false;
  const seasonMatch = onSeasonChange && state?._seasonChanged === true;
  return cadenceMatch || seasonMatch;
}
