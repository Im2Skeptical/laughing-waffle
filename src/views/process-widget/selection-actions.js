function cloneRecipePriority(value) {
  const orderedRaw = Array.isArray(value?.ordered) ? value.ordered : [];
  const ordered = [];
  const seen = new Set();
  for (const rawId of orderedRaw) {
    const recipeId =
      typeof rawId === "string" && rawId.length > 0 ? rawId : null;
    if (!recipeId) continue;
    if (seen.has(recipeId)) continue;
    seen.add(recipeId);
    ordered.push(recipeId);
  }
  const enabled = {};
  for (const recipeId of ordered) {
    enabled[recipeId] = value?.enabled?.[recipeId] === false ? false : true;
  }
  return { ordered, enabled };
}

function buildRecipePrioritySignature(value) {
  const ordered = Array.isArray(value?.ordered) ? value.ordered : [];
  const enabled = value?.enabled && typeof value.enabled === "object" ? value.enabled : {};
  if (ordered.length <= 0) return "none";
  return ordered
    .map((recipeId) => `${recipeId}:${enabled[recipeId] === false ? 0 : 1}`)
    .join("|");
}

function moveArrayEntry(list, fromIndex, toIndex) {
  const arr = Array.isArray(list) ? list.slice() : [];
  if (fromIndex < 0 || fromIndex >= arr.length) return arr;
  if (toIndex < 0 || toIndex >= arr.length) return arr;
  if (fromIndex === toIndex) return arr;
  const [moved] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, moved);
  return arr;
}

export function createProcessWidgetSelectionActions({
  selectionDropdown,
  queueActionWhenPaused,
  dispatchAction,
  actionPlanner,
  flashActionGhost,
  inventoryView,
  ActionKinds,
  envTileDefs,
  hubStructureDefs,
  getTilePlanCost,
  getHubPlanCost,
  getEnvCol,
  getHubCol,
  isRecipeSystem,
  getRecipePriorityForTarget,
  getDepositPoolTarget,
  getPoolItemOptions,
  getWithdrawState,
  normalizeWithdrawSelection,
  invalidateAllSignatures,
  openRecipeManualWindow,
} = {}) {
  function openSelectionDropdown({
    options,
    selectedValue,
    anchorBounds,
    onSelect,
    width,
  }) {
    selectionDropdown?.show?.({
      options,
      selectedValue,
      anchor: anchorBounds,
      width: Number.isFinite(width) ? width : 210,
      onSelect,
    });
  }

  function openGrowthSelectionDropdown(target, anchorBounds) {
    if (!target) return;
    if (typeof openRecipeManualWindow === "function") {
      openRecipeManualWindow(target, "growth", anchorBounds);
    }
  }

  function getTopEnabledPriorityId(priority) {
    const ordered = Array.isArray(priority?.ordered) ? priority.ordered : [];
    const enabled = priority?.enabled && typeof priority.enabled === "object"
      ? priority.enabled
      : {};
    for (const id of ordered) {
      if (!id) continue;
      if (enabled[id] === false) continue;
      return id;
    }
    return null;
  }

  function getTileName(target, envCol) {
    const tileDef = target?.defId ? envTileDefs?.[target.defId] : null;
    return (
      tileDef?.name ||
      target?.defId ||
      (Number.isFinite(envCol) ? `Tile ${envCol}` : "Tile")
    );
  }

  function getTileCropPriority(target) {
    const resolved = getRecipePriorityForTarget?.(target, "growth");
    if (resolved && typeof resolved === "object") {
      return cloneRecipePriority(resolved);
    }
    return cloneRecipePriority(target?.systemState?.growth?.recipePriority);
  }

  function dispatchTileCropPriorityChange(
    target,
    nextPriority,
    { forceFree = false } = {}
  ) {
    if (!target) return { ok: false, reason: "badTarget" };
    const envCol = getEnvCol?.(target);
    if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };

    const currentPriority = getTileCropPriority(target);
    const normalizedNext = cloneRecipePriority(nextPriority);
    const unchanged =
      buildRecipePrioritySignature(currentPriority) ===
      buildRecipePrioritySignature(normalizedNext);
    const topCropId = getTopEnabledPriorityId(normalizedNext);
    const tileName = getTileName(target, envCol);
    const enabledCount = normalizedNext.ordered.filter(
      (cropId) => normalizedNext.enabled?.[cropId] !== false
    ).length;
    const ghostSpec = {
      description: `Seeds > ${tileName}: ${enabledCount} enabled`,
      cost: getTilePlanCost?.() ?? 0,
    };

    const runWhenPaused = () => {
      if (actionPlanner?.setTileCropSelectionIntent) {
        const res = actionPlanner.setTileCropSelectionIntent({
          envCol,
          recipePriority: normalizedNext,
        });
        if (
          res?.ok === false &&
          res?.reason === "insufficientAP" &&
          typeof flashActionGhost === "function"
        ) {
          flashActionGhost(ghostSpec, "fail");
        }
        return res;
      }
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      dispatchAction(
        ActionKinds.SET_TILE_CROP_SELECTION,
        {
          envCol,
          cropId: topCropId,
          recipePriority: normalizedNext,
        },
        { apCost: unchanged || forceFree ? 0 : getTilePlanCost?.() ?? 0 }
      );
      return { ok: true };
    };
    const runWhenLive = () => {
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      return dispatchAction(
        ActionKinds.SET_TILE_CROP_SELECTION,
        {
          envCol,
          cropId: topCropId,
          recipePriority: normalizedNext,
        },
        { apCost: unchanged || forceFree ? 0 : getTilePlanCost?.() ?? 0 }
      );
    };

    if (typeof queueActionWhenPaused === "function") {
      queueActionWhenPaused({ runWhenPaused, runWhenLive });
      return { ok: true, queued: true };
    }
    return runWhenPaused();
  }

  function setTileCropPriority(target, nextPriority, opts = {}) {
    return dispatchTileCropPriorityChange(target, nextPriority, opts);
  }

  function toggleGrowthSeedPresence(target, cropId) {
    if (!cropId) return { ok: false, reason: "badCropId" };
    const current = getTileCropPriority(target);
    const next = cloneRecipePriority(current);
    const hasCrop = next.ordered.includes(cropId);
    if (hasCrop) {
      next.ordered = next.ordered.filter((id) => id !== cropId);
      delete next.enabled[cropId];
    } else {
      next.ordered.push(cropId);
      next.enabled[cropId] = true;
    }
    return dispatchTileCropPriorityChange(target, next);
  }

  function reorderGrowthSeedPriority(target, fromIndex, toIndex) {
    const current = getTileCropPriority(target);
    const next = cloneRecipePriority(current);
    next.ordered = moveArrayEntry(next.ordered, fromIndex, toIndex);
    return dispatchTileCropPriorityChange(target, next, {
      forceFree: false,
    });
  }

  function getHubRecipePriority(target, systemId) {
    const resolved = getRecipePriorityForTarget?.(target, systemId);
    if (resolved && typeof resolved === "object") {
      return cloneRecipePriority(resolved);
    }
    return cloneRecipePriority(target?.systemState?.[systemId]?.recipePriority);
  }

  function buildHubName(target, hubCol) {
    const def = target?.defId ? hubStructureDefs?.[target.defId] : null;
    return (
      def?.name ||
      target?.defId ||
      (Number.isFinite(hubCol) ? `Hub ${hubCol}` : "Hub")
    );
  }

  function dispatchHubRecipePriorityChange(
    target,
    systemId,
    nextPriority,
    { forceFree = false } = {}
  ) {
    if (!target || !isRecipeSystem?.(systemId)) {
      return { ok: false, reason: "badSystemId" };
    }
    const hubCol = getHubCol?.(target);
    if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };

    const currentPriority = getHubRecipePriority(target, systemId);
    const normalizedNext = cloneRecipePriority(nextPriority);
    const unchanged =
      buildRecipePrioritySignature(currentPriority) ===
      buildRecipePrioritySignature(normalizedNext);

    const hubName = buildHubName(target, hubCol);
    const enabledCount = normalizedNext.ordered.filter(
      (recipeId) => normalizedNext.enabled?.[recipeId] !== false
    ).length;
    const ghostSpec = {
      description: `Recipes > ${hubName}: ${enabledCount} enabled`,
      cost: getHubPlanCost?.() ?? 0,
    };

    const runWhenPaused = () => {
      if (actionPlanner?.setHubRecipeSelectionIntent) {
        const res = actionPlanner.setHubRecipeSelectionIntent({
          hubCol,
          systemId,
          recipePriority: normalizedNext,
        });
        if (
          res?.ok === false &&
          res?.reason === "insufficientAP" &&
          typeof flashActionGhost === "function"
        ) {
          flashActionGhost(ghostSpec, "fail");
        }
        return res;
      }
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      dispatchAction(
        ActionKinds.SET_HUB_RECIPE_SELECTION,
        { hubCol, systemId, recipePriority: normalizedNext },
        { apCost: unchanged || forceFree ? 0 : getHubPlanCost?.() ?? 0 }
      );
      return { ok: true };
    };
    const runWhenLive = () => {
      if (!dispatchAction) return { ok: false, reason: "noDispatch" };
      return dispatchAction(
        ActionKinds.SET_HUB_RECIPE_SELECTION,
        { hubCol, systemId, recipePriority: normalizedNext },
        { apCost: unchanged || forceFree ? 0 : getHubPlanCost?.() ?? 0 }
      );
    };

    if (typeof queueActionWhenPaused === "function") {
      queueActionWhenPaused({ runWhenPaused, runWhenLive });
      return { ok: true, queued: true };
    }
    return runWhenPaused();
  }

  function setHubRecipePriority(target, systemId, nextPriority, opts = {}) {
    return dispatchHubRecipePriorityChange(target, systemId, nextPriority, opts);
  }

  function toggleHubRecipeEnabled(target, systemId, recipeId, enabled = null) {
    if (!recipeId) return { ok: false, reason: "badRecipeId" };
    const current = getHubRecipePriority(target, systemId);
    if (!current.ordered.includes(recipeId)) {
      return { ok: false, reason: "missingRecipe" };
    }
    const next = cloneRecipePriority(current);
    const currentEnabled = next.enabled?.[recipeId] !== false;
    const nextEnabled = typeof enabled === "boolean" ? enabled : !currentEnabled;
    next.enabled[recipeId] = nextEnabled;
    return dispatchHubRecipePriorityChange(target, systemId, next);
  }

  function toggleRecipePresence(target, systemId, recipeId) {
    if (!recipeId) return { ok: false, reason: "badRecipeId" };
    const current = getHubRecipePriority(target, systemId);
    const next = cloneRecipePriority(current);
    const hasRecipe = next.ordered.includes(recipeId);
    if (hasRecipe) {
      next.ordered = next.ordered.filter((id) => id !== recipeId);
      delete next.enabled[recipeId];
    } else {
      next.ordered.push(recipeId);
      next.enabled[recipeId] = true;
    }
    return dispatchHubRecipePriorityChange(target, systemId, next);
  }

  function reorderHubRecipePriority(target, systemId, fromIndex, toIndex) {
    const current = getHubRecipePriority(target, systemId);
    const next = cloneRecipePriority(current);
    next.ordered = moveArrayEntry(next.ordered, fromIndex, toIndex);
    return dispatchHubRecipePriorityChange(target, systemId, next, {
      forceFree: false,
    });
  }

  function openRecipeSelectionDropdown(target, systemId, anchorBounds) {
    if (!target || !isRecipeSystem?.(systemId)) return;
    if (typeof openRecipeManualWindow === "function") {
      openRecipeManualWindow(target, systemId, anchorBounds);
    }
  }

  function openWithdrawItemDropdown(target, anchorBounds) {
    const info = getDepositPoolTarget?.(target);
    if (!info?.pool || typeof info.pool !== "object") return;
    const options = getPoolItemOptions?.(info.pool) || [];
    const withdrawState = getWithdrawState?.(target);
    const selectedId = normalizeWithdrawSelection?.(withdrawState, options) ?? null;
    openSelectionDropdown({
      options,
      selectedValue: selectedId,
      anchorBounds,
      width: 212,
      onSelect: (itemId) => {
        if (!withdrawState) return;
        withdrawState.selectedItemId = itemId ?? null;
        withdrawState.amount = 1;
        invalidateAllSignatures?.();
      },
    });
  }

  function requestPoolWithdraw(target, itemId, amount) {
    if (!target || !itemId) return;
    queueActionWhenPaused?.(() => {
      if (target?.refKind === "basket") {
        const result = dispatchAction?.(
          ActionKinds.WITHDRAW_PAWN_BASKET_POOL_ITEM,
          {
            ownerId: target?.ownerId ?? null,
            itemId,
            amount,
            slotId: target?.basketSlotId ?? null,
          },
          { apCost: 0 }
        );
        if (!result?.ok) {
          if (target?.ownerId != null) {
            inventoryView?.flashWindowError?.(target.ownerId);
          }
          return result;
        }
        const ownerId = result.ownerId ?? target?.ownerId ?? null;
        if (ownerId != null) {
          inventoryView?.revealWindow?.(ownerId, { pinned: true });
          inventoryView?.rebuildWindow?.(ownerId);
        }
        if (
          ownerId != null &&
          result.spawnItemId != null &&
          typeof inventoryView?.beginDragItemFromOwner === "function"
        ) {
          inventoryView.beginDragItemFromOwner(ownerId, result.spawnItemId, {
            pinned: true,
          });
        }
        return result;
      }

      const hubCol = getHubCol?.(target);
      if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
      const result = dispatchAction?.(
        ActionKinds.WITHDRAW_HUB_POOL_ITEM,
        {
          hubCol,
          itemId,
          amount,
        },
        { apCost: 0 }
      );
      if (!result?.ok) {
        inventoryView?.flashWindowError?.(target.instanceId);
        return result;
      }
      const ownerId = result.ownerId ?? target.instanceId;
      if (ownerId != null) {
        inventoryView?.revealWindow?.(ownerId, { pinned: true });
        inventoryView?.rebuildWindow?.(ownerId);
      }
      if (
        ownerId != null &&
        result.spawnItemId != null &&
        typeof inventoryView?.beginDragItemFromOwner === "function"
      ) {
        inventoryView.beginDragItemFromOwner(ownerId, result.spawnItemId, {
          pinned: true,
        });
      }
      return result;
    });
  }

  return {
    openSelectionDropdown,
    openGrowthSelectionDropdown,
    openRecipeSelectionDropdown,
    openWithdrawItemDropdown,
    requestPoolWithdraw,
    setTileCropPriority,
    toggleGrowthSeedPresence,
    reorderGrowthSeedPriority,
    getTileCropPriority,
    setHubRecipePriority,
    toggleHubRecipeEnabled,
    toggleRecipePresence,
    reorderHubRecipePriority,
    getHubRecipePriority,
  };
}
