// env-systems-defs.js
// Env system registry (data only).

export const envSystemDefs = {
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
  },
  reserves: {
    id: "reserves",
    kind: "envSystem",
    ui: { name: "Reserves", description: "Ore reserves" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
};
