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
};
