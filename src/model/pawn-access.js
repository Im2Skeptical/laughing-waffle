import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import {
  findEquippedPoolProviderEntry,
  ownerHasEquippedPoolProvider,
} from "./item-def-rules.js";
import { hasHubTagUnlock } from "./skills.js";
import { isTagHidden } from "./tag-state.js";

const HUB_DISTRIBUTOR_TAG = "distributor";

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
  const tier = anchor?.systemTiers?.distribution || def?.defaultTier || "bronze";
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

export function normalizeLocation(location) {
  const hubCol = Number.isFinite(location?.hubCol) ? Math.floor(location.hubCol) : null;
  const envCol = Number.isFinite(location?.envCol) ? Math.floor(location.envCol) : null;
  if (hubCol != null) return { hubCol, envCol: null };
  if (envCol != null) return { hubCol: null, envCol };
  return { hubCol: null, envCol: null };
}

export function getPawnLocation(pawn) {
  return normalizeLocation(pawn);
}

export function locationsMatch(a, b) {
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

export function listDistributorPoolsForPawn(state, pawn, locationOverride = null) {
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
    const systemId = typeof deposit.systemId === "string" ? deposit.systemId : null;
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

export function listLocalAccessibleInventoriesForPawn(state, locationOverride = null) {
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

export function buildPawnContext(state, pawn, tSec, locationOverride = null) {
  const pawnInv = state?.ownerInventories?.[pawn?.id] ?? null;
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
    pawnId: pawn?.id ?? null,
    ownerId: pawn?.id ?? null,
    pawn,
    pawnInv,
    distributorPools,
    localInventories,
  };
}
