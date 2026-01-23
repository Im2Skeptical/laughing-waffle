export const SYSTEM_TIER_LADDER = ["bronze", "silver", "gold", "diamond"];
export const TIER_ASC = ["bronze", "silver", "gold", "diamond"];
export const TIER_DESC = ["diamond", "gold", "silver", "bronze"];

export function getTierRank(tier, order) {
  const idx = order.indexOf(tier);
  return idx >= 0 ? idx : order.length;
}
