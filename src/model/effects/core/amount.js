export function resolveAmount(effect, systemState, def, context) {
  let amount = null;
  if (Number.isFinite(effect.amount)) amount = effect.amount;
  if (amount == null && Number.isFinite(effect.delta)) amount = effect.delta;
  if (amount == null && effect.amountVar && context?.vars) {
    amount = context.vars[effect.amountVar];
  }
  if (amount == null && effect.amountFromKey && systemState) {
    amount = systemState[effect.amountFromKey];
  }
  if (amount == null && effect.amountFromDefKey && def) {
    amount = def[effect.amountFromDefKey];
  }

  if (!Number.isFinite(amount)) return null;
  const scale = Number.isFinite(effect.amountScale) ? effect.amountScale : 1;
  return amount * scale;
}
