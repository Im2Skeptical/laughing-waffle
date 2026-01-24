import { itemDefs } from "../../../defs/gamepieces/item-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
} from "../../inventory-model.js";
import { resolveAmount } from "../core/amount.js";
import { bumpInvVersion } from "../core/inventory-version.js";
import { resolveEffectDef } from "../core/registry.js";
import { ensureSystemState } from "../core/system-state.js";
import { TIER_ASC, TIER_DESC, getTierRank } from "../core/tiers.js";
import { resolveOwnerTargets } from "../core/targets-owner.js";

export function handleAddResource(state, effect) {
  const key = effect.resource;
  const amt = effect.amount ?? 0;
  if (!key || typeof amt !== "number") return false;

  state.resources[key] = (state.resources[key] ?? 0) + amt;
  return true;
}

export function handleConsumeItem(state, effect, context) {
  if (!context || context.kind !== "game") return false;
  const targets = resolveOwnerTargets(state, effect.target, context);
  if (!targets.length) {
    if (effect.outVar && context) {
      context.vars = context.vars || {};
      context.vars[effect.outVar] = 0;
    }
    return false;
  }

  const { defId, def } = resolveEffectDef(effect, context.source, context);
  const itemKind =
    effect.itemKind || effect.kind || defId || def?.id || def?.cropId || null;
  if (!itemKind) return false;

  const amountRaw = resolveAmount(effect, null, def, context);
  const perOwner = effect.perOwner === true;
  const order =
    effect.tierOrder === "desc"
      ? TIER_DESC
      : effect.tierOrder === "asc"
        ? TIER_ASC
        : TIER_ASC;

  let consumedTotal = 0;
  if (perOwner) {
    const perOwnerAmount = Math.max(0, Math.floor(amountRaw ?? 0));
    if (perOwnerAmount <= 0) {
      if (effect.outVar) {
        context.vars = context.vars || {};
        context.vars[effect.outVar] = 0;
      }
      return false;
    }
    for (const target of targets) {
      const ownerId = typeof target === "object" ? target.id : target;
      if (ownerId == null) continue;
      const used = consumeFromInventory(
        state,
        ownerId,
        itemKind,
        perOwnerAmount,
        order
      );
      consumedTotal += used;
    }
  } else {
    let remaining = Math.max(0, Math.floor(amountRaw ?? 0));
    if (remaining <= 0) {
      if (effect.outVar) {
        context.vars = context.vars || {};
        context.vars[effect.outVar] = 0;
      }
      return false;
    }
    for (const target of targets) {
      if (remaining <= 0) break;
      const ownerId = typeof target === "object" ? target.id : target;
      if (ownerId == null) continue;
      const used = consumeFromInventory(
        state,
        ownerId,
        itemKind,
        remaining,
        order
      );
      consumedTotal += used;
      remaining -= used;
    }
  }

  if (effect.outVar) {
    context.vars = context.vars || {};
    context.vars[effect.outVar] = consumedTotal;
  }
  return consumedTotal > 0;
}

export function handleTransferUnits(state, effect, context) {
  if (!context || context.kind !== "game") return false;
  const tile = context.source;
  const systemId = effect.system;
  if (!tile || !systemId || typeof systemId !== "string") return false;

  const targets = resolveOwnerTargets(state, effect.target, context);
  if (!targets.length) return false;

  const systemState = ensureSystemState(tile, systemId);
  const poolKey = effect.poolKey || "maturedPool";
  if (!systemState[poolKey] || typeof systemState[poolKey] !== "object") {
    systemState[poolKey] = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
  }
  const pool = systemState[poolKey];
  if (!maturedPoolHasAny(pool)) return false;

  const { defId, def } = resolveEffectDef(effect, tile, context);
  const itemKind =
    effect.itemKind || effect.kind || defId || def?.id || def?.cropId || null;
  if (!itemKind) return false;

  const amountRaw = resolveAmount(effect, systemState, def, context);
  const perOwner = effect.perOwner === true;
  const order =
    effect.tierOrder === "asc"
      ? TIER_ASC
      : effect.tierOrder === "desc"
        ? TIER_DESC
        : TIER_DESC;

  let changed = false;
  if (perOwner) {
    const perOwnerAmount = Math.max(0, Math.floor(amountRaw ?? 0));
    if (perOwnerAmount <= 0) return false;
    for (const target of targets) {
      let remaining = perOwnerAmount;
      const ownerId = typeof target === "object" ? target.id : target;
      if (ownerId == null) continue;
      for (const tier of order) {
        if (remaining <= 0) break;
        const available = Math.max(0, Math.floor(pool[tier] ?? 0));
        if (available <= 0) continue;
        const take = Math.min(available, remaining);
        const added = addTieredUnits(state, ownerId, itemKind, tier, take);
        if (added > 0) {
          pool[tier] = available - added;
          remaining -= added;
          changed = true;
        }
        if (added < take) break;
      }
    }
  } else {
    let remainingTotal = Math.max(0, Math.floor(amountRaw ?? 0));
    if (remainingTotal <= 0) return false;
    for (const target of targets) {
      if (remainingTotal <= 0) break;
      let remaining = remainingTotal;
      const ownerId = typeof target === "object" ? target.id : target;
      if (ownerId == null) continue;
      for (const tier of order) {
        if (remaining <= 0) break;
        const available = Math.max(0, Math.floor(pool[tier] ?? 0));
        if (available <= 0) continue;
        const take = Math.min(available, remaining);
        const added = addTieredUnits(state, ownerId, itemKind, tier, take);
        if (added > 0) {
          pool[tier] = available - added;
          remaining -= added;
          remainingTotal -= added;
          changed = true;
        }
        if (added < take) break;
      }
    }
  }

  return changed;
}

export function handleSpawnItem(state, effect, context) {
  if (!context || context.kind !== "game") return false;
  const targets = resolveOwnerTargets(state, effect.target, context);
  if (!targets.length) return false;

  const { defId, def } = resolveEffectDef(effect, context.source, context);
  const itemKind =
    effect.itemKind || effect.kind || defId || def?.id || def?.cropId || null;
  if (!itemKind) return false;

  const amountRaw = resolveAmount(effect, null, def, context);
  const perOwner = effect.perOwner === true;
  const tier = effect.tier || def?.defaultTier || "bronze";

  let changed = false;
  if (perOwner) {
    const perOwnerAmount = Math.max(0, Math.floor(amountRaw ?? 0));
    if (perOwnerAmount <= 0) return false;
    for (const target of targets) {
      const ownerId = typeof target === "object" ? target.id : target;
      if (ownerId == null) continue;
      const added = addTieredUnits(
        state,
        ownerId,
        itemKind,
        tier,
        perOwnerAmount
      );
      if (added > 0) changed = true;
    }
  } else {
    let remaining = Math.max(0, Math.floor(amountRaw ?? 0));
    if (remaining <= 0) return false;
    for (const target of targets) {
      if (remaining <= 0) break;
      const ownerId = typeof target === "object" ? target.id : target;
      if (ownerId == null) continue;
      const added = addTieredUnits(state, ownerId, itemKind, tier, remaining);
      if (added > 0) {
        remaining -= added;
        changed = true;
      }
    }
  }

  return changed;
}

function sortItemsForConsumption(items, order) {
  const tierOrder = Array.isArray(order) ? order : TIER_ASC;
  return items.sort((a, b) => {
    const tierA = a?.tier ?? "bronze";
    const tierB = b?.tier ?? "bronze";
    const rankA = getTierRank(tierA, tierOrder);
    const rankB = getTierRank(tierB, tierOrder);
    if (rankA !== rankB) return rankA - rankB;
    return (a?.id ?? 0) - (b?.id ?? 0);
  });
}

function consumeFromInventory(state, ownerId, kind, amount, tierOrder) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const inv = state?.ownerInventories?.[ownerId];
  if (!inv || !Array.isArray(inv.items)) return 0;

  const candidates = inv.items.filter(
    (it) => it && it.kind === kind && Math.floor(it.quantity ?? 0) > 0
  );
  if (!candidates.length) return 0;

  sortItemsForConsumption(candidates, tierOrder);

  let remaining = Math.floor(amount);
  let consumed = 0;

  for (const item of candidates) {
    if (remaining <= 0) break;
    const qty = Math.floor(item.quantity ?? 0);
    if (qty <= 0) continue;
    const take = Math.min(qty, remaining);
    item.quantity = qty - take;
    consumed += take;
    remaining -= take;
    if (item.quantity <= 0) {
      Inventory.removeItem(inv, item.id);
    }
  }

  if (consumed > 0) bumpInvVersion(inv);
  return consumed;
}

function addTieredUnits(state, ownerId, kind, tier, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const inv = state?.ownerInventories?.[ownerId];
  if (!inv || !Array.isArray(inv.items)) return 0;

  const def = itemDefs[kind] || null;
  const maxStack = getItemMaxStack({ kind, tier });
  const dummy = { kind, tier, seasonsToExpire: null };

  let remaining = Math.floor(amount);
  let added = 0;

  for (const stack of inv.items) {
    if (!canStackItems(stack, dummy)) continue;
    const current = Math.floor(stack.quantity ?? 0);
    const space = Math.max(0, maxStack - current);
    if (space <= 0) continue;
    const take = Math.min(space, remaining);
    stack.quantity = current + take;
    remaining -= take;
    added += take;
    if (remaining <= 0) break;
  }

  while (remaining > 0) {
    const qty = Math.min(remaining, maxStack);
    const newItem = Inventory.addNewItem(state, inv, {
      kind,
      quantity: qty,
      width: def?.defaultWidth ?? 1,
      height: def?.defaultHeight ?? 1,
      tier,
    });
    if (!newItem) break;
    remaining -= qty;
    added += qty;
  }

  if (added > 0) bumpInvVersion(inv);
  return added;
}

function maturedPoolHasAny(pool) {
  if (!pool || typeof pool !== "object") return false;
  return (
    (pool.bronze ?? 0) > 0 ||
    (pool.silver ?? 0) > 0 ||
    (pool.gold ?? 0) > 0 ||
    (pool.diamond ?? 0) > 0
  );
}
