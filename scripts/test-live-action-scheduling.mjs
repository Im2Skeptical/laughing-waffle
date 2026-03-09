import assert from "node:assert/strict";

import { createSimRunner } from "../src/controllers/sim-runner.js";
import { ActionKinds } from "../src/model/actions.js";
import { rebuildStateAtSecond } from "../src/model/timeline/index.js";
import { createPausedActionQueue } from "../src/views/ui-root/paused-action-queue.js";

function assertOk(res, label) {
  assert.equal(res?.ok, true, `${label} failed: ${JSON.stringify(res)}`);
}

function advanceFrames(runner, frames) {
  const total = Math.max(0, Math.floor(frames));
  for (let i = 0; i < total; i += 1) {
    runner.update(1 / 60);
  }
}

function unpauseRunner(runner) {
  runner.setTimeScaleTarget?.(1, { unpause: true });
  runner.setPaused(false);
}

function runPauseHelperToggleChecks() {
  const calls = [];
  const runner = {
    getCursorState: () => ({ paused: false }),
    setTimeScaleTarget: (...args) => calls.push(["timeScale", ...args]),
    setPaused: (...args) => calls.push(["paused", ...args]),
    isPreviewing: () => false,
  };
  const queue = createPausedActionQueue({ runner });

  assert.equal(
    queue.isAutoPauseOnPlayerActionEnabled(),
    false,
    "autopause should default off"
  );

  queue.requestPauseForAction();
  assert.equal(calls.length, 0, "requestPauseForAction should no-op while toggle is off");

  assertOk(
    queue.setAutoPauseOnPlayerAction(true),
    "enable autopause on player action"
  );
  queue.requestPauseForAction();
  assert.deepEqual(
    calls,
    [
      ["timeScale", 0, { requestPause: true }],
      ["paused", true],
    ],
    "requestPauseForAction should pause immediately while toggle is on"
  );
}

function getFirstTileTagTarget(state) {
  const cols = Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 0;
  for (let envCol = 0; envCol < cols; envCol += 1) {
    const tile = state?.board?.occ?.tile?.[envCol];
    const tags = Array.isArray(tile?.tags) ? tile.tags : [];
    if (!tags.length) continue;
    return { envCol, tagId: tags[0] };
  }
  return null;
}

function runPlannerBackedLiveSchedulingChecks() {
  const runner = createSimRunner({ setupId: "devPlaytesting01" });
  assertOk(runner.init(), "planner live schedule runner init");

  const pausedActionQueue = createPausedActionQueue({ runner });
  const planner = runner.getActionPlanner();
  const state = runner.getCursorState();
  const target = getFirstTileTagTarget(state);
  assert.ok(target, "expected a visible tile tag to toggle");

  const tile =
    state?.board?.occ?.tile?.[target.envCol] ??
    null;
  const initialDisabled = tile?.tagStates?.[target.tagId]?.disabled === true;

  unpauseRunner(runner);
  const res = pausedActionQueue.queueActionWhenPaused({
    runWhenPaused: () =>
      planner?.setTileTagToggleIntent?.({
        envCol: target.envCol,
        tagId: target.tagId,
        disabled: !initialDisabled,
      }) || { ok: false, reason: "noPlanner" },
    runWhenLive: () =>
      runner.scheduleActionAtNextSecond(
        ActionKinds.TOGGLE_TILE_TAG,
        {
          envCol: target.envCol,
          tagId: target.tagId,
          disabled: !initialDisabled,
        },
        { apCost: 0, reason: "testPlannerLiveToggle" }
      ),
  });
  assertOk(res, "planner-backed live tile toggle");
  assert.equal(res.scheduled, true, "planner-backed live action should schedule instead of pausing");

  const stateBeforeBoundary = runner.getCursorState();
  const beforeDisabled =
    stateBeforeBoundary?.board?.occ?.tile?.[target.envCol]?.tagStates?.[target.tagId]
      ?.disabled === true;
  assert.equal(
    beforeDisabled,
    initialDisabled,
    "scheduled planner-backed action should not mutate current live state immediately"
  );

  advanceFrames(runner, 61);
  const liveState = runner.getCursorState();
  const liveDisabled =
    liveState?.board?.occ?.tile?.[target.envCol]?.tagStates?.[target.tagId]
      ?.disabled === true;
  assert.equal(
    liveDisabled,
    !initialDisabled,
    "scheduled planner-backed action should apply on the next second boundary"
  );

  const rebuilt = rebuildStateAtSecond(
    runner.getTimeline(),
    Math.floor(liveState?.tSec ?? 0)
  );
  assertOk(rebuilt, "planner-backed rebuild parity");
  const rebuiltDisabled =
    rebuilt.state?.board?.occ?.tile?.[target.envCol]?.tagStates?.[target.tagId]
      ?.disabled === true;
  assert.equal(
    rebuiltDisabled,
    liveDisabled,
    "replay rebuild should match scheduled planner-backed live action"
  );
}

function getInventoryOwnerWithAtLeastTwoItems(state) {
  const inventories =
    state?.ownerInventories && typeof state.ownerInventories === "object"
      ? state.ownerInventories
      : {};
  for (const [ownerIdRaw, inv] of Object.entries(inventories)) {
    const items = Array.isArray(inv?.items) ? inv.items.filter(Boolean) : [];
    if (items.length < 2) continue;
    const ownerIdNum = Number(ownerIdRaw);
    return {
      ownerId: Number.isFinite(ownerIdNum) ? ownerIdNum : ownerIdRaw,
      itemIds: items.slice(0, 2).map((item) => item.id),
    };
  }
  return null;
}

function runDirectDispatchSchedulingChecks() {
  const runner = createSimRunner({ setupId: "devPlaytesting01" });
  assertOk(runner.init(), "direct-dispatch runner init");

  const inventoryTarget = getInventoryOwnerWithAtLeastTwoItems(runner.getCursorState());
  assert.ok(inventoryTarget, "expected an inventory owner with at least two items");

  unpauseRunner(runner);
  const discardA = runner.dispatchAction(
    ActionKinds.INVENTORY_DISCARD,
    { ownerId: inventoryTarget.ownerId, itemId: inventoryTarget.itemIds[0] },
    { apCost: 0 }
  );
  const discardB = runner.dispatchAction(
    ActionKinds.INVENTORY_DISCARD,
    { ownerId: inventoryTarget.ownerId, itemId: inventoryTarget.itemIds[1] },
    { apCost: 0 }
  );
  assertOk(discardA, "direct-dispatch live discard A");
  assertOk(discardB, "direct-dispatch live discard B");
  assert.equal(discardA.scheduled, true, "direct-dispatch live discard A should schedule");
  assert.equal(discardB.scheduled, true, "direct-dispatch live discard B should schedule");

  const scheduledAtNextSecond = (runner.getTimeline()?.actions ?? []).filter(
    (action) => Math.floor(action?.tSec ?? -1) === 1
  );
  const lastTwo = scheduledAtNextSecond.slice(-2);
  assert.equal(lastTwo.length, 2, "expected two live-scheduled inventory actions at t=1");
  assert.deepEqual(
    lastTwo.map((action) => action?.payload?.itemId ?? null),
    inventoryTarget.itemIds,
    "multiple live-scheduled actions should preserve input order at the next second"
  );

  advanceFrames(runner, 61);
  const liveItems = Array.isArray(
    runner.getCursorState()?.ownerInventories?.[inventoryTarget.ownerId]?.items
  )
    ? runner.getCursorState().ownerInventories[inventoryTarget.ownerId].items
    : [];
  const liveItemIds = new Set(liveItems.map((item) => item?.id));
  assert.equal(
    liveItemIds.has(inventoryTarget.itemIds[0]),
    false,
    "first scheduled inventory discard should apply on the next second boundary"
  );
  assert.equal(
    liveItemIds.has(inventoryTarget.itemIds[1]),
    false,
    "second scheduled inventory discard should apply on the next second boundary"
  );

  const rebuilt = rebuildStateAtSecond(
    runner.getTimeline(),
    Math.floor(runner.getCursorState()?.tSec ?? 0)
  );
  assertOk(rebuilt, "direct-dispatch rebuild parity");
  const rebuiltItems = Array.isArray(
    rebuilt.state?.ownerInventories?.[inventoryTarget.ownerId]?.items
  )
    ? rebuilt.state.ownerInventories[inventoryTarget.ownerId].items
    : [];
  const rebuiltItemIds = new Set(rebuiltItems.map((item) => item?.id));
  assert.equal(
    rebuiltItemIds.has(inventoryTarget.itemIds[0]),
    false,
    "replay rebuild should match first live-scheduled inventory discard"
  );
  assert.equal(
    rebuiltItemIds.has(inventoryTarget.itemIds[1]),
    false,
    "replay rebuild should match second live-scheduled inventory discard"
  );
}

function run() {
  runPauseHelperToggleChecks();
  runPlannerBackedLiveSchedulingChecks();
  runDirectDispatchSchedulingChecks();
  console.log("[test] Live action scheduling checks passed");
}

run();
