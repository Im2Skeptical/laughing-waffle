// effects.js — EffectOp interpreter + seasonEnd + item expiry + inventory ops

import { itemDefs } from "../defs/gamepieces/gamepieces-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../defs/gamesystems/env-systems-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
} from "./inventory-model.js";

const SYSTEM_TIER_LADDER = ["bronze", "silver", "gold", "diamond"];
const TIER_ASC = ["bronze", "silver", "gold", "diamond"];
const TIER_DESC = ["diamond", "gold", "silver", "bronze"];

export function normalizeEffectSpec(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (raw.op) return raw;
  if (raw.kind) {
    const { kind, ...rest } = raw;
    return { op: kind, ...rest };
  }
  return null;
}

function bumpInvVersion(inv) {
  inv.version = (inv.version ?? 0) + 1;
}

function getExpiryTargetKind(def) {
  if (!def) return null;
  if (def.expiryToKind) return def.expiryToKind;
  const seasonExpiry = normalizeEffectSpec(def.seasonExpiry);
  if (seasonExpiry?.op === "TransformTo") return seasonExpiry.targetKind ?? null;
  return null;
}

function cloneSerializable(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function ensureTileSystemState(tile) {
  if (!tile.systemState || typeof tile.systemState !== "object") {
    tile.systemState = {};
  }
  return tile.systemState;
}

function ensureSystemState(tile, systemId) {
  const systemState = ensureTileSystemState(tile);
  if (!systemState[systemId] || typeof systemState[systemId] !== "object") {
    const defaults = envSystemDefs[systemId]?.stateDefaults ?? {};
    systemState[systemId] = cloneSerializable(defaults);
  }
  return systemState[systemId];
}

function getTierValueForSystem(tile, systemId) {
  const tier =
    tile.systemTiers && typeof tile.systemTiers === "object"
      ? tile.systemTiers[systemId]
      : null;
  if (tier && TIER_ASC.includes(tier)) return tier;
  const def = envSystemDefs[systemId];
  if (def?.defaultTier && TIER_ASC.includes(def.defaultTier)) {
    return def.defaultTier;
  }
  return "bronze";
}

function getDefRegistry(name) {
  if (!name || typeof name !== "string") return null;
  switch (name) {
    case "crops":
    case "cropDefs":
      return cropDefs;
    case "items":
    case "itemDefs":
      return itemDefs;
    case "envSystems":
    case "envSystemDefs":
      return envSystemDefs;
    default:
      return null;
  }
}

function resolveEffectDef(effect, tile, context) {
  const registryName = effect.defRegistry || effect.registry || null;
  const registry = getDefRegistry(registryName);
  if (!registry) return { registry: null, defId: null, def: null };

  let defId = effect.defId ?? null;
  if (defId == null && effect.defIdFromVar && context?.vars) {
    defId = context.vars[effect.defIdFromVar];
  }
  if (defId == null && effect.defIdFromSystemKey) {
    const systemId = effect.system || effect.systemId || null;
    const systemState = systemId ? tile?.systemState?.[systemId] : null;
    defId = systemState?.[effect.defIdFromSystemKey];
  }

  const defKey = defId != null ? String(defId) : null;
  const def = defKey ? registry[defKey] : null;
  return { registry, defId: defKey, def };
}

function resolveAmount(effect, systemState, def, context) {
  let amount = null;
  if (Number.isFinite(effect.amount)) amount = effect.amount;
  if (amount == null && Number.isFinite(effect.delta)) amount = effect.delta;
  if (amount == null && effect.amountVar && context?.vars) {
    amount = context.vars[effect.amountVar];
  }
  if (amount == null && effect.amountFromKey && systemState) {
    amount = systemState[effect.amountFromKey];
  }
  if (amount == null && effect.amountFromDefKey && def) {
    amount = def[effect.amountFromDefKey];
  }

  if (!Number.isFinite(amount)) return null;
  const scale =
    Number.isFinite(effect.amountScale) ? effect.amountScale : 1;
  return amount * scale;
}

function getCharsOnCol(state, col) {
  const out = [];
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  for (const ch of chars) {
    const envCol = Number.isFinite(ch?.envCol) ? Math.floor(ch.envCol) : null;
    if (envCol === col) out.push(ch);
  }
  out.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  return out;
}

function resolveOwnerTargets(state, targetSpec, context) {
  if (!targetSpec || typeof targetSpec !== "object") return [];

  if (targetSpec.kind === "tileOccupants") {
    const col =
      Number.isFinite(targetSpec.envCol)
        ? Math.floor(targetSpec.envCol)
        : Number.isFinite(context?.envCol)
          ? Math.floor(context.envCol)
          : Number.isFinite(context?.source?.col)
            ? Math.floor(context.source.col)
            : null;
    if (col == null) return [];
    return getCharsOnCol(state, col);
  }

  if (Array.isArray(targetSpec.ownerIds)) {
    return targetSpec.ownerIds.filter((id) => id != null);
  }

  if (targetSpec.ownerId != null) return [targetSpec.ownerId];

  return [];
}

function getTierRank(tier, order) {
  const idx = order.indexOf(tier);
  return idx >= 0 ? idx : order.length;
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

function rollQualityTier(state, table) {
  const entries = Array.isArray(table) ? table : [];
  if (!entries.length || typeof state?.rngNextFloat !== "function") {
    return "bronze";
  }

  let total = 0;
  for (const entry of entries) {
    total += Number.isFinite(entry?.weight) ? Math.max(0, entry.weight) : 0;
  }
  if (total <= 0) return "bronze";

  const roll = state.rngNextFloat() * total;
  let acc = 0;
  for (const entry of entries) {
    const weight = Number.isFinite(entry?.weight) ? Math.max(0, entry.weight) : 0;
    acc += weight;
    if (roll < acc) return entry?.tier ?? "bronze";
  }
  return entries[entries.length - 1]?.tier ?? "bronze";
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

function setTagDisabled(target, tagId, disabled) {
  if (!target || !tagId) return false;
  const entry =
    target.tagStates && typeof target.tagStates === "object"
      ? target.tagStates[tagId]
      : null;
  const wasDisabled = entry?.disabled === true;
  if (disabled) {
    if (wasDisabled) return false;
    if (!target.tagStates || typeof target.tagStates !== "object") {
      target.tagStates = {};
    }
    if (entry && typeof entry === "object") {
      entry.disabled = true;
    } else {
      target.tagStates[tagId] = { disabled: true };
    }
    return true;
  }

  if (!entry) return false;
  if (entry && typeof entry === "object") {
    if (entry.disabled) delete entry.disabled;
    if (Object.keys(entry).length === 0) {
      delete target.tagStates[tagId];
    }
  } else {
    delete target.tagStates[tagId];
  }
  if (
    target.tagStates &&
    typeof target.tagStates === "object" &&
    Object.keys(target.tagStates).length === 0
  ) {
    delete target.tagStates;
  }
  return wasDisabled;
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

function resolveBoardTargets(state, targetSpec, context) {
  if (!targetSpec || typeof targetSpec !== "object") return [];

  const getOccLayer = (layer) => {
    if (layer === "hub") return state.hub?.occ;
    return state.board?.occ?.[layer];
  };

  if (targetSpec.all === true) {
    const layer = targetSpec.layer;
    if (!layer) return [];
    if (layer === "hub") {
      const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : null;
      if (anchors) return anchors.filter(Boolean);
      const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
      return slots.map((slot) => slot?.structure).filter(Boolean);
    }
    const anchors = state.board?.layers?.[layer]?.anchors;
    if (!Array.isArray(anchors)) return [];
    return anchors.filter(Boolean);
  }

  if (targetSpec.at && typeof targetSpec.at === "object") {
    const layer = targetSpec.at.layer;
    const col = targetSpec.at.col;
    if (!layer || !Number.isFinite(col)) return [];
    const occ = getOccLayer(layer);
    if (!Array.isArray(occ)) return [];
    const idx = Math.floor(col);
    const target = occ[idx];
    return target ? [target] : [];
  }

  if (targetSpec.ref === "self") {
    const layer = targetSpec.layer;
    const source = context?.source;
    if (!layer || !source) return [];
    const occ = getOccLayer(layer);
    if (!Array.isArray(occ)) return [];

    const startCol = Number.isFinite(source.col) ? Math.floor(source.col) : 0;
    const span =
      Number.isFinite(source.span) && source.span > 0
        ? Math.floor(source.span)
        : 1;

    const targets = [];
    const seen = new Set();
    for (let offset = 0; offset < span; offset++) {
      const col = startCol + offset;
      if (col < 0 || col >= occ.length) continue;
      const target = occ[col];
      if (!target) continue;
      const key = target.instanceId ?? target;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
    return targets;
  }

  return [];
}

function getSystemTierLadder(systemDef) {
  if (!systemDef?.tierMap || typeof systemDef.tierMap !== "object") return [];
  return SYSTEM_TIER_LADDER.filter(
    (tier) => systemDef.tierMap[tier] != null
  );
}

export function runEffect(state, rawEffect, context) {
  if (!rawEffect) return false;

  if (Array.isArray(rawEffect)) {
    let changed = false;
    for (const eff of rawEffect)
      changed = runEffect(state, eff, context) || changed;
    return changed;
  }

  const effect = normalizeEffectSpec(rawEffect);
  if (!effect) return false;

  switch (effect.op) {
    // ================= INVENTORY OPS =================

    case "moveItem": {
      if (!context || context.kind !== "inventoryMove") return false;
      const out = handleMoveItem(state, effect, context);
      context.out = out;
      return !!out?.ok;
    }

    case "stackItem": {
      if (!context || context.kind !== "inventoryStack") return false;
      const out = handleStackItem(state, effect, context);
      context.out = out;
      return !!out?.ok;
    }

    case "splitStack": {
      if (!context || context.kind !== "inventorySplit") return false;
      const out = handleSplitStack(state, effect, context);
      context.out = out;
      return !!out?.ok;
    }

    // --- Item season-expiry ops ---

    case "TransformTo": {
      if (context.kind !== "itemSeasonExpiry") return false;
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

    // ================= GAME OPS =================

    case "AddResource": {
      const key = effect.resource;
      const amt = effect.amount ?? 0;
      if (!key || typeof amt !== "number") return false;

      state.resources[key] = (state.resources[key] ?? 0) + amt;
      return true;
    }

    // ================= SYSTEM OPS =================

    case "AddToSystemState": {
      const systemId = effect.system;
      const key = effect.key;
      if (!systemId || typeof systemId !== "string") return false;
      if (!key || typeof key !== "string") return false;

      const targets = effect.target
        ? resolveBoardTargets(state, effect.target, context)
        : context?.source
          ? [context.source]
          : [];
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        const systemState = ensureSystemState(target, systemId);
        const { def } = resolveEffectDef(effect, target, context);
        const amount = resolveAmount(effect, systemState, def, context);
        if (!Number.isFinite(amount) || amount === 0) continue;
        const current = Number.isFinite(systemState[key]) ? systemState[key] : 0;
        const next = current + amount;
        if (next !== current) {
          systemState[key] = next;
          changed = true;
        }
      }

      return changed;
    }

    case "ClampSystemState": {
      const systemId = effect.system;
      const key = effect.key;
      if (!systemId || typeof systemId !== "string") return false;
      if (!key || typeof key !== "string") return false;

      const targets = effect.target
        ? resolveBoardTargets(state, effect.target, context)
        : context?.source
          ? [context.source]
          : [];
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        const systemState = ensureSystemState(target, systemId);
        const value = Number.isFinite(systemState[key]) ? systemState[key] : 0;
        const minRaw = Number.isFinite(effect.min)
          ? effect.min
          : effect.minKey
            ? systemState[effect.minKey]
            : null;
        const maxRaw = Number.isFinite(effect.max)
          ? effect.max
          : effect.maxKey
            ? systemState[effect.maxKey]
            : null;
        const min = Number.isFinite(minRaw) ? minRaw : -Infinity;
        const max = Number.isFinite(maxRaw) ? maxRaw : Infinity;
        const next = clamp(value, min, max);
        if (next !== value) {
          systemState[key] = next;
          changed = true;
        }
      }

      return changed;
    }

    case "AccumulateRatio": {
      const systemId = effect.system;
      const numeratorKey = effect.numeratorKey;
      const denominatorKey = effect.denominatorKey;
      const targetKey = effect.targetKey || "sumRatio";
      if (!systemId || typeof systemId !== "string") return false;
      if (!numeratorKey || typeof numeratorKey !== "string") return false;
      if (!denominatorKey || typeof denominatorKey !== "string") return false;

      const targets = effect.target
        ? resolveBoardTargets(state, effect.target, context)
        : context?.source
          ? [context.source]
          : [];
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        const systemState = ensureSystemState(target, systemId);
        const numerator = Number.isFinite(systemState[numeratorKey])
          ? systemState[numeratorKey]
          : 0;
        const denominator = Number.isFinite(systemState[denominatorKey])
          ? systemState[denominatorKey]
          : 0;
        let ratio = denominator > 0 ? numerator / denominator : 0;
        if (Number.isFinite(effect.min)) ratio = Math.max(effect.min, ratio);
        if (Number.isFinite(effect.max)) ratio = Math.min(effect.max, ratio);
        const current = Number.isFinite(systemState[targetKey])
          ? systemState[targetKey]
          : 0;
        systemState[targetKey] = current + ratio;
        changed = true;
      }

      return changed;
    }

    case "ResetSystemState": {
      const systemId = effect.system;
      if (!systemId || typeof systemId !== "string") return false;

      const targets = effect.target
        ? resolveBoardTargets(state, effect.target, context)
        : context?.source
          ? [context.source]
          : [];
      if (!targets.length) return false;

      const defaults = envSystemDefs[systemId]?.stateDefaults ?? {};
      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        if (!target.systemState || typeof target.systemState !== "object") {
          target.systemState = {};
        }
        target.systemState[systemId] = cloneSerializable(defaults);
        changed = true;
      }

      return changed;
    }

    case "AdjustSystemState": {
      const systemId = effect.system;
      const key = effect.key;
      if (!systemId || typeof systemId !== "string") return false;
      if (!key || typeof key !== "string") return false;

      const targets = effect.target
        ? resolveBoardTargets(state, effect.target, context)
        : context?.source
          ? [context.source]
          : [];
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        const systemState = ensureSystemState(target, systemId);
        const { def } = resolveEffectDef(effect, target, context);
        const deltaRaw = resolveAmount(effect, systemState, def, context);
        const delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;
        let percent = null;
        if (Number.isFinite(effect.percent)) percent = effect.percent;
        if (percent == null && effect.percentFromKey) {
          percent = systemState[effect.percentFromKey];
        }
        if (percent == null && effect.percentFromDefKey && def) {
          percent = def[effect.percentFromDefKey];
        }
        if (percent == null && effect.percentVar && context?.vars) {
          percent = context.vars[effect.percentVar];
        }
        if (!Number.isFinite(percent)) percent = 0;

        const current = Number.isFinite(systemState[key]) ? systemState[key] : 0;
        const nextRaw = current + delta + current * percent;
        const minRaw = Number.isFinite(effect.min)
          ? effect.min
          : effect.minKey
            ? systemState[effect.minKey]
            : null;
        const maxRaw = Number.isFinite(effect.max)
          ? effect.max
          : effect.maxKey
            ? systemState[effect.maxKey]
            : null;
        const min = Number.isFinite(minRaw) ? minRaw : -Infinity;
        const max = Number.isFinite(maxRaw) ? maxRaw : Infinity;
        const next = clamp(nextRaw, min, max);

        if (next !== current) {
          systemState[key] = next;
          changed = true;
        }
      }

      return changed;
    }

    case "ConsumeItem": {
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

    case "TransferUnits": {
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

    case "SpawnItem": {
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
          const added = addTieredUnits(
            state,
            ownerId,
            itemKind,
            tier,
            remaining
          );
          if (added > 0) {
            remaining -= added;
            changed = true;
          }
        }
      }

      return changed;
    }

    case "CreateProcess": {
      const systemId = effect.system;
      if (!systemId || typeof systemId !== "string") return false;

      const targets = effect.target
        ? resolveBoardTargets(state, effect.target, context)
        : context?.source
          ? [context.source]
          : [];
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        const systemState = ensureSystemState(target, systemId);
        const queueKey = effect.queueKey || "processes";
        if (!Array.isArray(systemState[queueKey])) {
          systemState[queueKey] = [];
        }

        const { defId, def } = resolveEffectDef(effect, target, context);
        if (!defId || !def) continue;

        const amountRaw = resolveAmount(effect, systemState, def, context);
        const inputAmount = Math.max(0, Math.floor(amountRaw ?? 0));
        if (inputAmount <= 0) continue;

        const durationRaw = Number.isFinite(effect.durationSec)
          ? effect.durationSec
          : effect.durationFromDefKey && def
            ? def[effect.durationFromDefKey]
            : null;
        const durationSec = Number.isFinite(durationRaw)
          ? Math.max(1, Math.floor(durationRaw))
          : null;
        if (!durationSec) continue;

        const nowSec = Number.isFinite(context?.tSec)
          ? Math.floor(context.tSec)
          : Math.floor(state.tSec ?? 0);

        const process = {
          id: `proc_${target.instanceId}_${nowSec}_${systemState[queueKey].length}`,
          type: effect.processType || effect.type || "process",
          defRegistry: effect.defRegistry || effect.registry || null,
          defId,
          startSec: nowSec,
          durationSec,
          inputAmount,
        };

        if (effect.captureSystem && effect.captureKey) {
          const captureState = ensureSystemState(target, effect.captureSystem);
          const captureValue = captureState[effect.captureKey];
          const outKey = effect.captureAs || effect.captureKey;
          if (outKey) {
            process[outKey] = Number.isFinite(captureValue)
              ? captureValue
              : captureValue ?? 0;
          }
        }

        systemState[queueKey].push(process);
        changed = true;
      }

      return changed;
    }

    case "FinalizeProcess": {
      const systemId = effect.system;
      if (!systemId || typeof systemId !== "string") return false;

      const targets = effect.target
        ? resolveBoardTargets(state, effect.target, context)
        : context?.source
          ? [context.source]
          : [];
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        const systemState = ensureSystemState(target, systemId);
        const queueKey = effect.queueKey || "processes";
        const existingQueue = systemState[queueKey];
        const processes = Array.isArray(existingQueue) ? existingQueue : [];
        if (!Array.isArray(existingQueue)) {
          systemState[queueKey] = processes;
          changed = true;
        }
        if (processes.length === 0) continue;

        const poolKey = effect.poolKey || "maturedPool";
        if (!systemState[poolKey] || typeof systemState[poolKey] !== "object") {
          systemState[poolKey] = {
            bronze: 0,
            silver: 0,
            gold: 0,
            diamond: 0,
          };
        }
        const pool = systemState[poolKey];

        const nowSec = Number.isFinite(context?.tSec)
          ? Math.floor(context.tSec)
          : Math.floor(state.tSec ?? 0);

        const nextQueue = [];
        for (const process of processes) {
          if (!process) continue;
          if (
            effect.processType &&
            process.type &&
            process.type !== effect.processType
          ) {
            nextQueue.push(process);
            continue;
          }

          const startSec = Math.floor(process.startSec ?? 0);
          const durationSec = Math.floor(process.durationSec ?? 0);
          if (durationSec <= 0 || nowSec < startSec + durationSec) {
            nextQueue.push(process);
            continue;
          }

          const { def } = resolveEffectDef(
            { defRegistry: process.defRegistry, defId: process.defId },
            target,
            context
          );
          if (!def) {
            changed = true;
            continue;
          }

          const hydrationTier = getTierValueForSystem(target, "hydration");
          const fertilityTier = getTierValueForSystem(target, "fertility");
          const hydrationState = target.systemState?.hydration || {};
          const sumRatio = Number.isFinite(hydrationState.sumRatio)
            ? hydrationState.sumRatio
            : 0;
          const sumAtStart = Number.isFinite(process.sumAtStart)
            ? process.sumAtStart
            : 0;
          const rAvg = clamp((sumRatio - sumAtStart) / durationSec, 0, 1);

          const curveSource = envSystemDefs[systemId];
          const curveByTier = curveSource?.hydrationCurveByTier || null;
          const curve =
            curveByTier?.[hydrationTier] ||
            curveByTier?.silver ||
            { A: 1, P: 1 };
          const factor =
            (Number.isFinite(curve?.A) ? curve.A : 1) *
            Math.pow(rAvg, Number.isFinite(curve?.P) ? curve.P : 1);

          const inputAmount = Math.max(0, Math.floor(process.inputAmount ?? 0));
          const baseYield = Number.isFinite(def.baseYieldMultiplier)
            ? def.baseYieldMultiplier
            : 1;
          const maturedUnits = Math.floor(inputAmount * baseYield * factor);
          if (maturedUnits > 0) {
            const table =
              def?.qualityTablesByFertilityTier?.[fertilityTier] ??
              def?.qualityTablesByFertilityTier?.silver ??
              [];
            for (let i = 0; i < maturedUnits; i++) {
              const tier = rollQualityTier(state, table);
              pool[tier] = (pool[tier] ?? 0) + 1;
            }
            changed = true;
          } else {
            changed = true;
          }
        }

        if (nextQueue.length !== processes.length) {
          systemState[queueKey] = nextQueue;
          changed = true;
        }
      }

      return changed;
    }

    // ================= BOARD TARGET OPS =================

    case "AddTag": {
      const tagId = effect.tag;
      if (!tagId || typeof tagId !== "string") return false;

      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        if (!Array.isArray(target.tags)) target.tags = [];
        if (target.tags.includes(tagId)) continue;

        target.tags.push(tagId);
        changed = true;

        const tagDef = envTagDefs[tagId];
        const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
        if (systems.length === 0) continue;

        if (!target.systemTiers || typeof target.systemTiers !== "object") {
          target.systemTiers = {};
        }
        if (!target.systemState || typeof target.systemState !== "object") {
          target.systemState = {};
        }

        for (const systemId of systems) {
          if (target.systemTiers[systemId] != null) continue;
          const sysDef = envSystemDefs[systemId];
          if (!sysDef) continue;
          if (sysDef.defaultTier != null) {
            target.systemTiers[systemId] = sysDef.defaultTier;
          }
          if (
            sysDef.stateDefaults &&
            !target.systemState[systemId]
          ) {
            target.systemState[systemId] = cloneSerializable(
              sysDef.stateDefaults
            );
          }
        }
      }

      return changed;
    }

    case "DisableTag":
    case "EnableTag": {
      const tagId = effect.tag;
      if (!tagId || typeof tagId !== "string") return false;

      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      const disable = effect.op === "DisableTag";
      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        if (!Array.isArray(target.tags) || !target.tags.includes(tagId)) {
          continue;
        }
        if (setTagDisabled(target, tagId, disable)) changed = true;
      }

      return changed;
    }

    case "RemoveTag": {
      const tagId = effect.tag;
      if (!tagId || typeof tagId !== "string") return false;

      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        if (!Array.isArray(target.tags) || target.tags.length === 0) continue;

        const nextTags = target.tags.filter((t) => t !== tagId);
        if (nextTags.length === target.tags.length) continue;
        target.tags = nextTags;
        changed = true;
      }

      return changed;
    }

    case "SetSystemTier": {
      const systemId = effect.system;
      if (!systemId || typeof systemId !== "string") return false;

      const systemDef = envSystemDefs[systemId];
      if (!systemDef) return false;

      const tier =
        typeof effect.tier === "string"
          ? effect.tier
          : typeof effect.value === "string"
            ? effect.value
            : null;
      if (!tier || systemDef.tierMap?.[tier] == null) return false;

      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        if (!target.systemTiers || typeof target.systemTiers !== "object") {
          target.systemTiers = {};
        }
        if (target.systemTiers[systemId] === tier) continue;
        target.systemTiers[systemId] = tier;
        changed = true;
      }

      return changed;
    }

    case "SetSystemState": {
      const systemId = effect.system;
      if (!systemId || typeof systemId !== "string") return false;

      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      let changed = false;
      const rawValue = effect.value ?? effect.state ?? null;

      for (const target of targets) {
        if (!target) continue;
        if (!target.systemState || typeof target.systemState !== "object") {
          target.systemState = {};
        }
        target.systemState[systemId] = cloneSerializable(rawValue);
        changed = true;
      }

      return changed;
    }

    case "ClearSystemState": {
      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      let changed = false;
      const systems = Array.isArray(effect.systems) ? effect.systems : null;

      for (const target of targets) {
        if (!target) continue;
        if (!target.systemState || typeof target.systemState !== "object") {
          continue;
        }

        if (!systems || systems.length === 0) {
          if (Object.keys(target.systemState).length > 0) {
            target.systemState = {};
            changed = true;
          }
          continue;
        }

        for (const sys of systems) {
          if (Object.prototype.hasOwnProperty.call(target.systemState, sys)) {
            delete target.systemState[sys];
            changed = true;
          }
        }
      }

      return changed;
    }

    case "UpgradeSystemTier": {
      const systemId = effect.system;
      if (!systemId || typeof systemId !== "string") return false;

      const systemDef = envSystemDefs[systemId];
      if (!systemDef) return false;

      const tiers = getSystemTierLadder(systemDef);
      if (tiers.length === 0) return false;

      if (!Number.isFinite(effect.delta)) return false;
      const delta = Math.trunc(effect.delta);

      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      let changed = false;
      const defaultTier = tiers.includes(systemDef.defaultTier)
        ? systemDef.defaultTier
        : tiers[0];
      for (const target of targets) {
        if (!target) continue;
        if (!target.systemTiers || typeof target.systemTiers !== "object") {
          target.systemTiers = {};
        }

        const hasCurrent = typeof target.systemTiers[systemId] === "string";
        let current = hasCurrent ? target.systemTiers[systemId] : defaultTier;
        if (!hasCurrent) {
          target.systemTiers[systemId] = current;
          changed = true;
        }

        let idx = tiers.indexOf(current);
        if (idx < 0) idx = tiers.indexOf(defaultTier);
        if (idx < 0) idx = 0;

        const nextIdx = Math.max(0, Math.min(tiers.length - 1, idx + delta));
        const nextTier = tiers[nextIdx];

        if (current === nextTier) continue;
        target.systemTiers[systemId] = nextTier;
        changed = true;
      }

      return changed;
    }

    case "RemoveEvent": {
      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      const anchors = state.board?.layers?.event?.anchors;
      if (!Array.isArray(anchors) || anchors.length === 0) return false;

      const targetIds = new Set();
      const targetRefs = new Set();
      for (const target of targets) {
        if (!target) continue;
        if (target.instanceId != null) targetIds.add(target.instanceId);
        else targetRefs.add(target);
      }

      const next = anchors.filter((anchor) => {
        if (!anchor) return true;
        if (anchor.instanceId != null && targetIds.has(anchor.instanceId)) {
  return false;
}
        if (targetRefs.has(anchor)) return false;
        return true;
      });

      const removed = next.length !== anchors.length;
      if (removed) {
        anchors.length = 0;
        anchors.push(...next);
      }

      if (removed) state._boardDirty = true;
      return removed;
    }

    case "TransformEvent": {
      const defId = effect.defId;
      if (!defId || typeof defId !== "string") return false;

      const def = envEventDefs[defId];
      if (!def) return false;

      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      const nowSec = Number.isFinite(context?.tSec)
        ? Math.floor(context.tSec)
        : Math.floor(state.tSec ?? 0);

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        target.defId = defId;
        target.createdSec = nowSec;
        if (def.durationSec != null) {
          target.expiresSec = nowSec + def.durationSec;
        } else {
          delete target.expiresSec;
        }
        delete target.entered;
        changed = true;
      }

      return changed;
    }

    // ================= GENERIC PROP OPS =================

    case "SetProp": {
      const prop = effect.prop;
      const value = effect.value;
      if (!prop || typeof value !== "number") return false;

      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        if (!target.props || typeof target.props !== "object") {
          target.props = {};
        }
        target.props[prop] = value;

        if (typeof effect.min === "number" && target.props[prop] < effect.min) {
          target.props[prop] = effect.min;
        }
        if (typeof effect.max === "number" && target.props[prop] > effect.max) {
          target.props[prop] = effect.max;
        }
        changed = true;
      }

      return changed;
    }

    case "AddProp": {
      const prop = effect.prop;
      const amt = effect.amount ?? 0;
      if (!prop || typeof amt !== "number") return false;

      const targets = resolveBoardTargets(state, effect.target, context);
      if (!targets.length) return false;

      let changed = false;
      for (const target of targets) {
        if (!target) continue;
        if (!target.props || typeof target.props !== "object") {
          target.props = {};
        }

        target.props[prop] = (target.props[prop] ?? 0) + amt;

        if (typeof effect.min === "number" && target.props[prop] < effect.min) {
          target.props[prop] = effect.min;
        }
        if (typeof effect.max === "number" && target.props[prop] > effect.max) {
          target.props[prop] = effect.max;
        }
        changed = true;
      }

      return changed;
    }

    default:
      return false;
  }
}

// =============================================================================
// INVENTORY: stackItem handler (authoritative mutation)
// =============================================================================

function handleStackItem(state, effect, context) {
  const { ownerId, sourceItemId, targetItemId, amount } = effect;

  const inv = state.ownerInventories[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  Inventory.rebuildDerived(inv);

  const source =
    inv.itemsById[sourceItemId] ||
    inv.items.find((it) => it.id === sourceItemId);
  const target =
    inv.itemsById[targetItemId] ||
    inv.items.find((it) => it.id === targetItemId);

  if (!source || !target) return { ok: false, reason: "noItem" };
  if (source === target) return { ok: false, reason: "sameItem" };
  if (!canStackItems(target, source))
    return { ok: false, reason: "cannotStack" };

  const maxStack = getItemMaxStack(target);
  const space = maxStack - target.quantity;
  if (space <= 0) return { ok: false, reason: "targetFull" };

  const moveAmt =
    typeof amount === "number" && Number.isFinite(amount)
      ? Math.max(1, Math.floor(amount))
      : source.quantity;

  const amtToMove = Math.min(space, source.quantity, moveAmt);

  target.quantity += amtToMove;
  source.quantity -= amtToMove;

  if (source.quantity <= 0) {
    Inventory.removeItem(inv, source.id);
  }

  Inventory.rebuildDerived(inv);
  bumpInvVersion(inv);

  const events = context.events || (context.events = []);
  events.push({
    type: "onStack",
    ownerId,
    sourceItemId: source.id,
    targetItemId: target.id,
    amount: amtToMove,
  });

  return { ok: true, result: "stacked", amount: amtToMove, events };
}

// =============================================================================
// INVENTORY: splitStack handler (authoritative mutation)
// =============================================================================

function handleSplitStack(state, effect, context) {
  const { ownerId, itemId, amount } = effect;

  const inv = state.ownerInventories[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  Inventory.rebuildDerived(inv);

  const item =
    inv.itemsById[itemId] || inv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  const splitAmount = Math.floor(amount);
  if (splitAmount <= 0 || splitAmount >= item.quantity) {
    return { ok: false, reason: "badAmount" };
  }

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
  };

    let placed = false;
    if (Number.isFinite(effect.targetGX) && Number.isFinite(effect.targetGY)) {
      const gx = Math.floor(effect.targetGX);
      const gy = Math.floor(effect.targetGY);
      if (Inventory.canPlaceItemAt(inv, newItem, gx, gy)) {
        newItem.gridX = gx;
        newItem.gridY = gy;
        placed = true;
      } else {
        item.quantity += splitAmount;
        return { ok: false, reason: "blocked" };
      }
    } else {
      outer: for (let gy = 0; gy <= inv.rows - newItem.height; gy++) {
        for (let gx = 0; gx <= inv.cols - newItem.width; gx++) {
          if (Inventory.canPlaceItemAt(inv, newItem, gx, gy)) {
            newItem.gridX = gx;
            newItem.gridY = gy;
            placed = true;
            break outer;
          }
        }
      }
    }

  if (!placed) {
    item.quantity += splitAmount;
    return { ok: false, reason: "noSpace" };
  }

  inv.items.push(newItem);
  inv.itemsById[newItem.id] = newItem;
  Inventory.occupyCellsForItem(inv, newItem);

  Inventory.rebuildDerived(inv);
  bumpInvVersion(inv);

  const events = context.events || (context.events = []);
  events.push({
    type: "onSplit",
    ownerId,
    sourceItemId: item.id,
    newItemId: newItem.id,
    amount: splitAmount,
  });

  return { ok: true, newItemId: newItem.id, events };
}

// =============================================================================
// INVENTORY: moveItem handler (authoritative mutation)
// =============================================================================

function handleMoveItem(state, effect, context) {
  const { fromOwnerId, toOwnerId, itemId, targetGX, targetGY } = effect;

  const fromInv = state.ownerInventories[fromOwnerId];
  const toInv = state.ownerInventories[toOwnerId];
  if (!fromInv || !toInv) return { ok: false, reason: "noInventory" };

  Inventory.rebuildDerived(fromInv);
  Inventory.rebuildDerived(toInv);

  const item =
    fromInv.itemsById[itemId] || fromInv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  const events = context.events || (context.events = []);

  const idx =
    targetGX < 0 ||
    targetGY < 0 ||
    targetGX >= toInv.cols ||
    targetGY >= toInv.rows
      ? null
      : targetGY * toInv.cols + targetGX;

  let stackTarget = null;
  if (idx != null) {
    const targetId = toInv.grid[idx];
    if (targetId != null) {
      stackTarget =
        toInv.itemsById[targetId] ||
        toInv.items.find((it) => it.id === targetId);
      if (stackTarget === item) stackTarget = null;
    }
  }

  if (stackTarget && canStackItems(stackTarget, item)) {
    if (fromOwnerId !== toOwnerId) {
      return { ok: false, reason: "crossOwnerStackNotSupported" };
    }

    const ctx = { kind: "inventoryStack", state, events, out: null };
    const out = handleStackItem(
      state,
      {
        ownerId: toOwnerId,
        sourceItemId: item.id,
        targetItemId: stackTarget.id,
      },
      ctx
    );
    return out || { ok: false, reason: "stackFailed" };
  }

  if (fromOwnerId === toOwnerId) {
    Inventory.clearItemFromGrid(toInv, item);

    const canPlace = Inventory.canPlaceItemAt(toInv, item, targetGX, targetGY);
    if (!canPlace) {
      Inventory.occupyCellsForItem(toInv, item);
      return { ok: false, reason: "blocked" };
    }

    item.gridX = targetGX;
    item.gridY = targetGY;
    Inventory.occupyCellsForItem(toInv, item);

    Inventory.rebuildDerived(toInv);
    bumpInvVersion(toInv);

    events.push({
      type: "moveItem",
      fromOwnerId,
      toOwnerId,
      itemId,
      gx: targetGX,
      gy: targetGY,
    });

    return { ok: true, result: "moved", events };
  }

  const canPlace = Inventory.canPlaceItemAt(toInv, item, targetGX, targetGY);
  if (!canPlace) return { ok: false, reason: "blocked" };

  const originalGX = item.gridX;
  const originalGY = item.gridY;

  events.push({ type: "onLeaveContainer", ownerId: fromOwnerId, itemId });

  Inventory.removeItem(fromInv, item.id);
  Inventory.rebuildDerived(fromInv);

  const success = Inventory.attachExistingItem(toInv, item, targetGX, targetGY);
  if (!success) {
    Inventory.attachExistingItem(fromInv, item, originalGX, originalGY);
    Inventory.rebuildDerived(fromInv);
    Inventory.rebuildDerived(toInv);
    return { ok: false, reason: "attachFailed" };
  }

  Inventory.rebuildDerived(toInv);

  bumpInvVersion(fromInv);
  bumpInvVersion(toInv);

  events.push({ type: "onEnterContainer", ownerId: toOwnerId, itemId });

  events.push({
    type: "moveItem",
    fromOwnerId,
    toOwnerId,
    itemId,
    gx: targetGX,
    gy: targetGY,
  });

  return { ok: true, result: "moved", events };
}

// =============================================================================
// Existing expiry hooks
// =============================================================================

export function processSeasonChangeForItems(state) {
  for (const inv of Object.values(state.ownerInventories)) {
    const itemsSnapshot = [...inv.items];
    for (const item of itemsSnapshot) {
      if (item.seasonsToExpire == null) continue;
      item.seasonsToExpire -= 1;
      if (item.seasonsToExpire <= 0) handleItemSeasonExpiry(state, inv, item);
    }
  }
}

export function processSecondChangeForItems(state) {
  if (!state?.ownerInventories) return;

  for (const inv of Object.values(state.ownerInventories)) {
    if (!inv) continue;
    const itemsSnapshot = [...inv.items];
    let invChanged = false;

    for (const item of itemsSnapshot) {
      if (!item) continue;
      const def = itemDefs[item.kind];
      const chance = def?.expiryChancePerSec;
      if (!Number.isFinite(chance) || chance <= 0) continue;

      const qty = Math.floor(item.quantity ?? 0);
      if (qty <= 0) continue;

      const expired = sampleBinomial(state, qty, chance);
      if (expired <= 0) continue;

      const targetKind = getExpiryTargetKind(def);
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

      invChanged = true;
    }

    if (invChanged) bumpInvVersion(inv);
  }
}

function handleItemSeasonExpiry(state, inv, item) {
  const def = itemDefs[item.kind];
  if (!def || !def.seasonExpiry) return;

  runEffect(state, def.seasonExpiry, { kind: "itemSeasonExpiry", inv, item });
}

