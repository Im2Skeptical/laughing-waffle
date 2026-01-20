// scenarios-defs.js — human-authored start scenarios (pure data)

export const setupDefs = {
  testing: {
    rngSeed: 123,

    resources: { gold: 0, food: 0, population: 0 },

    // permanents on the board
    permanents: [
      { defId: "farm", x: 80, y: 260 },
      { defId: "mine", x: 240, y: 260 },
      { defId: "storehouse", x: 400, y: 260 },
      { defId: "storehouse", x: 560, y: 260 },
    ],

    // legacy env cards (static; no deck refill)
    envSlots: [null, null, null, null, null],

    // characters
    characters: [
      { name: "Char 1", color: 0xff9999, slotIndex: 0 },
      { name: "Char 2", color: 0x9999ff, slotIndex: 1 },
    ],

    // inventories keyed by owner selector:
    // owner: { type: "permanent", index: 2 } means "3rd permanent in permanents array"
    // owner: { type: "character", index: 0 } means "1st character in characters array"
    inventories: [
      {
        owner: { type: "permanent", index: 2 },
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

    permanents: [
      { defId: "farm", x: 80, y: 260 },
      { defId: "mine", x: 240, y: 260 },
      { defId: "storehouse", x: 400, y: 260 },
    ],

    envSlots: ["flood_autumn", "flood_autumn", null, null, "rock"],

    characters: [{ name: "Char 1", color: 0xff9999, slotIndex: 1 }],

    inventories: [],
  },
};
