// skill-tree-defs.js
// Data-driven skill trees and progression defaults.

export const skillProgressionDefs = {
  defaultStartingSkillPoints: 6,
  startingSkillPointsByPawnDefId: {
    default: 6,
  },
  defaultUnlockedRecipes: ["roastBarley"],
  defaultUnlockedHubStructures: ["granary"],
};
/*
export const skillTrees = {
  survivorCore: {
    id: "survivorCore",
    name: "Survivor Core",
    startNodeId: "skill_start",
    ui: {
      accentColor: 0x80d8ff,
    },
  },
};

export const skillNodes = {
  skill_start: {
    id: "skill_start",
    treeId: "survivorCore",
    name: "Camp Basics",
    desc: "Foundational camp instincts.",
    cost: 1,
    adjacent: ["skill_forage_training", "skill_rest_posture", "skill_farm_hands"],
    uiPos: { x: 120, y: 330 },
    effects: {
      globalMods: { apCapBonus: 5 },
    },
  },
  skill_forage_training: {
    id: "skill_forage_training",
    treeId: "survivorCore",
    name: "Foraging Drills",
    desc: "Foraging actions cost less stamina.",
    cost: 1,
    adjacent: ["skill_start", "skill_projection_planning", "skill_cook_unlock"],
    effects: {
      characterMods: { forageStaminaCostDelta: -1 },
    },
  },
  skill_rest_posture: {
    id: "skill_rest_posture",
    treeId: "survivorCore",
    name: "Rest Posture",
    desc: "Resting is more efficient.",
    cost: 1,
    adjacent: ["skill_start", "skill_rationing", "skill_craft_unlock"],
    effects: {
      characterMods: { restStaminaBonusMult: 1.1 },
    },
  },
  skill_farm_hands: {
    id: "skill_farm_hands",
    treeId: "survivorCore",
    name: "Farm Hands",
    desc: "Planting and harvesting cost less stamina.",
    cost: 1,
    adjacent: ["skill_start", "skill_ap_mastery", "skill_storehouse_unlock"],
    effects: {
      characterMods: { farmingStaminaCostDelta: -1 },
    },
  },
  skill_projection_planning: {
    id: "skill_projection_planning",
    treeId: "survivorCore",
    name: "Forecasting",
    desc: "See farther into projected futures.",
    cost: 1,
    adjacent: ["skill_forage_training", "skill_foresight"],
    effects: {
      globalMods: { projectionHorizonBonusSec: 20 },
    },
  },
  skill_rationing: {
    id: "skill_rationing",
    treeId: "survivorCore",
    name: "Rationing",
    desc: "Population consumes less food each season.",
    cost: 1,
    adjacent: ["skill_rest_posture", "skill_foresight"],
    effects: {
      globalMods: { populationFoodMult: 0.9 },
    },
  },
  skill_cook_unlock: {
    id: "skill_cook_unlock",
    treeId: "survivorCore",
    name: "Hearth Workflow",
    desc: "Unlocks stronger cooking workflow.",
    cost: 1,
    adjacent: ["skill_forage_training", "skill_granary_mastery"],
    effects: {
      unlocks: { recipes: ["roastBarley"] },
    },
  },
  skill_craft_unlock: {
    id: "skill_craft_unlock",
    treeId: "survivorCore",
    name: "Basket Weaving",
    desc: "Unlocks basket crafting recipes.",
    cost: 1,
    adjacent: ["skill_rest_posture", "skill_storehouse_unlock"],
    effects: {
      unlocks: { recipes: ["weaveBasket"] },
    },
  },
  skill_storehouse_unlock: {
    id: "skill_storehouse_unlock",
    treeId: "survivorCore",
    name: "Storehouse Plans",
    desc: "Unlocks Storehouse construction.",
    cost: 1,
    adjacent: ["skill_farm_hands", "skill_craft_unlock", "skill_granary_mastery"],
    effects: {
      unlocks: { hubStructures: ["storehouse"] },
    },
  },
  skill_granary_mastery: {
    id: "skill_granary_mastery",
    treeId: "survivorCore",
    name: "Granary Mastery",
    desc: "Improves large-scale storage planning.",
    cost: 1,
    adjacent: ["skill_cook_unlock", "skill_storehouse_unlock", "skill_ap_mastery"],
    effects: {
      globalMods: { apCapBonus: 5 },
    },
  },
  skill_ap_mastery: {
    id: "skill_ap_mastery",
    treeId: "survivorCore",
    name: "Action Rhythm",
    desc: "Increases action point capacity.",
    cost: 1,
    adjacent: ["skill_farm_hands", "skill_granary_mastery", "skill_foresight"],
    effects: {
      globalMods: { apCapBonus: 10 },
    },
  },
  skill_foresight: {
    id: "skill_foresight",
    treeId: "survivorCore",
    name: "Foresight",
    desc: "Further increases projection horizon.",
    cost: 1,
    adjacent: ["skill_projection_planning", "skill_rationing", "skill_ap_mastery"],
    //uiPos: { x: 1580, y: 330 },
    requirements: {
      requiredNodeIds: ["skill_projection_planning"],
    },
    effects: {
      globalMods: { projectionHorizonBonusSec: 25 },
    },
  },
};
*/

/* ========================================================================
REFERENCE (commented): Existing skill tree defs for affordances/effects shape.
Source: skill-tree-defs.js :contentReference[oaicite:1]{index=1}
===========================================================================
export const skillProgressionDefs = { ... };
export const skillTrees = { ... };
export const skillNodes = { ... };
=========================================================================== */

/**
 * ========================================================================
 * SPATIAL MAP MOCK: "System Color Map"
 * Pure data, ~100 nodes, ring + cluster + hybrid bands.
 *
 * Quadrants (per your diagram):
 * - Blue  : Projection (Deferred / Exploit)
 * - Green : Automation (Deferred / Preserve)
 * - Black : Control (Immediate / Exploit)
 * - Red   : Force (Immediate / Preserve)
 *
 * Naming:
 * - <Color><Tier>_<NN> e.g. BlueEarly_01
 * - <Color><Tier>_Notable
 * - Hybrids: BlueGreenEarly_01, etc
 * - A few Mid hybrid notables to anchor bridges
 * ========================================================================
 */

export const skillTrees = {
  systemColorMap: {
    id: "systemColorMap",
    name: "System Color Map",
    startNodeId: "core_origin",
    ui: {
      accentColor: 0xffffff,
      layoutMode: "ringByTags",
      nodeSizes: {
        defaultRadius: 12,
        notableRadius: 24,
      },
      ringLayout: {
        ringOrder: ["core", "ring_01", "ring_02", "ring_03", "ring_04", "ring_05", "ring_06", "ring_07", "ring_08", "ring_09", "early", "mid", "late" ],
        radii: {
          core: 0,
          ring_01: 200,
          ring_02: 300,
          ring_03: 400,
          early: 500,
          ring_04: 600,
          ring_05: 700,
          ring_06: 800,
          mid: 900,
          ring_07: 1000,
          ring_08: 1100,
          ring_09: 1200,
          late: 1200,
        },
        // Widen wedge spans slightly for dense sectors.
        wedgeSpansDeg: {
          Blue: 40,
          Green: 40,
          Red: 40,
          Black: 40,
          BlueGreen: 20,
          GreenRed: 20,
          RedBlack: 20,
          BlackBlue: 20,
        },
        barycenterIterations: 8,
        localSwapIterations: 3,
        overlapIterations: 4,
        overlapPaddingPx: 8,
        radialNudgeIterations: 10,
        radialNudgeMaxPx: 50,
        radialNudgePaddingPx: 120,
        radialNudgeSpring: 0.2,
      },
    },
  },
};

export const skillNodes = {
  // --------------------------------------------------
  // ORIGIN
  // --------------------------------------------------
  core_origin: {
    id: "core_origin",
    treeId: "systemColorMap",
    name: "Origin",
    desc: "Undifferentiated system state.",
    cost: 0,
    tags: ["Core"],
    adjacent: ["BlueEarly_01", "GreenEarly_01", "BlackEarly_01", "RedEarly_01", "BlueEarly_02", "GreenEarly_02", "BlackEarly_02", "RedEarly_02"],
    uiNodeRadius: 28,
    effects: {},
  },

  // ==================================================
  // BLUE (Projection)
  // ==================================================
  BlueEarly_01: { id: "BlueEarly_01", ringId: "ring_01", treeId: "systemColorMap", name: "BlueNodeEarly_01", desc: "Early ring.", cost: 1, tags: ["Blue", "Early"], adjacent: ["core_origin", "BlueEarly_03"], effects: {} },
  BlueEarly_02: { id: "BlueEarly_02", ringId: "ring_01", treeId: "systemColorMap", name: "BlueNodeEarly_02", desc: "Early ring.", cost: 1, tags: ["Blue", "Early"], adjacent: ["core_origin", "BlueEarly_04"], effects: {} },
  BlueEarly_03: { id: "BlueEarly_03", ringId: "ring_01", treeId: "systemColorMap", name: "BlueNodeEarly_03", desc: "Early ring.", cost: 1, tags: ["Blue", "Early"], adjacent: ["BlueEarly_01", "BlueEarly_Notable"], effects: {} },
  BlueEarly_04: { id: "BlueEarly_04", ringId: "ring_01", treeId: "systemColorMap", name: "BlueNodeEarly_04", desc: "Early ring.", cost: 1, tags: ["Blue", "Early"], adjacent: ["BlueEarly_02", "BlueEarly_Notable"], effects: {} },

  BlueEarly_05: { id: "BlueEarly_05", treeId: "systemColorMap", name: "BlueNodeEarly_05", desc: "Early ring cluster B.", cost: 1, tags: ["Blue", "Early"], adjacent: ["BlueEarly_06", "BlueEarly_07"], effects: {} },
  BlueEarly_06: { id: "BlueEarly_06", treeId: "systemColorMap", name: "BlueNodeEarly_06", desc: "Early ring cluster B.", cost: 1, tags: ["Blue", "Early"], adjacent: ["BlueEarly_05", "BlueEarly_08"], effects: {} },
  BlueEarly_07: { id: "BlueEarly_07", treeId: "systemColorMap", name: "BlueNodeEarly_07", desc: "Early ring cluster B.", cost: 1, tags: ["Blue", "Early"], adjacent: ["BlueEarly_05", "BlueEarly_08", "BlueEarly_Notable"], effects: {} },
  BlueEarly_08: { id: "BlueEarly_08", treeId: "systemColorMap", name: "BlueNodeEarly_08", desc: "Early ring cluster B.", cost: 1, tags: ["Blue", "Early"], adjacent: ["BlueEarly_06", "BlueEarly_07", "BlueEarly_Notable"], effects: {} },

  BlueEarly_Notable: { id: "BlueEarly_Notable", ringId: "ring_02", treeId: "systemColorMap", name: "BlueNodeEarlyNotable_01", desc: "Cluster punctuation.", cost: 2, tags: ["Blue", "Early", "Notable"], adjacent: ["BlueEarly_03", "BlueEarly_04", "BlueEarly_07", "BlueEarly_08", "BlueMid_01", "BlackBlueEarly_04", "BlueGreenEarly_01", "BlackBlueEarly_01"], effects: {} },

  BlueMid_01: { id: "BlueMid_01", treeId: "systemColorMap", name: "BlueNodeMid_01", desc: "Mid ring.", cost: 2, tags: ["Blue", "Mid"], adjacent: ["BlueEarly_Notable", "BlueMid_02", "BlueGreenMid_Notable", "BlackBlueMid_Notable"], effects: {} },
  BlueMid_02: { id: "BlueMid_02", treeId: "systemColorMap", name: "BlueNodeMid_02", desc: "Mid ring.", cost: 2, tags: ["Blue", "Mid"], adjacent: ["BlueMid_01", "BlueMid_03"], effects: {} },
  BlueMid_03: { id: "BlueMid_03", treeId: "systemColorMap", name: "BlueNodeMid_03", desc: "Mid ring.", cost: 2, tags: ["Blue", "Mid"], adjacent: ["BlueMid_02", "BlueMid_04"], effects: {} },
  BlueMid_04: { id: "BlueMid_04", treeId: "systemColorMap", name: "BlueNodeMid_04", desc: "Mid ring.", cost: 2, tags: ["Blue", "Mid"], adjacent: ["BlueMid_03", "BlueMid_05"], effects: {} },
  BlueMid_05: { id: "BlueMid_05", treeId: "systemColorMap", name: "BlueNodeMid_05", desc: "Mid ring.", cost: 2, tags: ["Blue", "Mid"], adjacent: ["BlueMid_04", "BlueMid_06"], effects: {} },
  BlueMid_06: { id: "BlueMid_06", treeId: "systemColorMap", name: "BlueNodeMid_06", desc: "Mid ring.", cost: 2, tags: ["Blue", "Mid"], adjacent: ["BlueMid_05", "BlueMid_Notable"], effects: {} },

  BlueMid_Notable: { id: "BlueMid_Notable", treeId: "systemColorMap", name: "BlueNodeMidNotable_01", desc: "Mid anchor.", cost: 2, tags: ["Blue", "Mid", "Notable"], adjacent: ["BlueMid_06", "BlueLate_01", "BlueGreenEarly_04"], effects: {} },

  BlueLate_01: { id: "BlueLate_01", treeId: "systemColorMap", name: "BlueNodeLate_01", desc: "Late ring.", cost: 3, tags: ["Blue", "Late"], adjacent: ["BlueMid_Notable", "BlueLate_02"], effects: {} },
  BlueLate_02: { id: "BlueLate_02", treeId: "systemColorMap", name: "BlueNodeLate_02", desc: "Late ring.", cost: 3, tags: ["Blue", "Late"], adjacent: ["BlueLate_01", "BlueLate_03"], effects: {} },
  BlueLate_03: { id: "BlueLate_03", treeId: "systemColorMap", name: "BlueNodeLate_03", desc: "Late ring.", cost: 3, tags: ["Blue", "Late"], adjacent: ["BlueLate_02", "BlueLate_Notable"], effects: {} },

  BlueLate_Notable: { id: "BlueLate_Notable", treeId: "systemColorMap", name: "BlueNodeLateNotable_01", desc: "Outer edge anchor.", cost: 4, tags: ["Blue", "Late", "Notable"], adjacent: ["BlueLate_03"], effects: {} },

  // ==================================================
  // GREEN (Automation)
  // ==================================================
  GreenEarly_01: { id: "GreenEarly_01", ringId: "ring_01", treeId: "systemColorMap", name: "GreenNodeEarly_01", desc: "Early ring.", cost: 1, tags: ["Green", "Early"], adjacent: ["core_origin", "GreenEarly_02", "GreenEarly_03"], effects: {} },
  GreenEarly_02: { id: "GreenEarly_02", ringId: "ring_01", treeId: "systemColorMap", name: "GreenNodeEarly_02", desc: "Early ring.", cost: 1, tags: ["Green", "Early"], adjacent: ["core_origin", "GreenEarly_01", "GreenEarly_04"], effects: {} },
  GreenEarly_03: { id: "GreenEarly_03", ringId: "ring_01", treeId: "systemColorMap", name: "GreenNodeEarly_03", desc: "Early ring.", cost: 1, tags: ["Green", "Early"], adjacent: ["GreenEarly_01", "GreenEarly_04", "GreenEarly_Notable"], effects: {} },
  GreenEarly_04: { id: "GreenEarly_04", ringId: "ring_01", treeId: "systemColorMap", name: "GreenNodeEarly_04", desc: "Early ring.", cost: 1, tags: ["Green", "Early"], adjacent: ["GreenEarly_02", "GreenEarly_03", "GreenEarly_Notable"], effects: {} },

  GreenEarly_05: { id: "GreenEarly_05", treeId: "systemColorMap", name: "GreenNodeEarly_05", desc: "Early ring cluster B.", cost: 1, tags: ["Green", "Early"], adjacent: ["GreenEarly_06", "GreenEarly_07"], effects: {} },
  GreenEarly_06: { id: "GreenEarly_06", treeId: "systemColorMap", name: "GreenNodeEarly_06", desc: "Early ring cluster B.", cost: 1, tags: ["Green", "Early"], adjacent: ["GreenEarly_05", "GreenEarly_08"], effects: {} },
  GreenEarly_07: { id: "GreenEarly_07", treeId: "systemColorMap", name: "GreenNodeEarly_07", desc: "Early ring cluster B.", cost: 1, tags: ["Green", "Early"], adjacent: ["GreenEarly_05", "GreenEarly_08", "GreenEarly_Notable"], effects: {} },
  GreenEarly_08: { id: "GreenEarly_08", treeId: "systemColorMap", name: "GreenNodeEarly_08", desc: "Early ring cluster B.", cost: 1, tags: ["Green", "Early"], adjacent: ["GreenEarly_06", "GreenEarly_07", "GreenEarly_Notable"], effects: {} },

  GreenEarly_Notable: { id: "GreenEarly_Notable", ringId: "ring_02", treeId: "systemColorMap", name: "GreenNodeEarlyNotable_01", desc: "Cluster punctuation.", cost: 2, tags: ["Green", "Early", "Notable"], adjacent: ["GreenEarly_03", "GreenEarly_04", "GreenEarly_07", "GreenEarly_08", "GreenMid_01", "BlueGreenEarly_04", "GreenRedEarly_01", "BlueGreenEarly_01"], effects: {} },

  GreenMid_01: { id: "GreenMid_01", treeId: "systemColorMap", name: "GreenNodeMid_01", desc: "Mid ring.", cost: 2, tags: ["Green", "Mid"], adjacent: ["GreenEarly_Notable", "GreenMid_02", "GreenRedMid_Notable", "BlueGreenMid_Notable"], effects: {} },
  GreenMid_02: { id: "GreenMid_02", treeId: "systemColorMap", name: "GreenNodeMid_02", desc: "Mid ring.", cost: 2, tags: ["Green", "Mid"], adjacent: ["GreenMid_01", "GreenMid_03"], effects: {} },
  GreenMid_03: { id: "GreenMid_03", treeId: "systemColorMap", name: "GreenNodeMid_03", desc: "Mid ring.", cost: 2, tags: ["Green", "Mid"], adjacent: ["GreenMid_02", "GreenMid_04"], effects: {} },
  GreenMid_04: { id: "GreenMid_04", treeId: "systemColorMap", name: "GreenNodeMid_04", desc: "Mid ring.", cost: 2, tags: ["Green", "Mid"], adjacent: ["GreenMid_03", "GreenMid_05"], effects: {} },
  GreenMid_05: { id: "GreenMid_05", treeId: "systemColorMap", name: "GreenNodeMid_05", desc: "Mid ring.", cost: 2, tags: ["Green", "Mid"], adjacent: ["GreenMid_04", "GreenMid_06"], effects: {} },
  GreenMid_06: { id: "GreenMid_06", treeId: "systemColorMap", name: "GreenNodeMid_06", desc: "Mid ring.", cost: 2, tags: ["Green", "Mid"], adjacent: ["GreenMid_05", "GreenMid_Notable"], effects: {} },

  GreenMid_Notable: { id: "GreenMid_Notable", treeId: "systemColorMap", name: "GreenNodeMidNotable_01", desc: "Mid anchor.", cost: 2, tags: ["Green", "Mid", "Notable"], adjacent: ["GreenMid_06", "GreenLate_01", "GreenRedEarly_04"], effects: {} },

  GreenLate_01: { id: "GreenLate_01", treeId: "systemColorMap", name: "GreenNodeLate_01", desc: "Late ring.", cost: 3, tags: ["Green", "Late"], adjacent: ["GreenMid_Notable", "GreenLate_02"], effects: {} },
  GreenLate_02: { id: "GreenLate_02", treeId: "systemColorMap", name: "GreenNodeLate_02", desc: "Late ring.", cost: 3, tags: ["Green", "Late"], adjacent: ["GreenLate_01", "GreenLate_03"], effects: {} },
  GreenLate_03: { id: "GreenLate_03", treeId: "systemColorMap", name: "GreenNodeLate_03", desc: "Late ring.", cost: 3, tags: ["Green", "Late"], adjacent: ["GreenLate_02", "GreenLate_Notable"], effects: {} },

  GreenLate_Notable: { id: "GreenLate_Notable", treeId: "systemColorMap", name: "GreenNodeLateNotable_01", desc: "Outer edge anchor.", cost: 4, tags: ["Green", "Late", "Notable"], adjacent: ["GreenLate_03"], effects: {} },

  // ==================================================
  // BLACK (Control)
  // ==================================================
  BlackEarly_01: { id: "BlackEarly_01", ringId: "ring_01", treeId: "systemColorMap", name: "BlackNodeEarly_01", desc: "Early ring.", cost: 1, tags: ["Black", "Early"], adjacent: ["core_origin", "BlackEarly_02", "BlackEarly_03"], effects: {} },
  BlackEarly_02: { id: "BlackEarly_02", ringId: "ring_01", treeId: "systemColorMap", name: "BlackNodeEarly_02", desc: "Early ring.", cost: 1, tags: ["Black", "Early"], adjacent: ["core_origin", "BlackEarly_01", "BlackEarly_04"], effects: {} },
  BlackEarly_03: { id: "BlackEarly_03", ringId: "ring_01", treeId: "systemColorMap", name: "BlackNodeEarly_03", desc: "Early ring.", cost: 1, tags: ["Black", "Early"], adjacent: ["BlackEarly_01", "BlackEarly_04", "BlackEarly_Notable"], effects: {} },
  BlackEarly_04: { id: "BlackEarly_04", ringId: "ring_01", treeId: "systemColorMap", name: "BlackNodeEarly_04", desc: "Early ring.", cost: 1, tags: ["Black", "Early"], adjacent: ["BlackEarly_02", "BlackEarly_03", "BlackEarly_Notable"], effects: {} },

  BlackEarly_05: { id: "BlackEarly_05", treeId: "systemColorMap", name: "BlackNodeEarly_05", desc: "Early ring cluster B.", cost: 1, tags: ["Black", "Early"], adjacent: ["BlackEarly_06", "BlackEarly_07"], effects: {} },
  BlackEarly_06: { id: "BlackEarly_06", treeId: "systemColorMap", name: "BlackNodeEarly_06", desc: "Early ring cluster B.", cost: 1, tags: ["Black", "Early"], adjacent: ["BlackEarly_05", "BlackEarly_08"], effects: {} },
  BlackEarly_07: { id: "BlackEarly_07", treeId: "systemColorMap", name: "BlackNodeEarly_07", desc: "Early ring cluster B.", cost: 1, tags: ["Black", "Early"], adjacent: ["BlackEarly_05", "BlackEarly_08", "BlackEarly_Notable"], effects: {} },
  BlackEarly_08: { id: "BlackEarly_08", treeId: "systemColorMap", name: "BlackNodeEarly_08", desc: "Early ring cluster B.", cost: 1, tags: ["Black", "Early"], adjacent: ["BlackEarly_06", "BlackEarly_07", "BlackEarly_Notable"], effects: {} },

  BlackEarly_Notable: { id: "BlackEarly_Notable", ringId: "ring_02", treeId: "systemColorMap", name: "BlackNodeEarlyNotable_01", desc: "Cluster punctuation.", cost: 2, tags: ["Black", "Early", "Notable"], adjacent: ["BlackEarly_03", "BlackEarly_04", "BlackEarly_07", "BlackEarly_08", "BlackMid_01", "RedBlackEarly_04", "BlackBlueEarly_01", "RedBlackEarly_01"], effects: {} },

  BlackMid_01: { id: "BlackMid_01", treeId: "systemColorMap", name: "BlackNodeMid_01", desc: "Mid ring.", cost: 2, tags: ["Black", "Mid"], adjacent: ["BlackEarly_Notable", "BlackMid_02", "RedBlackMid_Notable", "BlackBlueMid_Notable"], effects: {} },
  BlackMid_02: { id: "BlackMid_02", treeId: "systemColorMap", name: "BlackNodeMid_02", desc: "Mid ring.", cost: 2, tags: ["Black", "Mid"], adjacent: ["BlackMid_01", "BlackMid_03"], effects: {} },
  BlackMid_03: { id: "BlackMid_03", treeId: "systemColorMap", name: "BlackNodeMid_03", desc: "Mid ring.", cost: 2, tags: ["Black", "Mid"], adjacent: ["BlackMid_02", "BlackMid_04"], effects: {} },
  BlackMid_04: { id: "BlackMid_04", treeId: "systemColorMap", name: "BlackNodeMid_04", desc: "Mid ring.", cost: 2, tags: ["Black", "Mid"], adjacent: ["BlackMid_03", "BlackMid_05"], effects: {} },
  BlackMid_05: { id: "BlackMid_05", treeId: "systemColorMap", name: "BlackNodeMid_05", desc: "Mid ring.", cost: 2, tags: ["Black", "Mid"], adjacent: ["BlackMid_04", "BlackMid_06"], effects: {} },
  BlackMid_06: { id: "BlackMid_06", treeId: "systemColorMap", name: "BlackNodeMid_06", desc: "Mid ring.", cost: 2, tags: ["Black", "Mid"], adjacent: ["BlackMid_05", "BlackMid_Notable"], effects: {} },

  BlackMid_Notable: { id: "BlackMid_Notable", treeId: "systemColorMap", name: "BlackNodeMidNotable_01", desc: "Mid anchor.", cost: 2, tags: ["Black", "Mid", "Notable"], adjacent: ["BlackMid_06", "BlackLate_01", "BlackBlueEarly_04"], effects: {} },

  BlackLate_01: { id: "BlackLate_01", treeId: "systemColorMap", name: "BlackNodeLate_01", desc: "Late ring.", cost: 3, tags: ["Black", "Late"], adjacent: ["BlackMid_Notable", "BlackLate_02"], effects: {} },
  BlackLate_02: { id: "BlackLate_02", treeId: "systemColorMap", name: "BlackNodeLate_02", desc: "Late ring.", cost: 3, tags: ["Black", "Late"], adjacent: ["BlackLate_01", "BlackLate_03"], effects: {} },
  BlackLate_03: { id: "BlackLate_03", treeId: "systemColorMap", name: "BlackNodeLate_03", desc: "Late ring.", cost: 3, tags: ["Black", "Late"], adjacent: ["BlackLate_02", "BlackLate_Notable"], effects: {} },

  BlackLate_Notable: { id: "BlackLate_Notable", treeId: "systemColorMap", name: "BlackNodeLateNotable_01", desc: "Outer edge anchor.", cost: 4, tags: ["Black", "Late", "Notable"], adjacent: ["BlackLate_03"], effects: {} },

  // ==================================================
  // RED (Force)
  // ==================================================
  RedEarly_01: { id: "RedEarly_01", ringId: "ring_01", treeId: "systemColorMap", name: "RedNodeEarly_01", desc: "Early ring.", cost: 1, tags: ["Red", "Early"], adjacent: ["core_origin", "RedEarly_02", "RedEarly_03"], effects: {} },
  RedEarly_02: { id: "RedEarly_02", ringId: "ring_01", treeId: "systemColorMap", name: "RedNodeEarly_02", desc: "Early ring.", cost: 1, tags: ["Red", "Early"], adjacent: ["core_origin", "RedEarly_01", "RedEarly_04"], effects: {} },
  RedEarly_03: { id: "RedEarly_03", ringId: "ring_01", treeId: "systemColorMap", name: "RedNodeEarly_03", desc: "Early ring.", cost: 1, tags: ["Red", "Early"], adjacent: ["RedEarly_01", "RedEarly_04", "RedEarly_Notable"], effects: {} },
  RedEarly_04: { id: "RedEarly_04", ringId: "ring_01", treeId: "systemColorMap", name: "RedNodeEarly_04", desc: "Early ring.", cost: 1, tags: ["Red", "Early"], adjacent: ["RedEarly_02", "RedEarly_03", "RedEarly_Notable"], effects: {} },

  RedEarly_05: { id: "RedEarly_05", treeId: "systemColorMap", name: "RedNodeEarly_05", desc: "Early ring cluster B.", cost: 1, tags: ["Red", "Early"], adjacent: ["RedEarly_06", "RedEarly_07"], effects: {} },
  RedEarly_06: { id: "RedEarly_06", treeId: "systemColorMap", name: "RedNodeEarly_06", desc: "Early ring cluster B.", cost: 1, tags: ["Red", "Early"], adjacent: ["RedEarly_05", "RedEarly_08"], effects: {} },
  RedEarly_07: { id: "RedEarly_07", treeId: "systemColorMap", name: "RedNodeEarly_07", desc: "Early ring cluster B.", cost: 1, tags: ["Red", "Early"], adjacent: ["RedEarly_05", "RedEarly_08", "RedEarly_Notable"], effects: {} },
  RedEarly_08: { id: "RedEarly_08", treeId: "systemColorMap", name: "RedNodeEarly_08", desc: "Early ring cluster B.", cost: 1, tags: ["Red", "Early"], adjacent: ["RedEarly_06", "RedEarly_07", "RedEarly_Notable"], effects: {} },

  RedEarly_Notable: { id: "RedEarly_Notable", ringId: "ring_02", treeId: "systemColorMap", name: "RedNodeEarlyNotable_01", desc: "Cluster punctuation.", cost: 2, tags: ["Red", "Early", "Notable"], adjacent: ["RedEarly_03", "RedEarly_04", "RedEarly_07", "RedEarly_08", "RedMid_01", "GreenRedEarly_04", "RedBlackEarly_01", "GreenRedEarly_01"], effects: {} },

  RedMid_01: { id: "RedMid_01", treeId: "systemColorMap", name: "RedNodeMid_01", desc: "Mid ring.", cost: 2, tags: ["Red", "Mid"], adjacent: ["RedEarly_Notable", "RedMid_02", "GreenRedMid_Notable", "RedBlackMid_Notable"], effects: {} },
  RedMid_02: { id: "RedMid_02", treeId: "systemColorMap", name: "RedNodeMid_02", desc: "Mid ring.", cost: 2, tags: ["Red", "Mid"], adjacent: ["RedMid_01", "RedMid_03"], effects: {} },
  RedMid_03: { id: "RedMid_03", treeId: "systemColorMap", name: "RedNodeMid_03", desc: "Mid ring.", cost: 2, tags: ["Red", "Mid"], adjacent: ["RedMid_02", "RedMid_04"], effects: {} },
  RedMid_04: { id: "RedMid_04", treeId: "systemColorMap", name: "RedNodeMid_04", desc: "Mid ring.", cost: 2, tags: ["Red", "Mid"], adjacent: ["RedMid_03", "RedMid_05"], effects: {} },
  RedMid_05: { id: "RedMid_05", treeId: "systemColorMap", name: "RedNodeMid_05", desc: "Mid ring.", cost: 2, tags: ["Red", "Mid"], adjacent: ["RedMid_04", "RedMid_06"], effects: {} },
  RedMid_06: { id: "RedMid_06", treeId: "systemColorMap", name: "RedNodeMid_06", desc: "Mid ring.", cost: 2, tags: ["Red", "Mid"], adjacent: ["RedMid_05", "RedMid_Notable"], effects: {} },

  RedMid_Notable: { id: "RedMid_Notable", treeId: "systemColorMap", name: "RedNodeMidNotable_01", desc: "Mid anchor.", cost: 2, tags: ["Red", "Mid", "Notable"], adjacent: ["RedMid_06", "RedLate_01", "RedBlackEarly_04"], effects: {} },

  RedLate_01: { id: "RedLate_01", treeId: "systemColorMap", name: "RedNodeLate_01", desc: "Late ring.", cost: 3, tags: ["Red", "Late"], adjacent: ["RedMid_Notable", "RedLate_02"], effects: {} },
  RedLate_02: { id: "RedLate_02", treeId: "systemColorMap", name: "RedNodeLate_02", desc: "Late ring.", cost: 3, tags: ["Red", "Late"], adjacent: ["RedLate_01", "RedLate_03"], effects: {} },
  RedLate_03: { id: "RedLate_03", treeId: "systemColorMap", name: "RedNodeLate_03", desc: "Late ring.", cost: 3, tags: ["Red", "Late"], adjacent: ["RedLate_02", "RedLate_Notable"], effects: {} },

  RedLate_Notable: { id: "RedLate_Notable", treeId: "systemColorMap", name: "RedNodeLateNotable_01", desc: "Outer edge anchor.", cost: 4, tags: ["Red", "Late", "Notable"], adjacent: ["RedLate_03"], effects: {} },

  // ==================================================
  // HYBRID BANDS (adjacent quadrants)
  // - Blue <-> Green (Deferred band)
  // - Green <-> Red (Preserve band)
  // - Red <-> Black (Immediate band)
  // - Black <-> Blue (Exploit band)
  // ==================================================

  // --- BlueGreen Early (bridge)
  BlueGreenEarly_01: { id: "BlueGreenEarly_01", ringId: "ring_03", treeId: "systemColorMap", name: "BlueGreenEarly_01", desc: "Hybrid bridge.", cost: 1, tags: ["Blue", "Green", "Early", "Hybrid"], adjacent: ["BlueEarly_Notable", "BlueGreenEarly_02", "GreenEarly_Notable"], effects: {} },
  BlueGreenEarly_02: { id: "BlueGreenEarly_02", ringId: "ring_03", treeId: "systemColorMap", name: "BlueGreenEarly_02", desc: "Hybrid bridge.", cost: 1, tags: ["Blue", "Green", "Early", "Hybrid"], adjacent: ["BlueGreenEarly_01", "BlueGreenEarly_03", "BlueGreenMid_Notable"], effects: {} },
  BlueGreenEarly_03: { id: "BlueGreenEarly_03", ringId: "ring_03", treeId: "systemColorMap", name: "BlueGreenEarly_03", desc: "Hybrid bridge.", cost: 1, tags: ["Blue", "Green", "Early", "Hybrid"], adjacent: ["BlueGreenEarly_02", "BlueGreenEarly_04"], effects: {} },
  BlueGreenEarly_04: { id: "BlueGreenEarly_04", ringId: "ring_03", treeId: "systemColorMap", name: "BlueGreenEarly_04", desc: "Hybrid bridge.", cost: 1, tags: ["Blue", "Green", "Early", "Hybrid"], adjacent: ["BlueGreenEarly_03", "GreenEarly_Notable", "BlueMid_Notable"], effects: {} },

  // --- GreenRed Early (bridge)
  GreenRedEarly_01: { id: "GreenRedEarly_01", ringId: "ring_03", treeId: "systemColorMap", name: "GreenRedEarly_01", desc: "Hybrid bridge.", cost: 1, tags: ["Green", "Red", "Early", "Hybrid"], adjacent: ["GreenEarly_Notable", "GreenRedEarly_02", "RedEarly_Notable"], effects: {} },
  GreenRedEarly_02: { id: "GreenRedEarly_02", ringId: "ring_03", treeId: "systemColorMap", name: "GreenRedEarly_02", desc: "Hybrid bridge.", cost: 1, tags: ["Green", "Red", "Early", "Hybrid"], adjacent: ["GreenRedEarly_01", "GreenRedEarly_03", "GreenRedMid_Notable"], effects: {} },
  GreenRedEarly_03: { id: "GreenRedEarly_03", ringId: "ring_03", treeId: "systemColorMap", name: "GreenRedEarly_03", desc: "Hybrid bridge.", cost: 1, tags: ["Green", "Red", "Early", "Hybrid"], adjacent: ["GreenRedEarly_02", "GreenRedEarly_04"], effects: {} },
  GreenRedEarly_04: { id: "GreenRedEarly_04", ringId: "ring_03", treeId: "systemColorMap", name: "GreenRedEarly_04", desc: "Hybrid bridge.", cost: 1, tags: ["Green", "Red", "Early", "Hybrid"], adjacent: ["GreenRedEarly_03", "RedEarly_Notable", "GreenMid_Notable"], effects: {} },

  // --- RedBlack Early (bridge)
  RedBlackEarly_01: { id: "RedBlackEarly_01", ringId: "ring_03", treeId: "systemColorMap", name: "RedBlackEarly_01", desc: "Hybrid bridge.", cost: 1, tags: ["Red", "Black", "Early", "Hybrid"], adjacent: ["RedEarly_Notable", "RedBlackEarly_02", "BlackEarly_Notable"], effects: {} },
  RedBlackEarly_02: { id: "RedBlackEarly_02", ringId: "ring_03", treeId: "systemColorMap", name: "RedBlackEarly_02", desc: "Hybrid bridge.", cost: 1, tags: ["Red", "Black", "Early", "Hybrid"], adjacent: ["RedBlackEarly_01", "RedBlackEarly_03", "RedBlackMid_Notable"], effects: {} },
  RedBlackEarly_03: { id: "RedBlackEarly_03", ringId: "ring_03", treeId: "systemColorMap", name: "RedBlackEarly_03", desc: "Hybrid bridge.", cost: 1, tags: ["Red", "Black", "Early", "Hybrid"], adjacent: ["RedBlackEarly_02", "RedBlackEarly_04"], effects: {} },
  RedBlackEarly_04: { id: "RedBlackEarly_04", ringId: "ring_03", treeId: "systemColorMap", name: "RedBlackEarly_04", desc: "Hybrid bridge.", cost: 1, tags: ["Red", "Black", "Early", "Hybrid"], adjacent: ["RedBlackEarly_03", "BlackEarly_Notable", "RedMid_Notable"], effects: {} },

  // --- BlackBlue Early (bridge)
  BlackBlueEarly_01: { id: "BlackBlueEarly_01", ringId: "ring_03", treeId: "systemColorMap", name: "BlackBlueEarly_01", desc: "Hybrid bridge.", cost: 1, tags: ["Black", "Blue", "Early", "Hybrid"], adjacent: ["BlackEarly_Notable", "BlackBlueEarly_02", "BlueEarly_Notable"], effects: {} },
  BlackBlueEarly_02: { id: "BlackBlueEarly_02", ringId: "ring_03", treeId: "systemColorMap", name: "BlackBlueEarly_02", desc: "Hybrid bridge.", cost: 1, tags: ["Black", "Blue", "Early", "Hybrid"], adjacent: ["BlackBlueEarly_01", "BlackBlueEarly_03", "BlackBlueMid_Notable"], effects: {} },
  BlackBlueEarly_03: { id: "BlackBlueEarly_03", ringId: "ring_03", treeId: "systemColorMap", name: "BlackBlueEarly_03", desc: "Hybrid bridge.", cost: 1, tags: ["Black", "Blue", "Early", "Hybrid"], adjacent: ["BlackBlueEarly_02", "BlackBlueEarly_04"], effects: {} },
  BlackBlueEarly_04: { id: "BlackBlueEarly_04", ringId: "ring_03", treeId: "systemColorMap", name: "BlackBlueEarly_04", desc: "Hybrid bridge.", cost: 1, tags: ["Black", "Blue", "Early", "Hybrid"], adjacent: ["BlackBlueEarly_03", "BlueEarly_Notable", "BlackMid_Notable"], effects: {} },

  // --- Mid hybrid notables (3) as “bridge anchors”
  BlueGreenMid_Notable: {
    id: "BlueGreenMid_Notable",
    ringId: "ring_05",
    treeId: "systemColorMap",
    name: "BlueGreenMidNotable_01",
    desc: "Bridge anchor (deferred domain).",
    cost: 2,
    tags: ["Blue", "Green", "Mid", "Notable", "Hybrid"],
    adjacent: ["BlueMid_01", "GreenMid_01", "BlueGreenEarly_02"],
    effects: {},
  },
  GreenRedMid_Notable: {
    id: "GreenRedMid_Notable",
    ringId: "ring_05",
    treeId: "systemColorMap",
    name: "GreenRedMidNotable_01",
    desc: "Bridge anchor (preserve domain).",
    cost: 2,
    tags: ["Green", "Red", "Mid", "Notable", "Hybrid"],
    adjacent: ["GreenMid_01", "RedMid_01", "GreenRedEarly_02"],
    effects: {},
  },
  RedBlackMid_Notable: {
    id: "RedBlackMid_Notable",
    ringId: "ring_05",
    treeId: "systemColorMap",
    name: "RedBlackMidNotable_01",
    desc: "Bridge anchor (immediate domain).",
    cost: 2,
    tags: ["Red", "Black", "Mid", "Notable", "Hybrid"],
    adjacent: ["RedMid_01", "BlackMid_01", "RedBlackEarly_02"],
    effects: {},
  },
  BlackBlueMid_Notable: {
    id: "BlackBlueMid_Notable",
    ringId: "ring_05",
    treeId: "systemColorMap",
    name: "BlackBlueMidNotable_01",
    desc: "Bridge anchor (immediate domain).",
    cost: 2,
    tags: ["Black", "Blue", "Mid", "Notable", "Hybrid"],
    adjacent: ["BlackMid_01", "BlueMid_01", "BlackBlueEarly_02"],
    effects: {},
  },
};
