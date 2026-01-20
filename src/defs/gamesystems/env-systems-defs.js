// env-systems-defs.js
// Env system registry (data only).

export const envSystemDefs = {
  fertility: {
    id: "fertility",
    kind: "envSystem",
    ui: { name: "Fertility", description: "Soil fertility tier." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
  hydration: {
    id: "hydration",
    kind: "envSystem",
    ui: { name: "Hydration", description: "Soil moisture tier." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
  fishDensity: {
    id: "fishDensity",
    kind: "envSystem",
    ui: { name: "Fish Density", description: "Fish population tier." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
  turfDensity: {
    id: "turfDensity",
    kind: "envSystem",
    ui: { name: "Turf Density", description: "Grassland density tier." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
  growth: {
    id: "growth",
    kind: "envSystem",
    ui: { name: "Growth", description: "Plant growth tier." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
  mineralRarity: {
    id: "mineralRarity",
    kind: "envSystem",
    ui: { name: "Mineral Rarity", description: "Ore richness tier." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
  },
};
