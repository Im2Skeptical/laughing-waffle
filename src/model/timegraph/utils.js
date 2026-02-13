// src/model/timegraph/utils.js

export function clampSec(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

export function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}
