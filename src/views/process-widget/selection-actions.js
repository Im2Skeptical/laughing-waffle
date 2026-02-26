export function createProcessWidgetSelectionActions({
  selectionDropdown,
  queueActionWhenPaused,
  dispatchAction,
  actionPlanner,
  flashActionGhost,
  inventoryView,
  ActionKinds,
  cropDefs,
  recipeDefs,
  envTileDefs,
  hubStructureDefs,
  getTilePlanCost,
  getHubPlanCost,
  getEnvCol,
  getHubCol,
  isRecipeSystem,
  getSelectedRecipeId,
  getCropOptions,
  getRecipeOptions,
  getDepositPoolTarget,
  getPoolItemOptions,
  getWithdrawState,
  normalizeWithdrawSelection,
  invalidateAllSignatures,
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
    const growth = target?.systemState?.growth || {};
    const selectedId = growth?.selectedCropId ?? null;
    const envCol = getEnvCol?.(target);
    const tileDef = target?.defId ? envTileDefs?.[target.defId] : null;
    const tileName =
      tileDef?.name ||
      target?.defId ||
      (Number.isFinite(envCol) ? `Tile ${envCol}` : "Tile");
    openSelectionDropdown({
      options: getCropOptions?.() || [],
      selectedValue: selectedId,
      anchorBounds,
      width: 196,
      onSelect: (cropId) => {
        const nextCrop = cropId ?? null;
        const cropName = cropId != null ? cropDefs?.[cropId]?.name || cropId : "None";
        const ghostSpec = {
          description: `Crop > ${tileName}: ${cropName}`,
          cost: getTilePlanCost?.() ?? 0,
        };
        const run = () => {
          if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
          if (actionPlanner?.setTileCropSelectionIntent) {
            const res = actionPlanner.setTileCropSelectionIntent({
              envCol,
              cropId: nextCrop,
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
            { envCol, cropId: nextCrop },
            { apCost: 10 }
          );
          return { ok: true };
        };
        if (typeof queueActionWhenPaused === "function") {
          queueActionWhenPaused(run);
          return;
        }
        run();
      },
    });
  }

  function openRecipeSelectionDropdown(target, systemId, anchorBounds) {
    if (!target || !isRecipeSystem?.(systemId)) return;
    const selectedId = getSelectedRecipeId?.(target, systemId) ?? null;
    const hubCol = getHubCol?.(target);
    const def = target?.defId ? hubStructureDefs?.[target.defId] : null;
    const hubName =
      def?.name ||
      target?.defId ||
      (Number.isFinite(hubCol) ? `Hub ${hubCol}` : "Hub");
    openSelectionDropdown({
      options: getRecipeOptions?.(systemId) || [],
      selectedValue: selectedId,
      anchorBounds,
      width: 232,
      onSelect: (recipeId) => {
        const nextRecipe = recipeId ?? null;
        const recipeName = recipeId ? recipeDefs?.[recipeId]?.name || recipeId : "None";
        const ghostSpec = {
          description: `Recipe > ${hubName}: ${recipeName}`,
          cost: getHubPlanCost?.() ?? 0,
        };
        const run = () => {
          if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
          const sameSelection = (selectedId ?? null) === (nextRecipe ?? null);
          if (sameSelection) {
            if (!dispatchAction) return { ok: false, reason: "noDispatch" };
            return dispatchAction(
              ActionKinds.SET_HUB_RECIPE_SELECTION,
              { hubCol, systemId, recipeId: nextRecipe },
              { apCost: 0 }
            );
          }
          if (actionPlanner?.setHubRecipeSelectionIntent) {
            const res = actionPlanner.setHubRecipeSelectionIntent({
              hubCol,
              systemId,
              recipeId: nextRecipe,
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
            { hubCol, systemId, recipeId: nextRecipe },
            { apCost: getHubPlanCost?.() ?? 0 }
          );
          return { ok: true };
        };
        if (typeof queueActionWhenPaused === "function") {
          queueActionWhenPaused(run);
          return;
        }
        run();
      },
    });
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
  };
}
