// src/model/query.js
// Pure selectors for UI + behaviors.

import { itemDefs } from "../defs/gamepieces-defs.js";

function itemHasTag(item, tag) {
  if (!item || !tag) return false;
  const defTags = itemDefs[item.kind]?.tags || [];
  return Array.isArray(defTags) && defTags.includes(tag);
}

export function getItemsByTag(state, tag) {
  if (!state?.ownerInventories) return [];
  const out = [];
  for (const inv of Object.values(state.ownerInventories)) {
    if (!inv?.items) continue;
    for (const item of inv.items) {
      if (itemHasTag(item, tag)) out.push(item);
    }
  }
  return out;
}

export function getTotalStackByTag(state, tag) {
  if (!state?.ownerInventories) return 0;
  let total = 0;
  for (const inv of Object.values(state.ownerInventories)) {
    if (!inv?.items) continue;
    for (const item of inv.items) {
      if (!itemHasTag(item, tag)) continue;
      total += Math.max(0, Math.floor(item.quantity ?? 0));
    }
  }
  return total;
}

export function getTotalFoodFromEdibles(state) {
  return getTotalStackByTag(state, "edible");
}
