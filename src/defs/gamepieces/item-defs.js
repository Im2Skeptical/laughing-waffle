// --- Items (inventory things) ---
// Item defs are data-only. Behavior lives in itemTagDefs + itemSystemDefs.

export const itemDefs = {
  barley: {
    id: "barley",
    name: "Barley",
    color: 0xd4b45a,
    maxStack: 25,
    baseTags: ["edible", "crop", "currency", "rotatable", "grain"],
    baseSystemTiers: { freshness: "bronze" },
    rotChancePerSec: 0.0057,
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
  wheat: {
    id: "wheat",
    name: "Wheat",
    color: 0xdaa520,
    maxStack: 25,
    baseTags: ["edible", "crop", "currency", "rotatable", "grain"],
    baseSystemTiers: { freshness: "bronze" },
    rotChancePerSec: 0.0057,
    defaultWidth: 1,
    defaultHeight: 2,
    defaultTier: "bronze",
    ui: {
      title: "Wheat",
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
    color: 0xccc08f,    //#ccc08f
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
  dates: {
    id: "dates",
    name: "Dates",
    color: 0x8b4513,
    maxStack: 1,
    baseTags: ["edible"],
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      title: "Dates",
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

  // forageables

  flint: {
    id: "flint",
    name: "Flint",
    color: 0x808080,  //#808080
    maxStack: 1,
    baseTags: ["firematerials"],
    defaultWidth: 1,
    defaultHeight: 2,
    ui: {
      title: "Flint",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  dung: {
    id: "dung",
    name: "Dung",
    color: 0x2a2b1d,  //#2a2b1d
    maxStack: 1,
    baseTags: ["firematerials"],
    defaultWidth: 1,
    defaultHeight: 2,
    ui: {
      title: "Dung",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  dryVegetation: {
    id: "dryVegetation",
    name: "Dry Vegetation",
    color: 0x4f4a41,  //#4f4a41
    maxStack: 1,
    maxStack: 1,
    baseTags: ["firematerials"],
    defaultWidth: 1,
    defaultHeight: 2,
    ui: {
      title: "Dry Vegetation",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  straw: {
    id: "straw",
    name: "Straw",
    color: 0xe2cc4b,  //#e2cc4b
    maxStack: 1,
    baseTags: ["firematerials"],
    defaultWidth: 1,
    defaultHeight: 2,
    ui: {
      title: "Straw",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  stone: {
    id: "stone",
    name: "Stone",
    color: 0x595959,  //#595959
    maxStack: 1,
    baseTags: ["firematerials"],
    defaultWidth: 1,
    defaultHeight: 2,
    ui: {
      title: "Stone",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  reeds: {
    id: "reeds",
    name: "Reeds",
    color: 0x75963f,  //#75963f
    maxStack: 1,
    baseTags: ["crafting"],
    defaultWidth: 1,
    defaultHeight: 2,
    ui: {
      title: "Reeds",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  fibres: {
    id: "fibres",
    name: "Fibres",
    color: 0x67794b,  //#67794b  
    maxStack: 1,
    baseTags: ["crafting"],
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      title: "Fibres",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  clay: {
    id: "clay",
    name: "Clay",
    color: 0x8b4513,  //#8b4513
    maxStack: 1,
    baseTags: ["crafting"],
    defaultWidth: 2,
    defaultHeight: 2,
    ui: {
      title: "Clay",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  silt: {
    id: "silt",
    name: "Silt",
    color: 0x6a4e25,  //#6a4e25
    maxStack: 1,
    baseTags: ["crafting"],
    defaultWidth: 2,
    defaultHeight: 2,
    ui: {
      title: "Silt",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  temper: {
    id: "temper",
    name: "Temper",
    color: 0xdccebb,  //#dccebb
    maxStack: 1,
    baseTags: ["crafting"],
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      title: "Temper",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
};
