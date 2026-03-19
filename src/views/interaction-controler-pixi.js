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
    dragged: null, // { type, id }  e.g. { type: "pawn", id: "pawn-1" }
    hovered: null, // anchor hover (tile/hub/event)
    hoveredPawn: null,
    lastHovered: null,
    pointerStagePos: null,
    worldUiOcclusionResolver: null,
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
   * payload: { type: "pawn" | "item" | "window" | string, id: string }
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
    if (payload) state.lastHovered = payload;
  }

  function setHoveredPawn(payload) {
    state.hoveredPawn = payload;
    if (payload) state.lastHovered = payload;
  }

  function clearHovered() {
    state.hovered = null;
  }

  function clearHoveredPawn() {
    state.hoveredPawn = null;
  }

  function getHovered() {
    return state.hovered;
  }

  function getHoveredPawn() {
    return state.hoveredPawn;
  }

  function getLastHovered() {
    return state.hoveredPawn || state.lastHovered || state.hovered;
  }

  // --- policy helpers (what the rest of the UI really cares about) ---------

  // Can we start dragging a pawn right now?
  function canDragPawn() {
    return true;
  }

  // Should hover tooltips / inventories be allowed to show?
  function canShowHoverUI() {
    // While *anything* is being dragged, we want to suppress hover popups.
    // (This is what stops the "pawn tooltip reappears while dragging"
    //  bug you described.)
    return !isDragging();
  }

  function setPointerStagePos(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      state.pointerStagePos = null;
      return;
    }
    state.pointerStagePos = {
      x: Number(point.x),
      y: Number(point.y),
    };
  }

  function getPointerStagePos() {
    return state.pointerStagePos;
  }

  function setWorldUiOcclusionResolver(resolver) {
    state.worldUiOcclusionResolver =
      typeof resolver === "function" ? resolver : null;
  }

  function isWorldUiOccludedAt(point = state.pointerStagePos) {
    if (typeof state.worldUiOcclusionResolver !== "function") return false;
    return state.worldUiOcclusionResolver(point) === true;
  }

  function canShowWorldHoverUI(point = state.pointerStagePos) {
    return canShowHoverUI() && !isWorldUiOccludedAt(point);
  }

  // --- pawn helpers -------------------------------------------------------

  let draggingPawn = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function beginPawnDrag(view, globalPos) {
    draggingPawn = view;
    const parent = view.container.parent;
    const local = parent.toLocal(globalPos);
    dragOffsetX = view.container.x - local.x;
    dragOffsetY = view.container.y - local.y;
  }

  function updatePawnDrag(globalPos) {
    if (!draggingPawn) return;
    const parent = draggingPawn.container.parent;
    const local = parent.toLocal(globalPos);
    draggingPawn.container.x = local.x + dragOffsetX;
    draggingPawn.container.y = local.y + dragOffsetY;
  }

  function endPawnDrag(globalPos) {
    const v = draggingPawn;
    draggingPawn = null;
    return v;
  }

  function isDraggingPawn() {
    return !!draggingPawn;
  }

  function getDraggingPawn() {
    return draggingPawn;
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
    setHoveredPawn,
    clearHovered,
    clearHoveredPawn,
    getHovered,
    getHoveredPawn,
    getLastHovered,

    // policies
    canDragPawn,
    canShowHoverUI,
    setPointerStagePos,
    getPointerStagePos,
    setWorldUiOcclusionResolver,
    isWorldUiOccludedAt,
    canShowWorldHoverUI,

    // pawn helpers
    beginPawnDrag,
    updatePawnDrag,
    endPawnDrag,
    isDraggingPawn,
    getDraggingPawn,
  };
}
