// env-events-defs.js
// Env event registry (data only).

import { ensureTooltipCardUi } from "../tooltip-ui-utils.js";

export const envEventDefs = {
  event_common_spring: {
    id: "event_common_spring",
    kind: "envEvent",
    name: "Common Spring",
    ui: { description: "Common spring weather." },
    class: "effect",
    defaultSpan: 1,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },
  event_common_summer: {
    id: "event_common_summer",
    kind: "envEvent",
    name: "Common Summer",
    ui: { description: "Common summer weather." },
    class: "effect",
    defaultSpan: 1,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },
  event_common_autumn: {
    id: "event_common_autumn",
    kind: "envEvent",
    name: "Common Autumn",
    ui: { description: "Common autumn weather." },
    class: "effect",
    defaultSpan: 1,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },
  event_common_winter: {
    id: "event_common_winter",
    kind: "envEvent",
    name: "Common Winter",
    ui: { description: "Common winter weather." },
    class: "effect",
    defaultSpan: 1,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },

  //  0x5f8b8f

  event_uncommon_spring: {
    id: "event_uncommon_spring",
    kind: "envEvent",
    name: "Uncommon Spring",
    ui: { 
      description: "Uncommon spring weather.",
      color: 0x5f8b8f
    },
    class: "effect",
    defaultSpan: 2,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },
  event_uncommon_summer: {
    id: "event_uncommon_summer",
    kind: "envEvent",
    name: "Uncommon Summer",
    ui: { 
      description: "Uncommon summer weather.",
      color: 0x5f8b8f
    },
    class: "effect",
    defaultSpan: 2,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },
  event_uncommon_autumn: {
    id: "event_uncommon_autumn",
    kind: "envEvent",
    name: "Uncommon Autumn",
    ui: { 
      description: "Uncommon autumn weather.",
      color: 0x5f8b8f
    },
    class: "effect",
    defaultSpan: 2,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },
  event_uncommon_winter: {
    id: "event_uncommon_winter",
    kind: "envEvent",
    name: "Uncommon Winter",
    ui: { 
      description: "Uncommon winter weather.",
      color: 0x5f8b8f
     },
    class: "effect",
    defaultSpan: 2,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },

  //  0xa618a8

  event_rare_spring: {
    id: "event_rare_spring",
    kind: "envEvent",
    name: "Rare Spring",
    ui: { 
      description: "Rare spring weather.",
      color: 0xa618a8
     },
    class: "effect",
    defaultSpan: 3,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },
  event_rare_summer: {
    id: "event_rare_summer",
    kind: "envEvent",
    name: "Rare Summer",
    ui: { 
      description: "Rare summer weather.",
      color: 0xa618a8 
    },
    class: "effect",
    defaultSpan: 3,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },
  event_rare_autumn: {
    id: "event_rare_autumn",
    kind: "envEvent",
    name: "Rare Autumn",
    ui: { description: "Rare autumn weather.",
      color: 0xa618a8 
    },
    class: "effect",
    defaultSpan: 3,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },
  event_rare_winter: {
    id: "event_rare_winter",
    kind: "envEvent",
    name: "Rare Winter",
    ui: { 
      description: "Rare winter weather.",
      color: 0xa618a8
    },
    class: "effect",
    defaultSpan: 3,
    durationSec: 15,
    onEnter: { op: "AddResource", resource: "nonop", amount: 1 },
  },

  // Authored Events 

  event_rain: {
    id: "event_rain",
    kind: "envEvent",
    name: "Rain",
    ui: { 
      description: "Light seasonal rainfall.",
      color: 0x0094ff
     },
    class: "effect",
    defaultSpan: 2,
    durationSec: 15,
    onTick: [
      {
        op: "AddToSystemState",
        target: {
          ref: "self",
          layer: "tile",
          where: {
            systemAtLeast: { system: "hydration", key: "max", gte: 1 },
          },
        },
        system: "hydration",
        key: "cur",
        amount: 10,
      },
      {
        op: "ClampSystemState",
        target: {
          ref: "self",
          layer: "tile",
          where: {
            systemAtLeast: { system: "hydration", key: "max", gte: 1 },
          },
        },
        system: "hydration",
        key: "cur",
        min: 0,
        maxKey: "max",
      },
    ],
  },
  event_flooding: {
    id: "event_flooding",
    kind: "envEvent",
    name: "Flooding",
    ui: { 
      description: "Overflow briefly changes the terrain.",
      color: 0x1b69d6 // #1b69d6
    },
    class: "effect",
    defaultSpan: 1,
    drawResolution: {
      mode: "aggregateActiveRun",
      aggregateKey: "flood",
      durationBaseSec: 25,
      durationPerExtraCardSec: 5,
      purgeRemainingCardsOnExpire: true,
      magnitudeBands: [
        {
          id: "low",
          minCards: 1,
          maxCards: 1,
          onRunUpdate: [
            {
              op: "SetSystemState",
              target: { ref: "self", layer: "tile" },
              system: "hydration",
              merge: true,
              value: { cur: 70 },
            },
            {
              op: "ClampSystemState",
              target: { ref: "self", layer: "tile" },
              system: "hydration",
              key: "cur",
              min: 0,
              maxKey: "max",
            },
          ],
        },
        {
          id: "normal",
          minCards: 2,
          maxCards: 3,
          onRunUpdate: [
            {
              op: "SetSystemState",
              target: { ref: "self", layer: "tile" },
              system: "hydration",
              merge: true,
              value: { cur: 90 },
            },
            {
              op: "ClampSystemState",
              target: { ref: "self", layer: "tile" },
              system: "hydration",
              key: "cur",
              min: 0,
              maxKey: "max",
            },
          ],
        },
        {
          id: "heavy",
          minCards: 4,
          maxCards: null,
          onRunUpdate: [
            {
              op: "SetSystemState",
              target: { ref: "self", layer: "tile" },
              system: "hydration",
              merge: true,
              value: { cur: 100 },
            },
            {
              op: "ClampSystemState",
              target: { ref: "self", layer: "tile" },
              system: "hydration",
              key: "cur",
              min: 0,
              maxKey: "max",
            },
          ],
        },
      ],
    },
    spawn: {
      mode: "allColsWhere",
      where: { tileId: "tile_floodplains" },
    },
    onEnter: [
      {
        op: "SetSystemState",
        target: { ref: "self", layer: "tile" },
        system: "growth",
        merge: true,
        value: {
          processes: [],
          maturedPool: {},
        },
      },
      { op: "DisableTag", target: { ref: "self", layer: "tile" }, tag: "farmable" },
      { op: "DisableTag", target: { ref: "self", layer: "tile" }, tag: "forageable" },
    ],
    onExit: [
      { op: "EnableTag", target: { ref: "self", layer: "tile" }, tag: "farmable" },
      { op: "EnableTag", target: { ref: "self", layer: "tile" }, tag: "forageable" },
      {
        op: "SetSystemTier",
        target: { ref: "self", layer: "tile" },
        system: "hydration",
        tier: "silver",
      },
      {
        op: "SetSystemTier",
        target: { ref: "self", layer: "tile" },
        system: "fertility",
        tier: "silver",
      },
      {
        op: "SetSystemState",
        target: { ref: "self", layer: "tile" },
        system: "hydration",
        merge: true,
        value: { max: 100, decayPerSec: 2, sumRatio: 0 },
      },
      {
        op: "SetSystemState",
        target: { ref: "self", layer: "tile" },
        system: "growth",
        merge: true,
        value: {
          processes: [],
          maturedPool: {},
        },
      },
    ],
  },
  event_heatwave: {
    id: "event_heatwave",
    kind: "envEvent",
    name: "Heatwave",
    ui: { 
      description: "Short-lived extreme heat.",
      color: 0xb51a1a
     },
    class: "effect",
    defaultSpan: 2,
    durationSec: 15,
    onTick: [
      {
        op: "AddToSystemState",
        target: {
          ref: "self",
          layer: "tile",
          where: {
            systemAtLeast: { system: "hydration", key: "max", gte: 1 },
          },
        },
        system: "hydration",
        key: "cur",
        amount: -10,
      },
      {
        op: "ClampSystemState",
        target: {
          ref: "self",
          layer: "tile",
          where: {
            systemAtLeast: { system: "hydration", key: "max", gte: 1 },
          },
        },
        system: "hydration",
        key: "cur",
        min: 0,
        maxKey: "max",
      },
    ],
  },
  event_duststorm: {
    id: "event_duststorm",
    kind: "envEvent",
    name: "Duststorm",
    ui: { description: "Gritty winds sweep across the land.", color: 0x92610d },
    class: "effect",
    defaultSpan: 2,
    durationSec: 15,
    onEnter: { op: "UpgradeSystemTier", target: { ref: "self", layer: "tile" }, system: "fertility", delta: -1 },
  },
  event_storm: {
    id: "event_storm",
    kind: "envEvent",
    name: "Storm",
    ui: { description: "High winds batter a wide stretch of land.", color: 0x293539 },
    class: "effect",
    defaultSpan: 2,
    durationSec: 15,
    onEnter: [
      { op: "DisableTag", target: { ref: "self", layer: "tile" }, tag: "farmable" },
      {
        op: "ClearSystemState",
        target: { ref: "self", layer: "tile" },
        systems: ["growth", "hydration"],
      },
    ],
    onExit: [
      { op: "EnableTag", target: { ref: "self", layer: "tile" }, tag: "farmable" },
    ],
  },
  event_bloom: {
    id: "event_bloom",
    kind: "envEvent",
    name: "Bloom",
    ui: { description: "A short burst of growth.", color: 0x47a017 },
    class: "effect",
    defaultSpan: 2,
    durationSec: 10,
    onEnter: { op: "UpgradeSystemTier", target: { ref: "self", layer: "tile" }, system: "fertility", delta: 1 },
  },
  event_insect_swarm: {
    id: "event_insect_swarm",
    kind: "envEvent",
    name: "Insect Swarm",
    ui: { description: "A swarm of insects moves through the area." },
    class: "animal",
    durationSec: 10,
    onEnter: { op: "AddResource", resource: "meat", amount: 1 },
  },
  event_crocodile: {
    id: "event_crocodile",
    kind: "envEvent",
    name: "Crocodile",
    ui: { description: "A lone crocodile is spotted." },
    class: "animal",
    durationSec: 10,
    onEnter: { op: "AddResource", resource: "meat", amount: 1 },
  },
  event_oxen: {
    id: "event_oxen",
    kind: "envEvent",
    name: "Rabbits",
    ui: { description: "Small game is active here." },
    class: "animal",
    durationSec: 10,
    onEnter: { op: "AddResource", resource: "meat", amount: 1 },
  },
  event_fish_school: {
    id: "event_fish_school",
    kind: "envEvent",
    name: "Fish School",
    ui: { description: "Fish cluster in the shallows." },
    class: "animal",
    durationSec: 10,
    onEnter: { op: "AddResource", resource: "fish", amount: 1 },
  },
  event_hippos: {
    id: "event_hippos",
    kind: "envEvent",
    name: "Hippos",
    ui: { description: "A herd of hippos passes through." },
    class: "animal",
    durationSec: 10,
    onEnter: { op: "AddResource", resource: "hide", amount: 1 },
  },
  event_lion: {
    id: "event_lion",
    kind: "envEvent",
    name: "Lion",
    ui: { description: "A lone lion is spotted." },
    class: "animal",
    durationSec: 10,
    onEnter: { op: "AddResource", resource: "hide", amount: 1 },
  },  
  event_migratory_birds: {
    id: "event_migratory_birds",
    kind: "envEvent",
    name: "Migratory Birds",
    ui: { description: "Seasonal birds rest briefly." },
    class: "animal",
    durationSec: 10,
    onEnter: { op: "AddResource", resource: "gold", amount: 1 },
  },
};

ensureTooltipCardUi(envEventDefs);
