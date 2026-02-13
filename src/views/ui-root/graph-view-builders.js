// src/views/ui-root/graph-view-builders.js

export function createRunnerMetricGraph({
  createMetricGraphView,
  app,
  layer,
  controller,
  runner,
  openPosition,
  metric = null,
  getMetricDef = null,
  getSeriesValueOverride = null,
  historyWindowSec = undefined,
}) {
  const options = {
    app,
    layer,
    controller,
    getTimeline: () => runner.getTimeline(),
    getCursorState: () => runner.getCursorState(),
    setPreviewState: (s) => runner.setPreviewState(s),
    clearPreviewState: () => runner.clearPreviewState(),
    commitSecond: (t, stateData) => runner.commitCursorSecond(t, stateData),
    openPosition,
  };

  if (metric) options.metric = metric;
  if (typeof getMetricDef === "function") options.getMetricDef = getMetricDef;
  if (typeof getSeriesValueOverride === "function") {
    options.getSeriesValueOverride = getSeriesValueOverride;
  }
  if (Number.isFinite(historyWindowSec) && historyWindowSec > 0) {
    options.historyWindowSec = historyWindowSec;
  }

  return createMetricGraphView(options);
}
