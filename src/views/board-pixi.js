// board-pixi.js
// Renders tiles/events/permanents aligned to a 12-column board.
// VIEW-ONLY: no direct state mutation.

import { permanentDefs } from "../defs/gamepieces/gamepieces-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { ActionKinds } from "../model/actions.js";
import {
  BOARD_COLS,
  BOARD_COL_GAP,
  TILE_WIDTH,
  TILE_HEIGHT,
  EVENT_WIDTH,
  EVENT_HEIGHT,
  PERM_WIDTH,
  PERM_HEIGHT,
  TILE_ROW_Y,
  EVENT_ROW_Y,
  PERM_ROW_Y,
  getBoardColumnX,
  layoutBoardColPos,
} from "./layout-pixi.js";

/**
 * opts:
 *  - app: PIXI.Application
 *  - tileLayer: PIXI.Container
 *  - eventLayer: PIXI.Container
 *  - permanentsLayer: PIXI.Container
 *  - getGameState: () => gameState
 *  - interaction: interactionController
 *  - tooltipView
 *  - inventoryView
 *  - dispatchAction: (kind, payload, opts?) => any
 */
export function createBoardView(opts) {
  const {
    app,
    tileLayer,
    eventLayer,
    permanentsLayer,
    getGameState,
    interaction,
    tooltipView,
    inventoryView,
    dispatchAction,
  } = opts;

  const tileViews = [];
  /** @type {Map<number, BoardEventView>} */
  const eventViews = new Map();
  /** @type {Map<number, BoardPermView>} */
  const permViews = new Map();

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

  function getPermUi(permInst) {
    const def = permanentDefs[permInst.defId];
    const ui = def?.ui || {};
    const title =
      (typeof ui.title === "function" ? ui.title(permInst, def) : ui.title) ||
      def?.name ||
      permInst.defId;
    const lines = (ui.lines || [])
      .map((line) => (typeof line === "function" ? line(permInst, def) : line))
      .filter(Boolean);
    const meters = Array.isArray(ui.meters) ? ui.meters : [];
    return { def, title, lines, color: def?.color ?? 0x336699, meters };
  }

  // --------------------------------------------------------
  // Meter helpers (permanents only)
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
  // Tag reorder helper
  // --------------------------------------------------------

  function tryReorderTag(tileCol, tagIndex, direction) {
    if (!dispatchAction) return;
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) return;

    const state = getGameState?.();
    const tile = state?.board?.occ?.tile?.[tileCol];
    const tags = Array.isArray(tile?.tags) ? tile.tags.slice() : [];
    if (tags.length < 2) return;

    const nextIndex = tagIndex + direction;
    if (nextIndex < 0 || nextIndex >= tags.length) return;

    const tmp = tags[tagIndex];
    tags[tagIndex] = tags[nextIndex];
    tags[nextIndex] = tmp;

    dispatchAction(ActionKinds.SET_TILE_TAG_ORDER, {
      tileCol,
      tagIds: tags,
    });
  }

  // --------------------------------------------------------
  // Tile view
  // --------------------------------------------------------

  function rebuildTileTags(view, tileInst) {
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    view.tagSignature = tags.join("|");

    view.tagContainer.removeChildren();

    let y = 0;
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];

      const tagText = new PIXI.Text(tag, {
        fill: 0x101010,
        fontSize: 10,
        wordWrap: true,
        wordWrapWidth: TILE_WIDTH - 36,
      });
      tagText.x = 8;
      tagText.y = y;
      view.tagContainer.addChild(tagText);

      const up = new PIXI.Text("^", {
        fill: 0x1a1a1a,
        fontSize: 10,
      });
      up.eventMode = "static";
      up.cursor = "pointer";
      up.x = TILE_WIDTH - 24;
      up.y = y;
      up.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        tryReorderTag(view.col, i, -1);
      });
      view.tagContainer.addChild(up);

      const down = new PIXI.Text("v", {
        fill: 0x1a1a1a,
        fontSize: 10,
      });
      down.eventMode = "static";
      down.cursor = "pointer";
      down.x = TILE_WIDTH - 14;
      down.y = y;
      down.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        tryReorderTag(view.col, i, 1);
      });
      view.tagContainer.addChild(down);

      y += 14;
      if (view.tagStartY + y > TILE_HEIGHT - 12) break;
    }
  }

  function buildTileView(tileInst, col) {
    const { title, desc, color } = getTileUi(tileInst);

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";

    cont.addChild(
      new PIXI.Graphics()
        .beginFill(0x3a3a3a)
        .drawRoundedRect(0, 0, TILE_WIDTH, TILE_HEIGHT, 8)
        .endFill()
    );

    cont.addChild(
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
    cont.addChild(titleText);

    const descText = new PIXI.Text(desc, {
      fill: 0x101010,
      fontSize: 10,
      wordWrap: true,
      wordWrapWidth: TILE_WIDTH - 12,
    });
    descText.x = 6;
    descText.y = titleText.y + titleText.height + 2;
    cont.addChild(descText);

    const tagContainer = new PIXI.Container();
    const tagStartY = Math.min(
      TILE_HEIGHT - 14,
      descText.y + descText.height + 2
    );
    tagContainer.y = tagStartY;
    cont.addChild(tagContainer);

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
    cont.addChild(pawnBadge);

    cont.on("pointerenter", () => {
      if (!interaction?.canShowHoverUI?.()) return;
      tooltipView?.show?.(
        {
          title,
          lines: desc ? [desc] : [],
        },
        { x: cont.x, y: cont.y, width: TILE_WIDTH, height: TILE_HEIGHT }
      );
    });

    cont.on("pointerleave", () => {
      tooltipView?.hide?.();
    });

    const pos = layoutBoardColPos(app.screen.width, col, TILE_WIDTH, TILE_ROW_Y);
    cont.x = pos.x;
    cont.y = pos.y;

    tileLayer.addChild(cont);

    const view = {
      container: cont,
      tile: tileInst,
      col,
      tagContainer,
      tagStartY,
      tagSignature: "",
      pawnBadge,
      pawnText,
    };

    rebuildTileTags(view, tileInst);
    return view;
  }

  function updateTileView(view, tileInst, pawnCount) {
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    const signature = tags.join("|");
    if (signature !== view.tagSignature) {
      rebuildTileTags(view, tileInst);
    }

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

    cont.addChild(
      new PIXI.Graphics()
        .beginFill(0x2f2f2f)
        .drawRoundedRect(0, 0, width, EVENT_HEIGHT, 8)
        .endFill()
    );

    cont.addChild(
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
    cont.addChild(titleText);

    const descText = new PIXI.Text(desc, {
      fill: 0x101010,
      fontSize: 9,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    descText.x = 6;
    descText.y = titleText.y + titleText.height + 1;
    cont.addChild(descText);

    const remainingText = new PIXI.Text("", {
      fill: 0x101010,
      fontSize: 10,
    });
    remainingText.x = 6;
    remainingText.y = EVENT_HEIGHT - 16;
    cont.addChild(remainingText);

    const startX =
      span > 1
        ? getBoardColumnX(app.screen.width, col)
        : layoutBoardColPos(app.screen.width, col, EVENT_WIDTH, EVENT_ROW_Y).x;
    cont.x = startX;
    cont.y = EVENT_ROW_Y;

    eventLayer.addChild(cont);

    return {
      container: cont,
      event: eventInst,
      remainingText,
    };
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

  function buildPermanentView(permInst, col) {
    const { title, lines, color, meters } = getPermUi(permInst);

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";

    cont.addChild(
      new PIXI.Graphics()
        .beginFill(0x3a3a3a)
        .drawRoundedRect(0, 0, PERM_WIDTH, PERM_HEIGHT, 10)
        .endFill()
    );

    cont.addChild(
      new PIXI.Graphics()
        .beginFill(color)
        .drawRoundedRect(3, 3, PERM_WIDTH - 6, PERM_HEIGHT - 6, 8)
        .endFill()
    );

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 12,
      wordWrap: true,
      wordWrapWidth: PERM_WIDTH - 12,
    });
    titleText.x = 6;
    titleText.y = 6;
    cont.addChild(titleText);

    let y = titleText.y + titleText.height + 2;
    for (const line of lines) {
      const t = new PIXI.Text(line, {
        fill: 0x000000,
        fontSize: 10,
        wordWrap: true,
        wordWrapWidth: PERM_WIDTH - 12,
      });
      t.x = 6;
      t.y = y;
      cont.addChild(t);
      y += t.height + 1;
      if (y > PERM_HEIGHT - 40) break;
    }

    let meterViews = [];
    if (meters.length > 0) {
      meterViews = createMeters(
        cont,
        meters,
        permInst,
        y + 2,
        PERM_WIDTH - 14
      ).meterViews;
    }

    function permHasInventory() {
      const s = getGameState?.();
      return !!s?.ownerInventories?.[permInst.instanceId];
    }

    cont.on("pointerenter", () => {
      if (!interaction?.canShowHoverUI?.()) return;

      tooltipView?.show?.(
        { title, lines },
        { x: cont.x, y: cont.y, width: PERM_WIDTH, height: PERM_HEIGHT }
      );

      if (inventoryView && permHasInventory()) {
        inventoryView.showOnHover(permInst.instanceId, {
          x: cont.x,
          y: cont.y,
          width: PERM_WIDTH,
          height: PERM_HEIGHT,
        });
      }
    });

    cont.on("pointerleave", () => {
      tooltipView?.hide?.();
      if (inventoryView && permHasInventory()) {
        inventoryView.hideOnHoverOut(permInst.instanceId);
      }
    });

    cont.on("pointertap", () => {
      if (inventoryView && permHasInventory()) {
        inventoryView.togglePinned(permInst.instanceId);
      }
    });

    const pos = layoutBoardColPos(app.screen.width, col, PERM_WIDTH, PERM_ROW_Y);
    cont.x = pos.x;
    cont.y = pos.y;

    permanentsLayer.addChild(cont);

    return { container: cont, perm: permInst, meterViews };
  }

  // --------------------------------------------------------
  // sync helpers
  // --------------------------------------------------------

  function getPawnCountsByCol(state, cols) {
    const countLen = Number.isFinite(cols) ? Math.max(0, cols) : BOARD_COLS;
    const counts = new Array(countLen).fill(0);
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    for (const ch of chars) {
      const col = Number.isFinite(ch?.slotIndex)
        ? Math.floor(ch.slotIndex)
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
          tileLayer.removeChild(view.container);
          tileViews[col] = undefined;
        }
        continue;
      }

      if (!view || view.tile.instanceId !== tileInst.instanceId) {
        if (view) tileLayer.removeChild(view.container);
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
        if (existing) eventLayer.removeChild(existing.container);
        eventViews.set(id, buildEventView(eventInst, col));
      }

      const view = eventViews.get(id);
      if (view) updateEventRemaining(view, state);
    }

    for (const [id, view] of eventViews.entries()) {
      if (seen.has(id)) continue;
      eventLayer.removeChild(view.container);
      eventViews.delete(id);
    }
  }

  function syncPermanents(state, cols) {
    const occ = state?.board?.occ?.permanent;
    const seen = new Set();

    for (let col = 0; col < cols; col++) {
      const permInst = occ?.[col] || null;
      if (!permInst) continue;

      const anchorCol = Number.isFinite(permInst.col)
        ? Math.floor(permInst.col)
        : col;
      if (anchorCol !== col) continue;

      const id = permInst.instanceId ?? col;
      seen.add(id);

      const existing = permViews.get(id);
      if (!existing || existing.perm.instanceId !== permInst.instanceId) {
        if (existing) permanentsLayer.removeChild(existing.container);
        permViews.set(id, buildPermanentView(permInst, col));
      }
    }

    for (const [id, view] of permViews.entries()) {
      if (seen.has(id)) continue;
      permanentsLayer.removeChild(view.container);
      permViews.delete(id);
    }

    for (const view of permViews.values()) {
      if (view.meterViews.length > 0) {
        updateMeters(view.meterViews, view.perm);
      }
    }
  }

  // --------------------------------------------------------
  // rebuildAll
  // --------------------------------------------------------

  function rebuildAll() {
    tileLayer.removeChildren();
    eventLayer.removeChildren();
    permanentsLayer.removeChildren();
    tileViews.length = 0;
    eventViews.clear();
    permViews.clear();

    const s = getGameState?.();
    if (!s?.board) return;

    const cols = Number.isFinite(s.board.cols) ? s.board.cols : BOARD_COLS;
    syncTiles(s, cols);
    syncEvents(s, cols);
    syncPermanents(s, cols);
  }

  // --------------------------------------------------------
  // update
  // --------------------------------------------------------

  function update() {
    const s = getGameState?.();
    if (!s?.board) return;

    const cols = Number.isFinite(s.board.cols) ? s.board.cols : BOARD_COLS;
    syncTiles(s, cols);
    syncEvents(s, cols);
    syncPermanents(s, cols);
  }

  function init() {}

  return { init, rebuildAll, update };
}

/**
 * @typedef {Object} BoardEventView
 * @property {PIXI.Container} container
 * @property {any} event
 * @property {PIXI.Text} remainingText
 *
 * @typedef {Object} BoardPermView
 * @property {PIXI.Container} container
 * @property {any} perm
 * @property {Array<any>} meterViews
 */
