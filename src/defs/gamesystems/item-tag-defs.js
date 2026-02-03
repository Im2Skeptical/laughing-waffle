// item-tag-defs.js
// Item tag registry (data only).

export const itemTagDefs = {
  perishable: {
    id: "perishable",
    kind: "itemTag",
    ui: { name: "Perishable", description: "Can decay into rot over time." },
    systems: ["perishability"],
    passives: [
      {
        id: "rotTick",
        timing: { cadenceSec: 1 },
        effect: [
          {
            op: "ExpireItemChance",
            chanceFromDefKey: "rotChancePerSec",
            targetKind: "rot",
          },
        ],
      },
    ],
    intents: [],
  },
  rot: {
    id: "rot",
    kind: "itemTag",
    ui: { name: "Rot", description: "Fully rotted material." },
    systems: [],
    passives: [],
    intents: [],
  },
  rotted: {
    id: "rotted",
    kind: "itemTag",
    ui: { name: "Rotted", description: "Fully rotted material." },
    systems: [],
    passives: [],
    intents: [],
  },
  edible: {
    id: "edible",
    kind: "itemTag",
    ui: { name: "Edible", description: "Can be eaten." },
    systems: [],
    passives: [],
    intents: [],
  },
  currency: {
    id: "currency",
    kind: "itemTag",
    ui: { name: "Currency", description: "Uses currency transfer pricing." },
    systems: [],
    passives: [],
    intents: [],
  },
  crop: {
    id: "crop",
    kind: "itemTag",
    ui: { name: "Crop", description: "Agricultural good." },
    systems: [],
    passives: [],
    intents: [],
  },
  grain: {
    id: "grain",
    kind: "itemTag",
    ui: { name: "Grain", description: "Stored in granaries for prestige." },
    systems: [],
    passives: [],
    intents: [],
  },
};
