// farming.js
// Deterministic per-second farming loop for crop growth.

import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { envSystemDefs } from "../defs/gamesystems/env-systems-defs.js";
import { itemDefs } from "../defs/gamepieces/gamepieces-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
} from "./inventory-model.js";

const TIER_ASC = ["bronze", "silver", "gold", "diamond"];
const TIER_DESC = ["diamond", "gold", "silver", "bronze"];

const HYDRATION_CURVE = {
  bronze: { A: 0.85, P: 1.8 },
  silver: { A: 1.0, P: 1.45 },
  gold: { A: 1.1, P: 1.2 },
  diamond: { A: 1.2, P: 1.05 },
};

const DEFAULT_MATURED_POOL = {
  bronze: 0,
  silver: 0,
  gold: 0,
  diamond: 0,
};

function ensureTileSystemState(tile) {
  if (!tile.systemState || typeof tile.systemState !== "object") {
    tile.systemState = {};
  }
  return tile.systemState;
}

function ensureHydrationState(tile) {
  const systemState = ensureTileSystemState(tile);
  if (!systemState.hydration || typeof systemState.hydration !== "object") {
    systemState.hydration = {
      cur: 100,
      max: 100,
      decayPerSec: 2,
      sumRatio: 0,
    };
  }
  return systemState.hydration;
}

function ensureGrowthState(tile) {
  const systemState = ensureTileSystemState(tile);
  if (!systemState.growth || typeof systemState.growth !== "object") {
    systemState.growth = {
      selectedCropId: null,
      plantedBatches: [],
      maturedPool: { ...DEFAULT_MATURED_POOL },
    };
  } else if (!systemState.growth.maturedPool) {
    systemState.growth.maturedPool = { ...DEFAULT_MATURED_POOL };
  }
  if (!Array.isArray(systemState.growth.plantedBatches)) {
    systemState.growth.plantedBatches = [];
  }
  return systemState.growth;
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

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
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

function bumpInvVersion(inv) {
  inv.version = (inv.version ?? 0) + 1;
}

function getTierRank(tier, order) {
  const idx = order.indexOf(tier);
  return idx >= 0 ? idx : order.length;
}

function sortItemsForPlanting(items) {
  return items.sort((a, b) => {
    const tierA = a?.tier ?? "bronze";
    const tierB = b?.tier ?? "bronze";
    const rankA = getTierRank(tierA, TIER_ASC);
    const rankB = getTierRank(tierB, TIER_ASC);
    if (rankA !== rankB) return rankA - rankB;
    return (a?.id ?? 0) - (b?.id ?? 0);
  });
}

function consumeFromInventory(state, ownerId, kind, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const inv = state?.ownerInventories?.[ownerId];
  if (!inv || !Array.isArray(inv.items)) return 0;

  const candidates = inv.items.filter(
    (it) => it && it.kind === kind && Math.floor(it.quantity ?? 0) > 0
  );
  if (!candidates.length) return 0;

  sortItemsForPlanting(candidates);

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

export function stepFarmingSecond(state, tSec) {
  if (!state?.board) return;

  const cols = Number.isFinite(state.board.cols)
    ? Math.floor(state.board.cols)
    : 0;
  const tileOcc = state.board.occ?.tile;
  if (!Array.isArray(tileOcc)) return;

  for (let col = 0; col < cols; col++) {
    const tile = tileOcc[col];
    if (!tile) continue;
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    if (!tags.includes("farmable")) continue;

    // Order within the second: hydration update -> maturation -> planting -> harvesting.
    const systemState = ensureTileSystemState(tile);
    const growth =
      systemState.growth && typeof systemState.growth === "object"
        ? ensureGrowthState(tile)
        : null;
    const hasBatches = Array.isArray(growth?.plantedBatches)
      ? growth.plantedBatches.length > 0
      : false;
    const selectedCropId = growth?.selectedCropId ?? null;

    const needsHydration =
      systemState.hydration ||
      selectedCropId ||
      hasBatches;
    const hydration = needsHydration ? ensureHydrationState(tile) : null;

    if (hydration) {
      const max = Number.isFinite(hydration.max) ? hydration.max : 100;
      const decay = Number.isFinite(hydration.decayPerSec)
        ? hydration.decayPerSec
        : 2;
      hydration.max = max;
      hydration.decayPerSec = decay;
      hydration.cur = clamp(
        Number.isFinite(hydration.cur) ? hydration.cur : max,
        0,
        max
      );

      hydration.cur = Math.max(0, hydration.cur - decay);
      const ratio = max > 0 ? hydration.cur / max : 0;
      hydration.sumRatio = (hydration.sumRatio ?? 0) + ratio;
    }

    if (hasBatches && growth) {
      const hydrationTier = getTierValueForSystem(tile, "hydration");
      const fertilityTier = getTierValueForSystem(tile, "fertility");

      const batches = growth.plantedBatches;
      const remainingBatches = [];
      for (const batch of batches) {
        if (!batch) continue;
        const cropId = batch.cropId ?? "barley";
        const cropDef = cropDefs[cropId];
        const maturitySec =
          Number.isFinite(cropDef?.maturitySec) && cropDef.maturitySec > 0
            ? Math.floor(cropDef.maturitySec)
            : 32;
        const qualityTable =
          cropDef?.qualityTablesByFertilityTier?.[fertilityTier] ??
          cropDef?.qualityTablesByFertilityTier?.silver ??
          [];
        const plantedSec = Math.floor(batch.plantedSec ?? 0);
        if (tSec < plantedSec + maturitySec) {
          remainingBatches.push(batch);
          continue;
        }

        const sumRatio = Number.isFinite(hydration?.sumRatio)
          ? hydration.sumRatio
          : 0;
        const sumAtPlant = Number.isFinite(batch.sumAtPlant)
          ? batch.sumAtPlant
          : 0;
        const rAvg = clamp((sumRatio - sumAtPlant) / maturitySec, 0, 1);

        const curve = HYDRATION_CURVE[hydrationTier] || HYDRATION_CURVE.silver;
        const factor =
          (Number.isFinite(curve?.A) ? curve.A : 1) *
          Math.pow(rAvg, Number.isFinite(curve?.P) ? curve.P : 1);

        const seedCommitted = Math.max(0, Math.floor(batch.seedCommitted ?? 0));
        const baseYield = Number.isFinite(cropDef?.baseYieldMultiplier)
          ? cropDef.baseYieldMultiplier
          : 1;
        const maturedUnits = Math.floor(seedCommitted * baseYield * factor);

        if (maturedUnits > 0 && growth.maturedPool) {
          for (let i = 0; i < maturedUnits; i++) {
            const tier = rollQualityTier(state, qualityTable);
            growth.maturedPool[tier] = (growth.maturedPool[tier] ?? 0) + 1;
          }
        }
      }
      growth.plantedBatches = remainingBatches;
    }

    const chars = getCharsOnCol(state, col);
    if (!chars.length) continue;

    if (growth && selectedCropId) {
      const cropDef = cropDefs[selectedCropId];
      if (cropDef) {
        let totalSeedCommitted = 0;
        for (const ch of chars) {
          const rate = Number.isFinite(cropDef.plantSeedPerSec)
            ? cropDef.plantSeedPerSec
            : 0;
          const need = Math.max(0, Math.floor(rate));
          if (need <= 0) continue;
          const used = consumeFromInventory(state, ch.id, "barley", need);
          totalSeedCommitted += used;
        }

        if (totalSeedCommitted > 0) {
          const sumAtPlant = Number.isFinite(hydration?.sumRatio)
            ? hydration.sumRatio
            : 0;
          const batchId = `batch_${tile.instanceId}_${tSec}`;
          const batch = {
            id: batchId,
            cropId: selectedCropId,
            plantedSec: tSec,
            seedCommitted: totalSeedCommitted,
            sumAtPlant,
          };
          ensureGrowthState(tile).plantedBatches.push(batch);
        }
      }
    }

    if (growth?.maturedPool && maturedPoolHasAny(growth.maturedPool)) {
      const cropId = growth.selectedCropId ?? "barley";
      const cropDef = cropDefs[cropId];
      const rate = Number.isFinite(cropDef?.harvestUnitsPerSec)
        ? cropDef.harvestUnitsPerSec
        : 0;
      const perChar = Math.max(0, Math.floor(rate));
      if (perChar > 0) {
        for (const ch of chars) {
          let remaining = perChar;
          for (const tier of TIER_DESC) {
            if (remaining <= 0) break;
            const pool = Math.max(
              0,
              Math.floor(growth.maturedPool[tier] ?? 0)
            );
            if (pool <= 0) continue;
            const take = Math.min(pool, remaining);
            const added = addTieredUnits(
              state,
              ch.id,
              "barley",
              tier,
              take
            );
            if (added > 0) {
              growth.maturedPool[tier] = pool - added;
              remaining -= added;
            }
            if (added < take) {
              remaining = 0;
              break;
            }
          }
        }
      }
    }
  }
}
