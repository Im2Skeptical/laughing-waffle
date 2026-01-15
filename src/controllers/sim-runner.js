// src/controllers/sim-runner.js
// Simulation runner (fixed-step, second-boundary pause, replay injection)

import {
  initGameState,
  updateGame,
  setPaused,
  loadIntoGameState,
  gameState,
} from "../model/game-model.js";

import {
  createTimelineFromInitialState,
  appendActionAtCursor,
  truncateActionsAfterSecond,
  truncateCheckpointsAfterSecond,
  rebuildStateAtSecond,
  maintainCheckpoints,
} from "../model/timeline.js";

import { serializeGameState, syncPhaseToPaused } from "../model/state.js";
import { applyAction } from "../model/actions.js";

const SIM_DT_STEP = 1 / 60;
const TICKS_PER_SEC = 60;
const MAX_SIM_STEPS_PER_FRAME = 8;
const TIME_SCALE_MAX = 16;
const TIME_SCALE_EASE_PER_SEC = 10;

export function createSimRunner({ onInvalidate, onRebuildViews }) {
  // State
  let timeline = null;
  let cursorState = null;
  let dragPreviewState = null;
  let simAccumulator = 0;

  let pauseRequested = false;

  // Playback / Live Replay State
  let playbackNextActionIdx = 0;
  let playbackLastAppliedSec = -1;
  let playbackActive = false;

  // Time control (time lever)
  let timeScaleTarget = 1;
  let timeScaleCurrent = 1;
  let timeScaleWantsUnpause = false;
  let rewindAccumulatorSec = 0;

  function seekPlaybackIndex(targetSec) {
    if (!timeline?.actions) {
      playbackNextActionIdx = 0;
      return;
    }

    let idx = 0;
    while (idx < timeline.actions.length) {
      const a = timeline.actions[idx];
      // In rebuildStateAtSecond, we APPLY actions at targetSec.
      // So we want next index to be the first action strictly AFTER targetSec.
      if ((a.tSec ?? 0) > targetSec) break;
      idx++;
    }

    playbackNextActionIdx = idx;
    playbackLastAppliedSec = targetSec;
  }

  // Apply any pending playback actions scheduled for this exact second.
  // IMPORTANT: This advances playbackNextActionIdx and sets playbackLastAppliedSec,
  // so actions at this second are NOT duplicated later (e.g. after unpausing).
  function applyPlaybackActionsForSecond(tSec) {
    if (!playbackActive) return;
    if (!timeline?.actions) return;
    if (playbackLastAppliedSec === tSec) return;

    while (playbackNextActionIdx < timeline.actions.length) {
      const action = timeline.actions[playbackNextActionIdx];
      const aSec = Math.floor(action.tSec ?? 0);

      if (aSec < tSec) {
        playbackNextActionIdx++;
        continue;
      }
      if (aSec === tSec) {
        const res = applyAction(cursorState, action, { isReplay: true });
        if (res && !res.ok) {
          console.warn(`Live Replay failed at t=${tSec}`, res);
        }
        playbackNextActionIdx++;
        continue;
      }
      break; // aSec > tSec
    }

    playbackLastAppliedSec = tSec;
  }

  function clampTimeScale(v) {
    if (!Number.isFinite(v)) return 1;
    return Math.max(-TIME_SCALE_MAX, Math.min(TIME_SCALE_MAX, v));
  }

  function updateTimeScale(frameDt) {
    if (!Number.isFinite(frameDt) || frameDt <= 0) return;
    const target = timeScaleTarget;
    const cur = timeScaleCurrent;
    if (cur === target) return;

    const maxDelta = TIME_SCALE_EASE_PER_SEC * frameDt;
    const delta = target - cur;
    if (Math.abs(delta) <= maxDelta) {
      timeScaleCurrent = target;
    } else {
      timeScaleCurrent = cur + Math.sign(delta) * maxDelta;
    }
  }

  function getMaxSimStepsForSpeed(speed) {
    const abs = Math.abs(speed);
    const scaled = Math.ceil(abs * 2);
    return Math.max(MAX_SIM_STEPS_PER_FRAME, scaled);
  }

  function seekCursorSecond(tSec, stateData, opts = {}) {
    if (!timeline) return { ok: false, reason: "noTimeline" };
    const t = Math.max(0, Math.floor(tSec));

    pauseRequested = false;
    dragPreviewState = null;

    let usedCachedState = false;
    if (stateData != null) {
      loadIntoGameState(stateData);
      cursorState = gameState;
      usedCachedState = Math.floor(cursorState.tSec ?? -1) === t;
    }

    if (!usedCachedState) {
      const rebuilt = rebuildStateAtSecond(timeline, t);
      if (!rebuilt.ok) return rebuilt;

      loadIntoGameState(serializeGameState(rebuilt.state));
      cursorState = gameState;
    }

    const prevMax = Math.floor(timeline.maxReachedSec ?? 0);

    // Keep checkpoints unpaused for replay safety.
    setPaused(cursorState, false);
    syncPhaseToPaused(cursorState);

    if (t > prevMax) timeline.maxReachedSec = t;
    timeline.cursorSec = t;

    if (opts.maintainCheckpoints !== false) {
      maintainCheckpoints(timeline, cursorState);
    }

    playbackActive = t < prevMax;
    seekPlaybackIndex(t);

    if (typeof opts.paused === "boolean") {
      setPaused(cursorState, opts.paused);
      syncPhaseToPaused(cursorState);
    }

    return { ok: true, usedCachedState };
  }

  function applyTimeRewind(frameDt, speedAbs, keepPauseRequested) {
    if (!cursorState) return false;

    const prevPauseRequested = pauseRequested;

    rewindAccumulatorSec += frameDt * speedAbs;
    const rawSteps = Math.floor(rewindAccumulatorSec);
    if (rawSteps <= 0) return false;

    rewindAccumulatorSec -= rawSteps;

    const currentSec = Math.floor(cursorState.tSec ?? 0);
    if (currentSec <= 0) {
      rewindAccumulatorSec = 0;
      return false;
    }

    const steps = Math.min(rawSteps, currentSec);
    const targetSec = Math.max(0, currentSec - steps);
    if (targetSec === currentSec) return false;

    const res = seekCursorSecond(targetSec, null, {
      paused: false,
      maintainCheckpoints: false,
    });
    if (!res.ok) return false;

    if (keepPauseRequested) {
      pauseRequested = prevPauseRequested;
    }

    return true;
  }

  // API
  return {
    init() {
      initGameState(gameState, "testing");
      cursorState = gameState;

      syncPhaseToPaused(cursorState);

      timeline = createTimelineFromInitialState(cursorState);

      // Ensure cursors match genesis
      timeline.cursorSec = 0;
      timeline.maxReachedSec = 0;

      pauseRequested = false;
      playbackActive = false;
      timeScaleTarget = 1;
      timeScaleCurrent = 1;
      timeScaleWantsUnpause = false;
      rewindAccumulatorSec = 0;
      simAccumulator = 0;

      // Initial checkpoint
      timeline.checkpoints = [
        {
          checkpointSec: 0,
          appliedThroughSec: 0,
          stateData: serializeGameState(cursorState),
        },
      ];

      maintainCheckpoints(timeline, cursorState);
      seekPlaybackIndex(Math.floor(cursorState.tSec ?? 0));

      onRebuildViews?.();
      onInvalidate?.("init");
    },

    update(frameDt) {
      if (dragPreviewState) return;

      updateTimeScale(frameDt);
      const speed = timeScaleCurrent;

      if (speed < 0) {
        simAccumulator = 0;
        if (timeScaleWantsUnpause && cursorState?.paused) {
          setPaused(cursorState, false);
          syncPhaseToPaused(cursorState);
        }
        if (timeScaleTarget < 0) {
          pauseRequested = false;
        }

        const moved = applyTimeRewind(
          frameDt,
          Math.abs(speed),
          timeScaleTarget === 0
        );
        if (moved) {
          onRebuildViews?.();
          onInvalidate?.("scrubCommit");
        }
        return;
      }

      const effectiveSpeed =
        pauseRequested && !cursorState?.paused ? Math.max(speed, 1) : speed;

      if (effectiveSpeed <= 0) return;

      if (timeScaleWantsUnpause && cursorState?.paused) {
        setPaused(cursorState, false);
        syncPhaseToPaused(cursorState);
      }

      simAccumulator += frameDt * effectiveSpeed;
      let steps = 0;
      const maxSteps = getMaxSimStepsForSpeed(effectiveSpeed);

      while (simAccumulator >= SIM_DT_STEP && steps < maxSteps) {
        const isPhysicallyPaused = cursorState.paused;

        if (isPhysicallyPaused) {
          simAccumulator = 0;
          break;
        }

        if (pauseRequested) {
          const idx = cursorState.simStepIndex || 0;
          if (idx > 0 && idx % TICKS_PER_SEC === 0) {
            // We have arrived exactly on a second boundary: commit the pause.
            // Before breaking out, apply actions scheduled for this second (if in playback),
            // and advance playback cursors to avoid duplication.
            const tSec = Math.floor(idx / TICKS_PER_SEC);

            setPaused(cursorState, true);

            syncPhaseToPaused(cursorState);

            pauseRequested = false;

            // NEW: ensure recorded actions at this second are visible while paused
            applyPlaybackActionsForSecond(tSec);

            simAccumulator = 0;
            break;
          }
        }

        // --- LIVE REPLAY INJECTION ---
        if (!isPhysicallyPaused && playbackActive) {
          const simStep = Math.floor(cursorState.simStepIndex ?? 0);
          const maxReached = timeline.maxReachedSec ?? 0;
          const currentTSec = Math.floor(simStep / TICKS_PER_SEC);

          if (currentTSec >= maxReached) {
            playbackActive = false;
          }

          // Check for actions at this second
          if (playbackActive && simStep % TICKS_PER_SEC === 0) {
            const tSec = currentTSec;
            applyPlaybackActionsForSecond(tSec);
          }
        }

        // Advance
        updateGame(SIM_DT_STEP, cursorState);
        simAccumulator -= SIM_DT_STEP;
        steps++;
      }

      if (steps > 0) {
        maintainCheckpoints(timeline, cursorState);
      }

      if (steps === maxSteps) {
        simAccumulator = 0;
      }
    },

    dispatchAction(kind, payload) {
      dragPreviewState = null;
      simAccumulator = 0;
      pauseRequested = false;
      playbackActive = false;

      const tSec = Math.floor(cursorState.tSec ?? 0);

      // Truncate future
      if (timeline.actions) {
        timeline.actions = truncateActionsAfterSecond(timeline.actions, tSec);
      }
      if (timeline.checkpoints) {
        timeline.checkpoints = truncateCheckpointsAfterSecond(
          timeline.checkpoints,
          tSec
        );
      }

      timeline.maxReachedSec = tSec;

      // Apply Live
      const exec = applyAction(cursorState, { kind, payload });
      if (!exec?.ok) return exec || { ok: false, reason: "cmdFailed" };

      // Record with tSec
      const rec = appendActionAtCursor(
        timeline,
        {
          kind,
          payload,
          tSec: tSec,
        },
        cursorState
      );
      if (!rec.ok) return rec;

      seekPlaybackIndex(tSec);
      maintainCheckpoints(timeline, cursorState);

      onRebuildViews?.();
      onInvalidate?.("actionDispatched");

      return { ok: true };
    },

    commitCursorSecond(tSec, stateData) {
      const res = seekCursorSecond(tSec, stateData, {
        paused: true,
        maintainCheckpoints: true,
      });
      if (!res.ok) return res;

      timeScaleWantsUnpause = false;
      timeScaleTarget = 0;
      timeScaleCurrent = 0;
      rewindAccumulatorSec = 0;

      onRebuildViews?.();
      onInvalidate?.("scrubCommit");

      return { ok: true };
    },

    setTimeScaleTarget: (speed, opts = {}) => {
      const clamped = clampTimeScale(speed);
      timeScaleTarget = clamped;

      if (opts.immediate) timeScaleCurrent = clamped;

      if (opts.unpause && clamped !== 0) {
        timeScaleWantsUnpause = true;
        pauseRequested = false;
        if (cursorState?.paused) {
          setPaused(cursorState, false);
          syncPhaseToPaused(cursorState);
        }
      }

      if (opts.requestPause && clamped === 0) {
        timeScaleWantsUnpause = false;
        pauseRequested = true;
      }

      return { ok: true, target: timeScaleTarget };
    },
    getTimeScale: () => ({
      current: timeScaleCurrent,
      target: timeScaleTarget,
      max: TIME_SCALE_MAX,
    }),

    getTimeline: () => timeline,
    getCursorState: () => cursorState,
    getState: () => dragPreviewState || cursorState,
    isPreviewing: () => !!dragPreviewState,
    setPreviewState: (s) => {
      dragPreviewState = s || null;
      simAccumulator = 0;
      return dragPreviewState;
    },
    clearPreviewState: () => {
      dragPreviewState = null;
      simAccumulator = 0;
    },
    setPaused: (p) => {
      dragPreviewState = null;
      simAccumulator = 0;

      if (p) {
        pauseRequested = true;
        timeScaleWantsUnpause = false;
      } else {
        pauseRequested = false;
        setPaused(cursorState, false);

        syncPhaseToPaused(cursorState);
      }
    },
    isPausePending: () => !!pauseRequested,
  };
}
