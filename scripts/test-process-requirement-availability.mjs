import assert from "node:assert/strict";

import { Inventory } from "../src/model/inventory-model.js";
import { seedRoutingWithCandidates } from "../src/model/effects/ops/system/work-process-routing.js";
import { evaluateProcessRequirementAvailability } from "../src/model/process-requirement-availability.js";

function makeState() {
  return {
    nextItemId: 1,
    tSec: 0,
    resources: {},
    ownerInventories: {},
    hub: { anchors: [], slots: [], occ: [] },
    board: { layers: { tile: { anchors: [] } } },
    pawns: [],
  };
}

function ensureInventory(state, ownerId, cols = 8, rows = 8) {
  const inv = Inventory.create(cols, rows);
  Inventory.init(inv);
  inv.version = 0;
  state.ownerInventories[ownerId] = inv;
  return inv;
}

function addItem(state, inv, kind, quantity) {
  const item = Inventory.addNewItem(state, inv, {
    kind,
    quantity,
    width: 1,
    height: 1,
    tier: "bronze",
  });
  assert.ok(item, `failed to add ${kind}`);
  return item;
}

function getTotalByKind(inv, kind) {
  let total = 0;
  for (const item of inv.items || []) {
    if (!item || item.kind !== kind) continue;
    total += Math.max(0, Math.floor(item.quantity ?? 0));
  }
  return total;
}

function addHubAnchor(state, { instanceId, col }) {
  const anchor = {
    instanceId,
    defId: "workbench",
    col,
    span: 1,
    tags: [],
    systemState: {},
  };
  state.hub.anchors.push(anchor);
  return anchor;
}

function makeTargetAndSources() {
  const state = makeState();
  const target = addHubAnchor(state, { instanceId: "target", col: 0 });
  const sourceA = addHubAnchor(state, { instanceId: "sourceA", col: 1 });
  const sourceB = addHubAnchor(state, { instanceId: "sourceB", col: 2 });
  const targetInv = ensureInventory(state, target.instanceId);
  const sourceInvA = ensureInventory(state, sourceA.instanceId);
  const sourceInvB = ensureInventory(state, sourceB.instanceId);
  return {
    state,
    target,
    sourceInvA,
    sourceInvB,
    targetInv,
  };
}

function makeProcessDef(requirements) {
  return {
    processKind: "crafting",
    transform: {
      mode: "work",
      durationSec: 10,
      requirements,
      outputs: [],
      completionPolicy: "none",
    },
    routingSlots: {
      inputs: [
        {
          slotId: "materials",
          label: "Materials",
          locked: false,
          mode: "consume",
          candidateRule: {
            kind: "adjacentStructures",
            range: 5,
            store: "inv",
          },
          default: { ordered: [] },
        },
      ],
      outputs: [],
    },
    supportsDropslot: true,
  };
}

function makeProcess(requirements, enabled = null, ordered = null) {
  const order = Array.isArray(ordered)
    ? ordered
    : ["inv:hub:sourceA", "inv:hub:sourceB"];
  const enabledMap =
    enabled && typeof enabled === "object"
      ? { ...enabled }
      : {
          "inv:hub:sourceA": true,
          "inv:hub:sourceB": true,
        };
  return {
    id: "proc-test",
    type: "weaveBasket",
    mode: "work",
    durationSec: 10,
    progress: 0,
    ownerId: "target",
    requirements,
    routing: {
      inputs: {
        materials: {
          ordered: order,
          enabled: enabledMap,
        },
      },
      outputs: {},
    },
  };
}

function getFirstRequirement(result) {
  assert.ok(result && Array.isArray(result.requirements), "missing requirement result list");
  assert.equal(result.requirements.length, 1, "expected one requirement result");
  return result.requirements[0];
}

function runFulfillableReachableInputsTest() {
  const { state, target, sourceInvA, sourceInvB } = makeTargetAndSources();
  addItem(state, sourceInvA, "reeds", 12);
  addItem(state, sourceInvB, "reeds", 8);

  const requirement = {
    kind: "item",
    itemId: "reeds",
    amount: 20,
    progress: 0,
    consume: true,
    slotId: "materials",
  };
  const process = makeProcess([requirement]);
  const processDef = makeProcessDef([requirement]);

  const beforeA = getTotalByKind(sourceInvA, "reeds");
  const beforeB = getTotalByKind(sourceInvB, "reeds");
  const result = evaluateProcessRequirementAvailability({
    state,
    target,
    process,
    processDef,
  });

  const req = getFirstRequirement(result);
  assert.equal(result.canFulfillAll, true);
  assert.equal(req.fulfillable, true);
  assert.equal(req.reachableFromInputs, 20);
  assert.equal(req.accessibleTotal, 20);
  assert.equal(getTotalByKind(sourceInvA, "reeds"), beforeA);
  assert.equal(getTotalByKind(sourceInvB, "reeds"), beforeB);
}

function runShortageTest() {
  const { state, target, sourceInvA, sourceInvB } = makeTargetAndSources();
  addItem(state, sourceInvA, "reeds", 12);
  addItem(state, sourceInvB, "reeds", 8);

  const requirement = {
    kind: "item",
    itemId: "reeds",
    amount: 30,
    progress: 0,
    consume: true,
    slotId: "materials",
  };
  const process = makeProcess([requirement]);
  const processDef = makeProcessDef([requirement]);

  const result = evaluateProcessRequirementAvailability({
    state,
    target,
    process,
    processDef,
  });

  const req = getFirstRequirement(result);
  assert.equal(result.canFulfillAll, false);
  assert.equal(req.fulfillable, false);
  assert.equal(req.accessibleTotal, 20);
  assert.equal(req.shortfall, 10);
}

function runAggregateAcrossEndpointsTest() {
  const { state, target, sourceInvA, sourceInvB } = makeTargetAndSources();
  addItem(state, sourceInvA, "reeds", 21);
  addItem(state, sourceInvB, "reeds", 25);

  const requirement = {
    kind: "item",
    itemId: "reeds",
    amount: 5,
    progress: 0,
    consume: true,
    slotId: "materials",
  };
  const process = makeProcess([requirement]);
  const processDef = makeProcessDef([requirement]);

  const result = evaluateProcessRequirementAvailability({
    state,
    target,
    process,
    processDef,
  });

  const req = getFirstRequirement(result);
  assert.equal(req.reachableFromInputs, 5);
  assert.equal(req.accessibleTotal, 46);
}

function runDisabledInvalidExcludedTest() {
  const { state, target, sourceInvA, sourceInvB } = makeTargetAndSources();
  addItem(state, sourceInvA, "reeds", 10);
  addItem(state, sourceInvB, "reeds", 100);

  const requirement = {
    kind: "item",
    itemId: "reeds",
    amount: 20,
    progress: 0,
    consume: true,
    slotId: "materials",
  };
  const process = makeProcess(
    [requirement],
    {
      "inv:hub:sourceA": true,
      "inv:hub:ghost": true,
      "inv:hub:sourceB": false,
    },
    ["inv:hub:sourceA", "inv:hub:ghost", "inv:hub:sourceB"]
  );
  const processDef = makeProcessDef([requirement]);

  const result = evaluateProcessRequirementAvailability({
    state,
    target,
    process,
    processDef,
  });

  const req = getFirstRequirement(result);
  assert.equal(result.canFulfillAll, false);
  assert.equal(req.accessibleTotal, 10);
  assert.equal(req.shortfall, 10);
}

function runConsumeFalseSemanticsTest() {
  const { state, target, sourceInvA } = makeTargetAndSources();
  addItem(state, sourceInvA, "hammer", 1);

  const requirement = {
    kind: "item",
    itemId: "hammer",
    amount: 3,
    progress: 0,
    consume: false,
    slotId: "materials",
  };
  const process = makeProcess([requirement]);
  const processDef = makeProcessDef([requirement]);

  const before = getTotalByKind(sourceInvA, "hammer");
  const result = evaluateProcessRequirementAvailability({
    state,
    target,
    process,
    processDef,
  });

  const req = getFirstRequirement(result);
  assert.equal(result.canFulfillAll, false);
  assert.equal(req.fulfillable, false);
  assert.equal(req.reachableFromInputs, 1);
  assert.equal(req.accessibleTotal, 1);
  assert.equal(getTotalByKind(sourceInvA, "hammer"), before);
}

function runNewRoutingCandidatesDefaultEnabledTest() {
  const { state, target } = makeTargetAndSources();
  const requirement = {
    kind: "item",
    itemId: "reeds",
    amount: 1,
    progress: 0,
    consume: true,
    slotId: "materials",
  };
  const process = makeProcess(
    [requirement],
    {
      "inv:hub:sourceA": true,
    },
    ["inv:hub:sourceA"]
  );
  const processDef = makeProcessDef([requirement]);

  const changed = seedRoutingWithCandidates(state, target, process, processDef, {});
  assert.equal(changed, true, "expected newly valid routing candidates to be appended");
  assert.equal(
    process.routing.inputs.materials.ordered.includes("inv:hub:sourceB"),
    true,
    "new crafting candidates should be appended to routing order"
  );
  assert.equal(
    process.routing.inputs.materials.enabled["inv:hub:sourceB"],
    true,
    "newly appended crafting candidates should default enabled"
  );
}

runFulfillableReachableInputsTest();
runShortageTest();
runAggregateAcrossEndpointsTest();
runDisabledInvalidExcludedTest();
runConsumeFalseSemanticsTest();
runNewRoutingCandidatesDefaultEnabledTest();

console.log("[test] Process requirement availability checks passed");
