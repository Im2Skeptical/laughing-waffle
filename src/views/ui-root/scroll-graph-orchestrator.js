// scroll-graph-orchestrator.js

import {
  SCROLL_GRAPH_SUBJECT_IDS,
} from "../../defs/gamepieces/scroll-timegraph-defs.js";
import {
  computeHistoryZoneSegments,
  computeScrollCommitDecision,
  computeScrollWindowSpec,
  getAbsoluteEditableRangeFromScrollState,
  getScrollTimegraphStateFromItem,
  toSafeSec,
} from "../../model/timegraph/edit-policy.js";

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

function resolveHistoryZoneSegmentsForScroll(runner, scrollState, zoneSpec) {
  const minSec = toSafeSec(zoneSpec?.minSec, 0);
  const maxSec = toSafeSec(zoneSpec?.maxSec, minSec);
  const historyEndSec = toSafeSec(zoneSpec?.historyEndSec, 0);
  const editableBounds = runner.getEditableHistoryBounds?.();
  const baseMinEditableSec = toSafeSec(editableBounds?.minEditableSec, 0);

  const absoluteRange = getAbsoluteEditableRangeFromScrollState(scrollState);
  const extraEditableRanges = absoluteRange ? [absoluteRange] : [];

  return computeHistoryZoneSegments({
    minSec,
    maxSec,
    historyEndSec,
    baseMinEditableSec,
    extraEditableRanges,
  });
}

function applyScrollConfigToView(runner, view, scrollState, fixedWindowSpec = null) {
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
    resolveHistoryZoneSegmentsForScroll(runner, scrollState, zoneSpec)
  );
}

function clearScrollConfigFromView(view) {
  view.setWindowSpecResolver?.(null);
  view.setCommitPolicyResolver?.(null);
  view.setHistoryZoneResolver?.(null);
  view.setSeriesValueOverrideResolver?.(null);
}

export function createScrollGraphOrchestrator({
  runner,
  metricViewsBySubject,
  metricControllersBySubject,
  systemGraphView,
  systemGraphController,
  toggleSystemGraph,
}) {
  const metricViews = metricViewsBySubject || {};
  const metricControllers = metricControllersBySubject || {};
  const frozenSeriesByItemId = new Map();
  let openSession = null;

  function clearScrollConfigForMetric(subjectId) {
    const view = metricViews[subjectId];
    if (view) clearScrollConfigFromView(view);
    const controller = metricControllers[subjectId];
    controller?.setHorizonSecOverride?.(null);
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

  function closeMetricGraphs() {
    for (const subjectId of SCROLL_GRAPH_SUBJECT_IDS) {
      if (subjectId === "systems") continue;
      const view = metricViews[subjectId];
      if (!view) continue;
      clearScrollConfigForMetric(subjectId);
      if (view.isOpen?.()) view.close();
    }
  }

  function closeSystemGraph() {
    clearScrollConfigFromView(systemGraphView);
    systemGraphController?.setHorizonSecOverride?.(null);
    if (systemGraphView?.isOpen?.()) {
      systemGraphView.close();
    }
  }

  function closeAllGraphs() {
    closeMetricGraphs();
    closeSystemGraph();
    openSession = null;
  }

  function openSystemsGraph(itemId, scrollState = null) {
    const activeSameItem =
      openSession &&
      openSession.kind === "systems" &&
      openSession.itemId === itemId &&
      systemGraphView?.isOpen?.();

    if (activeSameItem) {
      closeSystemGraph();
      openSession = null;
      return { handled: true, action: "closed", kind: "systems" };
    }

    closeMetricGraphs();
    if (!systemGraphView) return { handled: false, reason: "noSystemGraphView" };

    const controllerHorizonSec = resolveControllerHorizonOverride(scrollState);
    systemGraphController?.setHorizonSecOverride?.(controllerHorizonSec);
    let fixedWindowSpec = null;
    if (scrollState?.frozen) {
      const baseWindow = resolveWindowSpecForScroll(runner, scrollState);
      fixedWindowSpec = {
        minSec: toSafeSec(baseWindow?.minSec, 0),
        maxSec: toSafeSec(baseWindow?.maxSec, 1),
        scrubSec: toSafeSec(baseWindow?.scrubSec, baseWindow?.maxSec ?? 0),
      };
    }
    applyScrollConfigToView(
      runner,
      systemGraphView,
      scrollState || {
        editable: false,
        windowMode: "fullHistory",
        horizonSec: controllerHorizonSec ?? 0,
        historyWindowSec: controllerHorizonSec ?? 0,
      },
      fixedWindowSpec
    );

    if (typeof toggleSystemGraph === "function") {
      const result = toggleSystemGraph();
      if (result?.ok === false) return { handled: false, reason: result.reason };
      const opened = systemGraphView.isOpen?.() === true;
      openSession = opened
        ? { kind: "systems", itemId }
        : null;
      return {
        handled: true,
        action: opened ? "opened" : "closed",
        kind: "systems",
      };
    }

    if (systemGraphView.isOpen?.()) {
      systemGraphView.close();
      openSession = null;
      return { handled: true, action: "closed", kind: "systems" };
    }

    systemGraphView.open?.();
    openSession = { kind: "systems", itemId };
    return { handled: true, action: "opened", kind: "systems" };
  }

  function openMetricGraphForScroll(itemId, scrollState) {
    const view = metricViews[scrollState.subjectId];
    const controller = metricControllers[scrollState.subjectId];
    if (!view) {
      return {
        handled: false,
        reason: `missingMetricView:${scrollState.subjectId}`,
      };
    }

    const activeSameItem =
      openSession &&
      openSession.kind === "metric" &&
      openSession.itemId === itemId &&
      openSession.subjectId === scrollState.subjectId &&
      view.isOpen?.();

    if (activeSameItem) {
      clearScrollConfigForMetric(scrollState.subjectId);
      view.close?.();
      openSession = null;
      return {
        handled: true,
        action: "closed",
        kind: "metric",
        subjectId: scrollState.subjectId,
      };
    }

    closeMetricGraphs();
    closeSystemGraph();

    let fixedWindowSpec = null;
    const controllerHorizonSec = resolveControllerHorizonOverride(scrollState);
    controller?.setHorizonSecOverride?.(controllerHorizonSec);
    if (scrollState.frozen) {
      const baseWindow = resolveWindowSpecForScroll(runner, scrollState);
      fixedWindowSpec = {
        minSec: toSafeSec(baseWindow?.minSec, 0),
        maxSec: toSafeSec(baseWindow?.maxSec, 1),
        scrubSec: toSafeSec(baseWindow?.scrubSec, baseWindow?.maxSec ?? 0),
      };
      let snapshot = frozenSeriesByItemId.get(itemId) ?? null;
      if (!snapshot) {
        const built = buildFrozenSeriesSnapshot(
          controller,
          fixedWindowSpec.minSec,
          fixedWindowSpec.maxSec
        );
        if (built) {
          snapshot = built;
          frozenSeriesByItemId.set(itemId, built);
        }
      }
      if (snapshot?.valuesBySec instanceof Map) {
        view.setSeriesValueOverrideResolver?.((tSec, seriesId) => {
          const sec = toSafeSec(tSec, tSec);
          const values = snapshot.valuesBySec.get(sec);
          if (!values || typeof values !== "object") return null;
          const nextValue = values[seriesId];
          return Number.isFinite(nextValue) ? nextValue : null;
        });
      }
    } else {
      view.setSeriesValueOverrideResolver?.(null);
    }

    applyScrollConfigToView(runner, view, scrollState, fixedWindowSpec);
    runner.clearPreviewState?.();
    view.open?.();

    openSession = {
      kind: "metric",
      itemId,
      subjectId: scrollState.subjectId,
    };
    return {
      handled: true,
      action: "opened",
      kind: "metric",
      subjectId: scrollState.subjectId,
    };
  }

  function handleUseItem({ item }) {
    const itemId = item?.id;
    if (!Number.isFinite(itemId)) {
      return { handled: false, reason: "missingItemId" };
    }

    const scrollState = getScrollTimegraphStateFromItem(item);
    if (!scrollState) {
      return { handled: false, reason: "notScrollGraphItem" };
    }

    if (scrollState.subjectId === "systems") {
      return openSystemsGraph(itemId, scrollState);
    }

    return openMetricGraphForScroll(itemId, scrollState);
  }

  function update() {
    if (!openSession) return;
    if (openSession.kind === "systems") {
      if (!systemGraphView?.isOpen?.()) {
        openSession = null;
      }
      return;
    }

    const view = metricViews[openSession.subjectId];
    if (!view || !view.isOpen?.()) {
      openSession = null;
    }
  }

  return {
    handleUseItem,
    update,
    closeAllGraphs,
  };
}
