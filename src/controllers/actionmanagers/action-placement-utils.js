// src/controllers/actionmanagers/action-placement-utils.js
// Shared placement comparison helper.

export function getPlacementRow(placement) {
  if (!placement) return null;
  if (Number.isFinite(placement.tileCol)) return "env";
  if (Number.isFinite(placement.slotIndex)) return "hub";
  return null;
}

export function getPlacementCol(placement) {
  const row = getPlacementRow(placement);
  if (row === "env") return Math.floor(placement.tileCol);
  if (row === "hub") return Math.floor(placement.slotIndex);
  return null;
}

export function placementEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.ownerId === b.ownerId &&
    a.gx === b.gx &&
    a.gy === b.gy &&
    a.slotIndex === b.slotIndex &&
    a.tileCol === b.tileCol
  );
}
