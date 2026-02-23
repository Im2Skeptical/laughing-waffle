// src/views/ui-root/system-graph-model.js

import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { envTileDefs } from "../../defs/gamepieces/env-tiles-defs.js";
import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { itemTagDefs } from "../../defs/gamesystems/item-tag-defs.js";
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
const TIER_ORDER = ["bronze", "silver", "gold", "diamond"];
const ENV_SYSTEM_ICON_MAP = {
  build: "B",
  hydration: "H",
  fertility: "F",
  growth: "G",
  fishStock: "Fi",
  wildStock: "W",
  liveStock: "L",
  reserves: "O",
};
const HUB_SYSTEM_ICON_MAP = {
  build: "B",
  fireplace: "F",
  workspace: "W",
  residents: "R",
  granaryStore: "G",
  storehouseStore: "S",
  storage: "S",
  faith: "Fa",
  deposit: "D",
  distribution: "Di",
};
const PAWN_SYSTEM_ICON_MAP = {
  stamina: "S",
  hunger: "H",
  leadership: "L",
};

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

function clampNonNegativeInt(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function formatNumericValue(value) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value - Math.round(value)) <= 0.001) {
    return String(Math.round(value));
  }
  return String(Math.round(value * 10) / 10);
}

function toInitials(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "?";
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase().slice(0, 2);
  }
  return raw.slice(0, 2).toUpperCase();
}

function isTierBucket(pool) {
  if (!pool || typeof pool !== "object") return false;
  for (const tier of TIER_ORDER) {
    if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
  }
  return false;
}

function normalizeTier(tier, fallbackTier = "bronze") {
  if (typeof tier === "string" && TIER_ORDER.includes(tier)) return tier;
  if (typeof fallbackTier === "string" && TIER_ORDER.includes(fallbackTier)) {
    return fallbackTier;
  }
  return "bronze";
}

function formatBuildRequirementLabel(req) {
  if (!req || typeof req !== "object") return "Material";
  if (req.kind === "item") {
    const def = itemDefs?.[req.itemId];
    return def?.name || req.itemId || "Item";
  }
  if (req.kind === "tag") {
    const def = itemTagDefs?.[req.tag];
    return def?.ui?.name || req.tag || "Tag";
  }
  if (req.kind === "resource") {
    const raw = String(req.resource || "resource");
    return raw.length ? raw[0].toUpperCase() + raw.slice(1) : "Resource";
  }
  return "Material";
}

function getBuildProcess(entity) {
  const processes = Array.isArray(entity?.systemState?.build?.processes)
    ? entity.systemState.build.processes
    : [];
  return processes.find((proc) => proc?.type === "build") ?? null;
}

function getStorageTotalsForPool(pool) {
  const byTier = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
  let total = 0;
  let kindCount = 0;
  if (!pool || typeof pool !== "object") {
    return { byTier, total, kindCount };
  }

  const accumulateBucket = (bucket) => {
    if (!bucket || typeof bucket !== "object") return;
    for (const tier of TIER_ORDER) {
      const amount = clampNonNegativeInt(bucket[tier]);
      byTier[tier] += amount;
      total += amount;
    }
  };

  if (isTierBucket(pool)) {
    kindCount = 1;
    accumulateBucket(pool);
    return { byTier, total, kindCount };
  }

  for (const key of Object.keys(pool)) {
    const bucket = pool[key];
    if (!bucket || typeof bucket !== "object") continue;
    kindCount += 1;
    accumulateBucket(bucket);
  }

  return { byTier, total, kindCount };
}

function getLegendUiForDomain(domain, systemId, fallbackLabel) {
  const label = String(fallbackLabel || systemId || "System");
  const map =
    domain === "env"
      ? ENV_SYSTEM_ICON_MAP
      : domain === "hub"
        ? HUB_SYSTEM_ICON_MAP
        : PAWN_SYSTEM_ICON_MAP;
  const mapped = map?.[systemId];
  return {
    label,
    icon: typeof mapped === "string" && mapped.trim() ? mapped : toInitials(label),
  };
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

function resolveTileForTooltip(snapshot, col) {
  if (!snapshot || !Number.isFinite(col)) return null;
  const index = Math.floor(col);
  return snapshot?.board?.occ?.tile?.[index] ?? findTileAnchorAtCol(snapshot, index);
}

function resolveHubStructureForTooltip(snapshot, col) {
  if (!snapshot || !Number.isFinite(col)) return null;
  const index = Math.floor(col);
  return (
    snapshot?.hub?.occ?.[index] ??
    snapshot?.hub?.slots?.[index]?.structure ??
    findHubStructureAtCol(snapshot, index)
  );
}

function buildMaturedLegendTooltipSpec(cursorState, col) {
  const tile = resolveTileForTooltip(cursorState, col);
  const growth = tile?.systemState?.growth || {};
  const pool = growth?.maturedPool || {};
  const total = sumMaturedPool(pool);
  const cropId = growth?.selectedCropId ?? null;
  const cropName = cropId ? cropDefs?.[cropId]?.name || cropId : "None";
  return {
    title: "Matured",
    lines: [
      `Crop: ${cropName}`,
      `Total: ${total}`,
      `Diamond: ${clampNonNegativeInt(pool?.diamond)}`,
      `Gold: ${clampNonNegativeInt(pool?.gold)}`,
      `Silver: ${clampNonNegativeInt(pool?.silver)}`,
      `Bronze: ${clampNonNegativeInt(pool?.bronze)}`,
    ],
  };
}

function buildEnvSystemLegendTooltipSpec(cursorState, col, systemId) {
  const tile = resolveTileForTooltip(cursorState, col);
  const def = envSystemDefs?.[systemId];
  const title = def?.ui?.name || systemId || "System";
  const lines = [];
  if (def?.ui?.description) lines.push(def.ui.description);

  const tier = normalizeTier(tile?.systemTiers?.[systemId], def?.defaultTier);
  const systemState = tile?.systemState || {};

  if (systemId === "hydration") {
    const hyd = systemState?.hydration || {};
    const cur = clampNonNegativeInt(hyd?.cur);
    const max = clampNonNegativeInt(hyd?.max);
    const decay = Number.isFinite(hyd?.decayPerSec) ? hyd.decayPerSec : 0;
    const ratio = max > 0 ? Math.round((cur / max) * 100) : 0;
    lines.push(`Tier: ${tier}`);
    lines.push(`Level: ${cur}/${max} (${ratio}%)`);
    lines.push(`Decay: ${formatNumericValue(decay)}/s`);
    if (Number.isFinite(hyd?.sumRatio)) {
      lines.push(`Accumulated: ${Math.round(hyd.sumRatio * 100) / 100}`);
    }
    return { title, lines };
  }

  if (systemId === "fertility") {
    lines.push(`Tier: ${tier}`);
    const value = def?.tierMap?.[tier];
    if (Number.isFinite(value)) lines.push(`Value: ${value}`);
    return { title, lines };
  }

  if (systemId === "growth") {
    const growth = systemState?.growth || {};
    const cropId = growth?.selectedCropId ?? null;
    const cropDef = cropId ? cropDefs?.[cropId] : null;
    const cropName = cropId ? cropDef?.name || cropId : "None";
    const hydrationTier = normalizeTier(
      tile?.systemTiers?.hydration,
      envSystemDefs?.hydration?.defaultTier
    );
    const fertilityTier = normalizeTier(
      tile?.systemTiers?.fertility,
      envSystemDefs?.fertility?.defaultTier
    );
    lines.push(`Crop: ${cropName}`);
    lines.push(`Hydration tier: ${hydrationTier}`);
    lines.push(`Fertility tier: ${fertilityTier}`);
    if (Number.isFinite(cropDef?.maturitySec)) {
      lines.push(`Maturity: ${cropDef.maturitySec}s`);
    }
    if (Number.isFinite(cropDef?.plantSeedPerSec)) {
      lines.push(`Plant rate: ${cropDef.plantSeedPerSec}/s`);
    }
    if (Number.isFinite(cropDef?.harvestUnitsPerSec)) {
      lines.push(`Harvest rate: ${cropDef.harvestUnitsPerSec}/s`);
    }
    const processes = Array.isArray(growth?.processes) ? growth.processes : [];
    if (processes.length) {
      const oldest = processes.reduce(
        (acc, process) =>
          acc == null || (process?.startSec ?? Infinity) < (acc?.startSec ?? Infinity)
            ? process
            : acc,
        null
      );
      const cursorSec = clampNonNegativeInt(cursorState?.tSec);
      const duration = clampNonNegativeInt(oldest?.durationSec || cropDef?.maturitySec || 0);
      const elapsed = Math.max(
        0,
        cursorSec - clampNonNegativeInt(oldest?.startSec ?? cursorSec)
      );
      const remaining = Math.max(0, duration - elapsed);
      lines.push(`Planting: ${processes.length} process(es)`);
      if (duration > 0) lines.push(`Matures in ~${duration}s`);
      lines.push(`ETA: ${remaining}s`);
    } else {
      lines.push("Planting: none");
    }
    const pool = growth?.maturedPool || {};
    lines.push(
      `Matured: ${sumMaturedPool(pool)} (D${clampNonNegativeInt(pool?.diamond)} G${clampNonNegativeInt(
        pool?.gold
      )} S${clampNonNegativeInt(pool?.silver)} B${clampNonNegativeInt(pool?.bronze)})`
    );
    return { title, lines };
  }

  if (systemId === "build") {
    const process = getBuildProcess(tile);
    if (!process) {
      lines.push("Progress: idle");
      return { title, lines };
    }
    const reqs = Array.isArray(process?.requirements) ? process.requirements : [];
    if (reqs.length) {
      lines.push("Materials:");
      for (const req of reqs) {
        const required = clampNonNegativeInt(req?.amount);
        const progress = clampNonNegativeInt(req?.progress);
        const label = formatBuildRequirementLabel(req);
        lines.push(`${label}: ${progress}/${required}`);
      }
    }
    lines.push(
      `Labor: ${clampNonNegativeInt(process?.progress)}/${Math.max(
        1,
        clampNonNegativeInt(process?.durationSec)
      )}`
    );
    return { title, lines };
  }

  lines.push(`Tier: ${tier}`);
  const value = def?.tierMap?.[tier];
  if (Number.isFinite(value)) lines.push(`Value: ${value}`);
  return { title, lines };
}

function buildHubSystemLegendTooltipSpec(cursorState, col, systemId) {
  const structure = resolveHubStructureForTooltip(cursorState, col);
  const def = hubSystemDefs?.[systemId];
  const title = def?.ui?.name || systemId || "System";
  const lines = [];
  if (def?.ui?.description) lines.push(def.ui.description);

  const sysState = structure?.systemState?.[systemId] || {};
  const tier = normalizeTier(structure?.systemTiers?.[systemId], def?.defaultTier);

  if (
    systemId === "storage" ||
    systemId === "granaryStore" ||
    systemId === "storehouseStore"
  ) {
    const pool = sysState?.byKindTier ?? sysState?.totalByTier ?? null;
    const totals = getStorageTotalsForPool(pool);
    lines.push(`Tier: ${tier}`);
    lines.push(`Total: ${totals.total}`);
    lines.push(`Kinds: ${totals.kindCount}`);
    lines.push(`Diamond: ${totals.byTier.diamond}`);
    lines.push(`Gold: ${totals.byTier.gold}`);
    lines.push(`Silver: ${totals.byTier.silver}`);
    lines.push(`Bronze: ${totals.byTier.bronze}`);
    return { title, lines };
  }

  if (systemId === "build") {
    const process = getBuildProcess(structure);
    lines.push(`Tier: ${tier}`);
    if (!process) {
      lines.push("Progress: idle");
      return { title, lines };
    }
    const reqs = Array.isArray(process?.requirements) ? process.requirements : [];
    if (reqs.length) {
      lines.push("Materials:");
      for (const req of reqs) {
        const required = clampNonNegativeInt(req?.amount);
        const progress = clampNonNegativeInt(req?.progress);
        const label = formatBuildRequirementLabel(req);
        lines.push(`${label}: ${progress}/${required}`);
      }
    }
    lines.push(
      `Labor: ${clampNonNegativeInt(process?.progress)}/${Math.max(
        1,
        clampNonNegativeInt(process?.durationSec)
      )}`
    );
    return { title, lines };
  }

  if (systemId === "fireplace" || systemId === "workspace") {
    const recipeId = typeof sysState?.selectedRecipeId === "string" ? sysState.selectedRecipeId : null;
    const recipeName = recipeId ? recipeDefs?.[recipeId]?.name || recipeId : "None";
    const processes = Array.isArray(sysState?.processes) ? sysState.processes.length : 0;
    lines.push(`Tier: ${tier}`);
    lines.push(`Recipe: ${recipeName}`);
    lines.push(`Active processes: ${processes}`);
    return { title, lines };
  }

  if (Number.isFinite(sysState?.cur) || Number.isFinite(sysState?.max)) {
    lines.push(
      `Level: ${formatNumericValue(sysState?.cur)}/${formatNumericValue(sysState?.max)}`
    );
  } else if (Number.isFinite(sysState?.value)) {
    lines.push(`Value: ${formatNumericValue(sysState?.value)}`);
  }
  lines.push(`Tier: ${tier}`);
  return { title, lines };
}

function buildPawnSystemLegendTooltipSpec(cursorState, pawnId, systemId) {
  const pawn = findPawnById(cursorState, pawnId);
  const def = pawnSystemDefs?.[systemId];
  const title = def?.ui?.name || systemId || "System";
  const lines = [];
  if (def?.ui?.description) lines.push(def.ui.description);

  const tier = normalizeTier(pawn?.systemTiers?.[systemId], def?.defaultTier);
  const sysState = pawn?.systemState?.[systemId] || def?.stateDefaults || {};
  if (Number.isFinite(sysState?.cur) || Number.isFinite(sysState?.max)) {
    lines.push(
      `Level: ${formatNumericValue(sysState?.cur)}/${formatNumericValue(sysState?.max)}`
    );
  } else if (Number.isFinite(sysState?.value)) {
    lines.push(`Value: ${formatNumericValue(sysState?.value)}`);
  }
  if (systemId === "hunger" && Number.isFinite(sysState?.belowThresholdSec)) {
    lines.push(`Below threshold: ${clampNonNegativeInt(sysState.belowThresholdSec)}s`);
  }
  lines.push(`Tier: ${tier}`);
  return { title, lines };
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
          legendIcon: "?",
          legendLabel: "No target",
          getLegendTooltipSpec: () => ({
            title: "No target",
            lines: ["Hover a pawn, tile, or hub structure to inspect systems."],
          }),
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
        const legendUi = getLegendUiForDomain("env", "growth", "Matured");
        series.push({
          id: `${targetKey}:matured`,
          label: "Matured",
          color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
          legendIcon: legendUi.icon,
          legendLabel: legendUi.label,
          getLegendTooltipSpec: (cursorState) =>
            buildMaturedLegendTooltipSpec(cursorState, col),
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
      const legendUi = getLegendUiForDomain("env", systemId, sysLabel);
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        legendIcon: legendUi.icon,
        legendLabel: legendUi.label,
        getLegendTooltipSpec: (cursorState) =>
          buildEnvSystemLegendTooltipSpec(cursorState, col, systemId),
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
      const legendUi = getLegendUiForDomain("hub", systemId, sysLabel);
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        legendIcon: legendUi.icon,
        legendLabel: legendUi.label,
        getLegendTooltipSpec: (cursorState) =>
          buildHubSystemLegendTooltipSpec(cursorState, col, systemId),
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
      const legendUi = getLegendUiForDomain("pawn", systemId, sysLabel);
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        legendIcon: legendUi.icon,
        legendLabel: legendUi.label,
        getLegendTooltipSpec: (cursorState) =>
          buildPawnSystemLegendTooltipSpec(cursorState, id, systemId),
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
      legendIcon: "?",
      legendLabel: "No systems",
      getLegendTooltipSpec: () => ({
        title: "No systems",
        lines: ["No systems are currently available for this target."],
      }),
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
