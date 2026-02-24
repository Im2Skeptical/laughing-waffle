// persistent-memory.js
// Deterministic, JSON-serializable helpers for cross-rewind knowledge.

const DROP_POOL_ID_SEP = "::";

function isPlainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    if (!value.length) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function normalizeDroppedItemKindsByPoolId(raw) {
  const root = isPlainRecord(raw) ? raw : {};
  const out = {};
  for (const [poolId, kinds] of Object.entries(root)) {
    if (typeof poolId !== "string" || !poolId.length) continue;
    const normalizedKinds = normalizeStringList(kinds);
    if (normalizedKinds.length <= 0) continue;
    out[poolId] = normalizedKinds;
  }
  return out;
}

function normalizePersistentKnowledge(value) {
  const raw = isPlainRecord(value) ? value : {};
  return {
    droppedItemKindsByPoolId: normalizeDroppedItemKindsByPoolId(
      raw.droppedItemKindsByPoolId
    ),
  };
}

function isNormalizedStringList(raw) {
  if (!Array.isArray(raw)) return false;
  let prev = null;
  for (const entry of raw) {
    if (typeof entry !== "string") return false;
    const value = entry.trim();
    if (!value.length) return false;
    if (value !== entry) return false;
    if (prev != null && prev.localeCompare(value) >= 0) return false;
    prev = value;
  }
  return true;
}

function isNormalizedDroppedItemKindsByPoolId(raw) {
  if (!isPlainRecord(raw)) return false;
  for (const [poolId, kinds] of Object.entries(raw)) {
    if (typeof poolId !== "string" || !poolId.length) return false;
    if (!isNormalizedStringList(kinds)) return false;
    if (kinds.length <= 0) return false;
  }
  return true;
}

function isNormalizedPersistentKnowledge(raw) {
  if (!isPlainRecord(raw)) return false;
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "droppedItemKindsByPoolId") return false;
  return isNormalizedDroppedItemKindsByPoolId(raw.droppedItemKindsByPoolId);
}

function resolveKnowledgeLike(value) {
  if (!value || typeof value !== "object") return null;
  if (
    Object.prototype.hasOwnProperty.call(value, "droppedItemKindsByPoolId") ||
    Object.prototype.hasOwnProperty.call(value, "persistentKnowledge")
  ) {
    if (
      Object.prototype.hasOwnProperty.call(value, "droppedItemKindsByPoolId") &&
      !Object.prototype.hasOwnProperty.call(value, "persistentKnowledge")
    ) {
      return value;
    }
    return value.persistentKnowledge;
  }
  return null;
}

export function ensurePersistentKnowledgeState(stateLike) {
  if (!stateLike || typeof stateLike !== "object") {
    return normalizePersistentKnowledge(null);
  }
  const existing = stateLike.persistentKnowledge;
  if (isNormalizedPersistentKnowledge(existing)) return existing;
  const normalized = normalizePersistentKnowledge(existing);
  stateLike.persistentKnowledge = normalized;
  return normalized;
}

export function clonePersistentKnowledge(sourceLike) {
  const sourceKnowledge = resolveKnowledgeLike(sourceLike);
  return normalizePersistentKnowledge(sourceKnowledge);
}

export function makeDropPoolId(tableKey, tileDefId) {
  if (typeof tableKey !== "string" || !tableKey.trim().length) return null;
  if (typeof tileDefId !== "string" || !tileDefId.trim().length) return null;
  return `${tableKey.trim()}${DROP_POOL_ID_SEP}${tileDefId.trim()}`;
}

export function rememberDroppedItemKind(
  stateLike,
  { tableKey, tileDefId, itemKind } = {}
) {
  if (!stateLike || typeof stateLike !== "object") return false;
  if (typeof itemKind !== "string" || !itemKind.trim().length) return false;
  const poolId = makeDropPoolId(tableKey, tileDefId);
  if (!poolId) return false;

  const knowledge = ensurePersistentKnowledgeState(stateLike);
  const map = knowledge.droppedItemKindsByPoolId;
  const normalizedKind = itemKind.trim();
  const current = Array.isArray(map[poolId]) ? map[poolId].slice() : [];
  if (current.includes(normalizedKind)) return false;
  current.push(normalizedKind);
  current.sort((a, b) => a.localeCompare(b));
  map[poolId] = current;
  return true;
}

export function getDroppedItemKindsForPool(
  stateLike,
  { tableKey, tileDefId } = {}
) {
  const poolId = makeDropPoolId(tableKey, tileDefId);
  if (!poolId) return [];
  const knowledge = resolveKnowledgeLike(stateLike);
  if (!knowledge || typeof knowledge !== "object") return [];
  const map =
    knowledge.droppedItemKindsByPoolId &&
    typeof knowledge.droppedItemKindsByPoolId === "object" &&
    !Array.isArray(knowledge.droppedItemKindsByPoolId)
      ? knowledge.droppedItemKindsByPoolId
      : null;
  if (!map) return [];
  return normalizeStringList(map[poolId]);
}

export function mergePersistentKnowledge(targetLike, sourceLike) {
  if (!targetLike || typeof targetLike !== "object") return false;
  const targetKnowledge = ensurePersistentKnowledgeState(targetLike);
  const sourceKnowledge = normalizePersistentKnowledge(
    resolveKnowledgeLike(sourceLike)
  );

  let changed = false;
  const targetMap = targetKnowledge.droppedItemKindsByPoolId;
  const sourceMap = sourceKnowledge.droppedItemKindsByPoolId;

  for (const [poolId, sourceKinds] of Object.entries(sourceMap)) {
    const existingKinds = Array.isArray(targetMap[poolId]) ? targetMap[poolId] : [];
    const merged = normalizeStringList(existingKinds.concat(sourceKinds));
    const existingNorm = normalizeStringList(existingKinds);
    if (merged.length === existingNorm.length) {
      let same = true;
      for (let i = 0; i < merged.length; i += 1) {
        if (merged[i] !== existingNorm[i]) {
          same = false;
          break;
        }
      }
      if (same) continue;
    }
    targetMap[poolId] = merged;
    changed = true;
  }

  return changed;
}
