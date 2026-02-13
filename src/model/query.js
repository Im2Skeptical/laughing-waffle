// src/model/query.js
// Pure selectors for UI.

const inventoryTagTotalsCache = new WeakMap();

function itemHasTag(item, tag) {
  if (!item || !tag) return false;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return tags.includes(tag);
}

function getInventoryTagTotals(inv) {
  if (!inv || typeof inv !== "object") return new Map();

  const version = Number.isFinite(inv.version) ? Math.floor(inv.version) : null;
  if (version != null) {
    const cached = inventoryTagTotalsCache.get(inv);
    if (cached && cached.version === version) return cached.totalsByTag;
  }

  const totalsByTag = new Map();
  const items = Array.isArray(inv.items) ? inv.items : [];

  for (const item of items) {
    const qty = Math.max(0, Math.floor(item?.quantity ?? 0));
    if (qty <= 0) continue;

    const tags = Array.isArray(item?.tags) ? item.tags : [];
    if (!tags.length) continue;

    const seen = new Set();
    for (const tag of tags) {
      if (typeof tag !== "string") continue;
      if (seen.has(tag)) continue;
      seen.add(tag);

      const prev = totalsByTag.get(tag) ?? 0;
      totalsByTag.set(tag, prev + qty);
    }
  }

  if (version != null) {
    inventoryTagTotalsCache.set(inv, { version, totalsByTag });
  }
  return totalsByTag;
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
  if (!state?.ownerInventories || !tag) return 0;
  let total = 0;
  for (const inv of Object.values(state.ownerInventories)) {
    const totalsByTag = getInventoryTagTotals(inv);
    total += totalsByTag.get(tag) ?? 0;
  }
  return total;
}

export function getTotalFoodFromEdibles(state) {
  return getTotalStackByTag(state, "edible");
}
