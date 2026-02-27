// src/controllers/actionmanagers/action-costs.js
// Pure AP cost estimation helpers for planner intents.

import { INTENT_AP_COSTS } from "../../defs/gamesettings/action-costs-defs.js";
import { recipePrioritiesEqual } from "../../model/recipe-priority.js";
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

function getTilePlanKey(intent) {
  if (!intent || typeof intent !== "object") return null;
  if (
    intent.kind === "tileTagOrder" ||
    intent.kind === "tileTagToggle" ||
    intent.kind === "tileCropSelect"
  ) {
    if (!Number.isFinite(intent.envCol)) return null;
    return `tilePlan:${Math.floor(intent.envCol)}`;
  }
  return null;
}

function getHubPlanKey(intent) {
  if (!intent || typeof intent !== "object") return null;
  if (
    intent.kind === "hubTagOrder" ||
    intent.kind === "hubTagToggle" ||
    intent.kind === "hubRecipeSelect"
  ) {
    if (!Number.isFinite(intent.hubCol)) return null;
    return `hubPlan:${Math.floor(intent.hubCol)}`;
  }
  return null;
}

function getTilePlanCost() {
  return INTENT_AP_COSTS.tilePlan ?? INTENT_AP_COSTS.tileTagOrder ?? 0;
}

function getHubPlanCost() {
  return (
    INTENT_AP_COSTS.hubPlan ??
    INTENT_AP_COSTS.tilePlan ??
    INTENT_AP_COSTS.hubTagOrder ??
    0
  );
}

export function estimateIntentApCost(intent, { stateStart } = {}) {
  if (!intent || typeof intent !== "object") return 0;
  if (stateStart?.variantFlags?.actionPointCostsEnabled === false) return 0;

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
    case "tileTagToggle": {
      if ((intent.disabled ?? null) === (intent.baselineDisabled ?? null)) return 0;
      return INTENT_AP_COSTS.tileTagToggle ?? INTENT_AP_COSTS.tileTagOrder ?? 0;
    }
    case "hubTagToggle": {
      if ((intent.disabled ?? null) === (intent.baselineDisabled ?? null)) return 0;
      return INTENT_AP_COSTS.hubTagToggle ?? INTENT_AP_COSTS.hubTagOrder ?? 0;
    }
    case "tileCropSelect": {
      if (
        recipePrioritiesEqual(
          intent.recipePriority,
          intent.baselineRecipePriority
        )
      ) {
        return 0;
      }
      return INTENT_AP_COSTS.tileCropSelect ?? 0;
    }
    case "hubRecipeSelect": {
      if (recipePrioritiesEqual(intent.recipePriority, intent.baselineRecipePriority)) {
        return 0;
      }
      return INTENT_AP_COSTS.hubRecipeSelect ?? INTENT_AP_COSTS.hubPlan ?? 0;
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
  const tilePlanGroups = new Map();
  const tilePlanIntentIds = new Set();
  const hubPlanGroups = new Map();
  const hubPlanIntentIds = new Set();

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
    const tilePlanKey = getTilePlanKey(intent);
    if (tilePlanKey) {
      const intentId = intent?.id ?? intent?.subjectKey ?? null;
      if (intentId != null) tilePlanIntentIds.add(intentId);
      const cost = estimateIntentApCost(intent, ctx);
      if (cost > 0 && intentId != null) {
        let group = tilePlanGroups.get(tilePlanKey);
        if (!group) {
          group = { intentIds: [], anchorId: null };
          tilePlanGroups.set(tilePlanKey, group);
        }
        if (!group.intentIds.includes(intentId)) {
          group.intentIds.push(intentId);
        }
        if (!group.anchorId) group.anchorId = intentId;
      }
    }
  }

  for (const intent of list) {
    const hubPlanKey = getHubPlanKey(intent);
    if (hubPlanKey) {
      const intentId = intent?.id ?? intent?.subjectKey ?? null;
      if (intentId != null) hubPlanIntentIds.add(intentId);
      const cost = estimateIntentApCost(intent, ctx);
      if (cost > 0 && intentId != null) {
        let group = hubPlanGroups.get(hubPlanKey);
        if (!group) {
          group = { intentIds: [], anchorId: null };
          hubPlanGroups.set(hubPlanKey, group);
        }
        if (!group.intentIds.includes(intentId)) {
          group.intentIds.push(intentId);
        }
        if (!group.anchorId) group.anchorId = intentId;
      }
    }
  }

  for (const intent of list) {
    const cost = estimateIntentApCost(intent, ctx);
    const key = intent?.id ?? intent?.subjectKey ?? null;
    if (key == null) continue;
    if (getCurrencyGroupInfoForIntent(intent)) {
      byId[key] = 0;
      continue;
    }
    if (tilePlanIntentIds.has(key)) {
      byId[key] = 0;
      continue;
    }
    if (hubPlanIntentIds.has(key)) {
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

  const tilePlanCost = getTilePlanCost();
  if (tilePlanCost > 0) {
    for (const group of tilePlanGroups.values()) {
      if (!group || !group.intentIds?.length) continue;
      const anchorId = group.anchorId ?? group.intentIds[0] ?? null;
      if (!anchorId) continue;
      byId[anchorId] = tilePlanCost;
      total += tilePlanCost;
    }
  }

  const hubPlanCost = getHubPlanCost();
  if (hubPlanCost > 0) {
    for (const group of hubPlanGroups.values()) {
      if (!group || !group.intentIds?.length) continue;
      const anchorId = group.anchorId ?? group.intentIds[0] ?? null;
      if (!anchorId) continue;
      byId[anchorId] = hubPlanCost;
      total += hubPlanCost;
    }
  }

  return { total, byId };
}

