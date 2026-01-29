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

    // hub structures placed by hub column
    hub: {
      cols: 10,
      structures: [
        { defId: "hearth", hubCol: 4 },

      ],
    },

    // characters placed by board column
    characters: [
      { name: "Char 1", color: 0xff9999, hubCol: 4 },
      { name: "Char 2", color: 0x9999ff, hubCol: 4 },
    ],

    // inventories keyed by owner selector:
    // owner: { type: "hubStructure", hubCol: 6 } means "hub structure at column 6"
    // owner: { type: "character", index: 0 } means "1st character in characters array"
    inventories: [
      {
        owner: { type: "hubStructure", hubCol: 4 },
        items: [
          { kind: "wheat", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 2, gridY: 0 },
          { kind: "barley", quantity: 15, gridX: 0, gridY: 2 },
          { kind: "barleyPorridge", gridX: 0, gridY: 9 },
          { kind: "barleyPorridge", gridX: 2, gridY: 9 },
          { kind: "barleyPorridge", gridX: 0, gridY: 8 },
          { kind: "barleyPorridge", gridX: 2, gridY: 8 },
        ],
      },
      {
        owner: { type: "character", index: 0 },
        items: [
          { kind: "wheat", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
        ],
      },
      {
        owner: { type: "character", index: 1 },
        items: [
          { kind: "wheat", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
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

    hub: {
      cols: 10,
      structures: [
        { defId: "hearth", hubCol: 1 },
        { defId: "hearth", hubCol: 5 },
        { defId: "hearth", hubCol: 7 },
      ],
    },

    characters: [{ name: "Char 1", color: 0xff9999, hubCol: 4 }],

    inventories: [],
  },
};
