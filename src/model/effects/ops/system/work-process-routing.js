import { itemDefs } from "../../../../defs/gamepieces/item-defs.js";
import { TIER_ASC } from "../../core/tiers.js";
import {
  listCandidateEndpoints,
  resolveEndpointTarget,
  resolveFixedEndpointId,
  canConsumeRequirementUnit,
  consumeRequirementUnit,
  isDropEndpoint,
  getDropEndpointId,
} from "../../../process-framework.js";

export function normalizeProcessRequirements(requirements) {
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

export function areRequirementsComplete(process) {
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

export const DEFAULT_INPUT_SLOT_ID = "materials";
export const DEFAULT_OUTPUT_SLOT_ID = "output";

export function ensureProcessRequirements(process, processDef) {
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

export function resolveSlotDef(processDef, slotKind, slotId) {
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

export function resolveSlotState(process, slotKind, slotDef) {
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

export function resolveEndpointIdForRouting(endpointId, process, context) {
  if (!endpointId || typeof endpointId !== "string") return null;
  const resolved = resolveFixedEndpointId(endpointId, process, context);
  return resolved || endpointId;
}

export function isEndpointValidForSlot(endpointId, candidates, processDef) {
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

export function isTierBucket(pool) {
  if (!pool || typeof pool !== "object") return false;
  for (const tier of TIER_ASC) {
    if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
  }
  return false;
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

  const tags = Array.isArray(consumed.tags) ? consumed.tags : [];
  if (tags.includes("prestiged")) return;

  if (
    !process.prestigeConsumedByKindTier ||
    typeof process.prestigeConsumedByKindTier !== "object"
  ) {
    process.prestigeConsumedByKindTier = {};
  }
  if (!process.prestigeConsumedByKindTier[consumed.kind]) {
    process.prestigeConsumedByKindTier[consumed.kind] = {};
  }
  const prestigeBucket = process.prestigeConsumedByKindTier[consumed.kind];
  prestigeBucket[tier] = Math.max(0, Math.floor(prestigeBucket[tier] ?? 0)) + 1;
}

export function ensureTierBucket(container, itemId = null) {
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

export function seedRoutingWithCandidates(state, target, process, processDef, context) {
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

export function advanceProcessRequirements(
  state,
  target,
  process,
  processDef,
  budget,
  context
) {
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
