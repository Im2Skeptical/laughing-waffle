function getPawnsOnCol(state, col) {
  const out = [];
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    const envCol = Number.isFinite(pawn?.envCol) ? Math.floor(pawn.envCol) : null;
    if (envCol === col) out.push(pawn);
  }
  return out;
}

export function resolveOwnerTargets(state, targetSpec, context) {
  if (!targetSpec || typeof targetSpec !== "object") return [];

  if (targetSpec.ref === "selfInv") {
    if (context?.kind === "item") {
      const ownerId = context?.ownerId ?? null;
      return ownerId != null ? [ownerId] : [];
    }
    const ownerId = context?.source?.instanceId ?? null;
    return ownerId != null ? [ownerId] : [];
  }

  if (targetSpec.kind === "tileOccupants") {
    const allOccupants =
      targetSpec.scope === "all" || targetSpec.all === true;
    if (!allOccupants) {
      if (context?.pawn && typeof context.pawn === "object") {
        return [context.pawn];
      }
      const directId =
        context?.pawnId != null ? context.pawnId : context?.ownerId;
      if (directId != null) {
        const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
        for (const pawn of pawns) {
          if (pawn?.id === directId) return [pawn];
        }
        return [];
      }
    }
    const col =
      Number.isFinite(targetSpec.envCol)
        ? Math.floor(targetSpec.envCol)
        : Number.isFinite(context?.envCol)
          ? Math.floor(context.envCol)
          : Number.isFinite(context?.source?.col)
            ? Math.floor(context.source.col)
            : null;
    if (col == null) return [];
    return getPawnsOnCol(state, col);
  }

  if (Array.isArray(targetSpec.ownerIds)) {
    return targetSpec.ownerIds.filter((id) => id != null);
  }

  if (targetSpec.ownerId != null) return [targetSpec.ownerId];

  return [];
}
