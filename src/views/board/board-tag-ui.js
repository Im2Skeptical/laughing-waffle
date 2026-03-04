// board-tag-ui.js
// Tag + system UI helpers for board tiles.

import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../../defs/gamesystems/env-systems-defs.js";
import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../../defs/gamesystems/item-tag-defs.js";
import {
  hasEnvTagUnlock,
  hasSkillFeatureUnlock,
} from "../../model/skills.js";
import { getDroppedItemKindsForPool } from "../../model/persistent-memory.js";
import { TILE_WIDTH } from "../layout-pixi.js";
import { getDisplayObjectWorldScale } from "../ui-helpers/display-object-scale.js";
import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { applyTextResolution } from "../ui-helpers/text-resolution.js";

const TAG_PILL_HEIGHT = 20;
const TAG_PILL_RADIUS = 10;
const TAG_PILL_PAD_X = 8;
const TAG_PILL_GAP = 6;
const TAG_PILL_MAX_WIDTH = TILE_WIDTH - 16;
const TAG_PILL_WIDTH = TAG_PILL_MAX_WIDTH;
const TAG_ACTION_SIZE = 12;
const TAG_ACTION_PAD = 6;
const TAG_LABEL_X = TAG_PILL_PAD_X;
const TAG_ROW_SCALE_ACTIVE = 1.05;
const TAG_PILL_BG_ACTIVE = MUCHA_UI_COLORS.surfaces.panelSoft;
const TAG_PILL_BG_TOP = MUCHA_UI_COLORS.surfaces.panelRaised;
const TAG_PILL_BG_LOW = MUCHA_UI_COLORS.surfaces.border;
const TAG_PILL_BG_BYPASSED = 0x5e3b34;
const TAG_PILL_BORDER_ACTIVE = MUCHA_UI_COLORS.surfaces.border;
const TAG_PILL_BORDER_TOP = MUCHA_UI_COLORS.surfaces.border;
const TAG_PILL_BORDER_LOW = MUCHA_UI_COLORS.surfaces.borderSoft;
const TAG_PILL_BORDER_BYPASSED = 0x8e5b53;
const TAG_PILL_TEXT = MUCHA_UI_COLORS.ink.primary;
const TAG_PILL_TEXT_LOW = MUCHA_UI_COLORS.ink.secondary;
const TAG_PILL_TEXT_BYPASSED = MUCHA_UI_COLORS.ink.alert;

const TAG_PILL_STYLES = {
  active: {
    bgColor: TAG_PILL_BG_ACTIVE,
    borderColor: TAG_PILL_BORDER_ACTIVE,
    textColor: TAG_PILL_TEXT,
    alpha: 1,
    rowScale: TAG_ROW_SCALE_ACTIVE,
  },
  topInactive: {
    bgColor: TAG_PILL_BG_TOP,
    borderColor: TAG_PILL_BORDER_TOP,
    textColor: TAG_PILL_TEXT,
    alpha: 0.95,
    rowScale: 1,
  },
  low: {
    bgColor: TAG_PILL_BG_LOW,
    borderColor: TAG_PILL_BORDER_LOW,
    textColor: TAG_PILL_TEXT_LOW,
    alpha: 0.7,
    rowScale: 1,
  },
  bypassed: {
    bgColor: TAG_PILL_BG_BYPASSED,
    borderColor: TAG_PILL_BORDER_BYPASSED,
    textColor: TAG_PILL_TEXT_BYPASSED,
    alpha: 0.9,
    rowScale: 1,
  },
};

const SYSTEM_ROW_HEIGHT = 18;
const SYSTEM_ROW_GAP = 4;
const SYSTEM_ICON_SIZE = 12;
const SYSTEM_BAR_HEIGHT = 8;
const SYSTEM_BAR_BG = MUCHA_UI_COLORS.surfaces.panelDeep;
const SYSTEM_BAR_BORDER = MUCHA_UI_COLORS.surfaces.borderSoft;
const SYSTEM_BAR_TEXT = MUCHA_UI_COLORS.ink.secondary;
const SYSTEM_BAR_RADIUS = 4;
const SYSTEM_BAR_RATIO_QUANT = 100;
const TAG_ACTION_COG_FILL = 0xa7afb8;
const TAG_ACTION_COG_STROKE = 0xdbe2e8;
const TAG_ACTION_COG_ICON = 0x4f5862;

const TIER_ORDER = ["bronze", "silver", "gold", "diamond"];
const TIER_METAL_GRADIENTS = Object.freeze({
  bronze: Object.freeze([
    Object.freeze({ at: 0, color: 0x5d3620 }),
    Object.freeze({ at: 0.25, color: 0x9e6842 }),
    Object.freeze({ at: 0.5, color: 0xc58a56 }),
    Object.freeze({ at: 0.75, color: 0x9b643f }),
    Object.freeze({ at: 1, color: 0x69402a }),
  ]),
  silver: Object.freeze([
    Object.freeze({ at: 0, color: 0x6a7079 }),
    Object.freeze({ at: 0.25, color: 0xa7afb8 }),
    Object.freeze({ at: 0.5, color: 0xdbe2e8 }),
    Object.freeze({ at: 0.75, color: 0x9ca5af }),
    Object.freeze({ at: 1, color: 0x626a73 }),
  ]),
  gold: Object.freeze([
    Object.freeze({ at: 0, color: 0x7a5b16 }),
    Object.freeze({ at: 0.25, color: 0xb88b1f }),
    Object.freeze({ at: 0.5, color: 0xe0be4c }),
    Object.freeze({ at: 0.75, color: 0xaf8220 }),
    Object.freeze({ at: 1, color: 0x735516 }),
  ]),
  diamond: Object.freeze([
    Object.freeze({ at: 0, color: 0x345060 }),
    Object.freeze({ at: 0.25, color: 0x6a8ea5 }),
    Object.freeze({ at: 0.5, color: 0xb8d4e8 }),
    Object.freeze({ at: 0.75, color: 0x5e8298 }),
    Object.freeze({ at: 1, color: 0x2e4959 }),
  ]),
});

const GROWTH_BAR_COLORS = {
  idle: 0x6f6651,
  planting: 0xcdb16d,
  maturing: 0x98ad77,
  harvesting: 0x6c8a58,
};

const SYSTEM_UI_MAP = {
  build: { label: "Build", icon: "B", color: 0x8f7a58 },
  hydration: { label: "Hydration", icon: "H", color: 0x8ea17f },
  fertility: { label: "Fertility", icon: "F", color: 0xb0875e },
  growth: { label: "Growth", icon: "G", color: 0x8ca66b },
  fishDensity: { label: "Fish", icon: "Fi", color: 0x7f9879 },
  turfDensity: { label: "Turf", icon: "T", color: 0x8ea377 },
  mineralRarity: { label: "Ore", icon: "O", color: 0xaa835e },
};

export const TAG_LAYOUT = {
  PILL_HEIGHT: TAG_PILL_HEIGHT,
  PILL_RADIUS: TAG_PILL_RADIUS,
  PILL_PAD_X: TAG_PILL_PAD_X,
  PILL_GAP: TAG_PILL_GAP,
  PILL_WIDTH: TAG_PILL_WIDTH,
};

export function createTagUi(opts) {
  const {
    interaction,
    tooltipView,
    getGameState,
    startTagDrag,
    setTextResolution,
    baseTextResolution,
    hoverTextResolution,
    requestPauseForAction,
    toggleTag,
    onProcessCogClick,
    isProcessWidgetSystem,
    onSystemIconHover,
    onSystemIconOut,
    onSystemIconClick,
  } = opts;

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function lerpChannel(from, to, ratio) {
    return Math.round(from + (to - from) * clamp01(ratio));
  }

  function lerpHexColor(fromColor, toColor, ratio) {
    const from = Number.isFinite(fromColor) ? Math.floor(fromColor) : 0;
    const to = Number.isFinite(toColor) ? Math.floor(toColor) : 0;
    const r = lerpChannel((from >> 16) & 0xff, (to >> 16) & 0xff, ratio);
    const g = lerpChannel((from >> 8) & 0xff, (to >> 8) & 0xff, ratio);
    const b = lerpChannel(from & 0xff, to & 0xff, ratio);
    return (r << 16) | (g << 8) | b;
  }

  function sampleGradientStops(stops, ratio) {
    if (!Array.isArray(stops) || stops.length === 0) return 0x8a7b64;
    if (stops.length === 1) return stops[0]?.color ?? 0x8a7b64;

    const t = clamp01(ratio);
    let prev = stops[0];
    for (let i = 1; i < stops.length; i += 1) {
      const next = stops[i];
      if (t <= (next?.at ?? 1)) {
        const startAt = Number.isFinite(prev?.at) ? prev.at : 0;
        const endAt = Number.isFinite(next?.at) ? next.at : 1;
        const span = Math.max(0.0001, endAt - startAt);
        const localT = clamp01((t - startAt) / span);
        return lerpHexColor(prev?.color ?? 0x8a7b64, next?.color ?? 0x8a7b64, localT);
      }
      prev = next;
    }
    return prev?.color ?? 0x8a7b64;
  }

  function getSystemTier(tileInst, systemId) {
    const tier = tileInst?.systemTiers?.[systemId];
    if (tier && TIER_ORDER.includes(tier)) return tier;
    const def = envSystemDefs[systemId];
    if (def?.defaultTier && TIER_ORDER.includes(def.defaultTier)) {
      return def.defaultTier;
    }
    return "bronze";
  }

  function formatTierLabel(tier) {
    const raw = typeof tier === "string" ? tier : "";
    if (!raw.length) return "Bronze";
    return raw[0].toUpperCase() + raw.slice(1);
  }

  function getSystemUi(systemId) {
    const entry = SYSTEM_UI_MAP[systemId];
    if (entry) return entry;
    const raw = String(systemId || "");
    const icon = raw ? raw.slice(0, 1).toUpperCase() : "?";
    return { label: raw || "System", icon, color: MUCHA_UI_COLORS.surfaces.border };
  }

  function getTagLabel(tagId) {
    const def = envTagDefs[tagId];
    return def?.ui?.name || tagId;
  }

  function isProcessWidgetCapableSystem(systemId) {
    return isProcessWidgetSystem?.(systemId) === true;
  }

  function resolveProcessWidgetSystemIdForTagSystems(systems) {
    if (!Array.isArray(systems) || systems.length <= 0) return null;
    for (const systemId of systems) {
      if (!isProcessWidgetCapableSystem(systemId)) continue;
      return systemId;
    }
    return null;
  }

  function isTagUnlocked(tagId) {
    if (typeof tagId !== "string" || !tagId.length) return false;
    const state = getGameState?.();
    if (!state) return true;
    return hasEnvTagUnlock(state, tagId);
  }

  function getVisibleTags(tileInst) {
    const tags = Array.isArray(tileInst?.tags) ? tileInst.tags : [];
    return tags.filter(
      (tagId) => isTagUnlocked(tagId) && !isTagPlayerDisabled(tileInst, tagId)
    );
  }

  function isTagDisabled(tileInst, tagId) {
    if (!isTagUnlocked(tagId)) return true;
    const entry = tileInst?.tagStates?.[tagId];
    return entry?.disabled === true;
  }

  function isTagPlayerDisabled(tileInst, tagId) {
    if (!isTagUnlocked(tagId)) return true;
    const entry = tileInst?.tagStates?.[tagId];
    if (!entry || typeof entry !== "object") return false;
    const disabledBy =
      entry.disabledBy && typeof entry.disabledBy === "object"
        ? entry.disabledBy
        : null;
    if (disabledBy) return disabledBy.player === true;
    return entry.disabled === true;
  }

  function getHydrationRatio(tileInst) {
    const hyd = tileInst?.systemState?.hydration;
    const cur = Number.isFinite(hyd?.cur) ? hyd.cur : 0;
    const max = Number.isFinite(hyd?.max) ? hyd.max : 0;
    if (max <= 0) return 0;
    return clamp01(cur / max);
  }

  function sumMaturedPool(pool) {
    if (!pool || typeof pool !== "object") return 0;
    if (
      Object.prototype.hasOwnProperty.call(pool, "bronze") ||
      Object.prototype.hasOwnProperty.call(pool, "silver") ||
      Object.prototype.hasOwnProperty.call(pool, "gold") ||
      Object.prototype.hasOwnProperty.call(pool, "diamond")
    ) {
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
    if (
      Object.prototype.hasOwnProperty.call(pool, "bronze") ||
      Object.prototype.hasOwnProperty.call(pool, "silver") ||
      Object.prototype.hasOwnProperty.call(pool, "gold") ||
      Object.prototype.hasOwnProperty.call(pool, "diamond")
    ) {
      return pool;
    }
    if (typeof cropId === "string" && cropId.length > 0) {
      const bucket = pool[cropId];
      if (bucket && typeof bucket === "object") return bucket;
    }
    return null;
  }

  function getGrowthProcessCropId(process) {
    if (!process || typeof process !== "object") return null;
    if (typeof process.defId === "string" && process.defId.length > 0) {
      return process.defId;
    }
    if (typeof process.cropId === "string" && process.cropId.length > 0) {
      return process.cropId;
    }
    return null;
  }

  function formatCompactCount(value) {
    const num = Number.isFinite(value) ? value : 0;
    if (num >= 1000) return `${Math.floor(num / 100) / 10}k`;
    return String(Math.floor(num));
  }

  function getBuildProcess(tileInst) {
    const processes = Array.isArray(tileInst?.systemState?.build?.processes)
      ? tileInst.systemState.build.processes
      : [];
    return processes.find((proc) => proc?.type === "build") ?? null;
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
      const raw = String(req.resource || "Resource");
      return raw.length ? raw[0].toUpperCase() + raw.slice(1) : "Resource";
    }
    return "Material";
  }

  function getItemDisplayNameByKind(kind) {
    if (typeof kind !== "string" || !kind.length) return "Item";
    const defName = itemDefs?.[kind]?.name;
    if (typeof defName === "string" && defName.trim().length > 0) return defName;
    return kind;
  }

  function collectDropTableKeysFromEffect(effect, out) {
    if (Array.isArray(effect)) {
      for (const entry of effect) {
        collectDropTableKeysFromEffect(entry, out);
      }
      return;
    }
    if (!effect || typeof effect !== "object") return;
    if (effect.op === "SpawnFromDropTable") {
      const tableKey =
        typeof effect.tableKey === "string" && effect.tableKey.length > 0
          ? effect.tableKey
          : "forageDrops";
      out.add(tableKey);
    }
  }

  function getTagDropTableKeys(tagDef) {
    const out = new Set();
    const intents = Array.isArray(tagDef?.intents) ? tagDef.intents : [];
    for (const intent of intents) {
      collectDropTableKeysFromEffect(intent?.effect, out);
    }
    return Array.from(out.values()).sort((a, b) => a.localeCompare(b));
  }

  function buildDroppedItemsTooltipLines(tileInst, tagDef) {
    const state = getGameState?.();
    if (!state) return [];
    if (!hasSkillFeatureUnlock(state, "ui.tooltip.droppedItems")) return [];

    const tileDefId = typeof tileInst?.defId === "string" ? tileInst.defId : null;
    if (!tileDefId) return [];

    const tableKeys = getTagDropTableKeys(tagDef);
    if (tableKeys.length <= 0) return [];

    const discoveredItemKinds = [];
    const seenKinds = new Set();

    for (const tableKey of tableKeys) {
      const kinds = getDroppedItemKindsForPool(state, { tableKey, tileDefId });
      for (const kind of kinds) {
        if (seenKinds.has(kind)) continue;
        seenKinds.add(kind);
        discoveredItemKinds.push(kind);
      }
    }

    discoveredItemKinds.sort((a, b) => a.localeCompare(b));

    const lines = ["Dropped Items:"];
    if (discoveredItemKinds.length <= 0) {
      lines.push("- none yet");
      return lines;
    }

    for (const kind of discoveredItemKinds) {
      lines.push(`- ${getItemDisplayNameByKind(kind)}`);
    }
    return lines;
  }

  function buildRowsForBuildProcess(tileInst) {
    const process = getBuildProcess(tileInst);
    if (!process) return [{ kind: "labor" }];
    const reqs = Array.isArray(process.requirements)
      ? process.requirements.filter(
          (req) => Math.max(0, Math.floor(req?.amount ?? 0)) > 0
        )
      : [];
    if (reqs.length > 0) {
      let hasRemaining = false;
      for (const req of reqs) {
        const required = Math.max(0, Math.floor(req?.amount ?? 0));
        const progress = Math.max(0, Math.floor(req?.progress ?? 0));
        if (progress < required) {
          hasRemaining = true;
          break;
        }
      }
      if (hasRemaining) {
        return reqs.map((req, index) => ({
          kind: "requirement",
          index,
          label: formatBuildRequirementLabel(req),
        }));
      }
    }
    return [{ kind: "labor" }];
  }

  function getBuildRowSignature(rows) {
    return rows.map((row) => `${row.kind}:${row.index ?? ""}`).join("|");
  }

  function buildTagTooltipLines(tileInst, tagId) {
    const tagDef = envTagDefs[tagId];
    const lines = [];
    if (tagDef?.ui?.description) lines.push(tagDef.ui.description);
    const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
    if (systems.length) {
      for (const sys of systems) {
        const tier = getSystemTier(tileInst, sys);
        const sysDef = envSystemDefs[sys];
        const value = sysDef?.tierMap && tier ? sysDef.tierMap[tier] : null;
        const label = getSystemUi(sys).label;
        if (value != null) {
          lines.push(`${label}: ${tier} (${value})`);
        } else {
          lines.push(`${label}: ${tier}`);
        }
      }
    }
    const droppedItemLines = buildDroppedItemsTooltipLines(tileInst, tagDef);
    if (droppedItemLines.length > 0) {
      lines.push(...droppedItemLines);
    }
    return lines;
  }

  function buildSystemTooltipLines(tileInst, systemId) {
    const lines = [];
    const systemState = tileInst?.systemState || {};
    const systemDef = envSystemDefs[systemId];
    if (systemDef?.ui?.description) {
      lines.push(systemDef.ui.description);
    }
    if (systemId === "hydration") {
      const hyd = systemState.hydration || {};
      const cur = Number.isFinite(hyd.cur) ? Math.floor(hyd.cur) : 0;
      const max = Number.isFinite(hyd.max) ? Math.floor(hyd.max) : 0;
      const decay = Number.isFinite(hyd.decayPerSec) ? hyd.decayPerSec : 0;
      const tier = getSystemTier(tileInst, systemId);
      const ratio = max > 0 ? cur / max : 0;
      lines.push(`Tier: ${tier}`);
      lines.push(`Level: ${cur}/${max} (${Math.round(ratio * 100)}%)`);
      lines.push(`Decay: ${decay}/s`);
      if (Number.isFinite(hyd.sumRatio)) {
        lines.push(`Accumulated: ${hyd.sumRatio.toFixed(2)}`);
      }
      return lines;
    }

    if (systemId === "fertility") {
      const tier = getSystemTier(tileInst, systemId);
      const def = envSystemDefs[systemId];
      const value = def?.tierMap?.[tier];
      lines.push(`Tier: ${tier}`);
      if (value != null) lines.push(`Value: ${value}`);
      return lines;
    }

    if (systemId === "growth") {
      const growth = systemState.growth || {};
      const cropId = growth.selectedCropId ?? null;
      const cropDef = cropId ? cropDefs[cropId] : null;
      const cropName = cropId ? cropDef?.name || cropId : "None";
      const fertilityTier = getSystemTier(tileInst, "fertility");
      const hydrationTier = getSystemTier(tileInst, "hydration");
      lines.push(`Crop: ${cropName}`);
      lines.push(`Hydration tier: ${hydrationTier}`);
      lines.push(`Fertility tier: ${fertilityTier}`);
      if (cropDef) {
        const seasons = Array.isArray(cropDef.plantSeasons)
          ? cropDef.plantSeasons.join(", ")
          : "any";
        lines.push(`Seasons: ${seasons}`);
        if (Number.isFinite(cropDef.maturitySec)) {
          lines.push(`Maturity: ${cropDef.maturitySec}s`);
        }
        if (Number.isFinite(cropDef.plantSeedPerSec)) {
          lines.push(`Plant rate: ${cropDef.plantSeedPerSec}/s`);
        }
        if (Number.isFinite(cropDef.harvestUnitsPerSec)) {
          lines.push(`Harvest rate: ${cropDef.harvestUnitsPerSec}/s`);
        }
        if (Number.isFinite(cropDef.baseYieldMultiplier)) {
          lines.push(`Base yield: ${cropDef.baseYieldMultiplier}x`);
        }
        const table =
          cropDef.qualityTablesByFertilityTier?.[fertilityTier];
        if (Array.isArray(table) && table.length) {
          const odds = table
            .map((entry) => {
              const tierLabel = entry?.tier
                ? entry.tier[0].toUpperCase()
                : "?";
              const weight = Number.isFinite(entry?.weight)
                ? Math.round(entry.weight * 100)
                : 0;
              return `${tierLabel}${weight}%`;
            })
            .join(" ");
          lines.push(`Quality odds: ${odds}`);
        }
      }
      const processesRaw = Array.isArray(growth.processes) ? growth.processes : [];
      const processes =
        typeof cropId === "string" && cropId.length > 0
          ? processesRaw.filter((proc) => getGrowthProcessCropId(proc) === cropId)
          : processesRaw;
      if (processes.length) {
        const oldest = processes.reduce(
          (acc, p) =>
            acc == null || p.startSec < acc.startSec ? p : acc,
          null
        );
        if (oldest) {
          const fallback =
            Number.isFinite(cropDef?.maturitySec) ? cropDef.maturitySec : 32;
          const duration = Number.isFinite(oldest.durationSec)
            ? Math.floor(oldest.durationSec)
            : fallback;
          const nowSec = Math.floor(getGameState?.()?.tSec ?? 0);
          const elapsed = Math.max(
            0,
            Math.floor(nowSec - Math.floor(oldest.startSec ?? nowSec))
          );
          const remaining = Math.max(0, duration - elapsed);
          lines.push(`Planting: ${processes.length} process(es)`);
          lines.push(`Matures in ~${duration}s`);
          if (Number.isFinite(remaining)) {
            lines.push(`ETA: ${remaining}s`);
          }
        }
      } else {
        lines.push("Planting: none");
      }
      const pool = getMaturedPoolBucketForCrop(growth.maturedPool, cropId) || {};
      const total =
        (pool.bronze ?? 0) +
        (pool.silver ?? 0) +
        (pool.gold ?? 0) +
        (pool.diamond ?? 0);
      lines.push(
        `Matured: ${total} (D${pool.diamond ?? 0} G${pool.gold ?? 0} S${
          pool.silver ?? 0
        } B${pool.bronze ?? 0})`
      );
      return lines;
    }

    if (systemId === "build") {
      const process = getBuildProcess(tileInst);
      if (!process) {
        lines.push("Progress: idle");
        return lines;
      }
      const reqs = Array.isArray(process.requirements)
        ? process.requirements
        : [];
      if (reqs.length > 0) {
        lines.push("Materials:");
        for (const req of reqs) {
          const required = Math.max(0, Math.floor(req?.amount ?? 0));
          const progress = Math.max(0, Math.floor(req?.progress ?? 0));
          const label = formatBuildRequirementLabel(req);
          lines.push(`${label}: ${progress}/${required}`);
        }
      }
      const progress = Math.max(0, Math.floor(process.progress ?? 0));
      const duration = Math.max(1, Math.floor(process.durationSec ?? 1));
      lines.push(`Labor: ${progress}/${duration}`);
      return lines;
    }

    const tier = getSystemTier(tileInst, systemId);
    lines.push(`Tier: ${tier}`);
    return lines;
  }

  function showTooltipForTag(tileInst, tagId, bounds, scale = 1) {
    if (!tooltipView || !interaction?.canShowHoverUI?.()) return;
    const label = getTagLabel(tagId);
    const lines = buildTagTooltipLines(tileInst, tagId);
    tooltipView.show({ title: label, lines, scale }, bounds);
  }

  function showTooltipForSystem(tileInst, systemId, bounds, scale = 1) {
    if (!tooltipView || !interaction?.canShowHoverUI?.()) return;
    const label = getSystemUi(systemId).label;
    const lines = buildSystemTooltipLines(tileInst, systemId);
    tooltipView.show({ title: label, lines, scale }, bounds);
  }

  function flashSystemRow(row) {
    if (!row?.flashOverlay) return;
    if (row.flashTimeout) {
      clearTimeout(row.flashTimeout);
      row.flashTimeout = null;
    }
    row.flashOverlay.clear();
    row.flashOverlay
      .lineStyle(2, 0xff4f5e, 1)
      .beginFill(0x8a1f2a, 0.25)
      .drawRoundedRect(0, 0, TAG_PILL_WIDTH, SYSTEM_ROW_HEIGHT, 4)
      .endFill();
    row.flashOverlay.alpha = 1;
    row.flashOverlay.visible = true;
    row.flashTimeout = setTimeout(() => {
      row.flashOverlay.visible = false;
      row.flashTimeout = null;
    }, 160);
  }

  function buildSystemRow(view, systemId, opts = null) {
    const ui = getSystemUi(systemId);
    const processWidgetSystemId =
      typeof opts?.processSystemId === "string" && opts.processSystemId.length > 0
        ? opts.processSystemId
        : systemId;
    const container = new PIXI.Container();
    container.eventMode = "static";
    container.hitArea = new PIXI.Rectangle(
      0,
      0,
      TAG_PILL_WIDTH,
      SYSTEM_ROW_HEIGHT
    );
    container.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
    });

    const icon = new PIXI.Container();
    icon.eventMode = "static";
    icon.cursor =
      onSystemIconClick || onSystemIconHover || onSystemIconOut
        ? "pointer"
        : "help";

    const iconBg = new PIXI.Graphics()
      .lineStyle(1, TAG_PILL_BORDER_LOW, 0.8)
      .beginFill(ui.color, 1)
      .drawCircle(
        SYSTEM_ICON_SIZE / 2,
        SYSTEM_ROW_HEIGHT / 2,
        SYSTEM_ICON_SIZE / 2
      )
      .endFill();
    const iconText = new PIXI.Text(ui.icon, {
      fill: 0xffffff,
      fontSize: 8,
      fontWeight: "bold",
    });
    applyTextResolution(iconText, 1.5);
    iconText.anchor.set(0.5, 0.5);
    iconText.x = SYSTEM_ICON_SIZE / 2;
    iconText.y = SYSTEM_ROW_HEIGHT / 2;
    icon.addChild(iconBg, iconText);
    container.addChild(icon);

    const barX = SYSTEM_ICON_SIZE + 6;
    const barWidth = TAG_PILL_WIDTH - barX - 6;
    const barHeight = SYSTEM_BAR_HEIGHT;
    const barY = Math.floor((SYSTEM_ROW_HEIGHT - barHeight) / 2);
    const barRadius = SYSTEM_BAR_RADIUS;

    const barBg = new PIXI.Graphics()
      .lineStyle(1, SYSTEM_BAR_BORDER, 0.9)
      .beginFill(SYSTEM_BAR_BG, 0.95)
      .drawRoundedRect(
        barX,
        barY,
        barWidth,
        barHeight,
        barRadius
      )
      .endFill();
    const barFill = new PIXI.Graphics();
    container.addChild(barBg, barFill);

    const labelText = new PIXI.Text("", {
      fill: SYSTEM_BAR_TEXT,
      fontSize: 9,
    });
    labelText.anchor.set(0.5, 0.5);
    labelText.x = barX + Math.floor(barWidth / 2);
    labelText.y = barY + Math.floor(barHeight / 2);
    container.addChild(labelText);

    const flashOverlay = new PIXI.Graphics();
    flashOverlay.visible = false;
    container.addChild(flashOverlay);

    const row = {
      systemId,
      processWidgetSystemId,
      container,
      icon,
      barBg,
      barFill,
      barX,
      barWidth,
      barY,
      barHeight,
      barRadius,
      labelText,
      iconText,
      uiColor: ui.color,
      lastCropId: null,
      lastMaturedMax: 0,
      lastLabelText: null,
      lastBarRenderKey: null,
      flashOverlay,
      flashTimeout: null,
      buildKind: opts?.kind ?? null,
      buildReqIndex: Number.isFinite(opts?.index) ? opts.index : null,
      buildLabel: opts?.label ?? null,
    };

    icon.on("pointerover", () => {
      onSystemIconHover?.(view, processWidgetSystemId);
      showTooltipForSystem(
        view.tile,
        systemId,
        icon.getBounds(),
        getDisplayObjectWorldScale(icon, 1)
      );
    });
    icon.on("pointerout", () => {
      onSystemIconOut?.(view, processWidgetSystemId);
      tooltipView?.hide?.();
    });
    icon.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
    });
    icon.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      onSystemIconClick?.(view, processWidgetSystemId);
    });

    return row;
  }

  function buildTagEntry(view, tagId, tileInst) {
    const tagDef = envTagDefs[tagId];
    const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
    const processWidgetSystemId = resolveProcessWidgetSystemIdForTagSystems(systems);
    const actionMode = processWidgetSystemId ? "cog" : "none";

    const container = new PIXI.Container();
    const row = new PIXI.Container();
    row.eventMode = "static";
    row.cursor = "pointer";
    container.addChild(row);

    const bg = new PIXI.Graphics()
      .lineStyle(1, TAG_PILL_BORDER_LOW, 0.9)
      .beginFill(TAG_PILL_BG_LOW, 0.95)
      .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
      .endFill();
    row.addChild(bg);

    const label = getTagLabel(tagId);
    const labelText = new PIXI.Text(label, {
      fill: TAG_PILL_TEXT,
      fontSize: 10,
      wordWrap: false,
    });
    labelText.x = TAG_LABEL_X;
    labelText.y = Math.round((TAG_PILL_HEIGHT - labelText.height) / 2);
    row.addChild(labelText);

    const actionControl = new PIXI.Container();
    actionControl.x = TAG_PILL_WIDTH - TAG_ACTION_SIZE - TAG_ACTION_PAD;
    actionControl.y = Math.round((TAG_PILL_HEIGHT - TAG_ACTION_SIZE) / 2);
    actionControl.eventMode = actionMode === "cog" ? "static" : "none";
    actionControl.cursor = actionMode === "cog" ? "pointer" : "default";
    actionControl.visible = actionMode === "cog";
    row.addChild(actionControl);

    const actionBg = new PIXI.Graphics();
    actionControl.addChild(actionBg);

    const actionIcon = new PIXI.Graphics();
    actionControl.addChild(actionIcon);

    const systemContainer = new PIXI.Container();
    systemContainer.y = TAG_PILL_HEIGHT + 4;
    container.addChild(systemContainer);

    const systemRows = [];
    let sysY = 0;
    let buildRowSignature = null;
    if (tagId === "build" && tileInst) {
      const rows = buildRowsForBuildProcess(tileInst);
      buildRowSignature = getBuildRowSignature(rows);
      for (const rowSpec of rows) {
        const rowEntry = buildSystemRow(view, "build", rowSpec);
        rowEntry.container.y = sysY;
        systemContainer.addChild(rowEntry.container);
        systemRows.push(rowEntry);
        sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
      }
    } else {
      for (const systemId of systems) {
        const rowEntry = buildSystemRow(view, systemId);
        rowEntry.container.y = sysY;
        systemContainer.addChild(rowEntry.container);
        systemRows.push(rowEntry);
        sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
      }
    }

    const entry = {
      tagId,
      tagDef,
      container,
      row,
      bg,
      bgColor: TAG_PILL_BG_LOW,
      borderColor: TAG_PILL_BORDER_LOW,
      labelText,
      actionControl,
      actionBg,
      actionIcon,
      actionMode,
      lastActionVisualKey: null,
      processWidgetSystemId,
      rowScale: 1,
      systemContainer,
      systemRows,
      expanded: false,
      systemHeight: sysY > 0 ? sysY - SYSTEM_ROW_GAP : 0,
      height: TAG_PILL_HEIGHT,
      buildRowSignature,
    };

    entry.setExpanded = (expanded) => {
      entry.expanded = !!expanded;
    };

    if (actionMode === "cog") {
      actionControl.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        view.ignoreNextTagTap = true;
      });
      actionControl.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        view.ignoreNextTagTap = true;
        requestPauseForAction?.();
        onProcessCogClick?.(view, processWidgetSystemId);
      });
    }

    row.on("pointerover", () => {
      showTooltipForTag(
        view.tile,
        tagId,
        row.getBounds(),
        getDisplayObjectWorldScale(row, 1)
      );
    });
    row.on("pointerout", () => {
      tooltipView?.hide?.();
    });
    row.on("pointerdown", (ev) => {
      if (view.ignoreNextTagTap) view.ignoreNextTagTap = false;
      startTagDrag?.(view, entry, ev);
    });
    row.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      if (view.ignoreNextTagTap) {
        view.ignoreNextTagTap = false;
        return;
      }
      const nextTagId = view.expandedTagId === entry.tagId ? null : entry.tagId;
      if (applyExpandedTag(view, nextTagId)) {
        layoutTagEntries(view);
      }
    });

    return entry;
  }

  function drawCogVisual(icon, strokeColor) {
    if (!icon) return;
    const cx = TAG_ACTION_SIZE / 2;
    const cy = TAG_ACTION_SIZE / 2;
    const innerR = 2.4;
    const outerR = 4.4;
    icon.clear();
    icon.lineStyle(1, strokeColor, 1);
    icon.drawCircle(cx, cy, innerR);
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      const x0 = cx + Math.cos(angle) * (outerR - 0.6);
      const y0 = cy + Math.sin(angle) * (outerR - 0.6);
      const x1 = cx + Math.cos(angle) * (outerR + 1.6);
      const y1 = cy + Math.sin(angle) * (outerR + 1.6);
      icon.moveTo(x0, y0);
      icon.lineTo(x1, y1);
    }
  }

  function updateActionVisual(entry, isDisabled) {
    if (!entry?.actionBg || !entry?.actionIcon) return;
    const visualKey = entry.actionMode === "cog" ? "cog" : "none";
    if (entry.lastActionVisualKey === visualKey) return;
    entry.lastActionVisualKey = visualKey;
    if (entry.actionMode === "cog") {
      entry.actionBg.clear();
      entry.actionBg
        .lineStyle(1, TAG_ACTION_COG_STROKE, 0.9)
        .beginFill(TAG_ACTION_COG_FILL, 0.98)
        .drawRoundedRect(0, 0, TAG_ACTION_SIZE, TAG_ACTION_SIZE, 3)
        .endFill();
      drawCogVisual(entry.actionIcon, TAG_ACTION_COG_ICON);
      return;
    }
    entry.actionBg.clear();
    entry.actionIcon.clear();
  }

  function setTagPillStyle(entry, style) {
    if (!entry || !style) return;
    const bgColor = style.bgColor ?? TAG_PILL_BG_LOW;
    const borderColor = style.borderColor ?? TAG_PILL_BORDER_LOW;
    const textColor = style.textColor ?? TAG_PILL_TEXT;
    const alpha = style.alpha ?? 1;
    const rowScale = style.rowScale ?? 1;

    if (entry.bgColor !== bgColor || entry.borderColor !== borderColor) {
      entry.bg.clear();
      entry.bg
        .lineStyle(1, borderColor, 0.9)
        .beginFill(bgColor, 0.95)
        .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
        .endFill();
      entry.bgColor = bgColor;
      entry.borderColor = borderColor;
    }

    if (entry.labelText?.style?.fill !== textColor) {
      entry.labelText.style.fill = textColor;
      entry.labelText.dirty = true;
    }
    entry.container.alpha = alpha;

    if (entry.rowScale !== rowScale) {
      entry.rowScale = rowScale;
      entry.row.scale.set(rowScale);
      if (entry.systemContainer) {
        entry.systemContainer.y = TAG_PILL_HEIGHT * rowScale + 4;
      }
    }
  }

  function layoutTagEntries(view) {
    const entries = view.tagEntries || [];
    let totalContentHeight = 0;
    let expandedContentBottomY = 0;
    for (const entry of entries) {
      if (!entry) continue;
      const rowScale = entry.rowScale ?? 1;
      const rowHeight = TAG_PILL_HEIGHT * rowScale;
      let entryHeight = rowHeight;
      if (entry.expanded && entry.systemRows.length > 0) {
        let sysY = 0;
        for (const row of entry.systemRows) {
          row.container.visible = true;
          row.container.y = sysY;
          sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
        }
        if (sysY > 0) sysY -= SYSTEM_ROW_GAP;
        entry.systemContainer.visible = sysY > 0;
        entryHeight = rowHeight + (sysY > 0 ? sysY + 4 : 0);
      } else {
        entry.systemContainer.visible = false;
        for (const row of entry.systemRows) {
          row.container.visible = false;
        }
      }
      entry.height = entryHeight;
      totalContentHeight += entryHeight + TAG_PILL_GAP;
      if (entry.expanded) {
        expandedContentBottomY = Math.max(expandedContentBottomY, totalContentHeight);
      }
    }
    if (totalContentHeight > 0) totalContentHeight -= TAG_PILL_GAP;

    let y = 0;
    for (const entry of entries) {
      if (!entry) continue;
      const entryHeight = entry.height ?? TAG_PILL_HEIGHT;
      entry.container.visible = true;
      entry.container.x = 0;
      entry.container.y = y;
      y += entryHeight + TAG_PILL_GAP;
    }
    view.totalContentHeight = Math.max(0, totalContentHeight);
    view.expandedContentBottomY = Math.max(0, expandedContentBottomY);
    return {
      totalContentHeight: view.totalContentHeight,
      expandedContentBottomY: view.expandedContentBottomY,
    };
  }

  function drawSystemBar(row, ratio, color) {
    const width = row.barWidth * clamp01(ratio);
    row.barFill.clear();
    if (width <= 0) return;
    row.barFill.beginFill(color, 0.95);
    row.barFill.drawRoundedRect(
      row.barX,
      row.barY,
      width,
      SYSTEM_BAR_HEIGHT,
      SYSTEM_BAR_RADIUS
    );
    row.barFill.endFill();
  }

  function drawTierMetalBar(row, tier) {
    const gradientStops = TIER_METAL_GRADIENTS[tier] || TIER_METAL_GRADIENTS.bronze;
    const width = Math.max(0, Math.floor(row.barWidth));
    const height = SYSTEM_BAR_HEIGHT;
    row.barFill.clear();
    if (width <= 0 || height <= 0) return;

    row.barFill.beginFill(gradientStops[0]?.color ?? 0x8a7b64, 0.98);
    row.barFill.drawRoundedRect(row.barX, row.barY, width, height, SYSTEM_BAR_RADIUS);
    row.barFill.endFill();

    const innerX = row.barX + 1;
    const innerY = row.barY + 1;
    const innerWidth = Math.max(0, width - 2);
    const innerHeight = Math.max(0, height - 2);
    if (innerWidth <= 0 || innerHeight <= 0) return;

    const sliceCount = Math.max(10, innerWidth);
    for (let i = 0; i < sliceCount; i += 1) {
      const t = sliceCount > 1 ? i / (sliceCount - 1) : 0;
      const color = sampleGradientStops(gradientStops, t);
      const x0 = innerX + Math.floor((i * innerWidth) / sliceCount);
      const x1 = innerX + Math.floor(((i + 1) * innerWidth) / sliceCount);
      const sliceWidth = Math.max(1, x1 - x0);
      row.barFill.beginFill(color, 0.97);
      row.barFill.drawRect(x0, innerY, sliceWidth, innerHeight);
      row.barFill.endFill();
    }

    row.barFill.beginFill(0xffffff, 0.16);
    row.barFill.drawRect(innerX, innerY, innerWidth, 1);
    row.barFill.endFill();
    if (innerHeight > 1) {
      row.barFill.beginFill(0x000000, 0.12);
      row.barFill.drawRect(innerX, innerY + innerHeight - 1, innerWidth, 1);
      row.barFill.endFill();
    }
  }

  function quantizeSystemBarRatio(ratio) {
    return Math.round(clamp01(ratio) * SYSTEM_BAR_RATIO_QUANT);
  }

  function setSystemRowLabel(row, label) {
    if (row.lastLabelText === label) return;
    row.lastLabelText = label;
    row.labelText.text = label;
  }

  function renderSystemRowBar(row, label, ratio, color) {
    const ratioKey = quantizeSystemBarRatio(ratio);
    const renderKey = `bar|${color}|${ratioKey}|${label}`;
    if (row.lastBarRenderKey === renderKey) return;
    setSystemRowLabel(row, label);
    drawSystemBar(row, ratioKey / SYSTEM_BAR_RATIO_QUANT, color);
    row.lastBarRenderKey = renderKey;
  }

  function renderSystemRowTier(row, label, tier) {
    const renderKey = `tier|${tier}|${label}`;
    if (row.lastBarRenderKey === renderKey) return;
    setSystemRowLabel(row, label);
    drawTierMetalBar(row, tier);
    row.lastBarRenderKey = renderKey;
  }

  function updateSystemRow(view, row, tileInst) {
    if (!row) return;
    const systemId = row.systemId;
    if (!systemId) return;

    if (systemId === "build") {
      const process = getBuildProcess(tileInst);
      if (!process) {
        renderSystemRowBar(row, "Build", 0, row.uiColor);
        return;
      }
      if (row.buildKind === "requirement") {
        const req = Array.isArray(process.requirements)
          ? process.requirements[row.buildReqIndex]
          : null;
        if (!req) {
          renderSystemRowBar(row, row.buildLabel || "Material", 0, row.uiColor);
          return;
        }
        const required = Math.max(0, Math.floor(req.amount ?? 0));
        const progress = Math.max(0, Math.floor(req.progress ?? 0));
        const ratio = required > 0 ? progress / required : 0;
        const label = row.buildLabel || formatBuildRequirementLabel(req);
        renderSystemRowBar(
          row,
          `${label} ${progress}/${required}`,
          ratio,
          row.uiColor
        );
        return;
      }
      const progress = Math.max(0, Math.floor(process.progress ?? 0));
      const duration = Math.max(1, Math.floor(process.durationSec ?? 1));
      const ratio = duration > 0 ? progress / duration : 0;
      renderSystemRowBar(row, `Build ${progress}/${duration}`, ratio, row.uiColor);
      return;
    }
    if (systemId === "hydration") {
      const hyd = tileInst?.systemState?.hydration;
      const cur = Number.isFinite(hyd?.cur) ? Math.floor(hyd.cur) : 0;
      const max = Number.isFinite(hyd?.max) ? Math.floor(hyd.max) : 0;
      const ratio = max > 0 ? cur / max : 0;
      renderSystemRowBar(row, `${cur}/${max}`, ratio, row.uiColor);
      return;
    }

    if (systemId === "fertility") {
      const tier = getSystemTier(tileInst, systemId);
      renderSystemRowTier(row, formatTierLabel(tier), tier);
      return;
    }

    if (systemId === "growth") {
      row.container.cursor = "default";
      row.container.alpha = 1;

      const growth = tileInst?.systemState?.growth || {};
      const cropId = growth.selectedCropId ?? null;
      const cropDef = cropId ? cropDefs[cropId] : null;
      const cropName = cropDef?.name || cropId || "Crop";
      const pool = getMaturedPoolBucketForCrop(growth.maturedPool, cropId) || {};
      const maturedTotal = sumMaturedPool(pool);

      if (row.lastCropId !== cropId) {
        row.lastCropId = cropId;
        row.lastMaturedMax = 0;
      }

      if (!cropId) {
        renderSystemRowBar(row, "Select Crop", 0, GROWTH_BAR_COLORS.idle);
        row.lastMaturedMax = 0;
        return;
      }

      if (maturedTotal > 0) {
        if (row.lastMaturedMax < maturedTotal) {
          row.lastMaturedMax = maturedTotal;
        }
        const denom = row.lastMaturedMax || maturedTotal || 1;
        const ratio = denom > 0 ? maturedTotal / denom : 0;
        renderSystemRowBar(
          row,
          `Harvest ${formatCompactCount(maturedTotal)}`,
          ratio,
          GROWTH_BAR_COLORS.harvesting
        );
        return;
      }

      row.lastMaturedMax = 0;
      const processesRaw = Array.isArray(growth.processes) ? growth.processes : [];
      const processes =
        typeof cropId === "string" && cropId.length > 0
          ? processesRaw.filter((proc) => getGrowthProcessCropId(proc) === cropId)
          : processesRaw;
      if (processes.length > 0) {
        const oldest = processes.reduce(
          (acc, p) =>
            acc == null || p.startSec < acc.startSec ? p : acc,
          null
        );
        if (oldest) {
          const fallback =
            Number.isFinite(cropDef?.maturitySec) ? cropDef.maturitySec : 32;
          const duration = Number.isFinite(oldest.durationSec)
            ? Math.floor(oldest.durationSec)
            : fallback;
          const nowSec = Math.floor(getGameState?.()?.tSec ?? 0);
          const elapsed = Math.max(
            0,
            Math.floor(nowSec - Math.floor(oldest.startSec ?? nowSec))
          );
          const remaining = Math.max(0, duration - elapsed);
          const ratio = clamp01(elapsed / Math.max(1, duration));
          renderSystemRowBar(
            row,
            `Maturing ${remaining}s`,
            ratio,
            GROWTH_BAR_COLORS.maturing
          );
          return;
        }
      }

      renderSystemRowBar(
        row,
        `Plant ${cropName}`,
        getHydrationRatio(tileInst),
        GROWTH_BAR_COLORS.planting
      );
      return;
    }

    const tier = getSystemTier(tileInst, systemId);
    renderSystemRowTier(row, formatTierLabel(tier), tier);
  }

  function updateTagEntry(view, entry, tileInst, topTagId, hasPawn, activeTagIds) {
    if (!entry) return;
    entry.row.cursor = "grab";
    const isDisabled = isTagDisabled(tileInst, entry.tagId);
    const isActive =
      hasPawn &&
      !isDisabled &&
      (activeTagIds instanceof Set
        ? activeTagIds.has(entry.tagId)
        : entry.tagId === topTagId);
    const isTopInactive =
      !hasPawn && entry.tagId === topTagId && !isDisabled;
    const isLowerPriority = !isDisabled && entry.tagId !== topTagId;

    let style = TAG_PILL_STYLES.low;
    if (isDisabled) {
      style = TAG_PILL_STYLES.bypassed;
    } else if (isActive) {
      style = TAG_PILL_STYLES.active;
    } else if (isTopInactive) {
      style = TAG_PILL_STYLES.topInactive;
    } else if (isLowerPriority) {
      style = TAG_PILL_STYLES.low;
    }

    setTagPillStyle(entry, style);
    updateActionVisual(entry, isDisabled);

    for (const row of entry.systemRows || []) {
      updateSystemRow(view, row, tileInst);
    }
  }

  function applyExpandedTag(view, nextTagId) {
    const normalizedTagId =
      typeof nextTagId === "string" && nextTagId.length > 0 ? nextTagId : null;
    if (view.expandedTagId === normalizedTagId) return false;
    view.expandedTagId = normalizedTagId;
    for (const entry of view.tagEntries || []) {
      entry.setExpanded(entry.tagId === view.expandedTagId);
    }
    return true;
  }

  function syncExpandedTagToActive(view, activeTagId) {
    const nextTagId =
      typeof activeTagId === "string" && activeTagId.length > 0 ? activeTagId : null;
    const previousActiveTagId =
      typeof view.lastAutoExpandedActiveTagId === "string" &&
      view.lastAutoExpandedActiveTagId.length > 0
        ? view.lastAutoExpandedActiveTagId
        : null;
    view.lastAutoExpandedActiveTagId = nextTagId;
    if (!nextTagId) return false;
    if (previousActiveTagId === nextTagId) return false;
    return applyExpandedTag(view, nextTagId);
  }

  function updateTagEntries(view, tileInst) {
    const tags = getVisibleTags(tileInst);
    const enabledTags = tags.filter((tagId) => !isTagDisabled(tileInst, tagId));
    const topTagId = enabledTags[0] ?? null;
    const pawnCount =
      Number.isFinite(view?.pawnCount) && view.pawnCount > 0
        ? Math.floor(view.pawnCount)
        : 0;
    const hasPawn = pawnCount > 0;
    const activeTagIds = new Set(
      hasPawn ? enabledTags.slice(0, pawnCount) : []
    );
    const activeTagId = hasPawn ? enabledTags[0] ?? null : null;
    if (syncExpandedTagToActive(view, activeTagId)) {
      layoutTagEntries(view);
    }
    const buildEntry = (view.tagEntries || []).find(
      (entry) => entry?.tagId === "build"
    );
    if (buildEntry) {
      const desired = buildRowsForBuildProcess(tileInst);
      const signature = getBuildRowSignature(desired);
      if (signature !== buildEntry.buildRowSignature) {
        rebuildTileTags(view, tileInst);
        return;
      }
    }

    for (const entry of view.tagEntries || []) {
      updateTagEntry(
        view,
        entry,
        tileInst,
        topTagId,
        hasPawn,
        activeTagIds
      );
    }
  }

  function rebuildTileTags(view, tileInst) {
    const tags = getVisibleTags(tileInst);
    view.tagSignature = tags.join("|");

    view.tagContainer.removeChildren();
    view.tagEntries = [];
    view.tagContainer.sortableChildren = false;

    if (view.expandedTagId && !tags.includes(view.expandedTagId)) {
      view.expandedTagId = null;
    }

    const pawnCount =
      Number.isFinite(view?.pawnCount) && view.pawnCount > 0
        ? Math.floor(view.pawnCount)
        : 0;
    const enabledTags = tags.filter((tagId) => !isTagDisabled(tileInst, tagId));
    const activeTagId = pawnCount > 0 ? enabledTags[0] ?? null : null;
    if (!view.expandedTagId && activeTagId) {
      view.expandedTagId = activeTagId;
    }
    view.lastAutoExpandedActiveTagId =
      typeof activeTagId === "string" && activeTagId.length > 0 ? activeTagId : null;

    for (const tagId of tags) {
      const entry = buildTagEntry(view, tagId, tileInst);
      entry.setExpanded(view.expandedTagId === tagId);
      view.tagContainer.addChild(entry.container);
      view.tagEntries.push(entry);
    }

    if (Array.isArray(view.hoverTextNodes)) {
      view.hoverTextNodes.length = 0;
      if (Array.isArray(view.hoverTextBaseNodes)) {
        view.hoverTextNodes.push(...view.hoverTextBaseNodes);
      }
      for (const entry of view.tagEntries) {
        if (entry?.labelText) view.hoverTextNodes.push(entry.labelText);
        for (const row of entry?.systemRows || []) {
          if (row?.labelText) view.hoverTextNodes.push(row.labelText);
          if (row?.iconText) view.hoverTextNodes.push(row.iconText);
        }
      }
      setTextResolution(
        view.hoverTextNodes,
        view.isHovered ? hoverTextResolution : baseTextResolution
      );
    }

    layoutTagEntries(view);
    updateTagEntries(view, tileInst);
  }

  return {
    rebuildTileTags,
    updateTagEntries,
    layoutTagEntries,
  };
}
