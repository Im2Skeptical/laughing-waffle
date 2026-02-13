import { hubStructureDefs } from "../../../../defs/gamepieces/hub-structure-defs.js";
import { itemDefs } from "../../../../defs/gamepieces/item-defs.js";
import { TIER_ASC } from "../../core/tiers.js";
import { resolveEffectTargets } from "./targets.js";

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

function isTierBucket(pool) {
  if (!pool || typeof pool !== "object") return false;
  for (const tier of TIER_ASC) {
    if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
  }
  return false;
}

function normalizeTierBonus(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function applyTierBonus(tier, bonus) {
  const baseIdx = TIER_ASC.indexOf(tier);
  const idx = baseIdx >= 0 ? baseIdx : 0;
  const nextIdx = Math.max(0, Math.min(TIER_ASC.length - 1, idx + bonus));
  return TIER_ASC[nextIdx] || "bronze";
}

function itemHasTag(kind, tag) {
  if (!kind || !tag) return false;
  const tags = Array.isArray(itemDefs?.[kind]?.baseTags)
    ? itemDefs[kind].baseTags
    : [];
  return tags.includes(tag);
}

function ensureTierBucket(container, itemId = null) {
  const bucket = itemId ? container[itemId] : container;
  if (!bucket || typeof bucket !== "object") {
    const next = {};
    for (const tier of TIER_ASC) next[tier] = 0;
    if (itemId) {
      container[itemId] = next;
      return next;
    }
    return next;
  }
  for (const tier of TIER_ASC) {
    if (!Number.isFinite(bucket[tier])) bucket[tier] = 0;
  }
  return bucket;
}

export function handleExpireStoredPerishables(state, effect, context) {
  const targets = resolveEffectTargets(state, effect, context);
  if (!targets.length) return false;

  const baseChance =
    Number.isFinite(effect.chance) ? effect.chance : null;
  if (!Number.isFinite(baseChance) || baseChance <= 0) return false;

  const perishableTag =
    typeof effect.perishableTag === "string" ? effect.perishableTag : "perishable";
  const rotPoolKey =
    typeof effect.rotPoolKey === "string" ? effect.rotPoolKey : "rotByKindTier";
  const rotKind =
    typeof effect.rotKind === "string" ? effect.rotKind : "rot";
  const bonusProp =
    typeof effect.preserveTierBonusProp === "string"
      ? effect.preserveTierBonusProp
      : "perishabilityTierBonus";
  const preserveTag =
    typeof effect.preserveTag === "string" ? effect.preserveTag : null;
  const multiplierMap =
    effect.tierMultiplierByTier &&
    typeof effect.tierMultiplierByTier === "object"
      ? effect.tierMultiplierByTier
      : effect.multiplierByTier && typeof effect.multiplierByTier === "object"
        ? effect.multiplierByTier
        : null;

  let changed = false;

  for (const target of targets) {
    if (!target) continue;
    const def = hubStructureDefs?.[target.defId];
    const deposit = def?.deposit;
    if (!deposit || typeof deposit !== "object") continue;

    const systemId =
      typeof deposit.systemId === "string" ? deposit.systemId : null;
    if (!systemId) continue;
    const poolKey =
      typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
        ? deposit.poolKey
        : "byKindTier";

    const systemState = target.systemState?.[systemId];
    if (!systemState || typeof systemState !== "object") continue;
    const pool = systemState[poolKey];
    if (!pool || typeof pool !== "object") continue;

    if (!systemState[rotPoolKey] || typeof systemState[rotPoolKey] !== "object") {
      systemState[rotPoolKey] = {};
    }
    const rotPool = systemState[rotPoolKey];
    const totals =
      systemState.totalByTier && typeof systemState.totalByTier === "object"
        ? systemState.totalByTier
        : null;

    let tierBonus = normalizeTierBonus(target?.props?.[bonusProp]);
    if (preserveTag) {
      const tags = Array.isArray(target.tags) ? target.tags : [];
      const hasPreserve =
        tags.includes(preserveTag) &&
        target?.tagStates?.[preserveTag]?.disabled !== true;
      if (!hasPreserve) {
        tierBonus = 0;
      } else if (!Number.isFinite(target?.props?.[bonusProp])) {
        tierBonus = 1;
      }
    }
    const isBucket = isTierBucket(pool);

    if (isBucket) {
      const kind =
        typeof effect.itemKind === "string"
          ? effect.itemKind
          : typeof effect.itemId === "string"
            ? effect.itemId
            : null;
      if (!kind || !itemHasTag(kind, perishableTag)) continue;

      const rotBucket = ensureTierBucket(rotPool);
      for (const tier of TIER_ASC) {
        const qty = Math.max(0, Math.floor(pool[tier] ?? 0));
        if (qty <= 0) continue;
        const effectiveTier = applyTierBonus(tier, tierBonus);
        const mult = Number.isFinite(multiplierMap?.[effectiveTier])
          ? multiplierMap[effectiveTier]
          : 1;
        const chance = baseChance * mult;
        const expired = sampleBinomial(state, qty, chance);
        if (expired <= 0) continue;
        pool[tier] = qty - expired;
        if (totals) {
          const total = Math.max(0, Math.floor(totals[tier] ?? 0));
          totals[tier] = Math.max(0, total - expired);
        }
        rotBucket[tier] = Math.max(0, Math.floor(rotBucket[tier] ?? 0)) + expired;
        changed = true;
      }
      continue;
    }

    const kinds = Object.keys(pool).sort((a, b) => a.localeCompare(b));
    for (const kind of kinds) {
      if (!itemHasTag(kind, perishableTag)) continue;
      const bucket = pool[kind];
      if (!bucket || typeof bucket !== "object") continue;
      const rotBucket = ensureTierBucket(rotPool, rotKind);
      for (const tier of TIER_ASC) {
        const qty = Math.max(0, Math.floor(bucket[tier] ?? 0));
        if (qty <= 0) continue;
        const effectiveTier = applyTierBonus(tier, tierBonus);
        const mult = Number.isFinite(multiplierMap?.[effectiveTier])
          ? multiplierMap[effectiveTier]
          : 1;
        const chance = baseChance * mult;
        const expired = sampleBinomial(state, qty, chance);
        if (expired <= 0) continue;
        bucket[tier] = qty - expired;
        if (totals) {
          const total = Math.max(0, Math.floor(totals[tier] ?? 0));
          totals[tier] = Math.max(0, total - expired);
        }
        rotBucket[tier] = Math.max(0, Math.floor(rotBucket[tier] ?? 0)) + expired;
        changed = true;
      }
    }
  }

  return changed;
}
