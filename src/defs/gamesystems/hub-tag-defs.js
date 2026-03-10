// hub-tag-defs.js
// Hub tag registry (data only).

import {
  PERISHABLE_ROT_CHANCE_PER_SEC,
  PERISHABILITY_ROT_MULTIPLIER_BY_TIER,
} from "../gamesettings/gamerules-defs.js";

export const hubTagDefs = {
  distributor: {
    id: "distributor",
    kind: "hubTag",
    ui: {
      name: "Distribute",
      description: "Provides routing endpoints within its distribution range.",
    },
    systems: ["distribution"],
    passives: [],
    intents: [],
  },
  build: {
    id: "build",
    kind: "hubTag",
    ui: {
      name: "Build",
      description: "Construct this building.",
      titleFeedback: {
        mode: "progress",
        holderSystemId: "build",
        variant: "process",
      },
    },
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
    affordances: ["restSpot"],
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
    ui: {
      name: "Cook",
      description: "Cook food here.",
      titleFeedback: {
        mode: "progress",
        holderSystemId: "cook",
        variant: "process",
      },
    },
    systems: ["cook"],
    passives: [],
    intents: [
      {
        id: "cook_work",
        verb: "Cook",
        requires: {
          processSystem: "cook",
          processTypeFromSystemPriorityKey: "recipePriority",
          hasSelectedRecipe: true,
          hasSelectedProcessType: true,
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
          system: "cook",
          queueKey: "processes",
          processTypeFromSystemPriorityKey: "recipePriority",
          amount: 1,
        },
      },
      {
        id: "cook_start",
        verb: "Start Cooking",
        requires: {
          processSystem: "cook",
          processTypeFromSystemPriorityKey: "recipePriority",
          hasSelectedRecipe: true,
          noSelectedProcessType: true,
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
          system: "cook",
          queueKey: "processes",
          processTypeFromSystemPriorityKey: "recipePriority",
          mode: "work",
          completionPolicy: "repeat",
          uniqueType: true,
        },
      },
    ],
  },

  canCraft: {
    id: "canCraft",
    kind: "hubTag",
    ui: {
      name: "Craft",
      description: "Craft items here.",
      titleFeedback: {
        mode: "progress",
        holderSystemId: "craft",
        variant: "process",
      },
    },
    systems: ["craft"],
    passives: [],
    intents: [
      // Work first, but gated by hasProcessType, so it won't burn stamina unless weaving exists.
      {
        id: "craft_work",
        verb: "Craft",
        requires: {
          processSystem: "craft",
          processTypeFromSystemPriorityKey: "recipePriority",
          hasSelectedRecipe: true,
          hasSelectedProcessType: true,
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
          system: "craft",
          queueKey: "processes",
          processTypeFromSystemPriorityKey: "recipePriority",
          // IMPORTANT: explicit per-pawn contribution
          amount: 1,
        },
      },

      // Start weaving only if no active weaveBasket exists.
      {
        id: "craft_start",
        verb: "Start Crafting",
        requires: {
          processSystem: "craft",
          processTypeFromSystemPriorityKey: "recipePriority",
          hasSelectedRecipe: true,
          noSelectedProcessType: true,
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
          system: "craft",
          queueKey: "processes",
          processTypeFromSystemPriorityKey: "recipePriority",
          mode: "work",
          completionPolicy: "repeat",
          uniqueType: true,
        },
      },
    ],
  },

  depositable: {
    id: "depositable",
    kind: "hubTag",
    ui: { name: "Deposit", description: "Deposit items into a storage pool." },
    systems: ["deposit", "storage"],
    passives: [
      {
        id: "poolRotTick",
        timing: { cadenceSec: 1 },
        effect: {
          op: "ExpireStoredPerishables",
          chance: PERISHABLE_ROT_CHANCE_PER_SEC,
          tierMultiplierByTier: PERISHABILITY_ROT_MULTIPLIER_BY_TIER,
          perishableTag: "perishable",
          preserveTag: "canPreserve",
          rotPoolKey: "rotByKindTier",
          rotKind: "rot",
          preserveTierBonusProp: "perishabilityTierBonus",
        },
      },
      {
        id: "depositAdvance",
        timing: { cadenceSec: 1 },
        requires: { hasPawn: true },
        effect: {
          op: "AdvanceWorkProcess",
          system: "deposit",
          queueKey: "processes",
          processType: "depositItems",
          mode: "time",
          deltaSec: 9999,
        },
      },
    ],
    intents: [],
    affordances: ["deposit"],
  },

  communal: {
    id: "communal",
    kind: "hubTag",
    ui: {
      name: "Communal",
      description: "Deposits here award prestige.",
    },
    systems: [],
    passives: [],
    intents: [],
  },

  canPreserve: {
    id: "canPreserve",
    kind: "hubTag",
    ui: {
      name: "Preserve",
      description: "Improves perishability for stored items.",
    },
    systems: [],
    passives: [
      {
        id: "preserveBoost",
        timing: { trigger: "onFirstActive" },
        effect: {
          op: "SetProp",
          target: { ref: "self" },
          prop: "perishabilityTierBonus",
          value: 1,
          min: 0,
        },
      },
    ],
    intents: [],
  },

  canHouse: {
    id: "canHouse",
    kind: "hubTag",
    ui: {
      name: "Housing",
      description: "Provides housing for residents.",

    },
    systems: ["residents", "faith"],
    passives: [],
    intents: [],
  },
};
