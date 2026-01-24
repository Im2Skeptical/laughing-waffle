import { itemDefs } from "../../../defs/gamepieces/item-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
} from "../../inventory-model.js";
import { bumpInvVersion } from "../core/inventory-version.js";

export function handleTransformItem(state, effect, context) {
  if (!context || context.kind !== "item") return false;
  const { inv, item } = context;
  if (!inv || !item) return false;

  const targetKind = effect.targetKind;
  if (!targetKind) return false;

  const targetDef = itemDefs[targetKind];
  if (!targetDef) return false;

  Inventory.clearItemFromGrid(inv, item);

  item.kind = targetKind;
  item.width = targetDef.defaultWidth ?? 1;
  item.height = targetDef.defaultHeight ?? 1;
  item.seasonsToExpire = null;

  Inventory.occupyCellsForItem(inv, item);
  bumpInvVersion(inv);
  return true;
}

export function handleRemoveItem(state, effect, context) {
  if (!context || context.kind !== "item") return false;
  const { inv, item } = context;
  if (!inv || !item) return false;
  Inventory.removeItem(inv, item.id);
  bumpInvVersion(inv);
  return true;
}

export function handleExpireItemChance(state, effect, context) {
  if (!context || context.kind !== "item") return false;
  const { inv, item } = context;
  if (!inv || !item) return false;

  const itemDef = itemDefs[item.kind] || null;
  let chance = effect.chance;
  if (!Number.isFinite(chance) && effect.chanceFromDefKey && itemDef) {
    chance = itemDef[effect.chanceFromDefKey];
  }
  if (!Number.isFinite(chance) || chance <= 0) return false;

  const qty = Math.floor(item.quantity ?? 0);
  if (qty <= 0) return false;

  const expired = sampleBinomial(state, qty, chance);
  if (expired <= 0) return false;

  const targetKind = effect.targetKind;
  if (expired >= qty) {
    Inventory.removeItem(inv, item.id);
    if (targetKind) {
      addStackedUnits(state, inv, targetKind, qty);
    }
  } else {
    item.quantity = qty - expired;
    if (targetKind) {
      addStackedUnits(state, inv, targetKind, expired);
    }
  }

  bumpInvVersion(inv);
  return true;
}

export function handleTickItemSeasonExpiry(state, effect, context) {
  if (!context || context.kind !== "item") return false;
  const { inv, item } = context;
  if (!inv || !item) return false;

  const targetKind = effect.targetKind;
  if (targetKind && !itemDefs[targetKind]) return false;

  if (item.seasonsToExpire == null) return false;
  item.seasonsToExpire -= 1;

  if (item.seasonsToExpire > 0) {
    bumpInvVersion(inv);
    return true;
  }

  if (targetKind) {
    const targetDef = itemDefs[targetKind];

    Inventory.clearItemFromGrid(inv, item);

    item.kind = targetKind;
    item.width = targetDef.defaultWidth ?? 1;
    item.height = targetDef.defaultHeight ?? 1;
    item.seasonsToExpire = null;

    Inventory.occupyCellsForItem(inv, item);
    bumpInvVersion(inv);
    return true;
  }

  Inventory.removeItem(inv, item.id);
  bumpInvVersion(inv);
  return true;
}

function sampleBinomial(state, trials, chance) {
  if (!Number.isFinite(trials) || trials <= 0) return 0;
  if (!Number.isFinite(chance) || chance <= 0) return 0;
  if (chance >= 1) return Math.floor(trials);
  if (typeof state?.rngNextFloat !== "function") return 0;

  let hits = 0;
  const count = Math.floor(trials);
  for (let i = 0; i < count; i++) {
    if (state.rngNextFloat() < chance) hits++;
  }
  return hits;
}

function addStackedUnits(state, inv, kind, amount) {
  if (!inv || !Number.isFinite(amount) || amount <= 0) return 0;
  const def = itemDefs[kind] || null;
  const maxStack = getItemMaxStack({ kind, seasonsToExpire: null });
  const dummy = { kind, seasonsToExpire: null };
  let remaining = Math.floor(amount);

  for (const stack of inv.items) {
    if (!canStackItems(stack, dummy)) continue;
    const current = Math.floor(stack.quantity ?? 0);
    const space = Math.max(0, maxStack - current);
    if (space <= 0) continue;
    const add = Math.min(space, remaining);
    stack.quantity = current + add;
    remaining -= add;
    if (remaining <= 0) break;
  }

  while (remaining > 0) {
    const qty = Math.min(remaining, maxStack);
    const newItem = Inventory.addNewItem(state, inv, {
      kind,
      quantity: qty,
      width: def?.defaultWidth ?? 1,
      height: def?.defaultHeight ?? 1,
    });
    if (!newItem) break;
    remaining -= qty;
  }

  return amount - remaining;
}
