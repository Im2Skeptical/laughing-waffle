// costs.js
// Shared cost resolution and application for pawn/env intents.

import { Inventory } from "./inventory-model.js";
import { bumpInvVersion } from "./effects/core/inventory-version.js";
import { TIER_ASC, getTierRank } from "./effects/core/tiers.js";

function resolveAmountExpr(expr, ctx) {
  if (Number.isFinite(expr)) return expr;
  if (!expr || typeof expr !== "object") return null;
  if (Number.isFinite(expr.const)) return expr.const;
  if (expr.var === "selectedCropId") {
    const key = ctx?.selectedCropId;
    const map = expr.map && typeof expr.map === "object" ? expr.map : null;
    if (key != null && map && Object.prototype.hasOwnProperty.call(map, key)) {
      return map[key];
    }
    if (Number.isFinite(expr.default)) return expr.default;
    return null;
  }
  return null;
}

function resolveItemIdExpr(expr, ctx) {
  if (typeof expr === "string") return expr;
  if (!expr || typeof expr !== "object") return null;
  if (expr.var === "selectedCropId") {
    const key = ctx?.selectedCropId;
    const map = expr.map && typeof expr.map === "object" ? expr.map : null;
    let value = null;
    if (key != null && map && Object.prototype.hasOwnProperty.call(map, key)) {
      value = map[key];
    } else {
      value = expr.default;
    }
    if (typeof value !== "string" || value.length === 0) return null;
    return value;
  }
  return null;
}

export function resolveCosts(costSpec, ctx) {
  if (!costSpec || typeof costSpec !== "object") return null;
  const pawnId = ctx?.pawnId;
  if (pawnId == null || !ctx?.pawn || !ctx?.pawnInv) return null;

  const rawCharges = Array.isArray(costSpec.charges) ? costSpec.charges : [];
  const charges = [];

  for (const charge of rawCharges) {
    if (!charge || typeof charge !== "object") return null;
    if (charge.kind === "system") {
      if (charge.target?.ref !== "pawn") return null;
      const system = charge.system;
      const key = charge.key;
      if (!system || typeof system !== "string") return null;
      if (!key || typeof key !== "string") return null;
      const amountRaw = resolveAmountExpr(charge.amount, ctx);
      if (!Number.isFinite(amountRaw) || amountRaw < 0) return null;
      const clampMin = Number.isFinite(charge.clampMin) ? charge.clampMin : 0;
      charges.push({
        kind: "system",
        pawnId,
        system,
        key,
        amount: amountRaw,
        clampMin,
      });
    } else if (charge.kind === "item" || charge.kind === "requireItem") {
      if (charge.target?.ref !== "pawnInv") return null;
      const itemId = resolveItemIdExpr(charge.itemId, ctx);
      if (!itemId) return null;
      const amountRaw = resolveAmountExpr(charge.amount, ctx);
      if (!Number.isFinite(amountRaw) || amountRaw < 0) return null;
      const amount = Math.floor(amountRaw);
      charges.push({ kind: charge.kind, pawnId, itemId, amount });
    } else {
      return null;
    }
  }

  return { charges };
}

function countItemUnits(inv, itemId) {
  if (!inv || !Array.isArray(inv.items)) return 0;
  let total = 0;
  for (const item of inv.items) {
    if (!item || item.kind !== itemId) continue;
    total += Math.max(0, Math.floor(item.quantity ?? 0));
  }
  return total;
}

export function canAffordCosts(resolvedCosts, ctx) {
  const charges = Array.isArray(resolvedCosts?.charges)
    ? resolvedCosts.charges
    : [];
  const pawn = ctx?.pawn;
  const pawnInv = ctx?.pawnInv;
  if (!pawn || !pawnInv) return false;

  for (const charge of charges) {
    if (charge.kind === "system") {
      const value = pawn.systemState?.[charge.system]?.[charge.key];
      if (!Number.isFinite(value) || value < charge.amount) return false;
    } else if (charge.kind === "item" || charge.kind === "requireItem") {
      if (charge.amount <= 0) continue;
      const total = countItemUnits(pawnInv, charge.itemId);
      if (total < charge.amount) return false;
    } else {
      return false;
    }
  }

  return true;
}

function sortItemsForCost(items) {
  return items.sort((a, b) => {
    const tierA = a?.tier ?? "bronze";
    const tierB = b?.tier ?? "bronze";
    const rankA = getTierRank(tierA, TIER_ASC);
    const rankB = getTierRank(tierB, TIER_ASC);
    if (rankA !== rankB) return rankA - rankB;
    return (a?.id ?? 0) - (b?.id ?? 0);
  });
}

function consumeFromInventoryForCost(inv, itemId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!inv || !Array.isArray(inv.items)) return 0;

  const candidates = inv.items.filter(
    (it) => it && it.kind === itemId && Math.floor(it.quantity ?? 0) > 0
  );
  if (!candidates.length) return 0;

  sortItemsForCost(candidates);

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

export function applyCosts(resolvedCosts, ctx) {
  const charges = Array.isArray(resolvedCosts?.charges)
    ? resolvedCosts.charges
    : [];
  const pawn = ctx?.pawn;
  const pawnInv = ctx?.pawnInv;
  if (!pawn || !pawnInv) return;

  for (const charge of charges) {
    if (charge.kind === "system") {
      const systemState = pawn.systemState?.[charge.system];
      if (!systemState || typeof systemState !== "object") continue;
      const current = Number.isFinite(systemState[charge.key])
        ? systemState[charge.key]
        : 0;
      const next = Math.max(charge.clampMin ?? 0, current - charge.amount);
      if (next !== current) systemState[charge.key] = next;
    } else if (charge.kind === "item") {
      if (charge.amount <= 0) continue;
      consumeFromInventoryForCost(pawnInv, charge.itemId, charge.amount);
    } else if (charge.kind === "requireItem") {
      // requirement only; no consumption
    }
  }
}
