// hub-structures-defs.js
// Definitions for hub structures

export const hubStructureDefs = {
  farm: {
    id: "farm",
    name: "Farm",
    color: 0x4caf50,
    baseOutput: { food: 1 },
    defaultSpan: 3,
    tags: ["hubStructure", "farm"],
    behaviors: [],
    ui: {
      title: "Farm",
      lines: ["Produces food (future).", "Will interact with fertile terrain."],
      meters: [],
    },
  },

  mine: {
    id: "mine",
    name: "Mine",
    color: 0xffc107,
    baseOutput: { gold: 1 },
    tags: ["hubStructure", "producer", "mine"],
    behaviors: [
      {
        kind: "TimedTrigger",
        requiresOccupant: true,
        props: {
          timerKey: "timer",
          periodKey: "timerPeriod",
          defaultPeriod: 5,
          triggerId: "MineFuel",
        },
      },
    ],
    ui: {
      title: "Mine",
      lines: [
        "Generates gold based on mineable tiles across the board.",
        (inst, def) => `+${def.baseOutput.gold} gold per mineable tile per trigger.`,
        (inst, def) => {
          const timed = (def.behaviors || []).find(
            (b) => b.kind === "TimedTrigger"
          );
          const period =
            timed && timed.props && timed.props.defaultPeriod != null
              ? timed.props.defaultPeriod
              : "?";
          return `Trigger period: ${period}s.`;
        },
      ],
      meters: [
        {
          label: "Cycle",
          kind: "timerProgress",
          timerKey: "timer",
          periodKey: "timerPeriod",
        },
      ],
    },
  },

  storehouse: {
    id: "storehouse",
    name: "Storehouse",
    color: 0x90caf9,
    baseOutput: {},
    defaultSpan: 2,
    tags: ["hubStructure", "storehouse", "hasInventory"],
    inventory: { cols: 5, rows: 10 },
    behaviors: [],
    ui: {
      title: "Storehouse",
      lines: [
        "Holds stored grain and goods.",
        "Hover: open inventory (if not pinned).",
        "Click: toggle inventory window.",
      ],
      meters: [],
    },
  },
};


