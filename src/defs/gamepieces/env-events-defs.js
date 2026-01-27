// env-events-defs.js
// Env event registry (data only).

export const envEventDefs = {
  event_rain: {
    id: "event_rain",
    kind: "envEvent",
    name: "Rain",
    ui: { description: "Light seasonal rainfall." },
    class: "effect",
    defaultSpan: 2,
    durationSec: 10,
    onTick: [
    { op: "AddToSystemState", target: { ref: "self", layer: "tile" }, system: "hydration", key: "cur", amount: 10 }
    ]
  },
  event_flooding: {
    id: "event_flooding",
    kind: "envEvent",
    name: "Flooding",
    ui: { 
      description: "Overflow briefly changes the terrain.",
      color: 0x0000ff
    },
    class: "effect",
    defaultSpan: 1,
    durationSec: 40,
    expiresOnSeasonChange: true,
    spawn: {
      mode: "allColsWhere",
      where: { tileId: "tile_floodplains" },
    },
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
        value: { cur: 100, max: 100, decayPerSec: 2, sumRatio: 0 },
      },
      {
        op: "SetSystemState",
        target: { ref: "self", layer: "tile" },
        system: "growth",
        value: {
          selectedCropId: null,
          processes: [],
          maturedPool: { bronze: 0, silver: 0, gold: 0, diamond: 0 },
        },
      },
    ],
  },
  event_heatwave: {
    id: "event_heatwave",
    kind: "envEvent",
    name: "Heatwave",
    ui: { description: "Short-lived extreme heat." },
    class: "effect",
    defaultSpan: 2,
    durationSec: 10,
    onTick: [
      { op: "AddToSystemState", target: { ref: "self", layer: "tile" }, system: "hydration", key: "cur", amount: -10 }
    ]
  },
  event_duststorm: {
    id: "event_duststorm",
    kind: "envEvent",
    name: "Duststorm",
    ui: { description: "Gritty winds sweep across the land." },
    class: "effect",
    durationSec: 3,
    onEnter: { op: "UpgradeSystemTier", target: { ref: "self", layer: "tile" }, system: "fertility", delta: -1 },
  },
  event_storm: {
    id: "event_storm",
    kind: "envEvent",
    name: "Storm",
    ui: { description: "High winds batter a wide stretch of land." },
    class: "effect",
    defaultSpan: 2,
    durationSec: 6,
    onEnter: [
      { op: "DisableTag", target: { ref: "self", layer: "tile" }, tag: "farmable" },
      {
        op: "ClearSystemState",
        target: { ref: "self", layer: "tile" },
        systems: ["growth", "hydration"],
      },
    ],
  },
  event_bloom: {
    id: "event_bloom",
    kind: "envEvent",
    name: "Bloom",
    ui: { description: "A short burst of growth." },
    class: "effect",
    durationSec: 3,
    onEnter: { op: "UpgradeSystemTier", target: { ref: "self", layer: "tile" }, system: "fertility", delta: 1 },
  },
  event_misty_morning: {
    id: "event_misty_morning",
    kind: "envEvent",
    name: "Misty Morning",
    ui: { description: "Low fog settles over the area." },
    class: "effect",
    durationSec: 3,
    onEnter: { op: "AddResource", resource: "water", amount: 1 },
  },
  event_clear_skies: {
    id: "event_clear_skies",
    kind: "envEvent",
    name: "Clear Skies",
    ui: { description: "Calm conditions and open visibility." },
    class: "effect",
    durationSec: 3,
    onEnter: { op: "AddResource", resource: "morale", amount: 1 },
  },
  event_deer_herd: {
    id: "event_deer_herd",
    kind: "envEvent",
    name: "Deer Herd",
    ui: { description: "A herd moves through the area." },
    class: "animal",
    durationSec: 3,
    onEnter: { op: "AddResource", resource: "meat", amount: 1 },
  },
  event_boar: {
    id: "event_boar",
    kind: "envEvent",
    name: "Boar",
    ui: { description: "A lone boar is spotted." },
    class: "animal",
    durationSec: 3,
    onEnter: { op: "AddResource", resource: "meat", amount: 1 },
  },
  event_rabbits: {
    id: "event_rabbits",
    kind: "envEvent",
    name: "Rabbits",
    ui: { description: "Small game is active here." },
    class: "animal",
    durationSec: 3,
    onEnter: { op: "AddResource", resource: "meat", amount: 1 },
  },
  event_fish_school: {
    id: "event_fish_school",
    kind: "envEvent",
    name: "Fish School",
    ui: { description: "Fish cluster in the shallows." },
    class: "animal",
    durationSec: 3,
    onEnter: { op: "AddResource", resource: "fish", amount: 1 },
  },
  event_wolves: {
    id: "event_wolves",
    kind: "envEvent",
    name: "Wolves",
    ui: { description: "A wolf pack passes through." },
    class: "animal",
    durationSec: 3,
    onEnter: { op: "AddResource", resource: "hide", amount: 1 },
  },
  event_migratory_birds: {
    id: "event_migratory_birds",
    kind: "envEvent",
    name: "Migratory Birds",
    ui: { description: "Seasonal birds rest briefly." },
    class: "animal",
    durationSec: 3,
    onEnter: { op: "AddResource", resource: "gold", amount: 1 },
  },
};
