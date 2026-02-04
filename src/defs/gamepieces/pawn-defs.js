// pawn-defs.js
// Pawn registry (data only).

export const pawnDefs = {
  default: {
    id: "default",
    kind: "pawn",
    name: "Default Pawn",
    buildableStructureIds: ["granary", "storehouse"],
    systems: ["stamina", "hunger"],
    passives: [
      {
        id: "hungerDecay",
        timing: { cadenceSec: 5 },
        effect: [
          {
            op: "AddToSystemState",
            target: { ref: "pawn" },
            system: "hunger",
            key: "cur",
            amount: -1,
          },
          {
            op: "ClampSystemState",
            target: { ref: "pawn" },
            system: "hunger",
            key: "cur",
            min: 0,
            maxKey: "max",
          },
        ],
      },
    ],
    intents: [
      {
        id: "eat",
        verb: "eat",
        requires: { hungerAtMost: 50 },
        cost: {
          charges: [
            {
              kind: "item",
              target: { ref: "pawnInv" },
              itemId: "barley",
              amount: { const: 1 },
            },
          ],
        },
        effect: [
          {
            op: "AddToSystemState",
            target: { ref: "pawn" },
            system: "hunger",
            key: "cur",
            amount: 20,
          },
          {
            op: "ClampSystemState",
            target: { ref: "pawn" },
            system: "hunger",
            key: "cur",
            min: 0,
            maxKey: "max",
          },
          /*
          {
            op: "AddToSystemState",
            target: { ref: "pawn" },
            system: "stamina",
            key: "cur",
            amount: 20,
          },
          {
            op: "ClampSystemState",
            target: { ref: "pawn" },
            system: "stamina",
            key: "cur",
            min: 0,
            maxKey: "max",
          },
          */
        ],
      },
    ],
  },
};
