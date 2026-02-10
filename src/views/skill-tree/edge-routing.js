// edge-routing.js
// Deterministic edge and focus helpers for skill tree rendering.

import {
  EDGE_LANE_MIN_DEGREE,
  EDGE_LANE_STEP_DENSE,
  EDGE_LANE_STEP_MEDIUM,
} from "./constants.js";

export function makeEdgeKey(a, b) {
  if (String(a) < String(b)) return `${a}|${b}`;
  return `${b}|${a}`;
}

export function makeDirectedEdgeKey(a, b) {
  return `${a}|${b}`;
}

export function getFocusSets(edges, focusNodeId) {
  const focusNodes = new Set();
  const focusEdges = new Set();
  if (!focusNodeId) return { focusNodes, focusEdges };

  focusNodes.add(focusNodeId);
  for (const edge of edges || []) {
    if (edge.a === focusNodeId || edge.b === focusNodeId) {
      focusNodes.add(edge.a);
      focusNodes.add(edge.b);
      focusEdges.add(makeEdgeKey(edge.a, edge.b));
    }
  }
  return { focusNodes, focusEdges };
}

export function computeEdgeLaneData(edges, positions) {
  const byNode = new Map();
  for (const edge of edges || []) {
    if (!byNode.has(edge.a)) byNode.set(edge.a, []);
    if (!byNode.has(edge.b)) byNode.set(edge.b, []);
    byNode.get(edge.a).push(edge.b);
    byNode.get(edge.b).push(edge.a);
  }

  const endpointOffsetByEdgeKey = new Map();
  for (const [nodeId, neighborsRaw] of byNode.entries()) {
    const neighbors = neighborsRaw.slice();
    if (neighbors.length < EDGE_LANE_MIN_DEGREE) continue;
    neighbors.sort((left, right) => {
      const pl = positions[left];
      const pr = positions[right];
      const pn = positions[nodeId];
      if (!pl || !pr || !pn) return String(left).localeCompare(String(right));
      const al = Math.atan2(pl.y - pn.y, pl.x - pn.x);
      const ar = Math.atan2(pr.y - pn.y, pr.x - pn.x);
      if (al !== ar) return al - ar;
      return String(left).localeCompare(String(right));
    });
    const half = (neighbors.length - 1) / 2;
    const laneStep = neighbors.length >= 6 ? EDGE_LANE_STEP_DENSE : EDGE_LANE_STEP_MEDIUM;
    for (let i = 0; i < neighbors.length; i++) {
      const neighbor = neighbors[i];
      endpointOffsetByEdgeKey.set(
        makeDirectedEdgeKey(nodeId, neighbor),
        (i - half) * laneStep
      );
    }
  }

  const edgeOffsetByKey = new Map();
  for (const edge of edges || []) {
    const key = makeEdgeKey(edge.a, edge.b);
    const fromA = endpointOffsetByEdgeKey.get(makeDirectedEdgeKey(edge.a, edge.b)) || 0;
    const fromB = endpointOffsetByEdgeKey.get(makeDirectedEdgeKey(edge.b, edge.a)) || 0;
    let edgeOffset = 0;
    if (fromA !== 0 && fromB !== 0 && Math.sign(fromA) === Math.sign(fromB)) {
      edgeOffset = (fromA + fromB) / 2;
    } else if (Math.abs(fromA) >= Math.abs(fromB)) {
      edgeOffset = fromA * 0.9;
    } else {
      edgeOffset = fromB * 0.9;
    }
    edgeOffsetByKey.set(key, edgeOffset);
  }

  return { edgeOffsetByKey, endpointOffsetByEdgeKey };
}
