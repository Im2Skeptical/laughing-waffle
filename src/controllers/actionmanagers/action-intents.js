// src/controllers/actionmanagers/action-intents.js
// Pure intent constructors (no state).

export const IntentKinds = {
  ITEM_TRANSFER: "itemTransfer",
  PAWN_MOVE: "pawnMove",
  BUILD_DESIGNATE: "buildDesignate",
  TILE_TAG_ORDER: "tileTagOrder",
  TILE_CROP_SELECT: "tileCropSelect",
  HUB_TAG_ORDER: "hubTagOrder",
  HUB_RECIPE_SELECT: "hubRecipeSelect",
  TILE_TAG_TOGGLE: "tileTagToggle",
  HUB_TAG_TOGGLE: "hubTagToggle",
};

export function makeItemTransferIntent(spec = {}) {
  return {
    kind: IntentKinds.ITEM_TRANSFER,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    itemId: spec.itemId ?? null,
    item: spec.item ?? null,
    fromOwnerId: spec.fromOwnerId ?? null,
    toOwnerId: spec.toOwnerId ?? null,
    fromPlacement: spec.fromPlacement ?? null,
    toPlacement: spec.toPlacement ?? null,
    baselinePlacement: spec.baselinePlacement ?? null,
    apCostOverride: spec.apCostOverride ?? null,
    source: spec.source ?? "planner",
  };
}

export function makePawnMoveIntent(spec = {}) {
  return {
    kind: IntentKinds.PAWN_MOVE,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    pawnId: spec.pawnId ?? null,
    fromPlacement: spec.fromPlacement ?? null,
    toPlacement: spec.toPlacement ?? null,
    baselinePlacement: spec.baselinePlacement ?? null,
    apCostOverride: spec.apCostOverride ?? null,
    source: spec.source ?? "planner",
  };
}

export function makeBuildDesignateIntent(spec = {}) {
  return {
    kind: IntentKinds.BUILD_DESIGNATE,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    buildKey: spec.buildKey ?? null,
    defId: spec.defId ?? null,
    target: spec.target ?? null,
    apCostOverride: spec.apCostOverride ?? null,
    source: spec.source ?? "planner",
  };
}

export function makeTileTagOrderIntent(spec = {}) {
  return {
    kind: IntentKinds.TILE_TAG_ORDER,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    envCol: spec.envCol ?? null,
    tagIds: Array.isArray(spec.tagIds) ? spec.tagIds.slice() : [],
    baselineTags: Array.isArray(spec.baselineTags)
      ? spec.baselineTags.slice()
      : [],
    apCostOverride: spec.apCostOverride ?? null,
    source: spec.source ?? "planner",
  };
}

export function makeTileCropSelectIntent(spec = {}) {
  const recipePriority =
    spec?.recipePriority && typeof spec.recipePriority === "object"
      ? cloneRecipePriority(spec.recipePriority)
      : cloneRecipePriority(
          spec?.cropId
            ? { ordered: [spec.cropId], enabled: { [spec.cropId]: true } }
            : { ordered: [], enabled: {} }
        );
  const baselineRecipePriority =
    spec?.baselineRecipePriority && typeof spec.baselineRecipePriority === "object"
      ? cloneRecipePriority(spec.baselineRecipePriority)
      : cloneRecipePriority(
          spec?.baselineCropId
            ? {
                ordered: [spec.baselineCropId],
                enabled: { [spec.baselineCropId]: true },
              }
            : { ordered: [], enabled: {} }
        );
  const cropId = getTopRecipeId(recipePriority);
  const baselineCropId = getTopRecipeId(baselineRecipePriority);
  return {
    kind: IntentKinds.TILE_CROP_SELECT,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    envCol: spec.envCol ?? null,
    cropId,
    baselineCropId,
    recipePriority,
    baselineRecipePriority,
    apCostOverride: spec.apCostOverride ?? null,
    source: spec.source ?? "planner",
  };
}

export function makeHubTagOrderIntent(spec = {}) {
  return {
    kind: IntentKinds.HUB_TAG_ORDER,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    hubCol: spec.hubCol ?? null,
    tagIds: Array.isArray(spec.tagIds) ? spec.tagIds.slice() : [],
    baselineTags: Array.isArray(spec.baselineTags)
      ? spec.baselineTags.slice()
      : [],
    apCostOverride: spec.apCostOverride ?? null,
    source: spec.source ?? "planner",
  };
}

function cloneRecipePriority(value) {
  if (!value || typeof value !== "object") {
    return { ordered: [], enabled: {} };
  }
  const ordered = Array.isArray(value.ordered)
    ? value.ordered.filter((id) => typeof id === "string" && id.length > 0)
    : [];
  const enabled = {};
  for (const recipeId of ordered) {
    enabled[recipeId] = value?.enabled?.[recipeId] === false ? false : true;
  }
  return { ordered, enabled };
}

function getTopRecipeId(recipePriority) {
  const ordered = Array.isArray(recipePriority?.ordered)
    ? recipePriority.ordered
    : [];
  const enabled =
    recipePriority?.enabled && typeof recipePriority.enabled === "object"
      ? recipePriority.enabled
      : {};
  for (const recipeId of ordered) {
    if (!recipeId) continue;
    if (enabled[recipeId] === false) continue;
    return recipeId;
  }
  return null;
}

export function makeHubRecipeSelectIntent(spec = {}) {
  const recipePriority = cloneRecipePriority(spec.recipePriority);
  const baselineRecipePriority = cloneRecipePriority(spec.baselineRecipePriority);
  return {
    kind: IntentKinds.HUB_RECIPE_SELECT,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    hubCol: spec.hubCol ?? null,
    systemId: spec.systemId ?? null,
    recipePriority,
    baselineRecipePriority,
    recipeId: getTopRecipeId(recipePriority),
    baselineRecipeId: getTopRecipeId(baselineRecipePriority),
    apCostOverride: spec.apCostOverride ?? null,
    source: spec.source ?? "planner",
  };
}

export function makeTileTagToggleIntent(spec = {}) {
  return {
    kind: IntentKinds.TILE_TAG_TOGGLE,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    envCol: spec.envCol ?? null,
    tagId: spec.tagId ?? null,
    disabled: spec.disabled ?? null,
    baselineDisabled: spec.baselineDisabled ?? null,
    apCostOverride: spec.apCostOverride ?? null,
    source: spec.source ?? "planner",
  };
}

export function makeHubTagToggleIntent(spec = {}) {
  return {
    kind: IntentKinds.HUB_TAG_TOGGLE,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    hubCol: spec.hubCol ?? null,
    tagId: spec.tagId ?? null,
    disabled: spec.disabled ?? null,
    baselineDisabled: spec.baselineDisabled ?? null,
    apCostOverride: spec.apCostOverride ?? null,
    source: spec.source ?? "planner",
  };
}

export function getIntentSubjectKey(intent) {
  if (!intent || typeof intent !== "object") return null;
  if (intent.subjectKey) return intent.subjectKey;
  switch (intent.kind) {
    case IntentKinds.ITEM_TRANSFER:
      return intent.itemId != null ? `item:${intent.itemId}` : null;
    case IntentKinds.PAWN_MOVE:
      return intent.pawnId != null ? `pawn:${intent.pawnId}` : null;
    case IntentKinds.BUILD_DESIGNATE:
      return intent.buildKey != null ? `build:${intent.buildKey}` : null;
    case IntentKinds.TILE_TAG_ORDER:
      return Number.isFinite(intent.envCol)
        ? `tileTags:${Math.floor(intent.envCol)}`
        : null;
    case IntentKinds.TILE_CROP_SELECT:
      return Number.isFinite(intent.envCol)
        ? `tileCrop:${Math.floor(intent.envCol)}`
        : null;
    case IntentKinds.HUB_TAG_ORDER:
      return Number.isFinite(intent.hubCol)
        ? `hubTags:${Math.floor(intent.hubCol)}`
        : null;
    case IntentKinds.HUB_RECIPE_SELECT:
      return Number.isFinite(intent.hubCol) && intent.systemId
        ? `hubRecipe:${Math.floor(intent.hubCol)}:${intent.systemId}`
        : null;
    case IntentKinds.TILE_TAG_TOGGLE:
      return Number.isFinite(intent.envCol) && intent.tagId
        ? `tileTagToggle:${Math.floor(intent.envCol)}:${intent.tagId}`
        : null;
    case IntentKinds.HUB_TAG_TOGGLE:
      return Number.isFinite(intent.hubCol) && intent.tagId
        ? `hubTagToggle:${Math.floor(intent.hubCol)}:${intent.tagId}`
        : null;
    default:
      return null;
  }
}
