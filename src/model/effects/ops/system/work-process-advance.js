import { envSystemDefs } from "../../../../defs/gamesystems/env-systems-defs.js";
import { clamp } from "../../core/clamp.js";
import { resolveEffectDef } from "../../core/registry.js";
import { ensureSystemState, getTierValueForSystem } from "../../core/system-state.js";
import { handleSpawnItem } from "../game-ops.js";
import {
  getProcessDefForInstance,
  ensureProcessRoutingState,
} from "../../../process-framework.js";
import { resolveEffectTargets } from "./targets.js";
import {
  areRequirementsComplete,
  ensureProcessRequirements,
  ensureProcessDropboxInventory,
  seedRoutingWithCandidates,
  advanceProcessRequirements,
} from "./work-process-routing.js";
import { applyProcessOutputs } from "./work-process-outputs.js";
import {
  countEnvWorkers,
  resolveHubWorkers,
  applyWorkerCost,
  finalizeBuildProcess,
  rollQualityTier,
} from "./work-process-completion.js";

export function handleAdvanceWorkProcess(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = resolveEffectTargets(state, effect, context);
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

      const processDef = getProcessDefForInstance(process, target, context);
      if (processDef) {
        const routingContext = { ...(context || {}), target, systemId };
        ensureProcessRoutingState(process, processDef, routingContext);
        seedRoutingWithCandidates(state, target, process, processDef, routingContext);
        ensureProcessRequirements(process, processDef);
        ensureProcessDropboxInventory(state, process, processDef);
      }

      const durationSec = Math.max(1, Math.floor(process.durationSec ?? 0));
      const mode = process.mode === "work" ? "work" : "time";

      let inc = deltaTime;
      let hubWorkers = null;
      if (mode === "work") {
        // If workersFrom is explicitly provided, use worker counting.
        // Otherwise, treat this as a per-pawn contribution call and use effect.amount.
        if (typeof effect.workersFrom === "string") {
          const workersFrom = effect.workersFrom;
          let workers = 0;
          if (workersFrom === "envCol") {
            workers = countEnvWorkers(state, context?.envCol);
          } else if (workersFrom === "hubAnchor") {
            hubWorkers = resolveHubWorkers(state, target, context);
            workers = hubWorkers.length;
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
        nextQueue.push(process);
        continue;
      }
      if (processDef && !areRequirementsComplete(process)) {
        const reqRes = advanceProcessRequirements(
          state,
          target,
          process,
          processDef,
          inc,
          context
        );
        if (reqRes.changed) changed = true;
        if (!reqRes.done) {
          nextQueue.push(process);
          continue;
        }
      }

      const cur = Number.isFinite(process.progress) ? process.progress : 0;
      const next = cur + inc;
      if (next !== cur) {
        process.progress = next;
        changed = true;
      }

      if (next !== cur && hubWorkers && effect.workerCost) {
        if (applyWorkerCost(hubWorkers, effect.workerCost)) {
          changed = true;
        }
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
      } else if (policy === "build") {
        if (finalizeBuildProcess(state, target, process)) {
          changed = true;
        }
      } else {
        // policy === "none": apply outputs via routing
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
      }
    }

    if (nextQueue.length !== processes.length) {
      systemState[queueKey] = nextQueue;
      changed = true;
    }
  }

  return changed;
}
