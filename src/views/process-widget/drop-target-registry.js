export function createDropTargetRegistry({
  getWindowEntries,
  isDropboxOwnerId,
} = {}) {
  const dropboxDragAffordanceByOwnerId = new Map();

  function eachDropTarget(callback) {
    if (typeof callback !== "function") return;
    if (typeof getWindowEntries !== "function") return;
    for (const [, win] of getWindowEntries()) {
      for (const target of win?.dropTargets || []) {
        callback(target, win);
      }
    }
  }

  function getDropTargetOwnerAtGlobalPos(globalPos) {
    if (!globalPos) return null;
    if (typeof getWindowEntries !== "function") return null;
    for (const [, win] of getWindowEntries()) {
      if (!win?.container) continue;
      for (const target of win.dropTargets || []) {
        if (!target || typeof target.getBounds !== "function") continue;
        const bounds = target.getBounds();
        if (
          globalPos.x >= bounds.x &&
          globalPos.x <= bounds.x + bounds.width &&
          globalPos.y >= bounds.y &&
          globalPos.y <= bounds.y + bounds.height
        ) {
          return target.ownerId;
        }
      }
    }
    return null;
  }

  function setDropboxDragAffordance(ownerId, level = "neutral") {
    if (typeof isDropboxOwnerId === "function" && !isDropboxOwnerId(ownerId)) {
      return false;
    }
    const resolvedLevel =
      level === "valid" || level === "invalid" || level === "capped"
        ? level
        : "neutral";
    dropboxDragAffordanceByOwnerId.set(ownerId, resolvedLevel);
    let updated = false;
    eachDropTarget((target) => {
      if (!target || String(target.ownerId) !== String(ownerId)) return;
      target.setAffordance?.(resolvedLevel);
      updated = true;
    });
    return updated;
  }

  function clearDropboxDragAffordance(ownerId = null) {
    if (ownerId == null) {
      dropboxDragAffordanceByOwnerId.clear();
      eachDropTarget((target) => {
        target?.clearAffordance?.();
      });
      return;
    }
    dropboxDragAffordanceByOwnerId.delete(ownerId);
    eachDropTarget((target) => {
      if (!target || String(target.ownerId) !== String(ownerId)) return;
      target.clearAffordance?.();
    });
  }

  function flashDropTargetError(ownerId) {
    if (ownerId == null) return false;
    let flashed = false;
    eachDropTarget((target, win) => {
      if (!win?.container || !target) return;
      if (String(target.ownerId) !== String(ownerId)) return;
      if (typeof target.flashError === "function") {
        target.flashError();
        flashed = true;
      }
    });
    return flashed;
  }

  function getDropboxDragAffordance(ownerId) {
    return dropboxDragAffordanceByOwnerId.get(ownerId) ?? null;
  }

  function pruneAffordanceOwnersForWindow(windowId, removedDropTargets = []) {
    for (const target of removedDropTargets) {
      const ownerId = target?.ownerId;
      if (
        typeof isDropboxOwnerId === "function" &&
        !isDropboxOwnerId(ownerId)
      ) {
        continue;
      }
      if (typeof getWindowEntries !== "function") continue;
      const ownerStillReferenced = Array.from(getWindowEntries()).some(
        ([otherId, otherWin]) =>
          otherId !== windowId &&
          Array.isArray(otherWin?.dropTargets) &&
          otherWin.dropTargets.some(
            (candidate) => String(candidate?.ownerId) === String(ownerId)
          )
      );
      if (!ownerStillReferenced) {
        dropboxDragAffordanceByOwnerId.delete(ownerId);
      }
    }
  }

  return {
    getDropTargetOwnerAtGlobalPos,
    setDropboxDragAffordance,
    clearDropboxDragAffordance,
    flashDropTargetError,
    getDropboxDragAffordance,
    pruneAffordanceOwnersForWindow,
  };
}
