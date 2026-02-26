// process-widget-pixi.js
// Process Widget v2: modular layout + routing drawers.

import { ActionKinds } from "../model/actions.js";
import {
  getProcessDefForInstance,
  getTemplateProcessForSystem,
  getDropEndpointId,
  isDropEndpoint,
  listCandidateEndpoints,
  resolveEndpointTarget,
  resolveFixedEndpointId,
} from "../model/process-framework.js";
import {
  buildHubDropboxOwnerId,
  isAnyDropboxOwnerId,
  isHubDropboxOwnerId,
  isProcessDropboxOwnerId,
} from "../model/owner-id-protocol.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { INTENT_AP_COSTS } from "../defs/gamesettings/action-costs-defs.js";
import { computeAvailableRecipesAndBuildings } from "../model/skills.js";
import { createPillDragController } from "./ui-helpers/pill-drag-controller.js";
import { createWindowHeader } from "./ui-helpers/window-header.js";
import { MUCHA_UI_COLORS } from "./ui-helpers/mucha-ui-palette.js";
import { getDisplayObjectWorldScale } from "./ui-helpers/display-object-scale.js";
import { createSelectionDropdown } from "./components/selection-dropdown-pixi.js";
import { createDropTargetRegistry } from "./process-widget/drop-target-registry.js";
import { createWindowManager } from "./process-widget/window-manager.js";
import { createEndpointHoverUi } from "./process-widget/endpoint-hover-ui.js";
import { createEndpointDescriptorTools } from "./process-widget/endpoint-descriptors.js";
import { createProcessWidgetSignatures } from "./process-widget/signatures.js";
import { createProcessWidgetTargetResolver } from "./process-widget/target-resolver.js";
import { createProcessWidgetSelectionActions } from "./process-widget/selection-actions.js";
import { createProcessWidgetCardModules } from "./process-widget/card-modules.js";
import { createProcessWidgetProcessCardBuilder } from "./process-widget/process-card-builder.js";
import {
  VIEW_LAYOUT,
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
  TILE_WIDTH,
  TILE_HEIGHT,
  HUB_STRUCTURE_WIDTH,
  HUB_STRUCTURE_HEIGHT,
  HUB_COL_GAP,
  TILE_ROW_Y,
  HUB_STRUCTURE_ROW_Y,
  CHARACTER_ROW_OFFSET_Y,
  layoutBoardColPos,
  layoutHubColPos,
} from "./layout-pixi.js";

const CORE_WIDTH = 420;
const CARD_RADIUS = 12;
const CARD_GAP = 10;
const HEADER_HEIGHT = 22;
const HEADER_PAD_X = 10;
const HEADER_PAD_Y = 6;
const BODY_PAD = 8;
const MIN_BODY_CONTENT_HEIGHT = 140;
const SEGMENT_GAP = 6;

const DRAWER_COLLAPSED = 60;
const DRAWER_EXPANDED = 156;
const DROPBOX_SIZE = 44;
const DRAWER_TOGGLE_BUTTON_MIN_WIDTH = 44;
const DRAWER_TOGGLE_BUTTON_EDGE_PAD = 4;

const MODULE_GAP = 8;
const MODULE_PAD = 6;
const MODULE_RADIUS = 8;

const PILL_HEIGHT = 18;
const PILL_RADIUS = 9;
const PILL_GAP = 6;
const PILL_PAD_X = 8;
const TOGGLE_SIZE = 10;
const TOGGLE_PAD = 6;
const WINDOW_IDLE_DESTROY_FRAMES = 180;
const WITHDRAW_UI_CACHE_MAX = 256;

const GROUP_SYSTEM_IDS = new Set([
  "growth",
  "fireplace",
  "workspace",
  "residents",
  "deposit",
  "build",
  "basket",
]);

const WITHDRAWABLE_POOL_SYSTEM_IDS = new Set([
  "granaryStore",
  "storehouseStore",
  "storage",
]);

const COLORS = {
  panel: MUCHA_UI_COLORS.surfaces.panelDeep,
  panelBorder: MUCHA_UI_COLORS.surfaces.borderSoft,
  headerBg: MUCHA_UI_COLORS.surfaces.header,
  headerText: MUCHA_UI_COLORS.ink.primary,
  headerSub: MUCHA_UI_COLORS.ink.muted,
  moduleBg: MUCHA_UI_COLORS.surfaces.panel,
  moduleBorder: MUCHA_UI_COLORS.surfaces.borderSoft,
  moduleText: MUCHA_UI_COLORS.ink.primary,
  moduleSub: MUCHA_UI_COLORS.ink.secondary,
  drawerBg: MUCHA_UI_COLORS.surfaces.panel,
  drawerBorder: MUCHA_UI_COLORS.surfaces.borderSoft,
  pillEnabled: MUCHA_UI_COLORS.surfaces.panelSoft,
  pillDisabled: MUCHA_UI_COLORS.surfaces.panelRaised,
  pillInvalid: 0x5e3b34,
  pillLocked: MUCHA_UI_COLORS.surfaces.panel,
  pillText: MUCHA_UI_COLORS.ink.primary,
  pillTextDisabled: MUCHA_UI_COLORS.ink.muted,
  pillTextInvalid: MUCHA_UI_COLORS.ink.alert,
  progressBg: MUCHA_UI_COLORS.surfaces.panelRaised,
  progressFill: MUCHA_UI_COLORS.accents.sage,
  dropboxBg: MUCHA_UI_COLORS.surfaces.panelDeep,
  dropboxBorder: MUCHA_UI_COLORS.surfaces.borderSoft,
  dropboxValidBg: 0x2a5f40,
  dropboxValidBorder: 0x73ca95,
  dropboxInvalidBg: 0x6e2626,
  dropboxInvalidBorder: 0xff6a6a,
  dropboxCappedBg: 0x6f4f1f,
  dropboxCappedBorder: 0xffbf5a,
};

export function createProcessWidgetView({
  app,
  layer,
  getGameState,
  interaction,
  tooltipView = null,
  canShowHoverUI = null,
  setHoverInventoryFocusOwners = null,
  setHoverOwnerFocus = null,
  actionPlanner,
  dispatchAction,
  queueActionWhenPaused,
  inventoryView,
  flashActionGhost,
  position = VIEW_LAYOUT.processWidget.position,
  layout = null,
}) {
  const processLayout =
    layout && typeof layout === "object" ? layout : VIEW_LAYOUT.processWidget;
  const targetResolver = createProcessWidgetTargetResolver({
    hubStructureDefs,
    itemDefs,
  });
  const withdrawUiStateByTarget = new Map();
  const drawerExpanded = {
    inputs: new Set(),
    outputs: new Set(),
  };
  const selectionDropdown = createSelectionDropdown(layer, app);

  let hoverContext = null;
  let externalFocusContext = null;
  let lozengeHoverProcessContext = null;

  let dropTargetRegistry = null;
  let endpointHoverUi = null;
  let endpointDescriptorTools = null;
  const windowManager = createWindowManager({
    PIXI,
    layer,
    coreWidth: CORE_WIDTH,
    defaultOrigin: position,
    getTargetAnchorRect,
    getScreenSize,
    makeTargetRef,
    applyWindowScale,
    onBeforeDestroyWindow: (windowId, win) => {
      endpointHoverUi?.clearLozengeHoverUi?.();
      dropTargetRegistry?.pruneAffordanceOwnersForWindow?.(
        windowId,
        win?.dropTargets || []
      );
    },
  });
  const windows = {
    get: (windowId) => windowManager.get(windowId),
    values: () => windowManager.values(),
    entries: () => windowManager.entries(),
  };
  dropTargetRegistry = createDropTargetRegistry({
    getWindowEntries: () => windowManager.entries(),
    isDropboxOwnerId: isAnyDropboxOwnerId,
  });
  endpointHoverUi = createEndpointHoverUi({
    canShowHoverUI,
    interaction,
    tooltipView,
    inventoryView,
    setHoverInventoryFocusOwners,
    setHoverOwnerFocus,
    getStateSafe,
    getDisplayObjectWorldScale,
    getInventoryOwnerAnchorRect,
    resolveHoverFocusFromOwnerIds,
    setProcessHoverContext: setLozengeHoverProcessContext,
  });
  endpointDescriptorTools = createEndpointDescriptorTools({
    isAnyDropboxOwnerId,
    isProcessDropboxOwnerId,
    isHubDropboxOwnerId,
    envTileDefs,
    hubStructureDefs,
    findStructureById,
    findPawnById,
    findTileById,
    buildBasketTarget,
    makeTargetRef,
    resolveHoverFocusFromOwnerIds,
  });
  const signatureTools = createProcessWidgetSignatures({
    listCandidateEndpoints,
    getTemplateProcessForSystem,
    getProcessDefForInstance,
  });
  const selectionActions = createProcessWidgetSelectionActions({
    selectionDropdown,
    queueActionWhenPaused,
    dispatchAction,
    actionPlanner,
    flashActionGhost,
    inventoryView,
    ActionKinds,
    cropDefs,
    recipeDefs,
    envTileDefs,
    hubStructureDefs,
    getTilePlanCost,
    getHubPlanCost,
    getEnvCol,
    getHubCol,
    isRecipeSystem,
    getSelectedRecipeId,
    getCropOptions,
    getRecipeOptions,
    getDepositPoolTarget,
    getPoolItemOptions,
    getWithdrawState,
    normalizeWithdrawSelection,
    invalidateAllSignatures,
  });
  const cardModules = createProcessWidgetCardModules({
    PIXI,
    COLORS,
    MODULE_PAD,
    MODULE_RADIUS,
    itemDefs,
    getDropEndpointId,
    dropTargetRegistry,
    drawModuleBox,
    drawDropboxBox,
    fitTextToWidth,
    attachLozengeHoverHandlers,
    formatOutputLabel,
    getPoolItemOptions,
    normalizeWithdrawSelection,
    getPoolItemTotals,
    formatRequirementLabel,
    resolveFixedEndpointId,
  });
  const {
    formatPoolSummary,
    resolveLockedOutputEndpoint,
    buildProgressModule,
    buildGrowthProgressModule,
    buildRequirementsModule,
    buildOutputModule,
    buildGrowthOutputModule,
    buildPrestigeModule,
    buildWithdrawModule,
    buildDropboxModule,
  } = cardModules;
  const { buildProcessCard } = createProcessWidgetProcessCardBuilder({
    PIXI,
    app,
    CORE_WIDTH,
    CARD_RADIUS,
    HEADER_HEIGHT,
    HEADER_PAD_X,
    HEADER_PAD_Y,
    BODY_PAD,
    MIN_BODY_CONTENT_HEIGHT,
    DRAWER_COLLAPSED,
    DRAWER_EXPANDED,
    DROPBOX_SIZE,
    SEGMENT_GAP,
    MODULE_GAP,
    COLORS,
    drawerExpanded,
    createWindowHeader,
    getTargetKey,
    getTargetLabel,
    getCardTitle,
    getProcessVariant,
    isRecipeSystem,
    getSelectedRecipeId,
    formatCropName,
    formatRecipeName,
    openGrowthSelectionDropdown,
    openRecipeSelectionDropdown,
    resolveEndpointTarget,
    hasSelectableSlots,
    buildGrowthProgressModule,
    buildProgressModule,
    buildRequirementsModule,
    buildGrowthOutputModule,
    resolveLockedOutputEndpoint,
    formatPoolSummary,
    buildOutputModule,
    buildPrestigeModule,
    getDepositPoolTarget,
    canWithdrawFromTarget,
    getWithdrawState,
    buildWithdrawModule,
    openWithdrawItemDropdown,
    requestPoolWithdraw,
    collectModuleView,
    stretchModuleViews,
    buildRoutingDrawer,
    buildDropboxModule,
    drawCardBackground,
  });

  const routingDragController = createPillDragController({
    app,
    dragStateKey: "dragState",
    dragScale: 1.04,
    dragAlpha: 0.95,
    dragZIndex: 10,
    dragCursor: "grabbing",
    idleCursor: "grab",
    getEntries: (view) => view.pillEntries || [],
    getContainer: (view) => view.pillContainer,
    getRowHeight: () => PILL_HEIGHT,
    getRowStep: () => PILL_HEIGHT + PILL_GAP,
    layoutEntries: (view) => layoutPillEntries(view),
    onCommit: (view, fromIndex, toIndex) => {
      if (!view || view.slotLocked) return;
      const slotKind = view.slotKind;
      const slotId = view.slotId;
      if (!slotId) return;
      const routingMode = view.routingMode || "process";
      if (routingMode === "template") {
        const targetRef = view.targetRef;
        const systemId = view.systemId;
        if (!targetRef || !systemId) return;
        const payload = {
          targetRef,
          systemId,
          slotKind,
          slotId,
          fromIndex,
          toIndex,
        };
        queueActionWhenPaused?.(() =>
          dispatchAction?.(ActionKinds.REORDER_ROUTING_TEMPLATE_ENDPOINT, payload, {
            apCost: 0,
          })
        );
        return;
      }

      const processId = view.processId;
      if (!processId) return;
      const payload = {
        processId,
        slotKind,
        slotId,
        fromIndex,
        toIndex,
      };
      queueActionWhenPaused?.(() =>
        dispatchAction?.(ActionKinds.REORDER_PROCESS_ROUTING_ENDPOINT, payload, {
          apCost: 0,
        })
      );
    },
    onDragEnd: (view, drag) => {
      view.ignoreNextTap = !!drag?.moved;
      layoutPillEntries(view);
    },
  });

  function getStateSafe() {
    return typeof getGameState === "function" ? getGameState() : null;
  }

  function getScreenSize() {
    const width = Number.isFinite(app?.renderer?.width)
      ? app.renderer.width
      : VIEWPORT_DESIGN_WIDTH;
    const height = Number.isFinite(app?.renderer?.height)
      ? app.renderer.height
      : VIEWPORT_DESIGN_HEIGHT;
    return { width, height };
  }

  function getViewportWidthPx() {
    const vvWidth = Number(window?.visualViewport?.width);
    if (Number.isFinite(vvWidth) && vvWidth > 0) return vvWidth;
    const innerWidth = Number(window?.innerWidth);
    if (Number.isFinite(innerWidth) && innerWidth > 0) return innerWidth;
    return VIEWPORT_DESIGN_WIDTH;
  }

  function getWindowScale() {
    const breakpoint = Number.isFinite(processLayout?.mobileBreakpointPx)
      ? Math.max(320, Math.floor(processLayout.mobileBreakpointPx))
      : 900;
    const mobileScale = Number.isFinite(processLayout?.mobileScale)
      ? Math.max(1, Number(processLayout.mobileScale))
      : 2;
    return getViewportWidthPx() <= breakpoint ? mobileScale : 1;
  }

  function applyWindowScale(win) {
    if (!win?.container) return false;
    const nextScale = getWindowScale();
    const prevScale = Number.isFinite(win.uiScale) ? win.uiScale : 1;
    if (Math.abs(nextScale - prevScale) < 1e-6) return false;
    win.uiScale = nextScale;
    win.container.scale.set(nextScale);
    win.hasPosition = false;
    return true;
  }

  function uniqueOwnerIds(ownerIds) {
    const list = Array.isArray(ownerIds) ? ownerIds : [];
    const seen = new Set();
    const out = [];
    for (const ownerId of list) {
      if (ownerId == null) continue;
      const key = `${typeof ownerId}:${String(ownerId)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ownerId);
    }
    return out;
  }

  function getPawnAnchorRect(pawn) {
    if (!pawn) return null;
    const { width: screenWidth } = getScreenSize();
    if (Number.isFinite(pawn.hubCol)) {
      const col = Math.floor(pawn.hubCol);
      const pos = layoutHubColPos(
        screenWidth,
        col,
        HUB_STRUCTURE_WIDTH,
        HUB_STRUCTURE_ROW_Y
      );
      const centerX = pos.x + HUB_STRUCTURE_WIDTH / 2;
      const centerY = pos.y - CHARACTER_ROW_OFFSET_Y;
      return { x: centerX - 20, y: centerY - 20, width: 40, height: 40 };
    }
    if (Number.isFinite(pawn.envCol)) {
      const col = Math.floor(pawn.envCol);
      const pos = layoutBoardColPos(screenWidth, col, TILE_WIDTH, TILE_ROW_Y);
      const centerX = pos.x + TILE_WIDTH / 2;
      const centerY = pos.y - CHARACTER_ROW_OFFSET_Y;
      return { x: centerX - 20, y: centerY - 20, width: 40, height: 40 };
    }
    return null;
  }

  function getInventoryOwnerAnchorRect(state, ownerId) {
    if (ownerId == null) return null;
    const structure = findStructureById(state, ownerId);
    if (structure) return getTargetAnchorRect(structure);
    const tile = findTileById(state, ownerId);
    if (tile) return getTargetAnchorRect(tile);
    const pawn = findPawnById(state, ownerId);
    if (pawn) return getPawnAnchorRect(pawn);
    return null;
  }

  function resolveHoverFocusFromOwnerIds(state, ownerIds) {
    const normalized = uniqueOwnerIds(ownerIds);
    for (const ownerId of normalized) {
      const pawn = findPawnById(state, ownerId);
      if (pawn?.id != null) {
        return {
          kind: "pawn",
          pawnId: pawn.id,
          ownerIds: [pawn.id],
        };
      }

      const structure = findStructureById(state, ownerId);
      if (structure?.instanceId != null) {
        const hubCol = Number.isFinite(structure.col)
          ? Math.floor(structure.col)
          : Number.isFinite(structure.hubCol)
            ? Math.floor(structure.hubCol)
            : null;
        return {
          kind: "hub",
          ownerId: structure.instanceId,
          ownerIds: [structure.instanceId],
          hubCol,
          systemId: "build",
        };
      }

      const tile = findTileById(state, ownerId);
      if (tile) {
        const envCol = Number.isFinite(tile.col)
          ? Math.floor(tile.col)
          : Number.isFinite(tile.envCol)
            ? Math.floor(tile.envCol)
            : null;
        if (envCol != null) {
          return {
            kind: "tile",
            envCol,
            ownerIds: [tile.instanceId ?? ownerId],
          };
        }
      }
    }
    return null;
  }

  function sameContextRef(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (!a.targetRef || !b.targetRef) return false;
    return (
      sameTargetRef(a.targetRef, b.targetRef) &&
      String(a.systemId || "") === String(b.systemId || "")
    );
  }

  function setLozengeHoverProcessContext(nextContext) {
    const normalized =
      nextContext?.targetRef != null
        ? {
            targetRef: nextContext.targetRef,
            systemId: nextContext.systemId ?? null,
          }
        : null;
    if (sameContextRef(lozengeHoverProcessContext, normalized)) return;
    lozengeHoverProcessContext = normalized;
  }

  function clearLozengeHoverUi() {
    endpointHoverUi?.clearLozengeHoverUi?.();
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

  function attachLozengeHoverHandlers(node, { fullLabel = "", hoverSpec = null } = {}) {
    endpointHoverUi?.attachLozengeHoverHandlers?.(node, { fullLabel, hoverSpec });
  }

  function getTargetAnchorRect(target) {
    if (!target) return null;
    if (target?.refKind === "basket") return null;
    const { width: screenWidth } = getScreenSize();
    if (hubStructureDefs[target.defId]) {
      const col = Number.isFinite(target.col)
        ? Math.floor(target.col)
        : Number.isFinite(target.hubCol)
          ? Math.floor(target.hubCol)
          : null;
      if (col == null) return null;
      const span =
        Number.isFinite(target.span) && target.span > 0
          ? Math.floor(target.span)
          : Number.isFinite(target.defaultSpan) && target.defaultSpan > 0
            ? Math.floor(target.defaultSpan)
            : 1;
      const width =
        HUB_STRUCTURE_WIDTH * span + HUB_COL_GAP * Math.max(0, span - 1);
      const pos = layoutHubColPos(
        screenWidth,
        col,
        width,
        HUB_STRUCTURE_ROW_Y
      );
      return { x: pos.x, y: pos.y, width, height: HUB_STRUCTURE_HEIGHT };
    }

    const col = Number.isFinite(target.col)
      ? Math.floor(target.col)
      : Number.isFinite(target.envCol)
        ? Math.floor(target.envCol)
        : null;
    if (col == null) return null;
    const pos = layoutBoardColPos(
      screenWidth,
      col,
      TILE_WIDTH,
      TILE_ROW_Y
    );
    return { x: pos.x, y: pos.y, width: TILE_WIDTH, height: TILE_HEIGHT };
  }

  function getHoverTarget(state) {
    const hover =
      interaction?.getHovered?.() ?? interaction?.getLastHovered?.();
    if (!hover) return null;
    if (hover.kind === "tile") {
      const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
      if (col == null) return null;
      return state?.board?.occ?.tile?.[col] ?? null;
    }
    if (hover.kind === "hub") {
      const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
      if (col == null) return null;
      return (
        state?.hub?.occ?.[col] ??
        state?.hub?.slots?.[col]?.structure ??
        null
      );
    }
    return null;
  }

  function getTargetKey(target) {
    if (!target) return null;
    if (target?.refKind === "basket") {
      const ownerId = target?.ownerId ?? null;
      if (ownerId == null) return null;
      return `basket:${ownerId}`;
    }
    const id = target.instanceId ?? target.id ?? null;
    if (id == null) return null;
    const isHub = !!hubStructureDefs[target.defId];
    const prefix = isHub ? "hub" : "tile";
    return `${prefix}:${id}`;
  }

  function collectProcesses(target) {
    if (target?.refKind === "basket") return [];
    if (!target || !target.systemState) return [];
    const list = [];
    const entries = Object.entries(target.systemState);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [systemId, sysState] of entries) {
      const processes = Array.isArray(sysState?.processes) ? sysState.processes : [];
      for (const proc of processes) {
        if (!proc || !proc.id) continue;
        list.push({ process: proc, systemId });
      }
    }
    list.sort((a, b) => {
      const aStart = Number.isFinite(a.process?.startSec)
        ? a.process.startSec
        : 0;
      const bStart = Number.isFinite(b.process?.startSec)
        ? b.process.startSec
        : 0;
      if (aStart !== bStart) return aStart - bStart;
      const aId = String(a.process?.id ?? "");
      const bId = String(b.process?.id ?? "");
      return aId.localeCompare(bId);
    });
    return list;
  }

  function getTargetLabel(target) {
    if (!target) return "Process";
    if (target?.refKind === "basket") {
      return target?.basketOwnerName || "Basket";
    }
    if (hubStructureDefs[target.defId]) {
      const def = hubStructureDefs[target.defId];
      return def?.name || target.defId || "Structure";
    }
    const tileDef = envTileDefs[target.defId];
    return tileDef?.name || target.defId || "Tile";
  }

  function isGroupedSystem(systemId) {
    return systemId && GROUP_SYSTEM_IDS.has(systemId);
  }

  function isRecipeSystem(systemId) {
    return systemId === "fireplace" || systemId === "workspace";
  }

  function getTilePlanCost() {
    return Math.max(
      0,
      Math.floor(INTENT_AP_COSTS?.tilePlan ?? INTENT_AP_COSTS?.tileCropSelect ?? 0)
    );
  }

  function getHubPlanCost() {
    return Math.max(
      0,
      Math.floor(
        INTENT_AP_COSTS?.hubPlan ??
          INTENT_AP_COSTS?.hubRecipeSelect ??
          INTENT_AP_COSTS?.hubTagOrder ??
          0
      )
    );
  }

  function formatCropName(cropId) {
    if (!cropId) return "Select crop";
    return cropDefs?.[cropId]?.name || cropId;
  }

  function formatRecipeName(recipeId) {
    if (!recipeId) return "Select recipe";
    return recipeDefs?.[recipeId]?.name || recipeId;
  }

  function getCropOptions() {
    const crops = Object.entries(cropDefs || {})
      .map(([key, crop]) => ({ key, crop }))
      .filter((entry) => !!entry.crop);
    return [
      { value: null, label: "Pause planting", detail: "Planting paused" },
      ...crops.map(({ key, crop }) => {
        const cropId =
          (typeof crop?.cropId === "string" && crop.cropId.length > 0
            ? crop.cropId
            : typeof crop?.id === "string" && crop.id.length > 0
              ? crop.id
              : key) || null;
        const seasons = Array.isArray(crop?.plantSeasons)
          ? crop.plantSeasons.join(", ")
          : "any";
        const maturity = Number.isFinite(crop?.maturitySec)
          ? `${Math.floor(crop.maturitySec)}s`
          : "?";
        return {
          value: cropId,
          label: crop.name || cropId,
          detail: `Seasons: ${seasons} | ${maturity}`,
        };
      }),
    ];
  }

  function getRecipeOptions(systemId) {
    const kind = systemId === "workspace" ? "craft" : systemId === "fireplace" ? "cook" : null;
    if (!kind) return [];
    const state = getStateSafe();
    const availability = computeAvailableRecipesAndBuildings(state);
    const list = Object.entries(recipeDefs || {})
      .map(([key, recipe]) => ({ key, recipe }))
      .filter((entry) => !!entry.recipe)
      .filter((entry) => entry.recipe.kind === kind)
      .filter((entry) => availability.recipeIds?.has(entry.recipe.id))
      .sort((a, b) =>
        String(a?.recipe?.name || a?.recipe?.id || a?.key || "").localeCompare(
          String(b?.recipe?.name || b?.recipe?.id || b?.key || "")
        )
      );
    return [
      {
        value: null,
        label: kind === "craft" ? "Pause crafting" : "Pause cooking",
        detail: "No recipe selected",
      },
      ...list.map(({ key, recipe }) => {
        const recipeId =
          (typeof recipe?.id === "string" && recipe.id.length > 0
            ? recipe.id
            : key) || null;
        return {
          value: recipeId,
          label: recipe.name || recipeId,
          detail: formatRecipeDetails(recipe),
        };
      }),
    ];
  }

  function getHubCol(target) {
    if (!target) return null;
    if (Number.isFinite(target.col)) return Math.floor(target.col);
    if (Number.isFinite(target.hubCol)) return Math.floor(target.hubCol);
    return null;
  }

  function getEnvCol(target) {
    if (!target) return null;
    if (Number.isFinite(target.col)) return Math.floor(target.col);
    if (Number.isFinite(target.envCol)) return Math.floor(target.envCol);
    return null;
  }
  function getProcessVariant(process, processDef) {
    if (!processDef) return "generic";
    const kind = processDef.processKind;
    if (kind === "cropGrowth") return "growing";
    if (kind === "depositItems") return "depositing";
    if (kind === "build") return "building";
    const recipe = recipeDefs?.[process?.type] || null;
    if (recipe?.kind === "cook") return "cooking";
    if (recipe?.kind === "craft") return "crafting";
    return "generic";
  }

  function getCardTitle(targetLabel, process, processDef, variantOverride = null) {
    const variant = variantOverride || getProcessVariant(process, processDef);
    if (variant === "growing") return `${targetLabel} - Growing`;
    if (variant === "depositing") return `${targetLabel} - Depositing`;
    if (variant === "building") return `${targetLabel} - Building`;
    if (variant === "cooking") return `${targetLabel} - Cooking`;
    if (variant === "crafting") return `${targetLabel} - Crafting`;
    return `${targetLabel} - ${processDef?.displayName || "Process"}`;
  }

  function formatRequirementLabel(req) {
    if (!req) return "Requirement";
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
    return "Requirement";
  }

  function formatOutputLabel(out) {
    if (!out) return "Output";
    if (out.kind === "item") {
      const def = itemDefs?.[out.itemId];
      return def?.name || out.itemId || "Item";
    }
    if (out.kind === "pool") {
      if (out.fromLedger) return "Deposit Pool";
      const def = itemDefs?.[out.itemId];
      const itemLabel = def?.name || out.itemId || "Item";
      return `${itemLabel} Pool`;
    }
    if (out.kind === "prestige") return "Prestige";
    if (out.kind === "resource") {
      const raw = String(out.resource || "Resource");
      return raw.length ? raw[0].toUpperCase() + raw.slice(1) : "Resource";
    }
    if (out.kind === "system") {
      return `${out.system || "System"}:${out.key || ""}`;
    }
    return "Output";
  }

  function formatRecipeItemName(kind) {
    if (kind && itemDefs?.[kind]) return itemDefs[kind].name || kind;
    return kind || "";
  }

  function formatRecipeItemList(items) {
    const list = Array.isArray(items) ? items : [];
    return list
      .filter((entry) => entry && entry.kind)
      .map((entry) => {
        const name = formatRecipeItemName(entry.kind);
        const qty = Number.isFinite(entry.qty) ? Math.floor(entry.qty) : 1;
        return `${name} x${qty}`;
      })
      .join(", ");
  }

  function formatRecipeDetails(recipe) {
    if (!recipe) return "";
    const inputs = formatRecipeItemList(recipe.inputs);
    const tools = formatRecipeItemList(recipe.toolRequirements);
    const outputs = formatRecipeItemList(recipe.outputs);
    const duration = Number.isFinite(recipe.durationSec)
      ? recipe.durationSec <= 0
        ? "Instant"
        : `${Math.floor(recipe.durationSec)}s`
      : "?";
    const parts = [];
    if (inputs) parts.push(`Inputs: ${inputs}`);
    if (tools) parts.push(`Tools: ${tools}`);
    if (outputs) parts.push(`Output: ${outputs}`);
    parts.push(`Time: ${duration}`);
    return parts.join(" | ");
  }

  function getEndpointLabel(state, endpointId) {
    return (
      endpointDescriptorTools?.getEndpointLabel?.(state, endpointId) || "Endpoint"
    );
  }

  function resolveEndpointHoverSpec(state, endpointId) {
    return (
      endpointDescriptorTools?.resolveEndpointHoverSpec?.(state, endpointId) || {
        inventoryOwnerIds: [],
        processContext: null,
        focus: null,
      }
    );
  }

  function findStructureById(state, id) {
    return targetResolver.findStructureById(state, id);
  }

  function findPawnById(state, id) {
    return targetResolver.findPawnById(state, id);
  }

  function buildBasketTarget(state, ownerId) {
    return targetResolver.buildBasketTarget(state, ownerId);
  }

  function findTileById(state, id) {
    return targetResolver.findTileById(state, id);
  }

  function makeTargetRef(target) {
    return targetResolver.makeTargetRef(target);
  }

  function sameTargetRef(a, b) {
    return targetResolver.sameTargetRef(a, b);
  }

  function resolveTargetFromRef(state, ref) {
    return targetResolver.resolveTargetFromRef(state, ref);
  }

  function buildCandidateSignature(state, target, process, processDef) {
    return signatureTools.buildCandidateSignature(
      state,
      target,
      process,
      processDef
    );
  }

  function buildTemplateCandidateSignature(state, target, systemId) {
    return signatureTools.buildTemplateCandidateSignature(state, target, systemId);
  }

  function buildProcessSignature(state, targetKey, target, entries) {
    return signatureTools.buildProcessSignature(state, targetKey, target, entries);
  }

  function buildRoutingTemplateSignature(target, systemId) {
    return signatureTools.buildRoutingTemplateSignature(target, systemId);
  }

  function clearContent(content, dropTargets) {
    if (content) content.removeChildren();
    if (Array.isArray(dropTargets)) dropTargets.length = 0;
  }

  function invalidateAllSignatures() {
    windowManager.invalidateAllSignatures();
  }
  function drawCardBackground(bg, width, height) {
    bg.clear();
    bg.lineStyle(2, COLORS.panelBorder, 0.9);
    bg.beginFill(COLORS.panel, 0.96);
    bg.drawRoundedRect(0, 0, width, height, CARD_RADIUS);
    bg.endFill();
  }

  function drawModuleBox(bg, width, height) {
    bg.clear();
    bg.lineStyle(1, COLORS.moduleBorder, 0.9);
    bg.beginFill(COLORS.moduleBg, 0.95);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
  }

  function drawDrawerBox(bg, width, height) {
    bg.clear();
    bg.lineStyle(1, COLORS.drawerBorder, 0.9);
    bg.beginFill(COLORS.drawerBg, 0.95);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
  }

  function drawDropboxBox(bg, width, height) {
    bg.clear();
    bg.lineStyle(1, COLORS.dropboxBorder, 0.9);
    bg.beginFill(COLORS.dropboxBg, 0.95);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
  }

  function collectModuleView(moduleViews, container, width) {
    if (!Array.isArray(moduleViews) || !container) return;
    const bg = container.children?.[0];
    if (!bg || typeof bg.clear !== "function") return;
    moduleViews.push({ bg, width });
  }

  function stretchModuleViews(moduleViews, targetHeight) {
    if (!Array.isArray(moduleViews) || !Number.isFinite(targetHeight)) return;
    const height = Math.max(1, Math.floor(targetHeight));
    for (const view of moduleViews) {
      if (!view?.bg || typeof view.bg.clear !== "function") continue;
      const width = Number.isFinite(view.width) ? Math.max(1, Math.floor(view.width)) : 1;
      drawModuleBox(view.bg, width, height);
    }
  }

  function layoutPillEntries(slotView) {
    const entries = slotView.pillEntries || [];
    let y = 0;
    for (const entry of entries) {
      entry.container.x = 0;
      entry.container.y = y;
      const rowHeight =
        entry.container?.height && entry.container.height > PILL_HEIGHT
          ? entry.container.height
          : PILL_HEIGHT;
      y += rowHeight + PILL_GAP;
    }
    if (entries.length > 0) y -= PILL_GAP;
    slotView.pillHeight = y;
  }

  function applyPillStyle(entry) {
    if (!entry) return;
    let bgColor = COLORS.pillEnabled;
    let textColor = COLORS.pillText;
    if (entry.locked) bgColor = COLORS.pillLocked;
    if (!entry.enabled) {
      bgColor = COLORS.pillDisabled;
      textColor = COLORS.pillTextDisabled;
    }
    if (entry.invalid) {
      bgColor = COLORS.pillInvalid;
      textColor = COLORS.pillTextInvalid;
    }

    entry.bg.clear();
    entry.bg.lineStyle(1, COLORS.panelBorder, 0.9);
    entry.bg.beginFill(bgColor, 0.95);
    entry.bg.drawRoundedRect(0, 0, entry.width, PILL_HEIGHT, PILL_RADIUS);
    entry.bg.endFill();

    entry.labelText.style.fill = textColor;
    entry.labelText.dirty = true;
  }

  function buildPillEntry(state, slotView, rawEndpointId, resolvedId, opts = {}) {
    const entryWidth = Math.max(60, slotView.entryWidth || 80);
    const entry = {
      endpointId: rawEndpointId,
      resolvedId,
      enabled: opts.enabled,
      invalid: opts.invalid,
      locked: opts.locked,
      draggable: opts.draggable,
      container: new PIXI.Container(),
      bg: new PIXI.Graphics(),
      labelText: null,
      fullLabel: "",
      width: entryWidth,
    };

    const row = entry.container;
    row.eventMode = "static";
    row.cursor = entry.draggable ? "grab" : entry.locked ? "default" : "pointer";

    row.addChild(entry.bg);

    const label = getEndpointLabel(state, resolvedId || rawEndpointId);
    const labelText = new PIXI.Text(label, {
      fill: COLORS.pillText,
      fontSize: 10,
    });
    labelText.x = PILL_PAD_X + TOGGLE_SIZE + TOGGLE_PAD;
    labelText.y = Math.round((PILL_HEIGHT - labelText.height) / 2);
    const labelMaxWidth = Math.max(0, entryWidth - labelText.x - PILL_PAD_X);
    fitTextToWidth(labelText, label, labelMaxWidth);
    row.addChild(labelText);
    entry.labelText = labelText;
    entry.fullLabel = label;

    const toggle = new PIXI.Graphics();
    toggle.x = PILL_PAD_X;
    toggle.y = Math.round((PILL_HEIGHT - TOGGLE_SIZE) / 2);
    row.addChild(toggle);

    toggle.clear();
    if (entry.locked) {
      toggle.lineStyle(1, COLORS.panelBorder, 0.9);
      toggle.drawRoundedRect(0, 0, TOGGLE_SIZE, TOGGLE_SIZE, 3);
    } else if (entry.enabled) {
      toggle.beginFill(MUCHA_UI_COLORS.accents.cream, 1);
      toggle.drawCircle(TOGGLE_SIZE / 2, TOGGLE_SIZE / 2, 3);
      toggle.endFill();
    } else {
      toggle.lineStyle(2, 0xf2b0b0, 1);
      toggle.moveTo(2, 2);
      toggle.lineTo(TOGGLE_SIZE - 2, TOGGLE_SIZE - 2);
      toggle.moveTo(TOGGLE_SIZE - 2, 2);
      toggle.lineTo(2, TOGGLE_SIZE - 2);
    }

    applyPillStyle(entry);

    const hoverSpec = resolveEndpointHoverSpec(
      state,
      resolvedId || rawEndpointId
    );
    attachLozengeHoverHandlers(row, {
      fullLabel: label,
      hoverSpec,
    });

    if (entry.draggable) {
      row.on("pointerdown", (ev) => {
        slotView.ignoreNextTap = false;
        routingDragController.startDrag(slotView, entry, ev);
      });
    }

    row.on("pointertap", () => {
      if (slotView.ignoreNextTap) {
        slotView.ignoreNextTap = false;
        return;
      }
      if (entry.locked) return;
      if (!entry.endpointId) return;
      const nextEnabled = !entry.enabled;
      const routingMode = slotView.routingMode || "process";
      if (routingMode === "template") {
        if (!slotView.targetRef || !slotView.systemId) return;
        queueActionWhenPaused?.(() =>
          dispatchAction?.(
            ActionKinds.TOGGLE_ROUTING_TEMPLATE_ENDPOINT,
            {
              targetRef: slotView.targetRef,
              systemId: slotView.systemId,
              slotKind: slotView.slotKind,
              slotId: slotView.slotId,
              endpointId: entry.endpointId,
              enabled: nextEnabled,
            },
            { apCost: 0 }
          )
        );
        return;
      }

      if (!slotView.processId) return;
      queueActionWhenPaused?.(() =>
        dispatchAction?.(
          ActionKinds.TOGGLE_PROCESS_ROUTING_ENDPOINT,
          {
            processId: slotView.processId,
            slotKind: slotView.slotKind,
            slotId: slotView.slotId,
            endpointId: entry.endpointId,
            enabled: nextEnabled,
          },
          { apCost: 0 }
        )
      );
    });

    return entry;
  }
  function hasSelectableSlots(processDef, slotKind) {
    const slots = processDef?.routingSlots?.[slotKind] || [];
    return slots.some((slot) => slot && slot.locked !== true);
  }
  function getWindowRect(win) {
    if (!win?.container) return null;
    const localBounds = win.container.getLocalBounds?.() ?? null;
    const scale = Number.isFinite(win?.uiScale) ? win.uiScale : 1;
    const width = Math.max(1, Math.floor((localBounds?.width ?? CORE_WIDTH) * scale));
    const height = Math.max(1, Math.floor((localBounds?.height ?? 140) * scale));
    const x = Number.isFinite(win.container.x) ? win.container.x : 0;
    const y = Number.isFinite(win.container.y) ? win.container.y : 0;
    return { x, y, width, height };
  }

  function buildRoutingDrawer({
    kind,
    width,
    height,
    process,
    processDef,
    routingProcess,
    routingProcessDef,
    routingState,
    routingMode,
    targetRef,
    systemId,
    drawerKey,
    target,
    state,
    hideDrop,
  }) {
    const container = new PIXI.Container();
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const keyId = drawerKey || process?.id || "routing";
    const key = `${keyId}:${kind}`;
    const expanded = drawerExpanded[kind].has(key);

    const arrowText = expanded
      ? kind === "inputs"
        ? "<"
        : ">"
      : kind === "inputs"
      ? ">"
      : "<";
    const button = new PIXI.Container();
    button.eventMode = "static";
    button.cursor = "pointer";
    const buttonBg = new PIXI.Graphics();
    const arrow = new PIXI.Text(arrowText, {
      fill: COLORS.headerSub,
      fontSize: 16,
      fontWeight: "bold",
    });
    button.addChild(buttonBg, arrow);
    button.on("pointertap", () => {
      if (expanded) drawerExpanded[kind].delete(key);
      else drawerExpanded[kind].add(key);
      invalidateAllSignatures();
    });
    container.addChild(button);

    const buttonWidth = Math.max(
      DRAWER_TOGGLE_BUTTON_MIN_WIDTH,
      Math.min(width - DRAWER_TOGGLE_BUTTON_EDGE_PAD * 2, 56)
    );
    const buttonX = expanded
      ? kind === "inputs"
        ? Math.max(
            DRAWER_TOGGLE_BUTTON_EDGE_PAD,
            width - buttonWidth - DRAWER_TOGGLE_BUTTON_EDGE_PAD
          )
        : DRAWER_TOGGLE_BUTTON_EDGE_PAD
      : Math.floor((width - buttonWidth) / 2);
    const contentInset = expanded
      ? buttonWidth + DRAWER_TOGGLE_BUTTON_EDGE_PAD * 2
      : 0;
    const contentInsetLeft =
      expanded && kind === "outputs" ? contentInset : 0;
    const contentInsetRight =
      expanded && kind === "inputs" ? contentInset : 0;
    const contentLeft = MODULE_PAD + contentInsetLeft;
    const contentRight = MODULE_PAD + contentInsetRight;
    const contentWidth = Math.max(28, width - contentLeft - contentRight);

    function layoutDrawerToggle(buttonHeightTarget) {
      const buttonHeight = Math.max(
        24,
        Math.floor(buttonHeightTarget) - DRAWER_TOGGLE_BUTTON_EDGE_PAD * 2
      );
      button.x = buttonX;
      button.y = DRAWER_TOGGLE_BUTTON_EDGE_PAD;
      buttonBg.clear();
      buttonBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      buttonBg.beginFill(COLORS.moduleBg, 0.98);
      buttonBg.drawRoundedRect(0, 0, buttonWidth, buttonHeight, 6);
      buttonBg.endFill();
      arrow.x = Math.floor((buttonWidth - arrow.width) / 2);
      arrow.y = Math.floor((buttonHeight - arrow.height) / 2) - 1;
    }

    layoutDrawerToggle(height);

    if (expanded) {
      let y = MODULE_PAD;
      const routingDef = routingProcessDef || processDef;
      const activeProcess = routingProcess || process;
      const routing = routingState || activeProcess?.routing || null;
      const slots = routingDef?.routingSlots?.[kind] || [];
      const context = { leaderId: activeProcess?.leaderId ?? null };
      for (const slotDef of slots) {
        if (!slotDef || slotDef.locked) continue;

        const label = new PIXI.Text(slotDef.label || slotDef.slotId, {
          fill: COLORS.moduleText,
          fontSize: 10,
          fontWeight: "bold",
        });
        label.x = contentLeft;
        label.y = y;
        container.addChild(label);
        y += 14;

        const slotState =
          routing?.[kind]?.[slotDef.slotId] || { ordered: [], enabled: {} };
        const orderedRaw = Array.isArray(slotState.ordered)
          ? slotState.ordered
          : [];

        const candidates = listCandidateEndpoints(
          state,
          activeProcess,
          slotDef,
          target,
          context
        );
        const orderedList = orderedRaw.length > 0 ? orderedRaw : candidates;

        const pillContainer = new PIXI.Container();
        pillContainer.x = contentLeft;
        pillContainer.y = y;
        container.addChild(pillContainer);

        const slotView = {
          processId: process?.id ?? null,
          slotKind: kind,
          slotId: slotDef.slotId,
          slotLocked: false,
          pillContainer,
          pillEntries: [],
          ignoreNextTap: false,
          entryWidth: contentWidth,
          routingMode: routingMode || "process",
          targetRef: targetRef || null,
          systemId: systemId || null,
        };

        for (const rawEndpointId of orderedList) {
          const resolvedId =
            resolveFixedEndpointId(rawEndpointId, activeProcess, context) || rawEndpointId;
          const isDrop =
            isDropEndpoint(resolvedId) && routingDef?.supportsDropslot;
          if (hideDrop && isDrop) continue;
          const enabled = slotState.enabled?.[rawEndpointId] !== false;
          const valid = isDrop || candidates.includes(resolvedId);
          const entry = buildPillEntry(state, slotView, rawEndpointId, resolvedId, {
            enabled,
            invalid: !valid,
            locked: isDrop,
            draggable: !isDrop,
          });
          pillContainer.addChild(entry.container);
          slotView.pillEntries.push(entry);
        }

        layoutPillEntries(slotView);
        y += slotView.pillHeight + MODULE_GAP;
      }
    }

    drawDrawerBox(bg, width, height);

    return {
      container,
      bg,
      setHeight: (nextHeight) => {
        drawDrawerBox(bg, width, nextHeight);
        layoutDrawerToggle(nextHeight);
      },
    };
  }
  function rebuildWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    let y = 0;
    const count = entries.length;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry?.process || !entry?.processDef) continue;
      const built = buildProcessCard(state, target, entry, i, count, {
        ...cardOpts,
        dropTargets,
      });
      built.card.y = y;
      content.addChild(built.card);
      y += built.height + CARD_GAP;
    }
  }

  function buildGrowthEmptyCard(state, target, opts = {}) {
    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const totalWidth = CORE_WIDTH;
    const title = `${getTargetLabel(target)} - Growing`;
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!pinned);

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const central = new PIXI.Container();
    central.x = 0;
    central.y = BODY_PAD;
    body.addChild(central);

    const moduleCount = 2;
    const moduleWidth = Math.floor(
      (totalWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount
    );

    let moduleX = 0;
    let moduleMaxHeight = 0;
    const moduleViews = [];

    const progressMod = new PIXI.Container();
    progressMod.x = moduleX;
    progressMod.y = 0;
    central.addChild(progressMod);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildGrowthProgressModule({
        container: progressMod,
        width: moduleWidth,
        entries: [],
      })
    );
    collectModuleView(moduleViews, progressMod, moduleWidth);
    moduleX += moduleWidth + MODULE_GAP;

    const outputMod = new PIXI.Container();
    outputMod.x = moduleX;
    outputMod.y = 0;
    central.addChild(outputMod);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildGrowthOutputModule({
        container: outputMod,
        width: moduleWidth,
        pool: target?.systemState?.growth?.maturedPool || null,
      })
    );
    collectModuleView(moduleViews, outputMod, moduleWidth);

    central.height = moduleMaxHeight;

    const bodyContentHeight = Math.max(moduleMaxHeight, MIN_BODY_CONTENT_HEIGHT);
    stretchModuleViews(moduleViews, bodyContentHeight);
    central.height = bodyContentHeight;
    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, totalWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  function buildGrowthSignature(state, targetKey, target, entries) {
    return signatureTools.buildGrowthSignature(state, targetKey, target, entries);
  }

  function rebuildGrowthWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    if (!Array.isArray(entries) || entries.length === 0) {
      const templateProcess = getTemplateProcessForSystem(target, "growth", {
        state,
      });
      const templateDef = templateProcess
        ? getProcessDefForInstance(templateProcess, target, {})
        : null;
      if (!templateDef) {
        const built = buildGrowthEmptyCard(state, target, cardOpts);
        built.card.y = 0;
        content.addChild(built.card);
        return;
      }
      const routingState =
        target?.systemState?.growth?.routingTemplate || { inputs: {}, outputs: {} };
      const built = buildProcessCard(
        state,
        target,
        { process: templateProcess, processDef: templateDef },
        0,
        1,
        {
          ...cardOpts,
          dropTargets,
          groupMode: "growth",
          groupEntries: [],
          routingMode: "template",
          routingState,
          routingProcess: templateProcess,
          routingProcessDef: templateDef,
          routingTargetRef: makeTargetRef(target),
          routingSystemId: "growth",
          drawerKey: `template:growth:${getTargetKey(target) || "target"}`,
          allowDropbox: false,
        }
      );
      built.card.y = 0;
      content.addChild(built.card);
      return;
    }

    const primary = entries[0];
    const built = buildProcessCard(state, target, primary, 0, 1, {
      ...cardOpts,
      dropTargets,
      groupMode: "growth",
      groupEntries: entries,
    });
    built.card.y = 0;
    content.addChild(built.card);
  }

  function buildBuildSignature(state, targetKey, target, entries) {
    return signatureTools.buildBuildSignature(state, targetKey, target, entries);
  }

  function rebuildBuildWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    if (!Array.isArray(entries) || entries.length === 0) {
      const templateProcess = getTemplateProcessForSystem(target, "build", {
        state,
      });
      const templateDef = templateProcess
        ? getProcessDefForInstance(templateProcess, target, {})
        : null;
      if (!templateDef) return;
      const routingState =
        target?.systemState?.build?.routingTemplate || { inputs: {}, outputs: {} };
      const forceModules = new Set(["requirements", "progress"]);
      const built = buildProcessCard(
        state,
        target,
        { process: templateProcess, processDef: templateDef },
        0,
        1,
        {
          ...cardOpts,
          dropTargets,
          preview: true,
          forceModules,
          routingMode: "template",
          routingState,
          routingProcess: templateProcess,
          routingProcessDef: templateDef,
          routingTargetRef: makeTargetRef(target),
          routingSystemId: "build",
          drawerKey: `template:build:${getTargetKey(target) || "target"}`,
          allowRouting: true,
          allowDropbox: false,
        }
      );
      built.card.y = 0;
      content.addChild(built.card);
      return;
    }

    rebuildWidget(state, target, entries, {
      content,
      dropTargets,
      cardOpts,
    });
  }

  function buildResidentsSignature(state, targetKey, target, entries) {
    return signatureTools.buildResidentsSignature(state, targetKey, target, entries);
  }

  function rebuildResidentsWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    if (Array.isArray(entries) && entries.length > 0) {
      rebuildWidget(state, target, entries, {
        content,
        dropTargets,
        cardOpts,
      });
      return;
    }

    const templateProcess = getTemplateProcessForSystem(target, "residents", {
      state,
    });
    const templateDef = templateProcess
      ? getProcessDefForInstance(templateProcess, target, {})
      : null;
    if (!templateDef) return;

    const routingState =
      target?.systemState?.residents?.routingTemplate || { inputs: {}, outputs: {} };
    const forceModules = new Set(["requirements", "progress"]);
    const built = buildProcessCard(
      state,
      target,
      { process: templateProcess, processDef: templateDef },
      0,
      1,
      {
        ...cardOpts,
        dropTargets,
        preview: true,
        forceModules,
        routingMode: "template",
        routingState,
        routingProcess: templateProcess,
        routingProcessDef: templateDef,
        routingTargetRef: makeTargetRef(target),
        routingSystemId: "residents",
        drawerKey: `template:residents:${getTargetKey(target) || "target"}`,
        allowRouting: true,
        allowDropbox: false,
      }
    );
    built.card.y = 0;
    content.addChild(built.card);
  }

  function getDepositPoolTarget(target) {
    if (target?.refKind === "basket") {
      const systemId = "storage";
      const poolKey = "byKindTier";
      const pool = target?.systemState?.storage?.byKindTier ?? null;
      return {
        systemId,
        poolKey,
        pool,
        ownerKind: "pawn",
        ownerId: target?.ownerId ?? null,
      };
    }
    if (!target?.defId) return null;
    const def = hubStructureDefs?.[target.defId];
    const deposit = def?.deposit;
    if (!deposit || typeof deposit !== "object") return null;
    const systemId =
      typeof deposit.systemId === "string" ? deposit.systemId : null;
    if (!systemId) return null;
    const poolKey =
      typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
        ? deposit.poolKey
        : "byKindTier";
    const pool = target?.systemState?.[systemId]?.[poolKey] ?? null;
    return { systemId, poolKey, pool };
  }

  function getWithdrawState(target) {
    const key = getTargetKey(target) || "target";
    if (!withdrawUiStateByTarget.has(key)) {
      withdrawUiStateByTarget.set(key, {
        selectedItemId: null,
        amount: 1,
      });
    }
    return withdrawUiStateByTarget.get(key);
  }

  function pruneWithdrawUiStateCache(state) {
    if (withdrawUiStateByTarget.size <= WITHDRAW_UI_CACHE_MAX) return;
    const keep = new Set();

    for (const win of windows.values()) {
      const target = resolveTargetFromRef(state, win?.targetRef);
      const key = getTargetKey(target);
      if (key) keep.add(key);
    }

    const hoverTarget = resolveTargetFromRef(state, hoverContext?.targetRef);
    const externalTarget = resolveTargetFromRef(
      state,
      externalFocusContext?.targetRef
    );
    const hoverKey = getTargetKey(hoverTarget);
    const externalKey = getTargetKey(externalTarget);
    if (hoverKey) keep.add(hoverKey);
    if (externalKey) keep.add(externalKey);

    for (const key of withdrawUiStateByTarget.keys()) {
      if (withdrawUiStateByTarget.size <= WITHDRAW_UI_CACHE_MAX) break;
      if (keep.has(key)) continue;
      withdrawUiStateByTarget.delete(key);
    }
  }

  function canWithdrawFromTarget(target) {
    const info = getDepositPoolTarget(target);
    if (!info) return false;
    return WITHDRAWABLE_POOL_SYSTEM_IDS.has(info.systemId);
  }

  function getDepositDropboxOwnerId(target) {
    if (!target || target?.refKind === "basket") return null;
    const def = target?.defId ? hubStructureDefs?.[target.defId] : null;
    const deposit = def?.deposit;
    if (!deposit || deposit.instantDropboxLoad !== true) return null;
    const ownerId = target?.instanceId ?? target?.id ?? null;
    if (ownerId == null) return null;
    return buildHubDropboxOwnerId(ownerId);
  }

  function getPoolItemTotals(pool, itemId) {
    const empty = {
      total: 0,
      byTier: { bronze: 0, silver: 0, gold: 0, diamond: 0 },
    };
    if (!pool || typeof pool !== "object" || !itemId) return empty;
    const bucket = pool[itemId];
    if (!bucket || typeof bucket !== "object") return empty;
    const byTier = {
      bronze: Math.max(0, Math.floor(bucket.bronze ?? 0)),
      silver: Math.max(0, Math.floor(bucket.silver ?? 0)),
      gold: Math.max(0, Math.floor(bucket.gold ?? 0)),
      diamond: Math.max(0, Math.floor(bucket.diamond ?? 0)),
    };
    const total = byTier.bronze + byTier.silver + byTier.gold + byTier.diamond;
    return { total, byTier };
  }

  function getPoolItemOptions(pool) {
    if (!pool || typeof pool !== "object") return [];
    const keys = Object.keys(pool).sort((a, b) => a.localeCompare(b));
    const out = [];
    for (const itemId of keys) {
      const totals = getPoolItemTotals(pool, itemId);
      if (totals.total <= 0) continue;
      const itemName = itemDefs?.[itemId]?.name || itemId;
      out.push({
        value: itemId,
        label: `${itemName} (${totals.total})`,
        detail: `B ${totals.byTier.bronze}  S ${totals.byTier.silver}  G ${totals.byTier.gold}  D ${totals.byTier.diamond}`,
      });
    }
    return out;
  }

  function normalizeWithdrawSelection(withdrawState, options) {
    if (!withdrawState) return null;
    const validIds = new Set((options || []).map((entry) => entry.value));
    if (!withdrawState.selectedItemId || !validIds.has(withdrawState.selectedItemId)) {
      withdrawState.selectedItemId = options?.[0]?.value ?? null;
    }
    if (!Number.isFinite(withdrawState.amount) || withdrawState.amount <= 0) {
      withdrawState.amount = 1;
    }
    return withdrawState.selectedItemId;
  }

  function openSelectionDropdown({
    options,
    selectedValue,
    anchorBounds,
    onSelect,
    width,
  }) {
    selectionActions.openSelectionDropdown({
      options,
      selectedValue,
      anchorBounds,
      onSelect,
      width,
    });
  }

  function openGrowthSelectionDropdown(target, anchorBounds) {
    selectionActions.openGrowthSelectionDropdown(target, anchorBounds);
  }

  function openRecipeSelectionDropdown(target, systemId, anchorBounds) {
    selectionActions.openRecipeSelectionDropdown(target, systemId, anchorBounds);
  }

  function openWithdrawItemDropdown(target, anchorBounds) {
    selectionActions.openWithdrawItemDropdown(target, anchorBounds);
  }

  function requestPoolWithdraw(target, itemId, amount) {
    selectionActions.requestPoolWithdraw(target, itemId, amount);
  }

  function buildPoolSignature(pool) {
    if (!pool || typeof pool !== "object") return "none";
    if (
      pool.bronze != null ||
      pool.silver != null ||
      pool.gold != null ||
      pool.diamond != null
    ) {
      return `${pool.bronze ?? 0}:${pool.silver ?? 0}:${pool.gold ?? 0}:${
        pool.diamond ?? 0
      }`;
    }
    const keys = Object.keys(pool).sort((a, b) => a.localeCompare(b));
    const parts = [];
    for (const key of keys) {
      const bucket = pool[key];
      if (!bucket || typeof bucket !== "object") continue;
      const b = Math.max(0, Math.floor(bucket.bronze ?? 0));
      const s = Math.max(0, Math.floor(bucket.silver ?? 0));
      const g = Math.max(0, Math.floor(bucket.gold ?? 0));
      const d = Math.max(0, Math.floor(bucket.diamond ?? 0));
      parts.push(`${key}:${b},${s},${g},${d}`);
    }
    return parts.length ? parts.join("|") : "empty";
  }

  function buildDepositEmptyCard(state, target, opts = {}) {
    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const totalWidth = CORE_WIDTH;
    const title = `${getTargetLabel(target)} - Depositing`;
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!pinned);

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const dropboxOwnerId = getDepositDropboxOwnerId(target);
    const showDropbox = !!dropboxOwnerId;
    const dropboxGap = showDropbox ? SEGMENT_GAP : 0;
    const centralWidth = Math.max(
      120,
      totalWidth - (showDropbox ? DROPBOX_SIZE + dropboxGap : 0)
    );

    let dropbox = null;
    if (showDropbox) {
      dropbox = new PIXI.Container();
      dropbox.x = 0;
      dropbox.y = BODY_PAD;
      body.addChild(dropbox);
    }

    const central = new PIXI.Container();
    central.x = showDropbox ? DROPBOX_SIZE + dropboxGap : 0;
    central.y = BODY_PAD;
    body.addChild(central);

    const moduleCount = 2;
    const moduleWidth = Math.floor(
      (centralWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount
    );

    let moduleX = 0;
    let moduleMaxHeight = 0;
    const moduleViews = [];

    const prestigeMod = new PIXI.Container();
    prestigeMod.x = moduleX;
    prestigeMod.y = 0;
    central.addChild(prestigeMod);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildPrestigeModule({
        container: prestigeMod,
        width: moduleWidth,
        process: {},
      })
    );
    collectModuleView(moduleViews, prestigeMod, moduleWidth);
    moduleX += moduleWidth + MODULE_GAP;

    const outputMod = new PIXI.Container();
    outputMod.x = moduleX;
    outputMod.y = 0;
    central.addChild(outputMod);
    const depositInfo = getDepositPoolTarget(target);
    const canWithdraw = canWithdrawFromTarget(target);
    if (canWithdraw) {
      const withdrawState = getWithdrawState(target);
      moduleMaxHeight = Math.max(
        moduleMaxHeight,
        buildWithdrawModule({
          container: outputMod,
          width: moduleWidth,
          pool: depositInfo?.pool ?? null,
          withdrawState,
          onOpenItemDropdown: (bounds) => openWithdrawItemDropdown(target, bounds),
          onWithdraw: (itemId, qty) => requestPoolWithdraw(target, itemId, qty),
        })
      );
      collectModuleView(moduleViews, outputMod, moduleWidth);
    } else {
      const poolSummary = formatPoolSummary({
        kind: "pool",
        target: depositInfo?.pool ?? null,
      });
      moduleMaxHeight = Math.max(
        moduleMaxHeight,
        buildOutputModule({
          container: outputMod,
          width: moduleWidth,
          outputs: [{ kind: "pool", fromLedger: true }],
          poolSummary,
        })
      );
      collectModuleView(moduleViews, outputMod, moduleWidth);
    }

    central.height = moduleMaxHeight;

    const dropboxHeight = showDropbox ? DROPBOX_SIZE + 18 : 0;
    const bodyContentHeight = Math.max(
      moduleMaxHeight,
      dropboxHeight,
      MIN_BODY_CONTENT_HEIGHT
    );
    stretchModuleViews(moduleViews, bodyContentHeight);
    central.height = bodyContentHeight;
    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    if (showDropbox && dropbox) {
      buildDropboxModule({
        container: dropbox,
        width: DROPBOX_SIZE,
        height: bodyContentHeight,
        process: null,
        dropTargets: opts.dropTargets,
        dropOwnerId: dropboxOwnerId,
        labelText: "Dropbox",
      });
    }

    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, centralWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  function rebuildDepositWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    if (!Array.isArray(entries) || entries.length === 0) {
      const built = buildDepositEmptyCard(state, target, {
        ...cardOpts,
        dropTargets,
      });
      built.card.y = 0;
      content.addChild(built.card);
      return;
    }

    rebuildWidget(state, target, entries, {
      content,
      dropTargets,
      cardOpts,
    });
  }

  function buildDepositSignature(state, targetKey, target, entries) {
    const depositInfo = getDepositPoolTarget(target);
    const poolSig = buildPoolSignature(depositInfo?.pool);
    return signatureTools.buildDepositSignature(
      state,
      targetKey,
      target,
      entries,
      poolSig
    );
  }

  function buildBasketCard(state, target, opts = {}) {
    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const totalWidth = CORE_WIDTH;
    const ownerLabel = target?.basketOwnerName || "Basket";
    const title = `${ownerLabel} - Basket`;
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!pinned);

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const central = new PIXI.Container();
    central.x = 0;
    central.y = BODY_PAD;
    body.addChild(central);

    const moduleCount = 2;
    const moduleWidth = Math.floor(
      (totalWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount
    );

    let moduleX = 0;
    let moduleMaxHeight = 0;
    const moduleViews = [];

    const storageMod = new PIXI.Container();
    storageMod.x = moduleX;
    storageMod.y = 0;
    central.addChild(storageMod);
    const depositInfo = getDepositPoolTarget(target);
    const poolSummary = formatPoolSummary({
      kind: "pool",
      target: depositInfo?.pool ?? null,
    });
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildOutputModule({
        container: storageMod,
        width: moduleWidth,
        outputs: [{ kind: "pool", fromLedger: true }],
        poolSummary,
      })
    );
    collectModuleView(moduleViews, storageMod, moduleWidth);
    moduleX += moduleWidth + MODULE_GAP;

    const withdrawMod = new PIXI.Container();
    withdrawMod.x = moduleX;
    withdrawMod.y = 0;
    central.addChild(withdrawMod);
    const withdrawState = getWithdrawState(target);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildWithdrawModule({
        container: withdrawMod,
        width: moduleWidth,
        pool: depositInfo?.pool ?? null,
        withdrawState,
        onOpenItemDropdown: (bounds) => openWithdrawItemDropdown(target, bounds),
        onWithdraw: (itemId, qty) => requestPoolWithdraw(target, itemId, qty),
      })
    );
    collectModuleView(moduleViews, withdrawMod, moduleWidth);

    central.height = moduleMaxHeight;

    const bodyContentHeight = Math.max(moduleMaxHeight, MIN_BODY_CONTENT_HEIGHT);
    stretchModuleViews(moduleViews, bodyContentHeight);
    central.height = bodyContentHeight;
    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, totalWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  function rebuildBasketWidget(state, target, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    const built = buildBasketCard(state, target, cardOpts);
    built.card.y = 0;
    content.addChild(built.card);
  }

  function buildBasketSignature(state, targetKey, target) {
    const depositInfo = getDepositPoolTarget(target);
    const poolSig = buildPoolSignature(depositInfo?.pool);
    const itemSig = target?.basketItemId != null ? String(target.basketItemId) : "none";
    return signatureTools.buildBasketSignature(targetKey, itemSig, poolSig);
  }

  function getSelectedRecipeId(target, systemId) {
    if (!target || !systemId) return null;
    const sys = target.systemState?.[systemId];
    const selected = sys?.selectedRecipeId ?? null;
    return typeof selected === "string" && selected.length > 0 ? selected : null;
  }

  function buildRecipePreviewEntry(target, systemId, recipeId) {
    if (!recipeId) return null;
    const recipe = recipeDefs?.[recipeId] || null;
    if (!recipe) return null;
    const targetKey = getTargetKey(target) || "target";
    const mode = "work";
    const durationSec = Number.isFinite(recipe.durationSec)
      ? Math.max(1, Math.floor(recipe.durationSec))
      : 1;
    const process = {
      id: `preview:${systemId}:${targetKey}:${recipeId}`,
      type: recipeId,
      mode,
      durationSec,
      progress: 0,
      ownerId: target?.instanceId ?? null,
    };
    const processDef = getProcessDefForInstance(process, target, {
      leaderId: process?.leaderId ?? null,
    });
    if (!processDef) return null;
    return { process, processDef, preview: true };
  }

  function buildIdleProcessDef(systemId) {
    return {
      processKind: "idle",
      displayName: systemId === "workspace" ? "Crafting" : "Cooking",
      transform: {
        mode: "work",
        durationSec: 1,
        requirements: [],
        outputs: [],
        completionPolicy: "none",
      },
      routingSlots: { inputs: [], outputs: [] },
      supportsDropslot: true,
    };
  }

  function rebuildRecipeSystemWidget(state, target, systemId, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    const recipeId = getSelectedRecipeId(target, systemId);
    if (Array.isArray(entries) && entries.length > 0) {
      rebuildWidget(state, target, entries, {
        content,
        dropTargets,
        cardOpts,
      });
      return;
    }

    if (recipeId) {
      const previewEntry = buildRecipePreviewEntry(target, systemId, recipeId);
      if (previewEntry) {
        const forceModules = new Set(["requirements", "progress", "output"]);
        const routingState =
          target?.systemState?.[systemId]?.routingTemplate || { inputs: {}, outputs: {} };
        const built = buildProcessCard(state, target, previewEntry, 0, 1, {
          ...cardOpts,
          dropTargets,
          preview: true,
          forceModules,
          routingMode: "template",
          routingState,
          routingProcess: previewEntry.process,
          routingProcessDef: previewEntry.processDef,
          routingTargetRef: makeTargetRef(target),
          routingSystemId: systemId,
          drawerKey: `template:${systemId}:${getTargetKey(target) || "target"}`,
          allowRouting: true,
          allowDropbox: true,
          dropboxInteractive: true,
        });
        built.card.y = 0;
        content.addChild(built.card);
        return;
      }
    }

    const targetKey = getTargetKey(target) || "target";
    const process = {
      id: `idle:${systemId}:${targetKey}`,
      type: `${systemId}-idle`,
      mode: "work",
      durationSec: 1,
      progress: 0,
      ownerId: target?.instanceId ?? null,
    };
    const processDef = buildIdleProcessDef(systemId);
    const routingState =
      target?.systemState?.[systemId]?.routingTemplate || { inputs: {}, outputs: {} };
    const forceModules = new Set(["requirements", "progress", "output"]);
    const variantOverride = systemId === "workspace" ? "crafting" : "cooking";
    const built = buildProcessCard(
      state,
      target,
      { process, processDef },
      0,
      1,
      {
        ...cardOpts,
        dropTargets,
        preview: true,
        forceModules,
        variantOverride,
        routingMode: "template",
        routingState,
        routingProcess: process,
        routingProcessDef: processDef,
        routingTargetRef: makeTargetRef(target),
        routingSystemId: systemId,
        drawerKey: `template:${systemId}:${targetKey}`,
        allowRouting: true,
        allowDropbox: true,
        dropboxInteractive: false,
      }
    );
    built.card.y = 0;
    content.addChild(built.card);
  }

  function buildRecipeSystemSignature(state, targetKey, target, entries, systemId) {
    const recipeId = getSelectedRecipeId(target, systemId) || "none";
    return signatureTools.buildRecipeSystemSignature(
      state,
      targetKey,
      target,
      entries,
      systemId,
      recipeId
    );
  }

  function collectProcessEntries(state, target, systemIdFilter) {
    const processes = collectProcesses(target);
    const filtered = systemIdFilter
      ? processes.filter((entry) => entry.systemId === systemIdFilter)
      : processes;
    return filtered
      .map((entry) => {
        const processDef = getProcessDefForInstance(
          entry.process,
          target,
          { leaderId: entry.process?.leaderId ?? null }
        );
        return { ...entry, processDef };
      })
      .filter((entry) => entry.processDef);
  }

  function findProcessEntryById(target, processId) {
    if (!target || !processId) return null;
    const processes = collectProcesses(target);
    for (const entry of processes) {
      if (entry?.process?.id === processId) return entry;
    }
    return null;
  }

  function positionWindowAtAnchor(win) {
    windowManager.positionWindowAtAnchor(win);
  }

  function ensureWindow(windowId, target, systemId, origin, offsetIndex, opts = {}) {
    return windowManager.ensureWindow(
      windowId,
      target,
      systemId,
      origin,
      offsetIndex,
      opts
    );
  }

  function hideWindow(windowId) {
    windowManager.hideWindow(windowId);
  }

  function destroyWindow(windowId) {
    windowManager.destroyWindow(windowId);
  }

  function setWindowPinned(windowId, pinned) {
    windowManager.setWindowPinned(windowId, pinned);
  }

  function togglePinnedWindow(windowId) {
    windowManager.togglePinnedWindow(windowId);
  }

  function collectContextWindows(state, context, idSet, flagKey) {
    if (!context?.targetRef) return;
    const target = resolveTargetFromRef(state, context.targetRef);
    if (!target) return;

    if (isGroupedSystem(context.systemId)) {
      const windowId = `group:${context.systemId}:${getTargetKey(target)}`;
      const win = ensureWindow(
        windowId,
        target,
        context.systemId,
        { x: position.x, y: position.y },
        0,
        { group: true, groupKind: context.systemId }
      );
      win[flagKey] = true;
      idSet.add(windowId);
      if (!win.pinned) win.container.visible = true;
      return;
    }

    const entries = collectProcessEntries(state, target, context.systemId);
    let offsetIndex = 0;
    for (const entry of entries) {
      const processId = entry?.process?.id;
      if (!processId) continue;
      const win = ensureWindow(
        processId,
        target,
        context.systemId,
        { x: position.x, y: position.y },
        offsetIndex,
        { processId }
      );
      win[flagKey] = true;
      idSet.add(processId);
      if (!win.pinned) {
        win.container.visible = true;
      }
      offsetIndex += 1;
    }
  }

  function updateHoverWindows(state) {
    const hoverIds = new Set();
    const externalIds = new Set();
    collectContextWindows(state, hoverContext, hoverIds, "hovered");
    collectContextWindows(state, lozengeHoverProcessContext, hoverIds, "hovered");
    collectContextWindows(
      state,
      externalFocusContext,
      externalIds,
      "externalFocused"
    );

    const externalActive = !!externalFocusContext?.targetRef;
    for (const [windowId, win] of windows.entries()) {
      if (win.hovered && !hoverIds.has(windowId)) {
        win.hovered = false;
      }
      if (win.externalFocused && !externalIds.has(windowId)) {
        win.externalFocused = false;
      }

      if (externalActive) {
        win.container.visible = externalIds.has(windowId);
        continue;
      }

      if (!win.pinned && !win.hovered && !win.externalFocused) {
        win.container.visible = false;
      }
    }
  }

  function update() {
    const state = getStateSafe();
    if (!state) {
      clearLozengeHoverUi();
      for (const win of windows.values()) {
        if (win?.container) win.container.visible = false;
      }
      return;
    }

    updateHoverWindows(state);
    const externalActive = !!externalFocusContext?.targetRef;

    for (const [windowId, win] of windows.entries()) {
      const target = resolveTargetFromRef(state, win.targetRef);
      if (!target) {
        destroyWindow(windowId);
        continue;
      }
      const scaleChanged = applyWindowScale(win);
      if (scaleChanged) {
        const localBounds = win.container.getLocalBounds?.() ?? null;
        const scale = Number.isFinite(win?.uiScale) ? win.uiScale : 1;
        const width = Math.max(1, Math.floor((localBounds?.width ?? CORE_WIDTH) * scale));
        const height = Math.max(1, Math.floor((localBounds?.height ?? 140) * scale));
        const screen = getScreenSize();
        const maxX = Math.max(8, screen.width - width - 8);
        const maxY = Math.max(8, screen.height - height - 8);
        win.container.x = Math.max(8, Math.min(maxX, win.container.x));
        win.container.y = Math.max(8, Math.min(maxY, win.container.y));
      }
      if (win.group) {
        const entries = collectProcessEntries(state, target, win.systemId);
        const visible = externalActive
          ? !!win.externalFocused
          : !!win.pinned || !!win.hovered;
        if (!visible) {
          win.container.visible = false;
          if (!win.pinned && !win.hovered && !win.externalFocused) {
            win.idleFrames = (win.idleFrames ?? 0) + 1;
            if (win.idleFrames >= WINDOW_IDLE_DESTROY_FRAMES) {
              destroyWindow(windowId);
            }
          } else {
            win.idleFrames = 0;
          }
          continue;
        }
        win.idleFrames = 0;

        const signatureKey = `${windowId}|${getTargetKey(target)}`;
        let signature = null;
        if (win.groupKind === "growth") {
          signature = buildGrowthSignature(state, signatureKey, target, entries);
        } else if (win.groupKind === "build") {
          signature = buildBuildSignature(state, signatureKey, target, entries);
        } else if (win.groupKind === "residents") {
          signature = buildResidentsSignature(state, signatureKey, target, entries);
        } else if (win.groupKind === "deposit") {
          signature = buildDepositSignature(state, signatureKey, target, entries);
        } else if (win.groupKind === "basket") {
          signature = buildBasketSignature(state, signatureKey, target);
        } else if (isRecipeSystem(win.groupKind)) {
          signature = buildRecipeSystemSignature(
            state,
            signatureKey,
            target,
            entries,
            win.groupKind
          );
        } else {
          signature = buildProcessSignature(state, signatureKey, target, entries);
        }

        if (signature !== win.lastSignature) {
          win.lastSignature = signature;
          if (win.groupKind === "growth") {
            rebuildGrowthWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (win.groupKind === "build") {
            rebuildBuildWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (win.groupKind === "residents") {
            rebuildResidentsWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (win.groupKind === "deposit") {
            rebuildDepositWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (win.groupKind === "basket") {
            rebuildBasketWidget(state, target, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (isRecipeSystem(win.groupKind)) {
            rebuildRecipeSystemWidget(state, target, win.groupKind, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else {
            rebuildWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          }
        }
        positionWindowAtAnchor(win);
        win.container.visible = true;
        win.lastBounds = getWindowRect(win);
        continue;
      }

      const entry = findProcessEntryById(target, win.processId || windowId);
      if (!entry) {
        destroyWindow(windowId);
        continue;
      }
      const processDef = getProcessDefForInstance(
        entry.process,
        target,
        { leaderId: entry.process?.leaderId ?? null }
      );
      if (!processDef) {
        destroyWindow(windowId);
        continue;
      }

      const visible = externalActive
        ? !!win.externalFocused
        : !!win.pinned || !!win.hovered;
      if (!visible) {
        win.container.visible = false;
        if (!win.pinned && !win.hovered && !win.externalFocused) {
          win.idleFrames = (win.idleFrames ?? 0) + 1;
          if (win.idleFrames >= WINDOW_IDLE_DESTROY_FRAMES) {
            destroyWindow(windowId);
          }
        } else {
          win.idleFrames = 0;
        }
        continue;
      }
      win.idleFrames = 0;

      const entries = [{ ...entry, processDef }];
      const signatureKey = `${windowId}|${getTargetKey(target)}`;
      const signature = buildProcessSignature(state, signatureKey, target, entries);
      if (signature !== win.lastSignature) {
        win.lastSignature = signature;
        rebuildWidget(state, target, entries, {
          content: win.content,
          dropTargets: win.dropTargets,
          cardOpts: {
            dragTarget: win.container,
            pinned: win.pinned,
            onPinToggle: () => togglePinnedWindow(windowId),
            onClose: () => hideWindow(windowId),
          },
        });
      }
      positionWindowAtAnchor(win);
      win.container.visible = true;
      win.lastBounds = getWindowRect(win);
    }
    pruneWithdrawUiStateCache(state);
  }

  function getDropTargetOwnerAtGlobalPos(globalPos) {
    return dropTargetRegistry.getDropTargetOwnerAtGlobalPos(globalPos);
  }

  function setDropboxDragAffordance(ownerId, level = "neutral") {
    return dropTargetRegistry.setDropboxDragAffordance(ownerId, level);
  }

  function clearDropboxDragAffordance(ownerId = null) {
    dropTargetRegistry.clearDropboxDragAffordance(ownerId);
  }

  function flashDropTargetError(ownerId) {
    return dropTargetRegistry.flashDropTargetError(ownerId);
  }

  function setHoverTarget(target, systemId) {
    hoverContext = target
      ? { targetRef: makeTargetRef(target), systemId: systemId || null }
      : null;
    invalidateAllSignatures();
  }

  function clearHoverTarget() {
    clearDropboxDragAffordance();
    clearLozengeHoverUi();
    hoverContext = null;
    for (const win of windows.values()) {
      if (!win.hovered) continue;
      win.hovered = false;
      if (!win.pinned && !win.externalFocused) win.container.visible = false;
    }
    invalidateAllSignatures();
  }

  function setExternalFocusTarget(target, systemId) {
    externalFocusContext = target
      ? { targetRef: makeTargetRef(target), systemId: systemId || null }
      : null;
    invalidateAllSignatures();
  }

  function clearExternalFocusTarget() {
    clearDropboxDragAffordance();
    clearLozengeHoverUi();
    externalFocusContext = null;
    for (const win of windows.values()) {
      if (!win.externalFocused) continue;
      win.externalFocused = false;
      if (!win.pinned && !win.hovered) win.container.visible = false;
    }
    invalidateAllSignatures();
  }

  function togglePinnedTarget(target, systemId) {
    const state = getStateSafe();
    if (!state || !target) return;
    if (isGroupedSystem(systemId)) {
      const windowId = `group:${systemId}:${getTargetKey(target)}`;
      const win = ensureWindow(
        windowId,
        target,
        systemId,
        { x: position.x, y: position.y },
        0,
        { group: true, groupKind: systemId }
      );
      const nextPinned = !win?.pinned;
      setWindowPinned(windowId, nextPinned);
      return;
    }

    const entries = collectProcessEntries(state, target, systemId);
    if (entries.length === 0) return;
    const ids = entries
      .map((entry) => entry?.process?.id)
      .filter((id) => !!id);
    if (ids.length === 0) return;
    const anyUnpinned = ids.some((id) => !windows.get(id)?.pinned);
    let offsetIndex = 0;
    for (const entry of entries) {
      const processId = entry?.process?.id;
      if (!processId) continue;
      ensureWindow(
        processId,
        target,
        systemId,
        { x: position.x, y: position.y },
        offsetIndex,
        { processId }
      );
      if (anyUnpinned) {
        setWindowPinned(processId, true);
      } else {
        setWindowPinned(processId, false);
      }
      offsetIndex += 1;
    }
  }

  function showBasketWidgetForOwner(ownerId) {
    const state = getStateSafe();
    if (!state || ownerId == null) return { ok: false, reason: "badOwner" };
    const target = buildBasketTarget(state, ownerId);
    if (!target) return { ok: false, reason: "noEquippedBasket" };
    const windowId = `group:basket:${String(ownerId)}`;
    const win = ensureWindow(
      windowId,
      target,
      "basket",
      { x: position.x, y: position.y },
      0,
      { group: true, groupKind: "basket" }
    );
    if (win?.container?.parent) {
      win.container.parent.addChild(win.container);
    }
    positionBasketWindowNearInventory(win, ownerId);
    setWindowPinned(windowId, true);
    invalidateAllSignatures();
    return { ok: true, windowId };
  }

  function getInventoryWindowForOwner(ownerId) {
    const map = inventoryView?.windows;
    if (!map || typeof map.get !== "function") return null;
    const direct = map.get(ownerId);
    if (direct) return direct;
    if (ownerId == null || typeof map.entries !== "function") return null;
    const ownerKey = String(ownerId);
    for (const [key, value] of map.entries()) {
      if (String(key) === ownerKey) return value;
    }
    return null;
  }

  function positionBasketWindowNearInventory(win, ownerId) {
    if (!win?.container) return false;
    const invWin = getInventoryWindowForOwner(ownerId);
    const invContainer = invWin?.container;
    if (!invContainer || typeof invContainer.getBounds !== "function") return false;

    const invBounds = invContainer.getBounds();
    if (!invBounds) return false;

    const localBounds = win.container.getLocalBounds?.() ?? null;
    const scale = Number.isFinite(win?.uiScale) ? win.uiScale : 1;
    const width = Math.max(1, Math.floor((localBounds?.width ?? CORE_WIDTH) * scale));
    const height = Math.max(1, Math.floor((localBounds?.height ?? 140) * scale));
    const gap = 12;

    let x = invBounds.x + invBounds.width + gap;
    let y = invBounds.y;

    const screen = getScreenSize();
    const maxX = Math.max(8, screen.width - width - 8);
    const maxY = Math.max(8, screen.height - height - 8);

    if (x > maxX) {
      x = invBounds.x - width - gap;
    }

    x = Math.max(8, Math.min(maxX, x));
    y = Math.max(8, Math.min(maxY, y));

    win.container.x = Math.round(x);
    win.container.y = Math.round(y);
    win.hasPosition = true;
    return true;
  }

  function init() {}

  return {
    init,
    update,
    getDropTargetOwnerAtGlobalPos,
    setDropboxDragAffordance,
    clearDropboxDragAffordance,
    flashDropTargetError,
    setHoverTarget,
    clearHoverTarget,
    togglePinnedTarget,
    setExternalFocusTarget,
    clearExternalFocusTarget,
    showBasketWidgetForOwner,
  };
}




