// env-tags-defs.js
// Env tag registry (data only).

export const envTagDefs = {
  farmable: {
    id: "farmable",
    kind: "envTag",
    ui: { name: "Farmable", description: "Basic crop work." },
    systems: ["fertility", "hydration", "growth"],
    intents: [
      {
        id: "farm",
        verb: "farm",
        requires: { season: ["spring", "summer"] },
        effect: { op: "AddResource", resource: "food", amount: 1 },
      },
    ],
  },
  fishable: {
    id: "fishable",
    kind: "envTag",
    ui: { name: "Fishable", description: "Accessible fishing grounds." },
    systems: ["fishDensity", "hydration"],
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
    ui: { name: "Forageable", description: "Wild edibles are present." },
    systems: ["growth", "turfDensity"],
    intents: [
      {
        id: "forage",
        verb: "forage",
        requires: { season: ["spring", "autumn"] },
        effect: { op: "AddResource", resource: "food", amount: 1 },
      },
    ],
  },
  grazable: {
    id: "grazable",
    kind: "envTag",
    ui: { name: "Grazable", description: "Open turf for herd grazing." },
    systems: ["turfDensity", "growth"],
    intents: [
      {
        id: "graze",
        verb: "graze",
        requires: { season: ["spring", "summer", "autumn"] },
        effect: { op: "AddResource", resource: "meat", amount: 1 },
      },
    ],
  },
  mineable: {
    id: "mineable",
    kind: "envTag",
    ui: { name: "Mineable", description: "Exposed seams can be worked." },
    systems: ["mineralRarity"],
    intents: [
      {
        id: "mine",
        verb: "mine",
        requires: { season: ["summer", "autumn", "winter"] },
        effect: { op: "AddResource", resource: "ore", amount: 1 },
      },
    ],
  },
};
