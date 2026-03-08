import { envTagDefs } from "../../../defs/gamesystems/env-tags-defs.js";
import { envSystemDefs } from "../../../defs/gamesystems/env-systems-defs.js";
import { cloneSerializable } from "../core/clone.js";
import { getSystemTierLadder } from "../core/system-state.js";
import { resolveBoardTargets } from "../core/targets-board.js";
import { setTagDisabled, setTagHidden } from "../../tag-state.js";

export function handleAddTag(state, effect, context) {
  const tagId = effect.tag;
  if (!tagId || typeof tagId !== "string") return false;

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    if (!Array.isArray(target.tags)) target.tags = [];
    if (target.tags.includes(tagId)) continue;

    target.tags.push(tagId);
    changed = true;

    const tagDef = envTagDefs[tagId];
    const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
    if (systems.length === 0) continue;

    if (!target.systemTiers || typeof target.systemTiers !== "object") {
      target.systemTiers = {};
    }
    if (!target.systemState || typeof target.systemState !== "object") {
      target.systemState = {};
    }

    for (const systemId of systems) {
      if (target.systemTiers[systemId] != null) continue;
      const sysDef = envSystemDefs[systemId];
      if (!sysDef) continue;
      if (sysDef.defaultTier != null) {
        target.systemTiers[systemId] = sysDef.defaultTier;
      }
      if (sysDef.stateDefaults && !target.systemState[systemId]) {
        target.systemState[systemId] = cloneSerializable(sysDef.stateDefaults);
      }
    }
  }

  return changed;
}

export function handleDisableTag(state, effect, context) {
  return handleToggleTag(state, effect, context, true);
}

export function handleEnableTag(state, effect, context) {
  return handleToggleTag(state, effect, context, false);
}

export function handleHideTag(state, effect, context) {
  return handleToggleTagHidden(state, effect, context, true);
}

export function handleRevealTag(state, effect, context) {
  return handleToggleTagHidden(state, effect, context, false);
}

export function handleRemoveTag(state, effect, context) {
  const tagId = effect.tag;
  if (!tagId || typeof tagId !== "string") return false;

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    if (!Array.isArray(target.tags) || target.tags.length === 0) continue;

    const nextTags = target.tags.filter((t) => t !== tagId);
    if (nextTags.length === target.tags.length) continue;
    target.tags = nextTags;
    changed = true;
  }

  return changed;
}

export function handleSetSystemTier(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const systemDef = envSystemDefs[systemId];
  if (!systemDef) return false;

  const tier =
    typeof effect.tier === "string"
      ? effect.tier
      : typeof effect.value === "string"
        ? effect.value
        : null;
  if (!tier || systemDef.tierMap?.[tier] == null) return false;

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    if (!target.systemTiers || typeof target.systemTiers !== "object") {
      target.systemTiers = {};
    }
    if (target.systemTiers[systemId] === tier) continue;
    target.systemTiers[systemId] = tier;
    changed = true;
  }

  return changed;
}

export function handleSetSystemState(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  const rawValue = effect.value ?? effect.state ?? null;
  const shouldMerge = effect.merge === true;

  for (const target of targets) {
    if (!target) continue;
    if (!target.systemState || typeof target.systemState !== "object") {
      target.systemState = {};
    }
    const nextValue = cloneSerializable(rawValue);
    if (
      shouldMerge &&
      nextValue &&
      typeof nextValue === "object" &&
      !Array.isArray(nextValue)
    ) {
      const current = target.systemState[systemId];
      if (current && typeof current === "object" && !Array.isArray(current)) {
        target.systemState[systemId] = { ...current, ...nextValue };
      } else {
        target.systemState[systemId] = nextValue;
      }
    } else {
      target.systemState[systemId] = nextValue;
    }
    changed = true;
  }

  return changed;
}

export function handleClearSystemState(state, effect, context) {
  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  const systems = Array.isArray(effect.systems) ? effect.systems : null;

  for (const target of targets) {
    if (!target) continue;
    if (!target.systemState || typeof target.systemState !== "object") {
      continue;
    }

    if (!systems || systems.length === 0) {
      if (Object.keys(target.systemState).length > 0) {
        target.systemState = {};
        changed = true;
      }
      continue;
    }

    for (const sys of systems) {
      if (Object.prototype.hasOwnProperty.call(target.systemState, sys)) {
        delete target.systemState[sys];
        changed = true;
      }
    }
  }

  return changed;
}

export function handleUpgradeSystemTier(state, effect, context) {
  const systemId = effect.system;
  if (!systemId || typeof systemId !== "string") return false;

  const systemDef = envSystemDefs[systemId];
  if (!systemDef) return false;

  const tiers = getSystemTierLadder(systemDef);
  if (tiers.length === 0) return false;

  if (!Number.isFinite(effect.delta)) return false;
  const delta = Math.trunc(effect.delta);

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  const defaultTier = tiers.includes(systemDef.defaultTier)
    ? systemDef.defaultTier
    : tiers[0];
  for (const target of targets) {
    if (!target) continue;
    if (!target.systemTiers || typeof target.systemTiers !== "object") {
      target.systemTiers = {};
    }

    const hasCurrent = typeof target.systemTiers[systemId] === "string";
    let current = hasCurrent ? target.systemTiers[systemId] : defaultTier;
    if (!hasCurrent) {
      target.systemTiers[systemId] = current;
      changed = true;
    }

    let idx = tiers.indexOf(current);
    if (idx < 0) idx = tiers.indexOf(defaultTier);
    if (idx < 0) idx = 0;

    const nextIdx = Math.max(0, Math.min(tiers.length - 1, idx + delta));
    const nextTier = tiers[nextIdx];

    if (current === nextTier) continue;
    target.systemTiers[systemId] = nextTier;
    changed = true;
  }

  return changed;
}

function handleToggleTag(state, effect, context, disable) {
  const tagId = effect.tag;
  if (!tagId || typeof tagId !== "string") return false;

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    if (!Array.isArray(target.tags) || !target.tags.includes(tagId)) {
      continue;
    }
    if (setTagDisabled(target, tagId, disable, "event")) changed = true;
  }

  return changed;
}

function handleToggleTagHidden(state, effect, context, hidden) {
  const tagId = effect.tag;
  if (!tagId || typeof tagId !== "string") return false;

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    if (!Array.isArray(target.tags) || !target.tags.includes(tagId)) continue;
    if (setTagHidden(target, tagId, hidden, "discovery")) changed = true;
  }

  return changed;
}
