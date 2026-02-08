// --- Items (inventory things) ---
// Item defs are data-only. Behavior lives in itemTagDefs + itemSystemDefs.

export const itemDefs = {
  barley: {
    id: "barley",
    name: "Barley",
    color: 0xd4b45a,
    maxStack: 25,
    baseTags: ["edible", "seed", "currency", "perishable", "grain"],
    baseSystemTiers: { perishability: "bronze" },
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
  roastedBarley: {
    id: "roastedBarley",
    name: "Roasted Barley",
    color: 0xcaa15a,
    maxStack: 25,
    baseTags: ["edible"],
    defaultWidth: 1,
    defaultHeight: 1,
    defaultTier: "bronze",
    ui: {
      title: "Roasted Barley",
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
    baseTags: ["edible", "seed", "currency", "perishable", "grain"],
    baseSystemTiers: { perishability: "bronze" },
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
    color: 0x842e20,  //#842e20
    maxStack: 20,
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
    maxStack: 5,
    baseTags: ["firematerials"],
    defaultWidth: 1,
    defaultHeight: 1,
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
    maxStack: 10,
    baseTags: ["firematerials"],
    defaultWidth: 2,
    defaultHeight: 1,
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
    maxStack: 20,
    baseTags: ["firematerials"],
    defaultWidth: 1,
    defaultHeight: 1,
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
    maxStack: 25,
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
    maxStack: 5,
    baseTags: ["firematerials"],
    defaultWidth: 2,
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
    maxStack: 25,
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
  basket: {
    id: "basket",
    name: "Basket",
    color: 0x9b7a4a,
    maxStack: 1,
    baseTags: [],
    defaultWidth: 2,
    defaultHeight: 2,
    defaultTier: "bronze",
    ui: {
      title: "Basket",
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
    maxStack: 25,
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
    maxStack: 10,
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
    maxStack: 10,
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
    maxStack: 25,
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
  feathers: {
    id: "feathers",
    name: "Feathers",
    color: 0x5b5550,  //#5b5550
    maxStack: 15,
    baseTags: ["crafting"],
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      title: "Feathers",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  eggs: {
    id: "eggs",
    name: "Eggs",
    color: 0xf4f4b3,  //#f4f4b3
    maxStack: 12,
    baseTags: ["edible"],
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      title: "Eggs",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
      ],
    },
  },
  testHat: {
    id: "testHat",
    name: "Test Hat",
    color: 0x7f95b8,
    maxStack: 1,
    baseTags: ["wearable"],
    baseSystemTiers: { wearable: "bronze" },
    baseSystemState: { wearable: { slot: "head" } },
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      shortLabel: "H",
      title: "Test Hat",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Slot: Head",
      ],
    },
  },
  testClothes: {
    id: "testClothes",
    name: "Test Clothes",
    color: 0x7d8664,
    maxStack: 1,
    baseTags: ["wearable"],
    baseSystemTiers: { wearable: "bronze" },
    baseSystemState: { wearable: { slot: "chest" } },
    defaultWidth: 2,
    defaultHeight: 3,
    ui: {
      shortLabel: "C",
      title: "Test Clothes",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Slot: Chest",
      ],
    },
  },
  testWeapon: {
    id: "testWeapon",
    name: "Test Weapon",
    color: 0x7a5f52,
    maxStack: 1,
    baseTags: ["wearable"],
    baseSystemTiers: { wearable: "bronze" },
    baseSystemState: { wearable: { slot: "mainHand" } },
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      shortLabel: "W",
      title: "Test Weapon",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Slot: Main Hand",
      ],
    },
  },
  testOffhand: {
    id: "testOffhand",
    name: "Test Offhand",
    color: 0x516e86,
    maxStack: 1,
    baseTags: ["wearable"],
    baseSystemTiers: { wearable: "bronze" },
    baseSystemState: { wearable: { slot: "offHand" } },
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      shortLabel: "O",
      title: "Test Offhand",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Slot: Off Hand",
      ],
    },
  },
  testRing: {
    id: "testRing",
    name: "Test Ring",
    color: 0xb1985a,
    maxStack: 1,
    baseTags: ["wearable"],
    baseSystemTiers: { wearable: "bronze" },
    baseSystemState: { wearable: { slot: "ring" } },
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      shortLabel: "R",
      title: "Test Ring",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Slot: Ring",
      ],
    },
  },
  staminaRing: {
    id: "staminaRing",
    name: "Stamina Ring",
    color: 0xc3a23d,
    maxStack: 1,
    baseTags: ["wearable"],
    baseSystemTiers: { wearable: "bronze" },
    baseSystemState: { wearable: { slot: "ring" } },
    passives: [
      {
        id: "staminaRegenEquipped",
        timing: { cadenceSec: 1 },
        effect: [
          {
            op: "AddToSystemState",
            target: { ref: "pawn" },
            system: "stamina",
            key: "cur",
            amount: 10,
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
      },
    ],
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      shortLabel: "S",
      title: "Stamina Ring",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Slot: Ring",
        "Passive: +10 stamina regen while equipped.",
      ],
    },
  },
  testAmulet: {
    id: "testAmulet",
    name: "Test Amulet",
    color: 0x6fa089,
    maxStack: 1,
    baseTags: ["wearable"],
    baseSystemTiers: { wearable: "bronze" },
    baseSystemState: { wearable: { slot: "amulet" } },
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      shortLabel: "A",
      title: "Test Amulet",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Slot: Amulet",
      ],
    },
  },
};
