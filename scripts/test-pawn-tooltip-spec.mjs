import assert from "node:assert/strict";

import { createEmptyState } from "../src/model/state.js";
import {
  getPawnBubbleSpecs,
  getVisiblePawnBubbleIds,
  makePawnDebugInspectorSpec,
  makePawnInfocardSpec,
  makePawnTooltipSpec,
} from "../src/views/pawn-tooltip-spec.js";

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
    color: 0xaa5500,
    systemTiers: {},
    systemState: {
      stamina: { cur: 10, max: 100 },
      hunger: { cur: 20, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
    workerCount: 2,
    equipment: {},
    unlockedSkillNodeIds: [],
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

function flattenDebugText(spec) {
  return (spec.debugSections || []).map((section) =>
    (section?.segments || []).map((segment) => segment.text).join("")
  );
}

function flattenParagraphText(spec) {
  return (spec.sections || [])
    .filter((section) => section?.type === "paragraph")
    .map((section) => (section?.segments || []).map((segment) => segment.text).join(""));
}

function assertIncludes(list, expected, message) {
  assert.ok(list.includes(expected), message ?? `Missing entry: ${expected}`);
}

function getBubbleSpecById(specs, systemId) {
  return specs.find((entry) => entry?.systemId === systemId) ?? null;
}

function runLeaderInfocardAndDebugSpecTest() {
  const state = createEmptyState(123);
  installEnvTile(state, 0);
  const pawn = createPawn({
    leaderFaith: {
      tier: "silver",
      eatStreak: 0,
      decayElapsedSec: 0,
      failedEatWarnActive: true,
    },
  });

  const infocard = makePawnInfocardSpec(pawn, state);
  assert.equal(infocard.title, "Tooltip Leader");
  assert.equal(infocard.subtitle, "Leader");
  assert.ok(Array.isArray(infocard.sections) && infocard.sections.length > 0);
  const paragraphText = flattenParagraphText(infocard);
  assert.ok(
    paragraphText.some((line) => line.includes("Assigned: Floodplains")),
    "infocard should expose assigned tile"
  );
  assert.ok(
    paragraphText.some((line) => line.includes("Automata: seeking food")),
    "infocard should expose automata text"
  );

  const debugSpec = makePawnDebugInspectorSpec(pawn, state);
  const debugLines = flattenDebugText(debugSpec);
  assertIncludes(debugLines, "Assigned tile: Floodplains");
  assertIncludes(debugLines, "Automata: seeking food");
  assertIncludes(debugLines, "AI mode: eat");
  assertIncludes(debugLines, "Return state: none");
  assertIncludes(debugLines, "Hungry");
  assertIncludes(debugLines, "Tired");
  assertIncludes(debugLines, "Losing faith");
  assertIncludes(debugLines, "Failed eat warning active");
  assertIncludes(debugLines, "Faith: silver (decay when hunger <= 20)");
}

function runBubbleVisibilityRulesTest() {
  const state = createEmptyState(456);
  installEnvTile(state, 0);

  const healthyFollower = createPawn({
    role: "follower",
    leaderFaith: null,
    systemState: {
      stamina: { cur: 80, max: 100 },
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
  assert.deepEqual(getVisiblePawnBubbleIds(healthyFollower, false, state), []);
  assert.deepEqual(getVisiblePawnBubbleIds(healthyFollower, true, state), ["hunger", "stamina"]);

  const hungryFollower = createPawn({
    role: "follower",
    leaderFaith: null,
    systemState: {
      stamina: { cur: 80, max: 100 },
      hunger: { cur: 40, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
    ai: {
      mode: "eat",
      assignedPlacement: { hubCol: null, envCol: 0 },
      returnState: "waitingForEat",
      suppressAutoUntilSec: 0,
    },
  });
  assert.deepEqual(getVisiblePawnBubbleIds(hungryFollower, false, state), ["hunger"]);

  const tiredFollower = createPawn({
    role: "follower",
    leaderFaith: null,
    systemState: {
      stamina: { cur: 20, max: 100 },
      hunger: { cur: 80, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
    ai: {
      mode: "rest",
      assignedPlacement: { hubCol: null, envCol: 0 },
      returnState: "waitingForRest",
      suppressAutoUntilSec: 0,
    },
  });
  assert.deepEqual(getVisiblePawnBubbleIds(tiredFollower, false, state), ["stamina"]);

  const starvingLeader = createPawn({
    skillPoints: 2,
    systemState: {
      stamina: { cur: 80, max: 100 },
      hunger: { cur: 10, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
      leadership: { followersAutoFollow: true },
    },
    leaderFaith: {
      tier: "bronze",
      eatStreak: 0,
      decayElapsedSec: 0,
      failedEatWarnActive: true,
    },
    ai: {
      mode: "eat",
      assignedPlacement: { hubCol: null, envCol: 0 },
      returnState: "waitingForEat",
      suppressAutoUntilSec: 0,
    },
  });
  state.pawns = [starvingLeader];
  assert.deepEqual(
    getVisiblePawnBubbleIds(starvingLeader, false, state),
    ["skillPoints", "leaderFaith", "hunger"]
  );
  const bubbleSpecs = getPawnBubbleSpecs(starvingLeader, state, { hoverActive: false });
  assert.deepEqual(
    bubbleSpecs.map((entry) => entry.systemId),
    ["skillPoints", "leaderFaith", "hunger"]
  );
  const hungerBubble = getBubbleSpecById(bubbleSpecs, "hunger");
  assert.equal(hungerBubble?.hoverText, "10/100");
  assert.equal(hungerBubble?.fillRatio, 0.1);

  const hoverBubbleSpecs = getPawnBubbleSpecs(starvingLeader, state, { hoverActive: true });
  const staminaBubble = getBubbleSpecById(hoverBubbleSpecs, "stamina");
  assert.equal(staminaBubble?.hoverText, "80/100");
  assert.equal(staminaBubble?.fillRatio, 0.8);

  const faithBubble = getBubbleSpecById(bubbleSpecs, "leaderFaith");
  assert.equal(faithBubble?.hoverText, null);
  assert.equal(faithBubble?.fillRatio, null);
}

function runSkillPointBubbleAvailabilityTest() {
  const state = createEmptyState(654);
  installEnvTile(state, 0);

  const leaderWithPoints = createPawn({
    skillPoints: 2,
    unlockedSkillNodeIds: [],
    systemState: {
      stamina: { cur: 80, max: 100 },
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
  state.pawns.push(leaderWithPoints);

  assert.deepEqual(
    getVisiblePawnBubbleIds(leaderWithPoints, false, state),
    ["skillPoints"],
    "leaders with unlockable skill nodes should show the spendable skill point bubble"
  );

  const bubbleSpecs = getPawnBubbleSpecs(leaderWithPoints, state, { hoverActive: false });
  assert.equal(bubbleSpecs[0]?.systemId, "skillPoints");
  assert.equal(bubbleSpecs[0]?.shortLabel, "!");
  assert.equal(bubbleSpecs[0]?.label, "Skill Points");

  const leaderWithoutSpendableNodes = createPawn({
    id: 102,
    skillPoints: 0,
    unlockedSkillNodeIds: [],
    systemState: {
      stamina: { cur: 80, max: 100 },
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
  state.pawns = [leaderWithoutSpendableNodes];

  assert.deepEqual(
    getVisiblePawnBubbleIds(leaderWithoutSpendableNodes, false, state),
    [],
    "leaders without spendable skill points should not show the spendable skill point bubble"
  );
}

function runLegacyAliasShapeTest() {
  const state = createEmptyState(789);
  installEnvTile(state, 0);
  const pawn = createPawn();
  const spec = makePawnTooltipSpec(pawn, state);
  assert.ok(Array.isArray(spec.sections), "legacy export should now return rich sections");
  assert.ok(Array.isArray(spec.debugSections), "legacy export should still expose debug sections");
}

runLeaderInfocardAndDebugSpecTest();
runBubbleVisibilityRulesTest();
runSkillPointBubbleAvailabilityTest();
runLegacyAliasShapeTest();
console.log("[test] Pawn tooltip spec checks passed");
