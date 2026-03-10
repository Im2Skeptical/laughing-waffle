import assert from "node:assert/strict";

import { LEADER_EQUIPMENT_SLOT_ORDER } from "../src/defs/gamesystems/equipment-slot-defs.js";
import { Inventory } from "../src/model/inventory-model.js";
import {
  cmdMoveLeaderEquipmentToInventory,
  cmdMoveProcessDropboxItem,
} from "../src/model/commands/inventory-commands.js";
import { evaluateProcessDropboxDragStatus } from "../src/model/commands/process-dropbox-logic.js";

function makeState() {
  return {
    nextItemId: 1,
    tSec: 0,
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

function addItem(state, inv, kind, quantity, overrides = {}) {
  const item = Inventory.addNewItem(state, inv, {
    kind,
    quantity,
    width: overrides.width ?? 1,
    height: overrides.height ?? 1,
    tier: overrides.tier ?? "bronze",
    seasonsToExpire: overrides.seasonsToExpire ?? null,
    tags: overrides.tags ?? [],
    systemTiers: overrides.systemTiers ?? {},
    systemState: overrides.systemState ?? {},
  });
  assert.ok(item, `failed to add item ${kind}`);
  return item;
}

function getItemById(inv, itemId) {
  return inv.itemsById?.[itemId] || inv.items?.find((it) => it.id === itemId) || null;
}

function getKindTotal(inv, kind) {
  let total = 0;
  for (const item of inv.items || []) {
    if (!item || item.kind !== kind) continue;
    total += Math.max(0, Math.floor(item.quantity ?? 0));
  }
  return total;
}

function getProcessRequirementProgress(process, itemId) {
  const reqs = Array.isArray(process?.requirements) ? process.requirements : [];
  let total = 0;
  for (const req of reqs) {
    if (!req || req.kind !== "item") continue;
    if (req.itemId !== itemId) continue;
    total += Math.max(0, Math.floor(req.progress ?? 0));
  }
  return total;
}

function addProcessHost(
  state,
  {
    structureId,
    defId = "hearth",
    systemId = "cook",
    process,
    processes,
    selectedRecipeId,
    recipePriority,
  }
) {
  const processList = Array.isArray(processes)
    ? processes.filter((entry) => entry && typeof entry === "object")
    : process && typeof process === "object"
      ? [process]
      : [];
  const systemState = {
    processes: processList,
  };
  if (selectedRecipeId !== undefined) {
    systemState.selectedRecipeId = selectedRecipeId;
  }
  if (recipePriority !== undefined) {
    systemState.recipePriority = recipePriority;
  }
  const host = {
    instanceId: structureId,
    defId,
    col: 0,
    systemState: {
      [systemId]: systemState,
    },
  };
  state.hub.anchors.push(host);
  return host;
}

function runProcessRequirementCapPartialTest() {
  const state = makeState();
  const fromOwnerId = 101;
  const processId = "proc-cap-partial";
  const dropboxOwnerId = `inv:dropbox:process:${processId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const reeds = addItem(state, fromInv, "reeds", 5);

  addProcessHost(state, {
    structureId: 501,
    systemId: "build",
    process: {
      id: processId,
      type: "build",
      requirements: [
        { kind: "item", itemId: "reeds", amount: 1, progress: 0, consume: true },
      ],
    },
  });

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: dropboxOwnerId,
    itemId: reeds.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, true, `expected success, got ${JSON.stringify(res)}`);
  assert.equal(res?.result, "dropboxLoaded");
  assert.equal(res?.moved, 1);
  assert.equal(res?.partial, true);
  assert.equal(getItemById(fromInv, reeds.id)?.quantity ?? 0, 4);
  const process = state.hub.anchors[0].systemState.build.processes[0];
  assert.equal(getProcessRequirementProgress(process, "reeds"), 1);
  assert.equal(state.ownerInventories[dropboxOwnerId], undefined);
}

function runPriorityOrderDistributionTest() {
  const state = makeState();
  const fromOwnerId = 108;
  const firstProcessId = "proc-priority-first";
  const secondProcessId = "proc-priority-second";
  const dropboxOwnerId = `inv:dropbox:process:${secondProcessId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const reeds = addItem(state, fromInv, "reeds", 5);

  addProcessHost(state, {
    structureId: 910,
    systemId: "craft",
    selectedRecipeId: "weaveBasket",
    recipePriority: {
      ordered: ["weaveBasket", "craftProphecyPopulationScroll"],
      enabled: {
        weaveBasket: true,
        craftProphecyPopulationScroll: true,
      },
    },
    processes: [
      {
        id: firstProcessId,
        type: "weaveBasket",
        mode: "work",
        durationSec: 5,
        progress: 0,
        requirements: [
          { kind: "item", itemId: "reeds", amount: 3, progress: 0, consume: true },
        ],
      },
      {
        id: secondProcessId,
        type: "craftProphecyPopulationScroll",
        mode: "work",
        durationSec: 5,
        progress: 0,
        requirements: [
          { kind: "item", itemId: "reeds", amount: 1, progress: 0, consume: true },
        ],
      },
    ],
  });

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: dropboxOwnerId,
    itemId: reeds.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, true, `expected priority distribution success, got ${JSON.stringify(res)}`);
  assert.equal(res?.moved, 4);
  assert.equal(res?.partial, true);
  assert.equal(getItemById(fromInv, reeds.id)?.quantity ?? 0, 1);
  const processes = state.hub.anchors[0].systemState.craft.processes;
  assert.equal(getProcessRequirementProgress(processes[0], "reeds"), 3);
  assert.equal(getProcessRequirementProgress(processes[1], "reeds"), 1);
}

function runNonRequiredRejectionTest() {
  const state = makeState();
  const fromOwnerId = 102;
  const processId = "proc-reject";
  const dropboxOwnerId = `inv:dropbox:process:${processId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const stone = addItem(state, fromInv, "stone", 3);

  addProcessHost(state, {
    structureId: 502,
    systemId: "build",
    process: {
      id: processId,
      type: "build",
      requirements: [
        { kind: "item", itemId: "reeds", amount: 1, progress: 0, consume: true },
      ],
    },
  });

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: dropboxOwnerId,
    itemId: stone.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, false, "non-required item should be rejected");
  assert.equal(res?.reason, "dropboxItemNotRequired");
  assert.equal(getItemById(fromInv, stone.id)?.quantity ?? 0, 3);
  assert.equal(state.ownerInventories[dropboxOwnerId], undefined);
}

function runExistingProgressCapTest() {
  const state = makeState();
  const fromOwnerId = 103;
  const processId = "proc-existing-progress-cap";
  const dropboxOwnerId = `inv:dropbox:process:${processId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const reeds = addItem(state, fromInv, "reeds", 5);

  addProcessHost(state, {
    structureId: 503,
    systemId: "build",
    process: {
      id: processId,
      type: "build",
      requirements: [
        { kind: "item", itemId: "reeds", amount: 2, progress: 1, consume: true },
      ],
    },
  });

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: dropboxOwnerId,
    itemId: reeds.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, true, `expected success, got ${JSON.stringify(res)}`);
  assert.equal(res?.moved, 1);
  assert.equal(getItemById(fromInv, reeds.id)?.quantity ?? 0, 4);
  const process = state.hub.anchors[0].systemState.build.processes[0];
  assert.equal(getProcessRequirementProgress(process, "reeds"), 2);
  assert.equal(state.ownerInventories[dropboxOwnerId], undefined);
}

function runProcessDefFallbackCapTest() {
  const state = makeState();
  const fromOwnerId = 106;
  const processId = "proc-fallback-cap";
  const dropboxOwnerId = `inv:dropbox:process:${processId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const reeds = addItem(state, fromInv, "reeds", 5);

  addProcessHost(state, {
    structureId: 504,
    selectedRecipeId: "weaveBasket",
    process: {
      id: processId,
      type: "weaveBasket",
      mode: "work",
      durationSec: 5,
      progress: 0,
      // intentionally omit runtime requirements to force processDef fallback
    },
  });

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: dropboxOwnerId,
    itemId: reeds.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, true, `expected fallback success, got ${JSON.stringify(res)}`);
  assert.equal(res?.moved, 3);
  assert.equal(getItemById(fromInv, reeds.id)?.quantity ?? 0, 2);
  const process = state.hub.anchors[0].systemState.cook.processes[0];
  assert.equal(getProcessRequirementProgress(process, "reeds"), 3);
  assert.equal(state.ownerInventories[dropboxOwnerId], undefined);
}

function runPreviewDropboxOwnerRejectedTest() {
  const state = makeState();
  const fromOwnerId = 107;
  const structureId = 505;
  const previewOwnerId = "inv:dropbox:process:preview:craft:hub:505:weaveBasket";

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const reeds = addItem(state, fromInv, "reeds", 5);

  const host = addProcessHost(state, {
    structureId,
    systemId: "craft",
    selectedRecipeId: "weaveBasket",
    process: {
      id: "placeholder",
      type: "otherRecipe",
      requirements: [],
    },
  });
  host.systemState.craft.processes = [];

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: previewOwnerId,
    itemId: reeds.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, false, "preview dropbox owner should be rejected");
  assert.equal(res?.reason, "dropboxNoProcess");
  assert.equal(getItemById(fromInv, reeds.id)?.quantity ?? 0, 5);
  assert.equal(host.systemState.craft.processes.length, 0);
}

function runHubInstantDropboxTest() {
  const state = makeState();
  const fromOwnerId = 104;
  const hubOwnerId = 701;
  const hubDropboxOwnerId = `inv:dropbox:hub:${hubOwnerId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const barley = addItem(state, fromInv, "barley", 2);

  state.hub.anchors.push({
    instanceId: hubOwnerId,
    defId: "granary",
    col: 0,
    tags: ["communal"],
    disabledTags: [],
    systemState: { granaryStore: { byKindTier: {}, totalByTier: {} } },
  });

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: hubDropboxOwnerId,
    itemId: barley.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, true, `expected instant dropbox success, got ${JSON.stringify(res)}`);
  assert.equal(res?.result, "instantDropboxLoaded");
  assert.equal(res?.moved, 2);
  assert.equal(getItemById(fromInv, barley.id), null);
}

function runDepositProcessInstantDropboxTest() {
  const state = makeState();
  const fromOwnerId = 105;
  const processId = "proc-deposit-instant";
  const processDropboxOwnerId = `inv:dropbox:process:${processId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const barley = addItem(state, fromInv, "barley", 1);

  addProcessHost(state, {
    structureId: 702,
    defId: "granary",
    systemId: "deposit",
    process: {
      id: processId,
      type: "depositItems",
      requirements: [],
    },
  });

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: processDropboxOwnerId,
    itemId: barley.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, true, `expected process instant dropbox success, got ${JSON.stringify(res)}`);
  assert.equal(res?.result, "instantDropboxLoaded");
  assert.equal(res?.processId, processId);
  assert.equal(getItemById(fromInv, barley.id), null);
}

function runEquippedCapGateTest() {
  const state = makeState();
  const leaderId = 9001;
  const processId = "proc-equip-cap";
  const dropboxOwnerId = `inv:dropbox:process:${processId}`;
  const slotId = LEADER_EQUIPMENT_SLOT_ORDER[0];

  assert.ok(slotId, "missing leader equipment slot defs");

  state.pawns.push({
    id: leaderId,
    role: "leader",
    equipment: {
      [slotId]: {
        id: 777777,
        kind: "reeds",
        width: 1,
        height: 1,
        quantity: 2,
        tier: "bronze",
        tags: [],
        systemTiers: {},
        systemState: {},
      },
    },
  });

  addProcessHost(state, {
    structureId: 703,
    systemId: "build",
    process: {
      id: processId,
      type: "build",
      requirements: [
        { kind: "item", itemId: "reeds", amount: 1, progress: 0, consume: true },
      ],
    },
  });

  const res = cmdMoveLeaderEquipmentToInventory(state, {
    fromOwnerId: leaderId,
    toOwnerId: dropboxOwnerId,
    slotId,
    targetGX: 0,
    targetGY: 0,
  });

  assert.equal(res?.ok, false, "equipped transfer should be blocked by dropbox cap");
  assert.equal(res?.reason, "dropboxRequirementCapReached");
  const leader = state.pawns.find((pawn) => pawn.id === leaderId);
  assert.ok(leader?.equipment?.[slotId], "equipped item should remain in slot on reject");
  assert.equal(state.ownerInventories[dropboxOwnerId], undefined);
}

function runDragStatusEvaluatorTest() {
  const state = makeState();
  const processId = "proc-drag-status";
  const ownerId = `inv:dropbox:process:${processId}`;

  addProcessHost(state, {
    structureId: 901,
    systemId: "craft",
    selectedRecipeId: "weaveBasket",
    process: {
      id: processId,
      type: "weaveBasket",
      mode: "work",
      durationSec: 5,
      progress: 0,
    },
  });

  const valid = evaluateProcessDropboxDragStatus(state, {
    toOwnerId: ownerId,
    itemKind: "reeds",
    quantity: 2,
  });
  assert.equal(valid?.status, "valid");

  const invalid = evaluateProcessDropboxDragStatus(state, {
    toOwnerId: ownerId,
    itemKind: "stone",
    quantity: 1,
  });
  assert.equal(invalid?.status, "invalid");
  assert.equal(invalid?.reason, "dropboxItemNotRequired");

  const process = state.hub.anchors[0].systemState.craft.processes[0];
  process.requirements = [{ kind: "item", itemId: "reeds", amount: 3, progress: 3, consume: true }];
  const capped = evaluateProcessDropboxDragStatus(state, {
    toOwnerId: ownerId,
    itemKind: "reeds",
    quantity: 1,
  });
  assert.equal(capped?.status, "capped");
  assert.equal(capped?.reason, "dropboxRequirementCapReached");
}

function runNoRecipeSelectedStatusTest() {
  const state = makeState();
  const processId = "proc-no-recipe";
  const ownerId = `inv:dropbox:process:${processId}`;
  addProcessHost(state, {
    structureId: 902,
    systemId: "craft",
    selectedRecipeId: null,
    process: {
      id: processId,
      type: "weaveBasket",
      mode: "work",
      durationSec: 5,
      progress: 0,
    },
  });

  const status = evaluateProcessDropboxDragStatus(state, {
    toOwnerId: ownerId,
    itemKind: "reeds",
    quantity: 1,
  });
  assert.equal(status?.status, "invalid");
  assert.equal(status?.reason, "dropboxNoRecipeSelected");
}

runProcessRequirementCapPartialTest();
runNonRequiredRejectionTest();
runExistingProgressCapTest();
runProcessDefFallbackCapTest();
runPreviewDropboxOwnerRejectedTest();
runHubInstantDropboxTest();
runDepositProcessInstantDropboxTest();
runEquippedCapGateTest();
runDragStatusEvaluatorTest();
runPriorityOrderDistributionTest();
runNoRecipeSelectedStatusTest();

console.log("[test] Process dropbox command checks passed");
