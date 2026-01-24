// hub-exec.js
// Per-second hub structure execution (passives + intents).

import { hubTagDefs } from "../defs/hub/hub-tag-defs.js";
import { getCurrentSeasonKey, ensurePawnSystems } from "./state.js";
import { runEffect } from "./effects.js";
import { resolveCosts, canAffordCosts, applyCosts } from "./costs.js";

function requirementsPass(requires, seasonKey, structure, hasPawn) {
  if (!requires || typeof requires !== "object") return true;

  if (Array.isArray(requires.season) && requires.season.length > 0) {
    if (!seasonKey || !requires.season.includes(seasonKey)) return false;
  }

  if (typeof requires.hasPawn === "boolean") {
    if (requires.hasPawn !== hasPawn) return false;
  }

  if (typeof requires.hasSelectedCrop === "boolean") {
    const selectedCropId = structure?.systemState?.growth?.selectedCropId;
    const hasSelected =
      typeof selectedCropId === "string" && selectedCropId.length > 0;
    if (requires.hasSelectedCrop !== hasSelected) return false;
  }

  if (Array.isArray(requires.selectedCropIdIn)) {
    const selectedCropId = structure?.systemState?.growth?.selectedCropId;
    if (
      requires.selectedCropIdIn.length > 0 &&
      (typeof selectedCropId !== "string" ||
        !requires.selectedCropIdIn.includes(selectedCropId))
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(requires, "hasEquipment")) {
    return false;
  }

  if (typeof requires.hasMaturedPool === "boolean") {
    const pool = structure?.systemState?.growth?.maturedPool;
    const hasPool =
      pool &&
      typeof pool === "object" &&
      ((pool.bronze ?? 0) > 0 ||
        (pool.silver ?? 0) > 0 ||
        (pool.gold ?? 0) > 0 ||
        (pool.diamond ?? 0) > 0);
    if (requires.hasMaturedPool !== hasPool) return false;
  }

  const tagReq = requires.hasTag;
  if (tagReq != null) {
    const structureTags = Array.isArray(structure?.tags) ? structure.tags : [];
    const requiredTags = Array.isArray(tagReq)
      ? tagReq
      : typeof tagReq === "string"
        ? [tagReq]
        : [];

    for (const tag of requiredTags) {
      if (!structureTags.includes(tag)) return false;
    }
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

function isTagDisabled(structure, tagId) {
  if (!structure || !tagId) return false;
  const entry = structure.tagStates?.[tagId];
  return entry?.disabled === true;
}

function getPawnsOnHubCol(state, hubCol) {
  const out = [];
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  for (const ch of chars) {
    if (!ch) continue;
    const col = Number.isFinite(ch.hubCol) ? Math.floor(ch.hubCol) : null;
    if (col == null || col !== hubCol) continue;
    if (Number.isFinite(ch.envCol)) continue;
    out.push(ch);
  }
  return out;
}

export function stepHubSecond(state, tSec) {
  if (!state || !state.hub) return;

  const slots = Array.isArray(state.hub.slots) ? state.hub.slots : [];
  if (!slots.length) return;

  const seasonKey = getCurrentSeasonKey(state);

  for (let hubCol = 0; hubCol < slots.length; hubCol++) {
    const slot = slots[hubCol];
    const structure = slot?.structure;
    if (!structure) continue;

    const tags = Array.isArray(structure.tags) ? structure.tags : [];
    if (!tags.length) continue;

    const pawns = getPawnsOnHubCol(state, hubCol);
    const hasPawn = pawns.length > 0;

    const baseContext = {
      kind: "game",
      state,
      source: structure,
      tSec,
      hubCol,
      ownerId: structure.instanceId,
    };

    for (const tagId of tags) {
      if (isTagDisabled(structure, tagId)) continue;
      const tagDef = hubTagDefs[tagId];
      if (!tagDef) continue;
      const passives = Array.isArray(tagDef.passives) ? tagDef.passives : [];
      for (const passive of passives) {
        if (!passive || typeof passive !== "object") continue;
        if (!timingPass(passive.timing, state, tSec)) continue;
        if (
          passive.requires &&
          !requirementsPass(passive.requires, seasonKey, structure, hasPawn)
        ) {
          continue;
        }
        if (passive.effect) {
          runEffect(state, passive.effect, { ...baseContext });
        }
      }
    }

    if (!hasPawn) continue;

    for (const pawn of pawns) {
      if (!pawn) continue;
      ensurePawnSystems(pawn);
      const pawnInv = state?.ownerInventories?.[pawn.id] ?? null;

      const pawnContext = {
        ...baseContext,
        pawnId: pawn.id,
        ownerId: pawn.id,
        pawn,
        pawnInv,
      };

      let executed = false;
      for (const tagId of tags) {
        if (isTagDisabled(structure, tagId)) continue;
        const tagDef = hubTagDefs[tagId];
        if (!tagDef) continue;
        const intents = Array.isArray(tagDef.intents) ? tagDef.intents : [];
        for (const intent of intents) {
          if (!intent || typeof intent !== "object") continue;
          if (
            intent.requires &&
            !requirementsPass(intent.requires, seasonKey, structure, true)
          ) {
            continue;
          }
          if (intent.cost) {
            const resolved = resolveCosts(intent.cost, pawnContext);
            if (!resolved) continue;
            if (!canAffordCosts(resolved, pawnContext)) continue;
            applyCosts(resolved, pawnContext);
          }
          if (intent.effect) {
            runEffect(state, intent.effect, { ...pawnContext });
          }
          executed = true;
          break;
        }
        if (executed) break;
      }
    }
  }
}
