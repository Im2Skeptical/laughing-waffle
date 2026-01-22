// src/controllers/actionmanagers/action-intents.js
// Pure intent constructors (no state).

export const IntentKinds = {
  ITEM_TRANSFER: "itemTransfer",
  PAWN_MOVE: "pawnMove",
  BUILD_DESIGNATE: "buildDesignate",
  TILE_TAG_ORDER: "tileTagOrder",
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
    charId: spec.charId ?? null,
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

export function getIntentSubjectKey(intent) {
  if (!intent || typeof intent !== "object") return null;
  if (intent.subjectKey) return intent.subjectKey;
  switch (intent.kind) {
    case IntentKinds.ITEM_TRANSFER:
      return intent.itemId != null ? `item:${intent.itemId}` : null;
    case IntentKinds.PAWN_MOVE:
      return intent.charId != null ? `pawn:${intent.charId}` : null;
    case IntentKinds.BUILD_DESIGNATE:
      return intent.buildKey != null ? `build:${intent.buildKey}` : null;
    case IntentKinds.TILE_TAG_ORDER:
      return Number.isFinite(intent.envCol)
        ? `tileTags:${Math.floor(intent.envCol)}`
        : null;
    default:
      return null;
  }
}
