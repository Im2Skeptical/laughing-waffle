// behaviors.js — behaviors return EffectOps (no side channels)

import { envCardDefs, permanentDefs } from "../defs/gamepieces/gamepieces-defs.js";

export const behaviorHandlers = {
  TimedTrigger: handleTimedTrigger,
  TimedLife: handleTimedLife,
  HasPool: handleHasPool,
  TimedTransform: handleTimedTransform,
};

export const triggerHandlers = {
  MineFuel: handleMineFuelTrigger,
};

// Deterministic safety cap: max trigger firings per instance per update tick.
// Keeps gameplay stable under large dt (e.g. tab-away), without RNG.
const MAX_TIMED_TRIGGER_FIRES_PER_UPDATE = 8;

// ctx (optional):
// - { kind: "permanent", slotIndex: number } for permanent slots
// - { kind: "env" } for env slots
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
    if (!ctx || ctx.kind !== "permanent") return false;
    const slotIndex = ctx.slotIndex;
    if (typeof slotIndex !== "number") return false;

    const hasChar = state.characters?.some((c) => c.slotIndex === slotIndex);
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

  const targetKind = ctx?.kind === "permanent" ? "permanent" : "env";
  const slotIndex = ctx?.kind === "permanent" ? ctx.slotIndex : undefined;

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

  const setTimerOp = {
    op: "SetProp",
    targetKind,
    prop: timerKey,
    value: newTimer,
  };
  if (slotIndex != null) setTimerOp.slotIndex = slotIndex;

  if (ops.length === 0) return setTimerOp;
  ops.push(setTimerOp);
  return ops;
}

function handleTimedLife(entity, def, props, dt, state, ctx) {
  const eprops = entity.props;
  const { timerKey } = props;
  if (!timerKey || eprops[timerKey] == null) return null;

  const targetKind = ctx?.kind === "permanent" ? "permanent" : "env";
  const slotIndex = ctx?.kind === "permanent" ? ctx.slotIndex : undefined;

  const timer = eprops[timerKey] - dt;
  if (timer <= 0) {
    return { op: "KillEnv" };
  }

  const op = { op: "SetProp", targetKind, prop: timerKey, value: timer };
  if (slotIndex != null) op.slotIndex = slotIndex;
  return op;
}

function handleHasPool() {
  return null;
}

function handleTimedTransform(entity, def, props, dt, state, ctx) {
  const eprops = entity.props;
  const { timerKey, targetDefId } = props;
  if (!timerKey || !targetDefId || eprops[timerKey] == null) return null;

  const targetKind = ctx?.kind === "permanent" ? "permanent" : "env";
  const slotIndex = ctx?.kind === "permanent" ? ctx.slotIndex : undefined;

  const timer = eprops[timerKey] - dt;
  if (timer <= 0) {
    return { op: "TransformEnv", targetDefId };
  }

  const op = { op: "SetProp", targetKind, prop: timerKey, value: timer };
  if (slotIndex != null) op.slotIndex = slotIndex;
  return op;
}

// =============================================================================
// Trigger handlers (return ops)
// =============================================================================

function handleMineFuelTrigger(entity, def, state) {
  const baseGold = def.baseOutput?.gold || 0;

  const rockSlotIndexes = [];
  for (let i = 0; i < state.envSlots.length; i++) {
    const s = state.envSlots[i];
    const env = s.env;
    if (!env) continue;
    const envDef = envCardDefs[env.defId];
    if (envDef.tags?.includes("fuelSource:rock") && env.props.pool > 0) {
      rockSlotIndexes.push(i);
    }
  }

  if (rockSlotIndexes.length === 0) return null;

  const ops = [];

  ops.push({
    op: "AddResource",
    resource: "gold",
    amount: baseGold * rockSlotIndexes.length,
  });

  for (const envSlotIndex of rockSlotIndexes) {
    ops.push({
      op: "AddEnvProp",
      targetKind: "env",
      envSlotIndex,
      prop: "pool",
      amount: -1,
      min: 0,
      killIfZero: true,
    });
  }

  return ops;
}

// =============================================================================

export function resetTimedTriggersOnPermanents(state) {
  const ops = [];

  for (
    let slotIndex = 0;
    slotIndex < state.permanentSlots.length;
    slotIndex++
  ) {
    const slot = state.permanentSlots[slotIndex];
    const perm = slot.permanent;
    if (!perm) continue;

    const def = permanentDefs[perm.defId];
    if (!def?.behaviors) continue;

    for (const beh of def.behaviors) {
      if (beh.kind !== "TimedTrigger") continue;

      const { timerKey, periodKey, defaultPeriod } = beh.props || {};
      if (!timerKey || !periodKey) continue;

      const pprops = perm.props;
      const newPeriod =
        typeof pprops[periodKey] === "number"
          ? pprops[periodKey]
          : defaultPeriod;

      if (typeof newPeriod === "number") {
        ops.push({
          op: "SetProp",
          targetKind: "permanent",
          slotIndex,
          prop: periodKey,
          value: newPeriod,
        });
        ops.push({
          op: "SetProp",
          targetKind: "permanent",
          slotIndex,
          prop: timerKey,
          value: newPeriod,
        });
      }
    }
  }

  return ops;
}

