// --- Items (inventory things) ---

export const itemDefs = {
  barley: {
    id: "barley",
    name: "Barley",
    color: 0xd4b45a,
    maxStack: 25,
    tags: ["edible", "crop", "currency"],
    defaultWidth: 1,
    defaultHeight: 2,
    defaultTier: "bronze",
    ui: {
      title: "Barley",
      lines: [
        (item, ctx) => `Item id: ${item.id}`,
        (item, ctx) => `Owner: ${ctx.ownerLabel}`,
        (item) => `Quantity: ${item.quantity}`,
        (item) => `Tier: ${item.tier ?? "bronze"}`,
      ],
    },
  },
  grain: {
    id: "grain",
    name: "Grain",
    color: 0xdaa520,
    maxStack: 25,
    tags: ["edible", "currency"],
    defaultWidth: 1,
    defaultHeight: 2,
    passives: [
      {
        id: "grainDecay",
        timing: { cadenceSec: 1 },
        effect: {
          op: "ExpireItemChance",
          chance: 0.0057,
          targetKind: "rot",
        },
      },
      {
        id: "grainSeasonExpiry",
        timing: { onSeasonChange: true },
        effect: { op: "TickItemSeasonExpiry", targetKind: "rot" },
      },
    ],
    ui: {
      title: "Grain",
      lines: [
        (item, ctx) => `Item id: ${item.id}`,
        (item, ctx) => `Owner: ${ctx.ownerLabel}`,
        (item) => `Quantity: ${item.quantity}`,
        (item) => `Size: ${item.width}Į-${item.height}`,
        (item) => item.seasonsToExpire != null
          ? `Seasons to rot: ${item.seasonsToExpire}`
          : "",
      ],
    },
  },

  rot: {
    id: "rot",
    name: "Rot",
    color: 0x6b4f3f,
    maxStack: 999,
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      title: "Rot",
      lines: [
        (item, ctx) => `Item id: ${item.id}`,
        (item, ctx) => `Owner: ${ctx.ownerLabel}`,
        (item) => `Quantity: ${item.quantity}`,
        (item) => `Size: ${item.width}Į-${item.height}`,
        "Rotting organic matter. No current use.",
      ],
    },
  },
};
