import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { INTENT_AP_COSTS } from "../defs/gamesettings/action-costs-defs.js";
import { computeAvailableRecipesAndBuildings } from "../model/skills.js";
import {
  isStructureUnderConstruction,
  normalizeBuildRequirements,
  validateHubConstructionPlacement,
} from "../model/build-helpers.js";
import { MUCHA_UI_COLORS } from "./ui-helpers/mucha-ui-palette.js";

const Z_INDEX = 120;
const PANEL_MIN_WIDTH = 680;
const PANEL_MIN_HEIGHT = 420;
const PANEL_PAD = 14;
const HEADER_HEIGHT = 28;
const PANE_GAP = 12;
const ROW_HEIGHT = 34;
const ROW_GAP = 6;
const ACTION_BUTTON_WIDTH = 70;
const ACTION_BUTTON_HEIGHT = 20;

function normalizePlacementMode(def) {
  const raw = def?.build?.placementMode;
  return raw === "upgrade" ? "upgrade" : "new";
}

function normalizeUpgradeFromDefIds(def) {
  const raw = Array.isArray(def?.build?.upgradeFromDefIds)
    ? def.build.upgradeFromDefIds
    : [];
  return raw.filter((id) => typeof id === "string" && id.length > 0);
}

function formatRequirementLabel(req) {
  if (!req || typeof req !== "object") return "Resource";
  if (req.kind === "item") {
    const def = itemDefs?.[req.itemId];
    return def?.name || req.itemId || "Item";
  }
  if (req.kind === "tag") {
    const def = itemTagDefs?.[req.tag];
    return def?.ui?.name || req.tag || "Tag";
  }
  if (req.kind === "resource") {
    return req.resource || "Resource";
  }
  return "Resource";
}

function formatBuildRequirements(def) {
  const requirements = normalizeBuildRequirements(def);
  if (requirements.length <= 0) return ["Requirements: None"];
  const out = ["Requirements:"];
  for (const req of requirements) {
    const amount = Number.isFinite(req.amount) ? Math.max(0, Math.floor(req.amount)) : 0;
    out.push(`- ${formatRequirementLabel(req)} x${amount}`);
  }
  return out;
}

function hasEligibleUpgradeSourceBuilt(state, sourceDefIds) {
  if (!state || sourceDefIds.length <= 0) return false;
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    const structure = slot?.structure;
    if (!structure) continue;
    if (!sourceDefIds.includes(structure.defId)) continue;
    if (isStructureUnderConstruction(structure)) continue;
    return true;
  }
  return false;
}

function canPlaceAnywhere(state, defId) {
  const cols = Array.isArray(state?.hub?.slots) ? state.hub.slots.length : 0;
  for (let col = 0; col < cols; col += 1) {
    const check = validateHubConstructionPlacement(state, defId, col);
    if (check?.ok) return true;
  }
  return false;
}

function buildEntryAvailability(state, def) {
  const placementMode = normalizePlacementMode(def);
  const upgradeFromDefIds = normalizeUpgradeFromDefIds(def);
  const hasSourceBuilt =
    placementMode !== "upgrade"
      ? true
      : hasEligibleUpgradeSourceBuilt(state, upgradeFromDefIds);
  const canBuild = canPlaceAnywhere(state, def.id);

  let disabledReason = "";
  if (!hasSourceBuilt && placementMode === "upgrade") {
    const sourceNames = upgradeFromDefIds
      .map((id) => hubStructureDefs?.[id]?.name || id)
      .join(", ");
    disabledReason = sourceNames.length
      ? `Requires built: ${sourceNames}`
      : "Requires source structure";
  } else if (!canBuild) {
    disabledReason =
      placementMode === "upgrade"
        ? "No valid upgrade target"
        : "No valid build placement";
  }

  return {
    placementMode,
    upgradeFromDefIds,
    canBuild,
    hasSourceBuilt,
    disabledReason,
  };
}

function buildEntries(state) {
  const availability = computeAvailableRecipesAndBuildings(state);
  const unlocked = availability?.hubStructureIds ?? new Set();
  const entries = [];
  for (const defId of unlocked.values()) {
    const def = hubStructureDefs?.[defId];
    if (!def) continue;
    const availabilityState = buildEntryAvailability(state, def);
    entries.push({
      id: defId,
      def,
      name: def?.name || defId,
      laborSec: Number.isFinite(def?.build?.laborSec)
        ? Math.max(0, Math.floor(def.build.laborSec))
        : 0,
      ...availabilityState,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function buildModelSignature(ownerId, entries, selectedId) {
  const entrySig = entries
    .map((entry) => {
      const mode = entry.placementMode === "upgrade" ? "u" : "n";
      const canBuild = entry.canBuild ? "1" : "0";
      const hasSource = entry.hasSourceBuilt ? "1" : "0";
      const reason = entry.disabledReason || "";
      return `${entry.id}:${mode}:${canBuild}:${hasSource}:${reason}`;
    })
    .join("|");
  return `${ownerId ?? "none"}#${selectedId ?? "none"}#${entrySig}`;
}

export function createBuildingManagerView({
  PIXI,
  layer,
  getState,
  getScreenSize,
  onSelectBuild,
  onClose,
} = {}) {
  const root = new PIXI.Container();
  root.visible = false;
  root.eventMode = "none";
  root.zIndex = Z_INDEX;
  if (layer) {
    layer.sortableChildren = true;
    layer.addChild(root);
  }

  const backdrop = new PIXI.Graphics();
  backdrop.eventMode = "static";
  backdrop.cursor = "pointer";
  backdrop.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    close("backdrop");
  });
  root.addChild(backdrop);

  const panel = new PIXI.Container();
  panel.eventMode = "static";
  panel.on("pointerdown", (ev) => ev?.stopPropagation?.());
  panel.on("pointertap", (ev) => ev?.stopPropagation?.());
  root.addChild(panel);

  const panelBg = new PIXI.Graphics();
  panel.addChild(panelBg);

  const titleText = new PIXI.Text("Building Manager", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: 14,
    fontWeight: "bold",
  });
  panel.addChild(titleText);

  const closeButton = new PIXI.Container();
  closeButton.eventMode = "static";
  closeButton.cursor = "pointer";
  const closeButtonBg = new PIXI.Graphics();
  const closeButtonText = new PIXI.Text("Close", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: 10,
    fontWeight: "bold",
  });
  closeButton.addChild(closeButtonBg, closeButtonText);
  closeButton.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    close("closeButton");
  });
  panel.addChild(closeButton);

  const leftPane = new PIXI.Container();
  const leftPaneBg = new PIXI.Graphics();
  const leftTitle = new PIXI.Text("Unlocked Buildings", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: 12,
    fontWeight: "bold",
  });
  const leftRows = new PIXI.Container();
  const leftEmptyText = new PIXI.Text("No unlocked buildings.", {
    fill: MUCHA_UI_COLORS.ink.secondary,
    fontSize: 11,
  });
  leftPane.addChild(leftPaneBg, leftTitle, leftRows, leftEmptyText);
  panel.addChild(leftPane);

  const rightPane = new PIXI.Container();
  const rightPaneBg = new PIXI.Graphics();
  const rightTitle = new PIXI.Text("Build Details", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: 12,
    fontWeight: "bold",
  });
  const rightDetails = new PIXI.Text("", {
    fill: MUCHA_UI_COLORS.ink.secondary,
    fontSize: 11,
    lineHeight: 16,
    wordWrap: true,
    breakWords: true,
  });
  rightPane.addChild(rightPaneBg, rightTitle, rightDetails);
  panel.addChild(rightPane);

  let context = null;
  let selectedId = null;
  let lastScreenSignature = "";
  let lastModelSignature = "";
  let panelWidth = PANEL_MIN_WIDTH;
  let panelHeight = PANEL_MIN_HEIGHT;
  let leftPaneWidth = 0;
  let leftPaneHeight = 0;
  let rightPaneWidth = 0;
  let rightPaneHeight = 0;

  function getStateSafe() {
    return typeof getState === "function" ? getState() : null;
  }

  function getScreenSizeSafe() {
    const fallback = { width: 2424, height: 1080 };
    if (typeof getScreenSize !== "function") return fallback;
    const size = getScreenSize() || fallback;
    const width = Number.isFinite(size.width) ? Math.max(1, Math.floor(size.width)) : fallback.width;
    const height = Number.isFinite(size.height) ? Math.max(1, Math.floor(size.height)) : fallback.height;
    return { width, height };
  }

  function isOpen() {
    return !!context;
  }

  function setOpenVisible(open) {
    root.visible = !!open;
    root.eventMode = open ? "static" : "none";
  }

  function ensureLayout(force = false) {
    if (!isOpen() && !force) return;
    const screen = getScreenSizeSafe();
    const signature = `${screen.width}x${screen.height}`;
    if (!force && signature === lastScreenSignature) return;
    lastScreenSignature = signature;

    const margin = 24;
    panelWidth = Math.max(
      PANEL_MIN_WIDTH,
      Math.min(screen.width - margin * 2, 1100)
    );
    panelHeight = Math.max(
      PANEL_MIN_HEIGHT,
      Math.min(screen.height - margin * 2, 680)
    );
    panel.x = Math.floor((screen.width - panelWidth) * 0.5);
    panel.y = Math.floor((screen.height - panelHeight) * 0.5);

    backdrop.clear();
    backdrop.beginFill(0x000000, 0.62);
    backdrop.drawRect(0, 0, screen.width, screen.height);
    backdrop.endFill();

    panelBg.clear();
    panelBg
      .lineStyle(2, MUCHA_UI_COLORS.surfaces.borderSoft, 0.95)
      .beginFill(MUCHA_UI_COLORS.surfaces.panelDeep, 0.97)
      .drawRoundedRect(0, 0, panelWidth, panelHeight, 12)
      .endFill();

    titleText.x = PANEL_PAD;
    titleText.y = 8;

    const closeWidth = 62;
    const closeHeight = 18;
    closeButton.x = panelWidth - PANEL_PAD - closeWidth;
    closeButton.y = 7;
    closeButtonBg.clear();
    closeButtonBg
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 1)
      .beginFill(MUCHA_UI_COLORS.surfaces.panelSoft, 0.98)
      .drawRoundedRect(0, 0, closeWidth, closeHeight, 6)
      .endFill();
    closeButtonText.x = Math.floor((closeWidth - closeButtonText.width) * 0.5);
    closeButtonText.y = Math.floor((closeHeight - closeButtonText.height) * 0.5);

    const bodyY = HEADER_HEIGHT + 8;
    const bodyHeight = panelHeight - bodyY - PANEL_PAD;
    leftPaneWidth = Math.max(260, Math.floor((panelWidth - PANEL_PAD * 2 - PANE_GAP) * 0.5));
    rightPaneWidth = panelWidth - PANEL_PAD * 2 - PANE_GAP - leftPaneWidth;
    leftPaneHeight = bodyHeight;
    rightPaneHeight = bodyHeight;

    leftPane.x = PANEL_PAD;
    leftPane.y = bodyY;
    rightPane.x = PANEL_PAD + leftPaneWidth + PANE_GAP;
    rightPane.y = bodyY;

    leftPaneBg.clear();
    leftPaneBg
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.9)
      .beginFill(MUCHA_UI_COLORS.surfaces.panel, 0.95)
      .drawRoundedRect(0, 0, leftPaneWidth, leftPaneHeight, 9)
      .endFill();
    rightPaneBg.clear();
    rightPaneBg
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.9)
      .beginFill(MUCHA_UI_COLORS.surfaces.panel, 0.95)
      .drawRoundedRect(0, 0, rightPaneWidth, rightPaneHeight, 9)
      .endFill();

    leftTitle.x = 10;
    leftTitle.y = 8;
    leftRows.x = 10;
    leftRows.y = 34;
    leftEmptyText.x = 10;
    leftEmptyText.y = 38;

    rightTitle.x = 10;
    rightTitle.y = 8;
    rightDetails.x = 10;
    rightDetails.y = 32;
    rightDetails.style.wordWrapWidth = Math.max(40, rightPaneWidth - 20);

    lastModelSignature = "";
  }

  function buildDetailsText(entry) {
    if (!entry) return "Select a building to inspect and place.";
    const lines = [];
    lines.push(entry.name);
    if (entry.placementMode === "upgrade") {
      lines.push("Mode: Upgrade / Transformation");
      const sourceNames = entry.upgradeFromDefIds
        .map((id) => hubStructureDefs?.[id]?.name || id)
        .join(", ");
      lines.push(`Requires existing: ${sourceNames || "Source structure"}`);
    } else {
      lines.push("Mode: New Build");
    }
    const laborSec = Number.isFinite(entry.laborSec) ? Math.max(0, Math.floor(entry.laborSec)) : 0;
    lines.push(`Build Time: ${laborSec}s`);
    lines.push(...formatBuildRequirements(entry.def));
    lines.push(`Action Cost: ${INTENT_AP_COSTS?.buildDesignate ?? 0} AP`);
    if (!entry.canBuild && entry.disabledReason) {
      lines.push("");
      lines.push(`Unavailable: ${entry.disabledReason}`);
    }
    return lines.join("\n");
  }

  function redrawRows(entries) {
    leftRows.removeChildren();
    leftEmptyText.visible = entries.length <= 0;
    if (entries.length <= 0) {
      rightDetails.text = "No unlocked buildings are available.";
      return;
    }

    const rowWidth = Math.max(120, leftPaneWidth - 20);
    const labelWidth = Math.max(60, rowWidth - ACTION_BUTTON_WIDTH - 42);
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const row = new PIXI.Container();
      row.y = i * (ROW_HEIGHT + ROW_GAP);
      row.eventMode = "static";
      row.cursor = "pointer";
      row.hitArea = new PIXI.Rectangle(0, 0, rowWidth, ROW_HEIGHT);
      row.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        selectedId = entry.id;
      });

      const selected = selectedId === entry.id;
      const rowBg = new PIXI.Graphics();
      rowBg
        .lineStyle(
          1,
          selected ? MUCHA_UI_COLORS.accents.gold : MUCHA_UI_COLORS.surfaces.borderSoft,
          0.95
        )
        .beginFill(
          selected ? MUCHA_UI_COLORS.surfaces.panelRaised : MUCHA_UI_COLORS.surfaces.panelDeep,
          entry.canBuild ? 0.97 : 0.6
        )
        .drawRoundedRect(0, 0, rowWidth, ROW_HEIGHT, 7)
        .endFill();
      row.addChild(rowBg);

      const modeBadge = new PIXI.Text(entry.placementMode === "upgrade" ? "UPG" : "BLD", {
        fill: entry.placementMode === "upgrade"
          ? MUCHA_UI_COLORS.intent.warnPop
          : MUCHA_UI_COLORS.ink.secondary,
        fontSize: 9,
        fontWeight: "bold",
      });
      modeBadge.x = 7;
      modeBadge.y = 12;
      row.addChild(modeBadge);

      const label = new PIXI.Text(entry.name, {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: 11,
        fontWeight: selected ? "bold" : "normal",
      });
      label.x = 38;
      label.y = 9;
      while (label.width > labelWidth && label.text.length > 4) {
        label.text = `${label.text.slice(0, -2)}...`;
      }
      row.addChild(label);

      const actionButton = new PIXI.Container();
      actionButton.eventMode = entry.canBuild ? "static" : "none";
      actionButton.cursor = entry.canBuild ? "pointer" : "default";
      actionButton.alpha = entry.canBuild ? 1 : 0.45;
      actionButton.x = rowWidth - ACTION_BUTTON_WIDTH - 6;
      actionButton.y = Math.floor((ROW_HEIGHT - ACTION_BUTTON_HEIGHT) * 0.5);
      actionButton.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        if (!entry.canBuild) return;
        onSelectBuild?.({
          ownerId: context?.ownerId ?? null,
          defId: entry.id,
          placementMode: entry.placementMode,
          upgradeFromDefIds: entry.upgradeFromDefIds.slice(),
        });
        close("selectBuild");
      });

      const actionBg = new PIXI.Graphics();
      actionBg
        .lineStyle(1, MUCHA_UI_COLORS.surfaces.border, 0.95)
        .beginFill(
          entry.canBuild
            ? MUCHA_UI_COLORS.surfaces.borderSoft
            : MUCHA_UI_COLORS.surfaces.panelDeep,
          0.97
        )
        .drawRoundedRect(0, 0, ACTION_BUTTON_WIDTH, ACTION_BUTTON_HEIGHT, 6)
        .endFill();
      actionButton.addChild(actionBg);

      const actionText = new PIXI.Text("Build", {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: 10,
        fontWeight: "bold",
      });
      actionText.x = Math.floor((ACTION_BUTTON_WIDTH - actionText.width) * 0.5);
      actionText.y = Math.floor((ACTION_BUTTON_HEIGHT - actionText.height) * 0.5);
      actionButton.addChild(actionText);

      row.addChild(actionButton);
      leftRows.addChild(row);
    }

    const selectedEntry = entries.find((entry) => entry.id === selectedId) || entries[0];
    if (selectedEntry && selectedId !== selectedEntry.id) {
      selectedId = selectedEntry.id;
    }
    rightDetails.text = buildDetailsText(selectedEntry || null);
  }

  function close(reason = "unknown") {
    context = null;
    selectedId = null;
    lastModelSignature = "";
    setOpenVisible(false);
    leftRows.removeChildren();
    rightDetails.text = "";
    leftEmptyText.visible = false;
    onClose?.(reason);
    return reason;
  }

  function open({ ownerId } = {}) {
    if (ownerId == null) return;
    context = { ownerId };
    selectedId = null;
    lastModelSignature = "";
    setOpenVisible(true);
    ensureLayout(true);
  }

  function update() {
    if (!isOpen()) return;
    ensureLayout(false);
    const state = getStateSafe();
    if (!state) {
      close("noState");
      return;
    }
    const entries = buildEntries(state);
    if (selectedId && !entries.some((entry) => entry.id === selectedId)) {
      selectedId = null;
    }
    const signature = buildModelSignature(context?.ownerId ?? null, entries, selectedId);
    if (signature === lastModelSignature) return;
    lastModelSignature = signature;
    redrawRows(entries);
  }

  return {
    open,
    close,
    isOpen,
    getOpenOwnerId: () => context?.ownerId ?? null,
    update,
  };
}
