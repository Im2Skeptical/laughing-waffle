// layout-engine.js
// Deterministic skill tree layout algorithms and commit-order helpers.

import {
  clampNumber,
  isObject,
  sortStrings,
  toArray,
  toSafeInt,
  uniqueSortedStrings,
} from "./helpers.js";

const COLOR_TAG_ORDER = ["Blue", "Green", "Red", "Black"];
const DEFAULT_WEDGE_CENTER_DEG = {
  Blue: 135,
  Green: 45,
  Red: -45,
  Black: -135,
  BlueGreen: 90,
  GreenRed: 0,
  RedBlack: -90,
  BlackBlue: 180,
};
const DEFAULT_WEDGE_SPAN_DEG = {
  Blue: 70,
  Green: 70,
  Red: 70,
  Black: 70,
  BlueGreen: 46,
  GreenRed: 46,
  RedBlack: 46,
  BlackBlue: 46,
};
const DEFAULT_LAYOUT_NODE_RADIUS = 24;
const DEFAULT_LAYOUT_NOTABLE_RADIUS = 34;
const MIN_LAYOUT_NODE_RADIUS = 10;
const MAX_LAYOUT_NODE_RADIUS = 72;

function getTreeNodes(treeId, nodesRegistry) {
  const out = [];
  for (const node of Object.values(nodesRegistry || {})) {
    if (!isObject(node)) continue;
    if (node.treeId !== treeId) continue;
    out.push(node);
  }
  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

function getAdjacentNodeIds(nodeDef) {
  return uniqueSortedStrings(nodeDef?.adjacent);
}

function getNodeDepthMap(treeDef, nodesRegistry) {
  const nodes = getTreeNodes(treeDef.id, nodesRegistry);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const depthByNodeId = new Map();

  if (!nodeById.has(treeDef.startNodeId)) {
    return { nodeById, depthByNodeId };
  }

  const queue = [treeDef.startNodeId];
  depthByNodeId.set(treeDef.startNodeId, 0);

  while (queue.length) {
    const nodeId = queue.shift();
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const depth = depthByNodeId.get(nodeId) ?? 0;
    for (const adjId of getAdjacentNodeIds(node)) {
      if (!nodeById.has(adjId)) continue;
      if (depthByNodeId.has(adjId)) continue;
      depthByNodeId.set(adjId, depth + 1);
      queue.push(adjId);
    }
  }

  let maxDepth = -1;
  for (const depth of depthByNodeId.values()) {
    if (depth > maxDepth) maxDepth = depth;
  }
  const disconnectedDepth = maxDepth + 1;
  for (const node of nodes) {
    if (depthByNodeId.has(node.id)) continue;
    depthByNodeId.set(node.id, disconnectedDepth);
  }

  return { nodeById, depthByNodeId };
}

function buildEdgeList(nodesById) {
  const seen = new Set();
  const edges = [];
  const nodeIds = sortStrings(Array.from(nodesById.keys()));

  for (const nodeId of nodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    for (const adjId of getAdjacentNodeIds(node)) {
      if (!nodesById.has(adjId)) continue;
      const a = nodeId < adjId ? nodeId : adjId;
      const b = nodeId < adjId ? adjId : nodeId;
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }

  edges.sort((left, right) => {
    if (left.a !== right.a) return left.a.localeCompare(right.a);
    return left.b.localeCompare(right.b);
  });
  return edges;
}

function getLegacyRingIdFromTags(node) {
  const tags = toArray(node?.tags);
  if (tags.includes("Core")) return "core";
  if (tags.includes("Early")) return "early";
  if (tags.includes("Mid")) return "mid";
  if (tags.includes("Late")) return "late";
  return null;
}

function getNodeRingId(node) {
  if (typeof node?.ringId === "string" && node.ringId.length > 0) {
    return node.ringId;
  }
  return getLegacyRingIdFromTags(node);
}

function getRingIdSortKey(ringId) {
  const id = String(ringId || "");
  if (id === "core") return [0, 0, id];
  const match = /^ring[_-]?(\d+)$/i.exec(id);
  if (match) return [1, Number(match[1]), id];
  if (id === "early") return [2, 0, id];
  if (id === "mid") return [2, 1, id];
  if (id === "late") return [2, 2, id];
  return [3, 0, id];
}

function uniqueStringsInOrder(values) {
  const out = [];
  const seen = new Set();
  for (const value of toArray(values)) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sortRingIds(ringIds) {
  return ringIds.slice().sort((left, right) => {
    const lk = getRingIdSortKey(left);
    const rk = getRingIdSortKey(right);
    if (lk[0] !== rk[0]) return lk[0] - rk[0];
    if (lk[1] !== rk[1]) return lk[1] - rk[1];
    return String(lk[2]).localeCompare(String(rk[2]));
  });
}

function buildRingOrder(layoutCfg, radiiCfg, ringIdsInUse = []) {
  const orderFromCfg = uniqueStringsInOrder(layoutCfg?.ringOrder);
  const ringIdsFromRadii = sortRingIds(Object.keys(radiiCfg || {}));
  const ringIdsUsed = sortRingIds(uniqueSortedStrings(ringIdsInUse));

  const order = [];
  const seen = new Set();
  function pushRing(id) {
    if (typeof id !== "string" || id.length === 0) return;
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  }

  pushRing("core");
  for (const ringId of orderFromCfg) pushRing(ringId);
  for (const ringId of ringIdsFromRadii) pushRing(ringId);
  for (const ringId of ringIdsUsed) pushRing(ringId);

  if (order.length <= 1) {
    pushRing("early");
    pushRing("mid");
    pushRing("late");
  }

  return order;
}

function applyNodeUiPosition(node, basePos) {
  const out = { ...basePos };
  if (isObject(node?.uiPos)) {
    out.x = Number.isFinite(node.uiPos.x) ? node.uiPos.x : out.x;
    out.y = Number.isFinite(node.uiPos.y) ? node.uiPos.y : out.y;
  }
  if (isObject(node?.uiPosNudge)) {
    out.x += Number.isFinite(node.uiPosNudge.x) ? node.uiPosNudge.x : 0;
    out.y += Number.isFinite(node.uiPosNudge.y) ? node.uiPosNudge.y : 0;
  }
  return out;
}

function normalizeColorPairWedgeId(colorA, colorB) {
  const pair = [colorA, colorB].sort().join("|");
  if (pair === "Blue|Green") return "BlueGreen";
  if (pair === "Green|Red") return "GreenRed";
  if (pair === "Black|Red") return "RedBlack";
  if (pair === "Black|Blue") return "BlackBlue";
  return `${colorA}${colorB}`;
}

function getWedgeIdFromTags(node) {
  const tags = new Set(toArray(node?.tags));
  const colors = COLOR_TAG_ORDER.filter((color) => tags.has(color));
  if (colors.length === 1) return colors[0];
  if (colors.length >= 2) {
    return normalizeColorPairWedgeId(colors[0], colors[1]);
  }
  return null;
}

function getRingLayoutConfig(treeDef, opts, ringIdsInUse = []) {
  const { x = 0, y = 0, width = 1600, height = 650 } = opts;
  const layoutCfg = isObject(treeDef?.ui?.ringLayout) ? treeDef.ui.ringLayout : {};
  const minDim = Math.min(width, height);
  const lateDefault = Math.max(120, Math.floor(minDim * 0.42));
  const radiiCfg = isObject(layoutCfg?.radii) ? layoutCfg.radii : {};
  const ringOrder = buildRingOrder(layoutCfg, radiiCfg, ringIdsInUse);
  const radiusEasePower = Number.isFinite(layoutCfg?.radiusEasePower)
    ? Math.max(0.2, layoutCfg.radiusEasePower)
    : 1.28;
  const radiusOuterBoostPx = Number.isFinite(layoutCfg?.radiusOuterBoostPx)
    ? Math.max(0, layoutCfg.radiusOuterBoostPx)
    : Math.floor(minDim * 0.08);
  const ringIndexById = {};
  for (let idx = 0; idx < ringOrder.length; idx++) {
    ringIndexById[ringOrder[idx]] = idx;
  }

  const radiiByRing = {};
  const nonCoreCount = Math.max(0, ringOrder.length - 1);
  for (let idx = 0; idx < ringOrder.length; idx++) {
    const ringId = ringOrder[idx];
    let radius = Number.isFinite(radiiCfg[ringId]) ? radiiCfg[ringId] : null;
    if (!Number.isFinite(radius)) {
      if (ringId === "core") {
        radius = Number.isFinite(radiiCfg.core) ? radiiCfg.core : 0;
      } else if (nonCoreCount > 0) {
        const t = idx / nonCoreCount;
        const easedT = Math.pow(t, radiusEasePower);
        radius = Math.floor(lateDefault * easedT + radiusOuterBoostPx * t * t);
      } else {
        radius = 0;
      }
    }
    radiiByRing[idx] = Math.max(0, Math.floor(radius));
  }

  const centersCfg = isObject(layoutCfg?.wedgeCentersDeg) ? layoutCfg.wedgeCentersDeg : {};
  const spansCfg = isObject(layoutCfg?.wedgeSpansDeg) ? layoutCfg.wedgeSpansDeg : {};

  return {
    centerX: x + Math.floor(width / 2),
    centerY: y + Math.floor(height / 2),
    ringOrder,
    ringIndexById,
    radiiByRing,
    wedgeCenterDeg: { ...DEFAULT_WEDGE_CENTER_DEG, ...centersCfg },
    wedgeSpanDeg: { ...DEFAULT_WEDGE_SPAN_DEG, ...spansCfg },
    barycenterIterations: Number.isFinite(layoutCfg?.barycenterIterations)
      ? Math.max(1, Math.floor(layoutCfg.barycenterIterations))
      : 6,
    localSwapIterations: Number.isFinite(layoutCfg?.localSwapIterations)
      ? Math.max(0, Math.floor(layoutCfg.localSwapIterations))
      : 2,
    overlapIterations: Number.isFinite(layoutCfg?.overlapIterations)
      ? Math.max(0, Math.floor(layoutCfg.overlapIterations))
      : 3,
    overlapPaddingPx: Number.isFinite(layoutCfg?.overlapPaddingPx)
      ? Math.max(0, layoutCfg.overlapPaddingPx)
      : 10,
    componentBandGapDeg: Number.isFinite(layoutCfg?.componentBandGapDeg)
      ? Math.max(0, layoutCfg.componentBandGapDeg)
      : 8,
    componentBandGapOuterScale: Number.isFinite(layoutCfg?.componentBandGapOuterScale)
      ? Math.max(0, layoutCfg.componentBandGapOuterScale)
      : 0.42,
    radialNudgeIterations: Number.isFinite(layoutCfg?.radialNudgeIterations)
      ? Math.max(0, Math.floor(layoutCfg.radialNudgeIterations))
      : 4,
    radialNudgeMaxPx: Number.isFinite(layoutCfg?.radialNudgeMaxPx)
      ? Math.max(0, layoutCfg.radialNudgeMaxPx)
      : 36,
    radialNudgePaddingPx: Number.isFinite(layoutCfg?.radialNudgePaddingPx)
      ? Math.max(0, layoutCfg.radialNudgePaddingPx)
      : 12,
    radialNudgeSpring: Number.isFinite(layoutCfg?.radialNudgeSpring)
      ? Math.max(0, layoutCfg.radialNudgeSpring)
      : 0.12,
    coreSpread: Number.isFinite(layoutCfg?.coreSpread)
      ? Math.max(0, Math.floor(layoutCfg.coreSpread))
      : 48,
    angularRelaxIterations: Number.isFinite(layoutCfg?.angularRelaxIterations)
      ? Math.max(0, Math.floor(layoutCfg.angularRelaxIterations))
      : 4,
    angularRelaxStrength: Number.isFinite(layoutCfg?.angularRelaxStrength)
      ? Math.max(0, layoutCfg.angularRelaxStrength)
      : 0.2,
    angularRelaxOuterBoost: Number.isFinite(layoutCfg?.angularRelaxOuterBoost)
      ? Math.max(0, layoutCfg.angularRelaxOuterBoost)
      : 0.16,
    angleSwapIterations: Number.isFinite(layoutCfg?.angleSwapIterations)
      ? Math.max(0, Math.floor(layoutCfg.angleSwapIterations))
      : 3,
    angleSwapAdjacentRingWeight: Number.isFinite(layoutCfg?.angleSwapAdjacentRingWeight)
      ? Math.max(0, layoutCfg.angleSwapAdjacentRingWeight)
      : 2.1,
    angleSwapSameRingWeight: Number.isFinite(layoutCfg?.angleSwapSameRingWeight)
      ? Math.max(0, layoutCfg.angleSwapSameRingWeight)
      : 0.5,
    angleSwapFarRingWeight: Number.isFinite(layoutCfg?.angleSwapFarRingWeight)
      ? Math.max(0, layoutCfg.angleSwapFarRingWeight)
      : 1.2,
    angleSwapTeleportWeight: Number.isFinite(layoutCfg?.angleSwapTeleportWeight)
      ? Math.max(0, layoutCfg.angleSwapTeleportWeight)
      : 2.4,
    angleSwapTeleportRingDeltaStart: Number.isFinite(layoutCfg?.angleSwapTeleportRingDeltaStart)
      ? Math.max(1, Math.floor(layoutCfg.angleSwapTeleportRingDeltaStart))
      : 2,
    angleSwapTeleportAngleDeg: Number.isFinite(layoutCfg?.angleSwapTeleportAngleDeg)
      ? Math.max(0, layoutCfg.angleSwapTeleportAngleDeg)
      : 38,
  };
}

function getLayoutNodeRadius(nodeDef, treeDef) {
  const tags = toArray(nodeDef?.tags);
  const nodeSizes = isObject(treeDef?.ui?.nodeSizes) ? treeDef.ui.nodeSizes : null;
  const defaultRadius = Number.isFinite(nodeSizes?.defaultRadius)
    ? nodeSizes.defaultRadius
    : DEFAULT_LAYOUT_NODE_RADIUS;
  const notableRadius = Number.isFinite(nodeSizes?.notableRadius)
    ? nodeSizes.notableRadius
    : DEFAULT_LAYOUT_NOTABLE_RADIUS;
  const fallback = tags.includes("Notable") ? notableRadius : defaultRadius;
  const radius = Number.isFinite(nodeDef?.uiNodeRadius) ? nodeDef.uiNodeRadius : fallback;
  return clampNumber(radius, MIN_LAYOUT_NODE_RADIUS, MAX_LAYOUT_NODE_RADIUS);
}

function resolveAngularOverlapsInWedge({
  ids,
  minTheta,
  maxTheta,
  ringRadius,
  thetaByNodeId,
  nodeById,
  treeDef,
  cfg,
}) {
  if (!Array.isArray(ids) || ids.length <= 1) return;
  if (!Number.isFinite(minTheta) || !Number.isFinite(maxTheta) || maxTheta <= minTheta) return;
  if (!Number.isFinite(ringRadius) || ringRadius <= 0) return;
  const iterations = Math.max(0, Math.floor(cfg?.overlapIterations || 0));
  if (iterations <= 0) return;

  const orderedIds = ids.slice();
  const paddingPx = Number.isFinite(cfg?.overlapPaddingPx) ? Math.max(0, cfg.overlapPaddingPx) : 10;
  const n = orderedIds.length;
  const angles = new Array(n);
  const radii = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = orderedIds[i];
    const fallbackTheta =
      n === 1 ? (minTheta + maxTheta) / 2 : minTheta + ((maxTheta - minTheta) * i) / (n - 1);
    angles[i] = Number.isFinite(thetaByNodeId[id]) ? thetaByNodeId[id] : fallbackTheta;
    radii[i] = getLayoutNodeRadius(nodeById.get(id), treeDef);
  }

  const gaps = new Array(Math.max(0, n - 1)).fill(0);
  const availableSpan = maxTheta - minTheta;
  const epsilon = 0.0001;

  function computeGaps() {
    let requiredSpan = 0;
    for (let i = 0; i < n - 1; i++) {
      const gap = (radii[i] + radii[i + 1] + paddingPx) / ringRadius;
      gaps[i] = Math.max(0, gap);
      requiredSpan += gaps[i];
    }
    return requiredSpan;
  }

  const requiredSpan = computeGaps();
  if (requiredSpan >= availableSpan - epsilon) {
    for (let i = 0; i < n; i++) {
      angles[i] = n === 1 ? (minTheta + maxTheta) / 2 : minTheta + (availableSpan * i) / (n - 1);
    }
    for (let i = 0; i < n; i++) {
      thetaByNodeId[orderedIds[i]] = angles[i];
    }
    return;
  }

  for (let pass = 0; pass < iterations; pass++) {
    for (let i = 1; i < n; i++) {
      const minAllowed = angles[i - 1] + gaps[i - 1];
      if (angles[i] < minAllowed) angles[i] = minAllowed;
    }

    const overflow = angles[n - 1] - maxTheta;
    if (overflow > 0) {
      for (let i = 0; i < n; i++) angles[i] -= overflow;
    }

    for (let i = n - 2; i >= 0; i--) {
      const maxAllowed = angles[i + 1] - gaps[i];
      if (angles[i] > maxAllowed) angles[i] = maxAllowed;
    }

    const underflow = minTheta - angles[0];
    if (underflow > 0) {
      for (let i = 0; i < n; i++) angles[i] += underflow;
    }
  }

  for (let i = 0; i < n; i++) {
    thetaByNodeId[orderedIds[i]] = clampNumber(angles[i], minTheta, maxTheta);
  }
}

function unwrapAngleNearReference(angle, reference) {
  if (!Number.isFinite(angle) || !Number.isFinite(reference)) return angle;
  let out = angle;
  while (out - reference > Math.PI) out -= Math.PI * 2;
  while (out - reference < -Math.PI) out += Math.PI * 2;
  return out;
}

function relaxAnglesByAdjacency({
  nodeIds,
  ringByNodeId,
  thetaByNodeId,
  thetaBoundsByNodeId,
  nodeById,
  maxRing,
  cfg,
}) {
  const iterations = Number.isFinite(cfg?.angularRelaxIterations)
    ? Math.max(0, Math.floor(cfg.angularRelaxIterations))
    : 0;
  if (iterations <= 0) return;
  const baseStrength = Number.isFinite(cfg?.angularRelaxStrength)
    ? Math.max(0, cfg.angularRelaxStrength)
    : 0.2;
  const outerBoost = Number.isFinite(cfg?.angularRelaxOuterBoost)
    ? Math.max(0, cfg.angularRelaxOuterBoost)
    : 0.16;
  const ringDenominator = Math.max(1, maxRing);

  for (let iter = 0; iter < iterations; iter++) {
    const nextThetaByNodeId = {};
    for (const nodeId of nodeIds) {
      const ring = ringByNodeId[nodeId];
      if (!Number.isFinite(ring) || ring <= 0) continue;
      const currentTheta = thetaByNodeId[nodeId];
      if (!Number.isFinite(currentTheta)) continue;

      let sum = 0;
      let count = 0;
      for (const neighborId of getAdjacentNodeIds(nodeById.get(nodeId))) {
        const neighborTheta = thetaByNodeId[neighborId];
        if (!Number.isFinite(neighborTheta)) continue;
        const unwrapped = unwrapAngleNearReference(neighborTheta, currentTheta);
        sum += unwrapped;
        count += 1;
      }
      if (count <= 0) continue;

      const targetTheta = sum / count;
      const strength = clampNumber(
        baseStrength + outerBoost * (ring / ringDenominator),
        0,
        0.85
      );
      let nextTheta = currentTheta + (targetTheta - currentTheta) * strength;
      const bounds = thetaBoundsByNodeId[nodeId];
      if (bounds) {
        nextTheta = clampNumber(nextTheta, bounds.minTheta, bounds.maxTheta);
      }
      nextThetaByNodeId[nodeId] = nextTheta;
    }

    for (const nodeId of Object.keys(nextThetaByNodeId)) {
      thetaByNodeId[nodeId] = nextThetaByNodeId[nodeId];
    }
  }
}

function optimizeAnglesWithLocalSwaps({
  groupsByRing,
  wedgeOrder,
  maxRing,
  nodeById,
  ringByNodeId,
  thetaByNodeId,
  cfg,
}) {
  const iterations = Number.isFinite(cfg?.angleSwapIterations)
    ? Math.max(0, Math.floor(cfg.angleSwapIterations))
    : 0;
  if (iterations <= 0) return;
  const adjacentRingWeight = Number.isFinite(cfg?.angleSwapAdjacentRingWeight)
    ? Math.max(0, cfg.angleSwapAdjacentRingWeight)
    : 2.1;
  const sameRingWeight = Number.isFinite(cfg?.angleSwapSameRingWeight)
    ? Math.max(0, cfg.angleSwapSameRingWeight)
    : 0.5;
  const farRingWeight = Number.isFinite(cfg?.angleSwapFarRingWeight)
    ? Math.max(0, cfg.angleSwapFarRingWeight)
    : 1.2;
  const teleportWeight = Number.isFinite(cfg?.angleSwapTeleportWeight)
    ? Math.max(0, cfg.angleSwapTeleportWeight)
    : 2.4;
  const teleportRingDeltaStart = Number.isFinite(cfg?.angleSwapTeleportRingDeltaStart)
    ? Math.max(1, Math.floor(cfg.angleSwapTeleportRingDeltaStart))
    : 2;
  const teleportAngleThresholdRad =
    ((Number.isFinite(cfg?.angleSwapTeleportAngleDeg) ? Math.max(0, cfg.angleSwapTeleportAngleDeg) : 38) *
      Math.PI) /
    180;

  function getAngleCostAtTheta(nodeId, testTheta) {
    if (!Number.isFinite(testTheta)) return 0;
    const ring = ringByNodeId[nodeId];
    let cost = 0;
    for (const neighborId of getAdjacentNodeIds(nodeById.get(nodeId))) {
      const neighborTheta = thetaByNodeId[neighborId];
      if (!Number.isFinite(neighborTheta)) continue;
      const unwrapped = unwrapAngleNearReference(neighborTheta, testTheta);
      const diff = Math.abs(unwrapped - testTheta);
      const neighborRing = ringByNodeId[neighborId];
      let weight = farRingWeight;
      let ringDelta = Number.NaN;
      if (Number.isFinite(ring) && Number.isFinite(neighborRing)) {
        ringDelta = Math.abs(ring - neighborRing);
        if (ringDelta === 1) weight = adjacentRingWeight;
        else if (ringDelta === 0) weight = sameRingWeight;
      }
      cost += diff * weight;
      if (
        teleportWeight > 0 &&
        Number.isFinite(ringDelta) &&
        ringDelta >= teleportRingDeltaStart &&
        diff > teleportAngleThresholdRad
      ) {
        const ringFactor = ringDelta - teleportRingDeltaStart + 1;
        const angleExcess = diff - teleportAngleThresholdRad;
        cost += angleExcess * ringFactor * teleportWeight;
      }
    }
    return cost;
  }

  for (let pass = 0; pass < iterations; pass++) {
    for (let ring = 1; ring <= maxRing; ring++) {
      const ringMap = groupsByRing.get(ring);
      if (!ringMap) continue;
      for (const wedge of wedgeOrder) {
        const ids = ringMap.get(wedge);
        if (!ids || ids.length <= 1) continue;

        const maxBubblePasses = Math.max(1, Math.min(ids.length, 24));
        for (let bubblePass = 0; bubblePass < maxBubblePasses; bubblePass++) {
          let changed = false;
          for (let i = 0; i < ids.length - 1; i++) {
            const leftId = ids[i];
            const rightId = ids[i + 1];
            const leftTheta = thetaByNodeId[leftId];
            const rightTheta = thetaByNodeId[rightId];
            if (!Number.isFinite(leftTheta) || !Number.isFinite(rightTheta)) continue;

            const before =
              getAngleCostAtTheta(leftId, leftTheta) +
              getAngleCostAtTheta(rightId, rightTheta);
            const after =
              getAngleCostAtTheta(leftId, rightTheta) +
              getAngleCostAtTheta(rightId, leftTheta);

            if (after + 0.0001 < before) {
              ids[i] = rightId;
              ids[i + 1] = leftId;
              thetaByNodeId[leftId] = rightTheta;
              thetaByNodeId[rightId] = leftTheta;
              changed = true;
            }
          }
          if (!changed) break;
        }
      }
    }
  }
}

function optimizeRingOrderWithLocalSwaps({
  groupsByRing,
  wedgeOrder,
  maxRing,
  nodeById,
  iterations,
}) {
  const swapPasses = Math.max(0, Math.floor(iterations || 0));
  if (swapPasses <= 0) return;
  const CROSSING_WEIGHT = 6;
  const DISTANCE_WEIGHT = 1;

  function getRingNodeIndexMap(ring) {
    const out = new Map();
    const ringMap = groupsByRing.get(ring);
    if (!ringMap) return out;
    let index = 0;
    const wedgeList = ring === 0 ? ["Core"] : wedgeOrder;
    for (const wedge of wedgeList) {
      const ids = ringMap.get(wedge) || [];
      for (const id of ids) out.set(id, index++);
    }
    return out;
  }

  function getNeighborIndicesCached(nodeId, neighborIndexMap, cache) {
    if (!neighborIndexMap || neighborIndexMap.size === 0) return [];
    if (cache.has(nodeId)) return cache.get(nodeId);
    const out = [];
    for (const adjId of getAdjacentNodeIds(nodeById.get(nodeId))) {
      if (!neighborIndexMap.has(adjId)) continue;
      out.push(neighborIndexMap.get(adjId));
    }
    out.sort((a, b) => a - b);
    cache.set(nodeId, out);
    return out;
  }

  function countCrossingsWhenLeftBeforeRight(leftNeighborIdxs, rightNeighborIdxs) {
    if (!leftNeighborIdxs.length || !rightNeighborIdxs.length) return 0;
    let count = 0;
    for (const leftIdx of leftNeighborIdxs) {
      for (const rightIdx of rightNeighborIdxs) {
        if (leftIdx > rightIdx) count++;
      }
    }
    return count;
  }

  function getNodeDistanceCostAtSlot(slotIndex, neighborIdxs) {
    if (!neighborIdxs.length) return 0;
    let sum = 0;
    for (const idx of neighborIdxs) sum += Math.abs(slotIndex - idx);
    return sum / neighborIdxs.length;
  }

  for (let pass = 0; pass < swapPasses; pass++) {
    for (let ring = 1; ring <= maxRing; ring++) {
      const prevIndexByNode = getRingNodeIndexMap(ring - 1);
      const nextIndexByNode = getRingNodeIndexMap(ring + 1);
      const prevNeighborCache = new Map();
      const nextNeighborCache = new Map();
      const ringMap = groupsByRing.get(ring);
      if (!ringMap) continue;

      for (const wedge of wedgeOrder) {
        const ids = ringMap.get(wedge);
        if (!ids || ids.length <= 1) continue;

        let changed = true;
        while (changed) {
          changed = false;
          for (let i = 0; i < ids.length - 1; i++) {
            const a = ids[i];
            const b = ids[i + 1];
            const aPrev = getNeighborIndicesCached(a, prevIndexByNode, prevNeighborCache);
            const bPrev = getNeighborIndicesCached(b, prevIndexByNode, prevNeighborCache);
            const aNext = getNeighborIndicesCached(a, nextIndexByNode, nextNeighborCache);
            const bNext = getNeighborIndicesCached(b, nextIndexByNode, nextNeighborCache);

            const crossingBefore =
              countCrossingsWhenLeftBeforeRight(aPrev, bPrev) +
              countCrossingsWhenLeftBeforeRight(aNext, bNext);
            const crossingAfter =
              countCrossingsWhenLeftBeforeRight(bPrev, aPrev) +
              countCrossingsWhenLeftBeforeRight(bNext, aNext);

            const before =
              crossingBefore * CROSSING_WEIGHT +
              (getNodeDistanceCostAtSlot(i, aPrev) +
                getNodeDistanceCostAtSlot(i, aNext) +
                getNodeDistanceCostAtSlot(i + 1, bPrev) +
                getNodeDistanceCostAtSlot(i + 1, bNext)) *
                DISTANCE_WEIGHT;
            const after =
              crossingAfter * CROSSING_WEIGHT +
              (getNodeDistanceCostAtSlot(i + 1, aPrev) +
                getNodeDistanceCostAtSlot(i + 1, aNext) +
                getNodeDistanceCostAtSlot(i, bPrev) +
                getNodeDistanceCostAtSlot(i, bNext)) *
                DISTANCE_WEIGHT;

            if (after + 0.0001 < before) {
              ids[i] = b;
              ids[i + 1] = a;
              changed = true;
            }
          }
        }
      }
    }
  }
}

function buildConnectedComponentsInOrder(ids, nodeById) {
  if (!Array.isArray(ids) || ids.length <= 1) return [ids ? ids.slice() : []];
  const idSet = new Set(ids);
  const orderById = new Map(ids.map((id, idx) => [id, idx]));
  const visited = new Set();
  const components = [];

  for (const startId of ids) {
    if (visited.has(startId)) continue;
    const queue = [startId];
    visited.add(startId);
    const comp = [];

    while (queue.length) {
      const id = queue.shift();
      comp.push(id);
      for (const adjId of getAdjacentNodeIds(nodeById.get(id))) {
        if (!idSet.has(adjId) || visited.has(adjId)) continue;
        visited.add(adjId);
        queue.push(adjId);
      }
    }

    comp.sort((a, b) => {
      const ia = orderById.get(a) ?? 999999;
      const ib = orderById.get(b) ?? 999999;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });
    components.push(comp);
  }

  components.sort((a, b) => {
    const ia = orderById.get(a[0]) ?? 999999;
    const ib = orderById.get(b[0]) ?? 999999;
    if (ia !== ib) return ia - ib;
    return String(a[0]).localeCompare(String(b[0]));
  });

  return components;
}

function computeRadialBreathingOffsets({
  nodeIds,
  ringByNodeId,
  wedgeByNodeId,
  thetaByNodeId,
  baseRadiusByNodeId,
  nodeById,
  treeDef,
  cfg,
}) {
  const iterations = Number.isFinite(cfg?.radialNudgeIterations)
    ? Math.max(0, Math.floor(cfg.radialNudgeIterations))
    : 0;
  const maxNudge = Number.isFinite(cfg?.radialNudgeMaxPx)
    ? Math.max(0, cfg.radialNudgeMaxPx)
    : 0;
  if (iterations <= 0 || maxNudge <= 0) return {};

  const spacingPadding = Number.isFinite(cfg?.radialNudgePaddingPx)
    ? Math.max(0, cfg.radialNudgePaddingPx)
    : 12;
  const spring = Number.isFinite(cfg?.radialNudgeSpring)
    ? Math.max(0, cfg.radialNudgeSpring)
    : 0.12;
  const step = 0.28;
  const maxStepPx = Math.max(4, Math.floor(maxNudge * 0.35));

  const movableIds = nodeIds.filter((id) => {
    const ring = ringByNodeId[id];
    return Number.isFinite(ring) && ring > 0 && Number.isFinite(thetaByNodeId[id]);
  });
  if (!movableIds.length) return {};

  const radiusByNodeId = {};
  const offsetByNodeId = {};
  const adjacentSetByNodeId = {};
  for (const id of movableIds) {
    radiusByNodeId[id] = getLayoutNodeRadius(nodeById.get(id), treeDef);
    offsetByNodeId[id] = 0;
    adjacentSetByNodeId[id] = new Set(getAdjacentNodeIds(nodeById.get(id)));
  }

  function getPos(nodeId) {
    const theta = thetaByNodeId[nodeId];
    const baseRadius = Number.isFinite(baseRadiusByNodeId[nodeId]) ? baseRadiusByNodeId[nodeId] : 0;
    const radius = Math.max(0, baseRadius + (offsetByNodeId[nodeId] || 0));
    return {
      x: cfg.centerX + radius * Math.cos(theta),
      y: cfg.centerY + radius * Math.sin(theta),
      theta,
    };
  }

  function shouldInteract(aId, bId) {
    const ringA = ringByNodeId[aId];
    const ringB = ringByNodeId[bId];
    const wedgeA = wedgeByNodeId[aId];
    const wedgeB = wedgeByNodeId[bId];
    if (adjacentSetByNodeId[aId]?.has(bId) || adjacentSetByNodeId[bId]?.has(aId)) return true;
    if (wedgeA === wedgeB && Math.abs(ringA - ringB) <= 1) return true;
    return false;
  }

  for (let iter = 0; iter < iterations; iter++) {
    for (const id of movableIds) {
      const pi = getPos(id);
      const ux = Math.cos(pi.theta);
      const uy = Math.sin(pi.theta);
      let push = 0;

      for (const otherId of movableIds) {
        if (otherId === id) continue;
        if (!shouldInteract(id, otherId)) continue;
        const pj = getPos(otherId);
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const dist = Math.hypot(dx, dy);
        const minDist = radiusByNodeId[id] + radiusByNodeId[otherId] + spacingPadding;
        if (!Number.isFinite(dist) || dist <= 0.0001 || dist >= minDist) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        const radialEffect = nx * ux + ny * uy;
        push += radialEffect * overlap;
      }

      push -= (offsetByNodeId[id] || 0) * spring;
      const delta = clampNumber(push * step, -maxStepPx, maxStepPx);
      offsetByNodeId[id] = clampNumber(
        (offsetByNodeId[id] || 0) + delta,
        -maxNudge,
        maxNudge
      );
    }
  }

  return offsetByNodeId;
}

function buildBfsLayout(treeDef, opts, nodesRegistry) {
  const {
    x = 0,
    y = 0,
    width = 1600,
    height = 650,
    columnSpacing = 220,
    rowSpacing = 110,
    leftPad = 120,
  } = opts;
  const { nodeById, depthByNodeId } = getNodeDepthMap(treeDef, nodesRegistry);
  const groups = new Map();
  for (const [nodeId, depth] of depthByNodeId.entries()) {
    if (!groups.has(depth)) groups.set(depth, []);
    groups.get(depth).push(nodeId);
  }

  const orderedDepths = Array.from(groups.keys()).sort((a, b) => a - b);
  const positionsByNodeId = {};
  const depthByNodeIdOut = {};

  for (const depth of orderedDepths) {
    const ids = sortStrings(groups.get(depth) || []);
    const count = ids.length;
    const totalHeight = Math.max(0, (count - 1) * rowSpacing);
    const startY = y + Math.floor(height / 2) - Math.floor(totalHeight / 2);

    for (let i = 0; i < ids.length; i++) {
      const nodeId = ids[i];
      const node = nodeById.get(nodeId);
      const defaultX = x + leftPad + depth * columnSpacing;
      const defaultY = startY + i * rowSpacing;
      const pos = applyNodeUiPosition(node, { x: defaultX, y: defaultY });
      positionsByNodeId[nodeId] = { ...pos, depth };
      depthByNodeIdOut[nodeId] = depth;
    }
  }

  return {
    positionsByNodeId,
    depthByNodeId: depthByNodeIdOut,
    orderedNodeIds: sortStrings(Array.from(nodeById.keys())),
    edges: buildEdgeList(nodeById),
  };
}

function buildRingLayout(treeDef, opts, nodesRegistry) {
  const nodes = getTreeNodes(treeDef.id, nodesRegistry);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = sortStrings(nodes.map((node) => node.id));
  if (!nodeIds.length) {
    return {
      positionsByNodeId: {},
      depthByNodeId: {},
      orderedNodeIds: [],
      edges: buildEdgeList(nodeById),
    };
  }

  const ringIdByNodeId = {};
  for (const node of nodes) {
    const ringId = getNodeRingId(node);
    if (typeof ringId !== "string" || ringId.length === 0) continue;
    ringIdByNodeId[node.id] = ringId;
  }

  const cfg = getRingLayoutConfig(treeDef, opts, Object.values(ringIdByNodeId));
  const ringByNodeId = {};
  const wedgeByNodeId = {};
  for (const node of nodes) {
    const ringId = ringIdByNodeId[node.id];
    if (typeof ringId !== "string" || ringId.length === 0) continue;
    const ring = cfg.ringIndexById[ringId];
    if (!Number.isFinite(ring)) continue;
    const wedge = ring === 0 ? "Core" : getWedgeIdFromTags(node);
    if (!wedge) continue;
    ringByNodeId[node.id] = ring;
    wedgeByNodeId[node.id] = wedge;
  }
  const eligibleNodeIds = sortStrings(Object.keys(ringByNodeId));

  const wedgeIds = new Set();
  for (const nodeId of eligibleNodeIds) {
    const ring = ringByNodeId[nodeId];
    if (ring <= 0) continue;
    wedgeIds.add(wedgeByNodeId[nodeId]);
  }

  const wedgeOrder = Array.from(wedgeIds.values()).sort((a, b) => {
    const da = Number.isFinite(cfg.wedgeCenterDeg[a]) ? cfg.wedgeCenterDeg[a] : 0;
    const db = Number.isFinite(cfg.wedgeCenterDeg[b]) ? cfg.wedgeCenterDeg[b] : 0;
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });

  const groupsByRing = new Map();
  for (const nodeId of eligibleNodeIds) {
    const ring = ringByNodeId[nodeId];
    const wedge = wedgeByNodeId[nodeId];
    if (!groupsByRing.has(ring)) groupsByRing.set(ring, new Map());
    const ringMap = groupsByRing.get(ring);
    if (!ringMap.has(wedge)) ringMap.set(wedge, []);
    ringMap.get(wedge).push(nodeId);
  }

  function getRingNodeIndexMap(ring) {
    const out = new Map();
    const ringMap = groupsByRing.get(ring);
    if (!ringMap) return out;
    let index = 0;
    const wedgeList = ring === 0 ? ["Core"] : wedgeOrder;
    for (const wedge of wedgeList) {
      const ids = ringMap.get(wedge) || [];
      for (const id of ids) out.set(id, index++);
    }
    return out;
  }

  const maxRing = Math.max(...Object.values(ringByNodeId), 0);
  const barycenterIterations = cfg.barycenterIterations;
  for (let pass = 0; pass < barycenterIterations; pass++) {
    for (let ring = 1; ring <= maxRing; ring++) {
      const prevIndexByNode = getRingNodeIndexMap(ring - 1);
      const ringMap = groupsByRing.get(ring);
      if (!ringMap) continue;
      for (const wedge of wedgeOrder) {
        const ids = ringMap.get(wedge);
        if (!ids || ids.length <= 1) continue;
        const currentIndex = new Map(ids.map((id, idx) => [id, idx]));
        ids.sort((a, b) => {
          const neighborsA = getAdjacentNodeIds(nodeById.get(a)).filter(
            (adjId) => ringByNodeId[adjId] === ring - 1 && prevIndexByNode.has(adjId)
          );
          const neighborsB = getAdjacentNodeIds(nodeById.get(b)).filter(
            (adjId) => ringByNodeId[adjId] === ring - 1 && prevIndexByNode.has(adjId)
          );
          const keyA = neighborsA.length
            ? neighborsA.reduce((sum, id) => sum + prevIndexByNode.get(id), 0) / neighborsA.length
            : Number.POSITIVE_INFINITY;
          const keyB = neighborsB.length
            ? neighborsB.reduce((sum, id) => sum + prevIndexByNode.get(id), 0) / neighborsB.length
            : Number.POSITIVE_INFINITY;
          if (keyA !== keyB) return keyA - keyB;
          const idxA = currentIndex.get(a) ?? 0;
          const idxB = currentIndex.get(b) ?? 0;
          if (idxA !== idxB) return idxA - idxB;
          return a.localeCompare(b);
        });
      }
    }

    for (let ring = maxRing - 1; ring >= 1; ring--) {
      const nextIndexByNode = getRingNodeIndexMap(ring + 1);
      const ringMap = groupsByRing.get(ring);
      if (!ringMap) continue;
      for (const wedge of wedgeOrder) {
        const ids = ringMap.get(wedge);
        if (!ids || ids.length <= 1) continue;
        const currentIndex = new Map(ids.map((id, idx) => [id, idx]));
        ids.sort((a, b) => {
          const neighborsA = getAdjacentNodeIds(nodeById.get(a)).filter(
            (adjId) => ringByNodeId[adjId] === ring + 1 && nextIndexByNode.has(adjId)
          );
          const neighborsB = getAdjacentNodeIds(nodeById.get(b)).filter(
            (adjId) => ringByNodeId[adjId] === ring + 1 && nextIndexByNode.has(adjId)
          );
          const keyA = neighborsA.length
            ? neighborsA.reduce((sum, id) => sum + nextIndexByNode.get(id), 0) / neighborsA.length
            : Number.POSITIVE_INFINITY;
          const keyB = neighborsB.length
            ? neighborsB.reduce((sum, id) => sum + nextIndexByNode.get(id), 0) / neighborsB.length
            : Number.POSITIVE_INFINITY;
          if (keyA !== keyB) return keyA - keyB;
          const idxA = currentIndex.get(a) ?? 0;
          const idxB = currentIndex.get(b) ?? 0;
          if (idxA !== idxB) return idxA - idxB;
          return a.localeCompare(b);
        });
      }
    }
  }

  optimizeRingOrderWithLocalSwaps({
    groupsByRing,
    wedgeOrder,
    maxRing,
    nodeById,
    iterations: cfg.localSwapIterations,
  });

  const positionsByNodeId = {};
  const depthByNodeIdOut = {};
  const thetaByNodeId = {};
  const thetaBoundsByNodeId = {};
  const baseRadiusByNodeId = {};
  const wedgeBandsByRing = new Map();

  const coreNodes = (groupsByRing.get(0)?.get("Core") || []).slice();
  if (coreNodes.length === 1) {
    const nodeId = coreNodes[0];
    positionsByNodeId[nodeId] = { x: cfg.centerX, y: cfg.centerY, depth: 0 };
    depthByNodeIdOut[nodeId] = 0;
  } else if (coreNodes.length > 1) {
    for (let i = 0; i < coreNodes.length; i++) {
      const theta = (Math.PI * 2 * i) / coreNodes.length;
      const nodeId = coreNodes[i];
      positionsByNodeId[nodeId] = {
        x: Math.floor(cfg.centerX + cfg.coreSpread * Math.cos(theta)),
        y: Math.floor(cfg.centerY + cfg.coreSpread * Math.sin(theta)),
        depth: 0,
      };
      depthByNodeIdOut[nodeId] = 0;
    }
  }

  for (let ring = 1; ring <= maxRing; ring++) {
    const ringMap = groupsByRing.get(ring);
    if (!ringMap) continue;
    const radius = Number.isFinite(cfg.radiiByRing[ring]) ? cfg.radiiByRing[ring] : 0;
    if (!wedgeBandsByRing.has(ring)) wedgeBandsByRing.set(ring, new Map());
    const wedgeBands = wedgeBandsByRing.get(ring);
    for (const wedge of wedgeOrder) {
      const ids = ringMap.get(wedge);
      if (!ids || ids.length === 0) continue;
      const centerDeg = Number.isFinite(cfg.wedgeCenterDeg[wedge]) ? cfg.wedgeCenterDeg[wedge] : 0;
      const spanDeg = Number.isFinite(cfg.wedgeSpanDeg[wedge]) ? cfg.wedgeSpanDeg[wedge] : 40;
      const center = (centerDeg * Math.PI) / 180;
      const span = (spanDeg * Math.PI) / 180;
      const minTheta = center - span / 2;
      const maxTheta = center + span / 2;
      const components = buildConnectedComponentsInOrder(ids, nodeById);
      const bands = [];

      if (components.length <= 1) {
        bands.push({ ids: ids.slice(), minTheta, maxTheta, radius });
      } else {
        const outerRingScale = 1 + (cfg.componentBandGapOuterScale || 0) * (ring / Math.max(1, maxRing));
        const gapRad = (((cfg.componentBandGapDeg || 0) * Math.PI) / 180) * outerRingScale;
        const gapCount = components.length - 1;
        const totalGap = Math.min(span * 0.6, gapRad * gapCount);
        const allocSpan = Math.max(span - totalGap, span * 0.35);
        const weightSum = components.reduce((sum, comp) => sum + Math.max(1, comp.length), 0);
        const gapPerBreak = gapCount > 0 ? totalGap / gapCount : 0;
        let cursor = minTheta;

        for (const comp of components) {
          const weight = Math.max(1, comp.length);
          const bandSpan = allocSpan * (weight / weightSum);
          const bandMin = cursor;
          const bandMax = cursor + bandSpan;
          bands.push({ ids: comp.slice(), minTheta: bandMin, maxTheta: bandMax, radius });
          cursor = bandMax + gapPerBreak;
        }
      }

      wedgeBands.set(wedge, bands);
      for (const band of bands) {
        const bandIds = band.ids;
        for (let i = 0; i < bandIds.length; i++) {
          const nodeId = bandIds[i];
          const theta =
            bandIds.length === 1
              ? (band.minTheta + band.maxTheta) / 2
              : band.minTheta + ((band.maxTheta - band.minTheta) * i) / (bandIds.length - 1);
          thetaByNodeId[nodeId] = theta;
          thetaBoundsByNodeId[nodeId] = { minTheta: band.minTheta, maxTheta: band.maxTheta };
          baseRadiusByNodeId[nodeId] = radius;
          depthByNodeIdOut[nodeId] = ring;
        }
      }
    }
  }

  function resolveAllRingOverlaps() {
    for (let ring = 1; ring <= maxRing; ring++) {
      const ringBands = wedgeBandsByRing.get(ring);
      if (!ringBands) continue;
      for (const wedge of wedgeOrder) {
        const bands = ringBands.get(wedge);
        if (!bands || !bands.length) continue;
        for (const band of bands) {
          if (!band.ids || !band.ids.length) continue;
          resolveAngularOverlapsInWedge({
            ids: band.ids,
            minTheta: band.minTheta,
            maxTheta: band.maxTheta,
            ringRadius: band.radius,
            thetaByNodeId,
            nodeById,
            treeDef,
            cfg,
          });
        }
      }
    }
  }

  resolveAllRingOverlaps();

  relaxAnglesByAdjacency({
    nodeIds: eligibleNodeIds,
    ringByNodeId,
    thetaByNodeId,
    thetaBoundsByNodeId,
    nodeById,
    maxRing,
    cfg,
  });

  optimizeAnglesWithLocalSwaps({
    groupsByRing,
    wedgeOrder,
    maxRing,
    nodeById,
    ringByNodeId,
    thetaByNodeId,
    cfg,
  });

  resolveAllRingOverlaps();

  const radialOffsetByNodeId = computeRadialBreathingOffsets({
    nodeIds: eligibleNodeIds,
    ringByNodeId,
    wedgeByNodeId,
    thetaByNodeId,
    baseRadiusByNodeId,
    nodeById,
    treeDef,
    cfg,
  });

  for (let ring = 1; ring <= maxRing; ring++) {
    const ringBands = wedgeBandsByRing.get(ring);
    if (!ringBands) continue;
    for (const wedge of wedgeOrder) {
      const bands = ringBands.get(wedge);
      if (!bands || !bands.length) continue;
      for (const band of bands) {
        const ids = band.ids || [];
        if (!ids.length) continue;
        const centerTheta = (band.minTheta + band.maxTheta) / 2;
        for (const nodeId of ids) {
          const theta = Number.isFinite(thetaByNodeId[nodeId]) ? thetaByNodeId[nodeId] : centerTheta;
          const radialOffset = Number.isFinite(radialOffsetByNodeId[nodeId])
            ? radialOffsetByNodeId[nodeId]
            : 0;
          const radius = Math.max(0, band.radius + radialOffset);
          positionsByNodeId[nodeId] = {
            x: Math.floor(cfg.centerX + radius * Math.cos(theta)),
            y: Math.floor(cfg.centerY + radius * Math.sin(theta)),
            depth: ring,
          };
          depthByNodeIdOut[nodeId] = ring;
        }
      }
    }
  }

  const maxConfiguredRadius = Math.max(
    0,
    ...Object.values(cfg.radiiByRing).map((value) => (Number.isFinite(value) ? value : 0))
  );
  const missingNodeIds = nodeIds.filter((nodeId) => !positionsByNodeId[nodeId]);
  const missingBaseByNodeId = {};
  const stackColumns = 4;
  const stackCell = 86;
  const stackStartX = Math.floor(cfg.centerX + Math.max(240, maxConfiguredRadius + 140));
  const stackStartY = Math.floor(cfg.centerY - Math.max(220, stackCell * 2));
  for (let idx = 0; idx < missingNodeIds.length; idx++) {
    const nodeId = missingNodeIds[idx];
    const col = idx % stackColumns;
    const row = Math.floor(idx / stackColumns);
    missingBaseByNodeId[nodeId] = {
      x: stackStartX + col * stackCell,
      y: stackStartY + row * stackCell,
      depth: maxRing + 1,
    };
  }

  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId);
    const basePos = positionsByNodeId[nodeId] ?? {
      ...(missingBaseByNodeId[nodeId] || {
        x: cfg.centerX,
        y: cfg.centerY,
        depth: Number.isFinite(ringByNodeId[nodeId]) ? ringByNodeId[nodeId] : maxRing + 1,
      }),
    };
    const pos = applyNodeUiPosition(node, basePos);
    positionsByNodeId[nodeId] = { ...pos, depth: basePos.depth };
    depthByNodeIdOut[nodeId] = basePos.depth;
  }

  return {
    positionsByNodeId,
    depthByNodeId: depthByNodeIdOut,
    orderedNodeIds: nodeIds,
    edges: buildEdgeList(nodeById),
  };
}

export function computeSkillTreeLayout(treeDef, nodesRegistry, opts = {}) {
  if (!treeDef) {
    return {
      treeId: null,
      positionsByNodeId: {},
      depthByNodeId: {},
      orderedNodeIds: [],
      edges: [],
    };
  }

  const mode = typeof opts?.layoutMode === "string" ? opts.layoutMode : treeDef?.ui?.layoutMode;
  if (mode === "ringByTags") {
    const ringLayout = buildRingLayout(treeDef, opts, nodesRegistry);
    return {
      treeId: treeDef.id,
      positionsByNodeId: ringLayout.positionsByNodeId,
      depthByNodeId: ringLayout.depthByNodeId,
      orderedNodeIds: ringLayout.orderedNodeIds,
      edges: ringLayout.edges,
    };
  }

  const bfsLayout = buildBfsLayout(treeDef, opts, nodesRegistry);
  return {
    treeId: treeDef.id,
    positionsByNodeId: bfsLayout.positionsByNodeId,
    depthByNodeId: bfsLayout.depthByNodeId,
    orderedNodeIds: bfsLayout.orderedNodeIds,
    edges: bfsLayout.edges,
  };
}

export function getDeterministicCommitOrder(layout, nodeIds) {
  const list = uniqueSortedStrings(nodeIds);
  return list.sort((a, b) => {
    const da = toSafeInt(layout?.depthByNodeId?.[a], 9999);
    const db = toSafeInt(layout?.depthByNodeId?.[b], 9999);
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });
}
