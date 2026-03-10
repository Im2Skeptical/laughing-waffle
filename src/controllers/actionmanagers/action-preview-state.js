import {
  buildRecipePriorityFromSelectedRecipe,
  getTopEnabledRecipeId,
  normalizeRecipePriority,
} from "../../model/recipe-priority.js";

export function createEmptyInventoryPreview() {
  return {
    hiddenItemIds: new Set(),
    overlayItems: [],
    ghostItems: [],
  };
}

function normalizeOwnerId(ownerIdRaw) {
  if (typeof ownerIdRaw === "number" && Number.isFinite(ownerIdRaw)) {
    return Math.floor(ownerIdRaw);
  }
  if (typeof ownerIdRaw === "string" && ownerIdRaw.length > 0) {
    const asNumber = Number(ownerIdRaw);
    return Number.isFinite(asNumber) ? Math.floor(asNumber) : ownerIdRaw;
  }
  return ownerIdRaw;
}

function sortedStrings(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function sortedNumbers(values) {
  return [...values].sort((left, right) => left - right);
}

function getOrCreateOwnerPreview(previewByOwner, ownerId) {
  let preview = previewByOwner.get(ownerId);
  if (!preview) {
    preview = createEmptyInventoryPreview();
    previewByOwner.set(ownerId, preview);
  }
  return preview;
}

function cloneTags(tags) {
  return Array.isArray(tags) ? tags.slice() : [];
}

function cloneRecipePriority(value) {
  const ordered = Array.isArray(value?.ordered) ? value.ordered.slice() : [];
  const enabled = {};
  for (const recipeId of ordered) {
    enabled[recipeId] = value?.enabled?.[recipeId] === false ? false : true;
  }
  return { ordered, enabled };
}

function makePreviewItem(item, ownerId, sourceOwnerId = null) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id,
    kind: item.kind,
    quantity: Math.max(0, Math.floor(item.quantity ?? 0)),
    width: Math.max(1, Math.floor(item.width ?? 1)),
    height: Math.max(1, Math.floor(item.height ?? 1)),
    tier: item.tier ?? null,
    tags: cloneTags(item.tags),
    ownerId,
    sourceOwnerId: sourceOwnerId ?? ownerId,
    gridX: Math.max(0, Math.floor(item.gridX ?? 0)),
    gridY: Math.max(0, Math.floor(item.gridY ?? 0)),
    isGhost: false,
  };
}

function compareTagLists(leftTags, rightTags) {
  const left = Array.isArray(leftTags) ? leftTags : [];
  const right = Array.isArray(rightTags) ? rightTags : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function compareRecipePriority(left, right) {
  const a = cloneRecipePriority(left);
  const b = cloneRecipePriority(right);
  if (!compareTagLists(a.ordered, b.ordered)) return false;
  for (const recipeId of a.ordered) {
    if ((a.enabled[recipeId] === false) !== (b.enabled[recipeId] === false)) {
      return false;
    }
  }
  return true;
}

function comparePreviewItems(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    Math.floor(left.quantity ?? 0) === Math.floor(right.quantity ?? 0) &&
    Math.floor(left.width ?? 1) === Math.floor(right.width ?? 1) &&
    Math.floor(left.height ?? 1) === Math.floor(right.height ?? 1) &&
    (left.tier ?? null) === (right.tier ?? null) &&
    Math.floor(left.gridX ?? 0) === Math.floor(right.gridX ?? 0) &&
    Math.floor(left.gridY ?? 0) === Math.floor(right.gridY ?? 0) &&
    compareTagLists(left.tags, right.tags)
  );
}

function sortPreviewItems(items) {
  items.sort((left, right) => {
    const yDelta = Math.floor(left?.gridY ?? 0) - Math.floor(right?.gridY ?? 0);
    if (yDelta !== 0) return yDelta;
    const xDelta = Math.floor(left?.gridX ?? 0) - Math.floor(right?.gridX ?? 0);
    if (xDelta !== 0) return xDelta;
    return Math.floor(left?.id ?? 0) - Math.floor(right?.id ?? 0);
  });
}

function getInventoryItemMap(state) {
  const byItemId = new Map();
  const byOwnerId = new Map();
  const inventories =
    state?.ownerInventories && typeof state.ownerInventories === "object"
      ? state.ownerInventories
      : {};

  for (const [ownerIdRaw, inv] of Object.entries(inventories)) {
    const ownerId = normalizeOwnerId(ownerIdRaw);
    const ownerItems = new Map();
    const items = Array.isArray(inv?.items) ? inv.items : [];
    for (const item of items) {
      if (!item || item.id == null) continue;
      ownerItems.set(item.id, item);
      byItemId.set(item.id, {
        ownerId,
        item,
      });
    }
    byOwnerId.set(ownerId, ownerItems);
  }

  return { byItemId, byOwnerId };
}

function getInventorySignature(state, ownerId) {
  const inv = state?.ownerInventories?.[ownerId];
  const items = Array.isArray(inv?.items) ? inv.items : [];
  return items
    .map((item) =>
      JSON.stringify({
        id: item?.id ?? null,
        kind: item?.kind ?? null,
        quantity: Math.max(0, Math.floor(item?.quantity ?? 0)),
        width: Math.max(1, Math.floor(item?.width ?? 1)),
        height: Math.max(1, Math.floor(item?.height ?? 1)),
        tier: item?.tier ?? null,
        tags: cloneTags(item?.tags),
        gridX: Math.max(0, Math.floor(item?.gridX ?? 0)),
        gridY: Math.max(0, Math.floor(item?.gridY ?? 0)),
      })
    )
    .sort()
    .join("|");
}

function getPawnPlacement(pawn) {
  if (!pawn || typeof pawn !== "object") return null;
  if (Number.isFinite(pawn.envCol)) {
    return { envCol: Math.floor(pawn.envCol) };
  }
  if (Number.isFinite(pawn.hubCol)) {
    return { hubCol: Math.floor(pawn.hubCol) };
  }
  return null;
}

function getPawnPlacementSignature(state, pawnId) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const pawn = pawns.find((candidate) => candidate?.id === pawnId) || null;
  const placement = getPawnPlacement(pawn);
  if (!placement) return "none";
  if (Number.isFinite(placement.envCol)) return `env:${placement.envCol}`;
  if (Number.isFinite(placement.hubCol)) return `hub:${placement.hubCol}`;
  return "none";
}

function getTilePlanForState(state, envCol) {
  const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
  const tile = col != null ? state?.board?.occ?.tile?.[col] ?? null : null;
  const recipePriority = normalizeRecipePriority(tile?.systemState?.growth?.recipePriority, {
    systemId: "growth",
    state,
    includeLocked: false,
  });
  const fallbackCropId = tile?.systemState?.growth?.selectedCropId ?? null;
  const resolvedPriority =
    recipePriority.ordered.length > 0
      ? recipePriority
      : buildRecipePriorityFromSelectedRecipe(fallbackCropId, {
          systemId: "growth",
          state,
          includeLocked: false,
        });
  const tags = Array.isArray(tile?.tags) ? tile.tags.slice() : [];
  const tagDisabledById = {};
  for (const tagId of tags) {
    tagDisabledById[tagId] = tile?.tagStates?.[tagId]?.disabled === true;
  }
  return {
    envCol: col,
    tagIds: tags,
    tagDisabledById,
    recipePriority: cloneRecipePriority(resolvedPriority),
    cropId: getTopEnabledRecipeId(resolvedPriority),
  };
}

function getHubPlanForState(state, hubCol) {
  const col = Number.isFinite(hubCol) ? Math.floor(hubCol) : null;
  const structure =
    col != null
      ? state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure ?? null
      : null;
  const tags = Array.isArray(structure?.tags) ? structure.tags.slice() : [];
  const tagDisabledById = {};
  for (const tagId of tags) {
    tagDisabledById[tagId] = structure?.tagStates?.[tagId]?.disabled === true;
  }

  const recipePriorityBySystemId = {};
  const recipeIdBySystemId = {};
  const systemState = structure?.systemState || {};
  for (const [systemId, entry] of Object.entries(systemState)) {
    const normalized = normalizeRecipePriority(entry?.recipePriority, {
      systemId,
      state,
      includeLocked: false,
    });
    const fallbackRecipeId = entry?.selectedRecipeId ?? null;
    const resolvedPriority =
      normalized.ordered.length > 0
        ? normalized
        : buildRecipePriorityFromSelectedRecipe(fallbackRecipeId, {
            systemId,
            state,
            includeLocked: false,
          });
    if (resolvedPriority.ordered.length <= 0 && !fallbackRecipeId) continue;
    recipePriorityBySystemId[systemId] = cloneRecipePriority(resolvedPriority);
    recipeIdBySystemId[systemId] = getTopEnabledRecipeId(resolvedPriority);
  }

  return {
    hubCol: col,
    tagIds: tags,
    tagDisabledById,
    recipePriorityBySystemId,
    recipeIdBySystemId,
  };
}

function getTilePlanSignature(state, envCol) {
  const plan = getTilePlanForState(state, envCol);
  return JSON.stringify(plan);
}

function getHubPlanSignature(state, hubCol) {
  const plan = getHubPlanForState(state, hubCol);
  return JSON.stringify(plan);
}

function compareTilePlans(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (!compareTagLists(left.tagIds, right.tagIds)) return false;
  const leftDisabledKeys = Object.keys(left.tagDisabledById || {}).sort();
  const rightDisabledKeys = Object.keys(right.tagDisabledById || {}).sort();
  if (!compareTagLists(leftDisabledKeys, rightDisabledKeys)) return false;
  for (const key of leftDisabledKeys) {
    if ((left.tagDisabledById?.[key] === true) !== (right.tagDisabledById?.[key] === true)) {
      return false;
    }
  }
  return (
    compareRecipePriority(left.recipePriority, right.recipePriority) &&
    (left.cropId ?? null) === (right.cropId ?? null)
  );
}

function compareHubPlans(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (!compareTagLists(left.tagIds, right.tagIds)) return false;
  const leftDisabledKeys = Object.keys(left.tagDisabledById || {}).sort();
  const rightDisabledKeys = Object.keys(right.tagDisabledById || {}).sort();
  if (!compareTagLists(leftDisabledKeys, rightDisabledKeys)) return false;
  for (const key of leftDisabledKeys) {
    if ((left.tagDisabledById?.[key] === true) !== (right.tagDisabledById?.[key] === true)) {
      return false;
    }
  }

  const leftSystems = Object.keys(left.recipePriorityBySystemId || {}).sort();
  const rightSystems = Object.keys(right.recipePriorityBySystemId || {}).sort();
  if (!compareTagLists(leftSystems, rightSystems)) return false;
  for (const systemId of leftSystems) {
    if (
      !compareRecipePriority(
        left.recipePriorityBySystemId?.[systemId],
        right.recipePriorityBySystemId?.[systemId]
      )
    ) {
      return false;
    }
    if (
      (left.recipeIdBySystemId?.[systemId] ?? null) !==
      (right.recipeIdBySystemId?.[systemId] ?? null)
    ) {
      return false;
    }
  }
  return true;
}

function getHubStructureSignature(state, hubCol) {
  const col = Number.isFinite(hubCol) ? Math.floor(hubCol) : null;
  const structure =
    col != null
      ? state?.hub?.occ?.[col] ?? state?.hub?.slots?.[col]?.structure ?? null
      : null;
  if (!structure) return "null";
  const buildProcesses = Array.isArray(structure?.systemState?.build?.processes)
    ? structure.systemState.build.processes.length
    : 0;
  return JSON.stringify({
    instanceId: structure.instanceId ?? null,
    defId: structure.defId ?? null,
    col: Number.isFinite(structure.col) ? Math.floor(structure.col) : null,
    span: Number.isFinite(structure.span) ? Math.floor(structure.span) : 1,
    tags: cloneTags(structure.tags),
    buildProcesses,
  });
}

function comparePlacements(left, right) {
  const a = left ?? null;
  const b = right ?? null;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (Number.isFinite(a.envCol) || Number.isFinite(b.envCol)) {
    return Math.floor(a.envCol ?? -1) === Math.floor(b.envCol ?? -1);
  }
  return Math.floor(a.hubCol ?? -1) === Math.floor(b.hubCol ?? -1);
}

function normalizeTouchedTargets(touchedTargets = {}) {
  const ownerIds = new Set();
  const pawnIds = new Set();
  const envCols = new Set();
  const hubCols = new Set();

  for (const ownerId of touchedTargets.ownerIds || []) {
    ownerIds.add(normalizeOwnerId(ownerId));
  }
  for (const pawnId of touchedTargets.pawnIds || []) {
    if (Number.isFinite(pawnId)) pawnIds.add(Math.floor(pawnId));
  }
  for (const envCol of touchedTargets.envCols || []) {
    if (Number.isFinite(envCol)) envCols.add(Math.floor(envCol));
  }
  for (const hubCol of touchedTargets.hubCols || []) {
    if (Number.isFinite(hubCol)) hubCols.add(Math.floor(hubCol));
  }

  return {
    ownerIds,
    pawnIds,
    envCols,
    hubCols,
  };
}

function makeSignatureRecord(snapshot) {
  const ownerById = {};
  const pawnById = {};
  const tileByEnvCol = {};
  const hubByHubCol = {};
  const hubStructureByHubCol = {};

  for (const ownerId of snapshot.touchedTargets.ownerIds) {
    ownerById[String(ownerId)] = getInventorySignature(snapshot.projectedState, ownerId);
  }
  for (const pawnId of snapshot.touchedTargets.pawnIds) {
    pawnById[String(pawnId)] = getPawnPlacementSignature(snapshot.projectedState, pawnId);
  }
  for (const envCol of snapshot.touchedTargets.envCols) {
    tileByEnvCol[String(envCol)] = getTilePlanSignature(snapshot.projectedState, envCol);
  }
  for (const hubCol of snapshot.touchedTargets.hubCols) {
    hubByHubCol[String(hubCol)] = getHubPlanSignature(snapshot.projectedState, hubCol);
    hubStructureByHubCol[String(hubCol)] = getHubStructureSignature(
      snapshot.projectedState,
      hubCol
    );
  }

  return {
    ownerById,
    pawnById,
    tileByEnvCol,
    hubByHubCol,
    hubStructureByHubCol,
  };
}

export function buildPreviewSnapshot({
  baselineState,
  projectedState,
  touchedTargets,
  actions,
  inventoryTransferGhostPreviewEnabled = true,
} = {}) {
  const normalizedTouched = normalizeTouchedTargets(touchedTargets);
  const previewByOwner = new Map();
  const pawnOverrides = new Map();
  const tilePlanByEnvCol = new Map();
  const hubPlanByHubCol = new Map();
  const actionList = Array.isArray(actions) ? actions.filter(Boolean) : [];

  const baselineItems = getInventoryItemMap(baselineState);
  const projectedItems = getInventoryItemMap(projectedState);

  for (const ownerId of sortedStrings(normalizedTouched.ownerIds)) {
    const normalizedOwnerId = normalizeOwnerId(ownerId);
    const baselineByOwner = baselineItems.byOwnerId.get(normalizedOwnerId) || new Map();
    const projectedByOwner = projectedItems.byOwnerId.get(normalizedOwnerId) || new Map();
    const itemIds = new Set([
      ...baselineByOwner.keys(),
      ...projectedByOwner.keys(),
    ]);

    for (const itemId of sortedNumbers(itemIds)) {
      const baselineItem = baselineByOwner.get(itemId) || null;
      const projectedItem = projectedByOwner.get(itemId) || null;
      const baselinePreviewItem = baselineItem
        ? makePreviewItem(baselineItem, normalizedOwnerId)
        : null;
      const projectedPreviewItem = projectedItem
        ? makePreviewItem(
            projectedItem,
            normalizedOwnerId,
            baselineItems.byItemId.get(itemId)?.ownerId ?? normalizedOwnerId
          )
        : null;

      if (comparePreviewItems(baselinePreviewItem, projectedPreviewItem)) continue;
      const preview = getOrCreateOwnerPreview(previewByOwner, normalizedOwnerId);
      if (baselinePreviewItem) preview.hiddenItemIds.add(itemId);
      if (projectedPreviewItem) preview.overlayItems.push(projectedPreviewItem);
    }
  }

  if (inventoryTransferGhostPreviewEnabled) {
    const ghostKeys = new Set();
    for (const action of actionList) {
      if (action?.kind !== "inventoryMove") continue;
      const payload = action.payload || {};
      const itemId = payload.itemId ?? payload.item?.id ?? null;
      if (itemId == null) continue;
      const baselineEntry = baselineItems.byItemId.get(itemId) || null;
      if (!baselineEntry) continue;

      const fromOwnerId = baselineEntry.ownerId;
      const toOwnerId =
        payload.toPlacement?.ownerId ??
        payload.toOwnerId ??
        projectedItems.byItemId.get(itemId)?.ownerId ??
        null;
      if (toOwnerId == null || fromOwnerId === toOwnerId) continue;

      const projectedEntry = projectedItems.byItemId.get(itemId) || null;
      if (projectedEntry?.ownerId === fromOwnerId) continue;

      const ghostKey = `${fromOwnerId}:${itemId}`;
      if (ghostKeys.has(ghostKey)) continue;
      ghostKeys.add(ghostKey);

      const preview = getOrCreateOwnerPreview(previewByOwner, fromOwnerId);
      const ghostItem = makePreviewItem(baselineEntry.item, fromOwnerId, fromOwnerId);
      if (!ghostItem) continue;
      ghostItem.isGhost = true;
      preview.ghostItems.push(ghostItem);
    }
  }

  for (const preview of previewByOwner.values()) {
    sortPreviewItems(preview.overlayItems);
    sortPreviewItems(preview.ghostItems);
  }

  const baselinePawns = new Map(
    (Array.isArray(baselineState?.pawns) ? baselineState.pawns : [])
      .filter((pawn) => pawn?.id != null)
      .map((pawn) => [pawn.id, pawn])
  );
  const projectedPawns = new Map(
    (Array.isArray(projectedState?.pawns) ? projectedState.pawns : [])
      .filter((pawn) => pawn?.id != null)
      .map((pawn) => [pawn.id, pawn])
  );
  const allPawnIds = new Set([...baselinePawns.keys(), ...projectedPawns.keys()]);
  for (const pawnId of sortedNumbers(allPawnIds)) {
    const baselinePlacement = getPawnPlacement(baselinePawns.get(pawnId) || null);
    const projectedPlacement = getPawnPlacement(projectedPawns.get(pawnId) || null);
    if (comparePlacements(baselinePlacement, projectedPlacement)) continue;
    normalizedTouched.pawnIds.add(pawnId);
    if (projectedPlacement) {
      pawnOverrides.set(pawnId, projectedPlacement);
    }
  }

  for (const envCol of sortedNumbers(normalizedTouched.envCols)) {
    const baselinePlan = getTilePlanForState(baselineState, envCol);
    const projectedPlan = getTilePlanForState(projectedState, envCol);
    if (compareTilePlans(baselinePlan, projectedPlan)) continue;
    tilePlanByEnvCol.set(envCol, projectedPlan);
  }

  for (const hubCol of sortedNumbers(normalizedTouched.hubCols)) {
    const baselinePlan = getHubPlanForState(baselineState, hubCol);
    const projectedPlan = getHubPlanForState(projectedState, hubCol);
    const baselineStructureSig = getHubStructureSignature(baselineState, hubCol);
    const projectedStructureSig = getHubStructureSignature(projectedState, hubCol);
    if (!compareHubPlans(baselinePlan, projectedPlan)) {
      hubPlanByHubCol.set(hubCol, projectedPlan);
    } else if (baselineStructureSig !== projectedStructureSig) {
      // Preserve touched build-designate targets for reflection even without a visible overlay.
      hubPlanByHubCol.set(hubCol, projectedPlan);
    }
  }

  const snapshot = {
    previewByOwner,
    pawnOverrides,
    tilePlanByEnvCol,
    hubPlanByHubCol,
    touchedTargets: {
      ownerIds: sortedStrings(normalizedTouched.ownerIds),
      pawnIds: sortedNumbers(normalizedTouched.pawnIds),
      envCols: sortedNumbers(normalizedTouched.envCols),
      hubCols: sortedNumbers(normalizedTouched.hubCols),
    },
    projectedState,
  };

  snapshot.signatures = makeSignatureRecord(snapshot);
  delete snapshot.projectedState;
  return snapshot;
}

export function mergePreviewSnapshots(snapshots = []) {
  const previewByOwner = new Map();
  const pawnOverrides = new Map();
  const tilePlanByEnvCol = new Map();
  const hubPlanByHubCol = new Map();
  const ownerIds = new Set();
  const pawnIds = new Set();
  const envCols = new Set();
  const hubCols = new Set();
  const signatures = {
    ownerById: {},
    pawnById: {},
    tileByEnvCol: {},
    hubByHubCol: {},
    hubStructureByHubCol: {},
  };

  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    for (const ownerId of snapshot.touchedTargets?.ownerIds || []) ownerIds.add(ownerId);
    for (const pawnId of snapshot.touchedTargets?.pawnIds || []) pawnIds.add(pawnId);
    for (const envCol of snapshot.touchedTargets?.envCols || []) envCols.add(envCol);
    for (const hubCol of snapshot.touchedTargets?.hubCols || []) hubCols.add(hubCol);

    for (const [ownerId, preview] of snapshot.previewByOwner?.entries?.() || []) {
      const merged = getOrCreateOwnerPreview(previewByOwner, ownerId);
      for (const itemId of preview.hiddenItemIds || []) merged.hiddenItemIds.add(itemId);
      const overlayById = new Map(merged.overlayItems.map((item) => [item.id, item]));
      for (const item of preview.overlayItems || []) overlayById.set(item.id, item);
      merged.overlayItems = Array.from(overlayById.values());
      const ghostById = new Map(merged.ghostItems.map((item) => [item.id, item]));
      for (const item of preview.ghostItems || []) ghostById.set(item.id, item);
      merged.ghostItems = Array.from(ghostById.values());
      sortPreviewItems(merged.overlayItems);
      sortPreviewItems(merged.ghostItems);
    }

    for (const [pawnId, placement] of snapshot.pawnOverrides?.entries?.() || []) {
      pawnOverrides.set(pawnId, placement);
    }
    for (const [envCol, plan] of snapshot.tilePlanByEnvCol?.entries?.() || []) {
      tilePlanByEnvCol.set(envCol, plan);
    }
    for (const [hubCol, plan] of snapshot.hubPlanByHubCol?.entries?.() || []) {
      hubPlanByHubCol.set(hubCol, plan);
    }

    Object.assign(signatures.ownerById, snapshot.signatures?.ownerById || {});
    Object.assign(signatures.pawnById, snapshot.signatures?.pawnById || {});
    Object.assign(signatures.tileByEnvCol, snapshot.signatures?.tileByEnvCol || {});
    Object.assign(signatures.hubByHubCol, snapshot.signatures?.hubByHubCol || {});
    Object.assign(
      signatures.hubStructureByHubCol,
      snapshot.signatures?.hubStructureByHubCol || {}
    );
  }

  return {
    previewByOwner,
    pawnOverrides,
    tilePlanByEnvCol,
    hubPlanByHubCol,
    touchedTargets: {
      ownerIds: sortedStrings(ownerIds),
      pawnIds: sortedNumbers(pawnIds),
      envCols: sortedNumbers(envCols),
      hubCols: sortedNumbers(hubCols),
    },
    signatures,
  };
}

export function isPreviewSnapshotReflectedInState(state, snapshot) {
  if (!snapshot) return false;

  for (const ownerId of snapshot.touchedTargets?.ownerIds || []) {
    const currentSignature = getInventorySignature(state, ownerId);
    if (currentSignature !== snapshot.signatures?.ownerById?.[String(ownerId)]) {
      return false;
    }
  }
  for (const pawnId of snapshot.touchedTargets?.pawnIds || []) {
    const currentSignature = getPawnPlacementSignature(state, pawnId);
    if (currentSignature !== snapshot.signatures?.pawnById?.[String(pawnId)]) {
      return false;
    }
  }
  for (const envCol of snapshot.touchedTargets?.envCols || []) {
    const currentSignature = getTilePlanSignature(state, envCol);
    if (currentSignature !== snapshot.signatures?.tileByEnvCol?.[String(envCol)]) {
      return false;
    }
  }
  for (const hubCol of snapshot.touchedTargets?.hubCols || []) {
    const currentHubSignature = getHubPlanSignature(state, hubCol);
    if (currentHubSignature !== snapshot.signatures?.hubByHubCol?.[String(hubCol)]) {
      return false;
    }
    const currentStructureSignature = getHubStructureSignature(state, hubCol);
    if (
      currentStructureSignature !==
      snapshot.signatures?.hubStructureByHubCol?.[String(hubCol)]
    ) {
      return false;
    }
  }

  return true;
}
