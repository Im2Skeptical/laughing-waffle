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
        effect: { op: "FarmHarvest" },
      },
      {
        id: "farmPlant",
        verb: "plant",
        requires: { 
          hasMaturedPool: false, 
          season: ["winter", "autumn"], 
        },
        effect: { op: "FarmPlant" },
      },
    ],
    passives: [
      /*
      things on tick/season change/ whatever timing / and don't require pawns
*/
    ]
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
