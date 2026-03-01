const LEADER_FAITH_EVENT_MARKERS = Object.freeze({
  leaderFaithDecayed: "normal",
  leaderFaithCollapsed: "critical",
});

const LEADER_FAITH_MARKER_COLORS = Object.freeze({
  normal: 0xff8f6f,
  critical: 0xff4f4f,
});

function toSafeSec(value, fallback = 0) {
  if (!Number.isFinite(value)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(value));
}

function toComparableOwnerId(value) {
  if (Number.isFinite(value)) return String(Math.floor(value));
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function parseSnapshotStateData(stateData) {
  if (!stateData) return null;
  if (typeof stateData === "object") return stateData;
  if (typeof stateData !== "string") return null;
  try {
    return JSON.parse(stateData);
  } catch (_) {
    return null;
  }
}

function eventTargetsOwnerPawn(entry, ownerPawnIdKey) {
  if (!entry || ownerPawnIdKey == null) return false;
  const data = entry?.data;
  if (!data || typeof data !== "object") return false;

  const pawnIdKey = toComparableOwnerId(data.pawnId);
  if (pawnIdKey != null && pawnIdKey === ownerPawnIdKey) return true;

  const ownerIds = Array.isArray(data.ownerIds) ? data.ownerIds : [];
  for (const ownerId of ownerIds) {
    const ownerIdKey = toComparableOwnerId(ownerId);
    if (ownerIdKey != null && ownerIdKey === ownerPawnIdKey) {
      return true;
    }
  }
  return false;
}

function severitySortKey(severity) {
  return severity === "critical" ? 1 : 0;
}

export function createLeaderFaithMarkerResolver({ controller, ownerPawnId }) {
  const ownerPawnIdKey = toComparableOwnerId(ownerPawnId);
  if (!controller || ownerPawnIdKey == null) {
    return () => [];
  }

  let cachedSignature = "";
  let cachedMarkers = [];

  return function resolveLeaderFaithMarkers(spec = {}) {
    const minSec = toSafeSec(spec?.minSec, 0);
    const maxSec = Math.max(minSec, toSafeSec(spec?.maxSec, minSec));
    const controllerData = controller.getData?.() ?? {};
    const cacheVersion = Number.isFinite(controllerData?.cacheVersion)
      ? Math.floor(controllerData.cacheVersion)
      : -1;
    const signature = `${ownerPawnIdKey}|${cacheVersion}|${minSec}:${maxSec}`;
    if (signature === cachedSignature) {
      return cachedMarkers;
    }

    const markers = [];
    const seen = new Set();
    for (let sec = minSec; sec <= maxSec; sec += 1) {
      const stateData = controller.getStateDataAt?.(sec);
      if (!stateData) continue;
      const snapshot = parseSnapshotStateData(stateData);
      const feed = Array.isArray(snapshot?.gameEventFeed) ? snapshot.gameEventFeed : [];
      if (!feed.length) continue;

      for (const entry of feed) {
        const entrySec = Number.isFinite(entry?.tSec)
          ? Math.max(0, Math.floor(entry.tSec))
          : null;
        if (entrySec == null || entrySec !== sec) continue;
        const eventType = typeof entry?.type === "string" ? entry.type : null;
        const severity = eventType ? LEADER_FAITH_EVENT_MARKERS[eventType] : null;
        if (severity !== "normal" && severity !== "critical") continue;
        if (!eventTargetsOwnerPawn(entry, ownerPawnIdKey)) continue;

        const dedupeKey = `${entrySec}:${severity}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        markers.push({
          tSec: entrySec,
          severity,
          color: LEADER_FAITH_MARKER_COLORS[severity],
        });
      }
    }

    markers.sort(
      (a, b) =>
        a.tSec - b.tSec || severitySortKey(a.severity) - severitySortKey(b.severity)
    );
    cachedSignature = signature;
    cachedMarkers = markers;
    return markers;
  };
}
