// scroll-timegraph-defs.js
// Shared defs for V1 scroll-based timegraph items/recipes.

export const SCROLL_GRAPH_DEFAULT_HORIZON_SEC = 120;
export const SCROLL_GRAPH_DEFAULT_HISTORY_WINDOW_SEC = 120;

export const SCROLL_GRAPH_TYPE_IDS = [
  "prophecy",
  "almanac",
  "record",
  "history",
  "scripture",
];

export const SCROLL_GRAPH_SUBJECT_IDS = [
  "population",
  "grain",
  "food",
  "systems",
];

export const SCROLL_GRAPH_TYPE_DEFS = {
  prophecy: {
    id: "prophecy",
    name: "Prophecy Scroll",
    shortLabel: "P",
    anchoredToManufacture: true,
    requiresManufacturedSec: true,
    frozen: true,
    editable: false,
    windowMode: "future",
  },
  almanac: {
    id: "almanac",
    name: "Almanac Scroll",
    shortLabel: "A",
    anchoredToManufacture: true,
    requiresManufacturedSec: true,
    frozen: false,
    editable: false,
    windowMode: "future",
  },
  record: {
    id: "record",
    name: "Record Scroll",
    shortLabel: "R",
    anchoredToManufacture: true,
    requiresManufacturedSec: true,
    frozen: true,
    editable: false,
    windowMode: "historyWindow",
  },
  history: {
    id: "history",
    name: "History Scroll",
    shortLabel: "H",
    anchoredToManufacture: false,
    requiresManufacturedSec: false,
    frozen: false,
    editable: false,
    windowMode: "fullHistory",
  },
  scripture: {
    id: "scripture",
    name: "Scripture Scroll",
    shortLabel: "S",
    anchoredToManufacture: false,
    requiresManufacturedSec: false,
    frozen: false,
    editable: true,
    windowMode: "rollingEditable",
  },
};

export const SCROLL_GRAPH_SUBJECT_DEFS = {
  population: {
    id: "population",
    name: "Population",
    metricId: "population",
    color: 0x7f7dcb,
    shortLabel: "Pop",
  },
  grain: {
    id: "grain",
    name: "Grain",
    metricId: "grain",
    color: 0xb39354,
    shortLabel: "Grn",
  },
  food: {
    id: "food",
    name: "Food",
    metricId: "food",
    color: 0x699e64,
    shortLabel: "Fod",
  },
  systems: {
    id: "systems",
    name: "Systems",
    metricId: null,
    color: 0x6c9fbf,
    shortLabel: "Sys",
  },
};

function capitalize(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function makeScrollItemKind(typeId, subjectId) {
  return `${typeId}${capitalize(subjectId)}Scroll`;
}

export function makeScrollRecipeId(typeId, subjectId) {
  return `craft${capitalize(typeId)}${capitalize(subjectId)}Scroll`;
}

export function buildScrollTimegraphState(typeId, subjectId) {
  const typeDef = SCROLL_GRAPH_TYPE_DEFS[typeId] || null;
  const subjectDef = SCROLL_GRAPH_SUBJECT_DEFS[subjectId] || null;
  if (!typeDef || !subjectDef) return null;

  return {
    version: 1,
    scrollType: typeDef.id,
    subject: subjectDef.id,
    metricId: subjectDef.metricId,
    scrollName: typeDef.name,
    subjectName: subjectDef.name,
    windowMode: typeDef.windowMode,
    anchoredToManufacture: typeDef.anchoredToManufacture,
    requiresManufacturedSec: typeDef.requiresManufacturedSec,
    manufacturedSec: 0,
    horizonSec: SCROLL_GRAPH_DEFAULT_HORIZON_SEC,
    historyWindowSec: SCROLL_GRAPH_DEFAULT_HISTORY_WINDOW_SEC,
    frozen: typeDef.frozen,
    editable: typeDef.editable,
  };
}
