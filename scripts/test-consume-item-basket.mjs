import assert from "node:assert/strict";

import { LEADER_EQUIPMENT_SLOT_ORDER } from "../src/defs/gamesystems/equipment-slot-defs.js";
import { Inventory } from "../src/model/inventory-model.js";
import { handleConsumeItem } from "../src/model/effects/ops/game-ops.js";

function makeState() {
  return {
    nextItemId: 1,
    tSec: 0,
    ownerInventories: {},
    hub: { anchors: [], slots: [], occ: [] },
    board: { layers: { tile: { anchors: [] } } },
    pawns: [],
  };
}

function makeLeader(state, id) {
  const equipment = {};
  for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) equipment[slotId] = null;
  const leader = {
    id,
    role: "leader",
    equipment,
    systemState: {},
  };
  state.pawns.push(leader);
  return leader;
}

function ensureInventory(state, ownerId, cols = 8, rows = 8) {
  const inv = Inventory.create(cols, rows);
  Inventory.init(inv);
  inv.version = 0;
  state.ownerInventories[ownerId] = inv;
  return inv;
}

function addItem(state, inv, kind, quantity, tier = "bronze") {
  const item = Inventory.addNewItem(state, inv, {
    kind,
    quantity,
    width: 1,
    height: 1,
    tier,
    seasonsToExpire: null,
    tags: [],
    systemTiers: {},
    systemState: {},
  });
  assert.ok(item, `failed to add ${kind}`);
  return item;
}

function equipOffHand(leader, inv, item) {
  leader.equipment.offHand = item;
  Inventory.removeItem(inv, item.id);
  Inventory.rebuildDerived(inv);
}

function seedBasketPool(basket, kind, tiers = {}) {
  if (!basket.systemState || typeof basket.systemState !== "object") {
    basket.systemState = {};
  }
  if (!basket.systemState.storage || typeof basket.systemState.storage !== "object") {
    basket.systemState.storage = {};
  }
  const storage = basket.systemState.storage;
  if (!storage.byKindTier || typeof storage.byKindTier !== "object") {
    storage.byKindTier = {};
  }
  if (!storage.totalByTier || typeof storage.totalByTier !== "object") {
    storage.totalByTier = {};
  }
  for (const tier of ["bronze", "silver", "gold", "diamond"]) {
    const qty = Math.max(0, Math.floor(tiers[tier] ?? 0));
    if (!storage.byKindTier[kind] || typeof storage.byKindTier[kind] !== "object") {
      storage.byKindTier[kind] = {};
    }
    storage.byKindTier[kind][tier] = qty;
    storage.totalByTier[tier] = qty;
  }
}

function runBasketFallbackConsumeTest() {
  const state = makeState();
  const leader = makeLeader(state, 11);
  const inv = ensureInventory(state, leader.id);

  const basket = addItem(state, inv, "basket", 1);
  equipOffHand(leader, inv, basket);
  seedBasketPool(basket, "barley", { bronze: 3 });

  const ctx = {
    kind: "game",
    source: { instanceId: 900, col: 0 },
    ownerId: leader.id,
    pawnId: leader.id,
    pawn: leader,
    envCol: 0,
  };
  const effect = {
    op: "ConsumeItem",
    itemKind: "barley",
    amount: 2,
    target: { ownerId: leader.id },
    outVar: "seedSpent",
    tierOrder: "asc",
  };

  const changed = handleConsumeItem(state, effect, ctx);
  assert.equal(changed, true, "basket pool should satisfy consume");
  assert.equal(ctx?.vars?.seedSpent, 2, "seedSpent should reflect consumed basket units");
  assert.equal(
    basket.systemState.storage.byKindTier.barley.bronze,
    1,
    "basket barley should decrease"
  );
}

function runInventoryThenBasketConsumeTest() {
  const state = makeState();
  const leader = makeLeader(state, 12);
  const inv = ensureInventory(state, leader.id);

  addItem(state, inv, "barley", 1);
  const basket = addItem(state, inv, "basket", 1);
  equipOffHand(leader, inv, basket);
  seedBasketPool(basket, "barley", { bronze: 2 });

  const ctx = {
    kind: "game",
    source: { instanceId: 901, col: 0 },
    ownerId: leader.id,
    pawnId: leader.id,
    pawn: leader,
    envCol: 0,
  };
  const effect = {
    op: "ConsumeItem",
    itemKind: "barley",
    amount: 2,
    target: { ownerId: leader.id },
    outVar: "seedSpent",
    tierOrder: "asc",
  };

  const changed = handleConsumeItem(state, effect, ctx);
  assert.equal(changed, true, "consume should succeed across owner sources");
  assert.equal(ctx?.vars?.seedSpent, 2, "combined inventory + basket spend expected");
  const invBarley = (inv.items || []).filter((it) => it?.kind === "barley");
  assert.equal(invBarley.length, 0, "inventory barley should be consumed first");
  assert.equal(
    basket.systemState.storage.byKindTier.barley.bronze,
    1,
    "basket should provide remaining amount"
  );
}

runBasketFallbackConsumeTest();
runInventoryThenBasketConsumeTest();

console.log("[test] ConsumeItem basket fallback checks passed");
