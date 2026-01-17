// src/controllers/action-costs.js
// Pure AP cost estimation helpers for planner intents.

import { INTENT_AP_COSTS } from "../defs/action-costs-defs.js";
import { itemDefs } from "../defs/gamepieces-defs.js";

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

function isCurrencyKind(kind) {
  const tags = itemDefs[kind]?.tags || [];
  return Array.isArray(tags) && tags.includes("currency");
}

function getItemQuantity(item) {
  return Math.max(1, Math.floor(item?.quantity ?? 1));
}

function compareOwnerIds(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum) return aNum - bNum;
  const aStr = String(a);
  const bStr = String(b);
  if (aStr < bStr) return -1;
  if (aStr > bStr) return 1;
  return 0;
}

function getCurrencyGroupInfo(intent) {
  if (!intent || intent.kind !== "itemTransfer") return null;
  const kind = intent.item?.kind ?? null;
  if (!isCurrencyKind(kind)) return null;
  const fromOwnerId = intent.fromOwnerId;
  const toOwnerId = intent.toOwnerId;
  if (fromOwnerId == null || toOwnerId == null) return null;
  if (fromOwnerId === toOwnerId) return null;
  const cmp = compareOwnerIds(fromOwnerId, toOwnerId);
  const minId = cmp <= 0 ? fromOwnerId : toOwnerId;
  const maxId = cmp <= 0 ? toOwnerId : fromOwnerId;
  const dir = cmp <= 0 ? 1 : -1;
  const key = `${kind}|${String(minId)}|${String(maxId)}`;
  return { key, dir };
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

  const currencyGroups = new Map();

  for (const intent of list) {
    if (!intent) continue;
    const info = getCurrencyGroupInfo(intent);
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
    if (getCurrencyGroupInfo(intent)) {
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
