// pawn-defs.js
// Pawn registry (data only).

import {
  PAWN_IDLE_STAMINA_REGEN_AMOUNT,
  PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC,
} from "../gamesettings/gamerules-defs.js";

const idleStaminaRegenPassive =
  Number.isFinite(PAWN_IDLE_STAMINA_REGEN_AMOUNT) &&
  Number.isFinite(PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC) &&
  PAWN_IDLE_STAMINA_REGEN_AMOUNT > 0 &&
  PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC > 0
    ? {
        id: "idleStaminaRegen",
        requires: { idle: true },
        timing: { cadenceSec: PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC },
        effect: [
          {
            op: "AddToSystemState",
            target: { ref: "pawn" },
            system: "stamina",
            key: "cur",
            amount: PAWN_IDLE_STAMINA_REGEN_AMOUNT,
          },
          {
            op: "ClampSystemState",
            target: { ref: "pawn" },
            system: "stamina",
            key: "cur",
            min: 0,
            maxKey: "max",
          },
        ],
      }
    : null;

export const pawnDefs = {
  default: {
    id: "default",
    kind: "pawn",
    name: "Default Pawn",
    buildableStructureIds: ["granary", "ritualShrine", "storehouse"],
    systems: ["stamina", "hunger"],
    passives: [
      {
        id: "hungerDecay",
        timing: { cadenceSec: 2 },
        effect: [
          {
            op: "AddToSystemState",
            target: { ref: "pawn" },
            system: "hunger",
            key: "cur",
            amount: -1,
          },
          {
            op: "ClampSystemState",
            target: { ref: "pawn" },
            system: "hunger",
            key: "cur",
            min: 0,
            maxKey: "max",
          },
        ],
      },
      ...(idleStaminaRegenPassive ? [idleStaminaRegenPassive] : []),
    ],
    intents: [
      {
        id: "eat",
        verb: "eat",
        requires: { hungerAtMost: 50 },
        cost: {
          charges: [
            {
              kind: "tag",
              target: { ref: "pawnInv" },
              tag: "edible",
              amount: { const: 1 },
              allowDistributorPools: true,
              tierSystemId: "nourishment",
              tierValueByTier: {
                bronze: 20,
                silver: 30,
                gold: 40,
                diamond: 50,
              },
              outVar: "eatHungerGain",
            },
          ],
        },
        effect: [
          {
            op: "AddToSystemState",
            target: { ref: "pawn" },
            system: "hunger",
            key: "cur",
            amountVar: "eatHungerGain",
          },
          {
            op: "ClampSystemState",
            target: { ref: "pawn" },
            system: "hunger",
            key: "cur",
            min: 0,
            maxKey: "max",
          },
          /*
          {
            op: "AddToSystemState",
            target: { ref: "pawn" },
            system: "stamina",
            key: "cur",
            amount: 20,
          },
          {
            op: "ClampSystemState",
            target: { ref: "pawn" },
            system: "stamina",
            key: "cur",
            min: 0,
            maxKey: "max",
          },
          */
        ],
      },
    ],
  },
};
