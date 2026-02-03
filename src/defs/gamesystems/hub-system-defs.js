// hub-system-defs.js
// Hub system registry (data only).

export const hubSystemDefs = {
  granaryStore: {
    id: "granaryStore",
    kind: "hubSystem",
    ui: { name: "Granary Store", description: "Stored grain by type and tier." },
    defaultTier: "bronze",
    stateDefaults: {
      byKindTier: {},
      totalByTier: {},
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
