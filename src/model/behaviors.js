// behaviors.js — behaviors return EffectOps (no side channels)

import { hubStructureDefs } from "../defs/gamepieces/hub-structures-defs.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";

export const behaviorHandlers = {
  TimedTrigger: handleTimedTrigger,
  HasPool: handleHasPool,
};

export const triggerHandlers = {
  MineFuel: handleMineFuelTrigger,
};

// Deterministic safety cap: max trigger firings per instance per update tick.
// Keeps gameplay stable under large dt (e.g. tab-away), without RNG.
const MAX_TIMED_TRIGGER_FIRES_PER_UPDATE = 8;

// ctx (optional):
// - { kind: "hub", hubCol: number } for hub slots
export function runBehaviorsOnInstance(instance, def, dt, state, ctx = null) {
  const ops = [];

  for (const beh of def.behaviors || []) {
    if (!preconditionsPass(beh, state, ctx)) continue;

    const handler = behaviorHandlers[beh.kind];
    if (!handler) continue;

    const out = handler(instance, def, beh.props || {}, dt, state, ctx);
    if (!out) continue;

    if (Array.isArray(out)) ops.push(...out);
    else ops.push(out);
  }

  return ops;
}

function preconditionsPass(beh, state, ctx) {
  if (beh.requiresOccupant) {
    if (!ctx || ctx.kind !== "hub") return false;
    const hubCol = ctx.hubCol;
    if (typeof hubCol !== "number") return false;

    const hasChar = state.characters?.some(
      (c) =>
        Number.isFinite(c.hubCol) &&
        c.envCol == null &&
        c.hubCol === hubCol
    );
    if (!hasChar) return false;
  }

  return true;
}

// =============================================================================
// Behavior handlers
// =============================================================================

function handleTimedTrigger(entity, def, props, dt, state, ctx) {
  const eprops = entity.props;
  const { timerKey, periodKey, triggerId } = props;
  if (!timerKey || !periodKey || !triggerId) return null;

  const period = eprops[periodKey];
  const startTimer = eprops[timerKey];
  if (startTimer == null || period == null) return null;
  if (typeof period !== "number" || !Number.isFinite(period) || period <= 0)
    return null;
  if (typeof startTimer !== "number" || !Number.isFinite(startTimer))
    return null;

  const isHub = ctx?.kind === "hub";
  const hubCol = isHub ? ctx.hubCol : null;
  if (isHub && typeof hubCol !== "number") return null;

  // Compute fires deterministically, with a cap.
  const timerAfter = startTimer - dt;

  let fireCount = 0;
  if (timerAfter <= 0) {
    // fires = 1 + floor((-timerAfter) / period)
    const rawFires = 1 + Math.floor(-timerAfter / period);
    fireCount = Math.min(rawFires, MAX_TIMED_TRIGGER_FIRES_PER_UPDATE);
  }

  const ops = [];

  if (fireCount > 0) {
    const trig = triggerHandlers[triggerId];
    if (trig) {
      for (let i = 0; i < fireCount; i++) {
        const out = trig(entity, def, state);
        if (out) ops.push(...(Array.isArray(out) ? out : [out]));
      }
    }
  }

  // Persist updated timer via effect op (no direct prop mutation here).
  // If capped, the timer may remain <= 0, which will cause additional firings
  // over subsequent frames, bounded by the same cap (deterministic backpressure).
  const newTimer = timerAfter + fireCount * period;

  const setTimerOp = { op: "SetProp", prop: timerKey, value: newTimer };
  if (isHub) setTimerOp.target = { at: { layer: "hub", col: hubCol } };

  if (ops.length === 0) return setTimerOp;
  ops.push(setTimerOp);
  return ops;
}

function handleHasPool() {
  return null;
}

// =============================================================================
// Trigger handlers (return ops)
// =============================================================================

function handleMineFuelTrigger(entity, def, state) {
  const baseGold = def.baseOutput?.gold || 0;
  if (!baseGold) return null;

  const anchors = Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];

  let mineableCount = 0;
  for (const tile of anchors) {
    if (!tile) continue;
    const tags = Array.isArray(tile.tags)
      ? tile.tags
      : Array.isArray(envTileDefs[tile.defId]?.baseTags)
        ? envTileDefs[tile.defId].baseTags
        : [];
    if (tags.includes("mineable")) mineableCount += 1;
  }

  if (mineableCount <= 0) return null;

  return {
    op: "AddResource",
    resource: "gold",
    amount: baseGold * mineableCount,
  };
}

// =============================================================================

export function resetTimedTriggersOnHubStructures(state) {
  const ops = [];

  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (let hubCol = 0; hubCol < slots.length; hubCol++) {
    const slot = slots[hubCol];
    const structure = slot.structure;
    if (!structure) continue;

    const def = hubStructureDefs[structure.defId];
    if (!def?.behaviors) continue;

    for (const beh of def.behaviors) {
      if (beh.kind !== "TimedTrigger") continue;

      const { timerKey, periodKey, defaultPeriod } = beh.props || {};
      if (!timerKey || !periodKey) continue;

      const pprops = structure.props;
      const newPeriod =
        typeof pprops[periodKey] === "number"
          ? pprops[periodKey]
          : defaultPeriod;

      if (typeof newPeriod === "number") {
        ops.push({
          op: "SetProp",
          target: { at: { layer: "hub", col: hubCol } },
          prop: periodKey,
          value: newPeriod,
        });
        ops.push({
          op: "SetProp",
          target: { at: { layer: "hub", col: hubCol } },
          prop: timerKey,
          value: newPeriod,
        });
      }
    }
  }

  return ops;
}

