// hub-tag-defs.js
// Hub tag registry (data only).

export const hubTagDefs = {
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
    systems: [],
    passives: [],
    intents: [
      {
        id: "hubCook",
        verb: "Cook",
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
  canCraft: {
    id: "canCraft",
    kind: "hubTag",
    ui: { name: "Craft", description: "Craft items here." },
    systems: [],
    passives: [],
    intents: [
      {
        id: "hubCraft",
        verb: "Craft",
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
