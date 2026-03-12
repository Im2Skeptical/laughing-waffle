import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { resolveCosts, canAffordCosts } from "./costs.js";
import { getCurrentSeasonKey } from "./state.js";
import { isTagHidden } from "./tag-state.js";
import {
  ensureRecipePriorityState,
  getEnabledRecipeIds,
  isRecipeSystem,
} from "./recipe-priority.js";
import { resolveAmount } from "./effects/core/amount.js";
import { resolveEffectDef } from "./effects/core/registry.js";
import { resolveOwnerTargets } from "./effects/core/targets-owner.js";
import { resolveEffectTargets } from "./effects/ops/system/targets.js";

function uniqueStrings(values) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || value.length <= 0) continue;
    if (out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

function createTagStatus(tagId, priorityIndex) {
  return {
    tagId,
    priorityIndex,
    disabled: false,
    active: false,
    passiveActive: false,
    skipped: false,
    skipReason: null,
    skipIntentId: null,
    activePawnIds: [],
    skippedPawnIds: [],
  };
}

function appendUniqueId(list, value) {
  if (!Array.isArray(list) || value == null) return;
  if (list.includes(value)) return;
  list.push(value);
}

function getInventoryForOwner(state, ownerOrId) {
  const ownerId =
    ownerOrId && typeof ownerOrId === "object" ? ownerOrId.id : ownerOrId;
  if (ownerId == null) return null;
  return state?.ownerInventories?.[ownerId] ?? null;
}

function countInventoryItems(inv, matcher) {
  const items = Array.isArray(inv?.items) ? inv.items : [];
  let total = 0;
  for (const item of items) {
    if (!item || !matcher(item)) continue;
    total += Math.max(0, Math.floor(item.quantity ?? 0));
  }
  return total;
}

function hasAnyTieredUnits(pool) {
  if (!pool || typeof pool !== "object") return false;
  return (
    Math.max(0, Math.floor(pool.bronze ?? 0)) > 0 ||
    Math.max(0, Math.floor(pool.silver ?? 0)) > 0 ||
    Math.max(0, Math.floor(pool.gold ?? 0)) > 0 ||
    Math.max(0, Math.floor(pool.diamond ?? 0)) > 0
  );
}

function resolveMaturedPoolBucket(pool, cropId) {
  if (!pool || typeof pool !== "object") return null;
  const hasTierKeys =
    Object.prototype.hasOwnProperty.call(pool, "bronze") ||
    Object.prototype.hasOwnProperty.call(pool, "silver") ||
    Object.prototype.hasOwnProperty.call(pool, "gold") ||
    Object.prototype.hasOwnProperty.call(pool, "diamond");
  if (hasTierKeys) return pool;
  if (typeof cropId !== "string" || cropId.length <= 0) return null;
  const bucket = pool[cropId];
  return bucket && typeof bucket === "object" ? bucket : null;
}

function resolveProcessTypesFromPriorityState(structure, systemId, key) {
  if (!structure || !systemId || !key) return [];
  const systemState = structure?.systemState?.[systemId];
  if (!systemState || typeof systemState !== "object") return [];
  const raw = systemState[key];
  if (!raw || typeof raw !== "object") return [];
  if (isRecipeSystem(systemId) && key === "recipePriority") {
    const priority = ensureRecipePriorityState(systemState, {
      systemId,
      state: null,
      includeLocked: true,
    });
    return getEnabledRecipeIds(priority);
  }
  const ordered = Array.isArray(raw.ordered) ? raw.ordered : [];
  const enabled = raw.enabled && typeof raw.enabled === "object" ? raw.enabled : {};
  const out = [];
  for (const entry of ordered) {
    const processType =
      typeof entry === "string" && entry.length > 0 ? entry : null;
    if (!processType) continue;
    if (enabled[processType] === false) continue;
    if (out.includes(processType)) continue;
    out.push(processType);
  }
  return out;
}

function hasProcess(structure, systemId, type) {
  const processes = Array.isArray(structure?.systemState?.[systemId]?.processes)
    ? structure.systemState[systemId].processes
    : [];
  if (!type) return processes.length > 0;
  return processes.some((process) => process && process.type === type);
}

function getPawnsOnEnvCol(state, col) {
  const out = [];
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    const envCol = Number.isFinite(pawn?.envCol) ? Math.floor(pawn.envCol) : null;
    if (envCol !== col) continue;
    out.push(pawn);
  }
  return out;
}

function getPawnsOnHubAnchor(state, anchor) {
  const out = [];
  if (!anchor) return out;
  const col = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : null;
  const span =
    Number.isFinite(anchor.span) && anchor.span > 0 ? Math.floor(anchor.span) : 1;
  if (col == null) return out;
  const maxCol = col + span - 1;
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    if (!pawn || Number.isFinite(pawn.envCol)) continue;
    const pawnCol = Number.isFinite(pawn.hubCol) ? Math.floor(pawn.hubCol) : null;
    if (pawnCol == null || pawnCol < col || pawnCol > maxCol) continue;
    out.push(pawn);
  }
  return out;
}

function envRequirementsPass(requires, seasonKey, tile, hasPawn, isTagUnlocked = null) {
  if (!requires || typeof requires !== "object") return true;

  if (Array.isArray(requires.season) && requires.season.length > 0) {
    if (!seasonKey || !requires.season.includes(seasonKey)) return false;
  }

  if (typeof requires.hasPawn === "boolean" && requires.hasPawn !== hasPawn) {
    return false;
  }

  if (typeof requires.hasSelectedCrop === "boolean") {
    const selectedCropId = tile?.systemState?.growth?.selectedCropId;
    const hasSelected =
      typeof selectedCropId === "string" && selectedCropId.length > 0;
    if (requires.hasSelectedCrop !== hasSelected) return false;
  }

  if (Array.isArray(requires.selectedCropIdIn) && requires.selectedCropIdIn.length > 0) {
    const selectedCropId = tile?.systemState?.growth?.selectedCropId;
    if (
      typeof selectedCropId !== "string" ||
      !requires.selectedCropIdIn.includes(selectedCropId)
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(requires, "hasEquipment")) {
    return false;
  }

  if (typeof requires.hasMaturedPool === "boolean") {
    const pool = tile?.systemState?.growth?.maturedPool;
    const selectedCropId = tile?.systemState?.growth?.selectedCropId ?? null;
    const bucket = resolveMaturedPoolBucket(pool, selectedCropId);
    const hasPool = bucket ? hasAnyTieredUnits(bucket) : false;
    if (requires.hasMaturedPool !== hasPool) return false;
  }

  const tagReq = requires.hasTag;
  if (tagReq != null) {
    const tileTags = Array.isArray(tile?.tags) ? tile.tags : [];
    const requiredTags = Array.isArray(tagReq)
      ? tagReq
      : typeof tagReq === "string"
        ? [tagReq]
        : [];
    for (const tag of requiredTags) {
      if (!tileTags.includes(tag)) return false;
      if (isTagUnlocked && !isTagUnlocked(tag)) return false;
      if (isTagHidden(tile, tag)) return false;
    }
  }

  return true;
}

function hubRequirementsPass(
  requires,
  seasonKey,
  structure,
  hasPawn,
  isTagUnlocked = null
) {
  if (!requires || typeof requires !== "object") return true;

  if (Array.isArray(requires.season) && requires.season.length > 0) {
    if (!seasonKey || !requires.season.includes(seasonKey)) return false;
  }

  if (typeof requires.hasPawn === "boolean" && requires.hasPawn !== hasPawn) {
    return false;
  }

  if (typeof requires.hasSelectedCrop === "boolean") {
    const selectedCropId = structure?.systemState?.growth?.selectedCropId;
    const hasSelected =
      typeof selectedCropId === "string" && selectedCropId.length > 0;
    if (requires.hasSelectedCrop !== hasSelected) return false;
  }

  if (Array.isArray(requires.selectedCropIdIn) && requires.selectedCropIdIn.length > 0) {
    const selectedCropId = structure?.systemState?.growth?.selectedCropId;
    if (
      typeof selectedCropId !== "string" ||
      !requires.selectedCropIdIn.includes(selectedCropId)
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(requires, "hasEquipment")) {
    return false;
  }

  if (typeof requires.hasMaturedPool === "boolean") {
    const pool = structure?.systemState?.growth?.maturedPool;
    const selectedCropId = structure?.systemState?.growth?.selectedCropId ?? null;
    const bucket = resolveMaturedPoolBucket(pool, selectedCropId);
    const hasPool = bucket ? hasAnyTieredUnits(bucket) : false;
    if (requires.hasMaturedPool !== hasPool) return false;
  }
  const processSystem =
    typeof requires.processSystem === "string" ? requires.processSystem : null;
  const processTypePriorityKey =
    typeof requires.processTypeFromSystemPriorityKey === "string"
      ? requires.processTypeFromSystemPriorityKey
      : null;
  const processTypeKey =
    typeof requires.processTypeFromSystemKey === "string"
      ? requires.processTypeFromSystemKey
      : "selectedRecipeId";
  const selectedProcessTypes = processTypePriorityKey
    ? resolveProcessTypesFromPriorityState(
        structure,
        processSystem,
        processTypePriorityKey
      )
    : [];
  const selectedProcessType =
    selectedProcessTypes.length > 0
      ? selectedProcessTypes[0]
      : processSystem && structure?.systemState?.[processSystem]
        ? structure.systemState[processSystem][processTypeKey]
        : null;
  const hasSelectedRecipe =
    typeof selectedProcessType === "string" && selectedProcessType.length > 0;

  if (
    typeof requires.hasSelectedRecipe === "boolean" &&
    requires.hasSelectedRecipe !== hasSelectedRecipe
  ) {
    return false;
  }

  if (requires.hasSelectedProcessType === true) {
    if (!hasSelectedRecipe) return false;
    if (selectedProcessTypes.length > 0) {
      let hasAny = false;
      for (const type of selectedProcessTypes) {
        if (hasProcess(structure, processSystem, type)) {
          hasAny = true;
          break;
        }
      }
      if (!hasAny) return false;
    } else if (!hasProcess(structure, processSystem, selectedProcessType)) {
      return false;
    }
  }

  if (requires.noSelectedProcessType === true) {
    if (selectedProcessTypes.length > 0) {
      for (const type of selectedProcessTypes) {
        if (hasProcess(structure, processSystem, type)) return false;
      }
    } else if (
      hasSelectedRecipe &&
      hasProcess(structure, processSystem, selectedProcessType)
    ) {
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
      if (isTagUnlocked && !isTagUnlocked(tag)) return false;
    }
  }

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

function resolveIntentSelectedCropCandidates(intent, tile, state, selectedCropId) {
  const out = [];
  function pushCandidate(cropId) {
    if (typeof cropId !== "string" || cropId.length <= 0) return;
    if (out.includes(cropId)) return;
    out.push(cropId);
  }

  pushCandidate(selectedCropId);
  pushCandidate(tile?.systemState?.growth?.selectedCropId ?? null);

  if (intent?.selectedCropFromPriority !== true) {
    return out;
  }

  const growth = tile?.systemState?.growth;
  if (!growth || typeof growth !== "object") return out;
  const priority = ensureRecipePriorityState(growth, {
    systemId: "growth",
    state,
    includeLocked: true,
  });
  for (const cropId of getEnabledRecipeIds(priority)) {
    pushCandidate(cropId);
  }
  return out;
}

function buildIntentExecutionContexts(intent, baseContext, tile, state) {
  if (!intent || intent.selectedCropFromPriority !== true) {
    return [baseContext];
  }
  const candidates = resolveIntentSelectedCropCandidates(
    intent,
    tile,
    state,
    baseContext?.selectedCropId ?? null
  );
  if (candidates.length <= 0) return [baseContext];
  return candidates.map((cropId) => ({ ...baseContext, selectedCropId: cropId }));
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

function resolveProcessTypeListFromSystem(structure, effect) {
  if (!effect || typeof effect !== "object") return [];
  const systemId = typeof effect.system === "string" ? effect.system : null;
  if (!systemId) return [];
  const key =
    typeof effect.processTypeFromSystemPriorityKey === "string"
      ? effect.processTypeFromSystemPriorityKey
      : "recipePriority";
  return resolveProcessTypesFromPriorityState(structure, systemId, key);
}

function resolveHubIntentEffect(effect, structure) {
  if (!effect) return null;
  if (Array.isArray(effect)) {
    const resolved = effect
      .map((entry) => resolveHubIntentEffect(entry, structure))
      .filter(Boolean);
    return resolved.length > 0 ? resolved : null;
  }
  if (typeof effect !== "object") return effect;

  const hasPrioritySource = !!effect.processTypeFromSystemPriorityKey;
  const hasSingleSource = !!effect.processTypeFromSystemKey;
  if (!hasPrioritySource && !hasSingleSource) return effect;

  const resolved = { ...effect };
  if (hasPrioritySource) {
    const processTypeList = resolveProcessTypeListFromSystem(structure, effect);
    if (processTypeList.length <= 0) return null;
    resolved.processTypeList = processTypeList;
    if (resolved.op === "CreateWorkProcess") {
      const systemId = typeof resolved.system === "string" ? resolved.system : null;
      const queueKey = resolved.queueKey || "processes";
      const existing = Array.isArray(structure?.systemState?.[systemId]?.[queueKey])
        ? structure.systemState[systemId][queueKey]
        : [];
      const existingTypes = new Set(
        existing
          .map((process) =>
            typeof process?.type === "string" && process.type.length > 0
              ? process.type
              : null
          )
          .filter(Boolean)
      );
      const chosen =
        resolved.uniqueType === true
          ? processTypeList.find((type) => !existingTypes.has(type)) || null
          : processTypeList[0] || null;
      if (!chosen) return null;
      resolved.processType = chosen;
    }
  }

  if (!resolved.processType && hasSingleSource) {
    const processType = resolveProcessTypeFromSystem(structure, effect);
    if (!processType) return null;
    resolved.processType = processType;
  }

  if (resolved.op === "CreateWorkProcess") {
    const processType =
      typeof resolved.processType === "string" ? resolved.processType : null;
    if (!Number.isFinite(resolved.durationSec) && processType) {
      const recipe = recipeDefs?.[processType] || null;
      if (recipe && Number.isFinite(recipe.durationSec)) {
        resolved.durationSec = recipe.durationSec;
      }
    }
  }

  return resolved;
}

function previewConsumeItem(state, effect, context) {
  const targets = resolveOwnerTargets(state, effect.target, context);
  if (!targets.length) {
    if (effect.outVar) {
      context.vars = context.vars || {};
      context.vars[effect.outVar] = 0;
    }
    return false;
  }

  const { defId, def } = resolveEffectDef(effect, context?.source, context);
  const itemKind =
    effect.itemKind || effect.kind || defId || def?.id || def?.cropId || null;
  const amountRaw = resolveAmount(effect, null, def, context);
  const perOwner = effect.perOwner === true;

  let consumedTotal = 0;
  if (itemKind) {
    if (perOwner) {
      const perOwnerAmount = Math.max(0, Math.floor(amountRaw ?? 0));
      if (perOwnerAmount > 0) {
        for (const target of targets) {
          const available = countInventoryItems(
            getInventoryForOwner(state, target),
            (item) => item?.kind === itemKind
          );
          consumedTotal += Math.min(perOwnerAmount, available);
        }
      }
    } else {
      let remaining = Math.max(0, Math.floor(amountRaw ?? 0));
      for (const target of targets) {
        if (remaining <= 0) break;
        const available = countInventoryItems(
          getInventoryForOwner(state, target),
          (item) => item?.kind === itemKind
        );
        const taken = Math.min(remaining, available);
        consumedTotal += taken;
        remaining -= taken;
      }
    }
  }

  if (effect.outVar) {
    context.vars = context.vars || {};
    context.vars[effect.outVar] = consumedTotal;
  }
  return consumedTotal > 0;
}

function previewTransferUnits(state, effect, context) {
  const tile = context?.source;
  const systemId = effect?.system;
  if (!tile || !systemId || typeof systemId !== "string") return false;
  const targets = resolveOwnerTargets(state, effect.target, context);
  if (!targets.length) return false;

  const systemState = tile?.systemState?.[systemId];
  const poolKey = effect.poolKey || "maturedPool";
  const poolRoot = systemState?.[poolKey];
  const { defId, def } = resolveEffectDef(effect, tile, context);
  const itemKind =
    effect.itemKind || effect.kind || defId || def?.id || def?.cropId || null;
  const pool = resolveMaturedPoolBucket(poolRoot, itemKind);
  if (!pool || !hasAnyTieredUnits(pool)) return false;

  const amountRaw = resolveAmount(effect, systemState, def, context);
  return Math.max(0, Math.floor(amountRaw ?? 0)) > 0;
}

function previewCreateWorkProcess(state, effect, context) {
  const systemId = effect?.system;
  if (!systemId || typeof systemId !== "string") return false;
  const targets = resolveEffectTargets(state, effect, context);
  if (!targets.length) return false;

  for (const target of targets) {
    const systemState = target?.systemState?.[systemId] ?? {};
    const queueKey = effect.queueKey || "processes";
    const queue = Array.isArray(systemState[queueKey]) ? systemState[queueKey] : [];
    const { def } = resolveEffectDef(effect, target, context);

    let inputAmount = 1;
    let hasExplicitInputAmount = false;
    const amountRaw = resolveAmount(effect, systemState, def, context);
    if (Number.isFinite(amountRaw)) {
      inputAmount = Math.max(0, Math.floor(amountRaw));
      hasExplicitInputAmount = true;
    } else if (Number.isFinite(effect.inputAmount)) {
      inputAmount = Math.max(0, Math.floor(effect.inputAmount));
      hasExplicitInputAmount = true;
    }
    if (hasExplicitInputAmount && inputAmount <= 0) continue;

    const durationRaw = Number.isFinite(effect.durationSec)
      ? effect.durationSec
      : effect.durationFromDefKey && def
        ? def[effect.durationFromDefKey]
        : null;
    if (!Number.isFinite(durationRaw) || Math.floor(durationRaw) <= 0) continue;

    const type = effect.processType || effect.type || "process";
    if (effect.uniqueType === true && queue.some((process) => process?.type === type)) {
      continue;
    }
    return true;
  }

  return false;
}

function getProcessTypePriorityList(effect) {
  return uniqueStrings(effect?.processTypeList);
}

function resolveAdvanceIncrement(state, effect, context) {
  const mode = effect?.mode === "work" ? "work" : "time";
  if (mode !== "work") {
    return Number.isFinite(effect?.deltaSec)
      ? Math.max(1, Math.floor(effect.deltaSec))
      : 1;
  }
  if (typeof effect?.workersFrom === "string") {
    if (effect.workersFrom === "envCol") {
      const col = Number.isFinite(context?.envCol)
        ? Math.floor(context.envCol)
        : Number.isFinite(context?.source?.col)
          ? Math.floor(context.source.col)
          : null;
      return col == null ? 0 : getPawnsOnEnvCol(state, col).length;
    }
    if (effect.workersFrom === "hubAnchor") {
      return getPawnsOnHubAnchor(state, context?.source).length;
    }
  }
  if (Number.isFinite(effect?.amount)) {
    return Math.max(0, Math.floor(effect.amount));
  }
  return 1;
}

function previewAdvanceWorkProcess(state, effect, context) {
  const systemId = effect?.system;
  if (!systemId || typeof systemId !== "string") return false;
  const targets = resolveEffectTargets(state, effect, context);
  if (!targets.length) return false;
  const typePriority = getProcessTypePriorityList(effect);
  const increment = resolveAdvanceIncrement(state, effect, context);
  if (increment <= 0) return false;

  for (const target of targets) {
    const queueKey = effect.queueKey || "processes";
    const queue = Array.isArray(target?.systemState?.[systemId]?.[queueKey])
      ? target.systemState[systemId][queueKey]
      : [];
    if (queue.length <= 0) continue;

    if (typePriority.length > 0) {
      for (const processType of typePriority) {
        if (queue.some((process) => process?.type === processType)) {
          return true;
        }
      }
      continue;
    }

    if (typeof effect.processType === "string" && effect.processType.length > 0) {
      if (queue.some((process) => process?.type === effect.processType)) {
        return true;
      }
      continue;
    }

    if (queue.length > 0) return true;
  }

  return false;
}

function previewPassiveEffect(state, effect, context) {
  return previewEffect(state, effect, context);
}

function previewEffect(state, effect, context) {
  if (!effect) return false;
  if (Array.isArray(effect)) {
    let changed = false;
    for (const entry of effect) {
      changed = previewEffect(state, entry, context) || changed;
    }
    return changed;
  }
  if (typeof effect !== "object") return false;

  switch (effect.op) {
    case "ConsumeItem":
      return previewConsumeItem(state, effect, context);
    case "TransferUnits":
      return previewTransferUnits(state, effect, context);
    case "CreateWorkProcess":
      return previewCreateWorkProcess(state, effect, context);
    case "AdvanceWorkProcess":
      return previewAdvanceWorkProcess(state, effect, context);
    case "AddResource":
    case "AddToSystemState":
    case "ClampSystemState":
    case "AccumulateRatio":
    case "RevealDiscovery":
    case "ExposeDiscovery":
    case "SetDiscoveryState":
    case "RemoveTag":
    case "SetProp":
    case "ExpireStoredPerishables":
    case "SpawnFromDropTable":
    case "SpawnDropPackage":
      return true;
    default:
      return true;
  }
}

function canPreviewHubIntentEffect(state, structure, effect, context) {
  if (!effect) return false;
  if (Array.isArray(effect)) {
    for (const entry of effect) {
      if (!canPreviewHubIntentEffect(state, structure, entry, context)) return false;
    }
    return true;
  }
  if (effect.op === "AdvanceWorkProcess") {
    return previewAdvanceWorkProcess(state, effect, context);
  }
  return true;
}

function evaluateEnvTagForPawn({
  state,
  seasonKey,
  tile,
  pawn,
  isTagUnlocked,
  tagId,
}) {
  const tagDef = envTagDefs[tagId];
  if (!tagDef) return { outcome: "none", reason: null, intentId: null };
  const intents = Array.isArray(tagDef.intents) ? tagDef.intents : [];
  if (intents.length <= 0) return { outcome: "none", reason: null, intentId: null };

  const pawnContext = {
    kind: "game",
    state,
    source: tile,
    tSec: Math.floor(state?.tSec ?? 0),
    envCol: Number.isFinite(tile?.col) ? Math.floor(tile.col) : null,
    pawnId: pawn?.id ?? null,
    ownerId: pawn?.id ?? null,
    pawn,
    pawnInv: getInventoryForOwner(state, pawn),
    selectedCropId: tile?.systemState?.growth?.selectedCropId ?? null,
  };

  let firstFailure = null;
  for (const intent of intents) {
    if (!intent || typeof intent !== "object") continue;
    if (
      intent.requires &&
      !envRequirementsPass(intent.requires, seasonKey, tile, true, isTagUnlocked)
    ) {
      firstFailure ||= {
        reason: "requirements",
        intentId: intent.id ?? null,
      };
      continue;
    }
    const contexts = buildIntentExecutionContexts(intent, pawnContext, tile, state);
    for (const executionContext of contexts) {
      if (intent.cost) {
        const costContext = {
          ...executionContext,
          intentId: intent.id ?? null,
        };
        const resolved = resolveCosts(intent.cost, costContext);
        if (!resolved || !canAffordCosts(resolved, costContext)) {
          firstFailure ||= {
            reason: "cost",
            intentId: intent.id ?? null,
          };
          continue;
        }
      }
      if (intent.effect && !previewEffect(state, intent.effect, { ...executionContext })) {
        firstFailure ||= {
          reason: "effect",
          intentId: intent.id ?? null,
        };
        continue;
      }
      return {
        outcome: "executing",
        reason: null,
        intentId: intent.id ?? null,
      };
    }
  }

  return firstFailure
    ? {
        outcome: "skipped",
        reason: firstFailure.reason,
        intentId: firstFailure.intentId,
      }
    : { outcome: "none", reason: null, intentId: null };
}

function evaluateHubTagForPawn({
  state,
  seasonKey,
  structure,
  pawn,
  isTagUnlocked,
  tagId,
}) {
  const tagDef = hubTagDefs[tagId];
  if (!tagDef) return { outcome: "none", reason: null, intentId: null };
  const intents = Array.isArray(tagDef.intents) ? tagDef.intents : [];
  if (intents.length <= 0) return { outcome: "none", reason: null, intentId: null };

  const pawnContext = {
    kind: "game",
    state,
    source: structure,
    tSec: Math.floor(state?.tSec ?? 0),
    hubCol: Number.isFinite(structure?.col) ? Math.floor(structure.col) : null,
    pawnId: pawn?.id ?? null,
    ownerId: pawn?.id ?? null,
    pawn,
    pawnInv: getInventoryForOwner(state, pawn),
  };

  let firstFailure = null;
  for (const intent of intents) {
    if (!intent || typeof intent !== "object") continue;
    if (
      intent.requires &&
      !hubRequirementsPass(intent.requires, seasonKey, structure, true, isTagUnlocked)
    ) {
      firstFailure ||= {
        reason: "requirements",
        intentId: intent.id ?? null,
      };
      continue;
    }

    const resolvedEffect = resolveHubIntentEffect(intent.effect, structure);
    if (!resolvedEffect) {
      firstFailure ||= {
        reason: "effect",
        intentId: intent.id ?? null,
      };
      continue;
    }
    if (!canPreviewHubIntentEffect(state, structure, resolvedEffect, pawnContext)) {
      firstFailure ||= {
        reason: "effect",
        intentId: intent.id ?? null,
      };
      continue;
    }

    if (intent.cost) {
      const costContext = {
        ...pawnContext,
        intentId: intent.id ?? null,
      };
      const resolved = resolveCosts(intent.cost, costContext);
      if (!resolved || !canAffordCosts(resolved, costContext)) {
        firstFailure ||= {
          reason: "cost",
          intentId: intent.id ?? null,
        };
        continue;
      }
    }

    if (!previewEffect(state, resolvedEffect, { ...pawnContext })) {
      firstFailure ||= {
        reason: "effect",
        intentId: intent.id ?? null,
      };
      continue;
    }

    return {
      outcome: "executing",
      reason: null,
      intentId: intent.id ?? null,
    };
  }

  return firstFailure
    ? {
        outcome: "skipped",
        reason: firstFailure.reason,
        intentId: firstFailure.intentId,
      }
    : { outcome: "none", reason: null, intentId: null };
}

function evaluatePassiveActivity({
  state,
  tagDef,
  target,
  hasPawn,
  seasonKey,
  isEnv,
  isTagUnlocked,
}) {
  const intents = Array.isArray(tagDef?.intents) ? tagDef.intents : [];
  if (intents.length > 0 || !hasPawn) return false;

  const passives = Array.isArray(tagDef?.passives) ? tagDef.passives : [];
  if (passives.length <= 0) return false;

  const baseContext = {
    kind: "game",
    state,
    source: target,
    tSec: Math.floor(state?.tSec ?? 0),
    envCol: isEnv && Number.isFinite(target?.col) ? Math.floor(target.col) : null,
    hubCol: !isEnv && Number.isFinite(target?.col) ? Math.floor(target.col) : null,
  };

  for (const passive of passives) {
    if (!passive || typeof passive !== "object") continue;
    const requirementsOk = isEnv
      ? envRequirementsPass(passive.requires, seasonKey, target, hasPawn, isTagUnlocked)
      : hubRequirementsPass(passive.requires, seasonKey, target, hasPawn, isTagUnlocked);
    if (!requirementsOk) continue;
    if (previewPassiveEffect(state, passive.effect, { ...baseContext })) {
      return true;
    }
  }
  return false;
}

function buildPreviewSummary(tags, statusById) {
  const activeTagIds = [];
  const skippedTagIds = [];
  const passiveActiveTagIds = [];
  let firstEnabledTagId = null;
  let firstActiveTagId = null;
  let firstSkippedTagId = null;

  for (const tagId of tags) {
    const status = statusById[tagId];
    if (!status) continue;
    if (!status.disabled && firstEnabledTagId == null) {
      firstEnabledTagId = tagId;
    }
    if (status.active) {
      activeTagIds.push(tagId);
      if (firstActiveTagId == null) firstActiveTagId = tagId;
    }
    if (status.passiveActive) {
      passiveActiveTagIds.push(tagId);
      if (firstActiveTagId == null) firstActiveTagId = tagId;
    }
    if (status.skipped) {
      skippedTagIds.push(tagId);
      if (firstSkippedTagId == null) firstSkippedTagId = tagId;
    }
  }

  return {
    tags: tags.slice(),
    statusById,
    activeTagIds,
    skippedTagIds,
    passiveActiveTagIds,
    firstEnabledTagId,
    firstActiveTagId,
    firstSkippedTagId,
  };
}

export function getEnvTagExecutionPreview({
  state,
  tile,
  tags,
  isTagDisabled,
  isTagUnlocked = null,
} = {}) {
  const visibleTags = Array.isArray(tags) ? tags : [];
  const seasonKey = getCurrentSeasonKey(state);
  const col = Number.isFinite(tile?.col) ? Math.floor(tile.col) : null;
  const pawns = col == null ? [] : getPawnsOnEnvCol(state, col);
  const statusById = {};

  for (let index = 0; index < visibleTags.length; index += 1) {
    const tagId = visibleTags[index];
    const status = createTagStatus(tagId, index);
    if (isTagDisabled?.(tile, tagId) === true) {
      status.disabled = true;
    }
    statusById[tagId] = status;
  }

  if (pawns.length > 0) {
    for (const pawn of pawns) {
      let executed = false;
      for (const tagId of visibleTags) {
        const status = statusById[tagId];
        if (!status || status.disabled) continue;
        const result = evaluateEnvTagForPawn({
          state,
          seasonKey,
          tile,
          pawn,
          isTagUnlocked,
          tagId,
        });
        if (result.outcome === "executing") {
          status.active = true;
          appendUniqueId(status.activePawnIds, pawn?.id ?? null);
          executed = true;
          break;
        }
        if (result.outcome === "skipped") {
          status.skipped = true;
          status.skipReason ||= result.reason;
          status.skipIntentId ||= result.intentId;
          appendUniqueId(status.skippedPawnIds, pawn?.id ?? null);
        }
      }
      if (!executed) {
        for (const tagId of visibleTags) {
          const status = statusById[tagId];
          if (!status || status.disabled) continue;
          const tagDef = envTagDefs[tagId];
          if (
            evaluatePassiveActivity({
              state,
              tagDef,
              target: tile,
              hasPawn: true,
              seasonKey,
              isEnv: true,
              isTagUnlocked,
            })
          ) {
            status.passiveActive = true;
            break;
          }
        }
      }
    }
  }

  return buildPreviewSummary(visibleTags, statusById);
}

export function getHubTagExecutionPreview({
  state,
  structure,
  tags,
  isTagDisabled,
  isTagUnlocked = null,
} = {}) {
  const visibleTags = Array.isArray(tags) ? tags : [];
  const seasonKey = getCurrentSeasonKey(state);
  const pawns = getPawnsOnHubAnchor(state, structure);
  const statusById = {};

  for (let index = 0; index < visibleTags.length; index += 1) {
    const tagId = visibleTags[index];
    const status = createTagStatus(tagId, index);
    if (isTagDisabled?.(structure, tagId) === true) {
      status.disabled = true;
    }
    statusById[tagId] = status;
  }

  if (pawns.length > 0) {
    for (const pawn of pawns) {
      let executed = false;
      for (const tagId of visibleTags) {
        const status = statusById[tagId];
        if (!status || status.disabled) continue;
        const result = evaluateHubTagForPawn({
          state,
          seasonKey,
          structure,
          pawn,
          isTagUnlocked,
          tagId,
        });
        if (result.outcome === "executing") {
          status.active = true;
          appendUniqueId(status.activePawnIds, pawn?.id ?? null);
          executed = true;
          break;
        }
        if (result.outcome === "skipped") {
          status.skipped = true;
          status.skipReason ||= result.reason;
          status.skipIntentId ||= result.intentId;
          appendUniqueId(status.skippedPawnIds, pawn?.id ?? null);
        }
      }
      if (!executed) {
        for (const tagId of visibleTags) {
          const status = statusById[tagId];
          if (!status || status.disabled) continue;
          const tagDef = hubTagDefs[tagId];
          if (
            evaluatePassiveActivity({
              state,
              tagDef,
              target: structure,
              hasPawn: true,
              seasonKey,
              isEnv: false,
              isTagUnlocked,
            })
          ) {
            status.passiveActive = true;
            break;
          }
        }
      }
    }
  }

  return buildPreviewSummary(visibleTags, statusById);
}
