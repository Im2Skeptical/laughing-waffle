// hub-tag-defs.js
// Hub tag registry (data only).

export const hubTagDefs = {
  build: {
    id: "build",
    kind: "hubTag",
    ui: { name: "Build", description: "Construct this building." },
    systems: ["build"],
    passives: [
      {
        id: "buildAdvance",
        timing: { cadenceSec: 1 },
        effect: {
          op: "AdvanceWorkProcess",
          system: "build",
          queueKey: "processes",
          processType: "build",
          mode: "work",
          workersFrom: "hubAnchor",
          workerCost: { system: "stamina", key: "cur", amount: 1, clampMin: 0 },
        },
      },
    ],
    intents: [],
  },
  canRest: {
    id: "canRest",
    kind: "hubTag",
    ui: { name: "Rest", description: "Rest here to regain stamina." },
    systems: [],
    passives: [],
    intents: [
      {
        id: "hubRest",
        verb: "Rest",
        requires: {},
        effect: [
          {
            op: "AddToSystemState",
            target: { ref: "pawn" },
            system: "stamina",
            key: "cur",
            amount: 2,
          },
          {
            op: "ClampSystemState",
            target: { ref: "pawn" },
            system: "stamina",
            key: "cur",
            min: 0,
            maxKey: "max",
          },
        ],
      },
    ],
  },

  canCook: {
    id: "canCook",
    kind: "hubTag",
    ui: { name: "Cook", description: "Cook food here." },
    systems: ["fireplace"],
    passives: [],
    intents: [
      {
        id: "roastBarley_work",
        verb: "Roast Barley",
        requires: {
          processSystem: "fireplace",
          hasProcessType: "roastBarley",
        },
        cost: {
          charges: [
            {
              kind: "system",
              target: { ref: "pawn" },
              system: "stamina",
              key: "cur",
              amount: { const: 1 },
              clampMin: 0,
            },
          ],
        },
        effect: {
          op: "AdvanceWorkProcess",
          system: "fireplace",
          queueKey: "processes",
          processType: "roastBarley",
          amount: 1,
        },
      },
      {
        id: "roastBarley_start",
        verb: "Start Roast Barley",
        requires: {
          processSystem: "fireplace",
          noProcessType: "roastBarley",
        },
        cost: {
          charges: [
            {
              kind: "system",
              target: { ref: "pawn" },
              system: "stamina",
              key: "cur",
              amount: { const: 1 },
              clampMin: 0,
            },
          ],
        },
        effect: {
          op: "CreateWorkProcess",
          system: "fireplace",
          queueKey: "processes",
          processType: "roastBarley",
          mode: "work",
          durationSec: 1,
          uniqueType: true,
        },
      },
    ],
  },

  canCraft: {
    id: "canCraft",
    kind: "hubTag",
    ui: { name: "Craft", description: "Craft items here." },
    systems: ["workspace"],
    passives: [],
    intents: [
      // Work first, but gated by hasProcessType, so it won't burn stamina unless weaving exists.
      {
        id: "weaveBasket_work",
        verb: "Weave Basket",
        requires: {
          processSystem: "workspace",
          hasProcessType: "weaveBasket",
        },
        cost: {
          charges: [
            {
              kind: "system",
              target: { ref: "pawn" },
              system: "stamina",
              key: "cur",
              amount: { const: 1 },
              clampMin: 0,
            },
          ],
        },
        effect: {
          op: "AdvanceWorkProcess",
          system: "workspace",
          queueKey: "processes",
          processType: "weaveBasket",
          // IMPORTANT: explicit per-pawn contribution
          amount: 1,
        },
      },

      // Start weaving only if no active weaveBasket exists.
      {
        id: "weaveBasket_start",
        verb: "Start Weave Basket",
        requires: {
          processSystem: "workspace",
          noProcessType: "weaveBasket",
        },
        cost: {
          charges: [
            {
              kind: "system",
              target: { ref: "pawn" },
              system: "stamina",
              key: "cur",
              amount: { const: 1 },
              clampMin: 0,
            },
          ],
        },
        effect: {
          op: "CreateWorkProcess",
          system: "workspace",
          queueKey: "processes",
          processType: "weaveBasket",
          mode: "work",
          durationSec: 5,
          uniqueType: true,
        },
      },
    ],
  },

  canDeposit: {
    id: "canDeposit",
    kind: "hubTag",
    ui: { name: "Deposit", description: "Deposit grain into the granary." },
    systems: ["granaryStore"],
    passives: [
      {
        id: "depositAdvance",
        timing: { cadenceSec: 1 },
        requires: { hasPawn: true },
        effect: {
          op: "AdvanceWorkProcess",
          system: "granaryStore",
          queueKey: "processes",
          processType: "depositGrain",
          mode: "time",
          deltaSec: 9999,
        },
      },
    ],
    intents: [],
    affordances: ["deposit"],
  },
};
