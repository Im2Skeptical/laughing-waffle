// formatters.js
// Pure formatting and numeric helpers for skill tree view.

export function floorInt(value, fallback = 0) {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

export function sortedStrings(values) {
  return values.slice().sort((a, b) => String(a).localeCompare(String(b)));
}

export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function formatSkillModifierLabel(scope, key) {
  const scopePrefix = scope === "pawn" ? "Pawn" : "Global";
  const labels = {
    forageTierBonus: "forage tier",
    forageStaminaCostDelta: "forage stamina",
    farmingStaminaCostDelta: "farming stamina",
    restStaminaBonusFlat: "rest stamina",
    restStaminaBonusMult: "rest stamina",
    apCapBonus: "AP cap",
    editableHistoryWindowBonusSec: "editable history",
    projectionHorizonBonusSec: "projection horizon",
    populationFoodMult: "population food",
  };
  const label = labels[key] || key;
  return `${scopePrefix} ${label}`;
}

function formatNodeUnlockEffect(effect) {
  const op = effect?.op;
  if (op === "AddModifier") {
    const scope = effect?.scope === "pawn" ? "pawn" : "global";
    const key = typeof effect?.key === "string" ? effect.key : null;
    const amount = Number.isFinite(effect?.amount)
      ? effect.amount
      : Number.isFinite(effect?.delta)
        ? effect.delta
        : null;
    if (!key || !Number.isFinite(amount)) return null;
    const signed = amount >= 0 ? `+${floorInt(amount)}` : `${floorInt(amount)}`;
    if (
      key === "projectionHorizonBonusSec" ||
      key === "editableHistoryWindowBonusSec"
    ) {
      return `${formatSkillModifierLabel(scope, key)} ${signed}s`;
    }
    return `${formatSkillModifierLabel(scope, key)} ${signed}`;
  }

  if (op === "MulModifier") {
    const scope = effect?.scope === "pawn" ? "pawn" : "global";
    const key = typeof effect?.key === "string" ? effect.key : null;
    const factor = Number.isFinite(effect?.factor)
      ? effect.factor
      : Number.isFinite(effect?.multiplier)
        ? effect.multiplier
        : Number.isFinite(effect?.amount)
          ? effect.amount
          : null;
    if (!key || !Number.isFinite(factor)) return null;
    const pct = Math.round((factor - 1) * 100);
    const signed = pct >= 0 ? `+${pct}%` : `${pct}%`;
    return `${formatSkillModifierLabel(scope, key)} ${signed}`;
  }

  if (op === "GrantUnlock" || op === "RevokeUnlock") {
    const unlockType = effect?.unlockType;
    const tagDomain = effect?.tagDomain ?? effect?.domain ?? effect?.tagKind;
    const unlockId =
      typeof effect?.unlockId === "string" && effect.unlockId.length > 0
        ? effect.unlockId
        : unlockType === "recipe" && typeof effect?.recipeId === "string"
          ? effect.recipeId
          : unlockType === "tag" && typeof effect?.tagId === "string"
            ? effect.tagId
          : unlockType === "feature" && typeof effect?.featureId === "string"
            ? effect.featureId
          : unlockType === "hubStructure" && typeof effect?.hubStructureId === "string"
            ? effect.hubStructureId
            : unlockType === "tag" &&
                tagDomain === "env" &&
                typeof effect?.envTagId === "string"
              ? effect.envTagId
              : unlockType === "tag" &&
                  tagDomain === "hub" &&
                  typeof effect?.hubTagId === "string"
                ? effect.hubTagId
                : unlockType === "tag" &&
                    tagDomain === "item" &&
                    typeof effect?.itemTagId === "string"
                  ? effect.itemTagId
            : null;
    if (!unlockId) return null;
    const action = op === "GrantUnlock" ? "Unlock" : "Lock";
    if (unlockType === "recipe") return `${action} recipe: ${unlockId}`;
    if (unlockType === "hubStructure") return `${action} building: ${unlockId}`;
    if (unlockType === "feature") return `${action} feature: ${unlockId}`;
    if (unlockType === "tag" && tagDomain === "env") return `${action} env tag: ${unlockId}`;
    if (unlockType === "tag" && tagDomain === "hub") return `${action} hub tag: ${unlockId}`;
    if (unlockType === "tag" && tagDomain === "item") return `${action} item tag: ${unlockId}`;
  }

  if (typeof op === "string" && op.length > 0) {
    return `Effect op: ${op}`;
  }
  return null;
}

export function formatNodeEffects(nodeDef) {
  const lines = [];
  const effects = Array.isArray(nodeDef?.onUnlock)
    ? nodeDef.onUnlock
    : nodeDef?.onUnlock && typeof nodeDef.onUnlock === "object"
      ? [nodeDef.onUnlock]
      : [];
  for (const effect of effects) {
    const line = formatNodeUnlockEffect(effect);
    if (line) lines.push(line);
  }
  return lines;
}
