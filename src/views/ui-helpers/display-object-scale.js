export function getDisplayObjectWorldScale(displayObject, fallback = 1) {
  const wt = displayObject?.worldTransform;
  if (!wt || typeof wt !== "object") return fallback;
  const sx = Math.hypot(Number(wt.a) || 0, Number(wt.b) || 0);
  const sy = Math.hypot(Number(wt.c) || 0, Number(wt.d) || 0);
  const scale = Math.max(sx, sy);
  if (!Number.isFinite(scale) || scale <= 0) return fallback;
  return scale;
}
