// env-tags-defs.js
// Env tag registry (data only).

export const envTagDefs = {
  farmable: {
    id: "farmable",
    kind: "envTag",
    ui: { name: "Farm", description: "Grow crops." },
    systems: ["growth", "hydration", "fertility"],
    intents: [
      {
        id: "farmHarvest",
        verb: "harvest",
        requires: { hasMaturedPool: true },
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
        requires: { 
          hasMaturedPool: false,
          season: ["autumn", "winter"]  
        },
        effect: [
          {
            op: "ConsumeItem",
            system: "growth",
            target: { kind: "tileOccupants" },
            defRegistry: "crops",
            defIdFromSystemKey: "selectedCropId",
            amountFromDefKey: "plantSeedPerSec",
            perOwner: true,
            outVar: "seedConsumed",
          },
          {
            op: "CreateProcess",
            system: "growth",
            defRegistry: "crops",
            defIdFromSystemKey: "selectedCropId",
            amountVar: "seedConsumed",
            durationFromDefKey: "maturitySec",
            processType: "cropGrowth",
            queueKey: "processes",
            captureSystem: "hydration",
            captureKey: "sumRatio",
            captureAs: "sumAtStart",
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
          op: "FinalizeProcess",
          system: "growth",
          queueKey: "processes",
          poolKey: "maturedPool",
          processType: "cropGrowth",
        },
      },
    ],
  },
  fishable: {
    id: "fishable",
    kind: "envTag",
    ui: { name: "Fish", description: "Go fishing." },
    systems: ["fishStock"],
    intents: [
      {
        id: "fish",
        verb: "fish",
        requires: { season: ["spring", "summer", "autumn"] },
        effect: { op: "AddResource", resource: "fish", amount: 1 },
      },
    ],
  },
  forageable: {
    id: "forageable",
    kind: "envTag",
    ui: { name: "Forage", description: "Find useful resources." },
    systems: ["wildStock"],
    intents: [
      {
        id: "forage",
        verb: "forage",
        requires: { season: ["spring", "autumn"] },
        effect: { op: "AddResource", resource: "food", amount: 1 },
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
