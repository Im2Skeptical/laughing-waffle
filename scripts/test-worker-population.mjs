import assert from "node:assert/strict";

import { PRESTIGE_COST_PER_FOLLOWER } from "../src/defs/gamesettings/gamerules-defs.js";
import { ActionKinds, applyAction } from "../src/model/actions.js";
import { stepEnvSecond } from "../src/model/env-exec.js";
import { stepHubSecond } from "../src/model/hub-exec.js";
import { Inventory } from "../src/model/inventory-model.js";
import { stepPawnSecond } from "../src/model/pawn-exec.js";
import {
  adjustWorkerCount,
  enforceWorkerPopulationCap,
  getLeaderWorkerCount,
  getReservedPrestigeForLeaderTotal,
  getTotalAttachedWorkers,
  updateLeaderPrestigeEffective,
} from "../src/model/prestige-system.js";
import {
  createEmptyState,
  deserializeGameState,
  makeHubStructureInstance,
  rebuildBoardOccupancy,
  serializeGameState,
} from "../src/model/state.js";
import { createInitialState } from "../src/model/game-model.js";
import {
  appendActionAtCursor,
  createTimelineFromInitialState,
  rebuildStateAtSecond,
} from "../src/model/timeline/index.js";

function createInventory(state, ownerId, cols = 8, rows = 8) {
  const inv = Inventory.create(cols, rows);
  Inventory.init(inv);
  inv.version = 0;
  state.ownerInventories[ownerId] = inv;
  return inv;
}

function addItem(state, inv, kind, quantity, gridX = 0, gridY = 0) {
  const item = Inventory.addNewItem(state, inv, {
    kind,
    quantity,
    width: 1,
    height: 1,
    tier: "bronze",
    gridX,
    gridY,
  });
  assert.ok(item, `failed to add ${kind}`);
  return item;
}

function countItem(inv, kind) {
  let total = 0;
  for (const item of inv?.items || []) {
    if (!item || item.kind !== kind) continue;
    total += Math.max(0, Math.floor(item.quantity ?? 0));
  }
  return total;
}

function makeLeader(state, options = {}) {
  const leader = {
    id: Number.isFinite(options.id) ? Math.floor(options.id) : 101,
    pawnDefId: "default",
    name: options.name || "Leader",
    color: options.color ?? 0xffffff,
    hubCol: Number.isFinite(options.hubCol) ? Math.floor(options.hubCol) : null,
    envCol: Number.isFinite(options.envCol) ? Math.floor(options.envCol) : null,
    role: "leader",
    props: {},
    systemTiers: {},
    systemState: {
      stamina: {
        cur: Number.isFinite(options.stamina) ? Math.floor(options.stamina) : 10,
        max: 100,
      },
      hunger: {
        cur: Number.isFinite(options.hunger) ? Math.floor(options.hunger) : 100,
        max: 100,
      },
    },
    equipment: {
      head: null,
      body: null,
      mainHand: null,
      offHand: null,
      accessoryA: null,
      accessoryB: null,
    },
    totalDepositedAmountByTier: {},
    prestigeDebtByFollowerId: {},
    prestigeCapBase: Number.isFinite(options.prestigeCapBase)
      ? Math.floor(options.prestigeCapBase)
      : 0,
    prestigeCapBaseFromDeposits: Number.isFinite(options.prestigeCapBase)
      ? Math.floor(options.prestigeCapBase)
      : 0,
    prestigeCapBonus: 0,
    prestigeCapDebt: 0,
    workerCount: Number.isFinite(options.workerCount)
      ? Math.max(0, Math.floor(options.workerCount))
      : 0,
  };
  updateLeaderPrestigeEffective(leader);
  state.pawns.push(leader);
  const inv = createInventory(state, leader.id);
  return { leader, inv };
}

function addSingleEnvTile(state, tile) {
  state.board.cols = 1;
  state.board.layers.tile.anchors = [tile];
  state.board.layers.event.anchors = [];
  state.board.layers.envStructure.anchors = [];
  rebuildBoardOccupancy(state);
}

function makeFarmTile() {
  return {
    instanceId: 1,
    defId: "tile_floodplains",
    col: 0,
    span: 1,
    tags: ["farmable"],
    systemTiers: {},
    systemState: {
      growth: {
        selectedCropId: "barley",
        maturedPool: { bronze: 0, silver: 0, gold: 0, diamond: 0 },
        processes: [],
      },
      hydration: {
        sumRatio: 0,
      },
      fertility: {},
    },
  };
}

function getLastEventByType(state, type) {
  const events = Array.isArray(state?.gameEventFeed) ? state.gameEventFeed : [];
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === type) return events[i];
  }
  return null;
}

function runWorkerNormalizationTest() {
  const initial = createInitialState("devGym01", 123);
  const leader = initial.pawns.find((pawn) => pawn?.role === "leader");
  assert.ok(leader, "expected leader in initial state");
  assert.equal(getLeaderWorkerCount(leader), 0, "initial leaders should start with zero workers");

  delete leader.workerCount;
  const roundTrip = deserializeGameState(serializeGameState(initial));
  const roundTripLeader = roundTrip.pawns.find((pawn) => pawn?.id === leader.id);
  assert.ok(roundTripLeader, "round-trip leader missing");
  assert.equal(
    getLeaderWorkerCount(roundTripLeader),
    0,
    "workerCount should normalize to zero after serialize/deserialize"
  );
}

function runWorkerAdjustmentsTest() {
  const state = createEmptyState(123);
  state.paused = true;
  state.resources.population = 3;
  const { leader, inv } = makeLeader(state, {
    id: 101,
    envCol: 0,
    prestigeCapBase: 30,
  });
  addItem(state, inv, "roastedBarley", 2);

  const addRes = adjustWorkerCount(state, leader.id, 1);
  assert.equal(addRes?.ok, true, "adding a worker should succeed with food, prestige, and population");
  assert.equal(getLeaderWorkerCount(leader), 1, "worker count should increase");
  assert.equal(
    getReservedPrestigeForLeaderTotal(state, leader.id),
    PRESTIGE_COST_PER_FOLLOWER,
    "one worker should reserve one follower-sized prestige chunk"
  );
  assert.equal(countItem(inv, "roastedBarley"), 1, "adding a worker should consume one edible");

  const removeRes = adjustWorkerCount(state, leader.id, -1);
  assert.equal(removeRes?.ok, true, "removing a worker should succeed");
  assert.equal(getLeaderWorkerCount(leader), 0, "worker count should decrease");
  assert.equal(countItem(inv, "roastedBarley"), 1, "removing a worker should not refund food");
}

function runWorkerBlockingRulesTest() {
  const noFoodState = createEmptyState(200);
  noFoodState.resources.population = 2;
  const { leader: noFoodLeader } = makeLeader(noFoodState, {
    id: 201,
    envCol: 0,
    prestigeCapBase: 20,
  });
  const noFoodRes = adjustWorkerCount(noFoodState, noFoodLeader.id, 1);
  assert.equal(noFoodRes?.ok, false, "worker add should fail without edible food");
  assert.equal(noFoodRes?.reason, "insufficientFood", "food should gate worker add");

  const noPrestigeState = createEmptyState(201);
  noPrestigeState.resources.population = 2;
  const { leader: noPrestigeLeader, inv: noPrestigeInv } = makeLeader(noPrestigeState, {
    id: 202,
    envCol: 0,
    prestigeCapBase: 0,
  });
  addItem(noPrestigeState, noPrestigeInv, "roastedBarley", 1);
  const noPrestigeRes = adjustWorkerCount(noPrestigeState, noPrestigeLeader.id, 1);
  assert.equal(noPrestigeRes?.ok, false, "worker add should fail without prestige room");
  assert.equal(
    noPrestigeRes?.reason,
    "insufficientPrestige",
    "prestige reserve should gate worker add"
  );

  const noPopulationState = createEmptyState(202);
  noPopulationState.resources.population = 0;
  const { leader: noPopulationLeader, inv: noPopulationInv } = makeLeader(noPopulationState, {
    id: 203,
    envCol: 0,
    prestigeCapBase: 20,
  });
  addItem(noPopulationState, noPopulationInv, "roastedBarley", 1);
  const noPopulationRes = adjustWorkerCount(noPopulationState, noPopulationLeader.id, 1);
  assert.equal(noPopulationRes?.ok, false, "worker add should fail without population room");
  assert.equal(
    noPopulationRes?.reason,
    "populationCap",
    "population should cap total worker hires"
  );
}

function runWorkerPopulationCapTest() {
  const state = createEmptyState(300);
  state.resources.population = 1;
  const { leader: leaderA } = makeLeader(state, {
    id: 301,
    envCol: 0,
    prestigeCapBase: 20,
    workerCount: 1,
  });
  const { leader: leaderB } = makeLeader(state, {
    id: 302,
    envCol: 0,
    prestigeCapBase: 20,
    workerCount: 1,
  });

  const enforceRes = enforceWorkerPopulationCap(state);
  assert.equal(enforceRes?.ok, true, "population cap enforcement should succeed");
  assert.equal(getTotalAttachedWorkers(state), 1, "total workers should trim to the new population");
  assert.equal(getLeaderWorkerCount(leaderB), 0, "higher leader id should lose workers first");
  assert.equal(getLeaderWorkerCount(leaderA), 1, "lower leader id should keep workers when trimming");
}

function runSeasonalPopulationUnchangedTest() {
  const baseState = createInitialState("devGym01", 123);
  baseState.resources.population = 8;
  baseState._seasonChanged = true;
  baseState.gameEventFeed = [];
  baseState.nextGameEventFeedId = 1;
  stepHubSecond(baseState, 1);
  const baseEvent = getLastEventByType(baseState, "populationSeasonMeal");
  assert.ok(baseEvent, "season meal event missing in baseline state");

  const workerState = createInitialState("devGym01", 123);
  workerState.resources.population = 8;
  const workerLeader = workerState.pawns.find((pawn) => pawn?.role === "leader");
  assert.ok(workerLeader, "worker comparison leader missing");
  workerLeader.workerCount = 3;
  workerState._seasonChanged = true;
  workerState.gameEventFeed = [];
  workerState.nextGameEventFeedId = 1;
  stepHubSecond(workerState, 1);
  const workerEvent = getLastEventByType(workerState, "populationSeasonMeal");
  assert.ok(workerEvent, "season meal event missing in worker state");

  assert.equal(
    workerEvent.data?.mealAttempts,
    baseEvent.data?.mealAttempts,
    "seasonal population meal attempts should ignore worker count"
  );
  assert.equal(
    workerEvent.data?.mealSuccesses,
    baseEvent.data?.mealSuccesses,
    "seasonal population meal successes should ignore worker count"
  );
}

function runWorkerMealsOnLeaderEatTest() {
  const state = createEmptyState(400);
  const tile = {
    instanceId: 1,
    defId: "tile_hinterland",
    col: 0,
    span: 1,
    tags: [],
    systemTiers: {},
    systemState: {},
  };
  addSingleEnvTile(state, tile);
  const { leader, inv } = makeLeader(state, {
    id: 401,
    envCol: 0,
    hunger: 0,
    stamina: 10,
    prestigeCapBase: 30,
    workerCount: 2,
  });
  addItem(state, inv, "roastedBarley", 2);

  stepPawnSecond(state, 1);

  assert.equal(
    Math.floor(leader.systemState?.hunger?.cur ?? 0),
    20,
    "worker meals should not add extra hunger gain beyond the leader's own meal"
  );
  assert.equal(
    getLeaderWorkerCount(leader),
    1,
    "unpaid workers should leave after leader eat resolves"
  );
  assert.equal(countItem(inv, "roastedBarley"), 0, "leader eat and worker meals should consume available food");
}

function runEnvWorkerRepeatTest() {
  const state = createEmptyState(500);
  state.seasons = ["winter"];
  state.currentSeasonIndex = 0;
  const tile = makeFarmTile();
  addSingleEnvTile(state, tile);
  const { leader, inv } = makeLeader(state, {
    id: 501,
    envCol: 0,
    stamina: 10,
    prestigeCapBase: 30,
    workerCount: 2,
  });
  addItem(state, inv, "barley", 3);

  stepEnvSecond(state, 1);

  const processes = Array.isArray(tile.systemState?.growth?.processes)
    ? tile.systemState.growth.processes
    : [];
  const totalInputAmount = processes.reduce(
    (sum, process) => sum + Math.max(0, Math.floor(process?.inputAmount ?? 0)),
    0
  );

  assert.equal(processes.length, 3, "two workers should let one leader plant three seed batches in one second");
  assert.equal(totalInputAmount, 3, "farm planting should create three seeds worth of growth input");
  assert.equal(countItem(inv, "barley"), 0, "planting should consume three seeds");
  assert.equal(
    Math.floor(leader.systemState?.stamina?.cur ?? 0),
    7,
    "planting with two workers should spend three stamina"
  );
}

function runHubWorkerRepeatTest() {
  const state = createEmptyState(600);
  const structure = makeHubStructureInstance("hearth", state);
  structure.systemState.craft = {
    selectedRecipeId: null,
    recipePriority: {
      ordered: ["weaveBasket"],
      enabled: { weaveBasket: true },
    },
    processes: [],
  };
  state.hub.slots[0].structure = structure;
  rebuildBoardOccupancy(state);

  const { leader, inv } = makeLeader(state, {
    id: 601,
    hubCol: 0,
    stamina: 10,
    prestigeCapBase: 30,
    workerCount: 2,
  });
  addItem(state, inv, "reeds", 3);

  stepHubSecond(state, 1);

  const processes = Array.isArray(structure.systemState?.craft?.processes)
    ? structure.systemState.craft.processes
    : [];
  assert.equal(processes.length, 1, "crafting should create exactly one process");
  const process = processes[0];
  assert.equal(process?.type, "weaveBasket", "crafting should start the selected recipe");
  assert.equal(
    Math.floor(process?.requirements?.[0]?.progress ?? 0),
    2,
    "two workers should allow start plus two same-second craft work units"
  );
  assert.equal(countItem(inv, "reeds"), 1, "same-second craft work should consume two reeds");
  assert.equal(
    Math.floor(leader.systemState?.stamina?.cur ?? 0),
    7,
    "same-second craft repetitions should spend stamina per work unit"
  );
}

function runReplayWorkerActionTest() {
  const initial = createEmptyState(700);
  initial.paused = true;
  initial.resources.population = 1;
  const { leader, inv } = makeLeader(initial, {
    id: 701,
    envCol: 0,
    prestigeCapBase: 20,
  });
  addItem(initial, inv, "roastedBarley", 1);

  const action = {
    kind: ActionKinds.ADJUST_WORKER_COUNT,
    payload: { leaderId: leader.id, delta: 1 },
    apCost: 0,
  };

  const live = deserializeGameState(serializeGameState(initial));
  live.paused = true;
  const liveRes = applyAction(live, action);
  assert.equal(liveRes?.ok, true, "live worker action should succeed");

  const timeline = createTimelineFromInitialState(initial);
  const appendRes = appendActionAtCursor(timeline, action, initial);
  assert.equal(appendRes?.ok, true, "timeline append should succeed");
  const rebuilt = rebuildStateAtSecond(timeline, 0);
  assert.equal(rebuilt?.ok, true, "timeline rebuild should succeed");

  const liveLeader = live.pawns.find((pawn) => pawn?.id === leader.id);
  const rebuiltLeader = rebuilt.state.pawns.find((pawn) => pawn?.id === leader.id);
  assert.ok(liveLeader, "live leader missing after worker action");
  assert.ok(rebuiltLeader, "rebuilt leader missing after worker action");
  assert.equal(getLeaderWorkerCount(liveLeader), 1, "live state should gain one worker");
  assert.equal(getLeaderWorkerCount(rebuiltLeader), 1, "rebuilt state should reproduce worker action");
  assert.equal(
    countItem(live.ownerInventories[leader.id], "roastedBarley"),
    0,
    "live worker action should consume one edible"
  );
  assert.equal(
    countItem(rebuilt.state.ownerInventories[leader.id], "roastedBarley"),
    0,
    "rebuilt worker action should consume one edible"
  );
}

runWorkerNormalizationTest();
runWorkerAdjustmentsTest();
runWorkerBlockingRulesTest();
runWorkerPopulationCapTest();
runSeasonalPopulationUnchangedTest();
runWorkerMealsOnLeaderEatTest();
runEnvWorkerRepeatTest();
runHubWorkerRepeatTest();
runReplayWorkerActionTest();

console.log("[test] Worker population checks passed");
