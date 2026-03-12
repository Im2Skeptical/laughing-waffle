import assert from "node:assert/strict";

import { getEnvTagExecutionPreview, getHubTagExecutionPreview } from "../src/model/tag-execution-preview.js";
import { createEmptyState } from "../src/model/state.js";
import { Inventory } from "../src/model/inventory-model.js";

function createInventory() {
  const inv = Inventory.create(8, 8);
  Inventory.init(inv);
  inv.version = 0;
  return inv;
}

function testEnvFarmFallbackPreview() {
  const state = createEmptyState(12345);
  state.tSec = 1;
  state.seasons = ["winter"];
  state.currentSeasonIndex = 0;

  const tile = {
    instanceId: 1,
    defId: "grassland",
    col: 0,
    span: 1,
    tags: ["farmable", "forageable"],
    systemTiers: {},
    systemState: {
      growth: {
        selectedCropId: "barley",
        recipePriority: {
          ordered: ["barley"],
          enabled: { barley: true },
        },
        maturedPool: { bronze: 0, silver: 0, gold: 0, diamond: 0 },
        processes: [],
      },
    },
  };
  state.board.cols = 1;
  state.board.layers.tile.anchors = [tile];
  state.board.occ.tile = [tile];

  const pawn = {
    id: 101,
    role: "leader",
    envCol: 0,
    hubCol: null,
    systemTiers: {},
    systemState: { stamina: { cur: 10, max: 100 } },
    equipment: {},
  };
  state.pawns = [pawn];
  state.ownerInventories[pawn.id] = createInventory();

  const preview = getEnvTagExecutionPreview({
    state,
    tile,
    tags: ["farmable", "forageable"],
    isTagDisabled: () => false,
    isTagUnlocked: () => true,
  });

  assert.equal(preview.firstActiveTagId, "forageable");
  assert.equal(preview.statusById.farmable.skipped, true);
  assert.equal(preview.statusById.farmable.skipReason, "requirements");
  assert.equal(preview.statusById.forageable.active, true);
}

function testHubRecipeSkippedWithoutSelection() {
  const state = createEmptyState(6789);
  state.tSec = 1;

  const structure = {
    instanceId: 2,
    defId: "cookfire",
    col: 0,
    span: 1,
    tags: ["canCook"],
    systemTiers: {},
    systemState: {
      cook: {
        selectedRecipeId: null,
        recipePriority: { ordered: [], enabled: {} },
        processes: [],
      },
    },
  };
  state.hub.anchors = [structure];

  const pawn = {
    id: 202,
    role: "leader",
    envCol: null,
    hubCol: 0,
    systemTiers: {},
    systemState: { stamina: { cur: 10, max: 100 } },
    equipment: {},
  };
  state.pawns = [pawn];
  state.ownerInventories[pawn.id] = createInventory();

  const preview = getHubTagExecutionPreview({
    state,
    structure,
    tags: ["canCook"],
    isTagDisabled: () => false,
    isTagUnlocked: () => true,
  });

  assert.equal(preview.statusById.canCook.skipped, true);
  assert.equal(preview.statusById.canCook.skipReason, "requirements");
  assert.equal(preview.firstActiveTagId, null);
  assert.equal(preview.firstSkippedTagId, "canCook");
}

function testHubPassiveBuildPreview() {
  const state = createEmptyState(2468);
  state.tSec = 1;

  const structure = {
    instanceId: 3,
    defId: "hut",
    col: 0,
    span: 1,
    tags: ["build"],
    systemTiers: {},
    systemState: {
      build: {
        processes: [
          {
            id: "proc_build",
            type: "build",
            mode: "work",
            durationSec: 5,
            progress: 2,
          },
        ],
      },
    },
  };
  state.hub.anchors = [structure];

  const pawn = {
    id: 303,
    role: "leader",
    envCol: null,
    hubCol: 0,
    systemTiers: {},
    systemState: { stamina: { cur: 10, max: 100 } },
    equipment: {},
  };
  state.pawns = [pawn];
  state.ownerInventories[pawn.id] = createInventory();

  const preview = getHubTagExecutionPreview({
    state,
    structure,
    tags: ["build"],
    isTagDisabled: () => false,
    isTagUnlocked: () => true,
  });

  assert.equal(preview.statusById.build.passiveActive, true);
  assert.equal(preview.firstActiveTagId, "build");
}

testEnvFarmFallbackPreview();
testHubRecipeSkippedWithoutSelection();
testHubPassiveBuildPreview();

console.log("test-tag-execution-preview: ok");
