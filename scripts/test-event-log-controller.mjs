import assert from "node:assert/strict";

import { createEventLogController } from "../src/controllers/eventmanagers/event-log-controller.js";
import {
  LEADER_FAITH_HUNGER_DECAY_THRESHOLD,
  PAWN_AI_HUNGER_WARNING,
} from "../src/defs/gamesettings/gamerules-defs.js";

function createControllerForState(stateRef) {
  return createEventLogController({
    getState: () => stateRef.current,
  });
}

function runPinnedHungryAppearsAndUnpinsChecks() {
  const stateRef = {
    current: {
      tSec: 100,
      pawns: [
        {
          id: 11,
          name: "Ayla",
          role: "follower",
          systemState: {
            hunger: { cur: PAWN_AI_HUNGER_WARNING },
          },
        },
      ],
      gameEventFeed: [],
    },
  };
  const controller = createControllerForState(stateRef);

  const rowsPinned = controller.getVisibleRows({ maxRows: 8 });
  const hungryPinned = rowsPinned.find((row) => row.id === "pin:hungry:11");
  assert.ok(hungryPinned, "[eventLog] hungry pin should appear at warning threshold");
  assert.equal(hungryPinned?.pinned, true, "[eventLog] hungry pin must be marked pinned");
  assert.equal(hungryPinned?.pinKind, "hungry", "[eventLog] hungry pin kind mismatch");

  stateRef.current.pawns[0].systemState.hunger.cur = PAWN_AI_HUNGER_WARNING + 1;
  const rowsRecovered = controller.getVisibleRows({ maxRows: 8 });
  assert.equal(
    rowsRecovered.some((row) => row.id === "pin:hungry:11"),
    false,
    "[eventLog] hungry pin should clear once hunger recovers above warning"
  );
}

function runFaithRiskLeaderOnlyChecks() {
  const stateRef = {
    current: {
      tSec: 100,
      pawns: [
        {
          id: 1,
          name: "Leader One",
          role: "leader",
          systemState: {
            hunger: { cur: LEADER_FAITH_HUNGER_DECAY_THRESHOLD },
          },
        },
        {
          id: 2,
          name: "Follower Two",
          role: "follower",
          systemState: {
            hunger: { cur: LEADER_FAITH_HUNGER_DECAY_THRESHOLD },
          },
        },
      ],
      gameEventFeed: [],
    },
  };
  const controller = createControllerForState(stateRef);
  const rows = controller.getVisibleRows({ maxRows: 10 });

  assert.ok(
    rows.some((row) => row.id === "pin:faithRisk:1"),
    "[eventLog] leader at decay threshold should get faith-risk pin"
  );
  assert.equal(
    rows.some((row) => row.id === "pin:faithRisk:2"),
    false,
    "[eventLog] followers should not get faith-risk pins"
  );
}

function runPinnedOrderingChecks() {
  const stateRef = {
    current: {
      tSec: 200,
      pawns: [
        {
          id: 5,
          name: "Leader Five",
          role: "leader",
          skillPoints: 2,
          unlockedSkillNodeIds: [],
          systemState: {
            hunger: { cur: LEADER_FAITH_HUNGER_DECAY_THRESHOLD },
          },
        },
        {
          id: 2,
          name: "Follower Two",
          role: "follower",
          systemState: {
            hunger: { cur: PAWN_AI_HUNGER_WARNING },
          },
        },
      ],
      gameEventFeed: [],
    },
  };
  const controller = createControllerForState(stateRef);
  const rows = controller.getVisibleRows({ maxRows: 10 });
  const firstThreeIds = rows.slice(0, 3).map((row) => row.id);
  const firstFourIds = rows.slice(0, 4).map((row) => row.id);

  assert.deepEqual(
    firstThreeIds,
    ["pin:hungry:2", "pin:hungry:5", "pin:faithRisk:5"],
    "[eventLog] pinned ordering should be hungry first by pawn id, then faith-risk by pawn id"
  );
  assert.deepEqual(
    firstFourIds,
    ["pin:hungry:2", "pin:hungry:5", "pin:faithRisk:5", "pin:skillPoints:5"],
    "[eventLog] skill-point pins should follow hunger and faith-risk pins"
  );
}

function runPinnedCapacityPrecedenceChecks() {
  const stateRef = {
    current: {
      tSec: 300,
      pawns: [
        {
          id: 9,
          name: "Nine",
          role: "follower",
          systemState: {
            hunger: { cur: PAWN_AI_HUNGER_WARNING },
          },
        },
      ],
      gameEventFeed: [
        {
          id: 77,
          tSec: 299,
          type: "event",
          text: "Recent event",
          data: {},
        },
      ],
    },
  };
  const controller = createControllerForState(stateRef);

  const oneSlotRows = controller.getVisibleRows({
    maxRows: 1,
    holdSec: 5,
    fadeSec: 10,
  });
  assert.equal(oneSlotRows.length, 1, "[eventLog] maxRows=1 should return one row");
  assert.equal(
    oneSlotRows[0]?.id,
    "pin:hungry:9",
    "[eventLog] pinned row should take precedence over feed when capped"
  );

  const twoSlotRows = controller.getVisibleRows({
    maxRows: 2,
    holdSec: 5,
    fadeSec: 10,
  });
  assert.deepEqual(
    twoSlotRows.map((row) => row.id),
    ["pin:hungry:9", 77],
    "[eventLog] feed rows should fill remaining capacity after pinned rows"
  );
}

function runSkillPointPinChecks() {
  const stateRef = {
    current: {
      tSec: 400,
      pawns: [
        {
          id: 3,
          name: "Leader Three",
          role: "leader",
          skillPoints: 2,
          unlockedSkillNodeIds: [],
        },
        {
          id: 4,
          name: "Follower Four",
          role: "follower",
          skillPoints: 2,
          unlockedSkillNodeIds: [],
        },
      ],
      gameEventFeed: [],
    },
  };
  const controller = createControllerForState(stateRef);

  const rowsWithPoints = controller.getVisibleRows({ maxRows: 10 });
  const skillPinned = rowsWithPoints.find((row) => row.id === "pin:skillPoints:3");
  assert.ok(skillPinned, "[eventLog] leaders with spendable skill points should get a pinned row");
  assert.equal(
    skillPinned?.type,
    "skillPointsAvailable",
    "[eventLog] skill-point pin should use the skills event type"
  );
  assert.equal(
    skillPinned?.data?.openSkillTree,
    true,
    "[eventLog] skill-point pin should request skill-tree opening on click"
  );
  assert.equal(
    rowsWithPoints.some((row) => row.id === "pin:skillPoints:4"),
    false,
    "[eventLog] followers should not get skill-point pins"
  );

  stateRef.current.pawns[0].skillPoints = 0;
  const rowsSpent = controller.getVisibleRows({ maxRows: 10 });
  assert.equal(
    rowsSpent.some((row) => row.id === "pin:skillPoints:3"),
    false,
    "[eventLog] skill-point pin should clear when no points remain"
  );
}

function run() {
  runPinnedHungryAppearsAndUnpinsChecks();
  runFaithRiskLeaderOnlyChecks();
  runPinnedOrderingChecks();
  runPinnedCapacityPrecedenceChecks();
  runSkillPointPinChecks();
  console.log("[test] Event log controller pinned-row checks passed");
}

run();
