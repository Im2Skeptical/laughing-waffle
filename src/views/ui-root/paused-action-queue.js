// src/views/ui-root/paused-action-queue.js

export function createPausedActionQueue({ runner }) {
  const queuedActions = [];

  function requestPauseForAction() {
    const state = runner.getCursorState?.();
    if (!state || state.paused) return;
    runner.setTimeScaleTarget?.(0, { requestPause: true });
    runner.setPaused(true);
  }

  function queueActionWhenPaused(actionFn) {
    const executeNowOrQueue = () => {
      const res = actionFn();
      if (res?.ok === false && res.reason === "mustBePaused") {
        queuedActions.push(actionFn);
        return { ok: true, queued: true };
      }
      return res;
    };

    const state = runner.getCursorState?.();
    if (state?.paused) return executeNowOrQueue();

    requestPauseForAction();
    const afterPauseState = runner.getCursorState?.();
    if (afterPauseState?.paused && !(runner.isPreviewing?.())) {
      return executeNowOrQueue();
    }

    queuedActions.push(actionFn);
    return { ok: true, queued: true };
  }

  function flushQueuedActions() {
    if (!queuedActions.length) return;
    const state = runner.getCursorState?.();
    if (!state?.paused) return;
    if (runner.isPreviewing?.()) return;

    const pending = queuedActions.splice(0, queuedActions.length);
    for (const fn of pending) {
      const res = fn();
      if (res?.ok === false && res.reason === "mustBePaused") {
        queuedActions.push(fn);
      }
    }
  }

  function clearQueuedActions() {
    queuedActions.length = 0;
  }

  return {
    requestPauseForAction,
    queueActionWhenPaused,
    flushQueuedActions,
    clearQueuedActions,
  };
}
