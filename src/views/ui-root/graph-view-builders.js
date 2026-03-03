// src/views/ui-root/graph-view-builders.js
import { VIEW_LAYOUT } from "../layout-pixi.js";

export function createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer,
  controller,
  runner,
  interaction = null,
  tooltipView = null,
  openPosition,
  metric = null,
  getMetricDef = null,
  getSeriesValueOverride = null,
  getEventMarkers = null,
  getEditableHistoryBounds = null,
  historyWindowSec = undefined,
  getSystemTargetModeLabel = null,
  onToggleSystemTargetMode = null,
}) {
  const metricId =
    typeof metric === "string" ? metric : typeof metric?.id === "string" ? metric.id : null;
  const fallbackOpenPosition =
    (metricId && VIEW_LAYOUT.graphs?.[metricId]) || VIEW_LAYOUT.graphs.gold;

  const options = {
    app,
    layer,
    controller,
    interaction,
    tooltipView,
    getTimeline: () => runner.getTimeline(),
    getCursorState: () => runner.getCursorState(),
    getPreviewStatus: () => runner.getPreviewStatus?.(),
    getEditableHistoryBounds: () => runner.getEditableHistoryBounds?.(),
    setPreviewState: (s) => runner.setPreviewState(s),
    clearPreviewState: () => runner.clearPreviewState(),
    commitSecond: (t, stateData) => runner.commitCursorSecond(t, stateData),
    openPosition: openPosition || fallbackOpenPosition,
  };

  if (metric) options.metric = metric;
  if (typeof getMetricDef === "function") options.getMetricDef = getMetricDef;
  if (typeof getSeriesValueOverride === "function") {
    options.getSeriesValueOverride = getSeriesValueOverride;
  }
  if (typeof getEventMarkers === "function") {
    options.getEventMarkers = getEventMarkers;
  }
  if (typeof getEditableHistoryBounds === "function") {
    options.getEditableHistoryBounds = getEditableHistoryBounds;
  }
  if (Number.isFinite(historyWindowSec) && historyWindowSec > 0) {
    options.historyWindowSec = historyWindowSec;
  }
  if (typeof getSystemTargetModeLabel === "function") {
    options.getSystemTargetModeLabel = getSystemTargetModeLabel;
  }
  if (typeof onToggleSystemTargetMode === "function") {
    options.onToggleSystemTargetMode = onToggleSystemTargetMode;
  }

  return createMetricGraphView(options);
}
