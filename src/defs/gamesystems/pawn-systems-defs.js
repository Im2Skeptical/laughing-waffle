// pawn-systems-defs.js
// Pawn system registry (data only).

export const pawnSystemDefs = {
  stamina: {
    id: "stamina",
    kind: "pawnSystem",
    ui: { name: "Stamina", description: "Energy for labor" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: { cur: 80, max: 100 },
  },
  hunger: {
    id: "hunger",
    kind: "pawnSystem",
    ui: { name: "Hunger", description: "Need for food" },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: { cur: 80, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
  },
};
