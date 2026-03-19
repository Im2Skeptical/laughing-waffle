import assert from "node:assert/strict";

import { createSimRunner } from "../src/controllers/sim-runner.js";
import { ActionKinds, applyAction } from "../src/model/actions.js";
import { getInventoryOwnerVisibility } from "../src/model/inventory-owner-visibility.js";
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
    const ownerId = Number.isFinite(ownerIdNum) ? ownerIdNum : ownerIdRaw;
    if (getInventoryOwnerVisibility(state, ownerId).visible === false) continue;
    return {
      ownerId,
      itemIds: items.slice(0, 2).map((item) => item.id),
    };
  }
  return null;
}

function reconstructCurrentSecondState(runner, tSec, elapsedStepsWithinSecond) {
  void elapsedStepsWithinSecond;
  const rebuilt = rebuildStateAtSecond(runner.getTimeline(), tSec);
  assertOk(rebuilt, "current-second rebuild parity");
  return rebuilt.state;
}

function findSameOwnerChainMoveTarget(state) {
  const inventories =
    state?.ownerInventories && typeof state.ownerInventories === "object"
      ? state.ownerInventories
      : {};
  for (const [ownerIdRaw, inv] of Object.entries(inventories)) {
    const ownerIdNum = Number(ownerIdRaw);
    const ownerId = Number.isFinite(ownerIdNum) ? ownerIdNum : ownerIdRaw;
    if (getInventoryOwnerVisibility(state, ownerId).visible === false) continue;
    const items = Array.isArray(inv?.items) ? inv.items.filter(Boolean) : [];
    const item = items.find(
      (candidate) =>
        Math.floor(candidate?.width ?? 1) === 1 && Math.floor(candidate?.height ?? 1) === 1
    );
    if (!item) continue;

    const occupied = new Set();
    for (const existing of items) {
      if (!existing) continue;
      occupied.add(`${existing.gridX}:${existing.gridY}`);
    }

    const emptyCells = [];
    const cols = Math.max(0, Math.floor(inv?.cols ?? 0));
    const rows = Math.max(0, Math.floor(inv?.rows ?? 0));
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const key = `${gx}:${gy}`;
        if (occupied.has(key)) continue;
        emptyCells.push({ gx, gy });
      }
    }

    for (let firstIndex = 0; firstIndex < emptyCells.length; firstIndex += 1) {
      for (let secondIndex = 0; secondIndex < emptyCells.length; secondIndex += 1) {
        if (firstIndex === secondIndex) continue;
        const firstTarget = emptyCells[firstIndex];
        const secondTarget = emptyCells[secondIndex];
        const trialState = JSON.parse(JSON.stringify(state));
        trialState.paused = true;
        const firstMove = applyAction(trialState, {
          kind: ActionKinds.INVENTORY_MOVE,
          payload: {
            fromOwnerId: ownerId,
            toOwnerId: ownerId,
            itemId: item.id,
            targetGX: firstTarget.gx,
            targetGY: firstTarget.gy,
          },
          apCost: 0,
        });
        if (!firstMove?.ok) continue;
        const secondMove = applyAction(trialState, {
          kind: ActionKinds.INVENTORY_MOVE,
          payload: {
            fromOwnerId: ownerId,
            toOwnerId: ownerId,
            itemId: item.id,
            targetGX: secondTarget.gx,
            targetGY: secondTarget.gy,
          },
          apCost: 0,
        });
        if (!secondMove?.ok) continue;
        return {
          ownerId,
          itemId: item.id,
          firstTarget,
          secondTarget,
        };
      }
    }
  }
  return null;
}

function runFreeLiveCurrentSecondDispatchChecks() {
  const runner = createSimRunner({ setupId: "devPlaytesting01" });
  assertOk(runner.init(), "free-live current-second runner init");

  unpauseRunner(runner);
  advanceFrames(runner, 5 * 60 + 5);
  const stateBefore = runner.getCursorState();
  const inventoryTarget = getInventoryOwnerWithAtLeastTwoItems(stateBefore);
  assert.ok(inventoryTarget, "expected a visible inventory owner with at least two items");
  const currentSec = Math.max(0, Math.floor(stateBefore?.tSec ?? 0));
  const elapsedSteps = Math.floor(stateBefore?.simStepIndex ?? 0) % 60;
  assert.ok(elapsedSteps > 0, "expected to be mid-second before current-second dispatch");

  const discardRes = runner.dispatchActionAtCurrentSecond(
    ActionKinds.INVENTORY_DISCARD,
    { ownerId: inventoryTarget.ownerId, itemId: inventoryTarget.itemIds[0] },
    { apCost: 0, reason: "testCurrentSecondDiscard" }
  );
  assertOk(discardRes, "current-second discard");
  assert.equal(discardRes.applied, true, "current-second discard should apply immediately");
  assert.equal(
    discardRes.scheduled,
    undefined,
    "current-second discard should not report scheduled"
  );
  assert.equal(discardRes.tSec, currentSec, "current-second discard should use live current sec");
  assert.equal(
    discardRes.resimulatedSteps,
    elapsedSteps,
    "current-second discard should report the replayed microsteps"
  );
  assert.equal(
    Math.floor(runner.getCursorState()?.simStepIndex ?? -1),
    Math.floor(stateBefore?.simStepIndex ?? -2),
    "current-second discard should not rewind the live microstep cursor"
  );

  const liveItems = Array.isArray(
    runner.getCursorState()?.ownerInventories?.[inventoryTarget.ownerId]?.items
  )
    ? runner.getCursorState().ownerInventories[inventoryTarget.ownerId].items
    : [];
  const liveItemIds = new Set(liveItems.map((item) => item?.id));
  assert.equal(
    liveItemIds.has(inventoryTarget.itemIds[0]),
    false,
    "current-second discard should mutate live state immediately"
  );

  const currentSecondActions = (runner.getTimeline()?.actions ?? []).filter(
    (action) => Math.floor(action?.tSec ?? -1) === currentSec
  );
  assert.ok(
    currentSecondActions.some(
      (action) =>
        action?.kind === ActionKinds.INVENTORY_DISCARD &&
        action?.payload?.itemId === inventoryTarget.itemIds[0]
    ),
    "current-second discard should be recorded on the live current second"
  );

  const expectedState = reconstructCurrentSecondState(runner, currentSec, elapsedSteps);
  const expectedItems = Array.isArray(expectedState?.ownerInventories?.[inventoryTarget.ownerId]?.items)
    ? expectedState.ownerInventories[inventoryTarget.ownerId].items
    : [];
  assert.deepEqual(
    expectedItems.map((item) => item?.id).sort((a, b) => a - b),
    liveItems.map((item) => item?.id).sort((a, b) => a - b),
    "current-second discard should match deterministic boundary resimulation"
  );
  assert.equal(
    Math.floor(runner.getCursorState()?.simStepIndex ?? -1),
    Math.floor(expectedState?.simStepIndex ?? -2),
    "current-second discard should preserve the live microstep position"
  );
}

function runCurrentSecondBatchChecks() {
  const runner = createSimRunner({ setupId: "devPlaytesting01" });
  assertOk(runner.init(), "current-second batch runner init");

  unpauseRunner(runner);
  advanceFrames(runner, 5 * 60 + 7);
  const stateBefore = runner.getCursorState();
  const inventoryTarget = getInventoryOwnerWithAtLeastTwoItems(stateBefore);
  assert.ok(inventoryTarget, "expected a visible inventory owner with at least two items");
  const currentSec = Math.max(0, Math.floor(stateBefore?.tSec ?? 0));
  const elapsedSteps = Math.floor(stateBefore?.simStepIndex ?? 0) % 60;

  const batchRes = runner.dispatchActionsAtCurrentSecond(
    [
      {
        kind: ActionKinds.INVENTORY_DISCARD,
        payload: { ownerId: inventoryTarget.ownerId, itemId: inventoryTarget.itemIds[0] },
        apCost: 0,
      },
      {
        kind: ActionKinds.INVENTORY_DISCARD,
        payload: { ownerId: inventoryTarget.ownerId, itemId: inventoryTarget.itemIds[1] },
        apCost: 0,
      },
    ],
    { reason: "testCurrentSecondBatchDiscard" }
  );
  assertOk(batchRes, "current-second batch");
  assert.equal(batchRes.applied, true, "current-second batch should apply immediately");
  assert.equal(batchRes.count, 2, "current-second batch should report action count");
  assert.equal(
    Math.floor(runner.getCursorState()?.simStepIndex ?? -1),
    Math.floor(stateBefore?.simStepIndex ?? -2),
    "current-second batch should not rewind the live microstep cursor"
  );

  const currentSecondActions = (runner.getTimeline()?.actions ?? []).filter(
    (action) => Math.floor(action?.tSec ?? -1) === currentSec
  );
  const lastTwo = currentSecondActions.slice(-2);
  assert.deepEqual(
    lastTwo.map((action) => action?.payload?.itemId ?? null),
    inventoryTarget.itemIds,
    "current-second batch should preserve input order"
  );

  const liveItems = Array.isArray(
    runner.getCursorState()?.ownerInventories?.[inventoryTarget.ownerId]?.items
  )
    ? runner.getCursorState().ownerInventories[inventoryTarget.ownerId].items
    : [];
  const liveItemIds = new Set(liveItems.map((item) => item?.id));
  assert.equal(liveItemIds.has(inventoryTarget.itemIds[0]), false);
  assert.equal(liveItemIds.has(inventoryTarget.itemIds[1]), false);

  const expectedState = reconstructCurrentSecondState(runner, currentSec, elapsedSteps);
  assert.equal(
    Math.floor(expectedState?.ownerInventories?.[inventoryTarget.ownerId]?.items?.length ?? -1),
    liveItems.length,
    "current-second batch should match deterministic boundary resimulation"
  );
}

function runCurrentSecondChainMoveChecks() {
  const runner = createSimRunner({ setupId: "devPlaytesting01" });
  assertOk(runner.init(), "current-second chain move runner init");

  unpauseRunner(runner);
  advanceFrames(runner, 5 * 60 + 9);
  const chainTarget = findSameOwnerChainMoveTarget(runner.getCursorState());
  assert.ok(chainTarget, "expected a same-owner chain move target");
  const currentSec = Math.max(0, Math.floor(runner.getCursorState()?.tSec ?? 0));

  const firstMove = runner.dispatchActionAtCurrentSecond(
    ActionKinds.INVENTORY_MOVE,
    {
      fromOwnerId: chainTarget.ownerId,
      toOwnerId: chainTarget.ownerId,
      itemId: chainTarget.itemId,
      targetGX: chainTarget.firstTarget.gx,
      targetGY: chainTarget.firstTarget.gy,
    },
    { apCost: 0, reason: "testCurrentSecondChainMove:first" }
  );
  assertOk(firstMove, "first chain move");
  assert.equal(firstMove.tSec, currentSec, "first chain move should stay in the same second");

  const secondMove = runner.dispatchActionAtCurrentSecond(
    ActionKinds.INVENTORY_MOVE,
    {
      fromOwnerId: chainTarget.ownerId,
      toOwnerId: chainTarget.ownerId,
      itemId: chainTarget.itemId,
      targetGX: chainTarget.secondTarget.gx,
      targetGY: chainTarget.secondTarget.gy,
    },
    { apCost: 0, reason: "testCurrentSecondChainMove:second" }
  );
  assertOk(secondMove, "second chain move");
  assert.equal(secondMove.tSec, currentSec, "second chain move should stay in the same second");

  const movedItem =
    runner
      .getCursorState()
      ?.ownerInventories?.[chainTarget.ownerId]
      ?.items?.find?.((item) => item?.id === chainTarget.itemId) ?? null;
  assert.equal(
    movedItem?.gridX ?? null,
    chainTarget.secondTarget.gx,
    "chain move should land at the final x target immediately"
  );
  assert.equal(
    movedItem?.gridY ?? null,
    chainTarget.secondTarget.gy,
    "chain move should land at the final y target immediately"
  );
}

function runDirectDispatchSchedulingChecks() {
  const runner = createSimRunner({ setupId: "devPlaytesting01" });
  assertOk(runner.init(), "direct-dispatch runner init");

  unpauseRunner(runner);
  advanceFrames(runner, 5 * 60);
  const inventoryTarget = getInventoryOwnerWithAtLeastTwoItems(runner.getCursorState());
  assert.ok(inventoryTarget, "expected a visible inventory owner with at least two items");
  const scheduledSec = Math.max(
    0,
    Math.floor(runner.getCursorState()?.tSec ?? 0) + 1
  );
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
    (action) => Math.floor(action?.tSec ?? -1) === scheduledSec
  );
  const lastTwo = scheduledAtNextSecond.slice(-2);
  assert.equal(
    lastTwo.length,
    2,
    `expected two live-scheduled inventory actions at t=${scheduledSec}`
  );
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
  runFreeLiveCurrentSecondDispatchChecks();
  runCurrentSecondBatchChecks();
  runCurrentSecondChainMoveChecks();
  runDirectDispatchSchedulingChecks();
  console.log("[test] Live action scheduling checks passed");
}

run();
