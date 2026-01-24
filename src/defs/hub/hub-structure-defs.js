// hub-structure-defs.js
// Definitions for hub structures.

export const hubStructureDefs = {
  hearth: {
    id: "hearth",
    kind: "hubStructure",
    name: "Hearth",
    color: 0xd9793a,
    defaultSpan: 1,
    tags: ["hearth"],
    systems: {},
    inventory: { cols: 5, rows: 10 },
    ui: {
      title: "Hearth",
      lines: ["A warm place to recover."],
      description: "Rest here to regain stamina.",
    },
  },
};
