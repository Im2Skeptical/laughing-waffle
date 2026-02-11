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
  const pawnId =
    spec.pawnId != null ? spec.pawnId : spec.charId != null ? spec.charId : null;
  return {
    kind: IntentKinds.PAWN_MOVE,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    pawnId,
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
  return {
    kind: IntentKinds.TILE_CROP_SELECT,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    envCol: spec.envCol ?? null,
    cropId: spec.cropId ?? null,
    baselineCropId: spec.baselineCropId ?? null,
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

export function makeHubRecipeSelectIntent(spec = {}) {
  return {
    kind: IntentKinds.HUB_RECIPE_SELECT,
    id: spec.id ?? null,
    subjectKey: spec.subjectKey ?? null,
    hubCol: spec.hubCol ?? null,
    systemId: spec.systemId ?? null,
    recipeId: spec.recipeId ?? null,
    baselineRecipeId: spec.baselineRecipeId ?? null,
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
