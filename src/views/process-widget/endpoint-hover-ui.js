export function createEndpointHoverUi({
  canShowHoverUI,
  interaction,
  tooltipView,
  inventoryView,
  setHoverInventoryFocusOwners,
  setHoverOwnerFocus,
  getStateSafe,
  getDisplayObjectWorldScale,
  getInventoryOwnerAnchorRect,
  resolveHoverFocusFromOwnerIds,
  setProcessHoverContext,
} = {}) {
  let hoverInventoryOwnersSig = "";
  let hoverOwnerFocusSig = "";
  let activeHoveredInventoryOwnerIds = [];
  let lozengeTooltipVisible = false;

  function getTypedIdKey(id) {
    return `${typeof id}:${String(id)}`;
  }

  function dedupeOwnerIds(ownerIds) {
    const list = Array.isArray(ownerIds) ? ownerIds : [];
    const seen = new Set();
    const out = [];
    for (const ownerId of list) {
      if (ownerId == null) continue;
      const key = getTypedIdKey(ownerId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ownerId);
    }
    return out;
  }

  function getOwnerIdsSignature(ownerIds) {
    const keys = dedupeOwnerIds(ownerIds)
      .map((ownerId) => getTypedIdKey(ownerId))
      .sort((a, b) => a.localeCompare(b));
    return keys.join("|");
  }

  function setHoverInventoryOwners(ownerIds) {
    if (typeof setHoverInventoryFocusOwners !== "function") return;
    const normalized = dedupeOwnerIds(ownerIds);
    const nextSig = getOwnerIdsSignature(normalized);
    if (nextSig === hoverInventoryOwnersSig) return;
    hoverInventoryOwnersSig = nextSig;
    setHoverInventoryFocusOwners(normalized);
  }

  function getFocusSignature(focus) {
    if (!focus || typeof focus !== "object") return "";
    const ownerSig = Array.isArray(focus.ownerIds)
      ? getOwnerIdsSignature(focus.ownerIds)
      : "";
    const kind = String(focus.kind || "");
    const pawnId = focus.pawnId == null ? "" : String(focus.pawnId);
    const ownerId = focus.ownerId == null ? "" : String(focus.ownerId);
    const hubCol = Number.isFinite(focus.hubCol) ? String(Math.floor(focus.hubCol)) : "";
    const envCol = Number.isFinite(focus.envCol) ? String(Math.floor(focus.envCol)) : "";
    return `${kind}|${pawnId}|${ownerId}|${hubCol}|${envCol}|${ownerSig}`;
  }

  function setHoverOwnerFocusSafe(focus) {
    if (typeof setHoverOwnerFocus !== "function") return;
    const nextSig = getFocusSignature(focus);
    if (nextSig === hoverOwnerFocusSig) return;
    hoverOwnerFocusSig = nextSig;
    setHoverOwnerFocus(focus || null);
  }

  function hideHoveredInventoryWindows(ownerIds) {
    const normalized = dedupeOwnerIds(ownerIds);
    for (const ownerId of normalized) {
      inventoryView?.hideOnHoverOut?.(ownerId);
    }
  }

  function canShowLozengeHoverUi() {
    if (typeof canShowHoverUI === "function") {
      return canShowHoverUI() !== false;
    }
    return interaction?.canShowHoverUI?.() !== false;
  }

  function showLozengeTooltip(fullLabel, displayObject) {
    if (!tooltipView || !displayObject || !fullLabel) return;
    if (!canShowLozengeHoverUi()) return;
    tooltipView.show(
      {
        title: String(fullLabel),
        lines: [],
        scale: tooltipView?.getRelativeDisplayScale?.(displayObject, 1) ??
          getDisplayObjectWorldScale?.(displayObject, 1) ??
          1,
      },
      displayObject.getBounds()
    );
    lozengeTooltipVisible = true;
  }

  function syncLozengeHoverState(hoverSpec, state) {
    const spec = hoverSpec && typeof hoverSpec === "object" ? hoverSpec : {};
    const nextOwners = dedupeOwnerIds(spec.inventoryOwnerIds);
    const nextKeys = new Set(nextOwners.map((ownerId) => getTypedIdKey(ownerId)));
    const prevOwners = dedupeOwnerIds(activeHoveredInventoryOwnerIds);

    for (const prevOwnerId of prevOwners) {
      if (nextKeys.has(getTypedIdKey(prevOwnerId))) continue;
      inventoryView?.hideOnHoverOut?.(prevOwnerId);
    }
    for (const ownerId of nextOwners) {
      const anchor = getInventoryOwnerAnchorRect?.(state, ownerId) ?? null;
      inventoryView?.showOnHover?.(ownerId, anchor || undefined);
    }

    activeHoveredInventoryOwnerIds = nextOwners;
    setHoverInventoryOwners(nextOwners);
    setProcessHoverContext?.(spec.processContext || null);
    setHoverOwnerFocusSafe(
      spec.focus || resolveHoverFocusFromOwnerIds?.(state, nextOwners) || null
    );
  }

  function clearLozengeHoverUi() {
    hideHoveredInventoryWindows(activeHoveredInventoryOwnerIds);
    activeHoveredInventoryOwnerIds = [];
    setProcessHoverContext?.(null);
    setHoverInventoryOwners([]);
    setHoverOwnerFocusSafe(null);
    if (lozengeTooltipVisible) {
      tooltipView?.hide?.();
      lozengeTooltipVisible = false;
    }
  }

  function attachLozengeHoverHandlers(node, { fullLabel = "", hoverSpec = null } = {}) {
    if (!node) return;
    node.on("pointerover", () => {
      if (!canShowLozengeHoverUi()) return;
      const state = typeof getStateSafe === "function" ? getStateSafe() : null;
      showLozengeTooltip(fullLabel, node);
      syncLozengeHoverState(hoverSpec, state);
    });
    node.on("pointerout", () => {
      clearLozengeHoverUi();
    });
  }

  return {
    attachLozengeHoverHandlers,
    clearLozengeHoverUi,
  };
}
