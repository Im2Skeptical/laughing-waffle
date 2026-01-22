// board-pixi.js
// Renders tiles/events on a 12-column board, with a separate hub row layout.
// VIEW-ONLY: no direct state mutation.

import { hubStructureDefs } from "../defs/gamepieces/gamepieces-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../defs/gamesystems/env-systems-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { ActionKinds } from "../model/actions.js";
import {
  BOARD_COLS,
  BOARD_COL_GAP,
  HUB_COLS,
  HUB_COL_GAP,
  TILE_WIDTH,
  TILE_HEIGHT,
  EVENT_WIDTH,
  EVENT_HEIGHT,
  HUB_STRUCTURE_WIDTH,
  HUB_STRUCTURE_HEIGHT,
  GAMEPIECE_HOVER_SCALE,
  GAMEPIECE_SHADOW_COLOR,
  GAMEPIECE_SHADOW_ALPHA,
  GAMEPIECE_SHADOW_OFFSET_X,
  GAMEPIECE_SHADOW_OFFSET_Y,
  TILE_ROW_Y,
  EVENT_ROW_Y,
  HUB_STRUCTURE_ROW_Y,
  getBoardColumnX,
  getHubColumnX,
  layoutBoardColPos,
  layoutHubColPos,
} from "./layout-pixi.js";

/**
 * opts:
 *  - app: PIXI.Application
 *  - tileLayer: PIXI.Container
 *  - eventLayer: PIXI.Container
 *  - hubStructuresLayer: PIXI.Container
 *  - hoverLayer?: PIXI.Container
 *  - inspectorLayer?: PIXI.Container
 *  - getGameState: () => gameState
 *  - interaction: interactionController
 *  - actionPlanner?: actionPlanner
 *  - tooltipView
 *  - inventoryView
 *  - dispatchAction: (kind, payload, opts?) => any
 */
export function createBoardView(opts) {
  const {
    app,
    tileLayer,
    eventLayer,
    hubStructuresLayer,
    hoverLayer,
    inspectorLayer,
    getGameState,
    interaction,
    actionPlanner,
    tooltipView,
    inventoryView,
    dispatchAction,
  } = opts;

  const tileViews = [];
  /** @type {Map<number, BoardEventView>} */
  const eventViews = new Map();
  const eventSlotViews = [];
  /** @type {Map<number, BoardHubStructureView>} */
  const hubStructureViews = new Map();
  const hubSlotViews = [];

  if (tileLayer) tileLayer.sortableChildren = true;
  if (eventLayer) eventLayer.sortableChildren = true;
  if (hubStructuresLayer) hubStructuresLayer.sortableChildren = true;
  if (hoverLayer) hoverLayer.sortableChildren = true;

  const tileInspectorLayer = inspectorLayer || hoverLayer || tileLayer;

  const TAG_PILL_HEIGHT = 20;
  const TAG_PILL_RADIUS = 10;
  const TAG_PILL_PAD_X = 8;
  const TAG_PILL_GAP = 6;
  const TAG_PILL_MAX_WIDTH = TILE_WIDTH - 16;
  const TAG_PILL_WIDTH = TAG_PILL_MAX_WIDTH;
  const TAG_PILL_BG = 0x1f263d;
  const TAG_PILL_BORDER = 0x101524;
  const TAG_PILL_TEXT = 0xe6eef9;

  const SYSTEM_ROW_HEIGHT = 18;
  const SYSTEM_ROW_GAP = 4;
  const SYSTEM_ICON_SIZE = 12;
  const SYSTEM_BAR_HEIGHT = 8;
  const SYSTEM_BAR_BG = 0x2b3142;
  const SYSTEM_BAR_BORDER = 0x0f1422;
  const SYSTEM_BAR_TEXT = 0xe6eef9;
  const SYSTEM_BAR_RADIUS = 4;

  const GROWTH_BAR_COLORS = {
    idle: 0x58606f,
    planting: 0xe0c65a,
    maturing: 0x9adf8f,
    harvesting: 0x4dbf6b,
  };

  const TIER_ORDER = ["bronze", "silver", "gold", "diamond"];

  const SYSTEM_UI_MAP = {
    hydration: { label: "Hydration", icon: "H", color: 0x5aa2ff },
    fertility: { label: "Fertility", icon: "F", color: 0xb07a4f },
    growth: { label: "Growth", icon: "G", color: 0x7ccf6b },
    fishDensity: { label: "Fish", icon: "Fi", color: 0x4f7fa6 },
    turfDensity: { label: "Turf", icon: "T", color: 0x7a9a5f },
    mineralRarity: { label: "Ore", icon: "O", color: 0xa17c5b },
  };
  const TAG_DRAG_SCALE = 1.06;
  const TAG_DRAG_BUMP = 6;
  const TAG_DRAG_RELEASE_PAD = 12;
  const BASE_TEXT_RESOLUTION = Math.max(
    2,
    Math.floor(globalThis?.devicePixelRatio || 1)
  );
  const HOVER_TEXT_RESOLUTION = Math.max(
    BASE_TEXT_RESOLUTION,
    Math.ceil(BASE_TEXT_RESOLUTION * GAMEPIECE_HOVER_SCALE)
  );
  let activeTagDrag = null;
  let activeHover = null;
  let lastPointerPos = null;
  let stagePointerMoveHandler = null;
  const tileInspector = createTileInspector(tileInspectorLayer);
  const tooltipLayer = tooltipView?.getContainer?.()?.parent;
  const cropDropdownLayer =
    tooltipLayer || hoverLayer || tileInspectorLayer || tileLayer;
  if (cropDropdownLayer) cropDropdownLayer.sortableChildren = true;
  const cropDropdown = createCropDropdown(cropDropdownLayer);
  let inspectedTile = null;
  let inspectedCol = null;

  function setTextResolution(textNodes, resolution) {
    if (!Array.isArray(textNodes)) return;
    if (!Number.isFinite(resolution)) return;
    for (const node of textNodes) {
      if (!node || typeof node !== "object") continue;
      if (node.resolution === resolution) continue;
      node.resolution = resolution;
      if (node.dirty != null) node.dirty = true;
    }
  }

  function attachHoverFx(
    container,
    width,
    height,
    radius = 8,
    getTextNodes = null
  ) {
    const content = new PIXI.Container();
    content.pivot.set(width / 2, height / 2);
    content.position.set(width / 2, height / 2);

    const shadow = new PIXI.Graphics()
      .beginFill(GAMEPIECE_SHADOW_COLOR, GAMEPIECE_SHADOW_ALPHA)
      .drawRoundedRect(
        GAMEPIECE_SHADOW_OFFSET_X,
        GAMEPIECE_SHADOW_OFFSET_Y,
        width,
        height,
        radius
      )
      .endFill();
    shadow.visible = false;
    content.addChild(shadow);

    container.addChild(content);

    function setActive(active) {
      const scale = active ? GAMEPIECE_HOVER_SCALE : 1;
      content.scale.set(scale);
      shadow.visible = active && GAMEPIECE_SHADOW_ALPHA > 0;
      container.zIndex = active ? 20 : 0;
      const textNodes =
        typeof getTextNodes === "function" ? getTextNodes() : getTextNodes;
      if (textNodes) {
        setTextResolution(
          textNodes,
          active ? HOVER_TEXT_RESOLUTION : BASE_TEXT_RESOLUTION
        );
      }
    }

    return { content, setActive };
  }

  function getScaledAnchorRect(container, width, height, scale) {
    const s = Number.isFinite(scale) ? scale : 1;
    const cx = container.x + width / 2;
    const cy = container.y + height / 2;
    const scaledWidth = width * s;
    const scaledHeight = height * s;
    return {
      x: cx - scaledWidth / 2,
      y: cy - scaledHeight / 2,
      width: scaledWidth,
      height: scaledHeight,
      scale: s,
      centerX: cx,
      centerY: cy,
    };
  }

  function elevateForHover(container) {
    if (!hoverLayer || container.parent === hoverLayer) return;
    container.__hoverParent = container.parent;
    container.__hoverIndex =
      container.parent?.getChildIndex?.(container) ?? null;
    hoverLayer.addChild(container);
  }

  function restoreFromHover(container) {
    if (!hoverLayer || container.parent !== hoverLayer) return;
    const parent = container.__hoverParent;
    const index = Number.isFinite(container.__hoverIndex)
      ? Math.min(parent?.children?.length ?? 0, container.__hoverIndex)
      : null;
    if (parent) {
      if (index == null) {
        parent.addChild(container);
      } else {
        parent.addChildAt(container, index);
      }
    }
    container.__hoverParent = null;
    container.__hoverIndex = null;
  }

  function setHoverContext(kind, col, span, anchor) {
    interaction?.setHovered?.({
      kind,
      col,
      span,
      centerX: anchor.centerX,
      centerY: anchor.centerY,
      scale: anchor.scale,
      anchor,
    });
  }

  function clearHoverContext() {
    interaction?.clearHovered?.();
  }

  function trackPointerPos(ev) {
    const p = ev?.data?.global;
    if (!p) return;
    lastPointerPos = { x: p.x, y: p.y };
  }

  function setActiveHover(next) {
    if (!next?.view) return;
    if (activeHover?.view === next.view) return;
    activeHover?.clear?.();
    activeHover = next;
  }

  function clearActiveHover(view) {
    if (!activeHover) return;
    if (view && activeHover.view !== view) return;
    activeHover.clear?.();
    activeHover = null;
  }

  function isPointerInsideView(view, globalPos, pad = 0) {
    if (!view?.container || !globalPos) return false;
    const bounds = view.container.getBounds();
    const minX = bounds.x - pad;
    const minY = bounds.y - pad;
    const maxX = bounds.x + bounds.width + pad;
    const maxY = bounds.y + bounds.height + pad;
    return (
      globalPos.x >= minX &&
      globalPos.x <= maxX &&
      globalPos.y >= minY &&
      globalPos.y <= maxY
    );
  }

  function clearTileHover(view) {
    if (!view) return;
    if (view.hoverHoldMove) {
      app.stage.off("pointermove", view.hoverHoldMove);
      view.hoverHoldMove = null;
    }
    view.holdHover = false;
    view.setHoverActive?.(false);
    restoreFromHover(view.container);
    view.isHovered = false;
    view.hoverAnchor = null;
    clearHoverContext();
    tooltipView?.hide?.();
    hideTileInspector();
    if (cropDropdown?.isVisible?.()) {
      const insideDropdown = cropDropdown.containsPoint?.(lastPointerPos);
      if (!insideDropdown) cropDropdown.hide();
    }
  }

  function clearEventHover(view) {
    if (!view) return;
    view.setHoverActive?.(false);
    restoreFromHover(view.container);
    clearHoverContext();
    tooltipView?.hide?.();
  }

  function clearHubStructureHover(view) {
    if (!view) return;
    view.setHoverActive?.(false);
    restoreFromHover(view.container);
    clearHoverContext();
    tooltipView?.hide?.();
    if (inventoryView && view.structureHasInventory?.()) {
      inventoryView.hideOnHoverOut(view.structure.instanceId);
    }
  }

  function holdHoverAfterTagDrag(view) {
    if (!view) return;
    if (view.hoverHoldMove) {
      app.stage.off("pointermove", view.hoverHoldMove);
      view.hoverHoldMove = null;
    }
    view.holdHover = true;
    const onMove = (moveEv) => {
      view.holdHover = false;
      app.stage.off("pointermove", onMove);
      view.hoverHoldMove = null;
      if (
        !isPointerInsideView(
          view,
          moveEv?.data?.global,
          TAG_DRAG_RELEASE_PAD
        )
      ) {
        clearTileHover(view);
        if (activeHover?.view === view) activeHover = null;
      }
    };
    view.hoverHoldMove = onMove;
    app.stage.on("pointermove", onMove);
  }

  function applyTileHover(view) {
    if (!view?.container || !view?.tile) return;
    const { title, desc } = getTileUi(view.tile);
    view.setHoverActive?.(true);
    elevateForHover(view.container);
    const anchor = getScaledAnchorRect(
      view.container,
      TILE_WIDTH,
      TILE_HEIGHT,
      GAMEPIECE_HOVER_SCALE
    );
    const anchorCol = Number.isFinite(view.tile.col)
      ? Math.floor(view.tile.col)
      : view.col;
    const span =
      Number.isFinite(view.tile.span) && view.tile.span > 0
        ? Math.floor(view.tile.span)
        : 1;
    view.isHovered = true;
    view.hoverAnchor = anchor;
    setHoverContext("tile", anchorCol, span, anchor);
    tooltipView?.show?.(
      {
        title,
        lines: desc ? [desc] : [],
        scale: GAMEPIECE_HOVER_SCALE,
      },
      anchor
    );
    showTileInspector(view);
  }

  function restoreHoverAfterRebuild(pendingHover, pointerPos) {
    if (!pendingHover || !pointerPos) return;
    if (!interaction?.canShowHoverUI?.()) return;
    if (pendingHover.kind !== "tile") return;
    const view = tileViews[pendingHover.col];
    if (!view) return;
    if (!isPointerInsideView(view, pointerPos, TAG_DRAG_RELEASE_PAD)) return;
    setActiveHover({
      view,
      kind: "tile",
      col: pendingHover.col,
      clear: () => clearTileHover(view),
    });
    applyTileHover(view);
  }

  function removeFromParent(container) {
    if (container?.parent) container.parent.removeChild(container);
  }

  function dispatchTagOrder(envCol, tagIds) {
    if (actionPlanner?.setTileTagOrderIntent) {
      return actionPlanner.setTileTagOrderIntent({ envCol, tagIds });
    }
    if (!dispatchAction) return;
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) return;
    dispatchAction(
      ActionKinds.SET_TILE_TAG_ORDER,
      { envCol, tagIds },
      { apCost: 10 }
    );
  }

  function getTierIndex(tier) {
    const idx = TIER_ORDER.indexOf(tier);
    return idx >= 0 ? idx : 0;
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

  function getCropList() {
    return Object.values(cropDefs || {}).filter(Boolean);
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function getTierRatio(tier) {
    const maxIndex = Math.max(1, TIER_ORDER.length - 1);
    return clamp01(getTierIndex(tier) / maxIndex);
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
        const value =
          sysDef?.tierMap && tier ? sysDef.tierMap[tier] : null;
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
      const decay = Number.isFinite(hyd.decayPerSec)
        ? hyd.decayPerSec
        : 0;
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
              const tierLabel = entry?.tier ? entry.tier[0].toUpperCase() : "?";
              const weight = Number.isFinite(entry?.weight)
                ? Math.round(entry.weight * 100)
                : 0;
              return `${tierLabel}${weight}%`;
            })
            .join(" ");
          lines.push(`Quality odds: ${odds}`);
        }
      }
      const batches = Array.isArray(growth.plantedBatches)
        ? growth.plantedBatches
        : [];
      if (batches.length) {
        const oldest = batches.reduce(
          (acc, b) =>
            acc == null || b.plantedSec < acc.plantedSec ? b : acc,
          null
        );
        if (oldest) {
          const maturity = cropDefs[oldest.cropId]?.maturitySec ?? 32;
          const nowSec = Math.floor(getGameState?.()?.tSec ?? 0);
          const remaining = Math.max(
            0,
            maturity - Math.floor(nowSec - oldest.plantedSec)
          );
          lines.push(`Planting: ${batches.length} batch(es)`);
          lines.push(`Matures in ~${maturity}s`);
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
      .lineStyle(1, TAG_PILL_BORDER, 0.8)
      .beginFill(ui.color, 1)
      .drawCircle(SYSTEM_ICON_SIZE / 2, SYSTEM_ROW_HEIGHT / 2, SYSTEM_ICON_SIZE / 2)
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

    icon.on("pointerover", () => {
      showTooltipForSystem(view.tile, systemId, icon.getBounds());
    });
    icon.on("pointerout", () => {
      tooltipView?.hide?.();
    });

    if (systemId === "growth") {
      container.cursor = "pointer";
      container.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        openCropDropdown(view, container.getBounds());
      });
    }

    return {
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
    };
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
      .lineStyle(1, TAG_PILL_BORDER, 0.9)
      .beginFill(TAG_PILL_BG, 0.95)
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
      startTagDrag(view, entry, ev);
    });
    row.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      if (view.ignoreNextTagTap) {
        view.ignoreNextTagTap = false;
        return;
      }
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
      row.container.cursor = "pointer";
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
      const batches = Array.isArray(growth.plantedBatches)
        ? growth.plantedBatches
        : [];
      if (batches.length > 0) {
        const oldest = batches.reduce(
          (acc, b) =>
            acc == null || b.plantedSec < acc.plantedSec ? b : acc,
          null
        );
        if (oldest) {
          const maturity = cropDef?.maturitySec ?? 32;
          const nowSec = Math.floor(getGameState?.()?.tSec ?? 0);
          const elapsed = Math.max(0, Math.floor(nowSec - oldest.plantedSec));
          const remaining = Math.max(0, maturity - elapsed);
          const ratio = clamp01(elapsed / Math.max(1, maturity));
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

  function updateTagEntry(view, entry, tileInst) {
    if (!entry) return;
    const canEdit =
      typeof interaction?.isPlanningPhase === "function" &&
      interaction.isPlanningPhase();
    entry.row.cursor = canEdit ? "grab" : "pointer";

    for (const row of entry.systemRows || []) {
      updateSystemRow(view, row, tileInst);
    }
  }

  function updateTagEntries(view, tileInst) {
    for (const entry of view.tagEntries || []) {
      updateTagEntry(view, entry, tileInst);
    }
  }

  function endTagDrag(view, commit, globalPos = null) {
    const drag = view.tagDrag;
    if (!drag) return;

    drag.entry.container.scale.set(1);
    drag.entry.container.alpha = 1;
    drag.entry.container.zIndex = 0;
    drag.entry.container.cursor = "grab";

    if (commit && drag.targetIndex !== drag.startIndex) {
      const tags = Array.isArray(view.tile?.tags) ? view.tile.tags.slice() : [];
      if (tags.length === view.tagEntries.length) {
        const [moved] = tags.splice(drag.startIndex, 1);
        tags.splice(drag.targetIndex, 0, moved);
        dispatchTagOrder(view.col, tags);
      }
    }

    if (drag.stageMove) {
      app.stage.off("pointermove", drag.stageMove);
      app.stage.off("pointerup", drag.stageUp);
      app.stage.off("pointerupoutside", drag.stageUp);
    }

    view.tagDrag = null;
    view.ignoreNextTagTap = !!drag.moved;
    if (activeTagDrag === view) activeTagDrag = null;
    layoutTagEntries(view);

    if (globalPos) {
      const inside = isPointerInsideView(
        view,
        globalPos,
        TAG_DRAG_RELEASE_PAD
      );
      if (!inside) {
        clearTileHover(view);
        if (activeHover?.view === view) activeHover = null;
      } else {
        holdHoverAfterTagDrag(view);
      }
    }
  }

  function startTagDrag(view, entry, ev) {
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) return;
    if (!view.isHovered) return;

    if (activeTagDrag && activeTagDrag !== view) {
      endTagDrag(activeTagDrag, false);
    }

    ev?.stopPropagation?.();

    const entries = view.tagEntries || [];
    const startIndex = entries.indexOf(entry);
    if (startIndex < 0) return;

    const local = view.tagContainer.toLocal(ev.data.global);
    const offsetY = local.y - entry.container.y;

    const dragState = {
      entry,
      startIndex,
      targetIndex: startIndex,
      offsetY,
      startY: entry.container.y,
      moved: false,
      stageMove: null,
      stageUp: null,
    };

    view.tagDrag = dragState;
    activeTagDrag = view;

    entry.container.scale.set(TAG_DRAG_SCALE);
    entry.container.alpha = 0.95;
    entry.container.zIndex = 10;
    entry.container.cursor = "grabbing";

    const onMove = (moveEv) => {
      const drag = view.tagDrag;
      if (!drag) return;
      const localPos = view.tagContainer.toLocal(moveEv.data.global);
      const rowStep = TAG_PILL_HEIGHT + TAG_PILL_GAP;
      const maxY = Math.max(0, (entries.length - 1) * rowStep);
      const nextY = Math.max(0, Math.min(maxY, localPos.y - drag.offsetY));
      drag.entry.container.y = nextY;
      if (Math.abs(nextY - drag.startY) > 2) {
        drag.moved = true;
      }

      const centerY = nextY + TAG_PILL_HEIGHT / 2;
      const nextIndex = Math.max(
        0,
        Math.min(entries.length - 1, Math.floor(centerY / rowStep))
      );

      if (nextIndex !== drag.targetIndex) {
        drag.targetIndex = nextIndex;
        drag.moved = true;
        layoutTagEntries(view);
      }
    };

    const onUp = (upEv) => {
      endTagDrag(view, true, upEv?.data?.global ?? null);
    };

    dragState.stageMove = onMove;
    dragState.stageUp = onUp;

    app.stage.on("pointermove", onMove);
    app.stage.on("pointerup", onUp);
    app.stage.on("pointerupoutside", onUp);

    layoutTagEntries(view);
  }

  // --------------------------------------------------------
  // UI helpers
  // --------------------------------------------------------

  function getTileUi(tileInst) {
    const def = envTileDefs[tileInst.defId];
    const title = def?.name || tileInst.defId || "Tile";
    const desc = def?.ui?.description || "";
    const color = def?.color ?? 0x6f8a6f;
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    return { def, title, desc, color, tags };
  }

  function getTagLabel(tagId) {
    const def = envTagDefs[tagId];
    return def?.ui?.name || tagId;
  }

  function getEventUi(eventInst) {
    const def = envEventDefs[eventInst.defId];
    const title = def?.name || eventInst.defId || "Event";
    const desc = def?.ui?.description || "";
    const classKind = def?.class || "effect";
    const color =
      classKind === "animal"
        ? 0x8f6f5f
        : classKind === "effect"
          ? 0x5f6f8f
          : 0x707070;
    return { def, title, desc, color };
  }

  function getHubStructureUi(structureInst) {
    const def = hubStructureDefs[structureInst.defId];
    const ui = def?.ui || {};
    const title =
      (typeof ui.title === "function"
        ? ui.title(structureInst, def)
        : ui.title) ||
      def?.name ||
      structureInst.defId;
    const lines = (ui.lines || [])
      .map((line) =>
        typeof line === "function" ? line(structureInst, def) : line
      )
      .filter(Boolean);
    const meters = Array.isArray(ui.meters) ? ui.meters : [];
    return { def, title, lines, color: def?.color ?? 0x336699, meters };
  }

  // --------------------------------------------------------
  // Tile inspector (hover)
  // --------------------------------------------------------

  function createTileInspector(layer) {
    if (!layer) return null;

    const width = 240;
    const height = 160;
    const container = new PIXI.Container();
    container.visible = false;
    container.zIndex = 30;
    layer.addChild(container);

    const bg = new PIXI.Graphics()
      .beginFill(0x141b2b, 0.95)
      .drawRoundedRect(0, 0, width, height, 10)
      .endFill();
    container.addChild(bg);

    const titleText = new PIXI.Text("Tile Inspector", {
      fill: 0xffffff,
      fontSize: 12,
      fontWeight: "bold",
    });
    titleText.x = 10;
    titleText.y = 8;
    container.addChild(titleText);

    const hydrationText = new PIXI.Text("Hydration: --/--", {
      fill: 0xbad7ff,
      fontSize: 11,
    });
    hydrationText.x = 10;
    hydrationText.y = 30;
    container.addChild(hydrationText);

    const fertilityText = new PIXI.Text("Fertility: --", {
      fill: 0xbad7ff,
      fontSize: 11,
    });
    fertilityText.x = 10;
    fertilityText.y = 48;
    container.addChild(fertilityText);

    const cropText = new PIXI.Text("Crop: None", {
      fill: 0xffffff,
      fontSize: 11,
    });
    cropText.x = 10;
    cropText.y = 66;
    container.addChild(cropText);

    const plantedText = new PIXI.Text("Planted: 0", {
      fill: 0xffffff,
      fontSize: 11,
    });
    plantedText.x = 10;
    plantedText.y = 84;
    container.addChild(plantedText);

    const maturedText = new PIXI.Text("Matured: D0 G0 S0 B0", {
      fill: 0xffffff,
      fontSize: 11,
    });
    maturedText.x = 10;
    maturedText.y = 102;
    container.addChild(maturedText);

    const button = new PIXI.Graphics();
    button.beginFill(0x2b3350, 1);
    button.drawRoundedRect(0, 0, width - 20, 26, 8);
    button.endFill();
    button.x = 10;
    button.y = height - 36;
    button.eventMode = "static";
    button.cursor = "pointer";
    container.addChild(button);

    const buttonText = new PIXI.Text("Select Barley", {
      fill: 0xffffff,
      fontSize: 11,
    });
    buttonText.x = 10 + (width - 20 - buttonText.width) / 2;
    buttonText.y = height - 31;
    container.addChild(buttonText);

    return {
      container,
      width,
      height,
      titleText,
      hydrationText,
      fertilityText,
      cropText,
      plantedText,
      maturedText,
      button,
      buttonText,
    };
  }

  function positionTileInspector(anchor) {
    if (!tileInspector || !anchor) return;
    const margin = 12;
    const width = tileInspector.width;
    const height = tileInspector.height;
    const screenW = app.screen.width;
    const screenH = app.screen.height;

    let x = anchor.x + anchor.width + margin;
    if (x + width > screenW - 10) {
      x = anchor.x - width - margin;
    }
    let y = anchor.y;
    if (y + height > screenH - 10) {
      y = screenH - height - 10;
    }
    if (y < 10) y = 10;

    tileInspector.container.x = x;
    tileInspector.container.y = y;
  }

  function updateTileInspector() {
    if (!tileInspector || !inspectedTile) return;
    const systemState = inspectedTile.systemState || {};
    const hydration = systemState.hydration || null;
    const growth = systemState.growth || {};
    const pool = growth.maturedPool || {};
    const ui = getTileUi(inspectedTile);
    tileInspector.titleText.text = ui.title || "Tile Inspector";

    const cur =
      hydration && Number.isFinite(hydration.cur) ? Math.floor(hydration.cur) : null;
    const max =
      hydration && Number.isFinite(hydration.max) ? Math.floor(hydration.max) : null;
    tileInspector.hydrationText.text =
      cur != null && max != null
        ? `Hydration: ${cur}/${max}`
        : "Hydration: --/--";

    const fertilityTier =
      inspectedTile.systemTiers?.fertility ?? "bronze";
    tileInspector.fertilityText.text = `Fertility: ${fertilityTier}`;

    const selectedCrop = growth.selectedCropId ?? null;
    tileInspector.cropText.text = `Crop: ${selectedCrop ?? "None"}`;
    tileInspector.plantedText.text = `Planted: ${
      Array.isArray(growth.plantedBatches) ? growth.plantedBatches.length : 0
    }`;
    tileInspector.maturedText.text = `Matured: D${
      pool.diamond ?? 0
    } G${pool.gold ?? 0} S${pool.silver ?? 0} B${pool.bronze ?? 0}`;

    const nextLabel = selectedCrop === "barley" ? "Clear Crop" : "Select Barley";
    tileInspector.buttonText.text = nextLabel;
    tileInspector.buttonText.x =
      10 + (tileInspector.width - 20 - tileInspector.buttonText.width) / 2;

    const canEdit =
      typeof interaction?.isPlanningPhase === "function" &&
      interaction.isPlanningPhase();
    tileInspector.button.eventMode = canEdit ? "static" : "none";
    tileInspector.button.cursor = canEdit ? "pointer" : "default";
    tileInspector.button.alpha = canEdit ? 1 : 0.5;
    tileInspector.buttonText.alpha = canEdit ? 1 : 0.6;
  }

  function showTileInspector(view) {
    if (!tileInspector || !view?.tile) return;
    inspectedTile = view.tile;
    inspectedCol = Number.isFinite(view.tile?.col)
      ? Math.floor(view.tile.col)
      : view.col;
    tileInspector.container.visible = true;
    updateTileInspector();
    positionTileInspector(view.hoverAnchor);
  }

  function hideTileInspector() {
    if (!tileInspector) return;
    inspectedTile = null;
    inspectedCol = null;
    tileInspector.container.visible = false;
  }

  function createCropDropdown(layer) {
    if (!layer) return null;
    const container = new PIXI.Container();
    container.visible = false;
    container.zIndex = 40;
    container.eventMode = "static";
    container.interactiveChildren = true;
    layer.addChild(container);

    let outsideHandler = null;
    let onPick = null;

    function buildRow(entry, y, width, canEdit, selected) {
      const row = new PIXI.Container();
      row.x = 0;
      row.y = y;
      row.eventMode = "static";
      row.hitArea = new PIXI.Rectangle(0, 0, width, 34);

      const bg = new PIXI.Graphics()
        .beginFill(selected ? 0x303a55 : 0x1f263d, 0.95)
        .drawRoundedRect(0, 0, width, 34, 6)
        .endFill();
      row.addChild(bg);

      const name = new PIXI.Text(entry.name || entry.cropId, {
        fill: 0xffffff,
        fontSize: 11,
        fontWeight: "bold",
      });
      name.x = 8;
      name.y = 4;
      row.addChild(name);

      const seasonText = Array.isArray(entry.plantSeasons)
        ? entry.plantSeasons.join(", ")
        : "";
      const detail = new PIXI.Text(
        `Seasons: ${seasonText || "any"} | ${entry.maturitySec ?? "?"}s`,
        {
          fill: 0xc7d2ee,
          fontSize: 9,
        }
      );
      detail.x = 8;
      detail.y = 18;
      row.addChild(detail);

      if (canEdit) {
        row.cursor = "pointer";
        row.on("pointerdown", (ev) => {
          ev?.stopPropagation?.();
          onPick?.(entry.cropId);
        });
      } else {
        row.cursor = "default";
        row.alpha = 0.6;
      }

      return row;
    }

    function show({ options, anchor, selectedId, canEdit, onSelect }) {
      container.removeChildren();
      onPick = (cropId) => {
        onSelect?.(cropId);
        hide();
      };

      const list = Array.isArray(options) ? options : [];
      const width = 180;
      let y = 0;

      for (const entry of list) {
        const row = buildRow(
          entry,
          y,
          width,
          canEdit,
          entry.cropId === selectedId
        );
        container.addChild(row);
        y += 38;
      }

      const bounds = anchor || { x: 0, y: 0, width: 0, height: 0 };
      container.x = bounds.x;
      container.y = bounds.y + bounds.height + 6;
      container.visible = true;

      if (outsideHandler) {
        app.stage.off("pointerdown", outsideHandler);
      }
      outsideHandler = (ev) => {
        const p = ev?.data?.global;
        if (!p) return;
        const b = container.getBounds();
        if (
          p.x < b.x ||
          p.x > b.x + b.width ||
          p.y < b.y ||
          p.y > b.y + b.height
        ) {
          hide();
        }
      };
      app.stage.on("pointerdown", outsideHandler);
    }

    function hide() {
      if (!container.visible) return;
      container.visible = false;
      container.removeChildren();
      if (outsideHandler) {
        app.stage.off("pointerdown", outsideHandler);
        outsideHandler = null;
      }
      onPick = null;
    }

    function containsPoint(globalPos) {
      if (!container.visible || !globalPos) return false;
      const b = container.getBounds();
      return (
        globalPos.x >= b.x &&
        globalPos.x <= b.x + b.width &&
        globalPos.y >= b.y &&
        globalPos.y <= b.y + b.height
      );
    }

    return {
      show,
      hide,
      isVisible: () => container.visible,
      containsPoint,
    };
  }

  function openCropDropdown(view, anchorRect) {
    if (!cropDropdown || !view?.tile) return;
    const canEdit =
      typeof interaction?.isPlanningPhase === "function" &&
      interaction.isPlanningPhase();
    const growth = view.tile.systemState?.growth;
    const selectedId = growth?.selectedCropId ?? null;
    const options = getCropList();

    cropDropdown.show({
      options,
      anchor: anchorRect,
      selectedId,
      canEdit,
      onSelect: (cropId) => {
        const envCol = Number.isFinite(view.tile?.col)
          ? Math.floor(view.tile.col)
          : view.col;
        const nextCrop = cropId ?? null;
        if (actionPlanner?.setTileCropSelectionIntent) {
          actionPlanner.setTileCropSelectionIntent({
            envCol,
            cropId: nextCrop,
          });
          return;
        }
        if (!dispatchAction) return;
        dispatchAction(
          ActionKinds.SET_TILE_CROP_SELECTION,
          { envCol, cropId: nextCrop },
          { apCost: 10 }
        );
      },
    });
  }

  if (tileInspector) {
    tileInspector.button.on("pointertap", () => {
      if (!inspectedTile || !Number.isFinite(inspectedCol)) return;
      if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) return;
      const growth = inspectedTile.systemState?.growth;
      const selectedCrop = growth?.selectedCropId ?? null;
      const nextCrop = selectedCrop === "barley" ? null : "barley";

      if (actionPlanner?.setTileCropSelectionIntent) {
        actionPlanner.setTileCropSelectionIntent({
          envCol: inspectedCol,
          cropId: nextCrop,
        });
        return;
      }

      if (!dispatchAction) return;
      if (selectedCrop === nextCrop) return;
      dispatchAction(
        ActionKinds.SET_TILE_CROP_SELECTION,
        { envCol: inspectedCol, cropId: nextCrop },
        { apCost: 10 }
      );
    });
  }

  // --------------------------------------------------------
  // Meter helpers (hub structures only)
  // --------------------------------------------------------

  function createMeters(container, meters, inst, startY, maxWidth) {
    const meterHeight = 6;
    const meterWidth = maxWidth ?? 110;
    let y = startY;
    const meterViews = [];

    for (const meter of meters) {
      const labelText = new PIXI.Text("", {
        fill: 0x000000,
        fontSize: 11,
      });
      labelText.x = 8;
      labelText.y = y;
      container.addChild(labelText);

      const barBg = new PIXI.Graphics()
        .beginFill(0x444444)
        .drawRoundedRect(8, y + 14, meterWidth, meterHeight, 3)
        .endFill();
      container.addChild(barBg);

      const barFill = new PIXI.Graphics();
      container.addChild(barFill);

      meterViews.push({
        meter,
        labelText,
        barFill,
        width: meterWidth,
      });

      y += 26;
    }

    updateMeters(meterViews, inst);
    return { meterViews, nextY: y };
  }

  function updateMeters(meterViews, inst) {
    for (const mv of meterViews) {
      const { meter, labelText, barFill, width } = mv;
      let ratio = 0;
      let label = "";

      if (meter.kind === "timerProgress") {
        const timerKey = meter.timerKey || "timer";
        const periodKey = meter.periodKey || "timerPeriod";
        const timer = inst.props?.[timerKey] ?? 0;
        const period = inst.props?.[periodKey] ?? 1;
        const elapsed = period - timer;
        ratio = Math.max(0, Math.min(1, elapsed / Math.max(1, period)));
        label = `${meter.label}: ${elapsed.toFixed(1)}/${period.toFixed(1)}s`;
      } else {
        const prop = meter.prop;
        const value = inst.props?.[prop] ?? 0;
        const max = inst.props?.[`_${prop}Max`] ?? Math.max(1, value);
        ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
        label = `${meter.label}: ${value}/${max}`;
      }

      labelText.text = label;
      barFill.clear();
      barFill.beginFill(0x00cc66);
      barFill.drawRoundedRect(8, labelText.y + 14, width * ratio, 6, 3);
      barFill.endFill();
    }
  }

  // --------------------------------------------------------
  // Tile view
  // --------------------------------------------------------

  function rebuildTileTags(view, tileInst) {
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    view.tagSignature = tags.join("|");

    view.tagContainer.removeChildren();
    view.tagEntries = [];
    view.tagContainer.sortableChildren = false;

    if (view.expandedTagId && !tags.includes(view.expandedTagId)) {
      view.expandedTagId = null;
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
        view.isHovered ? HOVER_TEXT_RESOLUTION : BASE_TEXT_RESOLUTION
      );
    }

    layoutTagEntries(view);
    updateTagEntries(view, tileInst);
  }

  function buildTileView(tileInst, col) {
    const { title, desc, color } = getTileUi(tileInst);

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    const hoverTextNodes = [];
    const hoverTextBaseNodes = [];
    const { content, setActive: setHoverActive } = attachHoverFx(
      cont,
      TILE_WIDTH,
      TILE_HEIGHT,
      8,
      () => hoverTextNodes
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(0x3a3a3a)
        .drawRoundedRect(0, 0, TILE_WIDTH, TILE_HEIGHT, 8)
        .endFill()
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(color)
        .drawRoundedRect(3, 3, TILE_WIDTH - 6, TILE_HEIGHT - 6, 6)
        .endFill()
    );

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 12,
      wordWrap: true,
      wordWrapWidth: TILE_WIDTH - 12,
    });
    titleText.x = 6;
    titleText.y = 6;
    content.addChild(titleText);

    const tagContainer = new PIXI.Container();
    const tagStartY = titleText.y + titleText.height + 4;
    const tagMaxY = TILE_HEIGHT - 6;
    tagContainer.x = Math.max(
      0,
      Math.round((TILE_WIDTH - TAG_PILL_WIDTH) / 2)
    );
    tagContainer.y = tagStartY;
    content.addChild(tagContainer);

    const pawnBadge = new PIXI.Container();
    const pawnBg = new PIXI.Graphics()
      .beginFill(0x222222)
      .drawCircle(0, 0, 8)
      .endFill();
    const pawnText = new PIXI.Text("", {
      fill: 0xffffff,
      fontSize: 9,
    });
    pawnText.anchor.set(0.5);
    pawnBadge.addChild(pawnBg, pawnText);
    pawnBadge.x = TILE_WIDTH - 12;
    pawnBadge.y = 12;
    pawnBadge.visible = false;
    content.addChild(pawnBadge);

    hoverTextBaseNodes.push(titleText, pawnText);
    hoverTextNodes.push(...hoverTextBaseNodes);

      cont.on("pointerenter", () => {
        if (!interaction?.canShowHoverUI?.()) return;
        if (activeTagDrag && activeTagDrag !== view) return;
        const anchorCol = Number.isFinite(view.tile?.col)
          ? Math.floor(view.tile.col)
          : col;
        setActiveHover({
          view,
          kind: "tile",
          col: anchorCol,
          clear: () => clearTileHover(view),
        });
        if (view.isHovered) return;
        applyTileHover(view);
      });

      cont.on("pointerleave", () => {
        if (view.tagDrag || view.holdHover) return;
        if (activeHover?.view && activeHover.view !== view) return;
        clearActiveHover(view);
      });

    const pos = layoutBoardColPos(app.screen.width, col, TILE_WIDTH, TILE_ROW_Y);
    cont.x = pos.x;
    cont.y = pos.y;

    tileLayer.addChild(cont);

      const view = {
        container: cont,
        tile: tileInst,
        col,
        setHoverActive,
      tagContainer,
      tagStartY,
      tagMaxY,
      tagSignature: "",
      tagEntries: [],
      ignoreNextTagTap: false,
      tagDrag: null,
        hoverTextNodes,
        hoverTextBaseNodes,
        titleText,
        isHovered: false,
        hoverAnchor: null,
        holdHover: false,
        hoverHoldMove: null,
        pawnBadge,
        pawnText,
      };

    rebuildTileTags(view, tileInst);
    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    return view;
  }

  function updateTileView(view, tileInst, pawnCount) {
    view.tile = tileInst;
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    const signature = tags.join("|");
    if (signature !== view.tagSignature) {
      rebuildTileTags(view, tileInst);
    }
    updateTagEntries(view, tileInst);

    if (pawnCount > 0) {
      view.pawnBadge.visible = true;
      view.pawnText.text = pawnCount > 9 ? "9+" : String(pawnCount);
    } else {
      view.pawnBadge.visible = false;
    }
  }

  // --------------------------------------------------------
  // Event view
  // --------------------------------------------------------

  function buildEventView(eventInst, col) {
    const { title, desc, color } = getEventUi(eventInst);
    const span =
      Number.isFinite(eventInst.span) && eventInst.span > 0
        ? Math.floor(eventInst.span)
        : 1;

    const width = EVENT_WIDTH * span + BOARD_COL_GAP * (span - 1);

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    cont.zIndex = 5;
    const hoverTextNodes = [];
    const { content, setActive: setHoverActive } = attachHoverFx(
      cont,
      width,
      EVENT_HEIGHT,
      8,
      () => hoverTextNodes
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(0x2f2f2f)
        .drawRoundedRect(0, 0, width, EVENT_HEIGHT, 8)
        .endFill()
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(color)
        .drawRoundedRect(3, 3, width - 6, EVENT_HEIGHT - 6, 6)
        .endFill()
    );

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 11,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    titleText.x = 6;
    titleText.y = 4;
    content.addChild(titleText);

    const descText = new PIXI.Text(desc, {
      fill: 0x101010,
      fontSize: 9,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    descText.x = 6;
    descText.y = titleText.y + titleText.height + 1;
    content.addChild(descText);

    const remainingText = new PIXI.Text("", {
      fill: 0x101010,
      fontSize: 10,
    });
    remainingText.x = 6;
    remainingText.y = EVENT_HEIGHT - 16;
    content.addChild(remainingText);

    hoverTextNodes.push(titleText, descText, remainingText);

    const view = {
      container: cont,
      event: eventInst,
      remainingText,
      hoverTextNodes,
      setHoverActive,
    };

    cont.on("pointerenter", () => {
      if (!interaction?.canShowHoverUI?.()) return;
      if (activeTagDrag) return;
      setActiveHover({
        view,
        kind: "event",
        col,
        clear: () => clearEventHover(view),
      });
      setHoverActive(true);
      elevateForHover(cont);
      const anchor = getScaledAnchorRect(
        cont,
        width,
        EVENT_HEIGHT,
        GAMEPIECE_HOVER_SCALE
      );
      setHoverContext("event", col, span, anchor);
      tooltipView?.show?.(
        {
          title,
          lines: desc ? [desc] : [],
          scale: GAMEPIECE_HOVER_SCALE,
        },
        anchor
      );
    });

    cont.on("pointerleave", () => {
      if (activeHover?.view && activeHover.view !== view) return;
      clearActiveHover(view);
    });

    const startX =
      span > 1
        ? getBoardColumnX(app.screen.width, col)
        : layoutBoardColPos(app.screen.width, col, EVENT_WIDTH, EVENT_ROW_Y).x;
    cont.x = startX;
    cont.y = EVENT_ROW_Y;

    eventLayer.addChild(cont);

    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    return view;
  }

  function updateEventRemaining(view, state) {
    const expires = view.event?.expiresSec;
    if (expires == null) {
      view.remainingText.text = "";
      return;
    }
    const remaining = Math.max(0, (expires ?? 0) - (state?.tSec ?? 0));
    view.remainingText.text = `T-${remaining}s`;
  }

  // --------------------------------------------------------
  // Permanent view
  // --------------------------------------------------------

  function buildHubStructureView(structureInst, col) {
    const { title, lines, color, meters } =
      getHubStructureUi(structureInst);
    const span =
      Number.isFinite(structureInst.span) && structureInst.span > 0
        ? Math.floor(structureInst.span)
        : 1;
    const width = HUB_STRUCTURE_WIDTH * span + HUB_COL_GAP * (span - 1);
    const height = HUB_STRUCTURE_HEIGHT;

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    cont.zIndex = 1;
    const hoverTextNodes = [];
    const { content, setActive: setHoverActive } = attachHoverFx(
      cont,
      width,
      height,
      10,
      () => hoverTextNodes
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(0x3a3a3a)
        .drawRoundedRect(0, 0, width, height, 10)
        .endFill()
    );

    content.addChild(
      new PIXI.Graphics()
        .beginFill(color)
        .drawRoundedRect(3, 3, width - 6, height - 6, 8)
        .endFill()
    );

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 12,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    titleText.x = 6;
    titleText.y = 6;
    content.addChild(titleText);
    hoverTextNodes.push(titleText);

    let y = titleText.y + titleText.height + 2;
    for (const line of lines) {
      const t = new PIXI.Text(line, {
        fill: 0x000000,
        fontSize: 10,
        wordWrap: true,
        wordWrapWidth: width - 12,
      });
      t.x = 6;
      t.y = y;
      content.addChild(t);
      hoverTextNodes.push(t);
      y += t.height + 1;
      if (y > height - 40) break;
    }

    let meterViews = [];
    if (meters.length > 0) {
      meterViews = createMeters(
        content,
        meters,
        structureInst,
        y + 2,
        width - 14
      ).meterViews;
      for (const mv of meterViews) {
        if (mv?.labelText) hoverTextNodes.push(mv.labelText);
      }
    }

    function structureHasInventory() {
      const s = getGameState?.();
      return !!s?.ownerInventories?.[structureInst.instanceId];
    }

    const view = {
      container: cont,
      structure: structureInst,
      meterViews,
      hoverTextNodes,
      structureHasInventory,
      setHoverActive,
    };

    cont.on("pointerenter", () => {
      if (!interaction?.canShowHoverUI?.()) return;
      if (activeTagDrag) return;
      setActiveHover({
        view,
        kind: "hub",
        col,
        clear: () => clearHubStructureHover(view),
      });
      setHoverActive(true);
      elevateForHover(cont);
      const anchor = getScaledAnchorRect(
        cont,
        width,
        height,
        GAMEPIECE_HOVER_SCALE
      );
      setHoverContext("hub", col, span, anchor);

      tooltipView?.show?.(
        { title, lines, scale: GAMEPIECE_HOVER_SCALE },
        anchor
      );

      if (inventoryView && structureHasInventory()) {
        inventoryView.showOnHover(structureInst.instanceId, {
          x: anchor.x,
          y: anchor.y,
          width: anchor.width,
          height: anchor.height,
        });
      }
    });

    cont.on("pointerleave", () => {
      if (activeHover?.view && activeHover.view !== view) return;
      clearActiveHover(view);
    });

    cont.on("pointertap", () => {
      if (inventoryView && structureHasInventory()) {
        inventoryView.togglePinned(structureInst.instanceId);
      }
    });

    const pos =
      span > 1
        ? { x: getHubColumnX(app.screen.width, col), y: HUB_STRUCTURE_ROW_Y }
        : layoutHubColPos(
            app.screen.width,
            col,
            HUB_STRUCTURE_WIDTH,
            HUB_STRUCTURE_ROW_Y
          );
    cont.x = pos.x;
    cont.y = pos.y;

    hubStructuresLayer.addChild(cont);

    setTextResolution(view.hoverTextNodes, BASE_TEXT_RESOLUTION);
    return view;
  }

  // --------------------------------------------------------
  // sync helpers
  // --------------------------------------------------------

  function getPawnCountsByCol(state, cols) {
    const countLen = Number.isFinite(cols) ? Math.max(0, cols) : BOARD_COLS;
    const counts = new Array(countLen).fill(0);
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    for (const ch of chars) {
      const col = Number.isFinite(ch?.envCol)
        ? Math.floor(ch.envCol)
        : null;
      if (col == null || col < 0 || col >= counts.length) continue;
      counts[col] += 1;
    }
    return counts;
  }

  function syncTiles(state, cols) {
    const tileOcc = state?.board?.occ?.tile;
    const pawnCounts = getPawnCountsByCol(state, cols);

    for (let col = 0; col < cols; col++) {
      const tileInst = tileOcc?.[col] || null;
      const view = tileViews[col];

      if (!tileInst) {
        if (view) {
          if (activeHover?.view === view) clearActiveHover(view);
          removeFromParent(view.container);
          tileViews[col] = undefined;
        }
        continue;
      }

      if (!view || view.tile?.defId !== tileInst.defId) {
        if (view) {
          if (activeHover?.view === view) clearActiveHover(view);
          removeFromParent(view.container);
        }
        tileViews[col] = buildTileView(tileInst, col);
      }

      const activeView = tileViews[col];
      if (activeView) {
        updateTileView(activeView, tileInst, pawnCounts[col] || 0);
      }
    }
  }

  function syncEvents(state, cols) {
    const occ = state?.board?.occ?.event;
    const seen = new Set();

    syncEventSlots(cols);

    for (let col = 0; col < cols; col++) {
      const eventInst = occ?.[col] || null;
      if (!eventInst) continue;

      const anchorCol = Number.isFinite(eventInst.col)
        ? Math.floor(eventInst.col)
        : col;
      if (anchorCol !== col) continue;

      const id = eventInst.instanceId ?? col;
      seen.add(id);

        const existing = eventViews.get(id);
        if (!existing || existing.event.instanceId !== eventInst.instanceId) {
          if (existing) removeFromParent(existing.container);
          eventViews.set(id, buildEventView(eventInst, col));
        }

      const view = eventViews.get(id);
      if (view) updateEventRemaining(view, state);
    }

      for (const [id, view] of eventViews.entries()) {
        if (seen.has(id)) continue;
        if (activeHover?.view === view) clearActiveHover(view);
        removeFromParent(view.container);
        eventViews.delete(id);
      }
  }

  function buildEventSlotView(col) {
    const cont = new PIXI.Container();
    cont.eventMode = "none";
    cont.zIndex = 0;
    const bg = new PIXI.Graphics()
      .lineStyle(1, 0x2a2f3d, 0.6)
      .beginFill(0x1a1f2a, 0.2)
      .drawRoundedRect(0, 0, EVENT_WIDTH, EVENT_HEIGHT, 8)
      .endFill();
    cont.addChild(bg);

    const pos = layoutBoardColPos(
      app.screen.width,
      col,
      EVENT_WIDTH,
      EVENT_ROW_Y
    );
    cont.x = pos.x;
    cont.y = pos.y;

    eventLayer.addChild(cont);
    return cont;
  }

  function syncEventSlots(cols) {
    for (let col = 0; col < cols; col++) {
      let view = eventSlotViews[col];
      if (!view) {
        view = buildEventSlotView(col);
        eventSlotViews[col] = view;
      } else {
        const pos = layoutBoardColPos(
          app.screen.width,
          col,
          EVENT_WIDTH,
          EVENT_ROW_Y
        );
        view.x = pos.x;
        view.y = pos.y;
      }
    }

    for (let i = cols; i < eventSlotViews.length; i++) {
      removeFromParent(eventSlotViews[i]);
    }
    eventSlotViews.length = cols;
  }

  function buildHubSlotView(col) {
    const cont = new PIXI.Container();
    cont.eventMode = "none";
    cont.zIndex = 0;
    const bg = new PIXI.Graphics()
      .lineStyle(2, 0x2a2f3d, 0.85)
      .beginFill(0x1a1f2a, 0.35)
      .drawRoundedRect(
        0,
        0,
        HUB_STRUCTURE_WIDTH,
        HUB_STRUCTURE_HEIGHT,
        10
      )
      .endFill();
    cont.addChild(bg);

    const pos = layoutHubColPos(
      app.screen.width,
      col,
      HUB_STRUCTURE_WIDTH,
      HUB_STRUCTURE_ROW_Y
    );
    cont.x = pos.x;
    cont.y = pos.y;

    hubStructuresLayer.addChild(cont);
    return cont;
  }

  function syncHubSlots(cols) {
    for (let col = 0; col < cols; col++) {
      let view = hubSlotViews[col];
      if (!view) {
        view = buildHubSlotView(col);
        hubSlotViews[col] = view;
      } else {
        const pos = layoutHubColPos(
          app.screen.width,
          col,
          HUB_STRUCTURE_WIDTH,
          HUB_STRUCTURE_ROW_Y
        );
        view.x = pos.x;
        view.y = pos.y;
      }
    }

    for (let i = cols; i < hubSlotViews.length; i++) {
      removeFromParent(hubSlotViews[i]);
    }
    hubSlotViews.length = cols;
  }

  function syncHubStructures(state, cols) {
    const occ = state?.hub?.occ;
    const seen = new Set();

    syncHubSlots(cols);

    for (let col = 0; col < cols; col++) {
      const structureInst = occ?.[col] || null;
      if (!structureInst) continue;

      const anchorCol = Number.isFinite(structureInst.col)
        ? Math.floor(structureInst.col)
        : col;
      if (anchorCol !== col) continue;

      const id = structureInst.instanceId ?? col;
      seen.add(id);

        const existing = hubStructureViews.get(id);
        if (
          !existing ||
          existing.structure.instanceId !== structureInst.instanceId
        ) {
          if (existing) removeFromParent(existing.container);
          hubStructureViews.set(id, buildHubStructureView(structureInst, col));
        }
    }

      for (const [id, view] of hubStructureViews.entries()) {
        if (seen.has(id)) continue;
        if (activeHover?.view === view) clearActiveHover(view);
        removeFromParent(view.container);
        hubStructureViews.delete(id);
      }

    for (const view of hubStructureViews.values()) {
      if (view.meterViews.length > 0) {
        updateMeters(view.meterViews, view.structure);
      }
    }
  }

  // --------------------------------------------------------
  // rebuildAll
  // --------------------------------------------------------

  function rebuildAll() {
    const pendingHover = activeHover
      ? { kind: activeHover.kind, col: activeHover.col }
      : null;
    const pendingPointer = lastPointerPos
      ? { x: lastPointerPos.x, y: lastPointerPos.y }
      : null;
    if (activeHover) clearActiveHover();

    tileLayer.removeChildren();
    eventLayer.removeChildren();
    hubStructuresLayer.removeChildren();
    hoverLayer?.removeChildren?.();
    tileViews.length = 0;
    eventViews.clear();
    eventSlotViews.length = 0;
    hubStructureViews.clear();
    hubSlotViews.length = 0;

    const s = getGameState?.();
    if (!s?.board) return;

    const cols = Number.isFinite(s.board.cols) ? s.board.cols : BOARD_COLS;
    const hubCols = Array.isArray(s?.hub?.slots)
      ? s.hub.slots.length
      : HUB_COLS;
    syncTiles(s, cols);
    syncEvents(s, cols);
    syncHubStructures(s, hubCols);

    restoreHoverAfterRebuild(pendingHover, pendingPointer);
  }

  // --------------------------------------------------------
  // update
  // --------------------------------------------------------

  function update() {
    const s = getGameState?.();
    if (!s?.board) return;

    const cols = Number.isFinite(s.board.cols) ? s.board.cols : BOARD_COLS;
    const hubCols = Array.isArray(s?.hub?.slots)
      ? s.hub.slots.length
      : HUB_COLS;
    syncTiles(s, cols);
    syncEvents(s, cols);
    syncHubStructures(s, hubCols);

    if (tileInspector?.container.visible) {
      if (interaction?.canShowHoverUI && !interaction.canShowHoverUI()) {
        hideTileInspector();
      } else {
        updateTileInspector();
      }
    }
  }

  function init() {
    if (!stagePointerMoveHandler) {
      stagePointerMoveHandler = (ev) => trackPointerPos(ev);
      app.stage.on("pointermove", stagePointerMoveHandler);
    }
  }

  return { init, rebuildAll, update };
}

/**
 * @typedef {Object} BoardEventView
 * @property {PIXI.Container} container
 * @property {any} event
 * @property {PIXI.Text} remainingText
 *
 * @typedef {Object} BoardHubStructureView
 * @property {PIXI.Container} container
 * @property {any} structure
 * @property {Array<any>} meterViews
 */
