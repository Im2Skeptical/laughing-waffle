// hub-exec.js
// Per-second hub structure execution (passives + intents).

import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";
import { getCurrentSeasonKey, ensurePawnSystems } from "./state.js";
import { runEffect } from "./effects.js";
import { resolveCosts, canAffordCosts, applyCosts } from "./costs.js";
import { PAWN_ROLE_LEADER, getLeaderById } from "./prestige-system.js";

function hasProcess(structure, systemId, type) {
  const sys = structure?.systemState?.[systemId];
  const processes = Array.isArray(sys?.processes) ? sys.processes : [];
  if (!type) return processes.length > 0;
  return processes.some((p) => p && p.type === type);
}

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

  const processSystem =
    typeof requires.processSystem === "string" ? requires.processSystem : null;
  if (processSystem) {
    if (requires.hasProcessType) {
      const types = Array.isArray(requires.hasProcessType)
        ? requires.hasProcessType
        : [requires.hasProcessType];
      for (const type of types) {
        if (!hasProcess(structure, processSystem, type)) return false;
      }
    }
    if (requires.noProcessType) {
      const types = Array.isArray(requires.noProcessType)
        ? requires.noProcessType
        : [requires.noProcessType];
      for (const type of types) {
        if (hasProcess(structure, processSystem, type)) return false;
      }
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

function getPawnsOnHubAnchor(state, anchor) {
  const out = [];
  if (!anchor) return out;
  const col = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : null;
  const span =
    Number.isFinite(anchor.span) && anchor.span > 0
      ? Math.floor(anchor.span)
      : 1;
  if (col == null) return out;
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  const maxCol = col + span - 1;
  for (const ch of chars) {
    if (!ch) continue;
    if (Number.isFinite(ch.envCol)) continue;
    const pawnCol = Number.isFinite(ch.hubCol) ? Math.floor(ch.hubCol) : null;
    if (pawnCol == null) continue;
    if (pawnCol < col || pawnCol > maxCol) continue;
    out.push(ch);
  }
  return out;
}

function getContributingPawns(state, structure) {
  const pawns = getPawnsOnHubAnchor(state, structure);
  const contributors = [];
  for (const pawn of pawns) {
    if (!pawn) continue;
    ensurePawnSystems(pawn);
    const stamina = pawn.systemState?.stamina;
    const cur = Number.isFinite(stamina?.cur) ? Math.floor(stamina.cur) : 0;
    if (cur <= 0) continue;
    contributors.push(pawn);
  }
  return contributors;
}

function countGrainUnitsInInventory(inv) {
  if (!inv || !Array.isArray(inv.items)) return 0;
  let total = 0;
  for (const item of inv.items) {
    if (!item || !Array.isArray(item.tags)) continue;
    if (!item.tags.includes("grain")) continue;
    total += Math.max(0, Math.floor(item.quantity ?? 0));
  }
  return total;
}

function ensureGranaryProcessQueue(structure) {
  if (!structure || typeof structure !== "object") return [];
  if (!structure.systemState || typeof structure.systemState !== "object") {
    structure.systemState = {};
  }
  const store = structure.systemState.granaryStore;
  if (!store || typeof store !== "object") {
    structure.systemState.granaryStore = {
      byKindTier: {},
      totalByTier: {},
      processes: [],
    };
  }
  if (!Array.isArray(structure.systemState.granaryStore.processes)) {
    structure.systemState.granaryStore.processes = [];
  }
  return structure.systemState.granaryStore.processes;
}

function ensureDepositProcesses(state, structure, pawns, tSec) {
  if (!state || !structure || !Array.isArray(pawns) || pawns.length === 0) {
    return false;
  }
  const processes = ensureGranaryProcessQueue(structure);
  let changed = false;

  for (const pawn of pawns) {
    if (!pawn) continue;
    const leader =
      pawn.role === PAWN_ROLE_LEADER
        ? pawn
        : pawn.leaderId != null
        ? getLeaderById(state, pawn.leaderId)
        : null;
    if (!leader || leader.role !== PAWN_ROLE_LEADER) continue;

    const pawnInv = state?.ownerInventories?.[pawn.id] ?? null;
    if (!pawnInv) continue;
    const grainUnits = countGrainUnitsInInventory(pawnInv);
    if (grainUnits <= 0) continue;

    const hasExisting = processes.some(
      (proc) => proc?.type === "depositGrain" && proc?.ownerId === pawn.id
    );
    if (hasExisting) continue;

    runEffect(
      state,
      {
        op: "CreateWorkProcess",
        system: "granaryStore",
        queueKey: "processes",
        processType: "depositGrain",
        mode: "time",
        durationSec: 1,
        requirements: [
          {
            kind: "tag",
            tag: "grain",
            amount: grainUnits,
            progress: 0,
            consume: true,
            slotId: "grain",
          },
        ],
        outputs: [
          {
            kind: "prestige",
            qty: grainUnits,
            slotId: "prestige",
          },
        ],
        processMeta: {
          ownerId: pawn.id,
          leaderId: leader.id,
        },
      },
      {
        kind: "game",
        state,
        source: structure,
        tSec,
        ownerId: structure.instanceId,
      }
    );

    changed = true;
  }

  return changed;
}

export function stepHubSecond(state, tSec) {
  if (!state || !state.hub) return;

  const anchors = Array.isArray(state.hub.anchors) ? state.hub.anchors : [];
  if (!anchors.length) return;

  const seasonKey = getCurrentSeasonKey(state);

  for (const structure of anchors) {
    if (!structure) continue;
    const hubCol = Number.isFinite(structure.col)
      ? Math.floor(structure.col)
      : 0;

    const tags = Array.isArray(structure.tags) ? structure.tags : [];
    if (!tags.length) continue;

    const pawns = getPawnsOnHubAnchor(state, structure);
    const contributingPawns = getContributingPawns(state, structure);
    const hasPawn = pawns.length > 0;

    if (hasPawn && tags.includes("deposit") && !isTagDisabled(structure, "deposit")) {
      ensureDepositProcesses(state, structure, pawns, tSec);
    }

    const baseContext = {
      kind: "game",
      state,
      source: structure,
      tSec,
      hubCol,
      ownerId: structure.instanceId,
      hubWorkers: contributingPawns,
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
