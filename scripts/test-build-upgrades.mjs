import assert from "node:assert/strict";

import { ActionKinds, applyAction } from "../src/model/actions.js";
import { SEASON_DURATION_SEC, SEASONS } from "../src/defs/gamesettings/gamerules-defs.js";
import { hubStructureDefs } from "../src/defs/gamepieces/hub-structure-defs.js";
import { cmdBuildDesignate } from "../src/model/commands/build-commands.js";
import { updateGame, createInitialState } from "../src/model/game-model.js";
import { getBuildProcess } from "../src/model/build-helpers.js";
import { Inventory } from "../src/model/inventory-model.js";
import { deserializeGameState, serializeGameState } from "../src/model/state.js";
import {
  createTimelineFromInitialState,
  rebuildStateAtSecond,
  replaceActionsAtSecond,
} from "../src/model/timeline/index.js";

const YEAR_DURATION_SEC = Math.max(1, Math.floor(SEASON_DURATION_SEC * SEASONS.length));

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

function createHousingScenarioState({ faithTier = null } = {}) {
  const structure = { defId: "mudHouses", hubCol: 2 };
  if (faithTier) {
    structure.systemTiers = { faith: faithTier };
  }
  const state = createUpgradeScenarioState({ structures: [structure] });
  state.resources.population = 0;
  return state;
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

function getLeader(state, index = 0) {
  const leaders = (state?.pawns ?? []).filter((pawn) => pawn?.role === "leader");
  return leaders[index] ?? null;
}

function countEventsByType(state, type) {
  const feed = Array.isArray(state?.gameEventFeed) ? state.gameEventFeed : [];
  let count = 0;
  for (const entry of feed) {
    if (entry?.type === type) count += 1;
  }
  return count;
}

function getYearlyPopulationEntry(state, year) {
  const feed = Array.isArray(state?.gameEventFeed) ? state.gameEventFeed : [];
  for (const entry of feed) {
    if (entry?.type !== "populationYearlyUpdate") continue;
    if (Math.floor(entry?.data?.year ?? -1) !== Math.floor(year)) continue;
    return entry;
  }
  return null;
}

function advanceUntilYearlyPopulationEntry(state, year, maxSeconds = YEAR_DURATION_SEC + 4) {
  const limit = Math.max(1, Math.floor(maxSeconds));
  for (let i = 0; i < limit; i += 1) {
    if (getYearlyPopulationEntry(state, year)) return true;
    advanceSeconds(state, 1);
  }
  return !!getYearlyPopulationEntry(state, year);
}

function completeMudHousesUpgrade(state, { stockedFood = 0 } = {}) {
  assertOk(
    cmdBuildDesignate(state, {
      defId: "mudHouses",
      target: { hubCol: 3 },
    }),
    "designate mudHouses upgrade"
  );
  const structure = getStructureAtHubCol(state, 2);
  const process = getBuildProcess(structure);
  assert.ok(process, "expected mudHouses upgrade build process");

  if (Array.isArray(process.requirements)) {
    for (const req of process.requirements) {
      if (!req || typeof req !== "object") continue;
      req.progress = Math.max(0, Math.floor(req.amount ?? 0));
    }
  }
  process.progress = Math.max(0, Math.floor((process.durationSec ?? 1) - 1));

  if (stockedFood > 0) {
    const structureInv = state?.ownerInventories?.[structure.instanceId];
    assert.ok(structureInv, "expected housing inventory for food stock");
    const added = Inventory.addNewItem(state, structureInv, {
      kind: "roastedBarley",
      quantity: stockedFood,
      width: 1,
      height: 1,
      gridX: 0,
      gridY: 0,
    });
    assert.ok(added, "failed to seed housing food stock");
  }

  state.paused = false;
  advanceSeconds(state, 1);

  const upgraded = getStructureAtHubCol(state, 2);
  assert.ok(upgraded, "missing upgraded mudHouses structure");
  assert.equal(upgraded.defId, "mudHouses", "upgrade completion expected mudHouses");
  return upgraded;
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

function runPopulationDormantWithoutHousingTest() {
  const state = createUpgradeScenarioState();
  state.resources.population = 0;
  const leader = getLeader(state, 0);
  assert.ok(leader, "expected leader for dormant no-housing check");
  leader.leaderFaith.tier = "gold";
  const initialSkillPoints = Math.floor(leader.skillPoints ?? 0);

  assert.equal(
    advanceUntilYearlyPopulationEntry(state, 1),
    true,
    "expected year-1 yearly update to occur"
  );

  assert.equal(
    Math.floor(state?.resources?.population ?? -1),
    0,
    "population should remain zero without housing"
  );
  assert.equal(
    countEventsByType(state, "populationSeasonMeal"),
    0,
    "no residents should consume meals before attraction starts"
  );
  assert.equal(
    Math.floor(leader.skillPoints ?? -1),
    initialSkillPoints + 2,
    "leaders should gain year-end faith skill points while population is dormant"
  );

  const yearly = getYearlyPopulationEntry(state, 1);
  assert.ok(yearly, "expected year-1 population yearly update event");
  assert.equal(
    Math.floor(yearly?.data?.populationSkillPointsPerLeader ?? -1),
    0,
    "yearly update should report zero population skill points without residents"
  );
  assert.equal(
    Math.floor(yearly?.data?.faithSkillPointsPerLeader ?? -1),
    2,
    "yearly update should report leader faith skill points without housing"
  );
  assert.equal(
    Math.floor(yearly?.data?.skillPointsPerLeader ?? -1),
    2,
    "yearly update should award the leader faith skill points with dormant population"
  );
}

function runPopulationAttractionAfterHousingUpgradeTest() {
  const state = createUpgradeScenarioState();
  state.resources.population = 0;
  const leader = getLeader(state, 0);
  assert.ok(leader, "expected leader for housing attraction checks");
  const initialSkillPoints = Math.floor(leader.skillPoints ?? 0);

  const mudHouses = completeMudHousesUpgrade(state, { stockedFood: 400 });

  advanceSeconds(state, Math.max(1, YEAR_DURATION_SEC - 2));
  assert.equal(
    countEventsByType(state, "populationSeasonMeal"),
    0,
    "no seasonal resident meal checks should run before first attracted residents"
  );

  assert.equal(
    advanceUntilYearlyPopulationEntry(state, 1, 6),
    true,
    "expected year-1 yearly update after housing upgrade"
  );

  const firstYear = getYearlyPopulationEntry(state, 1);
  assert.ok(firstYear, "expected year-1 yearly population update after upgrade");
  assert.ok(
    Math.floor(firstYear?.data?.attractedPopulation ?? 0) > 0,
    "housing vacancy should attract residents on year-1 update"
  );
  assert.equal(
    Math.floor(firstYear?.data?.populationSkillPointsPerLeader ?? -1),
    0,
    "first attraction year should not yet award population skill points"
  );
  assert.equal(
    Math.floor(firstYear?.data?.faithSkillPointsPerLeader ?? -1),
    2,
    "first attraction year should award gold-tier faith skill points"
  );
  assert.equal(
    Math.floor(firstYear?.data?.skillPointsPerLeader ?? -1),
    2,
    "first attraction year should award faith-based skill points"
  );
  assert.equal(
    Math.floor(leader.skillPoints ?? -1),
    initialSkillPoints + 2,
    "leader skill points should gain the dormant gold-tier faith bonus"
  );

  const residents = mudHouses?.systemState?.residents ?? null;
  assert.ok(residents, "expected residents system report on mudHouses");
  assert.equal(
    Math.floor(residents?.housingCapacity ?? -1),
    12,
    "mudHouses should report configured housing capacity"
  );
  assert.equal(
    Math.floor(residents?.population ?? -1),
    Math.floor(state?.resources?.population ?? -2),
    "residents system should report current population"
  );
  assert.equal(
    Math.floor(residents?.housingVacancy ?? -1),
    Math.max(0, 12 - Math.floor(state?.resources?.population ?? 0)),
    "residents system should report current vacancy"
  );
  assert.ok(
    countEventsByType(state, "populationSeasonMeal") > 0,
    "seasonal resident meal checks should begin after first attraction"
  );

  const skillPointsBeforeSecondYear = Math.floor(leader.skillPoints ?? 0);
  assert.equal(
    advanceUntilYearlyPopulationEntry(state, 2),
    true,
    "expected year-2 yearly update after population activation"
  );

  const secondYear = getYearlyPopulationEntry(state, 2);
  assert.ok(secondYear, "expected year-2 yearly population update");
  assert.ok(
    Math.floor(secondYear?.data?.mealAttempts ?? 0) > 0,
    "population meals should be active in year-2 aggregation"
  );
  assert.ok(
    Math.floor(secondYear?.data?.populationSkillPointsPerLeader ?? 0) > 0,
    "year-2 update should award population skill points after population activation"
  );
  assert.equal(
    Math.floor(secondYear?.data?.faithSkillPointsPerLeader ?? -1),
    2,
    "year-2 update should still award gold-tier faith skill points"
  );
  assert.equal(
    Math.floor(secondYear?.data?.skillPointsPerLeader ?? -1),
    Math.floor(secondYear?.data?.populationSkillPointsPerLeader ?? 0) +
      Math.floor(secondYear?.data?.faithSkillPointsPerLeader ?? 0),
    "year-2 total should equal population plus faith skill points"
  );
  assert.equal(
    secondYear?.data?.faith?.active,
    true,
    "year-2 faith report should be active once population systems are running"
  );
  assert.equal(
    Math.floor(leader.skillPoints ?? -1),
    skillPointsBeforeSecondYear +
      Math.floor(secondYear?.data?.skillPointsPerLeader ?? 0),
    "leader skill points should increase by the combined yearly award"
  );
}

function runLeaderFaithTierSkillPointBonusMappingTest() {
  const expectedByTier = {
    bronze: 0,
    silver: 1,
    gold: 2,
    diamond: 3,
  };

  for (const [tier, expected] of Object.entries(expectedByTier)) {
    const state = createUpgradeScenarioState();
    state.resources.population = 0;
    const leader = getLeader(state, 0);
    assert.ok(leader, `expected leader for ${tier} leader-faith mapping check`);
    leader.leaderFaith.tier = tier;
    const initialSkillPoints = Math.floor(leader.skillPoints ?? 0);

    assert.equal(
      advanceUntilYearlyPopulationEntry(state, 1),
      true,
      `expected year-1 yearly update for ${tier} leader-faith mapping`
    );

    const yearly = getYearlyPopulationEntry(state, 1);
    assert.ok(yearly, `expected yearly entry for ${tier} leader-faith mapping`);
    assert.equal(
      Math.floor(yearly?.data?.populationSkillPointsPerLeader ?? -1),
      0,
      `${tier} dormant population should not award population skill points`
    );
    assert.equal(
      Math.floor(yearly?.data?.faithSkillPointsPerLeader ?? -1),
      expected,
      `${tier} leader faith tier should map to the expected skill point bonus`
    );
    assert.equal(
      Math.floor(yearly?.data?.skillPointsPerLeader ?? -1),
      expected,
      `${tier} total should equal the leader faith bonus when population is dormant`
    );
    assert.equal(
      Math.floor(leader.skillPoints ?? -1),
      initialSkillPoints + expected,
      `${tier} leader faith bonus should be added to leader skill points`
    );
  }
}

function run() {
  runUpgradeOnlyPlacementGateTest();
  runUpgradeDesignationFlowTest();
  runUpgradeCompletionTransformTest();
  runUpgradeMaxInstanceGateTest();
  runUpgradeRejectUnderConstructionSourceTest();
  runUpgradeReplayParityTest();
  runPopulationDormantWithoutHousingTest();
  runPopulationAttractionAfterHousingUpgradeTest();
  runLeaderFaithTierSkillPointBonusMappingTest();
  console.log("[test] Build upgrade checks passed");
}

run();
