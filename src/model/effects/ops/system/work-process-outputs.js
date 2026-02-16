import { itemDefs } from "../../../../defs/gamepieces/item-defs.js";
import { TIER_ASC } from "../../core/tiers.js";
import { ensureSystemState } from "../../core/system-state.js";
import { handleSpawnItem } from "../game-ops.js";
import {
  listCandidateEndpoints,
  resolveEndpointTarget,
  addItemToInventory,
} from "../../../process-framework.js";
import { canOwnerAcceptItem } from "../../../commands.js";
import { applyPrestigeDeposit } from "../../../prestige-system.js";
import {
  resolveSlotDef,
  resolveSlotState,
  resolveEndpointIdForRouting,
  isEndpointValidForSlot,
  ensureTierBucket,
  isTierBucket,
} from "./work-process-routing.js";

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

function cloneSerializable(value) {
  if (value == null) return null;
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (_) {
    // ignore and fall through
  }
  return JSON.parse(JSON.stringify(value));
}

function buildOutputItemState(output, state) {
  const rawState =
    output?.itemState && typeof output.itemState === "object"
      ? cloneSerializable(output.itemState)
      : null;
  if (!rawState) return null;
  const graphState = rawState.timegraph;
  if (
    graphState &&
    typeof graphState === "object" &&
    graphState.requiresManufacturedSec === true
  ) {
    graphState.manufacturedSec = Math.max(0, Math.floor(state?.tSec ?? 0));
  }
  return rawState;
}

function tryApplyOutputUnit(state, process, output, endpoint, context) {
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
      const outputItemState = buildOutputItemState(output, state);
      const added = addItemToInventory(
        state,
        endpoint.target,
        output.itemId,
        1,
        output.tier,
        outputItemState
          ? {
              systemState: outputItemState,
            }
          : null
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
  const curveMultiplier =
    Number.isFinite(output?.curveMultiplier) && output.curveMultiplier > 0
      ? output.curveMultiplier
      : 1;
  const ledger =
    process?.prestigeConsumedByKindTier &&
    typeof process.prestigeConsumedByKindTier === "object"
      ? process.prestigeConsumedByKindTier
      : process?.consumedByKindTier && typeof process.consumedByKindTier === "object"
        ? process.consumedByKindTier
      : null;
  if (ledger && Object.keys(ledger).length > 0) {
    return applyPrestigeDeposit(state, leaderId, target, ledger, {
      curveMultiplier,
    });
  }
  const qty = Math.max(0, Math.floor(output?.qty ?? 0));
  if (qty <= 0) return false;
  const fallback = { prestige: { bronze: qty } };
  return applyPrestigeDeposit(state, leaderId, target, fallback, {
    curveMultiplier,
  });
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

export function applyProcessOutputs(state, target, process, processDef, context) {
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
        if (!tryApplyOutputUnit(state, process, output, endpoint, context)) {
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
