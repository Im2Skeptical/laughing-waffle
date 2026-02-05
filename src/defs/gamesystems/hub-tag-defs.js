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
        id: "roastBarley",
        verb: "Roast Barley",
        requires: {},
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
            // Consume 1 barley
            {
              kind: "item",
              target: { ref: "pawnInv" },
              itemId: "barley",
              amount: { const: 1 },
            },
            // Require 1 stone (NOT consumed)
            {
              kind: "requireItem",
              target: { ref: "pawnInv" },
              itemId: "stone",
              amount: { const: 1 },
            },
          ],
        },
        effect: {
          op: "SpawnItem",
          itemKind: "roastedBarley",
          amount: 1,
          perOwner: true,
          target: { kind: "tileOccupants" },
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
            // Consume reeds up front
            {
              kind: "item",
              target: { ref: "pawnInv" },
              itemId: "reeds",
              amount: { const: 3 },
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
          outputs: [{ kind: "basket", qty: 1 }],
        },
      },
    ],
  },

  canDeposit: {
    id: "canDeposit",
    kind: "hubTag",
    ui: { name: "Deposit", description: "Deposit grain into the granary." },
    systems: ["granaryStore"],
    passives: [],
    intents: [],
    affordances: ["deposit"],
  },
};
