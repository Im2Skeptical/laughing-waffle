// src/controllers/action-costs.js
// Pure AP cost estimation helpers for planner intents.

import { INTENT_AP_COSTS } from "../defs/action-costs-defs.js";

function placementEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.ownerId === b.ownerId &&
    a.gx === b.gx &&
    a.gy === b.gy &&
    a.slotIndex === b.slotIndex
  );
}

export function estimateIntentApCost(intent, { stateStart } = {}) {
  if (!intent || typeof intent !== "object") return 0;

  if (Number.isFinite(intent.apCostOverride)) {
    return Math.max(0, Math.floor(intent.apCostOverride));
  }

  switch (intent.kind) {
    case "itemTransfer": {
      if (intent.fromOwnerId === intent.toOwnerId) return 0;
      if (placementEquals(intent.fromPlacement, intent.toPlacement)) return 0;
      return INTENT_AP_COSTS.itemTransfer ?? 0;
    }
    case "pawnMove": {
      if (placementEquals(intent.fromPlacement, intent.toPlacement)) return 0;
      return INTENT_AP_COSTS.pawnMove ?? 0;
    }
    case "buildDesignate": {
      return INTENT_AP_COSTS.buildDesignate ?? 0;
    }
    default:
      return 0;
  }
}

export function computeIntentCostSummary(intents, ctx = {}) {
  const list = Array.isArray(intents) ? intents : [];
  const byId = {};
  let total = 0;

  for (const intent of list) {
    const cost = estimateIntentApCost(intent, ctx);
    const key = intent?.id ?? intent?.subjectKey ?? null;
    if (key != null) byId[key] = cost;
    total += cost;
  }

  return { total, byId };
}
