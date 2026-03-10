import {
  buildPreviewSnapshot,
  createEmptyInventoryPreview,
  isPreviewSnapshotReflectedInState,
} from "../../controllers/actionmanagers/action-preview-state.js";
import { buildActionRowSpecs } from "../../controllers/actionmanagers/action-log-controller.js";
import { projectActionsFromBoundaryStateData } from "../../model/action-preview-projection.js";

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

function sortBatches(left, right) {
  const secDelta = Math.floor(left?.tSec ?? 0) - Math.floor(right?.tSec ?? 0);
  if (secDelta !== 0) return secDelta;
  return Math.floor(left?.id ?? 0) - Math.floor(right?.id ?? 0);
}

function buildBatchSnapshot(getPreviewBoundaryStateData, batch) {
  if (typeof getPreviewBoundaryStateData !== "function" || !batch) return null;
  const boundaryRes = getPreviewBoundaryStateData(batch.tSec);
  if (!boundaryRes?.ok || boundaryRes?.stateData == null) return null;

  const projection = projectActionsFromBoundaryStateData({
    boundaryStateData: boundaryRes.stateData,
    actionsBySecond: [
      {
        tSec: Math.max(0, Math.floor(batch.tSec ?? 0)),
        actions: batch.actions,
      },
    ],
  });
  if (!projection?.ok) return null;

  return buildPreviewSnapshot({
    baselineState: projection.baselineState,
    projectedState: projection.projectedState,
    touchedTargets: projection.touchedTargets,
    actions: batch.actions,
    inventoryTransferGhostPreviewEnabled: true,
  });
}

export function createLiveActionOptimism({
  getState,
  getPreviewBoundaryStateData,
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
    const orderedBatches = batches.slice().sort(sortBatches);
    const orderedActions = orderedBatches.flatMap((batch) => batch.actions);

    previewByOwner = new Map();
    pawnOverrides = new Map();
    tilePlanByEnvCol = new Map();
    hubPlanByHubCol = new Map();

    if (orderedBatches.length > 0 && typeof getPreviewBoundaryStateData === "function") {
      const firstBatch = orderedBatches[0];
      const boundaryRes = getPreviewBoundaryStateData(firstBatch.tSec);
      if (boundaryRes?.ok && boundaryRes?.stateData != null) {
        const projection = projectActionsFromBoundaryStateData({
          boundaryStateData: boundaryRes.stateData,
          actionsBySecond: orderedActions,
        });
        if (projection?.ok) {
          const snapshot = buildPreviewSnapshot({
            baselineState: projection.baselineState,
            projectedState: projection.projectedState,
            touchedTargets: projection.touchedTargets,
            actions: orderedActions,
            inventoryTransferGhostPreviewEnabled: true,
          });
          previewByOwner = snapshot.previewByOwner;
          pawnOverrides = snapshot.pawnOverrides;
          tilePlanByEnvCol = snapshot.tilePlanByEnvCol;
          hubPlanByHubCol = snapshot.hubPlanByHubCol;
        }
      }
    }

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
      if (
        batch.tSec === currentSec &&
        isPreviewSnapshotReflectedInState(state, batch.snapshot)
      ) {
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

    const batch = {
      id: nextBatchId,
      tSec: Math.max(0, Math.floor(scheduleResult.tSec ?? 0)),
      actions: rawActions.map((action) => cloneAction(action)).filter(Boolean),
    };
    batch.snapshot = buildBatchSnapshot(getPreviewBoundaryStateData, batch);

    batches.push(batch);
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
