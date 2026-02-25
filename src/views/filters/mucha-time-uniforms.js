function toSafeSec(value) {
  const sec = Math.floor(value ?? 0);
  if (!Number.isFinite(sec)) return 0;
  return Math.max(0, sec);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function getVisualTimeSec(state) {
  const tSec = toSafeSec(state?.tSec);
  const steps = state?.simStepIndex;
  if (Number.isFinite(steps)) {
    const fractional = Math.max(0, Number(steps) / 60);
    if (Math.floor(fractional) === tSec) {
      return fractional;
    }
  }
  return tSec;
}

export function computeTimeWarp({
  state,
  timeline,
  preview,
  timeReactive = true,
  driftWindowSec = 120,
  forecastBoost = 0.35,
  historyBoost = 0.18,
} = {}) {
  const tSec = toSafeSec(state?.tSec);
  const historyEndSec = toSafeSec(timeline?.historyEndSec ?? tSec);

  const previewActive = preview?.active === true;
  const previewSec = previewActive ? toSafeSec(preview?.previewSec) : null;
  const isForecastPreview = preview?.isForecastPreview === true;

  const viewSec = previewActive && Number.isFinite(previewSec) ? previewSec : tSec;
  const deltaSec = viewSec - historyEndSec;
  const distanceSec = Math.abs(deltaSec);

  const windowSec = Math.max(1, toSafeSec(driftWindowSec));
  const normalizedDistance = clamp01(distanceSec / windowSec);

  let warp = 0;
  if (timeReactive) {
    if (isForecastPreview || deltaSec > 0) {
      warp = clamp01(normalizedDistance + Math.max(0, Number(forecastBoost) || 0));
    } else if (deltaSec < 0) {
      warp = clamp01(normalizedDistance + Math.max(0, Number(historyBoost) || 0));
    }
  }

  return {
    warp,
    normalizedDistance,
    distanceSec,
    viewSec,
    historyEndSec,
    isForecastPreview,
    isHistoryView: deltaSec < 0,
    isFrontierView: deltaSec === 0,
  };
}
