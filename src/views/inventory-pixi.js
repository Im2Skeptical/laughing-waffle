//
// inventory-pixi.js
// Inventory UI system (Pixi).
// - Renders inventories for generic "owners" (permanents, characters, etc.)
// - Handles drag/drop + stack splitting.
// - Does NOT contain game rules; delegates legality + mutation to the model.
//
// Stage 6 fix: preserve original visuals/UX, but route mutations through injected handlers
// (timeline-aware dispatcher in ui-root-pixi.js). No direct model mutations here.
//

import { itemDefs } from "../defs/defs.js";

// NOTE: Stage 6 — removed direct model mutation imports.
// import { cmdSplitStackAndPlace } from "../model/commands.js";
// import { tryMoveItemBetweenOwners } from "../model/game-model.js";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

const HEADER_HEIGHT = 24;
const INNER_PADDING = 8;

const DEFAULT_COLS = 5;
const DEFAULT_ROWS = 3;
const DEFAULT_CELL_SIZE = 40;

export function createInventoryView({
  layer,
  dragLayer,
  getOwnerLabel,
  getInventoryForOwner,
  canShowHoverUI,
  tooltipView,
  getState,

  // Stage 6: injected handlers (timeline-aware in ui-root-pixi.js)
  moveItemBetweenOwners,
  splitStackAndPlace,
}) {
  const stage = layer.parent;

  const windows = new Map();
  let uiBlocked = false;

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

    cellOffsetGX: 0,
    cellOffsetGY: 0,
  };

  // Active split modal
  let activeSplit = null;

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

  // ---------------------------------------------------------------------------
  // WINDOW CREATION
  // ---------------------------------------------------------------------------

  function ensureWindow(ownerId) {
    if (windows.has(ownerId)) return windows.get(ownerId);

    const inv = getInventoryForOwner(ownerId);
    const cols = inv?.cols ?? DEFAULT_COLS;
    const rows = inv?.rows ?? DEFAULT_ROWS;
    const cellSize = DEFAULT_CELL_SIZE;

    const w = cols * cellSize + INNER_PADDING * 2;
    const h = HEADER_HEIGHT + INNER_PADDING + rows * cellSize + INNER_PADDING;

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

    // Header (drag handle)
    const header = new PIXI.Graphics();
    header.beginFill(0x303048);
    header.drawRoundedRect(0, 0, w, HEADER_HEIGHT, 8);
    header.endFill();
    header.eventMode = "static";
    header.cursor = "move";
    c.addChild(header);

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

  // ---------------------------------------------------------------------------
  // TOOLTIP HELPERS
  // ---------------------------------------------------------------------------

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

    const title =
      typeof ui.title === "function"
        ? ui.title(item, ctx)
        : ui.title || def.name;

    const lines = (ui.lines || [])
      .map((line) => (typeof line === "function" ? line(item, ctx) : line))
      .filter(Boolean);

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
    drawItems(win, inv);

    win.title.text = getOwnerLabel(ownerId);

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

  function drawItems(win, inv) {
    const { cellSize } = win;

    for (const item of inv.items) {
      const c = new PIXI.Container();
      c.eventMode = "static";
      c.cursor = "pointer";

      c.itemData = item;
      c.ownerId = win.ownerId;

      c.on("pointerover", () => {
        if (dragItem.active) return;
        if (!tooltipView) return;
        const bounds = c.getBounds();
        tooltipView.show(makeItemTooltipSpec(item, win.ownerId), bounds);
      });

      c.on("pointerout", () => {
        if (!tooltipView) return;
        tooltipView.hide();
      });

      const def = itemDefs[item.kind];
      const color = def?.color ?? 0x999999;

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

      c.bg = box;

      if (item.quantity > 1) {
        const t = new PIXI.Text(String(item.quantity), {
          fill: 0xffffff,
          fontSize: 14,
        });
        t.x = item.width * cellSize - t.width - 6;
        t.y = item.height * cellSize - t.height - 4;
        c.addChild(t);
      }

      c.x = item.gridX * cellSize + 1;
      c.y = item.gridY * cellSize + 1;

      c.on("pointerdown", (ev) => onItemPointerDown(ev, win, item, c));

      win.body.addChild(c);
    }
  }

  // ---------------------------------------------------------------------------
  // ITEM INTERACTION
  // ---------------------------------------------------------------------------

  function onItemPointerDown(ev, win, item, view) {
    if (uiBlocked) return;

    if (ev.data.originalEvent.shiftKey) {
      openSplitDialog(ev.data.global, win.ownerId, item);
      return;
    }

    beginItemDrag(ev, win, item, view);
  }

  // ----- ITEM DRAGGING ------------------------------------------------------

  function beginItemDrag(ev, win, item, view) {
    const g = ev.data.global;

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
    const sourceOwner = dragItem.ownerId;
    const view = dragItem.view;
    const g = ev.data.global;

    cleanupDragSprite();
    dragItem.active = false;

    const finish = () => {
      restoreItemView(view);
      dragItem.view = null;
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

  // ---------------------------------------------------------------------------
  // SPLIT DIALOG
  // ---------------------------------------------------------------------------

  function openSplitDialog(globalPos, ownerId, item) {
    if (item.quantity <= 1) return;

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

    const amt = { value: 1 };

    const amtText = new PIXI.Text("1", {
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

    const result = handler
      ? handler({ ownerId, itemId: item.id, amount })
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

  function update() {
    if (dragItem.active || activeSplit || flashingOwners.size > 0) {
      return;
    }

    for (const [ownerId, win] of windows.entries()) {
      if (!win.container.visible) continue;

      const inv = getInventoryForOwner(ownerId);
      if (!inv) continue;

      const v = inv.version ?? 0;
      const last = lastVersionByOwner.get(ownerId) ?? 0;

      if (v !== last) {
        rebuildWindow(ownerId);
      }
    }
  }

  return {
    init,
    update,

    showOnHover,
    hideOnHoverOut,
    hideWindow,
    togglePinned,

    rebuildWindow,
    ensureWindow,

    windows,
  };
}
