// equipment-slot-defs.js
// Shared leader equipment slot schema (data-only).

export const LEADER_EQUIPMENT_SLOT_ORDER = [
  "head",
  "chest",
  "mainHand",
  "offHand",
  "ring1",
  "ring2",
  "amulet",
];

export const LEADER_EQUIPMENT_SLOT_LABELS = {
  head: "Head",
  chest: "Chest",
  mainHand: "Main Hand",
  offHand: "Off Hand",
  ring1: "Ring I",
  ring2: "Ring II",
  amulet: "Amulet",
};

const SLOT_ALIAS_MAP = {
  head: ["head"],
  helmet: ["head"],
  chest: ["chest"],
  body: ["chest"],
  armor: ["chest"],
  armour: ["chest"],
  mainHand: ["mainHand"],
  weapon: ["mainHand"],
  offHand: ["offHand"],
  shield: ["offHand"],
  ring: ["ring1", "ring2"],
  ring1: ["ring1"],
  ring2: ["ring2"],
  amulet: ["amulet"],
  necklace: ["amulet"],
};
export const LEADER_EQUIPMENT_SLOT_ALIAS_MAP = SLOT_ALIAS_MAP;
