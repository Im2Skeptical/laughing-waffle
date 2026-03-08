import { resolveAmount } from "../../core/amount.js";
import { cloneSerializable } from "../../core/clone.js";
import { resolveEffectDef } from "../../core/registry.js";
import { ensureSystemState } from "../../core/system-state.js";
import {
  getProcessDefForInstance,
  ensureProcessRoutingState,
} from "../../../process-framework.js";
import { resolveEffectTargets } from "./targets.js";
import {
  normalizeProcessRequirements,
  seedRoutingWithCandidates,
  ensureProcessRequirements,
} from "./work-process-routing.js";

function nowSecFrom(state, context) {
  return Number.isFinite(context?.tSec)
    ? Math.floor(context.tSec)
    : Math.floor(state?.tSec ?? 0);
}

export function handleCreateWorkProcess(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = resolveEffectTargets(state, effect, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    const systemState = ensureSystemState(target, systemId);
    const queueKey = effect.queueKey || "processes";
    if (!Array.isArray(systemState[queueKey])) systemState[queueKey] = [];

    const { defId, def } = resolveEffectDef(effect, target, context);

    // Input amount defaults to 1 only when omitted.
    // If an amount expression/input is explicitly provided and resolves to 0,
    // skip process creation (used by data-driven gating like ConsumeItem -> amountVar).
    let inputAmount = 1;
    let hasExplicitInputAmount = false;
    const amountRaw = resolveAmount(effect, systemState, def, context);
    if (Number.isFinite(amountRaw)) {
      inputAmount = Math.max(0, Math.floor(amountRaw));
      hasExplicitInputAmount = true;
    } else if (Number.isFinite(effect.inputAmount)) {
      inputAmount = Math.max(0, Math.floor(effect.inputAmount));
      hasExplicitInputAmount = true;
    }
    if (hasExplicitInputAmount && inputAmount <= 0) continue;

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

    if (Array.isArray(effect.requirements)) {
      const reqs = normalizeProcessRequirements(effect.requirements);
      if (reqs.length > 0) process.requirements = reqs;
    }

    if (effect.processMeta && typeof effect.processMeta === "object") {
      const meta = cloneSerializable(effect.processMeta);
      if (meta && typeof meta === "object") {
        for (const [key, value] of Object.entries(meta)) {
          if (Object.prototype.hasOwnProperty.call(process, key)) continue;
          process[key] = value;
        }
      }
    }

    if (Array.isArray(effect.outputs) && effect.outputs.length > 0) {
      process.outputs = effect.outputs.map((out) => ({ ...out }));
    }

    if (effect.completionEffects) {
      process.completionEffects = cloneSerializable(effect.completionEffects);
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

    if (process.ownerId == null) {
      process.ownerId =
        context?.ownerId ??
        (Number.isFinite(target?.instanceId) ? target.instanceId : null);
    }
    if (process.leaderId == null && Number.isFinite(context?.leaderId)) {
      process.leaderId = Math.floor(context.leaderId);
    }

    const processDef = getProcessDefForInstance(process, target, context);
    if (processDef) {
      const routingContext = { ...(context || {}), target, systemId };
      ensureProcessRoutingState(process, processDef, routingContext);
      seedRoutingWithCandidates(state, target, process, processDef, routingContext);
      ensureProcessRequirements(process, processDef);
    }

    systemState[queueKey].push(process);
    changed = true;
  }

  return changed;
}
