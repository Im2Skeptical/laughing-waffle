// moon.js
// Deterministic moon phase and AP cap helpers driven by tSec.

import {
  MOON_CYCLE_SEC,
  MOON_PHASE_OFFSET_SEC,
  AP_CAP_MIN,
  AP_CAP_MAX,
} from "../defs/gamesettings/gamerules-defs.js";

function clampInt(v, fallback) {
  const n = Math.floor(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getMoonPhase01AtSecond(tSec) {
  return getMoonPhaseStateAtSecond(tSec).phase01;
}

export function isMoonWaxingAtSecond(tSec) {
  return getMoonPhaseStateAtSecond(tSec).isWaxing;
}

export function getMoonPhaseStateAtSecond(tSec) {
  const cycleSec = Math.max(1, clampInt(MOON_CYCLE_SEC, 30));
  const offsetSec = clampInt(
    MOON_PHASE_OFFSET_SEC,
    Math.floor(cycleSec / 2)
  );
  const t = Math.max(0, clampInt(tSec, 0));
  const phaseSec = (t + offsetSec) % cycleSec;
  const half = cycleSec / 2;
  const ratio =
    phaseSec <= half
      ? phaseSec / Math.max(1, half)
      : (cycleSec - phaseSec) / Math.max(1, half);
  const phase01 = Math.max(0, Math.min(1, ratio));
  return {
    phase01,
    isWaxing: phaseSec <= half,
    phaseSec,
    cycleSec,
  };
}

export function getActionPointCapAtSecond(tSec) {
  const minCap = Math.max(0, clampInt(AP_CAP_MIN, 0));
  const maxCap = Math.max(minCap, clampInt(AP_CAP_MAX, 100));
  const phase = getMoonPhase01AtSecond(tSec);
  return Math.round(minCap + phase * (maxCap - minCap));
}

