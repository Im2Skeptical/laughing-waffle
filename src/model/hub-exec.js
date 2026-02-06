// hub-exec.js
// Per-second hub structure execution (passives + intents).

import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { getCurrentSeasonKey, ensurePawnSystems } from "./state.js";
import { runEffect } from "./effects.js";
import { resolveCosts, canAffordCosts, applyCosts } from "./costs.js";
import { PAWN_ROLE_LEADER, getLeaderById } from "./prestige-system.js";
import {
  getProcessDefForInstance,
  ensureProcessRoutingState,
  listCandidateEndpoints,
  resolveEndpointTarget,
  resolveFixedEndpointId,
  isDropEndpoint,
} from "./process-framework.js";
import { canOwnerAcceptItem } from "./commands.js";

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

  const processSystem =
    typeof requires.processSystem === "string" ? requires.processSystem : null;
  const recipeKey =
    typeof requires.processTypeFromSystemKey === "string"
      ? requires.processTypeFromSystemKey
      : "selectedRecipeId";
  const selectedRecipeId =
    processSystem && structure?.systemState?.[processSystem]
      ? structure.systemState[processSystem][recipeKey]
      : null;
  const hasSelectedRecipe =
    typeof selectedRecipeId === "string" && selectedRecipeId.length > 0;

  if (typeof requires.hasSelectedRecipe === "boolean") {
    if (requires.hasSelectedRecipe !== hasSelectedRecipe) return false;
  }

  if (requires.hasSelectedProcessType === true) {
    if (!hasSelectedRecipe) return false;
    if (!hasProcess(structure, processSystem, selectedRecipeId)) return false;
  }

  if (requires.noSelectedProcessType === true) {
    if (hasSelectedRecipe && hasProcess(structure, processSystem, selectedRecipeId)) {
      return false;
    }
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

  // processSystem already derived above for recipe checks.
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

function normalizeDepositConfig(structure) {
  if (!structure || !structure.defId) return null;
  const def = hubStructureDefs?.[structure.defId];
  const deposit = def?.deposit;
  if (!deposit || typeof deposit !== "object") return null;
  const systemId =
    typeof deposit.systemId === "string" ? deposit.systemId : null;
  if (!systemId) return null;
  const poolKey =
    typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
      ? deposit.poolKey
      : "byKindTier";
  const allowedTags = Array.isArray(deposit.allowedTags)
    ? deposit.allowedTags.filter((tag) => typeof tag === "string" && tag.length > 0)
    : [];
  const allowedItemIds = Array.isArray(deposit.allowedItemIds)
    ? deposit.allowedItemIds.filter(
        (id) => typeof id === "string" && id.length > 0
      )
    : [];
  const allowAny = deposit.allowAny === true;
  return { systemId, poolKey, allowedTags, allowedItemIds, allowAny };
}

function ensureHubSystemState(structure, systemId) {
  if (!structure || !systemId) return null;
  if (!structure.systemState || typeof structure.systemState !== "object") {
    structure.systemState = {};
  }
  if (!structure.systemTiers || typeof structure.systemTiers !== "object") {
    structure.systemTiers = {};
  }
  if (structure.systemTiers[systemId] == null) {
    const def = hubSystemDefs?.[systemId];
    if (def?.defaultTier != null) {
      structure.systemTiers[systemId] = def.defaultTier;
    }
  }
  if (!structure.systemState[systemId]) {
    const def = hubSystemDefs?.[systemId];
    if (def?.stateDefaults) {
      structure.systemState[systemId] = JSON.parse(
        JSON.stringify(def.stateDefaults)
      );
    } else {
      structure.systemState[systemId] = {};
    }
  }
  return structure.systemState[systemId];
}

function ensureDepositQueue(structure) {
  const depositState = ensureHubSystemState(structure, "deposit");
  if (!depositState) return [];
  if (!Array.isArray(depositState.processes)) {
    depositState.processes = [];
  }
  return depositState.processes;
}

function itemMatchesDepositFilter(item, depositConfig) {
  if (!item || !depositConfig) return false;
  const qty = Math.max(0, Math.floor(item.quantity ?? 0));
  if (qty <= 0) return false;
  const allowAny = depositConfig.allowAny === true;
  const allowedItemIds = depositConfig.allowedItemIds || [];
  const allowedTags = depositConfig.allowedTags || [];
  if (allowAny && allowedItemIds.length === 0 && allowedTags.length === 0) {
    return true;
  }
  if (allowedItemIds.length > 0 && allowedItemIds.includes(item.kind)) {
    return true;
  }
  if (allowedTags.length > 0) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    for (const tag of allowedTags) {
      if (tags.includes(tag)) return true;
    }
  }
  return allowAny;
}

function countDepositableByKind(inv, depositConfig) {
  if (!inv || !Array.isArray(inv.items) || !depositConfig) return {};
  const totals = {};
  for (const item of inv.items) {
    if (!itemMatchesDepositFilter(item, depositConfig)) continue;
    const qty = Math.max(0, Math.floor(item.quantity ?? 0));
    if (qty <= 0) continue;
    const kind = item.kind;
    if (!kind) continue;
    totals[kind] = Math.max(0, Math.floor(totals[kind] ?? 0)) + qty;
  }
  return totals;
}

function buildDepositRequirements(kindTotals) {
  const kinds = Object.keys(kindTotals || {});
  kinds.sort((a, b) => a.localeCompare(b));
  const reqs = [];
  for (const kind of kinds) {
    const qty = Math.max(0, Math.floor(kindTotals[kind] ?? 0));
    if (qty <= 0) continue;
    reqs.push({
      kind: "item",
      itemId: kind,
      amount: qty,
      progress: 0,
      consume: true,
      slotId: "items",
    });
  }
  return reqs;
}

function ensureDepositProcesses(state, structure, pawns, tSec) {
  if (!state || !structure || !Array.isArray(pawns) || pawns.length === 0) {
    return false;
  }
  const depositConfig = normalizeDepositConfig(structure);
  if (!depositConfig) return false;

  ensureHubSystemState(structure, depositConfig.systemId);

  const processes = ensureDepositQueue(structure);
  let changed = false;

  for (const pawn of pawns) {
    if (!pawn) continue;
    const pawnInv = state?.ownerInventories?.[pawn.id] ?? null;
    if (!pawnInv) continue;

    const kindTotals = countDepositableByKind(pawnInv, depositConfig);
    const totalUnits = Object.values(kindTotals).reduce(
      (sum, value) => sum + Math.max(0, Math.floor(value ?? 0)),
      0
    );
    if (totalUnits <= 0) continue;

    const hasExisting = processes.some(
      (proc) => proc?.type === "depositItems" && proc?.ownerId === pawn.id
    );
    if (hasExisting) continue;

    const leader =
      pawn.role === PAWN_ROLE_LEADER
        ? pawn
        : pawn.leaderId != null
        ? getLeaderById(state, pawn.leaderId)
        : null;
    const hasLeader = leader && leader.role === PAWN_ROLE_LEADER;
    const communal =
      Array.isArray(structure.tags) &&
      structure.tags.includes("communal") &&
      !isTagDisabled(structure, "communal");

    const requirements = buildDepositRequirements(kindTotals);
    if (requirements.length === 0) continue;

    const outputs = [
      {
        kind: "pool",
        system: depositConfig.systemId,
        poolKey: depositConfig.poolKey,
        fromLedger: true,
        slotId: "pool",
      },
    ];

    if (communal && hasLeader) {
      outputs.push({
        kind: "prestige",
        qty: totalUnits,
        slotId: "prestige",
      });
    }

    runEffect(
      state,
      {
        op: "CreateWorkProcess",
        system: "deposit",
        queueKey: "processes",
        processType: "depositItems",
        mode: "time",
        durationSec: 1,
        requirements,
        outputs,
        processMeta: {
          ownerKind: "pawn",
          leaderId: hasLeader ? leader.id : null,
        },
      },
      {
        kind: "game",
        state,
        source: structure,
        tSec,
        ownerId: pawn.id,
        leaderId: hasLeader ? leader.id : null,
      }
    );

    changed = true;
  }

  return changed;
}

const DEFAULT_INPUT_SLOT_ID = "materials";
const DEFAULT_OUTPUT_SLOT_ID = "output";

function buildDummyItemForAcceptance(itemId, tier) {
  const def = itemDefs?.[itemId] || null;
  const tags = Array.isArray(def?.baseTags) ? def.baseTags.slice() : [];
  return {
    kind: itemId,
    tier: tier ?? def?.defaultTier ?? "bronze",
    tags,
  };
}

function resolveSlotDef(processDef, slotKind, slotId) {
  const kind = slotKind === "outputs" ? "outputs" : "inputs";
  const slots = processDef?.routingSlots?.[kind] ?? [];
  if (!Array.isArray(slots) || slots.length === 0) return null;
  if (slotId) {
    const match = slots.find((slot) => slot?.slotId === slotId);
    if (match) return match;
  }
  const fallbackId = kind === "outputs" ? DEFAULT_OUTPUT_SLOT_ID : DEFAULT_INPUT_SLOT_ID;
  const fallback = slots.find((slot) => slot?.slotId === fallbackId);
  return fallback || slots[0] || null;
}

function resolveSlotState(process, slotKind, slotDef) {
  if (!process?.routing || !slotDef) return null;
  const kind = slotKind === "outputs" ? "outputs" : "inputs";
  const container = process.routing[kind];
  if (!container || typeof container !== "object") return null;
  const state = container[slotDef.slotId];
  if (!state || typeof state !== "object") return null;
  if (!Array.isArray(state.ordered)) state.ordered = [];
  if (!state.enabled || typeof state.enabled !== "object") state.enabled = {};
  return state;
}

function resolveEndpointIdForRouting(endpointId, process, context) {
  if (!endpointId || typeof endpointId !== "string") return null;
  const resolved = resolveFixedEndpointId(endpointId, process, context);
  return resolved || endpointId;
}

function isEndpointValidForSlot(endpointId, candidates, processDef) {
  if (!endpointId) return false;
  if (isDropEndpoint(endpointId) && processDef?.supportsDropslot) return true;
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  return candidates.includes(endpointId);
}

function parseLeaderIdFromEndpoint(endpointId) {
  if (!endpointId || typeof endpointId !== "string") return null;
  if (!endpointId.startsWith("sys:pawn:")) return null;
  const raw = endpointId.slice("sys:pawn:".length);
  return raw.length ? raw : null;
}

function canOutputUseEndpoint(state, output, endpoint) {
  if (!output || !endpoint) return false;
  if (output.kind === "pool") {
    return endpoint.kind === "pool";
  }
  if (output.kind === "item") {
    if (endpoint.kind === "spawn") return true;
    if (endpoint.kind !== "inventory") return false;
    const dummy = buildDummyItemForAcceptance(output.itemId, output.tier);
    return canOwnerAcceptItem(state, endpoint.ownerId, dummy);
  }
  if (output.kind === "resource") {
    return endpoint.kind === "resource";
  }
  if (output.kind === "system") {
    return endpoint.kind === "system";
  }
  return false;
}

function canProcessOutputsProceed(state, structure, process, systemId) {
  if (!state || !structure || !process) return true;
  const processDef = getProcessDefForInstance(process, structure, {
    leaderId: process?.leaderId ?? null,
  });
  if (!processDef) return true;
  const policy =
    process?.completionPolicy ||
    processDef?.transform?.completionPolicy ||
    "none";
  if (policy !== "none") return true;
  const outputs = Array.isArray(processDef?.transform?.outputs)
    ? processDef.transform.outputs
    : [];
  if (!outputs.length) return true;

  ensureProcessRoutingState(process, processDef, {
    leaderId: process?.leaderId ?? null,
    target: structure,
    systemId,
  });

  for (const output of outputs) {
    if (!output || typeof output !== "object") continue;
    const slotDef = resolveSlotDef(processDef, "outputs", output.slotId);
    if (!slotDef) return false;
    const slotState = resolveSlotState(process, "outputs", slotDef);
    if (!slotState) return false;
    const candidates = listCandidateEndpoints(state, process, slotDef, structure, {
      leaderId: process?.leaderId ?? null,
    });
    const orderedList =
      slotState.ordered.length > 0 ? slotState.ordered : candidates;

    let canRoute = false;
    for (const endpointRaw of orderedList || []) {
      const enabled = slotState.enabled?.[endpointRaw];
      if (enabled === false) continue;
      const endpointId = resolveEndpointIdForRouting(endpointRaw, process, {
        leaderId: process?.leaderId ?? null,
      });
      if (!endpointId) continue;
      if (!isEndpointValidForSlot(endpointId, candidates, processDef)) continue;
      if (output.kind === "prestige") {
        const leaderId = parseLeaderIdFromEndpoint(endpointId);
        if (leaderId != null) {
          canRoute = true;
          break;
        }
        continue;
      }
      const endpoint = resolveEndpointTarget(state, endpointId);
      if (!endpoint) continue;
      if (canOutputUseEndpoint(state, output, endpoint)) {
        canRoute = true;
        break;
      }
    }

    if (!canRoute) return false;
  }

  return true;
}

function resolveProcessTypeFromSystem(structure, effect) {
  if (!effect || typeof effect !== "object") return null;
  const systemId = typeof effect.system === "string" ? effect.system : null;
  const key =
    typeof effect.processTypeFromSystemKey === "string"
      ? effect.processTypeFromSystemKey
      : "selectedRecipeId";
  if (!systemId) return null;
  const selected = structure?.systemState?.[systemId]?.[key];
  return typeof selected === "string" && selected.length > 0 ? selected : null;
}

function resolveIntentEffect(effect, structure) {
  if (!effect) return null;
  if (Array.isArray(effect)) {
    const resolved = effect
      .map((entry) => resolveIntentEffect(entry, structure))
      .filter(Boolean);
    return resolved.length ? resolved : null;
  }
  if (typeof effect !== "object") return effect;

  if (!effect.processTypeFromSystemKey) return effect;

  const processType = resolveProcessTypeFromSystem(structure, effect);
  if (!processType) return null;

  const resolved = { ...effect, processType };
  if (resolved.op === "CreateWorkProcess") {
    const durationMissing = !Number.isFinite(resolved.durationSec);
    if (durationMissing) {
      const recipe = recipeDefs?.[processType] || null;
      if (recipe && Number.isFinite(recipe.durationSec)) {
        resolved.durationSec = recipe.durationSec;
      }
    }
  }

  return resolved;
}

function canAdvanceWorkEffect(state, structure, effect) {
  if (!state || !structure || !effect) return true;
  if (effect.op !== "AdvanceWorkProcess") return true;
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return true;
  const queueKey = effect.queueKey || "processes";
  const processes = Array.isArray(structure?.systemState?.[systemId]?.[queueKey])
    ? structure.systemState[systemId][queueKey]
    : [];
  if (processes.length === 0) return true;
  const matches = effect.processType
    ? processes.filter((proc) => proc?.type === effect.processType)
    : processes.slice();
  if (matches.length === 0) return true;
  for (const proc of matches) {
    if (canProcessOutputsProceed(state, structure, proc, systemId)) return true;
  }
  return false;
}

function canExecuteIntentEffect(state, structure, effect) {
  if (!effect) return true;
  if (Array.isArray(effect)) {
    for (const eff of effect) {
      if (!canExecuteIntentEffect(state, structure, eff)) return false;
    }
    return true;
  }
  if (effect.op === "AdvanceWorkProcess") {
    return canAdvanceWorkEffect(state, structure, effect);
  }
  return true;
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

    if (
      hasPawn &&
      tags.includes("depositable") &&
      !isTagDisabled(structure, "depositable")
    ) {
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
          const resolvedEffect = resolveIntentEffect(intent.effect, structure);
          if (!resolvedEffect) continue;
          if (!canExecuteIntentEffect(state, structure, resolvedEffect)) {
            continue;
          }
          if (intent.cost) {
            const resolved = resolveCosts(intent.cost, pawnContext);
            if (!resolved) continue;
            if (!canAffordCosts(resolved, pawnContext)) continue;
            applyCosts(resolved, pawnContext);
          }
          if (resolvedEffect) {
            runEffect(state, resolvedEffect, { ...pawnContext });
          }
          executed = true;
          break;
        }
        if (executed) break;
      }
    }
  }
}
