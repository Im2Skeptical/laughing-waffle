import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { computeAvailableRecipesAndBuildings } from "./skills.js";

export function getRecipeKindForHubSystem(systemId) {
  if (systemId === "fireplace") return "cook";
  if (systemId === "workspace") return "craft";
  return null;
}

export function isRecipeSystem(systemId) {
  return getRecipeKindForHubSystem(systemId) != null;
}

function normalizeRecipeId(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function buildAllowedRecipeIdSet(systemId, state = null, opts = {}) {
  const kind = getRecipeKindForHubSystem(systemId);
  if (!kind) return new Set();
  const includeLocked = opts?.includeLocked === true;
  const availability =
    state && !includeLocked ? computeAvailableRecipesAndBuildings(state) : null;
  const out = new Set();
  for (const [recipeId, def] of Object.entries(recipeDefs || {})) {
    if (!def || def.kind !== kind) continue;
    if (availability && !availability.recipeIds?.has(recipeId)) continue;
    out.add(recipeId);
  }
  return out;
}

function normalizeEnabledValue(value) {
  return value === false ? false : true;
}

function normalizeOrderedList(list, allowedRecipeIds) {
  const out = [];
  const seen = new Set();
  const input = Array.isArray(list) ? list : [];
  for (const entry of input) {
    const recipeId = normalizeRecipeId(entry);
    if (!recipeId) continue;
    if (!allowedRecipeIds.has(recipeId)) continue;
    if (seen.has(recipeId)) continue;
    seen.add(recipeId);
    out.push(recipeId);
  }
  return out;
}

export function normalizeRecipePriority(
  value,
  { systemId, state = null, includeLocked = false } = {}
) {
  const allowedRecipeIds = buildAllowedRecipeIdSet(systemId, state, {
    includeLocked,
  });
  let orderedRaw = [];
  let enabledRaw = {};

  if (Array.isArray(value)) {
    orderedRaw = value;
  } else if (value && typeof value === "object") {
    orderedRaw = Array.isArray(value.ordered) ? value.ordered : [];
    enabledRaw =
      value.enabled && typeof value.enabled === "object" ? value.enabled : {};
  }

  const ordered = normalizeOrderedList(orderedRaw, allowedRecipeIds);
  const enabled = {};
  for (const recipeId of ordered) {
    enabled[recipeId] = normalizeEnabledValue(enabledRaw[recipeId]);
  }

  return { ordered, enabled };
}

export function buildRecipePriorityFromSelectedRecipe(
  recipeId,
  { systemId, state = null, includeLocked = false } = {}
) {
  const normalized = normalizeRecipePriority(
    { ordered: [recipeId], enabled: { [recipeId]: true } },
    { systemId, state, includeLocked }
  );
  return normalized;
}

export function getEnabledRecipeIds(recipePriority) {
  const ordered = Array.isArray(recipePriority?.ordered)
    ? recipePriority.ordered
    : [];
  const enabled =
    recipePriority?.enabled && typeof recipePriority.enabled === "object"
      ? recipePriority.enabled
      : {};
  const out = [];
  for (const recipeId of ordered) {
    if (!recipeId) continue;
    if (enabled[recipeId] === false) continue;
    out.push(recipeId);
  }
  return out;
}

export function getTopEnabledRecipeId(recipePriority) {
  const enabled = getEnabledRecipeIds(recipePriority);
  return enabled.length > 0 ? enabled[0] : null;
}

export function buildRecipePrioritySignature(recipePriority) {
  const ordered = Array.isArray(recipePriority?.ordered)
    ? recipePriority.ordered
    : [];
  const enabled =
    recipePriority?.enabled && typeof recipePriority.enabled === "object"
      ? recipePriority.enabled
      : {};
  const parts = [];
  for (const recipeId of ordered) {
    if (!recipeId) continue;
    parts.push(`${recipeId}:${enabled[recipeId] === false ? 0 : 1}`);
  }
  return parts.length > 0 ? parts.join("|") : "none";
}

export function recipePrioritiesEqual(left, right) {
  return buildRecipePrioritySignature(left) === buildRecipePrioritySignature(right);
}

export function ensureRecipePriorityState(
  systemState,
  { systemId, state = null, includeLocked = false } = {}
) {
  if (!systemState || typeof systemState !== "object") {
    return { ordered: [], enabled: {} };
  }
  const normalized = normalizeRecipePriority(systemState.recipePriority, {
    systemId,
    state,
    includeLocked,
  });
  if (normalized.ordered.length === 0) {
    const selectedRecipeId = normalizeRecipeId(systemState.selectedRecipeId);
    if (selectedRecipeId) {
      const fromSelected = buildRecipePriorityFromSelectedRecipe(selectedRecipeId, {
        systemId,
        state,
        includeLocked,
      });
      if (fromSelected.ordered.length > 0) {
        systemState.recipePriority = fromSelected;
        return fromSelected;
      }
    }
  }
  systemState.recipePriority = normalized;
  return normalized;
}

