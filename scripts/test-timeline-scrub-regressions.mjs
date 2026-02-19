import assert from "node:assert/strict";

import { createSimRunner } from "../src/controllers/sim-runner.js";
import { ActionKinds } from "../src/model/actions.js";
import {
  getStateDataAtSecond,
  rebuildStateAtSecond,
} from "../src/model/timeline/index.js";
import { createTimeGraphController } from "../src/model/timegraph-controller.js";
import { GRAPH_METRICS } from "../src/model/graph-metrics.js";
import { cropDefs } from "../src/defs/gamepieces/crops-defs.js";
import { envTagDefs } from "../src/defs/gamesystems/env-tags-defs.js";
import { deserializeGameState } from "../src/model/state.js";
import { createInitialState } from "../src/model/game-model.js";
import { computeAvailableRecipesAndBuildings } from "../src/model/skills.js";

function assertOk(res, label) {
  assert.equal(res?.ok, true, `${label} failed: ${JSON.stringify(res)}`);
}

function firstWalkableEnvCol(state, { exclude = new Set() } = {}) {
  const cols = Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 0;
  for (let col = 0; col < cols; col += 1) {
    if (exclude.has(col)) continue;
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) continue;
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    const blocked = tags.some((tagId) => {
      const aff = Array.isArray(envTagDefs?.[tagId]?.affordances)
        ? envTagDefs[tagId].affordances
        : [];
      return aff.includes("noOccupy");
    });
    if (!blocked) return col;
  }
  return null;
}

function firstFarmableEnvCol(state) {
  const cols = Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 0;
  for (let col = 0; col < cols; col += 1) {
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) continue;
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    if (tags.includes("farmable")) return col;
  }
  return null;
}

function summarizeState(state) {
  const pawns = (state?.pawns ?? [])
    .map((p) => ({
      id: p.id,
      hubCol: p.hubCol ?? null,
      envCol: p.envCol ?? null,
    }))
    .sort((a, b) => a.id - b.id);

  const tileCrops = [];
  const tileTagDisabled = [];
  const cols = Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 0;
  for (let col = 0; col < cols; col += 1) {
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) continue;
    const cropId = tile?.systemState?.growth?.selectedCropId ?? null;
    if (cropId != null) {
      tileCrops.push({ col, cropId: String(cropId) });
    }
    const tagStates = tile?.tagStates ?? {};
    for (const [tagId, tagState] of Object.entries(tagStates)) {
      if (!tagState || typeof tagState !== "object") continue;
      if (tagState.disabled === true) {
        tileTagDisabled.push(`${col}:${tagId}`);
      }
    }
  }

  tileCrops.sort((a, b) => a.col - b.col || a.cropId.localeCompare(b.cropId));
  tileTagDisabled.sort();

  return { pawns, tileCrops, tileTagDisabled };
}

function assertControllerParity(controller, timeline, sec, label) {
  const fromController = controller.getStateAt(sec);
  const rebuilt = rebuildStateAtSecond(timeline, sec);
  assertOk(rebuilt, `${label} rebuild @${sec}`);
  assert.ok(fromController, `${label} controller null @${sec}`);
  assert.deepEqual(
    summarizeState(fromController),
    summarizeState(rebuilt.state),
    `${label} controller parity mismatch @${sec}`
  );
}

function assertPawnAt(stateData, pawnId, envCol, label) {
  const pawn = (stateData?.pawns ?? []).find((p) => p.id === pawnId);
  assert.ok(pawn, `${label}: pawn ${pawnId} missing`);
  assert.equal(pawn.hubCol ?? null, null, `${label}: pawn ${pawnId} expected no hub`);
  assert.equal(pawn.envCol ?? null, envCol, `${label}: pawn ${pawnId} expected env ${envCol}`);
}

function runScenarioSkillProgressionOverrideChecks() {
  const scenario = {
    rngSeed: 123,
    skillProgressionDefs: {
      defaultStartingSkillPoints: 2,
      startingSkillPointsByPawnDefId: {
        default: 4,
      },
      defaultUnlockedRecipes: ["roastBarley"],
      defaultUnlockedHubStructures: ["granary"],
    },
    board: {
      cols: 1,
      tiles: ["tile_hinterland"],
    },
    hub: {
      cols: 10,
      structures: [{ defId: "granary", hubCol: 0 }],
    },
    pawns: [{ name: "Override Pawn", role: "leader", hubCol: 0 }],
  };

  const state = createInitialState(scenario);
  assert.equal(
    state?.pawns?.[0]?.skillPoints,
    4,
    "scenario skillProgressionDefs should set default starting skill points"
  );

  const availability = computeAvailableRecipesAndBuildings(state);
  assert.deepEqual(
    Array.from(availability.recipeIds.values()),
    ["roastBarley"],
    "scenario skillProgressionDefs should override default unlocked recipes"
  );
  assert.deepEqual(
    Array.from(availability.hubStructureIds.values()),
    ["granary"],
    "scenario skillProgressionDefs should override default unlocked hub structures"
  );

  const explicitPawnScenario = {
    ...scenario,
    pawns: [{ name: "Explicit Pawn", role: "leader", hubCol: 0, skillPoints: 9 }],
  };
  const explicitState = createInitialState(explicitPawnScenario);
  assert.equal(
    explicitState?.pawns?.[0]?.skillPoints,
    9,
    "explicit pawn skillPoints should still override progression defaults"
  );
}

function run() {
  runScenarioSkillProgressionOverrideChecks();

  const runner = createSimRunner({ setupId: "testing" });
  runner.init();
  assertOk(runner.commitCursorSecond(0), "pause at t=0");

  // Avoid AP-gating noise in this correctness regression test.
  assertOk(
    runner.dispatchAction(ActionKinds.DEBUG_SET_CAP, {
      enabled: true,
      cap: 9999,
      points: 9999,
    }),
    "debug cap setup"
  );

  const timeline = runner.getTimeline();
  const planner = runner.getActionPlanner();
  const cursorState = runner.getCursorState();
  assert.ok(cursorState?.paused, "runner should be paused for planner edits");

  const controller = createTimeGraphController({
    getTimeline: () => runner.getTimeline(),
    getCursorState: () => runner.getCursorState(),
    metric: GRAPH_METRICS.ap,
  });
  controller.setActive(true);
  controller.ensureCache();

  const pawn = cursorState.pawns?.[0];
  assert.ok(pawn?.id != null, "expected at least one pawn");

  const firstEnvCol = firstWalkableEnvCol(cursorState);
  assert.ok(Number.isFinite(firstEnvCol), "expected a walkable env column");

  assertOk(
    planner.setPawnMoveIntent({
      pawnId: pawn.id,
      toEnvCol: firstEnvCol,
    }),
    "first pawn move intent"
  );
  assert.equal(runner.getLastPlannerCommitError(), null, "unexpected planner commit error (first move)");
  controller.handleInvalidate("test:firstPawnMove");

  const stateDataAfterFirstMove = getStateDataAtSecond(timeline, 0);
  assertOk(stateDataAfterFirstMove, "stateData@0 after first move");
  assertPawnAt(
    deserializeGameState(stateDataAfterFirstMove.stateData),
    pawn.id,
    firstEnvCol,
    "first move @0"
  );
  assertControllerParity(controller, timeline, 0, "first move");
  assertControllerParity(controller, timeline, 1, "first move");

  const secondEnvCol = firstWalkableEnvCol(cursorState, {
    exclude: new Set([firstEnvCol]),
  });
  assert.ok(Number.isFinite(secondEnvCol), "expected a second walkable env column");

  assertOk(
    planner.setPawnMoveIntent({
      pawnId: pawn.id,
      toEnvCol: secondEnvCol,
    }),
    "second pawn move intent"
  );
  assert.equal(runner.getLastPlannerCommitError(), null, "unexpected planner commit error (second move)");
  controller.handleInvalidate("test:secondPawnMove");

  const stateDataAfterSecondMove = getStateDataAtSecond(timeline, 0);
  assertOk(stateDataAfterSecondMove, "stateData@0 after second move");
  assertPawnAt(
    deserializeGameState(stateDataAfterSecondMove.stateData),
    pawn.id,
    secondEnvCol,
    "second move @0"
  );
  assertControllerParity(controller, timeline, 0, "second move");
  assertControllerParity(controller, timeline, 1, "second move");

  const farmCol = firstFarmableEnvCol(cursorState);
  assert.ok(Number.isFinite(farmCol), "expected a farmable tile");
  const cropId = Object.keys(cropDefs)[0] ?? null;
  assert.ok(cropId, "expected at least one crop def");

  assertOk(
    planner.setTileCropSelectionIntent({
      envCol: farmCol,
      cropId,
    }),
    "tile crop selection intent"
  );
  assert.equal(runner.getLastPlannerCommitError(), null, "unexpected planner commit error (crop select)");
  controller.handleInvalidate("test:cropSelect");

  const stateDataAfterCropSelect = getStateDataAtSecond(timeline, 0);
  assertOk(stateDataAfterCropSelect, "stateData@0 after crop select");
  const cropStateAtSec0 = deserializeGameState(stateDataAfterCropSelect.stateData);
  const cropAtSec0 =
    cropStateAtSec0?.board?.occ?.tile?.[farmCol]?.systemState?.growth
      ?.selectedCropId ?? null;
  assert.equal(cropAtSec0, cropId, "crop selection should be present at t=0");
  assertControllerParity(controller, timeline, 0, "crop select");
  assertControllerParity(controller, timeline, 1, "crop select");

  const tile = cursorState?.board?.occ?.tile?.[farmCol];
  const tagId = Array.isArray(tile?.tags) && tile.tags.length ? tile.tags[0] : null;
  assert.ok(tagId, "expected a tile tag to toggle");
  const currentDisabled = tile?.tagStates?.[tagId]?.disabled === true;
  assertOk(
    planner.setTileTagToggleIntent({
      envCol: farmCol,
      tagId,
      disabled: !currentDisabled,
    }),
    "tile tag toggle intent"
  );
  assert.equal(runner.getLastPlannerCommitError(), null, "unexpected planner commit error (tile tag toggle)");
  controller.handleInvalidate("test:tagToggle");

  const stateDataAfterTagToggle = getStateDataAtSecond(timeline, 0);
  assertOk(stateDataAfterTagToggle, "stateData@0 after tile tag toggle");
  const tagStateAtSec0 = deserializeGameState(stateDataAfterTagToggle.stateData);
  const disabledAtSec0 =
    tagStateAtSec0?.board?.occ?.tile?.[farmCol]?.tagStates?.[tagId]
      ?.disabled === true;
  assert.equal(
    disabledAtSec0,
    !currentDisabled,
    "tile tag toggle should be present at t=0"
  );
  assertControllerParity(controller, timeline, 0, "tag toggle");
  assertControllerParity(controller, timeline, 1, "tag toggle");

  console.log("[test] Timeline scrub regression checks passed");
}

run();
