// src/model/actions.js
// Registry of all valid timeline actions and their payload contracts.
// Centralizes dispatch, validation, and legacy alias handling.

import {
  cmdPlaceCharacterInSlot,
  cmdMoveItemBetweenOwners,
  cmdSplitStackAndPlace,
  cmdStackItemsInOwner,
  cmdStartNextTurn,
  cmdDebugSetCap,
} from "./commands.js";

export const ActionKinds = {
  START_NEXT_TURN: "startNextTurn",
  PLACE_CHARACTER: "placeCharacter",
  INVENTORY_MOVE: "inventoryMove",
  INVENTORY_SPLIT: "inventorySplit",
  INVENTORY_STACK: "inventoryStack",
  DEBUG_SET_CAP: "debugSetCap",
};

// Map legacy action kinds to current canonical kinds
const LEGACY_ALIASES = {
  placeCharacterInSlot: ActionKinds.PLACE_CHARACTER,
  moveItemBetweenOwners: ActionKinds.INVENTORY_MOVE,
  splitStackAndPlace: ActionKinds.INVENTORY_SPLIT,
  stackItemsInOwner: ActionKinds.INVENTORY_STACK,
};

const ACTION_COST = 20;

function normalizeKind(kind) {
  if (Object.values(ActionKinds).includes(kind)) return kind;
  return LEGACY_ALIASES[kind] || null;
}

function ensureAPState(state) {
  if (typeof state.actionPoints !== "number") state.actionPoints = 100;
  if (typeof state.actionPointCap !== "number") state.actionPointCap = 100;
}

// UPDATE: Added context parameter to support Replay mode
export function applyAction(state, action, context = {}) {
  if (!action || typeof action !== "object") {
    return { ok: false, reason: "badAction" };
  }

  const { isReplay } = context;
  const rawKind = action.kind;
  const kind = normalizeKind(rawKind);
  const payload = action.payload || {};

  if (!kind) {
    throw new Error(
      `Unknown action kind: '${rawKind}'. Action: ${JSON.stringify(action)}`
    );
  }

  ensureAPState(state);

  // ---------------------------------------------------------------------------
  // 1. Gating Logic
  // ---------------------------------------------------------------------------

  // "Control" actions are allowed while running.
  // "Edit" actions (Player moves) require the simulation to be PAUSED.
  const isControlAction =
    kind === ActionKinds.START_NEXT_TURN || kind === ActionKinds.DEBUG_SET_CAP;

  // STRICT GATING: If not replaying, gameplay actions are FORBIDDEN unless paused.
  if (!isReplay && !isControlAction && !state.paused) {
    return { ok: false, reason: "mustBePaused" };
  }

  // ---------------------------------------------------------------------------
  // 2. Cost Calculation & Validation
  // ---------------------------------------------------------------------------
  let cost = 0;

  switch (kind) {
    case ActionKinds.PLACE_CHARACTER:
    case ActionKinds.INVENTORY_MOVE:
    case ActionKinds.INVENTORY_SPLIT:
    case ActionKinds.INVENTORY_STACK:
      cost = ACTION_COST;
      break;
    case ActionKinds.START_NEXT_TURN:
    case ActionKinds.DEBUG_SET_CAP:
      cost = 0;
      break;
  }

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
    case ActionKinds.START_NEXT_TURN:
      result = cmdStartNextTurn(state);
      break;

    case ActionKinds.PLACE_CHARACTER:
      result = cmdPlaceCharacterInSlot(state, payload);
      break;

    case ActionKinds.INVENTORY_MOVE:
      result = cmdMoveItemBetweenOwners(state, payload);
      break;

    case ActionKinds.INVENTORY_SPLIT:
      result = cmdSplitStackAndPlace(
        state,
        payload.ownerId,
        payload.itemId,
        payload.amount
      );
      break;

    case ActionKinds.INVENTORY_STACK:
      result = cmdStackItemsInOwner(state, payload);
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
