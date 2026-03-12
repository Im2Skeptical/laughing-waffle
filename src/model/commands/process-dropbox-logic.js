import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { TIER_ASC } from "../effects/core/tiers.js";
import { bumpInvVersion } from "../effects/core/inventory-version.js";
import { Inventory } from "../inventory-model.js";
import { getProcessDefForInstance } from "../process-framework.js";
import {
  buildProcessDropboxOwnerId,
  isBasketDropboxOwnerId,
  isHubDropboxOwnerId,
  isProcessDropboxOwnerId,
  parseBasketDropboxOwnerId,
  parseHubDropboxOwnerId,
  parseProcessDropboxOwnerId,
} from "../owner-id-protocol.js";
import { ensureHubSystemState } from "./system-state-helpers.js";
import {
  ensureRecipePriorityState,
  getEnabledRecipeIds,
  getTopEnabledRecipeId,
} from "../recipe-priority.js";

function cloneRequirementEntries(requirements) {
  const list = Array.isArray(requirements) ? requirements : [];
  return list
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      amount: Math.max(0, Math.floor(entry.amount ?? 0)),
      progress: Math.max(0, Math.floor(entry.progress ?? 0)),
      consume: entry.consume !== false,
      requirementType:
        typeof entry.requirementType === "string" && entry.requirementType.length > 0
          ? entry.requirementType
          : null,
    }));
}

function normalizeRequirementsView(requirements) {
  return (Array.isArray(requirements) ? requirements : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      kind: entry.kind,
      itemId: entry.itemId ?? null,
      amount: Math.max(0, Math.floor(entry.amount ?? 0)),
      progress: Math.max(0, Math.floor(entry.progress ?? 0)),
      consume: entry.consume !== false,
      requirementType:
        typeof entry.requirementType === "string" && entry.requirementType.length > 0
          ? entry.requirementType
          : null,
    }));
}

function findProcessInTarget(target, processId) {
  if (!target?.systemState || !processId) return null;
  for (const [systemId, sysState] of Object.entries(target.systemState)) {
    const processes = Array.isArray(sysState?.processes) ? sysState.processes : [];
    if (!processes.length) continue;
    for (const process of processes) {
      if (process?.id === processId) {
        return { target, process, systemId };
      }
    }
  }
  return null;
}

function findProcessById(state, processId) {
  if (!state || !processId) return null;
  const hubAnchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  for (const anchor of hubAnchors) {
    if (!anchor) continue;
    const found = findProcessInTarget(anchor, processId);
    if (found) return found;
  }
  const hubSlots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of hubSlots) {
    const structure = slot?.structure;
    if (!structure) continue;
    const found = findProcessInTarget(structure, processId);
    if (found) return found;
  }
  const tileAnchors = Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
  for (const anchor of tileAnchors) {
    if (!anchor) continue;
    const found = findProcessInTarget(anchor, processId);
    if (found) return found;
  }
  return null;
}

function findHubStructureById(state, structureId) {
  if (!state || structureId == null) return null;
  const idStr = String(structureId);
  const hubAnchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  for (const anchor of hubAnchors) {
    if (!anchor) continue;
    if (String(anchor.instanceId) === idStr) return anchor;
  }
  const hubSlots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of hubSlots) {
    const structure = slot?.structure;
    if (!structure) continue;
    if (String(structure.instanceId) === idStr) return structure;
  }
  return null;
}

function normalizeStructureDepositConfig(structure) {
  if (!structure?.defId) return null;
  const def = hubStructureDefs?.[structure.defId] ?? null;
  const deposit = def?.deposit;
  if (!deposit || typeof deposit !== "object") return null;
  const systemId =
    typeof deposit.systemId === "string" && deposit.systemId.length
      ? deposit.systemId
      : null;
  if (!systemId) return null;
  const poolKey =
    typeof deposit.poolKey === "string" && deposit.poolKey.length
      ? deposit.poolKey
      : "byKindTier";
  const allowedTags = Array.isArray(deposit.allowedTags)
    ? deposit.allowedTags.filter((tag) => typeof tag === "string" && tag.length > 0)
    : [];
  const allowedItemIds = Array.isArray(deposit.allowedItemIds)
    ? deposit.allowedItemIds.filter((id) => typeof id === "string" && id.length > 0)
    : [];
  const allowAny = deposit.allowAny === true;
  const storeDeposits = deposit.storeDeposits !== false;
  const prestigeCurveMultiplier =
    Number.isFinite(deposit.prestigeCurveMultiplier) &&
    deposit.prestigeCurveMultiplier > 0
      ? deposit.prestigeCurveMultiplier
      : 1;
  const instantDropboxLoad = deposit.instantDropboxLoad === true;
  return {
    systemId,
    poolKey,
    allowedTags,
    allowedItemIds,
    allowAny,
    storeDeposits,
    prestigeCurveMultiplier,
    instantDropboxLoad,
  };
}

function normalizePawnOwnerId(ownerId) {
  if (typeof ownerId === "number") return ownerId;
  if (typeof ownerId === "string") {
    const asNum = Number(ownerId);
    if (Number.isFinite(asNum)) return asNum;
  }
  return ownerId;
}

function getLeaderByOwnerId(state, ownerId) {
  const normalized = normalizePawnOwnerId(ownerId);
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const pawn =
    pawns.find((candidatePawn) => candidatePawn?.id === normalized) ?? null;
  if (!pawn || pawn.role !== "leader") return null;
  return pawn;
}

function itemKindProvidesBasketPool(itemKind) {
  if (typeof itemKind !== "string" || itemKind.length <= 0) return false;
  const def = itemDefs?.[itemKind];
  if (!def || typeof def !== "object") return false;
  const specs = Array.isArray(def.poolProviders)
    ? def.poolProviders
    : def.poolProviders && typeof def.poolProviders === "object"
      ? [def.poolProviders]
      : [];
  return specs.some((spec) => {
    const systemId = typeof spec?.systemId === "string" ? spec.systemId : spec?.system;
    const poolKey = typeof spec?.poolKey === "string" ? spec.poolKey : null;
    return systemId === "storage" && poolKey === "byKindTier";
  });
}

function getEquippedBasketForLeader(leader, preferredSlotId = null) {
  if (!leader || leader.role !== "leader") return null;
  const equipment =
    leader?.equipment && typeof leader.equipment === "object"
      ? leader.equipment
      : null;
  if (!equipment) return null;
  const preferred =
    typeof preferredSlotId === "string" && preferredSlotId.length > 0
      ? preferredSlotId
      : null;
  if (preferred) {
    const item = equipment[preferred];
    if (item && itemKindProvidesBasketPool(item?.kind)) {
      return { slotId: preferred, item };
    }
  }
  for (const [slotId, item] of Object.entries(equipment)) {
    if (!item || typeof item !== "object") continue;
    if (!itemKindProvidesBasketPool(item?.kind)) continue;
    return { slotId, item };
  }
  return null;
}

function itemKindMatchesDepositRules(itemKind, config) {
  if (!itemKind || !config) return false;
  if (config.allowAny) return true;
  if (config.allowedItemIds.includes(itemKind)) return true;
  if (!config.allowedTags.length) return false;
  const tags = new Set();
  const baseTags = Array.isArray(itemDefs?.[itemKind]?.baseTags)
    ? itemDefs[itemKind].baseTags
    : [];
  for (const tag of baseTags) {
    if (typeof tag === "string" && tag.length) tags.add(tag);
  }
  for (const allowedTag of config.allowedTags) {
    if (tags.has(allowedTag)) return true;
  }
  return false;
}

function getRequirementsViewForProcess(state, process, target, systemId) {
  const existing = normalizeRequirementsView(process?.requirements);
  if (existing.length > 0) return existing;
  const processDef = getProcessDefForInstance(process, target, {
    target,
    systemId,
    state,
    leaderId: process?.leaderId ?? null,
  });
  return normalizeRequirementsView(processDef?.transform?.requirements);
}

function isRecipeSystemIdleProcess(process, target, systemId) {
  if (!process || !target || !systemId) return false;
  if (systemId !== "cook" && systemId !== "craft") return false;
  const systemState = target?.systemState?.[systemId] ?? null;
  const selectedRecipeIdRaw =
    typeof systemState?.selectedRecipeId === "string" &&
    systemState.selectedRecipeId.length > 0
      ? systemState.selectedRecipeId
      : null;
  if (selectedRecipeIdRaw) return false;
  const priority = ensureRecipePriorityState(systemState, {
    systemId,
    state: null,
    includeLocked: true,
  });
  const selectedRecipeId = getTopEnabledRecipeId(priority);
  return !selectedRecipeId;
}

function isPriorityRecipeDropboxSystem(systemId) {
  return systemId === "cook" || systemId === "craft";
}

function listPriorityRecipeProcesses(target, systemId) {
  if (!target || !isPriorityRecipeDropboxSystem(systemId)) return [];
  const systemState = target?.systemState?.[systemId] ?? null;
  const processes = Array.isArray(systemState?.processes) ? systemState.processes : [];
  if (processes.length <= 0) return [];
  const priority = ensureRecipePriorityState(systemState, {
    systemId,
    state: null,
    includeLocked: true,
  });
  const orderedEnabled = getEnabledRecipeIds(priority);
  if (orderedEnabled.length <= 0) return [];

  const processByType = new Map();
  for (const process of processes) {
    const type = typeof process?.type === "string" ? process.type : null;
    if (!type || processByType.has(type)) continue;
    processByType.set(type, process);
  }

  const ordered = [];
  for (const recipeId of orderedEnabled) {
    const process = processByType.get(recipeId);
    if (process) ordered.push(process);
  }
  return ordered;
}

function evaluatePriorityRecipeDropboxItem(state, target, systemId, itemKind, quantity) {
  const orderedProcesses = listPriorityRecipeProcesses(target, systemId);
  if (orderedProcesses.length <= 0) {
    return null;
  }

  let cap = 0;
  let anyMatching = false;
  for (const process of orderedProcesses) {
    const requirements = getRequirementsViewForProcess(
      state,
      process,
      target,
      systemId
    );
    const match = getRequirementCapForItem(requirements, itemKind);
    if (match.anyMatching) {
      anyMatching = true;
      cap += Math.max(0, Math.floor(match.cap ?? 0));
    }
  }

  if (!anyMatching) {
    return { status: "invalid", reason: "dropboxItemNotRequired", cap: 0 };
  }
  if (cap <= 0) {
    return { status: "capped", reason: "dropboxRequirementCapReached", cap: 0 };
  }
  return {
    status: "valid",
    reason: "dropboxLoaded",
    cap: Math.min(cap, quantity),
    instant: false,
    kind: "process",
  };
}

function applyPriorityRecipeDropboxItem(state, target, systemId, item, maxUnits) {
  const orderedProcesses = listPriorityRecipeProcesses(target, systemId);
  if (orderedProcesses.length <= 0) return null;
  let remaining = Math.max(0, Math.floor(maxUnits ?? 0));
  let moved = 0;
  for (const process of orderedProcesses) {
    if (remaining <= 0) break;
    const requirements = ensureMutableProcessRequirements(
      state,
      process,
      target,
      systemId
    );
    const consumed = applyRequirementUnitsForItem(requirements, item.kind, remaining);
    if (consumed <= 0) continue;
    recordRequirementConsumption(process, item, consumed);
    moved += consumed;
    remaining -= consumed;
  }
  return moved;
}

function resolveDropboxContext(state, toOwnerId) {
  if (isBasketDropboxOwnerId(toOwnerId)) {
    const parsed = parseBasketDropboxOwnerId(toOwnerId);
    if (!parsed?.ownerId) {
      return { ok: false, reason: "dropboxBadOwner", kind: "basket" };
    }
    return {
      ok: true,
      kind: "basket",
      basketOwnerId: parsed.ownerId,
      basketSlotId: parsed.slotId ?? null,
    };
  }
  if (isHubDropboxOwnerId(toOwnerId)) {
    const structureId = parseHubDropboxOwnerId(toOwnerId);
    const structure = findHubStructureById(state, structureId);
    if (!structure) {
      return { ok: false, reason: "dropboxNoProcess", kind: "hub" };
    }
    return { ok: true, kind: "hub", structure };
  }
  if (!isProcessDropboxOwnerId(toOwnerId)) {
    return { ok: false, reason: "dropboxBadOwner", kind: null };
  }
  const processId = parseProcessDropboxOwnerId(toOwnerId);
  if (!processId) return { ok: false, reason: "dropboxBadOwner", kind: "process" };
  const found = findProcessById(state, processId);
  if (!found?.process || !found?.target) {
    return { ok: false, reason: "dropboxNoProcess", kind: "process", processId };
  }
  return {
    ok: true,
    kind: "process",
    processId,
    process: found.process,
    target: found.target,
    systemId: found.systemId,
  };
}

function ensureMutableProcessRequirements(state, process, target, systemId) {
  if (!Array.isArray(process.requirements)) {
    process.requirements = [];
  }
  if (process.requirements.length > 0) {
    for (const req of process.requirements) {
      if (!req || typeof req !== "object") continue;
      req.amount = Math.max(0, Math.floor(req.amount ?? 0));
      req.progress = Math.max(0, Math.floor(req.progress ?? 0));
      req.consume = req.consume !== false;
      req.requirementType =
        typeof req.requirementType === "string" && req.requirementType.length > 0
          ? req.requirementType
          : null;
    }
    return process.requirements;
  }
  const processDef = getProcessDefForInstance(process, target, {
    target,
    systemId,
    state,
    leaderId: process?.leaderId ?? null,
  });
  const cloned = cloneRequirementEntries(processDef?.transform?.requirements);
  process.requirements = cloned;
  return process.requirements;
}

function applyRequirementUnitsForItem(requirements, itemKind, maxUnits) {
  let remaining = Math.max(0, Math.floor(maxUnits ?? 0));
  if (remaining <= 0) return 0;
  let moved = 0;
  for (const req of requirements) {
    if (!req || typeof req !== "object") continue;
    if (req.kind !== "item") continue;
    if (req.consume === false) continue;
    if (req.itemId !== itemKind) continue;
    const required = Math.max(0, Math.floor(req.amount ?? 0));
    const progress = Math.max(0, Math.floor(req.progress ?? 0));
    const deficit = Math.max(0, required - progress);
    if (deficit <= 0) continue;
    const take = Math.min(deficit, remaining);
    if (take <= 0) continue;
    req.progress = progress + take;
    moved += take;
    remaining -= take;
    if (remaining <= 0) break;
  }
  return moved;
}

function recordRequirementConsumption(process, item, units) {
  const moved = Math.max(0, Math.floor(units ?? 0));
  if (!process || !item || moved <= 0) return;
  const kind = item.kind;
  const tierRaw =
    typeof item.tier === "string" && item.tier.length > 0
      ? item.tier
      : itemDefs?.[kind]?.defaultTier || "bronze";
  const tier = TIER_ASC.includes(tierRaw) ? tierRaw : "bronze";
  if (!process.consumedByKindTier || typeof process.consumedByKindTier !== "object") {
    process.consumedByKindTier = {};
  }
  if (!process.consumedByKindTier[kind]) {
    process.consumedByKindTier[kind] = {};
  }
  const consumedBucket = process.consumedByKindTier[kind];
  consumedBucket[tier] = Math.max(0, Math.floor(consumedBucket[tier] ?? 0)) + moved;

  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (tags.includes("prestiged")) return;
  if (
    !process.prestigeConsumedByKindTier ||
    typeof process.prestigeConsumedByKindTier !== "object"
  ) {
    process.prestigeConsumedByKindTier = {};
  }
  if (!process.prestigeConsumedByKindTier[kind]) {
    process.prestigeConsumedByKindTier[kind] = {};
  }
  const prestigeBucket = process.prestigeConsumedByKindTier[kind];
  prestigeBucket[tier] = Math.max(0, Math.floor(prestigeBucket[tier] ?? 0)) + moved;
}

function getRequirementCapForItem(requirements, itemKind) {
  let cap = 0;
  let anyMatching = false;
  for (const req of requirements) {
    if (!req || typeof req !== "object") continue;
    if (req.kind !== "item") continue;
    if (req.consume === false) continue;
    if (req.itemId !== itemKind) continue;
    anyMatching = true;
    const required = Math.max(0, Math.floor(req.amount ?? 0));
    const progress = Math.max(0, Math.floor(req.progress ?? 0));
    cap += Math.max(0, required - progress);
  }
  return { cap, anyMatching };
}

export function evaluateProcessDropboxDrop(state, spec = {}) {
  const toOwnerId = spec?.toOwnerId ?? null;
  const itemKind = typeof spec?.itemKind === "string" ? spec.itemKind : null;
  const quantity = Number.isFinite(spec?.quantity)
    ? Math.max(0, Math.floor(spec.quantity))
    : 1;

  if (!state || toOwnerId == null || !itemKind) {
    return { status: "invalid", reason: "dropboxBadArgs", cap: 0 };
  }

  const ctx = resolveDropboxContext(state, toOwnerId);
  if (!ctx.ok) {
    return { status: "invalid", reason: ctx.reason, cap: 0 };
  }

  if (ctx.kind === "basket") {
    const leader = getLeaderByOwnerId(state, ctx.basketOwnerId);
    if (!leader) {
      return { status: "invalid", reason: "dropboxNoProcess", cap: 0 };
    }
    const basketEntry = getEquippedBasketForLeader(leader, ctx.basketSlotId);
    if (!basketEntry?.item) {
      return { status: "invalid", reason: "dropboxNoProcess", cap: 0 };
    }
    if (itemKindProvidesBasketPool(itemKind)) {
      return { status: "invalid", reason: "cannotDepositBasket", cap: 0 };
    }
    return {
      status: "valid",
      reason: "dropboxLoaded",
      cap: quantity,
      instant: true,
      kind: "basket",
    };
  }

  if (ctx.kind === "hub") {
    const config = normalizeStructureDepositConfig(ctx.structure);
    if (!config || !config.instantDropboxLoad) {
      return { status: "invalid", reason: "dropboxNoProcess", cap: 0 };
    }
    if (!itemKindMatchesDepositRules(itemKind, config)) {
      return { status: "invalid", reason: "dropboxItemNotRequired", cap: 0 };
    }
    return {
      status: "valid",
      reason: "dropboxLoaded",
      cap: quantity,
      instant: true,
      kind: "hub",
    };
  }

  const process = ctx.process;
  if (!process) {
    return { status: "invalid", reason: "dropboxNoProcess", cap: 0 };
  }
  if (process.type === "depositItems") {
    const config = normalizeStructureDepositConfig(ctx.target);
    if (!config || !config.instantDropboxLoad) {
      return { status: "invalid", reason: "dropboxNoProcess", cap: 0 };
    }
    if (!itemKindMatchesDepositRules(itemKind, config)) {
      return { status: "invalid", reason: "dropboxItemNotRequired", cap: 0 };
    }
    return {
      status: "valid",
      reason: "dropboxLoaded",
      cap: quantity,
      instant: true,
      kind: "process",
      processId: process.id,
    };
  }

  if (isRecipeSystemIdleProcess(process, ctx.target, ctx.systemId)) {
    return { status: "invalid", reason: "dropboxNoRecipeSelected", cap: 0 };
  }

  if (isPriorityRecipeDropboxSystem(ctx.systemId)) {
    const priorityResult = evaluatePriorityRecipeDropboxItem(
      state,
      ctx.target,
      ctx.systemId,
      itemKind,
      quantity
    );
    if (priorityResult) {
      if (priorityResult.status === "valid") {
        return {
          ...priorityResult,
          processId: process.id,
        };
      }
      return priorityResult;
    }
  }

  const requirements = getRequirementsViewForProcess(
    state,
    process,
    ctx.target,
    ctx.systemId
  );
  if (!requirements.length) {
    return { status: "invalid", reason: "dropboxItemNotRequired", cap: 0 };
  }
  const { cap, anyMatching } = getRequirementCapForItem(requirements, itemKind);
  if (!anyMatching) {
    return { status: "invalid", reason: "dropboxItemNotRequired", cap: 0 };
  }
  if (cap <= 0) {
    return { status: "capped", reason: "dropboxRequirementCapReached", cap: 0 };
  }
  return {
    status: "valid",
    reason: "dropboxLoaded",
    cap: Math.min(cap, quantity),
    instant: false,
    kind: "process",
    processId: process.id,
  };
}

export function applyProcessDropboxLoad(state, spec = {}) {
  const fromOwnerId = spec?.fromOwnerId ?? null;
  const toOwnerId = spec?.toOwnerId ?? null;
  const itemId = spec?.itemId ?? null;
  if (!state || fromOwnerId == null || toOwnerId == null || itemId == null) {
    return { ok: false, reason: "dropboxBadArgs" };
  }
  const fromInv = state?.ownerInventories?.[fromOwnerId] ?? null;
  if (!fromInv) return { ok: false, reason: "noInventory" };
  const item =
    fromInv.itemsById?.[itemId] ??
    fromInv.items?.find((candidateItem) => candidateItem?.id === itemId) ??
    null;
  if (!item) return { ok: false, reason: "noItem" };
  const quantity = Math.max(0, Math.floor(item.quantity ?? 0));
  if (quantity <= 0) return { ok: false, reason: "emptyStack" };

  const evalRes = evaluateProcessDropboxDrop(state, {
    toOwnerId,
    itemKind: item.kind,
    quantity,
  });
  if (evalRes.status !== "valid" || evalRes.instant === true) {
    return { ok: false, reason: evalRes.reason ?? "dropboxRequirementCapReached" };
  }

  const moved = applyProcessDropboxLoadFromItem(state, {
    toOwnerId,
    item,
    quantity: Math.min(quantity, Math.max(0, Math.floor(evalRes.cap ?? 0))),
  });
  if (!moved.ok) return moved;

  item.quantity = Math.max(0, quantity - moved.moved);
  if (item.quantity <= 0) {
    Inventory.removeItem(fromInv, item.id);
  }
  Inventory.rebuildDerived(fromInv);
  bumpInvVersion(fromInv);

  return {
    ok: true,
    result: "dropboxLoaded",
    fromOwnerId,
    toOwnerId,
    itemId: item.id,
    itemKind: item.kind,
    moved: moved.moved,
    partial: moved.moved < quantity,
    firstItemId: null,
  };
}

export function applyProcessDropboxLoadFromItem(state, spec = {}) {
  const toOwnerId = spec?.toOwnerId ?? null;
  const item = spec?.item ?? null;
  const requested = Number.isFinite(spec?.quantity)
    ? Math.max(0, Math.floor(spec.quantity))
    : Math.max(0, Math.floor(item?.quantity ?? 0));
  if (!state || toOwnerId == null || !item || requested <= 0) {
    return { ok: false, reason: "dropboxBadArgs" };
  }
  const evalRes = evaluateProcessDropboxDrop(state, {
    toOwnerId,
    itemKind: item.kind,
    quantity: requested,
  });
  if (evalRes.status !== "valid" || evalRes.instant === true) {
    return { ok: false, reason: evalRes.reason ?? "dropboxRequirementCapReached" };
  }

  const processId = parseProcessDropboxOwnerId(toOwnerId);
  if (!processId) return { ok: false, reason: "dropboxBadOwner" };
  const found = findProcessById(state, processId);
  if (!found?.process || !found?.target) {
    return { ok: false, reason: "dropboxNoProcess" };
  }
  const maxUnits = Math.min(requested, Math.max(0, Math.floor(evalRes.cap ?? 0)));
  let moved = 0;
  let usedPriorityDistribution = false;
  if (isPriorityRecipeDropboxSystem(found.systemId)) {
    const priorityMoved = applyPriorityRecipeDropboxItem(
      state,
      found.target,
      found.systemId,
      item,
      maxUnits
    );
    if (priorityMoved != null) {
      moved = priorityMoved;
      usedPriorityDistribution = true;
    }
  }
  if (!usedPriorityDistribution) {
    const requirements = ensureMutableProcessRequirements(
      state,
      found.process,
      found.target,
      found.systemId
    );
    moved = applyRequirementUnitsForItem(requirements, item.kind, maxUnits);
    if (moved > 0) {
      recordRequirementConsumption(found.process, item, moved);
    }
  }
  if (moved <= 0) {
    return { ok: false, reason: "dropboxRequirementCapReached" };
  }
  return {
    ok: true,
    result: "dropboxLoaded",
    moved,
    partial: moved < requested,
    processId,
    toOwnerId: buildProcessDropboxOwnerId(processId),
  };
}

export function evaluateProcessDropboxDragStatus(state, spec = {}) {
  const result = evaluateProcessDropboxDrop(state, spec);
  if (result.status === "valid") return result;
  if (result.reason === "dropboxRequirementCapReached") {
    return { ...result, status: "capped" };
  }
  return { ...result, status: "invalid" };
}

export function isInstantDropboxTarget(state, ownerId) {
  if (isBasketDropboxOwnerId(ownerId)) return true;
  const evalRes = evaluateProcessDropboxDrop(state, {
    toOwnerId: ownerId,
    itemKind: "__probe__",
    quantity: 1,
  });
  if (evalRes.status === "valid" && evalRes.instant === true) return true;
  if (isHubDropboxOwnerId(ownerId)) return true;
  if (!isProcessDropboxOwnerId(ownerId)) return false;
  const processId = parseProcessDropboxOwnerId(ownerId);
  if (!processId) return false;
  const found = findProcessById(state, processId);
  return found?.process?.type === "depositItems";
}

export function addUnitsToStructurePool(structure, systemId, poolKey, kind, tier, amount) {
  if (!structure || !systemId || !poolKey || !kind || !tier || amount <= 0) {
    return false;
  }
  const sysState = ensureHubSystemState(structure, systemId);
  if (!sysState || typeof sysState !== "object") return false;
  if (!sysState[poolKey] || typeof sysState[poolKey] !== "object") {
    sysState[poolKey] = {};
  }
  if (!sysState.totalByTier || typeof sysState.totalByTier !== "object") {
    sysState.totalByTier = {};
  }

  const pool = sysState[poolKey];
  if (!pool[kind] || typeof pool[kind] !== "object") {
    pool[kind] = {};
  }
  const bucket = pool[kind];
  bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + amount;
  sysState.totalByTier[tier] = Math.max(0, Math.floor(sysState.totalByTier[tier] ?? 0)) + amount;
  return true;
}
