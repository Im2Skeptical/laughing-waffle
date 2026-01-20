// effects.js — EffectOp interpreter + seasonEnd + item expiry + inventory ops

import { envCardDefs, itemDefs } from "../defs/gamepieces/gamepieces-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../defs/gamesystems/env-systems-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
} from "./inventory-model.js";
import { makeEnvInstance } from "./state.js";

const SYSTEM_TIER_LADDER = ["bronze", "silver", "gold", "diamond"];

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

  if (targetSpec.at && typeof targetSpec.at === "object") {
    const layer = targetSpec.at.layer;
    const col = targetSpec.at.col;
    if (!layer || !Number.isFinite(col)) return [];
    const occ = state.board?.occ?.[layer];
    if (!Array.isArray(occ)) return [];
    const idx = Math.floor(col);
    const target = occ[idx];
    return target ? [target] : [];
  }

  if (targetSpec.ref === "self") {
    const layer = targetSpec.layer;
    const source = context?.source;
    if (!layer || !source) return [];
    const occ = state.board?.occ?.[layer];
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
      const key = effect.resource;
      const amt = effect.amount ?? 0;
      if (!key || typeof amt !== "number") return false;

      state.resources[key] = (state.resources[key] ?? 0) + amt;
      return true;
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

        for (const systemId of systems) {
          if (target.systemTiers[systemId] != null) continue;
          const sysDef = envSystemDefs[systemId];
          if (!sysDef) continue;
          if (sysDef.defaultTier != null) {
            target.systemTiers[systemId] = sysDef.defaultTier;
          }
        }
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

