// pawn-exec.js
// Per-second pawn intent execution.

import { pawnDefs } from "../defs/gamepieces/pawn-defs.js";
import { runEffect } from "./effects.js";
import { resolveCosts, canAffordCosts, applyCosts } from "./costs.js";
import { ensurePawnSystems } from "./state.js";

function requirementsPass(requires, pawn) {
  if (!requires || typeof requires !== "object") return true;
  if (Number.isFinite(requires.hungerAtMost)) {
    const cur = pawn?.systemState?.hunger?.cur;
    if (!Number.isFinite(cur) || cur > requires.hungerAtMost) return false;
  }
  return true;
}

function timingPass(timing, state, tSec) {
  if (!timing || typeof timing !== "object") return true;
  const cadenceSec = Number.isFinite(timing.cadenceSec)
    ? Math.max(1, Math.floor(timing.cadenceSec))
    : null;
  const onSeasonChange = timing.onSeasonChange === true;

  if (!cadenceSec && !onSeasonChange) return true;

  const cadenceMatch =
    cadenceSec != null && Number.isFinite(tSec)
      ? tSec % cadenceSec === 0
      : false;
  const seasonMatch = onSeasonChange && state?._seasonChanged === true;
  return cadenceMatch || seasonMatch;
}

export function stepPawnSecond(state, tSec) {
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  if (!chars.length) return;

  for (const pawn of chars) {
    if (!pawn) continue;
    ensurePawnSystems(pawn);

    const defId =
      typeof pawn.pawnDefId === "string" ? pawn.pawnDefId : "default";
    const def = pawnDefs[defId] || pawnDefs.default;
    const intents = Array.isArray(def?.intents) ? def.intents : [];
    const passives = Array.isArray(def?.passives) ? def.passives : [];

    const pawnInv = state?.ownerInventories?.[pawn.id] ?? null;
    const context = {
      kind: "game",
      state,
      source: pawn,
      tSec,
      pawnId: pawn.id,
      ownerId: pawn.id,
      pawn,
      pawnInv,
    };

    for (const passive of passives) {
      if (!passive || typeof passive !== "object") continue;
      if (!timingPass(passive.timing, state, tSec)) continue;
      if (passive.effect) {
        runEffect(state, passive.effect, { ...context });
      }
    }

    let executed = false;
    for (const intent of intents) {
      if (!intent || typeof intent !== "object") continue;
      if (intent.requires && !requirementsPass(intent.requires, pawn)) continue;
      if (intent.cost) {
        const resolved = resolveCosts(intent.cost, context);
        if (!resolved) continue;
        if (!canAffordCosts(resolved, context)) continue;
        applyCosts(resolved, context);
      }
      if (intent.effect) {
        runEffect(state, intent.effect, { ...context });
      }
      executed = true;
      break;
    }

    if (executed) continue;
  }
}
