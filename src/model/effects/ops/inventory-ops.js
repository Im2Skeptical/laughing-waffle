import {
  Inventory,
  canStackItems,
  getItemMaxStack,
  mergeItemSystemStateForStacking,
} from "../../inventory-model.js";
import { bumpInvVersion } from "../core/inventory-version.js";
import { cloneSerializable } from "../core/clone.js";
import { resolveInventoryTransferPlan } from "../../commands/inventory-helpers.js";

export function handleMoveItem(state, effect, context) {
  if (!context || context.kind !== "inventoryMove") return false;
  const out = handleMoveItemInternal(state, effect, context);
  context.out = out;
  return !!out?.ok;
}

export function handleStackItem(state, effect, context) {
  if (!context || context.kind !== "inventoryStack") return false;
  const out = handleStackItemInternal(state, effect, context);
  context.out = out;
  return !!out?.ok;
}

export function handleSplitStack(state, effect, context) {
  if (!context || context.kind !== "inventorySplit") return false;
  const out = handleSplitStackInternal(state, effect, context);
  context.out = out;
  return !!out?.ok;
}

// =============================================================================
// INVENTORY: stackItem handler (authoritative mutation)
// =============================================================================

function handleStackItemInternal(state, effect, context) {
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
  const targetQtyBefore = Math.floor(target.quantity ?? 0);
  const space = maxStack - targetQtyBefore;
  if (space <= 0) return { ok: false, reason: "targetFull" };

  const moveAmt =
    typeof amount === "number" && Number.isFinite(amount)
      ? Math.max(1, Math.floor(amount))
      : source.quantity;

  const amtToMove = Math.min(space, source.quantity, moveAmt);

  target.quantity = targetQtyBefore + amtToMove;
  mergeItemSystemStateForStacking(target, source, targetQtyBefore, amtToMove);
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

function handleSplitStackInternal(state, effect, context) {
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
    tags: cloneSerializable(item.tags ?? []),
    systemTiers: cloneSerializable(item.systemTiers ?? {}),
    systemState: cloneSerializable(item.systemState ?? {}),
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

function handleMoveItemInternal(state, effect, context) {
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
    if (fromOwnerId === toOwnerId) {
      const ctx = { kind: "inventoryStack", state, events, out: null };
      const out = handleStackItemInternal(
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

  const transferPlan = resolveInventoryTransferPlan({
    fromInv,
    toInv,
    item,
    targetGX,
    targetGY,
    fromOwnerId,
    toOwnerId,
  });
  if (!transferPlan?.ok) {
    return { ok: false, reason: transferPlan?.reason ?? "blocked" };
  }
  if ((transferPlan.totalMoved ?? 0) <= 0) {
    return { ok: false, reason: transferPlan?.reason ?? "blocked" };
  }

  events.push({ type: "onLeaveContainer", ownerId: fromOwnerId, itemId });

  for (const stackOp of transferPlan.stackOps || []) {
    const target =
      toInv.itemsById?.[stackOp.targetItemId] ||
      toInv.items.find((candidate) => candidate.id === stackOp.targetItemId);
    if (!target) {
      return { ok: false, reason: "noItem" };
    }
    const targetQtyBefore = Math.max(0, Math.floor(target.quantity ?? 0));
    const moveAmt = Math.min(
      Math.max(0, Math.floor(stackOp.amount ?? 0)),
      Math.max(0, Math.floor(item.quantity ?? 0))
    );
    if (moveAmt <= 0) continue;
    target.quantity = targetQtyBefore + moveAmt;
    mergeItemSystemStateForStacking(target, item, targetQtyBefore, moveAmt);
    item.quantity -= moveAmt;
    events.push({
      type: "onStack",
      ownerId: toOwnerId,
      sourceItemId: item.id,
      targetItemId: target.id,
      amount: moveAmt,
    });
  }

  let result = transferPlan.stackOps?.length ? "stacked" : "moved";
  if (transferPlan.placedRemainder) {
    const remainderQty = Math.max(0, Math.floor(item.quantity ?? 0));
    if (remainderQty <= 0) {
      return { ok: false, reason: "attachFailed" };
    }
    const { gx, gy } = transferPlan.placedRemainder;
    Inventory.removeItem(fromInv, item.id);
    const success = Inventory.attachExistingItem(toInv, item, gx, gy);
    if (!success) {
      return { ok: false, reason: "attachFailed" };
    }
    events.push({ type: "onEnterContainer", ownerId: toOwnerId, itemId });
    events.push({
      type: "moveItem",
      fromOwnerId,
      toOwnerId,
      itemId,
      gx,
      gy,
    });
    result = "moved";
  } else if ((item.quantity ?? 0) <= 0) {
    Inventory.removeItem(fromInv, item.id);
  }

  Inventory.rebuildDerived(fromInv);
  Inventory.rebuildDerived(toInv);

  bumpInvVersion(fromInv);
  bumpInvVersion(toInv);

  return {
    ok: true,
    result,
    moved: transferPlan.totalMoved,
    partial: transferPlan.partial === true,
    sourceRemaining: transferPlan.sourceRemaining ?? 0,
    events,
  };
}
