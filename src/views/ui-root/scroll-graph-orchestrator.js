// scroll-graph-orchestrator.js

import {
  computeHistoryZoneSegments,
  computeScrollCommitDecision,
  computeScrollWindowSpec,
  getAbsoluteEditableRangeFromScrollState,
  getScrollTimegraphStateFromItem,
  toSafeSec,
} from "../../model/timegraph/edit-policy.js";
import { createLeaderFaithMarkerResolver } from "./leader-faith-marker-resolver.js";

const DEFAULT_SCROLL_WINDOW_BASE_POSITION = Object.freeze({
  x: 1212,
  y: 120,
});
const SCROLL_WINDOW_CASCADE_STEP_PX = 28;
const SCROLL_WINDOW_WIDTH_PX = 1200;
const SCROLL_WINDOW_HEIGHT_PX = 176;
const SCROLL_STAGE_WIDTH_PX = 2424;
const SCROLL_STAGE_HEIGHT_PX = 1080;
const SCROLL_WINDOW_MARGIN_PX = 8;
const ACTION_KIND_INVENTORY_USE_ITEM = "inventoryUseItem";

function resolveWindowSpecForScroll(runner, scrollState) {
  const timeline = runner.getTimeline?.();
  const cursorState = runner.getCursorState?.();
  const historyEndSec = toSafeSec(timeline?.historyEndSec, 0);
  const cursorSec = toSafeSec(cursorState?.tSec, historyEndSec);
  const editableBounds = runner.getEditableHistoryBounds?.();
  const minEditableSec = toSafeSec(editableBounds?.minEditableSec, 0);
  return computeScrollWindowSpec({
    scrollState,
    historyEndSec,
    cursorSec,
    minEditableSec,
  });
}

function resolveCommitPolicy(runner, scrollState, commitSpec) {
  const scrubSec = toSafeSec(commitSpec?.scrubSec, 0);
  const historyEndSec = toSafeSec(commitSpec?.historyEndSec, 0);
  const bounds = runner.getEditableHistoryBounds?.();
  const minEditableSec = toSafeSec(bounds?.minEditableSec, 0);
  return computeScrollCommitDecision({
    scrollState,
    scrubSec,
    historyEndSec,
    minEditableSec,
  });
}

function resolveControllerHorizonOverride(scrollState) {
  if (!scrollState || typeof scrollState !== "object") return null;
  if (
    scrollState.editableRangeMode === "absolute" &&
    Number.isFinite(scrollState.editableRangeEndSec)
  ) {
    return toSafeSec(scrollState.horizonSec, 0);
  }
  if (scrollState.windowMode === "future") {
    return toSafeSec(scrollState.horizonSec, 0);
  }
  if (
    scrollState.windowMode === "historyWindow" ||
    scrollState.windowMode === "rollingEditable"
  ) {
    return toSafeSec(scrollState.historyWindowSec, 0);
  }
  return null;
}

function resolveHistoryZoneSegmentsForScroll(
  runner,
  scrollState,
  zoneSpec,
  itemUnavailableStartSec = null
) {
  const minSec = toSafeSec(zoneSpec?.minSec, 0);
  const maxSec = toSafeSec(zoneSpec?.maxSec, minSec);
  const historyEndSec = toSafeSec(zoneSpec?.historyEndSec, 0);
  const editableBounds = runner.getEditableHistoryBounds?.();
  const baseMinEditableSec = toSafeSec(editableBounds?.minEditableSec, 0);

  const absoluteRange = getAbsoluteEditableRangeFromScrollState(scrollState);
  const extraEditableRanges = absoluteRange ? [absoluteRange] : [];

  const segments = computeHistoryZoneSegments({
    minSec,
    maxSec,
    historyEndSec,
    baseMinEditableSec,
    extraEditableRanges,
  });

  if (!Number.isFinite(itemUnavailableStartSec)) {
    return segments;
  }
  const unavailableStartSec = Math.max(
    minSec,
    toSafeSec(itemUnavailableStartSec, minSec)
  );
  if (unavailableStartSec >= maxSec) {
    return segments;
  }
  return [
    ...segments,
    {
      kind: "itemUnavailable",
      startSec: unavailableStartSec,
      endSec: maxSec,
    },
  ];
}

function applyScrollConfigToView(
  runner,
  view,
  scrollState,
  fixedWindowSpec = null,
  getItemUnavailableStartSec = null
) {
  if (fixedWindowSpec) {
    view.setWindowSpecResolver?.(() => fixedWindowSpec);
  } else {
    view.setWindowSpecResolver?.(() =>
      resolveWindowSpecForScroll(runner, scrollState)
    );
  }
  view.setCommitPolicyResolver?.((commitSpec) =>
    resolveCommitPolicy(runner, scrollState, commitSpec)
  );
  view.setHistoryZoneResolver?.((zoneSpec) =>
    resolveHistoryZoneSegmentsForScroll(
      runner,
      scrollState,
      zoneSpec,
      typeof getItemUnavailableStartSec === "function"
        ? getItemUnavailableStartSec()
        : null
    )
  );
}

function clearScrollConfigFromView(view) {
  view.setWindowSpecResolver?.(null);
  view.setCommitPolicyResolver?.(null);
  view.setHistoryZoneResolver?.(null);
  view.setSeriesValueOverrideResolver?.(null);
  view.setEventMarkerResolver?.(null);
}

function isFrozenStaticScrollRecord(record) {
  return !!(
    record &&
    record.subjectId !== "systems" &&
    record.scrollState?.frozen === true
  );
}

function normalizeScrollWindowBasePosition(scrollWindowBasePosition) {
  const x = Number.isFinite(scrollWindowBasePosition?.x)
    ? Math.floor(scrollWindowBasePosition.x)
    : DEFAULT_SCROLL_WINDOW_BASE_POSITION.x;
  const y = Number.isFinite(scrollWindowBasePosition?.y)
    ? Math.floor(scrollWindowBasePosition.y)
    : DEFAULT_SCROLL_WINDOW_BASE_POSITION.y;
  return { x, y };
}

function resolveWindowPositionFromSequence(basePosition, sequence) {
  const safeSeq = Number.isFinite(sequence) ? Math.max(1, Math.floor(sequence)) : 1;
  const offset = (safeSeq - 1) * SCROLL_WINDOW_CASCADE_STEP_PX;
  const centeredBaseX = Math.floor(basePosition.x - SCROLL_WINDOW_WIDTH_PX * 0.5);
  const rawX = centeredBaseX + offset;
  const rawY = basePosition.y + offset;
  const minX = SCROLL_WINDOW_MARGIN_PX;
  const minY = SCROLL_WINDOW_MARGIN_PX;
  const maxX = Math.max(
    minX,
    SCROLL_STAGE_WIDTH_PX - SCROLL_WINDOW_WIDTH_PX - SCROLL_WINDOW_MARGIN_PX
  );
  const maxY = Math.max(
    minY,
    SCROLL_STAGE_HEIGHT_PX - SCROLL_WINDOW_HEIGHT_PX - SCROLL_WINDOW_MARGIN_PX
  );
  return {
    x: Math.max(minX, Math.min(maxX, rawX)),
    y: Math.max(minY, Math.min(maxY, rawY)),
  };
}

function buildFrozenSeriesSnapshot(controller, minSec, maxSec) {
  if (!controller || typeof controller.getSeriesValuesForSeconds !== "function") {
    return null;
  }
  controller.ensureCache?.();
  const startSec = toSafeSec(minSec, 0);
  const endSec = toSafeSec(maxSec, startSec);
  if (endSec < startSec) return null;
  const seconds = [];
  for (let sec = startSec; sec <= endSec; sec += 1) {
    seconds.push(sec);
  }
  const valuesBySec =
    controller.getSeriesValuesForSeconds(seconds, { focus: false }) ?? null;
  if (!(valuesBySec instanceof Map)) return null;
  return {
    minSec: startSec,
    maxSec: endSec,
    valuesBySec,
  };
}

function findItemUseSecondInTimeline(timeline, itemId) {
  if (!Number.isFinite(itemId)) return null;
  const targetItemId = Math.floor(itemId);
  const actions = Array.isArray(timeline?.actions) ? timeline.actions : [];
  let earliest = null;
  for (const action of actions) {
    if (action?.kind !== ACTION_KIND_INVENTORY_USE_ITEM) continue;
    const payloadItemId = Number.isFinite(action?.payload?.itemId)
      ? Math.floor(action.payload.itemId)
      : null;
    if (payloadItemId !== targetItemId) continue;
    const tSec = Number.isFinite(action?.tSec) ? Math.floor(action.tSec) : null;
    if (tSec == null) continue;
    if (earliest == null || tSec < earliest) {
      earliest = tSec;
    }
  }
  return earliest;
}

function parseSnapshotStateData(stateData) {
  if (!stateData) return null;
  if (typeof stateData === "object") return stateData;
  if (typeof stateData !== "string") return null;
  try {
    return JSON.parse(stateData);
  } catch (_) {
    return null;
  }
}

function snapshotContainsItemById(snapshot, itemId) {
  const targetId = Number.isFinite(itemId) ? Math.floor(itemId) : null;
  if (!snapshot || targetId == null) return false;

  const ownerInventories = snapshot?.ownerInventories;
  if (ownerInventories && typeof ownerInventories === "object") {
    for (const inv of Object.values(ownerInventories)) {
      if (!inv || !Array.isArray(inv.items)) continue;
      const item =
        inv.itemsById?.[targetId] ??
        inv.items.find((candidate) => {
          const id = Number.isFinite(candidate?.id) ? Math.floor(candidate.id) : null;
          return id === targetId;
        });
      if (item) return true;
    }
  }

  const pawns = Array.isArray(snapshot?.pawns) ? snapshot.pawns : [];
  for (const pawn of pawns) {
    const equipment =
      pawn?.equipment && typeof pawn.equipment === "object"
        ? pawn.equipment
        : null;
    if (!equipment) continue;
    for (const item of Object.values(equipment)) {
      const id = Number.isFinite(item?.id) ? Math.floor(item.id) : null;
      if (id === targetId) return true;
    }
  }

  return false;
}

export function createScrollGraphOrchestrator({
  runner,
  interactionController,
  createMetricController,
  createSystemGraphModel,
  forecastWorkerService = null,
  buildGraphView,
  scrollWindowBasePosition = null,
  onBeforeOpenGraphItem = null,
}) {
  const windowsByItemId = new Map();
  const basePosition = normalizeScrollWindowBasePosition(scrollWindowBasePosition);
  let nextOpenSequence = 0;

  function normalizeItemId(itemId) {
    return Number.isFinite(itemId) ? Math.floor(itemId) : null;
  }

  function resolveItemUnavailableStartSec(record, state, liveItem) {
    const persisted =
      Number.isFinite(record?.itemUnavailableStartSec)
        ? toSafeSec(record.itemUnavailableStartSec, 0)
        : null;
    if (liveItem) return persisted;

    const runStatus =
      state?.runStatus && typeof state.runStatus === "object"
        ? state.runStatus
        : null;
    const runCompleteSec =
      runStatus?.complete === true && Number.isFinite(runStatus?.tSec)
        ? toSafeSec(runStatus.tSec, 0)
        : null;
    if (runCompleteSec != null) return runCompleteSec;

    const usedSec = findItemUseSecondInTimeline(runner.getTimeline?.(), record?.itemId);
    if (usedSec != null) return toSafeSec(usedSec, 0);

    return persisted;
  }

  function resolveItemUnavailableStartSecFromSnapshots(record) {
    if (!record || !record.controller) return null;

    const baseWindow = resolveWindowSpecForScroll(runner, record.scrollState);
    const minSec = toSafeSec(baseWindow?.minSec, 0);
    const maxWindowSec = toSafeSec(baseWindow?.maxSec, minSec);
    const historyEndSec = toSafeSec(runner.getTimeline?.()?.historyEndSec, maxWindowSec);
    const maxSec = Math.max(maxWindowSec, historyEndSec);

    let seenPresent = false;
    for (let sec = minSec; sec <= maxSec; sec += 1) {
      const stateData = record.controller.getStateDataAt?.(sec);
      if (!stateData) continue;
      const snapshot = parseSnapshotStateData(stateData);
      if (!snapshot) continue;
      const hasItem = snapshotContainsItemById(snapshot, record.itemId);
      if (hasItem) {
        seenPresent = true;
        continue;
      }
      if (seenPresent) {
        return sec;
      }
    }
    return null;
  }

  function findItemByIdInState(state, itemId) {
    const targetId = normalizeItemId(itemId);
    if (targetId == null) return null;

    const ownerInventories = state?.ownerInventories;
    if (ownerInventories && typeof ownerInventories === "object") {
      for (const inv of Object.values(ownerInventories)) {
        if (!inv || !Array.isArray(inv.items)) continue;
        const item =
          inv.itemsById?.[targetId] ??
          inv.items.find((candidate) => normalizeItemId(candidate?.id) === targetId);
        if (item) return item;
      }
    }

    const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
    for (const pawn of pawns) {
      const equipment =
        pawn?.equipment && typeof pawn.equipment === "object" ? pawn.equipment : null;
      if (!equipment) continue;
      for (const item of Object.values(equipment)) {
        if (normalizeItemId(item?.id) === targetId) return item;
      }
    }

    return null;
  }

  function destroyWindowRecord(record) {
    if (!record) return;
    record.controller?.setActive?.(false);
    record.controller?.setHorizonSecOverride?.(null);
    clearScrollConfigFromView(record.view);
    record.view?.close?.();
    record.view?.destroy?.();
  }

  function applyRecordPolicy(record) {
    if (!record) return;
    const controllerHorizonSec = resolveControllerHorizonOverride(record.scrollState);
    record.controller?.setHorizonSecOverride?.(controllerHorizonSec);

    let fixedWindowSpec = null;
    if (record.scrollState?.frozen) {
      const baseWindow = resolveWindowSpecForScroll(runner, record.scrollState);
      fixedWindowSpec = {
        minSec: toSafeSec(baseWindow?.minSec, 0),
        maxSec: toSafeSec(baseWindow?.maxSec, 1),
        scrubSec: toSafeSec(baseWindow?.scrubSec, baseWindow?.maxSec ?? 0),
      };
    }

    if (record.subjectId !== "systems" && record.scrollState?.frozen) {
      let snapshot = record.frozenSnapshot;
      if (!snapshot) {
        snapshot = buildFrozenSeriesSnapshot(
          record.controller,
          fixedWindowSpec?.minSec ?? 0,
          fixedWindowSpec?.maxSec ?? 0
        );
        record.frozenSnapshot = snapshot;
      }
      if (snapshot?.valuesBySec instanceof Map) {
        record.view.setSeriesValueOverrideResolver?.((tSec, seriesId) => {
          const sec = toSafeSec(tSec, tSec);
          const values = snapshot.valuesBySec.get(sec);
          if (!values || typeof values !== "object") return null;
          const nextValue = values[seriesId];
          return Number.isFinite(nextValue) ? nextValue : null;
        });
      }
    } else {
      record.view.setSeriesValueOverrideResolver?.(null);
    }

    applyScrollConfigToView(
      runner,
      record.view,
      record.scrollState,
      fixedWindowSpec,
      () => record.itemUnavailableStartSec
    );
  }

  function createWindowRecord({ itemId, ownerIdAtOpen, scrollState }) {
    if (!Number.isFinite(itemId)) return null;
    if (!scrollState || typeof scrollState !== "object") return null;
    if (typeof buildGraphView !== "function") return null;
    if (typeof createMetricController !== "function") return null;
    if (typeof createSystemGraphModel !== "function") return null;

    const subjectId = scrollState.subjectId;
    let systemModel = null;
    let controller = null;
    let metric = null;
    let getMetricDef = null;

    if (subjectId === "systems") {
      systemModel = createSystemGraphModel({
        interactionController,
        runner,
        createController: createMetricController,
        forecastWorkerService,
      });
      controller = systemModel?.controller ?? null;
      getMetricDef = () => controller?.getData?.().metric;
    } else {
      metric =
        typeof scrollState.metricId === "string" && scrollState.metricId.length > 0
          ? scrollState.metricId
          : typeof subjectId === "string" && subjectId.length > 0
            ? subjectId
            : null;
      if (!metric) return null;
      controller = createMetricController({
        getTimeline: () => runner.getTimeline(),
        getCursorState: () => runner.getCursorState(),
        metric,
        forecastWorkerService,
      });
    }
    if (!controller) return null;

    nextOpenSequence += 1;
    const windowPosition = resolveWindowPositionFromSequence(
      basePosition,
      nextOpenSequence
    );
    const view = buildGraphView({
      controller,
      metric,
      getMetricDef,
      openPosition: windowPosition,
    });
    if (!view) return null;

    const mode =
      scrollState.systemTargetModeOnOpen === "inventoryOwnerLocked"
        ? "ownerLocked"
        : "hover";

    return {
      itemId,
      ownerIdAtOpen,
      subjectId,
      scrollState,
      itemUnavailableStartSec: null,
      mode,
      openedAtSeq: nextOpenSequence,
      controller,
      view,
      systemModel,
      lockedTarget: null,
      frozenSnapshot: null,
    };
  }

  function applyRecordEventMarkers(record) {
    if (!record?.view) return;
    const lockedTarget = record.lockedTarget;
    const ownerPawnId = Number.isFinite(lockedTarget?.id)
      ? Math.floor(lockedTarget.id)
      : null;
    const shouldApplyLeaderFaithMarkers =
      record.subjectId === "systems" &&
      record.mode === "ownerLocked" &&
      record.scrollState?.eventMarkerModeOnOpen === "leaderFaith" &&
      lockedTarget?.kind === "pawn" &&
      ownerPawnId != null;

    if (!shouldApplyLeaderFaithMarkers) {
      record.view.setEventMarkerResolver?.(null);
      return;
    }

    const markerResolver = createLeaderFaithMarkerResolver({
      controller: record.controller,
      ownerPawnId,
    });
    record.view.setEventMarkerResolver?.(markerResolver);
  }

  function openWindowRecord(record) {
    if (!record) return { handled: false, reason: "noRecord" };
    applyRecordPolicy(record);

    if (record.subjectId === "systems") {
      if (record.mode === "ownerLocked") {
        const result = record.systemModel?.toggleGraphForOwner?.(
          record.view,
          record.ownerIdAtOpen,
          { forceOpen: true }
        );
        if (result?.ok === false) {
          return { handled: false, reason: result.reason || "ownerTargetNotFound" };
        }
        record.lockedTarget = result?.target ?? null;
        applyRecordEventMarkers(record);
      } else {
        const result = record.systemModel?.toggleGraphForHover?.(record.view, {
          forceOpen: true,
        });
        if (result?.ok === false) {
          return { handled: false, reason: result.reason || "openFailed" };
        }
        record.lockedTarget = null;
        applyRecordEventMarkers(record);
      }
      return { handled: true, action: "opened", kind: "systems" };
    }

    record.view.open?.();
    return { handled: true, action: "opened", kind: "metric", subjectId: record.subjectId };
  }

  function handleUseItem({ item, ownerId } = {}) {
    const itemId = item?.id;
    if (!Number.isFinite(itemId)) {
      return { handled: false, reason: "missingItemId" };
    }

    const existing = windowsByItemId.get(itemId);
    if (existing) {
      if (existing.view?.isOpen?.() !== true) {
        destroyWindowRecord(existing);
        windowsByItemId.delete(itemId);
      } else {
        destroyWindowRecord(existing);
        windowsByItemId.delete(itemId);
        return {
          handled: true,
          action: "closed",
          kind: existing.subjectId || "scroll",
        };
      }
    }

    const scrollState = getScrollTimegraphStateFromItem(item);
    if (!scrollState) {
      return { handled: false, reason: "notScrollGraphItem" };
    }

    if (typeof onBeforeOpenGraphItem === "function") {
      const beforeOpenResult = onBeforeOpenGraphItem({
        ownerId: ownerId ?? null,
        itemId,
        itemKind: typeof item?.kind === "string" ? item.kind : null,
      });
      if (beforeOpenResult?.ok === false) {
        return {
          handled: false,
          reason: beforeOpenResult.reason || "beforeOpenGraphItemFailed",
        };
      }
    }

    const record = createWindowRecord({
      itemId,
      ownerIdAtOpen: ownerId ?? null,
      scrollState,
    });
    if (!record) {
      return { handled: false, reason: "failedToCreateScrollWindow" };
    }

    const openResult = openWindowRecord(record);
    if (openResult?.handled !== true) {
      destroyWindowRecord(record);
      return openResult;
    }

    runner.clearPreviewState?.();
    windowsByItemId.set(itemId, record);
    return openResult;
  }

  function handleInvalidate(reason) {
    for (const record of windowsByItemId.values()) {
      record.itemUnavailableStartSec = null;
      record.controller?.handleInvalidate?.(reason);
    }
  }

  function closeWindowForItemId(itemId) {
    const key = normalizeItemId(itemId);
    if (key == null) return false;
    const record = windowsByItemId.get(key);
    if (!record) return false;
    destroyWindowRecord(record);
    windowsByItemId.delete(key);
    return true;
  }

  function update(nowMs = performance.now()) {
    const closedItemIds = [];
    const state = runner.getState?.();

    for (const [itemId, record] of windowsByItemId.entries()) {
      const liveItem = findItemByIdInState(state, itemId);
      const liveScrollState = getScrollTimegraphStateFromItem(liveItem);
      if (liveScrollState) {
        record.scrollState = liveScrollState;
      } else if (!record.scrollState) {
        destroyWindowRecord(record);
        closedItemIds.push(itemId);
        continue;
      }
      record.itemUnavailableStartSec = resolveItemUnavailableStartSec(
        record,
        state,
        liveItem
      );

      const isOpen = record.view?.isOpen?.() === true;
      if (!isOpen) {
        destroyWindowRecord(record);
        closedItemIds.push(itemId);
        continue;
      }

      if (record.subjectId === "systems" && record.mode === "hover") {
        record.systemModel?.refreshTargetThrottled?.(nowMs);
      }

      const frozenStaticRecord = isFrozenStaticScrollRecord(record);
      record.controller?.setActive?.(!frozenStaticRecord);
      if (!frozenStaticRecord) {
        record.controller?.update?.();
      }
      if (!Number.isFinite(record.itemUnavailableStartSec) && !liveItem) {
        const inferredUnavailableSec =
          resolveItemUnavailableStartSecFromSnapshots(record);
        if (Number.isFinite(inferredUnavailableSec)) {
          record.itemUnavailableStartSec = toSafeSec(inferredUnavailableSec, 0);
        }
      }
      record.view?.render?.();
    }

    for (const itemId of closedItemIds) {
      windowsByItemId.delete(itemId);
    }
  }

  function closeAllGraphs() {
    for (const [itemId, record] of windowsByItemId.entries()) {
      destroyWindowRecord(record);
      windowsByItemId.delete(itemId);
    }
  }

  function getOccludingScreenRects() {
    const rects = [];
    for (const record of windowsByItemId.values()) {
      const rect = record?.view?.getScreenRect?.();
      if (rect) rects.push(rect);
    }
    return rects;
  }

  return {
    handleUseItem,
    handleInvalidate,
    update,
    closeWindowForItemId,
    closeAllGraphs,
    getOccludingScreenRects,
  };
}
