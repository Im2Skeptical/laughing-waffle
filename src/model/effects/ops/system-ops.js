import { envSystemDefs } from "../../../defs/gamesystems/env-systems-defs.js";
import { envTagDefs } from "../../../defs/gamesystems/env-tags-defs.js";
import { envTileDefs } from "../../../defs/gamepieces/env-tiles-defs.js";
import { pawnSystemDefs } from "../../../defs/gamesystems/pawn-systems-defs.js";
import { hubSystemDefs } from "../../../defs/gamesystems/hub-system-defs.js";
import { hubStructureDefs } from "../../../defs/gamepieces/hub-structure-defs.js";
import { itemSystemDefs } from "../../../defs/gamesystems/item-system-defs.js";
import { resolveAmount } from "../core/amount.js";
import { clamp } from "../core/clamp.js";
import { cloneSerializable } from "../core/clone.js";
import { resolveEffectDef } from "../core/registry.js";
import { ensureSystemState, getTierValueForSystem } from "../core/system-state.js";
import { TIER_ASC } from "../core/tiers.js";
import { resolveBoardTargets } from "../core/targets-board.js";
import { handleSpawnItem } from "./game-ops.js";
import { initializeInstanceFromDef } from "../../state.js";
import { itemDefs } from "../../../defs/gamepieces/item-defs.js";
import {
  getProcessDefForInstance,
  ensureProcessRoutingState,
  listCandidateEndpoints,
  resolveEndpointTarget,
  resolveFixedEndpointId,
  canConsumeRequirementUnit,
  consumeRequirementUnit,
  addItemToInventory,
  isDropEndpoint,
  getDropEndpointId,
} from "../../process-framework.js";
import { Inventory } from "../../inventory-model.js";
import { canOwnerAcceptItem } from "../../commands.js";
import { applyPrestigeDeposit } from "../../prestige-system.js";
import { pushGameEvent } from "../../event-feed.js";

// Process refactor:
// - CreateWorkProcess: enqueue a process with progress tracking (time or work)
// - AdvanceWorkProcess: advance progress and complete when done
//
// This fully replaces CreateProcess / FinalizeProcess.

export function handleAddToSystemState(state, effect, context) {
  const systemId = effect.system;
  const key = effect.key;
  if (!systemId || typeof systemId !== "string") return false;
  if (!key || typeof key !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const { def } = resolveEffectDef(effect, target, context);
    const amount = resolveAmount(effect, systemState, def, context);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const current = Number.isFinite(systemState[key]) ? systemState[key] : 0;
    const next = current + amount;
    if (next !== current) {
      systemState[key] = next;
      changed = true;
    }
  }

  return changed;
}

export function handleClampSystemState(state, effect, context) {
  const systemId = effect.system;
  const key = effect.key;
  if (!systemId || typeof systemId !== "string") return false;
  if (!key || typeof key !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const value = Number.isFinite(systemState[key]) ? systemState[key] : 0;
    const minRaw = Number.isFinite(effect.min)
      ? effect.min
      : effect.minKey
        ? systemState[effect.minKey]
        : null;
    const maxRaw = Number.isFinite(effect.max)
      ? effect.max
      : effect.maxKey
        ? systemState[effect.maxKey]
        : null;
    const min = Number.isFinite(minRaw) ? minRaw : -Infinity;
    const max = Number.isFinite(maxRaw) ? maxRaw : Infinity;
    const next = clamp(value, min, max);
    if (next !== value) {
      systemState[key] = next;
      changed = true;
    }
  }

  return changed;
}

export function handleAccumulateRatio(state, effect, context) {
  const systemId = effect.system;
  const numeratorKey = effect.numeratorKey;
  const denominatorKey = effect.denominatorKey;
  const targetKey = effect.targetKey || "sumRatio";
  if (!systemId || typeof systemId !== "string") return false;
  if (!numeratorKey || typeof numeratorKey !== "string") return false;
  if (!denominatorKey || typeof denominatorKey !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const numerator = Number.isFinite(systemState[numeratorKey])
      ? systemState[numeratorKey]
      : 0;
    const denominator = Number.isFinite(systemState[denominatorKey])
      ? systemState[denominatorKey]
      : 0;
    let ratio = denominator > 0 ? numerator / denominator : 0;
    if (Number.isFinite(effect.min)) ratio = Math.max(effect.min, ratio);
    if (Number.isFinite(effect.max)) ratio = Math.min(effect.max, ratio);
    const current = Number.isFinite(systemState[targetKey])
      ? systemState[targetKey]
      : 0;
    systemState[targetKey] = current + ratio;
    changed = true;
  }

  return changed;
}

export function handleResetSystemState(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  const defaults =
    envSystemDefs[systemId]?.stateDefaults ??
    pawnSystemDefs[systemId]?.stateDefaults ??
    hubSystemDefs[systemId]?.stateDefaults ??
    itemSystemDefs[systemId]?.stateDefaults ??
    {};
  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    if (!target.systemState || typeof target.systemState !== "object") {
      target.systemState = {};
    }
    target.systemState[systemId] = cloneSerializable(defaults);
    changed = true;
  }

  return changed;
}

export function handleAdjustSystemState(state, effect, context) {
  const systemId = effect.system;
  const key = effect.key;
  if (!systemId || typeof systemId !== "string") return false;
  if (!key || typeof key !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const { def } = resolveEffectDef(effect, target, context);
    const deltaRaw = resolveAmount(effect, systemState, def, context);
    const delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;
    let percent = null;
    if (Number.isFinite(effect.percent)) percent = effect.percent;
    if (percent == null && effect.percentFromKey) {
      percent = systemState[effect.percentFromKey];
    }
    if (percent == null && effect.percentFromDefKey && def) {
      percent = def[effect.percentFromDefKey];
    }
    if (percent == null && effect.percentVar && context?.vars) {
      percent = context.vars[effect.percentVar];
    }
    if (!Number.isFinite(percent)) percent = 0;

    const current = Number.isFinite(systemState[key]) ? systemState[key] : 0;
    const nextRaw = current + delta + current * percent;
    const minRaw = Number.isFinite(effect.min)
      ? effect.min
      : effect.minKey
        ? systemState[effect.minKey]
        : null;
    const maxRaw = Number.isFinite(effect.max)
      ? effect.max
      : effect.maxKey
        ? systemState[effect.maxKey]
        : null;
    const min = Number.isFinite(minRaw) ? minRaw : -Infinity;
    const max = Number.isFinite(maxRaw) ? maxRaw : Infinity;
    const next = clamp(nextRaw, min, max);

    if (next !== current) {
      systemState[key] = next;
      changed = true;
    }
  }

  return changed;
}

function sampleBinomial(state, trials, chance) {
  if (!Number.isFinite(trials) || trials <= 0) return 0;
  if (!Number.isFinite(chance) || chance <= 0) return 0;
  if (chance >= 1) return Math.floor(trials);
  if (typeof state?.rngNextFloat !== "function") return 0;

  let hits = 0;
  const count = Math.floor(trials);
  for (let i = 0; i < count; i++) {
    if (state.rngNextFloat() < chance) hits++;
  }
  return hits;
}

function nowSecFrom(state, context) {
  return Number.isFinite(context?.tSec)
    ? Math.floor(context.tSec)
    : Math.floor(state?.tSec ?? 0);
}

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

function normalizeProcessRequirements(requirements) {
  const raw = Array.isArray(requirements) ? requirements : [];
  if (!raw.length) return [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const consume =
      typeof entry.consume === "boolean" ? entry.consume : entry.consume !== false;
    const slotId =
      typeof entry.slotId === "string" && entry.slotId.length ? entry.slotId : null;
    const kind =
      typeof entry.kind === "string" && entry.kind.length
        ? entry.kind
        : null;
    const itemId =
      typeof entry.itemId === "string" && entry.itemId.length
        ? entry.itemId
        : null;
    const tag =
      typeof entry.tag === "string" && entry.tag.length
        ? entry.tag
        : typeof entry.itemTag === "string" && entry.itemTag.length
          ? entry.itemTag
          : null;
    const resource =
      typeof entry.resource === "string" && entry.resource.length
        ? entry.resource
        : null;
    if (kind === "item" && !itemId) continue;
    if (kind === "tag" && !tag) continue;
    if (kind === "resource" && !resource) continue;
    if (!kind) {
      if (itemId) {
        out.push({
          kind: "item",
          itemId,
          amount: Math.max(0, Math.floor(entry.amount ?? 0)),
          progress: Math.max(0, Math.floor(entry.progress ?? 0)),
          consume,
          slotId,
        });
      } else if (tag) {
        out.push({
          kind: "tag",
          tag,
          amount: Math.max(0, Math.floor(entry.amount ?? 0)),
          progress: Math.max(0, Math.floor(entry.progress ?? 0)),
          consume,
          slotId,
        });
      } else if (resource) {
        out.push({
          kind: "resource",
          resource,
          amount: Math.max(0, Math.floor(entry.amount ?? 0)),
          progress: Math.max(0, Math.floor(entry.progress ?? 0)),
          consume,
          slotId,
        });
      }
      continue;
    }
    out.push({
      kind,
      itemId,
      tag,
      resource,
      amount: Math.max(0, Math.floor(entry.amount ?? 0)),
      progress: Math.max(0, Math.floor(entry.progress ?? 0)),
      consume,
      slotId,
    });
  }
  return out;
}

function areRequirementsComplete(process) {
  const reqs = Array.isArray(process?.requirements) ? process.requirements : [];
  if (!reqs.length) return true;
  for (const req of reqs) {
    if (!req || typeof req !== "object") continue;
    const required = Math.max(0, Math.floor(req.amount ?? 0));
    const progress = Math.max(0, Math.floor(req.progress ?? 0));
    if (progress < required) return false;
  }
  return true;
}

const DEFAULT_INPUT_SLOT_ID = "materials";
const DEFAULT_OUTPUT_SLOT_ID = "output";

function ensureProcessRequirements(process, processDef) {
  let reqs = Array.isArray(process?.requirements) ? process.requirements : [];
  let changed = false;
  if (!Array.isArray(process?.requirements)) {
    process.requirements = [];
    reqs = process.requirements;
    changed = true;
  }

  if (
    reqs.length === 0 &&
    Array.isArray(processDef?.transform?.requirements) &&
    processDef.transform.requirements.length > 0
  ) {
    process.requirements = processDef.transform.requirements.map((req) => ({
      ...req,
      amount: Math.max(0, Math.floor(req.amount ?? 0)),
      progress: Math.max(0, Math.floor(req.progress ?? 0)),
      consume: req.consume !== false,
    }));
    return { reqs: process.requirements, changed: true };
  }

  for (const req of reqs) {
    if (!req || typeof req !== "object") continue;
    const amt = Math.max(0, Math.floor(req.amount ?? 0));
    if (req.amount !== amt) {
      req.amount = amt;
      changed = true;
    }
    if (!Number.isFinite(req.progress)) {
      req.progress = 0;
      changed = true;
    } else {
      const prog = Math.max(0, Math.floor(req.progress));
      if (req.progress !== prog) {
        req.progress = prog;
        changed = true;
      }
    }
    if (req.consume == null) {
      req.consume = req.consume !== false;
      changed = true;
    }
  }

  return { reqs, changed };
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

function canConsumeResourceUnit(resources, requirement) {
  if (!resources || !requirement?.resource) return false;
  const available = Number.isFinite(resources[requirement.resource])
    ? Math.max(0, Math.floor(resources[requirement.resource]))
    : 0;
  return available > 0;
}

function consumeResourceUnit(resources, requirement) {
  if (!resources || !requirement?.resource) return false;
  const available = Number.isFinite(resources[requirement.resource])
    ? Math.max(0, Math.floor(resources[requirement.resource]))
    : 0;
  if (available <= 0) return false;
  resources[requirement.resource] = available - 1;
  return true;
}

function isTierBucket(pool) {
  if (!pool || typeof pool !== "object") return false;
  for (const tier of TIER_ASC) {
    if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
  }
  return false;
}

function normalizeTierBonus(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function applyTierBonus(tier, bonus) {
  const baseIdx = TIER_ASC.indexOf(tier);
  const idx = baseIdx >= 0 ? baseIdx : 0;
  const nextIdx = Math.max(0, Math.min(TIER_ASC.length - 1, idx + bonus));
  return TIER_ASC[nextIdx] || "bronze";
}

function itemHasTag(kind, tag) {
  if (!kind || !tag) return false;
  const tags = Array.isArray(itemDefs?.[kind]?.baseTags)
    ? itemDefs[kind].baseTags
    : [];
  return tags.includes(tag);
}

export function handleExpireStoredPerishables(state, effect, context) {
  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  const baseChance =
    Number.isFinite(effect.chance) ? effect.chance : null;
  if (!Number.isFinite(baseChance) || baseChance <= 0) return false;

  const perishableTag =
    typeof effect.perishableTag === "string" ? effect.perishableTag : "perishable";
  const rotPoolKey =
    typeof effect.rotPoolKey === "string" ? effect.rotPoolKey : "rotByKindTier";
  const rotKind =
    typeof effect.rotKind === "string" ? effect.rotKind : "rot";
  const bonusProp =
    typeof effect.preserveTierBonusProp === "string"
      ? effect.preserveTierBonusProp
      : "perishabilityTierBonus";
  const preserveTag =
    typeof effect.preserveTag === "string" ? effect.preserveTag : null;
  const multiplierMap =
    effect.tierMultiplierByTier &&
    typeof effect.tierMultiplierByTier === "object"
      ? effect.tierMultiplierByTier
      : effect.multiplierByTier && typeof effect.multiplierByTier === "object"
        ? effect.multiplierByTier
        : null;

  let changed = false;

  for (const target of targets) {
    if (!target) continue;
    const def = hubStructureDefs?.[target.defId];
    const deposit = def?.deposit;
    if (!deposit || typeof deposit !== "object") continue;

    const systemId =
      typeof deposit.systemId === "string" ? deposit.systemId : null;
    if (!systemId) continue;
    const poolKey =
      typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
        ? deposit.poolKey
        : "byKindTier";

    const systemState = target.systemState?.[systemId];
    if (!systemState || typeof systemState !== "object") continue;
    const pool = systemState[poolKey];
    if (!pool || typeof pool !== "object") continue;

    if (!systemState[rotPoolKey] || typeof systemState[rotPoolKey] !== "object") {
      systemState[rotPoolKey] = {};
    }
    const rotPool = systemState[rotPoolKey];
    const totals =
      systemState.totalByTier && typeof systemState.totalByTier === "object"
        ? systemState.totalByTier
        : null;

    let tierBonus = normalizeTierBonus(target?.props?.[bonusProp]);
    if (preserveTag) {
      const tags = Array.isArray(target.tags) ? target.tags : [];
      const hasPreserve =
        tags.includes(preserveTag) &&
        target?.tagStates?.[preserveTag]?.disabled !== true;
      if (!hasPreserve) {
        tierBonus = 0;
      } else if (!Number.isFinite(target?.props?.[bonusProp])) {
        tierBonus = 1;
      }
    }
    const isBucket = isTierBucket(pool);

    if (isBucket) {
      const kind =
        typeof effect.itemKind === "string"
          ? effect.itemKind
          : typeof effect.itemId === "string"
            ? effect.itemId
            : null;
      if (!kind || !itemHasTag(kind, perishableTag)) continue;

      const rotBucket = ensureTierBucket(rotPool);
      for (const tier of TIER_ASC) {
        const qty = Math.max(0, Math.floor(pool[tier] ?? 0));
        if (qty <= 0) continue;
        const effectiveTier = applyTierBonus(tier, tierBonus);
        const mult = Number.isFinite(multiplierMap?.[effectiveTier])
          ? multiplierMap[effectiveTier]
          : 1;
        const chance = baseChance * mult;
        const expired = sampleBinomial(state, qty, chance);
        if (expired <= 0) continue;
        pool[tier] = qty - expired;
        if (totals) {
          const total = Math.max(0, Math.floor(totals[tier] ?? 0));
          totals[tier] = Math.max(0, total - expired);
        }
        rotBucket[tier] = Math.max(0, Math.floor(rotBucket[tier] ?? 0)) + expired;
        changed = true;
      }
      continue;
    }

    const kinds = Object.keys(pool).sort((a, b) => a.localeCompare(b));
    for (const kind of kinds) {
      if (!itemHasTag(kind, perishableTag)) continue;
      const bucket = pool[kind];
      if (!bucket || typeof bucket !== "object") continue;
      const rotBucket = ensureTierBucket(rotPool, rotKind);
      for (const tier of TIER_ASC) {
        const qty = Math.max(0, Math.floor(bucket[tier] ?? 0));
        if (qty <= 0) continue;
        const effectiveTier = applyTierBonus(tier, tierBonus);
        const mult = Number.isFinite(multiplierMap?.[effectiveTier])
          ? multiplierMap[effectiveTier]
          : 1;
        const chance = baseChance * mult;
        const expired = sampleBinomial(state, qty, chance);
        if (expired <= 0) continue;
        bucket[tier] = qty - expired;
        if (totals) {
          const total = Math.max(0, Math.floor(totals[tier] ?? 0));
          totals[tier] = Math.max(0, total - expired);
        }
        rotBucket[tier] = Math.max(0, Math.floor(rotBucket[tier] ?? 0)) + expired;
        changed = true;
      }
    }
  }

  return changed;
}

function ensureTierBucket(container, itemId = null) {
  const bucket = itemId ? container[itemId] : container;
  if (!bucket || typeof bucket !== "object") {
    const next = {};
    for (const tier of TIER_ASC) next[tier] = 0;
    if (itemId) {
      container[itemId] = next;
      return next;
    }
    return next;
  }
  for (const tier of TIER_ASC) {
    if (!Number.isFinite(bucket[tier])) bucket[tier] = 0;
  }
  return bucket;
}

function addPoolTotals(endpoint, tier, amount) {
  if (!endpoint || amount <= 0) return;
  const owner = endpoint.owner;
  const systemId = endpoint.systemId;
  if (!owner || !systemId) return;
  const store = owner.systemState?.[systemId];
  if (!store || typeof store !== "object") return;
  if (!store.totalByTier || typeof store.totalByTier !== "object") return;
  const current = Math.max(0, Math.floor(store.totalByTier[tier] ?? 0));
  store.totalByTier[tier] = current + amount;
}

function getPoolCandidateItemId(endpoint, requirement) {
  if (!endpoint || !requirement) return null;
  if (requirement.kind === "item" && requirement.itemId) {
    if (isTierBucket(endpoint.target) && endpoint.itemId) {
      return endpoint.itemId === requirement.itemId ? requirement.itemId : null;
    }
    return requirement.itemId;
  }
  if (requirement.kind !== "tag" || !requirement.tag) return null;

  const pool = endpoint.target;
  if (!pool || typeof pool !== "object") return null;

  if (isTierBucket(pool)) {
    const itemId = endpoint.itemId;
    if (!itemId) return null;
    const def = itemDefs?.[itemId];
    const tags = Array.isArray(def?.baseTags) ? def.baseTags : [];
    return tags.includes(requirement.tag) ? itemId : null;
  }

  const kinds = Object.keys(pool).sort((a, b) => a.localeCompare(b));
  for (const kind of kinds) {
    const def = itemDefs?.[kind];
    const tags = Array.isArray(def?.baseTags) ? def.baseTags : [];
    if (!tags.includes(requirement.tag)) continue;
    const bucket = pool[kind];
    if (!bucket || typeof bucket !== "object") continue;
    for (const tier of TIER_ASC) {
      const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
      if (available > 0) return kind;
    }
  }
  return null;
}

function canConsumePoolUnit(endpoint, requirement) {
  const pool = endpoint?.target;
  if (!pool || typeof pool !== "object") return false;
  const itemId = getPoolCandidateItemId(endpoint, requirement);
  if (!itemId) return false;
  if (isTierBucket(pool)) {
    for (const tier of TIER_ASC) {
      const available = Math.max(0, Math.floor(pool[tier] ?? 0));
      if (available > 0) return { itemId, tier };
    }
    return false;
  }
  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") return false;
  for (const tier of TIER_ASC) {
    const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
    if (available > 0) return { itemId, tier };
  }
  return false;
}

function consumePoolUnit(endpoint, requirement) {
  const pool = endpoint?.target;
  if (!pool || typeof pool !== "object") return null;
  const itemId = getPoolCandidateItemId(endpoint, requirement);
  if (!itemId) return null;
  if (isTierBucket(pool)) {
    for (const tier of TIER_ASC) {
      const available = Math.max(0, Math.floor(pool[tier] ?? 0));
      if (available <= 0) continue;
      pool[tier] = available - 1;
      return { kind: itemId, tier };
    }
    return null;
  }
  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") return null;
  for (const tier of TIER_ASC) {
    const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
    if (available <= 0) continue;
    bucket[tier] = available - 1;
    return { kind: itemId, tier };
  }
  return null;
}

function recordProcessConsumption(process, consumed) {
  if (!process || !consumed || !consumed.kind) return;
  const tier = consumed.tier || "bronze";
  if (!process.consumedByKindTier || typeof process.consumedByKindTier !== "object") {
    process.consumedByKindTier = {};
  }
  if (!process.consumedByKindTier[consumed.kind]) {
    process.consumedByKindTier[consumed.kind] = {};
  }
  const bucket = process.consumedByKindTier[consumed.kind];
  bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + 1;
}

function ensureProcessBufferInventory(state, process, processDef) {
  if (!state || !process || !processDef?.supportsDropslot) return false;
  const ownerId = getDropEndpointId(process.id);
  if (!ownerId) return false;
  if (!state.ownerInventories) state.ownerInventories = {};
  if (state.ownerInventories[ownerId]) return false;
  const inv = Inventory.create(8, 8);
  Inventory.init(inv);
  inv.version = 0;
  state.ownerInventories[ownerId] = inv;
  return true;
}

function seedRoutingWithCandidates(state, target, process, processDef, context) {
  let changed = false;
  const slotGroups = [
    { kind: "inputs", slots: processDef?.routingSlots?.inputs ?? [] },
    { kind: "outputs", slots: processDef?.routingSlots?.outputs ?? [] },
  ];

  for (const group of slotGroups) {
    for (const slotDef of group.slots || []) {
      const slotState = resolveSlotState(process, group.kind, slotDef);
      if (!slotState) continue;

      const candidates = listCandidateEndpoints(
        state,
        process,
        slotDef,
        target,
        context
      );

      if (slotState.ordered.length === 0) {
        if (candidates.length) {
          slotState.ordered = candidates.slice();
          for (const endpointId of candidates) {
            if (slotState.enabled[endpointId] === undefined) {
              slotState.enabled[endpointId] = true;
            }
          }
          changed = true;
        }
      } else if (!slotDef.locked) {
        const hasNonDrop = slotState.ordered.some(
          (endpointId) =>
            !(
              processDef.supportsDropslot &&
              isDropEndpoint(endpointId)
            )
        );
        if (hasNonDrop) {
          let appended = false;
          for (const endpointId of candidates) {
            if (slotState.ordered.includes(endpointId)) continue;
            slotState.ordered.push(endpointId);
            if (slotState.enabled[endpointId] === undefined) {
              slotState.enabled[endpointId] = false;
            }
            appended = true;
          }
          if (appended) changed = true;
        }
      }

      for (const endpointId of slotState.ordered) {
        if (slotState.enabled[endpointId] === undefined) {
          slotState.enabled[endpointId] = true;
        }
      }

      if (group.kind === "inputs" && processDef.supportsDropslot) {
        const dropEndpoint = getDropEndpointId(process.id);
        if (dropEndpoint) {
          if (!slotState.ordered.includes(dropEndpoint)) {
            slotState.ordered.unshift(dropEndpoint);
            changed = true;
          }
          slotState.enabled[dropEndpoint] = true;
        }
      }

      if (group.kind === "inputs" && candidates.length > 0) {
        const nonDrop = slotState.ordered.filter(
          (endpointId) =>
            !(
              processDef.supportsDropslot &&
              isDropEndpoint(endpointId)
            )
        );
        if (nonDrop.length === 0) {
          let inserted = false;
          for (const endpointId of candidates) {
            if (slotState.ordered.includes(endpointId)) continue;
            slotState.ordered.push(endpointId);
            if (slotState.enabled[endpointId] === undefined) {
              slotState.enabled[endpointId] = true;
            }
            inserted = true;
          }
          if (inserted) changed = true;
        }
      }
    }
  }

  return changed;
}

function trySpendRequirementUnit(state, endpointId, endpoint, requirement) {
  if (!endpoint || !requirement) return null;

  if (requirement.kind === "item" || requirement.kind === "tag") {
    if (endpoint.kind === "inventory") {
      const inv = endpoint.target;
      if (requirement.consume === false) {
        if (!canConsumeRequirementUnit(inv, requirement)) return null;
        return { ok: true, consumed: null };
      }
      const consumed = consumeRequirementUnit(inv, requirement);
      if (!consumed) return null;
      return { ok: true, consumed };
    }
    if (endpoint.kind === "pool") {
      if (requirement.consume === false) {
        const can = canConsumePoolUnit(endpoint, requirement);
        return can ? { ok: true, consumed: null } : null;
      }
      const consumed = consumePoolUnit(endpoint, requirement);
      if (!consumed) return null;
      return { ok: true, consumed };
    }
    return null;
  }

  if (requirement.kind === "resource") {
    if (endpoint.kind !== "resource") return null;
    if (requirement.consume === false) {
      if (!canConsumeResourceUnit(endpoint.target, requirement)) return null;
      return { ok: true, consumed: null };
    }
    if (!consumeResourceUnit(endpoint.target, requirement)) return null;
    return { ok: true, consumed: null };
  }

  return null;
}

function advanceProcessRequirements(state, target, process, processDef, budget, context) {
  const ensured = ensureProcessRequirements(process, processDef);
  const reqs = ensured.reqs || [];
  if (!reqs.length) return { changed: ensured.changed, done: true };

  let remainingBudget = Number.isFinite(budget) ? Math.floor(budget) : 0;
  if (remainingBudget <= 0) {
    return { changed: ensured.changed, done: areRequirementsComplete(process) };
  }

  let changed = ensured.changed;
  for (const req of reqs) {
    if (remainingBudget <= 0) break;
    if (!req || typeof req !== "object") continue;
    const required = Math.max(0, Math.floor(req.amount ?? 0));
    const progress = Math.max(0, Math.floor(req.progress ?? 0));
    const remaining = required - progress;
    if (remaining <= 0) continue;

    const slotDef = resolveSlotDef(processDef, "inputs", req.slotId);
    if (!slotDef) continue;
    const slotState = resolveSlotState(process, "inputs", slotDef);
    if (!slotState) continue;

    const candidates = listCandidateEndpoints(state, process, slotDef, target, context);

    const toTry = Math.min(remaining, remainingBudget);
    let consumedCount = 0;

    for (let i = 0; i < toTry; i++) {
      let spent = false;
      for (const endpointRaw of slotState.ordered || []) {
        const enabled = slotState.enabled?.[endpointRaw];
        if (enabled === false && !isDropEndpoint(endpointRaw)) continue;
        const endpointId = resolveEndpointIdForRouting(endpointRaw, process, context);
        if (!endpointId) continue;
        if (!isEndpointValidForSlot(endpointId, candidates, processDef)) continue;
        const endpoint = resolveEndpointTarget(state, endpointId);
        if (!endpoint) continue;
        const spentRes = trySpendRequirementUnit(state, endpointId, endpoint, req);
        if (!spentRes?.ok) continue;
        if (spentRes.consumed) {
          recordProcessConsumption(process, spentRes.consumed);
        }
        consumedCount += 1;
        remainingBudget -= 1;
        spent = true;
        break;
      }
      if (!spent) break;
      if (remainingBudget <= 0) break;
    }

    if (consumedCount > 0) {
      req.progress = progress + consumedCount;
      changed = true;
    }
  }

  return { changed, done: areRequirementsComplete(process) };
}

function buildDummyItemForAcceptance(itemId, tier) {
  const def = itemDefs?.[itemId] || null;
  const tags = Array.isArray(def?.baseTags) ? def.baseTags.slice() : [];
  return {
    kind: itemId,
    tier: tier ?? def?.defaultTier ?? "bronze",
    tags,
  };
}

function parseLeaderIdFromEndpoint(endpointId) {
  if (!endpointId || typeof endpointId !== "string") return null;
  if (!endpointId.startsWith("sys:pawn:")) return null;
  const raw = endpointId.slice("sys:pawn:".length);
  return raw.length ? raw : null;
}

function tryApplyOutputUnit(state, target, process, output, endpoint, context) {
  if (!output || !endpoint) return false;
  if (output.kind === "pool") {
    if (endpoint.kind !== "pool") return false;
    const itemId = output.itemId;
    if (!itemId) return false;
    const tier = output.tier || "bronze";
    const pool = endpoint.target;
    if (!pool || typeof pool !== "object") return false;
    if (isTierBucket(pool)) {
      if (endpoint.itemId && endpoint.itemId !== itemId) return false;
      const bucket = ensureTierBucket(pool);
      bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + 1;
      addPoolTotals(endpoint, tier, 1);
      return true;
    }
    const bucket = ensureTierBucket(pool, itemId);
    bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + 1;
    addPoolTotals(endpoint, tier, 1);
    return true;
  }
  if (output.kind === "item") {
    if (endpoint.kind === "inventory") {
      const dummy = buildDummyItemForAcceptance(output.itemId, output.tier);
      if (!canOwnerAcceptItem(state, endpoint.ownerId, dummy)) return false;
      const added = addItemToInventory(
        state,
        endpoint.target,
        output.itemId,
        1,
        output.tier
      );
      return added > 0;
    }
    if (endpoint.kind === "spawn") {
      handleSpawnItem(
        state,
        {
          op: "SpawnItem",
          itemKind: output.itemId,
          amount: 1,
          perOwner: false,
          target: { kind: "tileOccupants" },
        },
        context
      );
      return true;
    }
    return false;
  }

  if (output.kind === "resource") {
    if (endpoint.kind !== "resource") return false;
    const key = output.resource;
    if (!key) return false;
    endpoint.target[key] = (endpoint.target[key] ?? 0) + 1;
    return true;
  }

  if (output.kind === "system") {
    if (endpoint.kind !== "system") return false;
    const systemId = output.system;
    const key = output.key;
    if (!systemId || !key) return false;
    const sysState = ensureSystemState(endpoint.target, systemId);
    const current = Number.isFinite(sysState[key]) ? sysState[key] : 0;
    sysState[key] = current + 1;
    return true;
  }

  return false;
}

function applyPrestigeOutput(state, target, process, output, endpointId) {
  const leaderId = parseLeaderIdFromEndpoint(endpointId);
  if (!leaderId) return false;
  const ledger =
    process?.consumedByKindTier && typeof process.consumedByKindTier === "object"
      ? process.consumedByKindTier
      : null;
  if (ledger && Object.keys(ledger).length > 0) {
    return applyPrestigeDeposit(state, leaderId, target, ledger);
  }
  const qty = Math.max(0, Math.floor(output?.qty ?? 0));
  if (qty <= 0) return false;
  const fallback = { prestige: { bronze: qty } };
  return applyPrestigeDeposit(state, leaderId, target, fallback);
}

function applyPoolLedgerOutput(process, endpoint) {
  if (!process || !endpoint || endpoint.kind !== "pool") return false;
  const ledger =
    process?.consumedByKindTier && typeof process.consumedByKindTier === "object"
      ? process.consumedByKindTier
      : null;
  if (!ledger || Object.keys(ledger).length === 0) return false;

  const pool = endpoint.target;
  if (!pool || typeof pool !== "object") return false;

  let applied = false;
  const kinds = Object.keys(ledger).sort((a, b) => a.localeCompare(b));
  const isBucket = isTierBucket(pool);

  for (const kind of kinds) {
    const tiers = ledger[kind];
    if (!tiers || typeof tiers !== "object") continue;
    if (isBucket && endpoint.itemId && endpoint.itemId !== kind) continue;
    for (const tier of TIER_ASC) {
      const amount = Math.max(0, Math.floor(tiers[tier] ?? 0));
      if (amount <= 0) continue;
      if (isBucket) {
        const bucket = ensureTierBucket(pool);
        bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + amount;
      } else {
        const bucket = ensureTierBucket(pool, kind);
        bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + amount;
      }
      addPoolTotals(endpoint, tier, amount);
      applied = true;
    }
  }

  return applied;
}

function applyProcessOutputs(state, target, process, processDef, context) {
  const outputs = Array.isArray(processDef?.transform?.outputs)
    ? processDef.transform.outputs
    : [];
  if (!outputs.length) return false;

  let changed = false;

  for (const output of outputs) {
    if (!output || typeof output !== "object") continue;
    if (output.kind === "prestige") {
      const slotDef = resolveSlotDef(processDef, "outputs", output.slotId);
      if (!slotDef) continue;
      const slotState = resolveSlotState(process, "outputs", slotDef);
      if (!slotState) continue;
      const candidates = listCandidateEndpoints(state, process, slotDef, target, context);
      let applied = false;
      for (const endpointRaw of slotState.ordered || []) {
        const enabled = slotState.enabled?.[endpointRaw];
        if (enabled === false) continue;
        const endpointId = resolveEndpointIdForRouting(endpointRaw, process, context);
        if (!endpointId) continue;
        if (!isEndpointValidForSlot(endpointId, candidates, processDef)) continue;
        if (applyPrestigeOutput(state, target, process, output, endpointId)) {
          applied = true;
          changed = true;
          break;
        }
      }
      if (!applied) continue;
      continue;
    }
    if (output.kind === "pool" && output.fromLedger) {
      const slotDef = resolveSlotDef(processDef, "outputs", output.slotId);
      if (!slotDef) continue;
      const slotState = resolveSlotState(process, "outputs", slotDef);
      if (!slotState) continue;
      const candidates = listCandidateEndpoints(state, process, slotDef, target, context);
      let applied = false;
      for (const endpointRaw of slotState.ordered || []) {
        const enabled = slotState.enabled?.[endpointRaw];
        if (enabled === false) continue;
        const endpointId = resolveEndpointIdForRouting(endpointRaw, process, context);
        if (!endpointId) continue;
        if (!isEndpointValidForSlot(endpointId, candidates, processDef)) continue;
        const endpoint = resolveEndpointTarget(state, endpointId);
        if (!endpoint) continue;
        if (applyPoolLedgerOutput(process, endpoint)) {
          applied = true;
          changed = true;
          break;
        }
      }
      if (!applied) continue;
      continue;
    }

    const qty = Math.max(0, Math.floor(output.qty ?? 0));
    if (qty <= 0) continue;
    const slotDef = resolveSlotDef(processDef, "outputs", output.slotId);
    if (!slotDef) continue;
    const slotState = resolveSlotState(process, "outputs", slotDef);
    if (!slotState) continue;
    const candidates = listCandidateEndpoints(state, process, slotDef, target, context);

    for (let i = 0; i < qty; i++) {
      let deposited = false;
      for (const endpointRaw of slotState.ordered || []) {
        const enabled = slotState.enabled?.[endpointRaw];
        if (enabled === false) continue;
        const endpointId = resolveEndpointIdForRouting(endpointRaw, process, context);
        if (!endpointId) continue;
        if (!isEndpointValidForSlot(endpointId, candidates, processDef)) continue;
        const endpoint = resolveEndpointTarget(state, endpointId);
        if (!endpoint) continue;
        if (!tryApplyOutputUnit(state, target, process, output, endpoint, context)) {
          continue;
        }
        deposited = true;
        changed = true;
        break;
      }
      if (!deposited) break;
    }
  }

  return changed;
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
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  const out = [];
  for (const ch of chars) {
    if (!ch) continue;
    if (Number.isFinite(ch.envCol)) continue;
    const c = Number.isFinite(ch.hubCol) ? Math.floor(ch.hubCol) : null;
    if (c == null) continue;
    if (c >= col && c <= maxCol) out.push(ch);
  }
  return out;
}

function resolveHubWorkers(state, target, context) {
  if (Array.isArray(context?.hubWorkers)) return context.hubWorkers;
  return listHubWorkers(state, target);
}

function applyWorkerCost(workers, cost) {
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
    const next = Math.max(clampMin, current - amount);
    if (next !== current) {
      systemState[key] = next;
      changed = true;
    }
  }
  return changed;
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

function finalizeBuildProcess(state, target, process) {
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

// Process schema
// - mode: "time" (default) or "work"
// - progress: numeric (seconds or work units)
// - durationSec: required units until completion
// - completionPolicy: "cropGrowth" (built-in) or "none"

export function handleCreateWorkProcess(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const queueKey = effect.queueKey || "processes";
    if (!Array.isArray(systemState[queueKey])) systemState[queueKey] = [];

    const { defId, def } = resolveEffectDef(effect, target, context);

    // Allow defless processes (crafting). If def exists, inputAmount can be derived from amount expression;
    // otherwise allow explicit inputAmount or default to 1.
    let inputAmount = 1;
    if (def) {
      const amountRaw = resolveAmount(effect, systemState, def, context);
      inputAmount = Math.max(0, Math.floor(amountRaw ?? 0));
    } else if (Number.isFinite(effect.inputAmount)) {
      inputAmount = Math.max(0, Math.floor(effect.inputAmount));
    }
    if (inputAmount <= 0) inputAmount = 1;

    const durationRaw = Number.isFinite(effect.durationSec)
      ? effect.durationSec
      : effect.durationFromDefKey && def
        ? def[effect.durationFromDefKey]
        : null;
    const durationSec = Number.isFinite(durationRaw)
      ? Math.max(1, Math.floor(durationRaw))
      : null;
    if (!durationSec) continue;

    const type = effect.processType || effect.type || "process";
    if (effect.uniqueType === true) {
      const existing = systemState[queueKey].some((p) => p?.type === type);
      if (existing) continue;
    }

    const nowSec = nowSecFrom(state, context);
    const process = {
      id: `proc_${target.instanceId}_${nowSec}_${systemState[queueKey].length}`,
      type,
      mode: effect.mode === "work" ? "work" : "time",
      defRegistry: effect.defRegistry || effect.registry || null,
      defId,
      startSec: nowSec,
      durationSec,
      progress: 0,
      inputAmount,
      completionPolicy:
        effect.completionPolicy ||
        (type === "cropGrowth" ? "cropGrowth" : "none"),
      poolKey: effect.poolKey || "maturedPool",
    };

    if (Array.isArray(effect.requirements)) {
      const reqs = normalizeProcessRequirements(effect.requirements);
      if (reqs.length > 0) process.requirements = reqs;
    }

    if (effect.processMeta && typeof effect.processMeta === "object") {
      const meta = cloneSerializable(effect.processMeta);
      if (meta && typeof meta === "object") {
        for (const [key, value] of Object.entries(meta)) {
          if (Object.prototype.hasOwnProperty.call(process, key)) continue;
          process[key] = value;
        }
      }
    }

    if (Array.isArray(effect.outputs) && effect.outputs.length > 0) {
      process.outputs = effect.outputs.map((out) => ({ ...out }));
    }

    if (effect.captureSystem && effect.captureKey) {
      const captureState = ensureSystemState(target, effect.captureSystem);
      const captureValue = captureState[effect.captureKey];
      const outKey = effect.captureAs || effect.captureKey;
      if (outKey) {
        process[outKey] = Number.isFinite(captureValue)
          ? captureValue
          : captureValue ?? 0;
      }
    }

    if (process.ownerId == null) {
      process.ownerId =
        context?.ownerId ??
        (Number.isFinite(target?.instanceId) ? target.instanceId : null);
    }
    if (process.leaderId == null && Number.isFinite(context?.leaderId)) {
      process.leaderId = Math.floor(context.leaderId);
    }

    const processDef = getProcessDefForInstance(process, target, context);
    if (processDef) {
      const routingContext = { ...(context || {}), target, systemId };
      ensureProcessRoutingState(process, processDef, routingContext);
      seedRoutingWithCandidates(state, target, process, processDef, routingContext);
      ensureProcessRequirements(process, processDef);
      ensureProcessBufferInventory(state, process, processDef);
    }

    systemState[queueKey].push(process);
    changed = true;
  }

  return changed;
}

function countEnvWorkers(state, envCol) {
  const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
  if (col == null) return 0;
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  let n = 0;
  for (const ch of chars) {
    if (!ch) continue;
    const c = Number.isFinite(ch.envCol) ? Math.floor(ch.envCol) : null;
    if (c === col) n++;
  }
  return n;
}

function countHubWorkers(state, structure) {
  return listHubWorkers(state, structure).length;
}

export function handleAdvanceWorkProcess(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  const deltaTime = Number.isFinite(effect.deltaSec)
    ? Math.max(1, Math.floor(effect.deltaSec))
    : 1;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const queueKey = effect.queueKey || "processes";
    const existingQueue = systemState[queueKey];
    const processes = Array.isArray(existingQueue) ? existingQueue : [];
    if (!Array.isArray(existingQueue)) {
      systemState[queueKey] = processes;
      changed = true;
    }
    if (processes.length === 0) continue;

    // ensure pool exists for cropGrowth completion
    const poolKey = effect.poolKey || "maturedPool";
    if (!systemState[poolKey] || typeof systemState[poolKey] !== "object") {
      systemState[poolKey] = {
        bronze: 0,
        silver: 0,
        gold: 0,
        diamond: 0,
      };
    }

    const nextQueue = [];
    for (const process of processes) {
      if (!process) continue;
      if (effect.processType && process.type !== effect.processType) {
        nextQueue.push(process);
        continue;
      }

      const processDef = getProcessDefForInstance(process, target, context);
      if (processDef) {
        const routingContext = { ...(context || {}), target, systemId };
        ensureProcessRoutingState(process, processDef, routingContext);
        seedRoutingWithCandidates(state, target, process, processDef, routingContext);
        ensureProcessRequirements(process, processDef);
        ensureProcessBufferInventory(state, process, processDef);
      }

      const durationSec = Math.max(1, Math.floor(process.durationSec ?? 0));
      const mode = process.mode === "work" ? "work" : "time";

      let inc = deltaTime;
      let hubWorkers = null;
      if (mode === "work") {
        // If workersFrom is explicitly provided, use worker counting.
        // Otherwise, treat this as a per-pawn contribution call and use effect.amount.
        if (typeof effect.workersFrom === "string") {
          const workersFrom = effect.workersFrom;
          let workers = 0;
          if (workersFrom === "envCol") {
            workers = countEnvWorkers(state, context?.envCol);
          } else if (workersFrom === "hubAnchor") {
            hubWorkers = resolveHubWorkers(state, target, context);
            workers = hubWorkers.length;
          } else {
            workers = 1;
          }
          inc = Math.max(0, Math.floor(workers));
        } else {
          const amtRaw = Number.isFinite(effect.amount) ? effect.amount : 1;
          inc = Math.max(0, Math.floor(amtRaw));
        }
      }

      if (!processDef && !areRequirementsComplete(process)) {
        nextQueue.push(process);
        continue;
      }
      if (processDef && !areRequirementsComplete(process)) {
        const reqRes = advanceProcessRequirements(
          state,
          target,
          process,
          processDef,
          inc,
          context
        );
        if (reqRes.changed) changed = true;
        if (!reqRes.done) {
          nextQueue.push(process);
          continue;
        }
      }

      const cur = Number.isFinite(process.progress) ? process.progress : 0;
      const next = cur + inc;
      if (next !== cur) {
        process.progress = next;
        changed = true;
      }

      if (next !== cur && hubWorkers && effect.workerCost) {
        if (applyWorkerCost(hubWorkers, effect.workerCost)) {
          changed = true;
        }
      }

      if (next < durationSec) {
        nextQueue.push(process);
        continue;
      }

      // complete
      const policy = process.completionPolicy || "none";
      if (policy === "cropGrowth") {
        const { def } = resolveEffectDef(
          { defRegistry: process.defRegistry, defId: process.defId },
          target,
          context
        );
        if (def) {
          const hydrationTier = getTierValueForSystem(target, "hydration");
          const fertilityTier = getTierValueForSystem(target, "fertility");
          const hydrationState = target.systemState?.hydration || {};
          const sumRatio = Number.isFinite(hydrationState.sumRatio)
            ? hydrationState.sumRatio
            : 0;
          const sumAtStart = Number.isFinite(process.sumAtStart)
            ? process.sumAtStart
            : 0;
          const rAvg = clamp((sumRatio - sumAtStart) / durationSec, 0, 1);

          const curveSource = envSystemDefs[systemId];
          const curveByTier = curveSource?.hydrationCurveByTier || null;
          const curve =
            curveByTier?.[hydrationTier] ||
            curveByTier?.silver ||
            { A: 1, P: 1 };
          const factor =
            (Number.isFinite(curve?.A) ? curve.A : 1) *
            Math.pow(rAvg, Number.isFinite(curve?.P) ? curve.P : 1);

          const inputAmount = Math.max(0, Math.floor(process.inputAmount ?? 0));
          const baseYield = Number.isFinite(def.baseYieldMultiplier)
            ? def.baseYieldMultiplier
            : 1;
          const maturedUnits = Math.floor(inputAmount * baseYield * factor);
          if (maturedUnits > 0) {
            const table =
              def?.qualityTablesByFertilityTier?.[fertilityTier] ??
              def?.qualityTablesByFertilityTier?.silver ??
              [];
            const pool = systemState[process.poolKey || poolKey];
            for (let i = 0; i < maturedUnits; i++) {
              const tier = rollQualityTier(state, table);
              pool[tier] = (pool[tier] ?? 0) + 1;
            }
          }
        }
        changed = true;
      } else if (policy === "build") {
        if (finalizeBuildProcess(state, target, process)) {
          changed = true;
        }
      } else {
        // policy === "none": apply outputs via routing
        if (processDef) {
          if (applyProcessOutputs(state, target, process, processDef, context)) {
            changed = true;
          }
        } else if (Array.isArray(process.outputs)) {
          for (const out of process.outputs) {
            if (!out?.kind) continue;
            handleSpawnItem(
              state,
              {
                op: "SpawnItem",
                itemKind: out.kind,
                amount: Number.isFinite(out.qty) ? out.qty : 1,
                perOwner: true,
                target: { kind: "tileOccupants" },
              },
              context
            );
          }
          changed = true;
        }
      }
    }

    if (nextQueue.length !== processes.length) {
      systemState[queueKey] = nextQueue;
      changed = true;
    }
  }

  return changed;
}

function rollQualityTier(state, table) {
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
