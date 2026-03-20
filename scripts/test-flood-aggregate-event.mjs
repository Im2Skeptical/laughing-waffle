import assert from "node:assert/strict";

import { createSimRunner } from "../src/controllers/sim-runner.js";
import {
  deserializeGameState,
  rebuildBoardOccupancy,
  serializeGameState,
} from "../src/model/state.js";
import {
  getStateDataAtSecond,
  rebuildStateAtSecond,
} from "../src/model/timeline/index.js";

const FLOOD_DEF_ID = "event_flooding";

function cloneState(state) {
  return deserializeGameState(serializeGameState(state));
}

function buildDeck(state, defIds) {
  return {
    seasonKey: state.seasons[state.currentSeasonIndex],
    seasonIndex: state.currentSeasonIndex,
    year: state.year,
    deck: defIds.map((defId) => ({ defId })),
  };
}

function advanceRunnerToSecond(runner, targetSec, snapshotSeconds = []) {
  const wanted = new Set(snapshotSeconds.map((sec) => Math.max(0, Math.floor(sec))));
  const snapshots = new Map();
  while ((runner.getState()?.tSec ?? 0) < targetSec) {
    runner.update(1 / 60);
    const sec = Math.max(0, Math.floor(runner.getState()?.tSec ?? 0));
    if (wanted.has(sec) && !snapshots.has(sec)) {
      snapshots.set(sec, cloneState(runner.getState()));
    }
  }
  return snapshots;
}

function getDrawEntriesAtSecond(stateLike, tSec, defId = FLOOD_DEF_ID) {
  const sec = Math.max(0, Math.floor(tSec));
  const feed = Array.isArray(stateLike?.gameEventFeed) ? stateLike.gameEventFeed : [];
  return feed.filter((entry) => {
    if (!entry || entry.type !== "envDeckDraw") return false;
    if (Math.max(0, Math.floor(entry.tSec ?? -1)) !== sec) return false;
    return entry?.data?.defId === defId;
  });
}

function getLatestDrawEntryAtSecond(stateLike, tSec, defId = FLOOD_DEF_ID) {
  const entries = getDrawEntriesAtSecond(stateLike, tSec, defId);
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

function getFloodAnchors(stateLike) {
  const anchors = Array.isArray(stateLike?.board?.layers?.event?.anchors)
    ? stateLike.board.layers.event.anchors
    : [];
  return anchors.filter((anchor) => anchor?.defId === FLOOD_DEF_ID);
}

function getFloodHydrationValues(stateLike) {
  const tileAnchors = Array.isArray(stateLike?.board?.layers?.tile?.anchors)
    ? stateLike.board.layers.tile.anchors
    : [];
  const values = [];
  for (const anchor of getFloodAnchors(stateLike)) {
    const col = Number.isFinite(anchor?.col) ? Math.floor(anchor.col) : null;
    if (col == null) continue;
    const tile =
      tileAnchors.find((entry) => Number.isFinite(entry?.col) && Math.floor(entry.col) === col) ??
      null;
    const cur = tile?.systemState?.hydration?.cur;
    if (Number.isFinite(cur)) values.push(Math.floor(cur));
  }
  values.sort((a, b) => a - b);
  return values;
}

function summarizeFloodState(stateLike) {
  const run = stateLike?.activeEnvEventRuns?.flood ?? null;
  const anchors = getFloodAnchors(stateLike).map((anchor) => ({
    col: Number.isFinite(anchor?.col) ? Math.floor(anchor.col) : null,
    expiresSec: Number.isFinite(anchor?.expiresSec)
      ? Math.floor(anchor.expiresSec)
      : null,
    aggregateKey: anchor?.props?.aggregateKey ?? null,
    cardsDrawn: Number.isFinite(anchor?.props?.cardsDrawn)
      ? Math.floor(anchor.props.cardsDrawn)
      : null,
    magnitudeId: anchor?.props?.magnitudeId ?? null,
  }));
  anchors.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
  const deckDefIds = Array.isArray(stateLike?.currentSeasonDeck?.deck)
    ? stateLike.currentSeasonDeck.deck.map((entry) => entry?.defId ?? null)
    : [];
  const floodDraws = (Array.isArray(stateLike?.gameEventFeed) ? stateLike.gameEventFeed : [])
    .filter((entry) => entry?.type === "envDeckDraw" && entry?.data?.defId === FLOOD_DEF_ID)
    .map((entry) => ({
      tSec: Math.max(0, Math.floor(entry.tSec ?? 0)),
      outcome: entry?.data?.outcome ?? null,
      aggregation: entry?.data?.aggregation
        ? {
            aggregateKey: entry.data.aggregation.aggregateKey ?? null,
            cardsDrawn: Number.isFinite(entry.data.aggregation.cardsDrawn)
              ? Math.floor(entry.data.aggregation.cardsDrawn)
              : null,
            magnitudeId: entry.data.aggregation.magnitudeId ?? null,
            expiresSec: Number.isFinite(entry.data.aggregation.expiresSec)
              ? Math.floor(entry.data.aggregation.expiresSec)
              : null,
          }
        : null,
    }));
  return {
    tSec: Math.max(0, Math.floor(stateLike?.tSec ?? 0)),
    currentSeasonIndex: Math.max(0, Math.floor(stateLike?.currentSeasonIndex ?? 0)),
    currentSeasonDeckYear: Number.isFinite(stateLike?.currentSeasonDeck?.year)
      ? Math.floor(stateLike.currentSeasonDeck.year)
      : null,
    currentSeasonDeckIndex: Number.isFinite(stateLike?.currentSeasonDeck?.seasonIndex)
      ? Math.floor(stateLike.currentSeasonDeck.seasonIndex)
      : null,
    activeRun: run
      ? {
          defId: run.defId ?? null,
          aggregateKey: run.aggregateKey ?? null,
          sourceYear: Math.floor(run.sourceYear ?? 0),
          sourceSeasonIndex: Math.floor(run.sourceSeasonIndex ?? 0),
          firstDrawSec: Math.floor(run.firstDrawSec ?? 0),
          cardsDrawn: Math.floor(run.cardsDrawn ?? 0),
          magnitudeId: run.magnitudeId ?? null,
          expiresSec: Math.floor(run.expiresSec ?? 0),
        }
      : null,
    anchors,
    hydrationValues: getFloodHydrationValues(stateLike),
    deckDefIds,
    floodDraws,
  };
}

function assertFloodRun(stateLike, { cardsDrawn, magnitudeId, expiresSec, hydrationCur }) {
  const run = stateLike?.activeEnvEventRuns?.flood;
  assert.ok(run, "expected active flood run");
  assert.equal(run.cardsDrawn, cardsDrawn, "unexpected flood card count");
  assert.equal(run.magnitudeId, magnitudeId, "unexpected flood magnitude");
  assert.equal(run.expiresSec, expiresSec, "unexpected flood expiry");
  const anchors = getFloodAnchors(stateLike);
  assert.ok(anchors.length > 0, "expected active flood anchors");
  for (const anchor of anchors) {
    assert.equal(anchor?.props?.aggregateKey, "flood", "anchor aggregate key mismatch");
    assert.equal(anchor?.props?.cardsDrawn, cardsDrawn, "anchor cardsDrawn mismatch");
    assert.equal(anchor?.props?.magnitudeId, magnitudeId, "anchor magnitude mismatch");
    assert.equal(anchor?.expiresSec, expiresSec, "anchor expiry mismatch");
  }
  const hydrationValues = getFloodHydrationValues(stateLike);
  assert.ok(hydrationValues.length > 0, "expected flood hydration values");
  assert.deepEqual(
    Array.from(new Set(hydrationValues)),
    [hydrationCur],
    "unexpected flood hydration"
  );
}

function assertParityAtSecond(runner, liveSnapshots, sec, label) {
  const live = liveSnapshots.get(sec);
  assert.ok(live, `${label}: missing live snapshot @${sec}`);
  const stateDataRes = getStateDataAtSecond(runner.getTimeline(), sec);
  assert.equal(stateDataRes?.ok, true, `${label}: stateData failed @${sec}`);
  const rebuildRes = rebuildStateAtSecond(runner.getTimeline(), sec);
  assert.equal(rebuildRes?.ok, true, `${label}: rebuild failed @${sec}`);
  const expected = summarizeFloodState(live);
  assert.deepEqual(
    summarizeFloodState(stateDataRes.stateData),
    expected,
    `${label}: stateData parity mismatch @${sec}`
  );
  assert.deepEqual(
    summarizeFloodState(rebuildRes.state),
    expected,
    `${label}: rebuild parity mismatch @${sec}`
  );
}

function runAggregateLifecycleAndPurgeChecks() {
  const runner = createSimRunner({ setupId: "devGym01" });
  runner.init();
  const state = runner.getState();
  state.seasonDurationSec = 200;
  state.currentSeasonDeck = buildDeck(state, [
    FLOOD_DEF_ID,
    FLOOD_DEF_ID,
    FLOOD_DEF_ID,
    FLOOD_DEF_ID,
    FLOOD_DEF_ID,
    "event_common_spring",
    "event_common_spring",
    "event_common_spring",
    "event_common_spring",
    FLOOD_DEF_ID,
  ]);

  runner.setPaused(false);
  const liveSnapshots = advanceRunnerToSecond(runner, 50, [20, 25, 50]);

  const sec5Entry = getLatestDrawEntryAtSecond(liveSnapshots.get(20), 5);
  assert.equal(sec5Entry?.data?.outcome, "placed", "first flood draw should place");
  assert.deepEqual(
    sec5Entry?.data?.aggregation,
    { aggregateKey: "flood", cardsDrawn: 1, magnitudeId: "low", expiresSec: 30 },
    "first flood aggregation payload mismatch"
  );

  const sec10Entry = getLatestDrawEntryAtSecond(liveSnapshots.get(20), 10);
  assert.equal(sec10Entry?.data?.outcome, "aggregated", "second flood draw should aggregate");
  const sec15Entry = getLatestDrawEntryAtSecond(liveSnapshots.get(20), 15);
  assert.equal(sec15Entry?.data?.outcome, "aggregated", "third flood draw should aggregate");
  const sec20Entry = getLatestDrawEntryAtSecond(liveSnapshots.get(20), 20);
  assert.equal(sec20Entry?.data?.outcome, "aggregated", "fourth flood draw should aggregate");
  assertFloodRun(liveSnapshots.get(20), {
    cardsDrawn: 4,
    magnitudeId: "heavy",
    expiresSec: 45,
    hydrationCur: 100,
  });

  const sec25Entry = getLatestDrawEntryAtSecond(liveSnapshots.get(25), 25);
  assert.equal(sec25Entry?.data?.outcome, "aggregated", "fifth flood draw should aggregate");
  assertFloodRun(liveSnapshots.get(25), {
    cardsDrawn: 5,
    magnitudeId: "heavy",
    expiresSec: 50,
    hydrationCur: 100,
  });

  const finalState = liveSnapshots.get(50);
  assert.equal(finalState?.activeEnvEventRuns?.flood ?? null, null, "flood run should clear");
  assert.equal(getFloodAnchors(finalState).length, 0, "flood anchors should expire");
  assert.equal(
    finalState.currentSeasonDeck.deck.some((entry) => entry?.defId === FLOOD_DEF_ID),
    false,
    "same-season deck should purge remaining flood cards on expiry"
  );

  assertParityAtSecond(runner, liveSnapshots, 25, "floodAggregate");
  assertParityAtSecond(runner, liveSnapshots, 50, "floodAggregate");
}

function runCrossSeasonPersistenceChecks() {
  const runner = createSimRunner({ setupId: "devGym01" });
  runner.init();
  const state = runner.getState();
  state.seasonDurationSec = 7;
  state.currentSeasonDeck = buildDeck(state, [FLOOD_DEF_ID]);

  runner.setPaused(false);
  advanceRunnerToSecond(runner, 8);

  const afterSeasonChange = cloneState(runner.getState());
  assert.notEqual(
    afterSeasonChange.currentSeasonIndex,
    0,
    "expected season to advance while flood was active"
  );
  assertFloodRun(afterSeasonChange, {
    cardsDrawn: 1,
    magnitudeId: "low",
    expiresSec: 30,
    hydrationCur: 68,
  });

  runner.getState().seasonDurationSec = 200;
  runner.getState().currentSeasonDeck = buildDeck(runner.getState(), [
    "event_common_spring",
    "event_common_spring",
    "event_common_spring",
    "event_common_spring",
    "event_common_spring",
    "event_common_spring",
    FLOOD_DEF_ID,
  ]);

  advanceRunnerToSecond(runner, 30);
  const finalState = cloneState(runner.getState());
  assert.equal(finalState?.activeEnvEventRuns?.flood ?? null, null, "cross-season flood should expire");
  assert.equal(
    finalState.currentSeasonDeck.deck.some((entry) => entry?.defId === FLOOD_DEF_ID),
    true,
    "later season deck should not be purged on old flood expiry"
  );
}

function runNoPlacementChecks() {
  const runner = createSimRunner({ setupId: "devGym01" });
  runner.init();
  const state = runner.getState();
  for (const anchor of state.board.layers.tile.anchors) {
    if (!anchor || anchor.defId !== "tile_floodplains") continue;
    anchor.defId = "tile_wetlands";
  }
  rebuildBoardOccupancy(state);
  state.currentSeasonDeck = buildDeck(state, [FLOOD_DEF_ID, "event_common_spring"]);

  runner.setPaused(false);
  advanceRunnerToSecond(runner, 5);

  const afterFirstDraw = cloneState(runner.getState());
  assert.equal(afterFirstDraw?.activeEnvEventRuns?.flood ?? null, null, "no-placement draw should not create run");
  assert.equal(getFloodAnchors(afterFirstDraw).length, 0, "no-placement draw should not spawn flood");
  const drawEntry = getLatestDrawEntryAtSecond(afterFirstDraw, 5);
  assert.equal(
    drawEntry?.data?.outcome,
    "consumedNoPlacement",
    "no-placement draw should consume without aggregation"
  );
}

runAggregateLifecycleAndPurgeChecks();
runCrossSeasonPersistenceChecks();
runNoPlacementChecks();
console.log("test-flood-aggregate-event: ok");
