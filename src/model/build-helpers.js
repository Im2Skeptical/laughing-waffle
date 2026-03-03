// build-helpers.js
// Shared helpers for hub construction validation (pure, no mutation).

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { computeAvailableRecipesAndBuildings } from "./skills.js";

export function normalizeHubCol(value) {
  return Number.isFinite(value) ? Math.floor(value) : null;
}

export function normalizeBuildRequirements(defOrReqs) {
  const raw = Array.isArray(defOrReqs?.build?.requirements)
    ? defOrReqs.build.requirements
    : Array.isArray(defOrReqs)
      ? defOrReqs
      : [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const amountRaw = entry.amount;
    const amount = Number.isFinite(amountRaw)
      ? Math.max(0, Math.floor(amountRaw))
      : 0;
    if (amount <= 0) continue;

    const kind =
      typeof entry.kind === "string" && entry.kind.length
        ? entry.kind
        : null;
    const itemId =
      typeof entry.itemId === "string" && entry.itemId.length
        ? entry.itemId
        : null;
    const tag =
      typeof entry.tag === "string" && entry.tag.length
        ? entry.tag
        : typeof entry.itemTag === "string" && entry.itemTag.length
          ? entry.itemTag
          : null;
    const resource =
      typeof entry.resource === "string" && entry.resource.length
        ? entry.resource
        : null;

    if (kind === "item" || (!kind && itemId)) {
      if (!itemId) continue;
      out.push({ kind: "item", itemId, amount });
      continue;
    }
    if (kind === "tag" || (!kind && tag)) {
      if (!tag) continue;
      out.push({ kind: "tag", tag, amount });
      continue;
    }
    if (kind === "resource" || (!kind && resource)) {
      if (!resource) continue;
      out.push({ kind: "resource", resource, amount });
      continue;
    }
  }
  return out;
}

export function buildRequirementProgress(requirements) {
  const reqs = normalizeBuildRequirements(requirements);
  return reqs.map((req) => ({
    ...req,
    progress: 0,
  }));
}

export function getStructureSpan(def) {
  const span =
    Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
      ? Math.floor(def.defaultSpan)
      : 1;
  return Math.max(1, span);
}

export function getMaxInstances(def) {
  const max = Number.isFinite(def?.maxInstances)
    ? Math.floor(def.maxInstances)
    : 1;
  return Math.max(0, max);
}

export function countStructuresByDefId(state, defId) {
  if (!state || !state.hub || !Array.isArray(state.hub.slots)) return 0;
  let count = 0;
  for (const slot of state.hub.slots) {
    const structure = slot?.structure;
    if (!structure) continue;
    if (structure.defId === defId) count += 1;
  }
  return count;
}

export function getBuildProcess(structure) {
  const processes = Array.isArray(structure?.systemState?.build?.processes)
    ? structure.systemState.build.processes
    : [];
  for (const process of processes) {
    if (process?.type === "build") return process;
  }
  return null;
}

export function isStructureUnderConstruction(structure) {
  return !!getBuildProcess(structure);
}

function normalizeBuildPlacementMode(def) {
  const modeRaw = def?.build?.placementMode;
  return modeRaw === "upgrade" ? "upgrade" : "new";
}

function normalizeUpgradeFromDefIds(def) {
  const raw = Array.isArray(def?.build?.upgradeFromDefIds)
    ? def.build.upgradeFromDefIds
    : [];
  return raw.filter((id) => typeof id === "string" && id.length > 0);
}

function getHubStructureAtCol(state, hubCol) {
  const col = normalizeHubCol(hubCol);
  if (col == null) return null;
  const occ = Array.isArray(state?.hub?.occ) ? state.hub.occ : null;
  if (occ && occ[col]) return occ[col];
  const slot = Array.isArray(state?.hub?.slots) ? state.hub.slots[col] : null;
  return slot?.structure ?? null;
}

export function validateHubConstructionPlacement(state, defId, hubCol) {
  if (!state || !state.hub || !Array.isArray(state.hub.slots)) {
    return { ok: false, reason: "noHub" };
  }
  if (!defId || typeof defId !== "string") {
    return { ok: false, reason: "badDefId" };
  }
  const def = hubStructureDefs[defId];
  if (!def) return { ok: false, reason: "unknownDef" };

  const availability = computeAvailableRecipesAndBuildings(state);
  if (!availability.hubStructureIds?.has(defId)) {
    return { ok: false, reason: "structureLocked" };
  }

  const col = normalizeHubCol(hubCol);
  if (col == null) return { ok: false, reason: "badHubCol" };

  const cols = state.hub.slots.length;
  const span = getStructureSpan(def);
  const placementMode = normalizeBuildPlacementMode(def);
  const upgradeFromDefIds = normalizeUpgradeFromDefIds(def);
  const sourceStructure =
    placementMode === "upgrade" ? getHubStructureAtCol(state, col) : null;
  const sourceDefId =
    placementMode === "upgrade" && typeof sourceStructure?.defId === "string"
      ? sourceStructure.defId
      : null;
  const anchorCol =
    placementMode === "upgrade" && Number.isFinite(sourceStructure?.col)
      ? Math.floor(sourceStructure.col)
      : col;

  if (anchorCol < 0 || anchorCol >= cols) return { ok: false, reason: "badHubCol" };
  if (anchorCol + span > cols) return { ok: false, reason: "spanOutOfBounds" };

  if (placementMode === "upgrade") {
    if (!sourceStructure) {
      return { ok: false, reason: "noUpgradeSource" };
    }
    if (
      upgradeFromDefIds.length > 0 &&
      !upgradeFromDefIds.includes(sourceStructure.defId)
    ) {
      return {
        ok: false,
        reason: "upgradeSourceMismatch",
        sourceDefId,
        upgradeFromDefIds,
      };
    }
    if (isStructureUnderConstruction(sourceStructure)) {
      return { ok: false, reason: "upgradeSourceUnderConstruction" };
    }
  }

  const maxInstances = getMaxInstances(def);
  if (maxInstances > 0) {
    const existing = countStructuresByDefId(state, defId);
    const nextCount =
      existing +
      (placementMode === "upgrade" && sourceDefId === defId ? 0 : 1);
    if (nextCount > maxInstances) {
      return {
        ok: false,
        reason: "maxInstancesReached",
        maxInstances,
        existing,
        nextCount,
      };
    }
  }

  const occ = Array.isArray(state.hub.occ) ? state.hub.occ : null;
  for (let offset = 0; offset < span; offset++) {
    const index = anchorCol + offset;
    const occupied = occ ? occ[index] : state.hub.slots[index]?.structure;
    if (!occupied) continue;
    const sameUpgradeSource =
      placementMode === "upgrade" &&
      sourceStructure &&
      occupied.instanceId === sourceStructure.instanceId;
    if (!sameUpgradeSource) {
      return { ok: false, reason: "slotOccupied", hubCol: index };
    }
  }

  return {
    ok: true,
    def,
    hubCol: anchorCol,
    span,
    placementMode,
    upgradeFromDefIds,
    sourceDefId,
    sourceStructureId: sourceStructure?.instanceId ?? null,
  };
}
