// src/views/ui-root/paused-action-queue.js

export function createPausedActionQueue({ runner }) {
  const queuedActions = [];
  let autoPauseOnPlayerAction = false;

  function normalizeActionSpec(actionInput) {
    if (typeof actionInput === "function") {
      return {
        runWhenPaused: actionInput,
        runWhenLive: null,
      };
    }
    if (actionInput && typeof actionInput === "object") {
      const runWhenPaused =
        typeof actionInput.runWhenPaused === "function"
          ? actionInput.runWhenPaused
          : null;
      const runWhenLive =
        typeof actionInput.runWhenLive === "function"
          ? actionInput.runWhenLive
          : null;
      if (runWhenPaused) {
        return { runWhenPaused, runWhenLive };
      }
    }
    return null;
  }

  function executeActionSpec(actionSpec, mode = "paused") {
    if (!actionSpec) return { ok: false, reason: "badActionSpec" };
    const run =
      mode === "live" && typeof actionSpec.runWhenLive === "function"
        ? actionSpec.runWhenLive
        : actionSpec.runWhenPaused;
    if (typeof run !== "function") return { ok: false, reason: "badActionSpec" };
    return run();
  }

  function requestPauseForAction() {
    const state = runner.getCursorState?.();
    if (!state || state.paused || autoPauseOnPlayerAction !== true) return;
    runner.setTimeScaleTarget?.(0, { requestPause: true });
    runner.setPaused(true);
  }

  function queueActionWhenPaused(actionInput) {
    const actionSpec = normalizeActionSpec(actionInput);
    if (!actionSpec) return { ok: false, reason: "badActionSpec" };

    const executeNowOrQueue = () => {
      const res = executeActionSpec(actionSpec, "paused");
      if (res?.ok === false && res.reason === "mustBePaused") {
        queuedActions.push(actionSpec);
        return { ok: true, queued: true };
      }
      return res;
    };

    if (runner.isPreviewing?.()) {
      const commitRes = runner.commitPreviewToLive?.();
      if (commitRes?.ok === false) return commitRes;
      return executeNowOrQueue();
    }

    const state = runner.getCursorState?.();
    if (state?.paused) return executeNowOrQueue();

    if (autoPauseOnPlayerAction !== true) {
      return executeActionSpec(actionSpec, "live");
    }

    requestPauseForAction();
    const afterPauseState = runner.getCursorState?.();
    if (afterPauseState?.paused) {
      return executeNowOrQueue();
    }

    queuedActions.push(actionSpec);
    return { ok: true, queued: true };
  }

  function flushQueuedActions() {
    if (!queuedActions.length) return;
    const state = runner.getCursorState?.();
    if (!state?.paused) return;
    if (runner.isPreviewing?.()) return;

    const pending = queuedActions.splice(0, queuedActions.length);
    for (const actionSpec of pending) {
      const res = executeActionSpec(actionSpec, "paused");
      if (res?.ok === false && res.reason === "mustBePaused") {
        queuedActions.push(actionSpec);
      }
    }
  }

  function clearQueuedActions() {
    queuedActions.length = 0;
  }

  function setAutoPauseOnPlayerAction(enabled) {
    autoPauseOnPlayerAction = enabled === true;
    return { ok: true, enabled: autoPauseOnPlayerAction };
  }

  function isAutoPauseOnPlayerActionEnabled() {
    return autoPauseOnPlayerAction === true;
  }

  return {
    requestPauseForAction,
    queueActionWhenPaused,
    flushQueuedActions,
    clearQueuedActions,
    setAutoPauseOnPlayerAction,
    isAutoPauseOnPlayerActionEnabled,
  };
}
