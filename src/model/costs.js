// costs.js
// Shared cost resolution and application for pawn/env intents.

import { Inventory } from "./inventory-model.js";
import { bumpInvVersion } from "./effects/core/inventory-version.js";
import { TIER_ASC, getTierRank } from "./effects/core/tiers.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { PAWN_AI_STAMINA_WARNING } from "../defs/gamesettings/gamerules-defs.js";
import { pushGameEvent } from "./event-feed.js";
import { computePawnSkillMods } from "./skills.js";

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

function isTierBucket(pool) {
  if (!pool || typeof pool !== "object") return false;
  for (const tier of TIER_ASC) {
    if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
  }
  return false;
}

function getInventoryForRef(ctx, ref) {
  if (!ref || typeof ref !== "string") return ctx?.pawnInv ?? null;
  if (ref === "pawnInv") return ctx?.pawnInv ?? null;
  if (ref === "ownerInv") return ctx?.ownerInv ?? null;
  if (ref === "sourceInv") return ctx?.sourceInv ?? ctx?.ownerInv ?? null;
  return null;
}

function getSystemTargetForRef(ctx, ref) {
  if (!ref || typeof ref !== "string") return ctx?.pawn ?? null;
  if (ref === "pawn") return ctx?.pawn ?? null;
  if (ref === "owner") return ctx?.owner ?? null;
  if (ref === "source") return ctx?.source ?? null;
  return null;
}

function getResourcesForRef(ctx, ref) {
  if (!ref || typeof ref !== "string") {
    return ctx?.resources ?? ctx?.state?.resources ?? null;
  }
  if (ref === "stateResources" || ref === "resources") {
    return ctx?.resources ?? ctx?.state?.resources ?? null;
  }
  return null;
}

function getDistributorPools(ctx) {
  return Array.isArray(ctx?.distributorPools) ? ctx.distributorPools : [];
}

function getLocalInventories(ctx) {
  const raw = Array.isArray(ctx?.localInventories) ? ctx.localInventories : [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    if (!entry.inv || !Array.isArray(entry.inv.items)) continue;
    out.push(entry);
  }
  out.sort((a, b) => {
    const ao = Number.isFinite(a?.ownerId) ? Math.floor(a.ownerId) : 0;
    const bo = Number.isFinite(b?.ownerId) ? Math.floor(b.ownerId) : 0;
    return ao - bo;
  });
  return out;
}

function itemHasTag(kind, tag) {
  if (!kind || !tag) return false;
  const tags = Array.isArray(itemDefs?.[kind]?.baseTags)
    ? itemDefs[kind].baseTags
    : [];
  return tags.includes(tag);
}

function getPawnLabel(target, fallbackPawn) {
  const pawn = target ?? fallbackPawn ?? null;
  if (!pawn) return "Pawn";
  return pawn.name || `Pawn ${pawn.id ?? ""}`.trim();
}

function isPawnLikeTarget(target, fallbackPawn) {
  const pawn = target ?? fallbackPawn ?? null;
  if (!pawn || typeof pawn !== "object") return false;
  return (
    typeof pawn.pawnDefId === "string" ||
    pawn.role === "leader" ||
    pawn.role === "follower"
  );
}

function applySkillCostModifiers(baseAmount, charge, ctx) {
  if (!Number.isFinite(baseAmount)) return baseAmount;
  if (charge?.kind !== "system") return baseAmount;
  if (charge.system !== "stamina" || charge.key !== "cur") return baseAmount;

  const pawnId = Number.isFinite(ctx?.pawn?.id) ? Math.floor(ctx.pawn.id) : null;
  if (pawnId == null || !ctx?.state) return baseAmount;

  const intentId =
    typeof ctx?.intentId === "string" && ctx.intentId.length > 0
      ? ctx.intentId
      : null;
  if (!intentId) return baseAmount;

  const skillMods = computePawnSkillMods(ctx.state, pawnId);
  let delta = 0;
  if (intentId === "forage") {
    delta += Number.isFinite(skillMods?.forageStaminaCostDelta)
      ? Math.floor(skillMods.forageStaminaCostDelta)
      : 0;
  }
  if (intentId === "farmHarvest" || intentId === "farmPlant") {
    delta += Number.isFinite(skillMods?.farmingStaminaCostDelta)
      ? Math.floor(skillMods.farmingStaminaCostDelta)
      : 0;
  }

  const modified = Math.floor(baseAmount + delta);
  return Math.max(0, modified);
}

function countPoolUnitsByItem(pools, itemId) {
  let total = 0;
  for (const source of pools) {
    const pool = source?.pool;
    if (!pool || typeof pool !== "object") continue;
    if (isTierBucket(pool)) {
      if (source?.itemKind && source.itemKind !== itemId) continue;
      for (const tier of TIER_ASC) {
        total += Math.max(0, Math.floor(pool[tier] ?? 0));
      }
      continue;
    }
    const bucket = pool[itemId];
    if (!bucket || typeof bucket !== "object") continue;
    for (const tier of TIER_ASC) {
      total += Math.max(0, Math.floor(bucket[tier] ?? 0));
    }
  }
  return total;
}

function countPoolUnitsByTag(pools, tag) {
  let total = 0;
  for (const source of pools) {
    const pool = source?.pool;
    if (!pool || typeof pool !== "object") continue;
    if (isTierBucket(pool)) {
      if (!source?.itemKind || !itemHasTag(source.itemKind, tag)) continue;
      for (const tier of TIER_ASC) {
        total += Math.max(0, Math.floor(pool[tier] ?? 0));
      }
      continue;
    }
    const kinds = Object.keys(pool).sort((a, b) => a.localeCompare(b));
    for (const kind of kinds) {
      if (!itemHasTag(kind, tag)) continue;
      const bucket = pool[kind];
      if (!bucket || typeof bucket !== "object") continue;
      for (const tier of TIER_ASC) {
        total += Math.max(0, Math.floor(bucket[tier] ?? 0));
      }
    }
  }
  return total;
}

function consumeFromPoolByItem(pools, itemId, amount) {
  let remaining = Math.max(0, Math.floor(amount ?? 0));
  if (remaining <= 0) return 0;

  let consumed = 0;
  for (const source of pools) {
    if (remaining <= 0) break;
    const pool = source?.pool;
    if (!pool || typeof pool !== "object") continue;
    if (isTierBucket(pool)) {
      if (source?.itemKind && source.itemKind !== itemId) continue;
      for (const tier of TIER_ASC) {
        if (remaining <= 0) break;
        const qty = Math.max(0, Math.floor(pool[tier] ?? 0));
        if (qty <= 0) continue;
        const take = Math.min(qty, remaining);
        pool[tier] = qty - take;
        if (source?.totalByTier) {
          const total = Math.max(0, Math.floor(source.totalByTier[tier] ?? 0));
          source.totalByTier[tier] = Math.max(0, total - take);
        }
        consumed += take;
        remaining -= take;
      }
      continue;
    }
    const bucket = pool[itemId];
    if (!bucket || typeof bucket !== "object") continue;
    for (const tier of TIER_ASC) {
      if (remaining <= 0) break;
      const qty = Math.max(0, Math.floor(bucket[tier] ?? 0));
      if (qty <= 0) continue;
      const take = Math.min(qty, remaining);
      bucket[tier] = qty - take;
      if (source?.totalByTier) {
        const total = Math.max(0, Math.floor(source.totalByTier[tier] ?? 0));
        source.totalByTier[tier] = Math.max(0, total - take);
      }
      consumed += take;
      remaining -= take;
    }
  }

  return consumed;
}

function consumeFromPoolByTag(pools, tag, amount) {
  let remaining = Math.max(0, Math.floor(amount ?? 0));
  if (remaining <= 0) return 0;

  let consumed = 0;
  for (const source of pools) {
    if (remaining <= 0) break;
    const pool = source?.pool;
    if (!pool || typeof pool !== "object") continue;
    if (isTierBucket(pool)) {
      if (!source?.itemKind || !itemHasTag(source.itemKind, tag)) continue;
      for (const tier of TIER_ASC) {
        if (remaining <= 0) break;
        const qty = Math.max(0, Math.floor(pool[tier] ?? 0));
        if (qty <= 0) continue;
        const take = Math.min(qty, remaining);
        pool[tier] = qty - take;
        if (source?.totalByTier) {
          const total = Math.max(0, Math.floor(source.totalByTier[tier] ?? 0));
          source.totalByTier[tier] = Math.max(0, total - take);
        }
        consumed += take;
        remaining -= take;
      }
      continue;
    }
    const kinds = Object.keys(pool).sort((a, b) => a.localeCompare(b));
    for (const kind of kinds) {
      if (remaining <= 0) break;
      if (!itemHasTag(kind, tag)) continue;
      const bucket = pool[kind];
      if (!bucket || typeof bucket !== "object") continue;
      for (const tier of TIER_ASC) {
        if (remaining <= 0) break;
        const qty = Math.max(0, Math.floor(bucket[tier] ?? 0));
        if (qty <= 0) continue;
        const take = Math.min(qty, remaining);
        bucket[tier] = qty - take;
        if (source?.totalByTier) {
          const total = Math.max(0, Math.floor(source.totalByTier[tier] ?? 0));
          source.totalByTier[tier] = Math.max(0, total - take);
        }
        consumed += take;
        remaining -= take;
      }
    }
  }

  return consumed;
}

export function resolveCosts(costSpec, ctx) {
  if (!costSpec || typeof costSpec !== "object") return null;

  const rawCharges = Array.isArray(costSpec.charges) ? costSpec.charges : [];
  const charges = [];

  for (const charge of rawCharges) {
    if (!charge || typeof charge !== "object") return null;
    if (charge.kind === "system") {
      const system = charge.system;
      const key = charge.key;
      if (!system || typeof system !== "string") return null;
      if (!key || typeof key !== "string") return null;
      const targetRef = charge.target?.ref || "pawn";
      const target = getSystemTargetForRef(ctx, targetRef);
      if (!target) return null;
      const amountRaw = resolveAmountExpr(charge.amount, ctx);
      if (!Number.isFinite(amountRaw) || amountRaw < 0) return null;
      const amount = applySkillCostModifiers(amountRaw, charge, ctx);
      const clampMin = Number.isFinite(charge.clampMin) ? charge.clampMin : 0;
      charges.push({
        kind: "system",
        targetRef,
        system,
        key,
        amount,
        clampMin,
      });
    } else if (
      charge.kind === "item" ||
      charge.kind === "requireItem" ||
      charge.kind === "tag" ||
      charge.kind === "requireTag"
    ) {
      const targetRef = charge.target?.ref || "pawnInv";
      const inv = getInventoryForRef(ctx, targetRef);
      if (!inv) return null;
      const itemId = resolveItemIdExpr(charge.itemId, ctx);
      const tag =
        typeof charge.tag === "string" && charge.tag.length
          ? charge.tag
          : typeof charge.itemTag === "string" && charge.itemTag.length
            ? charge.itemTag
            : null;
      if ((charge.kind === "item" || charge.kind === "requireItem") && !itemId) {
        return null;
      }
      if ((charge.kind === "tag" || charge.kind === "requireTag") && !tag) {
        return null;
      }
      const amountRaw = resolveAmountExpr(charge.amount, ctx);
      if (!Number.isFinite(amountRaw) || amountRaw < 0) return null;
      const amount = Math.floor(amountRaw);
      const allowDistributorPools = charge.allowDistributorPools === true;
      charges.push({
        kind: charge.kind,
        targetRef,
        itemId,
        tag,
        amount,
        allowDistributorPools,
      });
    } else if (charge.kind === "resource" || charge.kind === "requireResource") {
      const targetRef = charge.target?.ref || "stateResources";
      const resources = getResourcesForRef(ctx, targetRef);
      if (!resources) return null;
      const resource =
        typeof charge.resource === "string" && charge.resource.length
          ? charge.resource
          : null;
      if (!resource) return null;
      const amountRaw = resolveAmountExpr(charge.amount, ctx);
      if (!Number.isFinite(amountRaw) || amountRaw < 0) return null;
      const amount = Math.floor(amountRaw);
      charges.push({
        kind: charge.kind,
        targetRef,
        resource,
        amount,
      });
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

function countItemUnitsByTag(inv, tag) {
  if (!inv || !Array.isArray(inv.items)) return 0;
  let total = 0;
  for (const item of inv.items) {
    if (!item || !Array.isArray(item.tags)) continue;
    if (!item.tags.includes(tag)) continue;
    total += Math.max(0, Math.floor(item.quantity ?? 0));
  }
  return total;
}

function countLocalInventoryUnitsByItem(localInventories, itemId) {
  let total = 0;
  for (const entry of localInventories) {
    total += countItemUnits(entry?.inv, itemId);
  }
  return total;
}

function countLocalInventoryUnitsByTag(localInventories, tag) {
  let total = 0;
  for (const entry of localInventories) {
    total += countItemUnitsByTag(entry?.inv, tag);
  }
  return total;
}

function consumeFromLocalInventoriesByItem(localInventories, itemId, amount) {
  let remaining = Math.max(0, Math.floor(amount ?? 0));
  if (remaining <= 0) return 0;
  let consumed = 0;
  for (const entry of localInventories) {
    if (remaining <= 0) break;
    const inv = entry?.inv;
    const take = consumeFromInventoryForCost(inv, itemId, remaining);
    if (take <= 0) continue;
    consumed += take;
    remaining -= take;
  }
  return consumed;
}

function consumeFromLocalInventoriesByTag(localInventories, tag, amount) {
  let remaining = Math.max(0, Math.floor(amount ?? 0));
  if (remaining <= 0) return 0;
  let consumed = 0;
  for (const entry of localInventories) {
    if (remaining <= 0) break;
    const inv = entry?.inv;
    const take = consumeFromInventoryForTag(inv, tag, remaining);
    if (take <= 0) continue;
    consumed += take;
    remaining -= take;
  }
  return consumed;
}

export function canAffordCosts(resolvedCosts, ctx) {
  const charges = Array.isArray(resolvedCosts?.charges)
    ? resolvedCosts.charges
    : [];

  for (const charge of charges) {
    if (charge.kind === "system") {
      const target = getSystemTargetForRef(ctx, charge.targetRef);
      if (!target) return false;
      const value = target.systemState?.[charge.system]?.[charge.key];
      if (!Number.isFinite(value) || value < charge.amount) return false;
    } else if (
      charge.kind === "item" ||
      charge.kind === "requireItem" ||
      charge.kind === "tag" ||
      charge.kind === "requireTag"
    ) {
      const inv = getInventoryForRef(ctx, charge.targetRef);
      if (!inv) return false;
      if (charge.amount <= 0) continue;
      if (charge.kind === "item" || charge.kind === "requireItem") {
        const total = countItemUnits(inv, charge.itemId);
        if (total < charge.amount) {
          if (!charge.allowDistributorPools) return false;
          const localInventories = getLocalInventories(ctx);
          const localTotal = countLocalInventoryUnitsByItem(
            localInventories,
            charge.itemId
          );
          const pools = getDistributorPools(ctx);
          const poolTotal = countPoolUnitsByItem(pools, charge.itemId);
          if (total + localTotal + poolTotal < charge.amount) return false;
        }
      } else {
        const total = countItemUnitsByTag(inv, charge.tag);
        if (total < charge.amount) {
          if (!charge.allowDistributorPools) return false;
          const localInventories = getLocalInventories(ctx);
          const localTotal = countLocalInventoryUnitsByTag(
            localInventories,
            charge.tag
          );
          const pools = getDistributorPools(ctx);
          const poolTotal = countPoolUnitsByTag(pools, charge.tag);
          if (total + localTotal + poolTotal < charge.amount) return false;
        }
      }
    } else if (
      charge.kind === "resource" ||
      charge.kind === "requireResource"
    ) {
      const resources = getResourcesForRef(ctx, charge.targetRef);
      if (!resources) return false;
      if (charge.amount <= 0) continue;
      const available = Number.isFinite(resources?.[charge.resource])
        ? Math.max(0, Math.floor(resources[charge.resource]))
        : 0;
      if (available < charge.amount) return false;
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

function consumeFromInventoryForTag(inv, tag, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!inv || !Array.isArray(inv.items)) return 0;

  const candidates = inv.items.filter((it) => {
    if (!it || !Array.isArray(it.tags)) return false;
    if (!it.tags.includes(tag)) return false;
    return Math.floor(it.quantity ?? 0) > 0;
  });
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

  for (const charge of charges) {
    if (charge.kind === "system") {
      const target = getSystemTargetForRef(ctx, charge.targetRef);
      if (!target) continue;
      const systemState = target.systemState?.[charge.system];
      if (!systemState || typeof systemState !== "object") continue;
      const current = Number.isFinite(systemState[charge.key])
        ? systemState[charge.key]
        : 0;
      const next = Math.max(charge.clampMin ?? 0, current - charge.amount);
      if (next !== current) systemState[charge.key] = next;
      if (
        next !== current &&
        charge.system === "stamina" &&
        charge.key === "cur" &&
        isPawnLikeTarget(target, ctx?.pawn)
      ) {
        const max = Number.isFinite(systemState?.max)
          ? Math.max(0, Math.floor(systemState.max))
          : 100;
        const threshold = Math.max(
          0,
          Math.min(max, Math.floor(PAWN_AI_STAMINA_WARNING ?? 0))
        );
        if (current > threshold && next <= threshold) {
          const nowSec = Number.isFinite(ctx?.tSec)
            ? Math.floor(ctx.tSec)
            : Math.floor(ctx?.state?.tSec ?? 0);
          pushGameEvent(ctx?.state ?? null, {
            type: "pawnTired",
            tSec: nowSec,
            text: `${getPawnLabel(target, ctx?.pawn)} is tired`,
            data: {
              focusKind: "pawn",
              pawnId: Number.isFinite(target?.id) ? target.id : ctx?.pawn?.id ?? null,
              ownerIds:
                Number.isFinite(target?.id) || Number.isFinite(ctx?.pawn?.id)
                  ? [Number.isFinite(target?.id) ? target.id : ctx.pawn.id]
                  : [],
              value: Math.floor(next),
              threshold,
            },
          });
        }
      }
    } else if (charge.kind === "item") {
      const inv = getInventoryForRef(ctx, charge.targetRef);
      if (!inv) continue;
      if (charge.amount <= 0) continue;
      let remaining = charge.amount;
      remaining -= consumeFromInventoryForCost(inv, charge.itemId, remaining);
      if (remaining > 0 && charge.allowDistributorPools) {
        const localInventories = getLocalInventories(ctx);
        remaining -= consumeFromLocalInventoriesByItem(
          localInventories,
          charge.itemId,
          remaining
        );
      }
      if (remaining > 0 && charge.allowDistributorPools) {
        const pools = getDistributorPools(ctx);
        consumeFromPoolByItem(pools, charge.itemId, remaining);
      }
    } else if (charge.kind === "tag") {
      const inv = getInventoryForRef(ctx, charge.targetRef);
      if (!inv) continue;
      if (charge.amount <= 0) continue;
      let remaining = charge.amount;
      remaining -= consumeFromInventoryForTag(inv, charge.tag, remaining);
      if (remaining > 0 && charge.allowDistributorPools) {
        const localInventories = getLocalInventories(ctx);
        remaining -= consumeFromLocalInventoriesByTag(
          localInventories,
          charge.tag,
          remaining
        );
      }
      if (remaining > 0 && charge.allowDistributorPools) {
        const pools = getDistributorPools(ctx);
        consumeFromPoolByTag(pools, charge.tag, remaining);
      }
    } else if (charge.kind === "resource") {
      const resources = getResourcesForRef(ctx, charge.targetRef);
      if (!resources) continue;
      if (charge.amount <= 0) continue;
      const available = Number.isFinite(resources?.[charge.resource])
        ? Math.max(0, Math.floor(resources[charge.resource]))
        : 0;
      const take = Math.min(available, Math.floor(charge.amount));
      resources[charge.resource] = available - take;
    } else if (
      charge.kind === "requireItem" ||
      charge.kind === "requireTag" ||
      charge.kind === "requireResource"
    ) {
      // requirement only; no consumption
    }
  }
}
