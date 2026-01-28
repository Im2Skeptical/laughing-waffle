// src/controllers/actionmanagers/action-costs.js
// Pure AP cost estimation helpers for planner intents.

import { INTENT_AP_COSTS } from "../../defs/gamesettings/action-costs-defs.js";
import {
  getCurrencyGroupInfo,
  getItemQuantity,
  isCurrencyItem,
} from "./action-currency-utils.js";
import { getPlacementRow, placementEquals } from "./action-placement-utils.js";

function tagsEqual(a, b) {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    if (listA[i] !== listB[i]) return false;
  }
  return true;
}

function getCurrencyGroupInfoForIntent(intent) {
  if (!intent || intent.kind !== "itemTransfer") return null;
  return getCurrencyGroupInfo({
    item: intent.item ?? null,
    fromOwnerId: intent.fromOwnerId,
    toOwnerId: intent.toOwnerId,
  });
}

export function estimateIntentApCost(intent, { stateStart } = {}) {
  if (!intent || typeof intent !== "object") return 0;

  const isCurrencyTransfer =
    intent.kind === "itemTransfer" && isCurrencyItem(intent.item);
  if (Number.isFinite(intent.apCostOverride) && !isCurrencyTransfer) {
    return Math.max(0, Math.floor(intent.apCostOverride));
  }

  switch (intent.kind) {
    case "itemTransfer": {
      if (intent.fromOwnerId === intent.toOwnerId) return 0;
      if (placementEquals(intent.fromPlacement, intent.toPlacement)) return 0;
      if (isCurrencyTransfer) {
        return INTENT_AP_COSTS.currencyTransfer ?? INTENT_AP_COSTS.itemTransfer ?? 0;
      }
      return INTENT_AP_COSTS.itemTransfer ?? 0;
    }
    case "pawnMove": {
      if (placementEquals(intent.fromPlacement, intent.toPlacement)) return 0;
      const fromRow = getPlacementRow(intent.fromPlacement);
      const toRow = getPlacementRow(intent.toPlacement);
      if (fromRow && toRow) {
        if (fromRow === toRow) {
          return INTENT_AP_COSTS.pawnMoveSameRow ?? INTENT_AP_COSTS.pawnMove ?? 0;
        }
        if (fromRow === "hub" && toRow === "env") {
          return (
            INTENT_AP_COSTS.pawnMoveHubToEnv ??
            INTENT_AP_COSTS.pawnMove ??
            0
          );
        }
        if (fromRow === "env" && toRow === "hub") {
          return (
            INTENT_AP_COSTS.pawnMoveEnvToHub ??
            INTENT_AP_COSTS.pawnMove ??
            0
          );
        }
      }
      return INTENT_AP_COSTS.pawnMove ?? 0;
    }
    case "buildDesignate": {
      return INTENT_AP_COSTS.buildDesignate ?? 0;
    }
    case "tileTagOrder": {
      if (tagsEqual(intent.tagIds, intent.baselineTags)) return 0;
      return INTENT_AP_COSTS.tileTagOrder ?? 0;
    }
    case "hubTagOrder": {
      if (tagsEqual(intent.tagIds, intent.baselineTags)) return 0;
      return INTENT_AP_COSTS.hubTagOrder ?? INTENT_AP_COSTS.tileTagOrder ?? 0;
    }
    case "tileCropSelect": {
      if ((intent.cropId ?? null) === (intent.baselineCropId ?? null)) return 0;
      return INTENT_AP_COSTS.tileCropSelect ?? 0;
    }
    default:
      return 0;
  }
}

export function computeIntentCostSummary(intents, ctx = {}) {
  const list = Array.isArray(intents) ? intents : [];
  const byId = {};
  let total = 0;

  const currencyGroups = new Map();

  for (const intent of list) {
    if (!intent) continue;
    const info = getCurrencyGroupInfoForIntent(intent);
    if (!info) continue;
    let group = currencyGroups.get(info.key);
    if (!group) {
      group = { net: 0, firstIntent: intent, intentIds: [] };
      currencyGroups.set(info.key, group);
    }
    group.net += info.dir * getItemQuantity(intent.item);
    if (!group.firstIntent) group.firstIntent = intent;
    const key = intent?.id ?? intent?.subjectKey ?? null;
    if (key != null) group.intentIds.push(key);
  }

  for (const intent of list) {
    const cost = estimateIntentApCost(intent, ctx);
    const key = intent?.id ?? intent?.subjectKey ?? null;
    if (key == null) continue;
    if (getCurrencyGroupInfoForIntent(intent)) {
      byId[key] = 0;
      continue;
    }
    byId[key] = cost;
    total += cost;
  }

  for (const group of currencyGroups.values()) {
    if (!group || !group.net) continue;
    const firstId = group.intentIds[0] ?? null;
    const baseIntent = group.firstIntent ?? null;
    if (!firstId || !baseIntent) continue;
    const cost = estimateIntentApCost(baseIntent, ctx);
    byId[firstId] = cost;
    total += cost;
  }

  return { total, byId };
}

