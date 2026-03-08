import {
  buildRequirementProgress,
  isStructureUnderConstruction,
  validateHubConstructionPlacement,
} from "../build-helpers.js";
import { runEffect } from "../effects/index.js";
import {
  ensureHubState,
  makeHubStructureInstance,
  rebuildHubOccupancy,
} from "../state.js";

function clearStructureBuildTagState(structure) {
  if (!structure?.tagStates || typeof structure.tagStates !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(structure.tagStates, "build")) return;
  delete structure.tagStates.build;
  if (Object.keys(structure.tagStates).length <= 0) {
    delete structure.tagStates;
  }
}

function ensureBuildTag(structure) {
  if (!structure || typeof structure !== "object") return;
  const tags = Array.isArray(structure.tags) ? structure.tags.slice() : [];
  if (!tags.includes("build")) tags.push("build");
  structure.tags = tags;
  clearStructureBuildTagState(structure);
}

function startBuildProcess(state, structure, buildDefId, def, sourceDefId = null) {
  const laborRaw = def?.build?.laborSec ?? def?.build?.labor ?? 0;
  const laborSec = Number.isFinite(laborRaw)
    ? Math.max(0, Math.floor(laborRaw))
    : 0;
  const durationSec = Math.max(1, laborSec);
  const requirements = buildRequirementProgress(def);

  if (!structure.systemState || typeof structure.systemState !== "object") {
    structure.systemState = {};
  }
  structure.systemState.build = { processes: [] };

  runEffect(
    state,
    {
      op: "CreateWorkProcess",
      system: "build",
      queueKey: "processes",
      processType: "build",
      mode: "work",
      durationSec,
      uniqueType: true,
      completionPolicy: "build",
      requirements,
      processMeta: {
        buildKind: "hubStructure",
        buildDefId,
        buildSourceDefId: sourceDefId,
      },
    },
    {
      kind: "build",
      state,
      source: structure,
      tSec: state?.tSec ?? 0,
      ownerId: structure.instanceId,
      owner: structure,
    }
  );
}

function findHubStructureById(state, structureId) {
  if (structureId == null) return null;
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    const structure = slot?.structure;
    if (!structure) continue;
    if (structure.instanceId === structureId) return structure;
  }
  return null;
}

export function cmdBuildDesignate(state, payload = {}) {
  const defId = payload.defId ?? null;
  const target = payload.target ?? {};
  const hubCol = payload.hubCol ?? target.hubCol ?? target.col ?? null;

  const validity = validateHubConstructionPlacement(state, defId, hubCol);
  if (!validity?.ok) return validity || { ok: false, reason: "badPlacement" };

  const def = validity.def;
  const col = validity.hubCol;
  const placementMode = validity.placementMode === "upgrade" ? "upgrade" : "new";
  const sourceDefId =
    typeof validity.sourceDefId === "string" ? validity.sourceDefId : null;

  if (placementMode === "upgrade") {
    const existingAtCol =
      state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure ?? null;
    const structure =
      existingAtCol?.instanceId === validity.sourceStructureId
        ? existingAtCol
        : findHubStructureById(state, validity.sourceStructureId);
    if (!structure) return { ok: false, reason: "noUpgradeSource" };

    ensureBuildTag(structure);
    startBuildProcess(state, structure, defId, def, sourceDefId);

    ensureHubState(state);
    rebuildHubOccupancy(state);

    return {
      ok: true,
      result: "buildUpgradeDesignated",
      defId,
      sourceDefId,
      hubCol: col,
      structureId: structure.instanceId,
    };
  }

  const tier = typeof payload.tier === "string" ? payload.tier : null;
  const structure = makeHubStructureInstance(defId, state, { tier });
  structure.tags = ["build"];
  if (structure.tagStates) delete structure.tagStates;
  startBuildProcess(state, structure, defId, def);

  const slot = state.hub.slots[col];
  if (slot && typeof slot === "object") {
    slot.structure = structure;
  } else {
    state.hub.slots[col] = { structure };
  }

  ensureHubState(state);
  rebuildHubOccupancy(state);

  return {
    ok: true,
    result: "buildDesignated",
    defId,
    hubCol: col,
    structureId: structure.instanceId,
  };
}

export function cmdCancelBuild(state, payload = {}) {
  if (!state?.hub || !Array.isArray(state.hub.slots)) {
    return { ok: false, reason: "noHub" };
  }
  const target = payload.target ?? {};
  const hubCol = payload.hubCol ?? target.hubCol ?? target.col ?? null;
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  const col = Math.floor(hubCol);

  const structure = state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };
  const buildProcess = isStructureUnderConstruction(structure)
    ? structure?.systemState?.build?.processes?.find((process) => process?.type === "build") ?? null
    : null;
  if (!buildProcess) {
    return { ok: false, reason: "notUnderConstruction" };
  }
  if (buildProcess.allowCancel === false) {
    return { ok: false, reason: "buildCancelLocked" };
  }

  const anchorCol = Number.isFinite(structure.col) ? Math.floor(structure.col) : col;

  const slot = state.hub.slots[anchorCol];
  if (slot?.structure?.instanceId === structure.instanceId) {
    slot.structure = null;
  } else {
    for (const s of state.hub.slots) {
      if (s?.structure?.instanceId === structure.instanceId) {
        s.structure = null;
        break;
      }
    }
  }

  if (state.ownerInventories) {
    delete state.ownerInventories[structure.instanceId];
  }

  rebuildHubOccupancy(state);

  return {
    ok: true,
    result: "buildCancelled",
    defId: structure.defId,
    hubCol: anchorCol,
    structureId: structure.instanceId,
  };
}
