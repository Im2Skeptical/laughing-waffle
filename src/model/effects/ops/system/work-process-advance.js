import { envSystemDefs } from "../../../../defs/gamesystems/env-systems-defs.js";
import { clamp } from "../../core/clamp.js";
import { resolveEffectDef } from "../../core/registry.js";
import { ensureSystemState, getTierValueForSystem } from "../../core/system-state.js";
import { handleSpawnItem } from "../game-ops.js";
import { runEffect } from "../../index.js";
import {
  getProcessDefForInstance,
  ensureProcessRoutingState,
} from "../../../process-framework.js";
import { resolveEffectTargets } from "./targets.js";
import {
  areRequirementsComplete,
  ensureProcessRequirements,
  seedRoutingWithCandidates,
  advanceProcessRequirements,
  syncPresenceRequirements,
} from "./work-process-routing.js";
import { applyProcessOutputs } from "./work-process-outputs.js";
import {
  countEnvWorkers,
  resolveHubWorkers,
  applyWorkerCost,
  finalizeBuildProcess,
  rollQualityTier,
} from "./work-process-completion.js";
import { getPawnEffectiveWorkUnits } from "../../../prestige-system.js";

const TIER_KEYS = ["bronze", "silver", "gold", "diamond"];

function isTierBucket(pool) {
  if (!pool || typeof pool !== "object") return false;
  for (const tier of TIER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
  }
  return false;
}

function createTierBucket() {
  return { bronze: 0, silver: 0, gold: 0, diamond: 0 };
}

function ensureGrowthMaturedPoolBucket(pool, cropId) {
  if (!pool || typeof pool !== "object") return createTierBucket();
  if (typeof cropId !== "string" || cropId.length <= 0) {
    if (isTierBucket(pool)) {
      return pool;
    }
    if (!pool._unknown || typeof pool._unknown !== "object") {
      pool._unknown = createTierBucket();
    } else if (!isTierBucket(pool._unknown)) {
      pool._unknown = createTierBucket();
    }
    return pool._unknown;
  }
  if (!pool[cropId] || typeof pool[cropId] !== "object") {
    pool[cropId] = createTierBucket();
  } else if (!isTierBucket(pool[cropId])) {
    pool[cropId] = createTierBucket();
  }
  return pool[cropId];
}

function getProcessTypePriorityList(effect) {
  const raw = Array.isArray(effect?.processTypeList) ? effect.processTypeList : [];
  const out = [];
  for (const entry of raw) {
    const processType =
      typeof entry === "string" && entry.length > 0 ? entry : null;
    if (!processType) continue;
    if (out.includes(processType)) continue;
    out.push(processType);
  }
  return out;
}

function resetProcessForRepeat(process) {
  if (!process || typeof process !== "object") return false;
  let changed = false;
  if ((process.progress ?? 0) !== 0) {
    process.progress = 0;
    changed = true;
  }
  const requirements = Array.isArray(process.requirements) ? process.requirements : [];
  for (const req of requirements) {
    if (!req || typeof req !== "object") continue;
    if ((req.progress ?? 0) !== 0) {
      req.progress = 0;
      changed = true;
    }
  }
  return changed;
}

function runProcessCompletionEffects(state, target, process, context) {
  const completionEffects = process?.completionEffects;
  if (!completionEffects) return false;
  return runEffect(state, completionEffects, {
    ...(context || {}),
    source: target,
    ownerId:
      context?.ownerId ??
      process?.ownerId ??
      (Number.isFinite(target?.instanceId) ? target.instanceId : null),
    leaderId:
      context?.leaderId ??
      (Number.isFinite(process?.leaderId) ? Math.floor(process.leaderId) : null),
  });
}

function advanceSingleProcess({
  state,
  effect,
  context,
  target,
  systemState,
  systemId,
  process,
  deltaTime,
  poolKey,
} = {}) {
  if (!process) return { changed: false, keep: true, progressed: false };

  let changed = false;
  let progressed = false;

  const processDef = getProcessDefForInstance(process, target, context);
  if (processDef) {
    const routingContext = { ...(context || {}), target, systemId };
    ensureProcessRoutingState(process, processDef, routingContext);
    seedRoutingWithCandidates(state, target, process, processDef, routingContext);
    ensureProcessRequirements(process, processDef);
  }

  const durationSec = Math.max(1, Math.floor(process.durationSec ?? 0));
  const mode = process.mode === "work" ? "work" : "time";

  let inc = deltaTime;
  let hubWorkers = null;
  let reqRes = null;
  if (mode === "work") {
    if (typeof effect.workersFrom === "string") {
      const workersFrom = effect.workersFrom;
      let workers = 0;
      if (workersFrom === "envCol") {
        workers = countEnvWorkers(state, context?.envCol);
      } else if (workersFrom === "hubAnchor") {
        hubWorkers = resolveHubWorkers(state, target, context);
        workers = hubWorkers.reduce(
          (sum, worker) => sum + getPawnEffectiveWorkUnits(state, worker),
          0
        );
      } else {
        workers = 1;
      }
      inc = Math.max(0, Math.floor(workers));
    } else {
      const amtRaw = Number.isFinite(effect.amount) ? effect.amount : 1;
      inc = Math.max(0, Math.floor(amtRaw));
    }
  }

  if (!processDef && !areRequirementsComplete(process)) {
    return { changed, keep: true, progressed: false };
  }

  if (processDef) {
    const presenceRes = syncPresenceRequirements(
      state,
      target,
      process,
      processDef,
      context
    );
    if (presenceRes.changed) {
      changed = true;
      progressed = true;
    }
  }

  if (processDef && !areRequirementsComplete(process)) {
    reqRes = advanceProcessRequirements(
      state,
      target,
      process,
      processDef,
      inc,
      context
    );
    if (reqRes.changed) {
      changed = true;
      progressed = true;
    }
    if (!reqRes.done) {
      return { changed, keep: true, progressed };
    }
    const spentBudget = Math.max(0, Math.floor(reqRes.spentBudget ?? 0));
    inc = Math.max(0, inc - spentBudget);
  }

  const cur = Number.isFinite(process.progress) ? process.progress : 0;
  const next = cur + inc;
  if (next !== cur) {
    process.progress = next;
    changed = true;
    progressed = true;
  }

  if ((reqRes?.changed || next !== cur) && hubWorkers && effect.workerCost) {
    if (applyWorkerCost(hubWorkers, effect.workerCost)) {
      changed = true;
    }
  }

  if (next < durationSec) {
    return { changed, keep: true, progressed };
  }

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
        const poolKeyResolved = process.poolKey || poolKey;
        const pool =
          systemState[poolKeyResolved] &&
          typeof systemState[poolKeyResolved] === "object"
            ? systemState[poolKeyResolved]
            : {};
        if (systemState[poolKeyResolved] !== pool) {
          systemState[poolKeyResolved] = pool;
          changed = true;
        }
        const cropId =
          typeof process?.defId === "string" && process.defId.length > 0
            ? process.defId
            : typeof process?.cropId === "string" && process.cropId.length > 0
              ? process.cropId
              : null;
        const bucket = ensureGrowthMaturedPoolBucket(pool, cropId);
        for (let i = 0; i < maturedUnits; i++) {
          const tier = rollQualityTier(state, table);
          bucket[tier] = (bucket[tier] ?? 0) + 1;
        }
      }
    }
    if (runProcessCompletionEffects(state, target, process, context)) {
      changed = true;
    }
    changed = true;
    return { changed, keep: false, progressed: true };
  }

  if (policy === "build") {
    if (finalizeBuildProcess(state, target, process)) {
      changed = true;
    }
    if (runProcessCompletionEffects(state, target, process, context)) {
      changed = true;
    }
    return { changed, keep: false, progressed: true };
  }

  if (processDef) {
    if (applyProcessOutputs(state, target, process, processDef, context)) {
      changed = true;
    }
  } else if (Array.isArray(process.outputs)) {
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
    changed = true;
  }

  const shouldRepeat = policy === "repeat" || process.repeat === true;
  if (runProcessCompletionEffects(state, target, process, context)) {
    changed = true;
  }
  if (shouldRepeat) {
    if (resetProcessForRepeat(process)) {
      changed = true;
    }
    return { changed, keep: true, progressed: true };
  }

  return { changed, keep: false, progressed: true };
}

export function handleAdvanceWorkProcess(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = resolveEffectTargets(state, effect, context);
  if (!targets.length) return false;

  const deltaTime = Number.isFinite(effect.deltaSec)
    ? Math.max(1, Math.floor(effect.deltaSec))
    : 1;
  const processTypePriority = getProcessTypePriorityList(effect);

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

    const poolKey = effect.poolKey || "maturedPool";
    if (!systemState[poolKey] || typeof systemState[poolKey] !== "object") {
      const useGrowthMaturedPool =
        systemId === "growth" && String(poolKey) === "maturedPool";
      systemState[poolKey] = useGrowthMaturedPool ? {} : createTierBucket();
      changed = true;
    }

    if (processTypePriority.length > 0) {
      const removedProcessIds = new Set();
      for (const processType of processTypePriority) {
        const process = processes.find(
          (entry) =>
            entry &&
            entry.type === processType &&
            !removedProcessIds.has(entry.id)
        );
        if (!process) continue;
        const res = advanceSingleProcess({
          state,
          effect,
          context,
          target,
          systemState,
          systemId,
          process,
          deltaTime,
          poolKey,
        });
        if (res.changed) changed = true;
        if (!res.keep && process?.id != null) {
          removedProcessIds.add(process.id);
        }
        if (res.progressed) break;
      }

      if (removedProcessIds.size > 0) {
        systemState[queueKey] = processes.filter(
          (proc) => !removedProcessIds.has(proc?.id)
        );
        changed = true;
      }
      continue;
    }

    const nextQueue = [];
    for (const process of processes) {
      if (!process) continue;
      if (effect.processType && process.type !== effect.processType) {
        nextQueue.push(process);
        continue;
      }
      const res = advanceSingleProcess({
        state,
        effect,
        context,
        target,
        systemState,
        systemId,
        process,
        deltaTime,
        poolKey,
      });
      if (res.changed) changed = true;
      if (res.keep) {
        nextQueue.push(process);
      }
    }

    if (nextQueue.length !== processes.length) {
      systemState[queueKey] = nextQueue;
      changed = true;
    }
  }

  return changed;
}
