import { normalizeEffectSpec } from "./core/normalize.js";
import {
  handleMoveItem,
  handleStackItem,
  handleSplitStack,
} from "./ops/inventory-ops.js";
import {
  handleAddResource,
  handleConsumeItem,
  handleExposeDiscovery,
  handleTransferUnits,
  handleRevealDiscovery,
  handleSetDiscoveryState,
  handleSetLocationName,
  handleSpawnItem,
  handleSpawnDropPackage,
  handleSpawnFromDropTable,
} from "./ops/game-ops.js";
import {
  handleTransformItem,
  handleRemoveItem,
  handleExpireItemChance,
} from "./ops/item-ops.js";
import {
  handleAddToSystemState,
  handleClampSystemState,
  handleAccumulateRatio,
  handleResetSystemState,
  handleAdjustSystemState,
  handleExpireStoredPerishables,
  handleCreateWorkProcess,
  handleAdvanceWorkProcess,
} from "./ops/system-ops.js";
import {
  handleAddTag,
  handleDisableTag,
  handleEnableTag,
  handleHideTag,
  handleRemoveTag,
  handleRevealTag,
  handleSetSystemTier,
  handleSetSystemState,
  handleClearSystemState,
  handleUpgradeSystemTier,
} from "./ops/tag-ops.js";
import { handleRemoveEvent, handleTransformEvent } from "./ops/event-ops.js";
import { handleSetProp, handleAddProp } from "./ops/prop-ops.js";
import {
  handleAddSkillPoints,
  handleAddSkillPointsIfSkillNodeUnlocked,
  handleAddModifier,
  handleGrantSkillNode,
  handleGrantUnlock,
  handleMulModifier,
  handleRevokeUnlock,
} from "./ops/skill-ops.js";
import { processSeasonChangeForItems as processSeasonChangeForItemsImpl } from "./item-tick/item-season.js";
import { processSecondChangeForItems as processSecondChangeForItemsImpl } from "./item-tick/item-second.js";

const handlers = {
  moveItem: handleMoveItem,
  stackItem: handleStackItem,
  splitStack: handleSplitStack,
  AddResource: handleAddResource,
  ExposeDiscovery: handleExposeDiscovery,
  TransformItem: handleTransformItem,
  RemoveItem: handleRemoveItem,
  ExpireItemChance: handleExpireItemChance,
  AddToSystemState: handleAddToSystemState,
  ClampSystemState: handleClampSystemState,
  AccumulateRatio: handleAccumulateRatio,
  ResetSystemState: handleResetSystemState,
  AdjustSystemState: handleAdjustSystemState,
  ExpireStoredPerishables: handleExpireStoredPerishables,
  ConsumeItem: handleConsumeItem,
  TransferUnits: handleTransferUnits,
  RevealDiscovery: handleRevealDiscovery,
  SetDiscoveryState: handleSetDiscoveryState,
  SetLocationName: handleSetLocationName,
  SpawnItem: handleSpawnItem,
  SpawnDropPackage: handleSpawnDropPackage,
  SpawnFromDropTable: handleSpawnFromDropTable,
  CreateWorkProcess: handleCreateWorkProcess,
  AdvanceWorkProcess: handleAdvanceWorkProcess,
  AddTag: handleAddTag,
  DisableTag: handleDisableTag,
  EnableTag: handleEnableTag,
  HideTag: handleHideTag,
  RemoveTag: handleRemoveTag,
  RevealTag: handleRevealTag,
  SetSystemTier: handleSetSystemTier,
  SetSystemState: handleSetSystemState,
  ClearSystemState: handleClearSystemState,
  UpgradeSystemTier: handleUpgradeSystemTier,
  RemoveEvent: handleRemoveEvent,
  TransformEvent: handleTransformEvent,
  SetProp: handleSetProp,
  AddProp: handleAddProp,
  AddSkillPoints: handleAddSkillPoints,
  AddSkillPointsIfSkillNodeUnlocked: handleAddSkillPointsIfSkillNodeUnlocked,
  GrantSkillNode: handleGrantSkillNode,
  AddModifier: handleAddModifier,
  MulModifier: handleMulModifier,
  GrantUnlock: handleGrantUnlock,
  RevokeUnlock: handleRevokeUnlock,
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
