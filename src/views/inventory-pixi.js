//
// inventory-pixi.js
// Inventory UI system (Pixi).
// - Renders inventories for generic "owners" (hub structures, characters, etc.)
// - Handles drag/drop + stack splitting.
// - Does NOT contain game rules; delegates legality + mutation to the model.
//


import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { itemSystemDefs } from "../defs/gamesystems/item-system-defs.js";
import {
  PRESTIGE_COST_PER_FOLLOWER,
  HUNGER_THRESHOLD,
  SECONDS_BELOW_HUNGER_THRESHOLD,
} from "../defs/gamesettings/gamerules-defs.js";



const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

const HEADER_HEIGHT = 24;
const INNER_PADDING = 8;

const DEFAULT_COLS = 5;
const DEFAULT_ROWS = 3;
const DEFAULT_CELL_SIZE = 40;
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
const LEADER_PANEL_HEIGHT = 86;
const LEADER_PANEL_PADDING = 6;
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
  onGhostClick,
  hasItemTransferIntent,
  getItemTransferAffordability,

  // Stage 6: injected handlers (timeline-aware in ui-root-pixi.js)
  moveItemBetweenOwners,
  splitStackAndPlace,
  cancelItemTransfer,
  adjustFollowerCount,
  requestPauseForAction,
  setApDragWarning,
}) {
  const stage = layer.parent;

  const windows = new Map();
  let uiBlocked = false;
  let lastPreviewVersion = null;
  let focusIntentCache = null;

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

    const w = cols * cellSize + INNER_PADDING * 2;
    const baseHeight =
      HEADER_HEIGHT + INNER_PADDING + rows * cellSize + INNER_PADDING;
    const leaderPanelHeight = leader ? LEADER_PANEL_HEIGHT + INNER_PADDING : 0;
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

    // Header (drag handle)
    const header = new PIXI.Graphics();
    header.beginFill(0x303048);
    header.drawRoundedRect(0, 0, w, HEADER_HEIGHT, 8);
    header.endFill();
    header.eventMode = "static";
    header.cursor = "move";
    c.addChild(header);

    const focusOutline = new PIXI.Graphics();
    focusOutline.lineStyle(2, 0x7fd0ff, 1);
    focusOutline.drawRoundedRect(1, 1, w - 2, h - 2, 10);
    focusOutline.visible = false;
    c.addChild(focusOutline);

    const title = new PIXI.Text(getOwnerLabel(ownerId), {
      fill: 0xffffff,
      fontSize: 13,
    });
    title.x = 8;
    title.y = 4;
    c.addChild(title);

    // Pin button
    const pinText = new PIXI.Text("[ ]", { fill: 0xffffff, fontSize: 12 });
    pinText.x = w - 40;
    pinText.y = 4;
    pinText.eventMode = "static";
    pinText.cursor = "pointer";
    c.addChild(pinText);

    // Close button
    const closeText = new PIXI.Text("x", { fill: 0xffffff, fontSize: 12 });
    closeText.x = w - 20;
    closeText.y = 4;
    closeText.eventMode = "static";
    closeText.cursor = "pointer";
    c.addChild(closeText);

    // Body container (grid + items)
    const body = new PIXI.Container();
    body.x = INNER_PADDING;
    body.y = HEADER_HEIGHT + INNER_PADDING;
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
      leaderPanel: null,
    };

    windows.set(ownerId, win);

    // Header dragging
    header.on("pointerdown", (ev) => {
      if (uiBlocked) return;
      dragWindow.active = true;
      dragWindow.ownerId = ownerId;

      const g = ev.data.global;
      dragWindow.offsetX = g.x - c.x;
      dragWindow.offsetY = g.y - c.y;

      stage.on("pointermove", onWindowDragMove);
      stage.on("pointerup", onWindowDragEnd);
      stage.on("pointerupoutside", onWindowDragEnd);
    });

    // Pin toggle
    pinText.on("pointertap", () => {
      togglePinned(ownerId);
    });

    // Close
    closeText.on("pointertap", () => {
      hideWindow(ownerId);
    });

    // Leader panel (optional)
    if (leader) {
      const panel = new PIXI.Container();
      panel.x = INNER_PADDING;
      panel.y = HEADER_HEIGHT + INNER_PADDING + rows * cellSize + INNER_PADDING;
      c.addChild(panel);

      const panelBg = new PIXI.Graphics();
      panelBg.beginFill(0x1b1b28, 0.95);
      panelBg.drawRoundedRect(0, 0, w - INNER_PADDING * 2, LEADER_PANEL_HEIGHT, 6);
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

      win.leaderPanel = {
        container: panel,
        prestigeText,
        reservedText,
        hungryText,
        followerCountText,
        minusBtn,
        plusBtn,
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
  // WINDOW DRAGGING
  // ---------------------------------------------------------------------------

  function onWindowDragMove(ev) {
    if (!dragWindow.active) return;
    const win = windows.get(dragWindow.ownerId);
    if (!win) return;

    const g = ev.data.global;
    win.container.x = g.x - dragWindow.offsetX;
    win.container.y = g.y - dragWindow.offsetY;
  }

  function onWindowDragEnd() {
    dragWindow.active = false;
    dragWindow.ownerId = null;

    stage.off("pointermove", onWindowDragMove);
    stage.off("pointerup", onWindowDragEnd);
    stage.off("pointerupoutside", onWindowDragEnd);
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
    }
  }

  function hideWindow(ownerId) {
    const win = windows.get(ownerId);
    if (!win) return;

    win.pinned = false;
    win.hovered = false;
    win.container.visible = false;
    win.pinText.text = "[ ]";
  }

  function togglePinned(ownerId) {
    const win = ensureWindow(ownerId);
    win.pinned = !win.pinned;
    win.pinText.text = win.pinned ? "[*]" : "[ ]";

    if (!win.pinned && !win.hovered) {
      win.container.visible = false;
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
    if (!inv) return;

    win.body.removeChildren();

    drawGrid(win);
    const preview =
      typeof getInventoryPreview === "function"
        ? getInventoryPreview(ownerId)
        : null;
    drawItems(win, inv, preview);

    win.title.text = getOwnerLabel(ownerId);
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
    const { cellSize } = win;
    const c = new PIXI.Container();
    const ownerId = opts.ownerId ?? win.ownerId;

    const interactive = !!opts.interactive;
    c.eventMode = interactive ? "static" : "none";
    c.cursor = interactive ? "pointer" : "default";

    c.itemData = item;
    c.ownerId = ownerId;
    c.sourceOwnerId = item?.sourceOwnerId ?? null;

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

    const gx = opts.gridX ?? item.gridX;
    const gy = opts.gridY ?? item.gridY;
    c.x = gx * cellSize + 1;
    c.y = gy * cellSize + 1;

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

    win.body.addChild(c);
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

  function updateLeaderPanel(win) {
    if (!win?.leaderPanel) return;
    const leader = getLeaderForOwner(win.ownerId);
    if (!leader) {
      win.leaderPanel.container.visible = false;
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
  }

  // ---------------------------------------------------------------------------
  // ITEM INTERACTION
  // ---------------------------------------------------------------------------

  function onItemPointerDown(ev, win, item, view) {
    if (uiBlocked) return;

    if (ev.data.originalEvent.shiftKey) {
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

    dragItem.lastGlobalPos = { x: g.x, y: g.y };
    const localInBody = win.body.toLocal(g);
    const clickGX = Math.floor(localInBody.x / win.cellSize);
    const clickGY = Math.floor(localInBody.y / win.cellSize);

    let cellOffsetGX = clickGX - item.gridX;
    let cellOffsetGY = clickGY - item.gridY;

    cellOffsetGX = Math.max(0, Math.min(item.width - 1, cellOffsetGX));
    cellOffsetGY = Math.max(0, Math.min(item.height - 1, cellOffsetGY));

    dragItem.cellOffsetGX = cellOffsetGX;
    dragItem.cellOffsetGY = cellOffsetGY;

    dragItem.active = true;
    dragItem.ownerId = win.ownerId;
    dragItem.item = item;
    dragItem.view = view;
    dragItem.sourceOwnerOverride = view?.sourceOwnerId ?? null;

    grayItemView(view);

    const sprite = makeDragSprite(win, item);
    dragItem.sprite = sprite;
    dragLayer.addChild(sprite);

    dragItem.offsetX = g.x - sprite.x;
    dragItem.offsetY = g.y - sprite.y;

    stage.on("pointermove", onItemDragMove);
    stage.on("pointerup", onItemDragEnd);
    stage.on("pointerupoutside", onItemDragEnd);
  }

  function makeDragSprite(win, item) {
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

    const global = win.body.toGlobal({
      x: item.gridX * cellSize,
      y: item.gridY * cellSize,
    });

    c.x = global.x;
    c.y = global.y;

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
    const view = dragItem.view;
    const g = ev.data.global;

    cleanupDragSprite();
    dragItem.active = false;
    dragItem.lastGlobalPos = null;

    const finish = () => {
      restoreItemView(view);
      dragItem.view = null;
      dragItem.sourceOwnerOverride = null;
      if (typeof setApDragWarning === "function") {
        setApDragWarning(false);
      }
    };

    if (uiBlocked) {
      flashItemError(view, sourceOwner);
      finish();
      return;
    }

    const win = findWindowAt(g);
    if (!win) {
      flashItemError(view, sourceOwner);
      finish();
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
        finish();
        return;
      }
      rebuildWindow(targetOwner);
      if (dragItem.ownerId !== targetOwner) {
        rebuildWindow(dragItem.ownerId);
      }
      finish();
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
            finish();
            return;
          }
        }
      }
    }

    if (isPreviewAreaReserved(item, gx, gy, preview, item?.id)) {
      flashItemError(view, sourceOwner);
      finish();
      return;
    }

    if (isCrossOwner) {
      if (!canPlaceItemPreview(targetInv, item, gx, gy, preview, item?.id)) {
        flashItemError(view, sourceOwner);
        finish();
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
      finish();
      return;
    }

    rebuildWindow(sourceOwner);
    if (targetOwner !== sourceOwner) rebuildWindow(targetOwner);
    finish();
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

  function init() {}

  function update(dt) {
    updateApDragOverlays(dt);
    if (dragItem.active || activeSplit || flashingOwners.size > 0) {
      return;
    }

    const previewVersion =
      typeof getPreviewVersion === "function" ? getPreviewVersion() : null;
    const previewChanged =
      previewVersion != null && previewVersion !== lastPreviewVersion;
    if (previewChanged) lastPreviewVersion = previewVersion;

    for (const [ownerId, win] of windows.entries()) {
      if (!win.container.visible) continue;

      const inv = getInventoryForOwner(ownerId);
      if (!inv) continue;

      const v = inv.version ?? 0;
      const last = lastVersionByOwner.get(ownerId) ?? 0;

      if (v !== last || previewChanged) {
        rebuildWindow(ownerId);
      } else {
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

