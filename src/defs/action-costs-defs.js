// src/defs/action-costs-defs.js
// Data-only AP cost definitions for planner intents and actions.

export const INTENT_AP_COSTS = {
  itemTransfer: 20,
  pawnMove: 20,
  buildDesignate: 20,
};

export const ACTION_AP_COSTS = {
  inventoryMove: 20,
  placeCharacter: 20,
  buildDesignate: 20,
  inventorySplit: 0,
  inventoryStack: 0,
};
