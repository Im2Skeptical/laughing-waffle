export function resolveBoardTargets(state, targetSpec, context) {
  if (!targetSpec || typeof targetSpec !== "object") return [];

  const getOccLayer = (layer) => {
    if (layer === "hub") return state.hub?.occ;
    return state.board?.occ?.[layer];
  };

  if (targetSpec.all === true) {
    const layer = targetSpec.layer;
    if (!layer) return [];
    if (layer === "hub") {
      const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : null;
      if (anchors) return anchors.filter(Boolean);
      const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
      return slots.map((slot) => slot?.structure).filter(Boolean);
    }
    const anchors = state.board?.layers?.[layer]?.anchors;
    if (!Array.isArray(anchors)) return [];
    return anchors.filter(Boolean);
  }

  if (targetSpec.at && typeof targetSpec.at === "object") {
    const layer = targetSpec.at.layer;
    const col = targetSpec.at.col;
    if (!layer || !Number.isFinite(col)) return [];
    const occ = getOccLayer(layer);
    if (!Array.isArray(occ)) return [];
    const idx = Math.floor(col);
    const target = occ[idx];
    return target ? [target] : [];
  }

  if (targetSpec.ref === "self") {
    const layer = targetSpec.layer;
    const source = context?.source;
    if (!layer || !source) return [];
    const occ = getOccLayer(layer);
    if (!Array.isArray(occ)) return [];

    const startCol = Number.isFinite(source.col) ? Math.floor(source.col) : 0;
    const span =
      Number.isFinite(source.span) && source.span > 0
        ? Math.floor(source.span)
        : 1;

    const targets = [];
    const seen = new Set();
    for (let offset = 0; offset < span; offset++) {
      const col = startCol + offset;
      if (col < 0 || col >= occ.length) continue;
      const target = occ[col];
      if (!target) continue;
      const key = target.instanceId ?? target;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
    return targets;
  }

  return [];
}
