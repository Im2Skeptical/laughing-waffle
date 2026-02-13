// src/views/ui-root/system-graph-model.js

import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { envTileDefs } from "../../defs/gamepieces/env-tiles-defs.js";
import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../../defs/gamesystems/env-systems-defs.js";
import { hubSystemDefs } from "../../defs/gamesystems/hub-system-defs.js";
import { pawnSystemDefs } from "../../defs/gamesystems/pawn-systems-defs.js";

const SYSTEM_GRAPH_COLORS = [
  0x7fd0ff,
  0xffaa66,
  0x7ccf6b,
  0xff6699,
  0xb07a4f,
  0x9aa0b5,
  0x8f6fff,
];

const SYSTEM_GRAPH_TARGET_UPDATE_MS = 30;
const SYSTEM_GRAPH_TARGET_STABLE_MS = 80;

function getTierValue(defs, systemId, tier) {
  const def = defs?.[systemId];
  const value = def?.tierMap?.[tier];
  return Number.isFinite(value) ? value : 0;
}

function sumMaturedPool(pool) {
  return (
    (pool?.bronze ?? 0) +
    (pool?.silver ?? 0) +
    (pool?.gold ?? 0) +
    (pool?.diamond ?? 0)
  );
}

function findTileAnchorAtCol(snapshot, col) {
  const anchors = snapshot?.board?.layers?.tile?.anchors;
  if (!Array.isArray(anchors)) return null;
  const targetCol = Number.isFinite(col) ? Math.floor(col) : null;
  if (targetCol == null) return null;
  for (const anchor of anchors) {
    if (!anchor) continue;
    const base = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : 0;
    const span = Number.isFinite(anchor.span) ? Math.floor(anchor.span) : 1;
    if (targetCol >= base && targetCol < base + Math.max(1, span)) {
      return anchor;
    }
  }
  return null;
}

function findHubStructureAtCol(snapshot, col) {
  const slots = snapshot?.hub?.slots;
  if (!Array.isArray(slots)) return null;
  const targetCol = Number.isFinite(col) ? Math.floor(col) : null;
  if (targetCol == null) return null;
  for (let i = 0; i < slots.length; i++) {
    const structure = slots[i]?.structure;
    if (!structure) continue;
    const def = hubStructureDefs[structure.defId];
    const span =
      Number.isFinite(structure.span) && structure.span > 0
        ? Math.floor(structure.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
          ? Math.floor(def.defaultSpan)
          : 1;
    const base = i;
    if (targetCol >= base && targetCol < base + Math.max(1, span)) {
      return structure;
    }
  }
  return null;
}

function findPawnById(snapshot, id) {
  const pawns = snapshot?.pawns;
  if (!Array.isArray(pawns)) return null;
  for (const pawn of pawns) {
    if (pawn?.id === id) return pawn;
  }
  return null;
}

function buildSystemSnapshotResolver(snapshot, target) {
  if (!snapshot || !target) return null;
  if (target.kind === "tile") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    const occTile =
      col != null && Array.isArray(snapshot?.board?.occ?.tile)
        ? snapshot.board.occ.tile[col] ?? null
        : null;
    return {
      kind: "tile",
      col,
      tile:
        occTile ??
        (col != null ? findTileAnchorAtCol(snapshot, col) : null),
    };
  }
  if (target.kind === "hub") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    return {
      kind: "hub",
      col,
      hubStructure: col != null ? findHubStructureAtCol(snapshot, col) : null,
    };
  }
  if (target.kind === "pawn") {
    const id = target.id;
    return {
      kind: "pawn",
      id,
      pawn: id != null ? findPawnById(snapshot, id) : null,
    };
  }
  return null;
}

function buildSystemSeriesForTarget(target, state) {
  if (!target || !state) {
    return {
      label: "Systems",
      series: [
        {
          id: "systems:empty",
          label: "No target",
          color: SYSTEM_GRAPH_COLORS[0],
          getValue: () => 0,
        },
      ],
    };
  }

  const series = [];
  let label = "Systems";
  let targetKey = "";

  if (target.kind === "tile") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    const tile = col != null ? state?.board?.occ?.tile?.[col] : null;
    const tileDef = tile ? envTileDefs[tile.defId] : null;
    label = tileDef?.name || tile?.defId || `Tile ${col}`;
    targetKey = `tile:${col}`;

    const ids = new Set();
    const tags = new Set();
    const baseTags = Array.isArray(tileDef?.baseTags) ? tileDef.baseTags : [];
    for (const tag of baseTags) tags.add(tag);
    for (const tag of tile?.tags || []) tags.add(tag);
    for (const tag of tags) {
      const tagDef = envTagDefs?.[tag];
      const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
      for (const systemId of systems) {
        ids.add(systemId);
      }
    }
    for (const systemId of Object.keys(tile?.systemState || {})) {
      ids.add(systemId);
    }
    for (const systemId of Object.keys(tile?.systemTiers || {})) {
      ids.add(systemId);
    }
    for (const systemId of ids.values()) {
      if (systemId === "growth") {
        series.push({
          id: `${targetKey}:matured`,
          label: "Matured",
          color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
          getValue: (snapshot) => {
            const t = snapshot?.board?.occ?.tile?.[col];
            const pool = t?.systemState?.growth?.maturedPool;
            return sumMaturedPool(pool);
          },
          getValueFromSnapshot: (snapshot, _subject, resolved) => {
            const t =
              (resolved?.kind === "tile" ? resolved.tile : null) ??
              findTileAnchorAtCol(snapshot, col);
            const pool = t?.systemState?.growth?.maturedPool;
            return sumMaturedPool(pool);
          },
        });
        continue;
      }
      const def = envSystemDefs[systemId];
      const sysLabel = def?.ui?.name || systemId;
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        getValue: (snapshot) => {
          const t = snapshot?.board?.occ?.tile?.[col];
          const sysState = t?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            t?.systemTiers?.[systemId] ?? envSystemDefs[systemId]?.defaultTier;
          return getTierValue(envSystemDefs, systemId, tier);
        },
        getValueFromSnapshot: (snapshot, _subject, resolved) => {
          const t =
            (resolved?.kind === "tile" ? resolved.tile : null) ??
            findTileAnchorAtCol(snapshot, col);
          const sysState = t?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            t?.systemTiers?.[systemId] ?? envSystemDefs[systemId]?.defaultTier;
          return getTierValue(envSystemDefs, systemId, tier);
        },
      });
    }
  } else if (target.kind === "hub") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    const structure =
      col != null ? state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure : null;
    const def = structure ? hubStructureDefs[structure.defId] : null;
    label = def?.name || structure?.defId || `Hub ${col}`;
    targetKey = `hub:${col}`;

    const ids = new Set([
      ...Object.keys(structure?.systemState || {}),
      ...Object.keys(structure?.systemTiers || {}),
    ]);
    for (const systemId of ids.values()) {
      const defSys = hubSystemDefs[systemId];
      const sysLabel = defSys?.ui?.name || systemId;
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        getValue: (snapshot) => {
          const s =
            col != null
              ? snapshot?.hub?.occ?.[col] ?? snapshot?.hub?.slots?.[col]?.structure
              : null;
          const sysState = s?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            s?.systemTiers?.[systemId] ?? hubSystemDefs[systemId]?.defaultTier;
          return getTierValue(hubSystemDefs, systemId, tier);
        },
        getValueFromSnapshot: (snapshot, _subject, resolved) => {
          const s =
            (resolved?.kind === "hub" ? resolved.hubStructure : null) ??
            (col != null ? findHubStructureAtCol(snapshot, col) : null);
          const sysState = s?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            s?.systemTiers?.[systemId] ?? hubSystemDefs[systemId]?.defaultTier;
          return getTierValue(hubSystemDefs, systemId, tier);
        },
      });
    }
  } else if (target.kind === "pawn") {
    const id = target.id;
    const pawn = state?.pawns?.find((candidate) => candidate.id === id);
    label = pawn?.name || `Pawn ${id}`;
    targetKey = `pawn:${id}`;

    const ids = new Set([
      ...Object.keys(pawn?.systemState || {}),
      ...Object.keys(pawn?.systemTiers || {}),
    ]);
    for (const systemId of ids.values()) {
      const defSys = pawnSystemDefs[systemId];
      const sysLabel = defSys?.ui?.name || systemId;
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        getValue: (snapshot) => {
          const p = snapshot?.pawns?.find((candidate) => candidate.id === id);
          const sysState = p?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            p?.systemTiers?.[systemId] ?? pawnSystemDefs[systemId]?.defaultTier;
          return getTierValue(pawnSystemDefs, systemId, tier);
        },
        getValueFromSnapshot: (snapshot, _subject, resolved) => {
          const p =
            (resolved?.kind === "pawn" ? resolved.pawn : null) ??
            findPawnById(snapshot, id);
          const sysState = p?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            p?.systemTiers?.[systemId] ?? pawnSystemDefs[systemId]?.defaultTier;
          return getTierValue(pawnSystemDefs, systemId, tier);
        },
      });
    }
  }

  if (!series.length) {
    series.push({
      id: `${targetKey || "systems"}:empty`,
      label: "No systems",
      color: SYSTEM_GRAPH_COLORS[0],
      getValue: () => 0,
      getValueFromSnapshot: () => 0,
    });
  }

  return {
    label: `${label} Systems`,
    series,
  };
}

export function createSystemGraphModel({
  interactionController,
  runner,
  createController,
}) {
  let lastSystemGraphTargetKey = null;
  let nextSystemGraphTargetUpdateAtMs = 0;
  let pendingSystemGraphTargetKey = null;
  let pendingSystemGraphTargetSinceMs = 0;

  function getSystemGraphTarget() {
    const hover =
      interactionController.getHoveredPawn?.() ??
      interactionController.getHovered?.() ??
      interactionController.getLastHovered?.();
    if (!hover) return null;
    if (hover.kind === "tile") {
      return { kind: "tile", col: hover.col };
    }
    if (hover.kind === "hub") {
      return { kind: "hub", col: hover.col };
    }
    if (hover.kind === "pawn") {
      return { kind: "pawn", id: hover.id };
    }
    return null;
  }

  function getSystemGraphTargetKey(target) {
    if (!target) return null;
    if (target.kind === "tile") {
      return `tile:${Math.floor(target.col ?? 0)}`;
    }
    if (target.kind === "hub") {
      return `hub:${Math.floor(target.col ?? 0)}`;
    }
    if (target.kind === "pawn") {
      return `pawn:${target.id ?? ""}`;
    }
    return null;
  }

  const metric = {
    id: "systemTarget",
    label: "Systems",
    series: [],
    getSubjectKey: (subject) => getSystemGraphTargetKey(subject),
    createSnapshotResolver: (snapshot, subject) =>
      buildSystemSnapshotResolver(snapshot, subject),
    useSubjectValues: true,
  };

  const controller = createController({
    getTimeline: () => runner.getTimeline(),
    getCursorState: () => runner.getCursorState(),
    metric,
  });

  function updateSystemGraphTarget(nowMs = performance.now()) {
    const target = getSystemGraphTarget();
    const nextKey = getSystemGraphTargetKey(target);
    if (nextKey !== pendingSystemGraphTargetKey) {
      pendingSystemGraphTargetKey = nextKey;
      pendingSystemGraphTargetSinceMs = nowMs;
      return false;
    }
    if (nowMs - pendingSystemGraphTargetSinceMs < SYSTEM_GRAPH_TARGET_STABLE_MS) {
      return false;
    }
    if (nextKey === lastSystemGraphTargetKey) return false;
    lastSystemGraphTargetKey = nextKey;
    pendingSystemGraphTargetKey = null;
    pendingSystemGraphTargetSinceMs = 0;
    const state = runner.getCursorState?.();
    const resolved = buildSystemSeriesForTarget(target, state);
    controller.setSeries?.(resolved.series, resolved.label);
    controller.setSubject?.(target, nextKey);
    return true;
  }

  function refreshTargetThrottled(nowMs = performance.now()) {
    if (nowMs < nextSystemGraphTargetUpdateAtMs) return false;
    nextSystemGraphTargetUpdateAtMs = nowMs + SYSTEM_GRAPH_TARGET_UPDATE_MS;
    return updateSystemGraphTarget(nowMs);
  }

  function toggleGraphForHover(graphView) {
    if (!graphView) return { ok: false, reason: "noGraphView" };
    if (graphView.isOpen()) {
      graphView.close();
      return { ok: true, closed: true };
    }
    const now = performance.now();
    const initialTarget = getSystemGraphTarget();
    const initialKey = getSystemGraphTargetKey(initialTarget);
    pendingSystemGraphTargetKey = initialKey;
    pendingSystemGraphTargetSinceMs = now - SYSTEM_GRAPH_TARGET_STABLE_MS;
    nextSystemGraphTargetUpdateAtMs = 0;
    updateSystemGraphTarget(now);
    graphView.open();
    return { ok: true, opened: true };
  }

  return {
    controller,
    refreshTargetThrottled,
    toggleGraphForHover,
  };
}
