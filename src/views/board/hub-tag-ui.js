// hub-tag-ui.js
// Tag UI helpers for hub structures.

import { hubTagDefs } from "../../defs/gamesystems/hub-tag-defs.js";
import { hubSystemDefs } from "../../defs/gamesystems/hub-system-defs.js";
import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../../defs/gamesystems/item-tag-defs.js";
import { TIER_ASC } from "../../model/effects/core/tiers.js";
import { hasHubTagUnlock } from "../../model/skills.js";
import { getDisplayObjectWorldScale } from "../ui-helpers/display-object-scale.js";
import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { applyTextResolution } from "../ui-helpers/text-resolution.js";

const TAG_PILL_HEIGHT = 20;
const TAG_PILL_RADIUS = 10;
const TAG_PILL_PAD_X = 8;
const TAG_PILL_GAP = 6;
const TAG_PILL_MAX_WIDTH = 90;
const TAG_PILL_WIDTH = TAG_PILL_MAX_WIDTH;
const TAG_TOGGLE_SIZE = 12;
const TAG_TOGGLE_PAD = 4;
const TAG_LABEL_X = TAG_PILL_PAD_X + TAG_TOGGLE_SIZE + TAG_TOGGLE_PAD;
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

const SYSTEM_ROW_HEIGHT = 18;
const SYSTEM_ROW_GAP = 4;
const SYSTEM_ICON_SIZE = 12;
const SYSTEM_BAR_HEIGHT = 8;
const SYSTEM_BAR_BG = MUCHA_UI_COLORS.surfaces.panelDeep;
const SYSTEM_BAR_BORDER = MUCHA_UI_COLORS.surfaces.borderSoft;
const SYSTEM_BAR_TEXT = MUCHA_UI_COLORS.ink.secondary;
const SYSTEM_BAR_RADIUS = 4;

const HUB_SYSTEM_UI_MAP = {
  build: { label: "Build", icon: "B", color: 0x8f7a58 },
  fireplace: { label: "Fireplace", icon: "F", color: 0xb67e56 },
  workspace: { label: "Workspace", icon: "W", color: 0x8ca66b },
  residents: { label: "Residents", icon: "R", color: 0xb7a57f },
  granaryStore: { label: "Granary", icon: "G", color: 0xc2a06d },
  storage: { label: "Storage", icon: "S", color: 0x8ea17f },
};

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

export const HUB_TAG_LAYOUT = {
  PILL_HEIGHT: TAG_PILL_HEIGHT,
  PILL_RADIUS: TAG_PILL_RADIUS,
  PILL_PAD_X: TAG_PILL_PAD_X,
  PILL_GAP: TAG_PILL_GAP,
  PILL_WIDTH: TAG_PILL_WIDTH,
};

export function createHubTagUi(opts) {
  const {
    tooltipView,
    getGameState,
    startTagDrag,
    setTextResolution,
    baseTextResolution,
    hoverTextResolution,
    requestPauseForAction,
    toggleTag,
    openRecipeDropdown,
    onSystemIconHover,
    onSystemIconOut,
    onSystemIconClick,
  } = opts;

  function getTagLabel(tagId) {
    const def = hubTagDefs[tagId];
    return def?.ui?.name || tagId;
  }

  function getSystemUi(systemId) {
    const entry = HUB_SYSTEM_UI_MAP[systemId];
    if (entry) return entry;
    const def = hubSystemDefs?.[systemId];
    const label = def?.ui?.name || systemId || "System";
    const icon = label ? label.slice(0, 1).toUpperCase() : "?";
    return { label, icon, color: MUCHA_UI_COLORS.surfaces.border };
  }

  function isRecipeSystem(systemId) {
    return systemId === "fireplace" || systemId === "workspace";
  }

  function formatRecipeName(recipeId) {
    if (!recipeId) return "select recipe";
    return recipeDefs?.[recipeId]?.name || recipeId;
  }

  function getTagTooltipLines(tagId) {
    const def = hubTagDefs[tagId];
    const lines = [];
    if (def?.ui?.description) lines.push(def.ui.description);
    return lines;
  }

  function isTagDisabled(structure, tagId) {
    if (!isTagUnlocked(tagId)) return true;
    const entry = structure?.tagStates?.[tagId];
    return entry?.disabled === true;
  }

  function isTagUnlocked(tagId) {
    if (typeof tagId !== "string" || !tagId.length) return false;
    const state = getGameState?.();
    if (!state) return true;
    return hasHubTagUnlock(state, tagId);
  }

  function getStructureTags(structure) {
    const tags = Array.isArray(structure?.tags) ? structure.tags : [];
    return tags.filter((tagId) => isTagUnlocked(tagId));
  }

  function isTierBucket(pool) {
    if (!pool || typeof pool !== "object") return false;
    for (const tier of TIER_ASC) {
      if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
    }
    return false;
  }

  function getDepositPoolInfo(structure) {
    if (!structure?.defId) return null;
    const def = hubStructureDefs?.[structure.defId];
    const deposit = def?.deposit;
    if (!deposit || typeof deposit !== "object") return null;
    const systemId =
      typeof deposit.systemId === "string" ? deposit.systemId : null;
    if (!systemId) return null;
    const poolKey =
      typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
        ? deposit.poolKey
        : "byKindTier";
    const pool = structure?.systemState?.[systemId]?.[poolKey] ?? null;
    return { systemId, poolKey, pool };
  }

  function listStorageItemIds(structure) {
    const info = getDepositPoolInfo(structure);
    if (!info?.pool || typeof info.pool !== "object") return [];
    if (isTierBucket(info.pool)) return [null];
    const keys = Object.keys(info.pool || {});
    const items = [];
    for (const key of keys) {
      const bucket = info.pool[key];
      if (!bucket || typeof bucket !== "object") continue;
      items.push(key);
    }
    items.sort((a, b) => a.localeCompare(b));
    return items;
  }

  function getStorageSignature(structure) {
    const items = listStorageItemIds(structure);
    if (!items.length) return "empty";
    return items.map((id) => (id == null ? "_pool" : id)).join("|");
  }

  function getStorageTotals(pool, itemId) {
    const empty = { total: 0, byTier: { bronze: 0, silver: 0, gold: 0, diamond: 0 } };
    if (!pool || typeof pool !== "object") return empty;
    const bucket =
      itemId == null || isTierBucket(pool) ? pool : pool[itemId];
    if (!bucket || typeof bucket !== "object") return empty;
    const byTier = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
    let total = 0;
    for (const tier of TIER_ASC) {
      const amount = Math.max(0, Math.floor(bucket[tier] ?? 0));
      byTier[tier] = amount;
      total += amount;
    }
    return { total, byTier };
  }

  function getStorageMaxTotal(pool) {
    if (!pool || typeof pool !== "object") return 0;
    if (isTierBucket(pool)) {
      return getStorageTotals(pool, null).total;
    }
    let maxTotal = 0;
    const keys = Object.keys(pool);
    for (const key of keys) {
      const totals = getStorageTotals(pool, key);
      if (totals.total > maxTotal) maxTotal = totals.total;
    }
    return maxTotal;
  }

  function showStorageTooltip(structure, row, bounds, scale = 1) {
    if (!tooltipView) return;
    const info = getDepositPoolInfo(structure);
    const pool = info?.pool;
    if (!pool || typeof pool !== "object") return;
    const itemId = row?.storageItemId ?? null;
    const totals = getStorageTotals(pool, itemId);
    const title = row?.storageLabel || "Storage";
    const lines = [
      `Total: ${totals.total}`,
      `Bronze: ${totals.byTier.bronze}`,
      `Silver: ${totals.byTier.silver}`,
      `Gold: ${totals.byTier.gold}`,
      `Diamond: ${totals.byTier.diamond}`,
    ];
    tooltipView.show({ title, lines, scale }, bounds);
  }

  function getBuildProcess(structure) {
    const processes = Array.isArray(structure?.systemState?.build?.processes)
      ? structure.systemState.build.processes
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

  function buildRowsForBuildProcess(structure) {
    const process = getBuildProcess(structure);
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
    return rows
      .map((row) => `${row.kind}:${row.index ?? ""}`)
      .join("|");
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

  function drawSystemBar(row, ratio, color) {
    const width = row.barWidth * Math.max(0, Math.min(1, ratio));
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

  function buildSystemRow(view, systemId, opts = null) {
    const uiOverride = opts?.uiOverride ?? null;
    const ui = uiOverride || getSystemUi(systemId);
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

    if (isRecipeSystem(systemId)) {
      container.cursor = "pointer";
      container.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        requestPauseForAction?.();
        openRecipeDropdown?.(view, systemId, container.getBounds());
      });
    }

    const row = {
      systemId,
      processSystemId: opts?.processSystemId ?? null,
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
      buildKind: opts?.kind ?? null,
      buildReqIndex: Number.isFinite(opts?.index) ? opts.index : null,
      buildLabel: opts?.label ?? null,
      storageItemId: opts?.storageItemId ?? null,
      storageLabel: opts?.storageLabel ?? null,
    };

    icon.on("pointerover", () => {
      onSystemIconHover?.(view, row.processSystemId || systemId);
      if (systemId === "storage") {
        showStorageTooltip(
          view.structure,
          row,
          icon.getBounds(),
          getDisplayObjectWorldScale(icon, 1)
        );
      }
    });
    icon.on("pointerout", () => {
      onSystemIconOut?.(view, row.processSystemId || systemId);
      if (systemId === "storage") {
        tooltipView?.hide?.();
      }
    });
    icon.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
    });
    icon.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      onSystemIconClick?.(view, row.processSystemId || systemId);
    });

    return row;
  }

  function buildTagEntry(view, tagId, structure) {
    const tagDef = hubTagDefs[tagId];
    const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];

    const container = new PIXI.Container();
    const row = new PIXI.Container();
    row.eventMode = "static";
    row.cursor = "grab";
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
    if (tagId === "build" && structure) {
      const rows = buildRowsForBuildProcess(structure);
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
        if (systemId === "deposit") continue;
        if (systemId === "storage") {
          const itemIds = listStorageItemIds(structure);
          if (itemIds.length === 0) {
            const rowEntry = buildSystemRow(view, "storage", {
              storageItemId: null,
              storageLabel: "Storage",
              uiOverride: getSystemUi("storage"),
              processSystemId: "deposit",
            });
            rowEntry.container.y = sysY;
            systemContainer.addChild(rowEntry.container);
            systemRows.push(rowEntry);
            sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
          } else {
            for (const itemId of itemIds) {
              const def = itemId ? itemDefs?.[itemId] : null;
              const label = def?.name || itemId || "Pool";
              const icon = label ? label.slice(0, 1).toUpperCase() : "S";
              const color = def?.color ?? getSystemUi("storage").color;
              const rowEntry = buildSystemRow(view, "storage", {
                storageItemId: itemId,
                storageLabel: label,
                uiOverride: { label, icon, color },
                processSystemId: "deposit",
              });
              rowEntry.container.y = sysY;
              systemContainer.addChild(rowEntry.container);
              systemRows.push(rowEntry);
              sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
            }
          }
          continue;
        }
        const rowEntry = buildSystemRow(view, systemId);
        rowEntry.container.y = sysY;
        systemContainer.addChild(rowEntry.container);
        systemRows.push(rowEntry);
        sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
      }
    }

    const entry = {
      tagId,
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
      storageSignature: systems.includes("storage") ? getStorageSignature(structure) : null,
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
          hubCol: Number.isFinite(view.structure?.col)
            ? Math.floor(view.structure.col)
            : view.col,
          tagId,
        });
      }
    });

    row.on("pointerover", () => {
      const lines = getTagTooltipLines(tagId);
      if (lines.length && tooltipView) {
        tooltipView.show(
          {
            title: getTagLabel(tagId),
            lines,
            scale: getDisplayObjectWorldScale(row, 1),
          },
          row.getBounds()
        );
      }
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

  function layoutTagEntries(view) {
    const entries = view.tagEntries || [];
    const tagMaxY =
      typeof view.tagMaxY === "number" ? view.tagMaxY : 0;
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

  function updateSystemRow(structure, row) {
    if (!row) return;
    const systemId = row.systemId;
    if (!systemId) return;

    if (systemId === "build") {
      const process = getBuildProcess(structure);
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

    if (isRecipeSystem(systemId)) {
      const selected =
        structure?.systemState?.[systemId]?.selectedRecipeId ?? null;
      row.labelText.text = formatRecipeName(selected);
      drawSystemBar(row, selected ? 1 : 0, row.uiColor);
      return;
    }

    if (systemId === "storage") {
      const info = getDepositPoolInfo(structure);
      const pool = info?.pool;
      if (!pool || typeof pool !== "object") {
        row.labelText.text = row.storageLabel || "Storage";
        drawSystemBar(row, 0, row.uiColor);
        return;
      }
      const totals = getStorageTotals(pool, row.storageItemId);
      const maxTotal = Math.max(1, getStorageMaxTotal(pool));
      const ratio = maxTotal > 0 ? totals.total / maxTotal : 0;
      const label = row.storageLabel || getSystemUi("storage").label;
      row.labelText.text = `${label} ${totals.total}`;
      drawSystemBar(row, ratio, row.uiColor);
      return;
    }

    row.labelText.text = getSystemUi(systemId).label;
    drawSystemBar(row, 1, row.uiColor);
  }

  function updateTagEntries(view, structure) {
    const tags = getStructureTags(structure);
    const enabledTags = tags.filter((tagId) => !isTagDisabled(structure, tagId));
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
      const desired = buildRowsForBuildProcess(structure);
      const signature = getBuildRowSignature(desired);
      if (signature !== buildEntry.buildRowSignature) {
        rebuildStructureTags(view, structure);
        return;
      }
    }
    const storageEntry = (view.tagEntries || []).find(
      (entry) => entry?.storageSignature != null
    );
    if (storageEntry) {
      const signature = getStorageSignature(structure);
      if (signature !== storageEntry.storageSignature) {
        rebuildStructureTags(view, structure);
        return;
      }
    }

    for (const entry of view.tagEntries || []) {
      const isDisabled = isTagDisabled(structure, entry.tagId);
      const isActive =
        hasPawn &&
        !isDisabled &&
        (activeTagIds.has(entry.tagId) || entry.tagId === topTagId);
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
        updateSystemRow(structure, row);
      }
    }
  }

  function rebuildStructureTags(view, structure) {
    const tags = getStructureTags(structure);
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
      const enabledTags = tags.filter((tagId) => !isTagDisabled(structure, tagId));
      const activeTagId = pawnCount > 0 ? enabledTags[0] ?? null : null;
      view.expandedTagId = activeTagId;
    }

    for (const tagId of tags) {
      const entry = buildTagEntry(view, tagId, structure);
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
      setTextResolution?.(
        view.hoverTextNodes,
        view.isHovered ? hoverTextResolution : baseTextResolution
      );
    }

    layoutTagEntries(view);
    updateTagEntries(view, structure);
  }

  return {
    rebuildStructureTags,
    updateTagEntries,
    layoutTagEntries,
  };
}
