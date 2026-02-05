import { envSystemDefs } from "../../../defs/gamesystems/env-systems-defs.js";
import { pawnSystemDefs } from "../../../defs/gamesystems/pawn-systems-defs.js";
import { hubSystemDefs } from "../../../defs/gamesystems/hub-system-defs.js";
import { itemSystemDefs } from "../../../defs/gamesystems/item-system-defs.js";
import { resolveAmount } from "../core/amount.js";
import { clamp } from "../core/clamp.js";
import { cloneSerializable } from "../core/clone.js";
import { resolveEffectDef } from "../core/registry.js";
import { ensureSystemState, getTierValueForSystem } from "../core/system-state.js";
import { resolveBoardTargets } from "../core/targets-board.js";
import { handleSpawnItem } from "./game-ops.js";

// Process refactor:
// - CreateWorkProcess: enqueue a process with progress tracking (time or work)
// - AdvanceWorkProcess: advance progress and complete when done
//
// This fully replaces CreateProcess / FinalizeProcess.

export function handleAddToSystemState(state, effect, context) {
  const systemId = effect.system;
  const key = effect.key;
  if (!systemId || typeof systemId !== "string") return false;
  if (!key || typeof key !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const { def } = resolveEffectDef(effect, target, context);
    const amount = resolveAmount(effect, systemState, def, context);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const current = Number.isFinite(systemState[key]) ? systemState[key] : 0;
    const next = current + amount;
    if (next !== current) {
      systemState[key] = next;
      changed = true;
    }
  }

  return changed;
}

export function handleClampSystemState(state, effect, context) {
  const systemId = effect.system;
  const key = effect.key;
  if (!systemId || typeof systemId !== "string") return false;
  if (!key || typeof key !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const value = Number.isFinite(systemState[key]) ? systemState[key] : 0;
    const minRaw = Number.isFinite(effect.min)
      ? effect.min
      : effect.minKey
        ? systemState[effect.minKey]
        : null;
    const maxRaw = Number.isFinite(effect.max)
      ? effect.max
      : effect.maxKey
        ? systemState[effect.maxKey]
        : null;
    const min = Number.isFinite(minRaw) ? minRaw : -Infinity;
    const max = Number.isFinite(maxRaw) ? maxRaw : Infinity;
    const next = clamp(value, min, max);
    if (next !== value) {
      systemState[key] = next;
      changed = true;
    }
  }

  return changed;
}

export function handleAccumulateRatio(state, effect, context) {
  const systemId = effect.system;
  const numeratorKey = effect.numeratorKey;
  const denominatorKey = effect.denominatorKey;
  const targetKey = effect.targetKey || "sumRatio";
  if (!systemId || typeof systemId !== "string") return false;
  if (!numeratorKey || typeof numeratorKey !== "string") return false;
  if (!denominatorKey || typeof denominatorKey !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const numerator = Number.isFinite(systemState[numeratorKey])
      ? systemState[numeratorKey]
      : 0;
    const denominator = Number.isFinite(systemState[denominatorKey])
      ? systemState[denominatorKey]
      : 0;
    let ratio = denominator > 0 ? numerator / denominator : 0;
    if (Number.isFinite(effect.min)) ratio = Math.max(effect.min, ratio);
    if (Number.isFinite(effect.max)) ratio = Math.min(effect.max, ratio);
    const current = Number.isFinite(systemState[targetKey])
      ? systemState[targetKey]
      : 0;
    systemState[targetKey] = current + ratio;
    changed = true;
  }

  return changed;
}

export function handleResetSystemState(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  const defaults =
    envSystemDefs[systemId]?.stateDefaults ??
    pawnSystemDefs[systemId]?.stateDefaults ??
    hubSystemDefs[systemId]?.stateDefaults ??
    itemSystemDefs[systemId]?.stateDefaults ??
    {};
  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    if (!target.systemState || typeof target.systemState !== "object") {
      target.systemState = {};
    }
    target.systemState[systemId] = cloneSerializable(defaults);
    changed = true;
  }

  return changed;
}

export function handleAdjustSystemState(state, effect, context) {
  const systemId = effect.system;
  const key = effect.key;
  if (!systemId || typeof systemId !== "string") return false;
  if (!key || typeof key !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const { def } = resolveEffectDef(effect, target, context);
    const deltaRaw = resolveAmount(effect, systemState, def, context);
    const delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;
    let percent = null;
    if (Number.isFinite(effect.percent)) percent = effect.percent;
    if (percent == null && effect.percentFromKey) {
      percent = systemState[effect.percentFromKey];
    }
    if (percent == null && effect.percentFromDefKey && def) {
      percent = def[effect.percentFromDefKey];
    }
    if (percent == null && effect.percentVar && context?.vars) {
      percent = context.vars[effect.percentVar];
    }
    if (!Number.isFinite(percent)) percent = 0;

    const current = Number.isFinite(systemState[key]) ? systemState[key] : 0;
    const nextRaw = current + delta + current * percent;
    const minRaw = Number.isFinite(effect.min)
      ? effect.min
      : effect.minKey
        ? systemState[effect.minKey]
        : null;
    const maxRaw = Number.isFinite(effect.max)
      ? effect.max
      : effect.maxKey
        ? systemState[effect.maxKey]
        : null;
    const min = Number.isFinite(minRaw) ? minRaw : -Infinity;
    const max = Number.isFinite(maxRaw) ? maxRaw : Infinity;
    const next = clamp(nextRaw, min, max);

    if (next !== current) {
      systemState[key] = next;
      changed = true;
    }
  }

  return changed;
}

function nowSecFrom(state, context) {
  return Number.isFinite(context?.tSec)
    ? Math.floor(context.tSec)
    : Math.floor(state?.tSec ?? 0);
}

// Process schema
// - mode: "time" (default) or "work"
// - progress: numeric (seconds or work units)
// - durationSec: required units until completion
// - completionPolicy: "cropGrowth" (built-in) or "none"

export function handleCreateWorkProcess(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const queueKey = effect.queueKey || "processes";
    if (!Array.isArray(systemState[queueKey])) systemState[queueKey] = [];

    const { defId, def } = resolveEffectDef(effect, target, context);

    // Allow defless processes (crafting). If def exists, inputAmount can be derived from amount expression;
    // otherwise allow explicit inputAmount or default to 1.
    let inputAmount = 1;
    if (def) {
      const amountRaw = resolveAmount(effect, systemState, def, context);
      inputAmount = Math.max(0, Math.floor(amountRaw ?? 0));
    } else if (Number.isFinite(effect.inputAmount)) {
      inputAmount = Math.max(0, Math.floor(effect.inputAmount));
    }
    if (inputAmount <= 0) inputAmount = 1;

    const durationRaw = Number.isFinite(effect.durationSec)
      ? effect.durationSec
      : effect.durationFromDefKey && def
        ? def[effect.durationFromDefKey]
        : null;
    const durationSec = Number.isFinite(durationRaw)
      ? Math.max(1, Math.floor(durationRaw))
      : null;
    if (!durationSec) continue;

    const type = effect.processType || effect.type || "process";
    if (effect.uniqueType === true) {
      const existing = systemState[queueKey].some((p) => p?.type === type);
      if (existing) continue;
    }

    const nowSec = nowSecFrom(state, context);
    const process = {
      id: `proc_${target.instanceId}_${nowSec}_${systemState[queueKey].length}`,
      type,
      mode: effect.mode === "work" ? "work" : "time",
      defRegistry: effect.defRegistry || effect.registry || null,
      defId,
      startSec: nowSec,
      durationSec,
      progress: 0,
      inputAmount,
      completionPolicy:
        effect.completionPolicy ||
        (type === "cropGrowth" ? "cropGrowth" : "none"),
      poolKey: effect.poolKey || "maturedPool",
    };

    if (Array.isArray(effect.outputs) && effect.outputs.length > 0) {
      process.outputs = effect.outputs.map((out) => ({ ...out }));
    }

    if (effect.captureSystem && effect.captureKey) {
      const captureState = ensureSystemState(target, effect.captureSystem);
      const captureValue = captureState[effect.captureKey];
      const outKey = effect.captureAs || effect.captureKey;
      if (outKey) {
        process[outKey] = Number.isFinite(captureValue)
          ? captureValue
          : captureValue ?? 0;
      }
    }

    systemState[queueKey].push(process);
    changed = true;
  }

  return changed;
}

function countEnvWorkers(state, envCol) {
  const col = Number.isFinite(envCol) ? Math.floor(envCol) : null;
  if (col == null) return 0;
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  let n = 0;
  for (const ch of chars) {
    if (!ch) continue;
    const c = Number.isFinite(ch.envCol) ? Math.floor(ch.envCol) : null;
    if (c === col) n++;
  }
  return n;
}

function countHubWorkers(state, structure) {
  if (!structure) return 0;
  const col = Number.isFinite(structure.col) ? Math.floor(structure.col) : null;
  const span =
    Number.isFinite(structure.span) && structure.span > 0
      ? Math.floor(structure.span)
      : Number.isFinite(structure.defaultSpan) && structure.defaultSpan > 0
        ? Math.floor(structure.defaultSpan)
        : 1;
  if (col == null) return 0;
  const maxCol = col + span - 1;
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  let n = 0;
  for (const ch of chars) {
    if (!ch) continue;
    if (Number.isFinite(ch.envCol)) continue; // env pawns are not in hub
    const c = Number.isFinite(ch.hubCol) ? Math.floor(ch.hubCol) : null;
    if (c == null) continue;
    if (c >= col && c <= maxCol) n++;
  }
  return n;
}

export function handleAdvanceWorkProcess(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = effect.target
    ? resolveBoardTargets(state, effect.target, context)
    : context?.source
      ? [context.source]
      : [];
  if (!targets.length) return false;

  const deltaTime = Number.isFinite(effect.deltaSec)
    ? Math.max(1, Math.floor(effect.deltaSec))
    : 1;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const queueKey = effect.queueKey || "processes";
    const existingQueue = systemState[queueKey];
    const processes = Array.isArray(existingQueue) ? existingQueue : [];
    if (!Array.isArray(existingQueue)) {
      systemState[queueKey] = processes;
      changed = true;
    }
    if (processes.length === 0) continue;

    // ensure pool exists for cropGrowth completion
    const poolKey = effect.poolKey || "maturedPool";
    if (!systemState[poolKey] || typeof systemState[poolKey] !== "object") {
      systemState[poolKey] = {
        bronze: 0,
        silver: 0,
        gold: 0,
        diamond: 0,
      };
    }

    const nextQueue = [];
    for (const process of processes) {
      if (!process) continue;
      if (effect.processType && process.type !== effect.processType) {
        nextQueue.push(process);
        continue;
      }

      const durationSec = Math.max(1, Math.floor(process.durationSec ?? 0));
      const mode = process.mode === "work" ? "work" : "time";

      let inc = deltaTime;
      if (mode === "work") {
        // If workersFrom is explicitly provided, use worker counting.
        // Otherwise, treat this as a per-pawn contribution call and use effect.amount.
        if (typeof effect.workersFrom === "string") {
          const workersFrom = effect.workersFrom;
          let workers = 0;
          if (workersFrom === "envCol") {
            workers = countEnvWorkers(state, context?.envCol);
          } else if (workersFrom === "hubAnchor") {
            workers = countHubWorkers(state, context?.source);
          } else {
            workers = 1;
          }
          inc = Math.max(0, Math.floor(workers));
        } else {
          const amtRaw = Number.isFinite(effect.amount) ? effect.amount : 1;
          inc = Math.max(0, Math.floor(amtRaw));
        }
      }

      const cur = Number.isFinite(process.progress) ? process.progress : 0;
      const next = cur + inc;
      if (next !== cur) {
        process.progress = next;
        changed = true;
      }

      if (next < durationSec) {
        nextQueue.push(process);
        continue;
      }

      // complete
      const policy = process.completionPolicy || "none";
      if (policy === "cropGrowth") {
        const { def } = resolveEffectDef(
          { defRegistry: process.defRegistry, defId: process.defId },
          target,
          context
        );
        if (def) {
          const hydrationTier = getTierValueForSystem(target, "hydration");
          const fertilityTier = getTierValueForSystem(target, "fertility");
          const hydrationState = target.systemState?.hydration || {};
          const sumRatio = Number.isFinite(hydrationState.sumRatio)
            ? hydrationState.sumRatio
            : 0;
          const sumAtStart = Number.isFinite(process.sumAtStart)
            ? process.sumAtStart
            : 0;
          const rAvg = clamp((sumRatio - sumAtStart) / durationSec, 0, 1);

          const curveSource = envSystemDefs[systemId];
          const curveByTier = curveSource?.hydrationCurveByTier || null;
          const curve =
            curveByTier?.[hydrationTier] ||
            curveByTier?.silver ||
            { A: 1, P: 1 };
          const factor =
            (Number.isFinite(curve?.A) ? curve.A : 1) *
            Math.pow(rAvg, Number.isFinite(curve?.P) ? curve.P : 1);

          const inputAmount = Math.max(0, Math.floor(process.inputAmount ?? 0));
          const baseYield = Number.isFinite(def.baseYieldMultiplier)
            ? def.baseYieldMultiplier
            : 1;
          const maturedUnits = Math.floor(inputAmount * baseYield * factor);
          if (maturedUnits > 0) {
            const table =
              def?.qualityTablesByFertilityTier?.[fertilityTier] ??
              def?.qualityTablesByFertilityTier?.silver ??
              [];
            const pool = systemState[process.poolKey || poolKey];
            for (let i = 0; i < maturedUnits; i++) {
              const tier = rollQualityTier(state, table);
              pool[tier] = (pool[tier] ?? 0) + 1;
            }
          }
        }
        changed = true;
      } else {
        // policy === "none": just drop the process
        if (Array.isArray(process.outputs)) {
          for (const out of process.outputs) {
            if (!out?.kind) continue;
            handleSpawnItem(
              state,
              {
                op: "SpawnItem",
                itemKind: out.kind,
                amount: Number.isFinite(out.qty) ? out.qty : 1,
                perOwner: true,
                target: { kind: "tileOccupants" },
              },
              context
            );
          }
        }
        changed = true;
      }
    }

    if (nextQueue.length !== processes.length) {
      systemState[queueKey] = nextQueue;
      changed = true;
    }
  }

  return changed;
}

function rollQualityTier(state, table) {
  const entries = Array.isArray(table) ? table : [];
  if (!entries.length || typeof state?.rngNextFloat !== "function") {
    return "bronze";
  }

  let total = 0;
  for (const entry of entries) {
    total += Number.isFinite(entry?.weight) ? Math.max(0, entry.weight) : 0;
  }
  if (total <= 0) return "bronze";

  const roll = state.rngNextFloat() * total;
  let acc = 0;
  for (const entry of entries) {
    const weight = Number.isFinite(entry?.weight) ? Math.max(0, entry.weight) : 0;
    acc += weight;
    if (roll < acc) return entry?.tier ?? "bronze";
  }
  return entries[entries.length - 1]?.tier ?? "bronze";
}
