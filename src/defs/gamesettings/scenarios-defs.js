// scenarios-defs.js - human-authored start scenarios (pure data)

export const setupDefs = {
  testing: {
    rngSeed: 123,

    resources: { gold: 0, food: 0, population: 0 },

    board: {
      cols: 12,
      tiles: [
        "tile_hinterland",
        "tile_levee",
        "tile_floodplains",
        "tile_floodplains",
        "tile_wetlands",
        "tile_floodplains",
        "tile_river",
        "tile_wetlands",
        "tile_floodplains",
        "tile_floodplains",
        "tile_levee",
        "tile_hinterland",
      ],
    },

    // permanents placed by board column
    permanents: [
      { defId: "farm", hubCol: 0 },
      { defId: "mine", hubCol: 3 },
      { defId: "storehouse", hubCol: 6 },
      { defId: "storehouse", hubCol: 9 },
    ],

    // Env cards (static; no deck refill)
    envSlots: [null, null, null, null, null],

    // characters placed by board column
    characters: [
      { name: "Char 1", color: 0xff9999, hubCol: 4 },
      { name: "Char 2", color: 0x9999ff, hubCol: 5 },
    ],

    // inventories keyed by owner selector:
    // owner: { type: "permanent", col: 6 } means "permanent at column 6"
    // owner: { type: "character", index: 0 } means "1st character in characters array"
    inventories: [
      {
        owner: { type: "permanent", hubCol: 6 },
        items: [
          { kind: "grain", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "grain", quantity: 20, gridX: 1, gridY: 0 },
          { kind: "grain", quantity: 20, gridX: 2, gridY: 0 },
        ],
      },
    ],
  },

  // Example: a curated autumn flood test start
  floodTest: {
    rngSeed: 777,
    resources: { gold: 0, food: 0, population: 0 },

    board: {
      cols: 12,
      tiles: [
        "tile_floodplains",
        "tile_floodplains",
        "tile_wetlands",
        "tile_levee",
        "tile_coast",
        "tile_dunes",
        "tile_hinterland",
        "tile_highlands",
        "tile_steppe",
        "tile_floodplains",
        "tile_wetlands",
        "tile_levee",
      ],
    },

    permanents: [
      { defId: "farm", hubCol: 1 },
      { defId: "mine", hubCol: 5 },
      { defId: "storehouse", hubCol: 7 },
    ],

    envSlots: ["flood_autumn", "flood_autumn", null, null, "rock"],

    characters: [{ name: "Char 1", color: 0xff9999, hubCol: 4 }],

    inventories: [],
  },
};
