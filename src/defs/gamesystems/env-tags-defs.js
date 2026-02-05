// env-tags-defs.js
// Env tag registry (data only).

export const envTagDefs = {
  build: {
    id: "build",
    kind: "envTag",
    ui: { name: "Build", description: "Construct improvements here." },
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
    ui: { name: "Farm", description: "Grow crops." },
    systems: ["growth", "hydration", "fertility"],
    intents: [
      {
        id: "farmHarvest",
        verb: "harvest",
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
        effect: {
          op: "CreateWorkProcess",
          system: "growth",
          defRegistry: "crops",
          defIdFromSystemKey: "selectedCropId",
          amountFromDefKey: "plantSeedPerSec",
          durationFromDefKey: "maturitySec",
          processType: "cropGrowth",
          queueKey: "processes",
          captureSystem: "hydration",
          captureKey: "sumRatio",
          captureAs: "sumAtStart",
          completionPolicy: "cropGrowth",
          poolKey: "maturedPool",
        },
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
