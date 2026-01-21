// characters-pixi.js
//
// Responsible for rendering characters and wiring their UI behaviour
// (hover tooltip, hover inventory, click-to-toggle inventory, dragging).
//
// VIEW-ONLY: does NOT depend on model slot.x/slot.y. Positions are derived
// from the same layout math used by board-pixi.js.
//
// Compatibility:
// - Supports both older opts { getCharacters, getPermanentSlots, interaction, tooltipView, inventoryView, onCharacterDropped }
// - And newer opts { getGameState, onDropCharacter } (used by current ui-root-pixi.js)

import {
  BOARD_COLS,
  HUB_COLS,
  PERM_WIDTH,
  TILE_WIDTH,
  TILE_ROW_Y,
  layoutBoardColPos,
  layoutPermPos,
} from "./layout-pixi.js";

export function createCharactersView(opts) {
  const {
    app,
    layer,

    // old shape
    getCharacters,
    getPermanentSlots,
    interaction,
    tooltipView,
    inventoryView,
    onCharacterDropped,

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
    if (typeof getPermanentSlots === "function") {
      const slots = getPermanentSlots() || [];
      if (Array.isArray(slots) && slots.length > 0) return slots.length;
    }
    const s = getStateSafe();
    const slots = s?.permanentSlots;
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
    if (typeof cb === "function") cb(payload);
  }

  // ---------------------------------------------------------------------------
  // Positioning
  // ---------------------------------------------------------------------------

  // Centre above a permanent card at hubCol
  function getBasePosForHubCol(hubCol) {
    const cols = getHubColsSafe();

    if (!cols || hubCol == null || hubCol < 0 || hubCol >= cols) {
      return { x: 200 + (hubCol ?? 0) * 220, y: 380 };
    }

    const pos = layoutPermPos(app.screen.width, hubCol);
    const centerX = pos.x + PERM_WIDTH / 2;
    const topY = pos.y;
    return { x: centerX, y: topY - 30 };
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
    return { x: centerX, y: topY - 30 };
  }

  // ---------------------------------------------------------------------------
  // Tooltip spec
  // ---------------------------------------------------------------------------
  function makeCharTooltipSpec(char) {
    return {
      title: char.name || `Character ${char.id ?? ""}`,
      lines: [
        "Moves between hub and env tiles.",
        "Activates the permanent it sits on in the hub.",
        "Has its own inventory.",
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
      const n = entry.list.length;
      if (n === 0) continue;

      const startOffset = -((n - 1) * FAN_SPACING) / 2;

      entry.list.forEach((char, i) => {
        if (draggedId != null && draggedId === char.id) return;

        const view = viewsById.get(char.id);
        if (!view) return;
        view.container.x = base.x + startOffset + i * FAN_SPACING;
        view.container.y = base.y;
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

    layer.addChild(container);

    // -----------------------------------------------------------------------
    // Hover UI
    // -----------------------------------------------------------------------
    function showHover() {
      if (!interactionSafe.canShowHoverUI || !interactionSafe.canShowHoverUI())
        return;

      const tt = getTooltipSafe();
      tt?.show?.(makeCharTooltipSpec(char), {
        x: container.x - RADIUS,
        y: container.y - RADIUS,
        width: RADIUS * 2,
        height: RADIUS * 2,
      });

      const inv = getInvSafe();
      inv?.showOnHover?.(char.id, {
        x: container.x - RADIUS,
        y: container.y - RADIUS,
        width: RADIUS * 2,
        height: RADIUS * 2,
      });
    }

    function hideHover() {
      const inv = getInvSafe();
      inv?.hideOnHoverOut?.(char.id);

      const tt = getTooltipSafe();
      tt?.hide?.();
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
      )
        return;

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

      emitDropped({
        charId: char.id,
        dropPos: { x: g.x, y: g.y },
      });

      // If no handler, restore layout.
      if (!onCharacterDropped && !onDropCharacter) {
        layoutAllCharacters();
      }
    }

    viewsById.set(char.id, { container, char, outline });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function rebuildAll() {
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
