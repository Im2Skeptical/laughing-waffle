import { envEventDefs } from "../../../defs/gamepieces/env-events-defs.js";
import { resolveBoardTargets } from "../core/targets-board.js";

export function handleRemoveEvent(state, effect, context) {
  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  const anchors = state.board?.layers?.event?.anchors;
  if (!Array.isArray(anchors) || anchors.length === 0) return false;

  const targetIds = new Set();
  const targetRefs = new Set();
  for (const target of targets) {
    if (!target) continue;
    if (target.instanceId != null) targetIds.add(target.instanceId);
    else targetRefs.add(target);
  }

  const next = anchors.filter((anchor) => {
    if (!anchor) return true;
    if (anchor.instanceId != null && targetIds.has(anchor.instanceId)) {
      return false;
    }
    if (targetRefs.has(anchor)) return false;
    return true;
  });

  const removed = next.length !== anchors.length;
  if (removed) {
    anchors.length = 0;
    anchors.push(...next);
  }

  if (removed) state._boardDirty = true;
  return removed;
}

export function handleTransformEvent(state, effect, context) {
  const defId = effect.defId;
  if (!defId || typeof defId !== "string") return false;

  const def = envEventDefs[defId];
  if (!def) return false;

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  const nowSec = Number.isFinite(context?.tSec)
    ? Math.floor(context.tSec)
    : Math.floor(state.tSec ?? 0);

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    target.defId = defId;
    target.createdSec = nowSec;
    if (def.durationSec != null) {
      target.expiresSec = nowSec + def.durationSec;
    } else {
      delete target.expiresSec;
    }
    delete target.entered;
    changed = true;
  }

  return changed;
}
