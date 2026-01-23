import { resolveBoardTargets } from "../core/targets-board.js";

export function handleSetProp(state, effect, context) {
  const prop = effect.prop;
  const value = effect.value;
  if (!prop || typeof value !== "number") return false;

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    if (!target.props || typeof target.props !== "object") {
      target.props = {};
    }
    target.props[prop] = value;

    if (typeof effect.min === "number" && target.props[prop] < effect.min) {
      target.props[prop] = effect.min;
    }
    if (typeof effect.max === "number" && target.props[prop] > effect.max) {
      target.props[prop] = effect.max;
    }
    changed = true;
  }

  return changed;
}

export function handleAddProp(state, effect, context) {
  const prop = effect.prop;
  const amt = effect.amount ?? 0;
  if (!prop || typeof amt !== "number") return false;

  const targets = resolveBoardTargets(state, effect.target, context);
  if (!targets.length) return false;

  let changed = false;
  for (const target of targets) {
    if (!target) continue;
    if (!target.props || typeof target.props !== "object") {
      target.props = {};
    }

    target.props[prop] = (target.props[prop] ?? 0) + amt;

    if (typeof effect.min === "number" && target.props[prop] < effect.min) {
      target.props[prop] = effect.min;
    }
    if (typeof effect.max === "number" && target.props[prop] > effect.max) {
      target.props[prop] = effect.max;
    }
    changed = true;
  }

  return changed;
}
