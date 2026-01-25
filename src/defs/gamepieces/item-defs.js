// --- Items (inventory things) ---
// Item defs are data-only. Behavior lives in itemTagDefs + itemSystemDefs.

export const itemDefs = {
  barley: {
    id: "barley",
    name: "Barley",
    color: 0xd4b45a,
    maxStack: 25,
    baseTags: ["edible", "crop", "currency", "rotatable"],
    baseSystemTiers: { freshness: "bronze" },
    defaultWidth: 1,
    defaultHeight: 2,
    defaultTier: "bronze",
    ui: {
      title: "Barley",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Tier: {tier}",
      ],
    },
  },
  grain: {
    id: "grain",
    name: "Grain",
    color: 0xdaa520,
    maxStack: 25,
    baseTags: ["crop", "currency", "rotatable"],
    baseSystemTiers: { freshness: "bronze" },
    defaultWidth: 1,
    defaultHeight: 2,
    ui: {
      title: "Grain",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  barleyPorridge: {
    id: "barleyPorridge",
    name: "Barley Porridge",
    color: 0x8b4513,
    maxStack: 1,
    baseTags: ["edible"],
    defaultWidth: 2,
    defaultHeight: 1,
    ui: {
      title: "Barley Porridge",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  rot: {
    id: "rot",
    name: "Rot",
    color: 0x6b4f3f,
    maxStack: 999,
    baseTags: ["rot", "rotted"],
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      title: "Rot",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
        "Rotting organic matter. No current use.",
      ],
    },
  },
};