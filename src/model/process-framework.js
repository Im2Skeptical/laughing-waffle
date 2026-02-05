// process-framework.js
// Deterministic process defs + routing helpers (model-only).

import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { TIER_ASC, getTierRank } from "./effects/core/tiers.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
  initializeItemFromDef,
  mergeItemSystemStateForStacking,
} from "./inventory-model.js";
import { bumpInvVersion } from "./effects/core/inventory-version.js";

const DEFAULT_PROCESS_INPUT_SLOT = "materials";
const DEFAULT_PROCESS_OUTPUT_SLOT = "output";

const DROP_ENDPOINT_PREFIX = "inv:process:";
const POOL_ENDPOINT_PREFIX = "sys:pool:";

function normalizeString(value) {
  return typeof value === "string" && value.length ? value : null;
}

function safeFloor(value, fallback = 0) {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function normalizeRequirementEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const kind = normalizeString(entry.kind);
  const itemId = normalizeString(entry.itemId);
  const tag = normalizeString(entry.tag || entry.itemTag);
  const resource = normalizeString(entry.resource);
  const amount = Math.max(0, safeFloor(entry.amount, 0));
  const progress = Math.max(0, safeFloor(entry.progress, 0));
  const consume =
    typeof entry.consume === "boolean" ? entry.consume : entry.consume !== false;
  const slotId = normalizeString(entry.slotId);

  if (kind === "item" && !itemId) return null;
  if (kind === "tag" && !tag) return null;
  if (kind === "resource" && !resource) return null;

  const inferredKind = kind || (itemId ? "item" : tag ? "tag" : resource ? "resource" : null);
  if (!inferredKind) return null;

  return {
    kind: inferredKind,
    itemId,
    tag,
    resource,
    amount,
    progress,
    consume,
    slotId,
  };
}

function normalizeOutputEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const kind = normalizeString(entry.kind);
  const slotId = normalizeString(entry.slotId);
  if (kind === "pool") {
    const system = normalizeString(entry.system);
    const poolKey = normalizeString(entry.poolKey);
    const itemId = normalizeString(entry.itemId);
    const qty = Math.max(0, safeFloor(entry.qty ?? entry.amount, 0));
    const tier = normalizeString(entry.tier);
    if (!system || !poolKey || !itemId || qty <= 0) return null;
    return { kind: "pool", system, poolKey, itemId, qty, tier, slotId };
  }
  if (kind === "resource") {
    const resource = normalizeString(entry.resource);
    const qty = Math.max(0, safeFloor(entry.qty ?? entry.amount, 0));
    if (!resource || qty <= 0) return null;
    return { kind: "resource", resource, qty, slotId };
  }
  if (kind === "system") {
    const system = normalizeString(entry.system);
    const key = normalizeString(entry.key);
    const qty = safeFloor(entry.qty ?? entry.amount, 0);
    if (!system || !key) return null;
    return { kind: "system", system, key, qty, slotId };
  }
  if (kind === "prestige") {
    const qty = Math.max(0, safeFloor(entry.qty ?? entry.amount, 0));
    return { kind: "prestige", qty, slotId };
  }
  const itemId =
    kind && kind !== "item" ? kind : normalizeString(entry.itemId);
  const qty = Math.max(0, safeFloor(entry.qty ?? entry.amount, 1));
  if (!itemId || qty <= 0) return null;
  const tier = normalizeString(entry.tier);
  return { kind: "item", itemId, qty, tier, slotId };
}

function buildRecipeRequirements(recipeDef) {
  const reqs = [];
  const inputs = Array.isArray(recipeDef?.inputs) ? recipeDef.inputs : [];
  for (const input of inputs) {
    if (!input) continue;
    const itemId = normalizeString(input.kind || input.itemId);
    const amount = Math.max(0, safeFloor(input.qty ?? input.amount, 0));
    if (!itemId || amount <= 0) continue;
    reqs.push({
      kind: "item",
      itemId,
      amount,
      progress: 0,
      consume: true,
    });
  }
  const tools = Array.isArray(recipeDef?.toolRequirements)
    ? recipeDef.toolRequirements
    : [];
  for (const tool of tools) {
    if (!tool) continue;
    const itemId = normalizeString(tool.kind || tool.itemId);
    const amount = Math.max(0, safeFloor(tool.qty ?? tool.amount, 0));
    if (!itemId || amount <= 0) continue;
    reqs.push({
      kind: "item",
      itemId,
      amount,
      progress: 0,
      consume: false,
    });
  }
  return reqs;
}

function buildRecipeOutputs(recipeDef) {
  const outs = [];
  const outputs = Array.isArray(recipeDef?.outputs) ? recipeDef.outputs : [];
  for (const out of outputs) {
    if (!out) continue;
    const itemId = normalizeString(out.kind || out.itemId);
    const qty = Math.max(0, safeFloor(out.qty ?? out.amount, 0));
    if (!itemId || qty <= 0) continue;
    outs.push({
      kind: "item",
      itemId,
      qty,
    });
  }
  return outs;
}

function getProcessDisplayName(process, recipeDef) {
  if (recipeDef?.name) return recipeDef.name;
  const kind = normalizeString(process?.type) || "Process";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function buildInputSlotsForProcess(kind, opts = {}) {
  const base = [];
  if (kind === "build") {
    const buildRule =
      opts.inputRule || { kind: "adjacentStructures", range: 1, store: "inv" };
    base.push({
      slotId: DEFAULT_PROCESS_INPUT_SLOT,
      label: "Materials",
      locked: false,
      mode: "consume",
      candidateRule: buildRule,
      default: { ordered: [] },
    });
    return base;
  }
  if (kind === "cropGrowth") {
    const seedRule =
      opts.inputRule || { kind: "adjacentDistributors", range: 1, store: "inv" };
    base.push({
      slotId: DEFAULT_PROCESS_INPUT_SLOT,
      label: "Seeds",
      locked: false,
      mode: "consume",
      candidateRule: seedRule,
      default: { ordered: [] },
    });
    return base;
  }
  if (kind === "depositGrain") {
    base.push({
      slotId: "grain",
      label: "Grain",
      locked: false,
      mode: "consume",
      candidateRule: { kind: "ownerInv" },
      default: { ordered: [] },
    });
    return base;
  }
  const inputRule =
    opts.inputRule || { kind: "adjacentDistributors", range: 1, tag: "distributor", store: "inv" };
  base.push({
    slotId: DEFAULT_PROCESS_INPUT_SLOT,
    label: "Inputs",
    locked: false,
    mode: "consume",
    candidateRule: inputRule,
    default: { ordered: [] },
  });
  return base;
}

function buildOutputSlotsForProcess(kind, opts = {}) {
  const base = [];
  if (kind === "build") {
    base.push({
      slotId: "buildResult",
      label: "Result",
      locked: true,
      mode: "spawn",
      candidateRule: { kind: "fixed", endpointId: "spawn:tileOccupants" },
      default: { ordered: ["spawn:tileOccupants"] },
    });
    return base;
  }
  if (kind === "depositGrain") {
    base.push({
      slotId: "prestige",
      label: "Prestige",
      locked: true,
      mode: "award",
      candidateRule: { kind: "fixed", endpointId: "sys:pawn:leader" },
      default: { ordered: ["sys:pawn:leader"] },
    });
    return base;
  }
  if (kind === "cropGrowth") {
    base.push({
      slotId: "maturedPool",
      label: "Matured Pool",
      locked: true,
      mode: "deposit",
      candidateRule: { kind: "fixed", endpointId: null },
      default: { ordered: [] },
    });
    return base;
  }
  const outputRule =
    opts.outputRule || { kind: "adjacentDistributors", range: 1, tag: "distributor", store: "inv" };
  base.push({
    slotId: DEFAULT_PROCESS_OUTPUT_SLOT,
    label: "Outputs",
    locked: false,
    mode: "deposit",
    candidateRule: outputRule,
    default: { ordered: [] },
  });
  return base;
}

export function getProcessDefForInstance(process, target, context) {
  if (!process || typeof process !== "object") return null;
  const kind = normalizeString(process.type) || "process";

  const recipeDef = recipeDefs?.[kind] || null;
  const isRecipe = !!recipeDef;
  const cropDef =
    kind === "cropGrowth"
      ? cropDefs?.[process?.defId] || cropDefs?.[process?.cropId] || null
      : null;

  const transform = {
    mode: process.mode === "work" ? "work" : "time",
    durationSec: Math.max(1, safeFloor(process.durationSec, 1)),
    requirements: Array.isArray(process.requirements)
      ? process.requirements.map((entry) => normalizeRequirementEntry(entry)).filter(Boolean)
      : [],
    outputs: Array.isArray(process.outputs)
      ? process.outputs.map((entry) => normalizeOutputEntry(entry)).filter(Boolean)
      : [],
    completionPolicy: normalizeString(process.completionPolicy) || "none",
  };

  if (isRecipe) {
    transform.durationSec = Math.max(
      1,
      safeFloor(recipeDef?.durationSec, transform.durationSec)
    );
    if (!transform.requirements.length) {
      transform.requirements = buildRecipeRequirements(recipeDef);
    }
    if (!transform.outputs.length) {
      transform.outputs = buildRecipeOutputs(recipeDef);
    }
  }

  if (kind === "depositGrain") {
    if (!transform.outputs.length) {
      transform.outputs = [
        {
          kind: "prestige",
          qty: 1,
          slotId: "prestige",
        },
      ];
    }
  }
  if (kind === "cropGrowth" && cropDef) {
    const seedItem = normalizeString(cropDef.cropId || process?.defId);
    const seedAmount = Math.max(0, safeFloor(process?.inputAmount ?? 0, 0));
    if (seedItem && seedAmount > 0 && transform.requirements.length === 0) {
      transform.requirements = [
        {
          kind: "item",
          itemId: seedItem,
          amount: seedAmount,
          progress: 0,
          consume: true,
          slotId: DEFAULT_PROCESS_INPUT_SLOT,
        },
      ];
    }
  }

  let inputRule = null;
  let outputRule = null;

  if (kind === "build") {
    inputRule = {
      kind: "adjacentStructures",
      range: 1,
      store: "inv",
      includeSelfInv: true,
      includeOccupants: true,
    };
  } else if (recipeDef?.kind === "cook" || recipeDef?.kind === "craft") {
    inputRule = {
      kind: "adjacentDistributors",
      range: 1,
      tag: "distributor",
      store: "inv",
      includeSelfInv: true,
      includeOccupants: true,
      includePool: { systemId: "granaryStore", poolKey: "byKindTier" },
    };
  } else if (kind === "cropGrowth") {
    inputRule = {
      kind: "adjacentDistributors",
      range: 1,
      tag: "distributor",
      store: "inv",
      includeOccupants: true,
    };
  }

  let displayName = getProcessDisplayName(process, recipeDef);
  if (kind === "cropGrowth" && cropDef?.name) {
    displayName = `${cropDef.name} - Growing`;
  }

  const routingSlots = {
    inputs: buildInputSlotsForProcess(kind, { inputRule }),
    outputs: buildOutputSlotsForProcess(kind, { outputRule }),
  };

  if (kind === "cropGrowth") {
    const targetId = resolveTargetOwnerId(target);
    const poolEndpoint =
      targetId != null
        ? buildPoolEndpointId("env", targetId, "growth", "maturedPool")
        : null;
    if (poolEndpoint && routingSlots.outputs.length > 0) {
      const slot = routingSlots.outputs[0];
      slot.candidateRule = { kind: "fixed", endpointId: poolEndpoint };
      slot.default = { ordered: [poolEndpoint] };
    }
  }

  const supportsDropslot =
    kind === "build" || isRecipe;

  return {
    processKind: kind,
    displayName,
    transform,
    routingSlots,
    supportsDropslot,
  };
}

function ensureRoutingSlotState(container, slotId, orderedDefaults) {
  if (!container[slotId] || typeof container[slotId] !== "object") {
    container[slotId] = { ordered: [], enabled: {} };
  }
  const slotState = container[slotId];
  if (!Array.isArray(slotState.ordered)) slotState.ordered = [];
  if (!slotState.enabled || typeof slotState.enabled !== "object") {
    slotState.enabled = {};
  }

  if (Array.isArray(orderedDefaults) && orderedDefaults.length > 0) {
    if (slotState.ordered.length === 0) {
      slotState.ordered = orderedDefaults.slice();
    }
    for (const endpointId of orderedDefaults) {
      if (slotState.enabled[endpointId] === undefined) {
        slotState.enabled[endpointId] = true;
      }
    }
  }

  return slotState;
}

export function ensureProcessRoutingState(process, processDef, context) {
  if (!process || !processDef) return null;
  if (!process.routing || typeof process.routing !== "object") {
    process.routing = { inputs: {}, outputs: {} };
  }
  if (!process.routing.inputs || typeof process.routing.inputs !== "object") {
    process.routing.inputs = {};
  }
  if (!process.routing.outputs || typeof process.routing.outputs !== "object") {
    process.routing.outputs = {};
  }

  const dropEndpointId = processDef.supportsDropslot
    ? `${DROP_ENDPOINT_PREFIX}${process.id}`
    : null;

  for (const slot of processDef.routingSlots?.inputs || []) {
    const defaultsRaw = Array.isArray(slot?.default?.ordered) ? slot.default.ordered : [];
    const defaults = defaultsRaw
      .map((endpointId) => resolveFixedEndpointId(endpointId, process, context) ?? endpointId)
      .filter(Boolean);
    const slotState = ensureRoutingSlotState(process.routing.inputs, slot.slotId, defaults);
    if (dropEndpointId && !slotState.ordered.includes(dropEndpointId)) {
      slotState.ordered.unshift(dropEndpointId);
    }
    if (dropEndpointId) {
      slotState.enabled[dropEndpointId] = true;
    }
  }

  for (const slot of processDef.routingSlots?.outputs || []) {
    const defaultsRaw = Array.isArray(slot?.default?.ordered) ? slot.default.ordered : [];
    const defaults = defaultsRaw
      .map((endpointId) => resolveFixedEndpointId(endpointId, process, context) ?? endpointId)
      .filter(Boolean);
    ensureRoutingSlotState(process.routing.outputs, slot.slotId, defaults);
  }

  return process.routing;
}

function resolveOwnerKind(state, ownerId) {
  if (!state || ownerId == null) return null;
  const hubAnchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  for (const anchor of hubAnchors) {
    if (!anchor) continue;
    if (String(anchor.instanceId) === String(ownerId)) return "hub";
  }
  const tileAnchors = Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
  for (const anchor of tileAnchors) {
    if (!anchor) continue;
    if (String(anchor.instanceId) === String(ownerId)) return "env";
  }
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  for (const ch of chars) {
    if (!ch) continue;
    if (String(ch.id) === String(ownerId)) return "pawn";
  }
  return null;
}

function resolveOwnerInvEndpoint(state, ownerId) {
  if (ownerId == null) return null;
  const kind = resolveOwnerKind(state, ownerId);
  if (kind === "hub") return `inv:hub:${ownerId}`;
  if (kind === "pawn") return `inv:pawn:${ownerId}`;
  if (kind === "env") return null;
  return `inv:${ownerId}`;
}

function resolveOwnerSysEndpoint(state, ownerId) {
  if (ownerId == null) return null;
  const kind = resolveOwnerKind(state, ownerId);
  if (kind === "hub") return `sys:hub:${ownerId}`;
  if (kind === "pawn") return `sys:pawn:${ownerId}`;
  if (kind === "env") return null;
  return null;
}

function resolveTargetOwnerId(target) {
  if (!target) return null;
  if (target.instanceId != null) return target.instanceId;
  if (target.id != null) return target.id;
  return null;
}

function getAnchorInfo(state, target) {
  if (!state || !target) return null;
  const col = Number.isFinite(target.col) ? Math.floor(target.col) : null;
  const span =
    Number.isFinite(target.span) && target.span > 0 ? Math.floor(target.span) : 1;
  if (col == null) return null;
  const hubAnchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  for (let i = 0; i < hubAnchors.length; i++) {
    if (hubAnchors[i] === target) {
      return { kind: "hub", col, span, index: i };
    }
  }

  const tileAnchors = Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
  for (let i = 0; i < tileAnchors.length; i++) {
    if (tileAnchors[i] === target) {
      return { kind: "env", col, span, index: i };
    }
  }

  return null;
}

function spanDistance(aCol, aSpan, bCol, bSpan) {
  const aStart = aCol;
  const aEnd = aCol + Math.max(1, aSpan) - 1;
  const bStart = bCol;
  const bEnd = bCol + Math.max(1, bSpan) - 1;
  if (bStart > aEnd) return bStart - aEnd;
  if (aStart > bEnd) return aStart - bEnd;
  return 0;
}

function sortCandidatesByDistance(candidates) {
  const ordered = candidates.slice();
  ordered.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.anchorIndex !== b.anchorIndex) return a.anchorIndex - b.anchorIndex;
    return (a.instanceId ?? 0) - (b.instanceId ?? 0);
  });
  return ordered;
}

function resolveDistributorRange(anchor, baseRange) {
  const base = Number.isFinite(baseRange) ? Math.max(0, Math.floor(baseRange)) : 0;
  const def = hubSystemDefs?.distribution;
  const tier =
    anchor?.systemTiers?.distribution ||
    def?.defaultTier ||
    "bronze";
  const raw = def?.rangeByTier?.[tier];
  let tierRange = null;
  if (raw === "global") {
    tierRange = Number.POSITIVE_INFINITY;
  } else if (Number.isFinite(raw)) {
    tierRange = Math.max(0, Math.floor(raw));
  } else if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      tierRange = Math.max(0, Math.floor(parsed));
    }
  }
  if (tierRange == null) tierRange = base;
  return Math.max(base, tierRange);
}

function getAnchorsForKind(state, kind) {
  if (kind === "hub") {
    return Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  }
  return Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
}

function buildPoolEndpointId(ownerKind, ownerId, systemId, poolKey) {
  if (!ownerKind || ownerId == null || !systemId || !poolKey) return null;
  return `${POOL_ENDPOINT_PREFIX}${ownerKind}:${ownerId}:${systemId}:${poolKey}`;
}

function buildEndpointIdForStore(kind, store, target, systemId, poolKey) {
  const instanceId = target?.instanceId;
  if (instanceId == null) return null;
  if (store === "sys") {
    if (kind === "hub") return `sys:hub:${instanceId}`;
    return null;
  }
  if (store === "pool") {
    if (kind === "hub" || kind === "env") {
      return buildPoolEndpointId(kind, instanceId, systemId, poolKey);
    }
    return null;
  }
  return kind === "hub" ? `inv:hub:${instanceId}` : `inv:${instanceId}`;
}

function listOccupyingPawnEndpoints(state, anchorInfo) {
  if (!state || !anchorInfo) return [];
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  const start = anchorInfo.col;
  const end = anchorInfo.col + Math.max(1, anchorInfo.span) - 1;
  const occupants = [];

  for (const ch of chars) {
    if (!ch || ch.id == null) continue;
    if (anchorInfo.kind === "hub") {
      if (Number.isFinite(ch.envCol)) continue;
      const c = Number.isFinite(ch.hubCol) ? Math.floor(ch.hubCol) : null;
      if (c == null || c < start || c > end) continue;
    } else {
      if (!Number.isFinite(ch.envCol)) continue;
      const c = Math.floor(ch.envCol);
      if (c < start || c > end) continue;
    }
    occupants.push(ch.id);
  }

  occupants.sort((a, b) => {
    const aNum = Number.isFinite(a) ? a : Number(a);
    const bNum = Number.isFinite(b) ? b : Number(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) {
      return aNum - bNum;
    }
    return String(a).localeCompare(String(b));
  });

  return occupants.map((id) => `inv:pawn:${id}`);
}

function appendUnique(list, additions) {
  const out = list.slice();
  for (const id of additions || []) {
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function listCandidateEndpoints(state, process, slotDef, target, context) {
  if (!slotDef || slotDef.locked === true) {
    if (slotDef?.candidateRule?.kind === "fixed") {
      const id = resolveFixedEndpointId(slotDef.candidateRule.endpointId, process, context);
      return id ? [id] : [];
    }
    return [];
  }
  const rule = slotDef.candidateRule || null;
  if (!rule || typeof rule !== "object") return [];

  if (rule.kind === "fixed") {
    const id = resolveFixedEndpointId(rule.endpointId, process, context);
    return id ? [id] : [];
  }

  if (rule.kind === "selfInv") {
    const ownerId =
      resolveTargetOwnerId(target) ?? process?.ownerId ?? null;
    const endpointId = resolveOwnerInvEndpoint(state, ownerId);
    return endpointId ? [endpointId] : [];
  }

  if (rule.kind === "selfSys") {
    const ownerId =
      resolveTargetOwnerId(target) ?? process?.ownerId ?? null;
    const endpointId = resolveOwnerSysEndpoint(state, ownerId);
    return endpointId ? [endpointId] : [];
  }

  if (rule.kind === "selfPool") {
    const ownerId =
      resolveTargetOwnerId(target) ?? process?.ownerId ?? null;
    const ownerKind = resolveOwnerKind(state, ownerId);
    const systemId = normalizeString(rule.systemId || rule.system);
    const poolKey = normalizeString(rule.poolKey);
    const endpointId =
      ownerKind && ownerId != null
        ? buildPoolEndpointId(ownerKind, ownerId, systemId, poolKey)
        : null;
    return endpointId ? [endpointId] : [];
  }

  if (rule.kind === "ownerInv") {
    const ownerId =
      process?.ownerId ?? resolveTargetOwnerId(target) ?? null;
    const endpointId = resolveOwnerInvEndpoint(state, ownerId);
    return endpointId ? [endpointId] : [];
  }

  if (rule.kind === "tileOccupantsSpawn") {
    return ["spawn:tileOccupants"];
  }

  const includeSelfInv = rule.includeSelfInv === true;
  const includeOccupants = rule.includeOccupants === true;
  const ownerId =
    resolveTargetOwnerId(target) ?? process?.ownerId ?? null;
  const selfEndpoint = includeSelfInv
    ? resolveOwnerInvEndpoint(state, ownerId)
    : null;

  const anchorInfo = getAnchorInfo(state, target);
  const occupantEndpoints =
    includeOccupants && anchorInfo ? listOccupyingPawnEndpoints(state, anchorInfo) : [];

  if (rule.kind !== "adjacentDistributors" && rule.kind !== "adjacentStructures") {
    const base = [];
    if (selfEndpoint) base.push(selfEndpoint);
    return appendUnique(base, occupantEndpoints);
  }

  const range = Math.max(0, safeFloor(rule.range, 0));
  const candidates = [];
  const poolCandidates = [];
  const poolSpec =
    rule.includePool && typeof rule.includePool === "object"
      ? rule.includePool
      : null;
  const poolSystemId = normalizeString(poolSpec?.systemId || poolSpec?.system);
  const poolKey = normalizeString(poolSpec?.poolKey);
  if (anchorInfo && range > 0) {
    const anchors = getAnchorsForKind(state, anchorInfo.kind);
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      if (!anchor) continue;
      const tags = Array.isArray(anchor.tags) ? anchor.tags : [];
      if (rule.kind === "adjacentDistributors") {
        if (!tags.includes(rule.tag || "distributor")) continue;
      } else if (rule.kind === "adjacentStructures") {
        if (rule.tag && !tags.includes(rule.tag)) continue;
      } else {
        continue;
      }
      const col = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : 0;
      const span = Number.isFinite(anchor.span) ? Math.floor(anchor.span) : 1;
      const dist = spanDistance(anchorInfo.col, anchorInfo.span, col, span);
      const effectiveRange =
        rule.kind === "adjacentDistributors"
          ? resolveDistributorRange(anchor, range)
          : range;
      if (dist > effectiveRange) continue;
      if (poolSystemId && poolKey) {
        const poolState = anchor?.systemState?.[poolSystemId]?.[poolKey];
        if (poolState && typeof poolState === "object") {
          const poolEndpointId = buildPoolEndpointId(
            anchorInfo.kind,
            anchor.instanceId,
            poolSystemId,
            poolKey
          );
          if (poolEndpointId) {
            poolCandidates.push({
              endpointId: poolEndpointId,
              dist,
              anchorIndex: i,
              instanceId: anchor.instanceId ?? 0,
            });
          }
        }
      }
      const endpointId = buildEndpointIdForStore(
        anchorInfo.kind,
        rule.store,
        anchor,
        normalizeString(rule.systemId || rule.system),
        normalizeString(rule.poolKey)
      );
      if (!endpointId) continue;
      candidates.push({
        endpointId,
        dist,
        anchorIndex: i,
        instanceId: anchor.instanceId ?? 0,
      });
    }
  }

  let orderedPools = sortCandidatesByDistance(poolCandidates).map((c) => c.endpointId);
  let ordered = sortCandidatesByDistance(candidates).map((c) => c.endpointId);
  let result = [];
  result = appendUnique(result, orderedPools);
  if (selfEndpoint) result = appendUnique(result, [selfEndpoint]);
  result = appendUnique(result, occupantEndpoints);
  result = appendUnique(result, ordered);
  return result;
}

export function resolveFixedEndpointId(endpointId, process, context) {
  if (!endpointId || typeof endpointId !== "string") return null;
  if (endpointId === "sys:pawn:leader") {
    const leaderId = process?.leaderId ?? context?.leaderId ?? null;
    if (leaderId == null) return null;
    return `sys:pawn:${leaderId}`;
  }
  if (endpointId === "inv:process") {
    return process?.id ? `${DROP_ENDPOINT_PREFIX}${process.id}` : null;
  }
  return endpointId;
}

function parsePoolEndpointId(endpointId) {
  if (!endpointId || typeof endpointId !== "string") return null;
  if (!endpointId.startsWith(POOL_ENDPOINT_PREFIX)) return null;
  const raw = endpointId.slice(POOL_ENDPOINT_PREFIX.length);
  const parts = raw.split(":");
  if (parts.length < 4) return null;
  const [ownerKind, ownerId, systemId, poolKey] = parts;
  if (!ownerKind || !ownerId || !systemId || !poolKey) return null;
  return { ownerKind, ownerId, systemId, poolKey };
}

function resolvePoolOwner(state, ownerKind, ownerId) {
  if (!state || ownerId == null || !ownerKind) return null;
  if (ownerKind === "hub") {
    const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(ownerId)) return anchor;
    }
  }
  if (ownerKind === "env") {
    const anchors = Array.isArray(state?.board?.layers?.tile?.anchors)
      ? state.board.layers.tile.anchors
      : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(ownerId)) return anchor;
    }
  }
  if (ownerKind === "pawn") {
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    for (const ch of chars) {
      if (!ch) continue;
      if (String(ch.id) === String(ownerId)) return ch;
    }
  }
  return null;
}

function resolvePoolState(owner, systemId, poolKey) {
  if (!owner || !systemId || !poolKey) return null;
  const systemState = owner.systemState?.[systemId];
  if (!systemState || typeof systemState !== "object") return null;
  const pool = systemState[poolKey];
  if (!pool || typeof pool !== "object") return null;
  return pool;
}

export function resolveEndpointTarget(state, endpointId) {
  if (!endpointId || typeof endpointId !== "string") return null;
  if (endpointId === "res:state") {
    return { kind: "resource", target: state?.resources ?? null };
  }
  if (endpointId === "spawn:tileOccupants") {
    return { kind: "spawn" };
  }
  if (endpointId.startsWith("inv:process:")) {
    const inv = state?.ownerInventories?.[endpointId] ?? null;
    return inv ? { kind: "inventory", target: inv, ownerId: endpointId } : null;
  }
  if (endpointId.startsWith("inv:hub:")) {
    const ownerId = endpointId.slice("inv:hub:".length);
    const inv = state?.ownerInventories?.[ownerId] ?? null;
    return inv ? { kind: "inventory", target: inv, ownerId } : null;
  }
  if (endpointId.startsWith("inv:pawn:")) {
    const ownerId = endpointId.slice("inv:pawn:".length);
    const inv = state?.ownerInventories?.[ownerId] ?? null;
    return inv ? { kind: "inventory", target: inv, ownerId } : null;
  }
  if (endpointId.startsWith("inv:")) {
    const ownerId = endpointId.slice("inv:".length);
    const inv = state?.ownerInventories?.[ownerId] ?? null;
    return inv ? { kind: "inventory", target: inv, ownerId } : null;
  }
  if (endpointId.startsWith("sys:hub:")) {
    const id = endpointId.slice("sys:hub:".length);
    const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
    for (const anchor of anchors) {
      if (anchor?.instanceId != null && String(anchor.instanceId) === String(id)) {
        return { kind: "system", target: anchor };
      }
    }
    return null;
  }
  if (endpointId.startsWith("sys:pawn:")) {
    const id = endpointId.slice("sys:pawn:".length);
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    for (const ch of chars) {
      if (ch?.id != null && String(ch.id) === String(id)) {
        return { kind: "system", target: ch };
      }
    }
    return null;
  }
  if (endpointId.startsWith(POOL_ENDPOINT_PREFIX)) {
    const parsed = parsePoolEndpointId(endpointId);
    if (!parsed) return null;
    const owner = resolvePoolOwner(state, parsed.ownerKind, parsed.ownerId);
    if (!owner) return null;
    const pool = resolvePoolState(owner, parsed.systemId, parsed.poolKey);
    if (!pool) return null;
    let itemId = null;
    if (parsed.systemId === "growth" && parsed.poolKey === "maturedPool") {
      const cropId = owner?.systemState?.growth?.selectedCropId;
      if (typeof cropId === "string" && cropId.length > 0) {
        itemId = cropId;
      }
    }
    return {
      kind: "pool",
      target: pool,
      owner,
      ownerKind: parsed.ownerKind,
      ownerId: parsed.ownerId,
      systemId: parsed.systemId,
      poolKey: parsed.poolKey,
      itemId,
    };
  }
  return null;
}

function sortItemsForConsumption(items) {
  return items.sort((a, b) => {
    const tierA = a?.tier ?? "bronze";
    const tierB = b?.tier ?? "bronze";
    const rankA = getTierRank(tierA, TIER_ASC);
    const rankB = getTierRank(tierB, TIER_ASC);
    if (rankA !== rankB) return rankA - rankB;
    return (a?.id ?? 0) - (b?.id ?? 0);
  });
}

export function canConsumeRequirementUnit(inv, requirement) {
  if (!inv || !Array.isArray(inv.items)) return false;
  if (requirement.kind === "item" && requirement.itemId) {
    return inv.items.some(
      (it) => it && it.kind === requirement.itemId && Math.floor(it.quantity ?? 0) > 0
    );
  }
  if (requirement.kind === "tag" && requirement.tag) {
    return inv.items.some((it) => {
      if (!it || !Array.isArray(it.tags)) return false;
      if (!it.tags.includes(requirement.tag)) return false;
      return Math.floor(it.quantity ?? 0) > 0;
    });
  }
  return false;
}

export function consumeRequirementUnit(inv, requirement) {
  if (!inv || !Array.isArray(inv.items)) return null;
  if (requirement.kind === "item" && requirement.itemId) {
    const candidates = inv.items.filter(
      (it) => it && it.kind === requirement.itemId && Math.floor(it.quantity ?? 0) > 0
    );
    if (!candidates.length) return null;
    sortItemsForConsumption(candidates);
    const item = candidates[0];
    item.quantity = Math.max(0, Math.floor(item.quantity ?? 0) - 1);
    const tier = item.tier ?? itemDefs?.[item.kind]?.defaultTier ?? "bronze";
    if (item.quantity <= 0) {
      Inventory.removeItem(inv, item.id);
    }
    bumpInvVersion(inv);
    return { kind: item.kind, tier };
  }
  if (requirement.kind === "tag" && requirement.tag) {
    const candidates = inv.items.filter((it) => {
      if (!it || !Array.isArray(it.tags)) return false;
      if (!it.tags.includes(requirement.tag)) return false;
      return Math.floor(it.quantity ?? 0) > 0;
    });
    if (!candidates.length) return null;
    sortItemsForConsumption(candidates);
    const item = candidates[0];
    item.quantity = Math.max(0, Math.floor(item.quantity ?? 0) - 1);
    const tier = item.tier ?? itemDefs?.[item.kind]?.defaultTier ?? "bronze";
    if (item.quantity <= 0) {
      Inventory.removeItem(inv, item.id);
    }
    bumpInvVersion(inv);
    return { kind: item.kind, tier };
  }
  return null;
}

export function addItemToInventory(state, inv, itemId, qty, tier = null) {
  if (!inv || !Array.isArray(inv.items)) return 0;
  const def = itemDefs[itemId] || null;
  const maxStack = getItemMaxStack({ kind: itemId, tier });
  const dummy = {
    kind: itemId,
    tier: tier ?? def?.defaultTier ?? "bronze",
    seasonsToExpire: null,
    tags: [],
    systemTiers: {},
    systemState: {},
  };
  initializeItemFromDef(state, dummy, { reset: true });
  dummy.tier = tier ?? dummy.tier;

  let remaining = Math.max(0, safeFloor(qty, 0));
  let added = 0;

  for (const stack of inv.items) {
    if (!canStackItems(stack, dummy)) continue;
    const current = Math.floor(stack.quantity ?? 0);
    const space = Math.max(0, maxStack - current);
    if (space <= 0) continue;
    const take = Math.min(space, remaining);
    stack.quantity = current + take;
    mergeItemSystemStateForStacking(stack, dummy, current, take);
    remaining -= take;
    added += take;
    if (remaining <= 0) break;
  }

  while (remaining > 0) {
    const take = Math.min(remaining, maxStack);
    const newItem = Inventory.addNewItem(state, inv, {
      kind: itemId,
      quantity: take,
      width: def?.defaultWidth ?? 1,
      height: def?.defaultHeight ?? 1,
      tier: dummy.tier,
    });
    if (!newItem) break;
    remaining -= take;
    added += take;
  }

  if (added > 0) bumpInvVersion(inv);
  return added;
}

export function isDropEndpoint(endpointId) {
  return typeof endpointId === "string" && endpointId.startsWith(DROP_ENDPOINT_PREFIX);
}

export function getDropEndpointId(processId) {
  if (!processId) return null;
  return `${DROP_ENDPOINT_PREFIX}${processId}`;
}
