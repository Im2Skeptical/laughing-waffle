// env-structures-defs.js
// Definitions for environment structures (board-level, separate from hub structures).

export const envStructureDefs = {
  hubPortal: {
    id: "hubPortal",
    kind: "envStructure",
    name: "Hub Portal",
    defaultSpan: 1,
    ui: {
      title: "Hub",
      description: "Old ruins make for a convenient hub",
      color: 0x5e5c58,
    },
    // Schema-ready; systems can be attached here later.
    systems: {},
  },
};
