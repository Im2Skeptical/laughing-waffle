// inventory-model.js
// Pure data-only inventory API + item helpers.
// No PIXI, no UI.

import { itemDefs } from "../defs/defs.js";

// -----------------------------------------------------------------------------
// RNG HELPERS COME FROM THE MODEL, so inventory must NOT import gameState.
// All randomness must be passed via 'state' parameter.
// -----------------------------------------------------------------------------

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
      expiryTurn: config.expiryTurn ?? null,
      gridX: config.gridX ?? 0,
      gridY: config.gridY ?? 0,
      seasonsToExpire: config.seasonsToExpire ?? null,
    };

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

export function initializeItemFromDef(state, item) {
  const def = itemDefs[item.kind];
  if (!def) return;

  if (def.expirySeasonsRange) {
    const [min, max] = def.expirySeasonsRange;
    // deterministic RNG
    item.seasonsToExpire = state.rngNextInt(min, max);
  }

  if (def.defaultWidth != null) item.width = def.defaultWidth;
  if (def.defaultHeight != null) item.height = def.defaultHeight;

  const maxStack = def.maxStack != null ? def.maxStack : 999;
  if (item.quantity > maxStack) item.quantity = maxStack;
}

export function getItemMaxStack(item) {
  const def = itemDefs[item.kind];
  return def && def.maxStack != null ? def.maxStack : 999;
}

export function canStackItems(a, b) {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  return (a.seasonsToExpire ?? null) === (b.seasonsToExpire ?? null);
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
    seasonsToExpire: item.seasonsToExpire ?? null,
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
    seasonsToExpire: item.seasonsToExpire ?? null,
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
