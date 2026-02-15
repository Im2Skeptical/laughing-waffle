// inventory-model.js
// Pure data-only inventory API + item helpers.
// No PIXI, no UI.

import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { itemSystemDefs } from "../defs/gamesystems/item-system-defs.js";

// -----------------------------------------------------------------------------
// RNG HELPERS COME FROM THE MODEL, so inventory must NOT import gameState.
// All randomness must be passed via 'state' parameter.
// -----------------------------------------------------------------------------

function cloneSerializable(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (_) {
    // ignore and fall through
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeTagList(tags) {
  const raw = Array.isArray(tags) ? tags : [];
  const seen = new Set();
  const out = [];
  for (const tag of raw) {
    if (typeof tag !== "string") continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function collectSystemsFromTags(tags) {
  const systems = [];
  const seen = new Set();
  const tagList = Array.isArray(tags) ? tags : [];
  for (const tagId of tagList) {
    const tagDef = itemTagDefs[tagId];
    const tagSystems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
    for (const systemId of tagSystems) {
      if (typeof systemId !== "string") continue;
      if (seen.has(systemId)) continue;
      seen.add(systemId);
      systems.push(systemId);
    }
  }
  return systems;
}

function ensureItemSystemStructures(item, reset) {
  if (reset || !item.systemTiers || typeof item.systemTiers !== "object") {
    item.systemTiers = {};
  }
  if (reset || !item.systemState || typeof item.systemState !== "object") {
    item.systemState = {};
  }
}

function ensureItemSystemInitialized(item, def, systemId, reset) {
  if (!systemId || typeof systemId !== "string") return;
  const systemDef = itemSystemDefs[systemId];
  if (!systemDef) return;

  const itemTier = typeof item?.tier === "string" ? item.tier : null;
  const defTier = def?.baseSystemTiers?.[systemId];
  const targetTier =
    itemTier ??
    (typeof defTier === "string"
      ? defTier
      : typeof systemDef.defaultTier === "string"
        ? systemDef.defaultTier
        : "bronze");

  if (reset || item.systemTiers[systemId] == null) {
    item.systemTiers[systemId] = targetTier;
  }

  const hasExisting =
    item.systemState[systemId] && typeof item.systemState[systemId] === "object";
  if (!reset && hasExisting) return;

  const defaults = cloneSerializable(systemDef.stateDefaults ?? {});
  const overridesRaw = def?.baseSystemState?.[systemId];
  if (overridesRaw && typeof overridesRaw === "object") {
    const overrides = cloneSerializable(overridesRaw);
    item.systemState[systemId] = { ...defaults, ...overrides };
  } else {
    item.systemState[systemId] = defaults;
  }
}

function initializeItemTags(item, def, reset) {
  const baseTags = normalizeTagList(def?.baseTags);
  const shouldApply = reset || !Array.isArray(item.tags) || item.tags.length === 0;
  if (shouldApply) {
    item.tags = baseTags.slice();
    return;
  }

  // In clean-break mode we do not patch missing tags from defs at runtime.
  item.tags = normalizeTagList(item.tags);
}

function getSystemsToInitialize(item, def) {
  const systems = [];
  const seen = new Set();

  const addSystem = (systemId) => {
    if (typeof systemId !== "string") return;
    if (seen.has(systemId)) return;
    seen.add(systemId);
    systems.push(systemId);
  };

  const defTiers = def?.baseSystemTiers;
  if (defTiers && typeof defTiers === "object") {
    for (const systemId of Object.keys(defTiers)) addSystem(systemId);
  }

  const defState = def?.baseSystemState;
  if (defState && typeof defState === "object") {
    for (const systemId of Object.keys(defState)) addSystem(systemId);
  }

  const tagSystems = collectSystemsFromTags(item.tags);
  for (const systemId of tagSystems) addSystem(systemId);

  return systems;
}

// -----------------------------------------------------------------------------
// INVENTORY CORE
// -----------------------------------------------------------------------------

export const Inventory = {
  create(cols, rows) {
    return {
      cols,
      rows,
      grid: new Array(cols * rows).fill(null),
      items: [],
      itemsById: {},
    };
  },

  init(inv) {
    inv.grid = new Array(inv.cols * inv.rows).fill(null);
    inv.items = [];
    inv.itemsById = {};
  },

  addNewItem(state, inv, config) {
    const item = {
      id: state.nextItemId++,
      kind: config.kind || "item",
      width: config.width || 1,
      height: config.height || 1,
      quantity: config.quantity ?? 1,
      tier: config.tier ?? null,
      expiryTurn: config.expiryTurn ?? null,
      gridX: config.gridX ?? 0,
      gridY: config.gridY ?? 0,
      seasonsToExpire: config.seasonsToExpire ?? null,
      tags: Array.isArray(config.tags) ? config.tags.slice() : [],
      systemTiers:
        config.systemTiers && typeof config.systemTiers === "object"
          ? cloneSerializable(config.systemTiers)
          : {},
      systemState:
        config.systemState && typeof config.systemState === "object"
          ? cloneSerializable(config.systemState)
          : {},
    };

    // Apply def-derived defaults and base tags/systems before placement checks.
    initializeItemFromDef(state, item, { reset: true });

    // Re-apply explicit per-instance overrides after def initialization.
    if (Array.isArray(config.tags)) {
      item.tags = normalizeTagList(cloneSerializable(config.tags));
    }
    if (config.systemTiers && typeof config.systemTiers === "object") {
      const tiers = cloneSerializable(config.systemTiers);
      for (const [systemId, tierValue] of Object.entries(tiers)) {
        item.systemTiers[systemId] = tierValue;
      }
    }
    if (config.systemState && typeof config.systemState === "object") {
      const states = cloneSerializable(config.systemState);
      for (const [systemId, systemValue] of Object.entries(states)) {
        item.systemState[systemId] = systemValue;
      }
    }

    if (!Inventory.canPlaceItemAt(inv, item, item.gridX, item.gridY)) {
      let placed = false;
      outer: for (let gy = 0; gy <= inv.rows - item.height; gy++) {
        for (let gx = 0; gx <= inv.cols - item.width; gx++) {
          if (Inventory.canPlaceItemAt(inv, item, gx, gy)) {
            item.gridX = gx;
            item.gridY = gy;
            placed = true;
            break outer;
          }
        }
      }
      if (!placed) {
        console.warn("Inventory full, couldn't place item", item);
        return null;
      }
    }

    inv.items.push(item);
    inv.itemsById[item.id] = item;
    Inventory.occupyCellsForItem(inv, item);
    return item;
  },

  canPlaceItemAt(inv, item, gx, gy) {
    if (gx < 0 || gy < 0) return false;
    if (gx + item.width > inv.cols) return false;
    if (gy + item.height > inv.rows) return false;

    for (let y = 0; y < item.height; y++) {
      for (let x = 0; x < item.width; x++) {
        const idx = (gy + y) * inv.cols + (gx + x);
        if (inv.grid[idx] != null) return false;
      }
    }
    return true;
  },

  occupyCellsForItem(inv, item) {
    for (let y = 0; y < item.height; y++) {
      for (let x = 0; x < item.width; x++) {
        const idx = item.gridX + x + (item.gridY + y) * inv.cols;
        inv.grid[idx] = item.id;
      }
    }
  },

  clearItemFromGrid(inv, itemOrId) {
    const id = typeof itemOrId === "number" ? itemOrId : itemOrId.id;
    for (let idx = 0; idx < inv.grid.length; idx++) {
      if (inv.grid[idx] === id) inv.grid[idx] = null;
    }
  },

  syncGridFromItems(inv) {
    inv.grid.fill(null);
    for (const item of inv.items) {
      Inventory.occupyCellsForItem(inv, item);
    }
  },

  // Rebuild ALL derived fields from authoritative `items[]`.
  // This is the single source of truth for inventory invariants.
  rebuildDerived(inv) {
    if (!inv) return;

    // Ensure grid is correctly sized.
    const expected = inv.cols * inv.rows;
    if (!Array.isArray(inv.grid) || inv.grid.length !== expected) {
      inv.grid = new Array(expected).fill(null);
    } else {
      inv.grid.fill(null);
    }

    // Rebuild itemsById to reference the exact same objects in items[].
    inv.itemsById = {};
    for (const item of inv.items) {
      inv.itemsById[item.id] = item;
      Inventory.occupyCellsForItem(inv, item);
    }
  },

  placeItemAt(inv, item, gx, gy) {
    Inventory.clearItemFromGrid(inv, item);
    item.gridX = gx;
    item.gridY = gy;
    Inventory.occupyCellsForItem(inv, item);
  },

  getItem(inv, itemId) {
    return inv.itemsById[itemId] || null;
  },

  removeItem(inv, itemId) {
    Inventory.clearItemFromGrid(inv, itemId);
    inv.items = inv.items.filter((it) => it.id !== itemId);
    delete inv.itemsById[itemId];
  },

  attachExistingItem(inv, item, gx, gy) {
    if (!Inventory.canPlaceItemAt(inv, item, gx, gy)) return false;
    item.gridX = gx;
    item.gridY = gy;
    inv.items.push(item);
    inv.itemsById[item.id] = item;
    Inventory.occupyCellsForItem(inv, item);
    return true;
  },
};

// -----------------------------------------------------------------------------
// ITEM HELPERS
// -----------------------------------------------------------------------------

export function initializeItemFromDef(state, item, options = {}) {
  const def = itemDefs[item.kind];
  if (!def) return;

  const reset = options.reset === true;

  initializeItemTags(item, def, reset);
  ensureItemSystemStructures(item, reset);

  if (def.defaultWidth != null) item.width = def.defaultWidth;
  if (def.defaultHeight != null) item.height = def.defaultHeight;
  if (def.defaultTier != null && item.tier == null) item.tier = def.defaultTier;

  const systems = getSystemsToInitialize(item, def);
  for (const systemId of systems) {
    ensureItemSystemInitialized(item, def, systemId, reset);
  }

  const maxStack = def.maxStack != null ? def.maxStack : 999;
  if (item.quantity > maxStack) item.quantity = maxStack;
}

export function getItemMaxStack(item) {
  const def = itemDefs[item.kind];
  return def && def.maxStack != null ? def.maxStack : 999;
}

function deepEqualSerializable(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualSerializable(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === "object") {
    if (Array.isArray(b)) return false;
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i]) return false;
      const key = keysA[i];
      if (!deepEqualSerializable(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

export function canStackItems(a, b) {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if ((a.seasonsToExpire ?? null) !== (b.seasonsToExpire ?? null)) return false;
  if ((a.tier ?? null) !== (b.tier ?? null)) return false;
  if (!deepEqualSerializable(a.tags ?? [], b.tags ?? [])) return false;
  if (!deepEqualSerializable(a.systemTiers ?? {}, b.systemTiers ?? {})) return false;
  return true;
}

export function mergeItemSystemStateForStacking(
  target,
  source,
  targetQtyBefore,
  movedQty
) {
  if (!target || !source) return;
  const qtyBefore = Math.max(0, Math.floor(targetQtyBefore ?? 0));
  const qtyMoved = Math.max(0, Math.floor(movedQty ?? 0));
  const totalQty = qtyBefore + qtyMoved;
  if (totalQty <= 0) return;

  const targetFreshness = target.systemState?.freshness;
  const sourceFreshness = source.systemState?.freshness;
  if (!targetFreshness || !sourceFreshness) return;

  const targetAge = Number.isFinite(targetFreshness.ageSec)
    ? targetFreshness.ageSec
    : 0;
  const sourceAge = Number.isFinite(sourceFreshness.ageSec)
    ? sourceFreshness.ageSec
    : 0;

  const mergedAge = Math.floor(
    (targetAge * qtyBefore + sourceAge * qtyMoved) / totalQty
  );
  if (mergedAge !== targetAge) {
    targetFreshness.ageSec = mergedAge;
  }
}

export function splitStack(state, inv, item, amount) {
  if (!inv || !item) return null;
  if (amount <= 0 || amount >= item.quantity) return null;

  item.quantity -= amount;

  const newItem = {
    id: state.nextItemId++,
    kind: item.kind,
    width: item.width,
    height: item.height,
    gridX: item.gridX,
    gridY: item.gridY,
    quantity: amount,
    tier: item.tier ?? null,
    seasonsToExpire: item.seasonsToExpire ?? null,
    tags: cloneSerializable(item.tags ?? []),
    systemTiers: cloneSerializable(item.systemTiers ?? {}),
    systemState: cloneSerializable(item.systemState ?? {}),
  };

  inv.items.push(newItem);
  inv.itemsById[newItem.id] = newItem;
  return newItem;
}

export function trySplitStackAndPlace(state, inv, item, amount) {
  if (!inv || !item) {
    console.warn("trySplitStackAndPlace called with missing inv/item", {
      inv,
      item,
      amount,
    });
    return null;
  }

  Inventory.syncGridFromItems(inv);

  const splitAmount = Math.floor(amount);
  if (splitAmount <= 0 || splitAmount >= item.quantity) return null;

  item.quantity -= splitAmount;

  const newItem = {
    id: state.nextItemId++,
    kind: item.kind,
    width: item.width,
    height: item.height,
    gridX: item.gridX,
    gridY: item.gridY,
    quantity: splitAmount,
    tier: item.tier ?? null,
    seasonsToExpire: item.seasonsToExpire ?? null,
    tags: cloneSerializable(item.tags ?? []),
    systemTiers: cloneSerializable(item.systemTiers ?? {}),
    systemState: cloneSerializable(item.systemState ?? {}),
  };

  let placed = false;
  outer: for (let gy = 0; gy <= inv.rows - newItem.height; gy++) {
    for (let gx = 0; gx <= inv.cols - newItem.width; gx++) {
      if (Inventory.canPlaceItemAt(inv, newItem, gx, gy)) {
        newItem.gridX = gx;
        newItem.gridY = gy;
        Inventory.occupyCellsForItem(inv, newItem);
        placed = true;
        break outer;
      }
    }
  }

  if (!placed) {
    item.quantity += splitAmount;
    return null;
  }

  inv.items.push(newItem);
  inv.itemsById[newItem.id] = newItem;
  return newItem;
}
