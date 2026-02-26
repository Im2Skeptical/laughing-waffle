import assert from "node:assert/strict";

import { LEADER_EQUIPMENT_SLOT_ORDER } from "../src/defs/gamesystems/equipment-slot-defs.js";
import { Inventory } from "../src/model/inventory-model.js";
import {
  cmdMoveLeaderEquipmentToInventory,
  cmdMoveProcessDropboxItem,
} from "../src/model/commands/inventory-commands.js";

function makeState() {
  return {
    nextItemId: 1,
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

function addProcessHost(state, { structureId, defId = "hearth", systemId = "fireplace", process }) {
  const host = {
    instanceId: structureId,
    defId,
    col: 0,
    systemState: {
      [systemId]: {
        processes: [process],
      },
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
  const dropboxInv = ensureInventory(state, dropboxOwnerId, 8, 8);
  const fish = addItem(state, fromInv, "reeds", 5);

  addProcessHost(state, {
    structureId: 501,
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
    itemId: fish.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, true, `expected success, got ${JSON.stringify(res)}`);
  assert.equal(res?.result, "dropboxLoaded");
  assert.equal(res?.moved, 1);
  assert.equal(res?.partial, true);
  assert.equal(getItemById(fromInv, fish.id)?.quantity ?? 0, 4);
  const process = state.hub.anchors[0].systemState.fireplace.processes[0];
  assert.equal(getProcessRequirementProgress(process, "reeds"), 1);
  assert.equal(getKindTotal(dropboxInv, "reeds"), 0);
}

function runNonRequiredRejectionTest() {
  const state = makeState();
  const fromOwnerId = 102;
  const processId = "proc-reject";
  const dropboxOwnerId = `inv:dropbox:process:${processId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const dropboxInv = ensureInventory(state, dropboxOwnerId, 8, 8);
  const stone = addItem(state, fromInv, "stone", 3);

  addProcessHost(state, {
    structureId: 502,
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
  assert.equal(res?.reason, "dropboxRequirementCapReached");
  assert.equal(getItemById(fromInv, stone.id)?.quantity ?? 0, 3);
  assert.equal(getKindTotal(dropboxInv, "stone"), 0);
}

function runBufferedCapTest() {
  const state = makeState();
  const fromOwnerId = 103;
  const processId = "proc-buffered-cap";
  const dropboxOwnerId = `inv:dropbox:process:${processId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const dropboxInv = ensureInventory(state, dropboxOwnerId, 8, 8);
  const fish = addItem(state, fromInv, "reeds", 5);
  addItem(state, dropboxInv, "reeds", 1);

  addProcessHost(state, {
    structureId: 503,
    process: {
      id: processId,
      type: "build",
      requirements: [
        { kind: "item", itemId: "reeds", amount: 2, progress: 0, consume: true },
      ],
    },
  });

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: dropboxOwnerId,
    itemId: fish.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, true, `expected success, got ${JSON.stringify(res)}`);
  assert.equal(res?.moved, 1);
  assert.equal(getItemById(fromInv, fish.id)?.quantity ?? 0, 4);
  const process = state.hub.anchors[0].systemState.fireplace.processes[0];
  assert.equal(getProcessRequirementProgress(process, "reeds"), 2);
  assert.equal(getKindTotal(dropboxInv, "reeds"), 0);
}

function runProcessDefFallbackCapTest() {
  const state = makeState();
  const fromOwnerId = 106;
  const processId = "proc-fallback-cap";
  const dropboxOwnerId = `inv:dropbox:process:${processId}`;

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const dropboxInv = ensureInventory(state, dropboxOwnerId, 8, 8);
  const reeds = addItem(state, fromInv, "reeds", 5);

  addProcessHost(state, {
    structureId: 504,
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
  const process = state.hub.anchors[0].systemState.fireplace.processes[0];
  assert.equal(getProcessRequirementProgress(process, "reeds"), 3);
  assert.equal(getKindTotal(dropboxInv, "reeds"), 0);
}

function runPreviewDropboxOwnerFallbackTest() {
  const state = makeState();
  const fromOwnerId = 107;
  const structureId = 505;
  const previewOwnerId = "inv:dropbox:process:preview:workspace:hub:505:weaveBasket";

  const fromInv = ensureInventory(state, fromOwnerId, 6, 6);
  const reeds = addItem(state, fromInv, "reeds", 5);

  const host = addProcessHost(state, {
    structureId,
    systemId: "workspace",
    process: {
      id: "placeholder",
      type: "otherRecipe",
      requirements: [],
    },
  });
  host.systemState.workspace.selectedRecipeId = "weaveBasket";
  host.systemState.workspace.processes = [];

  const res = cmdMoveProcessDropboxItem(state, {
    fromOwnerId,
    toOwnerId: previewOwnerId,
    itemId: reeds.id,
    targetGX: 0,
    targetGY: 0,
    viaProcessDropbox: true,
  });

  assert.equal(res?.ok, true, `expected preview-owner fallback success, got ${JSON.stringify(res)}`);
  assert.equal(res?.moved, 3);
  assert.equal(getItemById(fromInv, reeds.id)?.quantity ?? 0, 2);

  const process = host.systemState.workspace.processes.find((p) => p.type === "weaveBasket");
  assert.ok(process, "expected weaveBasket process to be materialized from preview dropbox owner");
  const realOwnerId = `inv:dropbox:process:${process.id}`;
  const realInv = state.ownerInventories?.[realOwnerId];
  assert.ok(realInv, "expected real process dropbox inventory to exist");
  assert.equal(getProcessRequirementProgress(process, "reeds"), 3);
  assert.equal(getKindTotal(realInv, "reeds"), 0);
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

  ensureInventory(state, dropboxOwnerId, 8, 8);
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
}

runProcessRequirementCapPartialTest();
runNonRequiredRejectionTest();
runBufferedCapTest();
runProcessDefFallbackCapTest();
runPreviewDropboxOwnerFallbackTest();
runHubInstantDropboxTest();
runDepositProcessInstantDropboxTest();
runEquippedCapGateTest();

console.log("[test] Process dropbox command checks passed");
