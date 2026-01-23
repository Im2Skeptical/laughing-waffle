import { runItemPassives } from "./item-passives.js";

export function processSeasonChangeForItems(state, runEffect) {
  if (!state?.ownerInventories) return;

  const tSec = Number.isFinite(state.tSec) ? state.tSec : 0;
  for (const [ownerId, inv] of Object.entries(state.ownerInventories)) {
    if (!inv) continue;
    const itemsSnapshot = [...inv.items];
    for (const item of itemsSnapshot) {
      if (!item) continue;
      runItemPassives(state, inv, ownerId, item, tSec, "season", runEffect);
    }
  }
}
