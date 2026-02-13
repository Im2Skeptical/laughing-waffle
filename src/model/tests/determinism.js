// src/model/tests/determinism.js
// Automated verification of determinism invariants.
// 1. Rebuild Consistency: Rebuild(B) == Rebuild(B)
// 2. Live vs Replay: LiveSim(Actions) == Rebuild(Actions)
// 3. Projection vs Replay: Forecast(B..B+N) == Rebuild(B+N)

import { serializeGameState, deserializeGameState } from "../state.js";
import {
  createTimelineFromInitialState,
  rebuildStateAtSecond,
  replaceActionsAtSecond,
} from "../timeline/index.js";
import { updateGame, createInitialState } from "../game-model.js";
import { buildMetricGraphWindowFromTimeline } from "../projection.js";
import { canonicalizeSnapshot } from "../canonicalize.js";
import { ActionKinds } from "../actions.js";
import {
  createTimeGraphController,
  getSharedProjectionCache,
} from "../timegraph-controller.js";

const DT_STEP = 1 / 60;
const TEST_SEED = 99999;

// -----------------------------------------------------------------------------
// Hashing / Comparison
// -----------------------------------------------------------------------------

function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

// Custom canonicalizer for hashing that PRESERVES authoritative counters
// (tSec, simStepIndex, turn, currentSeasonIndex) to detect logic drift,
// while resetting transient runtime flags.
function normalizeRuntimeForHash(state) {
  // Reset runtime flags that shouldn't affect authoritative history
  state.paused = false;
  state.seasonTimeRemaining = 0;

  // Note: We DO NOT reset simTime, tSec, simStepIndex, turn, or seasons.
  // These must match exactly between live and replay.
}

function computeStateHash(state) {
  // 1. Serialize (strips derived fields like inventory grid)
  const serial = serializeGameState(state);
  const clone = deserializeGameState(serial);

  // 2. Normalize transient runtime fields only
  normalizeRuntimeForHash(clone);

  // 3. Stable Stringify
  const str = stableStringify(clone);

  // 4. Simple DJB2 hash
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function summarizeEnvEvents(state) {
  const anchors = Array.isArray(state?.board?.layers?.event?.anchors)
    ? state.board.layers.event.anchors
    : [];
  if (!anchors.length) return "";
  const entries = anchors.map((anchor) => {
    const defId = anchor?.defId ?? "unknown";
    const col = Number.isFinite(anchor?.col) ? Math.floor(anchor.col) : 0;
    const createdSec = Number.isFinite(anchor?.createdSec)
      ? Math.floor(anchor.createdSec)
      : 0;
    return `${defId}@${col}:${createdSec}`;
  });
  entries.sort();
  return entries.join("|");
}

// -----------------------------------------------------------------------------
// Scenarios
// -----------------------------------------------------------------------------

export function runDeterminismSuite() {
  console.group("🧪 Determinism Suite");
  const results = [];

  try {
    results.push(testRebuildConsistency());
    results.push(testLiveVsReplay());
    results.push(testProjectionVsReplay());
    results.push(testHistoryStableAfterFutureAction());
    results.push(testHistoryPreviewMatchesReplay());
  } catch (e) {
    console.error("Suite crashed:", e);
    results.push({ name: "Suite Integrity", passed: false, error: e.message });
  }

  console.groupEnd();
  console.table(results);
  return results.every((r) => r.passed);
}

function testRebuildConsistency() {
  const name = "Rebuild Idempotency";
  try {
    // Use real initialization logic
    const s0 = createInitialState(TEST_SEED);
    const tl = createTimelineFromInitialState(s0);

    // Note: We test empty timeline rebuilding here.
    // Adding ActionKinds.START_NEXT_TURN to the timeline is invalid
    // because simulation (season start) is implicit at second boundaries.

    // Rebuild twice
    const res1 = rebuildStateAtSecond(tl, 0);
    const res2 = rebuildStateAtSecond(tl, 0);

    if (!res1.ok || !res2.ok) throw new Error("Rebuild failed");

    const h1 = computeStateHash(res1.state);
    const h2 = computeStateHash(res2.state);

    if (h1 !== h2) {
      return { name, passed: false, reason: `Hash mismatch: ${h1} vs ${h2}` };
    }

    return { name, passed: true, hash: h1 };
  } catch (e) {
    return { name, passed: false, reason: e.message };
  }
}

function testLiveVsReplay() {
  const name = "Live Sim vs Replay";
  try {
    // 1. Setup Live
    const liveState = createInitialState(TEST_SEED);
    const tl = createTimelineFromInitialState(liveState);

    // Ensure we start from a clean, canonical planning snapshot.
    // This matches what replay does (rebuildStateAtSecond calls canonicalize first).
    canonicalizeSnapshot(liveState, 0);

    const startSec = liveState.tSec ?? 0;
    const targetSec = startSec + 1;

    // 2. Start Season (Live)
    // Use the COMMAND directly, mirroring timeline.js internals.
    // Do not use applyAction (which is for planning phase actions).

    // 3. Run Live Loop (mirrors timeline.js::simulateOneSeason EXACTLY)
    const ticksPerSecond = 60; // 1 second == 60 ticks
    const ticksToRun = (targetSec - startSec) * ticksPerSecond;

    for (let i = 0; i < ticksToRun; i++) {
      updateGame(DT_STEP, liveState);
    }

    if ((liveState.tSec ?? 0) < targetSec) {
      throw new Error("Live sim failed to reach target second");
    }

    // 4. Canonicalize Live Result
    // RebuildStateAtSecond ends with a hard canonicalize call.
    // We must do the same to Live to ensure apples-to-apples comparison
    // (clearing transient floating point noise or flags).
    canonicalizeSnapshot(liveState, targetSec);

    const liveHash = computeStateHash(liveState);

    // 5. Rebuild from Timeline (Replay)

    const rebuildRes = rebuildStateAtSecond(tl, targetSec, {
      dtStep: DT_STEP,
    });
    if (!rebuildRes.ok) throw new Error("Rebuild failed: " + rebuildRes.reason);

    const replayHash = computeStateHash(rebuildRes.state);

    if (liveHash !== replayHash) {
      // Debug helper: log key counters
      console.warn("Mismatch Details:", {
        live: {
          tSec: liveState.tSec,
          turn: liveState.turn,
          simTime: liveState.simTime,
          gold: liveState.resources?.gold,
        },
        replay: {
          tSec: rebuildRes.state.tSec,
          turn: rebuildRes.state.turn,
          simTime: rebuildRes.state.simTime,
          gold: rebuildRes.state.resources?.gold,
        },
      });
      return {
        name,
        passed: false,
        reason: `Hash mismatch (Live: ${liveHash} vs Replay: ${replayHash})`,
      };
    }

    return { name, passed: true, hash: liveHash };
  } catch (e) {
    return { name, passed: false, reason: e.message };
  }
}

function testProjectionVsReplay() {
  const name = "Projection vs Replay";
  try {
    const s0 = createInitialState(TEST_SEED + 1);
    const tl = createTimelineFromInitialState(s0);

    const baseSec = 0;
    const targetSec = 1; // Project 1 season forward

    // 1. Generate Projection
    // This simulates PURELY from 0 -> 1 using the projection logic.
    const winRes = buildMetricGraphWindowFromTimeline(tl, baseSec, {
      horizon: 5,
      dtStep: DT_STEP,
    });

    if (!winRes.ok) throw new Error("Projection failed: " + winRes.reason);

    // Extract the state data for second 1
    const projectedData = winRes.stateDataByBoundary.get(targetSec);
    if (!projectedData)
      throw new Error(
        "Projection yielded no data for second " + targetSec
      );

    const projectedState = deserializeGameState(projectedData);
    const projHash = computeStateHash(projectedState);

    // 2. Generate Replay
    const rebuildRes = rebuildStateAtSecond(tl, targetSec, {
      dtStep: DT_STEP,
    });
    if (!rebuildRes.ok) throw new Error("Rebuild failed: " + rebuildRes.reason);

    const replayHash = computeStateHash(rebuildRes.state);

    if (projHash !== replayHash) {
      return {
        name,
        passed: false,
        reason: `Hash mismatch (Proj: ${projHash} vs Replay: ${replayHash})`,
      };
    }

    return { name, passed: true, hash: projHash };
  } catch (e) {
    return { name, passed: false, reason: e.message };
  }
}

function testHistoryStableAfterFutureAction() {
  const name = "History Stable After Future Action";
  try {
    const historyEndSec = 300;
    const sampleSec = 120;
    const actionSec = 240;

    const s0 = createInitialState("testing", TEST_SEED);
    const tl = createTimelineFromInitialState(s0);
    tl.historyEndSec = historyEndSec;
    tl.cursorSec = historyEndSec;

    const before = rebuildStateAtSecond(tl, sampleSec);
    if (!before.ok) throw new Error("Rebuild failed: " + before.reason);

    const beforeHash = computeStateHash(before.state);
    const beforeEvents = summarizeEnvEvents(before.state);

    const action = {
      kind: ActionKinds.DEBUG_SET_CAP,
      payload: { cap: 42, points: 42, enabled: true },
      apCost: 0,
    };
    const replaceRes = replaceActionsAtSecond(tl, actionSec, [action], {
      truncateFuture: true,
    });
    if (!replaceRes.ok) {
      throw new Error("replaceActionsAtSecond failed: " + replaceRes.reason);
    }

    tl.historyEndSec = actionSec;
    tl.cursorSec = actionSec;

    const after = rebuildStateAtSecond(tl, sampleSec);
    if (!after.ok) throw new Error("Rebuild failed: " + after.reason);

    const afterHash = computeStateHash(after.state);
    const afterEvents = summarizeEnvEvents(after.state);

    if (beforeHash !== afterHash) {
      return {
        name,
        passed: false,
        reason: `Hash mismatch at t=${sampleSec} (before ${beforeHash} vs after ${afterHash})`,
        beforeEvents,
        afterEvents,
      };
    }

    return { name, passed: true, hash: beforeHash };
  } catch (e) {
    return { name, passed: false, reason: e.message };
  }
}

function testHistoryPreviewMatchesReplay() {
  const name = "History Preview Matches Replay";
  try {
    const historyEndSec = 300;
    const sampleSec = 120;
    const actionSec = 240;

    const s0 = createInitialState("testing", TEST_SEED + 1);
    const tl = createTimelineFromInitialState(s0);
    tl.historyEndSec = historyEndSec;
    tl.cursorSec = historyEndSec;

    const cursorRes = rebuildStateAtSecond(tl, historyEndSec);
    if (!cursorRes.ok) throw new Error("Rebuild failed: " + cursorRes.reason);
    let cursorState = cursorRes.state;

    const projection = getSharedProjectionCache();
    projection.clear?.();

    const controller = createTimeGraphController({
      getTimeline: () => tl,
      getCursorState: () => cursorState,
    });
    controller.setActive(true);
    const cacheRes = controller.ensureCache();
    if (cacheRes && cacheRes.ok === false) {
      throw new Error("Cache build failed: " + cacheRes.reason);
    }

    const previewBefore = controller.getStateAt(sampleSec);
    if (!previewBefore) throw new Error("Preview state missing (before edit)");
    const previewBeforeHash = computeStateHash(previewBefore);

    const replayBefore = rebuildStateAtSecond(tl, sampleSec);
    if (!replayBefore.ok) throw new Error("Rebuild failed: " + replayBefore.reason);
    const replayBeforeHash = computeStateHash(replayBefore.state);

    if (previewBeforeHash !== replayBeforeHash) {
      return {
        name,
        passed: false,
        reason: `Preview mismatch before edit at t=${sampleSec} (${previewBeforeHash} vs ${replayBeforeHash})`,
      };
    }

    const action = {
      kind: ActionKinds.DEBUG_SET_CAP,
      payload: { cap: 37, points: 37, enabled: true },
      apCost: 0,
    };
    const replaceRes = replaceActionsAtSecond(tl, actionSec, [action], {
      truncateFuture: true,
    });
    if (!replaceRes.ok) {
      throw new Error("replaceActionsAtSecond failed: " + replaceRes.reason);
    }

    tl.historyEndSec = actionSec;
    tl.cursorSec = actionSec;

    const nextCursorRes = rebuildStateAtSecond(tl, actionSec);
    if (!nextCursorRes.ok) {
      throw new Error("Rebuild failed: " + nextCursorRes.reason);
    }
    cursorState = nextCursorRes.state;

    controller.handleInvalidate?.("actionDispatched");

    const previewAfter = controller.getStateAt(sampleSec);
    if (!previewAfter) throw new Error("Preview state missing (after edit)");
    const previewAfterHash = computeStateHash(previewAfter);

    const replayAfter = rebuildStateAtSecond(tl, sampleSec);
    if (!replayAfter.ok) throw new Error("Rebuild failed: " + replayAfter.reason);
    const replayAfterHash = computeStateHash(replayAfter.state);

    if (replayAfterHash !== replayBeforeHash) {
      return {
        name,
        passed: false,
        reason: `Replay history changed after edit at t=${sampleSec} (${replayBeforeHash} vs ${replayAfterHash})`,
      };
    }

    if (previewAfterHash !== replayAfterHash) {
      return {
        name,
        passed: false,
        reason: `Preview mismatch after edit at t=${sampleSec} (${previewAfterHash} vs ${replayAfterHash})`,
      };
    }

    return { name, passed: true, hash: replayAfterHash };
  } catch (e) {
    return { name, passed: false, reason: e.message };
  }
}
