import {
  addGlobalSkillModifier,
  addPawnSkillModifier,
  grantSkillHubStructureUnlock,
  grantSkillRecipeUnlock,
  multiplyGlobalSkillModifier,
  multiplyPawnSkillModifier,
  revokeSkillHubStructureUnlock,
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
  if (type === "recipe" || type === "hubStructure") return type;
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
    unlockType === "hubStructure" &&
    typeof effect?.hubStructureId === "string" &&
    effect.hubStructureId.length > 0
  ) {
    return effect.hubStructureId;
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
  return grantSkillHubStructureUnlock(state, unlockId);
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
  return revokeSkillHubStructureUnlock(state, unlockId);
}
