import assert from "node:assert/strict";

import { ActionKinds, applyAction } from "../src/model/actions.js";
import { runEffect } from "../src/model/effects/index.js";
import { createInitialState, placePawn, updateGame } from "../src/model/game-model.js";
import {
  skillNodes as skillNodeDefs,
  skillTrees as skillTreeDefs,
} from "../src/defs/gamepieces/skill-tree-defs.js";
import { deserializeGameState, serializeGameState } from "../src/model/state.js";
import {
  createTimelineFromInitialState,
  rebuildStateAtSecond,
  replaceActionsAtSecond,
} from "../src/model/timeline/index.js";
import { hasSkillFeatureUnlock } from "../src/model/skills.js";

function advanceSeconds(state, seconds) {
  const frames = Math.max(0, Math.floor(seconds * 60));
  for (let i = 0; i < frames; i += 1) {
    updateGame(1 / 60, state);
  }
}

function getLeader(state) {
  return (state?.pawns ?? []).find((pawn) => pawn?.role === "leader") ?? null;
}

function advanceToHubReveal(state) {
  const leader = getLeader(state);
  assert.ok(leader, "[skill-feature] leader pawn missing while advancing to hub reveal");
  advanceSeconds(state, 5);
  const moveRes = placePawn(state, { pawnId: leader.id, toEnvCol: 1 });
  assert.equal(
    moveRes?.ok,
    true,
    `[skill-feature] failed to move leader to levee during setup: ${JSON.stringify(moveRes)}`
  );
  advanceSeconds(state, 10);
  assert.equal(
    state?.discovery?.hubVisible,
    true,
    "[skill-feature] setup should reveal the hub before Temple Ruins access tests"
  );
  return leader;
}

function findPathNodeIds(treeId, fromNodeId, toNodeId) {
  if (!treeId || !fromNodeId || !toNodeId) return null;
  if (fromNodeId === toNodeId) return [fromNodeId];

  const visited = new Set([fromNodeId]);
  const queue = [[fromNodeId]];
  while (queue.length > 0) {
    const path = queue.shift();
    const nodeId = path[path.length - 1];
    const node = skillNodeDefs?.[nodeId];
    const adjacent = Array.isArray(node?.adjacent) ? node.adjacent : [];
    for (const nextId of adjacent) {
      if (typeof nextId !== "string" || !nextId.length) continue;
      if (visited.has(nextId)) continue;
      const nextNode = skillNodeDefs?.[nextId];
      if (!nextNode || nextNode.treeId !== treeId) continue;
      const nextPath = path.concat(nextId);
      if (nextId === toNodeId) return nextPath;
      visited.add(nextId);
      queue.push(nextPath);
    }
  }
  return null;
}

function runFeatureUnlockEffectOpChecks() {
  const state = {
    rng: { seed: 1, baseSeed: 1 },
    skillRuntime: null,
  };

  const grantRes = runEffect(
    state,
    {
      op: "GrantUnlock",
      unlockType: "feature",
      unlockId: "ui.disk.moon",
    },
    { kind: "game", state }
  );
  assert.equal(grantRes, true, "[skill-feature] GrantUnlock(feature) should mutate state");
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.disk.moon"),
    true,
    "[skill-feature] granted feature should be queryable"
  );

  const grantDuplicateRes = runEffect(
    state,
    {
      op: "GrantUnlock",
      unlockType: "feature",
      unlockId: "ui.disk.moon",
    },
    { kind: "game", state }
  );
  assert.equal(
    grantDuplicateRes,
    false,
    "[skill-feature] duplicate GrantUnlock(feature) should be a no-op"
  );

  const revokeRes = runEffect(
    state,
    {
      op: "RevokeUnlock",
      unlockType: "feature",
      unlockId: "ui.disk.moon",
    },
    { kind: "game", state }
  );
  assert.equal(revokeRes, true, "[skill-feature] RevokeUnlock(feature) should mutate state");
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.disk.moon"),
    false,
    "[skill-feature] revoked feature should not be queryable"
  );
}

function runUnlockCommandReplayAndSerializationChecks() {
  const stateBefore = createInitialState("devPlaytesting01");
  const tree = skillTreeDefs?.systemColorMap ?? null;
  assert.ok(tree, "[skill-feature] systemColorMap tree missing");
  const leader = (stateBefore?.pawns ?? []).find((pawn) => pawn?.role === "leader");
  assert.ok(leader, "[skill-feature] leader pawn missing in setup");
  leader.skillPoints = 999;
  assert.equal(
    hasSkillFeatureUnlock(stateBefore, "ui.log.event"),
    false,
    "[skill-feature] event-log feature should start locked in setup"
  );
  assert.equal(
    hasSkillFeatureUnlock(stateBefore, "ui.deck.event"),
    false,
    "[skill-feature] event deck feature should start locked in setup"
  );

  stateBefore.paused = true;
  const path = findPathNodeIds(tree.id, tree.startNodeId, "Memory");
  assert.ok(path && path.length > 0, "[skill-feature] no path from tree start to Memory");
  const initiallyUnlocked = new Set(
    Array.isArray(leader.unlockedSkillNodeIds) ? leader.unlockedSkillNodeIds : []
  );
  const unlockSequence = path.filter((nodeId) => !initiallyUnlocked.has(nodeId));
  assert.ok(
    unlockSequence.length > 0 || hasSkillFeatureUnlock(stateBefore, "ui.log.event"),
    "[skill-feature] expected Memory path to require at least one unlock step"
  );
  for (const nodeId of unlockSequence) {
    const unlockRes = applyAction(stateBefore, {
      kind: ActionKinds.UNLOCK_SKILL_NODE,
      payload: {
        leaderPawnId: leader.id,
        nodeId,
      },
    });
    assert.equal(
      unlockRes?.ok,
      true,
      `[skill-feature] failed to unlock ${nodeId}: ${JSON.stringify(unlockRes)}`
    );
  }

  const stateAfter = stateBefore;
  assert.equal(
    hasSkillFeatureUnlock(stateAfter, "ui.log.event"),
    true,
    "[skill-feature] unlocking Memory should grant ui.log.event"
  );
  assert.equal(
    hasSkillFeatureUnlock(stateAfter, "ui.deck.event"),
    true,
    "[skill-feature] unlocking Memory should grant ui.deck.event"
  );

  const serialized = serializeGameState(stateAfter);
  const restored = deserializeGameState(serialized);
  assert.equal(
    hasSkillFeatureUnlock(restored, "ui.log.event"),
    true,
    "[skill-feature] serialized/deserialized state should preserve feature unlocks"
  );
  assert.equal(
    hasSkillFeatureUnlock(restored, "ui.deck.event"),
    true,
    "[skill-feature] serialized/deserialized state should preserve ui.deck.event"
  );

  const replaySeed = createInitialState("devPlaytesting01");
  const replayLeader = (replaySeed?.pawns ?? []).find((pawn) => pawn?.role === "leader");
  assert.ok(replayLeader, "[skill-feature] replay leader pawn missing in setup");
  replayLeader.skillPoints = 999;
  const timeline = createTimelineFromInitialState(replaySeed);
  const replayActions = unlockSequence.map((nodeId) => ({
    kind: ActionKinds.UNLOCK_SKILL_NODE,
    payload: {
      leaderPawnId: replayLeader.id,
      nodeId,
    },
  }));
  const replaceRes = replaceActionsAtSecond(timeline, 0, replayActions);
  assert.equal(replaceRes?.ok, true, "[skill-feature] failed to stage replay action");
  const tSec = 0;
  const rebuilt = rebuildStateAtSecond(timeline, tSec);
  assert.equal(
    rebuilt?.ok,
    true,
    `[skill-feature] rebuildStateAtSecond failed at t=${tSec}`
  );
  assert.equal(
    hasSkillFeatureUnlock(rebuilt.state, "ui.log.event"),
    true,
    "[skill-feature] replay rebuild should preserve feature unlocks"
  );
  assert.equal(
    hasSkillFeatureUnlock(rebuilt.state, "ui.deck.event"),
    true,
    "[skill-feature] replay rebuild should preserve ui.deck.event"
  );
}

function runSolarAstronomySeasonalDeckFeatureChecks() {
  const stateBefore = createInitialState("devPlaytesting01");
  const tree = skillTreeDefs?.systemColorMap ?? null;
  assert.ok(tree, "[skill-feature] systemColorMap tree missing");
  const leader = (stateBefore?.pawns ?? []).find((pawn) => pawn?.role === "leader");
  assert.ok(leader, "[skill-feature] leader pawn missing in setup");
  leader.skillPoints = 999;
  stateBefore.paused = true;

  assert.equal(
    hasSkillFeatureUnlock(stateBefore, "ui.deck.seasonalColors"),
    false,
    "[skill-feature] seasonal deck colors feature should start locked in setup"
  );
  assert.equal(
    hasSkillFeatureUnlock(stateBefore, "ui.disk.season"),
    false,
    "[skill-feature] season disk feature should start locked in setup"
  );

  const path = findPathNodeIds(tree.id, tree.startNodeId, "SolarAstronomy");
  assert.ok(path && path.length > 0, "[skill-feature] no path from tree start to SolarAstronomy");
  const initiallyUnlocked = new Set(
    Array.isArray(leader.unlockedSkillNodeIds) ? leader.unlockedSkillNodeIds : []
  );
  const unlockSequence = path.filter((nodeId) => !initiallyUnlocked.has(nodeId));
  assert.ok(
    unlockSequence.length > 0 ||
      hasSkillFeatureUnlock(stateBefore, "ui.deck.seasonalColors"),
    "[skill-feature] expected SolarAstronomy path to require at least one unlock step"
  );

  for (const nodeId of unlockSequence) {
    const unlockRes = applyAction(stateBefore, {
      kind: ActionKinds.UNLOCK_SKILL_NODE,
      payload: {
        leaderPawnId: leader.id,
        nodeId,
      },
    });
    assert.equal(
      unlockRes?.ok,
      true,
      `[skill-feature] failed to unlock ${nodeId}: ${JSON.stringify(unlockRes)}`
    );
  }

  assert.equal(
    hasSkillFeatureUnlock(stateBefore, "ui.deck.seasonalColors"),
    true,
    "[skill-feature] unlocking SolarAstronomy should grant ui.deck.seasonalColors"
  );
  assert.equal(
    hasSkillFeatureUnlock(stateBefore, "ui.disk.season"),
    true,
    "[skill-feature] unlocking SolarAstronomy should still grant ui.disk.season"
  );

  const serialized = serializeGameState(stateBefore);
  const restored = deserializeGameState(serialized);
  assert.equal(
    hasSkillFeatureUnlock(restored, "ui.deck.seasonalColors"),
    true,
    "[skill-feature] serialized/deserialized state should preserve ui.deck.seasonalColors"
  );
  assert.equal(
    hasSkillFeatureUnlock(restored, "ui.disk.season"),
    true,
    "[skill-feature] serialized/deserialized state should preserve ui.disk.season"
  );

  const replaySeed = createInitialState("devPlaytesting01");
  const replayLeader = (replaySeed?.pawns ?? []).find((pawn) => pawn?.role === "leader");
  assert.ok(replayLeader, "[skill-feature] replay leader pawn missing in setup");
  replayLeader.skillPoints = 999;
  const timeline = createTimelineFromInitialState(replaySeed);
  const replayActions = unlockSequence.map((nodeId) => ({
    kind: ActionKinds.UNLOCK_SKILL_NODE,
    payload: {
      leaderPawnId: replayLeader.id,
      nodeId,
    },
  }));
  const replaceRes = replaceActionsAtSecond(timeline, 0, replayActions);
  assert.equal(replaceRes?.ok, true, "[skill-feature] failed to stage replay action");
  const rebuilt = rebuildStateAtSecond(timeline, 0);
  assert.equal(rebuilt?.ok, true, "[skill-feature] rebuildStateAtSecond failed at t=0");
  assert.equal(
    hasSkillFeatureUnlock(rebuilt.state, "ui.deck.seasonalColors"),
    true,
    "[skill-feature] replay rebuild should preserve ui.deck.seasonalColors"
  );
  assert.equal(
    hasSkillFeatureUnlock(rebuilt.state, "ui.disk.season"),
    true,
    "[skill-feature] replay rebuild should preserve ui.disk.season"
  );
}

function runGraphOpenFeatureUnlockChecks() {
  const state = createInitialState("devPlaytesting01");
  advanceToHubReveal(state);
  const templeRuins = state?.hub?.occ?.[4] ?? state?.hub?.slots?.[4]?.structure ?? null;
  assert.ok(templeRuins, "[skill-feature] Temple Ruins missing from playtesting setup");
  const templeInv = state?.ownerInventories?.[templeRuins.instanceId];
  assert.ok(templeInv, "[skill-feature] Temple Ruins inventory missing");
  const mote = (templeInv.items || []).find((item) => item?.kind === "moteOfEternity");
  assert.ok(mote, "[skill-feature] moteOfEternity missing from Temple Ruins inventory");

  assert.equal(
    hasSkillFeatureUnlock(state, "ui.chrome.yearTracker"),
    false,
    "[skill-feature] year tracker feature should start locked in playtesting setup"
  );

  const openRes = applyAction(state, {
    kind: ActionKinds.INVENTORY_OPEN_GRAPH_ITEM,
    payload: {
      ownerId: templeRuins.instanceId,
      itemId: mote.id,
    },
    apCost: 0,
  });
  assert.equal(
    openRes?.ok,
    true,
    `[skill-feature] graph-open action failed: ${JSON.stringify(openRes)}`
  );
  assert.equal(
    openRes?.result,
    "graphItemOpened",
    "[skill-feature] first graph-open action should report a mutation"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.chrome.yearTracker"),
    true,
    "[skill-feature] opening Mote graph should grant year tracker feature"
  );

  state.paused = false;
  const repeatRes = applyAction(state, {
    kind: ActionKinds.INVENTORY_OPEN_GRAPH_ITEM,
    payload: {
      ownerId: templeRuins.instanceId,
      itemId: mote.id,
    },
    apCost: 0,
  });
  assert.equal(
    repeatRes?.ok,
    true,
    "[skill-feature] graph-open action should succeed while unpaused"
  );
  assert.equal(
    repeatRes?.result,
    "graphItemOpenedNoChange",
    "[skill-feature] reopening the graph should be idempotent"
  );

  const serialized = serializeGameState(state);
  const restored = deserializeGameState(serialized);
  assert.equal(
    hasSkillFeatureUnlock(restored, "ui.chrome.yearTracker"),
    true,
    "[skill-feature] serialized/deserialized state should preserve year tracker feature"
  );

  const replaySeed = createInitialState("devPlaytesting01");
  const replayLeader = getLeader(replaySeed);
  assert.ok(replayLeader, "[skill-feature] replay leader pawn missing for graph-open replay");
  const replayTempleRuins =
    replaySeed?.hub?.occ?.[4] ?? replaySeed?.hub?.slots?.[4]?.structure ?? null;
  assert.ok(replayTempleRuins, "[skill-feature] replay Temple Ruins missing");
  const replayTempleInv = replaySeed?.ownerInventories?.[replayTempleRuins.instanceId];
  assert.ok(replayTempleInv, "[skill-feature] replay Temple Ruins inventory missing");
  const replayMote = (replayTempleInv.items || []).find(
    (item) => item?.kind === "moteOfEternity"
  );
  assert.ok(replayMote, "[skill-feature] replay moteOfEternity missing");

  const timeline = createTimelineFromInitialState(replaySeed);
  const moveReplaceRes = replaceActionsAtSecond(
    timeline,
    5,
    [
      {
        kind: ActionKinds.PLACE_PAWN,
        payload: {
          pawnId: replayLeader.id,
          toEnvCol: 1,
        },
        apCost: 0,
      },
    ],
    { truncateFuture: false }
  );
  assert.equal(
    moveReplaceRes?.ok,
    true,
    "[skill-feature] failed to stage levee move before graph-open replay action"
  );
  const replaceRes = replaceActionsAtSecond(
    timeline,
    15,
    [
      {
        kind: ActionKinds.INVENTORY_OPEN_GRAPH_ITEM,
        payload: {
          ownerId: replayTempleRuins.instanceId,
          itemId: replayMote.id,
        },
        apCost: 0,
      },
    ],
    { truncateFuture: false }
  );
  assert.equal(
    replaceRes?.ok,
    true,
    "[skill-feature] failed to stage graph-open replay action"
  );
  const rebuilt = rebuildStateAtSecond(timeline, 15);
  assert.equal(
    rebuilt?.ok,
    true,
    "[skill-feature] rebuildStateAtSecond failed for graph-open action"
  );
  assert.equal(
    hasSkillFeatureUnlock(rebuilt.state, "ui.chrome.yearTracker"),
    true,
    "[skill-feature] replay rebuild should preserve year tracker feature"
  );
}

function runScenarioMemoryFeatureBootstrapChecks() {
  const state = createInitialState("devGym01");
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.chrome.yearTracker"),
    true,
    "[skill-feature] devGym01 should start with year tracker feature unlocked"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.log.event"),
    true,
    "[skill-feature] pre-unlocked Memory should grant ui.log.event during init"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.deck.event"),
    true,
    "[skill-feature] pre-unlocked Memory should grant ui.deck.event during init"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.tooltip.droppedItems"),
    true,
    "[skill-feature] pre-unlocked Memory should grant ui.tooltip.droppedItems during init"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.inventory.skills"),
    true,
    "[skill-feature] pre-unlocked Memory should grant ui.inventory.skills during init"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.inventory.prestige"),
    true,
    "[skill-feature] pre-unlocked Worship should grant ui.inventory.prestige during init"
  );
}

function runMysteriousAncientTomeItemUseChecks() {
  const state = createInitialState("devPlaytesting01");
  const leader = advanceToHubReveal(state);
  state.paused = true;
  assert.ok(leader, "[skill-feature] leader pawn missing in playtesting setup");

  const ownerInv = state?.ownerInventories?.[leader.id];
  assert.ok(ownerInv, "[skill-feature] leader inventory missing");
  assert.equal(
    (ownerInv.items || []).some((item) => item?.kind === "mysteriousAncientTome"),
    false,
    "[skill-feature] leader should not start with mysteriousAncientTome in inventory"
  );

  const templeRuins =
    state?.hub?.occ?.[4] ?? state?.hub?.slots?.[4]?.structure ?? null;
  assert.ok(templeRuins, "[skill-feature] Temple Ruins missing from playtesting setup");
  const templeInv = state?.ownerInventories?.[templeRuins.instanceId];
  assert.ok(templeInv, "[skill-feature] Temple Ruins inventory missing");
  const tome = (templeInv.items || []).find((item) => item?.kind === "mysteriousAncientTome");
  assert.ok(tome, "[skill-feature] mysteriousAncientTome missing from Temple Ruins inventory");
  const clearedLeaderItem = (ownerInv.items || []).find(
    (item) => Math.max(1, Math.floor(item?.width ?? 1)) >= 2 && Math.max(1, Math.floor(item?.height ?? 1)) >= 2
  );
  assert.ok(clearedLeaderItem, "[skill-feature] expected a 2x2 leader item to clear tome space");
  const clearSpaceRes = applyAction(state, {
    kind: ActionKinds.INVENTORY_DISCARD,
    payload: {
      ownerId: leader.id,
      itemId: clearedLeaderItem.id,
    },
    apCost: 0,
  });
  assert.equal(
    clearSpaceRes?.ok,
    true,
    `[skill-feature] failed to clear leader inventory space for tome: ${JSON.stringify(clearSpaceRes)}`
  );

  const moveRes = applyAction(state, {
    kind: ActionKinds.INVENTORY_MOVE,
    payload: {
      fromOwnerId: templeRuins.instanceId,
      toOwnerId: leader.id,
      itemId: tome.id,
      targetGX: clearedLeaderItem.gridX,
      targetGY: clearedLeaderItem.gridY,
    },
    apCost: 0,
  });
  assert.equal(
    moveRes?.ok,
    true,
    `[skill-feature] failed to move mysteriousAncientTome to leader inventory: ${JSON.stringify(moveRes)}`
  );

  const movedTome = (ownerInv.items || []).find((item) => item?.kind === "mysteriousAncientTome");
  assert.ok(movedTome, "[skill-feature] mysteriousAncientTome should be movable from Temple Ruins");

  assert.equal(
    hasSkillFeatureUnlock(state, "ui.log.event"),
    false,
    "[skill-feature] tome scenario should start with event log locked"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.deck.event"),
    false,
    "[skill-feature] tome scenario should start with event deck locked"
  );
  const beforePoints = Number.isFinite(leader.skillPoints)
    ? Math.floor(leader.skillPoints)
    : 0;

  const useRes = applyAction(state, {
    kind: ActionKinds.INVENTORY_USE_ITEM,
    payload: {
      ownerId: leader.id,
      itemId: movedTome.id,
    },
  });
  assert.equal(
    useRes?.ok,
    true,
    `[skill-feature] mysteriousAncientTome use failed: ${JSON.stringify(useRes)}`
  );

  const unlocked = Array.isArray(leader.unlockedSkillNodeIds)
    ? leader.unlockedSkillNodeIds
    : [];
  assert.equal(
    unlocked.includes("Memory"),
    true,
    "[skill-feature] mysteriousAncientTome should grant Memory node"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.log.event"),
    true,
    "[skill-feature] mysteriousAncientTome should grant event log feature via Memory onUnlock"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.deck.event"),
    true,
    "[skill-feature] mysteriousAncientTome should grant event deck feature via Memory onUnlock"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.tooltip.droppedItems"),
    true,
    "[skill-feature] mysteriousAncientTome should grant dropped-items tooltip feature via Memory onUnlock"
  );
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.inventory.skills"),
    true,
    "[skill-feature] mysteriousAncientTome should grant inventory skills feature via Memory onUnlock"
  );
  assert.equal(
    Number.isFinite(leader.skillPoints) ? Math.floor(leader.skillPoints) : 0,
    beforePoints + 4,
    "[skill-feature] mysteriousAncientTome should add +4 skill points"
  );
  assert.equal(
    (ownerInv.items || []).some((item) => item?.id === movedTome.id),
    false,
    "[skill-feature] mysteriousAncientTome should be consumed on use"
  );
}

function run() {
  runFeatureUnlockEffectOpChecks();
  runUnlockCommandReplayAndSerializationChecks();
  runSolarAstronomySeasonalDeckFeatureChecks();
  runGraphOpenFeatureUnlockChecks();
  runScenarioMemoryFeatureBootstrapChecks();
  runMysteriousAncientTomeItemUseChecks();
  console.log("[test] Skill feature unlock checks passed");
}

run();
