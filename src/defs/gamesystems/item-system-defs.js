// item-system-defs.js
// Item system registry (data only).

import { ensureTooltipCardUi } from "../tooltip-ui-utils.js";

export const itemSystemDefs = {
  perishability: {
    id: "perishability",
    kind: "itemSystem",
    ui: { name: "Perishability", description: "Tracks rot progression over time." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: {
    },
  },
  nourishment: {
    id: "nourishment",
    kind: "itemSystem",
    ui: { name: "Nourishment", description: "Tracks nutritional value of items." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: {
    },
  },
  wearable: {
    id: "wearable",
    kind: "itemSystem",
    ui: { name: "Wearable", description: "Defines equipment slot compatibility." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: {
      slot: null,
      slots: [],
    },
  },
  storage: {
    id: "storage",
    kind: "itemSystem",
    ui: {
      name: "Storage",
      description: "Tiered storage pool for portable storage items.",
    },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: {
      byKindTier: {},
      totalByTier: {
        bronze: 0,
        silver: 0,
        gold: 0,
        diamond: 0,
      },
    },
  },
  timegraph: {
    id: "timegraph",
    kind: "itemSystem",
    ui: {
      name: "Timegraph",
      description: "Stores deterministic graph configuration for scroll items.",
    },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: {},
  },
};

ensureTooltipCardUi(itemSystemDefs, {
  getTitle: (def) => def?.ui?.name || def?.name || def?.id,
});
