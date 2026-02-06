// item-tag-defs.js
// Item tag registry (data only).

import {
  PERISHABLE_ROT_CHANCE_PER_SEC,
  PERISHABILITY_ROT_MULTIPLIER_BY_TIER,
} from "../gamesettings/gamerules-defs.js";

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
            chance: PERISHABLE_ROT_CHANCE_PER_SEC,
            tierSystemId: "perishability",
            tierMultiplierByTier: PERISHABILITY_ROT_MULTIPLIER_BY_TIER,
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
    systems: ["nourishment"],
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
