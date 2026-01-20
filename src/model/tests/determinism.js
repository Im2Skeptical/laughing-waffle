// src/model/tests/determinism.js
// Automated verification of determinism invariants.
// 1. Rebuild Consistency: Rebuild(B) == Rebuild(B)
// 2. Live vs Replay: LiveSim(Actions) == Rebuild(Actions)
// 3. Projection vs Replay: Forecast(B..B+N) == Rebuild(B+N)

import { serializeGameState, deserializeGameState } from "../state.js";
import {
  createTimelineFromInitialState,
  rebuildStateAtBoundary,
} from "../timeline.js";
import { updateGame, createInitialState } from "../game-model.js";
import { buildGoldGraphWindowFromTimeline } from "../projection.js";
import { canonicalizeSnapshot } from "../canonicalize.js";

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
    // because simulation (season start) is implicit in the boundary transition.

    // Rebuild twice
    const res1 = rebuildStateAtBoundary(tl, 0);
    const res2 = rebuildStateAtBoundary(tl, 0);

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
    // This matches what replay does (rebuildStateAtBoundary calls canonicalize first).
    canonicalizeSnapshot(liveState, 0);

    const startSec = liveState.tSec ?? 0;
    const targetSec = startSec + 1;

    // 2. Start Season (Live)
    // Use the COMMAND directly, mirroring timeline.js internals.
    // Do not use applyAction (which is for planning phase actions).

    // 3. Run Live Loop (mirrors timeline.js::simulateOneSeason EXACTLY)
    const startBoundarySec = liveState.tSec ?? 0;
    const ticksPerSecond = 60; // 1 second == 60 ticks
    const ticksToRun = (targetSec - startBoundarySec) * ticksPerSecond;

    for (let i = 0; i < ticksToRun; i++) {
      updateGame(DT_STEP, liveState);
    }

    if ((liveState.tSec ?? 0) < targetSec) {
      throw new Error("Live sim failed to reach target boundary");
    }

    // 4. Canonicalize Live Result
    // RebuildStateAtBoundary ends with a hard canonicalize call.
    // We must do the same to Live to ensure apples-to-apples comparison
    // (clearing transient floating point noise or flags).
    canonicalizeSnapshot(liveState, targetSec);

    const liveHash = computeStateHash(liveState);

    // 5. Rebuild from Timeline (Replay)

    const rebuildRes = rebuildStateAtBoundary(tl, targetSec, {
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

    const baseBoundary = 0;
    const targetBoundary = 1; // Project 1 season forward

    // 1. Generate Projection
    // This simulates PURELY from 0 -> 1 using the projection logic.
    const winRes = buildGoldGraphWindowFromTimeline(tl, baseBoundary, {
      horizon: 5,
      dtStep: DT_STEP,
    });

    if (!winRes.ok) throw new Error("Projection failed: " + winRes.reason);

    // Extract the state data for boundary 1
    const projectedData = winRes.stateDataByBoundary.get(targetBoundary);
    if (!projectedData)
      throw new Error(
        "Projection yielded no data for boundary " + targetBoundary
      );

    const projectedState = deserializeGameState(projectedData);
    const projHash = computeStateHash(projectedState);

    // 2. Generate Replay
    const rebuildRes = rebuildStateAtBoundary(tl, targetBoundary, {
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
