// src/model/graph-metrics.js
// Metric definitions for time graphs.

import { getTotalFoodFromEdibles } from "./query.js";

export const GRAPH_METRICS = {
  gold: {
    id: "gold",
    label: "Gold",
    series: [
      {
        id: "gold",
        label: "Gold",
        color: 0xffd966,
        getValue: (state, _subject) => state?.resources?.gold ?? state?.gold ?? 0,
        formatValue: (value) =>
          Number.isFinite(value) ? value.toFixed(1) : "0.0",
      },
    ],
  },
  food: {
    id: "food",
    label: "Food",
    series: [
      {
        id: "food",
        label: "Food",
        color: 0x66cc77,
        getValue: (state, _subject) => {
          const base = state?.resources?.food ?? 0;
          const edible = getTotalFoodFromEdibles(state);
          const baseSafe = Number.isFinite(base) ? base : 0;
          const edibleSafe = Number.isFinite(edible) ? edible : 0;
          return baseSafe + edibleSafe;
        },
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
        id: "apCap",
        label: "AP Cap",
        color: 0xffaa66,
        getValue: (state, _subject) => state?.actionPointCap ?? 0,
        formatValue: (value) =>
          Number.isFinite(value) ? `${Math.floor(value)}` : "0",
      },
      {
        id: "ap",
        label: "AP",
        color: 0x66ccff,
        getValue: (state, _subject) => state?.actionPoints ?? 0,
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
  series: mergeSeries([GRAPH_METRICS.gold, GRAPH_METRICS.food, GRAPH_METRICS.ap]),
};

export function getGraphMetric(metricId) {
  return GRAPH_METRICS[metricId] || GRAPH_METRICS.gold;
}
