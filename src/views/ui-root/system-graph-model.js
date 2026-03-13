// src/views/ui-root/system-graph-model.js

import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { envTileDefs } from "../../defs/gamepieces/env-tiles-defs.js";
import { envStructureDefs } from "../../defs/gamepieces/env-structures-defs.js";
import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { itemTagDefs } from "../../defs/gamesystems/item-tag-defs.js";
import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../../defs/gamesystems/env-systems-defs.js";
import { hubSystemDefs } from "../../defs/gamesystems/hub-system-defs.js";
import { pawnSystemDefs } from "../../defs/gamesystems/pawn-systems-defs.js";
import {
  buildRecipePriorityFromSelectedRecipe,
  getEnabledRecipeIds,
  getTopEnabledRecipeId,
  normalizeRecipePriority,
} from "../../model/recipe-priority.js";
import {
  isProcessDropboxOwnerId,
  parseBasketDropboxOwnerId,
  parseHubDropboxOwnerId,
} from "../../model/owner-id-protocol.js";

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
const LEADER_FAITH_SYSTEM_ID = "leaderFaith";
const LEADER_FAITH_LABEL = "Faith";
const LEADER_FAITH_TIER_MAP = Object.freeze({
  bronze: 25,
  silver: 50,
  gold: 75,
  diamond: 100,
});
const ENV_SYSTEM_ICON_MAP = {
  build: "B",
  hydration: "H",
  fertility: "F",
  growth: "G",
  fishStock: "Fs",
  wildStock: "Ws",
  liveStock: "L",
  reserves: "O",
};
const HUB_SYSTEM_ICON_MAP = {
  build: "B",
  cook: "C",
  craft: "Cr",
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
  leaderFaith: "Fa",
};

function getTierValue(defs, systemId, tier) {
  const def = defs?.[systemId];
  const value = def?.tierMap?.[tier];
  return Number.isFinite(value) ? value : 0;
}

function sumMaturedPool(pool) {
  if (!pool || typeof pool !== "object") return 0;
  const hasTierKeys =
    Object.prototype.hasOwnProperty.call(pool, "bronze") ||
    Object.prototype.hasOwnProperty.call(pool, "silver") ||
    Object.prototype.hasOwnProperty.call(pool, "gold") ||
    Object.prototype.hasOwnProperty.call(pool, "diamond");
  if (hasTierKeys) {
    return (
      (pool?.bronze ?? 0) +
      (pool?.silver ?? 0) +
      (pool?.gold ?? 0) +
      (pool?.diamond ?? 0)
    );
  }
  let total = 0;
  for (const bucket of Object.values(pool)) {
    if (!bucket || typeof bucket !== "object") continue;
    total +=
      (bucket?.bronze ?? 0) +
      (bucket?.silver ?? 0) +
      (bucket?.gold ?? 0) +
      (bucket?.diamond ?? 0);
  }
  return total;
}

function getMaturedPoolBucketForCrop(pool, cropId) {
  if (!pool || typeof pool !== "object") return null;
  const hasTierKeys =
    Object.prototype.hasOwnProperty.call(pool, "bronze") ||
    Object.prototype.hasOwnProperty.call(pool, "silver") ||
    Object.prototype.hasOwnProperty.call(pool, "gold") ||
    Object.prototype.hasOwnProperty.call(pool, "diamond");
  if (hasTierKeys) return pool;
  if (typeof cropId !== "string" || cropId.length <= 0) return null;
  const bucket = pool[cropId];
  return bucket && typeof bucket === "object" ? bucket : null;
}

function getMaturedPoolBreakdown(pool, cropId = null) {
  const bucket = getMaturedPoolBucketForCrop(pool, cropId);
  if (!bucket || typeof bucket !== "object") {
    if (!pool || typeof pool !== "object") {
      return { bronze: 0, silver: 0, gold: 0, diamond: 0, total: 0 };
    }
    let bronze = 0;
    let silver = 0;
    let gold = 0;
    let diamond = 0;
    for (const value of Object.values(pool)) {
      if (!value || typeof value !== "object") continue;
      bronze += clampNonNegativeInt(value?.bronze);
      silver += clampNonNegativeInt(value?.silver);
      gold += clampNonNegativeInt(value?.gold);
      diamond += clampNonNegativeInt(value?.diamond);
    }
    return { bronze, silver, gold, diamond, total: bronze + silver + gold + diamond };
  }
  const bronze = clampNonNegativeInt(bucket?.bronze);
  const silver = clampNonNegativeInt(bucket?.silver);
  const gold = clampNonNegativeInt(bucket?.gold);
  const diamond = clampNonNegativeInt(bucket?.diamond);
  return { bronze, silver, gold, diamond, total: bronze + silver + gold + diamond };
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

function normalizeLeaderFaithTier(tier, fallbackTier = "gold") {
  return normalizeTier(tier, fallbackTier);
}

function getLeaderFaithValueForPawn(pawn) {
  if (!pawn || pawn.role !== "leader") return 0;
  const tier = normalizeLeaderFaithTier(pawn?.leaderFaith?.tier, "gold");
  const value = LEADER_FAITH_TIER_MAP[tier];
  return Number.isFinite(value) ? value : 0;
}

function shouldHidePawnSystemInTimegraph(systemId) {
  if (systemId === "leadership") return true;
  const def = pawnSystemDefs?.[systemId];
  return def?.ui?.hideInTooltip === true;
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

function findEnvStructureAtCol(snapshot, col) {
  const targetCol = Number.isFinite(col) ? Math.floor(col) : null;
  if (targetCol == null) return null;
  const occ = Array.isArray(snapshot?.board?.occ?.envStructure)
    ? snapshot.board.occ.envStructure
    : null;
  if (occ?.[targetCol]) return occ[targetCol];
  const anchors = Array.isArray(snapshot?.board?.layers?.envStructure?.anchors)
    ? snapshot.board.layers.envStructure.anchors
    : [];
  for (const anchor of anchors) {
    if (!anchor) continue;
    const base = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : 0;
    const def = anchor?.defId ? envStructureDefs?.[anchor.defId] : null;
    const span =
      Number.isFinite(anchor.span) && anchor.span > 0
        ? Math.floor(anchor.span)
        : Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
          ? Math.floor(def.defaultSpan)
          : 1;
    if (targetCol >= base && targetCol < base + Math.max(1, span)) {
      return anchor;
    }
  }
  return null;
}

function findPawnById(snapshot, id) {
  const pawns = snapshot?.pawns;
  if (!Array.isArray(pawns)) return null;
  for (const pawn of pawns) {
    if (!pawn) continue;
    if (String(pawn.id) === String(id)) return pawn;
  }
  return null;
}

function findHubColByOwnerId(snapshot, ownerId) {
  if (!snapshot || ownerId == null) return null;
  const target = String(ownerId);
  const occ = Array.isArray(snapshot?.hub?.occ) ? snapshot.hub.occ : null;
  if (occ) {
    for (let col = 0; col < occ.length; col += 1) {
      const structure = occ[col];
      if (!structure) continue;
      if (String(structure.instanceId) !== target) continue;
      return col;
    }
  }
  const slots = Array.isArray(snapshot?.hub?.slots) ? snapshot.hub.slots : null;
  if (!slots) return null;
  for (let col = 0; col < slots.length; col += 1) {
    const structure = slots[col]?.structure;
    if (!structure) continue;
    if (String(structure.instanceId) !== target) continue;
    return col;
  }
  return null;
}

function normalizeOwnerTargetId(ownerId) {
  if (ownerId == null) return null;
  let normalized = ownerId;
  const basket = parseBasketDropboxOwnerId(normalized);
  if (basket?.ownerId != null) {
    normalized = basket.ownerId;
  }
  const hubDropboxOwnerId = parseHubDropboxOwnerId(normalized);
  if (hubDropboxOwnerId != null) {
    normalized = hubDropboxOwnerId;
  }
  if (isProcessDropboxOwnerId(normalized)) {
    return null;
  }
  return normalized;
}

function resolveSystemGraphTargetFromOwnerId(snapshot, ownerId) {
  const normalized = normalizeOwnerTargetId(ownerId);
  if (normalized == null) return null;

  const pawn = findPawnById(snapshot, normalized);
  if (pawn) {
    return { kind: "pawn", id: pawn.id };
  }

  const hubCol = findHubColByOwnerId(snapshot, normalized);
  if (hubCol != null) {
    return { kind: "hub", col: hubCol };
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

function resolveEnvStructureForTooltip(snapshot, col) {
  if (!snapshot || !Number.isFinite(col)) return null;
  const index = Math.floor(col);
  return snapshot?.board?.occ?.envStructure?.[index] ?? findEnvStructureAtCol(snapshot, index);
}

function buildMaturedLegendTooltipSpec(cursorState, col) {
  const tile = resolveTileForTooltip(cursorState, col);
  const growth = tile?.systemState?.growth || {};
  const cropId = growth?.selectedCropId ?? null;
  const cropName = cropId ? cropDefs?.[cropId]?.name || cropId : "None";
  const pool = growth?.maturedPool || {};
  const breakdown = getMaturedPoolBreakdown(pool, cropId);
  return {
    title: "Matured",
    lines: [
      `Crop: ${cropName}`,
      `Total: ${breakdown.total}`,
      `Diamond: ${breakdown.diamond}`,
      `Gold: ${breakdown.gold}`,
      `Silver: ${breakdown.silver}`,
      `Bronze: ${breakdown.bronze}`,
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
    const breakdown = getMaturedPoolBreakdown(pool, cropId);
    lines.push(
      `Matured: ${breakdown.total} (D${breakdown.diamond} G${breakdown.gold} S${breakdown.silver} B${breakdown.bronze})`
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

  if (systemId === "cook" || systemId === "craft") {
    const normalizedPriority = normalizeRecipePriority(sysState?.recipePriority, {
      systemId,
      state: null,
      includeLocked: true,
    });
    const fallbackSelected =
      typeof sysState?.selectedRecipeId === "string" ? sysState.selectedRecipeId : null;
    const priority =
      normalizedPriority.ordered.length > 0
        ? normalizedPriority
        : buildRecipePriorityFromSelectedRecipe(fallbackSelected, {
            systemId,
            state: null,
            includeLocked: true,
          });
    const enabled = getEnabledRecipeIds(priority);
    const topRecipeId = getTopEnabledRecipeId(priority);
    const topRecipeName = topRecipeId
      ? recipeDefs?.[topRecipeId]?.name || topRecipeId
      : "None";
    const processes = Array.isArray(sysState?.processes) ? sysState.processes.length : 0;
    lines.push(`Tier: ${tier}`);
    lines.push(`Recipes enabled: ${enabled.length}`);
    lines.push(`Top priority: ${topRecipeName}`);
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
  const isLeaderFaith = systemId === LEADER_FAITH_SYSTEM_ID;
  const def = pawnSystemDefs?.[systemId];
  const title = isLeaderFaith ? LEADER_FAITH_LABEL : def?.ui?.name || systemId || "System";
  const lines = [];
  if (isLeaderFaith) {
    lines.push("Leader faith progression tier.");
    const faith = pawn?.leaderFaith;
    if (faith && typeof faith === "object") {
      const eatStreak = clampNonNegativeInt(faith?.eatStreak);
      const decayElapsedSec = clampNonNegativeInt(faith?.decayElapsedSec);
      lines.push(`Eat streak: ${eatStreak}`);
      lines.push(`Decay elapsed: ${decayElapsedSec}s`);
    }
    const tier = normalizeLeaderFaithTier(pawn?.leaderFaith?.tier, "gold");
    lines.push(`Tier: ${tier}`);
    return { title, lines };
  }

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
  if (target.kind === "envStructure") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    return {
      kind: "envStructure",
      col,
      envStructure: col != null ? findEnvStructureAtCol(snapshot, col) : null,
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
            lines: [
              "Hover a pawn, tile, env structure, or hub structure to inspect systems.",
            ],
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
  } else if (target.kind === "envStructure") {
    const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
    const structure = col != null ? resolveEnvStructureForTooltip(state, col) : null;
    const def = structure ? envStructureDefs[structure.defId] : null;
    label = def?.name || structure?.defId || `Env Structure ${col}`;
    targetKey = `envStructure:${col}`;

    const ids = new Set([
      ...Object.keys(structure?.systemState || {}),
      ...Object.keys(structure?.systemTiers || {}),
    ]);
    for (const systemId of ids.values()) {
      const defSys = envSystemDefs[systemId];
      const sysLabel = defSys?.ui?.name || systemId;
      const legendUi = getLegendUiForDomain("env", systemId, sysLabel);
      series.push({
        id: `${targetKey}:${systemId}`,
        label: sysLabel,
        color: SYSTEM_GRAPH_COLORS[series.length % SYSTEM_GRAPH_COLORS.length],
        legendIcon: legendUi.icon,
        legendLabel: legendUi.label,
        getLegendTooltipSpec: () => ({
          title: sysLabel,
          lines: [label],
        }),
        getValue: (snapshot) => {
          const s = col != null ? resolveEnvStructureForTooltip(snapshot, col) : null;
          const sysState = s?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            s?.systemTiers?.[systemId] ?? envSystemDefs[systemId]?.defaultTier;
          return getTierValue(envSystemDefs, systemId, tier);
        },
        getValueFromSnapshot: (snapshot, _subject, resolved) => {
          const s =
            (resolved?.kind === "envStructure" ? resolved.envStructure : null) ??
            (col != null ? findEnvStructureAtCol(snapshot, col) : null);
          const sysState = s?.systemState?.[systemId];
          if (Number.isFinite(sysState?.cur)) return sysState.cur;
          if (Number.isFinite(sysState?.value)) return sysState.value;
          const tier =
            s?.systemTiers?.[systemId] ?? envSystemDefs[systemId]?.defaultTier;
          return getTierValue(envSystemDefs, systemId, tier);
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
    if (pawn?.role === "leader") {
      ids.add(LEADER_FAITH_SYSTEM_ID);
    }
    for (const systemId of ids.values()) {
      const isLeaderFaith = systemId === LEADER_FAITH_SYSTEM_ID;
      if (!isLeaderFaith && shouldHidePawnSystemInTimegraph(systemId)) {
        continue;
      }
      const defSys = pawnSystemDefs[systemId];
      const sysLabel = isLeaderFaith
        ? LEADER_FAITH_LABEL
        : defSys?.ui?.name || systemId;
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
          if (isLeaderFaith) {
            return getLeaderFaithValueForPawn(p);
          }
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
          if (isLeaderFaith) {
            return getLeaderFaithValueForPawn(p);
          }
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
  forecastWorkerService = null,
}) {
  let lastSystemGraphTargetKey = null;
  let nextSystemGraphTargetUpdateAtMs = 0;
  let pendingSystemGraphTargetKey = null;
  let pendingSystemGraphTargetSinceMs = 0;
  let lockedTarget = null;

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
    if (hover.kind === "envStructure") {
      return { kind: "envStructure", col: hover.col };
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
    if (target.kind === "envStructure") {
      return `envStructure:${Math.floor(target.col ?? 0)}`;
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
    forecastWorkerService,
  });

  function applySystemGraphTarget(target, targetKey = null) {
    const resolvedKey = targetKey ?? getSystemGraphTargetKey(target);
    lastSystemGraphTargetKey = resolvedKey;
    pendingSystemGraphTargetKey = null;
    pendingSystemGraphTargetSinceMs = 0;
    const state = runner.getCursorState?.();
    const resolved = buildSystemSeriesForTarget(target, state);
    controller.setSeries?.(resolved.series, resolved.label);
    controller.setSubject?.(target, resolvedKey);
    return true;
  }

  function resolveExplicitTarget(snapshot, rawTarget) {
    if (!rawTarget || typeof rawTarget !== "object") return null;
    if (rawTarget.kind === "tile") {
      const col = Number.isFinite(rawTarget.col) ? Math.floor(rawTarget.col) : null;
      if (col == null) return null;
      return resolveTileForTooltip(snapshot, col) ? { kind: "tile", col } : null;
    }
    if (rawTarget.kind === "hub") {
      const col = Number.isFinite(rawTarget.col) ? Math.floor(rawTarget.col) : null;
      if (col == null) return null;
      return resolveHubStructureForTooltip(snapshot, col) ? { kind: "hub", col } : null;
    }
    if (rawTarget.kind === "envStructure") {
      const col = Number.isFinite(rawTarget.col) ? Math.floor(rawTarget.col) : null;
      if (col == null) return null;
      return resolveEnvStructureForTooltip(snapshot, col)
        ? { kind: "envStructure", col }
        : null;
    }
    if (rawTarget.kind === "pawn") {
      const id = rawTarget.id ?? null;
      if (id == null) return null;
      return findPawnById(snapshot, id) ? { kind: "pawn", id } : null;
    }
    return null;
  }

  function updateSystemGraphTarget(nowMs = performance.now()) {
    if (lockedTarget) {
      const lockedKey = getSystemGraphTargetKey(lockedTarget);
      if (lockedKey === lastSystemGraphTargetKey) return false;
      return applySystemGraphTarget(lockedTarget, lockedKey);
    }

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
    return applySystemGraphTarget(target, nextKey);
  }

  function refreshTargetThrottled(nowMs = performance.now()) {
    if (lockedTarget) {
      return updateSystemGraphTarget(nowMs);
    }
    if (nowMs < nextSystemGraphTargetUpdateAtMs) return false;
    nextSystemGraphTargetUpdateAtMs = nowMs + SYSTEM_GRAPH_TARGET_UPDATE_MS;
    return updateSystemGraphTarget(nowMs);
  }

  function toggleGraphForHover(graphView, opts = {}) {
    if (!graphView) return { ok: false, reason: "noGraphView" };
    const forceOpen = opts?.forceOpen === true;
    lockedTarget = null;
    if (graphView.isOpen() && !forceOpen) {
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
    if (graphView.isOpen()) {
      return { ok: true, opened: true, alreadyOpen: true };
    }
    graphView.open();
    return { ok: true, opened: true };
  }

  function toggleGraphForTarget(graphView, target, opts = {}) {
    if (!graphView) return { ok: false, reason: "noGraphView" };
    const forceOpen = opts?.forceOpen === true;
    const state = runner.getCursorState?.();
    const resolvedTarget = resolveExplicitTarget(state, target);
    if (!resolvedTarget) {
      return { ok: false, reason: "invalidTarget" };
    }

    lockedTarget = resolvedTarget;
    nextSystemGraphTargetUpdateAtMs = 0;
    const targetKey = getSystemGraphTargetKey(resolvedTarget);
    applySystemGraphTarget(resolvedTarget, targetKey);

    if (graphView.isOpen() && !forceOpen) {
      graphView.close();
      return { ok: true, closed: true, targetKey, target: resolvedTarget };
    }
    if (graphView.isOpen()) {
      return {
        ok: true,
        opened: true,
        alreadyOpen: true,
        targetKey,
        target: resolvedTarget,
      };
    }
    graphView.open();
    return { ok: true, opened: true, targetKey, target: resolvedTarget };
  }

  function toggleGraphForOwner(graphView, ownerId, opts = {}) {
    if (!graphView) return { ok: false, reason: "noGraphView" };
    const state = runner.getCursorState?.();
    const target = resolveSystemGraphTargetFromOwnerId(state, ownerId);
    if (!target) {
      return { ok: false, reason: "ownerTargetNotFound" };
    }
    return toggleGraphForTarget(graphView, target, opts);
  }

  return {
    controller,
    refreshTargetThrottled,
    toggleGraphForHover,
    toggleGraphForTarget,
    toggleGraphForOwner,
  };
}
