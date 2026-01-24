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
        { tier: "bronze", weight: 0.85 },
        { tier: "silver", weight: 0.15 },
        { tier: "gold", weight: 0.0 },
        { tier: "diamond", weight: 0.0 },
      ],
      silver: [
        { tier: "bronze", weight: 0.65 },
        { tier: "silver", weight: 0.25 },
        { tier: "gold", weight: 0.09 },
        { tier: "diamond", weight: 0.01 },
      ],
      gold: [
        { tier: "bronze", weight: 0.5 },
        { tier: "silver", weight: 0.3 },
        { tier: "gold", weight: 0.17 },
        { tier: "diamond", weight: 0.03 },
      ],
      diamond: [
        { tier: "bronze", weight: 0.35 },
        { tier: "silver", weight: 0.3 },
        { tier: "gold", weight: 0.25 },
        { tier: "diamond", weight: 0.1 },
      ],
    },
  },
  /*
  wheat: {
    cropId: "wheat",
    name: "Wheat",
    maturitySec: 32,
    plantSeedPerSec: 1,
    harvestUnitsPerSec: 2,
    baseYieldMultiplier: 9,
    qualityTablesByFertilityTier: {
      bronze: [
        { tier: "bronze", weight: 0.85 },
        { tier: "silver", weight: 0.15 },
        { tier: "gold", weight: 0.0 },
        { tier: "diamond", weight: 0.0 },
      ],
      silver: [
        { tier: "bronze", weight: 0.65 },
        { tier: "silver", weight: 0.25 },
        { tier: "gold", weight: 0.09 },
        { tier: "diamond", weight: 0.01 },
      ],
      gold: [
        { tier: "bronze", weight: 0.5 },
        { tier: "silver", weight: 0.3 },
        { tier: "gold", weight: 0.17 },
        { tier: "diamond", weight: 0.03 },
      ],
      diamond: [
        { tier: "bronze", weight: 0.35 },
        { tier: "silver", weight: 0.3 },
        { tier: "gold", weight: 0.25 },
        { tier: "diamond", weight: 0.1 },
      ],
    },
  },
  */
};
