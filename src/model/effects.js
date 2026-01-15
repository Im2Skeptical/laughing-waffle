// effects.js — EffectOp interpreter + seasonEnd + item expiry + inventory ops

import { envCardDefs, itemDefs } from "../defs/gamepieces-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
} from "./inventory-model.js";
import { makeEnvInstance } from "./state.js";

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

    // ================= ENV CORE OPS =================

    case "KillEnv": {
      if (context.kind !== "env") return false;
      const { slot, seasonData } = context;
      if (!slot || !slot.env) return false;

      if (seasonData) seasonData.discard.push(slot.env.defId);
      slot.env = null;
      return true;
    }

    case "SeasonEndRecycleAs": {
      if (context.kind !== "env") return false;
      const { slot, seasonData } = context;
      if (!slot || !slot.env) return false;

      const targetDefId = effect.targetDefId || slot.env.defId;
      if (seasonData) seasonData.discard.push(targetDefId);
      slot.env = null;
      return true;
    }

    case "TransformEnv": {
      if (context.kind !== "env") return false;
      const { slot } = context;
      if (!slot || !slot.env) return false;

      const targetDefId = effect.targetDefId;
      if (!targetDefId) return false;

      slot.env = makeEnvInstance(targetDefId, state);
      return true;
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
      if (context.kind !== "game") return false;
      const key = effect.resource;
      const amt = effect.amount ?? 0;
      if (!key || typeof amt !== "number") return false;

      state.resources[key] = (state.resources[key] ?? 0) + amt;
      return true;
    }

    // ================= ENV PROP OPS =================

    case "AddEnvProp": {
      if (context.kind !== "env") return false;
      const { slot, seasonData } = context;
      if (!slot || !slot.env) return false;

      const prop = effect.prop;
      const amt = effect.amount ?? 0;
      if (!prop || typeof amt !== "number") return false;

      const env = slot.env;
      env.props[prop] = (env.props[prop] ?? 0) + amt;

      if (typeof effect.min === "number" && env.props[prop] < effect.min) {
        env.props[prop] = effect.min;
      }
      if (typeof effect.max === "number" && env.props[prop] > effect.max) {
        env.props[prop] = effect.max;
      }

      if (effect.killIfZero && env.props[prop] <= 0) {
        runEffect(state, { op: "KillEnv" }, { kind: "env", slot, seasonData });
      }

      return true;
    }

    // ================= GENERIC PROP OPS =================

    case "SetProp": {
      const prop = effect.prop;
      const value = effect.value;
      if (!prop || typeof value !== "number") return false;

      if (context.kind === "env") {
        const { slot, seasonData } = context;
        if (!slot || !slot.env) return false;

        const env = slot.env;
        env.props[prop] = value;

        if (typeof effect.min === "number" && env.props[prop] < effect.min) {
          env.props[prop] = effect.min;
        }
        if (typeof effect.max === "number" && env.props[prop] > effect.max) {
          env.props[prop] = effect.max;
        }

        if (effect.killIfZero && env.props[prop] <= 0) {
          runEffect(
            state,
            { op: "KillEnv" },
            { kind: "env", slot, seasonData }
          );
        }

        return true;
      }

      if (context.kind === "game" && effect.targetKind === "permanent") {
        const slotIndex = effect.slotIndex;
        if (typeof slotIndex !== "number") return false;

        const slot = state.permanentSlots?.[slotIndex];
        const perm = slot?.permanent;
        if (!perm) return false;

        perm.props[prop] = value;

        if (typeof effect.min === "number" && perm.props[prop] < effect.min) {
          perm.props[prop] = effect.min;
        }
        if (typeof effect.max === "number" && perm.props[prop] > effect.max) {
          perm.props[prop] = effect.max;
        }

        return true;
      }

      return false;
    }

    case "AddProp": {
      const prop = effect.prop;
      const amt = effect.amount ?? 0;
      if (!prop || typeof amt !== "number") return false;

      if (context.kind === "env") {
        const { slot, seasonData } = context;
        if (!slot || !slot.env) return false;

        const env = slot.env;
        env.props[prop] = (env.props[prop] ?? 0) + amt;

        if (typeof effect.min === "number" && env.props[prop] < effect.min) {
          env.props[prop] = effect.min;
        }
        if (typeof effect.max === "number" && env.props[prop] > effect.max) {
          env.props[prop] = effect.max;
        }

        if (effect.killIfZero && env.props[prop] <= 0) {
          runEffect(
            state,
            { op: "KillEnv" },
            { kind: "env", slot, seasonData }
          );
        }

        return true;
      }

      if (context.kind === "game" && effect.targetKind === "permanent") {
        const slotIndex = effect.slotIndex;
        if (typeof slotIndex !== "number") return false;

        const slot = state.permanentSlots?.[slotIndex];
        const perm = slot?.permanent;
        if (!perm) return false;

        perm.props[prop] = (perm.props[prop] ?? 0) + amt;

        if (typeof effect.min === "number" && perm.props[prop] < effect.min) {
          perm.props[prop] = effect.min;
        }
        if (typeof effect.max === "number" && perm.props[prop] > effect.max) {
          perm.props[prop] = effect.max;
        }

        return true;
      }

      return false;
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
    seasonsToExpire: item.seasonsToExpire ?? null,
  };

  let placed = false;
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
// Existing season-end + expiry hooks
// =============================================================================

export function applySeasonEndForEnvCard(state, slot, seasonData) {
  const env = slot.env;
  if (!env) return;

  const def = envCardDefs[env.defId];
  const rule = normalizeEffectSpec(def.seasonEnd) || { op: "KillEnv" };

  runEffect(state, rule, { kind: "env", slot, seasonData });
}

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

function handleItemSeasonExpiry(state, inv, item) {
  const def = itemDefs[item.kind];
  if (!def || !def.seasonExpiry) return;

  runEffect(state, def.seasonExpiry, { kind: "itemSeasonExpiry", inv, item });
}
