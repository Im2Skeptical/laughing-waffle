export function createEndpointDescriptorTools({
  isAnyDropboxOwnerId,
  isProcessDropboxOwnerId,
  isHubDropboxOwnerId,
  isBasketDropboxOwnerId,
  envTileDefs,
  envStructureDefs,
  hubStructureDefs,
  findStructureById,
  findEnvStructureById,
  findPawnById,
  findTileById,
  buildBasketTarget,
  makeTargetRef,
  resolveHoverFocusFromOwnerIds,
} = {}) {
  function parsePoolEndpointId(endpointId) {
    if (!endpointId || typeof endpointId !== "string") return null;
    if (!endpointId.startsWith("sys:pool:")) return null;
    const raw = endpointId.slice("sys:pool:".length);
    const parts = raw.split(":");
    if (parts.length < 4) return null;
    const [ownerKind, ownerId, systemId, poolKey] = parts;
    if (!ownerKind || !ownerId || !systemId || !poolKey) return null;
    return { ownerKind, ownerId, systemId, poolKey };
  }

  function getOwnerLabel(state, ownerKind, ownerId) {
    if (!state || !ownerKind || ownerId == null) return null;
    if (ownerKind === "hub") {
      const structure = findStructureById?.(state, ownerId);
      const def = structure ? hubStructureDefs?.[structure.defId] : null;
      return def?.name || structure?.defId || `Hub ${ownerId}`;
    }
    if (ownerKind === "env") {
      const tile = findTileById?.(state, ownerId);
      if (tile) {
        const def = envTileDefs?.[tile.defId];
        return def?.name || tile?.defId || `Tile ${ownerId}`;
      }
      const structure = findEnvStructureById?.(state, ownerId);
      const def = structure ? envStructureDefs?.[structure.defId] : null;
      return def?.name || structure?.defId || `Env ${ownerId}`;
    }
    if (ownerKind === "pawn") {
      const pawn = findPawnById?.(state, ownerId);
      return pawn?.name || `Pawn ${ownerId}`;
    }
    return null;
  }

  function resolveHoverFocusFromOwnerKind(state, ownerKind, ownerId, systemId = null) {
    if (!ownerKind || ownerId == null) return null;
    if (ownerKind === "hub") {
      const structure = findStructureById?.(state, ownerId);
      if (!structure?.instanceId) return null;
      const hubCol = Number.isFinite(structure.col)
        ? Math.floor(structure.col)
        : Number.isFinite(structure.hubCol)
          ? Math.floor(structure.hubCol)
          : null;
      return {
        kind: "hub",
        ownerId: structure.instanceId,
        ownerIds: [structure.instanceId],
        hubCol,
        systemId:
          typeof systemId === "string" && systemId.length > 0 ? systemId : "build",
      };
    }
    if (ownerKind === "env") {
      const tile = findTileById?.(state, ownerId);
      if (tile) {
        const envCol = Number.isFinite(tile.col)
          ? Math.floor(tile.col)
          : Number.isFinite(tile.envCol)
            ? Math.floor(tile.envCol)
            : null;
        if (envCol == null) return null;
        return {
          kind: "tile",
          envCol,
          ownerIds: [tile.instanceId ?? ownerId],
          systemId: typeof systemId === "string" && systemId.length > 0 ? systemId : null,
        };
      }
      const structure = findEnvStructureById?.(state, ownerId);
      if (!structure?.instanceId) return null;
      const envCol = Number.isFinite(structure.col)
        ? Math.floor(structure.col)
        : Number.isFinite(structure.envCol)
          ? Math.floor(structure.envCol)
          : null;
      if (envCol == null) return null;
      return {
        kind: "envStructure",
        col: envCol,
        ownerIds: [structure.instanceId],
        systemId: typeof systemId === "string" && systemId.length > 0 ? systemId : null,
      };
    }
    if (ownerKind === "pawn") {
      const pawn = findPawnById?.(state, ownerId);
      if (!pawn?.id && pawn?.id !== 0) return null;
      return {
        kind: "pawn",
        pawnId: pawn.id,
        ownerIds: [pawn.id],
      };
    }
    return null;
  }

  function resolvePoolEndpointWidgetContext(state, endpointId) {
    const parsed = parsePoolEndpointId(endpointId);
    if (!parsed) return null;

    let target = null;
    if (parsed.ownerKind === "hub") {
      target = findStructureById?.(state, parsed.ownerId) ?? null;
    } else if (parsed.ownerKind === "env") {
      target =
        findTileById?.(state, parsed.ownerId) ??
        findEnvStructureById?.(state, parsed.ownerId) ??
        null;
    } else if (parsed.ownerKind === "pawn" && parsed.systemId === "storage") {
      target = buildBasketTarget?.(state, parsed.ownerId) ?? null;
    }

    if (!target) {
      return {
        context: null,
        focus: resolveHoverFocusFromOwnerKind(
          state,
          parsed.ownerKind,
          parsed.ownerId,
          parsed.systemId
        ),
      };
    }

    let widgetSystemId = parsed.systemId || null;
    if (target?.refKind === "basket") {
      widgetSystemId = "basket";
    } else {
      const def = target?.defId ? hubStructureDefs?.[target.defId] : null;
      const depositSystemId =
        typeof def?.deposit?.systemId === "string" ? def.deposit.systemId : null;
      if (depositSystemId && depositSystemId === parsed.systemId) {
        widgetSystemId = "deposit";
      }
    }

    return {
      context: {
        targetRef: makeTargetRef?.(target) ?? null,
        systemId: widgetSystemId,
      },
      focus: resolveHoverFocusFromOwnerKind(
        state,
        parsed.ownerKind,
        parsed.ownerId,
        widgetSystemId
      ),
    };
  }

  function getEndpointFocusOwnerIds(state, endpointId) {
    if (!endpointId || typeof endpointId !== "string") return [];
    if (isAnyDropboxOwnerId?.(endpointId)) return [endpointId];
    if (endpointId.startsWith("inv:hub:")) {
      const id = endpointId.slice("inv:hub:".length);
      const resolved = findStructureById?.(state, id)?.instanceId ?? id;
      return resolved != null ? [resolved] : [];
    }
    if (endpointId.startsWith("inv:pawn:")) {
      const id = endpointId.slice("inv:pawn:".length);
      const resolved = findPawnById?.(state, id)?.id ?? id;
      return resolved != null ? [resolved] : [];
    }
    if (endpointId.startsWith("inv:")) {
      const id = endpointId.slice("inv:".length);
      const structure = findStructureById?.(state, id);
      if (structure?.instanceId != null) return [structure.instanceId];
      const pawn = findPawnById?.(state, id);
      if (pawn?.id != null) return [pawn.id];
      return id ? [id] : [];
    }
    if (endpointId.startsWith("sys:pool:")) return [];
    return [];
  }

  function getEndpointLabel(state, endpointId) {
    if (!endpointId || typeof endpointId !== "string") return "Endpoint";
    if (
      isProcessDropboxOwnerId?.(endpointId) ||
      isHubDropboxOwnerId?.(endpointId) ||
      isBasketDropboxOwnerId?.(endpointId)
    ) {
      return "Dropbox";
    }
    if (endpointId.startsWith("res:state")) return "Stockpile";
    if (endpointId.startsWith("spawn:tileOccupants")) return "Spawn";
    if (endpointId.startsWith("sys:pool:")) {
      const parsed = parsePoolEndpointId(endpointId);
      if (!parsed) return "Pool";
      const ownerLabel = getOwnerLabel(state, parsed.ownerKind, parsed.ownerId);
      const poolLabel = `${parsed.systemId}.${parsed.poolKey}`;
      return ownerLabel ? `${ownerLabel} ${poolLabel}` : `Pool ${poolLabel}`;
    }
    if (endpointId.startsWith("inv:hub:")) {
      const id = endpointId.slice("inv:hub:".length);
      const structure = findStructureById?.(state, id);
      const def = structure ? hubStructureDefs?.[structure.defId] : null;
      const name = def?.name || structure?.defId || id;
      return `${name} Inventory`;
    }
    if (endpointId.startsWith("inv:pawn:")) {
      const id = endpointId.slice("inv:pawn:".length);
      const pawn = findPawnById?.(state, id);
      const name = pawn?.name || `Pawn ${id}`;
      return `${name} Inventory`;
    }
    if (endpointId.startsWith("inv:")) {
      const id = endpointId.slice("inv:".length);
      const structure = findStructureById?.(state, id);
      if (structure) {
        const def =
          hubStructureDefs?.[structure.defId] ?? envStructureDefs?.[structure.defId];
        const name = def?.name || structure.defId || id;
        return `${name} Inventory`;
      }
      const pawn = findPawnById?.(state, id);
      if (pawn) {
        const name = pawn.name || `Pawn ${id}`;
        return `${name} Inventory`;
      }
      return `Inventory ${id}`;
    }
    if (endpointId.startsWith("sys:hub:")) {
      const id = endpointId.slice("sys:hub:".length);
      const structure = findStructureById?.(state, id);
      const def = structure ? hubStructureDefs?.[structure.defId] : null;
      const name = def?.name || structure?.defId || id;
      return `${name} System`;
    }
    if (endpointId.startsWith("sys:pawn:")) {
      const id = endpointId.slice("sys:pawn:".length);
      const pawn = findPawnById?.(state, id);
      return pawn?.name || `Leader ${id}`;
    }
    return endpointId;
  }

  function resolveEndpointHoverSpec(state, endpointId) {
    const inventoryOwnerIds = getEndpointFocusOwnerIds(state, endpointId);
    let processContext = null;
    let focus = resolveHoverFocusFromOwnerIds?.(state, inventoryOwnerIds) ?? null;

    if (endpointId && endpointId.startsWith("sys:pool:")) {
      const pool = resolvePoolEndpointWidgetContext(state, endpointId);
      processContext = pool?.context || null;
      if (pool?.focus) focus = pool.focus;
    }

    return {
      inventoryOwnerIds,
      processContext,
      focus,
    };
  }

  return {
    getEndpointLabel,
    resolveEndpointHoverSpec,
  };
}
