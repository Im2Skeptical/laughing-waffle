// scroll-graph-orchestrator.js

import {
  SCROLL_GRAPH_SUBJECT_DEFS,
  SCROLL_GRAPH_SUBJECT_IDS,
  SCROLL_GRAPH_TYPE_DEFS,
} from "../../defs/gamepieces/scroll-timegraph-defs.js";

function toSafeSec(value, fallback = 0) {
  if (!Number.isFinite(value)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(value));
}

function getScrollGraphState(item) {
  const graphState = item?.systemState?.timegraph;
  if (!graphState || typeof graphState !== "object") return null;

  const typeId =
    typeof graphState.scrollType === "string" ? graphState.scrollType : null;
  const subjectId =
    typeof graphState.subject === "string" ? graphState.subject : null;
  if (!SCROLL_GRAPH_TYPE_DEFS[typeId]) return null;
  if (!SCROLL_GRAPH_SUBJECT_DEFS[subjectId]) return null;

  const horizonSec = toSafeSec(graphState.horizonSec, 120);
  const historyWindowSec = toSafeSec(graphState.historyWindowSec, 120);
  const manufacturedSec = Number.isFinite(graphState.manufacturedSec)
    ? toSafeSec(graphState.manufacturedSec, 0)
    : null;

  return {
    typeId,
    subjectId,
    windowMode:
      typeof graphState.windowMode === "string"
        ? graphState.windowMode
        : SCROLL_GRAPH_TYPE_DEFS[typeId].windowMode,
    editable:
      typeof graphState.editable === "boolean"
        ? graphState.editable
        : !!SCROLL_GRAPH_TYPE_DEFS[typeId].editable,
    frozen:
      typeof graphState.frozen === "boolean"
        ? graphState.frozen
        : !!SCROLL_GRAPH_TYPE_DEFS[typeId].frozen,
    requiresManufacturedSec:
      graphState.requiresManufacturedSec === true ||
      SCROLL_GRAPH_TYPE_DEFS[typeId].requiresManufacturedSec === true,
    horizonSec,
    historyWindowSec,
    manufacturedSec,
  };
}

function resolveWindowSpecForScroll(runner, scrollState) {
  const timeline = runner.getTimeline?.();
  const cursorState = runner.getCursorState?.();
  const historyEndSec = toSafeSec(timeline?.historyEndSec, 0);
  const cursorSec = toSafeSec(cursorState?.tSec, historyEndSec);
  const editableBounds = runner.getEditableHistoryBounds?.();
  const minEditableSec = toSafeSec(editableBounds?.minEditableSec, 0);

  const anchorSec = Number.isFinite(scrollState.manufacturedSec)
    ? toSafeSec(scrollState.manufacturedSec, historyEndSec)
    : historyEndSec;

  if (scrollState.windowMode === "future") {
    const minSec = anchorSec;
    const maxSec = anchorSec + scrollState.horizonSec;
    return { minSec, maxSec, scrubSec: cursorSec };
  }

  if (scrollState.windowMode === "historyWindow") {
    const maxSec = anchorSec;
    const minSec = Math.max(0, anchorSec - scrollState.historyWindowSec);
    return { minSec, maxSec, scrubSec: maxSec };
  }

  if (scrollState.windowMode === "fullHistory") {
    const maxSec = Math.max(historyEndSec, cursorSec);
    return { minSec: 0, maxSec, scrubSec: cursorSec };
  }

  if (scrollState.windowMode === "rollingEditable") {
    const maxSec = historyEndSec;
    const rollingMin = Math.max(0, maxSec - scrollState.historyWindowSec);
    const minSec = Math.max(minEditableSec, rollingMin);
    return {
      minSec,
      maxSec: Math.max(minSec + 1, maxSec),
      scrubSec: Math.max(minSec, Math.min(cursorSec, maxSec)),
    };
  }

  const liveMax = Math.max(historyEndSec, cursorSec);
  return { minSec: 0, maxSec: Math.max(1, liveMax), scrubSec: cursorSec };
}

function resolveCommitPolicy(runner, scrollState, commitSpec) {
  if (!scrollState.editable) {
    return { allow: false, reason: "Read-only scroll" };
  }

  const scrubSec = toSafeSec(commitSpec?.scrubSec, 0);
  const historyEndSec = toSafeSec(commitSpec?.historyEndSec, 0);
  const bounds = runner.getEditableHistoryBounds?.();
  const minEditableSec = toSafeSec(bounds?.minEditableSec, 0);

  if (scrubSec > historyEndSec) {
    return { allow: false, reason: "Forecast is preview-only" };
  }
  if (scrubSec < minEditableSec) {
    return { allow: false, reason: "Outside editable history window" };
  }
  return { allow: true };
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
}

function clearScrollConfigFromView(view) {
  view.setWindowSpecResolver?.(null);
  view.setCommitPolicyResolver?.(null);
  view.setSeriesValueOverrideResolver?.(null);
}

export function createScrollGraphOrchestrator({
  runner,
  metricViewsBySubject,
  metricControllersBySubject,
  systemGraphView,
  toggleSystemGraph,
}) {
  const metricViews = metricViewsBySubject || {};
  const metricControllers = metricControllersBySubject || {};
  const frozenSeriesByItemId = new Map();
  let openSession = null;

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
      clearScrollConfigFromView(view);
      if (view.isOpen?.()) view.close();
    }
  }

  function closeSystemGraph() {
    if (systemGraphView?.isOpen?.()) {
      systemGraphView.close();
    }
  }

  function closeAllGraphs() {
    closeMetricGraphs();
    closeSystemGraph();
    openSession = null;
  }

  function openSystemsGraph(itemId) {
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
      clearScrollConfigFromView(view);
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

    const scrollState = getScrollGraphState(item);
    if (!scrollState) {
      return { handled: false, reason: "notScrollGraphItem" };
    }

    if (scrollState.subjectId === "systems") {
      return openSystemsGraph(itemId);
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
