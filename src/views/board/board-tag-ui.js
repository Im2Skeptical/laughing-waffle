// board-tag-ui.js
// Tag + system UI helpers for board tiles.

import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../../defs/gamesystems/env-systems-defs.js";
import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../../defs/gamesystems/item-tag-defs.js";
import {
  hasAnyLeaderUnlockedSkillNode,
  hasEnvTagUnlock,
} from "../../model/skills.js";
import { getDroppedItemKindsForPool } from "../../model/persistent-memory.js";
import { TILE_WIDTH, TILE_HEIGHT } from "../layout-pixi.js";
import { getDisplayObjectWorldScale } from "../ui-helpers/display-object-scale.js";
import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { applyTextResolution } from "../ui-helpers/text-resolution.js";

const TAG_PILL_HEIGHT = 20;
const TAG_PILL_RADIUS = 10;
const TAG_PILL_PAD_X = 8;
const TAG_PILL_GAP = 6;
const TAG_PILL_MAX_WIDTH = TILE_WIDTH - 16;
const TAG_PILL_WIDTH = TAG_PILL_MAX_WIDTH;
const TAG_TOGGLE_SIZE = 12;
const TAG_TOGGLE_PAD = 4;
const TAG_LABEL_X = TAG_PILL_PAD_X + TAG_TOGGLE_SIZE + TAG_TOGGLE_PAD;
const TAG_ROW_SCALE_ACTIVE = 1.05;
const TAG_PILL_BG_ACTIVE = MUCHA_UI_COLORS.surfaces.panelSoft;
const TAG_PILL_BG_TOP = MUCHA_UI_COLORS.surfaces.panelRaised;
const TAG_PILL_BG_LOW = MUCHA_UI_COLORS.surfaces.panel;
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

const TIER_ORDER = ["bronze", "silver", "gold", "diamond"];

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
    openCropDropdown,
    getGameState,
    startTagDrag,
    setTextResolution,
    baseTextResolution,
    hoverTextResolution,
    requestPauseForAction,
    toggleTag,
    onSystemIconHover,
    onSystemIconOut,
    onSystemIconClick,
  } = opts;

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function getTierIndex(tier) {
    const idx = TIER_ORDER.indexOf(tier);
    return idx >= 0 ? idx : 0;
  }

  function getTierRatio(tier) {
    const maxIndex = Math.max(1, TIER_ORDER.length - 1);
    return clamp01(getTierIndex(tier) / maxIndex);
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

  function isTagUnlocked(tagId) {
    if (typeof tagId !== "string" || !tagId.length) return false;
    const state = getGameState?.();
    if (!state) return true;
    return hasEnvTagUnlock(state, tagId);
  }

  function getVisibleTags(tileInst) {
    const tags = Array.isArray(tileInst?.tags) ? tileInst.tags : [];
    return tags.filter((tagId) => isTagUnlocked(tagId));
  }

  function isTagDisabled(tileInst, tagId) {
    if (!isTagUnlocked(tagId)) return true;
    const entry = tileInst?.tagStates?.[tagId];
    return entry?.disabled === true;
  }

  function getHydrationRatio(tileInst) {
    const hyd = tileInst?.systemState?.hydration;
    const cur = Number.isFinite(hyd?.cur) ? hyd.cur : 0;
    const max = Number.isFinite(hyd?.max) ? hyd.max : 0;
    if (max <= 0) return 0;
    return clamp01(cur / max);
  }

  function sumMaturedPool(pool) {
    return (
      (pool?.bronze ?? 0) +
      (pool?.silver ?? 0) +
      (pool?.gold ?? 0) +
      (pool?.diamond ?? 0)
    );
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
    if (!hasAnyLeaderUnlockedSkillNode(state, "Memory")) return [];

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
      const processes = Array.isArray(growth.processes)
        ? growth.processes
        : [];
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
      const pool = growth.maturedPool || {};
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
    const barY = Math.floor((SYSTEM_ROW_HEIGHT - SYSTEM_BAR_HEIGHT) / 2);

    const barBg = new PIXI.Graphics()
      .lineStyle(1, SYSTEM_BAR_BORDER, 0.9)
      .beginFill(SYSTEM_BAR_BG, 0.95)
      .drawRoundedRect(
        barX,
        barY,
        barWidth,
        SYSTEM_BAR_HEIGHT,
        SYSTEM_BAR_RADIUS
      )
      .endFill();
    const barFill = new PIXI.Graphics();
    container.addChild(barBg, barFill);

    const labelText = new PIXI.Text("", {
      fill: SYSTEM_BAR_TEXT,
      fontSize: 9,
    });
    labelText.x = barX + 4;
    labelText.y = barY - 2;
    container.addChild(labelText);

    const flashOverlay = new PIXI.Graphics();
    flashOverlay.visible = false;
    container.addChild(flashOverlay);

    icon.on("pointerover", () => {
      onSystemIconHover?.(view, systemId);
      showTooltipForSystem(
        view.tile,
        systemId,
        icon.getBounds(),
        getDisplayObjectWorldScale(icon, 1)
      );
    });
    icon.on("pointerout", () => {
      onSystemIconOut?.(view, systemId);
      tooltipView?.hide?.();
    });
    icon.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
    });
    icon.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      onSystemIconClick?.(view, systemId);
    });

    const row = {
      systemId,
      container,
      icon,
      barBg,
      barFill,
      barX,
      barWidth,
      barY,
      labelText,
      iconText,
      uiColor: ui.color,
      lastCropId: null,
      lastMaturedMax: 0,
      flashOverlay,
      flashTimeout: null,
      buildKind: opts?.kind ?? null,
      buildReqIndex: Number.isFinite(opts?.index) ? opts.index : null,
      buildLabel: opts?.label ?? null,
    };

    if (systemId === "growth") {
      container.cursor = "pointer";
      container.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        requestPauseForAction?.();
        openCropDropdown?.(view, container.getBounds());
      });
    }

    return row;
  }

  function buildTagEntry(view, tagId, tileInst) {
    const tagDef = envTagDefs[tagId];
    const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];

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

    const toggle = new PIXI.Container();
    toggle.x = TAG_PILL_PAD_X - 2;
    toggle.y = Math.round((TAG_PILL_HEIGHT - TAG_TOGGLE_SIZE) / 2);
    toggle.eventMode = "static";
    toggle.cursor = "pointer";
    row.addChild(toggle);

    const toggleBg = new PIXI.Graphics();
    toggle.addChild(toggleBg);

    const toggleIcon = new PIXI.Graphics();
    toggle.addChild(toggleIcon);

    const label = getTagLabel(tagId);
    const labelText = new PIXI.Text(label, {
      fill: TAG_PILL_TEXT,
      fontSize: 10,
      wordWrap: false,
    });
    labelText.x = TAG_LABEL_X;
    labelText.y = Math.round((TAG_PILL_HEIGHT - labelText.height) / 2);
    row.addChild(labelText);

    const expandText = new PIXI.Text(">", {
      fill: TAG_PILL_TEXT,
      fontSize: 10,
    });
    expandText.x = TAG_PILL_WIDTH - 14;
    expandText.y = Math.round((TAG_PILL_HEIGHT - expandText.height) / 2);
    row.addChild(expandText);

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
      expandText,
      toggle,
      toggleBg,
      toggleIcon,
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
      entry.expandText.text = entry.expanded ? "v" : ">";
    };

    toggle.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
      view.ignoreNextTagTap = true;
    });
    toggle.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      view.ignoreNextTagTap = true;
      view.hasTagToggle = true;
      requestPauseForAction?.();
      if (typeof toggleTag === "function") {
        toggleTag({
          envCol: Number.isFinite(view.tile?.col)
            ? Math.floor(view.tile.col)
            : view.col,
          tagId,
        });
      }
    });

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
      view.hasTagToggle = true;
      const next = view.expandedTagId === tagId ? null : tagId;
      view.expandedTagId = next;
      for (const entry of view.tagEntries || []) {
        entry.setExpanded(entry.tagId === view.expandedTagId);
      }
      layoutTagEntries(view);
    });

    return entry;
  }

  function updateToggleVisual(entry, isDisabled) {
    if (!entry?.toggleBg || !entry?.toggleIcon) return;
    const fill = isDisabled ? 0x5a2a31 : 0x2e5c3f;
    const stroke = isDisabled ? 0xf2b0b0 : 0xcff5d6;

    entry.toggleBg.clear();
    entry.toggleBg
      .lineStyle(1, stroke, 0.9)
      .beginFill(fill, 0.95)
      .drawRoundedRect(0, 0, TAG_TOGGLE_SIZE, TAG_TOGGLE_SIZE, 3)
      .endFill();

    entry.toggleIcon.clear();
    if (isDisabled) {
      entry.toggleIcon
        .lineStyle(2, stroke, 1)
        .moveTo(3, 3)
        .lineTo(TAG_TOGGLE_SIZE - 3, TAG_TOGGLE_SIZE - 3)
        .moveTo(TAG_TOGGLE_SIZE - 3, 3)
        .lineTo(3, TAG_TOGGLE_SIZE - 3);
    } else {
      entry.toggleIcon.beginFill(0xd7ffe0, 1);
      entry.toggleIcon.drawCircle(TAG_TOGGLE_SIZE / 2, TAG_TOGGLE_SIZE / 2, 3);
      entry.toggleIcon.endFill();
    }
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
    if (entry.expandText?.style?.fill !== textColor) {
      entry.expandText.style.fill = textColor;
      entry.expandText.dirty = true;
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
    const tagMaxY =
      typeof view.tagMaxY === "number" ? view.tagMaxY : TILE_HEIGHT - 12;
    const maxHeight = Math.max(0, tagMaxY - view.tagStartY);

    let y = 0;
    for (const entry of entries) {
      if (!entry) continue;
      const rowScale = entry.rowScale ?? 1;
      const rowHeight = TAG_PILL_HEIGHT * rowScale;
      const spaceRemaining = maxHeight - y;
      if (spaceRemaining < rowHeight) {
        entry.container.visible = false;
        continue;
      }
      entry.container.visible = true;
      entry.container.x = 0;
      entry.container.y = y;

      let entryHeight = rowHeight;
      if (entry.expanded && entry.systemRows.length > 0) {
        const maxSystemHeight = spaceRemaining - rowHeight - 4;
        if (maxSystemHeight > 0) {
          let sysY = 0;
          for (const row of entry.systemRows) {
            if (sysY + SYSTEM_ROW_HEIGHT <= maxSystemHeight) {
              row.container.visible = true;
              row.container.y = sysY;
              sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
            } else {
              row.container.visible = false;
            }
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
      } else {
        entry.systemContainer.visible = false;
        for (const row of entry.systemRows) {
          row.container.visible = false;
        }
      }

      entry.height = entryHeight;
      y += entryHeight + TAG_PILL_GAP;
    }
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

  function updateSystemRow(view, row, tileInst) {
    const systemId = row.systemId;
    if (systemId === "build") {
      const process = getBuildProcess(tileInst);
      if (!process) {
        row.labelText.text = "Build";
        drawSystemBar(row, 0, row.uiColor);
        return;
      }
      if (row.buildKind === "requirement") {
        const req = Array.isArray(process.requirements)
          ? process.requirements[row.buildReqIndex]
          : null;
        if (!req) {
          row.labelText.text = row.buildLabel || "Material";
          drawSystemBar(row, 0, row.uiColor);
          return;
        }
        const required = Math.max(0, Math.floor(req.amount ?? 0));
        const progress = Math.max(0, Math.floor(req.progress ?? 0));
        const ratio = required > 0 ? progress / required : 0;
        const label = row.buildLabel || formatBuildRequirementLabel(req);
        row.labelText.text = `${label} ${progress}/${required}`;
        drawSystemBar(row, ratio, row.uiColor);
        return;
      }
      const progress = Math.max(0, Math.floor(process.progress ?? 0));
      const duration = Math.max(1, Math.floor(process.durationSec ?? 1));
      const ratio = duration > 0 ? progress / duration : 0;
      row.labelText.text = `Build ${progress}/${duration}`;
      drawSystemBar(row, ratio, row.uiColor);
      return;
    }
    if (systemId === "hydration") {
      const hyd = tileInst?.systemState?.hydration;
      const cur = Number.isFinite(hyd?.cur) ? Math.floor(hyd.cur) : 0;
      const max = Number.isFinite(hyd?.max) ? Math.floor(hyd.max) : 0;
      const ratio = max > 0 ? cur / max : 0;
      row.labelText.text = `${cur}/${max}`;
      drawSystemBar(row, ratio, row.uiColor);
      return;
    }

    if (systemId === "fertility") {
      const tier = getSystemTier(tileInst, systemId);
      row.labelText.text = tier;
      drawSystemBar(row, getTierRatio(tier), row.uiColor);
      return;
    }

    if (systemId === "growth") {
      row.container.cursor = "pointer";
      row.container.alpha = 1;

      const growth = tileInst?.systemState?.growth || {};
      const cropId = growth.selectedCropId ?? null;
      const cropDef = cropId ? cropDefs[cropId] : null;
      const cropName = cropDef?.name || cropId || "Crop";
      const pool = growth.maturedPool || {};
      const maturedTotal = sumMaturedPool(pool);

      if (row.lastCropId !== cropId) {
        row.lastCropId = cropId;
        row.lastMaturedMax = 0;
      }

      if (!cropId) {
        row.labelText.text = "select crop";
        drawSystemBar(row, 0, GROWTH_BAR_COLORS.idle);
        row.lastMaturedMax = 0;
        return;
      }

      if (maturedTotal > 0) {
        if (row.lastMaturedMax < maturedTotal) {
          row.lastMaturedMax = maturedTotal;
        }
        const denom = row.lastMaturedMax || maturedTotal || 1;
        const ratio = denom > 0 ? maturedTotal / denom : 0;
        row.labelText.text = `Harvest ${formatCompactCount(maturedTotal)}`;
        drawSystemBar(row, ratio, GROWTH_BAR_COLORS.harvesting);
        return;
      }

      row.lastMaturedMax = 0;
      const processes = Array.isArray(growth.processes)
        ? growth.processes
        : [];
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
          row.labelText.text = `Maturing ${remaining}s`;
          drawSystemBar(row, ratio, GROWTH_BAR_COLORS.maturing);
          return;
        }
      }

      row.labelText.text = `Plant ${cropName}`;
      drawSystemBar(row, getHydrationRatio(tileInst), GROWTH_BAR_COLORS.planting);
      return;
    }

    const tier = getSystemTier(tileInst, systemId);
    row.labelText.text = tier;
    drawSystemBar(row, getTierRatio(tier), row.uiColor);
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
    updateToggleVisual(entry, isDisabled);

    for (const row of entry.systemRows || []) {
      updateSystemRow(view, row, tileInst);
    }
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

    if (!view.hasTagToggle && !view.expandedTagId) {
      const pawnCount =
        Number.isFinite(view?.pawnCount) && view.pawnCount > 0
          ? Math.floor(view.pawnCount)
          : 0;
      const enabledTags = tags.filter((tagId) => !isTagDisabled(tileInst, tagId));
      const activeTagId = pawnCount > 0 ? enabledTags[0] ?? null : null;
      view.expandedTagId = activeTagId;
    }

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
        if (entry?.expandText) view.hoverTextNodes.push(entry.expandText);
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
