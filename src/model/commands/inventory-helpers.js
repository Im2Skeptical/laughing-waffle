import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import {
  LEADER_EQUIPMENT_SLOT_ORDER,
} from "../../defs/gamesystems/equipment-slot-defs.js";
import {
  createEmptyLeaderEquipment,
} from "../equipment-rules.js";
import {
  findEquippedPoolProviderEntry,
} from "../item-def-rules.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
  initializeItemFromDef,
  mergeItemSystemStateForStacking,
} from "../inventory-model.js";
import { TIER_ASC } from "../effects/core/tiers.js";
import { cloneSerializable } from "./system-state-helpers.js";
import { isProcessDropboxOwnerId } from "../owner-id-protocol.js";

export function isTierBucket(pool) {
  if (!pool || typeof pool !== "object") return false;
  for (const tier of TIER_ASC) {
    if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
  }
  return false;
}

export function ensureInventoryForHubStructure(state, structure) {
  if (!state || !structure) return null;
  if (!state.ownerInventories || typeof state.ownerInventories !== "object") {
    state.ownerInventories = {};
  }
  const ownerId = structure.instanceId;
  if (ownerId == null) return null;
  if (!state.ownerInventories[ownerId]) {
    const def = hubStructureDefs?.[structure.defId] || null;
    const invSpec = def?.inventory ?? {};
    const cols = Number.isFinite(invSpec.cols) ? Math.floor(invSpec.cols) : 5;
    const rows = Number.isFinite(invSpec.rows) ? Math.floor(invSpec.rows) : 10;
    const inv = Inventory.create(cols, rows);
    Inventory.init(inv);
    inv.version = 0;
    state.ownerInventories[ownerId] = inv;
  }
  return state.ownerInventories[ownerId] || null;
}

export function addItemUnitsToInventoryWithTags(
  state,
  inv,
  itemId,
  tier,
  qty,
  extraTags = []
) {
  if (!state || !inv || !itemId) return { added: 0, firstItemId: null };
  const targetQty = Math.max(0, Math.floor(qty ?? 0));
  if (targetQty <= 0) return { added: 0, firstItemId: null };

  const def = itemDefs?.[itemId] || null;
  const dummy = {
    kind: itemId,
    tier: tier ?? def?.defaultTier ?? "bronze",
    seasonsToExpire: null,
    tags: Array.isArray(extraTags) ? extraTags.slice() : [],
    systemTiers: {},
    systemState: {},
  };
  initializeItemFromDef(state, dummy, { reset: true });
  if (Array.isArray(extraTags) && extraTags.length > 0) {
    const merged = new Set(Array.isArray(dummy.tags) ? dummy.tags : []);
    for (const tag of extraTags) {
      if (typeof tag !== "string" || !tag.length) continue;
      merged.add(tag);
    }
    dummy.tags = Array.from(merged);
  }

  const maxStack = Math.max(1, Math.floor(getItemMaxStack(dummy) || 1));
  let remaining = targetQty;
  let added = 0;
  let firstItemId = null;

  for (const stack of inv.items || []) {
    if (remaining <= 0) break;
    if (!canStackItems(stack, dummy)) continue;
    const current = Math.max(0, Math.floor(stack.quantity ?? 0));
    const space = Math.max(0, maxStack - current);
    if (space <= 0) continue;
    const moved = Math.min(space, remaining);
    if (moved <= 0) continue;
    stack.quantity = current + moved;
    mergeItemSystemStateForStacking(stack, dummy, current, moved);
    if (firstItemId == null) firstItemId = stack.id;
    remaining -= moved;
    added += moved;
  }

  while (remaining > 0) {
    const moved = Math.min(remaining, maxStack);
    const created = Inventory.addNewItem(state, inv, {
      kind: itemId,
      quantity: moved,
      width: def?.defaultWidth ?? 1,
      height: def?.defaultHeight ?? 1,
      tier: dummy.tier,
      seasonsToExpire: dummy.seasonsToExpire ?? null,
      tags: cloneSerializable(dummy.tags ?? []),
      systemTiers: cloneSerializable(dummy.systemTiers ?? {}),
      systemState: cloneSerializable(dummy.systemState ?? {}),
    });
    if (!created) break;
    if (firstItemId == null) firstItemId = created.id;
    remaining -= moved;
    added += moved;
  }

  return { added, firstItemId };
}

export function itemHasBaseTag(itemId, tag) {
  if (!itemId || !tag) return false;
  const tags = Array.isArray(itemDefs?.[itemId]?.baseTags)
    ? itemDefs[itemId].baseTags
    : [];
  return tags.includes(tag);
}

export function resolvePawnOwnerId(ownerId) {
  if (typeof ownerId === "number") return ownerId;
  if (
    typeof ownerId === "string" &&
    !isProcessDropboxOwnerId(ownerId)
  ) {
    const asNum = Number(ownerId);
    if (Number.isFinite(asNum)) return asNum;
  }
  return ownerId;
}

export function getLeaderByOwnerId(state, ownerId) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const normalized = resolvePawnOwnerId(ownerId);
  const pawn = pawns.find((candidatePawn) => candidatePawn && candidatePawn.id === normalized);
  if (!pawn || pawn.role !== "leader") return null;
  return pawn;
}

export function getPawnById(state, ownerId) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const normalized = resolvePawnOwnerId(ownerId);
  return pawns.find((candidatePawn) => candidatePawn && candidatePawn.id === normalized) || null;
}

export function ensureLeaderEquipment(leader) {
  if (!leader || leader.role !== "leader") return;
  if (!leader.equipment || typeof leader.equipment !== "object") {
    leader.equipment = createEmptyLeaderEquipment();
    return;
  }
  for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(leader.equipment, slotId)) {
      leader.equipment[slotId] = null;
    }
  }
}

export function ensurePortableStorageState(owner, storageItem) {
  if (!storageItem || typeof storageItem !== "object") return null;
  if (!storageItem.systemState || typeof storageItem.systemState !== "object") {
    storageItem.systemState = {};
  }
  if (
    !storageItem.systemState.storage ||
    typeof storageItem.systemState.storage !== "object"
  ) {
    storageItem.systemState.storage = {};
  }
  const store = storageItem.systemState.storage;
  if (!store.byKindTier || typeof store.byKindTier !== "object") {
    store.byKindTier = {};
  }
  if (!store.totalByTier || typeof store.totalByTier !== "object") {
    store.totalByTier = {};
  }
  for (const tier of TIER_ASC) {
    if (!Number.isFinite(store.totalByTier[tier])) {
      store.totalByTier[tier] = 0;
    }
  }
  const legacy =
    owner?.systemState?.basketStore && typeof owner.systemState.basketStore === "object"
      ? owner.systemState.basketStore
      : null;
  if (legacy && typeof legacy.byKindTier === "object") {
    const isStoreEmpty = Object.keys(store.byKindTier).length === 0;
    if (isStoreEmpty) {
      for (const [kind, rawBucket] of Object.entries(legacy.byKindTier)) {
        if (!rawBucket || typeof rawBucket !== "object") continue;
        if (!store.byKindTier[kind] || typeof store.byKindTier[kind] !== "object") {
          store.byKindTier[kind] = {};
        }
        const bucket = store.byKindTier[kind];
        for (const tier of TIER_ASC) {
          const qty = Math.max(0, Math.floor(rawBucket[tier] ?? 0));
          bucket[tier] = qty;
          store.totalByTier[tier] = Math.max(0, Math.floor(store.totalByTier[tier] ?? 0)) + qty;
        }
      }
    }
    delete owner.systemState.basketStore;
  }
  return store;
}

export function getEquippedBasketEntry(leader, preferredSlotId = null) {
  if (!leader || leader.role !== "leader") return null;
  ensureLeaderEquipment(leader);
  return findEquippedPoolProviderEntry(
    leader,
    "storage",
    "byKindTier",
    preferredSlotId
  );
}

function sortInventoryItemsForAutostack(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftY = Number.isFinite(left?.gridY) ? Math.floor(left.gridY) : 0;
    const rightY = Number.isFinite(right?.gridY) ? Math.floor(right.gridY) : 0;
    if (leftY !== rightY) return leftY - rightY;
    const leftX = Number.isFinite(left?.gridX) ? Math.floor(left.gridX) : 0;
    const rightX = Number.isFinite(right?.gridX) ? Math.floor(right.gridX) : 0;
    if (leftX !== rightX) return leftX - rightX;
    const leftId = Number.isFinite(left?.id) ? Math.floor(left.id) : 0;
    const rightId = Number.isFinite(right?.id) ? Math.floor(right.id) : 0;
    return leftId - rightId;
  });
}

function findFirstValidPlacement(inv, item) {
  if (!inv || !item) return null;
  for (let gy = 0; gy <= inv.rows - item.height; gy++) {
    for (let gx = 0; gx <= inv.cols - item.width; gx++) {
      if (Inventory.canPlaceItemAt(inv, item, gx, gy)) {
        return { gx, gy };
      }
    }
  }
  return null;
}

export function resolveInventoryTransferPlan({
  fromInv,
  toInv,
  item,
  targetGX,
  targetGY,
  fromOwnerId,
  toOwnerId,
} = {}) {
  if (!fromInv || !toInv) return { ok: false, reason: "noInventory" };
  if (!item) return { ok: false, reason: "noItem" };

  const quantity = Math.max(0, Math.floor(item.quantity ?? 0));
  if (quantity <= 0) return { ok: false, reason: "emptyStack" };

  const stackOps = [];
  let remaining = quantity;
  const usedAutostack = fromOwnerId !== toOwnerId;

  if (usedAutostack) {
    const candidates = sortInventoryItemsForAutostack(toInv.items).filter((target) => {
      if (!target || target.id === item.id) return false;
      if (!canStackItems(target, item)) return false;
      const maxStack = Math.max(1, Math.floor(getItemMaxStack(target) || 1));
      const targetQty = Math.max(0, Math.floor(target.quantity ?? 0));
      return targetQty < maxStack;
    });

    for (const target of candidates) {
      if (remaining <= 0) break;
      const maxStack = Math.max(1, Math.floor(getItemMaxStack(target) || 1));
      const targetQty = Math.max(0, Math.floor(target.quantity ?? 0));
      const space = Math.max(0, maxStack - targetQty);
      if (space <= 0) continue;
      const amount = Math.min(space, remaining);
      if (amount <= 0) continue;
      stackOps.push({ targetItemId: target.id, amount });
      remaining -= amount;
    }
  }

  const totalStacked = quantity - remaining;
  if (remaining <= 0) {
    return {
      ok: true,
      stackOps,
      placedRemainder: null,
      sourceRemaining: 0,
      totalMoved: quantity,
      usedAutostack: stackOps.length > 0,
      needsExactPlacement: false,
      partial: false,
    };
  }

  const requestedGX = Number.isFinite(targetGX) ? Math.floor(targetGX) : null;
  const requestedGY = Number.isFinite(targetGY) ? Math.floor(targetGY) : null;
  const canPlaceAtRequested =
    requestedGX != null &&
    requestedGY != null &&
    Inventory.canPlaceItemAt(toInv, item, requestedGX, requestedGY);

  let placement = canPlaceAtRequested ? { gx: requestedGX, gy: requestedGY } : null;
  if (!placement && stackOps.length > 0) {
    placement = findFirstValidPlacement(toInv, item);
  }

  if (!placement) {
    if (totalStacked > 0) {
      return {
        ok: true,
        stackOps,
        placedRemainder: null,
        sourceRemaining: remaining,
        totalMoved: totalStacked,
        usedAutostack: true,
        needsExactPlacement: false,
        partial: true,
      };
    }
    return {
      ok: false,
      reason: "blocked",
      stackOps: [],
      placedRemainder: null,
      sourceRemaining: quantity,
      totalMoved: 0,
      usedAutostack: false,
      needsExactPlacement: true,
      partial: false,
    };
  }

  return {
    ok: true,
    stackOps,
    placedRemainder: {
      gx: placement.gx,
      gy: placement.gy,
      amount: remaining,
    },
    sourceRemaining: 0,
    totalMoved: quantity,
    usedAutostack: stackOps.length > 0,
    needsExactPlacement: stackOps.length <= 0 && !canPlaceAtRequested,
    partial: false,
  };
}
