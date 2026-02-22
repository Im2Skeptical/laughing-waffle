
// Clean schema (no legacy weight authoring):
// - Tables specify tierWeights (rarity -> base weight) and nullWeight (miss weight).
// - Entries specify rarity: "bronze" | "silver" | "gold" | "diamond".

// - Optional mul scales within a rarity band.
// - eg. { kind: "reeds", rarity: "bronze", mul: 4 / 3, qtyMin: 1, qtyMax: 3 },

// - Optional weight is an escape hatch (use sparingly).
// - Use `tier` ONLY if you want to force the spawned item's tier; rarity is separate.

export const fishingDropTables = {
  fishingDrops: {
    // Global defaults for this table key.
    tierWeights: { bronze: 35, silver: 15, gold: 5, diamond: 1 },
    nullWeight: 800,

    default: {
      drops: [
        { kind: "smallFish", rarity: "bronze", qtyMin: 1, qtyMax: 1 },
        { kind: "mediumFish", rarity: "silver", qtyMin: 1, qtyMax: 1 },
        { kind: "largeFish", rarity: "gold", qtyMin: 1, qtyMax: 1 },
        { kind: "rareFish", rarity: "diamond", qtyMin: 1, qtyMax: 1 },
      ],
    },

    byTile: {
      tile_river: {
        nullWeight: 500,
        drops: [
        { kind: "smallFish", rarity: "bronze", qtyMin: 1, qtyMax: 1 },
        { kind: "mediumFish", rarity: "silver", qtyMin: 1, qtyMax: 1 },
        { kind: "largeFish", rarity: "bronze", qtyMin: 1, qtyMax: 1 },
        { kind: "rareFish", rarity: "diamond", qtyMin: 1, qtyMax: 1 },
        ],
      },
    },
  },
};
