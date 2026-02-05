// process-framework.js
// Deterministic process defs + routing helpers (model-only).

import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
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
    base.push({
      slotId: DEFAULT_PROCESS_INPUT_SLOT,
      label: "Materials",
      locked: false,
      mode: "consume",
      candidateRule: { kind: "adjacentStructures", range: 1, store: "inv" },
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

  let inputRule = null;
  let outputRule = null;

  const routingSlots = {
    inputs: buildInputSlotsForProcess(kind, { inputRule }),
    outputs: buildOutputSlotsForProcess(kind, { outputRule }),
  };

  const supportsDropslot =
    kind === "build" || isRecipe;

  return {
    processKind: kind,
    displayName: getProcessDisplayName(process, recipeDef),
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
  return `inv:${ownerId}`;
}

function resolveOwnerSysEndpoint(state, ownerId) {
  if (ownerId == null) return null;
  const kind = resolveOwnerKind(state, ownerId);
  if (kind === "hub") return `sys:hub:${ownerId}`;
  if (kind === "pawn") return `sys:pawn:${ownerId}`;
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

function getAnchorsForKind(state, kind) {
  if (kind === "hub") {
    return Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  }
  return Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
}

function buildEndpointIdForStore(kind, store, target) {
  const instanceId = target?.instanceId;
  if (instanceId == null) return null;
  if (store === "sys") {
    if (kind === "hub") return `sys:hub:${instanceId}`;
    return null;
  }
  return kind === "hub" ? `inv:hub:${instanceId}` : `inv:${instanceId}`;
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
    const ownerId = process?.ownerId ?? target?.instanceId ?? null;
    const endpointId = resolveOwnerInvEndpoint(state, ownerId);
    return endpointId ? [endpointId] : [];
  }

  if (rule.kind === "selfSys") {
    const ownerId = process?.ownerId ?? target?.instanceId ?? null;
    const endpointId = resolveOwnerSysEndpoint(state, ownerId);
    return endpointId ? [endpointId] : [];
  }

  if (rule.kind === "ownerInv") {
    const ownerId = process?.ownerId ?? target?.instanceId ?? null;
    const endpointId = resolveOwnerInvEndpoint(state, ownerId);
    return endpointId ? [endpointId] : [];
  }

  if (rule.kind === "tileOccupantsSpawn") {
    return ["spawn:tileOccupants"];
  }

  const anchorInfo = getAnchorInfo(state, target);
  if (!anchorInfo) return [];

  const range = Math.max(0, safeFloor(rule.range, 0));
  if (range <= 0) return [];

  const anchors = getAnchorsForKind(state, anchorInfo.kind);
  const candidates = [];
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
    if (dist > range) continue;
    const endpointId = buildEndpointIdForStore(anchorInfo.kind, rule.store, anchor);
    if (!endpointId) continue;
    candidates.push({
      endpointId,
      dist,
      anchorIndex: i,
      instanceId: anchor.instanceId ?? 0,
    });
  }

  return sortCandidatesByDistance(candidates).map((c) => c.endpointId);
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
