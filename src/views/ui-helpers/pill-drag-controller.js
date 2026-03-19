// pill-drag-controller.js
// Shared drag-to-reorder helper for pill lists (tags, routing endpoints, etc).

import { getDisplayObjectWorldScale } from "./display-object-scale.js";

export function createPillDragController(opts = {}) {
  const {
    app,
    getEntries,
    getContainer,
    getRowStep,
    getRowHeight,
    layoutEntries,
    onCommit,
    onDragStart,
    onDragEnd,
    dragStateKey = "dragState",
    dragScale = 1.06,
    dragAlpha = 0.95,
    dragZIndex = 10,
    dragCursor = "grabbing",
    idleCursor = "grab",
  } = opts;

  let activeView = null;

  function eventIndicatesReleased(ev) {
    if (!ev || typeof ev !== "object") return false;
    if (ev.type === "touchend" || ev.type === "touchcancel") return true;
    if (Number.isFinite(ev.buttons)) return ev.buttons === 0;
    if (Number.isFinite(ev.which)) return ev.which === 0;
    return false;
  }

  function removeGlobalEndListeners(drag) {
    if (!drag || typeof window === "undefined") return;
    if (typeof drag.windowPointerUp === "function") {
      window.removeEventListener("pointerup", drag.windowPointerUp, true);
      window.removeEventListener("mouseup", drag.windowPointerUp, true);
      window.removeEventListener("touchend", drag.windowPointerUp, true);
      window.removeEventListener("touchcancel", drag.windowPointerUp, true);
      drag.windowPointerUp = null;
    }
    if (typeof drag.windowPointerMove === "function") {
      window.removeEventListener("pointermove", drag.windowPointerMove, true);
      window.removeEventListener("mousemove", drag.windowPointerMove, true);
      window.removeEventListener("touchmove", drag.windowPointerMove, true);
      drag.windowPointerMove = null;
    }
    if (typeof drag.windowBlur === "function") {
      window.removeEventListener("blur", drag.windowBlur, true);
      drag.windowBlur = null;
    }
  }

  function endDrag(view, commit, globalPos = null) {
    if (!view) return;
    const drag = view[dragStateKey];
    if (!drag) return;

    if (drag.entry?.container) {
      drag.entry.container.scale.set(1);
      drag.entry.container.alpha = 1;
      drag.entry.container.zIndex = 0;
      drag.entry.container.cursor = idleCursor;
    }

    if (commit && drag.targetIndex !== drag.startIndex) {
      if (typeof onCommit === "function") {
        onCommit(view, drag.startIndex, drag.targetIndex, drag);
      }
    }

    if (drag.stageMove && app?.stage) {
      app.stage.off("pointermove", drag.stageMove);
      app.stage.off("pointerup", drag.stageUp);
      app.stage.off("pointerupoutside", drag.stageUp);
      app.stage.off("pointercancel", drag.stageUp);
    }
    removeGlobalEndListeners(drag);

    view[dragStateKey] = null;
    if (activeView === view) activeView = null;

    if (typeof layoutEntries === "function") {
      layoutEntries(view);
    }

    if (typeof onDragEnd === "function") {
      onDragEnd(view, drag, globalPos);
    }
  }

  function startDrag(view, entry, ev) {
    if (!view || !entry || !app?.stage) return;
    const entries = typeof getEntries === "function" ? getEntries(view) : null;
    if (!Array.isArray(entries)) return;

    if (activeView && activeView !== view) {
      endDrag(activeView, false, null);
    }

    const startIndex = entries.indexOf(entry);
    if (startIndex < 0) return;

    const container =
      typeof getContainer === "function" ? getContainer(view) : null;
    if (!container || !container.toLocal) return;

    ev?.stopPropagation?.();

    const local = container.toLocal(ev.data.global);
    const offsetY = local.y - entry.container.y;

    const dragState = {
      entry,
      startIndex,
      targetIndex: startIndex,
      offsetY,
      startY: entry.container.y,
      startGlobalY: Number(ev?.data?.global?.y) || 0,
      currentGlobalPos: ev?.data?.global
        ? {
            x: Number(ev.data.global.x) || 0,
            y: Number(ev.data.global.y) || 0,
          }
        : null,
      moved: false,
      stageMove: null,
      stageUp: null,
      windowPointerUp: null,
      windowPointerMove: null,
      windowBlur: null,
    };

    view[dragStateKey] = dragState;
    activeView = view;

    if (typeof onDragStart === "function") {
      onDragStart(view, dragState);
    }

    entry.container.scale.set(dragScale);
    entry.container.alpha = dragAlpha;
    entry.container.zIndex = dragZIndex;
    entry.container.cursor = dragCursor;

    const rowHeight =
      typeof getRowHeight === "function"
        ? getRowHeight(view, entry, entries)
        : Number.isFinite(getRowHeight)
        ? getRowHeight
        : 0;
    const rowStep =
      typeof getRowStep === "function"
        ? getRowStep(view, entry, entries)
        : Number.isFinite(getRowStep)
        ? getRowStep
        : rowHeight;

    const onMove = (moveEv) => {
      const drag = view[dragStateKey];
      if (!drag) return;
      const nativeMoveEv = moveEv?.data?.originalEvent ?? moveEv?.data?.nativeEvent ?? null;
      if (eventIndicatesReleased(nativeMoveEv)) {
        endDrag(view, true, drag.currentGlobalPos ?? null);
        return;
      }
      const globalY = Number(moveEv?.data?.global?.y) || drag.startGlobalY;
      drag.currentGlobalPos = moveEv?.data?.global
        ? {
            x: Number(moveEv.data.global.x) || 0,
            y: Number(moveEv.data.global.y) || 0,
          }
        : drag.currentGlobalPos;
      const worldScale = Math.max(0.001, getDisplayObjectWorldScale(container, 1));
      const maxY = Math.max(0, (entries.length - 1) * rowStep);
      const nextY = Math.max(
        0,
        Math.min(maxY, drag.startY + (globalY - drag.startGlobalY) / worldScale)
      );
      drag.entry.container.y = nextY;
      if (Math.abs(nextY - drag.startY) > 2) {
        drag.moved = true;
      }

      const centerY = nextY + rowHeight / 2;
      const nextIndex = Math.max(
        0,
        Math.min(entries.length - 1, Math.floor(centerY / rowStep))
      );

      if (nextIndex !== drag.targetIndex) {
        drag.targetIndex = nextIndex;
        drag.moved = true;
        if (typeof layoutEntries === "function") {
          layoutEntries(view);
        }
      }
    };

    const onUp = (upEv) => {
      endDrag(view, true, upEv?.data?.global ?? null);
    };

    dragState.stageMove = onMove;
    dragState.stageUp = onUp;

    app.stage.on("pointermove", onMove);
    app.stage.on("pointerup", onUp);
    app.stage.on("pointerupoutside", onUp);
    app.stage.on("pointercancel", onUp);

    if (typeof window !== "undefined") {
      const onWindowPointerUp = () => {
        const activeDrag = view[dragStateKey];
        endDrag(view, true, activeDrag?.currentGlobalPos ?? null);
      };
      const onWindowPointerMove = (windowEv) => {
        const activeDrag = view[dragStateKey];
        if (!activeDrag) return;
        if (!eventIndicatesReleased(windowEv)) return;
        endDrag(view, true, activeDrag.currentGlobalPos ?? null);
      };
      const onWindowBlur = () => {
        const activeDrag = view[dragStateKey];
        endDrag(view, false, activeDrag?.currentGlobalPos ?? null);
      };
      dragState.windowPointerUp = onWindowPointerUp;
      dragState.windowPointerMove = onWindowPointerMove;
      dragState.windowBlur = onWindowBlur;
      window.addEventListener("pointerup", onWindowPointerUp, true);
      window.addEventListener("mouseup", onWindowPointerUp, true);
      window.addEventListener("touchend", onWindowPointerUp, true);
      window.addEventListener("touchcancel", onWindowPointerUp, true);
      window.addEventListener("pointermove", onWindowPointerMove, true);
      window.addEventListener("mousemove", onWindowPointerMove, true);
      window.addEventListener("touchmove", onWindowPointerMove, true);
      window.addEventListener("blur", onWindowBlur, true);
    }

    if (typeof layoutEntries === "function") {
      layoutEntries(view);
    }
  }

  function cancelActive() {
    if (activeView) endDrag(activeView, false, null);
  }

  function getActiveView() {
    return activeView;
  }

  return {
    startDrag,
    endDrag,
    cancelActive,
    getActiveView,
  };
}

