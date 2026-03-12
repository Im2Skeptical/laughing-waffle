function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function getLiveUiTimeSec(state) {
  const tSec = Number.isFinite(state?.tSec) ? Math.max(0, Math.floor(state.tSec)) : 0;
  const steps = state?.simStepIndex;
  if (Number.isFinite(steps)) {
    const fractionalSec = Math.max(0, steps / 60);
    if (Math.floor(fractionalSec) === tSec) return fractionalSec;
  }
  return tSec;
}

export function shouldSnapProgressAnimation(prevTimeSample, nextState) {
  if (!Number.isFinite(prevTimeSample)) return true;
  if (nextState?.paused === true) return true;
  const nextTimeSample = getLiveUiTimeSec(nextState);
  if (!Number.isFinite(nextTimeSample)) return true;
  if (nextTimeSample < prevTimeSample) return true;
  if (nextTimeSample - prevTimeSample > 1) return true;
  return false;
}

export function stepAnimatedRatio(currentRatio, targetRatio, dtSec, opts = {}) {
  const target = clamp01(targetRatio);
  if (opts?.snap === true) return target;

  const current = clamp01(currentRatio);
  const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  if (dt <= 0) {
    return Math.abs(target - current) <= 0.0005 ? target : current;
  }

  const settleSec = Number.isFinite(opts?.settleSec)
    ? Math.max(0.001, opts.settleSec)
    : 0.15;
  const blend = 1 - Math.exp((-Math.log(100) * dt) / settleSec);
  const next = current + (target - current) * clamp01(blend);
  return Math.abs(target - next) <= 0.0005 ? target : clamp01(next);
}
