// src/controllers/actionmanagers/action-planner.js
// Stateful planner: holds editable intents for a single tSec.

import { ActionKinds } from "../../model/actions.js";
import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import {
  IntentKinds,
  makeItemTransferIntent,
  makePawnMoveIntent,
  makeBuildDesignateIntent,
  makeTileTagOrderIntent,
  makeTileCropSelectIntent,
  makeHubTagOrderIntent,
  makeHubRecipeSelectIntent,
  makeTileTagToggleIntent,
  makeHubTagToggleIntent,
  getIntentSubjectKey,
} from "./action-intents.js";
import {
  estimateIntentApCost,
  computeIntentCostSummary,
} from "./action-costs.js";
import {
  buildPreviewSnapshot,
  createEmptyInventoryPreview,
} from "./action-preview-state.js";
import { placementEquals } from "./action-placement-utils.js";
import { validateHubConstructionPlacement } from "../../model/build-helpers.js";
import {
  buildRecipePriorityFromSelectedRecipe,
  normalizeRecipePriority,
  recipePrioritiesEqual,
} from "../../model/recipe-priority.js";
import {
  computeAvailableRecipesAndBuildings,
  hasEnvTagUnlock,
  hasHubTagUnlock,
} from "../../model/skills.js";
import { isDiscoveryAlwaysVisibleEnvTag } from "../../model/discovery.js";
import { isEnvColExposed, isHubVisible } from "../../model/state.js";
import { projectActionsFromBoundaryStateData } from "../../model/action-preview-projection.js";

function clonePlacement(p) {
  return p ? { ...p } : null;
}

function cloneIntent(intent) {
  if (!intent) return null;
  return {
    ...intent,
    fromPlacement: clonePlacement(intent.fromPlacement),
    toPlacement: clonePlacement(intent.toPlacement),
    baselinePlacement: clonePlacement(intent.baselinePlacement),
    tagIds: cloneTagList(intent.tagIds),
    baselineTags: cloneTagList(intent.baselineTags),
    recipePriority: cloneRecipePriority(intent.recipePriority),
    baselineRecipePriority: cloneRecipePriority(intent.baselineRecipePriority),
  };
}

function cloneTagList(tags) {
  return Array.isArray(tags) ? tags.slice() : null;
}

function cloneRecipePriority(recipePriority) {
  const ordered = Array.isArray(recipePriority?.ordered)
    ? recipePriority.ordered.slice()
    : [];
  const enabled = {};
  for (const recipeId of ordered) {
    enabled[recipeId] =
      recipePriority?.enabled?.[recipeId] === false ? false : true;
  }
  return { ordered, enabled };
}

function normalizeTagList(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => typeof tag === "string");
}

function hasSameTagSet(leftTags, rightTags) {
  const left = Array.isArray(leftTags) ? leftTags : [];
  const right = Array.isArray(rightTags) ? rightTags : [];
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== left.length) return false;
  if (rightSet.size !== right.length) return false;
  for (const tagId of right) {
    if (!leftSet.has(tagId)) return false;
  }
  return true;
}

function getTagDisableState(target, tagId) {
  if (!target || !tagId) {
    return { disabled: false, playerDisabled: false, eventDisabledCount: 0 };
  }
  const entry = target.tagStates?.[tagId];
  if (!entry || typeof entry !== "object") {
    return { disabled: false, playerDisabled: false, eventDisabledCount: 0 };
  }
  const disabledBy =
    entry.disabledBy && typeof entry.disabledBy === "object"
      ? entry.disabledBy
      : null;
  const playerDisabled = disabledBy?.player === true;
  const eventDisabledCount = Number.isFinite(disabledBy?.eventCount)
    ? Math.max(0, Math.floor(disabledBy.eventCount))
    : 0;
  const legacyDisabled = entry.disabled === true && !disabledBy;
  const disabled = legacyDisabled || playerDisabled || eventDisabledCount > 0;
  return { disabled, playerDisabled, eventDisabledCount };
}

function isTagDisabled(target, tagId) {
  return getTagDisableState(target, tagId).disabled === true;
}

function tagListsEqual(a, b) {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    if (listA[i] !== listB[i]) return false;
  }
  return true;
}

function makePawnPlacement({ hubCol, envCol } = {}) {
  const hub = Number.isFinite(hubCol) ? Math.floor(hubCol) : null;
  const env = Number.isFinite(envCol) ? Math.floor(envCol) : null;
  if (env != null) return { envCol: env };
  if (hub != null) return { hubCol: hub };
  return null;
}

function normalizeHubColForStructure(state, hubCol) {
  if (!Number.isFinite(hubCol)) return hubCol;
  const col = Math.floor(hubCol);
  const occ = state?.hub?.occ;
  if (Array.isArray(occ)) {
    const anchor = occ[col];
    if (anchor && Number.isFinite(anchor.col)) {
      return Math.floor(anchor.col);
    }
  }
  return col;
}

function normalizePawnPlacement(value) {
  if (!value || typeof value !== "object") return null;
  return makePawnPlacement({
    hubCol: value.hubCol,
    envCol: value.envCol,
  });
}

function normalizeApCost(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeCommittedIntentBaseline(intent) {
  if (!intent || typeof intent !== "object") return null;
  const next = cloneIntent(intent);
  if (!next) return null;

  next.source = "timeline";

  if (
    next.kind === IntentKinds.ITEM_TRANSFER ||
    next.kind === IntentKinds.PAWN_MOVE
  ) {
    next.baselinePlacement = clonePlacement(next.toPlacement);
    return next;
  }

  if (
    next.kind === IntentKinds.TILE_TAG_ORDER ||
    next.kind === IntentKinds.HUB_TAG_ORDER
  ) {
    next.baselineTags = cloneTagList(next.tagIds) ?? [];
    return next;
  }

  if (
    next.kind === IntentKinds.TILE_TAG_TOGGLE ||
    next.kind === IntentKinds.HUB_TAG_TOGGLE
  ) {
    next.baselineDisabled = next.disabled === true;
    return next;
  }

  if (next.kind === IntentKinds.TILE_CROP_SELECT) {
    next.baselineRecipePriority = cloneRecipePriority(next.recipePriority);
    next.baselineCropId = next.cropId ?? null;
    return next;
  }

  if (next.kind === IntentKinds.HUB_RECIPE_SELECT) {
    next.baselineRecipePriority = cloneRecipePriority(next.recipePriority);
    next.baselineRecipeId = next.recipeId ?? null;
    return next;
  }

  return next;
}

function normalizeCropId(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function normalizeRecipeId(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function normalizeRecipePriorityPayload(
  { recipePriority, recipeId },
  { systemId, state }
) {
  if (recipePriority && typeof recipePriority === "object") {
    return normalizeRecipePriority(recipePriority, {
      systemId,
      state,
      includeLocked: false,
    });
  }
  if (Object.prototype.hasOwnProperty.call({ recipeId }, "recipeId")) {
    return buildRecipePriorityFromSelectedRecipe(recipeId, {
      systemId,
      state,
      includeLocked: false,
    });
  }
  return { ordered: [], enabled: {} };
}

function getCurrentRecipePriority(structure, systemId, state) {
  const fromState = normalizeRecipePriority(
    structure?.systemState?.[systemId]?.recipePriority,
    {
      systemId,
      state,
      includeLocked: false,
    }
  );
  if (fromState.ordered.length > 0) return fromState;
  const selected = structure?.systemState?.[systemId]?.selectedRecipeId ?? null;
  return buildRecipePriorityFromSelectedRecipe(selected, {
    systemId,
    state,
    includeLocked: false,
  });
}

function getCurrentTileCropPriority(tile, state) {
  const fromState = normalizeRecipePriority(tile?.systemState?.growth?.recipePriority, {
    systemId: "growth",
    state,
    includeLocked: false,
  });
  if (fromState.ordered.length > 0) return fromState;
  const selected = tile?.systemState?.growth?.selectedCropId ?? null;
  return buildRecipePriorityFromSelectedRecipe(selected, {
    systemId: "growth",
    state,
    includeLocked: false,
  });
}

function getRecipeKindForHubSystem(systemId) {
  if (systemId === "cook") return "cook";
  if (systemId === "craft") return "craft";
  return null;
}

function normalizeBuildHubCol(target) {
  if (!target || typeof target !== "object") return null;
  const raw =
    target.hubCol ??
    target.col ??
    target.hub ??
    null;
  return Number.isFinite(raw) ? Math.floor(raw) : null;
}

function hasPlannerVisibleEnvTagUnlock(state, tagId) {
  return isDiscoveryAlwaysVisibleEnvTag(tagId) || hasEnvTagUnlock(state, tagId);
}

function validatePawnMoveTarget(state, { toHubCol, toEnvCol } = {}) {
  if (Number.isFinite(toEnvCol)) {
    const col = Math.floor(toEnvCol);
    if (!isEnvColExposed(state, col)) {
      return { ok: false, reason: "envColHidden" };
    }
    const tile = state?.board?.occ?.tile?.[col] ?? null;
    if (!tile) return { ok: false, reason: "noTile" };
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    for (const tag of tags) {
      const def = envTagDefs[tag];
      const aff = Array.isArray(def?.affordances) ? def.affordances : [];
      if (aff.includes("noOccupy")) {
        return { ok: false, reason: "tileBlocked" };
      }
    }
    return { ok: true };
  }

  if (Number.isFinite(toHubCol) && !isHubVisible(state)) {
    return { ok: false, reason: "hubHidden" };
  }

  return { ok: true };
}

export function createActionPlanner({
  getTimeline,
  getState,
  getPreviewBoundaryStateData,
  onInvalidate,
  onEdit,
  onInsufficientAp,
} = {}) {
  let activeSec = null;
  let activeRevision = null;

  const baselineIntents = new Map();
  const intents = new Map();
  let intentOrder = [];

  let focusIntentId = null;
  let hasEdits = false;
  let version = 0;

  const cache = {
    dirty: true,
    apPreview: null,
    costSummary: null,
    plannerBudget: 0,
    previewByOwner: new Map(),
    pawnOverrides: new Map(),
    tilePlanByEnvCol: new Map(),
    hubPlanByHubCol: new Map(),
  };

  function bump(reason) {
    version += 1;
    cache.dirty = true;
    onInvalidate?.(reason);
  }

  function notifyEdit(reason) {
    onEdit?.(reason);
  }

  function clearCaches() {
    cache.dirty = true;
    cache.apPreview = null;
    cache.costSummary = null;
    cache.plannerBudget = 0;
    cache.previewByOwner.clear();
    cache.pawnOverrides.clear();
    cache.tilePlanByEnvCol.clear();
    cache.hubPlanByHubCol.clear();
  }

  function getTimelineSafe() {
    return typeof getTimeline === "function" ? getTimeline() : null;
  }

  function getStateSafe() {
    return typeof getState === "function" ? getState() : null;
  }

  function getPreviewBoundaryStateDataSafe(tSec) {
    if (typeof getPreviewBoundaryStateData === "function") {
      return getPreviewBoundaryStateData(tSec);
    }
    const state = getStateSafe();
    if (!state) return { ok: false, reason: "noPreviewBoundary" };
    return {
      ok: true,
      stateData: JSON.parse(JSON.stringify(state)),
      fallback: true,
    };
  }

  function isInventoryTransferGhostPreviewEnabled() {
    const state = getStateSafe();
    return state?.variantFlags?.inventoryTransferGhostPreviewEnabled !== false;
  }

  function getActionsAtSecond(timeline, sec) {
    if (!timeline) return [];
    if (timeline.actionsBySec && typeof timeline.actionsBySec.get === "function") {
      return timeline.actionsBySec.get(sec) || [];
    }
    return (timeline.actions || []).filter(
      (a) => Math.floor(a.tSec ?? 0) === sec
    );
  }

  function getInventoryForOwner(state, ownerId) {
    if (!state || !state.ownerInventories) return null;
    return state.ownerInventories[ownerId] || null;
  }

  function getHubStructureAtCol(state, hubCol) {
    if (!state || !Number.isFinite(hubCol)) return null;
    const col = Math.floor(hubCol);
    const occ = state.hub?.occ;
    if (Array.isArray(occ) && occ[col]) return occ[col];
    const slot = state.hub?.slots?.[col];
    return slot?.structure ?? null;
  }

  function findItemInOwner(inv, itemId) {
    if (!inv) return null;
    return inv.itemsById?.[itemId] || inv.items?.find((it) => it.id === itemId);
  }

  function findItemInState(state, itemId) {
    if (!state || !state.ownerInventories) return null;
    for (const [ownerKey, inv] of Object.entries(state.ownerInventories)) {
      const item = findItemInOwner(inv, itemId);
      if (item) {
        const ownerId = Number.isFinite(Number(ownerKey))
          ? Number(ownerKey)
          : ownerKey;
        return { item, ownerId };
      }
    }
    return null;
  }

  function makeItemSnapshot(item) {
    if (!item) return null;
    return {
      id: item.id,
      kind: item.kind,
      quantity: item.quantity,
      width: item.width,
      height: item.height,
      tier: item.tier ?? null,
      tags: Array.isArray(item.tags) ? item.tags.slice() : [],
    };
  }

  function ensureActive() {
    const timeline = getTimelineSafe();
    const state = getStateSafe();
    if (!timeline || !state) return;

    const tSec = Math.floor(state.tSec ?? 0);
    const revision = Math.floor(timeline.revision ?? 0);

    if (activeSec === null || tSec !== activeSec) {
      rebuildFromTimeline(tSec, revision, timeline, state);
      return;
    }

    if (revision !== activeRevision) {
      activeRevision = revision;
      if (!hasEdits) {
        rebuildFromTimeline(tSec, revision, timeline, state);
      } else {
        clearCaches();
      }
    }
  }

  function rebuildFromTimeline(tSec, revision, timeline, state) {
    activeSec = tSec;
    activeRevision = revision;

    baselineIntents.clear();
    intents.clear();
    intentOrder = [];
    focusIntentId = null;
    hasEdits = false;
    clearCaches();

    const actions = getActionsAtSecond(timeline, tSec);
    if (!actions || !actions.length) {
      bump("rebuild");
      return;
    }

    for (const action of actions) {
      const kind = action.kind;
      const payload = action.payload || {};

      if (kind === ActionKinds.INVENTORY_MOVE) {
        const fromOwnerId = payload.fromOwnerId;
        const toOwnerId = payload.toOwnerId;
        if (fromOwnerId === toOwnerId) continue;

        const itemId = payload.itemId ?? payload.item?.id ?? null;
        if (itemId == null) continue;

        const fromPlacement = payload.fromPlacement
          ? { ...payload.fromPlacement }
          : null;
        const toPlacement = payload.toPlacement
          ? { ...payload.toPlacement }
          : {
              ownerId: toOwnerId,
              gx: payload.targetGX,
              gy: payload.targetGY,
            };

        let itemSnapshot = payload.item ? { ...payload.item } : null;
        if (!itemSnapshot) {
          const inv = getInventoryForOwner(state, toOwnerId);
          const item = findItemInOwner(inv, itemId);
          itemSnapshot = makeItemSnapshot(item);
        }

        const subjectKey = `item:${itemId}`;
        const intent = makeItemTransferIntent({
          id: subjectKey,
          subjectKey,
          itemId,
          item: itemSnapshot,
          fromOwnerId,
          toOwnerId,
          fromPlacement,
          toPlacement,
          baselinePlacement: clonePlacement(toPlacement),
          apCostOverride: null,
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
        continue;
      }

      if (kind === ActionKinds.PLACE_PAWN) {
        const pawnId = payload.pawnId != null ? payload.pawnId : null;
        if (pawnId == null) continue;

        const toHubCol =
          payload.toHubCol ??
          payload.hubCol ??
          null;
        const toEnvCol =
          payload.toEnvCol ??
          payload.envCol ??
          null;
        const fromHubCol =
          payload.fromHubCol != null ? payload.fromHubCol : null;
        const fromEnvCol =
          payload.fromEnvCol != null ? payload.fromEnvCol : null;

        const fromPlacement =
          normalizePawnPlacement(payload.fromPlacement) ??
          makePawnPlacement({ hubCol: fromHubCol, envCol: fromEnvCol });
        const toPlacement =
          normalizePawnPlacement(payload.toPlacement) ??
          makePawnPlacement({ hubCol: toHubCol, envCol: toEnvCol });

        const subjectKey = `pawn:${pawnId}`;
        const intent = makePawnMoveIntent({
          id: subjectKey,
          subjectKey,
          pawnId,
          fromPlacement,
          toPlacement,
          baselinePlacement: clonePlacement(toPlacement),
          apCostOverride: normalizeApCost(action.apCost ?? payload.apCost),
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
        continue;
      }

      if (kind === ActionKinds.BUILD_DESIGNATE) {
        const buildKey = payload.buildKey ?? payload.targetKey ?? null;
        if (buildKey == null) continue;

        const subjectKey = `build:${buildKey}`;
        const intent = makeBuildDesignateIntent({
          id: subjectKey,
          subjectKey,
          buildKey,
          defId: payload.defId ?? null,
          target: payload.target ?? null,
          apCostOverride: normalizeApCost(action.apCost ?? payload.apCost),
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
      }

      if (kind === ActionKinds.SET_TILE_TAG_ORDER) {
        const envCol = payload.envCol ?? null;
        if (!Number.isFinite(envCol)) continue;
        const col = Math.floor(envCol);
        const subjectKey = `tileTags:${col}`;
        const tagIds = normalizeTagList(payload.tagIds ?? payload.tags);
        const intent = makeTileTagOrderIntent({
          id: subjectKey,
          subjectKey,
          envCol: col,
          tagIds,
          baselineTags: tagIds,
          apCostOverride: normalizeApCost(action.apCost ?? payload.apCost),
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
        continue;
      }

      if (kind === ActionKinds.SET_HUB_TAG_ORDER) {
        const hubCol = payload.hubCol ?? null;
        if (!Number.isFinite(hubCol)) continue;
        const col = Math.floor(hubCol);
        const subjectKey = `hubTags:${col}`;
        const tagIds = normalizeTagList(payload.tagIds ?? payload.tags);
        const intent = makeHubTagOrderIntent({
          id: subjectKey,
          subjectKey,
          hubCol: col,
          tagIds,
          baselineTags: tagIds,
          apCostOverride: normalizeApCost(action.apCost ?? payload.apCost),
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
        continue;
      }

      if (kind === ActionKinds.TOGGLE_TILE_TAG) {
        const envCol = payload.envCol ?? null;
        const tagId = payload.tagId ?? null;
        if (!Number.isFinite(envCol) || !tagId) continue;
        const col = Math.floor(envCol);
        const subjectKey = `tileTagToggle:${col}:${tagId}`;
        const disabled = payload.disabled === true;
        const intent = makeTileTagToggleIntent({
          id: subjectKey,
          subjectKey,
          envCol: col,
          tagId,
          disabled,
          baselineDisabled: disabled,
          apCostOverride: normalizeApCost(action.apCost ?? payload.apCost),
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
        continue;
      }

      if (kind === ActionKinds.TOGGLE_HUB_TAG) {
        const hubCol = payload.hubCol ?? null;
        const tagId = payload.tagId ?? null;
        if (!Number.isFinite(hubCol) || !tagId) continue;
        const col = Math.floor(hubCol);
        const subjectKey = `hubTagToggle:${col}:${tagId}`;
        const disabled = payload.disabled === true;
        const intent = makeHubTagToggleIntent({
          id: subjectKey,
          subjectKey,
          hubCol: col,
          tagId,
          disabled,
          baselineDisabled: disabled,
          apCostOverride: normalizeApCost(action.apCost ?? payload.apCost),
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
        continue;
      }

      if (kind === ActionKinds.SET_TILE_CROP_SELECTION) {
        const envCol = payload.envCol ?? null;
        if (!Number.isFinite(envCol)) continue;
        const col = Math.floor(envCol);
        const subjectKey = `tileCrop:${col}`;
        const recipePriority = normalizeRecipePriorityPayload(
          {
            recipePriority: payload.recipePriority,
            recipeId: normalizeCropId(payload.cropId),
          },
          { systemId: "growth", state: getStateSafe() }
        );
        const intent = makeTileCropSelectIntent({
          id: subjectKey,
          subjectKey,
          envCol: col,
          recipePriority,
          baselineRecipePriority: recipePriority,
          apCostOverride: normalizeApCost(action.apCost ?? payload.apCost),
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
        continue;
      }

      if (kind === ActionKinds.SET_HUB_RECIPE_SELECTION) {
        const hubCol = payload.hubCol ?? null;
        const systemId = payload.systemId ?? null;
        if (!Number.isFinite(hubCol) || !systemId) continue;
        const col = Math.floor(hubCol);
        const subjectKey = `hubRecipe:${col}:${systemId}`;
        const recipePriority = normalizeRecipePriorityPayload(
          {
            recipePriority: payload.recipePriority,
            recipeId: normalizeRecipeId(payload.recipeId),
          },
          { systemId, state: getStateSafe() }
        );
        const intent = makeHubRecipeSelectIntent({
          id: subjectKey,
          subjectKey,
          hubCol: col,
          systemId,
          recipePriority,
          baselineRecipePriority: recipePriority,
          apCostOverride: normalizeApCost(action.apCost ?? payload.apCost),
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
        continue;
      }
    }

    bump("rebuild");
  }

  function ensureCaches() {
    ensureActive();
    if (!cache.dirty) return;

    const state = getStateSafe();
    const apCap = state?.actionPointCap ?? 0;

    const intentList = getOrderedIntents();
    const costSummary = computeIntentCostSummary(intentList, {
      stateStart: state,
    });
    const baselineList = [];
    for (const intent of baselineIntents.values()) {
      if (intent) baselineList.push(intent);
    }
    const baselineSummary =
      baselineList.length > 0
        ? computeIntentCostSummary(baselineList, { stateStart: state })
        : { total: 0 };
    const baselineCost = baselineSummary?.total ?? 0;

    const remaining = Math.max(0, Math.floor(state?.actionPoints ?? 0));
    const baseAp = Math.max(remaining, Math.floor(apCap));

    cache.costSummary = costSummary;
    cache.plannerBudget = remaining + baselineCost;
    cache.apPreview = {
      base: baseAp,
      remaining,
      spent: costSummary.total ?? 0,
      cap: apCap,
    };

    const previewBoundaryRes = getPreviewBoundaryStateDataSafe(activeSec);
    if (previewBoundaryRes?.ok && previewBoundaryRes?.stateData != null) {
      const builtActions = buildActionsFromIntentList(intentList, state);
      if (builtActions?.ok) {
        const projection = projectActionsFromBoundaryStateData({
          boundaryStateData: previewBoundaryRes.stateData,
          actionsBySecond: [
            {
              tSec: Number.isFinite(activeSec) ? Math.floor(activeSec) : 0,
              actions: builtActions.actions,
            },
          ],
        });
        if (projection?.ok) {
          const previewState = buildPreviewSnapshot({
            baselineState: projection.baselineState,
            projectedState: projection.projectedState,
            touchedTargets: projection.touchedTargets,
            actions: builtActions.actions,
            inventoryTransferGhostPreviewEnabled:
              isInventoryTransferGhostPreviewEnabled(),
          });
          cache.previewByOwner = previewState.previewByOwner;
          cache.pawnOverrides = previewState.pawnOverrides;
          cache.tilePlanByEnvCol = previewState.tilePlanByEnvCol;
          cache.hubPlanByHubCol = previewState.hubPlanByHubCol;
        }
      }
    }

    cache.dirty = false;
  }

  function getOrderedIntents() {
    const list = [];
    for (const key of intentOrder) {
      const intent = intents.get(key);
      if (intent) list.push(intent);
    }
    return list;
  }

  function getPlannerBudget() {
    const state = getStateSafe();
    const currentAp = Math.max(0, Math.floor(state?.actionPoints ?? 0));

    const baselineList = [];
    for (const intent of baselineIntents.values()) {
      if (intent) baselineList.push(intent);
    }

    if (!baselineList.length || !state) {
      return { currentAp, baselineCost: 0, budget: currentAp };
    }

    const summary = computeIntentCostSummary(baselineList, { stateStart: state });
    const baselineCost = summary?.total ?? 0;
    return {
      currentAp,
      baselineCost,
      budget: currentAp + baselineCost,
    };
  }

  function canAffordIntent(intent, existingId, opts = {}) {
    ensureCaches();
    const state = getStateSafe();
    const budget = Math.max(
      0,
      Number.isFinite(cache.plannerBudget) ? cache.plannerBudget : 0
    );
    const key = intent?.id ?? intent?.subjectKey ?? existingId ?? null;
    const notify = opts?.notify !== false;

    if (intent?.kind === IntentKinds.PAWN_MOVE) {
      const total = Math.max(0, Math.floor(cache.costSummary?.total ?? 0));
      const existingCost =
        key != null && Number.isFinite(cache.costSummary?.byId?.[key])
          ? Math.max(0, Math.floor(cache.costSummary.byId[key]))
          : 0;
      const nextCost = Math.max(
        0,
        Math.floor(estimateIntentApCost(intent, { stateStart: state }))
      );
      const needed = total - existingCost + nextCost;
      if (needed > budget) {
        if (notify && typeof onInsufficientAp === "function") {
          onInsufficientAp({
            intent,
            needed,
            current: budget,
            budget,
          });
        }
        return {
          ok: false,
          reason: "insufficientAP",
          needed,
          current: budget,
        };
      }
      return { ok: true };
    }

    const nextList = [];
    const ordered = getOrderedIntents();
    let replaced = false;
    for (const existing of ordered) {
      const existingKey = existing?.id ?? existing?.subjectKey ?? null;
      if (key != null && existingKey === key) {
        nextList.push(intent);
        replaced = true;
      } else {
        nextList.push(existing);
      }
    }
    if (!replaced) nextList.push(intent);

    const summary = computeIntentCostSummary(nextList, { stateStart: state });
    const total = summary?.total ?? 0;

    if (total > budget) {
      if (notify && typeof onInsufficientAp === "function") {
        onInsufficientAp({
          intent,
          needed: total,
          current: budget,
          budget,
        });
      }
      return {
        ok: false,
        reason: "insufficientAP",
        needed: total,
        current: budget,
      };
    }

    return { ok: true };
  }

  function setIntent(intent) {
    const key = intent.subjectKey || getIntentSubjectKey(intent);
    if (!key) return { ok: false, reason: "badSubject" };
    intent.id = key;
    intent.subjectKey = key;
    if (!intents.has(key)) intentOrder.push(key);
    intents.set(key, intent);
    hasEdits = true;
    bump("intentChanged");
    notifyEdit("intentChanged");
    return { ok: true, intent };
  }

  function removeIntentByKey(key) {
    if (!intents.has(key)) return { ok: false, reason: "noIntent" };
    intents.delete(key);
    intentOrder = intentOrder.filter((k) => k !== key);
    if (focusIntentId === key) focusIntentId = null;
    hasEdits = true;
    bump("intentRemoved");
    notifyEdit("intentRemoved");
    return { ok: true };
  }

  function setItemTransferIntent({
    fromOwnerId,
    toOwnerId,
    itemId,
    targetGX,
    targetGY,
  }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    if (fromOwnerId == null || toOwnerId == null) {
      return { ok: false, reason: "badOwner" };
    }
    if (fromOwnerId === toOwnerId) {
      return { ok: false, reason: "sameOwner" };
    }
    if (itemId == null) return { ok: false, reason: "noItem" };

    const subjectKey = `item:${itemId}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);

    let itemSnapshot = existing?.item ?? null;
    let fromPlacement = existing?.fromPlacement ?? null;
    let baselinePlacement = existing?.baselinePlacement ?? null;

    if (!itemSnapshot || !fromPlacement) {
      const inv = getInventoryForOwner(state, fromOwnerId);
      const item = findItemInOwner(inv, itemId);
      itemSnapshot = itemSnapshot || makeItemSnapshot(item);
      if (item) {
        fromPlacement = fromPlacement || {
          ownerId: fromOwnerId,
          gx: item.gridX,
          gy: item.gridY,
        };
      }
      if (!itemSnapshot) {
        const found = findItemInState(state, itemId);
        itemSnapshot = found ? makeItemSnapshot(found.item) : null;
        if (found && !fromPlacement) {
          fromPlacement = {
            ownerId: fromOwnerId,
            gx: found.item.gridX,
            gy: found.item.gridY,
          };
        }
      }
    }

    if (!itemSnapshot || !fromPlacement) {
      return { ok: false, reason: "noItemData" };
    }

    const toPlacement = {
      ownerId: toOwnerId,
      gx: targetGX,
      gy: targetGY,
    };

    const intent = makeItemTransferIntent({
      id: subjectKey,
      subjectKey,
      itemId,
      item: itemSnapshot,
      fromOwnerId: fromPlacement.ownerId ?? fromOwnerId,
      toOwnerId,
      fromPlacement,
      toPlacement,
      baselinePlacement: baselinePlacement || clonePlacement(fromPlacement),
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if (placementEquals(intent.fromPlacement, intent.toPlacement)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function setPawnMoveIntent({
    pawnId,
    fromHubCol,
    fromEnvCol,
    toHubCol,
    toEnvCol,
  }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    const resolvedPawnId = pawnId != null ? pawnId : null;
    if (resolvedPawnId == null) return { ok: false, reason: "noPawn" };
    if (!Number.isFinite(toHubCol) && !Number.isFinite(toEnvCol)) {
      return { ok: false, reason: "badTarget" };
    }
    const targetCheck = validatePawnMoveTarget(state, { toHubCol, toEnvCol });
    if (!targetCheck.ok) return targetCheck;

    const subjectKey = `pawn:${resolvedPawnId}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);

    let fromPlacement = existing?.fromPlacement ?? null;
    let baselinePlacement = existing?.baselinePlacement ?? null;

    if (!fromPlacement) {
      const pawn = state.pawns?.find((candidatePawn) => candidatePawn.id === resolvedPawnId);
      if (pawn) {
        fromPlacement = makePawnPlacement({
          hubCol: pawn.hubCol,
          envCol: pawn.envCol,
        });
      }
    }

    if (!fromPlacement && (Number.isFinite(fromHubCol) || Number.isFinite(fromEnvCol))) {
      fromPlacement = makePawnPlacement({
        hubCol: fromHubCol,
        envCol: fromEnvCol,
      });
    }

    const normalizedHubCol =
      Number.isFinite(toHubCol) && state
        ? normalizeHubColForStructure(state, toHubCol)
        : toHubCol;
    const toPlacement = makePawnPlacement({
      hubCol: normalizedHubCol,
      envCol: toEnvCol,
    });

    const intent = makePawnMoveIntent({
      id: subjectKey,
      subjectKey,
      pawnId: resolvedPawnId,
      fromPlacement,
      toPlacement,
      baselinePlacement: baselinePlacement || clonePlacement(fromPlacement),
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if (placementEquals(intent.fromPlacement, intent.toPlacement)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function buildPawnMoveIntentForPreview({
    pawnId,
    fromHubCol,
    fromEnvCol,
    toHubCol,
    toEnvCol,
  }) {
    ensureActive();
    const state = getStateSafe();
    const resolvedPawnId = pawnId != null ? pawnId : null;
    if (resolvedPawnId == null) return { ok: false, reason: "noPawn" };
    if (!Number.isFinite(toHubCol) && !Number.isFinite(toEnvCol)) {
      return { ok: false, reason: "badTarget" };
    }
    const targetCheck = validatePawnMoveTarget(state, { toHubCol, toEnvCol });
    if (!targetCheck.ok) return targetCheck;

    const subjectKey = `pawn:${resolvedPawnId}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);

    let fromPlacement = existing?.fromPlacement ?? null;
    let baselinePlacement = existing?.baselinePlacement ?? null;

    if (!fromPlacement) {
      const pawn = state?.pawns?.find((candidatePawn) => candidatePawn.id === resolvedPawnId);
      if (pawn) {
        fromPlacement = makePawnPlacement({
          hubCol: pawn.hubCol,
          envCol: pawn.envCol,
        });
      }
    }

    if (
      !fromPlacement &&
      (Number.isFinite(fromHubCol) || Number.isFinite(fromEnvCol))
    ) {
      fromPlacement = makePawnPlacement({
        hubCol: fromHubCol,
        envCol: fromEnvCol,
      });
    }

    const normalizedHubCol =
      Number.isFinite(toHubCol) && state
        ? normalizeHubColForStructure(state, toHubCol)
        : toHubCol;
    const toPlacement = makePawnPlacement({
      hubCol: normalizedHubCol,
      envCol: toEnvCol,
    });

    const intent = makePawnMoveIntent({
      id: subjectKey,
      subjectKey,
      pawnId: resolvedPawnId,
      fromPlacement,
      toPlacement,
      baselinePlacement: baselinePlacement || clonePlacement(fromPlacement),
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "preview",
    });

    return { ok: true, intent, existingId: existing?.id ?? null };
  }

  function buildItemTransferIntentForPreview({
    fromOwnerId,
    toOwnerId,
    itemId,
    targetGX,
    targetGY,
  }) {
    ensureActive();
    const state = getStateSafe();
    if (fromOwnerId == null || toOwnerId == null) {
      return { ok: false, reason: "badOwner" };
    }
    if (itemId == null) return { ok: false, reason: "noItem" };

    const subjectKey = `item:${itemId}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);

    let itemSnapshot = existing?.item ?? null;
    let fromPlacement = existing?.fromPlacement ?? null;
    let baselinePlacement = existing?.baselinePlacement ?? null;

    if (!itemSnapshot || !fromPlacement) {
      const inv = getInventoryForOwner(state, fromOwnerId);
      const item = findItemInOwner(inv, itemId);
      itemSnapshot = itemSnapshot || makeItemSnapshot(item);
      if (item) {
        fromPlacement = fromPlacement || {
          ownerId: fromOwnerId,
          gx: item.gridX,
          gy: item.gridY,
        };
      }
      if (!itemSnapshot) {
        const found = findItemInState(state, itemId);
        itemSnapshot = found ? makeItemSnapshot(found.item) : null;
        if (found && !fromPlacement) {
          fromPlacement = {
            ownerId: fromOwnerId,
            gx: found.item.gridX,
            gy: found.item.gridY,
          };
        }
      }
    }

    if (!itemSnapshot || !fromPlacement) {
      return { ok: false, reason: "noItemData" };
    }

    const toPlacement = {
      ownerId: toOwnerId,
      gx: targetGX ?? 0,
      gy: targetGY ?? 0,
    };

    const intent = makeItemTransferIntent({
      id: subjectKey,
      subjectKey,
      itemId,
      item: itemSnapshot,
      fromOwnerId: fromPlacement.ownerId ?? fromOwnerId,
      toOwnerId,
      fromPlacement,
      toPlacement,
      baselinePlacement: baselinePlacement || clonePlacement(fromPlacement),
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "preview",
    });

    return { ok: true, intent, existingId: existing?.id ?? null };
  }

  function getPawnMoveAffordability(spec) {
    ensureActive();
    const state = getStateSafe();
    const built = buildPawnMoveIntentForPreview(spec || {});
    if (!built.ok) return built;
    const intent = built.intent;
    if (placementEquals(intent.fromPlacement, intent.toPlacement)) {
      return { ok: true, affordable: true, cost: 0 };
    }
    const cost = estimateIntentApCost(intent, { stateStart: state });
    const afford = canAffordIntent(intent, built.existingId, { notify: false });
    return {
      ok: true,
      affordable: afford.ok === true,
      cost,
      reason: afford.reason,
      needed: afford.needed,
      current: afford.current,
    };
  }

  function getItemTransferAffordability(spec) {
    ensureActive();
    const state = getStateSafe();
    const built = buildItemTransferIntentForPreview(spec || {});
    if (!built.ok) return built;
    const intent = built.intent;
    if (placementEquals(intent.fromPlacement, intent.toPlacement)) {
      return { ok: true, affordable: true, cost: 0 };
    }
    const cost = estimateIntentApCost(intent, { stateStart: state });
    const afford = canAffordIntent(intent, built.existingId, { notify: false });
    return {
      ok: true,
      affordable: afford.ok === true,
      cost,
      reason: afford.reason,
      needed: afford.needed,
      current: afford.current,
    };
  }

  function setBuildDesignationIntent({ buildKey, defId, target }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    const targetCol = normalizeBuildHubCol(target);
    const fallbackKey =
      buildKey ||
      (Number.isFinite(targetCol) ? `hub:${Math.floor(targetCol)}` : null);
    if (!fallbackKey) return { ok: false, reason: "noBuildKey" };
    if (!defId) return { ok: false, reason: "badDefId" };

    const placementCheck = validateHubConstructionPlacement(
      state,
      defId,
      targetCol
    );
    if (!placementCheck?.ok) return placementCheck || { ok: false, reason: "badPlacement" };

    const resolvedKey =
      Number.isFinite(placementCheck.hubCol)
        ? `hub:${Math.floor(placementCheck.hubCol)}`
        : fallbackKey;

    const subjectKey = `build:${resolvedKey}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);

    const normalizedTarget =
      target && typeof target === "object"
        ? { ...target, hubCol: placementCheck.hubCol }
        : { hubCol: placementCheck.hubCol };

    const intent = makeBuildDesignateIntent({
      id: subjectKey,
      subjectKey,
      buildKey: resolvedKey,
      defId: defId ?? existing?.defId ?? null,
      target: normalizedTarget ?? existing?.target ?? null,
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function setTileTagOrderIntent({ envCol, tagIds }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };

    const col = Math.floor(envCol);
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) return { ok: false, reason: "noTile" };
    const existingTags = Array.isArray(tile.tags) ? tile.tags : [];
    const nextTags = normalizeTagList(tagIds);
    if (!hasSameTagSet(existingTags, nextTags)) {
      return { ok: false, reason: "tagSetMismatch" };
    }
    for (let i = 0; i < existingTags.length; i++) {
      const tagId = existingTags[i];
      if (hasPlannerVisibleEnvTagUnlock(state, tagId)) continue;
      if (nextTags[i] !== tagId) return { ok: false, reason: "tagLocked" };
    }

    const subjectKey = `tileTags:${col}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const baselineTags =
      cloneTagList(existing?.baselineTags) ??
      cloneTagList(existing?.tagIds) ??
      cloneTagList(existingTags);

    const intent = makeTileTagOrderIntent({
      id: subjectKey,
      subjectKey,
      envCol: col,
      tagIds: nextTags,
      baselineTags,
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if (tagListsEqual(intent.tagIds, intent.baselineTags)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function setHubTagOrderIntent({ hubCol, tagIds }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };

    const col = Math.floor(hubCol);
    const structure = getHubStructureAtCol(state, col);
    if (!structure) return { ok: false, reason: "noHubStructure" };
    const existingTags = Array.isArray(structure.tags) ? structure.tags : [];
    const nextTags = normalizeTagList(tagIds);
    if (!hasSameTagSet(existingTags, nextTags)) {
      return { ok: false, reason: "tagSetMismatch" };
    }
    for (let i = 0; i < existingTags.length; i++) {
      const tagId = existingTags[i];
      if (hasHubTagUnlock(state, tagId)) continue;
      if (nextTags[i] !== tagId) return { ok: false, reason: "tagLocked" };
    }

    const subjectKey = `hubTags:${col}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const baselineTags =
      cloneTagList(existing?.baselineTags) ??
      cloneTagList(existing?.tagIds) ??
      cloneTagList(existingTags);

    const intent = makeHubTagOrderIntent({
      id: subjectKey,
      subjectKey,
      hubCol: col,
      tagIds: nextTags,
      baselineTags,
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if (tagListsEqual(intent.tagIds, intent.baselineTags)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function setTileTagToggleIntent({ envCol, tagId, disabled }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
    if (!tagId) return { ok: false, reason: "badTagId" };

    const col = Math.floor(envCol);
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) return { ok: false, reason: "noTile" };
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    if (!tags.includes(tagId)) return { ok: false, reason: "tagNotOnTile" };
    if (!hasPlannerVisibleEnvTagUnlock(state, tagId)) {
      return { ok: false, reason: "tagLocked" };
    }

    const subjectKey = `tileTagToggle:${col}:${tagId}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const currentState = getTagDisableState(tile, tagId);
    const baselineDisabled =
      existing?.baselineDisabled ?? currentState.disabled;
    const nextDisabled =
      typeof disabled === "boolean" ? disabled : !baselineDisabled;
    if (!nextDisabled && currentState.eventDisabledCount > 0) {
      return { ok: false, reason: "tagLockedByEvent" };
    }

    const intent = makeTileTagToggleIntent({
      id: subjectKey,
      subjectKey,
      envCol: col,
      tagId,
      disabled: nextDisabled,
      baselineDisabled,
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if ((intent.disabled ?? null) === (intent.baselineDisabled ?? null)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function setHubTagToggleIntent({ hubCol, tagId, disabled }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
    if (!tagId) return { ok: false, reason: "badTagId" };

    const col = Math.floor(hubCol);
    const structure = getHubStructureAtCol(state, col);
    if (!structure) return { ok: false, reason: "noHubStructure" };
    const tags = Array.isArray(structure.tags) ? structure.tags : [];
    if (!tags.includes(tagId)) return { ok: false, reason: "tagNotOnHub" };
    if (!hasHubTagUnlock(state, tagId)) return { ok: false, reason: "tagLocked" };

    const subjectKey = `hubTagToggle:${col}:${tagId}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const currentState = getTagDisableState(structure, tagId);
    const baselineDisabled =
      existing?.baselineDisabled ?? currentState.disabled;
    const nextDisabled =
      typeof disabled === "boolean" ? disabled : !baselineDisabled;
    if (!nextDisabled && currentState.eventDisabledCount > 0) {
      return { ok: false, reason: "tagLockedByEvent" };
    }

    const intent = makeHubTagToggleIntent({
      id: subjectKey,
      subjectKey,
      hubCol: col,
      tagId,
      disabled: nextDisabled,
      baselineDisabled,
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if ((intent.disabled ?? null) === (intent.baselineDisabled ?? null)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function getTileTagTogglePreview({ envCol, tagId } = {}) {
    ensureCaches();
    if (!Number.isFinite(envCol) || !tagId) return null;
    const col = Math.floor(envCol);
    const preview = cache.tilePlanByEnvCol.get(col) ?? null;
    if (preview?.tagDisabledById && Object.prototype.hasOwnProperty.call(preview.tagDisabledById, tagId)) {
      return preview.tagDisabledById[tagId] === true;
    }
    const state = getStateSafe();
    const tile = state?.board?.occ?.tile?.[col];
    if (!hasPlannerVisibleEnvTagUnlock(state, tagId)) return true;
    return tile?.tagStates?.[tagId]?.disabled === true;
  }

  function getHubTagTogglePreview({ hubCol, tagId } = {}) {
    ensureCaches();
    if (!Number.isFinite(hubCol) || !tagId) return null;
    const col = Math.floor(hubCol);
    const preview = cache.hubPlanByHubCol.get(col) ?? null;
    if (preview?.tagDisabledById && Object.prototype.hasOwnProperty.call(preview.tagDisabledById, tagId)) {
      return preview.tagDisabledById[tagId] === true;
    }
    const state = getStateSafe();
    const structure =
      state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure ?? null;
    if (!hasHubTagUnlock(state, tagId)) return true;
    return structure?.tagStates?.[tagId]?.disabled === true;
  }

  function setTileCropSelectionIntent({ envCol, cropId, recipePriority }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };

    const col = Math.floor(envCol);
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) return { ok: false, reason: "noTile" };
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    if (!tags.includes("farmable")) {
      return { ok: false, reason: "notFarmable" };
    }
    if (!hasEnvTagUnlock(state, "farmable")) {
      return { ok: false, reason: "tagLocked" };
    }

    const nextCropId = normalizeCropId(cropId);
    if (nextCropId && !cropDefs[nextCropId]) {
      return { ok: false, reason: "badCropId" };
    }
    if (recipePriority && typeof recipePriority === "object") {
      const orderedRaw = Array.isArray(recipePriority.ordered)
        ? recipePriority.ordered
        : [];
      for (const rawId of orderedRaw) {
        const cropIdFromPriority = normalizeCropId(rawId);
        if (!cropIdFromPriority) continue;
        if (!cropDefs[cropIdFromPriority]) {
          return { ok: false, reason: "badCropId" };
        }
      }
    }

    const nextCropPriority = normalizeRecipePriorityPayload(
      {
        recipePriority,
        recipeId: nextCropId,
      },
      { systemId: "growth", state }
    );

    const subjectKey = `tileCrop:${col}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const currentCropPriority = getCurrentTileCropPriority(tile, state);
    const baselineCropPriority =
      existing?.baselineRecipePriority ??
      existing?.recipePriority ??
      currentCropPriority;

    const intent = makeTileCropSelectIntent({
      id: subjectKey,
      subjectKey,
      envCol: col,
      recipePriority: nextCropPriority,
      baselineRecipePriority: baselineCropPriority,
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if (
      recipePrioritiesEqual(
        intent.recipePriority,
        intent.baselineRecipePriority
      )
    ) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function setHubRecipeSelectionIntent({
    hubCol,
    systemId,
    recipePriority,
    recipeId,
  }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
    if (!systemId) return { ok: false, reason: "badSystemId" };

    const anchorCol = normalizeHubColForStructure(state, hubCol);
    if (!Number.isFinite(anchorCol)) return { ok: false, reason: "badHubCol" };
    const structure = getHubStructureAtCol(state, anchorCol);
    if (!structure) return { ok: false, reason: "noHubStructure" };

    const hasSystem =
      structure.systemState?.[systemId] ||
      Object.prototype.hasOwnProperty.call(structure.systemTiers || {}, systemId);
    if (!hasSystem) return { ok: false, reason: "missingSystem" };

    const expectedKind = getRecipeKindForHubSystem(systemId);
    const availability = computeAvailableRecipesAndBuildings(state);
    if (recipePriority && typeof recipePriority === "object") {
      const orderedRaw = Array.isArray(recipePriority.ordered)
        ? recipePriority.ordered
        : [];
      for (const rawId of orderedRaw) {
        const nextRecipeId = normalizeRecipeId(rawId);
        if (!nextRecipeId) continue;
        if (!recipeDefs[nextRecipeId]) {
          return { ok: false, reason: "badRecipeId" };
        }
        if (!availability.recipeIds?.has(nextRecipeId)) {
          return { ok: false, reason: "recipeLocked" };
        }
        const actualKind = recipeDefs[nextRecipeId]?.kind ?? null;
        if (expectedKind && actualKind && expectedKind !== actualKind) {
          return { ok: false, reason: "badRecipeKind" };
        }
      }
    }

    const nextRecipePriority = normalizeRecipePriorityPayload(
      {
        recipePriority,
        recipeId: normalizeRecipeId(recipeId),
      },
      { systemId, state }
    );

    const subjectKey = `hubRecipe:${anchorCol}:${systemId}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const currentRecipePriority = getCurrentRecipePriority(structure, systemId, state);
    const baselineRecipePriority =
      existing?.baselineRecipePriority ?? existing?.recipePriority ?? currentRecipePriority;

    const intent = makeHubRecipeSelectIntent({
      id: subjectKey,
      subjectKey,
      hubCol: anchorCol,
      systemId,
      recipePriority: nextRecipePriority,
      baselineRecipePriority,
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if (recipePrioritiesEqual(intent.recipePriority, intent.baselineRecipePriority)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function buildActionsFromIntentList(intentList, state) {
    const actions = [];
    const orderedIntents = Array.isArray(intentList) ? intentList : [];
    const costSummary = computeIntentCostSummary(orderedIntents, {
      stateStart: state,
    });
    const costById = costSummary?.byId || {};

    for (const intent of orderedIntents) {
      if (!intent) continue;
      if (intent.kind === IntentKinds.ITEM_TRANSFER) {
        const to = intent.toPlacement;
        if (!to) continue;
        const payload = {
          fromOwnerId: intent.fromOwnerId,
          toOwnerId: intent.toOwnerId,
          itemId: intent.itemId,
          targetGX: to.gx,
          targetGY: to.gy,
          fromPlacement: intent.fromPlacement,
          toPlacement: intent.toPlacement,
          item: intent.item,
        };
        const apCost =
          intent?.id != null && Number.isFinite(costById[intent.id])
            ? costById[intent.id]
            : estimateIntentApCost(intent, { stateStart: state });
        actions.push({
          kind: ActionKinds.INVENTORY_MOVE,
          payload,
          apCost,
        });
      } else if (intent.kind === IntentKinds.PAWN_MOVE) {
        const toPlacement = intent.toPlacement ?? null;
        const toHubCol = toPlacement?.hubCol ?? null;
        const toEnvCol = toPlacement?.envCol ?? null;
        if (toHubCol == null && toEnvCol == null) continue;
        const apCost =
          intent?.id != null && Number.isFinite(costById[intent.id])
            ? costById[intent.id]
            : estimateIntentApCost(intent, { stateStart: state });
        const payload = {
          pawnId: intent.pawnId,
          fromPlacement: clonePlacement(intent.fromPlacement),
          toPlacement: clonePlacement(toPlacement),
        };
        if (toHubCol != null) {
          payload.hubCol = toHubCol;
          payload.toHubCol = toHubCol;
          payload.fromHubCol = intent.fromPlacement?.hubCol ?? null;
        }
        if (toEnvCol != null) {
          payload.envCol = toEnvCol;
          payload.toEnvCol = toEnvCol;
          payload.fromEnvCol = intent.fromPlacement?.envCol ?? null;
        }
        actions.push({
          kind: ActionKinds.PLACE_PAWN,
          payload,
          apCost,
        });
      } else if (intent.kind === IntentKinds.BUILD_DESIGNATE) {
        const apCost =
          intent?.id != null && Number.isFinite(costById[intent.id])
            ? costById[intent.id]
            : estimateIntentApCost(intent, { stateStart: state });
        actions.push({
          kind: ActionKinds.BUILD_DESIGNATE,
          payload: {
            buildKey: intent.buildKey,
            defId: intent.defId ?? null,
            target: intent.target ?? null,
          },
          apCost,
        });
      } else if (intent.kind === IntentKinds.TILE_TAG_ORDER) {
        if (!Number.isFinite(intent.envCol)) continue;
        const apCost =
          intent?.id != null && Number.isFinite(costById[intent.id])
            ? costById[intent.id]
            : estimateIntentApCost(intent, { stateStart: state });
        actions.push({
          kind: ActionKinds.SET_TILE_TAG_ORDER,
          payload: {
            envCol: Math.floor(intent.envCol),
            tagIds: Array.isArray(intent.tagIds) ? intent.tagIds.slice() : [],
          },
          apCost,
        });
      } else if (intent.kind === IntentKinds.HUB_TAG_ORDER) {
        if (!Number.isFinite(intent.hubCol)) continue;
        const apCost =
          intent?.id != null && Number.isFinite(costById[intent.id])
            ? costById[intent.id]
            : estimateIntentApCost(intent, { stateStart: state });
        actions.push({
          kind: ActionKinds.SET_HUB_TAG_ORDER,
          payload: {
            hubCol: Math.floor(intent.hubCol),
            tagIds: Array.isArray(intent.tagIds) ? intent.tagIds.slice() : [],
          },
          apCost,
        });
      } else if (intent.kind === IntentKinds.TILE_TAG_TOGGLE) {
        if (!Number.isFinite(intent.envCol) || !intent.tagId) continue;
        const apCost =
          intent?.id != null && Number.isFinite(costById[intent.id])
            ? costById[intent.id]
            : estimateIntentApCost(intent, { stateStart: state });
        actions.push({
          kind: ActionKinds.TOGGLE_TILE_TAG,
          payload: {
            envCol: Math.floor(intent.envCol),
            tagId: intent.tagId,
            disabled: intent.disabled === true,
          },
          apCost,
        });
      } else if (intent.kind === IntentKinds.HUB_TAG_TOGGLE) {
        if (!Number.isFinite(intent.hubCol) || !intent.tagId) continue;
        const apCost =
          intent?.id != null && Number.isFinite(costById[intent.id])
            ? costById[intent.id]
            : estimateIntentApCost(intent, { stateStart: state });
        actions.push({
          kind: ActionKinds.TOGGLE_HUB_TAG,
          payload: {
            hubCol: Math.floor(intent.hubCol),
            tagId: intent.tagId,
            disabled: intent.disabled === true,
          },
          apCost,
        });
      } else if (intent.kind === IntentKinds.TILE_CROP_SELECT) {
        if (!Number.isFinite(intent.envCol)) continue;
        const apCost =
          intent?.id != null && Number.isFinite(costById[intent.id])
            ? costById[intent.id]
            : estimateIntentApCost(intent, { stateStart: state });
        actions.push({
          kind: ActionKinds.SET_TILE_CROP_SELECTION,
          payload: {
            envCol: Math.floor(intent.envCol),
            cropId: intent.cropId ?? null,
            recipePriority: cloneRecipePriority(intent.recipePriority),
          },
          apCost,
        });
      } else if (intent.kind === IntentKinds.HUB_RECIPE_SELECT) {
        if (!Number.isFinite(intent.hubCol) || !intent.systemId) continue;
        const apCost =
          intent?.id != null && Number.isFinite(costById[intent.id])
            ? costById[intent.id]
            : estimateIntentApCost(intent, { stateStart: state });
        actions.push({
          kind: ActionKinds.SET_HUB_RECIPE_SELECTION,
          payload: {
            hubCol: Math.floor(intent.hubCol),
            systemId: intent.systemId,
            recipePriority: cloneRecipePriority(intent.recipePriority),
          },
          apCost,
        });
      }
    }

    return {
      ok: true,
      actions,
      costSummary,
    };
  }

  function buildCommitActions() {
    ensureActive();
    const state = getStateSafe();
    return buildActionsFromIntentList(getOrderedIntents(), state);
  }

  function resetToTimeline() {
    intents.clear();
    baselineIntents.clear();
    intentOrder = [];
    focusIntentId = null;
    hasEdits = false;
    activeSec = null;
    activeRevision = null;
    clearCaches();
    bump("resetToTimeline");
    ensureActive();
  }

  function markCommitted({ tSec, revision } = {}) {
    const normalizedCommitted = new Map();
    for (const [key, intent] of intents.entries()) {
      const normalized = normalizeCommittedIntentBaseline(intent);
      if (!normalized) continue;
      normalizedCommitted.set(key, normalized);
    }

    intents.clear();
    baselineIntents.clear();
    intentOrder = intentOrder.filter((key) => normalizedCommitted.has(key));

    for (const key of intentOrder) {
      const intent = normalizedCommitted.get(key);
      if (!intent) continue;
      intents.set(key, cloneIntent(intent));
      baselineIntents.set(key, cloneIntent(intent));
    }

    for (const [key, intent] of normalizedCommitted.entries()) {
      if (intents.has(key)) continue;
      intents.set(key, cloneIntent(intent));
      baselineIntents.set(key, cloneIntent(intent));
      intentOrder.push(key);
    }

    hasEdits = false;
    activeSec = Number.isFinite(tSec) ? Math.floor(tSec) : activeSec;
    activeRevision = Number.isFinite(revision)
      ? Math.floor(revision)
      : activeRevision;
    clearCaches();
    bump("commitSync");
  }


  function hasItemTransferIntent(itemId) {
    ensureActive();
    if (!isInventoryTransferGhostPreviewEnabled()) return false;
    if (itemId == null) return false;
    const key = `item:${itemId}`;
    const intent = intents.get(key);
    if (!intent || intent.kind !== IntentKinds.ITEM_TRANSFER) return false;
    return intent.fromOwnerId !== intent.toOwnerId;
  }

  function toggleFocus(intentId) {
    ensureActive();
    if (focusIntentId === intentId) focusIntentId = null;
    else focusIntentId = intentId;
    bump("focusChanged");
    return { ok: true, focusIntentId };
  }

  return {
    getVersion: () => version,
    getOrderedIntents: () => {
      ensureCaches();
      return getOrderedIntents();
    },
    getApPreview: () => {
      ensureCaches();
      return cache.apPreview || {
        base: 0,
        remaining: 0,
        spent: 0,
        cap: 0,
      };
    },
    getIntentCost(intentId) {
      ensureCaches();
      return cache.costSummary?.byId?.[intentId] ?? 0;
    },
    getInventoryPreview(ownerId) {
      ensureCaches();
      return cache.previewByOwner.get(ownerId) || createEmptyInventoryPreview();
    },
    getPawnOverridePlacement(pawnId) {
      ensureCaches();
      return cache.pawnOverrides.get(pawnId) ?? null;
    },
    getPawnOverrideHubCol(pawnId) {
      ensureCaches();
      const placement = cache.pawnOverrides.get(pawnId) ?? null;
      return placement?.hubCol ?? null;
    },
    getTilePlanPreview(envCol) {
      ensureCaches();
      if (!Number.isFinite(envCol)) return null;
      return cache.tilePlanByEnvCol.get(Math.floor(envCol)) ?? null;
    },
    getHubPlanPreview(hubCol) {
      ensureCaches();
      if (!Number.isFinite(hubCol)) return null;
      return cache.hubPlanByHubCol.get(Math.floor(hubCol)) ?? null;
    },
    hasItemTransferIntent(itemId) {
      return hasItemTransferIntent(itemId);
    },
    getFocusIntent() {
      ensureActive();
      if (!focusIntentId) return null;
      return intents.get(focusIntentId) || null;
    },
    toggleFocus,
    setItemTransferIntent,
    setPawnMoveIntent,
    getPawnMoveAffordability,
    getItemTransferAffordability,
    setBuildDesignationIntent,
    setTileTagOrderIntent,
    setHubTagOrderIntent,
    setTileTagToggleIntent,
    setHubTagToggleIntent,
    getTileTagTogglePreview,
    getHubTagTogglePreview,
    setTileCropSelectionIntent,
    setHubRecipeSelectionIntent,
    removeIntent(intentId) {
      ensureActive();
      return removeIntentByKey(intentId);
    },
    buildCommitActions,
    resetToTimeline,
    markCommitted,
  };
}
