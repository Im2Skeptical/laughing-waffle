// build-helpers.js
// Shared helpers for hub construction validation (pure, no mutation).

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";

export function normalizeHubCol(value) {
  return Number.isFinite(value) ? Math.floor(value) : null;
}

export function getStructureSpan(def) {
  const span =
    Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
      ? Math.floor(def.defaultSpan)
      : 1;
  return Math.max(1, span);
}

export function getMaxInstances(def) {
  const max = Number.isFinite(def?.maxInstances)
    ? Math.floor(def.maxInstances)
    : 1;
  return Math.max(0, max);
}

export function countStructuresByDefId(state, defId) {
  if (!state || !state.hub || !Array.isArray(state.hub.slots)) return 0;
  let count = 0;
  for (const slot of state.hub.slots) {
    const structure = slot?.structure;
    if (!structure) continue;
    if (structure.defId === defId) count += 1;
  }
  return count;
}

export function validateHubConstructionPlacement(state, defId, hubCol) {
  if (!state || !state.hub || !Array.isArray(state.hub.slots)) {
    return { ok: false, reason: "noHub" };
  }
  if (!defId || typeof defId !== "string") {
    return { ok: false, reason: "badDefId" };
  }
  const def = hubStructureDefs[defId];
  if (!def) return { ok: false, reason: "unknownDef" };

  const col = normalizeHubCol(hubCol);
  if (col == null) return { ok: false, reason: "badHubCol" };

  const cols = state.hub.slots.length;
  const span = getStructureSpan(def);

  if (col < 0 || col >= cols) return { ok: false, reason: "badHubCol" };
  if (col + span > cols) return { ok: false, reason: "spanOutOfBounds" };

  const maxInstances = getMaxInstances(def);
  if (maxInstances > 0) {
    const existing = countStructuresByDefId(state, defId);
    if (existing >= maxInstances) {
      return {
        ok: false,
        reason: "maxInstancesReached",
        maxInstances,
        existing,
      };
    }
  }

  const occ = Array.isArray(state.hub.occ) ? state.hub.occ : null;
  for (let offset = 0; offset < span; offset++) {
    const index = col + offset;
    const occupied = occ ? occ[index] : state.hub.slots[index]?.structure;
    if (occupied) {
      return { ok: false, reason: "slotOccupied", hubCol: index };
    }
  }

  return { ok: true, def, hubCol: col, span };
}
