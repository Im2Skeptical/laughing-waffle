import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { computeAvailableRecipesAndBuildings, hasEnvTagUnlock } from "../skills.js";
import {
  getProcessDefForInstance,
} from "../process-framework.js";
import { ensureLocationNamesState } from "../state.js";
import {
  ensureGrowthState,
  ensureHubSystemState,
  ensureHydrationState,
} from "./system-state-helpers.js";

const MAX_AREA_NAME_LENGTH = 32;

function sanitizeAreaNameInput(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed.length) return null;
  return trimmed.slice(0, MAX_AREA_NAME_LENGTH);
}

export function cmdSetTileCropSelection(state, { envCol, cropId } = {}) {
  if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
  const col = Math.floor(envCol);
  const tile = state.board?.occ?.tile?.[col];
  if (!tile) return { ok: false, reason: "noTile" };
  const tags = Array.isArray(tile.tags) ? tile.tags : [];
  if (!tags.includes("farmable")) {
    return { ok: false, reason: "notFarmable" };
  }
  if (!hasEnvTagUnlock(state, "farmable")) {
    return { ok: false, reason: "tagLocked" };
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

function cloneRequirementsForProcess(requirements) {
  const list = Array.isArray(requirements) ? requirements : [];
  return list
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      amount: Math.max(0, Math.floor(entry.amount ?? 0)),
      progress: Math.max(0, Math.floor(entry.progress ?? 0)),
      consume: entry.consume !== false,
    }));
}

function ensureSelectedRecipeProcess(state, structure, systemId, recipeId) {
  if (!state || !structure || !systemId || !recipeId) {
    return { changed: false, processId: null };
  }
  const systemState = ensureHubSystemState(structure, systemId);
  if (!Array.isArray(systemState.processes)) {
    systemState.processes = [];
  }
  const processes = systemState.processes;
  const existing = processes.find((proc) => proc?.type === recipeId) || null;
  if (existing) {
    let changed = false;
    const existingDef = getProcessDefForInstance(existing, structure, {
      target: structure,
      systemId,
      state,
    });
    if (
      (!Array.isArray(existing.requirements) || existing.requirements.length === 0) &&
      Array.isArray(existingDef?.transform?.requirements) &&
      existingDef.transform.requirements.length > 0
    ) {
      existing.requirements = cloneRequirementsForProcess(
        existingDef.transform.requirements
      );
      changed = true;
    }
    return { changed, processId: existing.id };
  }

  const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
  const durationSec = Number.isFinite(recipeDefs?.[recipeId]?.durationSec)
    ? Math.max(1, Math.floor(recipeDefs[recipeId].durationSec))
    : 1;
  const processId = `proc_${structure.instanceId}_${systemId}_${recipeId}_${nowSec}_${processes.length}`;
  const process = {
    id: processId,
    type: recipeId,
    mode: "work",
    durationSec,
    progress: 0,
    startSec: nowSec,
    ownerId: structure.instanceId ?? null,
    completionPolicy: "none",
  };
  const processDef = getProcessDefForInstance(process, structure, {
    target: structure,
    systemId,
    state,
  });
  if (
    Array.isArray(processDef?.transform?.requirements) &&
    processDef.transform.requirements.length > 0
  ) {
    process.requirements = cloneRequirementsForProcess(
      processDef.transform.requirements
    );
  }
  processes.push(process);
  return { changed: true, processId: process.id };
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
  const recipeSystemKind = getRecipeKindForHubSystem(systemId);
  if (systemState.selectedRecipeId === nextRecipeId) {
    const ensureRes =
      nextRecipeId != null && recipeSystemKind
        ? ensureSelectedRecipeProcess(state, structure, systemId, nextRecipeId)
        : { changed: false, processId: null };
    return {
      ok: true,
      result: "recipeUnchanged",
      hubCol: col,
      systemId,
      recipeId: nextRecipeId,
      processId: ensureRes.processId,
      processInitialized: ensureRes.changed,
    };
  }

  systemState.selectedRecipeId = nextRecipeId;
  const ensureRes =
    nextRecipeId != null && recipeSystemKind
      ? ensureSelectedRecipeProcess(state, structure, systemId, nextRecipeId)
      : { changed: false, processId: null };
  return {
    ok: true,
    result: "recipeSelected",
    hubCol: col,
    systemId,
    recipeId: nextRecipeId,
    processId: ensureRes.processId,
    processInitialized: ensureRes.changed,
  };
}

export function cmdSetRegionName(state, { name } = {}) {
  const nextName = sanitizeAreaNameInput(name);
  if (!nextName) return { ok: false, reason: "badRegionName" };
  const locationNames = ensureLocationNamesState(state);
  if (locationNames.region === nextName) {
    return { ok: true, result: "regionNameUnchanged", name: nextName };
  }
  locationNames.region = nextName;
  return { ok: true, result: "regionNameSet", name: nextName };
}

export function cmdSetHubName(state, { name } = {}) {
  const nextName = sanitizeAreaNameInput(name);
  if (!nextName) return { ok: false, reason: "badHubName" };
  const locationNames = ensureLocationNamesState(state);
  if (locationNames.hub === nextName) {
    return { ok: true, result: "hubNameUnchanged", name: nextName };
  }
  locationNames.hub = nextName;
  return { ok: true, result: "hubNameSet", name: nextName };
}
