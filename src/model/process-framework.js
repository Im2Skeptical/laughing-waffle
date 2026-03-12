// process-framework.js
// Deterministic process defs + routing helpers (model-only).

import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { TIER_ASC, getTierRank } from "./effects/core/tiers.js";
import {
  ensureRecipePriorityState,
  getEnabledRecipeIds,
  getTopEnabledRecipeId,
  isRecipeSystem,
} from "./recipe-priority.js";
import {
  findEquippedPoolProviderEntry,
  ownerHasEquippedPoolProvider,
  poolProviderRequiresEquipped,
} from "./item-def-rules.js";
import {
  Inventory,
  canStackItems,
  getItemMaxStack,
  initializeItemFromDef,
  mergeItemSystemStateForStacking,
} from "./inventory-model.js";
import { bumpInvVersion } from "./effects/core/inventory-version.js";
import {
  PROCESS_DROPBOX_OWNER_PREFIX,
  buildProcessDropboxOwnerId,
} from "./owner-id-protocol.js";

const DEFAULT_PROCESS_INPUT_SLOT = "materials";
const DEFAULT_PROCESS_OUTPUT_SLOT = "output";

const DROP_ENDPOINT_PREFIX = PROCESS_DROPBOX_OWNER_PREFIX;
const DROP_ENDPOINT_SENTINEL = DROP_ENDPOINT_PREFIX.slice(0, -1);
const POOL_ENDPOINT_PREFIX = "sys:pool:";

function normalizeString(value) {
  return typeof value === "string" && value.length ? value : null;
}

function safeFloor(value, fallback = 0) {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function cloneSerializable(value) {
  if (value == null) return null;
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (_) {
    // ignore and fall through
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeRequirementEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const kind = normalizeString(entry.kind);
  const itemId = normalizeString(entry.itemId);
  const tag = normalizeString(entry.tag || entry.itemTag);
  const resource = normalizeString(entry.resource);
  const requirementType = normalizeString(entry.requirementType);
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
    requirementType,
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
    const fromLedger = entry.fromLedger === true || entry.useLedger === true;
    if (!system || !poolKey) return null;
    if (!fromLedger && (!itemId || qty <= 0)) return null;
    return {
      kind: "pool",
      system,
      poolKey,
      itemId,
      qty,
      tier,
      slotId,
      fromLedger,
    };
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
    const curveMultiplier =
      Number.isFinite(entry.curveMultiplier) && entry.curveMultiplier > 0
        ? entry.curveMultiplier
        : 1;
    return { kind: "prestige", qty, slotId, curveMultiplier };
  }
  const itemId =
    kind && kind !== "item" ? kind : normalizeString(entry.itemId);
  const qty = Math.max(0, safeFloor(entry.qty ?? entry.amount, 1));
  if (!itemId || qty <= 0) return null;
  const tier = normalizeString(entry.tier);
  const itemState =
    entry.itemState && typeof entry.itemState === "object"
      ? cloneSerializable(entry.itemState)
      : null;
  return { kind: "item", itemId, qty, tier, slotId, itemState };
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
      requirementType: "material",
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
      requirementType: "tool",
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
    const itemState =
      out.itemState && typeof out.itemState === "object"
        ? cloneSerializable(out.itemState)
        : null;
    outs.push({
      kind: "item",
      itemId,
      qty,
      itemState,
    });
  }
  return outs;
}

function getProcessDisplayName(process, recipeDef) {
  if (recipeDef?.name) return recipeDef.name;
  const kind = normalizeString(process?.type) || "Process";
  if (kind === "depositItems") return "Deposit";
  if (kind === "residentConsume") return "Residents";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function getRecipeIdForSystem(target, systemId, state = null) {
  if (!target || !systemId) return null;
  if (!isRecipeSystem(systemId)) return null;
  const systemState = target?.systemState?.[systemId];
  const priority = ensureRecipePriorityState(systemState, {
    systemId,
    state,
    includeLocked: false,
  });
  const topEnabled = getTopEnabledRecipeId(priority);
  if (topEnabled) return topEnabled;
  const selected = systemState?.selectedRecipeId;
  if (selected && getEnabledRecipeIds(priority).includes(selected)) {
    return selected;
  }
  return null;
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
  if (kind === "depositItems") {
    base.push({
      slotId: "items",
      label: "Items",
      locked: false,
      mode: "consume",
      candidateRule: { kind: "ownerInv" },
      default: { ordered: [] },
    });
    return base;
  }
  if (kind === "residentConsume") {
    base.push({
      slotId: "food",
      label: "Food",
      locked: false,
      mode: "consume",
      candidateRule: opts.inputRule || {
        kind: "adjacentDistributors",
        range: 1,
        tag: "distributor",
        store: "inv",
        includeSelfInv: true,
        includeOccupants: true,
      },
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
  if (kind === "residentConsume") {
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

function buildOwnerInvEndpoint(ownerKind, ownerId) {
  if (ownerId == null) return null;
  if (ownerKind === "hub") return `inv:hub:${ownerId}`;
  if (ownerKind === "pawn") return `inv:pawn:${ownerId}`;
  return `inv:${ownerId}`;
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

  if (kind === "depositItems") {
    if (!transform.outputs.length) {
      transform.outputs = [];
    }
  }
  if (kind === "residentConsume") {
    if (!transform.requirements.length) {
      const amount = Math.max(1, safeFloor(process?.inputAmount, 1));
      transform.requirements = [
        {
          kind: "tag",
          tag: "edible",
          amount,
          progress: 0,
          consume: true,
          slotId: "food",
        },
      ];
    }
    transform.outputs = [];
  }
  if (kind === "cropGrowth" && cropDef) {
    const skipAutoSeedRequirement =
      process?.skipAutoCropSeedRequirement === true;
    const seedItem = normalizeString(cropDef.cropId || process?.defId);
    const seedAmount = Math.max(0, safeFloor(process?.inputAmount ?? 0, 0));
    if (
      !skipAutoSeedRequirement &&
      seedItem &&
      seedAmount > 0 &&
      transform.requirements.length === 0
    ) {
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
      includePool: {
        ownerKind: "pawn",
        source: "occupants",
        systemId: "storage",
        poolKey: "byKindTier",
      },
    };
  } else if (recipeDef?.kind === "cook" || recipeDef?.kind === "craft") {
    inputRule = {
      kind: "adjacentDistributors",
      range: 1,
      tag: "distributor",
      store: "inv",
      includeSelfInv: true,
      includeOccupants: true,
      includePool: [
        { systemId: "granaryStore", poolKey: "byKindTier" },
        { systemId: "storehouseStore", poolKey: "byKindTier" },
        {
          ownerKind: "pawn",
          source: "occupants",
          systemId: "storage",
          poolKey: "byKindTier",
        },
      ],
    };
    outputRule = {
      kind: "adjacentDistributors",
      range: 1,
      tag: "distributor",
      store: "inv",
      includeSelfInv: true,
      includeOccupants: true,
    };
  } else if (kind === "cropGrowth") {
    inputRule = {
      kind: "adjacentDistributors",
      range: 1,
      tag: "distributor",
      store: "inv",
      includeOccupants: true,
      includePool: {
        ownerKind: "pawn",
        source: "occupants",
        systemId: "storage",
        poolKey: "byKindTier",
      },
    };
  } else if (kind === "residentConsume") {
    inputRule = {
      kind: "adjacentDistributors",
      range: 1,
      tag: "distributor",
      store: "inv",
      includeSelfInv: true,
      includeOccupants: true,
      includePool: [
        { systemId: "granaryStore", poolKey: "byKindTier" },
        { systemId: "storehouseStore", poolKey: "byKindTier" },
      ],
    };
  }

  let displayName = getProcessDisplayName(process, recipeDef);
  if (kind === "cropGrowth" && cropDef?.name) {
    displayName = `${cropDef.name} - Growing`;
  }
  const depositDef =
    target?.defId && hubStructureDefs?.[target.defId]
      ? hubStructureDefs[target.defId].deposit
      : null;
  const instantDropboxLoad =
    kind === "depositItems" && depositDef?.instantDropboxLoad === true;

  let routingSlots = null;
  if (kind === "depositItems") {
    const ownerId = process?.ownerId ?? null;
    const ownerKind = normalizeString(process?.ownerKind) || "pawn";
    const ownerEndpoint = buildOwnerInvEndpoint(ownerKind, ownerId);
    const inputSlots = [
      {
        slotId: "items",
        label: "Items",
        locked: true,
        mode: "consume",
        candidateRule: { kind: "fixed", endpointId: ownerEndpoint },
        default: { ordered: ownerEndpoint ? [ownerEndpoint] : [] },
      },
    ];
    const outputSlots = [];
    const outputs = Array.isArray(transform.outputs) ? transform.outputs : [];
    for (const out of outputs) {
      if (!out || typeof out !== "object") continue;
      if (out.kind === "prestige") {
        outputSlots.push({
          slotId: out.slotId || "prestige",
          label: "Prestige",
          locked: true,
          mode: "award",
          candidateRule: { kind: "fixed", endpointId: "sys:pawn:leader" },
          default: { ordered: ["sys:pawn:leader"] },
        });
        continue;
      }
      if (out.kind === "pool") {
        const targetId = resolveTargetOwnerId(target);
        const poolEndpoint =
          targetId != null && out.system && out.poolKey
            ? buildPoolEndpointId("hub", targetId, out.system, out.poolKey)
            : null;
        if (!poolEndpoint) continue;
        outputSlots.push({
          slotId: out.slotId || "pool",
          label: "Deposit Pool",
          locked: true,
          mode: "deposit",
          candidateRule: { kind: "fixed", endpointId: poolEndpoint },
          default: { ordered: [poolEndpoint] },
        });
      }
    }
    routingSlots = { inputs: inputSlots, outputs: outputSlots };
  } else {
    routingSlots = {
      inputs: buildInputSlotsForProcess(kind, { inputRule }),
      outputs: buildOutputSlotsForProcess(kind, { outputRule }),
    };
  }

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

  const supportsDropslot = kind === "build" || isRecipe || instantDropboxLoad;

  return {
    processKind: kind,
    displayName,
    transform,
    routingSlots,
    supportsDropslot,
    instantDropboxLoad,
  };
}

export function getTemplateProcessForSystem(target, systemId, context = {}) {
  if (!target || !systemId) return null;
  const targetId = resolveTargetOwnerId(target);
  const base = {
    id: `template:${systemId}:${targetId ?? "0"}`,
    type: systemId,
    mode: "time",
    durationSec: 1,
    progress: 0,
    ownerId: targetId ?? null,
  };

  if (systemId === "build") {
    return { ...base, type: "build", mode: "work", durationSec: 1 };
  }

  if (systemId === "growth") {
    const cropId = target?.systemState?.growth?.selectedCropId ?? null;
    return {
      ...base,
      type: "cropGrowth",
      mode: "time",
      durationSec: 1,
      defId: cropId || undefined,
      cropId: cropId || undefined,
      inputAmount: 1,
      completionPolicy: "cropGrowth",
    };
  }

  if (systemId === "cook" || systemId === "craft") {
    const recipeId = getRecipeIdForSystem(target, systemId, context?.state ?? null);
    if (recipeId) {
      const recipe = recipeDefs?.[recipeId] || null;
      const durationSec = Number.isFinite(recipe?.durationSec)
        ? Math.max(1, Math.floor(recipe.durationSec))
        : 1;
      return { ...base, type: recipeId, mode: "work", durationSec };
    }
    return { ...base, type: `${systemId}-idle`, mode: "work", durationSec: 1 };
  }

  if (systemId === "deposit") {
    return {
      ...base,
      type: "depositItems",
      mode: "time",
      durationSec: 1,
      ownerKind: "pawn",
      ownerId: context?.ownerId ?? base.ownerId,
    };
  }

  if (systemId === "residents") {
    return {
      ...base,
      type: "residentConsume",
      mode: "time",
      durationSec: 1,
      inputAmount: 1,
    };
  }

  const processes = Array.isArray(target?.systemState?.[systemId]?.processes)
    ? target.systemState[systemId].processes
    : [];
  const existing = processes.find((proc) => proc && proc.type);
  if (existing) {
    return {
      ...base,
      type: existing.type,
      mode: existing.mode === "work" ? "work" : "time",
      durationSec: Math.max(1, Math.floor(existing.durationSec ?? 1)),
      defId: existing.defId ?? undefined,
    };
  }

  return base;
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

function cloneRoutingSlotState(slotState, opts = {}) {
  const stripDrop = opts.stripDrop === true;
  const orderedRaw = Array.isArray(slotState?.ordered) ? slotState.ordered : [];
  const ordered = orderedRaw.filter(
    (id) => typeof id === "string" && id.length && (!stripDrop || !isDropEndpoint(id))
  );
  const enabled = {};
  const enabledRaw =
    slotState?.enabled && typeof slotState.enabled === "object"
      ? slotState.enabled
      : {};
  for (const endpointId of ordered) {
    enabled[endpointId] = enabledRaw[endpointId] === false ? false : true;
  }
  for (const [endpointId, value] of Object.entries(enabledRaw)) {
    if (stripDrop && isDropEndpoint(endpointId)) continue;
    if (enabled[endpointId] !== undefined) continue;
    enabled[endpointId] = value === false ? false : true;
  }
  return { ordered, enabled };
}

function applyRoutingSlotState(slotState, nextState) {
  if (!slotState || !nextState) return false;
  let changed = false;
  const ordered = Array.isArray(nextState.ordered) ? nextState.ordered.slice() : [];
  const enabled =
    nextState.enabled && typeof nextState.enabled === "object"
      ? { ...nextState.enabled }
      : {};

  if (
    slotState.ordered?.length !== ordered.length ||
    slotState.ordered?.some((id, idx) => id !== ordered[idx])
  ) {
    slotState.ordered = ordered;
    changed = true;
  }
  if (!slotState.enabled || typeof slotState.enabled !== "object") {
    slotState.enabled = {};
  }
  for (const key of Object.keys(slotState.enabled)) {
    if (!Object.prototype.hasOwnProperty.call(enabled, key)) {
      delete slotState.enabled[key];
      changed = true;
    }
  }
  for (const [key, value] of Object.entries(enabled)) {
    if (slotState.enabled[key] !== value) {
      slotState.enabled[key] = value;
      changed = true;
    }
  }
  return changed;
}

export function ensureSystemRoutingTemplate(target, systemId, processDef) {
  if (!target || !systemId || !processDef) return null;
  if (!target.systemState || typeof target.systemState !== "object") {
    target.systemState = {};
  }
  if (!target.systemState[systemId] || typeof target.systemState[systemId] !== "object") {
    target.systemState[systemId] = {};
  }
  const systemState = target.systemState[systemId];
  if (!systemState.routingTemplate || typeof systemState.routingTemplate !== "object") {
    systemState.routingTemplate = { inputs: {}, outputs: {} };
  }
  if (!systemState.routingTemplate.inputs || typeof systemState.routingTemplate.inputs !== "object") {
    systemState.routingTemplate.inputs = {};
  }
  if (!systemState.routingTemplate.outputs || typeof systemState.routingTemplate.outputs !== "object") {
    systemState.routingTemplate.outputs = {};
  }

  for (const slot of processDef?.routingSlots?.inputs || []) {
    if (!slot || slot.locked) continue;
    const defaultsRaw = Array.isArray(slot?.default?.ordered) ? slot.default.ordered : [];
    const slotState = ensureRoutingSlotState(
      systemState.routingTemplate.inputs,
      slot.slotId,
      defaultsRaw
    );
    if (Array.isArray(slotState.ordered)) {
      slotState.ordered = slotState.ordered.filter((id) => !isDropEndpoint(id));
    }
    if (slotState.enabled && typeof slotState.enabled === "object") {
      for (const key of Object.keys(slotState.enabled)) {
        if (isDropEndpoint(key)) delete slotState.enabled[key];
      }
    }
  }

  for (const slot of processDef?.routingSlots?.outputs || []) {
    if (!slot || slot.locked) continue;
    const defaultsRaw = Array.isArray(slot?.default?.ordered) ? slot.default.ordered : [];
    ensureRoutingSlotState(
      systemState.routingTemplate.outputs,
      slot.slotId,
      defaultsRaw
    );
  }

  return systemState.routingTemplate;
}

export function syncRoutingTemplateFromProcess(process, target, systemId, processDef) {
  if (!process || !target || !systemId || !processDef) return false;
  const template = ensureSystemRoutingTemplate(target, systemId, processDef);
  if (!template) return false;
  let changed = false;

  const groups = [
    { kind: "inputs", slots: processDef.routingSlots?.inputs || [] },
    { kind: "outputs", slots: processDef.routingSlots?.outputs || [] },
  ];

  for (const group of groups) {
    for (const slot of group.slots || []) {
      if (!slot || slot.locked) continue;
      const slotState = process?.routing?.[group.kind]?.[slot.slotId];
      if (!slotState) continue;
      const nextState = cloneRoutingSlotState(slotState, { stripDrop: true });
      const templateSlot = ensureRoutingSlotState(
        template[group.kind],
        slot.slotId,
        null
      );
      if (applyRoutingSlotState(templateSlot, nextState)) changed = true;
    }
  }
  return changed;
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

  const target = context?.target ?? null;
  const systemId = context?.systemId ?? null;
  const routingTemplate =
    target && systemId ? ensureSystemRoutingTemplate(target, systemId, processDef) : null;

  for (const slot of processDef.routingSlots?.inputs || []) {
    const defaultsRaw = Array.isArray(slot?.default?.ordered) ? slot.default.ordered : [];
    const defaults = defaultsRaw
      .map((endpointId) => resolveFixedEndpointId(endpointId, process, context) ?? endpointId)
      .filter(Boolean);
    const slotState = ensureRoutingSlotState(process.routing.inputs, slot.slotId, null);
    const templateSlot = routingTemplate?.inputs?.[slot.slotId];
    if (templateSlot && slotState.ordered.length === 0) {
      applyRoutingSlotState(slotState, cloneRoutingSlotState(templateSlot, { stripDrop: true }));
    }
    if (slot.locked) {
      applyRoutingSlotState(slotState, { ordered: defaults, enabled: {} });
    } else if (slotState.ordered.length === 0 && defaults.length > 0) {
      slotState.ordered = defaults.slice();
    }
    for (const endpointId of slotState.ordered) {
      if (slotState.enabled[endpointId] === undefined) {
        slotState.enabled[endpointId] = true;
      }
    }
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
    const slotState = ensureRoutingSlotState(process.routing.outputs, slot.slotId, null);
    const templateSlot = routingTemplate?.outputs?.[slot.slotId];
    if (templateSlot && slotState.ordered.length === 0) {
      applyRoutingSlotState(slotState, cloneRoutingSlotState(templateSlot, { stripDrop: true }));
    }
    if (slot.locked) {
      applyRoutingSlotState(slotState, { ordered: defaults, enabled: {} });
    } else if (slotState.ordered.length === 0 && defaults.length > 0) {
      slotState.ordered = defaults.slice();
    }
    for (const endpointId of slotState.ordered) {
      if (slotState.enabled[endpointId] === undefined) {
        slotState.enabled[endpointId] = true;
      }
    }
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
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    if (!pawn) continue;
    if (String(pawn.id) === String(ownerId)) return "pawn";
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
    const aInstance = a.instanceId ?? 0;
    const bInstance = b.instanceId ?? 0;
    if (aInstance !== bInstance) return aInstance - bInstance;
    const aSpec = Number.isFinite(a.specIndex) ? a.specIndex : 0;
    const bSpec = Number.isFinite(b.specIndex) ? b.specIndex : 0;
    if (aSpec !== bSpec) return aSpec - bSpec;
    const aId = String(a.endpointId ?? "");
    const bId = String(b.endpointId ?? "");
    return aId.localeCompare(bId);
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

function listOccupyingPawnIds(state, anchorInfo) {
  if (!state || !anchorInfo) return [];
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const start = anchorInfo.col;
  const end = anchorInfo.col + Math.max(1, anchorInfo.span) - 1;
  const occupants = [];

  for (const pawn of pawns) {
    if (!pawn || pawn.id == null) continue;
    if (anchorInfo.kind === "hub") {
      if (Number.isFinite(pawn.envCol)) continue;
      const c = Number.isFinite(pawn.hubCol) ? Math.floor(pawn.hubCol) : null;
      if (c == null || c < start || c > end) continue;
    } else {
      if (!Number.isFinite(pawn.envCol)) continue;
      const c = Math.floor(pawn.envCol);
      if (c < start || c > end) continue;
    }
    occupants.push(pawn.id);
  }

  occupants.sort((a, b) => {
    const aNum = Number.isFinite(a) ? a : Number(a);
    const bNum = Number.isFinite(b) ? b : Number(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) {
      return aNum - bNum;
    }
    return String(a).localeCompare(String(b));
  });

  return occupants;
}

function listOccupyingPawnEndpoints(state, anchorInfo) {
  const ids = listOccupyingPawnIds(state, anchorInfo);
  return ids.map((id) => `inv:pawn:${id}`);
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
  const occupantIds =
    includeOccupants && anchorInfo ? listOccupyingPawnIds(state, anchorInfo) : [];
  const occupantEndpoints =
    occupantIds.length > 0 ? occupantIds.map((id) => `inv:pawn:${id}`) : [];

  if (rule.kind !== "adjacentDistributors" && rule.kind !== "adjacentStructures") {
    const base = [];
    if (selfEndpoint) base.push(selfEndpoint);
    return appendUnique(base, occupantEndpoints);
  }

  const range = Math.max(0, safeFloor(rule.range, 0));
  const candidates = [];
  const poolCandidates = [];
  const poolSpecsRaw = rule.includePool;
  const poolSpecs = Array.isArray(poolSpecsRaw)
    ? poolSpecsRaw
    : poolSpecsRaw && typeof poolSpecsRaw === "object"
      ? [poolSpecsRaw]
      : [];
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
      if (poolSpecs.length > 0) {
        for (let p = 0; p < poolSpecs.length; p++) {
          const spec = poolSpecs[p];
          const specOwnerKind = normalizeString(spec?.ownerKind);
          if (specOwnerKind && specOwnerKind !== anchorInfo.kind) continue;
          const poolSystemId = normalizeString(spec?.systemId || spec?.system);
          const poolKey = normalizeString(spec?.poolKey);
          if (!poolSystemId || !poolKey) continue;
          const poolState = anchor?.systemState?.[poolSystemId]?.[poolKey];
          if (!poolState || typeof poolState !== "object") continue;
          const poolEndpointId = buildPoolEndpointId(
            anchorInfo.kind,
            anchor.instanceId,
            poolSystemId,
            poolKey
          );
          if (!poolEndpointId) continue;
          poolCandidates.push({
            endpointId: poolEndpointId,
            dist,
            anchorIndex: i,
            instanceId: anchor.instanceId ?? 0,
            specIndex: p,
          });
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

  if (anchorInfo && poolSpecs.length > 0 && occupantIds.length > 0) {
    for (let p = 0; p < poolSpecs.length; p++) {
      const spec = poolSpecs[p];
      const specOwnerKind = normalizeString(spec?.ownerKind);
      if (specOwnerKind !== "pawn") continue;
      const source = normalizeString(spec?.source || "occupants");
      if (source !== "occupants") continue;
      const poolSystemId = normalizeString(spec?.systemId || spec?.system);
      const poolKey = normalizeString(spec?.poolKey);
      if (!poolSystemId || !poolKey) continue;
      const requiresEquippedFromSpec =
        spec?.requires?.equipped === true ||
        spec?.requiresEquipped === true ||
        spec?.requiresEquippedKind != null;
      const requiresEquippedProvider = requiresEquippedFromSpec
        ? true
        : poolProviderRequiresEquipped(poolSystemId, poolKey);

      for (let o = 0; o < occupantIds.length; o++) {
        const pawnId = occupantIds[o];
        const owner = resolvePoolOwner(state, "pawn", pawnId);
        if (!owner) continue;
        if (
          requiresEquippedProvider &&
          !ownerHasEquippedPoolProvider(owner, poolSystemId, poolKey)
        ) {
          continue;
        }
        const poolState = resolvePawnPoolState(owner, poolSystemId, poolKey);
        if (!poolState || typeof poolState !== "object") continue;
        const poolEndpointId = buildPoolEndpointId(
          "pawn",
          pawnId,
          poolSystemId,
          poolKey
        );
        if (!poolEndpointId) continue;
        poolCandidates.push({
          endpointId: poolEndpointId,
          dist: 0,
          anchorIndex: o,
          instanceId: Number.isFinite(pawnId) ? pawnId : Number(pawnId) || 0,
          specIndex: p,
        });
      }
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
  if (endpointId === DROP_ENDPOINT_SENTINEL) {
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
    const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
    for (const pawn of pawns) {
      if (!pawn) continue;
      if (String(pawn.id) === String(ownerId)) return pawn;
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

function resolvePawnPoolState(owner, systemId, poolKey) {
  if (!owner || !systemId || !poolKey) return null;
  const entry = findEquippedPoolProviderEntry(owner, systemId, poolKey);
  const fromItem = entry?.item?.systemState?.[systemId]?.[poolKey];
  if (fromItem && typeof fromItem === "object") return fromItem;
  return resolvePoolState(owner, systemId, poolKey);
}

export function resolveEndpointTarget(state, endpointId) {
  if (!endpointId || typeof endpointId !== "string") return null;
  if (endpointId === "res:state") {
    return { kind: "resource", target: state?.resources ?? null };
  }
  if (endpointId === "spawn:tileOccupants") {
    return { kind: "spawn" };
  }
  if (endpointId.startsWith(DROP_ENDPOINT_PREFIX)) {
    return null;
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
    const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
    for (const pawn of pawns) {
      if (pawn?.id != null && String(pawn.id) === String(id)) {
        return { kind: "system", target: pawn };
      }
    }
    return null;
  }
  if (endpointId.startsWith(POOL_ENDPOINT_PREFIX)) {
    const parsed = parsePoolEndpointId(endpointId);
    if (!parsed) return null;
    const owner = resolvePoolOwner(state, parsed.ownerKind, parsed.ownerId);
    if (!owner) return null;
    const pool =
      parsed.ownerKind === "pawn"
        ? resolvePawnPoolState(owner, parsed.systemId, parsed.poolKey)
        : resolvePoolState(owner, parsed.systemId, parsed.poolKey);
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
    const tags = Array.isArray(item.tags) ? item.tags.slice() : [];
    if (item.quantity <= 0) {
      Inventory.removeItem(inv, item.id);
    }
    bumpInvVersion(inv);
    return { kind: item.kind, tier, tags };
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
    const tags = Array.isArray(item.tags) ? item.tags.slice() : [];
    if (item.quantity <= 0) {
      Inventory.removeItem(inv, item.id);
    }
    bumpInvVersion(inv);
    return { kind: item.kind, tier, tags };
  }
  return null;
}

export function addItemToInventory(
  state,
  inv,
  itemId,
  qty,
  tier = null,
  itemOptions = null
) {
  if (!inv || !Array.isArray(inv.items)) return 0;
  const def = itemDefs[itemId] || null;
  const maxStack = getItemMaxStack({ kind: itemId, tier });
  const hasCustomState =
    itemOptions &&
    typeof itemOptions === "object" &&
    (itemOptions.tags != null ||
      itemOptions.systemTiers != null ||
      itemOptions.systemState != null ||
      itemOptions.seasonsToExpire != null ||
      itemOptions.expiryTurn != null);
  const dummy = {
    kind: itemId,
    tier: tier ?? def?.defaultTier ?? "bronze",
    seasonsToExpire:
      hasCustomState && itemOptions.seasonsToExpire != null
        ? itemOptions.seasonsToExpire
        : null,
    tags:
      hasCustomState && Array.isArray(itemOptions.tags)
        ? cloneSerializable(itemOptions.tags)
        : [],
    systemTiers:
      hasCustomState && itemOptions.systemTiers && typeof itemOptions.systemTiers === "object"
        ? cloneSerializable(itemOptions.systemTiers)
        : {},
    systemState:
      hasCustomState && itemOptions.systemState && typeof itemOptions.systemState === "object"
        ? cloneSerializable(itemOptions.systemState)
        : {},
  };
  initializeItemFromDef(state, dummy, { reset: true });
  dummy.tier = tier ?? dummy.tier;
  if (hasCustomState) {
    if (Array.isArray(itemOptions.tags)) {
      dummy.tags = cloneSerializable(itemOptions.tags);
    }
    if (
      itemOptions.systemTiers &&
      typeof itemOptions.systemTiers === "object"
    ) {
      const tiers = cloneSerializable(itemOptions.systemTiers);
      for (const [systemId, tierValue] of Object.entries(tiers)) {
        dummy.systemTiers[systemId] = tierValue;
      }
    }
    if (
      itemOptions.systemState &&
      typeof itemOptions.systemState === "object"
    ) {
      const states = cloneSerializable(itemOptions.systemState);
      for (const [systemId, systemValue] of Object.entries(states)) {
        dummy.systemState[systemId] = systemValue;
      }
    }
  }

  let remaining = Math.max(0, safeFloor(qty, 0));
  let added = 0;

  if (!hasCustomState) {
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
  }

  while (remaining > 0) {
    const take = Math.min(remaining, maxStack);
    const newItem = Inventory.addNewItem(state, inv, {
      kind: itemId,
      quantity: take,
      width: def?.defaultWidth ?? 1,
      height: def?.defaultHeight ?? 1,
      tier: dummy.tier,
      expiryTurn:
        hasCustomState && itemOptions.expiryTurn != null
          ? itemOptions.expiryTurn
          : undefined,
      seasonsToExpire:
        hasCustomState && itemOptions.seasonsToExpire != null
          ? itemOptions.seasonsToExpire
          : undefined,
      tags:
        hasCustomState && Array.isArray(dummy.tags)
          ? cloneSerializable(dummy.tags)
          : undefined,
      systemTiers:
        hasCustomState && dummy.systemTiers && typeof dummy.systemTiers === "object"
          ? cloneSerializable(dummy.systemTiers)
          : undefined,
      systemState:
        hasCustomState && dummy.systemState && typeof dummy.systemState === "object"
          ? cloneSerializable(dummy.systemState)
          : undefined,
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
  return buildProcessDropboxOwnerId(processId);
}
