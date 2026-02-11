import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { LEADER_EQUIPMENT_SLOT_ORDER } from "../defs/gamesystems/equipment-slot-defs.js";

function normalizeString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolveItemKind(itemOrKind) {
  if (!itemOrKind) return null;
  if (typeof itemOrKind === "string") return itemOrKind;
  if (typeof itemOrKind === "object") {
    return normalizeString(itemOrKind.kind);
  }
  return null;
}

function normalizeProviderSpec(raw) {
  if (!raw || typeof raw !== "object") return null;
  const systemId = normalizeString(raw.systemId || raw.system);
  const poolKey = normalizeString(raw.poolKey);
  if (!systemId || !poolKey) return null;
  const requiresEquipped =
    raw?.requires?.equipped === true || raw?.requiresEquipped === true;
  return {
    systemId,
    poolKey,
    requires: { equipped: requiresEquipped },
  };
}

export function getItemPoolProviders(itemOrKind) {
  const kind = resolveItemKind(itemOrKind);
  if (!kind) return [];
  const def = itemDefs?.[kind];
  if (!def || typeof def !== "object") return [];

  const raw =
    Array.isArray(def.poolProviders)
      ? def.poolProviders
      : def.poolProviders && typeof def.poolProviders === "object"
        ? [def.poolProviders]
        : def.poolProvider && typeof def.poolProvider === "object"
          ? [def.poolProvider]
          : [];

  const out = [];
  for (const spec of raw) {
    const normalized = normalizeProviderSpec(spec);
    if (!normalized) continue;
    out.push(normalized);
  }
  return out;
}

export function itemProvidesPool(itemOrKind, systemId, poolKey) {
  const sys = normalizeString(systemId);
  const key = normalizeString(poolKey);
  if (!sys || !key) return false;
  const providers = getItemPoolProviders(itemOrKind);
  return providers.some((spec) => spec.systemId === sys && spec.poolKey === key);
}

export function ownerHasEquippedPoolProvider(owner, systemId, poolKey) {
  if (!owner || !systemId || !poolKey) return false;
  const equipment =
    owner?.equipment && typeof owner.equipment === "object" ? owner.equipment : null;
  if (!equipment) return false;

  for (const item of Object.values(equipment)) {
    if (!item || typeof item !== "object") continue;
    if (itemProvidesPool(item, systemId, poolKey)) return true;
  }
  return false;
}

export function findEquippedPoolProviderEntry(
  owner,
  systemId,
  poolKey,
  preferredSlotId = null
) {
  if (!owner || !systemId || !poolKey) return null;
  const equipment =
    owner?.equipment && typeof owner.equipment === "object" ? owner.equipment : null;
  if (!equipment) return null;

  const scanSlot = (slotId) => {
    const item = equipment?.[slotId] ?? null;
    if (!item || typeof item !== "object") return null;
    if (!itemProvidesPool(item, systemId, poolKey)) return null;
    return { slotId, item };
  };

  if (normalizeString(preferredSlotId)) {
    const preferred = scanSlot(preferredSlotId);
    if (preferred) return preferred;
  }

  for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
    const entry = scanSlot(slotId);
    if (entry) return entry;
  }

  return null;
}

export function poolProviderRequiresEquipped(systemId, poolKey) {
  const sys = normalizeString(systemId);
  const key = normalizeString(poolKey);
  if (!sys || !key) return false;
  for (const kind of Object.keys(itemDefs || {})) {
    const providers = getItemPoolProviders(kind);
    if (!providers.length) continue;
    for (const spec of providers) {
      if (spec.systemId !== sys || spec.poolKey !== key) continue;
      if (spec?.requires?.equipped === true) return true;
    }
  }
  return false;
}
