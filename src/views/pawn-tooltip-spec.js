import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import {
  LEADER_FAITH_HUNGER_DECAY_THRESHOLD,
  PAWN_AI_HUNGER_FULL,
  PAWN_AI_HUNGER_START_EAT,
  PAWN_AI_HUNGER_WARNING,
  PAWN_AI_STAMINA_FULL,
  PAWN_AI_STAMINA_START_REST,
  PAWN_AI_STAMINA_WARNING,
} from "../defs/gamesettings/gamerules-defs.js";
import { pawnSystemDefs } from "../defs/gamesystems/pawn-systems-defs.js";
import { isEnvColRevealed } from "../model/state.js";

function normalizePlacement(placement) {
  const hubCol = Number.isFinite(placement?.hubCol) ? Math.floor(placement.hubCol) : null;
  const envCol = Number.isFinite(placement?.envCol) ? Math.floor(placement.envCol) : null;
  if (hubCol != null) return { hubCol, envCol: null };
  if (envCol != null) return { hubCol: null, envCol };
  return { hubCol: null, envCol: null };
}

function placementsMatch(a, b) {
  const left = normalizePlacement(a);
  const right = normalizePlacement(b);
  if (left.hubCol != null || right.hubCol != null) {
    return left.hubCol != null && right.hubCol != null && left.hubCol === right.hubCol;
  }
  if (left.envCol != null || right.envCol != null) {
    return left.envCol != null && right.envCol != null && left.envCol === right.envCol;
  }
  return true;
}

function formatSystemValue(value) {
  if (!Number.isFinite(value)) return "?";
  if (Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

function getPlacementLabel(state, placement) {
  const normalized = normalizePlacement(placement);
  if (normalized.hubCol != null) {
    const structure = state?.hub?.occ?.[normalized.hubCol] ?? state?.hub?.slots?.[normalized.hubCol]?.structure ?? null;
    const defName = structure?.defId ? hubStructureDefs?.[structure.defId]?.name : null;
    return defName || `Hub ${normalized.hubCol}`;
  }
  if (normalized.envCol != null) {
    if (!isEnvColRevealed(state, normalized.envCol)) return "???";
    const tile = state?.board?.occ?.tile?.[normalized.envCol] ?? null;
    const defName = tile?.defId ? envTileDefs?.[tile.defId]?.name : null;
    return defName || `Tile ${normalized.envCol}`;
  }
  return "Unassigned";
}

function getSystemLines(pawn) {
  const lines = [];
  const systemState = pawn?.systemState ?? {};
  const systemTiers = pawn?.systemTiers ?? {};
  for (const systemId of Object.keys(pawnSystemDefs)) {
    const def = pawnSystemDefs[systemId];
    if (!def || def.ui?.hideInTooltip) continue;
    const label = def.ui?.name || systemId;
    const tier =
      typeof systemTiers[systemId] === "string" ? systemTiers[systemId] : null;
    const state = systemState[systemId] || def.stateDefaults || {};
    const cur = formatSystemValue(state.cur);
    const max = formatSystemValue(state.max);
    lines.push(`${label}${tier ? ` (${tier})` : ""}: ${cur}/${max}`);
  }
  if (pawn?.role === "leader") {
    const faithTier =
      typeof pawn?.leaderFaith?.tier === "string" && pawn.leaderFaith.tier.length > 0
        ? pawn.leaderFaith.tier
        : "gold";
    lines.push(`Faith (${faithTier})`);
    const workers = Number.isFinite(pawn?.workerCount)
      ? Math.max(0, Math.floor(pawn.workerCount))
      : 0;
    lines.push(`Workers: ${workers}`);
  }
  return lines;
}

function getAutomataLabel(pawn, currentPlacement, assignedPlacement) {
  const returnState = pawn?.ai?.returnState ?? "none";
  if (returnState === "ready" && !placementsMatch(currentPlacement, assignedPlacement)) {
    return "returning to assigned tile";
  }
  if (pawn?.ai?.mode === "eat" || returnState === "waitingForEat") {
    return "seeking food";
  }
  if (pawn?.ai?.mode === "rest" || returnState === "waitingForRest") {
    return "seeking rest";
  }
  return "idle";
}

function getActiveThresholdStates(pawn) {
  const states = [];
  const hungerCur = Number.isFinite(pawn?.systemState?.hunger?.cur)
    ? Math.floor(pawn.systemState.hunger.cur)
    : null;
  const staminaCur = Number.isFinite(pawn?.systemState?.stamina?.cur)
    ? Math.floor(pawn.systemState.stamina.cur)
    : null;
  if (hungerCur != null && hungerCur <= PAWN_AI_HUNGER_WARNING) {
    states.push("Hungry");
  }
  if (staminaCur != null && staminaCur <= PAWN_AI_STAMINA_WARNING) {
    states.push("Tired");
  }
  if (
    pawn?.role === "leader" &&
    hungerCur != null &&
    hungerCur <= LEADER_FAITH_HUNGER_DECAY_THRESHOLD
  ) {
    states.push("Losing faith");
  }
  if (pawn?.leaderFaith?.failedEatWarnActive === true) {
    states.push("Failed eat warning active");
  }
  return states.length ? states : ["None"];
}

export function makePawnTooltipSpec(pawn, state) {
  const assignedPlacement = normalizePlacement(pawn?.ai?.assignedPlacement);
  const currentPlacement = normalizePlacement(pawn);
  const hungerCur = formatSystemValue(pawn?.systemState?.hunger?.cur);
  const hungerMax = formatSystemValue(pawn?.systemState?.hunger?.max);
  const staminaCur = formatSystemValue(pawn?.systemState?.stamina?.cur);
  const staminaMax = formatSystemValue(pawn?.systemState?.stamina?.max);
  const systemLines = getSystemLines(pawn);
  const activeThresholdStates = getActiveThresholdStates(pawn);
  const lines = [
    `Assigned tile: ${getPlacementLabel(state, assignedPlacement)}`,
    `Current tile: ${getPlacementLabel(state, currentPlacement)}`,
    `Automata: ${getAutomataLabel(pawn, currentPlacement, assignedPlacement)}`,
    `AI mode: ${pawn?.ai?.mode ?? "none"}`,
    `Return state: ${pawn?.ai?.returnState ?? "none"}`,
    "Threshold states:",
    ...activeThresholdStates,
    "Threshold debug:",
    `Hunger: ${hungerCur}/${hungerMax} (warn ${PAWN_AI_HUNGER_WARNING}, eat ${PAWN_AI_HUNGER_START_EAT}, full ${PAWN_AI_HUNGER_FULL})`,
    `Stamina: ${staminaCur}/${staminaMax} (warn ${PAWN_AI_STAMINA_WARNING}, rest ${PAWN_AI_STAMINA_START_REST}, full ${PAWN_AI_STAMINA_FULL})`,
  ];
  if (pawn?.role === "leader") {
    const faithTier =
      typeof pawn?.leaderFaith?.tier === "string" && pawn.leaderFaith.tier.length > 0
        ? pawn.leaderFaith.tier
        : "gold";
    lines.push(
      `Faith: ${faithTier} (decay when hunger <= ${LEADER_FAITH_HUNGER_DECAY_THRESHOLD})`
    );
  }
  if (systemLines.length) {
    lines.push("Systems:", ...systemLines);
  }
  return {
    title: pawn?.name || `Pawn ${pawn?.id ?? ""}`,
    lines,
  };
}
