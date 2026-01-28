// characters-pixi.js
//
// Responsible for rendering characters and wiring their UI behaviour
// (hover tooltip, hover inventory, click-to-toggle inventory, dragging).
//
// VIEW-ONLY: does NOT depend on model slot.x/slot.y. Positions are derived
// from the same layout math used by board-pixi.js.
//
// Wiring:
// - opts { getCharacters, getHubSlots, interaction, tooltipView, inventoryView, onCharacterDropped }
// - Or opts { getGameState, onDropCharacter } (used by current ui-root-pixi.js)

import {
  BOARD_COLS,
  HUB_COLS,
  HUB_STRUCTURE_WIDTH,
  TILE_WIDTH,
  TILE_ROW_Y,
  CHARACTER_ROW_OFFSET_Y,
  layoutBoardColPos,
  layoutHubStructurePos,
  GAMEPIECE_HOVER_SCALE,
  GAMEPIECE_SHADOW_COLOR,
  GAMEPIECE_SHADOW_ALPHA,
  GAMEPIECE_SHADOW_OFFSET_X,
  GAMEPIECE_SHADOW_OFFSET_Y,
} from "./layout-pixi.js";
import { pawnSystemDefs } from "../defs/gamesystems/pawn-systems-defs.js";

export function createCharactersView(opts) {
  const {
    app,
    layer,
    hoverLayer,

    // old shape
    getCharacters,
    getHubSlots,
    interaction,
    tooltipView,
    inventoryView,
    onCharacterDropped,
    requestPauseForAction,

    // newer shape
    getGameState,
    onDropCharacter,
    getFocusIntent,
    getPreviewHubCol,
    getPreviewPlacement,
  } = opts;

  const viewsById = new Map();
  const DRAG_THRESHOLD_PX = 3;
  const FAN_SPACING = 40;
  const RADIUS = 20;
  let focusGhost = null;
  let focusedCharId = null;

  if (layer) layer.sortableChildren = true;
  if (hoverLayer) hoverLayer.sortableChildren = true;

  // ---------------------------------------------------------------------------
  // Safe adapters (so missing wiring doesn't crash)
  // ---------------------------------------------------------------------------

  const interactionSafe = interaction || {
    canShowHoverUI: () => true,
    isDragging: () => false,
    canDragCharacter: () => true,
    startDrag: () => {},
    endDrag: () => {},
    getDragged: () => null,
    getHovered: () => null,
    setHovered: () => {},
    clearHovered: () => {},
  };

  function getStateSafe() {
    return typeof getGameState === "function" ? getGameState() : null;
  }

  function getCharsSafe() {
    if (typeof getCharacters === "function") return getCharacters() || [];
    const s = getStateSafe();
    // Support likely state shapes
    return s?.characters || s?.chars || s?.characterList || s?.party || [];
  }

  function getEnvColsSafe() {
    const s = getStateSafe();
    const cols = Number.isFinite(s?.board?.cols) ? Math.floor(s.board.cols) : null;
    return cols != null ? cols : BOARD_COLS;
  }

  function getHubColsSafe() {
    if (typeof getHubSlots === "function") {
      const slots = getHubSlots() || [];
      if (Array.isArray(slots) && slots.length > 0) return slots.length;
    }
    const s = getStateSafe();
    const slots = s?.hub?.slots;
    if (Array.isArray(slots) && slots.length > 0) return slots.length;
    return HUB_COLS;
  }

  function getInvSafe() {
    // Inventory hover/pin is optional; guard all calls.
    return inventoryView || null;
  }

  function getTooltipSafe() {
    return tooltipView || null;
  }

  function emitDropped(payload) {
    const cb = onCharacterDropped || onDropCharacter || null;
    if (typeof cb === "function") return cb(payload);
    return { ok: false, reason: "noDropHandler" };
  }

  function getHoverInfoForSlot(row, col) {
    const hover =
      typeof interactionSafe.getHovered === "function"
        ? interactionSafe.getHovered()
        : null;
    if (!hover || typeof hover !== "object") return null;
    const span =
      Number.isFinite(hover.span) && hover.span > 0
        ? Math.floor(hover.span)
        : 1;
    if (
      row === "env" &&
      hover.kind === "tile" &&
      col >= hover.col &&
      col < hover.col + span
    ) {
      return hover;
    }
    if (
      row === "hub" &&
      hover.kind === "hub" &&
      col >= hover.col &&
      col < hover.col + span
    ) {
      return hover;
    }
    return null;
  }

  function applyHoverTransform(pos, hover) {
    if (!hover) return { x: pos.x, y: pos.y, scale: 1 };
    const scale = Number.isFinite(hover.scale) ? hover.scale : 1;
    const cx = Number.isFinite(hover.centerX) ? hover.centerX : pos.x;
    const cy = Number.isFinite(hover.centerY) ? hover.centerY : pos.y;
    return {
      x: cx + (pos.x - cx) * scale,
      y: cy + (pos.y - cy) * scale,
      scale,
    };
  }

  function getEffectiveScale(view) {
    const attached = Number.isFinite(view.attachedScale) ? view.attachedScale : 1;
    const hover = view.selfHover ? GAMEPIECE_HOVER_SCALE : 1;
    return Math.max(attached, hover);
  }

  function applyCharacterScale(view) {
    const scale = getEffectiveScale(view);
    view.container.scale.set(scale);
    view.shadow.visible = scale > 1 && GAMEPIECE_SHADOW_ALPHA > 0;
    view.container.zIndex = scale > 1 ? 20 : 0;
    if (scale > 1) {
      elevateForHover(view);
    } else {
      restoreFromHover(view);
    }
  }

  function flashDragBlocked(view) {
    if (!view?.flashRing) return;
    if (view.flashTimeout) {
      clearTimeout(view.flashTimeout);
      view.flashTimeout = null;
    }
    view.flashRing.clear();
    view.flashRing
      .lineStyle(2, 0xff4f5e, 1)
      .beginFill(0x8a1f2a, 0.25)
      .drawCircle(0, 0, RADIUS + 4)
      .endFill();
    view.flashRing.visible = true;
    view.flashTimeout = setTimeout(() => {
      view.flashRing.visible = false;
      view.flashTimeout = null;
    }, 160);
  }

  function elevateForHover(view) {
    if (!hoverLayer || view.container.parent === hoverLayer) return;
    view.hoverParent = view.container.parent;
    view.hoverIndex =
      view.container.parent?.getChildIndex?.(view.container) ?? null;
    hoverLayer.addChild(view.container);
  }

  function restoreFromHover(view) {
    if (!hoverLayer || view.container.parent !== hoverLayer) return;
    const parent = view.hoverParent || layer;
    const index = Number.isFinite(view.hoverIndex)
      ? Math.min(parent?.children?.length ?? 0, view.hoverIndex)
      : null;
    if (parent) {
      if (index == null) {
        parent.addChild(view.container);
      } else {
        parent.addChildAt(view.container, index);
      }
    }
    view.hoverParent = null;
    view.hoverIndex = null;
  }

  function getScaledAnchorFromCenter(cx, cy, width, height, scale) {
    const s = Number.isFinite(scale) ? scale : 1;
    const scaledWidth = width * s;
    const scaledHeight = height * s;
    return {
      x: cx - scaledWidth / 2,
      y: cy - scaledHeight / 2,
      width: scaledWidth,
      height: scaledHeight,
      scale: s,
    };
  }

  // ---------------------------------------------------------------------------
  // Positioning
  // ---------------------------------------------------------------------------

  // Centre above a hub structure card at hubCol
  function getBasePosForHubCol(hubCol) {
    const cols = getHubColsSafe();

    if (!cols || hubCol == null || hubCol < 0 || hubCol >= cols) {
      return { x: 200 + (hubCol ?? 0) * 220, y: 380 };
    }

    const pos = layoutHubStructurePos(app.screen.width, hubCol);
    const centerX = pos.x + HUB_STRUCTURE_WIDTH / 2;
    const topY = pos.y;
    return { x: centerX, y: topY - CHARACTER_ROW_OFFSET_Y };
  }

  // Centre above an env tile at envCol
  function getBasePosForEnvCol(envCol) {
    const cols = getEnvColsSafe();
    if (!cols || envCol == null || envCol < 0 || envCol >= cols) {
      return { x: 200 + (envCol ?? 0) * 220, y: 220 };
    }
    const pos = layoutBoardColPos(
      app.screen.width,
      envCol,
      TILE_WIDTH,
      TILE_ROW_Y
    );
    const centerX = pos.x + TILE_WIDTH / 2;
    const topY = pos.y;
    return { x: centerX, y: topY - CHARACTER_ROW_OFFSET_Y };
  }

  // ---------------------------------------------------------------------------
  // Tooltip spec
  // ---------------------------------------------------------------------------
  function formatSystemValue(value) {
    if (!Number.isFinite(value)) return "?";
    if (Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value));
    return String(Math.round(value * 10) / 10);
  }

  function getPawnSystemLines(char) {
    const lines = [];
    const systemState = char?.systemState ?? {};
    const systemTiers = char?.systemTiers ?? {};
    const systemIds = Object.keys(pawnSystemDefs);

    for (const systemId of systemIds) {
      const def = pawnSystemDefs[systemId];
      if (!def || typeof def !== "object") continue;
      const label = def.ui?.name || systemId;
      const tier =
        typeof systemTiers[systemId] === "string" ? systemTiers[systemId] : null;
      const state = systemState[systemId] || def.stateDefaults || {};
      const cur = formatSystemValue(state.cur);
      const max = formatSystemValue(state.max);
      const tierLabel = tier ? ` (${tier})` : "";
      lines.push(`${label}${tierLabel}: ${cur}/${max}`);
    }

    return lines;
  }

  function makeCharTooltipSpec(char) {
    const systemLines = getPawnSystemLines(char);
    return {
      title: char.name || `Character ${char.id ?? ""}`,
      lines: [
        "Moves between hub and env tiles.",
        "Activates the hub structure it sits on in the hub.",
        "Has its own inventory.",
        ...(systemLines.length ? ["Systems:", ...systemLines] : []),
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Layout helper: fan characters when multiple occupy a slot
  // ---------------------------------------------------------------------------
  function layoutAllCharacters() {
    const chars = getCharsSafe();

    const draggedPayload = interactionSafe.getDragged
      ? interactionSafe.getDragged()
      : null;

    const draggedId =
      draggedPayload && draggedPayload.type === "character"
        ? draggedPayload.id
        : null;

    /** @type {Map<string, { row: string, col: number, list: Array<any> }>} */
    const slotsToChars = new Map();

    for (const char of chars) {
      let placement = null;
      if (typeof getPreviewPlacement === "function") {
        placement = getPreviewPlacement(char.id);
      } else if (typeof getPreviewHubCol === "function") {
        const overrideIdx = getPreviewHubCol(char.id);
        if (overrideIdx != null) placement = { hubCol: overrideIdx };
      }

      const envCol = placement
        ? Number.isFinite(placement.envCol)
          ? placement.envCol
          : null
        : Number.isFinite(char.envCol)
        ? char.envCol
        : null;
      const hubCol = placement
        ? Number.isFinite(placement.hubCol)
          ? placement.hubCol
          : null
        : Number.isFinite(char.hubCol)
        ? char.hubCol
        : null;

      const row = Number.isFinite(envCol)
        ? "env"
        : Number.isFinite(hubCol)
        ? "hub"
        : null;
      const col = Number.isFinite(envCol) ? envCol : hubCol;
      if (row == null || col == null) continue;

      const key = `${row}:${col}`;
      let entry = slotsToChars.get(key);
      if (!entry) {
        entry = { row, col, list: [] };
        slotsToChars.set(key, entry);
      }
      entry.list.push(char);
    }

    for (const entry of slotsToChars.values()) {
      const base =
        entry.row === "env"
          ? getBasePosForEnvCol(entry.col)
          : getBasePosForHubCol(entry.col);
      const hoverInfo = getHoverInfoForSlot(entry.row, entry.col);
      const n = entry.list.length;
      if (n === 0) continue;

      const startOffset = -((n - 1) * FAN_SPACING) / 2;

      entry.list.forEach((char, i) => {
        if (draggedId != null && draggedId === char.id) return;

        const view = viewsById.get(char.id);
        if (!view) return;
        const rawPos = {
          x: base.x + startOffset + i * FAN_SPACING,
          y: base.y,
        };
        const scaledPos = applyHoverTransform(rawPos, hoverInfo);
        view.container.x = scaledPos.x;
        view.container.y = scaledPos.y;
        view.attachedScale = scaledPos.scale;
        applyCharacterScale(view);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Create a single character view
  // ---------------------------------------------------------------------------
  function createCharacterView(char) {
    const container = new PIXI.Container();

    const pos = Number.isFinite(char.envCol)
      ? getBasePosForEnvCol(char.envCol)
      : getBasePosForHubCol(char.hubCol);
    container.x = pos.x;
    container.y = pos.y;

    container.eventMode = "static";
    container.cursor = "pointer";

    const fillColor = typeof char.color === "number" ? char.color : 0xaa66ff;

    const shadow = new PIXI.Graphics()
      .beginFill(GAMEPIECE_SHADOW_COLOR, GAMEPIECE_SHADOW_ALPHA)
      .drawCircle(
        GAMEPIECE_SHADOW_OFFSET_X,
        GAMEPIECE_SHADOW_OFFSET_Y,
        RADIUS + 2
      )
      .endFill();
    shadow.visible = false;
    container.addChild(shadow);

    const gfx = new PIXI.Graphics()
      .beginFill(fillColor)
      .drawCircle(0, 0, RADIUS)
      .endFill();
    container.addChild(gfx);

    const outline = new PIXI.Graphics()
      .lineStyle(2, 0x000000, 1)
      .drawCircle(0, 0, RADIUS + 1);
    container.addChild(outline);

    const label = new PIXI.Text(char.name || "", {
      fill: 0xffffff,
      fontSize: 16,
      fontWeight: "bold",
    });
    label.anchor.set(0.5);
    container.addChild(label);

    const flashRing = new PIXI.Graphics();
    flashRing.visible = false;
    container.addChild(flashRing);

    layer.addChild(container);

    // -----------------------------------------------------------------------
    const view = {
      container,
      char,
      outline,
      shadow,
      flashRing,
      flashTimeout: null,
      selfHover: false,
      attachedScale: 1,
      hoverParent: null,
      hoverIndex: null,
    };

    // -----------------------------------------------------------------------
    // Hover UI
    // -----------------------------------------------------------------------
    function showHover() {
      if (!interactionSafe.canShowHoverUI || !interactionSafe.canShowHoverUI())
        return;
      view.selfHover = true;
      applyCharacterScale(view);

      const tt = getTooltipSafe();
      const scale = getEffectiveScale(view);
      const anchor = getScaledAnchorFromCenter(
        container.x,
        container.y,
        RADIUS * 2,
        RADIUS * 2,
        scale
      );
      tt?.show?.({ ...makeCharTooltipSpec(char), scale }, anchor);

      const inv = getInvSafe();
      inv?.showOnHover?.(char.id, anchor);

      interactionSafe.setHovered?.({
        kind: "pawn",
        id: char.id,
        centerX: container.x,
        centerY: container.y,
        scale,
      });
    }

    function hideHover() {
      view.selfHover = false;
      applyCharacterScale(view);
      const inv = getInvSafe();
      inv?.hideOnHoverOut?.(char.id);

      const tt = getTooltipSafe();
      tt?.hide?.();
      interactionSafe.clearHovered?.();
    }

    container.on("pointerover", () => {
      if (interactionSafe.isDragging && interactionSafe.isDragging()) return;
      showHover();
    });

    container.on("pointerout", () => {
      if (interactionSafe.isDragging && interactionSafe.isDragging()) return;
      hideHover();
    });

    // -----------------------------------------------------------------------
    // Dragging logic
    // -----------------------------------------------------------------------
    let pointerDownPos = null;
    let dragging = false;
    let dragOffset = null;

    container.on("pointerdown", (ev) => {
      if (
        interactionSafe.canDragCharacter &&
        !interactionSafe.canDragCharacter()
      ) {
        flashDragBlocked(view);
        return;
      }

      const g = ev.data.global;
      pointerDownPos = { x: g.x, y: g.y };
      dragOffset = { x: container.x - g.x, y: container.y - g.y };

      app.stage.on("pointermove", onMove);
      app.stage.on("pointerup", onUp);
      app.stage.on("pointerupoutside", onUp);
    });

    function tryStartDrag() {
      dragging = true;
      interactionSafe.startDrag?.({ type: "character", id: char.id });
      requestPauseForAction?.();
      view.selfHover = false;
      view.attachedScale = 1;
      applyCharacterScale(view);
      hideHover();
    }

    function onMove(ev) {
      if (!pointerDownPos) return;

      const g = ev.data.global;
      const dx = g.x - pointerDownPos.x;
      const dy = g.y - pointerDownPos.y;

      if (
        !dragging &&
        dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
      ) {
        tryStartDrag();
      }

      if (!dragging) return;

      container.x = g.x + dragOffset.x;
      container.y = g.y + dragOffset.y;
    }

    function onUp(ev) {
      if (!pointerDownPos) return;

      app.stage.off("pointermove", onMove);
      app.stage.off("pointerup", onUp);
      app.stage.off("pointerupoutside", onUp);

      const wasDragging = dragging;
      dragging = false;

      pointerDownPos = null;

      interactionSafe.endDrag?.();

      const g = ev.data.global;

      if (!wasDragging) {
        // click -> toggle pinned inventory (optional)
        const inv = getInvSafe();
        inv?.togglePinned?.(char.id);
        return;
      }

      const dropResult = emitDropped({
        charId: char.id,
        dropPos: { x: g.x, y: g.y },
      });

      // If no handler, restore layout.
      if (!onCharacterDropped && !onDropCharacter) {
        layoutAllCharacters();
        return;
      }

      // For insufficient AP, give the same blocked-drag feedback.
      if (
        dropResult &&
        dropResult.ok === false &&
        dropResult.reason === "insufficientAP"
      ) {
        flashDragBlocked(view);
        layoutAllCharacters();
      }
    }

    applyCharacterScale(view);
    viewsById.set(char.id, view);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function rebuildAll() {
    for (const view of viewsById.values()) {
      if (view.container?.parent) {
        view.container.parent.removeChild(view.container);
      }
    }
    layer.removeChildren();
    viewsById.clear();

    for (const char of getCharsSafe()) {
      createCharacterView(char);
    }

    if (focusGhost && focusGhost.parent) {
      focusGhost.parent.removeChild(focusGhost);
    }
    focusGhost = null;

    layoutAllCharacters();
  }

  function updatePositionsFromModel() {
    layoutAllCharacters();
  }

  function init() {}

  function updateFocus() {
    const intent =
      typeof getFocusIntent === "function" ? getFocusIntent() : null;
    const nextFocused =
      intent && intent.kind === "pawnMove" ? intent.charId : null;
    if (focusedCharId !== nextFocused) {
      focusedCharId = nextFocused;
    }

    for (const [id, view] of viewsById.entries()) {
      const isFocused = focusedCharId != null && id === focusedCharId;
      view.outline.tint = isFocused ? 0xffff66 : 0x000000;
    }

    if (intent && intent.kind === "pawnMove") {
      const fromHub = intent.fromPlacement?.hubCol;
      const fromEnv = intent.fromPlacement?.envCol;
      if (fromHub != null || fromEnv != null) {
        const pos =
          fromEnv != null
            ? getBasePosForEnvCol(fromEnv)
            : getBasePosForHubCol(fromHub);
        if (!focusGhost) {
          focusGhost = new PIXI.Graphics();
          focusGhost.lineStyle(2, 0x7fd0ff, 1);
          focusGhost.beginFill(0xffffff, 0.2);
          focusGhost.drawCircle(0, 0, RADIUS);
          focusGhost.endFill();
          focusGhost.zIndex = 1;
          layer.addChild(focusGhost);
        }
        focusGhost.visible = true;
        focusGhost.x = pos.x;
        focusGhost.y = pos.y;
      } else if (focusGhost) {
        focusGhost.visible = false;
      }
    } else if (focusGhost) {
      focusGhost.visible = false;
    }
  }

  function update() {
    layoutAllCharacters();
    updateFocus();
  }

  return {
    init,
    rebuildAll,
    update,
    updatePositionsFromModel,
    getViewForId: (id) => viewsById.get(id) || null,
  };
}
