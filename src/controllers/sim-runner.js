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
  truncateTimelineAfterSecond,
  replaceActionsAtSecond,
  rebuildStateAtSecond,
  maintainCheckpoints,
} from "../model/timeline.js";

import {
  serializeGameState,
  syncPhaseToPaused,
  getCurrentSeasonKey,
} from "../model/state.js";
import { applyAction } from "../model/actions.js";
import { createActionPlanner } from "./actionmanagers/action-planner.js";

const SIM_DT_STEP = 1 / 60;
const TICKS_PER_SEC = 60;
const MAX_SIM_STEPS_PER_FRAME = 8;
const TIME_SCALE_MAX = 16;
const TIME_SCALE_EASE_PER_SEC = 10;
const SAVE_SCHEMA_VERSION = 2;
const SAVE_KEY_PREFIX = "civsurvivor.save";

export function createSimRunner({
  onInvalidate,
  onRebuildViews,
  onPlannerApReject,
}) {
  // State
  let timeline = null;
  let cursorState = null;
  let dragPreviewState = null;
  let simAccumulator = 0;

  let pauseRequested = false;
  let lastPlannerCommitError = null;

  const actionPlanner = createActionPlanner({
    getTimeline: () => timeline,
    getState: () => cursorState,
    onInvalidate: (reason) => onInvalidate?.(`planner:${reason}`),
    onEdit: (reason) => {
      dragPreviewState = null;
      commitPlannerActions(`edit:${reason || "update"}`);
    },
    onInsufficientAp: (info) => onPlannerApReject?.(info),
  });

  // Playback / Live Replay State
  let playbackNextActionIdx = 0;
  let playbackLastAppliedSec = -1;
  let playbackActive = false;

  // Time control (time lever)
  let timeScaleTarget = 1;
  let timeScaleCurrent = 1;
  let timeScaleWantsUnpause = false;
  let rewindAccumulatorSec = 0;
  const saveSlotCount = 3;

  function getSaveSlotKey(slot) {
    const idx = Number.isFinite(slot) ? Math.floor(slot) : 1;
    const clamped = Math.max(1, Math.min(saveSlotCount, idx));
    return `${SAVE_KEY_PREFIX}.slot${clamped}`;
  }

  function getLocalStorageSafe() {
    try {
      return globalThis?.localStorage ?? null;
    } catch (_) {
      return null;
    }
  }

  function buildSaveMeta(state) {
    const tSec = Math.floor(state?.tSec ?? 0);
    const seasonKey = getCurrentSeasonKey(state);
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      tSec,
      seasonKey,
      year: Number.isFinite(state?.year) ? Math.floor(state.year) : 1,
      actionPoints: Math.floor(state?.actionPoints ?? 0),
      actionPointCap: Math.floor(state?.actionPointCap ?? 0),
    };
  }

  function serializeTimelineForSave(tl) {
    if (!tl) return null;
    return {
      baseStateData: tl.baseStateData ?? null,
      actions: Array.isArray(tl.actions) ? tl.actions : [],
      checkpoints: Array.isArray(tl.checkpoints) ? tl.checkpoints : [],
      cursorSec: Math.floor(tl.cursorSec ?? 0),
      historyEndSec: Math.floor(tl.historyEndSec ?? 0),
      revision: Math.floor(tl.revision ?? 0),
    };
  }

  function normalizeSavedTimeline(rawTimeline, fallbackStateData) {
    if (!rawTimeline || typeof rawTimeline !== "object") return null;
    const baseStateData = rawTimeline.baseStateData ?? fallbackStateData ?? null;
    if (!baseStateData) return null;
    if (!Number.isFinite(rawTimeline.historyEndSec)) return null;
    return {
      baseStateData,
      actions: Array.isArray(rawTimeline.actions) ? rawTimeline.actions : [],
      checkpoints: Array.isArray(rawTimeline.checkpoints)
        ? rawTimeline.checkpoints
        : [],
      cursorSec: Math.floor(rawTimeline.cursorSec ?? 0),
      historyEndSec: Math.floor(rawTimeline.historyEndSec),
      revision: Math.floor(rawTimeline.revision ?? 0),
    };
  }

  function readSaveSlot(slot) {
    const store = getLocalStorageSafe();
    if (!store) return { ok: false, reason: "noStorage" };
    const key = getSaveSlotKey(slot);
    const raw = store.getItem(key);
    if (!raw) return { ok: false, reason: "emptySlot" };
    try {
      const parsed = JSON.parse(raw);
      return { ok: true, data: parsed };
    } catch (err) {
      return { ok: false, reason: "badSaveData", error: err };
    }
  }

  function getSaveSlotMeta(slot) {
    const res = readSaveSlot(slot);
    if (!res.ok) return null;
    return res.data?.meta ?? null;
  }

  function saveToSlot(slot) {
    if (!cursorState) return { ok: false, reason: "noState" };
    const store = getLocalStorageSafe();
    if (!store) return { ok: false, reason: "noStorage" };
    const key = getSaveSlotKey(slot);

    const meta = buildSaveMeta(cursorState);
    const timelineData = serializeTimelineForSave(timeline);
    const payload = {
      meta,
      state: serializeGameState(cursorState),
      timeline: timelineData,
    };

    store.setItem(key, JSON.stringify(payload));
    return { ok: true, meta };
  }

  function loadFromSlot(slot) {
    const res = readSaveSlot(slot);
    if (!res.ok) return res;
    const data = res.data;
    const meta = data?.meta ?? null;
    if (meta?.schemaVersion !== SAVE_SCHEMA_VERSION) {
      return { ok: false, reason: "versionMismatch", meta };
    }
    if (!data?.state) return { ok: false, reason: "missingState" };
    const nextTimeline = normalizeSavedTimeline(
      data?.timeline,
      data?.state ?? null
    );
    if (!nextTimeline) {
      return { ok: false, reason: "missingTimeline" };
    }

    dragPreviewState = null;
    pauseRequested = false;
    timeScaleTarget = 0;
    timeScaleCurrent = 0;
    timeScaleWantsUnpause = false;
    rewindAccumulatorSec = 0;
    simAccumulator = 0;

    timeline = nextTimeline;

    loadIntoGameState(data.state);
    cursorState = gameState;

    const desiredSec = Math.floor(timeline.cursorSec ?? cursorState.tSec ?? 0);
    if (Math.floor(cursorState.tSec ?? 0) !== desiredSec) {
      const rebuilt = rebuildStateAtSecond(timeline, desiredSec);
      if (!rebuilt?.ok) return rebuilt;
      loadIntoGameState(serializeGameState(rebuilt.state));
      cursorState = gameState;
    }

    setPaused(cursorState, true);
    syncPhaseToPaused(cursorState);

    seekPlaybackIndex(desiredSec);
    playbackActive = desiredSec < Math.floor(timeline.historyEndSec ?? 0);
    actionPlanner.resetToTimeline?.();

    onRebuildViews?.();
    onInvalidate?.("saveLoad");
    return { ok: true, meta };
  }

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
    if (!playbackActive) return false;
    if (!timeline?.actions) return false;
    if (playbackLastAppliedSec === tSec) return false;

    let appliedAny = false;
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
        appliedAny = true;
        playbackNextActionIdx++;
        continue;
      }
      break; // aSec > tSec
    }

    playbackLastAppliedSec = tSec;
    return appliedAny;
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

    const prevHistoryEnd = Math.floor(timeline.historyEndSec ?? 0);

    // Keep checkpoints unpaused for replay safety.
    setPaused(cursorState, false);
    syncPhaseToPaused(cursorState);

    if (t > prevHistoryEnd) timeline.historyEndSec = t;
    timeline.cursorSec = t;

    if (opts.maintainCheckpoints !== false) {
      maintainCheckpoints(timeline, cursorState);
    }

    playbackActive = t < prevHistoryEnd;
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

  function isPlannerManagedAction(action) {
    if (!action || typeof action !== "object") return false;
    const kind = action.kind;
    if (
      kind === "placeCharacter" ||
      kind === "buildDesignate" ||
      kind === "setTileTagOrder" ||
      kind === "setTileCropSelection" ||
      kind === "setHubRecipeSelection" ||
      kind === "setHubTagOrder" ||
      kind === "toggleTileTag" ||
      kind === "toggleHubTag"
    ) {
      return true;
    }
    if (kind === "inventoryMove") {
      const payload = action.payload || {};
      return payload.fromOwnerId !== payload.toOwnerId;
    }
    return false;
  }

  function getPlannerActionSubjectKey(action) {
    if (!action || typeof action !== "object") return null;
    const payload = action.payload || {};
    if (action.kind === "inventoryMove") {
      const itemId = payload.itemId ?? payload.item?.id ?? null;
      return itemId != null ? `item:${itemId}` : null;
    }
    if (action.kind === "placeCharacter") {
      const charId = payload.charId ?? null;
      return charId != null ? `pawn:${charId}` : null;
    }
    if (action.kind === "buildDesignate") {
      const buildKey = payload.buildKey ?? payload.targetKey ?? null;
      return buildKey != null ? `build:${buildKey}` : null;
    }
    if (action.kind === "setTileTagOrder") {
      const envCol = payload.envCol ?? null;
      return Number.isFinite(envCol) ? `tileTags:${Math.floor(envCol)}` : null;
    }
    if (action.kind === "setTileCropSelection") {
      const envCol = payload.envCol ?? null;
      return Number.isFinite(envCol) ? `tileCrop:${Math.floor(envCol)}` : null;
    }
    if (action.kind === "setHubTagOrder") {
      const hubCol = payload.hubCol ?? null;
      return Number.isFinite(hubCol) ? `hubTags:${Math.floor(hubCol)}` : null;
    }
    if (action.kind === "setHubRecipeSelection") {
      const hubCol = payload.hubCol ?? null;
      const systemId = payload.systemId ?? null;
      return Number.isFinite(hubCol) && systemId
        ? `hubRecipe:${Math.floor(hubCol)}:${systemId}`
        : null;
    }
    if (action.kind === "toggleTileTag") {
      const envCol = payload.envCol ?? null;
      const tagId = payload.tagId ?? null;
      return Number.isFinite(envCol) && tagId
        ? `tileTagToggle:${Math.floor(envCol)}:${tagId}`
        : null;
    }
    if (action.kind === "toggleHubTag") {
      const hubCol = payload.hubCol ?? null;
      const tagId = payload.tagId ?? null;
      return Number.isFinite(hubCol) && tagId
        ? `hubTagToggle:${Math.floor(hubCol)}:${tagId}`
        : null;
    }
    return null;
  }

  function getActionItemIds(action) {
    if (!action || typeof action !== "object") return [];
    const payload = action.payload || {};
    if (action.kind === "inventoryMove") {
      const itemId = payload.itemId ?? payload.item?.id ?? null;
      return itemId != null ? [itemId] : [];
    }
    if (action.kind === "inventorySplit") {
      return payload.itemId != null ? [payload.itemId] : [];
    }
    if (action.kind === "inventoryStack") {
      const ids = [];
      if (payload.sourceItemId != null) ids.push(payload.sourceItemId);
      if (payload.targetItemId != null) ids.push(payload.targetItemId);
      return ids;
    }
    return [];
  }

  function shouldDropActionForRemovedItems(action, index, removedByItemId) {
    if (!removedByItemId || removedByItemId.size === 0) return false;
    const ids = getActionItemIds(action);
    for (const id of ids) {
      const key = String(id);
      const removedIndex = removedByItemId.get(key);
      if (removedIndex != null && index > removedIndex) return true;
    }
    return false;
  }

  function commitPlannerActions(reason) {
    if (!timeline || !cursorState) return { ok: false, reason: "noState" };

    const build = actionPlanner.buildCommitActions?.();
    if (!build?.ok) return build || { ok: false, reason: "buildFailed" };

    const actions = build.actions || [];
    const tSec = Math.floor(cursorState.tSec ?? 0);

    const actionsWithTSec = actions.map((action) => ({
      ...action,
      tSec,
    }));

    const existingAtSec = [];
    const beforeAtSec = [];
    for (const action of timeline.actions || []) {
      const sec = Math.floor(action.tSec ?? 0);
      if (sec < tSec) beforeAtSec.push(action);
      else if (sec === tSec) existingAtSec.push(action);
    }

    const newByKey = new Map();
    for (const action of actionsWithTSec) {
      const key = getPlannerActionSubjectKey(action);
      if (key) newByKey.set(key, action);
    }

    const removedByItemId = new Map();
    for (let i = 0; i < existingAtSec.length; i++) {
      const action = existingAtSec[i];
      if (!isPlannerManagedAction(action)) continue;
      const key = getPlannerActionSubjectKey(action);
      if (key && newByKey.has(key)) continue;
      if (action.kind !== "inventoryMove") continue;
      const payload = action.payload || {};
      const itemId = payload.itemId ?? payload.item?.id ?? null;
      if (itemId != null) {
        removedByItemId.set(String(itemId), i);
      }
    }

    const usedKeys = new Set();
    const orderedAtSec = [];

    for (let i = 0; i < existingAtSec.length; i++) {
      const action = existingAtSec[i];
      if (!isPlannerManagedAction(action)) {
        if (shouldDropActionForRemovedItems(action, i, removedByItemId)) {
          continue;
        }
        orderedAtSec.push(action);
        continue;
      }
      const key = getPlannerActionSubjectKey(action);
      const replacement = key ? newByKey.get(key) : null;
      if (replacement) {
        orderedAtSec.push(replacement);
        usedKeys.add(key);
      }
    }

    for (const action of actionsWithTSec) {
      const key = getPlannerActionSubjectKey(action);
      if (key && usedKeys.has(key)) continue;
      orderedAtSec.push(action);
    }

    const candidateActions = [...beforeAtSec, ...orderedAtSec];
    const candidateCheckpoints = truncateCheckpointsAfterSecond(
      timeline.checkpoints,
      tSec
    ).filter((cp) => Math.floor(cp.checkpointSec ?? -1) !== tSec);
    const candidateTimeline = {
      baseStateData: timeline.baseStateData,
      actions: candidateActions,
      checkpoints: candidateCheckpoints,
      cursorSec: tSec,
      historyEndSec: tSec,
      revision: timeline.revision ?? 0,
    };

    const rebuilt = rebuildStateAtSecond(candidateTimeline, tSec);
    if (!rebuilt?.ok) {
      lastPlannerCommitError = {
        reason: rebuilt?.reason ?? "rebuildFailed",
        detail: rebuilt?.detail ?? null,
        tSec,
        commitReason: reason || "commit",
      };
      console.warn("Planner commit failed:", lastPlannerCommitError);
      actionPlanner.resetToTimeline?.();
      onRebuildViews?.();
      onInvalidate?.("plannerCommitFailed");
      return { ok: false, reason: "commitFailed", detail: lastPlannerCommitError };
    }

    lastPlannerCommitError = null;
    timeline.checkpoints = truncateCheckpointsAfterSecond(
      timeline.checkpoints,
      tSec
    );
    const replaceRes = replaceActionsAtSecond(timeline, tSec, orderedAtSec, {
      truncateFuture: true,
    });
    if (!replaceRes?.ok) return replaceRes || { ok: false, reason: "replace" };
    timeline.historyEndSec = tSec;
    timeline.cursorSec = tSec;

    const wasPaused = !!cursorState.paused;
    loadIntoGameState(serializeGameState(rebuilt.state));
    cursorState = gameState;
    setPaused(cursorState, wasPaused);
    syncPhaseToPaused(cursorState);

    playbackActive = false;
    seekPlaybackIndex(tSec);
    maintainCheckpoints(timeline, cursorState);

    actionPlanner.markCommitted?.({
      tSec,
      revision: timeline.revision ?? 0,
    });

    onRebuildViews?.();
    onInvalidate?.(`plannerCommit:${reason || "commit"}`);

    return { ok: true, committed: actionsWithTSec.length };
  }

  function clearPlannerActionsAtCursor() {
    if (!timeline || !cursorState) return { ok: false, reason: "noState" };

    const tSec = Math.floor(cursorState.tSec ?? 0);

    const replaceRes = replaceActionsAtSecond(timeline, tSec, [], {
      truncateFuture: true,
    });
    if (!replaceRes?.ok) return replaceRes || { ok: false, reason: "replace" };

    let lastActionSec = 0;
    const actions = timeline.actions || [];
    if (actions.length) {
      lastActionSec = Math.max(
        0,
        Math.floor(actions[actions.length - 1].tSec ?? 0)
      );
    }

    timeline.checkpoints = truncateCheckpointsAfterSecond(
      timeline.checkpoints,
      lastActionSec
    );
    timeline.historyEndSec = lastActionSec;
    timeline.cursorSec = tSec;

    const rebuilt = rebuildStateAtSecond(timeline, tSec);
    if (!rebuilt?.ok) return rebuilt;

    const wasPaused = !!cursorState.paused;
    loadIntoGameState(serializeGameState(rebuilt.state));
    cursorState = gameState;
    setPaused(cursorState, wasPaused);
    syncPhaseToPaused(cursorState);

    playbackActive = tSec < lastActionSec;
    seekPlaybackIndex(tSec);

    actionPlanner.resetToTimeline?.();
    onRebuildViews?.();
    onInvalidate?.("plannerClear");

    return { ok: true };
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
      timeline.historyEndSec = 0;

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

      let playbackAppliedThisUpdate = false;
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
            if (applyPlaybackActionsForSecond(tSec)) {
              playbackAppliedThisUpdate = true;
            }

            simAccumulator = 0;
            break;
          }
        }

        // --- LIVE REPLAY INJECTION ---
        if (!isPhysicallyPaused && playbackActive) {
          const simStep = Math.floor(cursorState.simStepIndex ?? 0);
          const historyEnd = timeline.historyEndSec ?? 0;
          const currentTSec = Math.floor(simStep / TICKS_PER_SEC);

          if (currentTSec > historyEnd) {
            playbackActive = false;
          }

          // Check for actions at this second
          if (playbackActive && simStep % TICKS_PER_SEC === 0) {
            const tSec = currentTSec;
            if (applyPlaybackActionsForSecond(tSec)) {
              playbackAppliedThisUpdate = true;
            }
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

      if (playbackAppliedThisUpdate) {
        onRebuildViews?.();
        onInvalidate?.("playbackApply");
      }

      if (steps === maxSteps) {
        simAccumulator = 0;
      }
    },

    dispatchAction(kind, payload, opts = {}) {
      dragPreviewState = null;
      simAccumulator = 0;
      pauseRequested = false;
      playbackActive = false;

      const tSec = Math.floor(cursorState.tSec ?? 0);

      // Truncate future
      const prevHistoryEnd = Math.floor(timeline.historyEndSec ?? 0);
      if (tSec < prevHistoryEnd) {
        truncateTimelineAfterSecond(timeline, tSec);
      } else {
        if (Array.isArray(timeline.actions) && timeline.actions.length) {
          const lastAction = timeline.actions[timeline.actions.length - 1];
          const lastActionSec = Math.floor(lastAction?.tSec ?? -1);
          if (lastActionSec > tSec) {
            timeline.actions = truncateActionsAfterSecond(
              timeline.actions,
              tSec
            );
          }
        }
        if (
          Array.isArray(timeline.checkpoints) &&
          timeline.checkpoints.length
        ) {
          const lastCheckpoint =
            timeline.checkpoints[timeline.checkpoints.length - 1];
          const lastCheckpointSec = Math.floor(
            lastCheckpoint?.checkpointSec ?? -1
          );
          if (lastCheckpointSec > tSec) {
            timeline.checkpoints = truncateCheckpointsAfterSecond(
              timeline.checkpoints,
              tSec
            );
          }
        }
        timeline.historyEndSec = tSec;
      }

      // Apply Live
      const exec = applyAction(cursorState, {
        kind,
        payload,
        apCost: opts.apCost,
      });
      if (!exec?.ok) return exec || { ok: false, reason: "cmdFailed" };

      // Record with tSec
      const rec = appendActionAtCursor(
        timeline,
        {
          kind,
          payload,
          tSec: tSec,
          apCost: opts.apCost,
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

    browseCursorSecond(tSec, stateData) {
      const res = seekCursorSecond(tSec, stateData, {
        paused: true,
        maintainCheckpoints: true,
      });
      if (!res.ok) return res;

      onRebuildViews?.();
      onInvalidate?.("scrubBrowse");
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
    getLastPlannerCommitError: () => lastPlannerCommitError,
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
    getActionPlanner: () => actionPlanner,
    clearPlannerActionsAtCursor,
    saveToSlot,
    loadFromSlot,
    getSaveSlotMeta,
    getSaveSlotCount: () => saveSlotCount,
  };
}
