// src/controllers/actionmanagers/action-placement-utils.js
// Shared placement comparison helper.

export function placementEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.ownerId === b.ownerId &&
    a.gx === b.gx &&
    a.gy === b.gy &&
    a.slotIndex === b.slotIndex
  );
}
