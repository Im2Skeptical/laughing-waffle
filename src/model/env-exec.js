// env-exec.js
// Per-second environment execution (events + tile intents).

import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { ENV_EVENT_DRAW_CADENCE_SEC } from "../defs/gamesettings/gamerules-defs.js";
import {
  drawSeasonDeckEntry,
  getCurrentSeasonKey,
  makeEnvEventInstance,
  ensurePawnSystems,
  rebuildBoardOccupancy,
} from "./state.js";
import { createRng } from "./rng.js";
import { runEffect } from "./effects/index.js";
import { resolveCosts, canAffordCosts, applyCosts } from "./costs.js";
import { pushGameEvent } from "./event-feed.js";
import { passiveTimingPasses } from "./passive-timing.js";
import { getPawnEffectiveWorkUnits } from "./prestige-system.js";
import { ensureRecipePriorityState, getEnabledRecipeIds } from "./recipe-priority.js";
import { computeGlobalSkillMods } from "./skills.js";
import { isTagHidden } from "./tag-state.js";

function chooseArticle(noun) {
  if (!noun || typeof noun !== "string") return "A";
  return /^[aeiou]/i.test(noun.trim()) ? "An" : "A";
}

function formatEventAppearanceText(defId) {
  const def = envEventDefs?.[defId];
  const rawName =
    (typeof def?.name === "string" && def.name) ||
    (typeof def?.ui?.name === "string" && def.ui.name) ||
    defId ||
    "event";
  const label = String(rawName).trim().toLowerCase() || "event";
  return `${chooseArticle(label)} ${label} appeared`;
}

function findSpawnedEventAnchor(state, defId, tSec) {
  const anchors = Array.isArray(state?.board?.layers?.event?.anchors)
    ? state.board.layers.event.anchors
    : [];
  const sec = Number.isFinite(tSec) ? Math.floor(tSec) : 0;
  const matches = [];
  for (const anchor of anchors) {
    if (!anchor || anchor.defId !== defId) continue;
    if (Math.floor(anchor.createdSec ?? -1) !== sec) continue;
    matches.push(anchor);
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const ai = Number.isFinite(a?.instanceId) ? Math.floor(a.instanceId) : 0;
    const bi = Number.isFinite(b?.instanceId) ? Math.floor(b.instanceId) : 0;
    return ai - bi;
  });
  return matches[0];
}

function collectSpawnedEventPlacements(state, defId, tSec) {
  const anchors = Array.isArray(state?.board?.layers?.event?.anchors)
    ? state.board.layers.event.anchors
    : [];
  const sec = Number.isFinite(tSec) ? Math.floor(tSec) : 0;
  const placements = [];
  for (const anchor of anchors) {
    if (!anchor || anchor.defId !== defId) continue;
    if (Math.floor(anchor.createdSec ?? -1) !== sec) continue;
    const col = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : 0;
    const span =
      Number.isFinite(anchor.span) && anchor.span > 0
        ? Math.floor(anchor.span)
        : 1;
    const instanceId = Number.isFinite(anchor.instanceId)
      ? Math.floor(anchor.instanceId)
      : null;
    placements.push({
      col,
      span,
      instanceId,
    });
  }
  placements.sort(
    (a, b) =>
      a.col - b.col ||
      (a.instanceId ?? Number.MAX_SAFE_INTEGER) -
        (b.instanceId ?? Number.MAX_SAFE_INTEGER)
  );
  return placements;
}

function getEventDrawResolution(def) {
  const drawResolution = def?.drawResolution;
  if (!drawResolution || typeof drawResolution !== "object") return null;
  if (drawResolution.mode !== "aggregateActiveRun") return null;
  if (
    typeof drawResolution.aggregateKey !== "string" ||
    drawResolution.aggregateKey.length <= 0
  ) {
    return null;
  }
  return drawResolution;
}

function resolveAggregateMagnitudeBand(drawResolution, cardsDrawn) {
  const count = Number.isFinite(cardsDrawn) ? Math.max(1, Math.floor(cardsDrawn)) : 1;
  const magnitudeBands = Array.isArray(drawResolution?.magnitudeBands)
    ? drawResolution.magnitudeBands
    : [];
  for (const band of magnitudeBands) {
    if (!band || typeof band !== "object") continue;
    const minCards = Number.isFinite(band.minCards) ? Math.floor(band.minCards) : 1;
    const maxCards = Number.isFinite(band.maxCards) ? Math.floor(band.maxCards) : null;
    if (count < minCards) continue;
    if (maxCards != null && count > maxCards) continue;
    return band;
  }
  return null;
}

function computeAggregateRunExpirySec(drawResolution, firstDrawSec, cardsDrawn) {
  const baseSec = Number.isFinite(drawResolution?.durationBaseSec)
    ? Math.max(0, Math.floor(drawResolution.durationBaseSec))
    : 0;
  const perExtraSec = Number.isFinite(drawResolution?.durationPerExtraCardSec)
    ? Math.max(0, Math.floor(drawResolution.durationPerExtraCardSec))
    : 0;
  const extraCards = Number.isFinite(cardsDrawn)
    ? Math.max(0, Math.floor(cardsDrawn) - 1)
    : 0;
  const startSec = Number.isFinite(firstDrawSec) ? Math.max(0, Math.floor(firstDrawSec)) : 0;
  return startSec + baseSec + perExtraSec * extraCards;
}

function buildAggregateRunState(state, defId, drawResolution, tSec, cardsDrawn) {
  const aggregateKey = drawResolution.aggregateKey;
  const firstDrawSec = Number.isFinite(tSec) ? Math.max(0, Math.floor(tSec)) : 0;
  const safeCardsDrawn = Number.isFinite(cardsDrawn) ? Math.max(1, Math.floor(cardsDrawn)) : 1;
  const magnitudeBand = resolveAggregateMagnitudeBand(drawResolution, safeCardsDrawn);
  return {
    defId,
    aggregateKey,
    sourceYear: Number.isFinite(state?.year) ? Math.floor(state.year) : 1,
    sourceSeasonIndex: Number.isFinite(state?.currentSeasonIndex)
      ? Math.floor(state.currentSeasonIndex)
      : 0,
    firstDrawSec,
    cardsDrawn: safeCardsDrawn,
    magnitudeId: magnitudeBand?.id ?? null,
    expiresSec: computeAggregateRunExpirySec(drawResolution, firstDrawSec, safeCardsDrawn),
  };
}

function buildAggregateRunPayload(runState) {
  if (!runState || typeof runState !== "object") return null;
  return {
    aggregateKey: runState.aggregateKey,
    cardsDrawn: Number.isFinite(runState.cardsDrawn)
      ? Math.floor(runState.cardsDrawn)
      : 1,
    magnitudeId: typeof runState.magnitudeId === "string" ? runState.magnitudeId : null,
    expiresSec: Number.isFinite(runState.expiresSec)
      ? Math.floor(runState.expiresSec)
      : null,
  };
}

function getActiveAggregateRun(state, aggregateKey, defId) {
  const runs =
    state?.activeEnvEventRuns && typeof state.activeEnvEventRuns === "object"
      ? state.activeEnvEventRuns
      : null;
  if (!runs) return null;
  const run = runs[aggregateKey];
  if (!run || typeof run !== "object") return null;
  if (defId && run.defId !== defId) return null;
  return run;
}

function findActiveAggregateAnchors(state, defId, aggregateKey) {
  const anchors = Array.isArray(state?.board?.layers?.event?.anchors)
    ? state.board.layers.event.anchors
    : [];
  const matches = [];
  for (const anchor of anchors) {
    if (!anchor || anchor.defId !== defId) continue;
    const key = anchor?.props?.aggregateKey;
    if (aggregateKey && key !== aggregateKey) continue;
    matches.push(anchor);
  }
  matches.sort((a, b) => {
    const ai = Number.isFinite(a?.instanceId) ? Math.floor(a.instanceId) : 0;
    const bi = Number.isFinite(b?.instanceId) ? Math.floor(b.instanceId) : 0;
    return ai - bi;
  });
  return matches;
}

function syncAggregateAnchorState(anchor, runState) {
  if (!anchor || !runState) return false;
  if (!anchor.props || typeof anchor.props !== "object" || Array.isArray(anchor.props)) {
    anchor.props = {};
  }
  anchor.props.aggregateKey = runState.aggregateKey;
  anchor.props.cardsDrawn = runState.cardsDrawn;
  anchor.props.magnitudeId = runState.magnitudeId;
  anchor.expiresSec = runState.expiresSec;
  return true;
}

function syncAggregateAnchors(anchors, runState) {
  let changed = false;
  for (const anchor of anchors) {
    changed = syncAggregateAnchorState(anchor, runState) || changed;
  }
  return changed;
}

function runAggregateBandUpdateEffects(state, anchors, magnitudeBand, tSec) {
  if (!magnitudeBand?.onRunUpdate) return false;
  let changed = false;
  for (const anchor of anchors) {
    if (!anchor) continue;
    changed =
      runEffect(state, magnitudeBand.onRunUpdate, {
        kind: "game",
        state,
        source: anchor,
        tSec,
      }) || changed;
  }
  return changed;
}

function currentDeckMatchesAggregateRun(state, runState) {
  const deck = state?.currentSeasonDeck;
  if (!deck || typeof deck !== "object") return false;
  const deckYear = Number.isFinite(deck.year) ? Math.floor(deck.year) : null;
  const deckSeasonIndex = Number.isFinite(deck.seasonIndex)
    ? Math.floor(deck.seasonIndex)
    : null;
  return (
    deckYear === Math.floor(runState?.sourceYear ?? NaN) &&
    deckSeasonIndex === Math.floor(runState?.sourceSeasonIndex ?? NaN)
  );
}

function purgeAggregateRunCardsFromCurrentDeck(state, runState) {
  if (!currentDeckMatchesAggregateRun(state, runState)) return false;
  const deck = state?.currentSeasonDeck?.deck;
  if (!Array.isArray(deck) || deck.length <= 0) return false;
  const defId = runState?.defId;
  if (typeof defId !== "string" || defId.length <= 0) return false;
  const nextDeck = deck.filter((entry) => entry?.defId !== defId);
  if (nextDeck.length === deck.length) return false;
  deck.length = 0;
  deck.push(...nextDeck);
  return true;
}

function finalizeExpiredAggregateRun(state, aggregateKey, defId) {
  const run = getActiveAggregateRun(state, aggregateKey, defId);
  if (!run) return false;
  const def = envEventDefs[run.defId];
  const drawResolution = getEventDrawResolution(def);
  if (drawResolution?.purgeRemainingCardsOnExpire === true) {
    purgeAggregateRunCardsFromCurrentDeck(state, run);
  }
  delete state.activeEnvEventRuns[aggregateKey];
  return true;
}

function resolveAggregateDraw(state, defId, def, drawResolution, tSec) {
  const aggregateKey = drawResolution.aggregateKey;
  const activeRun = getActiveAggregateRun(state, aggregateKey, defId);
  const activeAnchors = activeRun
    ? findActiveAggregateAnchors(state, defId, aggregateKey)
    : [];
  if (activeRun && activeAnchors.length <= 0) {
    delete state.activeEnvEventRuns[aggregateKey];
  }

  const liveRun =
    activeAnchors.length > 0 ? getActiveAggregateRun(state, aggregateKey, defId) : null;
  if (!liveRun) {
    const spawnResult = spawnEnvEventFromDef(state, defId, def, tSec);
    if (!spawnResult?.placedAny) {
      return {
        result: spawnResult,
        outcome: "consumedNoPlacement",
        aggregation: null,
      };
    }
    const spawnedAnchors = findActiveAggregateAnchors(state, defId, null).filter(
      (anchor) => Math.floor(anchor?.createdSec ?? -1) === Math.floor(tSec)
    );
    const runState = buildAggregateRunState(state, defId, drawResolution, tSec, 1);
    state.activeEnvEventRuns[aggregateKey] = runState;
    syncAggregateAnchors(spawnedAnchors, runState);
    const magnitudeBand = resolveAggregateMagnitudeBand(drawResolution, runState.cardsDrawn);
    runAggregateBandUpdateEffects(state, spawnedAnchors, magnitudeBand, tSec);
    return {
      result: spawnResult,
      outcome: "placed",
      aggregation: buildAggregateRunPayload(runState),
    };
  }

  const nextCardsDrawn = Math.max(1, Math.floor(liveRun.cardsDrawn ?? 1) + 1);
  const nextRunState = {
    ...liveRun,
    cardsDrawn: nextCardsDrawn,
  };
  const magnitudeBand = resolveAggregateMagnitudeBand(drawResolution, nextCardsDrawn);
  nextRunState.magnitudeId = magnitudeBand?.id ?? null;
  nextRunState.expiresSec = computeAggregateRunExpirySec(
    drawResolution,
    nextRunState.firstDrawSec,
    nextCardsDrawn
  );
  state.activeEnvEventRuns[aggregateKey] = nextRunState;
  syncAggregateAnchors(activeAnchors, nextRunState);
  runAggregateBandUpdateEffects(state, activeAnchors, magnitudeBand, tSec);
  return {
    result: { placedAny: false, needsRebuild: false },
    outcome: "aggregated",
    aggregation: buildAggregateRunPayload(nextRunState),
  };
}

function requirementsPass(requires, seasonKey, tile, hasPawn, isTagUnlocked = null) {
  if (!requires || typeof requires !== "object") return true;

  if (Array.isArray(requires.season) && requires.season.length > 0) {
    if (!seasonKey || !requires.season.includes(seasonKey)) return false;
  }

  if (typeof requires.hasPawn === "boolean") {
    if (requires.hasPawn !== hasPawn) return false;
  }

  if (typeof requires.hasSelectedCrop === "boolean") {
    const selectedCropId = tile?.systemState?.growth?.selectedCropId;
    const hasSelected =
      typeof selectedCropId === "string" && selectedCropId.length > 0;
    if (requires.hasSelectedCrop !== hasSelected) return false;
  }

  if (Array.isArray(requires.selectedCropIdIn)) {
    const selectedCropId = tile?.systemState?.growth?.selectedCropId;
    if (
      requires.selectedCropIdIn.length > 0 &&
      (typeof selectedCropId !== "string" ||
        !requires.selectedCropIdIn.includes(selectedCropId))
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(requires, "hasEquipment")) {
    return false;
  }

  if (typeof requires.hasMaturedPool === "boolean") {
    const pool = tile?.systemState?.growth?.maturedPool;
    const selectedCropId = tile?.systemState?.growth?.selectedCropId ?? null;
    const hasPool = hasMaturedPoolForCrop(pool, selectedCropId);
    if (requires.hasMaturedPool !== hasPool) return false;
  }

  const tagReq = requires.hasTag;
  if (tagReq != null) {
    const tileTags = Array.isArray(tile?.tags) ? tile.tags : [];
    const requiredTags = Array.isArray(tagReq)
      ? tagReq
      : typeof tagReq === "string"
        ? [tagReq]
        : [];

    for (const tag of requiredTags) {
      if (!tileTags.includes(tag)) return false;
      if (isTagUnlocked && !isTagUnlocked(tag)) return false;
      if (isTagHidden(tile, tag)) return false;
    }
  }

  return true;
}

function hasTieredUnits(pool) {
  if (!pool || typeof pool !== "object") return false;
  return (
    (pool.bronze ?? 0) > 0 ||
    (pool.silver ?? 0) > 0 ||
    (pool.gold ?? 0) > 0 ||
    (pool.diamond ?? 0) > 0
  );
}

function resolveMaturedPoolBucket(pool, cropId) {
  if (!pool || typeof pool !== "object") return null;
  const hasTierKeys =
    Object.prototype.hasOwnProperty.call(pool, "bronze") ||
    Object.prototype.hasOwnProperty.call(pool, "silver") ||
    Object.prototype.hasOwnProperty.call(pool, "gold") ||
    Object.prototype.hasOwnProperty.call(pool, "diamond");
  if (hasTierKeys) return pool;
  if (typeof cropId !== "string" || cropId.length <= 0) return null;
  const bucket = pool[cropId];
  return bucket && typeof bucket === "object" ? bucket : null;
}

function hasMaturedPoolForCrop(pool, cropId) {
  const bucket = resolveMaturedPoolBucket(pool, cropId);
  if (bucket) return hasTieredUnits(bucket);
  if (!pool || typeof pool !== "object") return false;
  for (const value of Object.values(pool)) {
    if (!value || typeof value !== "object") continue;
    if (hasTieredUnits(value)) return true;
  }
  return false;
}

function resolveIntentSelectedCropCandidates(intent, tile, state, selectedCropId) {
  const out = [];
  const seen = new Set();
  function pushCandidate(cropId) {
    if (typeof cropId !== "string" || cropId.length <= 0) return;
    if (seen.has(cropId)) return;
    seen.add(cropId);
    out.push(cropId);
  }

  pushCandidate(selectedCropId);
  pushCandidate(tile?.systemState?.growth?.selectedCropId ?? null);

  if (intent?.selectedCropFromPriority !== true) {
    return out;
  }

  const growth = tile?.systemState?.growth;
  if (!growth || typeof growth !== "object") return out;
  const priority = ensureRecipePriorityState(growth, {
    systemId: "growth",
    state,
    includeLocked: true,
  });
  const enabled = getEnabledRecipeIds(priority);
  for (const cropId of enabled) pushCandidate(cropId);
  return out;
}

function buildIntentExecutionContexts(intent, baseContext, tile, state) {
  if (!intent || intent.selectedCropFromPriority !== true) {
    return [baseContext];
  }
  const candidates = resolveIntentSelectedCropCandidates(
    intent,
    tile,
    state,
    baseContext?.selectedCropId ?? null
  );
  if (candidates.length <= 0) return [baseContext];
  return candidates.map((cropId) => ({ ...baseContext, selectedCropId: cropId }));
}

function isTagDisabled(tile, tagId, isTagUnlocked = null) {
  if (!tile || !tagId) return false;
  if (isTagUnlocked && !isTagUnlocked(tagId)) return true;
  if (isTagHidden(tile, tagId)) return true;
  const entry = tile.tagStates?.[tagId];
  return entry?.disabled === true;
}

function getPawnIdsOnEnvCol(state, col) {
  const out = [];
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    const slot = Number.isFinite(pawn?.envCol) ? Math.floor(pawn.envCol) : null;
    if (slot === col && pawn?.id != null) out.push(pawn.id);
  }
  return out;
}

function buildEnvPassiveKey(col, tagId, passive, passiveIndex) {
  const passiveId =
    typeof passive?.id === "string" && passive.id.length > 0
      ? passive.id
      : `idx${passiveIndex}`;
  return `env:${col}:tag:${tagId}:passive:${passiveId}`;
}


function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string");
  }
  if (typeof value === "string") return [value];
  return [];
}

function normalizeSystemSpecs(spec) {
  if (!spec) return [];
  if (Array.isArray(spec)) return spec.filter((entry) => entry && typeof entry === "object");
  if (typeof spec === "object") return [spec];
  return [];
}

function getSystemNumericValue(tile, systemId, key) {
  if (!tile || !systemId || !key) return null;
  const systemState = tile.systemState?.[systemId];
  if (!systemState || typeof systemState !== "object") return null;
  const value = systemState[key];
  if (!Number.isFinite(value)) return null;
  return value;
}

function matchesSystemAtLeast(tile, spec) {
  const systemId = spec?.system;
  const key = spec?.key;
  const gte = spec?.gte;
  if (!systemId || !key || !Number.isFinite(gte)) return false;
  const value = getSystemNumericValue(tile, systemId, key);
  if (!Number.isFinite(value)) return false;
  return value >= gte;
}

function matchesSystemAtMost(tile, spec) {
  const systemId = spec?.system;
  const key = spec?.key;
  const lte = spec?.lte;
  if (!systemId || !key || !Number.isFinite(lte)) return false;
  const value = getSystemNumericValue(tile, systemId, key);
  if (!Number.isFinite(value)) return false;
  return value <= lte;
}

function matchesSystemBetween(tile, spec) {
  const systemId = spec?.system;
  const key = spec?.key;
  const min = spec?.min;
  const max = spec?.max;
  if (!systemId || !key || !Number.isFinite(min) || !Number.isFinite(max)) {
    return false;
  }
  const value = getSystemNumericValue(tile, systemId, key);
  if (!Number.isFinite(value)) return false;
  return value >= min && value <= max;
}

function matchesTileWhere(tile, whereSpec, isTagUnlocked = null) {
  if (!whereSpec || typeof whereSpec !== "object") return true;
  if (!tile || typeof tile !== "object") return false;

  const tileId = whereSpec.tileId;
  if (typeof tileId === "string") {
    if (tile.defId !== tileId) return false;
  } else if (Array.isArray(tileId) && tileId.length > 0) {
    if (!tileId.includes(tile.defId)) return false;
  }

  const tags = Array.isArray(tile.tags) ? tile.tags : [];
  const hasVisibleTag = (tag) =>
    tags.includes(tag) &&
    (!isTagUnlocked || isTagUnlocked(tag)) &&
    !isTagHidden(tile, tag);
  const hasTag = whereSpec.hasTag;
  if (typeof hasTag === "string") {
    if (!hasVisibleTag(hasTag)) return false;
  } else if (Array.isArray(hasTag) && hasTag.length > 0) {
    for (const tag of hasTag) {
      if (!hasVisibleTag(tag)) return false;
    }
  }

  const hasAllTags = normalizeStringArray(whereSpec.hasAllTags);
  if (hasAllTags.length > 0) {
    for (const tag of hasAllTags) {
      if (!hasVisibleTag(tag)) return false;
    }
  }

  const hasAnyTags = normalizeStringArray(whereSpec.hasAnyTags);
  if (hasAnyTags.length > 0) {
    let any = false;
    for (const tag of hasAnyTags) {
      if (hasVisibleTag(tag)) {
        any = true;
        break;
      }
    }
    if (!any) return false;
  }

  const notTag = whereSpec.notTag;
  if (typeof notTag === "string" && hasVisibleTag(notTag)) return false;

  const excludeTags = normalizeStringArray(whereSpec.excludeTags);
  if (excludeTags.length > 0) {
    for (const tag of excludeTags) {
      if (hasVisibleTag(tag)) return false;
    }
  }

  const systemAtLeastSpecs = normalizeSystemSpecs(whereSpec.systemAtLeast);
  for (const spec of systemAtLeastSpecs) {
    if (!matchesSystemAtLeast(tile, spec)) return false;
  }

  const systemAtMostSpecs = normalizeSystemSpecs(whereSpec.systemAtMost);
  for (const spec of systemAtMostSpecs) {
    if (!matchesSystemAtMost(tile, spec)) return false;
  }

  const systemBetweenSpecs = normalizeSystemSpecs(whereSpec.systemBetween);
  for (const spec of systemBetweenSpecs) {
    if (!matchesSystemBetween(tile, spec)) return false;
  }

  return true;
}

function collectTileColsWhere(state, whereSpec, isTagUnlocked = null) {
  const occ = state?.board?.occ?.tile;
  if (!Array.isArray(occ)) return [];
  const cols = [];
  for (let col = 0; col < occ.length; col++) {
    const tile = occ[col];
    if (!tile) continue;
    if (!matchesTileWhere(tile, whereSpec, isTagUnlocked)) continue;
    cols.push(col);
  }
  return cols;
}

function normalizeColList(rawCols, maxCols) {
  if (!Array.isArray(rawCols)) return [];
  const safeMax = Number.isFinite(maxCols) ? Math.max(0, Math.floor(maxCols)) : 0;
  if (safeMax <= 0) return [];
  const seen = new Set();
  const out = [];
  for (const value of rawCols) {
    if (!Number.isFinite(value)) continue;
    const col = Math.floor(value);
    if (col < 0 || col >= safeMax) continue;
    if (seen.has(col)) continue;
    seen.add(col);
    out.push(col);
  }
  return out;
}

function expandAreaCols(refCols, areaSpec, maxCols) {
  const safeMax = Number.isFinite(maxCols) ? Math.max(0, Math.floor(maxCols)) : 0;
  if (safeMax <= 0) return [];
  if (!Array.isArray(refCols) || refCols.length === 0) return [];

  const baseCols = normalizeColList(refCols, safeMax);
  if (!areaSpec || typeof areaSpec !== "object") return baseCols;

  if (areaSpec.kind !== "adjacent") return baseCols;
  const radius = Number.isFinite(areaSpec.radius)
    ? Math.max(0, Math.floor(areaSpec.radius))
    : 0;
  if (radius === 0) return baseCols;

  const seen = new Array(safeMax).fill(false);
  const out = [];
  for (const refCol of baseCols) {
    for (let offset = -radius; offset <= radius; offset++) {
      const col = refCol + offset;
      if (col < 0 || col >= safeMax) continue;
      if (seen[col]) continue;
      seen[col] = true;
      out.push(col);
    }
  }
  return out;
}

function filterColsByWhere(state, cols, whereSpec, isTagUnlocked = null) {
  if (!whereSpec || typeof whereSpec !== "object") return cols;
  const occ = state?.board?.occ?.tile;
  if (!Array.isArray(occ)) return [];
  const out = [];
  for (const rawCol of cols) {
    if (!Number.isFinite(rawCol)) continue;
    const col = Math.floor(rawCol);
    const tile = occ[col];
    if (!tile) continue;
    if (!matchesTileWhere(tile, whereSpec, isTagUnlocked)) continue;
    out.push(col);
  }
  return out;
}

function resolvePlacementOriginCol(originCol, span, placementSpec, maxCols) {
  if (!Number.isFinite(originCol)) return null;
  const cols = Number.isFinite(maxCols) ? Math.floor(maxCols) : 0;
  const safeSpan = Number.isFinite(span) && span > 0 ? Math.floor(span) : 1;
  if (cols <= 0 || safeSpan > cols) return null;

  const anchor = placementSpec?.anchor === "center" ? "center" : "origin";
  if (anchor === "center") {
    const half = Math.floor(safeSpan / 2);
    const desired = Math.floor(originCol) - half;
    const min = 0;
    const max = cols - safeSpan;
    return Math.max(min, Math.min(max, desired));
  }

  const start = Math.floor(originCol);
  if (start < 0 || start + safeSpan > cols) return null;
  return start;
}

function placementHasTiles(state, startCol, span) {
  const tileOcc = state?.board?.occ?.tile;
  if (!Array.isArray(tileOcc)) return false;
  const safeSpan = Number.isFinite(span) && span > 0 ? Math.floor(span) : 1;
  for (let offset = 0; offset < safeSpan; offset++) {
    const col = startCol + offset;
    if (col < 0 || col >= tileOcc.length) return false;
    if (!tileOcc[col]) return false;
  }
  return true;
}

function getIntersectingAnchorsForOcc(eventOcc, startCol, span) {
  if (!Array.isArray(eventOcc)) return [];
  const safeSpan = Number.isFinite(span) && span > 0 ? Math.floor(span) : 1;
  const seen = new Set();
  const anchors = [];
  for (let offset = 0; offset < safeSpan; offset++) {
    const col = startCol + offset;
    if (col < 0 || col >= eventOcc.length) continue;
    const anchor = eventOcc[col];
    if (!anchor) continue;
    const key = anchor.instanceId ?? anchor;
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push(anchor);
  }
  return anchors;
}

function filterAnchorsByScope(anchors, startCol, span, scope) {
  if (!Array.isArray(anchors) || anchors.length === 0) return [];
  if (scope !== "fullyContained") return anchors;
  const safeSpan = Number.isFinite(span) && span > 0 ? Math.floor(span) : 1;
  const endCol = startCol + safeSpan - 1;
  return anchors.filter((anchor) => {
    const aCol = Number.isFinite(anchor?.col) ? Math.floor(anchor.col) : 0;
    const aSpan =
      Number.isFinite(anchor?.span) && anchor.span > 0
        ? Math.floor(anchor.span)
        : 1;
    const aEnd = aCol + aSpan - 1;
    return aCol >= startCol && aEnd <= endCol;
  });
}

function sortAnchorsByCreated(anchors) {
  const ordered = anchors.map((anchor, index) => ({
    anchor,
    index,
    createdSec: Number.isFinite(anchor?.createdSec)
      ? Math.floor(anchor.createdSec)
      : 0,
    instanceId: Number.isFinite(anchor?.instanceId)
      ? Math.floor(anchor.instanceId)
      : 0,
  }));
  ordered.sort(
    (a, b) =>
      a.createdSec - b.createdSec ||
      a.instanceId - b.instanceId ||
      a.index - b.index
  );
  return ordered.map((entry) => entry.anchor);
}

function removeEventAnchors(state, anchors, tSec, options) {
  if (!Array.isArray(anchors) || anchors.length === 0) return false;
  const ordered = sortAnchorsByCreated(anchors);
  const runExit = options?.runExit !== false;

  if (runExit) {
    for (const anchor of ordered) {
      if (!anchor) continue;
      const def = envEventDefs[anchor.defId];
      if (!def?.onExit) continue;
      const context = { kind: "game", state, source: anchor, tSec };
      runEffect(state, def.onExit, context);
    }
  }

  const removeKeys = new Set(
    ordered.map((anchor) => anchor?.instanceId ?? anchor)
  );
  const anchorsList = state.board?.layers?.event?.anchors;
  if (!Array.isArray(anchorsList) || anchorsList.length === 0) return false;

  const next = anchorsList.filter((anchor) => {
    const key = anchor?.instanceId ?? anchor;
    return !removeKeys.has(key);
  });
  if (next.length === anchorsList.length) return false;
  anchorsList.length = 0;
  anchorsList.push(...next);

  const eventOcc = state.board?.occ?.event;
  if (Array.isArray(eventOcc)) {
    for (const anchor of ordered) {
      const col = Number.isFinite(anchor?.col) ? Math.floor(anchor.col) : 0;
      const span =
        Number.isFinite(anchor?.span) && anchor.span > 0
          ? Math.floor(anchor.span)
          : 1;
      for (let offset = 0; offset < span; offset++) {
        const occCol = col + offset;
        if (occCol < 0 || occCol >= eventOcc.length) continue;
        if (eventOcc[occCol] === anchor) eventOcc[occCol] = null;
      }
    }
  }

  return true;
}

function transformEventAnchors(state, anchors, defId, tSec) {
  if (!Array.isArray(anchors) || anchors.length === 0) return false;
  if (!defId || typeof defId !== "string") return false;
  const def = envEventDefs[defId];
  if (!def) return false;

  const ordered = sortAnchorsByCreated(anchors);
  for (const anchor of ordered) {
    if (!anchor) continue;
    anchor.defId = defId;
    anchor.createdSec = tSec;
    if (def.durationSec != null) {
      anchor.expiresSec = tSec + def.durationSec;
    } else {
      delete anchor.expiresSec;
    }
    delete anchor.entered;
  }
  return true;
}

function placeEventAnchor(state, defId, col, span, tSec) {
  const board = state.board;
  if (!board) return false;
  const anchor = makeEnvEventInstance(defId, state, col, span, tSec);
  board.layers.event.anchors.push(anchor);

  const eventOcc = board.occ?.event;
  if (Array.isArray(eventOcc)) {
    for (let offset = 0; offset < span; offset++) {
      const occCol = col + offset;
      if (occCol < 0 || occCol >= eventOcc.length) continue;
      eventOcc[occCol] = anchor;
    }
  }
  return true;
}

function getCollisionConfig(spawnSpec) {
  const collision =
    spawnSpec?.collision && typeof spawnSpec.collision === "object"
      ? spawnSpec.collision
      : {};
  const destroy =
    collision.destroy && typeof collision.destroy === "object"
      ? collision.destroy
      : null;

  const modeRaw = typeof collision.mode === "string" ? collision.mode : "skip";
  const mode =
    modeRaw === "skip" ||
    modeRaw === "fail" ||
    modeRaw === "destroyExisting" ||
    modeRaw === "transformExisting"
      ? modeRaw
      : "skip";
  const scopeRaw =
    typeof collision.scope === "string"
      ? collision.scope
      : typeof destroy?.scope === "string"
        ? destroy.scope
        : "intersecting";
  const scope = scopeRaw === "fullyContained" ? "fullyContained" : "intersecting";
  const runExit =
    typeof collision.runExit === "boolean"
      ? collision.runExit
      : typeof destroy?.runExit === "boolean"
        ? destroy.runExit
        : true;
  const transformDefId =
    typeof collision.defId === "string"
      ? collision.defId
      : typeof collision.transformDefId === "string"
        ? collision.transformDefId
        : null;

  return { mode, scope, runExit, transformDefId };
}

function filterValidOriginCols(state, cols, span, placementSpec) {
  const board = state?.board;
  const boardCols = Number.isFinite(board?.cols) ? Math.floor(board.cols) : 0;
  const tileOcc = board?.occ?.tile;
  if (!Array.isArray(tileOcc) || boardCols <= 0) return [];
  const out = [];
  for (const rawCol of cols) {
    if (!Number.isFinite(rawCol)) continue;
    const col = Math.floor(rawCol);
    if (col < 0 || col >= boardCols) continue;
    if (!tileOcc[col]) continue;
    const startCol = resolvePlacementOriginCol(col, span, placementSpec, boardCols);
    if (startCol == null) continue;
    if (!placementHasTiles(state, startCol, span)) continue;
    out.push(col);
  }
  return out;
}

function collectRandomCandidateCols(
  state,
  span,
  placementSpec,
  whereSpec,
  collisionMode,
  isTagUnlocked
) {
  const baseCols = collectTileColsWhere(state, whereSpec, isTagUnlocked);
  const validCols = filterValidOriginCols(state, baseCols, span, placementSpec);
  if (collisionMode !== "skip") return validCols;

  const boardCols = Number.isFinite(state?.board?.cols)
    ? Math.floor(state.board.cols)
    : 0;
  const eventOcc = state?.board?.occ?.event;
  const filtered = [];
  for (const col of validCols) {
    const startCol = resolvePlacementOriginCol(col, span, placementSpec, boardCols);
    if (startCol == null) continue;
    const collisions = getIntersectingAnchorsForOcc(eventOcc, startCol, span);
    if (collisions.length > 0) continue;
    filtered.push(col);
  }
  return filtered;
}

function collectOriginColsByMode(
  state,
  spawnSpec,
  span,
  placementSpec,
  collisionMode,
  rng,
  isTagUnlocked
) {
  const boardCols = Number.isFinite(state?.board?.cols)
    ? Math.floor(state.board.cols)
    : 0;
  const mode = typeof spawnSpec?.mode === "string" ? spawnSpec.mode : "singleRandomCol";

  if (mode === "allColsWhere") {
    const baseCols = collectTileColsWhere(state, spawnSpec?.where, isTagUnlocked);
    return filterValidOriginCols(state, baseCols, span, placementSpec);
  }

  if (mode === "areaAroundWhere") {
    if (spawnSpec?.refWhere == null) return [];
    const refCols = collectTileColsWhere(state, spawnSpec?.refWhere, isTagUnlocked);
    const areaCols = expandAreaCols(refCols, spawnSpec?.area, boardCols);
    const filtered = filterColsByWhere(state, areaCols, spawnSpec?.where, isTagUnlocked);
    return filterValidOriginCols(state, filtered, span, placementSpec);
  }

  if (mode === "colList") {
    const rawList = spawnSpec?.colList ?? spawnSpec?.cols;
    const baseCols = normalizeColList(rawList, boardCols);
    const filtered = filterColsByWhere(state, baseCols, spawnSpec?.where, isTagUnlocked);
    return filterValidOriginCols(state, filtered, span, placementSpec);
  }

  const candidates = collectRandomCandidateCols(
    state,
    span,
    placementSpec,
    spawnSpec?.where,
    collisionMode,
    isTagUnlocked
  );
  if (!candidates.length) return [];
  if (rng && typeof rng.nextInt === "function") {
    const idx = rng.nextInt(0, candidates.length - 1);
    return [candidates[idx]];
  }
  if (typeof state.rngNextInt !== "function") return [candidates[0]];
  const idx = state.rngNextInt(0, candidates.length - 1);
  return [candidates[idx]];
}

function collectCollisionAnchorsForPlacements(eventOcc, originCols, span, placementSpec, scope) {
  if (!Array.isArray(eventOcc) || !Array.isArray(originCols)) return [];
  const maxCols = eventOcc.length;
  const seen = new Set();
  const anchors = [];
  for (const originCol of originCols) {
    const startCol = resolvePlacementOriginCol(originCol, span, placementSpec, maxCols);
    if (startCol == null) continue;
    const intersecting = getIntersectingAnchorsForOcc(eventOcc, startCol, span);
    const scoped = filterAnchorsByScope(intersecting, startCol, span, scope);
    for (const anchor of scoped) {
      const key = anchor?.instanceId ?? anchor;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push(anchor);
    }
  }
  return anchors;
}

function attemptPlacement(state, defId, span, tSec, originCol, placementSpec, collision) {
  const boardCols = Number.isFinite(state?.board?.cols)
    ? Math.floor(state.board.cols)
    : 0;
  const startCol = resolvePlacementOriginCol(originCol, span, placementSpec, boardCols);
  if (startCol == null) return { placed: false, needsRebuild: false };
  if (!placementHasTiles(state, startCol, span)) return { placed: false, needsRebuild: false };

  const eventOcc = state?.board?.occ?.event;
  let colliding = getIntersectingAnchorsForOcc(eventOcc, startCol, span);

  if (collision.mode === "skip") {
    if (colliding.length > 0) return { placed: false, needsRebuild: false };
  } else if (collision.mode === "fail") {
    if (colliding.length > 0) return { placed: false, needsRebuild: false, aborted: true };
  } else if (collision.mode === "destroyExisting") {
    const scoped = filterAnchorsByScope(colliding, startCol, span, collision.scope);
    let removed = false;
    if (scoped.length > 0) {
      removed = removeEventAnchors(state, scoped, tSec, { runExit: collision.runExit });
    }
    colliding = getIntersectingAnchorsForOcc(eventOcc, startCol, span);
    if (colliding.length > 0) {
      return { placed: false, needsRebuild: removed };
    }
    const placed = placeEventAnchor(state, defId, startCol, span, tSec);
    return { placed, needsRebuild: true };
  } else if (collision.mode === "transformExisting") {
    if (colliding.length > 0) {
      const scoped = filterAnchorsByScope(colliding, startCol, span, collision.scope);
      if (scoped.length > 0) {
        transformEventAnchors(state, scoped, collision.transformDefId, tSec);
      }
      return { placed: false, needsRebuild: false };
    }
  }

  const placed = placeEventAnchor(state, defId, startCol, span, tSec);
  return { placed, needsRebuild: true };
}

function hashString(value) {
  const str = String(value ?? "");
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function deriveEnvEventSeed(state, tSec, defId) {
  const baseSeed = Number.isFinite(state?.rng?.baseSeed)
    ? Math.floor(state.rng.baseSeed)
    : Number.isFinite(state?.rng?.seed)
      ? Math.floor(state.rng.seed)
      : 0;
  const sec = Number.isFinite(tSec) ? Math.floor(tSec) : 0;
  const defHash = hashString(defId);
  let seed = baseSeed | 0;
  seed = Math.imul(seed ^ (sec + 0x9e3779b9), 0x85ebca6b);
  seed = Math.imul(seed ^ defHash, 0xc2b2ae35);
  return seed | 0;
}

function spawnEnvEventFromDef(state, defId, def, tSec) {
  const board = state?.board;
  if (!board) return { placedAny: false, needsRebuild: false };

  const span =
    Number.isFinite(def?.defaultSpan) && def.defaultSpan > 0
      ? Math.floor(def.defaultSpan)
      : 1;
  const spawnSpec = def?.spawn && typeof def.spawn === "object" ? def.spawn : {};
  const placementSpec =
    spawnSpec.placement && typeof spawnSpec.placement === "object"
      ? spawnSpec.placement
      : {};
  const collision = getCollisionConfig(spawnSpec);
  const multiSpawn =
    spawnSpec.multiSpawn === "planThenApply" ? "planThenApply" : "independent";

  const rng = createRng(deriveEnvEventSeed(state, tSec, defId));
  const unlockedEnvTags = computeGlobalSkillMods(state).unlockedEnvTags;
  const isTagUnlocked = (tagId) =>
    typeof tagId === "string" && unlockedEnvTags.has(tagId);
  const originCols = collectOriginColsByMode(
    state,
    spawnSpec,
    span,
    placementSpec,
    collision.mode,
    rng,
    isTagUnlocked
  );
  if (!originCols.length) return { placedAny: false, needsRebuild: false };

  if (collision.mode === "fail") {
    const eventOcc = board?.occ?.event;
    for (const originCol of originCols) {
      const startCol = resolvePlacementOriginCol(originCol, span, placementSpec, board.cols);
      if (startCol == null) continue;
      if (!placementHasTiles(state, startCol, span)) continue;
      const colliding = getIntersectingAnchorsForOcc(eventOcc, startCol, span);
      if (colliding.length > 0) {
        return { placedAny: false, needsRebuild: false, aborted: true };
      }
    }
  }

  let needsRebuild = false;
  let placedAny = false;

  const planThenApply = multiSpawn === "planThenApply" && originCols.length > 1;
  let applyCollision = collision;

  if (planThenApply && (collision.mode === "destroyExisting" || collision.mode === "transformExisting")) {
    const baseOcc = Array.isArray(board?.occ?.event) ? board.occ.event.slice() : null;
    const toProcess = collectCollisionAnchorsForPlacements(
      baseOcc,
      originCols,
      span,
      placementSpec,
      collision.scope
    );
    if (collision.mode === "destroyExisting") {
      if (removeEventAnchors(state, toProcess, tSec, { runExit: collision.runExit })) {
        needsRebuild = true;
      }
    } else if (collision.mode === "transformExisting") {
      transformEventAnchors(state, toProcess, collision.transformDefId, tSec);
    }
    applyCollision = { ...collision, mode: "skip" };
  }

  for (const originCol of originCols) {
    const res = attemptPlacement(
      state,
      defId,
      span,
      tSec,
      originCol,
      placementSpec,
      applyCollision
    );
    if (res?.needsRebuild) needsRebuild = true;
    if (res?.placed) placedAny = true;
    if (res?.aborted) break;
  }

  return { placedAny, needsRebuild };
}

export function stepEnvSecond(state, tSec) {
  if (!state || !state.board) return;

  const board = state.board;
  const seasonKey = getCurrentSeasonKey(state);
  const unlockedEnvTags = computeGlobalSkillMods(state).unlockedEnvTags;
  const isTagUnlocked = (tagId) =>
    typeof tagId === "string" && unlockedEnvTags.has(tagId);
  let needsRebuild = state._boardDirty === true;

  const eventAnchors = board.layers?.event?.anchors;
  const expiredAggregateRuns = new Map();
  if (Array.isArray(eventAnchors) && eventAnchors.length > 0) {
    for (let i = eventAnchors.length - 1; i >= 0; i--) {
      const anchor = eventAnchors[i];
      if (!anchor) continue;

      const def = envEventDefs[anchor.defId];
      if (!def) continue;

      const context = { kind: "game", state, source: anchor, tSec };

      if (!anchor.entered) {
        if (def.onEnter) runEffect(state, def.onEnter, context);
        anchor.entered = true;
      }

      if (def.onTick) runEffect(state, def.onTick, context);

      const expiredByTime =
        anchor.expiresSec != null && tSec >= anchor.expiresSec;
      const expiredBySeason =
        state._seasonChanged === true &&
        (anchor.expiresOnSeasonChange || def.expiresOnSeasonChange);

      if (expiredByTime || expiredBySeason) {
        const aggregateKey =
          typeof anchor?.props?.aggregateKey === "string"
            ? anchor.props.aggregateKey
            : null;
        if (expiredByTime && aggregateKey) {
          expiredAggregateRuns.set(aggregateKey, anchor.defId);
        }
        if (def.onExit) runEffect(state, def.onExit, context);
        eventAnchors.splice(i, 1);
        needsRebuild = true;
        const occ = board.occ?.event;
        if (Array.isArray(occ)) {
          const col = Number.isFinite(anchor.col) ? anchor.col : 0;
          const span = Number.isFinite(anchor.span) ? anchor.span : 1;
          for (let offset = 0; offset < span; offset++) {
            const occCol = col + offset;
            if (occCol < 0 || occCol >= occ.length) continue;
            if (occ[occCol] === anchor) occ[occCol] = null;
          }
        }
      }
    }
  }

  for (const [aggregateKey, defId] of expiredAggregateRuns.entries()) {
    finalizeExpiredAggregateRun(state, aggregateKey, defId);
  }

  if (
    Number.isFinite(tSec) &&
    tSec > 0 &&
    tSec % ENV_EVENT_DRAW_CADENCE_SEC === 0
  ) {
    const entry = drawSeasonDeckEntry(state);
    if (entry) {
      const def = envEventDefs[entry.defId];
      let result = null;
      let outcome = "consumedNoPlacement";
      let aggregation = null;
      if (def) {
        const drawResolution = getEventDrawResolution(def);
        if (drawResolution) {
          const aggregateResult = resolveAggregateDraw(
            state,
            entry.defId,
            def,
            drawResolution,
            tSec
          );
          result = aggregateResult?.result ?? null;
          outcome = aggregateResult?.outcome ?? outcome;
          aggregation = aggregateResult?.aggregation ?? null;
        } else {
          result = spawnEnvEventFromDef(state, entry.defId, def, tSec);
          outcome = result?.placedAny ? "placed" : outcome;
        }
        if (result?.needsRebuild) needsRebuild = true;
        if (result?.placedAny) {
          const spawned = findSpawnedEventAnchor(state, entry.defId, tSec);
          const envCol = Number.isFinite(spawned?.col)
            ? Math.floor(spawned.col)
            : null;
          pushGameEvent(state, {
            type: "envEventAppeared",
            tSec,
            text: formatEventAppearanceText(entry.defId),
            data: {
              focusKind: "tile",
              envCol,
              eventDefId: entry.defId,
              eventInstanceId: spawned?.instanceId ?? null,
            },
          });
        }
      }

      const consumePolicy = def?.spawn?.consumePolicy;
      const shouldReturnToDeck =
        consumePolicy === "onlyIfAnyPlaced" &&
        !result?.placedAny &&
        outcome !== "aggregated";
      if (shouldReturnToDeck) {
        const deck = state.currentSeasonDeck?.deck;
        if (Array.isArray(deck)) deck.unshift(entry);
      }

      outcome = result?.placedAny
        ? "placed"
        : shouldReturnToDeck
          ? "returned"
          : outcome;
      const placements = result?.placedAny
        ? collectSpawnedEventPlacements(state, entry.defId, tSec)
        : [];
      pushGameEvent(state, {
        type: "envDeckDraw",
        tSec,
        text: "",
        data: {
          showInEventLog: false,
          defId: entry.defId,
          seasonKey,
          outcome,
          placements,
          aggregation,
          consumePolicy: typeof consumePolicy === "string" ? consumePolicy : null,
        },
      });
    }
  }

  const cols = board.cols ?? 12;
  const tileOcc = board.occ?.tile;
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const pawnById = new Map();
  for (const pawn of pawns) {
    if (pawn?.id != null) pawnById.set(pawn.id, pawn);
  }
  for (let col = 0; col < cols; col++) {
    const tile = tileOcc?.[col];
    if (!tile) continue;
    const pawnIds = getPawnIdsOnEnvCol(state, col);
    const hasPawn = pawnIds.length > 0;
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    const selectedCropId = tile?.systemState?.growth?.selectedCropId ?? null;

    const baseContext = {
      kind: "game",
      state,
      source: tile,
      tSec,
      envCol: col,
    };

    for (const tagId of tags) {
      const tagDef = envTagDefs[tagId];
      if (!tagDef) continue;
      const tagDisabled = isTagDisabled(tile, tagId, isTagUnlocked);
      const passives = Array.isArray(tagDef.passives) ? tagDef.passives : [];
      for (let passiveIndex = 0; passiveIndex < passives.length; passiveIndex++) {
        const passive = passives[passiveIndex];
        if (!passive || typeof passive !== "object") continue;
        const passiveKey = buildEnvPassiveKey(col, tagId, passive, passiveIndex);
        if (tagDisabled) {
          passiveTimingPasses(passive.timing, state, tSec, {
            passiveKey,
            isActive: false,
          });
          continue;
        }
        const requirementsOk =
          !passive.requires ||
          requirementsPass(passive.requires, seasonKey, tile, hasPawn, isTagUnlocked);
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
          runEffect(state, passive.effect, { ...baseContext });
        }
      }
    }

    if (!hasPawn) continue;

    for (const pawnId of pawnIds) {
      const pawn = pawnById.get(pawnId);
      if (!pawn) continue;
      ensurePawnSystems(pawn);
      const pawnInv = state?.ownerInventories?.[pawnId] ?? null;

      const repeatLimit = Math.max(1, getPawnEffectiveWorkUnits(state, pawn));
      for (let iteration = 0; iteration < repeatLimit; iteration++) {
        const pawnContext = {
          ...baseContext,
          pawnId,
          ownerId: pawnId,
          pawn,
          pawnInv,
          selectedCropId,
        };

        let executed = false;
        for (const tagId of tags) {
          if (isTagDisabled(tile, tagId, isTagUnlocked)) continue;
          const tagDef = envTagDefs[tagId];
          if (!tagDef) continue;
          const intents = Array.isArray(tagDef.intents) ? tagDef.intents : [];
          for (const intent of intents) {
            if (!intent || typeof intent !== "object") continue;
            if (iteration > 0 && intent.repeatByActorWorkUnits !== true) continue;
            if (
              intent.requires &&
              !requirementsPass(intent.requires, seasonKey, tile, true, isTagUnlocked)
            ) {
              continue;
            }
            const executionContexts = buildIntentExecutionContexts(
              intent,
              pawnContext,
              tile,
              state
            );
            for (const executionContext of executionContexts) {
              let resolvedIntentCost = null;
              let intentContext = null;
              if (intent.cost) {
                intentContext = {
                  ...executionContext,
                  intentId: intent.id ?? null,
                };
                const resolved = resolveCosts(intent.cost, intentContext);
                if (!resolved) continue;
                if (!canAffordCosts(resolved, intentContext)) continue;
                resolvedIntentCost = resolved;
              }
              let effectSucceeded = true;
              if (intent.effect) {
                effectSucceeded = runEffect(state, intent.effect, {
                  ...executionContext,
                });
              }
              if (!effectSucceeded) {
                continue;
              }
              if (resolvedIntentCost && intentContext) {
                applyCosts(resolvedIntentCost, intentContext);
              }
              executed = true;
              break;
            }
            if (executed) break;
          }
          if (executed) break;
        }

        if (!executed) break;
      }
    }
  }

  if (needsRebuild) {
    rebuildBoardOccupancy(state);
    state._boardDirty = false;
  }
}
