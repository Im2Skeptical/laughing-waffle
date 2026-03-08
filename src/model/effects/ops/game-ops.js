import { itemDefs } from "../../../defs/gamepieces/item-defs.js";
import { forageDropTables } from "../../../defs/gamepieces/forage-droptables-defs.js";
import { fishingDropTables } from "../../../defs/gamepieces/fishing-droptables-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
  initializeItemFromDef,
  mergeItemSystemStateForStacking,
} from "../../inventory-model.js";
import { resolveAmount } from "../core/amount.js";
import { selectWeightedEntry } from "../core/drop-table.js";
import { bumpInvVersion } from "../core/inventory-version.js";
import { resolveEffectDef } from "../core/registry.js";
import { ensureSystemState } from "../core/system-state.js";
import { TIER_ASC, TIER_DESC, getTierRank } from "../core/tiers.js";
import { resolveOwnerTargets } from "../core/targets-owner.js";
import { resolveBoardTargets } from "../core/targets-board.js";
import { pushGameEvent } from "../../event-feed.js";
import { rememberDroppedItemKind } from "../../persistent-memory.js";
import { findEquippedPoolProviderEntry } from "../../item-def-rules.js";
import { ensureDiscoveryState, ensureLocationNamesState } from "../../state.js";

export function handleAddResource(state, effect) {
  const key = effect.resource;
  const amt = effect.amount ?? 0;
  if (!key || typeof amt !== "number") return false;

  state.resources[key] = (state.resources[key] ?? 0) + amt;
  return true;
}

export function handleExposeDiscovery(state, effect, context) {
  const discovery = ensureDiscoveryState(state);
  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    const col = Number.isFinite(target?.col) ? Math.floor(target.col) : null;
    const span =
      Number.isFinite(target?.span) && target.span > 0
        ? Math.floor(target.span)
        : 1;
    if (col == null) continue;
    for (let offset = 0; offset < span; offset++) {
      const envCol = col + offset;
      if (envCol < 0 || envCol >= discovery.envCols.length) continue;
      if (discovery.envCols[envCol]?.exposed === true) continue;
      discovery.envCols[envCol].exposed = true;
      changed = true;
    }
  }
  return changed;
}

export function handleRevealDiscovery(state, effect, context) {
  const discovery = ensureDiscoveryState(state);
  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    const col = Number.isFinite(target?.col) ? Math.floor(target.col) : null;
    const span =
      Number.isFinite(target?.span) && target.span > 0
        ? Math.floor(target.span)
        : 1;
    if (col == null) continue;
    for (let offset = 0; offset < span; offset++) {
      const envCol = col + offset;
      if (envCol < 0 || envCol >= discovery.envCols.length) continue;
      const entry = discovery.envCols[envCol];
      if (entry.exposed !== true || entry.revealed !== true) {
        entry.exposed = true;
        entry.revealed = true;
        changed = true;
      }
    }
  }
  return changed;
}

export function handleSetDiscoveryState(state, effect) {
  const discovery = ensureDiscoveryState(state);
  const key = typeof effect?.key === "string" ? effect.key : null;
  if (!key || !Object.prototype.hasOwnProperty.call(discovery, key)) return false;
  const nextValue = effect?.value;
  if (typeof discovery[key] !== "boolean" || typeof nextValue !== "boolean") {
    return false;
  }
  if (discovery[key] === nextValue) return false;
  discovery[key] = nextValue;
  return true;
}

export function handleSetLocationName(state, effect) {
  const area = effect?.area === "region" ? "region" : effect?.area === "hub" ? "hub" : null;
  const name = typeof effect?.name === "string" ? effect.name.trim() : "";
  if (!area || !name) return false;
  const locationNames = ensureLocationNamesState(state);
  if (locationNames[area] === name) return false;
  locationNames[area] = name;
  return true;
}

export function handleConsumeItem(state, effect, context) {
  if (!context || (context.kind !== "game" && context.kind !== "item")) {
    return false;
  }
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
    systemState[poolKey] = {};
  }
  const poolRoot = systemState[poolKey];

  const { defId, def } = resolveEffectDef(effect, tile, context);
  const itemKind =
    effect.itemKind || effect.kind || defId || def?.id || def?.cropId || null;
  if (!itemKind) return false;
  const pool = resolveMaturedPoolBucket(poolRoot, itemKind);
  if (!pool || !maturedPoolHasAny(pool)) return false;

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
  if (!context || (context.kind !== "game" && context.kind !== "item")) {
    return false;
  }
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

export function handleSpawnFromDropTable(state, effect, context) {
  if (!context || context.kind !== "game") return false;
  if (typeof state?.rngNextFloat !== "function") return false;

  const tableKey =
    typeof effect?.tableKey === "string" ? effect.tableKey : "forageDrops";
  const eventMeta = getDropRollEventMeta(tableKey);
  const source = context.source;
  const tags = Array.isArray(source?.tags) ? source.tags : [];
  const table = resolveDropTableForTile(source, tableKey);
  if (!table.length) return false;

  const entry = selectWeightedEntry(state, table, { tags });
  if (!entry) return false;

  const envCol = resolveDropRollEnvCol(context, source);

  // IMPORTANT: chance failure is still a RESOLVED roll (treat as miss)
  if (!passesDropChance(state, entry)) {
    if (eventMeta) {
      pushGameEvent(state, {
        type: eventMeta.type,
        tSec: context?.tSec,
        text: `${eventMeta.label} miss`,
        data: {
          focusKind: "tile",
          envCol,
          tableKey,
          outcome: "miss",
          rarity: null,
          itemKind: null,
          quantity: 0,
          tier: null,
          showInEventLog: false,
        },
      });
    }
    if (effect?.debug === true) {
      console.log("[dropTable] resolved miss (chance fail)", {
        tableKey,
        sourceDefId: source?.defId,
        entry,
      });
    }
    return true;
  }

  // IMPORTANT: miss/null entry is also a RESOLVED roll (no spawn, but not a failure)
  if (!entry.kind) {
    if (eventMeta) {
      pushGameEvent(state, {
        type: eventMeta.type,
        tSec: context?.tSec,
        text: `${eventMeta.label} miss`,
        data: {
          focusKind: "tile",
          envCol,
          tableKey,
          outcome: "miss",
          rarity: null,
          itemKind: null,
          quantity: 0,
          tier: null,
          showInEventLog: false,
        },
      });
    }
    if (effect?.debug === true) {
      console.log("[dropTable] resolved miss (null entry)", {
        tableKey,
        sourceDefId: source?.defId,
        entry,
      });
    }
    return true;
  }

  const kind = entry.kind;
  if (!kind || !itemDefs[kind]) return false;

  const quantity = rollDropQuantity(state, entry);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;

  const tier =
    typeof entry.tier === "string"
      ? entry.tier
      : typeof effect.tier === "string"
        ? effect.tier
        : itemDefs[kind]?.defaultTier ?? "bronze";

  // If the effect doesn't specify a target, default to the acting pawn (if known)
  // otherwise fall back to tile occupants.
  const targets = resolveOwnerTargets(state, resolveDropTarget(effect, context), context);

  // If we rolled an actual item but have nowhere to put it, this is a real failure
  // (keep returning false so upstream can surface/debug it).
  if (!targets.length) return false;


  let totalAdded = 0;
  let blockedReason = null;
  for (const target of targets) {
    const ownerId = typeof target === "object" ? target.id : target;
    if (ownerId == null) continue;
    const placement = { reason: null };
    const added = addTieredUnits(
      state,
      ownerId,
      kind,
      tier,
      quantity,
      placement
    );
    if (added > 0) totalAdded += added;
    if (
      added <= 0 &&
      typeof placement.reason === "string" &&
      placement.reason.length > 0
    ) {
      if (blockedReason !== "tooLarge") {
        blockedReason = placement.reason;
      }
    }
  }

  const changed = totalAdded > 0;
  const tileDefId = typeof source?.defId === "string" ? source.defId : null;

  if ((changed || blockedReason) && tileDefId) {
    rememberDroppedItemKind(state, {
      tableKey,
      tileDefId,
      itemKind: kind,
    });
  }

  if (eventMeta && !changed && blockedReason) {
    const rarity = resolveDropRarity(entry, kind, tier);
    const itemName = getDropItemDisplayName(kind);
    const blockedText =
      blockedReason === "tooLarge"
        ? `${itemName} is too large for inventory`
        : `${itemName} has no inventory space`;
    pushGameEvent(state, {
      type: eventMeta.type,
      tSec: context?.tSec,
      text: `${eventMeta.label}: ${blockedText}`,
      data: {
        focusKind: "tile",
        envCol,
        tableKey,
        outcome: "blocked",
        blockReason: blockedReason,
        rarity,
        itemKind: kind,
        quantity: 0,
        tier,
        showInEventLog: true,
      },
    });
    return true;
  }

  if (eventMeta && changed) {
    const rarity = resolveDropRarity(entry, kind, tier);
    const rarityLabel = formatDropRarityLabel(rarity);
    const itemName = getDropItemDisplayName(kind);
    pushGameEvent(state, {
      type: eventMeta.type,
      tSec: context?.tSec,
      text: `${eventMeta.label}: ${rarityLabel} ${itemName} (+${totalAdded})`,
      data: {
        focusKind: "tile",
        envCol,
        tableKey,
        outcome: "hit",
        rarity,
        itemKind: kind,
        quantity: totalAdded,
        tier,
        showInEventLog: true,
      },
    });
  }

  if (effect?.debug === true) {
    console.log("[dropTable] spawned", {
      tableKey,
      sourceDefId: source?.defId,
      kind,
      quantity,
      tier,
      totalAdded,
      changed,
    });
  }

  // Spawn success should still return "changed" (true only if something was added).
  return changed;
}

export function handleSpawnDropPackage(state, effect, context) {
  if (!context || context.kind !== "game") return false;
  if (typeof state?.rngNextFloat !== "function") return false;

  const rollCount = Number.isFinite(effect?.rollCount)
    ? Math.max(0, Math.floor(effect.rollCount))
    : 15;
  if (rollCount <= 0) return false;

  const tableKey =
    typeof effect?.tableKey === "string" && effect.tableKey.length > 0
      ? effect.tableKey
      : "forageDrops";
  const source = context.source;
  const table = resolveDropTableForTile(source, tableKey);
  if (!table.length) return false;

  const targets = resolveOwnerTargets(state, resolveDropTarget(effect, context), context);
  if (!targets.length) return false;

  let changed = false;
  const tileDefId = typeof source?.defId === "string" ? source.defId : null;
  const tags = Array.isArray(source?.tags) ? source.tags : [];
  for (let i = 0; i < rollCount; i++) {
    const entry = selectWeightedEntry(state, table, { tags });
    if (!entry || !passesDropChance(state, entry) || !entry.kind) continue;
    const kind = entry.kind;
    if (!itemDefs[kind]) continue;
    const quantity = rollDropQuantity(state, entry);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const tier =
      typeof entry.tier === "string"
        ? entry.tier
        : itemDefs[kind]?.defaultTier ?? "bronze";
    let totalAdded = 0;
    for (const target of targets) {
      const ownerId = typeof target === "object" ? target.id : target;
      if (ownerId == null) continue;
      totalAdded += addTieredUnits(state, ownerId, kind, tier, quantity);
    }
    if (totalAdded > 0) {
      changed = true;
      if (tileDefId) {
        rememberDroppedItemKind(state, {
          tableKey,
          tileDefId,
          itemKind: kind,
        });
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
  const orderedTiers = Array.isArray(tierOrder) && tierOrder.length > 0
    ? tierOrder.filter((tier) => TIER_ASC.includes(tier))
    : TIER_ASC.slice();
  if (!orderedTiers.length) orderedTiers.push(...TIER_ASC);

  let remaining = Math.floor(amount);
  let consumed = 0;

  if (inv && Array.isArray(inv.items)) {
    const candidates = inv.items.filter(
      (it) => it && it.kind === kind && Math.floor(it.quantity ?? 0) > 0
    );
    if (candidates.length) {
      sortItemsForConsumption(candidates, orderedTiers);

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
    }
  }

  if (remaining <= 0) return consumed;

  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const owner = pawns.find((pawn) => pawn && String(pawn.id) === String(ownerId)) || null;
  if (!owner) return consumed;

  const provider = findEquippedPoolProviderEntry(owner, "storage", "byKindTier");
  const storage = provider?.item?.systemState?.storage;
  const pool = storage?.byKindTier;
  if (!pool || typeof pool !== "object") return consumed;
  const bucket = pool[kind];
  if (!bucket || typeof bucket !== "object") return consumed;

  for (const tier of orderedTiers) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    bucket[tier] = available - take;
    if (storage?.totalByTier && typeof storage.totalByTier === "object") {
      const total = Math.max(0, Math.floor(storage.totalByTier[tier] ?? 0));
      storage.totalByTier[tier] = Math.max(0, total - take);
    }
    consumed += take;
    remaining -= take;
  }

  const bucketEmpty = TIER_ASC.every((tier) => Math.max(0, Math.floor(bucket[tier] ?? 0)) <= 0);
  if (bucketEmpty) delete pool[kind];

  if (consumed > 0 && inv && Array.isArray(inv.items)) {
    // Basket storage lives on equipped items; bump inventory version so owner-facing UI refreshes.
    bumpInvVersion(inv);
  }

  return consumed;
}

function addTieredUnits(state, ownerId, kind, tier, amount, placement = null) {
  const placementOut =
    placement && typeof placement === "object" ? placement : null;
  if (placementOut) placementOut.reason = null;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const inv = state?.ownerInventories?.[ownerId];
  if (!inv || !Array.isArray(inv.items)) return 0;

  const def = itemDefs[kind] || null;
  const itemWidth = Math.max(1, Math.floor(def?.defaultWidth ?? 1));
  const itemHeight = Math.max(1, Math.floor(def?.defaultHeight ?? 1));
  const itemTooLargeForInventory =
    itemWidth > Math.max(0, Math.floor(inv.cols ?? 0)) ||
    itemHeight > Math.max(0, Math.floor(inv.rows ?? 0));
  const maxStack = getItemMaxStack({ kind, tier });
  const dummy = {
    kind,
    tier,
    seasonsToExpire: null,
    tags: [],
    systemTiers: {},
    systemState: {},
  };
  initializeItemFromDef(state, dummy, { reset: true });
  dummy.tier = tier;

  let remaining = Math.floor(amount);
  let added = 0;
  let blockedAddingNewStack = false;

  for (const stack of inv.items) {
    if (!canStackItems(stack, dummy)) continue;
    const current = Math.floor(stack.quantity ?? 0);
    const space = Math.max(0, maxStack - current);
    if (space <= 0) continue;
    const take = Math.min(space, remaining);
    stack.quantity = current + take;
    mergeItemSystemStateForStacking(stack, dummy, current, take);
    remaining -= take;
    added += take;
    if (remaining <= 0) break;
  }

  while (remaining > 0) {
    const qty = Math.min(remaining, maxStack);
    const newItem = Inventory.addNewItem(state, inv, {
      kind,
      quantity: qty,
      width: itemWidth,
      height: itemHeight,
      tier,
    });
    if (!newItem) {
      blockedAddingNewStack = true;
      break;
    }
    remaining -= qty;
    added += qty;
  }

  if (placementOut && added <= 0 && blockedAddingNewStack) {
    placementOut.reason = itemTooLargeForInventory ? "tooLarge" : "noSpace";
  }

  if (added > 0) bumpInvVersion(inv);
  return added;
}

function isTierBucket(pool) {
  if (!pool || typeof pool !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(pool, "bronze") ||
    Object.prototype.hasOwnProperty.call(pool, "silver") ||
    Object.prototype.hasOwnProperty.call(pool, "gold") ||
    Object.prototype.hasOwnProperty.call(pool, "diamond")
  );
}

function resolveMaturedPoolBucket(pool, itemKind = null) {
  if (!pool || typeof pool !== "object") return null;
  if (isTierBucket(pool)) return pool;
  if (typeof itemKind !== "string" || itemKind.length <= 0) return null;
  const bucket = pool[itemKind];
  if (!bucket || typeof bucket !== "object") return null;
  return bucket;
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

const DEFAULT_DROP_RARITY_WEIGHTS = Object.freeze({
  bronze: 60,
  silver: 35,
  gold: 5,
  diamond: 1,
});

const DROP_ROLL_EVENT_META = Object.freeze({
  forageDrops: { type: "forageRoll", label: "Forage" },
  fishingDrops: { type: "fishingRoll", label: "Fishing" },
});

function resolveDropTableForTile(source, tableKey) {
  const registry = resolveDropTableRegistry(tableKey);
  if (!registry || typeof registry !== "object") return [];

  const tileDefId = typeof source?.defId === "string" ? source.defId : null;
  const tableDef =
    tileDefId && registry.byTile && typeof registry.byTile === "object"
      ? registry.byTile[tileDefId] ?? registry.default
      : registry.default;

  if (!tableDef || typeof tableDef !== "object") return [];
  if (!Array.isArray(tableDef.drops) || tableDef.drops.length === 0) return [];

  const compiled = compileTieredDropTable(tableDef, registry);
  return normalizeDropTable(compiled);
}

function resolveDropTableRegistry(tableKey) {
  if (typeof tableKey !== "string" || !tableKey.length) return null;
  const registries = [forageDropTables, fishingDropTables];
  for (const root of registries) {
    if (!root || typeof root !== "object") continue;
    const table = root[tableKey];
    if (table && typeof table === "object") return table;
  }
  return null;
}

function compileTieredDropTable(tableDef, registry) {
  const tierWeights =
    (tableDef.tierWeights && typeof tableDef.tierWeights === "object"
      ? tableDef.tierWeights
      : null) ??
    (registry?.tierWeights && typeof registry.tierWeights === "object"
      ? registry.tierWeights
      : null) ??
    DEFAULT_DROP_RARITY_WEIGHTS;

  const nullWeightRaw =
    Number.isFinite(tableDef.nullWeight) ? tableDef.nullWeight : null;
  const registryNullRaw =
    Number.isFinite(registry?.nullWeight) ? registry.nullWeight : null;
  const nullWeight = Math.max(0, nullWeightRaw ?? registryNullRaw ?? 0);

  const out = [];
  let hasExplicitMiss = false;

  for (const entry of tableDef.drops) {
    if (!entry || typeof entry !== "object") continue;

    const hasKind =
      typeof entry.kind === "string" && entry.kind.trim().length > 0;
    const isMiss = entry.miss === true || entry.empty === true || !hasKind;

    // Escape hatch: allow explicit numeric weight.
    let weight = Number.isFinite(entry.weight) ? Math.max(0, entry.weight) : null;

    if (weight == null) {
      const rarity = normalizeDropRarity(entry.rarity) ?? "bronze";
      const base = Number.isFinite(tierWeights[rarity])
        ? Math.max(0, tierWeights[rarity])
        : 0;
      const mul = Number.isFinite(entry.mul) ? Math.max(0, entry.mul) : 1;
      weight = base * mul;
    }

    if (!Number.isFinite(weight) || weight <= 0) continue;

    // Only count explicit miss if it actually contributes weight.
    if (isMiss) hasExplicitMiss = true;

    const compiled = {
      kind: isMiss ? null : entry.kind.trim(),
      weight,
    };

    if (Number.isFinite(entry.qtyMin)) compiled.qtyMin = entry.qtyMin;
    if (Number.isFinite(entry.qtyMax)) compiled.qtyMax = entry.qtyMax;
    if (Number.isFinite(entry.chance)) compiled.chance = entry.chance;
    if (entry.requiresTag != null) compiled.requiresTag = entry.requiresTag;
    if (typeof entry.tier === "string") compiled.tier = entry.tier;
    const rarity =
      normalizeDropRarity(entry.rarity) ??
      normalizeDropRarity(entry.tier) ??
      null;
    if (rarity) compiled.rarity = rarity;

    out.push(compiled);
  }

  if (!hasExplicitMiss && nullWeight > 0) {
    out.push({ kind: null, weight: nullWeight });
  }

  return out;
}


function normalizeDropTable(table) {
  const list = Array.isArray(table) ? table : [];
  if (!list.length) return [];

  const merged = Object.create(null);
  for (const entry of list) {
    const normalized = normalizeDropEntry(entry);
    if (!normalized) continue;
    const existing = merged[normalized.key];
    if (existing) {
      existing.weight += normalized.entry.weight;
    } else {
      merged[normalized.key] = normalized.entry;
    }
  }

  const keys = Object.keys(merged);
  keys.sort();
  return keys.map((key) => merged[key]);
}

function normalizeDropEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const hasKind =
    typeof entry.kind === "string" && entry.kind.trim().length > 0;
  const isMiss = entry.miss === true || entry.empty === true || !hasKind;
  const kind = hasKind ? entry.kind.trim() : null;

  const weight = Number.isFinite(entry.weight) ? Math.max(0, entry.weight) : 0;
  if (weight <= 0) return null;

  let qtyMin = Number.isFinite(entry.qtyMin)
    ? Math.max(1, Math.floor(entry.qtyMin))
    : 1;
  let qtyMax = Number.isFinite(entry.qtyMax)
    ? Math.max(1, Math.floor(entry.qtyMax))
    : qtyMin;
  if (qtyMax < qtyMin) qtyMax = qtyMin;

  const chance = Number.isFinite(entry.chance)
    ? Math.min(1, Math.max(0, entry.chance))
    : null;
  const rarity = normalizeDropRarity(entry.rarity);
  const tier = typeof entry.tier === "string" ? entry.tier : null;
  const requiresTag = normalizeRequiresTag(entry.requiresTag);

  const keyKind = isMiss ? "miss" : kind;
  const keyParts = [keyKind, rarity ?? "", tier ?? "", qtyMin, qtyMax, chance ?? ""];
  if (requiresTag) {
    keyParts.push(Array.isArray(requiresTag) ? requiresTag.join("&") : requiresTag);
  }
  const key = keyParts.join("|");

  const normalized = { kind: isMiss ? null : kind, weight, qtyMin, qtyMax };
  if (chance != null) normalized.chance = chance;
  if (rarity) normalized.rarity = rarity;
  if (requiresTag) normalized.requiresTag = requiresTag;
  if (tier) normalized.tier = tier;

  return { key, entry: normalized };
}

function normalizeRequiresTag(requiresTag) {
  if (typeof requiresTag === "string") return requiresTag;
  if (!Array.isArray(requiresTag)) return null;
  const tags = requiresTag.filter((tag) => typeof tag === "string");
  tags.sort();
  if (tags.length === 1) return tags[0];
  return tags.length > 1 ? tags : null;
}

function passesDropChance(state, entry) {
  const chance = Number.isFinite(entry?.chance)
    ? Math.min(1, Math.max(0, entry.chance))
    : 1;
  if (chance <= 0) return false;
  if (chance >= 1) return true;
  if (typeof state?.rngNextFloat !== "function") return false;
  return state.rngNextFloat() < chance;
}

function rollDropQuantity(state, entry) {
  const min = Number.isFinite(entry?.qtyMin)
    ? Math.max(1, Math.floor(entry.qtyMin))
    : 1;
  const max = Number.isFinite(entry?.qtyMax)
    ? Math.max(min, Math.floor(entry.qtyMax))
    : min;
  if (min === max) return min;
  if (typeof state?.rngNextInt === "function") return state.rngNextInt(min, max);
  if (typeof state?.rngNextFloat !== "function") return min;
  return min + Math.floor(state.rngNextFloat() * (max - min + 1));
}

function resolveDropTarget(effect, context) {
  if (effect?.target && typeof effect.target === "object") return effect.target;
  const ownerId = context?.pawnId ?? context?.ownerId ?? null;
  if (ownerId != null) return { ownerId };
  return { kind: "tileOccupants" };
}

function getDropRollEventMeta(tableKey) {
  if (typeof tableKey !== "string" || !tableKey.length) return null;
  return DROP_ROLL_EVENT_META[tableKey] ?? null;
}

function resolveDropRollEnvCol(context, source) {
  if (Number.isFinite(context?.envCol)) return Math.floor(context.envCol);
  if (Number.isFinite(source?.col)) return Math.floor(source.col);
  return null;
}

function normalizeDropRarity(value) {
  if (typeof value !== "string") return null;
  const rarity = value.trim().toLowerCase();
  if (
    rarity === "bronze" ||
    rarity === "silver" ||
    rarity === "gold" ||
    rarity === "diamond"
  ) {
    return rarity;
  }
  return null;
}

function resolveDropRarity(entry, kind, tier) {
  const entryRarity = normalizeDropRarity(entry?.rarity);
  if (entryRarity) return entryRarity;
  const tierRarity =
    normalizeDropRarity(entry?.tier) ??
    normalizeDropRarity(tier) ??
    normalizeDropRarity(itemDefs?.[kind]?.defaultTier);
  return tierRarity ?? "bronze";
}

function formatDropRarityLabel(rarity) {
  const key = normalizeDropRarity(rarity) ?? "bronze";
  if (key === "silver") return "Uncommon";
  if (key === "gold") return "Rare";
  if (key === "diamond") return "Diamond";
  return "Common";
}

function getDropItemDisplayName(kind) {
  if (typeof kind !== "string" || !kind.length) return "Item";
  const defName = itemDefs?.[kind]?.name;
  if (typeof defName === "string" && defName.trim().length > 0) return defName;
  const words = kind
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1));
  return words.length ? words.join(" ") : kind;
}
