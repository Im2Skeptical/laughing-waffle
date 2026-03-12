// prestige-system.js
// Leader/follower prestige, granary deposits, and hunger debt.

import { itemDefs } from "../defs/gamepieces/item-defs.js";
import {
  PRESTIGE_COST_PER_FOLLOWER,
  HUNGER_THRESHOLD,
  SECONDS_BELOW_HUNGER_THRESHOLD,
  PRESTIGE_DEBT_CADENCE_SEC,
  PRESTIGE_DEBT_PER_HUNGRY_FOLLOWER,
  PRESTIGE_CURVE_A_BY_TIER,
  LEADER_FAITH_STARTING_TIER,
  LEADER_FAITH_GROWTH_STREAK_FOR_UPGRADE,
  LEADER_FAITH_DECAY_CADENCE_SEC,
} from "../defs/gamesettings/gamerules-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
  mergeItemSystemStateForStacking,
} from "./inventory-model.js";
import { bumpInvVersion } from "./effects/core/inventory-version.js";
import { buildPawnSystemDefaults } from "./state.js";
import { TIER_ASC } from "./effects/core/tiers.js";
import { buildProcessDropboxOwnerId } from "./owner-id-protocol.js";
import { buildPawnContext } from "./pawn-access.js";
import {
  countAccessibleUnitsByTag,
  consumeAccessibleUnitsByTag,
} from "./costs.js";

export const PAWN_ROLE_LEADER = "leader";
export const PAWN_ROLE_FOLLOWER = "follower";

function normalizeTier(value, kind) {
  if (typeof value === "string" && value.length > 0) return value;
  const defTier = itemDefs?.[kind]?.defaultTier;
  if (typeof defTier === "string" && defTier.length > 0) return defTier;
  return "bronze";
}

function itemHasTag(item, tag) {
  if (!item || !tag) return false;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return tags.includes(tag);
}

function ensureObject(value, fallback) {
  if (!value || typeof value !== "object") return fallback;
  return value;
}

export function getLeaderFaithStartingTier() {
  return normalizeTierId(LEADER_FAITH_STARTING_TIER, "gold");
}

export function ensureLeaderFaithFields(leader) {
  if (!leader || typeof leader !== "object") return;
  if (leader.role !== PAWN_ROLE_LEADER) return;
  const existing =
    leader.leaderFaith && typeof leader.leaderFaith === "object"
      ? leader.leaderFaith
      : {};
  const tier = normalizeTierId(existing.tier, getLeaderFaithStartingTier());
  const eatStreak = Number.isFinite(existing.eatStreak)
    ? Math.max(0, Math.floor(existing.eatStreak))
    : 0;
  const decayElapsedSec = Number.isFinite(existing.decayElapsedSec)
    ? Math.max(0, Math.floor(existing.decayElapsedSec))
    : 0;
  const failedEatWarnActive = existing.failedEatWarnActive === true;
  leader.leaderFaith = {
    tier,
    eatStreak,
    decayElapsedSec,
    failedEatWarnActive,
  };
}

export function resetLeaderFaithEatStreak(leader) {
  ensureLeaderFaithFields(leader);
  if (!leader?.leaderFaith) return;
  leader.leaderFaith.eatStreak = 0;
}

export function resetLeaderFaithDecayTimer(leader) {
  ensureLeaderFaithFields(leader);
  if (!leader?.leaderFaith) return;
  leader.leaderFaith.decayElapsedSec = 0;
}

export function applyLeaderFaithEatSuccess(leader) {
  ensureLeaderFaithFields(leader);
  if (!leader?.leaderFaith) {
    return {
      ok: false,
      upgraded: false,
      previousTier: null,
      nextTier: null,
      eatStreak: 0,
    };
  }
  const faith = leader.leaderFaith;
  faith.eatStreak = Math.max(0, Math.floor(faith.eatStreak ?? 0)) + 1;
  const threshold = normalizeLeaderFaithGrowthThreshold();
  const previousTier = normalizeTierId(faith.tier, getLeaderFaithStartingTier());
  if (faith.eatStreak < threshold) {
    faith.tier = previousTier;
    return {
      ok: true,
      upgraded: false,
      previousTier,
      nextTier: previousTier,
      eatStreak: faith.eatStreak,
    };
  }

  const nextTier = shiftTier(previousTier, 1);
  faith.tier = nextTier;
  faith.eatStreak = 0;
  return {
    ok: true,
    upgraded: nextTier !== previousTier,
    previousTier,
    nextTier,
    eatStreak: 0,
  };
}

export function accumulateLeaderFaithDecaySecond(leader, seconds = 1) {
  ensureLeaderFaithFields(leader);
  if (!leader?.leaderFaith) return 0;
  const faith = leader.leaderFaith;
  const delta = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (delta <= 0) return 0;
  const cadence = normalizeLeaderFaithDecayCadence();
  faith.decayElapsedSec = Math.max(0, Math.floor(faith.decayElapsedSec ?? 0)) + delta;
  const ticks = Math.floor(faith.decayElapsedSec / cadence);
  faith.decayElapsedSec -= ticks * cadence;
  return ticks;
}

export function applyLeaderFaithDecayTick(leader) {
  ensureLeaderFaithFields(leader);
  if (!leader?.leaderFaith) {
    return {
      ok: false,
      eliminateLeader: false,
      degraded: false,
      previousTier: null,
      nextTier: null,
    };
  }
  const faith = leader.leaderFaith;
  const previousTier = normalizeTierId(faith.tier, getLeaderFaithStartingTier());
  if (previousTier === "bronze") {
    return {
      ok: true,
      eliminateLeader: true,
      degraded: false,
      previousTier,
      nextTier: previousTier,
    };
  }

  const nextTier = shiftTier(previousTier, -1);
  faith.tier = nextTier;
  faith.eatStreak = 0;
  return {
    ok: true,
    eliminateLeader: false,
    degraded: nextTier !== previousTier,
    previousTier,
    nextTier,
  };
}

function normalizeTierId(value, fallback = "bronze") {
  const safeFallback = TIER_ASC.includes(fallback)
    ? fallback
    : TIER_ASC[0] || "bronze";
  if (typeof value !== "string") return safeFallback;
  return TIER_ASC.includes(value) ? value : safeFallback;
}

function shiftTier(tier, delta = 0) {
  const normalized = normalizeTierId(tier, TIER_ASC[0] || "bronze");
  const idx = TIER_ASC.indexOf(normalized);
  const nextIdx = Math.max(
    0,
    Math.min(TIER_ASC.length - 1, idx + Math.floor(delta))
  );
  return TIER_ASC[nextIdx] || normalized;
}

function normalizeLeaderFaithGrowthThreshold() {
  const raw = Number.isFinite(LEADER_FAITH_GROWTH_STREAK_FOR_UPGRADE)
    ? Math.floor(LEADER_FAITH_GROWTH_STREAK_FOR_UPGRADE)
    : 3;
  return Math.max(1, raw);
}

function normalizeLeaderFaithDecayCadence() {
  const raw = Number.isFinite(LEADER_FAITH_DECAY_CADENCE_SEC)
    ? Math.floor(LEADER_FAITH_DECAY_CADENCE_SEC)
    : 30;
  return Math.max(1, raw);
}

function endpointReferencesRemovedPawn(endpointId, removedPawnIdSet) {
  if (!endpointId || typeof endpointId !== "string") return false;
  if (!removedPawnIdSet || removedPawnIdSet.size === 0) return false;

  for (const removedId of removedPawnIdSet) {
    if (
      endpointId === `inv:pawn:${removedId}` ||
      endpointId === `sys:pawn:${removedId}` ||
      endpointId === `inv:${removedId}`
    ) {
      return true;
    }
  }

  if (endpointId.startsWith("sys:pool:pawn:")) {
    const parts = endpointId.split(":");
    if (parts.length >= 4 && removedPawnIdSet.has(String(parts[3]))) {
      return true;
    }
  }

  return false;
}

function scrubRoutingSlots(slots, removedPawnIdSet) {
  if (!slots || typeof slots !== "object") return;
  for (const slotState of Object.values(slots)) {
    if (!slotState || typeof slotState !== "object") continue;
    if (Array.isArray(slotState.ordered)) {
      slotState.ordered = slotState.ordered.filter(
        (endpointId) =>
          !endpointReferencesRemovedPawn(endpointId, removedPawnIdSet)
      );
    } else {
      slotState.ordered = [];
    }
    if (!slotState.enabled || typeof slotState.enabled !== "object") {
      slotState.enabled = {};
      continue;
    }
    for (const endpointId of Object.keys(slotState.enabled)) {
      if (!endpointReferencesRemovedPawn(endpointId, removedPawnIdSet)) continue;
      delete slotState.enabled[endpointId];
    }
  }
}

function scrubRoutingState(routingState, removedPawnIdSet) {
  if (!routingState || typeof routingState !== "object") return;
  scrubRoutingSlots(routingState.inputs, removedPawnIdSet);
  scrubRoutingSlots(routingState.outputs, removedPawnIdSet);
}

function listProcessOwnersForScrub(state) {
  const owners = [];
  const hubAnchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  owners.push(...hubAnchors);
  const layers = state?.board?.layers;
  if (layers && typeof layers === "object") {
    for (const layer of Object.values(layers)) {
      if (!layer || typeof layer !== "object") continue;
      const anchors = Array.isArray(layer.anchors) ? layer.anchors : [];
      owners.push(...anchors);
    }
  }
  return owners;
}

function scrubProcessReferencesToRemovedPawns(state, removedPawnIds) {
  if (!state || !Array.isArray(removedPawnIds) || removedPawnIds.length === 0) {
    return;
  }
  const removedPawnIdSet = new Set(removedPawnIds.map((id) => String(id)));
  const processOwners = listProcessOwnersForScrub(state);

  for (const owner of processOwners) {
    if (!owner || typeof owner !== "object") continue;
    const systems = owner.systemState;
    if (!systems || typeof systems !== "object") continue;

    for (const systemState of Object.values(systems)) {
      if (!systemState || typeof systemState !== "object") continue;
      if (Array.isArray(systemState.processes)) {
        const nextProcesses = [];
        for (const process of systemState.processes) {
          if (!process || typeof process !== "object") continue;
          const processOwnerId =
            process.ownerId == null ? null : String(process.ownerId);
          const processLeaderId =
            process.leaderId == null ? null : String(process.leaderId);
          const removeProcess =
            (processOwnerId != null && removedPawnIdSet.has(processOwnerId)) ||
            (processLeaderId != null && removedPawnIdSet.has(processLeaderId));
          if (removeProcess) {
            if (process.id != null && state.ownerInventories) {
              const ownerId = buildProcessDropboxOwnerId(process.id);
              if (ownerId) delete state.ownerInventories[ownerId];
            }
            continue;
          }
          scrubRoutingState(process.routing, removedPawnIdSet);
          nextProcesses.push(process);
        }
        systemState.processes = nextProcesses;
      }
      scrubRoutingState(systemState.routingTemplate, removedPawnIdSet);
    }
  }
}

export function ensureLeaderPrestigeFields(leader) {
  if (!leader || typeof leader !== "object") return;
  if (leader.role !== PAWN_ROLE_LEADER) return;

  leader.totalDepositedAmountByTier = ensureObject(
    leader.totalDepositedAmountByTier,
    {}
  );
  leader.prestigeDebtByFollowerId = ensureObject(
    leader.prestigeDebtByFollowerId,
    {}
  );

  if (!Number.isFinite(leader.prestigeCapBase)) leader.prestigeCapBase = 0;
  if (!Number.isFinite(leader.prestigeCapBaseFromDeposits)) {
    leader.prestigeCapBaseFromDeposits = 0;
  }
  if (!Number.isFinite(leader.prestigeCapBonus)) leader.prestigeCapBonus = 0;
  if (!Number.isFinite(leader.prestigeCapDebt)) leader.prestigeCapDebt = 0;
  if (!Number.isFinite(leader.workerCount)) leader.workerCount = 0;
  leader.prestigeCapBaseFromDeposits = Math.max(
    0,
    Math.floor(leader.prestigeCapBaseFromDeposits)
  );
  leader.prestigeCapBonus = Math.max(0, Math.floor(leader.prestigeCapBonus));
  leader.workerCount = Math.max(0, Math.floor(leader.workerCount));
  if (leader.prestigeCapBaseFromDeposits === 0 && leader.prestigeCapBase > 0) {
    leader.prestigeCapBaseFromDeposits = Math.max(
      0,
      Math.floor(leader.prestigeCapBase)
    );
  }
  leader.prestigeCapBase =
    leader.prestigeCapBaseFromDeposits + leader.prestigeCapBonus;
  updateLeaderPrestigeEffective(leader);
  ensureLeaderFaithFields(leader);
}

export function ensureFollowerFields(follower, fallbackOrderIndex = null) {
  if (!follower || typeof follower !== "object") return;
  if (follower.role !== PAWN_ROLE_FOLLOWER) return;

  if (follower.leaderId == null) follower.leaderId = null;
  if (!Number.isFinite(follower.followerCreationOrderIndex)) {
    follower.followerCreationOrderIndex =
      Number.isFinite(fallbackOrderIndex) && fallbackOrderIndex >= 0
        ? Math.floor(fallbackOrderIndex)
        : 0;
  }

  const hunger = follower.systemState?.hunger;
  if (hunger && typeof hunger === "object") {
    if (!Number.isFinite(hunger.belowThresholdSec)) hunger.belowThresholdSec = 0;
    if (!Number.isFinite(hunger.debtCadenceSec)) hunger.debtCadenceSec = 0;
  }
}

export function updateLeaderPrestigeEffective(leader) {
  if (!leader || typeof leader !== "object") return 0;
  const base = Math.max(0, Math.floor(leader.prestigeCapBase ?? 0));
  const debt = Math.max(0, Math.floor(leader.prestigeCapDebt ?? 0));
  const effective = Math.max(0, base - Math.min(debt, base));
  leader.prestigeCapBase = base;
  leader.prestigeCapDebt = debt;
  leader.prestigeCapEffective = effective;
  return effective;
}

export function recomputeLeaderPrestigeBase(leader) {
  if (!leader || typeof leader !== "object") return 0;
  const totals = ensureObject(leader.totalDepositedAmountByTier, {});
  const sum = computePrestigeBaseFromTotals(totals);
  if (!Number.isFinite(leader.prestigeCapBonus)) leader.prestigeCapBonus = 0;
  leader.prestigeCapBonus = Math.max(0, Math.floor(leader.prestigeCapBonus));
  leader.prestigeCapBaseFromDeposits = sum;
  leader.prestigeCapBase = sum + leader.prestigeCapBonus;
  return updateLeaderPrestigeEffective(leader);
}

export function getLeaderById(state, leaderId) {
  if (!state || leaderId == null) return null;
  const pawns = Array.isArray(state.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    if (pawn?.id === leaderId) return pawn;
  }
  return null;
}

export function getFollowersForLeader(state, leaderId) {
  const out = [];
  if (!state || leaderId == null) return out;
  const pawns = Array.isArray(state.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    if (!pawn) continue;
    if (pawn.role !== PAWN_ROLE_FOLLOWER) continue;
    if (pawn.leaderId !== leaderId) continue;
    out.push(pawn);
  }
  return out;
}

function getPopulationCount(state) {
  const population = Number.isFinite(state?.resources?.population)
    ? Math.floor(state.resources.population)
    : 0;
  return Math.max(0, population);
}

export function getLeaderWorkerCount(leader) {
  ensureLeaderPrestigeFields(leader);
  return Math.max(0, Math.floor(leader?.workerCount ?? 0));
}

function setLeaderWorkerCount(leader, workerCount) {
  ensureLeaderPrestigeFields(leader);
  if (!leader) return 0;
  const next = Math.max(0, Math.floor(workerCount ?? 0));
  leader.workerCount = next;
  return next;
}

export function getPawnEffectiveWorkUnits(state, pawn) {
  if (!pawn || typeof pawn !== "object") return 1;
  if (pawn.role !== PAWN_ROLE_LEADER) return 1;
  return 1 + getLeaderWorkerCount(pawn);
}

function getReservedPrestigeForWorkerCount(workerCount) {
  return Math.max(0, Math.floor(workerCount ?? 0)) * PRESTIGE_COST_PER_FOLLOWER;
}

function getReservedPrestigeForFollowerCount(followerCount) {
  return Math.max(0, Math.floor(followerCount ?? 0)) * PRESTIGE_COST_PER_FOLLOWER;
}

export function getReservedPrestigeForLeaderWorkers(state, leaderId) {
  const leader = getLeaderById(state, leaderId);
  return getReservedPrestigeForWorkerCount(getLeaderWorkerCount(leader));
}

export function getReservedPrestigeForLeaderFollowers(state, leaderId) {
  const followers = getFollowersForLeader(state, leaderId);
  return getReservedPrestigeForFollowerCount(followers.length);
}

export function getReservedPrestigeForLeaderTotal(state, leaderId) {
  return (
    getReservedPrestigeForLeaderFollowers(state, leaderId) +
    getReservedPrestigeForLeaderWorkers(state, leaderId)
  );
}

export function getTotalAttachedWorkers(state) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  let total = 0;
  for (const pawn of pawns) {
    if (!pawn || pawn.role !== PAWN_ROLE_LEADER) continue;
    total += getLeaderWorkerCount(pawn);
  }
  return total;
}

export function getAvailablePopulationForWorkers(state) {
  return Math.max(0, getPopulationCount(state) - getTotalAttachedWorkers(state));
}

function getAccessibleEdibleCountForLeader(state, leader) {
  if (!state || !leader || leader.role !== PAWN_ROLE_LEADER) return 0;
  const ctx = buildPawnContext(
    state,
    leader,
    Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0
  );
  return countAccessibleUnitsByTag(ctx, "edible");
}

function consumeAccessibleEdibleForLeader(state, leader, amount = 1) {
  if (!state || !leader || leader.role !== PAWN_ROLE_LEADER) return 0;
  const ctx = buildPawnContext(
    state,
    leader,
    Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0
  );
  return consumeAccessibleUnitsByTag(ctx, "edible", amount);
}

export function getWorkerAdjustmentAvailability(state, leaderId) {
  const leader = getLeaderById(state, leaderId);
  if (!leader || leader.role !== PAWN_ROLE_LEADER) {
    return {
      ok: false,
      reason: "noLeader",
      canAdd: false,
      canRemove: false,
      population: getPopulationCount(state),
      totalWorkers: getTotalAttachedWorkers(state),
      workerCount: 0,
      edibleCount: 0,
      effectivePrestige: 0,
      reservedTotal: 0,
    };
  }

  ensureLeaderPrestigeFields(leader);
  const workerCount = getLeaderWorkerCount(leader);
  const totalWorkers = getTotalAttachedWorkers(state);
  const population = getPopulationCount(state);
  const effectivePrestige = updateLeaderPrestigeEffective(leader);
  const reservedFollowers = getReservedPrestigeForLeaderFollowers(state, leader.id);
  const reservedWorkers = getReservedPrestigeForWorkerCount(workerCount);
  const reservedTotal = reservedFollowers + reservedWorkers;
  const nextReservedTotal =
    reservedFollowers + getReservedPrestigeForWorkerCount(workerCount + 1);
  const edibleCount = getAccessibleEdibleCountForLeader(state, leader);
  const hasPopulationRoom = totalWorkers < population;
  const hasPrestigeRoom = nextReservedTotal <= effectivePrestige;
  const hasFood = edibleCount > 0;
  const canAdd = hasPopulationRoom && hasPrestigeRoom && hasFood;

  return {
    ok: true,
    leaderId: leader.id,
    workerCount,
    totalWorkers,
    population,
    edibleCount,
    effectivePrestige,
    reservedFollowers,
    reservedWorkers,
    reservedTotal,
    nextReservedTotal,
    hasPopulationRoom,
    hasPrestigeRoom,
    hasFood,
    canAdd,
    canRemove: workerCount > 0,
  };
}

function sortFollowersLastAddedFirst(list) {
  return list.slice().sort((a, b) => {
    const ai = Number.isFinite(a?.followerCreationOrderIndex)
      ? a.followerCreationOrderIndex
      : 0;
    const bi = Number.isFinite(b?.followerCreationOrderIndex)
      ? b.followerCreationOrderIndex
      : 0;
    if (ai !== bi) return bi - ai;
    return (b?.id ?? 0) - (a?.id ?? 0);
  });
}

export function getReservedPrestigeForLeader(state, leaderId) {
  return getReservedPrestigeForLeaderTotal(state, leaderId);
}

function ensureGranaryStore(structure) {
  if (!structure || typeof structure !== "object") return null;
  if (!structure.systemState || typeof structure.systemState !== "object") {
    structure.systemState = {};
  }
  const storeRaw = structure.systemState.granaryStore;
  if (!storeRaw || typeof storeRaw !== "object") {
    structure.systemState.granaryStore = { byKindTier: {}, totalByTier: {} };
  }
  const store = structure.systemState.granaryStore;
  if (!store.byKindTier || typeof store.byKindTier !== "object") {
    store.byKindTier = {};
  }
  if (!store.totalByTier || typeof store.totalByTier !== "object") {
    store.totalByTier = {};
  }
  return store;
}

function addToGranaryStore(store, kind, tier, amount) {
  if (!store || amount <= 0) return;
  if (!store.byKindTier[kind] || typeof store.byKindTier[kind] !== "object") {
    store.byKindTier[kind] = {};
  }
  store.byKindTier[kind][tier] =
    Math.max(0, Math.floor(store.byKindTier[kind][tier] ?? 0)) + amount;
  store.totalByTier[tier] =
    Math.max(0, Math.floor(store.totalByTier[tier] ?? 0)) + amount;
}

function addToLeaderTotals(leader, tier, amount) {
  if (!leader || amount <= 0) return;
  const totals = ensureObject(leader.totalDepositedAmountByTier, {});
  totals[tier] = Math.max(0, Math.floor(totals[tier] ?? 0)) + amount;
  leader.totalDepositedAmountByTier = totals;
}

function computePrestigeBaseFromTotals(totalsByTier) {
  const totals = ensureObject(totalsByTier, {});
  const keySet = new Set([
    ...Object.keys(PRESTIGE_CURVE_A_BY_TIER || {}),
    ...Object.keys(totals),
  ]);
  const tiers = Array.from(keySet).sort();

  let sum = 0;
  for (const tier of tiers) {
    const a = Number.isFinite(PRESTIGE_CURVE_A_BY_TIER?.[tier])
      ? PRESTIGE_CURVE_A_BY_TIER[tier]
      : 0;
    const total = Math.max(0, Math.floor(totals?.[tier] ?? 0));
    if (a <= 0 || total <= 0) continue;
    sum += Math.floor(a * Math.sqrt(total));
  }

  return Math.max(0, Math.floor(sum));
}

function getItemIdsInGridOrder(inv) {
  if (!inv) return [];
  const grid = Array.isArray(inv.grid) ? inv.grid : null;
  if (!grid) {
    return Array.isArray(inv.items) ? inv.items.map((it) => it?.id) : [];
  }
  const seen = new Set();
  const order = [];
  for (let idx = 0; idx < grid.length; idx++) {
    const id = grid[idx];
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

function getItemsInGridOrder(inv) {
  const ids = getItemIdsInGridOrder(inv);
  if (!inv || !ids.length) return [];
  const out = [];
  for (const id of ids) {
    const item = inv.itemsById?.[id] ?? inv.items?.find((it) => it.id === id);
    if (item) out.push(item);
  }
  return out;
}

export function applyGranaryDepositsForStructure(state, structure, pawns) {
  if (!state || !structure || !Array.isArray(pawns) || pawns.length === 0) {
    return { ok: false, deposited: 0 };
  }

  const store = ensureGranaryStore(structure);
  if (!store) return { ok: false, deposited: 0 };

  let depositedTotal = 0;

  for (const pawn of pawns) {
    if (!pawn) continue;
    const role = pawn.role;
    const leader =
      role === PAWN_ROLE_LEADER
        ? pawn
        : role === PAWN_ROLE_FOLLOWER && pawn.leaderId != null
        ? getLeaderById(state, pawn.leaderId)
        : null;
    if (!leader || leader.role !== PAWN_ROLE_LEADER) continue;

    ensureLeaderPrestigeFields(leader);

    const inv = state.ownerInventories?.[pawn.id];
    if (!inv) continue;

    Inventory.rebuildDerived(inv);

    const items = getItemsInGridOrder(inv);
    let pawnDeposited = 0;

    for (const item of items) {
      if (!item || !itemHasTag(item, "grain")) continue;
      const qty = Math.max(0, Math.floor(item.quantity ?? 0));
      if (qty <= 0) continue;

      const tier = normalizeTier(item.tier, item.kind);
      const kind = item.kind;

      addToGranaryStore(store, kind, tier, qty);
      addToLeaderTotals(leader, tier, qty);

      pawnDeposited += qty;
      depositedTotal += qty;

      Inventory.removeItem(inv, item.id);
    }

    if (pawnDeposited > 0) {
      bumpInvVersion(inv);
      recomputeLeaderPrestigeBase(leader);
    }
  }

  return { ok: depositedTotal > 0, deposited: depositedTotal };
}

export function applyPrestigeDeposit(
  state,
  leaderId,
  structure,
  kindTierTotals,
  options = {}
) {
  if (!state || leaderId == null || !kindTierTotals) return false;
  const parsedLeaderId = Number.isFinite(Number(leaderId))
    ? Number(leaderId)
    : leaderId;
  const leader = getLeaderById(state, parsedLeaderId);
  if (!leader || leader.role !== PAWN_ROLE_LEADER) return false;

  ensureLeaderPrestigeFields(leader);
  const curveMultiplier =
    Number.isFinite(options?.curveMultiplier) && options.curveMultiplier > 0
      ? options.curveMultiplier
      : 1;
  const oldBase = computePrestigeBaseFromTotals(leader.totalDepositedAmountByTier);

  let depositedTotal = 0;
  const kinds = Object.keys(kindTierTotals || {});
  for (const kind of kinds) {
    const tiers = kindTierTotals?.[kind];
    if (!tiers || typeof tiers !== "object") continue;
    for (const [tierRaw, amountRaw] of Object.entries(tiers)) {
      const amount = Math.max(0, Math.floor(amountRaw ?? 0));
      if (amount <= 0) continue;
      const tier = typeof tierRaw === "string" && tierRaw.length ? tierRaw : "bronze";
      addToLeaderTotals(leader, tier, amount);
      depositedTotal += amount;
    }
  }

  if (depositedTotal > 0) {
    const newBase = computePrestigeBaseFromTotals(leader.totalDepositedAmountByTier);
    leader.prestigeCapBaseFromDeposits = newBase;
    const delta = Math.max(0, newBase - oldBase);
    if (curveMultiplier !== 1 && delta > 0) {
      const bonusDelta = Math.floor(delta * (curveMultiplier - 1));
      if (!Number.isFinite(leader.prestigeCapBonus)) leader.prestigeCapBonus = 0;
      leader.prestigeCapBonus = Math.max(
        0,
        Math.floor(leader.prestigeCapBonus + bonusDelta)
      );
    } else if (!Number.isFinite(leader.prestigeCapBonus)) {
      leader.prestigeCapBonus = 0;
    }
    leader.prestigeCapBase = Math.max(
      0,
      Math.floor(leader.prestigeCapBaseFromDeposits + leader.prestigeCapBonus)
    );
    updateLeaderPrestigeEffective(leader);
    return true;
  }

  return false;
}

function findPlacementForItem(inv, item) {
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

function transferItemToInventory(fromInv, toInv, item, allowDeleteOverflow) {
  if (!fromInv || !toInv || !item) {
    return { movedAny: false, fullyMoved: false };
  }

  let remaining = Math.max(0, Math.floor(item.quantity ?? 0));
  if (remaining <= 0) return { movedAny: false, fullyMoved: true };

  const targets = getItemsInGridOrder(toInv);
  const maxStack = getItemMaxStack(item);
  let movedAny = false;

  for (const target of targets) {
    if (remaining <= 0) break;
    if (!canStackItems(target, item)) continue;
    const current = Math.max(0, Math.floor(target.quantity ?? 0));
    const space = Math.max(0, maxStack - current);
    if (space <= 0) continue;
    const moved = Math.min(space, remaining);
    target.quantity = current + moved;
    mergeItemSystemStateForStacking(target, item, current, moved);
    remaining -= moved;
    if (moved > 0) movedAny = true;
  }

  if (remaining <= 0) {
    Inventory.removeItem(fromInv, item.id);
    return { movedAny: true, fullyMoved: true };
  }

  item.quantity = remaining;
  const placement = findPlacementForItem(toInv, item);
  if (placement) {
    const originalGX = item.gridX;
    const originalGY = item.gridY;
    Inventory.removeItem(fromInv, item.id);
    const attached = Inventory.attachExistingItem(
      toInv,
      item,
      placement.gx,
      placement.gy
    );
    if (!attached) {
      Inventory.attachExistingItem(fromInv, item, originalGX, originalGY);
      return { movedAny, fullyMoved: false };
    }
    return { movedAny: true, fullyMoved: true };
  }

  if (allowDeleteOverflow) {
    Inventory.removeItem(fromInv, item.id);
    return { movedAny: true, fullyMoved: true };
  }

  return { movedAny, fullyMoved: false };
}

function transferInventoryBetweenOwners(
  state,
  fromOwnerId,
  toOwnerId,
  allowDeleteOverflow
) {
  const fromInv = state.ownerInventories?.[fromOwnerId];
  const toInv = state.ownerInventories?.[toOwnerId];
  if (!fromInv || !toInv) return { ok: false, emptied: false };

  Inventory.rebuildDerived(fromInv);
  Inventory.rebuildDerived(toInv);

  const items = getItemsInGridOrder(fromInv);
  let movedAny = false;

  for (const item of items) {
    if (!item) continue;
    const qtyBefore = Math.max(0, Math.floor(item.quantity ?? 0));
    if (qtyBefore <= 0) continue;
    const moveResult = transferItemToInventory(
      fromInv,
      toInv,
      item,
      allowDeleteOverflow
    );
    if (moveResult.movedAny) movedAny = true;
  }

  Inventory.rebuildDerived(fromInv);
  Inventory.rebuildDerived(toInv);

  if (movedAny) {
    bumpInvVersion(fromInv);
    bumpInvVersion(toInv);
  }

  const remaining = Array.isArray(fromInv.items) ? fromInv.items.length : 0;
  return { ok: true, emptied: remaining === 0, movedAny };
}

export function applyFollowerHungerDebt(state, follower) {
  if (!state || !follower || follower.role !== PAWN_ROLE_FOLLOWER) return false;
  const hunger = follower.systemState?.hunger;
  if (!hunger || typeof hunger !== "object") return false;

  const threshold = Math.max(0, Math.floor(HUNGER_THRESHOLD ?? 0));
  const exposureNeeded = Math.max(1, Math.floor(SECONDS_BELOW_HUNGER_THRESHOLD));
  const cadence = Math.max(1, Math.floor(PRESTIGE_DEBT_CADENCE_SEC));
  const debtAmount = Math.max(0, Math.floor(PRESTIGE_DEBT_PER_HUNGRY_FOLLOWER));

  const cur = Math.floor(hunger.cur ?? 0);

  if (cur < threshold) {
    hunger.belowThresholdSec = Math.max(0, Math.floor(hunger.belowThresholdSec ?? 0)) + 1;
    if (hunger.belowThresholdSec >= exposureNeeded) {
      hunger.debtCadenceSec = Math.max(0, Math.floor(hunger.debtCadenceSec ?? 0)) + 1;
      if (hunger.debtCadenceSec >= cadence) {
        hunger.debtCadenceSec = 0;
        if (debtAmount > 0) {
          const leader = getLeaderById(state, follower.leaderId);
          if (leader && leader.role === PAWN_ROLE_LEADER) {
            ensureLeaderPrestigeFields(leader);
            leader.prestigeCapDebt =
              Math.max(0, Math.floor(leader.prestigeCapDebt ?? 0)) + debtAmount;
            if (!leader.prestigeDebtByFollowerId || typeof leader.prestigeDebtByFollowerId !== "object") {
              leader.prestigeDebtByFollowerId = {};
            }
            const key = String(follower.id ?? "");
            leader.prestigeDebtByFollowerId[key] =
              Math.max(0, Math.floor(leader.prestigeDebtByFollowerId[key] ?? 0)) + debtAmount;
            updateLeaderPrestigeEffective(leader);
          }
        }
      }
    }
  } else {
    hunger.belowThresholdSec = 0;
    hunger.debtCadenceSec = 0;
  }

  return true;
}

export function enforcePrestigeFollowerCap(state) {
  if (!state) return { ok: false, despawned: 0 };
  const pawns = Array.isArray(state.pawns) ? state.pawns : [];
  let totalDespawned = 0;
  let workersRemoved = 0;

  for (const leader of pawns) {
    if (!leader || leader.role !== PAWN_ROLE_LEADER) continue;
    ensureLeaderPrestigeFields(leader);

    let followers = getFollowersForLeader(state, leader.id);
    let reserved =
      getReservedPrestigeForFollowerCount(followers.length) +
      getReservedPrestigeForWorkerCount(getLeaderWorkerCount(leader));
    const effective = updateLeaderPrestigeEffective(leader);

    if (effective >= reserved) continue;

    let workerCount = getLeaderWorkerCount(leader);
    while (workerCount > 0 && effective < reserved) {
      workerCount -= 1;
      setLeaderWorkerCount(leader, workerCount);
      workersRemoved += 1;
      reserved -= PRESTIGE_COST_PER_FOLLOWER;
    }
    if (effective >= reserved) continue;

    const ordered = sortFollowersLastAddedFirst(followers);
    for (const follower of ordered) {
      if (effective >= reserved) break;
      const res = despawnFollower(state, leader, follower, { forced: true });
      if (res?.ok) {
        totalDespawned += 1;
        reserved -= PRESTIGE_COST_PER_FOLLOWER;
      }
    }
  }

  return { ok: true, despawned: totalDespawned, workersRemoved };
}

export function enforceWorkerPopulationCap(state) {
  if (!state) return { ok: false, removed: 0 };
  const population = getPopulationCount(state);
  const leaders = (Array.isArray(state?.pawns) ? state.pawns : [])
    .filter((pawn) => pawn?.role === PAWN_ROLE_LEADER)
    .sort((a, b) => (b?.id ?? 0) - (a?.id ?? 0));
  let totalWorkers = getTotalAttachedWorkers(state);
  let removed = 0;

  if (totalWorkers <= population) {
    return { ok: true, removed, totalWorkers, population };
  }

  for (const leader of leaders) {
    if (totalWorkers <= population) break;
    let workerCount = getLeaderWorkerCount(leader);
    while (workerCount > 0 && totalWorkers > population) {
      workerCount -= 1;
      setLeaderWorkerCount(leader, workerCount);
      totalWorkers -= 1;
      removed += 1;
    }
  }

  return { ok: true, removed, totalWorkers, population };
}

export function consumeWorkerMealsAfterLeaderEat(state, leader) {
  if (!state || !leader || leader.role !== PAWN_ROLE_LEADER) {
    return { ok: false, paid: 0, lost: 0, workerCount: 0 };
  }
  const workerCount = getLeaderWorkerCount(leader);
  if (workerCount <= 0) {
    return { ok: true, paid: 0, lost: 0, workerCount: 0 };
  }

  let paid = 0;
  for (let i = 0; i < workerCount; i++) {
    const consumed = consumeAccessibleEdibleForLeader(state, leader, 1);
    if (consumed <= 0) break;
    paid += consumed;
  }

  const lost = Math.max(0, workerCount - paid);
  if (lost > 0) {
    setLeaderWorkerCount(leader, paid);
  }

  return {
    ok: true,
    paid,
    lost,
    workerCount: getLeaderWorkerCount(leader),
  };
}

export function spawnFollowerForLeader(state, leader) {
  if (!state || !leader || leader.role !== PAWN_ROLE_LEADER) {
    return { ok: false, reason: "badLeader" };
  }

  const { systemTiers, systemState } = buildPawnSystemDefaults();

  const spawnEnvCol = Number.isFinite(leader.envCol)
    ? Math.floor(leader.envCol)
    : null;
  const spawnHubCol =
    spawnEnvCol == null
      ? Number.isFinite(leader.hubCol)
        ? Math.floor(leader.hubCol)
        : 0
      : null;

  if (!Number.isFinite(state.nextPawnId)) {
    state.nextPawnId = 101;
  }
  const nextPawnId = Math.floor(state.nextPawnId);
  const follower = {
    id: state.nextPawnId++,
    pawnDefId: leader.pawnDefId || "default",
    name: `Follower ${nextPawnId}`,
    color: leader.color,
    hubCol: spawnHubCol,
    envCol: spawnEnvCol,
    systemTiers,
    systemState,
    props: {},
    role: PAWN_ROLE_FOLLOWER,
    leaderId: leader.id,
    followerCreationOrderIndex: state.nextFollowerCreationOrderIndex++,
  };

  ensureFollowerFields(follower, follower.followerCreationOrderIndex);

  state.pawns.push(follower);

  if (!state.ownerInventories) state.ownerInventories = {};
  const inv = Inventory.create(5, 3);
  Inventory.init(inv);
  inv.version = 0;
  state.ownerInventories[follower.id] = inv;

  return { ok: true, followerId: follower.id };
}

export function despawnFollower(state, leader, follower, options = {}) {
  if (!state || !leader || !follower) return { ok: false, reason: "badArgs" };
  const forced = options.forced === true;

  const transfer = transferInventoryBetweenOwners(
    state,
    follower.id,
    leader.id,
    forced
  );

  const followerInv = state.ownerInventories?.[follower.id];
  const remaining = Array.isArray(followerInv?.items) ? followerInv.items.length : 0;

  if (!forced && remaining > 0) {
    return { ok: true, blocked: true, followerId: follower.id, remainingItems: remaining };
  }

  state.pawns = state.pawns.filter((pawn) => pawn?.id !== follower.id);
  delete state.ownerInventories[follower.id];

  return {
    ok: true,
    removed: true,
    followerId: follower.id,
    blocked: false,
    transfer,
  };
}

export function adjustFollowerCount(state, leaderId, delta) {
  if (!state || !Number.isFinite(delta)) {
    return { ok: false, reason: "badDelta" };
  }
  const leader = getLeaderById(state, leaderId);
  if (!leader || leader.role !== PAWN_ROLE_LEADER) {
    return { ok: false, reason: "noLeader" };
  }

  const change = Math.trunc(delta);
  if (change === 0) return { ok: true, result: "noChange" };

  if (change > 0) {
    for (let i = 0; i < change; i++) {
      const res = spawnFollowerForLeader(state, leader);
      if (!res.ok) return res;
    }
    enforcePrestigeFollowerCap(state);
    return { ok: true, result: "followersAdded", leaderId, delta: change };
  }

  const removeCount = Math.abs(change);
  let removed = 0;
  for (let i = 0; i < removeCount; i++) {
    const followers = sortFollowersLastAddedFirst(
      getFollowersForLeader(state, leader.id)
    );
    const target = followers[0];
    if (!target) {
      return { ok: true, result: "noFollowers", leaderId, removed };
    }
    const res = despawnFollower(state, leader, target, { forced: false });
    if (res?.blocked) {
      return {
        ok: true,
        result: "followerDespawnBlocked",
        leaderId,
        followerId: res.followerId,
        remainingItems: res.remainingItems ?? 0,
        removed,
      };
    }
    removed += 1;
  }

  enforcePrestigeFollowerCap(state);
  return { ok: true, result: "followersRemoved", leaderId, removed };
}

export function adjustWorkerCount(state, leaderId, delta) {
  if (!state || !Number.isFinite(delta)) {
    return { ok: false, reason: "badDelta" };
  }
  const leader = getLeaderById(state, leaderId);
  if (!leader || leader.role !== PAWN_ROLE_LEADER) {
    return { ok: false, reason: "noLeader" };
  }

  const change = Math.trunc(delta);
  if (change === 0) return { ok: true, result: "noChange", leaderId };

  if (change < 0) {
    const current = getLeaderWorkerCount(leader);
    const removed = Math.min(current, Math.abs(change));
    setLeaderWorkerCount(leader, current - removed);
    enforceWorkerPopulationCap(state);
    enforcePrestigeFollowerCap(state);
    return { ok: true, result: "workersRemoved", leaderId, removed };
  }

  let added = 0;
  for (let i = 0; i < change; i++) {
    const availability = getWorkerAdjustmentAvailability(state, leader.id);
    if (!availability.canAdd) {
      return {
        ok: added > 0,
        result: added > 0 ? "workersPartiallyAdded" : "workerAddBlocked",
        leaderId,
        added,
        reason:
          !availability.hasPopulationRoom
            ? "populationCap"
            : !availability.hasPrestigeRoom
            ? "insufficientPrestige"
            : "insufficientFood",
      };
    }

    const consumed = consumeAccessibleEdibleForLeader(state, leader, 1);
    if (consumed <= 0) {
      return {
        ok: added > 0,
        result: added > 0 ? "workersPartiallyAdded" : "workerAddBlocked",
        leaderId,
        added,
        reason: "insufficientFood",
      };
    }

    setLeaderWorkerCount(leader, getLeaderWorkerCount(leader) + 1);
    added += 1;
  }

  enforceWorkerPopulationCap(state);
  enforcePrestigeFollowerCap(state);
  return { ok: true, result: "workersAdded", leaderId, added };
}

export function eliminateLeaderByFaithCollapse(state, leaderId) {
  if (!state || leaderId == null) {
    return { ok: false, reason: "badLeaderId" };
  }

  const leader = getLeaderById(state, leaderId);
  if (!leader || leader.role !== PAWN_ROLE_LEADER) {
    return { ok: false, reason: "noLeader" };
  }

  const followers = getFollowersForLeader(state, leader.id);
  const followerIds = followers
    .map((follower) => (follower?.id == null ? null : follower.id))
    .filter((id) => id != null);
  const removedPawnIds = [leader.id, ...followerIds];
  const removedPawnIdSet = new Set(removedPawnIds.map((id) => String(id)));

  const existingPawns = Array.isArray(state.pawns) ? state.pawns : [];
  state.pawns = existingPawns.filter((pawn) => {
    if (!pawn || pawn.id == null) return true;
    return !removedPawnIdSet.has(String(pawn.id));
  });

  if (!state.ownerInventories || typeof state.ownerInventories !== "object") {
    state.ownerInventories = {};
  }
  for (const removedPawnId of removedPawnIds) {
    delete state.ownerInventories[removedPawnId];
  }

  for (const pawn of state.pawns) {
    if (!pawn || pawn.role !== PAWN_ROLE_LEADER) continue;
    const debtByFollowerId =
      pawn.prestigeDebtByFollowerId &&
      typeof pawn.prestigeDebtByFollowerId === "object"
        ? pawn.prestigeDebtByFollowerId
        : null;
    if (!debtByFollowerId) continue;
    for (const followerId of followerIds) {
      delete debtByFollowerId[String(followerId)];
    }
  }

  scrubProcessReferencesToRemovedPawns(state, removedPawnIds);

  return {
    ok: true,
    leaderId: leader.id,
    followerIds,
    removedPawnIds,
  };
}

export function getLeaderCount(state) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  let count = 0;
  for (const pawn of pawns) {
    if (!pawn || pawn.role !== PAWN_ROLE_LEADER) continue;
    count += 1;
  }
  return count;
}
