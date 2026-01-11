// views/interaction-controller-pixi.js
// Centralised interaction / phase rules for the Pixi UI.
//
// This module **does not** know about Pixi containers or game rules in detail.
// It just tracks:
//   - what is being dragged
//   - what is hovered (optional for later)
//   - what phase we’re in (planning vs simulation)
// and exposes helpers that other view modules can query.

export const InteractionPhase = {
  PLANNING: "planning",
  SIMULATION: "simulation",
};

export function createInteractionController({ getPhase }) {
  const state = {
    dragged: null, // { type, id }  e.g. { type: "character", id: "char-1" }
    hovered: null, // { type, id }  (optional; handy for future UI)
  };

  function init() {
    // currently nothing
  }

  function update(dt) {
    // currently nothing
  }
  // --- phase helpers -------------------------------------------------------

  function getCurrentPhase() {
    return getPhase();
  }

  function isPlanningPhase() {
    return getCurrentPhase() === InteractionPhase.PLANNING;
  }

  function isSimulationPhase() {
    return getCurrentPhase() === InteractionPhase.SIMULATION;
  }

  // --- drag helpers --------------------------------------------------------

  /**
   * Start dragging something.
   * payload: { type: "character" | "item" | "window" | string, id: string }
   */
  function startDrag(payload) {
    state.dragged = payload;
  }

  function endDrag() {
    state.dragged = null;
  }

  function getDragged() {
    return state.dragged;
  }

  function isDragging() {
    return !!state.dragged;
  }

  function isDraggingType(type) {
    return !!state.dragged && state.dragged.type === type;
  }

  // --- hover helpers -------------------------------------------------------

  function setHovered(payload) {
    state.hovered = payload; // or null
  }

  function clearHovered() {
    state.hovered = null;
  }

  function getHovered() {
    return state.hovered;
  }

  // --- policy helpers (what the rest of the UI really cares about) ---------

  // Can we start dragging a character right now?
  function canDragCharacter() {
    // For your requirements:
    //  - characters should NOT move during simulation phase.
    return isPlanningPhase();
  }

  // Should hover tooltips / inventories be allowed to show?
  function canShowHoverUI() {
    // While *anything* is being dragged, we want to suppress hover popups.
    // (This is what stops the “character tooltip reappears while dragging”
    //  bug you described.)
    return !isDragging();
  }

  // --- character helpers -------------------------------------------------------

  let draggingCharacter = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function beginCharacterDrag(view, globalPos) {
    draggingCharacter = view;
    const parent = view.container.parent;
    const local = parent.toLocal(globalPos);
    dragOffsetX = view.container.x - local.x;
    dragOffsetY = view.container.y - local.y;
  }

  function updateCharacterDrag(globalPos) {
    if (!draggingCharacter) return;
    const parent = draggingCharacter.container.parent;
    const local = parent.toLocal(globalPos);
    draggingCharacter.container.x = local.x + dragOffsetX;
    draggingCharacter.container.y = local.y + dragOffsetY;
  }

  function endCharacterDrag(globalPos) {
    const v = draggingCharacter;
    draggingCharacter = null;
    return v;
  }

  function isDraggingCharacter() {
    return !!draggingCharacter;
  }

  function getDraggingCharacter() {
    return draggingCharacter;
  }

  return {
    init,
    update,

    // phase
    getCurrentPhase,
    isPlanningPhase,
    isSimulationPhase,

    // drag
    startDrag,
    endDrag,
    getDragged,
    isDragging,
    isDraggingType,

    // hover
    setHovered,
    clearHovered,
    getHovered,

    // policies
    canDragCharacter,
    canShowHoverUI,

    // character helpers
    beginCharacterDrag,
    updateCharacterDrag,
    endCharacterDrag,
    isDraggingCharacter,
    getDraggingCharacter,
    canShowHoverUI,
  };
}
