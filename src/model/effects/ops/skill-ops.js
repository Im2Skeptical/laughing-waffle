import {
  addGlobalSkillModifier,
  addPawnSkillModifier,
  grantSkillEnvTagUnlock,
  grantSkillHubStructureUnlock,
  grantSkillHubTagUnlock,
  grantSkillItemTagUnlock,
  grantSkillRecipeUnlock,
  multiplyGlobalSkillModifier,
  multiplyPawnSkillModifier,
  revokeSkillEnvTagUnlock,
  revokeSkillHubStructureUnlock,
  revokeSkillHubTagUnlock,
  revokeSkillItemTagUnlock,
  revokeSkillRecipeUnlock,
} from "../../skills.js";

function resolvePawnId(effect, context) {
  if (effect?.pawnId != null) return effect.pawnId;
  const targetRef =
    effect?.target && typeof effect.target === "object"
      ? effect.target.ref
      : null;
  if (targetRef === "pawn") {
    if (context?.pawn?.id != null) return context.pawn.id;
    if (context?.pawnId != null) return context.pawnId;
    if (context?.ownerId != null) return context.ownerId;
  }
  if (context?.pawn?.id != null) return context.pawn.id;
  if (context?.pawnId != null) return context.pawnId;
  return null;
}

function resolveModifierAmount(effect) {
  if (Number.isFinite(effect?.amount)) return effect.amount;
  if (Number.isFinite(effect?.delta)) return effect.delta;
  return null;
}

function resolveMultiplierFactor(effect) {
  if (Number.isFinite(effect?.factor)) return effect.factor;
  if (Number.isFinite(effect?.multiplier)) return effect.multiplier;
  if (Number.isFinite(effect?.amount)) return effect.amount;
  return null;
}

function resolveUnlockType(effect) {
  const type = effect?.unlockType;
  if (type === "recipe" || type === "hubStructure" || type === "tag") return type;
  return null;
}

function resolveTagDomain(effect) {
  const domain = effect?.tagDomain ?? effect?.domain ?? effect?.tagKind;
  if (domain === "env" || domain === "hub" || domain === "item") return domain;
  return null;
}

function resolveUnlockId(effect, unlockType) {
  if (typeof effect?.unlockId === "string" && effect.unlockId.length > 0) {
    return effect.unlockId;
  }
  if (
    unlockType === "recipe" &&
    typeof effect?.recipeId === "string" &&
    effect.recipeId.length > 0
  ) {
    return effect.recipeId;
  }
  if (
    unlockType === "tag" &&
    typeof effect?.tagId === "string" &&
    effect.tagId.length > 0
  ) {
    return effect.tagId;
  }
  if (
    unlockType === "hubStructure" &&
    typeof effect?.hubStructureId === "string" &&
    effect.hubStructureId.length > 0
  ) {
    return effect.hubStructureId;
  }
  const tagDomain = unlockType === "tag" ? resolveTagDomain(effect) : null;
  if (
    unlockType === "tag" &&
    tagDomain === "env" &&
    typeof effect?.envTagId === "string" &&
    effect.envTagId.length > 0
  ) {
    return effect.envTagId;
  }
  if (
    unlockType === "tag" &&
    tagDomain === "hub" &&
    typeof effect?.hubTagId === "string" &&
    effect.hubTagId.length > 0
  ) {
    return effect.hubTagId;
  }
  if (
    unlockType === "tag" &&
    tagDomain === "item" &&
    typeof effect?.itemTagId === "string" &&
    effect.itemTagId.length > 0
  ) {
    return effect.itemTagId;
  }
  if (typeof effect?.defId === "string" && effect.defId.length > 0) {
    return effect.defId;
  }
  return null;
}

export function handleAddModifier(state, effect, context) {
  if (!state || !effect || typeof effect !== "object") return false;
  const key = effect.key;
  const amount = resolveModifierAmount(effect);
  if (typeof key !== "string" || !key.length) return false;
  if (!Number.isFinite(amount)) return false;

  const scope = effect.scope === "pawn" ? "pawn" : "global";
  if (scope === "pawn") {
    const pawnId = resolvePawnId(effect, context);
    if (pawnId == null) return false;
    return addPawnSkillModifier(state, pawnId, key, amount);
  }
  return addGlobalSkillModifier(state, key, amount);
}

export function handleMulModifier(state, effect, context) {
  if (!state || !effect || typeof effect !== "object") return false;
  const key = effect.key;
  const factor = resolveMultiplierFactor(effect);
  if (typeof key !== "string" || !key.length) return false;
  if (!Number.isFinite(factor)) return false;

  const scope = effect.scope === "pawn" ? "pawn" : "global";
  if (scope === "pawn") {
    const pawnId = resolvePawnId(effect, context);
    if (pawnId == null) return false;
    return multiplyPawnSkillModifier(state, pawnId, key, factor);
  }
  return multiplyGlobalSkillModifier(state, key, factor);
}

export function handleGrantUnlock(state, effect) {
  if (!state || !effect || typeof effect !== "object") return false;
  const unlockType = resolveUnlockType(effect);
  if (!unlockType) return false;
  const unlockId = resolveUnlockId(effect, unlockType);
  if (!unlockId) return false;

  if (unlockType === "recipe") {
    return grantSkillRecipeUnlock(state, unlockId);
  }
  if (unlockType === "hubStructure") {
    return grantSkillHubStructureUnlock(state, unlockId);
  }
  const tagDomain = resolveTagDomain(effect);
  if (!tagDomain) return false;
  if (tagDomain === "env") return grantSkillEnvTagUnlock(state, unlockId);
  if (tagDomain === "hub") return grantSkillHubTagUnlock(state, unlockId);
  return grantSkillItemTagUnlock(state, unlockId);
}

export function handleRevokeUnlock(state, effect) {
  if (!state || !effect || typeof effect !== "object") return false;
  const unlockType = resolveUnlockType(effect);
  if (!unlockType) return false;
  const unlockId = resolveUnlockId(effect, unlockType);
  if (!unlockId) return false;

  if (unlockType === "recipe") {
    return revokeSkillRecipeUnlock(state, unlockId);
  }
  if (unlockType === "hubStructure") {
    return revokeSkillHubStructureUnlock(state, unlockId);
  }
  const tagDomain = resolveTagDomain(effect);
  if (!tagDomain) return false;
  if (tagDomain === "env") return revokeSkillEnvTagUnlock(state, unlockId);
  if (tagDomain === "hub") return revokeSkillHubTagUnlock(state, unlockId);
  return revokeSkillItemTagUnlock(state, unlockId);
}
