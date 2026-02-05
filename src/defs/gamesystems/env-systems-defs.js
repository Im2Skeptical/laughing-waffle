// env-systems-defs.js
// Env system registry (data only).

export const envSystemDefs = {
  build: {
    id: "build",
    kind: "envSystem",
    ui: { name: "Build", description: "Construction progress." },
    defaultTier: "bronze",
    stateDefaults: {
      processes: [],
    },
  },
  fertility: {
    id: "fertility",
    kind: "envSystem",
    ui: { name: "Fertility", description: "Soil fertility" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
  hydration: {
    id: "hydration",
    kind: "envSystem",
    ui: { name: "Hydration", description: "Soil moisture" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: { cur: 0, max: 100, decayPerSec: 2, sumRatio: 0 },
  },
  fishStock: {
    id: "fishStock",
    kind: "envSystem",
    ui: { name: "Fishstock", description: "Fish population" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
  wildStock: {
    id: "wildStock",
    kind: "envSystem",
    ui: { name: "Wildstock", description: "Density of foragables" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
  liveStock: {
    id: "liveStock",
    kind: "envSystem",
    ui: { name: "Livestock", description: "Animal count" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
  growth: {
    id: "growth",
    kind: "envSystem",
    ui: { name: "Growth", description: "Crop growth" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: {
      selectedCropId: null,
      processes: [],
      maturedPool: { bronze: 0, silver: 0, gold: 0, diamond: 0 },
    },
    hydrationCurveByTier: {
      bronze: { A: 0.85, P: 1.8 },
      silver: { A: 1.0, P: 1.45 },
      gold: { A: 1.1, P: 1.2 },
      diamond: { A: 1.2, P: 1.05 },
    },
  },
  reserves: {
    id: "reserves",
    kind: "envSystem",
    ui: { name: "Reserves", description: "Ore reserves" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
};
