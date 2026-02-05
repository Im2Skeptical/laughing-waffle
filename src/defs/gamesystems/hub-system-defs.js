// hub-system-defs.js
// Hub system registry (data only).

export const hubSystemDefs = {
  build: {
    id: "build",
    kind: "hubSystem",
    ui: { name: "Build", description: "Construction progress." },
    defaultTier: "bronze",
    stateDefaults: {
      processes: [],
    },
  },
  distribution: {
    id: "distribution",
    kind: "hubSystem",
    ui: {
      name: "Distribution",
      description: "Routing range for distributor structures.",
    },
    defaultTier: "bronze",
    rangeByTier: {
      bronze: 1,
      silver: 2,
      gold: 3,
      diamond: "global",
    },
  },
  granaryStore: {
    id: "granaryStore",
    kind: "hubSystem",
    ui: { name: "Granary Store", description: "Stored grain by type and tier." },
    defaultTier: "bronze",
    stateDefaults: {
      byKindTier: {},
      totalByTier: {},
      processes: [],
    },
  },
  fireplace: {
    id: "fireplace",
    kind: "hubSystem",
    ui: { name: "Fireplace", description: "Provides warmth and light." },
    defaultTier: "bronze",
    stateDefaults: {
      selectedRecipeId: null,
      processes: [], // same queueKey pattern as crops
    },
  },
  workspace: {
    id: "workspace",
    kind: "hubSystem",
    ui: { name: "Workspace", description: "Craft items here." },
    defaultTier: "bronze",
    stateDefaults: {
      selectedRecipeId: null,
      processes: [], // same queueKey pattern as crops
    },
  },
};
