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
import { ENV_EVENT_DRAW_CADENCE_SEC } from "../src/defs/gamesettings/gamerules-defs.js";
import { deserializeGameState } from "../src/model/state.js";
import { createInitialState } from "../src/model/game-model.js";
import { computeAvailableRecipesAndBuildings } from "../src/model/skills.js";

function assertOk(res, label) {
  assert.equal(res?.ok, true, `${label} failed: ${JSON.stringify(res)}`);
}

function toSafeSec(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
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

function getEnvDeckDrawEntriesAtSecond(stateLike, tSec) {
  const targetSec = toSafeSec(tSec);
  const feed = Array.isArray(stateLike?.gameEventFeed) ? stateLike.gameEventFeed : [];
  return feed.filter((entry) => {
    if (!entry || entry.type !== "envDeckDraw") return false;
    return toSafeSec(entry.tSec) === targetSec;
  });
}

function normalizeDeckDrawEntry(entry) {
  const data = entry?.data && typeof entry.data === "object" ? entry.data : {};
  const placementsRaw = Array.isArray(data.placements) ? data.placements : [];
  const placements = placementsRaw
    .map((placement) => ({
      col: Number.isFinite(placement?.col) ? Math.floor(placement.col) : null,
      span:
        Number.isFinite(placement?.span) && placement.span > 0
          ? Math.floor(placement.span)
          : 1,
      instanceId: Number.isFinite(placement?.instanceId)
        ? Math.floor(placement.instanceId)
        : null,
    }))
    .filter((placement) => placement.col != null)
    .sort(
      (a, b) =>
        a.col - b.col ||
        (a.instanceId ?? Number.MAX_SAFE_INTEGER) -
          (b.instanceId ?? Number.MAX_SAFE_INTEGER)
    );
  return {
    type: entry?.type ?? null,
    tSec: toSafeSec(entry?.tSec),
    defId: typeof data.defId === "string" ? data.defId : null,
    seasonKey: typeof data.seasonKey === "string" ? data.seasonKey : null,
    outcome: typeof data.outcome === "string" ? data.outcome : null,
    consumePolicy:
      typeof data.consumePolicy === "string" ? data.consumePolicy : null,
    showInEventLog: data.showInEventLog,
    placements,
  };
}

function assertPlacementsSorted(entry, label) {
  const data = entry?.data && typeof entry.data === "object" ? entry.data : {};
  const placements = Array.isArray(data.placements) ? data.placements : [];
  for (let i = 1; i < placements.length; i += 1) {
    const prevCol = Number.isFinite(placements[i - 1]?.col)
      ? Math.floor(placements[i - 1].col)
      : Number.MAX_SAFE_INTEGER;
    const nextCol = Number.isFinite(placements[i]?.col)
      ? Math.floor(placements[i].col)
      : Number.MAX_SAFE_INTEGER;
    const prevId = Number.isFinite(placements[i - 1]?.instanceId)
      ? Math.floor(placements[i - 1].instanceId)
      : Number.MAX_SAFE_INTEGER;
    const nextId = Number.isFinite(placements[i]?.instanceId)
      ? Math.floor(placements[i].instanceId)
      : Number.MAX_SAFE_INTEGER;
    const ordered = prevCol < nextCol || (prevCol === nextCol && prevId <= nextId);
    assert.ok(ordered, `${label}: placements not sorted`);
  }
}

function runEnvDeckDrawFeedChecks() {
  const runner = createSimRunner({ setupId: "devGym01" });
  runner.init();
  runner.setPaused(false);

  const targetSec = Math.max(1, Math.floor(ENV_EVENT_DRAW_CADENCE_SEC));
  const steps = targetSec * 60;
  for (let i = 0; i < steps; i += 1) {
    runner.update(1 / 60);
  }

  const liveState = runner.getState();
  assert.ok(
    toSafeSec(liveState?.tSec) >= targetSec,
    `[envDeckDraw] live state did not reach t=${targetSec}`
  );

  const liveEntries = getEnvDeckDrawEntriesAtSecond(liveState, targetSec);
  assert.ok(liveEntries.length > 0, `[envDeckDraw] missing live draw entry at t=${targetSec}`);
  const liveEntry = liveEntries[liveEntries.length - 1];
  assert.equal(
    liveEntry?.data?.showInEventLog,
    false,
    "[envDeckDraw] showInEventLog must be false"
  );
  assertPlacementsSorted(liveEntry, "live");

  const timeline = runner.getTimeline();
  const stateDataResA = getStateDataAtSecond(timeline, targetSec);
  assertOk(stateDataResA, `[envDeckDraw] stateData A @${targetSec}`);
  const stateDataResB = getStateDataAtSecond(timeline, targetSec);
  assertOk(stateDataResB, `[envDeckDraw] stateData B @${targetSec}`);
  const snapshotEntriesA = getEnvDeckDrawEntriesAtSecond(stateDataResA.stateData, targetSec);
  const snapshotEntriesB = getEnvDeckDrawEntriesAtSecond(stateDataResB.stateData, targetSec);
  assert.ok(snapshotEntriesA.length > 0, `[envDeckDraw] missing snapshot A entry at t=${targetSec}`);
  assert.ok(snapshotEntriesB.length > 0, `[envDeckDraw] missing snapshot B entry at t=${targetSec}`);
  const snapshotEntryA = snapshotEntriesA[snapshotEntriesA.length - 1];
  const snapshotEntryB = snapshotEntriesB[snapshotEntriesB.length - 1];
  assertPlacementsSorted(snapshotEntryA, "snapshotA");
  assertPlacementsSorted(snapshotEntryB, "snapshotB");

  assert.deepEqual(
    normalizeDeckDrawEntry(snapshotEntryA),
    normalizeDeckDrawEntry(snapshotEntryB),
    "[envDeckDraw] repeated stateData reads at same tSec must match"
  );

  const rebuildRes = rebuildStateAtSecond(timeline, targetSec);
  assertOk(rebuildRes, `[envDeckDraw] rebuild @${targetSec}`);
  const rebuildEntries = getEnvDeckDrawEntriesAtSecond(rebuildRes.state, targetSec);
  assert.ok(rebuildEntries.length > 0, `[envDeckDraw] missing rebuild entry at t=${targetSec}`);
  const rebuildEntry = rebuildEntries[rebuildEntries.length - 1];
  assertPlacementsSorted(rebuildEntry, "rebuild");

  assert.deepEqual(
    normalizeDeckDrawEntry(liveEntry),
    normalizeDeckDrawEntry(rebuildEntry),
    "[envDeckDraw] live and rebuild payloads must match"
  );
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
  runEnvDeckDrawFeedChecks();

  const runner = createSimRunner({ setupId: "devGym01" });
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
