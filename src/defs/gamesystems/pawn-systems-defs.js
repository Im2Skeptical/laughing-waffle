// pawn-systems-defs.js
// Pawn system registry (data only).

export const pawnSystemDefs = {
  stamina: {
    id: "stamina",
    kind: "pawnSystem",
    ui: {
      name: "Stamina",
      shortLabel: "S",
      bubbleColor: 0x9d6b3c,
      description: "Work energy. Pawns rest to refill it.",
      keywords: ["stamina", "rest"],
      tooltipCard: {
        subtitle: "Pawn system",
      },
    },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: { cur: 80, max: 100 },
  },
  hunger: {
    id: "hunger",
    kind: "pawnSystem",
    ui: {
      name: "Hunger",
      shortLabel: "Hu",
      bubbleColor: 0xc79549,
      description: "Food pressure that falls over time and drives food-seeking.",
      keywords: ["hunger", "seek", "starving"],
      tooltipCard: {
        subtitle: "Pawn system",
      },
    },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: { cur: 80, max: 100, belowThresholdSec: 0, debtCadenceSec: 0 },
  },
  leadership: {
    id: "leadership",
    kind: "pawnSystem",
    ui: {
      name: "Leadership",
      description: "Leader-only control surface for followers and workers.",
      hideInTooltip: true,
      keywords: ["prestige", "faith"],
      tooltipCard: {
        subtitle: "Pawn system",
      },
    },
    defaultTier: "bronze",
    tierMap: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    stateDefaults: { followersAutoFollow: true },
  },
};
