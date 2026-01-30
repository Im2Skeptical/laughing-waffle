// forage-droptables-defs.js
// Forage drop tables (data only).

export const forageDropTables = {
  forageDrops: {
    default: [
      { kind: null, weight: 2 },
      { kind: "reeds", weight: 3, qtyMin: 1, qtyMax: 2 },
      { kind: "fibres", weight: 2, qtyMin: 1, qtyMax: 2 },
      { kind: "straw", weight: 2, qtyMin: 1, qtyMax: 3 },
      { kind: "dryVegetation", weight: 2, qtyMin: 1, qtyMax: 3 },
      { kind: "flint", weight: 1, qtyMin: 1, qtyMax: 1 },
      { kind: "silt", weight: 1, qtyMin: 1, qtyMax: 2, requiresTag: "fishable" },
    ],
    byTile: {
      tile_wetlands: [
        { kind: null, weight: 2 },
        { kind: "reeds", weight: 4, qtyMin: 1, qtyMax: 3 },
        { kind: "fibres", weight: 2, qtyMin: 1, qtyMax: 2 },
        { kind: "silt", weight: 3, qtyMin: 1, qtyMax: 2 },
        { kind: "clay", weight: 1, qtyMin: 1, qtyMax: 1 },
      ],
      tile_hinterland: [
        { kind: null, weight: 3 },
        { kind: "straw", weight: 3, qtyMin: 1, qtyMax: 3 },
        { kind: "dryVegetation", weight: 2, qtyMin: 1, qtyMax: 3 },
        { kind: "flint", weight: 1, qtyMin: 1, qtyMax: 1 },
        { kind: "reeds", weight: 1, qtyMin: 1, qtyMax: 2 },
      ],
    },
  },
};
