import assert from "node:assert/strict";

import { ActionKinds } from "../src/model/actions.js";
import {
  makeHubRecipeSelectIntent,
  makeHubTagOrderIntent,
  makeHubTagToggleIntent,
  makeItemTransferIntent,
  makePawnMoveIntent,
  makeTileCropSelectIntent,
  makeTileTagOrderIntent,
  makeTileTagToggleIntent,
} from "../src/controllers/actionmanagers/action-intents.js";
import {
  buildLiveActionPreviewState,
  buildPlannerPreviewState,
} from "../src/controllers/actionmanagers/action-preview-state.js";
import { createLiveActionOptimism } from "../src/views/ui-root/live-action-optimism.js";

function makeMinimalPreviewState() {
  const itemA = {
    id: 101,
    kind: "wood",
    quantity: 1,
    width: 1,
    height: 1,
    gridX: 0,
    gridY: 0,
  };
  const itemB = {
    id: 202,
    kind: "stone",
    quantity: 1,
    width: 1,
    height: 1,
    gridX: 1,
    gridY: 0,
  };
  return {
    tSec: 0,
    variantFlags: {},
    ownerInventories: {
      1: {
        items: [itemA],
        itemsById: { 101: itemA },
      },
      2: {
        items: [itemB],
        itemsById: { 202: itemB },
      },
    },
    pawns: [{ id: 7, envCol: 0 }],
    board: {
      occ: {
        tile: [
          {
            col: 0,
            tags: ["farmable", "forage"],
            tagStates: {
              farmable: { disabled: false },
              forage: { disabled: false },
            },
            systemState: {
              growth: {
                selectedCropId: "wheat",
                recipePriority: {
                  ordered: ["wheat"],
                  enabled: { wheat: true },
                },
              },
            },
          },
        ],
      },
    },
    hub: {
      occ: [
        {
          col: 0,
          defId: "workbench",
          tags: ["canCraft", "deposit"],
          tagStates: {
            canCraft: { disabled: false },
            deposit: { disabled: false },
          },
          systemState: {
            workspace: {
              selectedRecipeId: "weaveBasket",
              recipePriority: {
                ordered: ["weaveBasket"],
                enabled: { weaveBasket: true },
              },
            },
          },
        },
      ],
      slots: [],
    },
  };
}

function runPlannerPreviewReducerChecks() {
  const state = makeMinimalPreviewState();
  state.hub.slots = [{ structure: state.hub.occ[0] }];

  const currentIntents = new Map();
  currentIntents.set(
    "item:101",
    makeItemTransferIntent({
      id: "item:101",
      subjectKey: "item:101",
      itemId: 101,
      item: { id: 101, kind: "wood", quantity: 1, width: 1, height: 1 },
      fromOwnerId: 1,
      toOwnerId: 2,
      fromPlacement: { ownerId: 1, gx: 0, gy: 0 },
      toPlacement: { ownerId: 2, gx: 2, gy: 0 },
    })
  );
  currentIntents.set(
    "pawn:7",
    makePawnMoveIntent({
      id: "pawn:7",
      subjectKey: "pawn:7",
      pawnId: 7,
      fromPlacement: { envCol: 0 },
      toPlacement: { hubCol: 0 },
    })
  );
  currentIntents.set(
    "tileTags:0",
    makeTileTagOrderIntent({
      id: "tileTags:0",
      subjectKey: "tileTags:0",
      envCol: 0,
      tagIds: ["forage", "farmable"],
    })
  );
  currentIntents.set(
    "tileTagToggle:0:forage",
    makeTileTagToggleIntent({
      id: "tileTagToggle:0:forage",
      subjectKey: "tileTagToggle:0:forage",
      envCol: 0,
      tagId: "forage",
      disabled: true,
    })
  );
  currentIntents.set(
    "tileCrop:0",
    makeTileCropSelectIntent({
      id: "tileCrop:0",
      subjectKey: "tileCrop:0",
      envCol: 0,
      recipePriority: { ordered: [], enabled: {} },
    })
  );
  currentIntents.set(
    "hubTags:0",
    makeHubTagOrderIntent({
      id: "hubTags:0",
      subjectKey: "hubTags:0",
      hubCol: 0,
      tagIds: ["deposit", "canCraft"],
    })
  );
  currentIntents.set(
    "hubTagToggle:0:deposit",
    makeHubTagToggleIntent({
      id: "hubTagToggle:0:deposit",
      subjectKey: "hubTagToggle:0:deposit",
      hubCol: 0,
      tagId: "deposit",
      disabled: true,
    })
  );
  currentIntents.set(
    "hubRecipe:0:workspace",
    makeHubRecipeSelectIntent({
      id: "hubRecipe:0:workspace",
      subjectKey: "hubRecipe:0:workspace",
      hubCol: 0,
      systemId: "workspace",
      recipePriority: { ordered: [], enabled: {} },
      baselineRecipePriority: {
        ordered: ["weaveBasket"],
        enabled: { weaveBasket: true },
      },
    })
  );

  const preview = buildPlannerPreviewState({
    state,
    baselineIntents: new Map(),
    currentIntents,
    inventoryTransferGhostPreviewEnabled: true,
  });

  const ownerOne = preview.previewByOwner.get(1);
  assert.ok(ownerOne?.hiddenItemIds?.has(101), "planner preview should hide moved item");
  assert.equal(
    preview.pawnOverrides.get(7)?.hubCol ?? null,
    0,
    "planner preview should override pawn placement"
  );
  assert.deepEqual(
    preview.tilePlanByEnvCol.get(0)?.tagIds ?? [],
    ["forage", "farmable"],
    "planner tile preview should expose reordered tags"
  );
  assert.equal(
    preview.tilePlanByEnvCol.get(0)?.tagDisabledById?.forage,
    true,
    "planner tile preview should expose tag toggle state"
  );
  assert.equal(
    preview.tilePlanByEnvCol.get(0)?.cropId,
    null,
    "planner tile preview should expose crop selection"
  );
  assert.deepEqual(
    preview.hubPlanByHubCol.get(0)?.tagIds ?? [],
    ["deposit", "canCraft"],
    "planner hub preview should expose reordered tags"
  );
  assert.equal(
    preview.hubPlanByHubCol.get(0)?.tagDisabledById?.deposit,
    true,
    "planner hub preview should expose tag toggle state"
  );
  assert.equal(
    preview.hubPlanByHubCol.get(0)?.recipeIdBySystemId?.workspace,
    null,
    "planner hub preview should expose recipe selection"
  );
}

function getFirstInventoryItem(state) {
  const inventories =
    state?.ownerInventories && typeof state.ownerInventories === "object"
      ? state.ownerInventories
      : {};
  for (const [ownerIdRaw, inv] of Object.entries(inventories)) {
    const item = Array.isArray(inv?.items) ? inv.items.find(Boolean) : null;
    if (!item) continue;
    const ownerIdNum = Number(ownerIdRaw);
    return {
      ownerId: Number.isFinite(ownerIdNum) ? ownerIdNum : ownerIdRaw,
      itemId: item.id,
      gridX: item.gridX,
      gridY: item.gridY,
    };
  }
  return null;
}

function getFirstPawnTarget(state) {
  const pawn = Array.isArray(state?.pawns) ? state.pawns.find(Boolean) : null;
  if (!pawn) return null;
  return {
    pawnId: pawn.id,
    currentPlacement: Number.isFinite(pawn.envCol)
      ? { envCol: Math.floor(pawn.envCol) }
      : { hubCol: Math.floor(pawn.hubCol ?? 0) },
  };
}

function getFirstTileTagTarget(state) {
  const tiles = state?.board?.occ?.tile || [];
  for (const tile of tiles) {
    const tagId = Array.isArray(tile?.tags) ? tile.tags[0] : null;
    if (!tagId) continue;
    return {
      envCol: Math.floor(tile.col ?? 0),
      tagId,
      disabled: tile?.tagStates?.[tagId]?.disabled === true,
    };
  }
  return null;
}

function getFirstHubRecipeTarget(state) {
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    const structure = slot?.structure;
    if (!structure) continue;
    if (structure?.systemState?.workspace) {
      return {
        hubCol: Math.floor(structure.col ?? 0),
        systemId: "workspace",
      };
    }
    if (structure?.systemState?.fireplace) {
      return {
        hubCol: Math.floor(structure.col ?? 0),
        systemId: "fireplace",
      };
    }
  }
  return null;
}

function getFirstHubTagTarget(state) {
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    const structure = slot?.structure;
    const tagId = Array.isArray(structure?.tags) ? structure.tags[0] : null;
    if (!structure || !tagId) continue;
    return {
      hubCol: Math.floor(structure.col ?? 0),
      tagId,
      disabled: structure?.tagStates?.[tagId]?.disabled === true,
    };
  }
  return null;
}

function runLiveActionOptimismChecks() {
  const baseState = makeMinimalPreviewState();
  baseState.hub.slots = [{ structure: baseState.hub.occ[0] }];
  baseState.variantFlags.inventoryTransferGhostPreviewEnabled = false;
  const itemTarget = getFirstInventoryItem(baseState);
  const pawnTarget = getFirstPawnTarget(baseState);
  const tileTarget = getFirstTileTagTarget(baseState);
  const hubRecipeTarget = getFirstHubRecipeTarget(baseState);
  const hubTagTarget = getFirstHubTagTarget(baseState);

  assert.ok(itemTarget, "expected an inventory item for optimism test");
  assert.ok(pawnTarget, "expected a pawn for optimism test");
  assert.ok(tileTarget, "expected a tile tag target for optimism test");
  assert.ok(hubRecipeTarget, "expected a hub recipe target for optimism test");
  assert.ok(hubTagTarget, "expected a hub tag target for optimism test");

  const liveState = { ...baseState, tSec: 0 };
  let enabled = true;
  let timeline = { actions: [] };

  const optimism = createLiveActionOptimism({
    getState: () => liveState,
    getTimeline: () => timeline,
    getOwnerLabel: (ownerId) => `Owner ${ownerId}`,
    isOptimismEnabled: () => enabled,
  });

  const scheduledActions = [
    {
      kind: ActionKinds.INVENTORY_MOVE,
      payload: {
        fromOwnerId: itemTarget.ownerId,
        toOwnerId: itemTarget.ownerId,
        itemId: itemTarget.itemId,
        fromPlacement: {
          ownerId: itemTarget.ownerId,
          gx: itemTarget.gridX,
          gy: itemTarget.gridY,
        },
        toPlacement: {
          ownerId: itemTarget.ownerId,
          gx: itemTarget.gridX + 1,
          gy: itemTarget.gridY,
        },
      },
      apCost: 0,
      tSec: 1,
    },
    {
      kind: ActionKinds.PLACE_PAWN,
      payload: {
        pawnId: pawnTarget.pawnId,
        fromPlacement: pawnTarget.currentPlacement,
        toPlacement: { hubCol: 0 },
      },
      apCost: 0,
      tSec: 1,
    },
    {
      kind: ActionKinds.TOGGLE_TILE_TAG,
      payload: {
        envCol: tileTarget.envCol,
        tagId: tileTarget.tagId,
        disabled: !tileTarget.disabled,
      },
      apCost: 0,
      tSec: 1,
    },
    {
      kind: ActionKinds.SET_TILE_CROP_SELECTION,
      payload: {
        envCol: tileTarget.envCol,
        recipePriority: { ordered: [], enabled: {} },
      },
      apCost: 0,
      tSec: 1,
    },
    {
      kind: ActionKinds.TOGGLE_HUB_TAG,
      payload: {
        hubCol: hubTagTarget.hubCol,
        tagId: hubTagTarget.tagId,
        disabled: !hubTagTarget.disabled,
      },
      apCost: 0,
      tSec: 1,
    },
    {
      kind: ActionKinds.SET_HUB_RECIPE_SELECTION,
      payload: {
        hubCol: hubRecipeTarget.hubCol,
        systemId: hubRecipeTarget.systemId,
        recipePriority: { ordered: [], enabled: {} },
      },
      apCost: 0,
      tSec: 1,
    },
  ];
  timeline = { actions: scheduledActions.slice() };

  const recordResult = optimism.recordScheduledBatch({
    ok: true,
    scheduled: true,
    tSec: 1,
    actions: scheduledActions,
  });
  assert.equal(recordResult?.scheduled, true, "optimism should accept scheduled batches");
  assert.ok(optimism.getVersion() > 0, "optimism version should bump after scheduling");

  const inventoryPreview = optimism.getInventoryPreview(itemTarget.ownerId);
  assert.ok(
    inventoryPreview.hiddenItemIds.has(itemTarget.itemId),
    "optimism should hide moved inventory items immediately even when planner ghost previews are disabled"
  );
  assert.equal(
    inventoryPreview.overlayItems[0]?.gridX ?? null,
    itemTarget.gridX + 1,
    "optimism should show inventory overlay at final projected cell"
  );
  assert.equal(
    optimism.getPawnOverridePlacement(pawnTarget.pawnId)?.hubCol ?? null,
    0,
    "optimism should project pawn moves immediately"
  );
  assert.equal(
    optimism.getTilePlanPreview(tileTarget.envCol)?.tagDisabledById?.[tileTarget.tagId],
    !tileTarget.disabled,
    "optimism should project tile tag toggles immediately"
  );
  assert.equal(
    optimism.getTilePlanPreview(tileTarget.envCol)?.cropId,
    null,
    "optimism should project tile crop changes immediately"
  );
  assert.equal(
    optimism.getHubPlanPreview(hubRecipeTarget.hubCol)?.recipeIdBySystemId?.[
      hubRecipeTarget.systemId
    ],
    null,
    "optimism should project hub recipe changes immediately"
  );
  assert.equal(
    optimism.getHubPlanPreview(hubTagTarget.hubCol)?.tagDisabledById?.[hubTagTarget.tagId],
    !hubTagTarget.disabled,
    "optimism should project hub tag toggles immediately"
  );
  assert.ok(
    optimism.getPendingActionRowSpecs().some((row) => row.description.startsWith("Pending:")),
    "optimism should surface pending action log rows"
  );

  optimism.update();
  assert.ok(
    optimism.getInventoryPreview(itemTarget.ownerId).hiddenItemIds.has(itemTarget.itemId),
    "optimism should retain accepted previews until the target second lands"
  );
  assert.equal(
    optimism.getPawnOverridePlacement(pawnTarget.pawnId)?.hubCol ?? null,
    0,
    "optimism should retain pawn overrides until the target second lands"
  );

  optimism.handleInvalidate("planner:rebuild");
  assert.ok(
    optimism.getInventoryPreview(itemTarget.ownerId).hiddenItemIds.has(itemTarget.itemId),
    "optimism should ignore planner-only rebuild invalidations"
  );
  assert.equal(
    optimism.getPawnOverridePlacement(pawnTarget.pawnId)?.hubCol ?? null,
    0,
    "planner-only rebuild invalidations should not clear pawn optimism"
  );

  liveState.tSec = 1;
  liveState.pawns[0] = { ...liveState.pawns[0], hubCol: 0, envCol: null };
  liveState.ownerInventories[1].items = [];
  liveState.ownerInventories[1].itemsById = {};
  const movedItem = {
    id: itemTarget.itemId,
    kind: "wood",
    quantity: 1,
    width: 1,
    height: 1,
    gridX: itemTarget.gridX + 1,
    gridY: itemTarget.gridY,
  };
  liveState.ownerInventories[1].items.push(movedItem);
  liveState.ownerInventories[1].itemsById[movedItem.id] = movedItem;
  liveState.board.occ.tile[0].tagStates.farmable.disabled = true;
  liveState.board.occ.tile[0].systemState.growth.selectedCropId = null;
  liveState.board.occ.tile[0].systemState.growth.recipePriority = {
    ordered: [],
    enabled: {},
  };
  liveState.hub.occ[0].tagStates.canCraft.disabled = true;
  liveState.hub.occ[0].systemState.workspace.selectedRecipeId = null;
  liveState.hub.occ[0].systemState.workspace.recipePriority = {
    ordered: [],
    enabled: {},
  };
  optimism.update();
  assert.equal(
    optimism.getPendingActionRowSpecs().length,
    0,
    "optimism should clear once the authoritative state reflects the scheduled actions"
  );

  const spanState = makeMinimalPreviewState();
  spanState.hub.occ = [
    { col: 0, span: 2, defId: "wideTemple", tags: [], tagStates: {}, systemState: {} },
    { col: 0, span: 2, defId: "wideTemple", tags: [], tagStates: {}, systemState: {} },
  ];
  spanState.hub.slots = [
    { structure: spanState.hub.occ[0] },
    { structure: spanState.hub.occ[0] },
  ];
  spanState.pawns = [{ id: 7, envCol: 0, hubCol: null }];
  const spanPreview = buildLiveActionPreviewState({
    state: spanState,
    actions: [
      {
        kind: ActionKinds.PLACE_PAWN,
        payload: {
          pawnId: 7,
          toHubCol: 1,
        },
        tSec: 1,
      },
    ],
  });
  assert.equal(
    spanPreview.pawnOverrides.get(7)?.hubCol ?? null,
    0,
    "live pawn optimism should normalize wide-structure hub spans to the anchor column"
  );

  optimism.recordScheduledBatch({
    ok: true,
    scheduled: true,
    tSec: 2,
    actions: scheduledActions.map((action) => ({ ...action, tSec: 2 })),
  });
  enabled = false;
  optimism.update();
  assert.equal(
    optimism.getPendingActionRowSpecs().length,
    0,
    "optimism should clear when the feature path is disabled"
  );
}

function run() {
  runPlannerPreviewReducerChecks();
  runLiveActionOptimismChecks();
  console.log("[test] Live action optimism checks passed");
}

run();
