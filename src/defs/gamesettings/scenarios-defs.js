// scenarios-defs.js - human-authored start scenarios (pure data)
import { INITIAL_POPULATION_DEFAULT } from "./gamerules-defs.js";
import { DEFAULT_VARIANT_FLAGS } from "./variant-flags-defs.js";

export const setupDefs = {
  devGym01: {
    rngSeed: 123,
    variantFlags: {
      ...DEFAULT_VARIANT_FLAGS,
    },

    resources: { gold: 0, grain: 0, food: 0, population: INITIAL_POPULATION_DEFAULT },

    // Optional dev-time UI bootstrap:
    // - openInventories: owner selectors opened/pinned on boot
    // - openSkillTree: false | true | leader pawn selector ({ type: "leaderPawn", index })
    // - openSkillTreeEditor: false | true | { treeId: "..." }

    devUi: {
      //openInventories: [{ type: "leaderPawn", pawnIndex: 1 }],
      //openInventories: [{ type: "hubStructure", hubCol: 0 }],
      //openSkillTree: true,
    },

    // Optional progression override:
    // - skillProgressionDefs: partial override of defaults from skill-tree-defs.js

    /*

    skillProgressionDefs: {
      defaultStartingSkillPoints: 6,
      startingSkillPointsByPawnDefId: {
        default: 6
      },
      defaultUnlockedRecipes: [
        "none",
      ],
      defaultUnlockedHubStructures: [
        "none"
      ],
      defaultUnlockedEnvTags: [
        "none"
      ],
      defaultUnlockedHubTags: [
        "rest"
      ],
    }, 

    */

    skillProgressionDefs: {
      defaultUnlockedFeatures: ["ui.chrome.yearTracker"],
    },

    board: {
      cols: 12,
      tiles: [
        "tile_hinterland",
        "tile_levee",
        "tile_floodplains",
        "tile_floodplains",
        "tile_wetlands",
        "tile_floodplains",
        "tile_river",
        "tile_wetlands",
        "tile_floodplains",
        "tile_floodplains",
        "tile_levee",
        "tile_hinterland",
      ],
    },

    // hub structures placed by hub column
    hub: {
      cols: 10,
      structures: [
        { defId: "itemzoo", hubCol: 0 },
        { defId: "mudHouses", hubCol: 3 },
        { defId: "hearth", hubCol: 5 },
        { defId: "storehouse", hubCol: 6 },

      ],
    },

    // pawns placed by board column
    pawns: [
      { name: "Pawn 1", 
        color: 0xff9999, 
        hubCol: 3, 
        role: "leader", 
        skillPoints: 30,
        unlockedSkillNodeIds: ["Memory","Astronomy", "Crafting", "Worship", "MudHouses", "Fish", "Forage", "Basket", "Cooking", "Hearth","LunarAstronomy","SolarAstronomy"],
      },
      { name: "Pawn 2", color: 0x9999ff, hubCol: 5, role: "leader" },
    ],

    // inventories keyed by owner selector:
    // owner: { type: "hubStructure", hubCol: 6 } means "hub structure at column 6"
    // owner: { type: "pawn", index: 0 } means "1st pawn in pawns array"
    inventories: [
      {
        owner: { type: "hubStructure", hubCol: 0 },
        // Item Zoo: one of each item (laid out with spacing to avoid overlap)
        items: [
          { kind: "barley", quantity: 1, gridX: 0, gridY: 0 },
          { kind: "wheat", quantity: 1, gridX: 2, gridY: 0 },
          { kind: "barleyPorridge", gridX: 4, gridY: 0 },
          { kind: "dates", gridX: 6, gridY: 0 },
          { kind: "rot", quantity: 1, gridX: 8, gridY: 0 },
          { kind: "flint", gridX: 10, gridY: 0 },
          { kind: "dung", gridX: 12, gridY: 0 },
          { kind: "dryVegetation", gridX: 14, gridY: 0 },
          { kind: "straw", gridX: 16, gridY: 0 },
          { kind: "stone", gridX: 18, gridY: 0 },
          { kind: "reeds", gridX: 20, gridY: 0 },
          { kind: "fibres", gridX: 22, gridY: 0 },
          { kind: "clay", gridX: 24, gridY: 0 },
          { kind: "silt", gridX: 26, gridY: 0 },
          { kind: "temper", gridX: 28, gridY: 0 },
          { kind: "testHat", gridX: 0, gridY: 3 },
          { kind: "testClothes", gridX: 2, gridY: 3 },
          { kind: "testWeapon", gridX: 4, gridY: 3 },
          { kind: "testOffhand", gridX: 6, gridY: 3 },
          { kind: "testRing", gridX: 8, gridY: 3 },
          { kind: "testRing", gridX: 10, gridY: 3 },
          { kind: "testAmulet", gridX: 12, gridY: 3 },
          { kind: "staminaRing", gridX: 14, gridY: 3 },
          { kind: "basket", gridX: 16, gridY: 3 },
        ],
      },
      {
        owner: { type: "hubStructure", hubCol: 3 },
        items: [
          { kind: "wheat", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 2, gridY: 0 },
          { kind: "barley", quantity: 15, gridX: 0, gridY: 2 },
          { kind: "roastedBarley", quantity: 25, gridX: 2, gridY: 3 },
          { kind: "roastedBarley", quantity: 25, gridX: 2, gridY: 4 },
          { kind: "roastedBarley", quantity: 25, gridX: 2, gridY: 5 },
          { kind: "roastedBarley", quantity: 25, gridX: 2, gridY: 6 },
          { kind: "roastedBarley", quantity: 25, gridX: 3, gridY: 3 },
          { kind: "roastedBarley", quantity: 25, gridX: 3, gridY: 4 },
          { kind: "roastedBarley", quantity: 25, gridX: 3, gridY: 5 },
          { kind: "roastedBarley", quantity: 25, gridX: 3, gridY: 6 },
          { kind: "barleyPorridge", gridX: 0, gridY: 9 },
          { kind: "barleyPorridge", gridX: 2, gridY: 9 },
          { kind: "barleyPorridge", gridX: 0, gridY: 8 },
          { kind: "barleyPorridge", gridX: 2, gridY: 8 },
        ],
      },
      {
        owner: { type: "pawn", index: 0 },
        items: [
          { kind: "reeds", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
          { kind: "straw", quantity: 20, gridX: 2, gridY: 0 },
          { kind: "stone", quantity: 5, gridX: 3, gridY: 0 },
        ],
      },
      {
        owner: { type: "pawn", index: 1 },
        items: [
          { kind: "wheat", quantity: 20, gridX: 0, gridY: 0 },
          { kind: "barley", quantity: 20, gridX: 1, gridY: 0 },
        ],
      },
    ],
  },

  devPlaytesting01: {
    variantFlags: {
      ...DEFAULT_VARIANT_FLAGS,
      actionPointCostsEnabled: false,
      actionLogEnabled: false,
      inventoryTransferPlannerEnabled: false,
      inventoryTransferGhostPreviewEnabled: false,
      showApHud: false,
    },

    skillProgressionDefs: {
      defaultStartingSkillPoints: 6,
      startingSkillPointsByPawnDefId: {
        default: 6
      },
      defaultUnlockedRecipes: [
        "none",
      ],
      defaultUnlockedHubStructures: [
        "none"
      ],
      defaultUnlockedEnvTags: [
        "explore",
        "delve"
      ],
      defaultUnlockedHubTags: [
        "canRest", "build", "canHouse"
      ],
    }, 

    rngSeed: 123,

    resources: { gold: 0, grain: 0, food: 0, population: 0 },

    locationNames: {
      hub: "Ancient Ruins",
    },

    discovery: {
      envCols: [
        { exposed: true, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
        { exposed: false, revealed: false },
      ],
      hubVisible: false,
      hubRenameUnlocked: false,
    },

    board: {
      cols: 12,
      tiles: [
        { defId: "tile_hinterland", tags: ["explore", "forageable", "herdable"] },
        { defId: "tile_levee", tags: ["explore", "delve", "forageable"] },
        { defId: "tile_wetlands", tags: ["explore", "forageable", "fishable"] },
        { defId: "tile_floodplains", tags: ["explore", "farmable", "forageable"] },
        { defId: "tile_floodplains", tags: ["explore", "farmable", "forageable"] },
        { defId: "tile_floodplains", tags: ["explore", "farmable", "forageable"] },
        { defId: "tile_river", tags: ["explore", "fishable"] },
        { defId: "tile_floodplains", tags: ["explore", "farmable", "forageable"] },
        { defId: "tile_floodplains", tags: ["explore", "farmable", "forageable"] },
        { defId: "tile_wetlands", tags: ["explore", "forageable", "fishable"] },
        { defId: "tile_levee", tags: ["explore", "forageable"] },
        { defId: "tile_hinterland", tags: ["explore", "forageable", "herdable"] },
      ],
      envStructures: [{ defId: "ancientRuins", col: 1 }],
    },

    hub: {
      cols: 10,
      structures: [
        {
          defId: "templeRuins",
          hubCol: 4,
          tags: ["build"],
          systemTiers: {
            build: "bronze",
          },
          systemState: {
            build: {
              processes: [
                {
                  id: "proc_templeRuins_rebuild_0",
                  type: "build",
                  mode: "work",
                  startSec: 0,
                  durationSec: 5,
                  progress: 0,
                  completionPolicy: "build",
                  buildKind: "hubStructure",
                  buildDefId: "makeshiftShelter",
                  requirements: [],
                  preserveStructureTitle: true,
                  allowCancel: false,
                  completionEffects: [
                    { op: "SetLocationName", area: "hub", name: "Hub" },
                    { op: "SetDiscoveryState", key: "hubRenameUnlocked", value: true },
                  ],
                },
              ],
            },
          },
        },
      ],
    },

    pawns: [
      { name: "Pawn 1", 
        color: 0xff9999, 
        envCol: 0, 
        role: "leader", 
        skillPoints: 0,
        //unlockedSkillNodeIds: ["Astronomy", "Crafting", "Worship", "MudHouses", "Fish", "Forage", "Basket", "Cooking", "Hearth"]
        unlockedSkillNodeIds: [""]
      },
      //{ name: "Pawn 2", color: 0x9999ff, hubCol: 3, role: "leader" },
    ],

    inventories: [
      {
        owner: { type: "hubStructure", hubCol: 4 },
        items: [
          { kind: "moteOfEternity", quantity: 1, gridX: 0, gridY: 0 },
          { kind: "mysteriousAncientTome", quantity: 1, gridX: 1, gridY: 0 },
        ],
      },
      {
        owner: { type: "pawn", index: 0 },
        items: [],
      },
    ],
  },
};
