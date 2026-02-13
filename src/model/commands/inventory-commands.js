import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { runEffect } from "../effects/index.js";
import { TIER_ASC } from "../effects/core/tiers.js";
import {
  canItemEquipInSlot,
  isLeaderEquipmentSlotId,
} from "../equipment-rules.js";
import { bumpInvVersion } from "../effects/core/inventory-version.js";
import { itemProvidesPool } from "../item-def-rules.js";
import { Inventory } from "../inventory-model.js";
import { canOwnerAcceptItem } from "./owner-acceptance.js";
import {
  addItemUnitsToInventoryWithTags,
  ensureInventoryForHubStructure,
  ensureLeaderEquipment,
  ensurePortableStorageState,
  getEquippedBasketEntry,
  getLeaderByOwnerId,
  isTierBucket,
  itemHasBaseTag,
} from "./inventory-helpers.js";
import { ensureHubSystemState } from "./system-state-helpers.js";

export function cmdWithdrawHubPoolItem(
  state,
  { hubCol, itemId, amount, systemId, poolKey } = {}
) {
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  if (typeof itemId !== "string" || itemId.length === 0) {
    return { ok: false, reason: "badItemId" };
  }
  const requested = Math.max(1, Math.floor(amount ?? 1));
  if (requested <= 0) return { ok: false, reason: "badAmount" };

  const col = Math.floor(hubCol);
  const structure = state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };

  const def = structure?.defId ? hubStructureDefs?.[structure.defId] : null;
  const deposit = def?.deposit;
  if (!deposit || typeof deposit !== "object") {
    return { ok: false, reason: "noDepositPool" };
  }

  const resolvedSystemId = typeof deposit.systemId === "string" ? deposit.systemId : null;
  if (!resolvedSystemId) return { ok: false, reason: "badPoolSystem" };
  const resolvedPoolKey =
    typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
      ? deposit.poolKey
      : "byKindTier";

  if (
    typeof systemId === "string" &&
    systemId.length > 0 &&
    systemId !== resolvedSystemId
  ) {
    return { ok: false, reason: "mismatchedSystemId" };
  }
  if (
    typeof poolKey === "string" &&
    poolKey.length > 0 &&
    poolKey !== resolvedPoolKey
  ) {
    return { ok: false, reason: "mismatchedPoolKey" };
  }

  if (resolvedSystemId !== "granaryStore" && resolvedSystemId !== "storehouseStore") {
    return { ok: false, reason: "unsupportedPool" };
  }

  const sysState = ensureHubSystemState(structure, resolvedSystemId);
  if (!sysState || typeof sysState !== "object") {
    return { ok: false, reason: "noSystemState" };
  }
  const pool = sysState?.[resolvedPoolKey];
  if (!pool || typeof pool !== "object") return { ok: false, reason: "noPool" };
  if (isTierBucket(pool)) return { ok: false, reason: "unsupportedPoolShape" };

  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") {
    return { ok: false, reason: "missingItemPool" };
  }

  const inv = ensureInventoryForHubStructure(state, structure);
  if (!inv) return { ok: false, reason: "noInventory" };

  let remaining = requested;
  let moved = 0;
  let spawnItemId = null;
  const applyPrestigedTag = itemHasBaseTag(itemId, "grain");
  const extraTags = applyPrestigedTag ? ["prestiged"] : [];

  for (const tier of TIER_ASC) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
    if (available <= 0) continue;
    const want = Math.min(remaining, available);
    const addRes = addItemUnitsToInventoryWithTags(
      state,
      inv,
      itemId,
      tier,
      want,
      extraTags
    );
    const added = Math.max(0, Math.floor(addRes?.added ?? 0));
    if (added <= 0) break;

    bucket[tier] = available - added;
    if (sysState.totalByTier && typeof sysState.totalByTier === "object") {
      const total = Math.max(0, Math.floor(sysState.totalByTier[tier] ?? 0));
      sysState.totalByTier[tier] = Math.max(0, total - added);
    }
    if (spawnItemId == null && addRes?.firstItemId != null) {
      spawnItemId = addRes.firstItemId;
    }

    moved += added;
    remaining -= added;
    if (added < want) break;
  }

  if (moved <= 0) {
    return { ok: false, reason: "noSpaceForWithdraw" };
  }

  const empty = TIER_ASC.every((tier) => Math.max(0, Math.floor(bucket[tier] ?? 0)) <= 0);
  if (empty) delete pool[itemId];

  bumpInvVersion(inv);

  const anchorCol = Number.isFinite(structure.col) ? Math.floor(structure.col) : col;
  return {
    ok: true,
    result: "poolWithdrawn",
    hubCol: anchorCol,
    ownerId: structure.instanceId,
    itemKind: itemId,
    requested,
    moved,
    spawnItemId,
    taggedPrestiged: applyPrestigedTag,
  };
}

export function cmdDepositItemToEquippedBasket(
  state,
  { fromOwnerId, toOwnerId, itemId, slotId } = {}
) {
  if (fromOwnerId == null) return { ok: false, reason: "badFromOwner" };
  if (toOwnerId == null) return { ok: false, reason: "badToOwner" };
  if (itemId == null) return { ok: false, reason: "badItemId" };

  const fromInv = state?.ownerInventories?.[fromOwnerId];
  if (!fromInv) return { ok: false, reason: "noInventory" };

  const leader = getLeaderByOwnerId(state, toOwnerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  const basketEntry = getEquippedBasketEntry(leader, slotId);
  if (!basketEntry?.item) return { ok: false, reason: "noEquippedBasket" };

  const item = fromInv.itemsById?.[itemId] || fromInv.items?.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };
  if (
    item.id === basketEntry.item.id ||
    itemProvidesPool(item, "storage", "byKindTier")
  ) {
    return { ok: false, reason: "cannotDepositBasket" };
  }

  const qty = Math.max(0, Math.floor(item.quantity ?? 0));
  if (qty <= 0) return { ok: false, reason: "emptyStack" };

  const store = ensurePortableStorageState(leader, basketEntry.item);
  if (!store) return { ok: false, reason: "noBasketStore" };
  const pool = store.byKindTier;
  if (!pool || typeof pool !== "object") return { ok: false, reason: "noPool" };

  if (!pool[item.kind] || typeof pool[item.kind] !== "object") {
    pool[item.kind] = {};
  }
  const bucket = pool[item.kind];
  for (const tier of TIER_ASC) {
    if (!Number.isFinite(bucket[tier])) bucket[tier] = 0;
  }

  const tierRaw =
    typeof item.tier === "string" && item.tier.length > 0
      ? item.tier
      : itemDefs?.[item.kind]?.defaultTier || "bronze";
  const tier = TIER_ASC.includes(tierRaw) ? tierRaw : "bronze";
  bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + qty;
  store.totalByTier[tier] = Math.max(0, Math.floor(store.totalByTier[tier] ?? 0)) + qty;

  Inventory.removeItem(fromInv, item.id);
  Inventory.rebuildDerived(fromInv);
  bumpInvVersion(fromInv);

  return {
    ok: true,
    result: "basketDeposited",
    fromOwnerId,
    toOwnerId: leader.id,
    itemKind: item.kind,
    moved: qty,
    basketSlotId: basketEntry.slotId,
  };
}

export function cmdWithdrawPawnBasketPoolItem(
  state,
  { ownerId, itemId, amount, slotId } = {}
) {
  if (ownerId == null) return { ok: false, reason: "badOwner" };
  if (typeof itemId !== "string" || itemId.length === 0) {
    return { ok: false, reason: "badItemId" };
  }
  const requested = Math.max(1, Math.floor(amount ?? 1));
  if (requested <= 0) return { ok: false, reason: "badAmount" };

  const leader = getLeaderByOwnerId(state, ownerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  const basketEntry = getEquippedBasketEntry(leader, slotId);
  if (!basketEntry?.item) return { ok: false, reason: "noEquippedBasket" };

  const store = ensurePortableStorageState(leader, basketEntry.item);
  if (!store) return { ok: false, reason: "noBasketStore" };
  const pool = store.byKindTier;
  if (!pool || typeof pool !== "object") return { ok: false, reason: "noPool" };
  if (isTierBucket(pool)) return { ok: false, reason: "unsupportedPoolShape" };

  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") {
    return { ok: false, reason: "missingItemPool" };
  }

  const inv = state?.ownerInventories?.[leader.id];
  if (!inv) return { ok: false, reason: "noInventory" };

  let remaining = requested;
  let moved = 0;
  let spawnItemId = null;
  for (const tier of TIER_ASC) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
    if (available <= 0) continue;
    const want = Math.min(remaining, available);
    const addRes = addItemUnitsToInventoryWithTags(state, inv, itemId, tier, want, []);
    const added = Math.max(0, Math.floor(addRes?.added ?? 0));
    if (added <= 0) break;

    bucket[tier] = available - added;
    const total = Math.max(0, Math.floor(store.totalByTier[tier] ?? 0));
    store.totalByTier[tier] = Math.max(0, total - added);
    if (spawnItemId == null && addRes?.firstItemId != null) {
      spawnItemId = addRes.firstItemId;
    }
    moved += added;
    remaining -= added;
    if (added < want) break;
  }

  if (moved <= 0) {
    return { ok: false, reason: "noSpaceForWithdraw" };
  }

  const empty = TIER_ASC.every((tier) => Math.max(0, Math.floor(bucket[tier] ?? 0)) <= 0);
  if (empty) delete pool[itemId];

  bumpInvVersion(inv);

  return {
    ok: true,
    result: "basketPoolWithdrawn",
    ownerId: leader.id,
    itemKind: itemId,
    requested,
    moved,
    spawnItemId,
    basketSlotId: basketEntry.slotId,
  };
}

export function cmdMoveItemBetweenOwners(
  state,
  { fromOwnerId, toOwnerId, itemId, targetGX, targetGY }
) {
  const fromInv = state.ownerInventories[fromOwnerId];
  const toInv = state.ownerInventories[toOwnerId];
  if (!fromInv || !toInv) return { ok: false, reason: "noInventory" };

  const item = fromInv.itemsById[itemId] || fromInv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  const ctx = { kind: "inventoryMove", state, events: [], out: null };

  runEffect(
    state,
    {
      op: "moveItem",
      fromOwnerId,
      toOwnerId,
      itemId,
      targetGX,
      targetGY,
    },
    ctx
  );

  return ctx.out || { ok: false, reason: "effectFailed" };
}

export function cmdMoveProcessBufferItem(
  state,
  { fromOwnerId, toOwnerId, itemId, targetGX, targetGY } = {}
) {
  if (fromOwnerId == null || toOwnerId == null) {
    return { ok: false, reason: "badOwner" };
  }
  const isProcessOwner = (ownerId) =>
    typeof ownerId === "string" && ownerId.startsWith("inv:process:");
  if (!isProcessOwner(fromOwnerId) && !isProcessOwner(toOwnerId)) {
    return { ok: false, reason: "notProcessBuffer" };
  }
  return cmdMoveItemBetweenOwners(state, {
    fromOwnerId,
    toOwnerId,
    itemId,
    targetGX,
    targetGY,
  });
}

export function cmdEquipItemToLeaderSlot(
  state,
  { fromOwnerId, toOwnerId, itemId, slotId } = {}
) {
  if (!isLeaderEquipmentSlotId(slotId)) {
    return { ok: false, reason: "badSlot" };
  }

  const fromInv = state?.ownerInventories?.[fromOwnerId];
  if (!fromInv) return { ok: false, reason: "noInventory" };

  const leader = getLeaderByOwnerId(state, toOwnerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  ensureLeaderEquipment(leader);

  const item = fromInv.itemsById?.[itemId] || fromInv.items?.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };
  if (!canItemEquipInSlot(item, slotId)) {
    return { ok: false, reason: "slotMismatch" };
  }
  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  const current = leader.equipment[slotId] ?? null;
  if (current) return { ok: false, reason: "slotOccupied" };

  Inventory.removeItem(fromInv, item.id);
  Inventory.rebuildDerived(fromInv);
  bumpInvVersion(fromInv);

  leader.equipment[slotId] = item;
  if (itemProvidesPool(item, "storage", "byKindTier")) {
    ensurePortableStorageState(leader, item);
  }

  return {
    ok: true,
    result: "equipped",
    fromOwnerId,
    toOwnerId,
    itemId: item.id,
    slotId,
  };
}

export function cmdMoveLeaderEquipmentToInventory(
  state,
  { fromOwnerId, toOwnerId, slotId, targetGX, targetGY } = {}
) {
  if (!isLeaderEquipmentSlotId(slotId)) {
    return { ok: false, reason: "badSlot" };
  }

  const leader = getLeaderByOwnerId(state, fromOwnerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  ensureLeaderEquipment(leader);

  const item = leader.equipment[slotId] ?? null;
  if (!item) return { ok: false, reason: "emptySlot" };

  const toInv = state?.ownerInventories?.[toOwnerId];
  if (!toInv) return { ok: false, reason: "noInventory" };
  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  let gx = Number.isFinite(targetGX) ? Math.floor(targetGX) : null;
  let gy = Number.isFinite(targetGY) ? Math.floor(targetGY) : null;

  if (gx == null || gy == null) {
    let found = null;
    outer: for (let y = 0; y <= toInv.rows - item.height; y++) {
      for (let x = 0; x <= toInv.cols - item.width; x++) {
        if (Inventory.canPlaceItemAt(toInv, item, x, y)) {
          found = { gx: x, gy: y };
          break outer;
        }
      }
    }
    if (!found) return { ok: false, reason: "noSpace" };
    gx = found.gx;
    gy = found.gy;
  }

  const canPlace = Inventory.canPlaceItemAt(toInv, item, gx, gy);
  if (!canPlace) return { ok: false, reason: "blocked" };

  leader.equipment[slotId] = null;
  const attached = Inventory.attachExistingItem(toInv, item, gx, gy);
  if (!attached) {
    leader.equipment[slotId] = item;
    return { ok: false, reason: "attachFailed" };
  }

  Inventory.rebuildDerived(toInv);
  bumpInvVersion(toInv);

  return {
    ok: true,
    result: "unequipped",
    fromOwnerId,
    toOwnerId,
    itemId: item.id,
    slotId,
    gx,
    gy,
  };
}

export function cmdMoveLeaderEquipmentToSlot(
  state,
  { fromOwnerId, toOwnerId, fromSlotId, toSlotId } = {}
) {
  if (!isLeaderEquipmentSlotId(fromSlotId) || !isLeaderEquipmentSlotId(toSlotId)) {
    return { ok: false, reason: "badSlot" };
  }

  const fromLeader = getLeaderByOwnerId(state, fromOwnerId);
  const toLeader = getLeaderByOwnerId(state, toOwnerId);
  if (!fromLeader || !toLeader) return { ok: false, reason: "noLeader" };
  ensureLeaderEquipment(fromLeader);
  ensureLeaderEquipment(toLeader);

  if (fromOwnerId === toOwnerId && fromSlotId === toSlotId) {
    return { ok: true, result: "noChange" };
  }

  const item = fromLeader.equipment[fromSlotId] ?? null;
  if (!item) return { ok: false, reason: "emptySlot" };
  if (!canItemEquipInSlot(item, toSlotId)) {
    return { ok: false, reason: "slotMismatch" };
  }
  if (toLeader.equipment[toSlotId] != null) {
    return { ok: false, reason: "slotOccupied" };
  }
  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  fromLeader.equipment[fromSlotId] = null;
  toLeader.equipment[toSlotId] = item;
  if (itemProvidesPool(item, "storage", "byKindTier")) {
    ensurePortableStorageState(toLeader, item);
  }

  return {
    ok: true,
    result: "equippedMoved",
    fromOwnerId,
    toOwnerId,
    fromSlotId,
    toSlotId,
    itemId: item.id,
  };
}

export function cmdSplitStackAndPlace(state, ownerId, itemId, amount, targetGX, targetGY) {
  const inv = state.ownerInventories[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  const item = inv.itemsById[itemId] || inv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  const splitAmount = Math.floor(amount);
  if (splitAmount <= 0 || splitAmount >= item.quantity) {
    return { ok: false, reason: "badAmount" };
  }

  const ctx = { kind: "inventorySplit", state, events: [], out: null };

  runEffect(
    state,
    {
      op: "splitStack",
      ownerId,
      itemId,
      amount: splitAmount,
      targetGX,
      targetGY,
    },
    ctx
  );

  return ctx.out || { ok: false, reason: "effectFailed" };
}

export function cmdStackItemsInOwner(state, { ownerId, sourceItemId, targetItemId, amount }) {
  const inv = state.ownerInventories[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  const ctx = { kind: "inventoryStack", state, events: [], out: null };

  runEffect(
    state,
    {
      op: "stackItem",
      ownerId,
      sourceItemId,
      targetItemId,
      amount,
    },
    ctx
  );

  return ctx.out || { ok: false, reason: "effectFailed" };
}

export function cmdDiscardItemFromOwner(state, { ownerId, itemId } = {}) {
  if (ownerId == null) return { ok: false, reason: "badOwner" };
  if (itemId == null) return { ok: false, reason: "badItem" };

  const inv = state?.ownerInventories?.[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  Inventory.rebuildDerived(inv);
  const item = inv.itemsById[itemId] || inv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  Inventory.removeItem(inv, item.id);
  Inventory.rebuildDerived(inv);
  bumpInvVersion(inv);

  return { ok: true, result: "discarded", ownerId, itemId };
}
