function getOccLayer(state, layer) {
  if (layer === "hub") return state?.hub?.occ;
  return state?.board?.occ?.[layer];
}

function getLayerAnchors(state, layer) {
  if (layer === "hub") {
    const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : null;
    if (anchors) return anchors.filter(Boolean);
    const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
    return slots.map((slot) => slot?.structure).filter(Boolean);
  }
  const anchors = state?.board?.layers?.[layer]?.anchors;
  if (!Array.isArray(anchors)) return [];
  return anchors.filter(Boolean);
}

function getPawnFromContext(state, context) {
  if (context?.pawn && typeof context.pawn === "object") return context.pawn;
  const pawnId = context?.pawnId != null ? context.pawnId : context?.ownerId;
  if (pawnId == null) return null;
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    if (pawn?.id === pawnId) return pawn;
  }
  return null;
}

function collectTargetsFromOcc(occ) {
  if (!Array.isArray(occ)) return [];
  const targets = [];
  const seen = new Set();
  for (let col = 0; col < occ.length; col++) {
    const target = occ[col];
    if (!target) continue;
    const key = target.instanceId ?? target;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

function collectTargetsFromCols(occ, cols) {
  if (!Array.isArray(occ) || !Array.isArray(cols)) return [];
  const targets = [];
  const seen = new Set();
  for (const rawCol of cols) {
    if (!Number.isFinite(rawCol)) continue;
    const col = Math.floor(rawCol);
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

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string");
  }
  if (typeof value === "string") return [value];
  return [];
}

function getSystemNumericValue(target, systemId, key) {
  if (!target || !systemId || !key) return null;
  const systemState = target.systemState?.[systemId];
  if (!systemState || typeof systemState !== "object") return null;
  const value = systemState[key];
  if (!Number.isFinite(value)) return null;
  return value;
}

function normalizeSystemSpecs(spec) {
  if (!spec) return [];
  if (Array.isArray(spec)) return spec.filter((entry) => entry && typeof entry === "object");
  if (typeof spec === "object") return [spec];
  return [];
}

function matchesSystemAtLeast(target, spec) {
  const systemId = spec?.system;
  const key = spec?.key;
  const gte = spec?.gte;
  if (!systemId || !key || !Number.isFinite(gte)) return false;
  const value = getSystemNumericValue(target, systemId, key);
  if (!Number.isFinite(value)) return false;
  return value >= gte;
}

function matchesSystemAtMost(target, spec) {
  const systemId = spec?.system;
  const key = spec?.key;
  const lte = spec?.lte;
  if (!systemId || !key || !Number.isFinite(lte)) return false;
  const value = getSystemNumericValue(target, systemId, key);
  if (!Number.isFinite(value)) return false;
  return value <= lte;
}

function matchesSystemBetween(target, spec) {
  const systemId = spec?.system;
  const key = spec?.key;
  const min = spec?.min;
  const max = spec?.max;
  if (!systemId || !key || !Number.isFinite(min) || !Number.isFinite(max)) {
    return false;
  }
  const value = getSystemNumericValue(target, systemId, key);
  if (!Number.isFinite(value)) return false;
  return value >= min && value <= max;
}

function matchesBoardWhere(target, whereSpec) {
  if (!whereSpec || typeof whereSpec !== "object") return true;
  if (!target || typeof target !== "object") return false;

  const tileId = whereSpec.tileId;
  if (typeof tileId === "string") {
    if (target.defId !== tileId) return false;
  } else if (Array.isArray(tileId) && tileId.length > 0) {
    if (!tileId.includes(target.defId)) return false;
  }

  const tags = Array.isArray(target.tags) ? target.tags : [];
  const hasTag = whereSpec.hasTag;
  if (typeof hasTag === "string") {
    if (!tags.includes(hasTag)) return false;
  } else if (Array.isArray(hasTag) && hasTag.length > 0) {
    for (const tag of hasTag) {
      if (!tags.includes(tag)) return false;
    }
  }

  const hasAllTags = normalizeStringArray(whereSpec.hasAllTags);
  if (hasAllTags.length > 0) {
    for (const tag of hasAllTags) {
      if (!tags.includes(tag)) return false;
    }
  }

  const hasAnyTags = normalizeStringArray(whereSpec.hasAnyTags);
  if (hasAnyTags.length > 0) {
    let any = false;
    for (const tag of hasAnyTags) {
      if (tags.includes(tag)) {
        any = true;
        break;
      }
    }
    if (!any) return false;
  }

  const notTag = whereSpec.notTag;
  if (typeof notTag === "string" && tags.includes(notTag)) return false;

  const excludeTags = normalizeStringArray(whereSpec.excludeTags);
  if (excludeTags.length > 0) {
    for (const tag of excludeTags) {
      if (tags.includes(tag)) return false;
    }
  }

  const systemAtLeastSpecs = normalizeSystemSpecs(whereSpec.systemAtLeast);
  for (const spec of systemAtLeastSpecs) {
    if (!matchesSystemAtLeast(target, spec)) return false;
  }

  const systemAtMostSpecs = normalizeSystemSpecs(whereSpec.systemAtMost);
  for (const spec of systemAtMostSpecs) {
    if (!matchesSystemAtMost(target, spec)) return false;
  }

  const systemBetweenSpecs = normalizeSystemSpecs(whereSpec.systemBetween);
  for (const spec of systemBetweenSpecs) {
    if (!matchesSystemBetween(target, spec)) return false;
  }

  return true;
}

function collectTileColsByWhere(state, whereSpec, maxCols) {
  const occ = state?.board?.occ?.tile;
  if (!Array.isArray(occ)) return [];
  const safeMax = Number.isFinite(maxCols) ? Math.max(0, Math.floor(maxCols)) : occ.length;
  const cols = [];
  for (let col = 0; col < occ.length && col < safeMax; col++) {
    const tile = occ[col];
    if (!tile) continue;
    if (!matchesBoardWhere(tile, whereSpec)) continue;
    cols.push(col);
  }
  return cols;
}

function normalizeCols(cols, maxCols) {
  if (!Array.isArray(cols)) return [];
  const safeMax = Number.isFinite(maxCols) ? Math.max(0, Math.floor(maxCols)) : 0;
  if (safeMax <= 0) return [];
  const seen = new Array(safeMax).fill(false);
  const out = [];
  for (const rawCol of cols) {
    if (!Number.isFinite(rawCol)) continue;
    const col = Math.floor(rawCol);
    if (col < 0 || col >= safeMax) continue;
    if (seen[col]) continue;
    seen[col] = true;
    out.push(col);
  }
  return out;
}

function expandAreaCols(refCols, areaSpec, maxCols) {
  const safeMax = Number.isFinite(maxCols) ? Math.max(0, Math.floor(maxCols)) : 0;
  if (safeMax <= 0) return [];
  const baseCols = normalizeCols(refCols, safeMax);
  if (!areaSpec || typeof areaSpec !== "object") return baseCols;

  if (areaSpec.kind !== "adjacent") return baseCols;
  const radius = Number.isFinite(areaSpec.radius)
    ? Math.max(0, Math.floor(areaSpec.radius))
    : 0;
  if (radius === 0) return baseCols;

  const seen = new Array(safeMax).fill(false);
  const out = [];
  for (const refCol of baseCols) {
    for (let offset = -radius; offset <= radius; offset++) {
      const col = refCol + offset;
      if (col < 0 || col >= safeMax) continue;
      if (seen[col]) continue;
      seen[col] = true;
      out.push(col);
    }
  }
  return out;
}

function collectRefCols(state, refSpec, context, maxCols) {
  if (refSpec === "self") {
    const source = context?.source;
    if (!source) return [];
    const startCol = Number.isFinite(source.col) ? Math.floor(source.col) : null;
    if (startCol == null) return [];
    const span =
      Number.isFinite(source.span) && source.span > 0
        ? Math.floor(source.span)
        : 1;
    const cols = [];
    for (let offset = 0; offset < span; offset++) {
      cols.push(startCol + offset);
    }
    return normalizeCols(cols, maxCols);
  }

  if (refSpec && typeof refSpec === "object") {
    if (refSpec.kind === "tileWhere") {
      return collectTileColsByWhere(state, refSpec.where, maxCols);
    }
  }

  return [];
}

export function resolveBoardTargets(state, targetSpec, context) {
  if (!targetSpec || typeof targetSpec !== "object") return [];

  if (
    targetSpec.ref === "self" &&
    !targetSpec.layer &&
    !targetSpec.at &&
    !targetSpec.area
  ) {
    return context?.source ? [context.source] : [];
  }

  if (targetSpec.ref === "pawn") {
    const pawn = getPawnFromContext(state, context);
    return pawn ? [pawn] : [];
  }

  const atSpec = targetSpec.at && typeof targetSpec.at === "object" ? targetSpec.at : null;
  const layer = atSpec?.layer || targetSpec.layer;

  if (targetSpec.all === true) {
    if (!layer) return [];
    if (layer === "hub") {
      const targets = getLayerAnchors(state, layer);
      return targetSpec.where ? targets.filter((t) => matchesBoardWhere(t, targetSpec.where)) : targets;
    }
    const occ = getOccLayer(state, layer);
    const targets = collectTargetsFromOcc(occ);
    return targetSpec.where ? targets.filter((t) => matchesBoardWhere(t, targetSpec.where)) : targets;
  }

  if (atSpec) {
    const col = atSpec.col;
    if (!layer || !Number.isFinite(col)) return [];
    const occ = getOccLayer(state, layer);
    if (!Array.isArray(occ)) return [];
    const idx = Math.floor(col);
    const target = occ[idx];
    if (!target) return [];
    if (targetSpec.where && !matchesBoardWhere(target, targetSpec.where)) return [];
    return [target];
  }

  if (targetSpec.ref || targetSpec.area) {
    if (!layer) return [];
    const occ = getOccLayer(state, layer);
    if (!Array.isArray(occ)) return [];
    const refSpec = targetSpec.ref ?? "self";
    const refCols = collectRefCols(state, refSpec, context, occ.length);
    if (!refCols.length) return [];
    const areaCols = expandAreaCols(refCols, targetSpec.area, occ.length);
    const targets = collectTargetsFromCols(occ, areaCols);
    return targetSpec.where ? targets.filter((t) => matchesBoardWhere(t, targetSpec.where)) : targets;
  }

  if (targetSpec.where && layer) {
    const occ = getOccLayer(state, layer);
    const targets = collectTargetsFromOcc(occ);
    return targets.filter((t) => matchesBoardWhere(t, targetSpec.where));
  }

  return [];
}
