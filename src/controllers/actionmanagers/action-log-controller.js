// src/controllers/actionmanagers/action-log-controller.js
// View-model helpers for action log rows and navigation.

import { hubStructureDefs }  from "../../defs/gamepieces/hub-structure-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { envTileDefs } from "../../defs/gamepieces/env-tiles-defs.js";
import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { hubTagDefs } from "../../defs/gamesystems/hub-tag-defs.js";
import { skillNodes } from "../../defs/gamepieces/skill-tree-defs.js";
import { ActionKinds } from "../../model/actions.js";
import {
  buildRecipePriorityFromSelectedRecipe,
  buildRecipePrioritySignature,
  getEnabledRecipeIds,
  getRecipeKindForHubSystem,
  getTopEnabledRecipeId,
  normalizeRecipePriority,
} from "../../model/recipe-priority.js";
import { IntentKinds } from "./action-intents.js";
import {
  getCurrencyGroupInfo,
  getItemQuantity,
} from "./action-currency-utils.js";

function formatItemNameFromKind(kind) {
  if (kind && itemDefs[kind]) return itemDefs[kind].name || kind;
  return kind || "";
}

function formatCropName(cropId) {
  if (!cropId) return "None";
  return cropDefs[cropId]?.name || cropDefs[cropId]?.cropId || cropId;
}

function formatRecipeName(recipeId) {
  if (!recipeId) return "None";
  return recipeDefs[recipeId]?.name || recipeDefs[recipeId]?.id || recipeId;
}

function normalizeRecipePriorityForLog(systemId, value, fallbackRecipeId = null) {
  if (value && typeof value === "object") {
    return normalizeRecipePriority(value, {
      systemId,
      state: null,
      includeLocked: true,
    });
  }
  return buildRecipePriorityFromSelectedRecipe(fallbackRecipeId, {
    systemId,
    state: null,
    includeLocked: true,
  });
}

function formatRecipePriorityLabel(systemId, recipePriority) {
  const enabled = getEnabledRecipeIds(recipePriority);
  const topRecipeId = getTopEnabledRecipeId(recipePriority);
  const topLabel = formatRecipeName(topRecipeId);
  if (enabled.length <= 0) {
    const kind = getRecipeKindForHubSystem(systemId);
    return kind === "cook" ? "0 enabled (Cooking paused)" : "0 enabled (Crafting paused)";
  }
  return `${enabled.length} enabled (Top: ${topLabel})`;
}

function formatCropPriorityLabel(recipePriority) {
  const enabled = getEnabledRecipeIds(recipePriority);
  const topCropId = getTopEnabledRecipeId(recipePriority);
  const topLabel = formatCropName(topCropId);
  if (enabled.length <= 0) {
    return "0 enabled (Planting paused)";
  }
  return `${enabled.length} enabled (Top: ${topLabel})`;
}

function formatEnvTagName(tagId) {
  if (!tagId) return "Tag";
  return envTagDefs[tagId]?.ui?.name || tagId;
}

function formatHubTagName(tagId) {
  if (!tagId) return "Tag";
  return hubTagDefs[tagId]?.ui?.name || tagId;
}

function formatOwnerName(ownerId, getOwnerLabel) {
  if (typeof getOwnerLabel === "function") return getOwnerLabel(ownerId);
  return `Owner ${ownerId}`;
}

function formatPawnName(pawnId, state) {
  const pawn = state?.pawns?.find((candidatePawn) => candidatePawn.id === pawnId);
  return pawn?.name || `Pawn ${pawnId}`;
}

function formatHubName(hubCol, state) {
  const slots = state?.hub?.slots || [];
  const slot = slots[hubCol];
  const structure = slot?.structure;
  if (structure) {
    const def = hubStructureDefs[structure.defId];
    return def?.name || def?.id || `Hub ${hubCol}`;
  }
  return `Hub ${hubCol}`;
}

function formatTileName(envCol, state) {
  const col = Math.floor(envCol);
  const tile = state?.board?.occ?.tile?.[col];
  const def = tile ? envTileDefs[tile.defId] : null;
  return def?.name || tile?.defId || `Tile ${col}`;
}

function isTilePlanIntent(intent) {
  if (!intent) return false;
  return (
    intent.kind === IntentKinds.TILE_TAG_ORDER ||
    intent.kind === IntentKinds.TILE_TAG_TOGGLE ||
    intent.kind === IntentKinds.TILE_CROP_SELECT
  );
}

function isHubPlanIntent(intent) {
  if (!intent) return false;
  return (
    intent.kind === IntentKinds.HUB_TAG_ORDER ||
    intent.kind === IntentKinds.HUB_TAG_TOGGLE ||
    intent.kind === IntentKinds.HUB_RECIPE_SELECT
  );
}

function isTilePlanAction(action) {
  const kind = action?.kind;
  return (
    kind === ActionKinds.SET_TILE_TAG_ORDER ||
    kind === ActionKinds.TOGGLE_TILE_TAG ||
    kind === ActionKinds.SET_TILE_CROP_SELECTION
  );
}

function isHubPlanAction(action) {
  const kind = action?.kind;
  return (
    kind === ActionKinds.SET_HUB_TAG_ORDER ||
    kind === ActionKinds.TOGGLE_HUB_TAG ||
    kind === ActionKinds.SET_HUB_RECIPE_SELECTION
  );
}

function formatSkillNodeName(nodeId) {
  if (!nodeId) return "Skill";
  return skillNodes?.[nodeId]?.name || nodeId;
}

function formatTilePlanLabel(envCol, state) {
  const tileName = formatTileName(envCol, state);
  return `Tags > ${tileName} changed`;
}

function formatHubPlanLabel(hubCol, state) {
  const hubName = formatHubName(hubCol, state);
  return `Tags > ${hubName} changed`;
}

function getTilePlanIntentSignature(intent) {
  if (!intent) return "";
  if (intent.kind === IntentKinds.TILE_TAG_ORDER) {
    const tags = Array.isArray(intent.tagIds) ? intent.tagIds : [];
    return `order:${tags.join(",")}`;
  }
  if (intent.kind === IntentKinds.TILE_TAG_TOGGLE) {
    return `toggle:${intent.tagId ?? ""}:${intent.disabled === true}`;
  }
  if (intent.kind === IntentKinds.TILE_CROP_SELECT) {
    const priority = normalizeRecipePriorityForLog(
      "growth",
      intent.recipePriority,
      intent.cropId ?? null
    );
    const sig = buildRecipePrioritySignature(priority);
    return `crop:${sig}`;
  }
  return intent.kind || "";
}

function getHubPlanIntentSignature(intent) {
  if (!intent) return "";
  if (intent.kind === IntentKinds.HUB_TAG_ORDER) {
    const tags = Array.isArray(intent.tagIds) ? intent.tagIds : [];
    return `order:${tags.join(",")}`;
  }
  if (intent.kind === IntentKinds.HUB_TAG_TOGGLE) {
    return `toggle:${intent.tagId ?? ""}:${intent.disabled === true}`;
  }
  if (intent.kind === IntentKinds.HUB_RECIPE_SELECT) {
    const priority = normalizeRecipePriorityForLog(
      intent.systemId ?? null,
      intent.recipePriority,
      intent.recipeId ?? null
    );
    const sig = buildRecipePrioritySignature(priority);
    return `recipe:${intent.systemId ?? ""}:${sig}`;
  }
  return intent.kind || "";
}

function formatPlacementName(placement, state) {
  if (!placement) return "Location";
  if (Number.isFinite(placement.envCol)) {
    return formatTileName(placement.envCol, state);
  }
  if (Number.isFinite(placement.hubCol)) {
    return formatHubName(placement.hubCol, state);
  }
  return "Location";
}

function resolvePlacementFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.toPlacement) return payload.toPlacement;
  if (Number.isFinite(payload.toEnvCol) || Number.isFinite(payload.envCol)) {
    return {
      envCol: Number.isFinite(payload.toEnvCol)
        ? payload.toEnvCol
        : payload.envCol,
    };
  }
  if (Number.isFinite(payload.toHubCol) || Number.isFinite(payload.hubCol)) {
    return {
      hubCol: Number.isFinite(payload.toHubCol)
        ? payload.toHubCol
        : payload.hubCol,
    };
  }
  return null;
}

function describeIntent(intent, state, getOwnerLabel) {
  if (!intent) return "";
  switch (intent.kind) {
    case IntentKinds.ITEM_TRANSFER: {
      const itemName = formatItemNameFromKind(intent?.item?.kind);
      const fallback =
        itemName || `Item ${intent?.itemId ?? ""}`.trim() || "Item";
      const dest = formatOwnerName(intent.toOwnerId, getOwnerLabel);
      return `${fallback} > ${dest}`;
    }
    case IntentKinds.PAWN_MOVE: {
      const pawnName = formatPawnName(intent.pawnId, state);
      const dest = formatPlacementName(intent.toPlacement, state);
      return `${pawnName} > ${dest}`;
    }
    case IntentKinds.BUILD_DESIGNATE: {
      return `Build ${intent.defId || intent.buildKey || "Plan"}`;
    }
    case IntentKinds.TILE_TAG_ORDER: {
      const tileName = formatTileName(intent.envCol, state);
      return `Tags > ${tileName}`;
    }
    case IntentKinds.HUB_TAG_ORDER: {
      const hubName = formatHubName(intent.hubCol, state);
      return `Tags > ${hubName}`;
    }
    case IntentKinds.TILE_TAG_TOGGLE: {
      const tileName = formatTileName(intent.envCol, state);
      const tagName = formatEnvTagName(intent.tagId);
      const status = intent.disabled ? "Off" : "On";
      return `Tag ${tagName} > ${tileName}: ${status}`;
    }
    case IntentKinds.HUB_TAG_TOGGLE: {
      const hubName = formatHubName(intent.hubCol, state);
      const tagName = formatHubTagName(intent.tagId);
      const status = intent.disabled ? "Off" : "On";
      return `Tag ${tagName} > ${hubName}: ${status}`;
    }
    case IntentKinds.TILE_CROP_SELECT: {
      const tileName = formatTileName(intent.envCol, state);
      const priority = normalizeRecipePriorityForLog(
        "growth",
        intent.recipePriority,
        intent.cropId ?? null
      );
      const summary = formatCropPriorityLabel(priority);
      return `Seeds > ${tileName}: ${summary}`;
    }
    case IntentKinds.HUB_RECIPE_SELECT: {
      const hubName = formatHubName(intent.hubCol, state);
      const priority = normalizeRecipePriorityForLog(
        intent.systemId ?? null,
        intent.recipePriority,
        intent.recipeId ?? null
      );
      const summary = formatRecipePriorityLabel(intent.systemId ?? null, priority);
      return `Recipes > ${hubName}: ${summary}`;
    }
    default:
      return intent.kind || "Action";
  }
}

function formatCurrencyGroupDescription(group, getOwnerLabel) {
  if (!group) return "";
  const itemName = formatItemNameFromKind(group.kind) || "Item";
  if (group.net) {
    const qty = Math.abs(group.net);
    const toOwnerId = group.net > 0 ? group.maxId : group.minId;
    const dest = formatOwnerName(toOwnerId, getOwnerLabel);
    return `${qty} ${itemName} > ${dest}`;
  }
  const ownerA = formatOwnerName(group.minId, getOwnerLabel);
  const ownerB = formatOwnerName(group.maxId, getOwnerLabel);
  return `Shuffled ${itemName} (${ownerA} <-> ${ownerB})`;
}

function buildIntentRowSpecs(intents, planner, state, focus, getOwnerLabel) {
  const groupByKey = new Map();
  const groupKeyByIntentId = new Map();
  const tilePlanGroups = new Map();
  const hubPlanGroups = new Map();

  for (const intent of intents) {
    if (intent?.kind !== IntentKinds.ITEM_TRANSFER) continue;
    const kind = intent.item?.kind ?? null;
    const info = getCurrencyGroupInfo({
      item: intent.item ?? null,
      kind,
      fromOwnerId: intent.fromOwnerId,
      toOwnerId: intent.toOwnerId,
    });
    if (!info) continue;

    const intentId = intent.id ?? intent.subjectKey ?? null;
    const qty = getItemQuantity(intent.item);
    let group = groupByKey.get(info.key);
    if (!group) {
      group = {
        kind,
        minId: info.minId,
        maxId: info.maxId,
        net: 0,
        intentIds: [],
        cost: 0,
      };
      groupByKey.set(info.key, group);
    }
    group.net += info.dir * qty;
    if (intentId != null) {
      group.intentIds.push(intentId);
      groupKeyByIntentId.set(intentId, info.key);
    }
    group.cost += planner?.getIntentCost?.(intentId) ?? 0;
  }

  const rowsOut = [];
  const emittedGroups = new Set();
  const emittedTilePlans = new Set();
  const emittedHubPlans = new Set();

  for (const intent of intents) {
    if (!isTilePlanIntent(intent)) continue;
    const envCol = Number.isFinite(intent.envCol)
      ? Math.floor(intent.envCol)
      : null;
    if (envCol == null) continue;
    const key = envCol;
    let group = tilePlanGroups.get(key);
    if (!group) {
      group = {
        envCol,
        intentIds: [],
        cost: 0,
        isFocused: false,
        focusIntentId: null,
        signatures: [],
      };
      tilePlanGroups.set(key, group);
    }
    const intentId = intent?.id ?? intent?.subjectKey ?? null;
    if (intentId != null) {
      group.intentIds.push(intentId);
      const cost = planner?.getIntentCost?.(intentId) ?? 0;
      if (cost > group.cost) group.cost = cost;
      if (!group.focusIntentId) group.focusIntentId = intentId;
      if (focus && focus.id === intentId) group.isFocused = true;
    }
    const sig = getTilePlanIntentSignature(intent);
    if (sig) group.signatures.push(sig);
  }

  for (const intent of intents) {
    if (!isHubPlanIntent(intent)) continue;
    const hubCol = Number.isFinite(intent.hubCol)
      ? Math.floor(intent.hubCol)
      : null;
    if (hubCol == null) continue;
    const key = hubCol;
    let group = hubPlanGroups.get(key);
    if (!group) {
      group = {
        hubCol,
        intentIds: [],
        cost: 0,
        isFocused: false,
        focusIntentId: null,
        signatures: [],
      };
      hubPlanGroups.set(key, group);
    }
    const intentId = intent?.id ?? intent?.subjectKey ?? null;
    if (intentId != null) {
      group.intentIds.push(intentId);
      const cost = planner?.getIntentCost?.(intentId) ?? 0;
      if (cost > group.cost) group.cost = cost;
      if (!group.focusIntentId) group.focusIntentId = intentId;
      if (focus && focus.id === intentId) group.isFocused = true;
    }
    const sig = getHubPlanIntentSignature(intent);
    if (sig) group.signatures.push(sig);
  }

  for (const intent of intents) {
    const intentId = intent?.id ?? intent?.subjectKey ?? null;
    const groupKey = intentId ? groupKeyByIntentId.get(intentId) : null;
    if (groupKey) {
      if (emittedGroups.has(groupKey)) continue;
      emittedGroups.add(groupKey);
      const group = groupByKey.get(groupKey);
      if (!group) continue;
      const desc = formatCurrencyGroupDescription(group, getOwnerLabel);
      if (!desc) continue;
      const isFocused =
        focus && group.intentIds.some((id) => id === focus.id);
      if (!group.net || group.cost <= 0) continue;
      rowsOut.push({
        id: groupKey,
        description: desc,
        cost: group.cost,
        intentIds: group.intentIds.slice(),
        focusIntentId: isFocused ? focus.id : group.intentIds[0] ?? null,
        isFocused,
        isUndoable: true,
      });
      continue;
    }

    if (isTilePlanIntent(intent)) {
      const envCol = Number.isFinite(intent.envCol)
        ? Math.floor(intent.envCol)
        : null;
      if (envCol == null) continue;
      if (emittedTilePlans.has(envCol)) continue;
      emittedTilePlans.add(envCol);
      const group = tilePlanGroups.get(envCol);
      if (!group || group.cost <= 0) continue;
      rowsOut.push({
        id: `tilePlan:${envCol}`,
        description: formatTilePlanLabel(envCol, state),
        cost: group.cost,
        signature: group.signatures.slice().sort().join("|"),
        intentIds: group.intentIds.slice(),
        focusIntentId: group.focusIntentId,
        isFocused: group.isFocused,
        isUndoable: true,
      });
      continue;
    }

    if (isHubPlanIntent(intent)) {
      const hubCol = Number.isFinite(intent.hubCol)
        ? Math.floor(intent.hubCol)
        : null;
      if (hubCol == null) continue;
      if (emittedHubPlans.has(hubCol)) continue;
      emittedHubPlans.add(hubCol);
      const group = hubPlanGroups.get(hubCol);
      if (!group || group.cost <= 0) continue;
      rowsOut.push({
        id: `hubPlan:${hubCol}`,
        description: formatHubPlanLabel(hubCol, state),
        cost: group.cost,
        signature: group.signatures.slice().sort().join("|"),
        intentIds: group.intentIds.slice(),
        focusIntentId: group.focusIntentId,
        isFocused: group.isFocused,
        isUndoable: true,
      });
      continue;
    }

    if (!intent) continue;
    const intentCost = planner?.getIntentCost?.(intentId) ?? 0;
    if (intent.kind === IntentKinds.ITEM_TRANSFER && intentCost <= 0) continue;
    if (intent.kind === IntentKinds.TILE_TAG_ORDER && intentCost <= 0) continue;
    if (intent.kind === IntentKinds.HUB_TAG_ORDER && intentCost <= 0) continue;
    if (intent.kind === IntentKinds.TILE_TAG_TOGGLE && intentCost <= 0) continue;
    if (intent.kind === IntentKinds.HUB_TAG_TOGGLE && intentCost <= 0) continue;
    if (intent.kind === IntentKinds.TILE_CROP_SELECT && intentCost <= 0) continue;
    if (intent.kind === IntentKinds.HUB_RECIPE_SELECT && intentCost <= 0) continue;
    const rowId = intentId ?? `intent:${rowsOut.length}`;
    rowsOut.push({
      id: rowId,
      description: describeIntent(intent, state, getOwnerLabel),
      cost: intentCost,
      intentIds: intentId ? [intentId] : [],
      focusIntentId: intentId,
      isFocused: !!(focus && intentId && focus.id === intentId),
      isUndoable: true,
    });
  }

  return rowsOut;
}

export function buildActionRowSpecs(actions, state, getOwnerLabel) {
  const groupByKey = new Map();
  const groupKeyByAction = new Map();
  const tilePlanGroups = new Map();
  const hubPlanGroups = new Map();

  for (const action of actions) {
    if (action.kind !== ActionKinds.INVENTORY_MOVE) continue;
    const payload = action.payload || {};
    const kind = payload.item?.kind ?? null;
    const info = getCurrencyGroupInfo({
      item: payload.item ?? null,
      kind,
      fromOwnerId: payload.fromOwnerId,
      toOwnerId: payload.toOwnerId,
    });
    if (!info) continue;
    const qty = getItemQuantity(payload.item);
    let group = groupByKey.get(info.key);
    if (!group) {
      group = {
        kind,
        minId: info.minId,
        maxId: info.maxId,
        net: 0,
        cost: 0,
      };
      groupByKey.set(info.key, group);
    }
    group.net += info.dir * qty;
    group.cost += Number.isFinite(action.apCost)
      ? Math.floor(action.apCost)
      : Number.isFinite(payload.apCost)
      ? Math.floor(payload.apCost)
      : 0;
    groupKeyByAction.set(action, info.key);
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!isTilePlanAction(action)) continue;
    const payload = action.payload || {};
    const envCol = Number.isFinite(payload.envCol)
      ? Math.floor(payload.envCol)
      : Number.isFinite(payload.toEnvCol)
      ? Math.floor(payload.toEnvCol)
      : null;
    if (envCol == null) continue;
    let group = tilePlanGroups.get(envCol);
    if (!group) {
      group = { envCol, cost: 0, firstIndex: i };
      tilePlanGroups.set(envCol, group);
    }
    const apCost =
      Number.isFinite(action.apCost) || Number.isFinite(payload.apCost)
        ? Math.floor(action.apCost ?? payload.apCost ?? 0)
        : 0;
    if (apCost > group.cost) group.cost = apCost;
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!isHubPlanAction(action)) continue;
    const payload = action.payload || {};
    const hubCol = Number.isFinite(payload.hubCol)
      ? Math.floor(payload.hubCol)
      : Number.isFinite(payload.toHubCol)
      ? Math.floor(payload.toHubCol)
      : null;
    if (hubCol == null) continue;
    let group = hubPlanGroups.get(hubCol);
    if (!group) {
      group = { hubCol, cost: 0, firstIndex: i };
      hubPlanGroups.set(hubCol, group);
    }
    const apCost =
      Number.isFinite(action.apCost) || Number.isFinite(payload.apCost)
        ? Math.floor(action.apCost ?? payload.apCost ?? 0)
        : 0;
    if (apCost > group.cost) group.cost = apCost;
  }

  const rowsOut = [];
  const emittedGroups = new Set();
  const emittedTilePlans = new Set();
  const emittedHubPlans = new Set();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const payload = action.payload || {};

    const groupKey = groupKeyByAction.get(action);
    if (groupKey) {
      if (emittedGroups.has(groupKey)) continue;
      emittedGroups.add(groupKey);
      const group = groupByKey.get(groupKey);
      if (!group || !group.net || group.cost <= 0) continue;
      const desc = formatCurrencyGroupDescription(group, getOwnerLabel);
      if (!desc) continue;
      rowsOut.push({
        id: groupKey,
        description: desc,
        cost: group.cost,
        isUndoable: false,
      });
      continue;
    }

    if (isTilePlanAction(action)) {
      const envCol = Number.isFinite(payload.envCol)
        ? Math.floor(payload.envCol)
        : Number.isFinite(payload.toEnvCol)
        ? Math.floor(payload.toEnvCol)
        : null;
      if (envCol == null) continue;
      if (emittedTilePlans.has(envCol)) continue;
      emittedTilePlans.add(envCol);
      const group = tilePlanGroups.get(envCol);
      if (!group || group.cost <= 0) continue;
      rowsOut.push({
        id: `tilePlan:${envCol}:${group.firstIndex}`,
        description: formatTilePlanLabel(envCol, state),
        cost: group.cost,
        isUndoable: false,
      });
      continue;
    }

    if (isHubPlanAction(action)) {
      const hubCol = Number.isFinite(payload.hubCol)
        ? Math.floor(payload.hubCol)
        : Number.isFinite(payload.toHubCol)
        ? Math.floor(payload.toHubCol)
        : null;
      if (hubCol == null) continue;
      if (emittedHubPlans.has(hubCol)) continue;
      emittedHubPlans.add(hubCol);
      const group = hubPlanGroups.get(hubCol);
      if (!group || group.cost <= 0) continue;
      rowsOut.push({
        id: `hubPlan:${hubCol}:${group.firstIndex}`,
        description: formatHubPlanLabel(hubCol, state),
        cost: group.cost,
        isUndoable: false,
      });
      continue;
    }

    const kind = action.kind;
    const apCost =
      Number.isFinite(action.apCost) || Number.isFinite(payload.apCost)
        ? Math.floor(action.apCost ?? payload.apCost ?? 0)
        : 0;

    let desc = "Action";
    if (kind === ActionKinds.INVENTORY_MOVE) {
      const itemName = payload.item?.kind
        ? formatItemNameFromKind(payload.item.kind)
        : `Item ${payload.itemId ?? ""}`.trim();
      const dest = formatOwnerName(payload.toOwnerId, getOwnerLabel);
      desc = `${itemName} > ${dest}`;
    } else if (kind === ActionKinds.PLACE_PAWN) {
      const pawnId = payload.pawnId;
      const pawnName = formatPawnName(pawnId, state);
      const placement = resolvePlacementFromPayload(payload);
      const dest = formatPlacementName(placement, state);
      desc = `${pawnName} > ${dest}`;
    } else if (kind === ActionKinds.BUILD_DESIGNATE) {
      desc = `Build ${payload.defId || payload.buildKey || "Plan"}`;
    } else if (kind === ActionKinds.BUILD_CANCEL) {
      const hubCol = Number.isFinite(payload.hubCol)
        ? Math.floor(payload.hubCol)
        : null;
      const hubName = hubCol != null ? formatHubName(hubCol, state) : "Hub";
      const defName = payload.defId
        ? hubStructureDefs[payload.defId]?.name || payload.defId
        : "Structure";
      desc = `Cancel ${defName} @ ${hubName}`;
    } else if (kind === ActionKinds.SET_TILE_TAG_ORDER) {
      const tileName = formatTileName(payload.envCol, state);
      desc = `Tags > ${tileName}`;
    } else if (kind === ActionKinds.SET_HUB_TAG_ORDER) {
      const hubName = formatHubName(payload.hubCol, state);
      desc = `Tags > ${hubName}`;
    } else if (kind === ActionKinds.TOGGLE_TILE_TAG) {
      const tileName = formatTileName(payload.envCol, state);
      const tagName = formatEnvTagName(payload.tagId);
      const status = payload.disabled ? "Off" : "On";
      desc = `Tag ${tagName} > ${tileName}: ${status}`;
    } else if (kind === ActionKinds.TOGGLE_HUB_TAG) {
      const hubName = formatHubName(payload.hubCol, state);
      const tagName = formatHubTagName(payload.tagId);
      const status = payload.disabled ? "Off" : "On";
      desc = `Tag ${tagName} > ${hubName}: ${status}`;
    } else if (kind === ActionKinds.SET_TILE_CROP_SELECTION) {
      const tileName = formatTileName(payload.envCol, state);
      const priority = normalizeRecipePriorityForLog(
        "growth",
        payload.recipePriority,
        payload.cropId ?? null
      );
      const summary = formatCropPriorityLabel(priority);
      desc = `Seeds > ${tileName}: ${summary}`;
    } else if (kind === ActionKinds.SET_HUB_RECIPE_SELECTION) {
      const hubName = formatHubName(payload.hubCol, state);
      const priority = normalizeRecipePriorityForLog(
        payload.systemId ?? null,
        payload.recipePriority,
        payload.recipeId ?? null
      );
      const summary = formatRecipePriorityLabel(payload.systemId ?? null, priority);
      desc = `Recipes > ${hubName}: ${summary}`;
    } else if (kind === ActionKinds.UNLOCK_SKILL_NODE) {
      const leaderPawnId =
        payload.leaderPawnId != null
          ? payload.leaderPawnId
          : payload.pawnId != null
            ? payload.pawnId
            : null;
      const pawnName = formatPawnName(leaderPawnId, state);
      const skillName = formatSkillNodeName(payload.nodeId);
      desc = `Skill > ${pawnName}: ${skillName}`;
    }

    if (kind === ActionKinds.INVENTORY_MOVE && apCost <= 0) continue;
    if (kind === ActionKinds.SET_TILE_TAG_ORDER && apCost <= 0) continue;
    if (kind === ActionKinds.SET_HUB_TAG_ORDER && apCost <= 0) continue;
    if (kind === ActionKinds.TOGGLE_TILE_TAG && apCost <= 0) continue;
    if (kind === ActionKinds.TOGGLE_HUB_TAG && apCost <= 0) continue;
    if (kind === ActionKinds.SET_TILE_CROP_SELECTION && apCost <= 0) continue;
    if (kind === ActionKinds.SET_HUB_RECIPE_SELECTION && apCost <= 0) continue;
    rowsOut.push({
      id: `${kind}:${i}`,
      description: desc,
      cost: apCost,
      isUndoable: false,
    });
  }

  return rowsOut;
}

function isLogAction(action) {
  if (!action || typeof action !== "object") return false;
  const kind = action.kind;
  if (kind === ActionKinds.INVENTORY_MOVE) {
    const payload = action.payload || {};
    const fromOwner = payload.fromOwnerId;
    const toOwner = payload.toOwnerId;
    return fromOwner != null && toOwner != null && fromOwner !== toOwner;
  }
  if (kind === ActionKinds.PLACE_PAWN) return true;
  if (kind === ActionKinds.BUILD_DESIGNATE) return true;
  if (kind === ActionKinds.BUILD_CANCEL) return true;
  if (kind === ActionKinds.SET_TILE_TAG_ORDER) return true;
  if (kind === ActionKinds.SET_HUB_TAG_ORDER) return true;
  if (kind === ActionKinds.TOGGLE_TILE_TAG) return true;
  if (kind === ActionKinds.TOGGLE_HUB_TAG) return true;
  if (kind === ActionKinds.SET_TILE_CROP_SELECTION) return true;
  if (kind === ActionKinds.SET_HUB_RECIPE_SELECTION) return true;
  if (kind === ActionKinds.UNLOCK_SKILL_NODE) return true;
  return false;
}

function getActionsAtSecond(timeline, sec) {
  if (!timeline) return [];
  if (timeline.actionsBySec && typeof timeline.actionsBySec.get === "function") {
    return timeline.actionsBySec.get(sec) || [];
  }
  return (timeline.actions || []).filter(
    (a) => Math.floor(a.tSec ?? 0) === sec
  );
}

function lowerBoundSorted(list, value) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundSorted(list, value) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function createActionLogController({
  getPlanner,
  getTimeline,
  getState,
  getCursorState,
  getOwnerLabel,
  getPendingActionRowSpecs,
} = {}) {
  let cachedActionSecs = [];
  let lastActionSig = null;

  function computeActionSig(tl) {
    const acts = Array.isArray(tl?.actions) ? tl.actions : [];
    const len = acts.length;
    const last = len ? acts[len - 1] : null;
    return {
      ref: acts,
      len,
      lastRef: last,
      lastSec: last ? Math.floor(last.tSec ?? 0) : 0,
    };
  }

  function actionSigEquals(a, b) {
    if (!a || !b) return false;
    return (
      a.ref === b.ref &&
      a.len === b.len &&
      a.lastRef === b.lastRef &&
      a.lastSec === b.lastSec
    );
  }

  function getTimelineSafe() {
    return typeof getTimeline === "function" ? getTimeline() : null;
  }

  function getStateSafe() {
    return typeof getState === "function" ? getState() : null;
  }

  function getCursorStateSafe() {
    return typeof getCursorState === "function" ? getCursorState() : null;
  }

  function rebuildActionSecs() {
    const tl = getTimelineSafe();
    if (!tl) {
      cachedActionSecs = [];
      lastActionSig = null;
      return;
    }
    const sig = computeActionSig(tl);
    if (actionSigEquals(sig, lastActionSig)) return;

    const prevSig = lastActionSig;
    const appendOnly =
      prevSig &&
      sig.ref === prevSig.ref &&
      sig.len === prevSig.len + 1 &&
      sig.lastRef !== prevSig.lastRef &&
      sig.lastSec >= prevSig.lastSec;
    if (appendOnly) {
      lastActionSig = sig;
      const lastAction = sig.lastRef;
      if (!isLogAction(lastAction)) return;
      const sec = Math.max(0, Math.floor(lastAction?.tSec ?? 0));
      const lastIdx = cachedActionSecs.length - 1;
      const lastSec = lastIdx >= 0 ? cachedActionSecs[lastIdx] : null;
      if (lastSec == null || sec > lastSec) {
        cachedActionSecs.push(sec);
        return;
      }
      if (sec === lastSec) return;
      const insertIdx = lowerBoundSorted(cachedActionSecs, sec);
      if (cachedActionSecs[insertIdx] !== sec) {
        cachedActionSecs.splice(insertIdx, 0, sec);
      }
      return;
    }

    const mutationKind = tl?._lastMutationKind ?? null;
    const mutationSecRaw = tl?._lastMutationSec;
    const mutationSec = Number.isFinite(mutationSecRaw)
      ? Math.max(0, Math.floor(mutationSecRaw))
      : null;
    const canPatchBySecond =
      prevSig &&
      mutationSec != null &&
      (mutationKind === "replaceActionsAtSec" ||
        mutationKind === "truncateTimelineAfterSec");
    if (canPatchBySecond) {
      lastActionSig = sig;

      if (mutationKind === "replaceActionsAtSec") {
        const actionsAtSec = getActionsAtSecond(tl, mutationSec);
        const hasLogActionAtSec = actionsAtSec.some(isLogAction);
        const insertIdx = lowerBoundSorted(cachedActionSecs, mutationSec);
        const existsAtSec = cachedActionSecs[insertIdx] === mutationSec;
        if (hasLogActionAtSec && !existsAtSec) {
          cachedActionSecs.splice(insertIdx, 0, mutationSec);
        } else if (!hasLogActionAtSec && existsAtSec) {
          cachedActionSecs.splice(insertIdx, 1);
        }
      }

      const truncateFrom = upperBoundSorted(cachedActionSecs, mutationSec);
      if (truncateFrom < cachedActionSecs.length) {
        cachedActionSecs.splice(truncateFrom);
      }
      return;
    }

    lastActionSig = sig;

    const set = new Set();
    for (const action of tl?.actions || []) {
      if (!isLogAction(action)) continue;
      set.add(Math.max(0, Math.floor(action.tSec ?? 0)));
    }
    cachedActionSecs = Array.from(set.values()).sort((a, b) => a - b);
  }

  function getActionSecs() {
    rebuildActionSecs();
    return cachedActionSecs;
  }

  function getPrevNextSecs(currentSec) {
    const list = getActionSecs();
    if (!list.length) return { prev: null, next: null };

    let lo = 0;
    let hi = list.length - 1;
    let prev = null;
    let next = null;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const val = list[mid];
      if (val < currentSec) {
        prev = val;
        lo = mid + 1;
      } else if (val > currentSec) {
        next = val;
        hi = mid - 1;
      } else {
        prev = mid > 0 ? list[mid - 1] : null;
        next = mid < list.length - 1 ? list[mid + 1] : null;
        return { prev, next };
      }
    }

    return { prev, next };
  }

  function getPrevNextForCursor() {
    const cursor = getCursorStateSafe();
    const currentSec = Math.floor(cursor?.tSec ?? 0);
    return getPrevNextSecs(currentSec);
  }

  function getPreviewSec() {
    const state = getStateSafe();
    return Math.floor(state?.tSec ?? 0);
  }

  function getIntentRowSpecs() {
    const planner = typeof getPlanner === "function" ? getPlanner() : null;
    const pendingRows =
      typeof getPendingActionRowSpecs === "function"
        ? getPendingActionRowSpecs() || []
        : [];
    if (!planner) return pendingRows;
    const state = getStateSafe();
    const intents = planner.getOrderedIntents?.() || [];
    const focus = planner.getFocusIntent?.();
    return buildIntentRowSpecs(intents, planner, state, focus, getOwnerLabel).concat(
      pendingRows
    );
  }

  function getActionRowSpecsForCurrentSec() {
    const state = getStateSafe();
    const tl = getTimelineSafe();
    const tSec = Math.floor(state?.tSec ?? 0);
    const actions = getActionsAtSecond(tl, tSec).filter(isLogAction);
    return buildActionRowSpecs(actions, state, getOwnerLabel);
  }

  function getApText(previewing) {
    const planner = typeof getPlanner === "function" ? getPlanner() : null;
    const state = getStateSafe();

    if (previewing && state) {
      const cur = Math.floor(state.actionPoints ?? 0);
      const cap = Math.floor(state.actionPointCap ?? 0);
      return `${cur}/${cap}`;
    }

    const ap = planner?.getApPreview?.();
    if (ap) {
      return `${Math.floor(ap.remaining)}/${Math.floor(ap.base)}`;
    }

    return "--/--";
  }

  return {
    getActionSecs,
    getPrevNextSecs,
    getPrevNextForCursor,
    getPreviewSec,
    getIntentRowSpecs,
    getActionRowSpecsForCurrentSec,
    getApText,
  };
}

