import assert from "node:assert/strict";

import { createEmptyState } from "../src/model/state.js";
import { makePawnTooltipSpec } from "../src/views/pawn-tooltip-spec.js";

function installEnvTile(state, envCol, { revealed = true } = {}) {
  const col = Math.floor(envCol);
  const tile = {
    instanceId: 5000 + col,
    defId: "tile_floodplains",
    col,
    span: 1,
    tags: [],
    systemTiers: {},
    systemState: {},
  };
  state.board.occ.tile[col] = tile;
  state.board.layers.tile.anchors.push(tile);
  state.discovery.envCols[col] = {
    exposed: true,
    revealed,
  };
  return tile;
}

function createPawn(overrides = {}) {
  return {
    id: 101,
    pawnDefId: "default",
    role: "leader",
    name: "Tooltip Leader",
    envCol: 0,
    hubCol: null,
    systemTiers: {},
    systemState: {
      stamina: { cur: 10, max: 100 },
      hunger: { cur: 20, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
    workerCount: 2,
    leaderFaith: {
      tier: "gold",
      eatStreak: 0,
      decayElapsedSec: 0,
      failedEatWarnActive: false,
    },
    ai: {
      mode: "eat",
      assignedPlacement: { hubCol: null, envCol: 0 },
      returnState: "none",
      suppressAutoUntilSec: 0,
    },
    ...overrides,
  };
}

function assertLine(lines, expected, message) {
  assert.ok(lines.includes(expected), message ?? `missing tooltip line: ${expected}`);
}

function runLeaderHungryFaithRiskTooltipTest() {
  const state = createEmptyState(123);
  installEnvTile(state, 0);
  const pawn = createPawn({
    systemState: {
      stamina: { cur: 10, max: 100 },
      hunger: { cur: 20, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
    leaderFaith: {
      tier: "silver",
      eatStreak: 0,
      decayElapsedSec: 0,
      failedEatWarnActive: true,
    },
  });

  const spec = makePawnTooltipSpec(pawn, state);
  assert.equal(spec.title, "Tooltip Leader", "tooltip should use pawn name as title");
  assertLine(spec.lines, "Assigned tile: Floodplains", "leader tooltip should show assigned tile");
  assertLine(spec.lines, "Automata: seeking food", "leader tooltip should show seeking food state");
  assertLine(spec.lines, "AI mode: eat", "leader tooltip should show raw ai mode");
  assertLine(spec.lines, "Return state: none", "leader tooltip should show raw return state");
  assertLine(spec.lines, "Hungry", "leader tooltip should show hungry threshold");
  assertLine(spec.lines, "Tired", "leader tooltip should show tired threshold");
  assertLine(spec.lines, "Losing faith", "leader tooltip should show faith-risk threshold");
  assertLine(
    spec.lines,
    "Failed eat warning active",
    "leader tooltip should show failed eat warning state"
  );
  assertLine(
    spec.lines,
    "Faith: silver (decay when hunger <= 20)",
    "leader tooltip should show faith debug line"
  );
}

function runFollowerTiredOnlyTooltipTest() {
  const state = createEmptyState(456);
  installEnvTile(state, 0);
  const pawn = createPawn({
    id: 202,
    role: "follower",
    name: "Tooltip Follower",
    leaderFaith: null,
    workerCount: 0,
    systemState: {
      stamina: { cur: 10, max: 100 },
      hunger: { cur: 90, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
    ai: {
      mode: null,
      assignedPlacement: { hubCol: null, envCol: 0 },
      returnState: "none",
      suppressAutoUntilSec: 0,
    },
  });

  const spec = makePawnTooltipSpec(pawn, state);
  assertLine(spec.lines, "Automata: idle", "follower tooltip should show idle when no ai state is active");
  assertLine(spec.lines, "Tired", "follower tooltip should show tired threshold");
  assert.ok(
    !spec.lines.includes("Losing faith"),
    "follower tooltip should not show leader-only faith state"
  );
}

function runReturningToAssignedTooltipTest() {
  const state = createEmptyState(789);
  installEnvTile(state, 0);
  installEnvTile(state, 1);
  const pawn = createPawn({
    envCol: 1,
    ai: {
      mode: null,
      assignedPlacement: { hubCol: null, envCol: 0 },
      returnState: "ready",
      suppressAutoUntilSec: 0,
    },
  });

  const spec = makePawnTooltipSpec(pawn, state);
  assertLine(
    spec.lines,
    "Automata: returning to assigned tile",
    "ready return state should show returning automata label"
  );
  assertLine(spec.lines, "Current tile: Floodplains", "tooltip should show current tile label");
}

function runUnrevealedAssignedTileTooltipTest() {
  const state = createEmptyState(321);
  installEnvTile(state, 0, { revealed: false });
  installEnvTile(state, 1);
  const pawn = createPawn({
    envCol: 1,
    ai: {
      mode: "rest",
      assignedPlacement: { hubCol: null, envCol: 0 },
      returnState: "waitingForRest",
      suppressAutoUntilSec: 0,
    },
  });

  const spec = makePawnTooltipSpec(pawn, state);
  assertLine(
    spec.lines,
    "Assigned tile: ???",
    "unrevealed assigned env tiles should preserve ??? labelling"
  );
  assertLine(spec.lines, "Automata: seeking rest", "waitingForRest should show seeking rest");
}

runLeaderHungryFaithRiskTooltipTest();
runFollowerTiredOnlyTooltipTest();
runReturningToAssignedTooltipTest();
runUnrevealedAssignedTileTooltipTest();
console.log("[test] Pawn tooltip spec checks passed");
