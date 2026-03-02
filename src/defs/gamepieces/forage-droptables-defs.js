// forage-droptables-defs.js
// Forage drop tables (data only).
//
// Clean schema (no legacy weight authoring):
// - Tables specify tierWeights (rarity -> base weight) and nullWeight (miss weight).
// - Entries specify rarity: "bronze" | "silver" | "gold" | "diamond".

// - Optional mul scales within a rarity band.
// - eg. { kind: "reeds", rarity: "bronze", mul: 4 / 3, qtyMin: 1, qtyMax: 3 },

// - Optional weight is an escape hatch (use sparingly).
// - Use `tier` ONLY if you want to force the spawned item's tier; rarity is separate.

export const forageDropTables = {
  forageDrops: {
    // Global defaults for this table key.
    tierWeights: { bronze: 35, silver: 15, gold: 5, diamond: 1 },
    nullWeight: 80,

    default: {
      drops: [
        { kind: "reeds", rarity: "bronze", qtyMin: 1, qtyMax: 2 },
        { kind: "fibres", rarity: "silver", qtyMin: 1, qtyMax: 2 },
        { kind: "straw", rarity: "silver", qtyMin: 1, qtyMax: 3 },
        { kind: "dryVegetation", rarity: "silver", qtyMin: 1, qtyMax: 3 },
        { kind: "flint", rarity: "gold", qtyMin: 1, qtyMax: 1 },
        { kind: "silt", rarity: "gold", qtyMin: 1, qtyMax: 2, requiresTag: "fishable" },
        { kind: "dung", rarity: "gold", qtyMin: 1, qtyMax: 2, requiresTag: "herdable" },
      ],
    },

    byTile: {
      tile_wetlands: {
        // Override miss rate for this tile.
        nullWeight: 80,
        drops: [
          // Reeds are more common here (4 vs base bronze=3).
          { kind: "reeds", rarity: "bronze", qtyMin: 1, qtyMax: 3 },
          { kind: "fibres", rarity: "bronze", qtyMin: 1, qtyMax: 2 },
          { kind: "feathers", rarity: "silver", qtyMin: 1, qtyMax: 2 },
          { kind: "eggs", rarity: "gold", qtyMin: 1, qtyMax: 1 },
        ],
      },

      tile_floodplains: {
        drops: [
          { kind: "silt", rarity: "bronze", qtyMin: 1, qtyMax: 2 },
          { kind: "straw", rarity: "bronze", qtyMin: 1, qtyMax: 3 },
          { kind: "barley", rarity: "silver", qtyMin: 1, qtyMax: 3 },
          { kind: "wheat", rarity: "silver", qtyMin: 1, qtyMax: 3 },
        ],
      },

      tile_levee: {
        nullWeight: 280,
        drops: [
          { kind: "clay", rarity: "silver", qtyMin: 1, qtyMax: 2 },
          { kind: "dates", rarity: "gold", qtyMin: 1, qtyMax: 20 },
        ],
      },

      tile_hinterland: {
        drops: [
          { kind: "clay", rarity: "bronze", tier: "silver", qtyMin: 1, qtyMax: 2 },
          { kind: "temper", rarity: "silver", qtyMin: 1, qtyMax: 2 },
          { kind: "dryVegetation", rarity: "bronze", qtyMin: 1, qtyMax: 3 },
          { kind: "dung", rarity: "silver", qtyMin: 1, qtyMax: 2 },
          { kind: "flint", rarity: "silver", qtyMin: 1, qtyMax: 2 },
          { kind: "stone", rarity: "silver", qtyMin: 1, qtyMax: 1 },
        ],
      },
    },
  },
};
