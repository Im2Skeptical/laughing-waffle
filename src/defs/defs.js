// defs.js
// Pure definitions: constants, permanents, env cards, items.
// No PIXI, no gameState, no UI.

export const SEASON_DURATION_SEC = 12; // seconds of simulation per season

export const SEASONS = ["spring", "summer", "autumn", "winter"];

export const SEASON_DISPLAY = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
};

// --- Permanents (bottom row) ---

export const permanentDefs = {
  farm: {
    id: "farm",
    name: "Farm",
    color: 0x4caf50,
    baseOutput: { food: 1 },
    tags: ["permanent", "farm"],
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
    tags: ["permanent", "producer", "mine"],
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
        "Consumes rocks from above to generate gold.",
        (inst, def) => `+${def.baseOutput.gold} gold per rock per trigger.`,
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
    tags: ["permanent", "storehouse", "hasInventory"],
    inventory: { cols: 10, rows: 10 },
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

// --- Env card helpers ---

function makeSeasonalBarrenDef(id, displayName, color) {
  return {
    id,
    name: displayName,
    color,
    tags: ["env", "barren"],
    behaviors: [
      {
        kind: "TimedLife",
        props: {
          timerKey: "timer",
          defaultLife: 5,
        },
      },
    ],
    ui: {
      title: displayName,
      lines: [
        "No effect.",
        (inst) =>
          inst.props.timer != null
            ? `Expires in ${inst.props.timer.toFixed(1)}s.`
            : "",
      ],
      meters: [],
    },
  };
}

// --- Environment cards (top row) ---

export const envCardDefs = {
  rock: {
    id: "rock",
    name: "Rock",
    color: 0xaaaaaa,
    tags: ["env", "fuelSource:rock"],
    behaviors: [
      {
        kind: "HasPool",
        props: {
          poolKey: "pool",
          defaultPool: 10,
        },
      },
    ],
    ui: {
      title: "Rock",
      lines: [
        "Acts as fuel for mines.",
        (inst) => `Remaining pool: ${inst.props.pool ?? 0}.`,
      ],
      meters: [{ label: "Pool", prop: "pool" }],
    },
  },

  barren_spring: makeSeasonalBarrenDef(
    "barren_spring",
    "Spring Barren",
    0x66bb6a
  ),
  barren_summer: makeSeasonalBarrenDef(
    "barren_summer",
    "Summer Barren",
    0xffb300
  ),
  barren_autumn: makeSeasonalBarrenDef(
    "barren_autumn",
    "Autumn Barren",
    0xff7043
  ),
  barren_winter: makeSeasonalBarrenDef(
    "barren_winter",
    "Winter Barren",
    0x90a4ae
  ),

  fertile_soil: {
    id: "fertile_soil",
    name: "Fertile Soil",
    color: 0x8bc34a,
    tags: ["env", "fertile"],
    behaviors: [],
    seasonEnd: { op: "SeasonEndRecycleAs", targetDefId: "flood_autumn" },
    ui: {
      title: "Fertile Soil",
      lines: [
        "Rich soil.",
        "Future: boosts farms planted here.",
        "Reverts to flood card at season end.",
      ],
      meters: [],
    },
  },

  flood_autumn: {
    id: "flood_autumn",
    name: "Autumn Flood",
    color: 0x42a5f5,
    tags: ["env", "flood"],
    behaviors: [
      {
        kind: "TimedTransform",
        props: {
          timerKey: "timer",
          defaultTime: 4,
          targetDefId: "fertile_soil",
        },
      },
    ],
    ui: {
      title: "Autumn Flood",
      lines: [
        "Seasonal flooding.",
        (inst) =>
          inst.props.timer != null
            ? `Becomes Fertile Soil in ${inst.props.timer.toFixed(1)}s.`
            : "Becomes Fertile Soil soon.",
      ],
      meters: [],
    },
  },
};

// --- Items (inventory things) ---

export const itemDefs = {
  grain: {
    id: "grain",
    name: "Grain",
    color: 0xdaa520,
    maxStack: 25,
    expirySeasonsRange: [5, 6],
    seasonExpiry: { op: "TransformTo", targetKind: "rot" },
    defaultWidth: 1,
    defaultHeight: 2,
    ui: {
      title: "Grain",
      lines: [
        (item, ctx) => `Item id: ${item.id}`,
        (item, ctx) => `Owner: ${ctx.ownerLabel}`,
        (item) => `Quantity: ${item.quantity}`,
        (item) => `Size: ${item.width}×${item.height}`,
        (item) =>
          item.seasonsToExpire != null
            ? `Seasons to rot: ${item.seasonsToExpire}`
            : "",
      ],
    },
  },

  rot: {
    id: "rot",
    name: "Rot",
    color: 0x6b4f3f,
    maxStack: 999,
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      title: "Rot",
      lines: [
        (item, ctx) => `Item id: ${item.id}`,
        (item, ctx) => `Owner: ${ctx.ownerLabel}`,
        (item) => `Quantity: ${item.quantity}`,
        (item) => `Size: ${item.width}×${item.height}`,
        "Rotting organic matter. No current use.",
      ],
    },
  },
};
