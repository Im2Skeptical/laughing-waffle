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

import { PERM_WIDTH, layoutPermPos } from "./layout-pixi.js";

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
  } = opts;

  const viewsById = new Map();
  const DRAG_THRESHOLD_PX = 3;
  const FAN_SPACING = 40;
  const RADIUS = 30;

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

  function getPermanentSlotsSafe() {
    if (typeof getPermanentSlots === "function")
      return getPermanentSlots() || [];
    const s = getStateSafe();
    return s?.permanentSlots || [];
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

  // Centre above a permanent card at slotIndex
  function getBasePosForSlotIndex(slotIndex) {
    const slots = getPermanentSlotsSafe();
    const count = Array.isArray(slots) ? slots.length : 0;

    if (!count || slotIndex == null || slotIndex < 0 || slotIndex >= count) {
      return { x: 200 + (slotIndex ?? 0) * 220, y: 380 };
    }

    const pos = layoutPermPos(app.screen.width, slotIndex, count);
    const centerX = pos.x + PERM_WIDTH / 2;
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
        "Moves between permanents.",
        "Activates the permanent it sits on.",
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

    /** @type {Map<number, Array<any>>} */
    const slotsToChars = new Map();

    for (const char of chars) {
      const idx = char.slotIndex;
      if (idx == null) continue;
      let list = slotsToChars.get(idx);
      if (!list) {
        list = [];
        slotsToChars.set(idx, list);
      }
      list.push(char);
    }

    for (const [slotIndex, list] of slotsToChars.entries()) {
      const base = getBasePosForSlotIndex(slotIndex);
      const n = list.length;
      if (n === 0) continue;

      const startOffset = -((n - 1) * FAN_SPACING) / 2;

      list.forEach((char, i) => {
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

    const pos = getBasePosForSlotIndex(char.slotIndex);
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

    viewsById.set(char.id, { container, char });
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

    layoutAllCharacters();
  }

  function updatePositionsFromModel() {
    layoutAllCharacters();
  }

  function init() {}

  function update() {
    layoutAllCharacters();
  }

  return {
    init,
    rebuildAll,
    update,
    updatePositionsFromModel,
    getViewForId: (id) => viewsById.get(id) || null,
  };
}
