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

export function formatNodeEffects(nodeDef) {
  const lines = [];
  const effects = nodeDef?.effects || null;
  if (!effects) return lines;

  const pawnMods = effects.pawnMods || null;
  if (pawnMods) {
    if (Number.isFinite(pawnMods.forageTierBonus)) {
      lines.push(`Forage tier +${floorInt(pawnMods.forageTierBonus)}`);
    }
    if (Number.isFinite(pawnMods.forageStaminaCostDelta)) {
      lines.push(`Forage stamina ${floorInt(pawnMods.forageStaminaCostDelta)}`);
    }
    if (Number.isFinite(pawnMods.farmingStaminaCostDelta)) {
      lines.push(`Farming stamina ${floorInt(pawnMods.farmingStaminaCostDelta)}`);
    }
    if (Number.isFinite(pawnMods.restStaminaBonusFlat)) {
      lines.push(`Rest stamina +${floorInt(pawnMods.restStaminaBonusFlat)}`);
    }
    if (Number.isFinite(pawnMods.restStaminaBonusMult)) {
      const pct = Math.round((pawnMods.restStaminaBonusMult - 1) * 100);
      lines.push(`Rest stamina +${pct}%`);
    }
  }

  const globalMods = effects.globalMods || null;
  if (globalMods) {
    if (Number.isFinite(globalMods.apCapBonus)) {
      lines.push(`AP cap +${floorInt(globalMods.apCapBonus)}`);
    }
    if (Number.isFinite(globalMods.projectionHorizonBonusSec)) {
      lines.push(`Projection horizon +${floorInt(globalMods.projectionHorizonBonusSec)}s`);
    }
    if (Number.isFinite(globalMods.populationFoodMult)) {
      const pct = Math.round((1 - globalMods.populationFoodMult) * 100);
      lines.push(`Population food -${pct}%`);
    }
  }

  const unlocks = effects.unlocks || null;
  if (unlocks) {
    const recipes = Array.isArray(unlocks.recipes) ? unlocks.recipes : [];
    const structures = Array.isArray(unlocks.hubStructures)
      ? unlocks.hubStructures
      : [];
    if (recipes.length) lines.push(`Unlock recipes: ${recipes.join(", ")}`);
    if (structures.length) lines.push(`Unlock buildings: ${structures.join(", ")}`);
  }

  return lines;
}
