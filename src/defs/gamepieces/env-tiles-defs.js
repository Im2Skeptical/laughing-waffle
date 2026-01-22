// env-tiles-defs.js
// Env tile registry (data only).

export const envTileDefs = {
  tile_floodplains: {
    id: "tile_floodplains",
    kind: "envTile",
    name: "Floodplains",
    ui: { description: "Lowlands shaped by seasonal overflow." },
    baseTags: [],
    seasonTables: {
      spring: [
        { defId: "event_rain", weight: 4 },
        { defId: "event_bloom", weight: 2 },
        { defId: "event_storm", weight: 20 },
        { defId: "event_deer_herd", weight: 1 },
      ],
      summer: [
        { defId: "event_heatwave", weight: 2 },
        { defId: "event_clear_skies", weight: 1 },
        { defId: "event_fish_school", weight: 2 },
        { defId: "event_storm", weight: 1 },
      ],
      autumn: [
        { defId: "event_flooding", weight: 50 },
        { defId: "event_misty_morning", weight: 1 },
        { defId: "event_boar", weight: 1 },
        { defId: "event_storm", weight: 1 },
      ],
      winter: [
        { defId: "event_frost", weight: 3 },
        { defId: "event_clear_skies", weight: 1 },
        { defId: "event_wolves", weight: 1 },
        { defId: "event_storm", weight: 1 },
      ],
    },
  },
  tile_wetlands: {
    id: "tile_wetlands",
    kind: "envTile",
    name: "Wetlands",
    ui: { description: "Shallow pools and saturated soils." },
    baseTags: ["fishable", "forageable"],
    seasonTables: {
      spring: [
        { defId: "event_rain", weight: 3 },
        { defId: "event_fish_school", weight: 3 },
        { defId: "event_migratory_birds", weight: 2 },
        { defId: "event_storm", weight: 1 },
      ],
      summer: [
        { defId: "event_fish_school", weight: 3 },
        { defId: "event_clear_skies", weight: 1 },
        { defId: "event_heatwave", weight: 1 },
        { defId: "event_storm", weight: 20 },
      ],
      autumn: [
        { defId: "event_flooding", weight: 50 },
        { defId: "event_misty_morning", weight: 2 },
        { defId: "event_migratory_birds", weight: 1 },
        { defId: "event_storm", weight: 1 },
      ],
      winter: [
        { defId: "event_frost", weight: 2 },
        { defId: "event_clear_skies", weight: 1 },
        { defId: "event_fish_school", weight: 1 },
        { defId: "event_storm", weight: 1 },
      ],
    },
  },
  tile_levee: {
    id: "tile_levee",
    kind: "envTile",
    name: "Levee",
    ui: { description: "Raised banks that hold back river flow." },
    baseTags: ["farmable", "forageable"],
    seasonTables: {
      spring: [
        { defId: "event_rain", weight: 2 },
        { defId: "event_bloom", weight: 2 },
        { defId: "event_storm", weight: 1 },
        { defId: "event_clear_skies", weight: 1 },
      ],
      summer: [
        { defId: "event_clear_skies", weight: 2 },
        { defId: "event_heatwave", weight: 1 },
        { defId: "event_fish_school", weight: 1 },
      ],
      autumn: [
        { defId: "event_flooding", weight: 50 },
        { defId: "event_misty_morning", weight: 1 },
        { defId: "event_boar", weight: 1 },
      ],
      winter: [
        { defId: "event_frost", weight: 2 },
        { defId: "event_clear_skies", weight: 2 },
      ],
    },
  },
  tile_coast: {
    id: "tile_coast",
    kind: "envTile",
    name: "Coast",
    ui: { description: "Shallow waters and tidal flats." },
    baseTags: ["fishable", "forageable"],
    seasonTables: {
      spring: [
        { defId: "event_rain", weight: 2 },
        { defId: "event_fish_school", weight: 4 },
      ],
      summer: [
        { defId: "event_fish_school", weight: 4 },
        { defId: "event_clear_skies", weight: 2 },
      ],
      autumn: [
        { defId: "event_flooding", weight: 50 },
        { defId: "event_misty_morning", weight: 2 },
        { defId: "event_migratory_birds", weight: 2 },
      ],
      winter: [
        { defId: "event_frost", weight: 2 },
        { defId: "event_fish_school", weight: 2 },
      ],
    },
  },
  tile_river: {
    id: "tile_river",
    kind: "envTile",
    name: "River",
    ui: { description: "Flowing water and aquatic life." },
    baseTags: ["fishable", "blocked"],
    seasonTables: {
      spring: [
        { defId: "event_rain", weight: 2 },
        { defId: "event_fish_school", weight: 4 },
      ],
      summer: [
        { defId: "event_fish_school", weight: 4 },
        { defId: "event_clear_skies", weight: 2 },
      ],
      autumn: [
        { defId: "event_flooding", weight: 50 },
        { defId: "event_misty_morning", weight: 2 },
        { defId: "event_migratory_birds", weight: 2 },
      ],
      winter: [
        { defId: "event_frost", weight: 2 },
        { defId: "event_fish_school", weight: 2 },
      ],
    },
  },
  tile_dunes: {
    id: "tile_dunes",
    kind: "envTile",
    name: "Dunes",
    ui: { description: "Shifting sands and sparse shelter." },
    baseTags: ["mineable", "grazable"],
    seasonTables: {
      spring: [
        { defId: "event_duststorm", weight: 3 },
        { defId: "event_clear_skies", weight: 1 },
      ],
      summer: [
        { defId: "event_heatwave", weight: 3 },
        { defId: "event_duststorm", weight: 3 },
      ],
      autumn: [
        { defId: "event_misty_morning", weight: 1 },
        { defId: "event_clear_skies", weight: 1 },
        { defId: "event_duststorm", weight: 2 },
      ],
      winter: [
        { defId: "event_frost", weight: 1 },
        { defId: "event_clear_skies", weight: 2 },
        { defId: "event_duststorm", weight: 1 },
      ],
    },
  },
  tile_hinterland: {
    id: "tile_hinterland",
    kind: "envTile",
    name: "Hinterland",
    ui: { description: "Broad interior lands with mixed cover." },
    baseTags: ["farmable", "grazable", "forageable"],
    seasonTables: {
      spring: [
        { defId: "event_bloom", weight: 2 },
        { defId: "event_storm", weight: 1 },
        { defId: "event_deer_herd", weight: 2 },
      ],
      summer: [
        { defId: "event_rabbits", weight: 2 },
        { defId: "event_clear_skies", weight: 1 },
      ],
      autumn: [
        { defId: "event_flooding", weight: 50 },
        { defId: "event_boar", weight: 2 },
        { defId: "event_misty_morning", weight: 1 },
      ],
      winter: [
        { defId: "event_wolves", weight: 2 },
        { defId: "event_frost", weight: 2 },
      ],
    },
  },
  tile_highlands: {
    id: "tile_highlands",
    kind: "envTile",
    name: "Highlands",
    ui: { description: "Rocky uplands with sparse turf." },
    baseTags: ["mineable", "grazable"],
    seasonTables: {
      spring: [
        { defId: "event_clear_skies", weight: 1 },
        { defId: "event_deer_herd", weight: 1 },
      ],
      summer: [
        { defId: "event_heatwave", weight: 2 },
        { defId: "event_clear_skies", weight: 1 },
      ],
      autumn: [
        { defId: "event_boar", weight: 1 },
        { defId: "event_misty_morning", weight: 1 },
      ],
      winter: [
        { defId: "event_frost", weight: 2 },
        { defId: "event_wolves", weight: 1 },
      ],
    },
  },
  tile_steppe: {
    id: "tile_steppe",
    kind: "envTile",
    name: "Steppe",
    ui: { description: "Open grasslands with scattered shrubs." },
    baseTags: ["grazable", "farmable"],
    seasonTables: {
      spring: [
        { defId: "event_bloom", weight: 2 },
        { defId: "event_deer_herd", weight: 1 },
      ],
      summer: [
        { defId: "event_heatwave", weight: 2 },
        { defId: "event_clear_skies", weight: 1 },
      ],
      autumn: [
        { defId: "event_boar", weight: 1 },
        { defId: "event_misty_morning", weight: 1 },
      ],
      winter: [
        { defId: "event_frost", weight: 2 },
        { defId: "event_wolves", weight: 1 },
      ],
    },
  },
};
