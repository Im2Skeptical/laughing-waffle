import { ActionKinds } from "../../model/actions.js";
import {
  buildRecipePriorityFromSelectedRecipe,
  getTopEnabledRecipeId,
  normalizeRecipePriority,
} from "../../model/recipe-priority.js";
import { placementEquals } from "./action-placement-utils.js";
import { IntentKinds } from "./action-intents.js";

export function clonePlacement(value) {
  return value && typeof value === "object" ? { ...value } : null;
}

export function cloneRecipePriority(value) {
  const ordered = Array.isArray(value?.ordered) ? value.ordered.slice() : [];
  const enabled = {};
  for (const recipeId of ordered) {
    enabled[recipeId] = value?.enabled?.[recipeId] === false ? false : true;
  }
  return { ordered, enabled };
}

export function createEmptyInventoryPreview() {
  return {
    hiddenItemIds: new Set(),
    overlayItems: [],
    ghostItems: [],
  };
}

function makeItemSnapshot(item) {
  if (!item || typeof item !== "object") return null;
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

function getOrCreateOwnerPreview(previewByOwner, ownerId) {
  let entry = previewByOwner.get(ownerId);
  if (!entry) {
    entry = createEmptyInventoryPreview();
    previewByOwner.set(ownerId, entry);
  }
  return entry;
}

function normalizeHubAnchorCol(state, rawHubCol) {
  if (!Number.isFinite(rawHubCol)) return null;
  const hubCol = Math.floor(rawHubCol);
  const hubOcc = Array.isArray(state?.hub?.occ) ? state.hub.occ : null;
  if (hubOcc) {
    const anchor = hubOcc[hubCol];
    if (anchor && Number.isFinite(anchor.col)) {
      return Math.floor(anchor.col);
    }
  }
  return hubCol;
}

function normalizeInventoryPlacement(rawPlacement, fallbackOwnerId = null) {
  if (!rawPlacement || typeof rawPlacement !== "object") return null;
  const ownerId =
    rawPlacement.ownerId != null ? rawPlacement.ownerId : fallbackOwnerId;
  const gx = Number.isFinite(rawPlacement.gx) ? Math.floor(rawPlacement.gx) : null;
  const gy = Number.isFinite(rawPlacement.gy) ? Math.floor(rawPlacement.gy) : null;
  if (ownerId == null || gx == null || gy == null) return null;
  return { ownerId, gx, gy };
}

function resolveItemLocationInState(state, itemId, ownerIdHint = null) {
  if (!state?.ownerInventories || itemId == null) return null;
  if (ownerIdHint != null) {
    const hinted = state.ownerInventories[ownerIdHint] || null;
    const hintedItem =
      hinted?.itemsById?.[itemId] ||
      hinted?.items?.find?.((candidate) => candidate?.id === itemId) ||
      null;
    if (hintedItem) {
      return {
        ownerId: ownerIdHint,
        placement: {
          ownerId: ownerIdHint,
          gx: Math.floor(hintedItem.gridX ?? 0),
          gy: Math.floor(hintedItem.gridY ?? 0),
        },
        item: makeItemSnapshot(hintedItem),
      };
    }
  }

  for (const [ownerIdRaw, inv] of Object.entries(state.ownerInventories)) {
    const item =
      inv?.itemsById?.[itemId] ||
      inv?.items?.find?.((candidate) => candidate?.id === itemId) ||
      null;
    if (!item) continue;
    const ownerIdNum = Number(ownerIdRaw);
    const ownerId = Number.isFinite(ownerIdNum) ? ownerIdNum : ownerIdRaw;
    return {
      ownerId,
      placement: {
        ownerId,
        gx: Math.floor(item.gridX ?? 0),
        gy: Math.floor(item.gridY ?? 0),
      },
      item: makeItemSnapshot(item),
    };
  }
  return null;
}

function getTileBaselinePreview(state, envCol) {
  const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
  const tile = col != null ? state?.board?.occ?.tile?.[col] ?? null : null;
  const recipePriority = normalizeRecipePriority(tile?.systemState?.growth?.recipePriority, {
    systemId: "growth",
    state,
    includeLocked: false,
  });
  const fallbackCropId = tile?.systemState?.growth?.selectedCropId ?? null;
  const resolvedPriority =
    recipePriority.ordered.length > 0
      ? recipePriority
      : buildRecipePriorityFromSelectedRecipe(fallbackCropId, {
          systemId: "growth",
          state,
          includeLocked: false,
        });
  const tags = Array.isArray(tile?.tags) ? tile.tags.slice() : [];
  const tagDisabledById = {};
  for (const tagId of tags) {
    tagDisabledById[tagId] = tile?.tagStates?.[tagId]?.disabled === true;
  }
  return {
    envCol: col,
    tagIds: tags,
    tagDisabledById,
    recipePriority: cloneRecipePriority(resolvedPriority),
    cropId: getTopEnabledRecipeId(resolvedPriority),
  };
}

function getHubBaselinePreview(state, hubCol) {
  const col = Number.isFinite(hubCol) ? Math.floor(hubCol) : null;
  const structure =
    col != null
      ? state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure ?? null
      : null;
  const tags = Array.isArray(structure?.tags) ? structure.tags.slice() : [];
  const tagDisabledById = {};
  for (const tagId of tags) {
    tagDisabledById[tagId] = structure?.tagStates?.[tagId]?.disabled === true;
  }

  const recipePriorityBySystemId = {};
  const recipeIdBySystemId = {};
  const systemState = structure?.systemState || {};
  for (const [systemId, entry] of Object.entries(systemState)) {
    const normalized = normalizeRecipePriority(entry?.recipePriority, {
      systemId,
      state,
      includeLocked: false,
    });
    const fallbackRecipeId = entry?.selectedRecipeId ?? null;
    const resolvedPriority =
      normalized.ordered.length > 0
        ? normalized
        : buildRecipePriorityFromSelectedRecipe(fallbackRecipeId, {
            systemId,
            state,
            includeLocked: false,
          });
    if (resolvedPriority.ordered.length <= 0 && !fallbackRecipeId) continue;
    recipePriorityBySystemId[systemId] = cloneRecipePriority(resolvedPriority);
    recipeIdBySystemId[systemId] = getTopEnabledRecipeId(resolvedPriority);
  }

  return {
    hubCol: col,
    tagIds: tags,
    tagDisabledById,
    recipePriorityBySystemId,
    recipeIdBySystemId,
  };
}

function getOrCreateTilePlan(tilePlanByEnvCol, state, envCol) {
  const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
  if (col == null) return null;
  let entry = tilePlanByEnvCol.get(col);
  if (!entry) {
    entry = getTileBaselinePreview(state, col);
    tilePlanByEnvCol.set(col, entry);
  }
  return entry;
}

function getOrCreateHubPlan(hubPlanByHubCol, state, hubCol) {
  const col = Number.isFinite(hubCol) ? Math.floor(hubCol) : null;
  if (col == null) return null;
  let entry = hubPlanByHubCol.get(col);
  if (!entry) {
    entry = getHubBaselinePreview(state, col);
    hubPlanByHubCol.set(col, entry);
  }
  return entry;
}

function applyTileIntentPreview(tilePlanByEnvCol, state, intent) {
  if (!intent) return;
  if (intent.kind === IntentKinds.TILE_TAG_ORDER) {
    const entry = getOrCreateTilePlan(tilePlanByEnvCol, state, intent.envCol);
    if (!entry) return;
    entry.tagIds = Array.isArray(intent.tagIds) ? intent.tagIds.slice() : [];
    return;
  }
  if (intent.kind === IntentKinds.TILE_TAG_TOGGLE) {
    const entry = getOrCreateTilePlan(tilePlanByEnvCol, state, intent.envCol);
    if (!entry || !intent.tagId) return;
    entry.tagDisabledById[intent.tagId] = intent.disabled === true;
    return;
  }
  if (intent.kind === IntentKinds.TILE_CROP_SELECT) {
    const entry = getOrCreateTilePlan(tilePlanByEnvCol, state, intent.envCol);
    if (!entry) return;
    entry.recipePriority = cloneRecipePriority(intent.recipePriority);
    entry.cropId = intent.cropId ?? getTopEnabledRecipeId(intent.recipePriority);
  }
}

function applyHubIntentPreview(hubPlanByHubCol, state, intent) {
  if (!intent) return;
  if (intent.kind === IntentKinds.HUB_TAG_ORDER) {
    const entry = getOrCreateHubPlan(hubPlanByHubCol, state, intent.hubCol);
    if (!entry) return;
    entry.tagIds = Array.isArray(intent.tagIds) ? intent.tagIds.slice() : [];
    return;
  }
  if (intent.kind === IntentKinds.HUB_TAG_TOGGLE) {
    const entry = getOrCreateHubPlan(hubPlanByHubCol, state, intent.hubCol);
    if (!entry || !intent.tagId) return;
    entry.tagDisabledById[intent.tagId] = intent.disabled === true;
    return;
  }
  if (intent.kind === IntentKinds.HUB_RECIPE_SELECT) {
    const entry = getOrCreateHubPlan(hubPlanByHubCol, state, intent.hubCol);
    if (!entry || !intent.systemId) return;
    entry.recipePriorityBySystemId[intent.systemId] = cloneRecipePriority(
      intent.recipePriority
    );
    entry.recipeIdBySystemId[intent.systemId] =
      intent.recipeId ?? getTopEnabledRecipeId(intent.recipePriority);
  }
}

function applyTileActionPreview(tilePlanByEnvCol, state, action) {
  const payload = action?.payload || {};
  if (action?.kind === ActionKinds.SET_TILE_TAG_ORDER) {
    const entry = getOrCreateTilePlan(tilePlanByEnvCol, state, payload.envCol);
    if (!entry) return;
    entry.tagIds = Array.isArray(payload.tagIds)
      ? payload.tagIds.slice()
      : Array.isArray(payload.tags)
      ? payload.tags.slice()
      : [];
    return;
  }
  if (action?.kind === ActionKinds.TOGGLE_TILE_TAG) {
    const entry = getOrCreateTilePlan(tilePlanByEnvCol, state, payload.envCol);
    if (!entry || !payload.tagId) return;
    entry.tagDisabledById[payload.tagId] = payload.disabled === true;
    return;
  }
  if (action?.kind === ActionKinds.SET_TILE_CROP_SELECTION) {
    const entry = getOrCreateTilePlan(tilePlanByEnvCol, state, payload.envCol);
    if (!entry) return;
    const normalized = payload.recipePriority && typeof payload.recipePriority === "object"
      ? normalizeRecipePriority(payload.recipePriority, {
          systemId: "growth",
          state,
          includeLocked: false,
        })
      : buildRecipePriorityFromSelectedRecipe(payload.cropId ?? null, {
          systemId: "growth",
          state,
          includeLocked: false,
        });
    entry.recipePriority = cloneRecipePriority(normalized);
    entry.cropId = getTopEnabledRecipeId(normalized);
  }
}

function applyHubActionPreview(hubPlanByHubCol, state, action) {
  const payload = action?.payload || {};
  if (action?.kind === ActionKinds.SET_HUB_TAG_ORDER) {
    const entry = getOrCreateHubPlan(hubPlanByHubCol, state, payload.hubCol);
    if (!entry) return;
    entry.tagIds = Array.isArray(payload.tagIds)
      ? payload.tagIds.slice()
      : Array.isArray(payload.tags)
      ? payload.tags.slice()
      : [];
    return;
  }
  if (action?.kind === ActionKinds.TOGGLE_HUB_TAG) {
    const entry = getOrCreateHubPlan(hubPlanByHubCol, state, payload.hubCol);
    if (!entry || !payload.tagId) return;
    entry.tagDisabledById[payload.tagId] = payload.disabled === true;
    return;
  }
  if (action?.kind === ActionKinds.SET_HUB_RECIPE_SELECTION) {
    const entry = getOrCreateHubPlan(hubPlanByHubCol, state, payload.hubCol);
    if (!entry || !payload.systemId) return;
    const normalized = payload.recipePriority && typeof payload.recipePriority === "object"
      ? normalizeRecipePriority(payload.recipePriority, {
          systemId: payload.systemId,
          state,
          includeLocked: false,
        })
      : buildRecipePriorityFromSelectedRecipe(payload.recipeId ?? null, {
          systemId: payload.systemId,
          state,
          includeLocked: false,
        });
    entry.recipePriorityBySystemId[payload.systemId] = cloneRecipePriority(normalized);
    entry.recipeIdBySystemId[payload.systemId] = getTopEnabledRecipeId(normalized);
  }
}

export function buildPlannerPreviewState({
  state,
  baselineIntents,
  currentIntents,
  inventoryTransferGhostPreviewEnabled = true,
} = {}) {
  const previewByOwner = new Map();
  const pawnOverrides = new Map();
  const tilePlanByEnvCol = new Map();
  const hubPlanByHubCol = new Map();

  const baselineByKey =
    baselineIntents && typeof baselineIntents.entries === "function"
      ? baselineIntents
      : new Map();
  const currentByKey =
    currentIntents && typeof currentIntents.entries === "function"
      ? currentIntents
      : new Map();

  if (inventoryTransferGhostPreviewEnabled) {
    const moves = [];

    for (const [key, baseIntent] of baselineByKey.entries()) {
      if (baseIntent?.kind !== IntentKinds.ITEM_TRANSFER) continue;
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
      if (!placementEquals(cur.toPlacement, baseTo) && baseTo && cur.toPlacement) {
        moves.push({
          intentId: key,
          item: cur.item || baseIntent.item,
          from: baseTo,
          to: cur.toPlacement,
        });
      }
    }

    for (const [key, curIntent] of currentByKey.entries()) {
      if (curIntent?.kind !== IntentKinds.ITEM_TRANSFER) continue;
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
      const fromPreview = getOrCreateOwnerPreview(previewByOwner, move.from.ownerId);
      fromPreview.hiddenItemIds.add(item.id);

      const toPreview = getOrCreateOwnerPreview(previewByOwner, move.to.ownerId);
      toPreview.overlayItems.push({
        ...item,
        sourceOwnerId: move.from.ownerId,
        ownerId: move.to.ownerId,
        gridX: move.to.gx,
        gridY: move.to.gy,
        intentId: move.intentId,
        isGhost: false,
      });
    }

    for (const [key, curIntent] of currentByKey.entries()) {
      if (curIntent?.kind !== IntentKinds.ITEM_TRANSFER) continue;
      if (!curIntent.fromPlacement || !curIntent.item) continue;
      const preview = getOrCreateOwnerPreview(
        previewByOwner,
        curIntent.fromPlacement.ownerId ?? curIntent.fromOwnerId
      );
      preview.ghostItems.push({
        ...curIntent.item,
        ownerId: curIntent.fromPlacement.ownerId ?? curIntent.fromOwnerId,
        gridX: curIntent.fromPlacement.gx,
        gridY: curIntent.fromPlacement.gy,
        intentId: key,
        isGhost: true,
      });
    }
  }

  for (const [key, baseIntent] of baselineByKey.entries()) {
    if (baseIntent?.kind !== IntentKinds.PAWN_MOVE) continue;
    const cur = currentByKey.get(key);
    const baseTo = baseIntent.toPlacement ?? null;
    const baseFrom = baseIntent.fromPlacement ?? null;
    if (!cur) {
      if (baseFrom) {
        pawnOverrides.set(baseIntent.pawnId, clonePlacement(baseFrom));
      }
      continue;
    }
    const curTo = cur.toPlacement ?? null;
    if (curTo && !placementEquals(curTo, baseTo)) {
      pawnOverrides.set(baseIntent.pawnId, clonePlacement(curTo));
    }
  }

  for (const [key, curIntent] of currentByKey.entries()) {
    if (curIntent?.kind !== IntentKinds.PAWN_MOVE) continue;
    if (baselineByKey.has(key)) continue;
    const baseFrom = curIntent.baselinePlacement ?? null;
    const curTo = curIntent.toPlacement ?? null;
    if (curTo && !placementEquals(curTo, baseFrom)) {
      pawnOverrides.set(curIntent.pawnId, clonePlacement(curTo));
    }
  }

  for (const intent of currentByKey.values()) {
    applyTileIntentPreview(tilePlanByEnvCol, state, intent);
    applyHubIntentPreview(hubPlanByHubCol, state, intent);
  }

  return {
    previewByOwner,
    pawnOverrides,
    tilePlanByEnvCol,
    hubPlanByHubCol,
  };
}

export function buildLiveActionPreviewState({
  state,
  actions,
  inventoryTransferGhostPreviewEnabled = true,
} = {}) {
  const previewByOwner = new Map();
  const pawnOverrides = new Map();
  const tilePlanByEnvCol = new Map();
  const hubPlanByHubCol = new Map();
  const orderedActions = Array.isArray(actions) ? actions : [];

  if (inventoryTransferGhostPreviewEnabled) {
    const transfersByItemId = new Map();

    for (const action of orderedActions) {
      if (action?.kind !== ActionKinds.INVENTORY_MOVE) continue;
      const payload = action.payload || {};
      const itemId = payload.itemId ?? payload.item?.id ?? null;
      if (itemId == null) continue;

      let transfer = transfersByItemId.get(itemId);
      if (!transfer) {
        const fromPlacement =
          normalizeInventoryPlacement(payload.fromPlacement, payload.fromOwnerId) ??
          resolveItemLocationInState(state, itemId, payload.fromOwnerId)?.placement ??
          null;
        const itemSnapshot =
          payload.item ??
          resolveItemLocationInState(state, itemId, payload.fromOwnerId)?.item ??
          null;
        transfer = {
          item: makeItemSnapshot(itemSnapshot),
          originalPlacement: clonePlacement(fromPlacement),
          currentPlacement: clonePlacement(fromPlacement),
        };
        transfersByItemId.set(itemId, transfer);
      }

      const nextPlacement =
        normalizeInventoryPlacement(payload.toPlacement, payload.toOwnerId) ??
        (payload.toOwnerId != null &&
        Number.isFinite(payload.targetGX) &&
        Number.isFinite(payload.targetGY)
          ? {
              ownerId: payload.toOwnerId,
              gx: Math.floor(payload.targetGX),
              gy: Math.floor(payload.targetGY),
            }
          : null);
      if (!transfer.item && payload.item) {
        transfer.item = makeItemSnapshot(payload.item);
      }
      if (nextPlacement) {
        transfer.currentPlacement = clonePlacement(nextPlacement);
      }
    }

    for (const transfer of transfersByItemId.values()) {
      const item = transfer.item;
      const originalPlacement = transfer.originalPlacement;
      const currentPlacement = transfer.currentPlacement;
      if (!item || !originalPlacement || !currentPlacement) continue;
      if (placementEquals(originalPlacement, currentPlacement)) continue;

      const fromPreview = getOrCreateOwnerPreview(
        previewByOwner,
        originalPlacement.ownerId
      );
      fromPreview.hiddenItemIds.add(item.id);
      fromPreview.ghostItems.push({
        ...item,
        ownerId: originalPlacement.ownerId,
        gridX: originalPlacement.gx,
        gridY: originalPlacement.gy,
        intentId: `pendingItem:${item.id}`,
        isGhost: true,
      });

      const toPreview = getOrCreateOwnerPreview(previewByOwner, currentPlacement.ownerId);
      toPreview.overlayItems.push({
        ...item,
        sourceOwnerId: originalPlacement.ownerId,
        ownerId: currentPlacement.ownerId,
        gridX: currentPlacement.gx,
        gridY: currentPlacement.gy,
        intentId: `pendingItem:${item.id}`,
        isGhost: false,
      });
    }
  }

  const pawnMovesByPawnId = new Map();
  for (const action of orderedActions) {
    if (action?.kind !== ActionKinds.PLACE_PAWN) continue;
    const payload = action.payload || {};
    const pawnId = payload.pawnId ?? null;
    if (pawnId == null) continue;
    let move = pawnMovesByPawnId.get(pawnId);
    if (!move) {
      const pawn =
        state?.pawns?.find?.((candidate) => candidate?.id === pawnId) ?? null;
      const baselinePlacement = normalizePawnPlacement(
        payload.fromPlacement ?? pawn,
        state
      );
      move = {
        originalPlacement: baselinePlacement,
        currentPlacement: baselinePlacement,
      };
      pawnMovesByPawnId.set(pawnId, move);
    }
    const nextPlacement = normalizePawnPlacement(payload.toPlacement ?? payload, state);
    if (nextPlacement) {
      move.currentPlacement = nextPlacement;
    }
  }

  for (const [pawnId, move] of pawnMovesByPawnId.entries()) {
    if (!move?.currentPlacement) continue;
    if (placementEquals(move.currentPlacement, move.originalPlacement)) continue;
    pawnOverrides.set(pawnId, clonePlacement(move.currentPlacement));
  }

  for (const action of orderedActions) {
    applyTileActionPreview(tilePlanByEnvCol, state, action);
    applyHubActionPreview(hubPlanByHubCol, state, action);
  }

  return {
    previewByOwner,
    pawnOverrides,
    tilePlanByEnvCol,
    hubPlanByHubCol,
  };
}

function normalizePawnPlacement(value, state = null) {
  if (!value || typeof value !== "object") return null;
  if (Number.isFinite(value.envCol) || Number.isFinite(value.toEnvCol)) {
    return {
      envCol: Math.floor(
        Number.isFinite(value.envCol) ? value.envCol : value.toEnvCol
      ),
    };
  }
  if (Number.isFinite(value.hubCol) || Number.isFinite(value.toHubCol)) {
    const hubCol = normalizeHubAnchorCol(
      state,
      Number.isFinite(value.hubCol) ? value.hubCol : value.toHubCol
    );
    if (!Number.isFinite(hubCol)) return null;
    return {
      hubCol,
    };
  }
  return null;
}
