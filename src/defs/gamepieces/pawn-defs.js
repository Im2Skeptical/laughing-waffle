// pawn-defs.js
// Pawn registry (data only).

export const pawnDefs = {
  default: {
    id: "default",
    kind: "pawn",
    name: "Default Pawn",
    buildableStructureIds: ["granary", "ritualShrine", "storehouse"],
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
              kind: "tag",
              target: { ref: "pawnInv" },
              tag: "edible",
              amount: { const: 1 },
              allowDistributorPools: true,
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
