// src/model/graph-metrics.js
// Metric definitions for time graphs.

export const GRAPH_METRICS = {
  gold: {
    id: "gold",
    label: "Gold",
    series: [
      {
        id: "gold",
        label: "Gold",
        color: 0xffd966,
        getValue: (state) => state?.resources?.gold ?? state?.gold ?? 0,
        formatValue: (value) =>
          Number.isFinite(value) ? value.toFixed(1) : "0.0",
      },
    ],
  },
  ap: {
    id: "ap",
    label: "AP",
    series: [
      {
        id: "ap",
        label: "AP",
        color: 0x66ccff,
        getValue: (state) => state?.actionPoints ?? 0,
        formatValue: (value) =>
          Number.isFinite(value) ? `${Math.floor(value)}` : "0",
      },
      {
        id: "apCap",
        label: "AP Cap",
        color: 0xffaa66,
        getValue: (state) => state?.actionPointCap ?? 0,
        formatValue: (value) =>
          Number.isFinite(value) ? `${Math.floor(value)}` : "0",
      },
    ],
  },
};

function mergeSeries(metrics) {
  const merged = [];
  const seen = new Set();
  for (const metric of metrics) {
    const series = Array.isArray(metric?.series) ? metric.series : [];
    for (const s of series) {
      if (!s || !s.id || seen.has(s.id)) continue;
      merged.push(s);
      seen.add(s.id);
    }
  }
  return merged;
}

GRAPH_METRICS.all = {
  id: "all",
  label: "All",
  series: mergeSeries([GRAPH_METRICS.gold, GRAPH_METRICS.ap]),
};

export function getGraphMetric(metricId) {
  return GRAPH_METRICS[metricId] || GRAPH_METRICS.gold;
}
