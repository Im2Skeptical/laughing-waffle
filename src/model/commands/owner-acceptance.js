import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { isStructureUnderConstruction } from "../build-helpers.js";

function getOwnerKindAndDef(state, ownerId) {
  const normalizedOwnerId =
    typeof ownerId === "string" && !ownerId.startsWith("inv:process:")
      ? Number.isFinite(Number(ownerId))
        ? Number(ownerId)
        : ownerId
      : ownerId;
  if (typeof ownerId === "string" && ownerId.startsWith("inv:process:")) {
    return { kind: "processBuffer", def: null };
  }
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    if (slot.structure && slot.structure.instanceId === normalizedOwnerId) {
      const def = hubStructureDefs[slot.structure.defId];
      return { kind: "hubStructure", def, structure: slot.structure };
    }
  }

  const pawn = state.pawns.find((candidatePawn) => candidatePawn.id === normalizedOwnerId);
  if (pawn) return { kind: "pawn", def: null };

  return { kind: null, def: null };
}

function itemHasAnyTag(item, tags) {
  if (!tags || tags.length === 0) return false;
  const itemTags = Array.isArray(item?.tags) ? item.tags : [];
  return tags.some((t) => itemTags.includes(t));
}

export function canOwnerAcceptItem(state, ownerId, item) {
  const { kind, def, structure } = getOwnerKindAndDef(state, ownerId);

  if (kind === "pawn") {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    if (tags.includes("waste")) return false;
    return true;
  }

  if (kind === "processBuffer") {
    return true;
  }

  if (kind === "hubStructure" && def) {
    if (isStructureUnderConstruction(structure)) return true;
    const rules = def.inventoryRules;
    if (!rules) return true;
    if (rules.allowedAll) return true;

    if (rules.allowedItemTags && rules.allowedItemTags.length > 0) {
      if (!itemHasAnyTag(item, rules.allowedItemTags)) return false;
    }

    return true;
  }

  return false;
}
