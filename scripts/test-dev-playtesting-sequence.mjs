import assert from "node:assert/strict";

import { applyAction, ActionKinds } from "../src/model/actions.js";
import { createActionPlanner } from "../src/controllers/actionmanagers/action-planner.js";
import { envStructureDefs } from "../src/defs/gamepieces/env-structures-defs.js";
import { placePawn, createInitialState, updateGame } from "../src/model/game-model.js";
import { getBuildProcess } from "../src/model/build-helpers.js";
import { getInventoryOwnerVisibility } from "../src/model/inventory-owner-visibility.js";
import { hasEnvTagUnlock } from "../src/model/skills.js";
import {
  deserializeGameState,
  getVisibleEnvColCount,
  isEnvColExposed,
  isEnvColRevealed,
  isHubRenameUnlocked,
  isHubVisible,
  serializeGameState,
} from "../src/model/state.js";
import {
  createTimelineFromInitialState,
  rebuildStateAtSecond,
  replaceActionsAtSecond,
} from "../src/model/timeline/index.js";

function advanceSeconds(state, seconds) {
  const frames = Math.max(0, Math.floor(seconds * 60));
  for (let i = 0; i < frames; i += 1) {
    updateGame(1 / 60, state);
  }
}

function getLeader(state) {
  return (state?.pawns ?? []).find((pawn) => pawn?.role === "leader") ?? null;
}

function getHubStructureAt(state, hubCol) {
  return state?.hub?.occ?.[hubCol] ?? state?.hub?.slots?.[hubCol]?.structure ?? null;
}

function getTileAt(state, envCol) {
  return state?.board?.occ?.tile?.[envCol] ?? null;
}

function getInventorySignature(state, ownerId) {
  const inv = state?.ownerInventories?.[ownerId];
  const items = Array.isArray(inv?.items) ? inv.items : [];
  return items
    .map((item) =>
      [
        item?.kind ?? "?",
        Math.max(0, Math.floor(item?.quantity ?? 0)),
        item?.tier ?? "bronze",
        Math.max(0, Math.floor(item?.gridX ?? 0)),
        Math.max(0, Math.floor(item?.gridY ?? 0)),
      ].join(":")
    )
    .sort()
    .join("|");
}

function getFirstInventoryItemId(state, ownerId) {
  const items = Array.isArray(state?.ownerInventories?.[ownerId]?.items)
    ? state.ownerInventories[ownerId].items
    : [];
  return items[0]?.id ?? null;
}

function createPlannerHarness(state) {
  const timeline = createTimelineFromInitialState(state);
  return createActionPlanner({
    getTimeline: () => timeline,
    getState: () => state,
    getPreviewBoundaryStateData: () => ({
      ok: true,
      stateData: JSON.parse(JSON.stringify(state)),
    }),
  });
}

function summarizeScenarioState(state) {
  const leader = getLeader(state);
  const hubStructure = getHubStructureAt(state, 4);
  return {
    tSec: Math.floor(state?.tSec ?? 0),
    discovery: {
      visibleEnvCols: getVisibleEnvColCount(state),
      envCols: (state?.discovery?.envCols ?? []).map((entry) => ({
        exposed: entry?.exposed === true,
        revealed: entry?.revealed === true,
      })),
      hubVisible: isHubVisible(state),
      hubRenameUnlocked: isHubRenameUnlocked(state),
    },
    locationNames: {
      region: state?.locationNames?.region ?? null,
      hub: state?.locationNames?.hub ?? null,
    },
    leaderPlacement: {
      envCol: Number.isFinite(leader?.envCol) ? Math.floor(leader.envCol) : null,
      hubCol: Number.isFinite(leader?.hubCol) ? Math.floor(leader.hubCol) : null,
    },
    tile0Tags: Array.isArray(getTileAt(state, 0)?.tags) ? [...getTileAt(state, 0).tags] : [],
    tile1Tags: Array.isArray(getTileAt(state, 1)?.tags) ? [...getTileAt(state, 1).tags] : [],
    hubStructure: hubStructure
      ? {
          instanceId: hubStructure.instanceId ?? null,
          defId: hubStructure.defId ?? null,
          tags: Array.isArray(hubStructure.tags) ? [...hubStructure.tags] : [],
          buildActive: !!getBuildProcess(hubStructure),
        }
      : null,
    leaderInventory: leader ? getInventorySignature(state, leader.id) : "",
    hubInventory: hubStructure ? getInventorySignature(state, hubStructure.instanceId) : "",
  };
}

function assertPlaceOk(state, payload, label) {
  const result = placePawn(state, payload);
  assert.equal(result?.ok, true, `${label} failed: ${JSON.stringify(result)}`);
}

function runInitAssertions() {
  const state = createInitialState("devPlaytesting01", 123);
  const leader = getLeader(state);
  const hubStructure = getHubStructureAt(state, 4);

  assert.ok(leader, "expected leader pawn");
  assert.equal(leader.envCol, 0, "leader should start on env col 0");
  assert.equal(leader.hubCol ?? null, null, "leader should not start in the hub");
  assert.equal(getVisibleEnvColCount(state), 1, "only the first env column should be visible");
  assert.equal(isEnvColExposed(state, 0), true, "env col 0 should start exposed");
  assert.equal(isEnvColRevealed(state, 0), false, "env col 0 should start unrevealed");
  assert.equal(isHubVisible(state), false, "hub should start hidden");
  assert.equal(hasEnvTagUnlock(state, "explore"), true, "explore should start unlocked");
  assert.equal(hasEnvTagUnlock(state, "delve"), true, "delve should start unlocked");
  assert.equal(hasEnvTagUnlock(state, "forageable"), false, "forage should start locked");
  assert.equal(hasEnvTagUnlock(state, "herdable"), false, "herd should start locked");
  assert.equal(hasEnvTagUnlock(state, "fishable"), false, "fish should start locked");
  assert.equal(hasEnvTagUnlock(state, "farmable"), false, "farm should start locked");
  assert.ok(hubStructure, "Temple Ruins should exist in the hidden hub row");
  assert.equal(hubStructure.defId, "templeRuins");
  assert.match(getInventorySignature(state, hubStructure.instanceId), /moteOfEternity:1/);
  assert.match(getInventorySignature(state, hubStructure.instanceId), /mysteriousAncientTome:1/);
  assert.equal(getInventorySignature(state, leader.id), "", "leader should not start with relic items");
  assert.deepEqual(
    getInventoryOwnerVisibility(state, hubStructure.instanceId),
    {
      visible: false,
      reason: "hubHidden",
      ownerKind: "hub",
      resolvedOwnerId: hubStructure.instanceId,
    },
    "hidden hub owner visibility should report hubHidden before delve"
  );

  const hiddenTempleItemId = getFirstInventoryItemId(state, hubStructure.instanceId);
  assert.ok(hiddenTempleItemId != null, "Temple Ruins should start with an inventory item");
  state.paused = true;
  const hiddenInventoryDiscard = applyAction(
    state,
    {
      kind: ActionKinds.INVENTORY_DISCARD,
      payload: { ownerId: hubStructure.instanceId, itemId: hiddenTempleItemId },
      apCost: 0,
    },
    { isReplay: false }
  );
  assert.equal(hiddenInventoryDiscard?.ok, false, "hidden Temple Ruins inventory should reject discard");
  assert.equal(
    hiddenInventoryDiscard?.reason,
    "hubHidden",
    "hidden Temple Ruins inventory should report hubHidden"
  );
  state.paused = false;

  const hiddenEnvMove = placePawn(state, { pawnId: leader.id, toEnvCol: 1 });
  assert.equal(hiddenEnvMove?.ok, false, "hidden env placement should fail");
  assert.equal(
    hiddenEnvMove?.reason,
    "envColHidden",
    "hidden env placement should report envColHidden"
  );

  const hiddenHubMove = placePawn(state, { pawnId: leader.id, toHubCol: 4 });
  assert.equal(hiddenHubMove?.ok, false, "hidden hub placement should fail");
  assert.equal(
    hiddenHubMove?.reason,
    "hubHidden",
    "hidden hub placement should report hubHidden"
  );

  state.paused = true;
  const planner = createPlannerHarness(state);
  const hiddenEnvPreview = planner.getPawnMoveAffordability({
    pawnId: leader.id,
    toEnvCol: 1,
  });
  assert.equal(hiddenEnvPreview?.ok, false, "planner hidden env preview should fail");
  assert.equal(
    hiddenEnvPreview?.reason,
    "envColHidden",
    "planner hidden env preview should mirror command reason"
  );

  const hiddenHubPreview = planner.getPawnMoveAffordability({
    pawnId: leader.id,
    toHubCol: 4,
  });
  assert.equal(hiddenHubPreview?.ok, false, "planner hidden hub preview should fail");
  assert.equal(
    hiddenHubPreview?.reason,
    "hubHidden",
    "planner hidden hub preview should mirror command reason"
  );
}

function runLiveSequenceAndAssertions() {
  const state = createInitialState("devPlaytesting01", 123);
  const leader = getLeader(state);
  const initialHubStructure = getHubStructureAt(state, 4);
  const initialHubInventory = getInventorySignature(state, initialHubStructure.instanceId);

  advanceSeconds(state, 5);
  assert.equal(isEnvColRevealed(state, 0), true, "first explore should reveal col 0");
  assert.equal(isEnvColExposed(state, 1), true, "first explore should expose col 1");
  assert.ok(!getTileAt(state, 0)?.tags?.includes("explore"), "explore tag should be removed after completion");
  assert.equal(hasEnvTagUnlock(state, "forageable"), false, "forage should still be locked after first explore");
  assert.equal(hasEnvTagUnlock(state, "herdable"), false, "herd should still be locked after first explore");

  state.paused = true;
  const plannerAfterFirstExplore = createPlannerHarness(state);
  const exposedEnvPreview = plannerAfterFirstExplore.getPawnMoveAffordability({
    pawnId: leader.id,
    toEnvCol: 1,
  });
  assert.equal(exposedEnvPreview?.ok, true, "planner should accept newly exposed env move preview");
  state.paused = false;

  const afterFirstExploreInventory = getInventorySignature(state, leader.id);

  assertPlaceOk(state, { pawnId: leader.id, toEnvCol: 1 }, "move leader to levee");
  advanceSeconds(state, 5);
  assert.equal(isEnvColRevealed(state, 1), true, "levee should be revealed after explore");
  assert.equal(isEnvColExposed(state, 2), true, "exploring levee should expose col 2");
  assert.ok(getTileAt(state, 1)?.tags?.includes("delve"), "levee should reveal the Delve tag");

  advanceSeconds(state, 5);
  assert.equal(isHubVisible(state), true, "delve should reveal the hub");
  assert.ok(!getTileAt(state, 1)?.tags?.includes("delve"), "delve tag should be removed after completion");
  assert.deepEqual(
    getInventoryOwnerVisibility(state, initialHubStructure.instanceId),
    {
      visible: true,
      reason: null,
      ownerKind: "hub",
      resolvedOwnerId: initialHubStructure.instanceId,
    },
    "Temple Ruins inventory should become visible after delve"
  );

  const visibleDiscardState = deserializeGameState(serializeGameState(state));
  const visibleTemple = getHubStructureAt(visibleDiscardState, 4);
  assert.ok(visibleTemple, "Temple Ruins should still exist in cloned post-delve state");
  visibleDiscardState.paused = true;
  const visibleTempleItemId = getFirstInventoryItemId(
    visibleDiscardState,
    visibleTemple.instanceId
  );
  assert.ok(visibleTempleItemId != null, "Temple Ruins inventory should still contain an item after delve");
  const visibleInventoryDiscard = applyAction(
    visibleDiscardState,
    {
      kind: ActionKinds.INVENTORY_DISCARD,
      payload: { ownerId: visibleTemple.instanceId, itemId: visibleTempleItemId },
      apCost: 0,
    },
    { isReplay: false }
  );
  assert.equal(visibleInventoryDiscard?.ok, true, "visible Temple Ruins inventory should allow discard");
  assert.notEqual(
    getInventorySignature(visibleDiscardState, visibleTemple.instanceId),
    initialHubInventory,
    "discard should mutate visible Temple Ruins inventory once it is visible"
  );

  state.paused = true;
  const plannerAfterDelve = createPlannerHarness(state);
  const visibleHubPreview = plannerAfterDelve.getPawnMoveAffordability({
    pawnId: leader.id,
    toHubCol: 4,
  });
  assert.equal(visibleHubPreview?.ok, true, "planner should accept hub move preview after delve");
  state.paused = false;

  assertPlaceOk(state, { pawnId: leader.id, toHubCol: 4 }, "move leader to Temple Ruins");
  advanceSeconds(state, 5);

  const finalHubStructure = getHubStructureAt(state, 4);
  assert.ok(finalHubStructure, "expected rebuilt hub structure");
  assert.equal(finalHubStructure.instanceId, initialHubStructure.instanceId, "rebuild should preserve instance id");
  assert.equal(finalHubStructure.defId, "makeshiftShelter", "Temple Ruins should rebuild into Makeshift Shelter");
  assert.equal(isHubRenameUnlocked(state), true, "hub rename should unlock after rebuild");
  assert.equal(state?.locationNames?.hub, "Hub", "rebuild should rename the hub to Hub");
  assert.equal(getInventorySignature(state, finalHubStructure.instanceId), initialHubInventory, "hub inventory should carry across rebuild");
  assert.ok(finalHubStructure.tags.includes("canRest"), "rebuilt shelter should expose rest");
  assert.equal(!!getBuildProcess(finalHubStructure), false, "build process should be cleared after rebuild");

  const ruinsTitleBeforeRename = envStructureDefs.ancientRuins.ui.title(
    state?.board?.occ?.envStructure?.[1],
    envStructureDefs.ancientRuins,
    state
  );
  assert.equal(ruinsTitleBeforeRename, "Hub", "levee ruins marker should mirror the shared hub name");
  const replayParitySummary = summarizeScenarioState(state);

  state.paused = true;
  const renameResult = applyAction(
    state,
    {
      kind: ActionKinds.SET_HUB_NAME,
      payload: { name: "Sanctum" },
      apCost: 0,
    },
    { isReplay: false }
  );
  assert.equal(renameResult?.ok, true, `hub rename failed: ${JSON.stringify(renameResult)}`);
  const ruinsTitleAfterRename = envStructureDefs.ancientRuins.ui.title(
    state?.board?.occ?.envStructure?.[1],
    envStructureDefs.ancientRuins,
    state
  );
  assert.equal(ruinsTitleAfterRename, "Sanctum", "levee ruins marker should follow later hub renames");

  return {
    state,
    afterFirstExploreInventory,
    replayParitySummary,
  };
}

function runReplayParityAssertions(liveState, afterFirstExploreInventory, replayParitySummary) {
  const initial = createInitialState("devPlaytesting01", 123);
  const leader = getLeader(initial);
  const timeline = createTimelineFromInitialState(initial);

  const moveToLevee = {
    kind: ActionKinds.PLACE_PAWN,
    apCost: 0,
    payload: { pawnId: leader.id, toEnvCol: 1 },
  };
  const moveToHub = {
    kind: ActionKinds.PLACE_PAWN,
    apCost: 0,
    payload: { pawnId: leader.id, toHubCol: 4 },
  };

  const placeLeveeRes = replaceActionsAtSecond(timeline, 5, [moveToLevee], {
    truncateFuture: false,
  });
  assert.equal(placeLeveeRes?.ok, true, `timeline levee move failed: ${JSON.stringify(placeLeveeRes)}`);
  const placeHubRes = replaceActionsAtSecond(timeline, 15, [moveToHub], {
    truncateFuture: false,
  });
  assert.equal(placeHubRes?.ok, true, `timeline hub move failed: ${JSON.stringify(placeHubRes)}`);

  const replay = rebuildStateAtSecond(timeline, 20);
  assert.equal(replay?.ok, true, `timeline rebuild failed: ${JSON.stringify(replay)}`);

  const liveSummary = replayParitySummary;
  const replaySummary = summarizeScenarioState(replay.state);
  assert.deepEqual(replaySummary, liveSummary, "replay should match live sequence outcome");

  const roundTrip = deserializeGameState(serializeGameState(liveState));
  assert.deepEqual(
    summarizeScenarioState(roundTrip),
    summarizeScenarioState(liveState),
    "serialize/deserialize should preserve discovery sequence state"
  );

  const replayAtFive = rebuildStateAtSecond(timeline, 5);
  assert.equal(replayAtFive?.ok, true, `timeline rebuild at 5 failed: ${JSON.stringify(replayAtFive)}`);
  assert.equal(
    afterFirstExploreInventory,
    getInventorySignature(replayAtFive.state, getLeader(replayAtFive.state).id),
    "sample package drops should be deterministic across replay"
  );

  const replayBeforeDelve = rebuildStateAtSecond(timeline, 14);
  assert.equal(
    replayBeforeDelve?.ok,
    true,
    `timeline rebuild before delve failed: ${JSON.stringify(replayBeforeDelve)}`
  );
  const hiddenReplayTemple = getHubStructureAt(replayBeforeDelve.state, 4);
  assert.ok(hiddenReplayTemple, "expected Temple Ruins before delve in replay");
  assert.equal(
    getInventoryOwnerVisibility(replayBeforeDelve.state, hiddenReplayTemple.instanceId).visible,
    false,
    "Temple Ruins inventory should be hidden before delve in replay"
  );

  const replayAfterDelve = rebuildStateAtSecond(timeline, 15);
  assert.equal(
    replayAfterDelve?.ok,
    true,
    `timeline rebuild after delve failed: ${JSON.stringify(replayAfterDelve)}`
  );
  const visibleReplayTemple = getHubStructureAt(replayAfterDelve.state, 4);
  assert.ok(visibleReplayTemple, "expected Temple Ruins after delve in replay");
  assert.equal(
    getInventoryOwnerVisibility(replayAfterDelve.state, visibleReplayTemple.instanceId).visible,
    true,
    "Temple Ruins inventory should be visible after delve in replay"
  );
}

function run() {
  runInitAssertions();
  const { state, afterFirstExploreInventory, replayParitySummary } = runLiveSequenceAndAssertions();
  runReplayParityAssertions(state, afterFirstExploreInventory, replayParitySummary);
  console.log("[test] devPlaytesting01 discovery sequence passed");
}

run();
