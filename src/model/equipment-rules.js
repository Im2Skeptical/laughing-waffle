// equipment-rules.js
// Authoritative equipment validation and helpers.

import {
  LEADER_EQUIPMENT_SLOT_ALIAS_MAP,
  LEADER_EQUIPMENT_SLOT_ORDER,
} from "../defs/gamesystems/equipment-slot-defs.js";

function normalizeSlotToken(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

export function isLeaderEquipmentSlotId(slotId) {
  return LEADER_EQUIPMENT_SLOT_ORDER.includes(slotId);
}

export function createEmptyLeaderEquipment() {
  return {
    head: null,
    chest: null,
    mainHand: null,
    offHand: null,
    ring1: null,
    ring2: null,
    amulet: null,
  };
}

export function expandWearableSlotToken(slotToken) {
  const token = normalizeSlotToken(slotToken);
  if (!token) return [];
  const direct =
    LEADER_EQUIPMENT_SLOT_ALIAS_MAP[token] ||
    LEADER_EQUIPMENT_SLOT_ALIAS_MAP[token.toLowerCase()];
  if (!direct || !direct.length) {
    return isLeaderEquipmentSlotId(token) ? [token] : [];
  }
  return direct.slice();
}

export function getItemWearableSlots(item) {
  const out = [];
  const seen = new Set();

  const pushSlot = (slotId) => {
    if (!isLeaderEquipmentSlotId(slotId)) return;
    if (seen.has(slotId)) return;
    seen.add(slotId);
    out.push(slotId);
  };

  const wearableState =
    item?.systemState?.wearable && typeof item.systemState.wearable === "object"
      ? item.systemState.wearable
      : null;

  const rawSlots = [];
  if (Array.isArray(wearableState?.slots)) {
    rawSlots.push(...wearableState.slots);
  }
  if (wearableState?.slot != null) {
    rawSlots.push(wearableState.slot);
  }

  for (const raw of rawSlots) {
    const expanded = expandWearableSlotToken(raw);
    for (const slotId of expanded) {
      pushSlot(slotId);
    }
  }

  return out;
}

export function canItemEquipInSlot(item, slotId) {
  if (!item || !isLeaderEquipmentSlotId(slotId)) return false;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (!tags.includes("wearable")) return false;
  const slots = getItemWearableSlots(item);
  return slots.includes(slotId);
}
