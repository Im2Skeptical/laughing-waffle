// item-exec.js
// Per-second item execution (tag-driven passives).

import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { passiveTimingPasses } from "./passive-timing.js";

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

function ownerKey(ownerId) {
  return String(ownerId);
}

function parseOwnerId(ownerId) {
  const num = Number(ownerId);
  if (Number.isFinite(num) && ownerKey(num) === ownerKey(ownerId)) {
    return num;
  }
  return ownerId;
}

function collectDeterministicOwnerOrder(state) {
  const invs = state?.ownerInventories;
  if (!invs || typeof invs !== "object") return [];

  const order = [];
  const seen = new Set();

  const addOwner = (ownerId) => {
    if (ownerId == null) return;
    const key = ownerKey(ownerId);
    if (seen.has(key)) return;
    if (!invs[key]) return;
    seen.add(key);
    order.push(parseOwnerId(ownerId));
  };

  // 1) Pawns (array order)
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) addOwner(pawn?.id ?? null);

  // 2) Hub structures (slot order)
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    addOwner(slot?.structure?.instanceId ?? null);
  }

  // 3) Global inventories (fixed sorted order)
  const globals = [];
  for (const ownerId of Object.keys(invs)) {
    const key = ownerKey(ownerId);
    if (seen.has(key)) continue;
    globals.push(ownerId);
  }
  globals.sort(compareOwnerIds);
  for (const ownerId of globals) addOwner(ownerId);

  return order;
}

function buildItemPassiveKey(ownerId, item, tagId, passive, passiveIndex) {
  const passiveId =
    typeof passive?.id === "string" && passive.id.length > 0
      ? passive.id
      : `idx${passiveIndex}`;
  const itemKey = item?.id != null ? item.id : item?.kind ?? "unknown";
  return `item:${ownerId}:id:${itemKey}:tag:${tagId}:passive:${passiveId}`;
}

function runItemTagPassives(state, runEffect, inv, ownerId, item, tSec) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  if (tags.length === 0) return;

  const itemId = item.id;
  const initialKind = item.kind;
  const baseContext = {
    kind: "item",
    state,
    source: item,
    item,
    inv,
    ownerId,
    tSec,
  };

  for (const tagId of tags) {
    const tagDef = itemTagDefs[tagId];
    if (!tagDef) continue;
    const passives = Array.isArray(tagDef.passives) ? tagDef.passives : [];
    for (let passiveIndex = 0; passiveIndex < passives.length; passiveIndex++) {
      const passive = passives[passiveIndex];
      if (!passive || typeof passive !== "object") continue;
      const passiveKey = buildItemPassiveKey(
        ownerId,
        item,
        tagId,
        passive,
        passiveIndex
      );
      if (
        !passiveTimingPasses(passive.timing, state, tSec, {
          passiveKey,
          isActive: true,
        })
      ) {
        continue;
      }
      if (passive.effect) runEffect(state, passive.effect, { ...baseContext });

      // If the item was removed or transformed, stop processing it this tick.
      if (!inv.itemsById?.[itemId]) return;
      if (item.kind !== initialKind) return;
    }
  }
}

export function stepItemSecond(state, tSec, runEffect) {
  if (!state?.ownerInventories) return;
  if (typeof runEffect !== "function") return;

  const ownerOrder = collectDeterministicOwnerOrder(state);
  for (const ownerId of ownerOrder) {
    const inv = state.ownerInventories[ownerId];
    if (!inv || !Array.isArray(inv.items) || inv.items.length === 0) continue;

    const itemIds = inv.items.map((it) => it?.id).filter((id) => id != null);
    for (const itemId of itemIds) {
      const item = inv.itemsById?.[itemId] ?? inv.items.find((it) => it.id === itemId);
      if (!item) continue;
      runItemTagPassives(state, runEffect, inv, ownerId, item, tSec);
    }
  }
}
