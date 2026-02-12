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
import { placementEquals } from "./action-placement-utils.js";
import { validateHubConstructionPlacement } from "../../model/build-helpers.js";
import { computeAvailableRecipesAndBuildings } from "../../model/skills.js";

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
  };
}

function cloneTagList(tags) {
  return Array.isArray(tags) ? tags.slice() : null;
}

function normalizeTagList(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => typeof tag === "string");
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

function normalizeCropId(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function normalizeRecipeId(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function getRecipeKindForHubSystem(systemId) {
  if (systemId === "fireplace") return "cook";
  if (systemId === "workspace") return "craft";
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

export function createActionPlanner({
  getTimeline,
  getState,
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
  }

  function getTimelineSafe() {
    return typeof getTimeline === "function" ? getTimeline() : null;
  }

  function getStateSafe() {
    return typeof getState === "function" ? getState() : null;
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
        const cropId = normalizeCropId(payload.cropId);
        const intent = makeTileCropSelectIntent({
          id: subjectKey,
          subjectKey,
          envCol: col,
          cropId,
          baselineCropId: cropId,
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
        const recipeId = normalizeRecipeId(payload.recipeId);
        const intent = makeHubRecipeSelectIntent({
          id: subjectKey,
          subjectKey,
          hubCol: col,
          systemId,
          recipeId,
          baselineRecipeId: recipeId,
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

    buildInventoryPreviewCaches();
    buildPawnOverrideCache();

    cache.dirty = false;
  }

  function buildInventoryPreviewCaches() {
    cache.previewByOwner.clear();

    const baselineByKey = baselineIntents;
    const currentByKey = intents;

    const moves = [];

    for (const [key, baseIntent] of baselineByKey.entries()) {
      if (baseIntent.kind !== IntentKinds.ITEM_TRANSFER) continue;
      const cur = currentByKey.get(key);
      const baseTo = baseIntent.toPlacement;
      const baseFrom = baseIntent.fromPlacement;
      if (!cur) {
        if (baseTo && baseFrom) {
          moves.push({
            intentId: key,
            item: baseIntent.item,
            from: baseTo,
            to: baseFrom,
          });
        }
        continue;
      }
      if (!placementEquals(cur.toPlacement, baseTo)) {
        if (baseTo && cur.toPlacement) {
          moves.push({
            intentId: key,
            item: cur.item || baseIntent.item,
            from: baseTo,
            to: cur.toPlacement,
          });
        }
      }
    }

    for (const [key, curIntent] of currentByKey.entries()) {
      if (curIntent.kind !== IntentKinds.ITEM_TRANSFER) continue;
      if (baselineByKey.has(key)) continue;

      const baseFrom = curIntent.baselinePlacement || curIntent.fromPlacement;
      const to = curIntent.toPlacement;
      if (baseFrom && to && !placementEquals(baseFrom, to)) {
        moves.push({
          intentId: key,
          item: curIntent.item,
          from: baseFrom,
          to,
        });
      }
    }

    for (const move of moves) {
      const item = move.item;
      if (!item || !move.from || !move.to) continue;

      const fromOwnerId = move.from.ownerId;
      const toOwnerId = move.to.ownerId;
      if (fromOwnerId == null || toOwnerId == null) continue;

      const fromPreview = getOrCreateOwnerPreview(fromOwnerId);
      fromPreview.hiddenItemIds.add(item.id);

      const toPreview = getOrCreateOwnerPreview(toOwnerId);
      toPreview.overlayItems.push({
        ...item,
        sourceOwnerId: move.from.ownerId,
        ownerId: toOwnerId,
        gridX: move.to.gx,
        gridY: move.to.gy,
        intentId: move.intentId,
        isGhost: false,
      });
    }

    for (const [key, curIntent] of currentByKey.entries()) {
      if (curIntent.kind !== IntentKinds.ITEM_TRANSFER) continue;
      if (curIntent.fromOwnerId === curIntent.toOwnerId) continue;
      if (!curIntent.fromPlacement) continue;

      const item = curIntent.item;
      if (!item) continue;

      const ownerId = curIntent.fromPlacement.ownerId ?? curIntent.fromOwnerId;
      if (ownerId == null) continue;

      const ghostEntry = {
        ...item,
        ownerId,
        gridX: curIntent.fromPlacement.gx,
        gridY: curIntent.fromPlacement.gy,
        intentId: key,
        isGhost: true,
      };
      const preview = getOrCreateOwnerPreview(ownerId);
      preview.ghostItems.push(ghostEntry);
    }
  }

  function getOrCreateOwnerPreview(ownerId) {
    let entry = cache.previewByOwner.get(ownerId);
    if (!entry) {
      entry = {
        hiddenItemIds: new Set(),
        overlayItems: [],
        ghostItems: [],
      };
      cache.previewByOwner.set(ownerId, entry);
    }
    return entry;
  }

  function buildPawnOverrideCache() {
    cache.pawnOverrides.clear();

    for (const [key, baseIntent] of baselineIntents.entries()) {
      if (baseIntent.kind !== IntentKinds.PAWN_MOVE) continue;
      const cur = intents.get(key);
      const baseTo = baseIntent.toPlacement ?? null;
      const baseFrom = baseIntent.fromPlacement ?? null;
      if (!cur) {
        if (baseFrom) {
          cache.pawnOverrides.set(
            baseIntent.pawnId,
            clonePlacement(baseFrom)
          );
        }
        continue;
      }
      const curTo = cur.toPlacement ?? null;
      if (curTo && !placementEquals(curTo, baseTo)) {
        cache.pawnOverrides.set(
          baseIntent.pawnId,
          clonePlacement(curTo)
        );
      }
    }

    for (const [key, curIntent] of intents.entries()) {
      if (curIntent.kind !== IntentKinds.PAWN_MOVE) continue;
      if (baselineIntents.has(key)) continue;

      const baseFrom = curIntent.baselinePlacement ?? null;
      const curTo = curIntent.toPlacement ?? null;
      if (curTo && !placementEquals(curTo, baseFrom)) {
        cache.pawnOverrides.set(
          curIntent.pawnId,
          clonePlacement(curTo)
        );
      }
    }
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
    if (Number.isFinite(toEnvCol)) {
      const col = Math.floor(toEnvCol);
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
    }

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
    const resolvedKey =
      buildKey ||
      (Number.isFinite(targetCol) ? `hub:${Math.floor(targetCol)}` : null);
    if (!resolvedKey) return { ok: false, reason: "noBuildKey" };
    if (!defId) return { ok: false, reason: "badDefId" };

    const placementCheck = validateHubConstructionPlacement(
      state,
      defId,
      targetCol
    );
    if (!placementCheck?.ok) return placementCheck || { ok: false, reason: "badPlacement" };

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

    const subjectKey = `tileTags:${col}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const baselineTags =
      cloneTagList(existing?.baselineTags) ??
      cloneTagList(existing?.tagIds) ??
      cloneTagList(tile.tags);
    const nextTags = normalizeTagList(tagIds);

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

    const subjectKey = `hubTags:${col}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const baselineTags =
      cloneTagList(existing?.baselineTags) ??
      cloneTagList(existing?.tagIds) ??
      cloneTagList(structure.tags);
    const nextTags = normalizeTagList(tagIds);

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
    ensureActive();
    if (!Number.isFinite(envCol) || !tagId) return null;
    const col = Math.floor(envCol);
    const subjectKey = `tileTagToggle:${col}:${tagId}`;
    const intent = intents.get(subjectKey);
    if (intent && intent.kind === IntentKinds.TILE_TAG_TOGGLE) {
      return intent.disabled === true;
    }
    const state = getStateSafe();
    const tile = state?.board?.occ?.tile?.[col];
    return tile?.tagStates?.[tagId]?.disabled === true;
  }

  function getHubTagTogglePreview({ hubCol, tagId } = {}) {
    ensureActive();
    if (!Number.isFinite(hubCol) || !tagId) return null;
    const col = Math.floor(hubCol);
    const subjectKey = `hubTagToggle:${col}:${tagId}`;
    const intent = intents.get(subjectKey);
    if (intent && intent.kind === IntentKinds.HUB_TAG_TOGGLE) {
      return intent.disabled === true;
    }
    const state = getStateSafe();
    const structure =
      state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure ?? null;
    return structure?.tagStates?.[tagId]?.disabled === true;
  }

  function setTileCropSelectionIntent({ envCol, cropId }) {
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

    const nextCropId = normalizeCropId(cropId);
    if (nextCropId && !cropDefs[nextCropId]) {
      return { ok: false, reason: "badCropId" };
    }

    const subjectKey = `tileCrop:${col}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const tileCropId = tile.systemState?.growth?.selectedCropId ?? null;
    const baselineCropId =
      existing?.baselineCropId ?? existing?.cropId ?? tileCropId;

    const intent = makeTileCropSelectIntent({
      id: subjectKey,
      subjectKey,
      envCol: col,
      cropId: nextCropId,
      baselineCropId,
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if ((intent.cropId ?? null) === (intent.baselineCropId ?? null)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function setHubRecipeSelectionIntent({ hubCol, systemId, recipeId }) {
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

    const nextRecipeId = normalizeRecipeId(recipeId);
    if (nextRecipeId && !recipeDefs[nextRecipeId]) {
      return { ok: false, reason: "badRecipeId" };
    }
    if (nextRecipeId) {
      const availability = computeAvailableRecipesAndBuildings(state);
      if (!availability.recipeIds?.has(nextRecipeId)) {
        return { ok: false, reason: "recipeLocked" };
      }
    }
    if (nextRecipeId) {
      const expectedKind = getRecipeKindForHubSystem(systemId);
      const actualKind = recipeDefs[nextRecipeId]?.kind ?? null;
      if (expectedKind && actualKind && expectedKind !== actualKind) {
        return { ok: false, reason: "badRecipeKind" };
      }
    }

    const subjectKey = `hubRecipe:${anchorCol}:${systemId}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);
    const currentRecipeId =
      structure.systemState?.[systemId]?.selectedRecipeId ?? null;
    const baselineRecipeId =
      existing?.baselineRecipeId ?? existing?.recipeId ?? currentRecipeId;

    const intent = makeHubRecipeSelectIntent({
      id: subjectKey,
      subjectKey,
      hubCol: anchorCol,
      systemId,
      recipeId: nextRecipeId,
      baselineRecipeId,
      apCostOverride:
        existing?.source === "timeline" ? null : existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if ((intent.recipeId ?? null) === (intent.baselineRecipeId ?? null)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function buildCommitActions() {
    ensureActive();
    const state = getStateSafe();
    const actions = [];
    const costSummary = computeIntentCostSummary(getOrderedIntents(), {
      stateStart: state,
    });
    const costById = costSummary?.byId || {};

    for (const intent of getOrderedIntents()) {
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
            recipeId: intent.recipeId ?? null,
          },
          apCost,
        });
      }
    }

    return { ok: true, actions };
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
    baselineIntents.clear();
    for (const [key, intent] of intents.entries()) {
      baselineIntents.set(key, cloneIntent(intent));
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
      return (
        cache.previewByOwner.get(ownerId) || {
          hiddenItemIds: new Set(),
          overlayItems: [],
          ghostItems: [],
        }
      );
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
