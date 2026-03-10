import assert from "node:assert/strict";

import {
  PAWN_IDLE_STAMINA_REGEN_AMOUNT,
  PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC,
} from "../src/defs/gamesettings/gamerules-defs.js";
import { Inventory } from "../src/model/inventory-model.js";
import { updateGame } from "../src/model/game-model.js";
import { stepPawnSecond } from "../src/model/pawn-exec.js";
import {
  createEmptyState,
  deserializeGameState,
  serializeGameState,
} from "../src/model/state.js";
import {
  createTimelineFromInitialState,
  rebuildStateAtSecond,
} from "../src/model/timeline/index.js";

function createBasePawn(overrides = {}) {
  return {
    id: 101,
    pawnDefId: "default",
    role: "leader",
    name: "Test Leader",
    envCol: 0,
    hubCol: null,
    systemTiers: {},
    systemState: {
      stamina: { cur: 95, max: 100 },
      hunger: { cur: 100, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
    equipment: {
      head: null,
      body: null,
      mainHand: null,
      offHand: null,
      accessoryA: null,
      accessoryB: null,
    },
    ...overrides,
  };
}

function createStateWithPawn(pawnOverrides = {}) {
  const state = createEmptyState(12345);
  state.gameEventFeed = [];
  state.pawns = [createBasePawn(pawnOverrides)];
  return state;
}

function getLeader(state) {
  return state?.pawns?.find((pawn) => pawn?.id === 101) ?? null;
}

function getStamina(state) {
  return Math.floor(getLeader(state)?.systemState?.stamina?.cur ?? 0);
}

function getHunger(state) {
  return Math.floor(getLeader(state)?.systemState?.hunger?.cur ?? 0);
}

function advanceSeconds(state, seconds) {
  const frames = Math.max(0, Math.floor(seconds * 60));
  for (let i = 0; i < frames; i += 1) {
    updateGame(1 / 60, state);
  }
}

function runIdleCadenceAndClampTest() {
  const state = createStateWithPawn({
    systemState: {
      stamina: { cur: 99, max: 100 },
      hunger: { cur: 100, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
  });

  stepPawnSecond(state, PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC - 1);
  assert.equal(
    getStamina(state),
    99,
    "idle regen should not trigger before its cadence second"
  );

  stepPawnSecond(state, PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC);
  assert.equal(
    getStamina(state),
    100,
    "idle regen should grant stamina on its cadence second"
  );

  stepPawnSecond(state, PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC * 2);
  assert.equal(
    getStamina(state),
    100,
    "idle regen should clamp at the pawn stamina max"
  );
}

function runNoRegenWhileActingTest() {
  const state = createStateWithPawn({
    systemState: {
      stamina: { cur: 10, max: 100 },
      hunger: { cur: 40, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
  });
  const pawn = getLeader(state);

  const inv = Inventory.create(8, 8);
  Inventory.init(inv);
  inv.version = 0;
  state.ownerInventories[pawn.id] = inv;
  Inventory.addNewItem(state, inv, {
    kind: "dates",
    quantity: 1,
    gridX: 0,
    gridY: 0,
  });

  stepPawnSecond(state, PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC);

  assert.equal(
    getStamina(state),
    10,
    "idle regen should not fire on a second where the pawn executes an intent"
  );
  assert.ok(
    getHunger(state) > 40,
    "the pawn should have eaten during the acting test"
  );
}

function runReplayParityTest() {
  const initial = createStateWithPawn({
    systemState: {
      stamina: { cur: 95, max: 100 },
      hunger: { cur: 100, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
  });
  const timeline = createTimelineFromInitialState(initial);
  const live = deserializeGameState(serializeGameState(initial));

  advanceSeconds(live, PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC * 2);

  const rebuilt = rebuildStateAtSecond(
    timeline,
    PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC * 2
  );
  assert.equal(rebuilt?.ok, true, "rebuildStateAtSecond should succeed");

  assert.equal(
    getStamina(live),
    95 + PAWN_IDLE_STAMINA_REGEN_AMOUNT * 2,
    "live simulation should apply idle regen on each cadence"
  );
  assert.equal(
    getStamina(rebuilt.state),
    getStamina(live),
    "replay should match live idle stamina regen"
  );
  assert.equal(
    getHunger(rebuilt.state),
    getHunger(live),
    "replay should preserve the rest of pawn second processing alongside regen"
  );
}

runIdleCadenceAndClampTest();
runNoRegenWhileActingTest();
runReplayParityTest();
console.log("[test] Pawn idle stamina regen checks passed");
