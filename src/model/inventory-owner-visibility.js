import {
  parseBasketDropboxOwnerId,
  parseHubDropboxOwnerId,
  parseProcessDropboxOwnerId,
} from "./owner-id-protocol.js";
import { isHubVisible } from "./state.js";

function findProcessInTarget(target, processId) {
  if (!target?.systemState || !processId) return null;
  for (const sysState of Object.values(target.systemState)) {
    const processes = Array.isArray(sysState?.processes) ? sysState.processes : [];
    for (const process of processes) {
      if (process?.id === processId) return target;
    }
  }
  return null;
}

function findProcessTargetById(state, processId) {
  if (!state || !processId) return null;

  const hubAnchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  for (const anchor of hubAnchors) {
    const found = findProcessInTarget(anchor, processId);
    if (found) return found;
  }

  const hubSlots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of hubSlots) {
    const found = findProcessInTarget(slot?.structure ?? null, processId);
    if (found) return found;
  }

  const tileAnchors = Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
  for (const anchor of tileAnchors) {
    const found = findProcessInTarget(anchor, processId);
    if (found) return found;
  }

  return null;
}

function resolveOwnerContext(state, ownerId, seen = new Set()) {
  if (!state || ownerId == null) {
    return {
      ownerKind: "other",
      resolvedOwnerId: ownerId ?? null,
    };
  }

  const seenKey = String(ownerId);
  if (seen.has(seenKey)) {
    return {
      ownerKind: "other",
      resolvedOwnerId: ownerId,
    };
  }
  seen.add(seenKey);

  const basketOwner = parseBasketDropboxOwnerId(ownerId);
  if (basketOwner?.ownerId != null) {
    return resolveOwnerContext(state, basketOwner.ownerId, seen);
  }

  const hubOwnerId = parseHubDropboxOwnerId(ownerId);
  if (hubOwnerId != null) {
    return resolveOwnerContext(state, hubOwnerId, seen);
  }

  const processId = parseProcessDropboxOwnerId(ownerId);
  if (processId != null) {
    const target = findProcessTargetById(state, processId);
    if (target?.instanceId != null) {
      return resolveOwnerContext(state, target.instanceId, seen);
    }
  }

  const hubAnchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  for (const anchor of hubAnchors) {
    if (String(anchor?.instanceId) === seenKey) {
      return {
        ownerKind: "hub",
        resolvedOwnerId: anchor.instanceId,
      };
    }
  }

  const hubSlots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of hubSlots) {
    const structure = slot?.structure ?? null;
    if (String(structure?.instanceId) === seenKey) {
      return {
        ownerKind: "hub",
        resolvedOwnerId: structure.instanceId,
      };
    }
  }

  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  for (const pawn of pawns) {
    if (String(pawn?.id) === seenKey) {
      return {
        ownerKind: "pawn",
        resolvedOwnerId: pawn.id,
      };
    }
  }

  return {
    ownerKind: "other",
    resolvedOwnerId: ownerId,
  };
}

export function getInventoryOwnerVisibility(state, ownerId) {
  const context = resolveOwnerContext(state, ownerId);
  if (context.ownerKind === "hub" && !isHubVisible(state)) {
    return {
      visible: false,
      reason: "hubHidden",
      ownerKind: context.ownerKind,
      resolvedOwnerId: context.resolvedOwnerId,
    };
  }
  return {
    visible: true,
    reason: null,
    ownerKind: context.ownerKind,
    resolvedOwnerId: context.resolvedOwnerId,
  };
}
