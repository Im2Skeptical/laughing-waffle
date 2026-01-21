// board-pixi.js
// Renders tiles/events on a 12-column board, with a separate hub row layout.
// VIEW-ONLY: no direct state mutation.

import { permanentDefs } from "../defs/gamepieces/gamepieces-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
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
  PERM_WIDTH,
  PERM_HEIGHT,
  GAMEPIECE_HOVER_SCALE,
  GAMEPIECE_SHADOW_COLOR,
  GAMEPIECE_SHADOW_ALPHA,
  GAMEPIECE_SHADOW_OFFSET_X,
  GAMEPIECE_SHADOW_OFFSET_Y,
  TILE_ROW_Y,
  EVENT_ROW_Y,
  PERM_ROW_Y,
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
 *  - permanentsLayer: PIXI.Container
 *  - hoverLayer?: PIXI.Container
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
    hoverLayer,
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

  if (tileLayer) tileLayer.sortableChildren = true;
  if (eventLayer) eventLayer.sortableChildren = true;
  if (permanentsLayer) permanentsLayer.sortableChildren = true;
  if (hoverLayer) hoverLayer.sortableChildren = true;

  const TAG_PILL_HEIGHT = 16;
  const TAG_PILL_RADIUS = 8;
  const TAG_PILL_PAD_X = 8;
  const TAG_PILL_GAP = 4;
  const TAG_PILL_MAX_WIDTH = TILE_WIDTH - 16;
  const TAG_PILL_BG = 0x1f263d;
  const TAG_PILL_BORDER = 0x101524;
  const TAG_PILL_TEXT = 0xe6eef9;
  const TAG_DRAG_SCALE = 1.06;
  const TAG_DRAG_BUMP = 6;
  let activeTagDrag = null;

  function attachHoverFx(container, width, height, radius = 8) {
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

  function removeFromParent(container) {
    if (container?.parent) container.parent.removeChild(container);
  }

  function dispatchTagOrder(envCol, tagIds) {
    if (!dispatchAction) return;
    if (interaction?.isPlanningPhase && !interaction.isPlanningPhase()) return;
    dispatchAction(ActionKinds.SET_TILE_TAG_ORDER, { envCol, tagIds });
  }

  function buildTagLozenge(tag) {
    const container = new PIXI.Container();
    container.eventMode = "static";
    container.cursor = "grab";

    const text = new PIXI.Text(tag, {
      fill: TAG_PILL_TEXT,
      fontSize: 10,
      wordWrap: false,
    });

    const width = Math.min(
      TAG_PILL_MAX_WIDTH,
      Math.ceil(text.width + TAG_PILL_PAD_X * 2)
    );
    const height = TAG_PILL_HEIGHT;

    const bg = new PIXI.Graphics()
      .lineStyle(1, TAG_PILL_BORDER, 0.9)
      .beginFill(TAG_PILL_BG, 0.95)
      .drawRoundedRect(0, 0, width, height, TAG_PILL_RADIUS)
      .endFill();

    text.x = TAG_PILL_PAD_X;
    text.y = Math.round((height - text.height) / 2);

    container.addChild(bg, text);
    container.hitArea = new PIXI.Rectangle(0, 0, width, height);

    return { container, tag, width, height };
  }

  function layoutTagEntries(view) {
    const entries = view.tagEntries || [];
    const drag = view.tagDrag;
    const rowStep = TAG_PILL_HEIGHT + TAG_PILL_GAP;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (drag && entry === drag.entry) continue;

      let adjustedIndex = i;
      if (drag) {
        if (i > drag.startIndex && i <= drag.targetIndex) {
          adjustedIndex = i - 1;
        } else if (i < drag.startIndex && i >= drag.targetIndex) {
          adjustedIndex = i + 1;
        }
      }

      let y = adjustedIndex * rowStep;
      if (drag && adjustedIndex >= drag.targetIndex) {
        y += TAG_DRAG_BUMP;
      }

      entry.container.x = 0;
      entry.container.y = y;
      entry.container.scale.set(1);
      entry.container.alpha = 1;
      entry.container.zIndex = 0;
      entry.container.cursor = "grab";
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
    if (activeTagDrag === view) activeTagDrag = null;
    layoutTagEntries(view);

    if (globalPos && view.hoverAnchor) {
      const { x, y, width, height } = view.hoverAnchor;
      const inside =
        globalPos.x >= x &&
        globalPos.x <= x + width &&
        globalPos.y >= y &&
        globalPos.y <= y + height;
      if (!inside) {
        view.isHovered = false;
        view.hoverAnchor = null;
        view.setHoverActive?.(false);
        restoreFromHover(view.container);
        clearHoverContext();
        tooltipView?.hide?.();
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

      const centerY = nextY + TAG_PILL_HEIGHT / 2;
      const nextIndex = Math.max(
        0,
        Math.min(entries.length - 1, Math.floor(centerY / rowStep))
      );

      if (nextIndex !== drag.targetIndex) {
        drag.targetIndex = nextIndex;
        layoutTagEntries(view);
      }
    };

    const onUp = (upEv) => {
      upEv?.stopPropagation?.();
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
  // Tile view
  // --------------------------------------------------------

  function rebuildTileTags(view, tileInst) {
    const tags = Array.isArray(tileInst.tags) ? tileInst.tags : [];
    view.tagSignature = tags.join("|");

    view.tagContainer.removeChildren();
    view.tagEntries = [];
    view.tagContainer.sortableChildren = true;

    if (view.tagDrag) {
      endTagDrag(view, false);
    }

    const rowStep = TAG_PILL_HEIGHT + TAG_PILL_GAP;
    const maxY = TILE_HEIGHT - view.tagStartY - TAG_PILL_HEIGHT;

    let y = 0;
    for (let i = 0; i < tags.length; i++) {
      if (y > maxY) break;

      const entry = buildTagLozenge(tags[i]);
      entry.container.y = y;
      entry.container.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        startTagDrag(view, entry, ev);
      });
      entry.container.on("pointerup", (ev) => {
        ev?.stopPropagation?.();
      });
      entry.container.on("pointerupoutside", (ev) => {
        ev?.stopPropagation?.();
      });
      entry.container.on("pointermove", (ev) => {
        if (view.tagDrag?.entry !== entry) return;
        ev?.stopPropagation?.();
      });

      view.tagContainer.addChild(entry.container);
      view.tagEntries.push(entry);

      y += rowStep;
    }

    layoutTagEntries(view);
  }

  function buildTileView(tileInst, col) {
    const { title, desc, color } = getTileUi(tileInst);

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    const { content, setActive: setHoverActive } = attachHoverFx(
      cont,
      TILE_WIDTH,
      TILE_HEIGHT,
      8
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

    const descText = new PIXI.Text(desc, {
      fill: 0x101010,
      fontSize: 10,
      wordWrap: true,
      wordWrapWidth: TILE_WIDTH - 12,
    });
    descText.x = 6;
    descText.y = titleText.y + titleText.height + 2;
    content.addChild(descText);

    const tagContainer = new PIXI.Container();
    const tagStartY = Math.min(
      TILE_HEIGHT - 14,
      descText.y + descText.height + 2
    );
    tagContainer.x = 6;
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

      cont.on("pointerenter", () => {
        if (!interaction?.canShowHoverUI?.()) return;
        setHoverActive(true);
        elevateForHover(cont);
        const anchor = getScaledAnchorRect(
          cont,
          TILE_WIDTH,
          TILE_HEIGHT,
          GAMEPIECE_HOVER_SCALE
        );
        const anchorCol = Number.isFinite(tileInst.col)
          ? Math.floor(tileInst.col)
          : col;
        const span =
          Number.isFinite(tileInst.span) && tileInst.span > 0
            ? Math.floor(tileInst.span)
            : 1;
        setHoverContext("tile", anchorCol, span, anchor);
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
        setHoverActive(false);
        restoreFromHover(cont);
        clearHoverContext();
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
      setHoverActive,
      tagContainer,
      tagStartY,
      tagSignature: "",
      tagEntries: [],
      tagDrag: null,
      pawnBadge,
      pawnText,
    };

    rebuildTileTags(view, tileInst);
    return view;
  }

  function updateTileView(view, tileInst, pawnCount) {
    view.tile = tileInst;
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
    cont.cursor = "pointer";
    const { content, setActive: setHoverActive } = attachHoverFx(
      cont,
      width,
      EVENT_HEIGHT,
      8
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

    cont.on("pointerenter", () => {
      if (!interaction?.canShowHoverUI?.()) return;
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
      setHoverActive(false);
      restoreFromHover(cont);
      clearHoverContext();
      tooltipView?.hide?.();
    });

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
      setHoverActive,
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
    const span =
      Number.isFinite(permInst.span) && permInst.span > 0
        ? Math.floor(permInst.span)
        : 1;
    const width = PERM_WIDTH * span + HUB_COL_GAP * (span - 1);
    const height = PERM_HEIGHT;

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";
    const { content, setActive: setHoverActive } = attachHoverFx(
      cont,
      width,
      height,
      10
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
      y += t.height + 1;
      if (y > height - 40) break;
    }

    let meterViews = [];
    if (meters.length > 0) {
      meterViews = createMeters(
        content,
        meters,
        permInst,
        y + 2,
        width - 14
      ).meterViews;
    }

    function permHasInventory() {
      const s = getGameState?.();
      return !!s?.ownerInventories?.[permInst.instanceId];
    }

    cont.on("pointerenter", () => {
      if (!interaction?.canShowHoverUI?.()) return;
      setHoverActive(true);
      elevateForHover(cont);
      const anchor = getScaledAnchorRect(
        cont,
        width,
        height,
        GAMEPIECE_HOVER_SCALE
      );
      setHoverContext("permanent", col, span, anchor);

      tooltipView?.show?.(
        { title, lines, scale: GAMEPIECE_HOVER_SCALE },
        anchor
      );

      if (inventoryView && permHasInventory()) {
        inventoryView.showOnHover(permInst.instanceId, {
          x: anchor.x,
          y: anchor.y,
          width: anchor.width,
          height: anchor.height,
        });
      }
    });

    cont.on("pointerleave", () => {
      setHoverActive(false);
      restoreFromHover(cont);
      clearHoverContext();
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

    const pos =
      span > 1
        ? { x: getHubColumnX(app.screen.width, col), y: PERM_ROW_Y }
        : layoutHubColPos(app.screen.width, col, PERM_WIDTH, PERM_ROW_Y);
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
            removeFromParent(view.container);
            tileViews[col] = undefined;
          }
          continue;
        }

        if (!view || view.tile.instanceId !== tileInst.instanceId) {
          if (view) removeFromParent(view.container);
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
          if (existing) removeFromParent(existing.container);
          eventViews.set(id, buildEventView(eventInst, col));
        }

      const view = eventViews.get(id);
      if (view) updateEventRemaining(view, state);
    }

      for (const [id, view] of eventViews.entries()) {
        if (seen.has(id)) continue;
        removeFromParent(view.container);
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
          if (existing) removeFromParent(existing.container);
          permViews.set(id, buildPermanentView(permInst, col));
        }
    }

      for (const [id, view] of permViews.entries()) {
        if (seen.has(id)) continue;
        removeFromParent(view.container);
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
    hoverLayer?.removeChildren?.();
    tileViews.length = 0;
    eventViews.clear();
    permViews.clear();

    const s = getGameState?.();
    if (!s?.board) return;

    const cols = Number.isFinite(s.board.cols) ? s.board.cols : BOARD_COLS;
    const hubCols = Array.isArray(s.permanentSlots)
      ? s.permanentSlots.length
      : HUB_COLS;
    syncTiles(s, cols);
    syncEvents(s, cols);
    syncPermanents(s, hubCols);
  }

  // --------------------------------------------------------
  // update
  // --------------------------------------------------------

  function update() {
    const s = getGameState?.();
    if (!s?.board) return;

    const cols = Number.isFinite(s.board.cols) ? s.board.cols : BOARD_COLS;
    const hubCols = Array.isArray(s.permanentSlots)
      ? s.permanentSlots.length
      : HUB_COLS;
    syncTiles(s, cols);
    syncEvents(s, cols);
    syncPermanents(s, hubCols);
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
