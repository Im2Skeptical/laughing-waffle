// src/controllers/action-planner.js
// Stateful planner: holds editable intents for a single tSec.

import { ActionKinds } from "../model/actions.js";
import {
  IntentKinds,
  makeItemTransferIntent,
  makePawnMoveIntent,
  makeBuildDesignateIntent,
} from "./action-intents.js";
import {
  estimateIntentApCost,
  computeIntentCostSummary,
} from "./action-costs.js";

function placementEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.ownerId === b.ownerId &&
    a.gx === b.gx &&
    a.gy === b.gy &&
    a.slotIndex === b.slotIndex
  );
}

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
  };
}

function normalizeApCost(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function createActionPlanner({
  getTimeline,
  getState,
  onInvalidate,
  onEdit,
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
    previewByOwner: new Map(),
    ghostsByOwner: new Map(),
    characterOverrides: new Map(),
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
    cache.previewByOwner.clear();
    cache.ghostsByOwner.clear();
    cache.characterOverrides.clear();
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
          apCostOverride: normalizeApCost(action.apCost ?? payload.apCost),
          source: "timeline",
        });

        baselineIntents.set(subjectKey, intent);
        intents.set(subjectKey, cloneIntent(intent));
        if (!intentOrder.includes(subjectKey)) intentOrder.push(subjectKey);
        continue;
      }

      if (kind === ActionKinds.PLACE_CHARACTER) {
        const charId = payload.charId ?? null;
        if (charId == null) continue;

        const toSlotIndex =
          payload.toSlotIndex ??
          payload.slotIndex ??
          payload.slot ??
          null;
        const fromSlotIndex =
          payload.fromSlotIndex != null ? payload.fromSlotIndex : null;

        const subjectKey = `pawn:${charId}`;
        const intent = makePawnMoveIntent({
          id: subjectKey,
          subjectKey,
          charId,
          fromPlacement:
            fromSlotIndex != null ? { slotIndex: fromSlotIndex } : null,
          toPlacement:
            toSlotIndex != null ? { slotIndex: toSlotIndex } : null,
          baselinePlacement:
            toSlotIndex != null ? { slotIndex: toSlotIndex } : null,
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

    const remaining = Math.max(0, Math.floor(state?.actionPoints ?? 0));
    const baseAp = Math.max(remaining, Math.floor(apCap));

    cache.costSummary = costSummary;
    cache.apPreview = {
      base: baseAp,
      remaining,
      spent: costSummary.total ?? 0,
      cap: apCap,
    };

    buildInventoryPreviewCaches();
    buildCharacterOverrideCache();

    cache.dirty = false;
  }

  function buildInventoryPreviewCaches() {
    cache.previewByOwner.clear();
    cache.ghostsByOwner.clear();

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

      const ghosts = getOrCreateGhosts(ownerId);
      const ghostEntry = {
        ...item,
        ownerId,
        gridX: curIntent.fromPlacement.gx,
        gridY: curIntent.fromPlacement.gy,
        intentId: key,
        isGhost: true,
      };
      ghosts.push(ghostEntry);
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

  function getOrCreateGhosts(ownerId) {
    let list = cache.ghostsByOwner.get(ownerId);
    if (!list) {
      list = [];
      cache.ghostsByOwner.set(ownerId, list);
    }
    return list;
  }

  function buildCharacterOverrideCache() {
    cache.characterOverrides.clear();

    for (const [key, baseIntent] of baselineIntents.entries()) {
      if (baseIntent.kind !== IntentKinds.PAWN_MOVE) continue;
      const cur = intents.get(key);
      const baseTo = baseIntent.toPlacement?.slotIndex ?? null;
      const baseFrom = baseIntent.fromPlacement?.slotIndex ?? null;
      if (!cur) {
        if (baseFrom != null) {
          cache.characterOverrides.set(baseIntent.charId, baseFrom);
        }
        continue;
      }
      const curTo = cur.toPlacement?.slotIndex ?? null;
      if (curTo != null && curTo !== baseTo) {
        cache.characterOverrides.set(baseIntent.charId, curTo);
      }
    }

    for (const [key, curIntent] of intents.entries()) {
      if (curIntent.kind !== IntentKinds.PAWN_MOVE) continue;
      if (baselineIntents.has(key)) continue;

      const baseFrom = curIntent.baselinePlacement?.slotIndex ?? null;
      const curTo = curIntent.toPlacement?.slotIndex ?? null;
      if (curTo != null && curTo !== baseFrom) {
        cache.characterOverrides.set(curIntent.charId, curTo);
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

  function canAffordIntent(intent, existingId) {
    ensureCaches();
    const state = getStateSafe();
    const currentAp = Math.max(0, Math.floor(state?.actionPoints ?? 0));
    const summary = cache.costSummary || { total: 0, byId: {} };
    const oldCost = existingId ? summary.byId?.[existingId] ?? 0 : 0;
    const newCost = estimateIntentApCost(intent, { stateStart: state });
    const available = currentAp + oldCost;

    if (available - newCost < 0) {
      return {
        ok: false,
        reason: "insufficientAP",
        needed: newCost,
        current: currentAp,
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
      apCostOverride: existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if (placementEquals(intent.fromPlacement, intent.toPlacement)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function setPawnMoveIntent({ charId, fromSlotIndex, toSlotIndex }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    if (charId == null) return { ok: false, reason: "noChar" };
    if (!Number.isFinite(toSlotIndex)) {
      return { ok: false, reason: "badSlotIndex" };
    }

    const subjectKey = `pawn:${charId}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);

    let fromPlacement = existing?.fromPlacement ?? null;
    let baselinePlacement = existing?.baselinePlacement ?? null;

    if (!fromPlacement) {
      const ch = state.characters?.find((c) => c.id === charId);
      if (ch) fromPlacement = { slotIndex: ch.slotIndex };
    }

    if (!fromPlacement && Number.isFinite(fromSlotIndex)) {
      fromPlacement = { slotIndex: fromSlotIndex };
    }

    const intent = makePawnMoveIntent({
      id: subjectKey,
      subjectKey,
      charId,
      fromPlacement,
      toPlacement: { slotIndex: toSlotIndex },
      baselinePlacement: baselinePlacement || clonePlacement(fromPlacement),
      apCostOverride: existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    if (placementEquals(intent.fromPlacement, intent.toPlacement)) {
      return removeIntentByKey(subjectKey);
    }

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function setBuildDesignationIntent({ buildKey, defId, target }) {
    ensureActive();
    const state = getStateSafe();
    if (!state?.paused) return { ok: false, reason: "mustBePaused" };
    if (!buildKey) return { ok: false, reason: "noBuildKey" };

    const subjectKey = `build:${buildKey}`;
    const existing = intents.get(subjectKey) || baselineIntents.get(subjectKey);

    const intent = makeBuildDesignateIntent({
      id: subjectKey,
      subjectKey,
      buildKey,
      defId: defId ?? existing?.defId ?? null,
      target: target ?? existing?.target ?? null,
      apCostOverride: existing?.apCostOverride ?? null,
      source: existing?.source ?? "planner",
    });

    const afford = canAffordIntent(intent, existing?.id);
    if (!afford.ok) return afford;

    return setIntent(intent);
  }

  function buildCommitActions() {
    ensureActive();
    const state = getStateSafe();
    const actions = [];

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
        actions.push({
          kind: ActionKinds.INVENTORY_MOVE,
          payload,
          apCost: estimateIntentApCost(intent, { stateStart: state }),
        });
      } else if (intent.kind === IntentKinds.PAWN_MOVE) {
        const toSlot = intent.toPlacement?.slotIndex;
        if (toSlot == null) continue;
        actions.push({
          kind: ActionKinds.PLACE_CHARACTER,
          payload: {
            charId: intent.charId,
            slotIndex: toSlot,
            fromSlotIndex: intent.fromPlacement?.slotIndex ?? null,
            toSlotIndex: toSlot,
          },
          apCost: estimateIntentApCost(intent, { stateStart: state }),
        });
      } else if (intent.kind === IntentKinds.BUILD_DESIGNATE) {
        actions.push({
          kind: ActionKinds.BUILD_DESIGNATE,
          payload: {
            buildKey: intent.buildKey,
            defId: intent.defId ?? null,
            target: intent.target ?? null,
          },
          apCost: estimateIntentApCost(intent, { stateStart: state }),
        });
      }
    }

    return { ok: true, actions };
  }

  function resetAfterCommit({ tSec, revision } = {}) {
    intents.clear();
    baselineIntents.clear();
    intentOrder = [];
    focusIntentId = null;
    hasEdits = false;
    activeSec = Number.isFinite(tSec) ? Math.floor(tSec) : activeSec;
    activeRevision = Number.isFinite(revision)
      ? Math.floor(revision)
      : activeRevision;
    clearCaches();
    bump("commitReset");
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

  function toggleFocus(intentId) {
    ensureActive();
    if (focusIntentId === intentId) focusIntentId = null;
    else focusIntentId = intentId;
    bump("focusChanged");
    return { ok: true, focusIntentId };
  }

  return {
    getVersion: () => version,
    hasPendingIntents: () => {
      ensureActive();
      return intents.size > 0;
    },
    hasEdits: () => {
      ensureActive();
      return !!hasEdits;
    },
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
    getGhostsForOwner(ownerId) {
      ensureCaches();
      return cache.ghostsByOwner.get(ownerId) || [];
    },
    getCharacterOverrideSlot(charId) {
      ensureCaches();
      return cache.characterOverrides.get(charId) ?? null;
    },
    getFocusIntent() {
      ensureActive();
      if (!focusIntentId) return null;
      return intents.get(focusIntentId) || null;
    },
    toggleFocus,
    clearFocus: () => {
      if (!focusIntentId) return { ok: true };
      focusIntentId = null;
      bump("focusCleared");
      return { ok: true };
    },
    setItemTransferIntent,
    setPawnMoveIntent,
    setBuildDesignationIntent,
    removeIntent(intentId) {
      ensureActive();
      return removeIntentByKey(intentId);
    },
    buildCommitActions,
    resetAfterCommit,
    resetToTimeline,
    markCommitted,
  };
}
