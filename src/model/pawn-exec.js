// pawn-exec.js
// Per-second pawn intent execution.

import { pawnDefs } from "../defs/gamepieces/pawn-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { LEADER_EQUIPMENT_SLOT_ORDER } from "../defs/gamesystems/equipment-slot-defs.js";
import {
  PAWN_AI_HUNGER_WARNING,
  PAWN_AI_HUNGER_FULL,
  PAWN_AI_HUNGER_START_EAT,
  PAWN_AI_STAMINA_WARNING,
  PAWN_AI_STAMINA_FULL,
  PAWN_AI_STAMINA_START_REST,
  LEADER_FAITH_HUNGER_DECAY_THRESHOLD,
} from "../defs/gamesettings/gamerules-defs.js";
import { runEffect } from "./effects/index.js";
import { resolveCosts, canAffordCosts, applyCosts } from "./costs.js";
import { ensurePawnSystems, ensurePawnAI, syncPhaseToPaused } from "./state.js";
import {
  applyFollowerHungerDebt,
  ensureLeaderFaithFields,
  applyLeaderFaithEatSuccess,
  resetLeaderFaithEatStreak,
  resetLeaderFaithDecayTimer,
  accumulateLeaderFaithDecaySecond,
  applyLeaderFaithDecayTick,
  eliminateLeaderByFaithCollapse,
  getLeaderCount,
  getPawnEffectiveWorkUnits,
  consumeWorkerMealsAfterLeaderEat,
} from "./prestige-system.js";
import { pushGameEvent } from "./event-feed.js";
import { passiveTimingPasses } from "./passive-timing.js";
import { hasEnvTagUnlock, hasHubTagUnlock } from "./skills.js";
import {
  findEquippedPoolProviderEntry,
  ownerHasEquippedPoolProvider,
} from "./item-def-rules.js";
import { isTagHidden } from "./tag-state.js";

const HUB_DISTRIBUTOR_TAG = "distributor";
const REST_SPOT_AFFORDANCE = "restSpot";
const NO_OCCUPY_AFFORDANCE = "noOccupy";
const LOCATION_ROW_SWITCH_COST = 1;

function requirementsPass(requires, pawn, options = {}) {
  if (!requires || typeof requires !== "object") return true;
  if (Number.isFinite(requires.hungerAtMost)) {
    const cur = pawn?.systemState?.hunger?.cur;
    if (!Number.isFinite(cur) || cur > requires.hungerAtMost) return false;
  }
  if (typeof requires.idle === "boolean") {
    const isIdle = options.idle === true;
    if (requires.idle !== isIdle) return false;
  }
  return true;
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

function isTagDisabled(target, tagId, isTagUnlocked = null) {
  if (!target || !tagId) return false;
  if (isTagUnlocked && !isTagUnlocked(tagId)) return true;
  if (isTagHidden(target, tagId)) return true;
  const entry = target.tagStates?.[tagId];
  return entry?.disabled === true;
}

function hasAffordance(def, affordance) {
  const affordances = Array.isArray(def?.affordances) ? def.affordances : [];
  return affordances.includes(affordance);
}

function normalizeLocation(location) {
  const hubCol = Number.isFinite(location?.hubCol) ? Math.floor(location.hubCol) : null;
  const envCol = Number.isFinite(location?.envCol) ? Math.floor(location.envCol) : null;
  if (hubCol != null) return { hubCol, envCol: null };
  if (envCol != null) return { hubCol: null, envCol };
  return { hubCol: null, envCol: null };
}

function getPawnLocation(pawn) {
  return normalizeLocation(pawn);
}

function getLocationColumn(location) {
  const loc = normalizeLocation(location);
  if (loc.hubCol != null) return loc.hubCol;
  if (loc.envCol != null) return loc.envCol;
  return 0;
}

function locationsMatch(a, b) {
  const left = normalizeLocation(a);
  const right = normalizeLocation(b);
  if (left.hubCol != null || right.hubCol != null) {
    return left.hubCol != null && right.hubCol != null && left.hubCol === right.hubCol;
  }
  if (left.envCol != null || right.envCol != null) {
    return left.envCol != null && right.envCol != null && left.envCol === right.envCol;
  }
  return true;
}

function placementToLocation(placement) {
  if (placement?.kind === "hub") {
    return { hubCol: Number.isFinite(placement.col) ? Math.floor(placement.col) : null, envCol: null };
  }
  if (placement?.kind === "env") {
    return { hubCol: null, envCol: Number.isFinite(placement.col) ? Math.floor(placement.col) : null };
  }
  return { hubCol: null, envCol: null };
}

function locationToPlacement(location) {
  const normalized = normalizeLocation(location);
  return {
    hubCol: normalized.hubCol,
    envCol: normalized.envCol,
  };
}

function getAssignedPlacement(pawn) {
  ensurePawnAI(pawn);
  return normalizeLocation(pawn?.ai?.assignedPlacement);
}

function getPawnReturnState(pawn) {
  const value = pawn?.ai?.returnState;
  if (
    value === "waitingForEat" ||
    value === "waitingForRest" ||
    value === "ready"
  ) {
    return value;
  }
  return "none";
}

function setPawnReturnState(pawn, returnState) {
  ensurePawnAI(pawn);
  pawn.ai.returnState =
    returnState === "waitingForEat" ||
    returnState === "waitingForRest" ||
    returnState === "ready"
      ? returnState
      : "none";
}

function scorePlacement(currentLocation, placement) {
  const targetLocation = placementToLocation(placement);
  const dist = Math.abs(
    getLocationColumn(targetLocation) - getLocationColumn(currentLocation)
  );
  const current = normalizeLocation(currentLocation);
  const target = normalizeLocation(targetLocation);
  const rowSwitch =
    (current.hubCol != null && target.envCol != null) ||
    (current.envCol != null && target.hubCol != null)
      ? LOCATION_ROW_SWITCH_COST
      : 0;
  return {
    total: dist + rowSwitch,
    dist,
    rowSwitch,
  };
}

function itemPassiveRequirementsPass(requires, ctx = {}) {
  if (!requires || typeof requires !== "object") return true;
  if (typeof requires.equipped === "boolean") {
    const isEquipped = ctx?.equipped === true;
    if (requires.equipped !== isEquipped) return false;
  }
  return true;
}

function listEquippedBasketPoolsForPawn(state, pawn, locationOverride = null) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const out = [];
  const location = normalizeLocation(locationOverride ?? pawn);
  let order = 0;
  for (const carrier of pawns) {
    if (!carrier || carrier.id == null) continue;
    if (!locationsMatch(location, getPawnLocation(carrier))) continue;
    if (!ownerHasEquippedPoolProvider(carrier, "storage", "byKindTier")) {
      continue;
    }
    const providerEntry = findEquippedPoolProviderEntry(
      carrier,
      "storage",
      "byKindTier"
    );
    const store =
      providerEntry?.item?.systemState?.storage &&
      typeof providerEntry.item.systemState.storage === "object"
        ? providerEntry.item.systemState.storage
        : carrier?.systemState?.basketStore &&
            typeof carrier.systemState.basketStore === "object"
          ? carrier.systemState.basketStore
          : null;
    if (!store || typeof store !== "object") continue;
    const pool = store.byKindTier;
    if (!pool || typeof pool !== "object") continue;
    out.push({
      pool,
      totalByTier:
        store.totalByTier && typeof store.totalByTier === "object"
          ? store.totalByTier
          : null,
      systemId: "storage",
      poolKey: "byKindTier",
      dist: 0,
      anchorIndex: -1000 + order,
      instanceId: carrier.id ?? 0,
    });
    order += 1;
  }
  return out;
}

function listDistributorPoolsForPawn(state, pawn, locationOverride = null) {
  const location = normalizeLocation(locationOverride ?? pawn);
  const hubCol = location.hubCol;
  const basketPools = listEquippedBasketPoolsForPawn(state, pawn, location);
  if (hubCol == null) return basketPools;

  const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  const sources = [];
  const baseRange = 1;

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (!anchor) continue;
    const tags = Array.isArray(anchor.tags) ? anchor.tags : [];
    if (
      !tags.includes(HUB_DISTRIBUTOR_TAG) ||
      isTagDisabled(anchor, HUB_DISTRIBUTOR_TAG, (tagId) => hasHubTagUnlock(state, tagId))
    ) {
      continue;
    }

    const def = hubStructureDefs?.[anchor.defId];
    const deposit = def?.deposit;
    if (!deposit || typeof deposit !== "object") continue;
    const systemId =
      typeof deposit.systemId === "string" ? deposit.systemId : null;
    if (!systemId) continue;
    const poolKey =
      typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
        ? deposit.poolKey
        : "byKindTier";

    const systemState = anchor.systemState?.[systemId];
    if (!systemState || typeof systemState !== "object") continue;
    const pool = systemState[poolKey];
    if (!pool || typeof pool !== "object") continue;

    const col = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : null;
    const span = Number.isFinite(anchor.span) ? Math.floor(anchor.span) : 1;
    if (col == null) continue;

    const dist = spanDistance(hubCol, 1, col, span);
    const effectiveRange = resolveDistributorRange(anchor, baseRange);
    if (dist > effectiveRange) continue;

    sources.push({
      pool,
      totalByTier:
        systemState.totalByTier && typeof systemState.totalByTier === "object"
          ? systemState.totalByTier
          : null,
      systemId,
      poolKey,
      dist,
      anchorIndex: i,
      instanceId: anchor.instanceId ?? 0,
    });
  }

  sources.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.anchorIndex !== b.anchorIndex) return a.anchorIndex - b.anchorIndex;
    if (a.instanceId !== b.instanceId) return a.instanceId - b.instanceId;
    return 0;
  });

  return basketPools.concat(sources);
}

function listLocalAccessibleInventoriesForPawn(state, locationOverride = null) {
  const location = normalizeLocation(locationOverride);
  const out = [];
  if (location.hubCol != null) {
    const structure = state?.hub?.occ?.[location.hubCol] ?? null;
    const ownerId = structure?.instanceId;
    if (ownerId != null) {
      const inv = state?.ownerInventories?.[ownerId] ?? null;
      if (inv) {
        out.push({
          ownerId,
          inv,
        });
      }
    }
  }
  out.sort((a, b) => (a.ownerId ?? 0) - (b.ownerId ?? 0));
  return out;
}

function buildPawnContext(state, pawn, tSec, locationOverride = null) {
  const pawnInv = state?.ownerInventories?.[pawn.id] ?? null;
  const distributorPools = listDistributorPoolsForPawn(
    state,
    pawn,
    locationOverride
  );
  const localInventories = listLocalAccessibleInventoriesForPawn(
    state,
    locationOverride ?? pawn
  );
  return {
    kind: "game",
    state,
    source: pawn,
    tSec,
    pawnId: pawn.id,
    ownerId: pawn.id,
    pawn,
    pawnInv,
    distributorPools,
    localInventories,
  };
}

function getPawnLabel(pawn) {
  if (!pawn) return "Pawn";
  return pawn.name || `Pawn ${pawn.id ?? ""}`.trim();
}

function itemHasTagByKind(kind, tagId) {
  if (!kind || !tagId) return false;
  const tags = Array.isArray(itemDefs?.[kind]?.baseTags)
    ? itemDefs[kind].baseTags
    : [];
  return tags.includes(tagId);
}

function chooseArticle(noun) {
  if (!noun || typeof noun !== "string") return "a";
  return /^[aeiou]/i.test(noun.trim()) ? "an" : "a";
}

function getItemLabel(kind) {
  if (!kind) return "food";
  const raw = itemDefs?.[kind]?.name || kind;
  return String(raw).trim().toLowerCase() || "food";
}

function getEquippedItemsInOrder(pawn) {
  const equipment =
    pawn?.equipment && typeof pawn.equipment === "object" ? pawn.equipment : null;
  if (!equipment) return [];
  const entries = [];
  for (const slotId of LEADER_EQUIPMENT_SLOT_ORDER) {
    const item = equipment[slotId];
    if (!item || typeof item !== "object") continue;
    entries.push({ slotId, item });
  }
  return entries;
}

function buildEquippedItemPassiveKey(pawn, slotId, item, passive, passiveIndex) {
  const passiveId =
    typeof passive?.id === "string" && passive.id.length > 0
      ? passive.id
      : `idx${passiveIndex}`;
  const pawnId = pawn?.id ?? "unknown";
  const itemKey = item?.id != null ? item.id : item?.kind ?? "unknown";
  return `pawn:${pawnId}:slot:${slotId}:item:${itemKey}:passive:${passiveId}`;
}

function buildPawnDefPassiveKey(pawn, passive, passiveIndex) {
  const passiveId =
    typeof passive?.id === "string" && passive.id.length > 0
      ? passive.id
      : `idx${passiveIndex}`;
  const pawnId = pawn?.id ?? "unknown";
  return `pawn:${pawnId}:defPassive:${passiveId}`;
}

function passiveRequiresResolvedIdle(passive) {
  return typeof passive?.requires?.idle === "boolean";
}

function runPawnDefPassives(
  state,
  pawn,
  passives,
  tSec,
  context,
  { idle = null, requireResolvedIdle = false } = {}
) {
  for (let passiveIndex = 0; passiveIndex < passives.length; passiveIndex++) {
    const passive = passives[passiveIndex];
    if (!passive || typeof passive !== "object") continue;
    if (passiveRequiresResolvedIdle(passive) !== requireResolvedIdle) continue;

    const passiveKey = buildPawnDefPassiveKey(pawn, passive, passiveIndex);
    const requirementsOk = requirementsPass(passive.requires, pawn, {
      idle: requireResolvedIdle ? idle === true : null,
    });
    if (!requirementsOk) {
      passiveTimingPasses(passive.timing, state, tSec, {
        passiveKey,
        isActive: false,
      });
      continue;
    }
    if (
      !passiveTimingPasses(passive.timing, state, tSec, {
        passiveKey,
        isActive: true,
      })
    ) {
      continue;
    }
    if (passive.effect) {
      runEffect(state, passive.effect, { ...context });
    }
  }
}

function runEquippedItemPassives(state, pawn, tSec, baseContext) {
  const equipped = getEquippedItemsInOrder(pawn);
  if (!equipped.length) return;

  for (const entry of equipped) {
    const item = entry.item;
    const itemDef = itemDefs[item.kind];
    const passives = Array.isArray(itemDef?.passives) ? itemDef.passives : [];
    if (!passives.length) continue;

    const itemContext = {
      ...baseContext,
      source: item,
      item,
      equippedItem: item,
      equippedSlotId: entry.slotId,
    };

    for (let passiveIndex = 0; passiveIndex < passives.length; passiveIndex++) {
      const passive = passives[passiveIndex];
      if (!passive || typeof passive !== "object") continue;
      const passiveKey = buildEquippedItemPassiveKey(
        pawn,
        entry.slotId,
        item,
        passive,
        passiveIndex
      );
      const requirementsOk = itemPassiveRequirementsPass(passive.requires, {
        equipped: true,
      });
      if (!requirementsOk) {
        passiveTimingPasses(passive.timing, state, tSec, {
          passiveKey,
          isActive: false,
        });
        continue;
      }
      if (
        !passiveTimingPasses(passive.timing, state, tSec, {
          passiveKey,
          isActive: true,
        })
      ) {
        continue;
      }
      if (passive.effect) {
        runEffect(state, passive.effect, { ...itemContext });
      }
    }
  }
}

function snapshotEdibleInventory(inv) {
  const byKind = new Map();
  if (!Array.isArray(inv?.items)) return byKind;
  for (const item of inv.items) {
    if (!item || !item.kind) continue;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (!tags.includes("edible") && !itemHasTagByKind(item.kind, "edible")) {
      continue;
    }
    const qty = Math.max(0, Math.floor(item.quantity ?? 0));
    if (qty <= 0) continue;
    const prev = byKind.get(item.kind) || 0;
    byKind.set(item.kind, prev + qty);
  }
  return byKind;
}

function snapshotEdibleDistributorPools(distributorPools) {
  const byKind = new Map();
  const pools = Array.isArray(distributorPools) ? distributorPools : [];
  for (const entry of pools) {
    const pool = entry?.pool;
    if (!pool || typeof pool !== "object") continue;
    for (const [kind, tiers] of Object.entries(pool)) {
      if (!itemHasTagByKind(kind, "edible")) continue;
      if (!tiers || typeof tiers !== "object") continue;
      let total = 0;
      for (const qtyRaw of Object.values(tiers)) {
        const qty = Math.max(0, Math.floor(qtyRaw ?? 0));
        total += qty;
      }
      if (total <= 0) continue;
      byKind.set(kind, (byKind.get(kind) || 0) + total);
    }
  }
  return byKind;
}

function snapshotEdibleLocalInventories(localInventories) {
  const byKind = new Map();
  const entries = Array.isArray(localInventories) ? localInventories : [];
  for (const entry of entries) {
    const inv = entry?.inv;
    if (!Array.isArray(inv?.items)) continue;
    for (const item of inv.items) {
      if (!item || !item.kind) continue;
      const tags = Array.isArray(item.tags) ? item.tags : [];
      if (!tags.includes("edible") && !itemHasTagByKind(item.kind, "edible")) {
        continue;
      }
      const qty = Math.max(0, Math.floor(item.quantity ?? 0));
      if (qty <= 0) continue;
      byKind.set(item.kind, (byKind.get(item.kind) || 0) + qty);
    }
  }
  return byKind;
}

function findConsumedKind(before, after) {
  const keys = new Set([
    ...Array.from(before?.keys?.() || []),
    ...Array.from(after?.keys?.() || []),
  ]);
  let bestKind = null;
  let bestDrop = 0;
  for (const kind of keys) {
    const prev = before?.get?.(kind) || 0;
    const next = after?.get?.(kind) || 0;
    const drop = prev - next;
    if (drop <= 0) continue;
    if (drop > bestDrop) {
      bestDrop = drop;
      bestKind = kind;
    }
  }
  return bestKind;
}

function findIntentById(intents, intentId) {
  const list = Array.isArray(intents) ? intents : [];
  for (const intent of list) {
    if (!intent || typeof intent !== "object") continue;
    if (intent.id === intentId) return intent;
  }
  return null;
}

function canExecuteIntent(intent, pawn, context, options = {}) {
  if (!intent || typeof intent !== "object") return false;
  if (options.ignoreRequires !== true) {
    if (intent.requires && !requirementsPass(intent.requires, pawn)) return false;
  }
  if (intent.cost) {
    const resolved = resolveCosts(intent.cost, context);
    if (!resolved) return false;
    if (!canAffordCosts(resolved, context)) return false;
  }
  return true;
}

function executeIntent(state, intent, pawn, context, options = {}) {
  if (!intent || typeof intent !== "object") return false;
  if (options.ignoreRequires !== true) {
    if (intent.requires && !requirementsPass(intent.requires, pawn)) return false;
  }
  if (intent.cost) {
    const resolved = resolveCosts(intent.cost, context);
    if (!resolved) return false;
    if (!canAffordCosts(resolved, context)) return false;
    applyCosts(resolved, context);
  }
  if (intent.effect) {
    runEffect(state, intent.effect, { ...context });
  }
  return true;
}

function executeIntentsForPawnSecond(state, pawn, context, intentsToRun) {
  const repeatLimit = Math.max(1, getPawnEffectiveWorkUnits(state, pawn));
  let executed = false;
  let lastIntentId = null;

  for (let iteration = 0; iteration < repeatLimit; iteration++) {
    const iterContext = buildPawnContext(state, pawn, context?.tSec);
    let executedThisIteration = false;

    for (const intent of intentsToRun) {
      if (!intent || typeof intent !== "object") continue;
      if (iteration > 0 && intent.repeatByActorWorkUnits !== true) continue;
      const ignoreRequires = pawn.ai.mode === "eat" && intent.id === "eat";
      if (!executeIntent(state, intent, pawn, iterContext, { ignoreRequires })) {
        continue;
      }
      executed = true;
      executedThisIteration = true;
      lastIntentId =
        typeof intent.id === "string" && intent.id.length > 0 ? intent.id : null;
      break;
    }

    if (!executedThisIteration) break;
  }

  return { executed, executedIntentId: lastIntentId };
}

function getIntentsForMode(intents, mode) {
  const list = Array.isArray(intents) ? intents : [];
  if (mode === "eat") {
    return list.filter((intent) => intent?.id === "eat");
  }
  if (mode === "rest") {
    return list.filter((intent) => intent?.id === "rest");
  }
  return list;
}

function clampInt(value, min, max, fallback = min) {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

function getSystemCur(pawn, systemId, fallback = 0) {
  const value = pawn?.systemState?.[systemId]?.cur;
  if (!Number.isFinite(value)) return fallback;
  return Math.floor(value);
}

function getSystemMax(pawn, systemId, fallback = 100) {
  const value = pawn?.systemState?.[systemId]?.max;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function updatePawnAiMode(pawn) {
  ensurePawnAI(pawn);
  let mode = pawn.ai.mode;

  const hungerCur = getSystemCur(pawn, "hunger", 0);
  const hungerMax = getSystemMax(pawn, "hunger", 100);
  const hungerStartEat = clampInt(PAWN_AI_HUNGER_START_EAT, 0, hungerMax, 0);
  const hungerFull = clampInt(PAWN_AI_HUNGER_FULL, hungerStartEat, hungerMax, hungerMax);

  const staminaCur = getSystemCur(pawn, "stamina", 0);
  const staminaMax = getSystemMax(pawn, "stamina", 100);
  const staminaStartRest = clampInt(PAWN_AI_STAMINA_START_REST, 0, staminaMax, 0);
  const staminaFull = clampInt(PAWN_AI_STAMINA_FULL, staminaStartRest, staminaMax, staminaMax);

  if (mode === "eat" && hungerCur >= hungerFull) {
    mode = null;
  } else if (mode === "rest" && staminaCur >= staminaFull) {
    mode = null;
  }

  if (mode == null) {
    const wantsEat = hungerCur <= hungerStartEat;
    const wantsRest = staminaCur <= staminaStartRest;
    if (wantsEat) {
      mode = "eat";
    } else if (wantsRest) {
      mode = "rest";
    }
  }

  pawn.ai.mode = mode;
  return mode;
}

function shouldFallbackToRestWhenEatFails(pawn) {
  const staminaMax = getSystemMax(pawn, "stamina", 100);
  const staminaStartRest = clampInt(
    PAWN_AI_STAMINA_START_REST,
    0,
    staminaMax,
    0
  );
  const staminaCur = getSystemCur(pawn, "stamina", 0);
  return staminaCur <= staminaStartRest;
}

function isPawnAiSuppressed(pawn, tSec) {
  const nowSec = Number.isFinite(tSec) ? Math.floor(tSec) : 0;
  const suppressUntil = Number.isFinite(pawn?.ai?.suppressAutoUntilSec)
    ? Math.floor(pawn.ai.suppressAutoUntilSec)
    : 0;
  return nowSec < suppressUntil;
}

function isEnvColOccupiable(state, envCol) {
  if (!Number.isFinite(envCol)) return false;
  const col = Math.floor(envCol);
  const tile = state?.board?.occ?.tile?.[col] ?? null;
  if (!tile) return false;
  const tags = Array.isArray(tile.tags) ? tile.tags : [];
  for (const tagId of tags) {
    if (isTagDisabled(tile, tagId, (id) => hasEnvTagUnlock(state, id))) continue;
    if (hasAffordance(envTagDefs?.[tagId], NO_OCCUPY_AFFORDANCE)) {
      return false;
    }
  }
  return true;
}

function isAssignedPlacementStructurallyValid(state, placement) {
  const normalized = normalizeLocation(placement);
  if (normalized.hubCol != null) {
    const hubCols = Array.isArray(state?.hub?.slots) ? state.hub.slots.length : 0;
    return normalized.hubCol >= 0 && normalized.hubCol < hubCols;
  }
  if (normalized.envCol != null) {
    return isEnvColOccupiable(state, normalized.envCol);
  }
  return false;
}

function reseedAssignedPlacementToCurrentLocation(pawn) {
  ensurePawnAI(pawn);
  pawn.ai.assignedPlacement = locationToPlacement(getPawnLocation(pawn));
  pawn.ai.returnState = "none";
}

function ensureAssignedPlacementState(state, pawn) {
  const assignedPlacement = getAssignedPlacement(pawn);
  if (!isAssignedPlacementStructurallyValid(state, assignedPlacement)) {
    reseedAssignedPlacementToCurrentLocation(pawn);
    return getAssignedPlacement(pawn);
  }
  if (locationsMatch(getPawnLocation(pawn), assignedPlacement)) {
    setPawnReturnState(pawn, "none");
  }
  return assignedPlacement;
}

function listSeekPlacements(state) {
  const out = [];
  const envCols = Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 0;
  for (let col = 0; col < envCols; col++) {
    if (!isEnvColOccupiable(state, col)) continue;
    out.push({ kind: "env", col });
  }

  const hubCols = Array.isArray(state?.hub?.slots) ? state.hub.slots.length : 0;
  for (let col = 0; col < hubCols; col++) {
    out.push({ kind: "hub", col });
  }

  return out;
}

function isRestSpotAtLocation(state, location) {
  const loc = normalizeLocation(location);
  if (loc.hubCol != null) {
    const structure = state?.hub?.occ?.[loc.hubCol] ?? null;
    if (!structure) return false;
    const tags = Array.isArray(structure.tags) ? structure.tags : [];
    for (const tagId of tags) {
      if (isTagDisabled(structure, tagId, (id) => hasHubTagUnlock(state, id))) continue;
      if (hasAffordance(hubTagDefs?.[tagId], REST_SPOT_AFFORDANCE)) {
        return true;
      }
    }
    return false;
  }

  if (loc.envCol != null) {
    const tile = state?.board?.occ?.tile?.[loc.envCol] ?? null;
    if (!tile) return false;
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    for (const tagId of tags) {
      if (isTagDisabled(tile, tagId, (id) => hasEnvTagUnlock(state, id))) continue;
      if (hasAffordance(envTagDefs?.[tagId], REST_SPOT_AFFORDANCE)) {
        return true;
      }
    }
  }

  return false;
}

function sortScoredPlacements(scored) {
  scored.sort((a, b) => {
    if (a.total !== b.total) return a.total - b.total;
    if (a.rowSwitch !== b.rowSwitch) return a.rowSwitch - b.rowSwitch;
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.placement.kind !== b.placement.kind) {
      return a.placement.kind === "hub" ? -1 : 1;
    }
    return a.placement.col - b.placement.col;
  });
}

function findEatMoveCandidates(state, pawn, tSec, eatIntent) {
  if (!eatIntent) return [];
  const currentLocation = getPawnLocation(pawn);
  const candidates = [];

  for (const placement of listSeekPlacements(state)) {
    const targetLocation = placementToLocation(placement);
    if (locationsMatch(currentLocation, targetLocation)) continue;
    const ctx = buildPawnContext(state, pawn, tSec, targetLocation);
    if (!canExecuteIntent(eatIntent, pawn, ctx, { ignoreRequires: true })) continue;
    candidates.push({ placement, ...scorePlacement(currentLocation, placement) });
  }

  sortScoredPlacements(candidates);
  return candidates.map((entry) => entry.placement);
}

function findRestMoveCandidates(state, pawn) {
  const currentLocation = getPawnLocation(pawn);
  const candidates = [];

  for (const placement of listSeekPlacements(state)) {
    const targetLocation = placementToLocation(placement);
    if (locationsMatch(currentLocation, targetLocation)) continue;
    if (!isRestSpotAtLocation(state, targetLocation)) continue;
    candidates.push({ placement, ...scorePlacement(currentLocation, placement) });
  }

  sortScoredPlacements(candidates);
  return candidates.map((entry) => entry.placement);
}

function tryMovePawnViaCommand(state, pawn, placement, placePawn) {
  if (typeof placePawn !== "function") return false;
  if (!placement || !Number.isFinite(placement.col)) return false;

  const toPlacement =
    placement.kind === "env"
      ? { envCol: Math.floor(placement.col) }
      : { hubCol: Math.floor(placement.col) };

  const res = placePawn(state, {
    pawnId: pawn.id,
    toPlacement,
    skipAutoSuppress: true,
    skipAssignedPlacementUpdate: true,
  });
  return res?.ok === true;
}

function tryReturnPawnToAssignedPlacement(state, pawn, placePawn) {
  if (typeof placePawn !== "function") return false;
  const assignedPlacement = ensureAssignedPlacementState(state, pawn);
  if (!isAssignedPlacementStructurallyValid(state, assignedPlacement)) {
    reseedAssignedPlacementToCurrentLocation(pawn);
    return false;
  }
  if (locationsMatch(getPawnLocation(pawn), assignedPlacement)) {
    setPawnReturnState(pawn, "none");
    return false;
  }
  const res = placePawn(state, {
    pawnId: pawn.id,
    toPlacement: locationToPlacement(assignedPlacement),
    skipAutoSuppress: true,
    skipAssignedPlacementUpdate: true,
  });
  if (res?.ok === true) {
    setPawnReturnState(pawn, "none");
    return true;
  }
  return false;
}

function getPlacementLabel(state, placement) {
  if (!placement || !Number.isFinite(placement.col)) return "unknown";
  const col = Math.floor(placement.col);
  if (placement.kind === "hub") {
    const structure = state?.hub?.occ?.[col] ?? null;
    const defName = structure?.defId ? hubStructureDefs?.[structure.defId]?.name : null;
    if (typeof defName === "string" && defName.length > 0) {
      return `${defName} (hub ${col})`;
    }
    return `hub ${col}`;
  }

  if (placement.kind === "env") {
    const tile = state?.board?.occ?.tile?.[col] ?? null;
    const defName = tile?.defId ? envTileDefs?.[tile.defId]?.name : null;
    if (typeof defName === "string" && defName.length > 0) {
      return `${defName} (env ${col})`;
    }
    return `env ${col}`;
  }

  return `col ${col}`;
}

function pushPawnSeekMoveEvent(state, pawn, tSec, mode, placement) {
  const destination = getPlacementLabel(state, placement);
  const isRest = mode === "rest";
  pushGameEvent(state, {
    type: isRest ? "pawnMovedToRest" : "pawnMovedToFood",
    tSec,
    text: isRest
      ? `${getPawnLabel(pawn)} moved to ${destination} to rest`
      : `${getPawnLabel(pawn)} moved to ${destination} to find food`,
    data: {
      focusKind: "pawn",
      pawnId: pawn.id ?? null,
      ownerIds: pawn.id != null ? [pawn.id] : [],
      mode: isRest ? "rest" : "eat",
      destinationKind: placement?.kind ?? null,
      destinationCol: Number.isFinite(placement?.col)
        ? Math.floor(placement.col)
        : null,
    },
  });
}

export function stepPawnSecond(state, tSec, options = {}) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns.slice() : [];
  if (!pawns.length) return;

  const placePawn =
    typeof options?.placePawn === "function"
      ? options.placePawn
      : null;
  const pendingLeaderEliminations = new Map();
  let latestLeaderCollapseEventId = null;

  for (const pawn of pawns) {
    if (!pawn) continue;
    ensurePawnSystems(pawn);
    ensurePawnAI(pawn);
    ensureAssignedPlacementState(state, pawn);

    const defId =
      typeof pawn.pawnDefId === "string" ? pawn.pawnDefId : "default";
    const def = pawnDefs[defId] || pawnDefs.default;
    const intents = Array.isArray(def?.intents) ? def.intents : [];
    const passives = Array.isArray(def?.passives) ? def.passives : [];

    let context = buildPawnContext(state, pawn, tSec);
    const hungerBefore = Math.floor(pawn?.systemState?.hunger?.cur ?? 0);

    runEquippedItemPassives(state, pawn, tSec, context);
    runPawnDefPassives(state, pawn, passives, tSec, context, {
      requireResolvedIdle: false,
    });

    const prevMode = pawn?.ai?.mode ?? null;
    let aiMode = updatePawnAiMode(pawn);
    const suppressed = isPawnAiSuppressed(pawn, tSec);
    const eatIntent = findIntentById(intents, "eat");
    const assignedPlacement = getAssignedPlacement(pawn);
    const hungerWarning = clampInt(
      PAWN_AI_HUNGER_WARNING,
      0,
      getSystemMax(pawn, "hunger", 100),
      0
    );
    const hungerFull = clampInt(
      PAWN_AI_HUNGER_FULL,
      clampInt(PAWN_AI_HUNGER_START_EAT, 0, getSystemMax(pawn, "hunger", 100), 0),
      getSystemMax(pawn, "hunger", 100),
      getSystemMax(pawn, "hunger", 100)
    );
    const staminaWarning = clampInt(
      PAWN_AI_STAMINA_WARNING,
      0,
      getSystemMax(pawn, "stamina", 100),
      0
    );
    const staminaFull = clampInt(
      PAWN_AI_STAMINA_FULL,
      clampInt(PAWN_AI_STAMINA_START_REST, 0, getSystemMax(pawn, "stamina", 100), 0),
      getSystemMax(pawn, "stamina", 100),
      getSystemMax(pawn, "stamina", 100)
    );
    const hungerNow = Math.floor(pawn?.systemState?.hunger?.cur ?? 0);
    const staminaNow = Math.floor(pawn?.systemState?.stamina?.cur ?? 0);
    let returnState = getPawnReturnState(pawn);
    let hungryWarningLogged = false;
    let movedThisSecond = false;

    if (prevMode !== "eat" && aiMode === "eat" && hungerNow <= hungerWarning) {
      pushGameEvent(state, {
        type: "pawnHungry",
        tSec,
        text: `${getPawnLabel(pawn)} is hungry`,
        data: {
          focusKind: "pawn",
          pawnId: pawn.id ?? null,
          ownerIds: pawn.id != null ? [pawn.id] : [],
          value: hungerNow,
          threshold: hungerWarning,
        },
      });
      hungryWarningLogged = true;
    }

    if (prevMode !== "rest" && aiMode === "rest" && staminaNow <= staminaWarning) {
      pushGameEvent(state, {
        type: "pawnTired",
        tSec,
        text: `${getPawnLabel(pawn)} is tired`,
        data: {
          focusKind: "pawn",
          pawnId: pawn.id ?? null,
          ownerIds: pawn.id != null ? [pawn.id] : [],
          value: staminaNow,
          threshold: staminaWarning,
        },
      });
    }
    context = buildPawnContext(state, pawn, tSec);

    if (aiMode === "eat" && !eatIntent) {
      pawn.ai.mode = null;
      aiMode = null;
    }

    if (aiMode === "eat" && eatIntent) {
      const canEatInPlace = canExecuteIntent(eatIntent, pawn, context, {
        ignoreRequires: true,
      });
      let movedForEat = false;
      if (!canEatInPlace && !suppressed) {
        const candidates = findEatMoveCandidates(state, pawn, tSec, eatIntent);
        for (const placement of candidates) {
          if (!tryMovePawnViaCommand(state, pawn, placement, placePawn)) continue;
          if (!locationsMatch(assignedPlacement, placementToLocation(placement))) {
            setPawnReturnState(pawn, "waitingForEat");
            returnState = "waitingForEat";
          }
          context = buildPawnContext(state, pawn, tSec);
          movedThisSecond = true;
          pushPawnSeekMoveEvent(state, pawn, tSec, "eat", placement);
          movedForEat = true;
          break;
        }
      }

      if (
        !canEatInPlace &&
        !movedForEat &&
        !suppressed &&
        shouldFallbackToRestWhenEatFails(pawn)
      ) {
        const restCandidates = findRestMoveCandidates(state, pawn);
        for (const placement of restCandidates) {
          if (!tryMovePawnViaCommand(state, pawn, placement, placePawn)) continue;
          pawn.ai.mode = "rest";
          aiMode = "rest";
          if (!locationsMatch(assignedPlacement, placementToLocation(placement))) {
            setPawnReturnState(pawn, "waitingForRest");
            returnState = "waitingForRest";
          }
          context = buildPawnContext(state, pawn, tSec);
          movedThisSecond = true;
          pushPawnSeekMoveEvent(state, pawn, tSec, "rest", placement);
          break;
        }
      }
    } else if (aiMode === "rest") {
      const atRestSpot = isRestSpotAtLocation(state, getPawnLocation(pawn));
      if (!atRestSpot && !suppressed) {
        const candidates = findRestMoveCandidates(state, pawn);
        for (const placement of candidates) {
          if (!tryMovePawnViaCommand(state, pawn, placement, placePawn)) continue;
          if (!locationsMatch(assignedPlacement, placementToLocation(placement))) {
            setPawnReturnState(pawn, "waitingForRest");
            returnState = "waitingForRest";
          }
          context = buildPawnContext(state, pawn, tSec);
          movedThisSecond = true;
          pushPawnSeekMoveEvent(state, pawn, tSec, "rest", placement);
          break;
        }
      }
    }

    const edibleInvBefore = snapshotEdibleInventory(context.pawnInv);
    const ediblePoolsBefore = snapshotEdibleDistributorPools(context.distributorPools);
    const edibleLocalBefore = snapshotEdibleLocalInventories(
      context.localInventories
    );

    const intentsToRun = getIntentsForMode(intents, pawn.ai.mode);
    const executionResult = executeIntentsForPawnSecond(
      state,
      pawn,
      context,
      intentsToRun
    );
    const executed = executionResult.executed;
    const executedIntentId = executionResult.executedIntentId;

    runPawnDefPassives(state, pawn, passives, tSec, context, {
      idle: !executed && !movedThisSecond,
      requireResolvedIdle: true,
    });

    if (pawn.role === "follower") {
      applyFollowerHungerDebt(state, pawn);
    }

    const hungerAfter = Math.floor(pawn?.systemState?.hunger?.cur ?? 0);
    const staminaAfter = Math.floor(pawn?.systemState?.stamina?.cur ?? 0);
    if (
      !hungryWarningLogged &&
      hungerBefore > hungerWarning &&
      hungerAfter <= hungerWarning
    ) {
      pushGameEvent(state, {
        type: "pawnHungry",
        tSec,
        text: `${getPawnLabel(pawn)} is hungry`,
        data: {
          focusKind: "pawn",
          pawnId: pawn.id ?? null,
          ownerIds: pawn.id != null ? [pawn.id] : [],
          value: hungerAfter,
          threshold: hungerWarning,
        },
      });
    }

    if (executedIntentId === "eat") {
      const edibleInvAfter = snapshotEdibleInventory(state?.ownerInventories?.[pawn.id]);
      const ediblePoolsAfter = snapshotEdibleDistributorPools(context.distributorPools);
      const edibleLocalAfter = snapshotEdibleLocalInventories(
        context.localInventories
      );
      const kindFromInv = findConsumedKind(edibleInvBefore, edibleInvAfter);
      const kindFromPools = findConsumedKind(ediblePoolsBefore, ediblePoolsAfter);
      const kindFromLocal = findConsumedKind(edibleLocalBefore, edibleLocalAfter);
      const itemKind = kindFromInv || kindFromPools || kindFromLocal || null;
      const itemLabel = getItemLabel(itemKind);
      pushGameEvent(state, {
        type: "pawnAte",
        tSec,
        text: `${getPawnLabel(pawn)} ate ${chooseArticle(itemLabel)} ${itemLabel}`,
        data: {
          focusKind: "pawn",
          pawnId: pawn.id ?? null,
          ownerIds: pawn.id != null ? [pawn.id] : [],
          itemKind,
        },
      });
    }

    if (pawn.role === "leader" && executedIntentId === "eat") {
      consumeWorkerMealsAfterLeaderEat(state, pawn);
    }

    if (pawn.role === "leader") {
      ensureLeaderFaithFields(pawn);

      if (executedIntentId === "eat") {
        applyLeaderFaithEatSuccess(pawn);
      } else {
        resetLeaderFaithEatStreak(pawn);
      }

      const hungerMax = getSystemMax(pawn, "hunger", 100);
      const hungerStartEat = clampInt(PAWN_AI_HUNGER_START_EAT, 0, hungerMax, 0);
      const faithDecayThreshold = clampInt(
        LEADER_FAITH_HUNGER_DECAY_THRESHOLD,
        0,
        hungerMax,
        0
      );
      const failedEatAtRisk =
        hungerAfter <= hungerStartEat && executedIntentId !== "eat";

      if (failedEatAtRisk) {
        if (pawn.leaderFaith?.failedEatWarnActive !== true) {
          pushGameEvent(state, {
            type: "leaderFaithEatFailureWarning",
            tSec,
            text: `${getPawnLabel(pawn)} failed to eat while starving; leader faith is at risk`,
            data: {
              focusKind: "pawn",
              pawnId: pawn.id ?? null,
              ownerIds: pawn.id != null ? [pawn.id] : [],
              hunger: hungerAfter,
              warningThreshold: hungerStartEat,
            },
          });
        }
        if (pawn.leaderFaith) {
          pawn.leaderFaith.failedEatWarnActive = true;
        }
      } else if (pawn.leaderFaith) {
        pawn.leaderFaith.failedEatWarnActive = false;
      }

      const shouldApplyFaithDecay =
        hungerBefore <= faithDecayThreshold && hungerAfter <= faithDecayThreshold;
      if (shouldApplyFaithDecay) {
        const decayTicks = accumulateLeaderFaithDecaySecond(pawn, 1);
        for (let tick = 0; tick < decayTicks; tick++) {
          const decay = applyLeaderFaithDecayTick(pawn);
          if (decay?.eliminateLeader) {
            if (pawn.id != null && !pendingLeaderEliminations.has(pawn.id)) {
              pendingLeaderEliminations.set(pawn.id, {
                pawnLabel: getPawnLabel(pawn),
              });
            }
            break;
          }
          if (decay?.degraded) {
            pushGameEvent(state, {
              type: "leaderFaithDecayed",
              tSec,
              text: `${getPawnLabel(pawn)}'s faith fell from ${decay.previousTier} to ${decay.nextTier} due to starvation`,
              data: {
                focusKind: "pawn",
                pawnId: pawn.id ?? null,
                ownerIds: pawn.id != null ? [pawn.id] : [],
                previousTier: decay.previousTier,
                nextTier: decay.nextTier,
                hunger: hungerAfter,
                decayThreshold: faithDecayThreshold,
              },
            });
          }
        }
      } else {
        resetLeaderFaithDecayTimer(pawn);
      }
    }

    aiMode = updatePawnAiMode(pawn);
    returnState = getPawnReturnState(pawn);
    if (returnState === "waitingForEat" && executedIntentId === "eat") {
      setPawnReturnState(pawn, "ready");
      returnState = "ready";
    }
    if (returnState === "waitingForRest" && staminaAfter >= staminaFull) {
      setPawnReturnState(pawn, "ready");
      returnState = "ready";
    }
    if (returnState === "ready") {
      tryReturnPawnToAssignedPlacement(state, pawn, placePawn);
    }

    if (executed) continue;
  }

  if (pendingLeaderEliminations.size === 0) return;

  const eliminationEntries = Array.from(pendingLeaderEliminations.entries());
  eliminationEntries.sort((a, b) => {
    const aNum = Number(a[0]);
    const bNum = Number(b[0]);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    const aText = String(a[0]);
    const bText = String(b[0]);
    if (aText < bText) return -1;
    if (aText > bText) return 1;
    return 0;
  });

  for (const [leaderId, info] of eliminationEntries) {
    const collapse = eliminateLeaderByFaithCollapse(state, leaderId);
    if (!collapse?.ok) continue;
    const followerCount = Array.isArray(collapse.followerIds)
      ? collapse.followerIds.length
      : 0;
    const entry = pushGameEvent(state, {
      type: "leaderFaithCollapsed",
      tSec,
      text: `${info?.pawnLabel || "Leader"} was lost to starvation; ${followerCount} followers were lost with them`,
      data: {
        focusKind: "pawn",
        pawnId: collapse.leaderId ?? null,
        ownerIds: Array.isArray(collapse.removedPawnIds)
          ? collapse.removedPawnIds.slice()
          : [],
        followerIds: Array.isArray(collapse.followerIds)
          ? collapse.followerIds.slice()
          : [],
      },
    });
    latestLeaderCollapseEventId = Number.isFinite(entry?.id)
      ? Math.floor(entry.id)
      : latestLeaderCollapseEventId;
  }

  if (getLeaderCount(state) !== 0 || state?.runStatus?.complete === true) return;

  const runYear = Number.isFinite(state?.year)
    ? Math.max(1, Math.floor(state.year))
    : 1;
  state.runStatus = {
    complete: true,
    reason: "leaderFaithCollapsedAtBronze",
    year: runYear,
    tSec: Math.max(0, Math.floor(tSec ?? state?.tSec ?? 0)),
    triggerEventId: latestLeaderCollapseEventId,
  };
  state.paused = true;
  syncPhaseToPaused(state);
  pushGameEvent(state, {
    type: "runComplete",
    tSec,
    text: `Run complete: all leaders were lost to starvation in Year ${runYear}.`,
    data: {
      runComplete: true,
      year: runYear,
      reason: "leaderFaithCollapsedAtBronze",
      triggerEventId: latestLeaderCollapseEventId,
    },
  });
}
