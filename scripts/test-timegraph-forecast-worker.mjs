import assert from "node:assert/strict";

import { ActionKinds } from "../src/model/actions.js";
import { buildProjectionChunkFromStateData } from "../src/model/projection-chunk.js";
import { serializeGameState } from "../src/model/state.js";
import { createProjectionCache } from "../src/model/timegraph/projection-cache.js";
import { createTimeGraphController } from "../src/model/timegraph/controller-core.js";
import {
  createTimelineFromInitialState,
  getStateDataAtSecond,
  rebuildStateAtSecond,
  replaceActionsAtSecond,
} from "../src/model/timeline/index.js";
import { createEmptyState } from "../src/model/state.js";
import { createTimegraphForecastWorkerService } from "../src/controllers/timegraph-forecast-worker-service.js";
import { GRAPH_METRICS } from "../src/model/graph-metrics.js";

function createBasicTimeline() {
  const state = createEmptyState(12345);
  const timeline = createTimelineFromInitialState(state);
  timeline.cursorSec = 0;
  timeline.historyEndSec = 0;
  return { state, timeline };
}

function createFakeWorker() {
  const listeners = new Map();
  const worker = {
    messages: [],
    terminated: false,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
    postMessage(message) {
      worker.messages.push(message);
    },
    emit(message) {
      const handler = listeners.get("message");
      if (typeof handler === "function") {
        handler({ data: message });
      } else if (typeof worker.onmessage === "function") {
        worker.onmessage({ data: message });
      }
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}

function hashState(state) {
  return JSON.stringify(serializeGameState(state));
}

function testProjectionChunkParityWithScheduledActions() {
  const { timeline } = createBasicTimeline();
  const action = {
    kind: ActionKinds.DEBUG_SET_CAP,
    payload: { enabled: true, cap: 42, points: 42 },
    apCost: 0,
  };
  assert.equal(
    replaceActionsAtSecond(timeline, 3, [action], { truncateFuture: false }).ok,
    true
  );

  const boundaryRes = getStateDataAtSecond(timeline, 0);
  assert.equal(boundaryRes.ok, true);

  const chunkRes = buildProjectionChunkFromStateData(
    boundaryRes.stateData,
    0,
    5,
    {
      stepSec: 1,
      actionsBySecond: [{ tSec: 3, actions: [action] }],
    }
  );
  assert.equal(chunkRes.ok, true, chunkRes.reason);

  const chunkStateData = chunkRes.stateDataBySecond.get(5) ?? chunkRes.lastStateData;
  const chunkStateHash = hashState(
    typeof chunkStateData === "string" ? JSON.parse(chunkStateData) : chunkStateData
  );
  const rebuilt = rebuildStateAtSecond(timeline, 5);
  assert.equal(rebuilt.ok, true, rebuilt.reason);
  const rebuiltHash = hashState(rebuilt.state);
  assert.equal(chunkStateHash, rebuiltHash);
}

function testProjectionCacheChunkMergePersistsKnowledge() {
  const { timeline } = createBasicTimeline();
  const cache = createProjectionCache();
  cache.ensureSignature(timeline);
  const token = cache.getTimelineToken(timeline);
  const baseRes = getStateDataAtSecond(timeline, 0);
  assert.equal(baseRes.ok, true);

  const learnedStateData =
    typeof baseRes.stateData === "string"
      ? JSON.parse(baseRes.stateData)
      : JSON.parse(JSON.stringify(baseRes.stateData));
  learnedStateData.persistentKnowledge = {
    droppedItemKindsByPoolId: {
      "forageDrops::tile_floodplains": ["stone"],
    },
  };

  const mergeRes = cache.mergeForecastChunk(timeline, {
    timelineToken: token,
    historyEndSec: 0,
    baseSec: 0,
    endSec: 1,
    stepSec: 1,
    stateDataBySecond: [[1, baseRes.stateData]],
    lastStateData: learnedStateData,
  });
  assert.equal(mergeRes.ok, true, mergeRes.reason);
  assert.deepEqual(
    timeline.persistentKnowledge?.droppedItemKindsByPoolId?.[
      "forageDrops::tile_floodplains"
    ],
    ["stone"]
  );
}

function testProjectionCacheRejectsStaleChunkResults() {
  const { timeline } = createBasicTimeline();
  const cache = createProjectionCache();
  cache.ensureSignature(timeline);
  const staleToken = cache.getTimelineToken(timeline);
  const replaceRes = replaceActionsAtSecond(
    timeline,
    1,
    [
      {
        kind: ActionKinds.DEBUG_SET_CAP,
        payload: { enabled: true, cap: 10, points: 10 },
        apCost: 0,
      },
    ],
    { truncateFuture: false }
  );
  assert.equal(replaceRes.ok, true);

  const mergeRes = cache.mergeForecastChunk(timeline, {
    timelineToken: staleToken,
    historyEndSec: 0,
    baseSec: 0,
    endSec: 1,
    stepSec: 1,
    stateDataBySecond: [],
    lastStateData: null,
  });
  assert.equal(mergeRes.ok, false);
  assert.equal(mergeRes.reason, "staleTimelineToken");
}

function testProjectionCacheTokenStableAcrossFrontierAdvance() {
  const { timeline } = createBasicTimeline();
  const cache = createProjectionCache();
  cache.ensureSignature(timeline);
  const tokenBefore = cache.getTimelineToken(timeline);

  timeline.cursorSec = 5;
  timeline.historyEndSec = 5;
  timeline.revision = Math.floor(timeline.revision ?? 0) + 1;

  cache.ensureSignature(timeline);
  const tokenAfter = cache.getTimelineToken(timeline);
  assert.equal(tokenAfter, tokenBefore);
}

function testControllerPartialForecastDoesNotSyncBuildUnloadedSeconds() {
  const { state, timeline } = createBasicTimeline();
  const projectionCache = createProjectionCache();
  const controller = createTimeGraphController({
    getTimeline: () => timeline,
    getCursorState: () => state,
    metric: GRAPH_METRICS.gold,
    projectionCache,
  });

  controller.setActive(true);
  const ensureRes = controller.ensureCache();
  assert.equal(ensureRes.ok, true, ensureRes.reason);

  const sampleRes = controller.getSamplesForWindow({
    startSec: 0,
    endSec: 8,
    focus: false,
    cursorSec: 0,
  });
  assert.equal(sampleRes.ok, true, sampleRes.reason);
  const futurePoint = sampleRes.points.find((point) => point.tSec === 5);
  assert.equal(futurePoint?.pending, true);
  assert.ok(
    controller.getStateDataAt(5),
    "controller should synchronously resolve a browsed future second on demand"
  );
  assert.ok(
    projectionCache.getStateData(5),
    "on-demand future browse should populate projection cache for that second"
  );

  const historyState = controller.getStateAt(0);
  assert.ok(historyState, "history state should still resolve synchronously");
}

function testWorkerServiceDedupesEquivalentRequests() {
  const { timeline } = createBasicTimeline();
  const projectionCache = createProjectionCache();
  projectionCache.ensureSignature(timeline);
  const fakeWorker = createFakeWorker();
  const service = createTimegraphForecastWorkerService({
    createWorker: () => fakeWorker,
    timeNowMs: () => 1000,
  });

  const boundaryRes = getStateDataAtSecond(timeline, 0);
  assert.equal(boundaryRes.ok, true);
  const request = {
    projectionCache,
    timeline,
    timelineToken: projectionCache.getTimelineToken(timeline),
    historyEndSec: 0,
    stepSec: 1,
    desiredEndSec: 250,
    boundaryStateData: boundaryRes.stateData,
    scheduledActionsBySecond: [],
  };

  const first = service.requestCoverage(request);
  const second = service.requestCoverage(request);
  assert.equal(first.ok, true, first.reason);
  assert.equal(second.ok, true, second.reason);
  assert.equal(fakeWorker.messages.length, 1);

  service.dispose();
  assert.equal(fakeWorker.terminated, true);
}

const tests = [
  [
    "projection chunk parity with scheduled actions",
    testProjectionChunkParityWithScheduledActions,
  ],
  [
    "projection cache merge persists knowledge",
    testProjectionCacheChunkMergePersistsKnowledge,
  ],
  [
    "projection cache rejects stale chunk results",
    testProjectionCacheRejectsStaleChunkResults,
  ],
  [
    "projection cache token stable across frontier advance",
    testProjectionCacheTokenStableAcrossFrontierAdvance,
  ],
  [
    "controller partial forecast does not sync build unloaded future",
    testControllerPartialForecastDoesNotSyncBuildUnloadedSeconds,
  ],
  [
    "worker service dedupes equivalent requests",
    testWorkerServiceDedupesEquivalentRequests,
  ],
];

let failures = 0;
for (const [name, testFn] of tests) {
  try {
    testFn();
    console.log(`[pass] ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`[fail] ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exit(1);
}
