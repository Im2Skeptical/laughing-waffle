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
    defaultSpan: 2,
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
};
