import { envSystemDefs } from "../../../defs/gamesystems/env-systems-defs.js";
import { cloneSerializable } from "./clone.js";
import { SYSTEM_TIER_LADDER, TIER_ASC } from "./tiers.js";

function ensureTileSystemState(tile) {
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

export function getTierValueForSystem(tile, systemId) {
  const tier =
    tile.systemTiers && typeof tile.systemTiers === "object"
      ? tile.systemTiers[systemId]
      : null;
  if (tier && TIER_ASC.includes(tier)) return tier;
  const def = envSystemDefs[systemId];
  if (def?.defaultTier && TIER_ASC.includes(def.defaultTier)) {
    return def.defaultTier;
  }
  return "bronze";
}

export function getSystemTierLadder(systemDef) {
  if (!systemDef?.tierMap || typeof systemDef.tierMap !== "object") return [];
  return SYSTEM_TIER_LADDER.filter((tier) => systemDef.tierMap[tier] != null);
}
