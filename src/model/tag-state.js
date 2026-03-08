export function readTagDisableState(entry, source = "event") {
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

export function setTagDisabled(target, tagId, disabled, source = "event") {
  if (!target || !tagId) return false;
  const entry =
    target.tagStates && typeof target.tagStates === "object"
      ? target.tagStates[tagId]
      : null;
  const prev = readTagDisableState(entry, source);

  let playerDisabled = prev.playerDisabled;
  let eventDisabledCount = prev.eventDisabledCount;
  const nextDisabledFlag = disabled === true;
  if (source === "event") {
    if (nextDisabledFlag) eventDisabledCount += 1;
    else eventDisabledCount = Math.max(0, eventDisabledCount - 1);
  } else {
    playerDisabled = nextDisabledFlag;
  }

  const nextDisabled = playerDisabled || eventDisabledCount > 0;
  const changed =
    nextDisabled !== prev.disabled ||
    playerDisabled !== prev.playerDisabled ||
    eventDisabledCount !== prev.eventDisabledCount;

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

  cleanupTagStates(target);
  return changed;
}

export function readTagHiddenState(entry, source = "discovery") {
  const isObj = entry && typeof entry === "object";
  const hiddenBy =
    isObj && entry.hiddenBy && typeof entry.hiddenBy === "object"
      ? entry.hiddenBy
      : null;

  let discoveryHidden = hiddenBy?.discovery === true;
  let otherHidden = hiddenBy?.other === true;

  if (!hiddenBy && isObj && entry.hidden === true) {
    if (source === "discovery") discoveryHidden = true;
    else otherHidden = true;
  }

  const hidden = discoveryHidden || otherHidden;
  return { discoveryHidden, otherHidden, hidden };
}

export function setTagHidden(target, tagId, hidden, source = "discovery") {
  if (!target || !tagId) return false;
  const entry =
    target.tagStates && typeof target.tagStates === "object"
      ? target.tagStates[tagId]
      : null;
  const prev = readTagHiddenState(entry, source);

  let discoveryHidden = prev.discoveryHidden;
  let otherHidden = prev.otherHidden;
  const nextHiddenFlag = hidden === true;
  if (source === "discovery") discoveryHidden = nextHiddenFlag;
  else otherHidden = nextHiddenFlag;

  const nextHidden = discoveryHidden || otherHidden;
  const changed =
    nextHidden !== prev.hidden ||
    discoveryHidden !== prev.discoveryHidden ||
    otherHidden !== prev.otherHidden;

  if (nextHidden) {
    if (!target.tagStates || typeof target.tagStates !== "object") {
      target.tagStates = {};
    }
    const nextEntry = entry && typeof entry === "object" ? entry : {};
    nextEntry.hiddenBy = {
      discovery: discoveryHidden === true,
      other: otherHidden === true,
    };
    nextEntry.hidden = true;
    target.tagStates[tagId] = nextEntry;
  } else if (entry && typeof entry === "object") {
    if (entry.hidden) delete entry.hidden;
    if (entry.hiddenBy) delete entry.hiddenBy;
    if (Object.keys(entry).length === 0) {
      delete target.tagStates[tagId];
    } else if (target.tagStates && typeof target.tagStates === "object") {
      target.tagStates[tagId] = entry;
    }
  } else if (target.tagStates && typeof target.tagStates === "object") {
    delete target.tagStates[tagId];
  }

  cleanupTagStates(target);
  return changed;
}

export function isTagHidden(target, tagId, source = "discovery") {
  if (!target || !tagId) return false;
  const entry = target.tagStates?.[tagId];
  return readTagHiddenState(entry, source).hidden;
}

function cleanupTagStates(target) {
  if (
    target?.tagStates &&
    typeof target.tagStates === "object" &&
    Object.keys(target.tagStates).length === 0
  ) {
    delete target.tagStates;
  }
}
