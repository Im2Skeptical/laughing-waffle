import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { computeAvailableRecipesAndBuildings, hasEnvTagUnlock } from "../skills.js";
import {
  buildRecipePriorityFromSelectedRecipe,
  ensureRecipePriorityState,
  getEnabledRecipeIds,
  getRecipeKindForHubSystem,
  getTopEnabledRecipeId,
  normalizeRecipePriority,
  recipePrioritiesEqual,
} from "../recipe-priority.js";
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

export function cmdSetTileCropSelection(state, payload = {}) {
  const { envCol, cropId } = payload || {};
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

  const hasPriorityPayload = payload.recipePriority != null;
  const hasCropIdPayload = Object.prototype.hasOwnProperty.call(payload, "cropId");
  if (!hasPriorityPayload && !hasCropIdPayload) {
    return { ok: false, reason: "missingSelectionPayload" };
  }

  if (hasPriorityPayload) {
    const recipePriorityRaw = payload.recipePriority;
    if (recipePriorityRaw && typeof recipePriorityRaw === "object") {
      const orderedRaw = Array.isArray(recipePriorityRaw.ordered)
        ? recipePriorityRaw.ordered
        : [];
      for (const rawId of orderedRaw) {
        const cropIdFromPriority =
          rawId == null || rawId === "" ? null : String(rawId);
        if (!cropIdFromPriority) continue;
        if (!cropDefs[cropIdFromPriority]) {
          return { ok: false, reason: "badCropId", cropId: cropIdFromPriority };
        }
      }
    }
  }

  const cropIdRaw = hasCropIdPayload ? payload.cropId : cropId;
  const nextCropId = cropIdRaw == null || cropIdRaw === "" ? null : String(cropIdRaw);
  if (nextCropId && !cropDefs[nextCropId]) {
    return { ok: false, reason: "badCropId", cropId: nextCropId };
  }

  const growth = ensureGrowthState(tile);
  const currentPriority = ensureRecipePriorityState(growth, {
    systemId: "growth",
    state,
    includeLocked: false,
  });
  let nextPriority = { ordered: [], enabled: {} };
  if (hasPriorityPayload) {
    nextPriority = normalizeRecipePriority(payload.recipePriority, {
      systemId: "growth",
      state,
      includeLocked: false,
    });
  } else {
    nextPriority = buildRecipePriorityFromSelectedRecipe(nextCropId, {
      systemId: "growth",
      state,
      includeLocked: false,
    });
  }
  const priorityChanged = !recipePrioritiesEqual(currentPriority, nextPriority);
  if (!priorityChanged) {
    const cropIdUnchanged = getTopEnabledRecipeId(currentPriority);
    return {
      ok: true,
      result: "cropUnchanged",
      envCol: col,
      cropId: cropIdUnchanged,
      recipePriority: currentPriority,
    };
  }

  growth.recipePriority = nextPriority;
  const topCropId = getTopEnabledRecipeId(nextPriority);
  growth.selectedCropId = topCropId;
  if (topCropId) {
    ensureHydrationState(tile);
  }

  return {
    ok: true,
    result: "cropSelected",
    envCol: col,
    cropId: topCropId,
    recipePriority: nextPriority,
  };
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
      requirementType:
        typeof entry.requirementType === "string" && entry.requirementType.length > 0
          ? entry.requirementType
          : null,
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
    if (existing.completionPolicy !== "repeat") {
      existing.completionPolicy = "repeat";
      changed = true;
    }
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
    completionPolicy: "repeat",
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

function normalizeRecipePriorityPayload(
  payload,
  { systemId, state }
) {
  if (!payload || typeof payload !== "object") {
    return { ordered: [], enabled: {} };
  }
  if (payload.recipePriority != null) {
    return normalizeRecipePriority(payload.recipePriority, {
      systemId,
      state,
      includeLocked: false,
    });
  }
  if (Object.prototype.hasOwnProperty.call(payload, "recipeId")) {
    return buildRecipePriorityFromSelectedRecipe(payload.recipeId, {
      systemId,
      state,
      includeLocked: false,
    });
  }
  return { ordered: [], enabled: {} };
}

function pruneRemovedRecipeProcesses(systemState, recipeIdsToKeep, recipeKind) {
  const processes = Array.isArray(systemState?.processes) ? systemState.processes : [];
  if (!Array.isArray(systemState?.processes)) {
    systemState.processes = [];
    return { changed: true, removedCount: 0 };
  }
  const beforeLength = processes.length;
  systemState.processes = processes.filter((proc) => {
    const recipeId = typeof proc?.type === "string" ? proc.type : null;
    if (!recipeId) return true;
    const def = recipeDefs?.[recipeId] || null;
    if (!def || def.kind !== recipeKind) return true;
    return recipeIdsToKeep.has(recipeId);
  });
  const removedCount = Math.max(0, beforeLength - systemState.processes.length);
  return { changed: removedCount > 0, removedCount };
}

function validateRecipePriorityPayload(payload, { systemId, state }) {
  const recipePriorityRaw = payload?.recipePriority;
  if (!recipePriorityRaw || typeof recipePriorityRaw !== "object") return { ok: true };
  const orderedRaw = Array.isArray(recipePriorityRaw.ordered)
    ? recipePriorityRaw.ordered
    : [];
  const expectedKind = getRecipeKindForHubSystem(systemId);
  const availability = computeAvailableRecipesAndBuildings(state);
  for (const rawId of orderedRaw) {
    const recipeId = rawId == null || rawId === "" ? null : String(rawId);
    if (!recipeId) continue;
    const def = recipeDefs?.[recipeId] || null;
    if (!def) return { ok: false, reason: "badRecipeId", recipeId };
    if (expectedKind && def.kind !== expectedKind) {
      return { ok: false, reason: "badRecipeKind", recipeId };
    }
    if (!availability.recipeIds?.has(recipeId)) {
      return { ok: false, reason: "recipeLocked", recipeId };
    }
  }
  return { ok: true };
}

export function cmdSetHubRecipeSelection(state, payload = {}) {
  const { hubCol, systemId } = payload || {};
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

  const validation = validateRecipePriorityPayload(payload, { systemId, state });
  if (!validation.ok) return validation;

  const systemState = ensureHubSystemState(structure, systemId);
  const currentPriority = ensureRecipePriorityState(systemState, {
    systemId,
    state,
    includeLocked: false,
  });
  const nextPriority = normalizeRecipePriorityPayload(payload, {
    systemId,
    state,
  });
  const recipeSystemKind = getRecipeKindForHubSystem(systemId);
  const priorityChanged = !recipePrioritiesEqual(currentPriority, nextPriority);
  systemState.recipePriority = nextPriority;
  systemState.selectedRecipeId = getTopEnabledRecipeId(nextPriority);

  const keepRecipeIds = new Set(nextPriority.ordered);
  const pruneRes =
    recipeSystemKind != null
      ? pruneRemovedRecipeProcesses(systemState, keepRecipeIds, recipeSystemKind)
      : { changed: false, removedCount: 0 };

  let processInitialized = false;
  const ensuredProcessIds = [];
  if (recipeSystemKind != null) {
    for (const recipeId of nextPriority.ordered) {
      const ensureRes = ensureSelectedRecipeProcess(
        state,
        structure,
        systemId,
        recipeId
      );
      if (ensureRes.processId) ensuredProcessIds.push(ensureRes.processId);
      if (ensureRes.changed) processInitialized = true;
    }
  }

  const enabledRecipeIds = getEnabledRecipeIds(nextPriority);
  const topRecipeId = enabledRecipeIds.length > 0 ? enabledRecipeIds[0] : null;
  return {
    ok: true,
    result: priorityChanged ? "recipeSelected" : "recipeUnchanged",
    hubCol: col,
    systemId,
    recipeId: topRecipeId,
    recipePriority: nextPriority,
    processInitialized,
    removedProcessCount: pruneRes.removedCount,
    processIds: ensuredProcessIds,
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
