// passive-timing.js
// Shared passive timing checks used by env/hub/item/pawn executors.

function normalizedCadenceSec(timing) {
  if (!timing || typeof timing !== "object") return null;
  if (!Number.isFinite(timing.cadenceSec)) return null;
  return Math.max(1, Math.floor(timing.cadenceSec));
}

export function passiveTimingPasses(timing, state, tSec) {
  if (!timing || typeof timing !== "object") return true;

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
