import assert from "node:assert/strict";

import { createActionPlanner } from "../src/controllers/actionmanagers/action-planner.js";
import { Inventory } from "../src/model/inventory-model.js";
import { cmdMoveItemBetweenOwners } from "../src/model/commands/inventory-commands.js";

function cloneSerializable(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (_) {
    // Fall back to JSON for plain game-state data.
  }
  return JSON.parse(JSON.stringify(value));
}

function makeState() {
  return {
    nextItemId: 1,
    tSec: 0,
    paused: true,
    actionPoints: 9999,
    actionPointCap: 9999,
    ownerInventories: {},
    hub: { anchors: [], slots: [], occ: [] },
    board: { layers: { tile: { anchors: [] } } },
    pawns: [],
    variantFlags: {
      inventoryTransferGhostPreviewEnabled: true,
    },
  };
}

function ensureInventory(state, ownerId, cols = 4, rows = 2) {
  const inv = Inventory.create(cols, Math.max(2, rows));
  Inventory.init(inv);
  inv.version = 0;
  state.ownerInventories[ownerId] = inv;
  if (typeof ownerId === "number" && !state.pawns.some((pawn) => pawn?.id === ownerId)) {
    state.pawns.push({
      id: ownerId,
      role: "leader",
      equipment: {},
      systemState: {},
    });
  }
  return inv;
}

function addItem(state, inv, kind, quantity, overrides = {}) {
  const item = Inventory.addNewItem(state, inv, {
    kind,
    quantity,
    gridX: overrides.gridX ?? 0,
    gridY: overrides.gridY ?? 0,
    width: overrides.width ?? 1,
    height: overrides.height ?? 1,
    tier: overrides.tier ?? "bronze",
    seasonsToExpire: overrides.seasonsToExpire ?? null,
    tags: overrides.tags ?? [],
    systemTiers: overrides.systemTiers ?? {},
    systemState: overrides.systemState ?? {},
  });
  assert.ok(item, `failed to add ${kind}`);
  return item;
}

function getItem(inv, itemId) {
  return inv.itemsById?.[itemId] || inv.items?.find((item) => item.id === itemId) || null;
}

function createPlanner(state) {
  const timeline = {
    revision: 0,
    actions: [],
  };
  return createActionPlanner({
    getTimeline: () => timeline,
    getState: () => state,
    getPreviewBoundaryStateData: () => ({
      ok: true,
      stateData: cloneSerializable(state),
    }),
  });
}

function getOverlayItem(preview, itemId) {
  return preview.overlayItems.find((item) => item?.id === itemId) || null;
}

function summarizeInventory(inv) {
  return (inv.items || [])
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      quantity: Math.floor(item.quantity ?? 0),
      gridX: Math.floor(item.gridX ?? 0),
      gridY: Math.floor(item.gridY ?? 0),
    }))
    .sort((left, right) => left.id - right.id);
}

function runCrossOwnerAutostackFullMoveTest() {
  const state = makeState();
  const fromInv = ensureInventory(state, 1, 3, 1);
  const toInv = ensureInventory(state, 2, 2, 1);
  const source = addItem(state, fromInv, "reeds", 5, { gridX: 0, gridY: 0 });
  const target = addItem(state, toInv, "reeds", 22, { gridX: 0, gridY: 0 });

  const res = cmdMoveItemBetweenOwners(state, {
    fromOwnerId: 1,
    toOwnerId: 2,
    itemId: source.id,
    targetGX: 0,
    targetGY: 0,
  });

  assert.equal(res?.ok, true, `full autostack move failed: ${JSON.stringify(res)}`);
  assert.equal(getItem(fromInv, source.id), null, "source item should leave source inventory");
  assert.equal(getItem(toInv, target.id)?.quantity, 25, "target stack should fill first");
  const moved = getItem(toInv, source.id);
  assert.ok(moved, "remainder should move into target inventory");
  assert.equal(moved?.quantity, 2);
  assert.equal(moved?.gridX, 1);
  assert.equal(moved?.gridY, 0);
}

function runCrossOwnerAutostackDeterministicOrderTest() {
  const state = makeState();
  const fromInv = ensureInventory(state, 1, 2, 1);
  const toInv = ensureInventory(state, 2, 3, 1);
  const source = addItem(state, fromInv, "reeds", 3, { gridX: 0, gridY: 0 });
  const later = addItem(state, toInv, "reeds", 20, { gridX: 1, gridY: 0 });
  const earlier = addItem(state, toInv, "reeds", 24, { gridX: 0, gridY: 0 });

  const res = cmdMoveItemBetweenOwners(state, {
    fromOwnerId: 1,
    toOwnerId: 2,
    itemId: source.id,
    targetGX: 0,
    targetGY: 0,
  });

  assert.equal(res?.ok, true, `deterministic autostack failed: ${JSON.stringify(res)}`);
  assert.equal(getItem(toInv, earlier.id)?.quantity, 25, "earlier stack should fill first");
  assert.equal(getItem(toInv, later.id)?.quantity, 22, "later stack should receive remaining units");
  assert.equal(getItem(fromInv, source.id), null, "source item should be consumed by stacking");
}

function runCrossOwnerAutostackFallbackPlacementTest() {
  const state = makeState();
  const fromInv = ensureInventory(state, 1, 2, 1);
  const toInv = ensureInventory(state, 2, 3, 1);
  const source = addItem(state, fromInv, "reeds", 10, { gridX: 0, gridY: 0 });
  const left = addItem(state, toInv, "reeds", 20, { gridX: 0, gridY: 0 });
  const mid = addItem(state, toInv, "reeds", 24, { gridX: 1, gridY: 0 });

  const res = cmdMoveItemBetweenOwners(state, {
    fromOwnerId: 1,
    toOwnerId: 2,
    itemId: source.id,
    targetGX: 0,
    targetGY: 0,
  });

  assert.equal(res?.ok, true, `fallback placement failed: ${JSON.stringify(res)}`);
  assert.equal(getItem(toInv, left.id)?.quantity, 25);
  assert.equal(getItem(toInv, mid.id)?.quantity, 25);
  const moved = getItem(toInv, source.id);
  assert.ok(moved, "overflow remainder should be placed into first valid slot");
  assert.equal(moved?.quantity, 4);
  assert.equal(moved?.gridX, 2);
  assert.equal(moved?.gridY, 0);
}

function runCrossOwnerAutostackPartialNoSpaceTest() {
  const state = makeState();
  const fromInv = ensureInventory(state, 1, 2, 1);
  const toInv = ensureInventory(state, 2, 2, 1);
  const source = addItem(state, fromInv, "reeds", 10, { gridX: 0, gridY: 0 });
  const left = addItem(state, toInv, "reeds", 22, { gridX: 0, gridY: 0 });
  const right = addItem(state, toInv, "reeds", 24, { gridX: 1, gridY: 0 });

  const res = cmdMoveItemBetweenOwners(state, {
    fromOwnerId: 1,
    toOwnerId: 2,
    itemId: source.id,
    targetGX: 0,
    targetGY: 0,
  });

  assert.equal(res?.ok, true, `partial autostack failed: ${JSON.stringify(res)}`);
  assert.equal(res?.partial, true, "overflow-without-slot should report partial");
  assert.equal(res?.moved, 4, "only stackable amount should move");
  assert.equal(getItem(toInv, left.id)?.quantity, 25);
  assert.equal(getItem(toInv, right.id)?.quantity, 25);
  assert.equal(getItem(fromInv, source.id)?.quantity, 6, "remainder should stay in source");
}

function runCrossOwnerPlainMoveValidPlacementTest() {
  const state = makeState();
  const fromInv = ensureInventory(state, 1, 2, 1);
  const toInv = ensureInventory(state, 2, 2, 1);
  const source = addItem(state, fromInv, "reeds", 2, { gridX: 0, gridY: 0 });

  const res = cmdMoveItemBetweenOwners(state, {
    fromOwnerId: 1,
    toOwnerId: 2,
    itemId: source.id,
    targetGX: 1,
    targetGY: 0,
  });

  assert.equal(res?.ok, true, `plain cross-owner move failed: ${JSON.stringify(res)}`);
  assert.equal(getItem(fromInv, source.id), null);
  assert.equal(getItem(toInv, source.id)?.gridX, 1);
  assert.equal(getItem(toInv, source.id)?.gridY, 0);
}

function runCrossOwnerPlainMoveBlockedWithoutAutostackTest() {
  const state = makeState();
  const fromInv = ensureInventory(state, 1, 2, 1);
  const toInv = ensureInventory(state, 2, 2, 1);
  const source = addItem(state, fromInv, "reeds", 2, { gridX: 0, gridY: 0 });
  addItem(state, toInv, "stone", 1, { gridX: 0, gridY: 0 });

  const res = cmdMoveItemBetweenOwners(state, {
    fromOwnerId: 1,
    toOwnerId: 2,
    itemId: source.id,
    targetGX: 0,
    targetGY: 0,
  });

  assert.equal(res?.ok, false, "blocked plain move should fail");
  assert.equal(res?.reason, "blocked");
  assert.equal(getItem(fromInv, source.id)?.quantity, 2, "source should remain unchanged");
  assert.equal(getItem(toInv, source.id), null, "source item should not move to fallback slot");
}

function runSameOwnerStackIntentionalTargetOnlyTest() {
  const stackState = makeState();
  const stackInv = ensureInventory(stackState, 1, 3, 1);
  const source = addItem(stackState, stackInv, "reeds", 5, { gridX: 0, gridY: 0 });
  const target = addItem(stackState, stackInv, "reeds", 7, { gridX: 1, gridY: 0 });

  const stackRes = cmdMoveItemBetweenOwners(stackState, {
    fromOwnerId: 1,
    toOwnerId: 1,
    itemId: source.id,
    targetGX: 1,
    targetGY: 0,
  });
  assert.equal(stackRes?.ok, true, `same-owner stack failed: ${JSON.stringify(stackRes)}`);
  assert.equal(getItem(stackInv, target.id)?.quantity, 12, "same-owner targeted drop should stack");
  assert.equal(getItem(stackInv, source.id), null, "source stack should be consumed by same-owner stack");

  const moveState = makeState();
  const moveInv = ensureInventory(moveState, 1, 3, 1);
  const movable = addItem(moveState, moveInv, "reeds", 5, { gridX: 0, gridY: 0 });
  addItem(moveState, moveInv, "reeds", 7, { gridX: 1, gridY: 0 });

  const moveRes = cmdMoveItemBetweenOwners(moveState, {
    fromOwnerId: 1,
    toOwnerId: 1,
    itemId: movable.id,
    targetGX: 2,
    targetGY: 0,
  });
  assert.equal(moveRes?.ok, true, `same-owner move failed: ${JSON.stringify(moveRes)}`);
  assert.equal(getItem(moveInv, movable.id)?.gridX, 2, "same-owner non-targeted drop should remain a move");
  assert.equal(getItem(moveInv, movable.id)?.quantity, 5);
}

function runPlannerPreviewPartialAutostackTest() {
  const state = makeState();
  const fromInv = ensureInventory(state, 1, 2, 1);
  const toInv = ensureInventory(state, 2, 2, 1);
  const source = addItem(state, fromInv, "reeds", 10, { gridX: 0, gridY: 0 });
  const left = addItem(state, toInv, "reeds", 22, { gridX: 0, gridY: 0 });
  const right = addItem(state, toInv, "reeds", 24, { gridX: 1, gridY: 0 });
  const planner = createPlanner(state);

  const intentRes = planner.setItemTransferIntent({
    fromOwnerId: 1,
    toOwnerId: 2,
    itemId: source.id,
    targetGX: 0,
    targetGY: 0,
  });
  assert.equal(intentRes?.ok, true, `planner partial intent failed: ${JSON.stringify(intentRes)}`);

  const sourcePreview = planner.getInventoryPreview(1);
  const targetPreview = planner.getInventoryPreview(2);
  assert.equal(sourcePreview.hiddenItemIds.has(source.id), true, "source base item should be hidden");
  assert.equal(targetPreview.hiddenItemIds.has(left.id), true, "left target stack should be hidden");
  assert.equal(targetPreview.hiddenItemIds.has(right.id), true, "right target stack should be hidden");
  assert.equal(getOverlayItem(sourcePreview, source.id)?.quantity, 6, "source remainder overlay should show reduced quantity");
  assert.equal(getOverlayItem(sourcePreview, source.id)?.sourceOwnerId, 1, "source remainder overlay should remain draggable from source owner");
  assert.equal(getOverlayItem(targetPreview, left.id)?.quantity, 25, "left target overlay should show filled stack");
  assert.equal(getOverlayItem(targetPreview, right.id)?.quantity, 25, "right target overlay should show filled stack");
  assert.equal(targetPreview.ghostItems.length, 0, "partial source remainder should not add a ghost");

  const removeRes = planner.removeIntent(`item:${source.id}`);
  assert.equal(removeRes?.ok, true, `planner remove failed: ${JSON.stringify(removeRes)}`);
  const resetSourcePreview = planner.getInventoryPreview(1);
  const resetTargetPreview = planner.getInventoryPreview(2);
  assert.equal(resetSourcePreview.hiddenItemIds.size, 0, "source preview should clear after removing intent");
  assert.equal(resetSourcePreview.overlayItems.length, 0, "source overlays should clear after removing intent");
  assert.equal(resetTargetPreview.hiddenItemIds.size, 0, "target preview should clear after removing intent");
  assert.equal(resetTargetPreview.overlayItems.length, 0, "target overlays should clear after removing intent");
}

function runPlannerPreviewFullMoveMatchesExecutionTest() {
  const state = makeState();
  const fromInv = ensureInventory(state, 1, 2, 1);
  const toInv = ensureInventory(state, 2, 3, 1);
  const source = addItem(state, fromInv, "reeds", 10, { gridX: 0, gridY: 0 });
  const left = addItem(state, toInv, "reeds", 20, { gridX: 0, gridY: 0 });
  const right = addItem(state, toInv, "reeds", 24, { gridX: 1, gridY: 0 });
  const planner = createPlanner(state);

  const intentRes = planner.setItemTransferIntent({
    fromOwnerId: 1,
    toOwnerId: 2,
    itemId: source.id,
    targetGX: 0,
    targetGY: 0,
  });
  assert.equal(intentRes?.ok, true, `planner full intent failed: ${JSON.stringify(intentRes)}`);

  const sourcePreview = planner.getInventoryPreview(1);
  const targetPreview = planner.getInventoryPreview(2);
  assert.equal(sourcePreview.hiddenItemIds.has(source.id), true, "source should hide fully moved item");
  assert.equal(sourcePreview.overlayItems.length, 0, "source should not show a remainder overlay when fully moved");
  assert.equal(getOverlayItem(targetPreview, left.id)?.quantity, 25);
  assert.equal(getOverlayItem(targetPreview, right.id)?.quantity, 25);
  const movedOverlay = getOverlayItem(targetPreview, source.id);
  assert.ok(movedOverlay, "target preview should show placed overflow remainder");
  assert.equal(movedOverlay?.quantity, 4);
  assert.equal(movedOverlay?.gridX, 2);
  assert.equal(movedOverlay?.gridY, 0);
  assert.equal(movedOverlay?.sourceOwnerId, 1, "moved overlay should remain draggable from authoritative source owner");
  assert.equal(sourcePreview.ghostItems.length, 1, "full cross-owner transfer should still show a source ghost");

  const execState = cloneSerializable(state);
  const execRes = cmdMoveItemBetweenOwners(execState, {
    fromOwnerId: 1,
    toOwnerId: 2,
    itemId: source.id,
    targetGX: 0,
    targetGY: 0,
  });
  assert.equal(execRes?.ok, true, `execution parity move failed: ${JSON.stringify(execRes)}`);
  assert.deepEqual(
    summarizeInventory(execState.ownerInventories[1]),
    [],
    "executed source inventory should match full-move preview"
  );
  assert.deepEqual(
    summarizeInventory(execState.ownerInventories[2]),
    [
      { id: source.id, kind: "reeds", quantity: 4, gridX: 2, gridY: 0 },
      { id: left.id, kind: "reeds", quantity: 25, gridX: 0, gridY: 0 },
      { id: right.id, kind: "reeds", quantity: 25, gridX: 1, gridY: 0 },
    ],
    "executed target inventory should match preview resolution"
  );
}

runCrossOwnerAutostackFullMoveTest();
runCrossOwnerAutostackDeterministicOrderTest();
runCrossOwnerAutostackFallbackPlacementTest();
runCrossOwnerAutostackPartialNoSpaceTest();
runCrossOwnerPlainMoveValidPlacementTest();
runCrossOwnerPlainMoveBlockedWithoutAutostackTest();
runSameOwnerStackIntentionalTargetOnlyTest();
runPlannerPreviewPartialAutostackTest();
runPlannerPreviewFullMoveMatchesExecutionTest();

console.log("[test] Inventory transfer autostack checks passed");
