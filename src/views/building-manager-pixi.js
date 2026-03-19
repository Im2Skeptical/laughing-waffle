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
import { applyTextResolution } from "./ui-helpers/text-resolution.js";
import { createCenteredModalFrame } from "./ui-helpers/centered-modal-frame.js";

const BUILDING_MANAGER_UI_SCALE = 2;

function scaleUi(value) {
  return Math.max(1, Math.floor(Number(value || 0) * BUILDING_MANAGER_UI_SCALE));
}

const Z_INDEX = 120;
const PANEL_MIN_WIDTH = 1560;
const PANEL_MIN_HEIGHT = 900;
const PANEL_PAD = scaleUi(14);
const HEADER_HEIGHT = scaleUi(28);
const PANE_GAP = scaleUi(12);
const PANE_RADIUS = scaleUi(9);
const PANE_PAD = scaleUi(10);
const ROW_HEIGHT = scaleUi(34);
const ROW_GAP = scaleUi(6);
const ACTION_BUTTON_WIDTH = scaleUi(70);
const ACTION_BUTTON_HEIGHT = scaleUi(20);
const ROW_RADIUS = scaleUi(7);
const SECTION_HEADER_HEIGHT = scaleUi(18);
const SECTION_HEADER_GAP = scaleUi(4);
const SECTION_BLOCK_GAP = scaleUi(8);
const OPEN_CLOSE_REASON_GUARD_MS = 280;

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

function fitTextToWidth(textNode, fullText, maxWidth, suffix = "...") {
  if (!textNode) return "";
  const safeText = String(fullText ?? "");
  const limit = Number.isFinite(maxWidth) ? Math.max(0, Math.floor(maxWidth)) : 0;
  if (limit <= 0) {
    textNode.text = "";
    return "";
  }

  textNode.text = safeText;
  if (textNode.width <= limit) return safeText;

  textNode.text = suffix;
  if (textNode.width > limit) {
    textNode.text = "";
    return "";
  }

  let lo = 0;
  let hi = safeText.length;
  let best = suffix;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = `${safeText.slice(0, mid)}${suffix}`;
    textNode.text = candidate;
    if (textNode.width <= limit) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  textNode.text = best;
  return best;
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function createSectionHeader(label, width) {
  const header = new PIXI.Container();
  const text = new PIXI.Text(String(label || ""), {
    fill: MUCHA_UI_COLORS.ink.secondary,
    fontSize: scaleUi(10),
    fontWeight: "bold",
  });
  text.x = scaleUi(2);
  text.y = 0;
  fitTextToWidth(text, String(label || ""), Math.max(scaleUi(24), width - scaleUi(4)));
  header.addChild(text);
  applyTextResolution(text, BUILDING_MANAGER_UI_SCALE);
  return header;
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
  stage = null,
  getState,
  getScreenSize,
  layout = null,
  onSelectBuild,
  onClose,
} = {}) {
  const modalFrame = createCenteredModalFrame({
    PIXI,
    layer,
    stage,
    getScreenSize,
    layout: {
      widthPx: PANEL_MIN_WIDTH,
      heightPx: PANEL_MIN_HEIGHT,
      marginPx: 28,
      zIndex: Z_INDEX,
      ...(layout && typeof layout === "object" ? layout : {}),
    },
    title: "Building Manager",
    titleStyle: {
      fill: MUCHA_UI_COLORS.ink.primary,
      fontSize: scaleUi(14),
      fontWeight: "bold",
    },
    headerHeight: HEADER_HEIGHT,
    panelRadius: scaleUi(12),
    bodyTopGap: scaleUi(8),
    bodyPadding: PANEL_PAD,
    closeButtonWidth: scaleUi(62),
    closeButtonHeight: scaleUi(18),
    closeOffsetX: 0,
    onRequestClose: (reason) => close(reason),
  });
  const { root, body, getScreenRect } = modalFrame;

  const leftPane = new PIXI.Container();
  const leftPaneBg = new PIXI.Graphics();
  const leftTitle = new PIXI.Text("Unlocked Buildings", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: scaleUi(12),
    fontWeight: "bold",
  });
  const leftRows = new PIXI.Container();
  const leftEmptyText = new PIXI.Text("No unlocked buildings.", {
    fill: MUCHA_UI_COLORS.ink.secondary,
    fontSize: scaleUi(11),
  });
  leftPane.addChild(leftPaneBg, leftTitle, leftRows, leftEmptyText);

  const rightPane = new PIXI.Container();
  const rightPaneBg = new PIXI.Graphics();
  const rightTitle = new PIXI.Text("Build Details", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: scaleUi(12),
    fontWeight: "bold",
  });
  const rightDetails = new PIXI.Text("", {
    fill: MUCHA_UI_COLORS.ink.secondary,
    fontSize: scaleUi(11),
    lineHeight: scaleUi(16),
    wordWrap: true,
    breakWords: true,
  });
  rightPane.addChild(rightPaneBg, rightTitle, rightDetails);
  body.addChild(leftPane, rightPane);

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
  let openAtMs = 0;

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

    const frame = modalFrame.layoutFrame({
      widthPx: PANEL_MIN_WIDTH,
      heightPx: PANEL_MIN_HEIGHT,
      marginPx: scaleUi(16),
    });
    panelWidth = frame.panelWidth;
    panelHeight = frame.panelHeight;
    leftPaneWidth = Math.max(scaleUi(260), Math.floor((frame.bodyWidth - PANE_GAP) * 0.5));
    rightPaneWidth = frame.bodyWidth - PANE_GAP - leftPaneWidth;
    leftPaneHeight = frame.bodyHeight;
    rightPaneHeight = frame.bodyHeight;

    leftPane.x = 0;
    leftPane.y = 0;
    rightPane.x = leftPaneWidth + PANE_GAP;
    rightPane.y = 0;

    leftPaneBg.clear();
    leftPaneBg
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.9)
      .beginFill(MUCHA_UI_COLORS.surfaces.panel, 0.95)
      .drawRoundedRect(0, 0, leftPaneWidth, leftPaneHeight, PANE_RADIUS)
      .endFill();
    rightPaneBg.clear();
    rightPaneBg
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.9)
      .beginFill(MUCHA_UI_COLORS.surfaces.panel, 0.95)
      .drawRoundedRect(0, 0, rightPaneWidth, rightPaneHeight, PANE_RADIUS)
      .endFill();

    leftTitle.x = PANE_PAD;
    leftTitle.y = PANE_PAD;
    leftRows.x = PANE_PAD;
    leftRows.y = scaleUi(48);
    leftEmptyText.x = PANE_PAD;
    leftEmptyText.y = scaleUi(54);

    rightTitle.x = PANE_PAD;
    rightTitle.y = PANE_PAD;
    rightDetails.x = PANE_PAD;
    rightDetails.y = scaleUi(46);
    rightDetails.style.wordWrapWidth = Math.max(scaleUi(80), rightPaneWidth - PANE_PAD * 2);

    for (const node of [leftTitle, leftEmptyText, rightTitle, rightDetails]) {
      applyTextResolution(node, BUILDING_MANAGER_UI_SCALE);
    }
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
      applyTextResolution(rightDetails, BUILDING_MANAGER_UI_SCALE);
      return;
    }

    const rowWidth = Math.max(scaleUi(120), leftPaneWidth - PANE_PAD * 2);
    const labelWidth = Math.max(scaleUi(60), rowWidth - ACTION_BUTTON_WIDTH - scaleUi(56));
    const availableEntries = entries.filter((entry) => entry?.canBuild);
    const unavailableEntries = entries.filter((entry) => !entry?.canBuild);
    const orderedEntries = availableEntries.concat(unavailableEntries);
    let y = 0;

    for (let i = 0; i < orderedEntries.length; i += 1) {
      const entry = orderedEntries[i];
      if (unavailableEntries.length > 0 && i === availableEntries.length) {
        if (availableEntries.length > 0) {
          y += SECTION_BLOCK_GAP;
        }
        const header = createSectionHeader("Unavailable", rowWidth);
        header.y = y;
        leftRows.addChild(header);
        y += SECTION_HEADER_HEIGHT + SECTION_HEADER_GAP;
      }

      const row = new PIXI.Container();
      row.y = y;
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
        .drawRoundedRect(0, 0, rowWidth, ROW_HEIGHT, ROW_RADIUS)
        .endFill();
      row.addChild(rowBg);

      const modeBadge = new PIXI.Text(entry.placementMode === "upgrade" ? "UPG" : "BLD", {
        fill: entry.placementMode === "upgrade"
          ? MUCHA_UI_COLORS.intent.warnPop
          : MUCHA_UI_COLORS.ink.secondary,
        fontSize: scaleUi(9),
        fontWeight: "bold",
      });
      modeBadge.x = scaleUi(7);
      modeBadge.y = Math.floor((ROW_HEIGHT - modeBadge.height) * 0.5);
      row.addChild(modeBadge);
      applyTextResolution(modeBadge, BUILDING_MANAGER_UI_SCALE);

      const label = new PIXI.Text(entry.name, {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: scaleUi(11),
        fontWeight: selected ? "bold" : "normal",
      });
      label.x = scaleUi(48);
      label.y = Math.floor((ROW_HEIGHT - label.height) * 0.5);
      while (label.width > labelWidth && label.text.length > 4) {
        label.text = `${label.text.slice(0, -2)}...`;
      }
      row.addChild(label);
      applyTextResolution(label, BUILDING_MANAGER_UI_SCALE);

      const actionButton = new PIXI.Container();
      actionButton.eventMode = entry.canBuild ? "static" : "none";
      actionButton.cursor = entry.canBuild ? "pointer" : "default";
      actionButton.alpha = entry.canBuild ? 1 : 0.45;
      actionButton.x = rowWidth - ACTION_BUTTON_WIDTH - scaleUi(6);
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
        .drawRoundedRect(0, 0, ACTION_BUTTON_WIDTH, ACTION_BUTTON_HEIGHT, scaleUi(6))
        .endFill();
      actionButton.addChild(actionBg);

      const actionText = new PIXI.Text("Build", {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: scaleUi(10),
        fontWeight: "bold",
      });
      actionText.x = Math.floor((ACTION_BUTTON_WIDTH - actionText.width) * 0.5);
      actionText.y = Math.floor((ACTION_BUTTON_HEIGHT - actionText.height) * 0.5);
      actionButton.addChild(actionText);
      applyTextResolution(actionText, BUILDING_MANAGER_UI_SCALE);

      row.addChild(actionButton);
      leftRows.addChild(row);
      y += ROW_HEIGHT + ROW_GAP;
    }

    const selectedEntry = entries.find((entry) => entry.id === selectedId) || entries[0];
    if (selectedEntry && selectedId !== selectedEntry.id) {
      selectedId = selectedEntry.id;
    }
    rightDetails.text = buildDetailsText(selectedEntry || null);
    applyTextResolution(rightDetails, BUILDING_MANAGER_UI_SCALE);
  }

  function close(reason = "unknown") {
    const isCloseGuardActive =
      openAtMs > 0 && nowMs() - openAtMs < OPEN_CLOSE_REASON_GUARD_MS;
    if (
      isCloseGuardActive &&
      reason !== "closeButton" &&
      reason !== "backdrop" &&
      reason !== "selectBuild"
    ) {
      return reason;
    }
    const closedOwnerId = context?.ownerId ?? null;
    context = null;
    selectedId = null;
    lastModelSignature = "";
    setOpenVisible(false);
    leftRows.removeChildren();
    rightDetails.text = "";
    leftEmptyText.visible = false;
    onClose?.({ reason, ownerId: closedOwnerId });
    return reason;
  }

  function open({ ownerId } = {}) {
    if (ownerId == null) return;
    context = { ownerId };
    selectedId = null;
    lastModelSignature = "";
    openAtMs = nowMs();
    setOpenVisible(true);
    ensureLayout(true);
    const state = getStateSafe();
    if (!state) return;
    const entries = buildEntries(state);
    const signature = buildModelSignature(context?.ownerId ?? null, entries, selectedId);
    lastModelSignature = signature;
    redrawRows(entries);
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
    getScreenRect,
  };
}
