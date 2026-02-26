const DEFAULT_MIN_TEXT_RESOLUTION = 2;

function getDevicePixelRatio() {
  const ratio = Number(globalThis?.devicePixelRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return ratio;
}

function clampScale(scale) {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return scale;
}

export function getTextResolutionForScale(scale = 1, options = {}) {
  const minResolution = Number.isFinite(options?.minResolution)
    ? Math.max(1, Math.ceil(options.minResolution))
    : DEFAULT_MIN_TEXT_RESOLUTION;
  const baseResolution = Math.max(
    minResolution,
    Math.ceil(getDevicePixelRatio())
  );
  const effectiveScale = clampScale(scale);
  return Math.max(minResolution, Math.ceil(baseResolution * effectiveScale));
}

export function applyTextResolution(textNode, scale = 1, options = {}) {
  if (!textNode || typeof textNode !== "object") return false;
  const nextResolution = getTextResolutionForScale(scale, options);
  if (textNode.resolution === nextResolution) return false;
  textNode.resolution = nextResolution;
  if (textNode.dirty != null) textNode.dirty = true;
  return true;
}

export function applyTextResolutionList(textNodes, scale = 1, options = {}) {
  if (!Array.isArray(textNodes)) return 0;
  let changed = 0;
  for (const textNode of textNodes) {
    if (applyTextResolution(textNode, scale, options)) changed += 1;
  }
  return changed;
}
