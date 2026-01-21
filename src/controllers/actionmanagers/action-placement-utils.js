// src/controllers/actionmanagers/action-placement-utils.js
// Shared placement comparison helper.

export function getPlacementRow(placement) {
  if (!placement) return null;
  if (Number.isFinite(placement.envCol)) return "env";
  if (Number.isFinite(placement.hubCol)) return "hub";
  return null;
}

export function getPlacementCol(placement) {
  const row = getPlacementRow(placement);
  if (row === "env") return Math.floor(placement.envCol);
  if (row === "hub") return Math.floor(placement.hubCol);
  return null;
}

export function placementEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.ownerId === b.ownerId &&
    a.gx === b.gx &&
    a.gy === b.gy &&
    a.hubCol === b.hubCol &&
    a.envCol === b.envCol
  );
}
