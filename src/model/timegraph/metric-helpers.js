// src/model/timegraph/metric-helpers.js

import { GRAPH_METRICS } from "../graph-metrics.js";
import { deserializeGameState } from "../state.js";
import { canonicalizeSnapshot } from "../canonicalize.js";
import { safeNumber } from "./utils.js";

export function resolveMetricDef(metric) {
  const resolved = typeof metric === "string" ? GRAPH_METRICS[metric] : metric;
  if (resolved && typeof resolved === "object") return resolved;
  return GRAPH_METRICS.gold;
}

export function ensureSeriesArray(series) {
  return Array.isArray(series) ? series : [];
}

export function computeValuesFromStateData(stateData, series, subject, resolverFactory) {
  if (stateData == null) return {};
  const list = Array.isArray(series) ? series : [];
  if (!list.length) return {};

  const allFastSeries = list.every(
    (s) => s && typeof s.getValueFromSnapshot === "function"
  );

  let raw = stateData;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (_) {
      raw = stateData;
    }
  }

  let resolver = null;
  if (typeof resolverFactory === "function") {
    resolver = resolverFactory(raw, subject);
  }

  const unresolvedFastSubject =
    resolver &&
    typeof resolver === "object" &&
    ((resolver.kind === "pawn" && !resolver.pawn) ||
      (resolver.kind === "tile" && !resolver.tile) ||
      (resolver.kind === "hub" && !resolver.hubStructure));

  const useFastSnapshotPath = allFastSeries && !unresolvedFastSubject;

  let state = null;
  if (!useFastSnapshotPath) {
    state = deserializeGameState(stateData);
    canonicalizeSnapshot(state);
  }

  const values = {};
  for (const s of list) {
    if (!s || typeof s.getValue !== "function") continue;
    if (useFastSnapshotPath && typeof s.getValueFromSnapshot === "function") {
      values[s.id] = safeNumber(s.getValueFromSnapshot(raw, subject, resolver));
    } else {
      values[s.id] = safeNumber(s.getValue(state, subject, resolver));
    }
  }
  return values;
}

export function resolveSeries(metricDef, subject, cursorState) {
  if (typeof metricDef?.getSeries === "function") {
    return ensureSeriesArray(metricDef.getSeries(subject, cursorState));
  }
  return ensureSeriesArray(metricDef?.series);
}

export function resolveLabel(metricDef, subject, cursorState) {
  if (typeof metricDef?.getLabel === "function") {
    const label = metricDef.getLabel(subject, cursorState);
    if (label) return label;
  }
  return metricDef?.label || "Metric";
}

export function resolveSubjectKey(metricDef, subject, explicitKey) {
  if (explicitKey != null) return explicitKey;
  if (typeof metricDef?.getSubjectKey === "function") {
    const key = metricDef.getSubjectKey(subject);
    if (key != null) return key;
  }
  if (subject && typeof subject === "object") {
    if (subject.key != null) return subject.key;
    if (subject.id != null) return subject.id;
    if (subject.col != null) return subject.col;
  }
  return null;
}

export function getSeriesSignature(series) {
  if (!Array.isArray(series) || !series.length) return "";
  return series.map((s) => s?.id ?? "").join("|");
}
