// src/model/actions.js
// Registry of all valid timeline actions.
// Centralizes dispatch and validation.

import {
  cmdPlaceCharacter,
  cmdMoveItemBetweenOwners,
  cmdSplitStackAndPlace,
  cmdStackItemsInOwner,
  cmdDiscardItemFromOwner,
  cmdDebugSetCap,
  cmdSetTileTagOrder,
  cmdSetHubTagOrder,
  cmdToggleTileTag,
  cmdToggleHubTag,
  cmdSetTileCropSelection,
  cmdDebugQueueEnvEvent,
  cmdAdjustFollowerCount,
  cmdBuildDesignate,
  cmdCancelBuild,
} from "./commands.js";

export const ActionKinds = {
  PLACE_CHARACTER: "placeCharacter",
  INVENTORY_MOVE: "inventoryMove",
  INVENTORY_SPLIT: "inventorySplit",
  INVENTORY_STACK: "inventoryStack",
  INVENTORY_DISCARD: "inventoryDiscard",
  BUILD_DESIGNATE: "buildDesignate",
  BUILD_CANCEL: "buildCancel",
  SET_TILE_TAG_ORDER: "setTileTagOrder",
  SET_HUB_TAG_ORDER: "setHubTagOrder",
  TOGGLE_TILE_TAG: "toggleTileTag",
  TOGGLE_HUB_TAG: "toggleHubTag",
  SET_TILE_CROP_SELECTION: "setTileCropSelection",
  ADJUST_FOLLOWER_COUNT: "adjustFollowerCount",
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
    kind === ActionKinds.PLACE_CHARACTER ||
    kind === ActionKinds.INVENTORY_MOVE ||
    kind === ActionKinds.INVENTORY_SPLIT ||
    kind === ActionKinds.INVENTORY_STACK ||
    kind === ActionKinds.BUILD_DESIGNATE ||
    kind === ActionKinds.BUILD_CANCEL ||
    kind === ActionKinds.SET_TILE_CROP_SELECTION
    || kind === ActionKinds.SET_HUB_TAG_ORDER
    || kind === ActionKinds.TOGGLE_TILE_TAG
    || kind === ActionKinds.TOGGLE_HUB_TAG
    || kind === ActionKinds.ADJUST_FOLLOWER_COUNT
  ) {
    console.warn(
      "Action missing apCost; defaulting to 0 for replay safety.",
      action
    );
  }

  return 0;
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
    kind === ActionKinds.DEBUG_QUEUE_ENV_EVENT;

  // STRICT GATING: If not replaying, gameplay actions are FORBIDDEN unless paused.
  if (!isReplay && !isControlAction && !state.paused) {
    return { ok: false, reason: "mustBePaused" };
  }

  // ---------------------------------------------------------------------------
  // 2. Cost Calculation & Validation
  // ---------------------------------------------------------------------------
  const cost = getActionApCost(action);

  // NOTE: We still enforce AP costs during replay to ensure determinism.
  if (state.actionPoints < cost) {
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
    case ActionKinds.PLACE_CHARACTER:
      result = cmdPlaceCharacter(state, payload);
      break;

    case ActionKinds.INVENTORY_MOVE:
      result = cmdMoveItemBetweenOwners(state, payload);
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

    case ActionKinds.ADJUST_FOLLOWER_COUNT:
      result = cmdAdjustFollowerCount(state, payload);
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
