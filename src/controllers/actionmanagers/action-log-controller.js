// src/controllers/actionmanagers/action-log-controller.js
// View-model helpers for action log rows and navigation.

import { itemDefs, hubStructureDefs } from "../../defs/gamepieces/gamepieces-defs.js";
import { envTileDefs } from "../../defs/gamepieces/env-tiles-defs.js";
import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { ActionKinds } from "../../model/actions.js";
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

function formatOwnerName(ownerId, getOwnerLabel) {
  if (typeof getOwnerLabel === "function") return getOwnerLabel(ownerId);
  return `Owner ${ownerId}`;
}

function formatPawnName(charId, state) {
  const ch = state?.characters?.find((c) => c.id === charId);
  return ch?.name || `Char ${charId}`;
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
      const pawnName = formatPawnName(intent.charId, state);
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
    case IntentKinds.TILE_CROP_SELECT: {
      const tileName = formatTileName(intent.envCol, state);
      const cropName = formatCropName(intent.cropId);
      return `Crop > ${tileName}: ${cropName}`;
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

  for (const intent of intents) {
    if (intent?.kind !== IntentKinds.ITEM_TRANSFER) continue;
    const kind = intent.item?.kind ?? null;
    const info = getCurrencyGroupInfo({
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

    if (!intent) continue;
    const intentCost = planner?.getIntentCost?.(intentId) ?? 0;
    if (intent.kind === IntentKinds.ITEM_TRANSFER && intentCost <= 0) continue;
    if (intent.kind === IntentKinds.TILE_TAG_ORDER && intentCost <= 0) continue;
    if (intent.kind === IntentKinds.TILE_CROP_SELECT && intentCost <= 0) continue;
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

function buildActionRowSpecs(actions, state, getOwnerLabel) {
  const groupByKey = new Map();
  const groupKeyByAction = new Map();

  for (const action of actions) {
    if (action.kind !== ActionKinds.INVENTORY_MOVE) continue;
    const payload = action.payload || {};
    const kind = payload.item?.kind ?? null;
    const info = getCurrencyGroupInfo({
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

  const rowsOut = [];
  const emittedGroups = new Set();

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
    } else if (kind === ActionKinds.PLACE_CHARACTER) {
      const pawnName = formatPawnName(payload.charId, state);
      const placement = resolvePlacementFromPayload(payload);
      const dest = formatPlacementName(placement, state);
      desc = `${pawnName} > ${dest}`;
    } else if (kind === ActionKinds.BUILD_DESIGNATE) {
      desc = `Build ${payload.defId || payload.buildKey || "Plan"}`;
    } else if (kind === ActionKinds.SET_TILE_TAG_ORDER) {
      const tileName = formatTileName(payload.envCol, state);
      desc = `Tags > ${tileName}`;
    } else if (kind === ActionKinds.SET_TILE_CROP_SELECTION) {
      const tileName = formatTileName(payload.envCol, state);
      const cropName = formatCropName(payload.cropId);
      desc = `Crop > ${tileName}: ${cropName}`;
    }

    if (kind === ActionKinds.INVENTORY_MOVE && apCost <= 0) continue;
    if (kind === ActionKinds.SET_TILE_TAG_ORDER && apCost <= 0) continue;
    if (kind === ActionKinds.SET_TILE_CROP_SELECTION && apCost <= 0) continue;
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
  if (kind === ActionKinds.PLACE_CHARACTER) return true;
  if (kind === ActionKinds.BUILD_DESIGNATE) return true;
  if (kind === ActionKinds.SET_TILE_TAG_ORDER) return true;
  if (kind === ActionKinds.SET_TILE_CROP_SELECTION) return true;
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

export function createActionLogController({
  getPlanner,
  getTimeline,
  getState,
  getCursorState,
  getOwnerLabel,
} = {}) {
  let lastTimelineRevision = null;
  let cachedActionSecs = [];

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
    const rev = Math.floor(tl?.revision ?? -1);
    if (rev === lastTimelineRevision) return;
    lastTimelineRevision = rev;

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
    let prev = null;
    let next = null;
    for (const sec of list) {
      if (sec < currentSec) prev = sec;
      if (sec > currentSec) {
        next = sec;
        break;
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
    if (!planner) return [];
    const state = getStateSafe();
    const intents = planner.getOrderedIntents?.() || [];
    const focus = planner.getFocusIntent?.();
    return buildIntentRowSpecs(intents, planner, state, focus, getOwnerLabel);
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

