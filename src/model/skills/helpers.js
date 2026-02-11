// helpers.js
// Shared deterministic helpers for skill model modules.

export function isObject(value) {
  return value && typeof value === "object";
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function sortStrings(list) {
  return list.slice().sort((a, b) => String(a).localeCompare(String(b)));
}

export function toSafeInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.floor(value);
}

export function uniqueSortedStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of toArray(values)) {
    if (typeof value !== "string" || !value.length) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
