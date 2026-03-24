// --- Items (inventory things) ---
// Item defs are data-only. Behavior lives in itemTagDefs + itemSystemDefs.

import {
  SCROLL_GRAPH_DEFAULT_HISTORY_WINDOW_SEC,
  SCROLL_GRAPH_DEFAULT_HORIZON_SEC,
  SCROLL_GRAPH_SUBJECT_DEFS,
  SCROLL_GRAPH_SUBJECT_IDS,
  SCROLL_GRAPH_TYPE_DEFS,
  SCROLL_GRAPH_TYPE_IDS,
  buildScrollTimegraphState,
  makeScrollItemKind,
} from "./scroll-timegraph-defs.js";
import { ensureTooltipCardUi } from "../tooltip-ui-utils.js";

export const SCROLL_TIMEGRAPH_DEFAULT_HORIZON_SEC =
  SCROLL_GRAPH_DEFAULT_HORIZON_SEC;
export const SCROLL_TIMEGRAPH_DEFAULT_HISTORY_WINDOW_SEC =
  SCROLL_GRAPH_DEFAULT_HISTORY_WINDOW_SEC;

const SCROLL_TYPE_COLORS = {
  prophecy: 0x5678a8,
  almanac: 0x4f8f76,
  record: 0x8f6643,
  history: 0x6d5a8f,
  scripture: 0x8c5066,
};

const scrollItemDefs = {};
for (const typeId of SCROLL_GRAPH_TYPE_IDS) {
  const typeDef = SCROLL_GRAPH_TYPE_DEFS[typeId];
  if (!typeDef) continue;
  for (const subjectId of SCROLL_GRAPH_SUBJECT_IDS) {
    const subjectDef = SCROLL_GRAPH_SUBJECT_DEFS[subjectId];
    if (!subjectDef) continue;

    const kind = makeScrollItemKind(typeId, subjectId);
    const graphState = buildScrollTimegraphState(typeId, subjectId);
    if (!graphState) continue;

    scrollItemDefs[kind] = {
      id: kind,
      name: `${subjectDef.name} ${typeDef.name}`,
      color: SCROLL_TYPE_COLORS[typeId] ?? subjectDef.color ?? 0x777777,
      maxStack: 1,
      baseTags: ["crafting"],
      baseSystemTiers: { timegraph: "bronze" },
      baseSystemState: { timegraph: graphState },
      defaultWidth: 1,
      defaultHeight: 2,
      defaultTier: "bronze",
      ui: {
        shortLabel: `${typeDef.shortLabel}-${subjectDef.shortLabel}`,
        title: `${subjectDef.name} ${typeDef.name}`,
        lines: [
          "Item id: {id}",
          "Owner: {ownerLabel}",
          "Quantity: {quantity}",
          "Type: " + typeDef.name,
          "Subject: " + subjectDef.name,
          "Click or tap to open/close this timegraph.",
        ],
      },
    };
  }
}

export const itemDefs = {
  barley: {
    id: "barley",
    name: "Barley",
    color: 0xd4b45a,
    maxStack: 25,
    baseTags: ["seed", "currency", "perishable", "grain"],
    baseSystemTiers: { perishability: "silver" },
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
    baseTags: ["edible", "perishable"],
    baseSystemTiers: { perishability: "bronze" },
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
    baseTags: ["seed", "currency", "perishable", "grain"],
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
    baseTags: ["edible","perishable"],
    baseSystemTiers: { perishability: "silver" },
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
  smallFish: {
    id: "smallFish",
    name: "Small Fish",
    color: 0x6ba4d9,
    maxStack: 2,
    baseTags: ["edible", "perishable"],
    baseSystemTiers: { perishability: "bronze" },
    defaultWidth: 2,
    defaultHeight: 1,
    defaultTier: "bronze",
    ui: {
      title: "Small Fish",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Tier: {tier}",
      ],
    },
  },
  mediumFish: {
    id: "mediumFish",
    name: "Medium Fish",
    color: 0x4f89bf,
    maxStack: 2,
    baseTags: ["edible", "perishable"],
    baseSystemTiers: { perishability: "bronze" },
    defaultWidth: 3,
    defaultHeight: 1,
    defaultTier: "bronze",
    ui: {
      title: "Medium Fish",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Tier: {tier}",
      ],
    },
  },
  largeFish: {
    id: "largeFish",
    name: "Large Fish",
    color: 0x3d6f9e,
    maxStack: 1,
    baseTags: ["perishable"],
    baseSystemTiers: { perishability: "bronze" },
    defaultWidth: 3,
    defaultHeight: 2,
    defaultTier: "bronze",
    ui: {
      title: "Large Fish",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Tier: {tier}",
      ],
    },
  },
  rareFish: {
    id: "rareFish",
    name: "Rare Fish",
    color: 0x5ea0d6,
    maxStack: 1,
    baseTags: ["edible", "perishable"],
    baseSystemTiers: { perishability: "bronze" },
    defaultWidth: 2,
    defaultHeight: 2,
    defaultTier: "diamond",
    ui: {
      title: "Rare Fish",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Tier: {tier}",
      ],
    },
  },
  roastedSmallFish: {
    id: "roastedSmallFish",
    name: "Roasted Small Fish",
    color: 0xbd8a57,
    maxStack: 10,
    baseTags: ["edible", "perishable"],
    baseSystemTiers: { perishability: "bronze" },
    defaultWidth: 1,
    defaultHeight: 1,
    defaultTier: "bronze",
    ui: {
      title: "Roasted Small Fish",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Tier: {tier}",
      ],
    },
  },
  roastedMediumFish: {
    id: "roastedMediumFish",
    name: "Roasted Medium Fish",
    color: 0xa8794c,
    maxStack: 8,
    baseTags: ["edible", "perishable"],
    baseSystemTiers: { perishability: "bronze" },
    defaultWidth: 1,
    defaultHeight: 2,
    defaultTier: "silver",
    ui: {
      title: "Roasted Medium Fish",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Tier: {tier}",
      ],
    },
  },
  roastedLargeFish: {
    id: "roastedLargeFish",
    name: "Roasted Large Fish",
    color: 0x8f633f,
    maxStack: 4,
    baseTags: ["edible", "perishable"],
    baseSystemTiers: { perishability: "bronze" },
    defaultWidth: 2,
    defaultHeight: 2,
    defaultTier: "gold",
    ui: {
      title: "Roasted Large Fish",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Tier: {tier}",
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
    baseTags: ["wearable", "portableStorage"],
    baseSystemTiers: { wearable: "bronze", storage: "bronze" },
    baseSystemState: { wearable: { slot: "offHand" } },
    poolProviders: [
      {
        systemId: "storage",
        poolKey: "byKindTier",
        requires: { equipped: true },
      },
    ],
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
        "Slot: Off Hand",
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
  mysteriousAncientTome: {
    id: "mysteriousAncientTome",
    name: "Mysterious Ancient Tome",
    color: 0x8c78d0,  //#8c78d0
    maxStack: 1,
    baseTags: ["unique"],
    defaultTier: "silver",
    defaultWidth: 2,
    defaultHeight: 2,
    onUse: [
      {
        op: "GrantSkillNode",
        target: { ref: "pawn" },
        nodeId: "Memory",
        ignoreCost: true,
        ignoreAdjacency: true,
        ignoreRequirements: true,
      },
      {
        op: "AddSkillPoints",
        target: { ref: "pawn" },
        amount: 4,
      },
      {
        op: "RemoveItem",
      },
    ],
    ui: {
      title: "Mysterious Ancient Tome",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Size: {width}x{height}",
        "Tap to read while paused.",
        "Grants Memory +4 skill points, then vanishes.",
      ],
    },
  },
  moteOfEternity: {
    id: "moteOfEternity",
    name: "Mote of Eternity",
    color: 0x8c78d0,  //#8c78d0
    maxStack: 1,
    baseTags: ["unique"],
    defaultTier: "diamond",
    baseSystemTiers: { timegraph: "bronze" },
    baseSystemState: {
      timegraph: {
        version: 1,
        scrollType: "scripture",
        subject: "systems",
        metricId: null,
        scrollName: "Mote of Eternity",
        subjectName: "Systems",
        windowMode: "absoluteEditableProjection",
        anchoredToManufacture: true,
        requiresManufacturedSec: false,
        manufacturedSec: 0,
        horizonSec: 300,
        historyWindowSec: 300,
        frozen: false,
        editable: true,
        editableRangeMode: "absolute",
        editableRangeStartSec: 0,
        editableRangeEndSec: 300,
        systemTargetModeOnOpen: "inventoryOwnerLocked",
        eventMarkerModeOnOpen: "leaderFaith",
      },
    },
    onUseRequires: {
      timegraphWindowPast: true,
    },
    onGraphOpen: [
      {
        op: "GrantUnlock",
        unlockType: "feature",
        unlockId: "ui.chrome.yearTracker",
      },
    ],
    onUse: [
      {
        op: "AddSkillPointsIfSkillNodeUnlocked",
        target: { ref: "pawn" },
        nodeId: "LunarAstronomy",
        amount: 4,
      },
      {
        op: "GrantSkillNode",
        target: { ref: "pawn" },
        nodeId: "LunarAstronomy",
        ignoreCost: true,
        ignoreAdjacency: true,
        ignoreRequirements: true,
      },
      {
        op: "SpawnItem",
        target: { ref: "selfInv" },
        itemKind: "ringOfEternity",
        amount: 1,
      },
      {
        op: "RemoveItem",
      },
    ],
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      title: "Mote of Eternity",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        (_, ctx) =>
          ctx?.timegraphWindowPast
            ? "A fragment of eternity. It's glow has dimmed"
            : "A fragment of eternity glowing with power",
        "Editable range: 0-240s",
        "Projection horizon: 240s",
        (_, ctx) =>
          ctx?.timegraphWindowPast
            ? "Tap to consume it."
            : "Reveals to future of the owner. Drag into your inventory then click or tap to open/close this timegraph.",
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
        requires: { equipped: true },
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
  ringOfEternity: {
    id: "ringOfEternity",
    name: "Ring of Eternity",
    color: 0x9f8be0,
    maxStack: 1,
    baseTags: ["wearable", "unique"],
    baseSystemTiers: { wearable: "bronze" },
    baseSystemState: { wearable: { slot: "ring" } },
    equippedEffects: [
      {
        op: "AddModifier",
        scope: "global",
        key: "editableHistoryWindowBonusSec",
        amount: 5,
      },
    ],
    defaultWidth: 1,
    defaultHeight: 1,
    ui: {
      shortLabel: "E",
      title: "Ring of Eternity",
      lines: [
        "Item id: {id}",
        "Owner: {ownerLabel}",
        "Quantity: {quantity}",
        "Slot: Ring",
        "Equipped: +5s editable history window.",
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
  ...scrollItemDefs,
};

ensureTooltipCardUi(itemDefs);
