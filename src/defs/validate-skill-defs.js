// validate-skill-defs.js
// Dev-only integrity checks for skill tree defs.

function addIssue(list, message) {
  list.push(message);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value && typeof value === "object";
}

function normalizeNodeCost(node) {
  if (!Number.isFinite(node?.cost)) return 1;
  return Math.max(0, Math.floor(node.cost));
}

const EFFECT_OPS = new Set([
  "moveItem",
  "stackItem",
  "splitStack",
  "AddResource",
  "TransformItem",
  "RemoveItem",
  "ExpireItemChance",
  "ExpireStoredPerishables",
  "AddTag",
  "RemoveTag",
  "DisableTag",
  "EnableTag",
  "SetSystemTier",
  "UpgradeSystemTier",
  "SetSystemState",
  "ResetSystemState",
  "AddToSystemState",
  "ClampSystemState",
  "AccumulateRatio",
  "AdjustSystemState",
  "ClearSystemState",
  "RemoveEvent",
  "TransformEvent",
  "ConsumeItem",
  "TransferUnits",
  "SpawnItem",
  "SpawnFromDropTable",
  "CreateWorkProcess",
  "AdvanceWorkProcess",
  "SetProp",
  "AddProp",
  "AddSkillPoints",
  "AddSkillPointsIfSkillNodeUnlocked",
  "GrantSkillNode",
  "AddModifier",
  "MulModifier",
  "GrantUnlock",
  "RevokeUnlock",
]);

const SKILL_SCOPE_VALUES = new Set(["global", "pawn"]);
const SKILL_MODIFIER_KEYS = new Set([
  "forageTierBonus",
  "forageStaminaCostDelta",
  "farmingStaminaCostDelta",
  "restStaminaBonusFlat",
  "restStaminaBonusMult",
  "apCapBonus",
  "editableHistoryWindowBonusSec",
  "projectionHorizonBonusSec",
  "populationFoodMult",
]);
const SKILL_UNLOCK_TYPES = new Set(["recipe", "hubStructure", "tag", "feature"]);
const SKILL_TAG_DOMAINS = new Set(["env", "hub", "item"]);

function normalizeEffectList(effectSpec) {
  if (effectSpec == null) return [];
  if (Array.isArray(effectSpec)) return effectSpec;
  if (isObject(effectSpec)) return [effectSpec];
  return null;
}

function validateSkillModifierEffect(effect, contextLabel, errors) {
  const scope = effect?.scope;
  if (!SKILL_SCOPE_VALUES.has(scope)) {
    addIssue(errors, `${contextLabel}: ${effect.op} scope must be "global" or "pawn".`);
  }
  if (typeof effect?.key !== "string" || !SKILL_MODIFIER_KEYS.has(effect.key)) {
    addIssue(errors, `${contextLabel}: ${effect.op} key "${effect?.key}" is not supported.`);
  }
  if (effect.op === "AddModifier") {
    const amount = Number.isFinite(effect?.amount)
      ? effect.amount
      : Number.isFinite(effect?.delta)
        ? effect.delta
        : null;
    if (!Number.isFinite(amount)) {
      addIssue(errors, `${contextLabel}: AddModifier requires numeric amount or delta.`);
    }
  } else if (effect.op === "MulModifier") {
    const factor = Number.isFinite(effect?.factor)
      ? effect.factor
      : Number.isFinite(effect?.multiplier)
        ? effect.multiplier
        : Number.isFinite(effect?.amount)
          ? effect.amount
          : null;
    if (!Number.isFinite(factor)) {
      addIssue(errors, `${contextLabel}: MulModifier requires numeric factor.`);
    }
  }
}

function validateSkillPointEffect(effect, contextLabel, errors) {
  const amount = Number.isFinite(effect?.amount)
    ? effect.amount
    : Number.isFinite(effect?.delta)
      ? effect.delta
      : null;
  if (!Number.isFinite(amount)) {
    addIssue(errors, `${contextLabel}: ${effect.op} requires numeric amount or delta.`);
  }
}

function validateSkillNodeGrantEffect(effect, contextLabel, errors) {
  if (typeof effect?.nodeId !== "string" || !effect.nodeId.length) {
    addIssue(errors, `${contextLabel}: GrantSkillNode requires non-empty nodeId.`);
  }
}

function validateSkillPointIfNodeUnlockedEffect(effect, contextLabel, errors) {
  validateSkillPointEffect(effect, contextLabel, errors);
  if (typeof effect?.nodeId !== "string" || !effect.nodeId.length) {
    addIssue(
      errors,
      `${contextLabel}: AddSkillPointsIfSkillNodeUnlocked requires non-empty nodeId.`
    );
  }
}

function validateSkillUnlockEffect(
  effect,
  contextLabel,
  knownRecipeIds,
  knownHubIds,
  knownEnvTagIds,
  knownHubTagIds,
  knownFeatureIds,
  knownItemTagIds,
  errors
) {
  const unlockType = effect?.unlockType;
  if (!SKILL_UNLOCK_TYPES.has(unlockType)) {
    addIssue(
      errors,
      `${contextLabel}: ${effect.op} unlockType must be "recipe", "hubStructure", "tag", or "feature".`
    );
    return;
  }
  const tagDomain =
    unlockType === "tag" ? effect?.tagDomain ?? effect?.domain ?? effect?.tagKind : null;
  if (unlockType === "tag" && !SKILL_TAG_DOMAINS.has(tagDomain)) {
    addIssue(
      errors,
      `${contextLabel}: ${effect.op} tag unlock requires tagDomain "env", "hub", or "item".`
    );
    return;
  }
  const unlockId =
    typeof effect?.unlockId === "string" && effect.unlockId.length > 0
      ? effect.unlockId
      : unlockType === "recipe" &&
          typeof effect?.recipeId === "string" &&
          effect.recipeId.length > 0
        ? effect.recipeId
        : unlockType === "tag" &&
            typeof effect?.tagId === "string" &&
            effect.tagId.length > 0
          ? effect.tagId
        : unlockType === "hubStructure" &&
            typeof effect?.hubStructureId === "string" &&
            effect.hubStructureId.length > 0
          ? effect.hubStructureId
          : unlockType === "feature" &&
              typeof effect?.featureId === "string" &&
              effect.featureId.length > 0
            ? effect.featureId
          : unlockType === "tag" &&
              tagDomain === "env" &&
              typeof effect?.envTagId === "string" &&
              effect.envTagId.length > 0
            ? effect.envTagId
            : unlockType === "tag" &&
                tagDomain === "hub" &&
                typeof effect?.hubTagId === "string" &&
                effect.hubTagId.length > 0
              ? effect.hubTagId
              : unlockType === "tag" &&
                  tagDomain === "item" &&
                  typeof effect?.itemTagId === "string" &&
                  effect.itemTagId.length > 0
                ? effect.itemTagId
          : null;
  if (!unlockId) {
    addIssue(errors, `${contextLabel}: ${effect.op} requires unlockId.`);
    return;
  }
  if (unlockType === "recipe" && !knownRecipeIds.has(unlockId)) {
    addIssue(errors, `${contextLabel}: ${effect.op} recipe "${unlockId}" not found.`);
  } else if (unlockType === "hubStructure" && !knownHubIds.has(unlockId)) {
    addIssue(
      errors,
      `${contextLabel}: ${effect.op} hub structure "${unlockId}" not found.`
    );
  } else if (
    unlockType === "feature" &&
    knownFeatureIds &&
    !knownFeatureIds.has(unlockId)
  ) {
    addIssue(errors, `${contextLabel}: ${effect.op} feature "${unlockId}" not found.`);
  } else if (
    unlockType === "tag" &&
    tagDomain === "env" &&
    knownEnvTagIds &&
    !knownEnvTagIds.has(unlockId)
  ) {
    addIssue(errors, `${contextLabel}: ${effect.op} env tag "${unlockId}" not found.`);
  } else if (
    unlockType === "tag" &&
    tagDomain === "hub" &&
    knownHubTagIds &&
    !knownHubTagIds.has(unlockId)
  ) {
    addIssue(errors, `${contextLabel}: ${effect.op} hub tag "${unlockId}" not found.`);
  } else if (
    unlockType === "tag" &&
    tagDomain === "item" &&
    knownItemTagIds &&
    !knownItemTagIds.has(unlockId)
  ) {
    addIssue(errors, `${contextLabel}: ${effect.op} item tag "${unlockId}" not found.`);
  }
}

function validateNodeEffectList(
  effectSpec,
  contextLabel,
  knownRecipeIds,
  knownHubIds,
  knownEnvTagIds,
  knownHubTagIds,
  knownFeatureIds,
  knownItemTagIds,
  errors
) {
  const list = normalizeEffectList(effectSpec);
  if (list == null) {
    addIssue(errors, `${contextLabel}: must be an effect object or array.`);
    return;
  }
  for (const effect of list) {
    if (!isObject(effect)) {
      addIssue(errors, `${contextLabel}: effect entries must be objects.`);
      continue;
    }
    const op = effect.op || effect.kind;
    if (typeof op !== "string" || !op.length) {
      addIssue(errors, `${contextLabel}: effect missing op.`);
      continue;
    }
    if (!EFFECT_OPS.has(op)) {
      addIssue(errors, `${contextLabel}: invalid op "${op}".`);
      continue;
    }
    if (op === "AddModifier" || op === "MulModifier") {
      validateSkillModifierEffect(effect, contextLabel, errors);
    } else if (op === "AddSkillPoints") {
      validateSkillPointEffect(effect, contextLabel, errors);
    } else if (op === "AddSkillPointsIfSkillNodeUnlocked") {
      validateSkillPointIfNodeUnlockedEffect(effect, contextLabel, errors);
    } else if (op === "GrantSkillNode") {
      validateSkillNodeGrantEffect(effect, contextLabel, errors);
    } else if (op === "GrantUnlock" || op === "RevokeUnlock") {
      validateSkillUnlockEffect(
        effect,
        contextLabel,
        knownRecipeIds,
        knownHubIds,
        knownEnvTagIds,
        knownHubTagIds,
        knownFeatureIds,
        knownItemTagIds,
        errors
      );
    }
  }
}

function validateRequirements(node, allNodeIds, errors) {
  const requirements = node?.requirements;
  if (requirements == null) return;
  if (!isObject(requirements)) {
    addIssue(errors, `skillNodes: "${node.id}" requirements must be an object.`);
    return;
  }

  const requiredNodeIds = toArray(requirements.requiredNodeIds);
  for (const reqId of requiredNodeIds) {
    if (typeof reqId !== "string" || !reqId.length) {
      addIssue(errors, `skillNodes: "${node.id}" requiredNodeIds must contain non-empty strings.`);
      continue;
    }
    if (!allNodeIds.has(reqId)) {
      addIssue(errors, `skillNodes: "${node.id}" requirement node "${reqId}" not found.`);
    }
  }
}

export function validateSkillDefs({
  skillTrees,
  skillNodes,
  recipeDefs,
  hubStructureDefs,
  envTagDefs,
  hubTagDefs,
  skillFeatureUnlockDefs,
  itemTagDefs,
} = {}) {
  const errors = [];
  const warnings = [];

  if (!isObject(skillTrees)) {
    addIssue(errors, "skillTrees registry missing or invalid.");
    return { ok: false, errors, warnings };
  }
  if (!isObject(skillNodes)) {
    addIssue(errors, "skillNodes registry missing or invalid.");
    return { ok: false, errors, warnings };
  }

  const treeById = new Map();
  const treeDeclaredRingIds = new Map();
  const treeHasExplicitRingDecl = new Map();
  for (const [key, tree] of Object.entries(skillTrees)) {
    if (!isObject(tree)) {
      addIssue(errors, `skillTrees: entry "${key}" must be an object.`);
      continue;
    }
    if (typeof tree.id !== "string" || !tree.id.length) {
      addIssue(errors, `skillTrees: entry "${key}" missing string id.`);
      continue;
    }
    if (treeById.has(tree.id)) {
      addIssue(errors, `skillTrees: duplicate id "${tree.id}".`);
      continue;
    }
    if (tree.id !== key) {
      warnings.push(`skillTrees: key "${key}" differs from id "${tree.id}".`);
    }
    if (typeof tree.startNodeId !== "string" || !tree.startNodeId.length) {
      addIssue(errors, `skillTrees: "${tree.id}" missing startNodeId.`);
      continue;
    }
    if (tree.ui != null && !isObject(tree.ui)) {
      addIssue(errors, `skillTrees: "${tree.id}" ui must be an object when provided.`);
    }
    if (isObject(tree.ui) && tree.ui.ringLayout != null) {
      if (!isObject(tree.ui.ringLayout)) {
        addIssue(errors, `skillTrees: "${tree.id}" ui.ringLayout must be an object.`);
      } else {
        const ringLayout = tree.ui.ringLayout;
        const declaredRingIds = new Set(["core"]);
        let hasExplicitDecl = false;
        if (ringLayout.radii != null) {
          if (!isObject(ringLayout.radii)) {
            addIssue(errors, `skillTrees: "${tree.id}" ui.ringLayout.radii must be an object.`);
          } else {
            for (const [ringId, radius] of Object.entries(ringLayout.radii)) {
              if (typeof ringId !== "string" || !ringId.length) {
                addIssue(errors, `skillTrees: "${tree.id}" ui.ringLayout.radii keys must be non-empty strings.`);
                continue;
              }
              hasExplicitDecl = true;
              declaredRingIds.add(ringId);
              if (!Number.isFinite(radius) || radius < 0) {
                addIssue(
                  errors,
                  `skillTrees: "${tree.id}" ui.ringLayout.radii["${ringId}"] must be >= 0.`
                );
              }
            }
          }
        }
        if (ringLayout.ringOrder != null) {
          if (!Array.isArray(ringLayout.ringOrder)) {
            addIssue(errors, `skillTrees: "${tree.id}" ui.ringLayout.ringOrder must be an array.`);
          } else {
            const seenRingIds = new Set();
            for (const ringId of ringLayout.ringOrder) {
              if (typeof ringId !== "string" || !ringId.length) {
                addIssue(
                  errors,
                  `skillTrees: "${tree.id}" ui.ringLayout.ringOrder must contain non-empty strings.`
                );
                continue;
              }
              if (seenRingIds.has(ringId)) {
                addIssue(
                  errors,
                  `skillTrees: "${tree.id}" ui.ringLayout.ringOrder contains duplicate "${ringId}".`
                );
                continue;
              }
              hasExplicitDecl = true;
              seenRingIds.add(ringId);
              declaredRingIds.add(ringId);
            }
          }
        }
        if (
          ringLayout.localSwapIterations != null &&
          (!Number.isFinite(ringLayout.localSwapIterations) || ringLayout.localSwapIterations < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.localSwapIterations must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.overlapIterations != null &&
          (!Number.isFinite(ringLayout.overlapIterations) || ringLayout.overlapIterations < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.overlapIterations must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.overlapPaddingPx != null &&
          (!Number.isFinite(ringLayout.overlapPaddingPx) || ringLayout.overlapPaddingPx < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.overlapPaddingPx must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.componentBandGapDeg != null &&
          (!Number.isFinite(ringLayout.componentBandGapDeg) || ringLayout.componentBandGapDeg < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.componentBandGapDeg must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.radialNudgeIterations != null &&
          (!Number.isFinite(ringLayout.radialNudgeIterations) || ringLayout.radialNudgeIterations < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.radialNudgeIterations must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.radialNudgeMaxPx != null &&
          (!Number.isFinite(ringLayout.radialNudgeMaxPx) || ringLayout.radialNudgeMaxPx < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.radialNudgeMaxPx must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.radialNudgePaddingPx != null &&
          (!Number.isFinite(ringLayout.radialNudgePaddingPx) || ringLayout.radialNudgePaddingPx < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.radialNudgePaddingPx must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.radialNudgeSpring != null &&
          (!Number.isFinite(ringLayout.radialNudgeSpring) || ringLayout.radialNudgeSpring < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.radialNudgeSpring must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.angleSwapIterations != null &&
          (!Number.isFinite(ringLayout.angleSwapIterations) || ringLayout.angleSwapIterations < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.angleSwapIterations must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.angleSwapAdjacentRingWeight != null &&
          (!Number.isFinite(ringLayout.angleSwapAdjacentRingWeight) ||
            ringLayout.angleSwapAdjacentRingWeight < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.angleSwapAdjacentRingWeight must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.angleSwapSameRingWeight != null &&
          (!Number.isFinite(ringLayout.angleSwapSameRingWeight) || ringLayout.angleSwapSameRingWeight < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.angleSwapSameRingWeight must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.angleSwapFarRingWeight != null &&
          (!Number.isFinite(ringLayout.angleSwapFarRingWeight) || ringLayout.angleSwapFarRingWeight < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.angleSwapFarRingWeight must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.angleSwapTeleportWeight != null &&
          (!Number.isFinite(ringLayout.angleSwapTeleportWeight) || ringLayout.angleSwapTeleportWeight < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.angleSwapTeleportWeight must be >= 0 when provided.`
          );
        }
        if (
          ringLayout.angleSwapTeleportRingDeltaStart != null &&
          (!Number.isFinite(ringLayout.angleSwapTeleportRingDeltaStart) ||
            ringLayout.angleSwapTeleportRingDeltaStart < 1)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.angleSwapTeleportRingDeltaStart must be >= 1 when provided.`
          );
        }
        if (
          ringLayout.angleSwapTeleportAngleDeg != null &&
          (!Number.isFinite(ringLayout.angleSwapTeleportAngleDeg) ||
            ringLayout.angleSwapTeleportAngleDeg < 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.ringLayout.angleSwapTeleportAngleDeg must be >= 0 when provided.`
          );
        }
        treeDeclaredRingIds.set(tree.id, declaredRingIds);
        treeHasExplicitRingDecl.set(tree.id, hasExplicitDecl);
      }
    }
    if (isObject(tree.ui) && tree.ui.nodeSizes != null) {
      if (!isObject(tree.ui.nodeSizes)) {
        addIssue(errors, `skillTrees: "${tree.id}" ui.nodeSizes must be an object.`);
      } else {
        const nodeSizes = tree.ui.nodeSizes;
        if (
          nodeSizes.defaultRadius != null &&
          (!Number.isFinite(nodeSizes.defaultRadius) || nodeSizes.defaultRadius <= 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.nodeSizes.defaultRadius must be > 0 when provided.`
          );
        }
        if (
          nodeSizes.notableRadius != null &&
          (!Number.isFinite(nodeSizes.notableRadius) || nodeSizes.notableRadius <= 0)
        ) {
          addIssue(
            errors,
            `skillTrees: "${tree.id}" ui.nodeSizes.notableRadius must be > 0 when provided.`
          );
        }
      }
    }
    treeById.set(tree.id, tree);
  }

  const nodeById = new Map();
  for (const [key, node] of Object.entries(skillNodes)) {
    if (!isObject(node)) {
      addIssue(errors, `skillNodes: entry "${key}" must be an object.`);
      continue;
    }
    if (typeof node.id !== "string" || !node.id.length) {
      addIssue(errors, `skillNodes: entry "${key}" missing string id.`);
      continue;
    }
    if (nodeById.has(node.id)) {
      addIssue(errors, `skillNodes: duplicate id "${node.id}".`);
      continue;
    }
    if (node.id !== key) {
      warnings.push(`skillNodes: key "${key}" differs from id "${node.id}".`);
    }
    if (typeof node.treeId !== "string" || !node.treeId.length) {
      addIssue(errors, `skillNodes: "${node.id}" missing treeId.`);
    } else if (!treeById.has(node.treeId)) {
      addIssue(errors, `skillNodes: "${node.id}" references unknown tree "${node.treeId}".`);
    }
    if (typeof node.name !== "string" || !node.name.length) {
      addIssue(errors, `skillNodes: "${node.id}" missing name.`);
    }
    if (node.desc != null && typeof node.desc !== "string") {
      addIssue(errors, `skillNodes: "${node.id}" desc must be a string when provided.`);
    }
    const cost = normalizeNodeCost(node);
    if (!Number.isFinite(cost) || cost < 0) {
      addIssue(errors, `skillNodes: "${node.id}" cost must be >= 0.`);
    }

    if (node.uiPos != null) {
      if (!isObject(node.uiPos)) {
        addIssue(errors, `skillNodes: "${node.id}" uiPos must be an object.`);
      } else if (!Number.isFinite(node.uiPos.x) || !Number.isFinite(node.uiPos.y)) {
        addIssue(errors, `skillNodes: "${node.id}" uiPos requires numeric x and y.`);
      }
    }
    if (node.uiPosNudge != null) {
      if (!isObject(node.uiPosNudge)) {
        addIssue(errors, `skillNodes: "${node.id}" uiPosNudge must be an object.`);
      } else {
        if (node.uiPosNudge.x != null && !Number.isFinite(node.uiPosNudge.x)) {
          addIssue(errors, `skillNodes: "${node.id}" uiPosNudge.x must be numeric when provided.`);
        }
        if (node.uiPosNudge.y != null && !Number.isFinite(node.uiPosNudge.y)) {
          addIssue(errors, `skillNodes: "${node.id}" uiPosNudge.y must be numeric when provided.`);
        }
      }
    }
    if (node.ringId != null && (typeof node.ringId !== "string" || !node.ringId.length)) {
      addIssue(errors, `skillNodes: "${node.id}" ringId must be a non-empty string when provided.`);
    }
    if (
      node.uiNodeRadius != null &&
      (!Number.isFinite(node.uiNodeRadius) || node.uiNodeRadius <= 0)
    ) {
      addIssue(errors, `skillNodes: "${node.id}" uiNodeRadius must be > 0 when provided.`);
    }
    if (Object.prototype.hasOwnProperty.call(node, "effects")) {
      addIssue(errors, `skillNodes: "${node.id}" uses deprecated "effects"; use "onUnlock".`);
    }

    nodeById.set(node.id, node);
  }

  const allNodeIds = new Set(nodeById.keys());
  const knownRecipeIds = new Set(Object.keys(recipeDefs || {}));
  const knownHubIds = new Set(Object.keys(hubStructureDefs || {}));
  const knownEnvTagIds = isObject(envTagDefs) ? new Set(Object.keys(envTagDefs)) : null;
  const knownHubTagIds = isObject(hubTagDefs) ? new Set(Object.keys(hubTagDefs)) : null;
  const knownFeatureIds = isObject(skillFeatureUnlockDefs)
    ? new Set(Object.keys(skillFeatureUnlockDefs))
    : null;
  const knownItemTagIds = isObject(itemTagDefs) ? new Set(Object.keys(itemTagDefs)) : null;

  const treeNodeIds = new Map();
  for (const [nodeId, node] of nodeById.entries()) {
    const treeId = node.treeId;
    if (!treeNodeIds.has(treeId)) treeNodeIds.set(treeId, new Set());
    treeNodeIds.get(treeId).add(nodeId);
  }

  for (const [treeId, tree] of treeById.entries()) {
    const nodesInTree = treeNodeIds.get(treeId) || new Set();
    if (!nodesInTree.size) {
      addIssue(errors, `skillTrees: "${treeId}" has no nodes.`);
      continue;
    }
    if (!nodesInTree.has(tree.startNodeId)) {
      addIssue(errors, `skillTrees: "${treeId}" startNodeId "${tree.startNodeId}" is not in the tree.`);
    }
  }

  for (const [nodeId, node] of nodeById.entries()) {
    const adjacent = toArray(node.adjacent);
    const treeRingIds = treeDeclaredRingIds.get(node.treeId);
    const enforceRingIdDecl = treeHasExplicitRingDecl.get(node.treeId) === true;
    if (
      typeof node.ringId === "string" &&
      node.ringId.length &&
      enforceRingIdDecl &&
      treeRingIds &&
      !treeRingIds.has(node.ringId)
    ) {
      addIssue(
        errors,
        `skillNodes: "${nodeId}" ringId "${node.ringId}" is not declared in tree "${node.treeId}" ringLayout.`
      );
    }
    for (const adjId of adjacent) {
      if (typeof adjId !== "string" || !adjId.length) {
        addIssue(errors, `skillNodes: "${nodeId}" adjacent must contain non-empty strings.`);
        continue;
      }
      const adj = nodeById.get(adjId);
      if (!adj) {
        addIssue(errors, `skillNodes: "${nodeId}" adjacent node "${adjId}" not found.`);
        continue;
      }
      if (adj.treeId !== node.treeId) {
        addIssue(errors, `skillNodes: "${nodeId}" adjacent node "${adjId}" is in another tree.`);
        continue;
      }
      const reverse = toArray(adj.adjacent);
      if (!reverse.includes(nodeId)) {
        addIssue(errors, `skillNodes: adjacency must be symmetric ("${nodeId}" <-> "${adjId}").`);
      }
    }

    validateNodeEffectList(
      node.onUnlock,
      `skillNodes: "${node.id}" onUnlock`,
      knownRecipeIds,
      knownHubIds,
      knownEnvTagIds,
      knownHubTagIds,
      knownFeatureIds,
      knownItemTagIds,
      errors
    );
    if (node.onLock != null) {
      validateNodeEffectList(
        node.onLock,
        `skillNodes: "${node.id}" onLock`,
        knownRecipeIds,
        knownHubIds,
        knownEnvTagIds,
        knownHubTagIds,
        knownFeatureIds,
        knownItemTagIds,
        errors
      );
    }
    validateRequirements(node, allNodeIds, errors);
  }

  return { ok: errors.length === 0, errors, warnings };
}
