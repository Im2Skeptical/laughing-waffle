// env-tags-defs.js
// Env tag registry (data only).

import { ensureTooltipCardUi } from "../tooltip-ui-utils.js";

export const envTagDefs = {
  explore: {
    id: "explore",
    kind: "envTag",
    ui: {
      name: "Explore",
      description: "Survey the area and uncover what is here.",
      titleFeedback: {
        mode: "progress",
        holderSystemId: "build",
        hideSystemRows: true,
        hideProcessWidget: true,
        variant: "process",
      },
    },
    systems: ["build"],
    intents: [
      {
        id: "explore_work",
        verb: "Explore",
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
        effect: [
          {
            op: "CreateWorkProcess",
            system: "build",
            queueKey: "processes",
            processType: "explore",
            mode: "work",
            durationSec: 5,
            uniqueType: true,
            completionEffects: [
              { op: "RevealDiscovery", target: { ref: "self" } },
              { op: "SpawnDropPackage", tableKey: "forageDrops", rollCount: 15 },
              {
                op: "ExposeDiscovery",
                target: {
                  ref: "self",
                  layer: "tile",
                  area: { kind: "adjacent", radius: 1 },
                },
              },
              { op: "RemoveTag", tag: "explore", target: { ref: "self" } },
            ],
          },
          {
            op: "AdvanceWorkProcess",
            system: "build",
            queueKey: "processes",
            processType: "explore",
            mode: "work",
            amount: 1,
          },
        ],
      },
    ],
    passives: [],
  },
  delve: {
    id: "delve",
    kind: "envTag",
    ui: {
      name: "Delve",
      description: "Search the ruins for a way into the hidden hub.",
      titleFeedback: {
        mode: "progress",
        holderSystemId: "build",
        hideSystemRows: true,
        hideProcessWidget: true,
        variant: "process",
      },
    },
    systems: ["build"],
    intents: [
      {
        id: "delve_work",
        verb: "Delve",
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
        effect: [
          {
            op: "CreateWorkProcess",
            system: "build",
            queueKey: "processes",
            processType: "delve",
            mode: "work",
            durationSec: 5,
            uniqueType: true,
            completionEffects: [
              { op: "SetDiscoveryState", key: "hubVisible", value: true },
              { op: "RemoveTag", tag: "delve", target: { ref: "self" } },
            ],
          },
          {
            op: "AdvanceWorkProcess",
            system: "build",
            queueKey: "processes",
            processType: "delve",
            mode: "work",
            amount: 1,
          },
        ],
      },
    ],
    passives: [],
  },
  build: {
    id: "build",
    kind: "envTag",
    ui: {
      name: "Build",
      description: "Construct improvements here.",
      titleFeedback: {
        mode: "progress",
        holderSystemId: "build",
        hideSystemRows: true,
        hideProcessWidget: true,
        variant: "process",
      },
    },
    systems: ["build"],
    intents: [],
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
          workersFrom: "envCol",
        },
      },
    ],
  },
  farmable: {
    id: "farmable",
    kind: "envTag",
    ui: {
      name: "Farm",
      description: "Grow crops.",
      titleFeedback: {
        mode: "progress",
        holderSystemId: "growth",
        hiddenSystemRowIds: ["growth"],
        variant: "farm",
      },
    },
    systems: ["growth", "hydration", "fertility"],
    intents: [
      {
        id: "farmHarvest",
        verb: "harvest",
        repeatByActorWorkUnits: true,
        requires: { hasMaturedPool: true },
        cost: {
          charges: [
            {
              kind: "system",
              target: { ref: "pawn" },
              system: "stamina",
              key: "cur",
              amount: { const: 2 },
              clampMin: 0,
            },
          ],
        },
        effect: {
          op: "TransferUnits",
          system: "growth",
          poolKey: "maturedPool",
          target: { kind: "tileOccupants" },
          defRegistry: "crops",
          defIdFromSystemKey: "selectedCropId",
          amountFromDefKey: "harvestUnitsPerSec",
          perOwner: true,
          tierOrder: "desc",
        },
      },
      {
        id: "farmPlant",
        verb: "plant",
        repeatByActorWorkUnits: true,
        selectedCropFromPriority: true,
        requires: {
          hasSelectedCrop: true,
          hasMaturedPool: false,
          season: ["winter"],
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
        effect: [
          {
            op: "ConsumeItem",
            system: "growth",
            target: { kind: "tileOccupants", scope: "all" },
            defRegistry: "crops",
            defIdFromContextKey: "selectedCropId",
            amountFromDefKey: "plantSeedPerSec",
            tierOrder: "asc",
            outVar: "seedSpent",
          },
          {
            op: "CreateWorkProcess",
            system: "growth",
            defRegistry: "crops",
            defIdFromContextKey: "selectedCropId",
            amountVar: "seedSpent",
            durationFromDefKey: "maturitySec",
            processType: "cropGrowth",
            queueKey: "processes",
            captureSystem: "hydration",
            captureKey: "sumRatio",
            captureAs: "sumAtStart",
            completionPolicy: "cropGrowth",
            poolKey: "maturedPool",
            processMeta: {
              skipAutoCropSeedRequirement: true,
            },
          },
        ],
      },
    ],
    passives: [
      {
        id: "farmHydrationTick",
        timing: { cadenceSec: 1 },
        effect: [
          {
            op: "AddToSystemState",
            system: "hydration",
            key: "cur",
            amountFromKey: "decayPerSec",
            amountScale: -1,
          },
          {
            op: "ClampSystemState",
            system: "hydration",
            key: "cur",
            min: 0,
            maxKey: "max",
          },
          {
            op: "AccumulateRatio",
            system: "hydration",
            numeratorKey: "cur",
            denominatorKey: "max",
            targetKey: "sumRatio",
          },
        ],
      },
      {
        id: "farmProcessFinalize",
        timing: { cadenceSec: 1 },
        effect: {
          op: "AdvanceWorkProcess",
          system: "growth",
          queueKey: "processes",
          poolKey: "maturedPool",
          processType: "cropGrowth",
          mode: "time",
          deltaSec: 1,
        },
      },
    ],
  },
  fishable: {
    id: "fishable",
    kind: "envTag",
    ui: {
      name: "Fish",
      description: "Go fishing.",
      titleFeedback: {
        mode: "state",
        holderSystemId: "fishStock",
        variant: "roll",
      },
    },
    systems: ["fishStock"],
    intents: [
      {
        id: "fish",
        verb: "fish",
        repeatByActorWorkUnits: true,
        cost: {
          charges: [
            {
              kind: "system",
              target: { ref: "pawn" },
              system: "stamina",
              key: "cur",
              amount: { const: 3 },
              clampMin: 0,
            },
          ],
        },
        effect: { op: "SpawnFromDropTable", tableKey: "fishingDrops" },
      },
    ],
  },
  forageable: {
    id: "forageable",
    kind: "envTag",
    ui: {
      name: "Forage",
      description: "Find useful resources.",
      titleFeedback: {
        mode: "state",
        holderSystemId: "wildStock",
        variant: "roll",
      },
    },
    systems: ["wildStock"],
    intents: [
      {
        id: "forage",
        verb: "forage",
        repeatByActorWorkUnits: true,
        cost: {
          charges: [
            {
              kind: "system",
              target: { ref: "pawn" },
              system: "stamina",
              key: "cur",
              amount: { const: 3 },
              clampMin: 0,
            },
          ],
        },
        effect: { op: "SpawnFromDropTable", tableKey: "forageDrops" },
      },
    ],
  },
  herdable: {
    id: "herdable",
    kind: "envTag",
    ui: { name: "Herd", description: "Husband animals." },
    systems: ["liveStock"],
    intents: [
      {
        id: "herd",
        verb: "herd",
        requires: { season: ["spring", "summer", "autumn"] },
        effect: { op: "AddResource", resource: "meat", amount: 1 },
      },
    ],
  },
  mineable: {
    id: "mineable",
    kind: "envTag",
    ui: { name: "Mine", description: "Mine for stone and minerals." },
    systems: ["reserves"],
    intents: [
      {
        id: "mine",
        verb: "mine",
        requires: { season: ["summer", "autumn", "winter"] },
        effect: { op: "AddResource", resource: "ore", amount: 1 },
      },
    ],
  },
  blocked: {
    id: "blocked",
    kind: "envTag",
    ui: { name: "Blocked", description: "Cannot be occupied by pawns." },
    affordances: ["noOccupy"],
    intents: [],
  },
};

ensureTooltipCardUi(envTagDefs, {
  getTitle: (def) => def?.ui?.name || def?.name || def?.id,
});
