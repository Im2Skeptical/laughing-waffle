// hub-structure-defs.js
// Definitions for hub structures.

export const hubStructureDefs = {
  hearth: {
    id: "hearth",
    kind: "hubStructure",
    name: "Hearth",
    color: 0xd9793a,
    defaultSpan: 1,
    tags: ["canCook", "canCraft"],
    systems: {},
    inventory: { cols: 5, rows: 10 },
    ui: {
      title: "Hearth",
      lines: ["Small fireplace to cook and craft"],
      description: "Rest here to regain stamina.",
    },
  },
  makeshiftShelter: {
    id: "makeshiftShelter",
    kind: "hubStructure",
    name: "Makeshift Shelter",
    color: 0x808080,
    defaultSpan: 2,
    tags: ["canRest"],
    systems: {},
    inventory: { cols: 5, rows: 10 },
    ui: {
      title: "Makeshift Shelter",
      lines: ["A shaded place to recover."],
      description: "Rest here to regain stamina.",
    },
  },
  granary: {
    id: "granary",
    kind: "hubStructure",
    name: "Granary",
    color: 0xc2a16a,
    defaultSpan: 1,
    tags: ["canDeposit"],
    systems: {},
    inventory: { cols: 5, rows: 6 },
    inventoryRules: { allowedItemTags: ["grain"] },
    ui: {
      title: "Granary",
      lines: ["Deposit grain here to build prestige."],
      description: "Stores grain by type and tier.",
    },
  },
  itemzoo: {
    id: "itemzoo",
    kind: "hubStructure",
    name: "Item Zoo",
    color: 0xd70d0d,
    defaultSpan: 1,
    tags: [],
    systems: {},
    inventory: { cols: 30, rows: 25 },
    ui: {
      title: "Item Zoo",
      lines: ["Dev structure to preview all items"],
      description: "Stores items by type and tier.",
    },
  },
};
