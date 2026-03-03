import {
  addGlobalSkillModifier,
  addPawnSkillModifier,
  getSkillNodeDef,
  getSkillNodeUnlockEffects,
  getSkillTreeDef,
  getUnlockedSkillSet,
  grantSkillEnvTagUnlock,
  grantSkillFeatureUnlock,
  grantSkillHubStructureUnlock,
  grantSkillHubTagUnlock,
  grantSkillItemTagUnlock,
  grantSkillRecipeUnlock,
  multiplyGlobalSkillModifier,
  multiplyPawnSkillModifier,
  revokeSkillEnvTagUnlock,
  revokeSkillFeatureUnlock,
  revokeSkillHubStructureUnlock,
  revokeSkillHubTagUnlock,
  revokeSkillItemTagUnlock,
  revokeSkillRecipeUnlock,
} from "../../skills.js";
import { runEffect } from "../index.js";

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

function resolveSkillNodeId(effect) {
  if (typeof effect?.nodeId === "string" && effect.nodeId.length > 0) {
    return effect.nodeId;
  }
  if (typeof effect?.skillNodeId === "string" && effect.skillNodeId.length > 0) {
    return effect.skillNodeId;
  }
  return null;
}

function getLeaderPawnById(state, pawnId) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const rawNum = Number(pawnId);
  const idNum = Number.isFinite(rawNum) ? Math.floor(rawNum) : null;
  for (const pawn of pawns) {
    if (!pawn || pawn.role !== "leader") continue;
    if (idNum != null && Number.isFinite(pawn.id) && Math.floor(pawn.id) === idNum) {
      return pawn;
    }
    if (String(pawn.id) === String(pawnId)) return pawn;
  }
  return null;
}

function getNodeCost(nodeDef) {
  if (!Number.isFinite(nodeDef?.cost)) return 1;
  return Math.max(0, Math.floor(nodeDef.cost));
}

function requirementsPass(nodeDef, unlockedSet) {
  const reqIds = Array.isArray(nodeDef?.requirements?.requiredNodeIds)
    ? nodeDef.requirements.requiredNodeIds
    : [];
  for (const reqId of reqIds) {
    if (typeof reqId !== "string" || reqId.length <= 0) continue;
    if (!unlockedSet.has(reqId)) return false;
  }
  return true;
}

function hasUnlockedAdjacent(nodeDef, unlockedSet) {
  const adjacent = Array.isArray(nodeDef?.adjacent) ? nodeDef.adjacent : [];
  for (const adjacentId of adjacent) {
    if (typeof adjacentId !== "string" || adjacentId.length <= 0) continue;
    if (unlockedSet.has(adjacentId)) return true;
  }
  return false;
}

function applyUnlockToLeader(leaderPawn, nodeId) {
  const nextUnlocked = Array.isArray(leaderPawn?.unlockedSkillNodeIds)
    ? leaderPawn.unlockedSkillNodeIds.slice()
    : [];
  if (!nextUnlocked.includes(nodeId)) {
    nextUnlocked.push(nodeId);
    nextUnlocked.sort((left, right) => String(left).localeCompare(String(right)));
    leaderPawn.unlockedSkillNodeIds = nextUnlocked;
    return true;
  }
  return false;
}

function resolveUnlockType(effect) {
  const type = effect?.unlockType;
  if (
    type === "recipe" ||
    type === "hubStructure" ||
    type === "tag" ||
    type === "feature"
  ) {
    return type;
  }
  return null;
}

function applySkillPointsDelta(leaderPawn, amountRaw) {
  if (!leaderPawn) return false;
  if (!Number.isFinite(amountRaw)) return false;
  const amount = Math.floor(amountRaw);
  if (amount === 0) return false;

  const current = Number.isFinite(leaderPawn.skillPoints)
    ? Math.max(0, Math.floor(leaderPawn.skillPoints))
    : 0;
  const next = Math.max(0, current + amount);
  if (next === current) return false;
  leaderPawn.skillPoints = next;
  return true;
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
  if (
    unlockType === "feature" &&
    typeof effect?.featureId === "string" &&
    effect.featureId.length > 0
  ) {
    return effect.featureId;
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

export function handleAddSkillPoints(state, effect, context) {
  if (!state || !effect || typeof effect !== "object") return false;
  const pawnId = resolvePawnId(effect, context);
  if (pawnId == null) return false;
  const leaderPawn = getLeaderPawnById(state, pawnId);
  if (!leaderPawn) return false;

  const amountRaw = resolveModifierAmount(effect);
  return applySkillPointsDelta(leaderPawn, amountRaw);
}

export function handleAddSkillPointsIfSkillNodeUnlocked(state, effect, context) {
  if (!state || !effect || typeof effect !== "object") return false;
  const pawnId = resolvePawnId(effect, context);
  if (pawnId == null) return false;
  const leaderPawn = getLeaderPawnById(state, pawnId);
  if (!leaderPawn) return false;

  const nodeId = resolveSkillNodeId(effect);
  if (!nodeId) return false;
  const unlockedSet = getUnlockedSkillSet(state, leaderPawn.id);
  if (!unlockedSet.has(nodeId)) return false;

  const amountRaw = resolveModifierAmount(effect);
  return applySkillPointsDelta(leaderPawn, amountRaw);
}

export function handleGrantSkillNode(state, effect, context) {
  if (!state || !effect || typeof effect !== "object") return false;
  const pawnId = resolvePawnId(effect, context);
  if (pawnId == null) return false;
  const leaderPawn = getLeaderPawnById(state, pawnId);
  if (!leaderPawn) return false;

  const nodeId = resolveSkillNodeId(effect);
  if (!nodeId) return false;
  const nodeDef = getSkillNodeDef(null, nodeId);
  if (!nodeDef) return false;
  const treeDef = getSkillTreeDef(nodeDef.treeId);
  if (!treeDef) return false;

  const unlockedSet = getUnlockedSkillSet(state, leaderPawn.id);
  if (unlockedSet.has(nodeDef.id)) return false;

  const ignoreCost = effect.ignoreCost === true;
  const ignoreAdjacency = effect.ignoreAdjacency === true;
  const ignoreRequirements = effect.ignoreRequirements === true;

  const cost = getNodeCost(nodeDef);
  const currentPoints = Number.isFinite(leaderPawn.skillPoints)
    ? Math.max(0, Math.floor(leaderPawn.skillPoints))
    : 0;

  if (!ignoreCost && currentPoints < cost) return false;

  const isStart = treeDef.startNodeId === nodeDef.id;
  if (!ignoreAdjacency && !isStart && !hasUnlockedAdjacent(nodeDef, unlockedSet)) {
    return false;
  }
  if (!ignoreRequirements && !requirementsPass(nodeDef, unlockedSet)) return false;

  const nextPoints = ignoreCost ? currentPoints : Math.max(0, currentPoints - cost);
  leaderPawn.skillPoints = nextPoints;
  const changed = applyUnlockToLeader(leaderPawn, nodeDef.id);
  if (!changed) return false;

  const unlockEffects = getSkillNodeUnlockEffects(nodeDef);
  if (unlockEffects.length > 0) {
    const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
    runEffect(state, unlockEffects, {
      ...context,
      kind: "game",
      state,
      source: leaderPawn,
      pawn: leaderPawn,
      pawnId: leaderPawn.id,
      ownerId: leaderPawn.id,
      tSec: nowSec,
    });
  }
  return true;
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
  if (unlockType === "feature") {
    return grantSkillFeatureUnlock(state, unlockId);
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
  if (unlockType === "feature") {
    return revokeSkillFeatureUnlock(state, unlockId);
  }
  const tagDomain = resolveTagDomain(effect);
  if (!tagDomain) return false;
  if (tagDomain === "env") return revokeSkillEnvTagUnlock(state, unlockId);
  if (tagDomain === "hub") return revokeSkillHubTagUnlock(state, unlockId);
  return revokeSkillItemTagUnlock(state, unlockId);
}
