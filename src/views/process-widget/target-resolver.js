export function createProcessWidgetTargetResolver({
  hubStructureDefs,
  itemDefs,
} = {}) {
  function findHubStructureById(state, id) {
    const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    return null;
  }

  function findEnvStructureById(state, id) {
    const anchors = Array.isArray(state?.board?.layers?.envStructure?.anchors)
      ? state.board.layers.envStructure.anchors
      : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    return null;
  }

  function findStructureById(state, id) {
    return findHubStructureById(state, id) ?? findEnvStructureById(state, id);
  }

  function findPawnById(state, id) {
    const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
    for (const pawn of pawns) {
      if (!pawn) continue;
      if (String(pawn.id) === String(id)) return pawn;
    }
    return null;
  }

  function findTileById(state, id) {
    const anchors = Array.isArray(state?.board?.layers?.tile?.anchors)
      ? state.board.layers.tile.anchors
      : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    return null;
  }

  function itemProvidesPortableStorage(item) {
    if (!item || typeof item !== "object") return false;
    const kind =
      typeof item.kind === "string" && item.kind.length > 0 ? item.kind : null;
    if (!kind) return false;
    const def = itemDefs?.[kind];
    if (!def || typeof def !== "object") return false;
    const specs = Array.isArray(def.poolProviders)
      ? def.poolProviders
      : def.poolProviders && typeof def.poolProviders === "object"
        ? [def.poolProviders]
        : [];
    return specs.some((spec) => {
      const systemId =
        typeof spec?.systemId === "string" ? spec.systemId : spec?.system;
      const poolKey = typeof spec?.poolKey === "string" ? spec.poolKey : null;
      return systemId === "storage" && poolKey === "byKindTier";
    });
  }

  function getEquippedBasketInfoForPawn(pawn) {
    if (!pawn) return null;
    const equipment =
      pawn?.equipment && typeof pawn.equipment === "object" ? pawn.equipment : null;
    if (!equipment) return null;
    for (const [slotId, item] of Object.entries(equipment)) {
      if (!item || typeof item !== "object") continue;
      if (!itemProvidesPortableStorage(item)) continue;
      return { slotId, item };
    }
    return null;
  }

  function buildBasketTarget(state, ownerId) {
    const pawn = findPawnById(state, ownerId);
    if (!pawn) return null;
    const basketInfo = getEquippedBasketInfoForPawn(pawn);
    if (!basketInfo?.item) return null;
    const store =
      basketInfo?.item?.systemState?.storage &&
      typeof basketInfo.item.systemState.storage === "object"
        ? basketInfo.item.systemState.storage
        : pawn?.systemState?.basketStore &&
            typeof pawn.systemState.basketStore === "object"
          ? pawn.systemState.basketStore
          : null;
    const byKindTier =
      store?.byKindTier && typeof store.byKindTier === "object"
        ? store.byKindTier
        : {};
    const totalByTier =
      store?.totalByTier && typeof store.totalByTier === "object"
        ? store.totalByTier
        : null;
    return {
      refKind: "basket",
      defId: basketInfo.item.kind || "basket",
      ownerKind: "pawn",
      ownerId: String(pawn.id),
      id: `basket:${pawn.id}`,
      instanceId: `basket:${pawn.id}`,
      basketSlotId: basketInfo.slotId,
      basketItemId: basketInfo.item.id ?? null,
      basketOwnerName: pawn.name || `Pawn ${pawn.id}`,
      systemState: {
        storage: {
          byKindTier,
          totalByTier,
        },
      },
    };
  }

  function makeTargetRef(target) {
    if (!target) return null;
    if (target?.refKind === "basket") {
      if (target?.ownerId == null) return null;
      return { kind: "basket", ownerId: String(target.ownerId) };
    }
    const id = target.instanceId ?? target.id ?? null;
    if (id == null) return null;
    const isHub = !!hubStructureDefs?.[target.defId];
    const kind = isHub ? "hub" : "env";
    return { kind, id: String(id) };
  }

  function sameTargetRef(a, b) {
    if (!a || !b) return false;
    if (a.kind === "basket" || b.kind === "basket") {
      return (
        a.kind === "basket" &&
        b.kind === "basket" &&
        String(a.ownerId) === String(b.ownerId)
      );
    }
    return a.kind === b.kind && String(a.id) === String(b.id);
  }

  function resolveTargetFromRef(state, ref) {
    if (!ref || !state) return null;
    if (ref.kind === "basket") return buildBasketTarget(state, ref.ownerId);
    if (ref.kind === "hub") return findHubStructureById(state, ref.id);
    if (ref.kind === "env") {
      return findTileById(state, ref.id) ?? findEnvStructureById(state, ref.id);
    }
    return null;
  }

  return {
    findStructureById,
    findHubStructureById,
    findEnvStructureById,
    findPawnById,
    findTileById,
    buildBasketTarget,
    makeTargetRef,
    sameTargetRef,
    resolveTargetFromRef,
  };
}
