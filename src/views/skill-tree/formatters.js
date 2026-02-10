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

  const charMods = effects.characterMods || null;
  if (charMods) {
    if (Number.isFinite(charMods.forageTierBonus)) {
      lines.push(`Forage tier +${floorInt(charMods.forageTierBonus)}`);
    }
    if (Number.isFinite(charMods.forageStaminaCostDelta)) {
      lines.push(`Forage stamina ${floorInt(charMods.forageStaminaCostDelta)}`);
    }
    if (Number.isFinite(charMods.farmingStaminaCostDelta)) {
      lines.push(`Farming stamina ${floorInt(charMods.farmingStaminaCostDelta)}`);
    }
    if (Number.isFinite(charMods.restStaminaBonusFlat)) {
      lines.push(`Rest stamina +${floorInt(charMods.restStaminaBonusFlat)}`);
    }
    if (Number.isFinite(charMods.restStaminaBonusMult)) {
      const pct = Math.round((charMods.restStaminaBonusMult - 1) * 100);
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
