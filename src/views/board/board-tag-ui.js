// board-tag-ui.js
// Tag + system UI helpers for board tiles.

import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../../defs/gamesystems/env-systems-defs.js";
import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { TILE_WIDTH, TILE_HEIGHT } from "../layout-pixi.js";

const TAG_PILL_HEIGHT = 20;
const TAG_PILL_RADIUS = 10;
const TAG_PILL_PAD_X = 8;
const TAG_PILL_GAP = 6;
const TAG_PILL_MAX_WIDTH = TILE_WIDTH - 16;
const TAG_PILL_WIDTH = TAG_PILL_MAX_WIDTH;
const TAG_PILL_BG_ACTIVE = 0x1f263d;
const TAG_PILL_BG_INACTIVE = 0x2f4a6f;
const TAG_PILL_BORDER_ACTIVE = 0x1b2a42;
const TAG_PILL_BORDER_INACTIVE = 0x101524;
const TAG_PILL_TEXT = 0xe6eef9;

const SYSTEM_ROW_HEIGHT = 18;
const SYSTEM_ROW_GAP = 4;
const SYSTEM_ICON_SIZE = 12;
const SYSTEM_BAR_HEIGHT = 8;
const SYSTEM_BAR_BG = 0x2b3142;
const SYSTEM_BAR_BORDER = 0x0f1422;
const SYSTEM_BAR_TEXT = 0xe6eef9;
const SYSTEM_BAR_RADIUS = 4;

const TIER_ORDER = ["bronze", "silver", "gold", "diamond"];

const GROWTH_BAR_COLORS = {
  idle: 0x58606f,
  planting: 0xe0c65a,
  maturing: 0x9adf8f,
  harvesting: 0x4dbf6b,
};

const SYSTEM_UI_MAP = {
  hydration: { label: "Hydration", icon: "H", color: 0x5aa2ff },
  fertility: { label: "Fertility", icon: "F", color: 0xb07a4f },
  growth: { label: "Growth", icon: "G", color: 0x7ccf6b },
  fishDensity: { label: "Fish", icon: "Fi", color: 0x4f7fa6 },
  turfDensity: { label: "Turf", icon: "T", color: 0x7a9a5f },
  mineralRarity: { label: "Ore", icon: "O", color: 0xa17c5b },
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
    return { label: raw || "System", icon, color: 0x7a7a7a };
  }

  function getTagLabel(tagId) {
    const def = envTagDefs[tagId];
    return def?.ui?.name || tagId;
  }

  function isTagDisabled(tileInst, tagId) {
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

    const tier = getSystemTier(tileInst, systemId);
    lines.push(`Tier: ${tier}`);
    return lines;
  }

  function showTooltipForTag(tileInst, tagId, bounds) {
    if (!tooltipView || !interaction?.canShowHoverUI?.()) return;
    const label = getTagLabel(tagId);
    const lines = buildTagTooltipLines(tileInst, tagId);
    tooltipView.show({ title: label, lines }, bounds);
  }

  function showTooltipForSystem(tileInst, systemId, bounds) {
    if (!tooltipView || !interaction?.canShowHoverUI?.()) return;
    const label = getSystemUi(systemId).label;
    const lines = buildSystemTooltipLines(tileInst, systemId);
    tooltipView.show({ title: label, lines }, bounds);
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

  function buildSystemRow(view, systemId) {
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
    icon.cursor = "help";

    const iconBg = new PIXI.Graphics()
      .lineStyle(1, TAG_PILL_BORDER_INACTIVE, 0.8)
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
      showTooltipForSystem(view.tile, systemId, icon.getBounds());
    });
    icon.on("pointerout", () => {
      tooltipView?.hide?.();
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
      uiColor: ui.color,
      lastCropId: null,
      lastMaturedMax: 0,
      flashOverlay,
      flashTimeout: null,
    };

    if (systemId === "growth") {
      container.cursor = "pointer";
      container.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        const canEdit =
          typeof interaction?.isPlanningPhase === "function" &&
          interaction.isPlanningPhase();
        if (!canEdit) {
          flashSystemRow(row);
          return;
        }
        openCropDropdown?.(view, container.getBounds());
      });
    }

    return row;
  }

  function buildTagEntry(view, tagId) {
    const tagDef = envTagDefs[tagId];
    const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];

    const container = new PIXI.Container();
    const row = new PIXI.Container();
    row.eventMode = "static";
    row.cursor = "pointer";
    container.addChild(row);

    const bg = new PIXI.Graphics()
      .lineStyle(1, TAG_PILL_BORDER_INACTIVE, 0.9)
      .beginFill(TAG_PILL_BG_INACTIVE, 0.95)
      .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
      .endFill();
    row.addChild(bg);

    const label = getTagLabel(tagId);
    const labelText = new PIXI.Text(label, {
      fill: TAG_PILL_TEXT,
      fontSize: 10,
      wordWrap: false,
    });
    labelText.x = TAG_PILL_PAD_X;
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
    for (const systemId of systems) {
      const rowEntry = buildSystemRow(view, systemId);
      rowEntry.container.y = sysY;
      systemContainer.addChild(rowEntry.container);
      systemRows.push(rowEntry);
      sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
    }

    const entry = {
      tagId,
      tagDef,
      container,
      row,
      bg,
      bgColor: TAG_PILL_BG_INACTIVE,
      borderColor: TAG_PILL_BORDER_INACTIVE,
      labelText,
      expandText,
      systemContainer,
      systemRows,
      expanded: false,
      systemHeight: sysY > 0 ? sysY - SYSTEM_ROW_GAP : 0,
      height: TAG_PILL_HEIGHT,
    };

    entry.setExpanded = (expanded) => {
      entry.expanded = !!expanded;
      entry.expandText.text = entry.expanded ? "v" : ">";
    };

    row.on("pointerover", () => {
      showTooltipForTag(view.tile, tagId, row.getBounds());
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

  function setTagPillStyle(entry, isActive) {
    const bgColor = isActive ? TAG_PILL_BG_ACTIVE : TAG_PILL_BG_INACTIVE;
    const borderColor = isActive
      ? TAG_PILL_BORDER_ACTIVE
      : TAG_PILL_BORDER_INACTIVE;
    if (entry.bgColor === bgColor && entry.borderColor === borderColor) return;

    entry.bg.clear();
    entry.bg
      .lineStyle(1, borderColor, 0.9)
      .beginFill(bgColor, 0.95)
      .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
      .endFill();
    entry.bgColor = bgColor;
    entry.borderColor = borderColor;
  }

  function layoutTagEntries(view) {
    const entries = view.tagEntries || [];
    const tagMaxY =
      typeof view.tagMaxY === "number" ? view.tagMaxY : TILE_HEIGHT - 12;
    const maxHeight = Math.max(0, tagMaxY - view.tagStartY);

    let y = 0;
    for (const entry of entries) {
      if (!entry) continue;
      const spaceRemaining = maxHeight - y;
      if (spaceRemaining < TAG_PILL_HEIGHT) {
        entry.container.visible = false;
        continue;
      }
      entry.container.visible = true;
      entry.container.x = 0;
      entry.container.y = y;

      let entryHeight = TAG_PILL_HEIGHT;
      if (entry.expanded && entry.systemRows.length > 0) {
        const maxSystemHeight = spaceRemaining - TAG_PILL_HEIGHT - 4;
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
          entryHeight = TAG_PILL_HEIGHT + (sysY > 0 ? sysY + 4 : 0);
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
      const canEdit =
        typeof interaction?.isPlanningPhase === "function" &&
        interaction.isPlanningPhase();
      row.container.cursor = canEdit ? "pointer" : "not-allowed";
      row.container.alpha = canEdit ? 1 : 0.8;

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

  function updateTagEntry(view, entry, tileInst, topTagId, hasPawn) {
    if (!entry) return;
    const canEdit =
      typeof interaction?.isPlanningPhase === "function" &&
      interaction.isPlanningPhase();
    entry.row.cursor = canEdit ? "grab" : "pointer";
    const isDisabled = isTagDisabled(tileInst, entry.tagId);
    const isActive = hasPawn && entry.tagId === topTagId && !isDisabled;
    setTagPillStyle(entry, isActive);
    entry.container.alpha = isDisabled ? 0.55 : 1;

    for (const row of entry.systemRows || []) {
      updateSystemRow(view, row, tileInst);
    }
  }

  function updateTagEntries(view, tileInst) {
    const tags = Array.isArray(tileInst?.tags) ? tileInst.tags : [];
    const topTagId =
      tags.find((tagId) => !isTagDisabled(tileInst, tagId)) || null;
    const hasPawn =
      Number.isFinite(view?.pawnCount) && view.pawnCount > 0;
    for (const entry of view.tagEntries || []) {
      updateTagEntry(view, entry, tileInst, topTagId, hasPawn);
    }
  }

  function rebuildTileTags(view, tileInst) {
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    view.tagSignature = tags.join("|");

    view.tagContainer.removeChildren();
    view.tagEntries = [];
    view.tagContainer.sortableChildren = false;

    if (view.expandedTagId && !tags.includes(view.expandedTagId)) {
      view.expandedTagId = null;
    }

    if (!view.hasTagToggle && view.expandedTagId == null && tags.length > 0) {
      view.expandedTagId = tags[0];
    }

    for (const tagId of tags) {
      const entry = buildTagEntry(view, tagId);
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
