function getCharsOnCol(state, col) {
  const out = [];
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  for (const ch of chars) {
    const envCol = Number.isFinite(ch?.envCol) ? Math.floor(ch.envCol) : null;
    if (envCol === col) out.push(ch);
  }
  out.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  return out;
}

export function resolveOwnerTargets(state, targetSpec, context) {
  if (!targetSpec || typeof targetSpec !== "object") return [];

  if (targetSpec.kind === "tileOccupants") {
    const col =
      Number.isFinite(targetSpec.envCol)
        ? Math.floor(targetSpec.envCol)
        : Number.isFinite(context?.envCol)
          ? Math.floor(context.envCol)
          : Number.isFinite(context?.source?.col)
            ? Math.floor(context.source.col)
            : null;
    if (col == null) return [];
    return getCharsOnCol(state, col);
  }

  if (Array.isArray(targetSpec.ownerIds)) {
    return targetSpec.ownerIds.filter((id) => id != null);
  }

  if (targetSpec.ownerId != null) return [targetSpec.ownerId];

  return [];
}
