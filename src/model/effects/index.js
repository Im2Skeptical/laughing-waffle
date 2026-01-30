import { normalizeEffectSpec } from "./core/normalize.js";
import {
  handleMoveItem,
  handleStackItem,
  handleSplitStack,
} from "./ops/inventory-ops.js";
import {
  handleAddResource,
  handleConsumeItem,
  handleTransferUnits,
  handleSpawnItem,
  handleSpawnFromDropTable,
} from "./ops/game-ops.js";
import {
  handleTransformItem,
  handleRemoveItem,
  handleCheckItemRot,
  handleExpireItemChance,
  handleTickItemSeasonExpiry,
} from "./ops/item-ops.js";
import {
  handleAddToSystemState,
  handleClampSystemState,
  handleAccumulateRatio,
  handleResetSystemState,
  handleAdjustSystemState,
  handleCreateProcess,
  handleFinalizeProcess,
} from "./ops/system-ops.js";
import {
  handleAddTag,
  handleDisableTag,
  handleEnableTag,
  handleRemoveTag,
  handleSetSystemTier,
  handleSetSystemState,
  handleClearSystemState,
  handleUpgradeSystemTier,
} from "./ops/tag-ops.js";
import { handleRemoveEvent, handleTransformEvent } from "./ops/event-ops.js";
import { handleSetProp, handleAddProp } from "./ops/prop-ops.js";
import { processSeasonChangeForItems as processSeasonChangeForItemsImpl } from "./item-tick/item-season.js";
import { processSecondChangeForItems as processSecondChangeForItemsImpl } from "./item-tick/item-second.js";

const handlers = {
  moveItem: handleMoveItem,
  stackItem: handleStackItem,
  splitStack: handleSplitStack,
  AddResource: handleAddResource,
  TransformItem: handleTransformItem,
  RemoveItem: handleRemoveItem,
  CheckItemRot: handleCheckItemRot,
  ExpireItemChance: handleExpireItemChance,
  TickItemSeasonExpiry: handleTickItemSeasonExpiry,
  AddToSystemState: handleAddToSystemState,
  ClampSystemState: handleClampSystemState,
  AccumulateRatio: handleAccumulateRatio,
  ResetSystemState: handleResetSystemState,
  AdjustSystemState: handleAdjustSystemState,
  ConsumeItem: handleConsumeItem,
  TransferUnits: handleTransferUnits,
  SpawnItem: handleSpawnItem,
  SpawnFromDropTable: handleSpawnFromDropTable,
  CreateProcess: handleCreateProcess,
  FinalizeProcess: handleFinalizeProcess,
  AddTag: handleAddTag,
  DisableTag: handleDisableTag,
  EnableTag: handleEnableTag,
  RemoveTag: handleRemoveTag,
  SetSystemTier: handleSetSystemTier,
  SetSystemState: handleSetSystemState,
  ClearSystemState: handleClearSystemState,
  UpgradeSystemTier: handleUpgradeSystemTier,
  RemoveEvent: handleRemoveEvent,
  TransformEvent: handleTransformEvent,
  SetProp: handleSetProp,
  AddProp: handleAddProp,
};

export { normalizeEffectSpec };

export function runEffect(state, rawEffect, context) {
  if (!rawEffect) return false;

  if (Array.isArray(rawEffect)) {
    let changed = false;
    for (const eff of rawEffect)
      changed = runEffect(state, eff, context) || changed;
    return changed;
  }

  const effect = normalizeEffectSpec(rawEffect);
  if (!effect) return false;

  const handler = handlers[effect.op];
  if (!handler) return false;
  return handler(state, effect, context);
}

export function processSeasonChangeForItems(state) {
  processSeasonChangeForItemsImpl(state, runEffect);
}

export function processSecondChangeForItems(state) {
  processSecondChangeForItemsImpl(state, runEffect);
}
