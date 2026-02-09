// scenarios-defs.js - human-authored start scenarios (pure data)
import { INITIAL_POPULATION_DEFAULT } from "./gamerules-defs.js";

export const setupDefs = {
  testing: {
    rngSeed: 123,

    resources: { gold: 0, food: 0, population: INITIAL_POPULATION_DEFAULT },

    // Optional dev-time UI bootstrap:
    // - openInventories: owner selectors opened/pinned on boot
    // - openSkillTree: false | true | character selector ({ type: "character", index })
    devUi: {
      //openInventories: [{ type: "hubStructure", hubCol: 0 }],
      openSkillTree: true,
    },

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
        { defId: "itemzoo", hubCol: 0 },
        { defId: "mudHouses", hubCol: 3 },
        { defId: "hearth", hubCol: 5 },
        { defId: "granary", hubCol: 6 },

      ],
    },

    // characters placed by board column
    characters: [
      { name: "Char 1", color: 0xff9999, hubCol: 5, role: "leader" },
      { name: "Char 2", color: 0x9999ff, hubCol: 5, role: "leader" },
    ],

    // inventories keyed by owner selector:
    // owner: { type: "hubStructure", hubCol: 6 } means "hub structure at column 6"
    // owner: { type: "character", index: 0 } means "1st character in characters array"
    inventories: [
      {
        owner: { type: "hubStructure", hubCol: 0 },
        // Item Zoo: one of each item (laid out with spacing to avoid overlap)
        items: [
          { kind: "barley", quantity: 1, gridX: 0, gridY: 0 },
          { kind: "wheat", quantity: 1, gridX: 2, gridY: 0 },
          { kind: "barleyPorridge", gridX: 4, gridY: 0 },
          { kind: "dates", gridX: 6, gridY: 0 },
          { kind: "rot", quantity: 1, gridX: 8, gridY: 0 },
          { kind: "flint", gridX: 10, gridY: 0 },
          { kind: "dung", gridX: 12, gridY: 0 },
          { kind: "dryVegetation", gridX: 14, gridY: 0 },
          { kind: "straw", gridX: 16, gridY: 0 },
          { kind: "stone", gridX: 18, gridY: 0 },
          { kind: "reeds", gridX: 20, gridY: 0 },
          { kind: "fibres", gridX: 22, gridY: 0 },
          { kind: "clay", gridX: 24, gridY: 0 },
          { kind: "silt", gridX: 26, gridY: 0 },
          { kind: "temper", gridX: 28, gridY: 0 },
          { kind: "testHat", gridX: 0, gridY: 3 },
          { kind: "testClothes", gridX: 2, gridY: 3 },
          { kind: "testWeapon", gridX: 4, gridY: 3 },
          { kind: "testOffhand", gridX: 6, gridY: 3 },
          { kind: "testRing", gridX: 8, gridY: 3 },
          { kind: "testRing", gridX: 10, gridY: 3 },
          { kind: "testAmulet", gridX: 12, gridY: 3 },
          { kind: "staminaRing", gridX: 14, gridY: 3 },
          { kind: "basket", gridX: 16, gridY: 3 },
        ],
      },
      {
        owner: { type: "hubStructure", hubCol: 3 },
        items: [
          { kind: "wheat", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 2, gridY: 0 },
          { kind: "barley", quantity: 15, gridX: 0, gridY: 2 },
          { kind: "roastedBarley", quantity: 25, gridX: 2, gridY: 3 },
          { kind: "roastedBarley", quantity: 25, gridX: 2, gridY: 4 },
          { kind: "roastedBarley", quantity: 25, gridX: 2, gridY: 5 },
          { kind: "roastedBarley", quantity: 25, gridX: 2, gridY: 6 },
          { kind: "roastedBarley", quantity: 25, gridX: 3, gridY: 3 },
          { kind: "roastedBarley", quantity: 25, gridX: 3, gridY: 4 },
          { kind: "roastedBarley", quantity: 25, gridX: 3, gridY: 5 },
          { kind: "roastedBarley", quantity: 25, gridX: 3, gridY: 6 },
          { kind: "barleyPorridge", gridX: 0, gridY: 9 },
          { kind: "barleyPorridge", gridX: 2, gridY: 9 },
          { kind: "barleyPorridge", gridX: 0, gridY: 8 },
          { kind: "barleyPorridge", gridX: 2, gridY: 8 },
        ],
      },
      {
        owner: { type: "character", index: 0 },
        items: [
          { kind: "reeds", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
          { kind: "straw", quantity: 20, gridX: 2, gridY: 0 },
          { kind: "stone", quantity: 5, gridX: 3, gridY: 0 },
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

  devZoo01: {
    rngSeed: 123,

    resources: { gold: 0, food: 0, population: INITIAL_POPULATION_DEFAULT },

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
        { defId: "itemzoo", hubCol: 0 },
        { defId: "mudHouses", hubCol: 3 },
        { defId: "hearth", hubCol: 5 },
        { defId: "granary", hubCol: 6 },

      ],
    },

    // characters placed by board column
    characters: [
      { name: "Char 1", color: 0xff9999, hubCol: 5, role: "leader" },
      { name: "Char 2", color: 0x9999ff, hubCol: 5, role: "leader" },
    ],

    // inventories keyed by owner selector:
    // owner: { type: "hubStructure", hubCol: 6 } means "hub structure at column 6"
    // owner: { type: "character", index: 0 } means "1st character in characters array"
    inventories: [
      {
        owner: { type: "hubStructure", hubCol: 0 },
        // Item Zoo: one of each item (laid out with spacing to avoid overlap)
        items: [
          { kind: "barley", quantity: 1, gridX: 0, gridY: 0 },
          { kind: "wheat", quantity: 1, gridX: 2, gridY: 0 },
          { kind: "barleyPorridge", gridX: 4, gridY: 0 },
          { kind: "dates", gridX: 6, gridY: 0 },
          { kind: "rot", quantity: 1, gridX: 8, gridY: 0 },
          { kind: "flint", gridX: 10, gridY: 0 },
          { kind: "dung", gridX: 12, gridY: 0 },
          { kind: "dryVegetation", gridX: 14, gridY: 0 },
          { kind: "straw", gridX: 16, gridY: 0 },
          { kind: "stone", gridX: 18, gridY: 0 },
          { kind: "reeds", gridX: 20, gridY: 0 },
          { kind: "fibres", gridX: 22, gridY: 0 },
          { kind: "clay", gridX: 24, gridY: 0 },
          { kind: "silt", gridX: 26, gridY: 0 },
          { kind: "temper", gridX: 28, gridY: 0 },
          { kind: "testHat", gridX: 0, gridY: 3 },
          { kind: "testClothes", gridX: 2, gridY: 3 },
          { kind: "testWeapon", gridX: 4, gridY: 3 },
          { kind: "testOffhand", gridX: 6, gridY: 3 },
          { kind: "testRing", gridX: 8, gridY: 3 },
          { kind: "testRing", gridX: 10, gridY: 3 },
          { kind: "testAmulet", gridX: 12, gridY: 3 },
          { kind: "staminaRing", gridX: 14, gridY: 3 },
          { kind: "basket", gridX: 16, gridY: 3 },
        ],
      },
      {
        owner: { type: "hubStructure", hubCol: 3 },
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
          { kind: "reeds", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
          { kind: "straw", quantity: 20, gridX: 2, gridY: 0 },
          { kind: "stone", quantity: 5, gridX: 3, gridY: 0 },
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

  devPlaytesting01: {
    rngSeed: 123,

    resources: { gold: 0, food: 0, population: INITIAL_POPULATION_DEFAULT },

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
        { defId: "mudHouses", hubCol: 3 },
        { defId: "hearth", hubCol: 5 },
        { defId: "granary", hubCol: 6 },

      ],
    },

    // characters placed by board column
    characters: [
      { name: "Char 1", color: 0xff9999, hubCol: 5, role: "leader" },
      { name: "Char 2", color: 0x9999ff, hubCol: 5, role: "leader" },
    ],

    // inventories keyed by owner selector:
    // owner: { type: "hubStructure", hubCol: 6 } means "hub structure at column 6"
    // owner: { type: "character", index: 0 } means "1st character in characters array"
    inventories: [
      {
        owner: { type: "hubStructure", hubCol: 0 },
        // Item Zoo: one of each item (laid out with spacing to avoid overlap)
        items: [
          { kind: "barley", quantity: 1, gridX: 0, gridY: 0 },
          { kind: "wheat", quantity: 1, gridX: 2, gridY: 0 },
          { kind: "barleyPorridge", gridX: 4, gridY: 0 },
          { kind: "dates", gridX: 6, gridY: 0 },
          { kind: "rot", quantity: 1, gridX: 8, gridY: 0 },
          { kind: "flint", gridX: 10, gridY: 0 },
          { kind: "dung", gridX: 12, gridY: 0 },
          { kind: "dryVegetation", gridX: 14, gridY: 0 },
          { kind: "straw", gridX: 16, gridY: 0 },
          { kind: "stone", gridX: 18, gridY: 0 },
          { kind: "reeds", gridX: 20, gridY: 0 },
          { kind: "fibres", gridX: 22, gridY: 0 },
          { kind: "clay", gridX: 24, gridY: 0 },
          { kind: "silt", gridX: 26, gridY: 0 },
          { kind: "temper", gridX: 28, gridY: 0 },
          { kind: "testHat", gridX: 0, gridY: 3 },
          { kind: "testClothes", gridX: 2, gridY: 3 },
          { kind: "testWeapon", gridX: 4, gridY: 3 },
          { kind: "testOffhand", gridX: 6, gridY: 3 },
          { kind: "testRing", gridX: 8, gridY: 3 },
          { kind: "testRing", gridX: 10, gridY: 3 },
          { kind: "testAmulet", gridX: 12, gridY: 3 },
          { kind: "staminaRing", gridX: 14, gridY: 3 },
          { kind: "basket", gridX: 16, gridY: 3 },
        ],
      },
      {
        owner: { type: "hubStructure", hubCol: 3 },
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
          { kind: "reeds", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
          { kind: "straw", quantity: 20, gridX: 2, gridY: 0 },
          { kind: "stone", quantity: 5, gridX: 3, gridY: 0 },
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
};
