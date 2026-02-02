// hub-structure-defs.js
// Definitions for hub structures.

export const hubStructureDefs = {
  hearth: {
    id: "hearth",
    kind: "hubStructure",
    name: "Hearth",
    color: 0xd9793a,
    defaultSpan: 2,
    tags: ["restable"],
    systems: {},
    inventory: { cols: 5, rows: 10 },
    ui: {
      title: "Hearth",
      lines: ["A warm place to recover."],
      description: "Rest here to regain stamina.",
    },
  },
  granary: {
    id: "granary",
    kind: "hubStructure",
    name: "Granary",
    color: 0xc2a16a,
    defaultSpan: 1,
    tags: ["deposit"],
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
