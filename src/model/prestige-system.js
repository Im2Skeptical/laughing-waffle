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
} from "../defs/gamesettings/gamerules-defs.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
  mergeItemSystemStateForStacking,
} from "./inventory-model.js";
import { bumpInvVersion } from "./effects/core/inventory-version.js";
import { buildPawnSystemDefaults } from "./state.js";

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
  if (!Number.isFinite(leader.prestigeCapDebt)) leader.prestigeCapDebt = 0;
  updateLeaderPrestigeEffective(leader);
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

  leader.prestigeCapBase = sum;
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
  const followers = getFollowersForLeader(state, leaderId);
  return followers.length * PRESTIGE_COST_PER_FOLLOWER;
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

export function applyPrestigeDeposit(state, leaderId, structure, kindTierTotals) {
  if (!state || leaderId == null || !kindTierTotals) return false;
  const parsedLeaderId = Number.isFinite(Number(leaderId))
    ? Number(leaderId)
    : leaderId;
  const leader = getLeaderById(state, parsedLeaderId);
  if (!leader || leader.role !== PAWN_ROLE_LEADER) return false;

  ensureLeaderPrestigeFields(leader);

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
    recomputeLeaderPrestigeBase(leader);
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

  for (const leader of pawns) {
    if (!leader || leader.role !== PAWN_ROLE_LEADER) continue;
    ensureLeaderPrestigeFields(leader);

    let followers = getFollowersForLeader(state, leader.id);
    let reserved = followers.length * PRESTIGE_COST_PER_FOLLOWER;
    const effective = updateLeaderPrestigeEffective(leader);

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

  return { ok: true, despawned: totalDespawned };
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
