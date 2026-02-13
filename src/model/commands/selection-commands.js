import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { computeAvailableRecipesAndBuildings } from "../skills.js";
import {
  ensureGrowthState,
  ensureHubSystemState,
  ensureHydrationState,
} from "./system-state-helpers.js";

export function cmdSetTileCropSelection(state, { envCol, cropId } = {}) {
  if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
  const col = Math.floor(envCol);
  const tile = state.board?.occ?.tile?.[col];
  if (!tile) return { ok: false, reason: "noTile" };
  const tags = Array.isArray(tile.tags) ? tile.tags : [];
  if (!tags.includes("farmable")) {
    return { ok: false, reason: "notFarmable" };
  }

  const nextCropId = cropId == null || cropId === "" ? null : String(cropId);
  if (nextCropId && !cropDefs[nextCropId]) {
    return { ok: false, reason: "badCropId" };
  }

  const growth = ensureGrowthState(tile);
  if (growth.selectedCropId === nextCropId) {
    return { ok: true, result: "cropUnchanged", envCol: col };
  }

  growth.selectedCropId = nextCropId;
  if (nextCropId) {
    ensureHydrationState(tile);
  }

  return {
    ok: true,
    result: "cropSelected",
    envCol: col,
    cropId: nextCropId,
  };
}

function getRecipeKindForHubSystem(systemId) {
  if (systemId === "fireplace") return "cook";
  if (systemId === "workspace") return "craft";
  return null;
}

export function cmdSetHubRecipeSelection(state, { hubCol, systemId, recipeId } = {}) {
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  if (!systemId || typeof systemId !== "string") {
    return { ok: false, reason: "badSystemId" };
  }

  const col = Math.floor(hubCol);
  const structure = state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };

  const hasSystem =
    structure.systemState?.[systemId] ||
    Object.prototype.hasOwnProperty.call(structure.systemTiers || {}, systemId);
  if (!hasSystem) return { ok: false, reason: "missingSystem" };

  const nextRecipeId = recipeId == null || recipeId === "" ? null : String(recipeId);
  if (nextRecipeId) {
    const def = recipeDefs[nextRecipeId];
    if (!def) return { ok: false, reason: "badRecipeId" };
    const availability = computeAvailableRecipesAndBuildings(state);
    if (!availability.recipeIds?.has(nextRecipeId)) {
      return { ok: false, reason: "recipeLocked" };
    }
    const expectedKind = getRecipeKindForHubSystem(systemId);
    if (expectedKind && def.kind !== expectedKind) {
      return { ok: false, reason: "badRecipeKind" };
    }
  }

  const systemState = ensureHubSystemState(structure, systemId);
  if (!Object.prototype.hasOwnProperty.call(systemState, "selectedRecipeId")) {
    systemState.selectedRecipeId = null;
  }
  if (systemState.selectedRecipeId === nextRecipeId) {
    return {
      ok: true,
      result: "recipeUnchanged",
      hubCol: col,
      systemId,
      recipeId: nextRecipeId,
    };
  }

  systemState.selectedRecipeId = nextRecipeId;
  return {
    ok: true,
    result: "recipeSelected",
    hubCol: col,
    systemId,
    recipeId: nextRecipeId,
  };
}
