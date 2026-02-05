// pill-drag-controller.js
// Shared drag-to-reorder helper for pill lists (tags, routing endpoints, etc).

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
    }

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
      moved: false,
      stageMove: null,
      stageUp: null,
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
      const localPos = container.toLocal(moveEv.data.global);
      const maxY = Math.max(0, (entries.length - 1) * rowStep);
      const nextY = Math.max(0, Math.min(maxY, localPos.y - drag.offsetY));
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

