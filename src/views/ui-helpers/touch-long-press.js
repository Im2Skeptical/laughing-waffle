// touch-long-press.js
// Helper for explicit touch long-press interactions on Pixi display objects.

function getPointerType(event) {
  return event?.pointerType ?? event?.data?.pointerType ?? "";
}

function isTouchLikePointer(event) {
  const pointerType = getPointerType(event);
  return pointerType === "touch" || pointerType === "pen";
}

function getPointerId(event) {
  const id = event?.pointerId ?? event?.data?.pointerId;
  return Number.isFinite(id) ? Math.floor(id) : null;
}

function getGlobalPoint(event) {
  const point = event?.global ?? event?.data?.global ?? null;
  if (!point) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: point.x, y: point.y };
}

export function bindTouchLongPress({
  app,
  target,
  holdMs = 420,
  moveTolerancePx = 10,
  shouldStart,
  onLongPress,
  onEnd,
} = {}) {
  if (!target || !app?.stage?.on || !app?.stage?.off) {
    return {
      consumeTap: () => false,
      cancel: () => {},
    };
  }

  let pointerId = null;
  let startPos = null;
  let timerId = null;
  let active = false;
  let longPressTriggered = false;
  let consumeTapFlag = false;

  function clearTimer() {
    if (timerId == null) return;
    clearTimeout(timerId);
    timerId = null;
  }

  function cleanupStageListeners() {
    app.stage.off("pointermove", handleStageMove);
    app.stage.off("pointerup", handleStageUp);
    app.stage.off("pointerupoutside", handleStageUp);
    app.stage.off("pointercancel", handleStageUp);
  }

  function resetState() {
    clearTimer();
    cleanupStageListeners();
    pointerId = null;
    startPos = null;
    active = false;
    longPressTriggered = false;
  }

  function pointerMatches(event) {
    if (!active) return false;
    if (pointerId == null) return true;
    const nextPointerId = getPointerId(event);
    return nextPointerId == null || nextPointerId === pointerId;
  }

  function cancelBeforeTrigger() {
    if (!active) return;
    if (longPressTriggered) return;
    resetState();
  }

  function handleStageMove(event) {
    if (!pointerMatches(event)) return;
    if (longPressTriggered) return;
    const currentPos = getGlobalPoint(event);
    if (!currentPos || !startPos) return;
    const dx = currentPos.x - startPos.x;
    const dy = currentPos.y - startPos.y;
    const distanceSq = dx * dx + dy * dy;
    const tolerance = Math.max(1, Number(moveTolerancePx) || 10);
    if (distanceSq > tolerance * tolerance) {
      cancelBeforeTrigger();
    }
  }

  function handleStageUp(event) {
    if (!pointerMatches(event)) return;
    const wasTriggered = longPressTriggered;
    resetState();
    if (!wasTriggered) return;
    onEnd?.(event);
  }

  function beginPress(event) {
    if (!isTouchLikePointer(event)) return;
    if (typeof shouldStart === "function" && !shouldStart(event)) return;

    resetState();
    active = true;
    pointerId = getPointerId(event);
    startPos = getGlobalPoint(event);
    longPressTriggered = false;

    app.stage.on("pointermove", handleStageMove);
    app.stage.on("pointerup", handleStageUp);
    app.stage.on("pointerupoutside", handleStageUp);
    app.stage.on("pointercancel", handleStageUp);

    const hold = Math.max(120, Number(holdMs) || 420);
    timerId = setTimeout(() => {
      if (!active) return;
      longPressTriggered = true;
      consumeTapFlag = true;
      clearTimer();
      onLongPress?.(event);
    }, hold);
  }

  target.on("pointerdown", beginPress);

  return {
    consumeTap() {
      if (!consumeTapFlag) return false;
      consumeTapFlag = false;
      return true;
    },
    cancel() {
      resetState();
      consumeTapFlag = false;
    },
  };
}
