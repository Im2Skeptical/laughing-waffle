// src/model/timegraph/edit-policy.js
// Shared, deterministic policy helpers for timegraph editability and windows.

import {
  SCROLL_GRAPH_SUBJECT_DEFS,
  SCROLL_GRAPH_TYPE_DEFS,
} from "../../defs/gamepieces/scroll-timegraph-defs.js";

export function toSafeSec(value, fallback = 0) {
  if (!Number.isFinite(value)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(value));
}

export function normalizeSecRange(raw, fallbackMin = 0) {
  const minSec = toSafeSec(raw?.minSec, fallbackMin);
  const maxSec = Math.max(minSec, toSafeSec(raw?.maxSec, minSec));
  return { minSec, maxSec };
}

export function clipSecRange(range, clipMinSec, clipMaxSec) {
  const normalized = normalizeSecRange(range, clipMinSec);
  const minSec = Math.max(toSafeSec(clipMinSec, 0), normalized.minSec);
  const maxSec = Math.min(
    Math.max(minSec, toSafeSec(clipMaxSec, minSec)),
    normalized.maxSec
  );
  if (maxSec <= minSec) return null;
  return { minSec, maxSec };
}

export function mergeSecRanges(rawRanges) {
  const ranges = Array.isArray(rawRanges)
    ? rawRanges
        .map((entry) => normalizeSecRange(entry, 0))
        .filter((entry) => entry.maxSec > entry.minSec)
    : [];
  if (!ranges.length) return [];

  ranges.sort(
    (a, b) => a.minSec - b.minSec || a.maxSec - b.maxSec
  );

  const out = [];
  for (const range of ranges) {
    const prev = out[out.length - 1];
    if (!prev || range.minSec > prev.maxSec) {
      out.push({ minSec: range.minSec, maxSec: range.maxSec });
      continue;
    }
    prev.maxSec = Math.max(prev.maxSec, range.maxSec);
  }
  return out;
}

export function normalizeTimegraphPolicyState(graphState) {
  if (!graphState || typeof graphState !== "object") return null;

  const typeId =
    typeof graphState.scrollType === "string" ? graphState.scrollType : null;
  const subjectId =
    typeof graphState.subject === "string" ? graphState.subject : null;
  if (!SCROLL_GRAPH_TYPE_DEFS[typeId]) return null;
  if (!SCROLL_GRAPH_SUBJECT_DEFS[subjectId]) return null;

  const typeDef = SCROLL_GRAPH_TYPE_DEFS[typeId];
  const subjectDef = SCROLL_GRAPH_SUBJECT_DEFS[subjectId];
  const metricId =
    typeof graphState.metricId === "string"
      ? graphState.metricId
      : typeof subjectDef?.metricId === "string"
        ? subjectDef.metricId
        : null;
  const horizonSec = toSafeSec(graphState.horizonSec, 120);
  const historyWindowSec = toSafeSec(graphState.historyWindowSec, 120);
  const manufacturedSec = Number.isFinite(graphState.manufacturedSec)
    ? toSafeSec(graphState.manufacturedSec, 0)
    : null;

  const editableRangeMode =
    typeof graphState.editableRangeMode === "string"
      ? graphState.editableRangeMode
      : null;
  const editableRangeStartSec = Number.isFinite(graphState.editableRangeStartSec)
    ? toSafeSec(graphState.editableRangeStartSec, 0)
    : Number.isFinite(graphState.editableMinSec)
      ? toSafeSec(graphState.editableMinSec, 0)
      : null;
  const editableRangeEndSec = Number.isFinite(graphState.editableRangeEndSec)
    ? toSafeSec(graphState.editableRangeEndSec, 0)
    : Number.isFinite(graphState.editableMaxSec)
      ? toSafeSec(graphState.editableMaxSec, 0)
      : null;
  const systemTargetModeOnOpen =
    graphState.systemTargetModeOnOpen === "inventoryOwnerLocked"
      ? "inventoryOwnerLocked"
      : "hover";
  const eventMarkerModeOnOpen =
    graphState.eventMarkerModeOnOpen === "leaderFaith"
      ? "leaderFaith"
      : "none";

  return {
    typeId,
    subjectId,
    metricId,
    windowMode:
      typeof graphState.windowMode === "string"
        ? graphState.windowMode
        : typeDef.windowMode,
    editable:
      typeof graphState.editable === "boolean"
        ? graphState.editable
        : !!typeDef.editable,
    frozen:
      typeof graphState.frozen === "boolean"
        ? graphState.frozen
        : !!typeDef.frozen,
    requiresManufacturedSec:
      graphState.requiresManufacturedSec === true ||
      typeDef.requiresManufacturedSec === true,
    horizonSec,
    historyWindowSec,
    manufacturedSec,
    editableRangeMode,
    editableRangeStartSec,
    editableRangeEndSec,
    systemTargetModeOnOpen,
    eventMarkerModeOnOpen,
  };
}

export function getScrollTimegraphStateFromItem(item) {
  return normalizeTimegraphPolicyState(item?.systemState?.timegraph);
}

export function getAbsoluteEditableRangeFromTimegraphState(graphState, meta = {}) {
  if (!graphState || typeof graphState !== "object") return null;
  const mode = String(graphState.editableRangeMode || "").toLowerCase();
  if (mode !== "absolute") return null;

  const minRaw = Number.isFinite(graphState.editableRangeStartSec)
    ? graphState.editableRangeStartSec
    : Number.isFinite(graphState.editableMinSec)
      ? graphState.editableMinSec
      : 0;
  const maxRaw = Number.isFinite(graphState.editableRangeEndSec)
    ? graphState.editableRangeEndSec
    : Number.isFinite(graphState.editableMaxSec)
      ? graphState.editableMaxSec
      : null;
  if (!Number.isFinite(maxRaw)) return null;

  const minSec = toSafeSec(minRaw, 0);
  const maxSec = Math.max(minSec, toSafeSec(maxRaw, minSec));
  return {
    itemId: Number.isFinite(meta?.itemId) ? Math.floor(meta.itemId) : null,
    itemKind: typeof meta?.itemKind === "string" ? meta.itemKind : null,
    minSec,
    maxSec,
  };
}

export function getAbsoluteEditableRangeFromScrollState(scrollState) {
  if (!scrollState || typeof scrollState !== "object") return null;
  if (
    String(scrollState.editableRangeMode || "").toLowerCase() !== "absolute" ||
    !Number.isFinite(scrollState.editableRangeEndSec)
  ) {
    return null;
  }
  const minSec = toSafeSec(scrollState.editableRangeStartSec, 0);
  const maxSec = Math.max(
    minSec,
    toSafeSec(scrollState.editableRangeEndSec, minSec)
  );
  return { minSec, maxSec };
}

export function collectAbsoluteEditableRangesFromState(state) {
  const ranges = [];
  const seenItemIds = new Set();

  const scanItem = (item) => {
    if (!item || typeof item !== "object") return;
    const itemId = Number.isFinite(item?.id) ? Math.floor(item.id) : null;
    if (itemId != null && seenItemIds.has(itemId)) return;
    const range = getAbsoluteEditableRangeFromTimegraphState(
      item?.systemState?.timegraph,
      {
        itemId,
        itemKind: item?.kind,
      }
    );
    if (!range) return;
    ranges.push(range);
    if (itemId != null) seenItemIds.add(itemId);
  };

  const ownerInventories = state?.ownerInventories;
  if (ownerInventories && typeof ownerInventories === "object") {
    for (const inv of Object.values(ownerInventories)) {
      const items = Array.isArray(inv?.items) ? inv.items : [];
      for (const item of items) scanItem(item);
    }
  }

  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    const equipment = pawn?.equipment;
    if (!equipment || typeof equipment !== "object") continue;
    for (const equipped of Object.values(equipment)) {
      scanItem(equipped);
    }
  }

  ranges.sort((a, b) => a.minSec - b.minSec || a.maxSec - b.maxSec);
  return ranges;
}

export function findAbsoluteEditableRangeAtSecond(state, sec) {
  const targetSec = toSafeSec(sec, 0);
  const ranges = collectAbsoluteEditableRangesFromState(state);
  for (const range of ranges) {
    if (targetSec < range.minSec || targetSec > range.maxSec) continue;
    return range;
  }
  return null;
}

export function resolveEditWindowStatusAtSecond({
  tSec,
  minEditableSec,
  state,
} = {}) {
  const sec = toSafeSec(tSec, 0);
  const baseMinSec = toSafeSec(minEditableSec, 0);
  const editableByWindow = sec >= baseMinSec;
  const itemGrant = editableByWindow
    ? null
    : findAbsoluteEditableRangeAtSecond(state, sec);
  const editable = editableByWindow || !!itemGrant;
  return {
    ok: editable,
    editable,
    tSec: sec,
    reason: editable ? null : "outsideEditableHistoryWindow",
    editableByWindow,
    editableByItemGrant: !!itemGrant,
    itemGrant: itemGrant || null,
  };
}

export function computeScrollWindowSpec({
  scrollState,
  historyEndSec,
  cursorSec,
  minEditableSec,
} = {}) {
  const state = scrollState && typeof scrollState === "object" ? scrollState : {};
  const historyEnd = toSafeSec(historyEndSec, 0);
  const cursor = toSafeSec(cursorSec, historyEnd);
  const minEditable = toSafeSec(minEditableSec, 0);

  const anchorSec = Number.isFinite(state.manufacturedSec)
    ? toSafeSec(state.manufacturedSec, historyEnd)
    : historyEnd;

  const absoluteRange = getAbsoluteEditableRangeFromScrollState(state);
  if (absoluteRange) {
    const minSec = absoluteRange.minSec;
    const maxSec = absoluteRange.maxSec;
    return {
      minSec,
      maxSec: Math.max(minSec + 1, maxSec),
      scrubSec: Math.max(minSec, Math.min(cursor, maxSec)),
    };
  }

  if (state.windowMode === "future") {
    const minSec = anchorSec;
    const maxSec = anchorSec + toSafeSec(state.horizonSec, 0);
    return { minSec, maxSec, scrubSec: cursor };
  }

  if (state.windowMode === "historyWindow") {
    const maxSec = anchorSec;
    const minSec = Math.max(0, anchorSec - toSafeSec(state.historyWindowSec, 0));
    return { minSec, maxSec, scrubSec: maxSec };
  }

  if (state.windowMode === "fullHistory") {
    const maxSec = Math.max(historyEnd, cursor);
    return { minSec: 0, maxSec, scrubSec: cursor };
  }

  if (state.windowMode === "rollingEditable") {
    const maxSec = historyEnd;
    const rollingMin = Math.max(0, maxSec - toSafeSec(state.historyWindowSec, 0));
    const windowMin = Math.max(minEditable, rollingMin);
    return {
      minSec: windowMin,
      maxSec: Math.max(windowMin + 1, maxSec),
      scrubSec: Math.max(windowMin, Math.min(cursor, maxSec)),
    };
  }

  const liveMax = Math.max(historyEnd, cursor);
  return { minSec: 0, maxSec: Math.max(1, liveMax), scrubSec: cursor };
}

export function computeScrollCommitDecision({
  scrollState,
  scrubSec,
  historyEndSec,
  minEditableSec,
} = {}) {
  const state = scrollState && typeof scrollState === "object" ? scrollState : {};
  if (!state.editable) {
    return { allow: false, reason: "Read-only scroll" };
  }

  const scrub = toSafeSec(scrubSec, 0);
  const historyEnd = toSafeSec(historyEndSec, 0);
  const minEditable = toSafeSec(minEditableSec, 0);

  if (scrub > historyEnd) {
    return { allow: false, reason: "Forecast is preview-only" };
  }

  const absoluteRange = getAbsoluteEditableRangeFromScrollState(state);
  if (absoluteRange) {
    if (scrub < absoluteRange.minSec || scrub > absoluteRange.maxSec) {
      return { allow: false, reason: "Outside scroll editable range" };
    }
    return { allow: true };
  }

  if (scrub < minEditable) {
    return { allow: false, reason: "Outside editable history window" };
  }
  return { allow: true };
}

export function computeHistoryZoneSegments({
  minSec,
  maxSec,
  historyEndSec,
  baseMinEditableSec = 0,
  extraEditableRanges = [],
} = {}) {
  const min = toSafeSec(minSec, 0);
  const max = Math.max(min, toSafeSec(maxSec, min));
  const historyEnd = toSafeSec(historyEndSec, 0);
  const realizedEnd = Math.min(max, historyEnd);
  if (realizedEnd <= min) return [];

  const editableCandidates = [];
  const baseMin = toSafeSec(baseMinEditableSec, 0);
  if (historyEnd > baseMin) {
    editableCandidates.push({ minSec: baseMin, maxSec: historyEnd });
  }
  if (Array.isArray(extraEditableRanges)) {
    for (const range of extraEditableRanges) {
      const clipped = clipSecRange(range, min, realizedEnd);
      if (!clipped) continue;
      editableCandidates.push(clipped);
    }
  }

  const editableRanges = mergeSecRanges(
    editableCandidates
      .map((range) => clipSecRange(range, min, realizedEnd))
      .filter((range) => !!range)
  );

  if (!editableRanges.length) {
    return [{ kind: "fixedHistory", startSec: min, endSec: realizedEnd }];
  }

  const out = [];
  let cursor = min;
  for (const range of editableRanges) {
    if (range.minSec > cursor) {
      out.push({
        kind: "fixedHistory",
        startSec: cursor,
        endSec: range.minSec,
      });
    }
    out.push({
      kind: "editableHistory",
      startSec: range.minSec,
      endSec: range.maxSec,
    });
    cursor = Math.max(cursor, range.maxSec);
  }
  if (cursor < realizedEnd) {
    out.push({
      kind: "fixedHistory",
      startSec: cursor,
      endSec: realizedEnd,
    });
  }
  return out;
}
