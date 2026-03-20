import assert from "node:assert/strict";

import {
  PAWN_IDLE_STAMINA_REGEN_AMOUNT,
  PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC,
} from "../src/defs/gamesettings/gamerules-defs.js";
import { hubTagDefs } from "../src/defs/gamesystems/hub-tag-defs.js";
import { Inventory } from "../src/model/inventory-model.js";
import { placePawn, updateGame } from "../src/model/game-model.js";
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

const TEST_REST_TAG_ID = "testRestSpot";

function ensureTestRestTag() {
  if (hubTagDefs[TEST_REST_TAG_ID]) return;
  hubTagDefs[TEST_REST_TAG_ID] = {
    id: TEST_REST_TAG_ID,
    kind: "hubTag",
    ui: { name: "Test Rest", description: "Test-only rest spot." },
    affordances: ["restSpot"],
    systems: [],
    passives: [],
    intents: [],
  };
}

function createBasePawn(overrides = {}) {
  const envCol = Number.isFinite(overrides?.envCol) ? Math.floor(overrides.envCol) : 0;
  const hubCol = Number.isFinite(overrides?.hubCol) ? Math.floor(overrides.hubCol) : null;
  return {
    id: Number.isFinite(overrides?.id) ? Math.floor(overrides.id) : 101,
    pawnDefId: "default",
    role: "leader",
    name: "Test Leader",
    envCol,
    hubCol,
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
  createInventory(state, state.pawns[0].id, 5, 3);
  return state;
}

function createInventory(state, ownerId, cols = 8, rows = 8) {
  const inv = Inventory.create(cols, rows);
  Inventory.init(inv);
  inv.version = 0;
  state.ownerInventories[ownerId] = inv;
  return inv;
}

function installEnvTile(state, envCol, overrides = {}) {
  const col = Math.floor(envCol);
  const tile = {
    instanceId: 1000 + col,
    defId: "tile_floodplains",
    col,
    span: 1,
    tags: [],
    systemTiers: {},
    systemState: {},
    ...overrides,
  };
  state.board.occ.tile[col] = tile;
  state.board.layers.tile.anchors.push(tile);
  return tile;
}

function installHubStructure(state, hubCol, overrides = {}) {
  const col = Math.floor(hubCol);
  const structure = {
    instanceId: 2000 + col,
    defId: "granary",
    col,
    span: 1,
    tags: [],
    systemTiers: {},
    systemState: {},
    ...overrides,
  };
  state.hub.slots[col] = { structure };
  state.hub.occ[col] = structure;
  state.hub.anchors.push(structure);
  return structure;
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

function getPlacement(pawn) {
  return {
    hubCol: Number.isFinite(pawn?.hubCol) ? Math.floor(pawn.hubCol) : null,
    envCol: Number.isFinite(pawn?.envCol) ? Math.floor(pawn.envCol) : null,
  };
}

function getAssignedPlacement(pawn) {
  return {
    hubCol: Number.isFinite(pawn?.ai?.assignedPlacement?.hubCol)
      ? Math.floor(pawn.ai.assignedPlacement.hubCol)
      : null,
    envCol: Number.isFinite(pawn?.ai?.assignedPlacement?.envCol)
      ? Math.floor(pawn.ai.assignedPlacement.envCol)
      : null,
  };
}

function assertPlacement(actual, expected, message) {
  assert.deepEqual(getPlacement(actual), expected, message);
}

function assertAssignedPlacement(actual, expected, message) {
  assert.deepEqual(getAssignedPlacement(actual), expected, message);
}

function advanceSeconds(state, seconds) {
  const frames = Math.max(0, Math.floor(seconds * 60));
  for (let i = 0; i < frames; i += 1) {
    updateGame(1 / 60, state);
  }
}

function createRestDetourState() {
  ensureTestRestTag();
  const state = createStateWithPawn({
    systemState: {
      stamina: { cur: 20, max: 21 },
      hunger: { cur: 100, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
  });
  installEnvTile(state, 0);
  installHubStructure(state, 1, { tags: [TEST_REST_TAG_ID] });
  return state;
}

function createEatDetourState() {
  const state = createStateWithPawn({
    systemState: {
      stamina: { cur: 95, max: 100 },
      hunger: { cur: 40, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
  });
  installEnvTile(state, 0);
  const structure = installHubStructure(state, 0);
  const structureInv = createInventory(state, structure.instanceId);
  Inventory.addNewItem(state, structureInv, {
    kind: "dates",
    quantity: 1,
    gridX: 0,
    gridY: 0,
  });
  return state;
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

  const inv = createInventory(state, pawn.id);
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

function runRestDetourReturnTest() {
  const state = createRestDetourState();

  advanceSeconds(state, 1);
  let leader = getLeader(state);
  assertPlacement(
    leader,
    { hubCol: 1, envCol: null },
    "rest detour should move to the rest spot first"
  );
  assertAssignedPlacement(
    leader,
    { hubCol: null, envCol: 0 },
    "rest detour should preserve the assigned tile"
  );
  assert.equal(
    leader?.ai?.returnState,
    "waitingForRest",
    "rest detour should wait for full stamina before returning"
  );

  advanceSeconds(state, PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC - 1);
  leader = getLeader(state);
  assertPlacement(
    leader,
    { hubCol: null, envCol: 0 },
    "rest detour should return to assigned tile when stamina fills"
  );
  assert.equal(
    leader?.ai?.returnState,
    "none",
    "rest return should clear the pending return state"
  );
  assert.equal(getStamina(state), 21, "rest return should happen on the fill tick");
}

function runRestReplayParityTest() {
  const initial = createRestDetourState();
  const timeline = createTimelineFromInitialState(initial);
  const live = deserializeGameState(serializeGameState(initial));

  advanceSeconds(live, PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC);

  const rebuilt = rebuildStateAtSecond(timeline, PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC);
  assert.equal(rebuilt?.ok, true, "rest detour replay rebuild should succeed");

  const liveLeader = getLeader(live);
  const rebuiltLeader = getLeader(rebuilt.state);
  assertPlacement(
    liveLeader,
    { hubCol: null, envCol: 0 },
    "live rest detour should end back on assigned tile"
  );
  assert.deepEqual(
    getPlacement(rebuiltLeader),
    getPlacement(liveLeader),
    "rest detour replay should match live placement"
  );
  assert.deepEqual(
    getAssignedPlacement(rebuiltLeader),
    getAssignedPlacement(liveLeader),
    "rest detour replay should preserve assigned placement"
  );
  assert.equal(
    rebuiltLeader?.ai?.returnState,
    liveLeader?.ai?.returnState,
    "rest detour replay should match return state"
  );
}

function runEatDetourReturnTest() {
  const state = createEatDetourState();

  advanceSeconds(state, 1);

  const leader = getLeader(state);
  assertPlacement(
    leader,
    { hubCol: null, envCol: 0 },
    "eat detour should return to assigned tile in the same pawn-second"
  );
  assertAssignedPlacement(
    leader,
    { hubCol: null, envCol: 0 },
    "eat detour should preserve the assigned tile"
  );
  assert.equal(
    leader?.ai?.returnState,
    "none",
    "successful eat return should clear the return state"
  );
  assert.ok(getHunger(state) > 40, "eat detour should consume food successfully");
}

function runEatFailureFallbackToRestTest() {
  const state = createRestDetourState();
  const leader = getLeader(state);
  leader.systemState.hunger.cur = 40;

  advanceSeconds(state, 1);
  assertPlacement(
    leader,
    { hubCol: 1, envCol: null },
    "eat failure should fall back to the rest spot"
  );
  assert.equal(
    leader?.ai?.returnState,
    "waitingForRest",
    "eat fallback should switch the return state to rest waiting"
  );

  advanceSeconds(state, PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC - 2);
  assertPlacement(
    leader,
    { hubCol: 1, envCol: null },
    "eat fallback should not return before stamina is full"
  );

  advanceSeconds(state, 1);
  assertPlacement(
    leader,
    { hubCol: null, envCol: 0 },
    "eat fallback should return once the rest detour completes"
  );
  assert.equal(
    leader?.ai?.returnState,
    "none",
    "eat fallback return should clear the return state"
  );
}

function runDeliberateMoveUpdatesAssignmentTest() {
  const state = createStateWithPawn();
  installEnvTile(state, 0);
  installEnvTile(state, 1);
  const leader = getLeader(state);
  leader.ai = {
    mode: "eat",
    assignedPlacement: { hubCol: null, envCol: 0 },
    returnState: "ready",
    suppressAutoUntilSec: 0,
  };

  const moveRes = placePawn(state, {
    pawnId: leader.id,
    toPlacement: { envCol: 1 },
  });
  assert.equal(moveRes?.ok, true, "manual move should succeed");
  assertPlacement(
    leader,
    { hubCol: null, envCol: 1 },
    "manual move should update live placement"
  );
  assertAssignedPlacement(
    leader,
    { hubCol: null, envCol: 1 },
    "manual move should update assigned placement"
  );
  assert.equal(
    leader?.ai?.returnState,
    "none",
    "manual move should clear any pending return state"
  );
}

function runFollowerAutoFollowAssignmentTest() {
  const state = createEmptyState(6789);
  installEnvTile(state, 0);
  installEnvTile(state, 1);
  state.pawns = [
    createBasePawn({ id: 101, role: "leader", envCol: 0, hubCol: null }),
    createBasePawn({
      id: 202,
      role: "follower",
      name: "Follower",
      envCol: 0,
      hubCol: null,
      leaderId: 101,
      followerCreationOrderIndex: 1,
      ai: {
        mode: null,
        assignedPlacement: { hubCol: null, envCol: 0 },
        returnState: "ready",
        suppressAutoUntilSec: 0,
      },
    }),
  ];

  const moveRes = placePawn(state, {
    pawnId: 101,
    toPlacement: { envCol: 1 },
  });
  assert.equal(moveRes?.ok, true, "leader move should succeed");

  const follower = state.pawns.find((pawn) => pawn?.id === 202);
  assertPlacement(
    follower,
    { hubCol: null, envCol: 1 },
    "followers should auto-follow the leader's deliberate move"
  );
  assertAssignedPlacement(
    follower,
    { hubCol: null, envCol: 1 },
    "follower auto-follow should update follower assigned placement"
  );
  assert.equal(
    follower?.ai?.returnState,
    "none",
    "follower auto-follow should clear follower return state"
  );
}

runIdleCadenceAndClampTest();
runNoRegenWhileActingTest();
runRestDetourReturnTest();
runRestReplayParityTest();
runEatDetourReturnTest();
runEatFailureFallbackToRestTest();
runDeliberateMoveUpdatesAssignmentTest();
runFollowerAutoFollowAssignmentTest();
console.log("[test] Pawn idle stamina regen and assigned-tile checks passed");
