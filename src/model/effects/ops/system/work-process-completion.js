import { envSystemDefs } from "../../../../defs/gamesystems/env-systems-defs.js";
import { envTagDefs } from "../../../../defs/gamesystems/env-tags-defs.js";
import { envTileDefs } from "../../../../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../../../../defs/gamepieces/hub-structure-defs.js";
import { cloneSerializable } from "../../core/clone.js";
import { pushGameEvent } from "../../../event-feed.js";
import { initializeInstanceFromDef } from "../../../state.js";
import { getPawnEffectiveWorkUnits } from "../../../prestige-system.js";

function normalizeTagList(tags) {
  const raw = Array.isArray(tags) ? tags : [];
  const seen = new Set();
  const out = [];
  for (const tag of raw) {
    if (typeof tag !== "string") continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function applyEnvTileDefToInstance(tile, def) {
  if (!tile || !def) return false;
  tile.defId = def.id || tile.defId;

  const tags = normalizeTagList(def.baseTags);
  tile.tags = tags;
  tile.systemTiers = {};
  tile.systemState = {};

  for (const tagId of tags) {
    const tagDef = envTagDefs[tagId];
    const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
    for (const systemId of systems) {
      if (tile.systemTiers[systemId] == null) {
        const sysDef = envSystemDefs[systemId];
        if (sysDef?.defaultTier != null) {
          tile.systemTiers[systemId] = sysDef.defaultTier;
        }
      }
      if (!tile.systemState[systemId]) {
        const sysDef = envSystemDefs[systemId];
        if (sysDef?.stateDefaults) {
          tile.systemState[systemId] = cloneSerializable(sysDef.stateDefaults);
        }
      }
    }
  }

  return true;
}

export function finalizeBuildProcess(state, target, process) {
  const buildKind = typeof process?.buildKind === "string" ? process.buildKind : null;
  if (buildKind === "envTile") {
    const defId =
      typeof process?.buildDefId === "string"
        ? process.buildDefId
        : typeof process?.resultDefId === "string"
          ? process.resultDefId
          : null;
    const def = defId ? envTileDefs[defId] : null;
    if (def && applyEnvTileDefToInstance(target, def)) {
      state._boardDirty = true;
      return true;
    }
    return false;
  }

  const defId =
    typeof process?.buildDefId === "string"
      ? process.buildDefId
      : typeof target?.defId === "string"
        ? target.defId
        : null;
  const def = defId ? hubStructureDefs[defId] : null;
  if (!def) return false;

  target.defId = defId;
  target.tags = normalizeTagList(def.tags);

  if (target.tagStates && typeof target.tagStates === "object") {
    for (const key of Object.keys(target.tagStates)) {
      if (!target.tags.includes(key)) delete target.tagStates[key];
    }
    if (Object.keys(target.tagStates).length === 0) {
      delete target.tagStates;
    }
  }

  if (target.systemState?.build) delete target.systemState.build;
  if (target.systemTiers?.build) delete target.systemTiers.build;

  initializeInstanceFromDef(target, def);
  pushGameEvent(state, {
    type: "hubBuildComplete",
    text: `${def?.name || defId || "Structure"} finished building`,
    data: {
      focusKind: "hub",
      hubCol: Number.isFinite(target?.col) ? Math.floor(target.col) : null,
      ownerId: target?.instanceId ?? null,
      structureDefId: defId,
      systemId: "build",
    },
  });
  return true;
}

function listHubWorkers(state, structure) {
  if (!structure) return [];
  const col = Number.isFinite(structure.col) ? Math.floor(structure.col) : null;
  const span =
    Number.isFinite(structure.span) && structure.span > 0
      ? Math.floor(structure.span)
      : Number.isFinite(structure.defaultSpan) && structure.defaultSpan > 0
        ? Math.floor(structure.defaultSpan)
        : 1;
  if (col == null) return [];
  const maxCol = col + span - 1;
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const out = [];
  for (const pawn of pawns) {
    if (!pawn) continue;
    if (Number.isFinite(pawn.envCol)) continue;
    const c = Number.isFinite(pawn.hubCol) ? Math.floor(pawn.hubCol) : null;
    if (c == null) continue;
    if (c >= col && c <= maxCol) out.push(pawn);
  }
  return out;
}

export function resolveHubWorkers(state, target, context) {
  if (Array.isArray(context?.hubWorkers)) return context.hubWorkers;
  return listHubWorkers(state, target);
}

export function applyWorkerCost(workers, cost) {
  if (!Array.isArray(workers) || workers.length === 0) return false;
  if (!cost || typeof cost !== "object") return false;
  const system = typeof cost.system === "string" ? cost.system : null;
  const key = typeof cost.key === "string" ? cost.key : null;
  if (!system || !key) return false;
  const amount = Number.isFinite(cost.amount) ? Math.max(0, Math.floor(cost.amount)) : 0;
  const clampMin = Number.isFinite(cost.clampMin) ? cost.clampMin : 0;
  if (amount <= 0) return false;

  let changed = false;
  for (const worker of workers) {
    if (!worker) continue;
    const systemState = worker.systemState?.[system];
    if (!systemState || typeof systemState !== "object") continue;
    const current = Number.isFinite(systemState[key])
      ? Math.floor(systemState[key])
      : 0;
    const effectiveUnits = getPawnEffectiveWorkUnits(null, worker);
    const next = Math.max(clampMin, current - amount * effectiveUnits);
    if (next !== current) {
      systemState[key] = next;
      changed = true;
    }
  }
  return changed;
}

export function countEnvWorkers(state, envCol) {
  const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
  if (col == null) return 0;
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  let n = 0;
  for (const pawn of pawns) {
    if (!pawn) continue;
    const c = Number.isFinite(pawn.envCol) ? Math.floor(pawn.envCol) : null;
    if (c === col) n += getPawnEffectiveWorkUnits(state, pawn);
  }
  return n;
}

export function rollQualityTier(state, table) {
  const entries = Array.isArray(table) ? table : [];
  if (!entries.length || typeof state?.rngNextFloat !== "function") {
    return "bronze";
  }

  let total = 0;
  for (const entry of entries) {
    total += Number.isFinite(entry?.weight) ? Math.max(0, entry.weight) : 0;
  }
  if (total <= 0) return "bronze";

  const roll = state.rngNextFloat() * total;
  let acc = 0;
  for (const entry of entries) {
    const weight = Number.isFinite(entry?.weight) ? Math.max(0, entry.weight) : 0;
    acc += weight;
    if (roll < acc) return entry?.tier ?? "bronze";
  }
  return entries[entries.length - 1]?.tier ?? "bronze";
}
