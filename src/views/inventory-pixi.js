//
// inventory-pixi.js
// Inventory UI system (Pixi).
// - Renders inventories for generic "owners" (hub structures, characters, etc.)
// - Handles drag/drop + stack splitting.
// - Does NOT contain game rules; delegates legality + mutation to the model.
//


import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { pawnDefs } from "../defs/gamepieces/pawn-defs.js";
import { itemSystemDefs } from "../defs/gamesystems/item-system-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import {
  LEADER_EQUIPMENT_SLOT_LABELS,
  LEADER_EQUIPMENT_SLOT_ORDER,
} from "../defs/gamesystems/equipment-slot-defs.js";
import {
  PRESTIGE_COST_PER_FOLLOWER,
  HUNGER_THRESHOLD,
  SECONDS_BELOW_HUNGER_THRESHOLD,
} from "../defs/gamesettings/gamerules-defs.js";
import { INTENT_AP_COSTS } from "../defs/gamesettings/action-costs-defs.js";
import {
  HUB_COLS,
  HUB_COL_GAP,
  HUB_STRUCTURE_WIDTH,
  HUB_STRUCTURE_HEIGHT,
  HUB_STRUCTURE_ROW_Y,
  getHubColumnCenterX,
} from "./layout-pixi.js";
import { createWindowHeader } from "./ui-helpers/window-header.js";



const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

const HEADER_HEIGHT = 24;
const INNER_PADDING = 8;

const DEFAULT_COLS = 5;
const DEFAULT_ROWS = 3;
const DEFAULT_CELL_SIZE = 40;
const BIN_CELL_SIZE = 2;
const BIN_PAD = 6;
const ITEM_TIER_BORDER_WIDTH = 2;
const ITEM_TIER_BORDER_COLORS = {
  bronze: 0x8b6a3f,
  silver: 0xbfc9d9,
  gold: 0xf2d16b,
  diamond: 0x7fd0ff,
  default: 0x333333,
};
const ITEM_GLYPH_COLOR = 0xffffff; //0xffffff
const ITEM_GLYPH_SHADOW = 0x111111;
const ITEM_GLYPH_ALPHA = 0.9;
const EQUIP_PANEL_HEIGHT = 180;
const EQUIP_PANEL_PADDING = 8;
const EQUIP_SLOT_SIZE = 42;
const EQUIP_SLOT_BG = 0x161a2a;
const EQUIP_SLOT_BG_OCCUPIED = 0x26334a;
const EQUIP_SLOT_STROKE = 0x44506e;
const EQUIP_SLOT_STROKE_ACTIVE = 0x6f8dc6;
const LEADER_PANEL_HEIGHT = 86;
const LEADER_PANEL_PADDING = 6;
const BUILD_PANEL_HEADER_HEIGHT = 18;
const BUILD_PANEL_ROW_HEIGHT = 24;
const BUILD_PANEL_ROW_GAP = 4;
const BUILD_PANEL_PADDING = 6;
const BUILD_PANEL_HINT_HEIGHT = 12;
const BUILD_PANEL_GAP = 8;
const BUILD_PANEL_BG = 0x202436;
const BUILD_PANEL_ROW_BG = 0x2a2f45;
const BUILD_PANEL_ROW_BG_ACTIVE = 0x303a55;
const BUILD_PANEL_TEXT = 0xffffff;
const BUILD_PANEL_TEXT_MUTED = 0xb4bfd6;
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

function getItemTierBorderColor(item, def) {
  const tier = item?.tier ?? def?.defaultTier ?? null;
  return ITEM_TIER_BORDER_COLORS[tier] ?? ITEM_TIER_BORDER_COLORS.default;
}

export function createInventoryView({
  layer,
  dragLayer,
  getOwnerLabel,
  getInventoryForOwner,
  canShowHoverUI,
  tooltipView,
  getState,
  getPreviewVersion,
  getInventoryPreview,
  getFocusIntent,
  getExternalFocusOwners,
  onGhostClick,
  hasItemTransferIntent,
  equipItemToSlot,
  moveEquippedItemToInventory,
  moveEquippedItemToSlot,
  getItemTransferAffordability,
  getDropTargetOwnerAt,
  setDragGhost,
  resolveDragGhost,
  actionPlanner,

  // Stage 6: injected handlers (timeline-aware in ui-root-pixi.js)
  moveItemBetweenOwners,
  splitStackAndPlace,
  cancelItemTransfer,
  adjustFollowerCount,
  queueActionWhenPaused,
  requestPauseForAction,
  setApDragWarning,
  discardItemFromOwner,
  flashActionGhost,
}) {
  const stage = layer.parent;

  const windows = new Map();
  let uiBlocked = false;
  let lastPreviewVersion = null;
  let focusIntentCache = null;
  let activeBuildSpec = null;
  let lastPointerPos = null;
  let buildGhost = null;
  let buildGhostDefId = null;

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
  };

  // Active split modal
  let activeSplit = null;

  // ---------------------------------------------------------------------------
  // Leader/follower helpers
  // ---------------------------------------------------------------------------

  function getStateSafe() {
    return typeof getState === "function" ? getState() : null;
  }

  function getLeaderForOwner(ownerId) {
    const state = getStateSafe();
    const chars = state?.characters;
    if (!Array.isArray(chars)) return null;
    const ch = chars.find((c) => c?.id === ownerId);
    return ch && ch.role === "leader" ? ch : null;
  }

  function getFollowersForLeader(state, leaderId) {
    if (!state || leaderId == null) return [];
    const chars = Array.isArray(state.characters) ? state.characters : [];
    return chars.filter(
      (c) => c && c.role === "follower" && c.leaderId === leaderId
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

  function getEquipmentSlotLayout(panelWidth) {
    const innerWidth = panelWidth - INNER_PADDING * 2;
    const size = EQUIP_SLOT_SIZE;
    const centerX = Math.floor((innerWidth - size) / 2);
    const leftX = EQUIP_PANEL_PADDING;
    const rightX = innerWidth - EQUIP_PANEL_PADDING - size;
    const ringLeftX = Math.max(
      leftX + 6,
      centerX - size - EQUIP_PANEL_PADDING - 4
    );
    const ringRightX = Math.min(
      rightX - 6,
      centerX + size + EQUIP_PANEL_PADDING + 4
    );

    const headY = 24;
    const chestY = headY + size + 10;
    const ringY = chestY + size + 10;

    return {
      head: { x: centerX, y: headY, size },
      chest: { x: centerX, y: chestY, size },
      mainHand: { x: leftX, y: chestY, size },
      offHand: { x: rightX, y: chestY, size },
      ring1: { x: ringLeftX, y: ringY, size },
      ring2: { x: ringRightX, y: ringY, size },
      amulet: { x: ringRightX, y: headY, size },
    };
  }

  function getBuildableIdsFromPawn(pawn) {
    if (!pawn || typeof pawn !== "object") return [];
    const defId = typeof pawn.pawnDefId === "string" ? pawn.pawnDefId : "default";
    const def = pawnDefs[defId] || pawnDefs.default;
    const list =
      def?.buildableStructureIds ||
      def?.buildableStructures ||
      def?.buildables ||
      [];
    return Array.isArray(list) ? list : [];
  }

  function countStructuresByDefId(state) {
    const counts = new Map();
    const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
    for (const slot of slots) {
      const structure = slot?.structure;
      if (!structure) continue;
      const id = structure.defId;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }

  function computeBuildOptions(state, leader) {
    if (!state || !leader) return [];
    const buildable = new Set();
    for (const id of getBuildableIdsFromPawn(leader)) {
      if (typeof id === "string" && id.length) buildable.add(id);
    }

    const counts = countStructuresByDefId(state);
    const options = [];

    for (const id of buildable.values()) {
      const def = hubStructureDefs[id];
      if (!def) continue;
      const maxInstances = Number.isFinite(def.maxInstances)
        ? Math.max(0, Math.floor(def.maxInstances))
        : 1;
      const existing = counts.get(id) || 0;
      const available = maxInstances === 0 ? false : existing < maxInstances;
      options.push({
        def,
        id,
        name: def.name || id,
        available,
        existing,
        maxInstances,
      });
    }

    options.sort((a, b) => a.name.localeCompare(b.name));
    return options;
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
  }

  function setActiveBuild(ownerId, defId) {
    if (!ownerId || !defId) return;
    if (
      activeBuildSpec &&
      activeBuildSpec.ownerId === ownerId &&
      activeBuildSpec.defId === defId
    ) {
      activeBuildSpec = null;
      if (buildGhost) buildGhost.container.visible = false;
      return;
    }
    requestPauseForAction?.();
    activeBuildSpec = { ownerId, defId };
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
      .beginFill(0x1b1f2f, 0.95)
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

  function updateBuildGhostContent(defId) {
    const ghost = ensureBuildGhost();
    if (!ghost) return;
    if (!defId) {
      ghost.container.visible = false;
      buildGhostDefId = null;
      return;
    }
    if (buildGhostDefId === defId) return;
    buildGhostDefId = defId;

    const def = hubStructureDefs[defId];
    ghost.titleText.text = def?.name || defId || "Build";
    ghost.subtitleText.text = "Construction Plan";

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
        fill: 0xc7d2ee,
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
      .beginFill(0x1b1f2f, 0.95)
      .drawRoundedRect(0, 0, BUILD_GHOST_PANEL_WIDTH, panelHeight, 8)
      .endFill();
    ghost.panelHeight = panelHeight;
  }

  function isHubPlacementZone(globalPos) {
    if (!globalPos) return false;
    return (
      globalPos.y >= HUB_STRUCTURE_ROW_Y &&
      globalPos.y <= HUB_STRUCTURE_ROW_Y + HUB_STRUCTURE_HEIGHT
    );
  }

  function updateBuildGhostPosition(globalPos) {
    if (!buildGhost || !globalPos) return;
    const ghost = buildGhost;
    const placing = isHubPlacementZone(globalPos);
    const scale = placing ? BUILD_GHOST_SCALE_PLACE : BUILD_GHOST_SCALE_IDLE;
    ghost.container.scale.set(scale);

    ghost.card.x = 0;
    ghost.card.y = 0;

    const panelHeight = ghost.panelHeight || 60;
    const panelWidth = BUILD_GHOST_PANEL_WIDTH;
    const ghostWidth = ghost.cardWidth || 120;
    const ghostHeight = ghost.cardHeight || 80;

    let panelX = ghostWidth + BUILD_GHOST_PANEL_GAP;
    if (globalPos.x + (ghostWidth + panelWidth + BUILD_GHOST_PANEL_GAP) * scale > DESIGN_WIDTH - 10) {
      panelX = -panelWidth - BUILD_GHOST_PANEL_GAP;
    }

    ghost.panel.x = panelX;
    ghost.panel.y = Math.max(0, (ghostHeight - panelHeight) / 2);

    ghost.container.x = globalPos.x + 10;
    ghost.container.y = globalPos.y + 10;
  }

  function resolveHubColFromPos(state, globalPos, screenWidth) {
    if (!state || !globalPos) return null;
    const hubTop = HUB_STRUCTURE_ROW_Y;
    const hubBottom = HUB_STRUCTURE_ROW_Y + HUB_STRUCTURE_HEIGHT;
    if (globalPos.y < hubTop || globalPos.y > hubBottom) return null;

    const hubCols = Array.isArray(state?.hub?.slots)
      ? state.hub.slots.length
      : HUB_COLS;

    let bestCol = null;
    let bestDist2 = Infinity;
    for (let col = 0; col < hubCols; col++) {
      const cx = getHubColumnCenterX(screenWidth, col);
      const dx = globalPos.x - cx;
      const d2 = dx * dx;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestCol = col;
      }
    }
    return bestCol;
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
      typeof actionPlanner.getCharacterOverridePlacement === "function"
        ? actionPlanner.getCharacterOverridePlacement(leader.id)
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

    const run = () => {
      let moveSet = false;
      let moveRes = { ok: true };
      if (!alreadyThere) {
        moveRes = actionPlanner.setPawnMoveIntent({
          charId: leader.id,
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

    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused(run);
    }
    return run();
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
    const leader = getLeaderForOwner(ownerId);

    const gridWidth = cols * cellSize;
    const binSize = cellSize * BIN_CELL_SIZE;
    const w = gridWidth + INNER_PADDING * 3 + binSize;
    const equipmentPanelHeight = leader ? EQUIP_PANEL_HEIGHT + INNER_PADDING : 0;
    const bodyY = HEADER_HEIGHT + INNER_PADDING + equipmentPanelHeight;
    const baseHeight = bodyY + rows * cellSize + INNER_PADDING;
    const buildOptions = leader
      ? computeBuildOptions(getStateSafe(), leader)
      : [];
    const buildRowsHeight = buildOptions.length
      ? buildOptions.length * BUILD_PANEL_ROW_HEIGHT +
        Math.max(0, buildOptions.length - 1) * BUILD_PANEL_ROW_GAP
      : 0;
    const buildPanelHeight = buildOptions.length
      ? BUILD_PANEL_HEADER_HEIGHT +
        BUILD_PANEL_PADDING * 2 +
        buildRowsHeight +
        BUILD_PANEL_HINT_HEIGHT +
        BUILD_PANEL_ROW_GAP
      : 0;
    const leaderPanelHeight = leader
      ? LEADER_PANEL_HEIGHT +
        (buildPanelHeight > 0 ? BUILD_PANEL_GAP + buildPanelHeight : 0) +
        INNER_PADDING
      : 0;
    const h = baseHeight + leaderPanelHeight;

    const c = new PIXI.Container();
    c.visible = false;
    c.zIndex = 40;
    layer.addChild(c);

    // Background
    const bg = new PIXI.Graphics();
    bg.beginFill(0x101018, 0.95);
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
      stage,
      parent: c,
      width: w,
      height: HEADER_HEIGHT,
      radius: 8,
      background: 0x303048,
      title: getOwnerLabel(ownerId),
      titleStyle: { fill: 0xffffff, fontSize: 13 },
      paddingX: 8,
      paddingY: 4,
      pinOffsetX: 40,
      closeOffsetX: 20,
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

    const focusOutline = new PIXI.Graphics();
    focusOutline.lineStyle(2, 0x7fd0ff, 1);
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
      .lineStyle(1, 0x4b4f66, 1)
      .beginFill(0x1b1f2f, 0.9)
      .drawRoundedRect(0, 0, binSize, binSize, 6)
      .endFill();
    bin.addChild(binBg);

    const binIcon = new PIXI.Graphics();
    binIcon
      .lineStyle(2, 0xd6d6e0, 1)
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
      header,
      focusOutline,
      title,
      pinText,
      body,
      cols,
      rows,
      cellSize,
      pinned: false,
      hovered: false,
      panelWidth: w,
      panelHeight: h,
      warningOverlay,
      apOverlay,
      apOverlayAlpha: 0,
      apOverlayTarget: 0,
      equipmentPanel: null,
      leaderPanel: null,
      bin: {
        container: bin,
        bg: binBg,
      },
    };

    windows.set(ownerId, win);

    // Header drag is handled by the shared header helper.

    // Leader panel (optional)
    if (leader) {
      const equipPanel = new PIXI.Container();
      equipPanel.x = INNER_PADDING;
      equipPanel.y = HEADER_HEIGHT + INNER_PADDING;
      c.addChild(equipPanel);

      const equipBg = new PIXI.Graphics();
      equipBg.beginFill(0x1b1b28, 0.95);
      equipBg.drawRoundedRect(0, 0, w - INNER_PADDING * 2, EQUIP_PANEL_HEIGHT, 6);
      equipBg.endFill();
      equipPanel.addChild(equipBg);

      const equipTitle = new PIXI.Text("Equipment", {
        fill: 0xffffff,
        fontSize: 12,
        fontWeight: "bold",
      });
      equipTitle.x = EQUIP_PANEL_PADDING;
      equipTitle.y = 6;
      equipPanel.addChild(equipTitle);

      const slotLayout = getEquipmentSlotLayout(w);
      const equipSlots = {};
      for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
        const layout = slotLayout[slotId];
        if (!layout) continue;

        const slot = new PIXI.Container();
        slot.x = layout.x;
        slot.y = layout.y;
        slot.eventMode = "none";
        slot.cursor = "default";
        equipPanel.addChild(slot);

        const slotBg = new PIXI.Graphics();
        slotBg
          .lineStyle(1, EQUIP_SLOT_STROKE, 1)
          .beginFill(EQUIP_SLOT_BG, 0.9)
          .drawRoundedRect(0, 0, layout.size, layout.size, 6)
          .endFill();
        slot.addChild(slotBg);

        const itemLayer = new PIXI.Container();
        slot.addChild(itemLayer);

        const slotLabel = new PIXI.Text(LEADER_EQUIPMENT_SLOT_LABELS[slotId] || slotId, {
          fill: 0xaeb8d6,
          fontSize: 9,
        });
        slotLabel.anchor.set(0.5, 0);
        slotLabel.x = Math.floor(layout.size / 2);
        slotLabel.y = layout.size + 2;
        slot.addChild(slotLabel);

        equipSlots[slotId] = {
          slot,
          slotBg,
          itemLayer,
          size: layout.size,
          label: slotLabel,
        };
      }

      win.equipmentPanel = {
        container: equipPanel,
        bg: equipBg,
        title: equipTitle,
        slots: equipSlots,
      };

      const panel = new PIXI.Container();
      panel.x = INNER_PADDING;
      panel.y = bodyY + rows * cellSize + INNER_PADDING;
      c.addChild(panel);

      const panelBg = new PIXI.Graphics();
      const leaderPanelInnerHeight =
        LEADER_PANEL_HEIGHT +
        (buildPanelHeight > 0 ? BUILD_PANEL_GAP + buildPanelHeight : 0);
      panelBg.beginFill(0x1b1b28, 0.95);
      panelBg.drawRoundedRect(
        0,
        0,
        w - INNER_PADDING * 2,
        leaderPanelInnerHeight,
        6
      );
      panelBg.endFill();
      panel.addChild(panelBg);

      const prestigeText = new PIXI.Text("", {
        fill: 0xffffff,
        fontSize: 12,
      });
      prestigeText.x = LEADER_PANEL_PADDING;
      prestigeText.y = LEADER_PANEL_PADDING;
      panel.addChild(prestigeText);

      const reservedText = new PIXI.Text("", {
        fill: 0xffffff,
        fontSize: 12,
      });
      reservedText.x = LEADER_PANEL_PADDING;
      reservedText.y = prestigeText.y + 16;
      panel.addChild(reservedText);

      const hungryText = new PIXI.Text("", {
        fill: 0xff9999,
        fontSize: 11,
      });
      hungryText.x = LEADER_PANEL_PADDING;
      hungryText.y = reservedText.y + 16;
      panel.addChild(hungryText);

      const followerLabel = new PIXI.Text("Followers:", {
        fill: 0xffffff,
        fontSize: 12,
      });
      followerLabel.x = LEADER_PANEL_PADDING;
      followerLabel.y = hungryText.y + 18;
      panel.addChild(followerLabel);

      const followerCountText = new PIXI.Text("0", {
        fill: 0xffffaa,
        fontSize: 13,
        fontWeight: "bold",
      });
      followerCountText.x = followerLabel.x + 78;
      followerCountText.y = followerLabel.y - 1;
      panel.addChild(followerCountText);

      const minusBtn = new PIXI.Container();
      minusBtn.x = w - INNER_PADDING * 2 - 46;
      minusBtn.y = followerLabel.y - 4;
      minusBtn.eventMode = "static";
      minusBtn.cursor = "pointer";
      panel.addChild(minusBtn);

      const minusBg = new PIXI.Graphics();
      minusBg.beginFill(0x333355);
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
      plusBtn.x = w - INNER_PADDING * 2 - 22;
      plusBtn.y = followerLabel.y - 4;
      plusBtn.eventMode = "static";
      plusBtn.cursor = "pointer";
      panel.addChild(plusBtn);

      const plusBg = new PIXI.Graphics();
      plusBg.beginFill(0x333355);
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
        if (typeof adjustFollowerCount === "function") {
          adjustFollowerCount({ leaderId: ownerId, delta: -1 });
        }
      });

      plusBtn.on("pointertap", () => {
        if (uiBlocked) return;
        if (typeof adjustFollowerCount === "function") {
          adjustFollowerCount({ leaderId: ownerId, delta: 1 });
        }
      });

      const buildPanel = new PIXI.Container();
      buildPanel.x = 0;
      buildPanel.y = LEADER_PANEL_HEIGHT + (buildPanelHeight > 0 ? BUILD_PANEL_GAP : 0);
      buildPanel.eventMode = "static";
      buildPanel.cursor = "pointer";
      panel.addChild(buildPanel);

      let buildPanelBg = null;
      let buildTitleText = null;
      let buildHintText = null;
      let buildListContainer = null;
      let buildRows = [];

      if (buildPanelHeight > 0) {
        buildPanelBg = new PIXI.Graphics();
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

        buildTitleText = new PIXI.Text("Build", {
          fill: BUILD_PANEL_TEXT,
          fontSize: 12,
          fontWeight: "bold",
        });
        buildTitleText.x = BUILD_PANEL_PADDING;
        buildTitleText.y = BUILD_PANEL_PADDING - 1;
        buildPanel.addChild(buildTitleText);

        buildListContainer = new PIXI.Container();
        buildListContainer.x = BUILD_PANEL_PADDING;
        buildListContainer.y =
          BUILD_PANEL_PADDING + BUILD_PANEL_HEADER_HEIGHT - 6;
        buildPanel.addChild(buildListContainer);

        buildHintText = new PIXI.Text("", {
          fill: BUILD_PANEL_TEXT_MUTED,
          fontSize: 10,
        });
        buildHintText.x = BUILD_PANEL_PADDING;
        buildHintText.y =
          buildPanelHeight - BUILD_PANEL_PADDING - BUILD_PANEL_HINT_HEIGHT;
        buildPanel.addChild(buildHintText);

        const rowWidth = w - INNER_PADDING * 2 - BUILD_PANEL_PADDING * 2;
        let rowY = 0;
        for (const entry of buildOptions) {
          const row = new PIXI.Container();
          row.y = rowY;
          row.eventMode = "static";
          row.cursor = entry.available ? "pointer" : "default";

          const isActive =
            activeBuildSpec &&
            activeBuildSpec.ownerId === ownerId &&
            activeBuildSpec.defId === entry.id;
          const fill = isActive ? BUILD_PANEL_ROW_BG_ACTIVE : BUILD_PANEL_ROW_BG;
          const alpha = entry.available ? 0.95 : 0.5;

          const rowBg = new PIXI.Graphics()
            .beginFill(fill, alpha)
            .drawRoundedRect(0, 0, rowWidth, BUILD_PANEL_ROW_HEIGHT, 6)
            .endFill();
          row.addChild(rowBg);

          const label = new PIXI.Text(entry.name, {
            fill: BUILD_PANEL_TEXT,
            fontSize: 11,
          });
          label.x = 6;
          label.y = 4;
          row.addChild(label);

          const cost = INTENT_AP_COSTS?.buildDesignate ?? 0;
          const costText = new PIXI.Text(String(cost), {
            fill: 0x7fd0ff,
            fontSize: 10,
          });
          costText.x = rowWidth - 18;
          costText.y = 5;
          row.addChild(costText);

          let limitText = null;
          if (!entry.available) {
            limitText = new PIXI.Text("Limit", {
              fill: 0xffc2c2,
              fontSize: 9,
            });
            limitText.x = rowWidth - 60;
            limitText.y = 6;
            row.addChild(limitText);
          }

          row.on("pointertap", (ev) => {
            ev?.stopPropagation?.();
            if (
              activeBuildSpec &&
              activeBuildSpec.ownerId === ownerId
            ) {
              clearActiveBuildForOwner(ownerId);
              updateLeaderPanel(win);
              return;
            }
            if (!entry.available) return;
            setActiveBuild(ownerId, entry.id);
            updateLeaderPanel(win);
          });

          buildListContainer.addChild(row);
          buildRows.push({
            id: entry.id,
            row,
            rowBg,
            label,
            costText,
            limitText,
          });

          rowY += BUILD_PANEL_ROW_HEIGHT + BUILD_PANEL_ROW_GAP;
        }

        buildPanel.on("pointertap", (ev) => {
          if (!activeBuildSpec || activeBuildSpec.ownerId !== ownerId) return;
          ev?.stopPropagation?.();
          clearActiveBuildForOwner(ownerId);
          updateLeaderPanel(win);
        });
      }

      win.leaderPanel = {
        container: panel,
        prestigeText,
        reservedText,
        hungryText,
        followerCountText,
        minusBtn,
        plusBtn,
        buildPanel,
        buildPanelBg,
        buildTitleText,
        buildHintText,
        buildListContainer,
        buildRows,
        buildOptionsSignature: "",
        buildPanelHeight,
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
    win.hovered = true;

    if (!win.pinned && anchor) {
      let x = anchor.x + anchor.width + 10;
      let y = anchor.y;

      if (x + win.panelWidth > DESIGN_WIDTH) {
        x = anchor.x - win.panelWidth - 10;
      }
      if (y + win.panelHeight > DESIGN_HEIGHT) {
        y = DESIGN_HEIGHT - win.panelHeight - 10;
      }

      win.container.x = x;
      win.container.y = y;
    }

    win.container.visible = true;
  }

  function hideOnHoverOut(ownerId) {
    const win = windows.get(ownerId);
    if (!win) return;

    win.hovered = false;
    if (!win.pinned) {
      win.container.visible = false;
      clearActiveBuildForOwner(ownerId);
    }
  }

  function hideWindow(ownerId) {
    const win = windows.get(ownerId);
    if (!win) return;

    win.pinned = false;
    win.hovered = false;
    win.container.visible = false;
    win.pinText.text = "[ ]";
    clearActiveBuildForOwner(ownerId);
  }

  function togglePinned(ownerId) {
    const win = ensureWindow(ownerId);
    win.pinned = !win.pinned;
    win.pinText.text = win.pinned ? "[*]" : "[ ]";

    if (!win.pinned && !win.hovered) {
      win.container.visible = false;
      clearActiveBuildForOwner(ownerId);
    } else {
      win.container.visible = true;
    }
  }

  function refreshWindowVisibility(win) {
    if (!win) return;
    win.container.visible = !!win.pinned || !!win.hovered;
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
        win.focusOutline.visible = shouldFocus;
        win.container.visible = shouldFocus;
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
        win.focusOutline.visible = shouldFocus;
        win.container.visible = shouldFocus;
      }
      return;
    }

    for (const win of windows.values()) {
      win.focusOutline.visible = false;
      refreshWindowVisibility(win);
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

    const ctx = { ownerId, ownerLabel };

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
    };

    const titleRaw =
      typeof ui.title === "function"
        ? ui.title(item, ctx)
        : ui.title || def.name;
    const title = interpolateTemplate(titleRaw, values);

    const lines = (ui.lines || [])
      .map((line) =>
        typeof line === "function"
          ? line(item, ctx)
          : interpolateTemplate(line, values)
      )
      .filter(Boolean);

    lines.push(...buildItemSystemLines(item));

    return {
      title,
      lines,
      color: def.color ?? 0x666666,
    };
  }

  // ---------------------------------------------------------------------------
  // GRID + ITEM BUILDING
  // ---------------------------------------------------------------------------

  function rebuildWindow(ownerId) {
    const win = windows.get(ownerId);
    if (!win) return;

    const inv = getInventoryForOwner(ownerId);
    if (!inv) {
      hideWindow(ownerId);
      return;
    }

    win.body.removeChildren();

    drawGrid(win);
    const preview =
      typeof getInventoryPreview === "function"
        ? getInventoryPreview(ownerId)
        : null;
    drawItems(win, inv, preview);

    win.title.text = getOwnerLabel(ownerId);
    updateEquipmentPanel(win);
    updateLeaderPanel(win);

    lastVersionByOwner.set(ownerId, inv.version ?? 0);
  }

  function drawGrid(win) {
    const g = new PIXI.Graphics();
    g.lineStyle(1, 0x404060, 1);

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
        const bounds = c.getBounds();
        tooltipView.show(makeItemTooltipSpec(item, ownerId), bounds);
      });

      c.on("pointerout", () => {
        if (!tooltipView) return;
        tooltipView.hide();
      });
    }

    const def = itemDefs[item.kind];
    const color = def?.color ?? 0x999999;
    const borderColor = getItemTierBorderColor(item, def);

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

    const defName = def?.name ?? item.kind ?? "";
    const rawGlyph =
      def?.ui?.shortLabel ??
      def?.shortLabel ??
      (typeof defName === "string" && defName.length > 0
        ? defName.slice(0, 1)
        : "");
    const glyphText = String(rawGlyph || "").trim();
    if (glyphText) {
      const glyph = new PIXI.Text(glyphText, {
        fill: ITEM_GLYPH_COLOR,
        fontSize: 16,
        fontWeight: "bold",
      });
      glyph.anchor.set(0.5);
      glyph.x = (item.width * cellSize - 2) / 2;
      glyph.y = (item.height * cellSize - 2) / 2;
      glyph.alpha = ITEM_GLYPH_ALPHA;

      const glyphShadow = new PIXI.Text(glyphText, {
        fill: ITEM_GLYPH_SHADOW,
        fontSize: 16,
        fontWeight: "bold",
      });
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
    if (opts.pinned) {
      win.pinned = true;
      win.pinText.text = "[*]";
    }
    win.hovered = true;
    win.container.visible = true;
    return { ok: true };
  }

  function redrawEquipmentSlot(slotBg, occupied) {
    slotBg.clear();
    slotBg
      .lineStyle(1, occupied ? EQUIP_SLOT_STROKE_ACTIVE : EQUIP_SLOT_STROKE, 1)
      .beginFill(occupied ? EQUIP_SLOT_BG_OCCUPIED : EQUIP_SLOT_BG, 0.92)
      .drawRoundedRect(0, 0, EQUIP_SLOT_SIZE, EQUIP_SLOT_SIZE, 6)
      .endFill();
  }

  function updateEquipmentPanel(win) {
    if (!win?.equipmentPanel) return;
    const leader = getLeaderForOwner(win.ownerId);
    if (!leader) {
      win.equipmentPanel.container.visible = false;
      return;
    }
    win.equipmentPanel.container.visible = true;
    const equipment = getLeaderEquipmentState(leader);
    for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
      const slot = win.equipmentPanel.slots?.[slotId];
      if (!slot) continue;
      const item = equipment[slotId] ?? null;
      redrawEquipmentSlot(slot.slotBg, !!item);
      slot.itemLayer.removeChildren();
      if (!item) continue;
      buildItemView(win, item, {
        ownerId: win.ownerId,
        interactive: true,
        enableDrag: true,
        parent: slot.itemLayer,
        cellSize: EQUIP_SLOT_SIZE - 2,
        gridX: 0,
        gridY: 0,
        pixelX: 1,
        pixelY: 1,
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
      return;
    }
    const data = computeLeaderPanelData(leader);
    win.leaderPanel.container.visible = true;
    win.leaderPanel.prestigeText.text = `Prestige: ${data.effective}/${data.base}`;
    win.leaderPanel.reservedText.text = `Reserved: ${data.reserved} (Debt ${data.debt})`;
    if (data.hungryCount > 0) {
      win.leaderPanel.hungryText.text = `Hungry: ${data.hungryCount} (Debt ${data.hungryDebt})`;
    } else {
      win.leaderPanel.hungryText.text = `Hungry: 0`;
    }
    win.leaderPanel.followerCountText.text = String(data.followerCount);

    const canMinus = data.followerCount > 0;
    win.leaderPanel.minusBtn.alpha = canMinus ? 1 : 0.35;
    win.leaderPanel.minusBtn.eventMode = canMinus ? "static" : "none";
    win.leaderPanel.minusBtn.cursor = canMinus ? "pointer" : "default";

    const panel = win.leaderPanel;
    if (panel.buildListContainer) {
      const options = computeBuildOptions(getStateSafe(), leader);
      let activeDefId =
        activeBuildSpec && activeBuildSpec.ownerId === win.ownerId
          ? activeBuildSpec.defId
          : null;
      if (
        activeDefId &&
        !options.some((entry) => entry.id === activeDefId && entry.available)
      ) {
        clearActiveBuildForOwner(win.ownerId);
        activeDefId = null;
      }

      const signature = `${options
        .map((o) => `${o.id}:${o.available ? "1" : "0"}`)
        .join("|")}|active:${activeDefId ?? ""}`;

      if (signature !== panel.buildOptionsSignature) {
        panel.buildOptionsSignature = signature;
        panel.buildListContainer.removeChildren();
        panel.buildRows = [];

        const rowWidth =
          win.panelWidth - INNER_PADDING * 2 - BUILD_PANEL_PADDING * 2;
        let rowY = 0;
        for (const entry of options) {
          const row = new PIXI.Container();
          row.y = rowY;
          row.eventMode = "static";
          row.cursor = entry.available ? "pointer" : "default";

          const isActive = activeDefId === entry.id;
          const fill = isActive
            ? BUILD_PANEL_ROW_BG_ACTIVE
            : BUILD_PANEL_ROW_BG;
          const alpha = entry.available ? 0.95 : 0.5;

          const rowBg = new PIXI.Graphics()
            .beginFill(fill, alpha)
            .drawRoundedRect(0, 0, rowWidth, BUILD_PANEL_ROW_HEIGHT, 6)
            .endFill();
          row.addChild(rowBg);

          const label = new PIXI.Text(entry.name, {
            fill: BUILD_PANEL_TEXT,
            fontSize: 11,
          });
          label.x = 6;
          label.y = 4;
          row.addChild(label);

          const cost = INTENT_AP_COSTS?.buildDesignate ?? 0;
          const costText = new PIXI.Text(String(cost), {
            fill: 0x7fd0ff,
            fontSize: 10,
          });
          costText.x = rowWidth - 18;
          costText.y = 5;
          row.addChild(costText);

          let limitText = null;
          if (!entry.available) {
            limitText = new PIXI.Text("Limit", {
              fill: 0xffc2c2,
              fontSize: 9,
            });
            limitText.x = rowWidth - 60;
            limitText.y = 6;
            row.addChild(limitText);
          }

          row.on("pointertap", (ev) => {
            ev?.stopPropagation?.();
            if (!entry.available) return;
            setActiveBuild(win.ownerId, entry.id);
            updateLeaderPanel(win);
          });

          panel.buildListContainer.addChild(row);
          panel.buildRows.push({
            id: entry.id,
            row,
            rowBg,
            label,
            costText,
            limitText,
          });

          rowY += BUILD_PANEL_ROW_HEIGHT + BUILD_PANEL_ROW_GAP;
        }
      }

      if (panel.buildHintText) {
        panel.buildHintText.text =
          activeDefId != null
            ? "Drop here to cancel."
            : "Select a building to place.";
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

      if (panel.buildTitleText) {
        panel.buildTitleText.text = activeDefId != null ? "Cancel Build" : "Build";
        panel.buildTitleText.style.fill =
          activeDefId != null ? 0xffc2c2 : BUILD_PANEL_TEXT;
      }

      if (panel.buildListContainer) {
        panel.buildListContainer.alpha = activeDefId != null ? 0.35 : 1;
        panel.buildListContainer.eventMode = activeDefId != null ? "none" : "static";
      }

      if (panel.buildPanel) {
        panel.buildPanel.cursor = activeDefId != null ? "pointer" : "default";
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ITEM INTERACTION
  // ---------------------------------------------------------------------------

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
    const g = ev.data.global;
    const sourceSlotId = view?.sourceEquipmentSlotId ?? null;

    dragItem.lastGlobalPos = { x: g.x, y: g.y };
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
    dragItem.sourceOwnerOverride = view?.sourceOwnerId ?? null;
    dragItem.sourceEquipmentSlotId = sourceSlotId;

    grayItemView(view);

    const sprite = makeDragSprite(win, item, view, g);
    dragItem.sprite = sprite;
    dragLayer.addChild(sprite);

    dragItem.offsetX = g.x - sprite.x;
    dragItem.offsetY = g.y - sprite.y;

    updateItemDragGhost(g);

    stage.on("pointermove", onItemDragMove);
    stage.on("pointerup", onItemDragEnd);
    stage.on("pointerupoutside", onItemDragEnd);
  }

  function makeDragSprite(win, item, view, globalStart) {
    const { cellSize } = win;
    const w = item.width * cellSize;
    const h = item.height * cellSize;

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

    if (view?.sourceEquipmentSlotId) {
      const bounds = view.getBounds();
      c.x = bounds.x;
      c.y = bounds.y;
    } else {
      const global = win.body.toGlobal({
        x: item.gridX * cellSize,
        y: item.gridY * cellSize,
      });
      c.x = global.x;
      c.y = global.y;
    }

    if (Number.isFinite(globalStart?.x) && Number.isFinite(globalStart?.y)) {
      c.x = Math.round(c.x);
      c.y = Math.round(c.y);
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

  function onItemDragMove(ev) {
    if (!dragItem.active) return;

    const g = ev.data.global;
    dragItem.lastGlobalPos = { x: g.x, y: g.y };
    const s = dragItem.sprite;

    s.x = g.x - dragItem.offsetX;
    s.y = g.y - dragItem.offsetY;

    updateItemDragGhost(g);
  }

  function onItemDragEnd(ev) {
    stage.off("pointermove", onItemDragMove);
    stage.off("pointerup", onItemDragEnd);
    stage.off("pointerupoutside", onItemDragEnd);

    if (!dragItem.active) return;
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

    cleanupDragSprite();
    dragItem.active = false;
    dragItem.lastGlobalPos = null;

    const finish = (status = null) => {
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
      finish("fail");
      return;
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

    const win = findWindowAt(g);
    if (!win) {
      const targetOwner =
        typeof getDropTargetOwnerAt === "function"
          ? getDropTargetOwnerAt(g)
          : null;
      if (targetOwner != null) {
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

        const placement = findItemPlacement(targetInv, item, preview, null);
        if (!placement) {
          revealWindow(targetOwner);
          flashWindowError(targetOwner);
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
                targetGX: placement.gx,
                targetGY: placement.gy,
              })
            : handler({
                fromOwnerId: sourceOwner,
                toOwnerId: targetOwner,
                itemId: item.id,
                targetGX: placement.gx,
                targetGY: placement.gy,
              })
          : {
              ok: false,
              reason: sourceEquipmentSlotId
                ? "noMoveEquippedItemToInventoryHandler"
                : "noMoveItemBetweenOwnersHandler",
            };

        if (!result.ok) {
          console.warn("inventoryMove failed:", result.reason, result);
          revealWindow(targetOwner);
          flashWindowError(targetOwner);
          flashItemError(view, sourceOwner);
          finish("fail");
          return;
        }

        rebuildWindow(sourceOwner);
        rebuildWindow(targetOwner);
        finish("success");
        return;
      }

      flashItemError(view, sourceOwner);
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

    if (sourceEquipmentSlotId) {
      const targetInv = getInventoryForOwner(targetOwner);
      const preview =
        typeof getInventoryPreview === "function"
          ? getInventoryPreview(targetOwner)
          : null;

      if (isPreviewAreaReserved(item, gx, gy, preview, item?.id)) {
        flashItemError(view, sourceOwner);
        finish("fail");
        return;
      }
      if (!canPlaceItemPreview(targetInv, item, gx, gy, preview, item?.id)) {
        flashItemError(view, sourceOwner);
        finish("fail");
        return;
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
            targetGX: gx,
            targetGY: gy,
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
      if (!canPlaceItemPreview(targetInv, item, gx, gy, preview, item?.id)) {
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
    for (const win of windows.values()) {
      const c = win.container;

      if (!c.visible) continue;

      if (
        globalPos.x >= c.x &&
        globalPos.x <= c.x + win.panelWidth &&
        globalPos.y >= c.y &&
        globalPos.y <= c.y + win.panelHeight
      ) {
        return win;
      }
    }
    return null;
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
    for (const win of windows.values()) {
      if (!win?.container?.visible) continue;
      const equip = win.equipmentPanel;
      if (!equip?.slots) continue;
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
    if (targetOwner == null && typeof getDropTargetOwnerAt === "function") {
      targetOwner = getDropTargetOwnerAt(globalPos);
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
    okBtn.beginFill(0x333355);
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

    dlg.x = globalPos.x;
    dlg.y = globalPos.y;

    activeSplit = dlg;

    okText.eventMode = "none";

    stage.on("pointerdown", onSplitOutsideClick);
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
    stage.off("pointerdown", onSplitOutsideClick);
    uiBlocked = false;
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  function init() {
    stage.on("pointerdown", (ev) => {
      if (!activeBuildSpec) return;
      if (dragItem.active || dragWindow.active) return;
      const p = ev?.data?.global;
      if (!p) return;
      if (findWindowAt(p)) return;

      const state = getStateSafe();
      const col = resolveHubColFromPos(state, p, DESIGN_WIDTH);
      if (col == null) return;

      ev?.stopPropagation?.();
      const ownerId = activeBuildSpec.ownerId;
      const defId = activeBuildSpec.defId;
      const res = placeBuildAt(col, ownerId, defId);
      if (res?.ok) {
        const win = windows.get(ownerId);
        if (win) updateLeaderPanel(win);
      }
    });

    stage.on("pointermove", (ev) => {
      const p = ev?.data?.global;
      if (!p) return;
      lastPointerPos = { x: p.x, y: p.y };
      if (!activeBuildSpec) return;
      updateBuildGhostContent(activeBuildSpec.defId);
      if (buildGhost) {
        buildGhost.container.visible = true;
        updateBuildGhostPosition(lastPointerPos);
      }
    });
  }

  function update(dt) {
    updateApDragOverlays(dt);
    if (dragItem.active || activeSplit || flashingOwners.size > 0) {
      return;
    }

    if (activeBuildSpec) {
      updateBuildGhostContent(activeBuildSpec.defId);
      if (buildGhost) {
        const pos = lastPointerPos || { x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 };
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
      if (!win.container.visible) continue;

      const inv = getInventoryForOwner(ownerId);
      if (!inv) {
        hideWindow(ownerId);
        continue;
      }

      const v = inv.version ?? 0;
      const last = lastVersionByOwner.get(ownerId) ?? 0;

      if (v !== last || previewChanged) {
        rebuildWindow(ownerId);
      } else {
        updateEquipmentPanel(win);
        updateLeaderPanel(win);
      }
    }

    const focusIntent =
      typeof getFocusIntent === "function" ? getFocusIntent() : null;
    if (focusIntent !== focusIntentCache) {
      focusIntentCache = focusIntent;
    }
    applyFocusVisibility(focusIntent);
  }

  return {
    init,
    update,

    showOnHover,
    hideOnHoverOut,
    hideWindow,
    togglePinned,
    revealWindow,
    flashWindowError,

    rebuildWindow,
    ensureWindow,

    windows,
  };
}

