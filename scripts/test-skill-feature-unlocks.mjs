import assert from "node:assert/strict";

import { ActionKinds, applyAction } from "../src/model/actions.js";
import { runEffect } from "../src/model/effects/index.js";
import { createInitialState } from "../src/model/game-model.js";
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

  const serialized = serializeGameState(stateAfter);
  const restored = deserializeGameState(serialized);
  assert.equal(
    hasSkillFeatureUnlock(restored, "ui.log.event"),
    true,
    "[skill-feature] serialized/deserialized state should preserve feature unlocks"
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
}

function runScenarioMemoryFeatureBootstrapChecks() {
  const state = createInitialState("devGym01");
  assert.equal(
    hasSkillFeatureUnlock(state, "ui.log.event"),
    true,
    "[skill-feature] pre-unlocked Memory should grant ui.log.event during init"
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
}

function runMysteriousAncientTomeItemUseChecks() {
  const state = createInitialState("devPlaytesting01");
  state.paused = true;
  const leader = (state?.pawns ?? []).find((pawn) => pawn?.role === "leader");
  assert.ok(leader, "[skill-feature] leader pawn missing in playtesting setup");

  const ownerInv = state?.ownerInventories?.[leader.id];
  assert.ok(ownerInv, "[skill-feature] leader inventory missing");
  const tome = (ownerInv.items || []).find((item) => item?.kind === "mysteriousAncientTome");
  assert.ok(tome, "[skill-feature] mysteriousAncientTome missing from leader inventory");

  assert.equal(
    hasSkillFeatureUnlock(state, "ui.log.event"),
    false,
    "[skill-feature] tome scenario should start with event log locked"
  );
  const beforePoints = Number.isFinite(leader.skillPoints)
    ? Math.floor(leader.skillPoints)
    : 0;

  const useRes = applyAction(state, {
    kind: ActionKinds.INVENTORY_USE_ITEM,
    payload: {
      ownerId: leader.id,
      itemId: tome.id,
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
    beforePoints + 2,
    "[skill-feature] mysteriousAncientTome should add +2 skill points"
  );
  assert.equal(
    (ownerInv.items || []).some((item) => item?.id === tome.id),
    false,
    "[skill-feature] mysteriousAncientTome should be consumed on use"
  );
}

function run() {
  runFeatureUnlockEffectOpChecks();
  runUnlockCommandReplayAndSerializationChecks();
  runScenarioMemoryFeatureBootstrapChecks();
  runMysteriousAncientTomeItemUseChecks();
  console.log("[test] Skill feature unlock checks passed");
}

run();
