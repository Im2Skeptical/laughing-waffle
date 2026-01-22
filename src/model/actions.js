// src/model/actions.js
// Registry of all valid timeline actions.
// Centralizes dispatch and validation.

import {
  cmdPlaceCharacter,
  cmdMoveItemBetweenOwners,
  cmdSplitStackAndPlace,
  cmdStackItemsInOwner,
  cmdDebugSetCap,
  cmdSetTileTagOrder,
  cmdSetTileCropSelection,
} from "./commands.js";

export const ActionKinds = {
  PLACE_CHARACTER: "placeCharacter",
  INVENTORY_MOVE: "inventoryMove",
  INVENTORY_SPLIT: "inventorySplit",
  INVENTORY_STACK: "inventoryStack",
  BUILD_DESIGNATE: "buildDesignate",
  SET_TILE_TAG_ORDER: "setTileTagOrder",
  SET_TILE_CROP_SELECTION: "setTileCropSelection",
  DEBUG_SET_CAP: "debugSetCap",
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
    kind === ActionKinds.SET_TILE_CROP_SELECTION
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
  const isControlAction = kind === ActionKinds.DEBUG_SET_CAP;

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

    case ActionKinds.BUILD_DESIGNATE:
      result = { ok: true, result: "designated" };
      break;

    case ActionKinds.SET_TILE_TAG_ORDER:
      result = cmdSetTileTagOrder(state, payload);
      break;

    case ActionKinds.SET_TILE_CROP_SELECTION:
      result = cmdSetTileCropSelection(state, payload);
      break;

    case ActionKinds.DEBUG_SET_CAP:
      result = cmdDebugSetCap(state, payload);
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
