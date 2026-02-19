import { hasEnvTagUnlock, hasHubTagUnlock } from "../skills.js";

export function cmdSetTileTagOrder(state, { envCol, tagIds }) {
  if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
  if (!Array.isArray(tagIds)) return { ok: false, reason: "badTagIds" };

  const col = Math.floor(envCol);
  const tile = state.board?.occ?.tile?.[col];
  if (!tile) return { ok: false, reason: "noTile" };

  const unique = new Set();
  const ordered = [];
  for (const tag of tagIds) {
    if (typeof tag !== "string") return { ok: false, reason: "badTagId" };
    if (unique.has(tag)) return { ok: false, reason: "duplicateTag" };
    unique.add(tag);
    ordered.push(tag);
  }

  const existingTags = Array.isArray(tile.tags) ? tile.tags : [];
  const existingSet = new Set(existingTags);

  if (existingSet.size !== unique.size) {
    return { ok: false, reason: "tagSetMismatch" };
  }
  for (const tag of unique) {
    if (!existingSet.has(tag)) return { ok: false, reason: "tagSetMismatch" };
  }
  for (let i = 0; i < existingTags.length; i++) {
    const tagId = existingTags[i];
    if (hasEnvTagUnlock(state, tagId)) continue;
    if (ordered[i] !== tagId) return { ok: false, reason: "tagLocked" };
  }

  tile.tags = ordered;
  return { ok: true, result: "tagOrderSet", envCol: col };
}

export function cmdSetHubTagOrder(state, { hubCol, tagIds }) {
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  if (!Array.isArray(tagIds)) return { ok: false, reason: "badTagIds" };

  const col = Math.floor(hubCol);
  const structure = state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };

  const unique = new Set();
  const ordered = [];
  for (const tag of tagIds) {
    if (typeof tag !== "string") return { ok: false, reason: "badTagId" };
    if (unique.has(tag)) return { ok: false, reason: "duplicateTag" };
    unique.add(tag);
    ordered.push(tag);
  }

  const existingTags = Array.isArray(structure.tags) ? structure.tags : [];
  const existingSet = new Set(existingTags);

  if (existingSet.size !== unique.size) {
    return { ok: false, reason: "tagSetMismatch" };
  }
  for (const tag of unique) {
    if (!existingSet.has(tag)) return { ok: false, reason: "tagSetMismatch" };
  }
  for (let i = 0; i < existingTags.length; i++) {
    const tagId = existingTags[i];
    if (hasHubTagUnlock(state, tagId)) continue;
    if (ordered[i] !== tagId) return { ok: false, reason: "tagLocked" };
  }

  structure.tags = ordered;
  const anchorCol = Number.isFinite(structure.col) ? structure.col : col;
  return { ok: true, result: "hubTagOrderSet", hubCol: anchorCol };
}

function readTagDisableState(entry, source = "player") {
  const isObj = entry && typeof entry === "object";
  const disabledBy =
    isObj && entry.disabledBy && typeof entry.disabledBy === "object"
      ? entry.disabledBy
      : null;

  let playerDisabled = disabledBy?.player === true;
  let eventDisabledCount = Number.isFinite(disabledBy?.eventCount)
    ? Math.max(0, Math.floor(disabledBy.eventCount))
    : 0;

  if (!disabledBy && isObj && entry.disabled === true) {
    if (source === "event") eventDisabledCount = 1;
    else playerDisabled = true;
  }

  const disabled = playerDisabled || eventDisabledCount > 0;
  return { playerDisabled, eventDisabledCount, disabled };
}

function setTagDisabled(target, tagId, disabled, source = "player") {
  if (!target || !tagId) {
    return {
      changed: false,
      disabled: false,
      lockedByEvent: false,
      playerDisabled: false,
      eventDisabledCount: 0,
    };
  }

  const hasStates = target.tagStates && typeof target.tagStates === "object";
  const entry = hasStates ? target.tagStates[tagId] : null;
  const prev = readTagDisableState(entry, source);

  let playerDisabled = prev.playerDisabled;
  let eventDisabledCount = prev.eventDisabledCount;
  const nextDisabledFlag = disabled === true;

  if (source === "event") {
    if (nextDisabledFlag) {
      eventDisabledCount += 1;
    } else {
      eventDisabledCount = Math.max(0, eventDisabledCount - 1);
    }
  } else {
    playerDisabled = nextDisabledFlag;
  }

  const nextDisabled = playerDisabled || eventDisabledCount > 0;
  const mutatedMeta =
    playerDisabled !== prev.playerDisabled ||
    eventDisabledCount !== prev.eventDisabledCount;
  const changed = mutatedMeta || nextDisabled !== prev.disabled;

  if (nextDisabled) {
    if (!target.tagStates || typeof target.tagStates !== "object") {
      target.tagStates = {};
    }
    const nextEntry = entry && typeof entry === "object" ? entry : {};
    nextEntry.disabledBy = {
      player: playerDisabled === true,
      eventCount: eventDisabledCount,
    };
    nextEntry.disabled = true;
    target.tagStates[tagId] = nextEntry;
  } else if (entry && typeof entry === "object") {
    if (entry.disabled) delete entry.disabled;
    if (entry.disabledBy) delete entry.disabledBy;
    if (Object.keys(entry).length === 0) {
      delete target.tagStates[tagId];
    } else if (target.tagStates && typeof target.tagStates === "object") {
      target.tagStates[tagId] = entry;
    }
  } else if (target.tagStates && typeof target.tagStates === "object") {
    delete target.tagStates[tagId];
  }

  if (
    target.tagStates &&
    typeof target.tagStates === "object" &&
    Object.keys(target.tagStates).length === 0
  ) {
    delete target.tagStates;
  }

  return {
    changed,
    disabled: nextDisabled,
    lockedByEvent: eventDisabledCount > 0,
    playerDisabled: playerDisabled === true,
    eventDisabledCount,
  };
}

export function cmdToggleTileTag(state, { envCol, tagId, disabled } = {}) {
  if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
  if (typeof tagId !== "string" || !tagId.length) {
    return { ok: false, reason: "badTagId" };
  }

  const col = Math.floor(envCol);
  const tile = state.board?.occ?.tile?.[col];
  if (!tile) return { ok: false, reason: "noTile" };
  const tags = Array.isArray(tile.tags) ? tile.tags : [];
  if (!tags.includes(tagId)) return { ok: false, reason: "tagNotOnTile" };
  if (!hasEnvTagUnlock(state, tagId)) return { ok: false, reason: "tagLocked" };

  const currentState = readTagDisableState(tile?.tagStates?.[tagId], "player");
  const currentDisabled = currentState.disabled === true;
  const nextDisabled = typeof disabled === "boolean" ? disabled : !currentDisabled;
  if (!nextDisabled && currentState.eventDisabledCount > 0) {
    return {
      ok: false,
      reason: "tagLockedByEvent",
      envCol: col,
      tagId,
      disabled: true,
    };
  }
  const result = setTagDisabled(tile, tagId, nextDisabled, "player");

  return {
    ok: true,
    result: result.changed ? "tagToggled" : "tagUnchanged",
    envCol: col,
    tagId,
    disabled: result.disabled,
  };
}

export function cmdToggleHubTag(state, { hubCol, tagId, disabled } = {}) {
  if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
  if (typeof tagId !== "string" || !tagId.length) {
    return { ok: false, reason: "badTagId" };
  }

  const col = Math.floor(hubCol);
  const structure = state.hub?.occ?.[col] ?? state.hub?.slots?.[col]?.structure ?? null;
  if (!structure) return { ok: false, reason: "noHubStructure" };
  const tags = Array.isArray(structure.tags) ? structure.tags : [];
  if (!tags.includes(tagId)) return { ok: false, reason: "tagNotOnHub" };
  if (!hasHubTagUnlock(state, tagId)) return { ok: false, reason: "tagLocked" };

  const currentState = readTagDisableState(structure?.tagStates?.[tagId], "player");
  const currentDisabled = currentState.disabled === true;
  const nextDisabled = typeof disabled === "boolean" ? disabled : !currentDisabled;
  if (!nextDisabled && currentState.eventDisabledCount > 0) {
    return {
      ok: false,
      reason: "tagLockedByEvent",
      hubCol: col,
      tagId,
      disabled: true,
    };
  }
  const result = setTagDisabled(structure, tagId, nextDisabled, "player");

  const anchorCol = Number.isFinite(structure.col) ? structure.col : col;
  return {
    ok: true,
    result: result.changed ? "hubTagToggled" : "hubTagUnchanged",
    hubCol: anchorCol,
    tagId,
    disabled: result.disabled,
  };
}
