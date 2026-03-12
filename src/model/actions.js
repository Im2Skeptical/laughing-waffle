// src/model/actions.js
// Registry of all valid timeline actions.
// Centralizes dispatch and validation.

import {
  cmdPlacePawn,
  cmdMoveItemBetweenOwners,
  cmdSplitStackAndPlace,
  cmdStackItemsInOwner,
  cmdUseItem,
  cmdOpenGraphItem,
  cmdDiscardItemFromOwner,
  cmdMoveProcessDropboxItem,
  cmdDepositItemToEquippedBasket,
  cmdEquipItemToLeaderSlot,
  cmdMoveLeaderEquipmentToInventory,
  cmdMoveLeaderEquipmentToSlot,
  cmdDebugSetCap,
  cmdSetTileTagOrder,
  cmdSetHubTagOrder,
  cmdToggleTileTag,
  cmdToggleHubTag,
  cmdSetTileCropSelection,
  cmdSetHubRecipeSelection,
  cmdSetRegionName,
  cmdSetHubName,
  cmdWithdrawHubPoolItem,
  cmdWithdrawPawnBasketPoolItem,
  cmdSetProcessRouting,
  cmdReorderProcessRoutingEndpoint,
  cmdToggleProcessRoutingEndpoint,
  cmdSetRoutingTemplate,
  cmdReorderRoutingTemplateEndpoint,
  cmdToggleRoutingTemplateEndpoint,
  cmdDebugQueueEnvEvent,
  cmdAdjustFollowerCount,
  cmdAdjustWorkerCount,
  cmdBuildDesignate,
  cmdCancelBuild,
  cmdUnlockSkillNode,
} from "./commands.js";

export const ActionKinds = {
  PLACE_PAWN: "placePawn",
  INVENTORY_MOVE: "inventoryMove",
  INVENTORY_SPLIT: "inventorySplit",
  INVENTORY_STACK: "inventoryStack",
  INVENTORY_DISCARD: "inventoryDiscard",
  INVENTORY_USE_ITEM: "inventoryUseItem",
  INVENTORY_OPEN_GRAPH_ITEM: "inventoryOpenGraphItem",
  PROCESS_DROPBOX_MOVE: "processDropboxMove",
  DEPOSIT_ITEM_TO_BASKET: "depositItemToBasket",
  EQUIP_ITEM: "equipItem",
  UNEQUIP_ITEM: "unequipItem",
  MOVE_EQUIPPED_ITEM: "moveEquippedItem",
  BUILD_DESIGNATE: "buildDesignate",
  BUILD_CANCEL: "buildCancel",
  SET_TILE_TAG_ORDER: "setTileTagOrder",
  SET_HUB_TAG_ORDER: "setHubTagOrder",
  TOGGLE_TILE_TAG: "toggleTileTag",
  TOGGLE_HUB_TAG: "toggleHubTag",
  SET_TILE_CROP_SELECTION: "setTileCropSelection",
  SET_HUB_RECIPE_SELECTION: "setHubRecipeSelection",
  SET_REGION_NAME: "setRegionName",
  SET_HUB_NAME: "setHubName",
  WITHDRAW_HUB_POOL_ITEM: "withdrawHubPoolItem",
  WITHDRAW_PAWN_BASKET_POOL_ITEM: "withdrawPawnBasketPoolItem",
  SET_PROCESS_ROUTING: "setProcessRouting",
  REORDER_PROCESS_ROUTING_ENDPOINT: "reorderProcessRoutingEndpoint",
  TOGGLE_PROCESS_ROUTING_ENDPOINT: "toggleProcessRoutingEndpoint",
  SET_ROUTING_TEMPLATE: "setRoutingTemplate",
  REORDER_ROUTING_TEMPLATE_ENDPOINT: "reorderRoutingTemplateEndpoint",
  TOGGLE_ROUTING_TEMPLATE_ENDPOINT: "toggleRoutingTemplateEndpoint",
  ADJUST_FOLLOWER_COUNT: "adjustFollowerCount",
  ADJUST_WORKER_COUNT: "adjustWorkerCount",
  UNLOCK_SKILL_NODE: "unlockSkillNode",
  DEBUG_SET_CAP: "debugSetCap",
  DEBUG_QUEUE_ENV_EVENT: "debugQueueEnvEvent",
};

function ensureAPState(state) {
  if (typeof state.actionPoints !== "number") state.actionPoints = 100;
  if (typeof state.actionPointCap !== "number") state.actionPointCap = 100;
}

function getActionApCost(action) {
  const raw = action?.apCost ?? action?.payload?.apCost;
  if (Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }

  const kind = action?.kind;
  if (
    kind === ActionKinds.PLACE_PAWN ||
    kind === ActionKinds.INVENTORY_MOVE ||
    kind === ActionKinds.INVENTORY_SPLIT ||
    kind === ActionKinds.INVENTORY_STACK ||
    kind === ActionKinds.EQUIP_ITEM ||
    kind === ActionKinds.UNEQUIP_ITEM ||
    kind === ActionKinds.MOVE_EQUIPPED_ITEM ||
    kind === ActionKinds.BUILD_DESIGNATE ||
    kind === ActionKinds.BUILD_CANCEL ||
    kind === ActionKinds.SET_TILE_CROP_SELECTION
    || kind === ActionKinds.SET_HUB_RECIPE_SELECTION
    || kind === ActionKinds.SET_HUB_TAG_ORDER
    || kind === ActionKinds.TOGGLE_TILE_TAG
    || kind === ActionKinds.TOGGLE_HUB_TAG
    || kind === ActionKinds.ADJUST_FOLLOWER_COUNT
    || kind === ActionKinds.ADJUST_WORKER_COUNT
  ) {
    console.warn(
      "Action missing apCost; defaulting to 0 for replay safety.",
      action
    );
  }

  return 0;
}

function isActionPointCostEnabled(state) {
  return state?.variantFlags?.actionPointCostsEnabled !== false;
}

// UPDATE: Added context parameter to support Replay mode
export function applyAction(state, action, context = {}) {
  if (!action || typeof action !== "object") {
    return { ok: false, reason: "badAction" };
  }

  const { isReplay } = context;
  const kind = action.kind;
  const payload = action.payload || {};

  if (!kind) {
    throw new Error(
      `Unknown action kind: '${action?.kind}'. Action: ${JSON.stringify(action)}`
    );
  }

  ensureAPState(state);

  // ---------------------------------------------------------------------------
  // 1. Gating Logic
  // ---------------------------------------------------------------------------

  // "Control" actions are allowed while running.
  // "Edit" actions (Player moves) require the simulation to be PAUSED.
  const isControlAction =
    kind === ActionKinds.DEBUG_SET_CAP ||
    kind === ActionKinds.DEBUG_QUEUE_ENV_EVENT ||
    kind === ActionKinds.INVENTORY_OPEN_GRAPH_ITEM;

  // STRICT GATING: If not replaying, gameplay actions are FORBIDDEN unless paused.
  if (!isReplay && !isControlAction && !state.paused) {
    return { ok: false, reason: "mustBePaused" };
  }

  // ---------------------------------------------------------------------------
  // 2. Cost Calculation & Validation
  // ---------------------------------------------------------------------------
  const cost = isActionPointCostEnabled(state) ? getActionApCost(action) : 0;

  // NOTE: We still enforce AP costs during replay to ensure determinism.
  if (cost > 0 && state.actionPoints < cost) {
    return {
      ok: false,
      reason: "insufficientAP",
      needed: cost,
      current: state.actionPoints,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Execution
  // ---------------------------------------------------------------------------
  let result;

  switch (kind) {
    case ActionKinds.PLACE_PAWN:
      result = cmdPlacePawn(state, payload);
      break;

    case ActionKinds.INVENTORY_MOVE:
      result = cmdMoveItemBetweenOwners(state, payload);
      break;

    case ActionKinds.PROCESS_DROPBOX_MOVE:
      result = cmdMoveProcessDropboxItem(state, payload);
      break;

    case ActionKinds.DEPOSIT_ITEM_TO_BASKET:
      result = cmdDepositItemToEquippedBasket(state, payload);
      break;

    case ActionKinds.EQUIP_ITEM:
      result = cmdEquipItemToLeaderSlot(state, payload);
      break;

    case ActionKinds.UNEQUIP_ITEM:
      result = cmdMoveLeaderEquipmentToInventory(state, payload);
      break;

    case ActionKinds.MOVE_EQUIPPED_ITEM:
      result = cmdMoveLeaderEquipmentToSlot(state, payload);
      break;

    case ActionKinds.INVENTORY_SPLIT:
      result = cmdSplitStackAndPlace(
        state,
        payload.ownerId,
        payload.itemId,
        payload.amount,
        payload.targetGX,
        payload.targetGY
      );
      break;

    case ActionKinds.INVENTORY_STACK:
      result = cmdStackItemsInOwner(state, payload);
      break;

    case ActionKinds.INVENTORY_DISCARD:
      result = cmdDiscardItemFromOwner(state, payload);
      break;

    case ActionKinds.INVENTORY_USE_ITEM:
      result = cmdUseItem(state, payload);
      break;

    case ActionKinds.INVENTORY_OPEN_GRAPH_ITEM:
      result = cmdOpenGraphItem(state, payload);
      break;

    case ActionKinds.BUILD_DESIGNATE:
      result = cmdBuildDesignate(state, payload);
      break;

    case ActionKinds.BUILD_CANCEL:
      result = cmdCancelBuild(state, payload);
      break;

    case ActionKinds.SET_TILE_TAG_ORDER:
      result = cmdSetTileTagOrder(state, payload);
      break;

    case ActionKinds.SET_HUB_TAG_ORDER:
      result = cmdSetHubTagOrder(state, payload);
      break;

    case ActionKinds.TOGGLE_TILE_TAG:
      result = cmdToggleTileTag(state, payload);
      break;

    case ActionKinds.TOGGLE_HUB_TAG:
      result = cmdToggleHubTag(state, payload);
      break;

    case ActionKinds.SET_TILE_CROP_SELECTION:
      result = cmdSetTileCropSelection(state, payload);
      break;

    case ActionKinds.SET_HUB_RECIPE_SELECTION:
      result = cmdSetHubRecipeSelection(state, payload);
      break;

    case ActionKinds.SET_REGION_NAME:
      result = cmdSetRegionName(state, payload);
      break;

    case ActionKinds.SET_HUB_NAME:
      result = cmdSetHubName(state, payload);
      break;

    case ActionKinds.WITHDRAW_HUB_POOL_ITEM:
      result = cmdWithdrawHubPoolItem(state, payload);
      break;

    case ActionKinds.WITHDRAW_PAWN_BASKET_POOL_ITEM:
      result = cmdWithdrawPawnBasketPoolItem(state, payload);
      break;

    case ActionKinds.SET_PROCESS_ROUTING:
      result = cmdSetProcessRouting(state, payload);
      break;

    case ActionKinds.REORDER_PROCESS_ROUTING_ENDPOINT:
      result = cmdReorderProcessRoutingEndpoint(state, payload);
      break;

    case ActionKinds.TOGGLE_PROCESS_ROUTING_ENDPOINT:
      result = cmdToggleProcessRoutingEndpoint(state, payload);
      break;

    case ActionKinds.SET_ROUTING_TEMPLATE:
      result = cmdSetRoutingTemplate(state, payload);
      break;

    case ActionKinds.REORDER_ROUTING_TEMPLATE_ENDPOINT:
      result = cmdReorderRoutingTemplateEndpoint(state, payload);
      break;

    case ActionKinds.TOGGLE_ROUTING_TEMPLATE_ENDPOINT:
      result = cmdToggleRoutingTemplateEndpoint(state, payload);
      break;

    case ActionKinds.ADJUST_FOLLOWER_COUNT:
      result = cmdAdjustFollowerCount(state, payload);
      break;

    case ActionKinds.ADJUST_WORKER_COUNT:
      result = cmdAdjustWorkerCount(state, payload);
      break;

    case ActionKinds.UNLOCK_SKILL_NODE:
      result = cmdUnlockSkillNode(state, payload);
      break;

    case ActionKinds.DEBUG_SET_CAP:
      result = cmdDebugSetCap(state, payload);
      break;

    case ActionKinds.DEBUG_QUEUE_ENV_EVENT:
      result = cmdDebugQueueEnvEvent(state, payload);
      break;

    default:
      return { ok: false, reason: `unhandledActionKind:${kind}` };
  }

  // ---------------------------------------------------------------------------
  // 4. AP Deduction (Only on Success)
  // ---------------------------------------------------------------------------
  const success = result && (result.ok === undefined || result.ok === true);

  if (success && cost > 0) {
    state.actionPoints -= cost;
    if (state.actionPoints < 0) state.actionPoints = 0;
  }

  if (success) {
    state.actionPoints = Math.min(state.actionPoints, state.actionPointCap);
  }

  return result;
}
