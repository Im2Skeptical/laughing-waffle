import { resolveBoardTargets } from "../../core/targets-board.js";

export function resolveEffectTargets(state, effect, context) {
  if (effect?.target) {
    return resolveBoardTargets(state, effect.target, context);
  }
  return context?.source ? [context.source] : [];
}
