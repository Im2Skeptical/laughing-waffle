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
import { evaluateProcessRequirementAvailability } from "../model/process-requirement-availability.js";
import {
  buildBasketDropboxOwnerId,
  buildHubDropboxOwnerId,
  isAnyDropboxOwnerId,
  isBasketDropboxOwnerId,
  isHubDropboxOwnerId,
  isProcessDropboxOwnerId,
} from "../model/owner-id-protocol.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { envStructureDefs } from "../defs/gamepieces/env-structures-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";
import { skillNodes } from "../defs/gamepieces/skill-tree-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { INTENT_AP_COSTS } from "../defs/gamesettings/action-costs-defs.js";
import {
  computeAvailableRecipesAndBuildings,
  hasEnvTagUnlock,
  hasHubTagUnlock,
} from "../model/skills.js";
import {
  buildRecipePrioritySignature,
  buildRecipePriorityFromSelectedRecipe,
  getEnabledRecipeIds,
  getRecipeKindForHubSystem,
  getTopEnabledRecipeId,
  normalizeRecipePriority,
} from "../model/recipe-priority.js";
import { createPillDragController } from "./ui-helpers/pill-drag-controller.js";
import { createWindowHeader } from "./ui-helpers/window-header.js";
import { MUCHA_UI_COLORS } from "./ui-helpers/mucha-ui-palette.js";
import { applyTextResolution } from "./ui-helpers/text-resolution.js";
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
import { createRecipeManualWindow } from "./process-widget/recipe-manual-window.js";
import {
  VIEW_LAYOUT,
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
  TILE_WIDTH,
  TILE_HEIGHT,
  ENV_STRUCTURE_WIDTH,
  ENV_STRUCTURE_HEIGHT,
  HUB_STRUCTURE_WIDTH,
  HUB_STRUCTURE_HEIGHT,
  HUB_COL_GAP,
  BOARD_COL_GAP,
  ENV_STRUCTURE_ROW_Y,
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
const MODULE_PAD = 7;
const MODULE_RADIUS = 8;

const PILL_HEIGHT = 20;
const PILL_RADIUS = 10;
const PILL_GAP = 6;
const PILL_PAD_X = 8;
const TOGGLE_SIZE = 11;
const TOGGLE_PAD = 6;
const WINDOW_IDLE_DESTROY_FRAMES = 180;
const WITHDRAW_UI_CACHE_MAX = 256;

const GROUP_SYSTEM_IDS = new Set([
  "growth",
  "cook",
  "craft",
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
const TIER_KEYS = ["bronze", "silver", "gold", "diamond"];

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
  progressBg: MUCHA_UI_COLORS.surfaces.panelDeep,
  progressBorder: MUCHA_UI_COLORS.surfaces.borderSoft,
  progressFill: MUCHA_UI_COLORS.accents.gold,
  dropboxBg: MUCHA_UI_COLORS.surfaces.panelDeep,
  dropboxBorder: MUCHA_UI_COLORS.surfaces.borderSoft,
  dropboxValidBg: 0x2a5f40,
  dropboxValidBorder: 0x73ca95,
  dropboxInvalidBg: 0x6e2626,
  dropboxInvalidBorder: 0xff6a6a,
  dropboxCappedBg: 0x6f4f1f,
  dropboxCappedBorder: 0xffbf5a,
  dangerBorder: MUCHA_UI_COLORS.intent.dangerPop,
};

function addRecipeGateEntry(map, recipeId, nodeName) {
  if (!recipeId || !nodeName) return;
  let list = map.get(recipeId);
  if (!list) {
    list = [];
    map.set(recipeId, list);
  }
  if (!list.includes(nodeName)) list.push(nodeName);
}

function scanRecipeGateEffects(map, nodeName, effects) {
  const list = Array.isArray(effects) ? effects : [];
  for (const effect of list) {
    if (!effect || typeof effect !== "object") continue;
    const op = typeof effect.op === "string" ? effect.op : null;
    if (op !== "GrantUnlock") continue;
    const unlockType = typeof effect.unlockType === "string" ? effect.unlockType : null;
    if (unlockType !== "recipe") continue;
    const recipeId =
      typeof effect.recipeId === "string" && effect.recipeId.length > 0
        ? effect.recipeId
        : typeof effect.unlockId === "string" && effect.unlockId.length > 0
          ? effect.unlockId
          : null;
    addRecipeGateEntry(map, recipeId, nodeName);
  }
}

function buildRecipeSkillGateIndex() {
  const out = new Map();
  const nodes = skillNodes && typeof skillNodes === "object" ? skillNodes : {};
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node || typeof node !== "object") continue;
    const nodeName =
      typeof node.name === "string" && node.name.length > 0 ? node.name : nodeId;
    scanRecipeGateEffects(out, nodeName, node.onUnlock);
    scanRecipeGateEffects(out, nodeName, node.unlockEffects);
    scanRecipeGateEffects(out, nodeName, node.effects);
  }
  return out;
}

const RECIPE_SKILL_GATE_INDEX = buildRecipeSkillGateIndex();

function isTierBucketPool(pool) {
  if (!pool || typeof pool !== "object") return false;
  for (const tier of TIER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
  }
  return false;
}

function getGrowthPoolBucket(pool, cropId = null) {
  if (!pool || typeof pool !== "object") return null;
  if (isTierBucketPool(pool)) return pool;
  if (typeof cropId === "string" && cropId.length > 0) {
    const bucket = pool[cropId];
    if (bucket && typeof bucket === "object") return bucket;
    return null;
  }
  return pool;
}

function getGrowthEntryCropId(entry) {
  const process = entry?.process || null;
  if (!process) return null;
  if (typeof process?.defId === "string" && process.defId.length > 0) {
    return process.defId;
  }
  if (typeof process?.cropId === "string" && process.cropId.length > 0) {
    return process.cropId;
  }
  return null;
}

function filterGrowthEntriesByCrop(entries, cropId) {
  const list = Array.isArray(entries) ? entries : [];
  if (typeof cropId !== "string" || cropId.length <= 0) {
    return list.slice();
  }
  return list.filter((entry) => getGrowthEntryCropId(entry) === cropId);
}

export function createProcessWidgetView({
  app,
  layer,
  manualLayer = null,
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
    envStructureDefs,
    itemDefs,
  });
  const withdrawUiStateByTarget = new Map();
  const drawerExpanded = {
    inputs: new Set(),
    outputs: new Set(),
  };
  const selectionDropdown = createSelectionDropdown(layer, app);
  let recipeManualWindow = null;

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
    isBasketDropboxOwnerId,
    envTileDefs,
    envStructureDefs,
    hubStructureDefs,
    findStructureById,
    findEnvStructureById,
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
    envTileDefs,
    hubStructureDefs,
    getTilePlanCost,
    getHubPlanCost,
    getEnvCol,
    getHubCol,
    isRecipeSystem,
    getRecipePriorityForTarget,
    getDepositPoolTarget,
    getPoolItemOptions,
    getWithdrawState,
    normalizeWithdrawSelection,
    invalidateAllSignatures,
    openRecipeManualWindow: (target, systemId) => {
      if (!target || !isRecipeSystem(systemId) || !recipeManualWindow) return;
      const targetRef = makeTargetRef(target);
      if (!targetRef) return;
      recipeManualWindow.open({
        targetRef,
        systemId,
      });
    },
  });
  recipeManualWindow = createRecipeManualWindow({
    PIXI,
    app,
    layer: manualLayer || layer,
    layout: processLayout?.recipeManual,
    getState: () => getStateSafe(),
    resolveViewModel: (payload) => resolveRecipeManualViewModel(payload),
    onToggleRecipe: (payload) => toggleRecipeFromRecipeManual(payload),
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
    countContributingPawnsForProcess,
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
    shouldShowDepositPrestigeModule,
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

  const recipePriorityDragController = createPillDragController({
    app,
    dragStateKey: "recipePriorityDrag",
    dragScale: 1.04,
    dragAlpha: 0.95,
    dragZIndex: 10,
    dragCursor: "grabbing",
    idleCursor: "grab",
    getEntries: (view) => view.pillEntries || [],
    getContainer: (view) => view.pillContainer,
    getRowHeight: () => PILL_HEIGHT,
    getRowStep: () => PILL_HEIGHT + PILL_GAP,
    layoutEntries: (view) => layoutRecipePriorityPills(view),
    onCommit: (view, fromIndex, toIndex) => {
      if (!view || view.slotLocked) return;
      const target = view.target;
      const systemId = view.systemId;
      if (!target || !systemId) return;
      if (systemId === "growth") {
        selectionActions.reorderGrowthSeedPriority?.(target, fromIndex, toIndex);
        return;
      }
      selectionActions.reorderHubRecipePriority?.(target, systemId, fromIndex, toIndex);
    },
    onDragEnd: (view, drag) => {
      view.ignoreNextTap = !!drag?.moved;
      layoutRecipePriorityPills(view);
    },
  });

  function getStateSafe() {
    return typeof getGameState === "function" ? getGameState() : null;
  }

  function hasPositiveStamina(pawn) {
    if (!pawn || typeof pawn !== "object") return false;
    const cur = pawn?.systemState?.stamina?.cur;
    if (!Number.isFinite(cur)) return true;
    return Math.floor(cur) > 0;
  }

  function countContributingPawnsForProcess({
    state,
    target,
  } = {}) {
    const simState = state || getStateSafe();
    if (!simState || !target) return null;
    const pawns = Array.isArray(simState.pawns) ? simState.pawns : [];
    if (pawns.length <= 0) return 0;

    if (hubStructureDefs[target?.defId]) {
      const hubCol = Number.isFinite(target?.col)
        ? Math.floor(target.col)
        : Number.isFinite(target?.hubCol)
          ? Math.floor(target.hubCol)
          : null;
      if (hubCol == null) return null;
      const span =
        Number.isFinite(target?.span) && target.span > 0
          ? Math.floor(target.span)
          : Number.isFinite(hubStructureDefs[target?.defId]?.defaultSpan) &&
            hubStructureDefs[target.defId].defaultSpan > 0
            ? Math.floor(hubStructureDefs[target.defId].defaultSpan)
            : 1;
      const end = hubCol + Math.max(1, span) - 1;
      let count = 0;
      for (const pawn of pawns) {
        const pawnHubCol = Number.isFinite(pawn?.hubCol)
          ? Math.floor(pawn.hubCol)
          : null;
        if (pawnHubCol == null) continue;
        if (Number.isFinite(pawn?.envCol)) continue;
        if (pawnHubCol < hubCol || pawnHubCol > end) continue;
        if (!hasPositiveStamina(pawn)) continue;
        count += 1;
      }
      return count;
    }

    if (envTileDefs[target?.defId]) {
      const envCol = Number.isFinite(target?.col)
        ? Math.floor(target.col)
        : Number.isFinite(target?.envCol)
          ? Math.floor(target.envCol)
          : null;
      if (envCol == null) return null;
      let count = 0;
      for (const pawn of pawns) {
        const pawnEnvCol = Number.isFinite(pawn?.envCol)
          ? Math.floor(pawn.envCol)
          : null;
        if (pawnEnvCol == null) continue;
        if (pawnEnvCol !== envCol) continue;
        if (!hasPositiveStamina(pawn)) continue;
        count += 1;
      }
      return count;
    }

    if (envStructureDefs[target?.defId]) {
      const envCol = Number.isFinite(target?.col)
        ? Math.floor(target.col)
        : Number.isFinite(target?.envCol)
          ? Math.floor(target.envCol)
          : null;
      if (envCol == null) return null;
      const span =
        Number.isFinite(target?.span) && target.span > 0
          ? Math.floor(target.span)
          : Number.isFinite(envStructureDefs[target?.defId]?.defaultSpan) &&
            envStructureDefs[target.defId].defaultSpan > 0
            ? Math.floor(envStructureDefs[target.defId].defaultSpan)
            : 1;
      const end = envCol + Math.max(1, span) - 1;
      let count = 0;
      for (const pawn of pawns) {
        const pawnEnvCol = Number.isFinite(pawn?.envCol)
          ? Math.floor(pawn.envCol)
          : null;
        if (pawnEnvCol == null) continue;
        if (pawnEnvCol < envCol || pawnEnvCol > end) continue;
        if (!hasPositiveStamina(pawn)) continue;
        count += 1;
      }
      return count;
    }

    return null;
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
      : 1;
    return getViewportWidthPx() <= breakpoint ? mobileScale : 1;
  }

  function applyWindowScale(win) {
    if (!win?.container) return false;
    const nextScale = getWindowScale();
    const prevScale = Number.isFinite(win.uiScale) ? win.uiScale : 1;
    if (Math.abs(nextScale - prevScale) < 1e-6) return false;
    win.uiScale = nextScale;
    win.container.scale.set(nextScale);
    refreshWindowTextResolution(win);
    win.hasPosition = false;
    return true;
  }

  function applyTextResolutionToTree(root, uiScale = 1) {
    if (!root || !Array.isArray(root.children)) return 0;
    const scale = Number.isFinite(uiScale) ? Math.max(1, uiScale) : 1;
    let updated = 0;
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node instanceof PIXI.Text) {
        if (applyTextResolution(node, scale)) updated += 1;
      }
      const children = Array.isArray(node.children) ? node.children : null;
      if (!children || children.length <= 0) continue;
      for (let i = 0; i < children.length; i += 1) {
        stack.push(children[i]);
      }
    }
    return updated;
  }

  function refreshWindowTextResolution(win) {
    if (!win?.container) return 0;
    const uiScale = Number.isFinite(win.uiScale) ? win.uiScale : 1;
    return applyTextResolutionToTree(win.container, uiScale);
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
        if (hubStructureDefs[structure.defId]) {
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
        if (envStructureDefs[structure.defId]) {
          const envCol = Number.isFinite(structure.col)
            ? Math.floor(structure.col)
            : Number.isFinite(structure.envCol)
              ? Math.floor(structure.envCol)
              : null;
          return {
            kind: "envStructure",
            col: envCol,
            ownerId: structure.instanceId,
            ownerIds: [structure.instanceId],
            systemId: "build",
          };
        }
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

    if (envStructureDefs[target.defId]) {
      const col = Number.isFinite(target.col)
        ? Math.floor(target.col)
        : Number.isFinite(target.envCol)
          ? Math.floor(target.envCol)
          : null;
      if (col == null) return null;
      const span =
        Number.isFinite(target.span) && target.span > 0
          ? Math.floor(target.span)
          : Number.isFinite(envStructureDefs[target.defId]?.defaultSpan) &&
            envStructureDefs[target.defId].defaultSpan > 0
            ? Math.floor(envStructureDefs[target.defId].defaultSpan)
            : 1;
      const width =
        ENV_STRUCTURE_WIDTH * span + BOARD_COL_GAP * Math.max(0, span - 1);
      const pos = layoutBoardColPos(
        screenWidth,
        col,
        width,
        ENV_STRUCTURE_ROW_Y
      );
      return { x: pos.x, y: pos.y, width, height: ENV_STRUCTURE_HEIGHT };
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
    if (hover.kind === "envStructure") {
      const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
      if (col == null) return null;
      return state?.board?.occ?.envStructure?.[col] ?? null;
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
    const isEnvStructure = !!envStructureDefs[target.defId];
    const prefix = isHub ? "hub" : isEnvStructure ? "envStructure" : "tile";
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
    if (envStructureDefs[target.defId]) {
      const def = envStructureDefs[target.defId];
      return def?.name || target.defId || "Structure";
    }
    const tileDef = envTileDefs[target.defId];
    return tileDef?.name || target.defId || "Tile";
  }

  function isGroupedSystem(systemId) {
    return systemId && GROUP_SYSTEM_IDS.has(systemId);
  }

  function isRecipeSystem(systemId) {
    return (
      systemId === "cook" ||
      systemId === "craft" ||
      systemId === "growth"
    );
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

  function getTargetPlanPreview(target) {
    const envCol = getEnvCol?.(target);
    if (Number.isFinite(envCol)) {
      return actionPlanner?.getTilePlanPreview?.(envCol) ?? null;
    }
    const hubCol = getHubCol?.(target);
    if (Number.isFinite(hubCol)) {
      return actionPlanner?.getHubPlanPreview?.(hubCol) ?? null;
    }
    return null;
  }

  function getRecipePriorityForTarget(target, systemId, stateOverride = null) {
    const state = stateOverride || getStateSafe();
    const preview = getTargetPlanPreview(target);
    const recipePriorityValue =
      systemId === "growth"
        ? preview?.recipePriority ?? target?.systemState?.[systemId]?.recipePriority
        : preview?.recipePriorityBySystemId?.[systemId] ??
          target?.systemState?.[systemId]?.recipePriority;
    const selectedValue =
      systemId === "growth"
        ? preview?.cropId ?? target?.systemState?.growth?.selectedCropId ?? null
        : preview?.recipeIdBySystemId?.[systemId] ??
          target?.systemState?.[systemId]?.selectedRecipeId ??
          null;
    const priority = normalizeRecipePriority(
      recipePriorityValue,
      { systemId, state, includeLocked: false }
    );
    if (priority.ordered.length > 0) return priority;
    return buildRecipePriorityFromSelectedRecipe(selectedValue, {
      systemId,
      state,
      includeLocked: false,
    });
  }

  function buildRecipeEntryMap(entries, { systemId = null } = {}) {
    const map = new Map();
    const list = Array.isArray(entries) ? entries : [];
    for (const entry of list) {
      const process = entry?.process || null;
      if (!process) continue;
      const entryId =
        systemId === "growth"
          ? getGrowthEntryCropId(entry)
          : typeof process?.type === "string" && process.type.length > 0
            ? process.type
            : null;
      if (!entryId) continue;
      if (map.has(entryId)) continue;
      map.set(entryId, entry);
    }
    return map;
  }

  function formatRecipeProcessSnapshot(entry, { systemId = null } = {}) {
    const process = entry?.process || null;
    if (!process) return "Queued: no active process";
    const processDef = entry?.processDef || null;
    const duration = Number.isFinite(processDef?.transform?.durationSec)
      ? Math.max(1, Math.floor(processDef.transform.durationSec))
      : Number.isFinite(process.durationSec)
        ? Math.max(1, Math.floor(process.durationSec))
        : 1;
    const progress = Number.isFinite(process.progress)
      ? Math.max(0, Math.floor(process.progress))
      : 0;
    if (systemId === "growth") {
      return `Progress ${progress}/${duration}`;
    }
    const reqs = Array.isArray(process.requirements) ? process.requirements : [];
    let reqParts = [];
    if (reqs.length > 0) {
      reqParts = reqs
        .slice(0, 2)
        .map((req) => {
          const label = formatRequirementLabel(req);
          const amount = Math.max(0, Math.floor(req?.amount ?? 0));
          const current = Math.max(0, Math.floor(req?.progress ?? 0));
          if (isToolRequirement(req)) {
            return `${label} ${current >= amount ? "Ready" : "Missing"}`;
          }
          return `${label} ${current}/${amount}`;
        });
    }
    const reqText = reqParts.length > 0 ? ` | ${reqParts.join(", ")}` : "";
    return `Progress ${progress}/${duration}${reqText}`;
  }

  function areProcessRequirementsComplete(process) {
    const reqs = Array.isArray(process?.requirements) ? process.requirements : [];
    for (const req of reqs) {
      const amount = Math.max(0, Math.floor(req?.amount ?? 0));
      const progress = Math.max(0, Math.floor(req?.progress ?? 0));
      if (progress < amount) return false;
    }
    return true;
  }

  function isToolRequirement(req) {
    return req?.consume === false || req?.requirementType === "tool";
  }

  function buildRequirementRowFromEntry(req, loaded, required, accessibleTotal = null) {
    const amount = Math.max(0, Math.floor(required ?? req?.amount ?? 0));
    const progress = Math.max(0, Math.floor(loaded ?? req?.progress ?? 0));
    const tool = isToolRequirement(req);
    if (tool) {
      const reachable = Number.isFinite(accessibleTotal)
        ? Math.max(0, Math.floor(accessibleTotal))
        : progress;
      return {
        label: formatRequirementLabel(req),
        progress,
        amount,
        accessibleTotal: reachable,
        displayMode: "badge",
        badgeState: reachable >= amount && amount > 0 ? "ready" : "missing",
      };
    }
    return {
      label: formatRequirementLabel(req),
      progress,
      amount,
      accessibleTotal:
        Number.isFinite(accessibleTotal) && accessibleTotal >= 0
          ? Math.max(0, Math.floor(accessibleTotal))
          : null,
      displayMode: "bar",
    };
  }

  function getContainerScreenPosition(container) {
    if (!container) return { x: 0, y: 0 };
    const global = container.getGlobalPosition?.();
    if (!global) {
      return {
        x: Number(container.x) || 0,
        y: Number(container.y) || 0,
      };
    }
    return { x: global.x, y: global.y };
  }

  function setContainerScreenPosition(container, x, y) {
    if (!container) return;
    const parentPoint =
      typeof container.parent?.toLocal === "function"
        ? container.parent.toLocal({ x, y })
        : { x, y };
    container.x = Math.round(parentPoint.x);
    container.y = Math.round(parentPoint.y);
  }

  function canRecipeEntryAdvanceNow(entry, availability = null) {
    const process = entry?.process || null;
    if (!process) return false;

    const requirementRows = Array.isArray(availability?.requirements)
      ? availability.requirements
      : null;
    if (requirementRows && requirementRows.length > 0) {
      let hasIncompleteRequirement = false;
      for (const row of requirementRows) {
        const required = Math.max(0, Math.floor(row?.required ?? 0));
        const loaded = Math.max(0, Math.floor(row?.loaded ?? 0));
        if (loaded >= required) continue;
        hasIncompleteRequirement = true;
        const reachableFromInputs = Math.max(
          0,
          Math.floor(row?.reachableFromInputs ?? 0)
        );
        if (reachableFromInputs > 0) return true;
      }
      if (hasIncompleteRequirement) return false;
      return true;
    }

    return areProcessRequirementsComplete(process);
  }

  function evaluateRecipeEntryRequirementAvailability(
    state,
    target,
    systemId,
    recipeId,
    recipeEntryMap
  ) {
    if (!state || !target || !systemId || !recipeId) return null;
    const activeEntry = recipeEntryMap?.get?.(recipeId) || null;
    const resolvedEntry = activeEntry || buildRecipePreviewEntry(target, systemId, recipeId);
    if (!resolvedEntry?.process || !resolvedEntry?.processDef) return null;

    const routingTemplate = target?.systemState?.[systemId]?.routingTemplate || null;
    const useTemplateRouting =
      resolvedEntry?.preview === true ||
      !(recipeEntryMap?.has?.(recipeId) === true) ||
      !resolvedEntry?.process?.routing;
    const routingStateOverride = useTemplateRouting
      ? routingTemplate
      : resolvedEntry.process.routing;

    return evaluateProcessRequirementAvailability({
      state,
      target,
      process: resolvedEntry.process,
      processDef: resolvedEntry.processDef,
      routingStateOverride,
      context: { leaderId: resolvedEntry?.process?.leaderId ?? null },
    });
  }

  function buildRequirementAvailabilitySignatureForRecipe(recipeId, availability) {
    const prefix = typeof recipeId === "string" && recipeId.length > 0 ? recipeId : "none";
    if (!availability || !Array.isArray(availability.requirements)) {
      return `${prefix}:none`;
    }
    const reqParts = availability.requirements.map((entry) => {
      const required = Math.max(0, Math.floor(entry?.required ?? 0));
      const loaded = Math.max(0, Math.floor(entry?.loaded ?? 0));
      const reachableFromInputs = Math.max(
        0,
        Math.floor(entry?.reachableFromInputs ?? 0)
      );
      const accessibleTotal = Math.max(0, Math.floor(entry?.accessibleTotal ?? 0));
      const shortfall = Math.max(0, Math.floor(entry?.shortfall ?? 0));
      const materialKey = String(entry?.materialKey || "unknown");
      return `${materialKey}:${loaded}/${required}:${reachableFromInputs}:${accessibleTotal}:${shortfall}`;
    });
    return `${prefix}:${availability.canFulfillAll === false ? 0 : 1}:${
      reqParts.length > 0 ? reqParts.join(",") : "none"
    }`;
  }

  function buildRecipeAvailabilityForPriority({
    state,
    target,
    systemId,
    priority,
    recipeEntryMap,
  } = {}) {
    const byRecipeId = new Map();
    const ordered = Array.isArray(priority?.ordered) ? priority.ordered : [];
    const signatureParts = [];

    for (const recipeId of ordered) {
      if (typeof recipeId !== "string" || recipeId.length <= 0) continue;
      const availability = evaluateRecipeEntryRequirementAvailability(
        state,
        target,
        systemId,
        recipeId,
        recipeEntryMap
      );
      if (availability) byRecipeId.set(recipeId, availability);
      signatureParts.push(
        buildRequirementAvailabilitySignatureForRecipe(recipeId, availability)
      );
    }

    return {
      byRecipeId,
      signature: signatureParts.length > 0 ? signatureParts.join("|") : "none",
    };
  }

  function buildRequirementRowsFromAvailability(availability) {
    if (!availability || !Array.isArray(availability.requirements)) return null;
    const rowsByKey = new Map();
    for (const entry of availability.requirements) {
      const req = entry?.requirement || null;
      if (!req) continue;
      if (isToolRequirement(req)) {
        const key = `tool:${req.kind}:${req.itemId || req.tag || req.resource || ""}`;
        rowsByKey.set(
          key,
          buildRequirementRowFromEntry(
            req,
            entry?.loaded,
            entry?.required,
            entry?.accessibleTotal
          )
        );
        continue;
      }
      let fallbackKey = "unknown:";
      if (req.kind === "item") fallbackKey = `item:${req.itemId || ""}`;
      else if (req.kind === "tag") fallbackKey = `tag:${req.tag || ""}`;
      else if (req.kind === "resource") {
        fallbackKey = `resource:${req.resource || ""}`;
      }
      const key = String(entry?.materialKey || fallbackKey);
      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, {
          label: formatRequirementLabel(req),
          progress: 0,
          amount: 0,
          accessibleTotal: 0,
          displayMode: "bar",
        });
      }
      const row = rowsByKey.get(key);
      row.progress += Math.max(0, Math.floor(entry?.loaded ?? 0));
      row.amount += Math.max(0, Math.floor(entry?.required ?? 0));
      row.accessibleTotal = Math.max(
        row.accessibleTotal,
        Math.max(0, Math.floor(entry?.accessibleTotal ?? 0))
      );
    }
    return Array.from(rowsByKey.values());
  }

  function getRecipeSkillGateText(recipeId, unlocked, { systemId = null } = {}) {
    if (systemId === "growth") {
      return unlocked ? "Available seed" : "Unavailable seed";
    }
    const skillNames = RECIPE_SKILL_GATE_INDEX.get(recipeId) || [];
    if (unlocked) {
      if (skillNames.length > 0) return `Unlocked by ${skillNames.join(", ")}`;
      return "Unlocked";
    }
    if (skillNames.length > 0) {
      return `Locked: requires ${skillNames.join(", ")}`;
    }
    return "Locked: requires skill unlock";
  }

  function buildRecipeDetailLines(entryDef, { systemId = null } = {}) {
    if (!entryDef) return [];
    if (systemId === "growth") {
      const crop = entryDef;
      const seasons = Array.isArray(crop.plantSeasons)
        ? crop.plantSeasons.join(", ")
        : "Any";
      const maturity = Number.isFinite(crop.maturitySec)
        ? `${Math.floor(crop.maturitySec)}s`
        : "?";
      const plantRate = Number.isFinite(crop.plantSeedPerSec)
        ? `${Math.floor(crop.plantSeedPerSec)}/s`
        : "?";
      const harvestRate = Number.isFinite(crop.harvestUnitsPerSec)
        ? `${Math.floor(crop.harvestUnitsPerSec)}/s`
        : "?";
      const baseYield = Number.isFinite(crop.baseYieldMultiplier)
        ? `${crop.baseYieldMultiplier}x`
        : "?";
      return [
        `Plant seasons: ${seasons}`,
        `Maturity: ${maturity}`,
        `Plant rate: ${plantRate}`,
        `Harvest rate: ${harvestRate}`,
        `Base yield: ${baseYield}`,
      ];
    }
    const recipe = entryDef;
    const inputs = formatRecipeItemList(recipe.inputs);
    const tools = formatRecipeItemList(recipe.toolRequirements);
    const outputs = formatRecipeItemList(recipe.outputs);
    const duration = Number.isFinite(recipe.durationSec)
      ? recipe.durationSec <= 0
        ? "Instant"
        : `${Math.floor(recipe.durationSec)}s`
      : "?";
    return [
      `Inputs: ${inputs || "None"}`,
      `Tools: ${tools || "None"}`,
      `Output: ${outputs || "None"}`,
      `Time: ${duration}`,
    ];
  }

  function buildRecipeManualRows({
    availability,
    kind,
    priority,
    recipeEntryMap,
    systemId = null,
  } = {}) {
    const listedRows = [];
    const unlistedRows = [];
    if (systemId === "growth") {
      const crops = Object.entries(cropDefs || {})
        .map(([key, crop]) => ({ key, crop }))
        .filter((entry) => !!entry?.crop);
      for (const { key, crop } of crops) {
        const cropId =
          (typeof crop?.cropId === "string" && crop.cropId.length > 0
            ? crop.cropId
            : typeof crop?.id === "string" && crop.id.length > 0
              ? crop.id
              : key) || null;
        if (!cropId) continue;
        const inList = priority.ordered.includes(cropId);
        const enabled = priority.enabled?.[cropId] !== false;
        const processEntry = recipeEntryMap.get(cropId) || null;
        const row = {
          id: cropId,
          name: crop?.name || cropId,
          kindLabel: "Crop Seed",
          inList,
          enabled,
          actionLabel: inList ? "Remove" : "Add",
          statusText: inList
            ? enabled
              ? "In planting list (enabled)"
              : "In planting list (disabled)"
            : "Not listed in planting list",
          snapshotText: formatRecipeProcessSnapshot(processEntry, { systemId }),
          gateText: getRecipeSkillGateText(cropId, true, { systemId }),
          detailLines: buildRecipeDetailLines(crop, { systemId }),
        };
        if (inList) listedRows.push(row);
        else unlistedRows.push(row);
      }
      const alphaSort = (a, b) =>
        String(a?.name || "").localeCompare(String(b?.name || ""));
      listedRows.sort(alphaSort);
      unlistedRows.sort(alphaSort);
      return listedRows.concat(unlistedRows);
    }

    const recipes = Object.entries(recipeDefs || {})
      .map(([key, recipe]) => ({ key, recipe }))
      .filter((entry) => !!entry?.recipe)
      .filter((entry) => entry.recipe.kind === kind);

    for (const { key, recipe } of recipes) {
      const recipeId =
        (typeof recipe?.id === "string" && recipe.id.length > 0
          ? recipe.id
          : key) || null;
      if (!recipeId) continue;
      const unlocked = availability?.recipeIds?.has(recipeId) === true;
      if (!unlocked) continue;
      const inList = priority.ordered.includes(recipeId);
      const enabled = priority.enabled?.[recipeId] !== false;
      const processEntry = recipeEntryMap.get(recipeId) || null;
      const row = {
        id: recipeId,
        name: recipe?.name || recipeId,
        kindLabel: kind === "craft" ? "Crafting Recipe" : "Cooking Recipe",
        inList,
        enabled,
        actionLabel: inList ? "Remove" : "Add",
        statusText: inList
          ? enabled
            ? "In output list (enabled)"
            : "In output list (disabled)"
          : "Not listed in output list",
        snapshotText: formatRecipeProcessSnapshot(processEntry, { systemId }),
        gateText: getRecipeSkillGateText(recipeId, true, { systemId }),
        detailLines: buildRecipeDetailLines(recipe, { systemId }),
      };
      if (inList) listedRows.push(row);
      else unlistedRows.push(row);
    }

    const alphaSort = (a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""));
    listedRows.sort(alphaSort);
    unlistedRows.sort(alphaSort);
    return listedRows.concat(unlistedRows);
  }

  function resolveRecipeManualViewModel({
    state,
    targetRef,
    systemId,
  } = {}) {
    if (!state || !targetRef || !isRecipeSystem(systemId)) return null;
    const target = resolveTargetFromRef(state, targetRef);
    if (!target) return null;

    const kind = systemId === "growth" ? "crop" : getRecipeKindForHubSystem(systemId);
    if (!kind) return null;

    const availability =
      systemId === "growth" ? null : computeAvailableRecipesAndBuildings(state);
    const priority = getRecipePriorityForTarget(target, systemId, state);
    const entries = collectProcessEntries(state, target, systemId);
    const recipeEntryMap = buildRecipeEntryMap(entries, { systemId });
    const rows = buildRecipeManualRows({
      availability,
      kind,
      priority,
      recipeEntryMap,
      systemId,
    });

    const topEnabledListedId = getTopEnabledRecipeId(priority);
    const listedRows = rows.filter((row) => row.inList);
    let defaultRecipeId = null;
    if (topEnabledListedId && rows.some((row) => row.id === topEnabledListedId)) {
      defaultRecipeId = topEnabledListedId;
    } else if (listedRows.length > 0) {
      defaultRecipeId = listedRows[0].id;
    } else if (rows.length > 0) {
      defaultRecipeId = rows[0].id;
    }

    return {
      title:
        systemId === "growth"
          ? `${getTargetLabel(target)} - Seeds`
          : `${getTargetLabel(target)} - Recipies`,
      rows,
      defaultRecipeId,
      emptyDetailText:
        systemId === "growth"
          ? "No seeds are available for this system yet."
          : "No unlocked recipes are available for this system yet.",
    };
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

  function getTargetKind(target) {
    if (!target || target?.refKind === "basket") return null;
    return hubStructureDefs?.[target.defId] ? "hub" : "env";
  }

  function resolveTagDefMapForTarget(target) {
    const kind = getTargetKind(target);
    if (kind === "hub") return hubTagDefs;
    if (kind === "env") return envTagDefs;
    return null;
  }

  function resolveTagIdForTargetSystem(target, systemId) {
    if (!target || !systemId) return null;
    const tagDefs = resolveTagDefMapForTarget(target);
    if (!tagDefs) return null;
    const tags = Array.isArray(target?.tags) ? target.tags : [];
    for (const tagId of tags) {
      const def = tagDefs?.[tagId];
      const systems = Array.isArray(def?.systems) ? def.systems : [];
      if (systems.includes(systemId)) return tagId;
    }
    return null;
  }

  function buildTagToggleDescriptor(target, systemId, stateOverride = null) {
    if (!target || !systemId) return null;
    const state = stateOverride || getStateSafe();
    if (!state) return null;
    const targetKind = getTargetKind(target);
    if (!targetKind) return null;

    const tagId = resolveTagIdForTargetSystem(target, systemId);
    if (!tagId) return null;

    if (targetKind === "env" && !hasEnvTagUnlock(state, tagId)) return null;
    if (targetKind === "hub" && !hasHubTagUnlock(state, tagId)) return null;

    let disabledPreview = null;
    if (targetKind === "env") {
      const envCol = getEnvCol(target);
      if (Number.isFinite(envCol) && actionPlanner?.getTileTagTogglePreview) {
        disabledPreview = actionPlanner.getTileTagTogglePreview({ envCol, tagId });
      }
    } else if (targetKind === "hub") {
      const hubCol = getHubCol(target);
      if (Number.isFinite(hubCol) && actionPlanner?.getHubTagTogglePreview) {
        disabledPreview = actionPlanner.getHubTagTogglePreview({ hubCol, tagId });
      }
    }

    const disabled =
      typeof disabledPreview === "boolean"
        ? disabledPreview
        : target?.tagStates?.[tagId]?.disabled === true;
    const tagName =
      (targetKind === "hub"
        ? hubTagDefs?.[tagId]?.ui?.name
        : envTagDefs?.[tagId]?.ui?.name) ||
      tagId;

    return {
      targetKind,
      tagId,
      tagName,
      disabled: disabled === true,
    };
  }

  function buildTagToggleSignature(target, systemId, stateOverride = null) {
    const descriptor = buildTagToggleDescriptor(target, systemId, stateOverride);
    if (!descriptor) return "none";
    return `${descriptor.tagId}:${descriptor.disabled ? 1 : 0}`;
  }

  function toggleTargetTagForSystem(target, systemId, opts = {}) {
    const state = getStateSafe();
    if (!state || !target || !systemId) return { ok: false, reason: "badTarget" };
    const descriptor = buildTagToggleDescriptor(target, systemId, state);
    if (!descriptor) return { ok: false, reason: "noTagToggle" };
    const nextDisabled =
      typeof opts?.disabled === "boolean" ? opts.disabled : !descriptor.disabled;
    const targetLabel = getTargetLabel(target);
    const ghostSpec = {
      description: `Tag ${descriptor.tagName} > ${targetLabel}: ${
        nextDisabled ? "Off" : "On"
      }`,
      cost: descriptor.targetKind === "env" ? getTilePlanCost() : getHubPlanCost(),
    };

    const runWhenPaused = () => {
      if (descriptor.targetKind === "env") {
        const envCol = getEnvCol(target);
        if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
        if (actionPlanner?.setTileTagToggleIntent) {
          const res = actionPlanner.setTileTagToggleIntent({
            envCol,
            tagId: descriptor.tagId,
            disabled: nextDisabled,
          });
          if (
            res?.ok === false &&
            res?.reason === "insufficientAP" &&
            typeof flashActionGhost === "function"
          ) {
            flashActionGhost(ghostSpec, "fail");
          }
          return res;
        }
        if (!dispatchAction) return { ok: false, reason: "noDispatch" };
        const res = dispatchAction(
          ActionKinds.TOGGLE_TILE_TAG,
          { envCol, tagId: descriptor.tagId, disabled: nextDisabled },
          { apCost: 5 }
        );
        if (
          res?.ok === false &&
          res?.reason === "insufficientAP" &&
          typeof flashActionGhost === "function"
        ) {
          flashActionGhost(ghostSpec, "fail");
        }
        return res ?? { ok: true };
      }

      const hubCol = getHubCol(target);
      if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
      if (actionPlanner?.setHubTagToggleIntent) {
        const res = actionPlanner.setHubTagToggleIntent({
          hubCol,
          tagId: descriptor.tagId,
          disabled: nextDisabled,
        });
        if (
          res?.ok === false &&
          res?.reason === "insufficientAP" &&
          typeof flashActionGhost === "function"
        ) {
          flashActionGhost(ghostSpec, "fail");
        }
        return res;
      }
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      const res = dispatchAction(
        ActionKinds.TOGGLE_HUB_TAG,
        { hubCol, tagId: descriptor.tagId, disabled: nextDisabled },
        { apCost: 5 }
      );
      if (
        res?.ok === false &&
        res?.reason === "insufficientAP" &&
        typeof flashActionGhost === "function"
      ) {
        flashActionGhost(ghostSpec, "fail");
      }
      return res ?? { ok: true };
    };
    const runWhenLive = () => {
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      if (descriptor.targetKind === "env") {
        const envCol = getEnvCol(target);
        if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
        return dispatchAction(
          ActionKinds.TOGGLE_TILE_TAG,
          { envCol, tagId: descriptor.tagId, disabled: nextDisabled },
          { apCost: getTilePlanCost() }
        );
      }

      const hubCol = getHubCol(target);
      if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
      return dispatchAction(
        ActionKinds.TOGGLE_HUB_TAG,
        { hubCol, tagId: descriptor.tagId, disabled: nextDisabled },
        { apCost: getHubPlanCost() }
      );
    };

    const result =
      typeof queueActionWhenPaused === "function"
        ? queueActionWhenPaused({ runWhenPaused, runWhenLive })
        : runWhenPaused();
    invalidateAllSignatures();
    return result;
  }

  function resolveHeaderTagToggleSpec(target, systemId, stateOverride = null) {
    const descriptor = buildTagToggleDescriptor(target, systemId, stateOverride);
    if (!descriptor) return null;
    return {
      on: descriptor.disabled !== true,
      offLabel: "OFF",
      onLabel: "ON",
      onToggle: () => {
        toggleTargetTagForSystem(target, systemId);
      },
    };
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

  function findEnvStructureById(state, id) {
    return targetResolver.findEnvStructureById(state, id);
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

  function drawModuleBox(bg, width, height, style = null) {
    const borderColor = Number.isFinite(style?.borderColor)
      ? style.borderColor
      : COLORS.moduleBorder;
    const borderAlpha = Number.isFinite(style?.borderAlpha)
      ? style.borderAlpha
      : 0.9;
    const fillColor = Number.isFinite(style?.fillColor)
      ? style.fillColor
      : COLORS.moduleBg;
    const fillAlpha = Number.isFinite(style?.fillAlpha) ? style.fillAlpha : 0.95;

    bg.clear();
    bg.lineStyle(1, borderColor, borderAlpha);
    bg.beginFill(fillColor, fillAlpha);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
    bg.__moduleBoxStyle = {
      borderColor,
      borderAlpha,
      fillColor,
      fillAlpha,
    };
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
    moduleViews.push({
      bg,
      width,
      style:
        bg.__moduleBoxStyle && typeof bg.__moduleBoxStyle === "object"
          ? { ...bg.__moduleBoxStyle }
          : null,
    });
  }

  function stretchModuleViews(moduleViews, targetHeight) {
    if (!Array.isArray(moduleViews) || !Number.isFinite(targetHeight)) return;
    const height = Math.max(1, Math.floor(targetHeight));
    for (const view of moduleViews) {
      if (!view?.bg || typeof view.bg.clear !== "function") continue;
      const width = Number.isFinite(view.width) ? Math.max(1, Math.floor(view.width)) : 1;
      const style =
        view.style && typeof view.style === "object"
          ? view.style
          : view.bg.__moduleBoxStyle && typeof view.bg.__moduleBoxStyle === "object"
            ? view.bg.__moduleBoxStyle
            : null;
      drawModuleBox(view.bg, width, height, style);
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
    const headerToggle = opts.headerToggleSpec || null;

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
      showPin: !!headerToggle,
      pinControlMode: "button",
      pinText: headerToggle?.offLabel || "OFF",
      pinTextPinned: headerToggle?.onLabel || "ON",
      pinButtonWidth: 42,
      pinButtonHeight: 16,
      pinButtonBg: 0x5a2a31,
      pinButtonBgHover: 0x5a2a31,
      pinButtonBgPinned: 0x2e5c3f,
      pinButtonBgPinnedHover: 0x2e5c3f,
      pinButtonStroke: 0xf2b0b0,
      pinButtonStrokePinned: 0xcff5d6,
      pinButtonTextOff: 0xf2b0b0,
      pinButtonTextPinned: 0xd7ffe0,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => headerToggle?.onToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!headerToggle?.on);

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
        pool: opts.pool ?? target?.systemState?.growth?.maturedPool ?? null,
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
    const win = opts.win || null;
    clearContent(content, dropTargets);

    const priority = getRecipePriorityForTarget(target, "growth", state);
    const recipeEntryMap = buildRecipeEntryMap(entries, { systemId: "growth" });
    const recipeAvailability = buildRecipeAvailabilityForPriority({
      state,
      target,
      systemId: "growth",
      priority,
      recipeEntryMap,
    });
    const availabilityByRecipeId = recipeAvailability.byRecipeId;
    const resolvedFocus = resolveRecipeFocusId(
      win,
      priority,
      recipeEntryMap,
      state,
      availabilityByRecipeId
    );
    if (win) {
      win.recipeFocusId = resolvedFocus;
    }
    const recipeViewState = win || { recipeFocusId: resolvedFocus ?? null };
    const focusedPool = getGrowthPoolBucket(
      target?.systemState?.growth?.maturedPool || null,
      resolvedFocus
    );
    const focusedEntries = filterGrowthEntriesByCrop(entries, resolvedFocus);
    const displayedEntries =
      typeof resolvedFocus === "string" && resolvedFocus.length > 0
        ? focusedEntries
        : Array.isArray(entries)
          ? entries
          : [];
    const forceModules = new Set(["progress", "output", "recipePriority"]);
    const customModuleBuilders = {
      recipePriority: ({ container, width }) =>
        buildRecipePriorityModule({
          container,
          width,
          target,
          systemId: "growth",
          win: recipeViewState,
          priority,
          recipeEntryMap,
          availabilityByRecipeId,
        }),
      output: ({ container, width }) =>
        buildGrowthOutputModule({
          container,
          width,
          pool: focusedPool,
        }),
    };

    if (!Array.isArray(entries) || entries.length === 0) {
      const templateProcess = getTemplateProcessForSystem(target, "growth", {
        state,
      });
      const templateDef = templateProcess
        ? getProcessDefForInstance(templateProcess, target, {})
        : null;
      if (!templateDef) {
        const headerToggleSpec =
          typeof cardOpts.resolveHeaderTagToggle === "function"
            ? cardOpts.resolveHeaderTagToggle(target, "growth")
            : null;
        const built = buildGrowthEmptyCard(state, target, {
          ...cardOpts,
          headerToggleSpec,
          pool: focusedPool,
        });
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
          groupEntries: displayedEntries,
          routingMode: "template",
          routingState,
          routingProcess: templateProcess,
          routingProcessDef: templateDef,
          routingTargetRef: makeTargetRef(target),
          routingSystemId: "growth",
          drawerKey: `template:growth:${getTargetKey(target) || "target"}`,
          allowDropbox: false,
          forceModules,
          customModuleBuilders,
        }
      );
      built.card.y = 0;
      content.addChild(built.card);
      return;
    }

    const primary = displayedEntries[0] || entries[0];
    const built = buildProcessCard(state, target, primary, 0, 1, {
      ...cardOpts,
      dropTargets,
      groupMode: "growth",
      groupEntries: displayedEntries,
      forceModules,
      customModuleBuilders,
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

  function shouldShowDepositPrestigeModule(target) {
    const info = getDepositPoolTarget(target);
    return info?.systemId !== "storehouseStore";
  }

  function getDepositDropboxOwnerId(target) {
    if (!target) return null;
    if (target?.refKind === "basket") {
      const ownerId = target?.ownerId ?? null;
      if (ownerId == null) return null;
      return buildBasketDropboxOwnerId(ownerId, target?.basketSlotId ?? null);
    }
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

  function openRecipeManualWindow(target, systemId) {
    if (!target || !isRecipeSystem(systemId)) return;
    const targetRef = makeTargetRef(target);
    if (!targetRef) return;
    recipeManualWindow.open({
      targetRef,
      systemId,
    });
  }

  function toggleRecipeFromRecipeManual({
    targetRef,
    systemId,
    recipeId,
  } = {}) {
    if (!recipeId || !isRecipeSystem(systemId)) return;
    const state = getStateSafe();
    if (!state) return;
    const target = resolveTargetFromRef(state, targetRef);
    if (!target) return;
    if (systemId === "growth") {
      selectionActions.toggleGrowthSeedPresence?.(target, recipeId);
      return;
    }
    selectionActions.toggleRecipePresence?.(target, systemId, recipeId);
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
    const headerToggle = opts.headerToggleSpec || null;

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
      showPin: !!headerToggle,
      pinControlMode: "button",
      pinText: headerToggle?.offLabel || "OFF",
      pinTextPinned: headerToggle?.onLabel || "ON",
      pinButtonWidth: 42,
      pinButtonHeight: 16,
      pinButtonBg: 0x5a2a31,
      pinButtonBgHover: 0x5a2a31,
      pinButtonBgPinned: 0x2e5c3f,
      pinButtonBgPinnedHover: 0x2e5c3f,
      pinButtonStroke: 0xf2b0b0,
      pinButtonStrokePinned: 0xcff5d6,
      pinButtonTextOff: 0xf2b0b0,
      pinButtonTextPinned: 0xd7ffe0,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => headerToggle?.onToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!headerToggle?.on);

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

    const showPrestige = shouldShowDepositPrestigeModule(target);
    const moduleCount = showPrestige ? 2 : 1;
    const moduleWidth = Math.floor(
      (centralWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount
    );

    let moduleX = 0;
    let moduleMaxHeight = 0;
    const moduleViews = [];

    if (showPrestige) {
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
    }

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
      const headerToggleSpec =
        typeof cardOpts.resolveHeaderTagToggle === "function"
          ? cardOpts.resolveHeaderTagToggle(target, "deposit")
          : null;
      const built = buildDepositEmptyCard(state, target, {
        ...cardOpts,
        headerToggleSpec,
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
    const headerToggle = opts.headerToggleSpec || null;

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
      showPin: !!headerToggle,
      pinControlMode: "button",
      pinText: headerToggle?.offLabel || "OFF",
      pinTextPinned: headerToggle?.onLabel || "ON",
      pinButtonWidth: 42,
      pinButtonHeight: 16,
      pinButtonBg: 0x5a2a31,
      pinButtonBgHover: 0x5a2a31,
      pinButtonBgPinned: 0x2e5c3f,
      pinButtonBgPinnedHover: 0x2e5c3f,
      pinButtonStroke: 0xf2b0b0,
      pinButtonStrokePinned: 0xcff5d6,
      pinButtonTextOff: 0xf2b0b0,
      pinButtonTextPinned: 0xd7ffe0,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => headerToggle?.onToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!headerToggle?.on);

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

  function rebuildBasketWidget(state, target, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    const built = buildBasketCard(state, target, {
      ...cardOpts,
      headerToggleSpec: null,
      dropTargets,
    });
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
    const priority = getRecipePriorityForTarget(target, systemId);
    const selected = getTopEnabledRecipeId(priority);
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
      displayName: systemId === "craft" ? "Crafting" : "Cooking",
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

  function normalizeRecipeFocusId(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  function getRecipeFocusTimelineSignature(state) {
    const tSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
    const simStep = Number.isFinite(state?.simStepIndex)
      ? Math.floor(state.simStepIndex)
      : 0;
    const year = Number.isFinite(state?.year) ? Math.floor(state.year) : 0;
    const season = typeof state?.season === "string" ? state.season : "";
    return `${tSec}:${simStep}:${year}:${season}`;
  }

  function isRecipeFocusIdValid(focusId, priority, recipeEntryMap) {
    const resolved = normalizeRecipeFocusId(focusId);
    if (!resolved) return false;
    const ordered = Array.isArray(priority?.ordered) ? priority.ordered : [];
    if (ordered.includes(resolved)) return true;
    return recipeEntryMap?.has?.(resolved) === true;
  }

  function getActiveRecipeProgressSignature(
    priority,
    recipeEntryMap,
    availabilityByRecipeId = null
  ) {
    const enabled = getEnabledRecipeIds(priority);
    const parts = [];
    for (const recipeId of enabled) {
      const entry = recipeEntryMap.get(recipeId);
      if (!entry) continue;
      const availability = availabilityByRecipeId?.get?.(recipeId) || null;
      if (!canRecipeEntryAdvanceNow(entry, availability)) continue;
      const process = entry.process;
      if (!process) continue;
      const progress = Number.isFinite(process.progress)
        ? Math.max(0, Math.floor(process.progress))
        : 0;
      const duration = Number.isFinite(process.durationSec)
        ? Math.max(1, Math.floor(process.durationSec))
        : 1;
      parts.push(`${recipeId}:${process.id ?? "process"}:${progress}/${duration}`);
    }
    return parts.length > 0 ? parts.join("|") : "idle";
  }

  function chooseAutoRecipeFocusId(
    priority,
    recipeEntryMap,
    availabilityByRecipeId = null
  ) {
    const ordered = Array.isArray(priority?.ordered) ? priority.ordered : [];
    const enabled = getEnabledRecipeIds(priority);
    for (const recipeId of enabled) {
      const entry = recipeEntryMap.get(recipeId);
      if (!entry) continue;
      const availability = availabilityByRecipeId?.get?.(recipeId) || null;
      if (canRecipeEntryAdvanceNow(entry, availability)) return recipeId;
    }
    for (const recipeId of enabled) {
      if (recipeEntryMap.has(recipeId)) return recipeId;
    }
    if (enabled.length > 0) return enabled[0];
    for (const recipeId of ordered) {
      if (recipeEntryMap.has(recipeId)) return recipeId;
    }
    return ordered[0] || null;
  }

  function resolveRecipeFocusId(
    win,
    priority,
    recipeEntryMap,
    state,
    availabilityByRecipeId = null
  ) {
    const currentFocusId = normalizeRecipeFocusId(win?.recipeFocusId);
    const currentFocusValid = isRecipeFocusIdValid(
      currentFocusId,
      priority,
      recipeEntryMap
    );
    const isPaused = state?.paused === true;
    const timelineSig = getRecipeFocusTimelineSignature(state);
    const hadTimelineSig = typeof win?.recipeLastTimelineSig === "string";
    const timelineChanged = hadTimelineSig && win.recipeLastTimelineSig !== timelineSig;
    const hadPauseState = typeof win?.recipeLastPaused === "boolean";
    const wasPaused = hadPauseState ? win.recipeLastPaused === true : isPaused;
    const justUnpaused = hadPauseState && wasPaused && !isPaused;
    if (win && typeof win === "object") {
      win.recipeLastPaused = isPaused;
      win.recipeLastTimelineSig = timelineSig;
    }
    const activeProgressSig = getActiveRecipeProgressSignature(
      priority,
      recipeEntryMap,
      availabilityByRecipeId
    );
    const hasActiveWork = activeProgressSig !== "idle";
    const autoFocusId = chooseAutoRecipeFocusId(
      priority,
      recipeEntryMap,
      availabilityByRecipeId
    );

    if (justUnpaused && hasActiveWork) {
      if (autoFocusId) {
        if (win && typeof win === "object") {
          win.recipeFocusMode = "auto";
          win.recipeAutoFocusProgressSig = activeProgressSig;
        }
        return autoFocusId;
      }
    }

    if (isPaused && timelineChanged) {
      if (autoFocusId) {
        if (win && typeof win === "object") {
          win.recipeFocusMode = "auto";
          win.recipeAutoFocusProgressSig = activeProgressSig;
        }
        return autoFocusId;
      }
      return currentFocusValid ? currentFocusId : null;
    }

    if (isPaused) {
      if (currentFocusValid) return currentFocusId;
      return autoFocusId || null;
    }

    if (!isPaused && hasActiveWork && autoFocusId) {
      if (win && typeof win === "object") {
        win.recipeFocusMode = "auto";
        win.recipeAutoFocusProgressSig = activeProgressSig;
      }
      return autoFocusId;
    }

    if (autoFocusId && win && !isPaused && !hasActiveWork) {
      win.recipeFocusMode = "auto";
      win.recipeAutoFocusProgressSig = activeProgressSig;
    }
    if (autoFocusId) return autoFocusId;
    return currentFocusValid ? currentFocusId : null;
  }

  function layoutRecipePriorityPills(view) {
    if (!view) return;
    const entries = Array.isArray(view.pillEntries) ? view.pillEntries : [];
    const dragState = view.recipePriorityDrag || null;
    let y = 0;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry?.container) continue;
      if (dragState && dragState.entry === entry) {
        entry.container.y = dragState.entry.container.y;
        continue;
      }
      let visualIndex = i;
      if (dragState) {
        if (i > dragState.startIndex && i <= dragState.targetIndex) {
          visualIndex = i - 1;
        } else if (i < dragState.startIndex && i >= dragState.targetIndex) {
          visualIndex = i + 1;
        }
      }
      y = visualIndex * (PILL_HEIGHT + PILL_GAP);
      entry.container.y = y;
    }
  }

  function buildRecipePriorityModule({
    container,
    width,
    target,
    systemId,
    win,
    priority,
    recipeEntryMap,
    availabilityByRecipeId,
  }) {
    if (!container || !target || !systemId) return 0;
    const viewState =
      win && typeof win === "object" ? win : { recipeFocusId: null };
    const moduleLabel = systemId === "growth" ? "Seeds" : "Recipies";
    const emptyListLabel =
      systemId === "growth"
        ? "No seeds listed. Use Seeds to add."
        : "No recipes listed. Use Recipies to add.";
    const ordered = Array.isArray(priority?.ordered) ? priority.ordered : [];
    const enabledMap =
      priority?.enabled && typeof priority.enabled === "object" ? priority.enabled : {};

    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const manageButton = new PIXI.Container();
    const manageLabel = new PIXI.Text(moduleLabel, {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    const managePadX = 8;
    const manageBgHeight = 18;
    const manageBgWidthRaw = Math.max(82, Math.ceil(manageLabel.width + managePadX * 2));
    const manageBgWidth = Math.max(
      48,
      Math.min(manageBgWidthRaw, Math.max(48, width - MODULE_PAD * 2))
    );
    const manageBg = new PIXI.Graphics();
    manageBg.beginFill(MUCHA_UI_COLORS.surfaces.borderSoft, 0.98);
    manageBg.drawRoundedRect(0, 0, manageBgWidth, manageBgHeight, 8);
    manageBg.endFill();
    manageButton.addChild(manageBg);
    manageLabel.x = managePadX;
    manageLabel.y = Math.max(0, Math.round((manageBgHeight - manageLabel.height) / 2));
    fitTextToWidth(
      manageLabel,
      moduleLabel,
      Math.max(12, manageBgWidth - managePadX * 2)
    );
    manageButton.addChild(manageLabel);
    manageButton.eventMode = "static";
    manageButton.cursor = "pointer";
    manageButton.on("pointertap", () => {
      openRecipeManualWindow(target, systemId);
    });
    container.addChild(manageButton);
    manageButton.x = Math.max(
      MODULE_PAD,
      Math.floor((width - manageBgWidth) / 2)
    );
    manageButton.y = MODULE_PAD;

    const pillContainer = new PIXI.Container();
    pillContainer.x = MODULE_PAD;
    pillContainer.y = manageButton.y + manageBgHeight + 8;
    container.addChild(pillContainer);
    const pillWidth = Math.max(24, width - MODULE_PAD * 2);

    const pillView = {
      target,
      systemId,
      slotLocked: false,
      pillContainer,
      pillEntries: [],
      ignoreNextTap: false,
      recipePriorityDrag: null,
    };

    for (const recipeId of ordered) {
      const enabled = enabledMap[recipeId] !== false;
      const isFocused = viewState.recipeFocusId === recipeId;
      const processEntry = recipeEntryMap.get(recipeId);
      const availability = availabilityByRecipeId?.get?.(recipeId) || null;
      const blockedByMaterials = availability?.canFulfillAll === false;
      const row = new PIXI.Container();
      row.eventMode = "static";
      row.cursor = "grab";
      row.hitArea = new PIXI.Rectangle(0, 0, pillWidth, PILL_HEIGHT);

      const rowBg = new PIXI.Graphics();
      const bgColor = !enabled
        ? COLORS.pillDisabled
        : isFocused
          ? COLORS.pillEnabled
          : COLORS.moduleBg;
      const borderColor = blockedByMaterials
        ? COLORS.dangerBorder
        : isFocused
          ? COLORS.progressFill
          : COLORS.moduleBorder;
      rowBg.lineStyle(1, borderColor, 0.95);
      rowBg.beginFill(bgColor, 0.98);
      rowBg.drawRoundedRect(0, 0, pillWidth, PILL_HEIGHT, PILL_RADIUS);
      rowBg.endFill();
      row.addChild(rowBg);

      const recipeName =
        systemId === "growth" ? formatCropName(recipeId) : formatRecipeName(recipeId);
      const snapshot = formatRecipeProcessSnapshot(processEntry, { systemId });
      const fullLabel = `${recipeName} - ${snapshot}`;
      const textColor = enabled ? COLORS.pillText : COLORS.pillTextDisabled;

      const labelText = new PIXI.Text(recipeName, {
        fill: textColor,
        fontSize: 10,
        fontWeight: isFocused ? "bold" : "normal",
      });
      const labelStartX = PILL_PAD_X;
      labelText.x = labelStartX;
      labelText.y = Math.round((PILL_HEIGHT - labelText.height) / 2);
      const labelWidth = Math.max(24, pillWidth - labelStartX - 6);
      fitTextToWidth(labelText, recipeName, labelWidth);
      row.addChild(labelText);
      attachLozengeHoverHandlers(row, { fullLabel, hoverSpec: null });

      const pillEntry = {
        recipeId,
        container: row,
      };
      pillView.pillEntries.push(pillEntry);

      row.on("pointerdown", (ev) => {
        recipePriorityDragController.startDrag(pillView, pillEntry, ev);
      });
      row.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        if (pillView.ignoreNextTap) {
          pillView.ignoreNextTap = false;
          return;
        }
        if (win && typeof recipeId === "string" && recipeId.length > 0) {
          win.recipeFocusId = recipeId;
          win.recipeFocusMode = "manual";
          win.recipeAutoFocusProgressSig = getActiveRecipeProgressSignature(
            priority,
            recipeEntryMap,
            availabilityByRecipeId
          );
          win.lastSignature = null;
        }
      });

      pillContainer.addChild(row);
    }

    let contentY = pillContainer.y;
    if (ordered.length <= 0) {
      const emptyText = new PIXI.Text(emptyListLabel, {
        fill: COLORS.moduleSub,
        fontSize: 10,
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: Math.max(24, width - MODULE_PAD * 2),
      });
      emptyText.x = MODULE_PAD;
      emptyText.y = contentY;
      container.addChild(emptyText);
      contentY = emptyText.y + emptyText.height;
    } else {
      layoutRecipePriorityPills(pillView);
      const pillsHeight = ordered.length * (PILL_HEIGHT + PILL_GAP) - PILL_GAP;
      contentY += Math.max(PILL_HEIGHT, pillsHeight);
    }

    const height = Math.max(64, contentY + MODULE_PAD);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildRecipeCardEntry({
    target,
    systemId,
    focusRecipeId,
    recipeEntryMap,
  }) {
    if (focusRecipeId && recipeEntryMap.has(focusRecipeId)) {
      return recipeEntryMap.get(focusRecipeId);
    }
    if (focusRecipeId) {
      return buildRecipePreviewEntry(target, systemId, focusRecipeId);
    }
    return null;
  }

  function rebuildRecipeSystemWidget(state, target, systemId, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    const win = opts.win || null;
    clearContent(content, dropTargets);

    const priority = getRecipePriorityForTarget(target, systemId, state);
    const recipeEntryMap = buildRecipeEntryMap(entries, { systemId });
    const recipeAvailability = buildRecipeAvailabilityForPriority({
      state,
      target,
      systemId,
      priority,
      recipeEntryMap,
    });
    const availabilityByRecipeId = recipeAvailability.byRecipeId;
    const resolvedFocus = resolveRecipeFocusId(
      win,
      priority,
      recipeEntryMap,
      state,
      availabilityByRecipeId
    );
    if (win) {
      win.recipeFocusId = resolvedFocus;
    }
    const selectedEntry = buildRecipeCardEntry({
      target,
      systemId,
      focusRecipeId: resolvedFocus,
      recipeEntryMap,
    });
    if (selectedEntry) {
      const forceModules = new Set(["requirements", "progress", "recipePriority"]);
      const hiddenModuleIds = new Set(["output"]);
      const routingState =
        target?.systemState?.[systemId]?.routingTemplate || { inputs: {}, outputs: {} };
      const routingProcess = selectedEntry.process;
      const routingProcessDef = selectedEntry.processDef;
      const isPreview =
        !recipeEntryMap.has(resolvedFocus) ||
        selectedEntry?.preview === true;
      const selectedAvailability =
        typeof resolvedFocus === "string" && resolvedFocus.length > 0
          ? availabilityByRecipeId.get(resolvedFocus) || null
          : null;
      const requirementRows = buildRequirementRowsFromAvailability(
        selectedAvailability
      );
      const built = buildProcessCard(
        state,
        target,
        selectedEntry,
        0,
        1,
        {
          ...cardOpts,
          dropTargets,
          preview: isPreview,
          forceModules,
          hiddenModuleIds,
          routingMode: isPreview ? "template" : "process",
          routingState: isPreview ? routingState : routingProcess?.routing,
          routingProcess,
          routingProcessDef,
          routingTargetRef: makeTargetRef(target),
          routingSystemId: systemId,
          drawerKey: isPreview
            ? `template:${systemId}:${getTargetKey(target) || "target"}`
            : routingProcess?.id,
          allowRouting: true,
          allowDropbox: true,
          dropboxInteractive: true,
          disableOutputSelectionControl: true,
          customModuleBuilders: {
            recipePriority: ({ container, width }) =>
              buildRecipePriorityModule({
                container,
                width,
                target,
                systemId,
                win,
                priority,
                recipeEntryMap,
                availabilityByRecipeId,
              }),
            requirements: ({ container, width, reqs }) =>
              buildRequirementsModule({
                container,
                width,
                reqs,
                rowsOverride: requirementRows,
                hasShortage: selectedAvailability?.canFulfillAll === false,
              }),
          },
        }
      );
      built.card.y = 0;
      content.addChild(built.card);
      return;
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
    const forceModules = new Set(["requirements", "progress", "recipePriority"]);
    const hiddenModuleIds = new Set(["output"]);
    const variantOverride = systemId === "craft" ? "crafting" : "cooking";
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
        hiddenModuleIds,
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
        disableOutputSelectionControl: true,
        customModuleBuilders: {
          recipePriority: ({ container, width }) =>
            buildRecipePriorityModule({
              container,
              width,
              target,
              systemId,
              win,
              priority,
              recipeEntryMap,
              availabilityByRecipeId,
            }),
        },
      }
    );
    built.card.y = 0;
    content.addChild(built.card);
  }

  function buildRecipeSystemSignature(
    state,
    targetKey,
    target,
    entries,
    systemId,
    recipeFocusId = "none"
  ) {
    const priority = getRecipePriorityForTarget(target, systemId, state);
    const prioritySig = buildRecipePrioritySignature(priority);
    const recipeEntryMap = buildRecipeEntryMap(entries, { systemId });
    const availabilityBundle = buildRecipeAvailabilityForPriority({
      state,
      target,
      systemId,
      priority,
      recipeEntryMap,
    });
    const focusId =
      typeof recipeFocusId === "string" && recipeFocusId.length > 0
        ? recipeFocusId
        : "none";
    return signatureTools.buildRecipeSystemSignature(
      state,
      targetKey,
      target,
      entries,
      systemId,
      prioritySig,
      focusId,
      availabilityBundle.signature
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
    recipeManualWindow.update(state);
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
      win.solidHitArea?.refresh?.();
      const scaleChanged = applyWindowScale(win);
      if (scaleChanged) {
        const localBounds = win.container.getLocalBounds?.() ?? null;
        const scale = Number.isFinite(win?.uiScale) ? win.uiScale : 1;
        const width = Math.max(1, Math.floor((localBounds?.width ?? CORE_WIDTH) * scale));
        const height = Math.max(1, Math.floor((localBounds?.height ?? 140) * scale));
        const screen = getScreenSize();
        const maxX = Math.max(8, screen.width - width - 8);
        const maxY = Math.max(8, screen.height - height - 8);
        const current = getContainerScreenPosition(win.container);
        setContainerScreenPosition(
          win.container,
          Math.max(8, Math.min(maxX, current.x)),
          Math.max(8, Math.min(maxY, current.y))
        );
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
            win.groupKind,
            win.recipeFocusId ?? "none"
          );
        } else {
          signature = buildProcessSignature(state, signatureKey, target, entries);
        }
        signature = `${signature}|tag:${buildTagToggleSignature(
          target,
          win.systemId,
          state
        )}`;

        if (signature !== win.lastSignature) {
          win.lastSignature = signature;
          const baseCardOpts = {
            dragTarget: win.container,
            resolveHeaderTagToggle: (cardTarget, cardSystemId) =>
              resolveHeaderTagToggleSpec(cardTarget, cardSystemId, state),
            onClose: () => hideWindow(windowId),
          };
          if (win.groupKind === "growth") {
            rebuildGrowthWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              win,
              cardOpts: baseCardOpts,
            });
          } else if (win.groupKind === "build") {
            rebuildBuildWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: baseCardOpts,
            });
          } else if (win.groupKind === "residents") {
            rebuildResidentsWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: baseCardOpts,
            });
          } else if (win.groupKind === "deposit") {
            rebuildDepositWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: baseCardOpts,
            });
          } else if (win.groupKind === "basket") {
            rebuildBasketWidget(state, target, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: baseCardOpts,
            });
          } else if (isRecipeSystem(win.groupKind)) {
            rebuildRecipeSystemWidget(state, target, win.groupKind, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              win,
              cardOpts: baseCardOpts,
            });
          } else {
            rebuildWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: baseCardOpts,
            });
          }
          refreshWindowTextResolution(win);
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
      const signature = `${buildProcessSignature(
        state,
        signatureKey,
        target,
        entries
      )}|tag:${buildTagToggleSignature(target, win.systemId, state)}`;
      if (signature !== win.lastSignature) {
        win.lastSignature = signature;
        rebuildWidget(state, target, entries, {
          content: win.content,
          dropTargets: win.dropTargets,
          cardOpts: {
            dragTarget: win.container,
            resolveHeaderTagToggle: (cardTarget, cardSystemId) =>
              resolveHeaderTagToggleSpec(cardTarget, cardSystemId, state),
            onClose: () => hideWindow(windowId),
          },
        });
        refreshWindowTextResolution(win);
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

  function openPinnedTarget(target, systemId) {
    const state = getStateSafe();
    if (!state || !target) return;
    if (isGroupedSystem(systemId)) {
      const windowId = `group:${systemId}:${getTargetKey(target)}`;
      ensureWindow(
        windowId,
        target,
        systemId,
        { x: position.x, y: position.y },
        0,
        { group: true, groupKind: systemId }
      );
      setWindowPinned(windowId, true);
      return;
    }

    const entries = collectProcessEntries(state, target, systemId);
    if (entries.length === 0) return;
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
      setWindowPinned(processId, true);
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

    setContainerScreenPosition(win.container, x, y);
    win.hasPosition = true;
    return true;
  }

  function init() {}

  function getOccludingScreenRects() {
    const rects = [];
    for (const win of windows.values()) {
      win.solidHitArea?.refresh?.();
      const container = win?.container;
      if (!container?.visible || typeof container.getBounds !== "function") continue;
      const bounds = container.getBounds();
      if (bounds) rects.push(bounds);
    }
    const manualRect = recipeManualWindow?.getScreenRect?.();
    if (manualRect) rects.push(manualRect);
    const dropdownRect = selectionDropdown?.getScreenRect?.();
    if (dropdownRect) rects.push(dropdownRect);
    return rects;
  }

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
    openPinnedTarget,
    setExternalFocusTarget,
    clearExternalFocusTarget,
    showBasketWidgetForOwner,
    getOccludingScreenRects,
  };
}




