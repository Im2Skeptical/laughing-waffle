// pawn-exec.js
// Per-second pawn intent execution.

import { pawnDefs } from "../defs/gamepieces/pawn-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { hubSystemDefs } from "../defs/gamesystems/hub-system-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { LEADER_EQUIPMENT_SLOT_ORDER } from "../defs/gamesystems/equipment-slot-defs.js";
import { HUNGER_THRESHOLD } from "../defs/gamesettings/gamerules-defs.js";
import { runEffect } from "./effects.js";
import { resolveCosts, canAffordCosts, applyCosts } from "./costs.js";
import { ensurePawnSystems } from "./state.js";
import { applyFollowerHungerDebt } from "./prestige-system.js";
import { pushGameEvent } from "./event-feed.js";

function requirementsPass(requires, pawn) {
  if (!requires || typeof requires !== "object") return true;
  if (Number.isFinite(requires.hungerAtMost)) {
    const cur = pawn?.systemState?.hunger?.cur;
    if (!Number.isFinite(cur) || cur > requires.hungerAtMost) return false;
  }
  return true;
}

function timingPass(timing, state, tSec) {
  if (!timing || typeof timing !== "object") return true;
  const cadenceSec = Number.isFinite(timing.cadenceSec)
    ? Math.max(1, Math.floor(timing.cadenceSec))
    : null;
  const onSeasonChange = timing.onSeasonChange === true;

  if (!cadenceSec && !onSeasonChange) return true;

  const cadenceMatch =
    cadenceSec != null && Number.isFinite(tSec)
      ? tSec % cadenceSec === 0
      : false;
  const seasonMatch = onSeasonChange && state?._seasonChanged === true;
  return cadenceMatch || seasonMatch;
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

function isTagDisabled(target, tagId) {
  if (!target || !tagId) return false;
  const entry = target.tagStates?.[tagId];
  return entry?.disabled === true;
}

function listDistributorPoolsForPawn(state, pawn) {
  const hubCol = Number.isFinite(pawn?.hubCol) ? Math.floor(pawn.hubCol) : null;
  if (hubCol == null) return [];

  const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  const sources = [];
  const baseRange = 1;

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (!anchor) continue;
    const tags = Array.isArray(anchor.tags) ? anchor.tags : [];
    if (!tags.includes("distributor") || isTagDisabled(anchor, "distributor")) {
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

  return sources;
}

function getPawnLabel(pawn) {
  if (!pawn) return "Pawn";
  return pawn.name || `Char ${pawn.id ?? ""}`.trim();
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

    for (const passive of passives) {
      if (!passive || typeof passive !== "object") continue;
      if (!timingPass(passive.timing, state, tSec)) continue;
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

export function stepPawnSecond(state, tSec) {
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  if (!chars.length) return;

  for (const pawn of chars) {
    if (!pawn) continue;
    ensurePawnSystems(pawn);

    const defId =
      typeof pawn.pawnDefId === "string" ? pawn.pawnDefId : "default";
    const def = pawnDefs[defId] || pawnDefs.default;
    const intents = Array.isArray(def?.intents) ? def.intents : [];
    const passives = Array.isArray(def?.passives) ? def.passives : [];

    const pawnInv = state?.ownerInventories?.[pawn.id] ?? null;
    const distributorPools = listDistributorPoolsForPawn(state, pawn);
    const context = {
      kind: "game",
      state,
      source: pawn,
      tSec,
      pawnId: pawn.id,
      ownerId: pawn.id,
      pawn,
      pawnInv,
      distributorPools,
    };
    const hungerBefore = Math.floor(pawn?.systemState?.hunger?.cur ?? 0);
    const edibleInvBefore = snapshotEdibleInventory(pawnInv);
    const ediblePoolsBefore = snapshotEdibleDistributorPools(distributorPools);

    runEquippedItemPassives(state, pawn, tSec, context);

    for (const passive of passives) {
      if (!passive || typeof passive !== "object") continue;
      if (!timingPass(passive.timing, state, tSec)) continue;
      if (passive.effect) {
        runEffect(state, passive.effect, { ...context });
      }
    }

    let executed = false;
    let executedIntentId = null;
    for (const intent of intents) {
      if (!intent || typeof intent !== "object") continue;
      if (intent.requires && !requirementsPass(intent.requires, pawn)) continue;
      if (intent.cost) {
        const resolved = resolveCosts(intent.cost, context);
        if (!resolved) continue;
        if (!canAffordCosts(resolved, context)) continue;
        applyCosts(resolved, context);
      }
      if (intent.effect) {
        runEffect(state, intent.effect, { ...context });
      }
      executed = true;
      executedIntentId =
        typeof intent.id === "string" && intent.id.length > 0 ? intent.id : null;
      break;
    }

    if (pawn.role === "follower") {
      applyFollowerHungerDebt(state, pawn);
    }

    const hungerAfter = Math.floor(pawn?.systemState?.hunger?.cur ?? 0);
    const threshold = Math.max(0, Math.floor(HUNGER_THRESHOLD ?? 0));
    if (hungerBefore >= threshold && hungerAfter < threshold) {
      pushGameEvent(state, {
        type: "pawnHungry",
        tSec,
        text: `${getPawnLabel(pawn)} is hungry`,
        data: {
          focusKind: "pawn",
          pawnId: pawn.id ?? null,
          ownerIds: pawn.id != null ? [pawn.id] : [],
        },
      });
    }

    if (executedIntentId === "eat") {
      const edibleInvAfter = snapshotEdibleInventory(state?.ownerInventories?.[pawn.id]);
      const ediblePoolsAfter = snapshotEdibleDistributorPools(distributorPools);
      const kindFromInv = findConsumedKind(edibleInvBefore, edibleInvAfter);
      const kindFromPools = findConsumedKind(ediblePoolsBefore, ediblePoolsAfter);
      const itemKind = kindFromInv || kindFromPools || null;
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

    if (executed) continue;
  }
}
