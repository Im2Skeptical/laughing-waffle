//
// inventory-pixi.js
// Inventory UI system (Pixi).
// - Renders inventories for generic "owners" (hub structures, pawns, etc.)
// - Handles drag/drop + stack splitting.
// - Does NOT contain game rules; delegates legality + mutation to the model.
//


import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { itemSystemDefs } from "../defs/gamesystems/item-system-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { pawnSystemDefs } from "../defs/gamesystems/pawn-systems-defs.js";
import {
  LEADER_EQUIPMENT_SLOT_LABELS,
  LEADER_EQUIPMENT_SLOT_ORDER,
} from "../defs/gamesystems/equipment-slot-defs.js";
import { ActionKinds } from "../model/actions.js";
import {
  PRESTIGE_COST_PER_FOLLOWER,
  HUNGER_THRESHOLD,
  SECONDS_BELOW_HUNGER_THRESHOLD,
  PAWN_AI_HUNGER_START_EAT,
  LEADER_FAITH_HUNGER_DECAY_THRESHOLD,
} from "../defs/gamesettings/gamerules-defs.js";
import { INTENT_AP_COSTS } from "../defs/gamesettings/action-costs-defs.js";
import {
  getLeaderInventorySectionCapabilities,
  getSkillNodes,
  getUnlockedSkillSet,
} from "../model/skills.js";
import { validateHubConstructionPlacement } from "../model/build-helpers.js";
import {
  isItemBeyondAbsoluteTimegraphWindow,
  isItemUseCurrentlyAvailable,
} from "../model/item-use-policy.js";
import { getScrollTimegraphStateFromItem } from "../model/timegraph/edit-policy.js";
import { isAnyDropboxOwnerId } from "../model/owner-id-protocol.js";
import { canStackItems, getItemMaxStack } from "../model/inventory-model.js";
import {
  getLeaderWorkerCount,
  getTotalAttachedWorkers,
  getWorkerAdjustmentAvailability,
} from "../model/prestige-system.js";
import {
  GAMEPIECE_HOVER_SCALE,
  HUB_COLS,
  HUB_COL_GAP,
  HUB_STRUCTURE_WIDTH,
  HUB_STRUCTURE_HEIGHT,
  HUB_STRUCTURE_ROW_Y,
  VIEW_LAYOUT,
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
  getHubColumnCenterX,
} from "./layout-pixi.js";
import { createWindowHeader } from "./ui-helpers/window-header.js";
import { applyTextResolution } from "./ui-helpers/text-resolution.js";
import { MUCHA_UI_COLORS } from "./ui-helpers/mucha-ui-palette.js";
import { installSolidUiHitArea } from "./ui-helpers/solid-ui-hit-area.js";
import { createBuildingManagerView } from "./building-manager-pixi.js";
import { makeDefTooltipSpec } from "./def-tooltip-spec.js";



const HEADER_HEIGHT = 24;
const INNER_PADDING = 8;

const DEFAULT_COLS = 5;
const DEFAULT_ROWS = 3;
const DEFAULT_CELL_SIZE = 40;
const BIN_CELL_SIZE = 1;
const BIN_PAD = 6;
const ITEM_TIER_BORDER_WIDTH = 2;
const ITEM_TIER_BORDER_COLORS = {
  bronze: 0x8b6a3f,
  silver: 0xcdbfa8,
  gold: 0xf2d16b,
  diamond: 0xace3d9, //#ace3d9
  default: 0x333333,
};
const ITEM_GLYPH_COLOR = MUCHA_UI_COLORS.ink.primary;
const ITEM_GLYPH_SHADOW = 0x111111;
const ITEM_GLYPH_ALPHA = 0.9;
const ITEM_GLYPH_FONT_POLICY_FLAG = "__preserveFontFamily";
const ITEM_GLYPH_NO_SMALLCAPS_FLAG = "__disableTitleSmallCaps";
const EQUIP_PANEL_HEIGHT = 164;
const EQUIP_PANEL_PADDING = 8;
const EQUIP_SLOT_VISUAL_CELL_SIZE = 18;
const EQUIP_SLOT_VISUAL_CELLS = {
  head: { w: 2, h: 2 },
  chest: { w: 2, h: 3 },
  mainHand: { w: 2, h: 3 },
  offHand: { w: 2, h: 3 },
  ring1: { w: 1, h: 1 },
  ring2: { w: 1, h: 1 },
  amulet: { w: 1, h: 1 },
};
const EQUIP_SLOT_BG = MUCHA_UI_COLORS.surfaces.panelDeep;
const EQUIP_SLOT_BG_OCCUPIED = MUCHA_UI_COLORS.surfaces.panelRaised;
const EQUIP_SLOT_STROKE = MUCHA_UI_COLORS.surfaces.borderSoft;
const EQUIP_SLOT_STROKE_ACTIVE = MUCHA_UI_COLORS.accents.gold;
const LEADER_PANEL_HEIGHT = 86;
const WORKERS_PANEL_HEIGHT = 96;
const LEADER_PANEL_PADDING = 6;
const LEADER_SYSTEMS_ROW_HEIGHT = 34;
const LEADER_SYSTEMS_ROW_GAP = 6;
const LEADER_SYSTEMS_ICON_SIZE = 22;
const LEADER_SYSTEMS_BAR_HEIGHT = 16;
const LEADER_SYSTEMS_BAR_BG = MUCHA_UI_COLORS.surfaces.panelDeep;
const LEADER_SYSTEMS_BAR_BORDER = MUCHA_UI_COLORS.surfaces.borderSoft;
const LEADER_SYSTEMS_BAR_TEXT = MUCHA_UI_COLORS.ink.secondary;
const LEADER_SYSTEMS_BAR_RADIUS = 7;
const LEADER_SYSTEMS_THRESHOLD_SEEK_COLOR = 0xd3ac6f;
const LEADER_SYSTEMS_THRESHOLD_FAITH_COLOR = 0xe95f5f;
const LEADER_SYSTEMS_THRESHOLD_LABEL_Y_OFFSET = 9;
const LEADER_SYSTEMS_ICON_BORDER = MUCHA_UI_COLORS.surfaces.borderSoft;
const LEADER_SYSTEMS_FALLBACK_COLOR = MUCHA_UI_COLORS.surfaces.border;
const LEADER_FAITH_SYSTEM_ID = "leaderFaith";
const LEADER_SYSTEM_TIER_ORDER = ["bronze", "silver", "gold", "diamond"];
const LEADER_SYSTEM_UI_OVERRIDES = Object.freeze({
  stamina: { icon: "S", color: 0x8ea17f },
  hunger: { icon: "H", color: 0xb67e56 },
  leadership: { icon: "L", color: 0xb59f78 },
  [LEADER_FAITH_SYSTEM_ID]: { icon: "Fa", color: 0xa0886a },
});
const SKILLS_PANEL_HEIGHT = 102;
const SKILLS_UNLOCKED_LIST_MAX = 5;
const SKILLS_LIST_LINE_HEIGHT = 14;
const BUILD_PANEL_PADDING = 6;
const BUILD_PANEL_HINT_HEIGHT = 12;
const BUILD_PANEL_GAP = 8;
const BUILD_PANEL_BUTTON_HEIGHT = 24;
const BUILD_PANEL_BG = MUCHA_UI_COLORS.surfaces.panel;
const BUILD_PANEL_TEXT = MUCHA_UI_COLORS.ink.primary;
const BUILD_PANEL_TEXT_MUTED = MUCHA_UI_COLORS.ink.muted;
const SECTION_HEADER_HEIGHT = 22;
const SECTION_HEADER_RADIUS = 9;
const SECTION_HEADER_BG = MUCHA_UI_COLORS.surfaces.borderSoft;
const SECTION_HEADER_BG_ACTIVE = MUCHA_UI_COLORS.surfaces.panelSoft;
const SECTION_HEADER_TEXT = MUCHA_UI_COLORS.ink.primary;
const SECTION_HEADER_ARROW = MUCHA_UI_COLORS.ink.secondary;
const BUILD_GHOST_SCALE_IDLE = 1.2;
const BUILD_GHOST_SCALE_PLACE = 0.85;
const BUILD_GHOST_PANEL_WIDTH = 140;
const BUILD_GHOST_PANEL_PAD = 8;
const BUILD_GHOST_PANEL_GAP = 10;
const AP_OVERLAY_ALPHA = 0.45;
const AP_OVERLAY_FADE_IN = 14;
const AP_OVERLAY_FADE_OUT = 8;
const AP_OVERLAY_FILL = 0x8a1f2a;
const AP_OVERLAY_STROKE = 0xff4f5e;
const ITEM_TAP_MAX_DRAG_PX = 8;
const ITEM_TAP_MAX_DRAG_TOUCH_PX = 20;
const TOUCH_STACK_TARGET_MARGIN_MAX_PX = 18;
const CONSUME_PROMPT_HOLD_SEC = 0.9;
const CONSUME_PROMPT_FADE_SEC = 0.45;
const CONSUME_PROMPT_TEXT = "Consume?";
const INVENTORY_WINDOW_BG = MUCHA_UI_COLORS.surfaces.panelDeep;
const INVENTORY_SECTION_BG = MUCHA_UI_COLORS.surfaces.panel;
const INVENTORY_SUBPANEL_BG = MUCHA_UI_COLORS.surfaces.panelRaised;
const INVENTORY_HEADER_BG = MUCHA_UI_COLORS.surfaces.header;
const INVENTORY_HEADER_TEXT = MUCHA_UI_COLORS.ink.primary;
const INVENTORY_FOCUS_STROKE = MUCHA_UI_COLORS.accents.glow;
const INVENTORY_DRAG_VALID_STROKE = 0x58c7ff;
const INVENTORY_DRAG_FULL_STROKE = 0xffa24f;
const INVENTORY_DRAG_HOVER_STROKE = 0x6bd37b;
const INVENTORY_BIN_FILL = MUCHA_UI_COLORS.intent.warnPop;
const INVENTORY_BIN_STROKE = MUCHA_UI_COLORS.intent.dangerPop;
const INVENTORY_BIN_ICON = MUCHA_UI_COLORS.ink.primary;
const INVENTORY_GRID_LINE = MUCHA_UI_COLORS.surfaces.borderSoft;
const INVENTORY_BUTTON_BG = MUCHA_UI_COLORS.surfaces.header;
const INVENTORY_PROMPT_BG = MUCHA_UI_COLORS.surfaces.panelSoft;
const INVENTORY_PROMPT_STROKE = MUCHA_UI_COLORS.surfaces.border;
const INVENTORY_WINDOW_Z_BASE = 40;
const INVENTORY_WINDOW_Z_PINNED = INVENTORY_WINDOW_Z_BASE;
const INVENTORY_WINDOW_Z_HOVERED = INVENTORY_WINDOW_Z_BASE + 20;
const INVENTORY_WINDOW_Z_HOVERED_PINNED = INVENTORY_WINDOW_Z_BASE + 30;
const INVENTORY_WINDOW_Z_FOCUSED = INVENTORY_WINDOW_Z_BASE + 40;
const INVENTORY_TOOLTIP_MIN_SCALE = Number.isFinite(GAMEPIECE_HOVER_SCALE)
  ? Math.max(1, GAMEPIECE_HOVER_SCALE)
  : 2;

function getInventoryTooltipScale(tooltipView, uiScale = null, displayObject = null) {
  const windowScale = Number.isFinite(uiScale) ? Math.max(1, uiScale) : 1;
  const relativeScale =
    tooltipView?.getRelativeDisplayScale?.(displayObject, 1) ?? 1;
  return Math.max(INVENTORY_TOOLTIP_MIN_SCALE, windowScale, relativeScale);
}

function getItemTierBorderColor(item, def) {
  const tier = item?.tier ?? def?.defaultTier ?? null;
  return ITEM_TIER_BORDER_COLORS[tier] ?? ITEM_TIER_BORDER_COLORS.default;
}

function getDragAffordanceStroke(level) {
  if (level === "hover") return INVENTORY_DRAG_HOVER_STROKE;
  if (level === "full") return INVENTORY_DRAG_FULL_STROKE;
  if (level === "valid") return INVENTORY_DRAG_VALID_STROKE;
  return INVENTORY_FOCUS_STROKE;
}

function normalizeInventoryOwnerKey(ownerId) {
  return ownerId == null ? null : String(ownerId);
}

function normalizeDropTargetSpec(dropTarget) {
  if (dropTarget == null) return null;
  if (typeof dropTarget === "object") {
    const ownerId = dropTarget.ownerId ?? null;
    if (ownerId == null) return null;
    return { ownerId, anchor: dropTarget.anchor ?? null };
  }
  return { ownerId: dropTarget, anchor: null };
}

function extractAsciiLetters(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    if (isUpper || isLower) out += text[i];
  }
  return out;
}

function formatItemGlyphLabel(def, item) {
  const rawGlyph = def?.ui?.shortLabel ?? def?.shortLabel ?? "";
  const explicitLetters = extractAsciiLetters(String(rawGlyph || "").trim());
  let sourceLetters = explicitLetters;
  if (sourceLetters.length < 2) {
    const defName = def?.name ?? "";
    const kindName = item?.kind ?? "";
    sourceLetters =
      extractAsciiLetters(String(defName)) +
      extractAsciiLetters(String(kindName)) +
      explicitLetters;
  }
  if (sourceLetters.length === 0) return "";
  if (sourceLetters.length === 1) sourceLetters += sourceLetters;
  const first = sourceLetters[0].toUpperCase();
  const second = sourceLetters[1].toLowerCase();
  return `${first}${second}`;
}

export function createInventoryView({
  layer,
  hoverLayer = null,
  modalLayer = null,
  dragLayer,
  stage = null,
  inputElement = null,
  getOwnerLabel,
  getInventoryForOwner,
  canShowHoverUI,
  tooltipView,
  getState,
  getOwnerVisibility,
  getPreviewVersion,
  getInventoryPreview,
  getFocusIntent,
  getExternalFocusOwners,
  openSkillTree,
  onGhostClick,
  hasItemTransferIntent,
  equipItemToSlot,
  depositItemToBasket,
  openBasketWidget,
  moveEquippedItemToInventory,
  moveEquippedItemToSlot,
  getItemTransferAffordability,
  getDropTargetOwnerAt,
  getProcessDropboxDragStatus,
  setProcessDropboxDragAffordance,
  clearProcessDropboxDragAffordance,
  flashDropTargetError,
  setDragGhost,
  resolveDragGhost,
  actionPlanner,

  // Stage 6: injected handlers (timeline-aware in ui-root-pixi.js)
  moveItemBetweenOwners,
  splitStackAndPlace,
  cancelItemTransfer,
  adjustFollowerCount,
  adjustWorkerCount,
  queueActionWhenPaused,
  requestPauseForAction,
  dispatchPlayerEditBatch,
  scheduleActionsAtNextSecond,
  setApDragWarning,
  discardItemFromOwner,
  flashActionGhost,
  setBuildPlacementPreview,
  onUseItem,
  screenToWorld,
  setWorldInventoryDragAffordances,
  getOwnerAnchor,
  getExternalEquipmentSlotAt = null,
  layout = null,
}) {
  const interactionStage = stage || layer.parent;
  if (layer) layer.sortableChildren = true;
  if (hoverLayer) hoverLayer.sortableChildren = true;
  const inventoryLayout =
    layout && typeof layout === "object" ? layout : VIEW_LAYOUT.inventory;

  const windows = new Map();
  let uiBlocked = false;
  let lastPreviewVersion = null;
  let focusIntentCache = null;
  let activeBuildSpec = null;
  let lastPointerPos = null;
  let buildGhost = null;
  let buildGhostSignature = null;
  let consumePrompt = null;
  let dragHoverRevealOwnerId = null;
  const externalItemDragAffordances = new Map();

  // Owners currently showing an error flash; used to pause auto-rebuilds.
  const flashingOwners = new Set();

  // version cache for each owner inventory
  const lastVersionByOwner = new Map();

  // Drag state: window dragging
  const dragWindow = {
    active: false,
    ownerId: null,
    offsetX: 0,
    offsetY: 0,
  };

  // Drag state: item dragging
  const dragItem = {
    active: false,
    ownerId: null,
    item: null,
    sprite: null,
    offsetX: 0,
    offsetY: 0,
    view: null,
    sourceOwnerOverride: null,
    sourceEquipmentSlotId: null,

    cellOffsetGX: 0,
    cellOffsetGY: 0,
    lastGlobalPos: null,
    pressStartX: 0,
    pressStartY: 0,
    movedDistanceSq: 0,
    pointerType: null,
  };
  let activeDropboxAffordanceOwnerId = null;

  // Active split modal
  let activeSplit = null;

  function clearActiveDropboxAffordance(ownerId = null) {
    const targetOwner =
      ownerId != null ? ownerId : activeDropboxAffordanceOwnerId;
    if (targetOwner == null) return;
    clearProcessDropboxDragAffordance?.(targetOwner);
    if (
      activeDropboxAffordanceOwnerId != null &&
      String(activeDropboxAffordanceOwnerId) === String(targetOwner)
    ) {
      activeDropboxAffordanceOwnerId = null;
    }
  }

  function setActiveDropboxAffordance(ownerId, level) {
    if (ownerId == null) return;
    if (
      activeDropboxAffordanceOwnerId != null &&
      String(activeDropboxAffordanceOwnerId) !== String(ownerId)
    ) {
      clearActiveDropboxAffordance(activeDropboxAffordanceOwnerId);
    }
    setProcessDropboxDragAffordance?.(ownerId, level);
    activeDropboxAffordanceOwnerId = ownerId;
  }

  // ---------------------------------------------------------------------------
  // Leader/follower helpers
  // ---------------------------------------------------------------------------

  function getStateSafe() {
    return typeof getState === "function" ? getState() : null;
  }

  function getOwnerVisibilitySafe(ownerId) {
    const visibility =
      typeof getOwnerVisibility === "function"
        ? getOwnerVisibility(ownerId)
        : null;
    if (visibility && typeof visibility === "object") {
      return {
        visible: visibility.visible !== false,
        reason: visibility.reason ?? null,
        ownerKind: visibility.ownerKind ?? "other",
        resolvedOwnerId:
          visibility.resolvedOwnerId !== undefined
            ? visibility.resolvedOwnerId
            : ownerId,
      };
    }
    return {
      visible: true,
      reason: null,
      ownerKind: "other",
      resolvedOwnerId: ownerId,
    };
  }

  function getScreenSize() {
    const hitAreaWidth = Number(interactionStage?.hitArea?.width);
    const hitAreaHeight = Number(interactionStage?.hitArea?.height);
    const stageWidth = Number(interactionStage?.width);
    const stageHeight = Number(interactionStage?.height);

    const width = Number.isFinite(hitAreaWidth) && hitAreaWidth > 0
      ? hitAreaWidth
      : Number.isFinite(stageWidth) && stageWidth > 0
        ? stageWidth
        : VIEWPORT_DESIGN_WIDTH;
    const height = Number.isFinite(hitAreaHeight) && hitAreaHeight > 0
      ? hitAreaHeight
      : Number.isFinite(stageHeight) && stageHeight > 0
        ? stageHeight
        : VIEWPORT_DESIGN_HEIGHT;

    return {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    };
  }

  function getDisplayObjectScreenPosition(displayObject) {
    if (!displayObject) return { x: 0, y: 0 };
    const global = displayObject.getGlobalPosition?.();
    if (!global) {
      return {
        x: Number(displayObject.x) || 0,
        y: Number(displayObject.y) || 0,
      };
    }
    return { x: global.x, y: global.y };
  }

  function setDisplayObjectScreenPosition(displayObject, x, y) {
    if (!displayObject) return { x, y };
    const parentPoint =
      typeof displayObject.parent?.toLocal === "function"
        ? displayObject.parent.toLocal({ x, y })
        : { x, y };
    displayObject.x = parentPoint.x;
    displayObject.y = parentPoint.y;
    return parentPoint;
  }

  function toWorldPoint(globalPos) {
    if (!globalPos) return null;
    if (typeof screenToWorld === "function") {
      const world = screenToWorld(globalPos);
      if (world && Number.isFinite(world.x) && Number.isFinite(world.y)) {
        return world;
      }
    }
    return {
      x: Number(globalPos.x) || 0,
      y: Number(globalPos.y) || 0,
    };
  }

  function toStageCoordsFromClient(clientX, clientY) {
    const rect = inputElement?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const stageWidth = Number(stage?.hitArea?.width) || Number(stage?.width) || rect.width;
    const stageHeight = Number(stage?.hitArea?.height) || Number(stage?.height) || rect.height;
    const x = ((Number(clientX) - rect.left) / rect.width) * stageWidth;
    const y = ((Number(clientY) - rect.top) / rect.height) * stageHeight;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  function resolveHoverAnchor(anchor) {
    let source = anchor;
    if (typeof source === "function") {
      source = source();
    }
    if (source && typeof source.getAnchorRect === "function") {
      source = {
        ...source.getAnchorRect(),
        coordinateSpace: source.coordinateSpace,
      };
    }
    if (!source || typeof source !== "object") return null;
    return {
      x: Number(source.x) || 0,
      y: Number(source.y) || 0,
      width: Number(source.width) || 0,
      height: Number(source.height) || 0,
      coordinateSpace:
        source.coordinateSpace === "screen" ? "screen" : "parent",
    };
  }

  function summarizeResolvedAnchor(anchor) {
    const resolved = resolveHoverAnchor(anchor);
    if (!resolved) return null;
    return {
      x: resolved.x,
      y: resolved.y,
      width: resolved.width,
      height: resolved.height,
      coordinateSpace: resolved.coordinateSpace,
    };
  }

  function positionWindowFromHoverAnchor(win, anchor) {
    if (!win?.container) return;
    const resolvedAnchor = resolveHoverAnchor(anchor);
    if (!resolvedAnchor) return;
    const displaySize = getWindowDisplaySize(win);
    let x = resolvedAnchor.x + resolvedAnchor.width + 10;
    let y = resolvedAnchor.y;

    if (resolvedAnchor.coordinateSpace === "screen") {
      const { width: screenWidth, height: screenHeight } = getScreenSize();
      if (x + displaySize.width > screenWidth) {
        x = resolvedAnchor.x - displaySize.width - 10;
      }
      if (y + displaySize.height > screenHeight) {
        y = screenHeight - displaySize.height - 10;
      }
      if (x < 10) x = 10;
      if (y < 10) y = 10;
      setDisplayObjectScreenPosition(win.container, x, y);
      return;
    }

    win.container.x = x;
    win.container.y = y;
  }

  function getViewportWidthPx() {
    const vvWidth = Number(window?.visualViewport?.width);
    if (Number.isFinite(vvWidth) && vvWidth > 0) return vvWidth;
    const innerWidth = Number(window?.innerWidth);
    if (Number.isFinite(innerWidth) && innerWidth > 0) return innerWidth;
    return VIEWPORT_DESIGN_WIDTH;
  }

  function getInventoryWindowScale() {
    const breakpoint = Number.isFinite(inventoryLayout?.mobileBreakpointPx)
      ? Math.max(320, Math.floor(inventoryLayout.mobileBreakpointPx))
      : 900;
    const mobileScale = Number.isFinite(inventoryLayout?.mobileScale)
      ? Math.max(1, Number(inventoryLayout.mobileScale))
      : 1;
    return getViewportWidthPx() <= breakpoint ? mobileScale : 1;
  }

  function applyWindowScale(win) {
    if (!win?.container) return false;
    const nextScale = getInventoryWindowScale();
    const prevScale = Number.isFinite(win.uiScale) ? win.uiScale : 1;
    if (Math.abs(nextScale - prevScale) < 1e-6) return false;
    win.uiScale = nextScale;
    win.container.scale.set(nextScale);
    return true;
  }

  function getWindowDisplaySize(win) {
    const scale = Number.isFinite(win?.uiScale) ? win.uiScale : 1;
    return {
      width: Math.max(1, Math.floor((win?.panelWidth ?? 0) * scale)),
      height: Math.max(1, Math.floor((win?.panelHeight ?? 0) * scale)),
    };
  }

  function getWindowStackZIndex(win) {
    if (!win) return INVENTORY_WINDOW_Z_BASE;
    if (win.forceStackFront) return INVENTORY_WINDOW_Z_FOCUSED;
    if (win.hovered && win.pinned) return INVENTORY_WINDOW_Z_HOVERED_PINNED;
    if (win.hovered) return INVENTORY_WINDOW_Z_HOVERED;
    return INVENTORY_WINDOW_Z_PINNED;
  }

  function getWindowParentLayer(win) {
    if (win?.hovered || win?.forceStackFront) {
      return hoverLayer || layer;
    }
    return layer;
  }

  function syncWindowParentLayer(win) {
    if (!win?.container) return;
    const targetLayer = getWindowParentLayer(win);
    if (!targetLayer || win.container.parent === targetLayer) return;
    targetLayer.addChild(win.container);
  }

  function syncWindowStackOrder(win) {
    if (!win?.container) return;
    syncWindowParentLayer(win);
    win.container.zIndex = getWindowStackZIndex(win);
  }

  function getLeaderForOwner(ownerId) {
    const state = getStateSafe();
    const pawns = state?.pawns;
    if (!Array.isArray(pawns)) return null;
    const pawn = pawns.find((candidatePawn) => candidatePawn?.id === ownerId);
    return pawn && pawn.role === "leader" ? pawn : null;
  }

  function getPawnForOwner(ownerId) {
    const state = getStateSafe();
    const pawns = state?.pawns;
    if (!Array.isArray(pawns)) return null;
    return pawns.find((candidatePawn) => candidatePawn?.id === ownerId) || null;
  }

  function getLeaderSectionCapabilities(state, leader) {
    if (!leader || !Number.isFinite(leader.id)) {
      return {
        equipment: false,
        systems: false,
        prestige: false,
        workers: false,
        skills: false,
        build: false,
      };
    }
    return getLeaderInventorySectionCapabilities(state, Math.floor(leader.id));
  }

  function getInventoryPawnBadgeLabel(pawn) {
    if (!pawn || typeof pawn !== "object") return "";
    if (pawn.role === "follower") {
      return Number.isFinite(pawn.id) ? `F${Math.floor(pawn.id)}` : "F";
    }
    return pawn.name || (Number.isFinite(pawn.id) ? `Pawn ${Math.floor(pawn.id)}` : "Pawn");
  }

  function drawInventoryPawnBadgeShape(gfx, { isLeader, radius }) {
    if (isLeader) {
      gfx.drawPolygon([0, -radius, radius, 0, 0, radius, -radius, 0]);
      return;
    }
    gfx.drawCircle(0, 0, radius);
  }

  function createInventoryPawnBadge(ownerPawn, panelWidth) {
    if (!ownerPawn) return null;

    const root = new PIXI.Container();
    root.eventMode = "none";
    root.x = Math.floor(panelWidth / 2);
    // Slightly overlap the header bar while still protruding above it.
    root.y = -8;

    const iconShadow = new PIXI.Graphics();
    iconShadow.alpha = 0.35;
    iconShadow.y = 2;
    root.addChild(iconShadow);

    const iconFill = new PIXI.Graphics();
    root.addChild(iconFill);

    const iconOutline = new PIXI.Graphics();
    root.addChild(iconOutline);

    const label = new PIXI.Text(getInventoryPawnBadgeLabel(ownerPawn), {
      fill: 0xf0f6ff,
      fontSize: 12,
      fontWeight: "bold",
      stroke: 0x101018,
      strokeThickness: 0,
    });
    label.anchor.set(0.5, 0.5);
    label.y = 0;
    root.addChild(label);

    const update = (nextPawn) => {
      if (!nextPawn) {
        root.visible = false;
        return;
      }
      root.visible = true;
      label.text = getInventoryPawnBadgeLabel(nextPawn);
      const isLeader = nextPawn?.role === "leader";
      const radius = isLeader ? 24 : 17;
      const fillColor =
        typeof nextPawn?.color === "number" ? nextPawn.color : 0xaa66ff;

      iconShadow.clear();
      iconShadow.beginFill(0x000000, 1);
      drawInventoryPawnBadgeShape(iconShadow, {
        isLeader,
        radius: radius + 2,
      });
      iconShadow.endFill();

      iconFill.clear();
      iconFill.beginFill(fillColor, 1);
      drawInventoryPawnBadgeShape(iconFill, {
        isLeader,
        radius,
      });
      iconFill.endFill();

      iconOutline.clear();
      iconOutline.lineStyle(2, 0x111111, 1);
      drawInventoryPawnBadgeShape(iconOutline, {
        isLeader,
        radius: radius + 1,
      });
    };

    update(ownerPawn);

    return {
      root,
      label,
      iconShadow,
      iconFill,
      iconOutline,
      update,
    };
  }

  function getFollowersForLeader(state, leaderId) {
    if (!state || leaderId == null) return [];
    const pawns = Array.isArray(state.pawns) ? state.pawns : [];
    return pawns.filter(
      (pawn) => pawn && pawn.role === "follower" && pawn.leaderId === leaderId
    );
  }

  function computeLeaderPanelData(leader) {
    const state = getStateSafe();
    const followers = getFollowersForLeader(state, leader?.id);
    const followerCount = followers.length;
    const reserved = followerCount * PRESTIGE_COST_PER_FOLLOWER;
    const base = Math.max(0, Math.floor(leader?.prestigeCapBase ?? 0));
    const debt = Math.max(0, Math.floor(leader?.prestigeCapDebt ?? 0));
    const effective =
      Number.isFinite(leader?.prestigeCapEffective)
        ? Math.max(0, Math.floor(leader.prestigeCapEffective))
        : Math.max(0, base - Math.min(base, debt));
    const debtByFollower =
      leader?.prestigeDebtByFollowerId && typeof leader.prestigeDebtByFollowerId === "object"
        ? leader.prestigeDebtByFollowerId
        : {};
    let hungryDebt = 0;
    let hungryCount = 0;
    for (const follower of followers) {
      const hunger = follower?.systemState?.hunger;
      if (!hunger) continue;
      const cur = Math.floor(hunger.cur ?? 0);
      const below = cur < HUNGER_THRESHOLD;
      const exposure =
        Math.floor(hunger.belowThresholdSec ?? 0) >=
        Math.max(1, Math.floor(SECONDS_BELOW_HUNGER_THRESHOLD));
      if (!below || !exposure) continue;
      hungryCount += 1;
      const key = String(follower?.id ?? "");
      hungryDebt += Math.max(0, Math.floor(debtByFollower[key] ?? 0));
    }
    return {
      followerCount,
      reserved,
      base,
      effective,
      debt,
      hungryCount,
      hungryDebt,
      workerCount: getLeaderWorkerCount(leader),
      totalWorkers: getTotalAttachedWorkers(state),
      population: Math.max(0, Math.floor(state?.resources?.population ?? 0)),
      workerAvailability: getWorkerAdjustmentAvailability(state, leader?.id),
    };
  }

  function getLeaderEquipmentState(leader) {
    const src =
      leader?.equipment && typeof leader.equipment === "object"
        ? leader.equipment
        : {};
    const out = {};
    for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
      out[slotId] = src[slotId] ?? null;
    }
    return out;
  }

  function getLeaderEquippedItem(ownerId, slotId) {
    const leader = getLeaderForOwner(ownerId);
    if (!leader || !slotId) return null;
    const equipment = getLeaderEquipmentState(leader);
    return equipment?.[slotId] ?? null;
  }

  function itemProvidesBasketPool(item) {
    if (!item || typeof item !== "object") return false;
    const kind =
      typeof item.kind === "string" && item.kind.length > 0 ? item.kind : null;
    if (!kind) return false;
    const def = itemDefs?.[kind];
    if (!def || typeof def !== "object") return false;
    const specs = Array.isArray(def.poolProviders)
      ? def.poolProviders
      : def.poolProviders && typeof def.poolProviders === "object"
        ? [def.poolProviders]
        : [];
    return specs.some((spec) => {
      const systemId =
        typeof spec?.systemId === "string" ? spec.systemId : spec?.system;
      const poolKey = typeof spec?.poolKey === "string" ? spec.poolKey : null;
      return systemId === "storage" && poolKey === "byKindTier";
    });
  }

  function getEquipmentSlotLayout(panelWidth) {
    const getSlotSize = (slotId) => {
      const dims = EQUIP_SLOT_VISUAL_CELLS[slotId] || { w: 1, h: 1 };
      return {
        width: Math.max(12, dims.w * EQUIP_SLOT_VISUAL_CELL_SIZE),
        height: Math.max(12, dims.h * EQUIP_SLOT_VISUAL_CELL_SIZE),
      };
    };

    const innerWidth = panelWidth - INNER_PADDING * 2;
    const sideInset = EQUIP_PANEL_PADDING + 2;
    const head = getSlotSize("head");
    const chest = getSlotSize("chest");
    const mainHand = getSlotSize("mainHand");
    const offHand = getSlotSize("offHand");
    const ring1 = getSlotSize("ring1");
    const ring2 = getSlotSize("ring2");
    const amulet = getSlotSize("amulet");

    const centerX = Math.floor((innerWidth - chest.width) / 2);
    const leftX = sideInset;
    const rightX = innerWidth - sideInset - offHand.width;
    const headY = 16;
    const chestY = headY + head.height + 10;
    const ringY = chestY + chest.height - 2;
    const ringLeftX = centerX - ring1.width - 8;
    const ringRightX = centerX + chest.width + 8;

    return {
      head: {
        x: Math.floor((innerWidth - head.width) / 2),
        y: headY,
        ...head,
      },
      chest: { x: centerX, y: chestY, ...chest },
      mainHand: { x: leftX, y: chestY, ...mainHand },
      offHand: { x: rightX, y: chestY, ...offHand },
      ring1: { x: ringLeftX, y: ringY, ...ring1 },
      ring2: { x: ringRightX, y: ringY, ...ring2 },
      amulet: {
        x: ringRightX,
        y: headY + head.height + 6,
        ...amulet,
      },
    };
  }

  function normalizeBuildPlacementMode(def) {
    const raw = def?.build?.placementMode;
    return raw === "upgrade" ? "upgrade" : "new";
  }

  function normalizeBuildUpgradeSources(def) {
    const raw = Array.isArray(def?.build?.upgradeFromDefIds)
      ? def.build.upgradeFromDefIds
      : [];
    return raw.filter((id) => typeof id === "string" && id.length > 0);
  }

  function buildPlanSpecFromDefId(defId) {
    const def = hubStructureDefs?.[defId];
    if (!def) return null;
    return {
      defId,
      placementMode: normalizeBuildPlacementMode(def),
      upgradeFromDefIds: normalizeBuildUpgradeSources(def),
    };
  }

  const buildingManagerView = createBuildingManagerView({
    PIXI,
    layer: modalLayer || layer,
    stage,
    getState: getStateSafe,
    getScreenSize,
    layout: inventoryLayout?.buildingManager,
    onSelectBuild: (spec) => {
      const ownerId = spec?.ownerId;
      if (ownerId == null) return;
      setActiveBuild(ownerId, spec);
      const win = windows.get(ownerId);
      if (win) updateLeaderPanel(win);
    },
    onClose: ({ ownerId } = {}) => {
      if (ownerId == null) return;
      const win = windows.get(ownerId);
      if (!win) return;
      refreshWindowVisibility(win);
      syncWindowStackOrder(win);
    },
  });

  function canBuildAtAnyHubCol(state, defId) {
    const cols = Array.isArray(state?.hub?.slots) ? state.hub.slots.length : 0;
    for (let col = 0; col < cols; col += 1) {
      const check = validateHubConstructionPlacement(state, defId, col);
      if (check?.ok) return true;
    }
    return false;
  }

  function isBuildPlanStillValid(state, buildSpec) {
    if (!state || !buildSpec?.defId) return false;
    return canBuildAtAnyHubCol(state, buildSpec.defId);
  }

  function computeBuildContentHeight() {
    return (
      BUILD_PANEL_PADDING * 2 +
      BUILD_PANEL_BUTTON_HEIGHT +
      BUILD_PANEL_GAP +
      BUILD_PANEL_HINT_HEIGHT
    );
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function getLeaderSystemIds(leader) {
    const ids = new Set();
    for (const systemId of Object.keys(pawnSystemDefs || {})) {
      if (systemId === "leadership") continue;
      ids.add(systemId);
    }
    if (leader?.role === "leader") {
      ids.add(LEADER_FAITH_SYSTEM_ID);
    }
    const stateIds = leader?.systemState && typeof leader.systemState === "object"
      ? Object.keys(leader.systemState)
      : [];
    for (const systemId of stateIds) {
      if (systemId === "leadership") continue;
      ids.add(systemId);
    }
    const tierIds = leader?.systemTiers && typeof leader.systemTiers === "object"
      ? Object.keys(leader.systemTiers)
      : [];
    for (const systemId of tierIds) {
      if (systemId === "leadership") continue;
      ids.add(systemId);
    }
    return Array.from(ids.values()).sort((a, b) => a.localeCompare(b));
  }

  function getLeaderSystemsSignature(leader) {
    return getLeaderSystemIds(leader).join("|");
  }

  function getLeaderSystemUi(systemId) {
    if (systemId === LEADER_FAITH_SYSTEM_ID) {
      return {
        label: "Faith",
        icon: LEADER_SYSTEM_UI_OVERRIDES[LEADER_FAITH_SYSTEM_ID].icon,
        color: LEADER_SYSTEM_UI_OVERRIDES[LEADER_FAITH_SYSTEM_ID].color,
      };
    }
    const override = LEADER_SYSTEM_UI_OVERRIDES[systemId] || null;
    const def = pawnSystemDefs?.[systemId];
    const label = def?.ui?.name || systemId || "System";
    const icon =
      typeof override?.icon === "string" && override.icon.length > 0
        ? override.icon
        : label
        ? label.slice(0, 1).toUpperCase()
        : "?";
    const color = Number.isFinite(override?.color)
      ? override.color
      : LEADER_SYSTEMS_FALLBACK_COLOR;
    return {
      label,
      icon,
      color,
    };
  }

  function getLeaderSystemTier(leader, systemId) {
    if (systemId === LEADER_FAITH_SYSTEM_ID) {
      const faithTier = leader?.leaderFaith?.tier;
      if (
        typeof faithTier === "string" &&
        LEADER_SYSTEM_TIER_ORDER.includes(faithTier)
      ) {
        return faithTier;
      }
      return "gold";
    }
    const fromLeader = leader?.systemTiers?.[systemId];
    if (
      typeof fromLeader === "string" &&
      LEADER_SYSTEM_TIER_ORDER.includes(fromLeader)
    ) {
      return fromLeader;
    }
    const fromDef = pawnSystemDefs?.[systemId]?.defaultTier;
    if (
      typeof fromDef === "string" &&
      LEADER_SYSTEM_TIER_ORDER.includes(fromDef)
    ) {
      return fromDef;
    }
    return "bronze";
  }

  function getLeaderSystemTierRatio(tier) {
    const maxIndex = Math.max(1, LEADER_SYSTEM_TIER_ORDER.length - 1);
    const tierIndex = LEADER_SYSTEM_TIER_ORDER.indexOf(tier);
    const safeIndex = tierIndex >= 0 ? tierIndex : 0;
    return clamp01(safeIndex / maxIndex);
  }

  function computeLeaderSystemsContentHeight(systemCount) {
    const rows = Math.max(0, Math.floor(systemCount ?? 0));
    if (rows <= 0) return 0;
    return (
      rows * LEADER_SYSTEMS_ROW_HEIGHT +
      Math.max(0, rows - 1) * LEADER_SYSTEMS_ROW_GAP
    );
  }

  function computeLeaderSystemsContentHeightForLeader(leader) {
    return computeLeaderSystemsContentHeight(getLeaderSystemIds(leader).length);
  }

  function ensureSectionState(win) {
    if (!win) {
      return {
        equipment: false,
        systems: false,
        prestige: false,
        workers: false,
        skills: false,
        build: false,
      };
    }
    if (!win.sectionState || typeof win.sectionState !== "object") {
      win.sectionState = {
        equipment: false,
        systems: false,
        prestige: false,
        workers: false,
        skills: false,
        build: false,
      };
    }
    if (typeof win.sectionState.equipment !== "boolean") win.sectionState.equipment = false;
    if (typeof win.sectionState.systems !== "boolean") win.sectionState.systems = false;
    if (typeof win.sectionState.prestige !== "boolean") win.sectionState.prestige = false;
    if (typeof win.sectionState.workers !== "boolean") win.sectionState.workers = false;
    if (typeof win.sectionState.skills !== "boolean") win.sectionState.skills = false;
    if (typeof win.sectionState.build !== "boolean") win.sectionState.build = false;
    return win.sectionState;
  }

  function createSectionLozenge(labelText, onToggle) {
    const container = new PIXI.Container();
    container.eventMode = "static";
    container.cursor = "pointer";

    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const arrow = new PIXI.Text("v", {
      fill: SECTION_HEADER_ARROW,
      fontSize: 11,
      fontWeight: "bold",
    });
    arrow.x = 8;
    arrow.y = 4;
    container.addChild(arrow);

    const label = new PIXI.Text(labelText, {
      fill: SECTION_HEADER_TEXT,
      fontSize: 11,
      fontWeight: "bold",
    });
    label.x = 20;
    label.y = 4;
    container.addChild(label);

    const setExpanded = (expanded, active = false, overrideLabel = null) => {
      if (typeof overrideLabel === "string" && overrideLabel.length > 0) {
        label.text = overrideLabel;
      }
      const width = Math.max(72, Math.ceil(label.width) + 28);
      bg.clear();
      bg.beginFill(active ? SECTION_HEADER_BG_ACTIVE : SECTION_HEADER_BG, 0.98);
      bg.drawRoundedRect(0, 0, width, SECTION_HEADER_HEIGHT, SECTION_HEADER_RADIUS);
      bg.endFill();
      arrow.text = expanded ? "v" : ">";
      return width;
    };

    setExpanded(true, false, labelText);

    container.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      onToggle?.();
    });

    return { container, bg, arrow, label, setExpanded };
  }

  function openSkillTreeForOwner(ownerId) {
    if (uiBlocked) return false;
    if (typeof openSkillTree !== "function") return false;
    const pawn = getPawnForOwner(ownerId);
    if (!pawn || !Number.isFinite(pawn.id)) return false;
    const pawnId = Math.floor(pawn.id);
    openSkillTree({
      leaderPawnId: pawnId,
      pawnId,
      ownerId,
    });
    return true;
  }

  function createOpenSkillTreeButton(ownerId, contentWidth) {
    const root = new PIXI.Container();
    root.eventMode = "static";
    root.cursor = "pointer";

    const bg = new PIXI.Graphics();
    root.addChild(bg);

    const text = new PIXI.Text("Open Skill Tree", {
      fill: 0xeaf3ff,
      fontSize: 11,
      fontWeight: "bold",
    });
    text.x = 10;
    text.y = 4;
    root.addChild(text);

    const buttonHeight = 18;
    const buttonWidth = Math.max(96, Math.ceil(text.width) + 20);
    let enabled = false;

    const setEnabled = (nextEnabled) => {
      enabled = !!nextEnabled;
      bg.clear();
      bg.beginFill(enabled ? 0x39456b : 0x2a2d38, 0.98);
      bg.drawRoundedRect(0, 0, buttonWidth, buttonHeight, 5);
      bg.endFill();
      root.alpha = enabled ? 1 : 0.55;
      root.eventMode = enabled ? "static" : "none";
      root.cursor = enabled ? "pointer" : "default";
    };

    root.x = Math.max(0, Math.floor(contentWidth - buttonWidth));
    root.y = 1;
    setEnabled(typeof openSkillTree === "function");

    root.on("pointerdown", (ev) => ev?.stopPropagation?.());
    root.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      if (!enabled) return;
      openSkillTreeForOwner(ownerId);
    });

    return { root, bg, text, setEnabled };
  }

  function drawLeaderSystemsBarFill(row, ratio, color) {
    const width = row.barWidth * clamp01(ratio);
    row.barFill.clear();
    if (width <= 0) return;
    row.barFill.beginFill(color, 0.95);
    row.barFill.drawRoundedRect(
      row.barX,
      row.barY,
      width,
      LEADER_SYSTEMS_BAR_HEIGHT,
      LEADER_SYSTEMS_BAR_RADIUS
    );
    row.barFill.endFill();
  }

  function clampSystemThreshold(value, maxValue) {
    const max = Number.isFinite(maxValue) ? Math.max(1, Math.floor(maxValue)) : 100;
    const raw = Number.isFinite(value) ? Math.floor(value) : 0;
    return Math.max(0, Math.min(max, raw));
  }

  function drawLeaderHungerThresholdMarkers(row, leader) {
    const marker = row?.thresholdMarker;
    if (!marker) return;
    marker.clear();
    if (row.systemId !== "hunger") {
      if (row.seekThresholdLabel) row.seekThresholdLabel.visible = false;
      if (row.faithThresholdLabel) row.faithThresholdLabel.visible = false;
      return;
    }

    const hungerState = leader?.systemState?.hunger;
    const hungerMax = Number.isFinite(hungerState?.max)
      ? Math.max(1, Math.floor(hungerState.max))
      : 100;
    const seekThreshold = clampSystemThreshold(PAWN_AI_HUNGER_START_EAT, hungerMax);
    const faithThreshold = clampSystemThreshold(
      LEADER_FAITH_HUNGER_DECAY_THRESHOLD,
      hungerMax
    );
    const markerSpecs = [
      {
        value: seekThreshold,
        color: LEADER_SYSTEMS_THRESHOLD_SEEK_COLOR,
        label: "S",
        text: row.seekThresholdLabel,
      },
      {
        value: faithThreshold,
        color: LEADER_SYSTEMS_THRESHOLD_FAITH_COLOR,
        label: "F",
        text: row.faithThresholdLabel,
      },
    ];

    let previousX = null;
    for (const spec of markerSpecs) {
      const ratio = clamp01(spec.value / hungerMax);
      const rawX = row.barX + row.barWidth * ratio;
      let markerX = Math.max(row.barX + 1, Math.min(row.barX + row.barWidth - 1, rawX));
      if (previousX != null && Math.abs(markerX - previousX) < 6) {
        markerX = Math.min(row.barX + row.barWidth - 1, markerX + 6);
      }
      previousX = markerX;

      marker.lineStyle(1.5, spec.color, 0.95);
      marker.moveTo(markerX, row.barY - 1);
      marker.lineTo(markerX, row.barY + LEADER_SYSTEMS_BAR_HEIGHT + 1);

      if (spec.text) {
        spec.text.text = spec.label;
        spec.text.style.fill = spec.color;
        spec.text.x = Math.round(markerX - spec.text.width / 2);
        spec.text.y = row.barY - LEADER_SYSTEMS_THRESHOLD_LABEL_Y_OFFSET;
        spec.text.visible = true;
      }
    }
  }

  function buildLeaderSystemTooltipLines(leader, systemId) {
    const lines = [];
    const ui = getLeaderSystemUi(systemId);
    if (systemId === LEADER_FAITH_SYSTEM_ID) {
      lines.push("Leader faith progression tier.");
      const faith = leader?.leaderFaith;
      if (faith && typeof faith === "object") {
        const eatStreak = Number.isFinite(faith.eatStreak)
          ? Math.max(0, Math.floor(faith.eatStreak))
          : 0;
        const decayElapsedSec = Number.isFinite(faith.decayElapsedSec)
          ? Math.max(0, Math.floor(faith.decayElapsedSec))
          : 0;
        lines.push(`Eat streak: ${eatStreak}`);
        lines.push(`Decay elapsed: ${decayElapsedSec}s`);
      }
      lines.push(`Tier: ${getLeaderSystemTier(leader, systemId)}`);
      return lines;
    }

    const def = pawnSystemDefs?.[systemId];
    if (def?.ui?.description) {
      lines.push(def.ui.description);
    }
    const sysState = leader?.systemState?.[systemId];
    if (sysState && typeof sysState === "object") {
      if (Number.isFinite(sysState.cur) || Number.isFinite(sysState.max)) {
        const cur = Number.isFinite(sysState.cur) ? Math.floor(sysState.cur) : 0;
        const max = Number.isFinite(sysState.max) ? Math.floor(sysState.max) : 0;
        lines.push(`Level: ${cur}/${max}`);
      } else {
        const booleanKeys = Object.keys(sysState)
          .filter((key) => typeof sysState[key] === "boolean")
          .sort((a, b) => a.localeCompare(b));
        if (booleanKeys.length > 0) {
          const key = booleanKeys[0];
          lines.push(`${key}: ${sysState[key] ? "On" : "Off"}`);
        }
      }

      if (systemId === "hunger" && Number.isFinite(sysState.belowThresholdSec)) {
        lines.push(`Below threshold: ${Math.max(0, Math.floor(sysState.belowThresholdSec))}s`);
      }
      if (systemId === "hunger") {
        const hungerMax = Number.isFinite(sysState.max)
          ? Math.max(1, Math.floor(sysState.max))
          : 100;
        const seekThreshold = clampSystemThreshold(PAWN_AI_HUNGER_START_EAT, hungerMax);
        const faithThreshold = clampSystemThreshold(
          LEADER_FAITH_HUNGER_DECAY_THRESHOLD,
          hungerMax
        );
        lines.push(`Seek food at: ${seekThreshold}/${hungerMax}`);
        lines.push(`Faith decay at: ${faithThreshold}/${hungerMax}`);
      }
    }
    lines.push(`Tier: ${getLeaderSystemTier(leader, systemId)}`);
    if (lines.length <= 1 && ui.label) {
      lines.unshift(ui.label);
    }
    return lines;
  }

  function createLeaderSystemsRow(contentWidth, ownerId, systemId, uiScale = 1) {
    const ui = getLeaderSystemUi(systemId);
    const container = new PIXI.Container();
    container.eventMode = "passive";

    const icon = new PIXI.Container();
    icon.eventMode = "static";
    icon.cursor = "help";
    icon.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
    });
    icon.on("pointerover", () => {
      if (!tooltipView || !canShowHoverUI()) return;
      const leader = getLeaderForOwner(ownerId);
      if (!leader) return;
        tooltipView.show(
          {
            title: ui.label,
            lines: buildLeaderSystemTooltipLines(leader, systemId),
            scale: getInventoryTooltipScale(tooltipView, uiScale, icon),
          },
          {
            coordinateSpace: "parent",
            getAnchorRect: () =>
              tooltipView.getAnchorRectForDisplayObject?.(icon, "parent") ?? null,
          }
        );
    });
    icon.on("pointerout", () => {
      tooltipView?.hide?.();
    });
    container.addChild(icon);

    const iconBg = new PIXI.Graphics()
      .lineStyle(1, LEADER_SYSTEMS_ICON_BORDER, 0.85)
      .beginFill(ui.color, 1)
      .drawCircle(
        LEADER_SYSTEMS_ICON_SIZE / 2,
        LEADER_SYSTEMS_ROW_HEIGHT / 2,
        LEADER_SYSTEMS_ICON_SIZE / 2
      )
      .endFill();
    icon.addChild(iconBg);

    const iconText = new PIXI.Text(ui.icon, {
      fill: 0xffffff,
      fontSize: 13,
      fontWeight: "bold",
    });
    applyTextResolution(iconText, Math.max(1, uiScale * 1.5));
    iconText.anchor.set(0.5, 0.5);
    iconText.x = LEADER_SYSTEMS_ICON_SIZE / 2;
    iconText.y = LEADER_SYSTEMS_ROW_HEIGHT / 2;
    icon.addChild(iconText);

    const barX = LEADER_SYSTEMS_ICON_SIZE + 8;
    const barY = Math.floor((LEADER_SYSTEMS_ROW_HEIGHT - LEADER_SYSTEMS_BAR_HEIGHT) / 2);
    const barWidth = Math.max(12, contentWidth - barX - 2);

    const barBg = new PIXI.Graphics()
      .lineStyle(1, LEADER_SYSTEMS_BAR_BORDER, 0.9)
      .beginFill(LEADER_SYSTEMS_BAR_BG, 0.95)
      .drawRoundedRect(
        barX,
        barY,
        barWidth,
        LEADER_SYSTEMS_BAR_HEIGHT,
        LEADER_SYSTEMS_BAR_RADIUS
      )
      .endFill();
    const thresholdMarker = new PIXI.Graphics();
    const barFill = new PIXI.Graphics();
    container.addChild(barBg, barFill, thresholdMarker);

    const seekThresholdLabel = new PIXI.Text("", {
      fill: LEADER_SYSTEMS_THRESHOLD_SEEK_COLOR,
      fontSize: 8,
      fontWeight: "bold",
    });
    applyTextResolution(seekThresholdLabel, uiScale);
    seekThresholdLabel.visible = false;
    container.addChild(seekThresholdLabel);

    const faithThresholdLabel = new PIXI.Text("", {
      fill: LEADER_SYSTEMS_THRESHOLD_FAITH_COLOR,
      fontSize: 8,
      fontWeight: "bold",
    });
    applyTextResolution(faithThresholdLabel, uiScale);
    faithThresholdLabel.visible = false;
    container.addChild(faithThresholdLabel);

    const labelText = new PIXI.Text("", {
      fill: LEADER_SYSTEMS_BAR_TEXT,
      fontSize: 11,
    });
    applyTextResolution(labelText, uiScale);
    labelText.anchor.set(0, 0.5);
    labelText.x = barX + 4;
    labelText.y = barY + LEADER_SYSTEMS_BAR_HEIGHT / 2;
    container.addChild(labelText);

    return {
      systemId,
      container,
      icon,
      labelText,
      barFill,
      thresholdMarker,
      seekThresholdLabel,
      faithThresholdLabel,
      barX,
      barY,
      barWidth,
      uiColor: ui.color,
      height: LEADER_SYSTEMS_ROW_HEIGHT,
    };
  }

  function getLeaderSystemRowVisual(leader, systemId) {
    if (systemId === LEADER_FAITH_SYSTEM_ID) {
      const tier = getLeaderSystemTier(leader, systemId);
      return {
        label: tier,
        ratio: getLeaderSystemTierRatio(tier),
      };
    }
    const sysState = leader?.systemState?.[systemId];
    if (sysState && typeof sysState === "object") {
      const curNum = Number.isFinite(sysState.cur) ? Math.floor(sysState.cur) : null;
      const maxNum = Number.isFinite(sysState.max) ? Math.floor(sysState.max) : null;
      if (curNum != null || maxNum != null) {
        const cur = curNum != null ? curNum : 0;
        const max = maxNum != null ? maxNum : 0;
        const ratio = max > 0 ? cur / max : 0;
        return { label: `${cur}/${max}`, ratio };
      }

      const booleanKeys = Object.keys(sysState)
        .filter((key) => typeof sysState[key] === "boolean")
        .sort((a, b) => a.localeCompare(b));
      if (booleanKeys.length > 0) {
        const key = booleanKeys[0];
        const enabled = sysState[key] === true;
        return {
          label: `${key}: ${enabled ? "On" : "Off"}`,
          ratio: enabled ? 1 : 0,
        };
      }
    }

    const tier = getLeaderSystemTier(leader, systemId);
    return {
      label: tier,
      ratio: getLeaderSystemTierRatio(tier),
    };
  }

  function updateWorkerMirrorHungerRow(row, leader) {
    if (!row || !leader) return;
    const visual = getLeaderSystemRowVisual(leader, "hunger");
    row.labelText.text = visual.label;
    drawLeaderSystemsBarFill(row, visual.ratio, row.uiColor);
    drawLeaderHungerThresholdMarkers(row, leader);
  }

  function rebuildLeaderSystemsRows(win, leader) {
    const panel = win?.leaderPanel;
    if (!panel?.systemsRowsContainer) return;
    const signature = getLeaderSystemsSignature(leader);
    if (signature === panel.systemsSignature) return;

    panel.systemsSignature = signature;
    panel.systemRows = [];
    panel.systemsRowsContainer.removeChildren();

    const contentWidth = Math.max(
      40,
      win.panelWidth - INNER_PADDING * 2 - LEADER_PANEL_PADDING * 2
    );
    const systemIds = getLeaderSystemIds(leader);
    let y = 0;
    for (const systemId of systemIds) {
      const row = createLeaderSystemsRow(
        contentWidth,
        win.ownerId,
        systemId,
        win.uiScale
      );
      row.container.y = y;
      panel.systemsRowsContainer.addChild(row.container);
      panel.systemRows.push(row);
      y += LEADER_SYSTEMS_ROW_HEIGHT + LEADER_SYSTEMS_ROW_GAP;
    }
    panel.systemsContentHeight = computeLeaderSystemsContentHeight(panel.systemRows.length);
  }

  function updateLeaderSystemsRows(win, leader) {
    const panel = win?.leaderPanel;
    const rows = panel?.systemRows;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const visual = getLeaderSystemRowVisual(leader, row.systemId);
      row.labelText.text = visual.label;
      drawLeaderSystemsBarFill(row, visual.ratio, row.uiColor);
      drawLeaderHungerThresholdMarkers(row, leader);
    }
  }

  function redrawWindowFocusOutline(win) {
    if (!win?.focusOutline) return;
    const color = getDragAffordanceStroke(win.dragAffordanceLevel);
    win.focusOutline.clear();
    win.focusOutline.lineStyle(2, color, 1);
    win.focusOutline.drawRoundedRect(1, 1, win.panelWidth - 2, win.panelHeight - 2, 10);
  }

  function syncWindowFocusOutlineAppearance(win) {
    if (!win?.focusOutline) return;
    redrawWindowFocusOutline(win);
    win.focusOutline.visible =
      win.isExternallyFocused === true || win.dragAffordanceLevel != null;
  }

  function clearDragHoverRevealOwner() {
    if (dragHoverRevealOwnerId == null) return;
    hideOnHoverOut(dragHoverRevealOwnerId);
    dragHoverRevealOwnerId = null;
  }

  function applyExternalItemDragAffordances(nextAffordances) {
    externalItemDragAffordances.clear();
    if (nextAffordances instanceof Map) {
      for (const [ownerId, level] of nextAffordances.entries()) {
        if (ownerId == null || level == null) continue;
        externalItemDragAffordances.set(normalizeInventoryOwnerKey(ownerId), level);
      }
    }

    for (const win of windows.values()) {
      win.dragAffordanceLevel =
        externalItemDragAffordances.get(normalizeInventoryOwnerKey(win.ownerId)) ?? null;
      syncWindowFocusOutlineAppearance(win);
      syncWindowStackOrder(win);
    }

    setWorldInventoryDragAffordances?.(new Map(externalItemDragAffordances));
  }

  function clearExternalItemDragAffordances() {
    clearDragHoverRevealOwner();
    applyExternalItemDragAffordances(new Map());
  }

  function canOwnerFitDraggedItem(ownerId, item) {
    if (ownerId == null || !item) return false;
    const inv = getInventoryForOwner(ownerId);
    if (!inv) return false;
    const preview =
      typeof getInventoryPreview === "function"
        ? getInventoryPreview(ownerId)
        : null;
    const placement = findItemPlacement(inv, item, preview, null);
    if (placement) return true;
    return canAutostackItemPreview(inv, item, preview, null);
  }

  function syncExternalItemDragAffordances(globalPos = null) {
    if (!dragItem.active || !dragItem.item) {
      clearExternalItemDragAffordances();
      return;
    }

    const sourceOwner =
      dragItem.sourceOwnerOverride != null
        ? dragItem.sourceOwnerOverride
        : dragItem.ownerId;
    const hoveredWindow = globalPos ? findWindowAt(globalPos) : null;
    const insideSourceWindow =
      hoveredWindow && String(hoveredWindow.ownerId) === String(sourceOwner);
    if (insideSourceWindow) {
      clearExternalItemDragAffordances();
      return;
    }

    const dropTargetSpec = resolveExternalDropTargetSpec(globalPos);
    const hoveredOwnerId = isAnyDropboxOwnerId(dropTargetSpec?.ownerId)
      ? dropTargetSpec.ownerId
      : hoveredWindow
        ? hoveredWindow.ownerId ?? null
        : dropTargetSpec?.ownerId ?? null;
    const hoveredOwner =
      hoveredOwnerId != null && !isAnyDropboxOwnerId(hoveredOwnerId)
        ? hoveredOwnerId
        : null;

    const ownerInventories = getState?.()?.ownerInventories || {};
    const nextAffordances = new Map();
    for (const ownerId of Object.keys(ownerInventories)) {
      if (String(ownerId) === String(sourceOwner)) continue;
      if (isAnyDropboxOwnerId(ownerId)) continue;
      const level = canOwnerFitDraggedItem(ownerId, dragItem.item)
        ? hoveredOwner != null && String(ownerId) === String(hoveredOwner)
          ? "hover"
          : "valid"
        : "full";
      nextAffordances.set(normalizeInventoryOwnerKey(ownerId), level);
    }

    if (hoveredOwner != null) {
      if (
        dragHoverRevealOwnerId != null &&
        String(dragHoverRevealOwnerId) !== String(hoveredOwner)
      ) {
        hideOnHoverOut(dragHoverRevealOwnerId);
        dragHoverRevealOwnerId = null;
      }
      if (dragHoverRevealOwnerId == null) {
        let hoveredOwnerWindow = null;
        for (const win of windows.values()) {
          if (String(win?.ownerId) !== String(hoveredOwner)) continue;
          hoveredOwnerWindow = win;
          break;
        }
        if (!hoveredOwnerWindow || hoveredOwnerWindow.pinned !== true) {
          const isClosed = hoveredOwnerWindow?.container?.visible !== true;
          if (!hoveredOwnerWindow || isClosed) {
            revealWindow(hoveredOwner, {
              pinned: false,
              anchor: dropTargetSpec?.anchor ?? getOwnerAnchor?.(hoveredOwner) ?? null,
            });
          }
          dragHoverRevealOwnerId = hoveredOwner;
        }
      }
    } else {
      clearDragHoverRevealOwner();
    }

    applyExternalItemDragAffordances(nextAffordances);
  }

  function resizeWindowFrame(win, height) {
    if (!win) return;
    const h = Math.max(HEADER_HEIGHT + INNER_PADDING * 2, Math.floor(height));
    win.panelHeight = h;
    if (win.solidRect) {
      win.solidRect.width = win.panelWidth;
      win.solidRect.height = h;
    }

    if (win.bg) {
      win.bg.clear();
      win.bg.beginFill(INVENTORY_WINDOW_BG, 0.95);
      win.bg.drawRoundedRect(0, 0, win.panelWidth, h, 8);
      win.bg.endFill();
    }

    if (win.focusOutline) {
      redrawWindowFocusOutline(win);
    }

    if (win.apOverlay) {
      win.apOverlay.clear();
      win.apOverlay
        .beginFill(AP_OVERLAY_FILL, 0.5)
        .lineStyle(2, AP_OVERLAY_STROKE, 1)
        .drawRoundedRect(1, 1, win.panelWidth - 2, h - 2, 10)
        .endFill();
      win.apOverlay.alpha = win.apOverlayAlpha || 0;
      win.apOverlay.visible = (win.apOverlayAlpha || 0) > 0.01;
    }
    win.solidHitArea?.refresh?.();
  }

  function layoutLeaderSections(win, leader, sectionCaps = null) {
    if (!win || !leader) return;
    const state = ensureSectionState(win);
    const panel = win.leaderPanel;
    const equip = win.equipmentPanel;
    if (!panel || !equip) return;
    const resolvedCaps =
      sectionCaps && typeof sectionCaps === "object"
        ? sectionCaps
        : getLeaderSectionCapabilities(getStateSafe(), leader);

    const sectionWidth = win.panelWidth - INNER_PADDING * 2;

    const equipVisible = resolvedCaps.equipment !== false;
    const systemsVisible = resolvedCaps.systems === true;
    const prestigeVisible = resolvedCaps.prestige === true;
    const workersVisible = resolvedCaps.workers === true;
    const skillsVisible = resolvedCaps.skills === true;
    const buildVisible = resolvedCaps.build === true;

    const equipExpanded = equipVisible && state.equipment !== false;
    const systemsExpanded = systemsVisible && state.systems !== false;
    const prestigeExpanded = prestigeVisible && state.prestige !== false;
    const workersExpanded = workersVisible && state.workers !== false;
    const skillsExpanded = skillsVisible && state.skills !== false;
    const buildExpanded = buildVisible && state.build !== false;

    const equipHeight = !equipVisible
      ? 0
      : equipExpanded
      ? EQUIP_PANEL_HEIGHT
      : SECTION_HEADER_HEIGHT;
    equip.container.y = HEADER_HEIGHT + INNER_PADDING;
    equip.container.visible = equipVisible;
    equip.header?.setExpanded?.(equipExpanded, false, "Equipment");
    if (equip.bg) {
      equip.bg.clear();
      equip.bg.beginFill(INVENTORY_SECTION_BG, 0.95);
      equip.bg.drawRoundedRect(0, 0, sectionWidth, equipHeight, 6);
      equip.bg.endFill();
    }
    if (equip.header?.container) {
      equip.header.container.x = EQUIP_PANEL_PADDING;
      equip.header.container.y = 4;
    }

    const bodyY =
      HEADER_HEIGHT + INNER_PADDING + (equipVisible ? equipHeight + INNER_PADDING : 0);
    win.body.y = bodyY;
    if (win.bin?.container) {
      win.bin.container.y = bodyY;
    }

    const buildContentHeight = computeBuildContentHeight();
    const systemsContentHeight = Number.isFinite(panel.systemsContentHeight)
      ? Math.max(0, Math.floor(panel.systemsContentHeight))
      : computeLeaderSystemsContentHeightForLeader(leader);
    panel.systemsContentHeight = systemsContentHeight;
    panel.buildPanelHeight = buildContentHeight;

    let nextSectionY = LEADER_PANEL_PADDING;
    let visibleSectionCount = 0;
    const layoutSection = ({
      visible,
      expanded,
      label,
      header,
      content,
      contentX,
      contentHeight,
    }) => {
      if (!header?.container) return;
      if (!visible) {
        header.setExpanded?.(false, false, label);
        header.container.visible = false;
        if (content) content.visible = false;
        return;
      }

      if (visibleSectionCount > 0) {
        nextSectionY += BUILD_PANEL_GAP;
      }
      visibleSectionCount += 1;

      header.container.visible = true;
      header.setExpanded?.(expanded, false, label);
      header.container.x = LEADER_PANEL_PADDING;
      header.container.y = nextSectionY;
      nextSectionY += SECTION_HEADER_HEIGHT;

      if (!content) return;
      content.visible = expanded;
      content.x = contentX;
      content.y = nextSectionY;
      if (expanded) {
        nextSectionY += contentHeight;
      }
    };

    layoutSection({
      visible: systemsVisible,
      expanded: systemsExpanded,
      label: "Systems",
      header: panel.systemsHeader,
      content: panel.systemsContent,
      contentX: LEADER_PANEL_PADDING,
      contentHeight: systemsContentHeight,
    });
    layoutSection({
      visible: prestigeVisible,
      expanded: prestigeExpanded,
      label: "Prestige",
      header: panel.prestigeHeader,
      content: panel.prestigeContent,
      contentX: LEADER_PANEL_PADDING,
      contentHeight: LEADER_PANEL_HEIGHT,
    });
    layoutSection({
      visible: workersVisible,
      expanded: workersExpanded,
      label: "Workers",
      header: panel.workersHeader,
      content: panel.workersContent,
      contentX: LEADER_PANEL_PADDING,
      contentHeight: WORKERS_PANEL_HEIGHT,
    });
    layoutSection({
      visible: skillsVisible,
      expanded: skillsExpanded,
      label: "Skills",
      header: panel.skillsHeader,
      content: panel.skillsContent,
      contentX: LEADER_PANEL_PADDING,
      contentHeight: SKILLS_PANEL_HEIGHT,
    });
    layoutSection({
      visible: buildVisible,
      expanded: buildExpanded,
      label: "Build",
      header: panel.buildHeader,
      content: panel.buildPanel,
      contentX: 0,
      contentHeight: buildContentHeight,
    });

    panel.container.y = bodyY + win.rows * win.cellSize + INNER_PADDING;
    if (visibleSectionCount <= 0) {
      panel.container.visible = false;
      if (panel.bg) {
        panel.bg.clear();
      }
      resizeWindowFrame(win, panel.container.y);
      return;
    }

    const leaderInnerHeight = nextSectionY + LEADER_PANEL_PADDING;
    panel.container.visible = true;
    if (panel.bg) {
      panel.bg.clear();
      panel.bg.beginFill(INVENTORY_SECTION_BG, 0.95);
      panel.bg.drawRoundedRect(0, 0, sectionWidth, leaderInnerHeight, 6);
      panel.bg.endFill();
    }

    const totalHeight = panel.container.y + leaderInnerHeight + INNER_PADDING;
    resizeWindowFrame(win, totalHeight);
  }

  function formatBuildRequirementLabel(req) {
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

  function getBuildGhostCardSize(def) {
    const span =
      Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
        ? Math.floor(def.defaultSpan)
        : 1;
    const safeSpan = Math.max(1, span);
    const width =
      HUB_STRUCTURE_WIDTH * safeSpan + HUB_COL_GAP * (safeSpan - 1);
    const height = HUB_STRUCTURE_HEIGHT;
    return { width, height, span: safeSpan };
  }

  // ---------------------------------------------------------------------------
  // Small visual helpers
  // ---------------------------------------------------------------------------

  function grayItemView(view) {
    if (!view) return;
    view.alpha = 0.6;
  }

  function restoreItemView(view) {
    if (!view) return;
    view.alpha = 1.0;
  }

  // Brief red flash for an invalid action
  function flashItemError(view, ownerId) {
    if (!view) return;

    const target = view.bg || view;
    const originalTint = target.tint ?? 0xffffff;
    const originalAlpha = view.alpha;

    target.tint = 0xff5555;
    view.alpha = 1.0;

    flashingOwners.add(ownerId);

    setTimeout(() => {
      target.tint = originalTint;
      view.alpha = originalAlpha;

      flashingOwners.delete(ownerId);
      if (ownerId != null) {
        rebuildWindow(ownerId);
      }
    }, 120);
  }

  function flashWindowError(ownerId) {
    if (ownerId == null) return;
    const win = ensureWindow(ownerId);
    if (!win) return;

    const overlay = win.warningOverlay;
    if (!overlay) return;

    if (win.warningTimeout) {
      clearTimeout(win.warningTimeout);
      win.warningTimeout = null;
    }

    overlay.clear();
    overlay.lineStyle(2, 0xff4f5e, 1);
    overlay.beginFill(0x8a1f2a, 0.2);
    overlay.drawRoundedRect(1, 1, win.panelWidth - 2, win.panelHeight - 2, 10);
    overlay.endFill();
    overlay.visible = true;

    flashingOwners.add(ownerId);

    win.warningTimeout = setTimeout(() => {
      overlay.visible = false;
      win.warningTimeout = null;
      flashingOwners.delete(ownerId);
      rebuildWindow(ownerId);
    }, 180);
  }

  function clearActiveBuildForOwner(ownerId) {
    if (!activeBuildSpec || activeBuildSpec.ownerId !== ownerId) return;
    activeBuildSpec = null;
    if (buildGhost) buildGhost.container.visible = false;
    pushBuildPlacementPreview();
  }

  function closeBuildingManagerForOwner(ownerId, reason = "ownerHidden") {
    if (!buildingManagerView?.isOpen?.()) return;
    if (buildingManagerView.getOpenOwnerId?.() !== ownerId) return;
    buildingManagerView.close(reason);
  }

  function isBuildingManagerHoldingOwnerVisible(ownerId) {
    if (ownerId == null) return false;
    if (!buildingManagerView?.isOpen?.()) return false;
    return String(buildingManagerView.getOpenOwnerId?.()) === String(ownerId);
  }

  function cancelItemDragForOwner(ownerId) {
    if (!dragItem.active) return;
    const matchesOwner =
      String(dragItem.ownerId) === String(ownerId) ||
      String(dragItem.sourceOwnerOverride) === String(ownerId);
    if (!matchesOwner) return;

    interactionStage.off("pointermove", onItemDragMove);
    interactionStage.off("pointerup", onItemDragEnd);
    interactionStage.off("pointerupoutside", onItemDragEnd);
    cleanupDragSprite();
    restoreItemView(dragItem.view);
    clearActiveDropboxAffordance();

    dragItem.active = false;
    dragItem.ownerId = null;
    dragItem.item = null;
    dragItem.view = null;
    dragItem.sourceOwnerOverride = null;
    dragItem.sourceEquipmentSlotId = null;
    dragItem.lastGlobalPos = null;
    dragItem.pressStartX = 0;
    dragItem.pressStartY = 0;
    dragItem.movedDistanceSq = 0;
    dragItem.pointerType = null;
    if (typeof setApDragWarning === "function") {
      setApDragWarning(false);
    }
    if (typeof setDragGhost === "function") {
      setDragGhost(null);
    }
  }

  function concealWindow(ownerId, visibility = null) {
    const win = windows.get(ownerId);
    if (!win) return;

    const resolvedVisibility = visibility ?? getOwnerVisibilitySafe(ownerId);
    win.ownerConcealed = resolvedVisibility.visible === false;
    win.ownerVisibilityReason = resolvedVisibility.reason ?? null;
    win.hovered = false;
    win.focusOutline.visible = false;
    win.container.visible = false;

    cancelItemDragForOwner(ownerId);
    if (dragWindow.active && String(dragWindow.ownerId) === String(ownerId)) {
      dragWindow.active = false;
      dragWindow.ownerId = null;
    }
    if (String(activeSplit?.ownerId) === String(ownerId)) {
      closeSplitDialog();
    }
    clearActiveBuildForOwner(ownerId);
    closeBuildingManagerForOwner(ownerId);
    if (consumePrompt?.ownerId === ownerId) {
      hideConsumePrompt();
    }
  }

  function syncWindowOwnerVisibility(win) {
    if (!win) {
      return {
        visible: true,
        reason: null,
        ownerKind: "other",
        resolvedOwnerId: null,
      };
    }

    const visibility = getOwnerVisibilitySafe(win.ownerId);
    const shouldConceal = visibility.visible === false;
    const wasConcealed = win.ownerConcealed === true;
    win.ownerConcealed = shouldConceal;
    win.ownerVisibilityReason = shouldConceal ? visibility.reason ?? null : null;

    if (shouldConceal) {
      concealWindow(win.ownerId, visibility);
      return visibility;
    }

    if (wasConcealed) {
      refreshWindowVisibility(win);
    }

    return visibility;
  }

  function setActiveBuild(ownerId, buildSpec) {
    const spec =
      typeof buildSpec === "string"
        ? buildPlanSpecFromDefId(buildSpec)
        : buildSpec?.defId
          ? {
              ...buildPlanSpecFromDefId(buildSpec.defId),
              ...buildSpec,
              defId: buildSpec.defId,
            }
          : null;
    if (!ownerId || !spec?.defId) return;
    const normalizedSpec = {
      ownerId,
      defId: spec.defId,
      placementMode: spec.placementMode === "upgrade" ? "upgrade" : "new",
      upgradeFromDefIds: Array.isArray(spec.upgradeFromDefIds)
        ? spec.upgradeFromDefIds
            .filter((id) => typeof id === "string" && id.length > 0)
            .slice()
        : [],
    };
    if (
      activeBuildSpec &&
      activeBuildSpec.ownerId === ownerId &&
      activeBuildSpec.defId === normalizedSpec.defId &&
      activeBuildSpec.placementMode === normalizedSpec.placementMode
    ) {
      activeBuildSpec = null;
      if (buildGhost) buildGhost.container.visible = false;
      pushBuildPlacementPreview();
      return;
    }
    requestPauseForAction?.();
    activeBuildSpec = normalizedSpec;
    pushBuildPlacementPreview();
  }

  function ensureBuildGhost() {
    if (buildGhost) return buildGhost;
    const ghostLayer = dragLayer || layer;
    const container = new PIXI.Container();
    container.visible = false;
    container.eventMode = "none";
    ghostLayer.addChild(container);

    const card = new PIXI.Container();
    const cardBg = new PIXI.Graphics()
      .beginFill(0x3a3a3a, 0.8)
      .drawRoundedRect(0, 0, 120, 80, 10)
      .endFill();
    card.addChild(cardBg);

    const cardFill = new PIXI.Graphics()
      .beginFill(0x6f6f6f, 0.9)
      .drawRoundedRect(3, 3, 114, 74, 8)
      .endFill();
    card.addChild(cardFill);

    const titleText = new PIXI.Text("", {
      fill: 0xffffff,
      fontSize: 12,
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: 108,
    });
    titleText.x = 6;
    titleText.y = 6;
    card.addChild(titleText);

    const subtitleText = new PIXI.Text("", {
      fill: 0xe6e6e6,
      fontSize: 10,
      wordWrap: true,
      wordWrapWidth: 108,
    });
    subtitleText.x = 6;
    subtitleText.y = 26;
    card.addChild(subtitleText);

    const panel = new PIXI.Container();
    const panelBg = new PIXI.Graphics()
      .beginFill(INVENTORY_SUBPANEL_BG, 0.95)
      .drawRoundedRect(0, 0, BUILD_GHOST_PANEL_WIDTH, 10, 8)
      .endFill();
    panel.addChild(panelBg);

    const panelTitle = new PIXI.Text("Costs", {
      fill: 0xffffff,
      fontSize: 11,
      fontWeight: "bold",
    });
    panelTitle.x = BUILD_GHOST_PANEL_PAD;
    panelTitle.y = BUILD_GHOST_PANEL_PAD - 2;
    panel.addChild(panelTitle);

    const panelLines = [];

    container.addChild(card);
    container.addChild(panel);

    buildGhost = {
      container,
      card,
      cardFill,
      cardBg,
      titleText,
      subtitleText,
      panel,
      panelBg,
      panelTitle,
      panelLines,
      panelHeight: 0,
      cardWidth: 120,
      cardHeight: 80,
    };
    return buildGhost;
  }

  function updateBuildGhostContent(buildSpec) {
    const ghost = ensureBuildGhost();
    if (!ghost) return;
    const spec =
      typeof buildSpec === "string"
        ? buildPlanSpecFromDefId(buildSpec)
        : buildSpec?.defId
          ? buildSpec
          : null;
    const defId = spec?.defId ?? null;
    if (!defId) {
      ghost.container.visible = false;
      buildGhostSignature = null;
      return;
    }
    const signature = `${defId}|${spec?.placementMode || "new"}`;
    if (buildGhostSignature === signature) return;
    buildGhostSignature = signature;

    const def = hubStructureDefs[defId];
    ghost.titleText.text = def?.name || defId || "Build";
    ghost.subtitleText.text =
      spec?.placementMode === "upgrade" ? "Upgrade Plan" : "Construction Plan";

    const { width, height } = getBuildGhostCardSize(def);
    if (ghost.cardWidth !== width || ghost.cardHeight !== height) {
      ghost.cardWidth = width;
      ghost.cardHeight = height;
      ghost.cardBg.clear();
      ghost.cardBg
        .beginFill(0x3a3a3a, 0.8)
        .drawRoundedRect(0, 0, width, height, 10)
        .endFill();
      ghost.titleText.style.wordWrapWidth = Math.max(40, width - 12);
      ghost.subtitleText.style.wordWrapWidth = Math.max(40, width - 12);
      ghost.subtitleText.y = Math.min(26, height - 18);
    }

    const color = Number.isFinite(def?.color) ? def.color : 0x6f6f6f;
    ghost.cardFill.clear();
    ghost.cardFill
      .beginFill(color, 0.9)
      .drawRoundedRect(3, 3, ghost.cardWidth - 6, ghost.cardHeight - 6, 8)
      .endFill();

    for (const line of ghost.panelLines) {
      if (line?.parent) line.parent.removeChild(line);
    }
    ghost.panelLines.length = 0;

    const lines = [];
    const apCost = INTENT_AP_COSTS?.buildDesignate ?? 0;
    lines.push(`AP: ${apCost}`);
    if (spec?.placementMode === "upgrade") {
      const sourceNames = Array.isArray(spec?.upgradeFromDefIds)
        ? spec.upgradeFromDefIds
            .map((id) => hubStructureDefs?.[id]?.name || id)
            .join(", ")
        : "";
      lines.push(`Upgrade from: ${sourceNames || "Source structure"}`);
    }

    const reqs = Array.isArray(def?.build?.requirements) ? def.build.requirements : [];
    for (const req of reqs) {
      const amount = Math.max(0, Math.floor(req?.amount ?? 0));
      if (amount <= 0) continue;
      const label = formatBuildRequirementLabel(req);
      lines.push(`${label}: ${amount}`);
    }

    let y = BUILD_GHOST_PANEL_PAD + 16;
    for (const text of lines) {
      const lineText = new PIXI.Text(text, {
        fill: MUCHA_UI_COLORS.ink.secondary,
        fontSize: 10,
      });
      lineText.x = BUILD_GHOST_PANEL_PAD;
      lineText.y = y;
      ghost.panel.addChild(lineText);
      ghost.panelLines.push(lineText);
      y += 12;
    }

    const panelHeight = Math.max(
      48,
      y + BUILD_GHOST_PANEL_PAD - 4
    );
    ghost.panelBg.clear();
    ghost.panelBg
      .beginFill(INVENTORY_SUBPANEL_BG, 0.95)
      .drawRoundedRect(0, 0, BUILD_GHOST_PANEL_WIDTH, panelHeight, 8)
      .endFill();
    ghost.panelHeight = panelHeight;
  }

  function isHubPlacementZone(globalPos) {
    const worldPos = toWorldPoint(globalPos);
    if (!worldPos) return false;
    return (
      worldPos.y >= HUB_STRUCTURE_ROW_Y &&
      worldPos.y <= HUB_STRUCTURE_ROW_Y + HUB_STRUCTURE_HEIGHT
    );
  }

  function updateBuildGhostPosition(globalPos) {
    if (!buildGhost || !globalPos) return;
    const ghost = buildGhost;
    const placing = isHubPlacementZone(globalPos);
    const uiScale = getInventoryWindowScale();
    const baseScale = placing ? BUILD_GHOST_SCALE_PLACE : BUILD_GHOST_SCALE_IDLE;
    const scale = baseScale * uiScale;
    ghost.container.scale.set(scale);

    ghost.card.x = 0;
    ghost.card.y = 0;

    const panelHeight = ghost.panelHeight || 60;
    const panelWidth = BUILD_GHOST_PANEL_WIDTH;
    const ghostWidth = ghost.cardWidth || 120;
    const ghostHeight = ghost.cardHeight || 80;

    let panelX = ghostWidth + BUILD_GHOST_PANEL_GAP;
    const { width: screenWidth } = getScreenSize();
    if (
      globalPos.x + (ghostWidth + panelWidth + BUILD_GHOST_PANEL_GAP) * scale >
      screenWidth - 10
    ) {
      panelX = -panelWidth - BUILD_GHOST_PANEL_GAP;
    }

    ghost.panel.x = panelX;
    ghost.panel.y = Math.max(0, (ghostHeight - panelHeight) / 2);

    setDisplayObjectScreenPosition(
      ghost.container,
      globalPos.x + 10,
      globalPos.y + 10
    );
  }

  function resolveHubColFromPos(state, globalPos, screenWidth) {
    const worldPos = toWorldPoint(globalPos);
    if (!state || !worldPos) return null;
    const hubTop = HUB_STRUCTURE_ROW_Y;
    const hubBottom = HUB_STRUCTURE_ROW_Y + HUB_STRUCTURE_HEIGHT;
    if (worldPos.y < hubTop || worldPos.y > hubBottom) return null;

    const hubCols = Array.isArray(state?.hub?.slots)
      ? state.hub.slots.length
      : HUB_COLS;

    let bestCol = null;
    let bestDist2 = Infinity;
    for (let col = 0; col < hubCols; col++) {
      const cx = getHubColumnCenterX(screenWidth, col);
      const dx = worldPos.x - cx;
      const d2 = dx * dx;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestCol = col;
      }
    }
    return bestCol;
  }

  function pushBuildPlacementPreview() {
    if (typeof setBuildPlacementPreview !== "function") return;
    if (!activeBuildSpec) {
      setBuildPlacementPreview(null);
      return;
    }
    const state = getStateSafe();
    if (!state) {
      setBuildPlacementPreview(null);
      return;
    }
    const { width: screenWidth } = getScreenSize();
    const pos = lastPointerPos || {
      x: screenWidth / 2,
      y: HUB_STRUCTURE_ROW_Y + Math.floor(HUB_STRUCTURE_HEIGHT / 2),
    };
    const col = resolveHubColFromPos(state, pos, screenWidth);
    setBuildPlacementPreview({
      defId: activeBuildSpec.defId,
      hubCol: col,
      placementMode: activeBuildSpec.placementMode || "new",
      upgradeFromDefIds: Array.isArray(activeBuildSpec.upgradeFromDefIds)
        ? activeBuildSpec.upgradeFromDefIds.slice()
        : [],
    });
  }

  function flashBuildGhost(defId) {
    if (typeof flashActionGhost !== "function") return;
    const def = hubStructureDefs[defId];
    const name = def?.name || defId || "Build";
    flashActionGhost(
      {
        description: `Build ${name}`,
        cost: INTENT_AP_COSTS?.buildDesignate ?? 0,
      },
      "fail"
    );
  }

  function placeBuildAt(col, ownerId, defId) {
    const state = getStateSafe();
    const leader = getLeaderForOwner(ownerId);
    if (!state || !leader || !actionPlanner) {
      return { ok: false, reason: "noLeader" };
    }
    if (!Number.isFinite(col)) return { ok: false, reason: "badHubCol" };
    if (!defId) return { ok: false, reason: "noBuildSelected" };

    const previewPlacement =
      typeof actionPlanner.getPawnOverridePlacement === "function"
        ? actionPlanner.getPawnOverridePlacement(leader.id)
        : null;
    const currentHubCol = Number.isFinite(previewPlacement?.hubCol)
      ? Math.floor(previewPlacement.hubCol)
      : Number.isFinite(leader.hubCol)
      ? Math.floor(leader.hubCol)
      : null;
    const currentEnvCol = Number.isFinite(previewPlacement?.envCol)
      ? Math.floor(previewPlacement.envCol)
      : Number.isFinite(leader.envCol)
      ? Math.floor(leader.envCol)
      : null;
    const alreadyThere = currentHubCol === col && currentEnvCol == null;

    const buildKey = `hub:${col}`;
    const target = { hubCol: col };

    const runWhenPaused = () => {
      let moveSet = false;
      let moveRes = { ok: true };
      if (!alreadyThere) {
        moveRes = actionPlanner.setPawnMoveIntent({
          pawnId: leader.id,
          toHubCol: col,
        });
        if (!moveRes?.ok) {
          if (moveRes?.reason === "insufficientAP") {
            flashBuildGhost(defId);
          }
          return moveRes;
        }
        moveSet = true;
      }

      const buildRes = actionPlanner.setBuildDesignationIntent({
        buildKey,
        defId,
        target,
      });

      if (!buildRes?.ok) {
        if (buildRes?.reason === "insufficientAP") {
          flashBuildGhost(defId);
        }
        if (moveSet && !previewPlacement) {
          actionPlanner.removeIntent?.(`pawn:${leader.id}`);
        }
        return buildRes;
      }

      clearActiveBuildForOwner(ownerId);
      return buildRes;
    };
    const runWhenLive = () => {
      const dispatchBatch =
        typeof dispatchPlayerEditBatch === "function"
          ? dispatchPlayerEditBatch
          : scheduleActionsAtNextSecond;
      if (typeof dispatchBatch !== "function") {
        return { ok: false, reason: "noScheduleActions" };
      }
      const actions = [];
      if (!alreadyThere) {
        actions.push({
          kind: ActionKinds.PLACE_PAWN,
          payload: {
            pawnId: leader.id,
            toHubCol: col,
          },
          apCost: INTENT_AP_COSTS?.pawnMove ?? 0,
        });
      }
      actions.push({
        kind: ActionKinds.BUILD_DESIGNATE,
        payload: {
          buildKey,
          defId,
          target,
        },
        apCost: INTENT_AP_COSTS?.buildDesignate ?? 0,
      });
      const res = dispatchBatch(actions, {
        reason: "inventoryBuildLive",
      });
      if (res?.ok) {
        clearActiveBuildForOwner(ownerId);
      }
      return res;
    };

    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused({ runWhenPaused, runWhenLive });
    }
    return runWhenPaused();
  }

  function tryCommitActiveBuildAtGlobalPos(globalPos, stopEvent = null) {
    if (buildingManagerView?.isOpen?.()) return false;
    if (!activeBuildSpec) return false;
    if (dragItem.active || dragWindow.active) return false;
    if (!globalPos) return false;
    if (findWindowAt(globalPos)) return false;

    const state = getStateSafe();
    const { width: screenWidth } = getScreenSize();
    const col = resolveHubColFromPos(state, globalPos, screenWidth);
    if (col == null) return false;

    stopEvent?.stopPropagation?.();
    stopEvent?.preventDefault?.();

    const ownerId = activeBuildSpec.ownerId;
    const defId = activeBuildSpec.defId;
    const res = placeBuildAt(col, ownerId, defId);
    if (res?.ok) {
      const win = windows.get(ownerId);
      if (win) updateLeaderPanel(win);
    }
    pushBuildPlacementPreview();
    return true;
  }

  function updateApOverlayAlpha(win, dt) {
    if (!win?.apOverlay) return;
    const target = Number.isFinite(win.apOverlayTarget)
      ? win.apOverlayTarget
      : 0;
    const frameDt = Number.isFinite(dt) ? dt : 1 / 60;
    const fadeSpeed = target > win.apOverlayAlpha ? AP_OVERLAY_FADE_IN : AP_OVERLAY_FADE_OUT;
    const step = fadeSpeed * frameDt;
    if (win.apOverlayAlpha < target) {
      win.apOverlayAlpha = Math.min(target, win.apOverlayAlpha + step);
    } else if (win.apOverlayAlpha > target) {
      win.apOverlayAlpha = Math.max(target, win.apOverlayAlpha - step);
    }
    win.apOverlay.alpha = win.apOverlayAlpha;
    win.apOverlay.visible = win.apOverlayAlpha > 0.01;
  }

  function updateApDragOverlays(dt) {
    const dragging = dragItem.active && !!dragItem.item;
    const sourceOwner =
      dragItem.sourceOwnerOverride != null
        ? dragItem.sourceOwnerOverride
        : dragItem.ownerId;
    const canAfford =
      dragging && typeof getItemTransferAffordability === "function";
    const invalidOwners = canAfford ? new Set() : null;

    for (const win of windows.values()) {
      let targetAlpha = 0;
      if (canAfford && sourceOwner != null && win.ownerId !== sourceOwner) {
        const affordability = getItemTransferAffordability({
          fromOwnerId: sourceOwner,
          toOwnerId: win.ownerId,
          itemId: dragItem.item.id,
          targetGX: 0,
          targetGY: 0,
        });
        if (affordability?.ok && affordability.affordable === false) {
          targetAlpha = AP_OVERLAY_ALPHA;
          invalidOwners?.add(win.ownerId);
        }
      }
      win.apOverlayTarget = targetAlpha;
      updateApOverlayAlpha(win, dt);
    }

    let hoverInvalid = false;
    if (dragging && invalidOwners && dragItem.lastGlobalPos) {
      const hovered = findWindowAt(dragItem.lastGlobalPos);
      hoverInvalid = !!hovered && invalidOwners.has(hovered.ownerId);
    }
    if (dragging && typeof setApDragWarning === "function") {
      setApDragWarning(hoverInvalid);
    }
  }

  // ---------------------------------------------------------------------------
  // WINDOW CREATION
  // ---------------------------------------------------------------------------

  function ensureWindow(ownerId) {
    if (windows.has(ownerId)) return windows.get(ownerId);

    const inv = getInventoryForOwner(ownerId);
    const cols = inv?.cols ?? DEFAULT_COLS;
    const rows = inv?.rows ?? DEFAULT_ROWS;
    const cellSize = DEFAULT_CELL_SIZE;
    const leader = null;
    const ownerPawn = getPawnForOwner(ownerId);

    const gridWidth = cols * cellSize;
    const binSize = cellSize * BIN_CELL_SIZE;
    const w = gridWidth + INNER_PADDING * 3 + binSize;
    const equipmentPanelHeight = leader ? EQUIP_PANEL_HEIGHT + INNER_PADDING : 0;
    const bodyY = HEADER_HEIGHT + INNER_PADDING + equipmentPanelHeight;
    const baseHeight = bodyY + rows * cellSize + INNER_PADDING;
    const systemsPanelHeight = leader
      ? computeLeaderSystemsContentHeightForLeader(leader)
      : 0;
    const buildPanelHeight = computeBuildContentHeight();
    const leaderPanelHeight = leader
      ? LEADER_PANEL_PADDING +
        SECTION_HEADER_HEIGHT +
        systemsPanelHeight +
        BUILD_PANEL_GAP +
        SECTION_HEADER_HEIGHT +
        LEADER_PANEL_HEIGHT +
        BUILD_PANEL_GAP +
        SECTION_HEADER_HEIGHT +
        SKILLS_PANEL_HEIGHT +
        BUILD_PANEL_GAP +
        SECTION_HEADER_HEIGHT +
        buildPanelHeight +
        LEADER_PANEL_PADDING +
        INNER_PADDING
      : 0;
    const h = baseHeight + leaderPanelHeight;

    const c = new PIXI.Container();
    c.visible = false;
    c.zIndex = INVENTORY_WINDOW_Z_BASE;
    layer.addChild(c);
    const solidRect = { width: w, height: h };
    const solidHitArea = installSolidUiHitArea(c, () => {
      return {
        x: 0,
        y: 0,
        width: solidRect.width,
        height: solidRect.height,
      };
    });

    // Background
    const bg = new PIXI.Graphics();
    bg.beginFill(INVENTORY_WINDOW_BG, 0.95);
    bg.drawRoundedRect(0, 0, w, h, 8);
    bg.endFill();
    c.addChild(bg);

    const warningOverlay = new PIXI.Graphics();
    warningOverlay.visible = false;
    warningOverlay.eventMode = "none";
    c.addChild(warningOverlay);

    const apOverlay = new PIXI.Graphics();
    apOverlay
      .beginFill(AP_OVERLAY_FILL, 0.5)
      .lineStyle(2, AP_OVERLAY_STROKE, 1)
      .drawRoundedRect(1, 1, w - 2, h - 2, 10)
      .endFill();
    apOverlay.alpha = 0;
    apOverlay.visible = false;
    apOverlay.eventMode = "none";

    const headerUi = createWindowHeader({
      stage: interactionStage,
      parent: c,
      width: w,
      height: HEADER_HEIGHT,
      radius: 8,
      background: INVENTORY_HEADER_BG,
      title: getOwnerLabel(ownerId),
      titleStyle: { fill: INVENTORY_HEADER_TEXT, fontSize: 13 },
      paddingX: 8,
      paddingY: 4,
      pinOffsetX: 40,
      closeOffsetX: 10,
      hitAreaTopPadding: 32,
      dragTarget: c,
      canDrag: () => !uiBlocked,
      onDragStart: () => {
        dragWindow.active = true;
        dragWindow.ownerId = ownerId;
      },
      onDragEnd: () => {
        dragWindow.active = false;
        dragWindow.ownerId = null;
      },
      onPinToggle: () => togglePinned(ownerId),
      onClose: () => hideWindow(ownerId),
    });

    const header = headerUi.container;
    const title = headerUi.titleText;
    const pinText = headerUi.pinText;
    const closeText = headerUi.closeText;
    const pawnBadge = ownerPawn
      ? createInventoryPawnBadge(ownerPawn, w)
      : null;
    if (pawnBadge?.root) {
      header.addChild(pawnBadge.root);
    }

    const focusOutline = new PIXI.Graphics();
    focusOutline.lineStyle(2, INVENTORY_FOCUS_STROKE, 1);
    focusOutline.drawRoundedRect(1, 1, w - 2, h - 2, 10);
    focusOutline.visible = false;
    c.addChild(focusOutline);

    // Bin (discard) drop target
    const bin = new PIXI.Container();
    bin.x = INNER_PADDING + gridWidth + INNER_PADDING;
    bin.y = bodyY;
    bin.eventMode = "static";
    bin.cursor = "default";
    c.addChild(bin);

    const binBg = new PIXI.Graphics();
    binBg
      .lineStyle(1, INVENTORY_BIN_STROKE, 1)
      .beginFill(INVENTORY_BIN_FILL, 0.9)
      .drawRoundedRect(0, 0, binSize, binSize, 6)
      .endFill();
    bin.addChild(binBg);

    const binIcon = new PIXI.Graphics();
    binIcon
      .lineStyle(2, INVENTORY_BIN_ICON, 1)
      .drawRoundedRect(binSize * 0.35, binSize * 0.35, binSize * 0.3, binSize * 0.4, 2)
      .moveTo(binSize * 0.3, binSize * 0.32)
      .lineTo(binSize * 0.7, binSize * 0.32)
      .moveTo(binSize * 0.42, binSize * 0.26)
      .lineTo(binSize * 0.58, binSize * 0.26);
    bin.addChild(binIcon);

    // Body container (grid + items)
    const body = new PIXI.Container();
    body.x = INNER_PADDING;
    body.y = bodyY;
    c.addChild(body);

    const win = {
      ownerId,
      container: c,
      bg,
      header,
      focusOutline,
      title,
      pinText,
      body,
      pawnBadge,
      cols,
      rows,
      cellSize,
      pinned: false,
      hovered: false,
      ownerConcealed: false,
      ownerVisibilityReason: null,
      panelWidth: w,
      panelHeight: h,
      warningOverlay,
      apOverlay,
      apOverlayAlpha: 0,
      apOverlayTarget: 0,
      equipmentPanel: null,
      leaderPanel: null,
      sectionState: {
        equipment: false,
        systems: false,
        prestige: false,
        workers: false,
        skills: false,
        build: false,
      },
      forceStackFront: false,
      isExternallyFocused: false,
      dragAffordanceLevel: null,
      uiScale: 1,
      itemViews: [],
      solidHitArea,
      solidRect,
      bin: {
        container: bin,
        bg: binBg,
      },
    };

    applyWindowScale(win);
    syncWindowFocusOutlineAppearance(win);
    syncWindowStackOrder(win);
    windows.set(ownerId, win);

    // Header drag is handled by the shared header helper.

    // Leader panel (optional)
    if (leader) {
      const equipPanel = new PIXI.Container();
      equipPanel.x = INNER_PADDING;
      equipPanel.y = HEADER_HEIGHT + INNER_PADDING;
      equipPanel.eventMode = "passive";
      c.addChild(equipPanel);

      const equipBg = new PIXI.Graphics();
      equipBg.beginFill(INVENTORY_SECTION_BG, 0.95);
      equipBg.drawRoundedRect(0, 0, w - INNER_PADDING * 2, EQUIP_PANEL_HEIGHT, 6);
      equipBg.endFill();
      equipPanel.addChild(equipBg);
      const equipHeader = createSectionLozenge("Equipment", () => {
        const sectionState = ensureSectionState(win);
        sectionState.equipment = !sectionState.equipment;
        updateEquipmentPanel(win);
        updateLeaderPanel(win);
      });
      equipHeader.container.x = EQUIP_PANEL_PADDING;
      equipHeader.container.y = 4;
      equipPanel.addChild(equipHeader.container);

      const slotLayout = getEquipmentSlotLayout(w);
      const equipSlots = {};
      for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
        const layout = slotLayout[slotId];
        if (!layout) continue;

        const slot = new PIXI.Container();
        slot.x = layout.x;
        slot.y = layout.y;
        slot.eventMode = "passive";
        slot.cursor = "default";
        equipPanel.addChild(slot);

        const slotBg = new PIXI.Graphics();
        slotBg
          .lineStyle(1, EQUIP_SLOT_STROKE, 1)
          .beginFill(EQUIP_SLOT_BG, 0.9)
          .drawRoundedRect(0, 0, layout.width, layout.height, 6)
          .endFill();
        slot.addChild(slotBg);

        const itemLayer = new PIXI.Container();
        itemLayer.eventMode = "passive";
        slot.addChild(itemLayer);

        const slotLabel = new PIXI.Text(LEADER_EQUIPMENT_SLOT_LABELS[slotId] || slotId, {
          fill: 0xaeb8d6,
          fontSize: 9,
        });
        slotLabel.anchor.set(0.5, 0);
        slotLabel.x = Math.floor(layout.width / 2);
        slotLabel.y = layout.height + 2;
        slot.addChild(slotLabel);

        equipSlots[slotId] = {
          slot,
          slotBg,
          itemLayer,
          width: layout.width,
          height: layout.height,
          cellSize: EQUIP_SLOT_VISUAL_CELL_SIZE,
          label: slotLabel,
        };
      }

      win.equipmentPanel = {
        container: equipPanel,
        bg: equipBg,
        header: equipHeader,
        slots: equipSlots,
      };

      const panel = new PIXI.Container();
      panel.x = INNER_PADDING;
      panel.y = bodyY + rows * cellSize + INNER_PADDING;
      c.addChild(panel);

      const panelBg = new PIXI.Graphics();
      const leaderPanelInnerHeight =
        LEADER_PANEL_PADDING +
        SECTION_HEADER_HEIGHT +
        systemsPanelHeight +
        BUILD_PANEL_GAP +
        SECTION_HEADER_HEIGHT +
        LEADER_PANEL_HEIGHT +
        BUILD_PANEL_GAP +
        SECTION_HEADER_HEIGHT +
        WORKERS_PANEL_HEIGHT +
        BUILD_PANEL_GAP +
        SECTION_HEADER_HEIGHT +
        SKILLS_PANEL_HEIGHT +
        BUILD_PANEL_GAP +
        SECTION_HEADER_HEIGHT +
        buildPanelHeight +
        LEADER_PANEL_PADDING;
      panelBg.beginFill(INVENTORY_SECTION_BG, 0.95);
      panelBg.drawRoundedRect(
        0,
        0,
        w - INNER_PADDING * 2,
        leaderPanelInnerHeight,
        6
      );
      panelBg.endFill();
      panel.addChild(panelBg);

      const systemsHeader = createSectionLozenge("Systems", () => {
        const caps = getLeaderSectionCapabilities(getStateSafe(), getLeaderForOwner(ownerId));
        if (!caps.systems) return;
        const sectionState = ensureSectionState(win);
        sectionState.systems = !sectionState.systems;
        updateLeaderPanel(win);
      });
      systemsHeader.container.x = LEADER_PANEL_PADDING;
      systemsHeader.container.y = LEADER_PANEL_PADDING;
      panel.addChild(systemsHeader.container);

      const systemsContent = new PIXI.Container();
      systemsContent.x = LEADER_PANEL_PADDING;
      systemsContent.y = systemsHeader.container.y + SECTION_HEADER_HEIGHT;
      panel.addChild(systemsContent);

      const systemsRowsContainer = new PIXI.Container();
      systemsRowsContainer.eventMode = "passive";
      systemsContent.addChild(systemsRowsContainer);

      const prestigeHeader = createSectionLozenge("Prestige", () => {
        const caps = getLeaderSectionCapabilities(getStateSafe(), getLeaderForOwner(ownerId));
        if (!caps.prestige) return;
        const sectionState = ensureSectionState(win);
        sectionState.prestige = !sectionState.prestige;
        updateLeaderPanel(win);
      });
      prestigeHeader.container.x = LEADER_PANEL_PADDING;
      prestigeHeader.container.y =
        LEADER_PANEL_PADDING +
        SECTION_HEADER_HEIGHT +
        systemsPanelHeight +
        BUILD_PANEL_GAP;
      panel.addChild(prestigeHeader.container);

      const prestigeContent = new PIXI.Container();
      prestigeContent.x = LEADER_PANEL_PADDING;
      prestigeContent.y = prestigeHeader.container.y + SECTION_HEADER_HEIGHT;
      panel.addChild(prestigeContent);

      const prestigeText = new PIXI.Text("", {
        fill: 0xffffff,
        fontSize: 12,
      });
      prestigeText.x = 0;
      prestigeText.y = 0;
      prestigeContent.addChild(prestigeText);

      const reservedText = new PIXI.Text("", {
        fill: 0xffffff,
        fontSize: 12,
      });
      reservedText.x = 0;
      reservedText.y = prestigeText.y + 16;
      prestigeContent.addChild(reservedText);

      const hungryText = new PIXI.Text("", {
        fill: 0xff9999,
        fontSize: 11,
      });
      hungryText.x = 0;
      hungryText.y = reservedText.y + 16;
      prestigeContent.addChild(hungryText);

      const followerLabel = new PIXI.Text("Followers:", {
        fill: 0xffffff,
        fontSize: 12,
      });
      followerLabel.x = 0;
      followerLabel.y = hungryText.y + 18;
      prestigeContent.addChild(followerLabel);

      const followerCountText = new PIXI.Text("0", {
        fill: 0xffffaa,
        fontSize: 13,
        fontWeight: "bold",
      });
      followerCountText.x = followerLabel.x + 78;
      followerCountText.y = followerLabel.y - 1;
      prestigeContent.addChild(followerCountText);

      const minusBtn = new PIXI.Container();
      minusBtn.x = w - INNER_PADDING * 2 - LEADER_PANEL_PADDING - 46;
      minusBtn.y = followerLabel.y - 4;
      minusBtn.eventMode = "static";
      minusBtn.cursor = "pointer";
      prestigeContent.addChild(minusBtn);

      const minusBg = new PIXI.Graphics();
      minusBg.beginFill(INVENTORY_BUTTON_BG);
      minusBg.drawRoundedRect(0, 0, 18, 18, 4);
      minusBg.endFill();
      minusBtn.addChild(minusBg);

      const minusText = new PIXI.Text("-", {
        fill: 0xffffff,
        fontSize: 14,
      });
      minusText.x = 6;
      minusText.y = 1;
      minusBtn.addChild(minusText);

      const plusBtn = new PIXI.Container();
      plusBtn.x = w - INNER_PADDING * 2 - LEADER_PANEL_PADDING - 22;
      plusBtn.y = followerLabel.y - 4;
      plusBtn.eventMode = "static";
      plusBtn.cursor = "pointer";
      prestigeContent.addChild(plusBtn);

      const plusBg = new PIXI.Graphics();
      plusBg.beginFill(INVENTORY_BUTTON_BG);
      plusBg.drawRoundedRect(0, 0, 18, 18, 4);
      plusBg.endFill();
      plusBtn.addChild(plusBg);

      const plusText = new PIXI.Text("+", {
        fill: 0xffffff,
        fontSize: 13,
      });
      plusText.x = 5;
      plusText.y = 1;
      plusBtn.addChild(plusText);

      minusBtn.on("pointertap", () => {
        if (uiBlocked) return;
        const caps = getLeaderSectionCapabilities(getStateSafe(), getLeaderForOwner(ownerId));
        if (!caps.prestige) return;
        if (typeof adjustFollowerCount === "function") {
          adjustFollowerCount({ leaderId: ownerId, delta: -1 });
        }
      });

      plusBtn.on("pointertap", () => {
        if (uiBlocked) return;
        const caps = getLeaderSectionCapabilities(getStateSafe(), getLeaderForOwner(ownerId));
        if (!caps.prestige) return;
        if (typeof adjustFollowerCount === "function") {
          adjustFollowerCount({ leaderId: ownerId, delta: 1 });
        }
      });

      const workersHeader = createSectionLozenge("Workers", () => {
        const caps = getLeaderSectionCapabilities(getStateSafe(), getLeaderForOwner(ownerId));
        if (!caps.workers) return;
        const sectionState = ensureSectionState(win);
        sectionState.workers = !sectionState.workers;
        updateLeaderPanel(win);
      });
      workersHeader.container.x = LEADER_PANEL_PADDING;
      workersHeader.container.y = prestigeHeader.container.y + SECTION_HEADER_HEIGHT + LEADER_PANEL_HEIGHT + BUILD_PANEL_GAP;
      panel.addChild(workersHeader.container);

      const workersContent = new PIXI.Container();
      workersContent.x = LEADER_PANEL_PADDING;
      workersContent.y = workersHeader.container.y + SECTION_HEADER_HEIGHT;
      panel.addChild(workersContent);

      const workerLabel = new PIXI.Text("Workers:", {
        fill: 0xffffff,
        fontSize: 12,
      });
      workerLabel.x = 0;
      workerLabel.y = 0;
      workersContent.addChild(workerLabel);

      const workerCountText = new PIXI.Text("0", {
        fill: 0xffffaa,
        fontSize: 13,
        fontWeight: "bold",
      });
      workerCountText.x = workerLabel.x + 66;
      workerCountText.y = workerLabel.y - 1;
      workersContent.addChild(workerCountText);

      const workerMinusBtn = new PIXI.Container();
      workerMinusBtn.x = w - INNER_PADDING * 2 - LEADER_PANEL_PADDING - 46;
      workerMinusBtn.y = workerLabel.y - 4;
      workerMinusBtn.eventMode = "static";
      workerMinusBtn.cursor = "pointer";
      workersContent.addChild(workerMinusBtn);

      const workerMinusBg = new PIXI.Graphics();
      workerMinusBg.beginFill(INVENTORY_BUTTON_BG);
      workerMinusBg.drawRoundedRect(0, 0, 18, 18, 4);
      workerMinusBg.endFill();
      workerMinusBtn.addChild(workerMinusBg);

      const workerMinusText = new PIXI.Text("-", {
        fill: 0xffffff,
        fontSize: 14,
      });
      workerMinusText.x = 6;
      workerMinusText.y = 1;
      workerMinusBtn.addChild(workerMinusText);

      const workerPlusBtn = new PIXI.Container();
      workerPlusBtn.x = w - INNER_PADDING * 2 - LEADER_PANEL_PADDING - 22;
      workerPlusBtn.y = workerLabel.y - 4;
      workerPlusBtn.eventMode = "static";
      workerPlusBtn.cursor = "pointer";
      workersContent.addChild(workerPlusBtn);

      const workerPlusBg = new PIXI.Graphics();
      workerPlusBg.beginFill(INVENTORY_BUTTON_BG);
      workerPlusBg.drawRoundedRect(0, 0, 18, 18, 4);
      workerPlusBg.endFill();
      workerPlusBtn.addChild(workerPlusBg);

      const workerPlusText = new PIXI.Text("+", {
        fill: 0xffffff,
        fontSize: 13,
      });
      workerPlusText.x = 5;
      workerPlusText.y = 1;
      workerPlusBtn.addChild(workerPlusText);

      const workerReservedText = new PIXI.Text("", {
        fill: 0xffffff,
        fontSize: 12,
      });
      workerReservedText.x = 0;
      workerReservedText.y = workerLabel.y + 18;
      workersContent.addChild(workerReservedText);

      const workerPopulationText = new PIXI.Text("", {
        fill: 0xffffff,
        fontSize: 12,
      });
      workerPopulationText.x = 0;
      workerPopulationText.y = workerReservedText.y + 16;
      workersContent.addChild(workerPopulationText);

      const workerHungerRow = createLeaderSystemsRow(
        Math.max(40, w - INNER_PADDING * 2 - LEADER_PANEL_PADDING * 2),
        ownerId,
        "hunger",
        Number.isFinite(win?.uiScale) ? win.uiScale : 1
      );
      workerHungerRow.container.y = workerPopulationText.y + 22;
      workersContent.addChild(workerHungerRow.container);

      workerMinusBtn.on("pointertap", () => {
        if (uiBlocked) return;
        const caps = getLeaderSectionCapabilities(getStateSafe(), getLeaderForOwner(ownerId));
        if (!caps.workers) return;
        if (typeof adjustWorkerCount === "function") {
          adjustWorkerCount({ leaderId: ownerId, delta: -1 });
        }
      });

      workerPlusBtn.on("pointertap", () => {
        if (uiBlocked) return;
        const caps = getLeaderSectionCapabilities(getStateSafe(), getLeaderForOwner(ownerId));
        if (!caps.workers) return;
        if (typeof adjustWorkerCount === "function") {
          adjustWorkerCount({ leaderId: ownerId, delta: 1 });
        }
      });

      const skillsHeader = createSectionLozenge("Skills", () => {
        const caps = getLeaderSectionCapabilities(getStateSafe(), getLeaderForOwner(ownerId));
        if (!caps.skills) return;
        const sectionState = ensureSectionState(win);
        sectionState.skills = !sectionState.skills;
        updateLeaderPanel(win);
      });
      skillsHeader.container.x = LEADER_PANEL_PADDING;
      skillsHeader.container.y = workersHeader.container.y + SECTION_HEADER_HEIGHT + WORKERS_PANEL_HEIGHT + BUILD_PANEL_GAP;
      panel.addChild(skillsHeader.container);

      const skillsContent = new PIXI.Container();
      skillsContent.x = LEADER_PANEL_PADDING;
      skillsContent.y = skillsHeader.container.y + SECTION_HEADER_HEIGHT;
      panel.addChild(skillsContent);

      const skillsContentWidth =
        w - INNER_PADDING * 2 - LEADER_PANEL_PADDING * 2;

      const skillPointsText = new PIXI.Text("", {
        fill: 0xffffff,
        fontSize: 12,
      });
      skillPointsText.x = 0;
      skillPointsText.y = 0;
      skillsContent.addChild(skillPointsText);

      const openSkillTreeButton = createOpenSkillTreeButton(ownerId, skillsContentWidth);
      skillsContent.addChild(openSkillTreeButton.root);

      const unlockedHeaderText = new PIXI.Text("Unlocked Nodes:", {
        fill: 0xb4bfd6,
        fontSize: 10,
        fontWeight: "bold",
      });
      unlockedHeaderText.x = 0;
      unlockedHeaderText.y = 22;
      skillsContent.addChild(unlockedHeaderText);

      const unlockedNodesText = new PIXI.Text("", {
        fill: 0xe8efff,
        fontSize: 10,
        lineHeight: SKILLS_LIST_LINE_HEIGHT,
        wordWrap: true,
        wordWrapWidth: Math.max(80, skillsContentWidth - 2),
      });
      unlockedNodesText.x = 0;
      unlockedNodesText.y = 38;
      skillsContent.addChild(unlockedNodesText);

      const buildHeader = createSectionLozenge("Build", () => {
        const caps = getLeaderSectionCapabilities(getStateSafe(), getLeaderForOwner(ownerId));
        if (!caps.build) return;
        const sectionState = ensureSectionState(win);
        sectionState.build = !sectionState.build;
        updateLeaderPanel(win);
      });
      buildHeader.container.x = LEADER_PANEL_PADDING;
      buildHeader.container.y =
        LEADER_PANEL_PADDING +
        SECTION_HEADER_HEIGHT +
        systemsPanelHeight +
        BUILD_PANEL_GAP +
        SECTION_HEADER_HEIGHT +
        LEADER_PANEL_HEIGHT +
        BUILD_PANEL_GAP +
        SECTION_HEADER_HEIGHT +
        SKILLS_PANEL_HEIGHT +
        BUILD_PANEL_GAP;
      panel.addChild(buildHeader.container);

      const buildPanel = new PIXI.Container();
      buildPanel.x = 0;
      buildPanel.y = buildHeader.container.y + SECTION_HEADER_HEIGHT;
      buildPanel.eventMode = "static";
      buildPanel.cursor = "pointer";
      panel.addChild(buildPanel);

      const buildPanelBg = new PIXI.Graphics();
      buildPanelBg.beginFill(BUILD_PANEL_BG, 0.95);
      buildPanelBg.drawRoundedRect(
        0,
        0,
        w - INNER_PADDING * 2,
        buildPanelHeight,
        6
      );
      buildPanelBg.endFill();
      buildPanel.addChild(buildPanelBg);

      const buildOpenButton = new PIXI.Container();
      buildOpenButton.eventMode = "static";
      buildOpenButton.cursor = "pointer";
      buildOpenButton.x = BUILD_PANEL_PADDING;
      buildOpenButton.y = BUILD_PANEL_PADDING;
      buildPanel.addChild(buildOpenButton);

      const buildOpenButtonBg = new PIXI.Graphics();
      buildOpenButton.addChild(buildOpenButtonBg);

      const buildOpenButtonText = new PIXI.Text("Open Building Manager", {
        fill: BUILD_PANEL_TEXT,
        fontSize: 11,
        fontWeight: "bold",
      });
      buildOpenButton.addChild(buildOpenButtonText);

      const buildHintText = new PIXI.Text("", {
        fill: BUILD_PANEL_TEXT_MUTED,
        fontSize: 10,
      });
      buildHintText.x = BUILD_PANEL_PADDING;
      buildHintText.y =
        buildPanelHeight - BUILD_PANEL_PADDING - BUILD_PANEL_HINT_HEIGHT;
      buildPanel.addChild(buildHintText);

      buildPanel.on("pointertap", (ev) => {
        if (!activeBuildSpec || activeBuildSpec.ownerId !== ownerId) return;
        ev?.stopPropagation?.();
        clearActiveBuildForOwner(ownerId);
        updateLeaderPanel(win);
      });
      buildOpenButton.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        if (uiBlocked) return;
        requestPauseForAction?.();
        buildingManagerView.open({ ownerId });
      });

      win.leaderPanel = {
        container: panel,
        bg: panelBg,
        systemsHeader,
        systemsContent,
        systemsRowsContainer,
        systemRows: [],
        systemsSignature: "",
        systemsContentHeight: systemsPanelHeight,
        prestigeHeader,
        prestigeContent,
        workersHeader,
        workersContent,
        skillsHeader,
        skillsContent,
        buildHeader,
        prestigeText,
        reservedText,
        hungryText,
        followerCountText,
        minusBtn,
        plusBtn,
        workerCountText,
        workerReservedText,
        workerPopulationText,
        workerMinusBtn,
        workerPlusBtn,
        workerHungerRow,
        skillPointsText,
        unlockedNodesText,
        openSkillTreeButton,
        buildPanel,
        buildPanelBg,
        buildOpenButton,
        buildOpenButtonBg,
        buildOpenButtonText,
        buildHintText,
        buildPanelHeight,
        sectionCaps: getLeaderSectionCapabilities(getStateSafe(), leader),
      };
    }

    c.addChild(apOverlay);
    c.addChild(focusOutline);
    c.addChild(warningOverlay);

    // Initial build
    rebuildWindow(ownerId);

    return win;
  }

  // ---------------------------------------------------------------------------
  // WINDOW VISIBILITY
  // ---------------------------------------------------------------------------

  function showOnHover(ownerId, anchor) {
    if (uiBlocked || !canShowHoverUI()) return;

    const win = ensureWindow(ownerId);
    const visibility = syncWindowOwnerVisibility(win);
    if (visibility.visible === false) return;
    const scaleChanged = applyWindowScale(win);
    if (scaleChanged) {
      rebuildWindow(ownerId);
    }
    win.hovered = true;
    win.hoverAnchor = anchor || null;

    if (!win.pinned && anchor) {
      positionWindowFromHoverAnchor(win, anchor);
    } else if (scaleChanged && win.container.visible) {
      const displaySize = getWindowDisplaySize(win);
      const { width: screenWidth, height: screenHeight } = getScreenSize();
      const current = getDisplayObjectScreenPosition(win.container);
      setDisplayObjectScreenPosition(
        win.container,
        Math.max(10, Math.min(screenWidth - displaySize.width - 10, current.x)),
        Math.max(
          10,
          Math.min(screenHeight - displaySize.height - 10, current.y)
        )
      );
    }

    refreshWindowVisibility(win);
    syncWindowStackOrder(win);
  }

  function hideOnHoverOut(ownerId) {
    const win = windows.get(ownerId);
    if (!win) return;

    win.hovered = false;
    win.hoverAnchor = null;
    if (!win.pinned && !isBuildingManagerHoldingOwnerVisible(ownerId)) {
      win.container.visible = false;
      clearActiveBuildForOwner(ownerId);
      closeBuildingManagerForOwner(ownerId);
    }
    syncWindowStackOrder(win);
    if (consumePrompt?.ownerId === ownerId && !win.pinned) {
      hideConsumePrompt();
    }
  }

  function hideWindow(ownerId) {
    const win = windows.get(ownerId);
    if (!win) return;

    win.pinned = false;
    win.hovered = false;
    win.hoverAnchor = null;
    win.container.visible = false;
    win.pinText.text = "[ ]";
    win.forceStackFront = false;
    syncWindowStackOrder(win);
    clearActiveBuildForOwner(ownerId);
    closeBuildingManagerForOwner(ownerId);
    if (consumePrompt?.ownerId === ownerId) {
      hideConsumePrompt();
    }
  }

  function togglePinned(ownerId) {
    const win = ensureWindow(ownerId);
    win.pinned = !win.pinned;
    win.pinText.text = win.pinned ? "[*]" : "[ ]";
    const visibility = syncWindowOwnerVisibility(win);
    if (visibility.visible === false) {
      return;
    }
    if (!win.pinned && !win.hovered && !isBuildingManagerHoldingOwnerVisible(ownerId)) {
      clearActiveBuildForOwner(ownerId);
      closeBuildingManagerForOwner(ownerId);
    }
    refreshWindowVisibility(win);
    syncWindowStackOrder(win);
  }

  function refreshWindowVisibility(win) {
    if (!win) return;
    if (win.ownerConcealed) {
      win.container.visible = false;
      syncWindowStackOrder(win);
      return;
    }
    win.container.visible =
      !!win.pinned ||
      !!win.hovered ||
      isBuildingManagerHoldingOwnerVisible(win.ownerId);
    syncWindowStackOrder(win);
  }

  function applyFocusVisibility(focusIntent) {
    if (focusIntent && focusIntent.kind === "itemTransfer") {
      const focusOwners = new Set([
        focusIntent.fromOwnerId,
        focusIntent.toOwnerId,
      ]);
      for (const ownerId of focusOwners) {
        if (ownerId == null) continue;
        ensureWindow(ownerId);
      }
      for (const win of windows.values()) {
        const shouldFocus = focusOwners.has(win.ownerId);
        const visibility = syncWindowOwnerVisibility(win);
        const canShow = shouldFocus && visibility.visible !== false;
        win.isExternallyFocused = canShow;
        win.forceStackFront = canShow;
        win.container.visible = canShow;
        syncWindowFocusOutlineAppearance(win);
        syncWindowStackOrder(win);
      }
      return;
    }

    const externalOwnersRaw =
      typeof getExternalFocusOwners === "function"
        ? getExternalFocusOwners()
        : null;
    const externalOwners = new Set(
      Array.isArray(externalOwnersRaw)
        ? externalOwnersRaw.filter((ownerId) => ownerId != null)
        : []
    );
    if (externalOwners.size > 0) {
      for (const ownerId of externalOwners) {
        ensureWindow(ownerId);
      }
      for (const win of windows.values()) {
        const shouldFocus = externalOwners.has(win.ownerId);
        const visibility = syncWindowOwnerVisibility(win);
        const canShow = shouldFocus && visibility.visible !== false;
        win.isExternallyFocused = canShow;
        win.forceStackFront = canShow;
        win.container.visible = canShow;
        syncWindowFocusOutlineAppearance(win);
        syncWindowStackOrder(win);
      }
      return;
    }

    for (const win of windows.values()) {
      win.isExternallyFocused = false;
      win.forceStackFront = false;
      refreshWindowVisibility(win);
      syncWindowFocusOutlineAppearance(win);
    }
  }

  // ---------------------------------------------------------------------------
  // TOOLTIP HELPERS
  // ---------------------------------------------------------------------------

  function interpolateTemplate(template, values) {
    if (typeof template !== "string") return template;
    return template.replace(/\{([^}]+)\}/g, (_, token) => {
      const [rawKey, fallback] = String(token).split("|");
      const key = rawKey.trim();
      const value = values[key];
      if (value == null || value === "") {
        return fallback != null ? fallback : "";
      }
      return String(value);
    });
  }

  function formatSystemValue(value) {
    if (value == null) return "";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return String(value);
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(2).replace(/\.?0+$/, "");
    }
    if (typeof value === "string" || typeof value === "boolean") {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function buildItemSystemLines(item) {
    const tiers =
      item?.systemTiers && typeof item.systemTiers === "object"
        ? item.systemTiers
        : {};
    const state =
      item?.systemState && typeof item.systemState === "object"
        ? item.systemState
        : {};

    const systemIds = Array.from(
      new Set([...Object.keys(tiers), ...Object.keys(state)])
    ).sort();
    if (systemIds.length === 0) return [];

    const lines = ["", "Systems:"];
    for (const systemId of systemIds) {
      const sysDef = itemSystemDefs[systemId];
      const label = sysDef?.ui?.name || systemId;
      const tier = tiers[systemId] ?? sysDef?.defaultTier ?? null;
      const systemState =
        state[systemId] && typeof state[systemId] === "object"
          ? state[systemId]
          : null;

      let stateSummary = "";
      if (systemState) {
        const keys = Object.keys(systemState).sort();
        stateSummary = keys
          .map((key) => `${key}=${formatSystemValue(systemState[key])}`)
          .join(", ");
      }

      const tierLabel = tier ? ` [${tier}]` : "";
      const suffix = stateSummary ? `: ${stateSummary}` : "";
      lines.push(`- ${label}${tierLabel}${suffix}`);
    }

    return lines;
  }

  function makeItemTooltipSpec(item, ownerId) {
    const def = itemDefs[item.kind];
    if (!def) {
      return {
        title: item.kind,
        lines: [`Quantity: ${item.quantity}`],
        color: 0x444444,
      };
    }

    const ui = def.ui || {};

    const ownerLabel = getOwnerLabel
      ? getOwnerLabel(ownerId)
      : `Owner ${ownerId}`;
    const state = typeof getState === "function" ? getState() : null;
    const tSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
    const timegraphWindowPast = isItemBeyondAbsoluteTimegraphWindow(item, tSec);

    const ctx = { ownerId, ownerLabel, tSec, timegraphWindowPast };

    const values = {
      id: item.id,
      kind: item.kind,
      name: def.name ?? item.kind,
      ownerId,
      ownerLabel,
      quantity: item.quantity,
      tier: item.tier ?? def.defaultTier ?? "bronze",
      width: item.width ?? def.defaultWidth ?? 1,
      height: item.height ?? def.defaultHeight ?? 1,
      tSec,
      timegraphWindowPast,
    };

    const tooltipCard =
      ui?.tooltipCard && typeof ui.tooltipCard === "object" ? ui.tooltipCard : null;
    const systemLines = buildItemSystemLines(item);

    return makeDefTooltipSpec({
      def,
      lines: systemLines,
      accentColor: def.color ?? 0x666666,
      sourceKind: "item",
      sourceId: item?.id ?? null,
      values: { ...values, item },
      subject: item,
      context: ctx,
    });
  }

  // ---------------------------------------------------------------------------
  // GRID + ITEM BUILDING
  // ---------------------------------------------------------------------------

  function rebuildWindow(ownerId) {
    const win = windows.get(ownerId);
    if (!win) return;

    const visibility = syncWindowOwnerVisibility(win);
    if (visibility.visible === false) return;

    const inv = getInventoryForOwner(ownerId);
    if (!inv) {
      hideWindow(ownerId);
      return;
    }

    win.body.removeChildren();
    win.itemViews = [];

    drawGrid(win);
    const preview =
      typeof getInventoryPreview === "function"
        ? getInventoryPreview(ownerId)
        : null;
    drawItems(win, inv, preview);

    win.title.text = getOwnerLabel(ownerId);
    if (win.pawnBadge?.update) {
      win.pawnBadge.update(getPawnForOwner(ownerId));
    }
    updateEquipmentPanel(win);
    updateLeaderPanel(win);

    if (win.autoRevealAnchor) {
      positionWindowFromHoverAnchor(win, win.autoRevealAnchor);
      win.autoRevealAnchor = null;
    }

    lastVersionByOwner.set(ownerId, inv.version ?? 0);
  }

  function drawGrid(win) {
    const g = new PIXI.Graphics();
    g.lineStyle(1, INVENTORY_GRID_LINE, 1);

    const { cols, rows, cellSize } = win;

    for (let c = 0; c <= cols; c++) {
      const x = c * cellSize;
      g.moveTo(x, 0);
      g.lineTo(x, rows * cellSize);
    }
    for (let r = 0; r <= rows; r++) {
      const y = r * cellSize;
      g.moveTo(0, y);
      g.lineTo(cols * cellSize, y);
    }

    win.body.addChild(g);
  }

  function buildItemView(win, item, opts = {}) {
    const cellSize = Number.isFinite(opts.cellSize)
      ? Math.max(1, Math.floor(opts.cellSize))
      : win.cellSize;
    const c = new PIXI.Container();
    const ownerId = opts.ownerId ?? win.ownerId;

    const interactive = !!opts.interactive;
    c.eventMode = interactive ? "static" : "none";
    c.cursor = interactive ? "pointer" : "default";

    c.itemData = item;
    c.ownerId = ownerId;
    c.sourceOwnerId = item?.sourceOwnerId ?? null;
    c.sourceEquipmentSlotId = opts.sourceEquipmentSlotId ?? null;

    if (interactive && !opts.isGhost) {
      c.on("pointerover", () => {
        if (dragItem.active) return;
        if (!tooltipView) return;
        tooltipView.show(
          {
            ...makeItemTooltipSpec(item, ownerId),
            scale: getInventoryTooltipScale(tooltipView, win?.uiScale, c),
          },
          {
            coordinateSpace: "parent",
            getAnchorRect: () =>
              tooltipView.getAnchorRectForDisplayObject?.(c, "parent") ?? null,
          }
        );
      });

      c.on("pointerout", () => {
        if (!tooltipView) return;
        tooltipView.hide();
      });
    }

    const def = itemDefs[item.kind];
    const color = def?.color ?? 0x999999;
    const borderColor = getItemTierBorderColor(item, def);
    const textScale = Number.isFinite(win?.uiScale) ? win.uiScale : 1;

    const box = new PIXI.Graphics();
    box.beginFill(color);
    box.drawRoundedRect(
      0,
      0,
      item.width * cellSize - 2,
      item.height * cellSize - 2,
      5
    );
    box.endFill();
    c.addChild(box);

    const border = new PIXI.Graphics();
    border.lineStyle(ITEM_TIER_BORDER_WIDTH, borderColor, 1);
    border.drawRoundedRect(
      0,
      0,
      item.width * cellSize - 2,
      item.height * cellSize - 2,
      5
    );
    c.addChild(border);

    c.bg = box;
    c.bg.__baseTint = 0xffffff;

    const glyphText = formatItemGlyphLabel(def, item);
    if (glyphText) {
      const glyph = new PIXI.Text(glyphText, {
        [ITEM_GLYPH_FONT_POLICY_FLAG]: true,
        [ITEM_GLYPH_NO_SMALLCAPS_FLAG]: true,
        fill: ITEM_GLYPH_COLOR,
        fontSize: 16,
        fontWeight: "bold",
      });
      applyTextResolution(glyph, textScale);
      glyph.anchor.set(0.5);
      glyph.x = (item.width * cellSize - 2) / 2;
      glyph.y = (item.height * cellSize - 2) / 2;
      glyph.alpha = ITEM_GLYPH_ALPHA;

      const glyphShadow = new PIXI.Text(glyphText, {
        [ITEM_GLYPH_FONT_POLICY_FLAG]: true,
        [ITEM_GLYPH_NO_SMALLCAPS_FLAG]: true,
        fill: ITEM_GLYPH_SHADOW,
        fontSize: 16,
        fontWeight: "bold",
      });
      applyTextResolution(glyphShadow, textScale);
      glyphShadow.anchor.set(0.5);
      glyphShadow.x = glyph.x + 1;
      glyphShadow.y = glyph.y + 1;
      glyphShadow.alpha = 0.35;

      //c.addChild(glyphShadow);
      c.addChild(glyph);
    }

    if (item.quantity > 1) {
      const t = new PIXI.Text(String(item.quantity), {
        fill: 0xffffff,
        fontSize: 14,
      });
      applyTextResolution(t, textScale);
      t.x = item.width * cellSize - t.width - 6;
      t.y = item.height * cellSize - t.height - 4;
      c.addChild(t);
    }

    if (Number.isFinite(opts.pixelX) && Number.isFinite(opts.pixelY)) {
      c.x = Math.floor(opts.pixelX);
      c.y = Math.floor(opts.pixelY);
    } else {
      const gx = opts.gridX ?? item.gridX;
      const gy = opts.gridY ?? item.gridY;
      c.x = gx * cellSize + 1;
      c.y = gy * cellSize + 1;
    }

    if (opts.isGhost) {
      c.alpha = 0.4;
      c.cursor = "pointer";
      c.eventMode = "static";
      c.on("pointertap", () => {
        if (typeof onGhostClick === "function") {
          onGhostClick(opts.intentId);
        }
      });
    }

    if (interactive && opts.enableDrag) {
      c.on("pointerdown", (ev) => onItemPointerDown(ev, win, item, c));
    }

    if (opts.isFocused) {
      c.bg.tint = 0xffff66;
    }

    const parent = opts.parent || win.body;
    parent.addChild(c);
    if (!opts.isGhost && parent === win.body) {
      win.itemViews.push({ view: c, item, ownerId });
    }
    return c;
  }

  function drawItems(win, inv, preview) {
    const hidden =
      preview?.hiddenItemIds instanceof Set
        ? preview.hiddenItemIds
        : new Set(preview?.hiddenItemIds || []);

    const focusIntent =
      typeof getFocusIntent === "function" ? getFocusIntent() : null;
    const focusedItemId =
      focusIntent && focusIntent.kind === "itemTransfer"
        ? focusIntent.itemId
        : null;

    for (const item of inv.items) {
      if (hidden.has(item.id)) continue;
      buildItemView(win, item, {
        interactive: true,
        enableDrag: true,
        isFocused: focusedItemId != null && item.id === focusedItemId,
      });
    }

    if (preview?.overlayItems?.length) {
      for (const item of preview.overlayItems) {
        if (!item) continue;
        const allowDrag = item.sourceOwnerId != null;
        buildItemView(win, item, {
          ownerId: item.ownerId ?? win.ownerId,
          gridX: item.gridX,
          gridY: item.gridY,
          interactive: allowDrag,
          enableDrag: allowDrag,
          isFocused: focusedItemId != null && item.id === focusedItemId,
        });
      }
    }

    if (preview?.ghostItems?.length) {
      for (const item of preview.ghostItems) {
        if (!item) continue;
        buildItemView(win, item, {
          ownerId: item.ownerId ?? win.ownerId,
          gridX: item.gridX,
          gridY: item.gridY,
          interactive: false,
          enableDrag: false,
          isGhost: true,
          intentId: item.intentId,
          isFocused: focusedItemId != null && item.id === focusedItemId,
        });
      }
    }
  }

  function revealWindow(ownerId, opts = {}) {
    const win = ensureWindow(ownerId);
    if (!win) return { ok: false, reason: "noWindow" };
    const visibility = syncWindowOwnerVisibility(win);
    if (visibility.visible === false) {
      return { ok: false, reason: visibility.reason ?? "ownerHidden" };
    }
    if (opts.pinned) {
      win.pinned = true;
      win.pinText.text = "[*]";
    }
    const scaleChanged = applyWindowScale(win);
    win.hovered = true;
    if (opts.anchor) {
      win.hoverAnchor = opts.anchor;
      win.autoRevealAnchor = opts.anchor;
      if (!scaleChanged) {
        positionWindowFromHoverAnchor(win, opts.anchor);
        win.autoRevealAnchor = null;
      }
    }
    if (scaleChanged) {
      rebuildWindow(ownerId);
    }
    refreshWindowVisibility(win);
    syncWindowStackOrder(win);
    return { ok: true };
  }

  function findItemViewInWindow(win, itemId) {
    if (!win?.body || itemId == null) return null;
    const children = Array.isArray(win.body.children) ? win.body.children : [];
    for (const child of children) {
      if (!child || !child.itemData) continue;
      if (child.itemData.id === itemId) return child;
    }
    return null;
  }

  function beginDragItemFromOwner(ownerId, itemId, opts = {}) {
    if (ownerId == null || itemId == null) {
      return { ok: false, reason: "badArgs" };
    }
    if (uiBlocked) return { ok: false, reason: "uiBlocked" };
    if (dragItem.active || dragWindow.active || activeSplit) {
      return { ok: false, reason: "busy" };
    }

    const win = ensureWindow(ownerId);
    if (!win) return { ok: false, reason: "noWindow" };
    const revealRes = revealWindow(ownerId, { pinned: opts.pinned !== false });
    if (!revealRes?.ok) return revealRes;
    rebuildWindow(ownerId);

    const inv = getInventoryForOwner(ownerId);
    const item = inv?.itemsById?.[itemId] ?? inv?.items?.find((it) => it?.id === itemId);
    if (!item) return { ok: false, reason: "noItem" };

    const view = findItemViewInWindow(win, itemId);
    let global = null;
    if (view?.getBounds) {
      const bounds = view.getBounds();
      global = {
        x: bounds.x + Math.max(4, Math.floor(bounds.width / 2)),
        y: bounds.y + Math.max(4, Math.floor(bounds.height / 2)),
      };
    } else {
      global = win.body.toGlobal({
        x: Math.max(1, item.gridX * win.cellSize + 2),
        y: Math.max(1, item.gridY * win.cellSize + 2),
      });
    }

    beginItemDragAtGlobal(win, item, view, global);
    syncExternalItemDragAffordances(global);
    return { ok: true };
  }

  function redrawEquipmentSlot(slotBg, width, height, occupied) {
    slotBg.clear();
    slotBg
      .lineStyle(1, occupied ? EQUIP_SLOT_STROKE_ACTIVE : EQUIP_SLOT_STROKE, 1)
      .beginFill(occupied ? EQUIP_SLOT_BG_OCCUPIED : EQUIP_SLOT_BG, 0.92)
      .drawRoundedRect(0, 0, width, height, 6)
      .endFill();
  }

  function updateEquipmentPanel(win) {
    if (!win?.equipmentPanel) return;
    const leader = getLeaderForOwner(win.ownerId);
    if (!leader) {
      win.equipmentPanel.container.visible = false;
      return;
    }
    const sectionState = ensureSectionState(win);
    const expanded = sectionState.equipment !== false;
    win.equipmentPanel.container.visible = true;
    win.equipmentPanel.header?.setExpanded?.(expanded, false, "Equipment");
    const equipment = getLeaderEquipmentState(leader);
    for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
      const slot = win.equipmentPanel.slots?.[slotId];
      if (!slot) continue;
      slot.slot.visible = expanded;
      if (!expanded) {
        slot.itemLayer.removeChildren();
        continue;
      }
      const item = equipment[slotId] ?? null;
      redrawEquipmentSlot(slot.slotBg, slot.width, slot.height, !!item);
      slot.itemLayer.removeChildren();
      if (!item) continue;
      const cellSize = Math.max(1, Math.floor(slot.cellSize || 1));
      const renderW = Math.max(1, item.width * cellSize - 2);
      const renderH = Math.max(1, item.height * cellSize - 2);
      const pixelX = Math.floor((slot.width - renderW) / 2);
      const pixelY = Math.floor((slot.height - renderH) / 2);
      buildItemView(win, item, {
        ownerId: win.ownerId,
        interactive: true,
        enableDrag: true,
        parent: slot.itemLayer,
        cellSize,
        gridX: 0,
        gridY: 0,
        pixelX,
        pixelY,
        sourceEquipmentSlotId: slotId,
      });
    }
  }

  function updateLeaderPanel(win) {
    if (!win?.leaderPanel) return;
    const leader = getLeaderForOwner(win.ownerId);
    if (!leader) {
      win.leaderPanel.container.visible = false;
      clearActiveBuildForOwner(win.ownerId);
      closeBuildingManagerForOwner(win.ownerId, "noLeader");
      return;
    }
    const panel = win.leaderPanel;
    const state = getStateSafe();
    const sectionCaps = getLeaderSectionCapabilities(state, leader);
    panel.sectionCaps = sectionCaps;

    if (!sectionCaps.build) {
      clearActiveBuildForOwner(win.ownerId);
      closeBuildingManagerForOwner(win.ownerId, "buildLocked");
    }

    let activeBuildForOwner =
      activeBuildSpec && activeBuildSpec.ownerId === win.ownerId
        ? activeBuildSpec
        : null;
    if (activeBuildForOwner && !isBuildPlanStillValid(state, activeBuildForOwner)) {
      clearActiveBuildForOwner(win.ownerId);
      activeBuildForOwner = null;
    }

    if (sectionCaps.systems) {
      rebuildLeaderSystemsRows(win, leader);
    } else if (panel.systemsRowsContainer) {
      panel.systemRows = [];
      panel.systemsSignature = "";
      panel.systemsContentHeight = 0;
      panel.systemsRowsContainer.removeChildren();
    }
    layoutLeaderSections(win, leader, sectionCaps);
    if (sectionCaps.systems) {
      updateLeaderSystemsRows(win, leader);
    }

    const data = computeLeaderPanelData(leader);
    if (sectionCaps.prestige) {
      panel.prestigeText.text = `Prestige: ${data.effective}/${data.base}`;
      panel.reservedText.text = `Reserved: ${data.reserved} (Debt ${data.debt})`;
      if (data.hungryCount > 0) {
        panel.hungryText.text = `Hungry: ${data.hungryCount} (Debt ${data.hungryDebt})`;
      } else {
        panel.hungryText.text = "Hungry: 0";
      }
      panel.followerCountText.text = String(data.followerCount);
    }

    if (sectionCaps.workers) {
      const workerCount = Math.max(0, Math.floor(data.workerCount ?? 0));
      const totalWorkers = Math.max(0, Math.floor(data.totalWorkers ?? 0));
      const population = Math.max(0, Math.floor(data.population ?? 0));
      const workerReserved = workerCount * PRESTIGE_COST_PER_FOLLOWER;
      panel.workerCountText.text = String(workerCount);
      panel.workerReservedText.text = `Reserved: ${workerReserved}`;
      panel.workerPopulationText.text = `Population: ${totalWorkers}/${population}`;
      updateWorkerMirrorHungerRow(panel.workerHungerRow, leader);
    }

    const canMinus = sectionCaps.prestige && data.followerCount > 0;
    panel.minusBtn.alpha = canMinus ? 1 : 0.35;
    panel.minusBtn.eventMode = canMinus ? "static" : "none";
    panel.minusBtn.cursor = canMinus ? "pointer" : "default";
    panel.plusBtn.alpha = sectionCaps.prestige ? 1 : 0.35;
    panel.plusBtn.eventMode = sectionCaps.prestige ? "static" : "none";
    panel.plusBtn.cursor = sectionCaps.prestige ? "pointer" : "default";

    const workerAvailability =
      data.workerAvailability && typeof data.workerAvailability === "object"
        ? data.workerAvailability
        : null;
    const canWorkerMinus = sectionCaps.workers && Math.max(0, Math.floor(data.workerCount ?? 0)) > 0;
    const canWorkerPlus = sectionCaps.workers && workerAvailability?.canAdd === true;
    panel.workerMinusBtn.alpha = canWorkerMinus ? 1 : 0.35;
    panel.workerMinusBtn.eventMode = canWorkerMinus ? "static" : "none";
    panel.workerMinusBtn.cursor = canWorkerMinus ? "pointer" : "default";
    panel.workerPlusBtn.alpha = canWorkerPlus ? 1 : 0.35;
    panel.workerPlusBtn.eventMode = canWorkerPlus ? "static" : "none";
    panel.workerPlusBtn.cursor = canWorkerPlus ? "pointer" : "default";

    if (sectionCaps.skills && panel.skillPointsText) {
      const skillPoints = Number.isFinite(leader?.skillPoints)
        ? Math.max(0, Math.floor(leader.skillPoints))
        : 0;
      panel.skillPointsText.text = `Skill Points: ${skillPoints}`;
    } else if (panel.skillPointsText) {
      panel.skillPointsText.text = "";
    }

    if (sectionCaps.skills && panel.unlockedNodesText) {
      const unlockedIds = Array.from(getUnlockedSkillSet(state, leader.id));
      const skillNodeDefs = getSkillNodes();
      const visibleIds = unlockedIds.slice(0, SKILLS_UNLOCKED_LIST_MAX);
      const lines = visibleIds.map((nodeId) => {
        const nodeName = skillNodeDefs?.[nodeId]?.name;
        if (typeof nodeName === "string" && nodeName.length > 0 && nodeName !== nodeId) {
          return `- ${nodeId} (${nodeName})`;
        }
        return `- ${nodeId}`;
      });
      if (!lines.length) {
        lines.push("(none)");
      }
      const remaining = unlockedIds.length - visibleIds.length;
      if (remaining > 0) {
        lines.push(`+${remaining} more`);
      }
      panel.unlockedNodesText.text = lines.join("\n");
    } else if (panel.unlockedNodesText) {
      panel.unlockedNodesText.text = "";
    }

    panel.openSkillTreeButton?.setEnabled?.(
      sectionCaps.skills && typeof openSkillTree === "function"
    );

    if (sectionCaps.build) {
      const activeDefId = activeBuildForOwner?.defId ?? null;
      const buttonWidth =
        win.panelWidth - INNER_PADDING * 2 - BUILD_PANEL_PADDING * 2;
      const buttonHeight = BUILD_PANEL_BUTTON_HEIGHT;
      const buttonEnabled = true;

      if (panel.buildOpenButton) {
        panel.buildOpenButton.eventMode = buttonEnabled ? "static" : "none";
        panel.buildOpenButton.cursor = buttonEnabled ? "pointer" : "default";
      }
      if (panel.buildOpenButtonBg) {
        panel.buildOpenButtonBg.clear();
        panel.buildOpenButtonBg
          .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.95)
          .beginFill(
            buttonEnabled
              ? MUCHA_UI_COLORS.surfaces.border
              : MUCHA_UI_COLORS.surfaces.panelDeep,
            0.97
          )
          .drawRoundedRect(0, 0, buttonWidth, buttonHeight, 6)
          .endFill();
      }
      if (panel.buildOpenButtonText) {
        panel.buildOpenButtonText.text = "Open Building Manager";
        panel.buildOpenButtonText.alpha = buttonEnabled ? 1 : 0.5;
        panel.buildOpenButtonText.x = Math.max(
          6,
          Math.floor((buttonWidth - panel.buildOpenButtonText.width) / 2)
        );
        panel.buildOpenButtonText.y = Math.max(
          3,
          Math.floor((buttonHeight - panel.buildOpenButtonText.height) / 2)
        );
      }

      if (panel.buildHintText) {
        panel.buildHintText.text =
          activeDefId != null
            ? "Drop here to cancel."
            : "Open manager to choose a build plan.";
        panel.buildHintText.y =
          panel.buildPanelHeight - BUILD_PANEL_PADDING - BUILD_PANEL_HINT_HEIGHT;
      }

      if (panel.buildPanelBg) {
        const bgColor = activeDefId != null ? 0x3b1f2a : BUILD_PANEL_BG;
        panel.buildPanelBg.clear();
        panel.buildPanelBg.beginFill(bgColor, 0.95);
        panel.buildPanelBg.drawRoundedRect(
          0,
          0,
          win.panelWidth - INNER_PADDING * 2,
          panel.buildPanelHeight,
          6
        );
        panel.buildPanelBg.endFill();
      }

      panel.buildHeader?.setExpanded?.(
        ensureSectionState(win).build !== false,
        activeDefId != null,
        activeDefId != null ? "Cancel Build" : "Build"
      );

      if (panel.buildPanel) {
        panel.buildPanel.cursor = activeDefId != null ? "pointer" : "default";
      }
    } else if (panel.buildHintText) {
      panel.buildHintText.text = "";
    }
  }

  // ---------------------------------------------------------------------------
  // ITEM INTERACTION
  // ---------------------------------------------------------------------------

  function hasConsumeEffect(item) {
    if (!item || typeof onUseItem !== "function") return false;
    const def = itemDefs?.[item.kind];
    if (!def || typeof def !== "object") return false;
    const hasOnUse =
      Array.isArray(def.onUse) ? def.onUse.length > 0 : !!(def.onUse && typeof def.onUse === "object");
    if (!hasOnUse) return false;
    const state = typeof getState === "function" ? getState() : null;
    return isItemUseCurrentlyAvailable(state, item, def);
  }

  function hasScrollGraphTapUse(item) {
    if (!item || typeof onUseItem !== "function") return false;
    return !!getScrollTimegraphStateFromItem(item);
  }

  function ensureConsumePrompt() {
    if (consumePrompt?.container) return consumePrompt;
    const container = new PIXI.Container();
    container.visible = false;
    container.eventMode = "static";
    container.cursor = "pointer";
    container.zIndex = 120;

    const bg = new PIXI.Graphics();
    const text = new PIXI.Text(CONSUME_PROMPT_TEXT, {
      fill: 0xf8fbff,
      fontSize: 11,
      fontWeight: "bold",
    });
    container.addChild(bg, text);
    layer.addChild(container);

    consumePrompt = {
      container,
      bg,
      text,
      ownerId: null,
      itemId: null,
      sourceEquipmentSlotId: null,
      holdSec: 0,
      fadeSec: 0,
      totalSec: 0,
      anchorBounds: null,
    };

    container.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
    });
    container.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      confirmConsumePrompt();
    });

    return consumePrompt;
  }

  function hideConsumePrompt() {
    if (!consumePrompt) return;
    consumePrompt.ownerId = null;
    consumePrompt.itemId = null;
    consumePrompt.sourceEquipmentSlotId = null;
    consumePrompt.anchorBounds = null;
    consumePrompt.holdSec = 0;
    consumePrompt.fadeSec = 0;
    consumePrompt.totalSec = 0;
    if (consumePrompt.container) {
      consumePrompt.container.visible = false;
      consumePrompt.container.alpha = 1;
    }
  }

  function positionConsumePrompt(bounds) {
    if (!consumePrompt?.container || !consumePrompt?.bg || !consumePrompt?.text) {
      return;
    }
    const resolvedBounds = typeof bounds === "function" ? bounds() : bounds;
    if (!resolvedBounds) return;
    const text = consumePrompt.text;
    const bg = consumePrompt.bg;
    const width = Math.max(1, Math.ceil(resolvedBounds.width));
    const height = Math.max(1, Math.ceil(resolvedBounds.height));
    text.scale.set(1);
    const fitScale = Math.min(
      1,
      Math.max(0.01, (width - 8) / Math.max(1, text.width)),
      Math.max(0.01, (height - 6) / Math.max(1, text.height))
    );
    text.scale.set(fitScale);
    bg.clear();
    bg.lineStyle(1, INVENTORY_PROMPT_STROKE, 0.98);
    bg.beginFill(INVENTORY_PROMPT_BG, 0.96);
    bg.drawRoundedRect(0, 0, width, height, 6);
    bg.endFill();
    consumePrompt.container.hitArea = new PIXI.Rectangle(0, 0, width, height);
    text.x = Math.floor((width - text.width) / 2);
    text.y = Math.floor((height - text.height) / 2);

    setDisplayObjectScreenPosition(
      consumePrompt.container,
      Math.round(resolvedBounds.x),
      Math.round(resolvedBounds.y)
    );
  }

  function showConsumePrompt({ ownerId, itemId, sourceEquipmentSlotId, view }) {
    const prompt = ensureConsumePrompt();
    const bounds = view?.getBounds?.() ?? null;
    if (!bounds) return false;

    prompt.ownerId = ownerId;
    prompt.itemId = itemId;
    prompt.sourceEquipmentSlotId = sourceEquipmentSlotId ?? null;
    prompt.anchorBounds =
      typeof view?.getBounds === "function" ? () => view.getBounds() : bounds;
    prompt.holdSec = CONSUME_PROMPT_HOLD_SEC;
    prompt.fadeSec = CONSUME_PROMPT_FADE_SEC;
    prompt.totalSec = prompt.holdSec + prompt.fadeSec;
    prompt.container.alpha = 1;
    prompt.container.visible = true;
    positionConsumePrompt(bounds);
    return true;
  }

  function isConsumePromptMatch({ ownerId, itemId, sourceEquipmentSlotId }) {
    if (!consumePrompt?.container?.visible) return false;
    return (
      consumePrompt.ownerId === ownerId &&
      consumePrompt.itemId === itemId &&
      (consumePrompt.sourceEquipmentSlotId ?? null) ===
        (sourceEquipmentSlotId ?? null)
    );
  }

  function confirmConsumePrompt() {
    if (!consumePrompt?.container?.visible) return false;
    const ownerId = consumePrompt.ownerId;
    const itemId = consumePrompt.itemId;
    const sourceEquipmentSlotId = consumePrompt.sourceEquipmentSlotId ?? null;
    if (ownerId == null || itemId == null) {
      hideConsumePrompt();
      return false;
    }

    const inv = getInventoryForOwner(ownerId);
    const item =
      inv?.itemsById?.[itemId] ||
      inv?.items?.find?.((candidate) => candidate?.id === itemId) ||
      null;
    if (!item) {
      hideConsumePrompt();
      return false;
    }

    const used = tryUseItemFromTap({
      ownerId,
      item,
      sourceEquipmentSlotId,
      view: null,
    });
    hideConsumePrompt();
    if (used) {
      rebuildWindow(ownerId);
      return true;
    }
    return false;
  }

  function handleConsumeTapInteraction({
    ownerId,
    item,
    sourceEquipmentSlotId,
    view,
  }) {
    const consumeEffect = hasConsumeEffect(item);
    const tapUseAvailable = consumeEffect || hasScrollGraphTapUse(item);

    if (!tapUseAvailable) {
      if (
        consumePrompt?.container?.visible &&
        consumePrompt.ownerId === ownerId &&
        consumePrompt.itemId === item?.id
      ) {
        hideConsumePrompt();
      }
      return "none";
    }

    if (!consumeEffect) {
      if (consumePrompt?.container?.visible) {
        hideConsumePrompt();
      }
      return tryUseItemFromTap({
        ownerId,
        item,
        sourceEquipmentSlotId,
        view,
      })
        ? "used"
        : "none";
    }

    const itemId = item?.id ?? null;
    if (itemId == null) return "none";

    if (isConsumePromptMatch({ ownerId, itemId, sourceEquipmentSlotId })) {
      return confirmConsumePrompt() ? "used" : "none";
    }

    const shown = showConsumePrompt({
      ownerId,
      itemId,
      sourceEquipmentSlotId,
      view,
    });
    return shown ? "prompted" : "none";
  }

  function updateConsumePrompt(dt) {
    if (!consumePrompt?.container?.visible) return;
    const frameDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    consumePrompt.totalSec = Math.max(0, (consumePrompt.totalSec ?? 0) - frameDt);
    if (consumePrompt.totalSec <= 0) {
      hideConsumePrompt();
      return;
    }

    if (consumePrompt.totalSec > (consumePrompt.fadeSec ?? 0)) {
      consumePrompt.container.alpha = 1;
    } else {
      const fadeSec = Math.max(0.01, consumePrompt.fadeSec ?? CONSUME_PROMPT_FADE_SEC);
      consumePrompt.container.alpha = Math.max(
        0,
        Math.min(1, consumePrompt.totalSec / fadeSec)
      );
    }

    if (consumePrompt.anchorBounds) {
      positionConsumePrompt(consumePrompt.anchorBounds);
    }
  }

  function wasTapInteraction() {
    const touchLikePointer =
      dragItem.pointerType === "touch" || dragItem.pointerType === "pen";
    const maxDragPx = touchLikePointer
      ? ITEM_TAP_MAX_DRAG_TOUCH_PX
      : ITEM_TAP_MAX_DRAG_PX;
    const maxSq = maxDragPx * maxDragPx;
    return (dragItem.movedDistanceSq ?? 0) <= maxSq;
  }

  function tryUseItemFromTap({ ownerId, item, sourceEquipmentSlotId, view }) {
    if (typeof onUseItem !== "function") return false;
    if (!item) return false;
    const result = onUseItem({
      ownerId,
      itemId: item.id,
      item,
      sourceEquipmentSlotId: sourceEquipmentSlotId ?? null,
    });
    if (result && typeof result === "object" && result.handled === true) {
      return true;
    }
    return result === true;
  }

  function onItemPointerDown(ev, win, item, view) {
    if (uiBlocked) return;

    if (ev.data.originalEvent.shiftKey && !view?.sourceEquipmentSlotId) {
      const transferLocked =
        typeof hasItemTransferIntent === "function" &&
        hasItemTransferIntent(item.id);
      if (transferLocked || view?.sourceOwnerId != null) {
        flashItemError(view, win.ownerId);
        return;
      }
      openSplitDialog(ev.data.global, win.ownerId, item);
      return;
    }

    beginItemDrag(ev, win, item, view);
  }

  // ----- ITEM DRAGGING ------------------------------------------------------

  function beginItemDrag(ev, win, item, view) {
    requestPauseForAction?.();
    const g = ev?.data?.global;
    if (!g) return;
    const pointerTypeRaw =
      ev?.data?.pointerType ?? ev?.data?.originalEvent?.pointerType ?? null;
    const pointerType =
      pointerTypeRaw === "touch" || pointerTypeRaw === "pen" || pointerTypeRaw === "mouse"
        ? pointerTypeRaw
        : null;
    beginItemDragAtGlobal(win, item, view, g, { pointerType });
  }

  function beginItemDragAtGlobal(win, item, view, globalPos, opts = null) {
    requestPauseForAction?.();
    const g = globalPos;
    if (!g) return;
    hideConsumePrompt();
    const sourceSlotId = view?.sourceEquipmentSlotId ?? null;

    dragItem.lastGlobalPos = { x: g.x, y: g.y };
    dragItem.pressStartX = g.x;
    dragItem.pressStartY = g.y;
    dragItem.movedDistanceSq = 0;
    dragItem.pointerType =
      opts?.pointerType === "touch" ||
      opts?.pointerType === "pen" ||
      opts?.pointerType === "mouse"
        ? opts.pointerType
        : null;
    let cellOffsetGX = 0;
    let cellOffsetGY = 0;
    if (!sourceSlotId) {
      const localInBody = win.body.toLocal(g);
      const clickGX = Math.floor(localInBody.x / win.cellSize);
      const clickGY = Math.floor(localInBody.y / win.cellSize);

      cellOffsetGX = clickGX - item.gridX;
      cellOffsetGY = clickGY - item.gridY;

      cellOffsetGX = Math.max(0, Math.min(item.width - 1, cellOffsetGX));
      cellOffsetGY = Math.max(0, Math.min(item.height - 1, cellOffsetGY));
    }

    dragItem.cellOffsetGX = cellOffsetGX;
    dragItem.cellOffsetGY = cellOffsetGY;

    dragItem.active = true;
    dragItem.ownerId = win.ownerId;
    dragItem.item = item;
    dragItem.view = view;
    const stagedSourceOwnerId =
      view?.sourceOwnerId != null &&
      view?.ownerId != null &&
      String(view.sourceOwnerId) !== String(view.ownerId)
        ? view.ownerId
        : view?.sourceOwnerId ?? null;
    dragItem.sourceOwnerOverride = stagedSourceOwnerId;
    dragItem.sourceEquipmentSlotId = sourceSlotId;
    clearActiveDropboxAffordance();

    grayItemView(view);

    const sprite = makeDragSprite(win, item, view, g);
    dragItem.sprite = sprite;
    dragLayer.addChild(sprite);
    if (sprite?.__screenStart) {
      setDisplayObjectScreenPosition(
        sprite,
        sprite.__screenStart.x,
        sprite.__screenStart.y
      );
    }

    const spriteGlobal = getDisplayObjectScreenPosition(sprite);
    dragItem.offsetX = g.x - spriteGlobal.x;
    dragItem.offsetY = g.y - spriteGlobal.y;

    updateItemDragGhost(g);

    interactionStage.on("pointermove", onItemDragMove);
    interactionStage.on("pointerup", onItemDragEnd);
    interactionStage.on("pointerupoutside", onItemDragEnd);
  }

  function makeDragSprite(win, item, view, globalStart) {
    const cellSize = Number.isFinite(win?.cellSize)
      ? Math.max(1, win.cellSize)
      : DEFAULT_CELL_SIZE;
    const uiScale = Number.isFinite(win?.uiScale) ? Math.max(0.01, win.uiScale) : 1;
    const sourceBounds =
      typeof view?.getBounds === "function" ? view.getBounds() : null;
    const hasSourceBounds =
      Number.isFinite(sourceBounds?.x) &&
      Number.isFinite(sourceBounds?.y) &&
      Number.isFinite(sourceBounds?.width) &&
      Number.isFinite(sourceBounds?.height) &&
      sourceBounds.width > 0 &&
      sourceBounds.height > 0;

    let w = item.width * cellSize;
    let h = item.height * cellSize;
    if (hasSourceBounds) {
      const unscaledW = sourceBounds.width / uiScale;
      const unscaledH = sourceBounds.height / uiScale;
      if (Number.isFinite(unscaledW) && unscaledW > 1) w = unscaledW;
      if (Number.isFinite(unscaledH) && unscaledH > 1) h = unscaledH;
    }

    const g = new PIXI.Graphics();
    g.beginFill(0xffffaa);
    g.drawRoundedRect(0, 0, w - 2, h - 2, 5);
    g.endFill();

    const c = new PIXI.Container();
    c.addChild(g);
    c.zIndex = 9999;

    const def = itemDefs[item.kind];
    const borderColor = getItemTierBorderColor(item, def);
    const border = new PIXI.Graphics();
    border.lineStyle(ITEM_TIER_BORDER_WIDTH, borderColor, 1);
    border.drawRoundedRect(0, 0, w - 2, h - 2, 5);
    c.addChild(border);

    if (hasSourceBounds) {
      c.__screenStart = { x: sourceBounds.x, y: sourceBounds.y };
      setDisplayObjectScreenPosition(c, sourceBounds.x, sourceBounds.y);
    } else {
      const global = win.body.toGlobal({
        x: item.gridX * cellSize,
        y: item.gridY * cellSize,
      });
      c.__screenStart = { x: global.x, y: global.y };
      setDisplayObjectScreenPosition(c, global.x, global.y);
    }
    c.scale.set(uiScale);

    if (Number.isFinite(globalStart?.x) && Number.isFinite(globalStart?.y)) {
      const current = getDisplayObjectScreenPosition(c);
      setDisplayObjectScreenPosition(c, Math.round(current.x), Math.round(current.y));
    }

    if (item.quantity > 1) {
      const t = new PIXI.Text(String(item.quantity), {
        fill: 0x000000,
        fontSize: 14,
      });
      t.x = w - t.width - 6;
      t.y = h - t.height - 4;
      c.addChild(t);
    }

    return c;
  }

  function resolveDropTargetOwnerId(globalPos) {
    return resolveExternalDropTargetSpec(globalPos)?.ownerId ?? null;
  }

  function updateDropboxDragAffordance(globalPos) {
    if (!dragItem.active || !dragItem.item) {
      clearActiveDropboxAffordance();
      return;
    }
    const targetOwner = resolveDropTargetOwnerId(globalPos);
    if (!isAnyDropboxOwnerId(targetOwner)) {
      clearActiveDropboxAffordance();
      return;
    }

    const sourceOwner =
      dragItem.sourceOwnerOverride != null
        ? dragItem.sourceOwnerOverride
        : dragItem.ownerId;
    const quantity = Math.max(0, Math.floor(dragItem.item.quantity ?? 0));
    const statusRes =
      typeof getProcessDropboxDragStatus === "function"
        ? getProcessDropboxDragStatus({
            fromOwnerId: sourceOwner,
            toOwnerId: targetOwner,
            itemKind: dragItem.item.kind,
            quantity,
            itemId: dragItem.item.id,
          })
        : { status: "invalid", reason: "missingDropboxDragStatus" };
    const level =
      statusRes?.status === "valid"
        ? "valid"
        : statusRes?.status === "capped"
          ? "capped"
          : "invalid";
    setActiveDropboxAffordance(targetOwner, level);
  }

  function onItemDragMove(ev) {
    if (!dragItem.active) return;

    const g = ev.data.global;
    dragItem.lastGlobalPos = { x: g.x, y: g.y };
    const dx = g.x - (dragItem.pressStartX ?? g.x);
    const dy = g.y - (dragItem.pressStartY ?? g.y);
    const distSq = dx * dx + dy * dy;
    if (distSq > (dragItem.movedDistanceSq ?? 0)) {
      dragItem.movedDistanceSq = distSq;
    }
    const s = dragItem.sprite;

    setDisplayObjectScreenPosition(s, g.x - dragItem.offsetX, g.y - dragItem.offsetY);

    updateDropboxDragAffordance(g);
    updateItemDragGhost(g);
    syncExternalItemDragAffordances(g);
  }

  function onItemDragEnd(ev) {
    interactionStage.off("pointermove", onItemDragMove);
    interactionStage.off("pointerup", onItemDragEnd);
    interactionStage.off("pointerupoutside", onItemDragEnd);

    if (!dragItem.active) {
      clearActiveDropboxAffordance();
      clearExternalItemDragAffordances();
      return;
    }
    dropItem(ev);
  }

  function cleanupDragSprite() {
    if (dragItem.sprite?.parent) {
      dragItem.sprite.parent.removeChild(dragItem.sprite);
    }
    dragItem.sprite = null;
  }

  // ----- DROP LOGIC ---------------------------------------------------------

  function dropItem(ev) {
    const item = dragItem.item;
    const sourceOwner =
      dragItem.sourceOwnerOverride != null
        ? dragItem.sourceOwnerOverride
        : dragItem.ownerId;
    const sourceEquipmentSlotId = dragItem.sourceEquipmentSlotId ?? null;
    const view = dragItem.view;
    const g = ev.data.global;
    const tapInteraction = wasTapInteraction();

    cleanupDragSprite();
    dragItem.active = false;
    dragItem.lastGlobalPos = null;
    dragItem.pressStartX = 0;
    dragItem.pressStartY = 0;
    dragItem.movedDistanceSq = 0;
    dragItem.pointerType = null;

    const finish = (status = null) => {
      clearActiveDropboxAffordance();
      clearExternalItemDragAffordances();
      restoreItemView(view);
      dragItem.view = null;
      dragItem.sourceOwnerOverride = null;
      dragItem.sourceEquipmentSlotId = null;
      if (typeof setApDragWarning === "function") {
        setApDragWarning(false);
      }
      if (typeof resolveDragGhost === "function") {
        if (status === "success" || status === "fail") {
          resolveDragGhost(status);
        } else if (typeof setDragGhost === "function") {
          setDragGhost(null);
        }
      } else if (typeof setDragGhost === "function") {
        setDragGhost(null);
      }
    };

    if (uiBlocked) {
      flashItemError(view, sourceOwner);
      console.warn("inventoryMove failed: noDropTargetDetected", {
        sourceOwner,
        itemId: item?.id ?? null,
        globalPos: g ? { x: g.x, y: g.y } : null,
      });
      finish("fail");
      return;
    }

    if (tapInteraction) {
      const tapOwnerId = view?.ownerId ?? dragItem.ownerId ?? sourceOwner;
      const consumeResult = handleConsumeTapInteraction({
        ownerId: tapOwnerId,
        item,
        sourceEquipmentSlotId,
        view,
      });
      if (consumeResult === "used") {
        rebuildWindow(tapOwnerId);
        if (tapOwnerId !== sourceOwner) {
          rebuildWindow(sourceOwner);
        }
        finish();
        return;
      }
      if (consumeResult === "prompted") {
        finish();
        return;
      }
    }

    const binTarget = findBinAt(g);
    if (binTarget) {
      const discard =
        typeof discardItemFromOwner === "function"
          ? discardItemFromOwner
          : null;
      const result = discard
        ? discard({ ownerId: sourceOwner, itemId: item.id })
        : { ok: false, reason: "noDiscardHandler" };
      if (!result.ok) {
        console.warn("discardItem failed:", result.reason, result);
        flashItemError(view, sourceOwner);
        finish("fail");
        return;
      }
      rebuildWindow(sourceOwner);
      finish("success");
      return;
    }

    const slotDrop = findEquipmentSlotAt(g);
    if (slotDrop) {
      const targetOwner = slotDrop.ownerId;
      const targetSlotId = slotDrop.slotId;

      if (view?.sourceOwnerId != null) {
        flashItemError(view, sourceOwner);
        finish("fail");
        return;
      }

      if (!sourceEquipmentSlotId) {
        const equippedTarget = getLeaderEquippedItem(targetOwner, targetSlotId);
        const isBasketTarget = itemProvidesBasketPool(equippedTarget);
        if (isBasketTarget) {
          const deposit =
            typeof depositItemToBasket === "function" ? depositItemToBasket : null;
          const result = deposit
            ? deposit({
                fromOwnerId: sourceOwner,
                toOwnerId: targetOwner,
                itemId: item.id,
                slotId: targetSlotId,
              })
            : { ok: false, reason: "noDepositItemToBasketHandler" };

          if (!result?.ok) {
            flashWindowError(targetOwner);
            flashItemError(view, sourceOwner);
            finish("fail");
            return;
          }

          rebuildWindow(sourceOwner);
          if (targetOwner !== sourceOwner) rebuildWindow(targetOwner);
          openBasketWidget?.({
            ownerId: targetOwner,
            itemId: equippedTarget?.id ?? null,
            slotId: targetSlotId,
          });
          finish("success");
          return;
        }
      }

      if (sourceEquipmentSlotId) {
        const moveEquipped =
          typeof moveEquippedItemToSlot === "function"
            ? moveEquippedItemToSlot
            : null;
        const result = moveEquipped
          ? moveEquipped({
              fromOwnerId: sourceOwner,
              toOwnerId: targetOwner,
              fromSlotId: sourceEquipmentSlotId,
              toSlotId: targetSlotId,
            })
          : { ok: false, reason: "noMoveEquippedItemToSlotHandler" };

        if (!result?.ok) {
          flashWindowError(targetOwner);
          flashItemError(view, sourceOwner);
          finish("fail");
          return;
        }

        rebuildWindow(sourceOwner);
        if (targetOwner !== sourceOwner) rebuildWindow(targetOwner);
        if (item?.kind === "basket" && result?.result === "noChange") {
          openBasketWidget?.({
            ownerId: targetOwner,
            itemId: item.id,
            slotId: targetSlotId,
          });
        }
        finish("success");
        return;
      }

      const equip =
        typeof equipItemToSlot === "function" ? equipItemToSlot : null;
      const result = equip
        ? equip({
            fromOwnerId: sourceOwner,
            toOwnerId: targetOwner,
            itemId: item.id,
            slotId: targetSlotId,
          })
        : { ok: false, reason: "noEquipItemToSlotHandler" };

      if (!result?.ok) {
        flashWindowError(targetOwner);
        flashItemError(view, sourceOwner);
        finish("fail");
        return;
      }

      rebuildWindow(sourceOwner);
      if (targetOwner !== sourceOwner) rebuildWindow(targetOwner);
      finish("success");
      return;
    }

    const dropTargetOwner = resolveDropTargetOwnerId(g);

    // Process/widget drop targets should win over inventory window hitboxes.
    if (dropTargetOwner != null) {
      const targetOwner = dropTargetOwner;
      const isProcessDropbox = isAnyDropboxOwnerId(targetOwner);
      if (targetOwner === sourceOwner) {
        revealWindow(targetOwner);
        finish();
        return;
      }

      const targetInv = getInventoryForOwner(targetOwner);
      const preview =
        typeof getInventoryPreview === "function"
          ? getInventoryPreview(targetOwner)
          : null;

      const placement = isProcessDropbox
        ? { gx: 0, gy: 0 }
        : findItemPlacement(targetInv, item, preview, null);
      const stackOnlyTransferOk =
        !isProcessDropbox &&
        canAutostackItemPreview(targetInv, item, preview, null);
      if (!placement && !stackOnlyTransferOk) {
        if (isProcessDropbox) {
          flashDropTargetError?.(targetOwner);
        } else {
          revealWindow(targetOwner);
          flashWindowError(targetOwner);
        }
        flashItemError(view, sourceOwner);
        globalThis.__DBG_DROP_LAST__ = {
          phase: "externalTargetPlacementBlocked",
          sourceOwner,
          targetOwner,
          isProcessDropbox,
          itemId: item?.id ?? null,
          itemKind: item?.kind ?? null,
          pointer: g ? { x: g.x, y: g.y } : null,
        };
        finish("fail");
        return;
      }

      const handler =
        sourceEquipmentSlotId
          ? typeof moveEquippedItemToInventory === "function"
            ? moveEquippedItemToInventory
            : null
          : typeof moveItemBetweenOwners === "function"
            ? moveItemBetweenOwners
            : null;

      const result = handler
        ? sourceEquipmentSlotId
          ? handler({
              fromOwnerId: sourceOwner,
              toOwnerId: targetOwner,
              slotId: sourceEquipmentSlotId,
              targetGX: placement?.gx ?? 0,
              targetGY: placement?.gy ?? 0,
            })
          : handler({
              fromOwnerId: sourceOwner,
              toOwnerId: targetOwner,
              itemId: item.id,
              targetGX: placement?.gx ?? 0,
              targetGY: placement?.gy ?? 0,
              viaProcessDropbox: isProcessDropbox,
            })
        : {
            ok: false,
            reason: sourceEquipmentSlotId
              ? "noMoveEquippedItemToInventoryHandler"
              : "noMoveItemBetweenOwnersHandler",
          };

      globalThis.__DBG_DROP_LAST__ = {
        phase: "externalTargetMoveResult",
        sourceOwner,
        targetOwner,
        isProcessDropbox,
        itemId: item?.id ?? null,
        itemKind: item?.kind ?? null,
        pointer: g ? { x: g.x, y: g.y } : null,
        result,
      };

      if (!result.ok) {
        console.warn("inventoryMove failed:", result.reason, result);
        if (isProcessDropbox) {
          flashDropTargetError?.(targetOwner);
        } else {
          revealWindow(targetOwner);
          flashWindowError(targetOwner);
        }
        flashItemError(view, sourceOwner);
        finish("fail");
        return;
      }

      rebuildWindow(sourceOwner);
      rebuildWindow(targetOwner);
      finish("success");
      return;
    }

    const win = findWindowAt(g);
    if (!win) {
      flashItemError(view, sourceOwner);
      console.warn("inventoryMove failed: noDropTargetDetected", {
        sourceOwner,
        itemId: item?.id ?? null,
        globalPos: g ? { x: g.x, y: g.y } : null,
      });
      globalThis.__DBG_DROP_LAST__ = {
        phase: "noDropTargetDetected",
        sourceOwner,
        itemId: item?.id ?? null,
        itemKind: item?.kind ?? null,
        pointer: g ? { x: g.x, y: g.y } : null,
      };
      finish("fail");
      return;
    }

    const targetOwner = win.ownerId;
    let { gx, gy } = getGridCoords(win, g);

    gx -= dragItem.cellOffsetGX || 0;
    gy -= dragItem.cellOffsetGY || 0;


    const returnToSource =
      view?.sourceOwnerId != null &&
      targetOwner === view.sourceOwnerId;

    if (returnToSource) {
      const cancel =
        typeof cancelItemTransfer === "function"
          ? cancelItemTransfer
          : null;
      const result = cancel
        ? cancel({ itemId: item.id })
        : { ok: false, reason: "noCancelItemTransferHandler" };
      if (!result.ok) {
        console.warn("cancelItemTransfer failed:", result.reason, result);
        flashItemError(view, sourceOwner);
        finish("fail");
        return;
      }
      rebuildWindow(targetOwner);
      if (dragItem.ownerId !== targetOwner) {
        rebuildWindow(dragItem.ownerId);
      }
      finish();
      return;
    }

    const touchLikePointer =
      dragItem.pointerType === "touch" || dragItem.pointerType === "pen";
    if (touchLikePointer && !sourceEquipmentSlotId) {
      const stackTarget = findTouchStackTargetAt(win, g, item);
      if (stackTarget) {
        gx = stackTarget.gx;
        gy = stackTarget.gy;
      }
    }

    if (sourceEquipmentSlotId) {
      const targetInv = getInventoryForOwner(targetOwner);
      const preview =
        typeof getInventoryPreview === "function"
          ? getInventoryPreview(targetOwner)
          : null;
      let placeGX = gx;
      let placeGY = gy;
      const canPlaceAtCursor =
        !isPreviewAreaReserved(item, gx, gy, preview, item?.id) &&
        canPlaceItemPreview(targetInv, item, gx, gy, preview, item?.id);
      if (!canPlaceAtCursor) {
        const fallback = findItemPlacement(targetInv, item, preview, item?.id);
        if (!fallback) {
          flashItemError(view, sourceOwner);
          finish("fail");
          return;
        }
        placeGX = fallback.gx;
        placeGY = fallback.gy;
      }

      const moveEquipped =
        typeof moveEquippedItemToInventory === "function"
          ? moveEquippedItemToInventory
          : null;
      const result = moveEquipped
        ? moveEquipped({
            fromOwnerId: sourceOwner,
            toOwnerId: targetOwner,
            slotId: sourceEquipmentSlotId,
            targetGX: placeGX,
            targetGY: placeGY,
          })
        : { ok: false, reason: "noMoveEquippedItemToInventoryHandler" };

      if (!result?.ok) {
        flashItemError(view, sourceOwner);
        finish("fail");
        return;
      }

      rebuildWindow(sourceOwner);
      if (targetOwner !== sourceOwner) rebuildWindow(targetOwner);
      finish("success");
      return;
    }

    const isCrossOwner = sourceOwner !== targetOwner;
    const targetInv = getInventoryForOwner(targetOwner);
    const preview =
      typeof getInventoryPreview === "function"
        ? getInventoryPreview(targetOwner)
        : null;


    const isSameOwner = sourceOwner === targetOwner;
    if (isSameOwner && targetInv && typeof hasItemTransferIntent === "function") {
      const hidden =
        preview?.hiddenItemIds instanceof Set
          ? preview.hiddenItemIds
          : new Set(preview?.hiddenItemIds || []);
      if (gx >= 0 && gy >= 0 && gx < targetInv.cols && gy < targetInv.rows) {
        const idx = gy * targetInv.cols + gx;
        const baseId = targetInv.grid?.[idx] ?? null;
        if (baseId != null && baseId !== item.id && !hidden.has(baseId)) {
          if (hasItemTransferIntent(item.id) || hasItemTransferIntent(baseId)) {
            flashItemError(view, sourceOwner);
            finish("fail");
            return;
          }
        }
      }
    }

    if (isPreviewAreaReserved(item, gx, gy, preview, item?.id)) {
      flashItemError(view, sourceOwner);
      finish("fail");
      return;
    }

    if (isCrossOwner) {
      const canPlaceCrossOwner = canPlaceItemPreview(
        targetInv,
        item,
        gx,
        gy,
        preview,
        item?.id
      );
      if (
        !canPlaceCrossOwner &&
        !canAutostackItemPreview(targetInv, item, preview, item?.id)
      ) {
        flashItemError(view, sourceOwner);
        finish("fail");
        return;
      }
    }

    const handler =
      typeof moveItemBetweenOwners === "function"
        ? moveItemBetweenOwners
        : null;

    const result = handler
      ? handler({
          fromOwnerId: sourceOwner,
          toOwnerId: targetOwner,
          itemId: item.id,
          targetGX: gx,
          targetGY: gy,
        })
      : { ok: false, reason: "noMoveItemBetweenOwnersHandler" };

    if (!result.ok) {
      console.warn("inventoryMove failed:", result.reason, result);
      flashItemError(view, sourceOwner);
      finish("fail");
      return;
    }

    rebuildWindow(sourceOwner);
    if (targetOwner !== sourceOwner) rebuildWindow(targetOwner);
    finish("success");
  }

  function findWindowAt(globalPos) {
    const ordered = Array.from(windows.values()).sort((a, b) => {
      const zDelta = (b?.container?.zIndex ?? 0) - (a?.container?.zIndex ?? 0);
      if (zDelta !== 0) return zDelta;
      const bIndex = b?.container?.parent?.getChildIndex?.(b.container) ?? 0;
      const aIndex = a?.container?.parent?.getChildIndex?.(a.container) ?? 0;
      return bIndex - aIndex;
    });
    for (const win of ordered) {
      const c = win.container;
      if (!c.visible) continue;
      const bounds = c.getBounds?.();
      if (!bounds) continue;

      if (
        globalPos.x >= bounds.x &&
        globalPos.x <= bounds.x + bounds.width &&
        globalPos.y >= bounds.y &&
        globalPos.y <= bounds.y + bounds.height
      ) {
        return win;
      }
    }
    return null;
  }

  function resolveExternalDropTargetSpec(globalPos) {
    if (!globalPos) return null;
    if (typeof getDropTargetOwnerAt !== "function") return null;
    const dropTarget = normalizeDropTargetSpec(getDropTargetOwnerAt(globalPos));
    const ownerId = dropTarget?.ownerId ?? null;
    if (ownerId == null) return null;
    if (isAnyDropboxOwnerId(ownerId)) return dropTarget;
    if (findWindowAt(globalPos)) return null;
    return dropTarget;
  }

  function findBinAt(globalPos) {
    for (const win of windows.values()) {
      const bin = win?.bin?.container;
      if (!bin || !win.container?.visible) continue;
      const bounds = bin.getBounds();
      if (
        globalPos.x >= bounds.x &&
        globalPos.x <= bounds.x + bounds.width &&
        globalPos.y >= bounds.y &&
        globalPos.y <= bounds.y + bounds.height
      ) {
        return win;
      }
    }
    return null;
  }

  function findEquipmentSlotAt(globalPos) {
    if (typeof getExternalEquipmentSlotAt === "function") {
      const externalMatch = getExternalEquipmentSlotAt(globalPos);
      if (externalMatch?.ownerId != null && externalMatch?.slotId) {
        return {
          win: externalMatch.win ?? null,
          ownerId: externalMatch.ownerId,
          slotId: externalMatch.slotId,
        };
      }
    }
    for (const win of windows.values()) {
      if (!win?.container?.visible) continue;
      const equip = win.equipmentPanel;
      if (!equip?.slots) continue;
      const sectionState = ensureSectionState(win);
      if (sectionState.equipment === false) continue;
      if (equip.container?.visible === false) continue;
      for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
        const slot = equip.slots?.[slotId]?.slot;
        if (!slot) continue;
        const bounds = slot.getBounds();
        if (
          globalPos.x >= bounds.x &&
          globalPos.x <= bounds.x + bounds.width &&
          globalPos.y >= bounds.y &&
          globalPos.y <= bounds.y + bounds.height
        ) {
          return { win, ownerId: win.ownerId, slotId };
        }
      }
    }
    return null;
  }

  function getGridCoords(win, globalPos) {
    const local = win.body.toLocal(globalPos);
    return {
      gx: Math.floor(local.x / win.cellSize),
      gy: Math.floor(local.y / win.cellSize),
    };
  }

  function getTouchStackTargetMarginPx(win) {
    const cellSize = Number.isFinite(win?.cellSize)
      ? Math.max(1, Math.floor(win.cellSize))
      : DEFAULT_CELL_SIZE;
    return Math.min(cellSize * 0.3, TOUCH_STACK_TARGET_MARGIN_MAX_PX);
  }

  function isPointInsideExpandedBounds(globalPos, bounds, marginPx) {
    if (!globalPos || !bounds) return false;
    return (
      globalPos.x >= bounds.x - marginPx &&
      globalPos.x <= bounds.x + bounds.width + marginPx &&
      globalPos.y >= bounds.y - marginPx &&
      globalPos.y <= bounds.y + bounds.height + marginPx
    );
  }

  function findTouchStackTargetAt(win, globalPos, sourceItem) {
    if (!win || !globalPos || !sourceItem) return null;
    const marginPx = getTouchStackTargetMarginPx(win);
    let best = null;
    for (const entry of win.itemViews || []) {
      const candidateItem = entry?.item ?? entry?.view?.itemData ?? null;
      if (!candidateItem || candidateItem.id === sourceItem.id) continue;
      if (!canStackItems(candidateItem, sourceItem)) continue;
      const candidateView = entry?.view;
      if (!candidateView || typeof candidateView.getBounds !== "function") continue;
      const bounds = candidateView.getBounds();
      if (!isPointInsideExpandedBounds(globalPos, bounds, marginPx)) continue;
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const dx = globalPos.x - centerX;
      const dy = globalPos.y - centerY;
      const next = {
        item: candidateItem,
        gx: candidateItem.gridX,
        gy: candidateItem.gridY,
        distSq: dx * dx + dy * dy,
      };
      if (!best) {
        best = next;
        continue;
      }
      if (next.distSq !== best.distSq) {
        if (next.distSq < best.distSq) best = next;
        continue;
      }
      const nextY = Math.floor(candidateItem.gridY ?? 0);
      const bestY = Math.floor(best.item?.gridY ?? 0);
      if (nextY !== bestY) {
        if (nextY < bestY) best = next;
        continue;
      }
      const nextX = Math.floor(candidateItem.gridX ?? 0);
      const bestX = Math.floor(best.item?.gridX ?? 0);
      if (nextX !== bestX) {
        if (nextX < bestX) best = next;
        continue;
      }
      const nextId = Math.floor(candidateItem.id ?? 0);
      const bestId = Math.floor(best.item?.id ?? 0);
      if (nextId < bestId) best = next;
    }
    return best;
  }

  function previewCoversCell(item, gx, gy) {
    if (!item) return false;
    return (
      gx >= item.gridX &&
      gx < item.gridX + item.width &&
      gy >= item.gridY &&
      gy < item.gridY + item.height
    );
  }

  function isPreviewAreaReserved(item, gx, gy, preview, ignoreItemId) {
    if (!preview || !item) return false;
    const overlays = Array.isArray(preview.overlayItems)
      ? preview.overlayItems
      : [];
    const ghosts = Array.isArray(preview.ghostItems)
      ? preview.ghostItems
      : [];
    if (!overlays.length && !ghosts.length) return false;

    const width = Math.max(1, Math.floor(item.width ?? 1));
    const height = Math.max(1, Math.floor(item.height ?? 1));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cellX = gx + x;
        const cellY = gy + y;
        for (const block of overlays) {
          if (!block) continue;
          if (ignoreItemId != null && block.id === ignoreItemId) continue;
          if (previewCoversCell(block, cellX, cellY)) return true;
        }
        for (const block of ghosts) {
          if (!block) continue;
          if (ignoreItemId != null && block.id === ignoreItemId) continue;
          if (previewCoversCell(block, cellX, cellY)) return true;
        }
      }
    }
    return false;
  }

  function isCellBlocked(inv, gx, gy, preview, ignoreItemId) {
    if (!inv) return true;
    if (gx < 0 || gy < 0 || gx >= inv.cols || gy >= inv.rows) return true;

    const hidden =
      preview?.hiddenItemIds instanceof Set
        ? preview.hiddenItemIds
        : new Set(preview?.hiddenItemIds || []);

    const idx = gy * inv.cols + gx;
    const baseId = inv.grid[idx];
    if (baseId != null && baseId !== ignoreItemId && !hidden.has(baseId))
      return true;

    if (preview?.overlayItems?.length) {
      for (const item of preview.overlayItems) {
        if (item?.id === ignoreItemId) continue;
        if (previewCoversCell(item, gx, gy)) return true;
      }
    }

    if (preview?.ghostItems?.length) {
      for (const item of preview.ghostItems) {
        if (item?.id === ignoreItemId) continue;
        if (previewCoversCell(item, gx, gy)) return true;
      }
    }

    return false;
  }

  function canPlaceItemPreview(inv, item, gx, gy, preview, ignoreItemId) {
    if (!inv || !item) return false;
    if (gx < 0 || gy < 0) return false;
    if (gx + item.width > inv.cols) return false;
    if (gy + item.height > inv.rows) return false;

    for (let y = 0; y < item.height; y++) {
      for (let x = 0; x < item.width; x++) {
        if (isCellBlocked(inv, gx + x, gy + y, preview, ignoreItemId))
          return false;
      }
    }
    return true;
  }

  function canAutostackItemPreview(inv, item, preview, ignoreItemId) {
    if (!inv || !item) return false;
    const hidden =
      preview?.hiddenItemIds instanceof Set
        ? preview.hiddenItemIds
        : new Set(preview?.hiddenItemIds || []);

    const candidates = [];
    for (const candidate of inv.items || []) {
      if (!candidate || candidate.id === ignoreItemId || hidden.has(candidate.id)) continue;
      candidates.push(candidate);
    }
    for (const candidate of preview?.overlayItems || []) {
      if (!candidate || candidate.id === ignoreItemId) continue;
      candidates.push(candidate);
    }

    for (const candidate of candidates) {
      if (!canStackItems(candidate, item)) continue;
      const maxStack = Math.max(1, Math.floor(getItemMaxStack(candidate) || 1));
      const quantity = Math.max(0, Math.floor(candidate.quantity ?? 0));
      if (quantity < maxStack) return true;
    }
    return false;
  }

  function findSplitPlacement(inv, item, preview) {
    if (!inv || !item) return null;
    for (let gy = 0; gy <= inv.rows - item.height; gy++) {
      for (let gx = 0; gx <= inv.cols - item.width; gx++) {
        if (canPlaceItemPreview(inv, item, gx, gy, preview, null)) {
          return { gx, gy };
        }
      }
    }
    return null;
  }

  function findItemPlacement(inv, item, preview, ignoreItemId) {
    if (!inv || !item) return null;
    for (let gy = 0; gy <= inv.rows - item.height; gy++) {
      for (let gx = 0; gx <= inv.cols - item.width; gx++) {
        if (canPlaceItemPreview(inv, item, gx, gy, preview, ignoreItemId)) {
          return { gx, gy };
        }
      }
    }
    return null;
  }

  function getItemDisplayName(item) {
    if (!item) return "Item";
    const def = itemDefs?.[item.kind];
    return def?.name || item.kind || "Item";
  }

  function buildItemDragGhostSpec(globalPos) {
    if (!dragItem.active || !dragItem.item) return null;

    const sourceOwner =
      dragItem.sourceOwnerOverride != null
        ? dragItem.sourceOwnerOverride
        : dragItem.ownerId;

    const itemLabel = getItemDisplayName(dragItem.item);

    let targetOwner = null;
    let targetGX = null;
    let targetGY = null;
    let targetSlotId = null;

    const slotDrop = findEquipmentSlotAt(globalPos);
    if (slotDrop) {
      targetOwner = slotDrop.ownerId;
      targetSlotId = slotDrop.slotId;
    } else {
      const win = findWindowAt(globalPos);
      if (win) {
        targetOwner = win.ownerId;
        let { gx, gy } = getGridCoords(win, globalPos);
        gx -= dragItem.cellOffsetGX || 0;
        gy -= dragItem.cellOffsetGY || 0;
        targetGX = gx;
        targetGY = gy;
      }
    }
    if (targetOwner == null) {
      targetOwner = resolveDropTargetOwnerId(globalPos);
      if (targetOwner != null) {
        const targetInv = getInventoryForOwner(targetOwner);
        const preview =
          typeof getInventoryPreview === "function"
            ? getInventoryPreview(targetOwner)
            : null;
        const placement = findItemPlacement(
          targetInv,
          dragItem.item,
          preview,
          null
        );
        if (placement) {
          targetGX = placement.gx;
          targetGY = placement.gy;
        }
      }
    }

    const targetLabel =
      targetOwner != null ? getOwnerLabel?.(targetOwner) : null;

    const slotLabel =
      targetSlotId != null
        ? LEADER_EQUIPMENT_SLOT_LABELS[targetSlotId] || targetSlotId
        : null;
    const description = targetLabel
      ? slotLabel
        ? `${itemLabel} > ${targetLabel} (${slotLabel})`
        : `${itemLabel} > ${targetLabel}`
      : itemLabel;
    const intentId =
      dragItem?.item?.id != null ? `item:${dragItem.item.id}` : null;

    let cost = 0;
    if (
      targetSlotId == null &&
      targetOwner != null &&
      targetOwner !== sourceOwner &&
      !isAnyDropboxOwnerId(targetOwner) &&
      typeof getItemTransferAffordability === "function"
    ) {
      const aff = getItemTransferAffordability({
        fromOwnerId: sourceOwner,
        toOwnerId: targetOwner,
        itemId: dragItem.item.id,
        targetGX: targetGX ?? 0,
        targetGY: targetGY ?? 0,
      });
      if (Number.isFinite(aff?.cost)) cost = Math.floor(aff.cost);
    }

    return { description, cost, intentId };
  }

  function updateItemDragGhost(globalPos) {
    if (typeof setDragGhost !== "function") return;
    const spec = buildItemDragGhostSpec(globalPos);
    if (!spec) return;
    setDragGhost(spec);
  }

  // ---------------------------------------------------------------------------
  // SPLIT DIALOG
  // ---------------------------------------------------------------------------

  function openSplitDialog(globalPos, ownerId, item) {
    if (item.quantity <= 1) return;
    requestPauseForAction?.();

    uiBlocked = true;
    closeSplitDialog();

    const dlg = new PIXI.Container();
    dlg.zIndex = 99999;
    dragLayer.addChild(dlg);

    const panelW = 160;
    const panelH = 90;

    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.85);
    bg.drawRoundedRect(0, 0, panelW, panelH, 6);
    bg.endFill();
    dlg.addChild(bg);

    const title = new PIXI.Text("Split Stack", {
      fill: 0xffffff,
      fontSize: 13,
    });
    title.x = 10;
    title.y = 6;
    dlg.addChild(title);

    const maxDefault = Math.max(1, item.quantity - 1);
    const half = Math.max(1, Math.floor(item.quantity / 2));
    const amt = { value: Math.min(half, maxDefault) };

    const amtText = new PIXI.Text(String(amt.value), {
      fill: 0xffffaa,
      fontSize: 16,
    });
    amtText.x = panelW / 2 - amtText.width / 2;
    amtText.y = 32;
    dlg.addChild(amtText);

    function updateAmt() {
      amtText.text = String(amt.value);
      amtText.x = panelW / 2 - amtText.width / 2;
    }

    updateAmt();

    const minus = new PIXI.Text("–", {
      fill: 0xffffff,
      fontSize: 16,
    });
    minus.x = 20;
    minus.y = 32;
    minus.eventMode = "static";
    minus.cursor = "pointer";
    minus.on("pointertap", () => {
      if (amt.value > 1) {
        amt.value--;
        updateAmt();
      }
    });
    dlg.addChild(minus);

    const plus = new PIXI.Text("+", {
      fill: 0xffffff,
      fontSize: 16,
    });
    plus.x = panelW - 30;
    plus.y = 32;
    plus.eventMode = "static";
    plus.cursor = "pointer";
    plus.on("pointertap", () => {
      if (amt.value < item.quantity - 1) {
        amt.value++;
        updateAmt();
      }
    });
    dlg.addChild(plus);

    const okBtn = new PIXI.Graphics();
    okBtn.beginFill(INVENTORY_BUTTON_BG);
    okBtn.drawRoundedRect(0, 0, 50, 24, 4);
    okBtn.endFill();
    okBtn.x = panelW / 2 - 25;
    okBtn.y = 60;
    okBtn.eventMode = "static";
    okBtn.cursor = "pointer";
    okBtn.on("pointertap", () => confirmSplit(ownerId, item, amt.value));
    dlg.addChild(okBtn);

    const okText = new PIXI.Text("OK", {
      fill: 0xffffff,
      fontSize: 12,
    });
    okText.x = okBtn.x + 15;
    okText.y = okBtn.y + 4;
    dlg.addChild(okText);

    setDisplayObjectScreenPosition(dlg, globalPos.x, globalPos.y);
    dlg.ownerId = ownerId;

    activeSplit = dlg;

    okText.eventMode = "none";

    interactionStage.on("pointerdown", onSplitOutsideClick);
  }

  function confirmSplit(ownerId, item, amount) {
    const handler =
      typeof splitStackAndPlace === "function" ? splitStackAndPlace : null;

    const inv = getInventoryForOwner(ownerId);
    const preview =
      typeof getInventoryPreview === "function"
        ? getInventoryPreview(ownerId)
        : null;
    const target = findSplitPlacement(inv, item, preview);
    if (!target) {
      console.warn("inventorySplit blocked by preview");
      flashItemError(dragItem.view, ownerId);
      if (tooltipView) tooltipView.hide?.();
      closeSplitDialog();
      return;
    }

    const result = handler
      ? handler({
          ownerId,
          itemId: item.id,
          amount,
          targetGX: target.gx,
          targetGY: target.gy,
        })
      : { ok: false, reason: "noSplitStackAndPlaceHandler" };

    if (!result.ok) {
      console.warn("inventorySplit failed:", result.reason, result);
      flashItemError(dragItem.view, ownerId);
      if (tooltipView) tooltipView.hide?.();
      closeSplitDialog();
      return;
    }

    rebuildWindow(ownerId);
    closeSplitDialog();
  }

  function onSplitOutsideClick(ev) {
    if (!activeSplit) return;

    const dlg = activeSplit;
    const g = ev.data.global;

    if (
      g.x < dlg.x ||
      g.x > dlg.x + dlg.width ||
      g.y < dlg.y ||
      g.y > dlg.y + dlg.height
    ) {
      closeSplitDialog();
    }
  }

  function closeSplitDialog() {
    if (activeSplit?.parent) activeSplit.parent.removeChild(activeSplit);
    activeSplit = null;
    interactionStage.off("pointerdown", onSplitOutsideClick);
    uiBlocked = false;
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  function init() {
    if (inputElement?.addEventListener) {
      inputElement.addEventListener(
        "pointerdown",
        (ev) => {
          const stagePoint = toStageCoordsFromClient(ev?.clientX, ev?.clientY);
          if (!stagePoint) return;
          tryCommitActiveBuildAtGlobalPos(stagePoint, ev);
        },
        true
      );
    }

    interactionStage.on("pointermove", (ev) => {
      const p = ev?.data?.global;
      if (!p) return;
      lastPointerPos = { x: p.x, y: p.y };
      if (!activeBuildSpec) return;
      updateBuildGhostContent(activeBuildSpec);
      pushBuildPlacementPreview();
      if (buildGhost) {
        buildGhost.container.visible = true;
        updateBuildGhostPosition(lastPointerPos);
      }
    });
  }

  function update(dt) {
    buildingManagerView.update();
    updateApDragOverlays(dt);
    updateConsumePrompt(dt);
    pushBuildPlacementPreview();
    if (dragItem.active || activeSplit || flashingOwners.size > 0) {
      return;
    }

    if (activeBuildSpec) {
      updateBuildGhostContent(activeBuildSpec);
      if (buildGhost) {
        const { width: screenWidth, height: screenHeight } = getScreenSize();
        const pos = lastPointerPos || { x: screenWidth / 2, y: screenHeight / 2 };
        buildGhost.container.visible = true;
        updateBuildGhostPosition(pos);
      }
    } else if (buildGhost) {
      buildGhost.container.visible = false;
    }

    const previewVersion =
      typeof getPreviewVersion === "function" ? getPreviewVersion() : null;
    const previewChanged =
      previewVersion != null && previewVersion !== lastPreviewVersion;
    if (previewChanged) lastPreviewVersion = previewVersion;

    for (const [ownerId, win] of windows.entries()) {
      const scaleChanged = applyWindowScale(win);
      if (scaleChanged) {
        rebuildWindow(ownerId);
        const displaySize = getWindowDisplaySize(win);
        const { width: screenWidth, height: screenHeight } = getScreenSize();
        const current = getDisplayObjectScreenPosition(win.container);
        setDisplayObjectScreenPosition(
          win.container,
          Math.max(10, Math.min(screenWidth - displaySize.width - 10, current.x)),
          Math.max(
            10,
            Math.min(screenHeight - displaySize.height - 10, current.y)
          )
        );
      }
      syncWindowOwnerVisibility(win);
      if (!win.container.visible) continue;

      const inv = getInventoryForOwner(ownerId);
      if (!inv) {
        hideWindow(ownerId);
        continue;
      }

      const v = inv.version ?? 0;
      const last = lastVersionByOwner.get(ownerId) ?? -1;

      if (v !== last || previewChanged) {
        rebuildWindow(ownerId);
      } else {
        updateEquipmentPanel(win);
        updateLeaderPanel(win);
      }
      if (win.hovered && !win.pinned && win.hoverAnchor) {
        positionWindowFromHoverAnchor(win, win.hoverAnchor);
      }
    }

    const focusIntent =
      typeof getFocusIntent === "function" ? getFocusIntent() : null;
    if (focusIntent !== focusIntentCache) {
      focusIntentCache = focusIntent;
    }
    applyFocusVisibility(focusIntent);
  }

  function getOccludingScreenRects() {
    const rects = [];
    for (const win of windows.values()) {
      win.solidHitArea?.refresh?.();
      const container = win?.container;
      if (!container?.visible || typeof container.getBounds !== "function") continue;
      const bounds = container.getBounds();
      if (bounds) rects.push(bounds);
    }
    const buildingManagerRect = buildingManagerView?.getScreenRect?.();
    if (buildingManagerRect) rects.push(buildingManagerRect);
    return rects;
  }

  return {
    init,
    update,

    showOnHover,
    hideOnHoverOut,
    hideWindow,
    togglePinned,
    revealWindow,
    beginDragItemFromOwner,
    beginDragExternalEquippedItem: ({
      ownerId,
      item,
      sourceEquipmentSlotId,
      view,
      globalPos,
      pointerType = null,
    }) => {
      if (ownerId == null || !item || !sourceEquipmentSlotId || !globalPos) {
        return { ok: false, reason: "badArgs" };
      }
      if (uiBlocked || dragItem.active || dragWindow.active || activeSplit) {
        return { ok: false, reason: "busy" };
      }
      const win = ensureWindow(ownerId);
      if (!win) return { ok: false, reason: "noWindow" };
      beginItemDragAtGlobal(
        win,
        item,
        {
          ...view,
          ownerId,
          sourceEquipmentSlotId,
          sourceOwnerId: null,
        },
        globalPos,
        { pointerType }
      );
      syncExternalItemDragAffordances(globalPos);
      return { ok: true };
    },
    flashWindowError,
    getItemTooltipSpec: (item, ownerId) => makeItemTooltipSpec(item, ownerId),
    getDebugState: () => {
      const visibleWindows = [];
      for (const win of windows.values()) {
        if (!win?.container?.visible) continue;
        visibleWindows.push({
          ownerId: win.ownerId ?? null,
          hovered: win.hovered === true,
          pinned: win.pinned === true,
          x: Number(win.container.x) || 0,
          y: Number(win.container.y) || 0,
          uiScale: Number.isFinite(win.uiScale) ? win.uiScale : 1,
          width: Number(win.panelWidth) || 0,
          height: Number(win.panelHeight) || 0,
          hoverAnchor: summarizeResolvedAnchor(win.hoverAnchor),
        });
      }
      visibleWindows.sort((a, b) => {
        if (a.hovered !== b.hovered) return a.hovered ? -1 : 1;
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return String(a.ownerId).localeCompare(String(b.ownerId));
      });
      return { visibleWindows };
    },
    openBuildingManagerForOwner: (ownerId) => {
      if (ownerId == null) return { ok: false, reason: "noOwner" };
      const revealRes = revealWindow(ownerId, { pinned: true });
      if (revealRes?.ok === false) return revealRes;
      buildingManagerView.open({ ownerId });
      return { ok: true };
    },

    rebuildWindow,
    ensureWindow,
    invalidateAllWindowVersions: () => {
      lastVersionByOwner.clear();
    },

    windows,
    getOccludingScreenRects,
  };
}

