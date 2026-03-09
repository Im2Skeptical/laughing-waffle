import {
  buildLiveActionPreviewState,
  createEmptyInventoryPreview,
} from "../../controllers/actionmanagers/action-preview-state.js";
import { buildActionRowSpecs } from "../../controllers/actionmanagers/action-log-controller.js";

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

function arraysEqual(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function resolveInventoryItemLocation(state, payload = {}) {
  const inventories =
    state?.ownerInventories && typeof state.ownerInventories === "object"
      ? state.ownerInventories
      : {};
  const hintedOwnerId = payload.toOwnerId ?? payload.fromOwnerId ?? null;
  const itemId = payload.itemId ?? payload.item?.id ?? null;
  if (itemId == null) return null;

  if (hintedOwnerId != null) {
    const hintedInventory = inventories[hintedOwnerId];
    const hintedItem =
      hintedInventory?.itemsById?.[itemId] ??
      hintedInventory?.items?.find?.((item) => item?.id === itemId) ??
      null;
    if (hintedItem) {
      return {
        ownerId: hintedOwnerId,
        gx: Math.floor(hintedItem.gridX ?? 0),
        gy: Math.floor(hintedItem.gridY ?? 0),
      };
    }
  }

  for (const [ownerIdRaw, inv] of Object.entries(inventories)) {
    const item =
      inv?.itemsById?.[itemId] ??
      inv?.items?.find?.((candidate) => candidate?.id === itemId) ??
      null;
    if (!item) continue;
    const ownerIdNum = Number(ownerIdRaw);
    const ownerId = Number.isFinite(ownerIdNum) ? ownerIdNum : ownerIdRaw;
    return {
      ownerId,
      gx: Math.floor(item.gridX ?? 0),
      gy: Math.floor(item.gridY ?? 0),
    };
  }
  return null;
}

function normalizeHubAnchorCol(state, rawHubCol) {
  if (!Number.isFinite(rawHubCol)) return null;
  const hubCol = Math.floor(rawHubCol);
  const hubOcc = Array.isArray(state?.hub?.occ) ? state.hub.occ : null;
  if (hubOcc) {
    const anchor = hubOcc[hubCol];
    if (anchor && Number.isFinite(anchor.col)) {
      return Math.floor(anchor.col);
    }
  }
  return hubCol;
}

function normalizePawnPlacementFromAction(state, payload = {}) {
  if (Number.isFinite(payload.envCol) || Number.isFinite(payload.toEnvCol)) {
    return {
      envCol: Math.floor(
        Number.isFinite(payload.envCol) ? payload.envCol : payload.toEnvCol
      ),
    };
  }
  if (Number.isFinite(payload.hubCol) || Number.isFinite(payload.toHubCol)) {
    const hubCol = normalizeHubAnchorCol(
      state,
      Number.isFinite(payload.hubCol) ? payload.hubCol : payload.toHubCol
    );
    return Number.isFinite(hubCol) ? { hubCol } : null;
  }
  if (payload.toPlacement && typeof payload.toPlacement === "object") {
    return normalizePawnPlacementFromAction(state, payload.toPlacement);
  }
  return null;
}

function getCurrentPawnPlacement(state, pawnId) {
  const pawn =
    Array.isArray(state?.pawns) && pawnId != null
      ? state.pawns.find((candidate) => candidate?.id === pawnId) ?? null
      : null;
  if (!pawn) return null;
  if (Number.isFinite(pawn.envCol)) {
    return { envCol: Math.floor(pawn.envCol) };
  }
  if (Number.isFinite(pawn.hubCol)) {
    return {
      hubCol: normalizeHubAnchorCol(state, pawn.hubCol),
    };
  }
  return null;
}

function isActionReflectedInState(state, action) {
  const payload = action?.payload || {};
  if (!state || !action?.kind) return false;

  if (action.kind === "placePawn") {
    const currentPlacement = getCurrentPawnPlacement(state, payload.pawnId ?? null);
    const targetPlacement = normalizePawnPlacementFromAction(state, payload);
    if (!currentPlacement || !targetPlacement) return false;
    if (Number.isFinite(targetPlacement.envCol)) {
      return currentPlacement.envCol === targetPlacement.envCol;
    }
    return currentPlacement.hubCol === targetPlacement.hubCol;
  }

  if (action.kind === "inventoryMove") {
    const currentLocation = resolveInventoryItemLocation(state, payload);
    if (!currentLocation) return false;
    const targetOwnerId =
      payload.toPlacement?.ownerId ?? payload.toOwnerId ?? null;
    const targetGX = payload.toPlacement?.gx ?? payload.targetGX;
    const targetGY = payload.toPlacement?.gy ?? payload.targetGY;
    if (targetOwnerId == null || !Number.isFinite(targetGX) || !Number.isFinite(targetGY)) {
      return false;
    }
    return (
      currentLocation.ownerId === targetOwnerId &&
      currentLocation.gx === Math.floor(targetGX) &&
      currentLocation.gy === Math.floor(targetGY)
    );
  }

  if (action.kind === "toggleTileTag") {
    const tile = state?.board?.occ?.tile?.[Math.floor(payload.envCol ?? -1)] ?? null;
    const current = tile?.tagStates?.[payload.tagId]?.disabled === true;
    return current === (payload.disabled === true);
  }

  if (action.kind === "toggleHubTag") {
    const structure =
      state?.hub?.occ?.[Math.floor(payload.hubCol ?? -1)] ??
      state?.hub?.slots?.[Math.floor(payload.hubCol ?? -1)]?.structure ??
      null;
    const current = structure?.tagStates?.[payload.tagId]?.disabled === true;
    return current === (payload.disabled === true);
  }

  if (action.kind === "setTileTagOrder") {
    const tile = state?.board?.occ?.tile?.[Math.floor(payload.envCol ?? -1)] ?? null;
    return arraysEqual(tile?.tags, payload.tagIds ?? payload.tags);
  }

  if (action.kind === "setHubTagOrder") {
    const structure =
      state?.hub?.occ?.[Math.floor(payload.hubCol ?? -1)] ??
      state?.hub?.slots?.[Math.floor(payload.hubCol ?? -1)]?.structure ??
      null;
    return arraysEqual(structure?.tags, payload.tagIds ?? payload.tags);
  }

  if (action.kind === "setTileCropSelection") {
    const tile = state?.board?.occ?.tile?.[Math.floor(payload.envCol ?? -1)] ?? null;
    const current = tile?.systemState?.growth?.selectedCropId ?? null;
    return current === (payload.cropId ?? null);
  }

  if (action.kind === "setHubRecipeSelection") {
    const structure =
      state?.hub?.occ?.[Math.floor(payload.hubCol ?? -1)] ??
      state?.hub?.slots?.[Math.floor(payload.hubCol ?? -1)]?.structure ??
      null;
    const current =
      structure?.systemState?.[payload.systemId]?.selectedRecipeId ?? null;
    return current === (payload.recipeId ?? null);
  }

  return false;
}

function isBatchReflectedInState(state, batch) {
  if (!state || !batch) return false;
  const actions = Array.isArray(batch.actions) ? batch.actions : [];
  if (!actions.length) return false;
  for (const action of actions) {
    if (!isActionReflectedInState(state, action)) return false;
  }
  return true;
}

export function createLiveActionOptimism({
  getState,
  getOwnerLabel,
  isOptimismEnabled,
} = {}) {
  let version = 0;
  let nextBatchId = 1;
  let batches = [];
  let previewByOwner = new Map();
  let pawnOverrides = new Map();
  let tilePlanByEnvCol = new Map();
  let hubPlanByHubCol = new Map();
  let pendingActionRowSpecs = [];
  let lastRecordSummary = null;
  let lastIgnoredRecordSummary = null;
  let lastInvalidateReason = null;
  let lastClearReason = null;

  function summarizeScheduleResult(scheduleResult) {
    const actions = Array.isArray(scheduleResult?.actions)
      ? scheduleResult.actions
      : [];
    return {
      ok: scheduleResult?.ok === true,
      scheduled: scheduleResult?.scheduled === true,
      reason: scheduleResult?.reason ?? null,
      tSec: Number.isFinite(scheduleResult?.tSec)
        ? Math.floor(scheduleResult.tSec)
        : null,
      actionCount: actions.length,
      actionKinds: actions.map((action) => action?.kind ?? null),
    };
  }

  function bump() {
    version += 1;
  }

  function rebuild() {
    const state = typeof getState === "function" ? getState() : null;
    const orderedActions = batches
      .slice()
      .sort((left, right) => {
        const secDelta = Math.floor(left.tSec ?? 0) - Math.floor(right.tSec ?? 0);
        if (secDelta !== 0) return secDelta;
        return Math.floor(left.id ?? 0) - Math.floor(right.id ?? 0);
      })
      .flatMap((batch) => batch.actions);

    const previewState = buildLiveActionPreviewState({
      state,
      actions: orderedActions,
      // Live optimism should always project accepted inventory moves immediately.
      // The older ghost-preview variant flag only controls planner/paused previews.
      inventoryTransferGhostPreviewEnabled: true,
    });
    previewByOwner = previewState.previewByOwner;
    pawnOverrides = previewState.pawnOverrides;
    tilePlanByEnvCol = previewState.tilePlanByEnvCol;
    hubPlanByHubCol = previewState.hubPlanByHubCol;
    pendingActionRowSpecs = buildActionRowSpecs(
      orderedActions,
      state,
      getOwnerLabel
    ).map((row, index) => ({
      ...row,
      id: `pending:${row.id}:${index}`,
      description: `Pending: ${row.description}`,
    }));
  }

  function clear(reason = "clear") {
    if (
      batches.length <= 0 &&
      previewByOwner.size <= 0 &&
      pawnOverrides.size <= 0 &&
      tilePlanByEnvCol.size <= 0 &&
      hubPlanByHubCol.size <= 0 &&
      pendingActionRowSpecs.length <= 0
    ) {
      return;
    }
    batches = [];
    previewByOwner = new Map();
    pawnOverrides = new Map();
    tilePlanByEnvCol = new Map();
    hubPlanByHubCol = new Map();
    pendingActionRowSpecs = [];
    lastClearReason = reason;
    bump();
  }

  function pruneExpiredBatches() {
    const state = typeof getState === "function" ? getState() : null;
    const currentSec = Math.max(0, Math.floor(state?.tSec ?? 0));
    const nextBatches = [];
    let changed = false;
    for (const batch of batches) {
      if (batch.tSec < currentSec) {
        changed = true;
        continue;
      }
      if (batch.tSec === currentSec && isBatchReflectedInState(state, batch)) {
        changed = true;
        continue;
      }
      nextBatches.push(batch);
    }
    if (!changed) return false;
    batches = nextBatches;
    return true;
  }

  function update() {
    if (typeof isOptimismEnabled === "function" && !isOptimismEnabled()) {
      clear("optimismDisabled");
      return;
    }
    if (pruneExpiredBatches()) {
      rebuild();
      bump();
    }
  }

  function recordScheduledBatch(scheduleResult) {
    if (scheduleResult?.ok !== true || scheduleResult?.scheduled !== true) {
      lastIgnoredRecordSummary = summarizeScheduleResult(scheduleResult);
      return scheduleResult;
    }
    const rawActions = Array.isArray(scheduleResult?.actions)
      ? scheduleResult.actions
      : [];
    if (!rawActions.length) {
      lastIgnoredRecordSummary = summarizeScheduleResult(scheduleResult);
      return scheduleResult;
    }

    batches.push({
      id: nextBatchId,
      tSec: Math.max(0, Math.floor(scheduleResult.tSec ?? 0)),
      actions: rawActions.map((action) => cloneAction(action)).filter(Boolean),
    });
    lastRecordSummary = summarizeScheduleResult(scheduleResult);
    nextBatchId += 1;
    rebuild();
    bump();
    return scheduleResult;
  }

  function handleInvalidate(reason) {
    lastInvalidateReason = reason ?? null;
    if (
      reason === "actionScheduled" ||
      reason === "playbackApply" ||
      (typeof reason === "string" && reason.startsWith("planner:"))
    ) {
      update();
      return;
    }
    clear(reason || "invalidate");
  }

  return {
    recordScheduledBatch,
    handleInvalidate,
    update,
    clear,
    getVersion: () => version,
    getInventoryPreview(ownerId) {
      return previewByOwner.get(ownerId) || createEmptyInventoryPreview();
    },
    getPawnOverridePlacement(pawnId) {
      return pawnOverrides.get(pawnId) ?? null;
    },
    getTilePlanPreview(envCol) {
      if (!Number.isFinite(envCol)) return null;
      return tilePlanByEnvCol.get(Math.floor(envCol)) ?? null;
    },
    getHubPlanPreview(hubCol) {
      if (!Number.isFinite(hubCol)) return null;
      return hubPlanByHubCol.get(Math.floor(hubCol)) ?? null;
    },
    getPendingActionRowSpecs() {
      return pendingActionRowSpecs.slice();
    },
    getDebugState() {
      return {
        version,
        batchCount: batches.length,
        batchTSecs: batches.map((batch) => batch.tSec),
        lastRecordSummary,
        lastIgnoredRecordSummary,
        lastInvalidateReason,
        lastClearReason,
      };
    },
  };
}
