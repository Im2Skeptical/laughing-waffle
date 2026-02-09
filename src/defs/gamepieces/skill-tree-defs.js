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
