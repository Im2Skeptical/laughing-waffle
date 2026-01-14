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

      // Initial checkpoint
      timeline.checkpoints = [
        {
          checkpointSec: 0,
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

      simAccumulator += frameDt;
      let steps = 0;

      while (simAccumulator >= SIM_DT_STEP && steps < MAX_SIM_STEPS_PER_FRAME) {
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

      if (steps === MAX_SIM_STEPS_PER_FRAME) {
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

    commitCursorSecond(tSec) {
      const t = Math.max(0, Math.floor(tSec));
      pauseRequested = false;

      const rebuilt = rebuildStateAtSecond(timeline, t);
      if (!rebuilt.ok) return rebuilt;

      loadIntoGameState(serializeGameState(rebuilt.state));
      cursorState = gameState;

      syncPhaseToPaused(cursorState);

      const prevMax = timeline.maxReachedSec ?? 0;
      if (t > prevMax) timeline.maxReachedSec = t;

      // Enter playback mode if we are behind the frontier
      playbackActive = t < prevMax;

      seekPlaybackIndex(t);
      maintainCheckpoints(timeline, cursorState);

      onRebuildViews?.();
      onInvalidate?.("scrubCommit");

      return { ok: true };
    },

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
      } else {
        pauseRequested = false;
        setPaused(cursorState, false);

        syncPhaseToPaused(cursorState);
      }
    },
    isPausePending: () => !!pauseRequested,
  };
}
