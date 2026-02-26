import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { runEffect } from "../effects/index.js";
import { TIER_ASC } from "../effects/core/tiers.js";
import {
  canItemEquipInSlot,
  isLeaderEquipmentSlotId,
} from "../equipment-rules.js";
import { bumpInvVersion } from "../effects/core/inventory-version.js";
import { itemProvidesPool } from "../item-def-rules.js";
import {
  Inventory,
} from "../inventory-model.js";
import {
  getDropEndpointId,
  getProcessDefForInstance,
} from "../process-framework.js";
import { applyPrestigeDeposit } from "../prestige-system.js";
import { canOwnerAcceptItem } from "./owner-acceptance.js";
import {
  addItemUnitsToInventoryWithTags,
  ensureInventoryForHubStructure,
  ensureLeaderEquipment,
  ensurePortableStorageState,
  getEquippedBasketEntry,
  getLeaderByOwnerId,
  getPawnById,
  isTierBucket,
  itemHasBaseTag,
} from "./inventory-helpers.js";
import { ensureHubSystemState } from "./system-state-helpers.js";

export function cmdWithdrawHubPoolItem(
  state,
  { hubCol, itemId, amount, systemId, poolKey } = {}
) {
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  if (typeof itemId !== "string" || itemId.length === 0) {
    return { ok: false, reason: "badItemId" };
  }
  const requested = Math.max(1, Math.floor(amount ?? 1));
  if (requested <= 0) return { ok: false, reason: "badAmount" };

  const col = Math.floor(hubCol);
  const structure = state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };

  const def = structure?.defId ? hubStructureDefs?.[structure.defId] : null;
  const deposit = def?.deposit;
  if (!deposit || typeof deposit !== "object") {
    return { ok: false, reason: "noDepositPool" };
  }

  const resolvedSystemId = typeof deposit.systemId === "string" ? deposit.systemId : null;
  if (!resolvedSystemId) return { ok: false, reason: "badPoolSystem" };
  const resolvedPoolKey =
    typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
      ? deposit.poolKey
      : "byKindTier";

  if (
    typeof systemId === "string" &&
    systemId.length > 0 &&
    systemId !== resolvedSystemId
  ) {
    return { ok: false, reason: "mismatchedSystemId" };
  }
  if (
    typeof poolKey === "string" &&
    poolKey.length > 0 &&
    poolKey !== resolvedPoolKey
  ) {
    return { ok: false, reason: "mismatchedPoolKey" };
  }

  if (resolvedSystemId !== "granaryStore" && resolvedSystemId !== "storehouseStore") {
    return { ok: false, reason: "unsupportedPool" };
  }

  const sysState = ensureHubSystemState(structure, resolvedSystemId);
  if (!sysState || typeof sysState !== "object") {
    return { ok: false, reason: "noSystemState" };
  }
  const pool = sysState?.[resolvedPoolKey];
  if (!pool || typeof pool !== "object") return { ok: false, reason: "noPool" };
  if (isTierBucket(pool)) return { ok: false, reason: "unsupportedPoolShape" };

  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") {
    return { ok: false, reason: "missingItemPool" };
  }

  const inv = ensureInventoryForHubStructure(state, structure);
  if (!inv) return { ok: false, reason: "noInventory" };

  let remaining = requested;
  let moved = 0;
  let spawnItemId = null;
  const applyPrestigedTag = itemHasBaseTag(itemId, "grain");
  const extraTags = applyPrestigedTag ? ["prestiged"] : [];

  for (const tier of TIER_ASC) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
    if (available <= 0) continue;
    const want = Math.min(remaining, available);
    const addRes = addItemUnitsToInventoryWithTags(
      state,
      inv,
      itemId,
      tier,
      want,
      extraTags
    );
    const added = Math.max(0, Math.floor(addRes?.added ?? 0));
    if (added <= 0) break;

    bucket[tier] = available - added;
    if (sysState.totalByTier && typeof sysState.totalByTier === "object") {
      const total = Math.max(0, Math.floor(sysState.totalByTier[tier] ?? 0));
      sysState.totalByTier[tier] = Math.max(0, total - added);
    }
    if (spawnItemId == null && addRes?.firstItemId != null) {
      spawnItemId = addRes.firstItemId;
    }

    moved += added;
    remaining -= added;
    if (added < want) break;
  }

  if (moved <= 0) {
    return { ok: false, reason: "noSpaceForWithdraw" };
  }

  const empty = TIER_ASC.every((tier) => Math.max(0, Math.floor(bucket[tier] ?? 0)) <= 0);
  if (empty) delete pool[itemId];

  bumpInvVersion(inv);

  const anchorCol = Number.isFinite(structure.col) ? Math.floor(structure.col) : col;
  return {
    ok: true,
    result: "poolWithdrawn",
    hubCol: anchorCol,
    ownerId: structure.instanceId,
    itemKind: itemId,
    requested,
    moved,
    spawnItemId,
    taggedPrestiged: applyPrestigedTag,
  };
}

export function cmdDepositItemToEquippedBasket(
  state,
  { fromOwnerId, toOwnerId, itemId, slotId } = {}
) {
  if (fromOwnerId == null) return { ok: false, reason: "badFromOwner" };
  if (toOwnerId == null) return { ok: false, reason: "badToOwner" };
  if (itemId == null) return { ok: false, reason: "badItemId" };

  const fromInv = state?.ownerInventories?.[fromOwnerId];
  if (!fromInv) return { ok: false, reason: "noInventory" };

  const leader = getLeaderByOwnerId(state, toOwnerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  const basketEntry = getEquippedBasketEntry(leader, slotId);
  if (!basketEntry?.item) return { ok: false, reason: "noEquippedBasket" };

  const item = fromInv.itemsById?.[itemId] || fromInv.items?.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };
  if (
    item.id === basketEntry.item.id ||
    itemProvidesPool(item, "storage", "byKindTier")
  ) {
    return { ok: false, reason: "cannotDepositBasket" };
  }

  const qty = Math.max(0, Math.floor(item.quantity ?? 0));
  if (qty <= 0) return { ok: false, reason: "emptyStack" };

  const store = ensurePortableStorageState(leader, basketEntry.item);
  if (!store) return { ok: false, reason: "noBasketStore" };
  const pool = store.byKindTier;
  if (!pool || typeof pool !== "object") return { ok: false, reason: "noPool" };

  if (!pool[item.kind] || typeof pool[item.kind] !== "object") {
    pool[item.kind] = {};
  }
  const bucket = pool[item.kind];
  for (const tier of TIER_ASC) {
    if (!Number.isFinite(bucket[tier])) bucket[tier] = 0;
  }

  const tierRaw =
    typeof item.tier === "string" && item.tier.length > 0
      ? item.tier
      : itemDefs?.[item.kind]?.defaultTier || "bronze";
  const tier = TIER_ASC.includes(tierRaw) ? tierRaw : "bronze";
  bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + qty;
  store.totalByTier[tier] = Math.max(0, Math.floor(store.totalByTier[tier] ?? 0)) + qty;

  Inventory.removeItem(fromInv, item.id);
  Inventory.rebuildDerived(fromInv);
  bumpInvVersion(fromInv);

  return {
    ok: true,
    result: "basketDeposited",
    fromOwnerId,
    toOwnerId: leader.id,
    itemKind: item.kind,
    moved: qty,
    basketSlotId: basketEntry.slotId,
  };
}

export function cmdWithdrawPawnBasketPoolItem(
  state,
  { ownerId, itemId, amount, slotId } = {}
) {
  if (ownerId == null) return { ok: false, reason: "badOwner" };
  if (typeof itemId !== "string" || itemId.length === 0) {
    return { ok: false, reason: "badItemId" };
  }
  const requested = Math.max(1, Math.floor(amount ?? 1));
  if (requested <= 0) return { ok: false, reason: "badAmount" };

  const leader = getLeaderByOwnerId(state, ownerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  const basketEntry = getEquippedBasketEntry(leader, slotId);
  if (!basketEntry?.item) return { ok: false, reason: "noEquippedBasket" };

  const store = ensurePortableStorageState(leader, basketEntry.item);
  if (!store) return { ok: false, reason: "noBasketStore" };
  const pool = store.byKindTier;
  if (!pool || typeof pool !== "object") return { ok: false, reason: "noPool" };
  if (isTierBucket(pool)) return { ok: false, reason: "unsupportedPoolShape" };

  const bucket = pool[itemId];
  if (!bucket || typeof bucket !== "object") {
    return { ok: false, reason: "missingItemPool" };
  }

  const inv = state?.ownerInventories?.[leader.id];
  if (!inv) return { ok: false, reason: "noInventory" };

  let remaining = requested;
  let moved = 0;
  let spawnItemId = null;
  for (const tier of TIER_ASC) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.floor(bucket[tier] ?? 0));
    if (available <= 0) continue;
    const want = Math.min(remaining, available);
    const addRes = addItemUnitsToInventoryWithTags(state, inv, itemId, tier, want, []);
    const added = Math.max(0, Math.floor(addRes?.added ?? 0));
    if (added <= 0) break;

    bucket[tier] = available - added;
    const total = Math.max(0, Math.floor(store.totalByTier[tier] ?? 0));
    store.totalByTier[tier] = Math.max(0, total - added);
    if (spawnItemId == null && addRes?.firstItemId != null) {
      spawnItemId = addRes.firstItemId;
    }
    moved += added;
    remaining -= added;
    if (added < want) break;
  }

  if (moved <= 0) {
    return { ok: false, reason: "noSpaceForWithdraw" };
  }

  const empty = TIER_ASC.every((tier) => Math.max(0, Math.floor(bucket[tier] ?? 0)) <= 0);
  if (empty) delete pool[itemId];

  bumpInvVersion(inv);

  return {
    ok: true,
    result: "basketPoolWithdrawn",
    ownerId: leader.id,
    itemKind: itemId,
    requested,
    moved,
    spawnItemId,
    basketSlotId: basketEntry.slotId,
  };
}

export function cmdMoveItemBetweenOwners(
  state,
  { fromOwnerId, toOwnerId, itemId, targetGX, targetGY }
) {
  const fromInv = state.ownerInventories[fromOwnerId];
  const toInv = state.ownerInventories[toOwnerId];
  if (!fromInv || !toInv) return { ok: false, reason: "noInventory" };

  const item = fromInv.itemsById[itemId] || fromInv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  const ctx = { kind: "inventoryMove", state, events: [], out: null };

  runEffect(
    state,
    {
      op: "moveItem",
      fromOwnerId,
      toOwnerId,
      itemId,
      targetGX,
      targetGY,
    },
    ctx
  );

  return ctx.out || { ok: false, reason: "effectFailed" };
}

const PROCESS_DROPBOX_OWNER_PREFIX = "inv:dropbox:process:";
const HUB_DROPBOX_OWNER_PREFIX = "inv:dropbox:hub:";

function isProcessDropboxOwner(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.startsWith(PROCESS_DROPBOX_OWNER_PREFIX)
  );
}

function isHubDropboxOwner(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.startsWith(HUB_DROPBOX_OWNER_PREFIX)
  );
}

function isAnyDropboxOwner(ownerId) {
  return isProcessDropboxOwner(ownerId) || isHubDropboxOwner(ownerId);
}

function parseProcessIdFromDropboxOwner(ownerId) {
  if (!isProcessDropboxOwner(ownerId)) return null;
  const processId = ownerId.slice(PROCESS_DROPBOX_OWNER_PREFIX.length);
  return processId.length ? processId : null;
}

function parseHubStructureIdFromDropboxOwner(ownerId) {
  if (!isHubDropboxOwner(ownerId)) return null;
  const id = ownerId.slice(HUB_DROPBOX_OWNER_PREFIX.length);
  return id.length ? id : null;
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

function findTileById(state, tileId) {
  if (!state || tileId == null) return null;
  const idStr = String(tileId);
  const tileAnchors = Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
  for (const anchor of tileAnchors) {
    if (!anchor) continue;
    if (String(anchor.instanceId) === idStr) return anchor;
  }
  return null;
}

function parsePreviewProcessReference(processId) {
  if (typeof processId !== "string" || !processId.startsWith("preview:")) {
    return null;
  }
  const parts = processId.split(":");
  if (parts.length < 5) return null;
  const systemId = parts[1] || null;
  const targetKind = parts[2] || null;
  const targetId = parts[3] || null;
  const recipeId = parts.slice(4).join(":") || null;
  if (!systemId || !targetKind || !targetId || !recipeId) return null;
  return { systemId, targetKind, targetId, recipeId };
}

function cloneRequirementEntries(requirements) {
  const list = Array.isArray(requirements) ? requirements : [];
  return list
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      amount: Math.max(0, Math.floor(entry.amount ?? 0)),
      progress: Math.max(0, Math.floor(entry.progress ?? 0)),
      consume: entry.consume !== false,
    }));
}

function ensureInventoryForProcessDropbox(state, processId) {
  const ownerId = getDropEndpointId(processId);
  if (!ownerId) return null;
  if (!state.ownerInventories || typeof state.ownerInventories !== "object") {
    state.ownerInventories = {};
  }
  if (!state.ownerInventories[ownerId]) {
    const inv = Inventory.create(8, 8);
    Inventory.init(inv);
    inv.version = 0;
    state.ownerInventories[ownerId] = inv;
  }
  return ownerId;
}

function ensureProcessForPreviewDropbox(state, previewProcessId) {
  const parsed = parsePreviewProcessReference(previewProcessId);
  if (!parsed) return null;

  const target =
    parsed.targetKind === "hub"
      ? findHubStructureById(state, parsed.targetId)
      : parsed.targetKind === "tile"
        ? findTileById(state, parsed.targetId)
        : null;
  if (!target) return null;

  const systemState = ensureHubSystemState(target, parsed.systemId);
  if (!systemState) return null;
  if (!Array.isArray(systemState.processes)) {
    systemState.processes = [];
  }
  const processes = systemState.processes;
  if (!Object.prototype.hasOwnProperty.call(systemState, "selectedRecipeId")) {
    systemState.selectedRecipeId = null;
  }
  if (systemState.selectedRecipeId !== parsed.recipeId) {
    systemState.selectedRecipeId = parsed.recipeId;
  }

  let process = processes.find((proc) => proc?.type === parsed.recipeId) || null;
  if (!process) {
    const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
    const durationSec = Number.isFinite(recipeDefs?.[parsed.recipeId]?.durationSec)
      ? Math.max(1, Math.floor(recipeDefs[parsed.recipeId].durationSec))
      : 1;
    process = {
      id: `proc_${target.instanceId}_${parsed.systemId}_${parsed.recipeId}_${nowSec}_${processes.length}`,
      type: parsed.recipeId,
      mode: "work",
      durationSec,
      progress: 0,
      startSec: nowSec,
      ownerId: target.instanceId ?? null,
      completionPolicy: "none",
    };
    const processDef = getProcessDefForInstance(process, target, {
      target,
      systemId: parsed.systemId,
      state,
      leaderId: process?.leaderId ?? null,
    });
    if (
      Array.isArray(processDef?.transform?.requirements) &&
      processDef.transform.requirements.length > 0
    ) {
      process.requirements = cloneRequirementEntries(
        processDef.transform.requirements
      );
    }
    processes.push(process);
  }

  const ownerId = ensureInventoryForProcessDropbox(state, process.id);
  if (!ownerId) return null;
  return { process, target, systemId: parsed.systemId, ownerId };
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

function hasEnabledStructureTag(structure, tagId) {
  if (!structure || !tagId) return false;
  const tags = Array.isArray(structure.tags) ? structure.tags : [];
  if (!tags.includes(tagId)) return false;
  const disabled = Array.isArray(structure.disabledTags) ? structure.disabledTags : [];
  return !disabled.includes(tagId);
}

function itemMatchesDepositRules(item, config) {
  if (!item || !config) return false;
  if (config.allowAny) return true;
  if (config.allowedItemIds.includes(item.kind)) return true;
  if (!config.allowedTags.length) return false;

  const itemTags = new Set();
  if (Array.isArray(item.tags)) {
    for (const tag of item.tags) {
      if (typeof tag === "string" && tag.length) itemTags.add(tag);
    }
  }
  const baseTags = Array.isArray(itemDefs?.[item.kind]?.baseTags)
    ? itemDefs[item.kind].baseTags
    : [];
  for (const tag of baseTags) {
    if (typeof tag === "string" && tag.length) itemTags.add(tag);
  }
  for (const tag of config.allowedTags) {
    if (itemTags.has(tag)) return true;
  }
  return false;
}

function resolveLeaderIdForContributor(state, ownerId, fallbackLeaderId = null) {
  const pawn = getPawnById(state, ownerId);
  if (pawn?.role === "leader") return pawn.id;
  if (pawn?.role === "follower" && pawn.leaderId != null) return pawn.leaderId;
  return fallbackLeaderId;
}

function addUnitsToStructureDepositPool(
  structure,
  systemId,
  poolKey,
  kind,
  tier,
  amount
) {
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
  if (isTierBucket(pool)) {
    pool[tier] = Math.max(0, Math.floor(pool[tier] ?? 0)) + amount;
  } else {
    if (!pool[kind] || typeof pool[kind] !== "object") {
      pool[kind] = {};
    }
    const bucket = pool[kind];
    bucket[tier] = Math.max(0, Math.floor(bucket[tier] ?? 0)) + amount;
  }
  sysState.totalByTier[tier] = Math.max(0, Math.floor(sysState.totalByTier[tier] ?? 0)) + amount;
  return true;
}

function ensureProcessRequirementsForDropbox(process, processDef) {
  if (!process || typeof process !== "object") return [];
  if (!Array.isArray(process.requirements)) {
    process.requirements = [];
  }
  if (
    process.requirements.length === 0 &&
    Array.isArray(processDef?.transform?.requirements) &&
    processDef.transform.requirements.length > 0
  ) {
    process.requirements = cloneRequirementEntries(processDef.transform.requirements);
  }
  for (const req of process.requirements) {
    if (!req || typeof req !== "object") continue;
    req.amount = Math.max(0, Math.floor(req.amount ?? 0));
    req.progress = Math.max(0, Math.floor(req.progress ?? 0));
    if (typeof req.consume !== "boolean") {
      req.consume = req.consume !== false;
    }
  }
  return process.requirements;
}

function recordProcessDropboxConsumption(process, item, moved) {
  const units = Math.max(0, Math.floor(moved ?? 0));
  if (!process || !item || units <= 0) return;
  const kind = typeof item.kind === "string" ? item.kind : null;
  if (!kind) return;
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
  consumedBucket[tier] = Math.max(0, Math.floor(consumedBucket[tier] ?? 0)) + units;

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
  prestigeBucket[tier] = Math.max(0, Math.floor(prestigeBucket[tier] ?? 0)) + units;
}

function applyDropboxUnitsToProcessRequirements(process, processDef, item, maxUnits) {
  const requested = Math.max(0, Math.floor(maxUnits ?? 0));
  if (!process || !item || requested <= 0) return 0;
  const reqs = ensureProcessRequirementsForDropbox(process, processDef);
  if (!reqs.length) return 0;
  const itemKind = typeof item.kind === "string" ? item.kind : null;
  if (!itemKind) return 0;

  let remaining = requested;
  let applied = 0;
  for (const req of reqs) {
    if (!req || typeof req !== "object") continue;
    if (req.kind !== "item") continue;
    if (req.consume === false) continue;
    if (req.itemId !== itemKind) continue;
    const amount = Math.max(0, Math.floor(req.amount ?? 0));
    const progress = Math.max(0, Math.floor(req.progress ?? 0));
    const deficit = Math.max(0, amount - progress);
    if (deficit <= 0) continue;
    const take = Math.min(deficit, remaining);
    if (take <= 0) continue;
    req.progress = progress + take;
    remaining -= take;
    applied += take;
    if (remaining <= 0) break;
  }

  if (applied > 0) {
    recordProcessDropboxConsumption(process, item, applied);
  }
  return applied;
}

function migrateBufferedDropboxItems(state, process, processDef, dropboxInv) {
  if (!state || !process || !dropboxInv || !Array.isArray(dropboxInv.items)) return false;
  let changed = false;
  for (const item of [...dropboxInv.items]) {
    if (!item) continue;
    const quantity = Math.max(0, Math.floor(item.quantity ?? 0));
    if (quantity <= 0) continue;
    const applied = applyDropboxUnitsToProcessRequirements(
      process,
      processDef,
      item,
      quantity
    );
    if (applied <= 0) continue;
    item.quantity = Math.max(0, quantity - applied);
    if (item.quantity <= 0) {
      Inventory.removeItem(dropboxInv, item.id);
    }
    changed = true;
  }
  if (changed) {
    Inventory.rebuildDerived(dropboxInv);
    bumpInvVersion(dropboxInv);
  }
  return changed;
}

function resolveProcessDropboxCapacity(state, toOwnerId, itemKind) {
  const processId = parseProcessIdFromDropboxOwner(toOwnerId);
  if (!processId) return { ok: false, reason: "badProcessOwner" };
  let found = findProcessById(state, processId);
  if ((!found?.process || !found?.target) && processId.startsWith("preview:")) {
    const ensured = ensureProcessForPreviewDropbox(state, processId);
    if (ensured?.process && ensured?.target) {
      found = {
        process: ensured.process,
        target: ensured.target,
        systemId: ensured.systemId,
      };
      if (ensured.ownerId) {
        toOwnerId = ensured.ownerId;
      }
    }
  }
  if (!found?.process || !found?.target) return { ok: false, reason: "noProcess" };
  const process = found.process;
  const processDef = getProcessDefForInstance(process, found.target, {
    target: found.target,
    systemId: found.systemId,
    state,
    leaderId: process?.leaderId ?? null,
  });
  const toInv = state?.ownerInventories?.[toOwnerId] ?? null;
  if (!toInv) return { ok: false, reason: "noInventory" };

  migrateBufferedDropboxItems(state, process, processDef, toInv);

  const reqs = ensureProcessRequirementsForDropbox(process, processDef);
  let remainingRequired = 0;
  for (const req of reqs) {
    if (!req || typeof req !== "object") continue;
    if (req.kind !== "item") continue;
    if (req.consume === false) continue;
    if (req.itemId !== itemKind) continue;
    const required = Math.max(0, Math.floor(req.amount ?? 0));
    const progress = Math.max(0, Math.floor(req.progress ?? 0));
    remainingRequired += Math.max(0, required - progress);
  }

  const cap = Math.max(0, remainingRequired);
  return {
    ok: true,
    process,
    processDef,
    target: found.target,
    systemId: found.systemId,
    processId,
    toInv,
    cap,
  };
}

function cmdInstantDepositFromDropbox(
  state,
  { fromOwnerId, toOwnerId, itemId } = {}
) {
  const fromInv = state?.ownerInventories?.[fromOwnerId];
  if (!fromInv) return { ok: false, reason: "noInventory" };
  const item = fromInv.itemsById?.[itemId] || fromInv.items?.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };
  const qty = Math.max(0, Math.floor(item.quantity ?? 0));
  if (qty <= 0) return { ok: false, reason: "emptyStack" };

  let processId = null;
  let structure = null;
  let fallbackLeaderId = null;
  if (isProcessDropboxOwner(toOwnerId)) {
    processId = parseProcessIdFromDropboxOwner(toOwnerId);
    if (!processId) return { ok: false, reason: "badProcessOwner" };
    const found = findProcessById(state, processId);
    if (!found?.process || !found?.target) return { ok: false, reason: "noProcess" };
    if (found.process.type !== "depositItems") {
      return { ok: false, reason: "notDepositProcess" };
    }
    structure = found.target;
    fallbackLeaderId = found.process?.leaderId ?? null;
  } else if (isHubDropboxOwner(toOwnerId)) {
    const structureId = parseHubStructureIdFromDropboxOwner(toOwnerId);
    if (!structureId) return { ok: false, reason: "badDropboxOwner" };
    structure = findHubStructureById(state, structureId);
    if (!structure) return { ok: false, reason: "noHubStructure" };
  } else {
    return { ok: false, reason: "badProcessOwner" };
  }

  const depositConfig = normalizeStructureDepositConfig(structure);
  if (!depositConfig) return { ok: false, reason: "noDepositConfig" };
  if (!depositConfig.instantDropboxLoad) {
    return { ok: false, reason: "instantDropboxDisabled" };
  }
  if (!itemMatchesDepositRules(item, depositConfig)) {
    return { ok: false, reason: "rejectedByDepositRules" };
  }

  const tier =
    typeof item.tier === "string" && item.tier.length
      ? item.tier
      : itemDefs?.[item.kind]?.defaultTier || "bronze";
  const isPrestiged = Array.isArray(item.tags) && item.tags.includes("prestiged");

  if (depositConfig.storeDeposits) {
    addUnitsToStructureDepositPool(
      structure,
      depositConfig.systemId,
      depositConfig.poolKey,
      item.kind,
      tier,
      qty
    );
  }

  const communal = hasEnabledStructureTag(structure, "communal");
  const leaderId = resolveLeaderIdForContributor(
    state,
    fromOwnerId,
    fallbackLeaderId
  );
  if (communal && leaderId != null && !isPrestiged) {
    const ledger = { [item.kind]: { [tier]: qty } };
    applyPrestigeDeposit(state, leaderId, structure, ledger, {
      curveMultiplier: depositConfig.prestigeCurveMultiplier,
    });
  }

  Inventory.removeItem(fromInv, item.id);
  Inventory.rebuildDerived(fromInv);
  bumpInvVersion(fromInv);

  return {
    ok: true,
    result: "instantDropboxLoaded",
    processId,
    structureId: structure?.instanceId ?? null,
    fromOwnerId,
    itemKind: item.kind,
    moved: qty,
    tier,
    leaderId: leaderId ?? null,
    prestigeApplied: communal && leaderId != null && !isPrestiged,
  };
}

function shouldInstantLoadIntoDropbox(state, toOwnerId) {
  if (isHubDropboxOwner(toOwnerId)) return true;
  if (!isProcessDropboxOwner(toOwnerId)) return false;
  const processId = parseProcessIdFromDropboxOwner(toOwnerId);
  if (!processId) return false;
  const found = findProcessById(state, processId);
  return found?.process?.type === "depositItems";
}

function cmdMoveItemIntoProcessDropbox(
  state,
  { fromOwnerId, toOwnerId, itemId, targetGX, targetGY } = {}
) {
  const fromInv = state?.ownerInventories?.[fromOwnerId];
  if (!fromInv) return { ok: false, reason: "noInventory" };
  const item = fromInv.itemsById?.[itemId] || fromInv.items?.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  const capRes = resolveProcessDropboxCapacity(state, toOwnerId, item.kind);
  if (!capRes.ok) return capRes;
  if (capRes.process?.type === "depositItems") {
    return { ok: false, reason: "invalidDropboxRoute" };
  }
  if (capRes.cap <= 0) {
    return { ok: false, reason: "dropboxRequirementCapReached" };
  }

  const available = Math.max(0, Math.floor(item.quantity ?? 0));
  const requested = Math.min(available, Math.max(0, Math.floor(capRes.cap ?? 0)));
  if (requested <= 0) {
    return { ok: false, reason: "dropboxRequirementCapReached" };
  }
  const applied = applyDropboxUnitsToProcessRequirements(
    capRes.process,
    capRes.processDef,
    item,
    requested
  );
  if (applied <= 0) {
    return { ok: false, reason: "dropboxRequirementCapReached" };
  }

  item.quantity = Math.max(0, available - applied);
  if (item.quantity <= 0) {
    Inventory.removeItem(fromInv, item.id);
  }
  Inventory.rebuildDerived(fromInv);
  bumpInvVersion(fromInv);

  return {
    ok: true,
    result: "dropboxLoaded",
    moved: applied,
    partial: applied < available,
    firstItemId: null,
  };
}

export function cmdMoveProcessDropboxItem(
  state,
  {
    fromOwnerId,
    toOwnerId,
    itemId,
    targetGX,
    targetGY,
    viaProcessDropbox = false,
  } = {}
) {
  if (fromOwnerId == null || toOwnerId == null) {
    return { ok: false, reason: "badOwner" };
  }
  if (!isAnyDropboxOwner(fromOwnerId) && !isAnyDropboxOwner(toOwnerId)) {
    return { ok: false, reason: "notProcessDropbox" };
  }
  if (
    viaProcessDropbox === true &&
    isAnyDropboxOwner(toOwnerId) &&
    !isAnyDropboxOwner(fromOwnerId) &&
    shouldInstantLoadIntoDropbox(state, toOwnerId)
  ) {
    return cmdInstantDepositFromDropbox(state, {
      fromOwnerId,
      toOwnerId,
      itemId,
    });
  }
  if (
    isProcessDropboxOwner(toOwnerId) &&
    !isAnyDropboxOwner(fromOwnerId)
  ) {
    return cmdMoveItemIntoProcessDropbox(state, {
      fromOwnerId,
      toOwnerId,
      itemId,
      targetGX,
      targetGY,
    });
  }
  return cmdMoveItemBetweenOwners(state, {
    fromOwnerId,
    toOwnerId,
    itemId,
    targetGX,
    targetGY,
  });
}

export function cmdEquipItemToLeaderSlot(
  state,
  { fromOwnerId, toOwnerId, itemId, slotId } = {}
) {
  if (!isLeaderEquipmentSlotId(slotId)) {
    return { ok: false, reason: "badSlot" };
  }

  const fromInv = state?.ownerInventories?.[fromOwnerId];
  if (!fromInv) return { ok: false, reason: "noInventory" };

  const leader = getLeaderByOwnerId(state, toOwnerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  ensureLeaderEquipment(leader);

  const item = fromInv.itemsById?.[itemId] || fromInv.items?.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };
  if (!canItemEquipInSlot(item, slotId)) {
    return { ok: false, reason: "slotMismatch" };
  }
  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  const current = leader.equipment[slotId] ?? null;
  if (current) return { ok: false, reason: "slotOccupied" };

  Inventory.removeItem(fromInv, item.id);
  Inventory.rebuildDerived(fromInv);
  bumpInvVersion(fromInv);

  leader.equipment[slotId] = item;
  if (itemProvidesPool(item, "storage", "byKindTier")) {
    ensurePortableStorageState(leader, item);
  }

  return {
    ok: true,
    result: "equipped",
    fromOwnerId,
    toOwnerId,
    itemId: item.id,
    slotId,
  };
}

export function cmdMoveLeaderEquipmentToInventory(
  state,
  { fromOwnerId, toOwnerId, slotId, targetGX, targetGY } = {}
) {
  if (!isLeaderEquipmentSlotId(slotId)) {
    return { ok: false, reason: "badSlot" };
  }

  const leader = getLeaderByOwnerId(state, fromOwnerId);
  if (!leader) return { ok: false, reason: "noLeader" };
  ensureLeaderEquipment(leader);

  const item = leader.equipment[slotId] ?? null;
  if (!item) return { ok: false, reason: "emptySlot" };

  const toInv = state?.ownerInventories?.[toOwnerId];
  if (!toInv) return { ok: false, reason: "noInventory" };
  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }
  if (isProcessDropboxOwner(toOwnerId)) {
    const capRes = resolveProcessDropboxCapacity(state, toOwnerId, item.kind);
    if (!capRes.ok) return capRes;
    if (capRes.process?.type !== "depositItems") {
      const qty = Math.max(0, Math.floor(item.quantity ?? 0));
      if (capRes.cap <= 0 || qty > capRes.cap) {
        return { ok: false, reason: "dropboxRequirementCapReached" };
      }
      const applied = applyDropboxUnitsToProcessRequirements(
        capRes.process,
        capRes.processDef,
        item,
        qty
      );
      if (applied !== qty) {
        return { ok: false, reason: "dropboxRequirementCapReached" };
      }
      leader.equipment[slotId] = null;
      return {
        ok: true,
        result: "dropboxLoaded",
        fromOwnerId,
        toOwnerId,
        itemId: item.id,
        slotId,
        moved: applied,
      };
    }
  }

  let gx = Number.isFinite(targetGX) ? Math.floor(targetGX) : null;
  let gy = Number.isFinite(targetGY) ? Math.floor(targetGY) : null;

  if (gx == null || gy == null) {
    let found = null;
    outer: for (let y = 0; y <= toInv.rows - item.height; y++) {
      for (let x = 0; x <= toInv.cols - item.width; x++) {
        if (Inventory.canPlaceItemAt(toInv, item, x, y)) {
          found = { gx: x, gy: y };
          break outer;
        }
      }
    }
    if (!found) return { ok: false, reason: "noSpace" };
    gx = found.gx;
    gy = found.gy;
  }

  const canPlace = Inventory.canPlaceItemAt(toInv, item, gx, gy);
  if (!canPlace) return { ok: false, reason: "blocked" };

  leader.equipment[slotId] = null;
  const attached = Inventory.attachExistingItem(toInv, item, gx, gy);
  if (!attached) {
    leader.equipment[slotId] = item;
    return { ok: false, reason: "attachFailed" };
  }

  Inventory.rebuildDerived(toInv);
  bumpInvVersion(toInv);

  return {
    ok: true,
    result: "unequipped",
    fromOwnerId,
    toOwnerId,
    itemId: item.id,
    slotId,
    gx,
    gy,
  };
}

export function cmdMoveLeaderEquipmentToSlot(
  state,
  { fromOwnerId, toOwnerId, fromSlotId, toSlotId } = {}
) {
  if (!isLeaderEquipmentSlotId(fromSlotId) || !isLeaderEquipmentSlotId(toSlotId)) {
    return { ok: false, reason: "badSlot" };
  }

  const fromLeader = getLeaderByOwnerId(state, fromOwnerId);
  const toLeader = getLeaderByOwnerId(state, toOwnerId);
  if (!fromLeader || !toLeader) return { ok: false, reason: "noLeader" };
  ensureLeaderEquipment(fromLeader);
  ensureLeaderEquipment(toLeader);

  if (fromOwnerId === toOwnerId && fromSlotId === toSlotId) {
    return { ok: true, result: "noChange" };
  }

  const item = fromLeader.equipment[fromSlotId] ?? null;
  if (!item) return { ok: false, reason: "emptySlot" };
  if (!canItemEquipInSlot(item, toSlotId)) {
    return { ok: false, reason: "slotMismatch" };
  }
  if (toLeader.equipment[toSlotId] != null) {
    return { ok: false, reason: "slotOccupied" };
  }
  if (!canOwnerAcceptItem(state, toOwnerId, item)) {
    return { ok: false, reason: "rejectedByOwner" };
  }

  fromLeader.equipment[fromSlotId] = null;
  toLeader.equipment[toSlotId] = item;
  if (itemProvidesPool(item, "storage", "byKindTier")) {
    ensurePortableStorageState(toLeader, item);
  }

  return {
    ok: true,
    result: "equippedMoved",
    fromOwnerId,
    toOwnerId,
    fromSlotId,
    toSlotId,
    itemId: item.id,
  };
}

export function cmdSplitStackAndPlace(state, ownerId, itemId, amount, targetGX, targetGY) {
  const inv = state.ownerInventories[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  const item = inv.itemsById[itemId] || inv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  const splitAmount = Math.floor(amount);
  if (splitAmount <= 0 || splitAmount >= item.quantity) {
    return { ok: false, reason: "badAmount" };
  }

  const ctx = { kind: "inventorySplit", state, events: [], out: null };

  runEffect(
    state,
    {
      op: "splitStack",
      ownerId,
      itemId,
      amount: splitAmount,
      targetGX,
      targetGY,
    },
    ctx
  );

  return ctx.out || { ok: false, reason: "effectFailed" };
}

export function cmdStackItemsInOwner(state, { ownerId, sourceItemId, targetItemId, amount }) {
  const inv = state.ownerInventories[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  const ctx = { kind: "inventoryStack", state, events: [], out: null };

  runEffect(
    state,
    {
      op: "stackItem",
      ownerId,
      sourceItemId,
      targetItemId,
      amount,
    },
    ctx
  );

  return ctx.out || { ok: false, reason: "effectFailed" };
}

export function cmdUseItem(
  state,
  { ownerId, itemId, sourceEquipmentSlotId = null } = {}
) {
  if (ownerId == null) return { ok: false, reason: "badOwner" };
  if (itemId == null) return { ok: false, reason: "badItem" };
  if (sourceEquipmentSlotId != null) {
    return { ok: false, reason: "equipmentUseUnsupported" };
  }

  const inv = state?.ownerInventories?.[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  Inventory.rebuildDerived(inv);
  const item = inv.itemsById[itemId] || inv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  const leaderPawn = getLeaderByOwnerId(state, ownerId);
  if (!leaderPawn) return { ok: false, reason: "notLeaderOwner" };

  const itemDef = itemDefs?.[item.kind] ?? null;
  if (!itemDef) return { ok: false, reason: "noItemDef" };
  const onUseRaw = itemDef.onUse;
  const onUseEffects = Array.isArray(onUseRaw)
    ? onUseRaw
    : onUseRaw && typeof onUseRaw === "object"
      ? [onUseRaw]
      : [];
  if (!onUseEffects.length) return { ok: false, reason: "noUsableEffect" };

  const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
  const changed = runEffect(state, onUseEffects, {
    kind: "item",
    state,
    source: item,
    item,
    inv,
    ownerId,
    pawn: leaderPawn,
    pawnId: leaderPawn.id,
    tSec: nowSec,
  });
  if (!changed) return { ok: false, reason: "itemUseNoChange" };

  return {
    ok: true,
    result: "itemUsed",
    ownerId,
    itemId: item.id,
    itemKind: item.kind,
    leaderPawnId: leaderPawn.id,
  };
}

export function cmdDiscardItemFromOwner(state, { ownerId, itemId } = {}) {
  if (ownerId == null) return { ok: false, reason: "badOwner" };
  if (itemId == null) return { ok: false, reason: "badItem" };

  const inv = state?.ownerInventories?.[ownerId];
  if (!inv) return { ok: false, reason: "noInventory" };

  Inventory.rebuildDerived(inv);
  const item = inv.itemsById[itemId] || inv.items.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: "noItem" };

  Inventory.removeItem(inv, item.id);
  Inventory.rebuildDerived(inv);
  bumpInvVersion(inv);

  return { ok: true, result: "discarded", ownerId, itemId };
}
