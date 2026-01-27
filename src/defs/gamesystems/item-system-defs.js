// item-system-defs.js
// Item system registry (data only).

export const itemSystemDefs = {
  freshness: {
    id: "freshness",
    kind: "itemSystem",
    ui: { name: "Freshness", description: "Tracks rot progression over time." },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: {
      ageSec: 0,
    },
  },
};