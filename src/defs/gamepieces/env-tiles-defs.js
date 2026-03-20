// env-tiles-defs.js
// Env tile registry (data only).

import { ensureTooltipCardUi } from "../tooltip-ui-utils.js";

export const envTileDefs = {
  tile_floodplains: {
    id: "tile_floodplains",
    kind: "envTile",
    name: "Floodplains",
    ui: { 
      description: "Lowlands shaped by seasonal overflow.",
      color: 0x837051    //#837051 
    },
    baseTags: ["farmable","forageable"],
    seasonTables: {
      spring: [
        { defId: "event_common_spring", weight: 100 },
        { defId: "event_uncommon_spring", weight: 0 },
        { defId: "event_rare_spring", weight: 1 },
        { defId: "event_rain", weight: 10 },
        { defId: "event_bloom", weight: 10 },
        { defId: "event_storm", weight: 1 },
        { defId: "event_insect_swarm", weight: 1 },
        { defId: "event_lion", weight: 20 },
      ],
      summer: [
        { defId: "event_common_summer", weight: 100 },
        { defId: "event_uncommon_summer", weight: 0 },
        { defId: "event_rare_summer", weight: 1 },
        { defId: "event_heatwave", weight: 20 },
        { defId: "event_storm", weight: 1 },
      ],
      autumn: [
        { defId: "event_common_autumn", weight: 0 },
        { defId: "event_uncommon_autumn", weight: 20 },
        { defId: "event_rare_autumn", weight: 1 },
        { defId: "event_flooding", weight: 100 },
        { defId: "event_crocodile", weight: 1 },
        { defId: "event_storm", weight: 1 },
      ],
      winter: [
        { defId: "event_common_winter", weight: 50 },
        { defId: "event_uncommon_winter", weight: 0 },
        { defId: "event_rare_winter", weight: 1 },
        { defId: "event_oxen", weight: 10 },
        { defId: "event_hippos", weight: 10 },
        { defId: "event_migratory_birds", weight: 50 },
        { defId: "event_storm", weight: 1 },
      ],
    },
  },
  tile_wetlands: {
    id: "tile_wetlands",
    kind: "envTile",
    name: "Wetlands",
    ui: { 
      description: "Shallow pools and saturated soils.",
      color: 0x83915e  //#83915e 
     },
    baseTags: ["forageable", "fishable"],
    seasonTables: {
      spring: [
        { defId: "event_common_spring", weight: 100 },
        { defId: "event_uncommon_spring", weight: 0 },
        { defId: "event_rare_spring", weight: 1 },
        { defId: "event_rain", weight: 10 },
        { defId: "event_bloom", weight: 10 },
        { defId: "event_storm", weight: 1 },
        { defId: "event_insect_swarm", weight: 1 },
        { defId: "event_lion", weight: 20 },
      ],
      summer: [
        { defId: "event_common_summer", weight: 100 },
        { defId: "event_uncommon_summer", weight: 0 },
        { defId: "event_rare_summer", weight: 1 },
        { defId: "event_heatwave", weight: 20 },
        { defId: "event_storm", weight: 1 },
      ],
      autumn: [
        { defId: "event_common_autumn", weight: 0 },
        { defId: "event_uncommon_autumn", weight: 20 },
        { defId: "event_rare_autumn", weight: 1 },
        { defId: "event_fish_school", weight: 50 },
        { defId: "event_crocodile", weight: 1 },
        { defId: "event_storm", weight: 1 },
      ],
      winter: [
        { defId: "event_common_winter", weight: 0 },
        { defId: "event_uncommon_winter", weight: 0 },
        { defId: "event_rare_winter", weight: 1 },
        { defId: "event_oxen", weight: 10 },
        { defId: "event_hippos", weight: 10 },
        { defId: "event_migratory_birds", weight: 50 },
        { defId: "event_fish_school", weight: 50 },
        { defId: "event_storm", weight: 1 },
      ],
    },
  },
  tile_levee: {
    id: "tile_levee",
    kind: "envTile",
    name: "Levee",
    ui: { 
      description: "Raised banks that hold back river flow.",
      color: 0xdeb887  //#deb887 
     },
    baseTags: ["forageable"],
    seasonTables: {
      spring: [
        { defId: "event_common_spring", weight: 100 },
        { defId: "event_uncommon_spring", weight: 5 },
        { defId: "event_rare_spring", weight: 1 },
        { defId: "event_rain", weight: 5 },
        { defId: "event_bloom", weight: 10 },
        { defId: "event_storm", weight: 1 },
        { defId: "event_insect_swarm", weight: 1 },
        { defId: "event_lion", weight: 20 },
      ],
      summer: [
        { defId: "event_common_summer", weight: 100 },
        { defId: "event_uncommon_summer", weight: 0 },
        { defId: "event_rare_summer", weight: 1 },
        { defId: "event_heatwave", weight: 20 },
        { defId: "event_storm", weight: 1 },
      ],
      autumn: [
        { defId: "event_common_autumn", weight: 0 },
        { defId: "event_uncommon_autumn", weight: 20 },
        { defId: "event_rare_autumn", weight: 1 },
        { defId: "event_fish_school", weight: 50 },
        { defId: "event_crocodile", weight: 1 },
        { defId: "event_storm", weight: 1 },
      ],
      winter: [
        { defId: "event_common_winter", weight: 0 },
        { defId: "event_uncommon_winter", weight: 0 },
        { defId: "event_rare_winter", weight: 1 },
        { defId: "event_oxen", weight: 10 },
        { defId: "event_hippos", weight: 10 },
        { defId: "event_migratory_birds", weight: 50 },
        { defId: "event_fish_school", weight: 50 },
        { defId: "event_storm", weight: 1 },
      ],
    },
  },
  tile_river: {
    id: "tile_river",
    kind: "envTile",
    name: "River",
    ui: { 
      description: "Flowing water and aquatic life.",
      color: 0x1e90ff
     },
    baseTags: ["fishable"],
    seasonTables: {
      spring: [
        { defId: "event_common_spring", weight: 100 },
        { defId: "event_uncommon_spring", weight: 20 },
        { defId: "event_rare_spring", weight: 1 },        
        { defId: "event_rain", weight: 20 },
        { defId: "event_fish_school", weight: 1 },
      ],
      summer: [
        { defId: "event_common_summer", weight: 100 },
        { defId: "event_uncommon_summer", weight: 20 },
        { defId: "event_rare_summer", weight: 1 },
        { defId: "event_fish_school", weight: 1 },
      ],
      autumn: [
        { defId: "event_common_autumn", weight: 50 },
        { defId: "event_uncommon_autumn", weight: 20 },
        { defId: "event_rare_autumn", weight: 1 },
        { defId: "event_flooding", weight: 50 },
      ],
      winter: [
        { defId: "event_common_winter", weight: 100 },
        { defId: "event_uncommon_winter", weight: 20 },
        { defId: "event_rare_winter", weight: 1 },
        { defId: "event_fish_school", weight: 1 },
      ],
    },
  },
  tile_hinterland: {
    id: "tile_hinterland",
    kind: "envTile",
    name: "Hinterland",
    ui: { 
      description: "Broad interior lands with mixed cover.",
      color: 0xcea498  //#cea498
     },
    baseTags: ["forageable", "herdable"],
    seasonTables: {
      spring: [
        { defId: "event_common_spring", weight: 100 },
        { defId: "event_uncommon_spring", weight: 0 },
        { defId: "event_rare_spring", weight: 1 },
        { defId: "event_rain", weight: 10 },
        { defId: "event_bloom", weight: 10 },
        { defId: "event_storm", weight: 1 },
        { defId: "event_insect_swarm", weight: 1 },
        { defId: "event_lion", weight: 20 },
      ],
      summer: [
        { defId: "event_common_summer", weight: 100 },
        { defId: "event_uncommon_summer", weight: 0 },
        { defId: "event_rare_summer", weight: 1 },
        { defId: "event_heatwave", weight: 20 },
        { defId: "event_storm", weight: 1 },
      ],
      autumn: [
        { defId: "event_common_autumn", weight: 0 },
        { defId: "event_uncommon_autumn", weight: 20 },
        { defId: "event_rare_autumn", weight: 1 },
        { defId: "event_fish_school", weight: 50 },
        { defId: "event_crocodile", weight: 1 },
        { defId: "event_storm", weight: 1 },
      ],
      winter: [
        { defId: "event_common_winter", weight: 0 },
        { defId: "event_uncommon_winter", weight: 0 },
        { defId: "event_rare_winter", weight: 1 },
        { defId: "event_oxen", weight: 10 },
        { defId: "event_hippos", weight: 10 },
        { defId: "event_migratory_birds", weight: 50 },
        { defId: "event_fish_school", weight: 50 },
        { defId: "event_storm", weight: 1 },
      ],
    },
  },

  // Dummy tiles for testing purposes

    tile_dunes: {
    id: "tile_dunes",
    kind: "envTile",
    name: "Dunes",
    ui: { description: "Shifting sands and sparse shelter." },
    baseTags: ["mineable", "herdable"],
    seasonTables: {
      spring: [
        { defId: "event_common_spring", weight: 100 },
        { defId: "event_uncommon_spring", weight: 20 },
        { defId: "event_rare_spring", weight: 1 },        
        { defId: "event_duststorm", weight: 3 },
      ],
      summer: [
        { defId: "event_common_summer", weight: 100 },
        { defId: "event_uncommon_summer", weight: 20 },
        { defId: "event_rare_summer", weight: 1 },
        { defId: "event_heatwave", weight: 3 },
        { defId: "event_duststorm", weight: 3 },
      ],
      autumn: [
        { defId: "event_common_autumn", weight: 100 },
        { defId: "event_uncommon_autumn", weight: 20 },
        { defId: "event_rare_autumn", weight: 1 },
        { defId: "event_duststorm", weight: 2 },
      ],
      winter: [
        { defId: "event_common_winter", weight: 100 },
        { defId: "event_uncommon_winter", weight: 20 },
        { defId: "event_rare_winter", weight: 1 },
        { defId: "event_duststorm", weight: 1 },
      ],
    },
  },

  tile_highlands: {
    id: "tile_highlands",
    kind: "envTile",
    name: "Highlands",
    ui: { description: "Rocky uplands with sparse turf." },
    baseTags: ["mineable", "herdable"],
    seasonTables: {
      spring: [
        { defId: "event_common_spring", weight: 100 },
        { defId: "event_uncommon_spring", weight: 20 },
        { defId: "event_rare_spring", weight: 1 },
        { defId: "event_insect_swarm", weight: 1 },
      ],
      summer: [
        { defId: "event_common_summer", weight: 100 },
        { defId: "event_uncommon_summer", weight: 20 },
        { defId: "event_rare_summer", weight: 1 },
        { defId: "event_heatwave", weight: 2 },
      ],
      autumn: [
        { defId: "event_common_autumn", weight: 100 },
        { defId: "event_uncommon_autumn", weight: 20 },
        { defId: "event_rare_autumn", weight: 1 },
        { defId: "event_crocodile", weight: 1 },
      ],
      winter: [
        { defId: "event_common_winter", weight: 100 },
        { defId: "event_uncommon_winter", weight: 20 },
        { defId: "event_rare_winter", weight: 1 },
        { defId: "event_hippos", weight: 1 },
      ],
    },
  },
  tile_steppe: {
    id: "tile_steppe",
    kind: "envTile",
    name: "Steppe",
    ui: { description: "Open grasslands with scattered shrubs." },
    baseTags: ["herdable", "farmable"],
    seasonTables: {
      spring: [
        { defId: "event_common_spring", weight: 100 },
        { defId: "event_uncommon_spring", weight: 20 },
        { defId: "event_rare_spring", weight: 1 },        
        { defId: "event_bloom", weight: 2 },
        { defId: "event_insect_swarm", weight: 1 },
      ],
      summer: [
        { defId: "event_common_summer", weight: 100 },
        { defId: "event_uncommon_summer", weight: 20 },
        { defId: "event_rare_summer", weight: 1 },
        { defId: "event_heatwave", weight: 2 },
      ],
      autumn: [
        { defId: "event_common_autumn", weight: 100 },
        { defId: "event_uncommon_autumn", weight: 20 },
        { defId: "event_rare_autumn", weight: 1 },
        { defId: "event_crocodile", weight: 1 },
      ],
      winter: [
        { defId: "event_common_winter", weight: 100 },
        { defId: "event_uncommon_winter", weight: 20 },
        { defId: "event_rare_winter", weight: 1 },
        { defId: "event_hippos", weight: 1 },
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
        { defId: "event_common_spring", weight: 100 },
        { defId: "event_uncommon_spring", weight: 20 },
        { defId: "event_rare_spring", weight: 1 },
        { defId: "event_rain", weight: 20 },
        { defId: "event_fish_school", weight: 4 },
      ],
      summer: [
        { defId: "event_common_summer", weight: 100 },
        { defId: "event_uncommon_summer", weight: 20 },
        { defId: "event_rare_summer", weight: 1 },
        { defId: "event_fish_school", weight: 4 },
      ],
      autumn: [
        { defId: "event_common_autumn", weight: 100 },
        { defId: "event_uncommon_autumn", weight: 20 },
        { defId: "event_rare_autumn", weight: 1 },
        { defId: "event_flooding", weight: 50 },
        { defId: "event_migratory_birds", weight: 2 },
      ],
      winter: [
        { defId: "event_common_winter", weight: 100 },
        { defId: "event_uncommon_winter", weight: 20 },
        { defId: "event_rare_winter", weight: 1 },
        { defId: "event_fish_school", weight: 2 },
      ],
    },
  },
};

ensureTooltipCardUi(envTileDefs);
