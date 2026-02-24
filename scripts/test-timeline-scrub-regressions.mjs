import assert from "node:assert/strict";

import { createSimRunner } from "../src/controllers/sim-runner.js";
import { ActionKinds } from "../src/model/actions.js";
import {
  createTimelineFromInitialState,
  getStateDataAtSecond,
  maintainCheckpoints,
  replaceActionsAtSecond,
  rebuildStateAtSecond,
  seedMemoStateDataAtSecond,
} from "../src/model/timeline/index.js";
import { createProjectionCache } from "../src/model/timegraph/projection-cache.js";
import {
  computeHistoryZoneSegments,
  computeScrollCommitDecision,
  computeScrollWindowSpec,
  getAbsoluteEditableRangeFromTimegraphState,
  mergeSecRanges,
  normalizeTimegraphPolicyState,
} from "../src/model/timegraph/edit-policy.js";
import { createTimeGraphController } from "../src/model/timegraph-controller.js";
import { GRAPH_METRICS } from "../src/model/graph-metrics.js";
import { cropDefs } from "../src/defs/gamepieces/crops-defs.js";
import { envTagDefs } from "../src/defs/gamesystems/env-tags-defs.js";
import { forageDropTables } from "../src/defs/gamepieces/forage-droptables-defs.js";
import { itemDefs } from "../src/defs/gamepieces/item-defs.js";
import { ENV_EVENT_DRAW_CADENCE_SEC } from "../src/defs/gamesettings/gamerules-defs.js";
import { deserializeGameState, serializeGameState } from "../src/model/state.js";
import { createInitialState } from "../src/model/game-model.js";
import { handleSpawnFromDropTable } from "../src/model/effects/ops/game-ops.js";
import { Inventory } from "../src/model/inventory-model.js";
import {
  getDroppedItemKindsForPool,
  rememberDroppedItemKind,
} from "../src/model/persistent-memory.js";
import {
  computeAvailableRecipesAndBuildings,
  getLeaderInventorySectionCapabilities,
} from "../src/model/skills.js";

function assertOk(res, label) {
  assert.equal(res?.ok, true, `${label} failed: ${JSON.stringify(res)}`);
}

function withMockLocalStorage(runCase) {
  const hadOwn = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const prev = globalThis.localStorage;
  const store = new Map();
  const mockStorage = {
    getItem(key) {
      if (!store.has(key)) return null;
      return store.get(key);
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: mockStorage,
  });

  try {
    return runCase(mockStorage);
  } finally {
    if (hadOwn) {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: prev,
      });
    } else {
      delete globalThis.localStorage;
    }
  }
}

function toSafeSec(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function firstWalkableEnvCol(state, { exclude = new Set() } = {}) {
  const cols = Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 0;
  for (let col = 0; col < cols; col += 1) {
    if (exclude.has(col)) continue;
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) continue;
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    const blocked = tags.some((tagId) => {
      const aff = Array.isArray(envTagDefs?.[tagId]?.affordances)
        ? envTagDefs[tagId].affordances
        : [];
      return aff.includes("noOccupy");
    });
    if (!blocked) return col;
  }
  return null;
}

function firstFarmableEnvCol(state) {
  const cols = Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 0;
  for (let col = 0; col < cols; col += 1) {
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) continue;
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    if (tags.includes("farmable")) return col;
  }
  return null;
}

function summarizeState(state) {
  const pawns = (state?.pawns ?? [])
    .map((p) => ({
      id: p.id,
      hubCol: p.hubCol ?? null,
      envCol: p.envCol ?? null,
    }))
    .sort((a, b) => a.id - b.id);

  const tileCrops = [];
  const tileTagDisabled = [];
  const cols = Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 0;
  for (let col = 0; col < cols; col += 1) {
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) continue;
    const cropId = tile?.systemState?.growth?.selectedCropId ?? null;
    if (cropId != null) {
      tileCrops.push({ col, cropId: String(cropId) });
    }
    const tagStates = tile?.tagStates ?? {};
    for (const [tagId, tagState] of Object.entries(tagStates)) {
      if (!tagState || typeof tagState !== "object") continue;
      if (tagState.disabled === true) {
        tileTagDisabled.push(`${col}:${tagId}`);
      }
    }
  }

  tileCrops.sort((a, b) => a.col - b.col || a.cropId.localeCompare(b.cropId));
  tileTagDisabled.sort();

  return { pawns, tileCrops, tileTagDisabled };
}

function assertControllerParity(controller, timeline, sec, label) {
  const fromController = controller.getStateAt(sec);
  const rebuilt = rebuildStateAtSecond(timeline, sec);
  assertOk(rebuilt, `${label} rebuild @${sec}`);
  assert.ok(fromController, `${label} controller null @${sec}`);
  assert.deepEqual(
    summarizeState(fromController),
    summarizeState(rebuilt.state),
    `${label} controller parity mismatch @${sec}`
  );
}

function assertPawnAt(stateData, pawnId, envCol, label) {
  const pawn = (stateData?.pawns ?? []).find((p) => p.id === pawnId);
  assert.ok(pawn, `${label}: pawn ${pawnId} missing`);
  assert.equal(pawn.hubCol ?? null, null, `${label}: pawn ${pawnId} expected no hub`);
  assert.equal(pawn.envCol ?? null, envCol, `${label}: pawn ${pawnId} expected env ${envCol}`);
}

function getEnvDeckDrawEntriesAtSecond(stateLike, tSec) {
  const targetSec = toSafeSec(tSec);
  const feed = Array.isArray(stateLike?.gameEventFeed) ? stateLike.gameEventFeed : [];
  return feed.filter((entry) => {
    if (!entry || entry.type !== "envDeckDraw") return false;
    return toSafeSec(entry.tSec) === targetSec;
  });
}

function normalizeDeckDrawEntry(entry) {
  const data = entry?.data && typeof entry.data === "object" ? entry.data : {};
  const placementsRaw = Array.isArray(data.placements) ? data.placements : [];
  const placements = placementsRaw
    .map((placement) => ({
      col: Number.isFinite(placement?.col) ? Math.floor(placement.col) : null,
      span:
        Number.isFinite(placement?.span) && placement.span > 0
          ? Math.floor(placement.span)
          : 1,
      instanceId: Number.isFinite(placement?.instanceId)
        ? Math.floor(placement.instanceId)
        : null,
    }))
    .filter((placement) => placement.col != null)
    .sort(
      (a, b) =>
        a.col - b.col ||
        (a.instanceId ?? Number.MAX_SAFE_INTEGER) -
          (b.instanceId ?? Number.MAX_SAFE_INTEGER)
    );
  return {
    type: entry?.type ?? null,
    tSec: toSafeSec(entry?.tSec),
    defId: typeof data.defId === "string" ? data.defId : null,
    seasonKey: typeof data.seasonKey === "string" ? data.seasonKey : null,
    outcome: typeof data.outcome === "string" ? data.outcome : null,
    consumePolicy:
      typeof data.consumePolicy === "string" ? data.consumePolicy : null,
    showInEventLog: data.showInEventLog,
    placements,
  };
}

function assertPlacementsSorted(entry, label) {
  const data = entry?.data && typeof entry.data === "object" ? entry.data : {};
  const placements = Array.isArray(data.placements) ? data.placements : [];
  for (let i = 1; i < placements.length; i += 1) {
    const prevCol = Number.isFinite(placements[i - 1]?.col)
      ? Math.floor(placements[i - 1].col)
      : Number.MAX_SAFE_INTEGER;
    const nextCol = Number.isFinite(placements[i]?.col)
      ? Math.floor(placements[i].col)
      : Number.MAX_SAFE_INTEGER;
    const prevId = Number.isFinite(placements[i - 1]?.instanceId)
      ? Math.floor(placements[i - 1].instanceId)
      : Number.MAX_SAFE_INTEGER;
    const nextId = Number.isFinite(placements[i]?.instanceId)
      ? Math.floor(placements[i].instanceId)
      : Number.MAX_SAFE_INTEGER;
    const ordered = prevCol < nextCol || (prevCol === nextCol && prevId <= nextId);
    assert.ok(ordered, `${label}: placements not sorted`);
  }
}

function runEnvDeckDrawFeedChecks() {
  const runner = createSimRunner({ setupId: "devGym01" });
  runner.init();
  runner.setPaused(false);

  const targetSec = Math.max(1, Math.floor(ENV_EVENT_DRAW_CADENCE_SEC));
  const steps = targetSec * 60;
  for (let i = 0; i < steps; i += 1) {
    runner.update(1 / 60);
  }

  const liveState = runner.getState();
  assert.ok(
    toSafeSec(liveState?.tSec) >= targetSec,
    `[envDeckDraw] live state did not reach t=${targetSec}`
  );

  const liveEntries = getEnvDeckDrawEntriesAtSecond(liveState, targetSec);
  assert.ok(liveEntries.length > 0, `[envDeckDraw] missing live draw entry at t=${targetSec}`);
  const liveEntry = liveEntries[liveEntries.length - 1];
  assert.equal(
    liveEntry?.data?.showInEventLog,
    false,
    "[envDeckDraw] showInEventLog must be false"
  );
  assertPlacementsSorted(liveEntry, "live");

  const timeline = runner.getTimeline();
  const stateDataResA = getStateDataAtSecond(timeline, targetSec);
  assertOk(stateDataResA, `[envDeckDraw] stateData A @${targetSec}`);
  const stateDataResB = getStateDataAtSecond(timeline, targetSec);
  assertOk(stateDataResB, `[envDeckDraw] stateData B @${targetSec}`);
  const snapshotEntriesA = getEnvDeckDrawEntriesAtSecond(stateDataResA.stateData, targetSec);
  const snapshotEntriesB = getEnvDeckDrawEntriesAtSecond(stateDataResB.stateData, targetSec);
  assert.ok(snapshotEntriesA.length > 0, `[envDeckDraw] missing snapshot A entry at t=${targetSec}`);
  assert.ok(snapshotEntriesB.length > 0, `[envDeckDraw] missing snapshot B entry at t=${targetSec}`);
  const snapshotEntryA = snapshotEntriesA[snapshotEntriesA.length - 1];
  const snapshotEntryB = snapshotEntriesB[snapshotEntriesB.length - 1];
  assertPlacementsSorted(snapshotEntryA, "snapshotA");
  assertPlacementsSorted(snapshotEntryB, "snapshotB");

  assert.deepEqual(
    normalizeDeckDrawEntry(snapshotEntryA),
    normalizeDeckDrawEntry(snapshotEntryB),
    "[envDeckDraw] repeated stateData reads at same tSec must match"
  );

  const rebuildRes = rebuildStateAtSecond(timeline, targetSec);
  assertOk(rebuildRes, `[envDeckDraw] rebuild @${targetSec}`);
  const rebuildEntries = getEnvDeckDrawEntriesAtSecond(rebuildRes.state, targetSec);
  assert.ok(rebuildEntries.length > 0, `[envDeckDraw] missing rebuild entry at t=${targetSec}`);
  const rebuildEntry = rebuildEntries[rebuildEntries.length - 1];
  assertPlacementsSorted(rebuildEntry, "rebuild");

  assert.deepEqual(
    normalizeDeckDrawEntry(liveEntry),
    normalizeDeckDrawEntry(rebuildEntry),
    "[envDeckDraw] live and rebuild payloads must match"
  );
}

function runScenarioSkillProgressionOverrideChecks() {
  const scenario = {
    rngSeed: 123,
    skillProgressionDefs: {
      defaultStartingSkillPoints: 2,
      startingSkillPointsByPawnDefId: {
        default: 4,
      },
      defaultUnlockedRecipes: ["roastBarley"],
      defaultUnlockedHubStructures: ["granary"],
    },
    board: {
      cols: 1,
      tiles: ["tile_hinterland"],
    },
    hub: {
      cols: 10,
      structures: [{ defId: "granary", hubCol: 0 }],
    },
    pawns: [{ name: "Override Pawn", role: "leader", hubCol: 0 }],
  };

  const state = createInitialState(scenario);
  assert.equal(
    state?.pawns?.[0]?.skillPoints,
    4,
    "scenario skillProgressionDefs should set default starting skill points"
  );

  const availability = computeAvailableRecipesAndBuildings(state);
  assert.deepEqual(
    Array.from(availability.recipeIds.values()),
    ["roastBarley"],
    "scenario skillProgressionDefs should override default unlocked recipes"
  );
  assert.deepEqual(
    Array.from(availability.hubStructureIds.values()),
    ["granary"],
    "scenario skillProgressionDefs should override default unlocked hub structures"
  );

  const explicitPawnScenario = {
    ...scenario,
    pawns: [{ name: "Explicit Pawn", role: "leader", hubCol: 0, skillPoints: 9 }],
  };
  const explicitState = createInitialState(explicitPawnScenario);
  assert.equal(
    explicitState?.pawns?.[0]?.skillPoints,
    9,
    "explicit pawn skillPoints should still override progression defaults"
  );
}

function runLeaderInventorySectionCapabilityChecks() {
  const scenario = {
    rngSeed: 456,
    skillProgressionDefs: {
      defaultStartingSkillPoints: 2,
      defaultUnlockedRecipes: ["__none__"],
      defaultUnlockedHubStructures: ["__none__"],
    },
    board: {
      cols: 1,
      tiles: ["tile_hinterland"],
    },
    hub: {
      cols: 10,
      structures: [{ defId: "granary", hubCol: 0 }],
    },
    pawns: [
      {
        name: "Gate Pawn",
        role: "leader",
        hubCol: 0,
        unlockedSkillNodeIds: [],
      },
    ],
  };

  const state = createInitialState(scenario);
  const leaderId = state?.pawns?.[0]?.id;
  assert.ok(Number.isFinite(leaderId), "expected leader id for inventory capability checks");

  const emptyCaps = getLeaderInventorySectionCapabilities(state, leaderId);
  assert.deepEqual(
    emptyCaps,
    {
      equipment: true,
      prestige: false,
      skills: false,
      build: false,
    },
    "leader inventory capabilities should be gated by unlocked skills and recipes"
  );

  state.pawns[0].unlockedSkillNodeIds = ["Memory"];
  const memoryCaps = getLeaderInventorySectionCapabilities(state, leaderId);
  assert.equal(memoryCaps.skills, true, "Memory should unlock Skills section");
  assert.equal(memoryCaps.prestige, false, "Worship should still gate Prestige section");

  state.pawns[0].unlockedSkillNodeIds = ["Memory", "Worship"];
  const worshipCaps = getLeaderInventorySectionCapabilities(state, leaderId);
  assert.equal(worshipCaps.skills, true, "Memory should keep Skills section unlocked");
  assert.equal(worshipCaps.prestige, true, "Worship should unlock Prestige section");

  state.skillRuntime = {
    modifiers: {
      global: {},
      pawnById: {},
    },
    unlocks: {
      recipes: [],
      hubStructures: ["hearth"],
      envTags: [],
      hubTags: [],
      itemTags: [],
    },
  };
  const buildCaps = getLeaderInventorySectionCapabilities(state, leaderId);
  assert.equal(buildCaps.build, true, "any unlocked hub structure should unlock Build section");

  const invalidCaps = getLeaderInventorySectionCapabilities(state, -99999);
  assert.deepEqual(
    invalidCaps,
    {
      equipment: false,
      prestige: false,
      skills: false,
      build: false,
    },
    "unknown leaders should not expose inventory section capabilities"
  );
}

function withTestDropTable(runCase) {
  const testTableKey = "testPersistentDropMemory";
  const prev = Object.prototype.hasOwnProperty.call(forageDropTables, testTableKey)
    ? forageDropTables[testTableKey]
    : undefined;

  forageDropTables[testTableKey] = {
    tierWeights: { bronze: 1, silver: 1, gold: 1, diamond: 1 },
    nullWeight: 0,
    default: {
      drops: [{ kind: "stone", weight: 1, qtyMin: 1, qtyMax: 1 }],
    },
    byTile: {
      tile_floodplains: {
        nullWeight: 0,
        drops: [{ kind: "stone", weight: 1, qtyMin: 1, qtyMax: 1 }],
      },
      tile_wetlands: {
        nullWeight: 0,
        drops: [{ kind: "straw", weight: 1, qtyMin: 1, qtyMax: 1 }],
      },
      tile_levee: {
        nullWeight: 0,
        drops: [{ kind: "stone", weight: 1, qtyMin: 1, qtyMax: 1 }],
      },
      tile_hinterland: {
        nullWeight: 0,
        drops: [{ miss: true, weight: 1 }],
      },
    },
  };

  try {
    runCase(testTableKey);
  } finally {
    if (prev === undefined) delete forageDropTables[testTableKey];
    else forageDropTables[testTableKey] = prev;
  }
}

function runPersistentDropMemoryChecks() {
  const makeDropTestState = () =>
    createInitialState({
      rngSeed: 123,
      board: {
        cols: 1,
        tiles: ["tile_floodplains"],
      },
      hub: {
        cols: 1,
        structures: [],
      },
      pawns: [{ name: "Drop Tester", role: "leader", hubCol: 0 }],
    });

  withTestDropTable((tableKey) => {
    const hitState = makeDropTestState();
    const hitOwnerId = hitState?.pawns?.[0]?.id;
    assert.ok(Number.isFinite(hitOwnerId), "hit test owner missing");

    const hitRes = handleSpawnFromDropTable(
      hitState,
      {
        op: "SpawnFromDropTable",
        tableKey,
        target: { ownerId: hitOwnerId },
      },
      {
        kind: "game",
        state: hitState,
        source: { defId: "tile_floodplains", col: 0, tags: [] },
        pawnId: hitOwnerId,
        ownerId: hitOwnerId,
        tSec: 0,
      }
    );
    assert.equal(hitRes, true, "hit drop should return true");
    assert.deepEqual(
      getDroppedItemKindsForPool(hitState, {
        tableKey,
        tileDefId: "tile_floodplains",
      }),
      ["stone"],
      "hit drop should record discovered item"
    );

    const blockedState = makeDropTestState();
    const blockedOwnerId = blockedState?.pawns?.[0]?.id;
    assert.ok(Number.isFinite(blockedOwnerId), "blocked test owner missing");

    const blockedInv = Inventory.create(1, 1);
    Inventory.init(blockedInv);
    blockedState.ownerInventories[blockedOwnerId] = blockedInv;
    Inventory.addNewItem(blockedState, blockedInv, {
      kind: "stone",
      width: 1,
      height: 1,
      quantity: 999,
      gridX: 0,
      gridY: 0,
    });

    const blockedRes = handleSpawnFromDropTable(
      blockedState,
      {
        op: "SpawnFromDropTable",
        tableKey,
        target: { ownerId: blockedOwnerId },
      },
      {
        kind: "game",
        state: blockedState,
        source: { defId: "tile_levee", col: 0, tags: [] },
        pawnId: blockedOwnerId,
        ownerId: blockedOwnerId,
        tSec: 0,
      }
    );
    assert.equal(blockedRes, false, "blocked drop returns false when no event meta");
    assert.deepEqual(
      getDroppedItemKindsForPool(blockedState, {
        tableKey,
        tileDefId: "tile_levee",
      }),
      ["stone"],
      "blocked drop should still record discovered item"
    );

    const missState = makeDropTestState();
    const missOwnerId = missState?.pawns?.[0]?.id;
    assert.ok(Number.isFinite(missOwnerId), "miss test owner missing");

    const missRes = handleSpawnFromDropTable(
      missState,
      {
        op: "SpawnFromDropTable",
        tableKey,
        target: { ownerId: missOwnerId },
      },
      {
        kind: "game",
        state: missState,
        source: { defId: "tile_hinterland", col: 0, tags: [] },
        pawnId: missOwnerId,
        ownerId: missOwnerId,
        tSec: 0,
      }
    );
    assert.equal(missRes, true, "resolved miss should return true");
    assert.deepEqual(
      getDroppedItemKindsForPool(missState, {
        tableKey,
        tileDefId: "tile_hinterland",
      }),
      [],
      "miss outcome should not record discovered items"
    );

    const persistentState = makeDropTestState();
    const persistentOwnerId = persistentState?.pawns?.[0]?.id;
    assert.ok(Number.isFinite(persistentOwnerId), "persistent test owner missing");

    const timeline = createTimelineFromInitialState(persistentState);

    const floodplainsRes = handleSpawnFromDropTable(
      persistentState,
      {
        op: "SpawnFromDropTable",
        tableKey,
        target: { ownerId: persistentOwnerId },
      },
      {
        kind: "game",
        state: persistentState,
        source: { defId: "tile_floodplains", col: 0, tags: [] },
        pawnId: persistentOwnerId,
        ownerId: persistentOwnerId,
        tSec: 9,
      }
    );
    assert.equal(floodplainsRes, true, "floodplains drop should resolve");

    const wetlandsRes = handleSpawnFromDropTable(
      persistentState,
      {
        op: "SpawnFromDropTable",
        tableKey,
        target: { ownerId: persistentOwnerId },
      },
      {
        kind: "game",
        state: persistentState,
        source: { defId: "tile_wetlands", col: 0, tags: [] },
        pawnId: persistentOwnerId,
        ownerId: persistentOwnerId,
        tSec: 10,
      }
    );
    assert.equal(wetlandsRes, true, "wetlands drop should resolve");

    persistentState.tSec = 10;
    persistentState.simStepIndex = 10 * 60;
    maintainCheckpoints(timeline, persistentState);

    const beforeEdit = rebuildStateAtSecond(timeline, 0);
    assertOk(beforeEdit, "persistent memory rebuild before edit");
    assert.deepEqual(
      getDroppedItemKindsForPool(beforeEdit.state, {
        tableKey,
        tileDefId: "tile_floodplains",
      }),
      ["stone"],
      "floodplains memory should be present before branch edit"
    );
    assert.deepEqual(
      getDroppedItemKindsForPool(beforeEdit.state, {
        tableKey,
        tileDefId: "tile_wetlands",
      }),
      ["straw"],
      "wetlands memory should be present before branch edit"
    );

    const replaceRes = replaceActionsAtSecond(
      timeline,
      5,
      [
        {
          kind: ActionKinds.DEBUG_SET_CAP,
          payload: { enabled: true, cap: 250, points: 250 },
          apCost: 0,
        },
      ],
      { truncateFuture: true }
    );
    assertOk(replaceRes, "branch edit replaceActionsAtSecond");
    timeline.historyEndSec = 5;
    timeline.cursorSec = 5;

    const afterEdit = rebuildStateAtSecond(timeline, 0);
    assertOk(afterEdit, "persistent memory rebuild after edit");
    assert.deepEqual(
      getDroppedItemKindsForPool(afterEdit.state, {
        tableKey,
        tileDefId: "tile_floodplains",
      }),
      ["stone"],
      "floodplains memory should persist across branch edits"
    );
    assert.deepEqual(
      getDroppedItemKindsForPool(afterEdit.state, {
        tableKey,
        tileDefId: "tile_wetlands",
      }),
      ["straw"],
      "wetlands memory should persist across branch edits"
    );

    const cacheState = makeDropTestState();
    const cacheTimeline = createTimelineFromInitialState(cacheState);
    const cacheController = createTimeGraphController({
      getTimeline: () => cacheTimeline,
      getCursorState: () => cacheState,
      metric: GRAPH_METRICS.gold,
    });
    cacheController.setActive(true);
    cacheController.ensureCache();

    const forecastSec = 5;
    const forecastBefore = cacheController.getStateAt(forecastSec);
    assert.ok(forecastBefore, "forecast preview before knowledge change should resolve");
    assert.deepEqual(
      getDroppedItemKindsForPool(forecastBefore, {
        tableKey,
        tileDefId: "tile_floodplains",
      }),
      [],
      "forecast preview should start empty before discovered drops"
    );

    rememberDroppedItemKind(cacheState, {
      tableKey,
      tileDefId: "tile_floodplains",
      itemKind: "stone",
    });
    cacheState.tSec = 0;
    cacheState.simStepIndex = 0;
    maintainCheckpoints(cacheTimeline, cacheState);

    const forecastAfter = cacheController.getStateAt(forecastSec);
    assert.ok(forecastAfter, "forecast preview after knowledge change should resolve");
    assert.deepEqual(
      getDroppedItemKindsForPool(forecastAfter, {
        tableKey,
        tileDefId: "tile_floodplains",
      }),
      ["stone"],
      "forecast cache should invalidate when persistent knowledge mutates"
    );

    const seekRunner = createSimRunner({ setupId: "devGym01" });
    assertOk(seekRunner.init(), "seek runner init");
    const seekTimeline = seekRunner.getTimeline();
    const learnedSeekState = deserializeGameState(
      serializeGameState(seekRunner.getState())
    );
    rememberDroppedItemKind(learnedSeekState, {
      tableKey,
      tileDefId: "tile_floodplains",
      itemKind: "stone",
    });
    learnedSeekState.tSec = 1;
    learnedSeekState.simStepIndex = 60;
    assertOk(
      seedMemoStateDataAtSecond(
        seekTimeline,
        1,
        serializeGameState(learnedSeekState)
      ),
      "seed memo with learned drop memory"
    );
    assertOk(seekRunner.commitCursorSecond(1), "seek to learned second");
    assertOk(
      seekRunner.commitCursorSecond(0),
      "rewind without extra action"
    );
    assert.deepEqual(
      getDroppedItemKindsForPool(seekRunner.getTimeline(), {
        tableKey,
        tileDefId: "tile_floodplains",
      }),
      ["stone"],
      "seek/rewind should keep learned drop memory without extra actions"
    );

    const projectionLearnState = createInitialState({
      rngSeed: 123,
      board: {
        cols: 1,
        tiles: ["tile_floodplains"],
      },
      hub: {
        cols: 1,
        structures: [],
      },
      pawns: [{ name: "Projection Learner", role: "leader", envCol: 0 }],
    });
    const projectionTimeline = createTimelineFromInitialState(projectionLearnState);
    const projectionCache = createProjectionCache();
    assert.deepEqual(
      getDroppedItemKindsForPool(projectionTimeline, {
        tableKey: "forageDrops",
        tileDefId: "tile_floodplains",
      }),
      [],
      "projection learning should start with no known drops"
    );
    assertOk(
      projectionCache.ensureForecastWindow(projectionTimeline, 5, undefined, 1),
      "projection forecast window build"
    );
    assert.ok(
      getDroppedItemKindsForPool(projectionTimeline, {
        tableKey: "forageDrops",
        tileDefId: "tile_floodplains",
      }).length > 0,
      "forecast compute should persist learned drops without commit"
    );

    withMockLocalStorage(() => {
      const previewRunner = createSimRunner({ setupId: "devGym01" });
      assertOk(previewRunner.init(), "preview runner init");
      const previewState = deserializeGameState(
        serializeGameState(previewRunner.getState())
      );
      rememberDroppedItemKind(previewState, {
        tableKey,
        tileDefId: "tile_wetlands",
        itemKind: "straw",
      });
      previewState.tSec = 12;
      previewState.simStepIndex = 12 * 60;
      previewRunner.setPreviewState(previewState);

      assert.deepEqual(
        getDroppedItemKindsForPool(previewRunner.getTimeline(), {
          tableKey,
          tileDefId: "tile_wetlands",
        }),
        ["straw"],
        "setPreviewState should persist learned drop memory without commit"
      );

      assertOk(previewRunner.saveToSlot(1), "save after preview learning");
      assertOk(previewRunner.loadFromSlot(1), "load after preview learning");
      assert.deepEqual(
        getDroppedItemKindsForPool(previewRunner.getState(), {
          tableKey,
          tileDefId: "tile_wetlands",
        }),
        ["straw"],
        "save/load should retain preview-learned drop memory"
      );
    });
  });
}

function runTimegraphEditPolicyChecks() {
  const moteGraphState = itemDefs?.moteOfEternity?.baseSystemState?.timegraph;
  assert.ok(moteGraphState, "moteOfEternity timegraph state should exist");

  const normalized = normalizeTimegraphPolicyState(moteGraphState);
  assert.ok(normalized, "timegraph policy normalization should succeed");
  assert.equal(
    normalized.subjectId,
    "systems",
    "mote policy should target systems subject"
  );

  const absRange = getAbsoluteEditableRangeFromTimegraphState(moteGraphState, {
    itemId: 123,
    itemKind: "moteOfEternity",
  });
  assert.deepEqual(
    absRange,
    {
      itemId: 123,
      itemKind: "moteOfEternity",
      minSec: 0,
      maxSec: 240,
    },
    "mote absolute editable range should normalize deterministically"
  );

  const mergedRanges = mergeSecRanges([
    { minSec: 20, maxSec: 30 },
    { minSec: 0, maxSec: 10 },
    { minSec: 10, maxSec: 20 },
    { minSec: 28, maxSec: 35 },
  ]);
  assert.deepEqual(
    mergedRanges,
    [{ minSec: 0, maxSec: 35 }],
    "range merge should be deterministic and contiguous"
  );

  const historyZones = computeHistoryZoneSegments({
    minSec: 0,
    maxSec: 240,
    historyEndSec: 155,
    baseMinEditableSec: 150,
    extraEditableRanges: [{ minSec: 0, maxSec: 240 }],
  });
  assert.deepEqual(
    historyZones,
    [{ kind: "editableHistory", startSec: 0, endSec: 155 }],
    "absolute editable range should paint full realized window history editable"
  );

  const commitAllowed = computeScrollCommitDecision({
    scrollState: {
      editable: true,
      editableRangeMode: "absolute",
      editableRangeStartSec: 0,
      editableRangeEndSec: 240,
    },
    scrubSec: 120,
    historyEndSec: 155,
    minEditableSec: 150,
  });
  assert.deepEqual(
    commitAllowed,
    { allow: true },
    "commit should be allowed within absolute editable range"
  );

  const commitForecast = computeScrollCommitDecision({
    scrollState: {
      editable: true,
      editableRangeMode: "absolute",
      editableRangeStartSec: 0,
      editableRangeEndSec: 240,
    },
    scrubSec: 156,
    historyEndSec: 155,
    minEditableSec: 150,
  });
  assert.equal(
    commitForecast?.allow,
    false,
    "forecast commits should remain blocked"
  );

  const rollingWindow = computeScrollWindowSpec({
    scrollState: {
      windowMode: "rollingEditable",
      historyWindowSec: 120,
      editable: true,
    },
    historyEndSec: 200,
    cursorSec: 200,
    minEditableSec: 195,
  });
  assert.deepEqual(
    rollingWindow,
    {
      minSec: 195,
      maxSec: 200,
      scrubSec: 200,
    },
    "rollingEditable window mode should preserve prior behavior"
  );

  const runner = createSimRunner({ setupId: "devGym01" });
  assertOk(runner.init(), "edit policy runner init");
  runner.setPaused(false);
  for (let i = 0; i < 20 * 60; i += 1) {
    runner.update(1 / 60);
  }

  const state = runner.getCursorState();
  const leaderId = state?.pawns?.[0]?.id;
  assert.ok(Number.isFinite(leaderId), "expected leader for edit policy checks");
  const leaderInv = state?.ownerInventories?.[leaderId];
  assert.ok(leaderInv, "expected leader inventory for edit policy checks");

  const statusBefore = runner.getEditWindowStatusAtSecond(0);
  assert.equal(
    statusBefore?.ok,
    false,
    "without grants, deep history should be outside base editable window"
  );

  const added = Inventory.addNewItem(state, leaderInv, {
    kind: "moteOfEternity",
    quantity: 1,
  });
  assert.ok(added, "failed to add mote item for policy check");

  const statusAfter = runner.getEditWindowStatusAtSecond(0);
  assert.equal(
    statusAfter?.ok,
    true,
    "absolute editable grant should unlock deep history second"
  );
  assert.equal(
    statusAfter?.editableByItemGrant,
    true,
    "absolute editable grant source should be reported"
  );
}

function run() {
  runScenarioSkillProgressionOverrideChecks();
  runLeaderInventorySectionCapabilityChecks();
  runEnvDeckDrawFeedChecks();
  runPersistentDropMemoryChecks();
  runTimegraphEditPolicyChecks();

  const runner = createSimRunner({ setupId: "devGym01" });
  runner.init();
  assertOk(runner.commitCursorSecond(0), "pause at t=0");

  // Avoid AP-gating noise in this correctness regression test.
  assertOk(
    runner.dispatchAction(ActionKinds.DEBUG_SET_CAP, {
      enabled: true,
      cap: 9999,
      points: 9999,
    }),
    "debug cap setup"
  );

  const timeline = runner.getTimeline();
  const planner = runner.getActionPlanner();
  const cursorState = runner.getCursorState();
  assert.ok(cursorState?.paused, "runner should be paused for planner edits");

  const controller = createTimeGraphController({
    getTimeline: () => runner.getTimeline(),
    getCursorState: () => runner.getCursorState(),
    metric: GRAPH_METRICS.ap,
  });
  controller.setActive(true);
  controller.ensureCache();

  const pawn = cursorState.pawns?.[0];
  assert.ok(pawn?.id != null, "expected at least one pawn");

  const firstEnvCol = firstWalkableEnvCol(cursorState);
  assert.ok(Number.isFinite(firstEnvCol), "expected a walkable env column");

  assertOk(
    planner.setPawnMoveIntent({
      pawnId: pawn.id,
      toEnvCol: firstEnvCol,
    }),
    "first pawn move intent"
  );
  assert.equal(runner.getLastPlannerCommitError(), null, "unexpected planner commit error (first move)");
  controller.handleInvalidate("test:firstPawnMove");

  const stateDataAfterFirstMove = getStateDataAtSecond(timeline, 0);
  assertOk(stateDataAfterFirstMove, "stateData@0 after first move");
  assertPawnAt(
    deserializeGameState(stateDataAfterFirstMove.stateData),
    pawn.id,
    firstEnvCol,
    "first move @0"
  );
  assertControllerParity(controller, timeline, 0, "first move");
  assertControllerParity(controller, timeline, 1, "first move");

  const secondEnvCol = firstWalkableEnvCol(cursorState, {
    exclude: new Set([firstEnvCol]),
  });
  assert.ok(Number.isFinite(secondEnvCol), "expected a second walkable env column");

  assertOk(
    planner.setPawnMoveIntent({
      pawnId: pawn.id,
      toEnvCol: secondEnvCol,
    }),
    "second pawn move intent"
  );
  assert.equal(runner.getLastPlannerCommitError(), null, "unexpected planner commit error (second move)");
  controller.handleInvalidate("test:secondPawnMove");

  const stateDataAfterSecondMove = getStateDataAtSecond(timeline, 0);
  assertOk(stateDataAfterSecondMove, "stateData@0 after second move");
  assertPawnAt(
    deserializeGameState(stateDataAfterSecondMove.stateData),
    pawn.id,
    secondEnvCol,
    "second move @0"
  );
  assertControllerParity(controller, timeline, 0, "second move");
  assertControllerParity(controller, timeline, 1, "second move");

  const farmCol = firstFarmableEnvCol(cursorState);
  assert.ok(Number.isFinite(farmCol), "expected a farmable tile");
  const cropId = Object.keys(cropDefs)[0] ?? null;
  assert.ok(cropId, "expected at least one crop def");

  assertOk(
    planner.setTileCropSelectionIntent({
      envCol: farmCol,
      cropId,
    }),
    "tile crop selection intent"
  );
  assert.equal(runner.getLastPlannerCommitError(), null, "unexpected planner commit error (crop select)");
  controller.handleInvalidate("test:cropSelect");

  const stateDataAfterCropSelect = getStateDataAtSecond(timeline, 0);
  assertOk(stateDataAfterCropSelect, "stateData@0 after crop select");
  const cropStateAtSec0 = deserializeGameState(stateDataAfterCropSelect.stateData);
  const cropAtSec0 =
    cropStateAtSec0?.board?.occ?.tile?.[farmCol]?.systemState?.growth
      ?.selectedCropId ?? null;
  assert.equal(cropAtSec0, cropId, "crop selection should be present at t=0");
  assertControllerParity(controller, timeline, 0, "crop select");
  assertControllerParity(controller, timeline, 1, "crop select");

  const tile = cursorState?.board?.occ?.tile?.[farmCol];
  const tagId = Array.isArray(tile?.tags) && tile.tags.length ? tile.tags[0] : null;
  assert.ok(tagId, "expected a tile tag to toggle");
  const currentDisabled = tile?.tagStates?.[tagId]?.disabled === true;
  assertOk(
    planner.setTileTagToggleIntent({
      envCol: farmCol,
      tagId,
      disabled: !currentDisabled,
    }),
    "tile tag toggle intent"
  );
  assert.equal(runner.getLastPlannerCommitError(), null, "unexpected planner commit error (tile tag toggle)");
  controller.handleInvalidate("test:tagToggle");

  const stateDataAfterTagToggle = getStateDataAtSecond(timeline, 0);
  assertOk(stateDataAfterTagToggle, "stateData@0 after tile tag toggle");
  const tagStateAtSec0 = deserializeGameState(stateDataAfterTagToggle.stateData);
  const disabledAtSec0 =
    tagStateAtSec0?.board?.occ?.tile?.[farmCol]?.tagStates?.[tagId]
      ?.disabled === true;
  assert.equal(
    disabledAtSec0,
    !currentDisabled,
    "tile tag toggle should be present at t=0"
  );
  assertControllerParity(controller, timeline, 0, "tag toggle");
  assertControllerParity(controller, timeline, 1, "tag toggle");

  console.log("[test] Timeline scrub regression checks passed");
}

run();
