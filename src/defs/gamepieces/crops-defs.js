// crops-defs.js
// Crop registry (data only).

export const cropDefs = {
  barley: {
    cropId: "barley",
    name: "Barley",
    maturitySec: 32,
    plantSeedPerSec: 1,
    harvestUnitsPerSec: 2,
    baseYieldMultiplier: 9,
    qualityTablesByFertilityTier: {
      bronze: [
        { tier: "bronze", weight: 0.95 },
        { tier: "silver", weight: 0.05 },
        { tier: "gold", weight: 0.0 },
        { tier: "diamond", weight: 0.0 },
      ],
      silver: [
        { tier: "bronze", weight: 0.80 },
        { tier: "silver", weight: 0.20 },
        { tier: "gold", weight: 0.00 },
        { tier: "diamond", weight: 0.00 },
      ],
      gold: [
        { tier: "bronze", weight: 0.65 },
        { tier: "silver", weight: 0.3 },
        { tier: "gold", weight: 0.05 },
        { tier: "diamond", weight: 0.00 },
      ],
      diamond: [
        { tier: "bronze", weight: 0.55 },
        { tier: "silver", weight: 0.3 },
        { tier: "gold", weight: 0.25 },
        { tier: "diamond", weight: 0.1 },
      ],
    },
  },
  
  wheat: {
    cropId: "wheat",
    name: "Wheat",
    maturitySec: 32,
    plantSeedPerSec: 1,
    harvestUnitsPerSec: 2,
    baseYieldMultiplier: 9,
    qualityTablesByFertilityTier: {
      bronze: [
        { tier: "bronze", weight: 0.95 },
        { tier: "silver", weight: 0.05 },
        { tier: "gold", weight: 0.0 },
        { tier: "diamond", weight: 0.0 },
      ],
      silver: [
        { tier: "bronze", weight: 0.80 },
        { tier: "silver", weight: 0.20 },
        { tier: "gold", weight: 0.00 },
        { tier: "diamond", weight: 0.00 },
      ],
      gold: [
        { tier: "bronze", weight: 0.65 },
        { tier: "silver", weight: 0.3 },
        { tier: "gold", weight: 0.05 },
        { tier: "diamond", weight: 0.00 },
      ],
      diamond: [
        { tier: "bronze", weight: 0.55 },
        { tier: "silver", weight: 0.3 },
        { tier: "gold", weight: 0.25 },
        { tier: "diamond", weight: 0.1 },
      ],
    },
  },
  
};
