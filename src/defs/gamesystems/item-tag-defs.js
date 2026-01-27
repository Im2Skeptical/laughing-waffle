// item-tag-defs.js
// Item tag registry (data only).

export const itemTagDefs = {
  rotatable: {
    id: "rotatable",
    kind: "itemTag",
    ui: { name: "Rotatable", description: "Can decay into rot over time." },
    systems: ["freshness"],
    passives: [
      {
        id: "rotTick",
        timing: { cadenceSec: 1 },
        effect: [
          {
            op: "AddToSystemState",
            target: { ref: "self" },
            system: "freshness",
            key: "ageSec",
            amount: 1,
          },
          {
            op: "CheckItemRot",
            system: "freshness",
            ageKey: "ageSec",
            rotChancePerSec: 0.0057,
            rotKind: "rot",
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
};