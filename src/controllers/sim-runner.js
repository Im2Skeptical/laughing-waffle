// src/controllers/sim-runner.js
// Simulation runner (fixed-step, second-boundary pause, replay injection)

import {
  initGameState,
  updateGame,
  setPaused,
  loadIntoGameState,
  loadStateObjectIntoGameState,
  gameState,
} from "../model/game-model.js";

import {
  createTimelineFromInitialState,
  absorbTimelinePersistentKnowledge,
  appendActionAtCursor,
  truncateCheckpointsAfterSecond,
  truncateTimelineAfterSecond,
  replaceActionsAtSecond,
  rebuildStateAtSecond,
  maintainCheckpoints,
  seedMemoStateDataAtSecond,
  seedCheckpointStateDataAtSecond,
} from "../model/timeline/index.js";

import {
  deserializeGameState,
  serializeGameState,
  syncPhaseToPaused,
  getCurrentSeasonKey,
} from "../model/state.js";
import { ActionKinds, applyAction } from "../model/actions.js";
import { canonicalizeSnapshot } from "../model/canonicalize.js";
import {
  clonePersistentKnowledge,
  ensurePersistentKnowledgeState,
  mergePersistentKnowledge,
} from "../model/persistent-memory.js";
import { resolveEditWindowStatusAtSecond } from "../model/timegraph/edit-policy.js";
import { getGlobalSkillModifier } from "../model/skills.js";
import { createActionPlanner } from "./actionmanagers/action-planner.js";
import {
  perfEnabled,
  perfNowMs,
  recordActionDispatch,
  recordPlannerCommit,
  recordScrubBrowse,
  recordScrubCommit,
} from "../model/perf.js";
import { BASE_EDITABLE_HISTORY_WINDOW_SEC } from "../defs/gamesettings/gamerules-defs.js";

const SIM_DT_STEP = 1 / 60;
const TICKS_PER_SEC = 60;
const MAX_SIM_STEPS_PER_FRAME = 8;
const TIME_SCALE_MAX = 16;
const TIME_SCALE_EASE_PER_SEC = 10;
const SAVE_SCHEMA_VERSION = 2;
const SAVE_KEY_PREFIX = "civsurvivor.save";
const ACTION_PATH_CHECKPOINT_OPTS = Object.freeze({
  writeMemo: true,
  captureCheckpoint: false,
  prune: false,
});

export function createSimRunner({
  onInvalidate,
  onRebuildViews,
  onPlannerApReject,
  setupId = "testing",
}) {
  // State
  let timeline = null;
  let cursorState = null;
  let dragPreviewState = null;
  let simAccumulator = 0;

  let pauseRequested = false;
  let lastPlannerCommitError = null;
  let plannerBoundaryCache = null;
  let fullHistoryEditOverrideEnabled = false;

  function clearPlannerBoundaryCache() {
    plannerBoundaryCache = null;
  }

  function getEditableHistoryWindowSec() {
    const base = Math.floor(BASE_EDITABLE_HISTORY_WINDOW_SEC ?? 0);
    const bonus = Math.floor(
      getGlobalSkillModifier(
        cursorState,
        "editableHistoryWindowBonusSec",
        0
      )
    );
    const total = (Number.isFinite(base) ? base : 0) + (Number.isFinite(bonus) ? bonus : 0);
    return total >= 0 ? total : 0;
  }

  function getTimelineMaxReachedHistoryEndSec() {
    const fallback = Math.max(0, Math.floor(timeline?.historyEndSec ?? 0));
    const raw = Math.floor(timeline?.maxReachedHistoryEndSec ?? fallback);
    if (!timeline) return fallback;
    if (!Number.isFinite(raw) || raw < fallback) {
      timeline.maxReachedHistoryEndSec = fallback;
      return fallback;
    }
    return raw;
  }

  function syncTimelineMaxReachedHistoryEndSec(extraSec = null) {
    if (!timeline) return 0;
    const historyEndSec = Math.max(0, Math.floor(timeline.historyEndSec ?? 0));
    const cursorSec = Math.max(0, Math.floor(cursorState?.tSec ?? 0));
    const extra = Number.isFinite(extraSec) ? Math.max(0, Math.floor(extraSec)) : 0;
    const prev = getTimelineMaxReachedHistoryEndSec();
    const next = Math.max(prev, historyEndSec, cursorSec, extra);
    timeline.maxReachedHistoryEndSec = next;
    return next;
  }

  function getEditableHistoryBounds() {
    const windowSec = getEditableHistoryWindowSec();
    const maxReachedSec = syncTimelineMaxReachedHistoryEndSec();
    const minEditableSec = fullHistoryEditOverrideEnabled
      ? 0
      : Math.max(0, maxReachedSec - windowSec);
    return {
      windowSec,
      maxReachedSec,
      minEditableSec,
      fullHistoryEditOverrideEnabled,
    };
  }

  function getEditWindowStatusForSecond(tSec) {
    const sec = Math.max(0, Math.floor(tSec ?? 0));
    const bounds = getEditableHistoryBounds();
    const resolved = resolveEditWindowStatusAtSecond({
      tSec: sec,
      minEditableSec: bounds.minEditableSec,
      state: cursorState,
    });
    return {
      ...resolved,
      ...bounds,
    };
  }

  function getPreviewStatus() {
    const hasPreview = !!dragPreviewState;
    const previewSec = hasPreview
      ? Math.max(0, Math.floor(dragPreviewState?.tSec ?? 0))
      : null;
    const liveSec = Math.max(0, Math.floor(cursorState?.tSec ?? 0));
    const historyEndSec = Math.max(0, Math.floor(timeline?.historyEndSec ?? 0));
    const isForecastPreview =
      hasPreview && Number.isFinite(previewSec) && previewSec > historyEndSec;
    return {
      active: hasPreview,
      previewSec,
      liveSec,
      historyEndSec,
      isForecastPreview,
    };
  }

  function applyTimelinePersistentKnowledgeToState(stateLike) {
    if (!stateLike || typeof stateLike !== "object") return false;
    if (!timeline || typeof timeline !== "object") return false;
    ensurePersistentKnowledgeState(stateLike);
    ensurePersistentKnowledgeState(timeline);
    return mergePersistentKnowledge(stateLike, timeline);
  }

  function validateActionOnPreviewState(kind, payload, apCost) {
    if (!dragPreviewState) {
      return { ok: false, reason: "noPreviewState" };
    }
    const trialState = deserializeGameState(serializeGameState(dragPreviewState));
    canonicalizeSnapshot(trialState);
    return (
      applyAction(trialState, { kind, payload, apCost }) || {
        ok: false,
        reason: "cmdFailed",
      }
    );
  }

  function validateActionListOnPreviewState(actions) {
    if (!dragPreviewState) {
      return { ok: false, reason: "noPreviewState" };
    }
    const orderedActions = Array.isArray(actions) ? actions : [];
    const trialState = deserializeGameState(serializeGameState(dragPreviewState));
    canonicalizeSnapshot(trialState);
    for (const action of orderedActions) {
      if (!action || typeof action !== "object" || !action.kind) {
        return { ok: false, reason: "badAction" };
      }
      const res = applyAction(trialState, action) || {
        ok: false,
        reason: "cmdFailed",
      };
      if (res?.ok) continue;
      return res;
    }
    return { ok: true };
  }

  function normalizeBatchActions(actions, tSec = null) {
    const normalized = [];
    for (const action of Array.isArray(actions) ? actions : []) {
      if (!action || typeof action !== "object" || !action.kind) continue;
      const nextAction = {
        ...action,
      };
      if (tSec != null) {
        nextAction.tSec = Math.max(0, Math.floor(tSec));
      }
      normalized.push(nextAction);
    }
    return normalized;
  }

  function cloneResultActions(actions) {
    return (Array.isArray(actions) ? actions : []).map((action) => ({
      ...action,
      payload:
        action?.payload && typeof action.payload === "object"
          ? JSON.parse(JSON.stringify(action.payload))
          : action?.payload ?? null,
    }));
  }

  function prepareDispatchBatch(actions) {
    simAccumulator = 0;
    pauseRequested = false;
    playbackActive = false;

    const normalizedActions = normalizeBatchActions(actions);
    if (!normalizedActions.length) {
      return { ok: false, reason: "noActions" };
    }

    const preview = getPreviewStatus();
    if (preview.active) {
      if (!preview.isForecastPreview) {
        return {
          ok: false,
          reason: "previewNotForecast",
          ...preview,
        };
      }
      const validationRes = validateActionListOnPreviewState(normalizedActions);
      if (!validationRes?.ok) {
        return validationRes || { ok: false, reason: "cmdFailed" };
      }
      const previewStateData = serializeGameState(dragPreviewState);
      const commitRes = commitCursorSecondInternal(
        preview.previewSec,
        previewStateData
      );
      if (!commitRes.ok) {
        return commitRes;
      }
    }

    dragPreviewState = null;
    return { ok: true, actions: normalizedActions };
  }

  function getPlannerBoundaryStateData(tSec) {
    if (!timeline) return { ok: false, reason: "noTimeline" };
    const sec = Math.max(0, Math.floor(tSec ?? 0));
    const historyEndSec = Math.floor(timeline.historyEndSec ?? 0);
    const revision = Math.floor(timeline.revision ?? 0);
    const baseRef = timeline.baseStateData;

    if (
      plannerBoundaryCache &&
      plannerBoundaryCache.tSec === sec &&
      plannerBoundaryCache.historyEndSec === historyEndSec &&
      plannerBoundaryCache.revision === revision &&
      plannerBoundaryCache.baseStateDataRef === baseRef &&
      plannerBoundaryCache.stateData != null
    ) {
      return { ok: true, stateData: plannerBoundaryCache.stateData, cacheHit: true };
    }

    let stateData = null;
    if (sec <= 0) {
      stateData = baseRef;
    } else {
      const rebuiltPrev = rebuildStateAtSecond(timeline, sec - 1);
      if (!rebuiltPrev?.ok) return rebuiltPrev || { ok: false, reason: "rebuildFailed" };
      const boundaryState = rebuiltPrev.state;
      boundaryState.paused = false;
      for (let i = 0; i < TICKS_PER_SEC; i++) {
        updateGame(SIM_DT_STEP, boundaryState);
      }
      stateData = serializeGameState(boundaryState);
    }

    plannerBoundaryCache = {
      tSec: sec,
      historyEndSec,
      revision,
      baseStateDataRef: baseRef,
      stateData,
    };

    return { ok: true, stateData, cacheHit: false };
  }

  const actionPlanner = createActionPlanner({
    getTimeline: () => timeline,
    getState: () => {
      applyTimelinePersistentKnowledgeToState(cursorState);
      return cursorState;
    },
    getPreviewBoundaryStateData: (tSec) => getPlannerBoundaryStateData(tSec),
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
  let activeSetupId =
    typeof setupId === "string" && setupId.length > 0 ? setupId : "devGym01";

  function initializeFromSetup(nextSetupId, reason = "init") {
    const targetSetupId =
      typeof nextSetupId === "string" && nextSetupId.length > 0
        ? nextSetupId
        : activeSetupId;
    try {
      initGameState(gameState, targetSetupId);
    } catch (error) {
      return {
        ok: false,
        reason: "badSetupId",
        setupId: targetSetupId,
        error,
      };
    }
    activeSetupId = targetSetupId;
    cursorState = gameState;

    dragPreviewState = null;
    syncPhaseToPaused(cursorState);

    timeline = createTimelineFromInitialState(cursorState);
    clearPlannerBoundaryCache();

    timeline.cursorSec = 0;
    timeline.historyEndSec = 0;
    timeline.maxReachedHistoryEndSec = 0;

    pauseRequested = false;
    playbackActive = false;
    timeScaleTarget = 1;
    timeScaleCurrent = 1;
    timeScaleWantsUnpause = false;
    rewindAccumulatorSec = 0;
    simAccumulator = 0;
    lastPlannerCommitError = null;
    fullHistoryEditOverrideEnabled = false;

    timeline.checkpoints = [
      {
        checkpointSec: 0,
        appliedThroughSec: 0,
        stateData: serializeGameState(cursorState),
      },
    ];

    maintainCheckpoints(timeline, cursorState);
    syncTimelineMaxReachedHistoryEndSec();
    seekPlaybackIndex(Math.floor(cursorState.tSec ?? 0));
    actionPlanner.resetToTimeline?.();

    onRebuildViews?.(reason);
    onInvalidate?.(reason);
    return { ok: true, setupId: activeSetupId };
  }

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
      setupId: activeSetupId,
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
    const historyEndSec = Math.floor(tl.historyEndSec ?? 0);
    const maxReachedHistoryEndSec = Math.max(
      historyEndSec,
      Math.floor(tl.maxReachedHistoryEndSec ?? historyEndSec)
    );
    return {
      baseStateData: tl.baseStateData ?? null,
      persistentKnowledge: clonePersistentKnowledge(tl),
      actions: Array.isArray(tl.actions) ? tl.actions : [],
      checkpoints: Array.isArray(tl.checkpoints) ? tl.checkpoints : [],
      cursorSec: Math.floor(tl.cursorSec ?? 0),
      historyEndSec,
      maxReachedHistoryEndSec,
      revision: Math.floor(tl.revision ?? 0),
    };
  }

  function normalizeSavedTimeline(rawTimeline, fallbackStateData) {
    if (!rawTimeline || typeof rawTimeline !== "object") return null;
    const baseStateData = rawTimeline.baseStateData ?? fallbackStateData ?? null;
    if (!baseStateData) return null;
    if (!Number.isFinite(rawTimeline.historyEndSec)) return null;
    const historyEndSec = Math.floor(rawTimeline.historyEndSec);
    const maxReachedHistoryEndSec = Math.max(
      historyEndSec,
      Math.floor(rawTimeline.maxReachedHistoryEndSec ?? historyEndSec)
    );
    return {
      baseStateData,
      persistentKnowledge: clonePersistentKnowledge(
        rawTimeline?.persistentKnowledge != null
          ? rawTimeline.persistentKnowledge
          : fallbackStateData
      ),
      actions: Array.isArray(rawTimeline.actions) ? rawTimeline.actions : [],
      checkpoints: Array.isArray(rawTimeline.checkpoints)
        ? rawTimeline.checkpoints
        : [],
      cursorSec: Math.floor(rawTimeline.cursorSec ?? 0),
      historyEndSec,
      maxReachedHistoryEndSec,
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
    if (typeof meta?.setupId === "string" && meta.setupId.length > 0) {
      activeSetupId = meta.setupId;
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
    clearPlannerBoundaryCache();

    loadIntoGameState(data.state);
    cursorState = gameState;

    const desiredSec = Math.floor(timeline.cursorSec ?? cursorState.tSec ?? 0);
    if (Math.floor(cursorState.tSec ?? 0) !== desiredSec) {
      const rebuilt = rebuildStateAtSecond(timeline, desiredSec);
      if (!rebuilt?.ok) return rebuilt;
      loadStateObjectIntoGameState(rebuilt.state);
      cursorState = gameState;
    }
    syncTimelineMaxReachedHistoryEndSec();

    setPaused(cursorState, true);
    syncPhaseToPaused(cursorState);

    seekPlaybackIndex(desiredSec);
    playbackActive = desiredSec < getPlaybackCeilingSec();
    actionPlanner.resetToTimeline?.();

    onRebuildViews?.("saveLoad");
    onInvalidate?.("saveLoad");
    return { ok: true, meta };
  }

  function getLastTimelineActionSec() {
    const actions = Array.isArray(timeline?.actions) ? timeline.actions : [];
    if (!actions.length) return -1;
    return Math.max(0, Math.floor(actions[actions.length - 1]?.tSec ?? -1));
  }

  function getPlaybackCeilingSec() {
    const historyEndSec = Math.max(0, Math.floor(timeline?.historyEndSec ?? 0));
    return Math.max(historyEndSec, getLastTimelineActionSec());
  }

  function isImmediateActionKind(kind) {
    return (
      kind === ActionKinds.DEBUG_SET_CAP ||
      kind === ActionKinds.DEBUG_QUEUE_ENV_EVENT
    );
  }

  function seekPlaybackIndex(targetSec) {
    const actions = Array.isArray(timeline?.actions) ? timeline.actions : null;
    if (!actions || actions.length === 0) {
      playbackNextActionIdx = 0;
      playbackLastAppliedSec = targetSec;
      return;
    }

    // In rebuildStateAtSecond, actions at targetSec are already applied.
    // Playback should resume from the first action strictly after targetSec.
    let lo = 0;
    let hi = actions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const sec = Math.floor(actions[mid]?.tSec ?? 0);
      if (sec <= targetSec) lo = mid + 1;
      else hi = mid;
    }

    playbackNextActionIdx = lo;
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
    clearPlannerBoundaryCache();

    let usedCachedState = false;
    if (stateData != null) {
      loadIntoGameState(stateData);
      cursorState = gameState;
      usedCachedState = Math.floor(cursorState.tSec ?? -1) === t;
    }

    if (!usedCachedState) {
      const rebuilt = rebuildStateAtSecond(timeline, t);
      if (!rebuilt.ok) return rebuilt;

      loadStateObjectIntoGameState(rebuilt.state);
      cursorState = gameState;
    }

    absorbTimelinePersistentKnowledge(timeline, cursorState);
    applyTimelinePersistentKnowledgeToState(cursorState);

    const prevHistoryEnd = Math.floor(timeline.historyEndSec ?? 0);

    // Keep checkpoints unpaused for replay safety.
    setPaused(cursorState, false);
    syncPhaseToPaused(cursorState);

    if (t > prevHistoryEnd) timeline.historyEndSec = t;
    timeline.cursorSec = t;

    if (opts.maintainCheckpoints !== false) {
      maintainCheckpoints(timeline, cursorState);
    }
    syncTimelineMaxReachedHistoryEndSec(t);

    playbackActive = t < Math.max(prevHistoryEnd, getLastTimelineActionSec());
    seekPlaybackIndex(t);

    if (typeof opts.paused === "boolean") {
      setPaused(cursorState, opts.paused);
      syncPhaseToPaused(cursorState);
    }

    return { ok: true, usedCachedState };
  }

  function commitCursorSecondInternal(tSec, stateData) {
    const prevSec = Math.floor(cursorState?.tSec ?? 0);
    const res = seekCursorSecond(tSec, stateData, {
      paused: true,
      // Scrub commits can happen frequently; avoid serializing checkpoints/memo
      // here and rely on simulation-path checkpoint maintenance instead.
      maintainCheckpoints: false,
    });
    if (!res.ok) {
      return { ...res, moved: false };
    }

    timeScaleWantsUnpause = false;
    timeScaleTarget = 0;
    timeScaleCurrent = 0;
    rewindAccumulatorSec = 0;

    const currentSec = Math.floor(cursorState?.tSec ?? 0);
    if (Number.isFinite(currentSec) && currentSec >= 0) {
      const memoStateData =
        res.usedCachedState && stateData != null
          ? stateData
          : serializeGameState(cursorState);
      seedMemoStateDataAtSecond(timeline, currentSec, memoStateData);
      // Projection jumps can skip normal simulation checkpoint cadence.
      // Seed a direct checkpoint anchor at the committed second so large-tSec
      // graph/history reads don't fall back to long replay paths.
      seedCheckpointStateDataAtSecond(timeline, currentSec, memoStateData);
      syncTimelineMaxReachedHistoryEndSec(currentSec);
    }

    const moved = Math.floor(cursorState?.tSec ?? 0) !== prevSec;
    if (moved) {
      onRebuildViews?.("scrubCommit");
      onInvalidate?.("scrubCommit");
    }

    return { ok: true, moved, usedCachedState: !!res.usedCachedState };
  }

  function applyTimeRewind(frameDt, speedAbs, keepPauseRequested) {
    if (!cursorState) return false;

    const prevPauseRequested = pauseRequested;
    const bounds = getEditableHistoryBounds();
    const minEditableSec = Number.isFinite(bounds?.minEditableSec)
      ? Math.max(0, Math.floor(bounds.minEditableSec))
      : 0;

    rewindAccumulatorSec += frameDt * speedAbs;
    const rawSteps = Math.floor(rewindAccumulatorSec);
    if (rawSteps <= 0) return false;

    rewindAccumulatorSec -= rawSteps;

    const currentSec = Math.floor(cursorState.tSec ?? 0);
    if (currentSec <= minEditableSec) {
      rewindAccumulatorSec = 0;
      return false;
    }

    const maxStepsWithinEditable = Math.max(0, currentSec - minEditableSec);
    const steps = Math.min(rawSteps, maxStepsWithinEditable);
    const targetSec = Math.max(minEditableSec, currentSec - steps);
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
      kind === "placePawn" ||
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
    if (action.kind === "placePawn") {
      const pawnId =
        payload.pawnId != null
          ? payload.pawnId
          : null;
      return pawnId != null ? `pawn:${pawnId}` : null;
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

  function getActionsAtSecond(tl, sec) {
    if (!tl) return [];
    if (tl.actionsBySec && typeof tl.actionsBySec.get === "function") {
      const list = tl.actionsBySec.get(sec);
      return Array.isArray(list) ? list : [];
    }
    return (tl.actions || []).filter((action) => Math.floor(action.tSec ?? 0) === sec);
  }

  function validateReplayActionsAtSecond(tSec, orderedActionsAtSec, reason = "schedule") {
    const boundaryRes = getPlannerBoundaryStateData(tSec);
    if (!boundaryRes?.ok || boundaryRes?.stateData == null) {
      return {
        ok: false,
        reason: boundaryRes?.reason ?? "boundaryMissing",
        detail: boundaryRes?.detail ?? null,
      };
    }

    const validationState = deserializeGameState(boundaryRes.stateData);
    canonicalizeSnapshot(validationState);
    validationState.paused = false;

    for (const action of orderedActionsAtSec) {
      const res = applyAction(validationState, action, { isReplay: true });
      if (res?.ok) continue;
      return {
        ok: false,
        reason: res?.reason ?? "actionFailed",
        detail: res?.detail ?? res ?? null,
        tSec,
        commitReason: reason,
      };
    }

    return {
      ok: true,
      state: validationState,
    };
  }

  function truncateFutureHistoryAtSecond(tSec) {
    const sec = Math.max(0, Math.floor(tSec ?? 0));
    const prevHistoryEnd = Math.floor(timeline?.historyEndSec ?? 0);
    if (sec < prevHistoryEnd) {
      truncateTimelineAfterSecond(timeline, sec);
      return;
    }

    let normalizedByMutator = false;
    if (Array.isArray(timeline?.actions) && timeline.actions.length) {
      const lastAction = timeline.actions[timeline.actions.length - 1];
      const lastActionSec = Math.floor(lastAction?.tSec ?? -1);
      if (lastActionSec > sec) {
        truncateTimelineAfterSecond(timeline, sec);
        normalizedByMutator = true;
      }
    }
    if (
      !normalizedByMutator &&
      Array.isArray(timeline?.checkpoints) &&
      timeline.checkpoints.length
    ) {
      const lastCheckpoint = timeline.checkpoints[timeline.checkpoints.length - 1];
      const lastCheckpointSec = Math.floor(lastCheckpoint?.checkpointSec ?? -1);
      if (lastCheckpointSec > sec) {
        timeline.checkpoints = truncateCheckpointsAfterSecond(
          timeline.checkpoints,
          sec
        );
      }
    }
    timeline.historyEndSec = sec;
  }

  function applyActionsAtCurrentSecondByResim(actionsAtSec, opts = {}) {
    if (!timeline || !cursorState) return { ok: false, reason: "noState" };

    const currentSec = Math.max(0, Math.floor(cursorState.tSec ?? 0));
    const currentStepIndex = Math.max(
      0,
      Math.floor(cursorState.simStepIndex ?? currentSec * TICKS_PER_SEC)
    );
    const elapsedStepsWithinSecond = currentStepIndex % TICKS_PER_SEC;
    const gate = getEditWindowStatusForSecond(currentSec);
    if (!gate.ok) {
      return {
        ok: false,
        reason: gate.reason,
        ...gate,
      };
    }

    const stampedActions = normalizeBatchActions(actionsAtSec, currentSec);
    if (!stampedActions.length) {
      return { ok: false, reason: "noActions" };
    }

    truncateFutureHistoryAtSecond(currentSec);

    const existingAtSec = getActionsAtSecond(timeline, currentSec);
    const orderedAtSec = existingAtSec.concat(stampedActions);
    const validation = validateReplayActionsAtSecond(
      currentSec,
      orderedAtSec,
      opts.reason || "currentSecondResim"
    );
    if (!validation?.ok) return validation;

    const replaceRes = replaceActionsAtSecond(timeline, currentSec, orderedAtSec, {
      truncateFuture: false,
    });
    if (!replaceRes?.ok) return replaceRes || { ok: false, reason: "replace" };

    const rebuilt = rebuildStateAtSecond(timeline, currentSec);
    if (!rebuilt?.ok) {
      return rebuilt || { ok: false, reason: "rebuildFailed", tSec: currentSec };
    }
    const rebuiltState = rebuilt.state;
    for (let step = 0; step < elapsedStepsWithinSecond; step += 1) {
      updateGame(SIM_DT_STEP, rebuiltState);
    }
    applyTimelinePersistentKnowledgeToState(rebuiltState);

    dragPreviewState = null;
    simAccumulator = 0;
    pauseRequested = false;

    loadStateObjectIntoGameState(rebuiltState);
    cursorState = gameState;
    setPaused(cursorState, false);
    syncPhaseToPaused(cursorState);

    clearPlannerBoundaryCache();
    timeline.cursorSec = currentSec;
    timeline.historyEndSec = currentSec;
    seekPlaybackIndex(currentSec);
    playbackActive = currentSec < getPlaybackCeilingSec();
    maintainCheckpoints(timeline, cursorState, ACTION_PATH_CHECKPOINT_OPTS);
    syncTimelineMaxReachedHistoryEndSec();

    onRebuildViews?.("actionDispatchedCurrentSec");
    onInvalidate?.("actionDispatchedCurrentSec");

    return {
      ok: true,
      applied: true,
      tSec: currentSec,
      count: stampedActions.length,
      actions: cloneResultActions(stampedActions),
      resimulatedSteps: elapsedStepsWithinSecond,
    };
  }

  function scheduleActionsAtSecond(actionsAtSec, tSec, opts = {}) {
    if (!timeline || !cursorState) return { ok: false, reason: "noState" };
    const sec = Math.max(0, Math.floor(tSec ?? 0));
    const gate = getEditWindowStatusForSecond(sec);
    if (!gate.ok) {
      return {
        ok: false,
        reason: gate.reason,
        ...gate,
      };
    }

    const scheduledActions = (Array.isArray(actionsAtSec) ? actionsAtSec : [])
      .filter((action) => action && typeof action === "object" && action.kind)
      .map((action) => ({
        ...action,
        tSec: sec,
      }));
    if (!scheduledActions.length) {
      return { ok: false, reason: "noActions" };
    }

    const existingAtSec = getActionsAtSecond(timeline, sec);
    const orderedAtSec = existingAtSec.concat(scheduledActions);
    const validation = validateReplayActionsAtSecond(
      sec,
      orderedAtSec,
      opts.reason || "schedule"
    );
    if (!validation?.ok) return validation;

    const replaceRes = replaceActionsAtSecond(timeline, sec, orderedAtSec, {
      truncateFuture: false,
    });
    if (!replaceRes?.ok) return replaceRes || { ok: false, reason: "replace" };

    clearPlannerBoundaryCache();
    seekPlaybackIndex(Math.floor(cursorState.tSec ?? 0));
    playbackActive = Math.floor(cursorState.tSec ?? 0) < getPlaybackCeilingSec();

    onRebuildViews?.("actionScheduled");
    onInvalidate?.("actionScheduled");

    return {
      ok: true,
      scheduled: true,
      tSec: sec,
      count: scheduledActions.length,
      actions: scheduledActions.map((action) => ({
        ...action,
        payload:
          action.payload && typeof action.payload === "object"
            ? JSON.parse(JSON.stringify(action.payload))
            : action.payload ?? null,
      })),
    };
  }

  function scheduleActionsAtNextSecond(actionsAtSec, opts = {}) {
    const currentSec = Math.max(0, Math.floor(cursorState?.tSec ?? 0));
    return scheduleActionsAtSecond(actionsAtSec, currentSec + 1, opts);
  }

  function scheduleActionAtNextSecond(kind, payload, opts = {}) {
    return scheduleActionsAtNextSecond(
      [
        {
          kind,
          payload,
          apCost: opts.apCost,
        },
      ],
      opts
    );
  }

  function commitPlannerActions(reason) {
    if (!timeline || !cursorState) return { ok: false, reason: "noState" };
    const perfStart = perfEnabled() ? perfNowMs() : 0;

    const build = actionPlanner.buildCommitActions?.();
    if (!build?.ok) return build || { ok: false, reason: "buildFailed" };

    const actions = build.actions || [];
    const tSec = Math.floor(cursorState.tSec ?? 0);
    const gate = getEditWindowStatusForSecond(tSec);
    if (!gate.ok) {
      lastPlannerCommitError = {
        reason: gate.reason,
        detail: gate,
        tSec,
        commitReason: reason || "commit",
      };
      actionPlanner.resetToTimeline?.();
      onRebuildViews?.("plannerCommitBlocked");
      onInvalidate?.("plannerCommitBlocked");
      recordPlannerCommit({
        ok: false,
        ms: perfEnabled() ? perfNowMs() - perfStart : 0,
        committed: 0,
      });
      return {
        ok: false,
        reason: gate.reason,
        ...gate,
      };
    }

    const actionsWithTSec = actions.map((action) => ({
      ...action,
      tSec,
    }));

    const existingAtSec = getActionsAtSecond(timeline, tSec);

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

    // Validate planner commit from the second boundary state at tSec:
    // state after replaying through tSec-1 and advancing one simulation second,
    // but before applying any actions at tSec.
    const boundaryRes = getPlannerBoundaryStateData(tSec);
    if (!boundaryRes?.ok || boundaryRes?.stateData == null) {
      lastPlannerCommitError = {
        reason: boundaryRes?.reason ?? "boundaryMissing",
        detail: boundaryRes?.detail ?? null,
        tSec,
        commitReason: reason || "commit",
      };
      console.warn("Planner commit failed:", lastPlannerCommitError);
      actionPlanner.resetToTimeline?.();
      onRebuildViews?.("plannerCommitFailed");
      onInvalidate?.("plannerCommitFailed");
      recordPlannerCommit({
        ok: false,
        ms: perfEnabled() ? perfNowMs() - perfStart : 0,
        committed: 0,
      });
      return {
        ok: false,
        reason: "commitFailed",
        detail: lastPlannerCommitError,
      };
    }

    const validationState = deserializeGameState(boundaryRes.stateData);
    canonicalizeSnapshot(validationState);
    validationState.paused = false;

    for (const action of orderedAtSec) {
      const res = applyAction(validationState, action, { isReplay: true });
      if (res?.ok) continue;
      lastPlannerCommitError = {
        reason: res?.reason ?? "actionFailed",
        detail: res?.detail ?? res ?? null,
        tSec,
        commitReason: reason || "commit",
      };
      console.warn("Planner commit failed:", lastPlannerCommitError);
      actionPlanner.resetToTimeline?.();
      onRebuildViews?.("plannerCommitFailed");
      onInvalidate?.("plannerCommitFailed");
      recordPlannerCommit({ ok: false, ms: perfEnabled() ? perfNowMs() - perfStart : 0, committed: 0 });
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
    loadStateObjectIntoGameState(validationState);
    cursorState = gameState;
    setPaused(cursorState, wasPaused);
    syncPhaseToPaused(cursorState);

    playbackActive = false;
    seekPlaybackIndex(tSec);
    maintainCheckpoints(timeline, cursorState, ACTION_PATH_CHECKPOINT_OPTS);
    syncTimelineMaxReachedHistoryEndSec();
    // Replacing actions at this exact second preserves the boundary state.
    // Keep cache warm for subsequent planner edits at the same tSec.

    actionPlanner.markCommitted?.({
      tSec,
      revision: timeline.revision ?? 0,
    });

    onRebuildViews?.("plannerCommit");
    // Always emit plannerCommit so graph controllers can apply
    // incremental replace-action invalidation instead of full fallback rebuild.
    const invalidateReason = `plannerCommit:${reason || "commit"}`;
    onInvalidate?.(invalidateReason);
    recordPlannerCommit({
      ok: true,
      ms: perfEnabled() ? perfNowMs() - perfStart : 0,
      committed: actionsWithTSec.length,
    });

    return { ok: true, committed: actionsWithTSec.length };
  }

  function clearPlannerActionsAtCursor() {
    if (!timeline || !cursorState) return { ok: false, reason: "noState" };

    const tSec = Math.floor(cursorState.tSec ?? 0);
    const gate = getEditWindowStatusForSecond(tSec);
    if (!gate.ok) {
      return {
        ok: false,
        reason: gate.reason,
        ...gate,
      };
    }

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
    loadStateObjectIntoGameState(rebuilt.state);
    cursorState = gameState;
    setPaused(cursorState, wasPaused);
    syncPhaseToPaused(cursorState);

    playbackActive = tSec < lastActionSec;
    seekPlaybackIndex(tSec);

    actionPlanner.resetToTimeline?.();
    clearPlannerBoundaryCache();
    onRebuildViews?.("plannerClear");
    onInvalidate?.("plannerClear");

    return { ok: true };
  }


  // API
  return {
    init() {
      return initializeFromSetup(activeSetupId, "init");
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
          onRebuildViews?.("scrubCommit");
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
          const playbackCeilingSec = getPlaybackCeilingSec();
          const currentTSec = Math.floor(simStep / TICKS_PER_SEC);

          if (currentTSec > playbackCeilingSec) {
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
        syncTimelineMaxReachedHistoryEndSec();
      }

      if (playbackAppliedThisUpdate) {
        onRebuildViews?.("playbackApply");
        onInvalidate?.("playbackApply");
      }

      if (steps === maxSteps) {
        simAccumulator = 0;
      }
    },

    dispatchAction(kind, payload, opts = {}) {
      const perfStart = perfEnabled() ? perfNowMs() : 0;
      const finishDispatch = (res) => {
        recordActionDispatch({
          ok: !!res?.ok,
          ms: perfEnabled() ? perfNowMs() - perfStart : 0,
        });
        return res;
      };
      const prepared = prepareDispatchBatch([
        {
          kind,
          payload,
          apCost: opts.apCost,
        },
      ]);
      if (!prepared?.ok) {
        return finishDispatch(prepared);
      }

      if (!cursorState?.paused && !isImmediateActionKind(kind)) {
        return finishDispatch(
          scheduleActionAtNextSecond(kind, payload, {
            apCost: opts.apCost,
            reason: "dispatchLive",
          })
        );
      }

      const tSec = Math.floor(cursorState.tSec ?? 0);
      const gate = getEditWindowStatusForSecond(tSec);
      if (!gate.ok) {
        return finishDispatch({
          ok: false,
          reason: gate.reason,
          ...gate,
        });
      }

      truncateFutureHistoryAtSecond(tSec);

      // Apply Live
      const exec = applyAction(cursorState, {
        kind,
        payload,
        apCost: opts.apCost,
      });
      if (!exec?.ok) return finishDispatch(exec || { ok: false, reason: "cmdFailed" });

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
      if (!rec.ok) return finishDispatch(rec);

      seekPlaybackIndex(tSec);
      playbackActive = tSec < getPlaybackCeilingSec();
      maintainCheckpoints(timeline, cursorState, ACTION_PATH_CHECKPOINT_OPTS);
      syncTimelineMaxReachedHistoryEndSec();

      onRebuildViews?.("actionDispatched");
      onInvalidate?.("actionDispatched");

      return finishDispatch(exec && typeof exec === "object" ? exec : { ok: true });
    },

    dispatchActionAtCurrentSecond(kind, payload, opts = {}) {
      const perfStart = perfEnabled() ? perfNowMs() : 0;
      const finishDispatch = (res) => {
        recordActionDispatch({
          ok: !!res?.ok,
          ms: perfEnabled() ? perfNowMs() - perfStart : 0,
        });
        return res;
      };
      const prepared = prepareDispatchBatch([
        {
          kind,
          payload,
          apCost: opts.apCost,
        },
      ]);
      if (!prepared?.ok) {
        return finishDispatch(prepared);
      }
      return finishDispatch(
        applyActionsAtCurrentSecondByResim(prepared.actions, {
          reason: opts.reason || "dispatchLiveCurrentSec",
        })
      );
    },

    dispatchActionsAtCurrentSecond(actions, opts = {}) {
      const perfStart = perfEnabled() ? perfNowMs() : 0;
      const finishDispatch = (res) => {
        recordActionDispatch({
          ok: !!res?.ok,
          ms: perfEnabled() ? perfNowMs() - perfStart : 0,
        });
        return res;
      };
      const prepared = prepareDispatchBatch(
        normalizeBatchActions(actions).map((action) => ({
          ...action,
          apCost:
            action?.apCost ??
            action?.payload?.apCost ??
            0,
        }))
      );
      if (!prepared?.ok) {
        return finishDispatch(prepared);
      }
      return finishDispatch(
        applyActionsAtCurrentSecondByResim(prepared.actions, {
          reason: opts.reason || "dispatchBatchLiveCurrentSec",
        })
      );
    },

    commitCursorSecond(tSec, stateData) {
      const perfStart = perfEnabled() ? perfNowMs() : 0;
      const res = commitCursorSecondInternal(tSec, stateData);
      const elapsedMs = perfEnabled() ? perfNowMs() - perfStart : 0;
      if (!res.ok) {
        recordScrubCommit({ ok: false, moved: false, ms: elapsedMs });
        return res;
      }
      recordScrubCommit({ ok: true, moved: !!res.moved, ms: elapsedMs });
      return { ok: true, moved: !!res.moved };
    },

    browseCursorSecond(tSec, stateData) {
      const perfStart = perfEnabled() ? perfNowMs() : 0;
      const prevSec = Math.floor(cursorState?.tSec ?? 0);
      // Same as commit path: always resolve browse targets from timeline state
      // to prevent stale cursor jumps when cache invalidation is delayed.
      const res = seekCursorSecond(tSec, null, {
        paused: true,
        maintainCheckpoints: false,
      });
      const elapsedMs = perfEnabled() ? perfNowMs() - perfStart : 0;
      if (!res.ok) {
        recordScrubBrowse({ ok: false, moved: false, ms: elapsedMs });
        return res;
      }

      const moved = Math.floor(cursorState?.tSec ?? 0) !== prevSec;
      if (moved) {
        onRebuildViews?.("scrubBrowse");
        onInvalidate?.("scrubBrowse");
      }
      recordScrubBrowse({ ok: true, moved, ms: elapsedMs });
      return { ok: true, moved };
    },

    commitPreviewToLive() {
      const preview = getPreviewStatus();
      if (!preview.active) return { ok: false, reason: "noPreview" };
      if (!preview.isForecastPreview) {
        return { ok: false, reason: "previewNotForecast", ...preview };
      }
      const perfStart = perfEnabled() ? perfNowMs() : 0;
      const stateData = serializeGameState(dragPreviewState);
      const res = commitCursorSecondInternal(preview.previewSec, stateData);
      const elapsedMs = perfEnabled() ? perfNowMs() - perfStart : 0;
      if (!res.ok) {
        recordScrubCommit({ ok: false, moved: false, ms: elapsedMs });
        return res;
      }
      recordScrubCommit({ ok: true, moved: !!res.moved, ms: elapsedMs });
      return { ok: true, moved: !!res.moved };
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
    getCursorState: () => {
      applyTimelinePersistentKnowledgeToState(cursorState);
      return cursorState;
    },
    getState: () => {
      const state = dragPreviewState || cursorState;
      applyTimelinePersistentKnowledgeToState(state);
      return state;
    },
    getPreviewStatus,
    getPlannerBoundaryStateData: (tSec) => getPlannerBoundaryStateData(tSec),
    isPreviewing: () => !!dragPreviewState,
    getEditableHistoryBounds,
    getEditWindowStatusAtSecond: (tSec) => getEditWindowStatusForSecond(tSec),
    setFullHistoryEditOverride: (enabled) => {
      fullHistoryEditOverrideEnabled = enabled === true;
      return { ok: true, enabled: fullHistoryEditOverrideEnabled };
    },
    getFullHistoryEditOverride: () => fullHistoryEditOverrideEnabled,
    getLastPlannerCommitError: () => lastPlannerCommitError,
    setPreviewState: (s) => {
      dragPreviewState = s || null;
      // Forecast preview browse must remain read-only; only explicit commit
      // paths should make preview state authoritative.
      applyTimelinePersistentKnowledgeToState(dragPreviewState);
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
    scheduleActionAtNextSecond,
    scheduleActionsAtNextSecond,
    clearPlannerActionsAtCursor,
    saveToSlot,
    loadFromSlot,
    resetToSetup: (nextSetupId) => initializeFromSetup(nextSetupId, "init"),
    getSaveSlotMeta,
    getSetupId: () => activeSetupId,
    getSaveSlotCount: () => saveSlotCount,
  };
}
