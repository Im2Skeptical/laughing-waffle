import { ActionKinds, applyAction } from "./actions.js";
import { updateGame } from "./game-model.js";
import { deserializeGameState, serializeGameState } from "./state.js";

const TICKS_PER_SEC = 60;
const SIM_DT_STEP = 1 / TICKS_PER_SEC;

function cloneState(state) {
  return deserializeGameState(serializeGameState(state));
}

function cloneStateData(stateData) {
  return deserializeGameState(stateData);
}

function normalizeBucketSec(entry) {
  if (Number.isFinite(entry?.tSec)) return Math.max(0, Math.floor(entry.tSec));
  if (Number.isFinite(entry?.sec)) return Math.max(0, Math.floor(entry.sec));
  if (Number.isFinite(entry?.second)) return Math.max(0, Math.floor(entry.second));
  const firstAction = Array.isArray(entry?.actions) ? entry.actions[0] : null;
  if (Number.isFinite(firstAction?.tSec)) {
    return Math.max(0, Math.floor(firstAction.tSec));
  }
  return 0;
}

function cloneAction(action) {
  if (!action || typeof action !== "object") return null;
  return {
    ...action,
    payload:
      action.payload && typeof action.payload === "object"
        ? JSON.parse(JSON.stringify(action.payload))
        : action.payload ?? null,
  };
}

function normalizeActionBuckets(actionsBySecond) {
  const bucketsBySec = new Map();
  const input = Array.isArray(actionsBySecond) ? actionsBySecond : [];

  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry.actions)) {
      const sec = normalizeBucketSec(entry);
      const list = bucketsBySec.get(sec) || [];
      for (const action of entry.actions) {
        const cloned = cloneAction(action);
        if (!cloned?.kind) continue;
        cloned.tSec = sec;
        list.push(cloned);
      }
      if (list.length > 0) bucketsBySec.set(sec, list);
      continue;
    }

    if (!entry.kind) continue;
    const sec = Number.isFinite(entry.tSec) ? Math.max(0, Math.floor(entry.tSec)) : 0;
    const cloned = cloneAction(entry);
    if (!cloned) continue;
    cloned.tSec = sec;
    const list = bucketsBySec.get(sec) || [];
    list.push(cloned);
    bucketsBySec.set(sec, list);
  }

  return Array.from(bucketsBySec.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([tSec, actions]) => ({ tSec, actions }));
}

function createTouchedTargets() {
  return {
    ownerIds: new Set(),
    pawnIds: new Set(),
    envCols: new Set(),
    hubCols: new Set(),
  };
}

function addTouchedTarget(set, value) {
  if (value == null) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    set.add(Math.floor(value));
    return;
  }
  set.add(value);
}

function collectActionTouchedTargets(action, touchedTargets) {
  const payload = action?.payload || {};
  switch (action?.kind) {
    case ActionKinds.INVENTORY_MOVE:
      addTouchedTarget(touchedTargets.ownerIds, payload.fromOwnerId);
      addTouchedTarget(
        touchedTargets.ownerIds,
        payload.toPlacement?.ownerId ?? payload.toOwnerId
      );
      break;
    case ActionKinds.PLACE_PAWN:
      addTouchedTarget(touchedTargets.pawnIds, payload.pawnId);
      break;
    case ActionKinds.ADJUST_FOLLOWER_COUNT:
    case ActionKinds.ADJUST_WORKER_COUNT:
      addTouchedTarget(touchedTargets.pawnIds, payload.leaderId);
      break;
    case ActionKinds.SET_TILE_TAG_ORDER:
    case ActionKinds.TOGGLE_TILE_TAG:
    case ActionKinds.SET_TILE_CROP_SELECTION:
      addTouchedTarget(touchedTargets.envCols, payload.envCol);
      break;
    case ActionKinds.SET_HUB_TAG_ORDER:
    case ActionKinds.TOGGLE_HUB_TAG:
    case ActionKinds.SET_HUB_RECIPE_SELECTION:
      addTouchedTarget(touchedTargets.hubCols, payload.hubCol);
      break;
    case ActionKinds.BUILD_DESIGNATE:
      addTouchedTarget(touchedTargets.hubCols, payload.hubCol);
      addTouchedTarget(touchedTargets.hubCols, payload.target?.hubCol);
      addTouchedTarget(touchedTargets.hubCols, payload.target?.col);
      break;
    default:
      break;
  }
}

function collectResultTouchedTargets(result, touchedTargets) {
  addTouchedTarget(touchedTargets.ownerIds, result?.fromOwnerId);
  addTouchedTarget(touchedTargets.ownerIds, result?.toOwnerId);
  addTouchedTarget(touchedTargets.ownerIds, result?.ownerId);
  addTouchedTarget(touchedTargets.pawnIds, result?.pawnId);
  addTouchedTarget(touchedTargets.envCols, result?.envCol);
  addTouchedTarget(touchedTargets.hubCols, result?.hubCol);
}

function advanceStateToSecond(state, targetSec) {
  const desiredSec = Number.isFinite(targetSec) ? Math.max(0, Math.floor(targetSec)) : 0;
  let currentSec = Number.isFinite(state?.tSec) ? Math.max(0, Math.floor(state.tSec)) : 0;
  if (currentSec >= desiredSec) return { ok: true };

  state.paused = false;
  while (currentSec < desiredSec) {
    const beforeSec = currentSec;
    for (let i = 0; i < TICKS_PER_SEC; i += 1) {
      updateGame(SIM_DT_STEP, state);
    }
    currentSec = Number.isFinite(state?.tSec) ? Math.max(0, Math.floor(state.tSec)) : beforeSec;
    if (currentSec <= beforeSec) {
      return { ok: false, reason: "advanceFailed", targetSec: desiredSec, currentSec };
    }
  }

  return { ok: true };
}

function projectIntoState(projectedState, buckets) {
  const actionResults = [];
  const touchedTargets = createTouchedTargets();
  let startSec = null;
  let endSec = null;

  for (const bucket of buckets) {
    if (!bucket || !Array.isArray(bucket.actions) || bucket.actions.length <= 0) continue;
    const sec = Math.max(0, Math.floor(bucket.tSec ?? 0));
    const advanceRes = advanceStateToSecond(projectedState, sec);
    if (!advanceRes?.ok) {
      return {
        ok: false,
        reason: advanceRes?.reason ?? "advanceFailed",
        projectedState,
        actionResults,
        touchedTargets,
        appliedSecondRange:
          startSec == null ? null : { startSec, endSec: endSec ?? startSec },
      };
    }

    if (startSec == null) startSec = sec;
    endSec = sec;

    for (const action of bucket.actions) {
      collectActionTouchedTargets(action, touchedTargets);
      const result = applyAction(projectedState, action, { isReplay: true });
      actionResults.push({
        action,
        result,
      });
      if (!result?.ok) {
        return {
          ok: false,
          reason: result?.reason ?? "actionFailed",
          detail: result ?? null,
          projectedState,
          actionResults,
          touchedTargets,
          appliedSecondRange:
            startSec == null ? null : { startSec, endSec: endSec ?? startSec },
        };
      }
      collectResultTouchedTargets(result, touchedTargets);
    }
  }

  return {
    ok: true,
    projectedState,
    actionResults,
    touchedTargets,
    appliedSecondRange:
      startSec == null ? null : { startSec, endSec: endSec ?? startSec },
  };
}

export function projectActionsFromBoundaryStateData({
  boundaryStateData,
  actionsBySecond,
} = {}) {
  if (boundaryStateData == null) return { ok: false, reason: "noBoundaryStateData" };
  const baselineState = cloneStateData(boundaryStateData);
  const projectedState = cloneStateData(boundaryStateData);
  const buckets = normalizeActionBuckets(actionsBySecond);
  const projection = projectIntoState(projectedState, buckets);
  return {
    ...projection,
    baselineState,
  };
}

export function projectActionsFromState({ state, actionsBySecond } = {}) {
  if (!state || typeof state !== "object") return { ok: false, reason: "noState" };
  const baselineState = cloneState(state);
  const projectedState = cloneState(state);
  const buckets = normalizeActionBuckets(actionsBySecond);
  const projection = projectIntoState(projectedState, buckets);
  return {
    ...projection,
    baselineState,
  };
}
