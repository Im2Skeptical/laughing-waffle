import assert from "node:assert/strict";

import { ActionKinds, applyAction } from "../src/model/actions.js";
import { hubStructureDefs } from "../src/defs/gamepieces/hub-structure-defs.js";
import { cmdBuildDesignate } from "../src/model/commands/build-commands.js";
import { updateGame, createInitialState } from "../src/model/game-model.js";
import { getBuildProcess } from "../src/model/build-helpers.js";
import { deserializeGameState, serializeGameState } from "../src/model/state.js";
import {
  createTimelineFromInitialState,
  rebuildStateAtSecond,
  replaceActionsAtSecond,
} from "../src/model/timeline/index.js";

function assertOk(res, label) {
  assert.equal(res?.ok, true, `${label} failed: ${JSON.stringify(res)}`);
}

function createUpgradeScenarioState({
  structures = [{ defId: "makeshiftShelter", hubCol: 2 }],
} = {}) {
  return createInitialState({
    rngSeed: 123,
    skillProgressionDefs: {
      defaultUnlockedRecipes: ["__none__"],
      defaultUnlockedHubStructures: ["makeshiftShelter", "mudHouses"],
    },
    board: {
      cols: 2,
      tiles: ["tile_hinterland", "tile_hinterland"],
    },
    hub: {
      cols: 10,
      structures,
    },
    pawns: [{ name: "Builder", role: "leader", hubCol: 2 }],
  });
}

function getStructureAtHubCol(state, hubCol) {
  return state?.hub?.occ?.[hubCol] ?? state?.hub?.slots?.[hubCol]?.structure ?? null;
}

function summarizeHubStructure(state, hubCol) {
  const structure = getStructureAtHubCol(state, hubCol);
  if (!structure) return null;
  return {
    instanceId: structure.instanceId ?? null,
    defId: structure.defId ?? null,
    tags: Array.isArray(structure.tags) ? structure.tags.slice().sort() : [],
    hasBuildProcess: !!getBuildProcess(structure),
  };
}

function advanceSeconds(state, seconds) {
  const totalFrames = Math.max(0, Math.floor(seconds * 60));
  for (let i = 0; i < totalFrames; i += 1) {
    updateGame(1 / 60, state);
  }
}

function runUpgradeOnlyPlacementGateTest() {
  const state = createUpgradeScenarioState({ structures: [] });
  const res = cmdBuildDesignate(state, {
    defId: "mudHouses",
    target: { hubCol: 2 },
  });
  assert.equal(res?.ok, false, "mudHouses should reject empty-slot direct placement");
  assert.equal(res?.reason, "noUpgradeSource");
}

function runUpgradeDesignationFlowTest() {
  const state = createUpgradeScenarioState();
  const source = getStructureAtHubCol(state, 2);
  assert.ok(source, "expected source makeshift shelter at hub col 2");
  assert.equal(source.defId, "makeshiftShelter");
  const sourceId = source.instanceId;

  const res = cmdBuildDesignate(state, {
    defId: "mudHouses",
    target: { hubCol: 3 },
  });
  assertOk(res, "upgrade designation");
  assert.equal(res.result, "buildUpgradeDesignated");
  assert.equal(res.hubCol, 2, "upgrade should normalize to source anchor column");

  const upgraded = getStructureAtHubCol(state, 2);
  assert.ok(upgraded, "upgraded source structure missing");
  assert.equal(
    upgraded.instanceId,
    sourceId,
    "upgrade designation should reuse existing structure instance"
  );
  assert.equal(upgraded.defId, "makeshiftShelter", "defId should transform only on completion");
  assert.ok(
    Array.isArray(upgraded.tags) && upgraded.tags.includes("build"),
    "upgrade designation should append build tag"
  );

  const buildProcess = getBuildProcess(upgraded);
  assert.ok(buildProcess, "upgrade designation should seed build process");
  assert.equal(buildProcess.buildDefId, "mudHouses");
}

function runUpgradeCompletionTransformTest() {
  const state = createUpgradeScenarioState();
  assertOk(
    cmdBuildDesignate(state, {
      defId: "mudHouses",
      target: { hubCol: 3 },
    }),
    "designation before completion"
  );
  const structure = getStructureAtHubCol(state, 2);
  const process = getBuildProcess(structure);
  assert.ok(process, "expected active build process before completion");

  if (Array.isArray(process.requirements)) {
    for (const req of process.requirements) {
      if (!req || typeof req !== "object") continue;
      req.progress = Math.max(0, Math.floor(req.amount ?? 0));
    }
  }
  process.progress = Math.max(0, Math.floor((process.durationSec ?? 1) - 1));

  state.paused = false;
  advanceSeconds(state, 1);

  const completed = getStructureAtHubCol(state, 2);
  assert.ok(completed, "completed structure missing");
  assert.equal(completed.defId, "mudHouses", "completion should transform defId");
  assert.ok(
    Array.isArray(completed.tags) && completed.tags.includes("canHouse"),
    "completion should apply target structure tags"
  );
  assert.ok(
    !Array.isArray(completed.tags) || !completed.tags.includes("build"),
    "completion should remove temporary build tag"
  );
  assert.equal(
    !!getBuildProcess(completed),
    false,
    "completion should clear build process"
  );
}

function runUpgradeMaxInstanceGateTest() {
  const state = createUpgradeScenarioState({
    structures: [
      { defId: "mudHouses", hubCol: 0 },
      { defId: "makeshiftShelter", hubCol: 3 },
    ],
  });
  const res = cmdBuildDesignate(state, {
    defId: "mudHouses",
    target: { hubCol: 3 },
  });
  assert.equal(res?.ok, false, "upgrade should respect mudHouses maxInstances");
  assert.equal(res?.reason, "maxInstancesReached");
}

function runUpgradeRejectUnderConstructionSourceTest() {
  const state = createUpgradeScenarioState({ structures: [] });
  assertOk(
    cmdBuildDesignate(state, { defId: "makeshiftShelter", target: { hubCol: 2 } }),
    "seed source under construction"
  );
  const res = cmdBuildDesignate(state, {
    defId: "mudHouses",
    target: { hubCol: 2 },
  });
  assert.equal(res?.ok, false, "upgrade should reject under-construction source");
  assert.equal(res?.reason, "upgradeSourceUnderConstruction");
}

function runUpgradeReplayParityTest() {
  const originalBuildDef = JSON.parse(
    JSON.stringify(hubStructureDefs.mudHouses.build || {})
  );

  hubStructureDefs.mudHouses.build = {
    ...originalBuildDef,
    laborSec: 1,
    requirements: [],
  };

  try {
    const initialState = createUpgradeScenarioState();
    const action = {
      kind: ActionKinds.BUILD_DESIGNATE,
      apCost: 0,
      payload: {
        defId: "mudHouses",
        target: { hubCol: 3 },
      },
    };

    const liveState = deserializeGameState(serializeGameState(initialState));
    liveState.paused = true;
    assertOk(applyAction(liveState, action), "live upgrade action apply");
    liveState.paused = false;
    advanceSeconds(liveState, 2);

    const timeline = createTimelineFromInitialState(initialState);
    assertOk(
      replaceActionsAtSecond(timeline, 0, [action]),
      "timeline upgrade action replace"
    );
    const rebuilt = rebuildStateAtSecond(timeline, 2);
    assertOk(rebuilt, "upgrade replay rebuild");

    assert.deepEqual(
      summarizeHubStructure(liveState, 2),
      summarizeHubStructure(rebuilt.state, 2),
      "live and replay state should match after upgrade completion"
    );
  } finally {
    hubStructureDefs.mudHouses.build = originalBuildDef;
  }
}

function run() {
  runUpgradeOnlyPlacementGateTest();
  runUpgradeDesignationFlowTest();
  runUpgradeCompletionTransformTest();
  runUpgradeMaxInstanceGateTest();
  runUpgradeRejectUnderConstructionSourceTest();
  runUpgradeReplayParityTest();
  console.log("[test] Build upgrade checks passed");
}

run();
