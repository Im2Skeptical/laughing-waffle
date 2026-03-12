import { itemDefs } from "../defs/gamepieces/item-defs.js";
import {
  isDropEndpoint,
  listCandidateEndpoints,
  resolveEndpointTarget,
} from "./process-framework.js";
import {
  isEndpointValidForSlot,
  isTierBucket,
  resolveEndpointIdForRouting,
  resolveSlotDef,
} from "./effects/ops/system/work-process-routing.js";

const TIER_ORDER = ["bronze", "silver", "gold", "diamond"];

function safeFloor(value, fallback = 0) {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function normalizeRequirementEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const kind =
    entry.kind === "item" || entry.kind === "tag" || entry.kind === "resource"
      ? entry.kind
      : null;
  if (!kind) return null;

  const amount = Math.max(0, safeFloor(entry.amount, 0));
  const progress = Math.max(0, safeFloor(entry.progress, 0));
  const requirementType =
    typeof entry.requirementType === "string" && entry.requirementType.length > 0
      ? entry.requirementType
      : null;
  if (amount <= 0) return null;

  if (kind === "item") {
    const itemId =
      typeof entry.itemId === "string" && entry.itemId.length > 0
        ? entry.itemId
        : null;
    if (!itemId) return null;
    return {
      kind,
      itemId,
      amount,
      progress,
      consume: entry.consume !== false,
      requirementType,
      slotId:
        typeof entry.slotId === "string" && entry.slotId.length > 0
          ? entry.slotId
          : null,
    };
  }

  if (kind === "tag") {
    const tag =
      typeof entry.tag === "string" && entry.tag.length > 0 ? entry.tag : null;
    if (!tag) return null;
    return {
      kind,
      tag,
      amount,
      progress,
      consume: entry.consume !== false,
      requirementType,
      slotId:
        typeof entry.slotId === "string" && entry.slotId.length > 0
          ? entry.slotId
          : null,
    };
  }

  const resource =
    typeof entry.resource === "string" && entry.resource.length > 0
      ? entry.resource
      : null;
  if (!resource) return null;
  return {
    kind,
    resource,
    amount,
    progress,
    consume: entry.consume !== false,
    requirementType,
    slotId:
      typeof entry.slotId === "string" && entry.slotId.length > 0
        ? entry.slotId
        : null,
  };
}

function getRequirementMaterialKey(requirement) {
  if (!requirement) return "unknown:";
  if (requirement.kind === "item") return `item:${requirement.itemId}`;
  if (requirement.kind === "tag") return `tag:${requirement.tag}`;
  if (requirement.kind === "resource") return `resource:${requirement.resource}`;
  return "unknown:";
}

function getRequirementList(process, processDef) {
  const runtimeRequirements = Array.isArray(process?.requirements)
    ? process.requirements
    : [];
  if (runtimeRequirements.length > 0) {
    return runtimeRequirements.map((entry) => normalizeRequirementEntry(entry)).filter(Boolean);
  }
  const defRequirements = Array.isArray(processDef?.transform?.requirements)
    ? processDef.transform.requirements
    : [];
  return defRequirements
    .map((entry) =>
      normalizeRequirementEntry({
        ...entry,
        progress: 0,
      })
    )
    .filter(Boolean);
}

function tierRank(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  return idx >= 0 ? idx : TIER_ORDER.length;
}

function compareInventoryItems(a, b) {
  const rankDiff = tierRank(a?.tier) - tierRank(b?.tier);
  if (rankDiff !== 0) return rankDiff;

  const aId = Number.isFinite(a?.id) ? a.id : Number(a?.id);
  const bId = Number.isFinite(b?.id) ? b.id : Number(b?.id);
  if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
    return aId - bId;
  }

  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

function cloneInventoryForSim(inv) {
  const items = Array.isArray(inv?.items) ? inv.items : [];
  return {
    items: items
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        return {
          id: item.id,
          kind: item.kind,
          quantity: Math.max(0, safeFloor(item.quantity, 0)),
          tier: item.tier ?? "bronze",
          tags: Array.isArray(item.tags) ? item.tags.slice() : [],
        };
      })
      .filter((item) => !!item && item.quantity > 0),
  };
}

function matchesInventoryRequirement(item, requirement) {
  if (!item || !requirement) return false;
  if (item.quantity <= 0) return false;
  if (requirement.kind === "item") {
    return item.kind === requirement.itemId;
  }
  if (requirement.kind === "tag") {
    return Array.isArray(item.tags) && item.tags.includes(requirement.tag);
  }
  return false;
}

function canConsumeInventoryUnit(simInv, requirement) {
  if (!simInv || !Array.isArray(simInv.items)) return false;
  for (const item of simInv.items) {
    if (matchesInventoryRequirement(item, requirement)) return true;
  }
  return false;
}

function consumeInventoryUnit(simInv, requirement) {
  if (!simInv || !Array.isArray(simInv.items)) return false;
  const candidates = simInv.items.filter((item) =>
    matchesInventoryRequirement(item, requirement)
  );
  if (candidates.length <= 0) return false;
  candidates.sort(compareInventoryItems);
  const chosen = candidates[0];
  chosen.quantity = Math.max(0, chosen.quantity - 1);
  if (chosen.quantity <= 0) {
    const idx = simInv.items.indexOf(chosen);
    if (idx >= 0) simInv.items.splice(idx, 1);
  }
  return true;
}

function clonePoolForSim(pool) {
  if (!pool || typeof pool !== "object") return null;
  if (isTierBucket(pool)) {
    const clone = {};
    for (const tier of TIER_ORDER) {
      clone[tier] = Math.max(0, safeFloor(pool[tier], 0));
    }
    return clone;
  }

  const clone = {};
  for (const key of Object.keys(pool)) {
    const bucket = pool[key];
    if (!bucket || typeof bucket !== "object") continue;
    const bucketClone = {};
    for (const tier of TIER_ORDER) {
      bucketClone[tier] = Math.max(0, safeFloor(bucket[tier], 0));
    }
    clone[key] = bucketClone;
  }
  return clone;
}

function getPoolItemIdForRequirement(simEndpoint, requirement) {
  if (!simEndpoint || !requirement) return null;
  const pool = simEndpoint.target;
  if (!pool || typeof pool !== "object") return null;

  if (requirement.kind === "item") {
    if (isTierBucket(pool) && simEndpoint.itemId) {
      return simEndpoint.itemId === requirement.itemId ? requirement.itemId : null;
    }
    return requirement.itemId;
  }

  if (requirement.kind !== "tag") return null;

  if (isTierBucket(pool)) {
    if (!simEndpoint.itemId) return null;
    const tags = Array.isArray(itemDefs?.[simEndpoint.itemId]?.baseTags)
      ? itemDefs[simEndpoint.itemId].baseTags
      : [];
    return tags.includes(requirement.tag) ? simEndpoint.itemId : null;
  }

  const kinds = Object.keys(pool).sort((a, b) => a.localeCompare(b));
  for (const kind of kinds) {
    const tags = Array.isArray(itemDefs?.[kind]?.baseTags)
      ? itemDefs[kind].baseTags
      : [];
    if (!tags.includes(requirement.tag)) continue;
    const bucket = pool[kind];
    if (!bucket || typeof bucket !== "object") continue;
    for (const tier of TIER_ORDER) {
      if (Math.max(0, safeFloor(bucket[tier], 0)) > 0) return kind;
    }
  }

  return null;
}

function canConsumePoolUnit(simEndpoint, requirement) {
  const pool = simEndpoint?.target;
  if (!pool || typeof pool !== "object") return false;

  const itemId = getPoolItemIdForRequirement(simEndpoint, requirement);
  if (!itemId) return false;

  if (isTierBucket(pool)) {
    for (const tier of TIER_ORDER) {
      if (Math.max(0, safeFloor(pool[tier], 0)) > 0) return true;
    }
    return false;
  }

  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") return false;
  for (const tier of TIER_ORDER) {
    if (Math.max(0, safeFloor(bucket[tier], 0)) > 0) return true;
  }
  return false;
}

function consumePoolUnit(simEndpoint, requirement) {
  const pool = simEndpoint?.target;
  if (!pool || typeof pool !== "object") return false;

  const itemId = getPoolItemIdForRequirement(simEndpoint, requirement);
  if (!itemId) return false;

  if (isTierBucket(pool)) {
    for (const tier of TIER_ORDER) {
      const available = Math.max(0, safeFloor(pool[tier], 0));
      if (available <= 0) continue;
      pool[tier] = available - 1;
      return true;
    }
    return false;
  }

  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") return false;
  for (const tier of TIER_ORDER) {
    const available = Math.max(0, safeFloor(bucket[tier], 0));
    if (available <= 0) continue;
    bucket[tier] = available - 1;
    return true;
  }
  return false;
}

function cloneResourceStateForSim(resources) {
  const clone = {};
  if (!resources || typeof resources !== "object") return clone;
  for (const [key, value] of Object.entries(resources)) {
    if (!Number.isFinite(value)) continue;
    clone[key] = Math.max(0, Math.floor(value));
  }
  return clone;
}

function canConsumeResourceUnit(simResources, requirement) {
  if (!simResources || !requirement?.resource) return false;
  return Math.max(0, safeFloor(simResources[requirement.resource], 0)) > 0;
}

function consumeResourceUnit(simResources, requirement) {
  if (!canConsumeResourceUnit(simResources, requirement)) return false;
  simResources[requirement.resource] =
    Math.max(0, safeFloor(simResources[requirement.resource], 0)) - 1;
  return true;
}

function createEndpointSimState(endpoint) {
  if (!endpoint || typeof endpoint !== "object") return null;
  if (endpoint.kind === "inventory") {
    return {
      kind: "inventory",
      target: cloneInventoryForSim(endpoint.target),
    };
  }
  if (endpoint.kind === "pool") {
    return {
      kind: "pool",
      target: clonePoolForSim(endpoint.target),
      itemId:
        typeof endpoint.itemId === "string" && endpoint.itemId.length > 0
          ? endpoint.itemId
          : null,
    };
  }
  if (endpoint.kind === "resource") {
    return {
      kind: "resource",
      target: cloneResourceStateForSim(endpoint.target),
    };
  }
  return null;
}

function getOrCreateEndpointSimState(endpointCache, state, endpointId) {
  if (!endpointCache || !state || !endpointId) return null;
  if (endpointCache.has(endpointId)) {
    return endpointCache.get(endpointId) || null;
  }
  const endpoint = resolveEndpointTarget(state, endpointId);
  if (!endpoint) {
    endpointCache.set(endpointId, null);
    return null;
  }
  const simState = createEndpointSimState(endpoint);
  endpointCache.set(endpointId, simState);
  return simState;
}

function canSpendRequirementUnitFromEndpoint(endpointSim, requirement) {
  if (!endpointSim || !requirement) return false;
  if (requirement.kind === "item" || requirement.kind === "tag") {
    if (endpointSim.kind === "inventory") {
      return canConsumeInventoryUnit(endpointSim.target, requirement);
    }
    if (endpointSim.kind === "pool") {
      return canConsumePoolUnit(endpointSim, requirement);
    }
    return false;
  }
  if (requirement.kind === "resource") {
    if (endpointSim.kind !== "resource") return false;
    return canConsumeResourceUnit(endpointSim.target, requirement);
  }
  return false;
}

function spendRequirementUnitFromEndpoint(endpointSim, requirement) {
  if (!endpointSim || !requirement) return false;
  if (requirement.kind === "item" || requirement.kind === "tag") {
    if (endpointSim.kind === "inventory") {
      if (requirement.consume === false) {
        return consumeInventoryUnit(endpointSim.target, requirement);
      }
      return consumeInventoryUnit(endpointSim.target, requirement);
    }
    if (endpointSim.kind === "pool") {
      if (requirement.consume === false) {
        return consumePoolUnit(endpointSim, requirement);
      }
      return consumePoolUnit(endpointSim, requirement);
    }
    return false;
  }
  if (requirement.kind === "resource") {
    if (endpointSim.kind !== "resource") return false;
    if (requirement.consume === false) {
      return consumeResourceUnit(endpointSim.target, requirement);
    }
    return consumeResourceUnit(endpointSim.target, requirement);
  }
  return false;
}

function resolveRequirementRoute({
  state,
  target,
  process,
  processDef,
  requirement,
  routingStateOverride,
  context,
}) {
  const slotDef = resolveSlotDef(processDef, "inputs", requirement?.slotId);
  if (!slotDef) {
    return { endpointIds: [] };
  }

  const candidates = listCandidateEndpoints(
    state,
    process,
    slotDef,
    target,
    context
  );
  const routingInputs =
    routingStateOverride?.inputs && typeof routingStateOverride.inputs === "object"
      ? routingStateOverride.inputs
      : process?.routing?.inputs && typeof process.routing.inputs === "object"
        ? process.routing.inputs
        : null;
  const slotState =
    routingInputs && typeof routingInputs[slotDef.slotId] === "object"
      ? routingInputs[slotDef.slotId]
      : null;
  const orderedRaw = Array.isArray(slotState?.ordered)
    ? slotState.ordered
    : candidates;
  const enabledMap =
    slotState?.enabled && typeof slotState.enabled === "object"
      ? slotState.enabled
      : {};

  const endpointIds = [];
  const seen = new Set();
  const routeContext = { leaderId: process?.leaderId ?? context?.leaderId ?? null };

  for (const endpointRaw of orderedRaw) {
    if (typeof endpointRaw !== "string" || endpointRaw.length <= 0) continue;
    if (isDropEndpoint(endpointRaw)) continue;
    if (enabledMap[endpointRaw] === false) continue;

    const endpointId = resolveEndpointIdForRouting(
      endpointRaw,
      process,
      routeContext
    );
    if (!endpointId) continue;
    if (isDropEndpoint(endpointId)) continue;
    if (!isEndpointValidForSlot(endpointId, candidates, processDef)) continue;
    if (seen.has(endpointId)) continue;

    seen.add(endpointId);
    endpointIds.push(endpointId);
  }

  return { endpointIds };
}

function spendRequirementUnits({
  state,
  endpointIds,
  requirement,
  unitsNeeded,
  endpointCache,
}) {
  if (!state || !Array.isArray(endpointIds) || endpointIds.length <= 0) return 0;
  if (!requirement || unitsNeeded <= 0) return 0;

  const needed = Math.max(0, safeFloor(unitsNeeded, 0));
  if (needed <= 0) return 0;

  let spentCount = 0;
  for (let i = 0; i < needed; i += 1) {
    let spent = false;
    for (const endpointId of endpointIds) {
      const endpointSim = getOrCreateEndpointSimState(endpointCache, state, endpointId);
      if (!endpointSim) continue;
      if (!spendRequirementUnitFromEndpoint(endpointSim, requirement)) continue;
      spent = true;
      spentCount += 1;
      break;
    }
    if (!spent) break;
  }

  return spentCount;
}

function computeAccessibleUnitsForRequirement({ state, endpointIds, requirement }) {
  if (!requirement) return 0;
  const cap =
    requirement.consume === false
      ? Math.max(0, safeFloor(requirement.amount, 0))
      : Number.MAX_SAFE_INTEGER;
  if (cap <= 0) return 0;
  const endpointCache = new Map();
  return spendRequirementUnits({
    state,
    endpointIds,
    requirement,
    unitsNeeded: cap,
    endpointCache,
  });
}

export function evaluateProcessRequirementAvailability({
  state,
  target,
  process,
  processDef,
  routingStateOverride = null,
  context = null,
} = {}) {
  if (!state || !target || !process || !processDef) {
    return {
      canFulfillAll: true,
      requirements: [],
    };
  }

  const requirements = getRequirementList(process, processDef);
  if (requirements.length <= 0) {
    return {
      canFulfillAll: true,
      requirements: [],
    };
  }

  const resolvedContext = {
    leaderId: process?.leaderId ?? context?.leaderId ?? null,
  };
  const endpointCache = new Map();
  const requirementResults = [];
  let canFulfillAll = true;

  for (const requirement of requirements) {
    const required = Math.max(0, safeFloor(requirement.amount, 0));
    const loaded = Math.min(
      required,
      Math.max(0, safeFloor(requirement.progress, 0))
    );
    const needed = Math.max(0, required - loaded);

    const route = resolveRequirementRoute({
      state,
      target,
      process,
      processDef,
      requirement,
      routingStateOverride,
      context: resolvedContext,
    });

    const reachableFromInputs =
      needed > 0
        ? spendRequirementUnits({
            state,
            endpointIds: route.endpointIds,
            requirement,
            unitsNeeded: needed,
            endpointCache,
          })
        : 0;

    const accessibleTotal = computeAccessibleUnitsForRequirement({
      state,
      endpointIds: route.endpointIds,
      requirement,
    });

    const reachableTotal = Math.max(0, loaded + reachableFromInputs);
    const shortfall = Math.max(0, required - reachableTotal);
    const fulfillable = shortfall <= 0;
    if (!fulfillable) canFulfillAll = false;

    requirementResults.push({
      requirement,
      required,
      loaded,
      reachableFromInputs,
      reachableTotal,
      accessibleTotal,
      shortfall,
      fulfillable,
      materialKey: getRequirementMaterialKey(requirement),
    });
  }

  return {
    canFulfillAll,
    requirements: requirementResults,
  };
}
