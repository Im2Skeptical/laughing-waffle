import assert from "node:assert/strict";

import { envTagDefs } from "../src/defs/gamesystems/env-tags-defs.js";
import { resolveCosts } from "../src/model/costs.js";
import { stepEnvSecond } from "../src/model/env-exec.js";
import { Inventory } from "../src/model/inventory-model.js";
import { createEmptyState } from "../src/model/state.js";

function getSystemChargeAmount(resolvedCosts, systemId, key) {
  const charges = Array.isArray(resolvedCosts?.charges) ? resolvedCosts.charges : [];
  let total = 0;
  for (const charge of charges) {
    if (!charge || charge.kind !== "system") continue;
    if (charge.system !== systemId || charge.key !== key) continue;
    total += Math.max(0, Math.floor(charge.amount ?? 0));
  }
  return total;
}

function runFarmPlantFallbackToForageTest() {
  const state = createEmptyState(12345);
  state.seasons = ["winter"];
  state.currentSeasonIndex = 0;
  state.gameEventFeed = [];

  const tile = {
    instanceId: 1,
    defId: "grassland",
    col: 0,
    span: 1,
    tags: ["farmable", "forageable"],
    systemTiers: {},
    systemState: {
      growth: {
        selectedCropId: "barley",
        maturedPool: { bronze: 0, silver: 0, gold: 0, diamond: 0 },
        processes: [],
      },
    },
  };
  state.board.cols = 1;
  state.board.layers.tile.anchors = [tile];
  state.board.occ.tile = [tile];

  const pawn = {
    id: 101,
    role: "leader",
    name: "Test Leader",
    envCol: 0,
    hubCol: null,
    systemTiers: {},
    systemState: { stamina: { cur: 10, max: 100 } },
    equipment: {
      head: null,
      body: null,
      mainHand: null,
      offHand: null,
      accessoryA: null,
      accessoryB: null,
    },
  };
  state.pawns = [pawn];

  const inv = Inventory.create(8, 8);
  Inventory.init(inv);
  inv.version = 0;
  state.ownerInventories[pawn.id] = inv;

  const baseContext = {
    kind: "game",
    state,
    source: tile,
    tSec: 1,
    envCol: 0,
    pawnId: pawn.id,
    ownerId: pawn.id,
    pawn,
    pawnInv: inv,
    selectedCropId: "barley",
  };

  const farmPlantIntent = envTagDefs?.farmable?.intents?.find(
    (intent) => intent?.id === "farmPlant"
  );
  const forageIntent = envTagDefs?.forageable?.intents?.find(
    (intent) => intent?.id === "forage"
  );
  assert.ok(farmPlantIntent?.cost, "farmPlant intent cost missing");
  assert.ok(forageIntent?.cost, "forage intent cost missing");

  const farmCost = getSystemChargeAmount(
    resolveCosts(farmPlantIntent.cost, { ...baseContext, intentId: "farmPlant" }),
    "stamina",
    "cur"
  );
  const forageCost = getSystemChargeAmount(
    resolveCosts(forageIntent.cost, { ...baseContext, intentId: "forage" }),
    "stamina",
    "cur"
  );

  const startStamina = Math.floor(pawn.systemState?.stamina?.cur ?? 0);
  stepEnvSecond(state, 1);

  const endStamina = Math.floor(pawn.systemState?.stamina?.cur ?? 0);
  assert.equal(
    endStamina,
    startStamina - forageCost,
    "failed plant should not charge stamina; forage fallback should charge"
  );
  if (farmCost !== forageCost) {
    assert.notEqual(
      endStamina,
      startStamina - farmCost,
      "farm cost should not be charged when no seeds were consumed"
    );
  }

  const growthProcesses = Array.isArray(tile?.systemState?.growth?.processes)
    ? tile.systemState.growth.processes
    : [];
  assert.equal(
    growthProcesses.length,
    0,
    "farmPlant should not start batches when no seed is available"
  );
}

runFarmPlantFallbackToForageTest();
console.log("[test] Env intent fallback checks passed");
