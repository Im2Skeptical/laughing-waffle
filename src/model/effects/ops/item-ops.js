import { itemDefs } from "../../../defs/gamepieces/item-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
  initializeItemFromDef,
  mergeItemSystemStateForStacking,
} from "../../inventory-model.js";
import { bumpInvVersion } from "../core/inventory-version.js";

function applyKindToItem(state, inv, item, targetKind) {
  const targetDef = itemDefs[targetKind];
  if (!targetDef) return false;

  Inventory.clearItemFromGrid(inv, item);

  item.kind = targetKind;

  // Keep these normalized to null so stacking behavior is not fragmented by lifespan metadata.
  // (No systems in this refactor should ever set them.)
  item.seasonsToExpire = null;
  item.expiryTurn = null;

  // Reset tag/system state and reinitialize from the target def.
  item.tags = [];
  item.systemTiers = {};
  item.systemState = {};
  initializeItemFromDef(state, item, { reset: true });

  Inventory.occupyCellsForItem(inv, item);
  bumpInvVersion(inv);
  return true;
}

export function handleTransformItem(state, effect, context) {
  if (!context || context.kind !== "item") return false;
  const { inv, item } = context;
  if (!inv || !item) return false;

  const targetKind = effect.targetKind;
  if (!targetKind || targetKind === item.kind) return false;

  return applyKindToItem(state, inv, item, targetKind);
}

export function handleRemoveItem(state, effect, context) {
  if (!context || context.kind !== "item") return false;
  const { inv, item } = context;
  if (!inv || !item) return false;
  Inventory.removeItem(inv, item.id);
  bumpInvVersion(inv);
  return true;
}

// Generic: expires N units (binomial) and optionally transforms the expired units into targetKind.
export function handleExpireItemChance(state, effect, context) {
  if (!context || context.kind !== "item") return false;
  const { inv, item } = context;
  if (!inv || !item) return false;

  const itemDef = itemDefs[item.kind] || null;
  let chance = effect.chance;
  if (!Number.isFinite(chance) && effect.chanceFromDefKey && itemDef) {
    chance = itemDef[effect.chanceFromDefKey];
  }

  const tierSystemId =
    typeof effect.tierSystemId === "string" ? effect.tierSystemId : null;
  if (tierSystemId) {
    const tier =
      item.systemTiers?.[tierSystemId] ??
      item.tier ??
      itemDef?.defaultTier ??
      "bronze";
    const multiplierMap =
      effect.tierMultiplierByTier &&
      typeof effect.tierMultiplierByTier === "object"
        ? effect.tierMultiplierByTier
        : effect.multiplierByTier && typeof effect.multiplierByTier === "object"
          ? effect.multiplierByTier
          : null;
    if (multiplierMap && Number.isFinite(multiplierMap[tier])) {
      chance = (Number.isFinite(chance) ? chance : 0) * multiplierMap[tier];
    }
  }

  if (!Number.isFinite(chance) || chance <= 0) return false;

  const qty = Math.floor(item.quantity ?? 0);
  if (qty <= 0) return false;

  // This produces the same distribution as rolling once per unit.
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

  const dummy = {
    kind,
    seasonsToExpire: null,
    tier: null,
    tags: [],
    systemTiers: {},
    systemState: {},
  };
  initializeItemFromDef(state, dummy, { reset: true });

  let remaining = Math.floor(amount);

  for (const stack of inv.items) {
    if (!canStackItems(stack, dummy)) continue;
    const current = Math.floor(stack.quantity ?? 0);
    const space = Math.max(0, maxStack - current);
    if (space <= 0) continue;
    const add = Math.min(space, remaining);
    stack.quantity = current + add;
    mergeItemSystemStateForStacking(stack, dummy, current, add);
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
