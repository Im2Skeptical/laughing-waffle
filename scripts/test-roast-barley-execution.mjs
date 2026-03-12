import assert from "node:assert/strict";

import { Inventory } from "../src/model/inventory-model.js";
import { createEmptyState } from "../src/model/state.js";
import { handleAdvanceWorkProcess } from "../src/model/effects/ops/system/work-process-advance.js";

function createInventory(state) {
  const inv = Inventory.create(8, 8);
  Inventory.init(inv);
  inv.version = 0;
  return inv;
}

function addItem(state, inv, kind, quantity = 1) {
  const item = Inventory.addNewItem(state, inv, { kind, quantity });
  assert.ok(item, `failed to add ${kind} to inventory`);
}

function testRoastBarleyLoadsThenWorks() {
  const state = createEmptyState(123);
  state.tSec = 1;

  const structure = {
    instanceId: 1,
    defId: "hearth",
    col: 0,
    span: 1,
    tags: ["canCook", "canCraft"],
    systemTiers: {},
    systemState: {
      cook: {
        processes: [
          {
            id: "proc_roastBarley",
            type: "roastBarley",
            mode: "work",
            durationSec: 1,
            progress: 0,
            completionPolicy: "repeat",
            ownerId: 101,
          },
        ],
      },
    },
  };
  state.hub.anchors = [structure];

  const pawn = {
    id: 101,
    role: "leader",
    envCol: null,
    hubCol: 0,
    systemTiers: {},
    systemState: { stamina: { cur: 10, max: 100 } },
    equipment: {},
  };
  state.pawns = [pawn];

  const pawnInv = createInventory(state);
  addItem(state, pawnInv, "barley", 1);
  addItem(state, pawnInv, "stone", 1);
  state.ownerInventories[pawn.id] = pawnInv;

  const context = {
    kind: "game",
    state,
    source: structure,
    tSec: 1,
    hubCol: 0,
    pawnId: pawn.id,
    ownerId: pawn.id,
    pawn,
    pawnInv,
  };

  const effect = {
    op: "AdvanceWorkProcess",
    system: "cook",
    queueKey: "processes",
    processType: "roastBarley",
    amount: 1,
  };

  handleAdvanceWorkProcess(state, effect, context);
  let process = structure.systemState.cook.processes[0];
  assert.ok(process, "process should still exist after first loading second");
  assert.equal(
    process.progress,
    0,
    "first second should load materials/tools but not also advance work"
  );
  assert.deepEqual(
    process.requirements.map((req) => req.progress),
    [1, 1],
    "first second should load barley and satisfy the tool requirement instantly"
  );

  handleAdvanceWorkProcess(state, effect, context);
  process = structure.systemState.cook.processes[0];
  assert.ok(process, "repeat recipe should still exist after completing one cycle");
  assert.equal(
    process.progress,
    0,
    "second second should complete the one-second work and reset for repeat"
  );
  assert.deepEqual(
    process.requirements.map((req) => req.progress),
    [0, 0],
    "repeat recipe should reset requirements after completing one cycle"
  );
}

testRoastBarleyLoadsThenWorks();
console.log("test-roast-barley-execution: ok");
