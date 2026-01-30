export function selectWeightedEntry(state, entries, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length || typeof state?.rngNextFloat !== "function") return null;

  const tagSet = normalizeTagSet(options.tags);
  const weights = new Array(list.length);
  let total = 0;

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || typeof entry !== "object") {
      weights[i] = 0;
      continue;
    }
    if (!requiresTags(entry.requiresTag, tagSet)) {
      weights[i] = 0;
      continue;
    }
    const weight = Number.isFinite(entry.weight) ? Math.max(0, entry.weight) : 0;
    weights[i] = weight;
    total += weight;
  }

  if (total <= 0) return null;

  const roll = state.rngNextFloat() * total;
  let acc = 0;
  for (let i = 0; i < list.length; i++) {
    acc += weights[i];
    if (roll < acc) return list[i] ?? null;
  }

  return list[list.length - 1] ?? null;
}

function normalizeTagSet(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const set = new Set();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    set.add(tag);
  }
  return set.size > 0 ? set : null;
}

function requiresTags(requiresTag, tagSet) {
  if (!requiresTag) return true;
  if (!tagSet) return false;
  if (typeof requiresTag === "string") return tagSet.has(requiresTag);
  if (Array.isArray(requiresTag)) {
    for (const tag of requiresTag) {
      if (typeof tag !== "string") continue;
      if (!tagSet.has(tag)) return false;
    }
    return true;
  }
  return false;
}
