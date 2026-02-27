import { envSystemDefs } from "../../defs/gamesystems/env-systems-defs.js";
import { hubSystemDefs } from "../../defs/gamesystems/hub-system-defs.js";
import {
  ensureRecipePriorityState,
  getTopEnabledRecipeId,
} from "../recipe-priority.js";

export function cloneSerializable(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

export function ensureTileSystemState(tile) {
  if (!tile.systemState || typeof tile.systemState !== "object") {
    tile.systemState = {};
  }
  return tile.systemState;
}

export function ensureSystemState(tile, systemId) {
  const systemState = ensureTileSystemState(tile);
  if (!systemState[systemId] || typeof systemState[systemId] !== "object") {
    const defaults = envSystemDefs[systemId]?.stateDefaults ?? {};
    systemState[systemId] = cloneSerializable(defaults);
  }
  return systemState[systemId];
}

export function ensureGrowthState(tile) {
  const growth = ensureSystemState(tile, "growth");
  const priority = ensureRecipePriorityState(growth, {
    systemId: "growth",
    state: null,
    includeLocked: true,
  });
  const topCropId = getTopEnabledRecipeId(priority);
  growth.selectedCropId = topCropId ?? null;
  if (!Array.isArray(growth.processes)) growth.processes = [];
  if (!growth.maturedPool || typeof growth.maturedPool !== "object") {
    growth.maturedPool = {};
  }
  return growth;
}

export function ensureHydrationState(tile) {
  return ensureSystemState(tile, "hydration");
}

export function ensureHubSystemState(structure, systemId) {
  if (!structure.systemState || typeof structure.systemState !== "object") {
    structure.systemState = {};
  }
  if (!structure.systemState[systemId] || typeof structure.systemState[systemId] !== "object") {
    const defaults = hubSystemDefs[systemId]?.stateDefaults ?? {};
    structure.systemState[systemId] = cloneSerializable(defaults);
  }
  return structure.systemState[systemId];
}
